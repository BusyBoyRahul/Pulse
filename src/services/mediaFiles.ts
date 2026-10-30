import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import {markExternal} from '@/services/appLifecycle';

/**
 * Real files on the phone: pick any file/video, read and write it in pieces,
 * save it somewhere the user can find it, open it in another app, record and play
 * voice notes, fingerprint unlock, restart. Thin typed wrapper over the native
 * MediaFiles module; where that isn't present (tests, iOS) everything reports
 * "unavailable" instead of crashing.
 */
type NativeMedia = {
  filesDir(): Promise<string>;
  allocate(path: string, size: number): Promise<boolean>;
  readChunk(path: string, offset: number, length: number): Promise<string>;
  writeChunk(path: string, offset: number, b64: string): Promise<boolean>;
  fileInfo(path: string): Promise<{exists: boolean; size: number}>;
  deleteFile(path: string): Promise<boolean>;
  copyFile(path: string): Promise<string>;
  usage(): Promise<{count: number; bytes: number}>;
  clearAll(): Promise<boolean>;
  pickFile(mime: string | null, maxBytes: number): Promise<PickedFile>;
  saveAs(path: string, name: string, mime: string | null): Promise<boolean>;
  saveImageToGallery(b64: string, name: string): Promise<boolean>;
  openFile(path: string, mime: string | null): Promise<boolean>;
  mediaInfo(path: string): Promise<{durationMs?: number; thumb?: string}>;
  voiceStart(): Promise<boolean>;
  voiceStop(): Promise<{path: string; durationMs: number; size: number}>;
  voiceCancel(): Promise<boolean>;
  playStart(path: string): Promise<boolean>;
  playStop(): Promise<boolean>;
  biometricAvailable(): Promise<boolean>;
  biometricAuth(title: string): Promise<boolean>;
  restartApp(): void;
  addListener(event: string): void;
  removeListeners(count: number): void;
};

const Native = NativeModules.MediaFiles as NativeMedia | undefined;

/** Bytes per piece. A multiple of 3, so base64 pieces glue together cleanly (12 000 characters each). */
export const CHUNK_BYTES = 9000;
/** Biggest file that can be sent over the mesh. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type PickedFile = {path: string; name: string; size: number; mime: string};
export type FileKind = 'file' | 'video' | 'audio' | 'voice';

export type PickResult = {ok: true; file: PickedFile} | {ok: false; reason: 'cancelled' | 'too-large' | 'error'};

export function kindOfMime(mime: string): FileKind {
  if (mime.startsWith('video/')) {
    return 'video';
  }
  if (mime.startsWith('audio/')) {
    return 'audio';
  }
  return 'file';
}

export function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${Math.round(n / 1024)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatDuration(ms?: number): string {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let dirCache: string | null = null;

export const mediaFiles = {
  get available(): boolean {
    return Platform.OS === 'android' && !!Native;
  },

  async dir(): Promise<string | null> {
    if (!Native) {
      return null;
    }
    if (!dirCache) {
      try {
        dirCache = await Native.filesDir();
      } catch {
        return null;
      }
    }
    return dirCache;
  },

  /** The saved folder (once known) — lets stores build file paths synchronously. */
  dirSync: () => dirCache,

  async pick(mime?: string): Promise<PickResult> {
    if (!Native) {
      return {ok: false, reason: 'error'};
    }
    try {
      markExternal();
      return {ok: true, file: await Native.pickFile(mime ?? null, MAX_FILE_BYTES)};
    } catch (e) {
      const code = (e as {code?: string}).code;
      return {ok: false, reason: code === 'CANCELLED' ? 'cancelled' : code === 'TOO_LARGE' ? 'too-large' : 'error'};
    }
  },

  allocate: (path: string, size: number) => (Native ? Native.allocate(path, size).catch(() => false) : Promise.resolve(false)),
  readChunk: (path: string, offset: number, length: number) => (Native ? Native.readChunk(path, offset, length) : Promise.resolve('')),
  writeChunk: (path: string, offset: number, b64: string) => (Native ? Native.writeChunk(path, offset, b64).catch(() => false) : Promise.resolve(false)),
  info: (path: string) => (Native ? Native.fileInfo(path).catch(() => ({exists: false, size: 0})) : Promise.resolve({exists: false, size: 0})),
  copy: (path: string): Promise<string | null> => (Native ? Native.copyFile(path).catch(() => null) : Promise.resolve(null)),
  remove: (path: string) => (Native ? Native.deleteFile(path).catch(() => false) : Promise.resolve(false)),
  usage: () => (Native ? Native.usage().catch(() => ({count: 0, bytes: 0})) : Promise.resolve({count: 0, bytes: 0})),
  clearAll: () => (Native ? Native.clearAll().catch(() => false) : Promise.resolve(false)),
  mediaInfo: (path: string): Promise<{durationMs?: number; thumb?: string}> =>
    Native ? Native.mediaInfo(path).catch(() => ({} as {durationMs?: number; thumb?: string})) : Promise.resolve({}),

  /** Save a file where the user can find it (Android's own "save as" screen). */
  saveAs: (path: string, name: string, mime: string) => {
    markExternal();
    return Native ? Native.saveAs(path, name, mime).catch(() => false) : Promise.resolve(false);
  },

  /** Save a photo to the gallery. Older phones fall back to the "save as" screen. */
  async saveImage(b64: string, name: string): Promise<boolean> {
    if (!Native) {
      return false;
    }
    try {
      if (await Native.saveImageToGallery(b64, name)) {
        return true;
      }
      const dir = await mediaFiles.dir();
      if (!dir) {
        return false;
      }
      const tmp = `${dir}/save-${Date.now()}.jpg`;
      await Native.writeChunk(tmp, 0, b64);
      const ok = await Native.saveAs(tmp, name, 'image/jpeg');
      void Native.deleteFile(tmp);
      return ok;
    } catch {
      return false;
    }
  },

  /** Open in another app. Resolves to an error code ('NO_APP', 'NO_FILE') or null on success. */
  async open(path: string, mime: string): Promise<string | null> {
    if (!Native) {
      return 'NO_APP';
    }
    try {
      markExternal();
      await Native.openFile(path, mime);
      return null;
    } catch (e) {
      return (e as {code?: string}).code ?? 'ERROR';
    }
  },

  voice: {
    start: () => (Native ? Native.voiceStart() : Promise.reject(new Error('unavailable'))),
    stop: () => (Native ? Native.voiceStop() : Promise.reject(new Error('unavailable'))),
    cancel: () => (Native ? Native.voiceCancel().catch(() => false) : Promise.resolve(false)),
  },

  play: {
    start: (path: string) => (Native ? Native.playStart(path).catch(() => false) : Promise.resolve(false)),
    stop: () => (Native ? Native.playStop().catch(() => false) : Promise.resolve(false)),
  },

  /** Progress of the voice note being played: {path, state, pos, dur}. */
  onPlayer(cb: (e: {path: string; state: 'playing' | 'done' | 'stopped' | 'error'; pos: number; dur: number}) => void): () => void {
    if (!Native) {
      return () => {};
    }
    const sub = new NativeEventEmitter(NativeModules.MediaFiles).addListener('PlayerState', cb);
    return () => sub.remove();
  },

  biometricAvailable: () => (Native ? Native.biometricAvailable().catch(() => false) : Promise.resolve(false)),
  biometricAuth: (title: string) => {
    markExternal();
    return Native ? Native.biometricAuth(title).catch(() => false) : Promise.resolve(false);
  },

  restart: () => Native?.restartApp(),
};

export default mediaFiles;
