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
const ADSBDB = 'https://api.adsbdb.com/v0/callsign';   // rota (origem/destino/cia)
const TTL = 2; // 2 s — posições quase em tempo real (poucos usuários; ~0,5 req/s)
const ROUTE_TTL = 3600; // 1 h — rota de um callsign raramente muda

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

// Trajetórias acumuladas no worker: cada consulta (a cada ~2 s) acrescenta a
// posição do avião ao histórico dele, só dentro do raio de 100 km. Assim, ao
// ativar a camada o front já recebe o progresso que o voo correu (e continua).
const _trails = {};            // icao24 -> [ [lon,lat], ... ] (mais recente no fim)
const _trailLast = {};         // icao24 -> ms da última vez visto (p/ não apagar em gap)

// ── Persistência do rastro em KV ────────────────────────────────────────────
// O Cloudflare recicla o isolate do worker com frequência; sem isso o rastro
// (em memória) era zerado a cada reciclagem → aviões ficavam "sem rastro".
// Aqui salvamos o histórico no KV (a cada ~12 s) e recarregamos ao subir.
const KV_TRAILS_KEY = 'trails:v1';
let _kvLoaded = false, _kvLastSave = 0;
async function kvLoad(env) {
  if (_kvLoaded || !env.VOOS_KV) return;
  _kvLoaded = true;
  try {
    const raw = await env.VOOS_KV.get(KV_TRAILS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      for (const k in (d.trails || {})) _trails[k] = d.trails[k];
      for (const k in (d.last || {})) _trailLast[k] = d.last[k];
    }
  } catch (e) {}
}
// salva o rastro no KV (throttle de ~10 s, AWAIT direto — sem setTimeout que pode
// não disparar se o isolate for congelado; assim a gravação é garantida)
async function kvMaybeSave(env) {
  if (!env.VOOS_KV) return;
  const now = Date.now();
  if (now - _kvLastSave < 10000) return;
  _kvLastSave = now;
  try {
    await env.VOOS_KV.put(KV_TRAILS_KEY,
      JSON.stringify({ trails: _trails, last: _trailLast }), { expirationTtl: 86400 });
  } catch (e) {}
}
const _TRAIL_MAX = 300;        // ≈ 10 min a 2 s de poll
const _TRAIL_STEP = 0.001;     // mínimo de deslocamento (graus) p/ registrar ponto

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

