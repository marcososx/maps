# brusque-voos — voos num raio de 100 km de Brusque (Airplanes.live ADS-B)

Worker Cloudflare que serve, em JSON limpo e com CORS, os aviões no ar num
**raio de 100 km de Brusque**. A camada **"Voos (ADS-B)"** do mapa
(`site/index.html`, dropdown Tempo Real) consome este Worker via `VOOS_URL`.

- Endpoint: `GET /voos.json`
- Cache: 2 min (Cache API do Worker)
- Retorna: `{ updated, fonte, centro, raio_km, voos:[{icao24,callsign,lat,lon,alt_m,vel_kmh,rumo,subida_mps,categoria,dist_km,ultima_atualizacao}] }`
  — **ordenado por distância** (mais perto primeiro), filtrado a **≤ 100 km** (haversine).

## Fonte dos dados

**Airplanes.live** REST API (rede comunitária de receptores ADS-B/MLAT):
`https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}` (raio até 250 NM).
Sem chave, rate limit 1 req/s, dados sob licença open (ODbL).

Consulta: centro em **Brusque** (`-27.0977, -48.9172`) com raio de 60 NM (~111 km,
margem), depois o Worker **filtra a ≤ 100 km** pelo haversine. O mapa desenha um
**círculo estático de 100 km** ao redor de Brusque (GeoJSON de 128 pontos).

## Por que não OpenSky / ADSB.lol / adsb.fi

| Fonte | Problema com Worker Cloudflare |
|---|---|
| **OpenSky** | bloqueia IPs de datacenter → HTTP **522** (causa conhecida) |
| **ADSB.lol** | rate limit por IP → HTTP **429** do IP do Worker |
| **adsb.fi** | retorna HTTP **403** para IPs de Workers |
| **Airplanes.live** | ✅ funciona (roda atrás de Cloudflare) — **usada** |

## Deploy (rodar dentro desta pasta)

```bash
npm install
npx wrangler login       # login Cloudflare (abre o navegador) — só o Marcos faz
npx wrangler deploy
```

URL final: `https://brusque-voos.<seu-subdominio>.workers.dev/voos.json`.
Teste: `curl https://brusque-voos.marcososx.workers.dev/voos.json`.

**Depois do deploy, confira `VOOS_URL` no `site/index.html`**
(hoje aponta para `https://brusque-voos.marcososx.workers.dev/voos.json`).
