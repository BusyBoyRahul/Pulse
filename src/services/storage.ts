import {NativeModules} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * On-device key/value store.
 *
 * Backed by AsyncStorage (pure Java on Android — no NDK toolchain needed), but
 * exposes a SYNCHRONOUS API via an in-memory cache so the rest of the app can
 * read settings, contacts and the mesh keypair without awaiting. The cache is
 * hydrated once at startup by `initStorage()` (awaited in App.tsx); writes
 * update the cache immediately and persist in the background.
 *
 * Sensitive values (the mesh secret key, phone numbers, trusted contacts, group
 * keys, chat history) are encrypted at rest with a key that lives inside the
 * Android Keystore (see SecureStoreModule.kt) — the data folder alone is
 * useless to anyone who copies it. Where the native module is unavailable
 * (tests, other platforms) values are stored as before.
 */
/**
 * ACCOUNTS. Every account on this phone has its own namespace, so identity keys,
 * chats, settings and media never mix. The first account ("main") keeps the
 * original 'pulse:' prefix, so nothing already saved has to move. Others use
 * 'pulse:<id>:'. Which account is active lives in one small meta record; only the
 * active account is loaded into memory. Switching = save, set active, restart.
 */
const BASE = 'pulse:';
const META_KEY = 'pulse.meta';
const MAIN = 'main';
const OTHER_ACCOUNT = /^pulse:a\d+:/;

export type AccountMeta = {
  id: string;
  name: string;
  /** Small profile picture (base64 JPEG) for the account switcher. */
  thumb?: string;
  createdAt: number;
  /** Phone number was verified by SMS code. */
  phoneVerified?: boolean;
  /** The verified number (digits only), so the same number cannot be added to a second account on this phone. */
  phone?: string;
};
type Meta = {active: string; accounts: AccountMeta[]; /** The account that was active when "add account" was tapped, so it can be cancelled. */ prev?: string};

let meta: Meta = {active: MAIN, accounts: [{id: MAIN, name: '', createdAt: 0}]};
let PREFIX = BASE;
let BLOB = 'pulsemedia:';

const prefixFor = (id: string) => (id === MAIN ? BASE : `${BASE}${id}:`);
const blobFor = (id: string) => (id === MAIN ? 'pulsemedia:' : `pulsemedia:${id}:`);

function useMeta(m: Meta) {
  meta = m;
  PREFIX = prefixFor(m.active);
  BLOB = blobFor(m.active);
}

async function saveMeta(): Promise<void> {
  try {
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* disk full: the in-memory copy still works this session */
  }
}

const ENC = 'enc1:';
const cache = new Map<string, string>();

type SecureNative = {
  encrypt(plain: string): Promise<string>;
  decrypt(blob: string): Promise<string>;
};
const Secure = NativeModules.SecureStore as SecureNative | undefined;

/** Keys (or key prefixes) that must never sit on disk in the clear. */
const SENSITIVE_EXACT = new Set([
  'mesh.secretKey',
  'auth.phone',
  'auth.jwt',
  'contacts.trusted',
  'groups.list',
  'pairing.paired',
]);
const isSensitive = (key: string) => SENSITIVE_EXACT.has(key) || key.startsWith('chat.');

// Writes to one key are serialised so a slow encrypt can't land after a newer value.
const chains = new Map<string, Promise<void>>();
function enqueue(key: string, job: () => Promise<void>): void {
  const next = (chains.get(key) ?? Promise.resolve()).then(job, job);
  chains.set(key, next);
}

async function writeRaw(key: string, value: string): Promise<void> {
  try {
    if (Secure && isSensitive(key)) {
      await AsyncStorage.setItem(PREFIX + key, ENC + (await Secure.encrypt(value)));
    } else {
      await AsyncStorage.setItem(PREFIX + key, value);
    }
  } catch {
    /* disk full / keystore hiccup — the in-memory copy still serves this session */
  }
}

let initPromise: Promise<void> | null = null;

/** Load persisted values into the sync cache. Safe to call more than once. */
export function initStorage(): Promise<void> {
  if (!initPromise) {
    initPromise = loadAll();
  }
  return initPromise;
}

