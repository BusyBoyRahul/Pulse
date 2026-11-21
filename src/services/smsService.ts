import {Linking, Platform} from 'react-native';
import type {TrustedContact} from '@/types';
import type {Fix} from './locationService';

/**
 * Serverless SOS text: Pulse opens the phone's own messages app with the SOS and your location
 * already written for all your trusted contacts; one tap on Send. SMS works on bare cell signal
 * even when mobile data and Wi-Fi are down.
 *
 * Pulse has no SMS permission (it makes Google Play Protect block apps installed outside the
 * Play Store). The nearby-phone alert still goes out by itself.
 */
export type SosSmsResult = {sent: number; failed: number; supported: boolean; /** contacts the text was prepared for (the person taps Send) */ opened?: number};

function buildMessage(name: string | undefined, fix: Fix | null, note?: string): string {
  const who = name || 'A Pulse user';
  const where =
    fix != null
      ? `Location: https://maps.google.com/?q=${fix.latitude},${fix.longitude}`
      : 'Location unavailable';
  const extra = note ? ` — "${note}"` : '';
  return `SOS from ${who}. I need help.${extra} ${where}`;
}

export const smsService = {
  get supported(): boolean {
    return Platform.OS === 'android';
  },

  /** Open the messages app with the SOS ready for every trusted contact. Never throws. */
  async sendSos(
    contacts: TrustedContact[],
    opts: {name?: string; fix: Fix | null; note?: string},
  ): Promise<SosSmsResult> {
    if (!this.supported || contacts.length === 0) {
      return {sent: 0, failed: 0, supported: this.supported};
    }
    const body = buildMessage(opts.name, opts.fix, opts.note);
    const to = contacts.map(c => c.phoneNumber.replace(/[^\d+]/g, '')).join(',');
    try {
      await Linking.openURL(`sms:${to}?body=${encodeURIComponent(body)}`);
      return {sent: 0, failed: 0, supported: true, opened: contacts.length};
    } catch {
      return {sent: 0, failed: contacts.length, supported: true};
    }
  },
};

export default smsService;
