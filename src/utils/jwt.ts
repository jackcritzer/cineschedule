import jwt, { JwtPayload, SignOptions, VerifyErrors } from 'jsonwebtoken';
import type { StringValue } from "ms";
import { jwtKeyStore } from '../config/jwtKeys';

const DEFAULT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '7d') as StringValue;

export type JwtSubject = { sub: string | number; [k: string]: unknown };

type SafeSignOpts = Omit<SignOptions, 'algorithm' | 'expiresIn' | 'header' | 'keyid'>;

export function signJwt(payload: JwtSubject, opts: SafeSignOpts = {}): string {
    const { kid, secret } = jwtKeyStore.current();

    const normalized = { ...payload, sub: String(payload.sub) };

    return jwt.sign(
        normalized,
        secret,
        {
            algorithm: 'HS256',
            expiresIn: DEFAULT_EXPIRES_IN,
            keyid: kid,
            ...opts,
        }
    )
}

export function verifyJwt<T extends JwtPayload = JwtPayload>(token: string): T {
    const decodedUnverified = jwt.decode(token, { complete: true }) as { header?: { kid?: string } } | null;
    const kid = decodedUnverified?.header?.kid;
    const byKidSecret = jwtKeyStore.getByKid(kid);
    if (byKidSecret) {
        return jwt.verify(token, byKidSecret) as T;
    }

    // Fallback: try all keys (helps older tokens without kid)
    const errors: VerifyErrors[] = []
    for (const secret of jwtKeyStore.all().values()) {
        try {
            return jwt.verify(token, secret) as T;
        } catch (err) {
            errors.push(err as VerifyErrors);
            continue;
        }
    }

    // If none worked, throw last error for clarity
    const last = errors[errors.length - 1];
    throw last ?? new Error('JWT verification failed');
}