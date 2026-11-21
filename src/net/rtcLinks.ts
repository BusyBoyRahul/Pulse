import {Signaling, randomId} from './signaling';

/**
 * Direct phone-to-phone links (WebRTC data channels).
 *
 * Two phones swap one offer and one answer through the relays (encrypted), then
 * talk straight to each other. If both are online, chat travels over the link;
 * if not, the message waits on the sender's phone and goes when the link opens.
 *
 * WebRTC itself sits behind the tiny `Rtc` interface so this logic is fully
 * testable without a network, and the real engine (react-native-webrtc) is
 * loaded only when needed.
 */
export type IceServer = {urls: string | string[]; username?: string; credential?: string};

export interface Chan {
  readonly open: boolean;
  send(text: string): void;
  onOpen(cb: () => void): void;
  onMessage(cb: (text: string) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export interface Peer {
  createChannel(): Chan;
  onChannel(cb: (c: Chan) => void): void;
  /** Offer with all connection candidates already inside. */
  makeOffer(): Promise<string>;
  /** Take an offer, return the answer (candidates inside). */
  acceptOffer(sdp: string): Promise<string>;
  acceptAnswer(sdp: string): Promise<void>;
  onState(cb: (s: 'connected' | 'failed' | 'closed') => void): void;
  close(): void;
}

/** A live camera/microphone stream (local or remote). */
export interface Media {
  readonly id: string;
  readonly hasVideo: boolean;
  /** What the video view needs to draw it. */
  toURL(): string;
  setMuted(muted: boolean): void;
  setCamera(on: boolean): void;
  flipCamera(): void;
  stop(): void;
}

/** A voice/video call connection. */
export interface CallPeer {
  attach(local: Media): void;
  onRemote(cb: (m: Media) => void): void;
  makeOffer(): Promise<string>;
  acceptOffer(sdp: string): Promise<string>;
  acceptAnswer(sdp: string): Promise<void>;
  onState(cb: (s: 'connected' | 'failed' | 'closed') => void): void;
  close(): void;
}

export interface Rtc {
  createPeer(iceServers: IceServer[]): Peer;
  /** Calls (optional: an engine without media can still carry chat). */
  createCallPeer?(iceServers: IceServer[]): CallPeer;
  getMedia?(video: boolean): Promise<Media>;
}

type Link = {
  peerKey: string;
  peer: Peer;
  chan: Chan | null;
  initiator: boolean;
  sid: string;
  startedAt: number;
  queue: {wire: string; at: number}[];
};

const CONNECT_TIMEOUT_MS = 25_000;
const QUEUE_MAX = 60;
const QUEUE_AGE_MS = 2 * 60_000;
const RETRY_GAP_MS = 8_000;

export class LinkManager {
  private links = new Map<string, Link>();
  private wireHandlers = new Set<(wire: string, from: string) => void>();
  private linkHandlers = new Set<(peerKey: string, open: boolean) => void>();
  private lastTry = new Map<string, number>();
  private stopSignal: (() => void) | null = null;

  constructor(
    private sig: Signaling,
    private rtc: Rtc,
    private me: () => string,
    private iceServers: () => IceServer[],
    /** Only connected people may open a link to me. */
    private allow: (peerKey: string) => boolean,
  ) {}

  start(): void {
    this.stopSignal = this.sig.onSignal((from, p) => void this.onSignal(from, p));
  }

  stop(): void {
    this.stopSignal?.();
    this.stopSignal = null;
    for (const l of [...this.links.values()]) {
      this.drop(l, true);
    }
  }

  onWire(h: (wire: string, from: string) => void): () => void {
    this.wireHandlers.add(h);
    return () => this.wireHandlers.delete(h);
  }

  /** Called with (peer, true) when a link opens and (peer, false) when it closes. */
  onLink(h: (peerKey: string, open: boolean) => void): () => void {
    this.linkHandlers.add(h);
    return () => this.linkHandlers.delete(h);
  }

  isOpen(peerKey: string): boolean {
    return !!this.links.get(peerKey)?.chan?.open;
  }

  openPeers(): string[] {
    return [...this.links.values()].filter(l => l.chan?.open).map(l => l.peerKey);
  }

  /** Send now if the link is open; otherwise start one and send when it is ready. */
  send(peerKey: string, wire: string): 'sent' | 'queued' | 'unreachable' {
    const l = this.links.get(peerKey);
    if (l?.chan?.open) {
      try {
        l.chan.send(wire);
        return 'sent';
      } catch {
        this.drop(l);
      }
    }
    const cur = this.links.get(peerKey);
    if (cur) {
      this.enqueue(cur, wire);
      return 'queued';
    }
    const last = this.lastTry.get(peerKey) ?? 0;
    if (Date.now() - last < RETRY_GAP_MS) {
      return 'unreachable'; // we just failed; the sender's outbox will try again later
    }
    this.lastTry.set(peerKey, Date.now());
    const created = this.connect(peerKey);
    if (!created) {
      return 'unreachable';
    }
    this.enqueue(created, wire);
    return 'queued';
  }

  private enqueue(l: Link, wire: string) {
    const now = Date.now();
    l.queue = l.queue.filter(q => now - q.at < QUEUE_AGE_MS);
    if (l.queue.length >= QUEUE_MAX) {
      l.queue.shift();
    }
    l.queue.push({wire, at: now});
  }

  // ---- initiator ----------------------------------------------------------------------------------

  private connect(peerKey: string): Link | null {
    const peer = this.rtc.createPeer(this.iceServers());
    const link: Link = {peerKey, peer, chan: null, initiator: true, sid: randomId(), startedAt: Date.now(), queue: []};
    this.links.set(peerKey, link);
    this.watch(link);
    const chan = peer.createChannel();
    this.attach(link, chan);
    void peer
      .makeOffer()
      .then(sdp => {
        if (this.links.get(peerKey) !== link) {
          return;
        }
        if (!this.sig.send(peerKey, {t: 'offer', sid: link.sid, sdp})) {
          this.drop(link); // no relay reachable
        }
      })
      .catch(() => this.drop(link));
    setTimeout(() => {
      if (this.links.get(peerKey) === link && !link.chan?.open) {
        this.drop(link);
      }
    }, CONNECT_TIMEOUT_MS);
    return link;
  }

  // ---- signals ----------------------------------------------------------------------------------------

  private async onSignal(from: string, p: Record<string, unknown>): Promise<void> {
    if (!this.allow(from)) {
      return;
    }
    const sid = typeof p.sid === 'string' ? p.sid : '';
    if (p.t === 'offer' && typeof p.sdp === 'string') {
      const mine = this.links.get(from);
      // Messages already waiting on a link that is about to be replaced move to the new one (nothing is lost).
      let carried: Link['queue'] = [];
      if (mine && !mine.chan?.open) {
        // Both of us dialled at once: the smaller key keeps its own call, the other answers.
        if (this.me() < from) {
          return;
        }
        carried = mine.queue;
        this.drop(mine);
      } else if (mine?.chan?.open) {
        this.drop(mine); // they restarted: replace the old link
      }
      const peer = this.rtc.createPeer(this.iceServers());
      const link: Link = {peerKey: from, peer, chan: null, initiator: false, sid, startedAt: Date.now(), queue: carried};
      this.links.set(from, link);
      this.watch(link);
      peer.onChannel(c => this.attach(link, c));
      try {
        const answer = await peer.acceptOffer(p.sdp);
        if (this.links.get(from) === link) {
          this.sig.send(from, {t: 'answer', sid, sdp: answer});
        }
      } catch {
        this.drop(link);
      }
      setTimeout(() => {
        if (this.links.get(from) === link && !link.chan?.open) {
          this.drop(link);
        }
      }, CONNECT_TIMEOUT_MS);
    } else if (p.t === 'answer' && typeof p.sdp === 'string') {
      const link = this.links.get(from);
      if (link && link.initiator && link.sid === sid) {
        try {
          await link.peer.acceptAnswer(p.sdp);
        } catch {
          this.drop(link);
        }
      }
    }
  }

  // ---- plumbing ---------------------------------------------------------------------------------------------

  private watch(link: Link) {
    link.peer.onState(s => {
      if (s === 'failed' || s === 'closed') {
        this.drop(link);
      }
    });
  }

  private attach(link: Link, chan: Chan) {
    link.chan = chan;
    chan.onOpen(() => {
      for (const q of link.queue.splice(0)) {
        try {
          chan.send(q.wire);
        } catch {
          break;
        }
      }
      this.linkHandlers.forEach(h => h(link.peerKey, true));
    });
    chan.onMessage(text => this.wireHandlers.forEach(h => h(text, link.peerKey)));
    chan.onClose(() => this.drop(link));
    if (chan.open) {
      // The channel arrived already open.
      for (const q of link.queue.splice(0)) {
        chan.send(q.wire);
      }
      this.linkHandlers.forEach(h => h(link.peerKey, true));
    }
  }

  private drop(link: Link, quiet = false) {
    if (this.links.get(link.peerKey) !== link) {
      return;
    }
    this.links.delete(link.peerKey);
    const wasOpen = !!link.chan?.open;
    try {
      link.chan?.close();
    } catch {
      /* closing */
    }
    try {
      link.peer.close();
    } catch {
      /* closing */
    }
    if (wasOpen && !quiet) {
      this.linkHandlers.forEach(h => h(link.peerKey, false));
    }
  }
}
