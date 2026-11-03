// Smart SOS — admin backend
// - Postgres (DATABASE_URL) for admins, partner keys, sessions, media metadata
// - Media files (audio/video) stay on disk under DATA_DIR
// - Env superadmin (ADMIN_USER/ADMIN_PASSWORD) + DB 2nd-level admins
// - Partner API (/api/partner/v1) with dashboard-managed keys + realtime feed for partner websites
// - LiveKit token mint (device/PWA publishes; admin subscribes)

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
import * as db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8080;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const SESSION_SECRET = process.env.SESSION_SECRET || "demo-secret";
const LIVEKIT_URL = process.env.LIVEKIT_URL || "wss://1v.collab.name.ng";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "devkey";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "secret";

const DATA_DIR = process.env.DATA_DIR || "/data";
const AUDIO_DIR = path.join(DATA_DIR, "audio");
const VIDEO_DIR = path.join(DATA_DIR, "video");
for (const d of [DATA_DIR, AUDIO_DIR, VIDEO_DIR]) {
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) { console.error("mkdir failed for", d, e.message); }
}

const MAX_LOCATIONS = 500;
const MAX_NEARBY = 25;
const ROOT_ID = "root";

// =====================================================================
// crypto helpers
// =====================================================================
const hex = (n) => crypto.randomBytes(n).toString("hex");
const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return "scrypt$" + salt.toString("hex") + "$" + h.toString("hex");
}
function checkPassword(pw, stored) {
  try {
    const [alg, salt, h] = String(stored).split("$");
    if (alg !== "scrypt") return false;
    const got = crypto.scryptSync(String(pw), Buffer.from(salt, "hex"), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(got, Buffer.from(h, "hex"));
  } catch { return false; }
}
const ENC_KEY = crypto.createHash("sha256").update(SESSION_SECRET + "|ssos-key-enc").digest();
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}
function decrypt(blob) {
  try {
    const [iv, tag, enc] = String(blob).split(".").map((x) => Buffer.from(x, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch { return null; }
}
function slugify(v) { return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "partner"; }
const genApiKey = (slug) => "ssos_live_" + slugify(slug) + "_" + hex(16);
const genReadToken = () => "ssos_pub_" + hex(12);
const genWebhookSecret = () => "whsec_" + hex(24);
const keyPrefix = (k) => k.slice(0, k.lastIndexOf("_") + 7) + "…";

// =====================================================================
// boot: DB, legacy import, load state
// =====================================================================
await db.initDb(process.env.DATABASE_URL);

function envPartnerKeys() {
  const out = [];
  const hooks = new Map();
  for (const part of String(process.env.PARTNER_WEBHOOK_URLS || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const i = part.indexOf("="); if (i > 0) hooks.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  const def = process.env.PARTNER_WEBHOOK_URL || "";
  for (const part of String(process.env.PARTNER_API_KEYS || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const i = part.indexOf(":");
    const partner = i > 0 ? part.slice(0, i).trim().toLowerCase() : "partner";
    out.push({ partner, key: i > 0 ? part.slice(i + 1).trim() : part });
  }
  if (process.env.SAFE_CORPS_API_KEY) out.push({ partner: "safecorps", key: process.env.SAFE_CORPS_API_KEY.trim() });
  for (const k of out) k.webhook = hooks.get(k.partner) || def || null;
  return out;
}
await db.legacyImport({
  dataDir: DATA_DIR,
  envKeys: envPartnerKeys(),
  force: process.env.MIGRATE_LEGACY === "1",
  // Imported keys: webhook secret = the old API key so existing SafeCorps signature checks keep working.
  makeKeyRow: (k) => ({ prefix: keyPrefix(k.key.includes("_") ? k.key : "legacy_" + k.key), enc: encrypt(k.key),
    orgName: k.partner === "safecorps" ? "SafeCorps" : k.partner, webhookSecret: k.key, readToken: genReadToken() }),
});

const sessions = await db.loadSessions();
console.log("Loaded " + sessions.size + " session(s) from Postgres");

// ---- partner keys cache (reloaded on every mutation) ----
let keysById = new Map(), keysByHash = new Map();
async function reloadKeys() {
  const r = await db.q("SELECT * FROM partner_keys");
  keysById = new Map(); keysByHash = new Map();
  for (const k of r.rows) { keysById.set(k.id, k); keysByHash.set(k.key_hash, k); }
}
await reloadKeys();
const pendingLastUsed = new Map();
setInterval(() => {
  for (const [id, ts] of pendingLastUsed) db.q("UPDATE partner_keys SET last_used_at=to_timestamp($2/1000.0) WHERE id=$1", [id, ts]).catch(() => {});
  pendingLastUsed.clear();
}, 30000).unref();

// ---- write-through persistence ----
function persist(s) { return db.upsertSession(s).catch((e) => console.error("persist failed", s.id, e.message)); }
const bg = (p) => p.catch((e) => console.error("db write failed", e.message));

// =====================================================================
// auth
// =====================================================================
const rootPwv = () => sha256(ADMIN_USER + "\0" + ADMIN_PASSWORD).slice(0, 12);
function signCookie(obj) {
  const v = Buffer.from(JSON.stringify(obj)).toString("base64url");
  return v + "." + crypto.createHmac("sha256", SESSION_SECRET).update(v).digest("hex");
}
function readCookie(raw) {
  if (!raw) return null;
  const i = raw.lastIndexOf("."); if (i < 0) return null;
  const v = raw.slice(0, i);
  if (!safeEq(crypto.createHmac("sha256", SESSION_SECRET).update(v).digest("hex"), raw.slice(i + 1))) return null;
  try { return JSON.parse(Buffer.from(v, "base64url").toString()); } catch { return null; }
}
async function adminFromCookie(raw) {
  const c = readCookie(raw); if (!c) return null;
  if (c.u === ROOT_ID) return c.v === rootPwv() ? { id: ROOT_ID, username: ADMIN_USER, role: "super", email: null } : null;
  const r = await db.q("SELECT id,username,email,pw_version,disabled FROM admins WHERE id=$1", [c.u]).catch(() => ({ rows: [] }));
  const a = r.rows[0];
  if (!a || a.disabled || String(a.pw_version) !== String(c.v)) return null;
  return { id: a.id, username: a.username, email: a.email, role: "admin" };
}
async function requireAdmin(req, res, next) {
  const a = await adminFromCookie(req.cookies?.sg_session);
  if (!a) return res.status(401).json({ error: "unauthorized" });
  req.admin = a; next();
}
function requireSuper(req, res, next) {
  if (req.admin?.role !== "super") return res.status(403).json({ error: "superadmin_only" });
  next();
}
const isSuper = (a) => a?.role === "super";
function canSee(a, s) { if (!a || !s) return false; return isSuper(a) || (!!s.ownerAdminId && s.ownerAdminId === a.id); }
function canSeeKey(a, k) { return isSuper(a) || (k.owner_admin_id && k.owner_admin_id === a.id); }

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());
// Express 4: forward async handler rejections to the error middleware
for (const m of ["get", "post", "patch", "delete"]) {
  const orig = app[m].bind(app);
  app[m] = (route, ...fns) => (fns.length ? orig(route, ...fns.map((fn) => (fn.length <= 3 ? (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } } : fn))) : orig(route));
}
process.on("unhandledRejection", (e) => console.error("unhandledRejection", e?.message || e));

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax", maxAge: 12 * 3600 * 1000 };
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ error: "bad request" });
  if (safeEq(username, ADMIN_USER) && safeEq(password, ADMIN_PASSWORD)) {
    res.cookie("sg_session", signCookie({ u: ROOT_ID, v: rootPwv() }), COOKIE_OPTS);
    return res.json({ ok: true, role: "super" });
  }
  const r = await db.q("SELECT * FROM admins WHERE lower(username)=lower($1) OR lower(email)=lower($1)", [username.trim()]);
  const a = r.rows[0];
  if (a && !a.disabled && checkPassword(password, a.pass_hash)) {
    res.cookie("sg_session", signCookie({ u: a.id, v: a.pw_version }), COOKIE_OPTS);
    return res.json({ ok: true, role: "admin" });
  }
  res.status(401).json({ error: "bad credentials" });
});
app.post("/api/logout", (req, res) => { res.clearCookie("sg_session"); res.json({ ok: true }); });
app.get("/api/me", requireAdmin, (req, res) => res.json({ id: req.admin.id, user: req.admin.username, username: req.admin.username, email: req.admin.email, role: req.admin.role, host: req.protocol + "://" + req.get("host") }));

