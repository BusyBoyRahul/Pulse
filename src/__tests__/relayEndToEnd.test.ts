/**
 * End-to-end: three separate virtual phones, each with its OWN identity, storage,
 * stores and mesh engine, wired into a line  A — B — C  where A and C are never
 * in range of each other. Everything runs through the real stores (chat, pairing,
 * calls), only the radio and the microphone are faked.
 */
import naclUtil from 'tweetnacl-util';
import type {MeshTransport, TransportState} from '@/mesh/transport/types';
import type {NearbyDevice} from '@/types';

class Bus {
  /** Lose some packets on the way to a phone (tests lost-piece recovery). */
  drop: ((to: string) => boolean) | null = null;
  adj = new Map<string, Set<string>>();
  nodes = new Map<string, Radio>();
  add(id: string) {
    const r = new Radio(id, this);
    this.nodes.set(id, r);
    this.adj.set(id, new Set());
    return r;
  }
  link(a: string, b: string) {
    this.adj.get(a)!.add(b);
    this.adj.get(b)!.add(a);
    this.nodes.get(a)!.changed();
    this.nodes.get(b)!.changed();
  }
  unlink(a: string, b: string) {
    this.adj.get(a)!.delete(b);
    this.adj.get(b)!.delete(a);
    this.nodes.get(a)!.changed();
    this.nodes.get(b)!.changed();
  }
}

class Radio implements MeshTransport {
  state: TransportState = 'active';
  wire = new Set<(w: string, f: string) => void>();
  dev = new Set<(d: NearbyDevice[]) => void>();
  constructor(readonly id: string, private bus: Bus) {}
  async start() {}
  async stop() {}
  async broadcast(w: string, except?: string) {
    for (const n of this.bus.adj.get(this.id) ?? []) {
      if (n !== except && !(this.bus.drop && this.bus.drop(n))) {
        this.bus.nodes.get(n)!.wire.forEach(h => h(w, this.id));
      }
    }
  }
  onWire(h: (w: string, f: string) => void) {
    this.wire.add(h);
    return () => this.wire.delete(h);
  }
  onDevices(h: (d: NearbyDevice[]) => void) {
    this.dev.add(h);
    return () => this.dev.delete(h);
  }
  onStateChange() {
    return () => {};
  }
  changed() {
    const list = [...(this.bus.adj.get(this.id) ?? [])].map(deviceId => ({deviceId, rssi: null, lastSeen: 0}));
    this.dev.forEach(h => h(list));
  }
}

