// Worker: voos em tempo real num raio de 100 km de Brusque — Airplanes.live (ADS-B).
// Proxy com CORS para a API pública de posições (rede comunitária de receptores
// ADS-B), consultada por ponto central (Brusque) + raio e filtrada por distância
// ≤ 100 km (haversine). Serve JSON limpo, ordenado por distância.
//
//   GET /voos.json -> { updated, fonte, centro, raio_km, voos:[{icao24,callsign,
//                        lat,lon,alt_m,vel_kmh,rumo,subida_mps,no_solo,tipo,desc,
//                        categoria,dist_km,ultima_atualizacao}] }
//
// Por que Airplanes.live e não OpenSky/ADSB.lol/adsb.fi: OpenSky bloqueia IPs
// de datacenter/Workers (522), ADSB.lol rate-limita por IP (429) e adsb.fi
// retorna 403 de Workers Cloudflare. Airplanes.live (roda atrás de Cloudflare,
// 1 req/s, sem chave) responde de Workers normalmente.

const ADSB = 'https://api.airplanes.live/v2/point';
const TTL = 2; // 2 s — posições quase em tempo real (poucos usuários; ~0,5 req/s)

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

// Centro do círculo: Brusque. Raio de 100 km.
const CENTRO = { lat: -27.0977, lon: -48.9172 };
const RAIO_KM = 100;
const DIST_NM = 60; // margem na consulta (~111 km) p/ filtrar com precisão no worker

const FT_M = 0.3048, KT_KMH = 1.852;   // conversões: pés→m, nós→km/h

function num(x) { return (x === null || x === undefined) ? null : Number(x); }

// distância haversine em km entre dois pontos
function distKm(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchADSB() {
  const u = `${ADSB}/${CENTRO.lat}/${CENTRO.lon}/${DIST_NM}`;
  const r = await fetch(u, { cf: { cacheTtl: TTL } });
  if (!r.ok) throw new Error(`Airplanes.live HTTP ${r.status}`);
  return r.json();
}

function build(d) {
  const voos = (d.ac || [])
    .filter(a => a.lat != null && a.lon != null)
    .map(a => {
      const dist = distKm(CENTRO.lat, CENTRO.lon, a.lat, a.lon);
      return {
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
        tipo: a.t || null,                          // tipo ICAO (ex.: A332, E295)
        desc: a.desc || null,                       // descrição (ex.: AIRBUS A-330-200)
        categoria: a.category || null,              // categoria ADS-B (ex.: A3, B6)
        dist_km: Math.round(dist * 10) / 10,
        ultima_atualizacao: a.seen != null ? new Date(Date.now() - a.seen * 1000).toISOString() : null,
      };
    })
    .filter(v => v.dist_km <= RAIO_KM)             // só dentro do círculo de 100 km
    .sort((a, b) => a.dist_km - b.dist_km);        // mais perto primeiro
  return voos;
}

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  if (url.pathname !== '/voos.json') {
    return new Response(JSON.stringify({ erro: 'use GET /voos.json' }), { status: 404, headers: CORS });
  }
  const CACHE_V = '8';
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
    centro: CENTRO,
    raio_km: RAIO_KM,
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
