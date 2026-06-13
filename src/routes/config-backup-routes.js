import { Router } from "express";
import { z } from "zod";
import * as configService from "../services/config-backup-service.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";

const backupSchema = z.object({
  deviceId: z.string().uuid(),
  configData: z.record(z.any()),
  backupType: z.enum(["manual", "automatic", "export"]).optional()
});

const compareSchema = z.object({
  configId1: z.string().uuid(),
  configId2: z.string().uuid()
});

export function createConfigBackupRouter() {
  const router = Router();
  router.use(requireAuth);

  // Get device config history
  router.get("/device/:deviceId", async (req, res) => {
    const history = await configService.getDeviceConfigHistory(req.params.deviceId);
    res.json({ data: history });
  });

  // Create backup
  router.post("/", requireRole("admin", "operator"), requireCsrf, validate(backupSchema), async (req, res) => {
    const backup = await configService.backupDeviceConfig(req.body.deviceId, req.body.configData, req.body.backupType, req);
    res.status(201).json({ data: backup });
  });

  // Get specific backup
  router.get("/:id", async (req, res) => {
    const backup = await configService.getDeviceConfig(req.params.id);
    res.json({ data: backup });
  });

  // Restore from backup
  router.post("/:id/restore", requireRole("admin"), requireCsrf, async (req, res) => {
    const result = await configService.restoreDeviceConfig(req.params.id, req);
    res.json({ data: result });
  });

  // Compare two configs
  router.post("/compare", validate(compareSchema), async (req, res) => {
    const differences = await configService.compareConfigs(req.body.configId1, req.body.configId2);
    res.json({ data: differences });
  });

  // Delete backup
  router.delete("/:id", requireRole("admin"), requireCsrf, async (req, res) => {
    await configService.deleteConfigBackup(req.params.id, req);
    res.json({ message: "Backup deleted" });
  });

  // Get config changes summary
  router.get("/summary/device/:deviceId", async (req, res) => {
    const summary = await configService.getConfigChangesSummary(req.params.deviceId);
    res.json({ data: summary });
  });

  return router;
}
