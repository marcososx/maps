#!/usr/bin/env python3
"""Gera brusque_estacoes.geojson (camada FIXA do chip 'Tempo real') a partir dos
markers Leaflet da página de monitoramento da Defesa Civil de Brusque. As posições
são estáticas (as estações não se movem); os valores ao vivo vêm do worker-realtime.
Fontes: CEMADEN (/estacao/ver/N — 6 estações = bairros) e CMID (/estacao/experimental/N)."""
import re, json, urllib.request

URL = 'https://defesacivil.brusque.sc.gov.br/monitoramento/mapa'
html = urllib.request.urlopen(URL, timeout=30).read().decode('utf-8', 'replace')

def dec(s):
    s = s.replace('\\/', '/')
    return re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), s)

feats = []
for b in re.split(r'(?=L\.marker\(\[)', html):
    m = re.match(r'L\.marker\(\[\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)\s*\]', b)
    if not m:
        continue
    lat, lng = float(m.group(1)), float(m.group(2))
    pm = re.search(r'/estacao\\?/(ver|experimental)\\?/(\d+)\\?">(.*?)<\\?/a>', b)
    tipo = 'CEMADEN' if (pm and pm.group(1) == 'ver') else ('CMID' if pm else '?')
    sid = int(pm.group(2)) if pm else None
    nome = dec(pm.group(3)).strip() if pm else ''
    feats.append({'type': 'Feature',
        'geometry': {'type': 'Point', 'coordinates': [round(lng, 6), round(lat, 6)]},
        'properties': {'nome': nome, 'id': sid, 'fonte': tipo}})

json.dump({'type': 'FeatureCollection', 'features': feats},
          open('out/brusque_estacoes.geojson', 'w'), ensure_ascii=False)
print(f"  estações: {len(feats)} (CEMADEN={sum(1 for f in feats if f['properties']['fonte']=='CEMADEN')})")
