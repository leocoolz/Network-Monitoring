import { Router } from "express";
import { z } from "zod";
import * as notificationService from "../services/notification-service.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";

const channelSchema = z.object({
  type: z.enum(["email", "webhook", "teams", "slack", "telegram"]),
  name: z.string().min(1).max(100),
  endpoint: z.string().url().max(500)
});

const preferenceSchema = z.object({
  channelId: z.string().uuid(),
  severity: z.enum(["critical", "warning", "info", "all"]),
  enabled: z.boolean()
});

export function createNotificationRouter() {
  const router = Router();
  router.use(requireAuth);

  // List notification channels
  router.get("/channels", requireRole("admin"), async (_req, res) => {
    const channels = await notificationService.listNotificationChannels();
    res.json({ data: channels });
  });

  // Create notification channel
  router.post("/channels", requireRole("admin"), requireCsrf, validate(channelSchema), async (req, res) => {
    const channel = await notificationService.createNotificationChannel(req.body, req);
    res.status(201).json({ data: channel });
  });

  // Delete notification channel
  router.delete("/channels/:id", requireRole("admin"), requireCsrf, async (req, res) => {
    await notificationService.deleteNotificationChannel(req.params.id, req);
    res.json({ message: "Channel deleted" });
  });

  // Get user's notification preferences
  router.get("/preferences", async (req, res) => {
    const preferences = await notificationService.listNotificationPreferences(req.auth.user.id);
    res.json({ data: preferences });
  });

  // Set notification preference
  router.post("/preferences", requireCsrf, validate(preferenceSchema), async (req, res) => {
    const preference = await notificationService.setNotificationPreference(req.auth.user.id, req.body.channelId, req.body.severity, req.body.enabled, req);
    res.json({ data: preference });
  });

  return router;
}
