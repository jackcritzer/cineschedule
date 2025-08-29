import { PrismaClient, ReleaseType } from "@prisma/client";
import { getMovieReleaseDates, getTvDetails } from "../lib/tmdb";

const prisma = new PrismaClient();

type ReleaseTypeEnum = ReleaseType;

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

    if (title.type === "TV") {
        const details = await getTvDetails(title.tmdbId);
        const next = details.next_episode_to_air;
        if(!next?.air_date) {
            return { kind: "TV", status: "no_upcoming_episode" };
        }
        const airDate = new Date(`${next.air_date}T00:00:00Z`);
        await prisma.episode.upsert({
            where: {
                titleId_seasonNumber_episodeNumber: {
                    titleId: title.id,
                    seasonNumber: next.season_number,
                    episodeNumber: next.episode_number,
                    },
                },
                create: {
                    titleId: title.id,
                    seasonNumber: next.season_number,
                    episodeNumber: next.episode_number,
                    name: next.name ?? null,
                    airDate,
                    overview: next.overview ?? null,
                },
                update: {
                    name: next.name ?? null,
                    airDate,
                    overview: next.overview ?? null,
                },
        });
        return { kind: "tv", upserted: true };
    }
    return { kind: "unknown" };
}