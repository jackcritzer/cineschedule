import crypto from "crypto";
import { z } from "zod";

import { ReleaseType, TitleType } from "@prisma/client";

import { ApiTitleType, ApiReleaseType } from "../../types/search";

export const DEFAULT_REGION = (process.env.DEFAULT_REGION || "US").toUpperCase();
export const TMDB_API_KEY = process.env.TMDB_API_KEY;

if (!TMDB_API_KEY) {
	throw new Error("TMDB_API_KEY env not set");
}

/**
 *
 */
export function deterministicId(parts: Array<string | number | null | undefined>): string {
	const s = parts.filter((p) => p !== null && p !== undefined).join("|");
	// compact, stable id
	return crypto.createHash("sha1").update(s).digest("base64url").slice(0, 16);
}

/**
 *
 */
export function toSlug(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 *
 */
export function parseProviderIds(csv?: string | string[]): number[] {
	if (!csv) return [];
	const raw = Array.isArray(csv) ? csv.join(",") : csv;
	return raw
		.split(",")
		.map((x) => x.trim())
		.filter(Boolean)
		.map((x) => Number(x))
		.filter((n) => Number.isFinite(n));
}

/**
 *
 */
export function safeISODate(d?: string): string | undefined {
	if (!d) return undefined;
	// Accept YYYY-MM-DD only (no times)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return undefined;
	return d;
}

// --- Cursor helpers (simple, stateless) ---
type CursorShape = { k: string }; // k = `${date}|${titleId}|${type}`
/**
 *
 */
export function encodeCursor(obj: CursorShape): string {
	return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
/**
 *
 */
export function decodeCursor(s?: string): CursorShape | undefined {
	if (!s) return undefined;
	try {
		return JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
	} catch {
		return undefined;
	}
}

/**
 *
 */
export function cursorKey(date: string, titleId: number, type: ApiReleaseType | undefined): string {
	let key = `${date}|${titleId}}`;
	if (type) key += `|${type}`
	return key;
}

/**
 *
 */
export function cmpCursorKey(a: string, b: string): number {
	// Expected format: YYYY-MM-DD|<titleId>|<type>
	const [ad = "", aidStr = "", at = ""] = a.split("|");
	const [bd = "", bidStr = "", bt = ""] = b.split("|");

	// Compare date (string compare works with YYYY-MM-DD)
	if (ad !== bd) return ad < bd ? -1 : 1;

	// Compare numeric titleId
	const aid = Number.parseInt(aidStr, 10);
	const bid = Number.parseInt(bidStr, 10);
	const aidOk = Number.isFinite(aid);
	const bidOk = Number.isFinite(bid);

	if (aidOk && bidOk && aid !== bid) return aid < bid ? -1 : 1;
	if (aidOk !== bidOk) {
		// If only one is valid, put valid first
		return aidOk ? -1 : 1;
	}

	// Compare type as a final tiebreaker
	if (at !== bt) return at < bt ? -1 : 1;

	// As a last resort (unexpected format), fallback to full key compare
	return a.localeCompare(b);
}


const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const isValidYMD = (s: string) => {
    if (!dateRe.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const todayYMD = () => new Date().toISOString().slice(0, 10);

// Coerce YYYY-MM-DD -> Date at 00:00:00.000Z
const ymdToStartOfDay = z
    .string()
    .refine((s) => dateRe.test(s) && isValidYMD(s), { message: 'must be a valid YYYY-MM-DD' })
    .transform((s) => new Date(`${s}T00:00:00Z`));

// Coerce YYYY-MM-DD -> Date at 23:59:59.999Z
const ymdToEndOfDay = z
    .string()
    .refine((s) => dateRe.test(s) && isValidYMD(s), { message: 'must be a valid YYYY-MM-DD' })
    .transform((s) => new Date(`${s}T23:59:59.999Z`));

// === DB <-> API ReleaseType bridges ===
// Prisma enum: ReleaseType = THEATRICAL | DIGITAL | STREAMING | PHYSICAL
/**
 *
 */
export function apiToDbReleaseType(t: ApiReleaseType): ReleaseType {
	switch (t) {
		case "theatrical": return "THEATRICAL";
		case "digital":    return "DIGITAL";
		case "streaming":  return "STREAMING";
	}
}

/**
 *
 */
export function dbToApiReleaseType(t: ReleaseType): ApiReleaseType | undefined {
	switch (t) {
		case "THEATRICAL": return "theatrical";
		case "DIGITAL":    return "digital";
		case "STREAMING":  return "streaming";
		default:           return undefined; // skip PHYSICAL
	}
}

/**
 *
 */
export function titleTypeToAPI(t: TitleType): ApiTitleType {
	return t === "MOVIE" ? "MOVIE" : "TV";
}

/**
 *
 */
export function apiToDbTitleType(t: ApiTitleType): TitleType {
	return t === "MOVIE" ? "MOVIE" : "TV";
}

// === Provider extraction from Title.providersJson ===
// We store TMDB "watch/providers" payload (or a subset). We only need provider IDs.
// Typical TMDB shape: { results: { US: { flatrate: [{ provider_id, ... }], rent: [...], buy: [...] } } }
/**
 *
 */
export function extractProviderIdsFromProvidersJson(json: unknown, region: string): number[] {
	try {
		const r = (json as any)?.results?.[region];
		if (!r) return [];
		// For streaming/digital we generally care about flatrate; feel free to include rent/buy if desired.
		const arrays = [r.flatrate /*, r.rent, r.buy*/].filter(Boolean) as Array<Array<any>>;
		const ids = new Set<number>();
		for (const arr of arrays) {
			for (const p of arr) {
				const id = Number(p?.provider_id);
				if (Number.isFinite(id)) ids.add(id);
			}
		}
		return Array.from(ids);
	} catch {
		return [];
	}
}

// --- Micro TTL cache (in-memory) ---
export class TTLCache<V> {
	private store = new Map<string, { v: V; exp: number }>();
	/**
	 *
	 */
	constructor(private ttlMs: number) {}
	/**
	 *
	 */
	get(key: string): V | undefined {
		const hit = this.store.get(key);
		if (!hit) return undefined;
		if (Date.now() > hit.exp) {
			this.store.delete(key);
			return undefined;
		}
		return hit.v;
	}
	/**
	 *
	 */
	set(key: string, v: V) {
		this.store.set(key, { v, exp: Date.now() + this.ttlMs });
	}
	/**
	 *
	 */
	key(parts: Array<string | number | undefined>) {
		return parts.filter((p) => p !== undefined).join("|");
	}
}

// --- Zod schemas (lean) ---
export const SearchQuerySchema = z.object({
	query: z.string().trim().min(1),
	page: z.coerce.number().int().min(1).max(100).default(1),
	region: z
		.string()
		.trim()
		.length(2)
		.transform((r) => r.toUpperCase())
		.default(DEFAULT_REGION),
});

export const CalendarQuerySchema = z.object({
	from: z
        .string()
        .optional()
        .default(todayYMD)
        .pipe(ymdToStartOfDay), // => Date
    to: z
        .string()
        .optional()
        .transform((s) => (s === undefined ? undefined : s)) // keep undefined when missing
        .pipe(ymdToEndOfDay.optional()), // => Date | undefined
    limit: z.coerce.number().int().min(1).max(200).default(50),
	type: z.enum(["theatrical", "digital", "streaming"]).optional(),
	providerIds: z.string().optional(), // CSV
	region: z
		.string()
		.trim()
		.length(2)
		.transform((r) => r.toUpperCase())
		.default(DEFAULT_REGION),
	cursor: z.string().optional()
})
.superRefine((val, ctx) => {
    if (val.to && val.from.getTime() > val.to.getTime()) {
        ctx.addIssue({
            code: "custom",
            message: 'to must be on or after from',
            path: ['to'],
        });
    }
});