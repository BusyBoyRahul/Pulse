import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import env from '../env';

/**
 * Server side of the anonymous sealed box (mirror of the app's crypto.ts).
 * Opens SOS payloads that were sealed to the server's public key. If no server
 * secret is configured, or the blob isn't sealed (Phase 3 plaintext), the
 * caller falls back to reading it as base64 JSON.
 */
const {box} = nacl;
const {decodeBase64, encodeUTF8} = naclUtil;

type SealedBlob = {e: string; n: string; c: string};

export function open(sealed: string): string | null {
  if (!env.sealSecret) {
    return null;
  }
  try {
    const blob = JSON.parse(encodeUTF8(decodeBase64(sealed))) as SealedBlob;
    if (!blob.e || !blob.n || !blob.c) {
      return null;
    }
    const message = box.open(
      decodeBase64(blob.c),
      decodeBase64(blob.n),
      decodeBase64(blob.e),
      decodeBase64(env.sealSecret),
    );
    return message ? encodeUTF8(message) : null;
  } catch {
    return null;
  }
}
