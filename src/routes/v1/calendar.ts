import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../../db/client';
import { requireAuth } from '../../middleware/auth';
import { Provider, pickProviderBadges } from '../../lib/tmdb'
import { asyncHandler } from '../../middleware/asyncHandler';
import { validate, getValidated } from '../../middleware/validate';

const router = Router();

// --- Helpers ---
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const isValidYMD = (s: string) => {
    if (!dateRe.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const todayYMD = () => new Date().toISOString().slice(0, 10);

// Coerce YYYY-MM-DD -> Date at 00:00:00.000Z
const ymdToStartOfDay = z
    .string()
    .refine((s) => dateRe.test(s) && isValidYMD(s), { message: 'must be a valid YYYY-MM-DD' })
    .transform((s) => new Date(`${s}T00:00:00Z`));

// Coerce YYYY-MM-DD -> Date at 23:59:59.999Z
const ymdToEndOfDay = z
    .string()
    .refine((s) => dateRe.test(s) && isValidYMD(s), { message: 'must be a valid YYYY-MM-DD' })
    .transform((s) => new Date(`${s}T23:59:59.999Z`));

const calendarQuerySchema = z.object({
    // Accept strings, default to today (YYYY-MM-DD). We’ll coerce to Date below.
    from: z
        .string()
        .optional()
        .default(todayYMD)
        .pipe(ymdToStartOfDay), // => Date
    to: z
        .string()
        .optional()
        .transform((s) => (s === undefined ? undefined : s)) // keep undefined when missing
        .pipe(ymdToEndOfDay.optional()), // => Date | undefined
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
})
.superRefine((val, ctx) => {
    if (val.to && val.from.getTime() > val.to.getTime()) {
        ctx.addIssue({
            code: "custom",
            message: 'to must be on or after from',
            path: ['to'],
        });
    }
});

/** @route GET /v1/calendar
 *  @summary Merged release calendar for user's watchlist
 *  @auth Bearer
 *  @query { from?: 'YYYY-MM-DD'=today, to?: 'YYYY-MM-DD', limit?: int(1..200)=50 }
 *  @returns 200 { items: CalendarItem[], nextCursor: null }
 *  @errors 400 VALIDATION_ERROR | 401 AUTH_TOKEN_*
 */
router.get(
    '/', 
    requireAuth, 
    validate('query', calendarQuerySchema),
    asyncHandler(async (req: any, res) => {
        const userId: number = req.user.id;
        const { from, to, limit } = getValidated<z.infer<typeof calendarQuerySchema>>(req, 'query');

        // Get user's watchlist title IDs
        const watchlist = await prisma.watchlist.findMany({
            where: { userId },
            select: { titleId: true, title: { select: { id: true, type: true, name: true } } },
        });

        if (watchlist.length === 0) return res.json({ items: [], nextCursor: null });

        const titleIds = watchlist.map(w => w.titleId);

        // Fetch upcoming items
        const [movieEvents, tvEpisodes] = await Promise.all([
            prisma.releaseEvent.findMany({
                where: {
                    titleId: { in: titleIds },
                    date: { gte: from, ...(to ? { lte: to} : {}) },
                },
                select: {
                    id: true, 
                    titleId: true, 
                    date: true, 
                    type: true, 
                    country: true,
                    title: { 
                        select: { 
                            name: true, 
                            type: true 
                        } 
                    },
                }
            }),
            prisma.episode.findMany({
                where: {
                    titleId: { in: titleIds },
                    airDate: { gte: from, ...(to ? { lte: to }: {}) }
                },
                select: {
                    id: true, 
                    titleId: true, 
                    seasonNumber: true, 
                    episodeNumber: true,
                    name: true,
                    airDate: true,
                    runtimeMin: true,
                    title: { 
                        select: { 
                            name: true, 
                            networksJson: true,
                            providersJson: true 
                        } 
                    }
                }
            })
        ]);

        const movieItems = movieEvents.map(ev => ({
                kind: "movie" as const,
                date: ev.date.toISOString(),
                titleId: ev.titleId,
                title: ev.title.name,
                type: ev.type,
                country: ev.country,
                payload: { releaseEventId: ev.id },
            }));

        const tvItems = tvEpisodes.map((ep) => {
            const networksAll = (ep.title.networksJson as unknown as Provider[] | null) ?? [];
            const providersRaw = ep.title.providersJson as unknown as Record<string, any> | null;
            const providers = pickProviderBadges(providersRaw, "US", 4);
            
            return {
                kind: "episode" as const,
                date: ep.airDate.toDateString(),
                titleId: ep.titleId,
                title: ep.title.name,
                payload: {
                    episodeId: ep.id,
                    season: ep.seasonNumber,
                    episode: ep.episodeNumber,
                    name: ep.name,
                    networks: networksAll.slice(0, 2),
                    whereToWatch: providers // top 4 badges
                }
            }
        });

        const merged = [...movieItems, ...tvItems].sort((a, b) => a.date.localeCompare(b.date));

        res.json({ items: merged.slice(0, limit), nextCursor: null });
    })
);

export default router;