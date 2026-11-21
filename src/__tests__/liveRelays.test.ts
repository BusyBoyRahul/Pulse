/**
 * LIVE check against the real public relays (needs internet). Skipped in normal runs;
 * run it with:   LIVE=1 npx jest src/__tests__/liveRelays.test.ts
 * It proves that our signed events, mailbox notes and directory records really work with
 * the relays other people run — not just with our in-memory fake.
 */
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {RelayPool, DEFAULT_RELAYS} from '@/net/nostr';
import {Signaling, Identity} from '@/net/signaling';
import {Directory} from '@/net/directory';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const live = (globalThis as any).process?.env?.LIVE ? describe : describe.skip;

function person(): Identity {
  const k = nacl.box.keyPair();
  return {publicKey: naclUtil.encodeBase64(k.publicKey), secretKey: naclUtil.encodeBase64(k.secretKey)};
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WS = require('ws');
const factory = (url: string) => new WS(url);
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

live('real public relays', () => {
  jest.setTimeout(60_000);

  async function connected(me: Identity) {
    const pool = new RelayPool(DEFAULT_RELAYS, factory as never);
    pool.start();
    for (let i = 0; i < 40 && pool.connected === 0; i++) {
      await wait(250);
    }
    return {pool, sig: new Signaling(pool, () => me), dir: new Directory(pool, () => me), me};
  }

  it('an encrypted note sent through the relays arrives and decrypts', async () => {
    const a = await connected(person());
    const b = await connected(person());
    expect(a.pool.connected).toBeGreaterThan(0);
    expect(b.pool.connected).toBeGreaterThan(0);
    b.sig.start();
    await wait(1500); // let the relays register the subscription

    const got: Array<{from: string; payload: Record<string, unknown>}> = [];
    b.sig.onSignal((from, payload) => got.push({from, payload}));
    a.sig.send(b.me.publicKey, {t: 'hello', n: 42});
    for (let i = 0; i < 40 && got.length === 0; i++) {
      await wait(250);
    }
    a.pool.stop();
    b.pool.stop();
    expect(got).toHaveLength(1);
    expect(got[0].from).toBe(a.me.publicKey);
    expect(got[0].payload.t).toBe('hello');
    expect(got[0].payload.n).toBe(42);
  });

  it('a directory record can be published and then found by someone else', async () => {
    const a = await connected(person());
    const b = await connected(person());
    const name = `pulse_test_${Math.random().toString(36).slice(2, 8)}`;
    expect(a.dir.publishUsername(name, 'Live Test')).toBe(true);
    await wait(2500);
    let found = await b.dir.findUsername(name);
    for (let i = 0; i < 4 && found.length === 0; i++) {
      await wait(1500);
      found = await b.dir.findUsername(name);
    }
    a.dir.removeUsername(name);
    await wait(1000);
    a.pool.stop();
    b.pool.stop();
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].key).toBe(a.me.publicKey);
    expect(found[0].name).toBe('Live Test');
  });
});
