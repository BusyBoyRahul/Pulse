import {NostrEvent, Filter, matches, KIND_DIRECTORY} from '@/net/nostr';
import type {Chan, IceServer, Peer, Rtc} from '@/net/rtcLinks';

/**
 * Test doubles for the internet: an in-memory "Nostr relay" and an in-memory
 * "WebRTC". They behave like the real things at the level Pulse uses them, so
 * chat, calls and discovery can be run end to end on virtual phones.
 */

// ---------------------------------------------------------------------------
// relay
// ---------------------------------------------------------------------------
class FakeSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: {data: unknown}) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  subs = new Map<string, Filter[]>();

  constructor(private hub: FakeRelayHub, readonly url: string) {
    hub.sockets.add(this);
    setTimeout(() => {
      if (hub.down) {
        this.onclose?.();
        return;
      }
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  deliver(msg: unknown[]) {
    setTimeout(() => this.onmessage?.({data: JSON.stringify(msg)}), 0);
  }

  send(data: string) {
    const m = JSON.parse(data) as unknown[];
    if (m[0] === 'REQ') {
      const id = m[1] as string;
      const filters = m.slice(2) as Filter[];
      this.subs.set(id, filters);
      for (const ev of this.hub.stored) {
        if (filters.some(f => matches(f, ev))) {
          this.deliver(['EVENT', id, ev]);
        }
      }
      this.deliver(['EOSE', id]);
    } else if (m[0] === 'EVENT') {
      this.hub.receive(m[1] as NostrEvent);
    } else if (m[0] === 'CLOSE') {
      this.subs.delete(m[1] as string);
    }
  }

  close() {
    this.readyState = 3;
    this.hub.sockets.delete(this);
  }
}

export class FakeRelayHub {
  sockets = new Set<FakeSocket>();
  stored: NostrEvent[] = [];
  down = false;
  /** Every event that was published (for tests that look at what a relay can see). */
  seen: NostrEvent[] = [];

  factory = (url: string): FakeSocket => new FakeSocket(this, url);

  receive(ev: NostrEvent) {
    this.seen.push(ev);
    if (ev.kind === KIND_DIRECTORY) {
      const d = ev.tags.find(t => t[0] === 'd')?.[1];
      this.stored = this.stored.filter(s => !(s.pubkey === ev.pubkey && s.tags.find(t => t[0] === 'd')?.[1] === d));
      this.stored.push(ev);
    }
    for (const s of this.sockets) {
      for (const [id, filters] of s.subs) {
        if (filters.some(f => matches(f, ev))) {
          s.deliver(['EVENT', id, ev]);
        }
      }
    }
  }

  /** Take every phone offline (relays unreachable). */
  setDown(down: boolean) {
    this.down = down;
    if (down) {
      for (const s of [...this.sockets]) {
        s.readyState = 3;
        s.onclose?.();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// webrtc
// ---------------------------------------------------------------------------
class FakeChan implements Chan {
  open = false;
  other: FakeChan | null = null;
  private openCbs: Array<() => void> = [];
  private msgCbs: Array<(t: string) => void> = [];
  private closeCbs: Array<() => void> = [];
  send(text: string) {
    if (!this.open || !this.other) {
      throw new Error('channel not open');
    }
    const o = this.other;
    setTimeout(() => o.msgCbs.forEach(c => c(text)), 0);
  }
  onOpen(cb: () => void) {
    this.openCbs.push(cb);
  }
  onMessage(cb: (t: string) => void) {
    this.msgCbs.push(cb);
  }
  onClose(cb: () => void) {
    this.closeCbs.push(cb);
  }
  doOpen() {
    this.open = true;
    this.openCbs.forEach(c => c());
  }
  close() {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.closeCbs.forEach(c => c());
    const o = this.other;
    if (o?.open) {
      setTimeout(() => o.close(), 0);
    }
  }
}

class FakePeer implements Peer {
  id = Math.random().toString(36).slice(2);
  private mine = new FakeChan();
  private theirsCb: ((c: Chan) => void) | null = null;
  private stateCb: ((s: 'connected' | 'failed' | 'closed') => void) | null = null;
  remote: FakePeer | null = null;
  closed = false;

  constructor(private hub: FakeRtcHub, readonly iceServers: IceServer[]) {
    hub.peers.set(this.id, this);
  }

  createChannel(): Chan {
    return this.mine;
  }
  onChannel(cb: (c: Chan) => void) {
    this.theirsCb = cb;
  }
  onState(cb: (s: 'connected' | 'failed' | 'closed') => void) {
    this.stateCb = cb;
  }
  async makeOffer() {
    return JSON.stringify({from: this.id});
  }
  async acceptOffer(sdp: string) {
    this.remote = this.hub.peers.get((JSON.parse(sdp) as {from: string}).from) ?? null;
    return JSON.stringify({from: this.id});
  }
  async acceptAnswer(sdp: string) {
    const them = this.hub.peers.get((JSON.parse(sdp) as {from: string}).from);
    if (!them || this.hub.blocked || them.closed) {
      return;
    }
    this.remote = them;
    them.remote = this;
    const theirs = new FakeChan();
    theirs.other = this.mine;
    this.mine.other = theirs;
    setTimeout(() => {
      them.theirsCb?.(theirs);
      this.mine.doOpen();
      theirs.doOpen();
      this.stateCb?.('connected');
      them.stateCb?.('connected');
    }, 0);
  }
  close() {
    this.closed = true;
    this.mine.close();
    this.stateCb?.('closed');
  }
}

export class FakeRtcHub implements Rtc {
  peers = new Map<string, FakePeer>();
  calls = new FakeCallHub();
  createCallPeer(_ice: IceServer[]): CallPeer {
    return new FakeCallPeer(this.calls);
  }
  async getMedia(video: boolean): Promise<Media> {
    if (this.calls.micDenied) {
      throw new Error('microphone denied');
    }
    const m = new FakeMedia(video);
    this.calls.media.push(m);
    return m;
  }
  /** Pretend strict networks: no direct link can ever be made. */
  blocked = false;
  created = 0;
  lastIce: IceServer[] = [];
  createPeer(iceServers: IceServer[]): Peer {
    this.created += 1;
    this.lastIce = iceServers;
    return new FakePeer(this, iceServers);
  }
}

// ---------------------------------------------------------------------------
// calls (fake microphone/camera + fake call connection)
// ---------------------------------------------------------------------------
import type {CallPeer, Media} from '@/net/rtcLinks';

export class FakeMedia implements Media {
  static count = 0;
  readonly id = `m${++FakeMedia.count}`;
  muted = false;
  camera = true;
  flips = 0;
  stopped = false;
  constructor(readonly hasVideo: boolean) {}
  toURL() {
    return `fake://${this.id}`;
  }
  setMuted(m: boolean) {
    this.muted = m;
  }
  setCamera(on: boolean) {
    this.camera = on;
  }
  flipCamera() {
    this.flips += 1;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeCallPeer implements CallPeer {
  id = Math.random().toString(36).slice(2);
  local: FakeMedia | null = null;
  remote: FakeCallPeer | null = null;
  private remoteCb: ((m: Media) => void) | null = null;
  private stateCb: ((s: 'connected' | 'failed' | 'closed') => void) | null = null;
  closed = false;
  constructor(private hub: FakeCallHub) {
    hub.peers.set(this.id, this);
  }
  attach(local: Media) {
    this.local = local as FakeMedia;
  }
  onRemote(cb: (m: Media) => void) {
    this.remoteCb = cb;
  }
  onState(cb: (s: 'connected' | 'failed' | 'closed') => void) {
    this.stateCb = cb;
  }
  async makeOffer() {
    return JSON.stringify({from: this.id});
  }
  async acceptOffer(sdp: string) {
    this.remote = this.hub.peers.get((JSON.parse(sdp) as {from: string}).from) ?? null;
    return JSON.stringify({from: this.id});
  }
  async acceptAnswer(sdp: string) {
    const them = this.hub.peers.get((JSON.parse(sdp) as {from: string}).from);
    if (!them || this.hub.blocked) {
      return;
    }
    this.remote = them;
    setTimeout(() => {
      this.remoteCb?.(them.local ?? new FakeMedia(false));
      them.remoteCb?.(this.local ?? new FakeMedia(false));
      this.stateCb?.('connected');
      them.stateCb?.('connected');
    }, 0);
  }
  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stateCb?.('closed');
  }
}

export class FakeCallHub {
  peers = new Map<string, FakeCallPeer>();
  blocked = false;
  micDenied = false;
  media: FakeMedia[] = [];
}
