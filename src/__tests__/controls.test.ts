import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import {safetyCode} from '@/services/safetyCode';
import {DEFAULT_APP_SETTINGS, inQuietHours} from '@/store/settingsStore';
import {usePrefsStore, muteLabel, MUTE_FOREVER} from '@/store/prefsStore';
import {idFor} from '@/services/notifier';

const key = () => naclUtil.encodeBase64(nacl.box.keyPair().publicKey);

describe('security code', () => {
  it('is the same on both phones and different for a different pair', () => {
    const a = key();
    const b = key();
    const c = key();
    expect(safetyCode(a, b)).toEqual(safetyCode(b, a));
    expect(safetyCode(a, b)).not.toEqual(safetyCode(a, c));
    expect(safetyCode(a, b)).toHaveLength(6);
    safetyCode(a, b).forEach(g => expect(g).toMatch(/^\d{4}$/));
  });
});

describe('quiet hours', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 29, h, m);
  const overnight = {...DEFAULT_APP_SETTINGS, quietOn: true, quietFrom: 22 * 60, quietTo: 7 * 60};

  it('covers a range that crosses midnight', () => {
    expect(inQuietHours(overnight, at(23))).toBe(true);
    expect(inQuietHours(overnight, at(3, 30))).toBe(true);
    expect(inQuietHours(overnight, at(7))).toBe(false);
    expect(inQuietHours(overnight, at(12))).toBe(false);
  });

  it('covers a same-day range and is off by default', () => {
    const lunch = {...DEFAULT_APP_SETTINGS, quietOn: true, quietFrom: 12 * 60, quietTo: 14 * 60};
    expect(inQuietHours(lunch, at(13))).toBe(true);
    expect(inQuietHours(lunch, at(15))).toBe(false);
    expect(inQuietHours(DEFAULT_APP_SETTINGS, at(23))).toBe(false);
  });
});

describe('per-person choices', () => {
  beforeEach(() => usePrefsStore.setState({prefs: {}, profiles: {}, hydrated: true}));

  it('mute expires by itself, "always" never does, unmute clears it', () => {
    const p = usePrefsStore.getState();
    p.mute('x', 1000);
    expect(p.isMuted('x', Date.now() + 500)).toBe(true);
    expect(p.isMuted('x', Date.now() + 5000)).toBe(false);
    p.mute('y', MUTE_FOREVER);
    expect(p.isMuted('y', Date.now() + 1e12)).toBe(true);
    p.mute('y', null);
    expect(usePrefsStore.getState().isMuted('y')).toBe(false);
    expect(muteLabel(usePrefsStore.getState().prefs.y)).toBeNull();
  });

  it('keeps only real choices, and “calls allowed” is the default', () => {
    const p = usePrefsStore.getState();
    p.patch('z', {pinned: true, nickname: ' '});
    expect(usePrefsStore.getState().prefs.z).toEqual({pinned: true, nickname: ' '});
    p.patch('z', {pinned: false, nickname: ''});
    expect(usePrefsStore.getState().prefs.z).toBeUndefined(); // back to defaults: nothing stored
    p.patch('z', {allowCalls: false});
    expect(usePrefsStore.getState().callsAllowed('z')).toBe(false);
    p.patch('z', {allowCalls: true});
    expect(usePrefsStore.getState().callsAllowed('z')).toBe(true);
    expect(usePrefsStore.getState().prefs.z).toBeUndefined();
  });

  it('nickname wins over the real name', () => {
    const p = usePrefsStore.getState();
    expect(p.nameFor('k', 'Jo Chen')).toBe('Jo Chen');
    p.patch('k', {nickname: 'Mum'});
    expect(usePrefsStore.getState().nameFor('k', 'Jo Chen')).toBe('Mum');
  });
});

describe('notification ids', () => {
  it('are stable per conversation and different between conversations', () => {
    expect(idFor('msg:a')).toBe(idFor('msg:a'));
    expect(idFor('msg:a')).not.toBe(idFor('msg:b'));
    expect(idFor('msg:a')).toBeGreaterThanOrEqual(10000);
  });
});
