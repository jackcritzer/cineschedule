// src/routes/v2/search.ts
import { Router } from "express";
import { z } from "zod";

import {
	SearchQuerySchema,
	TTLCache,
	apiToDbTitleType,
	titleTypeToAPI
} from "./helpers";

import { requireAuth } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";
import { validate, getValidated } from "../../middleware/validate";
import { prisma } from "../../db/client";

import { searchTmdbTitles } from "../../lib/tmdb";
import { ApiTitleType, SearchResult, SearchResponse, TmdbSearchResponse } from "../../types/search";

const router = Router();

// 90s cache for combined movie+tv results by (query,page,region)
const comboCache = new TTLCache<{
	movie: any;
	tv: any;
}>(90 * 1000);

const searchCache = new TTLCache<TmdbSearchResponse>(90 * 1000);

async function batchIsInWatchlist(
	userId: number,
	items: Array<{ tmdbId: number; type: ApiTitleType }>
): Promise<Set<string>> {
	if (items.length === 0) return new Set();

	const dedup = Array.from(new Map(items.map(i => [`${i.type}:${i.tmdbId}`, i])).values());
	const titles = await prisma.title.findMany({
		where: {
			OR: dedup.map((i) => ({
				tmdbId: i.tmdbId,
				type: apiToDbTitleType(i.type),
			})),
		},
		select: { id: true, tmdbId: true, type: true },
	});

	if (titles.length === 0) return new Set();

	const wl = await prisma.watchlist.findMany({
		where: { userId, titleId: { in: titles.map((t) => t.id) } },
		select: { title: { select: { tmdbId: true, type: true } } },
	});

	const s = new Set<string>();
	for (const row of wl) {
		const mt: ApiTitleType = titleTypeToAPI(row.title.type);
		s.add(`${mt}:${row.title.tmdbId}`);
	}
	return s;
}

router.get(
	"/",
	requireAuth,
	validate("query", SearchQuerySchema),
	asyncHandler(async (req: any, res) => {
		const userId: number = req.user.id;
		const { query, page, region } = getValidated<z.infer<typeof SearchQuerySchema>>(req, "query");

		// Try cache
		const key = comboCache.key(["q", query.trim(), "p", page, "r", region]);
		let searchResults;

		const cached = searchCache.get(key);

		if (cached) {
			searchResults = cached;
		} else {
			searchResults = await searchTmdbTitles(query);
			searchCache.set(key, searchResults);
		}

		// Map to the lean shape
		const results: SearchResult[] = searchResults.results.map((r) => ({
			...r,
			year: r.releaseDate
				? Number(r.releaseDate.slice(0, 4))
				: null,
			isInWatchlist: false,
		}));

		// Watchlist flags
		const keySet = await batchIsInWatchlist(
			userId,
			results.map((r) => ({ tmdbId: r.tmdbId, type: r.type }))
		);
		for (const r of results) {
			r.isInWatchlist = keySet.has(`${r.type}:${r.tmdbId}`);
		}

		const resp: SearchResponse = {
			results: results,
		};
		
		res.json(resp);
	})
);

export default router;