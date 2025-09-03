import fetch from 'node-fetch';

const TMDB_BASE = 'https://api.themoviedb.org/3';

function v4Token(): string {
	let t = (process.env.TMDB_API_KEY || "").trim();
	if (!t) throw new Error("TMDB_API_KEY not set (expecting v4 Read Access Token)");
	if (t.toLowerCase().startsWith("bearer ")) t = t.slice(7).trim();
	if (!t.startsWith("eyJ")) throw new Error("TMDB_API_KEY doesn't look like a v4 token (should start with eyJ...)");
	return t;
}

// For GETs (most TMDB endpoints you use)
export function authHeaders() {
  	return { Authorization: `Bearer ${v4Token()}`, Accept: "application/json" };
}

// For POST/PATCH with JSON bodies
export function jsonHeaders() {
	return {
		Authorization: `Bearer ${v4Token()}`,
		Accept: "application/json",
		"Content-Type": "application/json; charset=utf-8",
	};
}

function buildUrl(path: string, params?: Record<string, any>) {
  	const url = new URL(`${TMDB_BASE}${path}`);
  	if (params) {
    	Object.entries(params).forEach(([k, v]) => {
      		if (v === undefined || v === null) return;
      		url.searchParams.set(k, String(v));
    	});
  	}
  	return url.toString();
}

/** Generic GET wrapper using v4 Bearer across /3 endpoints */
async function tmdbGet<T>(path: string, params?: Record<string, any>): Promise<T> {
  	const res = await fetch(buildUrl(path, params), { headers: authHeaders() });
  	if (!res.ok) {
    	const text = await res.text().catch(() => "");
    	throw new Error(`TMDB ${path} failed ${res.status}${text ? `: ${text}` : ""}`);
  	}
  	return res.json() as Promise<T>;
}

export async function getMovieReleaseDates(tmdbId: number) {
  	return tmdbGet<{ 
            id: number; 
            results: Array<{ iso_3166_1: string; release_dates: Array<{ release_date: string; type: number }> }> 
        }>(
            `/movie/${tmdbId}/release_dates`
        );
}

export type TvDetailsResponse = {
	id: number;
	name?: string;
	status?: string;                         // e.g., "Returning Series"
	episode_run_time?: number[];             // typical minutes array
	networks?: Array<{ id: number; name: string; logo_path?: string }>;
	next_episode_to_air?: {
		season_number: number;
		episode_number: number;
		name?: string;
		air_date?: string;                     // "YYYY-MM-DD"
		overview?: string;
		runtime?: number;                      // sometimes present
		still_path?: string;                   // sometimes present
	};
};

export async function getTvDetails(tmdbId: number) {
  return tmdbGet<TvDetailsResponse>(`/tv/${tmdbId}`, { language: "en-US" });
}

export async function getTvContentRatings(tmdbId: number) {
  return tmdbGet<{ 
        	results: Array<{ iso_3166_1: string; rating: string }> 
		}>(
			`/tv/${tmdbId}/content_ratings`
  		)
}

export async function getTvWatchProviders(tmdbId: number) {
  	// results.{ISO}.flatrate[]|rent[]|buy[] (provider_name, logo_path, provider_id)
	return tmdbGet<{ 
		id: number; results: Record<string, any> 
	}>(
    	`/tv/${tmdbId}/watch/providers`
  	);
}

export type TmdbType = 'MOVIE' | 'TV';

export async function fetchTmdbTitle(tmdbId: number, type: TmdbType) {
  const path = type === "MOVIE" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;

  // Keep your original params/locale behavior
  const json: any = await tmdbGet(path, { language: "en-US" });

  const name = type === "MOVIE" ? json.title : json.name;
  const dateStr = type === "MOVIE" ? json.release_date : json.first_air_date;
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
    const endpoint = type === "MOVIE" ? "/search/movie" : "/search/tv";

    const json: any = await tmdbGet(endpoint, {
        language: "en-US",
        include_adult: "false",
        page,
        query: query.trim(),
    });


    const results = (json.results ?? []).map((r: any) => {
    const name = type === "MOVIE" ? r.title : r.name;
    const dateStr = type === "MOVIE" ? r.release_date : r.first_air_date;

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
        results,
  };
}

export async function getTvSeason(tmdbId: number, seasonNumber: number) {
	return tmdbGet<{
		_id: string;
		id: number;
		name: string;
		season_number: number;
		episodes: Array<{
		episode_number: number;
		season_number: number;
		name?: string;
		overview?: string;
		air_date?: string; // "YYYY-MM-DD"
		}>;
	}>(
		`/tv/${tmdbId}/season/${seasonNumber}`, { language: "en-US" }
	);
}

export type Provider = { id: number; name: string; logoPath? : string | null };
type ProviderBuckets = {
	flatrate?: Provider[],
	free?: Provider[],
	ads?: Provider[],
	rent?: Provider[],
	buy?: Provider[],
}

export function pickProviderBadges(results: Record<string, any> | null | undefined, region = "US", max = 4): Provider[] {
	const r = results?.[region] ?? {};
	const buckets: ProviderBuckets = {
		flatrate: (r.flatrate ?? []).map(mapProv),
		free: (r.free ?? []).map(mapProv),
		ads: (r.ads ?? []).map(mapProv),
		rent: (r.rent ?? []).map(mapProv),
		buy: (r.buy ?? []).map(mapProv),
	}

	// Prioritry: flatrate -> free -> ads -> rent -> buy
	const prioritized = ["flatrate", "free", "ads", "rent", "buy"]
		.flatMap(k => (buckets as any)[k] as Provider[])
		.filter(Boolean);

	const seen = new Set<number>;
	const out: Provider[] = [];
	for (const p of prioritized) {
		if (!seen.has(p.id)) { out.push(p); seen.add(p.id); }
		if (out.length >= max) break;
	}
	return out;

	function mapProv(p: any): Provider {
		return { id: p.provider_id, name: p.provider_name, logoPath: p.logo_path ?? null };
	}
}