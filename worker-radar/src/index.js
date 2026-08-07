// Worker brusque-radar: radar de precipitação vetorizado.
//
// Fonte: EPAGRI/CIRAM mosaico SC (prod=4, radar=COMP) — cobre ~750-900 km a
// oeste/sul de Brusque e ~250 km a leste/norte. PNG com paleta (920×719, cores
// de dBZ), transparência real no fundo.
//
// O Worker baixa os frames, decodifica o PNG (sem canvas), classifica cada
// pixel em 5 níveis de intensidade, gera contornos (marching squares + RDP) e
// devolve GeoJSON leve por nível — o front renderiza como camadas fill com
// transparência. Sem raster pesado no cliente.
//
//   GET /frames.json          -> { updated, fonte, ext, frames:[{time,file}] }
//   GET /frame/{arquivo}.json -> { time, ext, niveis:[{nivel,cor,opacidade,
//                                geometry:{MultiPolygon}}] }
//
// Cache: caches.default ~4 min (frames novos a cada ~5 min).

const EPAGRI_BASE = 'https://ciram.epagri.sc.gov.br/radar/rest/radar/';
const PROD = 4;       // COMP (mosaico SC)
const RADAR = 'COMP';
const EXT = [-58.0651, -33.8163, -46.4999, -24.7654];   // w,s,e,n
const TTL = 240;      // segundos de cache (frame a cada ~5 min)

// ── Classificação de intensidade (escala dBZ da EPAGRI → 5 níveis) ─────────
// Cores observadas no PNG do COMP. O cinza #C8C8C8 = sem sinal (descartado).
const NIVEL_POR_RGB = {
  '165,255,255': 1,   // A5FFFF  ciano clarinho
  '110,200,255': 1,   // 6EC8FF  ciano
  '55,145,255': 1,    // 3791FF  azul claro
  '0,90,255': 2,      // 005AFF  azul
  '170,255,0': 2,     // AAFF00  verde limão
  '128,206,0': 3,     // 80CE00  verde
  '85,156,0': 3,      // 559C00  verde médio
  '43,107,0': 4,      // 2B6B00  verde escuro
  '0,57,0': 4,        // 003900  verde muito escuro
  '255,255,0': 5,     // FFFF00  amarelo
  '255,192,0': 5,     // FFC000  laranja
  '255,128,0': 5,     // FF8000  laranja forte
  '255,64,0': 5,      // FF4000  vermelho-laranja
};

// Cor + opacidade de exibição por nível (semáforo do radar, escala própria).
const NIVEIS = [
  { nivel: 1, cor: '#DCEBF7', opacidade: 0.14, rotulo: 'Fraca' },
  { nivel: 2, cor: '#C9E0F2', opacidade: 0.16, rotulo: 'Moderada' },
  { nivel: 3, cor: '#AED3EE', opacidade: 0.18, rotulo: 'Forte' },
  { nivel: 4, cor: '#93C4E8', opacidade: 0.20, rotulo: 'Muito forte' },
  { nivel: 5, cor: '#7FB8E8', opacidade: 0.22, rotulo: 'Extrema' },
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// ── Decoder PNG mínimo (paleta 8-bit / 4-bit, filtros 0-4) ──────────────────
// Sem canvas no Worker: parseia chunks, descomprime o IDAT com
// DecompressionStream('deflate') e re-aplica os filtros de scanline.
async function decodePng(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 8;                       // pula assinatura
  let w = 0, h = 0, bd = 0, ct = 0;
  const plte = [], trns = [];
  let idat = [];
  while (pos < data.byteLength) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(...data.subarray(pos + 4, pos + 8));
    const body = data.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = dv.getUint32(pos + 8); h = dv.getUint32(pos + 12);
      bd = body[8]; ct = body[9];
    } else if (type === 'PLTE') {
      for (let i = 0; i + 2 < len; i += 3) plte.push([body[i], body[i + 1], body[i + 2]]);
    } else if (type === 'tRNS') {
      for (let i = 0; i < len; i++) trns.push(body[i]);
    } else if (type === 'IDAT') {
      idat.push(body);
    }
    pos += 12 + len;
  }
  if (ct !== 3) throw new Error('PNG não é paleta (color type ' + ct + ')');
  const raw = await inflate(new Uint8Array(idat.reduce((a, b) => {
    const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r;
  }, new Uint8Array(0))));

  // bytes por pixel de filtro: paleta usa sempre 1 byte/pixel (4-bit empacota)
  const bpp = 1;
  const stride = Math.ceil(w * bd / 8);
  const out = new Uint8Array(w * h);
  let p = 0;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const recon = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? recon[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + b) & 255;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pred) & 255;
      }
      recon[x] = v;
    }
    prev = recon;
    if (bd === 8) {
      out.set(recon, y * w);
    } else {
      for (let x = 0; x < w; x++) {
        const byte = recon[x >> 1];
        out[y * w + x] = (x & 1) ? (byte & 15) : (byte >> 4);
      }
    }
  }
  return { w, h, bd, paleta: plte, transparencia: trns, indices: out };
}

