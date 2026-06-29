import { randomUUID } from "node:crypto";
import { withTransaction } from "../db/pool.js";

export async function ingestCollectorBatch(payload) {
  return withTransaction(async (client) => {
    let updatedDevices = 0;
    let createdAlerts = 0;

    for (const metric of payload.devices) {
      const previousResult = await client.query("SELECT id, name, status FROM devices WHERE ip_address = $1 AND enabled = TRUE FOR UPDATE", [metric.ipAddress]);
      const previous = previousResult.rows[0];
      if (!previous) continue;

      await client.query(
        `UPDATE devices SET status = $2::varchar,
          cpu_percent = COALESCE($3, cpu_percent), memory_percent = COALESCE($4, memory_percent),
          traffic_mbps = COALESCE($5, traffic_mbps), latency_ms = $6,
          uptime_seconds = COALESCE($7, uptime_seconds),
          last_seen_at = CASE WHEN $2::varchar = 'offline' THEN last_seen_at ELSE NOW() END,
          updated_at = NOW() WHERE id = $1`,
        [
          previous.id,
          metric.status,
          metric.cpuPercent ?? null,
          metric.memoryPercent ?? null,
          metric.trafficMbps ?? null,
          metric.latencyMs ?? null,
          metric.uptimeSeconds ?? null
        ]
      );
      updatedDevices += 1;

      if (metric.status === "offline" && previous.status !== "offline") {
        const activeAlert = await client.query("SELECT 1 FROM alerts WHERE device_id = $1 AND title = 'Device unreachable' AND status <> 'resolved'", [
          previous.id
        ]);
        if (!activeAlert.rowCount) {
          await client.query(
            `INSERT INTO alerts (id, device_id, severity, title, detail)
             VALUES ($1, $2, 'critical', 'Device unreachable', 'Collector reported the device as unreachable')`,
            [randomUUID(), previous.id]
          );
          createdAlerts += 1;
        }
      }

      if (metric.status === "online" && previous.status === "offline") {
        await client.query(
          `UPDATE alerts SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
           WHERE device_id = $1 AND title = 'Device unreachable' AND status <> 'resolved'`,
          [previous.id]
        );
      }
    }

    for (const traffic of payload.traffic) {
      await client.query(
        `INSERT INTO traffic_samples (scope, download_mbps, upload_mbps, sampled_at)
         VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()))`,
        [traffic.scope, traffic.downloadMbps, traffic.uploadMbps, traffic.sampledAt || null]
      );
    }

    return { updatedDevices, insertedTrafficSamples: payload.traffic.length, createdAlerts };
  });
}
