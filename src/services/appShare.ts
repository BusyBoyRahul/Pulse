import {NativeModules, Platform, Share, ToastAndroid} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

const {AppShare} = NativeModules as {
  AppShare?: {shareApk: (message: string) => Promise<boolean>};
};

const MESSAGE =
  'Pulse — a safety app that works with NO internet. It uses Bluetooth + Wi‑Fi ' +
  'to reach people around you and send an SOS even with no signal. Built by Creoteck.';

/**
 * Share the actual Pulse app file so someone nearby can install it with no
 * internet. Falls back to sharing just the text if the native module isn't
 * available (e.g. dev build or a platform without it).
 */
export async function sharePulseApp(): Promise<void> {
  // Copy the promo text so it's always available to paste as a caption/note —
  // file-only targets (Bluetooth, Nearby Share) carry the app but not the text.
  try {
    Clipboard.setString(MESSAGE);
    if (Platform.OS === 'android') {
      ToastAndroid.show('Message copied — paste it with the app', ToastAndroid.SHORT);
    }
  } catch {
    // clipboard unavailable — not critical
  }
  try {
    if (Platform.OS === 'android' && AppShare?.shareApk) {
      await AppShare.shareApk(MESSAGE);
      return;
    }
  } catch {
    // fall through to text share
  }
  try {
    await Share.share({message: MESSAGE});
  } catch {
    // user cancelled — nothing to do
  }
}
