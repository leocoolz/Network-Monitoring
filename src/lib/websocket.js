import { WebSocket, WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { parse } from "cookie";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { hashToken } from "./crypto.js";

const subscriptions = new Map(); // Map<userId, Set<channel>>
const connections = new Map(); // Map<wsId, WebSocket>

export function createWebSocketServer(server) {
  const wss = new WebSocketServer({ server, path: "/api/ws", maxPayload: 8192, perMessageDeflate: false });

  wss.on("connection", async (ws, req) => {
    if (req.headers.origin !== env.appOrigin) {
      ws.close(1008, "Origin rejected");
      return;
    }
    const wsId = randomUUID();
    const authHeader = req.headers.cookie;

    if (!authHeader) {
      ws.close(1008, "Authentication required");
      return;
    }

    // Extract session from cookie
    let userId = null;
    let sessionId = null;
    try {
      const cookies = parse(authHeader);
      const token = cookies[env.sessionCookieName];
      if (token) {
        const result = await pool.query(
          `SELECT s.user_id, s.id FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.is_active = TRUE`,
          [hashToken(token)]
        );
        if (result.rows[0]) {
          userId = result.rows[0].user_id;
          sessionId = result.rows[0].id;
        }
      }
    } catch {
      // ignore parse errors
    }

    if (!userId || !sessionId) {
      ws.close(1008, "Invalid session");
      return;
    }

    connections.set(wsId, ws);
    subscriptions.set(wsId, { userId, channels: new Set() });
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleWSMessage(wsId, userId, message, ws);
      } catch (error) {
        ws.send(JSON.stringify({ type: "error", message: error.message }));
      }
    });

    ws.on("close", () => {
      connections.delete(wsId);
      subscriptions.delete(wsId);
      pool.query("DELETE FROM ws_sessions WHERE id = $1", [wsId]).catch(() => {});
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    // Send connection confirmation
    ws.send(
      JSON.stringify({
        type: "connected",
        wsId,
        userId,
        timestamp: new Date().toISOString()
      })
    );

    // Update last heartbeat
    await pool.query(
      `INSERT INTO ws_sessions (id, session_id, user_id, last_heartbeat)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (session_id) DO UPDATE SET last_heartbeat = NOW()`,
      [wsId, sessionId, userId]
    );
  });

  // Setup heartbeat
  const heartbeatTimer = setInterval(() => {
    for (const [wsId, ws] of connections.entries()) {
      if (ws.isAlive === false) {
        ws.terminate();
        connections.delete(wsId);
        subscriptions.delete(wsId);
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  heartbeatTimer.unref();
  wss.on("close", () => clearInterval(heartbeatTimer));

  return wss;
}

async function handleWSMessage(wsId, userId, message, ws) {
  const { type, channel } = message;

  switch (type) {
    case "subscribe":
      subscribeToChannel(wsId, userId, channel);
      ws.send(JSON.stringify({ type: "subscribed", channel }));
      break;

    case "unsubscribe":
      unsubscribeFromChannel(wsId, channel);
      ws.send(JSON.stringify({ type: "unsubscribed", channel }));
      break;

    case "ping":
      ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
      break;

    default:
      ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
  }
}

function subscribeToChannel(wsId, userId, channel) {
  const allowedChannels = new Set(["alert:updated", "device:status_changed", "traffic:updated", "maintenance:updated"]);
  if (!allowedChannels.has(channel)) throw new Error("Unsupported subscription channel");
  const sub = subscriptions.get(wsId);
  if (sub) {
    sub.channels.add(channel);
  }
}

function unsubscribeFromChannel(wsId, channel) {
  const sub = subscriptions.get(wsId);
  if (sub) {
    sub.channels.delete(channel);
  }
}

export function broadcastToChannel(channel, data) {
  const message = JSON.stringify({
    type: channel,
    data,
    timestamp: new Date().toISOString()
  });

  for (const [wsId, ws] of connections.entries()) {
    const sub = subscriptions.get(wsId);
    if (sub && sub.channels.has(channel) && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

export function broadcastAlertUpdate(alert) {
  broadcastToChannel("alert:updated", {
    type: "alert",
    action: "updated",
    data: alert
  });
}

export function broadcastDeviceStatusChange(device) {
  broadcastToChannel("device:status_changed", {
    type: "device",
    action: "status_changed",
    data: device
  });
}

export function broadcastTrafficUpdate(traffic) {
  broadcastToChannel("traffic:updated", {
    type: "traffic",
    action: "updated",
    data: traffic
  });
}

export function broadcastMaintenanceWindow(window) {
  broadcastToChannel("maintenance:updated", {
    type: "maintenance",
    action: "updated",
    data: window
  });
}
