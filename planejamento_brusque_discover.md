# Planejamento de Projeto: Dashboard Brusque Discover

## 1. Visão Geral do Projeto
O **Brusque Discover Dashboard** é uma central de monitoramento em tempo real (Command Center / War Room) voltada para a cidade de Brusque e região. O objetivo principal é consolidar informações críticas da Defesa Civil, status do sistema elétrico (CELESC), condições de trânsito, cotas de enchente por rua, notícias/alertas de crise imediatos e transmissões ao vivo.

A interface adota um estilo inspiracional no *Pizza Index* (Dark Mode Operacional), focado em alta densidade de informação, visualização limpa, moderna e responsiva.

---

## 2. Diretrizes de Design & UI/UX

### 2.1 Estilo Visual (Dark Mode Operacional)
- **Tema:** Dark Slate High-Tech (fundo escuro de alto contraste para operações contínuas).
- **Paleta de Cores:**
  - **Fundo Primário:** `#0B0E14` (Dark Slate / Quase Preto)
  - **Cards e Painéis:** `#151921` com bordas finas `#232D3F`
  - **Indicadores de Status:**
    - *Normal / Seguro:* `#00E676` (Verde Neon discreto)
    - *Atenção / Alerta:* `#FFB300` (Amarelo Âmbar)
    - *Crítico / Emergência:* `#FF3D00` (Vermelho Vivo)
    - *Informação / Dados:* `#00B0FF` (Azul Elétrico)
- **Tipografia:**
  - **Interface Geral:** `Inter` ou `System UI` (Leitura limpa e legível)
  - **Métricas, Cotas e Timestamps:** `JetBrains Mono` ou `Space Mono` (Estilo terminal/dashboard de alta precisão)

### 2.2 Layout da Interface (Grid Command Center)
- **Desktop Grid (3 Colunas):**
  - **Coluna Esquerda (25%):** Módulo CELESC (Energia) + Live Feed estilo Twitter (Mensagens de Crise) + Câmeras / Vídeos Ao Vivo Embedded.
  - **Painel Central (50%):** Mapa Interativo com seleção de camadas, busca avançada de cotas por rua e mapa de calor de alertas.
  - **Coluna Direita (25%):** Telemetria dos Bairros (Estações da Defesa Civil, nível do rio Itajaí-Mirim, acumulado de chuva e temperatura).
- **Mobile (Modo Modular):**
  - Navegação por abas inferiores (`[Mapa]`, `[Alertas/Feed]`, `[Energia]`, `[Câmeras/Cotas]`).

---

## 3. Módulos Funcionais do Dashboard

### Módulo A: Mapa Interativo de Brusque & Telemetria em Tempo Real
1. **Camada de Bairros (Polígonos GeoJSON):**
   - Mapeamento vetorial dos bairros de Brusque (Centro, Maluche, Santa Rita, Guarani, Dom Joaquim, Steffen, Rio Branco, Primeiro de Maio, etc.).
   - Color-coding nos bairros conforme o nível de risco acumulado (Chuva forte, risco de alagamento ou deslizamento).
2. **Seletor de Camadas do Mapa (Map Tile Switcher):**
   - *Modo Dark (Padrão):* CartoDB Dark Matter / Mapbox Dark.
   - *Modo Satélite:* Esri World Imagery / Google Satellite.
   - *Modo Trânsito:* Camada em tempo real de tráfego veicular via Google Maps API ou OpenStreetMap / Here Traffic.
3. **Indicadores de Bairros & Estações da Defesa Civil:**
   - Temperatura local (°C) e umidade relativa do ar.
   - Pluviosidade (mm/h e acumulado de 12h / 24h).
   - Nível atual do Rio Itajaí-Mirim em metros (atualizado via estações automáticas da DC).
