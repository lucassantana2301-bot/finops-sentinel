# ADR 0001: FOCUS 1.0 como modelo canônico de custo

- **Status:** aceito
- **Data:** 2026-11-22

## Contexto

Cada nuvem exporta billing num formato próprio. O AWS CUR tem mais de 100 colunas, com nomes que mudaram entre o CUR legado (`lineItem/UnblendedCost`) e o CUR 2.0 (`line_item_unblended_cost`). O Azure Cost Details usa outro vocabulário (`MeterCategory`, `CostInBillingCurrency`) e datas no formato americano. Se as regras de negócio lerem esses formatos diretamente, cada regra precisa de dois ou três caminhos e cada nuvem nova multiplica o trabalho.

O FinOps Foundation publicou o **FOCUS (FinOps Open Cost and Usage Specification)**, adotado pela AWS (Data Exports em FOCUS), pelo Azure (export FOCUS no Cost Management) e pelo Google Cloud.

## Decisão

O domínio trabalha com um único tipo, `CostRecord`, cujos campos seguem as colunas FOCUS (`ChargePeriodStart`, `BilledCost`, `EffectiveCost`, `ChargeCategory`, `PricingCategory`, `ServiceCategory`, `SubAccountId`...). Cada formato de entrada tem um adapter de ingestão que traduz para esse tipo, e o resto do sistema não sabe de qual nuvem o dado veio.

Mantemos três campos de extensão (`usageType`, `instanceType`, `tags` normalizadas), que o FOCUS permite com o prefixo `x_`, porque regras como gp2 → gp3 e geração anterior dependem deles.

## Consequências

- Adicionar uma nuvem (GCP, Oracle) é escrever um adapter, sem tocar em anomalias, previsão ou recomendações.
- O export FOCUS nativo é o caminho recomendado: já traz faturado e efetivo separados.
- O adapter do CUR precisa reproduzir a amortização de Savings Plans e Reservas (uso coberto, negação, taxa recorrente), que é a parte mais sujeita a erro. Ela tem testes dedicados.
- O Cost Details do Azure traz só um valor por linha; sem saber se o export é "Actual" ou "Amortized", o mesmo valor vai para as duas métricas. Isso está documentado no adapter.
