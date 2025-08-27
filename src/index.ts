import express from 'express';
import { env } from './config/env.ts'
import authRoutes from './routes/auth.ts';
import healthRoutes from './routes/health.ts';

const app = express();
app.use(express.json());

// Routes
app.use('/auth', authRoutes);
app.use('/health', healthRoutes);

app.listen(env.PORT, () => {
  console.log(`API listening on :${env.PORT} (${env.NODE_ENV})`);
});

export default app;