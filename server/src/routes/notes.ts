import {Router} from 'express';
import {z} from 'zod';

import {query, execute} from '../db/connection';
import type {RowDataPacket} from '../db/connection';
import {asyncHandler} from '../middleware/errors';
import {requireAuth} from '../middleware/auth';

export const notesRouter = Router();
notesRouter.use(requireAuth);

/**
 * Safety notes are primarily a mesh feature (they propagate device to device),
 * but we also mirror them server-side so a new user arriving in an area can
 * pull recent notes before they ever meet a relay.
 */
const createSchema = z.object({
  meshId: z.string().min(8).max(36),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  message: z.string().trim().min(1).max(280),
  expiresAt: z.number().int().positive(), // epoch ms
});

type NoteRow = RowDataPacket & {
  mesh_id: string;
  latitude: string;
  longitude: string;
  message: string;
  created_at: Date;
  expires_at: Date;
};

const serialize = (r: NoteRow) => ({
  id: r.mesh_id,
  latitude: Number(r.latitude),
  longitude: Number(r.longitude),
  message: r.message,
  createdAt: new Date(r.created_at).getTime(),
  expiresAt: new Date(r.expires_at).getTime(),
});

/** POST /notes — publish/mirror a note (idempotent by mesh id). */
notesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const {meshId, latitude, longitude, message, expiresAt} = createSchema.parse(req.body);
    await execute(
      `INSERT INTO safety_notes (mesh_id, latitude, longitude, message, expires_at)
       VALUES (?, ?, ?, ?, FROM_UNIXTIME(? / 1000))
       ON DUPLICATE KEY UPDATE mesh_id = mesh_id`,
      [meshId, latitude, longitude, message, expiresAt],
    );
    res.status(201).json({ok: true});
  }),
);

/**
 * GET /notes?lat=&lng=&radiusKm= — nearby, unexpired notes.
 * Uses a simple bounding box (fine for a neighbourhood-scale radius).
 */
const nearbySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(0.1).max(50).default(5),
});

notesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const {lat, lng, radiusKm} = nearbySchema.parse(req.query);
    const dLat = radiusKm / 111; // ~111 km per degree latitude
    const dLng = radiusKm / (111 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
    const rows = await query<NoteRow[]>(
      `SELECT mesh_id, latitude, longitude, message, created_at, expires_at
       FROM safety_notes
       WHERE expires_at > NOW()
         AND latitude BETWEEN ? AND ?
         AND longitude BETWEEN ? AND ?
       ORDER BY created_at DESC
       LIMIT 200`,
      [lat - dLat, lat + dLat, lng - dLng, lng + dLng],
    );
    res.json({notes: rows.map(serialize)});
  }),
);

export default notesRouter;
