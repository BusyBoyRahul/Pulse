import {usePrefsStore} from '@/store/prefsStore';
import {usePairingStore} from '@/store/pairingStore';
import {usePeersStore} from '@/store/peersStore';

/**
 * The name to show for a person — never their ID. In order: the nickname I gave them, the name they use (as a connection, as
 * someone nearby, or from the profile I saved), then the name that came with whatever is happening (a call's own note), and at
 * last "Pulse user". Anything that is only the start of their key counts as no name at all.
 */
export function displayName(key: string, hint?: string): string {
  const own = (s?: string) => {
    const t = (s ?? '').trim();
    return t && key && !key.startsWith(t) ? t : '';
  };
  const prefs = usePrefsStore.getState();
  return (
    own(prefs.prefs[key]?.nickname) ||
    own(usePairingStore.getState().paired.find(p => p.publicKey === key)?.name) ||
    own(prefs.profiles[key]?.name) ||
    own(usePeersStore.getState().peers[key]?.name) ||
    own(hint) ||
    'Pulse user'
  );
}
