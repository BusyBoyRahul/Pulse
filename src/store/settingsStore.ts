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
  shareAvatar: boolean;
  acceptRequests: boolean; // let new people send connect requests
  secureScreen: boolean; // block screenshots + hide in recent apps
  // chats
  wallpaper: 'default' | 'black' | 'slate' | 'dusk' | 'dots' | 'photo';
  // calls
  allowCalls: boolean;
  callSpeaker: boolean; // start calls on the loudspeaker
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
  acceptRequests: true,
  secureScreen: false,
  wallpaper: 'default',
  allowCalls: true,
  callSpeaker: false,
};

const APP_KEY = 'settings.app';

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
      app: {...DEFAULT_APP_SETTINGS, ...getJSON<Partial<AppSettings>>(APP_KEY, {})},
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
