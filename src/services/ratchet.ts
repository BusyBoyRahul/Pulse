import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

/**
 * Signal-style Double Ratchet, built only from primitives Pulse already ships
 * (tweetnacl: X25519 + SHA-512 + XSalsa20-Poly1305). No new library.
 *
 *  - Every message gets its own key. The key is thrown away after use, so a
 *    phone stolen tomorrow cannot read yesterday's messages (forward secrecy).
 *  - Every time the conversation changes direction, fresh Diffie-Hellman keys
 *    are mixed in, so even a leaked key stops working after a reply
 *    (post-compromise security / "self-healing").
 *  - Messages may arrive late or out of order (the mesh does that all the
 *    time): keys for skipped messages are kept for a while.
 *
 * This file is pure (no storage, no radio) so it is fully unit-tested.
 */

const {box, secretbox, randomBytes, scalarMult, hash} = nacl;
const {encodeBase64, decodeBase64, decodeUTF8, encodeUTF8} = naclUtil;

/** How far ahead of the newest message we are willing to skip (big files = many pieces). */
export const MAX_SKIP = 1500;
/** Skipped-message keys kept for late arrivals. */
export const MAX_STORED_SKIPPED = 1500;

export type RatchetState = {
  rk: string; // root key
  dhsPub: string; // my current ratchet key pair
  dhsSec: string;
  dhr: string | null; // their current ratchet public key
  cks: string | null; // sending chain key
  ckr: string | null; // receiving chain key
  ns: number; // messages sent in this chain
  nr: number; // messages received in this chain
  pn: number; // length of my previous sending chain
  skipped: Record<string, string>; // `${dhr}:${n}` -> message key
  skippedOrder: string[];
};

// ---- small crypto helpers ---------------------------------------------------

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** HMAC-SHA512 (RFC 2104) on top of tweetnacl's SHA-512. */
export function hmac512(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const B = 128;
  const k = key.length > B ? hash(key) : key;
  const ipad = new Uint8Array(B);
  const opad = new Uint8Array(B);
  for (let i = 0; i < B; i++) {
    const b = i < k.length ? k[i] : 0;
    ipad[i] = b ^ 0x36;
    opad[i] = b ^ 0x5c;
  }
  return hash(concat(opad, hash(concat(ipad, msg))));
}

const INFO_RK = decodeUTF8('pulse/ratchet/rk/v1');

function kdfRoot(rk: Uint8Array, dhOut: Uint8Array): {rk: Uint8Array; ck: Uint8Array} {
  const out = hmac512(rk, concat(dhOut, INFO_RK));
  return {rk: out.slice(0, 32), ck: out.slice(32, 64)};
}

function kdfChain(ck: Uint8Array): {ck: Uint8Array; mk: Uint8Array} {
  return {
    mk: hmac512(ck, new Uint8Array([1])).slice(0, 32),
    ck: hmac512(ck, new Uint8Array([2])).slice(0, 32),
  };
}

const dh = (sec: string, pub: string) => scalarMult(decodeBase64(sec), decodeBase64(pub));

// ---- session setup (triple Diffie-Hellman, authenticated by identity keys) ---

export type KeyPair = {pub: string; sec: string};

export function newEphemeral(): KeyPair {
  const k = box.keyPair();
  return {pub: encodeBase64(k.publicKey), sec: encodeBase64(k.secretKey)};
}

const INFO_SK = decodeUTF8('pulse/handshake/v1');

/**
 * The shared secret both phones compute independently.
 *   initiator: DH(IKi, EKr) | DH(EKi, IKr) | DH(EKi, EKr)
 *   responder: the same three values, from the other side.
 * Mixing the long-term identity keys proves who each side is; the ephemeral
 * keys (deleted afterwards) give forward secrecy.
 */
export function handshakeSecret(args: {
  role: 'init' | 'resp';
  myIdentitySecret: string;
  theirIdentityPublic: string;
  myEphemeral: KeyPair;
  theirEphemeralPublic: string;
}): Uint8Array {
  const {role, myIdentitySecret, theirIdentityPublic, myEphemeral, theirEphemeralPublic} = args;
  const a = dh(myIdentitySecret, theirEphemeralPublic); // init: IKi·EKr   resp: IKr·EKi
  const b = dh(myEphemeral.sec, theirIdentityPublic); // init: EKi·IKr   resp: EKr·IKi
  const c = dh(myEphemeral.sec, theirEphemeralPublic);
  // Order the two identity terms the same way on both sides.
  const [first, second] = role === 'init' ? [a, b] : [b, a];
  return hash(concat(first, second, c, INFO_SK)).slice(0, 32);
}

/** Initiator: knows the responder's ephemeral key, so it can send immediately. */
export function initInitiator(sk: Uint8Array, theirRatchetPublic: string): RatchetState {
  const pair = newEphemeral();
  const {rk, ck} = kdfRoot(sk, dh(pair.sec, theirRatchetPublic));
  return {
    rk: encodeBase64(rk),
    dhsPub: pair.pub,
    dhsSec: pair.sec,
    dhr: theirRatchetPublic,
    cks: encodeBase64(ck),
    ckr: null,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: {},
    skippedOrder: [],
  };
}

/** Responder: starts with the ephemeral pair it handed out; can send after it hears from the initiator. */
export function initResponder(sk: Uint8Array, ownRatchet: KeyPair): RatchetState {
  return {
    rk: encodeBase64(sk),
    dhsPub: ownRatchet.pub,
    dhsSec: ownRatchet.sec,
    dhr: null,
    cks: null,
    ckr: null,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: {},
    skippedOrder: [],
  };
}

export const canSend = (s: RatchetState) => s.cks !== null;

// ---- encrypt ----------------------------------------------------------------

