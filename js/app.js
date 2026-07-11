/* ============================================================
   app.js — UI, state, rendering, master-scoring editor
   ============================================================ */
const LS_KEY = 'cargoscore_master_v1';
let DATA = null, MASTER = null, PRICE = null;
let state = { month: null, rolling: 3, pulau: '', search: '', tab: 'ranking' };
let computed = null;

/* ---------- boot ---------- */
async function boot() {
  const [trips, masterDefault] = await Promise.all([
    fetch('data/trips.json').then(r => r.json()),
    fetch('data/master-scoring.json').then(r => r.json())
  ]);
  DATA = trips;
  // price map opsional (kalau ada data/price.json)
  try { PRICE = await fetch('data/price.json').then(r => r.ok ? r.json() : null); } catch { PRICE = null; }

  // master: localStorage override kalau ada
  const saved = localStorage.getItem(LS_KEY);
  MASTER = saved ? JSON.parse(saved) : masterDefault;

  // populate month
  const months = DATA.months;
  state.month = months[months.length - 1];
  state.rolling = MASTER.rollingMonths || 3;
  const mSel = document.getElementById('monthSel');
  const mName = { 1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'Mei',6:'Jun',7:'Jul',8:'Agu',9:'Sep',10:'Okt',11:'Nov',12:'Des' };
  mSel.innerHTML = months.map(m => `<option value="${m}">${mName[m]||('Bln '+m)}</option>`).join('');
  mSel.value = state.month;
  document.getElementById('rollingSel').value = state.rolling;

  // pulau options
  const pulaus = Array.from(new Set(DATA.trips.map(t => t.p).filter(Boolean))).sort();
  document.getElementById('pulauSel').innerHTML =
    '<option value="">Semua</option>' + pulaus.map(p => `<option>${p}</option>`).join('');

  bindEvents();
  recompute();
}

function bindEvents() {
  document.getElementById('monthSel').onchange = e => { state.month = +e.target.value; recompute(); };
  document.getElementById('rollingSel').onchange = e => { state.rolling = +e.target.value; MASTER.rollingMonths = state.rolling; recompute(); };
  document.getElementById('pulauSel').onchange = e => { state.pulau = e.target.value; render(); };
  document.getElementById('searchBox').oninput = e => { state.search = e.target.value.toLowerCase(); render(); };
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active'); state.tab = t.dataset.tab; render();
  });
}

function recompute() {
  computed = Scoring.buildAll(DATA, MASTER, state.month, PRICE);
  const [lo, hi] = computed.windowMonths;
  const mName = { 1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'Mei',6:'Jun',7:'Jul',8:'Agu',9:'Sep',10:'Okt',11:'Nov',12:'Des' };
  document.getElementById('windowPill').innerHTML =
    `window: <b>${mName[lo]||lo}\u2013${mName[hi]||hi}</b> \u00b7 ${computed.tripCount.toLocaleString()} trip`;
  render();
}

/* ---------- helpers ---------- */
function sc(n) { return `<span class="score s${n}">${n}</span>`; }
function pct(x) { return (x * 100).toFixed(0) + '%'; }
function tag(isAvl) { return isAvl ? '<span class="tag avl">AVL</span>' : '<span class="tag nonavl">NON-AVL</span>'; }
function matchSearch(...vals) { return !state.search || vals.some(v => (v || '').toLowerCase().includes(state.search)); }
function filterPulau(r) { return !state.pulau || r.pulau === state.pulau; }

