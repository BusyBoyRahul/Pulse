import env from '../env';

/**
 * Push fan-out. Supports FCM (legacy HTTP) or OneSignal, chosen by which
 * credentials are present. Falls back to console logging in dev so the SOS
 * pipeline can be exercised without a push provider.
 */
export type PushTarget = {token: string; platform: 'android' | 'ios' | 'web'};

export type PushMessage = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

async function sendFcm(tokens: string[], msg: PushMessage): Promise<boolean> {
  const res = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      Authorization: `key=${env.push.fcmServerKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      registration_ids: tokens,
      priority: 'high',
      notification: {title: msg.title, body: msg.body},
      data: msg.data ?? {},
    }),
  });
  return res.ok;
}

async function sendOneSignal(tokens: string[], msg: PushMessage): Promise<boolean> {
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${env.push.oneSignalApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_id: env.push.oneSignalAppId,
      include_player_ids: tokens,
      headings: {en: msg.title},
      contents: {en: msg.body},
      data: msg.data ?? {},
    }),
  });
  return res.ok;
}

export const pushService = {
  get live(): boolean {
    return !!env.push.fcmServerKey || (!!env.push.oneSignalAppId && !!env.push.oneSignalApiKey);
  },

  async send(targets: PushTarget[], msg: PushMessage): Promise<boolean> {
    const tokens = targets.map(t => t.token);
    if (tokens.length === 0) {
      return true;
    }
    if (!this.live) {
      console.log(`[push:dev] ${msg.title} — ${msg.body} -> ${tokens.length} device(s)`);
      return true;
    }
    try {
      if (env.push.fcmServerKey) {
        return await sendFcm(tokens, msg);
      }
      return await sendOneSignal(tokens, msg);
    } catch (err) {
      console.error('push send failed:', (err as Error).message);
      return false;
    }
  },
};

export default pushService;
