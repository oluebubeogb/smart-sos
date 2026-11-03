// Now Smart SOS — admin backend
// - admin/admin login (cookie session; defaults overridable via env)
// - REST + WebSocket for alerts & sessions
// - LiveKit token mint (device/PWA publishes mic; admin subscribes)
// - Disk persistence: sessions + uploaded audio survive restart

import express from "express";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { AccessToken } from "livekit-server-sdk";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8080;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const SESSION_SECRET = process.env.SESSION_SECRET || "demo-secret";
const LIVEKIT_URL = process.env.LIVEKIT_URL || "wss://1v.collab.name.ng";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "devkey";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "secret";

const DATA_DIR = process.env.DATA_DIR || "/data";
const HISTORY_DIR = path.join(DATA_DIR, "history");
const AUDIO_DIR = path.join(DATA_DIR, "audio");
for (const d of [DATA_DIR, HISTORY_DIR, AUDIO_DIR]) {
  try { fs.mkdirSync(d, { recursive: true }); }
  catch (e) { console.error("mkdir failed for", d, e.message); }
}

const MAX_LOCATIONS = 500;
const MAX_NEARBY = 25;

const sessions = new Map();

function sign(value) {
  const h = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  return value + "." + h;
}
function verify(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  if (sign(value) === signed) return value;
  return null;
}

async function persist(s) {
  try {
    const file = path.join(HISTORY_DIR, s.id + ".json");
    const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
    await fsp.writeFile(tmp, JSON.stringify(s));
    await fsp.rename(tmp, file);
  } catch (e) { console.error("persist failed for", s.id, e.message); }
}
function persistSync(s) {
  try {
    const file = path.join(HISTORY_DIR, s.id + ".json");
    const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, file);
  } catch (e) { console.error("persistSync failed for", s.id, e.message); }
}
function loadFromDisk() {
  let files = [];
  try { files = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith(".json")); }
  catch { return; }
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), "utf8"));
      if (!s || !s.id) continue;
      s.locations = Array.isArray(s.locations) ? s.locations : [];
      s.nearby = Array.isArray(s.nearby) ? s.nearby : [];
      s.audioFiles = Array.isArray(s.audioFiles) ? s.audioFiles : [];
      s.source = s.source || "unknown";
      sessions.set(s.id, s);
    } catch (e) { console.error("failed to load history", f, e.message); }
  }
  console.log("Loaded " + sessions.size + " session(s) from " + HISTORY_DIR);
}
loadFromDisk();

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());

function requireAdmin(req, res, next) {
  const user = verify(req.cookies?.sg_session);
  if (user === ADMIN_USER) return next();
  res.status(401).json({ error: "unauthorized" });
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
    res.cookie("sg_session", sign(ADMIN_USER), { httpOnly: true, sameSite: "lax", maxAge: 12 * 3600 * 1000 });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "bad credentials" });
});
app.post("/api/logout", (req, res) => { res.clearCookie("sg_session"); res.json({ ok: true }); });
app.get("/api/me", requireAdmin, (req, res) => res.json({ user: ADMIN_USER }));

// ---- device / PWA endpoints ----
app.post("/api/sos", async (req, res) => {
  const { deviceId, decoyName, lat, lng, acc, source } = req.body || {};
  const id = crypto.randomUUID().slice(0, 8);
  const room = "sos-" + id;
  const s = {
    id,
    deviceId: deviceId || "unknown-device",
    decoyName: decoyName || "App",
    source: typeof source === "string" && source ? source : "unknown",
    room,
    createdAt: Date.now(),
    endedAt: null,
    active: true,
    status: "SOS triggered",
    locations: [],
    nearby: [],
    audioFiles: [],
  };
  if (typeof lat === "number" && typeof lng === "number") {
    s.locations.push({ lat, lng, acc: acc ?? null, ts: Date.now() });
  }
  sessions.set(id, s);
  await persist(s);
  const token = await mintToken(room, "device-" + s.deviceId, { canPublish: true, canSubscribe: false });
  broadcast({ type: "alert", session: publicSession(s) });
  res.json({ sessionId: id, room, livekitUrl: LIVEKIT_URL, token });
});