/* ---------- KPIs ---------- */
function renderKpis() {
  const routes = computed.routes.filter(filterPulau);
  const nRoute = routes.length;
  const nVendor = new Set(routes.flatMap(r => r.rows.filter(x => x.trip > 0).map(x => x.vendor))).size;
  const avgFinal = computed.vendors.length ? (computed.vendors.reduce((s, v) => s + v.avgFinal, 0) / computed.vendors.length) : 0;
  // rute monopoli (share #1 >= 0.8)
  let mono = 0;
  for (const r of routes) {
    const used = r.rows.filter(x => x.trip > 0).sort((a,b)=>b.share-a.share);
    if (used.length && used[0].share >= 0.8) mono++;
  }
  const cards = [
    { k: 'Rute Aktif', v: nRoute, c: '' },
    { k: 'Vendor Aktif', v: nVendor, c: 'teal' },
    { k: 'Avg Skor Akhir', v: avgFinal.toFixed(2), c: 'amber' },
    { k: 'Rute Monopoli', v: mono, c: mono > 0 ? 'red' : '' },
  ];
  document.getElementById('kpis').innerHTML = cards.map(c =>
    `<div class="kpi"><div class="k">${c.k}</div><div class="v ${c.c}">${c.v}</div></div>`).join('');
}

/* ---------- Tab: Ranking Rute ---------- */
function renderRanking() {
  const routes = computed.routes.filter(filterPulau)
    .filter(r => matchSearch(r.tujuan, r.origin, ...r.rows.map(x => x.vendor)))
    .sort((a, b) => b.total - a.total);
  if (!routes.length) return `<div class="empty">Tidak ada rute pada filter ini.</div>`;
  let html = `<div class="tablewrap"><table><thead><tr>
    <th>Origin</th><th>Tujuan</th><th>Type</th><th>Trip</th>
    <th>Vendor</th><th>Status</th><th>Share</th>
    <th>Avail</th><th>Fulfill</th><th>OTA</th><th>Price</th><th>Skor Akhir</th>
    </tr></thead><tbody>`;
  for (const r of routes) {
    r.rows.forEach((v, i) => {
      html += `<tr>
        ${i === 0 ? `<td class="mono" rowspan="${r.rows.length}">${r.origin}</td>
                     <td rowspan="${r.rows.length}"><b>${r.tujuan}</b></td>
                     <td class="mono" rowspan="${r.rows.length}">${r.type}</td>
                     <td class="mono" rowspan="${r.rows.length}">${r.total}</td>` : ''}
        <td class="mono">${v.vendor}</td>
        <td>${tag(v.isAvl)}</td>
        <td class="mono">${v.trip>0?pct(v.share):'—'}</td>
        <td>${sc(v.scoreAvail)}</td><td>${sc(v.scoreFul)}</td><td>${sc(v.scoreOta)}</td><td>${sc(v.scorePrice)}</td>
        <td class="final">${v.trip>0?v.finalScore.toFixed(2):'—'}</td>
      </tr>`;
    });
  }
  return html + '</tbody></table></div>';
}

/* ---------- Tab: Vendor (ekspandable ke detail rute) ---------- */
let expandedVendor = null;
function toggleVendor(name) {
  expandedVendor = (expandedVendor === name) ? null : name;
  render();
}
function renderVendor() {
  const vendors = computed.vendors.filter(v => matchSearch(v.vendor));
  if (!vendors.length) return `<div class="empty">Tidak ada vendor.</div>`;
  let html = `<div class="tablewrap"><table class="vendortable"><thead><tr>
    <th></th><th>#</th><th>Vendor</th><th>Total Trip</th><th>Rute Dilayani</th><th>Avg Skor Akhir</th>
    </tr></thead><tbody>`;
  vendors.forEach((v, i) => {
    const open = expandedVendor === v.vendor;
    html += `<tr class="vrow ${open?'open':''}" onclick="toggleVendor('${v.vendor.replace(/'/g,"\\'")}')">
      <td class="caret">${open?'\u25be':'\u25b8'}</td>
      <td class="mono">${i+1}</td><td class="mono"><b>${v.vendor}</b></td>
      <td class="mono">${v.trip.toLocaleString()}</td><td class="mono">${v.routes}</td>
      <td class="final">${v.avgFinal.toFixed(2)}</td></tr>`;
    if (open) {
      html += `<tr class="detailrow"><td colspan="6"><div class="detailwrap">
        <div class="detailhdr">Detail rute <b>${v.vendor}</b> — skor mentah (sebelum pembobotan)</div>
        <table class="detailtable"><thead><tr>
          <th>Origin</th><th>Tujuan</th><th>Type</th><th>Pulau</th><th>Status</th><th>Trip</th><th>Share</th>
          <th>Avail</th><th>Fulfill</th><th>OTA</th><th>Price</th>
        </tr></thead><tbody>`;
      for (const d of v.detail) {
        html += `<tr>
          <td class="mono">${d.origin}</td><td><b>${d.tujuan}</b></td><td class="mono">${d.type}</td>
          <td class="mono">${d.pulau||'-'}</td><td>${tag(d.isAvl)}</td>
          <td class="mono">${d.trip}</td><td class="mono">${pct(d.share)}</td>
          <td>${sc(d.scoreAvail)}</td><td>${sc(d.scoreFul)}</td><td>${sc(d.scoreOta)}</td><td>${sc(d.scorePrice)}</td>
        </tr>`;
      }
      html += `</tbody></table></div></td></tr>`;
    }
  });
  return html + '</tbody></table></div>';
}

