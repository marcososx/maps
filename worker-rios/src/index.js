// Worker: nível dos rios da região de Brusque — ANA HidroWebService (REST).
// Autentica com CPF/senha (segredos ANA_CPF/ANA_SENHA), busca a série de
// telemetria das estações fluviométricas da bacia do Itajaí-Mirim + cidades
// limite e serve JSON enxuto com CORS. Cacheia ~10 min.
//
//   GET /rios.json -> { updated, fonte, rios:[{codigo,nome,rio,municipio,
//                        lat,lon,nivel_m,vazao_m3s,chuva_mm,coleta}] }
//
// Endpoints ANA (spec: /hidrowebservice/api-docs):
//   OAUth/v1  -> token JWT (headers Identificador/Senha)
//   HidroinfoanaSerieTelemetricaAdotada/v2?Codigos_Estacoes=&Tipo Filtro Data=
//     DATA_LEITURA&Data de Busca=yyyy-MM-dd&Range Intervalo de busca=DIAS_2

const ANA = 'https://www.ana.gov.br/hidrowebservice';
const TTL = 600; // 10 min
const TOKEN_TTL = 50 * 60 * 1000; // re-autentica antes do JWT expirar

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

// Estações fluviométricas do Itajaí-Mirim (Brusque + Botuverá + Vidal Ramos),
// com coordenadas exatas fornecidas pelo Marcos (ficha ANA). O worker envia
// TODAS as estações; quem ainda não tem cota vem com nivel_m=null e tem_dado=
// false — o mapa mostra mesmo assim (marcador cinza "sem dado").
const STATIONS = [
  { codigo: '83900000', nome: 'Brusque (PCD)',     rio: 'Rio Itajaí-Mirim', municipio: 'Brusque',     lat: -27.100638938473043, lon: -48.917294330071236 },
  { codigo: '83905000', nome: 'Brusque',           rio: 'Rio Itajaí-Mirim', municipio: 'Brusque',     lat: -27.03304878573459,  lon: -48.86125925296594 },
  { codigo: '83893000', nome: 'Botuverá',          rio: 'Rio Itajaí-Mirim', municipio: 'Botuverá',    lat: -27.191052190090126, lon: -49.065404714372725 },
  { codigo: '83892998', nome: 'Botuverá-Montante', rio: 'Rio Itajaí-Mirim', municipio: 'Botuverá',    lat: -27.191889306861057, lon: -49.07082063689453 },
  { codigo: '83892990', nome: 'Salseiro',          rio: 'Rio Itajaí-Mirim', municipio: 'Vidal Ramos', lat: -27.332724531358075, lon: -49.3282696357201 },
];

let _token = null;
let _tokenAt = 0;

async function auth(env) {
  if (_token && Date.now() - _tokenAt < TOKEN_TTL) return _token;
  const r = await fetch(`${ANA}/EstacoesTelemetricas/OAUth/v1`, {
    headers: { Identificador: env.ANA_CPF, Senha: env.ANA_SENHA },
  });
  const d = await r.json();
  const tok = d?.items?.tokenautenticacao;
  if (!tok) throw new Error('Falha na autenticação ANA');
  _token = tok;
  _tokenAt = Date.now();
  return tok;
}

const num = (s) => (s === null || s === undefined || s === '') ? null : parseFloat(s);

async function fetchSeries(token) {
  const hoje = new Date().toISOString().slice(0, 10);
  const codes = STATIONS.map(s => s.codigo).join(',');
  const u = `${ANA}/EstacoesTelemetricas/HidroinfoanaSerieTelemetricaAdotada/v2`
    + `?Codigos_Estacoes=${codes}`
    + `&Tipo%20Filtro%20Data=DATA_LEITURA`
    + `&Data%20de%20Busca=${hoje}`
    + `&Range%20Intervalo%20de%20busca=DIAS_2`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  return d?.items || [];
}

function build(records) {
  // últimos registros (mais recentes) por estação
  const last = {};
  for (const rec of records) {
    const c = rec.codigoestacao;
    if (!last[c] || rec.Data_Hora_Medicao > last[c].Data_Hora_Medicao) last[c] = rec;
  }
  const rios = [];
  for (const s of STATIONS) {
    const rec = last[s.codigo];
    const cota = rec ? num(rec.Cota_Adotada) : null;
    rios.push({
      codigo: s.codigo,
      nome: s.nome,
      rio: s.rio,
      municipio: s.municipio,
      lat: s.lat,
      lon: s.lon,
      nivel_m: cota !== null ? cota / 100 : null,
      vazao_m3s: rec ? num(rec.Vazao_Adotada) : null,
      chuva_mm: rec ? num(rec.Chuva_Adotada) : null,
      coleta: rec && rec.Data_Hora_Medicao ? rec.Data_Hora_Medicao.slice(0, 16) : null,
      tem_dado: cota !== null,
    });
  }
  return rios;
}

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  if (url.pathname !== '/rios.json') {
    return new Response(JSON.stringify({ erro: 'use GET /rios.json' }), { status: 404, headers: CORS });
  }
  // chave de cache versionada: ao mudar o código, incrementar CACHE_V p/ não
  // servir a versão antiga (Cache API do Workers não expira sem Cache-Control)
  const CACHE_V = '5';
  const ck = new URL(req.url); ck.searchParams.set('_v', CACHE_V);
  const cacheReq = new Request(ck);
  const cache = caches.default;
  const cached = await cache.match(cacheReq);
  if (cached) return cached;

  let rios = [];
  try {
    const token = await auth(env);
    const records = await fetchSeries(token);
    rios = build(records);
  } catch (e) {
    return new Response(JSON.stringify({ erro: 'ANA indisponível', detalhe: String(e.message || e) }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const body = JSON.stringify({ updated: new Date().toISOString(), fonte: 'ANA HidroWebService', rios });
  const res = new Response(body, {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
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
