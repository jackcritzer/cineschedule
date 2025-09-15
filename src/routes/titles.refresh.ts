import { Router } from 'express';
import { refreshTitleData } from '../services/refresh';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate, getValidated } from '../middleware/validate';
import { z } from 'zod';
import { ApiError } from '../errors';

const router = Router();

/** @route POST /v1/titles/:id/refresh
 *  @summary Force refresh title data from upstream services
 *  @auth Bearer
 *  @params { id: int+ }
 *  @returns 200 { ok: true, result: any }
 *  @errors 400 VALIDATION_ERROR | 401 AUTH_TOKEN_* | 502 UPSTREAM_ERROR
 */

const refreshParams = z.object({ 
                                    id: z.coerce.number().int().positive() 
                                });

router.post(
    '/:id/refresh', 
    requireAuth,
    validate('params', refreshParams), 
    asyncHandler(async (req: any, res) => {
        const { id } = getValidated<z.infer<typeof refreshParams>>(req, 'params');
        try {
            const result = await refreshTitleData(id);
            res.json({ ok: true, result });
        } catch (err: any) {
            throw new ApiError(502, 'UPSTREAM_ERROR', err?.message ?? 'Refresh failed');
        }
    })
);

export default router;