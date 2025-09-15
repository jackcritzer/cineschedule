import express from 'express';
import cors from 'cors';
import { env } from './config/env'
import { scheduleNightlyRefresh } from './services/refreshNightly';
import helmet from 'helmet';
import v1 from './routes/v1'
import { requestId } from './middleware/requestId';
import { apiVersion } from './middleware/apiVersion';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(requestId());
app.use(apiVersion('v1'));

const allowedOrigins = [
    'https://app.cineschedule.com',
    /\.vercel\.app$/,            // allow Vercel preview builds
    'http://localhost:3000',
];

app.use(cors({
	origin: (origin, callback) => {
		if (!origin) return callback(null, true);
		if (allowedOrigins.some(o => {
			if (typeof o === 'string') return o === origin;
			return o.test(origin); // regex test
		})) {
			return callback(null, true);
		}
		return callback(new Error(`Origin ${origin} not allowed by CORS`));
	},
	methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
	allowedHeaders: ['Authorization', 'Content-Type'],
	maxAge: 600,
	credentials: false
}));

app.use('/v1', v1);

app.use(errorHandler());

app.listen(env.PORT, () => {
  	console.log(`API listening on :${env.PORT} (${env.NODE_ENV})`);

  	// Start background cron (no-op if CRON_ENABLED != 1)
  	scheduleNightlyRefresh();
});

export default app;