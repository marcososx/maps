// Worker: status operacional de pista (METAR → categoria de voo) dos aeroportos
// no raio de 100 km de Brusque, pro mapa Brusque Discover.
//
//   GET /metar.json -> { updated, fonte, aeroportos:{ SBFL:{...}, SBNF:{...} } }
//
// Cada aeroporto vem com a categoria de voo (VFR/MVFR/IFR/LIFR) calculada do
// teto (nuvens BKN/OVC mais baixas) + visibilidade — o "semáforo" que diz se a
// pista opera normal ou está apertada/fechada por mau tempo (nevoeiro = FG/BR).
//
// Fonte: aviationweather.gov (NOAA/AWC), API pública sem chave, com CORS.
// Só publicam METAR de verdade os aeroportos de médio porte — SBFL (Florianópolis)
// e SBNF (Navegantes). SSBL/SSLN entram na consulta mas normalmente voltam sem
// dado; o front simplesmente não mostra selo de status neles.

// OACIs consultados = os aeroportos do brusque_aerodromos.geojson dentro de 100 km.
const ICAOS = ['SBFL', 'SBNF', 'SSBL', 'SSLN'];
const AWC = 'https://aviationweather.gov/api/data/metar';
const TTL = 5 * 60; // 5 min — METAR sai de hora em hora (SPECI fora de hora em mau tempo)

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

// Cores no padrão do mapa (verde/azul/vermelho/magenta).
const CAT = {
  VFR:  { rotulo: 'VFR',  cor: '#00E676', desc: 'Céu bom — opera normal',        pisca: false },
  MVFR: { rotulo: 'MVFR', cor: '#4FC3F7', desc: 'Marginal — começa a apertar',   pisca: true  },
  IFR:  { rotulo: 'IFR',  cor: '#FF9500', desc: 'Só por instrumentos — atrasos', pisca: true  },
  LIFR: { rotulo: 'LIFR', cor: '#FF3B30', desc: 'Teto/vis. no chão — pista fecha', pisca: true },
};

// Fenômenos de tempo mais comuns que travam pista (tradução do wxString).
const FENOMENOS = {
  FG: 'Nevoeiro', BR: 'Névoa úmida', HZ: 'Névoa seca', BCFG: 'Bancos de nevoeiro',
  MIFG: 'Nevoeiro raso', TS: 'Trovoada', TSRA: 'Trovoada c/ chuva', RA: 'Chuva',
  '+RA': 'Chuva forte', SHRA: 'Pancada de chuva', DZ: 'Garoa', FZFG: 'Nevoeiro congelante',
};

// visib da AWC vem em milhas terrestres (SM): número, ou string tipo "6+"/"10+"/"0.5".
function visSM(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const m = String(v).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

// teto = base (ft) da camada BKN/OVC/VV mais baixa; sem essas camadas = sem teto.
function tetoFt(clouds) {
  if (!Array.isArray(clouds)) return null;
  let t = null;
  for (const c of clouds) {
    if (['BKN', 'OVC', 'OVX', 'VV'].includes(c.cover) && c.base != null) {
      t = t == null ? c.base : Math.min(t, c.base);
    }
  }
  return t;
}

// Categoria de voo padrão (teto em ft + visibilidade em SM).
function categoria(teto, vis) {
  const t = teto == null ? Infinity : teto;
  const v = vis == null ? Infinity : vis;
  if (t < 500  || v < 1) return 'LIFR';
  if (t < 1000 || v < 3) return 'IFR';
  if (t <= 3000 || v <= 5) return 'MVFR';
  return 'VFR';
}

function fenomenos(wxString) {
  if (!wxString) return null;
  const toks = wxString.trim().split(/\s+/);
  const nomes = toks.map(t => FENOMENOS[t] || FENOMENOS[t.replace(/^[+-]/, '')] || null).filter(Boolean);
  return nomes.length ? [...new Set(nomes)].join(', ') : null;
}

function ventoStr(wdir, wspd) {
  if (wspd == null) return null;
  if (wspd === 0) return 'Calmo';
  const dir = (wdir == null || wdir === 'VRB') ? 'VRB' : String(wdir).padStart(3, '0') + '°';
  return `${dir} / ${wspd} kt`;
}

function build(arr) {
  const out = {};
  for (const m of (arr || [])) {
    const teto = tetoFt(m.clouds);
    const vis = visSM(m.visib);
    const cat = categoria(teto, vis);
    const meta = CAT[cat];
    out[m.icaoId] = {
      oaci: m.icaoId,
      categoria: cat,
      cor: meta.cor,
      rotulo: meta.rotulo,
      situacao: meta.desc,
      pisca: meta.pisca,                       // front pisca o selo se true (≠ VFR)
      teto_ft: teto,                           // null = teto acima de 12.000 ft / sem camada
      teto_txt: teto == null ? 'Sem teto significativo' : `${teto} ft`,
      vis_sm: vis,
      vis_txt: vis == null ? '—' : (vis >= 6 ? '≥ 10 km' : `${(vis * 1.609).toFixed(1)} km`),
      vento: ventoStr(m.wdir, m.wspd),
      temp_c: m.temp != null ? Math.round(m.temp) : null,
      orvalho_c: m.dewp != null ? Math.round(m.dewp) : null,
      fenomeno: fenomenos(m.wxString),         // "Nevoeiro", "Trovoada c/ chuva"...
      metar: m.rawOb || null,
      hora: m.reportTime || (m.obsTime ? new Date(m.obsTime * 1000).toISOString() : null),
    };
  }
  return out;
}

async function fetchMetar() {
  const u = `${AWC}?ids=${ICAOS.join(',')}&format=json`;
  const r = await fetch(u, { cf: { cacheTtl: TTL }, headers: { 'User-Agent': 'brusque-discover/1.0' } });
  if (!r.ok) throw new Error(`AWC HTTP ${r.status}`);
  return r.json();
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (url.pathname !== '/metar.json') {
      return new Response(JSON.stringify({ erro: 'use GET /metar.json' }), { status: 404, headers: CORS });
    }
    const cache = caches.default;
    const cached = await cache.match(req);
    if (cached) return cached;

    let body;
    try {
      const arr = await fetchMetar();
      body = JSON.stringify({
        updated: new Date().toISOString(),
        fonte: 'aviationweather.gov (NOAA/AWC) · METAR',
        legenda: {
          VFR: CAT.VFR, MVFR: CAT.MVFR, IFR: CAT.IFR, LIFR: CAT.LIFR,
        },
        aeroportos: build(arr),
      });
    } catch (e) {
      return new Response(JSON.stringify({ erro: 'AWC indisponível', detalhe: String(e.message || e) }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const res = new Response(body, {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` },
    });
    ctx.waitUntil(cache.put(req, res.clone()));
    return res;
  },
};
