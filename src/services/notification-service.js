import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";

export async function listNotificationChannels() {
  const result = await pool.query(`SELECT id, type, name, endpoint, is_active, created_at FROM notification_channels ORDER BY type, name ASC`);
  return result.rows;
}

export async function createNotificationChannel(input, req) {
  return withTransaction(async (client) => {
    const id = randomUUID();
    const result = await client.query(
      `INSERT INTO notification_channels (id, type, name, endpoint, created_by, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, type, name, endpoint, is_active, created_at`,
      [id, input.type, input.name, input.endpoint, req.auth.user.id]
    );
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "notification_channel.created",
      targetType: "notification_channel",
      targetId: id,
      metadata: { type: input.type, name: input.name },
      req
    });
    return result.rows[0];
  });
}

export async function deleteNotificationChannel(id, req) {
  return withTransaction(async (client) => {
    const result = await client.query("UPDATE notification_channels SET is_active = FALSE WHERE id = $1 RETURNING name", [id]);
    if (!result.rows[0]) throw notFound("Notification channel not found");
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "notification_channel.deleted",
      targetType: "notification_channel",
      targetId: id,
      req
    });
  });
}

export async function listNotificationPreferences(userId) {
  const result = await pool.query(
    `SELECT np.id, np.user_id, nc.id AS channel_id, nc.type, nc.name, np.severity, np.enabled
     FROM notification_preferences np
     JOIN notification_channels nc ON nc.id = np.channel_id
     WHERE np.user_id = $1
     ORDER BY np.severity DESC, nc.type ASC`,
    [userId]
  );
  return result.rows;
}

export async function setNotificationPreference(userId, channelId, severity, enabled, req) {
  return withTransaction(async (client) => {
    const id = randomUUID();
    const result = await client.query(
      `INSERT INTO notification_preferences (id, user_id, channel_id, severity, enabled)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, channel_id, severity) DO UPDATE SET enabled = $5, updated_at = NOW()
       RETURNING id, user_id, channel_id, severity, enabled`,
      [id, userId, channelId, severity, enabled]
    );
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "notification_preference.updated",
      targetType: "user",
      targetId: userId,
      metadata: { channelId, severity, enabled },
      req
    });
    return result.rows[0];
  });
}

export async function sendNotification({ alertId, type, recipients, message, channelId }) {
  return withTransaction(async (client) => {
    const records = [];
    for (const recipient of recipients) {
      const eventId = randomUUID();
      await client.query(
        `INSERT INTO notification_events (id, alert_id, channel_id, recipient, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [eventId, alertId, channelId, recipient]
      );
      records.push({ eventId, recipient, type, message });
    }
    return records;
  });
}

export async function logNotificationSent(eventId, status, error = null) {
  const updateFields = ["status = $2", "sent_at = NOW()"];
  const values = [eventId, status];
  if (error) {
    updateFields.push("error_message = $3");
    values.push(error);
  }
  await pool.query(`UPDATE notification_events SET ${updateFields.join(", ")} WHERE id = $1`, values);
}

export async function getNotificationPreferencesForUsers(severity = "critical") {
  const result = await pool.query(
    `SELECT DISTINCT np.user_id, u.email, nc.type, nc.endpoint, nc.name
     FROM notification_preferences np
     JOIN users u ON u.id = np.user_id
     JOIN notification_channels nc ON nc.id = np.channel_id
     WHERE (np.severity = $1 OR np.severity = 'all')
     AND np.enabled = TRUE
     AND nc.is_active = TRUE`,
    [severity]
  );
  return result.rows;
}
