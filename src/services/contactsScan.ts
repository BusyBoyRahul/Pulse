import {NativeModules, PermissionsAndroid, Platform} from 'react-native';
import {markExternal} from './appLifecycle';

type NativeContacts = {read(): Promise<{name: string; number: string}[]>};
type NativeScanner = {scan(): Promise<string>};

export type PhoneContact = {name: string; number: string};

/** All contacts that have a phone number, as international numbers. Null if permission is refused. */
export async function readContacts(): Promise<PhoneContact[] | null> {
  const n = NativeModules.PulseContacts as NativeContacts | undefined;
  if (Platform.OS !== 'android' || !n) {
    return null;
  }
  markExternal();
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CONTACTS);
  if (res !== PermissionsAndroid.RESULTS.GRANTED) {
    return null;
  }
  try {
    return await n.read();
  } catch {
    return null;
  }
}

/** Open the QR scanner. Returns the text in the code, or null if cancelled / unavailable. */
export async function scanQr(): Promise<string | null> {
  const n = NativeModules.PulseScanner as NativeScanner | undefined;
  if (Platform.OS !== 'android' || !n) {
    return null;
  }
  markExternal();
  try {
    return await n.scan();
  } catch {
    return null;
  }
}
