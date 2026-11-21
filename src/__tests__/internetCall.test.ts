/**
 * Voice and video calls over the internet: A calls C with no Bluetooth/Wi-Fi in between.
 * (Fake relays + fake WebRTC; the real microphone/camera and network are not involved.)
 */
import {Bus, makePhone} from '@/testing/meshHarness';
import {FakeRelayHub, FakeRtcHub} from '@/testing/fakeNet';

const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);

async function setup() {
  const bus = new Bus();
  const relay = new FakeRelayHub();
  const rtc = new FakeRtcHub();
  const A = makePhone('A', bus, {relay, rtc});
  const B = makePhone('B', bus, {relay, rtc});
  const C = makePhone('C', bus, {relay, rtc});
  await Promise.all([A, B, C].map(p => p.engine.start()));
  for (const p of [A, B, C]) {
    p.chat.getState().init();
    p.pairing.getState().init();
  }
  A.pairing.setState({paired: [{publicKey: C.pub, name: 'Phone C', pairedAt: 1}]});
  C.pairing.setState({paired: [{publicKey: A.pub, name: 'Phone A', pairedAt: 1}]});
  await tick(50);
  return {relay, rtc, A, B, C};
}

describe('calls over the internet', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('rings, is answered, connects, and either side can hang up', async () => {
    const {A, C} = await setup();
    const started = A.icall.getState().start(C.pub, 'Phone C', false);
    await tick(1500);
    expect(await started).toBe(true);
    expect(A.icall.getState().phase).toBe('outgoing');
    expect(C.icall.getState().phase).toBe('incoming');
    expect(C.icall.getState().peerKey).toBe(A.pub);
    expect(C.icall.getState().video).toBe(false);

    await C.icall.getState().accept();
    await tick(2000);
    expect(A.icall.getState().phase).toBe('active');
    expect(C.icall.getState().phase).toBe('active');
    expect(A.icall.getState().remote).not.toBeNull();
    expect(C.icall.getState().remote).not.toBeNull();

    A.icall.getState().end();
    await tick(700);
    expect(C.icall.getState().phase).toBe('ended');
    expect(C.icall.getState().endedReason).toBe('ended');
    await tick(3000);
    expect(A.icall.getState().phase).toBe('idle');
    expect(C.icall.getState().phase).toBe('idle');
  });

  it('video calls carry video, and mute / camera controls reach the media', async () => {
    const {A, C, rtc} = await setup();
    const p = A.icall.getState().start(C.pub, 'Phone C', true);
    await tick(1500);
    await p;
    expect(C.icall.getState().video).toBe(true);
    await C.icall.getState().accept();
    await tick(2000);

    A.icall.getState().toggleMute();
    A.icall.getState().toggleCamera();
    A.icall.getState().flipCamera();
    const mine = rtc.calls.media[0];
    expect(mine.hasVideo).toBe(true);
    expect(mine.muted).toBe(true);
    expect(mine.camera).toBe(false);
    expect(mine.flips).toBe(1);
    A.icall.getState().toggleMute();
    expect(mine.muted).toBe(false);
  });

  it('declining tells the caller', async () => {
    const {A, C} = await setup();
    const p = A.icall.getState().start(C.pub, 'Phone C', false);
    await tick(1500);
    await p;
    C.icall.getState().decline();
    await tick(700);
    expect(A.icall.getState().phase).toBe('ended');
    expect(A.icall.getState().endedReason).toBe('declined');
  });

  it('stops ringing and hangs up after 45 seconds with no answer', async () => {
    const {A, C, rtc} = await setup();
    const p = A.icall.getState().start(C.pub, 'Phone C', false);
    await tick(1500);
    await p;
    await tick(50_000);
    expect(A.icall.getState().endedReason === 'no answer' || A.icall.getState().phase === 'idle').toBe(true);
    expect(['idle', 'ended']).toContain(C.icall.getState().phase);
    expect(rtc.calls.media.every(m => m.stopped || m === undefined)).toBe(true); // the microphone is released
  });

  it('a person you are not connected to cannot ring you', async () => {
    const {A, B} = await setup();
    B.pairing.setState({paired: [{publicKey: A.pub, name: 'Phone A', pairedAt: 1}]});
    const p = B.icall.getState().start(A.pub, 'Phone A', false);
    await tick(2500);
    await p;
    expect(A.icall.getState().phase).toBe('idle');
  });

  it('answers a second caller with "busy" instead of interrupting', async () => {
    const {A, B, C} = await setup();
    B.pairing.setState({paired: [{publicKey: C.pub, name: 'Phone C', pairedAt: 1}]});
    C.pairing.setState({paired: [{publicKey: A.pub, name: 'Phone A', pairedAt: 1}, {publicKey: B.pub, name: 'Phone B', pairedAt: 1}]});
    const first = A.icall.getState().start(C.pub, 'Phone C', false);
    await tick(1500);
    await first;
    const second = B.icall.getState().start(C.pub, 'Phone C', false);
    await tick(900);
    await second;
    expect(C.icall.getState().peerKey).toBe(A.pub); // still A's call
    expect(B.icall.getState().endedReason).toBe('busy');
  });

  it('releases the microphone and camera when a call ends', async () => {
    const {A, C, rtc} = await setup();
    const p = A.icall.getState().start(C.pub, 'Phone C', true);
    await tick(1500);
    await p;
    await C.icall.getState().accept();
    await tick(2000);
    C.icall.getState().end();
    await tick(2000);
    expect(rtc.calls.media.length).toBe(2);
    expect(rtc.calls.media.every(m => m.stopped)).toBe(true);
  });

  it('fails cleanly when the microphone is refused', async () => {
    const {A, C, rtc} = await setup();
    rtc.calls.micDenied = true;
    const ok = await A.icall.getState().start(C.pub, 'Phone C', false);
    expect(ok).toBe(false);
    expect(['ended', 'idle']).toContain(A.icall.getState().phase);
    await tick(2000);
    expect(C.icall.getState().phase).toBe('idle');
  });
});
