import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, withTransaction } from "../db/pool.js";
import { hashPassword } from "../lib/crypto.js";

const seedEnvSchema = z.object({
  ADMIN_USERNAME: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,64}$/),
  ADMIN_PASSWORD: z.string().min(14).max(128),
  ADMIN_DISPLAY_NAME: z.string().trim().min(2).max(120),
  ADMIN_EMAIL: z.string().trim().toLowerCase().email().max(254)
});

const devices = [
  ["CCR-Core-01", "MikroTik CCR2004", "Router", "RT", "10.10.0.1", "Data Center - Rack A1", "online", "snmp", 24, 38, 624, 1.2, 11107440],
  ["FortiGate 100F", "Fortinet FG-100F", "Firewall", "FW", "10.10.0.2", "Data Center - Rack A1", "warning", "api", 86, 64, 866, 1.8, 7977600],
  ["SW-Core-01", "Cisco Catalyst 9300", "Switch", "SW", "10.10.1.1", "Data Center - Rack A2", "online", "snmp", 31, 42, 1820, 1.4, 11107440],
  ["AP-Lobby-01", "UniFi U6 Pro", "Access Point", "AP", "10.10.20.11", "Lobby - Ground Floor", "online", "api", 18, 45, 182, 3.6, 3016800],
  ["RADIO-WH-01", "Cambium ePMP 3000", "Radio WiFi", "RW", "10.10.30.5", "Warehouse - Tower", "warning", "snmp", 54, 51, 96, 8.7, 1836000],
  ["SRV-ERP-01", "Dell PowerEdge R750", "Server", "SV", "10.10.10.21", "Data Center - Rack B1", "online", "tcp", 42, 71, 312, 0.9, 5830800],
  ["NVR-PRIMARY", "Hikvision DS-9632NI", "NVR", "NV", "10.10.40.10", "Security Room", "online", "api", 36, 58, 246, 2.1, 3949200],
  ["CCTV-GATE-02", "Hikvision DS-2CD", "CCTV", "CC", "10.10.41.32", "Main Gate", "offline", "onvif", 0, 0, 0, null, 0],
  ["PRN-FINANCE-01", "HP LaserJet M507", "Printer", "PR", "10.10.50.14", "Finance - Floor 2", "online", "snmp", 11, 33, 1.2, 4.2, 958320],
  ["PC-NOC-04", "Dell OptiPlex 7010", "Computer", "PC", "10.10.60.44", "NOC Room", "online", "icmp", 47, 68, 42, 2.8, 392400],
  ["AP-MEETING-02", "Aruba AP-515", "Access Point", "AP", "10.10.20.22", "Meeting Room - Floor 3", "online", "snmp", 22, 39, 136, 3.1, 2570400],
  ["SW-ACCESS-07", "Cisco CBS350", "Switch", "SW", "10.10.1.17", "Office - Floor 4", "online", "snmp", 28, 36, 418, 2.3, 4788000]
];

async function seed() {
  const admin = seedEnvSchema.parse(process.env);
  const passwordHash = await hashPassword(admin.ADMIN_PASSWORD);

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO users (id, username, password_hash, display_name, email, role)
       VALUES ($1, $2, $3, $4, $5, 'admin')
       ON CONFLICT (username) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         display_name = EXCLUDED.display_name,
         email = EXCLUDED.email,
         role = 'admin',
         is_active = TRUE,
         updated_at = NOW()`,
      [randomUUID(), admin.ADMIN_USERNAME, passwordHash, admin.ADMIN_DISPLAY_NAME, admin.ADMIN_EMAIL]
    );

    for (const device of devices) {
      await client.query(
        `INSERT INTO devices (
          id, name, model, type, code, ip_address, location, status, monitoring_method,
          cpu_percent, memory_percent, traffic_mbps, latency_ms, uptime_seconds, last_seen_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (name) DO UPDATE SET
          model = EXCLUDED.model, type = EXCLUDED.type, code = EXCLUDED.code,
          ip_address = EXCLUDED.ip_address, location = EXCLUDED.location,
          monitoring_method = EXCLUDED.monitoring_method, updated_at = NOW()`,
        [randomUUID(), ...device, device[6] === 'offline' ? null : new Date()]
      );
    }

    const adminId = (await client.query("SELECT id FROM users WHERE username = $1", [admin.ADMIN_USERNAME])).rows[0].id;
    const deviceIds = new Map((await client.query("SELECT id, name FROM devices")).rows.map((row) => [row.name, row.id]));
    const alertCount = Number((await client.query("SELECT COUNT(*) AS count FROM alerts")).rows[0].count);
    if (alertCount === 0) {
      const alertRows = [
        ["CCTV-GATE-02", "critical", "Device unreachable", "No response for 2 minutes", "new", null],
        ["FortiGate 100F", "warning", "High CPU utilization", "CPU usage reached 86%", "acknowledged", adminId],
        ["RADIO-WH-01", "warning", "High wireless interference", "Noise floor above -72 dBm", "investigating", null],
        ["SW-Core-01", "info", "Configuration changed", "Running configuration modified by administrator", "acknowledged", adminId]
      ];
      for (const [deviceName, severity, title, detail, status, acknowledgedBy] of alertRows) {
        await client.query(
          `INSERT INTO alerts (id, device_id, severity, title, detail, status, acknowledged_by, acknowledged_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), deviceIds.get(deviceName), severity, title, detail, status, acknowledgedBy, status === 'acknowledged' ? new Date() : null]
        );
      }
    }

    const trafficCount = Number((await client.query("SELECT COUNT(*) AS count FROM traffic_samples")).rows[0].count);
    if (trafficCount === 0) {
      const downloads = [310, 360, 325, 440, 415, 505, 472, 558, 530, 612, 576, 640, 606, 684, 650, 705, 672, 742, 695, 780, 732, 805, 762, 684];
      const uploads = [82, 95, 78, 114, 102, 137, 119, 144, 132, 159, 147, 171, 154, 182, 166, 194, 178, 207, 185, 218, 196, 231, 204, 183];
      const scopes = { all: 1, internet: 0.82, wan: 0.48, lan: 0.72 };
      for (const [scope, multiplier] of Object.entries(scopes)) {
        for (let index = 0; index < downloads.length; index += 1) {
          await client.query(
            `INSERT INTO traffic_samples (scope, download_mbps, upload_mbps, sampled_at)
             VALUES ($1, $2, $3, NOW() - (($4::int) * INTERVAL '2 minutes'))`,
            [scope, downloads[index] * multiplier, uploads[index] * multiplier, downloads.length - index - 1]
          );
        }
      }
    }
  });

  process.stdout.write("Database seed completed. Admin password was read from the environment and was not stored in source code.\n");
}

seed()
  .then(() => pool.end())
  .catch(async (error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    await pool.end();
    process.exitCode = 1;
  });
