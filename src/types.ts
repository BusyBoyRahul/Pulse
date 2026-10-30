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
};

/** A group chat you're a member of. */
export type Group = {
  id: string;
  name: string;
  key: string; // shared symmetric key (base64)
  members: string[]; // invited roster (public keys, incl. creator)
  joined: string[]; // members who have ACCEPTED (public keys, incl. creator)
  createdBy: string;
  createdAt: number;
};

/** A pending group invite awaiting the user's accept/decline. */
export type GroupInvite = {
  id: string;
  name: string;
  key: string;
  members: string[];
  byName: string;
  byKey: string;
  at: number;
};

/** A conversation is either the nearby broadcast room, a 1:1, or a group. */
export type ConversationKind = 'nearby' | 'direct' | 'group';

export type MessageType = 'text' | 'image' | 'poll' | 'file';

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

export type PollData = {question: string; options: string[]};

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
  /** Photo is hidden (blurred) until the receiver taps it. */
  spoiler?: boolean;
  /** Photo can be opened once, then it is deleted. */
  viewOnce?: boolean;
  /** A view-once photo that has been opened (the picture is gone). */
  opened?: boolean;
  /** Disappearing messages: when this message is removed. */
  expiresAt?: number;
  /** File / video / voice note details (type 'file'). */
  file?: FileInfo;
};

/** Reaction on a message. */
export type Reaction = {emoji: string; from: string};
