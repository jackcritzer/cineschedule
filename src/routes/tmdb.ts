import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { searchTmdb } from '../lib/tmdb';

const router = Router();

const querySchema = z.object({
    query: z.string().min(1),
    type: z.enum(['MOVIE', 'TV']).default('MOVIE'),
    page: z.coerce.number().int().min(1).max(1000).default(1),
});

router.get('/search', asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse({
        query: req.query.query,
        type: (req.query.type ?? 'MOVIE') as string,
        page: req.query.page
    });

    if (!parsed.success) return res.status(400).json({ error: z.treeifyError(parsed.error) });

    const { query, type, page } = parsed.data;
    const data = await searchTmdb(query, type, page);
    res.json(data);
}));

export default router;