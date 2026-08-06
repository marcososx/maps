// Proxy + cache das imagens de satélite (Esri World Imagery) para o Brusque Discover.
// O usuário NUNCA fala com a Esri — só com este Worker, que cacheia no edge do
// Cloudflare (Cache API) com TTL longo: imagem de satélite quase não muda, então
// cada tile/snapshot é baixado da Esri UMA vez e reusado por todas as sessões.
//
//   /tile/{z}/{y}/{x}             -> tile individual (256px, JPEG)
//   /export?bbox=<merc>&size=W,H  -> snapshot único de uma área (JPEG), bbox em Web Mercator

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const ESRI_TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/';
const ESRI_EXPORT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export';
const TTL = 30 * 24 * 60 * 60; // 30 dias

async function cachedFetch(ctx, cacheKey, upstream, contentType) {
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const up = await fetch(upstream);
  if (!up.ok) {
    const body = await up.text();
    return new Response(`Esri ${up.status}: ${body.slice(0, 300)}`,
      { status: up.status, headers: { ...CORS, 'Content-Type': 'text/plain' } });
  }
  const resp = new Response(up.body, up);
  if (!resp.headers.get('Content-Type')) resp.headers.set('Content-Type', contentType);
  resp.headers.set('Cache-Control', `public, max-age=${TTL}`);
  for (const [k, v] of Object.entries(CORS)) resp.headers.set(k, v);
  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // tile individual: /tile/{z}/{y}/{x}
    const m = url.pathname.match(/^\/tile\/(\d+)\/(\d+)\/(\d+)$/);
    if (m) {
      const [, z, y, x] = m;
      const cacheKey = new Request(`${url.origin}/tile/${z}/${y}/${x}`);
      return cachedFetch(ctx, cacheKey, ESRI_TILE + `${z}/${y}/${x}`, 'image/jpeg');
    }

    // snapshot único: /export?bbox=..&size=W,H
    if (url.pathname === '/export') {
      const bbox = url.searchParams.get('bbox');
      const size = url.searchParams.get('size') || '1024,768';
      if (!bbox) return new Response('falta bbox (Web Mercator)', { status: 400, headers: CORS });
      const cacheKey = new Request(`${url.origin}/export?bbox=${bbox}&size=${size}`);
      const upstream = `${ESRI_EXPORT}?bbox=${bbox}&bboxSR=102100&imageSR=102100`
        + `&size=${size}&format=jpg&f=image&transparent=false&layers=show:0`;
      return cachedFetch(ctx, cacheKey, upstream, 'image/jpeg');
    }

    return new Response('brusque-satelite: use /tile/{z}/{y}/{x} ou /export?bbox=..&size=W,H',
      { status: 404, headers: CORS });
  },
};
