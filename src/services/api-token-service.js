import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { createToken, hashToken } from "../lib/crypto.js";
import { notFound, unauthorized } from "../lib/errors.js";

export async function createAPIToken(userId, input, req) {
  return withTransaction(async (client) => {
    const id = randomUUID();
    const token = createToken();
    const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000) : null;

    const result = await client.query(
      `INSERT INTO api_tokens (id, user_id, token_hash, name, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, name, scopes, expires_at, created_at`,
      [id, userId, hashToken(token), input.name, JSON.stringify(input.scopes || ["read"]), expiresAt]
    );

    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "api_token.created",
      targetType: "api_token",
      targetId: id,
      metadata: { tokenName: input.name, scopes: input.scopes },
      req
    });

    return {
      ...result.rows[0],
      token // Return the actual token only once
    };
  });
}

export async function listAPITokens(userId) {
  const result = await pool.query(
    `SELECT id, user_id, name, scopes, last_used_at, expires_at, created_at
     FROM api_tokens
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function revokeAPIToken(tokenId, req) {
  return withTransaction(async (client) => {
    const result = await client.query("DELETE FROM api_tokens WHERE id = $1 RETURNING name", [tokenId]);
    if (!result.rows[0]) throw notFound("API token not found");

    await writeAudit(client, {
      userId: req.auth.user.id,
      action: "api_token.revoked",
      targetType: "api_token",
      targetId: tokenId,
      req
    });
  });
}

export async function authenticateAPIToken(token) {
  const result = await pool.query(
    `SELECT at.id, at.user_id, at.scopes, at.expires_at, u.role
     FROM api_tokens at
     JOIN users u ON u.id = at.user_id
     WHERE at.token_hash = $1
     AND (at.expires_at IS NULL OR at.expires_at > NOW())`,
    [hashToken(token)]
  );

  if (!result.rows[0]) {
    throw unauthorized("Invalid or expired API token");
  }

  const tokenRecord = result.rows[0];

  // Update last used
  await pool.query("UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1", [tokenRecord.id]);

  return {
    tokenId: tokenRecord.id,
    userId: tokenRecord.user_id,
    role: tokenRecord.role,
    scopes: JSON.parse(tokenRecord.scopes)
  };
}

export async function hasTokenScope(scopes, requiredScope) {
  return scopes.includes(requiredScope) || scopes.includes("*");
}
