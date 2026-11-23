import {create} from 'zustand';
import naclUtil from 'tweetnacl-util';
import config from '@/config';
import type {ChatMessage, ConversationKind, FileInfo, MeshPacket, PollData, Reaction, ReplyPreview} from '@/types';
import {getMeshEngine} from '@/mesh/bleManager';
import {validKey} from '@/services/inviteLink';
import {getIdentity, shortId} from '@/services/identity';
import {newPacketId} from '@/mesh/relayProtocol';
import {boxTo, openBox, sealGroup, openGroup} from '@/services/crypto';
import {e2ee, isSecretId} from '@/services/e2ee';
import {useSecretStore, SECRET_TIMERS, onSecretWipe} from './secretStore';
import {useStatusStore, onStatusSend, StatusWire} from './statusStore';
import {useNetStore} from '@/net/netStore';
import {onProfileSend, applyProfile, ProfileWire} from '@/services/profileSync';
import {getJSON, setJSON, saveBlob, loadBlob, removeBlob} from '@/services/storage';
import {lanManager} from '@/lan/lanManager';
import {useGroupsStore, canSendIn} from './groupsStore';
import {mentions} from '@/services/mentions';

/** The kinds of event that put a NEW message in a chat (as opposed to receipts, reactions, edits…). */
const CONTENT_EVENTS: string[] = ['msg', 'img', 'mbeg', 'fbeg', 'poll', 'card'];
import {usePeersStore} from './peersStore';
import {usePairingStore, ensureSession} from './pairingStore';
import {useSessionStore} from './sessionStore';
import {usePrefsStore} from './prefsStore';
import {useSettingsStore} from './settingsStore';
import {notifier} from '@/services/notifier';
import {stripFormatting} from '@/services/richText';
import {mediaFiles, CHUNK_BYTES, MAX_FILE_BYTES, kindOfMime} from '@/services/mediaFiles';

export const NEARBY = 'nearby';

/** Options chosen when a poll is created (see PollData for what each means). closeInMs is relative; closesAt is absolute. */
/** Photos sent together share a group id `g`; `i` is the place (0 first) and `n` how many in all. */
export type AlbumTag = {g: string; i: number; n: number};

export type PollSend = {multi?: boolean; anon?: boolean; quiz?: number; explain?: string; closeInMs?: number; closesAt?: number};

// --- wire event: everything that happens in a chat is one of these ----------
type ReplyWire = {n: string; t: string};
type PinWire = {mid: string; w: 0 | 1; t: string};
type ChatEvent =
  | {k: 'msg'; id: string; name: string; text: string; r?: ReplyWire}
  | {k: 'img'; id: string; name: string; data: string; r?: ReplyWire}
  // Real media transfer, Quick-Share style: a header then N ordered chunks, so a
  // full-resolution photo streams reliably over Bluetooth/Wi-Fi (Nearby), well
  // past the ~32 KB single-frame limit. Reassembled on the far side.
  | {k: 'mbeg'; id: string; name: string; mime: string; n: number; r?: ReplyWire; sp?: 1; vo?: 1; vs?: number; c?: string; al?: AlbumTag}
  | {k: 'mchk'; id: string; i: number; d: string}
  // "I'm missing these pieces of photo <id> — please send them again."
  | {k: 'mreq'; id: string; miss: number[]}
  | {k: 'poll'; id: string; name: string; q: string; o: string[]; r?: ReplyWire; m?: 1; an?: 1; qz?: number; ex?: string; cl?: number}
  // A shared person: their public key (pk) and the name they use (pn).
  | {k: 'card'; id: string; name: string; pk: string; pn: string; r?: ReplyWire}
  | {k: 'react'; mid: string; emoji: string; name: string}
  | {k: 'vote'; mid: string; opt: number; name: string}
  // Delivery receipt: "your message reached my phone" (sent automatically).
  | {k: 'dlv'; mid: string}
  // Read receipt: "I opened the chat".
  | {k: 'receipt'; mid: string}
  // The sender removed a message for everyone / changed its text.
  | {k: 'del'; mid: string}
  | {k: 'edit'; mid: string; text: string}
  // Files, videos and voice notes: a header, then ordered pieces read straight from / written to disk.
  | {k: 'fbeg'; id: string; name: string; f: {n: string; s: number; m: string; t: FileInfo['kind']; d?: number; th?: string}; n: number; r?: ReplyWire; c?: string}
  | {k: 'fchk'; id: string; i: number; d: string}
  | {k: 'freq'; id: string; miss: number[]}
  // The receiver opened a view-once photo: it is gone on both phones.
  | {k: 'opn'; mid: string}
  // Disappearing messages for this chat changed (0 = off).
  | {k: 'dis'; ms: number}
  // The messages pinned to the top of a one-to-one chat. Sent as CHANGES (add one / del one; n = how many pins the sender has after it), so there is
  // no limit. ps (+ i of `of`) = the whole list in small parts, sent when the other phone asks (pinq) because its count differs.
  // w: 1 = the sender of this note wrote that message.
  | {k: 'pin'; add?: PinWire; del?: string; n?: number; ps?: PinWire[]; i?: number; of?: number}
  | {k: 'pinq'}
  // First message of a fresh encrypted session (carries nothing, just hands over keys).
  | {k: 'hi'}
  // Status updates (handled by statusStore, never shown as a chat message).
  | StatusWire
  // A connected person's profile photo / about (handled by profileSync).
  | ProfileWire;

// Per-chunk source chars. After JSON + seal + double-base64 (~1.8x) this keeps
// each mesh frame comfortably under Nearby's 32 KB BYTES limit.
const MEDIA_CHUNK_CHARS = 12000;
const MEDIA_STALL_MS = 4000; // no new chunk for this long -> ask for the missing ones
const MEDIA_MAX_ASKS = 6;
const MEDIA_BUDGET = 8_000_000; // stored chars of photos kept on disk
const HISTORY_KEY = 'chat.history';
const MEDIA_INDEX_KEY = 'chat.mediaIndex';
const MAX_PER_CONVERSATION = 200;

// Resend schedule for direct messages that haven't been confirmed delivered.
const BACKOFF_S = [10, 25, 60, 180, 480, 1200, 2700, 5400, 7200];
const GIVE_UP_MS = 24 * 60 * 60 * 1000;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_TOMBSTONES = 400;
/** The only timers the app offers (and accepts from the other side). */
export const DISAPPEAR_CHOICES = [0, 24 * 3600_000, 7 * 24 * 3600_000, 90 * 24 * 3600_000];

function chunkString(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) {
    out.push(s.slice(i, i + size));
  }
  return out;
}

// Inbound media being reassembled: mediaId -> collected parts.
type MediaBuffer = {
  parts: string[];
  received: number;
  total: number;
  lastAt: number;
  asks: number;
  conversationId: string;
  kind: ConversationKind;
};
const mediaBuffers = new Map<string, MediaBuffer>();

// Incoming files: pieces go straight to disk, so a 25 MB video never sits in memory.
type FileBuffer = {
  path: string;
  total: number;
  got: boolean[];
  received: number;
  shown: number;
  lastAt: number;
  asks: number;
  conversationId: string;
  kind: ConversationKind;
  /** The file exists on disk and is the right size (writes wait for this). */
  ready: Promise<boolean>;
  /** Writes happen one after another in order. */
  chain: Promise<void>;
  finishing: boolean;
};
const fileBuffers = new Map<string, FileBuffer>();
// Outgoing files kept so a receiver can ask for missing pieces.
const fileOut = new Map<string, {conversationId: string; kind: ConversationKind; path: string; n: number; at: number}>();
const FILE_STALL_MS = 6000;
const FILE_MAX_ASKS = 14;
const lastTypingSent = new Map<string, number>();
const safeFileName = (n: string) => n.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'file';
const selfKey = () => getIdentity().publicKey;
const PIN_CHUNK = 15;
/** Take a one-to-one chat's pinned message away (just that one when an id is given, otherwise all of them). */
function clearPin(conversationId: string, mid?: string) {
  const pins = usePrefsStore.getState().prefs[conversationId]?.pinMsgs;
  if (!pins?.length) {
    return;
  }
  const left = mid ? pins.filter(p => p.mid !== mid) : [];
  if (left.length !== pins.length) {
    usePrefsStore.getState().patch(conversationId, {pinMsgs: left.length ? left : undefined});
  }
}
type PinRec = {mid: string; from: string; t: string; by: string};
const pinsHere = (conversationId: string): PinRec[] => usePrefsStore.getState().prefs[conversationId]?.pinMsgs ?? [];
const setPinsHere = (conversationId: string, list: PinRec[]) => usePrefsStore.getState().patch(conversationId, {pinMsgs: list.length ? list : undefined});

/** Tell the other person about ONE change (a pin added or taken away). It is said three times in case one is lost, but a repeat is only
 *  sent while it is still true here (so an old "add" can never come back after an "unpin"). */
function sendPinOp(conversationId: string, kind: ConversationKind, op: {add?: PinWire; del?: string}) {
  const note: ChatEvent = {k: 'pin', ...op, n: pinsHere(conversationId).length};
  const stillTrue = () => {
    const has = (mid: string) => pinsHere(conversationId).some(p => p.mid === mid);
    return op.add ? has(op.add.mid) : op.del ? !has(op.del) : false;
  };
  quietSend(conversationId, kind, note);
  setTimeout(() => stillTrue() && quietSend(conversationId, kind, note), 3000);
  setTimeout(() => stillTrue() && quietSend(conversationId, kind, note), 15000);
}
/** Send the whole pin list in small parts (when the other phone asked for it). */
function sendAllPins(conversationId: string, kind: ConversationKind) {
  const list = pinsHere(conversationId);
  const of = Math.max(1, Math.ceil(list.length / PIN_CHUNK));
  for (let i = 0; i < of; i++) {
    const ps = list.slice(i * PIN_CHUNK, (i + 1) * PIN_CHUNK).map(p => ({mid: p.mid, w: (p.from === selfKey() ? 1 : 0) as 0 | 1, t: p.t}));
    quietSend(conversationId, kind, {k: 'pin', ps, i, of});
  }
}
const pinParts = new Map<string, {of: number; parts: Map<number, PinWire[]>}>();
const pinAsked = new Map<string, number>();
/** The short plain copy of a pinned message that is kept and shown in the bar. */
const pinText = (t: unknown) => (typeof t === 'string' ? t.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160) : '');
// Chunks that outran their header (different relay paths reorder things).
const orphanChunks = new Map<string, Map<number, string>>();
// Outbound photos kept briefly so a receiver can ask for missing pieces.
const mediaOut = new Map<string, {conversationId: string; kind: ConversationKind; chunks: string[]; at: number}>();

