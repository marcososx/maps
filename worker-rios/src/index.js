// Worker: nível dos rios da região de Brusque — Defesa Civil de Santa Catarina.
// Consulta o GraphQL público do monitoramento estadual (mesma fonte que o site
// da DC de Brusque embute via iframe) e serve JSON enxuto com CORS.
//
//   GET /rios.json -> { updated, fonte, rios:[{codigo,nome,rio,municipio,
//                        lat,lon,nivel_m,chuva_mm,variacao_cm,coleta,tem_dado}] }
//
// A estação "atual" no resumo (tags_data) às vezes vem nula; o valor confiável
// é a série horária (Historic), de onde pegamos a última leitura com nível.
// Cacheia ~5 min pra não pesar no upstream.
//
// Fonte: https://monitoramento.defesacivil.sc.gov.br/graphql
//   query Historic(...) — série horária por estação (campo rio_nivel em metros)

const GQL = 'https://monitoramento.defesacivil.sc.gov.br/graphql';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

// Estações fluviométricas da DC-SC na bacia do Itajaí-Mirim (Brusque e entorno).
// Coordenadas conferidas no próprio GraphQL (position.latitude/longitude).
const STATIONS = [
  { codigo: 'DCSC-00019', nome: 'Brusque',            rio: 'Rio Itajaí-Mirim',            municipio: 'Brusque',   lat: -27.10068, lon: -48.91722 },
  { codigo: 'DCSC-00029', nome: 'Guabiruba',          rio: 'Ribeirão Guabiruba do Norte', municipio: 'Guabiruba', lat: -27.08678, lon: -48.97739 },
  { codigo: 'DCSC-00018', nome: 'Botuverá 1',         rio: 'Rio Itajaí-Mirim',            municipio: 'Botuverá',  lat: -27.18619, lon: -49.12059 },
];

// ⚠️ O backend da DC-SC BLOQUEIA queries com quebra de linha ("Operação bloqueada").
// A query precisa ficar em UMA linha — formato exato validado pelo GraphQL deles.
const HISTORIC = 'query Historic($stationCode:String!,$startDate:String!,$endDate:String!,$interval:QueryInterval){historic(system:Qualle_Hidrometeorologia,client:"secretaria-de-defesa-civil",stationCode:$stationCode,startDate:$startDate,endDate:$endDate,interval:$interval,opts:{ordenacao:ASC})}';

function pad(n) { return String(n).padStart(2, '0'); }

async function gql(query, variables) {
  const r = await fetch(GQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables, operationName: 'Historic' }),
  });
  const d = await r.json();
  if (d?.errors) throw new Error((d.errors[0]?.message) || 'GraphQL error');
  return d?.data || {};
}

// últimos ~3 dias de leituras horárias de uma estação
async function nivelEstacao(code) {
  const fim = new Date();
  const ini = new Date(Date.now() - 3 * 864e5);
  const iso = (x) => `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:00:00Z`;
  const data = await gql(HISTORIC, {
    stationCode: code, startDate: iso(ini), endDate: iso(fim), interval: 'HOUR_1',
  });
  const items = data?.historic?.items || [];
  // última leitura com nível (ignora buracos de telemetria)
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].rio_nivel !== null && items[i].rio_nivel !== undefined) return items[i];
  }
  return null;
}

async function build() {
  const rios = [];
  for (const s of STATIONS) {
    const rec = await nivelEstacao(s.codigo);
    rios.push({
      codigo: s.codigo,
      nome: s.nome,
      rio: s.rio,
      municipio: s.municipio,
      lat: s.lat,
      lon: s.lon,
      nivel_m: rec ? rec.rio_nivel : null,
      chuva_mm: rec ? rec.chuva_mm : null,
      variacao_cm: rec && rec.rio_variacao !== null ? rec.rio_variacao * 100 : null,
      coleta: rec ? rec.ts.slice(0, 16) : null,
      tem_dado: !!rec,
    });
  }
  return rios;
}

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  if (url.pathname !== '/rios.json') {
    return new Response(JSON.stringify({ erro: 'use GET /rios.json' }), { status: 404, headers: CORS });
  }
  const CACHE_V = '6';
  const ck = new URL(req.url); ck.searchParams.set('_v', CACHE_V);
  const cacheReq = new Request(ck);
  const cache = caches.default;
  const cached = await cache.match(cacheReq);
  if (cached) return cached;

  let rios = [];
  try {
    rios = await build();
  } catch (e) {
    return new Response(JSON.stringify({ erro: 'DC-SC indisponível', detalhe: String(e.message || e) }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const body = JSON.stringify({
    updated: new Date().toISOString(),
    fonte: 'Defesa Civil de Santa Catarina (SDC-SC, GraphQL)',
    rios,
  });
  const res = new Response(body, {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
  ctx.waitUntil(cache.put(cacheReq, res.clone()));
  return res;
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    return handle(req, env, ctx);
  },
};
