// Decoy PWA for Smart SOS
const DECOYS = [
  {name:"Utilities", color:"#4c8dff", theme:"calc"},
  {name:"Notes", color:"#36b37e", theme:"notes"},
  {name:"Calculator Plus", color:"#6554c0", theme:"calc"},
  {name:"Weather Now", color:"#00b8d9", theme:"notes"},
  {name:"Flashlight", color:"#ffab00", theme:"notes"},
  {name:"Unit Converter", color:"#8777d9", theme:"calc"},
  {name:"File Manager", color:"#2684ff", theme:"notes"},
  {name:"QR Scanner", color:"#00c7e6", theme:"notes"},
  {name:"Compass", color:"#ff8b00", theme:"notes"},
  {name:"Battery Saver", color:"#57d9a3", theme:"notes"},
  {name:"Clock+", color:"#998dd9", theme:"calc"},
  {name:"Timer", color:"#ff7452", theme:"calc"},
  {name:"Voice Memo", color:"#4c9aff", theme:"notes"},
  {name:"Photo Vault", color:"#79f2c0", theme:"notes"},
  {name:"Puzzle Go", color:"#c0b6f2", theme:"notes"},
  {name:"Recipe Box", color:"#ffc400", theme:"notes"},
  {name:"Fit Tracker", color:"#00a3bf", theme:"notes"},
  {name:"Budget", color:"#36b37e", theme:"calc"},
  {name:"Translate", color:"#0052cc", theme:"notes"},
  {name:"Scanner Pro", color:"#5243aa", theme:"notes"},
  {name:"Cleaner", color:"#00875a", theme:"notes"},
  {name:"Wallpapers", color:"#de350b", theme:"notes"},
  {name:"Ringtones", color:"#ff5630", theme:"notes"},
  {name:"Barcode", color:"#403294", theme:"notes"},
  {name:"Maps Lite", color:"#0065ff", theme:"notes"},
  {name:"News Feed", color:"#172b4d", theme:"notes"},
  {name:"Radio FM", color:"#ff8f73", theme:"notes"},
  {name:"Podcasts", color:"#b3f5ff", theme:"notes"},
  {name:"Dictionary", color:"#b3d4ff", theme:"notes"},
  {name:"Calendar+", color:"#c1f0c8", theme:"notes"},
  {name:"Todo List", color:"#ffe380", theme:"notes"},
  {name:"Habit", color:"#eae6ff", theme:"notes"},
  {name:"Meditation", color:"#e3fcef", theme:"notes"},
  {name:"Sleep Sounds", color:"#deebff", theme:"notes"},
  {name:"White Noise", color:"#fff0b3", theme:"notes"},
  {name:"Stopwatch", color:"#ffbdad", theme:"calc"},
  {name:"Level Tool", color:"#c1c7d0", theme:"calc"},
  {name:"Ruler", color:"#97a0af", theme:"calc"},
  {name:"Magnifier", color:"#6b778c", theme:"notes"},
  {name:"Mirror", color:"#505f79", theme:"notes"},
  {name:"Speed Test", color:"#344563", theme:"calc"},
  {name:"WiFi Info", color:"#253858", theme:"notes"},
  {name:"Storage", color:"#091e42", theme:"notes"},
  {name:"Backup", color:"#0747a6", theme:"notes"},
  {name:"Notes Secure", color:"#36b37e", theme:"notes"},
  {name:"Memo Pad", color:"#6554c0", theme:"notes"},
  {name:"Expense", color:"#ff5630", theme:"calc"},
  {name:"Sketch", color:"#00b8d9", theme:"notes"},
  {name:"Draw Pad", color:"#ffab00", theme:"notes"},
  {name:"Color Picker", color:"#ff8b00", theme:"notes"},
];

function uuid(){
  if(crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==="x"?r:(r&0x3|0x8)).toString(16);});
}

function getDeviceId(){
  let id = localStorage.getItem("nss_device");
  if(!id){ id = uuid(); localStorage.setItem("nss_device", id); }
  return id;
}

