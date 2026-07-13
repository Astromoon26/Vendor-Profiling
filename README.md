# CargoScore — Vendor Scoring Dashboard

Dashboard penilaian performa vendor freight, berjalan penuh di browser (static site) dan bisa di-host gratis di **GitHub Pages**. Skoring dihitung dari data trip dengan **rolling window 3 bulan** (bisa diubah), dan **Master Scoring bisa diedit langsung dari dashboard**.

## Cara kerja singkat

- Data trip disimpan sebagai `data/trips.json` (di-generate dari CSV mentah).
- Saat dibuka, dashboard memfilter trip pada window bulan terakhir lalu menghitung 4 skor per vendor per rute: **Availability, Fulfillment, OTA, Price**.
- Ranking rute, POV vendor, dan analisa dominansi dihitung real-time di browser.
- Master Scoring (ambang tiap skor + bobot) diedit di tab **Master Scoring**; perubahan tersimpan di `localStorage` browser. Untuk menjadikannya default tim: **Export JSON** lalu commit ke `data/master-scoring.json`.

## Struktur

```
vendor-scoring-dashboard/
├── index.html              # halaman utama
├── css/style.css           # tema
├── js/
│   ├── scoring.js          # engine perhitungan skor (rolling window, band, price)
│   └── app.js              # UI, state, editor master scoring
├── data/
│   ├── trips.json          # data trip (generated)
│   ├── master-scoring.json # ambang & bobot default
│   └── price.json          # (opsional) harga per rute per vendor
└── scripts/
    └── build_data.py       # regenerate trips.json dari CSV
```

## Menjalankan lokal

Karena memuat file via `fetch`, buka lewat server lokal (bukan double-click):

```bash
cd vendor-scoring-dashboard
python -m http.server 8000
# buka http://localhost:8000
```

## Deploy ke GitHub Pages

1. Buat repo baru di GitHub, push seluruh isi folder ini.
2. Settings → Pages → Source: `main` branch, folder `/ (root)`.
3. Tunggu beberapa menit; dashboard live di `https://<user>.github.io/<repo>/`.

## Update data bulanan

Saat ada data trip baru:

```bash
python scripts/build_data.py --history History_Trip.csv --avl Master_AVL.csv --out data/trips.json
git add data/trips.json && git commit -m "data: update <bulan>" && git push
```

Dashboard otomatis pakai data terbaru. Bulan acuan bisa dipilih di kontrol atas; rolling window default 3 bulan.

## Mengubah Master Scoring

- Buka tab **Master Scoring**, ubah ambang atau bobot, klik **Simpan & Terapkan** (tersimpan di browser ini).
- Untuk berbagi ke seluruh tim: **Export JSON** → commit hasilnya ke `data/master-scoring.json`.
- **Reset ke Default** mengembalikan ke versi di repo.

## Catatan keterbatasan (static site)

- Tidak ada database bersama: perubahan master scoring per-browser sampai di-commit ke repo.
- "Real-time" di sini berarti data terbaru yang sudah di-commit; bukan streaming langsung dari sistem operasional. Untuk itu perlu backend (mis. Supabase/Firebase) — bisa jadi tahap berikutnya.

## Aturan bisnis yang tertanam

Sinkron dengan workbook Excel: RPL→TEL, BIG MAMA→WINGBOX, Surabaya→Sidoarjo, Jogja→Yogyakarta, Banyumas→Purwokerto, dan mapping Area→Pulau. Ubah di `scripts/build_data.py` bila aturan berubah.
test
