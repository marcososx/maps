# Tempo em tempo real — fontes, APIs e cadências

> Camadas de clima da aba **Tempo Real** do mapa (Brusque Discover). Tudo que
> está integrado é **gratuito e sem chave** (exceto onde indicado), com ligação
> direta do navegador. Documento de referência p/ manutenção — se uma fonte cair
> ou mudar o formato, é aqui que se olha.

---

## Resumo das camadas integradas (aba "Tempo Real")

| Chip | O que mostra | Fonte principal | Cadência de atualização |
|---|---|---|---|
| **Indicadores de tempo** | 8 métricas de Brusque (temp, sensação, umidade, chuva, vento+dir, pressão, nuvens, condição) | Open-Meteo | ~5 min (auto) + botão "Atualizar agora" |
| **Nuvens (satélite)** | Imagem de satélite GOES-East (infravermelho) cobrindo toda a região | NASA GIBS | imagem nova a cada ~15 min; latência 15–25 min; overlay auto-atualiza a cada 15 min |
| **Precipitação (radar)** | **Radar real EPAGRI/CIRAM — Lontras (Vale), CAPPI 2Km** com cores dBZ; padrão fixo (sem seletor p/ o usuário) + **legenda inferior** | EPAGRI/CIRAM (+ fallback automático RainViewer) | frame novo a cada ~5 min; overlay atualiza a cada 5 min |
| **Cidades vizinhas (Limites)** | Badge por cidade com condição + chuva agora (mm/h) + acumulado do dia | Open-Meteo | ~5 min (cache localStorage) |

**Regra de sobreposição:** Nuvens e Radar são **exclusivos entre si** — marcar um
desmarca o outro (não sobrepõem imagens). O **polígono tracejado** que aparece com
eles é a **região monitorada** (`brusque_regiao.geojson`).

> **Vento (Windy) foi REMOVIDO** a pedido do Marcos (05/08/2026) — o embed cobria
> o mapa inteiro e não era georreferenciado. Fica registrado o caminho p/ quem
> quiser retomar um dia: Windy **Map Forecast API** (`https://api.windy.com/map-forecast/`)
> entrega wind/temp/pressão como tiles, mas o tier gratuito é "Testing"
> (**500 sessões/dia, só desenvolvimento**).

---

## 1. Open-Meteo — indicadores + chuva nas cidades

- **Tipo:** API REST de previsão/observação (agrega modelos de serviços nacionais)
- **Licença:** gratuita, **sem API key** para uso não-comercial
- **Base:** `https://api.open-meteo.com/v1/forecast`
- **Chamada de Brusque** (indicadores do painel):
  `?latitude=-27.0977&longitude=-48.9172&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,pressure_msl,cloud_cover,weather_code&timezone=America/Sao_Paulo`
- **Chamada por cidade vizinha** (badges, inclui chuva):
  `?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code,precipitation&daily=precipitation_sum&forecast_days=1&timezone=America/Sao_Paulo`
- **Cadência:** dados atuais baseados em modelo 15-min; revalidados no app a cada
  **5 min** (auto) — `localStorage` guarda o último valor fresco.
- **Docs:** https://open-meteo.com/en/docs
- **Riscos:** o `weather_code` é WMO (traduzido no `wxOf` do `index.html`);
  `precipitation_sum` é o acumulado do DIA (00h–agora), não 24h corridas.

## 2. NASA GIBS — nuvens em tempo real (satélite)

