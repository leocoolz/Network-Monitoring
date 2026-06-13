import { Router } from "express";
import { z } from "zod";
import * as apiTokenService from "../services/api-token-service.js";
import { requireAuth } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";

const tokenSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).optional(),
  expiresInDays: z.number().min(1).max(365).optional()
});

export function createAPITokenRouter() {
  const router = Router();
  router.use(requireAuth);

  // List user's API tokens
  router.get("/", async (req, res) => {
    const tokens = await apiTokenService.listAPITokens(req.auth.user.id);
    res.json({ data: tokens });
  });

  // Create new API token
  router.post("/", requireCsrf, validate(tokenSchema), async (req, res) => {
    const token = await apiTokenService.createAPIToken(req.auth.user.id, req.body, req);
    res.status(201).json({ data: token });
  });

  // Revoke API token
  router.delete("/:id", requireCsrf, async (req, res) => {
    await apiTokenService.revokeAPIToken(req.params.id, req);
    res.json({ message: "Token revoked" });
  });

  return router;
}