function makePhone(id: string, bus: Bus) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let api: any;
  jest.isolateModules(() => {
    const audio = {
      available: true,
      frameCb: null as null | ((f: string) => void),
      start: jest.fn(async () => true),
      stop: jest.fn(async () => true),
      setMuted: jest.fn(),
      setSpeaker: jest.fn(),
      playFrame: jest.fn(),
      showIncomingCall: jest.fn(),
      clearIncomingCall: jest.fn(),
      onFrame(cb: (f: string) => void) {
        audio.frameCb = cb;
        return () => {};
      },
      onLevel: () => () => {},
    };
    const notify = {
      show: jest.fn(),
      cancel: jest.fn(),
      cancelAll: jest.fn(),
      ready: jest.fn(async () => []),
      areEnabled: jest.fn(async () => true),
      openChannelSettings: jest.fn(),
      setSecure: jest.fn(),
      isBatteryUnrestricted: jest.fn(async () => true),
      requestBatteryUnrestricted: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    const files = new Map<string, Uint8Array>();
    const mediaNative = {
      filesDir: jest.fn(async () => '/files'),
      allocate: jest.fn(async (p: string, size: number) => {
        files.set(p, new Uint8Array(size));
        return true;
      }),
      readChunk: jest.fn(async (p: string, off: number, len: number) => {
        const d = files.get(p);
        return d ? naclUtil.encodeBase64(d.slice(off, off + len)) : '';
      }),
      writeChunk: jest.fn(async (p: string, off: number, data: string) => {
        const bytes = naclUtil.decodeBase64(data);
        let d = files.get(p) ?? new Uint8Array(0);
        if (d.length < off + bytes.length) {
          const bigger = new Uint8Array(off + bytes.length);
          bigger.set(d);
          d = bigger;
        }
        d.set(bytes, off);
        files.set(p, d);
        return true;
      }),
      fileInfo: jest.fn(async (p: string) => ({exists: files.has(p), size: files.get(p)?.length ?? 0})),
      deleteFile: jest.fn(async (p: string) => files.delete(p)),
      copyFile: jest.fn(async (p: string) => {
        files.set(p + '.copy', (files.get(p) as Uint8Array).slice());
        return p + '.copy';
      }),
      mediaInfo: jest.fn(async () => ({})),
      usage: jest.fn(async () => ({count: files.size, bytes: 0})),
      clearAll: jest.fn(async () => {
        files.clear();
        return true;
      }),
      biometricAvailable: jest.fn(async () => false),
      biometricAuth: jest.fn(async () => false),
      restartApp: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    require('react-native').NativeModules.MediaFiles = mediaNative;
    require('react-native').NativeModules.PulseNotify = notify;
    jest.doMock('@/lan/lanManager', () => ({lanManager: {isOnLan: () => false, sendTo: () => false}}));
    jest.doMock('@/services/callAudio', () => ({callAudio: audio}));
    jest.doMock('@/services/permissions', () => ({requestMicrophone: async () => 'granted'}));

    const {getMeshEngine} = require('@/mesh/bleManager');
    const engine = getMeshEngine(bus.add(id));
    const {getIdentity} = require('@/services/identity');
    const session = require('@/store/sessionStore').useSessionStore;
    session.setState({profileName: `Phone ${id}`});
    api = {
      id,
      audio,
      notify,
      files,
      session,
      engine,
      pub: getIdentity().publicKey as string,
      chat: require('@/store/chatStore').useChatStore,
      pairing: require('@/store/pairingStore').usePairingStore,
      groups: require('@/store/groupsStore').useGroupsStore,
      peers: require('@/store/peersStore').usePeersStore,
      call: require('@/store/callStore').useCallStore,
      prefs: require('@/store/prefsStore').usePrefsStore,
      settings: require('@/store/settingsStore').useSettingsStore,
      bridge: require('@/services/notificationBridge'),
    };
  });
  return api;
}

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
    p.call.getState().init();
  }
  // A and C have already paired with each other (they are friends; B is just a stranger in between).
  A.pairing.setState({paired: [{publicKey: C.pub, name: 'Phone C', pairedAt: 1}]});
  C.pairing.setState({paired: [{publicKey: A.pub, name: 'Phone A', pairedAt: 1}]});
  return {bus, A, B, C};
}

