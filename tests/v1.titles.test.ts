import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// Mock Prisma
vi.mock("../src/db/client", async () => {
	const mod = await import("./mocks/prisma");
	return { prisma: mod.prisma };
});

// Mock auth
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

// Mock TMDB: fetchTmdbTitle used by /v1/titles/tmdb
const fetchTmdbTitleSpy = vi.fn();
vi.mock("../src/lib/tmdb", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../src/lib/tmdb")>();
	return {
		...mod,
		fetchTmdbTitle: (...args: Parameters<typeof mod.fetchTmdbTitle>) => fetchTmdbTitleSpy(...args),
	};
});

// Mock refreshMaybe used by titles.ts (it’s optional depending on REFRESH_ON_ADD env)
const refreshMaybeSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/services/refreshMaybe", () => ({
	refreshMaybe: (...args: any[]) => refreshMaybeSpy(...args),
}));

import { buildTestApp } from "./mockApp";
import titlesRouter from "../src/routes/v1/titles";
import { __seed } from "./mocks/prisma";

describe("/v1/titles", () => {
	beforeEach(() => {
		__seed.reset();
		(fetchTmdbTitleSpy as any).mockReset?.();
		(refreshMaybeSpy as any).mockReset?.();

		// Seed a couple titles
		__seed.addTitle({ id: 1, tmdbId: 9001, type: "MOVIE", providersJson: null });
		__seed.addTitle({ id: 2, tmdbId: 9002, type: "TV", providersJson: null });

		// Default TMDB upsert result
		fetchTmdbTitleSpy.mockResolvedValue({
			tmdbId: 1234,
			type: "MOVIE",
			name: "Upserted",
			releaseDate: new Date("2020-01-01"),
			posterPath: "/x.jpg",
			overview: "o",
		});
	});

	it("GET / lists titles (cursor pagination)", async () => {
		const app = buildTestApp(titlesRouter, { withAuth: false });

		// Page 1
		const r1 = await request(app).get("/?limit=1").set("Authorization", "Bearer test");
		expect(r1.status).toBe(200);
        //console.log(r1.body)
		expect(r1.body.items.length).toBe(1);

		// Page 2
		const r2 = await request(app)
			.get(`/?limit=1&cursor=${r1.body.nextCursor}`)
			.set("Authorization", "Bearer test");
		expect(r2.status).toBe(200);
		console.log('r2', r1.body, r2.body)
		expect(r2.body.items.length).toBe(1);
	});

	it("GET /:id returns one", async () => {
		const app = buildTestApp(titlesRouter, { withAuth: false });
		const r = await request(app).get("/1").set("Authorization", "Bearer test");
		expect(r.status).toBe(200);
		expect(r.body.id).toBe(1);
	});

	it("POST /tmdb upserts from TMDB and calls refresh when enabled", async () => {
		// Ensure refresh-on-add is on by default (unless your code checks env)
		process.env.REFRESH_ON_ADD = "1";

		const app = buildTestApp(titlesRouter, { withAuth: false });
		const r = await request(app)
			.post("/tmdb")
			.set("Authorization", "Bearer test")
			.send({ tmdbId: 1234, type: "MOVIE" });

		expect([200, 201]).toContain(r.status);
		expect(r.body?.tmdbId).toBe(1234);
		expect(refreshMaybeSpy).toHaveBeenCalledTimes(1);
	});
});
