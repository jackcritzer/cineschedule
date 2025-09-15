import type { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/jwt';
import { ApiError } from '../errors';

/**
 *
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization ?? '';

    if (!authHeader?.startsWith('Bearer ')) {
        throw new ApiError(401, 'AUTH_TOKEN_INVALID', 'Missing or invalid token');
    }

    const parts = authHeader.split(' ');
    const token = parts.length === 2 ? parts[1] : undefined;

    if (!token) {
        throw new ApiError(401, 'AUTH_TOKEN_INVALID', 'Missing token');
    }

    try {
        const payload = verifyJwt(token);
        // You likely put user id in sub
        (req as any).user = { id: Number(payload.sub), ...payload };
        return next();
    } catch (err: any) {
        throw new ApiError(401, 'AUTH_TOKEN_INVALID', 'Missing or invalid token', err?.message ?? null);
    }
}