import { randomUUID } from "node:crypto";
import ipaddr from "ipaddr.js";
import { env } from "../config/env.js";
import { pool, withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";

const allowedRanges = env.allowedDeviceCidrs.map((cidr) => ipaddr.parseCIDR(cidr));

function normalizeIp(ip) {
  const address = ipaddr.parse(ip);
  return address.kind() === "ipv6" && address.isIPv4MappedAddress() ? address.toIPv4Address() : address;
}

export function assertAllowedDeviceIp(ip) {
  let address;
  try {
    address = normalizeIp(ip);
  } catch {
    throw badRequest("IP address is invalid");
  }
  const allowed = allowedRanges.some(([range, prefix]) => address.kind() === range.kind() && address.match(range, prefix));
  if (!allowed) throw badRequest("IP address is outside ALLOWED_DEVICE_CIDRS");
  return address.toString();
}

export async function listDevices({ query, type, status, page, limit }) {
  const filters = ["enabled = TRUE"];
  const values = [];
  if (query) {
    values.push(`%${query}%`);
    filters.push(
      `(name ILIKE $${values.length} OR model ILIKE $${values.length} OR host(ip_address) ILIKE $${values.length} OR location ILIKE $${values.length})`
    );
  }
  if (type) {
    values.push(type);
    filters.push(`type = $${values.length}`);
  }
  if (status) {
    values.push(status);
    filters.push(`status = $${values.length}`);
  }
  const where = filters.join(" AND ");
  const total = Number((await pool.query(`SELECT COUNT(*) AS count FROM devices WHERE ${where}`, values)).rows[0].count);
  values.push(limit, (page - 1) * limit);
  const rows = (
    await pool.query(
      `SELECT id, name, model, type, code, host(ip_address) AS ip_address, location, status,
            monitoring_method, tcp_port, cpu_percent, memory_percent, traffic_mbps,
            latency_ms, uptime_seconds, last_seen_at, created_at
     FROM devices WHERE ${where}
     ORDER BY name ASC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    )
  ).rows;
  return { rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

export async function getDevice(id) {
  const result = await pool.query(
    `SELECT id, name, model, type, code, host(ip_address) AS ip_address, location, status,
            monitoring_method, tcp_port, cpu_percent, memory_percent, traffic_mbps,
            latency_ms, uptime_seconds, last_seen_at, created_at, updated_at
     FROM devices WHERE id = $1 AND enabled = TRUE`,
    [id]
  );
  if (!result.rows[0]) throw notFound("Device not found");
  return result.rows[0];
}

export async function createDevice(input, req) {
  const ip = assertAllowedDeviceIp(input.ipAddress);
  return withTransaction(async (client) => {
    const id = randomUUID();
    const result = await client.query(
      `INSERT INTO devices (id, name, model, type, code, ip_address, location, monitoring_method, tcp_port)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, model, type, code, host(ip_address) AS ip_address, location, status,
                 monitoring_method, tcp_port, created_at`,
      [id, input.name, input.model, input.type, input.code, ip, input.location, input.monitoringMethod, input.tcpPort || null]
    );
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "device.created",
      targetType: "device",
      targetId: id,
      metadata: { name: input.name, ipAddress: ip, monitoringMethod: input.monitoringMethod },
      req
    });
    return result.rows[0];
  });
}

export async function disableDevice(id, req) {
  return withTransaction(async (client) => {
    const result = await client.query("UPDATE devices SET enabled = FALSE, updated_at = NOW() WHERE id = $1 AND enabled = TRUE RETURNING name", [id]);
    if (!result.rows[0]) throw notFound("Device not found");
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "device.disabled",
      targetType: "device",
      targetId: id,
      metadata: { name: result.rows[0].name },
      req
    });
  });
}