app.post("/api/session/:id/location", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  const { lat, lng, acc } = req.body || {};
  if (typeof lat !== "number" || typeof lng !== "number")
    return res.status(400).json({ error: "lat/lng required" });
  s.locations.push({ lat, lng, acc: acc ?? null, ts: Date.now() });
  while (s.locations.length > MAX_LOCATIONS) s.locations.shift();
  broadcast({ type: "location", sessionId: s.id, point: s.locations.at(-1) });
  persist(s);
  res.json({ ok: true });
});

app.post("/api/session/:id/nearby", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  const list = Array.isArray(req.body?.devices) ? req.body.devices.slice(0, MAX_NEARBY) : [];
  s.nearby = list;
  broadcast({ type: "nearby", sessionId: s.id, devices: list });
  persist(s);
  res.json({ ok: true, count: list.length });
});

app.post("/api/session/:id/stop", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  endSessionObj(s, "ended by device");
  broadcast({ type: "ended", sessionId: s.id, session: publicSession(s) });
  res.json({ ok: true });
});

// ---- audio upload (saved calls) ----
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
function sessionAudioDir(id) { return path.join(AUDIO_DIR, id); }
function audioExtFor(mime) {
  if (!mime) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  return "webm";
}

app.post("/api/session/:id/audio",
  express.raw({ type: ["audio/*", "application/octet-stream"], limit: "25mb" }),
  upload.single("audio"),
  async (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ error: "no session" });
    let buf = null, mime = null;
    if (req.file && req.file.buffer) { buf = req.file.buffer; mime = req.file.mimetype; }
    else if (Buffer.isBuffer(req.body) && req.body.length) { buf = req.body; mime = req.headers["content-type"]; }
    if (!buf || !buf.length) return res.status(400).json({ error: "no audio body" });
    const ext = audioExtFor(mime);
    const dir = sessionAudioDir(s.id);
    try { await fsp.mkdir(dir, { recursive: true }); } catch {}
    let existing = [];
    try { existing = (await fsp.readdir(dir)).filter((f) => /^chunk-\d+\./.test(f)); } catch {}
    const name = "chunk-" + String(existing.length).padStart(4, "0") + "." + ext;
    try { await fsp.writeFile(path.join(dir, name), buf); }
    catch (e) { return res.status(500).json({ error: "write failed", detail: e.message }); }
    if (!s.audioFiles.includes(name)) s.audioFiles.push(name);
    await persist(s);
    broadcast({ type: "audio", sessionId: s.id, file: name, count: s.audioFiles.length });
    res.json({ ok: true, file: name, count: s.audioFiles.length });
  });

app.post("/api/session/:id/audio/finalize", async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  const dir = sessionAudioDir(s.id);
  let chunks = [];
  try { chunks = (await fsp.readdir(dir)).filter((f) => /^chunk-\d+\.webm$/.test(f)).sort(); } catch {}
  let recording = null;
  if (chunks.length) {
    try {
      const buffers = [];
      for (const c of chunks) buffers.push(await fsp.readFile(path.join(dir, c)));
      await fsp.writeFile(path.join(dir, "recording.webm"), Buffer.concat(buffers));
      recording = "recording.webm";
      if (!s.audioFiles.includes("recording.webm")) s.audioFiles.push("recording.webm");
    } catch (e) { console.error("finalize concat failed", s.id, e.message); }
  }
  await persist(s);
  res.json({ ok: true, recording, chunks: chunks.length });
});