4. **Sistema de Pesquisa de Cotas de Enchente por Rua:**
   - **Busca por Autocomplete:** Integração com a base de dados de cotas de ruas da Defesa Civil de Brusque.
   - **Calculadora de Risco em Tempo Real:** 
     - Exemplo: Ao buscar *Rua Marcílio Dias*, a cota cadastrada é exibida (ex: *7.50m*).
     - Se o nível do rio estiver em *6.20m*, o sistema exibe dinamicamente: *"Margem de segurança: 1.30m restante"*.
   - **Simulador de Transbordamento:** Slider ajustável de nível de água (ex: 5.00m a 15.00m) para destacar visualmente no mapa quais áreas/ruas são afetadas progressivamente.

---

### Módulo B: Monitoramento de Energia (CELESC)
1. **Visão Geral e Regional:**
   - Resumo numérico e gráfico de Unidades Consumidoras (UCs) sem energia no município de Brusque e cidades da região (Guabiruba, Botuverá, Nova Trento, Gaspar).
2. **Classificação das Ocorrências:**
   - Distinção clara entre desligamentos **Acidentais** (tempestades, vendavais, acidentes) e **Programados** (manutenções na rede).
3. **Automação de Atualização:**
   - Script automatizado / Scraper consultando periodicamente o portal oficial da CELESC (Sistema SIMO / `conecte.celesc.com.br`).

---

### Módulo C: Live Feed de Notícias & Crise (Estilo Twitter)
1. **Visualização do Feed Público:**
   - Timeline cronológica com atualizações rápidas, curtas e objetivas.
   - Badges visuais por categoria: `[DEFESA CIVIL]`, `[TRÂNSITO]`, `[CELESC]`, `[ALERTAS RIO]`, `[METEOROLOGIA]`.
   - Sinalizador visual de status "AO VIVO" pulsante.
2. **Painel do Administrador (Gestão do Feed):**
   - Acesso seguro protegido por autenticação (JWT / Auth).
   - **Inclusão Rápida:** Campo de texto (limite de 280 caracteres) + seletor de tag e nível de urgência (Normal / Alerta / Emergência).
   - **Ações de Gestão:** Opção de excluir mensagens, editar e fixar comunicados de alta prioridade no topo.
   - **Transmissão Instantânea:** Envio em tempo real para os leitores conectados via Server-Sent Events (SSE) ou WebSockets.

---

### Módulo D: Transmissões ao Vivo Embedded (Live Videos)
1. **Painel de Vídeos Embarcados:**
   - Área dedicada para incorporação de players de vídeo (YouTube Live, HLS, iFrame de câmeras públicas ou transmissões locais).
2. **Funcionalidades do Módulo de Vídeo:**
   - Grade adaptável (1x1, 2x2 ou focado em tela cheia).
   - Chaveador rápido de fontes de vídeo no painel administrador ou menu de seleção do usuário.
   - Modo "Mini Player" (Picture-in-Picture) para continuar navegando no mapa enquanto assiste à transmissão.

---

## 4. Arquitetura Técnica e Tecnologias Sugeridas

```
+-------------------------------------------------------------------------------+
|                                  FRONTEND                                     |
|  - Framework: Next.js 14+ (App Router, React 18)                              |
|  - Estilização: Tailwind CSS + Shadcn UI (Componentes de alta fidelidade)     |
|  - Mapeamento: Leaflet.js / MapLibre GL (Renderização GeoJSON)                 |
|  - Estado & Tempo Real: Zustand / Socket.io-client / EventSource (SSE)        |
|  - Ícones & Fontes: Lucide Icons + Google Fonts (Inter / JetBrains Mono)     |
+-------------------------------------------------------------------------------+
                                       |
                                       v
+-------------------------------------------------------------------------------+
|                                  BACKEND                                      |
|  - Server: Node.js (Next.js API Routes / Express) ou Python (FastAPI)         |
|  - Autenticação: NextAuth.js / JWT para o Painel Admin                        |
|  - Realtime Engine: Server-Sent Events (SSE) ou WebSockets (Socket.io)       |
+-------------------------------------------------------------------------------+
         |                             |                             |
         v                             v                             v
+------------------+         +-------------------+         +--------------------+
| Scraper CELESC   |         | Scraper Defesa    |         | Banco de Dados     |
| - Cron Job (5m)  |         | Civil / Estações  |         | - PostgreSQL       |
| - Parse do SIMO  |         | - Telemetria Rio  |         |   + PostGIS        |
+------------------+         +-------------------+         | - Tabela Cotas/Ruas|
                                                           | - Mensagens Admin  |
                                                           +--------------------+
```

