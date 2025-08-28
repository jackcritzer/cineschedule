import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET should be at least 16 chars'),
    TMDB_API_KEY: z.string().min(1)
})

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error('Invalid environment configuration:', z.treeifyError(parsed.error));
    process.exit(1);
}

export const env = parsed.data;