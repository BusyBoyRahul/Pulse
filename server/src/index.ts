import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import env from './env';
import {ping} from './db/connection';
import {errorHandler} from './middleware/errors';
import {authRouter} from './routes/auth';
import {contactsRouter} from './routes/contacts';
import {sosRouter} from './routes/sos';
import {notesRouter} from './routes/notes';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
  }),
);
app.use(express.json({limit: '256kb'}));

// Global soft rate limit; auth + sos add stricter limits of their own.
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get('/health', async (_req, res) => {
  const db = await ping();
  res.status(db ? 200 : 503).json({ok: db, service: 'pulse-server', db});
});

app.use('/auth', authRouter);
app.use('/contacts', contactsRouter);
app.use('/sos', sosRouter);
app.use('/notes', notesRouter);

app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`Pulse server listening on :${env.port} (${env.nodeEnv})`);
});
