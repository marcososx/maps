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
