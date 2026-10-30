import {Router} from 'express';
import {z} from 'zod';

import {query, execute} from '../db/connection';
import type {RowDataPacket} from '../db/connection';
import {asyncHandler, HttpError} from '../middleware/errors';
import {requireAuth, AuthedRequest} from '../middleware/auth';

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

const MAX_CONTACTS = 5;

const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(100),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid phone number in +country format.'),
});

type ContactRow = RowDataPacket & {
  id: number;
  name: string;
  phone_number: string;
};

const serialize = (r: ContactRow) => ({
  serverId: r.id,
  name: r.name,
  phoneNumber: r.phone_number,
});

/** GET /contacts — the user's trusted circle. */
contactsRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const rows = await query<ContactRow[]>(
      'SELECT id, name, phone_number FROM trusted_contacts WHERE user_id = ? ORDER BY created_at ASC',
      [req.userId],
    );
    res.json({contacts: rows.map(serialize)});
  }),
);

/** POST /contacts — add a contact (max 5, no dupes). */
contactsRouter.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const {name, phoneNumber} = contactSchema.parse(req.body);

    const count = await query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM trusted_contacts WHERE user_id = ?',
      [req.userId],
    );
    if ((count[0]?.n as number) >= MAX_CONTACTS) {
      throw new HttpError(409, `You can add up to ${MAX_CONTACTS} trusted contacts.`);
    }

    try {
      const result = await execute(
        'INSERT INTO trusted_contacts (user_id, name, phone_number) VALUES (?, ?, ?)',
        [req.userId, name, phoneNumber],
      );
      res.status(201).json({contact: {serverId: result.insertId, name, phoneNumber}});
    } catch (err) {
      if ((err as {code?: string}).code === 'ER_DUP_ENTRY') {
        throw new HttpError(409, 'That number is already in your circle.');
      }
      throw err;
    }
  }),
);

/** DELETE /contacts/:id — remove a contact. */
contactsRouter.delete(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw new HttpError(400, 'Invalid contact id.');
    }
    const result = await execute(
      'DELETE FROM trusted_contacts WHERE id = ? AND user_id = ?',
      [id, req.userId],
    );
    if (result.affectedRows === 0) {
      throw new HttpError(404, 'Contact not found.');
    }
    res.json({ok: true});
  }),
);

export default contactsRouter;
