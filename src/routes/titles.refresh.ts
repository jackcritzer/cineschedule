import { Router } from "express";
import { refreshTitleData } from "../services/refresh";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.post("/titles/:id/refresh", requireAuth, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

        const result = await refreshTitleData(id);
        res.json({ ok: true, result });
    } catch (err: any) {
        res.status(500).json({ ok: false, error: err?.message ?? "Refresh failed" });
    }
});

export default router;