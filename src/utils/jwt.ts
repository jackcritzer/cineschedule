import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

export interface JwtPayload {
    userId: number;
    email: string;
}

export function signJwt(payload: JwtPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

export function verifyJwt(token: string): JwtPayload {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
}