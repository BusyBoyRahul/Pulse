import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {seal, open, boxTo, openBox} from '../crypto';
import {sealSosPayload, openSosPayload} from '@/sos/sosPacket';

// The dev server sealing keypair (mirrors config.serverPublicKey +
// SERVER_SEAL_SECRET). Regenerated for production.
const SERVER_PUB = 'bIlyAH2kjGQQd/sFW5IcATCEkWvuz37jU5nGqqiIFHc=';
const SERVER_SEC = 'DyhLGtTvcjxr12WwiVBEytxWWCeheMpVYyHXDajELQc=';

describe('crypto — anonymous sealed box', () => {
  it('round-trips a message the intended recipient can read', () => {
    const msg = 'lat=40.7128,lng=-74.0060';
    const sealed = seal(msg, SERVER_PUB);
    expect(sealed).not.toContain(msg); // opaque on the wire
    expect(open(sealed, SERVER_SEC)).toBe(msg);
  });

  it('a relay with the WRONG key cannot open it', () => {
    const attacker = nacl.box.keyPair();
    const sealed = seal('secret location', SERVER_PUB);
    expect(open(sealed, naclUtil.encodeBase64(attacker.secretKey))).toBeNull();
  });

  it('rejects a tampered ciphertext', () => {
    const sealed = seal('help me', SERVER_PUB);
    const raw = JSON.parse(naclUtil.encodeUTF8(naclUtil.decodeBase64(sealed)));
    raw.c = naclUtil.encodeBase64(naclUtil.decodeBase64(raw.c).reverse());
    const tampered = naclUtil.encodeBase64(naclUtil.decodeUTF8(JSON.stringify(raw)));
    expect(open(tampered, SERVER_SEC)).toBeNull();
  });

  it('produces different ciphertext each time (fresh ephemeral key + nonce)', () => {
    const a = seal('same', SERVER_PUB);
    const b = seal('same', SERVER_PUB);
    expect(a).not.toBe(b);
    expect(open(a, SERVER_SEC)).toBe('same');
    expect(open(b, SERVER_SEC)).toBe('same');
  });
});

describe('crypto — SOS payload sealing (app -> server)', () => {
  it('seals a real SOS payload that only the server can open', () => {
    const sealed = sealSosPayload({lat: 51.5074, lng: -0.1278, accuracy: 12, name: '+15550001111'});
    expect(sealed).not.toContain('51.5074');

    const opened = openSosPayload(sealed, SERVER_SEC);
    expect(opened).not.toBeNull();
    expect(opened!.lat).toBeCloseTo(51.5074);
    expect(opened!.lng).toBeCloseTo(-0.1278);
    expect(opened!.name).toBe('+15550001111');
  });
});

describe('crypto — authenticated directed box', () => {
  it('round-trips between a known sender and recipient', () => {
    const sender = nacl.box.keyPair();
    const recipient = nacl.box.keyPair();
    const {cipher, nonce} = boxTo(
      'meet at the north exit',
      naclUtil.encodeBase64(recipient.publicKey),
      naclUtil.encodeBase64(sender.secretKey),
    );
    const plain = openBox(
      cipher,
      nonce,
      naclUtil.encodeBase64(sender.publicKey),
      naclUtil.encodeBase64(recipient.secretKey),
    );
    expect(plain).toBe('meet at the north exit');
  });
});