// ---- admins (superadmin manages) ----
const adminView = (a) => ({ id: a.id, username: a.username, email: a.email, disabled: a.disabled, createdAt: a.created_at, keyCount: Number(a.key_count || 0) });
app.get("/api/admins", requireAdmin, requireSuper, async (req, res) => {
  const r = await db.q("SELECT a.*, (SELECT count(*) FROM partner_keys k WHERE k.owner_admin_id=a.id) key_count FROM admins a ORDER BY created_at");
  res.json({ admins: r.rows.map(adminView) });
});
app.post("/api/admins", requireAdmin, requireSuper, async (req, res) => {
  const username = String(req.body?.username || "").trim(), email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ error: "Username: 3–40 letters, digits, . _ -" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Valid email required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (username.toLowerCase() === ADMIN_USER.toLowerCase()) return res.status(409).json({ error: "Username taken" });
  try {
    const r = await db.q("INSERT INTO admins(username,email,pass_hash) VALUES($1,$2,$3) RETURNING *", [username, email, hashPassword(password)]);
    res.status(201).json({ admin: adminView(r.rows[0]) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: /email/.test(e.detail || e.constraint) ? "Email already used" : "Username taken" });
    throw e;
  }
});
app.post("/api/admins/:id/password", requireAdmin, requireSuper, async (req, res) => {
  const pw = String(req.body?.password || "");
  if (pw.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  const r = await db.q("UPDATE admins SET pass_hash=$2, pw_version=pw_version+1 WHERE id=$1 RETURNING id", [req.params.id, hashPassword(pw)]).catch(() => ({ rowCount: 0 }));
  if (!r.rowCount) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});
app.patch("/api/admins/:id", requireAdmin, requireSuper, async (req, res) => {
  if (typeof req.body?.disabled !== "boolean") return res.status(400).json({ error: "disabled boolean required" });
  const r = await db.q("UPDATE admins SET disabled=$2, pw_version=pw_version+1 WHERE id=$1 RETURNING *", [req.params.id, req.body.disabled]).catch(() => ({ rowCount: 0 }));
  if (!r.rowCount) return res.status(404).json({ error: "not found" });
  res.json({ admin: adminView(r.rows[0]) });
});
app.delete("/api/admins/:id", requireAdmin, requireSuper, async (req, res) => {
  const id = req.params.id;
  const r = await db.q("DELETE FROM admins WHERE id=$1", [id]).catch(() => ({ rowCount: 0 }));
  if (!r.rowCount) return res.status(404).json({ error: "not found" });
  // keys (FK ON DELETE SET NULL) and their sessions move to root
  await db.q("UPDATE sessions SET owner_admin_id=NULL WHERE owner_admin_id=$1", [id]);
  for (const s of sessions.values()) if (s.ownerAdminId === id) s.ownerAdminId = null;
  await reloadKeys();
  res.json({ ok: true });
});
app.post("/api/account/password", requireAdmin, async (req, res) => {
  if (isSuper(req.admin)) return res.status(400).json({ error: "The env superadmin password is set via ADMIN_PASSWORD in your deployment env." });
  const cur = String(req.body?.current || ""), next = String(req.body?.next || "");
  if (next.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });
  const r = await db.q("SELECT pass_hash FROM admins WHERE id=$1", [req.admin.id]);
  if (!r.rows[0] || !checkPassword(cur, r.rows[0].pass_hash)) return res.status(403).json({ error: "Current password is incorrect" });
  const u = await db.q("UPDATE admins SET pass_hash=$2, pw_version=pw_version+1 WHERE id=$1 RETURNING pw_version", [req.admin.id, hashPassword(next)]);
  res.cookie("sg_session", signCookie({ u: req.admin.id, v: u.rows[0].pw_version }), COOKIE_OPTS);
  res.json({ ok: true });
});

