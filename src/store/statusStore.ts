import {create} from 'zustand';
import naclUtil from 'tweetnacl-util';
import nacl from 'tweetnacl';
import {getJSON, setJSON} from '@/services/storage';
import {usePairingStore} from './pairingStore';
import {usePeersStore} from './peersStore';
import {usePrefsStore} from './prefsStore';
import {useSettingsStore} from './settingsStore';

/**
 * Status — updates that vanish after 24 hours (like WhatsApp Status / Snapchat
 * Stories). Each update is end-to-end encrypted separately to every connected
 * person who may see it, using the same private channel as chat. Nothing goes
 * to a server. They get a view receipt back, so you can see who looked.
 */
const KEY = 'chat.status'; // "chat." prefix => encrypted at rest
export const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
/** Max base64 characters of a photo update (it travels in one encrypted message). */
export const STATUS_PHOTO_MAX = 20000;
const RESEND_GAP_MS = 10 * 60 * 1000;

export type StatusItem = {
  id: string;
  kind: 'text' | 'photo';
  text?: string;
  /** 'c:#RRGGBB' solid colour, or 'p:<photo key>' for a bundled picture. */
  bg: string;
  /** Small JPEG (base64) for a photo update. */
  photo?: string;
  at: number;
  exp: number;
};

type Feed = {name: string; items: StatusItem[]};

/** What goes over the wire. */
export type StatusWire =
  | {k: 'st'; id: string; kind: 'text' | 'photo'; text?: string; bg: string; ph?: string; at: number; exp: number}
  | {k: 'stx'; id: string}
  | {k: 'stv'; id: string};

type SendFn = (peerKey: string, event: StatusWire) => void;
let sender: SendFn | null = null;
/** chatStore hands over its private "send an encrypted message to one person" here. */
export function onStatusSend(fn: SendFn): void {
  sender = fn;
}

type State = {
  /** My own updates. */
  mine: StatusItem[];
  /** Who has seen each of my updates (item id -> viewer keys). */
  views: Record<string, string[]>;
  /** Other people's updates. */
  feeds: Record<string, Feed>;
  /** Updates I have watched (item id -> when). */
  seen: Record<string, number>;
  subscribed: boolean;

  init: () => void;
  post: (draft: {kind: 'text' | 'photo'; text?: string; bg: string; photo?: string}) => string;
  remove: (id: string) => void;
  /** An update from someone else arrived / was removed / was viewed. */
  apply: (event: StatusWire, from: string) => void;
  /** I opened someone's update: remember it and tell them. */
  markSeen: (author: string, id: string) => void;
  /** Items from one person that are still alive. */
  itemsOf: (author: string) => StatusItem[];
  unseenCount: (author: string) => number;
  prune: () => void;
};

const newId = () => naclUtil.encodeBase64(nacl.randomBytes(9)).replace(/[+/=]/g, 'x');

function save(s: State) {
  setJSON(KEY, {mine: s.mine, views: s.views, feeds: s.feeds, seen: s.seen});
}

/** Everyone who is allowed to see my updates. */
function audience(): string[] {
  const prefs = usePrefsStore.getState();
  const mode = useSettingsStore.getState().app.statusAudience ?? 'all';
  return usePairingStore
    .getState()
    .paired.map(p => p.publicKey)
    .filter(k => !prefs.isBlocked(k) && (mode === 'only' ? !!prefs.prefs[k]?.showStatus : mode === 'except' ? !prefs.prefs[k]?.hideStatus : true));
}

const lastSent = new Map<string, number>(); // `${peer}:${id}` -> when

function wireOf(it: StatusItem): StatusWire {
  return {k: 'st', id: it.id, kind: it.kind, text: it.text, bg: it.bg, ph: it.photo, at: it.at, exp: it.exp};
}

