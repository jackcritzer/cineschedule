import express, { type ErrorRequestHandler, type Request, type RequestHandler, type Router } from "express";
//import { errorHandler } from '../src/middleware/errorHandler';

export interface AuthUser {
	id: number;
}

export interface AuthenticatedRequest extends Request {
	user?: AuthUser;
}

/**
 *
 */
export function buildTestApp(router: Router, opts?: { withAuth?: boolean }) {
	const app = express();
	app.use(express.json());

	// Optional auth stub for routes that read req.user.id
	if (opts?.withAuth) {
		const authStub: RequestHandler = (req, _res, next) => {
			(req as AuthenticatedRequest).user = { id: 1 };
			next();
		};
		app.use(authStub);
	}

	app.use(router);

	//app.use(errorHandler);

	// Typed error handler with your envelope
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const errHandler: ErrorRequestHandler = (err, _req, res, _next) => {
		console.log(err)
		const status = typeof err?.status === "number" ? err.status : 500;
		const code = typeof err?.code === "string" ? err.code : "INTERNAL";
		const message = typeof err?.message === "string" ? err.message : "Internal Server Error";
		res.status(status).json({ error: { code, message } });
	};
	app.use(errHandler);

	return app;
}