---

## 5. Estrutura de Banco de Dados (Esquema Simplificado)

1. **Tabela `ruas_cotas`:**
   - `id`: UUID (PK)
   - `nome_rua`: VARCHAR
   - `bairro`: VARCHAR
   - `cota_metros`: DECIMAL(4,2)
   - `geom`: GEOMETRY (Point/LineString para renderização no mapa)

2. **Tabela `feed_mensagens`:**
   - `id`: UUID (PK)
   - `conteudo`: VARCHAR(280)
   - `categoria`: ENUM ('DEFESA_CIVIL', 'TRANSITO', 'CELESC', 'RIO', 'GERAL')
   - `prioridade`: ENUM ('NORMAL', 'ALERTA', 'EMERGENCIA')
   - `fixado`: BOOLEAN
   - `criado_em`: TIMESTAMP
   - `autor_id`: UUID (FK)

3. **Tabela `video_streams`:**
   - `id`: UUID (PK)
   - `titulo`: VARCHAR
   - `embed_url`: TEXT
   - `ativo`: BOOLEAN

---

## 6. Roteiro de Execução / Próximos Passos
1. **Fase 1:** Setup do projeto Next.js + Tailwind CSS + configuração da identidade visual Dark Mode.
2. **Fase 2:** Implementação do Mapa com Leaflet/MapLibre, carregamento dos bairros e busca autocomplete de cotas.
3. **Fase 3:** Construção dos Scrapers de dados (CELESC e Defesa Civil de Brusque).
4. **Fase 4:** Desenvolvimento do Feed estilo Twitter e Painel Administrador com login e SSE/WebSockets.
5. **Fase 5:** Integração do Módulo de Vídeo Embedded ao Vivo.
6. **Fase 6:** Testes de carga, responsividade mobile e publicação inicial.

---

## 7. Progresso realizado (atualização 05/08/2026)

> Estado atual do mapa: **arquitetura real** = site estático (`site/index.html`, MapLibre GL)
> servido pelo Worker `brusque-maps` + vários Workers de dados. O plano acima (Next.js/Postgres)
> foi substituído pela arquitetura leve de Workers + GeoJSON. Tudo publicado e verificado em produção.

### 7.1 Camadas de clima (dropdown "Tempo Real")
- **Nuvens (satélite)** — NASA GIBS GOES-East (infravermelho, ~2 km/px), tiles WMTS com probe
  de tempo (latência 15–25 min), auto-atualiza a cada 15 min. `worker` não — direto do navegador.
- **Precipitação (radar)** — **EPAGRI/CIRAM Lontras (Vale)** como padrão único (API REST pública,
  cores dBZ reais, frame a cada ~5 min), renderizada como **1 imagem única (ImageSource)**
  — corrigido bug de "imagem repetindo" (era fonte raster). **Fallback silencioso** p/ RainViewer
  se a EPAGRI cair. Legenda de cores na barra inferior.
- **Vento (Windy)** — REMOVIDO (embed cobria o mapa; não georreferenciado).

### 7.2 Indicadores (dropdown novo "Indicadores") — painéis à ESQUERDA
- **Indicadores de tempo** — 8 métricas de Brusque via Open-Meteo (sem chave).
- **Índice ENSO (Niño 3.4)** — NOAA CPC via worker `brusque-clima`; gauge La Niña→Neutro→El Niño
  com marcador (hoje **+2,0 °C = El Niño muito forte**).
- **Chuva acumulada (30 dias)** — Open-Meteo archive; gauge seco→muito chuvosa.
- **Umidade do solo** — Open-Meteo; gauge seco→encharcado (superfície + 7–28 cm).
- Todos com **escala de cores + marcador de posição atual**.

