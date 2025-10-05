import { Router } from 'express';
import authRoutes from '../../routes/auth';
import healthRoutes from '../../routes/health';
import titlesRoutes from '../../routes/titles';
import watchlistRoutes from '../../routes/watchlist';
import tmdbRoutes from '../../routes/tmdb';
import titlesRefreshRouter from '../../routes/titles.refresh';
import calendarRouter from '../../routes/calendar';

const v2 = Router();

v2.use('/health', healthRoutes);

v2.use('/auth', authRoutes);
v2.use('/tmdb', tmdbRoutes);
v2.use('/titles', titlesRoutes);
v2.use('/titles', titlesRefreshRouter);
v2.use('/watchlist', watchlistRoutes);
v2.use('/calendar', calendarRouter)

export default v2;