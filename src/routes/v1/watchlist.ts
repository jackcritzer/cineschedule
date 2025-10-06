import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../db/client";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { fetchTmdbTitle } from "../../lib/tmdb";
import { validate, getValidated } from "../../middleware/validate";
import { ApiError, notFound } from "../../errors";
import { refreshMaybe } from "../../services/refreshMaybe";

const router = Router();

const addByTmdbSchema = z.object({
    tmdbId: z.number().int().positive(),
    type: z.enum(["MOVIE", "TV"])
});

const addByIdParams = z.object({
    titleId: z.coerce.number().int().positive()
});

const listQuery = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.coerce.number().int().positive().optional()
});

const wlDeleteParams = z.object({
    watchlistItemId: z.coerce.number().int().positive()
});

function toTitleType(t: "MOVIE" | "TV") {
    return t === "MOVIE" ? "MOVIE" : "TV";
}

router.post(
    "/tmdb",
    requireAuth,
    validate("body", addByTmdbSchema),
    asyncHandler(async (req: any, res) => {
        const userId: number = req.user.id;
        const { tmdbId, type } = getValidated<z.infer<typeof addByTmdbSchema>>(req, "body");

        const data = await fetchTmdbTitle(tmdbId, type).catch(() => null);
        if (!data) throw new ApiError(502, "TMDB_UPSTREAM_ERROR", "TMDB fetch failed");

        const title = await prisma.title.upsert({
            where: { tmdbId_type: { tmdbId, type: toTitleType(type) } },
            create: {
                tmdbId,
                type: toTitleType(type),
                name: data.name,
                releaseDate: data.releaseDate ?? null,
                posterPath: data.posterPath ?? null,
                overview: data.overview ?? null
            },
            update: {
                name: data.name,
                releaseDate: data.releaseDate ?? null,
                posterPath: data.posterPath ?? null,
                overview: data.overview ?? null
            }
        });

        // Refresh immediately so calendar/search reflect providers/episodes/releases
        await refreshMaybe(title, { reason: "on-watchlist-add" }).catch((err) => {
            throw new ApiError(502, "UPSTREAM_ERROR", (err as Error).message ?? "Refresh failed");
        });

        const existing = await prisma.watchlist.findUnique({
            where: { userId_titleId: { userId, titleId: title.id } }
        });
        const wl = existing
            ? existing
            : await prisma.watchlist.create({ data: { userId, titleId: title.id } });

        return res.status(existing ? 200 : 201).json({
            ok: true,
            titleId: title.id,
            watchlist: wl
        });
    })
);

router.post(
    "/:titleId",
    requireAuth,
    validate("params", addByIdParams),
    asyncHandler(async (req: any, res) => {
        const userId: number = req.user.id;
        const { titleId } = getValidated<z.infer<typeof addByIdParams>>(req, "params");

        const title = await prisma.title.findUnique({ where: { id: titleId } });
        if (!title) throw notFound("Title not found");

        // Optional: you may choose to refresh here as well
        await refreshMaybe(title, { reason: "on-watchlist-add-existing" }).catch(() => {});

        const existing = await prisma.watchlist.findUnique({
            where: { userId_titleId: { userId, titleId } }
        });
        const wl = existing
            ? existing
            : await prisma.watchlist.create({ data: { userId, titleId } });

        res.status(existing ? 200 : 201).json({ ok: true, watchlist: wl });
    })
);

router.get(
    "/",
    requireAuth,
    validate("query", listQuery),
    asyncHandler(async (req: any, res) => {
        const userId: number = req.user.id;
        const { limit, cursor } = getValidated<z.infer<typeof listQuery>>(req, "query");

        const items = await prisma.watchlist.findMany({
            where: { userId },
            take: limit + 1,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { id: "asc" },
            select: {
                id: true,
                createdAt: true,
                title: {
                    select: {
                        id: true,
                        tmdbId: true,
                        type: true,
                        name: true,
                        posterPath: true,
                        releaseDate: true
                    }
                }
            }
        });

        const lastItem = items[items.length - 1];
        const nextCursor = items.length === limit && lastItem ? lastItem.id : null;

        let page = items;
        if (items.length > limit) {
            page = items.slice(0, limit);
        }

        res.json({ items: page, nextCursor });
    })
);

router.delete(
    "/:watchlistItemId",
    requireAuth,
    validate("params", wlDeleteParams),
    asyncHandler(async (req: any, res) => {
        const userId: number = req.user.id;
        const { watchlistItemId } = getValidated<z.infer<typeof wlDeleteParams>>(req, "params");

        const item = await prisma.watchlist.findUnique({ where: { id: watchlistItemId } });
        if (!item) return res.json({ ok: true }); // idempotent
        if (item.userId !== userId) throw new ApiError(403, "AUTH_FORBIDDEN", "Not your watchlist item");

        await prisma.watchlist.delete({ where: { id: watchlistItemId } });
        res.json({ ok: true });
    })
);

export default router;