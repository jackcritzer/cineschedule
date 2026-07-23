import express from 'express';
import helmet from 'helmet';
import { env } from './config/env'
import { scheduleNightlyRefresh } from './services/refreshNightly';
import v1Router from './routes/v1';
import v2Router from './routes/v2'
import { requestId } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { addVersionHeaders } from './middleware/versionHeaders';
import { corsMiddleware } from "./middleware/cors";
//import { logRequest } from './middleware/logRequest';
import authRoutes from './routes/v1/auth';
import tmdbRoutes from './routes/v1/tmdb';
import titlesRoutes from './routes/v1/titles';
import titlesRefreshRouter from './routes/v1/titles.refresh';
import watchlistRoutes from './routes/v1/watchlist';
import v2CalendarRouter from "./routes/v2/calendar";
import v2SearchRouter from "./routes/v2/search";

const app = express();

app.use(corsMiddleware);

app.use(helmet());
app.use(requestId);
app.use(express.json({ limit: '1mb' }));
/* app.use(logRequest) */

// v1 (kept, but marked deprecated with a future sunset date)
app.use(
  	'/v1',
	addVersionHeaders('v1', {
			deprecate: true,
			sunsetGMT: 'Fri, 31 Jul 2026 00:00:00 GMT',
			successor: '/v2',
	}),
  	v1Router
);

// v2 (current)
app.use('/v2', addVersionHeaders('v2'), v2Router);


// === LATEST ALIASES (point to newest implementation) ===

app.use('/auth', authRoutes);
app.use('/tmdb', tmdbRoutes);
app.use('/titles', titlesRoutes);
app.use('/titles', titlesRefreshRouter);
app.use('/watchlist', watchlistRoutes);
app.use('/calendar', v2CalendarRouter);
app.use('/search', v2SearchRouter);

// Unversioned auth stays stable across API versions
import authRouter from "./routes/v1/auth";
app.use("/auth", authRouter);

app.use(errorHandler);

app.listen(env.PORT, () => {
  	console.log(`API listening on :${env.PORT} (${env.NODE_ENV})`);

  	// Start background cron (no-op if CRON_ENABLED != 1)
  	scheduleNightlyRefresh();
});

export default app;