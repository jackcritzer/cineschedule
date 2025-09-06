import { Router } from 'express';
import { prisma } from '../db/client';
import { hashPassword, verifyPassword } from '../utils/hash';
import { signJwt } from '../utils/jwt';

const router = Router();

// POST /auth/register
router.post('/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    try {
        const passwordHash = await hashPassword(password);
        const user = await prisma.user.create({ data: { email, passwordHash } });
        const token = signJwt({ sub: user.id });
        res.json({ 
            token,
            user: { id: user.id, email: user.email }
        });
    } catch (err: any) {
        if (err.code === 'P2002') { // Prisma unique constrait
            return res.status(409).json({ error: 'Email is already associated with an account' });
        }
        res.status(500).json({ error: 'Registration failed' });
    }
});

// POST /auth/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signJwt({ sub: user.id });
    res.json({ token });
});

export default router;