async function inflate(data) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

// ── Classificação → grid de níveis ──────────────────────────────────────────
function classificarNiveis(png) {
  const { w, h, bd, paleta, transparencia, indices } = png;
  const nv = new Uint8Array(w * h);
  const TRANSPARENTE = 150;
  for (let i = 0; i < w * h; i++) {
    const idx = indices[i];
    if (idx >= paleta.length) continue;
    if (transparencia[idx] !== undefined && transparencia[idx] < TRANSPARENTE) continue;
    const [r, g, b] = paleta[idx];
    if (r > 190 && g > 190 && b > 190) continue;            // cinza C8C8C8 = sem sinal
    const nivel = NIVEL_POR_RGB[r + ',' + g + ',' + b] || 0;
    nv[i] = nivel;
  }
  return { w, h, nv };
}

// ── Contornos por nível (marching squares binário + conexão de loops) ───────
function contornosNivel(w, h, nv, nivel) {
  // gera arestas de contorno: todo pixel interno (>= nivel) com vizinho externo
  const segs = [];
  const em = (x, y) => x >= 0 && y >= 0 && x < w && y < h && nv[y * w + x] >= nivel;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!em(x, y)) continue;
      if (!em(x - 1, y))     segs.push([[x, y], [x, y + 1]]);
      if (!em(x + 1, y))     segs.push([[x + 1, y], [x + 1, y + 1]]);
      if (!em(x, y - 1))     segs.push([[x, y], [x + 1, y]]);
      if (!em(x, y + 1))     segs.push([[x, y + 1], [x + 1, y + 1]]);
    }
  }
  // mapa ponto de grade -> arestas (contorno fechado: grau 2 em cada ponto)
  const key = (a) => a[0] + ',' + a[1];
  const map = new Map();
  segs.forEach((sg, i) => {
    for (const end of [0, 1]) {
      const k = key(sg[end]);
      const arr = map.get(k); if (!arr) { map.set(k, [i]); } else arr.push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop = [segs[i][0], segs[i][1]];
    let tail = segs[i][1];
    for (;;) {
      const cand = map.get(key(tail));
      let next = -1;
      for (const j of (cand || [])) {
        if (used[j]) continue;
        used[j] = 1; next = j; break;
      }
      if (next < 0) break;
      const other = segs[next][0][0] === tail[0] && segs[next][0][1] === tail[1]
        ? segs[next][1] : segs[next][0];
      loop.push(other); tail = other;
      if (loop[0][0] === tail[0] && loop[0][1] === tail[1]) break;  // fechou
    }
    if (loop[0][0] === loop[loop.length - 1][0] && loop[0][1] === loop[loop.length - 1][1]) {
      loop.pop();
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

// ── Polígonos (lon/lat), simplificação RDP e classificação exterior/buraco ──
function area2(ring) {            // área sinalizada (pixel coords) — shoelace
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return a / 2;
}
function rdp(points, eps) {
  if (points.length < 3) return points;
  let maxD = 0, idx = 0;
  const [ax, ay] = points[0], [bx, by] = points[points.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (len * len)));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const l = rdp(points.slice(0, idx + 1), eps);
    const r = rdp(points.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [points[0], points[points.length - 1]];
}
function pontoNoAnel(p, ring) {
  const [px, py] = p;
  let inR = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > py) !== (yj > py)) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inR = !inR;
  }
  return inR;
}

// suavização Chaikin (subdivide cada aresta 1x) — arredonda os contornos
function chaikin(ring) {
  if (ring.length < 4) return ring;
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const p0 = ring[(i - 1 + ring.length) % ring.length];
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    out.push([p0[0] * 0.25 + p1[0] * 0.75, p0[1] * 0.25 + p1[1] * 0.75]);
    out.push([p1[0] * 0.75 + p2[0] * 0.25, p1[1] * 0.75 + p2[1] * 0.25]);
  }
  return out;
}

