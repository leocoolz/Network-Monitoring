import { parse } from "cookie";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { hashToken } from "../lib/crypto.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { publicUser } from "../services/auth-service.js";

export async function requireAuth(req, _res, next) {
  try {
    const cookies = parse(req.headers.cookie || "");
    const token = cookies[env.sessionCookieName];
    if (!token) return next(unauthorized());

    const result = await pool.query(
      `SELECT s.id AS session_id, s.csrf_hash, s.expires_at,
              u.id, u.username, u.display_name, u.email, u.role, u.is_active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [hashToken(token)]
    );
    const record = result.rows[0];
    if (!record || !record.is_active) return next(unauthorized());

    req.auth = {
      sessionId: record.session_id,
      csrfHash: record.csrf_hash,
      expiresAt: record.expires_at,
      user: publicUser(record)
    };

    await pool.query("UPDATE sessions SET last_seen_at = NOW() WHERE id = $1", [record.session_id]);
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.auth || !roles.includes(req.auth.user.role)) return next(forbidden());
    next();
  };
}
