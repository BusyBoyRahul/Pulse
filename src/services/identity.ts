import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {storage, StorageKeys} from './storage';

/**
 * The device's cryptographic identity for the mesh.
 *
 * A Curve25519 box keypair, generated once and persisted. The public key is
 * this node's short id on the network and is uploaded at sign-in so the server
 * can address sealed messages. Private key never leaves the device.
 *
 * Full sealing/opening of payloads lives in Phase 5 (crypto.ts); this module
 * just owns the long-lived identity so it's stable from Phase 1 onward.
 */
export type Identity = {
  publicKey: string; // base64
  secretKey: string; // base64
};

function generate(): Identity {
  const pair = nacl.box.keyPair();
  return {
    publicKey: naclUtil.encodeBase64(pair.publicKey),
    secretKey: naclUtil.encodeBase64(pair.secretKey),
  };
}

let cached: Identity | null = null;

/** Return the persisted identity, creating it on first call. */
export function getIdentity(): Identity {
  if (cached) {
    return cached;
  }
  const publicKey = storage.getString(StorageKeys.meshPublicKey);
  const secretKey = storage.getString(StorageKeys.meshSecretKey);
  if (publicKey && secretKey) {
    cached = {publicKey, secretKey};
    return cached;
  }
  const fresh = generate();
  storage.set(StorageKeys.meshPublicKey, fresh.publicKey);
  storage.set(StorageKeys.meshSecretKey, fresh.secretKey);
  cached = fresh;
  return fresh;
}

/** Short, human-displayable form of a public key (first 8 chars). */
export function shortId(publicKey: string): string {
  return publicKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
}
