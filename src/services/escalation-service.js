import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";

export async function listEscalationPolicies() {
  const result = await pool.query(
    `SELECT id, name, description, device_group_id, escalation_minutes,
            escalate_to_group, enabled, created_at, updated_at
     FROM alert_escalation_policies
     ORDER BY name ASC`
  );
  return result.rows;
}

export async function getEscalationPolicy(id) {
  const result = await pool.query(
    `SELECT id, name, description, device_group_id, escalation_minutes,
            escalate_to_group, enabled, created_at, updated_at
     FROM alert_escalation_policies WHERE id = $1`,
    [id]
  );
  if (!result.rows[0]) throw notFound("Escalation policy not found");
  return result.rows[0];
}

export async function createEscalationPolicy(input, req) {
  return withTransaction(async (client) => {
    const id = randomUUID();
    const result = await client.query(
      `INSERT INTO alert_escalation_policies
       (id, name, description, device_group_id, escalation_minutes, escalate_to_group, enabled, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
       RETURNING id, name, description, device_group_id, escalation_minutes, escalate_to_group, enabled, created_at`,
      [id, input.name, input.description || null, input.deviceGroupId || null, input.escalationMinutes, input.escalateToGroup || null, req.auth.user.id]
    );
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "escalation_policy.created",
      targetType: "escalation_policy",
      targetId: id,
      metadata: { name: input.name },
      req
    });
    return result.rows[0];
  });
}

export async function updateEscalationPolicy(id, input, req) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE alert_escalation_policies
       SET name = $2, description = $3, escalation_minutes = $4,
           escalate_to_group = $5, enabled = $6, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, description, escalation_minutes, escalate_to_group, enabled, updated_at`,
      [id, input.name, input.description || null, input.escalationMinutes, input.escalateToGroup || null, input.enabled]
    );
    if (!result.rows[0]) throw notFound("Escalation policy not found");
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "escalation_policy.updated",
      targetType: "escalation_policy",
      targetId: id,
      metadata: { name: input.name },
      req
    });
    return result.rows[0];
  });
}

export async function deleteEscalationPolicy(id, req) {
  return withTransaction(async (client) => {
    const result = await client.query("DELETE FROM alert_escalation_policies WHERE id = $1 RETURNING name", [id]);
    if (!result.rows[0]) throw notFound("Escalation policy not found");
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "escalation_policy.deleted",
      targetType: "escalation_policy",
      targetId: id,
      req
    });
  });
}

export async function recordEscalation(alertId, policyId, level) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO alert_escalation_history (id, alert_id, policy_id, escalation_level)
     VALUES ($1, $2, $3, $4)`,
    [id, alertId, policyId, level]
  );
  return id;
}

export async function getAlertEscalationHistory(alertId) {
  const result = await pool.query(
    `SELECT aeh.id, aeh.alert_id, aeh.escalation_level, aep.name AS policy_name,
            aeh.notified_at, aeh.created_at
     FROM alert_escalation_history aeh
     LEFT JOIN alert_escalation_policies aep ON aep.id = aeh.policy_id
     WHERE aeh.alert_id = $1
     ORDER BY aeh.created_at DESC`,
    [alertId]
  );
  return result.rows;
}

export async function getApplicableEscalationPolicies(deviceId) {
  const result = await pool.query(
    `SELECT aep.id, aep.name, aep.escalation_minutes, aep.escalate_to_group
     FROM alert_escalation_policies aep
     LEFT JOIN device_group_members dgm ON dgm.group_id = aep.device_group_id
     WHERE aep.enabled = TRUE
     AND (aep.device_group_id IS NULL OR dgm.device_id = $1)
     ORDER BY aep.escalation_minutes ASC`,
    [deviceId]
  );
  return result.rows;
}
