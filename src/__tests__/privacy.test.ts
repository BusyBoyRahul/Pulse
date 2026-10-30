import naclUtil from 'tweetnacl-util';
import {maskPhone, isValidOptionalPhone, normalizeOptionalPhone} from '@/services/privacy';
import {buildPresencePayload} from '@/store/peersStore';
import {buildSosBroadcast, encodeSosBroadcast} from '@/sos/sosPacket';
import {encodePacket, createPacket} from '@/mesh/relayProtocol';

const MY_NUMBER = '+15551234567';
const CONTACT_NUMBER = '+442071838750';
const decode = (b64: string) => naclUtil.encodeUTF8(naclUtil.decodeBase64(b64));

describe('phone-number privacy', () => {
  it('masks numbers on screen, keeping only the last four digits', () => {
    expect(maskPhone(MY_NUMBER)).toBe('••••• 4567');
    expect(maskPhone(CONTACT_NUMBER)).not.toContain('2071');
    expect(maskPhone('')).toBe('');
    expect(maskPhone('123')).toBe('••••••'); // too short to show any of it
  });

  it('treats the phone number as optional', () => {
    expect(isValidOptionalPhone('')).toBe(true);
    expect(isValidOptionalPhone('+1')).toBe(true); // untouched starter prefix
    expect(isValidOptionalPhone(MY_NUMBER)).toBe(true);
    expect(isValidOptionalPhone('555-1234')).toBe(false);
    expect(normalizeOptionalPhone('+1')).toBe('');
    expect(normalizeOptionalPhone(` ${MY_NUMBER} `)).toBe(MY_NUMBER);
  });

  it('never puts a number in the presence beacon every stranger receives', () => {
    const payload = buildPresencePayload('Alex', 'AAAA');
    const readable = decode(payload);
    expect(JSON.parse(readable)).toEqual({n: 'Alex', a: 'AAAA'}); // name + photo, nothing else
    expect(readable).not.toMatch(/\d{7,}/);
  });

  it('never puts a number in an SOS broadcast (contacts are texted from the SIM instead)', () => {
    const wire = encodeSosBroadcast(
      buildSosBroadcast({latitude: 1.5, longitude: 2.5, accuracy: 9, timestamp: 1}, {name: 'Alex', note: 'help', at: 1}),
    );
    const readable = decode(wire);
    expect(readable).not.toContain(MY_NUMBER);
    expect(readable).not.toContain(CONTACT_NUMBER);
    expect(Object.keys(JSON.parse(readable)).sort()).toEqual(['acc', 'lat', 'lng', 'n', 'note', 't']);
  });

  it('a mesh packet header carries only keys and ids — no number slot exists', () => {
    const p = createPacket({type: 'PRESENCE', origin: 'PUBKEY', payload: buildPresencePayload('Alex')});
    const wire = decode(encodePacket(p));
    expect(wire).not.toMatch(/\+\d{6,}/);
  });
});
