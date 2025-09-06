import assert from 'node:assert';

export type JwtKey = { kid: string; secret: string };

function parseJwtKeys(envVal?: string): Map<string, string> {
    const map = new Map<string, string>();
    if (!envVal) return map;
    for (const part of envVal.split(',').map(s => s.trim()).filter(Boolean)) {
        const [kid, secret] = part.split('=');
        if (!kid || !secret) continue;
        map.set(kid.trim(), secret.trim());
    }
    return map;
}

const keys = parseJwtKeys(process.env.JWT_KEYS);
const currentKid = process.env.JWT_CURRENT_KID?.trim();

assert(keys.size > 0, 'JWT_KEYS is required (format: KID=SECRET,KID=SECRET,...)');
assert(currentKid && keys.has(currentKid), 'JWT_CURRENT_KID must be set and exist in JWT_KEYS');

export const jwtKeyStore = {
    /** All keys (kid → secret) */
    all(): Map<string, string> {
        return keys;
    },

    /** Returns the current signing key (kid, secret) */
    current(): JwtKey {
        return { kid: currentKid!, secret: keys.get(currentKid!)! };
    },

    /** Secret by kid (or undefined) */
    getByKid(kid?: string | null): string | undefined {
        if (!kid) return undefined;
        return keys.get(kid);
    },
};