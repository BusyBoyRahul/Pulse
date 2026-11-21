import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {phoneHash, verifyAttestation} from '@/services/attestation';

/** Same steps as server/src/services/attest.ts. */
function serverSign(secret: Uint8Array, phone: string, pk: string): string {
  const payload = naclUtil.decodeUTF8(JSON.stringify({v: 1, h: phoneHash(phone), pk, at: 1234}));
  const sig = nacl.sign.detached(payload, secret);
  return naclUtil.encodeBase64(
    naclUtil.decodeUTF8(JSON.stringify({p: naclUtil.encodeBase64(payload), s: naclUtil.encodeBase64(sig)})),
  );
}

describe('phone-number certificate', () => {
  const server = nacl.sign.keyPair();
  const serverPub = naclUtil.encodeBase64(server.publicKey);
  const me = naclUtil.encodeBase64(nacl.box.keyPair().publicKey);

  it('a real certificate checks out, offline, and says whose number and key it is', () => {
    const cert = serverSign(server.secretKey, '+15551234567', me);
    const v = verifyAttestation(cert, serverPub, me);
    expect(v).not.toBeNull();
    expect(v!.phoneHash).toBe(phoneHash('+15551234567'));
    expect(v!.publicKey).toBe(me);
  });

  it('never contains the phone number itself', () => {
    const cert = serverSign(server.secretKey, '+15551234567', me);
    const text = naclUtil.encodeUTF8(naclUtil.decodeBase64(cert));
    expect(text).not.toContain('5551234567');
    expect(naclUtil.encodeUTF8(naclUtil.decodeBase64(JSON.parse(text).p))).not.toContain('5551234567');
  });

  it('is rejected when signed by anyone but the real server', () => {
    const impostor = nacl.sign.keyPair();
    expect(verifyAttestation(serverSign(impostor.secretKey, '+15551234567', me), serverPub)).toBeNull();
  });

  it('cannot be reused by a different key', () => {
    const other = naclUtil.encodeBase64(nacl.box.keyPair().publicKey);
    const cert = serverSign(server.secretKey, '+15551234567', me);
    expect(verifyAttestation(cert, serverPub, other)).toBeNull();
  });

  it('is rejected if any part is changed', () => {
    const cert = serverSign(server.secretKey, '+15551234567', me);
    const outer = JSON.parse(naclUtil.encodeUTF8(naclUtil.decodeBase64(cert)));
    const payload = JSON.parse(naclUtil.encodeUTF8(naclUtil.decodeBase64(outer.p)));
    payload.h = phoneHash('+15559999999'); // swap in someone else's number
    outer.p = naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(payload)));
    const forged = naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(outer)));
    expect(verifyAttestation(forged, serverPub)).toBeNull();
    expect(verifyAttestation('not a certificate', serverPub)).toBeNull();
  });
});
