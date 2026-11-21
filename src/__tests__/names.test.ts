import {displayName} from '@/services/names';
import {usePrefsStore} from '@/store/prefsStore';
import {usePairingStore} from '@/store/pairingStore';
import {usePeersStore} from '@/store/peersStore';

const KEY = 'Qk9ZZXhhbXBsZUtleUZvckNhbGxOYW1lVGVzdDEyMzQ1Ng';

describe('displayName: the name shown for a person, never their ID', () => {
  beforeEach(() => {
    usePrefsStore.setState({prefs: {}, profiles: {}});
    usePairingStore.setState({paired: []});
    usePeersStore.setState({peers: {}});
  });

  it('is "Pulse user" when nothing is known, and uses the call’s own name only when it is a real name', () => {
    expect(displayName(KEY)).toBe('Pulse user');
    expect(displayName(KEY, 'Rahul')).toBe('Rahul');
    expect(displayName(KEY, KEY.slice(0, 8))).toBe('Pulse user'); // the start of the key is not a name
    expect(displayName(KEY, '   ')).toBe('Pulse user');
  });

  it('prefers what is known on this phone: a saved profile, someone nearby, a connection, then my own nickname', () => {
    usePrefsStore.setState({profiles: {[KEY]: {name: 'From profile'}}});
    expect(displayName(KEY, 'Call note')).toBe('From profile');
    usePeersStore.setState({peers: {[KEY]: {publicKey: KEY, name: 'Nearby name', lastSeen: 1, hops: 0}}});
    expect(displayName(KEY, 'Call note')).toBe('From profile'); // profile (saved earlier) comes before the nearby broadcast
    usePrefsStore.setState({profiles: {}});
    expect(displayName(KEY, 'Call note')).toBe('Nearby name');
    usePairingStore.setState({paired: [{publicKey: KEY, name: 'Connection name', pairedAt: 1}]});
    expect(displayName(KEY, 'Call note')).toBe('Connection name');
    usePrefsStore.setState({prefs: {[KEY]: {nickname: 'My nickname'}}});
    expect(displayName(KEY, 'Call note')).toBe('My nickname');
  });
});
