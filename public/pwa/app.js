// Decoy PWA for Now Smart SOS
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
  setStatus("Allow mic & location when prompted…");
  btn.disabled = true;
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
let mediaStream = null;
let recorder = null;
let watchId = null;
let uploadTimer = null;
let statusPollTimer = null;
let endingByAdmin = false;

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
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}, video:false});
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
  showCover();

  // LiveKit publish — use LiveKit's own mic track (don't wrap the MediaRecorder stream)
  try{
    room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
    await room.connect(data.livekitUrl, data.token);
    // Prefer LiveKit helper so encode/mute state is correct across browsers
    if (room.localParticipant.setMicrophoneEnabled) {
      await room.localParticipant.setMicrophoneEnabled(true);
    } else {
      const lkTrack = await LivekitClient.createLocalAudioTrack({
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      });
      await room.localParticipant.publishTrack(lkTrack);
    }
    setStatus("LiveKit connected · session "+sessionId);
  }catch(e){ setStatus("Live audio failed (recording continues): "+e.message); }

  // MediaRecorder on a CLONE of the local mic stream (LiveKit owns its own track)
  startRecorder();

  // Location watch
  if(navigator.geolocation){
    watchId = navigator.geolocation.watchPosition((pos)=>{
      if(!sessionId) return;
      fetch("/api/session/"+sessionId+"/location", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({lat:pos.coords.latitude, lng:pos.coords.longitude, acc:pos.coords.accuracy}),
      }).catch(()=>{});
    }, ()=>{}, {enableHighAccuracy:true, maximumAge:2000, timeout:10000});
  }

  // nearby: Web Bluetooth is opt-in; skip silently for PWA demo
  setStatus("Live · session "+sessionId);
  startStatusPoll();
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

// Restart MediaRecorder every ~30s so each upload is a complete, playable file
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
    }, 30000);
  };
  startOne();
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
  if(room){
    try{ await room.localParticipant.setMicrophoneEnabled(false); }catch{}
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
