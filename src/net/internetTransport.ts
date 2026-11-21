import type {NearbyDevice} from '@/types';
import type {MeshTransport, TransportState} from '@/mesh/transport/types';
import {decodePacket} from '@/mesh/relayProtocol';
import {RelayPool} from './nostr';
import {Signaling} from './signaling';
import {LinkManager, Rtc, IceServer} from './rtcLinks';
import type {Identity} from './signaling';

/**
 * The internet as one more way for the mesh engine to reach someone.
 *
 * Messages addressed to a person go over a direct, encrypted phone-to-phone link
 * (set up through public relays). Anything not addressed to one person (presence,
 * broadcasts) stays on Bluetooth/Wi-Fi — the internet is only for people you
 * chat with. The mesh engine above does not know or care which road a message took.
 */
/** Messages up to this size also go through the relay mailbox when no direct link is open yet (bigger ones wait for the link). */
const RELAY_WIRE_MAX = 16_000;
/**
 * Two free STUN servers to find each phone's public address, plus a public relay (TURN) as a last resort for networks
 * where two phones cannot reach each other directly (many mobile-data connections). Calls are end-to-end encrypted by
 * WebRTC itself, so the relay only ever carries scrambled traffic. It is a shared free service and may be slow or
 * unavailable; Settings → Internet → Advanced lets you use your own.
 */
export const DEFAULT_ICE: IceServer[] = [
  {urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']},
  {urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject'},
];

export class InternetTransport implements MeshTransport {
  state: TransportState = 'idle';
  readonly pool: RelayPool;
  readonly sig: Signaling;
  readonly links: LinkManager;
  private enabled = true;
  private wireHandlers = new Set<(wire: string, from: string) => void>();
  private stateHandlers = new Set<(s: TransportState) => void>();
  private offs: Array<() => void> = [];
  private me: () => Identity;
  private allow: (peerKey: string) => boolean;

  constructor(opts: {
    pool: RelayPool;
    rtc: Rtc;
    me: () => Identity;
    iceServers?: () => IceServer[];
    allow: (peerKey: string) => boolean;
  }) {
    this.me = opts.me;
    this.allow = opts.allow;
    this.pool = opts.pool;
    this.sig = new Signaling(opts.pool, opts.me);
    this.links = new LinkManager(this.sig, opts.rtc, () => opts.me().publicKey, opts.iceServers ?? (() => DEFAULT_ICE), opts.allow);
  }

  private set(s: TransportState) {
    if (s !== this.state) {
      this.state = s;
      this.stateHandlers.forEach(h => h(s));
    }
  }

  async start(): Promise<void> {
    if (!this.enabled || this.state === 'active' || this.state === 'starting') {
      return;
    }
    this.set('starting');
    this.offs.push(this.pool.onStatus(n => this.set(n > 0 ? 'active' : 'starting')));
    this.offs.push(this.links.onWire((wire, from) => this.wireHandlers.forEach(h => h(wire, from))));
    // A connect request ("let's be connected") from someone I have no link with yet arrives in the relay mailbox.
    this.offs.push(
      this.sig.onSignal((from, p) => {
        if (p.t !== 'wire' || typeof p.wire !== 'string') {
          return;
        }
        const pk = decodePacket(p.wire);
        // A connect request from a stranger, or any message from someone I am connected to (see broadcast()).
        if (pk && pk.origin === from && pk.recipient === this.me().publicKey && (pk.type === 'PAIR' || this.allow(from))) {
          this.wireHandlers.forEach(h => h(p.wire as string, from));
        }
      }),
    );
    this.pool.start();
    this.sig.start();
    this.links.start();
  }

  async stop(): Promise<void> {
    this.offs.forEach(o => o());
    this.offs = [];
    this.links.stop();
    this.sig.stop();
    this.pool.stop();
    this.set('idle');
  }

  /** Turn the internet road on or off without tearing down the engine. */
  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    if (on) {
      await this.start();
    } else {
      await this.stop();
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async broadcast(wire: string, exceptDeviceId?: string): Promise<void> {
    if (!this.enabled || this.state === 'idle') {
      return;
    }
    const p = decodePacket(wire);
    if (!p?.recipient || p.recipient === exceptDeviceId) {
      return; // only person-to-person traffic uses the internet
    }
    if (this.allow(p.recipient)) {
      const how = this.links.send(p.recipient, wire); // a direct link, but only to people I am connected to
      // Opening a direct link takes several seconds (it is negotiated through the relays first). So until one is
      // open, the message ALSO goes through the relay mailbox right away: it is already end-to-end encrypted, and
      // the mailbox note is encrypted to the receiver again, so a relay sees only scrambled bytes. It arrives in
      // about a second; if the link comes up first, the duplicate is dropped by the mesh engine.
      if (how !== 'sent' && wire.length <= RELAY_WIRE_MAX) {
        this.sig.send(p.recipient, {t: 'wire', wire});
      }
    }
    if (p.type === 'PAIR') {
      this.sig.send(p.recipient, {t: 'wire', wire}); // people not yet connected cannot open a link, so ask through the mailbox
    }
  }

  onWire(handler: (wire: string, from: string) => void): () => void {
    this.wireHandlers.add(handler);
    return () => this.wireHandlers.delete(handler);
  }

  onDevices(_handler: (devices: NearbyDevice[]) => void): () => void {
    return () => undefined; // internet contacts are not "nearby devices"
  }

  onStateChange(handler: (s: TransportState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }
}
