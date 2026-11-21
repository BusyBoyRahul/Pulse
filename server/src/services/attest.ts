import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import env from '../env';

/**
 * Phone-number certificate.
 *
 * After a phone passes the SMS check, the server signs a small statement:
 *   "the phone with hash H belongs to the Pulse key PK".
 * The app stores it and shows it to people it talks to; they check the signature
 * with the server's PUBLIC key built into the app. So the server is only needed
 * once, at sign-up — checking the certificate afterwards works with no server and
 * no internet. The server never has to know who is talking to whom.
 *
 * Only a hash of the number is inside (never the number itself).
 */
const {sign, hash} = nacl;
const {encodeBase64, decodeBase64, decodeUTF8} = naclUtil;

/** Same recipe in the app (src/services/attestation.ts). */
export function phoneHash(e164: string): string {
  return encodeBase64(hash(decodeUTF8(`pulse-phone-v1|${e164}`)).slice(0, 32));
}

export function signAttestation(phone: string, meshPublicKey: string): string | null {
  if (!env.attestSecret) {
    return null;
  }
  const payload = decodeUTF8(JSON.stringify({v: 1, h: phoneHash(phone), pk: meshPublicKey, at: Date.now()}));
  const sig = sign.detached(payload, decodeBase64(env.attestSecret));
  return encodeBase64(decodeUTF8(JSON.stringify({p: encodeBase64(payload), s: encodeBase64(sig)})));
}