export const useStatusStore = create<State>((set, get) => ({
  mine: [],
  views: {},
  feeds: {},
  seen: {},
  subscribed: false,

  init: () => {
    if (get().subscribed) {
      return;
    }
    const saved = getJSON<Partial<Pick<State, 'mine' | 'views' | 'feeds' | 'seen'>>>(KEY, {});
    set({mine: saved.mine ?? [], views: saved.views ?? {}, feeds: saved.feeds ?? {}, seen: saved.seen ?? {}});
    get().prune();

    // Someone I'm connected to just came into reach: make sure they have my current updates.
    usePeersStore.subscribe((s, prev) => {
      for (const k of Object.keys(s.peers)) {
        if (prev.peers[k] || !audience().includes(k)) {
          continue;
        }
        for (const it of get().mine) {
          const tag = `${k}:${it.id}`;
          if (Date.now() - (lastSent.get(tag) ?? 0) > RESEND_GAP_MS) {
            lastSent.set(tag, Date.now());
            sender?.(k, wireOf(it));
          }
        }
      }
    });
    setInterval(() => get().prune(), 60_000);
    set({subscribed: true});
  },

  post: draft => {
    const now = Date.now();
    const item: StatusItem = {
      id: newId(),
      kind: draft.kind,
      text: draft.text?.trim() || undefined,
      bg: draft.bg,
      photo: draft.photo,
      at: now,
      exp: now + STATUS_TTL_MS,
    };
    set(s => ({mine: [...s.mine, item]}));
    save(get());
    for (const k of audience()) {
      lastSent.set(`${k}:${item.id}`, now);
      sender?.(k, wireOf(item));
    }
    return item.id;
  },

  remove: id => {
    set(s => {
      const views = {...s.views};
      delete views[id];
      return {mine: s.mine.filter(i => i.id !== id), views};
    });
    save(get());
    for (const k of audience()) {
      sender?.(k, {k: 'stx', id});
    }
  },

  apply: (event, from) => {
    const prefs = usePrefsStore.getState();
    if (prefs.isBlocked(from) || !usePairingStore.getState().isPaired(from)) {
      return;
    }
    if (event.k === 'st') {
      if (event.exp <= Date.now() || typeof event.id !== 'string') {
        return;
      }
      if (event.kind === 'photo' && (!event.ph || event.ph.length > STATUS_PHOTO_MAX * 1.2)) {
        return;
      }
      const have = get().feeds[from]?.items.some(i => i.id === event.id);
      if (have) {
        return;
      }
      const item: StatusItem = {
        id: event.id,
        kind: event.kind === 'photo' ? 'photo' : 'text',
        text: typeof event.text === 'string' ? event.text.slice(0, 700) : undefined,
        bg: typeof event.bg === 'string' ? event.bg.slice(0, 20) : 'c:#2F8BFF',
        photo: event.kind === 'photo' ? event.ph : undefined,
        at: Math.min(event.at, Date.now()),
        exp: Math.min(event.exp, Date.now() + STATUS_TTL_MS),
      };
      const name = prefs.nameFor(from, usePeersStore.getState().peers[from]?.name ?? from.slice(0, 8));
      set(s => {
        const feed = s.feeds[from] ?? {name, items: []};
        return {feeds: {...s.feeds, [from]: {name, items: [...feed.items, item].sort((a, b) => a.at - b.at)}}};
      });
      save(get());
    } else if (event.k === 'stx') {
      set(s => {
        const feed = s.feeds[from];
        if (!feed) {
          return s;
        }
        return {feeds: {...s.feeds, [from]: {...feed, items: feed.items.filter(i => i.id !== event.id)}}};
      });
      save(get());
    } else if (event.k === 'stv') {
      if (!get().mine.some(i => i.id === event.id)) {
        return;
      }
      set(s => {
        const list = s.views[event.id] ?? [];
        return list.includes(from) ? s : {views: {...s.views, [event.id]: [...list, from]}};
      });
      save(get());
    }
  },

  markSeen: (author, id) => {
    if (get().seen[id]) {
      return;
    }
    set(s => ({seen: {...s.seen, [id]: Date.now()}}));
    save(get());
    sender?.(author, {k: 'stv', id});
  },

  itemsOf: author => {
    const now = Date.now();
    return (get().feeds[author]?.items ?? []).filter(i => i.exp > now);
  },

  unseenCount: author => get().itemsOf(author).filter(i => !get().seen[i.id]).length,

  prune: () => {
    const now = Date.now();
    const s = get();
    const mine = s.mine.filter(i => i.exp > now);
    const feeds: Record<string, Feed> = {};
    for (const [k, f] of Object.entries(s.feeds)) {
      const items = f.items.filter(i => i.exp > now);
      if (items.length) {
        feeds[k] = {...f, items};
      }
    }
    const alive = new Set([...mine.map(i => i.id), ...Object.values(feeds).flatMap(f => f.items.map(i => i.id))]);
    const seen = Object.fromEntries(Object.entries(s.seen).filter(([id]) => alive.has(id)));
    const views = Object.fromEntries(Object.entries(s.views).filter(([id]) => alive.has(id)));
    if (mine.length !== s.mine.length || Object.keys(feeds).length !== Object.keys(s.feeds).length || Object.keys(seen).length !== Object.keys(s.seen).length || Object.values(feeds).reduce((n, f) => n + f.items.length, 0) !== Object.values(s.feeds).reduce((n, f) => n + f.items.length, 0)) {
      set({mine, feeds, seen, views});
      save(get());
    }
  },
}));
