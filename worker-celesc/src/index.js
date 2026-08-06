// Worker: situação de energia da CELESC — TODAS as cidades de SC (por regional)
//
//   GET /celesc.json -> { updated, fonte, visao_geral, regioes:[{...}],
//                          municipios:[{ id, nome, total, sem_energia, pct,
//                          classe, acidentais, programados, bairros, raio,
//                          regional_id, regional }] }
//
// A fonte é o "Informa CELESC" (https://celgeoweb.celesc.com.br/desktop.html):
//   - json/mapa.js      -> `var mapaIndicador` (por município: nr_municipio,
//                          nr_cor, ds_informacao = HTML com total + sem energia)
//   - json/tabelas.js   -> `var visaoGeralPublico` (visão geral + detalhe por
//                          cidade/bairro: acidentais, programados)
//
// O site NÃO manda CORS -> o navegador não pode falar direto; passa por aqui.
// Cache de ~5 min (o painel da CELESC se atualiza nessa cadência — não faz
// sentido buscar mais rápido). O Worker devolve o ESTADO INTEIRO (~325
// municípios) com a divisão regional oficial da CELESC (NR_REGIONAL, do
// json/municipio.js). Cada município traz `raio:true` se estiver dentro do
// raio de 100 km de Brusque (RAIO_IDS, casamento geométrico).
//
// Classes de cor (pedido do Marcos, 06/08/2026 — paleta verde → vermelho):
//   1 = 0% a 5%   (verde)        4 = 30% a 50% (laranja)
//   2 = 5% a 15%  (amarelo)      5 = maior que 50% (vermelho)
//   3 = 15% a 30% (âmbar)

// ids CELESC das 90 cidades no raio de 100 km de Brusque (brusque_raio100.geojson)
const RAIO_IDS = new Set([1101,1102,1103,1104,1105,1106,1107,1108,1109,1110,1111,1112,1113,1114,1115,1120,1121,2101,2102,2103,2104,2105,2106,2107,2108,2109,2110,2111,2112,2113,2114,2115,2116,3101,3103,3104,3110,4106,4107,4115,7101,7102,7103,7104,13108,13109,13117,13128,13129,14101,14102,14103,14104,14105,14106,14107,14108,14109,14110,14111,14112,14113,14114,14115,14116,14117,14118,14119,14120,14123,14124,14125,14126,14129,15103,16101,16102,16103,17101,17102,17103,17104,17105,17106,17107,17108,17109,17110,17111,17112]);

const REGIONAIS = { 1:'Florianópolis',2:'Blumenau',3:'Joinville',4:'Lages',5:'Videira',6:'Concórdia',7:'Jaraguá do Sul',8:'Joaçaba',10:'Criciúma',11:'São Miguel do Oeste',13:'Tubarão',14:'Rio do Sul',15:'Mafra',16:'São Bento do Sul',17:'Itajaí',18:'Chapecó' };

