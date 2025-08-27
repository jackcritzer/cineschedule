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

    const json = await res.json();
    
    const name = type === 'MOVIE'
}