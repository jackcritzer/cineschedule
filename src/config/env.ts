import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3000),
    REFRESH_ON_ADD: z.coerce.number(),
    DATABASE_URL: z.url(),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET should be at least 16 chars'),
    TMDB_API_KEY: z.string().min(1),
    JWT_KEYS: z.string(),
    JWT_CURRENT_KID: z.string(),
    JWT_EXPIRES_IN: z.string(),
    CRON_ENABLED: z.any(),
    CRON_SCHEDULE: z.string(),
    CRON_TZ: z.string(),
    REFRESH_CONCURRENCY: z.coerce.number(),
    NIGHTLY_MIN_FRESH_MS: z.coerce.number(),
    NIGHTLY_UPCOMING_DAYS: z.coerce.number()
})

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error('Invalid environment configuration:', z.treeifyError(parsed.error));
    process.exit(1);
}

export const env = parsed.data;