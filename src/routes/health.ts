import { Router } from 'express';
import { prisma } from '../db/client';

const router = Router();

// GET /health
router.get('/', async (_req, res) => {
  try {
    // Simple DB connectivity check
    const rows = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW() as now`;
    if (rows.length === 0 || !rows[0]?.now) {
      throw new Error('NOW() query returned no rows');
    }
    const now = rows[0].now; 
    res.json({ ok: true, db: true, time: now });
  } catch (err) {
    res.status(500).json({ ok: false, db: false, error: (err as Error).message });
  }
});

export default router;