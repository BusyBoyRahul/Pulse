/**
 * Messages pinned in a one-to-one chat: both people see them, a new pin never replaces an older one (no limit), either can unpin
 * one, a pin goes when its message is taken back, and none are kept in a chat whose messages vanish.
 */
import {Bus, makePhone} from '@/testing/meshHarness';

const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);

async function setup() {
  const bus = new Bus();
  const A = makePhone('A', bus);
  const B = makePhone('B', bus);
  await Promise.all([A, B].map(p => p.engine.start()));
  for (const p of [A, B]) {
    p.chat.getState().init();
    p.pairing.getState().init();
  }
  A.pairing.setState({paired: [{publicKey: B.pub, name: 'Phone B', pairedAt: 1}]});
  B.pairing.setState({paired: [{publicKey: A.pub, name: 'Phone A', pairedAt: 1}]});
  bus.link('A', 'B');
  await tick(200);
  return {A, B, bus};
}

const pinsOn = (p: any, peer: string): {mid: string; from: string; t: string; by: string}[] => p.prefs.getState().prefs[peer]?.pinMsgs ?? [];
const ids = (p: any, peer: string) => pinsOn(p, peer).map(x => x.mid);

async function send(A: any, B: any, text: string) {
  await A.chat.getState().sendText(B.pub, 'direct', text);
  await tick(300);
  const list = A.chat.getState().messages(B.pub);
  return list[list.length - 1].id as string;
}

