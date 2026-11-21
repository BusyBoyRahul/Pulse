/**
 * Chat over the internet with NO Bluetooth/Wi-Fi link between the phones, through
 * fake public relays and a fake WebRTC. A and C are connected people; B is a stranger.
 */
import {Bus, makePhone} from '@/testing/meshHarness';
import {FakeRelayHub, FakeRtcHub} from '@/testing/fakeNet';

const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);

async function setup(opts: {startC?: boolean} = {}) {
  const bus = new Bus(); // never linked: the radios cannot reach each other
  const relay = new FakeRelayHub();
  const rtc = new FakeRtcHub();
  const A = makePhone('A', bus, {relay, rtc});
  const B = makePhone('B', bus, {relay, rtc});
  const C = makePhone('C', bus, {relay, rtc});
  const phones = [A, B, C];
  await Promise.all(phones.map(p => p.engine.start()));
  for (const p of phones) {
    p.chat.getState().init();
    p.pairing.getState().init();
    p.groups.getState().init();
  }
  A.pairing.setState({paired: [{publicKey: C.pub, name: 'Phone C', pairedAt: 1}]});
  C.pairing.setState({paired: [{publicKey: A.pub, name: 'Phone A', pairedAt: 1}]});
  if (opts.startC === false) {
    await C.internet.setEnabled(false);
  }
  await tick(50);
  return {bus, relay, rtc, A, B, C};
}

const texts = (p: any, conv: string) => ((p.chat.getState().byConversation[conv] ?? []) as {text?: string}[]).map(m => m.text);

describe('chat over the internet', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('delivers a message with no Bluetooth/Wi-Fi at all, and the tick comes back', async () => {
    const {A, C} = await setup();
    await A.chat.getState().sendText(C.pub, 'direct', 'hello over the internet');
    await tick(3000);
    expect(texts(C, A.pub)).toContain('hello over the internet');
    expect(A.chat.getState().byConversation[C.pub][0].status).toBe('delivered');
    expect(A.internet.links.isOpen(C.pub)).toBe(true);
    expect(C.internet.links.isOpen(A.pub)).toBe(true);
  });

  it('works both ways over the same link', async () => {
    const {A, C, rtc} = await setup();
    await A.chat.getState().sendText(C.pub, 'direct', 'ping');
    await tick(3000);
    const before = rtc.created;
    await C.chat.getState().sendText(A.pub, 'direct', 'pong');
    await tick(2000);
    expect(texts(A, C.pub)).toContain('pong');
    expect(rtc.created).toBe(before); // no second connection was needed
  });

  it('the relays only ever see scrambled bytes, never the message', async () => {
    const {A, C, relay} = await setup();
    await A.chat.getState().sendText(C.pub, 'direct', 'the password is swordfish');
    await tick(3000);
    const notes = [...new Map(relay.seen.map(e => [e.id, e])).values()]; // each note goes to every relay
    expect(notes.length).toBeGreaterThan(0);
    const everything = JSON.stringify(notes);
    expect(everything).not.toContain('swordfish');
    expect(everything).not.toContain('hello');
    for (const ev of notes) {
      expect(ev.tags.every(t => t[0] === 't')).toBe(true); // just a mailbox tag
    }
    // Throw-away signing keys: the relay can't tell that two notes came from the same phone.
    expect(new Set(notes.map(e => e.pubkey)).size).toBe(notes.length);
  });

  it('a stranger cannot open a link to you', async () => {
    const {A, B, rtc} = await setup();
    // B is not connected to A, but tries anyway.
    B.pairing.setState({paired: [{publicKey: A.pub, name: 'Phone A', pairedAt: 1}]});
    await B.chat.getState().sendText(A.pub, 'direct', 'let me in');
    await tick(5000);
    expect(A.internet.links.isOpen(B.pub)).toBe(false);
    expect(texts(A, B.pub)).toEqual([]);
    expect(rtc.created).toBeGreaterThan(0); // B tried; A just ignored it
  });

  it('a message waits for someone who is offline and arrives when they come online', async () => {
    const {A, C} = await setup({startC: false});
    await A.chat.getState().sendText(C.pub, 'direct', 'are you there?');
    await tick(5000);
    expect(texts(C, A.pub)).toEqual([]);
    expect(A.chat.getState().byConversation[C.pub][0].status).not.toBe('delivered');

    await C.internet.setEnabled(true);
    await tick(60_000); // the sender's retry schedule kicks in
    expect(texts(C, A.pub)).toContain('are you there?');
    expect(A.chat.getState().byConversation[C.pub][0].status).toBe('delivered');
  });

  it('survives every relay being down for a while', async () => {
    const {A, C, relay} = await setup();
    relay.setDown(true);
    await A.chat.getState().sendText(C.pub, 'direct', 'sent during an outage');
    await tick(8000);
    expect(texts(C, A.pub)).toEqual([]);
    relay.setDown(false);
    await tick(90_000);
    expect(texts(C, A.pub)).toContain('sent during an outage');
  });

  it('two people writing at the same moment still end up with one link and both messages', async () => {
    const {A, C} = await setup();
    await Promise.all([A.chat.getState().sendText(C.pub, 'direct', 'from A'), C.chat.getState().sendText(A.pub, 'direct', 'from C')]);
    await tick(30_000);
    expect(texts(C, A.pub)).toContain('from A');
    expect(texts(A, C.pub)).toContain('from C');
    expect(A.internet.links.isOpen(C.pub)).toBe(true);
  });

  it('switching the internet off stops it from carrying anything', async () => {
    const {A, C} = await setup();
    await A.internet.setEnabled(false);
    await A.chat.getState().sendText(C.pub, 'direct', 'should not go');
    await tick(5000);
    expect(texts(C, A.pub)).toEqual([]);
    expect(A.internet.state).toBe('idle');
  });
});
