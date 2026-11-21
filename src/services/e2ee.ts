import {getIdentity} from './identity';
import {getJSON, setJSON} from './storage';
import {
  RatchetState,
  KeyPair,
  newEphemeral,
  handshakeSecret,
  initInitiator,
  initResponder,
  ratchetEncrypt,
  ratchetDecrypt,
  parseWire,
  canSend as stateCanSend,
} from './ratchet';

/**
 * Session manager for end-to-end encrypted chats.
 *
 * One "session" = one Double Ratchet between me and one person. Normal chats
 * use the person's public key as the session id; secret chats use `sc:<id>` so
 * each secret chat has its own, separate keys.
 *
 * To survive a stranger forging a handshake in someone's name, a new session
 * never replaces a working one until a message really decrypts under it
 * (`nxt` -> `cur`).
 */
/** Secret chats use a conversation id of `sc:<random>`; it is also their session id. */
export const SECRET_PREFIX = 'sc:';
export const isSecretId = (conversationId: string): boolean => conversationId.startsWith(SECRET_PREFIX);

const KEY = 'chat.sessions'; // under "chat." => encrypted at rest by Android Keystore
const PENDING_MAX_AGE = 24 * 60 * 60 * 1000;

type Rec = {state: RatchetState; role: 'init' | 'resp'; ekI?: string; at: number};
type Entry = {
  peerKey: string;
  cur?: Rec;
  nxt?: Rec;
  /** My ephemeral key waiting for the other side's reply. */
  pend?: {pair: KeyPair; at: number};
  /** Responder: the ephemeral key I handed out for a given initiator key (so a resent request gets the same answer). */
  ekR?: {for: string; pair: KeyPair};
};
type Db = Record<string, Entry>;

let db: Db | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function load(): Db {
  if (!db) {
    db = getJSON<Db>(KEY, {});
  }
  return db;
}

/** Save soon. Batched, because a big file moves thousands of tiny messages. */
function persist(now = false) {
  if (now) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    setJSON(KEY, load());
    return;
  }
  if (timer) {
    return;
  }
  timer = setTimeout(() => {
    timer = null;
    setJSON(KEY, load());
  }, 1200);
}

/** Write pending changes immediately (call when the app goes to the background). */
export function flushSessions(): void {
  if (timer) {
    persist(true);
  }
}

function entry(sessionId: string): Entry | undefined {
  return load()[sessionId];
}

const sendable = (r?: Rec) => !!r && stateCanSend(r.state);

