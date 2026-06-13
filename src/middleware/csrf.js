import { safeTokenEqual } from "../lib/crypto.js";
import { forbidden } from "../lib/errors.js";

export function requireCsrf(req, _res, next) {
  const token = req.get("x-csrf-token");
  if (!req.auth || !safeTokenEqual(token, req.auth.csrfHash)) return next(forbidden("Invalid CSRF token"));
  next();
}
