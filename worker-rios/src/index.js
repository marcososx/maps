// Worker: nível dos rios da região — Defesa Civil de SC (GraphQL) + Defesa
// Civil de Itajaí (página pública) + ANA (HidroWeb API).
//
//   GET /rios.json -> { updated, fontes:[...], rios:[{codigo,nome,rio,municipio,
//                        lat,lon,nivel_m,chuva_mm,variacao_cm,coleta,coleta_ts,
//                        digital,tem_dado,fonte}] }
//
// Estações (Itajaí-Mirim, nascente→foz):
//   DIGITAIS (telemétricas):
//     - Salseiro (Vidal Ramos)    — ANA 83892990 (telemetria v2)
//     - Botuverá 1                — DC-SC DCSC-00018
//     - Guabiruba (Norte)         — DC-SC DCSC-00029 (afluente)
//     - Brusque (ponte)           — DC-SC DCSC-00019
//     - Itajaí: DC-10, DC-03, DC-04 (canal retificado) + DC-05, DC-06 (antigo)
//   ANALÓGICAS (régua, coleta manual no site da ANA):
//     - Botuverá-Montante         — ANA 83892998
//     - Botuverá                  — ANA 83893000 (desativada)
// Cacheia ~5 min pra não pesar nos upstreams.

const GQL = 'https://monitoramento.defesacivil.sc.gov.br/graphql';
const DC_ITAJAI_URL = 'https://defesacivil.itajai.sc.gov.br/monitoramento/nivel-rios';
const ANA_AUTH = 'https://www.ana.gov.br/hidrowebservice/EstacoesTelemetricas/OAUth/v1';
const ANA_COTA = 'https://www.ana.gov.br/hidrowebservice/EstacoesTelemetricas/HidroSerieCotas/v1';
const ANA_TELE = 'https://www.ana.gov.br/hidrowebservice/EstacoesTelemetricas/HidroinfoanaSerieTelemetricaAdotada/v2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

// Coordenadas sobre o traçado do rio (projetadas). Guabiruba fica no afluente.
const STATIONS = [
  { codigo: '83892990',  nome: 'Salseiro',       rio: 'Rio Itajaí-Mirim',                 municipio: 'Vidal Ramos', lat: -27.332560, lon: -49.328436, fonte: 'ANA telemetria', digital: true  },
  { codigo: '83892998',  nome: 'Botuverá-Montante', rio: 'Rio Itajaí-Mirim',              municipio: 'Botuverá',   lat: -27.163840, lon: -49.017650, fonte: 'ANA régua',      digital: false },
  { codigo: '83893000',  nome: 'Botuverá',       rio: 'Rio Itajaí-Mirim',                 municipio: 'Botuverá',   lat: -27.190800, lon: -49.065300, fonte: 'ANA régua',      digital: false },
  { codigo: 'DCSC-00018',nome: 'Botuverá 1',     rio: 'Rio Itajaí-Mirim',                 municipio: 'Botuverá',   lat: -27.186260, lon: -49.120649, fonte: 'DC-SC',         digital: true  },
  { codigo: 'DCSC-00029',nome: 'Guabiruba',      rio: 'Ribeirão Guabiruba do Norte',      municipio: 'Guabiruba',  lat: -27.086800, lon: -48.977400, fonte: 'DC-SC',         digital: true  },
  { codigo: 'DCSC-00019',nome: 'Brusque',        rio: 'Rio Itajaí-Mirim',                 municipio: 'Brusque',    lat: -27.100653, lon: -48.917230, fonte: 'DC-SC',         digital: true  },
  { codigo: 'DC-10',     nome: 'Limoeiro',       rio: 'Rio Itajaí-Mirim',                 municipio: 'Itajaí',     lat: -27.032494, lon: -48.856673, fonte: 'DC Itajaí',     digital: true  },
  { codigo: 'DC-03',     nome: 'Captação SEMASA',rio: 'Rio Itajaí-Mirim (canal retificado)', municipio: 'Itajaí',  lat: -26.914847, lon: -48.723772, fonte: 'DC Itajaí',     digital: true  },
  { codigo: 'DC-04',     nome: 'Vitalmar',       rio: 'Rio Itajaí-Mirim (canal retificado)', municipio: 'Itajaí',  lat: -26.907770, lon: -48.712018, fonte: 'DC Itajaí',     digital: true  },
  { codigo: 'DC-05',     nome: 'Curso antigo',   rio: 'Rio Itajaí-Mirim (Canal Antigo)',  municipio: 'Itajaí',     lat: -26.930986, lon: -48.708794, fonte: 'DC Itajaí',     digital: true  },
  { codigo: 'DC-06',     nome: 'Itamirim',       rio: 'Rio Itajaí-Mirim (Canal Antigo)',  municipio: 'Itajaí',     lat: -26.924206, lon: -48.685893, fonte: 'DC Itajaí',     digital: true  },
];

