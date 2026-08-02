#!/usr/bin/env python3
"""Constrói brusque_niveis_alagamento.geojson (Carta Enchente 7–15 m).

POR QUE shapely e NÃO mapshaper: os polígonos de cada banda LADRILHAM a mancha de
inundação (centenas de retalhos por cota). O `-dissolve` do mapshaper quebra a
topologia (13/14 m ficavam vazios) e a simplificação visvalingam gera polígonos
auto-intersectantes → MapLibre não triangula → renderiza VAZIO. O shapely faz a
união correta dos ladrilhos e simplifica PRESERVANDO topologia (saída válida).

Entrada: kml/carta_enchente.kml   Saída: out/brusque_niveis_alagamento.geojson
1 feature por banda (MultiPolygon), propriedade `nivel` (7..15). O front mostra
UMA cota por vez (filtro por nivel), então não precisa dissolver entre bandas."""
import xml.etree.ElementTree as ET, re, json, os
from shapely.geometry import Polygon, mapping
from shapely.ops import unary_union
from shapely import make_valid, set_precision

TOL = 0.00015   # ~15 m — suave o bastante p/ escala de cidade, mantém a mancha fiel
NS = '{http://www.opengis.net/kml/2.2}'
def tag(e): return e.tag.replace(NS, '')
def nm(e):
    n = e.find(NS+'name'); return (n.text or '').strip() if n is not None and n.text else ''
def pc(t):
    o = []
    for tok in (t or '').split():
        p = tok.split(',')
        if len(p) >= 2:
            try: o.append((float(p[0]), float(p[1])))
            except ValueError: pass
    return o
def poly_of(poly):
    ob = poly.find(NS+'outerBoundaryIs')
    if ob is None: return None
    lr = ob.find(NS+'LinearRing'); c = lr.find(NS+'coordinates') if lr is not None else None
    if c is None: return None
    ext = pc(c.text)
    if len(ext) < 4: return None
    holes = []
    for ib in poly.findall(NS+'innerBoundaryIs'):
        lr = ib.find(NS+'LinearRing'); cc = lr.find(NS+'coordinates') if lr is not None else None
        if cc is not None:
            h = pc(cc.text)
            if len(h) >= 4: holes.append(h)
    try:
        g = Polygon(ext, holes)
        return make_valid(g) if not g.is_valid else g
    except Exception: return None
def walk(node, path):
    for c in node:
        if tag(c) == 'Folder': yield from walk(c, path + [nm(c)])
        elif tag(c) == 'Placemark': yield c, path

def main():
    root = ET.parse('kml/carta_enchente.kml').getroot()
    doc = root.find(NS+'Document')
    bands = {}
    for pm, path in walk(doc, []):
        m = re.fullmatch(r'(\d+)m', path[-1] if path else '')  # pastas 7m..15m; ignora 'Ruas'
        if not m: continue
        for poly in pm.iter(NS+'Polygon'):
            g = poly_of(poly)
            if g is not None and not g.is_empty:
                bands.setdefault(int(m.group(1)), []).append(g)
    feats = []
    for n in sorted(bands):
        u = unary_union(bands[n]).simplify(TOL, preserve_topology=True)
        u = make_valid(set_precision(u, 0.00001))
        assert u.is_valid, f'banda {n}m inválida'
        feats.append({'type': 'Feature', 'geometry': mapping(u), 'properties': {'nivel': n}})
        print(f"  {n:2d}m área={u.area*1e6:.0f} válido={u.is_valid}")
    os.makedirs('out', exist_ok=True)
    json.dump({'type': 'FeatureCollection', 'features': feats},
              open('out/brusque_niveis_alagamento.geojson', 'w'))

if __name__ == '__main__':
    main()