/* ---------- Tab: Dominansi ---------- */
function renderDominansi() {
  // agregasi per pulau x tujuan
  const agg = {};
  for (const r of computed.routes.filter(filterPulau)) {
    const key = `${r.pulau||'-'}|${r.tujuan}`;
    if (!agg[key]) agg[key] = { pulau: r.pulau, tujuan: r.tujuan, total: 0, vendors: {} };
    agg[key].total += r.total;
    for (const v of r.rows) { if (v.trip>0) agg[key].vendors[v.vendor] = (agg[key].vendors[v.vendor]||0) + v.trip; }
  }
  const rows = Object.values(agg).map(a => {
    const arr = Object.entries(a.vendors).map(([v,c]) => [v, c, c/a.total]).sort((x,y)=>y[1]-x[1]);
    const s1 = arr.length ? arr[0][2] : 0;
    const klas = s1>=0.8?'Monopoli':(s1>=0.5?'Dominan':'Terbagi');
    const hhi = arr.reduce((s,[,c])=>s+Math.pow(c/a.total,2),0);
    return { ...a, top: arr.slice(0,3), klas, hhi };
  }).filter(a => matchSearch(a.tujuan)).sort((x,y)=>y.total-x.total);
  if (!rows.length) return `<div class="empty">Tidak ada data.</div>`;
  let html = `<div class="tablewrap"><table><thead><tr>
    <th>Pulau</th><th>Tujuan</th><th>Trip</th><th>Klasifikasi</th><th>HHI</th>
    <th>Vendor #1</th><th>#2</th><th>#3</th></tr></thead><tbody>`;
  const kc = { Monopoli:'mono-k', Dominan:'dom', Terbagi:'terb' };
  for (const a of rows) {
    const cell = t => t ? `${t[0]} <span class="mono">(${pct(t[2])})</span>` : '—';
    html += `<tr><td class="mono">${a.pulau||'-'}</td><td><b>${a.tujuan}</b></td>
      <td class="mono">${a.total}</td>
      <td><span class="klas ${kc[a.klas]}">${a.klas}</span></td>
      <td class="mono">${a.hhi.toFixed(2)}</td>
      <td>${cell(a.top[0])}</td><td>${cell(a.top[1])}</td><td>${cell(a.top[2])}</td></tr>`;
  }
  return html + '</tbody></table></div>';
}

