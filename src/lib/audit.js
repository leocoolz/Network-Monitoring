export async function writeAudit(client, { userId = null, action, targetType = null, targetId = null, metadata = {}, req }) {
  await client.query(
    `INSERT INTO audit_logs (user_id, action, target_type, target_id, metadata, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, action, targetType, targetId, metadata, req.ip, req.get("user-agent")?.slice(0, 500) || null]
  );
}
