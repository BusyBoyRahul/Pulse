import {
  getAccounts,
  activeAccount,
  createAccount,
  setActiveAccount,
  deleteAccount,
  flushStorage,
  addOrigin,
  clearAddOrigin,
  AccountMeta,
} from './storage';
import {flushSessions} from './e2ee';
import {mediaFiles} from './mediaFiles';

/**
 * Several accounts on one phone. Each has its own identity, chats, settings and
 * media (see storage.ts). Only the active account is online. Switching saves
 * everything, picks the other account and restarts Pulse into it.
 */
export const accounts = {
  list(): {active: string; accounts: AccountMeta[]} {
    return getAccounts();
  },

  current(): AccountMeta {
    return activeAccount();
  },

  /** Move to another account (the app restarts). */
  async switchTo(id: string): Promise<boolean> {
    if (id === getAccounts().active) {
      return true;
    }
    flushSessions(); // write encryption keys before leaving
    await flushStorage();
    const ok = await setActiveAccount(id);
    if (ok) {
      mediaFiles.restart();
    }
    return ok;
  },

  /** Create a brand-new, empty account and open it (it starts at sign-up). */
  async addNew(): Promise<void> {
    flushSessions();
    await flushStorage();
    const id = await createAccount();
    await setActiveAccount(id);
    mediaFiles.restart();
  },

  /** True while a freshly added account is still being set up and the previous one can be returned to. */
  canCancelAdd(): boolean {
    return !!addOrigin();
  },

  /** Give up on adding an account: the half-made one is erased and the previous account opens again. */
  async cancelAdd(): Promise<boolean> {
    const back = addOrigin();
    const unfinished = getAccounts().active;
    if (!back) {
      return false;
    }
    flushSessions();
    await flushStorage();
    if (!(await setActiveAccount(back))) {
      return false;
    }
    await deleteAccount(unfinished);
    await clearAddOrigin();
    mediaFiles.restart();
    return true;
  },

  /** Erase another account from this phone for good. */
  async remove(id: string): Promise<boolean> {
    return deleteAccount(id);
  },
};

export default accounts;
