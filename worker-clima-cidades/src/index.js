// Worker: condições climáticas das cidades no raio de 100 km de Brusque.
//
//   GET /clima.json -> { updated, fonte, cidades: { "Nome": { t, ic, desc,
//                          chuvaNow, chuvaDia } } }
//
// Centraliza 90 consultas ao Open-Meteo num único endpoint. O Open-Meteo
// aceita várias cidades por requisição (lat/lon separados por vírgula, resposta
// em array na mesma ordem) — enviamos tudo em 5 lotes de 18, longe do limite
// de 50 subrequests por invocação do Worker. Cache de 5 min no worker.
//
// Centroides das 90 cidades (média dos vértices da malha IBGE), gerados a
// partir de site/brusque_raio100.geojson — embutidos para não depender de
// fetch externo (a borda Cloudflare servia 404 para o geojson dentro do worker).

const CIDADES = {"Agrolândia":[-49.8215,-27.4625],"Agronômica":[-49.7224,-27.3223],"Alfredo Wagner":[-49.3431,-27.6969],"Angelina":[-49.0736,-27.5407],"Anitápolis":[-49.1318,-27.8647],"Antônio Carlos":[-48.8264,-27.4965],"Apiúna":[-49.3741,-27.1208],"Araquari":[-48.7744,-26.4505],"Ascurra":[-49.3859,-26.974],"Atalanta":[-49.7568,-27.4406],"Aurora":[-49.5928,-27.3339],"Balneário Barra do Sul":[-48.6491,-26.4275],"Balneário Camboriú":[-48.626,-26.9997],"Balneário Piçarras":[-48.7453,-26.7549],"Barra Velha":[-48.7359,-26.6528],"Benedito Novo":[-49.438,-26.7912],"Biguaçu":[-48.6898,-27.4331],"Blumenau":[-49.0986,-26.878],"Bom Retiro":[-49.5904,-27.7778],"Bombinhas":[-48.5223,-27.1702],"Botuverá":[-49.1184,-27.212],"Braço do Trombudo":[-49.9039,-27.3687],"Brusque":[-48.9172,-27.1244],"Camboriú":[-48.7148,-27.0762],"Campo Alegre":[-49.1748,-26.1001],"Canelinha":[-48.8009,-27.2447],"Chapadão do Lageado":[-49.5592,-27.5854],"Corupá":[-49.3065,-26.4176],"Dona Emma":[-49.7791,-26.9886],"Doutor Pedrinho":[-49.5568,-26.7162],"Florianópolis":[-48.4972,-27.5966],"Garopaba":[-48.6541,-28.0324],"Gaspar":[-48.985,-26.9298],"Governador Celso Ramos":[-48.5752,-27.3751],"Guabiruba":[-49.0316,-27.1075],"Guaramirim":[-48.9331,-26.4785],"Ibirama":[-49.5247,-27.0349],"Ilhota":[-48.8624,-26.8646],"Imbuia":[-49.3918,-27.5182],"Indaial":[-49.2217,-27.0114],"Itaiópolis":[-49.8875,-26.499],"Itajaí":[-48.7412,-26.9609],"Itapema":[-48.6292,-27.1083],"Ituporanga":[-49.5166,-27.477],"Jaraguá do Sul":[-49.1612,-26.4453],"Joinville":[-48.9886,-26.2745],"José Boiteux":[-49.6549,-26.8551],"Laurentino":[-49.7382,-27.2101],"Leoberto Leal":[-49.2524,-27.4927],"Lontras":[-49.5066,-27.1798],"Luiz Alves":[-48.8982,-26.7321],"Major Gercino":[-49.0639,-27.4301],"Massaranduba":[-48.9932,-26.6305],"Navegantes":[-48.7254,-26.8304],"Nova Trento":[-49.0522,-27.3118],"Otacílio Costa":[-49.9748,-27.5257],"Palhoça":[-48.6598,-27.7737],"Paulo Lopes":[-48.7654,-27.9537],"Penha":[-48.6484,-26.8086],"Petrolândia":[-49.6903,-27.5594],"Pomerode":[-49.1735,-26.7286],"Porto Belo":[-48.5914,-27.1618],"Pouso Redondo":[-49.9807,-27.2968],"Presidente Getúlio":[-49.7087,-27.0457],"Presidente Nereu":[-49.3325,-27.2548],"Rancho Queimado":[-49.0875,-27.6854],"Rio Negrinho":[-49.5962,-26.4382],"Rio do Oeste":[-49.8344,-27.1542],"Rio do Sul":[-49.6322,-27.1932],"Rio dos Cedros":[-49.372,-26.6168],"Rodeio":[-49.3644,-26.8962],"Santa Rosa de Lima":[-49.1788,-28.0081],"Santo Amaro da Imperatriz":[-48.8051,-27.7586],"Schroeder":[-49.0605,-26.3509],"São Bento do Sul":[-49.3788,-26.313],"São Bonifácio":[-48.9312,-27.9481],"São Francisco do Sul":[-48.6339,-26.295],"São José":[-48.6607,-27.5805],"São João Batista":[-48.8622,-27.3268],"São João do Itaperiú":[-48.804,-26.5981],"São Pedro de Alcântara":[-48.8392,-27.5788],"Taió":[-50.1078,-27.0861],"Tijucas":[-48.7117,-27.2455],"Timbó":[-49.2716,-26.8034],"Trombudo Central":[-49.8078,-27.3153],"Urubici":[-49.5651,-28.0496],"Vidal Ramos":[-49.3362,-27.3949],"Vitor Meireles":[-49.8478,-26.8312],"Witmarsum":[-49.8442,-26.9428],"Águas Mornas":[-48.9325,-27.7458]};

