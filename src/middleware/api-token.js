import { authenticateAPIToken } from "../services/api-token-service.js";
import { forbidden, unauthorized } from "../lib/errors.js";

export async function requireAPIToken(req, _res, next) {
  const authHeader = req.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw unauthorized("Missing API token");
  }

  const token = authHeader.slice(7);
  const tokenInfo = await authenticateAPIToken(token);

  req.auth = {
    userId: tokenInfo.userId,
    role: tokenInfo.role,
    scopes: tokenInfo.scopes,
    tokenId: tokenInfo.tokenId
  };

  next();
}

export function requireTokenScope(...allowedScopes) {
  return async (req, _res, next) => {
    if (!req.auth?.scopes) {
      throw unauthorized("API token required");
    }

    const hasScope = req.auth.scopes.includes("*") || allowedScopes.some((scope) => req.auth.scopes.includes(scope));

    if (!hasScope) {
      throw forbidden("Token does not have required permissions");
    }

    next();
  };
}
