/* ============================================================
   scoring.js — Engine perhitungan scoring vendor
   Semua logika dihitung di browser dari data/trips.json.
   Rolling window: skor dihitung dari N bulan terakhir (default 3).
   ============================================================ */

const Scoring = (() => {

  // Map nilai persen -> skor berdasarkan tabel band {score,min,max}
  function bandScore(pct, bands) {
    for (const b of bands) {
      if (pct >= b.min && pct < b.max) return b.score;
    }
    // fallback: kalau pct == 0 dan tidak ketangkap
    return 0;
  }

  // Price score: relatif per rute (range min-max dibagi N interval)
  function priceScore(cost, min, max, cfg) {
    if (cost == null) return 0;
    if (max === min) return cfg.cheapestScore;      // single vendor
    const width = (max - min) / cfg.intervals;
    let idx = Math.floor((cost - min) / width);
    if (idx >= cfg.intervals) idx = cfg.intervals - 1;
    return cfg.cheapestScore - idx;                 // termurah = cheapestScore
  }

  /* Filter trip berdasarkan rolling window.
     currentMonth = bulan acuan; ambil (currentMonth - rolling + 1) .. currentMonth */
  function filterRolling(trips, currentMonth, rolling) {
    const lo = currentMonth - rolling + 1;
    return trips.filter(t => t.m != null && t.m >= lo && t.m <= currentMonth);
  }

  /* Hitung skor per vendor untuk satu rute (origin|tujuan|type).
     Mengembalikan array baris vendor dengan trip, share, dan 4 skor. */
  function scoreRoute(routeTrips, avlVendors, master, priceMap) {
    const total = routeTrips.length;
    // agregasi per vendor
    const agg = {};
    for (const t of routeTrips) {
      if (!agg[t.v]) agg[t.v] = { trip: 0, ota: 0, ful: 0 };
      agg[t.v].trip++; agg[t.v].ota += t.ota; agg[t.v].ful += t.ful;
    }
    const usedVendors = Object.keys(agg);
    const allVendors = Array.from(new Set([...(avlVendors || []), ...usedVendors]));

    // price range untuk rute ini (dari vendor yang punya harga)
    const costs = [];
    for (const v of allVendors) {
      const c = priceMap ? priceMap[v] : null;
      if (c != null) costs.push(c);
    }
    const pmin = costs.length ? Math.min(...costs) : null;
    const pmax = costs.length ? Math.max(...costs) : null;

    const rows = allVendors.map(v => {
      const a = agg[v] || { trip: 0, ota: 0, ful: 0 };
      const share = total > 0 ? a.trip / total : 0;
      const otaPct = a.trip > 0 ? a.ota / a.trip : 0;
      const fulPct = a.trip > 0 ? a.ful / a.trip : 0;
      const cost = priceMap ? (priceMap[v] ?? null) : null;
      const isAvl = (avlVendors || []).includes(v);
      const sAvail = bandScore(share, master.availability);
      const sFul = bandScore(fulPct, master.fulfillment);
      const sOta = bandScore(otaPct, master.ota);
      const sPrice = priceScore(cost, pmin, pmax, master.price);
      // skor akhir tertimbang
      const w = master.weights;
      const wtotal = (w.availability + w.fulfillment + w.ota + w.price) || 1;
      const finalScore = (
        sAvail * w.availability +
        sFul * w.fulfillment +
        sOta * w.ota +
        sPrice * w.price
      ) / wtotal;
      return {
        vendor: v, isAvl, trip: a.trip, share,
        otaPct, fulPct, cost,
        scoreAvail: sAvail, scoreFul: sFul, scoreOta: sOta, scorePrice: sPrice,
        finalScore: Math.round(finalScore * 100) / 100
      };
    });
    rows.sort((x, y) => y.finalScore - x.finalScore || y.trip - x.trip);
    return { total, rows };
  }

  /* Bangun seluruh scoring untuk semua rute pada window tertentu.
     Return: { routes: [{origin,tujuan,type,pulau,total,rows}], vendorAgg } */
  function buildAll(data, master, currentMonth, priceData) {
    const rolling = master.rollingMonths || 3;
    const trips = filterRolling(data.trips, currentMonth, rolling);

    // group by rute
    const byRoute = {};
    const pulauOf = {};
    for (const t of trips) {
      const k = `${t.o}|${t.t}|${t.ty}`;
      (byRoute[k] = byRoute[k] || []).push(t);
      if (t.p) pulauOf[`${t.t}`] = t.p;
    }
    // sertakan juga rute yang ada di AVL walau 0 trip di window (opsional; di sini fokus yang ada trip)
    const routes = [];
    const vendorAgg = {};
    for (const k of Object.keys(byRoute)) {
      const [o, t, ty] = k.split('|');
      const avlV = data.avl[k] || [];
      const pmap = priceData ? (priceData[k] || null) : null;
      const res = scoreRoute(byRoute[k], avlV, master, pmap);
      routes.push({ origin: o, tujuan: t, type: ty, pulau: pulauOf[t] || null, total: res.total, rows: res.rows });
      // agregasi POV vendor + detail rute per vendor
      for (const r of res.rows) {
        if (r.trip === 0) continue;
        if (!vendorAgg[r.vendor]) vendorAgg[r.vendor] = { vendor: r.vendor, trip: 0, routes: 0, sumFinal: 0, detail: [], tujuanSet: new Set() };
        vendorAgg[r.vendor].trip += r.trip;
        vendorAgg[r.vendor].routes += 1;
        vendorAgg[r.vendor].sumFinal += r.finalScore;
        vendorAgg[r.vendor].tujuanSet.add(t);
        vendorAgg[r.vendor].detail.push({
          origin: o, tujuan: t, type: ty, pulau: pulauOf[t] || null,
          trip: r.trip, share: r.share, isAvl: r.isAvl,
          scoreAvail: r.scoreAvail, scoreFul: r.scoreFul, scoreOta: r.scoreOta, scorePrice: r.scorePrice,
          finalScore: r.finalScore
        });
      }
    }
    // rata2 skor akhir per vendor + urutkan detail (trip desc)
    const totalTripAll = trips.length;
    const vendors = Object.values(vendorAgg).map(v => {
      v.detail.sort((a, b) => b.trip - a.trip);
      const { tujuanSet, ...rest } = v;
      return { ...rest,
        tujuans: tujuanSet.size,
        shareTrip: totalTripAll ? v.trip / totalTripAll : 0,
        avgFinal: v.routes ? Math.round((v.sumFinal / v.routes) * 100) / 100 : 0 };
    }).sort((a, b) => b.avgFinal - a.avgFinal || b.trip - a.trip);

    // vendor tidak aktif: terdaftar di AVL tapi 0 trip di window ini
    const activeSet = new Set(Object.keys(vendorAgg));
    const inactiveMap = {}; // vendor -> {vendor, routes:[{origin,tujuan,type}], nRoute}
    for (const k of Object.keys(data.avl)) {
      const [o, t, ty] = k.split('|');
      for (const v of data.avl[k]) {
        if (activeSet.has(v)) continue;              // masih aktif di suatu rute -> lewati
        if (!inactiveMap[v]) inactiveMap[v] = { vendor: v, nRoute: 0, routes: [] };
        inactiveMap[v].nRoute++;
        inactiveMap[v].routes.push({ origin: o, tujuan: t, type: ty });
      }
    }
    const inactiveVendors = Object.values(inactiveMap)
      .map(v => { v.routes.sort((a, b) => (a.tujuan+a.type).localeCompare(b.tujuan+b.type)); return v; })
      .sort((a, b) => b.nRoute - a.nRoute || a.vendor.localeCompare(b.vendor));

    // non-aktif level rute: vendor AVL di rute (origin|tujuan|type) tapi 0 trip di rute itu pada window
    const activeByRoute = {};
    for (const t of trips) {
      const k = `${t.o}|${t.t}|${t.ty}`;
      (activeByRoute[k] = activeByRoute[k] || new Set()).add(t.v);
    }
    const routeInactive = [];
    for (const k of Object.keys(data.avl)) {
      const [o, t, ty] = k.split('|');
      const avlV = data.avl[k];
      const actSet = activeByRoute[k] || new Set();
      const inact = avlV.filter(v => !actSet.has(v)).sort();
      if (!inact.length) continue;
      const totalVendor = new Set([...avlV, ...actSet]).size;  // keseluruhan vendor melayani rute
      routeInactive.push({
        origin: o, tujuan: t, type: ty, pulau: pulauOf[t] || null,
        totalTrip: (byRoute[k] || []).length,
        nAvl: avlV.length, nActive: actSet.size, nInactive: inact.length,
        totalVendor, pctActive: totalVendor ? actSet.size / totalVendor : 0,
        inactive: inact
      });
    }
    routeInactive.sort((a, b) => b.nInactive - a.nInactive || a.tujuan.localeCompare(b.tujuan) || a.origin.localeCompare(b.origin));

    return { routes, vendors, inactiveVendors, routeInactive, windowMonths: [currentMonth - rolling + 1, currentMonth], tripCount: trips.length };
  }

  return { buildAll, scoreRoute, bandScore, priceScore, filterRolling };
})();

if (typeof module !== 'undefined') module.exports = Scoring;
