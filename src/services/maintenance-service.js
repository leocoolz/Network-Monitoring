import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";

export async function listMaintenanceWindows(filters = {}) {
  let query = `SELECT id, title, description, device_group_id, device_id,
                      start_time, end_time, status, suppress_alerts, created_at
               FROM maintenance_windows
               WHERE 1=1`;
  const values = [];

  if (filters.status) {
    query += ` AND status = $${values.length + 1}`;
    values.push(filters.status);
  }
  if (filters.onlyActive) {
    query += ` AND status IN ('scheduled', 'active')`;
  }

  query += ` ORDER BY start_time DESC`;

  const result = await pool.query(query, values);
  return result.rows;
}

export async function createMaintenanceWindow(input, req) {
  const startTime = new Date(input.startTime);
  const endTime = new Date(input.endTime);

  if (endTime <= startTime) {
    throw badRequest("End time must be after start time");
  }

  return withTransaction(async (client) => {
    const id = randomUUID();
    const result = await client.query(
      `INSERT INTO maintenance_windows
       (id, title, description, device_group_id, device_id, start_time, end_time,
        status, suppress_alerts, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9)
       RETURNING id, title, description, device_group_id, device_id, start_time, end_time, status, suppress_alerts, created_at`,
      [
        id,
        input.title,
        input.description || null,
        input.deviceGroupId || null,
        input.deviceId || null,
        startTime,
        endTime,
        input.suppressAlerts !== false,
        req.auth.user.id
      ]
    );
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "maintenance_window.created",
      targetType: "maintenance_window",
      targetId: id,
      metadata: { title: input.title, startTime, endTime },
      req
    });
    return result.rows[0];
  });
}

export async function updateMaintenanceWindow(id, input, req) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE maintenance_windows
       SET title = $2, description = $3, start_time = $4, end_time = $5, updated_at = NOW()
       WHERE id = $1
       RETURNING id, title, description, start_time, end_time, status, updated_at`,
      [id, input.title, input.description || null, new Date(input.startTime), new Date(input.endTime)]
    );
    if (!result.rows[0]) throw notFound("Maintenance window not found");
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "maintenance_window.updated",
      targetType: "maintenance_window",
      targetId: id,
      metadata: { title: input.title },
      req
    });
    return result.rows[0];
  });
}

export async function cancelMaintenanceWindow(id, req) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE maintenance_windows SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status IN ('scheduled', 'active')
       RETURNING id, title, status`,
      [id]
    );
    if (!result.rows[0]) throw notFound("Maintenance window not found or already completed");
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "maintenance_window.cancelled",
      targetType: "maintenance_window",
      targetId: id,
      req
    });
    return result.rows[0];
  });
}

export async function updateMaintenanceWindowStatus() {
  await pool.query(
    `UPDATE maintenance_windows SET status = 'active'
     WHERE status = 'scheduled' AND start_time <= NOW() AND end_time > NOW()`
  );
  await pool.query(
    `UPDATE maintenance_windows SET status = 'completed'
     WHERE status = 'active' AND end_time <= NOW()`
  );
}

export async function isDeviceUnderMaintenance(deviceId) {
  const result = await pool.query(
    `SELECT 1 FROM maintenance_windows
     WHERE suppress_alerts = TRUE
     AND status = 'active'
     AND (device_id = $1
          OR device_group_id IN (
            SELECT group_id FROM device_group_members WHERE device_id = $1
          ))
     LIMIT 1`,
    [deviceId]
  );
  return result.rowCount > 0;
}

export async function isGroupUnderMaintenance(groupId) {
  const result = await pool.query(
    `SELECT 1 FROM maintenance_windows
     WHERE suppress_alerts = TRUE
     AND status = 'active'
     AND device_group_id = $1
     LIMIT 1`,
    [groupId]
  );
  return result.rowCount > 0;
}
