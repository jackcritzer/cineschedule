import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';

import { refreshMovie, refreshTv } from './refresh';

const prisma = new PrismaClient();

const CRON_ENABLED = process.env.CRON_ENABLED === '1';
const CRON_SCHEDULE = process.env.CRON_SCHEDULE?.replace(/^"|"$/g, '') || '0 3 * * *'; // default
const CRON_TZ = process.env.CRON_TZ?.replace(/^"|"$/g, '') || 'UTC';
const REFRESH_CONCURRENCY = Number(process.env.REFRESH_CONCURRENCY || 5);

// Advisory lock keys (int,int). Keep stable across deployments.
const LOCK_K1 = 42142;
const LOCK_K2 = 91717;

// Retry policy
const MAX_RETRIES = 4;              // total attempts = 1 + MAX_RETRIES
const BASE_BACKOFF_MS = 500;        // initial backoff before jitter/exponent
const MAX_BACKOFF_MS = 30_000;

type TitleRow = { id: number; type: 'MOVIE' | 'TV'; name: string | null };

function sleep(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
}

function backOffDelay(attempt: number) {
    const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(MAX_BACKOFF_MS, exp + jitter);
}

function isTransient(err: any): boolean {
    const status = err?.status ?? err?.response?.status;
    if (typeof status === 'number') {
        if (status === 429) return true;
        if (status >= 500) return true;
    }
    const code = err?.code;
    if (code && ['ETIMEOUT', 'ECONNRESET', 'EAI_AGAIN', 'ECONNABORTED'].includes(code)) return true;
    return false;
}

async function withRetry<T>(fn: () => Promise<T>) {
    let attempt = 1;
    for (;;) {
        try {
            return await fn();
        } catch (err: any) {
            if (attempt > MAX_RETRIES || !isTransient(err)) throw err;
            const delay = backOffDelay(attempt);
            await sleep(delay);
            attempt += 1;
        }
    }
}

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
        select: { id: true, type: true, name: true }
    });

    // Force type to 'MOVIE' | 'TV'
    return titles.map(t => ({ id: t.id, type: (t.type as any) as 'MOVIE' | 'TV', name: t.name }));
}

async function refreshOne(title: TitleRow): Promise<void> {
    if (title.type === 'MOVIE') {
        await withRetry(() => refreshMovie(title.id));
    } else {
        await withRetry(() => refreshTv(title.id));
    }
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
    details?: Array<{ id: number; type: 'MOVIE' | 'TV'; name: string | null; ok: boolean; attempts: number; error?: string }>;
};

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
    let retried = 0;

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
                let attempts = 0;
                const doOne = async () => {
                    attempts += 1;
                    await refreshOne(t);
                };

                try {
                    await withRetry(doOne);
                    ok += 1;
                    if (attempts > 1) retried += 1;
                    details?.push({ id: t.id, type: t.type, name: t.name, ok: true, attempts });
                } catch (err: any) {
                    failed += 1;
                    const msg = err?.message || String(err);
                    details?.push({ id: t.id, type: t.type, name: t.name, ok: false, attempts, error: msg });
                }
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


