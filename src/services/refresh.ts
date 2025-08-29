import { PrismaClient, ReleaseType } from "@prisma/client";
import { getMovieReleaseDates, getTvDetails, getTvSeason, getTvContentRatings, getTvWatchProviders } from "../lib/tmdb";

const prisma = new PrismaClient();

type ReleaseTypeEnum = ReleaseType;

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

export async function refreshTitleData(titleId: number) {
    const title = await prisma.title.findUnique({ where: { id: titleId } });
    if (!title) throw new Error("Title not found");
    if (!title.tmdbId) throw new Error("Title missing tmdbId");

    if (title.type === "TV") return refreshTv(title.id, title.tmdbId);

    if (title.type === "MOVIE") {
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

    return { kind: "unknown" };
}

export async function refreshTv(titleId: number, tmdbId: number) {
    const details = await getTvDetails(tmdbId);
    const next = details.next_episode_to_air;

    // ----- enrich Title (network/status/runtime/rating/providers)
    const networks = (details.networks ?? []).map(n => ({
        id: n.id, name: n.name, logoPath: n.logo_path ?? null
    }));
    const networkName = networks[0]?.name ?? null;

    const episodeRunTime = Array.isArray(details.episode_run_time) && details.episode_run_time.length
        ? details.episode_run_time[0]
        : null;
    const status = details.status ?? null;

    const ratingsResp = await getTvContentRatings(tmdbId);
    const usRating = ratingsResp.results?.find(r => r.iso_3166_1 === "US")?.rating ?? null;

    const providersRep = await getTvWatchProviders(tmdbId);
    const us = providersRep.results?.US;
    const flatrate = Array.isArray(us?.flatrate) 
        ? us.flatrate.map((p: any) => ({
                id: p.provider_id, name: p.provider_name, logoPath: p.logo_path
            })) 
        : [];

    await prisma.title.update({
        where: { id: titleId },
        data: {
            networkName,
            status,
            episodeRunTime,
            tvRating: usRating,
            providersJson: flatrate.length ? flatrate : null,
            networksJson: flatrate.length ? networks : null
        }
    });

    // ----- episodes: keep your “current season future episodes” approach
    if (!next) return { kind: "TV", status: "no_upcoming_episode" };

    const season = await getTvSeason(tmdbId, next.season_number);
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

    const futures = (season.episodes ?? []).filter(ep => {
        return (ep.air_date && new Date(ep.air_date + "T00:00:00Z") >= today);
    });
    
    await Promise.all(futures.map(ep => {
        prisma.episode.upsert({
            where: {
                titleId_seasonNumber_episodeNumber: {
                    titleId,
                    seasonNumber: ep.season_number ?? next.season_number,
                    episodeNumber: ep.episode_number
                }
            },
            create: {
                titleId,
                seasonNumber: ep.season_number ?? next.season_number,
                episodeNumber: ep.episode_number,
                name: ep.name ?? null,
                airDate: new Date(ep.air_date + "T00:00:00Z"),
                overview: ep.overview ?? null,
                runtimeMin: (ep as any).runtime ?? null,
                stillPath: (ep as any).still_path ?? null
            },
            update: {
                name: ep.name ?? null,
                airDate: new Date(ep.air_date + "T00:00:00Z"),
                overview: ep.overview ?? null,
                runtimeMin: (ep as any).runtime ?? null,
                stillPath: (ep as any).still_path ?? null
            }
        })
    }))
    return { kind: "TV", upserted: futures.length };
} 