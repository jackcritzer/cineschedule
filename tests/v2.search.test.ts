import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { ApiTitleType, SearchResponse, TmdbSearchResponse } from "../src/types/search";

// Mock prisma
vi.mock("../src/db/client", async () => {
	const mod = await import("./mocks/prisma");
	return { prisma: mod.prisma };
});

// Mock requireAuth
vi.mock("../src/middleware/auth", () => {
	return {
		requireAuth: (req: any, res: any, next: any) => {
			const auth = req.get("authorization");
			if (!auth) {
				return res.status(401).json({
					error: { code: "AUTH_MISSING", message: "Authentication required" },
				});
			}
			req.user = { id: 1 };
			return next();
		},
	};
});
import { buildTestApp } from "./mockApp";
import searchRouter from "../src/routes/v2/search";
import { __seed } from "./mocks/prisma";

// Mock lib/tmdb.searchTmdb with a typed spy
type SearchTmdbFn = (
    query: string,
    type: ApiTitleType,
    page?: number
) => Promise<TmdbSearchResponse>;

const searchTmdbSpy = vi.fn<SearchTmdbFn>();

vi.mock("../src/lib/tmdb", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../src/lib/tmdb")>();
	return {
		...mod,
		searchTmdb: (...args: Parameters<SearchTmdbFn>) => searchTmdbSpy(...args),
	};
});

describe("/v2/search", () => {
	beforeEach(() => {
		__seed.reset();
		(searchTmdbSpy as unknown as { mockReset(): void }).mockReset?.();

		// Seed titles for isInWatchlist
		__seed.addTitle({ id: 1, tmdbId: 1, type: "MOVIE" });
		__seed.addTitle({ id: 2, tmdbId: 2, type: "TV" });
		__seed.addWatchlist({ id: 1, userId: 1, titleId: 1 });

		// Configure searchTmdb responses: first MOVIE, second TV
		searchTmdbSpy
			.mockImplementationOnce(async (_q: string, type: "MOVIE" | "TV", page = 1) => ({
				page,
				totalPages: 3,
				totalResults: 2,
				results: [
					{
						tmdbId: 1,
						type,
						name: "Movie One",
						releaseDate: "2021-01-01",
						posterPath: "/m1.jpg",
						overview: "x",
						popularity: 1,
					},
					{
						tmdbId: 11,
						type,
						name: "Movie Two",
						releaseDate: "2010-01-01",
						posterPath: "/m2.jpg",
						overview: "y",
						popularity: 1,
					},
				],
			}))
			.mockImplementationOnce(async (_q: string, type: "MOVIE" | "TV", page = 1) => ({
				page,
				totalPages: 4,
				totalResults: 1,
				results: [
					{
						tmdbId: 2,
						type,
						name: "TV One",
						releaseDate: "2020-05-05",
						posterPath: "/t1.jpg",
						overview: "z",
						popularity: 2,
					},
				],
			}));
	});

	it("requires auth (no token)", async () => {
		const app = buildTestApp(searchRouter, { withAuth: false });
		const r = await request(app)
			.get("/?query=dune&page=1&region=US");
		expect(r.status).toBe(401);
		expect((r.body as { error?: { code?: string } }).error?.code).toBe("AUTH_MISSING");
	});

	it("returns combined results with isInWatchlist and uses cache on repeat", async () => {
		const app = buildTestApp(searchRouter, { withAuth: true });

		const r1 = await request(app)
			.get("/?query=dune&page=1&region=US")
			.set("Authorization", "Bearer test");;
		expect(r1.status).toBe(200);
		const body1 = r1.body as SearchResponse;
		expect(Array.isArray(body1.results)).toBe(true);
		expect(body1.results.length).toBe(3);

		const flags = Object.fromEntries(body1.results.map((r) => [`${r.type}:${r.tmdbId}`, r.isInWatchlist]));
		expect(flags["MOVIE:1"]).toBe(true);
		expect(flags["TV:2"]).toBe(false);
		expect(flags["MOVIE:11"]).toBe(false);

		// totalPages = max(3, 4) = 4
		expect(body1.totalPages).toBe(4);

		// Expect two upstream calls (movie, tv)
		expect((searchTmdbSpy as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);

		// Repeat identical request → cached (no new upstream calls)
		const r2 = await request(app)
			.get("/?query=dune&page=1&region=US")
			.set("Authorization", "Bearer test");
		expect(r2.status).toBe(200);
		const body2 = r2.body as SearchResponse;
		expect(body2.results.length).toBe(3);
		expect((searchTmdbSpy as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
	});
});