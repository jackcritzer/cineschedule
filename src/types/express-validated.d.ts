import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    /**
     * Populated by validate() middleware with the Zod-parsed values.
     */
    validated?: {
      body?: unknown;
      query?: unknown;
      params?: unknown;
    };
  }
}
