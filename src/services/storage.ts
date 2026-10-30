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
const PREFIX = 'pulse:';
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

/** Load persisted values into the sync cache. Call once before rendering. */
export async function initStorage(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(PREFIX));
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
const BLOB = 'pulsemedia:';

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