function getDecoy(){
  let raw = localStorage.getItem("nss_decoy");
  if(raw){ try{ return JSON.parse(raw);}catch{} }
  const d = DECOYS[Math.floor(Math.random()*DECOYS.length)];
  localStorage.setItem("nss_decoy", JSON.stringify(d));
  return d;
}

function makeIcon(color, letter){
  const c = document.createElement("canvas"); c.width=192; c.height=192;
  const ctx = c.getContext("2d");
  // rounded rect
  const r=36; ctx.beginPath();
  ctx.moveTo(r,0); ctx.arcTo(192,0,192,192,r); ctx.arcTo(192,192,0,192,r);
  ctx.arcTo(0,192,0,0,r); ctx.arcTo(0,0,192,0,r); ctx.closePath();
  ctx.fillStyle=color; ctx.fill();
  ctx.fillStyle="#fff"; ctx.font="bold 96px system-ui,sans-serif";
  ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText((letter||"A").slice(0,1).toUpperCase(), 96, 104);
  return c.toDataURL("image/png");
}

function applyDecoy(d){
  document.title = d.name;
  document.getElementById("appName").textContent = d.name;
  const logo = document.getElementById("logo");
  logo.style.background = d.color;
  logo.textContent = d.name.slice(0,1).toUpperCase();
  document.querySelector('meta[name="theme-color"]').content = d.color;

  const icon = makeIcon(d.color, d.name);
  document.getElementById("appleIcon").href = icon;

  const manifest = {
    name: d.name,
    short_name: d.name.slice(0,12),
    start_url: "./",
    display: "standalone",
    background_color: "#0f1115",
    theme_color: d.color,
    icons: [
      { src: icon, sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: icon, sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  };
  const blob = new Blob([JSON.stringify(manifest)], {type:"application/manifest+json"});
  document.getElementById("manifest").href = URL.createObjectURL(blob);
}

function renderChrome(d){
  const main = document.getElementById("main");
  main.innerHTML = `
    <button class="sos-btn" id="sosBtn">SOS</button>
    <div class="status" id="status"></div>`;
  wireSosButton();
}

function isReady(){ return localStorage.getItem("nss_ready") === "1"; }

function wireSosButton(){
  const btn = document.getElementById("sosBtn");
  if(!btn) return;
  if(!isReady()){
    btn.classList.remove("on");
    btn.textContent = "I'm ready";
    setStatus("You're safe now — tap to enable protection, then SOS works in one tap");
    btn.onclick = enableProtection;
  } else {
    btn.classList.remove("on");
    btn.textContent = "SOS";
    setStatus("Protection on — tap SOS when you need help");
    btn.onclick = toggleSos;
  }
}

async function enableProtection(){
  const btn = document.getElementById("sosBtn");
  setStatus("Allow mic, camera & location when prompted…");
  btn.disabled = true;
  // Prime mic first (required)
  try{
    const stream = await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
      video:false,
    });
    stream.getTracks().forEach(t=>t.stop());
  }catch(e){
    btn.disabled = false;
    setStatus("Mic needed for SOS: "+e.message);
    return;
  }
  // Prime cameras (rear then front) — best-effort; SOS still works without video
  for (const facing of ["environment","user"]){
    try{
      const vs = await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{facingMode:{ideal:facing}, width:{ideal:320}, height:{ideal:240}, frameRate:{ideal:10}},
      });
      vs.getTracks().forEach(t=>t.stop());
    }catch(e){ /* optional */ }
  }
  try{
    await new Promise((res,rej)=> navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:true,timeout:10000}));
  }catch(e){}
  localStorage.setItem("nss_ready","1");
  btn.disabled = false;
  btn.textContent = "SOS";
  btn.onclick = toggleSos;
  setStatus("You're protected — tap SOS for your first alert");
}

