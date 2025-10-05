import type { Request, Response, NextFunction } from 'express';
import { TokenExpiredError, JsonWebTokenError } from 'jsonwebtoken';
import { verifyJwt } from '../utils/jwt';
import { ApiError } from '../errors';

const SECRET = process.env.JWT_SECRET!;
if (!SECRET) throw new Error('JWT_SECRET missing');

export type AuthLocals = {
    userId: string;
    token: string;
};

/**
 *
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization ?? '';
    const [scheme, token] = authHeader.split(' ');

    if (!token || scheme?.toLowerCase() !== 'bearer') {
        return next(new ApiError(401, 'BAD_REQUEST', 'Missing Bearer token'));
    }

    try {
        const payload = verifyJwt(token);
        
        if (payload.typ && payload.typ !== 'access') {
            throw new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'Wrong token type');
        }

        (req as any).user = { id: Number(payload.sub), ...payload };
        return next();
    } catch (err: any) {
        if (err instanceof TokenExpiredError) {
            // Optional RFC 6750 hint for clients/proxies
            res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token", error_description="The access token expired"');
            return next(new ApiError(401, 'AUTH_TOKEN_EXPIRED', 'Access token expired'));
        }
        if (err instanceof JsonWebTokenError) {
            res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token", error_description="Invalid access token"');
            return next(new ApiError(401, 'AUTH_TOKEN_INVALID', 'Invalid access token'));
        }
        throw new ApiError(401, 'AUTH_TOKEN_INVALID', 'Missing or invalid token', err?.message ?? null);
    }
}