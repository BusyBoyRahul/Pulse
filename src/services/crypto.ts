import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

/**
 * End-to-end payload encryption for the mesh.
 *
 * `seal` implements an anonymous sealed box: the sender uses a throwaway
 * (ephemeral) keypair, so only the holder of the recipient's secret key can
 * open the message, and the sender leaves no identity in the ciphertext. This
 * is what lets relay phones carry an SOS without being able to read the
 * victim's location.
 *
 * Wire format of a sealed blob: base64(JSON({e, n, c})) where
 *   e = ephemeral public key, n = nonce, c = box ciphertext (all base64).
 *
 * The implementation is pure tweetnacl, so the server opens SOS payloads with
 * byte-for-byte the same code (see server/src/services/seal.ts).
 */

const {box, randomBytes} = nacl;
const {decodeBase64, encodeBase64, decodeUTF8, encodeUTF8} = naclUtil;

type SealedBlob = {e: string; n: string; c: string};

/** Encrypt `message` so only `recipientPublicKey` (base64) can read it. */
export function seal(message: string, recipientPublicKey: string): string {
  const ephemeral = box.keyPair();
  const nonce = randomBytes(box.nonceLength);
  const cipher = box(
    decodeUTF8(message),
    nonce,
    decodeBase64(recipientPublicKey),
    ephemeral.secretKey,
  );
  const blob: SealedBlob = {
    e: encodeBase64(ephemeral.publicKey),
    n: encodeBase64(nonce),
    c: encodeBase64(cipher),
  };
  return encodeBase64(decodeUTF8(JSON.stringify(blob)));
}

/** Decrypt a sealed blob with the recipient's secret key (base64). */
export function open(sealed: string, recipientSecretKey: string): string | null {
  try {
    const blob = JSON.parse(encodeUTF8(decodeBase64(sealed))) as SealedBlob;
    const message = box.open(
      decodeBase64(blob.c),
      decodeBase64(blob.n),
      decodeBase64(blob.e),
      decodeBase64(recipientSecretKey),
    );
    return message ? encodeUTF8(message) : null;
  } catch {
    return null;
  }
}

/** Authenticated box for known-sender directed messages (e.g. 1:1 chat). */
export function boxTo(
  message: string,
  recipientPublicKey: string,
  senderSecretKey: string,
): {cipher: string; nonce: string} {
  const nonce = randomBytes(box.nonceLength);
  const cipher = box(decodeUTF8(message), nonce, decodeBase64(recipientPublicKey), decodeBase64(senderSecretKey));
  return {cipher: encodeBase64(cipher), nonce: encodeBase64(nonce)};
}

export function openBox(
  cipher: string,
  nonce: string,
  senderPublicKey: string,
  recipientSecretKey: string,
): string | null {
  const message = box.open(
    decodeBase64(cipher),
    decodeBase64(nonce),
    decodeBase64(senderPublicKey),
    decodeBase64(recipientSecretKey),
  );
  return message ? encodeUTF8(message) : null;
}

// ---------------------------------------------------------------------------
// Group encryption — symmetric secretbox with a shared group key. Every member
// holds the same key (delivered to them, sealed, in the group invite), so a
// broadcast group message is readable by members and opaque to everyone else.
// ---------------------------------------------------------------------------

const {secretbox} = nacl;

/** Generate a fresh 32-byte group key (base64). */
export function generateGroupKey(): string {
  return encodeBase64(randomBytes(secretbox.keyLength));
}

export function sealGroup(message: string, groupKey: string): {cipher: string; nonce: string} {
  const nonce = randomBytes(secretbox.nonceLength);
  const cipher = secretbox(decodeUTF8(message), nonce, decodeBase64(groupKey));
  return {cipher: encodeBase64(cipher), nonce: encodeBase64(nonce)};
}

export function openGroup(cipher: string, nonce: string, groupKey: string): string | null {
  const message = secretbox.open(decodeBase64(cipher), decodeBase64(nonce), decodeBase64(groupKey));
  return message ? encodeUTF8(message) : null;
}
