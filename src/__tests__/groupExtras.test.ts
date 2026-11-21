/**
 * Group extras: a pinned message, "is typing…" in a group, and an @mention that still notifies in a muted group.
 */
import {Bus, makePhone} from '@/testing/meshHarness';
import {pinsOf} from '@/store/groupsStore';

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
  }
  const all = [A, B, C];
  for (const p of all) {
    p.pairing.setState({paired: all.filter(o => o !== p).map(o => ({publicKey: o.pub, name: `Phone ${o.id}`, pairedAt: 1}))});
  }
  bus.link('A', 'B');
  bus.link('A', 'C');
  bus.link('B', 'C');
  const g = A.groups.getState().create('Trail crew', [B.pub, C.pub]);
  await tick(200);
  B.groups.getState().accept(g.id);
  C.groups.getState().accept(g.id);
  await tick(200);
  return {A, B, C, id: g.id as string};
}

const noteTexts = (p: any, id: string) => (p.groups.getState().get(id)?.notes ?? []).map((n: {text: string}) => n.text);
const pinIds = (p: any, id: string) => pinsOf(p.groups.getState().get(id)).map((x: {mid: string}) => x.mid);

describe('group extras', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('pinned messages stack up (the older ones stay), show for everybody, follow the group’s edit rule, and can be unpinned one by one', async () => {
    const {A, B, C, id} = await setup();
    expect(A.groups.getState().addPin(id, {mid: 'm1', from: A.pub, fromName: 'Phone A', text: 'Meet at 7 at the gate'})).toBe('ok');
    await tick(200);
    for (const p of [B, C]) {
      const pin = pinsOf(p.groups.getState().get(id))[0];
      expect(pin?.text).toBe('Meet at 7 at the gate');
      expect(pin?.by).toBe(A.pub); // who pinned it is who really sent it, not something the message claims
      expect(noteTexts(p, id)).toContain('Phone A pinned a message');
    }
    // By default any member may pin — and a new pin does NOT replace the earlier one.
    expect(B.groups.getState().addPin(id, {mid: 'm2', from: B.pub, fromName: 'Phone B', text: 'Bring water'})).toBe('ok');
    await tick(200);
    for (const p of [A, B, C]) {
      expect(pinIds(p, id)).toEqual(['m1', 'm2']);
    }
    // up to 3; a 4th is refused and nothing is lost
    expect(C.groups.getState().addPin(id, {mid: 'm3', from: C.pub, fromName: 'Phone C', text: 'Rain gear'})).toBe('ok');
    expect(C.groups.getState().addPin(id, {mid: 'm4', from: C.pub, fromName: 'Phone C', text: 'One too many'})).toBe('full');
    await tick(200);
    expect(pinIds(A, id)).toEqual(['m1', 'm2', 'm3']);
    // pinning the same message again changes nothing
    expect(A.groups.getState().addPin(id, {mid: 'm2', from: B.pub, fromName: 'Phone B', text: 'Bring water'})).toBe('ok');
    expect(pinIds(A, id)).toEqual(['m1', 'm2', 'm3']);

    // once edits are admins-only, members may not; the admin removes just one pin
    A.groups.getState().setPerms(id, {edit: 'admins'});
    await tick(200);
    expect(B.groups.getState().removePin(id, 'm1')).toBe(false);
    expect(B.groups.getState().addPin(id, {mid: 'm5', from: B.pub, fromName: 'Phone B', text: 'x'})).toBe('no');
    expect(A.groups.getState().removePin(id, 'm1')).toBe(true);
    await tick(200);
    for (const p of [A, B, C]) {
      expect(pinIds(p, id)).toEqual(['m2', 'm3']);
    }
    expect(noteTexts(B, id)).toContain('Phone A unpinned a message');
    // an empty or missing message can't be pinned
    expect(A.groups.getState().addPin(id, {mid: '', from: A.pub, fromName: 'x', text: 'x'})).toBe('no');
  });

  it('a group saved by an older version with one pin still shows it', async () => {
    const {A, id} = await setup();
    const g = A.groups.getState().get(id)!;
    A.groups.setState({groups: A.groups.getState().groups.map((x: {id: string}) => (x.id === id ? {...g, pinned: {mid: 'old', from: A.pub, fromName: 'Phone A', text: 'Old pin', by: A.pub}} : x))});
    expect(pinIds(A, id)).toEqual(['old']);
    expect(A.groups.getState().addPin(id, {mid: 'm2', from: A.pub, fromName: 'Phone A', text: 'Newer'})).toBe('ok');
    expect(pinIds(A, id)).toEqual(['old', 'm2']);
    expect(A.groups.getState().get(id)?.pinned).toBeUndefined();
  });

  it('"is typing…" reaches the group, and only people in it', async () => {
    const {A, B, C, id} = await setup();
    A.chat.getState().setTyping(id, true);
    await tick(300);
    for (const p of [B, C]) {
      expect(p.chat.getState().typing[`${id}:${A.pub}`]).toBeGreaterThan(Date.now());
    }
    A.chat.getState().setTyping(id, false);
    await tick(300);
    expect(B.chat.getState().typing[`${id}:${A.pub}`]).toBe(0);

    // typing times out by itself
    A.chat.getState().setTyping(id, true);
    await tick(300);
    await tick(7000);
    expect(B.chat.getState().typing[`${id}:${A.pub}`]).toBe(0);
  });

  it('an @mention of me still notifies in a muted group; other messages stay quiet', async () => {
    const {A, B, id} = await setup();
    B.session.setState({profileName: 'Bella Quinn'});
    B.prefs.getState().mute(id, -1); // muted for good
    B.notify.show.mockClear();

    await A.chat.getState().sendText(id, 'group', 'hello everybody');
    await tick(300);
    expect(B.notify.show).not.toHaveBeenCalled();

    await A.chat.getState().sendText(id, 'group', 'hello @Bella, are you coming?');
    await tick(300);
    expect(B.notify.show).toHaveBeenCalledTimes(1);
  });
});