// ⚠️ O backend da DC-SC BLOQUEIA queries com quebra de linha ("Operação bloqueada").
const HISTORIC = 'query Historic($stationCode:String!,$startDate:String!,$endDate:String!,$interval:QueryInterval){historic(system:Qualle_Hidrometeorologia,client:"secretaria-de-defesa-civil",stationCode:$stationCode,startDate:$startDate,endDate:$endDate,interval:$interval,opts:{ordenacao:ASC})}';

function pad(n) { return String(n).padStart(2, '0'); }

// fetch com timeout (o ANA HidroWeb é lento/intermitente — não segura a resposta)
async function fetchT(url, opts, ms = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally { clearTimeout(t); }
}

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

// ── ANA HidroWeb: autenticação (token expira ~1 dia; renovado a cada chamada) ──
let _anaToken = { jwt: null, ts: 0 };
async function anaJwt(env) {
  if (_anaToken.jwt && Date.now() - _anaToken.ts < 50 * 60e3) return _anaToken.jwt;
  const id = env?.ANA_IDENTIFICADOR || '';
  const senha = env?.ANA_SENHA || '';
  if (!id || !senha) return null;
  const r = await fetchT(ANA_AUTH, {
    headers: { Identificador: id, Senha: senha, Accept: 'application/json' },
  });
  if (!r.ok) return null;
  const d = await r.json();
  const jwt = d?.items?.tokenautenticacao;
  if (!jwt) return null;
  _anaToken = { jwt, ts: Date.now() };
  return jwt;
}

// nível de estação ANA telemétrica (PCD) — endpoint v2 (Cota em cm)
async function nivelAnaTele(code, env) {
  const jwt = await anaJwt(env);
  if (!jwt) return null;
  const params = new URLSearchParams();
  params.set('Codigos_Estacoes', code);
  params.set('Tipo Filtro Data', 'DATA_ULTIMA_ATUALIZACAO');
  params.set('Data de Busca (yyyy-MM-dd)', new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  params.set('Range Intervalo de busca', 'HORA_1');
  const r = await fetchT(`${ANA_TELE}?${params}`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
  });
  if (!r.ok) return null;
  const d = await r.json();
  const items = d?.items || [];
  if (!items.length) return null;
  const ult = items[items.length - 1];
  const cota = parseFloat(ult.Cota_Adotada);
  if (isNaN(cota)) return null;
  const ts = ult.Data_Hora_Medicao || null;
  return { rio_nivel: cota / 100, chuva_mm: parseFloat(ult.Chuva_Adotada) || null, rio_variacao: null, ts };
}

