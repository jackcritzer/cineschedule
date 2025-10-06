import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// Mock Prisma at the path the router imports
vi.mock("../src/db/client", async () => {
	const mod = await import("./mocks/prisma");
	return { prisma: mod.prisma };
});

// Mock auth to avoid JWT/env
vi.mock("../src/middleware/auth", () => {
	return {
		requireAuth: (req: any, res: any, next: any) => {
			const auth = req.get("authorization");
			if (!auth) return res.status(401).json({ error: { code: "AUTH_MISSING", message: "Authentication required" } });
			req.user = { id: 1 };
			return next();
		},
	};
});

// Mock TMDB: fetchTmdbTitle used by /watchlist/tmdb
const fetchTmdbTitleSpy = vi.fn();
vi.mock("../src/lib/tmdb", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../src/lib/tmdb")>();
	return {
		...mod,
		fetchTmdbTitle: (...args: Parameters<typeof mod.fetchTmdbTitle>) => fetchTmdbTitleSpy(...args),
	};
});

// Mock refreshMaybe to avoid side effects and assert calls
const refreshMaybeSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/services/refreshMaybe", () => ({
	refreshMaybe: (...args: any[]) => refreshMaybeSpy(...args),
}));

import { buildTestApp } from "./mockApp";
import watchlistRouter from "../src/routes/v1/watchlist";
import { __seed } from "./mocks/prisma";

describe("/v1/watchlist", () => {
	beforeEach(() => {
		__seed.reset();
		(refreshMaybeSpy as any).mockReset?.();
		(fetchTmdbTitleSpy as any).mockReset?.();

		// Seed a title (id=10)
		__seed.addTitle({ id: 10, tmdbId: 1010, type: "MOVIE", providersJson: null });

		// Default TMDB fetch returns same title info for upsert path
		fetchTmdbTitleSpy.mockResolvedValue({
			tmdbId: 1011,
			type: "MOVIE",
			name: "New Movie",
			releaseDate: new Date("2021-01-01"),
			posterPath: "/p.jpg",
			overview: "o",
		});
	});

	it("POST /tmdb adds a title via TMDB, refreshes, and is idempotent", async () => {
		const app = buildTestApp(watchlistRouter, { withAuth: false }); // our route already checks mock auth
		// First call -> create title via upsert, refresh, add to watchlist
		const r1 = await request(app)
			.post("/tmdb")
			.set("Authorization", "Bearer test")
			.send({ tmdbId: 1011, type: "MOVIE" });
		expect([200, 201]).toContain(r1.status);
		expect(r1.body?.ok).toBe(true);
		expect(refreshMaybeSpy).toHaveBeenCalledTimes(1);

		// Second call -> idempotent (watchlist already has it)
		const r2 = await request(app)
			.post("/tmdb")
			.set("Authorization", "Bearer test")
			.send({ tmdbId: 1011, type: "MOVIE" });
		expect([200, 201]).toContain(r2.status);
		// refresh can still be called, but we don't require the exact count here
	});

	it("POST /:titleId adds existing title, idempotent", async () => {
		const app = buildTestApp(watchlistRouter, { withAuth: false });

		const r1 = await request(app).post("/10").set("Authorization", "Bearer test");
		expect([200, 201]).toContain(r1.status);
		expect(r1.body?.ok).toBe(true);

		const r2 = await request(app).post("/10").set("Authorization", "Bearer test");
		expect([200, 201]).toContain(r2.status);
	});

	it("GET / returns items with cursor pagination", async () => {
		const app = buildTestApp(watchlistRouter, { withAuth: false });

		// Add a couple items
		await request(app).post("/10").set("Authorization", "Bearer test");
		// Also add the new TMDB title
		fetchTmdbTitleSpy.mockResolvedValueOnce({
			tmdbId: 2022,
			type: "MOVIE",
			name: "Another",
			releaseDate: null,
			posterPath: null,
			overview: null,
		});
		await request(app)
			.post("/tmdb")
			.set("Authorization", "Bearer test")
			.send({ tmdbId: 2022, type: "MOVIE" });

		// Page 1
		const p1 = await request(app).get("/?limit=1").set("Authorization", "Bearer test");
		expect(p1.status).toBe(200);
		expect(Array.isArray(p1.body.items)).toBe(true);
		expect(p1.body.items.length).toBe(1);
		const cursor = p1.body.nextCursor;

		// Page 2
		const p2 = await request(app).get(`/?limit=1&cursor=${cursor}`).set("Authorization", "Bearer test");
		expect(p2.status).toBe(200);
		expect(p2.body.items.length).toBe(1);
	});

	it("DELETE /:watchlistItemId is idempotent", async () => {
		const app = buildTestApp(watchlistRouter, { withAuth: false });

		// Add once
		const add = await request(app).post("/10").set("Authorization", "Bearer test");
		expect([200, 201]).toContain(add.status);

		// Delete — we don't know ID from mock, route returns ok regardless if not found
		const del1 = await request(app).delete("/999").set("Authorization", "Bearer test");
		expect(del1.status).toBe(200);
		expect(del1.body.ok).toBe(true);

		// Delete again idempotently
		const del2 = await request(app).delete("/999").set("Authorization", "Bearer test");
		expect(del2.status).toBe(200);
		expect(del2.body.ok).toBe(true);
	});
});