const b64 = (o: unknown) => naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(o)));
const unb64 = <T,>(s: string): T | null => {
  try {
    return JSON.parse(naclUtil.encodeUTF8(naclUtil.decodeBase64(s))) as T;
  } catch {
    return null;
  }
};

/** A direct message we're still trying to get across. */
type OutItem = {
  mid: string;
  conversationId: string;
  kind: ConversationKind;
  event: ChatEvent;
  tries: number;
  nextAt: number;
  createdAt: number;
  /** A group message: the members whose phones haven't confirmed it yet. Only they get the resends. */
  pending?: string[];
};

type ChatState = {
  byConversation: Record<string, ChatMessage[]>;
  reactions: Record<string, Reaction[]>; // messageId -> reactions
  votes: Record<string, Record<number, string[]>>; // pollId -> optionIndex -> voters
  outbox: Record<string, OutItem>;
  /** Messages their sender removed for everyone ("origin:id"), so a late copy can't reappear. */
  tombstones: Record<string, number>;
  /** Who is typing to me right now (conversation id -> when it expires). */
  typing: Record<string, number>;
  /** The conversation currently on screen (no notification for messages in it). */
  active: string | null;
  subscribed: boolean;

  init: () => void;
  setActive: (conversationId: string | null) => void;
  sendText: (conversationId: string, kind: ConversationKind, text: string, reply?: ReplyPreview) => Promise<void>;
  sendImage: (
    conversationId: string,
    kind: ConversationKind,
    base64: string,
    reply?: ReplyPreview,
    opts?: {spoiler?: boolean; viewOnce?: boolean; viewSecs?: number; caption?: string; album?: AlbumTag},
  ) => Promise<void>;
  sendPoll: (conversationId: string, kind: ConversationKind, question: string, options: string[], settings?: PollSend) => Promise<void>;
  /** Share a person from my contacts as a card the other side can add or message. */
  sendContact: (conversationId: string, kind: ConversationKind, person: {key: string; name: string}) => Promise<void>;
  react: (conversationId: string, kind: ConversationKind, messageId: string, emoji: string) => Promise<void>;
  vote: (conversationId: string, kind: ConversationKind, pollId: string, opt: number) => Promise<void>;
  deleteLocal: (conversationId: string, messageId: string) => void;
  deleteMany: (conversationId: string, messageIds: string[]) => void;
  /** Remove one of MY messages from both phones. */
  deleteForEveryone: (conversationId: string, kind: ConversationKind, messageId: string) => void;
  clearConversation: (conversationId: string) => void;
  /** Send any file, video or audio file (already copied into Pulse's folder). */
  sendFile: (
    conversationId: string,
    kind: ConversationKind,
    file: {path: string; name: string; size: number; mime: string},
    opts?: {kind?: FileInfo['kind']; dur?: number; reply?: ReplyPreview; caption?: string},
  ) => Promise<void>;
  /** Send a recorded voice note. */
  sendVoice: (
    conversationId: string,
    kind: ConversationKind,
    rec: {path: string; durationMs: number; size: number},
    reply?: ReplyPreview,
  ) => Promise<void>;
  /** Tell the other person I'm typing (or stopped). */
  setTyping: (conversationId: string, on: boolean) => void;
  /** The receiver opened a view-once photo: delete it here and tell the sender. */
  markOpened: (conversationId: string, kind: ConversationKind, messageId: string) => void;
  /** Turn disappearing messages on/off for a chat — on both phones. */
  setDisappear: (conversationId: string, kind: ConversationKind, ms: number) => void;
  toggleStar: (conversationId: string, messageId: string) => void;
  editMessage: (conversationId: string, kind: ConversationKind, messageId: string, text: string) => boolean;
  /** Pin one more message to the top of a one-to-one chat for both people (no limit; the others stay). Not in secret chats or chats with disappearing messages. */
  pinMessage: (conversationId: string, kind: ConversationKind, pin: {mid: string; mine: boolean; text: string}) => 'ok' | 'no';
  /** Take one pinned message away (the others stay). */
  unpinMessage: (conversationId: string, kind: ConversationKind, mid: string) => void;
  forwardMessage: (toId: string, toKind: ConversationKind, msg: ChatMessage, album?: AlbumTag) => Promise<void>;
  /** Storage & data: wipe every saved photo / every chat from this phone. */
  clearAllMedia: () => Promise<void>;
  clearAllChats: () => Promise<void>;
  markSeen: (conversationId: string, kind: ConversationKind) => void;
  hydrateMedia: (conversationId: string) => Promise<void>;
  messages: (conversationId: string) => ChatMessage[];
  lastMessage: (conversationId: string) => ChatMessage | undefined;
};

type Setter = (fn: (s: ChatState) => Partial<ChatState>) => void;
type Getter = () => ChatState;

const toWire = (r?: ReplyPreview): ReplyWire | undefined => (r ? {n: r.name, t: r.text} : undefined);
const fromWire = (r?: ReplyWire): ReplyPreview | undefined => (r ? {name: r.n, text: r.t} : undefined);

function myName(): string {
  return useSessionStore.getState().profileName || shortId(getIdentity().publicKey);
}

function append(state: ChatState, msg: ChatMessage) {
  const existing = state.byConversation[msg.conversationId] ?? [];
  if (existing.some(m => m.id === msg.id)) {
    return state.byConversation;
  }
  return {...state.byConversation, [msg.conversationId]: [...existing, msg].slice(-MAX_PER_CONVERSATION)};
}

function hasMessage(get: Getter, conversationId: string, id: string): boolean {
  return (get().byConversation[conversationId] ?? []).some(m => m.id === id);
}

/** An album tag that came over the wire: a short group id and a sensible position, or nothing. */
function cleanAlbum(a: unknown): AlbumTag | undefined {
  const t = a as Partial<AlbumTag> | undefined;
  if (!t || typeof t.g !== 'string' || !/^[A-Za-z0-9]{3,24}$/.test(t.g) || !Number.isInteger(t.i) || !Number.isInteger(t.n)) {
    return undefined;
  }
  const n = t.n as number;
  const i = t.i as number;
  return n >= 2 && n <= 10 && i >= 0 && i < n ? {g: t.g, i, n} : undefined;
}

/** A caption that came over the wire (or from the composer): plain text, trimmed, at most 500 characters. */
function cleanCaption(c: unknown): string | undefined {
  if (typeof c !== 'string') {
    return undefined;
  }
  const t = c.trim().slice(0, 500);
  return t || undefined;
}

function previewOf(m: {type: string; text?: string; viewOnce?: boolean; file?: FileInfo}): string {
  if (m.type === 'file') {
    return m.file?.kind === 'voice' ? 'Voice message' : m.file?.kind === 'video' ? 'Video' : m.file?.name ?? 'File';
  }
  return m.type === 'image' ? (m.viewOnce ? 'View-once photo' : 'Photo') : m.type === 'poll' ? 'Poll' : m.type === 'contact' ? 'Contact' : stripFormatting(m.text ?? '');
}

/** Direct chat needs a connection; a group needs membership; there is no open room. */
function canSendTo(conversationId: string, kind: ConversationKind): boolean {
  if (kind === 'direct') {
    if (isSecretId(conversationId)) {
      const chat = useSecretStore.getState().chats[conversationId];
      return !!chat && chat.status === 'ready' && usePairingStore.getState().isPaired(chat.peerKey);
    }
    // You can always write to yourself ("notes to self"); anyone else needs a connection.
    return conversationId === selfKey() || usePairingStore.getState().isPaired(conversationId);
  }
  return kind === 'group';
}

/** Remove a message's photo / file from the phone. */
function forgetMessageMedia(m: ChatMessage) {
  if (m.type === 'image') {
    void forgetImage(m.id);
  } else if (m.type === 'file') {
    if (m.file?.path) {
      void mediaFiles.remove(m.file.path);
    }
    fileBuffers.delete(m.id);
    fileOut.delete(m.id);
  }
}

