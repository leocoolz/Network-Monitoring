import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";
import { badRequest, notFound } from "../lib/errors.js";
import { requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";
import { rateLimit } from "express-rate-limit";

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{14,}$/;
const passwordMessage =
  "Password must be at least 14 characters long, contain at least one uppercase letter, one lowercase letter, one number, and one special character";

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,64}$/),
  password: z.string().regex(passwordRegex, passwordMessage).max(128),
  displayName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["admin", "operator", "viewer", "auditor"])
});

const updateUserSchema = z
  .object({
    role: z.enum(["admin", "operator", "viewer", "auditor"]).optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().regex(passwordRegex, passwordMessage).max(128)
  })
  .refine((value) => value.currentPassword !== value.newPassword, { path: ["newPassword"], message: "New password must be different" });

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many password change attempts. Try again later." } }
});

export function createUserRouter() {
  const router = Router();
  router.get("/", requireRole("admin"), async (_req, res) => {
    const rows = (await pool.query("SELECT id, username, display_name, email, role, is_active, last_login_at, created_at FROM users ORDER BY username")).rows;
    res.json({ data: rows });
  });
  router.post("/", requireRole("admin"), requireCsrf, validate(createUserSchema), async (req, res) => {
    const passwordHash = await hashPassword(req.body.password);
    const user = await withTransaction(async (client) => {
      const id = randomUUID();
      const result = await client.query(
        `INSERT INTO users (id, username, password_hash, display_name, email, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, username, display_name, email, role, is_active, created_at`,
        [id, req.body.username, passwordHash, req.body.displayName, req.body.email, req.body.role]
      );
      await writeAudit(client, {
        userId: req.auth.user.id,
        action: "user.created",
        targetType: "user",
        targetId: id,
        metadata: { username: req.body.username, role: req.body.role },
        req
      });
      return result.rows[0];
    });
    res.status(201).json({ data: user });
  });
  router.patch("/:id", requireRole("admin"), requireCsrf, validate(updateUserSchema), async (req, res) => {
    if (req.params.id === req.auth.user.id && req.body.isActive === false) throw badRequest("You cannot disable your own account");
    const user = await withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE users SET role = COALESCE($2, role), is_active = COALESCE($3, is_active), updated_at = NOW()
         WHERE id = $1 RETURNING id, username, display_name, email, role, is_active`,
        [req.params.id, req.body.role || null, req.body.isActive ?? null]
      );
      if (!result.rows[0]) throw notFound("User not found");
      if (req.body.isActive === false) await client.query("DELETE FROM sessions WHERE user_id = $1", [req.params.id]);
      await writeAudit(client, { userId: req.auth.user.id, action: "user.updated", targetType: "user", targetId: req.params.id, metadata: req.body, req });
      return result.rows[0];
    });
    res.json({ data: user });
  });
  router.post("/me/password", requireCsrf, passwordLimiter, validate(changePasswordSchema), async (req, res) => {
    await withTransaction(async (client) => {
      const row = (await client.query("SELECT password_hash FROM users WHERE id = $1 FOR UPDATE", [req.auth.user.id])).rows[0];
      if (!row || !(await verifyPassword(row.password_hash, req.body.currentPassword))) throw badRequest("Current password is incorrect");
      const passwordHash = await hashPassword(req.body.newPassword);
      await client.query("UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1", [req.auth.user.id, passwordHash]);
      await client.query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", [req.auth.user.id, req.auth.sessionId]);
      await writeAudit(client, { userId: req.auth.user.id, action: "user.password_changed", targetType: "user", targetId: req.auth.user.id, req });
    });
    res.status(204).end();
  });
  return router;
}