async function loadAll(): Promise<void> {
  try {
    try {
      const raw = await AsyncStorage.getItem(META_KEY);
      if (raw) {
        const m = JSON.parse(raw) as Meta;
        if (m?.accounts?.length && m.accounts.some(a => a.id === m.active)) {
          useMeta(m);
        }
      }
    } catch {
      /* no / damaged meta: start as the main account */
    }
    const mine = (k: string) =>
      meta.active === MAIN ? k.startsWith(BASE) && !OTHER_ACCOUNT.test(k) : k.startsWith(PREFIX);
    const keys = (await AsyncStorage.getAllKeys()).filter(mine);
    if (keys.length === 0) {
      return;
    }
    const entries = await AsyncStorage.multiGet(keys);
    const upgrades: [string, string][] = [];
    await Promise.all(
      entries.map(async ([k, v]) => {
        if (v == null) {
          return;
        }
        const name = k.slice(PREFIX.length);
        if (v.startsWith(ENC) && Secure) {
          try {
            cache.set(name, await Secure.decrypt(v.slice(ENC.length)));
          } catch {
            /* key lost / corrupted blob: treat as absent rather than crash */
          }
        } else if (v.startsWith(ENC)) {
          /* encrypted but no Keystore here: unreadable, skip */
        } else {
          cache.set(name, v);
          // A sensitive value saved by an older build in plaintext: encrypt it now.
          if (Secure && isSensitive(name)) {
            upgrades.push([name, v]);
          }
        }
      }),
    );
    await Promise.all(upgrades.map(([name, v]) => writeRaw(name, v)));
  } catch {
    // Fresh install / storage unavailable — start with an empty cache.
  }
}

/** Everything saved on this phone (for backups). */
export function snapshotStorage(): Record<string, string> {
  return Object.fromEntries(cache.entries());
}

/** Wait until every pending write has reached the disk. */
export async function flushStorage(): Promise<void> {
  await Promise.all([...chains.values()]);
}

/** Replace everything saved here with a backup's contents. */
export async function restoreStorage(data: Record<string, string>): Promise<void> {
  for (const key of [...cache.keys()]) {
    if (!(key in data)) {
      storage.delete(key);
    }
  }
  for (const [key, value] of Object.entries(data)) {
    storage.set(key, value);
  }
  await flushStorage();
}

// ---- accounts API -----------------------------------------------------------

export function getAccounts(): {active: string; accounts: AccountMeta[]} {
  return meta;
}

export function activeAccount(): AccountMeta {
  return meta.accounts.find(a => a.id === meta.active) ?? meta.accounts[0];
}

/** Update the active account's card in the switcher (name, picture, verified). */
export function updateActiveAccount(patch: Partial<Omit<AccountMeta, 'id' | 'createdAt'>>): void {
  const next = {
    ...meta,
    accounts: meta.accounts.map(a => (a.id === meta.active ? {...a, ...patch} : a)),
  };
  meta = next;
  void saveMeta();
}

/** Create an empty account and make it the active one (call restart afterwards). */
export async function createAccount(): Promise<string> {
  const n = Math.max(1, ...meta.accounts.map(a => Number(a.id.replace(/\D/g, '')) || 1)) + 1;
  const id = `a${n}`;
  meta = {...meta, prev: meta.active, accounts: [...meta.accounts, {id, name: '', createdAt: Date.now()}]};
  await saveMeta();
  return id;
}

/** The account to go back to if adding the new one is cancelled (only set right after "add account"). */
export function addOrigin(): string | undefined {
  return meta.prev && meta.accounts.some(a => a.id === meta.prev) && meta.prev !== meta.active ? meta.prev : undefined;
}

export async function clearAddOrigin(): Promise<void> {
  meta = {...meta, prev: undefined};
  await saveMeta();
}

const digitsOf = (n: string): string => n.replace(/\D/g, '');

/** Is this number already the verified number of ANOTHER account on this phone? */
export function numberUsedByOtherAccount(phone: string): boolean {
  const d = digitsOf(phone);
  return d.length > 0 && meta.accounts.some(a => a.id !== meta.active && !!a.phone && digitsOf(a.phone) === d);
}

