import {create} from 'zustand';
import naclUtil from 'tweetnacl-util';
import type {MeshPacket, PairedPeer, PairRequest, Peer} from '@/types';
import {getMeshEngine} from '@/mesh/bleManager';
import {getJSON, setJSON} from '@/services/storage';
import {useSessionStore} from './sessionStore';
import {usePrefsStore} from './prefsStore';
import {useSettingsStore} from './settingsStore';
import {usePeersStore} from './peersStore';
import {getIdentity} from '@/services/identity';
import {e2ee} from '@/services/e2ee';
import {setInternetAllow} from '@/net/internet';

const PAIRED_KEY = 'pairing.paired';

// req/ack: connect handshake. hs1/hs2: set up (or refresh) encryption keys with someone already connected.
// e = an ephemeral public key, r = the key it answers.
type PairPayload = {k: 'req' | 'ack' | 'hs1' | 'hs2'; n: string; e?: string; r?: string};

function encode(p: PairPayload): string {
  return naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(p)));
}
function decode(s: string): PairPayload | null {
  try {
    return JSON.parse(naclUtil.encodeUTF8(naclUtil.decodeBase64(s))) as PairPayload;
  } catch {
    return null;
  }
}

type PairingState = {
  paired: PairedPeer[];
  incoming: PairRequest[];
  outgoing: string[]; // public keys we've requested
  subscribed: boolean;

  init: () => void;
  request: (peer: Peer) => void;
  accept: (req: PairRequest) => void;
  dismiss: (publicKey: string) => void;
  /** Forget a connection (their chat history is cleared separately). */
  remove: (publicKey: string) => void;
  isPaired: (publicKey: string) => boolean;
  statusOf: (publicKey: string) => 'none' | 'incoming' | 'outgoing' | 'paired';
};

const REQ_RETRY_MS = 20000;
const MAX_REQ_RETRIES = 12;
const retryTimers = new Map<string, ReturnType<typeof setInterval>>();

function stopRetry(publicKey: string) {
  const t = retryTimers.get(publicKey);
  if (t) {
    clearInterval(t);
    retryTimers.delete(publicKey);
  }
}

/** Pair handshake packets are addressed to one person and may be relayed. */
function sendPair(recipient: string, k: PairPayload['k'], extra?: {e?: string; r?: string}) {
  void getMeshEngine().send({
    type: 'PAIR',
    recipient,
    ttl: 6,
    payload: encode({k, n: myName(), ...extra}),
  });
}

/** First encrypted message after a handshake: it hands the other phone its sending chain. */
function sendHello(peerKey: string) {
  const wire = e2ee.encrypt(peerKey, JSON.stringify({k: 'hi'}));
  if (wire) {
    void getMeshEngine().send({type: 'CHAT', recipient: peerKey, ttl: 6, payload: wire, nonce: 'dr1'});
  }
}

const lastHandshake = new Map<string, number>();
const HANDSHAKE_GAP_MS = 30000;

/**
 * Make sure there are forward-secret keys with a connected person. Safe to call
 * often: it asks at most once every 30 s, and only when there is no working
 * session (or when forced because a message could not be read).
 */
export function ensureSession(peerKey: string, force = false): void {
  if (!usePairingStore.getState().isPaired(peerKey)) {
    return;
  }
  if (!force && e2ee.hasSession(peerKey)) {
    return;
  }
  const now = Date.now();
  if (now - (lastHandshake.get(peerKey) ?? 0) < HANDSHAKE_GAP_MS) {
    return;
  }
  lastHandshake.set(peerKey, now);
  sendPair(peerKey, 'hs1', {e: e2ee.beginHandshake(peerKey, peerKey)});
}

function myName(): string {
  return useSessionStore.getState().profileName || 'Pulse user';
}

