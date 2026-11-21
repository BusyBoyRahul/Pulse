import {NativeModules, Platform} from 'react-native';
import {storage, StorageKeys, updateActiveAccount} from '@/services/storage';
import {useSessionStore} from '@/store/sessionStore';

/**
 * If the phone number was confirmed, notice when the SIM card has been changed.
 *
 * Android only tells an app which SIM is in the phone if the app asks for a sensitive "phone" permission, which
 * Pulse deliberately does not hold. What it can see without any permission is a fingerprint (operator, country and
 * the phone's own id for that SIM). When that fingerprint is different from the one saved at confirmation time, a
 * different SIM is in the phone, so the confirmed badge is taken away until the number is chosen again.
 * It cannot tell two SIMs of the same operator apart if the phone reuses an id, so it is a safeguard, not a proof.
 */
type Native = {simSignature(): Promise<string>};
const native = (): Native | undefined => NativeModules.PulseSms as Native | undefined;

async function current(): Promise<string> {
  const n = native();
  if (Platform.OS !== 'android' || !n?.simSignature) {
    return '';
  }
  try {
    return await n.simSignature();
  } catch {
    return '';
  }
}

/** Call right after a number is confirmed: remember which SIM it was. */
export async function rememberSim(): Promise<void> {
  const sig = await current();
  if (sig) {
    storage.set(StorageKeys.simSig, sig);
  }
}

let asking = false;

/** Call when Pulse starts and whenever it comes back to the screen. */
export async function checkSim(): Promise<void> {
  const s = useSessionStore.getState();
  if (!s.phoneVerified || asking) {
    return;
  }
  const sig = await current();
  if (!sig) {
    return; // no SIM ready to read: no verdict
  }
  const saved = storage.getString(StorageKeys.simSig);
  if (!saved) {
    storage.set(StorageKeys.simSig, sig); // confirmed before SIM tracking existed: start from this SIM
    return;
  }
  if (saved === sig) {
    return;
  }
  asking = true;
  storage.delete(StorageKeys.simSig);
  storage.set(StorageKeys.phoneVerified, false);
  updateActiveAccount({phoneVerified: false, phone: undefined});
  useSessionStore.setState({phoneVerified: false});
  // Loaded only when needed, so the stores that record the SIM do not pull the whole interface in with them.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {alertDialog} = require('@/components/Dialog') as typeof import('@/components/Dialog');
  alertDialog('SIM card changed', 'A different SIM card is in this phone, so your number is no longer shown as confirmed. You can choose your number again any time from Edit profile.', [
    {text: 'OK', onPress: () => (asking = false)},
  ]);
}