/** When a message created now in this chat should vanish (disappearing messages), if at all. */
function expiresFor(conversationId: string): number | undefined {
  const ms = usePrefsStore.getState().prefs[conversationId]?.disappear;
  return ms ? Date.now() + ms : undefined;
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export const useChatStore = create<ChatState>((set, get) => ({
  byConversation: {},
  reactions: {},
  votes: {},
  outbox: {},
  tombstones: {},
  typing: {},
  active: null,
  subscribed: false,

  init: () => {
    if (get().subscribed) {
      return;
    }
    hydrateHistory(set);
    onSecretWipe(id => get().clearConversation(id));
    onStatusSend((peerKey, event) => quietSend(peerKey, 'direct', event));
    onProfileSend((peerKey, event) => quietSend(peerKey, 'direct', event));
    const me = getIdentity();
    getMeshEngine().subscribe('CHAT', (packet: MeshPacket) => {
      if (usePrefsStore.getState().isBlocked(packet.origin)) {
        return; // blocked: nothing from them reaches a chat
      }
      let event: ChatEvent | null = null;
      let conversationId = NEARBY;
      let convKind: ConversationKind = 'nearby';

      if (packet.recipient === me.publicKey && packet.nonce) {
        // No chat without connecting first: strangers can't start a direct conversation.
        if (!usePairingStore.getState().isPaired(packet.origin)) {
          return;
        }
        let json: string | null = null;
        if (packet.nonce === 'dr1') {
          // Forward-secret session (Double Ratchet).
          const opened = e2ee.decrypt(packet.origin, packet.payload);
          if (opened) {
            json = opened.text;
            conversationId = opened.sessionId;
          } else {
            ensureSession(packet.origin, true); // can't read it: ask for fresh keys
            return;
          }
        } else {
          json = openBox(packet.payload, packet.nonce, packet.origin, me.secretKey);
          conversationId = packet.origin;
        }
        try {
          event = json ? (JSON.parse(json) as ChatEvent) : null;
        } catch {
          event = null;
        }
        if (isSecretId(conversationId)) {
          const chat = useSecretStore.getState().chats[conversationId];
          if (!chat || chat.peerKey !== packet.origin) {
            return; // not a secret chat I have (any more)
          }
          if (event && chat.status !== 'ready') {
            useSecretStore.getState().markReady(conversationId); // keys are working both ways
          }
        }
        convKind = 'direct';
        // Status updates ride the same private channel but live in their own feed.
        if (event && (event.k === 'st' || event.k === 'stx' || event.k === 'stv')) {
          if (!isSecretId(conversationId)) {
            useStatusStore.getState().apply(event, packet.origin);
          }
          return;
        }
        if (event && event.k === 'prof') {
          if (!isSecretId(conversationId)) {
            applyProfile(packet.origin, event);
          }
          return;
        }
      } else {
        const wire = unb64<{g?: string; c?: string; n?: string; e?: ChatEvent}>(packet.payload);
        if (!wire) {
          return;
        }
        if (wire.g && wire.c && wire.n) {
          const group = useGroupsStore.getState().get(wire.g);
          // Only people who are in the group count, whatever key they hold.
          if (!group || !group.members.includes(packet.origin)) {
            return;
          }
          const json = openGroup(wire.c, wire.n, group.key);
          try {
            event = json ? (JSON.parse(json) as ChatEvent) : null;
          } catch {
            event = null;
          }
          // In an announcement group (only admins can send), anybody else's new messages are ignored.
          if (event && CONTENT_EVENTS.includes(event.k) && !canSendIn(group, packet.origin)) {
            return;
          }
          conversationId = wire.g;
          convKind = 'group';
        }
        // Open "nearby" broadcast room removed — messages must be a paired 1:1
        // (recipient-addressed) or a group. Unaddressed broadcasts are ignored.
      }
      if (event) {
        applyEvent(set, get, event, packet.origin, conversationId, convKind, packet.hops ?? 0);
      }
    });

    void mediaFiles.dir(); // learn where files live, so paths can be built instantly
    getMeshEngine().subscribe('TYPING', (packet: MeshPacket) => {
      const app = useSettingsStore.getState().app;
      if (packet.recipient !== me.publicKey || !packet.nonce || !app.typingIndicator) {
        return;
      }
      if (usePrefsStore.getState().isBlocked(packet.origin)) {
        return;
      }
      const json = openBox(packet.payload, packet.nonce, packet.origin, me.secretKey);
      let on = false;
      let g: string | undefined;
      try {
        const w = json ? (JSON.parse(json) as {on?: boolean; g?: string}) : null;
        on = !!w?.on;
        g = typeof w?.g === 'string' ? w.g : undefined;
      } catch {
        return;
      }
      // Typing in a group is stored per group and person ("groupId:person"); it must come from a member of that group.
      // Typing in a one-to-one chat must come from someone I'm connected with.
      const origin = packet.origin;
      let key = origin;
      if (g) {
        const group = useGroupsStore.getState().get(g);
        if (!group || !group.members.includes(origin)) {
          return;
        }
        key = `${g}:${origin}`;
      } else if (!usePairingStore.getState().isPaired(origin)) {
        return;
      }
      set(state => ({typing: {...state.typing, [key]: on ? Date.now() + 6000 : 0}}));
      if (on) {
        setTimeout(() => set(state => ({typing: {...state.typing, [key]: (state.typing[key] ?? 0) > Date.now() ? state.typing[key] : 0}})), 6200);
      }
    });

    startBackgroundWork(set, get);
    set({subscribed: true});
  },

  setActive: conversationId => set(() => ({active: conversationId})),

  sendText: async (conversationId, kind, text, reply) => {
    // Trim, and squash runs of blank lines to one, so a message never becomes a tall empty bubble.
    const t = text.trim().replace(/\n{3,}/g, '\n\n');
    if (!t || !canSendTo(conversationId, kind)) {
      return;
    }
    const id = newPacketId();
    addMine(set, {id, conversationId, convKind: kind, type: 'text', text: t, replyTo: reply});
    const event: ChatEvent = {k: 'msg', id, name: myName(), text: t, r: toWire(reply)};
    track(set, id, conversationId, kind, event);
    await sendEvent(conversationId, kind, event);
  },

  sendImage: async (conversationId, kind, base64, reply, opts) => {
    if (kind === 'nearby' || !canSendTo(conversationId, kind)) {
      return; // no open broadcast room, and no chat without a connection
    }
    const id = newPacketId();
    // Show it immediately on my side, marked as still transferring.
    addMine(
      set,
      {
        id,
        conversationId,
        convKind: kind,
        type: 'image',
        image: base64,
        replyTo: reply,
        spoiler: opts?.spoiler || undefined,
        viewOnce: opts?.viewOnce || undefined,
        viewSecs: opts?.viewOnce && opts.viewSecs ? opts.viewSecs : undefined,
        caption: cleanCaption(opts?.caption),
        album: opts?.album,
      },
      'sending',
    );
    try {
      const chunks = chunkString(base64, MEDIA_CHUNK_CHARS);
      mediaOut.set(id, {conversationId, kind, chunks, at: Date.now()});
      const head: ChatEvent = {
        k: 'mbeg',
        id,
        name: myName(),
        mime: 'image/jpeg',
        n: chunks.length,
        r: toWire(reply),
        sp: opts?.spoiler ? 1 : undefined,
        vo: opts?.viewOnce ? 1 : undefined,
        vs: opts?.viewOnce && opts.viewSecs ? opts.viewSecs : undefined,
        c: cleanCaption(opts?.caption),
        al: opts?.album,
      };
      track(set, id, conversationId, kind, head);
      await sendEvent(conversationId, kind, head);
      for (let i = 0; i < chunks.length; i++) {
        await sendEvent(conversationId, kind, {k: 'mchk', id, i, d: chunks[i]});
        setMedia(set, conversationId, id, {progress: (i + 1) / chunks.length});
      }
      // The far phone can confirm delivery while the last chunk is still going
      // out — never downgrade "delivered"/"seen" back to "sent".
      const cur = (get().byConversation[conversationId] ?? []).find(m => m.id === id);
      setMedia(
        set,
        conversationId,
        id,
        cur?.status === 'delivered' || cur?.status === 'seen'
          ? {progress: undefined}
          : {status: 'sent', progress: undefined},
      );
      void rememberImage(id, base64);
    } catch {
      setMedia(set, conversationId, id, {status: 'failed'});
    }
  },

  sendFile: async (conversationId, kind, file, opts) => {
    if (kind === 'nearby' || !canSendTo(conversationId, kind) || file.size > MAX_FILE_BYTES || file.size <= 0) {
      return;
    }
    const id = newPacketId();
    const fkind = opts?.kind ?? kindOfMime(file.mime);
    let dur = opts?.dur;
    let thumb: string | undefined;
    if (fkind === 'video' || fkind === 'audio') {
      const info = await mediaFiles.mediaInfo(file.path);
      dur = info.durationMs ?? dur;
      thumb = info.thumb;
    }
    const info: FileInfo = {name: file.name, size: file.size, mime: file.mime, kind: fkind, path: file.path, dur, thumb, done: true};
    const n = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
    // Notes to self never leave the phone.
    const self = kind === 'direct' && conversationId === selfKey();
    addMine(set, {id, conversationId, convKind: kind, type: 'file', file: info, replyTo: opts?.reply, caption: cleanCaption(opts?.caption)}, self ? 'sent' : 'sending');
    if (self) {
      return;
    }
    fileOut.set(id, {conversationId, kind, path: file.path, n, at: Date.now()});
    const head: ChatEvent = {
      k: 'fbeg',
      id,
      name: myName(),
      f: {n: file.name, s: file.size, m: file.mime, t: fkind, d: dur, th: thumb},
      n,
      c: cleanCaption(opts?.caption),
      r: toWire(opts?.reply),
    };
    track(set, id, conversationId, kind, head);
    try {
      await sendEvent(conversationId, kind, head);
      let shown = 0;
      for (let i = 0; i < n; i++) {
        const d = await mediaFiles.readChunk(file.path, i * CHUNK_BYTES, CHUNK_BYTES);
        await sendEvent(conversationId, kind, {k: 'fchk', id, i, d});
        const p = (i + 1) / n;
        if (p - shown >= 0.01 || i === n - 1) {
          shown = p;
          setMedia(set, conversationId, id, {progress: p});
        }
      }
      const cur = (get().byConversation[conversationId] ?? []).find(m => m.id === id);
      setMedia(
        set,
        conversationId,
        id,
        cur?.status === 'delivered' || cur?.status === 'seen' ? {progress: undefined} : {status: 'sent', progress: undefined},
      );
    } catch {
      setMedia(set, conversationId, id, {status: 'failed'});
    }
  },

  sendVoice: async (conversationId, kind, rec, reply) => {
    await get().sendFile(
      conversationId,
      kind,
      {path: rec.path, name: 'Voice message.m4a', size: rec.size, mime: 'audio/mp4'},
      {kind: 'voice', dur: rec.durationMs, reply},
    );
  },

  setTyping: (conversationId, on) => {
    if (!useSettingsStore.getState().app.typingIndicator || conversationId === selfKey()) {
      return;
    }
    const group = useGroupsStore.getState().get(conversationId);
    if (!group && !usePairingStore.getState().isPaired(conversationId)) {
      return;
    }
    const now = Date.now();
    const last = lastTypingSent.get(conversationId) ?? 0;
    if ((on && now - last < 3000) || (!on && last === 0)) {
      return;
    }
    lastTypingSent.set(conversationId, on ? now : 0);
    const me = getIdentity();
    // One person: that person. A group: every other member (each copy sealed to that one person).
    const to = group ? group.members.filter(k => k !== me.publicKey) : [conversationId];
    for (const k of to) {
      try {
        const {cipher, nonce} = boxTo(JSON.stringify(group ? {on, g: conversationId} : {on}), k, me.secretKey);
        getMeshEngine()
          .send({type: 'TYPING', recipient: k, ttl: 4, payload: cipher, nonce})
          .catch(() => undefined);
      } catch {
        /* unusable key: nothing to send to */
      }
    }
  },

  sendPoll: async (conversationId, kind, question, options, settings) => {
    if (!canSendTo(conversationId, kind)) {
      return;
    }
    const id = newPacketId();
    const quiz = settings?.quiz !== undefined && settings.quiz >= 0 && settings.quiz < options.length ? settings.quiz : undefined;
    const poll: PollData = {
      question,
      options,
      multi: settings?.multi && quiz === undefined ? true : undefined,
      anon: settings?.anon ? true : undefined,
      quiz,
      explain: quiz !== undefined && settings?.explain?.trim() ? settings.explain.trim().slice(0, 200) : undefined,
      closesAt: settings?.closesAt ?? (settings?.closeInMs ? Date.now() + settings.closeInMs : undefined),
    };
    addMine(set, {id, conversationId, convKind: kind, type: 'poll', poll});
    const event: ChatEvent = {k: 'poll', id, name: myName(), q: question, o: options, m: poll.multi ? 1 : undefined, an: poll.anon ? 1 : undefined, qz: poll.quiz, ex: poll.explain, cl: poll.closesAt};
    track(set, id, conversationId, kind, event);
    await sendEvent(conversationId, kind, event);
  },

  sendContact: async (conversationId, kind, person) => {
    if (!canSendTo(conversationId, kind) || !validKey(person.key)) {
      return;
    }
    const name = person.name.trim().slice(0, 40) || 'Pulse user';
    const id = newPacketId();
    addMine(set, {id, conversationId, convKind: kind, type: 'contact', contact: {key: person.key, name}});
    const event: ChatEvent = {k: 'card', id, name: myName(), pk: person.key, pn: name};
    track(set, id, conversationId, kind, event);
    await sendEvent(conversationId, kind, event);
  },

  react: async (conversationId, kind, messageId, emoji) => {
    // Local toggle-add.
    applyReaction(set, get, messageId, emoji, 'You');
    await sendEvent(conversationId, kind, {k: 'react', mid: messageId, emoji, name: myName()});
  },

  vote: async (conversationId, kind, pollId, opt) => {
    if (!applyVote(set, get, pollId, opt, 'You')) {
      return; // closed, already answered (quiz) or not a real option: nothing to send
    }
    await sendEvent(conversationId, kind, {k: 'vote', mid: pollId, opt, name: myName()});
  },

  deleteLocal: (conversationId, messageId) => {
    const gone = (get().byConversation[conversationId] ?? []).find(m => m.id === messageId);
    set(state => {
      const list = state.byConversation[conversationId] ?? [];
      const outbox = {...state.outbox};
      delete outbox[messageId];
      return {
        byConversation: {...state.byConversation, [conversationId]: list.filter(m => m.id !== messageId)},
        outbox,
      };
    });
    clearPin(conversationId, messageId);
    if (gone) {
      forgetMessageMedia(gone);
    } else {
      void forgetImage(messageId);
    }
  },

  deleteMany: (conversationId, messageIds) => {
    const ids = new Set(messageIds);
    ids.forEach(id => clearPin(conversationId, id));
    const goneMsgs = (get().byConversation[conversationId] ?? []).filter(m => ids.has(m.id));
    set(state => {
      const outbox = {...state.outbox};
      ids.forEach(id => delete outbox[id]);
      return {
        byConversation: {
          ...state.byConversation,
          [conversationId]: (state.byConversation[conversationId] ?? []).filter(m => !ids.has(m.id)),
        },
        outbox,
      };
    });
    goneMsgs.forEach(forgetMessageMedia);
  },

  deleteForEveryone: (conversationId, kind, messageId) => {
    const mine = (get().byConversation[conversationId] ?? []).find(m => m.id === messageId && m.mine);
    if (!mine) {
      return;
    }
    get().deleteLocal(conversationId, messageId);
    // A single "remove it" note can get lost on a relay — say it three times.
    const note: ChatEvent = {k: 'del', mid: messageId};
    quietSend(conversationId, kind, note);
    setTimeout(() => quietSend(conversationId, kind, note), 3000);
    setTimeout(() => quietSend(conversationId, kind, note), 15000);
  },

  clearConversation: conversationId => {
    const msgs = get().byConversation[conversationId] ?? [];
    set(state => {
      const outbox = {...state.outbox};
      Object.values(outbox).forEach(o => {
        if (o.conversationId === conversationId) {
          delete outbox[o.mid];
        }
      });
      return {byConversation: {...state.byConversation, [conversationId]: []}, outbox};
    });
    msgs.forEach(forgetMessageMedia);
  },

  markOpened: (conversationId, kind, messageId) => {
    const m = (get().byConversation[conversationId] ?? []).find(x => x.id === messageId);
    if (!m || !m.viewOnce || m.opened) {
      return;
    }
    setMedia(set, conversationId, messageId, {opened: true, image: undefined, mediaGone: true});
    void forgetImage(messageId);
    quietSend(conversationId, kind, {k: 'opn', mid: messageId});
  },

  setDisappear: (conversationId, kind, ms) => {
    usePrefsStore.getState().patch(conversationId, {disappear: ms || undefined});
    if (ms) {
      clearPin(conversationId); // a pinned copy must not outlive the timer
    }
    if (isSecretId(conversationId)) {
      useSecretStore.getState().setTimer(conversationId, ms);
    }
    const note: ChatEvent = {k: 'dis', ms};
    quietSend(conversationId, kind, note);
    setTimeout(() => quietSend(conversationId, kind, note), 3000);
    setTimeout(() => quietSend(conversationId, kind, note), 15000);
  },

  toggleStar: (conversationId, messageId) => {
    const m = (get().byConversation[conversationId] ?? []).find(x => x.id === messageId);
    if (m) {
      setMedia(set, conversationId, messageId, {starred: !m.starred});
    }
  },

  editMessage: (conversationId, kind, messageId, text) => {
    const t = text.trim();
    const m = (get().byConversation[conversationId] ?? []).find(x => x.id === messageId && x.mine);
    if (!t || !m || m.type !== 'text' || Date.now() - m.timestamp > EDIT_WINDOW_MS || t === m.text) {
      return false;
    }
    setMedia(set, conversationId, messageId, {text: t, edited: true});
    const note: ChatEvent = {k: 'edit', mid: messageId, text: t};
    quietSend(conversationId, kind, note);
    setTimeout(() => quietSend(conversationId, kind, note), 3000);
    setTimeout(() => quietSend(conversationId, kind, note), 15000);
    return true;
  },

  pinMessage: (conversationId, kind, pin) => {
    const prefsApi = usePrefsStore.getState();
    if (kind !== 'direct' || isSecretId(conversationId) || prefsApi.prefs[conversationId]?.disappear) {
      return 'no';
    }
    const t = pinText(pin.text);
    if (!pin.mid || !t) {
      return 'no';
    }
    const now = pinsHere(conversationId);
    if (now.some(p => p.mid === pin.mid)) {
      return 'ok'; // already pinned
    }
    setPinsHere(conversationId, [...now, {mid: pin.mid, from: pin.mine ? selfKey() : conversationId, t, by: selfKey()}]);
    sendPinOp(conversationId, kind, {add: {mid: pin.mid, w: pin.mine ? 1 : 0, t}});
    return 'ok';
  },

  unpinMessage: (conversationId, kind, mid) => {
    if (kind === 'direct' && pinsHere(conversationId).some(p => p.mid === mid)) {
      setPinsHere(conversationId, pinsHere(conversationId).filter(p => p.mid !== mid));
      sendPinOp(conversationId, kind, {del: mid});
    }
  },

  forwardMessage: async (toId, toKind, msg, album) => {
    if (isSecretId(msg.conversationId)) {
      return; // secret messages can't be forwarded
    }
    if (msg.type === 'text' && msg.text) {
      await get().sendText(toId, toKind, msg.text);
    } else if (msg.type === 'image' && msg.image) {
      await get().sendImage(toId, toKind, msg.image, undefined, album ? {album} : undefined);
    } else if (msg.type === 'poll' && msg.poll) {
      await get().sendPoll(toId, toKind, msg.poll.question, msg.poll.options, {multi: msg.poll.multi, anon: msg.poll.anon, quiz: msg.poll.quiz, explain: msg.poll.explain});
    } else if (msg.type === 'contact' && msg.contact) {
      await get().sendContact(toId, toKind, msg.contact);
    } else if (msg.type === 'file' && msg.file?.done && msg.file.path) {
      const copy = await mediaFiles.copy(msg.file.path);
      if (copy) {
        await get().sendFile(toId, toKind, {path: copy, name: msg.file.name, size: msg.file.size, mime: msg.file.mime}, {kind: msg.file.kind, dur: msg.file.dur});
      }
    }
  },

  clearAllMedia: async () => {
    const index = getJSON<MediaIndexEntry[]>(MEDIA_INDEX_KEY, []);
    setJSON(MEDIA_INDEX_KEY, []);
    set(state => {
      const next: Record<string, ChatMessage[]> = {};
      for (const [cid, list] of Object.entries(state.byConversation)) {
        next[cid] = list.map(m => (m.type === 'image' ? {...m, image: undefined, mediaGone: true} : m));
      }
      return {byConversation: next};
    });
    await Promise.all(index.map(e => removeBlob(`img.${e.id}`)));
  },

  clearAllChats: async () => {
    const ids = Object.values(get().byConversation)
      .flat()
      .filter(m => m.type === 'image')
      .map(m => m.id);
    set({byConversation: {}, reactions: {}, votes: {}, outbox: {}});
    setJSON(MEDIA_INDEX_KEY, []);
    fileBuffers.clear();
    fileOut.clear();
    void mediaFiles.clearAll();
    await Promise.all(ids.map(id => removeBlob(`img.${id}`)));
  },

  markSeen: (conversationId, kind) => {
    if (kind !== 'direct' && kind !== 'group') {
      return;
    }
    const msgs = get().byConversation[conversationId] ?? [];
    const toAck = msgs.filter(m => !m.mine && !m.ackedSeen && m.progress === undefined);
    if (toAck.length === 0) {
      return;
    }
    const ids = new Set(toAck.map(m => m.id));
    // Flag first (persisted) so reopening the chat — or restarting the app —
    // never re-sends receipts for messages already acknowledged.
    set(state => ({
      byConversation: {
        ...state.byConversation,
        [conversationId]: (state.byConversation[conversationId] ?? []).map(m =>
          ids.has(m.id) ? {...m, ackedSeen: true} : m,
        ),
      },
    }));
    // Read receipts are optional: with them off, people never learn you opened the chat.
    if (!useSettingsStore.getState().app.readReceipts) {
      return;
    }
    for (const m of toAck) {
      // In a group, a receipt goes back to the one who wrote the message.
      quietSend(conversationId, kind, {k: 'receipt', mid: m.id}, kind === 'group' ? [m.from] : undefined);
    }
  },

  hydrateMedia: async conversationId => {
    const missing = (get().byConversation[conversationId] ?? []).filter(
      m => m.type === 'image' && !m.image && m.progress === undefined && !m.mediaGone,
    );
    for (const m of missing.slice(-12)) {
      const data = await loadBlob(`img.${m.id}`);
      setMedia(set, conversationId, m.id, data ? {image: data} : {mediaGone: true});
    }
  },

  messages: conversationId => get().byConversation[conversationId] ?? [],
  lastMessage: conversationId => {
    const list = get().byConversation[conversationId] ?? [];
    return list[list.length - 1];
  },
}));

// --- helpers ----------------------------------------------------------------

function addMine(
  set: Setter,
  partial: Pick<ChatMessage, 'id' | 'conversationId' | 'convKind' | 'type'> &
    Partial<Pick<ChatMessage, 'text' | 'image' | 'poll' | 'replyTo' | 'spoiler' | 'viewOnce' | 'viewSecs' | 'caption' | 'album' | 'file' | 'contact'>>,
  status: ChatMessage['status'] = 'sent',
) {
  const msg: ChatMessage = {
    ...partial,
    from: 'me',
    fromName: myName(),
    timestamp: Date.now(),
    expiresAt: expiresFor(partial.conversationId),
    mine: true,
    status,
    progress: status === 'sending' ? 0 : undefined,
  };
  set(state => ({byConversation: append(state, msg)}));
}

/** Patch fields on a single message (used for media progress / status). */
function setMedia(
  set: Setter,
  conversationId: string,
  id: string,
  patch: Partial<ChatMessage>,
) {
  set(state => {
    const list = state.byConversation[conversationId] ?? [];
    return {
      byConversation: {
        ...state.byConversation,
        [conversationId]: list.map(m => (m.id === id ? {...m, ...patch} : m)),
      },
    };
  });
}

/** Remember a direct message until its delivery receipt comes back. */
function track(set: Setter, mid: string, conversationId: string, kind: ConversationKind, event: ChatEvent) {
  const now = Date.now();
  if (kind === 'group') {
    // Wait for each member who has joined (they hold the key) to confirm; resend only to those who haven't.
    const group = useGroupsStore.getState().get(conversationId);
    const pending = (group?.joined ?? []).filter(k => k !== selfKey());
    if (pending.length === 0) {
      return;
    }
    set(state => ({
      outbox: {
        ...state.outbox,
        [mid]: {mid, conversationId, kind, event, tries: 0, nextAt: now + BACKOFF_S[0] * 1000, createdAt: now, pending},
      },
    }));
    return;
  }
  if (kind !== 'direct' || conversationId === selfKey()) {
    return;
  }
  set(state => ({
    outbox: {
      ...state.outbox,
      [mid]: {mid, conversationId, kind, event, tries: 0, nextAt: now + BACKOFF_S[0] * 1000, createdAt: now},
    },
  }));
}

/** `to`: in a group, only these members (a resend, or a receipt that goes back to just the sender). Default: everybody. */
async function sendEvent(conversationId: string, kind: ConversationKind, event: ChatEvent, to?: string[]) {
  if (kind === 'direct' && conversationId === selfKey()) {
    return; // notes to self stay on this phone
  }
  const engine = getMeshEngine();
  const me = getIdentity();
  const json = JSON.stringify(event);
  const id = newPacketId();

  if (kind === 'direct') {
    // Forward-secret session when there is one; the older static-key box only
    // until the session is set up (a person on an older Pulse never gets one).
    const secret = isSecretId(conversationId) ? useSecretStore.getState().chats[conversationId] : undefined;
    if (isSecretId(conversationId) && !secret) {
      return; // that secret chat no longer exists
    }
    const peerKey = secret ? secret.peerKey : conversationId;
    const sealed = e2ee.encrypt(conversationId, json);
    let cipher: string;
    let nonce: string;
    if (sealed) {
      cipher = sealed;
      nonce = 'dr1';
    } else if (secret) {
      return; // keys not ready: the outbox tries again later; never downgrade a secret chat
    } else {
      ({cipher, nonce} = boxTo(json, peerKey, me.secretKey));
      ensureSession(peerKey);
    }
    // The Bluetooth/Wi-Fi mesh (Nearby) is the reliable, ordered path — it
    // handles delivery + dedup, so send there always. When the peer is also on
    // the same Wi-Fi LAN we ALSO fire it over TCP for a faster arrival; both
    // carry the same packet id, so the receiver dedups whichever loses the race.
    await engine.send({type: 'CHAT', id, recipient: peerKey, ttl: config.defaultTtl, payload: cipher, nonce});
    if (lanManager.isOnLan(peerKey)) {
      const lanPacket: MeshPacket = {
        id,
        type: 'CHAT',
        ttl: config.defaultTtl,
        origin: me.publicKey,
        recipient: peerKey,
        payload: cipher,
        nonce,
        originTimestamp: Date.now(),
        hops: 0,
      };
      try {
        lanManager.sendTo(peerKey, lanPacket);
      } catch {
        /* LAN best-effort only; the mesh send above is the guarantee */
      }
    }
  } else if (kind === 'group') {
    const group = useGroupsStore.getState().get(conversationId);
    if (!group) {
      return;
    }
    // In an announcement group only admins can send new messages (receipts, reactions… still go).
    if (CONTENT_EVENTS.includes(event.k) && !canSendIn(group, me.publicKey)) {
      return;
    }
    const {cipher, nonce} = sealGroup(json, group.key);
    const payload = b64({g: conversationId, c: cipher, n: nonce});
    // One addressed copy for each other member. A packet with a named receiver travels over Bluetooth/Wi-Fi AND the
    // internet, and waits for people who are away. (A broadcast with no receiver only ever reached phones in radio range.)
    // Each copy has its own packet id; the message id inside is what tells a receiver it already has the message.
    const others = (to ?? group.members).filter(k => k !== me.publicKey && group.members.includes(k));
    await Promise.all(others.map(k => engine.send({type: 'CHAT', recipient: k, ttl: config.defaultTtl, payload})));
  }
  // 'nearby' has no open broadcast room — nothing to send.
}

/** Fire-and-forget send: a background receipt/resend that fails must never surface as an unhandled error. */
function quietSend(conversationId: string, kind: ConversationKind, event: ChatEvent, to?: string[]): void {
  sendEvent(conversationId, kind, event, to).catch(() => undefined);
}

function senderName(origin: string, fallback?: string): string {
  return (
    usePairingStore.getState().paired.find(p => p.publicKey === origin)?.name ||
    usePeersStore.getState().peers[origin]?.name ||
    fallback ||
    shortId(origin)
  );
}

/** Tell the sender their message reached us (direct chats only). */
function ackDelivered(conversationId: string, convKind: ConversationKind, mid: string) {
  if (convKind === 'direct') {
    quietSend(conversationId, convKind, {k: 'dlv', mid});
  } else if (convKind === 'group') {
    // In a group the confirmation goes back to the message's sender only (not to the whole group).
    const m = (useChatStore.getState().byConversation[conversationId] ?? []).find(x => x.id === mid);
    if (m && !m.mine) {
      quietSend(conversationId, convKind, {k: 'dlv', mid}, [m.from]);
    }
  }
}

/**
 * A member confirmed (d) or read (s) one of MY group messages. The message shows "delivered" once everyone who has joined
 * has it, and "seen" once everyone has read it; Message info lists who and when.
 */
function ackGroup(set: Setter, get: Getter, conversationId: string, mid: string, who: string, field: 'd' | 's', hops: number) {
  const group = useGroupsStore.getState().get(conversationId);
  const mine = (get().byConversation[conversationId] ?? []).find(m => m.id === mid && m.mine);
  if (!group || !mine || !group.members.includes(who)) {
    return;
  }
  const at = Date.now();
  const before = mine.acks?.[who];
  const acks = {...mine.acks, [who]: {...before, d: before?.d ?? at, ...(field === 's' ? {s: before?.s ?? at} : {})}};
  const others = group.joined.filter(k => k !== selfKey());
  const delivered = others.length > 0 && others.every(k => acks[k]?.d);
  const seen = others.length > 0 && others.every(k => acks[k]?.s);
  set(state => {
    const outbox = {...state.outbox};
    const item = outbox[mid];
    if (item?.pending) {
      const left = item.pending.filter(k => k !== who);
      if (left.length === 0) {
        delete outbox[mid];
      } else {
        outbox[mid] = {...item, pending: left};
      }
    }
    return {outbox};
  });
  setMedia(set, conversationId, mid, {acks, status: seen ? 'seen' : delivered ? 'delivered' : 'sent', hops, ...(delivered ? {deliveredAt: at} : {}), ...(seen ? {seenAt: at} : {})});
}

/** Raise an Android notification for a freshly arrived message. */
function notifyInbound(get: Getter, msg: ChatMessage, origin: string) {
  if (msg.convKind === 'nearby') {
    return;
  }
  const prefs = usePrefsStore.getState();
  const group = msg.convKind === 'group' ? useGroupsStore.getState().get(msg.conversationId) : undefined;
  const person = prefs.nameFor(origin, msg.fromName);
  notifier.message({
    conversationId: msg.conversationId,
    kind: msg.convKind === 'group' ? 'group' : 'direct',
    title: group ? group.name : person,
    sender: person,
    text: previewOf(msg),
    avatar: usePeersStore.getState().peers[origin]?.avatar ?? prefs.profiles[origin]?.avatar,
    activeConversation: get().active,
    // "@Maya" in a group: it notifies even if the group is muted
    mention: msg.convKind === 'group' && !!msg.text && mentions(msg.text, myName()),
  });
}

function applyEvent(
  set: Setter,
  get: Getter,
  event: ChatEvent,
  origin: string,
  conversationId: string,
  convKind: ConversationKind,
  hops: number,
) {
  if (
    (event.k === 'msg' || event.k === 'img' || event.k === 'mbeg' || event.k === 'fbeg' || event.k === 'poll' || event.k === 'card') &&
    get().tombstones[`${origin}:${event.id}`]
  ) {
    return; // the sender already removed this one
  }
  switch (event.k) {
    case 'msg': {
      const isNew = !hasMessage(get, conversationId, event.id);
      if (isNew) {
        const msg: ChatMessage = {
          id: event.id,
          conversationId,
          convKind,
          type: 'text',
          from: origin,
          fromName: senderName(origin, event.name),
          text: event.text,
          replyTo: fromWire(event.r),
          timestamp: Date.now(),
          mine: false,
      expiresAt: expiresFor(conversationId),
          hops,
        };
        const typingKey = convKind === 'group' ? `${conversationId}:${origin}` : origin;
        set(state => ({
          byConversation: append(state, msg),
          typing: state.typing[typingKey] ? {...state.typing, [typingKey]: 0} : state.typing,
        }));
        notifyInbound(get, msg, origin);
      }
      ackDelivered(conversationId, convKind, event.id); // also re-acks a resend whose ack got lost
      break;
    }
    case 'img':
      set(state => ({
        byConversation: append(state, {
          id: event.id,
          conversationId,
          convKind,
          type: 'image',
          from: origin,
          fromName: senderName(origin, event.name),
          image: event.data,
          replyTo: fromWire(event.r),
          timestamp: Date.now(),
          mine: false,
      expiresAt: expiresFor(conversationId),
          hops,
        }),
      }));
      ackDelivered(conversationId, convKind, event.id);
      break;
    case 'mbeg': {
      if (hasMessage(get, conversationId, event.id)) {
        // A resend of a header we already have: if the photo is complete, re-ack.
        const have = (get().byConversation[conversationId] ?? []).find(m => m.id === event.id);
        if (have?.image) {
          ackDelivered(conversationId, convKind, event.id);
        }
        break;
      }
      // A full-res photo is arriving in chunks — show a placeholder that fills
      // in as it streams.
      const buf: MediaBuffer = {
        parts: new Array(event.n).fill(''),
        received: 0,
        total: event.n,
        lastAt: Date.now(),
        asks: 0,
        conversationId,
        kind: convKind,
      };
      const early = orphanChunks.get(event.id);
      if (early) {
        for (const [i, d] of early) {
          if (i >= 0 && i < buf.total && buf.parts[i] === '') {
            buf.parts[i] = d;
            buf.received += 1;
          }
        }
        orphanChunks.delete(event.id);
      }
      mediaBuffers.set(event.id, buf);
      const placeholder: ChatMessage = {
        id: event.id,
        conversationId,
        convKind,
        type: 'image',
        from: origin,
        fromName: senderName(origin, event.name),
        replyTo: fromWire(event.r),
        timestamp: Date.now(),
        mine: false,
      expiresAt: expiresFor(conversationId),
        status: 'sending',
        progress: buf.received / buf.total,
        hops,
        spoiler: event.sp ? true : undefined,
        viewOnce: event.vo ? true : undefined,
        viewSecs: event.vo && typeof event.vs === 'number' && event.vs > 0 ? Math.min(300, Math.round(event.vs)) : undefined,
        caption: cleanCaption(event.c),
        album: cleanAlbum(event.al),
      };
      set(state => ({byConversation: append(state, placeholder)}));
      if (!placeholder.album || placeholder.album.i === 0) {
        notifyInbound(get, placeholder, origin); // one notification for a whole album, not one per photo
      }
      if (buf.received >= buf.total) {
        finishMedia(set, event.id, buf);
      }
      break;
    }
    case 'mchk': {
      const buf = mediaBuffers.get(event.id);
      if (!buf) {
        // Header hasn't arrived (yet) — hold the piece. Bounded so noise can't grow it.
        let m = orphanChunks.get(event.id);
        if (!m) {
          if (orphanChunks.size >= 8) {
            orphanChunks.delete(orphanChunks.keys().next().value as string);
          }
          m = new Map();
          orphanChunks.set(event.id, m);
        }
        if (m.size < 400) {
          m.set(event.i, event.d);
        }
        break;
      }
      buf.lastAt = Date.now();
      if (event.i >= 0 && event.i < buf.total && buf.parts[event.i] === '') {
        buf.parts[event.i] = event.d;
        buf.received += 1;
      }
      if (buf.received >= buf.total) {
        finishMedia(set, event.id, buf);
      } else {
        setMedia(set, buf.conversationId, event.id, {progress: buf.received / buf.total});
      }
      break;
    }
    case 'fbeg': {
      if (hasMessage(get, conversationId, event.id)) {
        const have = (get().byConversation[conversationId] ?? []).find(m => m.id === event.id);
        if (have?.file?.done) {
          ackDelivered(conversationId, convKind, event.id); // a resend of a header we already finished
        }
        break;
      }
      const fi = event.f;
      const expected = Math.max(1, Math.ceil(fi.s / CHUNK_BYTES));
      if (!fi || fi.s <= 0 || fi.s > MAX_FILE_BYTES || event.n !== expected) {
        break; // nonsense or too big: ignore
      }
      const buf: FileBuffer = {
        path: '',
        total: event.n,
        got: new Array(event.n).fill(false),
        received: 0,
        shown: 0,
        lastAt: Date.now(),
        asks: 0,
        conversationId,
        kind: convKind,
        ready: Promise.resolve(false),
        chain: Promise.resolve(),
        finishing: false,
      };
      buf.ready = (async () => {
        const dir = await mediaFiles.dir();
        if (!dir) {
          return false;
        }
        buf.path = `${dir}/${event.id}_${safeFileName(fi.n)}`;
        setMedia(set, conversationId, event.id, {file: {...(get().byConversation[conversationId]?.find(m => m.id === event.id)?.file as FileInfo), path: buf.path}});
        return mediaFiles.allocate(buf.path, fi.s);
      })();
      fileBuffers.set(event.id, buf);
      const placeholder: ChatMessage = {
        id: event.id,
        conversationId,
        convKind,
        type: 'file',
        from: origin,
        fromName: senderName(origin, event.name),
        file: {name: fi.n, size: fi.s, mime: fi.m, kind: fi.t, dur: fi.d, thumb: fi.th},
        caption: cleanCaption(event.c),
        replyTo: fromWire(event.r),
        timestamp: Date.now(),
        mine: false,
        expiresAt: expiresFor(conversationId),
        status: 'sending',
        progress: 0,
        hops,
      };
      set(state => ({byConversation: append(state, placeholder)}));
      notifyInbound(get, placeholder, origin);
      const early = orphanChunks.get(event.id);
      if (early) {
        orphanChunks.delete(event.id);
        for (const [i, d] of early) {
          takeFileChunk(set, get, event.id, i, d);
        }
      }
      break;
    }
    case 'fchk': {
      if (!fileBuffers.has(event.id)) {
        // The header hasn't arrived (yet) — hold the piece, bounded so noise can't grow it.
        let m = orphanChunks.get(event.id);
        if (!m) {
          if (orphanChunks.size >= 8) {
            orphanChunks.delete(orphanChunks.keys().next().value as string);
          }
          m = new Map();
          orphanChunks.set(event.id, m);
        }
        if (m.size < 400) {
          m.set(event.i, event.d);
        }
        break;
      }
      takeFileChunk(set, get, event.id, event.i, event.d);
      break;
    }
    case 'freq': {
      // The receiver is missing pieces of a file I sent — read them from disk and send them again.
      const out = fileOut.get(event.id);
      if (!out) {
        break;
      }
      void (async () => {
        for (const i of event.miss.slice(0, 24)) {
          if (Number.isInteger(i) && i >= 0 && i < out.n) {
            const d = await mediaFiles.readChunk(out.path, i * CHUNK_BYTES, CHUNK_BYTES);
            if (d) {
              await sendEvent(out.conversationId, out.kind, {k: 'fchk', id: event.id, i, d});
            }
          }
        }
      })();
      break;
    }
    case 'mreq': {
      // The receiver is missing pieces of a photo I sent — send those again.
      const out = mediaOut.get(event.id);
      if (!out) {
        break;
      }
      void (async () => {
        for (const i of event.miss.slice(0, 24)) {
          if (Number.isInteger(i) && i >= 0 && i < out.chunks.length) {
            await sendEvent(out.conversationId, out.kind, {k: 'mchk', id: event.id, i, d: out.chunks[i]});
          }
        }
      })();
      break;
    }
    case 'poll': {
      const isNew = !hasMessage(get, conversationId, event.id);
      if (isNew) {
        const msg: ChatMessage = {
          id: event.id,
          conversationId,
          convKind,
          type: 'poll',
          from: origin,
          fromName: senderName(origin, event.name),
          poll: cleanPoll(event),
          timestamp: Date.now(),
          mine: false,
      expiresAt: expiresFor(conversationId),
          hops,
        };
        set(state => ({byConversation: append(state, msg)}));
        notifyInbound(get, msg, origin);
      }
      ackDelivered(conversationId, convKind, event.id);
      break;
    }
    case 'card': {
      if (typeof event.pk !== 'string' || !validKey(event.pk)) {
        break; // not a real key: ignore
      }
      const isNew = !hasMessage(get, conversationId, event.id);
      if (isNew) {
        const msg: ChatMessage = {
          id: event.id,
          conversationId,
          convKind,
          type: 'contact',
          from: origin,
          fromName: senderName(origin, event.name),
          contact: {key: event.pk, name: (typeof event.pn === 'string' ? event.pn.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) : '') || 'Pulse user'},
          timestamp: Date.now(),
          mine: false,
          expiresAt: expiresFor(conversationId),
          hops,
        };
        set(state => ({byConversation: append(state, msg)}));
        notifyInbound(get, msg, origin);
      }
      ackDelivered(conversationId, convKind, event.id);
      break;
    }
    case 'react':
      applyReaction(set, get, event.mid, event.emoji, senderName(origin, event.name));
      break;
    case 'vote':
      applyVote(set, get, event.mid, event.opt, senderName(origin, event.name));
      break;
    case 'dlv': {
      // Reached their phone. Stop retrying and show the double tick.
      const mine = (get().byConversation[conversationId] ?? []).find(m => m.id === event.mid && m.mine);
      if (!mine) {
        break;
      }
      if (convKind === 'group') {
        ackGroup(set, get, conversationId, event.mid, origin, 'd', hops);
        break;
      }
      set(state => {
        const outbox = {...state.outbox};
        delete outbox[event.mid];
        return {outbox};
      });
      if (mine.status !== 'seen') {
        setMedia(set, conversationId, event.mid, {status: 'delivered', hops, deliveredAt: Date.now()});
      }
      break;
    }
    case 'del': {
      const list = get().byConversation[conversationId] ?? [];
      const target = list.find(m => m.id === event.mid);
      if (target && target.from !== origin) {
        break; // only a message's own sender can take it back
      }
      set(state => {
        const tomb = {...state.tombstones, [`${origin}:${event.mid}`]: Date.now()};
        const keys = Object.keys(tomb);
        if (keys.length > MAX_TOMBSTONES) {
          delete tomb[keys[0]];
        }
        return {
          tombstones: tomb,
          byConversation: {
            ...state.byConversation,
            [conversationId]: (state.byConversation[conversationId] ?? []).filter(m => m.id !== event.mid),
          },
        };
      });
      if (target) {
        forgetMessageMedia(target);
      }
      if (convKind === 'direct' && usePrefsStore.getState().prefs[conversationId]?.pinMsgs?.some(p => p.mid === event.mid && p.from === origin)) {
        clearPin(conversationId, event.mid); // the pinned message was taken back
      }
      break;
    }
    case 'pinq': {
      // The other phone's pin list differs from mine: send it whole (in small parts).
      if (convKind === 'direct' && !isSecretId(conversationId)) {
        sendAllPins(conversationId, convKind);
      }
      break;
    }
    case 'pin': {
      // Only one-to-one chats, never secret chats or ones that make messages vanish. "by" is who really sent this note.
      if (convKind !== 'direct' || isSecretId(conversationId) || usePrefsStore.getState().prefs[conversationId]?.disappear) {
        break;
      }
      const clean = (p: unknown): PinRec | null => {
        const o = p as Partial<PinWire> | null;
        const t = pinText(o?.t);
        return o && typeof o.mid === 'string' && o.mid && o.mid.length <= 80 && t ? {mid: o.mid, from: o.w === 1 ? origin : selfKey(), t, by: origin} : null;
      };
      if (Array.isArray(event.ps)) {
        // The whole list. Without `of` it is one old-style message; with it, parts collected until all are here.
        const parts = Number.isInteger(event.of) && event.of! > 1 && event.of! <= 400 && Number.isInteger(event.i) && event.i! >= 0 && event.i! < event.of! ? event.of! : 1;
        const key = conversationId;
        const got = pinParts.get(key) && pinParts.get(key)!.of === parts ? pinParts.get(key)! : {of: parts, parts: new Map<number, PinWire[]>()};
        got.parts.set(parts === 1 ? 0 : event.i!, event.ps);
        pinParts.set(key, got);
        if (got.parts.size >= got.of) {
          pinParts.delete(key);
          const list: PinRec[] = [];
          for (let i = 0; i < got.of; i++) {
            for (const raw of got.parts.get(i) ?? []) {
              const rec = clean(raw);
              if (rec && !list.some(x => x.mid === rec.mid)) {
                list.push(rec);
              }
            }
          }
          setPinsHere(conversationId, list);
        }
        break;
      }
      let list = pinsHere(conversationId);
      const add = event.add ? clean(event.add) : null;
      if (add && !list.some(x => x.mid === add.mid)) {
        list = [...list, add];
      }
      if (typeof event.del === 'string') {
        list = list.filter(x => x.mid !== event.del);
      }
      setPinsHere(conversationId, list);
      if (typeof event.n === 'number' && list.length !== event.n && Date.now() - (pinAsked.get(conversationId) ?? 0) > 20000) {
        pinAsked.set(conversationId, Date.now());
        quietSend(conversationId, convKind, {k: 'pinq'}); // my count differs: ask for the whole list
      }
      break;
    }
    case 'opn': {
      // They opened my view-once photo: my copy goes too.
      const mine = (get().byConversation[conversationId] ?? []).find(m => m.id === event.mid && m.mine && m.viewOnce);
      if (mine) {
        setMedia(set, conversationId, event.mid, {opened: true, image: undefined, mediaGone: true});
        void forgetImage(event.mid);
      }
      break;
    }
    case 'dis': {
      if (DISAPPEAR_CHOICES.includes(event.ms) || (isSecretId(conversationId) && SECRET_TIMERS.includes(event.ms))) {
        if (isSecretId(conversationId)) {
          useSecretStore.getState().setTimer(conversationId, event.ms);
        }
        usePrefsStore.getState().patch(conversationId, {disappear: event.ms || undefined});
        if (event.ms) {
          clearPin(conversationId);
        }
      }
      break;
    }
    case 'edit': {
      const target = (get().byConversation[conversationId] ?? []).find(m => m.id === event.mid);
      if (target && target.from === origin && target.type === 'text' && target.text !== event.text) {
        setMedia(set, conversationId, event.mid, {text: event.text, edited: true});
      }
      break;
    }
    case 'hi':
      if (isSecretId(conversationId)) {
        useSecretStore.getState().markReady(conversationId);
      }
      break;
    case 'receipt':
      if (convKind === 'group') {
        // One member read my group message: noted per person; "seen" once everyone has.
        ackGroup(set, get, conversationId, event.mid, origin, 's', hops);
        break;
      }
      // Mark my matching message as seen — and it obviously arrived.
      set(state => {
        const next: Record<string, ChatMessage[]> = {};
        for (const [cid, list] of Object.entries(state.byConversation)) {
          next[cid] = list.map(m => (m.id === event.mid && m.mine ? {...m, status: 'seen', seenAt: Date.now()} : m));
        }
        const outbox = {...state.outbox};
        delete outbox[event.mid];
        return {byConversation: next, outbox};
      });
      break;
  }
}