function loopsParaMultiPolygon(loops, w, h, ext) {
  const [xw, ys, xe, yn] = ext;
  const toLonLat = (ring) => ring.map(([px, py]) => [
    xw + (px / (w - 1)) * (xe - xw),
    yn - (py / (h - 1)) * (yn - ys),
  ]);
  const EPS = 3.4;                     // px de tolerância (≈4,2 km no COMP) — contornos suaves
  const MIN_AREA_PX2 = 8;
  const feats = [];
  for (const loop of loops) {
    const ring = chaikin(rdp(loop, EPS));
    if (ring.length < 4) continue;
    if (Math.abs(area2(ring)) < MIN_AREA_PX2) continue;
    const extRing = toLonLat(ring);
    const aGeo = area2(extRing);       // lon/lat: exterior = anti-horário = positivo
    feats.push({ exterior: extRing, buraco: aGeo < 0 });
  }
  const exteriors = feats.filter(f => !f.buraco);
  const buracos = feats.filter(f => f.buraco);
  const partes = exteriors.map(e => {
    const holes = buracos.filter(b =>
      pontoNoAnel([b.exterior[0][0], b.exterior[0][1]], e.exterior));
    return { exterior: e.exterior, buracos: holes.map(h => h.exterior) };
  });
  // só polígonos com área geográfica mínima (remove ruído de 1 px)
  const valid = partes.filter(p => Math.abs(area2(p.exterior)) > 0.02);   // graus²
  return { type: 'MultiPolygon', coordinates: valid.map(p => [p.exterior, ...p.buracos]) };
}

// ── Orquestração dos frames ──────────────────────────────────────────────────
async function listaFrames() {
  const u = `${EPAGRI_BASE}getUltimasImagens?prod=${PROD}&radar=${RADAR}`;
  const r = await fetch(u, { cf: { cacheTtl: TTL }, headers: { 'User-Agent': 'brusque-discover/1.0' } });
  if (!r.ok) throw new Error('EPAGRI getUltimasImagens: ' + r.status);
  const arr = await r.json();
  if (!Array.isArray(arr) || !arr.length) throw new Error('EPAGRI sem frames');
  return arr;
}

async function processarFrame(file) {
  const im = await fetch(`${EPAGRI_BASE}getImagem?prod=${PROD}&radar=${RADAR}&file=${file}`, {
    cf: { cacheTtl: TTL }, headers: { 'User-Agent': 'brusque-discover/1.0' },
  });
  if (!im.ok) throw new Error('EPAGRI getImagem: ' + im.status);
  const buf = new Uint8Array(await im.arrayBuffer());
  const png = await decodePng(buf);
  const { w, h, nv } = classificarNiveis(png);
  const m = file.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  const time = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString() : null;
  const niveis = [];
  for (const cfg of NIVEIS) {
    const loops = contornosNivel(w, h, nv, cfg.nivel);
    if (!loops.length) continue;
    const geometry = loopsParaMultiPolygon(loops, w, h, EXT);
    if (!geometry.coordinates.length) continue;
    niveis.push({ nivel: cfg.nivel, cor: cfg.cor, opacidade: cfg.opacidade, rotulo: cfg.rotulo, geometry });
  }
  return { time, ext: EXT, niveis };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const json = (obj, extra) => new Response(JSON.stringify(obj), {
  headers: { ...CORS, ...extra, 'Content-Type': 'application/json; charset=utf-8' },
});

export { decodePng, classificarNiveis, contornosNivel, loopsParaMultiPolygon, NIVEIS, EXT };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      if (/\/frames\.json$/.test(url.pathname)) {
        const frames = await listaFrames();
        return json({ updated: new Date().toISOString(), fonte: 'EPAGRI/CIRAM · mosaico SC (COMP)', ext: EXT,
                      frames: frames.map(f => ({ time: f, file: f })) });
      }
      const m = url.pathname.match(/^\/frame\/([^/]+)\.json$/);
      if (m) {
        const file = decodeURIComponent(m[1]);
        const cache = caches.default;
        const ck = new Request(url.origin + url.pathname);
        const hit = await cache.match(ck);
        if (hit) return hit;
        const data = await processarFrame(file);
        const resp = json({ ...data, fonte: 'EPAGRI/CIRAM · mosaico SC (COMP)' },
          { 'Cache-Control': `public, max-age=${TTL}` });
        ctx.waitUntil(cache.put(ck, resp.clone()));
        return resp;
      }
      return json({ erro: 'Use GET /frames.json ou /frame/{arquivo}.json' }, { status: 404 });
    } catch (e) {
      return json({ erro: String(e) }, { status: 502 });
    }
  },
};