describe('A talks to C through B (A and C never in range of each other)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('delivers a chat message A → B → C and confirms delivery back, via the relay', async () => {
    const {bus, A, B, C} = await setup();
    bus.link('A', 'B');
    bus.link('B', 'C');

    await A.chat.getState().sendText(C.pub, 'direct', 'hello C');
    await tick(50);

    const atC = C.chat.getState().byConversation[A.pub] ?? [];
    expect(atC).toHaveLength(1);
    expect(atC[0].text).toBe('hello C');
    expect(atC[0].hops).toBe(1); // came through exactly one relay

    const atA = A.chat.getState().byConversation[C.pub];
    expect(atA[0].status).toBe('delivered'); // C's phone confirmed it
    expect(atA[0].hops).toBe(1);
    expect(Object.keys(A.chat.getState().outbox)).toHaveLength(0); // nothing left to retry

    // The phone in the middle carried it but never got a chat of its own.
    expect(Object.keys(B.chat.getState().byConversation)).toHaveLength(0);
  });

  it('a message sent while C is out of everyone’s range waits on the relay and arrives later', async () => {
    const {bus, A, B, C} = await setup();
    bus.link('A', 'B'); // C is far away

    await A.chat.getState().sendText(C.pub, 'direct', 'catch you later');
    await tick(50);
    expect(C.chat.getState().byConversation[A.pub] ?? []).toHaveLength(0);
    expect(A.chat.getState().byConversation[C.pub][0].status).toBe('sent'); // not delivered yet — honest
    expect(B.engine.carriedCount).toBeGreaterThan(0); // B is holding it

    await tick(90_000); // a minute and a half passes; sender retries in the background
    bus.link('B', 'C'); // C walks into B's range
    await tick(15_000);

    const atC = C.chat.getState().byConversation[A.pub] ?? [];
    expect(atC.map((m: {text?: string}) => m.text)).toEqual(['catch you later']); // once, not duplicated by retries
    expect(A.chat.getState().byConversation[C.pub][0].status).toBe('delivered');
  });

  it('keeps retrying until delivered, then stops', async () => {
    const {bus, A, C} = await setup();
    // No links at all: A is alone.
    await A.chat.getState().sendText(C.pub, 'direct', 'anyone?');
    expect(Object.keys(A.chat.getState().outbox)).toHaveLength(1);
    await tick(120_000);
    const pending = Object.values(A.chat.getState().outbox) as {tries: number}[];
    expect(pending[0].tries).toBeGreaterThan(1);

    bus.link('A', 'B');
    bus.link('B', 'C');
    await tick(30_000);
    expect(Object.keys(A.chat.getState().outbox)).toHaveLength(0);
    expect(C.chat.getState().byConversation[A.pub]).toHaveLength(1);
  });

  it('streams a photo A → B → C and C reassembles it exactly', async () => {
    const {bus, A, C} = await setup();
    bus.link('A', 'B');
    bus.link('B', 'C');
    const photo = 'QUJD'.repeat(9000); // ~36k chars -> 3 chunks
    await A.chat.getState().sendImage(C.pub, 'direct', photo);
    await tick(100);
    const got = C.chat.getState().byConversation[A.pub][0];
    expect(got.image).toBe(photo);
    expect(A.chat.getState().byConversation[C.pub][0].status).toBe('delivered');
  });

  it('shows C in A’s people list as “1 relay away” from presence relayed through B', async () => {
    const {bus, A, B, C} = await setup();
    bus.link('A', 'B');
    bus.link('B', 'C');
    for (const p of [A, B, C]) {
      p.peers.getState().start();
    }
    await tick(1_000);
    const seenFromA = A.peers.getState().peers;
    expect(seenFromA[B.pub].hops).toBe(0);
    expect(seenFromA[C.pub].hops).toBe(1);
  });

  it('rings C through B: signalling, encrypted audio frames, and hang-up', async () => {
    const {bus, A, C} = await setup();
    bus.link('A', 'B');
    bus.link('B', 'C');

    await A.call.getState().start(C.pub, 'Phone C');
    await tick(100);
    expect(A.call.getState().phase).toBe('outgoing');
    expect(C.call.getState().phase).toBe('incoming');
    expect(C.call.getState().peerName).toBe('Phone A');
    expect(C.audio.showIncomingCall).toHaveBeenCalled();

    await C.call.getState().accept();
    await tick(100);
    expect(A.call.getState().phase).toBe('active');
    expect(C.call.getState().phase).toBe('active');
    // Both ends derived the SAME key without ever sending it.
    const keyA = (A.audio.start as jest.Mock).mock.calls[0][0];
    const keyC = (C.audio.start as jest.Mock).mock.calls[0][0];
    expect(keyA).toBe(keyC);
    expect((A.audio.start as jest.Mock).mock.calls[0][1]).toBe(0);
    expect((C.audio.start as jest.Mock).mock.calls[0][1]).toBe(1);

    // A speaks: the native engine hands JS an encrypted frame; it must reach C's speaker via B.
    A.audio.frameCb!('ZW5jcnlwdGVkLWZyYW1l');
    await tick(50);
    expect(C.audio.playFrame).toHaveBeenCalledWith('ZW5jcnlwdGVkLWZyYW1l');
    expect(C.call.getState().hops).toBe(1);

    A.call.getState().hangup();
    await tick(2_000);
    expect(C.audio.stop).toHaveBeenCalled();
    expect(['ended', 'idle']).toContain(C.call.getState().phase);
  });

  it('mute and hang-up work mid-call and shut the audio engine down on both ends', async () => {
    const {bus, A, C} = await setup();
    bus.link('A', 'B');
    bus.link('B', 'C');
    await A.call.getState().start(C.pub, 'Phone C');
    await tick(100);
    await C.call.getState().accept();
    await tick(100);

    A.call.getState().toggleMute();
    expect(A.call.getState().muted).toBe(true);
    expect(A.audio.setMuted).toHaveBeenLastCalledWith(true);
    A.call.getState().toggleMute();
    expect(A.audio.setMuted).toHaveBeenLastCalledWith(false);
    A.call.getState().toggleSpeaker();
    expect(A.audio.setSpeaker).toHaveBeenLastCalledWith(true);

    C.call.getState().hangup(); // the other side ends it this time
    await tick(500);
    expect(A.call.getState().phase).toBe('ended');
    expect(A.audio.stop).toHaveBeenCalled();
    expect(C.audio.stop).toHaveBeenCalled();
    await tick(3_000);
    expect(A.call.getState().phase).toBe('idle'); // fully cleaned up, ready for the next call
    expect(C.call.getState().phase).toBe('idle');
  });

  it('only people you have paired with can ring you', async () => {
    const {bus, A, C} = await setup();
    bus.link('A', 'B');
    bus.link('B', 'C');
    C.pairing.setState({paired: []}); // C no longer knows A
    // A can still try (it believes they are paired)...
    await A.call.getState().start(C.pub, 'Phone C');
    await tick(100);
    expect(C.call.getState().phase).toBe('idle'); // ...but C's phone stays silent
    expect(C.audio.showIncomingCall).not.toHaveBeenCalled();
  });

  it('marks the call missed if nobody answers', async () => {
    const {bus, A, C} = await setup();
    bus.link('A', 'B');
    bus.link('B', 'C');
    await A.call.getState().start(C.pub, 'Phone C');
    await tick(45_500); // just past the 45 s ring window
    expect(A.call.getState().endReason).toBe('No answer');
    expect(C.call.getState().endReason).toBe('Missed call');
  });
});

