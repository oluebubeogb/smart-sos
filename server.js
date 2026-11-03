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
const VIDEO_DIR = path.join(DATA_DIR, "video");
for (const d of [DATA_DIR, HISTORY_DIR, AUDIO_DIR, VIDEO_DIR]) {
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
      s.videoFiles = Array.isArray(s.videoFiles) ? s.videoFiles : [];
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
    videoFiles: [],
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
  // Idempotent: if admin already ended, just acknowledge so device can cleanup.
  if (s.active) {
    endSessionObj(s, "ended by device");
    broadcast({ type: "ended", sessionId: s.id, by: "device", session: publicSession(s) });
  }
  res.json({ ok: true, active: s.active, status: s.status });
});

// Public device status (no locations/nearby/audio leaked) — PWA polls while SOS is active
app.get("/api/session/:id/status", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  res.json({
    id: s.id,
    active: !!s.active,
    status: s.status,
    endedAt: s.endedAt || null,
  });
});

// ---- audio upload (saved calls) ----
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
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
  // Keep every chunk-* file. Full recording is best-effort binary concat of complete
  // WebM segments (each from a restarted MediaRecorder). Browsers may only play the
  // first segment from a naive concat — chunk playlist in admin is the source of truth.
  let recording = null;
  if (chunks.length) {
    try {
      const buffers = [];
      for (const c of chunks) buffers.push(await fsp.readFile(path.join(dir, c)));
      await fsp.writeFile(path.join(dir, "recording.webm"), Buffer.concat(buffers));
      recording = "recording.webm";
      if (!s.audioFiles.includes("recording.webm")) s.audioFiles.push("recording.webm");
      for (const c of chunks) {
        if (!s.audioFiles.includes(c)) s.audioFiles.push(c);
      }
    } catch (e) { console.error("finalize concat failed", s.id, e.message); }
  }
  await persist(s);
  res.json({ ok: true, recording, chunks: chunks.length, keptChunks: true });
});

app.get("/api/session/:id/audio", requireAdmin, async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  const dir = sessionAudioDir(s.id);
  let files = [];
  try { files = (await fsp.readdir(dir)).filter((f) => /\.(webm|m4a)$/.test(f)); } catch {}
  const recs = files.filter((f) => f.startsWith("recording")).sort();
  const chunks = files.filter((f) => /^chunk-\d+\./.test(f)).sort();
  const other = files.filter((f) => !recs.includes(f) && !chunks.includes(f)).sort();
  // Always return full recording (if any) AND all chunks — never drop segments.
  const ordered = [...chunks, ...other]; // full recording hidden from admin UI (kept on disk)
  res.json({ files: ordered.map((f) => ({ name: f, url: "/api/session/" + s.id + "/audio/" + f })) });
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

// ---- video upload (separate low-res streams; not muxed with audio) ----
function sessionVideoDir(id) { return path.join(VIDEO_DIR, id); }
function videoCamSafe(cam) {
  const c = String(cam || "cam").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return c || "cam";
}
function videoExtFor(mime) {
  if (!mime) return "webm";
  if (mime.includes("mp4")) return "mp4";
  return "webm";
}

app.post("/api/session/:id/video",
  express.raw({ type: ["video/*", "application/octet-stream"], limit: "40mb" }),
  upload.single("video"),
  async (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ error: "no session" });
    let buf = null, mime = null;
    if (req.file && req.file.buffer) { buf = req.file.buffer; mime = req.file.mimetype; }
    else if (Buffer.isBuffer(req.body) && req.body.length) { buf = req.body; mime = req.headers["content-type"]; }
    if (!buf || !buf.length) return res.status(400).json({ error: "no video body" });
    const cam = videoCamSafe(req.query.cam || req.headers["x-sos-cam"] || "cam");
    const ext = videoExtFor(mime);
    const dir = sessionVideoDir(s.id);
    try { await fsp.mkdir(dir, { recursive: true }); } catch {}
    let existing = [];
    const re = new RegExp("^video-" + cam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-\\d+\\.");
    try { existing = (await fsp.readdir(dir)).filter((f) => re.test(f)); } catch {}
    const name = "video-" + cam + "-" + String(existing.length).padStart(4, "0") + "." + ext;
    try { await fsp.writeFile(path.join(dir, name), buf); }
    catch (e) { return res.status(500).json({ error: "write failed", detail: e.message }); }
    if (!Array.isArray(s.videoFiles)) s.videoFiles = [];
    if (!s.videoFiles.includes(name)) s.videoFiles.push(name);
    await persist(s);
    broadcast({ type: "video", sessionId: s.id, file: name, cam, count: s.videoFiles.length });
    res.json({ ok: true, file: name, cam, count: s.videoFiles.length });
  });

