import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=50
 * Returns upcoming releases/episodes for titles in the user's watchlist, merged chronologically.
 */
router.get("/calendar", requireAuth, async (req: any, res) => {
    try {
        const userId: number = req.user.id;
        
        const limit = Math.min(Number(req.query.limit ?? 50), 200);
        const fromStr = (req.query.from as string) ?? new Date().toISOString().slice(0, 10);
        const toStr = (req.query.to as string) ?? null;

        const from = new Date(`${fromStr}T00:00:00Z`);
        const to = toStr ? new Date(`${toStr}T23:59:59Z`) : null;

        // Get user's watchlist title IDs
        const watchlist = await prisma.watchlist.findMany({
            where: { userId },
            select: { titleId: true, title: { select: { id: true, type: true, name: true } } },
        });

        const titleIds = watchlist.map(w => w.titleId);
        if (titleIds.length === 0) return res.json({ items: [], nextCursor: null });

        // Fetch upcoming per model
        const [movieEvents, tvEpisodes] = await Promise.all([
            prisma.releaseEvent.findMany({
                where: {
                    titleId: { in: titleIds },
                    date: { gte: from, ...(to ? { lte: to} : {}) },
                },
                select: {
                    id: true, titleId: true, date: true, type: true, country: true,
                    title: { select: { name: true, type: true } },

                }
            }),
            prisma.episode.findMany({
                where: {
                    titleId: { in: titleIds },
                    airDate: { gte: from, ...(to ? { lte: to }: {}) }
                },
                select: {
                    id: true, titleId: true, seasonNumber: true, episodeNumber: true,
                    name: true, airDate: true,
                    title: { select: { name: true, type: true } }
                }
            })
        ]);

        // Merge into single feed (sorted by date)
        const merged = [
            ...movieEvents.map(ev => ({
                kind: "movie" as const,
                date: ev.date.toISOString(),
                titleId: ev.titleId,
                title: ev.title.name,
                type: ev.type,
                country: ev.country,
                payload: { releaseEventId: ev.id },
            })),
            ...tvEpisodes.map(ep => ({
                kind: "episode" as const,
                date: ep.airDate.toDateString(),
                titleId: ep.titleId,
                title: ep.title.name,
                payload: {
                    episodeId: ep.id,
                    season: ep.seasonNumber,
                    episode: ep.episodeNumber,
                    name: ep.name,
                    networks: (ep as any).title?.networksJson ?? [],
                    whereToWatch: ((ep as any).title?.providersJson ?? []).slice(0, 4) // top 4 badges
                }
            }))
        ].sort((a, b) => a.date.localeCompare(b.date));

        res.json({ items: merged.slice(0, limit), nextCursor: null });
    } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "Calendar failed" });
    }
});

export default router;