import { pool, withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";

const keyMap = Object.freeze({
  organizationName: "organization_name",
  timezone: "timezone",
  dashboardRefreshSeconds: "dashboard_refresh_seconds",
  defaultMonitoringMethod: "default_monitoring_method"
});

export async function getSettings(client) {
  const executor = client || pool;
  const rows = (await executor.query("SELECT key, value FROM app_settings WHERE key = ANY($1::varchar[])", [Object.values(keyMap)])).rows;
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return Object.fromEntries(Object.entries(keyMap).map(([property, key]) => [property, values[key]]));
}

export async function updateSettings(input, req) {
  return withTransaction(async (client) => {
    for (const [property, value] of Object.entries(input)) {
      const key = keyMap[property];
      await client.query(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [key, JSON.stringify(value), req.auth.user.id]
      );
    }
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "settings.updated",
      targetType: "application",
      metadata: { fields: Object.keys(input) },
      req
    });
    return getSettings(client);
  });
}