describe('pinned messages in a one-to-one chat', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a new pin does not remove the older ones; both see them with the right writer; either can unpin one', async () => {
    const {A, B} = await setup();
    const m1 = await send(A, B, 'Meet at 7 at the gate');
    const m2 = await send(A, B, 'Bring water');

    expect(A.chat.getState().pinMessage(B.pub, 'direct', {mid: m1, mine: true, text: 'Meet at 7 at the gate'})).toBe('ok');
    await tick(300);
    expect(pinsOn(A, B.pub)[0]).toMatchObject({mid: m1, from: A.pub, t: 'Meet at 7 at the gate', by: A.pub});
    expect(pinsOn(B, A.pub)[0]).toMatchObject({mid: m1, from: A.pub, by: A.pub});

    // B pins A's other message: the first pin STAYS
    expect(B.chat.getState().pinMessage(A.pub, 'direct', {mid: m2, mine: false, text: 'Bring water'})).toBe('ok');
    await tick(300);
    expect(ids(A, B.pub)).toEqual([m1, m2]);
    expect(ids(B, A.pub)).toEqual([m1, m2]);
    expect(pinsOn(A, B.pub)[1]).toMatchObject({mid: m2, from: A.pub, by: B.pub});

    // pinning the same message twice changes nothing
    expect(A.chat.getState().pinMessage(B.pub, 'direct', {mid: m1, mine: true, text: 'Meet at 7 at the gate'})).toBe('ok');
    expect(ids(A, B.pub)).toEqual([m1, m2]);

    // either side can unpin one; the other stays
    A.chat.getState().unpinMessage(B.pub, 'direct', m1);
    await tick(300);
    expect(ids(A, B.pub)).toEqual([m2]);
    expect(ids(B, A.pub)).toEqual([m2]);
    B.chat.getState().unpinMessage(A.pub, 'direct', m2);
    await tick(300);
    expect(ids(A, B.pub)).toEqual([]);
    expect(ids(B, A.pub)).toEqual([]);
  });

  it('has no limit: 40 pins reach the other phone in order', async () => {
    const {A, B} = await setup();
    const mids: string[] = [];
    for (let i = 0; i < 40; i++) {
      mids.push(await send(A, B, 'same words')); // forty messages with identical text
      expect(A.chat.getState().pinMessage(B.pub, 'direct', {mid: mids[i], mine: true, text: 'same words'})).toBe('ok');
    }
    await tick(500);
    expect(ids(A, B.pub)).toEqual(mids);
    expect(ids(B, A.pub)).toEqual(mids);
  });

  it('a phone that missed some pins asks for the whole list and catches up', async () => {
    const {A, B, bus} = await setup();
    const mids = [await send(A, B, 'a'), await send(A, B, 'b'), await send(A, B, 'c'), await send(A, B, 'd')];
    A.chat.getState().pinMessage(B.pub, 'direct', {mid: mids[0], mine: true, text: 'a'});
    await tick(300);
    expect(ids(B, A.pub)).toEqual([mids[0]]);
    bus.drop = to => to === 'B';
    A.chat.getState().pinMessage(B.pub, 'direct', {mid: mids[1], mine: true, text: 'b'});
    A.chat.getState().pinMessage(B.pub, 'direct', {mid: mids[2], mine: true, text: 'c'});
    await tick(300);
    expect(ids(B, A.pub)).toEqual([mids[0]]);
    bus.drop = null;
    A.chat.getState().pinMessage(B.pub, 'direct', {mid: mids[3], mine: true, text: 'd'});
    await tick(800);
    expect(ids(B, A.pub)).toEqual(mids);
    // and unpinning one is a change too
    A.chat.getState().unpinMessage(B.pub, 'direct', mids[1]);
    await tick(300);
    expect(ids(B, A.pub)).toEqual([mids[0], mids[2], mids[3]]);
  });

  it('a pin goes when its message is taken back for everyone or deleted here; the others stay', async () => {
    const {A, B} = await setup();
    const m1 = await send(A, B, 'one');
    const m2 = await send(A, B, 'two');
    A.chat.getState().pinMessage(B.pub, 'direct', {mid: m1, mine: true, text: 'one'});
    A.chat.getState().pinMessage(B.pub, 'direct', {mid: m2, mine: true, text: 'two'});
    await tick(300);
    expect(ids(B, A.pub)).toEqual([m1, m2]);

    A.chat.getState().deleteForEveryone(B.pub, 'direct', m1);
    await tick(300);
    expect(ids(A, B.pub)).toEqual([m2]);
    expect(ids(B, A.pub)).toEqual([m2]);

    A.chat.getState().deleteLocal(B.pub, m2);
    expect(ids(A, B.pub)).toEqual([]);
  });

  it('is not allowed where messages vanish, and turning that on clears every pin on both phones', async () => {
    const {A, B} = await setup();
    const m = await send(A, B, 'hello');
    const m2 = await send(A, B, 'again');
    A.chat.getState().pinMessage(B.pub, 'direct', {mid: m, mine: true, text: 'hello'});
    A.chat.getState().pinMessage(B.pub, 'direct', {mid: m2, mine: true, text: 'again'});
    await tick(300);
    expect(ids(B, A.pub).length).toBe(2);

    A.chat.getState().setDisappear(B.pub, 'direct', 24 * 3600_000);
    await tick(300);
    expect(ids(A, B.pub)).toEqual([]);
    expect(ids(B, A.pub)).toEqual([]);
    expect(A.chat.getState().pinMessage(B.pub, 'direct', {mid: m, mine: true, text: 'hello'})).toBe('no');
    expect(ids(B, A.pub)).toEqual([]);
  });

  it('does not take rubbish: empty text, groups, and the nearby room are refused', async () => {
    const {A, B} = await setup();
    expect(A.chat.getState().pinMessage(B.pub, 'direct', {mid: '', mine: true, text: 'x'})).toBe('no');
    expect(A.chat.getState().pinMessage(B.pub, 'direct', {mid: 'm1', mine: true, text: '   '})).toBe('no');
    expect(A.chat.getState().pinMessage('nearby', 'nearby', {mid: 'm1', mine: true, text: 'x'})).toBe('no');
    expect(A.chat.getState().pinMessage('g1', 'group', {mid: 'm1', mine: true, text: 'x'})).toBe('no');
  });
});
