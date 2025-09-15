import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { fetchTmdbTitle } from '../lib/tmdb';
import { refreshMaybe } from '../services/refreshMaybe';
import { validate, getValidated } from '../middleware/validate';
import { ApiError } from '../errors';

const router = Router();

const addByTmdbSchema = z.object({
    tmdbId: z.number().int().positive(),
    type: z.enum(['MOVIE', 'TV']),
});

const getWatchlistSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    cursor: z.coerce.number().int().positive().optional(),
})

/** @route GET /v1/watchlist
 *  @summary List current user's watchlist
 *  @auth Bearer
 *  @query { limit?: int(1..200)=50, cursor?: cursor?: int+ }
 *  @returns 200 { items: WatchlistItem[], nextCursor: number|null }
 *  @errors 400 VALIDATION_ERROR | 401 AUTH_TOKEN_*
 */
router.get(
    '/', 
    requireAuth,
    validate('query', getWatchlistSchema), 
    asyncHandler(async (req: any, res) => {
        const userId: number = req.user.id;

        const { limit, cursor } = getValidated<z.infer<typeof getWatchlistSchema>>(req, 'query');

        const items = await prisma.watchlist.findMany({
            where: { userId },
            take: Number(limit),
            ...(cursor ? { skip: 1, cursor: { id: Number(cursor) } } : {}),
            orderBy: { id: 'asc' },
            include: { title: true },
        });

        const lastItem = items[items.length - 1];
        const nextCursor = items.length === limit && lastItem ? lastItem.id : null;

        res.json({ items, nextCursor });
    })
);

/** @route POST /v1/watchlist/tmdb
 *  @summary Add by TMDB id (upsert Title, then upsert Watchlist)
 *  @auth Bearer
 *  @body { tmdbId: int+, type: 'MOVIE'|'TV' }
 *  @returns 200 { ok: true, titleId: number, watchlist: { userId: number, titleId: number }, refresh: any }
 *  @errors 400 VALIDATION_ERROR | 401 AUTH_TOKEN_* | 502 TMDB_UPSTREAM_ERROR | 502 UPSTREAM_ERROR
 */
router.post(
    '/tmdb', 
    requireAuth, 
    validate('body', addByTmdbSchema),
    asyncHandler(async (req: any, res) => {
        const userId: number = req.user.id;
        const { tmdbId, type } = getValidated<z.infer<typeof addByTmdbSchema>>(req, 'body');

        const data = await fetchTmdbTitle(tmdbId, type).catch(() => null);
        if (!data) throw new ApiError(502, 'TMDB_UPSTREAM_ERROR', 'TMDB fetch failed');

        const title = await prisma.title.upsert({
            where: { tmdbId_type: { tmdbId: data.tmdbId, type: data.type } },
            create: data as any,
            update: { 
                name: data.name, 
                releaseDate: data.releaseDate ?? null, 
                posterPath: data.posterPath, 
                overview: data.overview ?? null
            }
        });

        const wl = await prisma.watchlist.upsert({
            where: { userId_titleId: { userId, titleId: title.id } },
            update: {},
            create: { userId, titleId: title.id },
            select: { userId: true, titleId: true },
        });

        const refresh = await refreshMaybe(
            { 
                id: title.id, 
                type: title.type as any, 
                name: title.name ?? null, 
                lastRefreshedAt: title.lastRefreshedAt as any 
            },
            { 
                enabled: process.env.REFRESH_ON_ADD === '1', 
                minAgeMs: 24*60*60*1000, // 1 day
                reason: 'on-add'
            }
        ).catch(err => {
            throw new ApiError(502, 'UPSTREAM_ERROR', (err as Error).message ?? 'Refresh failed')
        }); 

        return res.json({ ok: true, titleId: title.id, watchlist: wl, refresh });
    })
);

/** @route POST /v1/watchlist/:titleId
 *  @summary Add existing Title by id (idempotent)
 *  @auth Bearer
 *  @params { titleId: int+ }
 *  @returns 201 WatchlistItem | 200 WatchlistItem (if already exists)
 *  @errors 400 VALIDATION_ERROR | 401 AUTH_TOKEN_* | 404 RESOURCE_NOT_FOUND
 */

const wlAddParams = z.object({
  titleId: z.coerce.number().int().positive(),
});

router.post(
    '/:titleId', 
    requireAuth, 
    validate('params', wlAddParams),
    asyncHandler(async (req: any, res) => {
        const userId: number = req.user.id;
        const { titleId } = getValidated<z.infer<typeof wlAddParams>>(req, 'params');

        const title = await prisma.title.findUnique({ where: { id: titleId }});
        if (!title) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Title not found')

        const existing = await prisma.watchlist.findUnique({ where: { userId_titleId: { userId, titleId } } });
        if (existing) return res.json(existing);

        const added = await prisma.watchlist.create({
            data: { userId, titleId },
            include: { title: true },
        });
        res.status(201).json(added);
    })
);


/** @route DELETE /v1/watchlist/:watchlistItemId
 *  @summary Remove watchlist item by row id (idempotent)
 *  @auth Bearer
 *  @params { watchlistItemId: int+ }
 *  @returns 200 { ok: true }
 *  @errors 400 VALIDATION_ERROR | 401 AUTH_TOKEN_* | 403 AUTH_FORBIDDEN
 */
const wlDeleteParams = z.object({
  watchlistItemId: z.coerce.number().int().positive(),
});

router.delete(
    '/:watchlistItemId',
    requireAuth,
    validate('params', wlDeleteParams),
    asyncHandler(async (req: any, res) => {
        const userId: number = req.user.id;
        const { watchlistItemId } = getValidated<z.infer<typeof wlDeleteParams>>(req, 'params');

        const item = await prisma.watchlist.findUnique({ where: { id: watchlistItemId } });
        if (!item) return res.json({ ok: true }); // idempotent
        if (item.userId !== userId) throw new ApiError(403, 'AUTH_FORBIDDEN', 'Not your watchlist item');

        await prisma.watchlist.delete({ where: { id: watchlistItemId } });
        res.json({ ok: true });
    })
);

export default router;