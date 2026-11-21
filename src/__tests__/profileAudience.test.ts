/**
 * "Who can see my profile": photo and about go to everyone nearby, only to connected
 * people (privately), or to nobody. A (me) — B (stranger nearby) — C (my connection).
 */
import {Bus, makePhone} from '@/testing/meshHarness';

const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);
const PHOTO = 'QUJDREVGRw=='; // a tiny stand-in for a photo thumbnail

async function setup() {
  const bus = new Bus();
  const A = makePhone('A', bus);
  const B = makePhone('B', bus);
  const C = makePhone('C', bus);
  await Promise.all([A, B, C].map(p => p.engine.start()));
  for (const p of [A, B, C]) {
    p.chat.getState().init();
    p.pairing.getState().init();
    p.peers.getState().start();
  }
  A.pairing.setState({paired: [{publicKey: C.pub, name: 'Phone C', pairedAt: 1}]});
  C.pairing.setState({paired: [{publicKey: A.pub, name: 'Phone A', pairedAt: 1}]});
  A.session.setState({avatarThumb: PHOTO, bio: 'hiking, coffee'});
  bus.link('A', 'B');
  bus.link('B', 'C');
  bus.link('A', 'C');
  A.profile.startProfileSync();
  return {A, B, C};
}

const seen = (p: any, key: string) => ({
  avatar: p.prefs.getState().profiles[key]?.avatar as string | undefined,
  bio: p.prefs.getState().profiles[key]?.bio as string | undefined,
});

describe('who can see my profile photo and about', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('Everyone nearby: a stranger in range sees both', async () => {
    const {A, B} = await setup();
    A.settings.getState().setApp({photoAudience: 'everyone', aboutAudience: 'everyone'});
    await tick(35_000);
    expect(seen(B, A.pub).avatar).toContain(PHOTO);
    expect(seen(B, A.pub).bio).toBe('hiking, coffee');
  });

  it('My connections: strangers nearby see only my name, my connection gets both privately', async () => {
    const {A, B, C} = await setup();
    A.settings.getState().setApp({photoAudience: 'connections', aboutAudience: 'connections'});
    await tick(35_000);
    // the stranger: just the name from the public hello
    expect(B.peers.getState().peers[A.pub]?.name).toBe('Phone A');
    expect(seen(B, A.pub).avatar).toBeFalsy();
    expect(seen(B, A.pub).bio).toBeFalsy();
    // my connection: photo + about, sent in an encrypted message
    expect(seen(C, A.pub).avatar).toContain(PHOTO);
    expect(seen(C, A.pub).bio).toBe('hiking, coffee');
  });

  it('Nobody: even my connection no longer has them', async () => {
    const {A, C} = await setup();
    A.settings.getState().setApp({photoAudience: 'connections', aboutAudience: 'connections'});
    await tick(35_000);
    expect(seen(C, A.pub).avatar).toContain(PHOTO);

    A.settings.getState().setApp({photoAudience: 'nobody', aboutAudience: 'nobody'});
    await tick(10_000);
    expect(seen(C, A.pub).avatar).toBeFalsy();
    expect(seen(C, A.pub).bio).toBeFalsy();
  });

  it('a change to my photo reaches connections right away', async () => {
    const {A, C} = await setup();
    A.settings.getState().setApp({photoAudience: 'connections'});
    await tick(35_000);
    A.session.setState({avatarThumb: 'WFlaWFla'});
    await tick(8_000);
    expect(seen(C, A.pub).avatar).toContain('WFlaWFla');
  });

  it('someone I am not connected to cannot write into my contacts', async () => {
    const {B, C} = await setup();
    C.profile.applyProfile(B.pub, {k: 'prof', n: 'Evil', a: PHOTO, b: 'trust me'});
    expect(C.prefs.getState().profiles[B.pub]?.bio).toBeUndefined();
  });

  it('rejects a photo that is not plain base64', async () => {
    const {A, C} = await setup();
    C.profile.applyProfile(A.pub, {k: 'prof', n: 'Phone A', a: 'javascript:alert(1)', b: 'ok'});
    expect(seen(C, A.pub).avatar ?? '').not.toContain('javascript');
  });
});
