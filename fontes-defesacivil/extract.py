#!/usr/bin/env python3
"""Extrai as camadas úteis dos 4 KMLs da Defesa Civil de Brusque para GeoJSON
cru (bruto). A simplificação/quantização fica com o mapshaper depois.
Descarta as camadas-ruído (arruamento 'Ruas' e 'Limites Brusque') que já
existem no projeto (brusque_estradas / brusque_municipio)."""
import xml.etree.ElementTree as ET
import json, re, sys

NS = '{http://www.opengis.net/kml/2.2}'
def t(e): return e.tag.replace(NS, '')
def child(e, n): return e.find(NS + n)
def name_of(e):
    n = child(e, 'name')
    return (n.text or '').strip() if n is not None and n.text else ''

def parse_coords(text):
    """'lon,lat,alt lon,lat,alt' -> [[lon,lat], ...]"""
    pts = []
    for tok in (text or '').replace('\n', ' ').split():
        parts = tok.split(',')
        if len(parts) >= 2:
            try:
                pts.append([float(parts[0]), float(parts[1])])
            except ValueError:
                pass
    return pts

def poly_coords(poly):
    rings = []
    ob = poly.find(NS + 'outerBoundaryIs')
    if ob is not None:
        lr = ob.find(NS + 'LinearRing')
        if lr is not None:
            rings.append(parse_coords(child(lr, 'coordinates').text))
    for ib in poly.findall(NS + 'innerBoundaryIs'):
        lr = ib.find(NS + 'LinearRing')
        if lr is not None:
            rings.append(parse_coords(child(lr, 'coordinates').text))
    return rings

def geom_of(pm):
    """Retorna geojson geometry (achata MultiGeometry homogênea)."""
    polys, lines, points = [], [], []
    for g in pm.iter():
        tg = t(g)
        if tg == 'Polygon':
            polys.append(poly_coords(g))
        elif tg == 'LineString':
            c = child(g, 'coordinates')
            if c is not None: lines.append(parse_coords(c.text))
        elif tg == 'Point':
            c = child(g, 'coordinates')
            if c is not None:
                p = parse_coords(c.text)
                if p: points.append(p[0])
    if polys:
        if len(polys) == 1:
            return {'type': 'Polygon', 'coordinates': polys[0]}
        return {'type': 'MultiPolygon', 'coordinates': polys}
    if lines:
        if len(lines) == 1:
            return {'type': 'LineString', 'coordinates': lines[0]}
        return {'type': 'MultiLineString', 'coordinates': lines}
    if points:
        if len(points) == 1:
            return {'type': 'Point', 'coordinates': points[0]}
        return {'type': 'MultiPoint', 'coordinates': points}
    return None

def ext_of(pm):
    d = {}
    ed = child(pm, 'ExtendedData')
    if ed is None: return d
    for data in ed.iter(NS + 'Data'):
        k = data.get('name'); v = child(data, 'value')
        d[k] = (v.text or '').strip() if v is not None else ''
    for sd in ed.iter(NS + 'SimpleData'):
        d[sd.get('name')] = (sd.text or '').strip()
    return d

def load_styles(root):
    st = {}
    for s in root.iter(NS + 'Style'):
        sid = s.get('id'); col = None
        for ls in s.iter(NS + 'LineStyle'):
            c = child(ls, 'color')
            if c is not None: col = c.text
        for ps in s.iter(NS + 'PolyStyle'):
            c = child(ps, 'color')
            if c is not None and col is None: col = c.text
        if sid: st[sid] = col
    for sm in root.iter(NS + 'StyleMap'):
        sid = sm.get('id')
        for pair in sm.iter(NS + 'Pair'):
            k = child(pair, 'key'); u = child(pair, 'styleUrl')
            if k is not None and k.text == 'normal' and u is not None:
                st[sid] = st.get(u.text.strip().lstrip('#'))
    return st

def kml_to_hex(kmlcolor):
    """aabbggrr -> #rrggbb"""
    if not kmlcolor or len(kmlcolor) != 8: return None
    bb, gg, rr = kmlcolor[2:4], kmlcolor[4:6], kmlcolor[6:8]
    return ('#' + rr + gg + bb).upper()

def iter_placemarks(root):
    """Gera (placemark, [folder_names_path]) percorrendo as pastas."""
    doc = root.find(NS + 'Document')
    if doc is None: doc = root
    def walk(node, path):
        for c in node:
            if t(c) == 'Folder':
                yield from walk(c, path + [name_of(c)])
            elif t(c) == 'Placemark':
                yield c, path
    yield from walk(doc, [])

def feat(geom, props):
    return {'type': 'Feature', 'geometry': geom, 'properties': props}

def dump(features, path):
    fc = {'type': 'FeatureCollection', 'features': features}
    with open(path, 'w') as f:
        json.dump(fc, f)
    print(f"  -> {path}: {len(features)} features")

