import {create} from 'zustand';
import {Signaling, randomId} from './signaling';
import type {CallPeer, IceServer, Media, Rtc} from './rtcLinks';

/**
 * Voice and video calls over the internet (WebRTC), encrypted end to end by WebRTC
 * itself. The "ring" travels as an encrypted note through the public relays, then the
 * two phones talk directly. Only people you are connected to can ring you.
 *
 * (Calls with someone nearby and no internet use the existing Bluetooth/Wi-Fi call.)
 */
export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

type State = {
  phase: CallPhase;
  peerKey: string | null;
  name: string;
  video: boolean;
  muted: boolean;
  cameraOff: boolean;
  speaker: boolean;
  startedAt: number | null;
  local: Media | null;
  remote: Media | null;
  /** Why it ended (shown briefly): 'declined', 'no answer', 'busy', 'connection lost', … */
  endedReason: string | null;

  start: (peerKey: string, name: string, video: boolean) => Promise<boolean>;
  accept: () => Promise<void>;
  decline: () => void;
  end: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  flipCamera: () => void;
  toggleSpeaker: () => void;
  reset: () => void;
};

export type CallDeps = {
  sig: Signaling;
  rtc: Rtc;
  me: () => string;
  iceServers: () => IceServer[];
  /** Only connected people may ring me. */
  allow: (peerKey: string) => boolean;
  nameOf: (peerKey: string) => string;
  /** Show the ring (notification, screen). */
  onIncoming?: (peerKey: string, name: string, video: boolean) => void;
  /** The ring stopped (answered elsewhere, cancelled, ended). */
  onRingStop?: () => void;
  /** Route the sound to the loudspeaker or the earpiece. */
  setSpeaker?: (on: boolean) => void;
  /** The phone is set up for call audio (call mode, microphone kept alive) / given back. */
  audioOn?: (speaker: boolean) => void;
  audioOff?: () => void;
};

const RING_MS = 45_000;

let deps: CallDeps | null = null;
let peer: CallPeer | null = null;
let sid = '';
let offerSdp = '';
let ringTimer: ReturnType<typeof setTimeout> | null = null;
let offSignal: (() => void) | null = null;

const idle = {
  phase: 'idle' as CallPhase,
  peerKey: null,
  name: '',
  video: false,
  muted: false,
  cameraOff: false,
  startedAt: null,
  local: null,
  remote: null,
  endedReason: null,
};

export const useInternetCallStore = create<State>((set, get) => {
  /** Tear everything down and show why for a moment. */
  const finish = (reason: string | null, notify = true) => {
    if (ringTimer) {
      clearTimeout(ringTimer);
      ringTimer = null;
    }
    const s = get();
    try {
      peer?.close();
    } catch {
      /* closing */
    }
    peer = null;
    s.local?.stop();
    s.remote?.stop();
    deps?.onRingStop?.();
    deps?.audioOff?.();
    if (s.phase === 'idle') {
      return;
    }
    set({phase: 'ended', endedReason: reason, local: null, remote: null});
    if (notify) {
      setTimeout(() => {
        if (get().phase === 'ended') {
          set({...idle, speaker: get().speaker});
        }
      }, 1800);
    }
  };

  const wirePeer = (p: CallPeer) => {
    p.onRemote(m => set({remote: m}));
    p.onState(st => {
      if (st === 'connected') {
        if (get().phase === 'connecting' || get().phase === 'outgoing') {
          set({phase: 'active', startedAt: Date.now()});
          if (ringTimer) {
            clearTimeout(ringTimer);
            ringTimer = null;
          }
        }
      } else if (get().phase === 'active' || get().phase === 'connecting') {
        finish('connection lost');
      }
    });
  };

  return {
    ...idle,
    speaker: false,

    start: async (peerKey, name, video) => {
      const d = deps;
      if (!d || get().phase !== 'idle' || !d.rtc.createCallPeer || !d.rtc.getMedia) {
        return false;
      }
      set({...idle, phase: 'outgoing', peerKey, name, video, speaker: video, endedReason: null});
      sid = randomId();
      try {
        const local = await d.rtc.getMedia(video);
        if (get().phase !== 'outgoing') {
          local.stop();
          return false;
        }
        set({local});
        d.audioOn?.(video);
        peer = d.rtc.createCallPeer(d.iceServers());
        wirePeer(peer);
        peer.attach(local);
        const sdp = await peer.makeOffer();
        if (get().phase !== 'outgoing') {
          return false;
        }
        if (!d.sig.send(peerKey, {t: 'call-offer', sid, sdp, video})) {
          finish('no internet connection');
          return false;
        }
        ringTimer = setTimeout(() => {
          if (get().phase === 'outgoing') {
            d.sig.send(peerKey, {t: 'call-end', sid});
            finish('no answer');
          }
        }, RING_MS);
        d.setSpeaker?.(video);
        return true;
      } catch (e) {
        finish(e instanceof Error && e.message === 'permission' ? 'microphone not allowed' : 'could not start the call');
        return false;
      }
    },

    accept: async () => {
      const d = deps;
      const key = get().peerKey;
      if (!d || !key || get().phase !== 'incoming' || !d.rtc.createCallPeer || !d.rtc.getMedia) {
        return;
      }
      d.onRingStop?.();
      set({phase: 'connecting'});
      try {
        const local = await d.rtc.getMedia(get().video);
        set({local});
        d.audioOn?.(get().video);
        peer = d.rtc.createCallPeer(d.iceServers());
        wirePeer(peer);
        peer.attach(local);
        const answer = await peer.acceptOffer(offerSdp);
        d.sig.send(key, {t: 'call-answer', sid, sdp: answer});
        d.setSpeaker?.(get().video);
      } catch (e) {
        d.sig.send(key, {t: 'call-end', sid});
        finish(e instanceof Error && e.message === 'permission' ? 'microphone not allowed' : 'could not connect');
      }
    },

    decline: () => {
      const key = get().peerKey;
      if (key && get().phase === 'incoming') {
        deps?.sig.send(key, {t: 'call-decline', sid});
      }
      finish('declined');
    },

    end: () => {
      const key = get().peerKey;
      if (key && get().phase !== 'idle' && get().phase !== 'ended') {
        deps?.sig.send(key, {t: 'call-end', sid});
      }
      finish('ended');
    },

    toggleMute: () => {
      const muted = !get().muted;
      get().local?.setMuted(muted);
      set({muted});
    },
    toggleCamera: () => {
      const cameraOff = !get().cameraOff;
      get().local?.setCamera(!cameraOff);
      set({cameraOff});
    },
    flipCamera: () => get().local?.flipCamera(),
    toggleSpeaker: () => {
      const speaker = !get().speaker;
      deps?.setSpeaker?.(speaker);
      set({speaker});
    },
    reset: () => set({...idle, speaker: false}),
  };
});

