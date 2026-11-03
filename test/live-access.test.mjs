// Proof test: ended SOS sessions cannot be rejoined with old LiveKit JWTs.
// Needs a running Smart SOS server + a real LiveKit server.
//   BASE=http://127.0.0.1:7474 API_KEY=ssos_live_… ADMIN_USER=… ADMIN_PASSWORD=… \
//   LIVEKIT_URL=ws://… LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… node test/live-access.test.mjs
import { Room, RoomEvent } from "@livekit/rtc-node";
import { RoomServiceClient } from "livekit-server-sdk";
const BASE = process.env.BASE || "http://127.0.0.1:7474";
const KEY = process.env.API_KEY;
const P = BASE + "/api/partner/v1";
const rs = new RoomServiceClient(process.env.LIVEKIT_URL.replace(/^ws/, "http"), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (path, body, hdr = {}) => {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-api-key": KEY, ...hdr }, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
};
async function join(url, token) {
  const room = new Room();
  try { await Promise.race([room.connect(url, token, { autoSubscribe: true, dynacast: false }), sleep(8000).then(() => { throw new Error("timeout"); })]); return room; }
  catch (e) { try { await room.disconnect(); } catch {} return { error: e.message || String(e) }; }
}

const ext = "proof-" + Date.now();
const c = await call(P + "/sessions", { external_ref: ext, device_id: "dev-1", want_livekit: true });
ok(c.status === 201 && c.body.livekit?.token, "create want_livekit → 201 with publisher token");
ok(typeof c.body.livekit?.expiresAt === "number" && c.body.livekit?.ttlSeconds > 0, "create returns expiresAt/ttlSeconds (" + c.body.livekit?.ttlSeconds + "s)");
const id = c.body.sessionId, room0 = c.body.livekit.room;
console.log("  session", id, "room", room0);

const v1 = await call(P + `/sessions/${id}/livekit/viewer`, { operator_id: "ops-42" });
const v2 = await call(P + `/sessions/${id}/livekit/viewer`, { operator_id: "ops-42" });
ok(v1.status === 200 && v1.body.room === room0, "viewer token bound to current room");
ok(v1.body.identity === v2.body.identity, "viewer renew preserves identity (" + v1.body.identity + ")");
const p2 = await call(P + `/sessions/${id}/livekit/publisher`, { device_id: "dev-1" });
ok(p2.status === 200 && p2.body.identity === c.body.livekit.identity, "publisher renew preserves identity (" + p2.body.identity + ")");
const dup = await call(P + "/sessions", { external_ref: ext, want_livekit: true });
ok(dup.status === 200 && dup.body.sessionId === id && dup.body.duplicate, "same external_ref while active → same session");

// admin
const lr = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.ADMIN_USER, password: process.env.ADMIN_PASSWORD }) });
const cookie = (lr.headers.get("set-cookie") || "").split(";")[0];
const at = await (await fetch(BASE + `/api/session/${id}/listen-token`, { headers: { cookie } })).json();
ok(at.room === room0 && at.expiresAt, "admin listen-token on current room with expiresAt");

const pub = await join(c.body.livekit.url, c.body.livekit.token);
const view = await join(v1.body.url, v1.body.token);
const adm = await join(at.url, at.token);
ok(!pub.error && !view.error && !adm.error, "pre-end: publisher, partner viewer, admin all join" + (pub.error || view.error || adm.error ? " (" + (pub.error || view.error || adm.error) + ")" : ""));
const dropped = { pub: false, view: false, adm: false };
for (const [k, r] of Object.entries({ pub, view, adm })) r.on?.(RoomEvent.Disconnected, () => (dropped[k] = true));

const e = await call(P + `/sessions/${id}/end`, { reason: "proof" });
ok(e.status === 200 && e.body.active === false, "end session");
for (let i = 0; i < 20 && !(dropped.pub && dropped.view && dropped.adm); i++) await sleep(250);
ok(dropped.pub && dropped.view && dropped.adm, "E: all connected participants forcibly disconnected on end " + JSON.stringify(dropped));
for (const r of [pub, view, adm]) try { await r.disconnect?.(); } catch {}

const rooms1 = (await rs.listRooms()).map((r) => r.name);
ok(!rooms1.includes(room0), "old room deleted on LiveKit");

const rp = await join(c.body.livekit.url, c.body.livekit.token);
const rv = await join(v1.body.url, v1.body.token);
const rp2 = await join(p2.body.url, p2.body.token);
await sleep(2500);
let pubStillIn = !rp.error, viewStillIn = !rv.error;
// if LiveKit auto_create is on, connect may succeed briefly; the webhook must tear it down.
const rooms2 = (await rs.listRooms()).map((r) => r.name);
if (!rp.error) pubStillIn = rp.isConnected; if (!rv.error) viewStillIn = rv.isConnected;
console.log("  old publisher reconnect:", rp.error || ("connected=" + pubStillIn), "| old viewer reconnect:", rv.error || ("connected=" + viewStillIn), "| renewed-publisher:", rp2.error || ("connected=" + rp2.isConnected));
ok(!pubStillIn && !viewStillIn && !(rp2.isConnected), "B: old (and renewed-before-end) tokens cannot hold a connection after end");
ok(!rooms2.includes(room0), "old room not usable / not recreated on LiveKit (rooms now: " + JSON.stringify(rooms2) + ")");
for (const r of [rp, rv, rp2]) try { await r.disconnect?.(); } catch {}

const rv2 = await call(P + `/sessions/${id}/livekit/viewer`, { operator_id: "ops-42" });
const rp3 = await call(P + `/sessions/${id}/livekit/publisher`, { device_id: "dev-1" });
const al = await fetch(BASE + `/api/session/${id}/listen-token`, { headers: { cookie } });
ok(rv2.status === 409 && rv2.body.error === "session_ended", "viewer remint after end → 409 session_ended");
ok(rp3.status === 409, "publisher remint after end → 409");
ok(al.status === 409, "admin listen-token after end → 409");
const again = await call(P + "/sessions", { external_ref: ext, want_livekit: true });
ok(again.status === 409 && again.body.sessionId === id, "create with ended external_ref → 409 session_ended (" + again.body.sessionId + ")");
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