app.get("/api/session/:id/audio", requireAdmin, async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  const dir = sessionAudioDir(s.id);
  let files = [];
  try { files = (await fsp.readdir(dir)).filter((f) => /\.(webm|m4a)$/.test(f)).sort(); } catch {}
  res.json({ files: files.map((f) => ({ name: f, url: "/api/session/" + s.id + "/audio/" + f })) });
});

app.get("/api/session/:id/audio/:file", requireAdmin, (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  const safe = path.basename(req.params.file);
  if (!/\.(webm|m4a)$/.test(safe)) return res.status(400).json({ error: "bad file" });
  const fp = path.join(sessionAudioDir(s.id), safe);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: "not found" });
  const type = safe.endsWith(".m4a") ? "audio/mp4" : "audio/webm";
  res.setHeader("Content-Type", type);
  res.setHeader("Accept-Ranges", "bytes");
  const stat = fs.statSync(fp);
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    res.status(206);
    res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + stat.size);
    res.setHeader("Content-Length", end - start + 1);
    fs.createReadStream(fp, { start, end }).pipe(res);
  } else {
    res.setHeader("Content-Length", stat.size);
    fs.createReadStream(fp).pipe(res);
  }
});

// ---- admin endpoints ----
app.get("/api/sessions", requireAdmin, (req, res) => {
  res.json({ sessions: [...sessions.values()].map((s) => publicSession(s)) });
});
app.get("/api/session/:id", requireAdmin, (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  res.json(publicSession(s, true));
});
app.get("/api/session/:id/listen-token", requireAdmin, async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  const token = await mintToken(s.room, "admin-listener", { canPublish: false, canSubscribe: true });
  res.json({ livekitUrl: LIVEKIT_URL, token, room: s.room });
});
app.post("/api/session/:id/end", requireAdmin, (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  endSessionObj(s, "ended by admin");
  broadcast({ type: "ended", sessionId: s.id, session: publicSession(s) });
  res.json({ ok: true });
});

function endSessionObj(s, status) {
  s.active = false;
  s.status = status;
  s.endedAt = Date.now();
  persistSync(s);
}

function publicSession(s, full = false) {
  const hasAudio = (s.audioFiles && s.audioFiles.length > 0);
  const duration = s.endedAt && s.createdAt ? s.endedAt - s.createdAt : null;
  const base = {
    id: s.id,
    deviceId: s.deviceId,
    decoyName: s.decoyName,
    source: s.source || "unknown",
    room: s.room,
    createdAt: s.createdAt,
    endedAt: s.endedAt || null,
    active: s.active,
    status: s.status,
    lastLocation: s.locations.at(-1) || null,
    nearbyCount: s.nearby.length,
    hasAudio,
    duration,
  };
  if (full) {
    base.locations = s.locations;
    base.nearby = s.nearby;
    base.audioFiles = s.audioFiles || [];
  }
  return base;
}

async function mintToken(room, identity, grants) {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, ttl: "2h" });
  at.addGrant({ room, roomJoin: true, canPublish: grants.canPublish, canSubscribe: grants.canSubscribe, canPublishData: true });
  return await at.toJwt();
}

app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const clients = new Set();
wss.on("connection", (ws, req) => {
  const user = verify(parseCookie(req.headers.cookie)?.sg_session);
  if (user !== ADMIN_USER) { ws.close(1008, "unauthorized"); return; }
  clients.add(ws);
  ws.send(JSON.stringify({ type: "hello", sessions: [...sessions.values()].map((s) => publicSession(s)) }));
  ws.on("close", () => clients.delete(ws));
});
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) { if (ws.readyState === ws.OPEN) ws.send(data); }
}
function parseCookie(str) {
  if (!str) return {};
  return Object.fromEntries(str.split(";").map((c) => {
    const i = c.indexOf("=");
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
  }));
}

server.listen(PORT, () => {
  console.log("Now Smart SOS server on :" + PORT + "  (LiveKit: " + LIVEKIT_URL + ", DATA_DIR: " + DATA_DIR + ")");
});
