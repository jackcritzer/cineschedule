import { Router } from 'express';
import { prisma } from '../db/client.ts';

const router = Router();

// GET /health
router.get('/', async (_req, res) => {
  try {
    // Simple DB connectivity check
    const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW() as now`;
    res.json({ ok: true, db: true, time: now });
  } catch (err) {
    res.status(500).json({ ok: false, db: false, error: (err as Error).message });
  }
});

export default router;