app.get("/api/session/:id/video", requireAdmin, async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  const dir = sessionVideoDir(s.id);
  let files = [];
  try { files = (await fsp.readdir(dir)).filter((f) => /^video-[a-z0-9_-]+-\d+\.(webm|mp4)$/i.test(f)).sort(); } catch {}
  res.json({ files: files.map((f) => ({ name: f, url: "/api/session/" + s.id + "/video/" + f })) });
});

app.get("/api/session/:id/video/:file", requireAdmin, (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  const safe = path.basename(req.params.file);
  if (!/^video-[a-z0-9_-]+-\d+\.(webm|mp4)$/i.test(safe)) return res.status(400).json({ error: "bad file" });
  const fp = path.join(sessionVideoDir(s.id), safe);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: "not found" });
  const type = safe.endsWith(".mp4") ? "video/mp4" : "video/webm";
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


// ---- partner / integration API (SafeCorps etc.) ----
// Optional env (none required; routes return 503 if no keys configured):
//   PARTNER_API_KEYS="safecorps:KEY1,acme:KEY2"   (bare "KEY" => partner name "partner")
//   SAFE_CORPS_API_KEY="KEY"                       (shortcut => partner "safecorps")
//   PARTNER_WEBHOOK_URL="https://..."              (default webhook for all partners)
//   PARTNER_WEBHOOK_URLS="safecorps=https://...,acme=https://..."
const PARTNER_KEYS = new Map(); // key -> partner name
for (const part of String(process.env.PARTNER_API_KEYS || "").split(",").map((x) => x.trim()).filter(Boolean)) {
  const i = part.indexOf(":");
  if (i > 0) PARTNER_KEYS.set(part.slice(i + 1).trim(), part.slice(0, i).trim().toLowerCase());
  else PARTNER_KEYS.set(part, "partner");
}
if (process.env.SAFE_CORPS_API_KEY) PARTNER_KEYS.set(process.env.SAFE_CORPS_API_KEY.trim(), "safecorps");
const PARTNER_WEBHOOKS = new Map();
for (const part of String(process.env.PARTNER_WEBHOOK_URLS || "").split(",").map((x) => x.trim()).filter(Boolean)) {
  const i = part.indexOf("=");
  if (i > 0) PARTNER_WEBHOOKS.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
}
const PARTNER_WEBHOOK_DEFAULT = process.env.PARTNER_WEBHOOK_URL || "";
function partnerKeyFor(name) { for (const [k, n] of PARTNER_KEYS) if (n === name) return k; return ""; }

function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function requirePartner(req, res, next) {
  if (!PARTNER_KEYS.size) return res.status(503).json({ error: "partner_api_disabled" });
  let key = req.headers["x-api-key"] || "";
  const auth = req.headers.authorization || "";
  if (!key && /^Bearer\s+/i.test(auth)) key = auth.replace(/^Bearer\s+/i, "").trim();
  if (!key) return res.status(401).json({ error: "missing_api_key" });
  let name = null;
  for (const [k, n] of PARTNER_KEYS) if (safeEq(k, key)) name = n;
  if (!name) return res.status(401).json({ error: "invalid_api_key" });
  req.partner = name;
  next();
}
function partnerSession(req, res, next) {
  const s = sessions.get(req.params.id);
  if (!s || s.partner !== req.partner) return res.status(404).json({ error: "session_not_found" });
  req.sos = s;
  next();
}
function partnerView(s) {
  return {
    sessionId: s.id, externalRef: s.externalRef || null, deviceId: s.deviceId, appId: s.source,
    active: !!s.active, status: s.status, createdAt: s.createdAt, endedAt: s.endedAt || null,
    endedBy: s.endedBy || null, lastLocation: s.locations.at(-1) || null,
    locationCount: s.locations.length, audioCount: (s.audioFiles || []).filter((f) => f.startsWith("chunk-")).length,
    videoCount: (s.videoFiles || []).length,
  };
}
function notifyPartner(s, event, extra = {}) {
  if (!s || !s.partner) return;
  const url = PARTNER_WEBHOOKS.get(s.partner) || s.callbackUrl || PARTNER_WEBHOOK_DEFAULT;
  if (!url) return;
  const body = JSON.stringify({ event, ts: Date.now(), session: partnerView(s), ...extra });
  const sig = crypto.createHmac("sha256", partnerKeyFor(s.partner)).update(body).digest("hex");
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-NSS-Signature": "sha256=" + sig, "X-NSS-Event": event }, body, signal: AbortSignal.timeout(8000) })
    .catch((e) => console.error("webhook failed", s.partner, event, e.message));
}
function bufFromReq(req) {
  if (req.file && req.file.buffer) return { buf: req.file.buffer, mime: req.file.mimetype };
  if (Buffer.isBuffer(req.body) && req.body.length) return { buf: req.body, mime: req.headers["content-type"] };
  return { buf: null, mime: null };
}