- **Tipo:** serviço de tiles de satélite (WMTS RESTful), sem chave
- **Licença:** NASA — uso livre com atribuição ("NASA GIBS · GOES-East")
- **Camada usada:** `GOES-East_ABI_Band13_Clean_Infrared` (canal infravermelho ~2 km/px)
- **Tile (Template/XYZ):**
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_Band13_Clean_Infrared/default/{time}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`
- **Cadência:** GOES-East full disk publica a cada **~15 min**; na GIBS a imagem
  fica disponível com **15–25 min de latência**. O app **descobre o frame mais
  recente por probe** (tenta `agora-15min`, `-30`, `-45`) e revalida a cada 15 min.
- **Limites:** zoom máximo do tile **6** (imagem sinótica; ao dar zoom na cidade
  ela fica "pixelada" de propósito). O overlay só pede tiles dentro da região monitorada.
- **Docs/capacidades:** `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml`
- **Riscos:** se o frame `agora` ainda não saiu, o probe recua até achar o último
  válido (nunca quebra o mapa); resolução é regional, não de rua.

## 3. Radar de precipitação — EPAGRI/CIRAM (principal) + RainViewer (fallback)

### 3.1 EPAGRI/CIRAM — radar de Lontras (Vale) e mosaico SC  ⭐ principal

- **Tipo:** radar meteorológico real do estado de SC (EPAGRI/CIRAM), API pública REST
- **Licença:** uso público (governo estadual), **sem chave**, **CORS liberado** (`*`)
- **Viewer oficial (referência):** `https://ciram.epagri.sc.gov.br/radar/`
- **API (rest):** `https://ciram.epagri.sc.gov.br/radar/rest/radar/`
  - `getUltimasImagens?prod={0-4}&radar={LON|COMP|CHP|ARA}` → JSON com os últimos ~7 frames
  - `getImagem?prod={0-4}&radar={LON}&file={arquivo}` → PNG do frame (860×757, transparente fora do disco)
- **Radares:** `LON` = Lontras (Vale, 240 km — **cobre Brusque e a bacia toda**) · `COMP` = Mosaico SC · `CHP` = Oeste · `ARA` = Sul
- **Produtos (LON):** `0`=CAPPI 2Km · `1`=CAPPI 3Km · `2`=PPI · (COMP: `4`=C-MAX)
- **Extents (lon/lat):** LON `[-51.9327,-29.3957,-46.9908,-25.0438]` · COMP `[-58.0651,-33.8163,-46.4999,-24.7654]`
- **Cadência:** frame novo a cada **~5 min** (nome do arquivo = `AAAAMMDDHHMMSS` UTC); o app re-monta o overlay a cada 5 min + botão "Atualizar".
- **Escala de cor (dBZ, observada no PNG):** `#A5FFFF #6EC8FF #3791FF #005AFF #AAFF00 #80CE00 #559C00 #2B6B00 #003900 #FFFF00 #FFC000`
  (ciano→azul→verde→amarelo→laranja; o **cinza `#C8C8C8` = sem sinal e é descartado** no filtro). Legenda qualitativa fraca→intensa.
- **Como o app usa (padrão único e fixo, sem seletor p/ o usuário):** EPAGRI **Lontras (Vale) · CAPPI 2Km**.
  Baixa o frame mais recente, desenha num canvas e **filtra as cores** (mantém só a escala dBZ,
  descarta o cinza e o fundo), e sobrepõe como **ImageSource** (1 imagem única sobre as
  coordenadas — **sem repetição em tiles**, que era o bug da versão raster). Legenda de cores
  na **barra inferior** com a origem ("Radar EPAGRI/CIRAM · Lontras (Vale) · CAPPI 2Km").
- **Fallback:** se a EPAGRI cair/parar de responder, o app **troca sozinho para RainViewer**
  (composite global) e avisa na legenda ("Radar RainViewer · composite global"); volta a tentar
  a EPAGRI a cada ~15 min.
- **Riscos:** é o display "oficial" (aproximação do disco polar num retângulo); refletividade
  ≠ mm/h exatos; o serviço é governamental e pode cair/parar de atualizar — por isso o fallback.

### 3.2 RainViewer (fallback)

- **API de frames:** `https://api.rainviewer.com/public/weather-maps.json`
  → `host` + `radar.past[]` (2 h em passos de 10 min). **Plano pessoal:** só passado,
  **sem nowcast/projeção futura**; esquema **Universal Blue**; zoom máx do tile **7**.