function onSignal(from: string, p: Record<string, unknown>) {
  const d = deps;
  if (!d) {
    return;
  }
  const st = useInternetCallStore.getState();
  const id = typeof p.sid === 'string' ? p.sid : '';

  if (p.t === 'call-offer' && typeof p.sdp === 'string') {
    if (!d.allow(from)) {
      return; // strangers cannot ring me
    }
    if (st.phase !== 'idle' && st.phase !== 'ended') {
      d.sig.send(from, {t: 'call-busy', sid: id});
      return;
    }
    sid = id;
    offerSdp = p.sdp;
    const video = p.video === true;
    useInternetCallStore.setState({...idle, phase: 'incoming', peerKey: from, name: d.nameOf(from), video, speaker: video, endedReason: null});
    ringTimer = setTimeout(() => {
      if (useInternetCallStore.getState().phase === 'incoming') {
        useInternetCallStore.getState().decline();
      }
    }, RING_MS);
    d.onIncoming?.(from, d.nameOf(from), video);
    return;
  }

  // Everything else belongs to the call in progress with that person.
  if (from !== st.peerKey || id !== sid) {
    return;
  }
  if (p.t === 'call-answer' && typeof p.sdp === 'string' && st.phase === 'outgoing') {
    useInternetCallStore.setState({phase: 'connecting'});
    void peer?.acceptAnswer(p.sdp).catch(() => useInternetCallStore.getState().end());
  } else if (p.t === 'call-decline' && st.phase === 'outgoing') {
    useInternetCallStore.setState({endedReason: 'declined'});
    teardown('declined');
  } else if (p.t === 'call-busy' && st.phase === 'outgoing') {
    teardown('busy');
  } else if (p.t === 'call-end') {
    teardown(st.phase === 'incoming' ? 'missed' : 'ended');
  }
}

function teardown(reason: string) {
  // The same clean-up as ending locally, without sending anything back.
  const s = useInternetCallStore.getState();
  if (ringTimer) {
    clearTimeout(ringTimer);
    ringTimer = null;
  }
  try {
    peer?.close();
  } catch {
    /* closing */
  }
  peer = null;
  s.local?.stop();
  s.remote?.stop();
  deps?.onRingStop?.();
  deps?.audioOff?.();
  useInternetCallStore.setState({phase: 'ended', endedReason: reason, local: null, remote: null});
  setTimeout(() => {
    if (useInternetCallStore.getState().phase === 'ended') {
      useInternetCallStore.setState({...idle});
    }
  }, 1800);
}

/** Connect the call engine to the relays and WebRTC. Returns a function that disconnects it. */
export function attachInternetCalls(d: CallDeps): () => void {
  deps = d;
  offSignal?.();
  offSignal = d.sig.onSignal(onSignal);
  return () => {
    offSignal?.();
    offSignal = null;
    deps = null;
  };
}
