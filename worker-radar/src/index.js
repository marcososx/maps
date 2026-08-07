// Worker brusque-radar: radar de precipitação vetorizado.
//
// Fonte: EPAGRI/CIRAM mosaico SC (prod=4, radar=COMP) — cobre ~750-900 km a
// oeste/sul de Brusque e ~250 km a leste/norte. PNG com paleta (920×719, cores
// de dBZ), transparência real no fundo.
//
// O Worker baixa os frames, decodifica o PNG (sem canvas), classifica cada
// pixel em N níveis de intensidade, gera contornos (marching squares + RDP +
// Chaikin) e devolve GeoJSON leve por nível — o front renderiza como camadas
// fill com transparência.
//
// Histórico + interpolação (07/08/2026):
//  - Os grids classificados de cada frame são guardados COMPRIMIDOS no KV
//    (RADAR_HIST), acumulando horas de história mesmo com a EPAGRI só
//    devolvendo ~7 frames (≈35 min).
//  - A timeline (frames.json) devolve os frames reais + SUB-FRAMES
//    INTERPOLADOS por média entre pares consecutivos (navegação fluida).
//  - /frame/{id}.json vetoriza um passo real ou interpolado.
//
//   GET /frames.json          -> { updated, fonte, ext, passos:[{id,time}] }
//   GET /frame/{id}.json      -> { time, ext, niveis:[{nivel,cor,opacidade,
//                                geometry:{MultiPolygon}}] }
//   GET /cache/clear          -> limpa cache+KV (debug)
//
// Cache: caches.default (frames reais e interpolados) + KV p/ grids.

const EPAGRI_BASE = 'https://ciram.epagri.sc.gov.br/radar/rest/radar/';
const PROD = 4;       // COMP (mosaico SC)
const RADAR = 'COMP';
const EXT = [-58.0651, -33.8163, -46.4999, -24.7654];   // w,s,e,n
const TTL = 240;      // segundos de cache (frame a cada ~5 min)
const KV_KEY = 'hist:v2';         // grid comprimido + lista de frames reais
const KV_MAX_FRAMES = 60;         // ≈5 h de histórico (1 frame a cada 5 min)
const INTERP_PER_GAP = 3;         // sub-frames por intervalo entre frames reais

// ── Classificação de intensidade (escala dBZ da EPAGRI → 8 níveis) ─────────
// Cores observadas no PNG do COMP. O cinza #C8C8C8 = sem sinal (descartado).
const NIVEL_POR_RGB = {
  '165,255,255': 1,   // A5FFFF  ciano clarinho
  '110,200,255': 2,   // 6EC8FF  ciano
  '55,145,255': 3,    // 3791FF  azul claro
  '0,90,255': 4,      // 005AFF  azul
  '170,255,0': 5,     // AAFF00  verde limão
  '128,206,0': 6,     // 80CE00  verde
  '85,156,0': 6,      // 559C00  verde médio
  '43,107,0': 7,      // 2B6B00  verde escuro
  '0,57,0': 7,        // 003900  verde muito escuro
  '255,255,0': 8,     // FFFF00  amarelo
  '255,192,0': 8,     // FFC000  laranja
  '255,128,0': 8,     // FF8000  laranja forte
  '255,64,0': 8,      // FF4000  vermelho-laranja
};

