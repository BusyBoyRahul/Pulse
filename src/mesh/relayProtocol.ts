import naclUtil from 'tweetnacl-util';
import config from '@/config';
import type {MeshPacket, MeshPacketType} from '@/types';

/**
 * Pure, side-effect-free mesh relay logic. This is the most correctness-
 * critical code in Pulse and is fully unit-tested (see __tests__).
 *
 * Responsibilities:
 *   - generate collision-resistant packet ids
 *   - encode/decode packets to a compact wire string
 *   - remember which packets we've already handled (loop prevention)
 *   - decide whether an incoming packet should be relayed, and prepare it
 */

const WIRE_VERSION = 1;

/** RFC4122-ish v4 id without a uuid dependency. */
export function newPacketId(rand: () => number = Math.random): string {
  const hex = (n: number) => Math.floor(rand() * 16 ** n).toString(16).padStart(n, '0');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${((Math.floor(rand() * 4) + 8).toString(16))}${hex(3)}-${hex(8)}${hex(4)}`;
}

export type NewPacketInput = {
  type: MeshPacketType;
  origin: string;
  payload: string;
  recipient?: string;
  nonce?: string;
  ttl?: number;
  id?: string;
  originTimestamp?: number;
};

export function createPacket(input: NewPacketInput): MeshPacket {
  return {
    id: input.id ?? newPacketId(),
    type: input.type,
    ttl: input.ttl ?? config.defaultTtl,
    origin: input.origin,
    payload: input.payload,
    recipient: input.recipient,
    nonce: input.nonce,
    originTimestamp: input.originTimestamp ?? Date.now(),
    hops: 0,
  };
}

// ---------------------------------------------------------------------------
// Wire encoding — compact, versioned JSON packed into base64 so it survives
// BLE characteristic transport. Kept small; BLE MTU is limited.
// ---------------------------------------------------------------------------

type WireArray = [
  number, // version
  string, // id
  MeshPacketType, // type
  number, // ttl
  string, // origin
  string, // payload
  number, // originTimestamp
  string, // recipient ('' if none)
  string, // nonce ('' if none)
  number?, // hops travelled so far (absent on older builds)
];

export function encodePacket(p: MeshPacket): string {
  const arr: WireArray = [
    WIRE_VERSION,
    p.id,
    p.type,
    p.ttl,
    p.origin,
    p.payload,
    p.originTimestamp,
    p.recipient ?? '',
    p.nonce ?? '',
    p.hops ?? 0,
  ];
  return naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(arr)));
}

const VALID_TYPES: MeshPacketType[] = [
  'SOS',
  'CHAT',
  'NOTE',
  'ACK',
  'PRESENCE',
  'PAIR',
  'GROUP',
  'CALL',
  'TYPING',
];

export function decodePacket(wire: string): MeshPacket | null {
  try {
    const json = naclUtil.encodeUTF8(naclUtil.decodeBase64(wire));
    const arr = JSON.parse(json) as WireArray;
    if (!Array.isArray(arr) || arr[0] !== WIRE_VERSION) {
      return null;
    }
    const [, id, type, ttl, origin, payload, ts, recipient, nonce, hops] = arr;
    if (typeof id !== 'string' || !VALID_TYPES.includes(type)) {
      return null;
    }
    if (typeof ttl !== 'number' || ttl < 0 || ttl > 64) {
      return null;
    }
    if (typeof origin !== 'string' || typeof payload !== 'string') {
      return null;
    }
    return {
      id,
      type,
      ttl,
      origin,
      payload,
      originTimestamp: typeof ts === 'number' ? ts : 0,
      recipient: recipient || undefined,
      nonce: nonce || undefined,
      hops: typeof hops === 'number' && hops >= 0 && hops < 64 ? hops : 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Seen cache — a bounded LRU set of packet ids. Prevents re-broadcast storms
// and infinite loops in the flood mesh.
// ---------------------------------------------------------------------------

export class SeenCache {
  private set = new Set<string>();
  private order: string[] = [];

  constructor(private capacity: number = config.seenCacheSize) {}

  /** Returns true if this id is new (and records it); false if already seen. */
  markIfNew(id: string): boolean {
    if (this.set.has(id)) {
      return false;
    }
    this.set.add(id);
    this.order.push(id);
    if (this.order.length > this.capacity) {
      const evicted = this.order.shift();
      if (evicted !== undefined) {
        this.set.delete(evicted);
      }
    }
    return true;
  }

  has(id: string): boolean {
    return this.set.has(id);
  }

  get size(): number {
    return this.set.size;
  }
}

// ---------------------------------------------------------------------------
// Relay decision
// ---------------------------------------------------------------------------

/** Should we re-broadcast this packet onward? */
export function shouldRelay(packet: MeshPacket, selfKey: string): boolean {
  if (packet.ttl <= 0) {
    return false; // exhausted hops
  }
  if (packet.origin === selfKey) {
    return false; // don't relay our own echo
  }
  if (packet.recipient && packet.recipient === selfKey) {
    return false; // it's for us — deliver, don't forward
  }
  return true;
}

/** Produce the outgoing copy with one hop consumed. */
export function prepareRelay(packet: MeshPacket): MeshPacket {
  return {...packet, ttl: packet.ttl - 1, hops: (packet.hops ?? 0) + 1};
}

/** Is this packet addressed to, or broadcast toward, this node? */
export function isForSelf(packet: MeshPacket, selfKey: string): boolean {
  return !packet.recipient || packet.recipient === selfKey;
}