/** One more piece of an incoming file: write it where it belongs; finish when every piece is in. */
function takeFileChunk(set: Setter, get: Getter, id: string, i: number, d: string) {
  const buf = fileBuffers.get(id);
  if (!buf || !Number.isInteger(i) || i < 0 || i >= buf.total || buf.got[i] || typeof d !== 'string') {
    return;
  }
  buf.got[i] = true;
  buf.received += 1;
  buf.lastAt = Date.now();
  buf.chain = buf.chain.then(async () => {
    if (await buf.ready) {
      await mediaFiles.writeChunk(buf.path, i * CHUNK_BYTES, d);
    }
  });
  const p = buf.received / buf.total;
  if (buf.received >= buf.total) {
    buf.finishing = true;
    // Finish once every write has actually landed on disk.
    void buf.chain.then(() => {
      fileBuffers.delete(id);
      const cur = (get().byConversation[buf.conversationId] ?? []).find(m => m.id === id);
      if (!cur?.file) {
        return;
      }
      setMedia(set, buf.conversationId, id, {file: {...cur.file, path: buf.path, done: true}, progress: undefined, status: 'sent'});
      ackDelivered(buf.conversationId, buf.kind, id);
    });
  } else if (p - buf.shown >= 0.01) {
    buf.shown = p;
    setMedia(set, buf.conversationId, id, {progress: p});
  }
}

