# brusque-realtime — dados de monitoramento em tempo real (Defesa Civil)

Worker Cloudflare que serve, em JSON limpo e com CORS, os dados de monitoramento
da Defesa Civil de Brusque. O front (`index.html`, chip **Tempo real** + hint dos
bairros) fala só com este Worker — nunca direto com o site (que não manda CORS).

- Endpoint: `GET /estacoes.json`
- Cache: 5 min (Cache API do Worker) → não bate no upstream a cada hover.
- Retorna: `{ updated, fonte, rio:{nivel_m,coleta,fonte:'ANA'}, estacoes:[{nome,fonte,experimental,coleta,nivel,temp,chuva_atual,chuva_24h,valores}] }`

## Deploy (rodar dentro desta pasta)

```bash
npm install
npx wrangler login       # login Cloudflare (abre o navegador) — só o Marcos faz
npx wrangler deploy
```

URL final: `https://brusque-realtime.<seu-subdominio>.workers.dev`.
Teste: `https://.../estacoes.json` (deve vir o JSON com as 6 estações CEMADEN +
experimentais CMID + nível do rio ANA).

**Depois do deploy, confira `REALTIME_URL` no `index.html`** (hoje aponta para
`https://brusque-realtime.marcososx.workers.dev/estacoes.json`). Se o subdomínio
for outro, ajuste lá.

## Hierarquia de fonte (pedido do Marcos: GOV → API → site)

Hoje o Worker está no **nível 3** (lê do site da Defesa Civil de Brusque, que já
agrega tudo com **nome de bairro** e **hora da coleta** prontos). Isso foi a escolha
pragmática porque:

1. **GOV direto / API (níveis 1–2)** exigem **cadastro/credencial que só o Marcos
   cria** (não dá p/ automatizar sem conta):
   - **CEMADEN** (rede federal que já alimenta as 6 estações por bairro —
     Azambuja, Bateas, Centro, Limeira, Santa Luzia, Souza Cruz): dados via
     Sala de Situação / mapa interativo; acesso programático estável pede
     solicitação ao CEMADEN.
   - **ANA HidroWebService** (nível do Rio Itajaí-Mirim): API REST oficial em
     `https://www.ana.gov.br/hidrowebservice` com **OAuth** (precisa registrar
     usuário/senha). Legado SOAP aberto: `telemetriaws1.ana.gov.br/serviceana.asmx`
     (`HidroSerieHistorica` / `DadosHidrometeorologicos`) — precisa do **código da
     estação** de Brusque no Itajaí-Mirim.
2. Enquanto não há credencial, o site da DC entrega o mesmo dado (origem CEMADEN/ANA)
   já mapeado por bairro. **Upgrade** = trocar as funções `parseTabela`/`parseRio`
   por chamadas às APIs acima, mantendo o mesmo formato de saída `/estacoes.json`
   (o front não muda).

## Parsing (frágil por natureza — é HTML de terceiro)

- `parseTabela` lê `/monitoramento/tabela` (DataTables, server-rendered). Colunas:
  `Estação | Fonte | Experimental | Coleta | Nível | Chuva Atual | Temp | Última
  hora | 6 horas | 12 horas | 24 horas | 48 horas` (o thead usa `<td>`, não `<th>`).
- `parseRio` lê o `title` do bloco "Nível do Rio ponte" na home (`/monitoramento`).
- Se o site mudar o HTML, ajustar os regex aqui. O front degrada em silêncio se o
  Worker cair (mostra só o nome do bairro/estação, sem os números).
