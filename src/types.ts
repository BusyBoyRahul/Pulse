/** Shared domain types across the app + mesh + server contract. */

export type TrustedContact = {
  id: string; // local uuid; server id merged after sync
  serverId?: number;
  name: string;
  phoneNumber: string;
};

export type MeshPacketType =
  | 'SOS'
  | 'CHAT'
  | 'NOTE'
  | 'ACK'
  | 'PRESENCE' // periodic hello: announces {name} so peers can be discovered
  | 'PAIR' // 1:1 pair request / accept handshake
  | 'GROUP' // group control: invite (carries the shared group key, sealed)
  | 'CALL' // in-app voice call: sealed signalling + encrypted audio frames
  | 'TYPING'; // "is typing…" — sealed to one person, never carried or stored

/** The wire format relayed between devices over BLE. Keep it tiny. */
export type MeshPacket = {
  id: string; // unique message id — prevents re-broadcast loops
  type: MeshPacketType;
  ttl: number; // hops remaining, decremented on each relay
  origin: string; // sender public key (short id)
  payload: string; // base64 encrypted content (opaque to relays)
  nonce?: string; // base64 nonce for sealed payloads
  recipient?: string; // recipient public key for direct/sealed messages
  originTimestamp: number;
  /** Relays this packet has passed through (0 = heard straight from its sender). */
  hops?: number;
};

export type NearbyDevice = {
  deviceId: string;
  publicKey?: string;
  rssi: number | null;
  lastSeen: number;
};

export type SosState = 'idle' | 'arming' | 'countdown' | 'sent' | 'failed' | 'cancelled';

export type SafetyNote = {
  id: string;
  latitude: number;
  longitude: number;
  message: string;
  createdAt: number;
  expiresAt: number;
};

/** A discovered nearby identity (from PRESENCE broadcasts). */
export type Peer = {
  publicKey: string;
  name: string;
  lastSeen: number;
  avatar?: string; // data: URI of the peer's shared profile photo, if any
  /** 0 = in direct radio range; N = reached through N relay phones. */
  hops: number;
  /** Short "about me" line they chose to share. */
  bio?: string;
};

export type PairState = 'none' | 'incoming' | 'outgoing' | 'paired';

/** A person you've paired with (1:1). */
export type PairedPeer = {
  publicKey: string;
  name: string;
  pairedAt: number;
};

export type PairRequest = {
  publicKey: string;
  name: string;
  at: number;
  /** Their handshake key, so accepting sets up forward-secret encryption. */
  e?: string;
};

/** A group chat you're a member of. */
export type Group = {
  id: string;
  name: string;
  key: string; // shared symmetric key (base64)
  members: string[]; // invited roster (public keys, incl. creator)
  joined: string[]; // members who have ACCEPTED (public keys, incl. creator)
  /** The person who made the group. Always an admin, and the one who can't be demoted. */
  createdBy: string;
  createdAt: number;
  /** What happened in the group (joined, left, added, renamed…), shown as lines in the chat. Newest last. */
  notes?: GroupNote[];
  /** More admins besides the creator. Admins add and remove people, make other admins, and change the group's rules. */
  admins?: string[];
  /** What the group is about (up to 500 characters). */
  desc?: string;
  /** The group's picture: a small JPEG, base64 (no data: prefix). */
  pic?: string;
  /** The group's rules. Default (nothing set) = everyone may. */
  perms?: GroupPerms;
  /** Messages pinned to the top of the chat, oldest first (up to 3; a short copy of each, so it stays even if the original scrolls away). */
  pins?: GroupPin[];
  /** The one pin older versions kept. Read as the only item of `pins`; never written any more. */
  pinned?: GroupPin;
};

/** A pinned message: its id, who wrote it, a short text, and who pinned it. */
export type GroupPin = {mid: string; from: string; fromName: string; text: string; by: string};

/** Who may do what in a group. A missing value means "all members". */
export type GroupPerms = {
  /** Who can change the name, picture and description. */
  edit?: 'admins';
  /** Who can send messages (the others can only read: an announcement group). */
  send?: 'admins';
};

/** Someone who opened the group's link and asked to join; the admin has to approve. */
export type JoinRequest = {id: string; gid: string; key: string; name: string; at: number};