- **Tile:** `{host}{frame.path}/256/{z}/{x}/{y}/2/0_0.png`
- **Cadência:** frame novo a cada **10 min**; quando selecionado, atualiza a cada 5 min.
- **Riscos:** cobertura do radar no Brasil é **parcial** (rede nacional + satélite); em zoom
  de bairro é grosso. Por isso ficou como fallback e não principal.
- **Docs:** https://www.rainviewer.com/api/weather-maps-api.html

## 4. Região monitorada (polígono imaginário)

- **Arquivo:** `site/brusque_regiao.geojson` — **convex hull** de Brusque + 28
  cidades vizinhas, alargado ~12%, cobrindo toda a bacia do **Itajaí-Mirim
  (nascente em Vidal Ramos / Presidente Nereu, passa por Botuverá, Nova Trento,
  Guabiruba)** — justamente onde a chuva de hoje vira enchente amanhã em Brusque.
- **Limites (usados como `bounds` dos overlays de radar/satélite):**
  `lon -49.5560 .. -48.4015 · lat -27.7017 .. -26.5413`
- **Exibição:** contorno tracejado fino, visível só enquanto uma camada de tempo
  (nuvens/radar) está ligada.

---

## Cotações GOV / Defesa Civil (não usadas no clima do mapa)

| Fonte | Situação | Detalhe |
|---|---|---|
| **INMET** (portal antigo `apitempo.inmet.gov.br`) | ❌ descontinuado | rotas públicas devolvem 404; a nova **API Portal** (`api-portal.inmet.gov.br`) exige **cadastro + token** |
| **CEMADEN** (rede federal) | ✅ já no mapa | alimenta a camada **Monitoramento** via `worker-realtime` (chuva por bairro) |
| **ANA HidroWebService** | ⚠️ substituído (05/08/2026) | nível do rio agora vem da **DC-SC GraphQL** (seção 6); a ANA segue usada para **chuva** via `worker-realtime` (`rio.nivel_m` era o site da DC) |
| **EPAGRI CIRAM (SC)** | ✅ **radar integrado** | radar de **Lontras (Vale)** + mosaico SC, via API REST pública (`ciram.epagri.sc.gov.br/radar/rest/radar/`) — ver seção 3.1 |

## Como o app fala com essas fontes

- **Tudo client-side** (no `index.html`): sem Worker de cache no meio — Open-Meteo,
  GIBS, EPAGRI/CIRAM e RainViewer mandam CORS liberado (`Access-Control-Allow-Origin: *`).
- Exceção: a camada **Monitoramento** (CEMADEN/ANA) continua passando pelo Worker
  `brusque-realtime` (o site da Defesa Civil não manda CORS).
- As chamadas de previsão usam `cache: 'no-store'` e `localStorage` com TTL pra
  não bater na API a cada hover.

---

## 6. Nível dos rios — Defesa Civil de SC (camada "Nível do rio")  ⭐ 05/08/2026

- **Worker:** `brusque-rios` (`worker-rios/`) → `https://brusque-rios.marcososx.workers.dev/rios.json`
- **API:** GraphQL **público** do monitoramento estadual de SC —
  `https://monitoramento.defesacivil.sc.gov.br/graphql` (a mesma fonte que o site da DC de
  Brusque embute via iframe). **Sem chave, sem cadastro, com CORS.**
- **Queries usadas:** `Historic` — série horária por estação (campo `rio_nivel` em metros,
  `rio_variacao`, `chuva_mm`, `ts`). Pegamos a **última leitura com nível** de cada estação
  (o campo resumido `tags_data` às vezes vem nulo).
- ⚠️ **Gotcha do upstream:** o backend da DC-SC **bloqueia queries GraphQL com quebra de linha**
  ("Operação bloqueada") — a query `HISTORIC` no worker está propositalmente em **uma linha**.
- **Cadência do worker:** busca as 3 estações e **cacheia 5 min**.
- **Estações do Itajaí-Mirim (núcleo, todas com dado hoje):**

