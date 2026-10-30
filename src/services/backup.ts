import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {snapshotStorage, restoreStorage} from '@/services/storage';
import {mediaFiles} from '@/services/mediaFiles';

/**
 * Encrypted backup of everything that makes Pulse "yours": your identity key, connections,
 * groups, chats (text), settings and labels. The file is sealed with a key made from a
 * passphrase only the user knows, so it is safe to keep in Downloads or the cloud.
 *
 * Photos, files and voice notes are not included (they can be large) — only the text of
 * chats and everything needed to keep your identity and connections.
 */
const MAGIC = 'PULSEBAK1';
const STRETCH = 20_000;
const PIECE = 384 * 1024; // raw bytes per read/write (a multiple of 3)

function deriveKey(passphrase: string, salt: Uint8Array): Uint8Array {
  let h = nacl.hash(new Uint8Array([...salt, ...naclUtil.decodeUTF8(passphrase)]));
  for (let i = 0; i < STRETCH; i++) {
    h = nacl.hash(h);
  }
  return h.slice(0, 32);
}

/** Make the backup text. */
export function sealBackup(passphrase: string, data: Record<string, string> = snapshotStorage()): string {
  const salt = nacl.randomBytes(16);
  const nonce = nacl.randomBytes(24);
  const plain = naclUtil.decodeUTF8(JSON.stringify({v: 1, at: Date.now(), data}));
  const box = nacl.secretbox(plain, nonce, deriveKey(passphrase, salt));
  const blob = new Uint8Array(nonce.length + box.length);
  blob.set(nonce, 0);
  blob.set(box, nonce.length);
  return `${MAGIC}:${naclUtil.encodeBase64(salt)}:${naclUtil.encodeBase64(blob)}`;
}

export type OpenResult = {ok: true; data: Record<string, string>; at: number} | {ok: false; reason: 'bad-file' | 'wrong-passphrase'};

/** Open backup text with the passphrase (changes nothing on the phone). */
export function openBackup(text: string, passphrase: string): OpenResult {
  const parts = text.trim().split(':');
  if (parts.length !== 3 || parts[0] !== MAGIC) {
    return {ok: false, reason: 'bad-file'};
  }
  try {
    const salt = naclUtil.decodeBase64(parts[1]);
    const blob = naclUtil.decodeBase64(parts[2]);
    const plain = nacl.secretbox.open(blob.slice(24), blob.slice(0, 24), deriveKey(passphrase, salt));
    if (!plain) {
      return {ok: false, reason: 'wrong-passphrase'};
    }
    const parsed = JSON.parse(naclUtil.encodeUTF8(plain)) as {v: number; at: number; data: Record<string, string>};
    if (parsed.v !== 1 || typeof parsed.data !== 'object') {
      return {ok: false, reason: 'bad-file'};
    }
    return {ok: true, data: parsed.data, at: parsed.at};
  } catch {
    return {ok: false, reason: 'bad-file'};
  }
}

export const backupFileName = () => `Pulse-backup-${new Date().toISOString().slice(0, 10)}.pulsebak`;

/** Create the backup and let the user choose where to save it. True if it was saved. */
export async function exportBackup(passphrase: string): Promise<boolean> {
  const dir = await mediaFiles.dir();
  if (!dir) {
    return false;
  }
  const text = sealBackup(passphrase);
  const bytes = naclUtil.decodeUTF8(text);
  const tmp = `${dir}/backup-${Date.now()}.pulsebak`;
  try {
    await mediaFiles.allocate(tmp, bytes.length);
    for (let off = 0; off < bytes.length; off += PIECE) {
      await mediaFiles.writeChunk(tmp, off, naclUtil.encodeBase64(bytes.slice(off, off + PIECE)));
    }
    return await mediaFiles.saveAs(tmp, backupFileName(), 'application/octet-stream');
  } finally {
    void mediaFiles.remove(tmp);
  }
}

/** Read a picked backup file back into text. */
export async function readBackupFile(path: string, size: number): Promise<string> {
  let joined = '';
  for (let off = 0; off < size; off += PIECE) {
    joined += await mediaFiles.readChunk(path, off, PIECE);
  }
  return naclUtil.encodeUTF8(naclUtil.decodeBase64(joined));
}

/** Replace this phone's data with the backup, then restart Pulse. */
export async function applyBackup(data: Record<string, string>): Promise<void> {
  await restoreStorage(data);
  mediaFiles.restart();
}
