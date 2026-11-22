# ADR 0003: Importação idempotente por escopo

- **Status:** aceito
- **Data:** 2026-11-22

## Contexto

O AWS CUR é reescrito várias vezes ao longo do mês (e até depois do fechamento, com créditos e reembolsos). O export do Azure também é reemitido. Se cada importação somasse linhas, reimportar o mesmo arquivo dobraria o custo, e o painel mostraria um falso pico exatamente nos dias reimportados.

Linhas de billing não têm chave natural estável entre reemissões, então deduplicar linha a linha não é confiável.

## Decisão

Cada lote define escopos `(provedor, conta pagadora, intervalo de datas)`. Importar apaga o que existe dentro desses escopos e grava o lote novo, numa operação só. Reimportar o mesmo arquivo dá o mesmo resultado, e importar outra conta pagadora não afeta a primeira.

O sistema também recusa misturar moedas no histórico, em vez de converter com uma taxa escolhida sem critério.

## Consequências

- Reprocessar é seguro: o job de sincronização pode buscar sempre os últimos 35 dias.
- Um arquivo parcial (só metade do mês) substitui só o intervalo que contém. Para evitar importar meio arquivo corrompido, a ingestão rejeita o arquivo inteiro quando mais de 5% das linhas falham.
- Usar Cost Explorer e CUR para a mesma conta pagadora ao mesmo tempo duplicaria o custo, porque são fontes diferentes da mesma fatura. A documentação orienta escolher uma fonte por conta.
