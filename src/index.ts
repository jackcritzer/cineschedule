import express from 'express';
import { env } from './config/env'
import authRoutes from './routes/auth';
import healthRoutes from './routes/health';
import titlesRoutes from './routes/titles';
import watchlistRoutes from './routes/watchlist';
import tmdbRoutes from './routes/tmdb';

const app = express();
app.use(express.json());

// Routes
app.use('/auth', authRoutes);
app.use('/health', healthRoutes);

app.use('/titles', titlesRoutes);
app.use('/watchlist', watchlistRoutes);
app.use('/tmdb', tmdbRoutes);

app.listen(env.PORT, () => {
  console.log(`API listening on :${env.PORT} (${env.NODE_ENV})`);
});

export default app;