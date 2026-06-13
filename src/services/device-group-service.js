import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";

export async function listDeviceGroups() {
  const result = await pool.query(`SELECT id, name, description, created_at, updated_at FROM device_groups ORDER BY name ASC`);
  return result.rows;
}

export async function getDeviceGroup(id) {
  const result = await pool.query(
    `SELECT dg.id, dg.name, dg.description, dg.created_at, dg.updated_at,
            COUNT(dgm.device_id) AS device_count
     FROM device_groups dg
     LEFT JOIN device_group_members dgm ON dgm.group_id = dg.id
     WHERE dg.id = $1
     GROUP BY dg.id`,
    [id]
  );
  if (!result.rows[0]) throw notFound("Device group not found");
  return result.rows[0];
}

export async function createDeviceGroup(input, req) {
  return withTransaction(async (client) => {
    const id = randomUUID();
    const result = await client.query(
      `INSERT INTO device_groups (id, name, description, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, created_at, updated_at`,
      [id, input.name, input.description || null, req.auth.user.id]
    );
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "device_group.created",
      targetType: "device_group",
      targetId: id,
      metadata: { name: input.name },
      req
    });
    return result.rows[0];
  });
}

export async function updateDeviceGroup(id, input, req) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE device_groups SET name = $2, description = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, description, created_at, updated_at`,
      [id, input.name, input.description || null]
    );
    if (!result.rows[0]) throw notFound("Device group not found");
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "device_group.updated",
      targetType: "device_group",
      targetId: id,
      metadata: { name: input.name },
      req
    });
    return result.rows[0];
  });
}

export async function deleteDeviceGroup(id, req) {
  return withTransaction(async (client) => {
    const result = await client.query("DELETE FROM device_groups WHERE id = $1 RETURNING name", [id]);
    if (!result.rows[0]) throw notFound("Device group not found");
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "device_group.deleted",
      targetType: "device_group",
      targetId: id,
      req
    });
  });
}

export async function getDeviceGroupMembers(groupId) {
  const result = await pool.query(
    `SELECT d.id, d.name, d.model, d.type, d.ip_address, d.status
     FROM device_group_members dgm
     JOIN devices d ON d.id = dgm.device_id
     WHERE dgm.group_id = $1
     ORDER BY d.name ASC`,
    [groupId]
  );
  return result.rows;
}

export async function addDeviceToGroup(groupId, deviceId, req) {
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO device_group_members (group_id, device_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [groupId, deviceId]
    );
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "device_group_member.added",
      targetType: "device_group",
      targetId: groupId,
      metadata: { deviceId },
      req
    });
  });
}

export async function removeDeviceFromGroup(groupId, deviceId, req) {
  return withTransaction(async (client) => {
    const result = await client.query("DELETE FROM device_group_members WHERE group_id = $1 AND device_id = $2", [groupId, deviceId]);
    if (!result.rowCount) throw notFound("Device not in group");
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "device_group_member.removed",
      targetType: "device_group",
      targetId: groupId,
      metadata: { deviceId },
      req
    });
  });
}
