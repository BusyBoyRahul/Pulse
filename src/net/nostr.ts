import {schnorr} from '@noble/curves/secp256k1';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex, hexToBytes, utf8ToBytes} from '@noble/hashes/utils';

/**
 * A tiny Nostr client — just enough to use free PUBLIC relays as a meeting point.
 *
 * Nostr relays are servers run by other people that pass small signed messages
 * around. Pulse uses them for two things only:
 *   1. the short "hello, here is how to reach me" exchange that sets up a direct
 *      phone-to-phone connection (everything inside is encrypted to the receiver), and
 *   2. an opt-in public directory (username / hashed number -> Pulse key).
 * Chats themselves never touch a relay. Nothing here is a server of yours.
 */
export type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export type Filter = {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
  [tag: `#${string}`]: string[] | undefined;
};

export const KIND_MAIL = 20077; // ephemeral: relays pass it on but do not keep it
export const KIND_DIRECTORY = 30078; // replaceable app data: relays keep the newest per (author, d-tag)

export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

// ---- events --------------------------------------------------------------------------------------

export function newKey(): Uint8Array {
  return schnorr.utils.randomPrivateKey();
}
export const publicOf = (sk: Uint8Array): string => bytesToHex(schnorr.getPublicKey(sk));

export function eventId(e: Omit<NostrEvent, 'id' | 'sig'>): string {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]))));
}

export function signEvent(sk: Uint8Array, e: {kind: number; tags: string[][]; content: string; created_at?: number}): NostrEvent {
  const base = {pubkey: publicOf(sk), created_at: e.created_at ?? Math.floor(Date.now() / 1000), kind: e.kind, tags: e.tags, content: e.content};
  const id = eventId(base);
  return {...base, id, sig: bytesToHex(schnorr.sign(hexToBytes(id), sk))};
}

export function verifyEvent(e: NostrEvent): boolean {
  try {
    if (typeof e.id !== 'string' || typeof e.sig !== 'string' || typeof e.pubkey !== 'string') {
      return false;
    }
    if (eventId(e) !== e.id) {
      return false;
    }
    return schnorr.verify(hexToBytes(e.sig), hexToBytes(e.id), hexToBytes(e.pubkey));
  } catch {
    return false;
  }
}

export function matches(f: Filter, e: NostrEvent): boolean {
  if (f.ids && !f.ids.includes(e.id)) {
    return false;
  }
  if (f.kinds && !f.kinds.includes(e.kind)) {
    return false;
  }
  if (f.authors && !f.authors.includes(e.pubkey)) {
    return false;
  }
  if (f.since !== undefined && e.created_at < f.since) {
    return false;
  }
  if (f.until !== undefined && e.created_at > f.until) {
    return false;
  }
  for (const [k, v] of Object.entries(f) as [string, unknown][]) {
    if (k.startsWith('#') && Array.isArray(v)) {
      const name = k.slice(1);
      const wanted = v as string[];
      if (!e.tags.some(t => t[0] === name && wanted.includes(t[1]))) {
        return false;
      }
    }
  }
  return true;
}

// ---- relay pool ---------------------------------------------------------------------------------

type WS = {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: {data: unknown}) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  readyState: number;
};
export type WSFactory = (url: string) => WS;

/** `seen` = the events THIS subscription already got, so the same event arriving from two relays (or again after a re-connect) is handled once. It is per subscription: a new search must see the events again. */
type Sub = {id: string; filters: Filter[]; onEvent: (e: NostrEvent, relay: string) => void; onEose?: () => void; seen: Set<string>; order: string[]};

type Conn = {url: string; ws: WS | null; open: boolean; tries: number; timer: ReturnType<typeof setTimeout> | null};

/**
 * Keeps connections to several relays, re-connects on its own, repeats every
 * active subscription after a re-connect, checks every signature, and drops duplicates.
 */
export class RelayPool {
  private conns = new Map<string, Conn>();
  private subs = new Map<string, Sub>();
  private running = false;
  private statusHandlers = new Set<(connected: number) => void>();
  private outbox: string[] = [];

  constructor(private relays: string[] = DEFAULT_RELAYS, private makeWs: WSFactory = u => new WebSocket(u) as unknown as WS) {}

  setRelays(urls: string[]): void {
    this.relays = urls;
    if (this.running) {
      this.stop();
      this.start();
    }
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.relays.forEach(u => this.connect(u));
  }

  stop(): void {
    this.running = false;
    for (const c of this.conns.values()) {
      if (c.timer) {
        clearTimeout(c.timer);
      }
      c.open = false;
      try {
        c.ws?.close();
      } catch {
        /* already closed */
      }
    }
    this.conns.clear();
    this.emitStatus();
  }

