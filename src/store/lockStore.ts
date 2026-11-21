import {create} from 'zustand';
import {AppState} from 'react-native';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {getJSON, setJSON} from '@/services/storage';
import {mediaFiles} from '@/services/mediaFiles';
import {consumeExternal} from '@/services/appLifecycle';
import {usePrefsStore} from './prefsStore';

/**
 * Two separate locks, each with its own PIN (never stored — only a salted, stretched hash, itself
 * encrypted at rest through the "chat." storage prefix):
 *  - "app": covers the whole app when Pulse has been away for a while.
 *  - "chat": ONE lock for every locked chat. Locked chats live in a "Locked chats" folder that
 *    opens with this code, and can be hidden from the list.
 * They work independently: either can be on without the other. Wrong guesses are slowed down:
 * 5 misses = a 30-second wait.
 */
const LOCKS_KEY = 'chat.locks';
/** The single shared PIN of earlier versions; moved into the two locks on first start. */
const OLD_LOCK_KEY = 'chat.lock';
const STRETCH = 2000;
const MAX_MISSES = 5;
const WAIT_MS = 30_000;
/** Locked chats lock again after the app has been away this long. */
const CHAT_RELOCK_MS = 15_000;

export const AUTO_LOCK_CHOICES: {ms: number; label: string}[] = [
  {ms: 30_000, label: 'After 30 seconds'},
  {ms: 60_000, label: 'After 1 minute'},
  {ms: 5 * 60_000, label: 'After 5 minutes'},
  {ms: 15 * 60_000, label: 'After 15 minutes'},
];

export type LockKind = 'app' | 'chat';

type Credential = {
  salt: string;
  hash: string;
  /** Allow fingerprint / face instead of typing the PIN. */
  biometric: boolean;
  misses: number;
  waitUntil: number;
};

/** Having an app lock = having this. Turning the app lock off removes it. */
export type AppLock = Credential & {autoLockMs: number};
/** Having a chat lock = having this. */
export type ChatLock = Credential & {
  /** Locked chats are not shown in the list at all; typing the code in chat search opens them. */
  hidden: boolean;
};

type Saved = {app: AppLock | null; chat: ChatLock | null};

export type PinResult = 'ok' | 'wrong' | 'wait';

type LockState = {
  saved: Saved;
  hydrated: boolean;
  /** The app is locked right now (this session). */
  appLocked: boolean;
  /** The locked chats have been opened since the last time the app was away. One unlock covers all of them. */
  chatsUnlocked: boolean;
  bioAvailable: boolean;

  hydrate: () => void;
  hasPin: (kind: LockKind) => boolean;
  setPin: (kind: LockKind, pin: string) => void;
  verify: (kind: LockKind, pin: string) => PinResult;
  /** Like verify, but a wrong guess is not counted. Only for "is this my code?" checks such as the search box. */
  matches: (kind: LockKind, pin: string) => boolean;
  /** Seconds left in a "too many tries" wait (0 = none). */
  waitSeconds: (kind: LockKind) => number;
  removePin: (kind: LockKind) => void;
  setAutoLock: (ms: number) => void;
  setBiometric: (kind: LockKind, on: boolean) => void;
  setHidden: (on: boolean) => void;
  unlockApp: () => void;
  unlockChats: () => void;
  lockChats: () => void;
};

function hashPin(pin: string, salt: string): string {
  let h = nacl.hash(naclUtil.decodeUTF8(`${salt}|${pin}`));
  for (let i = 0; i < STRETCH; i++) {
    h = nacl.hash(h);
  }
  return naclUtil.encodeBase64(h);
}

type OldSaved = {salt: string; hash: string; appLock: boolean; autoLockMs: number; biometric: boolean; misses: number; waitUntil: number};

/** Earlier versions had one PIN for both. Keep each thing working the way it was. */
function migrate(): Saved {
  const old = getJSON<OldSaved | null>(OLD_LOCK_KEY, null);
  if (!old) {
    return {app: null, chat: null};
  }
  const cred: Credential = {salt: old.salt, hash: old.hash, biometric: !!old.biometric, misses: 0, waitUntil: 0};
  const prefs = getJSON<Record<string, {locked?: boolean}>>('chat.prefs', {});
  const hadLockedChats = Object.values(prefs).some(p => p?.locked);
  return {
    app: old.appLock ? {...cred, autoLockMs: old.autoLockMs || 60_000} : null,
    chat: hadLockedChats ? {...cred, hidden: false} : null,
  };
}

