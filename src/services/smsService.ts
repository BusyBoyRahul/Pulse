import {Platform} from 'react-native';
import {SendDirectSms} from 'react-native-send-direct-sms';
import type {TrustedContact} from '@/types';
import type {Fix} from './locationService';

/**
 * Free, server-less SOS delivery: text the user's trusted contacts directly
 * from THIS phone's SIM.
 *
 * Why this matters: SMS rides the cellular control channel, so it works on bare
 * cell signal even when mobile data / Wi-Fi are down — exactly the "no
 * internet" situation Pulse is built for. No Twilio, no backend, no cost beyond
 * the user's normal SMS plan.
 *
 * (Android only — iOS forbids apps from sending SMS silently. On iOS the mesh
 * remains the delivery path, plus the optional cloud relay.)
 */
export type SosSmsResult = {sent: number; failed: number; supported: boolean};

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

  /** Text every trusted contact directly from this device. Never throws. */
  async sendSos(
    contacts: TrustedContact[],
    opts: {name?: string; fix: Fix | null; note?: string},
  ): Promise<SosSmsResult> {
    if (!this.supported || contacts.length === 0) {
      return {sent: 0, failed: 0, supported: this.supported};
    }
    const body = buildMessage(opts.name, opts.fix, opts.note);
    let sent = 0;
    let failed = 0;
    for (const c of contacts) {
      try {
        await SendDirectSms(c.phoneNumber, body);
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    return {sent, failed, supported: true};
  },
};

export default smsService;
