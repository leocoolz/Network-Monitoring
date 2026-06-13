import { env } from "../config/env.js";
import { hashToken, safeTokenEqual } from "../lib/crypto.js";
import { unauthorized } from "../lib/errors.js";

const collectorKeyHash = env.collectorApiKey ? hashToken(env.collectorApiKey) : null;

export function requireCollectorKey(req, _res, next) {
  if (!collectorKeyHash || !safeTokenEqual(req.get("x-collector-key"), collectorKeyHash)) {
    return next(unauthorized("Invalid collector credential"));
  }
  next();
}
