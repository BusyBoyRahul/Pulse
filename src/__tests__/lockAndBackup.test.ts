import naclUtil from 'tweetnacl-util';
import {useLockStore} from '@/store/lockStore';
import {usePrefsStore} from '@/store/prefsStore';
import {sealBackup, openBackup, backupFileName} from '@/services/backup';
import {storage, snapshotStorage, restoreStorage} from '@/services/storage';
import {kindOfMime, formatBytes, formatDuration} from '@/services/mediaFiles';

const resetLock = () => useLockStore.setState({saved: {app: null, chat: null}, hydrated: false, appLocked: false, chatsUnlocked: false, bioAvailable: false});

describe('PIN lock', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetLock();
    usePrefsStore.setState({prefs: {}, profiles: {}, labels: [], hydrated: true});
  });
  afterEach(() => jest.useRealTimers());

  it('accepts the right PIN, rejects a wrong one, and never stores the PIN itself', () => {
    const lock = useLockStore.getState();
    expect(lock.hasPin('app')).toBe(false);
    lock.setPin('app', '4417');
    expect(useLockStore.getState().hasPin('app')).toBe(true);
    expect(useLockStore.getState().verify('app', '4417')).toBe('ok');
    expect(useLockStore.getState().verify('app', '1234')).toBe('wrong');
    const saved = useLockStore.getState().saved.app!;
    expect(JSON.stringify(saved)).not.toContain('4417');
    expect(saved.hash.length).toBeGreaterThan(40);
  });

  it('uses a fresh random salt every time a PIN is set', () => {
    const lock = useLockStore.getState();
    lock.setPin('app', '4417');
    const first = useLockStore.getState().saved.app!;
    useLockStore.getState().setPin('app', '4417');
    const second = useLockStore.getState().saved.app!;
    expect(second.salt).not.toBe(first.salt);
    expect(second.hash).not.toBe(first.hash);
  });

  it('five wrong guesses in a row lock you out for 30 seconds, even for the right PIN', () => {
    useLockStore.getState().setPin('app', '4417');
    for (let i = 0; i < 4; i++) {
      expect(useLockStore.getState().verify('app', '0000')).toBe('wrong');
    }
    expect(useLockStore.getState().verify('app', '0000')).toBe('wait');
    expect(useLockStore.getState().verify('app', '4417')).toBe('wait');
    expect(useLockStore.getState().waitSeconds('app')).toBeGreaterThan(0);
    jest.setSystemTime(Date.now() + 31_000);
    expect(useLockStore.getState().waitSeconds('app')).toBe(0);
    expect(useLockStore.getState().verify('app', '4417')).toBe('ok');
  });

  it('keeps the app lock settings when the PIN is changed', () => {
    useLockStore.getState().setPin('app', '4417');
    useLockStore.getState().setAutoLock(5 * 60_000);
    useLockStore.getState().setPin('app', '9902');
    expect(useLockStore.getState().saved.app).toMatchObject({autoLockMs: 5 * 60_000});
    expect(useLockStore.getState().verify('app', '9902')).toBe('ok');
    expect(useLockStore.getState().verify('app', '4417')).toBe('wrong');
  });

  it('the app lock and the chat lock are independent, each with its own PIN', () => {
    // chat lock works with no app lock at all
    useLockStore.getState().setPin('chat', '1111');
    expect(useLockStore.getState().hasPin('app')).toBe(false);
    expect(useLockStore.getState().verify('chat', '1111')).toBe('ok');

    useLockStore.getState().setPin('app', '2222');
    expect(useLockStore.getState().verify('app', '1111')).toBe('wrong');
    expect(useLockStore.getState().verify('chat', '2222')).toBe('wrong');
    expect(useLockStore.getState().verify('chat', '1111')).toBe('ok');

    // wrong guesses on one lock don't count against the other
    for (let i = 0; i < 5; i++) {
      useLockStore.getState().verify('app', '0000');
    }
    expect(useLockStore.getState().waitSeconds('app')).toBeGreaterThan(0);
    expect(useLockStore.getState().waitSeconds('chat')).toBe(0);
    expect(useLockStore.getState().verify('chat', '1111')).toBe('ok');
  });

  it('removing the chat lock moves every locked chat back to the list, and leaves the app lock alone', () => {
    useLockStore.getState().setPin('app', '2222');
    useLockStore.getState().setPin('chat', '1111');
    useLockStore.getState().setHidden(true);
    expect(useLockStore.getState().saved.chat).toMatchObject({hidden: true});
    // changing the code keeps "hidden"
    useLockStore.getState().setPin('chat', '3333');
    expect(useLockStore.getState().saved.chat).toMatchObject({hidden: true});

    usePrefsStore.getState().patchMany(['a', 'b'], {locked: true});
    useLockStore.getState().unlockChats();
    expect(useLockStore.getState().chatsUnlocked).toBe(true);
    useLockStore.getState().removePin('chat');
    expect(useLockStore.getState().hasPin('chat')).toBe(false);
    expect(useLockStore.getState().chatsUnlocked).toBe(false);
    expect(usePrefsStore.getState().prefs.a?.locked).toBeUndefined();
    expect(usePrefsStore.getState().prefs.b?.locked).toBeUndefined();
    expect(useLockStore.getState().hasPin('app')).toBe(true);
  });

  it('matches() checks a code without counting a miss, so searching never locks you out', () => {
    useLockStore.getState().setPin('chat', '4417');
    for (let i = 0; i < 10; i++) {
      expect(useLockStore.getState().matches('chat', '0000')).toBe(false);
    }
    expect(useLockStore.getState().waitSeconds('chat')).toBe(0);
    expect(useLockStore.getState().matches('chat', '4417')).toBe(true);
    expect(useLockStore.getState().matches('app', '4417')).toBe(false); // no app lock set
  });
});

