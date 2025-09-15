import { ReleaseType, TitleType, Prisma, Title } from "@prisma/client";

import { prisma } from '../db/client';
import { getMovieReleaseDates, getTvDetails, getTvSeason, getTvContentRatings, getTvWatchProviders } from "../lib/tmdb";

type ReleaseTypeEnum = ReleaseType;

const REFRESH_ON_ADD = (process.env.REFRESH_ON_ADD ?? "1") !== "0";

function startOfTodayUTC() {
  // Normalize to UTC midnight so comparisons are stable
  return new Date(`${new Date().toISOString().slice(0,10)}T00:00:00Z`);
}

// TMDB "type" codes -> our enum (course mapping)
function mapTmdbReleaseType(typeNum: number): ReleaseTypeEnum {
    // 1: Premiere, 2: Theatrical (limited), 3: Theatrical, 4: Digital, 5: Physical, 6: TV
    if (typeNum === 3 || typeNum === 2 || typeNum === 1) return "THEATRICAL";
    if (typeNum === 4) return "DIGITAL";
    if (typeNum === 5) return "PHYSICAL";
    return "STREAMING";
}

/**
 *
 */
export async function refreshTitleData(titleId: number) {
    const title = await prisma.title.findUnique({ where: { id: titleId } });
    if (!title) throw new Error("Title not found");
    if (!title.tmdbId) throw new Error("Title missing tmdbId");
    
    if (title.type === "TV") return refreshTv(title.id);
    else if (title.type === "MOVIE") return refreshMovie(title.id);

    return { kind: "unknown" };
}

/**
 *
 */
export async function refreshMovie(titleId: number):Promise<{ kind: TitleType; reason?: string; insertedOrUpdated?: number }> {
    const title = await prisma.title.findUnique({ where: { id: titleId }, select: { id: true, tmdbId: true, type: true, name: true } });
    if (!title) throw new Error(`Title ${titleId} not found`);
    if (title.type !== TitleType.TV) {
        throw new Error(`Title ${titleId} is not TV (type=${title.type})`);
    }
    if (!title.tmdbId) throw new Error(`Title ${titleId} missing tmdbId`);

    const payload = await getMovieReleaseDates(title.tmdbId);
        const upserts: Promise<any>[] = [];
        for (const countryBlock of payload.results ?? []) {
            const country = countryBlock.iso_3166_1;
            for (const rd of countryBlock.release_dates ?? []) {
                if (!rd.release_date) continue;
                const date = new Date(rd.release_date);
                const type = mapTmdbReleaseType(rd.type);
                upserts.push(
                    prisma.releaseEvent.upsert({
                        where: {
                            titleId_date_type_country: {
                                titleId: title.id,
                                date,
                                type,
                                country: country ?? null
                            }
                        },
                        create: {
                            titleId: title.id,
                            date,
                            type,
                            country
                        },
                        update: {} // nothing to update for now (idempotent)
                    }
                ));
            }
        }
        await Promise.all(upserts);
        return { kind: "MOVIE", insertedOrUpdated: upserts.length };
}

/**
 *
 */
export async function refreshTv(titleId: number): Promise<{ kind: TitleType; reason?: string; status?: string; upserted?: number; season?: number; }> {
    const title = await prisma.title.findUnique({ where: { id: titleId }, select: { id: true, tmdbId: true, type: true, name: true } });
    if (!title) throw new Error(`Title ${titleId} not found`);
    if (title.type !== TitleType.TV) {
        throw new Error(`Title ${titleId} is not TV (type=${title.type})`);
    }
    if (!title.tmdbId) throw new Error(`Title ${titleId} missing tmdbId`);
    
    const details = await getTvDetails(title.tmdbId);
    const next = details.next_episode_to_air;

    // ----- enrich Title (network/status/runtime/rating/providers)
    const networks = (details.networks ?? []).map(n => ({
        id: n.id, name: n.name, logoPath: n.logo_path ?? null
    }));
    const networkName = networks[0]?.name ?? null;

    const episodeRunTime = Array.isArray(details.episode_run_time) && details.episode_run_time.length
        ? Number(details.episode_run_time[0])
        : null;
    const status = details.status ?? null;

    const ratingsResp = await getTvContentRatings(title.tmdbId);
    const usRating = ratingsResp.results?.find(r => r.iso_3166_1 === "US")?.rating ?? null;

    const providersResp = await getTvWatchProviders(title.tmdbId);
    const providersResults = providersResp?.results ?? null;

    await prisma.title.update({
        where: { id: titleId },
        data: {
            networkName,
            status,
            episodeRunTime,
            tvRating: usRating,
            providersJson: providersResults ? (providersResults as Prisma.InputJsonValue) : Prisma.DbNull,
            networksJson: networks.length ? (networks as Prisma.InputJsonValue) : Prisma.DbNull,
        }
    });

    // ----- episodes: keep your “current season future episodes” approach
    if (!next) return { kind: "TV", status: "no_upcoming_episode" };

    const season = await getTvSeason(title.tmdbId, next.season_number);
    const eps = Array.isArray(season.episodes) ? season.episodes : [];
    const today = startOfTodayUTC();

    const futures = eps.filter(ep => {
        return (ep.air_date && new Date(ep.air_date + "T00:00:00Z") >= today);
    });

    if (futures.length === 0) {
        const announced = eps.filter(e => e.air_date).length;
        return { kind: 'TV', upserted: 0, reason: `no_future_episodes (announced=${announced})`}
    }
    
    const results = await prisma.$transaction(
        futures.map(ep =>
            prisma.episode.upsert({
                where: {
                    titleId_seasonNumber_episodeNumber: {
                        titleId: title.id,
                        seasonNumber: ep.season_number ?? next.season_number,
                        episodeNumber: ep.episode_number!,
                    },
                },
                create: {
                    titleId: title.id,
                    seasonNumber: ep.season_number ?? next.season_number,
                    episodeNumber: ep.episode_number!,
                    name: ep.name ?? null,
                    airDate: new Date(`${ep.air_date}T00:00:00Z`),
                    overview: ep.overview ?? null,
                    runtimeMin: (ep as any).runtime ?? null,
                    stillPath: (ep as any).still_path ?? null,
                    source: "TMDB",
                },
                update: {
                    name: ep.name ?? null,
                    airDate: new Date(`${ep.air_date}T00:00:00Z`),
                    overview: ep.overview ?? null,
                    runtimeMin: (ep as any).runtime ?? null,
                    stillPath: (ep as any).still_path ?? null,
                },
            })
        )
    );
    return { kind: "TV", upserted: results.length, season: next.season_number };
}

/**
 *
 */
export async function refreshTitleOnAdd(title: Title) {
    if (!REFRESH_ON_ADD) return;

    const FRESH_MS = 24 * 60 * 60 * 1000; // 24h
    const last = title.lastRefreshedAt ? new Date(title.lastRefreshedAt).getTime() : 0;
    const isFresh = last > 0 && (Date.now() - last) < FRESH_MS;

    let refresh: any = null;

    if (!isFresh) {
        try {
            if (title.type === TitleType.MOVIE) refresh = await refreshMovie(title.id);
            else refresh = await refreshTv(title.id);
        } catch (e: any) {
            refresh = { ok: false, error: e?.message ?? "refresh failed" };
            console.error("refresh-on-add failed:", e);
        }
    }
    else {
        refresh = { ok: true, error: "Title refreshed within last 24h, no refresh needed" }
    }

    return refresh;
}