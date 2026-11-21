import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {RelayPool} from '@/net/nostr';
import {Signaling, Identity} from '@/net/signaling';
import {Directory, isUsername, cleanUsername, phoneDTag} from '@/net/directory';
import {NumberCheck, SmsLike} from '@/net/numberCheck';
import {codeIn} from '@/services/smsVerify';
import {FakeRelayHub} from '@/testing/fakeNet';
import {Bus, makePhone} from '@/testing/meshHarness';
import {FakeRtcHub} from '@/testing/fakeNet';

const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);

function person() {
  const k = nacl.box.keyPair();
  return {publicKey: naclUtil.encodeBase64(k.publicKey), secretKey: naclUtil.encodeBase64(k.secretKey)} as Identity;
}

/** A phone's connection to the (fake) public relays. */
function online(hub: FakeRelayHub, me: Identity) {
  const pool = new RelayPool(['wss://r1.test', 'wss://r2.test'], hub.factory);
  pool.start();
  return {pool, me, dir: new Directory(pool, () => me), sig: new Signaling(pool, () => me)};
}

describe('finding people by username and number', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('knows what a username looks like', () => {
    expect(cleanUsername(' @Maya_Q ')).toBe('maya_q');
    expect(isUsername('@maya_q')).toBe(true);
    expect(isUsername('no')).toBe(false);
    expect(isUsername('has space')).toBe(false);
  });

  it('finds someone by @username, and stops finding them when they remove it', async () => {
    const hub = new FakeRelayHub();
    const maya = online(hub, person());
    const sam = online(hub, person());
    await tick(20);
    expect(maya.dir.publishUsername('@maya_q', 'Maya')).toBe(true);
    await tick(20);

    const q = sam.dir.findUsername('maya_q');
    await tick(50);
    const found = await q;
    expect(found).toHaveLength(1);
    expect(found[0].key).toBe(maya.me.publicKey);
    expect(found[0].name).toBe('Maya');

    maya.dir.removeUsername('maya_q');
    await tick(20);
    const again = sam.dir.findUsername('maya_q');
    await tick(50);
    expect(await again).toHaveLength(0);
  });

  it('never returns yourself', async () => {
    const hub = new FakeRelayHub();
    const maya = online(hub, person());
    await tick(20);
    maya.dir.publishUsername('maya_q', 'Maya');
    await tick(20);
    const q = maya.dir.findUsername('maya_q');
    await tick(50);
    expect(await q).toHaveLength(0);
  });

  it('when two people claim the same @username, the oldest claim owns it and search shows only that person', async () => {
    const hub = new FakeRelayHub();
    const mumbai = online(hub, person());
    const delhi = online(hub, person());
    const sam = online(hub, person());
    await tick(20);
    mumbai.dir.publishUsername('maya', 'Maya (Mumbai)', 1000);
    delhi.dir.publishUsername('maya', 'Maya (Delhi)', 2000);
    await tick(20);

    const q = sam.dir.findUsername('maya');
    await tick(50);
    const found = await q;
    expect(found).toHaveLength(1);
    expect(found[0].key).toBe(mumbai.me.publicKey);
    expect(found[0].name).toBe('Maya (Mumbai)');

    // The younger claimant searching the same name also gets the owner, not herself
    const own = delhi.dir.findUsername('maya');
    await tick(50);
    expect((await own)[0].key).toBe(mumbai.me.publicKey);
    // and the owner doesn't find herself
    const self = mumbai.dir.findUsername('maya');
    await tick(50);
    expect(await self).toHaveLength(0);
  });

  it('finds the same person every time you search, not only the first time', async () => {
    const hub = new FakeRelayHub();
    const maya = online(hub, person());
    const sam = online(hub, person());
    await tick(20);
    maya.dir.publishUsername('maya_q', 'Maya', 1000);
    await tick(20);
    for (let i = 0; i < 3; i++) {
      const q = sam.dir.findUsername('maya_q');
      await tick(50);
      expect(await q).toHaveLength(1);
    }
  });

  it('refreshing a record keeps the original claim time, so it never looks newer', async () => {
    const hub = new FakeRelayHub();
    const maya = online(hub, person());
    const rival = online(hub, person());
    const sam = online(hub, person());
    await tick(20);
    maya.dir.publishUsername('maya', 'Maya', 1000);
    await tick(20);
    // a later refresh (e.g. after reconnecting) passes the same "since"
    jest.setSystemTime(Date.now() + 60_000);
    maya.dir.publishUsername('maya', 'Maya', 1000);
    rival.dir.publishUsername('maya', 'Rival', 5000);
    await tick(20);

    const q = sam.dir.findUsername('maya');
    await tick(50);
    const found = await q;
    expect(found).toHaveLength(1);
    expect(found[0].key).toBe(maya.me.publicKey);
    expect(found[0].since).toBe(1000);
  });

  it('knows whether a name is taken, and counts my own fresh claim before the relays show it back', async () => {
    const hub = new FakeRelayHub();
    const maya = online(hub, person());
    const lee = online(hub, person());
    await tick(20);

    let free = lee.dir.isTakenByOthers('maya');
    await tick(50);
    expect(await free).toBe(false);

    maya.dir.publishUsername('maya', 'Maya', 5000);
    await tick(20);
    free = lee.dir.isTakenByOthers('maya');
    await tick(50);
    expect(await free).toBe(true);
    const mine = maya.dir.isTakenByOthers('maya'); // her own claim doesn't count as "taken"
    await tick(50);
    expect(await mine).toBe(false);

    // Lee's claim is older than Maya's: Lee owns it. Newer than Maya's: Maya owns it.
    let owner = lee.dir.ownerOf('maya', {since: 1000});
    await tick(50);
    expect((await owner)?.key).toBe(lee.me.publicKey);
    owner = lee.dir.ownerOf('maya', {since: 9000});
    await tick(50);
    expect((await owner)?.key).toBe(maya.me.publicKey);
  });

  it('matches phone numbers by hash only — the number is never published', async () => {
    const hub = new FakeRelayHub();
    const maya = online(hub, person());
    const sam = online(hub, person());
    await tick(20);
    maya.dir.publishPhone('+15551234567', 'Maya');
    await tick(20);
    expect(JSON.stringify(hub.seen)).not.toContain('5551234567');
    expect(hub.seen[0].tags[0][1]).toBe(phoneDTag('+15551234567'));

    const q = sam.dir.findNumbers(['+15551234567', '+15559999999']);
    await tick(100);
    const res = await q;
    expect(res.get('+15551234567')?.[0].key).toBe(maya.me.publicKey);
    expect(res.has('+15559999999')).toBe(false);
  });

  it('shows BOTH claimants when two people claim the same number', async () => {
    const hub = new FakeRelayHub();
    const real = online(hub, person());
    const liar = online(hub, person());
    const sam = online(hub, person());
    await tick(20);
    real.dir.publishPhone('+15551234567', 'Real');
    liar.dir.publishPhone('+15551234567', 'Liar');
    await tick(20);
    const q = sam.dir.findNumbers(['+15551234567']);
    await tick(100);
    expect((await q).get('+15551234567')).toHaveLength(2);
  });
});

