import { Router } from 'express';
import { prisma } from '../db/client';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { hashPassword, verifyPassword } from '../utils/hash';
import { signJwt } from '../utils/jwt';
import { validate } from '../middleware/validate';
import { ApiError } from '../errors';
import { requireAuth } from '../middleware/auth';

const router = Router();

const authSchema = z.object({ 
                        email: z.email(), 
                        password: z.coerce.string().min(10, 'Password too short')
                    });

/** @route POST /v1/auth/register
 *  @summary Create user and return JWT
 *  @body { email: string(email), password: string(min 10) }
 *  @returns 200 { token: string, user: { id: number, email: string } }
 *  @errors 400 VALIDATION_ERROR | 409 CONFLICT | 500 INTERNAL_ERROR
 */
router.post(
    '/register', 
    validate('body', authSchema),
    asyncHandler(async (req, res) => {
        const { email, password } = req.body as z.infer<typeof authSchema>;

        try {
            const passwordHash = await hashPassword(password);
            const user = await prisma.user.create({ data: { email, passwordHash } });
            const token = signJwt({ sub: user.id });
            res.json({ token, user: { id: user.id, email: user.email } });
        } catch (err: any) {
            if (err?.code === 'P2002') {
                // Unique constraint violation
                throw new ApiError(409, 'CONFLICT', 'Email is already associated with an account');
            }
            throw new ApiError(500, 'INTERNAL_ERROR', 'Registration failed', (err as Error).message);
        }
    })
);

/** @route POST /v1/auth/login
 *  @summary Authenticate and return JWT
 *  @body { email: string(email), password: string(min 10) }
 *  @returns 200 { token: string }
 *  @errors 400 VALIDATION_ERROR | 401 AUTH_INVALID_CREDENTIALS
 */
router.post(
    '/login', 
    validate('body', authSchema),
    asyncHandler(async (req, res) => {
        const { email, password } = req.body as z.infer<typeof authSchema>;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) throw new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials');

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) throw new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials');

        const token = signJwt({ sub: user.id });
        res.json({ token });
    })
);

// POST /auth/change-password
const changePasswordBody = z.object({
    oldPassword: z.string().min(10, 'Password too short'),
    newPassword: z.string().min(10, 'Password too short')
})

/** @route POST /v1/auth/change-password
 *  @summary Change password for current user
 *  @auth Bearer
 *  @body { oldPassword: string(min 10), newPassword: string(min 10) }
 *  @returns 200 { ok: true }
 *  @errors 400 VALIDATION_ERROR | 401 AUTH_INVALID_CREDENTIALS | 401 AUTH_TOKEN_* | 404 RESOURCE_NOT_FOUND
 */
router.post(
  '/change-password',
  requireAuth,
  validate('body', changePasswordBody),
  asyncHandler(async (req: any, res) => {
        const userId: number = req.user.id;
        const { oldPassword, newPassword } = req.body as z.infer<typeof changePasswordBody>;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'User not found');

        const ok = await verifyPassword(oldPassword, user.passwordHash);
        if (!ok) throw new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'Old password is incorrect');

        const passwordHash = await hashPassword(newPassword);
        await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
        res.json({ ok: true });
  })
);

/** @route POST /v1/auth/logout
 *  @summary No-op; client clears token
 *  @returns 200 { ok: true }
 */
router.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true });
  })
);

export default router;