export const usePairingStore = create<PairingState>((set, get) => ({
  paired: [],
  incoming: [],
  outgoing: [],
  subscribed: false,

  init: () => {
    set({paired: getJSON<PairedPeer[]>(PAIRED_KEY, [])});
    setInternetAllow(k => get().paired.some(p => p.publicKey === k) && !usePrefsStore.getState().isBlocked(k));
    if (get().subscribed) {
      return;
    }
    getMeshEngine().subscribe('PAIR', (packet: MeshPacket) => {
      const p = decode(packet.payload);
      if (!p) {
        return;
      }
      const from = packet.origin;
      if (usePrefsStore.getState().isBlocked(from)) {
        return;
      }
      if (p.k === 'hs1' || p.k === 'hs2') {
        if (!get().paired.some(x => x.publicKey === from) || !p.e) {
          return; // only people I'm connected to can (re)key a chat
        }
        if (p.k === 'hs1') {
          // Both of us asked at once: the smaller key's request wins.
          if (e2ee.isPending(from) && getIdentity().publicKey < from) {
            return;
          }
          sendPair(from, 'hs2', {e: e2ee.acceptHandshake(from, from, p.e), r: p.e});
        } else if (p.r && e2ee.completeHandshake(from, p.r, p.e)) {
          sendHello(from);
        }
        return;
      }
      if (p.k === 'req') {
        if (get().paired.some(x => x.publicKey === from)) {
          // They don't know we already accepted (our ack was lost) — say so again.
          sendPair(from, 'ack', p.e ? {e: e2ee.acceptHandshake(from, from, p.e), r: p.e} : undefined);
          return;
        }
        if (!useSettingsStore.getState().app.acceptRequests) {
          return; // not taking new connections right now
        }
        set(state => ({
          incoming: [
            {publicKey: from, name: p.n, at: Date.now(), e: p.e},
            ...state.incoming.filter(r => r.publicKey !== from),
          ],
        }));
      } else if (p.k === 'ack') {
        // Our outgoing request was accepted.
        if (!get().outgoing.includes(from)) {
          // Still accept an ack even if we lost the outgoing marker.
        }
        addPaired(set, get, {publicKey: from, name: p.n, pairedAt: Date.now()});
        if (p.e && p.r && e2ee.completeHandshake(from, p.r, p.e)) {
          sendHello(from);
        }
        stopRetry(from);
        set(state => ({outgoing: state.outgoing.filter(k => k !== from)}));
      }
    });
    // Someone connected has no encryption keys yet (they connected before this
    // update, or a handshake was lost): set them up as soon as they're reachable.
    usePeersStore.subscribe((s, prev) => {
      for (const k of Object.keys(s.peers)) {
        if (!prev.peers[k]) {
          ensureSession(k);
        }
      }
    });
    setTimeout(() => get().paired.forEach(p => ensureSession(p.publicKey)), 4000);
    set({subscribed: true});
  },

  request: (peer: Peer) => {
    sendPair(peer.publicKey, 'req', {e: e2ee.beginHandshake(peer.publicKey, peer.publicKey)});
    set(state => ({outgoing: [...new Set([...state.outgoing, peer.publicKey])]}));
    // A request that crosses a gap in the mesh can get lost — keep asking
    // (politely) until they answer or we give up.
    stopRetry(peer.publicKey);
    let tries = 0;
    retryTimers.set(
      peer.publicKey,
      setInterval(() => {
        tries += 1;
        if (tries > MAX_REQ_RETRIES || !get().outgoing.includes(peer.publicKey)) {
          stopRetry(peer.publicKey);
          return;
        }
        sendPair(peer.publicKey, 'req', {e: e2ee.beginHandshake(peer.publicKey, peer.publicKey)});
      }, REQ_RETRY_MS),
    );
  },

  accept: (req: PairRequest) => {
    sendPair(
      req.publicKey,
      'ack',
      req.e ? {e: e2ee.acceptHandshake(req.publicKey, req.publicKey, req.e), r: req.e} : undefined,
    );
    addPaired(set, get, {publicKey: req.publicKey, name: req.name, pairedAt: Date.now()});
    set(state => ({incoming: state.incoming.filter(r => r.publicKey !== req.publicKey)}));
  },

  dismiss: (publicKey: string) => {
    set(state => ({incoming: state.incoming.filter(r => r.publicKey !== publicKey)}));
  },

  remove: (publicKey: string) => {
    stopRetry(publicKey);
    e2ee.reset(publicKey);
    const paired = get().paired.filter(p => p.publicKey !== publicKey);
    setJSON(PAIRED_KEY, paired);
    set(state => ({
      paired,
      outgoing: state.outgoing.filter(k => k !== publicKey),
      incoming: state.incoming.filter(r => r.publicKey !== publicKey),
    }));
  },

  isPaired: (publicKey: string) => get().paired.some(p => p.publicKey === publicKey),

  statusOf: (publicKey: string) => {
    if (get().paired.some(p => p.publicKey === publicKey)) {
      return 'paired';
    }
    if (get().incoming.some(r => r.publicKey === publicKey)) {
      return 'incoming';
    }
    if (get().outgoing.includes(publicKey)) {
      return 'outgoing';
    }
    return 'none';
  },
}));

function addPaired(
  set: (fn: (s: PairingState) => Partial<PairingState>) => void,
  get: () => PairingState,
  peer: PairedPeer,
) {
  if (get().paired.some(p => p.publicKey === peer.publicKey)) {
    return;
  }
  const paired = [...get().paired, peer];
  setJSON(PAIRED_KEY, paired);
  set(() => ({paired}));
}
