import {AppState, Vibration} from 'react-native';
import {getIdentity} from '@/services/identity';
import {useSettingsStore} from '@/store/settingsStore';
import {DEFAULT_RELAYS, RelayPool} from './nostr';
import {InternetTransport, DEFAULT_ICE} from './internetTransport';
import {createReactNativeRtc} from './reactNativeRtc';
import type {IceServer, Rtc} from './rtcLinks';
import {useNetStore} from './netStore';
import {attachInternetCalls} from './internetCall';
import {displayName} from '@/services/names';
import {callAudio} from '@/services/callAudio';
import {navigationRef} from '@/navigation/ref';

/**
 * The app's one internet connection (public relays + direct links), plus the
 * rule for when it is on: Off, only while Pulse is open, or always (kept alive
 * in the background by the existing foreground service).
 */
export type InternetMode = 'off' | 'whenOpen' | 'always';

let transport: InternetTransport | null = null;
let pairedAllow: (peerKey: string) => boolean = () => false;
/** Other people who may reach me over the internet besides my connections (e.g. the other members of my groups). */
const extraAllow = new Map<string, (peerKey: string) => boolean>();
const allowFn = (peerKey: string): boolean => pairedAllow(peerKey) || [...extraAllow.values()].some(f => f(peerKey));
/** May this person reach me over the internet? (My connections, and the other members of my groups.) */
export const isInternetAllowed = allowFn;

/** The pairing store tells us who is a connected person (only they may open a link to me). */
export function setInternetAllow(fn: (peerKey: string) => boolean): void {
  pairedAllow = fn;
}

/** One more reason to let someone through (kept by name, so calling it again just replaces it). */
export function addInternetAllow(name: string, fn: (peerKey: string) => boolean): void {
  extraAllow.set(name, fn);
}

export function relaysFromSettings(): string[] {
  const raw = useSettingsStore.getState().app.relays.trim();
  const list = raw
    .split(/[\s,]+/)
    .filter(u => /^wss:\/\//.test(u))
    .slice(0, 6);
  return list.length ? list : DEFAULT_RELAYS;
}

export function iceFromSettings(): IceServer[] {
  const a = useSettingsStore.getState().app;
  const servers: IceServer[] = [...DEFAULT_ICE];
  if (/^turns?:/.test(a.turnUrl.trim())) {
    servers.push({urls: a.turnUrl.trim(), username: a.turnUser, credential: a.turnPass});
  }
  return servers;
}

let lazyRtc: Rtc | null = null;
const engine = (): Rtc => (lazyRtc = lazyRtc ?? createReactNativeRtc());

/**
 * The WebRTC the app hands to BOTH the direct chat links and the call engine. It must offer everything the engine can do:
 * links (createPeer) and calls (createCallPeer + getMedia). It used to offer only createPeer, so every call stopped in its
 * first line and the call screen closed again at once.
 */
export const appRtc: Rtc = {
  createPeer: ice => engine().createPeer(ice),
  createCallPeer: ice => {
    const make = engine().createCallPeer;
    if (!make) {
      throw new Error('calls are not supported here');
    }
    return make.call(engine(), ice);
  },
  getMedia: video => {
    const get = engine().getMedia;
    if (!get) {
      return Promise.reject(new Error('calls are not supported here'));
    }
    return get.call(engine(), video);
  },
};
const rtc = appRtc;

export function getInternetTransport(): InternetTransport {
  if (!transport) {
    transport = new InternetTransport({
      pool: new RelayPool(relaysFromSettings()),
      rtc,
      me: () => getIdentity(),
      iceServers: iceFromSettings,
      allow: k => allowFn(k),
    });
    transport.pool.onStatus(n => useNetStore.getState().setRelays(n));
    transport.links.onLink((k, open) => useNetStore.getState().setLinked(k, open));
  }
  return transport;
}

/** Should the internet be on right now, given the chosen mode and whether Pulse is on screen? */
export function shouldBeOn(mode: InternetMode, appActive: boolean): boolean {
  return mode === 'always' || (mode === 'whenOpen' && appActive);
}

/** Turn the internet on/off to match the setting. Safe to call whenever anything changes. */
export async function applyInternetMode(): Promise<void> {
  const mode = useSettingsStore.getState().app.internetMode;
  const t = getInternetTransport();
  t.pool.setRelays(relaysFromSettings());
  await t.setEnabled(shouldBeOn(mode, AppState.currentState === 'active'));
}

let callsAttached = false;
function attachCalls(): void {
  if (callsAttached) {
    return;
  }
  callsAttached = true;
  const t = getInternetTransport();
  attachInternetCalls({
    sig: t.sig,
    rtc,
    me: () => getIdentity().publicKey,
    iceServers: iceFromSettings,
    allow: k => allowFn(k),
    nameOf: k => displayName(k),
    onIncoming: (_k, name, video) => {
      callAudio.showIncomingCall(name, video); // the ringing notification (full screen when locked), with Answer / Decline
      try {
        Vibration.vibrate([0, 700, 500, 700, 500], true); // keeps buzzing until the ring stops
      } catch {
        /* no vibrator */
      }
      if (navigationRef.isReady() && navigationRef.getCurrentRoute()?.name !== 'InternetCall') {
        navigationRef.navigate('InternetCall');
      }
    },
    onRingStop: () => {
      callAudio.clearIncomingCall();
      try {
        Vibration.cancel();
      } catch {
        /* no vibrator */
      }
    },
    setSpeaker: on => callAudio.setSpeaker(on),
    audioOn: speaker => callAudio.sessionStart(speaker),
    audioOff: () => callAudio.sessionStop(),
  });
}

let watching = false;
/** Follow the app going to the background / coming back, and changes to the setting. */
export function watchInternetMode(): void {
  if (watching) {
    return;
  }
  watching = true;
  attachCalls();
  AppState.addEventListener('change', () => void applyInternetMode());
  let last = useSettingsStore.getState().app;
  useSettingsStore.subscribe(s => {
    if (s.app.internetMode !== last.internetMode || s.app.relays !== last.relays) {
      void applyInternetMode();
    }
    last = s.app;
  });
  void applyInternetMode();
}
