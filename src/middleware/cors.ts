import cors, { CorsOptions } from "cors";

const origins = process.env.CORS_ORIGINS?.split(",") ?? [];

/**
 * Build a dynamic origin check:
 * - allow exact matches from CORS_ORIGINS
 * - allow all cineschedule-*.vercel.app preview domains
 * - allow requests with no origin (curl, Postman, health checks)
 * - Log rejections for debugging
 */
const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);

        // Exact match from env
        if (origins.includes(origin)) {
            return callback(null, true);
        }

        // Regex match for Vercel previews
        if (/^https:\/\/cineschedule-[^.]+\.vercel\.app$/.test(origin)) {
            return callback(null, true);
        }
        
        // Log blocked origin
        if (process.env.NODE_ENV !== "production") {
            console.warn(`[CORS] Blocked origin: ${origin}`);
        }

        return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    exposedHeaders: ['X-API-Version', 'Deprecation', 'Sunset', 'Link'],
    credentials: false
};

export const corsMiddleware = cors(corsOptions);