// Smart SOS — Postgres layer: pool, migrations, legacy import, write-through helpers.
import pg from "pg";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export let pool = null;

export async function initDb(url) {
  if (!url) {
    console.error("\n[Smart SOS] DATABASE_URL is required (postgres://user:pass@host:5432/db).\n" +
      "Coolify: add a PostgreSQL resource and copy its internal URL into DATABASE_URL.\n");
    process.exit(1);
  }
  const ssl = /sslmode=(require|verify|prefer)/.test(url) || process.env.PGSSL === "1" ? { rejectUnauthorized: false } : undefined;
  pool = new pg.Pool({ connectionString: url, max: 10, ssl });
  pool.on("error", (e) => console.error("pg pool error", e.message));
  for (let i = 0; ; i++) {
    try { await pool.query("SELECT 1"); break; }
    catch (e) {
      const host = (() => { try { return new URL(url).host; } catch { return "?"; } })();
      if (i >= 30) {
        console.error(`\n[Smart SOS] refusing to start: cannot connect to Postgres at ${host}: ${e.message}\n` +
          "Check DATABASE_URL uses Coolify's INTERNAL Postgres URL, the app and Postgres share a network\n" +
          "(enable 'Connect to Predefined Network' on this app), and try ?sslmode=require or PGSSL=1 if SSL is enforced.\n");
        process.exit(1);
      }
      console.log(`[Smart SOS] waiting for postgres at ${host} (${i + 1}/30)…`, e.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await runMigrations();
}

async function runMigrations() {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, ran_at timestamptz DEFAULT now())");
  const dir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await pool.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(sql);
      await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
      await c.query("COMMIT");
      console.log("migration applied:", f);
    } catch (e) { await c.query("ROLLBACK"); throw e; }
    finally { c.release(); }
  }
}

export const q = (text, params) => pool.query(text, params);

export async function getMeta(k) { const r = await q("SELECT value FROM meta WHERE key=$1", [k]); return r.rows[0]?.value ?? null; }
export async function setMeta(k, v) { await q("INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()", [k, v]); }