  get connected(): number {
    return [...this.conns.values()].filter(c => c.open).length;
  }

  onStatus(fn: (connected: number) => void): () => void {
    this.statusHandlers.add(fn);
    return () => this.statusHandlers.delete(fn);
  }

  private emitStatus() {
    const n = this.connected;
    this.statusHandlers.forEach(h => h(n));
  }

  private connect(url: string) {
    if (!this.running) {
      return;
    }
    const c: Conn = this.conns.get(url) ?? {url, ws: null, open: false, tries: 0, timer: null};
    this.conns.set(url, c);
    let ws: WS;
    try {
      ws = this.makeWs(url);
    } catch {
      this.retry(c);
      return;
    }
    c.ws = ws;
    ws.onopen = () => {
      c.open = true;
      c.tries = 0;
      this.emitStatus();
      for (const s of this.subs.values()) {
        ws.send(JSON.stringify(['REQ', s.id, ...s.filters]));
      }
      this.outbox.forEach(m => ws.send(m));
    };
    ws.onmessage = ev => this.onFrame(String(ev.data), url);
    const down = () => {
      if (c.ws !== ws) {
        return;
      }
      c.open = false;
      this.emitStatus();
      this.retry(c);
    };
    ws.onclose = down;
    ws.onerror = down;
  }

  private retry(c: Conn) {
    if (!this.running) {
      return;
    }
    c.tries += 1;
    const wait = Math.min(60_000, 1500 * 2 ** Math.min(c.tries, 6));
    if (c.timer) {
      clearTimeout(c.timer);
    }
    c.timer = setTimeout(() => this.connect(c.url), wait);
  }

  private onFrame(text: string, relay: string) {
    let m: unknown;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(m)) {
      return;
    }
    if (m[0] === 'EVENT' && typeof m[1] === 'string' && m[2]) {
      const sub = this.subs.get(m[1]);
      const e = m[2] as NostrEvent;
      if (!sub || sub.seen.has(e.id) || !verifyEvent(e)) {
        return;
      }
      if (!sub.filters.some(f => matches(f, e))) {
        return; // a relay sent something we did not ask for
      }
      sub.seen.add(e.id);
      sub.order.push(e.id);
      if (sub.order.length > 4000) {
        sub.seen.delete(sub.order.shift()!);
      }
      sub.onEvent(e, relay);
    } else if (m[0] === 'EOSE' && typeof m[1] === 'string') {
      this.subs.get(m[1])?.onEose?.();
    }
  }

  /** Send an event to every connected relay. True if at least one took it. */
  publish(e: NostrEvent): boolean {
    const msg = JSON.stringify(['EVENT', e]);
    let sent = false;
    for (const c of this.conns.values()) {
      if (c.open && c.ws) {
        try {
          c.ws.send(msg);
          sent = true;
        } catch {
          /* that relay just dropped */
        }
      }
    }
    return sent;
  }

  /** Listen for events. Returns a function that stops listening. */
  subscribe(filters: Filter[], onEvent: Sub['onEvent'], onEose?: () => void): () => void {
    const id = Math.random().toString(36).slice(2, 12);
    this.subs.set(id, {id, filters, onEvent, onEose, seen: new Set(), order: []});
    const req = JSON.stringify(['REQ', id, ...filters]);
    for (const c of this.conns.values()) {
      if (c.open && c.ws) {
        c.ws.send(req);
      }
    }
    return () => {
      this.subs.delete(id);
      for (const c of this.conns.values()) {
        if (c.open && c.ws) {
          try {
            c.ws.send(JSON.stringify(['CLOSE', id]));
          } catch {
            /* gone */
          }
        }
      }
    };
  }

  /** One-shot query: collect matching events until the relays say "that's all" (or the timeout). */
  query(filters: Filter[], timeoutMs = 5000): Promise<NostrEvent[]> {
    return new Promise(resolve => {
      const found = new Map<string, NostrEvent>();
      let eoseCount = 0;
      let done = false;
      const finish = () => {
        if (done) {
          return;
        }
        done = true;
        stop();
        clearTimeout(timer);
        resolve([...found.values()]);
      };
      const stop = this.subscribe(
        filters,
        e => found.set(e.id, e),
        () => {
          eoseCount += 1;
          if (eoseCount >= Math.max(1, this.connected)) {
            finish();
          }
        },
      );
      const timer = setTimeout(finish, timeoutMs);
    });
  }
}
