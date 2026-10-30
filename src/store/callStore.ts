import {create} from 'zustand';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {Vibration} from 'react-native';

import type {MeshPacket} from '@/types';
import {getMeshEngine} from '@/mesh/bleManager';
import {newPacketId} from '@/mesh/relayProtocol';
import {getIdentity} from '@/services/identity';
import {boxTo, openBox} from '@/services/crypto';
import {callAudio} from '@/services/callAudio';
import {requestMicrophone} from '@/services/permissions';
import {navigationRef} from '@/navigation/ref';
import {usePairingStore} from './pairingStore';
import {usePeersStore} from './peersStore';
import {usePrefsStore} from './prefsStore';
import {useSettingsStore} from './settingsStore';

/**
 * In-app voice calls over the mesh — no phone numbers, no SIM, no internet.
 *
 * A call is identified by a random id and addressed by public key. Control
 * messages (ring / accept / decline / end / ping) are sealed to the other person
 * like any direct message. Audio frames are AES-GCM encrypted by the native
 * engine with a key only the two callers can derive, and travel as ordinary mesh
 * packets — so relay phones carry a call exactly like a message, which is what
 * lets you ring someone who is only reachable through a friend's phone.
 *
 * Only people you've paired with can ring you.
 */
export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'active' | 'ended';

type Signal =
  | {k: 'ring'; cid: string; name: string}
  | {k: 'acc'; cid: string}
  | {k: 'dec'; cid: string}
  | {k: 'end'; cid: string}
  | {k: 'busy'; cid: string}
  | {k: 'ping'; cid: string};

const RING_TIMEOUT_MS = 45000;
const RING_REPEAT_MS = 4000;
const PING_MS = 4000;
const DEAD_AFTER_MS = 14000;
const ENDED_LINGER_MS = 1800;

type CallState = {
  phase: CallPhase;
  peerKey: string | null;
  peerName: string;
  callId: string | null;
  startedAt: number | null;
  muted: boolean;
  speaker: boolean;
  /** Relays between you and them right now (0 = straight to their phone). */
  hops: number;
  endReason: string | null;
  levelMe: number;
  levelPeer: number;

  init: () => void;
  start: (peerKey: string, peerName: string) => Promise<void>;
  accept: () => Promise<void>;
  decline: () => void;
  hangup: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
};

const initial = {
  phase: 'idle' as CallPhase,
  peerKey: null,
  peerName: '',
  callId: null,
  startedAt: null,
  muted: false,
  speaker: false,
  hops: 0,
  endReason: null,
  levelMe: 0,
  levelPeer: 0,
};

let ringTimer: ReturnType<typeof setInterval> | null = null;
let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;
let lingerTimer: ReturnType<typeof setTimeout> | null = null;
let lastHeardAt = 0;
let offFrame: (() => void) | null = null;
let offLevel: (() => void) | null = null;
let started = false;
const busyReplied = new Set<string>();

// Haptics are a nicety — never let a missing vibrator break call handling.
function buzz(pattern: number[], repeat: boolean) {
  try {
    Vibration.vibrate(pattern, repeat);
  } catch {
    /* no vibrator */
  }
}
function stopBuzz() {
  try {
    Vibration.cancel();
  } catch {
    /* no vibrator */
  }
}

function clearTimers() {
  [ringTimer, pingTimer, watchdog].forEach(t => t && clearInterval(t));
  [timeoutTimer, lingerTimer].forEach(t => t && clearTimeout(t));
  ringTimer = timeoutTimer = pingTimer = watchdog = lingerTimer = null;
}

/** 32-byte call key: only the two parties can derive it (box.before is symmetric). */
export function deriveCallKey(peerPublicKey: string, mySecretKey: string, callId: string): string {
  const shared = nacl.box.before(naclUtil.decodeBase64(peerPublicKey), naclUtil.decodeBase64(mySecretKey));
  const material = new Uint8Array(shared.length + callId.length);
  material.set(shared, 0);
  material.set(naclUtil.decodeUTF8(callId), shared.length);
  return naclUtil.encodeBase64(nacl.hash(material).slice(0, 32));
}

/** Seal a control signal for one person. Exported for tests. */
export function sealSignal(signal: Signal, peerKey: string, mySecret: string) {
  return boxTo(JSON.stringify(signal), peerKey, mySecret);
}

function sendSignal(peerKey: string, signal: Signal) {
  try {
    const me = getIdentity();
    const {cipher, nonce} = sealSignal(signal, peerKey, me.secretKey);
    getMeshEngine()
      .send({type: 'CALL', recipient: peerKey, ttl: 6, payload: cipher, nonce})
      .catch(() => undefined);
  } catch {
    /* unusable peer key: nothing to send to */
  }
}

