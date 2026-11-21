/**
 * Forward-secret chats and secret chats, end to end: three virtual phones in a
 * line A — B — C (A and C never in range). Real stores, real encryption; only
 * the radio is faked.
 */
import {Bus, makePhone} from '@/testing/meshHarness';
import {decodePacket} from '@/mesh/relayProtocol';

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
    p.secret.getState().init();
  }
  A.pairing.setState({paired: [{publicKey: C.pub, name: 'Phone C', pairedAt: 1}]});
  C.pairing.setState({paired: [{publicKey: A.pub, name: 'Phone A', pairedAt: 1}]});
  bus.link('A', 'B');
  bus.link('B', 'C');
  // What the relay in the middle can see on the wire.
  const seen: {type: string; nonce?: string; payload: string}[] = [];
  bus.nodes.get('B')!.wire.add(w => {
    const p = decodePacket(w);
    if (p) {
      seen.push({type: p.type, nonce: p.nonce, payload: p.payload});
    }
  });
  return {bus, A, B, C, seen};
}

describe('forward-secret normal chat', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sets up keys by itself between two people who were already connected, and then uses them', async () => {
    const {A, C, seen} = await setup();
    // First message goes out before keys exist (old static box), and still arrives.
    await A.chat.getState().sendText(C.pub, 'direct', 'before keys');
    await tick(3000);
    expect(C.chat.getState().byConversation[A.pub]?.some((m: {text?: string}) => m.text === 'before keys')).toBe(true);

    // The phones set up a session in the background.
    await tick(35000);
    await A.chat.getState().sendText(C.pub, 'direct', 'after keys');
    await tick(3000);
    const got = C.chat.getState().byConversation[A.pub] ?? [];
    expect(got.some((m: {text?: string}) => m.text === 'after keys')).toBe(true);

    const lastChat = [...seen].reverse().find(p => p.type === 'CHAT' && p.nonce);
    expect(lastChat?.nonce).toBe('dr1'); // sealed with the ratchet, not the old box

    // …and replies work the other way too.
    await C.chat.getState().sendText(A.pub, 'direct', 'got it');
    await tick(3000);
    expect(A.chat.getState().byConversation[C.pub]?.some((m: {text?: string}) => m.text === 'got it')).toBe(true);
  });
});

