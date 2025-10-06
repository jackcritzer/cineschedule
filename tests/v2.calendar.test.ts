import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

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
import calendarRouter from "../src/routes/v2/calendar";
import { __seed } from "./mocks/prisma";



type ProviderInfo = { id: number; name: string; slug: string; logoPath?: string | null };
type CalendarItem = {
	id: string;
	titleId: number;
	title: string;
	type: "theatrical" | "digital" | "streaming";
	date: string;
	providers?: ProviderInfo[];
	region?: string;
};
type CalendarResponse = { items: CalendarItem[]; nextCursor?: string | null };

const y = (s: string) => new Date(`${s}T00:00:00Z`);

describe("/v2/calendar", () => {
	beforeEach(() => {
		__seed.reset();

		// Titles with providersJson
		__seed.addTitle({
			id: 1,
			tmdbId: 1001,
			type: "MOVIE",
			providersJson: {
				results: {
					US: {
						flatrate: [
							{ provider_id: 8, provider_name: "Netflix", logo_path: "/netflix.png" },
							{ provider_id: 337, provider_name: "Max", logo_path: "/max.png" },
						],
					},
				},
			},
		});
		__seed.addTitle({
			id: 2,
			tmdbId: 1002,
			type: "MOVIE",
			providersJson: {
				results: {
					US: { flatrate: [{ provider_id: 9, provider_name: "Amazon Prime Video", logo_path: "/prime.png" }] },
				},
			},
		});
		__seed.addTitle({
			id: 3,
			tmdbId: 1003,
			type: "MOVIE",
			providersJson: {
				results: {
					US: { flatrate: [{ provider_id: 8, provider_name: "Netflix", logo_path: "/netflix.png" }] },
				},
			},
		});

		// Watchlist for user 1: all three titles
		__seed.addWatchlist({ id: 1, userId: 1, titleId: 1 });
		__seed.addWatchlist({ id: 2, userId: 1, titleId: 2 });
		__seed.addWatchlist({ id: 3, userId: 1, titleId: 3 });

		// Release events (streaming) in range
		__seed.addReleaseEvent({
			titleId: 1,
			date: y("2025-10-05"),
			type: "STREAMING",
			country: "US",
			title: { name: "T1", providersJson: null },
		});
		__seed.addReleaseEvent({
			titleId: 2,
			date: y("2025-10-06"),
			type: "STREAMING",
			country: "US",
			title: { name: "T2", providersJson: null },
		});
		__seed.addReleaseEvent({
			titleId: 3,
			date: y("2025-10-07"),
			type: "STREAMING",
			country: "US",
			title: { name: "T3", providersJson: null },
		});
	});

	it("requires auth (no token)", async () => {
		const app = buildTestApp(calendarRouter, { withAuth: false });
		const r = await request(app)
			.get("/?from=2025-10-01&to=2025-10-31&type=streaming&region=US&limit=10")
		expect(r.status).toBe(401);
		expect((r.body as { error?: { code?: string } }).error?.code).toBe("AUTH_MISSING");
	});

	it("returns provider badges, supports providerIds filter, and paginates with cursor", async () => {
		const app = buildTestApp(calendarRouter, { withAuth: true });

		const r1 = await request(app)
			.get("/?from=2025-10-01&to=2025-10-31&type=streaming&region=US&limit=2")
			.set("Authorization", "Bearer test");
		expect(r1.status).toBe(200);
		const body1 = r1.body as CalendarResponse;
		expect(Array.isArray(body1.items)).toBe(true);
		expect(body1.items).toHaveLength(2);
		expect(typeof body1.nextCursor === "string" || body1.nextCursor === null).toBe(true);
		
		const firstProviders = body1.items[0]?.providers ?? [];
		const providerIds = firstProviders.map((p) => p.id);
		expect(providerIds.length).toBeGreaterThan(0);

		const cursor = body1.nextCursor!;
		const r2 = await request(app)
			.get(
				`/?from=2025-10-01&to=2025-10-31&type=streaming&region=US&limit=2&cursor=${encodeURIComponent(cursor)}`
			)
			.set("Authorization", "Bearer test");
		expect(r2.status).toBe(200);
		const body2 = r2.body as CalendarResponse;
		expect(body2.items.length).toBe(1); // 3 total; 2 then 1

		// providerIds filter (Netflix id=8)
		const r3 = await request(app)
			.get(
				"/?from=2025-10-01&to=2025-10-31&type=streaming&region=US&providerIds=8&limit=10"
			)
			.set("Authorization", "Bearer test");
		expect(r3.status).toBe(200);
		const body3 = r3.body as CalendarResponse;
		const gotIds = body3.items.map((x) => x.titleId).sort();
		expect(gotIds).toEqual([1, 3]);
	});
});