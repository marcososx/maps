#!/usr/bin/env python3
"""Gera out/brusque_pontes.geojson com a lista DEFINITIVA das pontes do Rio
Itajaí-Mirim (9 pontes). Fonte da verdade = este arquivo, não o KML do My Maps:
as coordenadas/nomes/medidas são os oficiais que o Marcos definiu. Rode via
build.sh; o KML de "Cotas + Ruas" continua sendo usado só para as cotas.
"""
import json

# Cada ponte = coords [lng, lat] + propriedades exibidas no popup do site.
PONTES = [
    dict(id='ponte_estaiada_01', coords=[-48.917183059133905, -27.10060408287998],
         nome_oficial='Ponte Irineu Bornhausen', nome_popular='Ponte Estaiada',
         comprimento_m=110.0, vao_livre_m=80.0),
    dict(id='ponte_mario_olinger_02', coords=[-48.90759229139695, -27.090348787017223],
         nome_oficial='Ponte Mário Olinger', nome_popular='Ponte do Bombeiro',
         comprimento_m=115.0, vao_livre_m=45.0),
    dict(id='ponte_andrea_volkmann_03', coords=[-48.90630396682034, -27.093911223595814],
         nome_oficial='Ponte Arquiteta Andrea Patrícia Volkmann',
         nome_popular='Nova Ponte do Centro / Ponte da Beira Rio',
         comprimento_m=121.05, vao_livre_m=60.0),
    dict(id='ponte_pilolo_04', coords=[-48.93714661927506, -27.121859934002355],
         nome_oficial='Ponte José Germano Schaefer', nome_popular='Ponte do Pilolo',
         bairros_conexao=['Rio Branco', 'Dom Joaquim / Souza Cruz'],
         comprimento_m=90.0, vao_livre_m=40.0),
    dict(id='ponte_beira_rio_rio_branco_05', coords=[-48.941931282153696, -27.108422112071803],
         nome_oficial='Ponte Beira Rio - Rio Branco',
         nome_popular='Ponte Nova do Rio Branco / Ligação Beira Rio',
         comprimento_m=90.0, vao_livre_m=45.0),
    dict(id='ponte_arthur_schlosser_06', coords=[-48.91338116376324, -27.100381849925466],
         nome_oficial='Ponte Arthur Schlösser', nome_popular='Ponte do Terminal / Ponte do Pavilhão',
         comprimento_m=72.0, vao_livre_m=35.0),
    dict(id='ponte_maluche_07', coords=[-48.92752332605105, -27.09888756605798],
         nome_oficial='Ponte Antônio Nicolau Maluche', nome_popular='Ponte do Maluche',
         comprimento_m=90.0, vao_livre_m=45.0),
    dict(id='ponte_joao_liberio_08', coords=[-48.88954210002013, -27.07022179403717],
         nome_oficial='Ponte João Libério Benvenutti',
         nome_popular='Ponte do Santos Dumont / Ponte da Bilu',
         comprimento_m=85.0, vao_livre_m=40.0),
    dict(id='ponte_trabalhador_09', coords=[-48.908309238755855, -27.08246413724469],
         nome_oficial='Ponte do Trabalhador', nome_popular='Ponte da Santa Rita / Ponte do Trabalhador',
         comprimento_m=100.0, vao_livre_m=50.0),
]

def main():
    features = []
    for p in PONTES:
        props = {k: v for k, v in p.items() if k != 'coords'}
        features.append({
            'type': 'Feature',
            'id': p['id'],
            'geometry': {'type': 'Point', 'coordinates': p['coords']},
            'properties': props,
        })
    out = {'type': 'FeatureCollection', 'features': features}
    with open('out/brusque_pontes.geojson', 'w') as fh:
        json.dump(out, fh, ensure_ascii=False)
    print(f"  pontes gravadas: {len(features)}")

if __name__ == '__main__':
    main()
