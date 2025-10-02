/* RSH × Stake — Wager Leaderboard
   No backend. Reads Google Sheets CSV/JSON. Renders live leaderboard with prize logic.
*/
const CONFIG_DEFAULT = {
  sheetUrl: "https://docs.google.com/spreadsheets/d/137chphmYQrEtCxVXvFPMKukOXratCG_AgUrOgZBn8B8/edit?gid=235680015", // paste your Google Sheet link in the Settings (⚙️)
  allowedCampaigns: ["supper","supper10","suppercap"],
  prizePool: 1000,
  splits: [0.50,0.25,0.125,0.075,0.05],
  dateStart: Date.UTC(2025, 9, 1, 0, 0, 0),
  dateEnd:   Date.UTC(2025, 10, 1, 0, 0, 0),
  refreshSecs: 60,
  maxRows: 100
};

const state = {
  config: loadConfig(),
  allRows: [], // processed rows
  filtered: [],
  timer: null
};

function loadConfig(){
  const saved = localStorage.getItem("rsh-stake-config");
  if(saved){
    try{ const cfg = JSON.parse(saved); return {...CONFIG_DEFAULT, ...cfg}; }catch{}
  }
  return {...CONFIG_DEFAULT};
}
function saveConfig(){
  localStorage.setItem("rsh-stake-config", JSON.stringify(state.config));
}

function money(n){
  if(isNaN(n)) return "—";
  return n.toLocaleString(undefined, {style:"currency", currency:"USD", maximumFractionDigits:2});
}
function parseNumber(v){
  if(v == null) return 0;
  if(typeof v === "number") return v;
  // strip $ and commas
  const s = String(v).replace(/[$,]/g,"").trim();
  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
}


function maskName(name){
  if(!name) return "";
  const s = String(name).trim();
  if (s.length <= 2) return s[0] + "*";
  const start = s.slice(0, 2);
  const end   = s.slice(-2);
  return start + "****" + end;
}

function normalizeHeader(h){
  return String(h||"").trim().toLowerCase().replace(/[\s_]+/g,"_");
}

function csvToObjects(csv){
  // robust CSV parse for quotes/commas/newlines
  const rows = [];
  let i=0, field="", row=[], inQuotes=false;
  for(; i<csv.length; i++){
    const c = csv[i], n = csv[i+1];
    if(inQuotes){
      if(c === '"' && n === '"'){ field += '"'; i++; }
      else if(c === '"'){ inQuotes = false; }
      else field += c;
    }else{
      if(c === '"'){ inQuotes = true; }
      else if(c === ','){ row.push(field); field=""; }
      else if(c === '\n'){ row.push(field); rows.push(row); row=[]; field=""; }
      else if(c === '\r'){ /* ignore */ }
      else field += c;
    }
  }
  // last cell
  if(field.length || row.length) { row.push(field); rows.push(row); }
  if(!rows.length) return [];

  const headers = rows[0].map(normalizeHeader);
  const out = [];
  for(let r=1;r<rows.length;r++){
    const obj = {};
    for(let c=0;c<headers.length;c++){
      obj[headers[c]] = rows[r][c];
    }
    out.push(obj);
  }
  return out;
}

