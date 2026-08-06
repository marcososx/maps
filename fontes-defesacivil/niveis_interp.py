#!/usr/bin/env python3
"""Interpola MEIOS-TERMOS entre as bandas da Carta Enchente (7m–15m).

As bandas originais são aninhadas (7m ⊆ 8m ⊆ ... ⊆ 15m). Para cada par
adjacente (n, n+1) geramos a banda n+0.5 com uma interpolação geométrica
via CAMPO DE DISTÂNCIA:

  - Grade sobre o bbox da banda maior;
  - Para cada célula na faixa (dentro de B, fora de A):
      dA = distância à borda de A (medida de fora)
      dB = distância à borda de B (medida de dentro)
      fração = dA / (dA + dB)   → 0 na borda de A, 1 na borda de B
  - A banda n+0.5 = A ∪ (células da faixa com fração ≤ 0.5), ou seja, o
    "meio-termo" entre as duas manchas.
  - O contorno é extraído com marching squares e vira MultiPolygon.

Saída: out/brusque_niveis_alagamento.geojson com níveis 7, 7.5, 8, 8.5, …, 15.

Rode com o mesmo venv do niveis_build.py (shapely + scipy + scikit-image).
"""
import json
import numpy as np
from shapely.geometry import shape, Polygon, MultiPolygon
from shapely import make_valid, contains_xy
from scipy import ndimage
from skimage.measure import find_contours

TOL = 0.00002   # simplificação final (~2 m), igual ao niveis_build.py
RES = 0.00005   # grade de interpolação (~5 m) — bom custo/benefício

def interp_band(A, B, t=0.5, res=RES):
    minx, miny, maxx, maxy = B.bounds
    nx = int(np.ceil((maxx - minx) / res)) + 1
    ny = int(np.ceil((maxy - miny) / res)) + 1
    xs = np.linspace(minx, maxx, nx)
    ys = np.linspace(miny, maxy, ny)
    X, Y = np.meshgrid(xs, ys)
    mA = contains_xy(A, X, Y)
    mB = contains_xy(B, X, Y)
    dAout = ndimage.distance_transform_edt(~mA)   # distância à borda de A (de fora)
    dBin  = ndimage.distance_transform_edt(mB)     # distância à borda de B (de dentro)
    faixa = mB & ~mA
    denom = dAout + dBin
    denom[denom == 0] = 1
    frac = dAout / denom
    mask = mA | (faixa & (frac <= t))
    return mask, minx, miny, res

def mask_to_geom(mask, minx, miny, res):
    if mask.sum() == 0:
        return None
    contours = find_contours(mask.astype(float), 0.5)
    polys = []
    for c in contours:
        coords = [(minx + px * res, miny + (mask.shape[0] - 1 - py) * res) for py, px in c]
        if len(coords) >= 4:
            p = Polygon(coords)
            if p.is_valid:
                polys.append(p)
    if not polys:
        return None
    g = MultiPolygon(polys) if len(polys) > 1 else polys[0]
    return make_valid(g)

def main():
    src = 'out/brusque_niveis_alagamento.geojson'
    bands = {}
    for f in json.load(open(src))['features']:
        bands[f['properties']['nivel']] = shape(f['geometry'])

    feats = []
    for n in sorted(bands):
        # banda inteira original entra como está
        g = bands[n].simplify(TOL, preserve_topology=True)
        g = make_valid(g)
        feats.append({'type': 'Feature', 'geometry': __import__('shapely.geometry').geometry.mapping(g),
                      'properties': {'nivel': n}})
        # banda n+0.5 interpolada (se existir n+1)
        if n + 1 in bands:
            mask, minx, miny, res = interp_band(bands[n], bands[n + 1], 0.5)
            mid = mask_to_geom(mask, minx, miny, res)
            if mid is None:
                print(f'  ! {n}+0.5 sem geometria — pulando')
                continue
            mid = mid.simplify(TOL, preserve_topology=True)
            mid = make_valid(mid)
            feats.append({'type': 'Feature', 'geometry': __import__('shapely.geometry').geometry.mapping(mid),
                          'properties': {'nivel': round(n + 0.5, 1)}})
            a = round(mid.area * 1e6 * 91 * 111 / 1e6, 2)
            an = round(bands[n].area * 1e6 * 91 * 111 / 1e6, 2)
            anxt = round(bands[n + 1].area * 1e6 * 91 * 111 / 1e6, 2)
            print(f'  {n}+0.5 → {a} km² (entre {an} e {anxt})')

    feats.sort(key=lambda f: f['properties']['nivel'])
    out = {'type': 'FeatureCollection', 'features': feats}
    json.dump(out, open('out/brusque_niveis_alagamento.geojson', 'w'), ensure_ascii=False)
    print('OK —', len(feats), 'bandas (7, 7.5, 8, 8.5, …, 15)')

if __name__ == '__main__':
    main()