function finishMedia(set: Setter, id: string, buf: MediaBuffer) {
  const data = buf.parts.join('');
  mediaBuffers.delete(id);
  setMedia(set, buf.conversationId, id, {image: data, progress: undefined, status: 'sent'});
  void rememberImage(id, data);
  ackDelivered(buf.conversationId, buf.kind, id);
}

function applyReaction(set: Setter, get: Getter, messageId: string, emoji: string, from: string) {
  const list = get().reactions[messageId] ?? [];
  // One emoji per person: toggle off if same, otherwise replace their reaction.
  const withoutMine = list.filter(r => r.from !== from);
  const already = list.find(r => r.from === from);
  const next = already && already.emoji === emoji ? withoutMine : [...withoutMine, {emoji, from}];
  set(state => ({reactions: {...state.reactions, [messageId]: next}}));
}

/** A poll that came over the wire, made safe: sensible lengths and counts, flags only if they make sense. */
function cleanPoll(e: {q: string; o: string[]; m?: 1; an?: 1; qz?: number; ex?: string; cl?: number}): PollData {
  const options = (Array.isArray(e.o) ? e.o : []).filter(x => typeof x === 'string').slice(0, 10).map(x => x.slice(0, 60));
  const quiz = Number.isInteger(e.qz) && (e.qz as number) >= 0 && (e.qz as number) < options.length ? (e.qz as number) : undefined;
  const now = Date.now();
  return {
    question: String(e.q ?? '').slice(0, 140),
    options,
    multi: e.m && quiz === undefined ? true : undefined,
    anon: e.an ? true : undefined,
    quiz,
    explain: quiz !== undefined && typeof e.ex === 'string' && e.ex.trim() ? e.ex.trim().slice(0, 200) : undefined,
    closesAt: typeof e.cl === 'number' && e.cl > now - 86_400_000 && e.cl < now + 31 * 86_400_000 ? Math.round(e.cl) : undefined,
  };
}

