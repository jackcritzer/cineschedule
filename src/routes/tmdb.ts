import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../middleware/asyncHandler';
import { searchTmdb } from '../lib/tmdb';
import { requireAuth } from '../middleware/auth';
import { validate, getValidated } from '../middleware/validate';
import { ApiError } from '../errors';

const router = Router();

const querySchema = z.object({
    query: z.string().min(1),
    type: z.enum(['MOVIE', 'TV']).default('MOVIE'),
    page: z.coerce.number().int().min(1).max(1000).default(1),
});


// GET /tmdb/search (deprecated; prefer /v1/titles/search)

router.get(
    '/search',
    requireAuth,
    validate('query', querySchema),
    asyncHandler(async (req: any, res) => {
        const { query, type, page } = getValidated<z.infer<typeof querySchema>>(req, 'query');

        const data = await searchTmdb(query, type, page).catch(() => null);
        if (!data) throw new ApiError(502, 'TMDB_UPSTREAM_ERROR', 'TMDB search failed')

        res.json(data);
    }
));

export default router;