#!/usr/bin/env python3
"""
build_data.py — Regenerate data/trips.json dari file CSV mentah.

Pakai ini tiap bulan saat ada data baru:
    python scripts/build_data.py \
        --history "History_Trip.csv" \
        --avl "Master_AVL.csv" \
        --out data/trips.json

Aturan bisnis yang diterapkan (samakan dengan workbook):
- RPL -> TEL
- BIG MAMA -> WINGBOX
- Surabaya -> Sidoarjo, Jogja -> Yogyakarta, Banyumas -> Purwokerto
- Area -> Pulau mapping
Kolom wajib di history: 'ORIGIN Rev.', 'Tujuan', 'TYPE', 'Vendor',
    'Area', 'Month', 'SLA OTA', 'SLA FULFILL'
"""
import argparse, json
import pandas as pd

REPL = {'SURABAYA': 'SIDOARJO', 'JOGJA': 'YOGYAKARTA', 'BANYUMAS': 'PURWOKERTO'}
PULAU = {'Jawa Timur':'Jawa','Jawa Tengah':'Jawa','Jawa Barat':'Jawa','Jabodetabek':'Jawa','Banten':'Jawa',
         'Sumatera':'Sumatera','Batam':'Sumatera','Bangka Belitung':'Sumatera','Tanjung Pinang':'Sumatera',
         'Kalimantan':'Kalimantan','Sulawesi':'Sulawesi','Bali':'Bali & Nusra','Nusra':'Bali & Nusra',
         'Maluku':'Maluku','MALUKU':'Maluku','Papua':'Papua'}


def build(history_path, avl_path, out_path):
    h = pd.read_csv(history_path)
    m = pd.read_csv(avl_path)

    m['Origin_n'] = m.Origin.str.upper().str.strip()
    m['Dest_n'] = m['Destination I'].str.upper().str.strip()
    m['Type_n'] = m['Type Armada'].str.upper().str.replace('CDD LONG CHASSIS', 'CDDL').str.strip()
    m['Carrier_n'] = m['Carrier ID'].astype(str).str.strip().replace('RPL', 'TEL')

    h['Origin_n'] = h['ORIGIN Rev.'].str.upper().str.strip()
    h['Tujuan_n'] = h.Tujuan.str.upper().str.strip()
    h['Type_n'] = h.TYPE.str.upper().str.strip()
    h['Vendor'] = h.Vendor.replace('RPL', 'TEL')
    h['Type_n'] = h.Type_n.replace('BIG MAMA', 'WINGBOX')
    h['Tujuan_n'] = h.Tujuan_n.replace(REPL)
    m['Dest_n'] = m.Dest_n.replace(REPL)
    h['Pulau'] = h.Area.map(PULAU)

    trips = []
    for r in h.itertuples(index=False):
        trips.append({
            'o': r.Origin_n, 't': r.Tujuan_n, 'ty': r.Type_n, 'v': r.Vendor,
            'p': r.Pulau if pd.notna(r.Pulau) else None,
            'm': int(r.Month) if pd.notna(r.Month) else None,
            'ota': 1 if getattr(r, '_7', None) == 'HIT' or r._asdict().get('SLA OTA') == 'HIT' else 0,
            'ful': 1 if r._asdict().get('SLA FULFILL') == 'HIT' else 0,
        })

    avl = {}
    for r in m.itertuples(index=False):
        if pd.isna(r.Dest_n) or pd.isna(r.Type_n):
            continue
        k = f"{r.Origin_n}|{r.Dest_n}|{r.Type_n}"
        avl.setdefault(k, [])
        if r.Carrier_n not in avl[k] and r.Carrier_n not in ('nan', ''):
            avl[k].append(r.Carrier_n)

    out = {'trips': trips, 'avl': avl,
           'months': sorted(h.Month.dropna().astype(int).unique().tolist())}
    with open(out_path, 'w') as f:
        json.dump(out, f)
    print(f"OK  trips={len(trips)}  routes_avl={len(avl)}  -> {out_path}")


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--history', required=True)
    ap.add_argument('--avl', required=True)
    ap.add_argument('--out', default='data/trips.json')
    a = ap.parse_args()
    build(a.history, a.avl, a.out)
