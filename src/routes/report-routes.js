import { Router } from "express";
import { z } from "zod";
import * as reportService from "../services/report-service.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/auth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";

const reportSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  reportType: z.enum(["sla", "uptime", "traffic", "incidents", "custom"]),
  deviceGroupId: z.string().uuid().optional().nullable(),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annually"]),
  format: z.enum(["pdf", "csv", "html", "email"]),
  recipients: z.array(z.string().email()).min(1)
});

const slaReportSchema = z.object({
  groupId: z.string().uuid(),
  startDate: z.string().date(),
  endDate: z.string().date()
});

export function createReportRouter() {
  const router = Router();
  router.use(requireAuth);

  // List scheduled reports
  router.get("/", requireRole("admin", "operator"), async (_req, res) => {
    const reports = await reportService.listScheduledReports();
    res.json({ data: reports });
  });

  // Create scheduled report
  router.post("/", requireRole("admin"), requireCsrf, validate(reportSchema), async (req, res) => {
    const report = await reportService.createScheduledReport(req.body, req);
    res.status(201).json({ data: report });
  });

  // Update scheduled report
  router.patch("/:id", requireRole("admin"), requireCsrf, validate(reportSchema), async (req, res) => {
    const report = await reportService.updateScheduledReport(req.params.id, req.body, req);
    res.json({ data: report });
  });

  // Delete scheduled report
  router.delete("/:id", requireRole("admin"), requireCsrf, async (req, res) => {
    await reportService.deleteScheduledReport(req.params.id, req);
    res.json({ message: "Report deleted" });
  });

  // Get SLA report
  router.post("/sla/generate", requireRole("admin", "operator"), validate(slaReportSchema), async (req, res) => {
    const data = await reportService.getSLAReport(req.body.groupId, req.body.startDate, req.body.endDate);
    res.json({ data });
  });

  // Get uptime report
  router.post("/uptime/generate", requireRole("admin", "operator"), validate(slaReportSchema), async (req, res) => {
    const data = await reportService.getUptimeReport(req.body.groupId, req.body.startDate, req.body.endDate);
    res.json({ data });
  });

  // Get traffic report
  router.post("/traffic/generate", requireRole("admin", "operator"), validate(slaReportSchema), async (req, res) => {
    const data = await reportService.getTrafficReport(req.body.groupId, req.body.startDate, req.body.endDate);
    res.json({ data });
  });

  return router;
}