// proa (0= norte, sentido horário) do ponto 1 ao ponto 2, em graus
function bearingKm(lat1, lon1, lat2, lon2) {
  const f1 = lat1 * Math.PI / 180, f2 = lat2 * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

async function fetchADSB() {
  const u = `${ADSB}/${CENTRO.lat}/${CENTRO.lon}/${DIST_NM}`;
  const r = await fetch(u, { cf: { cacheTtl: TTL } });
  if (!r.ok) throw new Error(`Airplanes.live HTTP ${r.status}`);
  return r.json();
}

// rota de um callsign via adsbdb (origem/destino/companhia) — cache de 1 h
async function routeFor(callsign, cache, ctx) {
  if (!callsign) return null;
  const ck = new URL(`https://brusque-voos/rota/${encodeURIComponent(callsign)}`);
  const cacheReq = new Request(ck);
  try {
    const cached = await cache.match(cacheReq);
    if (cached) return cached.json();
  } catch (e) {}
  let route = null;
  try {
    const r = await fetch(`${ADSBDB}/${encodeURIComponent(callsign)}`, { cf: { cacheTtl: ROUTE_TTL } });
    if (r.ok) {
      const d = await r.json();
      const fr = d && d.response && d.response.flightroute;
      if (fr) {
        route = {
          origem: fr.origin ? { iata: fr.origin.iata_code || null, icao: fr.origin.icao_code || null,
                                nome: fr.origin.name || null, municipio: fr.origin.municipality || null,
                                lat: fr.origin.latitude != null ? num(fr.origin.latitude) : null,
                                lon: fr.origin.longitude != null ? num(fr.origin.longitude) : null } : null,
          destino: fr.destination ? { iata: fr.destination.iata_code || null, icao: fr.destination.icao_code || null,
                                      nome: fr.destination.name || null, municipio: fr.destination.municipality || null,
                                      lat: fr.destination.latitude != null ? num(fr.destination.latitude) : null,
                                      lon: fr.destination.longitude != null ? num(fr.destination.longitude) : null } : null,
          cia: fr.airline ? { icao: fr.airline.icao || null, iata: fr.airline.iata || null, nome: fr.airline.name || null } : null,
        };
      }
    }
  } catch (e) {}
  try {
    const res = new Response(JSON.stringify(route), { headers: { 'Content-Type': 'application/json' } });
    ctx.waitUntil(cache.put(cacheReq, res.clone(), { expirationTtl: ROUTE_TTL }));
  } catch (e) {}
  return route;
}

function build(d) {
  const voos = (d.ac || [])
    .filter(a => a.lat != null && a.lon != null)
    .map(a => {
      const dist = distKm(CENTRO.lat, CENTRO.lon, a.lat, a.lon);
      return {
        icao24: a.hex || null,
        callsign: (a.flight || '').trim() || null,
        origem: null,                              // preenchido via adsbdb (rota)
        destino: null,
        cia: null,
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
  await kvLoad(env);   // recupera o rastro acumulado (sobrevive a restart de isolate)
  const CACHE_V = '9';
  const ck = new URL(req.url); ck.searchParams.set('_v', CACHE_V);
  const cacheReq = new Request(ck);
  const cache = caches.default;
  const cached = await cache.match(cacheReq);
  if (cached) return cached;

  let voos = [];
  try {
    const d = await fetchADSB();
    voos = build(d);
    // enriquece cada voo com rota (origem/destino/companhia) via adsbdb,
    // consultando 1x por callsign único (cache de 1 h no worker)
    const unicos = [...new Set(voos.map(v => v.callsign).filter(Boolean))];
    const rotas = {};
    await Promise.all(unicos.map(async cs => { rotas[cs] = await routeFor(cs, cache, ctx); }));
    for (const v of voos) {
      const r = rotas[v.callsign];
      if (r) {
        v.origem = r.origem; v.destino = r.destino; v.cia = r.cia;
        // sanidade do destino: se a DIREÇÃO do voo aponta longe do destino da
        // escala (>90°), a rota do adsbdb divergiu do voo real (flight number
        // reutilizado em outra rota no dia) → remove o destino falso.
        // A direção vem do rastro recente (ponto ~20 amostras atrás → atual),
        // que é imune a curva pontual (ex: aproximação virando pra pista).
        if (v.destino && v.destino.lat != null) {
          let hdg = null;
          const arr = _trails[v.icao24];
          if (arr && arr.length >= 2) {
            const a = arr[Math.max(0, arr.length - 21)];
            hdg = bearingKm(a[1], a[0], v.lat, v.lon);
          } else if (v.rumo != null) {
            hdg = v.rumo;
          }
          if (hdg != null) {
            const b = bearingKm(v.lat, v.lon, v.destino.lat, v.destino.lon);
            let dd = Math.abs(hdg - b) % 360; if (dd > 180) dd = 360 - dd;
            if (dd > 90) v.destino = null;
          }
        }
      }
    }
    // atualiza o histórico de posição de cada voo (só dentro do raio) e anexa
    const seen = new Set();
    const now = Date.now();
    for (const v of voos) {
      if (!v.icao24 || v.lat == null || v.lon == null) continue;
      seen.add(v.icao24);
      _trailLast[v.icao24] = now;
      const arr = _trails[v.icao24] || (_trails[v.icao24] = []);
      const last = arr[arr.length - 1];
      if (!last || Math.abs(last[0] - v.lon) > _TRAIL_STEP || Math.abs(last[1] - v.lat) > _TRAIL_STEP) {
        arr.push([v.lon, v.lat]);
        if (arr.length > _TRAIL_MAX) arr.shift();
      }
      v.trail = arr.slice();
    }
    // limpa trilhas de aviões que sumiram há mais de ~3 min (tolerância a gaps
    // de dados — senão um voo que some por instante perde o rastro completo)
    for (const k in _trails) if (!seen.has(k) && (now - (_trailLast[k]||0)) > 180000) delete _trails[k];
    await kvMaybeSave(env);   // persiste o rastro (sobrevive a restart de isolate)
  } catch (e) {
    return new Response(JSON.stringify({ erro: 'Airplanes.live indisponível', detalhe: String(e.message || e) }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const body = JSON.stringify({
    updated: new Date().toISOString(),
    fonte: 'Airplanes.live (ADS-B open data) + adsbdb (rotas)',
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
