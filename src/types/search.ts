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

export type PaginatedResponse<T> = {
    results: T[];
    page: number;
    totalPages: number;
    totalResults: number;
};

export type TmdbSearchResponse = PaginatedResponse<TmdbSearchResult>;

export type SearchResponse = PaginatedResponse<SearchResult>;