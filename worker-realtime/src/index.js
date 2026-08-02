// Worker de TEMPO REAL do Brusque Discover.
// Serve, em JSON limpo e com CORS, os dados de monitoramento da Defesa Civil de
// Brusque — que por sua vez agregam a rede federal CEMADEN (pluviômetros por
// bairro), as estações experimentais CMID e o nível do Rio Itajaí-Mirim da ANA.
//
//   GET /estacoes.json  ->  { updated, rio:{...}, estacoes:[...] }
//
// Por que um Worker e não fetch direto do front: (1) o site da Defesa Civil não
// manda header CORS, então o navegador barraria; (2) cacheia ~5 min pra não bater
// no upstream a cada hover; (3) transforma HTML em JSON enxuto (menos bytes no
// cliente). O front NUNCA fala com o site — só com este Worker.
//
// ⚠️ HIERARQUIA DE FONTE (ver README): hoje lê do site da Defesa Civil (nível 3).
// Para promover a nível 1/2 (CEMADEN/ANA direto por API), ver README — precisa de
// credencial que só o Marcos cria (cadastro na ANA/CEMADEN).

const BASE = 'https://defesacivil.brusque.sc.gov.br';
const TABELA = `${BASE}/monitoramento/tabela`;
const HOME = `${BASE}/monitoramento`;
const TTL = 300; // 5 min

const CORS = {
  'Access-Control-Allow-Origin': '*', // trocar pelo domínio do site ao publicar
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&aacute;/g, 'á').replace(/\s+/g, ' ').trim();
const num = (s) => {
  const m = (s || '').replace(/\./g, '').match(/-?\d+,?\d*/); // pt-BR: vírgula decimal
  return m ? parseFloat(m[0].replace(',', '.')) : null;
};

function parseTabela(html) {
  // cabeçalhos (o thead do site usa <td>, não <th>):
  // Estação | Fonte | Experimental | Coleta | Nível | Chuva Atual | Temp |
  // Última hora | 6 horas | 12 horas | 24 horas | 48 horas
  let headers = [];
  const th = html.match(/<thead>([\s\S]*?)<\/thead>/i);
  if (th) headers = [...th[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => stripTags(m[1]));

  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  const scope = body ? body[1] : html;
  const rows = [...scope.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const estacoes = [];
  for (const r of rows) {
    const tds = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => stripTags(m[1]));
    if (tds.length < 5) continue;
    const [nome, fonte, exp, coleta, nivel, ...resto] = tds;
    // objeto completo rotulado pelo header (Chuva Atual, Temp, 24 horas, …)
    const valores = {};
    resto.forEach((v, i) => { valores[headers[5 + i] || `col${5 + i}`] = v; });
    estacoes.push({
      nome, fonte,
      experimental: /sim/i.test(exp),
      coleta,
      nivel: nivel === '-' ? null : num(nivel),
      temp: num(valores['Temp']),
      chuva_atual: num(valores['Chuva Atual']),
      chuva_24h: num(valores['24 horas']),
      valores,
    });
  }
  return estacoes;
}

function parseRio(html) {
  // <p title="Nível do rio: 0,90 metros | Dado coletado em 28/07 às 06:30">
  const m = html.match(/N[íi]vel do rio:\s*([\d.,]+)\s*metros[^"]*coletado em\s*([^"]+)"/i);
  return {
    nivel_m: m ? num(m[1]) : null,
    coleta: m ? m[2].trim() : null,
    fonte: 'ANA',
  };
}

async function build() {
  const [tRes, hRes] = await Promise.all([
    fetch(TABELA, { cf: { cacheTtl: TTL } }),
    fetch(HOME, { cf: { cacheTtl: TTL } }),
  ]);
  const [tHtml, hHtml] = await Promise.all([tRes.text(), hRes.text()]);
  return {
    updated: new Date().toISOString(),
    fonte: 'Defesa Civil de Brusque (CEMADEN + CMID + ANA)',
    rio: parseRio(hHtml),
    estacoes: parseTabela(tHtml),
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (!/\/estacoes\.json$/.test(url.pathname)) {
      return new Response('Use GET /estacoes.json', { status: 404, headers: CORS });
    }

    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}/estacoes.json`);
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    let data;
    try {
      data = await build();
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const resp = new Response(JSON.stringify(data), {
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8',
                 'Cache-Control': `public, max-age=${TTL}` },
    });
    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  },
};
