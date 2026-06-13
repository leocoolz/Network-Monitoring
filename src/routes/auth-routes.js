import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { serialize } from "cookie";
import { z } from "zod";
import { env } from "../config/env.js";
import { pool, withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { createToken, hashToken } from "../lib/crypto.js";
import { requireAuth } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";
import { authenticate } from "../services/auth-service.js";

const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,64}$/),
  password: z.string().min(1).max(128),
  remember: z.boolean().default(false)
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many login attempts. Try again later." } }
});

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "strict",
    path: "/",
    ...(maxAge == null ? {} : { maxAge })
  };
}

export function createAuthRouter() {
  const router = Router();

  router.post("/login", loginLimiter, validate(loginSchema), async (req, res) => {
    const result = await authenticate({ ...req.body, req });
    const maxAge = req.body.remember ? new Date(result.expiresAt).getTime() - Date.now() : undefined;
    res.setHeader("Set-Cookie", serialize(env.sessionCookieName, result.token, cookieOptions(maxAge)));
    res.status(200).json({ data: { user: result.user, csrfToken: result.csrfToken, expiresAt: result.expiresAt } });
  });

  router.get("/session", requireAuth, async (req, res) => {
    const csrfToken = createToken();
    await pool.query("UPDATE sessions SET csrf_hash = $2 WHERE id = $1", [req.auth.sessionId, hashToken(csrfToken)]);
    res.json({ data: { user: req.auth.user, csrfToken, expiresAt: req.auth.expiresAt } });
  });

  router.post("/logout", requireAuth, requireCsrf, async (req, res) => {
    await withTransaction(async (client) => {
      await client.query("DELETE FROM sessions WHERE id = $1", [req.auth.sessionId]);
      await writeAudit(client, { userId: req.auth.user.id, action: "auth.logout", targetType: "session", targetId: req.auth.sessionId, req });
    });
    res.setHeader("Set-Cookie", serialize(env.sessionCookieName, "", cookieOptions(0)));
    res.status(204).end();
  });

  return router;
}
