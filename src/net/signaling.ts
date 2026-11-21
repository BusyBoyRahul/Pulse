import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {sha256} from '@noble/hashes/sha256';
import {boxTo, openBox} from '@/services/crypto';
import {KIND_MAIL, RelayPool, newKey, signEvent} from './nostr';

/**
 * Private notes between two Pulse phones, carried by public relays.
 *
 * Each note is end-to-end encrypted to ONE phone (the relay sees only scrambled
 * bytes), is signed by a throw-away key (so relays cannot link your notes), and
 * is addressed to a "mailbox tag" that is a hash of the receiver's Pulse key.
 * It sets up direct connections and calls, and also carries a message (already end-to-end encrypted) right away
 * while a direct link is still being opened.
 */
export type Identity = {publicKey: string; secretKey: string};

const MAX_AGE_S = 120;

export const mailboxTag = (pulseKey: string): string =>
  naclUtil.encodeBase64(sha256(naclUtil.decodeUTF8(`pulse-box|${pulseKey}`)).slice(0, 16)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

type Handler = (from: string, payload: Record<string, unknown>) => void;

export class Signaling {
  private handlers = new Set<Handler>();
  private stopSub: (() => void) | null = null;

  constructor(private pool: RelayPool, private me: () => Identity) {}

  start(): void {
    if (this.stopSub) {
      return;
    }
    this.stopSub = this.pool.subscribe(
      [{kinds: [KIND_MAIL], '#t': [mailboxTag(this.me().publicKey)], since: Math.floor(Date.now() / 1000) - MAX_AGE_S}],
      e => this.receive(e.content, e.created_at),
    );
  }

  stop(): void {
    this.stopSub?.();
    this.stopSub = null;
  }

  onSignal(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  /** Send a private note to one phone. False if no relay is reachable right now. */
  send(toKey: string, payload: Record<string, unknown>): boolean {
    const me = this.me();
    const {cipher, nonce} = boxTo(JSON.stringify({...payload, at: Date.now()}), toKey, me.secretKey);
    const body = JSON.stringify({f: me.publicKey, n: nonce, c: cipher});
    const ev = signEvent(newKey(), {kind: KIND_MAIL, tags: [['t', mailboxTag(toKey)]], content: body});
    return this.pool.publish(ev);
  }

  private receive(content: string, createdAt: number): void {
    if (Math.floor(Date.now() / 1000) - createdAt > MAX_AGE_S) {
      return;
    }
    try {
      const m = JSON.parse(content) as {f: string; n: string; c: string};
      if (typeof m.f !== 'string' || m.f === this.me().publicKey) {
        return;
      }
      const text = openBox(m.c, m.n, m.f, this.me().secretKey);
      if (!text) {
        return; // not for us, or forged
      }
      const payload = JSON.parse(text) as Record<string, unknown>;
      if (typeof payload.at !== 'number' || Math.abs(Date.now() - payload.at) > MAX_AGE_S * 1000) {
        return; // stale
      }
      this.handlers.forEach(h => h(m.f, payload));
    } catch {
      /* junk on a public relay — ignore */
    }
  }
}

export const randomId = (): string => naclUtil.encodeBase64(nacl.randomBytes(9)).replace(/[+/=]/g, 'x');
