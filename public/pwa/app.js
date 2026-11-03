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
  if(d.theme === "calc"){
    main.innerHTML = `
      <div class="calc">
        <div class="screen" id="screen">0</div>
        <div class="keys">
          ${["C","÷","×","⌫","7","8","9","-","4","5","6","+","1","2","3","=","0",".","%","±"].map(k=>{
            const cls = "key" + (["÷","×","-","+","%","±"].includes(k)?" op":"") + (k==="="?" eq":"");
            return `<div class="${cls}" data-k="${k}">${k}</div>`;
          }).join("")}
        </div>
      </div>
      <div class="sos-zone">
        <button class="sos-btn" id="sosBtn">SOS</button>
        <div class="status" id="status">Tap SOS to start an alert</div>
      </div>`;
    wireCalc();
  } else {
    main.innerHTML = `
      <div class="notes">
        <textarea id="note" placeholder="Write a note…"></textarea>
      </div>
      <div class="sos-zone">
        <button class="sos-btn" id="sosBtn">SOS</button>
        <div class="status" id="status">Tap SOS to start an alert</div>
      </div>`;
    const note = document.getElementById("note");
    note.value = localStorage.getItem("nss_note")||"";
    note.oninput = ()=> localStorage.setItem("nss_note", note.value);
  }
  document.getElementById("sosBtn").onclick = toggleSos;
}

function wireCalc(){
  let expr="";
  const screen = document.getElementById("screen");
  document.querySelectorAll(".key").forEach(el=>{
    el.onclick = ()=>{
      const k = el.dataset.k;
      if(k==="C"){ expr=""; screen.textContent="0"; return; }
      if(k==="⌫"){ expr=expr.slice(0,-1); screen.textContent=expr||"0"; return; }
      if(k==="="){
        try{
          const safe = expr.replace(/×/g,"*").replace(/÷/g,"/").replace(/±/g,"-");
          // eslint-disable-next-line no-new-func
          const v = Function('"use strict";return ('+safe+')')();
          expr = String(v); screen.textContent=expr; 
        }catch{ screen.textContent="Err"; expr=""; }
        return;
      }
      expr += k==="×"?"×":k==="÷"?"÷":k;
      screen.textContent = expr;
    };
  });
}

// ---- SOS session ----
let active = false;
let sessionId = null;
let room = null;
let mediaStream = null;
let recorder = null;
let watchId = null;
let uploadTimer = null;

function setStatus(t){ const el=document.getElementById("status"); if(el) el.textContent=t; }

async function toggleSos(){
  if(active) return stopSos();
  await startSos();
}

async function startSos(){
  const decoy = getDecoy();
  const btn = document.getElementById("sosBtn");
  setStatus("Requesting mic & location…");
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({audio:true, video:false});
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
  btn.textContent = "STOP";

  // LiveKit publish
  try{
    room = new LivekitClient.Room();
    await room.connect(data.livekitUrl, data.token);
    const track = new LivekitClient.LocalAudioTrack(mediaStream.getAudioTracks()[0]);
    await room.localParticipant.publishTrack(track);
  }catch(e){ setStatus("Live audio failed (recording continues): "+e.message); }

  // MediaRecorder -> upload chunks
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
}

function startRecorder(){
  if(!mediaStream) return;
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
    : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
    : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : ""));
  try{
    recorder = new MediaRecorder(mediaStream, mime ? {mimeType: mime} : undefined);
  }catch(e){ setStatus("Recorder unavailable: "+e.message); return; }
  recorder.ondataavailable = async (ev)=>{
    if(!ev.data || !ev.data.size || !sessionId) return;
    try{
      await fetch("/api/session/"+sessionId+"/audio", {
        method:"POST",
        headers:{"Content-Type": ev.data.type || "audio/webm"},
        body: ev.data,
      });
    }catch{}
  };
  recorder.start(10000); // ~10s chunks
}

async function stopSos(){
  const btn = document.getElementById("sosBtn");
  setStatus("Stopping…");
  active = false;
  if(recorder && recorder.state !== "inactive"){
    await new Promise((res)=>{ recorder.onstop = res; try{recorder.stop();}catch{res();} });
  }
  recorder = null;
  if(room){ try{ room.disconnect(); }catch{} room=null; }
  if(mediaStream){ mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null; }
  if(watchId!=null){ navigator.geolocation.clearWatch(watchId); watchId=null; }

  if(sessionId){
    try{ await fetch("/api/session/"+sessionId+"/audio/finalize", {method:"POST"}); }catch{}
    try{ await fetch("/api/session/"+sessionId+"/stop", {method:"POST"}); }catch{}
  }
  const sid = sessionId; sessionId=null;
  btn.classList.remove("on"); btn.textContent="SOS";
  setStatus(sid ? ("Ended · "+sid) : "Idle");
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
