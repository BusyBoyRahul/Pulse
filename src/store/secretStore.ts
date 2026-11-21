import {create} from 'zustand';
import naclUtil from 'tweetnacl-util';
import nacl from 'tweetnacl';
import type {MeshPacket} from '@/types';
import {getMeshEngine} from '@/mesh/bleManager';
import {getJSON, setJSON} from '@/services/storage';
import {e2ee, SECRET_PREFIX, isSecretId} from '@/services/e2ee';
import {safetyCode} from '@/services/safetyCode';
import {usePairingStore} from './pairingStore';
import {usePrefsStore} from './prefsStore';
import {useSessionStore} from './sessionStore';

/**
 * Secret chats (Telegram-style).
 *
 * A secret chat is a SEPARATE conversation with someone you're connected to. It
 * has its own brand-new encryption keys (not shared with your normal chat),
 * lives only on the two phones, can't be forwarded or saved, hides its text in
 * notifications, blocks screenshots, and every message deletes itself after a
 * timer. Deleting it on either phone erases the keys and the chat on both.
 *
 * The handshake rides on PAIR packets: sc1 (invite) -> sc2 (accepted) -> a
 * first encrypted "hi" that hands the invited phone its sending chain.
 */
const KEY = 'chat.secrets'; // "chat." prefix => encrypted at rest

/** Self-destruct timers a secret chat can use (0 = keep). */
export const SECRET_TIMERS = [0, 10_000, 60_000, 3600_000, 86400_000, 7 * 86400_000];
export const DEFAULT_SECRET_TIMER = 3600_000;

export const secretTimerText = (ms: number): string =>
  ms === 0 ? 'Off' : ms < 60_000 ? `${ms / 1000} seconds` : ms < 3600_000 ? `${ms / 60_000} minute` : ms < 86400_000 ? `${ms / 3600_000} hour` : ms === 86400_000 ? '1 day' : `${ms / 86400_000} days`;

export type SecretChat = {
  /** `sc:<id>` — also the conversation id and the session id. */
  id: string;
  peerKey: string;
  name: string;
  createdAt: number;
  /** I started it. */
  mine: boolean;
  /** waiting: invite sent, no answer yet · securing: accepted, keys still arriving · ready. */
  status: 'waiting' | 'securing' | 'ready';
  /** Six groups of four digits both people can compare (unique to this chat). */
  code?: string[];
  timer: number;
};

export type SecretInvite = {id: string; peerKey: string; name: string; e: string; t: number; at: number};

type Wire = {k: 'sc1' | 'sc2' | 'sc3'; n: string; c: string; e?: string; r?: string; t?: number};

const encode = (w: Wire) => naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(w)));
function decode(s: string): Wire | null {
  try {
    const w = JSON.parse(naclUtil.encodeUTF8(naclUtil.decodeBase64(s))) as Wire;
    return typeof w.c === 'string' && w.c.startsWith(SECRET_PREFIX) ? w : null;
  } catch {
    return null;
  }
}

const newId = () => SECRET_PREFIX + naclUtil.encodeBase64(nacl.randomBytes(9)).replace(/[+/=]/g, 'x');
const myName = () => useSessionStore.getState().profileName || 'Pulse user';

type State = {
  chats: Record<string, SecretChat>;
  incoming: SecretInvite[];
  subscribed: boolean;

  init: () => void;
  get: (id: string) => SecretChat | undefined;
  /** Chats with one person. */
  withPeer: (peerKey: string) => SecretChat[];
  /** Invite someone I'm connected to. Returns the new chat id. */
  start: (peerKey: string, name: string, timer?: number) => string;
  accept: (id: string) => string | null;
  decline: (id: string) => void;
  /** End it for both phones and wipe keys + messages. */
  end: (id: string) => void;
  /** The invited phone has the keys now (a first message arrived). */
  markReady: (id: string) => void;
  setTimer: (id: string, ms: number) => void;
};

const retry = new Map<string, ReturnType<typeof setInterval>>();

function save(s: State) {
  setJSON(KEY, {chats: s.chats, incoming: s.incoming});
}

function sendWire(peerKey: string, w: Wire) {
  void getMeshEngine().send({type: 'PAIR', recipient: peerKey, ttl: 6, payload: encode(w)});
}

function sendHello(id: string, peerKey: string) {
  const wire = e2ee.encrypt(id, JSON.stringify({k: 'hi'}));
  if (wire) {
    void getMeshEngine().send({type: 'CHAT', recipient: peerKey, ttl: 6, payload: wire, nonce: 'dr1'});
  }
}

function stopRetry(id: string) {
  const t = retry.get(id);
  if (t) {
    clearInterval(t);
    retry.delete(id);
  }
}

// The chat store imports this file, so it hands over its "delete the messages"
// function here instead of this file importing the chat store.
let wipeMessages: ((conversationId: string) => void) | null = null;
export function onSecretWipe(fn: (conversationId: string) => void): void {
  wipeMessages = fn;
}

/** Remove a secret chat from this phone: keys, messages, timers, settings. */
function wipe(id: string) {
  stopRetry(id);
  e2ee.reset(id);
  wipeMessages?.(id);
  usePrefsStore.getState().patch(id, {disappear: undefined});
}

