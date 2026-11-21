import {NativeModules, Platform} from 'react-native';
import {smsVerify, isE164, cleanNumber} from '@/services/smsVerify';

describe('phone number chosen from the phone (no typing, no texts, no SMS permission)', () => {
  beforeEach(() => {
    Platform.OS = 'android';
    NativeModules.PulseSms = {phoneHint: jest.fn(async () => '+91 98765 43210')};
  });

  it('knows what a valid number looks like', () => {
    expect(isE164('+1 (555) 123-4567')).toBe(true);
    expect(isE164('5551234567')).toBe(false);
    expect(cleanNumber('+1 (555) 123-4567')).toBe('+15551234567');
  });

  it('returns the number the person picked, cleaned up', async () => {
    expect(await smsVerify.pick()).toEqual({ok: true, number: '+919876543210'});
  });

  it('reports when the popup is closed', async () => {
    (NativeModules.PulseSms.phoneHint as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('closed'), {code: 'CANCELLED'}));
    expect(await smsVerify.pick()).toEqual({ok: false, reason: 'cancelled'});
  });

  it('reports when the phone has no number to offer, or gives something that is not a number', async () => {
    (NativeModules.PulseSms.phoneHint as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('none'), {code: 'HINT_FAILED'}));
    expect(await smsVerify.pick()).toEqual({ok: false, reason: 'none'});
    (NativeModules.PulseSms.phoneHint as jest.Mock).mockResolvedValueOnce('12345');
    expect(await smsVerify.pick()).toEqual({ok: false, reason: 'none'});
  });

  it('is unavailable off Android', async () => {
    Platform.OS = 'ios';
    expect(await smsVerify.pick()).toEqual({ok: false, reason: 'unavailable'});
  });

  it('never sends or reads texts', async () => {
    const like = smsVerify.asSmsLike();
    expect(await like.send('+15551234567', 'x')).toBe(false);
    expect(typeof like.listen(() => undefined, 1000)).toBe('function');
  });
});
