/* Smart SOS display widget. Usage:
   <script src="https://YOUR-HOST/embed/smart-sos.js"></script>
   SmartSOS.mount(el, { token: "ssos_pub_...", host: "https://YOUR-HOST", onEvent(type, data){} }) */
(function(){
  var scriptHost = (function(){ try{ return new URL(document.currentScript.src).origin; }catch(e){ return ""; } })();
  function esc(v){ return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function mount(el, opts){
    opts = opts || {}; var host = (opts.host || scriptHost).replace(/\/$/,"");
    if(!opts.token) throw new Error("SmartSOS.mount: token required");
    var sessions = {}, es;
    el.classList.add("smart-sos");
    if(!document.getElementById("smart-sos-css")){
      var st=document.createElement("style"); st.id="smart-sos-css";
      st.textContent=".smart-sos{font:14px system-ui,sans-serif;background:#0b0e14;color:#eef2f9;border-radius:14px;padding:14px;border:1px solid #1e293f}.smart-sos h4{margin:0 0 10px;font-size:14px;display:flex;gap:8px;align-items:center}.smart-sos .dot{width:8px;height:8px;border-radius:50%;background:#5f6f8c}.smart-sos .dot.on{background:#35c08a}.smart-sos .it{padding:10px;border-radius:10px;background:#121a2a;margin-top:8px}.smart-sos .live{color:#ff4d5e;font-weight:700}.smart-sos .m{color:#8898b5;font-size:12px}.smart-sos a{color:#9db4ff}";
      document.head.appendChild(st);
    }
    function render(){
      var list = Object.keys(sessions).map(function(k){return sessions[k];}).sort(function(a,b){ return (b.active-a.active)||(b.createdAt-a.createdAt); });
      el.innerHTML = '<h4><span class="dot'+(es&&es.readyState===1?' on':'')+'"></span>Smart SOS alerts</h4>' + (list.length ? list.slice(0, opts.limit||20).map(function(s){
        var l=s.lastLocation; return '<div class="it"><div>'+(s.active?'<span class="live">● LIVE</span> ':'')+'<b>'+esc((s.user&&s.user.name)||s.externalRef||s.sessionId)+'</b></div>'+
          '<div class="m">'+new Date(s.createdAt).toLocaleString()+' · '+esc(s.status||"")+'</div>'+
          (l?'<div class="m"><a target="_blank" rel="noopener" href="https://maps.google.com/?q='+l.lat+','+l.lng+'">'+(+l.lat).toFixed(5)+', '+(+l.lng).toFixed(5)+'</a></div>':'')+'</div>';
      }).join("") : '<div class="m">No alerts.</div>');
    }
    es = new EventSource(host + "/api/partner/v1/feed/stream?token=" + encodeURIComponent(opts.token));
    es.addEventListener("open", render); es.addEventListener("error", render);
    es.addEventListener("snapshot", function(e){ var d=JSON.parse(e.data); sessions={}; (d.sessions||[]).forEach(function(s){ sessions[s.sessionId]=s; }); render(); });
    ["session.created","location","nearby","event","media","session.ended"].forEach(function(t){
      es.addEventListener(t, function(e){ var d=JSON.parse(e.data); if(d.session) sessions[d.session.sessionId]=d.session; render(); if(opts.onEvent) try{ opts.onEvent(t,d); }catch(x){} });
    });
    render();
    return { close: function(){ es.close(); }, sessions: function(){ return sessions; } };
  }
  window.SmartSOS = { mount: mount };
})();
