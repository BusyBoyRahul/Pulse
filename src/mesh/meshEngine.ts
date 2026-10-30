import config from '@/config';
import type {MeshPacket, MeshPacketType, NearbyDevice} from '@/types';
import {
  SeenCache,
  decodePacket,
  encodePacket,
  createPacket,
  shouldRelay,
  prepareRelay,
  isForSelf,
  NewPacketInput,
} from './relayProtocol';
import type {MeshTransport, TransportState} from './transport/types';

type PacketHandler = (packet: MeshPacket, from: string) => void;
export type RelayEvent = {type: MeshPacketType; hops: number; at: number};

/** Packet types worth holding on to for someone who isn't in range yet.
 *  PRESENCE (stale in seconds) and CALL (real-time audio) are never carried. */
const CARRY_TYPES: ReadonlySet<MeshPacketType> = new Set(['CHAT', 'GROUP', 'PAIR', 'NOTE', 'SOS', 'ACK']);

type Carried = {id: string; packet: MeshPacket; wireLen: number; storedAt: number};

/**
 * The mesh brain. Sits on top of any MeshTransport and enforces the relay
 * protocol: decode → dedup → deliver-if-ours → relay-onward. App features
 * (SOS, chat, notes) subscribe by packet type; they never touch the radio.
 *
 * Store-and-forward: if A sends to C while C is out of everyone's range, the
 * relay B keeps ("carries") the packet. When B later connects to a phone it
 * hasn't been connected to before — C, or anyone closer to C — B hands the
 * carried packets over. Messages therefore cross gaps in the mesh instead of
 * dying at the last phone that happened to hear them.
 */
export class MeshEngine {
  private seen = new SeenCache();
  private handlers = new Map<MeshPacketType, Set<PacketHandler>>();
  private relayHandlers = new Set<(e: RelayEvent) => void>();
  private unsubs: Array<() => void> = [];

  private carry = new Map<string, Carried>();
  private carryChars = 0;
  private knownDevices = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushAt = 0;

  constructor(private transport: MeshTransport, private selfKey: string) {}

  async start(): Promise<void> {
    this.unsubs.push(this.transport.onWire((wire, from) => this.ingest(wire, from)));
    this.unsubs.push(this.transport.onDevices(devices => this.onNeighbours(devices)));
    await this.transport.start();
  }

  async stop(): Promise<void> {
    this.unsubs.forEach(u => u());
    this.unsubs = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.knownDevices.clear();
    await this.transport.stop();
  }

  get state(): TransportState {
    return this.transport.state;
  }

  onState(handler: (s: TransportState) => void) {
    return this.transport.onStateChange(handler);
  }

  onDevices(handler: (d: NearbyDevice[]) => void) {
    return this.transport.onDevices(handler);
  }

  /** Called whenever THIS phone forwards someone else's packet (UI flair only —
   *  the engine reports just the packet type and hop count, never content). */
  onRelay(handler: (e: RelayEvent) => void): () => void {
    this.relayHandlers.add(handler);
    return () => this.relayHandlers.delete(handler);
  }

