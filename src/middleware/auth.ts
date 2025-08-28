import type { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/jwt';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization ?? '';

    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid token'});
    }

    const parts = authHeader.split(' ');
    const token = parts.length === 2 ? parts[1] : undefined;

    if (!token) {
        return res.status(401).json({ error: 'Missing token' });
    }

    try {
        const payload = verifyJwt(token);
        (req as any).user = payload;
        return next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}