function findPoll(get: Getter, pollId: string): PollData | undefined {
  for (const list of Object.values(get().byConversation)) {
    const m = list.find(x => x.id === pollId);
    if (m?.poll) {
      return m.poll;
    }
  }
  return undefined;
}

/**
 * One vote, by the poll's own rules. Single answer: a new pick replaces the old one. Multiple answers: tapping toggles.
 * Quiz: one answer, final. Closed or not a real option: ignored. Returns whether it counted.
 */
function applyVote(set: Setter, get: Getter, pollId: string, opt: number, voter: string): boolean {
  const def = findPoll(get, pollId);
  if (def) {
    if (!Number.isInteger(opt) || opt < 0 || opt >= def.options.length) {
      return false;
    }
    if (def.closesAt && Date.now() > def.closesAt) {
      return false;
    }
  }
  const poll = get().votes[pollId] ?? {};
  const had = Object.values(poll).some(v => v.includes(voter));
  if (def?.quiz !== undefined && had) {
    return false; // a quiz answer is final
  }
  const next: Record<number, string[]> = {};
  for (const [k, voters] of Object.entries(poll)) {
    next[Number(k)] = voters;
  }
  if (def?.multi) {
    const cur = next[opt] ?? [];
    next[opt] = cur.includes(voter) ? cur.filter(v => v !== voter) : [...cur, voter];
  } else {
    for (const k of Object.keys(next)) {
      next[Number(k)] = next[Number(k)].filter(v => v !== voter);
    }
    next[opt] = [...(next[opt] ?? []), voter];
  }
  set(state => ({votes: {...state.votes, [pollId]: next}}));
  return true;
}

