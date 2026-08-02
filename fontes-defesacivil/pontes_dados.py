#!/usr/bin/env python3
"""Enriquece out/brusque_pontes.geojson com dados coletados na internet (nome
popular, ano, comprimento, largura, o que liga, homenageado). Casado por nome.
Fontes: enciclopedia.brusque.sc.gov.br, diplomatafm.com.br, omunicipio.com.br.
Pontes sem dado ficam só com o nome (não inventar)."""
import json, unicodedata

def norm(s):
    s = unicodedata.normalize('NFD', s or '').encode('ascii', 'ignore').decode().lower()
    return ''.join(c for c in s if c.isalnum() or c == ' ').strip()

# chave = trecho normalizado que identifica a ponte
DADOS = {
    'antonio nicolau maluche': dict(apelido='Ponte do Maluche', ano=1985,
        liga='Centro ↔ Maluche'),
    'irineu bornhausen': dict(apelido='Ponte Estaiada', ano=2004, comprimento_m=90.88,
        liga='Centro', obs='Estaiada (2004). Antes: metálica Cel. Vidal Ramos Jr. (1905); concreto 1953.'),
    'arthur schlosser': dict(apelido='Ponte do Terminal', ano=1972, comprimento_m=72,
        largura_m=10.20, liga='Terminal'),
    'mario olinger': dict(apelido='Ponte do Bombeiro', ano=1982, liga='Av. Beira Rio',
        obs='Concreto (reinaug. 1982). Antes: metálica Cel. Pereira Oliveira (1906).'),
    'trabalhador': dict(apelido='Ponte do Trabalhador / Santa Rita'),
    'joao liberio benvenutti': dict(apelido='Ponte da Bilu (Santos Dumont / Unifebe)', ano=1967,
        comprimento_m=14, liga='Rua Dorval Luz ↔ Santos Dumont'),
    'rio branco': dict(apelido='Ponte provisória do Rio Branco', ano=1964, liga='bairro Rio Branco',
        obs='Ponte provisória (histórica); ainda sem nome oficial no mapa.'),
    # sem dados públicos confiáveis: Carlos Decker, Alois Petermann (mantidos só com o nome)
}

def main():
    path = 'out/brusque_pontes.geojson'
    d = json.load(open(path))
    hit = 0
    for f in d['features']:
        n = norm(f['properties'].get('nome'))
        for chave, extra in DADOS.items():
            if chave in n:
                f['properties'].update(extra); hit += 1; break
    json.dump(d, open(path, 'w'), ensure_ascii=False)
    print(f"  pontes enriquecidas: {hit}/{len(d['features'])}")

if __name__ == '__main__':
    main()
