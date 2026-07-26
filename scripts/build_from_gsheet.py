#!/usr/bin/env python3
"""
Build trips.json & supply.json dari Google Sheets (History_Trip).
Jalankan tiap bulan setelah data GSheet diperbarui:
    python scripts/build_from_gsheet.py
Lalu commit data/trips.json & data/supply.json ke repo.

Catatan: Supply-Demand (demand CBM) TIDAK ikut di sini — itu di-push manual tiap bulan.
"""
import urllib.request, pandas as pd, io, json, os, sys

SHEET_ID = '1K3YnDFWXcg5SqtoRu-lhLTDbg0ip_cNMpfc7wzlBi1k'
CSV_URL = f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv'
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, 'data')

# kapasitas armada (max CBM) untuk supply
CAP = {'WINGBOX':42,'CONT-40':50,'TRAILER':42,'FUSO':34,'CONT-20':25,'CDDL':16,'CDD':13,'CDEL':11,
       'CONT-45':64,'CDE':4,'MINI VAN BOX':3,'TRONTON':50,'BOX':13,'LOSBAK':13}
LOAD = 0.85

def norm_origin(x):
    s = str(x).upper().strip()
    if 'IND JABABEKA' in s: return None
    if 'CIKANDE' in s: return None
    if 'JABABEKA' in s: return 'JABABEKA'
    if 'CIKUPA' in s: return 'CIKUPA'
    if 'SIDOARJO' in s: return 'SIDOARJO'
    if 'JAKARTA' in s: return 'JAKARTA'
    return s

def norm_type(x):
    s = str(x).upper().strip()
    if s in ('BIG MAMA','WBOX') or s.startswith('WINGBOX'): return 'WINGBOX'
    if s in ('CDD LONG CHASSIS','CDDLC','CDD LONG'): return 'CDDL'
    if s.startswith('CONT-20'): return 'CONT-20'
    if s.startswith('CONT-40'): return 'CONT-40'
    return s

TUJUAN_ALIAS = {'SURABAYA':'SIDOARJO','JOGJA':'YOGYAKARTA','BANYUMAS':'PURWOKERTO','JAYA PURA':'JAYAPURA'}

def main():
    print('Fetching Google Sheets...')
    req = urllib.request.Request(CSV_URL, headers={'User-Agent':'Mozilla/5.0'})
    raw = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
    gs = pd.read_csv(io.StringIO(raw))
    print(f'  raw: {len(gs)} baris')

    gs = gs.dropna(subset=['Tujuan','Vendor'])
    gs['Origin'] = gs['Supply site'].map(norm_origin)
    gs = gs[gs.Origin.notna()]
    gs['Tujuan'] = gs.Tujuan.astype(str).str.upper().str.strip().replace(TUJUAN_ALIAS)
    gs['Type'] = gs.TYPE.map(norm_type)
    gs['Vendor'] = gs.Vendor.astype(str).str.upper().str.strip().replace({'RPL':'TEL'})
    gs['dt'] = pd.to_datetime(gs['Delivery Date'], format='%d %b %Y', errors='coerce')
    gs = gs.dropna(subset=['dt'])
    gs['M'] = gs.dt.dt.month
    gs['W'] = gs.dt.dt.isocalendar().week.astype(int)

    pmap = json.load(open(os.path.join(DATA, 'pulau-map.json')))
    gs['Pulau'] = gs.Tujuan.map(pmap).fillna('')

    gs['ota'] = (gs['SLA OTA'].astype(str).str.upper().str.strip() == 'HIT').astype(int)
    gs['ful'] = (gs['SLA FULFILL'].astype(str).str.upper().str.strip() == 'HIT').astype(int)
    gs['otd'] = (gs['SLA OTD'].astype(str).str.upper().str.strip() == 'HIT').astype(int)

    months = sorted(gs.M.unique().astype(int).tolist())
    pulauList = sorted([p for p in gs.Pulau.unique() if p])
    print(f'  final: {len(gs)} trip | bulan {months} | OTA {gs.ota.mean():.1%} FUL {gs.ful.mean():.1%} OTD {gs.otd.mean():.1%}')

    # ---- trips.json ----
    trips = [{'o':r.Origin,'t':r.Tujuan,'ty':r.Type,'v':r.Vendor,'p':r.Pulau,
              'm':int(r.M),'ota':int(r.ota),'ful':int(r.ful),'otd':int(r.otd)}
             for r in gs.itertuples()]
    # pertahankan avl & scoreOrder dari file lama kalau ada
    old = {}
    tp = os.path.join(DATA, 'trips.json')
    if os.path.exists(tp):
        old = json.load(open(tp))
    out = {'trips': trips, 'avl': old.get('avl', {}), 'scoreOrder': old.get('scoreOrder', {}),
           'months': months, 'pulauList': pulauList}
    json.dump(out, open(tp, 'w'))
    print(f'  wrote trips.json ({len(trips)} trips)')

    # ---- supply.json (hanya SLA FULFILL = HIT) ----
    sup = gs[gs.ful == 1].copy()
    sup['cap'] = sup.Type.map(CAP).fillna(0) * LOAD
    srows = [{'t':r.Tujuan,'o':r.Origin,'ty':r.Type,'v':r.Vendor,'w':int(r.W),'m':int(r.M),
              'cap':round(r.cap,3),'unit':1.0,'alloc':0}
             for r in sup.itertuples()]
    contOnly = {}
    CONT_PULAU = {'Kalimantan','Sulawesi','Maluku','Papua'}
    for t in gs.Tujuan.unique():
        p = pmap.get(t,'')
        contOnly[t] = 1 if (p in CONT_PULAU or t == 'KUPANG') else 0
    json.dump({'supply': srows, 'months': months, 'pulau': pmap, 'contOnly': contOnly},
              open(os.path.join(DATA, 'supply.json'), 'w'))
    print(f'  wrote supply.json ({len(srows)} records)')
    print('DONE.')

if __name__ == '__main__':
    main()