let watching = false;

export const useLockStore = create<LockState>((set, get) => {
  const persist = (saved: Saved) => {
    setJSON(LOCKS_KEY, saved);
    set({saved});
  };
  const cred = (kind: LockKind): Credential | null => get().saved[kind];
  const patchCred = (kind: LockKind, p: Partial<Credential>) => {
    const s = get().saved;
    const c = s[kind];
    if (c) {
      persist({...s, [kind]: {...c, ...p}});
    }
  };

  return {
    saved: {app: null, chat: null},
    hydrated: false,
    appLocked: false,
    chatsUnlocked: false,
    bioAvailable: false,

    hydrate: () => {
      if (get().hydrated) {
        return;
      }
      let saved = getJSON<Saved | null>(LOCKS_KEY, null);
      if (!saved) {
        saved = migrate();
        setJSON(LOCKS_KEY, saved);
      }
      set({hydrated: true, saved, appLocked: !!saved.app});
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
          if (s.chat && away >= CHAT_RELOCK_MS) {
            set({chatsUnlocked: false});
          }
          if (s.app && away >= s.app.autoLockMs) {
            set({appLocked: true, chatsUnlocked: false});
          }
        });
      }
    },

    hasPin: kind => !!get().saved[kind],

    setPin: (kind, pin) => {
      const salt = naclUtil.encodeBase64(nacl.randomBytes(16));
      const prev = get().saved[kind];
      const next = {
        ...(kind === 'app' ? {autoLockMs: (prev as AppLock | null)?.autoLockMs ?? 60_000} : {hidden: (prev as ChatLock | null)?.hidden ?? false}),
        salt,
        hash: hashPin(pin, salt),
        biometric: prev?.biometric ?? false,
        misses: 0,
        waitUntil: 0,
      };
      persist({...get().saved, [kind]: next});
    },

    verify: (kind, pin) => {
      const c = cred(kind);
      if (!c) {
        return 'ok';
      }
      if (c.waitUntil > Date.now()) {
        return 'wait';
      }
      if (hashPin(pin, c.salt) === c.hash) {
        if (c.misses) {
          patchCred(kind, {misses: 0, waitUntil: 0});
        }
        return 'ok';
      }
      const misses = c.misses + 1;
      patchCred(kind, misses >= MAX_MISSES ? {misses: 0, waitUntil: Date.now() + WAIT_MS} : {misses});
      return misses >= MAX_MISSES ? 'wait' : 'wrong';
    },

    matches: (kind, pin) => {
      const c = cred(kind);
      return !!c && c.waitUntil <= Date.now() && hashPin(pin, c.salt) === c.hash;
    },

    waitSeconds: kind => {
      const w = cred(kind)?.waitUntil ?? 0;
      return w > Date.now() ? Math.ceil((w - Date.now()) / 1000) : 0;
    },

    removePin: kind => {
      if (kind === 'chat') {
        // Without a chat code there's nothing to lock chats with: they all go back to the normal list.
        const prefs = usePrefsStore.getState();
        const locked = Object.keys(prefs.prefs).filter(id => prefs.prefs[id].locked);
        prefs.patchMany(locked, {locked: false});
        persist({...get().saved, chat: null});
        set({chatsUnlocked: false});
        return;
      }
      persist({...get().saved, app: null});
      set({appLocked: false});
    },

    setAutoLock: ms => {
      const s = get().saved;
      if (s.app) {
        persist({...s, app: {...s.app, autoLockMs: ms}});
      }
    },
    setBiometric: (kind, on) => patchCred(kind, {biometric: on}),
    setHidden: on => {
      const s = get().saved;
      if (s.chat) {
        persist({...s, chat: {...s.chat, hidden: on}});
      }
    },

    unlockApp: () => set({appLocked: false}),
    unlockChats: () => set({chatsUnlocked: true}),
    lockChats: () => set({chatsUnlocked: false}),
  };
});