function extractSheetId(url){
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}
function extractGid(url){
  const m = String(url).match(/[?#]gid=(\d+)/);
  return m ? m[1] : null;
}
function toCsvUrl(url){
  const id = extractSheetId(url);
  if(!id) return null;
  const gid = extractGid(url);
  if(gid) return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  // default: first sheet
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`;
}
function toJsonUrl(url){// (helpers below)

  const id = extractSheetId(url);
  if(!id) return null;
  // gviz json of first sheet
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json`;
}

async function fetchSheet(url){
  const csvUrl = toCsvUrl(url);
  if(!csvUrl) throw new Error("Invalid Google Sheet link.");
  // try CSV first
  try{
    const r = await fetch(csvUrl, {cache:"no-store"});
    if(!r.ok) throw new Error("CSV fetch failed");
    const text = await r.text();
    // If this is actually the JSON prelude accidental, fall back
    if(text.trim().startsWith(")]}'")) throw new Error("Looks like JSON");
    const rows = csvToObjects(text);
    if(rows.length) return rows;
    // if CSV empty, fall back
  }catch(err){
    // fall through to JSON
  }
  // gviz JSON as fallback
  const jsonUrl = toJsonUrl(url);
  const r2 = await fetch(jsonUrl, {cache:"no-store"});
  const t2 = await r2.text();
  const jsonText = t2.replace(/^.*?\n/,"").replace(/;\s*$/,""); // strip prelude and trailing ;
  const payload = JSON.parse(jsonText);
  const cols = payload.table.cols.map(c => normalizeHeader(c.label || c.id));
  const out = [];
  for(const row of payload.table.rows){
    const obj = {};
    row.c.forEach((cell, idx) => {
      obj[cols[idx] || `col_${idx}`] = cell ? (cell.f || cell.v) : "";
    });
    out.push(obj);
  }
  return out;
}


function withinWindow(now = new Date()){
  const start = new Date(state.config.dateStart);
  const end   = new Date(state.config.dateEnd);
  return {start, end, now, ended: now.getTime() >= end.getTime()};
}

function computePrize(place){
  const {prizePool, splits} = state.config;
  if(place < 1 || place > splits.length) return 0;
  return +(prizePool * splits[place-1]).toFixed(2);
}

function processRows(raw){
  if(!raw || !raw.length) return [];
  // header flexibility
  const guess = (obj, keys) => {
    for(const k of keys) if(obj[k] != null) return obj[k];
    return undefined;
  };

  // aggregate by user_name, filtered by allowed campaigns
  const allowed = new Set(state.config.allowedCampaigns.map(s=>s.toLowerCase()));
  const map = new Map();
  for(const r of raw){
    const campaign = String(guess(r, ["campaign_code","campaign","code"])||"").toLowerCase().trim();
    if(campaign && !allowed.has(campaign)) continue;
    const user = String(guess(r, ["user_name","username","user","player"])||"").trim();
    if(!user) continue;
    const wager = parseNumber(guess(r, ["wagered","wager","amount","total_wagered","wagers"]));
    const affiliate = String(guess(r, ["affiliate_name","affiliate"])||"").trim();
    const key = user.toLowerCase();
    if(!map.has(key)){
      map.set(key, {user, campaign, affiliate_name: affiliate, wagered: 0});
    }
    map.get(key).wagered += wager;
    // prefer most recent campaign value
    if(campaign) map.get(key).campaign = campaign;
  }

  const arr = Array.from(map.values());
  arr.sort((a,b)=> b.wagered - a.wagered);
  arr.forEach((row, idx)=> row.place = idx + 1);
  arr.forEach((row)=> row.prize = computePrize(row.place));
  return arr;
}

function render(){
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = "";
  const rows = state.filtered.slice(0, state.config.maxRows);
  for(const r of rows){
    const tr = document.createElement("tr");
    tr.className = `row-${r.place}`; // adds highlight for top3; harmless for others
    tr.innerHTML = `
      <td class="place-cell">#${r.place}</td>
      <td>${escapeHtml(maskName(r.user))}</td>
      <td>${money(r.wagered)}</td>
      <td>${r.prize ? money(r.prize) : "—"}</td>
      <td>${escapeHtml((r.campaign||'').toUpperCase())}</td>
    `;
    tbody.appendChild(tr);
  }

  // Update podium
  const top3 = rows.slice(0,3);
  for(let i=1;i<=3;i++){
    const r = top3[i-1];
    setSlot(`${i}-user`, r ? maskName(r.user) : "—");
    setSlot(`${i}-wager`, r ? money(r.wagered) : "—");
    setSlot(`${i}-prize`, r ? (r.prize ? money(r.prize) : "—") : "—");
  }

  document.getElementById("status").classList.add("hide");
  document.getElementById("last-updated").textContent = "Last updated " + new Date().toLocaleString();
}

function escapeHtml(s){
  const el = document.createElement("div"); el.textContent = String(s); return el.innerHTML;
}
function setSlot(slot, val){
  const el = document.querySelector(`[data-slot="${slot}"]`);
  if(el) el.textContent = val;
}

function applySearch(){
  const q = document.getElementById("search").value.trim().toLowerCase();
  if(!q){ state.filtered = [...state.allRows]; return; }
  state.filtered = state.allRows.filter(r =>
    r.user.toLowerCase().includes(q) ||
    (r.campaign||"").toLowerCase().includes(q) ||
    (r.affiliate_name||"").toLowerCase().includes(q)
  );
}

async function loadAndRender(){
  const status = document.getElementById("status");
  status.classList.remove("hide");
  status.querySelector("span").textContent = "Fetching data…";
  try{
    const rowsRaw = await fetchSheet(state.config.sheetUrl);
    state.allRows = processRows(rowsRaw);
    applySearch();
    render();
  }catch(err){
    status.classList.remove("hide");
    status.querySelector("span").textContent = "Error fetching sheet. Click Settings (⚙️) to paste a valid link.";
    console.error(err);
  }
}


function setDateWindow(){
  const {start, end} = withinWindow();
  const fmt = (d) => d.toLocaleDateString(undefined, {month:"short", day:"numeric", year:"numeric", timeZone:"UTC"});
  document.getElementById("date-window").textContent = `${fmt(start)} → ${fmt(end)}`;
}

function startCountdown(){
  const {end} = withinWindow();
  function tick(){
    const now = new Date();
    let diff = Math.max(0, end - now);
    const days = Math.floor(diff/(86400e3)); diff -= days*86400e3;
    const hrs  = Math.floor(diff/(3600e3));  diff -= hrs*3600e3;
    const mins = Math.floor(diff/(60e3));    diff -= mins*60e3;
    const secs = Math.floor(diff/1e3);
    document.getElementById("countdown").textContent = `Ends in ${days}d ${hrs}h ${mins}m ${secs}s`;
  }
  tick();
  setInterval(tick, 1000);
}


function renderPrizeLegend(){
  const ul = document.getElementById("prize-split");
  ul.innerHTML = "";
  const labels = ["1st","2nd","3rd","4th","5th"];
  state.config.splits.forEach((p, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${labels[i]}:</strong> ${money(state.config.prizePool * p)}`;
    ul.appendChild(li);
  });
}

// Settings modal & persistence
function hydrateSettings(){
  const m = document.getElementById("settings");
  const input = document.getElementById("sheetUrl");
  const refresh = document.getElementById("refreshSecs");
  const maxRows = document.getElementById("maxRows");
  input.value = state.config.sheetUrl || "";
  refresh.value = state.config.refreshSecs;
  maxRows.value = state.config.maxRows;
}
function setupSettings(){
  const btn = document.getElementById("settingsBtn");
  const dlg = document.getElementById("settings");
  btn.addEventListener("click", ()=>{ hydrateSettings(); dlg.showModal(); });
  document.getElementById("saveSettings").addEventListener("click", (e)=>{
    e.preventDefault();
    state.config.sheetUrl = document.getElementById("sheetUrl").value.trim();
    state.config.refreshSecs = Math.max(15, parseInt(document.getElementById("refreshSecs").value || 60));
    state.config.maxRows = Math.max(10, parseInt(document.getElementById("maxRows").value || 100));
    saveConfig();
    dlg.close();
    
    
    loadAndRender();
  });
}

function restartAutoRefresh(){
  if(state.timer) clearInterval(state.timer);
  state.timer = setInterval(loadAndRender, state.config.refreshSecs * 1000);
}

// Search & refresh
document.getElementById("search").addEventListener("input", ()=>{ applySearch(); render(); });
document.getElementById("refreshBtn").addEventListener("click", ()=> loadAndRender());
try {
  const lastBtn = document.getElementById("lastMonthBtn");
  if (lastBtn) {
    lastBtn.addEventListener("click", () => {
      // Switch to last month (Sept 1 → Oct 1, 2025)
      state.config.dateStart = Date.UTC(2025, 8, 1, 0, 0, 0);
      state.config.dateEnd   = Date.UTC(2025, 9, 1, 0, 0, 0);
      // If ?last_gid=123 is provided, switch to that tab for last month's data
      if (state.config._lastGid) {
        setSheetGid(state.config._lastGid);
      }
      setDateWindow();
      loadAndRender();
    });
  }
} catch(e) {}


// Initial boot
(function boot(){
  // Set header info
  // Force desired default month (Oct 1 → Nov 1, 2025)
  state.config.dateStart = Date.UTC(2025, 9, 1, 0, 0, 0);
  state.config.dateEnd   = Date.UTC(2025, 10, 1, 0, 0, 0);
  setDateWindow();
  startCountdown();
  renderPrizeLegend();
  
  // Source link + optional gid override via URL param
  const urlParams = new URLSearchParams(location.search);
  const overrideGid = urlParams.get("gid");
  const lastGid = urlParams.get("last_gid");
  state.config._thisGid = overrideGid || extractGid(state.config.sheetUrl) || null;
  state.config._lastGid = lastGid || null;
  if(overrideGid && state.config.sheetUrl){
    const id = extractSheetId(state.config.sheetUrl);
    if(id) state.config.sheetUrl = `https://docs.google.com/spreadsheets/d/${id}/edit?gid=${overrideGid}`;
  }
  
  
  loadAndRender();
})();


// Floating logos (RSH + Stake) — randomized positions & gentle drift
(function floatingLogos(){
  const layer = document.getElementById('floaters');
  if(!layer) return;
  const logos = ['assets/rsh.jpg','assets/stake.png'];
  const count = 22;
  for(let i=0;i<count;i++){
    const el = document.createElement('div');
    el.className = 'floater';
    el.style.backgroundImage = `url(${logos[i%2]})`;
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    const x = Math.random() * vw;
    const y = Math.random() * vh;
    const dx = (Math.random() * 120 - 60) + 'px';  // left/right wander
    const dy = (-120 - Math.random() * 200) + 'px'; // gently float upward
    const dur = (20 + Math.random()*14).toFixed(1) + 's';
    const fade = (5 + Math.random()*5).toFixed(1) + 's';
    const delay = (-Math.random()*10).toFixed(1) + 's'; // negative to desync
    const size = (Math.random() * 24 + 28); // 28px - 52px
    el.style.left = (x - size/2) + 'px';
    el.style.top  = (y - size/2) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.setProperty('--dx', dx);
    el.style.setProperty('--dy', dy);
    el.style.setProperty('--dur', dur);
    el.style.setProperty('--fade', fade);
    el.style.animationDelay = delay + ', ' + delay;
    layer.appendChild(el);
  }
  // Re-seed occasionally on resize to keep things fresh
  let resizeTO;
  window.addEventListener('resize', ()=>{
    clearTimeout(resizeTO);
    resizeTO = setTimeout(()=>{
      layer.innerHTML='';
      floatingLogos();
    }, 400);
  });
})();

function setSheetGid(newGid){
  const id = extractSheetId(state.config.sheetUrl);
  if(!id) return;
  state.config.sheetUrl = `https://docs.google.com/spreadsheets/d/${id}/edit?gid=${newGid}`;
}
