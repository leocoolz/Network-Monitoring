import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.PORT = "3000";
process.env.APP_ORIGIN = "http://127.0.0.1:3000";
process.env.DATABASE_URL ||= "postgres://netra:netra_test_password@127.0.0.1:55432/netra_test";
process.env.DATABASE_SSL = "false";
process.env.TRUST_PROXY = "false";
process.env.COOKIE_SECURE = "false";
process.env.ALLOWED_DEVICE_CIDRS = "10.0.0.0/8,192.168.0.0/16";
process.env.COLLECTOR_API_KEY = "test_collector_key_with_more_than_32_characters";
process.env.LOG_LEVEL = "silent";

const { createApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { hashPassword } = await import("../src/lib/crypto.js");

const origin = process.env.APP_ORIGIN;
const agent = request.agent(createApp());
let csrfToken;
let deviceId;
let viewerAgent;
let viewerCsrfToken;

before(async () => {
  const migration = await readFile(resolve(process.cwd(), "migrations/001_initial.sql"), "utf8");
  await pool.query(migration);
  await pool.query("TRUNCATE audit_logs, traffic_samples, alerts, sessions, devices, users RESTART IDENTITY CASCADE");
  const userId = randomUUID();
  await pool.query(
    `INSERT INTO users (id, username, password_hash, display_name, email, role)
     VALUES ($1, 'admin', $2, 'Test Administrator', 'admin@test.local', 'admin')`,
    [userId, await hashPassword("correct horse battery staple")]
  );
  await pool.query(
    `INSERT INTO users (id, username, password_hash, display_name, email, role)
     VALUES ($1, 'viewer', $2, 'Test Viewer', 'viewer@test.local', 'viewer')`,
    [randomUUID(), await hashPassword("viewer password for integration tests")]
  );
  deviceId = randomUUID();
  await pool.query(
    `INSERT INTO devices (id, name, model, type, code, ip_address, location, status, monitoring_method)
     VALUES ($1, 'RTR-TEST-01', 'Virtual Router', 'Router', 'RT', '10.0.0.1', 'Test Lab', 'online', 'icmp')`,
    [deviceId]
  );
  await pool.query(
    `INSERT INTO alerts (id, device_id, severity, title, detail)
     VALUES ($1, $2, 'warning', 'Test alert', 'Integration test alert')`,
    [randomUUID(), deviceId]
  );
  await pool.query(
    "INSERT INTO traffic_samples (scope, download_mbps, upload_mbps) VALUES ('all', 100, 20), ('internet', 80, 16), ('wan', 40, 8), ('lan', 60, 12)"
  );
});

after(async () => {
  await pool.end();
});

test("readiness reports a connected database", async () => {
  const response = await request(createApp()).get("/health/ready");
  assert.equal(response.status, 200);
  assert.equal(response.body.database, "connected");
});

test("protected API rejects anonymous requests", async () => {
  const response = await agent.get("/api/dashboard/overview");
  assert.equal(response.status, 401);
});

test("login rejects invalid credentials", async () => {
  const response = await agent.post("/api/auth/login").set("Origin", origin).send({ username: "admin", password: "incorrect", remember: false });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "UNAUTHORIZED");
});

test("unsafe cross-origin requests are rejected", async () => {
  const response = await agent
    .post("/api/auth/login")
    .set("Origin", "https://attacker.invalid")
    .send({ username: "admin", password: "correct horse battery staple", remember: false });
  assert.equal(response.status, 403);
});

test("login creates a secure server-side session", async () => {
  const response = await agent
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ username: "admin", password: "correct horse battery staple", remember: false });
  assert.equal(response.status, 200);
  assert.match(response.headers["set-cookie"][0], /HttpOnly/);
  assert.match(response.headers["set-cookie"][0], /SameSite=Strict/);
  assert.equal(response.body.data.user.role, "admin");
  assert.ok(response.body.data.csrfToken);
  csrfToken = response.body.data.csrfToken;
});

