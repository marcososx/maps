// Proxy de tiles de trânsito (TomTom Traffic Flow) para o Brusque Discover.
// O usuário NUNCA fala com a TomTom — só com este Worker, que cacheia respeitando
// o Cache-Control da TomTom (TTL curto). A key vive como secret `TOMTOM_KEY`.
//
// Suporta as DUAS gerações da TomTom (pra descobrir qual a conta usa) via query:
//   /traffic/{z}/{x}/{y}.png                  -> clássico v4, estilo "relative"
//   /traffic/{z}/{x}/{y}.png?api=orbis        -> Orbis, estilo "flow-relative_dark"
//   ...?style=absolute  /  ?style=flow-absolute_dark  etc. (override do estilo)
// Em erro, devolve o corpo real da TomTom pra facilitar o diagnóstico.

const CORS = {
  'Access-Control-Allow-Origin': '*', // trocar pelo domínio do site ao publicar
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function upstreamURL(api, z, x, y, key, style) {
  if (api === 'orbis') {
    const s = style || 'flow-relative_dark';
    return `https://api.tomtom.com/maps/orbis/traffic/tile/flow/${z}/${x}/${y}.png` +
           `?apiVersion=1&key=${key}&style=${s}&tileSize=256`;
  }
  // clássico v4 — estilos: absolute | relative | relative-delay | reduced-sensitivity
  const s = style || 'relative';
  // Espessura da linha (TomTom "queima" no tile via ?thickness=1..20). Como o
  // Worker recebe o zoom `z`, escala por nível: FINO no zoom-out, cheio no
  // zoom-in. Mantém 8 (valor antigo) nos zooms próximos; afina só ao afastar.
  //   z≤9→2 · z10→3 · z11→4 · z12→5 · z13→6 · z14→7 · z15+→8
  const t = Math.max(2, Math.min(8, (+z) - 7));
  return `https://api.tomtom.com/traffic/map/4/tile/flow/${s}/${z}/${x}/${y}.png` +
         `?key=${key}&thickness=${t}`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const m = url.pathname.match(/^\/traffic\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (!m) return new Response('Not found', { status: 404, headers: CORS });
    if (!env.TOMTOM_KEY) {
      return new Response('Falta o secret TOMTOM_KEY', { status: 500, headers: CORS });
    }

    const [, z, x, y] = m;
    const api = url.searchParams.get('api') || 'classic';
    const style = url.searchParams.get('style') || '';

    // cache compartilhado por (api/style/z/x/y), sem a key
    const cacheKey = new Request(`${url.origin}${url.pathname}?api=${api}&style=${style}`);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const upstream = await fetch(upstreamURL(api, z, x, y, env.TOMTOM_KEY, style));
    if (!upstream.ok) {
      const body = await upstream.text();
      return new Response(`TomTom ${upstream.status}: ${body}`,
        { status: upstream.status, headers: { ...CORS, 'Content-Type': 'text/plain' } });
    }

    const resp = new Response(upstream.body, upstream);
    if (!resp.headers.get('Cache-Control')) resp.headers.set('Cache-Control', 'public, max-age=60');
    resp.headers.set('Content-Type', 'image/png');
    for (const [k, v] of Object.entries(CORS)) resp.headers.set(k, v);
    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  },
};
