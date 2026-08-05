// Worker: voos em tempo real sobre a região de Brusque — Airplanes.live (ADS-B).
// Proxy com CORS para a API pública de posições (rede comunitária de receptores
// ADS-B), consultada por ponto central + raio (NM) e filtrada pelo bbox da
// região monitorada (a mesma do radar/nuvens). Serve JSON limpo.
//
//   GET /voos.json -> { updated, fonte, bbox, voos:[{icao24,callsign,origem,
//                        lat,lon,alt_m,vel_kmh,rumo,subida_mps,no_solo,
//                        categoria,ultima_atualizacao}] }
//
// Por que Airplanes.live e não OpenSky/ADSB.lol/adsb.fi: OpenSky bloqueia IPs
// de datacenter/Workers (522), ADSB.lol rate-limita por IP (429) e adsb.fi
// retorna 403 de Workers Cloudflare. Airplanes.live (roda atrás de Cloudflare,
// 1 req/s, sem chave) responde de Workers normalmente.

const ADSB = 'https://api.airplanes.live/v2/point';
const TTL = 120; // 2 min

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

// Bounding box da região monitorada (Brusque + 28 cidades vizinhas + bacia do
// Itajaí-Mirim) — mesmos limites do brusque_regiao.geojson usados no radar.
const BBOX = { lamin: -27.7017, lomin: -49.5560, lamax: -26.5413, lomax: -48.4015 };
const CENTRO = { lat: -27.1215, lon: -48.9787 };
const DIST_NM = 60; // ~111 km — cobre a região inteira (meia-diagonal ~49 NM)

const FT_M = 0.3048, KT_KMH = 1.852;   // conversões: pés→m, nós→km/h

function num(x) { return (x === null || x === undefined) ? null : Number(x); }

async function fetchADSB() {
  const u = `${ADSB}/${CENTRO.lat}/${CENTRO.lon}/${DIST_NM}`;
  const r = await fetch(u, { cf: { cacheTtl: TTL } });
  if (!r.ok) throw new Error(`Airplanes.live HTTP ${r.status}`);
  return r.json();
}

function build(d) {
  const dentro = (lat, lon) => lat != null && lon != null
    && lat >= BBOX.lamin && lat <= BBOX.lamax
    && lon >= BBOX.lomin && lon <= BBOX.lomax;
  const voos = (d.ac || [])
    .filter(a => dentro(a.lat, a.lon))          // só dentro da região monitorada
    .map(a => ({
      icao24: a.hex || null,
      callsign: (a.flight || '').trim() || null,
      origem: null,                              // Airplanes.live não informa país
      lat: num(a.lat),
      lon: num(a.lon),
      alt_m: a.alt_geom != null ? Math.round(a.alt_geom * FT_M)
           : a.alt_baro != null ? Math.round(a.alt_baro * FT_M) : null,
      vel_kmh: a.gs != null ? Math.round(a.gs * KT_KMH) : null,
      rumo: num(a.track),
      subida_mps: a.baro_rate != null ? Math.round(a.baro_rate / 196.85 * 10) / 10 : null, // fpm→m/s
      no_solo: a.alt_baro == null,
      categoria: a.category || null,             // categoria ICAO (ex.: A3, B6)
      ultima_atualizacao: a.seen != null ? new Date(Date.now() - a.seen * 1000).toISOString() : null,
    }));
  return voos;
}

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  if (url.pathname !== '/voos.json') {
    return new Response(JSON.stringify({ erro: 'use GET /voos.json' }), { status: 404, headers: CORS });
  }
  const CACHE_V = '4';
  const ck = new URL(req.url); ck.searchParams.set('_v', CACHE_V);
  const cacheReq = new Request(ck);
  const cache = caches.default;
  const cached = await cache.match(cacheReq);
  if (cached) return cached;

  let voos = [];
  try {
    const d = await fetchADSB();
    voos = build(d);
  } catch (e) {
    return new Response(JSON.stringify({ erro: 'Airplanes.live indisponível', detalhe: String(e.message || e) }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const body = JSON.stringify({
    updated: new Date().toISOString(),
    fonte: 'Airplanes.live (ADS-B open data)',
    bbox: BBOX,
    voos,
  });
  const res = new Response(body, {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` },
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
