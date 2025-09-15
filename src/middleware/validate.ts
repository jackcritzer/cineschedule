import { z, ZodType } from 'zod';
import type { RequestHandler } from 'express';
import { ApiError } from '../errors';

type Part = 'body' | 'query' | 'params';
type Format = 'flat' | 'tree';

/**
 *
 */
export const validate = <T extends ZodType>(part: Part, schema: T, format: Format = 'flat'): RequestHandler => 
    (req, _res, next) => {
        const input =
            part === 'body' ? (req.body ?? {}) :
            part === 'query' ? (req.query ?? {}) :
            (req.params ?? {});

        const result = schema.safeParse(input);

        if (!result.success) {
            console.error('[validation]', z.prettifyError(result.error));

            const details =
                format === 'flat'
                ? z.flattenError(result.error)
                : z.treeifyError(result.error);

            throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request.', { details });
        }

        (req as any).validated ??= {};
        (req as any).validated[part] = result.data;

        // Also sanitize req.* for downstream libs without reassigning getters
        if (part === 'body') {
            (req as any).body = result.data;
        } else {
            const target: any = part === 'query' ? (req as any).query : (req as any).params;
            for (const k of Object.keys(target)) delete target[k];
            Object.assign(target, result.data);
        }
        
        next();
}

/**
 *
 */
export function getValidated<T = any>(req: Request, part: 'body'|'query'|'params'): T {
    const value = (req as any).validated?.[part];
    if (value === undefined) {
        throw new ApiError(500, 'INTERNAL_ERROR', `getValidated(${part}) called before validate(${part})`);
    }
    return value as T;
}