import { withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";

export async function acknowledgeAlerts(ids, req) {
  return withTransaction(async (client) => {
    const values = [req.auth.user.id];
    let condition = "status IN ('new', 'investigating')";
    if (ids?.length) {
      values.push(ids);
      condition += " AND id = ANY($2::uuid[])";
    }
    const result = await client.query(
      `UPDATE alerts SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = NOW(), updated_at = NOW()
       WHERE ${condition} RETURNING id`,
      values
    );
    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "alert.acknowledged",
      targetType: "alert",
      metadata: { count: result.rowCount, ids: ids || "all" },
      req
    });
    return result.rowCount;
  });
}
