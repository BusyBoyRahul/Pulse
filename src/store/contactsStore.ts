import {create} from 'zustand';
import {getJSON, setJSON, StorageKeys} from '@/services/storage';
import type {TrustedContact} from '@/types';

// Lightweight id generator (no uuid dep needed for local ids).
function localId(): string {
  return `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

type ContactsState = {
  contacts: TrustedContact[];
  error: string | null;

  hydrate: () => void;
  add: (name: string, phoneNumber: string) => void;
  remove: (contact: TrustedContact) => void;
};

function persist(contacts: TrustedContact[]) {
  setJSON(StorageKeys.trustedContacts, contacts);
}

/**
 * Trusted circle — fully on-device.
 *
 * Contacts live only on this phone; nothing is sent to any server. When you
 * trigger an SOS, these contacts are embedded (encrypted) in the alert itself,
 * so they can be notified without you ever having an account or connection.
 */
export const useContactsStore = create<ContactsState>((set, get) => ({
  contacts: [],
  error: null,

  hydrate: () => {
    set({contacts: getJSON<TrustedContact[]>(StorageKeys.trustedContacts, [])});
  },

  add: (name, phoneNumber) => {
    if (get().contacts.some(c => c.phoneNumber === phoneNumber)) {
      set({error: 'That number is already in your circle.'});
      return;
    }
    const contacts = [...get().contacts, {id: localId(), name, phoneNumber}];
    persist(contacts);
    set({contacts, error: null});
  },

  remove: contact => {
    const contacts = get().contacts.filter(c => c.id !== contact.id);
    persist(contacts);
    set({contacts, error: null});
  },
}));