// ---------------------------------------------------------------------------
// photos on disk (encrypted, bounded)
// ---------------------------------------------------------------------------

type MediaIndexEntry = {id: string; size: number; at: number};

async function rememberImage(id: string, data: string) {
  const size = await saveBlob(`img.${id}`, data);
  if (size === 0) {
    return;
  }
  let index = getJSON<MediaIndexEntry[]>(MEDIA_INDEX_KEY, []).filter(e => e.id !== id);
  index.push({id, size, at: Date.now()});
  let total = index.reduce((s, e) => s + e.size, 0);
  while (total > MEDIA_BUDGET && index.length > 1) {
    const oldest = index.shift()!;
    total -= oldest.size;
    void removeBlob(`img.${oldest.id}`);
  }
  index = index.slice(-300);
  setJSON(MEDIA_INDEX_KEY, index);
}

async function forgetImage(id: string) {
  await removeBlob(`img.${id}`);
  setJSON(
    MEDIA_INDEX_KEY,
    getJSON<MediaIndexEntry[]>(MEDIA_INDEX_KEY, []).filter(e => e.id !== id),
  );
}

// ---------------------------------------------------------------------------
// history (encrypted at rest via the "chat." storage prefix)
// ---------------------------------------------------------------------------

type History = {
  byConversation: Record<string, ChatMessage[]>;
  reactions: Record<string, Reaction[]>;
  votes: Record<string, Record<number, string[]>>;
  outbox: Record<string, OutItem>;
  tombstones?: Record<string, number>;
};

