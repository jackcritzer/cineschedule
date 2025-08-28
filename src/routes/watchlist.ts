import { Router } from 'express';
import { PrismaClient, TitleType } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { fetchTmdbTitle } from '../lib/tmdb';

const prisma = new PrismaClient();
const router = Router();

const addByTmdbSchema = z.object({
    tmdbId: z.number().int().positive(),
    type: z.enum(['MOVIE', 'TV']),
});

router.post('/tmdb', requireAuth, asyncHandler(async (req: any, res) => {
    const userId = req.user?.userId as number | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = addByTmdbSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.treeifyError(parsed.error) });

    const data = await fetchTmdbTitle(parsed.data.tmdbId, parsed.data.type);
    const title = await prisma.title.upsert({
        where: { tmdbId_type: { tmdbId: data.tmdbId, type: data.type } },
        create: data as any,
        update: { name: data.name, releaseDate: data.releaseDate ?? null, posterPath: data.posterPath, overview: data.overview ?? null }
    });

    const existing = await prisma.watchlist.findUnique({
        where: { userId_titleId: { userId, titleId: title.id }},
    });
    if (existing) return res.status(200).json({ message: 'Already on watchlist' });

    const added = await prisma.watchlist.create({
        data: { userId, titleId: title.id },
        include: { title: true },
    });

    res.status(201).json(added);
}));

// POST /watchlist/:titleId
// Add title to user's watchlist using the title ID
router.post('/:titleId', requireAuth, asyncHandler(async (req: any, res) => {
    const userId = req.user?.userId as number | undefined;
    const titleId = Number(req.params.titleId);
    if (!userId || Number.isNaN(titleId)) return res.status(400).json({ error: 'Invalid user or titleId' });

    const title = await prisma.title.findUnique({ where: { id: titleId }});
    if (!title) return res.status(404).json({ error: 'Title not found' });

    const existing = await prisma.watchlist.findUnique({ where: { userId_titleId: { userId, titleId } } });
    if (existing) return res.status(200).json({ message: 'Already on watchlist' });

    const added = await prisma.watchlist.create({
        data: { userId, titleId },
        include: { title: true },
    });
    res.status(201).json(added);
}));

router.get('/', requireAuth, asyncHandler(async (req: any, res) => {
    const userId = req.user?.userId as number | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20')), 1), 100);
    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;

    const items = await prisma.watchlist.findMany({
        where: { userId },
        take: limit,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        include: { title: true },
    });

    const l = items.length;
    const lastItem = items[l - 1];
    if (!lastItem) return res.status(400).json({ error: 'Error fetching watchlist'});

    const nextCursor = l === limit ? lastItem.id : null
    res.json({ items, nextCursor });
}));

export default router;