// ---- Quote cover (active SOS) ----
const QUOTES = [
  {t:"The Lord is my shepherd; I shall not want.", c:"Psalm 23:1"},
  {t:"Be strong and courageous. Do not be afraid.", c:"Joshua 1:9"},
  {t:"I can do all things through Christ who strengthens me.", c:"Philippians 4:13"},
  {t:"God is our refuge and strength, a very present help in trouble.", c:"Psalm 46:1"},
  {t:"Peace I leave with you; my peace I give to you.", c:"John 14:27"},
  {t:"Cast all your anxiety on him, because he cares for you.", c:"1 Peter 5:7"},
  {t:"The Lord will fight for you; you need only to be still.", c:"Exodus 14:14"},
  {t:"Fear not, for I am with you.", c:"Isaiah 41:10"},
  {t:"He will cover you with his feathers, and under his wings you will find refuge.", c:"Psalm 91:4"},
  {t:"Come to me, all who labor and are heavy laden, and I will give you rest.", c:"Matthew 11:28"},
  {t:"The light shines in the darkness, and the darkness has not overcome it.", c:"John 1:5"},
  {t:"Be still, and know that I am God.", c:"Psalm 46:10"},
  {t:"Love is patient and kind.", c:"1 Corinthians 13:4"},
  {t:"Trust in the Lord with all your heart.", c:"Proverbs 3:5"},
  {t:"Your word is a lamp to my feet and a light to my path.", c:"Psalm 119:105"},
  {t:"For God so loved the world that he gave his only Son.", c:"John 3:16"},
  {t:"The joy of the Lord is your strength.", c:"Nehemiah 8:10"},
  {t:"Ask, and it will be given to you; seek, and you will find.", c:"Matthew 7:7"},
  {t:"I am with you always, to the end of the age.", c:"Matthew 28:20"},
  {t:"Let not your hearts be troubled. Believe in God.", c:"John 14:1"},
  {t:"We walk by faith, not by sight.", c:"2 Corinthians 5:7"},
  {t:"Blessed are the peacemakers.", c:"Matthew 5:9"},
  {t:"His mercies are new every morning.", c:"Lamentations 3:23"},
  {t:"In quietness and in trust shall be your strength.", c:"Isaiah 30:15"},
  {t:"The Lord is near to the brokenhearted.", c:"Psalm 34:18"},
  {t:"Rejoice in hope, be patient in tribulation.", c:"Romans 12:12"},
  {t:"Do not be overcome by evil, but overcome evil with good.", c:"Romans 12:21"},
  {t:"Greater love has no one than this.", c:"John 15:13"},
  {t:"This is the day that the Lord has made; let us rejoice.", c:"Psalm 118:24"},
  {t:"My grace is sufficient for you.", c:"2 Corinthians 12:9"},
  {t:"Wait for the Lord; be strong, and let your heart take courage.", c:"Psalm 27:14"},
  {t:"He makes me lie down in green pastures.", c:"Psalm 23:2"},
  {t:"You are the light of the world.", c:"Matthew 5:14"},
  {t:"With God all things are possible.", c:"Matthew 19:26"},
  {t:"The Lord bless you and keep you.", c:"Numbers 6:24"},
];

let quoteTimer = null;
let holdStart = 0;
let holdRaf = null;
let holding = false;
const HOLD_MS = 8000;
const CIRC = 2 * Math.PI * 24;

function pickQuote(){
  return QUOTES[Math.floor(Math.random()*QUOTES.length)];
}

function showQuote(animate){
  const q = pickQuote();
  const el = document.getElementById("coverQuote");
  const cite = document.getElementById("coverCite");
  if(!el) return;
  if(animate){
    el.classList.add("fade");
    setTimeout(()=>{ el.textContent = "“"+q.t+"”"; cite.textContent = q.c; el.classList.remove("fade"); }, 550);
  } else {
    el.textContent = "“"+q.t+"”";
    cite.textContent = q.c;
  }
}

function setHoldProgress(p){
  const fg = document.getElementById("holdFg");
  if(!fg) return;
  const clamped = Math.max(0, Math.min(1, p));
  fg.style.strokeDashoffset = String(CIRC * (1 - clamped));
}

function showCover(){
  const cover = document.getElementById("cover");
  if(!cover) return;
  cover.classList.add("show");
  cover.setAttribute("aria-hidden","false");
  showQuote(false);
  setHoldProgress(0);
  if(quoteTimer) clearInterval(quoteTimer);
  quoteTimer = setInterval(()=> showQuote(true), 25000);
  bindHold(true);
}

