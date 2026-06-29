import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";
import {
  listDiscoverySessions,
  getDiscoverySession,
  startDiscoverySession,
  cancelDiscoverySession,
  getDiscoveredDevices,
  getDiscoveredDevice,
  approveDiscoveredDevice,
  rejectDiscoveredDevice,
  importDiscoveredDevice,
  listDiscoverySettings,
  createDiscoverySetting,
  updateDiscoverySetting,
  deleteDiscoverySetting
} from "../services/discovery-service.js";

const startDiscoverySchema = z.object({
  targetSubnet: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/, "Invalid CIDR format"),
  scanningMethod: z.enum(["icmp", "tcp"]).optional().default("icmp")
});

const approveDeviceSchema = z.object({
  notes: z.string().max(500).optional()
});

const importDeviceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  model: z.string().max(160).optional(),
  type: z.enum(["router", "firewall", "switch", "ap", "server", "computer", "printer", "nvr", "cctv"]),
  code: z.string().length(4),
  location: z.string().max(200).optional()
});

const createSettingSchema = z.object({
  name: z.string().min(1).max(100),
  targetSubnets: z.array(z.string()),
  scanningMethods: z.array(z.enum(["icmp", "tcp"])).optional(),
  tcpPorts: z.array(z.number().int().min(1).max(65535)).optional()
});

export function createDiscoveryRouter() {
  const router = Router();

  // Discovery Sessions
  router.get("/sessions", requireAuth, requireRole("admin", "operator"), async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page || "1", 10));
      const limit = Math.min(100, parseInt(req.query.limit || "20", 10));
      const result = await listDiscoverySessions({
        page,
        limit,
        status: req.query.status,
        userId: req.auth.user.id
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get("/sessions/:id", requireAuth, requireRole("admin", "operator"), async (req, res, next) => {
    try {
      const session = await getDiscoverySession(req.params.id, req.auth.user.id);
      res.json(session);
    } catch (err) {
      next(err);
    }
  });

  router.post("/sessions", requireAuth, requireRole("admin", "operator"), requireCsrf, validate(startDiscoverySchema), async (req, res, next) => {
    try {
      const session = await startDiscoverySession(req.body, req.auth.user.id);
      res.status(201).json(session);

      // Start async discovery in background
      discoverDevicesAsync(session.id, req.body.targetSubnet, req.body.scanningMethod);
    } catch (err) {
      next(err);
    }
  });

  router.post("/sessions/:id/cancel", requireAuth, requireRole("admin", "operator"), requireCsrf, async (req, res, next) => {
    try {
      const session = await cancelDiscoverySession(req.params.id, req.auth.user.id);
      res.json(session);
    } catch (err) {
      next(err);
    }
  });

  // Discovered Devices
  router.get("/sessions/:id/devices", requireAuth, requireRole("admin", "operator"), async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page || "1", 10));
      const limit = Math.min(100, parseInt(req.query.limit || "50", 10));
      const result = await getDiscoveredDevices(req.params.id, req.auth.user.id, {
        page,
        limit,
        onlyApproved: req.query.approved === "true"
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get("/devices/:id", requireAuth, requireRole("admin", "operator"), async (req, res, next) => {
    try {
      const device = await getDiscoveredDevice(req.params.id, req.auth.user.id);
      res.json(device);
    } catch (err) {
      next(err);
    }
  });

  router.post("/devices/:id/approve", requireAuth, requireRole("admin", "operator"), requireCsrf, validate(approveDeviceSchema), async (req, res, next) => {
    try {
      const device = await approveDiscoveredDevice(req.params.id, req.auth.user.id, req.body.notes);
      res.json(device);
    } catch (err) {
      next(err);
    }
  });

  router.post("/devices/:id/reject", requireAuth, requireRole("admin", "operator"), requireCsrf, async (req, res, next) => {
    try {
      const device = await rejectDiscoveredDevice(req.params.id, req.auth.user.id);
      res.json(device);
    } catch (err) {
      next(err);
    }
  });

  router.post("/devices/:id/import", requireAuth, requireRole("admin"), requireCsrf, validate(importDeviceSchema), async (req, res, next) => {
    try {
      const device = await importDiscoveredDevice(req.params.id, req.auth.user.id, req.body);
      res.status(201).json(device);
    } catch (err) {
      next(err);
    }
  });

  // Discovery Settings
  router.get("/settings", requireAuth, requireRole("admin", "operator"), async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page || "1", 10));
      const limit = Math.min(100, parseInt(req.query.limit || "20", 10));
      const result = await listDiscoverySettings(req.auth.user.id, { page, limit });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/settings", requireAuth, requireRole("admin", "operator"), requireCsrf, validate(createSettingSchema), async (req, res, next) => {
    try {
      const setting = await createDiscoverySetting(req.body, req.auth.user.id);
      res.status(201).json(setting);
    } catch (err) {
      next(err);
    }
  });

  router.patch("/settings/:id", requireAuth, requireRole("admin", "operator"), requireCsrf, validate(createSettingSchema.partial()), async (req, res, next) => {
    try {
      const setting = await updateDiscoverySetting(req.params.id, req.auth.user.id, req.body);
      res.json(setting);
    } catch (err) {
      next(err);
    }
  });

  router.delete("/settings/:id", requireAuth, requireRole("admin", "operator"), requireCsrf, async (req, res, next) => {
    try {
      const setting = await deleteDiscoverySetting(req.params.id, req.auth.user.id);
      res.json(setting);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// Async discovery worker (runs in background after response is sent)
async function discoverDevicesAsync(sessionId, subnet, method) {
  try {
    const { getIPRange, isDiscoverySessionRunning, recordDiscoveryResult, completeDiscoverySession } = await import("../services/discovery-service.js");
    const { performICMPProbe, performTCPProbe } = await import("../lib/probe.js");
    const ips = getIPRange(subnet);
    let discovered = 0;

    for (let offset = 0; offset < ips.length; offset += 16) {
      if (!(await isDiscoverySessionRunning(sessionId))) return;
      const batch = ips.slice(offset, offset + 16);
      const outcomes = await Promise.all(
        batch.map(async (ip) => {
          try {
            const result = method === "tcp" ? await performTCPProbe(ip, 22) : await performICMPProbe(ip);
            if (result.alive) await recordDiscoveryResult(sessionId, ip, method, "success", result);
            return result.alive;
          } catch {
            return false;
          }
        })
      );
      discovered += outcomes.filter(Boolean).length;
    }

    await completeDiscoverySession(sessionId, ips.length, discovered);
  } catch (error) {
    const { failDiscoverySession } = await import("../services/discovery-service.js");
    await failDiscoverySession(sessionId, error.message);
  }
}