/* ---------- Tab: Master Scoring editor ---------- */
function pctVal(x) { return Math.round(x * 1000) / 10; } // 0.505 -> 50.5
function bandEditor(title, key) {
  const bands = MASTER[key];
  let rows = bands.map((b, i) => `<tr>
    <td>${sc(b.score)}</td>
    <td><div class="pctinput"><input type="number" step="1" min="0" max="100" value="${pctVal(b.min)}" data-k="${key}" data-i="${i}" data-f="min"><span>%</span></div></td>
    <td><div class="pctinput"><input type="number" step="1" min="0" max="101" value="${pctVal(b.max)}" data-k="${key}" data-i="${i}" data-f="max"><span>%</span></div></td>
  </tr>`).join('');
  return `<div class="editcard"><h3>${title}</h3>
    <table><thead><tr><th>Skor</th><th>Min</th><th>Max</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note">Ambang dalam persen. Contoh 50 = 50%. Batas atas (Max) bersifat eksklusif.</p></div>`;
}
function renderMaster() {
  const w = MASTER.weights;
  const weightRows = ['availability','fulfillment','ota','price'].map(k =>
    `<div class="weights-row"><label>${k}</label>
     <input type="number" min="0" max="100" value="${w[k]}" data-w="${k}"></div>`).join('');
  return `<div class="editor">
    ${bandEditor('Score Availability','availability')}
    ${bandEditor('Score Fulfillment','fulfillment')}
    ${bandEditor('Score OTA','ota')}
    <div class="editcard"><h3>Bobot Skor Akhir</h3>${weightRows}
      <p class="note">Bobot menentukan skor akhir tertimbang. Total tidak harus 100 (dinormalisasi otomatis). Price di-skor relatif per rute (termurah=5).</p></div>
    </div>
    <div class="savebar">
      <button class="btn" onclick="saveMaster()">Simpan &amp; Terapkan</button>
      <button class="btn ghost" onclick="exportMaster()">Export JSON</button>
      <button class="btn ghost" onclick="document.getElementById('importFile').click()">Import JSON</button>
      <button class="btn ghost" onclick="resetMaster()">Reset ke Default</button>
      <input type="file" id="importFile" accept="application/json" style="display:none" onchange="importMaster(event)">
    </div>
    <p class="note">Perubahan tersimpan di browser ini (localStorage). Untuk menjadikan default seluruh tim: <b>Export JSON</b> lalu commit file ke <span class="mono">data/master-scoring.json</span> di repo.</p>`;
}

/* ---------- master actions ---------- */
function collectMasterEdits() {
  document.querySelectorAll('input[data-k]').forEach(inp => {
    const { k, i, f } = inp.dataset;
    MASTER[k][+i][f] = (parseFloat(inp.value) || 0) / 100; // persen -> proporsi
  });
  document.querySelectorAll('input[data-w]').forEach(inp => {
    MASTER.weights[inp.dataset.w] = parseFloat(inp.value) || 0;
  });
}
function saveMaster() {
  collectMasterEdits();
  localStorage.setItem(LS_KEY, JSON.stringify(MASTER));
  toast('Master scoring disimpan & diterapkan');
  recompute();
}
function exportMaster() {
  collectMasterEdits();
  const blob = new Blob([JSON.stringify(MASTER, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'master-scoring.json'; a.click();
}
function importMaster(ev) {
  const f = ev.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { try { MASTER = JSON.parse(rd.result); localStorage.setItem(LS_KEY, JSON.stringify(MASTER)); toast('Master di-import'); recompute(); } catch { toast('File tidak valid'); } };
  rd.readAsText(f);
}
function resetMaster() {
  localStorage.removeItem(LS_KEY);
  fetch('data/master-scoring.json').then(r=>r.json()).then(d=>{ MASTER=d; toast('Direset ke default'); recompute(); });
}
function toast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- render router ---------- */
function render() {
  renderKpis();
  const view = document.getElementById('view');
  const kpiEl = document.getElementById('kpis');
  kpiEl.style.display = state.tab === 'master' ? 'none' : '';
  if (state.tab === 'ranking') view.innerHTML = renderRanking();
  else if (state.tab === 'vendor') view.innerHTML = renderVendor();
  else if (state.tab === 'dominansi') view.innerHTML = renderDominansi();
  else if (state.tab === 'master') view.innerHTML = renderMaster();
}

boot();