| Código | Estação | Rio | Município | Coordenadas | Nível (05/08 19h) |
|---|---|---|---|---|---|
| DCSC-00019 | Brusque | Itajaí-Mirim | Brusque | -27.10068, -48.91722 | ✅ 1,10 m |
| DCSC-00029 | Guabiruba | Ribeirão Guabiruba do Norte | Guabiruba | -27.08678, -48.97739 | ✅ 24,76 m |
| DCSC-00018 | Botuverá 1 | Itajaí-Mirim | Botuverá | -27.18619, -49.12059 | ✅ 2,52 m |

- **Histórico da fonte:** a camada nasceu lendo a **ANA HidroWebService REST** (OAuth CPF/senha
  em segredos do Worker) com 5 estações do Itajaí-Mirim — mas a **BRUSQUE (PCD)** teve a
  telemetria parada (~2023) e o webservice legado deixou de devolver dados, deixando a seção de
  rios do site da DC vazia e a leitura da ponte congelada (28/07). Em **05/08/2026** trocamos
  para a **rede da Defesa Civil de SC**, que cobre Brusque + Guabiruba + Botuverá com dados
  horários atuais e sem credencial. As estações ANA/coordenadas da ficha antiga ficam
  documentadas no histórico do `git` do `worker-rios`.

## 7. Pesquisa — fontes nacionais de chuva/rios (Monitoramento)

O usuário perguntou se CEMADEN/CMID/Defesa Civil estadual têm API mais performática que o
scraping do site da DC de Brusque (hoje na camada **Monitoramento**).

| Fonte | Situação | Detalhe |
|---|---|---|
| **ANA HidroWebService (REST)** | ✅ **usada** (rios) e **recomendada** | além dos rios, o inventário traz as **estações de chuva telemétricas** da região (ex. `2748048 BRUSQUE_Azambuja`, `2748043 BRUSQUE_Bateas`, `2748044 BRUSQUE_Centro2`, `2748049 BRUSQUE_Limeira`, `2748050 BRUSQUE_Nova Brasilia`, `2748046 BRUSQUE_Souza Cruz`) com `Chuva_Adotada` — **mesma rede CEMADEN**, acesso direto + CORS via worker, sem depender do site municipal |
| **CEMADEN** (gov.br) | ⚠️ não verificado ao vivo | `alertas2.cemaden.gov.br` não respondeu desta rede; há portais "dados abertos"/Sala de Situação, mas sem API pública documentada testada. Os dados de chuva dele **já chegam espelhados na ANA REST** |
| **Defesa Civil estadual (SC)** | ✅ **usada (rios)** | **GraphQL público** `monitoramento.defesacivil.sc.gov.br/graphql` — é a fonte da camada "Nível do rio" via `worker-rios` (seção 6); leitura horária, sem chave. Fica o registro: **sem API pública documentada** no site `defesacivil.sc.gov.br`, mas o app do monitoramento estadual expõe esse GraphQL |
| **CMID** | ⚠️ rede experimental | as estações CMID (escolas) aparecem no inventário ANA como telemétricas (ex. `2748039 BRUSQUE_Poço Fundo`); não há API pública própria confirmada |

**Recomendação de evolução:** trocar a leitura das estações CEMADEN/CMID da DC (HTML) pela
**ANA REST direta** no mesmo padrão do `worker-rios` — mesma rede, dados iguais, sem scraping,
com cache e CORS. Deixar a DC só como fallback. Implementação fica como próximo passo.

> **05/08/2026:** a camada de **rios** já saiu da ANA para a **DC-SC GraphQL** (ver seção 6)
> e a camada de **voos** usa **Airplanes.live** (seção 8). A recomendação acima vale para a
> parte de **chuva** (CEMADEN/CMID) da camada Monitoramento.

## 8. Voos em tempo real — Airplanes.live ADS-B (camada "Voos (ADS-B)")  ⭐ 05/08/2026

