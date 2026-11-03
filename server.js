// SOS Guard — demo admin backend
// - admin/admin login (cookie session)
// - REST + WebSocket for alerts & sessions
// - LiveKit token mint (device publishes mic; admin subscribes)
// NOTE: in-memory store, demo quality. Not for production.

import express from "express";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { AccessToken } from "livekit-server-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8080;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const SESSION_SECRET = process.env.SESSION_SECRET || "demo-secret";
const LIVEKIT_URL = process.env.LIVEKIT_URL || "wss://1v.collab.name.ng";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "devkey";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "secret";

// ---- in-memory state ----
// sessions: id -> { id, deviceId, decoyName, createdAt, active, room,
//                   locations: [{lat,lng,acc,ts}], nearby: [{...}], status }
const sessions = new Map();

function sign(value) {
  const h = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  return `${value}.${h}`;
}
function verify(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  if (sign(value) === signed) return value;
  return null;
}

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());

// ---- auth ----
function requireAdmin(req, res, next) {
  const user = verify(req.cookies?.sg_session);
  if (user === ADMIN_USER) return next();
  res.status(401).json({ error: "unauthorized" });
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
    res.cookie("sg_session", sign(ADMIN_USER), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 12 * 3600 * 1000,
    });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "bad credentials" });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("sg_session");
  res.json({ ok: true });
});

app.get("/api/me", requireAdmin, (req, res) => res.json({ user: ADMIN_USER }));

// ---- device endpoints (no admin auth; demo uses a shared device token) ----
// A real build would authenticate devices. For the demo we accept a deviceId.

// Device triggers SOS -> creates a session and returns a LiveKit token to publish mic.
app.post("/api/sos", async (req, res) => {
  const { deviceId, decoyName, lat, lng, acc } = req.body || {};
  const id = crypto.randomUUID().slice(0, 8);
  const room = `sos-${id}`;
  const s = {
    id,
    deviceId: deviceId || "unknown-device",
    decoyName: decoyName || "App",
    room,
    createdAt: Date.now(),
    active: true,
    status: "SOS triggered",
    locations: [],
    nearby: [],
  };
  if (typeof lat === "number" && typeof lng === "number") {
    s.locations.push({ lat, lng, acc: acc ?? null, ts: Date.now() });
  }
  sessions.set(id, s);

  const token = await mintToken(room, `device-${s.deviceId}`, {
    canPublish: true,
    canSubscribe: false,
  });

  broadcast({ type: "alert", session: publicSession(s) });
  res.json({ sessionId: id, room, livekitUrl: LIVEKIT_URL, token });
});

// Device posts location updates.
app.post("/api/session/:id/location", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  const { lat, lng, acc } = req.body || {};
  if (typeof lat !== "number" || typeof lng !== "number")
    return res.status(400).json({ error: "lat/lng required" });
  s.locations.push({ lat, lng, acc: acc ?? null, ts: Date.now() });
  if (s.locations.length > 200) s.locations.shift();
  broadcast({ type: "location", sessionId: s.id, point: s.locations.at(-1) });
  res.json({ ok: true });
});

// Device posts nearby BT/BLE/WiFi scan (array, capped to 25).
app.post("/api/session/:id/nearby", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  const list = Array.isArray(req.body?.devices) ? req.body.devices.slice(0, 25) : [];
  s.nearby = list;
  broadcast({ type: "nearby", sessionId: s.id, devices: list });
  res.json({ ok: true, count: list.length });
});

// Device reports it has stopped.
app.post("/api/session/:id/stop", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  s.active = false;
  s.status = "ended by device";
  broadcast({ type: "ended", sessionId: s.id });
  res.json({ ok: true });
});

// ---- admin endpoints ----
app.get("/api/sessions", requireAdmin, (req, res) => {
  res.json({ sessions: [...sessions.values()].map(publicSession) });
});

app.get("/api/session/:id", requireAdmin, (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  res.json(publicSession(s, true));
});

// Admin gets a subscribe-only token to listen to the session room.
app.get("/api/session/:id/listen-token", requireAdmin, async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  const token = await mintToken(s.room, "admin-listener", {
    canPublish: false,
    canSubscribe: true,
  });
  res.json({ livekitUrl: LIVEKIT_URL, token, room: s.room });
});

// Admin ends the live call / tracking.
app.post("/api/session/:id/end", requireAdmin, (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  s.active = false;
  s.status = "ended by admin";
  broadcast({ type: "ended", sessionId: s.id });
  res.json({ ok: true });
});

function publicSession(s, full = false) {
  const base = {
    id: s.id,
    deviceId: s.deviceId,
    decoyName: s.decoyName,
    room: s.room,
    createdAt: s.createdAt,
    active: s.active,
    status: s.status,
    lastLocation: s.locations.at(-1) || null,
    nearbyCount: s.nearby.length,
  };
  if (full) {
    base.locations = s.locations;
    base.nearby = s.nearby;
  }
  return base;
}

async function mintToken(room, identity, grants) {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    ttl: "2h",
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: grants.canPublish,
    canSubscribe: grants.canSubscribe,
    canPublishData: true,
  });
  return await at.toJwt();
}

// ---- static admin UI ----
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);

// ---- WebSocket for live admin dashboard ----
const wss = new WebSocketServer({ server, path: "/ws" });
const clients = new Set();
wss.on("connection", (ws, req) => {
  const user = verify(parseCookie(req.headers.cookie)?.sg_session);
  if (user !== ADMIN_USER) {
    ws.close(1008, "unauthorized");
    return;
  }
  clients.add(ws);
  ws.send(JSON.stringify({ type: "hello", sessions: [...sessions.values()].map((s) => publicSession(s)) }));
  ws.on("close", () => clients.delete(ws));
});
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}
function parseCookie(str) {
  if (!str) return {};
  return Object.fromEntries(str.split(";").map((c) => {
    const i = c.indexOf("=");
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
  }));
}

server.listen(PORT, () => {
  console.log(`SOS Guard server on :${PORT}  (LiveKit: ${LIVEKIT_URL})`);
});
