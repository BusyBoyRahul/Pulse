import {create} from 'zustand';
import naclUtil from 'tweetnacl-util';
import nacl from 'tweetnacl';
import {getJSON, setJSON} from '@/services/storage';

/**
 * Call history (the Calls tab). Every call — over Bluetooth/Wi-Fi or the internet,
 * voice or video — leaves one line here. Kept encrypted on this phone only.
 */
export type CallOutcome = 'answered' | 'missed' | 'declined' | 'no-answer' | 'busy' | 'failed';

export type CallEntry = {
  id: string;
  peerKey: string;
  name: string;
  direction: 'incoming' | 'outgoing';
  outcome: CallOutcome;
  video: boolean;
  via: 'mesh' | 'internet';
  at: number;
  /** Talking time in ms (answered calls). */
  durationMs: number;
};

const KEY = 'chat.calls'; // "chat." prefix => encrypted at rest
const SEEN_KEY = 'chat.callsSeen';
const MAX = 200;

type State = {
  calls: CallEntry[];
  /** When I last looked at the Calls tab: missed calls after this are "new". */
  seenAt: number;
  hydrated: boolean;

  hydrate: () => void;
  add: (e: Omit<CallEntry, 'id'>) => void;
  remove: (id: string) => void;
  clear: () => void;
  markSeen: () => void;
  /** Missed incoming calls I have not looked at yet. */
  unseenMissed: () => number;
};

const newId = () => naclUtil.encodeBase64(nacl.randomBytes(8)).replace(/[+/=]/g, 'x');

export const useCallLogStore = create<State>((set, get) => ({
  calls: [],
  seenAt: 0,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) {
      return;
    }
    set({calls: getJSON<CallEntry[]>(KEY, []), seenAt: getJSON<number>(SEEN_KEY, 0), hydrated: true});
  },

  add: e => {
    const calls = [{...e, id: newId()}, ...get().calls].slice(0, MAX);
    setJSON(KEY, calls);
    set({calls});
  },

  remove: id => {
    const calls = get().calls.filter(c => c.id !== id);
    setJSON(KEY, calls);
    set({calls});
  },

  clear: () => {
    setJSON(KEY, []);
    set({calls: []});
  },

  markSeen: () => {
    const seenAt = Date.now();
    setJSON(SEEN_KEY, seenAt);
    set({seenAt});
  },

  unseenMissed: () => get().calls.filter(c => c.direction === 'incoming' && c.outcome === 'missed' && c.at > get().seenAt).length,
}));
