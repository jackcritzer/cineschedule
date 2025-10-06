import { Router } from "express";
import { z } from "zod";

import {
	CalendarQuerySchema,
	cursorKey,
	decodeCursor,
	deterministicId,
	encodeCursor,
	parseProviderIds,
	toSlug,
	cmpCursorKey,
	type ReleaseType,
	apiToDbReleaseType,
	dbToApiReleaseType,
} from "./helpers";

import { prisma } from "../../db/client";
import { asyncHandler } from "../../middleware/asyncHandler";
import { pickProviderBadges, type Provider as BadgeProvider } from "../../lib/tmdb";
import { requireAuth } from "../../middleware/auth";
import { validate, getValidated } from "../../middleware/validate";

export type ProviderInfo = { id: number; name: string; slug: string; logoPath?: string | null };
export type CalendarItem = {
	id: string;
	titleId: number;
	title: string;
	type: ReleaseType;
	date: string; // YYYY-MM-DD
	providers?: ProviderInfo[];
	region?: string;
};
export type CalendarResponse = { items: CalendarItem[]; nextCursor?: string | null };

type RawCal = {
	titleId: number;
	title: string;
	type: ReleaseType;
	date: string; // YYYY-MM-DD
	region: string;
	// We will derive providers from title.providersJson instead of passing IDs here
};

const router = Router();

// Pull releases in [from,to] for user's watchlist.
// NOTE: We no longer rely on providerIds in the raw row; we compute providers from providersJson below.
async function fetchUserCalendarRaw(
	userId: number,
	args: { from?: Date | undefined; to?: Date | undefined; type?: ReleaseType | undefined; region: string }
): Promise<RawCal[]> {
	const where: any = {
		title: { watchlist: { some: { userId } } },
		country: args.region, // exact ISO-2 match
	};

	if (args.from || args.to) {
		where.date = {};
		if (args.from) where.date.gte = args.from;
		if (args.to) where.date.lte = args.to;
	}

	if (args.type) {
		where.type = apiToDbReleaseType(args.type);
	} else {
		where.type = { in: ["THEATRICAL", "DIGITAL", "STREAMING"] };
	}

	const rows = await prisma.releaseEvent.findMany({
		where,
		orderBy: [{ date: "asc" }, { titleId: "asc" }, { type: "asc" }],
		select: {
			titleId: true,
			date: true,
			type: true,
			country: true,
			title: {
				select: {
					name: true,
					providersJson: true,  // ✅ we’ll derive providers from this
					networksJson: true,   // (kept available if you add “networks” later)
				},
			},
		},
	});

	const out: RawCal[] = [];
	for (const r of rows) {
		const apiType = dbToApiReleaseType(r.type as any);
		if (!apiType) continue; // skip PHYSICAL

		out.push({
			titleId: r.titleId,
			title: r.title.name,
			type: apiType,
			date: r.date.toISOString().slice(0, 10),
			region: r.country ?? args.region,
		});
	}
	return out;
}

router.get(
    "/",
    requireAuth,
    validate('query', CalendarQuerySchema),
    asyncHandler(async (req: any, res) => {
		const userId: number = req.user.id;

		const { from, to, limit, type, providerIds, region, cursor } = getValidated<z.infer<typeof CalendarQuerySchema>>(req, 'query');

		const filterProviderIds = parseProviderIds(providerIds);

		// Load raw release rows
		const raw = await fetchUserCalendarRaw(userId, { from, to, type, region });

		// Fetch providersJson for all titles in one go to minimize queries
		const titleIds = Array.from(new Set(raw.map((r) => r.titleId)));
		const titleProviders = await prisma.title.findMany({
			where: { id: { in: titleIds } },
			select: { id: true, providersJson: true },
		});
		const providersByTitleId = new Map<number, any>(
			titleProviders.map((t) => [t.id, t.providersJson])
		);

		// Build CalendarItem list using pickProviderBadges()
		function toProviderInfos(badges: BadgeProvider[]): ProviderInfo[] {
			return badges.map((p) => ({
				id: p.id,
				name: p.name,
				slug: toSlug(p.name),
				logoPath: p.logoPath ?? null,
			}));
		}

		let items: CalendarItem[] = raw.map((r) => {
			// Only attach providers for streaming/digital (as in v2 spec)
			let providers: ProviderInfo[] | undefined = undefined;
			if (r.type === "streaming" || r.type === "digital") {
				const pj = providersByTitleId.get(r.titleId);
				// ✅ Reuse your prioritization (flatrate → free → ads → rent → buy), max 4
				const badges = pickProviderBadges(pj, region, 4); // returns {id,name,logoPath}
				if (badges.length) providers = toProviderInfos(badges);
			}

			return {
				id: deterministicId([r.titleId, r.date, r.type, r.region, providers?.map(p => p.id).join("-")]),
				titleId: r.titleId,
				title: r.title,
				type: r.type,
				date: r.date,
				providers,
				region: r.region,
			} as CalendarItem;
		});

		// Provider filtering against selected provider IDs
		if (filterProviderIds.length > 0) {
			const wanted = new Set(filterProviderIds);
			items = items.filter((it) => {
				if (!it.providers || it.providers.length === 0) return false;
				return it.providers.some((p) => wanted.has(p.id));
			});
		}

		// Stable sort for cursoring
		items.sort((a, b) => {
			const ak = cursorKey(a.date, a.titleId, a.type);
			const bk = cursorKey(b.date, b.titleId, b.type);
			return cmpCursorKey(ak, bk);
		});

		// Cursor pagination (stateless)
		const startKey = decodeCursor(cursor)?.k;
		let startIdx = 0;
		if (startKey) {
			startIdx = items.findIndex((it) => cmpCursorKey(cursorKey(it.date, it.titleId, it.type), startKey) > 0);
			if (startIdx < 0) startIdx = items.length;
		}

		const page = items.slice(startIdx, startIdx + limit + 1);
		let nextCursor: string | null = null;
		let pageItems = page;

		if (page.length > limit) {
			const lastIdx = Math.min(limit - 1, page.length - 1);
			const last = page[lastIdx];
			if (last) nextCursor = encodeCursor({ k: cursorKey(last.date, last.titleId, last.type) });
			pageItems = page.slice(0, limit);
		}

		const resp: CalendarResponse = { items: pageItems, nextCursor };
		return res.json(resp);
	})
);

export default router;