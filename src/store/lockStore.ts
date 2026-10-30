import {create} from 'zustand';
import {AppState} from 'react-native';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {getJSON, setJSON} from '@/services/storage';
import {mediaFiles} from '@/services/mediaFiles';
import {consumeExternal} from '@/services/appLifecycle';
import {usePrefsStore} from './prefsStore';

/**
 * The PIN behind "App lock" and "Lock chat". The PIN is never stored — only a salted,
 * stretched hash, itself encrypted at rest (the "chat." storage prefix). Wrong guesses
 * are slowed down: 5 misses = a 30-second wait.
 */
const LOCK_KEY = 'chat.lock';
const STRETCH = 2000;
const MAX_MISSES = 5;
const WAIT_MS = 30_000;
/** Chats lock again after the app has been away this long. */
const CHAT_RELOCK_MS = 15_000;

export const AUTO_LOCK_CHOICES: {ms: number; label: string}[] = [
  {ms: 30_000, label: 'After 30 seconds'},
  {ms: 60_000, label: 'After 1 minute'},
  {ms: 5 * 60_000, label: 'After 5 minutes'},
  {ms: 15 * 60_000, label: 'After 15 minutes'},
];

type Saved = {
  salt: string;
  hash: string;
  /** Ask for the PIN when opening the whole app. */
  appLock: boolean;
  autoLockMs: number;
  /** Allow fingerprint / face instead of typing the PIN. */
  biometric: boolean;
  misses: number;
  waitUntil: number;
};

export type PinResult = 'ok' | 'wrong' | 'wait';

type LockState = {
  saved: Saved | null;
  hydrated: boolean;
  /** The app is locked right now (this session). */
  appLocked: boolean;
  /** Locked chats opened since the last time the app was away. */
  unlockedChats: Record<string, true>;
  bioAvailable: boolean;

  hydrate: () => void;
  hasPin: () => boolean;
  setPin: (pin: string) => void;
  verify: (pin: string) => PinResult;
  /** Seconds left in a "too many tries" wait (0 = none). */
  waitSeconds: () => number;
  removePin: () => void;
  setAppLock: (on: boolean) => void;
  setAutoLock: (ms: number) => void;
  setBiometric: (on: boolean) => void;
  unlockApp: () => void;
  unlockChat: (id: string) => void;
};

function hashPin(pin: string, salt: string): string {
  let h = nacl.hash(naclUtil.decodeUTF8(`${salt}|${pin}`));
  for (let i = 0; i < STRETCH; i++) {
    h = nacl.hash(h);
  }
  return naclUtil.encodeBase64(h);
}

let watching = false;

export const useLockStore = create<LockState>((set, get) => {
  const persist = (saved: Saved | null) => {
    setJSON(LOCK_KEY, saved);
    set({saved});
  };

  return {
    saved: null,
    hydrated: false,
    appLocked: false,
    unlockedChats: {},
    bioAvailable: false,

    hydrate: () => {
      if (get().hydrated) {
        return;
      }
      const saved = getJSON<Saved | null>(LOCK_KEY, null);
      set({hydrated: true, saved, appLocked: !!saved?.appLock});
      void mediaFiles.biometricAvailable().then(v => set({bioAvailable: v}));
      if (!watching) {
        watching = true;
        let leftAt = 0;
        AppState.addEventListener('change', state => {
          if (state !== 'active') {
            if (!leftAt) {
              leftAt = Date.now();
            }
            return;
          }
          const away = leftAt ? Date.now() - leftAt : 0;
          leftAt = 0;
          // A picker / camera / dialog we opened ourselves doesn't count as leaving.
          if (consumeExternal()) {
            return;
          }
          const s = get().saved;
          if (s && away >= CHAT_RELOCK_MS) {
            set({unlockedChats: {}});
          }
          if (s?.appLock && away >= s.autoLockMs) {
            set({appLocked: true, unlockedChats: {}});
          }
        });
      }
    },

    hasPin: () => !!get().saved,

    setPin: pin => {
      const salt = naclUtil.encodeBase64(nacl.randomBytes(16));
      const prev = get().saved;
      persist({
        salt,
        hash: hashPin(pin, salt),
        appLock: prev?.appLock ?? false,
        autoLockMs: prev?.autoLockMs ?? 60_000,
        biometric: prev?.biometric ?? false,
        misses: 0,
        waitUntil: 0,
      });
    },

    verify: pin => {
      const s = get().saved;
      if (!s) {
        return 'ok';
      }
      if (s.waitUntil > Date.now()) {
        return 'wait';
      }
      if (hashPin(pin, s.salt) === s.hash) {
        if (s.misses) {
          persist({...s, misses: 0, waitUntil: 0});
        }
        return 'ok';
      }
      const misses = s.misses + 1;
      persist(misses >= MAX_MISSES ? {...s, misses: 0, waitUntil: Date.now() + WAIT_MS} : {...s, misses});
      return misses >= MAX_MISSES ? 'wait' : 'wrong';
    },

    waitSeconds: () => {
      const w = get().saved?.waitUntil ?? 0;
      return w > Date.now() ? Math.ceil((w - Date.now()) / 1000) : 0;
    },

    removePin: () => {
      // Without a PIN there's nothing to lock chats with: unlock them all.
      const prefs = usePrefsStore.getState();
      const locked = Object.keys(prefs.prefs).filter(id => prefs.prefs[id].locked);
      prefs.patchMany(locked, {locked: false});
      persist(null);
      set({appLocked: false, unlockedChats: {}});
    },

    setAppLock: on => {
      const s = get().saved;
      if (s) {
        persist({...s, appLock: on});
      }
    },
    setAutoLock: ms => {
      const s = get().saved;
      if (s) {
        persist({...s, autoLockMs: ms});
      }
    },
    setBiometric: on => {
      const s = get().saved;
      if (s) {
        persist({...s, biometric: on});
      }
    },

    unlockApp: () => set({appLocked: false}),
    unlockChat: id => set(state => ({unlockedChats: {...state.unlockedChats, [id]: true}})),
  };
});
