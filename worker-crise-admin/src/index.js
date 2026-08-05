// Worker do PAINEL ADMINISTRATIVO do Painel de Crise Brusque Discover.
// Autentica o operador (senha via env ADMIN_SENHA) e gerencia boletins e
// estado da crise no KV compartilhado com o dashboard público (brusque-crise).
//
//   POST /api/login        { senha } -> seta cookie de sessão
//   POST /api/logout       -> limpa sessão
//   GET  /api/me           -> { ok, nome } se logado
//   GET  /api/estado       -> estado atual
//   PUT  /api/estado       { nivel_alerta, status_cobertura }
//   POST /api/boletins     { titulo, conteudo, url, label, categoria, prioridade, fixado }
//   PATCH /api/boletins/:id { ...campos parciais }
//   DELETE /api/boletins/:id

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const COOKIE = 'crise_admin';
const SESSION_HOURS = 12;

const enc = (s) => new TextEncoder().encode(s);

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sign(key, data) {
  const sig = await crypto.subtle.sign('HMAC', key, enc(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function token(key, senha) {
  const now = Date.now();
  const win = Math.floor(now / (SESSION_HOURS * 3600 * 1000));   // janela de 12h
  return (win.toString(16) + '.' + await sign(key, win + ':' + senha));
}
async function validToken(key, senha, tok) {
  if (!tok) return false;
  const [winHex, sig] = tok.split('.');
  const win = parseInt(winHex, 16);
  if (!win || isNaN(win)) return false;
  if (Math.abs(Math.floor(Date.now() / (SESSION_HOURS * 3600 * 1000)) - win) > 1) return false;
  return sig === await sign(key, win + ':' + senha);
}

const readJson = async (env, key, fb) => {
  const raw = await env.CRISE_KV.get(key);
  if (!raw) return fb;
  try { return JSON.parse(raw); } catch (e) { return fb; }
};
const writeJson = async (env, key, val) => {
  await env.CRISE_KV.put(key, JSON.stringify(val));
};

function cookies(req) {
  const out = {};
  (req.headers.get('Cookie') || '').split(';').forEach(c => {
    const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  });
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const key = await hmacKey(env.ADMIN_SENHA || '');
    const body = request.method !== 'GET' ? await request.json().catch(() => ({})) : {};

    // ── login / logout ──
    if (url.pathname === '/api/login' && request.method === 'POST') {
      if (body.senha && body.senha === env.ADMIN_SENHA) {
        const t = await token(key, env.ADMIN_SENHA);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: {
            ...CORS,
            'Set-Cookie': COOKIE + '=' + t + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (SESSION_HOURS * 3600),
          },
        });
      }
      return new Response(JSON.stringify({ ok: false, erro: 'senha incorreta' }), { status: 401, headers: CORS });
    }
    if (url.pathname === '/api/logout' && request.method === 'POST') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: {
          ...CORS,
          'Set-Cookie': COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        },
      });
    }
    if (url.pathname === '/api/me') {
      const ok = await validToken(key, env.ADMIN_SENHA, cookies(request)[COOKIE]);
      return Response.json({ ok }, { headers: CORS });
    }

    // ── rotas protegidas ──
    const authed = await validToken(key, env.ADMIN_SENHA, cookies(request)[COOKIE]);
    if (!authed) return new Response(JSON.stringify({ ok: false, erro: 'não autenticado' }), { status: 401, headers: CORS });

    if (url.pathname === '/api/estado' && request.method === 'GET') {
      return Response.json(await readJson(env, 'estado', {}), { headers: CORS });
    }
    if (url.pathname === '/api/estado' && request.method === 'PUT') {
      const atual = await readJson(env, 'estado', {});
      const novo = { ...atual, ...(body.nivel_alerta ? { nivel_alerta: body.nivel_alerta } : {}),
                     ...(body.status_cobertura ? { status_cobertura: body.status_cobertura } : {}),
                     atualizado_em: new Date().toISOString() };
      await writeJson(env, 'estado', novo);
      return Response.json({ ok: true, estado: novo }, { headers: CORS });
    }

    if (url.pathname === '/api/boletins' && request.method === 'POST') {
      const b = await readJson(env, 'boletins', []);
      const novo = {
        id: crypto.randomUUID(),
        titulo: (body.titulo || '').slice(0, 30),
        conteudo: (body.conteudo || '').slice(0, 160),
        url: body.url || '', label: body.label || '',
        categoria: body.categoria || 'GERAL',
        prioridade: body.prioridade || 'NORMAL',
        fixado: !!body.fixado,
        criado_em: new Date().toISOString(),
      };
      b.push(novo);
      await writeJson(env, 'boletins', b);
      return Response.json({ ok: true, boletim: novo }, { headers: CORS });
    }

    const mDel = url.pathname.match(/^\/api\/boletins\/([\w-]+)$/);
    if (mDel && request.method === 'DELETE') {
      const b = await readJson(env, 'boletins', []);
      const nova = b.filter(x => x.id !== mDel[1]);
      await writeJson(env, 'boletins', nova);
      return Response.json({ ok: true }, { headers: CORS });
    }
    if (mDel && request.method === 'PATCH') {
      const b = await readJson(env, 'boletins', []);
      const idx = b.findIndex(x => x.id === mDel[1]);
      if (idx < 0) return new Response(JSON.stringify({ ok: false, erro: 'não achou' }), { status: 404, headers: CORS });
      const alvo = b[idx];
      ['titulo', 'conteudo', 'url', 'label', 'categoria', 'prioridade', 'fixado'].forEach(k => {
        if (k in body) alvo[k] = body[k];
      });
      if (alvo.titulo) alvo.titulo = alvo.titulo.slice(0, 30);
      if (alvo.conteudo) alvo.conteudo = alvo.conteudo.slice(0, 160);
      await writeJson(env, 'boletins', b);
      return Response.json({ ok: true, boletim: alvo }, { headers: CORS });
    }

    return env.ASSETS.fetch(request);
  },
};