const P = "/api/partner/v1";
app.get(P + "/ping", requirePartner, (req, res) => res.json({ ok: true, partner: req.partner }));

app.post(P + "/sessions", requirePartner, async (req, res) => {
  const b = req.body || {};
  const ext = b.external_ref ? String(b.external_ref).slice(0, 128) : null;
  // Idempotency: same partner + external_ref while active returns existing session
  if (ext) {
    for (const s of sessions.values()) {
      if (s.partner === req.partner && s.externalRef === ext && s.active)
        return res.json({ ...partnerView(s), duplicate: true });
    }
  }
  const id = crypto.randomUUID().slice(0, 8);
  const appId = String(b.app_id || req.partner).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || req.partner;
  const s = {
    id, deviceId: String(b.device_id || "unknown-device").slice(0, 128),
    decoyName: String(b.user?.name || b.app_name || appId).slice(0, 80),
    source: appId, partner: req.partner, externalRef: ext,
    user: b.user && typeof b.user === "object" ? b.user : null,
    metadata: b.metadata && typeof b.metadata === "object" ? b.metadata : null,
    callbackUrl: typeof b.callback_url === "string" && /^https:\/\//.test(b.callback_url) ? b.callback_url : null,
    room: "sos-" + id, createdAt: Date.now(), endedAt: null, active: true,
    status: "SOS triggered (" + appId + ")", locations: [], nearby: [], audioFiles: [], videoFiles: [], events: [],
  };
  if (JSON.stringify(s.user || {}).length + JSON.stringify(s.metadata || {}).length > 16000)
    return res.status(413).json({ error: "metadata_too_large" });
  if (typeof b.lat === "number" && typeof b.lng === "number")
    s.locations.push({ lat: b.lat, lng: b.lng, acc: b.acc ?? null, ts: Date.now() });
  if (Array.isArray(b.nearby)) s.nearby = b.nearby.slice(0, MAX_NEARBY);
  sessions.set(id, s);
  await persist(s);
  broadcast({ type: "alert", session: publicSession(s) });
  const out = { ...partnerView(s) };
  if (b.want_livekit) {
    out.livekit = { url: LIVEKIT_URL, room: s.room, token: await mintToken(s.room, "partner-" + s.deviceId, { canPublish: true, canSubscribe: false }) };
  }
  notifyPartner(s, "session.created");
  res.status(201).json(out);
});

app.get(P + "/sessions/:id", requirePartner, partnerSession, (req, res) => res.json(partnerView(req.sos)));

app.post(P + "/sessions/:id/location", requirePartner, partnerSession, (req, res) => {
  const s = req.sos;
  const pts = Array.isArray(req.body?.points) ? req.body.points : [req.body || {}];
  let n = 0;
  for (const p of pts.slice(0, 100)) {
    if (typeof p.lat !== "number" || typeof p.lng !== "number") continue;
    s.locations.push({ lat: p.lat, lng: p.lng, acc: p.acc ?? null, ts: typeof p.ts === "number" ? p.ts : Date.now() });
    n++;
  }
  if (!n) return res.status(400).json({ error: "lat_lng_required" });
  while (s.locations.length > MAX_LOCATIONS) s.locations.shift();
  broadcast({ type: "location", sessionId: s.id, point: s.locations.at(-1) });
  persist(s);
  res.json({ ok: true, added: n });
});

app.post(P + "/sessions/:id/nearby", requirePartner, partnerSession, (req, res) => {
  const s = req.sos;
  s.nearby = Array.isArray(req.body?.devices) ? req.body.devices.slice(0, MAX_NEARBY) : [];
  broadcast({ type: "nearby", sessionId: s.id, devices: s.nearby });
  persist(s);
  res.json({ ok: true, count: s.nearby.length });
});