### 7.3 Nível do rio — dropdown "Rio Itajaí Mirim"
- Worker **`brusque-rios`** — **Defesa Civil de Santa Catarina (SDC-SC)** via GraphQL público
  (`monitoramento.defesacivil.sc.gov.br/graphql`), **sem credencial**. Endpoint: `/rios.json`
  (cache 5 min, CORS).
- Camada **"Nível do rio"** com as **3 estações fluviométricas** ativas da bacia do Itajaí-Mirim:
  **Brusque** (Itajaí-Mirim, -27.10068/-48.91722), **Guabiruba** (Ribeirão Guabiruba do Norte,
  -27.08678/-48.97739) e **Botuverá 1** (Itajaí-Mirim, -27.18619/-49.12059). Todas com dado em
  tempo real (nível + variação em cm + chuva + horário da coleta); sem dado → marcador cinza.
- **Fonte anterior ANA HidroWebService abandonada** (telemetria da BRUSQUE PCD parada ~2023 e
  webservice legado sem devolver dados) — o site da DC de Brusque mantinha a seção de rios vazia
  e a leitura da ponte (ANA, 28/07) congelada. A troca para a DC-SC resolveu com dados atuais.

### 7.4 Região monitorada
- `site/brusque_regiao.geojson` — convex hull de Brusque + 28 cidades vizinhas (cobre a bacia da
  nascente). Usado como limites dos overlays de clima + contorno tracejado.

### 7.4b Voos em tempo real — dropdown "Tempo Real" (05/08/2026)
- Worker **`brusque-voos`** — **Airplanes.live** ADS-B (REST, sem chave, 1 req/s), consulta por
  ponto central (**Brusque** -27.0977/-48.9172) + raio e **filtro ≤ 100 km** (haversine).
  Endpoint: `/voos.json` (cache 2 min, CORS), voos **ordenados por distância**.
- Camada **"Voos (ADS-B)"** no dropdown Tempo Real:
  - **Círculo estático de 100 km** ao redor de Brusque (GeoJSON de 128 pontos, tracejado âmbar);
    ao **ativar a camada a câmera se ajusta ao círculo** (fitBounds) e o usuário navega/zooms
    livre. `maxBounds` do mapa cobre ~2x o círculo (`[[-51.7,-29.5],[-46.1,-24.7]]`).
  - **Trajeto do voo (trail):** linha âmbar acumulando as posições recentes de cada aeronave
    (até ~150 pontos ≈ 5 min; mínimo de deslocamento 0.001°).
  - Aviões **no ar** com **ícone idêntico ao Airplanes.live** (silhueta 'unknown' do tar1090
    desenhada em canvas via `Path2D`) girando pelo rumo real (`icon-rotate`), callsign como
    label; **hint no padrão das pontes** (`#hint-voos`) no hover. Busca com `cache:'no-store'`
    (nenhuma resposta antiga).
  - **Hint do voo enriquecido:** rota `ORIGEM ───► DESTINO` em neon (via adsbdb, siglas IATA +
    municípios), **logo da companhia** (static.airplanes.live/airline_banners/{icao}.png),
    altitude/velocidade em **notação dupla** (`38.016 ft — 11.587 m`, `520 kt — 963 km/h`),
    aeronave/rumo/subida/posição. Campos ausentes não aparecem. **Clique não abre popup.**
  - **Worker** enriquece rota por callsign via `api.adsbdb.com/v0/callsign/{cs}` com cache de
    1 h no worker (CORS `*`, sem rate limit visível).
  - **Painel à esquerda** (`voospanel`): contagem + lista em **duas seções** — "VOOS SOBRE
    BRUSQUE" (≤ 25 km) e "VOOS NO RAIO DE 100 KM DE BRUSQUE" — títulos neon estilo PizzINT
    (mono + âmbar com glow). Cada aeronave: ícone do tipo em destaque, callsign, descrição,
    altitude, velocidade, rumo; **clicar só foca o avião no mapa** (sem popup/hint).
  - **Hierarquia:** ativar Voos **liga o satélite** por baixo e **desmarca todas as outras
    camadas** (Mapa, Tempo Real, Rio, Indicadores, Setores). Front checa a cada **1 s**;
    worker cacheia **2 s** (limite da fonte: Airplanes.live ~1 req/2 s, acima dá 429).
    Ícone do avião em `icon-size` 0.8.
