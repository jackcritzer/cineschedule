import express from 'express';
import cors from 'cors';
import { env } from './config/env'
import { scheduleNightlyRefresh } from './services/refreshNightly';
import helmet from 'helmet';
import v1 from './routes/v1'
import { requestId } from './middleware/requestId';
import { apiVersion } from './middleware/apiVersion';

const app = express();

//app.get('/v1/health', (_req, res) => res.json({ ok: true, via: 'app.ts' }));

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(requestId());
app.use(apiVersion('v1'));
app.use(cors(/* ... */));

app.use('/v1', v1);

app.use((req, res) => {
  res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Not found', requestId: (req as any).requestId } });
});

app.listen(env.PORT, () => {
  console.log(`API listening on :${env.PORT} (${env.NODE_ENV})`);

  // Start background cron (no-op if CRON_ENABLED != 1)
  scheduleNightlyRefresh();
});

export default app;