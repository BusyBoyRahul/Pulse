import {Router} from 'express';
import {z} from 'zod';
import rateLimit from 'express-rate-limit';

import {query, execute} from '../db/connection';
import type {RowDataPacket} from '../db/connection';
import {asyncHandler, HttpError} from '../middleware/errors';
import {requireAuth, signToken, AuthedRequest} from '../middleware/auth';
import twilioService from '../services/twilioService';

export const authRouter = Router();

// E.164-ish: leading + and 8–15 digits.
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid phone number in +country format.');

const otpRequestSchema = z.object({phone: phoneSchema});
const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code you received.'),
  displayName: z.string().trim().max(100).optional(),
  meshPublicKey: z.string().trim().max(64).optional(),
});

// Stricter limiter for the OTP endpoints (SMS costs money / is abusable).
const otpLimiter = rateLimit({windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false});

type UserRow = RowDataPacket & {
  id: number;
  phone_number: string;
  display_name: string | null;
};

/** POST /auth/request-otp — text a verification code. */
authRouter.post(
  '/request-otp',
  otpLimiter,
  asyncHandler(async (req, res) => {
    const {phone} = otpRequestSchema.parse(req.body);

    // Throttle: max 3 requests per phone per 10 minutes.
    const recent = await query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM otp_requests WHERE phone_number = ? AND created_at > (NOW() - INTERVAL 10 MINUTE)',
      [phone],
    );
    if ((recent[0]?.n as number) >= 3) {
      throw new HttpError(429, 'Too many code requests. Try again in a few minutes.');
    }

    await execute('INSERT INTO otp_requests (phone_number, ip) VALUES (?, ?)', [
      phone,
      req.ip ?? null,
    ]);
    await twilioService.sendOtp(phone);

    res.json({ok: true, devMode: !twilioService.live});
  }),
);

/** POST /auth/verify-otp — check code, upsert user, return JWT. */
authRouter.post(
  '/verify-otp',
  otpLimiter,
  asyncHandler(async (req, res) => {
    const {phone, code, displayName, meshPublicKey} = otpVerifySchema.parse(req.body);

    const approved = await twilioService.checkOtp(phone, code);
    if (!approved) {
      throw new HttpError(401, 'That code is incorrect or expired.');
    }

    // Upsert the user by phone number.
    await execute(
      `INSERT INTO users (phone_number, display_name, mesh_public_key)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = COALESCE(VALUES(display_name), display_name),
         mesh_public_key = COALESCE(VALUES(mesh_public_key), mesh_public_key)`,
      [phone, displayName ?? null, meshPublicKey ?? null],
    );

    const rows = await query<UserRow[]>(
      'SELECT id, phone_number, display_name FROM users WHERE phone_number = ?',
      [phone],
    );
    const user = rows[0];
    if (!user) {
      throw new HttpError(500, 'Could not create account.');
    }

    const token = signToken(user.id, user.phone_number);
    res.json({
      token,
      user: {id: user.id, phone: user.phone_number, displayName: user.display_name},
    });
  }),
);

/** GET /auth/me — current user from token. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const rows = await query<UserRow[]>(
      'SELECT id, phone_number, display_name FROM users WHERE id = ?',
      [req.userId],
    );
    const user = rows[0];
    if (!user) {
      throw new HttpError(404, 'Account not found.');
    }
    res.json({id: user.id, phone: user.phone_number, displayName: user.display_name});
  }),
);

/** POST /auth/push-token — register a device for SOS fan-out. */
const pushSchema = z.object({
  token: z.string().trim().min(10).max(512),
  platform: z.enum(['android', 'ios', 'web']),
});
authRouter.post(
  '/push-token',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const {token, platform} = pushSchema.parse(req.body);
    await execute(
      `INSERT INTO device_tokens (user_id, token, platform) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
      [req.userId, token, platform],
    );
    res.json({ok: true});
  }),
);

export default authRouter;