export const useSecretStore = create<State>((set, get) => ({
  chats: {},
  incoming: [],
  subscribed: false,

  init: () => {
    if (get().subscribed) {
      return;
    }
    const saved = getJSON<{chats?: Record<string, SecretChat>; incoming?: SecretInvite[]}>(KEY, {});
    set({chats: saved.chats ?? {}, incoming: saved.incoming ?? []});

    getMeshEngine().subscribe('PAIR', (packet: MeshPacket) => {
      const w = decode(packet.payload);
      if (!w || !packet.origin) {
        return;
      }
      const from = packet.origin;
      const pairing = usePairingStore.getState();
      if (!pairing.isPaired(from) || usePrefsStore.getState().isBlocked(from)) {
        return; // only people I'm connected to can start or answer one
      }
      const id = w.c;

      if (w.k === 'sc1') {
        if (!w.e || get().chats[id] || get().incoming.some(i => i.id === id)) {
          return; // resent invite we already know
        }
        const t = SECRET_TIMERS.includes(w.t ?? -1) ? (w.t as number) : DEFAULT_SECRET_TIMER;
        set(s => ({incoming: [{id, peerKey: from, name: w.n, e: w.e!, t, at: Date.now()}, ...s.incoming].slice(0, 20)}));
        save(get());
      } else if (w.k === 'sc2') {
        const chat = get().chats[id];
        if (!chat || !chat.mine || chat.peerKey !== from || chat.status !== 'waiting' || !w.e || !w.r) {
          return;
        }
        if (e2ee.completeHandshake(id, w.r, w.e)) {
          stopRetry(id);
          set(s => ({
            chats: {...s.chats, [id]: {...chat, status: 'ready', code: safetyCode(w.r!, w.e!)}},
          }));
          save(get());
          sendHello(id, from);
        }
      } else if (w.k === 'sc3') {
        const chat = get().chats[id];
        if (chat && chat.peerKey === from) {
          get().end(id); // they ended it: it is gone here too
        } else {
          set(s => ({incoming: s.incoming.filter(i => i.id !== id)}));
          save(get());
        }
      }
    });

    // If I stop being connected to someone, their secret chats go too.
    usePairingStore.subscribe((s, prev) => {
      const gone = prev.paired.filter(p => !s.paired.some(q => q.publicKey === p.publicKey));
      for (const g of gone) {
        get().withPeer(g.publicKey).forEach(c => get().end(c.id));
      }
    });

    // Invites I sent that are still unanswered keep knocking (they may have been out of range).
    for (const c of Object.values(get().chats)) {
      if (c.mine && c.status === 'waiting') {
        startRetry(c.id);
      }
    }
    set({subscribed: true});
  },

  get: id => get().chats[id],

  withPeer: peerKey => Object.values(get().chats).filter(c => c.peerKey === peerKey),

  start: (peerKey, name, timer = DEFAULT_SECRET_TIMER) => {
    const id = newId();
    const chat: SecretChat = {id, peerKey, name, createdAt: Date.now(), mine: true, status: 'waiting', timer};
    set(s => ({chats: {...s.chats, [id]: chat}}));
    usePrefsStore.getState().patch(id, {disappear: timer || undefined});
    save(get());
    knock(id);
    startRetry(id);
    return id;
  },

  accept: id => {
    const inv = get().incoming.find(i => i.id === id);
    if (!inv || !usePairingStore.getState().isPaired(inv.peerKey)) {
      return null;
    }
    const ekR = e2ee.acceptHandshake(id, inv.peerKey, inv.e);
    const chat: SecretChat = {
      id,
      peerKey: inv.peerKey,
      name: inv.name,
      createdAt: Date.now(),
      mine: false,
      status: 'securing',
      code: safetyCode(inv.e, ekR),
      timer: inv.t,
    };
    set(s => ({chats: {...s.chats, [id]: chat}, incoming: s.incoming.filter(i => i.id !== id)}));
    usePrefsStore.getState().patch(id, {disappear: inv.t || undefined});
    save(get());
    sendWire(inv.peerKey, {k: 'sc2', n: myName(), c: id, e: ekR, r: inv.e});
    return id;
  },

  decline: id => {
    const inv = get().incoming.find(i => i.id === id);
    set(s => ({incoming: s.incoming.filter(i => i.id !== id)}));
    save(get());
    if (inv) {
      sendWire(inv.peerKey, {k: 'sc3', n: myName(), c: id}); // tell them it's off
    }
  },

  end: id => {
    const chat = get().chats[id];
    if (!chat) {
      return;
    }
    sendWire(chat.peerKey, {k: 'sc3', n: myName(), c: id});
    wipe(id);
    set(s => {
      const chats = {...s.chats};
      delete chats[id];
      return {chats};
    });
    save(get());
  },

  markReady: id => {
    const chat = get().chats[id];
    if (chat && chat.status !== 'ready') {
      set(s => ({chats: {...s.chats, [id]: {...chat, status: 'ready'}}}));
      save(get());
    }
  },

  setTimer: (id, ms) => {
    const chat = get().chats[id];
    if (chat && SECRET_TIMERS.includes(ms)) {
      set(s => ({chats: {...s.chats, [id]: {...chat, timer: ms}}}));
      usePrefsStore.getState().patch(id, {disappear: ms || undefined});
      save(get());
    }
  },
}));

/** Send (or re-send) the invite for a chat I started. */
function knock(id: string) {
  const chat = useSecretStore.getState().chats[id];
  if (!chat) {
    return;
  }
  sendWire(chat.peerKey, {
    k: 'sc1',
    n: myName(),
    c: id,
    e: e2ee.beginHandshake(id, chat.peerKey),
    t: chat.timer,
  });
}

function startRetry(id: string) {
  stopRetry(id);
  let tries = 0;
  retry.set(
    id,
    setInterval(() => {
      tries += 1;
      const chat = useSecretStore.getState().chats[id];
      if (!chat || chat.status !== 'waiting' || tries > 30) {
        stopRetry(id);
        return;
      }
      knock(id);
    }, 20000),
  );
}

export {isSecretId, SECRET_PREFIX};