describe('notifications, privacy and chat controls (A — B — C)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function linked() {
    const s = await setup();
    s.bus.link('A', 'B');
    s.bus.link('B', 'C');
    return s;
  }

  it('raises a real Android notification with Reply and Mark-as-read for a relayed message', async () => {
    const {A, C} = await linked();
    await A.chat.getState().sendText(C.pub, 'direct', 'hello C');
    await tick(50);
    expect(C.notify.show).toHaveBeenCalledTimes(1);
    const n = C.notify.show.mock.calls[0][0];
    expect(n.channel).toBe('messages');
    expect(n.title).toBe('Phone A');
    expect(n.text).toBe('hello C');
    expect(n.convId).toBe(A.pub);
    expect(n.actions.map((a: {id: string}) => a.id)).toEqual(['reply', 'read']);
    expect(n.silent).toBe(false);
    expect(n.hideText).toBe(false);
  });

  it('respects “sound off” and “hide message text”', async () => {
    const {A, C} = await linked();
    C.settings.getState().setApp({notifyAlert: false, notifyPreview: false});
    await A.chat.getState().sendText(C.pub, 'direct', 'secret plan');
    await tick(50);
    const n = C.notify.show.mock.calls[0][0];
    expect(n.silent).toBe(true);
    expect(n.hideText).toBe(true);
  });

  it('a muted chat gets no notification, but the message still arrives', async () => {
    const {A, C} = await linked();
    C.prefs.getState().mute(A.pub, 3600_000);
    await A.chat.getState().sendText(C.pub, 'direct', 'shh');
    await tick(50);
    expect(C.notify.show).not.toHaveBeenCalled();
    expect(C.chat.getState().byConversation[A.pub]).toHaveLength(1);
  });

  it('a blocked person cannot reach you; unblocking lets the waiting message through', async () => {
    const {A, C} = await linked();
    C.prefs.getState().patch(A.pub, {blocked: true});
    await A.chat.getState().sendText(C.pub, 'direct', 'are you there?');
    await tick(50);
    expect(C.chat.getState().byConversation[A.pub] ?? []).toHaveLength(0);
    expect(C.notify.show).not.toHaveBeenCalled();

    C.prefs.getState().patch(A.pub, {blocked: false});
    await tick(15_000); // A's outbox retries
    expect(C.chat.getState().byConversation[A.pub]).toHaveLength(1);
  });

  it('delete for everyone removes the message on both phones and it cannot come back', async () => {
    const {A, C} = await linked();
    await A.chat.getState().sendText(C.pub, 'direct', 'oops wrong chat');
    await tick(50);
    const id = A.chat.getState().byConversation[C.pub][0].id;
    expect(C.chat.getState().byConversation[A.pub]).toHaveLength(1);

    A.chat.getState().deleteForEveryone(C.pub, 'direct', id);
    await tick(100);
    expect(A.chat.getState().byConversation[C.pub]).toHaveLength(0);
    expect(C.chat.getState().byConversation[A.pub]).toHaveLength(0);
    expect(C.chat.getState().tombstones[`${A.pub}:${id}`]).toBeTruthy();
  });

  it('delete for me only removes it locally', async () => {
    const {A, C} = await linked();
    await A.chat.getState().sendText(C.pub, 'direct', 'keep on their side');
    await tick(50);
    const id = C.chat.getState().byConversation[A.pub][0].id;
    C.chat.getState().deleteMany(A.pub, [id]);
    await tick(100);
    expect(C.chat.getState().byConversation[A.pub]).toHaveLength(0);
    expect(A.chat.getState().byConversation[C.pub]).toHaveLength(1);
  });

  it('editing a sent message updates the other phone; only the sender, only for 15 minutes', async () => {
    const {A, C} = await linked();
    await A.chat.getState().sendText(C.pub, 'direct', 'meet at 5');
    await tick(50);
    const id = A.chat.getState().byConversation[C.pub][0].id;

    expect(C.chat.getState().editMessage(A.pub, 'direct', id, 'hacked')).toBe(false); // not their message
    expect(A.chat.getState().editMessage(C.pub, 'direct', id, 'meet at 6')).toBe(true);
    await tick(100);
    const atC = C.chat.getState().byConversation[A.pub][0];
    expect(atC.text).toBe('meet at 6');
    expect(atC.edited).toBe(true);

    await tick(16 * 60 * 1000);
    expect(A.chat.getState().editMessage(C.pub, 'direct', id, 'too late')).toBe(false);
  });

  it('with read receipts off, the sender never sees “seen”', async () => {
    const {A, C} = await linked();
    C.settings.getState().setApp({readReceipts: false});
    await A.chat.getState().sendText(C.pub, 'direct', 'read me');
    await tick(50);
    C.chat.getState().markSeen(A.pub, 'direct');
    await tick(100);
    expect(A.chat.getState().byConversation[C.pub][0].status).toBe('delivered');

    C.settings.getState().setApp({readReceipts: true});
    await A.chat.getState().sendText(C.pub, 'direct', 'and me');
    await tick(50);
    C.chat.getState().markSeen(A.pub, 'direct');
    await tick(100);
    expect(A.chat.getState().byConversation[C.pub][1].status).toBe('seen');
  });

  it('calls switched off for everyone are politely declined', async () => {
    const {A, C} = await linked();
    C.settings.getState().setApp({allowCalls: false});
    await A.call.getState().start(C.pub, 'Phone C');
    await tick(1000);
    expect(C.call.getState().phase).toBe('idle');
    expect(A.call.getState().endReason).toBe('Declined');
  });

  it('calls switched off for one person are declined, and that choice is kept', async () => {
    const {A, C} = await linked();
    C.prefs.getState().patch(A.pub, {allowCalls: false});
    expect(C.prefs.getState().prefs[A.pub].allowCalls).toBe(false);
    await A.call.getState().start(C.pub, 'Phone C');
    await tick(1000);
    expect(A.call.getState().endReason).toBe('Declined');
  });

  it('a blocked caller gets silence', async () => {
    const {A, C} = await linked();
    C.prefs.getState().patch(A.pub, {blocked: true});
    await A.call.getState().start(C.pub, 'Phone C');
    await tick(3000);
    expect(C.call.getState().phase).toBe('idle');
    expect(A.call.getState().phase).toBe('outgoing');
  });

  it('shares the “about me” line and remembers people for offline profiles', async () => {
    const {A, B, C} = await linked();
    A.session.setState({bio: 'Hiker · Seattle'});
    for (const p of [A, B, C]) {
      p.peers.getState().start();
    }
    await tick(11_000); // the first hello went out before the others were listening; wait for the next
    expect(C.peers.getState().peers[A.pub].bio).toBe('Hiker · Seattle');
    const known = C.prefs.getState().profiles[A.pub];
    expect(known.name).toBe('Phone A');
    expect(known.bio).toBe('Hiker · Seattle');
  });

  it('“Appear in Nearby” off keeps a phone quiet, but it still sees others', async () => {
    const {A, B, C} = await linked();
    A.settings.getState().setApp({discoverable: false});
    for (const p of [A, B, C]) {
      p.peers.getState().start();
    }
    await tick(11_000);
    expect(B.peers.getState().peers[A.pub]).toBeUndefined();
    expect(B.peers.getState().peers[C.pub]).toBeDefined(); // others are still visible
    expect(A.peers.getState().peers[B.pub]).toBeDefined(); // and it still sees them
  });

  it('SOS, connect requests and notification buttons all work through Android notifications', async () => {
    const {A, B, C} = await linked();
    for (const p of [A, B, C]) {
      p.bridge.startNotificationBridge();
    }

    // SOS nearby -> loud notification with a map button
    C.settings.getState().raiseResponderAlert({id: 's1', at: Date.now(), name: 'Priya', lat: 47.6, lng: -122.3});
    type Shown = {channel: string; kind: string; actions: {id: string}[]};
    const sos = C.notify.show.mock.calls.map((c: unknown[]) => c[0] as Shown).find((n: Shown) => n.channel === 'sos');
    expect(sos).toBeDefined();
    expect(sos.actions.map((a: {id: string}) => a.id)).toContain('map');

    // B asks A to connect -> notification with Accept; pressing it pairs them
    B.pairing.getState().request({publicKey: A.pub, name: 'Phone A', lastSeen: 1, hops: 0});
    await tick(100);
    const req = A.notify.show.mock.calls.map((c: unknown[]) => c[0] as Shown).find((n: Shown) => n.channel === 'requests');
    expect(req.kind).toBe('pair');
    expect(req.actions.map((a: {id: string}) => a.id)).toEqual(['ignore', 'accept']);
    A.bridge.handleAction({action: 'accept', kind: 'pair', conv: B.pub});
    expect(A.pairing.getState().isPaired(B.pub)).toBe(true);

    // A reply typed into the notification arrives as a normal message
    A.bridge.handleAction({action: 'reply', kind: 'direct', conv: C.pub, text: 'on my way'});
    await tick(100);
    expect(C.chat.getState().byConversation[A.pub].map((m: {text?: string}) => m.text)).toContain('on my way');
  });
});

