import {NativeModules, Platform} from 'react-native';
import nacl from 'tweetnacl';

/**
 * Pick your phone number WITHOUT a server, WITHOUT typing, and WITHOUT any SMS permission.
 *
 * Android shows its own popup of the numbers on this phone. The person chooses one; the number
 * comes from the phone, so it can't be typed wrong or made up. Nothing is sent or read, and Pulse
 * holds no text-message permission (the kind Google blocks for apps installed outside the Play Store).
 *
 * Note: this says "chosen from this phone", not a carrier-signed proof. A friend who wants proof of a
 * number can still ask for it in person.
 */
type Native = {phoneHint(): Promise<string>};
const native = (): Native | undefined => NativeModules.PulseSms as Native | undefined;

/** Keep only +, digits. */
export function cleanNumber(n: string): string {
  return n.replace(/[^\d+]/g, '');
}
export const isE164 = (n: string): boolean => /^\+[1-9]\d{7,14}$/.test(cleanNumber(n));

export function newCode(): string {
  const b = nacl.randomBytes(4);
  const n = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, '0');
}
const MARK = 'Pulse code';
export const textFor = (code: string): string => `${MARK} ${code}. This text confirms your number in Pulse — you can ignore it.`;
export function codeIn(body: string): string | null {
  const m = new RegExp(`${MARK}\\s+(\\d{6})`, 'i').exec(body);
  return m ? m[1] : null;
}

export type PickResult = {ok: true; number: string} | {ok: false; reason: 'unavailable' | 'cancelled' | 'none'};

export const smsVerify = {
  /** Android with Google Play services. */
  available(): boolean {
    return Platform.OS === 'android' && !!native();
  },

  /** Show Android's popup of this phone's numbers and return the one chosen. */
  async pick(): Promise<PickResult> {
    const n = native();
    if (Platform.OS !== 'android' || !n) {
      return {ok: false, reason: 'unavailable'};
    }
    try {
      const number = cleanNumber(await n.phoneHint());
      return isE164(number) ? {ok: true, number} : {ok: false, reason: 'none'};
    } catch (e) {
      return {ok: false, reason: (e as {code?: string}).code === 'CANCELLED' ? 'cancelled' : 'none'};
    }
  },

  /**
   * The number-check's text link. Pulse does not send or read texts, so checking a stranger's number
   * by text is off: it reports "unavailable"; people are found by @username, QR code or contacts.
   */
  asSmsLike(): import('@/net/numberCheck').SmsLike {
    return {
      async send() {
        return false;
      },
      listen() {
        return () => undefined;
      },
    };
  },
};

export default smsVerify;
