# brusque-rios — nível dos rios da região (Defesa Civil de SC)

Worker Cloudflare que serve, em JSON limpo e com CORS, o nível das estações
fluviométricas da bacia do Itajaí-Mirim. A camada **"Nível do rio"** do mapa
(`site/index.html`) consome este Worker via `RIOS_URL`.

- Endpoint: `GET /rios.json`
- Cache: 5 min (Cache API do Worker)
- Retorna: `{ updated, fonte, rios:[{codigo,nome,rio,municipio,lat,lon,nivel_m,chuva_mm,variacao_cm,coleta,tem_dado}] }`

## Fonte dos dados

GraphQL **público** do monitoramento estadual:
`https://monitoramento.defesacivil.sc.gov.br/graphql` (a mesma fonte que o site
da DC de Brusque embute via iframe). **Não precisa de credencial.**

Estações ativas:

| Código | Nome | Rio | Coordenadas |
|---|---|---|---|
| DCSC-00019 | Brusque | Rio Itajaí-Mirim | -27.10068, -48.91722 |
| DCSC-00029 | Guabiruba | Ribeirão Guabiruba do Norte | -27.08678, -48.97739 |
| DCSC-00018 | Botuverá 1 | Rio Itajaí-Mirim | -27.18619, -49.12059 |

### Como o nível é lido

O campo resumido (`tags_data`) às vezes vem com nível nulo; o valor confiável é
a série horária da query `Historic`, de onde pegamos a **última leitura com
nível** de cada estação.

⚠️ O backend da DC-SC **bloqueia queries GraphQL com quebra de linha**
("Operação bloqueada") — a query `HISTORIC` no código está propositalmente em
**uma única linha**. Não reformatar.

## Deploy (rodar dentro desta pasta)

```bash
npm install
npx wrangler login       # login Cloudflare (abre o navegador) — só o Marcos faz
npx wrangler deploy
```

URL final: `https://brusque-rios.<seu-subdominio>.workers.dev/rios.json`.
Teste: `curl https://brusque-rios.marcososx.workers.dev/rios.json`.

**Depois do deploy, confira `RIOS_URL` no `site/index.html`**
(hoje aponta para `https://brusque-rios.marcososx.workers.dev/rios.json`).
