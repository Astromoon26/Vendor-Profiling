/* ============================================================
   app.js — UI, state, rendering, master-scoring editor
   ============================================================ */
const LS_KEY = 'cargoscore_master_v1';
let DATA = null, MASTER = null, PRICE = null;
let state = { month: null, rolling: 3, pulau: '', search: '', tab: 'master', vendorSub: 'aktif' };
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
  // di tab Vendor, ganti kartu terakhir jadi Vendor Tidak Aktif (AVL tapi 0 trip di window)
  if (state.tab === 'vendor') {
    const nInactive = (computed.inactiveVendors || []).length;
    cards[3] = { k: 'Vendor Tidak Aktif', v: nInactive, c: nInactive > 0 ? 'red' : '' };
  }
  document.getElementById('kpis').innerHTML = cards.map(c =>
    `<div class="kpi"><div class="k">${c.k}</div><div class="v ${c.c}">${c.v}</div></div>`).join('');
}

/* ---------- Tab: Ranking Rute ---------- */
/* ---------- Tab: Route ---------- */
let routeFilter = { origin: '', tujuan: '', type: '', qOrigin: '', qTujuan: '' };
function setRoute(field, val) { routeFilter[field] = val; render(); }
function renderRanking() {
  const f = routeFilter;
  // hanya vendor yang punya trip
  let routes = computed.routes.filter(filterPulau)
    .map(r => ({ ...r, rows: r.rows.filter(x => x.trip > 0) }))
    .filter(r => r.rows.length > 0);
  // opsi dropdown dari data yang ada
  const origins = Array.from(new Set(routes.map(r => r.origin))).sort();
  const tujuans = Array.from(new Set(routes.map(r => r.tujuan))).sort();
  const types = Array.from(new Set(routes.map(r => r.type))).sort();
  // terapkan filter toolbar + search global
  routes = routes.filter(r =>
    (!f.origin || r.origin === f.origin) &&
    (!f.tujuan || r.tujuan === f.tujuan) &&
    (!f.type || r.type === f.type) &&
    (!f.qOrigin || r.origin.toLowerCase().includes(f.qOrigin.toLowerCase())) &&
    (!f.qTujuan || r.tujuan.toLowerCase().includes(f.qTujuan.toLowerCase()))
  ).filter(r => matchSearch(r.tujuan, r.origin, ...r.rows.map(x => x.vendor)))
   .sort((a, b) => b.total - a.total);

  const opt = (arr, sel) => ['<option value="">Semua</option>']
    .concat(arr.map(x => `<option ${x===sel?'selected':''}>${x}</option>`)).join('');
  const toolbar = `<div class="detailtoolbar routebar">
    <div class="fld"><label>Cari Origin</label><input type="text" value="${f.qOrigin}" oninput="setRoute('qOrigin',this.value)" placeholder="ketik…"></div>
    <div class="fld"><label>Origin</label><select onchange="setRoute('origin',this.value)">${opt(origins,f.origin)}</select></div>
    <div class="fld"><label>Cari Tujuan</label><input type="text" value="${f.qTujuan}" oninput="setRoute('qTujuan',this.value)" placeholder="ketik…"></div>
    <div class="fld"><label>Tujuan</label><select onchange="setRoute('tujuan',this.value)">${opt(tujuans,f.tujuan)}</select></div>
    <div class="fld"><label>Type Armada</label><select onchange="setRoute('type',this.value)">${opt(types,f.type)}</select></div>
  </div>`;

  if (!routes.length) return toolbar + `<div class="empty">Tidak ada rute pada filter ini.</div>`;
  let html = toolbar + `<div class="tablewrap"><table><thead><tr>
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
        <td class="mono">${pct(v.share)}</td>
        <td>${sc(v.scoreAvail)}</td><td>${sc(v.scoreFul)}</td><td>${sc(v.scoreOta)}</td><td>${sc(v.scorePrice)}</td>
        <td class="final">${v.finalScore.toFixed(2)}</td>
      </tr>`;
    });
  }
  return html + '</tbody></table></div>';
}

