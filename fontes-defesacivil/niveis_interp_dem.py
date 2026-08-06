#!/usr/bin/env python3
"""Interpola MEIOS-TERMOS entre as bandas da Carta Enchente usando RELEVO.

As bandas originais (7m..15m) são aninhadas. Para cada par (n, n+1) geramos a
banda n+0.5 interpolando pela ELEVAÇÃO do terreno (DEM), porque a água sobe
pelo relevo — não por distância euclidiana:

  1. Baixa o DEM da região do AWS Terrain Tiles (Mapzen Terrarium), z14 (~9 m/px).
  2. Para cada célula na faixa (dentro da banda maior, fora da menor):
       eA = elevação média das k bordas mais próximas da banda menor
       eB = elevação média das k bordas mais próximas da banda maior
       fração = (elevação_da_célula - eA) / (eB - eA)   → 0 perto da banda menor,
                                                          1 perto da maior
  3. A banda n+0.5 = banda menor ∪ (células da faixa com fração ≤ 0.5).
  4. Contorno extraído com marching squares → MultiPolygon válido.

Saída: out/brusque_niveis_alagamento.geojson com 17 bandas
(7, 7.5, 8, 8.5, …, 15).

Requisitos (venv): shapely, numpy, scipy, scikit-image, pillow.
DEM é cacheadoado em .cache-dem/*.npy para build reproduzível.
"""
import json, os, math, io, urllib.request
import numpy as np
from shapely.geometry import shape, Polygon, MultiPolygon
from shapely import make_valid, contains_xy
from shapely.ops import unary_union
from scipy.spatial import cKDTree
from scipy.ndimage import median_filter
from skimage.measure import find_contours
from PIL import Image

TOL = 0.00002   # simplificação das bandas ORIGINAIS (~2 m)
TOL_MID = 0.00009  # simplificação dos MEIOS-TERMOS (~9 m — a fonte do DEM é z14)
Z = 14          # zoom dos tiles (~9 m/px) — bom custo/benefício
K = 5           # vizinhos de borda p/ elevar a elevação local
RADIUS = 0.0035 # raio de busca (~380 m) p/ achar as bordas próximas
CACHE = os.path.join(os.path.dirname(__file__), '.cache-dem')

# ── DEM (AWS Terrain Tiles / Mapzen Terrarium) ────────────────────────────────
def lonlat2tile(lon, lat, z):
    xtile = int((lon + 180) / 360 * (2 ** z))
    ytile = int((1 - math.log(math.tan(math.radians(lat)) + 1/math.cos(math.radians(lat))) / math.pi) / 2 * (2 ** z))
    return xtile, ytile

def tile2lonlat(xtile, ytile, z):
    n = 2 ** z
    lon = xtile / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ytile / n))))
    return lon, lat

def fetch_tile(z, x, y):
    url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
    im = Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=30).read())).convert('RGB')
    a = np.asarray(im).astype(np.float64)
    return (a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256) - 32768.0

def load_dem(bbox):
    os.makedirs(CACHE, exist_ok=True)
    cache = os.path.join(CACHE, f'dem_z{Z}.npy')
    if os.path.exists(cache):
        return np.load(cache)
    W, S, E, N = bbox
    x0, y0 = lonlat2tile(W, N, Z)
    x1, y1 = lonlat2tile(E, S, Z)
    rows = []
    for yt in range(y0, y1 + 1):
        row = []
        for xt in range(x0, x1 + 1):
            row.append(fetch_tile(Z, xt, yt))
        rows.append(np.hstack(row))
    dem = np.vstack(rows)
    np.save(cache, dem)
    return dem

# ── interpolação por elevação ─────────────────────────────────────────────────
def border_pts(g, step=5):
    b = g.boundary
    geoms = b.geoms if hasattr(b, 'geoms') else [b]
    pts = []
    for ln in geoms:
        for x, y in np.array(ln.coords)[::step]:
            pts.append((x, y))
    return pts

