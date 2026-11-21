/**
 * Group messages with NO Bluetooth/Wi-Fi link between the phones — only the internet. This used to fail: a group message
 * was a broadcast with no named receiver, and the internet carries only person-to-person packets.
 * A is the admin. B and C are each connected to A, but NOT to each other.
 */
import {Bus, makePhone} from '@/testing/meshHarness';
import {FakeRelayHub, FakeRtcHub} from '@/testing/fakeNet';

const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);

async function setup() {
  const bus = new Bus(); // never linked
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
  A.pairing.setState({paired: [B, C].map(o => ({publicKey: o.pub, name: `Phone ${o.id}`, pairedAt: 1}))});
  B.pairing.setState({paired: [{publicKey: A.pub, name: 'Phone A', pairedAt: 1}]});
  C.pairing.setState({paired: [{publicKey: A.pub, name: 'Phone A', pairedAt: 1}]});
  await tick(50);
  return {A, B, C};
}

const texts = (p: any, conv: string) => ((p.chat.getState().byConversation[conv] ?? []) as {text?: string}[]).map(m => m.text);

describe('groups over the internet only', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('invites arrive, "joined" reaches the admin, and messages reach everybody — even people not connected to each other', async () => {
    const {A, B, C} = await setup();
    const g = A.groups.getState().create('Trail crew', [B.pub, C.pub]);
    await tick(4000);
    expect(B.groups.getState().pendingInvites.map((i: {id: string}) => i.id)).toContain(g.id);
    B.groups.getState().accept(g.id);
    C.groups.getState().accept(g.id);
    await tick(4000);

    // the admin now sees both as joined (this notice used to be a broadcast and never arrived)
    expect(A.groups.getState().get(g.id)?.joined).toEqual(expect.arrayContaining([B.pub, C.pub]));
    // B and C learn about each other joining too
    expect(B.groups.getState().get(g.id)?.joined).toContain(C.pub);

    await A.chat.getState().sendText(g.id, 'group', 'hello team');
    await tick(4000);
    expect(texts(B, g.id)).toContain('hello team');
    expect(texts(C, g.id)).toContain('hello team');

    // B → C: they are not connected to each other, but are in the same group
    await B.chat.getState().sendText(g.id, 'group', 'from B');
    await tick(4000);
    expect(texts(C, g.id)).toContain('from B');
    expect(texts(A, g.id)).toContain('from B');
  });

  it('a message sent while someone is away waits and arrives later', async () => {
    const {A, B, C} = await setup();
    const g = A.groups.getState().create('Trail crew', [B.pub, C.pub]);
    await tick(4000);
    B.groups.getState().accept(g.id);
    C.groups.getState().accept(g.id);
    await tick(4000);

    await C.internet.setEnabled(false); // C goes offline
    await tick(200);
    await A.chat.getState().sendText(g.id, 'group', 'while you were away');
    await tick(3000);
    expect(texts(B, g.id)).toContain('while you were away');
    expect(texts(C, g.id)).not.toContain('while you were away');

    await C.internet.setEnabled(true);
    await tick(40_000);
    expect(texts(C, g.id)).toContain('while you were away'); // the sender kept trying, only for C
    expect(texts(B, g.id).filter(t => t === 'while you were away')).toHaveLength(1); // B didn't get it twice
  });

  it('ticks: delivered once everybody has it, seen once everybody has read it; Message info can say who', async () => {
    const {A, B, C} = await setup();
    const g = A.groups.getState().create('Trail crew', [B.pub, C.pub]);
    await tick(4000);
    B.groups.getState().accept(g.id);
    C.groups.getState().accept(g.id);
    await tick(4000);

    await A.chat.getState().sendText(g.id, 'group', 'who is in?');
    await tick(4000);
    const mine = () => (A.chat.getState().byConversation[g.id] as any[]).find(m => m.text === 'who is in?');
    expect(mine().status).toBe('delivered');
    expect(Object.keys(mine().acks).sort()).toEqual([B.pub, C.pub].sort());
    expect(Object.keys(A.chat.getState().outbox)).toHaveLength(0); // nothing left to resend

    B.chat.getState().markSeen(g.id, 'group');
    await tick(3000);
    expect(mine().status).toBe('delivered'); // C hasn't read it yet
    expect(mine().acks[B.pub].s).toBeGreaterThan(0);
    expect(mine().acks[C.pub].s).toBeUndefined();

    C.chat.getState().markSeen(g.id, 'group');
    await tick(3000);
    expect(mine().status).toBe('seen');
  });
});