function hideCover(){
  const cover = document.getElementById("cover");
  if(cover){ cover.classList.remove("show"); cover.setAttribute("aria-hidden","true"); }
  if(quoteTimer){ clearInterval(quoteTimer); quoteTimer=null; }
  bindHold(false);
  cancelHold();
  setHoldProgress(0);
}

function cancelHold(){
  holding = false;
  holdStart = 0;
  if(holdRaf){ cancelAnimationFrame(holdRaf); holdRaf=null; }
  setHoldProgress(0);
}

function tickHold(){
  if(!holding) return;
  const p = (performance.now() - holdStart) / HOLD_MS;
  setHoldProgress(p);
  if(p >= 1){
    cancelHold();
    stopSos();
    return;
  }
  holdRaf = requestAnimationFrame(tickHold);
}

function beginHold(e){
  if(!active) return;
  if(e && e.preventDefault) e.preventDefault();
  if(holding) return;
  holding = true;
  holdStart = performance.now();
  holdRaf = requestAnimationFrame(tickHold);
}

function endHold(e){
  if(e && e.preventDefault) e.preventDefault();
  cancelHold();
}

let holdBound = false;
function onKeyDown(e){
  if(e.code === "Space" || e.key === " "){ if(!e.repeat) beginHold(e); }
}
function onKeyUp(e){
  if(e.code === "Space" || e.key === " ") endHold(e);
}

function bindHold(on){
  const cover = document.getElementById("cover");
  if(!cover) return;
  if(on && !holdBound){
    cover.addEventListener("pointerdown", beginHold);
    cover.addEventListener("pointerup", endHold);
    cover.addEventListener("pointercancel", endHold);
    cover.addEventListener("pointerleave", endHold);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    holdBound = true;
  } else if(!on && holdBound){
    cover.removeEventListener("pointerdown", beginHold);
    cover.removeEventListener("pointerup", endHold);
    cover.removeEventListener("pointercancel", endHold);
    cover.removeEventListener("pointerleave", endHold);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    holdBound = false;
  }
}

// ---- SOS session ----
let active = false;
let sessionId = null;
let room = null;
let mediaStream = null; // audio-only for MediaRecorder chunks
let publishedTracks = []; // LiveKit LocalTracks (audio + video)
let recorder = null;
let watchId = null;
let uploadTimer = null;
let statusPollTimer = null;
let endingByAdmin = false;
/** @type {{cam:string, stream:MediaStream, recorder:MediaRecorder|null, timer:any, raw:MediaStreamTrack}[]} */
let videoSavers = [];

const VIDEO_LO = {
  width: { ideal: 320, max: 480 },
  height: { ideal: 240, max: 360 },
  frameRate: { ideal: 10, max: 12 },
};
const VIDEO_PUBLISH = {
  videoEncoding: { maxBitrate: 200_000, maxFramerate: 10 },
  simulcast: false,
};

function setStatus(t){ const el=document.getElementById("status"); if(el) el.textContent=t; }

async function toggleSos(){
  if(active) return; // end only via 8s hold on cover (or admin)
  await startSos();
}

async function startSos(){
  if(!isReady()){ await enableProtection(); return; }
  const decoy = getDecoy();
  const btn = document.getElementById("sosBtn");
  setStatus("Starting SOS…");
  // Audio-only stream for MediaRecorder chunks (LiveKit gets its own tracks)
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1},
      video:false,
    });
  }catch(e){ setStatus("Mic denied: "+e.message); return; }

  let lat=null, lng=null, acc=null;
  try{
    const pos = await new Promise((res,rej)=> navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:true,timeout:8000}));
    lat=pos.coords.latitude; lng=pos.coords.longitude; acc=pos.coords.accuracy;
  }catch(e){ /* location optional at start */ }

  setStatus("Opening session…");
  let data;
  try{
    const r = await fetch("/api/sos", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        deviceId: getDeviceId(),
        decoyName: decoy.name,
        lat, lng, acc,
        source: "pwa",
      }),
    });
    data = await r.json();
    if(!r.ok) throw new Error(data.error||"sos failed");
  }catch(e){ setStatus("SOS failed: "+e.message); mediaStream.getTracks().forEach(t=>t.stop()); return; }

  sessionId = data.sessionId;
  active = true;
  btn.classList.add("on");
  btn.textContent = "SOS";
  showCover(); // verse cover only — no local camera preview

  // LiveKit: high-quality audio + dual low-quality video (no local preview)
  let camNote = "no cam";
  try{
    room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
    await room.connect(data.livekitUrl, data.token);
    await publishLiveAudio();
    camNote = await publishLiveVideos();
    setStatus("LiveKit connected · "+camNote+" · session "+sessionId);
  }catch(e){ setStatus("Live stream failed (recording continues): "+e.message); }

  startRecorder();

  if(navigator.geolocation){
    watchId = navigator.geolocation.watchPosition((pos)=>{
      if(!sessionId) return;
      fetch("/api/session/"+sessionId+"/location", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({lat:pos.coords.latitude, lng:pos.coords.longitude, acc:pos.coords.accuracy}),
      }).catch(()=>{});
    }, ()=>{}, {enableHighAccuracy:true, maximumAge:2000, timeout:10000});
  }

  setStatus("Live · "+camNote+" · session "+sessionId);
  startStatusPoll();
}

