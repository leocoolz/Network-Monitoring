import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";

export async function createTopologyLink(sourceDeviceId, targetDeviceId, relationshipType, req) {
  if (sourceDeviceId === targetDeviceId) {
    throw badRequest("Source and target device cannot be the same");
  }

  return withTransaction(async (client) => {
    const id = randomUUID();
    const result = await client.query(
      `INSERT INTO device_topology (id, source_device_id, target_device_id, relationship_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, source_device_id, target_device_id, relationship_type, created_at`,
      [id, sourceDeviceId, targetDeviceId, relationshipType]
    );
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "topology_link.created",
      targetType: "topology",
      targetId: id,
      metadata: { sourceId: sourceDeviceId, targetId: targetDeviceId, type: relationshipType },
      req
    });
    return result.rows[0];
  });
}

export async function deleteTopologyLink(id, req) {
  return withTransaction(async (client) => {
    const result = await client.query("DELETE FROM device_topology WHERE id = $1 RETURNING id", [id]);
    if (!result.rows[0]) throw notFound("Topology link not found");
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "topology_link.deleted",
      targetType: "topology",
      targetId: id,
      req
    });
  });
}

export async function getDeviceUpstreamDependencies(deviceId) {
  const result = await pool.query(
    `SELECT dt.id, dt.source_device_id, d.name, d.status, d.type
     FROM device_topology dt
     JOIN devices d ON d.id = dt.source_device_id
     WHERE dt.target_device_id = $1
     AND dt.relationship_type IN ('upstream', 'peer')`,
    [deviceId]
  );
  return result.rows;
}

export async function getDeviceDownstreamDependencies(deviceId) {
  const result = await pool.query(
    `SELECT dt.id, dt.target_device_id, d.name, d.status, d.type
     FROM device_topology dt
     JOIN devices d ON d.id = dt.target_device_id
     WHERE dt.source_device_id = $1
     AND dt.relationship_type IN ('downstream', 'peer')`,
    [deviceId]
  );
  return result.rows;
}

export async function getNetworkTopology() {
  const devices = await pool.query(
    `SELECT id, name, type, status, location, ip_address
     FROM devices WHERE enabled = TRUE ORDER BY name ASC`
  );

  const links = await pool.query(
    `SELECT id, source_device_id, target_device_id, relationship_type
     FROM device_topology
     WHERE source_device_id IN (SELECT id FROM devices WHERE enabled = TRUE)
     AND target_device_id IN (SELECT id FROM devices WHERE enabled = TRUE)`
  );

  return {
    nodes: devices.rows,
    links: links.rows
  };
}

export async function getTopologyBySite(location) {
  const devices = await pool.query(
    `SELECT id, name, type, status, location, ip_address
     FROM devices WHERE enabled = TRUE AND location = $1 ORDER BY name ASC`,
    [location]
  );

  const deviceIds = devices.rows.map((d) => d.id);
  if (deviceIds.length === 0) return { nodes: [], links: [] };

  const links = await pool.query(
    `SELECT id, source_device_id, target_device_id, relationship_type
     FROM device_topology
     WHERE (source_device_id = ANY($1::uuid[]) OR target_device_id = ANY($1::uuid[]))`,
    [deviceIds]
  );

  return {
    nodes: devices.rows,
    links: links.rows
  };
}

export async function detectCriticalPath(targetDeviceId, maxDepth = 5) {
  const result = await pool.query(
    `WITH RECURSIVE critical_path AS (
      SELECT source_device_id, target_device_id, relationship_type, 1 as depth
      FROM device_topology
      WHERE target_device_id = $1 AND relationship_type = 'upstream'
      
      UNION ALL
      
      SELECT dt.source_device_id, dt.target_device_id, dt.relationship_type, cp.depth + 1
      FROM device_topology dt
      JOIN critical_path cp ON dt.target_device_id = cp.source_device_id
      WHERE cp.depth < $2 AND dt.relationship_type = 'upstream'
    )
    SELECT DISTINCT cp.source_device_id, d.name, d.status, d.type, cp.depth
    FROM critical_path cp
    JOIN devices d ON d.id = cp.source_device_id
    ORDER BY cp.depth DESC`,
    [targetDeviceId, maxDepth]
  );
  return result.rows;
}

export async function getRedundancyInfo(deviceId) {
  const result = await pool.query(
    `SELECT dt.relationship_type, COUNT(*) as count
     FROM device_topology dt
     WHERE (dt.source_device_id = $1 OR dt.target_device_id = $1)
     AND dt.relationship_type = 'redundant'
     GROUP BY dt.relationship_type`,
    [deviceId]
  );
  return result.rows[0] || { relationship_type: "redundant", count: 0 };
}
