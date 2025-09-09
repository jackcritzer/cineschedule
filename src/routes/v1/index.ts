import { Router } from 'express';
import authRoutes from '../../routes/auth';
import healthRoutes from '../../routes/health';
import titlesRoutes from '../../routes/titles';
import watchlistRoutes from '../../routes/watchlist';
import tmdbRoutes from '../../routes/tmdb';
import titlesRefreshRouter from '../../routes/titles.refresh';
import calendarRouter from '../../routes/calendar';

const v1 = Router();

v1.use('/health', healthRoutes);

v1.use('/auth', authRoutes);
v1.use('/tmdb', tmdbRoutes);
v1.use('/titles', titlesRoutes);
v1.use('/titles', titlesRefreshRouter);
v1.use('/watchlist', watchlistRoutes);
v1.use('/calendar', calendarRouter)

export default v1;