// nível de estação ANA analógica (régua, coleta manual) — v1 HidroSerieCotas
// Retorna { nivel_m, ultima_alteracao } se achar a última leitura válida.
async function nivelAnaRegua(code, env) {
  const jwt = await anaJwt(env);
  if (!jwt) return null;
  const ini = new Date(Date.now() - 366 * 864e5);
  const fim = new Date();
  const iso = (x) => `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
  const params = new URLSearchParams();
  params.set('Código da Estação', code);
  params.set('Tipo Filtro Data', 'DATA_LEITURA');
  params.set('Data Inicial (yyyy-MM-dd)', iso(ini));
  params.set('Data Final (yyyy-MM-dd)', iso(fim));
  const r = await fetchT(`${ANA_COTA}?${params}`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
  });
  if (!r.ok) return null;
  const d = await r.json();
  const items = d?.items || [];
  if (!items.length) return null;
  // registros mensais: Cota_01..Cota_31 (dia do mês). Pega o mais recente
  // e a última cota válida (Status=1).
  const reg = items[items.length - 1];
  let val = null;
  for (let i = 31; i >= 1; i--) {
    if (reg[`Cota_${pad(i)}`] !== undefined || reg[`Cota_${i}`] !== undefined) {
      const k = reg[`Cota_${pad(i)}`] !== undefined ? `Cota_${pad(i)}` : `Cota_${i}`;
      const v = reg[k];
      if (v !== null && v !== '' && !isNaN(parseFloat(v))) { val = parseFloat(v); break; }
    }
  }
  const ts = reg.Data_Hora_Dado || reg.Data_Ultima_Alteracao || null;
  if (val === null) return null;
  return { rio_nivel: val / 100, chuva_mm: null, rio_variacao: null, ts, manual: true };
}

// últimos ~3 dias de leituras horárias de uma estação DC-SC
async function nivelDcSc(code) {
  const fim = new Date();
  const ini = new Date(Date.now() - 3 * 864e5);
  const iso = (x) => `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:00:00Z`;
  const data = await gql(HISTORIC, {
    stationCode: code, startDate: iso(ini), endDate: iso(fim), interval: 'HOUR_1',
  });
  const items = data?.historic?.items || [];
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].rio_nivel !== null && items[i].rio_nivel !== undefined) return items[i];
  }
  return null;
}

// níveis da DC Itajaí — scrape da página pública (server-rendered)
// cada card traz: nome, "Nível do Rio: X,XX m" e "Data e hora da medição: DD/MM/AAAA HH:MM"
let _dcItajaiCache = { ts: 0, data: null };
async function nivelDcItajai() {
  const now = Date.now();
  if (_dcItajaiCache.data && now - _dcItajaiCache.ts < 4 * 60e3) return _dcItajaiCache.data;
  const r = await fetch(DC_ITAJAI_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('DC Itajaí HTTP ' + r.status);
  const html = await r.text();
  const map = {};
  const re = /DC-(\d+)[^<]{0,150}?<\/[^>]+>[^]*?Nível do Rio:\s*<[^>]*>\s*([\d,]+)\s*m([^]*?)Data e hora da medição:\s*<[^>]*>\s*([\d]{2})\/([\d]{2})\/([\d]{4})\s+([\d]{2}):([\d]{2})/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const code = 'DC-' + m[1];
    const val = parseFloat(m[2].replace(',', '.'));
    if (isNaN(val)) continue;
    // grupos: 4=dia, 5=mês, 6=ano, 7=hora, 8=minuto (m[3] é o conteúdo intermediário)
    const ts = `${m[6]}-${m[5]}-${m[4]} ${m[7]}:${m[8]}`; // AAAA-MM-DD HH:MM
    map[code] = { rio_nivel: val, ts, chuva_mm: null, rio_variacao: null };
  }
  _dcItajaiCache = { ts: now, data: map };
  return map;
}

async function build(env) {
  const rios = [];
  const dcItajai = await nivelDcItajai().catch(() => ({}));
  for (const s of STATIONS) {
    let rec = null, fonte = s.fonte;
    try {
      if (s.fonte === 'DC-SC') rec = await nivelDcSc(s.codigo);
      else if (s.fonte === 'DC Itajaí') { const r = dcItajai[s.codigo] || null; if (r) rec = { ...r }; }
      else if (s.fonte === 'ANA telemetria') rec = await nivelAnaTele(s.codigo, env);
      else if (s.fonte === 'ANA régua') rec = await nivelAnaRegua(s.codigo, env);
    } catch (_) { rec = null; }
    if (!rec) fonte = s.fonte + ' (sem leitura)';
    const coleta = rec && rec.ts ? rec.ts.slice(0, 16).replace('T', ' ') : null;
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
      coleta,
      coleta_ts: rec && rec.ts ? Date.parse(rec.ts.replace(' ', 'T')) : null,
      digital: s.digital,
      tem_dado: !!rec,
      fonte,
    });
  }
  return rios;
}

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  if (url.pathname !== '/rios.json') {
    return new Response(JSON.stringify({ erro: 'use GET /rios.json' }), { status: 404, headers: CORS });
  }
  const CACHE_V = '11';
  const ck = new URL(req.url); ck.searchParams.set('_v', CACHE_V);
  const cacheReq = new Request(ck);
  const cache = caches.default;
  const cached = await cache.match(cacheReq);
  if (cached) return cached;

  let rios = [];
  try {
    rios = await build(env);
  } catch (e) {
    return new Response(JSON.stringify({ erro: 'fontes indisponíveis', detalhe: String(e.message || e) }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const body = JSON.stringify({
    updated: new Date().toISOString(),
    fontes: ['Defesa Civil de SC (GraphQL)', 'Defesa Civil de Itajaí', 'ANA HidroWeb'],
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
