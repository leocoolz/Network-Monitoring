import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";
import { acknowledgeAlerts } from "../services/alert-service.js";

const acknowledgeSchema = z.object({ ids: z.array(z.uuid()).min(1).max(100).optional() });

export function createAlertRouter() {
  const router = Router();
  router.post("/acknowledge", requireRole("admin", "operator"), requireCsrf, validate(acknowledgeSchema), async (req, res) => {
    const count = await acknowledgeAlerts(req.body.ids, req);
    res.json({ data: { acknowledged: count } });
  });
  return router;
}
