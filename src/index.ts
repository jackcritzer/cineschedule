import express from 'express';
import authRoutes from './routes/auth.ts';
import healthRoutes from './routes/health.ts';

const app = express();
app.use(express.json());

// Routes
app.use('/auth', authRoutes);
app.use('/health', healthRoutes);

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