async function publishLiveAudio(){
  if(!room) return;
  const lkTrack = await LivekitClient.createLocalAudioTrack({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  });
  const opts = { name: "mic", source: LivekitClient.Track.Source.Microphone };
  // Prefer higher-quality Opus preset when available
  try{
    if (LivekitClient.AudioPresets && LivekitClient.AudioPresets.musicHighQuality) {
      opts.audioPreset = LivekitClient.AudioPresets.musicHighQuality;
    } else if (LivekitClient.AudioPresets && LivekitClient.AudioPresets.music) {
      opts.audioPreset = LivekitClient.AudioPresets.music;
    } else {
      opts.audioBitrate = 48000;
    }
  }catch{}
  opts.dtx = true;
  await room.localParticipant.publishTrack(lkTrack, opts);
  publishedTracks.push(lkTrack);
}

function isMobileDevice(){
  try{ if(navigator.userAgentData && navigator.userAgentData.mobile) return true; }catch{}
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent||"") ||
    (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
}

/** Open one camera via getUserMedia. facing: "environment"|"user"|null; deviceId exact when given. */
async function openCam(facing, deviceId){
  const base = { width: VIDEO_LO.width, height: VIDEO_LO.height, frameRate: VIDEO_LO.frameRate };
  const tries = [];
  if(deviceId) tries.push({ ...base, deviceId: { exact: deviceId } });
  if(facing){
    tries.push({ ...base, facingMode: { exact: facing } });
    tries.push({ ...base, facingMode: { ideal: facing } });
  }
  tries.push(base);
  tries.push(true);
  for(const video of tries){
    try{
      const st = await navigator.mediaDevices.getUserMedia({ audio:false, video });
      const raw = st.getVideoTracks()[0];
      if(raw && raw.readyState === "live") return raw;
      st.getTracks().forEach(t=>t.stop());
    }catch(e){ console.warn("getUserMedia video", JSON.stringify(video), e && e.name); }
  }
  return null;
}

function camNameFor(raw, fallback){
  let fm = "";
  try{ fm = (raw.getSettings && raw.getSettings().facingMode) || ""; }catch{}
  const lbl = (raw.label||"").toLowerCase();
  if(fm === "environment" || /back|rear|environment/.test(lbl)) return "rear";
  if(fm === "user" || /front|user|facetime|integrated|webcam/.test(lbl)) return "front";
  return fallback || "camera";
}

/** Wait until a raw track is actually live (not muted / ended) — guards against
 *  phones that silently kill the first camera when a second one opens. */
function trackHealthy(raw){ return raw && raw.readyState === "live" && !raw.muted; }

async function publishRawVideo(raw, name){
  const track = new LivekitClient.LocalVideoTrack(raw, undefined, true);
  try{
    await room.localParticipant.publishTrack(track, {
      name, source: LivekitClient.Track.Source.Camera, simulcast: false,
      videoEncoding: { maxBitrate: 200000, maxFramerate: 10 },
    });
  }catch(e){ console.warn("publish "+name+" failed", e); try{ track.stop(); }catch{} return null; }
  publishedTracks.push(track);
  try{ startVideoSaver(track, name); }catch(e){ console.warn("video saver", name, e); }
  return track;
}

