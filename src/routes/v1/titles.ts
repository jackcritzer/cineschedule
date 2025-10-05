import { Router } from 'express';
import { TitleType } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../../db/client';
import { validate, getValidated } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { fetchTmdbTitle, searchTmdb } from '../../lib/tmdb';
import { ApiError } from '../../errors';

const router = Router();

const titlesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    cursor: z.coerce.number().int().positive().optional()
});

/** @route GET /v1/titles
 *  @summary Paginated Titles
 *  @auth Bearer
 *  @query { limit?: int(1..100)=20, cursor?: int+ }
 *  @returns 200 { items: Title[], nextCursor: number|null }
 *  @errors 400 VALIDATION_ERROR | 401 AUTH_TOKEN_*
 */
router.get(
    '/',
    requireAuth,
    validate('query', titlesQuerySchema),
    asyncHandler(async (req: any, res) => {
        const { limit, cursor } = getValidated<z.infer<typeof titlesQuerySchema>>(req, 'query');

        const items = await prisma.title.findMany({
            take: limit,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { id: 'asc' }
        });

        const lastItem = items[items.length - 1];
        const nextCursor = items.length === limit && lastItem ? lastItem.id : null;

        res.json({ items, nextCursor });
    })
);

const isoDateNullable = z.preprocess((v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'string') {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? v : d;
    }
    return v;
}, z.date().nullable());


const manualTitleSchema = z.object({
    tmdbId: z.number().int().positive(),
    type: z.enum(['MOVIE', 'TV']),
    name: z.string().min(1),
    releaseDate: isoDateNullable.optional(), // Accepts "", null, or ISO string -> Date|null (YYYY-MM-DD)
    posterPath: z.string().nullable().optional(),
    overview: z.string().nullable().optional()
});

/** @route POST /v1/titles
 *  @summary Manual upsert of Title
 *  @auth Bearer
 *  @body { tmdbId:int+, type:'MOVIE'|'TV', name:string, releaseDate?: ISO|null, posterPath?: string|null, overview?: string|null }
 *  @returns 201 Title
 *  @errors 400 VALIDATION_ERROR | 401 AUTH_TOKEN_* | 500 INTERNAL_ERROR
 */
router.post(
    '/',
    requireAuth,
    validate('body', manualTitleSchema),
    asyncHandler(async (req: any, res) => {
        const { tmdbId, type, name, releaseDate, posterPath, overview } = getValidated<z.infer<typeof manualTitleSchema>>(req, 'body');

        const title = await prisma.title.upsert({
            where: { tmdbId_type: { tmdbId, type } },
            create: { 
                        tmdbId, 
                        type: type as TitleType, 
                        name: name.trim(), 
                        releaseDate: releaseDate ?? null, 
                        posterPath: posterPath ?? null,
                        overview: overview ?? null,
                    },
            update: { 
                        name: name.trim(), 
                        releaseDate: releaseDate ?? null, 
                        posterPath: posterPath ?? null, 
                        overview: overview ?? null
                    },
        });
        res.status(201).json(title);
    })
);

const tmdbSchema = z.object({
    tmdbId: z.number().int().positive(),
    type: z.enum(['MOVIE', 'TV']),
});

/** @route POST /v1/titles/tmdb
 *  @summary Upsert Title using TMDB data
 *  @auth Bearer
 *  @body { tmdbId:int+, type:'MOVIE'|'TV' }
 *  @returns 201 Title
 *  @errors 400 VALIDATION_ERROR | 401 AUTH_TOKEN_* | 502 TMDB_UPSTREAM_ERROR
 */
router.post(
    '/tmdb',
    requireAuth,
    validate('body', tmdbSchema),
    asyncHandler(async (req: any, res) => {
        const { tmdbId, type } = getValidated<z.infer<typeof tmdbSchema>>(req, 'body');

        const data = await fetchTmdbTitle(tmdbId, type).catch(() => null);
        if (!data) throw new ApiError(502, 'TMDB_UPSTREAM_ERROR', 'TMDB fetch failed');

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

/** @route GET /v1/titles/:id
 *  @summary Get a Title by id
 *  @auth Bearer
 *  @params { id: int+ }
 *  @returns 200 Title
 *  @errors 400 VALIDATION_ERROR | 401 AUTH_TOKEN_* | 404 RESOURCE_NOT_FOUND
 */
const titleIdParams = z.object({
    id: z.coerce.number().int().positive(),
});

router.get(
    '/:id',
    requireAuth,
    validate('params', titleIdParams),
    asyncHandler(async (req: any, res) => {
        const { id } = getValidated<z.infer<typeof titleIdParams>>(req, 'params');
        const title = await prisma.title.findUnique({ where: { id } });
        if (!title) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Title not found');
        res.json(title);
    })
);

/** @route GET /v1/titles/search
 *  @summary Proxy search to TMDB
 *  @auth Bearer
 *  @query { q:string, type?:'MOVIE'|'TV'='MOVIE', page?:int(1..1000)=1 }
 *  @returns 200 TMDBSearchResult
 *  @errors 400 VALIDATION_ERROR | 401 AUTH_TOKEN_* | 502 TMDB_UPSTREAM_ERROR
 */
const titlesSearchQuery = z.object({
    q: z.string().min(1),
    type: z.enum(['MOVIE', 'TV']).default('MOVIE'),
    page: z.coerce.number().int().min(1).max(1000).default(1),
});


router.get(
    '/search',
    requireAuth,
    validate('query', titlesSearchQuery),
    asyncHandler(async (req: any, res) => {
        const { q, type, page } = getValidated<z.infer<typeof titlesSearchQuery>>(req, 'query');
        const data = await searchTmdb(q, type, page).catch(() => null);
        if (!data) throw new ApiError(502, 'TMDB_UPSTREAM_ERROR', 'TMDB search failed');
        res.json(data);
    })
);

export default router;