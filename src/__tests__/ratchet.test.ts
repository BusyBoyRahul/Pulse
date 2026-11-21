import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {
  newEphemeral,
  handshakeSecret,
  initInitiator,
  initResponder,
  ratchetEncrypt,
  ratchetDecrypt,
  parseWire,
  hmac512,
  RatchetState,
  MAX_SKIP,
} from '@/services/ratchet';

const hex = (u: Uint8Array) => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('');
const same = (x: Uint8Array, y: Uint8Array) => hex(x) === hex(y);

const id = () => {
  const k = nacl.box.keyPair();
  return {pub: naclUtil.encodeBase64(k.publicKey), sec: naclUtil.encodeBase64(k.secretKey)};
};

/** Two phones that finished the handshake. */
function pair() {
  const alice = id();
  const bob = id();
  const ekA = newEphemeral();
  const ekB = newEphemeral();
  const skA = handshakeSecret({role: 'init', myIdentitySecret: alice.sec, theirIdentityPublic: bob.pub, myEphemeral: ekA, theirEphemeralPublic: ekB.pub});
  const skB = handshakeSecret({role: 'resp', myIdentitySecret: bob.sec, theirIdentityPublic: alice.pub, myEphemeral: ekB, theirEphemeralPublic: ekA.pub});
  return {alice, bob, skA, skB, a: initInitiator(skA, ekB.pub), b: initResponder(skB, ekB)};
}

function send(s: RatchetState, text: string) {
  const out = ratchetEncrypt(s, text);
  if (!out) {
    throw new Error('cannot send');
  }
  return out;
}
function recv(s: RatchetState, wire: string) {
  const p = parseWire(wire);
  if (!p) {
    throw new Error('bad wire');
  }
  return ratchetDecrypt(s, p);
}

describe('hmac512', () => {
  it('matches the RFC 4231 test case 1', () => {
    const key = new Uint8Array(20).fill(0x0b);
    const mac = hmac512(key, naclUtil.decodeUTF8('Hi There'));
    expect(hex(mac).startsWith('87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cde')).toBe(true);
  });
});

describe('handshake', () => {
  it('gives both phones the same secret', () => {
    const {skA, skB} = pair();
    expect(same(skA, skB)).toBe(true);
  });

  it('gives an impostor (wrong identity key) a different secret', () => {
    const alice = id();
    const bob = id();
    const mallory = id();
    const ekA = newEphemeral();
    const ekB = newEphemeral();
    const real = handshakeSecret({role: 'init', myIdentitySecret: alice.sec, theirIdentityPublic: bob.pub, myEphemeral: ekA, theirEphemeralPublic: ekB.pub});
    const fake = handshakeSecret({role: 'resp', myIdentitySecret: mallory.sec, theirIdentityPublic: alice.pub, myEphemeral: ekB, theirEphemeralPublic: ekA.pub});
    expect(same(real, fake)).toBe(false);
  });
});

