/* ============================================================
   data-source.js — Konfigurasi auto-update dari Google Sheets
   ------------------------------------------------------------
   Dashboard menarik data History_Trip langsung dari Google Sheets
   (publish-to-web CSV) setiap kali dibuka. Normalisasi & scoring
   dilakukan di browser.

   Cara ganti sumber: ubah SHEET_ID di bawah.
   Set ENABLED=false untuk pakai data/trips.json statis (mode offline).
   ============================================================ */
const DataSource = {
  ENABLED: true,
  SHEET_ID: '1K3YnDFWXcg5SqtoRu-lhLTDbg0ip_cNMpfc7wzlBi1k',
  get CSV_URL() {
    return `https://docs.google.com/spreadsheets/d/${this.SHEET_ID}/export?format=csv`;
  },

  // alias & normalisasi — samakan dengan scripts/build_from_gsheet.py
  TUJUAN_ALIAS: { 'SURABAYA':'SIDOARJO','JOGJA':'YOGYAKARTA','BANYUMAS':'PURWOKERTO','JAYA PURA':'JAYAPURA' },

  normOrigin(x) {
    const s = String(x || '').toUpperCase().trim();
    if (s.includes('IND JABABEKA')) return null;   // exclude
    if (s.includes('CIKANDE')) return null;         // exclude
    if (s.includes('JABABEKA')) return 'JABABEKA';
    if (s.includes('CIKUPA')) return 'CIKUPA';
    if (s.includes('SIDOARJO')) return 'SIDOARJO';
    if (s.includes('JAKARTA')) return 'JAKARTA';
    return s;
  },
  normType(x) {
    const s = String(x || '').toUpperCase().trim();
    if (s === 'BIG MAMA' || s === 'WBOX' || s.startsWith('WINGBOX')) return 'WINGBOX';
    if (s === 'CDD LONG CHASSIS' || s === 'CDDLC' || s === 'CDD LONG') return 'CDDL';
    if (s.startsWith('CONT-20')) return 'CONT-20';
    if (s.startsWith('CONT-40')) return 'CONT-40';
    return s;
  },
  normVendor(x) {
    const s = String(x || '').toUpperCase().trim();
    return s === 'RPL' ? 'TEL' : s;
  },

  // parser CSV sederhana (handle quoted fields & koma di dalam quote)
  parseCSV(text) {
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else {
        if (c === '"') q = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c === '\r') { /* skip */ }
        else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  },

  // parse "5 Jan 2026" -> {month, week}
  MONTHS: { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,MEI:5,JUN:6,JUL:7,AUG:8,AGU:8,SEP:9,OCT:10,OKT:10,NOV:11,DEC:12,DES:12 },
  parseDate(s) {
    const m = String(s || '').trim().match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
    if (!m) return null;
    const mon = this.MONTHS[m[2].slice(0,3).toUpperCase()];
    if (!mon) return null;
    const d = new Date(Date.UTC(+m[3], mon-1, +m[1]));
    // ISO week
    const dt = new Date(d);
    dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
    const yStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((dt - yStart) / 86400000) + 1) / 7);
    return { month: mon, week };
  },

  // Ambil & transform CSV -> {trips, supply}
  async fetchAndBuild(pulauMap) {
    const res = await fetch(this.CSV_URL);
    if (!res.ok) throw new Error('gagal fetch sheet: ' + res.status);
    const text = await res.text();
    const rows = this.parseCSV(text);
    const header = rows[0].map(h => h.trim());
    const col = name => header.indexOf(name);
    const iSite = col('Supply site'), iVen = col('Vendor'), iType = col('TYPE'),
          iTuj = col('Tujuan'), iDate = col('Delivery Date'),
          iFul = col('SLA FULFILL'), iOta = col('SLA OTA'), iOtd = col('SLA OTD');

    const CAP = { WINGBOX:42,'CONT-40':50,TRAILER:42,FUSO:34,'CONT-20':25,CDDL:16,CDD:13,CDEL:11,
                  'CONT-45':64,CDE:4,'MINI VAN BOX':3,TRONTON:50,BOX:13,LOSBAK:13 };
    const LOAD = 0.85;

    const trips = [], supply = [];
    const monthsSet = new Set(), pulauSet = new Set();
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length < header.length) continue;
      const origin = this.normOrigin(row[iSite]);
      if (!origin) continue;
      let tujuan = String(row[iTuj] || '').toUpperCase().trim();
      if (!tujuan) continue;
      tujuan = this.TUJUAN_ALIAS[tujuan] || tujuan;
      const type = this.normType(row[iType]);
      const vendor = this.normVendor(row[iVen]);
      const dm = this.parseDate(row[iDate]);
      if (!dm) continue;
      const pulau = pulauMap[tujuan] || '';
      const ota = String(row[iOta]||'').toUpperCase().trim() === 'HIT' ? 1 : 0;
      const ful = String(row[iFul]||'').toUpperCase().trim() === 'HIT' ? 1 : 0;
      const otd = String(row[iOtd]||'').toUpperCase().trim() === 'HIT' ? 1 : 0;
      trips.push({ o:origin, t:tujuan, ty:type, v:vendor, p:pulau, m:dm.month, ota, ful, otd });
      monthsSet.add(dm.month); if (pulau) pulauSet.add(pulau);
      if (ful === 1) {
        const cap = (CAP[type] || 0) * LOAD;
        supply.push({ t:tujuan, o:origin, ty:type, v:vendor, w:dm.week, m:dm.month, cap:Math.round(cap*1000)/1000, unit:1, alloc:0 });
      }
    }
    const months = [...monthsSet].sort((a,b)=>a-b);
    const pulauList = [...pulauSet].sort();
    const contOnly = {};
    const CONT_PULAU = new Set(['Kalimantan','Sulawesi','Maluku','Papua']);
    for (const t of Object.keys(pulauMap)) contOnly[t] = (CONT_PULAU.has(pulauMap[t]) || t === 'KUPANG') ? 1 : 0;
    return {
      trips: { trips, avl:{}, scoreOrder:{}, months, pulauList },
      supply: { supply, months, pulau: pulauMap, contOnly }
    };
  }
};
