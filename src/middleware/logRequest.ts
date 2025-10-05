import type { Request, Response, NextFunction } from 'express';

/**
 *
 */
export function logRequest(req: Request, res: Response, next: NextFunction) {
    const rid = (res.locals as any).rid;
    const started = Date.now();

    // minimal structured line
    console.log(JSON.stringify({
        level: 'info',
        msg: 'req.start',
        rid,
        method: req.method,
        path: req.originalUrl,
    }));

    res.on('finish', () => {
        console.log(JSON.stringify({
            level: 'info',
            msg: 'req.finish',
            rid,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            headers: res.getHeaders(),
            ms: Date.now() - started,
        }));
    });

    next();
}