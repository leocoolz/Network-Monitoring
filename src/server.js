import { createServer } from "node:http";
import { createApp } from "./app.js";
import { createWebSocketServer } from "./lib/websocket.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";

const app = createApp();
const server = createServer(app);
createWebSocketServer(server);

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;

server.listen(env.port, "0.0.0.0", () => {
  process.stdout.write(`Netra NOC listening on port ${env.port} in ${env.nodeEnv} mode\n`);
});

const cleanupTimer = setInterval(
  () => {
    pool.query("DELETE FROM sessions WHERE expires_at <= NOW()").catch((error) => {
      process.stderr.write(`Session cleanup failed: ${error.message}\n`);
    });
  },
  15 * 60 * 1000
);
cleanupTimer.unref();

async function shutdown(signal) {
  process.stdout.write(`${signal} received, shutting down gracefully\n`);
  clearInterval(cleanupTimer);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (error) => {
  process.stderr.write(`Unhandled rejection: ${error?.stack || error}\n`);
});

process.on("uncaughtException", (error) => {
  process.stderr.write(`Uncaught exception: ${error.stack || error.message}\n`);
  shutdown("UNCAUGHT_EXCEPTION");
});
