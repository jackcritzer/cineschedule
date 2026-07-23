// src/routes/v2/search.ts
import { Router } from "express";
import { z } from "zod";

import {
	ApiTitleType,
	SearchQuerySchema,
	TTLCache,
	apiToDbTitleType,
	titleTypeToAPI
} from "./helpers";

import { requireAuth } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";
import { validate, getValidated } from "../../middleware/validate";
import { prisma } from "../../db/client";

import { searchTmdb } from "../../lib/tmdb";

export type SearchResult = {
	tmdbId: number;
	type: ApiTitleType;
	name: string;
	releaseDate: string | null;
	year: number | null;
	posterPath: string | null;
	isInWatchlist: boolean;
	overview: string | null;
};
export type SearchResponse = {
	results: SearchResult[];
	page: number;
	totalPages: number;
	totalResults: number;
};

const router = Router();

// 90s cache for combined movie+tv results by (query,page,region)
const comboCache = new TTLCache<{
	movie: any;
	tv: any;
}>(90 * 1000);


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
		let movieJson: any;
		let tvJson: any;

		const cached = comboCache.get(key);
		if (cached) {
			movieJson = cached.movie;
			tvJson = cached.tv;
		} else {
			// Use your lib/tmdb search (v4 bearer) — language/en-US and include_adult=false baked in
			[movieJson, tvJson] = await Promise.all([
				searchTmdb(query, "MOVIE", page),
				searchTmdb(query, "TV", page),
			]);
			comboCache.set(key, { movie: movieJson, tv: tvJson });
		}

		// Map to the lean shape
		const movieResults: SearchResult[] = (movieJson.results ?? []).map((m: any) => ({
			tmdbId: m.tmdbId,
			type: titleTypeToAPI("MOVIE"),
			name: m.name,
			releaseDate: m.releaseDate ?? null,
			year: m.releaseDate ? Number(String(m.releaseDate).slice(0, 4)) : null,
			posterPath: m.posterPath ?? null,
			isInWatchlist: false,
			overview: m.overview ?? null,
		}));

		const tvResults: SearchResult[] = (tvJson.results ?? []).map((t: any) => ({
			tmdbId: t.tmdbId,
			type: titleTypeToAPI("TV"),
			name: t.name,
			releaseDate: t.releaseDate ?? null,
			year: t.releaseDate ? Number(String(t.releaseDate).slice(0, 4)) : null,
			posterPath: t.posterPath ?? null,
			isInWatchlist: false,
			overview: t.overview ?? null,
		}));

		const combined = [...movieResults, ...tvResults];

		// Watchlist flags
		const keySet = await batchIsInWatchlist(
			userId,
			combined.map((r) => ({ tmdbId: r.tmdbId, type: r.type }))
		);
		for (const r of combined) {
			r.isInWatchlist = keySet.has(`${r.type}:${r.tmdbId}`);
		}

		const resp: SearchResponse = {
			results: combined,
			page,
			// Combine meta sensibly: keep "max pages" & sum totals like before
			totalPages: Math.max(movieJson.totalPages ?? 1, tvJson.totalPages ?? 1),
			totalResults: (movieJson.totalResults ?? 0) + (tvJson.totalResults ?? 0),
		};

		res.json(resp);
	})
);

export default router;