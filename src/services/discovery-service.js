import { randomUUID } from "node:crypto";
import ipaddr from "ipaddr.js";
import { env } from "../config/env.js";
import { pool, withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";

export async function listDiscoverySessions({ page = 1, limit = 20, status, userId }) {
  const filters = [];
  const values = [];

  if (userId) {
    values.push(userId);
    filters.push(`user_id = $${values.length}`);
  }

  if (status) {
    values.push(status);
    filters.push(`status = $${values.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const total = Number((await pool.query(`SELECT COUNT(*) AS count FROM discovery_sessions ${where}`, values)).rows[0].count);

  values.push(limit, (page - 1) * limit);
  const rows = await pool.query(
    `SELECT id, user_id, status, host(target_subnet) AS target_subnet, scanning_method,
            total_hosts_scanned, devices_discovered, start_time, end_time, error_message, created_at, updated_at
     FROM discovery_sessions ${where}
     ORDER BY created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    rows: rows.rows,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit))
  };
}

export async function getDiscoverySession(sessionId, userId) {
  const result = await pool.query(
    `SELECT id, user_id, status, host(target_subnet) AS target_subnet, scanning_method,
            total_hosts_scanned, devices_discovered, start_time, end_time, error_message, created_at, updated_at
     FROM discovery_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );

  if (!result.rows[0]) throw notFound("Discovery session not found");
  return result.rows[0];
}

export async function startDiscoverySession(input, userId) {
  const targetSubnet = validateDiscoverySubnet(input.targetSubnet);

  const sessionId = randomUUID();

  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO discovery_sessions (id, user_id, target_subnet, scanning_method, status)
       VALUES ($1, $2, $3, $4, 'running')
       RETURNING id, user_id, status, host(target_subnet) AS target_subnet, scanning_method,
                 total_hosts_scanned, devices_discovered, start_time, created_at`,
      [sessionId, userId, targetSubnet, input.scanningMethod || "icmp"]
    );

    await writeAudit(client, {
      userId,
      action: "discovery_started",
      targetType: "discovery_session",
      targetId: sessionId,
      metadata: {
        subnet: targetSubnet,
        method: input.scanningMethod || "icmp"
      },
      req: { ip: null, get: () => null }
    });

    return result.rows[0];
  });
}

export async function cancelDiscoverySession(sessionId, userId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE discovery_sessions SET status = 'cancelled', end_time = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'running'
       RETURNING id, status, user_id`,
      [sessionId, userId]
    );

    if (!result.rows[0]) throw notFound("Discovery session not found or not running");

    await writeAudit(client, {
      userId,
      action: "discovery_cancelled",
      targetType: "discovery_session",
      targetId: sessionId,
      req: { ip: null, get: () => null }
    });

    return result.rows[0];
  });
}

export async function getDiscoveredDevices(sessionId, userId, { page = 1, limit = 50, onlyApproved = false }) {
  const filters = ["dd.discovery_session_id = $1", "ds.user_id = $2"];
  const values = [sessionId, userId];

  if (onlyApproved) {
    filters.push("is_approved = TRUE");
  }

  const where = filters.join(" AND ");
  const total = Number(
    (
      await pool.query(
        `SELECT COUNT(*) AS count FROM discovered_devices dd JOIN discovery_sessions ds ON ds.id = dd.discovery_session_id WHERE ${where}`,
        values
      )
    ).rows[0].count
  );

  values.push(limit, (page - 1) * limit);
  const rows = await pool.query(
    `SELECT dd.id, host(dd.ip_address) AS ip_address, dd.mac_address, dd.hostname, dd.device_type, dd.manufacturer,
            dd.port_open, dd.service_detected, dd.snmp_sys_name, dd.response_time_ms,
            dd.is_approved, dd.approved_at, dd.imported_as_device_id, dd.notes, dd.created_at
     FROM discovered_devices dd JOIN discovery_sessions ds ON ds.id = dd.discovery_session_id
     WHERE ${where}
     ORDER BY ip_address ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    rows: rows.rows,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit))
  };
}

export async function getDiscoveredDevice(deviceId, userId) {
  const result = await pool.query(
    `SELECT dd.id, dd.discovery_session_id, host(dd.ip_address) AS ip_address, dd.mac_address, dd.hostname, dd.device_type, dd.manufacturer,
            dd.port_open, dd.service_detected, dd.snmp_sys_description, dd.snmp_sys_name,
            dd.response_time_ms, dd.is_approved, dd.approved_at, dd.approved_by, dd.imported_as_device_id, dd.imported_at,
            dd.notes, dd.created_at, dd.updated_at
     FROM discovered_devices dd JOIN discovery_sessions ds ON ds.id = dd.discovery_session_id
     WHERE dd.id = $1 AND ds.user_id = $2`,
    [deviceId, userId]
  );

  if (!result.rows[0]) throw notFound("Discovered device not found");
  return result.rows[0];
}