def interp_band(A, B, dem, lonW, latN, resX, resY, t=0.5):
    H, Wd = dem.shape
    Xm, Ym = np.meshgrid(lonW + np.arange(Wd) * resX, latN - np.arange(H) * resY)
    mA = contains_xy(A, Xm, Ym)
    mB = contains_xy(B, Xm, Ym)
    faixa = mB & ~mA
    pa, pb = border_pts(A), border_pts(B)
    ka, kb = cKDTree(pa), cKDTree(pb)
    ys, xs = np.where(faixa)
    if len(xs) == 0:
        return mA
    step = max(1, len(xs) // 300000)
    xs, ys = xs[::step], ys[::step]
    coords = np.stack([lonW + xs * resX, latN - ys * resY], axis=1)
    dA, aI = ka.query(coords, k=K, distance_upper_bound=RADIUS)
    dB, bI = kb.query(coords, k=K, distance_upper_bound=RADIUS)
    eA = np.full(len(coords), np.nan)
    eB = np.full(len(coords), np.nan)
    for i in range(K):
        ok = np.isfinite(dA[:, i]) & (aI[:, i] < len(pa))
        if ok.any():
            vals = np.array([dem[min(H-1, max(0, int((latN - pa[j][1]) / resY))),
                                   min(Wd-1, max(0, int((pa[j][0] - lonW) / resX)))] for j in aI[ok, i]])
            eA[ok] = np.where(np.isnan(eA[ok]), vals, np.minimum(eA[ok], vals))
        ok2 = np.isfinite(dB[:, i]) & (bI[:, i] < len(pb))
        if ok2.any():
            vals2 = np.array([dem[min(H-1, max(0, int((latN - pb[j][1]) / resY))),
                                   min(Wd-1, max(0, int((pb[j][0] - lonW) / resX)))] for j in bI[ok2, i]])
            eB[ok2] = np.where(np.isnan(eB[ok2]), vals2, np.minimum(eB[ok2], vals2))
    eA = np.where(np.isnan(eA), np.nanmedian(eA), eA)
    eB = np.where(np.isnan(eB), np.nanmedian(eB), eB)
    E = dem[ys, xs]
    denom = eB - eA
    denom[denom < 0.5] = 0.5
    frac = (E - eA) / denom
    mask = mA.copy()
    mask[ys[frac <= t], xs[frac <= t]] = True
    return mask

def mask_to_geom(mask, lonW, latN, resX, resY):
    if mask.sum() == 0:
        return None
    contours = find_contours(mask.astype(float), 0.5)
    polys = []
    for c in contours:
        coords = [(lonW + px * resX, latN - py * resY) for py, px in c]
        if len(coords) >= 4:
            p = Polygon(coords)
            if p.is_valid:
                polys.append(p)
    if not polys:
        return None
    return make_valid(unary_union(polys))

def main():
    src = 'out/brusque_niveis_alagamento.geojson'
    bands = {f['properties']['nivel']: shape(f['geometry']) for f in json.load(open(src))['features']}
    # bbox geral (máx de todas as bandas) com folga
    bounds = [b.bounds for b in bands.values()]
    W = min(b[0] for b in bounds) - 0.01
    S = min(b[1] for b in bounds) - 0.01
    E = max(b[2] for b in bounds) + 0.01
    N = max(b[3] for b in bounds) + 0.01
    dem = load_dem((W, S, E, N))
    # corrige células inválidas
    bad = dem < -100
    if bad.any():
        dem[bad] = median_filter(dem, size=5)[bad]
    x0, y0 = lonlat2tile(W, N, Z)
    lonW, latN = tile2lonlat(x0, y0, Z)
    # bordas: leste do ÚLTIMO tile e sul do tile abaixo — resolução por pixel real
    lonE, _ = tile2lonlat(x0 + dem.shape[1] // 256, y0, Z)
    _, latS = tile2lonlat(x0, y0 + dem.shape[0] // 256, Z)
    resX = (lonE - lonW) / dem.shape[1]
    resY = (latN - latS) / dem.shape[0]

    feats = []
    from shapely.geometry import mapping
    for n in sorted(bands):
        g = make_valid(bands[n].simplify(TOL, preserve_topology=True))
        feats.append({'type': 'Feature', 'geometry': mapping(g), 'properties': {'nivel': n}})
        if n + 1 in bands:
            mask = interp_band(bands[n], bands[n + 1], dem, lonW, latN, resX, resY, 0.5)
            mid = mask_to_geom(mask, lonW, latN, resX, resY)
            if mid is None:
                print(f'  ! {n}+0.5 sem geometria — pulando')
                continue
            mid = make_valid(mid.simplify(TOL_MID, preserve_topology=True))
            feats.append({'type': 'Feature', 'geometry': mapping(mid),
                          'properties': {'nivel': round(n + 0.5, 1)}})
            a = round(mid.area * 1e6 * 91 * 111 / 1e6, 2)
            an = round(bands[n].area * 1e6 * 91 * 111 / 1e6, 2)
            anxt = round(bands[n + 1].area * 1e6 * 91 * 111 / 1e6, 2)
            print(f'  {n}+0.5 → {a} km² (entre {an} e {anxt})')
    feats.sort(key=lambda f: f['properties']['nivel'])
    json.dump({'type': 'FeatureCollection', 'features': feats},
              open('out/brusque_niveis_alagamento.geojson', 'w'), ensure_ascii=False)
    print('OK —', len(feats), 'bandas (7, 7.5, 8, 8.5, …, 15)')

if __name__ == '__main__':
    main()
