# Ideias — Mapa (Brusque Discover)

Backlog de ideias para as camadas do mapa. Relacionado: `fontes-defesacivil/`
(pipeline dos My Maps da Defesa Civil → GeoJSON) e `worker-realtime/`
(telemetria em tempo real das estações/nível do rio).

---

## Camada de abrigos da cidade

Adicionar uma camada com os **abrigos** (pontos de abrigo/apoio em caso de
enchente) no mapa.

- **Fonte:** já existe a informação no **site da Defesa Civil** de Brusque —
  extrair de: https://defesacivil.brusque.sc.gov.br/abrigos
- **Como encaixa:** mesma abordagem das outras camadas — extrair do My Map /
  site da DC no pipeline `fontes-defesacivil/` e publicar um
  `brusque_abrigos.geojson`, com chip próprio ("Abrigos") na barra do mapa.
- **Exibição:** pontos (marcadores) com card no clique (nome, endereço,
  capacidade/telefone se houver).
- **Pendência:** confirmar de onde puxar (mais um My Map público? página do
  site?) e o formato.

_(add. 02/08/2026)_

## Ajustar o nível de enchente para o nível atual

Hoje a camada **"Níveis de alagamento"** (`brusque_niveis_alagamento.geojson`)
mostra as bandas estáticas de 7–15 m. A ideia é deixá-la **dinâmica**:

- **Ler o nível atual** do **radar/estação de medição do rio** (telemetria em
  tempo real — via `worker-realtime/` / fonte ANA/DC).
  - **Fonte (monitoramento de rios e ribeirões):**
    https://defesacivil.brusque.sc.gov.br/monitoramento
- **Destacar a banda correspondente ao nível atual** do rio (ex.: rio em 8,3 m
  → realça a área alagada até ~8 m), em vez de mostrar todas as faixas estáticas.
- Fica alinhado com a lógica de "cota vs. nível atual" já prevista no
  planejamento (margem de segurança por rua).

_(add. 02/08/2026)_

## Ler cota do rio direto da telemetria da ANA (não depender da Defesa Civil)

O endpoint de rios da Defesa Civil (`tipo=rio` em
`/estacao/carregar-com-dados`) está **retornando vazio** — diagnóstico completo
em [`fontes-defesacivil/DIAGNOSTICO-monitoramento-rios.md`](fontes-defesacivil/DIAGNOSTICO-monitoramento-rios.md).
A fonte primária da cota é a **ANA**, então o caminho robusto é ir direto nela.

- **Tarefa concreta:** achar o **código da estação da ANA** do rio
  **Itajaí-Mirim** em Brusque e montar a **chamada da API de telemetria**
  (cota/nível) — HidroWebService, `telemetriaws1.ana.gov.br`.
- **Como encaixa:** alimenta o `worker-realtime/` e destrava a ideia
  "Ajustar o nível de enchente para o nível atual" (acima), sem depender do
  endpoint municipal quebrado.
- **Status:** proposto; aguardando o Marcos dar o "vai" pra eu buscar o código
  da estação e montar a chamada.

_(add. 02/08/2026)_

## Card de Tempo real: usar o nível do RIO na condição (não o nível per-estação)

O card do hover das estações (camada **Tempo real**) já reflete o padrão da Defesa
Civil (🚨 EMERGÊNCIA nível>5m / ⚠️ ATENÇÃO nível>3m ou chuva>30mm / ✅ NORMALIDADE),
mas hoje lê `rt.nivel` **por estação** — e esse campo vem **`null`** no feed do
`worker-realtime` (as estações CEMADEN/CMID são pluviômetros, não réguas de rio).

- **Consequência atual:** com dado real o card só chega a ATENÇÃO por **chuva > 30 mm**;
  EMERGÊNCIA (nível > 5 m) **nunca dispara**. Os estados coloridos só aparecem via mock
  (`?rtmock=emergencia|atencao|chuva`).
- **Tarefa concreta:** ligar o **`rio.nivel_m`** (que o worker JÁ entrega no objeto
  `rio`, fonte ANA) na função `rtCond` do `index.html`, que é o "Nível" que a página
  `estacao/ver/N` da Defesa Civil de fato mostra. Mudança pequena e localizada no front
  (o worker não muda).
- **Decisão de produto pendente:** "condição da estação" passaria a refletir o **rio**
  (global) além da chuva local — o Marcos confirma se é isso que quer, já que o rio é um
  só pra todas as estações.
- **Relacionado:** casa com "Ajustar o nível de enchente para o nível atual" e "Ler cota
  do rio direto da ANA" (acima) — mesma fonte de nível.

_(add. 04/08/2026 — worker-realtime já deployado nesta data)_

---

## Anotações / pendências (sugestões em aberto — add. 05/08/2026)

Notas de acompanhamento que ficaram "em aberto" durante as implementações de
clima/rios/indicadores. Nada implementado ainda — registraram pra retomar quando
o Marcos der o "vai".

### 1. Texto de cobrança sobre a BRUSQUE (PCD) — telemetria do rio parada
- **Contexto:** a régua do Itajaí-Mirim em Brusque (ANA `83900000`, **operada pela
  EPAGRI-SC**) teve a telemetria parada ~2023 (`Data_Ultima_Atualizacao: 2023-08-18`,
  registrador de nível encerrou 11/2021). Por isso a seção de rios da Defesa Civil de
  Brusque está vazia e a camada "Nível dos rios" só mostra o **Salseiro** (Vidal Ramos).
- **Sugestão:** montar um **texto pronto** (e-mail/WhatsApp) pra cobrar a **EPAGRI-SC**
  (operadora) e a **Defesa Civil** sobre o status/retomada da telemetria da estação
  `83900000 BRUSQUE (PCD)`. Quando voltar, a estação aparece sozinha no mapa (o
  worker `brusque-rios` só entrega estação com cota).

### 2. Escala da "Chuva acumulada" vs. normal climatológica (contexto El Niño)
- **Contexto:** o gauge de chuva do dropdown **Indicadores** usa escala fixa (0–300 mm).
- **Sugestão:** comparar com a **normal climatológica** do período (ex.: chuva de 30
  dias ÷ normal do mês) pra leitura ser fiel ao impacto do **El Niño** (que em
  Brusque/SC significa mais chuva em set–nov). Fonte: Open-Meteo histórico + normais.

### 3. (lembrete) Indicadores El Niño opcionais
- Índice **ENSO** já integrado (NOAA Niño 3.4, +2,0 °C = El Niño muito forte).
- Se quiser aprofundar: **anomalia sazonal de chuva** (ECMWF SEAS5 via Open-Meteo,
  temp já funciona) e **temperatura do mar (SST)** na costa — ficam como sugestão.

