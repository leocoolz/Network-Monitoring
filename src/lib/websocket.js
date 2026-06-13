import { WebSocket, WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";

const subscriptions = new Map(); // Map<userId, Set<channel>>
const connections = new Map(); // Map<wsId, WebSocket>

export function createWebSocketServer(server) {
  const wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", async (ws, req) => {
    const wsId = randomUUID();
    const authHeader = req.headers.cookie;

    if (!authHeader) {
      ws.close(1008, "Authentication required");
      return;
    }

    // Extract session from cookie - simplified for demo
    // In production, verify JWT or session token here
    const userId = extractUserIdFromCookie(authHeader);
    if (!userId) {
      ws.close(1008, "Invalid session");
      return;
    }

    connections.set(wsId, ws);
    subscriptions.set(wsId, { userId, channels: new Set() });

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
      [wsId, extractSessionIdFromCookie(authHeader), userId]
    );
  });

  // Setup heartbeat
  setInterval(() => {
    for (const [wsId, ws] of connections.entries()) {
      if (ws.isAlive === false) {
        ws.terminate();
        connections.delete(wsId);
        subscriptions.delete(wsId);
        return;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

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

function extractUserIdFromCookie(cookieHeader) {
  // Parse session cookie - simplified
  // In production, decrypt and validate session token
  const sessionMatch = cookieHeader.match(/session=([^;]+)/);
  return sessionMatch ? sessionMatch[1].substring(0, 36) : null;
}

function extractSessionIdFromCookie(cookieHeader) {
  const sessionMatch = cookieHeader.match(/session=([^;]+)/);
  return sessionMatch ? sessionMatch[1].substring(0, 36) : randomUUID();
}
