import {create} from 'zustand';
import {getJSON, setJSON} from '@/services/storage';

/**
 * Per-person (and per-group) choices that belong to THIS phone only: a nickname,
 * mute, pin, block, "allow calls", whether you verified their security code, and
 * what you've read. Also remembers the last photo/bio a person shared so their
 * profile still opens when they're out of range. Stored under the encrypted
 * "chat." prefix.
 */
export const MUTE_FOREVER = -1;

export type ConvPrefs = {
  nickname?: string;
  /** ms timestamp the mute ends, or MUTE_FOREVER. */
  mutedUntil?: number;
  pinned?: boolean;
  /** false = this person can't ring you. Undefined = allowed. */
  allowCalls?: boolean;
  blocked?: boolean;
  verified?: boolean;
  /** Newest message timestamp you've seen. */
  lastRead?: number;
  /** Shown under "Favorites" in the chat list. */
  favorite?: boolean;
  /** One of your own label names ("Work", "Family"…). */
  label?: string;
  /** Messages in this chat vanish this many ms after they are sent. Undefined = keep forever. */
  disappear?: number;
  /** Needs the PIN (or fingerprint) to open; its preview and notifications are hidden. */
  locked?: boolean;
};

export type KnownProfile = {avatar?: string; bio?: string; name?: string; seenAt?: number};

const PREFS_KEY = 'chat.prefs';
const PROFILES_KEY = 'chat.profiles';
const LABELS_KEY = 'chat.labels';
const SEEN_WRITE_GAP_MS = 60_000;

type PrefsState = {
  prefs: Record<string, ConvPrefs>;
  profiles: Record<string, KnownProfile>;
  /** The label names you created. */
  labels: string[];
  hydrated: boolean;

  hydrate: () => void;
  addLabel: (name: string) => void;
  removeLabel: (name: string) => void;
  /** Apply one change to many chats at once (multi-select in the chat list). */
  patchMany: (ids: string[], p: Partial<ConvPrefs>) => void;
  patch: (id: string, p: Partial<ConvPrefs>) => void;
  mute: (id: string, durationMs: number | typeof MUTE_FOREVER | null) => void;
  markRead: (id: string, upTo?: number) => void;
  remember: (key: string, p: Partial<KnownProfile>) => void;
  isMuted: (id: string, now?: number) => boolean;
  isBlocked: (id: string) => boolean;
  callsAllowed: (id: string) => boolean;
  nameFor: (id: string, fallback: string) => string;
};

export const usePrefsStore = create<PrefsState>((set, get) => ({
  prefs: {},
  profiles: {},
  labels: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) {
      return;
    }
    set({
      hydrated: true,
      prefs: getJSON<Record<string, ConvPrefs>>(PREFS_KEY, {}),
      profiles: getJSON<Record<string, KnownProfile>>(PROFILES_KEY, {}),
      labels: getJSON<string[]>(LABELS_KEY, []),
    });
  },

  addLabel: name => {
    const n = name.trim().slice(0, 20);
    if (!n || get().labels.some(l => l.toLowerCase() === n.toLowerCase())) {
      return;
    }
    const labels = [...get().labels, n];
    setJSON(LABELS_KEY, labels);
    set({labels});
  },

  removeLabel: name => {
    const labels = get().labels.filter(l => l !== name);
    setJSON(LABELS_KEY, labels);
    const prefs = {...get().prefs};
    for (const id of Object.keys(prefs)) {
      if (prefs[id].label === name) {
        const next = {...prefs[id]};
        delete next.label;
        if (Object.keys(next).length === 0) {
          delete prefs[id];
        } else {
          prefs[id] = next;
        }
      }
    }
    setJSON(PREFS_KEY, prefs);
    set({labels, prefs});
  },

  patchMany: (ids, p) => {
    ids.forEach(id => get().patch(id, p));
  },

  patch: (id, p) => {
    const merged: ConvPrefs = {...get().prefs[id], ...p};
    // Keep the saved file small: drop anything that's back to its default.
    (Object.keys(merged) as (keyof ConvPrefs)[]).forEach(k => {
      const v = merged[k];
      // (allowCalls=false is a real choice; every other false is just the default)
      if (v === undefined || v === '' || (v === false && k !== 'allowCalls')) {
        delete merged[k];
      }
    });
    if (p.allowCalls === true) {
      delete merged.allowCalls; // allowed is the default
    }
    const prefs = {...get().prefs, [id]: merged};
    if (Object.keys(merged).length === 0) {
      delete prefs[id];
    }
    setJSON(PREFS_KEY, prefs);
    set({prefs});
  },

  mute: (id, durationMs) => {
    get().patch(id, {
      mutedUntil: durationMs === null ? undefined : durationMs === MUTE_FOREVER ? MUTE_FOREVER : Date.now() + durationMs,
    });
  },

  markRead: (id, upTo) => {
    const at = upTo ?? Date.now();
    if ((get().prefs[id]?.lastRead ?? 0) >= at) {
      return;
    }
    get().patch(id, {lastRead: at});
  },

  remember: (key, p) => {
    const prev = get().profiles[key] ?? {};
    const next: KnownProfile = {...prev};
    let dirty = false;
    (Object.keys(p) as (keyof KnownProfile)[]).forEach(k => {
      const v = p[k];
      if (v !== undefined && v !== prev[k]) {
        (next as Record<string, unknown>)[k] = v;
        // "last seen" changes every beat — only write it to disk once in a while.
        if (k !== 'seenAt' || (v as number) - (prev.seenAt ?? 0) > SEEN_WRITE_GAP_MS) {
          dirty = true;
        }
      }
    });
    if (!dirty) {
      return;
    }
    const profiles = {...get().profiles, [key]: next};
    setJSON(PROFILES_KEY, profiles);
    set({profiles});
  },

  isMuted: (id, now = Date.now()) => {
    const m = get().prefs[id]?.mutedUntil;
    return m === MUTE_FOREVER || (m !== undefined && m > now);
  },

  isBlocked: id => !!get().prefs[id]?.blocked,

  callsAllowed: id => get().prefs[id]?.allowCalls !== false,

  nameFor: (id, fallback) => get().prefs[id]?.nickname?.trim() || fallback,
}));

/** "Muted for 1 hour" / "Muted until 8 Nov" style text for a row, or null. */
export function muteLabel(p: ConvPrefs | undefined, now = Date.now()): string | null {
  const m = p?.mutedUntil;
  if (m === MUTE_FOREVER) {
    return 'Muted';
  }
  if (m !== undefined && m > now) {
    const mins = Math.round((m - now) / 60000);
    if (mins < 90) {
      return `Muted · ${mins} min left`;
    }
    const hrs = Math.round(mins / 60);
    return hrs < 48 ? `Muted · ${hrs} h left` : `Muted · ${Math.round(hrs / 24)} days left`;
  }
  return null;
}
