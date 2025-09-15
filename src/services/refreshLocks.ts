import { TitleType } from '@prisma/client';

import { prisma } from '../db/client';

const LOCK_NS = 42_100;

/**
 *
 */
export async function withTitleLock(titleId: number, fn: () => Promise<
        {
            kind: string; insertedOrUpdated: number // refreshMovie output
        } | 
        { 
            kind: TitleType; reason?: string; status?: string; upserted?: number; season?: number; //refreshTv output
        }
    >) {
    const acquired = await prisma.$queryRaw<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_lock(${LOCK_NS}::int, ${titleId}::int) AS acquired
    `;
    if (!acquired[0]?.acquired) return { ok: false, reason: 'lock-not-acquired' };
    try {
        const result = await fn();
        return { ok: true, result };
    } finally {
        await prisma.$executeRaw`SELECT pg_advisory_unlock(${LOCK_NS}::int, ${titleId}::int)`;
    }
}