// ---------- sessions write-through ----------
export async function upsertSession(s, client = pool) {
  const last = s.locations?.at(-1) || s.lastLocation || null;
  const extra = { nearbyCount: (s.nearby || []).length || s.nearbyCount || 0, ...(s.extra || {}) };
  await client.query(`INSERT INTO sessions(id,source,partner,key_id,owner_admin_id,external_ref,device_id,decoy_name,"user",metadata,room,active,status,
      started_at,ended_at,end_reason,ended_by,callback_url,last_lat,last_lng,last_acc,last_seen,extra)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
    ON CONFLICT(id) DO UPDATE SET source=$2,partner=$3,key_id=$4,owner_admin_id=$5,external_ref=$6,device_id=$7,decoy_name=$8,"user"=$9,metadata=$10,
      room=$11,active=$12,status=$13,started_at=$14,ended_at=$15,end_reason=$16,ended_by=$17,callback_url=$18,last_lat=$19,last_lng=$20,last_acc=$21,last_seen=$22,extra=$23`,
    [s.id, s.source || null, s.partner || null, s.keyId || null, s.ownerAdminId || null, s.externalRef || null, s.deviceId || null, s.decoyName || null,
     s.user ? JSON.stringify(s.user) : null, s.metadata ? JSON.stringify(s.metadata) : null, s.room || null, !!s.active, s.status || null,
     s.createdAt || null, s.endedAt || null, s.endReason || null, s.endedBy || null, s.callbackUrl || null,
     last?.lat ?? null, last?.lng ?? null, last?.acc ?? null, last?.ts ?? null, JSON.stringify(extra)]);
}
export async function insertSessionIfMissing(s, client) {
  const r = await client.query("SELECT 1 FROM sessions WHERE id=$1", [s.id]);
  if (r.rowCount) return false;
  await upsertSession(s, client); return true;
}
export async function addLocations(id, pts, client = pool) {
  for (const p of pts) {
    await client.query("INSERT INTO session_locations(session_id,ts,lat,lng,acc,speed) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [id, p.ts || Date.now(), p.lat, p.lng, p.acc ?? null, p.speed ?? null]);
  }
}
export async function addNearby(id, list, ts = Date.now(), client = pool) {
  await client.query("INSERT INTO session_nearby(session_id,ts,data) VALUES($1,$2,$3)", [id, ts, JSON.stringify(list || [])]);
}
export async function addEvent(id, ev, client = pool) {
  await client.query("INSERT INTO session_events(session_id,ts,type,data) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [id, ev.ts || Date.now(), ev.type, JSON.stringify({ message: ev.message ?? null, data: ev.data ?? null })]);
}
export async function addMedia(m, client = pool) {
  await client.query(`INSERT INTO media_files(session_id,kind,cam,rel_path,name,bytes,mime,seq,merged) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(session_id,rel_path) DO UPDATE SET bytes=EXCLUDED.bytes`,
    [m.sessionId, m.kind, m.cam || null, m.relPath, m.name, m.bytes ?? null, m.mime || null, m.seq ?? null, !!m.merged]);
}

function rowToSession(r) {
  const last = r.last_lat != null ? { lat: r.last_lat, lng: r.last_lng, acc: r.last_acc, ts: Number(r.last_seen) || null } : null;
  return {
    id: r.id, source: r.source || "unknown", partner: r.partner || null, keyId: r.key_id || null, ownerAdminId: r.owner_admin_id || null,
    externalRef: r.external_ref, deviceId: r.device_id, decoyName: r.decoy_name, user: r.user, metadata: r.metadata,
    room: r.room, active: r.active, status: r.status, createdAt: Number(r.started_at) || null, endedAt: r.ended_at ? Number(r.ended_at) : null,
    endReason: r.end_reason, endedBy: r.ended_by, callbackUrl: r.callback_url, extra: r.extra || {},
    lastLocation: last, nearbyCount: r.extra?.nearbyCount || 0,
    locations: last ? [last] : [], nearby: [], events: [], audioFiles: [], videoFiles: [], _lite: true,
  };
}

/** Load all sessions (lite: last location only) + media names. Active sessions get full children. */
export async function loadSessions() {
  const out = new Map();
  for (const r of (await q("SELECT * FROM sessions ORDER BY started_at")).rows) out.set(r.id, rowToSession(r));
  for (const m of (await q("SELECT session_id,kind,name FROM media_files ORDER BY name")).rows) {
    const s = out.get(m.session_id); if (!s) continue;
    (m.kind === "video" ? s.videoFiles : s.audioFiles).push(m.name);
  }
  for (const s of out.values()) if (s.active) await hydrate(s);
  return out;
}
export async function hydrate(s) {
  if (!s._lite) return s;
  const L = await q("SELECT ts,lat,lng,acc,speed FROM (SELECT * FROM session_locations WHERE session_id=$1 ORDER BY ts DESC LIMIT 500) x ORDER BY ts", [s.id]);
  s.locations = L.rows.map((r) => ({ lat: r.lat, lng: r.lng, acc: r.acc, ts: Number(r.ts), ...(r.speed != null ? { speed: r.speed } : {}) }));
  const N = await q("SELECT data FROM session_nearby WHERE session_id=$1 ORDER BY ts DESC, id DESC LIMIT 1", [s.id]);
  s.nearby = N.rows[0]?.data || [];
  const E = await q("SELECT ts,type,data FROM session_events WHERE session_id=$1 ORDER BY ts LIMIT 500", [s.id]);
  s.events = E.rows.map((r) => ({ type: r.type, message: r.data?.message ?? null, data: r.data?.data ?? null, ts: Number(r.ts) }));
  s._lite = false;
  return s;
}

// ---------- legacy import (disk + env → Postgres), idempotent ----------
export async function legacyImport({ dataDir, envKeys, makeKeyRow, force }) {
  const done = await getMeta("legacy_import_done");
  if (done && !force) { console.log("legacy import already done at", done); return null; }
  const counts = { sessions: 0, locations: 0, events: 0, media: 0, keys: 0 };
  // 1) env keys
  const keyByPartner = new Map();
  for (const k of envKeys) {
    const hash = crypto.createHash("sha256").update(k.key).digest("hex");
    const ex = await q("SELECT id FROM partner_keys WHERE key_hash=$1", [hash]);
    if (ex.rowCount) { keyByPartner.set(k.partner, ex.rows[0].id); continue; }
    const row = makeKeyRow(k);
    const r = await q(`INSERT INTO partner_keys(key_hash,key_prefix,key_enc,partner,org_name,webhook_url,webhook_secret,read_token,allowed_origins,owner_admin_id,imported)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,true) RETURNING id`,
      [hash, row.prefix, row.enc, k.partner, row.orgName, k.webhook || null, row.webhookSecret, row.readToken, []]);
    keyByPartner.set(k.partner, r.rows[0].id); counts.keys++;
  }
  // 2) history JSON
  const hdir = path.join(dataDir, "history");
  let files = []; try { files = fs.readdirSync(hdir).filter((f) => f.endsWith(".json")); } catch {}
  for (const f of files) {
    let s; try { s = JSON.parse(fs.readFileSync(path.join(hdir, f), "utf8")); } catch { continue; }
    if (!s?.id) continue;
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      if (s.partner && keyByPartner.has(s.partner)) s.keyId = keyByPartner.get(s.partner);
      if (s.active) { s.active = false; s.status = (s.status || "") + " (closed at migration)"; s.endedAt = s.endedAt || Date.now(); }
      if (await insertSessionIfMissing(s, c)) counts.sessions++;
      const locs = Array.isArray(s.locations) ? s.locations.filter((p) => typeof p.lat === "number") : [];
      await addLocations(s.id, locs, c); counts.locations += locs.length;
      if (Array.isArray(s.nearby) && s.nearby.length) {
        const ex = await c.query("SELECT 1 FROM session_nearby WHERE session_id=$1 LIMIT 1", [s.id]);
        if (!ex.rowCount) await addNearby(s.id, s.nearby, s.endedAt || s.createdAt || Date.now(), c);
      }
      for (const ev of Array.isArray(s.events) ? s.events : []) { if (ev?.type) { await addEvent(s.id, ev, c); counts.events++; } }
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK"); console.error("import failed", f, e.message); }
    finally { c.release(); }
  }
  // 3) media inventory
  for (const kind of ["audio", "video"]) {
    const base = path.join(dataDir, kind);
    let dirs = []; try { dirs = fs.readdirSync(base); } catch {}
    for (const sid of dirs) {
      const ex = await q("SELECT 1 FROM sessions WHERE id=$1", [sid]);
      if (!ex.rowCount) await upsertSession({ id: sid, source: "unknown", active: false, status: "imported media", createdAt: null });
      let names = []; try { names = await fsp.readdir(path.join(base, sid)); } catch {}
      for (const n of names) {
        if (!/\.(webm|m4a|mp4)$/i.test(n)) continue;
        let st; try { st = await fsp.stat(path.join(base, sid, n)); } catch { continue; }
        const vm = /^video-([a-z0-9_-]+)-(\d+)\./i.exec(n), am = /^chunk-(\d+)\./.exec(n);
        await addMedia({ sessionId: sid, kind, cam: vm ? vm[1] : null, relPath: kind + "/" + sid + "/" + n, name: n, bytes: st.size,
          mime: (kind === "video" ? "video/" : "audio/") + (n.endsWith(".mp4") ? "mp4" : n.endsWith(".m4a") ? "mp4" : "webm"),
          seq: vm ? +vm[2] : am ? +am[1] : null, merged: n.startsWith("recording") });
        counts.media++;
      }
    }
  }
  await setMeta("legacy_import_done", new Date().toISOString());
  console.log("legacy import complete:", JSON.stringify(counts));
  return counts;
}
