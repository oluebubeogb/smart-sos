// Smart SOS admin: extra pages (Partners & Keys, Docs, Admins, Account) + nav
(function(){
const $=(s,r=document)=>r.querySelector(s);
const esc=(v)=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const mask=(k)=>!k?"—":k.length<16?k:k.slice(0,k.lastIndexOf("_")+7)+"••••••••"+k.slice(-4);
async function j(path,opts={}){
  const r=await fetch(path,{credentials:"same-origin",headers:{"Content-Type":"application/json"},...opts});
  let d={}; try{ d=await r.json(); }catch{}
  if(r.status===401){ location.reload(); throw new Error("unauth"); }
  if(!r.ok) throw new Error(d.error||("HTTP "+r.status));
  return d;
}
window.SSOS = { me:null, page:"sessions" };
window.ssosLoadMe = async()=>{
  const r=await fetch("/api/me",{credentials:"same-origin"}); if(!r.ok) throw new Error("unauth");
  SSOS.me = await r.json(); return SSOS.me; };
const isSuper=()=>SSOS.me&&SSOS.me.role==="super";

const ic=(d)=>`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS={
  live:ic('<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/>'),
  history:ic('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
  keys:ic('<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M17 6l3 3M15 8l2 2"/>'),
  docs:ic('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  admins:ic('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>'),
  account:ic('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  trash:ic('<path d="M3 6h18M8 6V4h8v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6"/>'),
  collapse:ic('<path d="M15 6l-6 6 6 6"/>'),
};
window.SSOS.collapsed = (()=>{ try{ return localStorage.getItem("ssos_sidebar_collapsed")==="1"; }catch{ return false; } })();
window.toggleSidebar = ()=>{ SSOS.collapsed=!SSOS.collapsed; try{ localStorage.setItem("ssos_sidebar_collapsed",SSOS.collapsed?"1":"0"); }catch{} window.__rerender(); };
const nvItem=(on,click,icon,label,extra="")=>`<div class="nv ${on?'on':''}" onclick="${click}" title="${label.replace(/&amp;/g,'&')}"><span class="ni">${ICONS[icon]}</span><span class="nl">${label}</span>${extra}</div>`;
window.ssosNav = ()=>`
  <div class="sbhead">
    <img class="sbicon" src="/icon.png" alt="Smart SOS" title="Smart SOS">
    <span class="sbname">Smart SOS</span>
  </div>
  <nav class="nav">
    ${nvItem(SSOS.page==='sessions'&&window.__filter()==='live',"goSessions('live')","live","Live",'<span class="n" id="n-live"></span>')}
    ${nvItem(SSOS.page==='sessions'&&window.__filter()==='history',"goSessions('history')","history","History",'<span class="n" id="n-hist"></span>')}
    ${nvItem(SSOS.page==='keys',"goPage('keys')","keys","Partners &amp; Keys")}
    ${nvItem(SSOS.page==='docs',"goPage('docs')","docs","Docs")}
    ${isSuper()?nvItem(SSOS.page==='admins',"goPage('admins')","admins","Admins"):''}
    ${nvItem(SSOS.page==='account',"goPage('account')","account","Account")}
    ${nvItem(SSOS.page==='trash',"goPage('trash')","trash","Trash")}
  </nav>`;
window.goPage = (p)=>{ SSOS.page=p; window.__rerender(); };
window.goSessions = (f)=>{ SSOS.page="sessions"; window.setFilter(f); };

function modal(html){
  closeModal();
  const m=document.createElement("div"); m.className="modal-bg"; m.id="ssosModal";
  m.innerHTML=`<div class="modal">${html}<button class="mx" onclick="closeModal()">×</button></div>`;
  m.addEventListener("click",e=>{ if(e.target===m) closeModal(); });
  document.body.appendChild(m);
}
window.closeModal=()=>{ const m=$("#ssosModal"); if(m) m.remove(); };
window.copyText=async(t,btn)=>{ try{ await navigator.clipboard.writeText(t); if(btn){ const o=btn.textContent; btn.textContent="Copied"; setTimeout(()=>btn.textContent=o,1200);} }catch{ prompt("Copy:",t); } };
const secretRow=(label,val,note)=>`<div class="sec"><div class="k">${label}</div><div class="secv"><code>${esc(val||"—")}</code>${val?`<button class="btn sm" onclick="copyText(${esc(JSON.stringify(val))},this)">Copy</button>`:''}</div>${note?`<div class="mut sm">${note}</div>`:''}</div>`;

// ---------------- Partners & Keys ----------------
async function renderKeys(el){
  el.innerHTML=`<div class="page"><div class="ph"><h2>Partners &amp; Keys</h2><div class="sp"></div><button class="btn primary" onclick="newKey()">+ New key</button></div><div id="keysBody" class="mut">Loading…</div>
  <h3 style="margin-top:28px">Recent activity</h3><div id="actBody" class="mut">Loading…</div></div>`;
  const {keys}=await j("/api/keys");
  $("#keysBody").innerHTML = !keys.length?`<div class="emptybox">No partner keys yet. Create one to let a partner app send SOS alerts.</div>`:`
  <table class="tbl"><thead><tr><th>Organisation</th><th>API key</th><th>Webhook</th><th>Sessions</th><th>Last used</th>${isSuper()?'<th>Created by</th>':''}<th>Status</th><th></th></tr></thead><tbody>
  ${keys.map(k=>`<tr>
    <td><b>${esc(k.orgName)}</b><div class="mut sm">${esc(k.partner)}${k.imported?' · imported from env':''}</div></td>
    <td><code>${esc(k.keyPrefix)}</code></td>
    <td class="sm">${k.webhookUrl?esc(k.webhookUrl):'<span class="mut">—</span>'}</td>
    <td>${k.sessionCount}${k.activeCount?` <span class="pill live">${k.activeCount} live</span>`:''}</td>
    <td class="sm">${k.lastUsedAt?new Date(k.lastUsedAt).toLocaleString():'<span class="mut">never</span>'}</td>
    ${isSuper()?`<td class="sm">${esc(k.createdBy||'—')}</td>`:''}
    <td>${k.enabled?'<span class="pill ok">Enabled</span>':'<span class="pill ended">Disabled</span>'}</td>
    <td class="acts"><button class="btn sm" onclick="manageKey('${k.id}')">Manage</button></td></tr>`).join("")}
  </tbody></table>`;
  window.__keys=keys;
  const {activity}=await j("/api/activity");
  $("#actBody").innerHTML=actTable(activity,true);
}
const actTable=(a,org)=>!a.length?`<div class="emptybox">No partner API calls yet.</div>`:`<table class="tbl"><thead><tr><th>Time</th>${org?'<th>Org</th>':''}<th>Call</th><th>Session</th><th>Status</th><th>IP</th></tr></thead><tbody>
  ${a.map(r=>`<tr><td class="sm">${new Date(r.ts).toLocaleString()}</td>${org?`<td>${esc(r.org_name)}</td>`:''}<td><code>${esc(r.method)} ${esc(r.endpoint)}</code></td><td class="sm">${esc(r.session_id||'')}</td><td><span class="pill ${r.status<400?"ok":"bad"}">${r.status}</span>${r.status>=400?`<div class="hint">${esc(r.detail||actHint(r))}</div>`:''}</td><td class="sm mut">${esc(r.ip||'')}</td></tr>`).join("")}</tbody></table>`;

// Fallback hint for older rows logged before error detail was stored.
function actHint(r){
  const sid=r.session_id;
  if(r.status===404) return sid?`Session not found — no SOS with id/ref "${sid}" for this key.`:"Not found — check the URL path.";
  if(r.status===401) return "Not authorised — API key missing, invalid or disabled.";
  if(r.status===403) return "Forbidden — wrong credential type or origin.";
  if(r.status===409) return "Conflict — this SOS has already ended.";
  if(r.status===400) return "Bad request — a required field is missing or invalid.";
  if(r.status===413) return "Request body too large.";
  return r.status>=500?"Server error.":"Request rejected.";
}
window.newKey=()=>modal(`<h3>New partner key</h3>
  <label>Organisation name</label><input id="kOrg" placeholder="e.g. SafeCorps">
  <label>Webhook URL <span class="mut">(optional, https)</span></label><input id="kHook" placeholder="https://partner.example.com/smart-sos/webhook">
  <label>Allowed origins for the display feed <span class="mut">(comma separated, * for any)</span></label><input id="kOrig" placeholder="https://partner.example.com">
  <div class="err" id="kErr"></div><button class="btn primary" onclick="createKey()">Generate key</button>`);
window.createKey=async()=>{
  try{
    const d=await j("/api/keys",{method:"POST",body:JSON.stringify({orgName:$("#kOrg").value,webhookUrl:$("#kHook").value,allowedOrigins:$("#kOrig").value})});
    modal(`<h3>Key created — ${esc(d.key.orgName)}</h3><p class="mut sm">Hand these to the partner over a secure channel. You can reveal them again later from Manage.</p>
      ${secretRow("API key (server-side only — X-API-Key)",d.apiKey)}${secretRow("Read token (public display feed)",d.readToken)}${secretRow("Webhook signing secret (HMAC-SHA256)",d.webhookSecret)}
      <button class="btn primary" onclick="closeModal();goPage('keys')">Done</button>`);
  }catch(e){ $("#kErr").textContent=e.message; }
};
window.manageKey=async(id)=>{
  const k=(window.__keys||[]).find(x=>x.id===id); if(!k) return;
  modal(`<h3>${esc(k.orgName)} <span class="mut sm">${esc(k.partner)}</span></h3>
    <div class="tabs"><span class="on">Settings</span></div>
    <label>Organisation name</label><input id="mOrg" value="${esc(k.orgName)}">
    <label>Webhook URL</label><input id="mHook" value="${esc(k.webhookUrl||'')}">
    <label>Allowed origins (display feed)</label><input id="mOrig" value="${esc((k.allowedOrigins||[]).join(', '))}">
    <label class="chk"><input type="checkbox" id="mEn" ${k.enabled?'checked':''}> Enabled</label>
    <div class="row"><button class="btn primary" onclick="saveKey('${id}')">Save</button><button class="btn" onclick="revealKey('${id}')">Reveal secrets</button><button class="btn" onclick="testHook('${id}')">Send test webhook</button><button class="btn" onclick="keyActivity('${id}')">Activity</button></div>
    <div class="row"><button class="btn warn" onclick="rotate('${id}','api')">Rotate API key</button><button class="btn warn" onclick="rotate('${id}','read')">Rotate read token</button><button class="btn warn" onclick="rotate('${id}','webhook')">Rotate webhook secret</button><div class="sp"></div><button class="btn danger" onclick="revokeKey('${id}')">Move to trash</button></div>
    <div class="err" id="mErr"></div><div id="mOut"></div>`);
};
window.saveKey=async(id)=>{ try{ await j(`/api/keys/${id}`,{method:"PATCH",body:JSON.stringify({orgName:$("#mOrg").value,webhookUrl:$("#mHook").value,allowedOrigins:$("#mOrig").value,enabled:$("#mEn").checked})}); closeModal(); goPage('keys'); }catch(e){ $("#mErr").textContent=e.message; } };
window.revealKey=async(id)=>{ try{ const d=await j(`/api/keys/${id}/reveal`); $("#mOut").innerHTML=secretRow("API key",d.apiKey,d.note)+secretRow("Read token",d.readToken)+secretRow("Webhook secret",d.webhookSecret); }catch(e){ $("#mErr").textContent=e.message; } };
window.testHook=async(id)=>{ $("#mOut").innerHTML='<p class="mut sm">Sending…</p>'; try{ const d=await j(`/api/keys/${id}/webhook-test`,{method:"POST"}); $("#mOut").innerHTML=`<p class="sm">${d.ok?'✅ Delivered':'⚠️ Failed'} ${esc(d.status||'')} ${esc(d.error||'')}</p>`; }catch(e){ $("#mErr").textContent=e.message; } };
window.keyActivity=async(id)=>{ const d=await j(`/api/keys/${id}/activity`); $("#mOut").innerHTML=`<div class="scroll">${actTable(d.activity,false)}</div>`; };
window.rotate=async(id,what)=>{
  const msg={api:"The partner's current API key stops working immediately.",read:"Display widgets using the old read token disconnect.",webhook:"The partner must update their signature verification."}[what];
  if(!confirm("Rotate? "+msg)) return;
  try{ const d=await j(`/api/keys/${id}/rotate`,{method:"POST",body:JSON.stringify({what})});
    $("#mOut").innerHTML=secretRow("New "+({api:"API key",read:"read token",webhook:"webhook secret"})[what],d.apiKey||d.readToken||d.webhookSecret); refreshKeysQuiet(); }catch(e){ $("#mErr").textContent=e.message; }
};
async function refreshKeysQuiet(){ try{ window.__keys=(await j("/api/keys")).keys; }catch{} }
window.revokeKey=async(id)=>{ if(!confirm("Move this key to trash? Partner calls with it stop working until you restore it from Trash. Session history is kept.")) return; await j(`/api/keys/${id}`,{method:"DELETE"}); closeModal(); goPage('keys'); };

// ---------------- Admins (super) ----------------
async function renderAdmins(el){
  el.innerHTML=`<div class="page"><div class="ph"><h2>Admins</h2><div class="sp"></div><button class="btn primary" onclick="newAdmin()">+ New admin</button></div><div id="admBody" class="mut">Loading…</div></div>`;
  const {admins}=await j("/api/admins");
  $("#admBody").innerHTML=`<table class="tbl"><thead><tr><th>Username</th><th>Email</th><th>Keys</th><th>Created</th><th>Status</th><th></th></tr></thead><tbody>
    <tr><td><b>${esc(SSOS.me.username)}</b> <span class="pill live">superadmin</span></td><td class="mut">—</td><td>—</td><td>—</td><td>—</td><td></td></tr>
    ${admins.map(a=>`<tr><td><b>${esc(a.username)}</b></td><td>${esc(a.email)}</td><td>${a.keyCount}</td><td class="sm">${new Date(a.createdAt).toLocaleDateString()}</td>
    <td>${a.disabled?'<span class="pill ended">Disabled</span>':'<span class="pill ok">Active</span>'}</td>
    <td class="acts"><button class="btn sm" onclick="resetPw('${a.id}','${esc(a.username)}')">Reset password</button><button class="btn sm" onclick="toggleAdmin('${a.id}',${!a.disabled})">${a.disabled?'Enable':'Disable'}</button><button class="btn sm danger" onclick="delAdmin('${a.id}','${esc(a.username)}')">Move to trash</button></td></tr>`).join("")}</tbody></table>
    <p class="mut sm">Admins see only their own keys, sessions and activity. Trashing an admin signs them out and moves their keys and sessions to the superadmin; restoring from Trash hands them back.</p>`;
}
window.newAdmin=()=>modal(`<h3>New admin</h3><label>Username</label><input id="aU" autocomplete="off"><label>Email</label><input id="aE" type="email"><label>Password (min 8)</label><input id="aP" type="password" autocomplete="new-password"><div class="err" id="aErr"></div><button class="btn primary" onclick="createAdmin()">Create admin</button>`);
window.createAdmin=async()=>{ try{ await j("/api/admins",{method:"POST",body:JSON.stringify({username:$("#aU").value,email:$("#aE").value,password:$("#aP").value})}); closeModal(); goPage('admins'); }catch(e){ $("#aErr").textContent=e.message; } };
window.resetPw=(id,u)=>modal(`<h3>Reset password — ${u}</h3><label>New password (min 8)</label><input id="rP" type="password" autocomplete="new-password"><div class="err" id="rErr"></div><button class="btn primary" onclick="doReset('${id}')">Reset</button><p class="mut sm">Their existing sessions are signed out.</p>`);
window.doReset=async(id)=>{ try{ await j(`/api/admins/${id}/password`,{method:"POST",body:JSON.stringify({password:$("#rP").value})}); closeModal(); }catch(e){ $("#rErr").textContent=e.message; } };
window.toggleAdmin=async(id,dis)=>{ await j(`/api/admins/${id}`,{method:"PATCH",body:JSON.stringify({disabled:dis})}); goPage('admins'); };
window.delAdmin=async(id,u)=>{ if(!confirm(`Move admin ${u} to trash? They are signed out and their keys and sessions move to the superadmin until restored.`)) return; await j(`/api/admins/${id}`,{method:"DELETE"}); goPage('admins'); };

// ---------------- Trash ----------------
async function renderTrash(el){
  el.innerHTML=`<div class="page"><div class="ph"><h2>Trash</h2></div><div id="trBody" class="mut">Loading…</div></div>`;
  const {items}=await j("/api/trash");
  $("#trBody").innerHTML=!items.length?`<div class="emptybox">Trash is empty. Deleted keys${isSuper()?' and admins':''} land here and can be restored.</div>`:`
  <table class="tbl"><thead><tr><th>Item</th><th>Type</th><th>Deleted</th><th>Note</th><th></th></tr></thead><tbody>
  ${items.map(i=>`<tr><td><b>${esc(i.name)}</b><div class="mut sm">${esc(i.sub||'')}</div></td>
    <td><span class="pill ${i.type==='key'?'ok':'live'}">${i.type==='key'?'Partner key':'Admin'}</span></td>
    <td class="sm">${new Date(i.deletedAt).toLocaleString()}</td>
    <td class="sm mut">${i.type==='key'?(i.wasEnabled?'Restores enabled':'Restores disabled'):`${i.movedKeys} key(s), ${i.movedSessions} session(s) returned on restore`}</td>
    <td class="acts"><button class="btn sm" onclick="restoreItem('${i.type}','${i.id}',this)">Restore</button></td></tr>`).join("")}</tbody></table>
  <p class="mut sm">Restored keys work again immediately with the same secrets.</p>`;
}
window.restoreItem=async(type,id,btn)=>{ btn.disabled=true; try{ await j(`/api/trash/${type}/${id}/restore`,{method:"POST"}); goPage('trash'); }catch(e){ btn.disabled=false; alert(e.message); } };

// ---------------- Account ----------------
function renderAccount(el){
  const me=SSOS.me;
  el.innerHTML=`<div class="page narrow"><h2>Account</h2>
    <div class="card"><div class="kv"><span class="k">Username</span><span class="v">${esc(me.username)}</span></div>
    <div class="kv"><span class="k">Email</span><span class="v">${esc(me.email||'—')}</span></div>
    <div class="kv"><span class="k">Role</span><span class="v">${isSuper()?'Superadmin':'Admin'}</span></div></div>
    ${isSuper()?'':`<div class="card"><h3>Change password</h3><label>Current password</label><input id="cP" type="password" autocomplete="current-password"><label>New password (min 8)</label><input id="nP" type="password" autocomplete="new-password"><label>Confirm new password</label><input id="nP2" type="password" autocomplete="new-password"><div class="err" id="cErr"></div><button class="btn primary" onclick="changePw()">Update password</button></div>`}
  </div>`;
}
window.changePw=async()=>{ if($("#nP").value!==$("#nP2").value){ $("#cErr").textContent="Passwords don't match"; return; }
  try{ await j("/api/account/password",{method:"POST",body:JSON.stringify({current:$("#cP").value,next:$("#nP").value})}); $("#cErr").style.color="var(--ok,#3ecf8e)"; $("#cErr").textContent="Password updated."; ["#cP","#nP","#nP2"].forEach(s=>$(s).value=""); }catch(e){ $("#cErr").textContent=e.message; } };

// ---------------- Docs ----------------
async function renderDocs(el){
  const host=SSOS.me.host; const {keys}=await j("/api/keys"); window.__keys=keys;
  const k=keys[0]||{}; const KEY=k.keyPrefix?k.keyPrefix.replace("…","••••••••"):"ssos_live_<partner>_<32 hex>"; const TOK=k.readToken?mask(k.readToken):"ssos_pub_<24 hex>";
  const P=host+"/api/partner/v1";
  el.innerHTML=`<div class="page docs"><h2>Docs</h2>
  <p class="mut">Integration guide for your partners. Keys below are masked — use <b>Partners &amp; Keys → Manage → Reveal</b> to copy the real values.${keys.length>1?` Showing <b>${esc(k.orgName)}</b>.`:''}</p>
  <div class="card"><h3>1 · Send SOS (partner server → Smart SOS)</h3>
  <p class="sm">Authenticate every call with <code>X-API-Key</code>. Keep the API key on the partner's <b>server</b>, never in a browser or app bundle.</p>
<pre>curl ${P}/ping -H "X-API-Key: ${KEY}"

# start an alert
curl -X POST ${P}/sessions -H "X-API-Key: ${KEY}" -H "Content-Type: application/json" \\
  -d '{"external_ref":"user-123","lat":6.5244,"lng":3.3792,"acc":12,"user":{"name":"Ada","phone":"+234..."}}'
# → {"sessionId":"a1b2c3d4", ...}

curl -X POST ${P}/sessions/a1b2c3d4/location -H "X-API-Key: ${KEY}" -H "Content-Type: application/json" -d '{"lat":6.53,"lng":3.38}'
curl -X POST ${P}/sessions/a1b2c3d4/nearby   -H "X-API-Key: ${KEY}" -H "Content-Type: application/json" -d '{"devices":[{"name":"Phone","address":"AA:BB..","rssi":-60}]}'
curl -X POST "${P}/sessions/a1b2c3d4/audio" -H "X-API-Key: ${KEY}" -H "Content-Type: audio/webm" --data-binary @chunk.webm
curl -X POST "${P}/sessions/a1b2c3d4/video?cam=front" -H "X-API-Key: ${KEY}" -H "Content-Type: video/webm" --data-binary @clip.webm
curl -X POST ${P}/sessions/a1b2c3d4/end -H "X-API-Key: ${KEY}"
curl ${P}/sessions?active=1 -H "X-API-Key: ${KEY}"</pre>
  <p class="sm"><b>Media clips (archive):</b> upload self-contained <b>~60 s</b> segments. Audio-only: <code>audio/webm</code> or <code>audio/mp4</code>, max <b>25 MB</b>. Video clips include their own sound: <code>video/webm</code> or <code>video/mp4</code> (H.264+AAC on Android), max <b>40 MB</b>; label with <code>?cam=rear|front</code> (rear on phones, front on desktops). Clips are for history/download; live watching uses LiveKit (section 3).</p>
  <h4>Webhooks</h4><p class="sm">If a webhook URL is set, Smart SOS POSTs JSON events (<code>session.created</code>, <code>session.ended</code>, <code>ping</code>, …) signed with the key's webhook secret: header <code>X-SSOS-Signature: sha256=&lt;hex HMAC of raw body&gt;</code> (also sent as <code>X-NSS-Signature</code> for older integrations).</p>
<pre>// Node verification
const sig = "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(req.get("X-SSOS-Signature")))) return res.sendStatus(401);</pre></div>
  <div class="card"><h3>2 · Display SOS (partner website ← Smart SOS, realtime)</h3>
  <p class="sm">Use the <b>read token</b> (read-only, safe in a browser). Requests from a browser must come from an <b>allowed origin</b> configured on the key${k.allowedOrigins?` (currently: <code>${esc((k.allowedOrigins||[]).join(", ")||"none — browser requests blocked")}</code>)`:''}.</p>
<pre>GET ${P}/feed/sessions?token=${TOK}            # list (active + recent)
GET ${P}/feed/sessions/&lt;id&gt;?token=${TOK}       # detail: trail, nearby, events, media
GET ${P}/feed/stream?token=${TOK}              # Server-Sent Events, realtime</pre>
<pre>&lt;script&gt;
const es = new EventSource("${P}/feed/stream?token=${TOK}");
es.addEventListener("snapshot",       e =&gt; render(JSON.parse(e.data).sessions));
es.addEventListener("session.created",e =&gt; upsert(JSON.parse(e.data).session));
es.addEventListener("location",       e =&gt; upsert(JSON.parse(e.data).session));
es.addEventListener("session.ended",  e =&gt; upsert(JSON.parse(e.data).session));
&lt;/script&gt;</pre>
  <h4>Drop-in widget</h4>
<pre>&lt;div id="sos"&gt;&lt;/div&gt;
&lt;script src="${host}/embed/smart-sos.js"&gt;&lt;/script&gt;
&lt;script&gt;SmartSOS.mount(document.getElementById("sos"), { token: "${TOK}" });&lt;/script&gt;</pre>
  <p class="sm mut">Events: <code>snapshot</code>, <code>session.created</code>, <code>location</code>, <code>nearby</code>, <code>event</code>, <code>media</code>, <code>session.ended</code>. The stream resumes with <code>Last-Event-ID</code> and sends a heartbeat every 25s.</p></div>
  <div class="card"><h3>3 · Live A/V (LiveKit) — publisher, viewer, renewal, end</h3>
  <p class="sm">All calls use the partner <code>X-API-Key</code> from your <b>server</b>. The <code>ssos_pub_…</code> read token is for the website feed only — it <b>cannot</b> be used for live viewing or publishing.</p>
  <p class="sm">Tokens are short-lived (default <b>15 min</b>, <code>LIVEKIT_TOKEN_TTL_SECONDS</code>) and bound to the session's current room <code>sos-&lt;id&gt;-&lt;epoch&gt;</code>. Always use the <code>url</code>/<code>room</code> from the latest response; renew ~1–2 min before <code>expiresAt</code> (needed only to (re)connect).</p>
<pre># create with live publish credentials
curl -X POST ${P}/sessions -H "X-API-Key: ${KEY}" -H "Content-Type: application/json" \\
  -d '{"external_ref":"sc-alert-12345","device_id":"dev-1","want_livekit":true}'
# → 201 {"sessionId":"a1b2c3d4", ..., "livekit":{"url":"wss://…","room":"sos-a1b2c3d4-…","token":"&lt;JWT&gt;","expiresAt":1793704196000,"ttlSeconds":900,"identity":"…"}}

# publisher token / renewal (publish-only)
curl -X POST ${P}/sessions/a1b2c3d4/livekit/publisher -H "X-API-Key: ${KEY}" -H "Content-Type: application/json" -d '{"device_id":"dev-1"}'

# viewer token / renewal (subscribe-only) — operator_id required
curl -X POST ${P}/sessions/a1b2c3d4/livekit/viewer -H "X-API-Key: ${KEY}" -H "Content-Type: application/json" -d '{"operator_id":"sc-ops-42"}'
# → {"url","room","token","expiresAt","ttlSeconds","identity"}</pre>
  <ul class="sm">
  <li>Renew by calling the same endpoint again; the same <code>device_id</code> / <code>operator_id</code> keeps the same identity (a second connection with the same identity replaces the first — add a tab nonce if needed).</li>
  <li><code>409 session_ended</code> if the session is no longer active; <code>404 session_not_found</code> for another partner's session.</li>
  <li>Create with an <code>external_ref</code> whose session has ended → <code>409 session_ended</code> (no new SOS). While active it returns the existing session (<code>duplicate:true</code>, fresh publisher token). Use <code>force_new:true</code> only to deliberately open a new SOS.</li>
  <li>Ending a session (partner <code>/end</code>, admin, or device) removes all participants, deletes the room, retires the room epoch and refuses new tokens. Old JWTs cannot rejoin when LiveKit has <code>room.auto_create: false</code> and its webhook points to <code>${host}/api/livekit/webhook</code>.</li>
  </ul></div>
  </div>`;
}

window.ssosRenderPage = async(el)=>{
  try{
    if(SSOS.page==="keys") await renderKeys(el);
    else if(SSOS.page==="admins" && isSuper()) await renderAdmins(el);
    else if(SSOS.page==="account") renderAccount(el);
    else if(SSOS.page==="docs") await renderDocs(el);
    else if(SSOS.page==="trash") await renderTrash(el);
  }catch(e){ el.innerHTML=`<div class="page"><div class="err">${esc(e.message)}</div></div>`; }
};

const css=document.createElement("style"); css.textContent=`
.nav{display:flex;flex-direction:column;gap:2px;padding:10px 10px 6px;border-bottom:1px solid rgba(255,255,255,.06)}
.nv{padding:9px 12px;border-radius:9px;cursor:pointer;color:#a9b1c3;font-size:13.5px;font-weight:500;display:flex;align-items:center;gap:6px}
.nv:hover{background:rgba(255,255,255,.04);color:#e8ecf4}.nv.on{background:rgba(255,77,79,.12);color:#fff;box-shadow:inset 2px 0 0 #ff4d4f}
.nv .n{margin-left:auto;font-size:11.5px;color:#8a93a6}
.nv .ni{display:grid;place-items:center;width:20px;flex:0 0 20px;opacity:.9}.nv.on .ni{color:#ff6b78}
.sbhead{display:flex;align-items:center;gap:9px;padding:10px 10px 8px 12px;border-bottom:1px solid rgba(255,255,255,.06)}
.sbicon{width:28px;height:28px;border-radius:8px;background:#fff;padding:3px;flex:0 0 28px;box-sizing:border-box}
.sbname{font-weight:700;font-size:13.5px;color:#e8ecf4;white-space:nowrap}
.sbtog{margin-left:auto;width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:#a9b1c3;display:grid;place-items:center;cursor:pointer;transition:transform .2s,background .15s}
.sbtog:hover{background:rgba(255,77,94,.14);color:#fff}
.shell.has-sess{grid-template-columns:230px 300px 1fr}
.navbar{position:relative;overflow:visible!important;z-index:5}
.sbedge{position:absolute;top:58px;right:-12px;width:24px;height:24px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:#141b2a;color:#c3cada;display:grid;place-items:center;cursor:pointer;padding:0;z-index:20;box-shadow:0 2px 8px rgba(0,0,0,.45);transition:transform .2s,background .15s}
.sbedge svg{width:14px;height:14px}.sbedge:hover{background:#e82d3f;color:#fff;border-color:#e82d3f}
.shell.collapsed .sbedge{transform:rotate(180deg)}
.footuser{font-weight:700;color:#e8ecf4;font-size:12.5px;margin-right:10px}.footer .btn{font-weight:700}
.sessbar{background:#0a101b}.sesshead{padding:14px 12px 8px;font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:#8a93a6;font-weight:600}
.hint{margin-top:4px;font-size:11.5px;color:#8a93a6;line-height:1.35;max-width:320px}
.shell{transition:grid-template-columns .2s ease}
.shell.collapsed{grid-template-columns:68px 1fr!important}
.shell.collapsed.has-sess{grid-template-columns:68px 300px 1fr!important}
.shell.collapsed .navbar{background:linear-gradient(180deg,rgba(232,45,63,.16),rgba(232,45,63,.04) 45%,#0c121e)}
.shell.collapsed .sbhead{justify-content:center;gap:4px;padding:10px 0 8px}.shell.collapsed .sbname{display:none}.shell.collapsed .sbtog{margin:0;width:22px;height:28px;transform:rotate(180deg)}
.shell.collapsed .nav{align-items:center;padding:8px 0;border-bottom:0;gap:6px}
.shell.collapsed .nv{width:44px;height:44px;padding:0;justify-content:center;border-radius:12px}
.shell.collapsed .nv .nl,.shell.collapsed .nv .n{display:none}
.shell.collapsed .nv.on{background:rgba(232,45,63,.22);box-shadow:0 0 0 1px rgba(232,45,63,.35),0 6px 16px -8px #e82d3f}
.page{padding:24px 28px;max-width:1150px}.page.narrow{max-width:560px}.page h2{margin:0 0 14px;font-size:20px}.ph{display:flex;align-items:center;gap:10px;margin-bottom:12px}.ph h2{margin:0}.sp{flex:1}
.tbl{width:100%;border-collapse:collapse;font-size:13px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden}
.tbl th{text-align:left;font-weight:600;color:#8a93a6;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.06)}
.tbl td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:top}.tbl tr:last-child td{border-bottom:0}.acts{white-space:nowrap;text-align:right}.acts .btn{margin-left:4px}
.sm{font-size:12px}.mut{color:#8a93a6}code{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:rgba(255,255,255,.05);padding:1px 6px;border-radius:5px;word-break:break-all}
.emptybox{padding:28px;text-align:center;border:1px dashed rgba(255,255,255,.1);border-radius:12px;color:#8a93a6}
.btn.sm{padding:5px 10px;font-size:12px}.btn.danger{color:#ff6b6b;border-color:rgba(255,107,107,.35)}.btn.warn{color:#f5b84a;border-color:rgba(245,184,74,.3)}
.modal-bg{position:fixed;inset:0;background:rgba(5,7,12,.7);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px}
.modal{position:relative;background:#121620;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:22px;width:min(620px,100%);max-height:90vh;overflow:auto;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.modal h3{margin:0 0 12px}.modal label,.page label{display:block;font-size:12px;color:#8a93a6;margin:12px 0 5px}
.modal input:not([type=checkbox]),.page input:not([type=checkbox]){width:100%;box-sizing:border-box;background:#0b0e15;border:1px solid rgba(255,255,255,.1);color:#e8ecf4;border-radius:9px;padding:9px 11px;font-size:13.5px}
.modal .btn.primary,.page .card .btn.primary{margin-top:14px}.mx{position:absolute;top:10px;right:12px;background:none;border:0;color:#8a93a6;font-size:22px;cursor:pointer}
.row{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;align-items:center}.row .btn{margin:0}.chk{display:flex!important;align-items:center;gap:8px}
.sec{margin:10px 0}.sec .k{font-size:12px;color:#8a93a6;margin-bottom:4px}.secv{display:flex;gap:8px;align-items:center}.secv code{flex:1;padding:8px 10px}
.err{color:#ff6b6b;font-size:12.5px;margin-top:8px;min-height:1em}.scroll{max-height:320px;overflow:auto;margin-top:10px}
.docs pre{background:#0b0e15;border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:12px 14px;overflow:auto;font-size:12px;line-height:1.55;color:#cfd6e4}
.docs h4{margin:16px 0 6px}.tabs{display:none}
.ph .btn,.row .btn,.acts .btn,.modal .btn,.page .card .btn{width:auto!important;flex:0 0 auto}
.ph .btn{margin-top:0!important}
.pill.ok{background:rgba(53,192,138,.14);color:#35c08a}.pill.bad{background:rgba(255,77,94,.14);color:#ff6b6b}
.org-chip{font-size:10.5px;padding:2px 7px;border-radius:999px;background:rgba(99,140,255,.14);color:#9db4ff;font-weight:600}
`; document.head.appendChild(css);
})();