// =====================================================================
// partner keys (dashboard)
// =====================================================================
async function keyView(k, a, adminNames) {
  const v = {
    id: k.id, orgName: k.org_name, partner: k.partner, keyPrefix: k.key_prefix, readToken: k.read_token,
    webhookUrl: k.webhook_url, allowedOrigins: k.allowed_origins || [], enabled: k.enabled, imported: k.imported,
    createdAt: k.created_at, lastUsedAt: pendingLastUsed.has(k.id) ? new Date(pendingLastUsed.get(k.id)) : k.last_used_at,
    sessionCount: [...sessions.values()].filter((s) => s.keyId === k.id).length,
    activeCount: [...sessions.values()].filter((s) => s.keyId === k.id && s.active).length,
  };
  if (isSuper(a)) v.createdBy = k.owner_admin_id ? (adminNames.get(k.owner_admin_id) || "deleted admin") : ADMIN_USER + " (env)";
  return v;
}
async function adminNameMap() { return new Map((await db.q("SELECT id,username FROM admins")).rows.map((r) => [r.id, r.username])); }
function ownKey(req, res) {
  const k = keysById.get(req.params.id);
  if (!k || !canSeeKey(req.admin, k)) { res.status(404).json({ error: "not found" }); return null; }
  return k;
}
function cleanOrigins(v) {
  const arr = Array.isArray(v) ? v : String(v || "").split(/[\s,]+/);
  return arr.map((o) => String(o).trim().replace(/\/+$/, "")).filter((o) => o === "*" || /^https?:\/\/[^/\s]+$/.test(o)).slice(0, 20);
}
function cleanWebhook(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!/^https:\/\/\S+$/.test(s) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(s)) throw Object.assign(new Error("Webhook must be an https:// URL"), { status: 400 });
  return s.slice(0, 500);
}