const OM = 'https://api.open-meteo.com/v1/forecast';
const TTL = 5 * 60;          // 5 min
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const BATCH = 18;            // cidades por requisição Open-Meteo
const RETRIES = 2;

function num(x) { return (x === null || x === undefined) ? null : Number(x); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ícone + descrição por weather_code (mesma tabela do front)
function wxOf(c) {
  if (c === 0) return ['☀️', 'Céu limpo'];
  if (c <= 2) return ['🌤️', 'Parcialmente nublado'];
  if (c === 3) return ['☁️', 'Nublado'];
  if (c <= 48) return ['🌫️', 'Névoa'];
  if (c <= 57) return ['🌦️', 'Garoa'];
  if (c <= 67) return ['🌧️', 'Chuva'];
  if (c <= 77) return ['🌨️', 'Neve'];
  if (c <= 82) return ['🌧️', 'Pancadas de chuva'];
  if (c <= 86) return ['🌨️', 'Neve'];
  return ['⛈️', 'Tempestade'];
}

// busca o clima de um lote de cidades em UMA requisição; retorna array na ordem
async function climaLote(cidades) {
  const lats = cidades.map(c => c[1]).join(',');
  const lons = cidades.map(c => c[0]).join(',');
  const u = `${OM}?latitude=${lats}&longitude=${lons}`
    + '&current=temperature_2m,weather_code,precipitation'
    + '&daily=precipitation_sum&forecast_days=1&timezone=America%2FSao_Paulo';
  let lastErr;
  for (let i = 0; i <= RETRIES; i++) {
    if (i) await sleep(800 * i);
    try {
      const r = await fetch(u);
      if (r.status === 429) { lastErr = new Error('rate limit'); continue; }
      if (!r.ok) throw new Error(`open-meteo HTTP ${r.status}`);
      const arr = await r.json();
      return cidades.map((_, i) => {
        const j = arr[i];
        const [ic, desc] = wxOf(j.current.weather_code);
        return {
          t: Math.round(j.current.temperature_2m), ic, desc,
          chuvaNow: num(j.current.precipitation),
          chuvaDia: (j.daily && j.daily.precipitation_sum && j.daily.precipitation_sum[0]) || 0,
        };
      });
    } catch (e) {
      lastErr = e;
      if (e.message !== 'rate limit') throw e;
    }
  }
  throw lastErr;
}

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  if (url.pathname !== '/clima.json') {
    return new Response(JSON.stringify({ erro: 'use GET /clima.json' }), { status: 404, headers: CORS });
  }
  const ck = new URL(req.url); ck.searchParams.set('_v', '6');
  const cacheReq = new Request(ck);
  const cache = caches.default;
  const cached = await cache.match(cacheReq);
  if (cached) return cached;

  try {
    const nomes = Object.keys(CIDADES);
    const lotes = [];
    for (let i = 0; i < nomes.length; i += BATCH) {
      lotes.push(nomes.slice(i, i + BATCH));
    }
    const resLotes = await Promise.all(lotes.map(loteNomes => climaLote(loteNomes.map(n => CIDADES[n]))));
    const cidadesOut = {};
    const errs = [];
    lotes.forEach((loteNomes, l) => {
      const res = resLotes[l];
      loteNomes.forEach((nome, i) => {
        const r = res && res[i];
        if (r) cidadesOut[nome] = r;
        else { cidadesOut[nome] = { t: null, ic: '·', desc: '—', chuvaNow: null, chuvaDia: null }; errs.push(nome); }
      });
    });
    const body = JSON.stringify({
      updated: new Date().toISOString(),
      fonte: 'Open-Meteo (por cidade, agregado no worker)',
      total: nomes.length,
      cidades: cidadesOut,
      debug_erros: errs.slice(0, 10),
    });
    const out = new Response(body, {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` },
    });
    ctx.waitUntil(cache.put(cacheReq, out.clone()));
    return out;
  } catch (e) {
    return new Response(JSON.stringify({ erro: 'Open-Meteo indisponível', detalhe: String(e.message || e) }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    return handle(req, env, ctx);
  },
};
