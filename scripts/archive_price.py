#!/usr/bin/env python3
"""
Arsip Master Price per bulan untuk scoring point-in-time.

Pakai tiap kali lu upload Master Price bulanan:
    python scripts/archive_price.py <file_master_price.csv> 2026-07

- <file>  : CSV/Excel Master Price (kolom: Origin, Tujuan, Type, Vendor, Harga)
- <bulan> : format YYYY-MM (mis. 2026-07)

Hasil:
  data/price/2026-07.json   (arsip bulan itu; vendor ada harga = AVL bulan itu)
  data/price/index.json     (manifest, otomatis diperbarui)

Dashboard akan otomatis pakai arsip bulan yang cocok dengan trip;
bulan tanpa arsip -> fallback ke data/price.json.
"""
import sys, os, json, glob
import pandas as pd

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, 'data')
PRICE_DIR = os.path.join(DATA, 'price')

TUJUAN_ALIAS = {'SURABAYA':'SIDOARJO','JOGJA':'YOGYAKARTA','BANYUMAS':'PURWOKERTO','JAYA PURA':'JAYAPURA'}

def norm_type(x):
    s = str(x).upper().strip()
    if s in ('BIG MAMA','WBOX') or s.startswith('WINGBOX'): return 'WINGBOX'
    if s in ('CDD LONG CHASSIS','CDDLC','CDD LONG'): return 'CDDL'
    if s in ('FUSO BOX','TOWING'): return 'FUSO'
    if s == 'TRAILER 20': return 'CONT-20'
    if s in ('TRAILER 40','CONT-45'): return 'CONT-40'
    if s.startswith('CONT-20'): return 'CONT-20'
    if s.startswith('CONT-40'): return 'CONT-40'
    return s

def norm_origin(x):
    s = str(x).upper().strip()
    if 'CIKANDE' in s: return None         # exclude (konsisten dg trip)
    if 'JABABEKA' in s: return 'JABABEKA'
    if 'CIKUPA' in s: return 'CIKUPA'
    if 'SIDOARJO' in s: return 'SIDOARJO'
    if 'JAKARTA' in s: return 'JAKARTA'
    return s

def main():
    if len(sys.argv) < 3:
        print('Usage: python scripts/archive_price.py <file> <YYYY-MM>'); sys.exit(1)
    src, tag = sys.argv[1], sys.argv[2]
    if not (len(tag) == 7 and tag[4] == '-'):
        print('Bulan harus format YYYY-MM, mis. 2026-07'); sys.exit(1)

    df = pd.read_excel(src) if src.lower().endswith(('.xlsx','.xls')) else pd.read_csv(src)
    # tebak nama kolom (fleksibel)
    cols = {c.lower().strip(): c for c in df.columns}
    def pick(*names):
        for n in names:
            if n in cols: return cols[n]
        raise SystemExit(f'Kolom {names} tidak ketemu. Kolom ada: {list(df.columns)}')
    cO, cT, cTy, cV, cH = pick('origin'), pick('tujuan','destination'), pick('type','type armada','jenisarmada'), pick('carrier','vendor','carrierid'), pick('harga','price','cost')

    origins = [norm_origin(x) for x in df[cO]]
    tujuans = [TUJUAN_ALIAS.get(str(x).upper().strip(), str(x).upper().strip()) for x in df[cT]]
    types = [norm_type(x) for x in df[cTy]]
    vendors = [{'RPL':'TEL'}.get(str(x).upper().strip(), str(x).upper().strip()) for x in df[cV]]
    prices = [pd.to_numeric(str(x).replace(',', ''), errors='coerce') for x in df[cH]]

    out = {}
    for O, T, Ty, V, P in zip(origins, tujuans, types, vendors, prices):
        if O is None or pd.isna(P):
            continue                       # origin di-exclude / harga kosong -> tidak AVL
        out.setdefault(f'{O}|{T}|{Ty}', {})[V] = float(P)

    os.makedirs(PRICE_DIR, exist_ok=True)
    path = os.path.join(PRICE_DIR, f'{tag}.json')
    json.dump(out, open(path, 'w'))
    print(f'Arsip ditulis: data/price/{tag}.json ({len(out)} rute)')

    # update manifest
    tags = sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(PRICE_DIR, '2*.json')))
    json.dump(tags, open(os.path.join(PRICE_DIR, 'index.json'), 'w'))
    print(f'Manifest index.json: {tags}')
    print('\nJangan lupa commit folder data/price/ ke repo.')

if __name__ == '__main__':
    main()
