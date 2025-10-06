import { Router } from 'express';
import searchRouter from '../v2/search'
import calendarRouter from '../v2/calendar';

const v2 = Router();

// Protect both endpoints (per-user isInWatchlist & per-user calendar)
v2.use("/search", searchRouter);
v2.use("/calendar", calendarRouter);

export default v2;