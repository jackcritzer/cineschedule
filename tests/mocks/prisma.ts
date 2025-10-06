type ReleaseEventRow = {
    titleId: number;
    date: Date;
    type: "THEATRICAL" | "DIGITAL" | "STREAMING" | "PHYSICAL";
    country: string | null;
    title: { name: string; providersJson: unknown; networksJson?: unknown };
};

type TitleRow = { 
					id: number; 
					tmdbId: number; 
					type: "MOVIE" | "TV";
					createdAt?: Date;
					name?: string; 
					releaseDate?: Date | null; 
					posterPath?: string | null; 
					overview?: string | null; 
					providersJson?: unknown;
				 };

type WatchlistRow = { 
						id: number; 
						userId: number; 
						titleId: number; 
						createdAt: Date
					};

let _releaseEvents: ReleaseEventRow[] = [];
let _titles: TitleRow[] = [];
let _watchlist: WatchlistRow[] = [];
let _titleIdSeq = 100;
let _watchlistIdSeq = 1000;

export const __seed = {
    reset() {
        _releaseEvents = [];
        _titles = [];
        _watchlist = [];
        _titleIdSeq = 100;
        _watchlistIdSeq = 1000;
    },
    addTitle(t: { id: number; tmdbId: number; type: "MOVIE" | "TV"; name?: string; providersJson?: unknown; createdAt?: Date }) {
        _titles.push({ id: t.id, tmdbId: t.tmdbId, type: t.type, createdAt: t.createdAt ?? new Date(), name: t.name ?? `T${t.id}`, providersJson: t.providersJson ?? null, releaseDate: null, posterPath: null, overview: null });
        _titleIdSeq = Math.max(_titleIdSeq, t.id + 1);
    },
    addReleaseEvent(r: ReleaseEventRow) {
        _releaseEvents.push(r);
    },
    addWatchlist(w: { id: number; userId: number; titleId: number; createdAt?: Date }) {
        _watchlist.push({ id: w.id, userId: w.userId, titleId: w.titleId, createdAt: w.createdAt ?? new Date() });
        _watchlistIdSeq = Math.max(_watchlistIdSeq, w.id + 1);
    },
};

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
}