// Cor + opacidade por nível — escala própria, azuis mais fortes (tom acima).
const NIVEIS = [
  { nivel: 1, cor: '#C4E6FA', opacidade: 0.15, rotulo: 'Muito fraca' },
  { nivel: 2, cor: '#9FD0F4', opacidade: 0.17, rotulo: 'Fraca' },
  { nivel: 3, cor: '#76B7EE', opacidade: 0.19, rotulo: 'Moderada' },
  { nivel: 4, cor: '#4E9CE8', opacidade: 0.21, rotulo: 'Moderada forte' },
  { nivel: 5, cor: '#8FCB8F', opacidade: 0.23, rotulo: 'Forte' },
  { nivel: 6, cor: '#6EB377', opacidade: 0.25, rotulo: 'Forte alta' },
  { nivel: 7, cor: '#E3C56C', opacidade: 0.27, rotulo: 'Muito forte' },
  { nivel: 8, cor: '#E98570', opacidade: 0.30, rotulo: 'Extrema' },
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// ── Decoder PNG mínimo (paleta 8-bit / 4-bit, filtros 0-4) ──────────────────
async function decodePng(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 8;
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

// ── Compactação de grid (deflate + base64) p/ o KV ──────────────────────────
async function compactGrid(grid) {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([grid]).stream().pipeThrough(cs);
  const ab = await new Response(stream).arrayBuffer();
  const b = new Uint8Array(ab);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
async function expandGrid(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return inflate(u8);
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

// ── Interpolação por média entre dois grids (morphing suave) ────────────────
// grid_m = arredonda(média ponderada(A,B)). Mantém só os níveis ≥ 1.
function interpolarGrids(a, b, t) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const v = Math.round(a[i] * (1 - t) + b[i] * t);
    out[i] = v;
  }
  return out;
}

// ── Contornos por nível ──────────────────────────────────────────────────────
function contornosNivel(w, h, nv, nivel) {
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
      if (loop[0][0] === tail[0] && loop[0][1] === tail[1]) break;
    }
    if (loop[0][0] === loop[loop.length - 1][0] && loop[0][1] === loop[loop.length - 1][1]) {
      loop.pop();
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

// ── Polígonos, suavização e classificação exterior/buraco ───────────────────
function area2(ring) {
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
function pontoNoAnel(p, ring) {
  const [px, py] = p;
  let inR = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > py) !== (yj > py)) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inR = !inR;
  }
  return inR;
}
function loopsParaMultiPolygon(loops, w, h, ext) {
  const [xw, ys, xe, yn] = ext;
  const toLonLat = (ring) => ring.map(([px, py]) => [
    xw + (px / (w - 1)) * (xe - xw),
    yn - (py / (h - 1)) * (yn - ys),
  ]);
  const EPS = 3.4;
  const MIN_AREA_PX2 = 8;
  const feats = [];
  for (const loop of loops) {
    const ring = chaikin(rdp(loop, EPS));
    if (ring.length < 4) continue;
    if (Math.abs(area2(ring)) < MIN_AREA_PX2) continue;
    const extRing = toLonLat(ring);
    const aGeo = area2(extRing);
    feats.push({ exterior: extRing, buraco: aGeo < 0 });
  }
  const exteriors = feats.filter(f => !f.buraco);
  const buracos = feats.filter(f => f.buraco);
  const partes = exteriors.map(e => {
    const holes = buracos.filter(b =>
      pontoNoAnel([b.exterior[0][0], b.exterior[0][1]], e.exterior));
    return { exterior: e.exterior, buracos: holes.map(h => h.exterior) };
  });
  const valid = partes.filter(p => Math.abs(area2(p.exterior)) > 0.02);
  return { type: 'MultiPolygon', coordinates: valid.map(p => [p.exterior, ...p.buracos]) };
}

// ── Grid → GeoJSON por nível (todos os níveis presentes no grid) ────────────
function gridParaNiveis(w, h, nv, ext) {
  const niveis = [];
  for (const cfg of NIVEIS) {
    const loops = contornosNivel(w, h, nv, cfg.nivel);
    if (!loops.length) continue;
    const geometry = loopsParaMultiPolygon(loops, w, h, ext);
    if (!geometry.coordinates.length) continue;
    niveis.push({ nivel: cfg.nivel, cor: cfg.cor, opacidade: cfg.opacidade, rotulo: cfg.rotulo, geometry });
  }
  return niveis;
}

// ── Histórico no KV ──────────────────────────────────────────────────────────
async function histLoad(env) {
  if (!env.RADAR_HIST) return { frames: [], grids: {} };
  try {
    const raw = await env.RADAR_HIST.get(KV_KEY, 'json');
    if (raw && raw.frames) return raw;
  } catch (e) {}
  return { frames: [], grids: {} };
}
async function histSave(env, hist) {
  if (!env.RADAR_HIST) return;
  // grids guardados como base64 comprimidos; o KV guarda { file: b64 }
  const payload = { frames: hist.frames, grids: hist.grids };
  await env.RADAR_HIST.put(KV_KEY, JSON.stringify(payload));
}
function frameTime(file) {
  const m = file.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}
async function fetchPngGrid(file) {
  const im = await fetch(`${EPAGRI_BASE}getImagem?prod=${PROD}&radar=${RADAR}&file=${file}`, {
    cf: { cacheTtl: TTL }, headers: { 'User-Agent': 'brusque-discover/1.0' },
  });
  if (!im.ok) throw new Error('EPAGRI getImagem: ' + im.status);
  const buf = new Uint8Array(await im.arrayBuffer());
  const png = await decodePng(buf);
  const { w, h, nv } = classificarNiveis(png);
  return { w, h, nv };
}

// busca os frames reais da EPAGRI e acumula os novos no KV
async function syncHistoria(env) {
  const hist = await histLoad(env);
  let files;
  try {
    const r = await fetch(`${EPAGRI_BASE}getUltimasImagens?prod=${PROD}&radar=${RADAR}`, {
      cf: { cacheTtl: TTL }, headers: { 'User-Agent': 'brusque-discover/1.0' },
    });
    files = await r.json();
  } catch (e) { files = []; }
  if (!Array.isArray(files)) files = [];
  // ordena por tempo e processa os que ainda não temos
  files.sort((a, b) => (frameTime(a) || 0) - (frameTime(b) || 0));
  let changed = false;
  for (const file of files) {
    if (hist.grids[file]) continue;
    try {
      const { w, h, nv } = await fetchPngGrid(file);
      hist.grids[file] = { b64: await compactGrid(nv), w, h };
      if (!hist.frames.includes(file)) hist.frames.push(file);
      changed = true;
    } catch (e) {}
  }
  if (changed) {
    hist.frames.sort((a, b) => (frameTime(a) || 0) - (frameTime(b) || 0));
    while (hist.frames.length > KV_MAX_FRAMES) {
      const old = hist.frames.shift();
      delete hist.grids[old];
    }
    await histSave(env, hist);
  }
  return hist;
}

// monta a lista de passos (reais + interpolados) a partir do histórico
function montarPassos(hist) {
  const frames = hist.frames.filter(f => hist.grids[f]);
  if (!frames.length) return [];
  const passos = [];
  for (let i = 0; i < frames.length; i++) {
    passos.push({ id: 'r:' + frames[i], time: frameTime(frames[i]) });
    if (i < frames.length - 1) {
      for (let k = 1; k <= INTERP_PER_GAP; k++) {
        const t = k / (INTERP_PER_GAP + 1);
        passos.push({ id: 'i:' + frames[i] + ':' + frames[i + 1] + ':' + t.toFixed(3), time: null });
      }
    }
  }
  return passos;
}

// carrega/gera o grid de um passo (real ou interpolado)
async function gridDoPasso(env, id) {
  const hist = await histLoad(env);
  if (id.startsWith('r:')) {
    const file = id.slice(2);
    if (!hist.grids[file]) {
      const { nv } = await fetchPngGrid(file);
      return { w: 920, h: 719, nv };
    }
    const g = hist.grids[file];
    return { w: g.w, h: g.h, nv: await expandGrid(g.b64) };
  }
  const m = id.match(/^i:(.+):(.+):([\d.]+)$/);
  if (!m) throw new Error('id inválido: ' + id);
  const [, fa, fb, ts] = m;
  const t = parseFloat(ts);
  let ga = hist.grids[fa], gb = hist.grids[fb];
  if (!ga) { const r = await fetchPngGrid(fa); ga = { w: r.w, h: r.h, nv: r.nv }; }
  if (!gb) { const r = await fetchPngGrid(fb); gb = { w: r.w, h: r.h, nv: r.nv }; }
  const a = ga.nv || await expandGrid(ga.b64);
  const b = gb.nv || await expandGrid(gb.b64);
  return { w: 920, h: 719, nv: interpolarGrids(a, b, t) };
}

async function passoJson(env, id) {
  const { w, h, nv } = await gridDoPasso(env, id);
  const niveis = gridParaNiveis(w, h, nv, EXT);
  let time = null;
  if (id.startsWith('r:')) time = frameTime(id.slice(2));
  return { time, ext: EXT, niveis };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const json = (obj, extra) => new Response(JSON.stringify(obj), {
  headers: { ...CORS, ...extra, 'Content-Type': 'application/json; charset=utf-8' },
});

export { decodePng, classificarNiveis, contornosNivel, loopsParaMultiPolygon,
         NIVEIS, EXT, interpolarGrids, gridParaNiveis, montarPassos };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      if (/\/frames\.json$/.test(url.pathname)) {
        const hist = await syncHistoria(env);
        const passos = montarPassos(hist);
        return json({ updated: new Date().toISOString(), fonte: 'EPAGRI/CIRAM · mosaico SC (COMP)',
                      ext: EXT, passos });
      }
      if (/\/cache\/clear$/.test(url.pathname) && env.RADAR_HIST) {
        await env.RADAR_HIST.delete(KV_KEY);
        return json({ ok: true });
      }
      const m = url.pathname.match(/^\/frame\/([^/]+)\.json$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const cache = caches.default;
        const ck = new Request(url.origin + url.pathname);
        const hit = await cache.match(ck);
        if (hit) return hit;
        const data = await passoJson(env, id);
        const resp = json({ ...data, fonte: 'EPAGRI/CIRAM · mosaico SC (COMP)' },
          { 'Cache-Control': `public, max-age=${TTL}` });
        ctx.waitUntil(cache.put(ck, resp.clone()));
        return resp;
      }
      return json({ erro: 'Use GET /frames.json ou /frame/{id}.json' }, { status: 404 });
    } catch (e) {
      return json({ erro: String(e) }, { status: 502 });
    }
  },
};
