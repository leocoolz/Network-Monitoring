import { pool } from "../db/pool.js";

export async function getDashboardOverview() {
  const [summaryResult, distributionResult, alertsResult, trafficResult, devicesResult] = await Promise.all([
    pool.query(`SELECT
      COUNT(*) FILTER (WHERE enabled) AS total,
      COUNT(*) FILTER (WHERE enabled AND status = 'online') AS online,
      COUNT(*) FILTER (WHERE enabled AND status = 'warning') AS warning,
      COUNT(*) FILTER (WHERE enabled AND status = 'offline') AS offline,
      COALESCE(AVG(traffic_mbps) FILTER (WHERE enabled), 0) AS average_traffic
      FROM devices`),
    pool.query("SELECT type, COUNT(*) AS count FROM devices WHERE enabled = TRUE GROUP BY type ORDER BY count DESC, type ASC"),
    pool.query(`SELECT a.id, a.severity, a.title, a.detail, a.status, a.created_at,
                       d.id AS device_id, d.name AS device_name, d.location
                FROM alerts a LEFT JOIN devices d ON d.id = a.device_id
                WHERE a.status <> 'resolved' ORDER BY a.created_at DESC LIMIT 20`),
    pool.query(`SELECT scope, download_mbps, upload_mbps, sampled_at FROM (
                  SELECT scope, download_mbps, upload_mbps, sampled_at,
                         ROW_NUMBER() OVER (PARTITION BY scope ORDER BY sampled_at DESC) AS position
                  FROM traffic_samples
                ) samples WHERE position <= 48 ORDER BY scope, sampled_at ASC`),
    pool.query(`SELECT id, name, model, type, code, host(ip_address) AS ip_address, location, status,
                       monitoring_method, tcp_port, cpu_percent, memory_percent, traffic_mbps,
                       latency_ms, uptime_seconds, last_seen_at
                FROM devices WHERE enabled = TRUE ORDER BY name ASC`)
  ]);

  const summary = summaryResult.rows[0];
  const total = Number(summary.total);
  const online = Number(summary.online);
  const warning = Number(summary.warning);
  const offline = Number(summary.offline);
  const health = total ? Math.max(0, ((online + warning * 0.5) / total) * 100) : 100;
  const traffic = Object.fromEntries(["all", "internet", "wan", "lan"].map((scope) => [scope, []]));
  for (const sample of trafficResult.rows) traffic[sample.scope].push(sample);

  return {
    summary: {
      total,
      online,
      warning,
      offline,
      active: online + warning,
      availability: total ? ((online + warning) / total) * 100 : 100,
      health,
      activeAlerts: alertsResult.rows.length,
      criticalAlerts: alertsResult.rows.filter((alert) => alert.severity === "critical").length,
      averageTrafficMbps: Number(summary.average_traffic)
    },
    distribution: distributionResult.rows.map((row) => ({ type: row.type, count: Number(row.count) })),
    alerts: alertsResult.rows,
    traffic,
    devices: devicesResult.rows
  };
}
