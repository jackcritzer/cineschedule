import { Router } from 'express';
import { PrismaClient, TitleType } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { fetchTmdbTitle } from '../lib/tmdb';

const prisma = new PrismaClient();
const router = Router();

const manualSchema = z.object({
    tmdbId: z.number().int().positive(),
    type: z.enum(['MOVIE', 'TV']),
    name: z.string().min(1),
    releaseDate: z.string().optional(), // YYYY-MM-DD
    posterPath: z.string().nullable().optional(),
    overview: z.string().nullable().optional()
});

router.post('/', asyncHandler(async (req, res) => {
    const parsed = manualSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.treeifyError(parsed.error) });
    const { tmdbId, type, name, releaseDate, posterPath, overview } = parsed.data;

    const releaseDateISO = releaseDate ? new Date(releaseDate) : null;
    if (releaseDate && Number.isNaN(releaseDateISO!.getTime())) {
        return res.status(400).json({ error: 'Invalid releaseDate' });
    }

    const title = await prisma.title.upsert({
        where: { tmdbId_type: { tmdbId, type } },
        create: { 
                    tmdbId, 
                    type: type as TitleType, 
                    name: name.trim(), 
                    releaseDate: releaseDateISO, 
                    posterPath: posterPath ?? null,
                    overview: overview ?? null,
                },
        update: { name: name.trim(), releaseDate: releaseDateISO, posterPath: posterPath ?? null, overview: overview ?? null },
    });
    res.status(201).json(title);
}));

const tmdbSchema = z.object({
    tmdbId: z.number().int().positive(),
    type: z.enum(['MOVIE', 'TV']),
});

router.post('/tmdb', asyncHandler(async (req, res) => {
    const parsed = tmdbSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: z.treeifyError(parsed.error) });

    const data = await fetchTmdbTitle(parsed.data.tmdbId, parsed.data.type);
    const title = await prisma.title.upsert({
        where: { tmdbId_type: { tmdbId: data.tmdbId, type: data.type }},
        create: data as any,
        update: {
            name: data.name,
            releaseDate: data.releaseDate ?? null,
            posterPath: data.posterPath ?? null,
            overview: data.overview ?? null
        }
    });
    res.status(201).json(title);
}));

router.get('/', asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20')), 1), 100);
    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;

    const items = await prisma.title.findMany({
        take: limit,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' }
    });
    const l = items.length;
    const lastItem = items[l - 1];
    if (!lastItem) return res.status(400).json({ error: 'Error fetching titles'});

    const nextCursor = l === limit ? lastItem.id : null
    res.json({ items, nextCursor });
}))

export default router;