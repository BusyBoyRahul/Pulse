import {getIdentity} from '@/services/identity';
import {getJSON, setJSON} from '@/services/storage';
import {smsVerify} from '@/services/smsVerify';
import {useSettingsStore} from '@/store/settingsStore';
import {useSessionStore} from '@/store/sessionStore';
import {Directory, isUsername, cleanUsername} from './directory';
import {getInternetTransport} from './internet';
import {NumberCheck} from './numberCheck';
import {useNetStore} from './netStore';

/**
 * The app's public phone book connection: publishes or removes MY records to match
 * the "who can find me" switches, and searches for others. Everything is opt-in;
 * with both switches off nothing about me is published.
 */
let dir: Directory | null = null;
export function directory(): Directory {
  if (!dir) {
    dir = new Directory(getInternetTransport().pool, () => getIdentity());
  }
  return dir;
}

let checker: NumberCheck | null = null;
/** Checks that other people's claimed numbers are real (and answers when someone checks mine). */
export function numberCheck(): NumberCheck {
  if (!checker) {
    checker = new NumberCheck(getInternetTransport().sig, smsVerify.asSmsLike());
  }
  return checker;
}

const STATE_KEY = 'net.dirState'; // what I last published, so a change can remove the old record
const LOST_KEY = 'net.usernameLost'; // a name I had to give up because someone older already owned it
/** `usernameSince` = when I first claimed `username`. It is kept while the name stays the same, so refreshing the record never makes my claim look newer. */
type Published = {username?: string; usernameSince?: number; number?: string};

/** The name I was told to give up (someone older owns it), until I pick a new one. */
export const lostUsername = (): string | null => getJSON<string | null>(LOST_KEY, null);
export const clearLostUsername = (): void => setJSON(LOST_KEY, null);

/**
 * "Oldest claim wins": once my claim is out, check that nobody older holds the same name. If somebody does, I give the
 * name up (my record is removed and the username cleared) and the My code screen tells me to pick another.
 */
export async function verifyUsername(): Promise<void> {
  const st = getJSON<Published>(STATE_KEY, {});
  if (!st.username || !st.usernameSince) {
    return;
  }
  const owner = await directory().ownerOf(st.username, {since: st.usernameSince});
  if (owner && owner.key !== getIdentity().publicKey) {
    directory().removeUsername(st.username);
    setJSON(STATE_KEY, {...st, username: undefined, usernameSince: undefined});
    setJSON(LOST_KEY, st.username);
    useSettingsStore.getState().setApp({username: ''});
  }
}

/** Make the public records match the settings. Safe to call any time; does nothing offline. */
export function syncDirectory(): boolean {
  const app = useSettingsStore.getState().app;
  const session = useSessionStore.getState();
  const d = directory();
  const state = getJSON<Published>(STATE_KEY, {});
  const next: Published = {};
  let ok = true;
  const name = session.profileName || 'Pulse user';

  const wantName = app.findByUsername && isUsername(app.username) ? cleanUsername(app.username) : undefined;
  if (state.username && state.username !== wantName) {
    ok = d.removeUsername(state.username) && ok;
  }
  if (wantName) {
    // Same name as before: keep the original claim time. A new name: the claim starts now.
    const since = state.username === wantName && state.usernameSince ? state.usernameSince : Date.now();
    ok = d.publishUsername(wantName, name, since) && ok;
    next.username = wantName;
    next.usernameSince = since;
  }

  const wantNumber = app.findByNumber && session.phoneVerified && session.phone ? session.phone : undefined;
  if (state.number && state.number !== wantNumber) {
    ok = d.removePhone(state.number) && ok;
  }
  if (wantNumber) {
    ok = d.publishPhone(wantNumber, name) && ok;
    next.number = wantNumber;
  }
  if (ok) {
    setJSON(STATE_KEY, next);
    if (next.username) {
      // Give the relays a moment to pass my claim around, then check nobody older has the same name.
      setTimeout(() => void verifyUsername(), 4000);
    }
  }
  return ok;
}

let started = false;
/** Keep records in sync: when settings change, and once the relays are reachable. */
export function startDirectoryService(): void {
  if (started) {
    return;
  }
  started = true;
  numberCheck().start();
  let last = useSettingsStore.getState().app;
  useSettingsStore.subscribe(s => {
    const a = s.app;
    if (a.findByUsername !== last.findByUsername || a.username !== last.username || a.findByNumber !== last.findByNumber) {
      syncDirectory();
    }
    last = a;
  });
  useNetStore.subscribe((s, prev) => {
    if (s.relays > 0 && prev.relays === 0) {
      syncDirectory();
    }
  });
}
