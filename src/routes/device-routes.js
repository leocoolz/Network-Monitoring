import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";
import { createDevice, disableDevice, getDevice, listDevices, updateDevice } from "../services/device-service.js";

const listSchema = z.object({
  q: z.string().trim().max(120).optional(),
  type: z.string().trim().max(40).optional(),
  status: z.enum(["online", "warning", "offline", "unknown"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

const deviceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  model: z.string().trim().min(2).max(160),
  type: z.string().trim().min(2).max(40),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,4}$/),
  ipAddress: z.string().trim().min(2).max(45),
  location: z.string().trim().min(2).max(200),
  monitoringMethod: z.enum(["icmp", "snmp", "tcp", "api", "onvif"]),
  tcpPort: z.coerce.number().int().min(1).max(65535).optional(),
  snmpCommunity: z.string().trim().min(8).max(120).optional(),
  snmpVersion: z.enum(["v1", "v2c"]).optional()
});

const createSchema = deviceSchema.extend({ snmpVersion: z.enum(["v1", "v2c"]).default("v2c") }).superRefine((value, context) => {
  if (value.monitoringMethod === "tcp" && !value.tcpPort)
    context.addIssue({ code: "custom", path: ["tcpPort"], message: "TCP port is required for TCP monitoring" });
  if (value.monitoringMethod === "snmp" && !value.snmpCommunity)
    context.addIssue({ code: "custom", path: ["snmpCommunity"], message: "SNMP community is required and must contain at least 8 characters" });
});

const updateSchema = deviceSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required")
  .superRefine((value, context) => {
    if (value.monitoringMethod === "tcp" && !value.tcpPort)
      context.addIssue({ code: "custom", path: ["tcpPort"], message: "TCP port is required when changing to TCP monitoring" });
  });

export function createDeviceRouter() {
  const router = Router();
  router.get("/", validate(listSchema, "query"), async (req, res) =>
    res.json({
      data: await listDevices({
        query: req.query.q,
        type: req.query.type,
        status: req.query.status,
        page: req.query.page,
        limit: req.query.limit
      })
    })
  );
  router.get("/:id", async (req, res) => res.json({ data: await getDevice(req.params.id) }));
  router.post("/", requireRole("admin", "operator"), requireCsrf, validate(createSchema), async (req, res) => {
    res.status(201).json({ data: await createDevice(req.body, req) });
  });
  router.patch("/:id", requireRole("admin", "operator"), requireCsrf, validate(updateSchema), async (req, res) => {
    res.json({ data: await updateDevice(req.params.id, req.body, req) });
  });
  router.delete("/:id", requireRole("admin"), requireCsrf, async (req, res) => {
    await disableDevice(req.params.id, req);
    res.status(204).end();
  });
  return router;
}