// id CELESC -> NR_REGIONAL (gerado da malha oficial, json/municipio.js)
const REGIONAL_POR_ID = {"1101":1,"1102":1,"1103":1,"1104":1,"1105":1,"1106":1,"1107":1,"1108":1,"1109":1,"1110":1,"1111":1,"1112":1,"1113":1,"1114":1,"1115":1,"1120":1,"1121":1,"2101":2,"2102":2,"2103":2,"2104":2,"2105":2,"2106":2,"2107":2,"2108":2,"2109":2,"2110":2,"2111":2,"2112":2,"2113":2,"2114":2,"2115":2,"2116":2,"3101":3,"3102":3,"3103":3,"3104":3,"3109":3,"3110":3,"4101":4,"4103":4,"4104":4,"4105":4,"4106":4,"4107":4,"4108":4,"4109":4,"4111":4,"4112":4,"4113":4,"4114":4,"4115":4,"4116":4,"4117":4,"4118":4,"4119":4,"4120":4,"4121":4,"4122":4,"4123":4,"4124":4,"4125":4,"4126":4,"5101":5,"5102":5,"5103":5,"5104":5,"5105":5,"5106":5,"5107":5,"5108":5,"5109":5,"5110":5,"5111":5,"5112":5,"5113":5,"5114":5,"5115":5,"6101":6,"6102":6,"6103":6,"6104":6,"6105":6,"6106":6,"6107":6,"6108":6,"6109":6,"6110":6,"6111":6,"6112":6,"6113":6,"6114":6,"6115":6,"6116":6,"6117":6,"7101":7,"7102":7,"7103":7,"7104":7,"8101":8,"8102":8,"8103":8,"8104":8,"8105":8,"8106":8,"8107":8,"8108":8,"8109":8,"8110":8,"8111":8,"8112":8,"8113":8,"8114":8,"8115":8,"8116":8,"8117":8,"8118":8,"8119":8,"8120":8,"8121":8,"10101":10,"10102":10,"10103":10,"10104":10,"10105":10,"10106":10,"10107":10,"10108":10,"10109":10,"10110":10,"10111":10,"10112":10,"10113":10,"10114":10,"10115":10,"10116":10,"10117":10,"10118":10,"10119":10,"10120":10,"10121":10,"10122":10,"10123":10,"10124":10,"10125":10,"11101":11,"11106":11,"11107":11,"11109":11,"11110":11,"11111":11,"11112":11,"11113":11,"11114":11,"11115":11,"11116":11,"11117":11,"11118":11,"11119":11,"11120":11,"11121":11,"11122":11,"11123":11,"11124":11,"11125":11,"11126":11,"11127":11,"11128":11,"11129":11,"11130":11,"11131":11,"11132":11,"11133":11,"11134":11,"11135":11,"11136":11,"11137":11,"11138":11,"11139":11,"13101":13,"13102":13,"13103":13,"13104":13,"13105":13,"13108":13,"13109":13,"13110":13,"13111":13,"13112":13,"13113":13,"13114":13,"13115":13,"13116":13,"13117":13,"13118":13,"13128":13,"13129":13,"13130":13,"13131":13,"13132":13,"13133":13,"13134":13,"14101":14,"14102":14,"14103":14,"14104":14,"14105":14,"14106":14,"14107":14,"14108":14,"14109":14,"14110":14,"14111":14,"14112":14,"14113":14,"14114":14,"14115":14,"14116":14,"14117":14,"14118":14,"14119":14,"14120":14,"14121":14,"14122":14,"14123":14,"14124":14,"14125":14,"14126":14,"14127":14,"14129":14,"15101":15,"15103":15,"15104":15,"15105":15,"15106":15,"15107":15,"15108":15,"15109":15,"15113":15,"15114":15,"15115":15,"16101":16,"16102":16,"16103":16,"17101":17,"17102":17,"17103":17,"17104":17,"17105":17,"17106":17,"17107":17,"17108":17,"17109":17,"17110":17,"17111":17,"17112":17,"18101":18,"18102":18,"18103":18,"18104":18,"18105":18,"18106":18,"18107":18,"18108":18,"18109":18,"18110":18,"18111":18,"18112":18,"18113":18,"18114":18,"18115":18,"18116":18,"18117":18,"18118":18,"18119":18,"18121":18,"18122":18,"18123":18,"18124":18,"18125":18,"18126":18,"18127":18,"18128":18,"18129":18,"18130":18,"18131":18,"18132":18,"18133":18,"18134":18,"18135":18,"18136":18,"18137":18,"18138":18,"18141":18};

const M = 'https://celgeoweb.celesc.com.br';
const MAPA_URL = M + '/json/mapa.js';
const TABELAS_URL = M + '/json/tabelas.js';
const TTL = 300;                       // 5 min
const CACHE_V = '8';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

const numBR = (x) => parseInt(String(x).replace(/[^\d]/g, ''), 10) || 0;

