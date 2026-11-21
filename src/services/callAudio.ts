import {NativeEventEmitter, NativeModules} from 'react-native';

type NativeCall = {
  start(keyB64: string, direction: number): Promise<boolean>;
  stop(): Promise<boolean>;
  setMuted(on: boolean): void;
  setSpeaker(on: boolean): void;
  sessionStart(speaker: boolean): void;
  sessionStop(): void;
  playFrame(frameB64: string): void;
  showIncomingCall(name: string, video: boolean): void;
  clearIncomingCall(): void;
  addListener(event: string): void;
  removeListeners(count: number): void;
};

const Native = NativeModules.CallAudio as NativeCall | undefined;

/**
 * Thin typed wrapper over the native call-audio engine (mic capture, encryption,
 * playback). Where the native module isn't present (tests, iOS) calls are
 * reported as unavailable instead of crashing.
 */
export const callAudio = {
  get available(): boolean {
    return !!Native;
  },

  start: (keyB64: string, direction: 0 | 1) => (Native ? Native.start(keyB64, direction) : Promise.reject(new Error('unavailable'))),
  stop: () => (Native ? Native.stop().catch(() => false) : Promise.resolve(false)),
  setMuted: (on: boolean) => Native?.setMuted(on),
  setSpeaker: (on: boolean) => Native?.setSpeaker(on),
  /** An internet call begins / ends: set the phone up for call audio and put it back afterwards. */
  sessionStart: (speaker: boolean) => Native?.sessionStart(speaker),
  sessionStop: () => Native?.sessionStop(),
  playFrame: (frame: string) => Native?.playFrame(frame),
  showIncomingCall: (name: string, video = false) => Native?.showIncomingCall(name, video),
  clearIncomingCall: () => Native?.clearIncomingCall(),

  onFrame(cb: (frame: string) => void): () => void {
    if (!Native) {
      return () => {};
    }
    const sub = new NativeEventEmitter(NativeModules.CallAudio).addListener('CallFrame', (e: {frame: string}) => cb(e.frame));
    return () => sub.remove();
  },

  onLevel(cb: (side: 'me' | 'peer', level: number) => void): () => void {
    if (!Native) {
      return () => {};
    }
    const sub = new NativeEventEmitter(NativeModules.CallAudio).addListener(
      'CallLevel',
      (e: {side: 'me' | 'peer'; level: number}) => cb(e.side, e.level),
    );
    return () => sub.remove();
  },
};

export default callAudio;
