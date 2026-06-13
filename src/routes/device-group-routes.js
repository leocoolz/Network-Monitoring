import { Router } from "express";
import { z } from "zod";
import * as deviceGroupService from "../services/device-group-service.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";

const groupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional()
});

const memberSchema = z.object({
  deviceId: z.string().uuid()
});

export function createDeviceGroupRouter() {
  const router = Router();
  router.use(requireAuth);

  // List device groups
  router.get("/", async (_req, res) => {
    const groups = await deviceGroupService.listDeviceGroups();
    res.json({ data: groups });
  });

  // Get device group details
  router.get("/:id", async (req, res) => {
    const group = await deviceGroupService.getDeviceGroup(req.params.id);
    res.json({ data: group });
  });

  // Create device group
  router.post("/", requireRole("admin", "operator"), requireCsrf, validate(groupSchema), async (req, res) => {
    const group = await deviceGroupService.createDeviceGroup(req.body, req);
    res.status(201).json({ data: group });
  });

  // Update device group
  router.patch("/:id", requireRole("admin", "operator"), requireCsrf, validate(groupSchema), async (req, res) => {
    const group = await deviceGroupService.updateDeviceGroup(req.params.id, req.body, req);
    res.json({ data: group });
  });

  // Delete device group
  router.delete("/:id", requireRole("admin"), requireCsrf, async (req, res) => {
    await deviceGroupService.deleteDeviceGroup(req.params.id, req);
    res.json({ message: "Group deleted" });
  });

  // Get group members
  router.get("/:id/members", async (req, res) => {
    const members = await deviceGroupService.getDeviceGroupMembers(req.params.id);
    res.json({ data: members });
  });

  // Add device to group
  router.post("/:id/members", requireRole("admin", "operator"), requireCsrf, validate(memberSchema), async (req, res) => {
    await deviceGroupService.addDeviceToGroup(req.params.id, req.body.deviceId, req);
    res.json({ message: "Device added to group" });
  });

  // Remove device from group
  router.delete("/:groupId/members/:deviceId", requireRole("admin", "operator"), requireCsrf, async (req, res) => {
    await deviceGroupService.removeDeviceFromGroup(req.params.groupId, req.params.deviceId, req);
    res.json({ message: "Device removed from group" });
  });

  return router;
}