// `var mapaIndicador = {...};` → JSON (a matriz abre com `[,` = buraco no índice 0)
function parseJsVar(text, varName) {
  let s = text.replace(new RegExp('^var\\s+' + varName + '\\s*=\\s*'), '').replace(/;\s*$/, '');
  s = s.replace(/"municipios":\[\s*,/, '"municipios":[null,');
  return JSON.parse(s);
}

// ds_informacao é um HTML de tabela: cabeçalho = nome do município; linhas =
// "Total de unidades consumidoras" e "Sem energia" (o <b> pode embrulhar o rótulo)
function parseIndicador(html) {
  const nome = (html.match(/<th[^>]*>\s*([^<]+?)\s*<\/th>/) || [])[1];
  const total = (html.match(/Total de unidades consumidoras\s*<\/td>\s*<td[^>]*>\s*([\d.]+)/) || [])[1];
  const sem = (html.match(/Sem energia<\/?b>\s*<\/td>\s*<td[^>]*>\s*<b>\s*([\d.]+)/) || [])[1];
  return {
    nome: nome ? nome.trim() : null,
    total: total != null ? numBR(total) : null,
    sem_energia: sem != null ? numBR(sem) : null,
  };
}

function classe(pct) {
  if (pct == null) return 0;
  if (pct < 5) return 1;      // 0% a 5%   → verde
  if (pct < 15) return 2;     // 5% a 15%  → amarelo
  if (pct < 30) return 3;     // 15% a 30% → âmbar
  if (pct <= 50) return 4;    // 30% a 50% → laranja
  return 5;                   // > 50%     → vermelho
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally {
    clearTimeout(to);
  }
}

async function build() {
  const [mapaTxt, tabelasTxt] = await Promise.all([
    fetchText(MAPA_URL),
    fetchText(TABELAS_URL),
  ]);
  const mapa = parseJsVar(mapaTxt, 'mapaIndicador');
  const geral = parseJsVar(tabelasTxt, 'visaoGeralPublico');

  // detalhe por cidade (a tabela só lista quem tem corte): acidentais/programados/bairros
  const detalhe = {};
  (geral.REGIONAIS || []).forEach(reg =>
    (reg.CIDADES || []).forEach(c => {
      detalhe[c.ID_CIDADE] = {
        nome: c.CIDADE,
        acidentais: numBR(c.QUANTIDADE_ACIDENTAL),
        programados: numBR(c.QUANTIDADE_PROGRAMADA),
        bairros: (c.BAIRROS || []).map(b => ({
          nome: b.BAIRRO,
          sem: numBR(b.QUANTIDADE_TOTAL),
          acidental: numBR(b.QUANTIDADE_ACIDENTAL),
          programado: numBR(b.QUANTIDADE_PROGRAMADA),
        })),
      };
    })
  );

  const municipios = [];
  let totalUC = 0, totalSem = 0, comCorte = 0;
  (mapa.municipios || []).forEach(m => {
    if (!m) return;
    const p = parseIndicador(m.ds_informacao);
    const total = p.total != null ? p.total : 0;
    const sem = p.sem_energia != null ? p.sem_energia : 0;
    const pct = total > 0 ? sem / total * 100 : 0;
    const d = detalhe[m.nr_municipio] || {};
    totalUC += total; totalSem += sem;
    if (pct > 0) comCorte++;
    const rid = REGIONAL_POR_ID[m.nr_municipio];
    municipios.push({
      id: m.nr_municipio,
      nome: p.nome || '—',
      total,
      sem_energia: sem,
      pct: Math.round(pct * 100) / 100,
      classe: classe(pct),
      acidentais: d.acidentais || 0,
      programados: d.programados || 0,
      bairros: d.bairros || [],
      raio: RAIO_IDS.has(m.nr_municipio),
      regional_id: rid || null,
      regional: rid ? (REGIONAIS[rid] || null) : null,
    });
  });
  municipios.sort((a, b) => b.pct - a.pct);

  // agregação por regional (divisão oficial da CELESC). Municípios de fora de
  // SC (borda PR/RS, sem NR_REGIONAL) ficam de fora da tabela — não são regionais.
  const regioes = [];
  const regMap = {};
  municipios.forEach(m => {
    if (!m.regional_id) return;
    const k = m.regional_id;
    let r = regMap[k];
    if (!r) { r = regMap[k] = { id: k, nome: m.regional, cidades: 0, total_uc: 0, sem_energia: 0, cidades_com_corte: 0, pct_sem: 0 }; regioes.push(r); }
    r.cidades++; r.total_uc += m.total; r.sem_energia += m.sem_energia;
    if (m.pct > 0) r.cidades_com_corte++;
  });
  regioes.forEach(r => { r.pct_sem = r.total_uc > 0 ? Math.round(r.sem_energia / r.total_uc * 10000) / 100 : 0; });
  regioes.sort((a, b) => b.pct_sem - a.pct_sem || a.nome.localeCompare(b.nome));

  return {
    updated: new Date().toISOString(),
    fonte: 'CELESC — celgeoweb.celesc.com.br (Informa CELESC, tempo real)',
    visao_geral: {
      municipios: municipios.length,
      total_uc: totalUC,
      sem_energia: totalSem,
      pct_sem: totalUC > 0 ? Math.round(totalSem / totalUC * 10000) / 100 : 0,
      cidades_com_corte: comCorte,
    },
    regioes,
    municipios,
  };
}

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  if (url.pathname !== '/celesc.json') {
    return new Response(JSON.stringify({ erro: 'use GET /celesc.json' }), { status: 404, headers: CORS });
  }
  const ck = new URL(req.url); ck.searchParams.set('_v', CACHE_V);
  const cacheReq = new Request(ck);
  const cache = caches.default;
  const cached = await cache.match(cacheReq);
  if (cached) return cached;

  let data;
  try {
    data = await build();
  } catch (e) {
    return new Response(JSON.stringify({ erro: 'CELESC indisponível', detalhe: String(e.message || e) }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const body = JSON.stringify(data);
  const out = new Response(body, {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` },
  });
  ctx.waitUntil(cache.put(cacheReq, out.clone()));
  return out;
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    return handle(req, env, ctx);
  },
};
