# brusque-trafego — proxy de tiles de trânsito (TomTom)

Worker Cloudflare que serve os tiles de trânsito da TomTom para o mapa do Brusque
Discover, **cacheados** (baixo consumo) e **sem expor a API key** no front-end.

- Endpoint: `GET /traffic/{z}/{x}/{y}.png`
- A key fica como secret `TOMTOM_KEY` (nunca no código).
- Cache respeita o `Cache-Control` da TomTom → vários usuários compartilham 1 busca.

## Deploy (rodar dentro desta pasta)

```bash
npm install
npx wrangler login                 # autentica no Cloudflare (abre o navegador)
npx wrangler deploy                # cria o Worker (vai dar 500 até setar a key)
npx wrangler secret put TOMTOM_KEY # cola a API key no prompt (aplica na hora)
```

No fim, a URL será algo como `https://brusque-trafego.<seu-subdominio>.workers.dev`.
Teste um tile no navegador: `https://.../traffic/12/2200/2100.png` (deve vir uma imagem).

Passe essa URL (não a key) para plugar o item "Trânsito" no dropdown "Mapa" do mapa.
