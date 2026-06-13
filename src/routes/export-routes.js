import { Router } from "express";
import { pool } from "../db/pool.js";

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function createExportRouter() {
  const router = Router();
  router.get("/devices.csv", async (_req, res) => {
    const rows = (
      await pool.query(
        `SELECT name, type, model, host(ip_address) AS ip_address, location, status,
              monitoring_method, latency_ms, uptime_seconds, last_seen_at
       FROM devices WHERE enabled = TRUE ORDER BY name ASC`
      )
    ).rows;
    const header = ["Device", "Type", "Model", "IP Address", "Location", "Status", "Monitoring", "Latency ms", "Uptime seconds", "Last seen"];
    const csv = [
      header,
      ...rows.map((row) => [
        row.name,
        row.type,
        row.model,
        row.ip_address,
        row.location,
        row.status,
        row.monitoring_method,
        row.latency_ms,
        row.uptime_seconds,
        row.last_seen_at?.toISOString()
      ])
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="netra-devices-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store"
    });
    res.send(`\uFEFF${csv}`);
  });
  return router;
}
