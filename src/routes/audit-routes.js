import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().trim().max(100).optional()
});

export function createAuditRouter() {
  const router = Router();
  router.get("/", requireRole("admin", "auditor"), validate(querySchema, "query"), async (req, res) => {
    const values = [];
    const filters = [];
    if (req.query.action) {
      values.push(req.query.action);
      filters.push(`a.action = $${values.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    values.push(req.query.limit, (req.query.page - 1) * req.query.limit);
    const rows = (
      await pool.query(
        `SELECT a.id, a.action, a.target_type, a.target_id, a.metadata,
              host(a.ip_address) AS ip_address, a.created_at,
              u.username, u.display_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       ${where} ORDER BY a.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
      )
    ).rows;
    res.json({ data: rows });
  });
  return router;
}
