import { Router } from "express";
import { z } from "zod";
import * as escalationService from "../services/escalation-service.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";

const policySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  deviceGroupId: z.string().uuid().optional().nullable(),
  escalationMinutes: z.number().min(1),
  escalateToGroup: z.string().max(100).optional().nullable()
});

export function createEscalationRouter() {
  const router = Router();
  router.use(requireAuth);

  // List escalation policies
  router.get("/", requireRole("admin", "operator"), async (_req, res) => {
    const policies = await escalationService.listEscalationPolicies();
    res.json({ data: policies });
  });

  // Get escalation policy
  router.get("/:id", requireRole("admin", "operator"), async (req, res) => {
    const policy = await escalationService.getEscalationPolicy(req.params.id);
    res.json({ data: policy });
  });

  // Create escalation policy
  router.post("/", requireRole("admin"), requireCsrf, validate(policySchema), async (req, res) => {
    const policy = await escalationService.createEscalationPolicy(req.body, req);
    res.status(201).json({ data: policy });
  });

  // Update escalation policy
  router.patch("/:id", requireRole("admin"), requireCsrf, validate(policySchema), async (req, res) => {
    const policy = await escalationService.updateEscalationPolicy(req.params.id, req.body, req);
    res.json({ data: policy });
  });

  // Delete escalation policy
  router.delete("/:id", requireRole("admin"), requireCsrf, async (req, res) => {
    await escalationService.deleteEscalationPolicy(req.params.id, req);
    res.json({ message: "Policy deleted" });
  });

  // Get alert escalation history
  router.get("/history/:alertId", async (req, res) => {
    const history = await escalationService.getAlertEscalationHistory(req.params.alertId);
    res.json({ data: history });
  });

  return router;
}
