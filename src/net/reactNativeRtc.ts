import type {CallPeer, Chan, IceServer, Media, Peer, Rtc} from './rtcLinks';

/**
 * The real WebRTC engine (react-native-webrtc) behind the small `Rtc` interface.
 * Loaded only when first used, so phones/tests that never touch the internet
 * do not pay for it.
 */
const GATHER_MS = 1500; // wait for connection candidates at most this long (it used to be 3.5 s of every new link)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPc = any;

function waitForCandidates(pc: AnyPc): Promise<void> {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener?.('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') {
        done();
      }
    };
    const timer = setTimeout(done, GATHER_MS); // good enough: send what we found
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapChannel(dc: any): Chan {
  const openCbs: Array<() => void> = [];
  const msgCbs: Array<(t: string) => void> = [];
  const closeCbs: Array<() => void> = [];
  dc.addEventListener('open', () => openCbs.forEach(c => c()));
  dc.addEventListener('message', (e: {data: unknown}) => msgCbs.forEach(c => c(String(e.data))));
  dc.addEventListener('close', () => closeCbs.forEach(c => c()));
  return {
    get open() {
      return dc.readyState === 'open';
    },
    send: t => dc.send(t),
    onOpen: cb => void openCbs.push(cb),
    onMessage: cb => void msgCbs.push(cb),
    onClose: cb => void closeCbs.push(cb),
    close: () => dc.close(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapMedia(stream: any): Media {
  const media: Media & {__stream: unknown} = {
    __stream: stream,
    id: stream.id,
    hasVideo: stream.getVideoTracks().length > 0,
    toURL: () => stream.toURL(),
    setMuted: m => stream.getAudioTracks().forEach((t: {enabled: boolean}) => (t.enabled = !m)),
    setCamera: on => stream.getVideoTracks().forEach((t: {enabled: boolean}) => (t.enabled = on)),
    flipCamera: () => stream.getVideoTracks().forEach((t: {_switchCamera?: () => void}) => t._switchCamera?.()),
    stop: () => stream.getTracks().forEach((t: {stop: () => void}) => t.stop()),
  };
  return media;
}

export function createReactNativeRtc(): Rtc {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const webrtc = require('react-native-webrtc');
  return {
    async getMedia(video: boolean): Promise<Media> {
      // Android refuses the microphone/camera until the person has allowed it — ask first.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {requestCallPermissions} = require('@/services/permissions');
      if ((await requestCallPermissions(video)) !== 'granted') {
        throw new Error('permission');
      }
      const stream = await webrtc.mediaDevices.getUserMedia({
        audio: true,
        video: video ? {facingMode: 'user', width: 640, height: 480, frameRate: 24} : false,
      });
      return wrapMedia(stream);
    },
    createCallPeer(iceServers: IceServer[]): CallPeer {
      const pc: AnyPc = new webrtc.RTCPeerConnection({iceServers, iceCandidatePoolSize: 2});
      let stateCb: ((s: 'connected' | 'failed' | 'closed') => void) | null = null;
      let remoteCb: ((m: Media) => void) | null = null;
      pc.addEventListener('connectionstatechange', () => {
        const s = pc.connectionState;
        if (s === 'connected' || s === 'failed' || s === 'closed') {
          stateCb?.(s);
        }
      });
      pc.addEventListener('track', (e: {streams: unknown[]}) => {
        if (e.streams?.[0]) {
          remoteCb?.(wrapMedia(e.streams[0]));
        }
      });
      return {
        attach: local => {
          const raw = (local as Media & {__stream?: AnyPc}).__stream;
          raw?.getTracks().forEach((t: unknown) => pc.addTrack(t, raw));
        },
        onRemote: cb => {
          remoteCb = cb;
        },
        async makeOffer() {
          const offer = await pc.createOffer({offerToReceiveAudio: true, offerToReceiveVideo: true});
          await pc.setLocalDescription(offer);
          await waitForCandidates(pc);
          return JSON.stringify(pc.localDescription);
        },
        async acceptOffer(sdp: string) {
          await pc.setRemoteDescription(new webrtc.RTCSessionDescription(JSON.parse(sdp)));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await waitForCandidates(pc);
          return JSON.stringify(pc.localDescription);
        },
        async acceptAnswer(sdp: string) {
          await pc.setRemoteDescription(new webrtc.RTCSessionDescription(JSON.parse(sdp)));
        },
        onState: cb => {
          stateCb = cb;
        },
        close: () => pc.close(),
      };
    },
    createPeer(iceServers: IceServer[]): Peer {
      const pc: AnyPc = new webrtc.RTCPeerConnection({iceServers, iceCandidatePoolSize: 2});
      let stateCb: ((s: 'connected' | 'failed' | 'closed') => void) | null = null;
      pc.addEventListener('connectionstatechange', () => {
        const s = pc.connectionState;
        if (s === 'connected' || s === 'failed' || s === 'closed') {
          stateCb?.(s);
        }
      });
      return {
        createChannel: () => wrapChannel(pc.createDataChannel('pulse', {ordered: true})),
        onChannel: cb => pc.addEventListener('datachannel', (e: {channel: unknown}) => cb(wrapChannel(e.channel))),
        async makeOffer() {
          const offer = await pc.createOffer({});
          await pc.setLocalDescription(offer);
          await waitForCandidates(pc);
          return JSON.stringify(pc.localDescription);
        },
        async acceptOffer(sdp: string) {
          await pc.setRemoteDescription(new webrtc.RTCSessionDescription(JSON.parse(sdp)));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await waitForCandidates(pc);
          return JSON.stringify(pc.localDescription);
        },
        async acceptAnswer(sdp: string) {
          await pc.setRemoteDescription(new webrtc.RTCSessionDescription(JSON.parse(sdp)));
        },
        onState: cb => {
          stateCb = cb;
        },
        close: () => pc.close(),
      };
    },
  };
}