export const prisma = {
    title: {
        // Supports:
        // - take: number (+1 pattern)
        // - skip: 1 (when cursor used)
        // - cursor: { id }
        // - orderBy: { id: 'asc' }
        // - select: subset of fields
        // - where.id.in (used in some v2 helpers)
        // - where.OR [{ tmdbId,type }, ...] (v2 search)
        async findMany(args: {
            take?: number;
            skip?: number;
            cursor?: { id: number };
            orderBy?: { id: "asc" | "desc" };
            select?: { 
				id?: boolean; 
				tmdbId?: boolean; 
				type?: boolean; 
				name?: boolean; 
				releaseDate?: boolean; 
				posterPath?: boolean; 
				overview?: boolean; 
				providersJson?: boolean; 
				createdAt?: Date;
				title?: unknown
			 };
            where?: { id?: { in?: number[] } } | { OR?: Array<{ tmdbId: number; type: "MOVIE" | "TV" }> };
        } = {}) {
            let rows = _titles.slice();

            // where.id.in
            if ("where" in (args || {}) && (args as any).where?.id?.in) {
                const ids = (args as any).where.id.in as number[];
                rows = rows.filter((t) => ids.includes(t.id));
            }

            // where.OR on (tmdbId,type)
            if ("where" in (args || {}) && (args as any).where?.OR) {
                const OR = (args as any).where.OR as Array<{ tmdbId: number; type: "MOVIE" | "TV" }>;
                const pairs = new Set(OR.map((o) => `${o.type}:${o.tmdbId}`));
                rows = rows.filter((t) => pairs.has(`${t.type}:${t.tmdbId}`));
            }

            // order
            const dir = args.orderBy?.id === "desc" ? -1 : 1;
            rows.sort((a, b) => (a.id - b.id) * dir);

            // cursor
            /* if (args.cursor?.id) {
                const idx = rows.findIndex((r) => r.id === args.cursor!.id);
                if (idx >= 0) rows = rows.slice(idx + (args.skip ?? 0));
            } */

            if (args.cursor?.id !== undefined) {
                const idx = rows.findIndex((r) => r.id === args.cursor!.id);
                if (idx >= 0) {
                    rows = rows.slice(idx + 1);
                    // we intentionally ignore args.skip here to keep semantics stable
                }
                // if cursor not found, return rows as-is (acts like from the beginning)
            }

            // take
            if (typeof args.take === "number") rows = rows.slice(0, args.take);

            // select projection
            if (args.select) {
                const sel = args.select as Record<string, boolean>;
                return rows.map((t) => {
                    const out: Record<string, unknown> = {};
                    for (const [k, v] of Object.entries(sel)) {
                        if (!v) continue;
                        (out as any)[k] = (t as any)[k];
                    }
                    return clone(out);
                });
            }


            return clone(rows);
        },

        async findUnique(args: { where: { id: number } }) {
            const t = _titles.find((x) => x.id === args.where.id);
            return t ? clone(t) : null;
        },

        async upsert(args: {
            where: { tmdbId_type: { tmdbId: number; type: "MOVIE" | "TV" } };
            create: Omit<TitleRow, "id"> & { tmdbId: number; type: "MOVIE" | "TV" };
            update: Partial<TitleRow>;
        }) {
            const { tmdbId, type } = args.where.tmdbId_type;
            let t = _titles.find((x) => x.tmdbId === tmdbId && x.type === type);
            if (!t) {
                t = {
                    id: _titleIdSeq++,
                    tmdbId,
                    type,
                    name: args.create.name ?? `T${_titleIdSeq}`,
                    releaseDate: args.create.releaseDate ?? null,
                    posterPath: args.create.posterPath ?? null,
                    overview: args.create.overview ?? null,
                    providersJson: args.create.providersJson ?? null,
                };
                _titles.push(t);
            } else {
                Object.assign(t, args.update);
            }
            return clone(t);
        },

        async update(args: { where: { id: number }; data: Partial<TitleRow> }) {
            const t = _titles.find((x) => x.id === args.where.id);
            if (!t) throw new Error("Title not found");
            Object.assign(t, args.data);
            return clone(t);
        },
    },

    releaseEvent: {
        async findMany(args: {
            where?: {
                title?: { watchlist?: { some?: { userId?: number } } };
                country?: string;
                type?: { in?: Array<ReleaseEventRow["type"]> } | ReleaseEventRow["type"];
                date?: { gte?: Date; lte?: Date };
            };
            orderBy?: Array<Record<string, "asc" | "desc">>;
            select?: any;
        }) {
            const where = args?.where ?? {};
            let rows = _releaseEvents.slice();

            const wlUserId = where.title?.watchlist?.some?.userId;
            if (wlUserId) {
                const userTitleIds = new Set(_watchlist.filter((w) => w.userId === wlUserId).map((w) => w.titleId));
                rows = rows.filter((r) => userTitleIds.has(r.titleId));
            }
            if (where.country) rows = rows.filter((r) => r.country === where.country);

            if (where.type) {
                const wt = where.type as { in?: Array<ReleaseEventRow["type"]> } | ReleaseEventRow["type"];
                let allowed: Array<ReleaseEventRow["type"]>;
                if (typeof wt === "object" && wt !== null && "in" in wt) {
                    allowed = wt.in ?? [];
                } else {
                    allowed = [wt as ReleaseEventRow["type"]];
                }
                const set = new Set<ReleaseEventRow["type"]>(allowed);
                rows = rows.filter((r) => set.has(r.type));
            }

            if (where.date) {
                const { gte, lte } = where.date;
                if (gte) rows = rows.filter((r) => r.date >= gte);
                if (lte) rows = rows.filter((r) => r.date <= lte);
            }

            rows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.titleId - b.titleId);

            // emulate select shape used by v2 calendar
            if (args.select) {
                return rows.map((r) => ({
                    titleId: r.titleId,
                    date: r.date,
                    type: r.type,
                    country: r.country,
                    title: {
                        name: _titles.find((t) => t.id === r.titleId)?.name ?? r.title.name,
                        providersJson: _titles.find((t) => t.id === r.titleId)?.providersJson ?? r.title.providersJson ?? null,
                    },
                }));
            }

            return clone(rows);
        },
    },

    watchlist: {
        // Supports:
        // - where: { userId }
        // - take, cursor, skip, orderBy
        // - select: { id, createdAt, title: { select: { ... } } }
        async findMany(args: {
            where?: { userId?: number; titleId?: { in?: number[] } };
            take?: number;
            skip?: number;
            cursor?: { id: number };
            orderBy?: { id: "asc" | "desc" };
            select?: {
                id?: boolean;
                createdAt?: boolean;
                title?: { select: { id?: boolean; tmdbId?: boolean; type?: boolean; name?: boolean; posterPath?: boolean; releaseDate?: boolean } };
            };
        } = {}) {
            let rows = _watchlist.slice();

            if (args.where?.userId) {
                rows = rows.filter((w) => w.userId === args.where!.userId);
            }

            if (args.where?.titleId?.in) {
                const ids = args.where.titleId.in;
                rows = rows.filter((w) => ids.includes(w.titleId));
            }

            const dir = args.orderBy?.id === "desc" ? -1 : 1;
            rows.sort((a, b) => (a.id - b.id) * dir);

            if (args.cursor?.id) {
                const idx = rows.findIndex((r) => r.id === args.cursor!.id);
                if (idx >= 0) rows = rows.slice(idx + (args.skip ?? 0));
            }

            if (typeof args.take === "number") rows = rows.slice(0, args.take);

            if (args.select) {
                return rows.map((w) => {
                    const out: any = {};
                    if (args.select!.id) out.id = w.id;
                    if (args.select!.createdAt) out.createdAt = w.createdAt.toISOString();
                    if (args.select!.title?.select) {
                        const t = _titles.find((x) => x.id === w.titleId)!;
                        const ts: any = {};
                        for (const [k, v] of Object.entries(args.select!.title.select)) {
                            if (!v) continue;
                            (ts as any)[k] = (t as any)[k];
                        }
                        out.title = ts;
                    }
                    return out;
                });
            }

            return clone(rows);
        },

        // Supports where: { userId_titleId: { userId, titleId } } or { id }
        async findUnique(args: { where: { userId_titleId?: { userId: number; titleId: number }; id?: number } }) {
            if (args.where.userId_titleId) {
                const { userId, titleId } = args.where.userId_titleId;
                const w = _watchlist.find((x) => x.userId === userId && x.titleId === titleId);
                return w ? clone(w) : null;
            }
            if (typeof args.where.id === "number") {
                const w = _watchlist.find((x) => x.id === args.where.id);
                return w ? clone(w) : null;
            }
            return null;
        },

        async create(args: { data: { userId: number; titleId: number } }) {
            const w: WatchlistRow = { id: _watchlistIdSeq++, userId: args.data.userId, titleId: args.data.titleId, createdAt: new Date() };
            _watchlist.push(w);
            return clone(w);
        },

        async delete(args: { where: { id: number } }) {
            const idx = _watchlist.findIndex((x) => x.id === args.where.id);
            if (idx >= 0) _watchlist.splice(idx, 1);
            return { ok: true };
        },
    },
};