test("authenticated dashboard returns database data", async () => {
  const response = await agent.get("/api/dashboard/overview");
  assert.equal(response.status, 200);
  assert.equal(response.body.data.summary.total, 1);
  assert.equal(response.body.data.devices[0].name, "RTR-TEST-01");
});

test("state-changing routes reject missing CSRF tokens", async () => {
  const response = await agent.post("/api/alerts/acknowledge").set("Origin", origin).send({});
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "FORBIDDEN");
});

test("device creation enforces the configured network allowlist", async () => {
  const response = await agent.post("/api/devices").set("Origin", origin).set("X-CSRF-Token", csrfToken).send({
    name: "PUBLIC-TARGET",
    model: "Invalid",
    type: "Server",
    code: "SV",
    ipAddress: "8.8.8.8",
    location: "Internet",
    monitoringMethod: "icmp"
  });
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /ALLOWED_DEVICE_CIDRS/);
});

test("admin can create an allowed device and acknowledge alerts", async () => {
  const createResponse = await agent.post("/api/devices").set("Origin", origin).set("X-CSRF-Token", csrfToken).send({
    name: "SW-TEST-02",
    model: "Virtual Switch",
    type: "Switch",
    code: "SW",
    ipAddress: "10.0.0.2",
    location: "Test Lab",
    monitoringMethod: "snmp"
  });
  assert.equal(createResponse.status, 201);
  const alertResponse = await agent.post("/api/alerts/acknowledge").set("Origin", origin).set("X-CSRF-Token", csrfToken).send({});
  assert.equal(alertResponse.status, 200);
  assert.equal(alertResponse.body.data.acknowledged, 1);
});

test("viewer sessions are read-only", async () => {
  viewerAgent = request.agent(createApp());
  const loginResponse = await viewerAgent
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ username: "viewer", password: "viewer password for integration tests", remember: false });
  assert.equal(loginResponse.status, 200);
  viewerCsrfToken = loginResponse.body.data.csrfToken;
  const dashboardResponse = await viewerAgent.get("/api/dashboard/overview");
  assert.equal(dashboardResponse.status, 200);
  const createResponse = await viewerAgent.post("/api/devices").set("Origin", origin).set("X-CSRF-Token", viewerCsrfToken).send({
    name: "VIEWER-DENIED",
    model: "Virtual",
    type: "Switch",
    code: "SW",
    ipAddress: "10.0.0.10",
    location: "Test",
    monitoringMethod: "icmp"
  });
  assert.equal(createResponse.status, 403);
});

test("security-sensitive actions are written to the audit trail", async () => {
  const result = await pool.query("SELECT action FROM audit_logs WHERE action IN ('auth.login_succeeded', 'device.created', 'alert.acknowledged')");
  const actions = new Set(result.rows.map((row) => row.action));
  assert.ok(actions.has("auth.login_succeeded"));
  assert.ok(actions.has("device.created"));
  assert.ok(actions.has("alert.acknowledged"));
});

test("collector ingestion requires its independent key and updates metrics", async () => {
  const rejected = await request(createApp())
    .post("/api/internal/ingest")
    .send({ devices: [{ ipAddress: "10.0.0.1", status: "warning" }] });
  assert.equal(rejected.status, 401);
  const accepted = await request(createApp())
    .post("/api/internal/ingest")
    .set("X-Collector-Key", process.env.COLLECTOR_API_KEY)
    .send({
      devices: [{ ipAddress: "10.0.0.1", status: "warning", cpuPercent: 77, memoryPercent: 44, latencyMs: 2.4, trafficMbps: 120, uptimeSeconds: 1000 }],
      traffic: [{ scope: "all", downloadMbps: 120, uploadMbps: 30 }]
    });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.data.updatedDevices, 1);
});

test("logout revokes the session", async () => {
  const response = await agent.post("/api/auth/logout").set("Origin", origin).set("X-CSRF-Token", csrfToken);
  assert.equal(response.status, 204);
  const protectedResponse = await agent.get("/api/dashboard/overview");
  assert.equal(protectedResponse.status, 401);
});
