import {create} from 'zustand';
import {storage, StorageKeys, getJSON, setJSON} from '@/services/storage';

export type ResponderAlert = {
  id: string;
  at: number;
  name?: string;
  lat?: number;
  lng?: number;
  note?: string;
};

/** Who may see a piece of my profile. */
export type Audience = 'everyone' | 'connections' | 'nobody';

/** Everything the user can switch in Settings (besides the SOS-alert toggle). */
export type AppSettings = {
  // notifications (the ones in the phone's notification shade)
  notifyMessages: boolean;
  notifyPreview: boolean; // show the message text in the notification
  notifyAlert: boolean; // sound + vibration (off = silent notifications)
  notifyRequests: boolean; // connect requests and group invites
  quietOn: boolean;
  quietFrom: number; // minutes after midnight
  quietTo: number;
  // privacy
  readReceipts: boolean;
  /** Show "typing…" to others and see theirs. */
  typingIndicator: boolean;
  discoverable: boolean; // appear in other people's Nearby list
  shareAvatar: boolean; // (older switch, now photoAudience)
  /** Who sees my profile photo: everyone nearby / only my connections / nobody. */
  photoAudience: Audience;
  /** Who sees my "about" line. */
  aboutAudience: Audience;
  /** Who sees my Status: all my connections / all except the ones switched off / only the ones switched on. */
  statusAudience: 'all' | 'except' | 'only';
  acceptRequests: boolean; // let new people send connect requests
  meshOn: boolean; // the Bluetooth / Wi-Fi mesh switch on the Nearby tab (off until the person turns it on)
  /** Set once the mesh switch has been put to "off" for this account (it used to start on by itself and turn Wi-Fi on). */
  meshDefault: boolean;
  /** Rule: when the phone's Wi-Fi turns on, switch the mesh on too. Off unless the person chooses it (some people never want the mesh). */
  meshAutoOnWifi: boolean;
  secureScreen: boolean; // block screenshots + hide in recent apps
  // chats
  wallpaper: 'default' | 'black' | 'slate' | 'dusk' | 'dots' | 'photo';
  /** How strongly a photo wallpaper shows (0.25..1) and how blurred it is (0 = sharp). No tint is laid over it. */
  wallpaperOpacity: number;
  wallpaperBlur: number;
  // calls
  allowCalls: boolean;
  callSpeaker: boolean; // start calls on the loudspeaker
  // internet: off, only while Pulse is open, or always connected in the background
  internetMode: 'off' | 'whenOpen' | 'always';
  /** Set once the "stay connected in the background" default has been applied to this account. */
  bgDefault: boolean;
  /** Public relay addresses, separated by spaces (blank = the built-in ones). */
  relays: string;
  /** Optional relay server for strict networks (turn:host:3478). */
  turnUrl: string;
  turnUser: string;
  turnPass: string;
  /** People can find me by @username / hashed number (off until I choose). */
  findByUsername: boolean;
  findByNumber: boolean;
  username: string;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  notifyMessages: true,
  notifyPreview: true,
  notifyAlert: true,
  notifyRequests: true,
  quietOn: false,
  quietFrom: 22 * 60,
  quietTo: 7 * 60,
  readReceipts: true,
  typingIndicator: true,
  discoverable: true,
  shareAvatar: true,
  photoAudience: 'everyone',
  aboutAudience: 'everyone',
  statusAudience: 'all',
  acceptRequests: true,
  meshOn: false,
  meshDefault: true,
  meshAutoOnWifi: false,
  secureScreen: false,
  wallpaper: 'default',
  wallpaperOpacity: 1,
  wallpaperBlur: 0,
  allowCalls: true,
  callSpeaker: false,
  internetMode: 'always',
  bgDefault: true,
  relays: '',
  turnUrl: '',
  turnUser: '',
  turnPass: '',
  findByUsername: false,
  findByNumber: false,
  username: '',
};

const APP_KEY = 'settings.app';

/** Older versions only had "share my photo" on/off: keep what the person chose. */
function migrate(merged: AppSettings, saved: Partial<AppSettings>): AppSettings {
  // The mesh used to start by itself (and Android turned Wi-Fi/Bluetooth on for it). It is off now until the person switches it on
  // on the Nearby tab: accounts made before this move to "off" once; anything chosen afterwards is kept.
  if (saved.meshDefault === undefined) {
    merged = {...merged, meshOn: false, meshDefault: true};
  }
  // Messages and calls should reach you with Pulse closed: older accounts that were on "only while open" move to "always"
  // once (anyone who switched the internet off keeps it off, and can still change it any time).
  if (saved.bgDefault === undefined && saved.internetMode !== undefined) {
    merged = {...merged, internetMode: saved.internetMode === 'off' ? 'off' : 'always', bgDefault: true};
  }
  if (saved.photoAudience === undefined && saved.shareAvatar === false) {
    return {...merged, photoAudience: 'connections'};
  }
  return merged;
}

type SettingsState = {
  responderMode: boolean;
  responderAlert: ResponderAlert | null;
  app: AppSettings;

  hydrate: () => void;
  setResponderMode: (on: boolean) => void;
  setApp: (patch: Partial<AppSettings>) => void;
  raiseResponderAlert: (alert: ResponderAlert) => void;
  dismissResponderAlert: () => void;
};

/**
 * Privacy + responder settings.
 *
 * Relaying is ALWAYS silent — a phone passing an SOS along shows nothing. This
 * store only governs the opt-in "Community Responder" experience, where a user
 * chooses to be shown a redacted "someone nearby may need help" alert. Off by
 * default.
 */
export const useSettingsStore = create<SettingsState>((set, get) => ({
  // Nearby-SOS alerts default ON: the whole point of an SOS is that phones
  // around you see it and can help. Users can opt out in Settings.
  responderMode: true,
  responderAlert: null,
  app: DEFAULT_APP_SETTINGS,

  hydrate: () => {
    set({
      responderMode: storage.getBoolean(StorageKeys.responderMode) ?? true,
      app: migrate({...DEFAULT_APP_SETTINGS, ...getJSON<Partial<AppSettings>>(APP_KEY, {})}, getJSON<Partial<AppSettings>>(APP_KEY, {})),
    });
  },

  setResponderMode: (on: boolean) => {
    storage.set(StorageKeys.responderMode, on);
    set({responderMode: on, responderAlert: null});
  },

  setApp: patch => {
    const app = {...get().app, ...patch};
    setJSON(APP_KEY, app);
    set({app});
  },

  raiseResponderAlert: (alert: ResponderAlert) => set({responderAlert: alert}),
  dismissResponderAlert: () => set({responderAlert: null}),
}));

/** True when `now` falls inside the user's quiet hours (handles ranges past midnight). */
export function inQuietHours(app: AppSettings, now: Date = new Date()): boolean {
  if (!app.quietOn) {
    return false;
  }
  const m = now.getHours() * 60 + now.getMinutes();
  return app.quietFrom <= app.quietTo ? m >= app.quietFrom && m < app.quietTo : m >= app.quietFrom || m < app.quietTo;
}
