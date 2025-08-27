import { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/jwt.ts';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid token'});
    }

    const token = authHeader.split(' ')[1];
    try {
        const payload = verifyJwt(token);
        (req as any).user = payload;
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}