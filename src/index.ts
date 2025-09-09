import express from 'express';
import { env } from './config/env'
import { scheduleNightlyRefresh } from './services/refreshNightly';
import helmet from 'helmet';
import v1 from './routes/v1'
import { requestId } from './middleware/requestId';
import { apiVersion } from './middleware/apiVersion';

const app = express();
app.use(express.json());

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(requestId());
app.use(apiVersion('v1'));

app.use('/v1', v1);

app.listen(env.PORT, () => {
  console.log(`API listening on :${env.PORT} (${env.NODE_ENV})`);

  // Start background cron (no-op if CRON_ENABLED != 1)
  scheduleNightlyRefresh();
});

export default app;