import { AppError } from "../lib/errors.js";
import { env } from "../config/env.js";

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.path} was not found` } });
}

export function errorHandler(error, req, res, _next) {
  if (res.headersSent) return;

  if (error instanceof AppError) {
    return res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {})
      }
    });
  }

  if (error?.code === "23505") {
    return res.status(409).json({ error: { code: "CONFLICT", message: "A resource with the same unique value already exists" } });
  }

  req.log?.error({ err: error }, "Unhandled request error");
  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: env.isProduction ? "An unexpected error occurred" : error.message
    }
  });
}