describe('encrypted backup', () => {
  const data = {'mesh.secretKey': 'SECRET-KEY-BYTES', 'chat.history': '{"hello":"world"}', 'profile.name': 'Rahul'};

  it('opens with the right passphrase and gives back exactly what was saved', () => {
    const text = sealBackup('correct horse battery', data);
    expect(text.startsWith('PULSEBAK1:')).toBe(true);
    expect(text).not.toContain('SECRET-KEY-BYTES');
    const r = openBackup(text, 'correct horse battery');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual(data);
      expect(r.at).toBeGreaterThan(0);
    }
  });

  it('refuses a wrong passphrase, a tampered file and a file that is not a backup', () => {
    const text = sealBackup('correct horse battery', data);
    expect(openBackup(text, 'wrong passphrase')).toEqual({ok: false, reason: 'wrong-passphrase'});
    const parts = text.split(':');
    const bytes = naclUtil.decodeBase64(parts[2]);
    bytes[bytes.length - 3] ^= 0xff; // flip some bits near the end
    expect(openBackup(`${parts[0]}:${parts[1]}:${naclUtil.encodeBase64(bytes)}`, 'correct horse battery')).toEqual({ok: false, reason: 'wrong-passphrase'});
    expect(openBackup('just some text', 'x')).toEqual({ok: false, reason: 'bad-file'});
    expect(openBackup('', 'x')).toEqual({ok: false, reason: 'bad-file'});
  });

  it('every backup is different (random salt) and the file name is dated', () => {
    expect(sealBackup('passphrase-1', data)).not.toBe(sealBackup('passphrase-1', data));
    expect(backupFileName()).toMatch(/^Pulse-backup-\d{4}-\d{2}-\d{2}\.pulsebak$/);
  });

  it('restoring replaces what is on the phone', async () => {
    storage.set('old.key', 'old value');
    storage.set('profile.name', 'Somebody else');
    await restoreStorage(data);
    expect(storage.getString('old.key')).toBeUndefined();
    expect(storage.getString('profile.name')).toBe('Rahul');
    expect(snapshotStorage()['mesh.secretKey']).toBe('SECRET-KEY-BYTES');
  });
});

describe('file helpers', () => {
  it('tells videos, audio and other files apart', () => {
    expect(kindOfMime('video/mp4')).toBe('video');
    expect(kindOfMime('audio/mpeg')).toBe('audio');
    expect(kindOfMime('application/pdf')).toBe('file');
    expect(kindOfMime('')).toBe('file');
  });

  it('formats sizes and times for people', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(20 * 1024)).toBe('20 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
    expect(formatDuration(23_000)).toBe('0:23');
    expect(formatDuration(125_000)).toBe('2:05');
    expect(formatDuration(undefined)).toBe('0:00');
  });
});
