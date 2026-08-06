#!/usr/bin/env bash
# Pipeline reproduzível: 4 Google My Maps da Defesa Civil de Brusque -> camadas
# GeoJSON simplificadas do Brusque Discover. Rode quando os mapas forem atualizados.
#
#   bash fontes-defesacivil/build.sh
#
# Requisitos: curl, python3, npx mapshaper (node). Gera em fontes-defesacivil/{kml,raw}
# e copia os brusque_*.geojson finais para a raiz do projeto.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p kml raw out

# ── MIDs dos My Maps (trocar aqui se o Marcos publicar versões novas) ───────────
KML() { curl -sL "https://www.google.com/maps/d/kml?mid=$1&forcekml=1" -o "kml/$2.kml" \
        -w "  $2: HTTP %{http_code} %{size_download}b\n"; }
echo "== baixando KMLs =="
KML 1D5zBjbOXw4uVlX38O_9IBvELuHs carta_enchente   # Carta Enchente -> Níveis de alagamento
KML 16kFHYQ7F_sTrv24VD1VKsXBitIo ruas_pontes      # Cotas de cheia + Pontes
KML 1kRz3Gsg6xMRe3-Xg685Afg-Q8SSy6aY rotas_seguras # Rotas seguras (hierarquia por cor)
KML 1BfZlXvO2XGgSB17vy2_6HndC1fH21SI6 setores_risco # Setores de risco (CPRM)

echo "== extraindo camadas úteis (folder-aware) =="
( cd kml && ln -sf ../extract.py extract.py && python3 extract.py )
# extract.py grava em raw/ relativo ao cwd (kml/); move p/ ./raw
mv -f kml/raw/* raw/ 2>/dev/null || true

echo "== níveis de alagamento (shapely — union válido; ver niveis_build.py) =="
# NÃO usar mapshaper aqui: o -dissolve quebra a topologia e a simplificação gera
# polígonos inválidos → o MapLibre renderiza a banda VAZIA (13/14 m). O shapely faz
# a união correta dos ladrilhos e simplifica preservando topologia (saída válida).
VENV=".venv-niveis"
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" show shapely >/dev/null 2>&1 || "$VENV/bin/pip" install -q shapely
"$VENV/bin/python" niveis_build.py

echo "== níveis: meios-termos (7.5, 8.5, …) por RELEVO (DEM; ver niveis_interp_dem.py) =="
# Interpola as bandas 7–15 para 17 níveis usando o modelo digital de elevação
# (AWS Terrain Tiles / Mapzen Terrarium, z14). Requer scipy, scikit-image, pillow.
"$VENV/bin/pip" show scipy >/dev/null 2>&1 || "$VENV/bin/pip" install -q scipy scikit-image pillow
"$VENV/bin/python" niveis_interp_dem.py

echo "== demais camadas (mapshaper) =="
npx mapshaper raw/setores.geojson -simplify visvalingam 55% keep-shapes -clean \
  -o format=geojson precision=0.00001 out/brusque_setores_risco.geojson
npx mapshaper raw/rotas.geojson -simplify visvalingam 18% keep-shapes \
  -o format=geojson precision=0.00001 out/brusque_rotas_seguras.geojson
npx mapshaper raw/cotas.geojson -o format=geojson precision=0.00001 out/brusque_cotas.geojson
npx mapshaper raw/pontes.geojson -o format=geojson precision=0.00001 out/brusque_pontes.geojson
npx mapshaper raw/rotas_placas.geojson -o format=geojson precision=0.00001 out/brusque_rotas_placas.geojson

echo "== estações fixas (coords do Leaflet da DC) =="
python3 estacoes.py

echo "== enriquecendo pontes (dados da internet) =="
python3 pontes_dados.py

echo "== publicando na raiz do projeto =="
cp out/brusque_*.geojson ../site/
echo "OK — camadas atualizadas."