describe('pairing is required, photo privacy and disappearing messages (A — B — C)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function linked() {
    const s = await setup();
    s.bus.link('A', 'B');
    s.bus.link('B', 'C');
    return s;
  }

  it('a stranger cannot start a chat: direct messages from people you have not connected with are dropped', async () => {
    const {A, B} = await linked();
    // B has never paired with A, so B must not receive a direct message from A even though they're in range.
    // (A can't even try: it doesn't hold B as a connection.)
    await A.chat.getState().sendText(B.pub, 'direct', 'hi stranger');
    await tick(100);
    expect(A.chat.getState().byConversation[B.pub] ?? []).toHaveLength(0); // never sent
    expect(B.chat.getState().byConversation[A.pub] ?? []).toHaveLength(0);
    expect(B.notify.show).not.toHaveBeenCalled();
  });

  it('even a hand-made packet from an unpaired phone is ignored by the receiver', async () => {
    const {A, C} = await linked();
    C.pairing.setState({paired: []}); // C forgot A, but A still believes they are connected
    await A.chat.getState().sendText(C.pub, 'direct', 'are you there');
    await tick(100);
    expect(C.chat.getState().byConversation[A.pub] ?? []).toHaveLength(0);
    expect(C.notify.show).not.toHaveBeenCalled();
  });

  it('group invites only reach people you are connected with', async () => {
    const {A, B, C} = await linked();
    A.groups.getState().create('Trail crew', [B.pub, C.pub]);
    await tick(200);
    expect(C.groups.getState().pendingInvites).toHaveLength(1); // A and C are connected
    expect(B.groups.getState().pendingInvites).toHaveLength(0); // B never connected with A
  });

  it('a spoiler, view-once photo arrives flagged, is deleted after opening, and the sender’s copy goes too', async () => {
    const {A, C} = await linked();
    const photo = 'QUJD'.repeat(3000);
    await A.chat.getState().sendImage(C.pub, 'direct', photo, undefined, {spoiler: true, viewOnce: true});
    await tick(200);
    const atC = C.chat.getState().byConversation[A.pub][0];
    expect(atC.spoiler).toBe(true);
    expect(atC.viewOnce).toBe(true);
    expect(atC.image).toBe(photo);

    C.chat.getState().markOpened(A.pub, 'direct', atC.id);
    await tick(200);
    const after = C.chat.getState().byConversation[A.pub][0];
    expect(after.opened).toBe(true);
    expect(after.image).toBeUndefined();
    const mine = A.chat.getState().byConversation[C.pub][0];
    expect(mine.opened).toBe(true);
    expect(mine.image).toBeUndefined();
  });

  it('a normal photo is not marked spoiler or view-once, and cannot be “opened” away', async () => {
    const {A, C} = await linked();
    await A.chat.getState().sendImage(C.pub, 'direct', 'QUJD'.repeat(3000));
    await tick(200);
    const atC = C.chat.getState().byConversation[A.pub][0];
    expect(atC.spoiler).toBeUndefined();
    expect(atC.viewOnce).toBeUndefined();
    C.chat.getState().markOpened(A.pub, 'direct', atC.id);
    expect(C.chat.getState().byConversation[A.pub][0].image).toBeDefined();
  });

  it('disappearing messages: the timer syncs to the other phone and old messages are removed (starred ones stay)', async () => {
    const {A, C} = await linked();
    A.chat.getState().setDisappear(C.pub, 'direct', 24 * 3600_000);
    await tick(200);
    expect(A.prefs.getState().prefs[C.pub].disappear).toBe(24 * 3600_000);
    expect(C.prefs.getState().prefs[A.pub].disappear).toBe(24 * 3600_000); // the other side follows

    await A.chat.getState().sendText(C.pub, 'direct', 'this will vanish');
    await A.chat.getState().sendText(C.pub, 'direct', 'this one I keep');
    await tick(200);
    const keepId = A.chat.getState().byConversation[C.pub][1].id;
    A.chat.getState().toggleStar(C.pub, keepId);
    expect(C.chat.getState().byConversation[A.pub][0].expiresAt).toBeDefined();

    jest.setSystemTime(Date.now() + 24 * 3600_000 + 10_000); // a day passes
    await tick(6_000); // the cleanup runs every few seconds
    expect(A.chat.getState().byConversation[C.pub].map((m: {text?: string}) => m.text)).toEqual(['this one I keep']);
    // A star is private to each phone: C never starred it, so C's copy is gone.
    expect(C.chat.getState().byConversation[A.pub]).toHaveLength(0);
  });

  it('only the offered timers are accepted from the other side', async () => {
    const {A, C} = await linked();
    // A forges a nonsense timer by sending the event directly.
    A.chat.getState().setDisappear(C.pub, 'direct', 5); // 5 ms is not an offered choice
    await tick(200);
    expect(C.prefs.getState().prefs[A.pub]?.disappear).toBeUndefined();
  });
});

