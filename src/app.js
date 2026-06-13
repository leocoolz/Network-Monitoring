import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import compression from "compression";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import pino from "pino";
import pinoHttp from "pino-http";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requireSameOrigin } from "./middleware/same-origin.js";
import { createAlertRouter } from "./routes/alert-routes.js";
import { createAuditRouter } from "./routes/audit-routes.js";
import { createAuthRouter } from "./routes/auth-routes.js";
import { createCollectorRouter } from "./routes/collector-routes.js";
import { createDashboardRouter } from "./routes/dashboard-routes.js";
import { createDeviceRouter } from "./routes/device-routes.js";
import { createExportRouter } from "./routes/export-routes.js";
import { createUserRouter } from "./routes/user-routes.js";
import { createNotificationRouter } from "./routes/notification-routes.js";
import { createDeviceGroupRouter } from "./routes/device-group-routes.js";
import { createEscalationRouter } from "./routes/escalation-routes.js";
import { createMaintenanceRouter } from "./routes/maintenance-routes.js";
import { createSLARouter } from "./routes/sla-routes.js";
import { createTopologyRouter } from "./routes/topology-routes.js";
import { createReportRouter } from "./routes/report-routes.js";
import { createConfigBackupRouter } from "./routes/config-backup-routes.js";
import { createAPITokenRouter } from "./routes/api-token-routes.js";
import { createDiscoveryRouter } from "./routes/discovery-routes.js";

const publicDirectory = env.isProduction ? resolve(process.cwd(), "dist") : resolve(process.cwd(), "public");

export function createApp() {
  const app = express();
  const logger = pino({
    level: env.logLevel,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-collector-key",
        "res.headers.set-cookie",
        "password",
        "currentPassword",
        "newPassword"
      ],
      censor: "[REDACTED]"
    }
  });

  app.disable("x-powered-by");
  if (env.trustProxy) app.set("trust proxy", 1);

  app.use(
    pinoHttp({
      logger,
      genReqId(req, res) {
        const id = req.headers["x-request-id"] || randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      customLogLevel(_req, res, error) {
        if (error || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      }
    })
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: env.isProduction ? [] : null
        }
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: "no-referrer" },
      strictTransportSecurity: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false
    })
  );
  app.use(compression());
  app.use(express.json({ limit: "256kb", strict: true }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));

  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => req.path === "/health/live" || req.path === "/health/ready"
  });
  app.use(globalLimiter);

  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ready", database: "connected" });
  });

  app.use("/api/internal", createCollectorRouter());
  app.use("/api", requireSameOrigin);
  app.use("/api/auth", createAuthRouter());
  app.use("/api", requireAuth);
  app.use("/api/dashboard", createDashboardRouter());
  app.use("/api/devices", createDeviceRouter());
  app.use("/api/alerts", createAlertRouter());
  app.use("/api/export", createExportRouter());
  app.use("/api/users", createUserRouter());
  app.use("/api/audit", createAuditRouter());
  app.use("/api/notifications", createNotificationRouter());
  app.use("/api/device-groups", createDeviceGroupRouter());
  app.use("/api/escalation", createEscalationRouter());
  app.use("/api/maintenance", createMaintenanceRouter());
  app.use("/api/sla", createSLARouter());
  app.use("/api/topology", createTopologyRouter());
  app.use("/api/reports", createReportRouter());
  app.use("/api/config-backup", createConfigBackupRouter());
  app.use("/api/api-tokens", createAPITokenRouter());
  app.use("/api/discovery", createDiscoveryRouter());
  app.use("/api", notFoundHandler);

  app.use(
    express.static(publicDirectory, {
      dotfiles: "deny",
      etag: true,
      index: false,
      maxAge: env.isProduction ? "1h" : 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-store");
      }
    })
  );
  app.get("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(resolve(publicDirectory, "index.html"));
  });

  app.use(errorHandler);
  return app;
}
