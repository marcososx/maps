# Fontes — Defesa Civil de Brusque (4 My Maps → camadas do mapa)

Pipeline que transforma os Google My Maps públicos da Defesa Civil em camadas
GeoJSON simplificadas e performáticas do Brusque Discover. **Rode `build.sh` quando
o Marcos publicar versões atualizadas dos mapas** (ele avisou que haverá updates).

```bash
bash build.sh      # baixa, extrai, simplifica e publica na raiz do projeto
```

## Os 4 mapas e o que sai de cada um

| My Map (MID) | Chip no mapa | Saída |
|---|---|---|
| `1D5zBjbOXw4uVlX38O_9IBvELuHs` — Carta Enchente | **Níveis de alagamento** | `brusque_niveis_alagamento.geojson` (bandas 7–15 m, dissolvidas por nível, azul gradiente) |
| `16kFHYQ7F_sTrv24VD1VKsXBitIo` — Cotas + Ruas | **Cotas** + **Pontes** (no dropdown Rio) | `brusque_cotas.geojson` (cheias 2011+2023) · `brusque_pontes.geojson` (9 pontes) |
| `1kRz3Gsg6xMRe3-Xg685Afg-Q8SSy6aY` — Rotas Seguras | **Rotas seguras de enchente** | `brusque_rotas_seguras.geojson` (6 cores de hierarquia, vindas do KML) · `brusque_rotas_placas.geojson` |
| `1BfZlXvO2XGgSB17vy2_6HndC1fH21SI6` — Setorização de Risco | **Setores de risco** | `brusque_setores_risco.geojson` (5 categorias por Risco Principal) |
| (site da DC, Leaflet) | **Tempo real** | `brusque_estacoes.geojson` (6 CEMADEN=bairros + 30 CMID) — ver `../worker-realtime/` |

## Decisões de extração (para não re-derivar)

- **Descartado em todos:** a camada-base de arruamento ("Ruas", ~1.6k linhas) e
  "Limites Brusque" — já existem no projeto (`brusque_estradas`, `brusque_municipio`).
- **Níveis:** cada pasta `Nm` do KML vira a propriedade `nivel`; polígonos dissolvidos
  por nível (9 features). São extensões aninhadas (15 m contém 7 m).
- **Setores:** categorias reais do KML (Setorização CPRM 2019 + 2011) →
  `risco` ∈ {Deslizamento, Enxurrada (Alagamento), Erosão Fluvial, Inundação Gradual
  (Enchente), Setor 2011}. Deslizamento é o grupo grande (visão única, liga/desliga
  tudo). Mantém `bairro`, `ruas`, `n_pessoas` no hover.
- **Rotas:** só as linhas COLORIDAS (a cor = tier da hierarquia); as ruas cinza
  (`#BDBDBD`, base) foram descartadas. Cor preservada em `cor` (#RRGGBB).
- **Cotas:** exibição ainda PROVISÓRIA (o Marcos define depois como mostrar).

Arquivos intermediários ficam em `kml/` (KML cru) e `raw/` (GeoJSON pré-simplify),
ambos regeráveis — não precisam ir pro git.

---

## Meios-termos dos níveis de alagamento (7.5, 8.5, …) — interpolação por RELEVO

> Pesquisa registrada em 06/08/2026. O que está abaixo documenta o PORQUÊ do
> método atual e as alternativas testadas, para não re-derivar no futuro.

### Contexto

As bandas originais da Carta Enchente (7 m, 8 m, … 15 m) são a única fonte oficial.
O Marcos pediu meios-termos (7, **7.5**, 8, **8.5**, … 15) para o slider ficar mais
granular. O problema: **as bandas intermediárias não existem na fonte** — precisam
ser **projetadas**.

### Por que interpolar pelo RELEVO e não por distância?

Duas abordagens foram testadas:

1. **Morphing radial** (raios do centro do rio, meio do caminho de cada raio):
   FALHOU — os MultiPolygon têm reentrâncias e a média radial estourava a área
   (ex.: 7.5 m deu 54 km², quando deveria ficar entre 4.3 e 6.4 km²).

2. **Campo de distância euclidiana** (`niveis_interp.py`): funcionava bem na maioria
   (área entre as bandas, erro 1–8%) **mas quebrava na faixa 12→13** (0.39 km², o
   esperado era ~21) porque a faixa é fina e a grade não resolvia.

3. **Campo de elevação com DEM** (`niveis_interp_dem.py`, método FINAL): a água sobe
   pelo **relevo**, não por distância. Erro 1–12%, e **funciona em todas as 8 faixas**
   (inclusive a 12→13 que quebrava).

### Fonte do DEM

| Fonte | Resolução | Resultado |
|---|---|---|
| Copernicus GLO-30 no AWS Open Data | 30 m | ❌ tiles da América do Sul não estão no bucket (só até E032 para S27) |
| OpenTopography (`SRTMGL3`) | 30 m | ❌ exige API key (401) |
| **AWS Terrain Tiles / Mapzen Terrarium** | **z14 ≈ 9 m/px** (até z15 ≈ 4.7 m/px) | ✅ usado |

- URL do tile: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
- Elevação embutida em PNG RGB (formato **terrarium**):
  `altitude = R*256 + G + B/256 − 32768` (metros).
- Região baixada: bbox das bandas + 0.01° de folga, cacheado em
  `.cache-dem/dem_z14.npy` (52 MB — **fora do git**, regenerável).

### Método (`niveis_interp_dem.py`)

Para cada par de bandas adjacentes (A = banda n, B = banda n+1, com A ⊆ B):

1. **Borda de referência:** amostra a elevação do DEM ao longo das bordas de A e de B
   (`border_pts`, um ponto a cada ~5 vértices).
2. **Para cada célula da faixa** (dentro de B, fora de A), pega a elevação das
   **k=5 bordas mais próximas** de cada banda (kD-Tree, raio ~380 m):
   - `eA` = elevação local da banda menor; `eB` = elevação local da banda maior.
3. **Fração:** `f = (elev_cell − eA) / (eB − eA)` → 0 perto de A, 1 perto de B.
4. **Banda n+0.5** = A ∪ {células da faixa com `f ≤ 0.5`}.
5. Contorno extraído com **marching squares** (`skimage.find_contours`) e união
   (`shapely.unary_union`) → MultiPolygon válido.

Saída: `out/brusque_niveis_alagamento.geojson` com **17 bandas**
(7, 7.5, 8, 8.5, … 15). Áreas intermediárias ficam entre as bandas vizinhas
(erro médio ~5%, o 12+0.5 que antes quebrava agora funciona).

### Como rodar

```bash
# o build base (9 bandas) precisa rodar primeiro
.venv-niveis/bin/python niveis_build.py
# depois interpola os meios-termos (baixa DEM no 1º run, cacheia depois)
.venv-niveis/bin/python niveis_interp_dem.py
cp out/brusque_niveis_alagamento.geojson ../site/
```

Requisitos do venv `.venv-niveis/`: `shapely`, `numpy`, `scipy`, `scikit-image`,
`pillow` (instalar com `.venv-niveis/bin/pip install ...`).

### Tunagem

- `t` (fração de corte, hoje `0.5`) → desloca o meio-termo para perto de A (`t→0`)
  ou de B (`t→1`).
- `Z` (zoom do DEM, hoje `14` ≈ 9 m/px) → `15` ≈ 4.7 m/px (mais preciso, mais lento
  e arquivo maior).
- `TOL_MID` (simplificação do meio-termo, hoje `0.00009` ≈ 9 m — mesma ordem do DEM)
  controla o peso do arquivo final (~3.7 MB para 17 bandas).

