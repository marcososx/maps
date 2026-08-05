# Diagnóstico — Monitoramento de rios da Defesa Civil de Brusque

**Data da análise:** 02/08/2026
**Página analisada:** https://defesacivil.brusque.sc.gov.br/monitoramento
**Autor da análise:** Marcos (via Claude Code)
**Objetivo:** documentar por que a seção de nível de rios "não abre", para futura
questão junto à área de tecnologia da Defesa Civil.

---

## TL;DR

A seção **"Monitoramento de rio e ribeirões"** aparece com o título, mas **nenhum
card de rio é exibido**. A causa **não é o navegador do usuário** nem a
renderização do front-end: **o próprio servidor da Defesa Civil devolve um
fragmento HTML vazio** quando a página pede os dados dos rios. As seções de
pluviômetros e estações experimentais funcionam normalmente.

---

## Como a página funciona (arquitetura)

A página `/monitoramento` é uma SPA que, depois de carregar, monta **cada seção
separadamente** via chamadas AJAX (POST) para o mesmo endpoint, mudando só o
parâmetro `tipo`. O código está inline no HTML da página (usa jQuery 3.7.1):

```javascript
// Rios e ribeirões
$.ajax({
    type: 'post',
    url: '/estacao/carregar-com-dados',
    data: 'tipo=rio&experimental=0',
    dataType: 'html',
    success: function (txt) { $('#estacoesRio').html(txt); }
});

// Pluviômetros
data: 'tipo=chuva&experimental=0'   // -> #estacoesChuva

// Estações experimentais
data: 'tipo=experimental&experimental=1'   // -> #estacoesExperimentais
```

Cada chamada retorna um **fragmento HTML pronto** (não é JSON), que é injetado no
`<div>` correspondente.

---

## Evidência do problema

Chamando o mesmo endpoint que a página chama, para cada `tipo`:

| Seção | Corpo do POST | Retorno | Status |
|---|---|---|---|
| **Rios e ribeirões** | `tipo=rio&experimental=0` | **384 bytes, só espaço em branco — zero cards** | ❌ **QUEBRADO** |
| Pluviômetros | `tipo=chuva&experimental=0` | HTML completo com todas as estações | ✅ OK |
| Estações experimentais | `tipo=experimental&experimental=1` | HTML completo com todas as estações | ✅ OK |

Reprodução via `curl` (qualquer pessoa pode confirmar):

```bash
# Rios — volta VAZIO:
curl -s 'https://defesacivil.brusque.sc.gov.br/estacao/carregar-com-dados' \
  --data 'tipo=rio&experimental=0' | wc -c
# => ~384 (só whitespace)

# Chuva — volta CHEIO:
curl -s 'https://defesacivil.brusque.sc.gov.br/estacao/carregar-com-dados' \
  --data 'tipo=chuva&experimental=0' | wc -c
# => milhares de bytes, com os cards das estações
```

### Confirmação na visão de tabela

Em `/monitoramento/tabela` são listadas **35 estações**, e a coluna **"Nível/Cota"
está com `-` em TODAS** — porque todas as estações ativas são pluviômetros
(fontes **CEMADEN** e **CMID**), que não medem nível de rio. Nenhuma estação de
**cota de rio** está aparecendo na listagem.

---

## Interpretação

O endpoint `tipo=rio` está retornando um contêiner vazio. As causas prováveis
(a serem confirmadas pela equipe de TI da Defesa Civil):

1. **Nenhuma estação de rio cadastrada/ativa** na consulta `tipo=rio` no momento; ou
2. **A integração que alimenta a cota do rio (fonte ANA) parou de retornar
   dados** e o backend entrega a lista vazia em vez de um erro; ou
3. **Estações de rio marcadas como inativas/ocultas** no cadastro.

Em qualquer dos casos, **o defeito está no lado do servidor de Brusque** — o
front-end faz a chamada corretamente e apenas injeta o que recebe (nada).

---

## Fonte primária do nível do rio: ANA

Quando a seção de rios funcionava, a fonte da cota era a **ANA (Agência Nacional
de Águas)** — ex.: "Rio da ponte: 0,90 m, FONTE: ANA". Ou seja, o dado de nível
do rio de Brusque (Itajaí-Mirim) é originalmente da **telemetria da ANA**
(HidroWebService — `telemetriaws1.ana.gov.br`), e a Defesa Civil apenas
re-exibe.

**Implicação para o Brusque Discover:** para o mapa não depender desse endpoint
municipal (que está quebrado), o caminho robusto é consumir a **API de
telemetria da ANA diretamente**, usando o código da estação da ANA em Brusque.

---

## Perguntas para levar à área de TI da Defesa Civil

1. A consulta `tipo=rio` do endpoint `/estacao/carregar-com-dados` está retornando
   vazio — há estações de rio ativas cadastradas? Desde quando pararam de aparecer?
2. A integração de cota com a **ANA** está ativa? Qual o código da estação da ANA
   usada para o rio em Brusque?
3. É possível expor os dados de rio/chuva como **JSON** (em vez de fragmento HTML),
   para consumo por sistemas de terceiros (ex.: Brusque Discover)?
4. Existe documentação/contato técnico da agência **DEXTAK** (desenvolvedora do site)?

---

*Arquivo gerado automaticamente a partir da análise de rede do site. Guardado em
`Brusque Discover - Geodados/fontes-defesacivil/` para referência futura.*
