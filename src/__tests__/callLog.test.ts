/** The Calls tab history: every call, answered or not, leaves one clear line. */
import {Bus, makePhone} from '@/testing/meshHarness';
import {FakeRelayHub, FakeRtcHub} from '@/testing/fakeNet';

const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);

async function setup() {
  const bus = new Bus();
  const relay = new FakeRelayHub();
  const rtc = new FakeRtcHub();
  const A = makePhone('A', bus, {relay, rtc});
  const C = makePhone('C', bus, {relay, rtc});
  await Promise.all([A, C].map(p => p.engine.start()));
  for (const p of [A, C]) {
    p.chat.getState().init();
    p.pairing.getState().init();
    p.callLog.startCallLog();
  }
  A.pairing.setState({paired: [{publicKey: C.pub, name: 'Phone C', pairedAt: 1}]});
  C.pairing.setState({paired: [{publicKey: A.pub, name: 'Phone A', pairedAt: 1}]});
  await tick(50);
  return {A, C};
}

describe('call history', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('records an answered call on both phones, with who called and for how long', async () => {
    const {A, C} = await setup();
    const p = A.icall.getState().start(C.pub, 'Phone C', true);
    await tick(1500);
    await p;
    await C.icall.getState().accept();
    await tick(2000);
    await tick(65_000); // talk for just over a minute
    A.icall.getState().end();
    await tick(1000);

    const a = A.logStore.getState().calls;
    const c = C.logStore.getState().calls;
    expect(a).toHaveLength(1);
    expect(c).toHaveLength(1);
    expect(a[0]).toMatchObject({peerKey: C.pub, direction: 'outgoing', outcome: 'answered', video: true, via: 'internet'});
    expect(c[0]).toMatchObject({peerKey: A.pub, direction: 'incoming', outcome: 'answered', video: true});
    expect(a[0].durationMs).toBeGreaterThan(60_000);
  });

  it('a call I decline shows as declined; for the caller it is the same call, declined', async () => {
    const {A, C} = await setup();
    const p = A.icall.getState().start(C.pub, 'Phone C', false);
    await tick(1500);
    await p;
    C.icall.getState().decline();
    await tick(1000);
    expect(C.logStore.getState().calls[0]).toMatchObject({direction: 'incoming', outcome: 'declined'});
    expect(A.logStore.getState().calls[0]).toMatchObject({direction: 'outgoing', outcome: 'declined'});
  });

  it('a call nobody answers is a MISSED call for the receiver and "no answer" for the caller', async () => {
    const {A, C} = await setup();
    const p = A.icall.getState().start(C.pub, 'Phone C', false);
    await tick(1500);
    await p;
    A.icall.getState().end(); // caller gives up before it is answered
    await tick(1000);
    expect(C.logStore.getState().calls[0]).toMatchObject({direction: 'incoming', outcome: 'missed'});
    expect(C.logStore.getState().unseenMissed()).toBe(1);
    expect(A.logStore.getState().calls[0]).toMatchObject({direction: 'outgoing', outcome: 'no-answer'});

    C.logStore.getState().markSeen();
    expect(C.logStore.getState().unseenMissed()).toBe(0);
  });

  it('can delete one entry or clear everything', async () => {
    const {A, C} = await setup();
    for (let i = 0; i < 2; i++) {
      const p = A.icall.getState().start(C.pub, 'Phone C', false);
      await tick(1500);
      await p;
      A.icall.getState().end();
      await tick(2500);
    }
    expect(A.logStore.getState().calls).toHaveLength(2);
    A.logStore.getState().remove(A.logStore.getState().calls[0].id);
    expect(A.logStore.getState().calls).toHaveLength(1);
    A.logStore.getState().clear();
    expect(A.logStore.getState().calls).toHaveLength(0);
  });
});