/**
 * Seal one message. Returns the new state plus the wire text. The state passed
 * in is never modified.
 */
export function ratchetEncrypt(
  state: RatchetState,
  plaintext: string,
  sessionTag = '',
): {state: RatchetState; wire: string; messageKey: Uint8Array} | null {
  if (!state.cks) {
    return null;
  }
  const s: RatchetState = {...state, skipped: state.skipped, skippedOrder: state.skippedOrder};
  const step = kdfChain(decodeBase64(s.cks!));
  const n = s.ns;
  s.cks = encodeBase64(step.ck);
  s.ns = n + 1;
  const head = `${s.dhsPub}|${s.pn}|${n}`;
  const nonce = randomBytes(secretbox.nonceLength);
  // The header is repeated inside the sealed part, so tampering with it is detected.
  const ct = secretbox(decodeUTF8(`${head}\n${plaintext}`), nonce, step.mk);
  const wire = encodeBase64(
    decodeUTF8(JSON.stringify([sessionTag, s.dhsPub, s.pn, n, encodeBase64(nonce), encodeBase64(ct)])),
  );
  return {state: s, wire, messageKey: step.mk};
}

// ---- decrypt ----------------------------------------------------------------

export type Parsed = {tag: string; d: string; pn: number; n: number; nonce: string; ct: string};

export function parseWire(wire: string): Parsed | null {
  try {
    const a = JSON.parse(encodeUTF8(decodeBase64(wire))) as unknown[];
    if (!Array.isArray(a) || a.length !== 6) {
      return null;
    }
    const [tag, d, pn, n, nonce, ct] = a;
    if (
      typeof tag !== 'string' ||
      typeof d !== 'string' ||
      typeof nonce !== 'string' ||
      typeof ct !== 'string' ||
      !Number.isInteger(pn) ||
      !Number.isInteger(n) ||
      (pn as number) < 0 ||
      (n as number) < 0
    ) {
      return null;
    }
    return {tag, d, pn: pn as number, n: n as number, nonce, ct};
  } catch {
    return null;
  }
}

function openWith(p: Parsed, mk: Uint8Array): string | null {
  try {
    const pt = secretbox.open(decodeBase64(p.ct), decodeBase64(p.nonce), mk);
    if (!pt) {
      return null;
    }
    const text = encodeUTF8(pt);
    const head = `${p.d}|${p.pn}|${p.n}\n`;
    return text.startsWith(head) ? text.slice(head.length) : null;
  } catch {
    return null;
  }
}

function cloneState(s: RatchetState): RatchetState {
  return {...s, skipped: {...s.skipped}, skippedOrder: [...s.skippedOrder]};
}

function skipKeys(s: RatchetState, until: number): boolean {
  if (!s.ckr || !s.dhr) {
    return true;
  }
  if (until - s.nr > MAX_SKIP) {
    return false;
  }
  let ck = decodeBase64(s.ckr);
  while (s.nr < until) {
    const step = kdfChain(ck);
    ck = step.ck;
    const id = `${s.dhr}:${s.nr}`;
    s.skipped[id] = encodeBase64(step.mk);
    s.skippedOrder.push(id);
    s.nr += 1;
  }
  s.ckr = encodeBase64(ck);
  while (s.skippedOrder.length > MAX_STORED_SKIPPED) {
    const old = s.skippedOrder.shift()!;
    delete s.skipped[old];
  }
  return true;
}

/**
 * Open one message. On success returns the new state and the text; on ANY
 * failure returns null and the old state is untouched (a forged or damaged
 * message can never break a working conversation).
 */
export function ratchetDecrypt(
  state: RatchetState,
  p: Parsed,
): {state: RatchetState; text: string; messageKey: Uint8Array} | null {
  // 1. A message we skipped earlier.
  const sid = `${p.d}:${p.n}`;
  if (state.skipped[sid]) {
    const mk = decodeBase64(state.skipped[sid]);
    const text = openWith(p, mk);
    if (text === null) {
      return null;
    }
    const s = cloneState(state);
    delete s.skipped[sid];
    s.skippedOrder = s.skippedOrder.filter(x => x !== sid);
    return {state: s, text, messageKey: mk};
  }

  const s = cloneState(state);
  // 2. They moved to a new ratchet key: finish the old chain, then step the root.
  if (p.d !== s.dhr) {
    if (!skipKeys(s, p.pn)) {
      return null;
    }
    const first = kdfRoot(decodeBase64(s.rk), dh(s.dhsSec, p.d));
    s.pn = s.ns;
    s.ns = 0;
    s.nr = 0;
    s.dhr = p.d;
    s.ckr = encodeBase64(first.ck);
    const fresh = newEphemeral();
    const second = kdfRoot(first.rk, dh(fresh.sec, p.d));
    s.dhsPub = fresh.pub;
    s.dhsSec = fresh.sec;
    s.rk = encodeBase64(second.rk);
    s.cks = encodeBase64(second.ck);
  } else if (p.n < s.nr) {
    return null; // already used (a replay) and no stored key
  }
  // 3. Catch up inside the chain, then take this message's key.
  if (!skipKeys(s, p.n)) {
    return null;
  }
  const step = kdfChain(decodeBase64(s.ckr!));
  s.ckr = encodeBase64(step.ck);
  s.nr += 1;
  const text = openWith(p, step.mk);
  if (text === null) {
    return null;
  }
  return {state: s, text, messageKey: step.mk};
}

/** Short fingerprint of a key (for comparing out loud / in UI). */
export function fingerprint(a: string, b: string): string {
  const [lo, hi] = [a, b].sort();
  return encodeBase64(hash(decodeUTF8(`pulse-fp|${lo}|${hi}`)).slice(0, 8));
}
