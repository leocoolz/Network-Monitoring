import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";

function hashConfig(configData) {
  return createHash("sha256").update(JSON.stringify(configData)).digest("hex");
}

export async function backupDeviceConfig(deviceId, configData, backupType = "manual", req) {
  return withTransaction(async (client) => {
    const id = randomUUID();
    const configHash = hashConfig(configData);

    const result = await client.query(
      `INSERT INTO device_configurations
       (id, device_id, config_data, config_hash, backup_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, device_id, config_hash, backup_type, created_at`,
      [id, deviceId, JSON.stringify(configData), configHash, backupType, req?.auth?.user?.id || null]
    );

    if (req) {
      await writeAudit(client, {
        userId: req.auth.user.id,
        action: "device_config.backed_up",
        targetType: "device",
        targetId: deviceId,
        metadata: { backupType, configHash },
        req
      });
    }

    return result.rows[0];
  });
}

export async function getDeviceConfigHistory(deviceId, limit = 20) {
  const result = await pool.query(
    `SELECT id, device_id, config_hash, backup_type, created_by, created_at
     FROM device_configurations
     WHERE device_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [deviceId, limit]
  );
  return result.rows;
}

export async function getDeviceConfig(configId) {
  const result = await pool.query(
    `SELECT id, device_id, config_data, config_hash, backup_type, created_by, created_at
     FROM device_configurations
     WHERE id = $1`,
    [configId]
  );
  if (!result.rows[0]) throw notFound("Configuration backup not found");
  return result.rows[0];
}

export async function restoreDeviceConfig(configId, req) {
  const config = await getDeviceConfig(configId);

  return withTransaction(async (client) => {
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "device_config.restored",
      targetType: "device",
      targetId: config.device_id,
      metadata: { configId, configHash: config.config_hash },
      req
    });

    return {
      deviceId: config.device_id,
      config: JSON.parse(config.config_data),
      restoredFrom: config.created_at
    };
  });
}

export async function compareConfigs(configId1, configId2) {
  const [config1Result, config2Result] = await Promise.all([
    pool.query("SELECT config_data FROM device_configurations WHERE id = $1", [configId1]),
    pool.query("SELECT config_data FROM device_configurations WHERE id = $1", [configId2])
  ]);

  if (!config1Result.rows[0] || !config2Result.rows[0]) {
    throw notFound("One or both configuration backups not found");
  }

  const data1 = JSON.parse(config1Result.rows[0].config_data);
  const data2 = JSON.parse(config2Result.rows[0].config_data);

  const differences = {
    added: {},
    removed: {},
    modified: {}
  };

  for (const key in data2) {
    if (!(key in data1)) {
      differences.added[key] = data2[key];
    } else if (JSON.stringify(data1[key]) !== JSON.stringify(data2[key])) {
      differences.modified[key] = { old: data1[key], new: data2[key] };
    }
  }

  for (const key in data1) {
    if (!(key in data2)) {
      differences.removed[key] = data1[key];
    }
  }

  return differences;
}

export async function deleteConfigBackup(configId, req) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `DELETE FROM device_configurations WHERE id = $1
       RETURNING device_id`,
      [configId]
    );
    if (!result.rows[0]) throw notFound("Configuration backup not found");

    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "device_config.deleted",
      targetType: "device_config",
      targetId: configId,
      req
    });
  });
}

export async function getConfigChangesSummary(deviceId, days = 30) {
  const result = await pool.query(
    `SELECT 
       COUNT(*) as total_backups,
       COUNT(*) FILTER (WHERE backup_type = 'automatic') as automatic_backups,
       COUNT(*) FILTER (WHERE backup_type = 'manual') as manual_backups,
       MAX(created_at) as last_backup_at,
       COUNT(DISTINCT config_hash) as unique_configs
     FROM device_configurations
     WHERE device_id = $1
     AND created_at > NOW() - INTERVAL '1 day' * $2`,
    [deviceId, days]
  );
  return result.rows[0];
}