def num(s):
    if not s: return None
    m = re.search(r'-?\d+[.,]?\d*', s)
    return float(m.group().replace(',', '.')) if m else None

# ─────────────────────────────────────────────────────────────────────────
OUT = 'raw'
import os; os.makedirs(OUT, exist_ok=True)

# 1) CARTA ENCHENTE -> níveis de alagamento (bandas 7m..15m). Descarta 'Ruas'.
def carta():
    root = ET.parse('carta_enchente.kml').getroot()
    feats = []
    for pm, path in iter_placemarks(root):
        folder = path[-1] if path else ''
        m = re.fullmatch(r'(\d+)m', folder)
        if not m: continue                      # pula 'Ruas' e afins
        g = geom_of(pm)
        if not g or g['type'] not in ('Polygon', 'MultiPolygon'): continue
        feats.append(feat(g, {'nivel': int(m.group(1))}))
    print("carta_enchente:")
    dump(feats, f'{OUT}/niveis.geojson')

# 2) SETORES DE RISCO -> polígonos 2019 + 2011. Descarta Ruas/Limites.
def setores():
    root = ET.parse('setores_risco.kml').getroot()
    feats = []
    for pm, path in iter_placemarks(root):
        folder = path[-1] if path else ''
        if not folder.startswith('Setoriza'): continue   # só 2011 e 2019
        g = geom_of(pm)
        if not g or g['type'] not in ('Polygon', 'MultiPolygon'): continue
        e = ext_of(pm)
        risco = e.get('Risco Principal') or 'Setor 2011'
        props = {
            'setor': name_of(pm),
            'risco': risco,
            'subsidiario': e.get('Risco Subsidiário', ''),
            'bairro': e.get('Bairro', ''),
            'ruas': e.get('Ruas', '') or e.get('Ruas ', ''),
            'n_residencias': e.get('Nº de Residências', ''),
            'n_pessoas': e.get('Nº de pessoas', ''),
        }
        feats.append(feat(g, {k: v for k, v in props.items() if v != ''}))
    print("setores_risco:")
    dump(feats, f'{OUT}/setores.geojson')

# 3) ROTAS SEGURAS -> linhas coloridas (descarta cinza base ffbdbdbd) + placas.
def rotas():
    root = ET.parse('rotas_seguras.kml').getroot()
    styles = load_styles(root)
    GREY = 'ffbdbdbd'
    lines, placas = [], []
    for pm, path in iter_placemarks(root):
        g = geom_of(pm)
        if not g: continue
        su = child(pm, 'styleUrl')
        kmlcol = styles.get(su.text.strip().lstrip('#')) if (su is not None and su.text) else None
        if g['type'] in ('LineString', 'MultiLineString'):
            if not kmlcol or kmlcol.lower() == GREY:
                continue                       # descarta ruas cinza (não-rota)
            lines.append(feat(g, {'nome': name_of(pm), 'cor': kml_to_hex(kmlcol)}))
        elif g['type'] in ('Point', 'MultiPoint'):
            placas.append(feat(g, {'nome': name_of(pm)}))
    print("rotas_seguras:")
    dump(lines, f'{OUT}/rotas.geojson')
    dump(placas, f'{OUT}/rotas_placas.geojson')

# 4) COTAS + PONTES.
def cotas_pontes():
    root = ET.parse('ruas_pontes.kml').getroot()
    cotas, pontes = [], []
    for pm, path in iter_placemarks(root):
        folder = path[-1] if path else ''
        g = geom_of(pm)
        if not g or g['type'] not in ('Point', 'MultiPoint'): continue
        e = ext_of(pm)
        if folder.startswith('Cotas'):
            ano = 2023 if '2023' in folder else 2011
            if ano == 2023:
                # 2023: o nome do placemark é o nível do rio no momento da
                # medição (ex: 7,65 m). "Nível registrado no local" é quanto a
                # água subiu naquela rua (ex: 1,31 m). A cota real de alagamento
                # é a diferença: 7,65 − 1,31 = 6,34 m.
                rio = num(name_of(pm))
                local = num(e.get('Nível registrado no local'))
                calc = round(rio - local, 2) if (rio is not None and local is not None) else None
                # Pontos com resultado impossível (≤ 0) indicam erro de digitação
                # no mapa-fonte → usa o nível do rio (Nome) como cota.
                cota = calc if (calc is not None and calc > 0) else rio
            else:
                cota = num(e.get('cota') or e.get('Nível registrado no local') or name_of(pm))
            cotas.append(feat(g, {
                'cota': cota, 'ano': ano,
                'bairro': e.get('bairro') or e.get('Bairro', ''),
                'rua': e.get('ruas') or e.get('Rua', ''),
            }))
        elif folder == 'Pontes':
            pontes.append(feat(g, {'nome': name_of(pm)}))
    print("ruas_pontes:")
    dump(cotas, f'{OUT}/cotas.geojson')
    dump(pontes, f'{OUT}/pontes.geojson')

carta(); setores(); rotas(); cotas_pontes()
print("OK")
