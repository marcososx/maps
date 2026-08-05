// Worker PÚBLICO do Painel de Crise Brusque Discover.
// Serve o dashboard (assets estáticos) + API de leitura dos boletins/estado
// gravados pelo painel admin (worker brusque-crise-admin) via KV compartilhado.
//
//   GET /api/estado   -> { nivel_alerta, status_cobertura, atualizado_em }
//   GET /api/boletins -> [ { id, titulo, conteudo, url, label, categoria,
//                           prioridade, fixado, criado_em }, ... ]
//   GET /api/ticker   -> últimas 10 notícias do portal (placeholder)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const cache = { ttl: 0, body: null, etag: null };

async function readJson(env, key, fallback) {
  const raw = await env.CRISE_KV.get(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (url.pathname === '/api/estado') {
      const e = await readJson(env, 'estado', {});
      return Response.json({
        nivel_alerta: e.nivel_alerta || 'Normalidade',
        status_cobertura: e.status_cobertura || 'Estamos de plantão QG Discover',
        atualizado_em: e.atualizado_em || null,
      }, { headers: CORS });
    }
    if (url.pathname === '/api/boletins') {
      const b = await readJson(env, 'boletins', []);
      return Response.json(b, { headers: CORS });
    }
    if (url.pathname === '/api/ticker') {
      // placeholder: últimas notícias do portal Brusque Discover
      const t = await readJson(env, 'ticker', []);
      return Response.json(t, { headers: CORS });
    }
    // fallback: assets estáticos (index.html, css, etc.)
    return env.ASSETS.fetch(request);
  },
};
