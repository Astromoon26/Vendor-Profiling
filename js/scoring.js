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
  function scoreRoute(routeTrips, avlVendors, master, priceMap, priceByMonth, routeKey) {
    const total = routeTrips.length;
    // agregasi per vendor (+ trip per bulan utk weighted price point-in-time)
    const agg = {};
    for (const t of routeTrips) {
      if (!agg[t.v]) agg[t.v] = { trip: 0, ota: 0, ful: 0, otd: 0, byMonth: {} };
      agg[t.v].trip++; agg[t.v].ota += t.ota; agg[t.v].ful += t.ful; agg[t.v].otd += (t.otd || 0);
      agg[t.v].byMonth[t.m] = (agg[t.v].byMonth[t.m] || 0) + 1;
    }
    const usedVendors = Object.keys(agg);

    // Kumpulkan bulan-bulan yang ada di trip rute ini
    const monthsInRoute = Array.from(new Set(routeTrips.map(t => t.m)));
    const usePIT = priceByMonth && Object.keys(priceByMonth).length > 0;

    // priceMap efektif per bulan: arsip bulan itu kalau ada, else fallback priceMap
    const priceForMonth = (mo) => {
      if (usePIT && priceByMonth[mo] && priceByMonth[mo][routeKey]) return priceByMonth[mo][routeKey];
      return priceMap || null;
    };

    // AVL union: vendor yang punya harga di SALAH SATU bulan window + avlVendors statis + used
    const avlSet = new Set(avlVendors || []);
    if (usePIT) {
      for (const mo of monthsInRoute) {
        const pm = priceByMonth[mo] && priceByMonth[mo][routeKey];
        if (pm) for (const v of Object.keys(pm)) avlSet.add(v);
      }
    } else if (priceMap) {
      for (const v of Object.keys(priceMap)) avlSet.add(v);
    }
    const allVendors = Array.from(new Set([...avlSet, ...usedVendors]));

    // Hitung score price weighted-average per vendor (tiap bulan pakai harga bulan itu)
    const priceScoreOf = (v) => {
      if (!usePIT) {
        // mode lama: 1 harga
        const costs = [];
        for (const vv of allVendors) { const c = priceMap ? priceMap[vv] : null; if (c != null) costs.push(c); }
        const pmin = costs.length ? Math.min(...costs) : null;
        const pmax = costs.length ? Math.max(...costs) : null;
        const cost = priceMap ? (priceMap[v] ?? null) : null;
        return { score: priceScore(cost, pmin, pmax, master.price), cost };
      }
      // point-in-time: weighted average antar bulan (bobot = trip vendor di bulan itu)
      const a = agg[v];
      let wsum = 0, tw = 0, lastCost = null;
      const monthsForV = a ? Object.keys(a.byMonth).map(Number) : monthsInRoute;
      for (const mo of monthsForV) {
        const pm = priceForMonth(mo);
        if (!pm) continue;
        const costs = [];
        for (const vv of allVendors) { const c = pm[vv]; if (c != null) costs.push(c); }
        const pmin = costs.length ? Math.min(...costs) : null;
        const pmax = costs.length ? Math.max(...costs) : null;
        const cost = pm[v] ?? null;
        if (cost != null) lastCost = cost;
        const s = priceScore(cost, pmin, pmax, master.price);
        const w = a ? (a.byMonth[mo] || 0) : 1;
        wsum += s * w; tw += w;
      }
      return { score: tw > 0 ? wsum / tw : 0, cost: lastCost };
    };

    const rows = allVendors.map(v => {
      const a = agg[v] || { trip: 0, ota: 0, ful: 0, otd: 0 };
      const share = total > 0 ? a.trip / total : 0;
      const otaPct = a.trip > 0 ? a.ota / a.trip : 0;
      const fulPct = a.trip > 0 ? a.ful / a.trip : 0;
      const otdPct = a.trip > 0 ? a.otd / a.trip : 0;
      const isAvl = avlSet.has(v);
      const sAvail = bandScore(share, master.availability);
      const sFul = bandScore(fulPct, master.fulfillment);
      const sOta = bandScore(otaPct, master.ota);
      const sOtd = bandScore(otdPct, master.otd || master.ota);
      const pr = priceScoreOf(v);
      const sPrice = pr.score;
      // skor akhir tertimbang (5 dimensi)
      const w = master.weights;
      const wOtd = (w.otd != null ? w.otd : 0);
      const wtotal = (w.availability + w.fulfillment + w.ota + wOtd + w.price) || 1;
      const finalScore = (
        sAvail * w.availability +
        sFul * w.fulfillment +
        sOta * w.ota +
        sOtd * wOtd +
        sPrice * w.price
      ) / wtotal;
      return {
        vendor: v, isAvl, trip: a.trip, share,
        otaPct, fulPct, otdPct, cost: pr.cost,
        scoreAvail: sAvail, scoreFul: sFul, scoreOta: sOta, scoreOtd: sOtd,
        scorePrice: Math.round(sPrice * 100) / 100,
        finalScore: Math.round(finalScore * 100) / 100
      };
    });
    rows.sort((x, y) => y.finalScore - x.finalScore || y.trip - x.trip);
    return { total, rows };
  }

  /* Bangun seluruh scoring untuk semua rute pada window tertentu.
     Return: { routes: [{origin,tujuan,type,pulau,total,rows}], vendorAgg } */
  function buildAll(data, master, currentMonth, priceData, priceByMonth) {
    const rolling = master.rollingMonths || 3;
    const trips = filterRolling(data.trips, currentMonth, rolling);

    // group by rute
    const byRoute = {};
    const pulauOf = {};
    const modaOf = {};
    for (const t of trips) {
      const k = `${t.o}|${t.t}|${t.ty}`;
      (byRoute[k] = byRoute[k] || []).push(t);
      if (t.p) pulauOf[`${t.t}`] = t.p;
      if (t.md) modaOf[k] = t.md;
    }
    // sertakan juga rute yang ada di AVL walau 0 trip di window (opsional; di sini fokus yang ada trip)
    const routes = [];
    const vendorAgg = {};
    for (const k of Object.keys(byRoute)) {
      const [o, t, ty] = k.split('|');
      const avlV = data.avl[k] || [];
      const pmap = priceData ? (priceData[k] || null) : null;
      const res = scoreRoute(byRoute[k], avlV, master, pmap, priceByMonth, k);
      routes.push({ origin: o, tujuan: t, type: ty, pulau: pulauOf[t] || null, moda: modaOf[k] || null, total: res.total, rows: res.rows });
      // agregasi POV vendor + detail rute per vendor
      for (const r of res.rows) {
        if (r.trip === 0) continue;
        if (!vendorAgg[r.vendor]) vendorAgg[r.vendor] = { vendor: r.vendor, trip: 0, routes: 0, sumFinal: 0, detail: [], tujuanSet: new Set(), modaTrip: {} };
        vendorAgg[r.vendor].trip += r.trip;
        vendorAgg[r.vendor].routes += 1;
        vendorAgg[r.vendor].sumFinal += r.finalScore;
        vendorAgg[r.vendor].tujuanSet.add(t);
        if (modaOf[k]) vendorAgg[r.vendor].modaTrip[modaOf[k]] = (vendorAgg[r.vendor].modaTrip[modaOf[k]] || 0) + r.trip;
        vendorAgg[r.vendor].detail.push({
          origin: o, tujuan: t, type: ty, pulau: pulauOf[t] || null, moda: modaOf[k] || null,
          trip: r.trip, share: r.share, isAvl: r.isAvl,
          scoreAvail: r.scoreAvail, scoreFul: r.scoreFul, scoreOta: r.scoreOta, scoreOtd: r.scoreOtd, scorePrice: r.scorePrice,
          finalScore: r.finalScore
        });
      }
    }
    // rata2 skor akhir per vendor + urutkan detail (trip desc)
    const totalTripAll = trips.length;
    const vendors = Object.values(vendorAgg).map(v => {
      v.detail.sort((a, b) => b.trip - a.trip);
      const { tujuanSet, modaTrip, ...rest } = v;
      const modaKeys = Object.keys(modaTrip);
      // moda dominan (trip terbanyak); tandai kalau vendor jalan >1 moda
      let moda = null, multiModa = false;
      if (modaKeys.length === 1) moda = modaKeys[0];
      else if (modaKeys.length > 1) {
        moda = modaKeys.sort((a, b) => modaTrip[b] - modaTrip[a])[0];
        multiModa = true;
      }
      return { ...rest,
        tujuans: tujuanSet.size,
        moda, multiModa,
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
