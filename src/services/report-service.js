import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";

export async function listScheduledReports() {
  const result = await pool.query(
    `SELECT id, name, description, report_type, device_group_id, frequency, format,
            enabled, last_run_at, next_run_at, created_at, updated_at
     FROM scheduled_reports
     ORDER BY next_run_at ASC`
  );
  return result.rows;
}

export async function createScheduledReport(input, req) {
  return withTransaction(async (client) => {
    const id = randomUUID();
    const nextRun = calculateNextRun(input.frequency);

    const result = await client.query(
      `INSERT INTO scheduled_reports
       (id, name, description, report_type, device_group_id, frequency, format,
        recipients, enabled, next_run_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, $10)
       RETURNING id, name, description, report_type, frequency, format, enabled, next_run_at, created_at`,
      [
        id,
        input.name,
        input.description || null,
        input.reportType,
        input.deviceGroupId || null,
        input.frequency,
        input.format,
        JSON.stringify(input.recipients),
        nextRun,
        req.auth.user.id
      ]
    );

    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "scheduled_report.created",
      targetType: "scheduled_report",
      targetId: id,
      metadata: { name: input.name, reportType: input.reportType },
      req
    });

    return result.rows[0];
  });
}

export async function updateScheduledReport(id, input, req) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE scheduled_reports
       SET name = $2, description = $3, frequency = $4, format = $5,
           recipients = $6, enabled = $7, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, report_type, frequency, format, enabled, updated_at`,
      [id, input.name, input.description || null, input.frequency, input.format, JSON.stringify(input.recipients), input.enabled]
    );

    if (!result.rows[0]) throw notFound("Scheduled report not found");

    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "scheduled_report.updated",
      targetType: "scheduled_report",
      targetId: id,
      metadata: { name: input.name },
      req
    });

    return result.rows[0];
  });
}

export async function deleteScheduledReport(id, req) {
  return withTransaction(async (client) => {
    const result = await client.query("DELETE FROM scheduled_reports WHERE id = $1 RETURNING name", [id]);
    if (!result.rows[0]) throw notFound("Scheduled report not found");

    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "scheduled_report.deleted",
      targetType: "scheduled_report",
      targetId: id,
      req
    });
  });
}

export async function getReportsDue() {
  const result = await pool.query(
    `SELECT id, name, description, report_type, device_group_id, format, recipients,
            frequency, created_by
     FROM scheduled_reports
     WHERE enabled = TRUE
     AND (last_run_at IS NULL OR next_run_at <= NOW())
     ORDER BY next_run_at ASC`
  );
  return result.rows;
}

export async function markReportAsRun(reportId) {
  const frequency = (await pool.query("SELECT frequency FROM scheduled_reports WHERE id = $1", [reportId])).rows[0].frequency;
  const nextRun = calculateNextRun(frequency);

  await pool.query(
    `UPDATE scheduled_reports
     SET last_run_at = NOW(), next_run_at = $2, updated_at = NOW()
     WHERE id = $1`,
    [reportId, nextRun]
  );
}

export async function getSLAReport(groupId, startDate, endDate) {
  const result = await pool.query(
    `SELECT sh.month_year, sp.name as policy_name, d.name as device_name,
            sh.target_uptime_percent, sh.actual_uptime_percent,
            sh.total_downtime_seconds, sh.total_incidents, sh.sla_met
     FROM sla_history sh
     JOIN sla_policies sp ON sp.id = sh.policy_id
     LEFT JOIN devices d ON d.id = sh.device_id
     WHERE sp.device_group_id = $1
     AND sh.month_year BETWEEN $2 AND $3
     ORDER BY sh.month_year DESC, sp.name, d.name`,
    [groupId, startDate, endDate]
  );
  return result.rows;
}

export async function getUptimeReport(groupId, startDate, endDate) {
  const result = await pool.query(
    `SELECT d.id, d.name, d.type,
            COUNT(*) FILTER (WHERE a.status = 'resolved') as incidents,
            SUM(EXTRACT(EPOCH FROM (COALESCE(a.resolved_at, NOW()) - a.created_at)))
              FILTER (WHERE a.status = 'resolved') as total_downtime_seconds
     FROM devices d
     LEFT JOIN alerts a ON a.device_id = d.id
     LEFT JOIN device_group_members dgm ON dgm.device_id = d.id
     WHERE dgm.group_id = $1
     AND a.created_at BETWEEN $2 AND $3
     GROUP BY d.id, d.name, d.type
     ORDER BY d.name`,
    [groupId, startDate, endDate]
  );
  return result.rows;
}

export async function getTrafficReport(groupId, startDate, endDate) {
  const result = await pool.query(
    `SELECT ts.scope,
            AVG(ts.download_mbps) as avg_download_mbps,
            MAX(ts.download_mbps) as max_download_mbps,
            AVG(ts.upload_mbps) as avg_upload_mbps,
            MAX(ts.upload_mbps) as max_upload_mbps,
            COUNT(*) as sample_count
     FROM traffic_samples ts
     WHERE ts.sampled_at BETWEEN $1 AND $2
     GROUP BY ts.scope
     ORDER BY ts.scope`,
    [startDate, endDate]
  );
  return result.rows;
}

function calculateNextRun(frequency) {
  const now = new Date();
  const nextRun = new Date(now);

  switch (frequency) {
    case "daily":
      nextRun.setDate(nextRun.getDate() + 1);
      nextRun.setHours(0, 0, 0, 0);
      break;
    case "weekly":
      nextRun.setDate(nextRun.getDate() + ((1 + 7 - nextRun.getDay()) % 7));
      nextRun.setHours(0, 0, 0, 0);
      break;
    case "monthly":
      nextRun.setMonth(nextRun.getMonth() + 1);
      nextRun.setDate(1);
      nextRun.setHours(0, 0, 0, 0);
      break;
    case "quarterly": {
      const quarter = Math.floor(nextRun.getMonth() / 3);
      nextRun.setMonth((quarter + 1) * 3);
      nextRun.setDate(1);
      nextRun.setHours(0, 0, 0, 0);
      break;
    }
    case "annually":
      nextRun.setFullYear(nextRun.getFullYear() + 1);
      nextRun.setMonth(0);
      nextRun.setDate(1);
      nextRun.setHours(0, 0, 0, 0);
      break;
  }

  return nextRun;
}