describe('proving a number belongs to a key, with a text message and no server', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** A tiny phone network: a text sent to a number is delivered to whoever holds that SIM. */
  function textNetwork() {
    const sims = new Map<string, Array<(code: string) => void>>();
    const sent: {to: string; text: string}[] = [];
    const smsFor = (myNumber?: string): SmsLike => ({
      send: async (to, text) => {
        sent.push({to, text});
        const code = codeIn(text);
        setTimeout(() => (sims.get(to) ?? []).forEach(l => code && l(code)), 5);
        return true;
      },
      listen: onCode => {
        if (!myNumber) {
          return () => undefined;
        }
        const list = sims.get(myNumber) ?? [];
        list.push(onCode);
        sims.set(myNumber, list);
        return () => sims.set(myNumber, (sims.get(myNumber) ?? []).filter(l => l !== onCode));
      },
    });
    return {smsFor, sent};
  }

  async function setup() {
    const hub = new FakeRelayHub();
    const net = textNetwork();
    const searcher = online(hub, person());
    const owner = online(hub, person()); // really has +1555…
    const liar = online(hub, person()); // claims the same number but has no such SIM
    const sig = [searcher, owner, liar].map(p => p.sig);
    sig.forEach(s => s.start());
    const checks = {
      searcher: new NumberCheck(searcher.sig, net.smsFor()),
      owner: new NumberCheck(owner.sig, net.smsFor('+15551234567')),
      liar: new NumberCheck(liar.sig, net.smsFor()),
    };
    Object.values(checks).forEach(c => c.start());
    await tick(30);
    return {searcher, owner, liar, checks, net};
  }

  it('confirms the real owner', async () => {
    const {owner, checks, net} = await setup();
    const p = checks.searcher.check(owner.me.publicKey, '+15551234567');
    await tick(2000);
    expect(await p).toBe('confirmed');
    expect(net.sent).toHaveLength(1); // exactly one text, from the searcher
    expect(net.sent[0].to).toBe('+15551234567');
  });

  it('rejects someone who only CLAIMS the number', async () => {
    const {liar, checks} = await setup();
    const p = checks.searcher.check(liar.me.publicKey, '+15551234567');
    await tick(130_000);
    expect(await p).toBe('failed');
  });

  it('does not answer people it was not asked by, and only once in a while', async () => {
    const {owner, searcher, checks, net} = await setup();
    const first = checks.searcher.check(owner.me.publicKey, '+15551234567');
    await tick(2000);
    expect(await first).toBe('confirmed');
    const second = checks.searcher.check(owner.me.publicKey, '+15551234567');
    await tick(130_000);
    expect(await second).toBe('failed'); // the owner's phone declines to listen again so soon
    expect(net.sent.length).toBe(2);
    expect(searcher.me.publicKey).not.toBe(owner.me.publicKey);
  });
});

describe('connecting with someone over the internet before you are linked', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a connect request reaches a person who is nowhere near, and they can accept', async () => {
    const bus = new Bus();
    const relay = new FakeRelayHub();
    const rtc = new FakeRtcHub();
    const A = makePhone('A', bus, {relay, rtc});
    const B = makePhone('B', bus, {relay, rtc});
    await Promise.all([A, B].map(p => p.engine.start()));
    for (const p of [A, B]) {
      p.chat.getState().init();
      p.pairing.getState().init();
    }
    await tick(50);
    A.pairing.getState().request({publicKey: B.pub, name: 'Phone B', lastSeen: Date.now(), hops: 0});
    await tick(3000);
    const incoming = B.pairing.getState().incoming;
    expect(incoming).toHaveLength(1);
    expect(incoming[0].publicKey).toBe(A.pub);

    B.pairing.getState().accept(incoming[0]);
    await tick(5000);
    expect(A.pairing.getState().isPaired(B.pub)).toBe(true);
    expect(B.pairing.getState().isPaired(A.pub)).toBe(true);

    // …and now they can chat, still with no Bluetooth/Wi-Fi.
    await A.chat.getState().sendText(B.pub, 'direct', 'we are connected!');
    await tick(20_000);
    expect(((B.chat.getState().byConversation[A.pub] ?? []) as {text?: string}[]).some(m => m.text === 'we are connected!')).toBe(true);
  });
});
