/**
 * Status updates end to end: A — B — C in a line (A and C never in range).
 * A and C are connected; B is a stranger who only relays.
 */
import {Bus, makePhone} from '@/testing/meshHarness';

const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);

async function setup() {
  const bus = new Bus();
  const A = makePhone('A', bus);
  const B = makePhone('B', bus);
  const C = makePhone('C', bus);
  await Promise.all([A, B, C].map(p => p.engine.start()));
  for (const p of [A, B, C]) {
    p.chat.getState().init();
    p.pairing.getState().init();
    p.groups.getState().init();
    p.status.getState().init();
  }
  A.pairing.setState({paired: [{publicKey: C.pub, name: 'Phone C', pairedAt: 1}]});
  C.pairing.setState({paired: [{publicKey: A.pub, name: 'Phone A', pairedAt: 1}]});
  bus.link('A', 'B');
  bus.link('B', 'C');
  return {bus, A, B, C};
}

describe('status updates', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reaches a connected person through a relay, and not the relay', async () => {
    const {A, B, C} = await setup();
    const id = A.status.getState().post({kind: 'text', text: 'Good morning', bg: 'c:#2F8BFF'});
    await tick(3000);
    const atC = C.status.getState().itemsOf(A.pub);
    expect(atC).toHaveLength(1);
    expect(atC[0].id).toBe(id);
    expect(atC[0].text).toBe('Good morning');
    expect(B.status.getState().itemsOf(A.pub)).toHaveLength(0);
    // It never turns up as a chat message.
    expect(C.chat.getState().byConversation[A.pub] ?? []).toHaveLength(0);
  });

  it('shows the poster who has seen it', async () => {
    const {A, C} = await setup();
    const id = A.status.getState().post({kind: 'text', text: 'hi', bg: 'c:#12B981'});
    await tick(3000);
    expect(C.status.getState().unseenCount(A.pub)).toBe(1);
    C.status.getState().markSeen(A.pub, id);
    await tick(3000);
    expect(C.status.getState().unseenCount(A.pub)).toBe(0);
    expect(A.status.getState().views[id]).toEqual([C.pub]);
  });

  it('can be deleted for everyone', async () => {
    const {A, C} = await setup();
    const id = A.status.getState().post({kind: 'text', text: 'oops', bg: 'c:#F0457E'});
    await tick(3000);
    expect(C.status.getState().itemsOf(A.pub)).toHaveLength(1);
    A.status.getState().remove(id);
    await tick(3000);
    expect(C.status.getState().itemsOf(A.pub)).toHaveLength(0);
    expect(A.status.getState().mine).toHaveLength(0);
  });

  it('disappears after 24 hours', async () => {
    const {A, C} = await setup();
    A.status.getState().post({kind: 'text', text: 'brb', bg: 'c:#F5A524'});
    await tick(3000);
    expect(C.status.getState().itemsOf(A.pub)).toHaveLength(1);
    jest.setSystemTime(Date.now() + 25 * 3600_000); // a day and an hour later
    await tick(61_000); // the next clean-up pass
    expect(C.status.getState().itemsOf(A.pub)).toHaveLength(0);
    expect(A.status.getState().mine).toHaveLength(0);
  });

  it('is not sent to someone you hide it from', async () => {
    const {A, C} = await setup();
    A.settings.getState().setApp({statusAudience: 'except'});
    A.prefs.getState().patch(C.pub, {hideStatus: true});
    A.status.getState().post({kind: 'text', text: 'secret plan', bg: 'c:#14B8C6'});
    await tick(3000);
    expect(C.status.getState().itemsOf(A.pub)).toHaveLength(0);
  });

  it('only reaches the people picked when set to "only share with"', async () => {
    const {A, C} = await setup();
    A.settings.getState().setApp({statusAudience: 'only'});
    A.status.getState().post({kind: 'text', text: 'nobody yet', bg: 'c:#14B8C6'});
    await tick(3000);
    expect(C.status.getState().itemsOf(A.pub)).toHaveLength(0); // nobody picked
    A.prefs.getState().patch(C.pub, {showStatus: true});
    A.status.getState().post({kind: 'text', text: 'just you', bg: 'c:#14B8C6'});
    await tick(3000);
    expect(C.status.getState().itemsOf(A.pub).map((i: {text?: string}) => i.text)).toEqual(['just you']);
  });

  it('ignores updates from a person you are not connected to', async () => {
    const {A, B} = await setup();
    // B is not paired with A, so A's phone should drop B's update even if it somehow arrived.
    A.status.getState().apply({k: 'st', id: 'x1', kind: 'text', text: 'spam', bg: 'c:#000000', at: Date.now(), exp: Date.now() + 1000}, B.pub);
    expect(A.status.getState().itemsOf(B.pub)).toHaveLength(0);
  });

  it('gives current updates to a connected person who comes into range later', async () => {
    const {bus, A, C} = await setup();
    bus.unlink('A', 'B');
    bus.unlink('B', 'C');
    A.status.getState().post({kind: 'text', text: 'while you were away', bg: 'c:#7C5CFF'});
    await tick(3000);
    expect(C.status.getState().itemsOf(A.pub)).toHaveLength(0);
    bus.link('A', 'B');
    bus.link('B', 'C');
    // They announce themselves, as phones do every few seconds.
    A.peers.setState({peers: {}});
    await tick(2000);
    A.peers.setState({peers: {[C.pub]: {publicKey: C.pub, name: 'Phone C', lastSeen: Date.now(), hops: 1}}});
    await tick(5000);
    expect(C.status.getState().itemsOf(A.pub)).toHaveLength(1);
  });
});
