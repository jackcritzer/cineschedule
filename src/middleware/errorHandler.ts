import type { NextFunction, Request, Response } from 'express';

/**
 *
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
    const rid = (res.locals as any).rid;
    const status = typeof err?.status === 'number' ? err.status : 500;

    // Dev-friendly console line with stack
    console.error(JSON.stringify({
        level: 'error',
        msg: 'req.error',
        rid,
        method: req.method,
        path: req.originalUrl,
        status,
        name: err?.name,
        code: err?.code,
        message: err?.message,
        stack: process.env.NODE_ENV !== 'production' ? err?.stack : undefined,
    }));

    // Keep your consistent envelope
    res.status(status).json({
        message: err?.message || 'Unexpected server error',
        code: err?.code || 'INTERNAL_SERVER_ERROR',
        requestId: rid,
    });
}