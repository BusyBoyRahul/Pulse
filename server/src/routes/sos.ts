import {Router} from 'express';
import {z} from 'zod';

import {query, execute} from '../db/connection';
import type {RowDataPacket} from '../db/connection';
import {asyncHandler} from '../middleware/errors';
import twilioService from '../services/twilioService';
import pushService from '../services/pushService';
import {open as openSealed} from '../services/seal';

export const sosRouter = Router();

/**
 * Stateless SOS relay — the offline-first delivery endpoint.
 *
 * Any phone (with or without a Pulse account) that hears an SOS over the mesh
 * and reaches the internet forwards it here. The `payload` is an anonymous
 * sealed box addressed to the server's key; only the server can open it, and it
 * contains everything needed to notify the victim's people — their contacts
 * ride encrypted inside the alert. So the victim never needs an account or a
 * connection of their own.
 *
 * The packet id is the idempotency key: the same alert may be relayed by many
 * phones, but contacts are notified exactly once.
 */
const relaySchema = z.object({
  packetId: z.string().min(8).max(64),
  origin: z.string().min(4).max(64).optional(),
  payload: z.string().min(1),
  originTimestamp: z.number().int().nonnegative().optional(),
});

type SosContact = {name?: string; phone?: string};
type SosPayload = {
  lat?: number;
  lng?: number;
  accuracy?: number;
  name?: string;
  phone?: string;
  note?: string;
  contacts?: SosContact[];
};

function openSosPayload(payload: string): SosPayload | null {
  const json = openSealed(payload) ?? tryPlainBase64(payload);
  if (!json) {
    return null;
  }
  try {
    return JSON.parse(json) as SosPayload;
  } catch {
    return null;
  }
}

function tryPlainBase64(payload: string): string | null {
  try {
    const s = Buffer.from(payload, 'base64').toString('utf8');
    return s.trimStart().startsWith('{') ? s : null;
  } catch {
    return null;
  }
}

sosRouter.post(
  '/relay',
  asyncHandler(async (req, res) => {
    const {packetId, payload, originTimestamp} = relaySchema.parse(req.body);
    const data = openSosPayload(payload);
    if (!data) {
      // Can't open it — ack so the relaying phone stops retrying a dead packet.
      return res.json({ok: true, delivered: false, reason: 'unreadable'});
    }

    // Idempotent insert keyed on the mesh packet id.
    const insert = await execute(
      `INSERT INTO sos_alerts (mesh_packet_id, victim_name, victim_phone, latitude, longitude, accuracy_m, origin_ts, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'sent')
       ON DUPLICATE KEY UPDATE id = id`,
      [
        packetId,
        data.name ?? null,
        data.phone ?? null,
        data.lat ?? null,
        data.lng ?? null,
        data.accuracy ?? null,
        originTimestamp ?? null,
      ],
    );

    if (insert.affectedRows === 0 || insert.insertId === 0) {
      return res.json({ok: true, delivered: true, duplicate: true});
    }
    const alertId = insert.insertId;

    const contacts = (data.contacts ?? []).filter(c => !!c.phone);
    const who = data.name || 'Someone';
    const where =
      data.lat != null && data.lng != null
        ? `https://maps.google.com/?q=${data.lat},${data.lng}`
        : 'location unavailable';
    const back = data.phone ? ` Reach them at ${data.phone}.` : '';
    const smsBody = `PULSE SOS: ${who} triggered an emergency alert. Location: ${where}.${back}${
      data.note ? ` Note: "${data.note}"` : ''
    }`;

    // Fan out SMS to each embedded contact.
    await Promise.all(
      contacts.map(async c => {
        try {
          const sid = await twilioService.sendSms(c.phone as string, smsBody);
          await recordNotification(alertId, c.phone as string, 'sms', 'sent', sid);
        } catch (err) {
          await recordNotification(alertId, c.phone as string, 'sms', 'failed', null, (err as Error).message);
        }
      }),
    );

    // If the victim happens to have a cloud account, also confirm via push.
    if (data.phone) {
      const tokens = await query<RowDataPacket[]>(
        `SELECT dt.token, dt.platform FROM device_tokens dt
         JOIN users u ON u.id = dt.user_id WHERE u.phone_number = ?`,
        [data.phone],
      );
      if (tokens.length > 0) {
        const ok = await pushService.send(
          tokens.map(t => ({token: t.token as string, platform: t.platform as 'android' | 'ios' | 'web'})),
          {
            title: 'SOS relayed',
            body: 'Your emergency alert reached the network and your contacts were notified.',
            data: {type: 'sos-ack', alertId: String(alertId)},
          },
        );
        await recordNotification(alertId, data.phone, 'push', ok ? 'sent' : 'failed');
      }
    }

    await execute("UPDATE sos_alerts SET status = 'delivered', delivered_at = NOW() WHERE id = ?", [
      alertId,
    ]);

    res.json({ok: true, delivered: true, contactsNotified: contacts.length});
  }),
);

/** Mark a false alarm cancelled (best-effort; keyed by packet id). */
sosRouter.post(
  '/cancel',
  asyncHandler(async (req, res) => {
    const {packetId} = z.object({packetId: z.string().min(8)}).parse(req.body);
    await execute("UPDATE sos_alerts SET status = 'cancelled' WHERE mesh_packet_id = ?", [packetId]);
    res.json({ok: true});
  }),
);

async function recordNotification(
  alertId: number,
  target: string,
  channel: 'sms' | 'push',
  status: 'sent' | 'failed',
  providerRef: string | null = null,
  error: string | null = null,
): Promise<void> {
  await execute(
    `INSERT INTO sos_notifications (alert_id, target, channel, status, provider_ref, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [alertId, target, channel, status, providerRef, error],
  );
}

export default sosRouter;