function hydrateHistory(set: Setter) {
  const saved = getJSON<History | null>(HISTORY_KEY, null);
  if (!saved) {
    return;
  }
  set(() => ({
    byConversation: saved.byConversation ?? {},
    reactions: saved.reactions ?? {},
    votes: saved.votes ?? {},
    outbox: saved.outbox ?? {},
    tombstones: saved.tombstones ?? {},
  }));
}

function snapshot(s: ChatState): History {
  const byConversation: Record<string, ChatMessage[]> = {};
  for (const [cid, list] of Object.entries(s.byConversation)) {
    byConversation[cid] = list.slice(-MAX_PER_CONVERSATION).map(m => {
      // Photos live in their own encrypted store; a transfer that was cut off by
      // closing the app can't resume, so show it as failed rather than stuck.
      const interrupted = m.progress !== undefined;
      return {
        ...m,
        image: undefined,
        progress: undefined,
        status: interrupted ? 'failed' : m.status,
      };
    });
  }
  return {byConversation, reactions: s.reactions, votes: s.votes, outbox: s.outbox, tombstones: s.tombstones};
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (persistTimer) {
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    setJSON(HISTORY_KEY, snapshot(useChatStore.getState()));
  }, 1500);
}

// ---------------------------------------------------------------------------
// background work: persistence, resends, photo re-requests
// ---------------------------------------------------------------------------

let started = false;

function startBackgroundWork(set: Setter, get: Getter) {
  if (started) {
    return;
  }
  started = true;

  // Save whenever the conversation data actually changes.
  useChatStore.subscribe((s, prev) => {
    if (
      s.byConversation !== prev.byConversation ||
      s.reactions !== prev.reactions ||
      s.votes !== prev.votes ||
      s.outbox !== prev.outbox ||
      s.tombstones !== prev.tombstones
    ) {
      schedulePersist();
    }
  });

  // Resend direct messages that haven't been confirmed, with back-off.
  setInterval(() => {
    const now = Date.now();
    for (const item of Object.values(get().outbox)) {
      if (now - item.createdAt > GIVE_UP_MS) {
        set(state => {
          const outbox = {...state.outbox};
          delete outbox[item.mid];
          return {outbox};
        });
        const cur = (get().byConversation[item.conversationId] ?? []).find(m => m.id === item.mid);
        // A group message that at least somebody confirmed is not a failure, even if others never came back.
        const reachedSomeone = item.kind === 'group' && !!cur?.acks && Object.keys(cur.acks).length > 0;
        if (cur && cur.status !== 'delivered' && cur.status !== 'seen' && !reachedSomeone) {
          setMedia(set, item.conversationId, item.mid, {status: 'failed'});
        }
        continue;
      }
      if (now < item.nextAt) {
        continue;
      }
      const tries = item.tries + 1;
      const wait = BACKOFF_S[Math.min(tries, BACKOFF_S.length - 1)] * 1000;
      set(state => ({
        outbox: state.outbox[item.mid]
          ? {...state.outbox, [item.mid]: {...item, tries, nextAt: now + wait}}
          : state.outbox,
      }));
      quietSend(item.conversationId, item.kind, item.event, item.pending);
    }
    // Disappearing messages: remove what has expired (starred messages are kept).
    const byConv = get().byConversation;
    let changed = false;
    const kept: Record<string, ChatMessage[]> = {};
    for (const [cid, list] of Object.entries(byConv)) {
      const keep = list.filter(m => !m.expiresAt || m.expiresAt > now || m.starred);
      if (keep.length !== list.length) {
        changed = true;
        list.filter(m => !keep.includes(m)).forEach(forgetMessageMedia);
      }
      kept[cid] = keep;
    }
    if (changed) {
      set(() => ({byConversation: kept}));
    }
    // Forget outbound photo pieces after a while.
    for (const [id, o] of mediaOut) {
      if (now - o.at > 15 * 60 * 1000) {
        mediaOut.delete(id);
      }
    }
  }, 5000);

  // A person who was out of range just showed up: try again right away.
  usePeersStore.subscribe((s, prev) => {
    const items = Object.values(get().outbox);
    if (items.length === 0) {
      return;
    }
    const arrived = Object.keys(s.peers).filter(k => !prev.peers[k]);
    if (arrived.length === 0) {
      return;
    }
    const soon = Date.now() + 2000;
    set(state => {
      const outbox = {...state.outbox};
      for (const item of items) {
        if ((arrived.includes(item.conversationId) || item.pending?.some(k => arrived.includes(k))) && item.nextAt > soon) {
          outbox[item.mid] = {...item, nextAt: soon};
        }
      }
      return {outbox};
    });
  });

  // A direct internet link to someone just opened: send what is waiting for them now.
  useNetStore.subscribe((s, prev) => {
    const opened = s.linked.filter(k => !prev.linked.includes(k));
    if (opened.length === 0) {
      return;
    }
    const soon = Date.now() + 500;
    set(state => {
      const outbox = {...state.outbox};
      for (const item of Object.values(state.outbox)) {
        if ((opened.includes(item.conversationId) || item.pending?.some(k => opened.includes(k))) && item.nextAt > soon) {
          outbox[item.mid] = {...item, nextAt: soon};
        }
      }
      return {outbox};
    });
  });

  // Files that stall: ask the sender for the pieces we're missing.
  setInterval(() => {
    const now = Date.now();
    for (const [id, buf] of fileBuffers) {
      if (buf.finishing || now - buf.lastAt < FILE_STALL_MS) {
        continue;
      }
      if (buf.asks >= FILE_MAX_ASKS) {
        fileBuffers.delete(id);
        setMedia(set, buf.conversationId, id, {status: 'failed', progress: undefined});
        continue;
      }
      buf.asks += 1;
      buf.lastAt = now;
      const miss: number[] = [];
      for (let i = 0; i < buf.total && miss.length < 24; i++) {
        if (!buf.got[i]) {
          miss.push(i);
        }
      }
      quietSend(buf.conversationId, buf.kind, {k: 'freq', id, miss});
    }
    for (const [id, o] of fileOut) {
      if (now - o.at > 30 * 60 * 1000) {
        fileOut.delete(id);
      }
    }
  }, 2000);

  // Photos that stall: ask the sender for the pieces we're missing.
  setInterval(() => {
    const now = Date.now();
    for (const [id, buf] of mediaBuffers) {
      if (now - buf.lastAt < MEDIA_STALL_MS) {
        continue;
      }
      if (buf.asks >= MEDIA_MAX_ASKS) {
        mediaBuffers.delete(id);
        setMedia(set, buf.conversationId, id, {status: 'failed', progress: undefined});
        continue;
      }
      buf.asks += 1;
      buf.lastAt = now;
      const miss: number[] = [];
      for (let i = 0; i < buf.total && miss.length < 24; i++) {
        if (buf.parts[i] === '') {
          miss.push(i);
        }
      }
      quietSend(buf.conversationId, buf.kind, {k: 'mreq', id, miss});
    }
  }, 2000);
}

/** How many photos are stored on this phone and roughly how much space they take. */
export function mediaUsage(): {count: number; bytes: number} {
  const index = getJSON<MediaIndexEntry[]>(MEDIA_INDEX_KEY, []);
  return {count: index.length, bytes: index.reduce((sum, e) => sum + e.size, 0)};
}
