import { Router } from "express";
import { z } from 'zod';
import { prisma } from '../../db/client';
import {
	CalendarQuerySchema,
	DEFAULT_REGION,
	TMDB_API_KEY,
	TTLCache,
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
	extractProviderIdsFromProvidersJson,
} from "./helpers";

import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validate, getValidated } from '../../middleware/validate';

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

// --- Provider directory cache (24h) ---
const providerDirCache = new TTLCache<Map<number, ProviderInfo>>(24 * 60 * 60 * 1000);

async function getProviderDirectory(): Promise<Map<number, ProviderInfo>> {
	const cacheKey = "tmdb:providerDir";
	const hit = providerDirCache.get(cacheKey);
	if (hit) return hit;

	// Use the "watch/providers/movie" endpoint as a directory for IDs -> names/logos
	const url = new URL("https://api.themoviedb.org/3/watch/providers/movie");
	url.searchParams.set("api_key", TMDB_API_KEY!);
	url.searchParams.set("watch_region", DEFAULT_REGION);

	const res = await fetch(url.toString());
	if (!res.ok) {
		const t = await res.text().catch(() => "");
		throw new Error(`TMDB providers ${res.status}: ${t || res.statusText}`);
	}
	const json = await res.json();
	const map = new Map<number, ProviderInfo>();
	for (const p of json.results as Array<{ provider_id: number; provider_name: string; logo_path?: string }>) {
		map.set(p.provider_id, {
			id: p.provider_id,
			name: p.provider_name,
			slug: toSlug(p.provider_name),
			logoPath: p.logo_path || null,
		});
	}
	providerDirCache.set(cacheKey, map);
	return map;
}

// --- Repo hooks (wire to Prisma/your data). For now, a placeholder returning an empty list. ---
// Expected output shape from your data layer BEFORE provider mapping:
type RawCal = {
	titleId: number;
	title: string;
	type: ReleaseType;
	date: string; // YYYY-MM-DD
	region: string;
	providerIds?: number[]; // for streaming/digital; may be empty/undefined for theatrical
};

// Replace this with a Prisma query pulling releases in [from,to] for the user's watchlist.
async function fetchUserCalendarRaw(
	userId: number,
	args: { from?: Date; to?: Date; type?: ReleaseType; region: string }
): Promise<RawCal[]> {
	// Build where clause for ReleaseEvent
	const where: any = {
		// Only titles the user follows
		title: {
			watchlist: {
				some: { userId },
			},
		},
		// Region filter (= ReleaseEvent.country). If null in DB, we let it pass only when no region set.
		// Since your API always provides a region, we match exact code.
		country: args.region,
	};

	// Date range
	if (args.from || args.to) {
		where.date = {};
		if (args.from) where.date.gte = args.from;
		if (args.to) where.date.lte = args.to;
	}

	// Type filter (map API -> DB enum)
	if (args.type) {
		where.type = apiToDbReleaseType(args.type);
	} else {
		// restrict to the three user-facing types (omit PHYSICAL)
		where.type = { in: ["THEATRICAL", "DIGITAL", "STREAMING"] };
	}

	// Query: pull ReleaseEvents joined with Title (for name + providersJson)
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
					providersJson: true,
				},
			},
		},
	});

	// Map to RawCal[]
	const out: RawCal[] = [];

	for (const r of rows) {
		const apiType = dbToApiReleaseType(r.type as any);
        if (!apiType) continue; // skip PHYSICAL

        const yyyyMmDd = r.date.toISOString().slice(0, 10);

        // Provider IDs only for streaming/digital
        let providerIds: number[] = [];
        if (apiType === "streaming" || apiType === "digital") {
            providerIds = extractProviderIdsFromProvidersJson(r.title.providersJson, args.region) ?? [];
        }

        // Build base object and only include providerIds if non-empty
        const base = {
            titleId: r.titleId,
            title: r.title.name,
            type: apiType,
            date: yyyyMmDd,
            region: r.country ?? args.region,
        };

        const rc: RawCal = {
            ...base,
            ...(providerIds.length > 0 ? { providerIds } : {}),
        };

        out.push(rc);
	}

	return out;
}

const router = Router();

router.get(
    "/",
    requireAuth,
    validate('query', CalendarQuerySchema),
    asyncHandler(async (req: any, res) => {
        const userId: number = req.user.id;

		const { from, to, limit, type, providerIds, region, cursor } = getValidated<z.infer<typeof CalendarQuerySchema>>(req, 'query');
		const filterProviderIds = parseProviderIds(providerIds);

        const base = {
            from,
            region
        }
        
        // only include to and type if they are defined
        const args = {
            ...base,
            ...(to ? { to } : {}),
            ...(type ? { type } : {}),
        };

		// Load raw calendar rows
		const raw = await fetchUserCalendarRaw(userId, args);

		// Provider mapping (only if providerIds present on the row)
		const dir = await getProviderDirectory();
		function mapProviders(ids?: number[]): ProviderInfo[] | undefined {
			if (!ids || ids.length === 0) return undefined;
			const infos: ProviderInfo[] = [];
			for (const id of ids) {
				const p = dir.get(id);
				if (p) infos.push(p);
			}
			return infos.length ? infos : undefined;
		}

		let items: CalendarItem[] = raw.map((r) => ({
			id: deterministicId([r.titleId, r.date, r.type, r.region, (r.providerIds || []).join("-")]),
			titleId: r.titleId,
			title: r.title,
			type: r.type,
			date: r.date,
			providers: mapProviders(r.providerIds),
			region: r.region,
		} as CalendarItem));

		// Provider filtering (applies to streaming/digital rows with providers)
		if (filterProviderIds.length > 0) {
			const wanted = new Set(filterProviderIds);
			items = items.filter((it) => {
				if (!it.providers || it.providers.length === 0) return false;
				return it.providers.some((p) => wanted.has(p.id));
			});
		}

		// Sort for stable cursoring: date ASC, titleId ASC, type ASC
		items.sort((a, b) => {
			const ak = cursorKey(a.date, a.titleId, a.type);
			const bk = cursorKey(b.date, b.titleId, b.type);
			return cmpCursorKey(ak, bk);
		});

		// Cursor pagination (stateless)
		const startKey = decodeCursor(cursor)?.k;
		let startIdx = 0;
		if (startKey) {
			// find first item strictly greater than cursor key
			startIdx = items.findIndex((it) => cmpCursorKey(cursorKey(it.date, it.titleId, it.type), startKey) > 0);
			if (startIdx < 0) startIdx = items.length; // cursor beyond end
		}

		const page = items.slice(startIdx, startIdx + limit + 1);
		let nextCursor: string | null = null;
        let pageItems = page;

        if (page.length > limit) {
            const lastIdx = Math.min(limit - 1, page.length - 1);
            const last = page[lastIdx];
            if (last) {
                nextCursor = encodeCursor({ k: cursorKey(last.date, last.titleId, last.type) });
            }
            pageItems = page.slice(0, limit);
        }

		const resp: CalendarResponse = {
			items: pageItems,
			nextCursor,
		};
		return res.json(resp);
    })
);

export default router;