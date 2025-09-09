// src/middleware/apiVersion.ts
import { Request, Response, NextFunction } from 'express';

export function apiVersion(version = 'v1') {
    return (_req: Request, res: Response, next: NextFunction) => {
        res.setHeader('X-API-Version', version);
        next();
    };
}
