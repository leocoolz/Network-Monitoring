import "dotenv/config";
import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.string().url().default("http://127.0.0.1:3000"),
  DATABASE_URL: z.string().min(1).default("postgres://netra:netra_dev_password@127.0.0.1:5432/netra"),
  DATABASE_SSL: booleanFromString,
  TRUST_PROXY: booleanFromString,
  COOKIE_SECURE: booleanFromString,
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(8),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  ALLOWED_DEVICE_CIDRS: z.string().default("10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"),
  COLLECTOR_API_KEY: z.string().min(32).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

if (parsed.data.NODE_ENV === "production") {
  const isLocalhost = parsed.data.APP_ORIGIN.startsWith("http://127.0.0.1") || parsed.data.APP_ORIGIN.startsWith("http://localhost");
  if (!isLocalhost && !parsed.data.COOKIE_SECURE) throw new Error("COOKIE_SECURE must be true in production");
  if (!isLocalhost && !parsed.data.APP_ORIGIN.startsWith("https://")) throw new Error("APP_ORIGIN must use HTTPS in production");
  if (!parsed.data.COLLECTOR_API_KEY) throw new Error("COLLECTOR_API_KEY is required in production");
}

export const env = Object.freeze({
  nodeEnv: parsed.data.NODE_ENV,
  isProduction: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
  port: parsed.data.PORT,
  appOrigin: new URL(parsed.data.APP_ORIGIN).origin,
  databaseUrl: parsed.data.DATABASE_URL,
  databaseSsl: parsed.data.DATABASE_SSL,
  trustProxy: parsed.data.TRUST_PROXY,
  cookieSecure: parsed.data.COOKIE_SECURE,
  sessionTtlMs: parsed.data.SESSION_TTL_HOURS * 60 * 60 * 1000,
  loginMaxAttempts: parsed.data.LOGIN_MAX_ATTEMPTS,
  loginLockMs: parsed.data.LOGIN_LOCK_MINUTES * 60 * 1000,
  allowedDeviceCidrs: parsed.data.ALLOWED_DEVICE_CIDRS.split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  collectorApiKey: parsed.data.COLLECTOR_API_KEY,
  logLevel: parsed.data.LOG_LEVEL,
  sessionCookieName: parsed.data.COOKIE_SECURE ? "__Host-netra_session" : "netra_session"
});
