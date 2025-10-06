import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../db/client";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { validate, getValidated } from "../../middleware/validate";
import { ApiError, notFound } from "../../errors";
import { refreshMaybe } from "../../services/refreshMaybe";

const router = Router();

const refreshParams = z.object({
    id: z.coerce.number().int().positive()
});
const refreshQuery = z.object({
    force: z.coerce.boolean().optional()
});

router.post(
    "/:id/refresh",
    requireAuth,
    validate("params", refreshParams),
    validate("query", refreshQuery),
    asyncHandler(async (req: any, res) => {
        const { id } = getValidated<z.infer<typeof refreshParams>>(req, "params");
        const { force } = getValidated<z.infer<typeof refreshQuery>>(req, "query");

        const title = await prisma.title.findUnique({ where: { id } });
        if (!title) throw notFound("Title not found");

        const result = await refreshMaybe(title, {
            force: Boolean(force),
            reason: force ? "manual-force" : "manual",
        }).catch((err) => {
            throw new ApiError(502, "UPSTREAM_ERROR", (err as Error).message ?? "Refresh failed");
        });

        return res.json({ ok: true, result });
    })
);

export default router;