import express from 'express';
import helmet from 'helmet';
import { env } from './config/env'
import { scheduleNightlyRefresh } from './services/refreshNightly';
import v1Router from './routes/v1';
import { requestId } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { addVersionHeaders } from './middleware/versionHeaders';
import { corsMiddleware } from "./middleware/cors";
//import { logRequest } from './middleware/logRequest';

const app = express();

app.use(corsMiddleware);

app.use(helmet());
app.use(requestId);
app.use(express.json({ limit: '1mb' }));
/* app.use(logRequest) */

app.use('/v1', addVersionHeaders('v1'), v1Router)

// For future version migration

// v1 (kept, but marked deprecated with a future sunset date)
/* app.use(
  	'/v1',
	addVersionHeaders('v1', {
			deprecate: true,
			sunsetGMT: 'Wed, 01 Apr 2026 00:00:00 GMT',
			successor: '/v2',
	}),
  	v1Router
); */

/* // v2 (current)
app.use('/v2', addVersionHeaders('v2'), v2Router); */

app.use(errorHandler);

app.listen(env.PORT, () => {
  	console.log(`API listening on :${env.PORT} (${env.NODE_ENV})`);

  	// Start background cron (no-op if CRON_ENABLED != 1)
  	scheduleNightlyRefresh();
});

export default app;