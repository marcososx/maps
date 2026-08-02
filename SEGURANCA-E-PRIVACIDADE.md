# Segurança & Privacidade — pendências (decidido adiar em 01/08/2026)

Discussão feita, execução **adiada de propósito**. Prioridade agora: subir no repo e
hospedar. Estes pontos ficam como trabalho futuro / decisões em aberto.

## Objetivo do Marcos
Projeto = **centralizador inteligente** de dados pra gestão de crise em Brusque. NÃO é
instituição, então **vai creditar a fonte em cada camada** (Defesa Civil / CEMADEN /
ANA). Quer **proteger o próprio trabalho** (o tratamento geoespacial, o pipeline, o
know-how) — atribuir a fonte ≠ expor o método. Os dois convivem.

## O que dá pra esconder COMPLETamente (fazer no futuro)
- **Origem dos dados vivos** (TomTom / CEMADEN / ANA / site da Defesa Civil): tudo por
  **Worker**. Cliente só vê o Worker, nunca a fonte. (Trânsito já é assim.)
- **Chaves/segredos:** secret de Worker / service role só no ambiente do Worker.
- **Pipeline/know-how** (`fontes-defesacivil/`, KML cru, scripts): **repo PRIVADO**, nunca
  no deploy. Deploy leva só o resultado compilado.
- **Travar endpoints:** CORS só no domínio próprio + rate limit + WAF + bot fight (Cloudflare).

## Embed / uso externo (a pergunta do Marcos)
- `frame-ancestors` (CSP) → só o site dele pode embedar em iframe (bloqueia outros sites).
- Checagem de Referer / `Sec-Fetch-Site` no edge → bloqueia abrir a URL direto / uso casual.
- Token assinado curto (opcional, mais forte).
- **Verdade dura:** esconder a URL NÃO é segurança. O navegador precisa receber pra
  desenhar; pessoa técnica sempre vê o que o próprio browser renderiza.

## A maior alavanca de privacidade: blindar a GEOMETRIA
Decisão futura, **camada por camada**:
- Camadas pesadas/proprietárias (níveis de alagamento, setores) → **tiles RASTER gerados
  no servidor** → só pixel chega no cliente, o polígono nunca é baixável. (Perde hover/clique
  naquela camada — fazer híbrido: raster pro pesado + geojson fininho pros pontos interativos.)
- Camadas leves interativas (hover de bairro) → geojson gated.
- Escala de proteção: geojson gated (simples) → vector tiles PBF (equilíbrio) → raster
  server-side (máximo).

## Checklist quando for blindar
- [ ] Repo do pipeline PRIVADO; deploy só com outputs.
- [ ] Toda fonte externa via Worker (esconder origem + chave).
- [ ] **Minificar o build e TIRAR comentários/URLs** do `index.html` (hoje cita TomTom/CEMADEN/ANA no código).
- [ ] CORS travado no domínio + `frame-ancestors` + referer check.
- [ ] Rate limit / WAF / bot fight (Cloudflare).
- [ ] Supabase: RLS trancado; cliente nunca fala direto com o banco (só via Worker).
- [ ] Conferir termos de uso das fontes (cache/redistribuição — TomTom/ANA/CEMADEN).
- [ ] Selo "Fonte: X" por camada (crédito, sem expor pipeline).
- [ ] Domínio próprio (sai do workers.dev; controla headers/WAF).

## Princípio-guia
Segurança = (a) não mandar segredo/fonte pro cliente, (b) travar quem pode chamar/embedar,
(c) entregar dado proprietário como **pixel, não vetor**. Encarecer a cópia e blindar as
joias (pipeline, chaves, geometria bruta) — não tentar torná-las "invisíveis".
