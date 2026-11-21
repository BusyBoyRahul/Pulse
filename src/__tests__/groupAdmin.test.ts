/**
 * Running a group: the admin renames it, adds and removes people; a member leaves; when the admin leaves, somebody else
 * takes over. Three virtual phones, all connected to each other, each with its own identity and stores.
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
  }
  const all = [A, B, C];
  for (const p of all) {
    p.pairing.setState({paired: all.filter(o => o !== p).map(o => ({publicKey: o.pub, name: `Phone ${o.id}`, pairedAt: 1}))});
  }
  bus.link('A', 'B');
  bus.link('A', 'C');
  bus.link('B', 'C');
  return {bus, A, B, C};
}

/** A makes a group with the others; everyone accepts. */
async function groupOf(A: any, others: any[]) {
  const g = A.groups.getState().create('Trail crew', others.map((o: any) => o.pub));
  await tick(200);
  for (const o of others) {
    o.groups.getState().accept(g.id);
  }
  await tick(200);
  return g.id as string;
}

describe('running a group', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('the admin renames the group, everybody sees the new name, and the chat says who did it', async () => {
    const {A, B, C} = await setup();
    const id = await groupOf(A, [B, C]);

    expect(A.groups.getState().rename(id, '  Weekend hike  ')).toBe(true);
    await tick(200);

    expect(A.groups.getState().get(id)?.name).toBe('Weekend hike');
    expect(B.groups.getState().get(id)?.name).toBe('Weekend hike');
    expect(C.groups.getState().get(id)?.name).toBe('Weekend hike');
    expect(A.groups.getState().get(id)?.notes?.map((n: {text: string}) => n.text)).toContain('You renamed the group to “Weekend hike”');
    expect(B.groups.getState().get(id)?.notes?.map((n: {text: string}) => n.text)).toContain('Phone A renamed the group to “Weekend hike”');
  });

  it('only an admin can add or remove people (and the creator can never be removed)', async () => {
    const {A, B, C} = await setup();
    const id = await groupOf(A, [B, C]);
    expect(B.groups.getState().isAdmin(id)).toBe(false);
    expect(B.groups.getState().removeMember(id, C.pub)).toBe(false);
    expect(B.groups.getState().addMembers(id, [C.pub])).toBe(false);
    expect(B.groups.getState().setAdmin(id, C.pub, true)).toBe(false);
    expect(B.groups.getState().setPerms(id, {send: 'admins'})).toBe(false);
    expect(B.groups.getState().endGroup(id)).toBe(false);
    await tick(200);
    expect(C.groups.getState().get(id)?.members).toContain(C.pub);
    expect(A.groups.getState().isAdmin(id)).toBe(true);
    expect(A.groups.getState().removeMember(id, A.pub)).toBe(false);
  });

  it('by default any member can edit the name, picture and description; the admin can lock that to admins', async () => {
    const {A, B, C} = await setup();
    const id = await groupOf(A, [B, C]);
    expect(B.groups.getState().canEditInfo(id)).toBe(true);
    expect(B.groups.getState().rename(id, 'B’s idea')).toBe(true);
    await tick(200);
    expect(A.groups.getState().get(id)?.name).toBe('B’s idea');
    expect(C.groups.getState().get(id)?.name).toBe('B’s idea');

    expect(A.groups.getState().setPerms(id, {edit: 'admins'})).toBe(true);
    await tick(200);
    expect(B.groups.getState().get(id)?.perms).toEqual({edit: 'admins'});
    expect(B.groups.getState().canEditInfo(id)).toBe(false);
    expect(B.groups.getState().rename(id, 'Not allowed')).toBe(false);
    expect(B.groups.getState().setInfo(id, {desc: 'nope'})).toBe(false);
    expect(A.groups.getState().rename(id, 'Admin only now')).toBe(true);
    await tick(200);
    expect(C.groups.getState().get(id)?.name).toBe('Admin only now');
  });

  it('the picture and description reach everybody, can be removed, and the chat says who changed them', async () => {
    const {A, B, C} = await setup();
    const id = await groupOf(A, [B, C]);
    const pic = 'QUJD'.repeat(500);
    expect(A.groups.getState().setInfo(id, {desc: '  Trail crew — Saturdays at 7  ', pic})).toBe(true);
    await tick(200);
    for (const p of [B, C]) {
      const g = p.groups.getState().get(id)!;
      expect(g.desc).toBe('Trail crew — Saturdays at 7');
      expect(g.pic).toBe(pic);
      expect(g.notes?.map((n: {text: string}) => n.text)).toEqual(expect.arrayContaining(['Phone A changed the group description', 'Phone A changed the group picture']));
    }
    expect(A.groups.getState().setInfo(id, {pic: '', desc: ''})).toBe(true);
    await tick(200);
    expect(B.groups.getState().get(id)?.pic).toBeUndefined();
    expect(B.groups.getState().get(id)?.desc).toBeUndefined();
    // junk is refused (not base64, too long)
    expect(A.groups.getState().setInfo(id, {pic: '<script>'})).toBe(true); // nothing changes
    expect(A.groups.getState().get(id)?.pic).toBeUndefined();
    expect(A.groups.getState().setInfo(id, {name: '   '})).toBe(false);
    expect(A.groups.getState().setInfo(id, {desc: 'x'.repeat(900)})).toBe(true);
    expect(A.groups.getState().get(id)?.desc).toHaveLength(500);
  });

  it('the creator can make others admin and take it away; admins can then run the group', async () => {
    const {A, B, C} = await setup();
    const id = await groupOf(A, [B, C]);
    expect(A.groups.getState().setAdmin(id, B.pub, true)).toBe(true);
    expect(A.groups.getState().setAdmin(id, B.pub, true)).toBe(false); // already
    expect(A.groups.getState().setAdmin(id, A.pub, false)).toBe(false); // the creator can't be demoted
    await tick(200);
    expect(B.groups.getState().isAdmin(id)).toBe(true);
    expect(C.groups.getState().get(id)?.admins).toEqual([B.pub]);
    expect(C.groups.getState().get(id)?.notes?.map((n: {text: string}) => n.text)).toContain('Phone A made Phone B admin');

    // B, now an admin, removes C
    expect(B.groups.getState().removeMember(id, C.pub)).toBe(true);
    await tick(200);
    expect(C.groups.getState().get(id)).toBeUndefined();
    expect(A.groups.getState().get(id)?.members).not.toContain(C.pub);

    // and the creator takes admin away again
    expect(A.groups.getState().setAdmin(id, B.pub, false)).toBe(true);
    await tick(200);
    expect(B.groups.getState().isAdmin(id)).toBe(false);
    expect(B.groups.getState().removeMember(id, A.pub)).toBe(false);
  });

  it('an announcement group: only admins can send, and phones ignore anybody else’s new messages', async () => {
    const {A, B, C} = await setup();
    const id = await groupOf(A, [B, C]);
    expect(A.groups.getState().setPerms(id, {send: 'admins'})).toBe(true);
    await tick(200);
    expect(B.groups.getState().canSend(id)).toBe(false);
    expect(A.groups.getState().canSend(id)).toBe(true);

    await B.chat.getState().sendText(id, 'group', 'can I talk?'); // refused on B's phone
    await A.chat.getState().sendText(id, 'group', 'Meeting at 7');
    await tick(300);
    const texts = (p: any) => ((p.chat.getState().byConversation[id] ?? []) as {text?: string}[]).map(m => m.text);
    expect(texts(C)).toContain('Meeting at 7');
    expect(texts(C)).not.toContain('can I talk?');
    expect(texts(A)).not.toContain('can I talk?');

    // lifting the rule lets everybody talk again
    A.groups.getState().setPerms(id, {});
    await tick(200);
    await B.chat.getState().sendText(id, 'group', 'thanks!');
    await tick(300);
    expect(texts(A)).toContain('thanks!');
  });

  it('an invite carries the picture, description, admins and rules, so the invited person can see them before accepting', async () => {
    const {A, B, C} = await setup();
    const pic = 'QUJD'.repeat(300);
    const g = A.groups.getState().create('Trail crew', [B.pub], {desc: 'Saturdays', pic});
    await tick(200);
    const inv = B.groups.getState().pendingInvites[0];
    expect(inv.pic).toBe(pic);
    expect(inv.desc).toBe('Saturdays');
    B.groups.getState().accept(g.id);
    expect(B.groups.getState().get(g.id)?.pic).toBe(pic);
    expect(B.groups.getState().get(g.id)?.desc).toBe('Saturdays');

    A.groups.getState().setAdmin(g.id, B.pub, true);
    A.groups.getState().setPerms(g.id, {edit: 'admins'});
    A.groups.getState().addMembers(g.id, [C.pub]);
    await tick(200);
    const inv2 = C.groups.getState().pendingInvites[0];
    expect(inv2.admins).toEqual([B.pub]);
    expect(inv2.perms).toEqual({edit: 'admins'});
    expect(inv2.desc).toBe('Saturdays');
  });

  it('an unanswered invite can be sent again, but not to someone who already joined', async () => {
    const {A, B, C} = await setup();
    const g = A.groups.getState().create('Trail crew', [B.pub, C.pub]);
    await tick(200);
    B.groups.getState().accept(g.id);
    await tick(200);
    expect(A.groups.getState().resendInvite(g.id, B.pub)).toBe(false); // joined already
    expect(A.groups.getState().resendInvite(g.id, C.pub)).toBe(true); // never answered
    expect(B.groups.getState().resendInvite(g.id, C.pub)).toBe(false); // not an admin
    C.groups.getState().decline(g.id);
    await tick(200);
    // sending again: the declined person gets a fresh invite
    A.groups.getState().resendInvite(g.id, C.pub);
    await tick(200);
    expect(C.groups.getState().pendingInvites.map((i: {id: string}) => i.id)).toContain(g.id);
  });

  it('an admin can close the group for everybody', async () => {
    const {A, B, C} = await setup();
    const id = await groupOf(A, [B, C]);
    expect(A.groups.getState().endGroup(id)).toBe(true);
    await tick(200);
    for (const p of [A, B, C]) {
      expect(p.groups.getState().get(id)).toBeUndefined();
    }
  });

  it('joining by link: the person asks, the admin approves (or declines)', async () => {
    const {A, B, C} = await setup();
    const g = A.groups.getState().create('Trail crew', [B.pub]);
    await tick(200);
    B.groups.getState().accept(g.id);
    await tick(200);

    C.groups.getState().requestToJoin(g.id, A.pub);
    await tick(200);
    expect(A.groups.getState().joinRequests).toHaveLength(1);
    expect(A.groups.getState().joinRequests[0].key).toBe(C.pub);
    expect(B.groups.getState().joinRequests).toHaveLength(0); // only an admin hears about it
    expect(C.groups.getState().get(g.id)).toBeUndefined(); // not in yet

    const req = A.groups.getState().joinRequests[0];
    expect(A.groups.getState().approveJoin(req.id)).toBe(true);
    await tick(200);
    expect(A.groups.getState().joinRequests).toHaveLength(0);
    expect(C.groups.getState().pendingInvites.map((i: {id: string}) => i.id)).toContain(g.id);
    C.groups.getState().accept(g.id);
    await tick(200);
    expect(A.groups.getState().get(g.id)?.joined).toContain(C.pub);

    // declining just clears the request
    const other = A.groups.getState().create('Second', []);
    C.groups.getState().requestToJoin(other.id, A.pub);
    await tick(200);
    A.groups.getState().declineJoin(A.groups.getState().joinRequests[0].id);
    expect(A.groups.getState().joinRequests).toHaveLength(0);
  });

  it('a group has a size limit, and a request for a group someone is already in is ignored', async () => {
    const {A, B} = await setup();
    const nacl = require('tweetnacl');
    const naclUtil = require('tweetnacl-util');
    const fakeKeys = Array.from({length: 60}, () => naclUtil.encodeBase64(nacl.box.keyPair().publicKey));
    const g = A.groups.getState().create('Big', fakeKeys);
    expect(g.members.length).toBe(50);
    expect(A.groups.getState().addMembers(g.id, [B.pub])).toBe(false); // full
    const small = A.groups.getState().create('Small', [B.pub]);
    await tick(200);
    B.groups.getState().accept(small.id);
    await tick(200);
    B.groups.getState().requestToJoin(small.id, A.pub); // already in
    await tick(200);
    expect(A.groups.getState().joinRequests).toHaveLength(0);
  });

  it('adding someone later invites them, and the people already in see the new list', async () => {
    const {A, B, C} = await setup();
    const id = await groupOf(A, [B]);
    expect(B.groups.getState().get(id)?.members).not.toContain(C.pub);

    expect(A.groups.getState().addMembers(id, [C.pub])).toBe(true);
    await tick(200);

    expect(C.groups.getState().pendingInvites.map((i: {id: string}) => i.id)).toContain(id); // they still have to accept
    expect(B.groups.getState().get(id)?.members).toContain(C.pub);
    expect(B.groups.getState().get(id)?.notes?.map((n: {text: string}) => n.text)).toContain('Phone A added Phone C');
    // adding someone who is already in does nothing
    expect(A.groups.getState().addMembers(id, [B.pub, C.pub])).toBe(false);

    C.groups.getState().accept(id);
    await tick(200);
    expect(A.groups.getState().get(id)?.joined).toContain(C.pub);
  });

  it('removing someone takes them out and changes the secret key, so they can’t read what comes next', async () => {
    const {A, B, C} = await setup();
    const id = await groupOf(A, [B, C]);
    const oldKey = A.groups.getState().get(id)!.key;

    expect(A.groups.getState().removeMember(id, C.pub)).toBe(true);
    await tick(200);

    expect(C.groups.getState().get(id)).toBeUndefined(); // gone from their phone
    const ga = A.groups.getState().get(id)!;
    const gb = B.groups.getState().get(id)!;
    expect(ga.members).not.toContain(C.pub);
    expect(gb.members).not.toContain(C.pub);
    expect(ga.key).not.toBe(oldKey); // a new key…
    expect(gb.key).toBe(ga.key); // …that everyone still in has
    expect(gb.notes?.map((n: {text: string}) => n.text)).toContain('Phone A removed Phone C');

    // A message in the group now reaches A, and C (who has no group) gets nothing
    await B.chat.getState().sendText(id, 'group', 'after the change');
    await tick(200);
    expect((A.chat.getState().byConversation[id] ?? []).map((m: {text?: string}) => m.text)).toContain('after the change');
    expect(C.chat.getState().byConversation[id] ?? []).toHaveLength(0);
    // the admin can't remove themself
    expect(A.groups.getState().removeMember(id, A.pub)).toBe(false);
  });

  it('when someone leaves, everybody else is told', async () => {
    const {A, B, C} = await setup();
    const id = await groupOf(A, [B, C]);

    B.groups.getState().leave(id);
    await tick(200);

    expect(B.groups.getState().get(id)).toBeUndefined();
    for (const p of [A, C]) {
      const g = p.groups.getState().get(id)!;
      expect(g.members).not.toContain(B.pub);
      expect(g.joined).not.toContain(B.pub);
      expect(g.notes?.map((n: {text: string}) => n.text)).toContain('Phone B left');
    }
  });

  it('when the admin leaves, the next person in the list becomes admin — the same person on every phone', async () => {
    const {A, B, C} = await setup();
    const id = await groupOf(A, [B, C]);

    A.groups.getState().leave(id);
    await tick(200);

    const gb = B.groups.getState().get(id)!;
    const gc = C.groups.getState().get(id)!;
    expect(gb.createdBy).toBe(B.pub);
    expect(gc.createdBy).toBe(B.pub);
    expect(B.groups.getState().isAdmin(id)).toBe(true);
    expect(gb.notes?.map((n: {text: string}) => n.text)).toContain('You are now the admin');
    expect(gc.notes?.map((n: {text: string}) => n.text)).toContain('Phone B is now the admin');
    // and the new admin can run the group
    expect(B.groups.getState().rename(id, 'New era')).toBe(true);
    await tick(200);
    expect(C.groups.getState().get(id)?.name).toBe('New era');
  });
});
