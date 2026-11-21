import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

/**
 * Phone-number certificates (see server/src/services/attest.ts).
 *
 * The server signs "phone hash H belongs to Pulse key PK" once, after the SMS
 * code is confirmed. Anyone can check that statement offline with the server's
 * PUBLIC key — no server, no internet. Only a hash of the number is inside.
 */
const {encodeBase64, decodeBase64, decodeUTF8, encodeUTF8} = naclUtil;

/** Same recipe as the server. `e164` looks like +15551234567. */
export function phoneHash(e164: string): string {
  return encodeBase64(nacl.hash(decodeUTF8(`pulse-phone-v1|${e164}`)).slice(0, 32));
}

export type Verified = {phoneHash: string; publicKey: string; at: number};

/**
 * Check a certificate. Returns what it proves, or null if it is forged, damaged,
 * or about a different key than `expectedPublicKey` (when given).
 */
export function verifyAttestation(attestation: string, serverPublicKey: string, expectedPublicKey?: string): Verified | null {
  try {
    const outer = JSON.parse(encodeUTF8(decodeBase64(attestation))) as {p: string; s: string};
    const payload = decodeBase64(outer.p);
    if (!nacl.sign.detached.verify(payload, decodeBase64(outer.s), decodeBase64(serverPublicKey))) {
      return null;
    }
    const body = JSON.parse(encodeUTF8(payload)) as {v: number; h: string; pk: string; at: number};
    if (body.v !== 1 || typeof body.h !== 'string' || typeof body.pk !== 'string') {
      return null;
    }
    if (expectedPublicKey && body.pk !== expectedPublicKey) {
      return null;
    }
    return {phoneHash: body.h, publicKey: body.pk, at: body.at};
  } catch {
    return null;
  }
}