describe('files, voice notes, typing and notes to self (A — B — C)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function linked() {
    const s = await setup();
    s.bus.link('A', 'B');
    s.bus.link('B', 'C');
    return s;
  }

  const makeBytes = (n: number) => Uint8Array.from({length: n}, (_, i) => (i * 31 + 7) % 256);
  const putFile = (phone: {files: Map<string, Uint8Array>}, path: string, bytes: Uint8Array) => phone.files.set(path, bytes);

  it('sends a file A → B → C and C stores exactly the same bytes; delivery is confirmed', async () => {
    const {A, C} = await linked();
    const bytes = makeBytes(60_000); // 7 pieces
    putFile(A, '/files/1_report.pdf', bytes);
    await A.chat.getState().sendFile(C.pub, 'direct', {path: '/files/1_report.pdf', name: 'report.pdf', size: bytes.length, mime: 'application/pdf'});
    await tick(300);

    const atC = C.chat.getState().byConversation[A.pub][0];
    expect(atC.type).toBe('file');
    expect(atC.file.name).toBe('report.pdf');
    expect(atC.file.done).toBe(true);
    expect(atC.progress).toBeUndefined();
    expect(naclUtil.encodeBase64(C.files.get(atC.file.path) as Uint8Array)).toBe(naclUtil.encodeBase64(bytes));
    expect(A.chat.getState().byConversation[C.pub][0].status).toBe('delivered');
    expect(C.notify.show.mock.calls[0][0].text).toBe('report.pdf');
  });

  it('recovers when some pieces are lost on the way (the receiver asks for them again)', async () => {
    const {bus, A, C} = await linked();
    const bytes = makeBytes(120_000);
    putFile(A, '/files/2_video.mp4', bytes);
    let n = 0;
    bus.drop = to => to === 'C' && ++n % 3 === 0; // every third packet to C is lost
    await A.chat.getState().sendFile(C.pub, 'direct', {path: '/files/2_video.mp4', name: 'trip.mp4', size: bytes.length, mime: 'video/mp4'});
    await tick(200);
    bus.drop = null;
    await tick(60_000);

    const atC = C.chat.getState().byConversation[A.pub][0];
    expect(atC.file.kind).toBe('video');
    expect(atC.file.done).toBe(true);
    expect(naclUtil.encodeBase64(C.files.get(atC.file.path) as Uint8Array)).toBe(naclUtil.encodeBase64(bytes));
  });

  it('a voice note arrives as a voice message with its length', async () => {
    const {A, C} = await linked();
    const bytes = makeBytes(20_000);
    putFile(A, '/files/voice-1.m4a', bytes);
    await A.chat.getState().sendVoice(C.pub, 'direct', {path: '/files/voice-1.m4a', durationMs: 23_000, size: bytes.length});
    await tick(300);
    const atC = C.chat.getState().byConversation[A.pub][0];
    expect(atC.file.kind).toBe('voice');
    expect(atC.file.dur).toBe(23_000);
    expect(atC.file.done).toBe(true);
    expect(C.notify.show.mock.calls[0][0].text).toBe('Voice message');
  });

  it('refuses files that are too big, empty, or for someone you are not connected with', async () => {
    const {A, B, C} = await linked();
    putFile(A, '/files/big.bin', makeBytes(10));
    await A.chat.getState().sendFile(C.pub, 'direct', {path: '/files/big.bin', name: 'big.bin', size: 26 * 1024 * 1024, mime: 'application/octet-stream'});
    await A.chat.getState().sendFile(C.pub, 'direct', {path: '/files/big.bin', name: 'empty', size: 0, mime: 'text/plain'});
    await A.chat.getState().sendFile(B.pub, 'direct', {path: '/files/big.bin', name: 'x', size: 10, mime: 'text/plain'});
    await tick(100);
    expect(A.chat.getState().byConversation[C.pub] ?? []).toHaveLength(0);
    expect(A.chat.getState().byConversation[B.pub] ?? []).toHaveLength(0);
  });

  it('deleting a file message (or the whole chat) deletes the file from the phone', async () => {
    const {A, C} = await linked();
    putFile(A, '/files/3_a.txt', makeBytes(5_000));
    await A.chat.getState().sendFile(C.pub, 'direct', {path: '/files/3_a.txt', name: 'a.txt', size: 5_000, mime: 'text/plain'});
    await tick(300);
    const m = C.chat.getState().byConversation[A.pub][0];
    expect(C.files.has(m.file.path)).toBe(true);
    C.chat.getState().deleteMany(A.pub, [m.id]);
    await tick(10);
    expect(C.files.has(m.file.path)).toBe(false);

    A.chat.getState().deleteForEveryone(C.pub, 'direct', A.chat.getState().byConversation[C.pub][0].id);
    await tick(10);
    expect(A.files.has('/files/3_a.txt')).toBe(false);
  });

  it('forwarding a file gives the other chat its own copy of the file', async () => {
    const {A, C} = await linked();
    putFile(A, '/files/4_doc.txt', makeBytes(3_000));
    await A.chat.getState().sendFile(C.pub, 'direct', {path: '/files/4_doc.txt', name: 'doc.txt', size: 3_000, mime: 'text/plain'});
    await tick(300);
    const m = A.chat.getState().byConversation[C.pub][0];
    await A.chat.getState().forwardMessage(C.pub, 'direct', m);
    await tick(300);
    const list = A.chat.getState().byConversation[C.pub];
    expect(list).toHaveLength(2);
    expect(list[1].file.path).not.toBe(list[0].file.path);
    expect(A.files.has(list[0].file.path)).toBe(true);
  });

  it('notes to self: text and files stay on the phone and nothing goes on the air', async () => {
    const {A, B} = await linked();
    await A.chat.getState().sendText(A.pub, 'direct', 'remember the code 4417');
    putFile(A, '/files/5_n.txt', makeBytes(2_000));
    await A.chat.getState().sendFile(A.pub, 'direct', {path: '/files/5_n.txt', name: 'n.txt', size: 2_000, mime: 'text/plain'});
    await tick(500);
    const list = A.chat.getState().byConversation[A.pub];
    expect(list.map((m: {type: string}) => m.type)).toEqual(['text', 'file']);
    expect(list[1].file.done).toBe(true);
    expect(Object.keys(A.chat.getState().outbox)).toHaveLength(0);
    expect(Object.keys(B.chat.getState().byConversation)).toHaveLength(0);
    expect(B.engine.carriedCount).toBe(0);
  });

  it('“typing…” reaches the other person, clears when they send, and respects the setting', async () => {
    const {A, C} = await linked();
    A.chat.getState().setTyping(C.pub, true);
    await tick(100);
    expect(C.chat.getState().typing[A.pub]).toBeGreaterThan(Date.now());

    A.chat.getState().setTyping(C.pub, false);
    await tick(100);
    expect(C.chat.getState().typing[A.pub]).toBe(0);

    // it also stops on its own
    await tick(3_100);
    A.chat.getState().setTyping(C.pub, true);
    await tick(100);
    await tick(7_000);
    expect(C.chat.getState().typing[A.pub]).toBe(0);

    // receiver turned the feature off: nothing is shown
    C.settings.getState().setApp({typingIndicator: false});
    await tick(3_100);
    A.chat.getState().setTyping(C.pub, true);
    await tick(100);
    expect(C.chat.getState().typing[A.pub]).toBe(0);
  });

  it('typing is never stored or carried by the phone in the middle', async () => {
    const {A, B, C} = await linked();
    A.chat.getState().setTyping(C.pub, true);
    await tick(100);
    expect(B.engine.carriedCount).toBe(0);
    expect(C.chat.getState().typing[A.pub]).toBeGreaterThan(0);
  });
});
