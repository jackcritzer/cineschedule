import { Router } from "express";
import { TitleType } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../../db/client";
import { validate, getValidated } from "../../middleware/validate";
import { requireAuth } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";
import { fetchTmdbTitle } from "../../lib/tmdb";
import { ApiError, badRequest, notFound } from "../../errors";
import { refreshMaybe } from "../../services/refreshMaybe"; // <-- use your refresh service

const router = Router();

const REFRESH_ON_ADD = (process.env.REFRESH_ON_ADD ?? "1") !== "0";

const titlesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.coerce.number().int().positive().optional()
});

const tmdbSchema = z.object({
    tmdbId: z.number().int().positive(),
    type: z.enum(["MOVIE", "TV"])
});

function toTitleType(t: "MOVIE" | "TV"): TitleType {
    return t === "MOVIE" ? "MOVIE" : "TV";
}

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

        let nextCursor: number | null = null;
        let items = rows;

        if (rows.length > limit) {
            items = rows.slice(0, limit);
            // Use the last returned item as the cursor (Prisma pattern)
            nextCursor = items[items.length - 1]?.id ?? null;
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
            await Promise
                .resolve(refreshMaybe(title, { reason: "titles-add" }))
                .catch((e) => {
                    throw new ApiError(502, "UPSTREAM_ERROR", (e as Error).message || "Refresh failed");
                });
        }

        res.status(201).json(title);
    })
);

const refreshParams = z.object({
    id: z.coerce.number().int().positive()
});
const refreshQuery = z.object({
    force: z.coerce.boolean().optional()
});


router.post(
    "/:id/refresh",
    requireAuth,
    validate("params", refreshParams),
    validate("query", refreshQuery),
    asyncHandler(async (req: any, res) => {
        const { id } = getValidated<z.infer<typeof refreshParams>>(req, "params");
        const { force } = getValidated<z.infer<typeof refreshQuery>>(req, "query");

        const title = await prisma.title.findUnique({ where: { id } });
        if (!title) throw notFound("Title not found");

        const result = await refreshMaybe(title, {
            force: Boolean(force),
            reason: force ? "manual-force" : "manual",
        }).catch((err) => {
            throw new ApiError(502, "UPSTREAM_ERROR", (err as Error).message ?? "Refresh failed");
        });

        return res.json({ ok: true, result });
    })
);

export default router;