async function publishLiveVideos(){
  // ROOT-CAUSE FIX: phones (iOS + most Android) allow only ONE camera open at a time.
  // Opening the 2nd cam silently ended/muted the 1st -> admin saw "Waiting" tiles.
  // Desktops with one webcam returned the same device twice for "environment"+"user".
  // So: one primary cam (rear on mobile, front on desktop); a 2nd cam only on desktop
  // with a distinct device, and only if the primary is still healthy afterwards.
  if(!room) return "no cam";
  const mobile = isMobileDevice();
  const primaryFacing = mobile ? "environment" : "user";
  const raw1 = await openCam(primaryFacing, null);
  if(!raw1) return "no cam";
  const name1 = camNameFor(raw1, mobile ? "rear" : "front");
  const t1 = await publishRawVideo(raw1, name1);
  if(!t1){ try{ raw1.stop(); }catch{} return "no cam"; }
  if(mobile) return name1+" cam";

  let devs = [];
  try{ devs = (await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="videoinput"); }catch{}
  const used = (raw1.getSettings && raw1.getSettings().deviceId) || "";
  const other = devs.find(d=>d.deviceId && d.deviceId !== used);
  if(!other) return name1+" cam";
  const raw2 = await openCam(null, other.deviceId);
  if(!raw2) return name1+" cam";
  const id2 = (raw2.getSettings && raw2.getSettings().deviceId) || "";
  await new Promise(r=>setTimeout(r, 800));
  if(id2 === used || !trackHealthy(raw1)){
    try{ raw2.stop(); }catch{}
    return name1+" cam";
  }
  let name2 = camNameFor(raw2, "cam2"); if(name2 === name1) name2 = name1 === "front" ? "cam2" : "front";
  const t2 = await publishRawVideo(raw2, name2);
  if(!t2){ try{ raw2.stop(); }catch{} return name1+" cam"; }
  return name1+"+"+name2+" cams";
}

