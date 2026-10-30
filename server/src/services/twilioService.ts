import twilio, {Twilio} from 'twilio';
import env from '../env';

/**
 * Twilio wrapper for phone verification (OTP) and SMS fallback.
 *
 * In dev (OTP_DEV_MODE=true, or missing credentials) it short-circuits:
 * any OTP request "succeeds" and the code `000000` verifies. This lets the
 * whole auth flow be exercised end-to-end without a Twilio account.
 */
class TwilioService {
  private client: Twilio | null = null;

  constructor() {
    if (env.twilio.accountSid && env.twilio.authToken) {
      this.client = twilio(env.twilio.accountSid, env.twilio.authToken);
    }
  }

  get live(): boolean {
    return !!this.client && !env.otpDevMode && !!env.twilio.verifyServiceSid;
  }

  async sendOtp(phone: string): Promise<void> {
    if (!this.live) {
      console.log(`[otp:dev] code for ${phone} is 000000`);
      return;
    }
    await this.client!.verify.v2
      .services(env.twilio.verifyServiceSid)
      .verifications.create({to: phone, channel: 'sms'});
  }

  async checkOtp(phone: string, code: string): Promise<boolean> {
    if (!this.live) {
      return code === '000000';
    }
    const result = await this.client!.verify.v2
      .services(env.twilio.verifyServiceSid)
      .verificationChecks.create({to: phone, code});
    return result.status === 'approved';
  }

  async sendSms(to: string, body: string): Promise<string | null> {
    if (!this.client || !env.twilio.messagingFrom) {
      console.log(`[sms:dev] to ${to}: ${body}`);
      return null;
    }
    const msg = await this.client.messages.create({
      to,
      from: env.twilio.messagingFrom,
      body,
    });
    return msg.sid;
  }
}

export const twilioService = new TwilioService();
export default twilioService;