/** Make another account the active one. Takes effect after the app restarts. */
export async function setActiveAccount(id: string): Promise<boolean> {
  if (!meta.accounts.some(a => a.id === id)) {
    return false;
  }
  await flushStorage();
  meta = {...meta, active: id};
  await saveMeta();
  return true;
}

/** Erase an account that is NOT the active one: every key it ever saved. */
export async function deleteAccount(id: string): Promise<boolean> {
  if (id === meta.active || !meta.accounts.some(a => a.id === id) || meta.accounts.length < 2) {
    return false;
  }
  const mineKey = (k: string) =>
    id === MAIN
      ? (k.startsWith(BASE) && !OTHER_ACCOUNT.test(k)) || (k.startsWith('pulsemedia:') && !/^pulsemedia:a\d+:/.test(k))
      : k.startsWith(prefixFor(id)) || k.startsWith(blobFor(id));
  try {
    const doomed = (await AsyncStorage.getAllKeys()).filter(mineKey);
    await AsyncStorage.multiRemove(doomed);
  } catch {
    /* best effort */
  }
  meta = {...meta, accounts: meta.accounts.filter(a => a.id !== id)};
  await saveMeta();
  return true;
}

/** Tests only: forget everything in memory, as if the app had just been launched. */
export function _simulateRelaunch(): void {
  cache.clear();
  chains.clear();
  initPromise = null;
  useMeta({active: MAIN, accounts: [{id: MAIN, name: '', createdAt: 0}]});
}

export const storage = {
  getString(key: string): string | undefined {
    return cache.get(key);
  },
  getNumber(key: string): number | undefined {
    const v = cache.get(key);
    return v == null ? undefined : Number(v);
  },
  getBoolean(key: string): boolean | undefined {
    const v = cache.get(key);
    return v == null ? undefined : v === 'true';
  },
  set(key: string, value: string | number | boolean): void {
    const s = String(value);
    cache.set(key, s);
    enqueue(key, () => writeRaw(key, s));
  },
  delete(key: string): void {
    cache.delete(key);
    enqueue(key, () => AsyncStorage.removeItem(PREFIX + key).catch(() => {}));
  },
};

export const StorageKeys = {
  jwt: 'auth.jwt',
  userId: 'auth.userId',
  phone: 'auth.phone',
  profileName: 'profile.name',
  avatarUri: 'profile.avatar',
  avatarThumb: 'profile.avatarThumb',
  bio: 'profile.bio',
  onboarded: 'app.onboarded',
  welcomeDismissed: 'app.welcomeDismissed',
  phoneVerified: 'auth.phoneVerified',
  /** Fingerprint of the SIM that was in the phone when the number was verified. */
  simSig: 'auth.simSig',
  attestation: 'auth.attestation',
  trustedContacts: 'contacts.trusted',
  meshSecretKey: 'mesh.secretKey',
  meshPublicKey: 'mesh.publicKey',
  safetyNotes: 'notes.cache',
  responderMode: 'settings.responderMode',
} as const;

export function getJSON<T>(key: string, fallback: T): T {
  const raw = storage.getString(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJSON(key: string, value: unknown): void {
  storage.set(key, JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Large encrypted blobs (chat photos). Kept OUT of the sync cache so a few MB of
// pictures never sit in memory; each lives under its own key, encrypted at rest.
// ---------------------------------------------------------------------------

export async function saveBlob(key: string, value: string): Promise<number> {
  try {
    const stored = Secure ? ENC + (await Secure.encrypt(value)) : value;
    await AsyncStorage.setItem(BLOB + key, stored);
    return stored.length;
  } catch {
    return 0;
  }
}

export async function loadBlob(key: string): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(BLOB + key);
    if (v == null) {
      return null;
    }
    if (v.startsWith(ENC)) {
      return Secure ? await Secure.decrypt(v.slice(ENC.length)) : null;
    }
    return v;
  } catch {
    return null;
  }
}

export async function removeBlob(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(BLOB + key);
  } catch {
    /* already gone */
  }
}
