import { Router } from "express";
import { z } from "zod";
import * as topologyService from "../services/topology-service.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";

const linkSchema = z.object({
  sourceDeviceId: z.string().uuid(),
  targetDeviceId: z.string().uuid(),
  relationshipType: z.enum(["upstream", "downstream", "peer", "redundant"])
});

export function createTopologyRouter() {
  const router = Router();
  router.use(requireAuth);

  // Get full network topology
  router.get("/", async (_req, res) => {
    const topology = await topologyService.getNetworkTopology();
    res.json({ data: topology });
  });

  // Get topology by site/location
  router.get("/site/:location", async (req, res) => {
    const topology = await topologyService.getTopologyBySite(decodeURIComponent(req.params.location));
    res.json({ data: topology });
  });

  // Create topology link
  router.post("/links", requireRole("admin", "operator"), requireCsrf, validate(linkSchema), async (req, res) => {
    const link = await topologyService.createTopologyLink(req.body.sourceDeviceId, req.body.targetDeviceId, req.body.relationshipType, req);
    res.status(201).json({ data: link });
  });

  // Delete topology link
  router.delete("/links/:id", requireRole("admin"), requireCsrf, async (req, res) => {
    await topologyService.deleteTopologyLink(req.params.id, req);
    res.json({ message: "Link deleted" });
  });

  // Get device dependencies (upstream)
  router.get("/dependencies/:deviceId/upstream", async (req, res) => {
    const dependencies = await topologyService.getDeviceUpstreamDependencies(req.params.deviceId);
    res.json({ data: dependencies });
  });

  // Get device dependents (downstream)
  router.get("/dependencies/:deviceId/downstream", async (req, res) => {
    const dependents = await topologyService.getDeviceDownstreamDependencies(req.params.deviceId);
    res.json({ data: dependents });
  });

  // Detect critical path to a device
  router.get("/critical-path/:deviceId", async (req, res) => {
    const path = await topologyService.detectCriticalPath(req.params.deviceId);
    res.json({ data: path });
  });

  // Get redundancy info
  router.get("/redundancy/:deviceId", async (req, res) => {
    const redundancy = await topologyService.getRedundancyInfo(req.params.deviceId);
    res.json({ data: redundancy });
  });

  return router;
}
