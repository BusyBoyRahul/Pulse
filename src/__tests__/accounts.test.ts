import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  storage,
  initStorage,
  flushStorage,
  getAccounts,
  activeAccount,
  createAccount,
  setActiveAccount,
  deleteAccount,
  updateActiveAccount,
  saveBlob,
  loadBlob,
  _simulateRelaunch,
} from '@/services/storage';

/** Close and reopen the app. */
async function relaunch() {
  await flushStorage();
  _simulateRelaunch();
  await initStorage();
}

describe('accounts on one phone', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    _simulateRelaunch();
    await initStorage();
  });

  it('starts with one account and keeps what was already saved (no migration)', async () => {
    // A phone that ran an older Pulse already has keys under the plain prefix.
    await AsyncStorage.setItem('pulse:profile.name', 'Old Me');
    await relaunch();
    expect(getAccounts().active).toBe('main');
    expect(storage.getString('profile.name')).toBe('Old Me');
  });

  it('each account has its own data', async () => {
    storage.set('profile.name', 'Alice');
    storage.set('mesh.secretKey', 'alice-secret');
    await relaunch();

    const id = await createAccount();
    await setActiveAccount(id);
    await relaunch();
    expect(getAccounts().active).toBe(id);
    expect(storage.getString('profile.name')).toBeUndefined(); // brand-new, empty
    storage.set('profile.name', 'Work Alice');
    await relaunch();
    expect(storage.getString('profile.name')).toBe('Work Alice');

    await setActiveAccount('main');
    await relaunch();
    expect(storage.getString('profile.name')).toBe('Alice');
    expect(storage.getString('mesh.secretKey')).toBe('alice-secret');
  });

  it('media blobs are separate per account', async () => {
    await saveBlob('img.1', 'main-photo');
    const id = await createAccount();
    await setActiveAccount(id);
    await relaunch();
    expect(await loadBlob('img.1')).toBeNull();
    await saveBlob('img.1', 'other-photo');
    expect(await loadBlob('img.1')).toBe('other-photo');
    await setActiveAccount('main');
    await relaunch();
    expect(await loadBlob('img.1')).toBe('main-photo');
  });

  it('remembers the name and verified badge shown in the switcher', async () => {
    updateActiveAccount({name: 'Alice', phoneVerified: true});
    await relaunch();
    expect(activeAccount().name).toBe('Alice');
    expect(activeAccount().phoneVerified).toBe(true);
  });

  it('deleting an account erases all of its data and nothing else', async () => {
    storage.set('profile.name', 'Keep me');
    const id = await createAccount();
    await setActiveAccount(id);
    await relaunch();
    storage.set('profile.name', 'Delete me');
    await saveBlob('img.9', 'secret');
    await relaunch();

    await setActiveAccount('main');
    await relaunch();
    expect(await deleteAccount(id)).toBe(true);
    expect(getAccounts().accounts.map(a => a.id)).toEqual(['main']);
    const left = (await AsyncStorage.getAllKeys()).filter(k => k.includes(`:${id}:`));
    expect(left).toEqual([]);
    expect(storage.getString('profile.name')).toBe('Keep me');
  });

  it('refuses to delete the account that is in use, or the only account', async () => {
    expect(await deleteAccount('main')).toBe(false);
    const id = await createAccount();
    await setActiveAccount(id);
    await relaunch();
    expect(await deleteAccount(id)).toBe(false);
  });
});
