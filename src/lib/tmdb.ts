import fetch from 'node-fetch';

const TMDB_BASE = 'https://api.themoviedb.org/3';
export type TmdbType = 'MOVIE' | 'TV';

export async function fetchTmdbTitle(tmdbId: number, type: TmdbType) {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) throw new Error('TMDB_API_KEY missing');

    const path = type === 'MOVIE' ? `movie/${tmdbId}`: `tv/${tmdbId}`
    const url = `${TMDB_BASE}/${path}?api_key=${apiKey}&language=en-US`;

    const res = await fetch(url);

    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`TMDB ${type} ${tmdbId} fetch failed: ${res.status} ${txt}`);
    }

    const json: any = await res.json();
    
    const name = type === 'MOVIE' ? json.title : json.name;
    const dateStr = type === 'MOVIE' ? json.release_date : json.first_air_date;
    const releaseDate = dateStr ? new Date(dateStr) : undefined;

    return {
        tmdbId,
        type,
        name,
        releaseDate,
        posterPath: json.poster_path ?? null,
        overview: json.overview ?? null,
    };
}

export async function searchTmdb(query: string, type: TmdbType, page = 1) {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) throw new Error('TMDB_API_KEY missing');

    const endpoint = type === 'MOVIE' ? 'search/movie' : 'search/tv';
    const url = `${TMDB_BASE}/${endpoint}?api_key=${apiKey}&language=en-US&include_adult=false&page=${page}&query=${encodeURIComponent(query.trim())}`;

    const res = await fetch(url)
    if (!res.ok) throw new Error(`TMDB search failed: ${res.status}`)
    const json: any = await res.json();

    const results = (json.results ?? []).map((r: any) => {
        const name = type === 'MOVIE' ? r.title : r.name;
        const dateStr = type === 'MOVIE' ? r.release_date : r.first_air_date;

        return {
            tmdbId: r.id as number,
            type,
            name,
            releaseDate: dateStr || null,
            posterPath: r.poster_path ?? null,
            overview: r.overview ?? null,
            popularity: r.popularity ?? null,
        };
    });

    return {
        page: json.page ?? page,
        totalPages: json.total_pages ?? 1,
        totalResults: json.total_results ?? results.length,
        results
    }
}

function tmdbHeaders() {
    const key = process.env.TMDB_API_KEY;
    if(!key) throw new Error("TMDB_API_KEY not set");
    return { Authorization: `Bearer ${key}`, "Content-Type": "application/json;charset=utf-8" };
}

// Movie: release dates
export async function getMovieReleaseDates(tmdbId: number) {
    const res = await fetch(`${TMDB_BASE}/movie/${tmdbId}/release_dates`, { headers: tmdbHeaders() });
    if (!res.ok) throw new Error(`TMDB release_dates failed ${res.status}`);

    return res.json() as Promise<{
        id: number;
        results: Array<{ iso_3166_1: string; release_dates: Array<{ release_date: string; type: number }> }>;
    }>;
}

// TV: next episode to air (and details)
export async function getTvDetails(tmdbId: number) {
    const res = await fetch(`${TMDB_BASE}/tv/${tmdbId}`, { headers: tmdbHeaders() });
    if (!res.ok) throw new Error(`TMDB details failed ${res.status}`);
    return res.json() as Promise<{
        id: number;
        next_episode_to_air?: {
            season_number: number;
            episode_number: number;
            name?: string;
            air_date?: string; // "YYYY-MM-DD"
            overview?: string;
        }
    }>;
}