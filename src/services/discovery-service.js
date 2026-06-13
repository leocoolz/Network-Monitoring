import { randomUUID } from "node:crypto";
import ipaddr from "ipaddr.js";
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

export async function getDiscoverySession(sessionId) {
  const result = await pool.query(
    `SELECT id, user_id, status, host(target_subnet) AS target_subnet, scanning_method,
            total_hosts_scanned, devices_discovered, start_time, end_time, error_message, created_at, updated_at
     FROM discovery_sessions WHERE id = $1`,
    [sessionId]
  );

  if (!result.rows[0]) throw notFound("Discovery session not found");
  return result.rows[0];
}

export async function startDiscoverySession(input, userId) {
  // Validate subnet
  try {
    ipaddr.parseCIDR(input.targetSubnet);
  } catch {
    throw badRequest("Invalid subnet format (use CIDR notation like 192.168.1.0/24)");
  }

  const sessionId = randomUUID();

  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO discovery_sessions (id, user_id, target_subnet, scanning_method, status)
       VALUES ($1, $2, $3, $4, 'running')
       RETURNING id, user_id, status, host(target_subnet) AS target_subnet, scanning_method,
                 total_hosts_scanned, devices_discovered, start_time, created_at`,
      [sessionId, userId, input.targetSubnet, input.scanningMethod || "icmp"]
    );

    await writeAudit(client, userId, "discovery_started", "discovery_session", sessionId, {
      subnet: input.targetSubnet,
      method: input.scanningMethod || "icmp"
    });

    return result.rows[0];
  });
}

export async function cancelDiscoverySession(sessionId, userId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE discovery_sessions SET status = 'cancelled', end_time = NOW()
       WHERE id = $1 AND status = 'running'
       RETURNING id, status, user_id`,
      [sessionId]
    );

    if (!result.rows[0]) throw notFound("Discovery session not found or not running");

    await writeAudit(client, userId, "discovery_cancelled", "discovery_session", sessionId);

    return result.rows[0];
  });
}

export async function getDiscoveredDevices(sessionId, { page = 1, limit = 50, onlyApproved = false }) {
  const filters = ["discovery_session_id = $1"];
  const values = [sessionId];

  if (onlyApproved) {
    filters.push("is_approved = TRUE");
  }

  const where = filters.join(" AND ");
  const total = Number((await pool.query(`SELECT COUNT(*) AS count FROM discovered_devices WHERE ${where}`, values)).rows[0].count);

  values.push(limit, (page - 1) * limit);
  const rows = await pool.query(
    `SELECT id, ip_address, mac_address, hostname, device_type, manufacturer,
            port_open, service_detected, snmp_sys_name, response_time_ms,
            is_approved, approved_at, imported_as_device_id, notes, created_at
     FROM discovered_devices
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

export async function getDiscoveredDevice(deviceId) {
  const result = await pool.query(
    `SELECT id, discovery_session_id, ip_address, mac_address, hostname, device_type, manufacturer,
            port_open, service_detected, snmp_community_string, snmp_sys_description, snmp_sys_name,
            response_time_ms, is_approved, approved_at, approved_by, imported_as_device_id, imported_at,
            notes, created_at, updated_at
     FROM discovered_devices WHERE id = $1`,
    [deviceId]
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
       RETURNING id, ip_address, hostname, device_type, is_approved, approved_at`,
      [userId, deviceId, notes || null]
    );

    if (!result.rows[0]) throw notFound("Discovered device not found");

    const device = result.rows[0];
    await writeAudit(client, userId, "discovery_device_approved", "discovered_device", deviceId, {
      ip: device.ip_address,
      hostname: device.hostname
    });

    return device;
  });
}

export async function rejectDiscoveredDevice(deviceId, userId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `DELETE FROM discovered_devices WHERE id = $1
       RETURNING id, ip_address, hostname`,
      [deviceId]
    );

    if (!result.rows[0]) throw notFound("Discovered device not found");

    await writeAudit(client, userId, "discovery_device_rejected", "discovered_device", deviceId);

    return result.rows[0];
  });
}

export async function importDiscoveredDevice(discoveredDeviceId, userId, input) {
  return withTransaction(async (client) => {
    // Get discovered device
    const discovered = await client.query(`SELECT * FROM discovered_devices WHERE id = $1`, [discoveredDeviceId]);

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

    await writeAudit(client, userId, "discovery_device_imported", "devices", deviceId, {
      fromDiscoverySession: device.discovery_session_id,
      discoveredIp: device.ip_address
    });

    return created.rows[0];
  });
}

export async function recordDiscoveryResult(sessionId, ipAddress, probeType, probeResult, details) {
  await pool.query(
    `INSERT INTO discovery_result_details (discovered_device_id, probe_type, probe_result, details)
     SELECT id, $2, $3, $4 FROM discovered_devices
     WHERE discovery_session_id = $1 AND ip_address = $5`,
    [sessionId, probeType, probeResult, details, ipAddress]
  );
}

export async function completeDiscoverySession(sessionId, totalScanned, devicesFound) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE discovery_sessions
       SET status = 'completed', end_time = NOW(), total_hosts_scanned = $2, devices_discovered = $3
       WHERE id = $1
       RETURNING id, status, total_hosts_scanned, devices_discovered, end_time`,
      [sessionId, totalScanned, devicesFound]
    );

    if (!result.rows[0]) throw notFound("Discovery session not found");
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
  const [range, prefix] = ipaddr.parseCIDR(cidr);
  const ips = [];

  if (range.kind() === "ipv4") {
    const parts = range.parts;
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    const networkInt = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    const broadcastInt = networkInt | ~mask;

    for (let i = networkInt + 1; i < broadcastInt; i++) {
      const ip = [(i >>> 24) & 0xff, (i >>> 16) & 0xff, (i >>> 8) & 0xff, i & 0xff].join(".");
      ips.push(ip);
    }
  }

  return ips;
}

// Discovery settings management
export async function listDiscoverySettings(userId, { page = 1, limit = 20 }) {
  const total = Number((await pool.query(`SELECT COUNT(*) AS count FROM discovery_settings WHERE user_id = $1`, [userId])).rows[0].count);

  const rows = await pool.query(
    `SELECT id, name, target_subnets, scanning_methods, snmp_community_strings, tcp_ports,
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
    `INSERT INTO discovery_settings (id, user_id, name, target_subnets, scanning_methods)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, target_subnets, scanning_methods, is_active, created_at`,
    [settingId, userId, input.name, input.targetSubnets, input.scanningMethods || ["icmp"]]
  );

  return result.rows[0];
}

export async function updateDiscoverySetting(settingId, userId, input) {
  const result = await pool.query(
    `UPDATE discovery_settings
     SET name = $1, target_subnets = $2, scanning_methods = $3, 
         snmp_community_strings = $4, tcp_ports = $5, auto_import_matching = $6
     WHERE id = $7 AND user_id = $8
     RETURNING id, name, target_subnets, scanning_methods, updated_at`,
    [input.name, input.targetSubnets, input.scanningMethods, input.snmpCommunityStrings, input.tcpPorts, input.autoImportMatching, settingId, userId]
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