export async function approveDiscoveredDevice(deviceId, userId, notes) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE discovered_devices
       SET is_approved = TRUE, approved_at = NOW(), approved_by = $1, notes = $3
       WHERE id = $2
         AND discovery_session_id IN (SELECT id FROM discovery_sessions WHERE user_id = $4)
       RETURNING id, ip_address, hostname, device_type, is_approved, approved_at`,
      [userId, deviceId, notes || null, userId]
    );

    if (!result.rows[0]) throw notFound("Discovered device not found");

    const device = result.rows[0];
    await writeAudit(client, {
      userId,
      action: "discovery_device_approved",
      targetType: "discovered_device",
      targetId: deviceId,
      metadata: {
        ip: device.ip_address,
        hostname: device.hostname
      },
      req: { ip: null, get: () => null }
    });

    return device;
  });
}

export async function rejectDiscoveredDevice(deviceId, userId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `DELETE FROM discovered_devices WHERE id = $1
         AND discovery_session_id IN (SELECT id FROM discovery_sessions WHERE user_id = $2)
       RETURNING id, ip_address, hostname`,
      [deviceId, userId]
    );

    if (!result.rows[0]) throw notFound("Discovered device not found");

    await writeAudit(client, {
      userId,
      action: "discovery_device_rejected",
      targetType: "discovered_device",
      targetId: deviceId,
      req: { ip: null, get: () => null }
    });

    return result.rows[0];
  });
}

export async function importDiscoveredDevice(discoveredDeviceId, userId, input) {
  return withTransaction(async (client) => {
    // Get discovered device
    const discovered = await client.query(
      `SELECT dd.* FROM discovered_devices dd
       JOIN discovery_sessions ds ON ds.id = dd.discovery_session_id
       WHERE dd.id = $1 AND ds.user_id = $2`,
      [discoveredDeviceId, userId]
    );

    if (!discovered.rows[0]) throw notFound("Discovered device not found");

    const device = discovered.rows[0];
    const deviceId = randomUUID();

    // Create device from discovered data
    const created = await client.query(
      `INSERT INTO devices (id, name, model, type, code, ip_address, location, monitoring_method, tcp_port)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, host(ip_address) AS ip_address, type, status, created_at`,
      [
        deviceId,
        input.name || device.hostname || device.ip_address,
        input.model || device.device_type || "Unknown",
        input.type || "router",
        input.code || "UNK",
        device.ip_address,
        input.location || "Unknown",
        device.service_detected === "SNMP" ? "snmp" : "icmp",
        device.port_open || 22
      ]
    );

    // Update discovered device with link to imported device
    await client.query(
      `UPDATE discovered_devices SET imported_as_device_id = $1, imported_at = NOW()
       WHERE id = $2`,
      [deviceId, discoveredDeviceId]
    );

    await writeAudit(client, {
      userId,
      action: "discovery_device_imported",
      targetType: "devices",
      targetId: deviceId,
      metadata: {
        fromDiscoverySession: device.discovery_session_id,
        discoveredIp: device.ip_address
      },
      req: { ip: null, get: () => null }
    });

    return created.rows[0];
  });
}

export async function recordDiscoveryResult(sessionId, ipAddress, probeType, probeResult, details) {
  await withTransaction(async (client) => {
    const discovered = await client.query(
      `INSERT INTO discovered_devices (id, discovery_session_id, ip_address, response_time_ms, service_detected)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (discovery_session_id, ip_address) DO UPDATE SET
         response_time_ms = EXCLUDED.response_time_ms,
         service_detected = EXCLUDED.service_detected,
         updated_at = NOW()
       RETURNING id`,
      [randomUUID(), sessionId, ipAddress, details.latencyMs ?? null, probeType.toUpperCase()]
    );
    await client.query(
      `INSERT INTO discovery_result_details (discovered_device_id, probe_type, probe_result, details)
       VALUES ($1, $2, $3, $4)`,
      [discovered.rows[0].id, probeType, probeResult, details]
    );
  });
}

export async function isDiscoverySessionRunning(sessionId) {
  const result = await pool.query("SELECT 1 FROM discovery_sessions WHERE id = $1 AND status = 'running'", [sessionId]);
  return result.rowCount === 1;
}

export async function completeDiscoverySession(sessionId, totalScanned, devicesFound) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE discovery_sessions
       SET status = 'completed', end_time = NOW(), total_hosts_scanned = $2, devices_discovered = $3
       WHERE id = $1 AND status = 'running'
       RETURNING id, status, total_hosts_scanned, devices_discovered, end_time`,
      [sessionId, totalScanned, devicesFound]
    );

    if (!result.rows[0]) return null;
    return result.rows[0];
  });
}