- **Worker:** `brusque-voos` (`worker-voos/`) → `https://brusque-voos.marcososx.workers.dev/voos.json`
- **API:** **Airplanes.live** REST (`https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}`),
  rede comunitária de receptores ADS-B/MLAT. **Sem chave**, rate limit 1 req/s, dados ODbL.
- **Como consulta:** centro em **Brusque** (-27.0977, -48.9172), raio de 60 NM na chamada
  e o Worker **filtra a ≤ 100 km** (haversine) → `voos` ordenados por `dist_km`.
- **Campos por voo:** `icao24`, `callsign`, `lat/lon`, `alt_m` (geométrica), `vel_kmh`,
  `rumo`, `subida_mps` (fpm→m/s), `tipo` (código ICAO, ex.: A320) + `desc` (ex.: "AIRBUS A-320"),
  `categoria` (A1/A3/A5…), `dist_km`, `ultima_atualizacao`.
- **Cadência do worker:** cacheia **2 s** (~0,5 req/s na Airplanes.live); o front re-valida a
  cada **2 s** — posições quase em tempo real.
- **No mapa (dropdown Tempo Real → Voos (ADS-B)):**
  - **Círculo estático de 100 km** ao redor de Brusque (GeoJSON de 128 pontos, tracejado âmbar);
    ao **ativar a camada, a câmera se ajusta automaticamente** ao círculo (fitBounds) e o
    usuário navega/zooms livre. O `maxBounds` do mapa cobre a área do círculo
    (`[[-50.3,-28.4],[-47.5,-25.8]]`) pra não travar o zoom-out.
  - **Trajeto do voo (trail):** linha âmbar sob o avião acumulando as posições recentes de cada
    aeronave (até ~150 pontos ≈ 5 min a 2 s de poll) — mostra por onde cada voo passou.
  - Ícones de avião (silhueta clássica de topo estilo FlightRadar, canvas 48×48) girando pelo
    rumo real (`icon-rotate`), callsign como label.
  - **Hint no padrão das pontes** (`#hint-voos`, card com `hp-row/hp-lbl/hp-val`): Voo, Aeronave,
    Altitude, Velocidade, Rumo, Subida, Posição — aparece ao passar o mouse sobre o avião.
  - **Painel à esquerda** (`voospanel`): contagem + lista separada em **duas seções** —
    "VOOS SOBRE BRUSQUE" (≤ 25 km do centro) e "VOOS NO RAIO DE 100 KM DE BRUSQUE" — com
    títulos em estilo neon (mono + âmbar com glow, inspirado no PizzINT). Cada aeronave:
    ícone do tipo em destaque, callsign, descrição, altitude, velocidade, rumo; **clicar só
    foca o avião no mapa** (sem popup — o hint aparece no hover da camada).
  - **Hierarquia:** ativar Voos **liga o satélite** por baixo e **desmarca todas as outras
    camadas** (Mapa, Tempo Real, Rio, Indicadores, Setores).

### Por que Airplanes.live e não outra (testadas em 05/08/2026)

| Fonte | Resultado com Worker Cloudflare |
|---|---|
| **OpenSky Network** (`/states/all` bbox) | ❌ **HTTP 522** — bloqueia IPs de datacenter (causa conhecida, GitHub) |
| **ADSB.lol** (`/v2/point`) | ❌ **HTTP 429** — rate limit por IP do Worker |
| **adsb.fi** (`/v3/lat/lon/dist`) | ❌ **HTTP 403** para IPs de Workers |
| **Airplanes.live** (`/v2/point`) | ✅ **HTTP 200** — funciona (roda atrás de Cloudflare) |

> **Aviationstack** continua documentada (seção 6 antiga / conversa 05/08): free = 100
> req/**mês**, endpoints de status de voo e catálogos; serve pra consulta pontual, não
> pra tracker contínuo. Para "aviões sobre a região" a Airplanes.live é a escolha gratuita.

