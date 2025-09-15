import cron from 'node-cron';
import { PrismaClient, TitleType } from '@prisma/client';

import { refreshMaybe } from './refreshMaybe';

const prisma = new PrismaClient();

const CRON_ENABLED = process.env.CRON_ENABLED === '1';
const CRON_SCHEDULE = process.env.CRON_SCHEDULE?.replace(/^"|"$/g, '') || '0 3 * * *'; // default
const CRON_TZ = process.env.CRON_TZ?.replace(/^"|"$/g, '') || 'UTC';
const REFRESH_CONCURRENCY = Number(process.env.REFRESH_CONCURRENCY || 5);

// Advisory lock keys (int,int). Keep stable across deployments.
const LOCK_K1 = 42142;
const LOCK_K2 = 91717;

type TitleRow = { id: number; type: 'MOVIE' | 'TV'; name: string | null };

async function tryAcquireLock(): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_lock(${LOCK_K1}::int, ${LOCK_K2}::int) AS acquired    
    `;
    return !!rows[0]?.acquired;
}

async function releaseLock(): Promise<void> {
    await prisma.$executeRaw`
        SELECT pg_advisory_unlock(${LOCK_K1}::int, ${LOCK_K2}::int)
    `
}

async function getWatchlistedTitles(): Promise<TitleRow[]> {
    // Only refresh titles on at least one user's watchlist
    const ids = await prisma.$queryRaw<{ titleId: number }[]>`
        SELECT DISTINCT "titleId" FROM "Watchlist"
    `;

    const titleIds = ids.map(r => r.titleId);
    if (titleIds.length === 0) return [];

    const titles = await prisma.title.findMany({
        where: { id: { in: titleIds } },
        select: { id: true, type: true, name: true, lastRefreshedAt: true }
    });

    // Force type to 'MOVIE' | 'TV'
    return titles.map(t => ({ id: t.id, type: (t.type as any) as 'MOVIE' | 'TV', name: t.name }));
}


async function runPool<T>(
    items: T[],
    worker: (item: T) => Promise<void>,
    concurrency: number,
    onProgress?: (done: number, total: number) => void
) {
    let i = 0;
    let done = 0;
    const total = items.length;

    async function next(): Promise<void> {
        const idx = i++;
        if (idx >= total || !items[idx]) return;
        try {
            await worker(items[idx]);
        } finally {
            done += 1;
            onProgress?.(done, total);
            await next();
        }
    }

    const starters = Array.from({ length: Math.min(concurrency, total) }, () => next());
    await Promise.all(starters);
}

const NIGHTLY_MIN_FRESH_MS = Number(process.env.NIGHTLY_MIN_FRESH_MS ?? 86_400_000); // 24h default
const NIGHTLY_UPCOMING_DAYS = Number(process.env.NIGHTLY_UPCOMING_DAYS ?? 0);       // 0 = disabled

async function hasUpcomingWithin(titleId: number, type: TitleType, days: number) {
    if (!days || days <= 0) return false;
    const now = new Date();
    const soon = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    if (type === 'MOVIE') {
        return !!(
            await prisma.releaseEvent.findFirst({
                where: { titleId, date: { gte: now, lte: soon } },
                select: { id: true },
            })
        )
    } else {
        return !!(
            await prisma.episode.findFirst({
                where: { titleId, airDate: { gte: now, lte: soon } },
                select: { id: true },
            })
        )
    }
}

export type RefreshSummary = {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    total: number;
    ok: number;
    failed: number;
    retried: number; // count of tasks that needed >=1 retry
    skipped: boolean;
    reason?: string;
    details?: Array<{ id: number; type: 'MOVIE' | 'TV'; name: string | null; ok: boolean; attempts: number; error?: string | null }>;
};

/**
 *
 */
export async function runNightlyRefresh(): Promise<RefreshSummary> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();

    const gotLock = await tryAcquireLock();
    if (!gotLock) {
        const finishedAt = new Date().toISOString();
        return {
            startedAt,
            finishedAt,
            durationMs: Date.now() - started,
            total: 0,
            ok: 0,
            failed: 0,
            retried: 0,
            skipped: true,
            reason: 'Another instance holds the advisory lock.',
        }
    }

    const details: RefreshSummary['details'] = [];
    const retried = 0;

    try {
        const titles = await getWatchlistedTitles();
        if (titles.length === 0) {
            const finishedAt = new Date().toISOString();
            return {
                startedAt,
                finishedAt,
                durationMs: Date.now() - started,
                total: 0,
                ok: 0,
                failed: 0,
                retried: 0,
                skipped: false,
            };
        }

        let ok = 0;
        let failed = 0;

        await runPool(
            titles,
            async (t) => {
                const forceNearAir = await hasUpcomingWithin(t.id, t.type, NIGHTLY_UPCOMING_DAYS);
                const res = await refreshMaybe(t as any, {
                    enabled: true,
                    minAgeMs: NIGHTLY_MIN_FRESH_MS,
                    force: forceNearAir,
                    reason: forceNearAir ? 'nightly-near-air' : 'nightly',
                });

                if (!res.ok) failed += 1;
                else if (!res.skipped) ok += 1;       // count only real refreshes as ok
                else /* skipped */ ok += 1;           // or treat skip as ok; up to you

                details?.push({
                    id: t.id,
                    type: t.type as any,
                    name: t.name ?? null,
                    ok: !!res.ok,
                    attempts: 1,
                    error: res.reason ?? null,
                });
            },
            REFRESH_CONCURRENCY,
            (done, total) => {
                if (done % Math.max(1, Math.floor(total / 10)) === 0 || done === total) {
                    //console.log(`[refreshNightly] Progress: ${done}/${total}`);
                }
            }
        );

        const finishedAt = new Date().toISOString();
        return {
            startedAt,
            finishedAt,
            durationMs: Date.now() - started,
            total: titles.length,
            ok,
            failed,
            retried,
            skipped: false,
            details,
        };
    } finally {
        await releaseLock();
    }
}

// Schedule on process start (called from server entry)
/**
 *
 */
export function scheduleNightlyRefresh() {
    if (!CRON_ENABLED) {
        console.log('[refreshNightly] CRON_ENABLED!=1; scheduler disabled.');
        return;
    }

    if (!cron.validate(CRON_SCHEDULE)) {
        console.warn(`[refreshNightly] Invalid CRON_SCHEDULE="${CRON_SCHEDULE}". Scheduler not started.`);
        return;
    }
    
    cron.schedule(
        CRON_SCHEDULE,
        async () => {
            console.log(`[refreshNightly] Starting scheduled run @ ${new Date().toISOString()}`);
            try {
                const summary = await runNightlyRefresh();
                console.log('[refreshNightly] Summary:', {
                    total: summary.total,
                    ok: summary.ok,
                    failed: summary.failed,
                    retried: summary.retried,
                    durationMs: summary.durationMs,
                    skipped: summary.skipped,
                    reason: summary.reason,
                });
            } catch (err) {
                console.error('[refreshNightly] Unhandled error:', err);
            } finally {
                console.log(`[refreshNightly] Finished @ ${new Date().toISOString()}`);
            }
        },
        { timezone: CRON_TZ }
    );

    console.log(`[refreshNightly] Scheduled: "${CRON_SCHEDULE}" TZ="${CRON_TZ}"`);
}

// CLI: run once with `--once`
if (process.argv.includes('--once')) {
    (async () => {
        try {
            const summary = await runNightlyRefresh();

            const secs = (summary.durationMs / 1000).toFixed(1);
            if (summary.skipped) {
                console.log(
                    `[refreshNightly] Skipped (lock not acquired). Duration ${secs}s. Reason: ${summary.reason}`
                );
            } else {
                console.log(
                    `[refreshNightly] Done in ${secs}s → total=${summary.total}, ok=${summary.ok}, failed=${summary.failed}, retried=${summary.retried}`
                );
            }
        } catch (err) {
            console.error('[refreshNightly] Failed:', err);
            process.exitCode = 1;
        } finally {
            // Ensure Prisma disconnects when run via CLI
            await prisma.$disconnect();
        }
    })();
}


