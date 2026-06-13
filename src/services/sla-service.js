import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";

export async function listSLAPolicies() {
  const result = await pool.query(
    `SELECT id, name, description, device_group_id, target_uptime_percent,
            response_time_minutes, resolution_time_minutes, enabled, created_at
     FROM sla_policies
     ORDER BY name ASC`
  );
  return result.rows;
}

export async function getSLAPolicy(id) {
  const result = await pool.query(
    `SELECT id, name, description, device_group_id, target_uptime_percent,
            response_time_minutes, resolution_time_minutes, enabled, created_at, updated_at
     FROM sla_policies WHERE id = $1`,
    [id]
  );
  if (!result.rows[0]) throw notFound("SLA policy not found");
  return result.rows[0];
}

export async function createSLAPolicy(input, req) {
  return withTransaction(async (client) => {
    const id = randomUUID();
    const result = await client.query(
      `INSERT INTO sla_policies
       (id, name, description, device_group_id, target_uptime_percent,
        response_time_minutes, resolution_time_minutes, enabled, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8)
       RETURNING id, name, description, device_group_id, target_uptime_percent,
                 response_time_minutes, resolution_time_minutes, enabled, created_at`,
      [
        id,
        input.name,
        input.description || null,
        input.deviceGroupId || null,
        input.targetUptimePercent,
        input.responseTimeMinutes || null,
        input.resolutionTimeMinutes || null,
        req.auth.user.id
      ]
    );
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "sla_policy.created",
      targetType: "sla_policy",
      targetId: id,
      metadata: { name: input.name, targetUptime: input.targetUptimePercent },
      req
    });
    return result.rows[0];
  });
}

export async function updateSLAPolicy(id, input, req) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE sla_policies
       SET name = $2, description = $3, target_uptime_percent = $4,
           response_time_minutes = $5, resolution_time_minutes = $6,
           enabled = $7, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, description, target_uptime_percent,
                 response_time_minutes, resolution_time_minutes, enabled, updated_at`,
      [
        id,
        input.name,
        input.description || null,
        input.targetUptimePercent,
        input.responseTimeMinutes || null,
        input.resolutionTimeMinutes || null,
        input.enabled
      ]
    );
    if (!result.rows[0]) throw notFound("SLA policy not found");
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "sla_policy.updated",
      targetType: "sla_policy",
      targetId: id,
      metadata: { name: input.name },
      req
    });
    return result.rows[0];
  });
}

export async function deleteSLAPolicy(id, req) {
  return withTransaction(async (client) => {
    const result = await client.query("DELETE FROM sla_policies WHERE id = $1 RETURNING name", [id]);
    if (!result.rows[0]) throw notFound("SLA policy not found");
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "sla_policy.deleted",
      targetType: "sla_policy",
      targetId: id,
      req
    });
  });
}

export async function recordSLAHistory(policyId, deviceId, monthYear, uptimePercent, downtimeSeconds, incidents) {
  const id = randomUUID();
  const policy = await pool.query("SELECT target_uptime_percent FROM sla_policies WHERE id = $1", [policyId]);

  if (!policy.rows[0]) return null;

  const targetUptime = Number(policy.rows[0].target_uptime_percent);
  const actualUptime = Number(uptimePercent) || 100;
  const slaMet = actualUptime >= targetUptime;

  await pool.query(
    `INSERT INTO sla_history
     (id, policy_id, device_id, month_year, target_uptime_percent, actual_uptime_percent,
      total_downtime_seconds, total_incidents, sla_met)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (policy_id, device_id, month_year)
     DO UPDATE SET actual_uptime_percent = $6, total_downtime_seconds = $7,
                   total_incidents = $8, sla_met = $9`,
    [id, policyId, deviceId || null, monthYear, targetUptime, actualUptime, downtimeSeconds, incidents, slaMet]
  );

  return id;
}

export async function getSLAHistory(filters = {}) {
  let query = `SELECT sh.id, sh.policy_id, sh.device_id, sh.month_year, sh.target_uptime_percent,
                      sh.actual_uptime_percent, sh.total_downtime_seconds, sh.total_incidents,
                      sh.sla_met, sp.name AS policy_name, d.name AS device_name
               FROM sla_history sh
               LEFT JOIN sla_policies sp ON sp.id = sh.policy_id
               LEFT JOIN devices d ON d.id = sh.device_id
               WHERE 1=1`;
  const values = [];

  if (filters.policyId) {
    query += ` AND sh.policy_id = $${values.length + 1}`;
    values.push(filters.policyId);
  }
  if (filters.deviceId) {
    query += ` AND sh.device_id = $${values.length + 1}`;
    values.push(filters.deviceId);
  }
  if (filters.slaMet !== undefined) {
    query += ` AND sh.sla_met = $${values.length + 1}`;
    values.push(filters.slaMet);
  }

  query += ` ORDER BY sh.month_year DESC LIMIT 100`;

  const result = await pool.query(query, values);
  return result.rows;
}
