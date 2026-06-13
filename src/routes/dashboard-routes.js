import { Router } from "express";
import { getDashboardOverview } from "../services/dashboard-service.js";

export function createDashboardRouter() {
  const router = Router();
  router.get("/overview", async (_req, res) => res.json({ data: await getDashboardOverview() }));
  return router;
}
