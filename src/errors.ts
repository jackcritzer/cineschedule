export type ErrorCode =
    // Auth
    | 'AUTH_INVALID_CREDENTIALS'
    | 'AUTH_TOKEN_INVALID'
    | 'AUTH_TOKEN_EXPIRED'
    | 'AUTH_FORBIDDEN'
    // Input / Not found / Conflict
    | 'BAD_REQUEST'
    | 'VALIDATION_ERROR'
    | 'RESOURCE_NOT_FOUND'
    | 'CONFLICT'
    | 'RATE_LIMITED'
    // Upstream / Server
    | 'UPSTREAM_ERROR'
    | 'TMDB_NOT_FOUND'
    | 'TMDB_UPSTREAM_ERROR'
    | 'INTERNAL_ERROR';


export class ApiError extends Error {
    status: number;
    code: ErrorCode;
    details?: unknown;
    /**
     *
     */
    constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export const /**
 *
 */
badRequest = (msg = 'Bad request', details?: unknown) =>
    new ApiError(400, 'BAD_REQUEST', msg, details);

export const /**
 *
 */
notFound = (msg = 'Resource not found', details?: unknown) =>
  new ApiError(404, 'RESOURCE_NOT_FOUND', msg, details);

export const /**
 *
 */
internal = (msg = 'Unexpected server error.', details?: unknown) =>
  new ApiError(500, 'INTERNAL_ERROR', msg, details);