/** Control messages are tiny and a hop can drop one — say important things 3 times. */
function sendSignalReliably(peerKey: string, signal: Signal) {
  sendSignal(peerKey, signal);
  setTimeout(() => sendSignal(peerKey, signal), 700);
  setTimeout(() => sendSignal(peerKey, signal), 1800);
}

export const useCallStore = create<CallState>((set, get) => {
  /** Tear everything down and show "ended" briefly. */
  const finish = (reason: string, notify: boolean) => {
    const s = get();
    if (s.phase === 'idle' || s.phase === 'ended') {
      return;
    }
    if (notify && s.peerKey && s.callId) {
      sendSignalReliably(s.peerKey, {k: 'end', cid: s.callId});
    }
    clearTimers();
    stopBuzz();
    callAudio.clearIncomingCall();
    void callAudio.stop();
    set({phase: 'ended', endReason: reason, muted: false, levelMe: 0, levelPeer: 0});
    lingerTimer = setTimeout(() => {
      lingerTimer = null;
      // Back to idle. The call screen closes itself when it sees 'idle' — closing
      // it from here as well would pop the chat underneath it too.
      set({...initial});
    }, ENDED_LINGER_MS);
  };

  const beginAudio = async (direction: 0 | 1) => {
    const s = get();
    if (!s.peerKey || !s.callId) {
      return;
    }
    const key = deriveCallKey(s.peerKey, getIdentity().secretKey, s.callId);
    lastHeardAt = Date.now();
    try {
      await callAudio.start(key, direction);
    } catch (e) {
      finish((e as Error).message?.includes('Microphone') ? 'Microphone unavailable' : 'Audio failed', true);
      return;
    }
    const onSpeaker = useSettingsStore.getState().app.callSpeaker;
    if (onSpeaker) {
      callAudio.setSpeaker(true);
    }
    set({phase: 'active', startedAt: Date.now(), endReason: null, speaker: onSpeaker});
    pingTimer = setInterval(() => {
      const cur = get();
      if (cur.peerKey && cur.callId) {
        sendSignal(cur.peerKey, {k: 'ping', cid: cur.callId});
      }
    }, PING_MS);
    watchdog = setInterval(() => {
      if (Date.now() - lastHeardAt > DEAD_AFTER_MS) {
        finish('Connection lost', true);
      }
    }, 2000);
  };

  const onSignal = (packet: MeshPacket) => {
    const me = getIdentity();
    if (!packet.nonce) {
      return;
    }
    const json = openBox(packet.payload, packet.nonce, packet.origin, me.secretKey);
    if (!json) {
      return;
    }
    let sig: Signal;
    try {
      sig = JSON.parse(json) as Signal;
    } catch {
      return;
    }
    const s = get();
    const from = packet.origin;

    if (sig.k === 'ring') {
      // Only people you've paired with can make your phone ring.
      if (!usePairingStore.getState().isPaired(from) || usePrefsStore.getState().isBlocked(from)) {
        return;
      }
      // Calls switched off (for everyone, or for this person): politely decline.
      if (!useSettingsStore.getState().app.allowCalls || !usePrefsStore.getState().callsAllowed(from)) {
        if (!busyReplied.has(sig.cid)) {
          busyReplied.add(sig.cid);
          sendSignalReliably(from, {k: 'dec', cid: sig.cid});
        }
        return;
      }
      if (s.callId === sig.cid) {
        return; // a repeat of the ring we're already showing
      }
      if (s.phase !== 'idle' && s.phase !== 'ended') {
        if (!busyReplied.has(sig.cid)) {
          busyReplied.add(sig.cid);
          sendSignalReliably(from, {k: 'busy', cid: sig.cid});
        }
        return;
      }
      if (lingerTimer) {
        clearTimeout(lingerTimer);
        lingerTimer = null;
      }
      const name = usePairingStore.getState().paired.find(p => p.publicKey === from)?.name || sig.name || 'Someone';
      set({
        ...initial,
        phase: 'incoming',
        peerKey: from,
        peerName: name,
        callId: sig.cid,
        hops: packet.hops ?? 0,
      });
      buzz([0, 700, 500, 700, 500], true);
      callAudio.showIncomingCall(name);
      timeoutTimer = setTimeout(() => {
        // Never answered.
        finish('Missed call', false);
      }, RING_TIMEOUT_MS);
      return;
    }

    // Everything else must belong to the call we're in.
    if (sig.cid !== s.callId || from !== s.peerKey) {
      return;
    }
    lastHeardAt = Date.now();

    switch (sig.k) {
      case 'acc':
        if (s.phase === 'outgoing') {
          clearTimers();
          void beginAudio(0);
        }
        break;
      case 'dec':
        finish('Declined', false);
        break;
      case 'busy':
        finish('Busy on another call', false);
        break;
      case 'end':
        finish(s.phase === 'incoming' ? 'Missed call' : 'Call ended', false);
        break;
      case 'ping':
        set({hops: packet.hops ?? s.hops});
        break;
    }
  };

  return {
    ...initial,

    init: () => {
      if (started) {
        return;
      }
      started = true;
      const engine = getMeshEngine();
      engine.subscribe('CALL', (packet: MeshPacket) => {
        const s = get();
        // Audio frame: "a:<callId>:<base64>"
        if (!packet.nonce && packet.payload.startsWith('a:')) {
          if (s.phase !== 'active' || packet.origin !== s.peerKey) {
            return;
          }
          const sep = packet.payload.indexOf(':', 2);
          if (sep < 0 || packet.payload.slice(2, sep) !== s.callId) {
            return;
          }
          lastHeardAt = Date.now();
          callAudio.playFrame(packet.payload.slice(sep + 1));
          const h = packet.hops ?? 0;
          if (h !== s.hops) {
            set({hops: h});
          }
          return;
        }
        onSignal(packet);
      });

      // Outbound audio from the native engine -> mesh.
      offFrame = callAudio.onFrame(frame => {
        const s = get();
        if (s.phase === 'active' && s.peerKey && s.callId) {
          void engine.send({type: 'CALL', recipient: s.peerKey, ttl: 6, payload: `a:${s.callId}:${frame}`});
        }
      });
      offLevel = callAudio.onLevel((side, level) => {
        set(side === 'me' ? {levelMe: level} : {levelPeer: level});
      });
    },

    start: async (peerKey, peerName) => {
      const s = get();
      if (s.phase !== 'idle' && s.phase !== 'ended') {
        return;
      }
      if (!usePairingStore.getState().isPaired(peerKey) || usePrefsStore.getState().isBlocked(peerKey)) {
        return;
      }
      if (!callAudio.available) {
        set({...initial, phase: 'ended', peerKey, peerName, endReason: 'Calling needs Android'});
        lingerTimer = setTimeout(() => set({...initial}), ENDED_LINGER_MS + 800);
        return;
      }
      if ((await requestMicrophone()) !== 'granted') {
        set({...initial, phase: 'ended', peerKey, peerName, endReason: 'Microphone permission needed'});
        lingerTimer = setTimeout(() => set({...initial}), ENDED_LINGER_MS + 1200);
        return;
      }
      if (lingerTimer) {
        clearTimeout(lingerTimer);
        lingerTimer = null;
      }
      const callId = newPacketId().slice(0, 18);
      const hops = usePeersStore.getState().hopsTo(peerKey) ?? 0;
      set({...initial, phase: 'outgoing', peerKey, peerName, callId, hops});
      const ring = () => sendSignal(peerKey, {k: 'ring', cid: callId, name: ''});
      ring();
      ringTimer = setInterval(ring, RING_REPEAT_MS);
      timeoutTimer = setTimeout(() => finish('No answer', true), RING_TIMEOUT_MS);
      if (navigationRef.isReady()) {
        navigationRef.navigate('Call');
      }
    },

    accept: async () => {
      const s = get();
      if (s.phase !== 'incoming' || !s.peerKey || !s.callId) {
        return;
      }
      stopBuzz();
      callAudio.clearIncomingCall();
      if ((await requestMicrophone()) !== 'granted') {
        finish('Microphone permission needed', true);
        return;
      }
      clearTimers();
      sendSignalReliably(s.peerKey, {k: 'acc', cid: s.callId});
      await beginAudio(1);
    },

    decline: () => {
      const s = get();
      if (s.phase !== 'incoming' || !s.peerKey || !s.callId) {
        return;
      }
      sendSignalReliably(s.peerKey, {k: 'dec', cid: s.callId});
      finish('Declined', false);
    },

    hangup: () => {
      const s = get();
      if (s.phase === 'outgoing') {
        finish('Cancelled', true);
      } else if (s.phase === 'active') {
        finish('Call ended', true);
      } else if (s.phase === 'incoming') {
        get().decline();
      }
    },

    toggleMute: () => {
      const muted = !get().muted;
      callAudio.setMuted(muted);
      set({muted});
    },

    toggleSpeaker: () => {
      const speaker = !get().speaker;
      callAudio.setSpeaker(speaker);
      set({speaker});
    },
  };
});

/** Test hook: forget module-level state between isolated runs. */
export function __resetCallModule() {
  clearTimers();
  started = false;
  offFrame?.();
  offLevel?.();
  offFrame = offLevel = null;
  busyReplied.clear();
}