app.get("/api/keys", requireAdmin, async (req, res) => {
  const names = await adminNameMap();
  const list = [...keysById.values()].filter((k) => canSeeKey(req.admin, k)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ keys: await Promise.all(list.map((k) => keyView(k, req.admin, names))) });
});
app.post("/api/keys", requireAdmin, async (req, res) => {
  const orgName = String(req.body?.orgName || "").trim().slice(0, 80);
  if (!orgName) return res.status(400).json({ error: "Organisation name required" });
  const partner = slugify(req.body?.partner || orgName);
  let webhookUrl; try { webhookUrl = cleanWebhook(req.body?.webhookUrl); } catch (e) { return res.status(400).json({ error: e.message }); }
  const apiKey = genApiKey(partner), readToken = genReadToken(), webhookSecret = genWebhookSecret();
  const r = await db.q(`INSERT INTO partner_keys(key_hash,key_prefix,key_enc,partner,org_name,webhook_url,webhook_secret,read_token,allowed_origins,owner_admin_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [sha256(apiKey), keyPrefix(apiKey), encrypt(apiKey), partner, orgName, webhookUrl, webhookSecret, readToken, cleanOrigins(req.body?.allowedOrigins),
     isSuper(req.admin) ? null : req.admin.id]);
  await reloadKeys();
  res.status(201).json({ key: await keyView(r.rows[0], req.admin, await adminNameMap()), apiKey, readToken, webhookSecret });
});
app.get("/api/keys/:id/reveal", requireAdmin, (req, res) => {
  const k = ownKey(req, res); if (!k) return;
  const apiKey = k.key_enc ? decrypt(k.key_enc) : null;
  res.json({ apiKey, webhookSecret: k.webhook_secret, readToken: k.read_token, note: apiKey ? undefined : "Key can't be revealed (SESSION_SECRET changed?) — rotate to get a new one." });
});
app.patch("/api/keys/:id", requireAdmin, async (req, res) => {
  const k = ownKey(req, res); if (!k) return;
  const b = req.body || {};
  const sets = [], vals = [k.id];
  const add = (col, v) => { vals.push(v); sets.push(col + "=$" + vals.length); };
  if (typeof b.enabled === "boolean") add("enabled", b.enabled);
  if (typeof b.orgName === "string" && b.orgName.trim()) add("org_name", b.orgName.trim().slice(0, 80));
  if ("webhookUrl" in b) { try { add("webhook_url", cleanWebhook(b.webhookUrl)); } catch (e) { return res.status(400).json({ error: e.message }); } }
  if ("allowedOrigins" in b) add("allowed_origins", cleanOrigins(b.allowedOrigins));
  if (sets.length) await db.q("UPDATE partner_keys SET " + sets.join(",") + " WHERE id=$1", vals);
  await reloadKeys();
  res.json({ key: await keyView(keysById.get(k.id), req.admin, await adminNameMap()) });
});
app.post("/api/keys/:id/rotate", requireAdmin, async (req, res) => {
  const k = ownKey(req, res); if (!k) return;
  const what = req.body?.what || "api";
  const out = {};
  if (what === "api") {
    const apiKey = genApiKey(k.partner);
    await db.q("UPDATE partner_keys SET key_hash=$2,key_prefix=$3,key_enc=$4,imported=false WHERE id=$1", [k.id, sha256(apiKey), keyPrefix(apiKey), encrypt(apiKey)]);
    out.apiKey = apiKey;
  } else if (what === "read") {
    out.readToken = genReadToken();
    await db.q("UPDATE partner_keys SET read_token=$2 WHERE id=$1", [k.id, out.readToken]);
    closeFeedSubscribers(k.id);
  } else if (what === "webhook") {
    out.webhookSecret = genWebhookSecret();
    await db.q("UPDATE partner_keys SET webhook_secret=$2 WHERE id=$1", [k.id, out.webhookSecret]);
  } else return res.status(400).json({ error: "what must be api|read|webhook" });
  await reloadKeys();
  res.json({ ok: true, ...out });
});
app.delete("/api/keys/:id", requireAdmin, async (req, res) => {
  const k = ownKey(req, res); if (!k) return;
  await db.q("DELETE FROM partner_keys WHERE id=$1", [k.id]);
  // sessions keep owner (so history stays visible to the owner) but lose key link
  for (const s of sessions.values()) if (s.keyId === k.id) s.keyId = null;
  closeFeedSubscribers(k.id);
  await reloadKeys();
  res.json({ ok: true });
});
app.get("/api/keys/:id/activity", requireAdmin, async (req, res) => {
  const k = ownKey(req, res); if (!k) return;
  const r = await db.q("SELECT ts,method,endpoint,session_id,status,ip FROM partner_activity WHERE key_id=$1 ORDER BY ts DESC LIMIT 200", [k.id]);
  res.json({ activity: r.rows });
});
app.get("/api/activity", requireAdmin, async (req, res) => {
  const ids = [...keysById.values()].filter((k) => canSeeKey(req.admin, k)).map((k) => k.id);
  if (!ids.length) return res.json({ activity: [] });
  const r = await db.q(`SELECT a.ts,a.method,a.endpoint,a.session_id,a.status,a.ip,k.org_name FROM partner_activity a JOIN partner_keys k ON k.id=a.key_id
    WHERE a.key_id = ANY($1::uuid[]) ORDER BY a.ts DESC LIMIT 200`, [ids]);
  res.json({ activity: r.rows });
});
app.post("/api/keys/:id/webhook-test", requireAdmin, async (req, res) => {
  const k = ownKey(req, res); if (!k) return;
  if (!k.webhook_url) return res.status(400).json({ error: "No webhook URL set" });
  const r = await sendWebhook(k, k.webhook_url, "ping", { ts: Date.now(), message: "Smart SOS webhook test" });
  res.json(r);
});

// =====================================================================
// sessions: native PWA / Android device endpoints
// =====================================================================
app.post("/api/sos", async (req, res) => {
  const { deviceId, decoyName, lat, lng, acc, source } = req.body || {};
  const id = crypto.randomUUID().slice(0, 8);
  const s = {
    id, deviceId: deviceId || "unknown-device", decoyName: decoyName || "App",
    source: typeof source === "string" && source ? source : "unknown",
    room: "sos-" + id, createdAt: Date.now(), endedAt: null, active: true, status: "SOS triggered",
    locations: [], nearby: [], events: [], audioFiles: [], videoFiles: [], keyId: null, ownerAdminId: null,
  };
  if (typeof lat === "number" && typeof lng === "number") s.locations.push({ lat, lng, acc: acc ?? null, ts: Date.now() });
  sessions.set(id, s);
  await persist(s);
  if (s.locations.length) bg(db.addLocations(id, s.locations));
  const token = await mintToken(s.room, "device-" + s.deviceId, { canPublish: true, canSubscribe: false });
  broadcast({ type: "alert", session: publicSession(s) });
  res.json({ sessionId: id, room: s.room, livekitUrl: LIVEKIT_URL, token });
});

function addLocationPoints(s, pts) {
  for (const p of pts) s.locations.push(p);
  while (s.locations.length > MAX_LOCATIONS) s.locations.shift();
  bg(db.addLocations(s.id, pts));
  persist(s);
  broadcast({ type: "location", sessionId: s.id, point: s.locations.at(-1) });
}
function setNearby(s, list) {
  s.nearby = list;
  bg(db.addNearby(s.id, list));
  persist(s);
  broadcast({ type: "nearby", sessionId: s.id, devices: list });
}

app.post("/api/session/:id/location", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  const { lat, lng, acc } = req.body || {};
  if (typeof lat !== "number" || typeof lng !== "number") return res.status(400).json({ error: "lat/lng required" });
  addLocationPoints(s, [{ lat, lng, acc: acc ?? null, ts: Date.now() }]);
  res.json({ ok: true });
});
app.post("/api/session/:id/nearby", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  const list = Array.isArray(req.body?.devices) ? req.body.devices.slice(0, MAX_NEARBY) : [];
  setNearby(s, list);
  res.json({ ok: true, count: list.length });
});
app.post("/api/session/:id/stop", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  if (s.active) {
    endSessionObj(s, "ended by device");
    broadcast({ type: "ended", sessionId: s.id, by: "device", session: publicSession(s) });
  }
  res.json({ ok: true, active: s.active, status: s.status });
});
app.get("/api/session/:id/status", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "no session" });
  res.json({ id: s.id, active: !!s.active, status: s.status, endedAt: s.endedAt || null });
});

// =====================================================================
// media (audio + video, separate streams; files on disk, metadata in DB)
// =====================================================================
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
const sessionAudioDir = (id) => path.join(AUDIO_DIR, id);
const sessionVideoDir = (id) => path.join(VIDEO_DIR, id);
function audioExtFor(mime) { if (!mime) return "webm"; return /mp4|m4a|aac/.test(mime) ? "m4a" : "webm"; }
function videoExtFor(mime) { return mime && mime.includes("mp4") ? "mp4" : "webm"; }
function videoCamSafe(cam) { return String(cam || "cam").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "cam"; }
function bufFromReq(req) {
  if (req.file && req.file.buffer) return { buf: req.file.buffer, mime: req.file.mimetype };
  if (Buffer.isBuffer(req.body) && req.body.length) return { buf: req.body, mime: req.headers["content-type"] };
  return { buf: null, mime: null };
}
async function saveMedia(s, kind, buf, mime, cam) {
  const dir = kind === "audio" ? sessionAudioDir(s.id) : sessionVideoDir(s.id);
  await fsp.mkdir(dir, { recursive: true }).catch(() => {});
  let existing = [];
  const prefix = kind === "audio" ? "chunk-" : "video-" + cam + "-";
  try { existing = (await fsp.readdir(dir)).filter((f) => f.startsWith(prefix) && /-\d+\.\w+$/.test(f)); } catch {}
  const seq = existing.length;
  const name = prefix + String(seq).padStart(4, "0") + "." + (kind === "audio" ? audioExtFor(mime) : videoExtFor(mime));
  await fsp.writeFile(path.join(dir, name), buf);
  const list = kind === "audio" ? s.audioFiles : s.videoFiles;
  if (!list.includes(name)) list.push(name);
  bg(db.addMedia({ sessionId: s.id, kind, cam: kind === "video" ? cam : null, relPath: kind + "/" + s.id + "/" + name, name, bytes: buf.length, mime: mime || null, seq }));
  const msg = kind === "audio"
    ? { type: "audio", sessionId: s.id, file: name, count: s.audioFiles.length }
    : { type: "video", sessionId: s.id, file: name, cam, count: s.videoFiles.length };
  broadcast(msg);
  return name;
}

app.post("/api/session/:id/audio",
  express.raw({ type: ["audio/*", "application/octet-stream"], limit: "25mb" }), upload.single("audio"),
  async (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ error: "no session" });
    const { buf, mime } = bufFromReq(req);
    if (!buf || !buf.length) return res.status(400).json({ error: "no audio body" });
    try { const file = await saveMedia(s, "audio", buf, mime); res.json({ ok: true, file, count: s.audioFiles.length }); }
    catch (e) { res.status(500).json({ error: "write failed", detail: e.message }); }
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
      const all = Buffer.concat(buffers);
      await fsp.writeFile(path.join(dir, "recording.webm"), all);
      recording = "recording.webm";
      if (!s.audioFiles.includes(recording)) s.audioFiles.push(recording);
      bg(db.addMedia({ sessionId: s.id, kind: "audio", relPath: "audio/" + s.id + "/recording.webm", name: recording, bytes: all.length, mime: "audio/webm", merged: true }));
    } catch (e) { console.error("finalize concat failed", s.id, e.message); }
  }
  res.json({ ok: true, recording, chunks: chunks.length, keptChunks: true });
});

function sendFileRange(req, res, fp, type) {
  if (!fs.existsSync(fp)) return res.status(404).json({ error: "not found" });
  res.setHeader("Content-Type", type);
  res.setHeader("Accept-Ranges", "bytes");
  const stat = fs.statSync(fp);
  const m = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
    res.status(206);
    res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + stat.size);
    res.setHeader("Content-Length", end - start + 1);
    fs.createReadStream(fp, { start, end }).pipe(res);
  } else {
    res.setHeader("Content-Length", stat.size);
    fs.createReadStream(fp).pipe(res);
  }
}
const AUDIO_RE = /^(chunk-\d+|recording)\.(webm|m4a)$/;
const VIDEO_RE = /^video-[a-z0-9_-]+-\d+\.(webm|mp4)$/i;
async function listAudio(id) {
  let files = []; try { files = (await fsp.readdir(sessionAudioDir(id))).filter((f) => /\.(webm|m4a)$/.test(f)); } catch {}
  return files.filter((f) => /^chunk-\d+\./.test(f)).sort(); // full recording kept on disk, hidden from lists
}
async function listVideo(id) {
  let files = []; try { files = (await fsp.readdir(sessionVideoDir(id))).filter((f) => VIDEO_RE.test(f)).sort(); } catch {}
  return files;
}
function sendAudio(req, res, s, file) {
  const safe = path.basename(file);
  if (!AUDIO_RE.test(safe)) return res.status(400).json({ error: "bad file" });
  sendFileRange(req, res, path.join(sessionAudioDir(s.id), safe), safe.endsWith(".m4a") ? "audio/mp4" : "audio/webm");
}
function sendVideo(req, res, s, file) {
  const safe = path.basename(file);
  if (!VIDEO_RE.test(safe)) return res.status(400).json({ error: "bad file" });
  sendFileRange(req, res, path.join(sessionVideoDir(s.id), safe), safe.endsWith(".mp4") ? "video/mp4" : "video/webm");
}

// admin-scoped session lookup
function adminSession(req, res, next) {
  const s = sessions.get(req.params.id);
  if (!s || !canSee(req.admin, s)) return res.status(404).json({ error: "no session" });
  req.sos = s; next();
}
app.get("/api/session/:id/audio", requireAdmin, adminSession, async (req, res) => {
  const s = req.sos;
  res.json({ files: (await listAudio(s.id)).map((f) => ({ name: f, url: "/api/session/" + s.id + "/audio/" + f })) });
});
app.get("/api/session/:id/audio/:file", requireAdmin, adminSession, (req, res) => sendAudio(req, res, req.sos, req.params.file));

app.post("/api/session/:id/video",
  express.raw({ type: ["video/*", "application/octet-stream"], limit: "40mb" }), upload.single("video"),
  async (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ error: "no session" });
    const { buf, mime } = bufFromReq(req);
    if (!buf || !buf.length) return res.status(400).json({ error: "no video body" });
    const cam = videoCamSafe(req.query.cam || req.headers["x-sos-cam"] || "cam");
    try { const file = await saveMedia(s, "video", buf, mime, cam); res.json({ ok: true, file, cam, count: s.videoFiles.length }); }
    catch (e) { res.status(500).json({ error: "write failed", detail: e.message }); }
  });
app.get("/api/session/:id/video", requireAdmin, adminSession, async (req, res) => {
  const s = req.sos;
  res.json({ files: (await listVideo(s.id)).map((f) => ({ name: f, url: "/api/session/" + s.id + "/video/" + f })) });
});
app.get("/api/session/:id/video/:file", requireAdmin, adminSession, (req, res) => sendVideo(req, res, req.sos, req.params.file));

// =====================================================================
// partner / integration API  (/api/partner/v1)
// =====================================================================
const P = "/api/partner/v1";
function extractKey(req) {
  let key = req.headers["x-api-key"] || "";
  const auth = req.headers.authorization || "";
  if (!key && /^Bearer\s+/i.test(auth)) key = auth.replace(/^Bearer\s+/i, "").trim();
  return String(key || "");
}
function logActivity(req, res, k) {
  res.on("finish", () => {
    bg(db.q("INSERT INTO partner_activity(key_id,method,endpoint,session_id,status,ip) VALUES($1,$2,$3,$4,$5,$6)",
      [k.id, req.method, (req.baseUrl + req.path).replace(P, "").slice(0, 200), req.params?.id || res.locals.sessionId || null, res.statusCode, req.ip || null]));
  });
}
function requirePartner(req, res, next) {
  const key = extractKey(req);
  if (!key) return res.status(401).json({ error: "missing_api_key" });
  if (key.startsWith("ssos_pub_")) return res.status(403).json({ error: "read_token_is_read_only" });
  const k = keysByHash.get(sha256(key));
  if (!k) return res.status(401).json({ error: "invalid_api_key" });
  if (!k.enabled) return res.status(401).json({ error: "api_key_disabled" });
  req.key = k; req.partner = k.partner;
  pendingLastUsed.set(k.id, Date.now());
  logActivity(req, res, k);
  next();
}
function partnerSession(req, res, next) {
  const s = sessions.get(req.params.id);
  if (!s || s.keyId !== req.key.id) return res.status(404).json({ error: "session_not_found" });
  req.sos = s; next();
}
function partnerView(s) {
  return {
    sessionId: s.id, externalRef: s.externalRef || null, deviceId: s.deviceId, appId: s.source, partner: s.partner || null,
    user: s.user || null, active: !!s.active, status: s.status, createdAt: s.createdAt, endedAt: s.endedAt || null,
    endedBy: s.endedBy || null, lastLocation: s.locations.at(-1) || s.lastLocation || null,
    locationCount: s.locations.length, nearbyCount: (s.nearby || []).length || s.nearbyCount || 0,
    audioCount: (s.audioFiles || []).filter((f) => f.startsWith("chunk-")).length,
    videoCount: (s.videoFiles || []).length,
  };
}
async function sendWebhook(k, url, event, payload) {
  const body = JSON.stringify({ event, ...payload });
  const sig = "sha256=" + crypto.createHmac("sha256", k.webhook_secret).update(body).digest("hex");
  try {
    const r = await fetch(url, { method: "POST", body, signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json", "X-SSOS-Signature": sig, "X-SSOS-Event": event, "X-NSS-Signature": sig, "X-NSS-Event": event, "User-Agent": "SmartSOS-Webhook/1" } });
    return { ok: r.ok, status: r.status };
  } catch (e) { console.error("webhook failed", k.partner, event, e.message); return { ok: false, error: e.message }; }
}
function notifyPartner(s, event, extra = {}) {
  const k = s?.keyId && keysById.get(s.keyId);
  if (!k || !k.enabled) return;
  const urls = new Set([k.webhook_url, s.callbackUrl].filter(Boolean));
  for (const url of urls) sendWebhook(k, url, event, { ts: Date.now(), session: partnerView(s), ...extra });
}

app.get(P + "/ping", requirePartner, (req, res) => res.json({ ok: true, partner: req.partner, org: req.key.org_name }));

app.post(P + "/sessions", requirePartner, async (req, res) => {
  const b = req.body || {};
  const ext = b.external_ref ? String(b.external_ref).slice(0, 128) : null;
  if (ext) {
    for (const s of sessions.values())
      if (s.keyId === req.key.id && s.externalRef === ext && s.active) return res.json({ ...partnerView(s), duplicate: true });
  }
  const id = crypto.randomUUID().slice(0, 8);
  const appId = String(b.app_id || req.partner).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || req.partner;
  const s = {
    id, deviceId: String(b.device_id || "unknown-device").slice(0, 128),
    decoyName: String(b.user?.name || b.app_name || appId).slice(0, 80),
    source: appId, partner: req.partner, keyId: req.key.id, ownerAdminId: req.key.owner_admin_id || null, externalRef: ext,
    user: b.user && typeof b.user === "object" ? b.user : null,
    metadata: b.metadata && typeof b.metadata === "object" ? b.metadata : null,
    callbackUrl: typeof b.callback_url === "string" && /^https:\/\//.test(b.callback_url) ? b.callback_url : null,
    room: "sos-" + id, createdAt: Date.now(), endedAt: null, active: true,
    status: "SOS triggered (" + appId + ")", locations: [], nearby: [], audioFiles: [], videoFiles: [], events: [],
  };
  if (JSON.stringify(s.user || {}).length + JSON.stringify(s.metadata || {}).length > 16000)
    return res.status(413).json({ error: "metadata_too_large" });
  if (typeof b.lat === "number" && typeof b.lng === "number") s.locations.push({ lat: b.lat, lng: b.lng, acc: b.acc ?? null, ts: Date.now() });
  if (Array.isArray(b.nearby)) s.nearby = b.nearby.slice(0, MAX_NEARBY);
  sessions.set(id, s);
  res.locals.sessionId = id;
  await persist(s);
  if (s.locations.length) bg(db.addLocations(id, s.locations));
  if (s.nearby.length) bg(db.addNearby(id, s.nearby));
  broadcast({ type: "alert", session: publicSession(s) });
  const out = { ...partnerView(s) };
  if (b.want_livekit) out.livekit = { url: LIVEKIT_URL, room: s.room, token: await mintToken(s.room, "partner-" + s.deviceId, { canPublish: true, canSubscribe: false }) };
  notifyPartner(s, "session.created");
  res.status(201).json(out);
});
app.get(P + "/sessions", requirePartner, (req, res) => {
  const list = [...sessions.values()].filter((s) => s.keyId === req.key.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
  res.json({ sessions: list.map(partnerView) });
});
app.get(P + "/sessions/:id", requirePartner, partnerSession, (req, res) => res.json(partnerView(req.sos)));
app.post(P + "/sessions/:id/location", requirePartner, partnerSession, (req, res) => {
  const pts = (Array.isArray(req.body?.points) ? req.body.points : [req.body || {}]).slice(0, 100)
    .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
    .map((p) => ({ lat: p.lat, lng: p.lng, acc: p.acc ?? null, ts: typeof p.ts === "number" ? p.ts : Date.now(), ...(typeof p.speed === "number" ? { speed: p.speed } : {}) }));
  if (!pts.length) return res.status(400).json({ error: "lat_lng_required" });
  addLocationPoints(req.sos, pts);
  res.json({ ok: true, added: pts.length });
});
app.post(P + "/sessions/:id/nearby", requirePartner, partnerSession, (req, res) => {
  setNearby(req.sos, Array.isArray(req.body?.devices) ? req.body.devices.slice(0, MAX_NEARBY) : []);
  res.json({ ok: true, count: req.sos.nearby.length });
});
app.post(P + "/sessions/:id/events", requirePartner, partnerSession, (req, res) => {
  const s = req.sos;
  const type = String(req.body?.type || "").slice(0, 60);
  if (!type) return res.status(400).json({ error: "type_required" });
  const ev = { type, message: req.body?.message ? String(req.body.message).slice(0, 500) : null, data: req.body?.data ?? null, ts: Date.now() };
  s.events.push(ev);
  while (s.events.length > 500) s.events.shift();
  s.status = ev.message ? type + ": " + ev.message : type;
  bg(db.addEvent(s.id, ev));
  persist(s);
  broadcast({ type: "status", sessionId: s.id, event: ev, session: publicSession(s) });
  res.json({ ok: true });
});
app.post(P + "/sessions/:id/audio", requirePartner, partnerSession,
  express.raw({ type: ["audio/*", "application/octet-stream"], limit: "25mb" }), upload.single("audio"),
  async (req, res) => {
    const { buf, mime } = bufFromReq(req);
    if (!buf || !buf.length) return res.status(400).json({ error: "no_audio_body" });
    try { res.json({ ok: true, file: await saveMedia(req.sos, "audio", buf, mime) }); }
    catch { res.status(500).json({ error: "write_failed" }); }
  });
app.post(P + "/sessions/:id/video", requirePartner, partnerSession,
  express.raw({ type: ["video/*", "application/octet-stream"], limit: "40mb" }), upload.single("video"),
  async (req, res) => {
    const { buf, mime } = bufFromReq(req);
    if (!buf || !buf.length) return res.status(400).json({ error: "no_video_body" });
    const cam = videoCamSafe(req.query.cam || req.headers["x-sos-cam"] || req.body?.cam || "cam");
    try { res.json({ ok: true, file: await saveMedia(req.sos, "video", buf, mime, cam), cam }); }
    catch { res.status(500).json({ error: "write_failed" }); }
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

// =====================================================================
// partner display feed (read token for websites, or API key server-side)
// =====================================================================
const feedSubs = new Map();   // keyId -> Set<res>
const feedRing = new Map();   // keyId -> [{id, event, data}]
let feedSeq = Date.now();
function originAllowed(k, origin) {
  const list = k.allowed_origins || [];
  return list.includes("*") || list.includes(String(origin).replace(/\/+$/, ""));
}
function feedAuth(req, res, next) {
  const origin = req.headers.origin;
  const token = String(req.query.token || req.headers["x-read-token"] || "");
  let k = null, viaToken = false;
  if (token) { k = [...keysById.values()].find((x) => safeEq(x.read_token, token)); viaToken = true; }
  else { const key = extractKey(req); if (key) k = keysByHash.get(sha256(key)); }
  if (!k) return res.status(401).json({ error: "invalid_token" });
  if (!k.enabled) return res.status(401).json({ error: "api_key_disabled" });
  if (origin) {
    if (viaToken && !originAllowed(k, origin)) return res.status(403).json({ error: "origin_not_allowed", origin });
    if (originAllowed(k, origin) || viaToken) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
  }
  req.key = k;
  if (req.path.indexOf("/stream") < 0 && req.path.indexOf("/media/") < 0) logActivity(req, res, k);
  next();
}
app.options(P + "/feed/*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "X-Read-Token, Last-Event-ID, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.status(204).end();
});
function feedSessionView(s, token) {
  const v = partnerView(s);
  const q = token ? "?token=" + encodeURIComponent(token) : "";
  v.audio = (s.audioFiles || []).filter((f) => f.startsWith("chunk-")).sort().map((f) => P + "/feed/sessions/" + s.id + "/media/audio/" + f + q);
  v.video = (s.videoFiles || []).slice().sort().map((f) => P + "/feed/sessions/" + s.id + "/media/video/" + f + q);
  return v;
}
app.get(P + "/feed/sessions", feedAuth, (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
  const tok = req.query.token ? String(req.query.token) : "";
  const list = [...sessions.values()].filter((s) => s.keyId === req.key.id)
    .filter((s) => req.query.active === "1" ? s.active : true)
    .sort((a, b) => (b.active - a.active) || (b.createdAt - a.createdAt)).slice(0, limit);
  res.json({ org: req.key.org_name, sessions: list.map((s) => feedSessionView(s, tok)) });
});
app.get(P + "/feed/sessions/:id", feedAuth, async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s || s.keyId !== req.key.id) return res.status(404).json({ error: "session_not_found" });
  await db.hydrate(s);
  const v = feedSessionView(s, req.query.token ? String(req.query.token) : "");
  v.locations = s.locations; v.nearby = s.nearby; v.events = s.events;
  res.json(v);
});
app.get(P + "/feed/sessions/:id/media/:kind/:file", feedAuth, (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s || s.keyId !== req.key.id) return res.status(404).json({ error: "session_not_found" });
  if (req.params.kind === "audio") return sendAudio(req, res, s, req.params.file);
  if (req.params.kind === "video") return sendVideo(req, res, s, req.params.file);
  res.status(400).json({ error: "bad kind" });
});
app.get(P + "/feed/stream", feedAuth, (req, res) => {
  const k = req.key;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 3000\n\n");
  const last = Number(req.headers["last-event-id"] || req.query.lastEventId || 0);
  const ring = feedRing.get(k.id) || [];
  if (last) for (const e of ring) if (e.id > last) res.write(`id: ${e.id}\nevent: ${e.event}\ndata: ${e.data}\n\n`);
  const tok = req.query.token ? String(req.query.token) : "";
  const snapshot = [...sessions.values()].filter((s) => s.keyId === k.id && s.active).map((s) => feedSessionView(s, tok));
  res.write(`event: snapshot\ndata: ${JSON.stringify({ sessions: snapshot })}\n\n`);
  if (!feedSubs.has(k.id)) feedSubs.set(k.id, new Set());
  feedSubs.get(k.id).add(res);
  const hb = setInterval(() => res.write(": hb " + Date.now() + "\n\n"), 25000);
  req.on("close", () => { clearInterval(hb); feedSubs.get(k.id)?.delete(res); });
});
function closeFeedSubscribers(keyId) { for (const r of feedSubs.get(keyId) || []) { try { r.end(); } catch {} } feedSubs.delete(keyId); }
function feedEmit(s, msg) {
  if (!s?.keyId) return;
  const map = { alert: "session.created", location: "location", nearby: "nearby", status: "event", audio: "media", video: "media", ended: "session.ended" };
  const event = map[msg.type]; if (!event) return;
  const payload = { sessionId: s.id, session: partnerView(s) };
  if (msg.type === "location") payload.point = msg.point;
  if (msg.type === "nearby") payload.devices = msg.devices;
  if (msg.type === "status") payload.event = msg.event;
  if (msg.type === "audio" || msg.type === "video") Object.assign(payload, { kind: msg.type, file: msg.file, cam: msg.cam || null,
    path: P + "/feed/sessions/" + s.id + "/media/" + msg.type + "/" + msg.file });
  const e = { id: ++feedSeq, event, data: JSON.stringify(payload) };
  const ring = feedRing.get(s.keyId) || []; ring.push(e); while (ring.length > 200) ring.shift(); feedRing.set(s.keyId, ring);
  for (const r of feedSubs.get(s.keyId) || []) r.write(`id: ${e.id}\nevent: ${e.event}\ndata: ${e.data}\n\n`);
}

// =====================================================================
// admin session endpoints
// =====================================================================
app.get("/api/sessions", requireAdmin, (req, res) => {
  res.json({ sessions: [...sessions.values()].filter((s) => canSee(req.admin, s)).map((s) => publicSession(s)) });
});
app.get("/api/session/:id", requireAdmin, adminSession, async (req, res) => {
  await db.hydrate(req.sos);
  res.json(publicSession(req.sos, true));
});
app.get("/api/session/:id/listen-token", requireAdmin, adminSession, async (req, res) => {
  const token = await mintToken(req.sos.room, "admin-" + req.admin.username + "-" + hex(2), { canPublish: false, canSubscribe: true });
  res.json({ livekitUrl: LIVEKIT_URL, token, room: req.sos.room });
});
app.post("/api/session/:id/end", requireAdmin, adminSession, (req, res) => {
  const s = req.sos;
  if (s.active) endSessionObj(s, "ended by admin");
  broadcast({ type: "ended", sessionId: s.id, by: "admin", session: publicSession(s) });
  res.json({ ok: true, active: s.active, status: s.status });
});

function endSessionObj(s, status, by) {
  s.active = false;
  s.status = status;
  s.endedAt = Date.now();
  s.endedBy = by || (/admin/.test(status) ? "admin" : "device");
  persist(s);
  notifyPartner(s, "session.ended", { endedBy: s.endedBy });
}

function publicSession(s, full = false) {
  const base = {
    id: s.id, deviceId: s.deviceId, decoyName: s.decoyName, source: s.source || "unknown", room: s.room,
    createdAt: s.createdAt, endedAt: s.endedAt || null, active: s.active, status: s.status,
    lastLocation: s.locations.at(-1) || s.lastLocation || null,
    nearbyCount: (s.nearby || []).length || s.nearbyCount || 0,
    hasAudio: (s.audioFiles || []).length > 0, hasVideo: (s.videoFiles || []).length > 0,
    duration: s.endedAt && s.createdAt ? s.endedAt - s.createdAt : null,
    partner: s.partner || null, keyId: s.keyId || null,
    org: s.keyId && keysById.get(s.keyId) ? keysById.get(s.keyId).org_name : (s.partner || null),
  };
  if (full) {
    base.locations = s.locations; base.nearby = s.nearby;
    base.audioFiles = s.audioFiles || []; base.videoFiles = s.videoFiles || [];
    if (s.partner) { base.externalRef = s.externalRef || null; base.user = s.user || null; base.metadata = s.metadata || null; base.events = s.events || []; }
  }
  return base;
}

async function mintToken(room, identity, grants) {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, ttl: "2h" });
  at.addGrant({ room, roomJoin: true, canPublish: grants.canPublish, canSubscribe: grants.canSubscribe, canPublishData: true });
  return await at.toJwt();
}

app.get("/healthz", async (req, res) => {
  try { await db.q("SELECT 1"); res.json({ ok: true, db: true }); } catch { res.status(503).json({ ok: false, db: false }); }
});
app.use(express.static(path.join(__dirname, "public")));
app.use((err, req, res, next) => { console.error("error", req.method, req.path, err.message); res.status(err.status || 500).json({ error: err.status ? err.message : "server_error" }); });

// =====================================================================
// admin WebSocket (filtered per admin)
// =====================================================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const clients = new Set();
wss.on("connection", async (ws, req) => {
  const a = await adminFromCookie(parseCookie(req.headers.cookie)?.sg_session);
  if (!a) { ws.close(1008, "unauthorized"); return; }
  const c = { ws, admin: a };
  clients.add(c);
  ws.send(JSON.stringify({ type: "hello", sessions: [...sessions.values()].filter((s) => canSee(a, s)).map((s) => publicSession(s)) }));
  ws.on("close", () => clients.delete(c));
});
function broadcast(msg) {
  const s = sessions.get(msg.sessionId || msg.session?.id);
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.ws.readyState === c.ws.OPEN && canSee(c.admin, s)) c.ws.send(data);
  feedEmit(s, msg);
}
function parseCookie(str) {
  if (!str) return {};
  return Object.fromEntries(str.split(";").map((c) => {
    const i = c.indexOf("=");
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
  }));
}

server.listen(PORT, () => {
  console.log("Smart SOS server on :" + PORT + "  (LiveKit: " + LIVEKIT_URL + ", DATA_DIR: " + DATA_DIR + ")");
});