/** One line of group history, e.g. “Maya added Rahul”. The words are written when it happens, so they stay right later. */
export type GroupNote = {id: string; at: number; text: string};

/** A pending group invite awaiting the user's accept/decline. */
export type GroupInvite = {
  id: string;
  name: string;
  key: string;
  members: string[];
  byName: string;
  byKey: string;
  at: number;
  /** The group's picture, description, extra admins and rules as they are now, so the invite can show them. */
  pic?: string;
  desc?: string;
  admins?: string[];
  perms?: GroupPerms;
};

/** A conversation is either the nearby broadcast room, a 1:1, or a group. */
export type ConversationKind = 'nearby' | 'direct' | 'group';

export type MessageType = 'text' | 'image' | 'poll' | 'file' | 'contact';

/** A file, video, audio file or voice note attached to a message. */
export type FileInfo = {
  name: string;
  size: number;
  mime: string;
  kind: 'file' | 'video' | 'audio' | 'voice';
  /** Where it is stored on this phone. */
  path?: string;
  /** Length of a voice note / video / audio, in ms. */
  dur?: number;
  /** Small preview picture (base64 JPEG) for videos. */
  thumb?: string;
  /** All the bytes are here. */
  done?: boolean;
};
// sending -> sent (left this phone) -> delivered (reached their phone, possibly
// through relays) -> seen (they opened the chat).
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'seen' | 'failed';

export type PollData = {
  question: string;
  options: string[];
  /** People can pick more than one answer. */
  multi?: boolean;
  /** Only counts are shown, never who voted for what. */
  anon?: boolean;
  /** Quiz: the index of the one right answer (revealed once you have answered). */
  quiz?: number;
  /** Quiz: a note shown after answering. */
  explain?: string;
  /** Votes stop at this time (ms since 1970). */
  closesAt?: number;
};

/** A quoted message shown above a reply. */
export type ReplyPreview = {name: string; text: string};

export type ChatMessage = {
  id: string;
  conversationId: string; // 'nearby' | peer publicKey | group id
  convKind: ConversationKind;
  type: MessageType;
  from: string; // sender public key, or 'me'
  fromName: string;
  text?: string; // text messages
  image?: string; // base64 (no data: prefix) for image thumbnails
  poll?: PollData; // poll messages
  replyTo?: ReplyPreview; // quoted message this is a reply to
  timestamp: number;
  mine: boolean;
  status?: MessageStatus; // for my own messages (read receipts)
  progress?: number; // 0..1 while a media message is transferring
  /** Relays the message passed through on its way (known once delivered). */
  hops?: number;
  /** Incoming message: we already told the sender we opened it. */
  ackedSeen?: boolean;
  /** Photo bytes are no longer stored on this phone (cleared to save space). */
  mediaGone?: boolean;
  /** Starred by me (kept in the Starred list). */
  starred?: boolean;
  /** The sender changed the text after sending. */
  edited?: boolean;
  /** When the other phone confirmed it arrived / opened it (message info). */
  deliveredAt?: number;
  seenAt?: number;
  /** A group message of mine: for each member, when their phone confirmed it arrived (d) and when they read it (s). */
  acks?: Record<string, {d?: number; s?: number}>;
  /** Photo is hidden (blurred) until the receiver taps it. */
  spoiler?: boolean;
  /** Photo can be opened once, then it is deleted. */
  viewOnce?: boolean;
  /** With viewOnce: the photo also closes by itself this many seconds after it is opened. */
  viewSecs?: number;
  /** A shared person (type 'contact'): their public key and the name they use. */
  contact?: {key: string; name: string};
  /** Photos sent together: the group id, this photo's place in it, and how many there are. */
  album?: {g: string; i: number; n: number};
  /** Text that goes with a photo or file, shown inside the same bubble. */
  caption?: string;
  /** A view-once photo that has been opened (the picture is gone). */
  opened?: boolean;
  /** Disappearing messages: when this message is removed. */
  expiresAt?: number;
  /** File / video / voice note details (type 'file'). */
  file?: FileInfo;
};

/** Reaction on a message. */
export type Reaction = {emoji: string; from: string};