/* ---------- Tab: Vendor (ekspandable ke detail rute) ---------- */
let expandedVendor = null;
// state filter/sort untuk detail vendor yang sedang terbuka
let detailFilter = { origin: '', tujuan: '', type: '', qOrigin: '', qTujuan: '', sortKey: 'trip', sortDir: 'desc' };
function toggleVendor(name) {
  const changing = expandedVendor !== name;
  expandedVendor = (expandedVendor === name) ? null : name;
  if (changing) detailFilter = { origin: '', tujuan: '', type: '', qOrigin: '', qTujuan: '', sortKey: 'trip', sortDir: 'desc' };
  render();
}
function setDetail(field, val) { detailFilter[field] = val; render(); }
function sortDetail(key) {
  if (detailFilter.sortKey === key) detailFilter.sortDir = detailFilter.sortDir === 'desc' ? 'asc' : 'desc';
  else { detailFilter.sortKey = key; detailFilter.sortDir = 'desc'; }
  render();
}
function sortArrow(key) {
  if (detailFilter.sortKey !== key) return '<span class="arr dim">\u2195</span>';
  return detailFilter.sortDir === 'desc' ? '<span class="arr">\u25be</span>' : '<span class="arr">\u25b4</span>';
}
function applyDetailFilter(detail) {
  const f = detailFilter;
  let rows = detail.filter(d =>
    (!f.origin || d.origin === f.origin) &&
    (!f.tujuan || d.tujuan === f.tujuan) &&
    (!f.type || d.type === f.type) &&
    (!f.qOrigin || d.origin.toLowerCase().includes(f.qOrigin.toLowerCase())) &&
    (!f.qTujuan || d.tujuan.toLowerCase().includes(f.qTujuan.toLowerCase()))
  );
  const keyMap = { trip:'trip', share:'share', avail:'scoreAvail', fulfill:'scoreFul', ota:'scoreOta', price:'scorePrice' };
  const k = keyMap[f.sortKey] || 'trip';
  rows.sort((a, b) => f.sortDir === 'desc' ? b[k] - a[k] : a[k] - b[k]);
  return rows;
}
function renderVendor() {
  const sub = state.vendorSub || 'aktif';
  const bar = `<div class="subnav">
    <label>Tampilan</label>
    <select id="vendorSubSel" onchange="setVendorSub(this.value)">
      <option value="aktif" ${sub==='aktif'?'selected':''}>Vendor Aktif</option>
      <optgroup label="Non Aktif">
        <option value="inaktif_tujuan" ${sub==='inaktif_tujuan'?'selected':''}>0 Trip (semua tujuan)</option>
        <option value="inaktif_rute" ${sub==='inaktif_rute'?'selected':''}>Per Rute (Origin × Tujuan × Type)</option>
      </optgroup>
    </select>
  </div>`;
  let body;
  if (sub === 'inaktif_tujuan') body = renderVendorInactiveTujuan();
  else if (sub === 'inaktif_rute') body = renderVendorInactiveRoute();
  else body = renderVendorAktif();
  return bar + body;
}
function setVendorSub(val) { state.vendorSub = val; expandedVendor = null; render(); }