- **Por que Airplanes.live:** OpenSky (522), ADSB.lol (429) e adsb.fi (403) **bloqueiam IPs de
  Workers Cloudflare** — testados em 05/08. Airplanes.live roda atrás de Cloudflare e funciona.

### 7.5 Workers e endpoints (produção)

| Worker | Pasta | URL | Observação |
|---|---|---|---|
| brusque-maps (site) | `site/` + `wrangler.jsonc` | `brusque-maps.marcososx.workers.dev` | assets estáticos (`index.html` + geojsons) |
| brusque-realtime | `worker-realtime/` | `.../estacoes.json`, `.../abrigos.json` | Defesa Civil Brusque (CEMADEN/CMID/ANA) |
| brusque-trafego | `worker-trafego/` | `.../traffic/{z}/{x}/{y}.png` | trânsito TomTom |
| **brusque-rios** | `worker-rios/` | `.../rios.json` | **Defesa Civil SC** (GraphQL público, sem segredo) — níveis de rio ao vivo |
| **brusque-voos** | `worker-voos/` | `.../voos.json` | **Airplanes.live ADS-B** (sem chave) — voos em tempo real na região |
| **brusque-clima** | `worker-clima/` | `.../enso.json` | ENSO Niño 3.4 (NOAA CPC) |
| brusque-crise / -admin | `worker-crise/`, `worker-crise-admin/` | — | feed de crise |

### 7.6 Rodar em outro lugar (checklist de portabilidade)
1. **Ferramentas:** `node`, `npm`, `npx wrangler` (Cloudflare), token `CLOUDFLARE_API_TOKEN` +
   `CLOUDFLARE_ACCOUNT_ID` (`718f3b4495efa95bff3de18cd58c1e57`).
2. **Segredos** (por Worker, via `wrangler secret bulk`):
   - ~~`brusque-rios`: `ANA_CPF` e `ANA_SENHA`~~ → **removidos** — o `brusque-rios` agora usa o
     GraphQL público da DC-SC e **não precisa de credencial**. (Nenhum outro worker tem segredo.)
3. **Deploy:** em cada pasta de worker: `npx wrangler deploy` (ou `npm run deploy`).
   Site: rodar `wrangler deploy` na raiz (assets → `./site`).
4. **Front:** as URLs dos workers estão no `site/index.html` (constantes `REALTIME_URL`,
   `ABRIGOS_URL`, `RIOS_URL`, `VOOS_URL`, `ENSO_URL`, `trafego`). Se mudar o subdomínio dos
   workers, ajustar lá.
5. **Sem chave para o clima:** Open-Meteo, GIBS (NASA), EPAGRI/CIRAM, RainViewer, Airplanes.live
   e NOAA via worker — todos gratuitos/sem API key (o NOAA não tem CORS → passa pelo `brusque-clima`).

### 7.7 Pendências conhecidas
- ~~Telemetria da BRUSQUE (PCD) parada~~ → **resolvido (05/08/2026):** camada "Nível do rio"
  agora lê a rede da Defesa Civil de SC (Brusque 1,10 m, Guabiruba 24,76 m, Botuverá 2,52 m —
  última leitura horária, atualizada). O worker `brusque-rios` não depende mais da ANA.
- ~~Mostrar aviões sobre a região~~ → **feito (05/08/2026):** camada **"Voos (ADS-B)"** com
  Airplanes.live via `worker-voos`. Origem/país do voo não vem na API (categoria ICAO sim).
- Escala da **Chuva acumulada** vs normal climatológica (contexto El Niño) — sugestão em aberto.
- Índice ENSO usa Niño 3.4 semanal (não o ONI de 3 meses); OK para o gauge atual.
- `worker-realtime` ainda lê o site da DC (HTML) para CEMADEN/CMID — evolução para ANA REST
  documentada em `TEMPO-REAL-FONTES.md`.