function pickMime(){
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
  ];
  for (const m of candidates){
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

async function uploadBlob(blob){
  if(!blob || !blob.size || !sessionId) return;
  try{
    const r = await fetch("/api/session/"+sessionId+"/audio", {
      method:"POST",
      headers:{"Content-Type": blob.type || "audio/webm"},
      body: blob,
    });
    if(!r.ok) console.warn("audio upload failed", r.status);
  }catch(e){ console.warn("audio upload error", e); }
}

// Restart MediaRecorder every ~60s so each upload is a complete, playable file
// (timeslice blobs after the first are not valid standalone WebM and play as 0:00).
function startRecorder(){
  if(!mediaStream) return;
  const mime = pickMime();
  let recordStream = mediaStream;
  try { recordStream = mediaStream.clone(); } catch {}

  const startOne = ()=>{
    if(!active || !sessionId) return;
    let rec;
    try{
      rec = new MediaRecorder(recordStream, mime ? {mimeType: mime, audioBitsPerSecond: 64000} : {audioBitsPerSecond: 64000});
    }catch(e){ setStatus("Recorder unavailable: "+e.message); return; }
    recorder = rec;
    rec.ondataavailable = async (ev)=>{
      // only use the blob from stop() — full file with headers
      if(ev.data && ev.data.size) await uploadBlob(ev.data);
    };
    rec.onerror = (e)=> console.warn("MediaRecorder error", e);
    try { rec.start(); } catch(e){ setStatus("Recorder start failed: "+e.message); return; }
    uploadTimer = setTimeout(()=>{
      if(recorder === rec && rec.state === "recording"){
        try { rec.stop(); } catch {}
        // start next segment after stop flushes
        setTimeout(startOne, 200);
      }
    }, 60000);
  };
  startOne();
}

function pickVideoMime(withAudio){
  const candidates = withAudio === false ? ["video/webm;codecs=vp8","video/webm","video/mp4"] : [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/mp4;codecs=avc1,mp4a",
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9",
    "video/webm",
    "video/mp4",
  ];
  for (const m of candidates){
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

async function uploadVideoBlob(blob, cam){
  const sid = sessionId;
  if(!blob || !blob.size || !sid) return;
  const type = String(blob.type || "video/webm").split(";")[0] || "video/webm";
  for(let attempt=0; attempt<3; attempt++){
  try{
    const r = await fetch("/api/session/"+sid+"/video?cam="+encodeURIComponent(cam||"cam"), {
      method:"POST",
      headers:{
        "Content-Type": type,
        "X-Sos-Cam": cam || "cam",
      },
      body: blob,
    });
    if(r.ok) return;
    console.warn("video upload failed", cam, r.status);
    if(r.status < 500 && r.status !== 408 && r.status !== 429) return;
  }catch(e){ console.warn("video upload error", cam, e); }
  await new Promise(r=>setTimeout(r, 1500*(attempt+1)));
  }
}

/** Record ~60s video+audio chunks from the published camera (separate from the audio-only stream).
 *  Root-cause fixes: (1) record from a CLONE of the camera track, re-read from the LiveKit
 *  track each segment, so LiveKit pausing/restarting/replacing its track can't end our recorder;
 *  (2) mime/opts fallbacks — some Android/iOS builds report vp8+opus supported then throw on
 *  start(), which previously aborted video saving silently; (3) uploads are tracked + retried
 *  and stopSos waits for them before ending the session. */
let videoUploads = new Set();
function startVideoSaver(track, cam){
  if(!track) return;
  const entry = { cam: cam || "cam", stream: null, recorder: null, timer: null, raw: null, fails: 0 };
  videoSavers.push(entry);
  const curRaw = ()=>{ try{ return track.mediaStreamTrack || (track.mediaStream && track.mediaStream.getVideoTracks()[0]); }catch{ return null; } };
  const buildStream = ()=>{
    const r = curRaw(); if(!r || r.readyState === "ended") return null;
    const v = r.clone(); const tracks = [v];
    try{ const a = mediaStream && mediaStream.getAudioTracks()[0]; if(a && a.readyState==="live") tracks.push(a.clone()); }catch{}
    return new MediaStream(tracks);
  };
  const makeRec = (stream)=>{
    const hasA = stream.getAudioTracks().length > 0;
    const mimes = [pickVideoMime(hasA), ""];
    for(const m of mimes){
      const opts = { videoBitsPerSecond: 250000 }; if(hasA) opts.audioBitsPerSecond = 48000; if(m) opts.mimeType = m;
      try{ const rec = new MediaRecorder(stream, opts); rec.start(); return rec; }
      catch(e){ console.warn("video recorder", cam, m||"(default)", e && e.name); }
    }
    return null;
  };
  const cleanup = (st)=>{ try{ st && st.getTracks().forEach(t=>t.stop()); }catch{} };
  const startOne = ()=>{
    if(!active || !sessionId) return;
    let stream = buildStream();
    if(!stream){ if(++entry.fails < 20) entry.timer = setTimeout(startOne, 3000); return; }
    let rec = makeRec(stream);
    if(!rec && stream.getAudioTracks().length){ // retry video-only
      stream.getAudioTracks().forEach(t=>t.stop()); stream = new MediaStream(stream.getVideoTracks()); rec = makeRec(stream);
    }
    if(!rec){ cleanup(stream); setStatus("Video save unavailable on this device (live + audio continue)"); return; }
    entry.stream = stream; entry.recorder = rec; entry.fails = 0;
    const parts = [];
    rec.ondataavailable = (ev)=>{ if(ev.data && ev.data.size) parts.push(ev.data); };
    rec.onstop = ()=>{
      cleanup(stream);
      if(parts.length){
        const blob = new Blob(parts, { type: (rec.mimeType || parts[0].type || "video/webm") });
        const p = uploadVideoBlob(blob, entry.cam); videoUploads.add(p); p.finally(()=>videoUploads.delete(p));
      }
    };
    rec.onerror = (e)=> console.warn("video MediaRecorder error", cam, e);
    entry.timer = setTimeout(()=>{
      if(entry.recorder === rec && rec.state !== "inactive"){
        try { rec.stop(); } catch {}
        setTimeout(startOne, 250);
      }
    }, 60000);
  };
  startOne();
}

async function stopVideoSavers(){
  const pending = [];
  for (const entry of videoSavers){
    if(entry.timer){ clearTimeout(entry.timer); entry.timer=null; }
    const rec = entry.recorder;
    if(rec && rec.state !== "inactive"){
      pending.push(new Promise((res)=>{
        const done = ()=>res();
        rec.addEventListener("stop", done, {once:true});
        try{ rec.stop(); }catch{ done(); }
      }));
    }
    entry.recorder = null;
  }
  videoSavers = [];
  if(pending.length) await Promise.all(pending);
  await new Promise(r=>setTimeout(r, 50));
  if(videoUploads.size) await Promise.race([Promise.allSettled([...videoUploads]), new Promise(r=>setTimeout(r, 45000))]);
}


function startStatusPoll(){
  stopStatusPoll();
  statusPollTimer = setInterval(async ()=>{
    if(!active || !sessionId) return;
    try{
      const r = await fetch("/api/session/"+sessionId+"/status");
      if(!r.ok) return;
      const st = await r.json();
      if(st && (st.active === false || (st.status && /ended by admin/i.test(st.status)))){
        endingByAdmin = true;
        setStatus("Ended by admin — stopping…");
        await stopSos();
      }
    }catch{}
  }, 3000);
}
function stopStatusPoll(){
  if(statusPollTimer){ clearInterval(statusPollTimer); statusPollTimer=null; }
}

async function stopSos(){
  const btn = document.getElementById("sosBtn");
  const byAdmin = endingByAdmin;
  endingByAdmin = false;
  if(!byAdmin) setStatus("Stopping…");
  active = false;
  stopStatusPoll();
  if(uploadTimer){ clearTimeout(uploadTimer); uploadTimer=null; }
  if(recorder && recorder.state !== "inactive"){
    await new Promise((res)=>{
      const r = recorder;
      r.onstop = res;
      try{ r.requestData(); }catch{}
      try{ r.stop(); }catch{ res(); }
    });
  }
  recorder = null;
  // Flush last video segments before tearing down camera tracks
  try{ await stopVideoSavers(); }catch{}
  // brief pause so ondataavailable uploads can start
  await new Promise(r=>setTimeout(r, 300));
  // Stop & unpublish LiveKit tracks (mic + cams)
  for (const t of publishedTracks){
    try{ if(room && room.localParticipant) await room.localParticipant.unpublishTrack(t); }catch{}
    try{ t.stop(); }catch{}
    try{ t.mediaStreamTrack && t.mediaStreamTrack.stop(); }catch{}
  }
  publishedTracks = [];
  if(room){
    try{ await room.localParticipant.setMicrophoneEnabled(false); }catch{}
    try{ await room.localParticipant.setCameraEnabled(false); }catch{}
    try{ room.disconnect(); }catch{}
    room=null;
  }
  if(mediaStream){ mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null; }
  if(watchId!=null){ navigator.geolocation.clearWatch(watchId); watchId=null; }

  if(sessionId){
    // Always finalize uploads; stop is idempotent if admin already ended the session.
    try{ await fetch("/api/session/"+sessionId+"/audio/finalize", {method:"POST"}); }catch{}
    try{ await fetch("/api/session/"+sessionId+"/stop", {method:"POST"}); }catch{}
  }
  const sid = sessionId; sessionId=null;
  hideCover();
  if(btn){ btn.classList.remove("on"); btn.textContent="SOS"; btn.onclick = toggleSos; }
  if(byAdmin) setStatus(sid ? ("Ended by admin · "+sid) : "Ended by admin");
  else setStatus(sid ? ("Ended · "+sid) : "Idle");
}

// install prompt
let deferredPrompt=null;
window.addEventListener("beforeinstallprompt",(e)=>{
  e.preventDefault(); deferredPrompt=e;
  document.getElementById("installBtn").style.display="block";
});
window.doInstall = async ()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt=null;
  document.getElementById("installBtn").style.display="none";
};

// boot
const decoy = getDecoy();
applyDecoy(decoy);
renderChrome(decoy);
if("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