describe('double ratchet', () => {
  it('talks both ways, many times', () => {
    let {a, b} = pair();
    for (let round = 0; round < 6; round++) {
      const m1 = send(a, `a${round}`);
      a = m1.state;
      const r1 = recv(b, m1.wire)!;
      expect(r1.text).toBe(`a${round}`);
      b = r1.state;
      const m2 = send(b, `b${round}`);
      b = m2.state;
      const r2 = recv(a, m2.wire)!;
      expect(r2.text).toBe(`b${round}`);
      a = r2.state;
    }
  });

  it('the responder cannot send until it has heard from the initiator', () => {
    const {b} = pair();
    expect(ratchetEncrypt(b, 'too early')).toBeNull();
  });

  it('opens messages that arrive out of order', () => {
    let {a, b} = pair();
    const msgs = ['one', 'two', 'three', 'four', 'five'].map(t => {
      const m = send(a, t);
      a = m.state;
      return {t, wire: m.wire};
    });
    for (const i of [3, 0, 4, 2, 1]) {
      const r = recv(b, msgs[i].wire)!;
      expect(r.text).toBe(msgs[i].t);
      b = r.state;
    }
  });

  it('survives a direction change with late messages from the old chain', () => {
    let {a, b} = pair();
    const m1 = send(a, 'first');
    a = m1.state;
    const m2 = send(a, 'second');
    a = m2.state;
    // b hears only the second, replies, then the first shows up late.
    let r = recv(b, m2.wire)!;
    b = r.state;
    const reply = send(b, 'reply');
    b = reply.state;
    r = recv(a, reply.wire)!;
    a = r.state;
    const late = recv(b, m1.wire)!;
    expect(late.text).toBe('first');
  });

  it('refuses a replay of an already-opened message', () => {
    let {a, b} = pair();
    const m = send(a, 'once');
    a = m.state;
    const r = recv(b, m.wire)!;
    b = r.state;
    expect(recv(b, m.wire)).toBeNull();
  });

  it('a damaged or forged message fails and does NOT disturb the session', () => {
    let {a, b} = pair();
    const m1 = send(a, 'good');
    a = m1.state;
    const parsed = parseWire(m1.wire)!;
    const ct = naclUtil.decodeBase64(parsed.ct);
    ct[ct.length - 1] ^= 1;
    const broken = naclUtil.encodeBase64(
      naclUtil.decodeUTF8(JSON.stringify(['', parsed.d, parsed.pn, parsed.n, parsed.nonce, naclUtil.encodeBase64(ct)])),
    );
    const before = JSON.stringify(b);
    expect(recv(b, broken)).toBeNull();
    expect(JSON.stringify(b)).toBe(before);
    expect(recv(b, m1.wire)!.text).toBe('good'); // the real one still opens
  });

  it('rejects a message whose header was changed (authenticated header)', () => {
    let {a, b} = pair();
    const m = send(a, 'hello');
    a = m.state;
    const p = parseWire(m.wire)!;
    const tampered = naclUtil.encodeBase64(
      naclUtil.decodeUTF8(JSON.stringify(['', p.d, p.pn, p.n + 1, p.nonce, p.ct])),
    );
    expect(recv(b, tampered)).toBeNull();
  });

  it('cannot read old messages from a stolen later state (forward secrecy)', () => {
    let {a, b} = pair();
    const old = send(a, 'secret from yesterday');
    a = old.state;
    let r = recv(b, old.wire)!;
    b = r.state;
    // They keep talking…
    for (let i = 0; i < 4; i++) {
      const m = send(b, `b${i}`);
      b = m.state;
      r = recv(a, m.wire)!;
      a = r.state;
      const n = send(a, `a${i}`);
      a = n.state;
      r = recv(b, n.wire)!;
      b = r.state;
    }
    // …then b's phone is stolen. The thief holds `b` but the old message's key is gone.
    expect(recv(b, old.wire)).toBeNull();
    expect(Object.keys(b.skipped)).toHaveLength(0);
  });

  it('refuses to skip an absurd number of messages', () => {
    let {a, b} = pair();
    let last = send(a, 'x');
    a = last.state;
    for (let i = 0; i < MAX_SKIP + 5; i++) {
      last = send(a, 'y');
      a = last.state;
    }
    expect(recv(b, last.wire)).toBeNull();
  });

  it('state survives being saved and loaded (JSON)', () => {
    let {a, b} = pair();
    const m = send(a, 'persist me');
    a = JSON.parse(JSON.stringify(m.state));
    b = JSON.parse(JSON.stringify(b));
    const r = recv(b, m.wire)!;
    expect(r.text).toBe('persist me');
    const back = send(r.state, 'got it');
    expect(recv(a, back.wire)!.text).toBe('got it');
  });

  it('two sessions with the same people but different handshakes cannot read each other', () => {
    const one = pair();
    const two = pair();
    const m = send(one.a, 'for session one');
    expect(recv(two.b, m.wire)).toBeNull();
  });
});
