import { Router } from 'express';
import authRoutes from './auth';
import healthRoutes from './health';
import titlesRoutes from './titles';
import watchlistRoutes from './watchlist';
import tmdbRoutes from './tmdb';
import titlesRefreshRouter from './titles.refresh';
import calendarRouter from './calendar';

const v1 = Router();

v1.use('/health', healthRoutes);

v1.use('/auth', authRoutes);
v1.use('/tmdb', tmdbRoutes);
v1.use('/titles', titlesRoutes);
v1.use('/titles', titlesRefreshRouter);
v1.use('/watchlist', watchlistRoutes);
v1.use('/calendar', calendarRouter);

export default v1;