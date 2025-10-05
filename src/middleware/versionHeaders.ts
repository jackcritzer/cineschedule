import type { Request, Response, NextFunction } from 'express';

/**
 *
 */
export function addVersionHeaders(version: 'v1' | 'v2', opts?: {
    deprecate?: boolean;
    sunsetGMT?: string; // e.g., 'Wed, 01 Apr 2026 00:00:00 GMT'
    successor?: string; // e.g., '/v2'
}) {
    return (_req: Request, res: Response, next: NextFunction) => {
        res.setHeader('X-API-Version', version);
        if (opts?.deprecate) {
            // RFC 8594 style signaling
            res.setHeader('Deprecation', 'true');
            if (opts?.sunsetGMT) res.setHeader('Sunset', opts.sunsetGMT);
            if (opts?.successor) res.setHeader('Link', `<${opts.successor}>; rel="successor-version"`);
        }
        next();
    };
}