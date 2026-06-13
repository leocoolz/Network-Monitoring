import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requireCollectorKey } from "../middleware/collector-auth.js";
import { validate } from "../middleware/validate.js";
import { ingestCollectorBatch } from "../services/collector-service.js";

const deviceMetricSchema = z.object({
  ipAddress: z.string().trim().min(2).max(45),
  status: z.enum(["online", "warning", "offline", "unknown"]),
  cpuPercent: z.number().min(0).max(100).nullable().optional(),
  memoryPercent: z.number().min(0).max(100).nullable().optional(),
  trafficMbps: z.number().min(0).max(100_000_000).optional(),
  latencyMs: z.number().min(0).max(3_600_000).nullable().optional(),
  uptimeSeconds: z.number().int().min(0).optional()
});

const trafficSchema = z.object({
  scope: z.enum(["all", "internet", "wan", "lan"]),
  downloadMbps: z.number().min(0).max(100_000_000),
  uploadMbps: z.number().min(0).max(100_000_000),
  sampledAt: z.iso.datetime().optional()
});

const ingestSchema = z
  .object({
    devices: z.array(deviceMetricSchema).max(500).default([]),
    traffic: z.array(trafficSchema).max(500).default([])
  })
  .refine((value) => value.devices.length > 0 || value.traffic.length > 0, "At least one metric is required");

const collectorLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

export function createCollectorRouter() {
  const router = Router();
  router.post("/ingest", collectorLimiter, requireCollectorKey, validate(ingestSchema), async (req, res) => {
    res.status(202).json({ data: await ingestCollectorBatch(req.body) });
  });
  return router;
}