// Free-form feedback / status events from partner app (e.g. "user_safe", "battery_low")
app.post(P + "/sessions/:id/events", requirePartner, partnerSession, (req, res) => {
  const s = req.sos;
  const type = String(req.body?.type || "").slice(0, 60);
  if (!type) return res.status(400).json({ error: "type_required" });
  if (!Array.isArray(s.events)) s.events = [];
  const ev = { type, message: req.body?.message ? String(req.body.message).slice(0, 500) : null, data: req.body?.data ?? null, ts: Date.now() };
  s.events.push(ev);
  while (s.events.length > 500) s.events.shift();
  if (ev.message) s.status = type + ": " + ev.message; else s.status = type;
  broadcast({ type: "status", sessionId: s.id, event: ev, session: publicSession(s) });
  persist(s);
  res.json({ ok: true });
});

app.post(P + "/sessions/:id/audio", requirePartner, partnerSession,
  express.raw({ type: ["audio/*", "application/octet-stream"], limit: "25mb" }), upload.single("audio"),
  async (req, res) => {
    const s = req.sos;
    const { buf, mime } = bufFromReq(req);
    if (!buf || !buf.length) return res.status(400).json({ error: "no_audio_body" });
    const dir = sessionAudioDir(s.id);
    try { await fsp.mkdir(dir, { recursive: true }); } catch {}
    let existing = [];
    try { existing = (await fsp.readdir(dir)).filter((f) => /^chunk-\d+\./.test(f)); } catch {}
    const name = "chunk-" + String(existing.length).padStart(4, "0") + "." + audioExtFor(mime);
    try { await fsp.writeFile(path.join(dir, name), buf); } catch (e) { return res.status(500).json({ error: "write_failed" }); }
    if (!s.audioFiles.includes(name)) s.audioFiles.push(name);
    await persist(s);
    broadcast({ type: "audio", sessionId: s.id, file: name, count: s.audioFiles.length });
    res.json({ ok: true, file: name });
  });

app.post(P + "/sessions/:id/video", requirePartner, partnerSession,
  express.raw({ type: ["video/*", "application/octet-stream"], limit: "40mb" }), upload.single("video"),
  async (req, res) => {
    const s = req.sos;
    const { buf, mime } = bufFromReq(req);
    if (!buf || !buf.length) return res.status(400).json({ error: "no_video_body" });
    const cam = videoCamSafe(req.query.cam || req.headers["x-sos-cam"] || req.body?.cam || "cam");
    const dir = sessionVideoDir(s.id);
    try { await fsp.mkdir(dir, { recursive: true }); } catch {}
    let existing = [];
    try { existing = (await fsp.readdir(dir)).filter((f) => f.startsWith("video-" + cam + "-")); } catch {}
    const name = "video-" + cam + "-" + String(existing.length).padStart(4, "0") + "." + videoExtFor(mime);
    try { await fsp.writeFile(path.join(dir, name), buf); } catch (e) { return res.status(500).json({ error: "write_failed" }); }
    if (!s.videoFiles.includes(name)) s.videoFiles.push(name);
    await persist(s);
    broadcast({ type: "video", sessionId: s.id, file: name, cam, count: s.videoFiles.length });
    res.json({ ok: true, file: name, cam });
  });

app.post(P + "/sessions/:id/end", requirePartner, partnerSession, (req, res) => {
  const s = req.sos;
  if (s.active) {
    const why = req.body?.reason ? String(req.body.reason).slice(0, 120) : "";
    endSessionObj(s, "ended by " + s.partner + (why ? " (" + why + ")" : ""), "partner");
    broadcast({ type: "ended", sessionId: s.id, by: "partner", session: publicSession(s) });
  }
  res.json(partnerView(s));
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
  if (s.active) endSessionObj(s, "ended by admin");
  broadcast({ type: "ended", sessionId: s.id, by: "admin", session: publicSession(s) });
  res.json({ ok: true, active: s.active, status: s.status });
});

function endSessionObj(s, status, by) {
  s.active = false;
  s.status = status;
  s.endedAt = Date.now();
  s.endedBy = by || (/admin/.test(status) ? "admin" : "device");
  persistSync(s);
  notifyPartner(s, "session.ended", { endedBy: s.endedBy });
}

function publicSession(s, full = false) {
  const hasAudio = (s.audioFiles && s.audioFiles.length > 0);
  const hasVideo = (s.videoFiles && s.videoFiles.length > 0);
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
    hasVideo,
    duration,
  };
  if (full) {
    base.locations = s.locations;
    base.nearby = s.nearby;
    base.audioFiles = s.audioFiles || [];
    base.videoFiles = s.videoFiles || [];
    if (s.partner) {
      base.partner = s.partner;
      base.externalRef = s.externalRef || null;
      base.user = s.user || null;
      base.metadata = s.metadata || null;
      base.events = s.events || [];
    }
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