export async function failDiscoverySession(sessionId, errorMessage) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE discovery_sessions
       SET status = 'failed', end_time = NOW(), error_message = $2
       WHERE id = $1
       RETURNING id, status, error_message`,
      [sessionId, errorMessage]
    );

    if (!result.rows[0]) throw notFound("Discovery session not found");
    return result.rows[0];
  });
}

// Helper: Generate IP addresses from CIDR
export function getIPRange(cidr) {
  const normalized = validateDiscoverySubnet(cidr);
  const [range, prefix] = ipaddr.parseCIDR(normalized);
  const ips = [];

  if (range.kind() === "ipv4") {
    const parts = range.parts;
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    const rawAddress = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    const networkInt = (rawAddress & mask) >>> 0;
    const broadcastInt = networkInt | ~mask;

    for (let i = networkInt + 1; i < broadcastInt; i++) {
      const ip = [(i >>> 24) & 0xff, (i >>> 16) & 0xff, (i >>> 8) & 0xff, i & 0xff].join(".");
      ips.push(ip);
    }
  }

  return ips;
}

function validateDiscoverySubnet(cidr) {
  let range;
  let prefix;
  try {
    [range, prefix] = ipaddr.parseCIDR(cidr);
  } catch {
    throw badRequest("Invalid subnet format (use IPv4 CIDR notation like 192.168.1.0/24)");
  }
  if (range.kind() !== "ipv4") throw badRequest("Only IPv4 discovery is currently supported");
  const hostCount = prefix >= 31 ? 0 : 2 ** (32 - prefix) - 2;
  if (hostCount < 1) throw badRequest("Discovery subnet contains no usable host addresses");
  if (hostCount > env.discoveryMaxHosts) throw badRequest(`Discovery subnet exceeds the ${env.discoveryMaxHosts}-host safety limit`);

  const allowed = env.allowedDeviceCidrs.some((allowedCidr) => {
    const [allowedRange, allowedPrefix] = ipaddr.parseCIDR(allowedCidr);
    return allowedRange.kind() === "ipv4" && prefix >= allowedPrefix && range.match(allowedRange, allowedPrefix);
  });
  if (!allowed) throw badRequest("Discovery subnet is outside ALLOWED_DEVICE_CIDRS");
  const parts = range.parts;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const rawAddress = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const network = (rawAddress & mask) >>> 0;
  const networkAddress = [(network >>> 24) & 0xff, (network >>> 16) & 0xff, (network >>> 8) & 0xff, network & 0xff].join(".");
  return `${networkAddress}/${prefix}`;
}

// Discovery settings management
export async function listDiscoverySettings(userId, { page = 1, limit = 20 }) {
  const total = Number((await pool.query(`SELECT COUNT(*) AS count FROM discovery_settings WHERE user_id = $1`, [userId])).rows[0].count);

  const rows = await pool.query(
    `SELECT id, name, target_subnets, scanning_methods, tcp_ports,
            auto_import_matching, is_active, created_at, updated_at
     FROM discovery_settings WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, (page - 1) * limit]
  );

  return {
    rows: rows.rows,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit))
  };
}

export async function createDiscoverySetting(input, userId) {
  const settingId = randomUUID();

  const result = await pool.query(
    `INSERT INTO discovery_settings (id, user_id, name, target_subnets, scanning_methods, tcp_ports)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, target_subnets, scanning_methods, is_active, created_at`,
    [settingId, userId, input.name, input.targetSubnets.map(validateDiscoverySubnet), input.scanningMethods || ["icmp"], input.tcpPorts || [22, 80, 443]]
  );

  return result.rows[0];
}

export async function updateDiscoverySetting(settingId, userId, input) {
  const result = await pool.query(
    `UPDATE discovery_settings
     SET name = COALESCE($1, name), target_subnets = COALESCE($2, target_subnets),
         scanning_methods = COALESCE($3, scanning_methods),
         tcp_ports = COALESCE($4, tcp_ports), auto_import_matching = COALESCE($5, auto_import_matching),
         updated_at = NOW()
     WHERE id = $6 AND user_id = $7
     RETURNING id, name, target_subnets, scanning_methods, updated_at`,
    [input.name, input.targetSubnets?.map(validateDiscoverySubnet), input.scanningMethods, input.tcpPorts, input.autoImportMatching, settingId, userId]
  );

  if (!result.rows[0]) throw notFound("Discovery setting not found");
  return result.rows[0];
}

export async function deleteDiscoverySetting(settingId, userId) {
  const result = await pool.query(
    `DELETE FROM discovery_settings WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [settingId, userId]
  );

  if (!result.rows[0]) throw notFound("Discovery setting not found");
  return result.rows[0];
}
