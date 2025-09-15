// src/services/refreshMaybe.ts
import { Title, TitleType } from '@prisma/client';
import { refreshMovie, refreshTv } from './refresh';
import { withTitleLock } from './refreshLocks';

type RefreshOpts = {
  enabled?: boolean;       // gate by env
  minAgeMs?: number;       // freshness window (default 24h)
  force?: boolean;         // ignore freshness
  reason?: string;         // for logs
};

/**
 *
 */
export async function refreshMaybe(
    title: Pick<Title, 'id'|'type'|'name'|'lastRefreshedAt'>, 
    opts: RefreshOpts = {}
) {
    const {
        enabled = true,
        minAgeMs = 24 * 60 * 60 * 1000,
        force = false,
        reason = 'default',
    } = opts;

    if (!enabled) return { ok: true, skipped: true, reason: 'disabled' };

    const last = title.lastRefreshedAt ? new Date(title.lastRefreshedAt).getTime() : 0;
    const isFresh = !force && last > 0 && (Date.now() - last) < minAgeMs;

    if (isFresh) {
        return { ok: true, skipped: true, reason: `fresh < ${minAgeMs}ms (${reason})` };
    }

    const locked = await withTitleLock(title.id, async () => {
        // Another request might have just refreshed while we waited; re-check freshness.
        // (Optional micro-optimization: re-read lastRefreshedAt here.)
        if (title.type === TitleType.MOVIE) return await refreshMovie(title.id);
        return await refreshTv(title.id);
    });

    if (!locked.ok) return { ok: true, skipped: true, reason: locked.reason }; // someone else is refreshing now
    return { ok: true, skipped: false };
}
