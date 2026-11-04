// Post-end upload window test. Start the server with a short window:
//   POST_END_UPLOAD_WINDOW_MS=3000 node server.js
//   BASE=http://127.0.0.1:7474 API_KEY=ssos_live_… WINDOW_MS=3000 node test/upload-window.test.mjs
const BASE = process.env.BASE || "http://127.0.0.1:7474";
const KEY = process.env.API_KEY, WIN = Number(process.env.WINDOW_MS || 3000);
const P = BASE + "/api/partner/v1";
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const H = { "x-api-key": KEY };
const post = (p, body, type = "application/json") => fetch(P + p, { method: "POST", headers: { ...H, "content-type": type }, body });
const clip = Buffer.from("1a45dfa3", "hex");
const c = await (await post("/sessions", JSON.stringify({ external_ref: "win-" + Date.now(), device_id: "dev-w" }))).json();
const id = c.sessionId;
await post("/sessions/" + id + "/end", "{}");
const v = await (await fetch(P + "/sessions/" + id, { headers: H })).json();
ok(v.active === false && v.mediaUploadOpen === true && v.mediaUploadUntil > Date.now(), "ended session reports upload window open");
const a = await post("/sessions/" + id + "/audio", clip, "audio/webm");
ok(a.status === 200, "audio within window → 200 (" + a.status + ")");
const vd = await post("/sessions/" + id + "/video?cam=rear", clip, "video/webm");
ok(vd.status === 200, "video within window → 200 (" + vd.status + ")");
const v2 = await (await fetch(P + "/sessions/" + id, { headers: H })).json();
ok(v2.active === false && v2.sessionId === id, "still the same ended session");
await new Promise((r) => setTimeout(r, WIN + 500));
const late = await post("/sessions/" + id + "/audio", clip, "audio/webm");
const lb = await late.json().catch(() => ({}));
ok(late.status === 409 && lb.error === "upload_window_closed", "audio after window → 409 upload_window_closed");
process.exit(fails ? 1 : 0);