/* ---- Vendor Aktif ---- */
function renderVendorAktif() {
  const vendors = computed.vendors.filter(v => matchSearch(v.vendor));
  if (!vendors.length) return `<div class="empty">Tidak ada vendor aktif pada filter ini.</div>`;
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
      const origins = Array.from(new Set(v.detail.map(d => d.origin))).sort();
      const tujuans = Array.from(new Set(v.detail.map(d => d.tujuan))).sort();
      const types = Array.from(new Set(v.detail.map(d => d.type))).sort();
      const opt = (arr, sel) => ['<option value="">Semua</option>']
        .concat(arr.map(x => `<option ${x===sel?'selected':''}>${x}</option>`)).join('');
      const rows = applyDetailFilter(v.detail);
      const shead = (label, key) => `<th class="sortable" onclick="event.stopPropagation();sortDetail('${key}')">${label} ${sortArrow(key)}</th>`;
      html += `<tr class="detailrow"><td colspan="6"><div class="detailwrap" onclick="event.stopPropagation()">
        <div class="detailhdr">Detail rute <b>${v.vendor}</b> — skor mentah (sebelum pembobotan) · <span class="muted">${rows.length}/${v.detail.length} rute</span></div>
        <div class="detailtoolbar">
          <div class="fld"><label>Cari Origin</label><input type="text" value="${detailFilter.qOrigin}" oninput="setDetail('qOrigin',this.value)" placeholder="ketik…"></div>
          <div class="fld"><label>Origin</label><select onchange="setDetail('origin',this.value)">${opt(origins,detailFilter.origin)}</select></div>
          <div class="fld"><label>Cari Tujuan</label><input type="text" value="${detailFilter.qTujuan}" oninput="setDetail('qTujuan',this.value)" placeholder="ketik…"></div>
          <div class="fld"><label>Tujuan</label><select onchange="setDetail('tujuan',this.value)">${opt(tujuans,detailFilter.tujuan)}</select></div>
          <div class="fld"><label>Type Armada</label><select onchange="setDetail('type',this.value)">${opt(types,detailFilter.type)}</select></div>
        </div>
        <table class="detailtable"><thead><tr>
          <th>Origin</th><th>Tujuan</th><th>Type</th><th>Pulau</th><th>Status</th>
          ${shead('Trip','trip')}${shead('Share','share')}
          ${shead('Avail','avail')}${shead('Fulfill','fulfill')}${shead('OTA','ota')}${shead('Price','price')}
        </tr></thead><tbody>`;
      if (!rows.length) {
        html += `<tr><td colspan="11" class="empty small">Tidak ada rute pada filter ini.</td></tr>`;
      } else for (const d of rows) {
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

/* ---- Non Aktif: 0 trip di semua tujuan (AVL, 0 trip di window) ---- */
function renderVendorInactiveTujuan() {
  const inactive = (computed.inactiveVendors || []).filter(v =>
    matchSearch(v.vendor, ...v.routes.map(r => r.tujuan)));
  let html = `<div class="section-head">
      <span class="dot red"></span> Vendor Non Aktif — 0 Trip
      <span class="muted">— terdaftar AVL tapi 0 trip di seluruh tujuan pada window ini (${computed.inactiveVendors.length} vendor)</span>
    </div>`;
  if (!inactive.length) return html + `<div class="empty small">Tidak ada (atau tersaring oleh pencarian).</div>`;
  html += `<div class="tablewrap"><table class="vendortable inactive"><thead><tr>
    <th></th><th>Vendor</th><th>Rute AVL</th><th>Origin</th><th>Tujuan</th>
    </tr></thead><tbody>`;
  inactive.forEach(v => {
    const open = expandedVendor === '__inactive__' + v.vendor;
    const origins = Array.from(new Set(v.routes.map(r => r.origin))).length;
    const dests = Array.from(new Set(v.routes.map(r => r.tujuan))).length;
    html += `<tr class="vrow ${open?'open':''}" onclick="toggleVendor('__inactive__${v.vendor.replace(/'/g,"\\'")}')">
      <td class="caret">${open?'\u25be':'\u25b8'}</td>
      <td class="mono"><b>${v.vendor}</b></td>
      <td class="mono">${v.nRoute}</td><td class="mono">${origins}</td><td class="mono">${dests}</td></tr>`;
    if (open) {
      html += `<tr class="detailrow"><td colspan="5"><div class="detailwrap">
        <div class="detailhdr">Rute AVL <b>${v.vendor}</b> — terdaftar tapi belum ada trip di window</div>
        <table class="detailtable"><thead><tr><th>Origin</th><th>Tujuan</th><th>Type</th></tr></thead><tbody>`;
      for (const r of v.routes) {
        html += `<tr><td class="mono">${r.origin}</td><td><b>${r.tujuan}</b></td><td class="mono">${r.type}</td></tr>`;
      }
      html += `</tbody></table></div></td></tr>`;
    }
  });
  return html + '</tbody></table></div>';
}

/* ---- Non Aktif: per rute Origin × Tujuan × Type ---- */
function renderVendorInactiveRoute() {
  const rows = (computed.routeInactive || [])
    .filter(r => r.totalTrip > 0)                    // hanya rute yang ADA trip
    .filter(filterPulau)
    .filter(r => matchSearch(r.tujuan, r.origin, ...r.inactive));
  let html = `<div class="section-head">
      <span class="dot red"></span> Vendor Non Aktif — Per Rute
      <span class="muted">— vendor terdaftar AVL di rute yang ada trip, tapi 0 trip di rute itu (window ini)</span>
    </div>`;
  if (!rows.length) return html + `<div class="empty small">Tidak ada (atau tersaring oleh filter).</div>`;
  html += `<div class="tablewrap"><table class="vendortable inactive"><thead><tr>
    <th>Origin</th><th>Tujuan</th><th>Type</th><th>Pulau</th><th>Trip Rute</th>
    <th>Total Vendor</th><th>Aktif</th><th>Non Aktif</th><th>% Aktif</th><th>Vendor Non Aktif</th>
    </tr></thead><tbody>`;
  rows.forEach(r => {
    const p = r.pctActive;
    const pcls = p >= 0.5 ? 'good' : (p >= 0.25 ? 'mid' : 'low');
    html += `<tr>
      <td class="mono">${r.origin}</td><td><b>${r.tujuan}</b></td><td class="mono">${r.type}</td>
      <td class="mono">${r.pulau||'-'}</td><td class="mono">${r.totalTrip}</td>
      <td class="mono">${r.totalVendor}</td><td class="mono">${r.nActive}</td>
      <td class="mono"><b class="warnnum">${r.nInactive}</b></td>
      <td class="mono"><span class="pctbadge ${pcls}">${pct(p)}</span></td>
      <td><div class="chips inline">${r.inactive.map(v => `<span class="chip">${v}</span>`).join('')}</div></td>
    </tr>`;
  });
  return html + '</tbody></table></div>';
}

/* ---------- Tab: Dominansi ---------- */
let domFilter = { pulau: '', tujuan: '', klas: '', qTujuan: '' };
function setDom(field, val) { domFilter[field] = val; render(); }
function renderDominansi() {
  // agregasi per pulau x tujuan
  const agg = {};
  for (const r of computed.routes.filter(filterPulau)) {
    const key = `${r.pulau||'-'}|${r.tujuan}`;
    if (!agg[key]) agg[key] = { pulau: r.pulau, tujuan: r.tujuan, total: 0, vendors: {} };
    agg[key].total += r.total;
    for (const v of r.rows) { if (v.trip>0) agg[key].vendors[v.vendor] = (agg[key].vendors[v.vendor]||0) + v.trip; }
  }
  let rows = Object.values(agg).map(a => {
    const arr = Object.entries(a.vendors).map(([v,c]) => [v, c, c/a.total]).sort((x,y)=>y[1]-x[1]);
    const s1 = arr.length ? arr[0][2] : 0;
    const klas = s1>=0.8?'Monopoli':(s1>=0.5?'Dominan':'Terbagi');
    const hhi = arr.reduce((s,[,c])=>s+Math.pow(c/a.total,2),0);
    return { ...a, top: arr.slice(0,3), klas, hhi };
  });
  // opsi dropdown dari data
  const pulaus = Array.from(new Set(rows.map(r => r.pulau||'-'))).sort();
  const tujuans = Array.from(new Set(rows.map(r => r.tujuan))).sort();
  const klasifikasi = ['Monopoli','Dominan','Terbagi'];
  const f = domFilter;
  rows = rows.filter(a =>
    (!f.pulau || (a.pulau||'-') === f.pulau) &&
    (!f.tujuan || a.tujuan === f.tujuan) &&
    (!f.klas || a.klas === f.klas) &&
    (!f.qTujuan || a.tujuan.toLowerCase().includes(f.qTujuan.toLowerCase()))
  ).filter(a => matchSearch(a.tujuan)).sort((x,y)=>y.total-x.total);

  const opt = (arr, sel) => ['<option value="">Semua</option>']
    .concat(arr.map(x => `<option ${x===sel?'selected':''}>${x}</option>`)).join('');
  const toolbar = `<div class="detailtoolbar routebar">
    <div class="fld"><label>Pulau</label><select onchange="setDom('pulau',this.value)">${opt(pulaus,f.pulau)}</select></div>
    <div class="fld"><label>Cari Tujuan</label><input type="text" value="${f.qTujuan}" oninput="setDom('qTujuan',this.value)" placeholder="ketik…"></div>
    <div class="fld"><label>Tujuan</label><select onchange="setDom('tujuan',this.value)">${opt(tujuans,f.tujuan)}</select></div>
    <div class="fld"><label>Klasifikasi</label><select onchange="setDom('klas',this.value)">${opt(klasifikasi,f.klas)}</select></div>
  </div>`;

  if (!rows.length) return toolbar + `<div class="empty">Tidak ada data pada filter ini.</div>`;
  let html = toolbar + `<div class="tablewrap"><table><thead><tr>
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
  // simpan fokus & posisi kursor input toolbar detail (agar ketik tak terputus)
  const act = document.activeElement;
  let focusInfo = null;
  if (act && act.tagName === 'INPUT' && act.closest('.detailtoolbar')) {
    const lbl = act.closest('.fld')?.querySelector('label')?.textContent || '';
    focusInfo = { lbl, start: act.selectionStart, end: act.selectionEnd };
  }
  renderKpis();
  const view = document.getElementById('view');
  const kpiEl = document.getElementById('kpis');
  kpiEl.style.display = state.tab === 'master' ? 'none' : '';
  if (state.tab === 'ranking') view.innerHTML = renderRanking();
  else if (state.tab === 'vendor') view.innerHTML = renderVendor();
  else if (state.tab === 'dominansi') view.innerHTML = renderDominansi();
  else if (state.tab === 'master') view.innerHTML = renderMaster();
  // pulihkan fokus
  if (focusInfo) {
    const flds = document.querySelectorAll('.detailtoolbar .fld');
    for (const f of flds) {
      if (f.querySelector('label')?.textContent === focusInfo.lbl) {
        const inp = f.querySelector('input');
        if (inp) { inp.focus(); try { inp.setSelectionRange(focusInfo.start, focusInfo.end); } catch {} }
        break;
      }
    }
  }
}

boot();
