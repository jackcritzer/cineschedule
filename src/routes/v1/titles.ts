import { Router } from "express";
import { TitleType } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../../db/client";
import { validate, getValidated } from "../../middleware/validate";
import { requireAuth } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";
import { fetchTmdbTitle, searchTmdb } from "../../lib/tmdb";
import { ApiError, badRequest, notFound } from "../../errors";
import { refreshMaybe } from "../../services/refreshMaybe"; // <-- use your refresh service

const router = Router();

const REFRESH_ON_ADD = (process.env.REFRESH_ON_ADD ?? "1") !== "0";

// ---------- Schemas
const titlesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.coerce.number().int().positive().optional()
});

const titlesSearchQuery = z.object({
    q: z.string().min(1),
    type: z.enum(["MOVIE", "TV"]).default("MOVIE"),
    page: z.coerce.number().int().min(1).max(1000).default(1)
});

const tmdbSchema = z.object({
    tmdbId: z.number().int().positive(),
    type: z.enum(["MOVIE", "TV"])
});

// ---------- Helpers
function toTitleType(t: "MOVIE" | "TV"): TitleType {
    return t === "MOVIE" ? "MOVIE" : "TV";
}

// ---------- Routes

router.get(
    "/",
    requireAuth,
    validate("query", titlesQuerySchema),
    asyncHandler(async (req: any, res) => {
        const { limit, cursor } = getValidated<z.infer<typeof titlesQuerySchema>>(req, "query");

        const rows = await prisma.title.findMany({
            take: limit + 1,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { id: "asc" },
            select: {
                id: true,
                tmdbId: true,
                type: true,
                name: true,
                releaseDate: true,
                posterPath: true,
                overview: true,
                updatedAt: true
            }
        });

        let items = rows;

        const lastItem = items[items.length - 1];
        const nextCursor = items.length === limit && lastItem ? lastItem.id : null;

        if (rows.length > limit) {
            items = rows.slice(0, limit);
        }

        res.json({ items, nextCursor });
    })
);

router.get(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) throw badRequest("Invalid id");

        const t = await prisma.title.findUnique({ where: { id } });
        if (!t) throw notFound("Title not found");

        res.json(t);
    })
);

// Keep this for v1 users; newer FE can use /search (latest alias -> v2).
router.get(
    "/search",
    requireAuth,
    validate("query", titlesSearchQuery),
    asyncHandler(async (req: any, res) => {
        const { q, type, page } = getValidated<z.infer<typeof titlesSearchQuery>>(req, "query");
        const data = await searchTmdb(q, type, page).catch(() => null);
        if (!data) throw new ApiError(502, "TMDB_UPSTREAM_ERROR", "TMDB search failed");
        res.json(data);
    })
);

// Upsert Title from TMDB, then (optionally) refresh via refreshMaybe
router.post(
    "/tmdb",
    requireAuth,
    validate("body", tmdbSchema),
    asyncHandler(async (req: any, res) => {
        const { tmdbId, type } = getValidated<z.infer<typeof tmdbSchema>>(req, "body");

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

        if (REFRESH_ON_ADD) {
            await refreshMaybe(title, { reason: "on-add" }).catch((err) => {
                throw new ApiError(502, "UPSTREAM_ERROR", (err as Error).message ?? "Refresh failed");
            });
        }

        res.status(201).json(title);
    })
);

export default router;
