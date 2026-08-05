// Worker: índice ENSO (Niño 3.4) para o mapa Brusque Discover.
// O NOAA CPC não manda CORS, então este Worker faz o proxy e serve JSON limpo.
//
//   GET /enso.json -> { valor, classe, rotulo, atualizado, fonte }
//
// Fonte: https://www.cpc.ncep.noaa.gov/data/indices/sstoi.indices
//   (anomalia semanal Niño 3.4; última linha do arquivo, coluna 10)

const NOAA = 'https://www.cpc.ncep.noaa.gov/data/indices/sstoi.indices';
const TTL = 6 * 60 * 60; // 6h (dado semanal)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

function classifica(v) {
  if (v >= 2.0) return { classe: 'muito_forte', rotulo: 'El Niño muito forte' };
  if (v >= 1.5) return { classe: 'forte', rotulo: 'El Niño forte' };
  if (v >= 1.0) return { classe: 'moderado', rotulo: 'El Niño moderado' };
  if (v >= 0.5) return { classe: 'fraco', rotulo: 'El Niño fraco' };
  if (v > -0.5) return { classe: 'neutro', rotulo: 'Neutro' };
  if (v > -1.0) return { classe: 'la_fraco', rotulo: 'La Niña fraca' };
  if (v > -1.5) return { classe: 'la_moderado', rotulo: 'La Niña moderada' };
  return { classe: 'la_forte', rotulo: 'La Niña forte' };
}

async function fetchENSO() {
  const r = await fetch(NOAA, { cf: { cacheTtl: TTL } });
  const txt = await r.text();
  const linhas = txt.split('\n').filter(l => /^\s*\d{4}\s+\d{1,2}\s+/.test(l));
  if (!linhas.length) throw new Error('sem dados NOAA');
  const ultima = linhas[linhas.length - 1].trim().split(/\s+/);
  // colunas: YR MON NINO1+2 ANOM NINO3 ANOM NINO4 ANOM NINO3.4 ANOM
  const valor = parseFloat(ultima[9]);
  if (isNaN(valor)) throw new Error('coluna NINO3.4 não encontrada');
  return { valor, ano: ultima[0], mes: ultima[1] };
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (url.pathname !== '/enso.json') {
      return new Response(JSON.stringify({ erro: 'use GET /enso.json' }), { status: 404, headers: CORS });
    }
    const cache = caches.default;
    const cached = await cache.match(req);
    if (cached) return cached;

    let body;
    try {
      const d = await fetchENSO();
      const c = classifica(d.valor);
      body = JSON.stringify({
        valor: d.valor,
        classe: c.classe,
        rotulo: c.rotulo,
        periodo: `${d.mes}/${d.ano}`,
        atualizado: new Date().toISOString(),
        fonte: 'NOAA CPC · Niño 3.4 (semanal)',
      });
    } catch (e) {
      return new Response(JSON.stringify({ erro: 'NOAA indisponível', detalhe: String(e.message || e) }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const res = new Response(body, { headers: { ...CORS, 'Content-Type': 'application/json' } });
    ctx.waitUntil(cache.put(req, res.clone()));
    return res;
  },
};
