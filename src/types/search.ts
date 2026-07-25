export type ApiTitleType = "MOVIE" | "TV";
export type ApiReleaseType = "theatrical" | "digital" | "streaming";

export type TmdbSearchResult = {
    tmdbId: number;
    type: ApiTitleType;
    name: string;
    releaseDate: string | null;
    posterPath: string | null;
    overview: string | null;
    popularity: number | null;
};

export type SearchResult = TmdbSearchResult & {
    year: number | null;
    isInWatchlist: boolean;
};

type SearchResults<T> = {
    results: T[];
}

export type TmdbSearchResponse = SearchResults<TmdbSearchResult>;

export type SearchResponse = {
    results: SearchResult[];
};