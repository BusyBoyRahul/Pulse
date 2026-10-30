import naclUtil from 'tweetnacl-util';
import {
  newPacketId,
  createPacket,
  encodePacket,
  decodePacket,
  SeenCache,
  shouldRelay,
  prepareRelay,
  isForSelf,
} from '../relayProtocol';

const b64 = (obj: unknown) => naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(obj)));

describe('relayProtocol — packet ids', () => {
  it('generates unique, well-formed ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = newPacketId();
      expect(id).toMatch(/^[0-9a-f-]{30,}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(1000);
  });
});

describe('relayProtocol — wire encoding', () => {
  it('round-trips a packet through encode/decode', () => {
    const p = createPacket({
      type: 'SOS',
      origin: 'AABBCCDD',
      payload: 'sealed-payload==',
      recipient: 'EEFF0011',
      nonce: 'nonce==',
      id: 'fixed-id',
      originTimestamp: 1720000000000,
    });
    const decoded = decodePacket(encodePacket(p));
    expect(decoded).toEqual(p);
  });

  it('rejects garbage and wrong-version frames', () => {
    expect(decodePacket('not-base64!!!')).toBeNull();
    expect(decodePacket(b64([99, 'x']))).toBeNull();
  });

  it('rejects out-of-range ttl', () => {
    expect(decodePacket(b64([1, 'id', 'SOS', 999, 'o', 'p', 0, '', '']))).toBeNull();
  });
});

describe('relayProtocol — SeenCache', () => {
  it('reports new ids once, then treats them as seen', () => {
    const c = new SeenCache(3);
    expect(c.markIfNew('a')).toBe(true);
    expect(c.markIfNew('a')).toBe(false);
    expect(c.markIfNew('b')).toBe(true);
  });

  it('evicts oldest beyond capacity', () => {
    const c = new SeenCache(2);
    c.markIfNew('a');
    c.markIfNew('b');
    c.markIfNew('c'); // evicts 'a'
    expect(c.has('a')).toBe(false);
    expect(c.has('b')).toBe(true);
    expect(c.markIfNew('a')).toBe(true); // 'a' is new again
  });
});

describe('relayProtocol — relay decision', () => {
  const base = createPacket({type: 'CHAT', origin: 'SENDER', payload: 'x', ttl: 3});

  it('does not relay exhausted ttl', () => {
    expect(shouldRelay({...base, ttl: 0}, 'ME')).toBe(false);
  });
  it('does not relay our own echo', () => {
    expect(shouldRelay({...base, origin: 'ME'}, 'ME')).toBe(false);
  });
  it('does not relay a packet addressed to us', () => {
    expect(shouldRelay({...base, recipient: 'ME'}, 'ME')).toBe(false);
  });
  it('relays a broadcast with ttl remaining', () => {
    expect(shouldRelay(base, 'ME')).toBe(true);
  });
  it('decrements ttl on relay', () => {
    expect(prepareRelay(base).ttl).toBe(2);
  });
  it('treats broadcasts and self-addressed packets as for-self', () => {
    expect(isForSelf(base, 'ME')).toBe(true);
    expect(isForSelf({...base, recipient: 'ME'}, 'ME')).toBe(true);
    expect(isForSelf({...base, recipient: 'OTHER'}, 'ME')).toBe(false);
  });
});
