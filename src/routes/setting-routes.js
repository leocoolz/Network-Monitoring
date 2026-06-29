import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";
import { getSettings, updateSettings } from "../services/setting-service.js";

const updateSchema = z
  .object({
    organizationName: z.string().trim().min(2).max(120).optional(),
    timezone: z.enum(["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "UTC"]).optional(),
    dashboardRefreshSeconds: z.number().int().min(10).max(300).optional(),
    defaultMonitoringMethod: z.enum(["icmp", "tcp", "snmp"]).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one setting is required");

export function createSettingRouter() {
  const router = Router();
  router.get("/", async (_req, res) => res.json({ data: await getSettings() }));
  router.patch("/", requireRole("admin"), requireCsrf, validate(updateSchema), async (req, res) => {
    res.json({ data: await updateSettings(req.body, req) });
  });
  return router;
}
