import type { Request, Response, NextFunction } from 'express';

import { ApiError } from '../errors';

/**
 *
 */
export function errorHandler() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
        const requestId = (req as any).requestId;

        if (err instanceof ApiError) {
            // Log minimal structured event (replace with pino/winston later)
            console.error(JSON.stringify({
                level: 'error',
                requestId,
                status: err.status,
                code: err.code,
                message: err.message,
            }));

            return res.status(err.status).json({
                error: {
                    code: err.code,
                    message: err.message,
                    details: err.details ?? null,
                    requestId,
                    docs: `https://api.cineschedule.com/v1/docs/errors#${err.code}`
                }
            });
        }

        // Fallback — never leak stack in prod
        console.error(JSON.stringify({ level: 'error', requestId, unhandled: true }));
        return res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Unexpected server error.',
                details: null,
                requestId,
                docs: 'https://api.cineschedule.com/v1/docs/errors#INTERNAL_ERROR'
            }
        });
    }
}