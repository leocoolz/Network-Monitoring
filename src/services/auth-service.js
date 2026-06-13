import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { withTransaction } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { createToken, hashToken, verifyPassword } from "../lib/crypto.js";
import { AppError, unauthorized } from "../lib/errors.js";

const GENERIC_LOGIN_ERROR = "Username or password is incorrect";

export async function authenticate({ username, password, remember, req }) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `SELECT id, username, password_hash, display_name, email, role, is_active,
              failed_login_attempts, locked_until
       FROM users WHERE username = $1 FOR UPDATE`,
      [username]
    );
    const user = result.rows[0];
    const now = Date.now();

    if (!user) {
      await writeAudit(client, { action: "auth.login_failed", metadata: { username, reason: "invalid_credentials" }, req });
      throw unauthorized(GENERIC_LOGIN_ERROR);
    }

    if (!user.is_active) {
      await writeAudit(client, { userId: user.id, action: "auth.login_failed", metadata: { reason: "inactive_account" }, req });
      throw unauthorized(GENERIC_LOGIN_ERROR);
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > now) {
      await writeAudit(client, { userId: user.id, action: "auth.login_blocked", metadata: { reason: "account_locked" }, req });
      throw new AppError(423, "ACCOUNT_LOCKED", "Account is temporarily locked. Try again later.");
    }

    const passwordMatches = await verifyPassword(user.password_hash, password);
    if (!passwordMatches) {
      const attempts = Number(user.failed_login_attempts) + 1;
      const shouldLock = attempts >= env.loginMaxAttempts;
      await client.query(
        `UPDATE users SET failed_login_attempts = $2,
          locked_until = CASE WHEN $3 THEN NOW() + ($4::int * INTERVAL '1 millisecond') ELSE NULL END,
          updated_at = NOW() WHERE id = $1`,
        [user.id, attempts, shouldLock, env.loginLockMs]
      );
      await writeAudit(client, {
        userId: user.id,
        action: "auth.login_failed",
        metadata: { reason: "invalid_credentials", attempts, accountLocked: shouldLock },
        req
      });
      throw unauthorized(GENERIC_LOGIN_ERROR);
    }

    const token = createToken();
    const csrfToken = createToken();
    const ttl = remember ? Math.min(env.sessionTtlMs * 3, 7 * 24 * 60 * 60 * 1000) : env.sessionTtlMs;
    const expiresAt = new Date(now + ttl);
    const sessionId = randomUUID();

    await client.query("DELETE FROM sessions WHERE expires_at <= NOW()");
    await client.query(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, user.id, hashToken(token), hashToken(csrfToken), req.ip, req.get("user-agent")?.slice(0, 500) || null, expiresAt]
    );
    await client.query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    );
    await writeAudit(client, { userId: user.id, action: "auth.login_succeeded", targetType: "session", targetId: sessionId, req });

    return {
      token,
      csrfToken,
      expiresAt,
      user: publicUser(user)
    };
  });
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email,
    role: user.role
  };
}
