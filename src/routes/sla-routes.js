import { Router } from "express";
import { z } from "zod";
import * as slaService from "../services/sla-service.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";

const policySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  deviceGroupId: z.string().uuid().optional().nullable(),
  targetUptimePercent: z.number().min(0).max(100),
  responseTimeMinutes: z.number().min(1).optional().nullable(),
  resolutionTimeMinutes: z.number().min(1).optional().nullable()
});

const historyFilterSchema = z.object({
  policyId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  slaMet: z.boolean().optional()
});

export function createSLARouter() {
  const router = Router();
  router.use(requireAuth);

  // List SLA policies
  router.get("/policies", requireRole("admin", "operator"), async (_req, res) => {
    const policies = await slaService.listSLAPolicies();
    res.json({ data: policies });
  });

  // Get SLA policy
  router.get("/policies/:id", requireRole("admin", "operator"), async (req, res) => {
    const policy = await slaService.getSLAPolicy(req.params.id);
    res.json({ data: policy });
  });

  // Create SLA policy
  router.post("/policies", requireRole("admin"), requireCsrf, validate(policySchema), async (req, res) => {
    const policy = await slaService.createSLAPolicy(req.body, req);
    res.status(201).json({ data: policy });
  });

  // Update SLA policy
  router.patch("/policies/:id", requireRole("admin"), requireCsrf, validate(policySchema), async (req, res) => {
    const policy = await slaService.updateSLAPolicy(req.params.id, req.body, req);
    res.json({ data: policy });
  });

  // Delete SLA policy
  router.delete("/policies/:id", requireRole("admin"), requireCsrf, async (req, res) => {
    await slaService.deleteSLAPolicy(req.params.id, req);
    res.json({ message: "Policy deleted" });
  });

  // Get SLA history
  router.get("/history", requireRole("admin", "operator"), validate(historyFilterSchema, "query"), async (req, res) => {
    const history = await slaService.getSLAHistory(req.query);
    res.json({ data: history });
  });

  return router;
}
