import { env } from "../config/env.js";
import { forbidden } from "../lib/errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireSameOrigin(req, _res, next) {
  if (SAFE_METHODS.has(req.method) || req.path.startsWith("/internal/")) return next();
  const origin = req.get("origin");
  if (!origin || origin !== env.appOrigin) return next(forbidden("Cross-origin request rejected"));
  next();
}