describe('secret chats', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function makeSecret() {
    const ctx = await setup();
    const {A, C} = ctx;
    const id = A.secret.getState().start(C.pub, 'Phone C', 60_000);
    await tick(3000);
    return {...ctx, id};
  }

  it('invites, accepts, and both phones end up ready with the same safety code', async () => {
    const {A, C, id} = await makeSecret();
    expect(C.secret.getState().incoming).toHaveLength(1);
    expect(A.secret.getState().chats[id].status).toBe('waiting');

    expect(C.secret.getState().accept(id)).toBe(id);
    await tick(3000);

    expect(A.secret.getState().chats[id].status).toBe('ready');
    expect(C.secret.getState().chats[id].status).toBe('ready');
    expect(A.secret.getState().chats[id].code).toEqual(C.secret.getState().chats[id].code);
    expect(A.secret.getState().chats[id].code).toHaveLength(6);
  });

  it('cannot write until the other person accepts', async () => {
    const {A, id} = await makeSecret();
    await A.chat.getState().sendText(id, 'direct', 'too early');
    expect(A.chat.getState().byConversation[id] ?? []).toHaveLength(0);
  });

  it('delivers messages both ways, kept apart from the normal chat, unreadable to the relay', async () => {
    const {A, B, C, id, seen} = await makeSecret();
    C.secret.getState().accept(id);
    await tick(3000);

    await A.chat.getState().sendText(id, 'direct', 'the eagle lands at noon');
    await tick(3000);
    const atC = C.chat.getState().byConversation[id] ?? [];
    expect(atC.map((m: {text?: string}) => m.text)).toEqual(['the eagle lands at noon']);
    // Not mixed into the normal chat with A.
    expect(C.chat.getState().byConversation[A.pub] ?? []).toHaveLength(0);
    // Delivery tick came back.
    expect(A.chat.getState().byConversation[id][0].status).toBe('delivered');

    await C.chat.getState().sendText(id, 'direct', 'copy that');
    await tick(3000);
    expect((A.chat.getState().byConversation[id] ?? []).map((m: {text?: string}) => m.text)).toContain('copy that');

    // The phone in the middle carried packets but has no chat and saw no plaintext.
    expect(Object.keys(B.chat.getState().byConversation).filter(k => k !== B.pub)).toHaveLength(0);
    expect(seen.some(p => p.payload.includes('eagle'))).toBe(false);
    expect(seen.filter(p => p.type === 'CHAT').every(p => p.nonce === 'dr1')).toBe(true);
  });

  it('every message gets the self-destruct timer, on both phones', async () => {
    const {A, C, id} = await makeSecret();
    C.secret.getState().accept(id);
    await tick(3000);
    expect(A.prefs.getState().prefs[id]?.disappear).toBe(60_000);
    expect(C.prefs.getState().prefs[id]?.disappear).toBe(60_000);

    await A.chat.getState().sendText(id, 'direct', 'burn after reading');
    await tick(3000);
    expect(C.chat.getState().byConversation[id]).toHaveLength(1);
    expect(C.chat.getState().byConversation[id][0].expiresAt).toBeGreaterThan(Date.now());

    await tick(70_000); // a minute passes
    expect(C.chat.getState().byConversation[id] ?? []).toHaveLength(0);
    expect(A.chat.getState().byConversation[id] ?? []).toHaveLength(0);
  });

  it('timer changes reach the other phone', async () => {
    const {A, C, id} = await makeSecret();
    C.secret.getState().accept(id);
    await tick(3000);
    A.chat.getState().setDisappear(id, 'direct', 10_000);
    await tick(3000);
    expect(C.prefs.getState().prefs[id]?.disappear).toBe(10_000);
    expect(C.secret.getState().chats[id].timer).toBe(10_000);
  });

  it('secret messages cannot be forwarded', async () => {
    const {A, C, id} = await makeSecret();
    C.secret.getState().accept(id);
    await tick(3000);
    await A.chat.getState().sendText(id, 'direct', 'private');
    await tick(3000);
    const msg = C.chat.getState().byConversation[id][0];
    await C.chat.getState().forwardMessage(A.pub, 'direct', msg);
    await tick(3000);
    expect((A.chat.getState().byConversation[C.pub] ?? []).some((m: {text?: string}) => m.text === 'private')).toBe(false);
  });

  it('ending it on one phone wipes keys and messages on both', async () => {
    const {A, C, id} = await makeSecret();
    C.secret.getState().accept(id);
    await tick(3000);
    await A.chat.getState().sendText(id, 'direct', 'to be erased');
    await tick(3000);

    C.secret.getState().end(id);
    await tick(3000);
    expect(C.secret.getState().chats[id]).toBeUndefined();
    expect(A.secret.getState().chats[id]).toBeUndefined();
    expect(A.chat.getState().byConversation[id] ?? []).toHaveLength(0);
    expect(C.chat.getState().byConversation[id] ?? []).toHaveLength(0);
    // The keys are gone: nothing can be sent into it any more.
    await A.chat.getState().sendText(id, 'direct', 'hello?');
    expect(A.chat.getState().byConversation[id] ?? []).toHaveLength(0);
  });

  it('a person who is not connected to you cannot send you an invite', async () => {
    const {A, B} = await setup();
    B.secret.getState().start(A.pub, 'Phone A');
    await tick(3000);
    expect(A.secret.getState().incoming).toHaveLength(0);
  });

  it('declining tells the inviter', async () => {
    const {A, C, id} = await makeSecret();
    C.secret.getState().decline(id);
    await tick(3000);
    expect(C.secret.getState().incoming).toHaveLength(0);
    expect(A.secret.getState().chats[id]).toBeUndefined();
  });

  it('secret chats are left out of backups', async () => {
    const {withoutSecrets} = require('@/services/backup');
    const out = withoutSecrets({
      'chat.sessions': 'x',
      'chat.secrets': 'y',
      'chat.history': JSON.stringify({byConversation: {'sc:abc': [{id: '1'}], 'peer': [{id: '2'}]}, outbox: {}}),
      'app.name': 'keep',
    });
    expect(out['chat.sessions']).toBeUndefined();
    expect(out['chat.secrets']).toBeUndefined();
    expect(out['app.name']).toBe('keep');
    const hist = JSON.parse(out['chat.history']);
    expect(Object.keys(hist.byConversation)).toEqual(['peer']);
  });
});