  /** Subscribe to inbound packets of a given type addressed to this node. */
  subscribe(type: MeshPacketType, handler: PacketHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** Originate a new packet from this device and inject it into the mesh. */
  async send(input: Omit<NewPacketInput, 'origin'>): Promise<MeshPacket> {
    const packet = createPacket({...input, origin: this.selfKey});
    this.seen.markIfNew(packet.id); // never relay our own echo
    this.carryPacket(packet); // our own messages are carried too, for when we move
    await this.transport.broadcast(encodePacket(packet));
    return packet;
  }

  /** Re-inject a packet we're carrying (e.g. queued SOS) without changing id. */
  async rebroadcast(packet: MeshPacket): Promise<void> {
    await this.transport.broadcast(encodePacket(packet));
  }

  /** Mark an id as already-seen (used when we sent a packet over the LAN
   *  instead of the mesh, so its BLE echo won't be double-processed). */
  markSeen(id: string): void {
    this.seen.markIfNew(id);
  }

  /** Ingest a packet that arrived over an ALTERNATE transport (LAN / Wi-Fi
   *  direct). Deduped and dispatched to subscribers exactly like a mesh packet,
   *  but never relayed over BLE. */
  injectPacket(packet: MeshPacket): void {
    if (!this.seen.markIfNew(packet.id)) {
      return;
    }
    if (isForSelf(packet, this.selfKey)) {
      this.dispatch(packet, 'lan');
    }
  }

  get publicKey(): string {
    return this.selfKey;
  }

  /** Packets currently held for later hand-over (diagnostics / tests). */
  get carriedCount(): number {
    return this.carry.size;
  }

  // -------------------------------------------------------------------------

  private ingest(wire: string, from: string): void {
    const packet = decodePacket(wire);
    if (!packet) {
      return; // malformed
    }
    if (!this.seen.markIfNew(packet.id)) {
      return; // already handled — loop prevention
    }

    // Deliver to local subscribers if it's for us (or a broadcast).
    if (isForSelf(packet, this.selfKey)) {
      this.dispatch(packet, from);
    }

    // Relay onward if appropriate (one hop consumed). Skip the neighbour it
    // came from — it obviously already has it.
    if (shouldRelay(packet, this.selfKey)) {
      const out = prepareRelay(packet);
      void this.transport.broadcast(encodePacket(out), from);
      this.carryPacket(packet); // keep the as-received copy for later hand-over
      this.relayHandlers.forEach(h => h({type: packet.type, hops: out.hops ?? 1, at: Date.now()}));
    }
  }

  private dispatch(packet: MeshPacket, from: string): void {
    this.handlers.get(packet.type)?.forEach(h => h(packet, from));
  }

  // ---- store-and-forward --------------------------------------------------

  private carryPacket(packet: MeshPacket): void {
    if (!CARRY_TYPES.has(packet.type) || packet.ttl <= 0 || this.carry.has(packet.id)) {
      return;
    }
    if (packet.recipient === this.selfKey) {
      return; // already delivered to us
    }
    const wireLen = encodePacket(packet).length;
    this.carry.set(packet.id, {id: packet.id, packet, wireLen, storedAt: Date.now()});
    this.carryChars += wireLen;
    this.trimCarry();
  }

  private trimCarry(): void {
    const now = Date.now();
    for (const [id, c] of this.carry) {
      const ttl = c.packet.recipient ? config.carryDirectMs : config.carryBroadcastMs;
      if (now - c.storedAt > ttl) {
        this.dropCarried(id);
      }
    }
    // Oldest first (Map keeps insertion order) until we're back under budget.
    for (const id of [...this.carry.keys()]) {
      if (this.carry.size <= config.carryMax && this.carryChars <= config.carryMaxChars) {
        break;
      }
      this.dropCarried(id);
    }
  }

  private dropCarried(id: string): void {
    const c = this.carry.get(id);
    if (c) {
      this.carryChars -= c.wireLen;
      this.carry.delete(id);
    }
  }

  /** The transport reported its neighbour list — hand over what we carry when
   *  someone NEW appears. */
  private onNeighbours(devices: NearbyDevice[]): void {
    const ids = new Set(devices.map(d => d.deviceId));
    let fresh = false;
    for (const id of ids) {
      if (!this.knownDevices.has(id)) {
        fresh = true;
      }
    }
    this.knownDevices = ids;
    if (fresh && this.carry.size > 0) {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    // Let the new link settle (and batch several arrivals) before sending.
    const wait = Math.max(1200, config.carryFlushGapMs - (Date.now() - this.lastFlushAt));
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushCarry();
    }, wait);
  }

  private async flushCarry(): Promise<void> {
    this.lastFlushAt = Date.now();
    this.trimCarry();
    // Newest first, bounded, spaced out so a big hand-over doesn't choke the link.
    const batch = [...this.carry.values()].reverse().slice(0, 40);
    for (const c of batch) {
      if (!this.carry.has(c.id)) {
        continue;
      }
      try {
        await this.transport.broadcast(encodePacket(prepareRelay(c.packet)));
      } catch {
        /* link dropped mid-hand-over; the next arrival retries */
      }
      await new Promise<void>(r => setTimeout(r, 60));
    }
  }
}
