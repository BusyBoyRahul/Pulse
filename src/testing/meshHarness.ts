/**
 * Test harness: virtual phones, each with its OWN identity, storage, stores and
 * mesh engine, wired together by a fake radio (Bus). Everything is the real app
 * code; only the radio, the microphone and the native modules are faked.
 */
import naclUtil from 'tweetnacl-util';
import type {MeshTransport, TransportState} from '@/mesh/transport/types';
import type {NearbyDevice} from '@/types';

export class Bus {
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

export type NetHubs = {relay: import('./fakeNet').FakeRelayHub; rtc: import('./fakeNet').FakeRtcHub};

/**
 * A virtual phone. With `net` it also has the internet road (fake public relays +
 * fake WebRTC) next to the Bluetooth/Wi-Fi one, exactly as the real app does.
 */
export function makePhone(id: string, bus: Bus, net?: NetHubs) {
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
    const {getIdentity} = require('@/services/identity');
    let internet: any;
    let transport = bus.add(id) as any;
    if (net) {
      const {InternetTransport} = require('@/net/internetTransport');
      const {RelayPool} = require('@/net/nostr');
      const {MultiTransport} = require('@/mesh/transport/MultiTransport');
      const {setInternetAllow, isInternetAllowed} = require('@/net/internet');
      const pairingStore = require('@/store/pairingStore').usePairingStore; // resolved now, inside this phone's own module set
      const pairingGetter = () => pairingStore.getState();
      setInternetAllow((k: string) => pairingGetter().isPaired(k));
      // the same rule the app uses: my connections, plus the other members of my groups
      internet = new InternetTransport({
        pool: new RelayPool(['wss://relay-one.test', 'wss://relay-two.test'], net.relay.factory),
        rtc: net.rtc,
        me: () => getIdentity(),
        allow: (k: string) => isInternetAllowed(k),
      });
      transport = new MultiTransport([transport, internet]);
      const {attachInternetCalls} = require('@/net/internetCall');
      attachInternetCalls({
        sig: internet.sig,
        rtc: net.rtc,
        me: () => getIdentity().publicKey,
        iceServers: () => [],
        allow: (k: string) => pairingGetter().isPaired(k),
        nameOf: (k: string) => k.slice(0, 6),
        onIncoming: () => undefined,
      });
    }
    const engine = getMeshEngine(transport);
    const session = require('@/store/sessionStore').useSessionStore;
    session.setState({profileName: `Phone ${id}`});
    api = {
      id,
      audio,
      notify,
      files,
      session,
      engine,
      internet,
      profile: require('@/services/profileSync'),
      callLog: require('@/services/callLog'),
      logStore: require('@/store/callLogStore').useCallLogStore,
      icall: net ? require('@/net/internetCall').useInternetCallStore : undefined,
      pub: getIdentity().publicKey as string,
      chat: require('@/store/chatStore').useChatStore,
      pairing: require('@/store/pairingStore').usePairingStore,
      groups: require('@/store/groupsStore').useGroupsStore,
      peers: require('@/store/peersStore').usePeersStore,
      call: require('@/store/callStore').useCallStore,
      prefs: require('@/store/prefsStore').usePrefsStore,
      secret: require('@/store/secretStore').useSecretStore,
      status: require('@/store/statusStore').useStatusStore,
      settings: require('@/store/settingsStore').useSettingsStore,
      bridge: require('@/services/notificationBridge'),
    };
  });
  return api;
}

