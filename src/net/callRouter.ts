
import {navigationRef} from '@/navigation/ref';
import {useCallStore} from '@/store/callStore';
import {usePeersStore} from '@/store/peersStore';
import {useSettingsStore} from '@/store/settingsStore';
import {useNetStore} from './netStore';
import {useInternetCallStore} from './internetCall';
import {alertDialog} from '@/components/Dialog';

/**
 * One "call" button for everything. With the internet available, every call (voice or video, near or far) is a proper
 * internet call: clear sound, and it can ring a phone that has Pulse closed. With no internet, a voice call to someone in
 * Bluetooth/Wi-Fi range uses the offline call. Video always needs the internet.
 */
export function placeCall(peerKey: string, name: string, video = false): void {
  const nearby = usePeersStore.getState().isOnline(peerKey);
  const mode = useSettingsStore.getState().app.internetMode;
  const internetReady = mode !== 'off' && useNetStore.getState().relays > 0;
  if (!video && nearby && !internetReady) {
    void useCallStore.getState().start(peerKey, name);
    return;
  }
  if (mode === 'off') {
    alertDialog('Internet is off', nearby ? 'Video calls need the internet. Turn it on in Settings → Internet.' : `${name} is not nearby. Turn the internet on in Settings → Internet to call them from anywhere.`);
    return;
  }
  if (!internetReady) {
    alertDialog('Not connected yet', 'Pulse is still connecting to the internet. Try again in a moment.');
    return;
  }
  void useInternetCallStore.getState().start(peerKey, name, video);
  if (navigationRef.isReady()) {
    navigationRef.navigate('InternetCall');
  }
}