export const e2ee = {
  /** Is there a ratchet (even one that can't send yet) with this session id? */
  hasSession(sessionId: string): boolean {
    const e = entry(sessionId);
    return !!(e?.cur || e?.nxt);
  },

  /** Can I send an encrypted message right now? */
  canSend(sessionId: string): boolean {
    const e = entry(sessionId);
    return !!e && (sendable(e.nxt) || sendable(e.cur));
  },

  /** Is a handshake I started still waiting for an answer? */
  isPending(sessionId: string): boolean {
    const p = entry(sessionId)?.pend;
    return !!p && Date.now() - p.at < PENDING_MAX_AGE;
  },

  /** Step 1 (initiator): the ephemeral public key to send. Re-used until answered. */
  beginHandshake(sessionId: string, peerKey: string): string {
    const d = load();
    const e = d[sessionId] ?? (d[sessionId] = {peerKey});
    e.peerKey = peerKey;
    if (!e.pend || Date.now() - e.pend.at > PENDING_MAX_AGE) {
      e.pend = {pair: newEphemeral(), at: Date.now()};
      persist(true);
    }
    return e.pend.pair.pub;
  },

  /** Step 2 (responder): turn their ephemeral key into a session; returns MY ephemeral key to send back. */
  acceptHandshake(sessionId: string, peerKey: string, ekI: string): string {
    const d = load();
    const e = d[sessionId] ?? (d[sessionId] = {peerKey});
    e.peerKey = peerKey;
    // A resent request: same answer, no second session.
    if (e.ekR && e.ekR.for === ekI) {
      return e.ekR.pair.pub;
    }
    const mine = newEphemeral();
    const sk = handshakeSecret({
      role: 'resp',
      myIdentitySecret: getIdentity().secretKey,
      theirIdentityPublic: peerKey,
      myEphemeral: mine,
      theirEphemeralPublic: ekI,
    });
    const rec: Rec = {state: initResponder(sk, mine), role: 'resp', ekI, at: Date.now()};
    e.ekR = {for: ekI, pair: mine};
    if (!e.cur) {
      e.cur = rec; // first ever session: nothing to protect yet
    } else {
      e.nxt = rec; // replaces a working session only once a message proves it
    }
    persist(true);
    return mine.pub;
  },

  /** Step 3 (initiator): the answer arrived. True when a new session was made. */
  completeHandshake(sessionId: string, ekIRef: string, ekR: string): boolean {
    const e = entry(sessionId);
    if (!e?.pend || e.pend.pair.pub !== ekIRef) {
      return false; // not what we asked for (stale or forged)
    }
    const sk = handshakeSecret({
      role: 'init',
      myIdentitySecret: getIdentity().secretKey,
      theirIdentityPublic: e.peerKey,
      myEphemeral: e.pend.pair,
      theirEphemeralPublic: ekR,
    });
    const rec: Rec = {state: initInitiator(sk, ekR), role: 'init', ekI: ekIRef, at: Date.now()};
    if (!e.cur) {
      e.cur = rec;
    } else {
      e.nxt = rec;
    }
    e.pend = undefined; // the ephemeral secret is gone for good (forward secrecy)
    persist(true);
    return true;
  },

  /**
   * Encrypt for a session. Returns the wire text, or null when no session can
   * send yet (caller decides whether to wait or fall back).
   */
  encrypt(sessionId: string, plaintext: string): string | null {
    const e = entry(sessionId);
    if (!e) {
      return null;
    }
    // Prefer the newest session I started myself (the other side has it for sure).
    const useNxt = !!e.nxt && e.nxt.role === 'init' && sendable(e.nxt);
    const rec = useNxt ? e.nxt : sendable(e.cur) ? e.cur : sendable(e.nxt) ? e.nxt : undefined;
    if (!rec) {
      return null;
    }
    const tag = sessionId === e.peerKey ? '' : sessionId;
    const out = ratchetEncrypt(rec.state, plaintext, tag);
    if (!out) {
      return null;
    }
    rec.state = out.state;
    persist();
    return out.wire;
  },

  /** Which session a wire message belongs to (its tag), or the sender's key for normal chats. */
  sessionIdOf(wire: string, origin: string): string | null {
    const p = parseWire(wire);
    if (!p) {
      return null;
    }
    return p.tag || origin;
  },

  /** Decrypt. `origin` is who the packet claims to be from; the session must belong to them. */
  decrypt(origin: string, wire: string): {text: string; sessionId: string} | null {
    const p = parseWire(wire);
    if (!p) {
      return null;
    }
    const sessionId = p.tag || origin;
    const e = entry(sessionId);
    if (!e || e.peerKey !== origin) {
      return null;
    }
    if (e.nxt) {
      const r = ratchetDecrypt(e.nxt.state, p);
      if (r) {
        e.nxt.state = r.state;
        // The new session just proved itself: it takes over.
        e.cur = e.nxt;
        e.nxt = undefined;
        persist();
        return {text: r.text, sessionId};
      }
    }
    if (e.cur) {
      const r = ratchetDecrypt(e.cur.state, p);
      if (r) {
        e.cur.state = r.state;
        persist();
        return {text: r.text, sessionId};
      }
    }
    return null;
  },

  /** Forget a session (e.g. a secret chat was deleted). Keys are erased. */
  reset(sessionId: string): void {
    const d = load();
    if (d[sessionId]) {
      delete d[sessionId];
      persist(true);
    }
  },

  /** Forget everything (wipe). */
  resetAll(): void {
    db = {};
    persist(true);
  },

  /** For tests. */
  _reload(): void {
    db = null;
  },
};
