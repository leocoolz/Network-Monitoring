import { Router } from "express";
import { z } from "zod";
import * as maintenanceService from "../services/maintenance-service.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";

const windowSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  deviceGroupId: z.string().uuid().optional().nullable(),
  deviceId: z.string().uuid().optional().nullable(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  suppressAlerts: z.boolean().optional().default(true)
});

const filterSchema = z.object({
  status: z.enum(["scheduled", "active", "completed", "cancelled"]).optional(),
  onlyActive: z.boolean().optional()
});

export function createMaintenanceRouter() {
  const router = Router();
  router.use(requireAuth);

  // List maintenance windows
  router.get("/", requireRole("admin", "operator"), validate(filterSchema, "query"), async (req, res) => {
    const windows = await maintenanceService.listMaintenanceWindows(req.query);
    res.json({ data: windows });
  });

  // Create maintenance window
  router.post("/", requireRole("admin", "operator"), requireCsrf, validate(windowSchema), async (req, res) => {
    const window = await maintenanceService.createMaintenanceWindow(req.body, req);
    res.status(201).json({ data: window });
  });

  // Update maintenance window
  router.patch("/:id", requireRole("admin", "operator"), requireCsrf, validate(windowSchema), async (req, res) => {
    const window = await maintenanceService.updateMaintenanceWindow(req.params.id, req.body, req);
    res.json({ data: window });
  });

  // Cancel maintenance window
  router.post("/:id/cancel", requireRole("admin", "operator"), requireCsrf, async (req, res) => {
    const window = await maintenanceService.cancelMaintenanceWindow(req.params.id, req);
    res.json({ data: window });
  });

  // Check if device is under maintenance
  router.get("/check/device/:id", async (req, res) => {
    const isUnderMaintenance = await maintenanceService.isDeviceUnderMaintenance(req.params.id);
    res.json({ isUnderMaintenance });
  });

  return router;
}
