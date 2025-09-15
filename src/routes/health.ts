import { Router } from 'express';

import { prisma } from '../db/client';
import { ApiError } from '../errors';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

/** @route GET /v1/health
 *  @summary Liveness + DB connectivity check
 *  @returns 200 { ok: boolean, db: boolean, time: string(ISO) }
 *  @errors 500 INTERNAL_ERROR
 */
router.get(
  	'/', 
  	asyncHandler(async (_req, res) => {
		// Simple DB connectivity check
		try {
			const rows = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW() as now`;
			if (!rows.length || !rows[0]?.now) throw new Error('NOW() query returned no rows');
			res.json({ ok: true, db: true, time: rows[0].now.toISOString() });
		} catch (err) {
			throw new ApiError(500, 'INTERNAL_ERROR', (err as Error).message, { ok: false, db: false });
		}
  	})
);

export default router;