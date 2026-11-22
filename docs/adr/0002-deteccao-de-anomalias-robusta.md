# ADR 0002: Detecção de anomalias com mediana, MAD e sazonalidade semanal

- **Status:** aceito
- **Data:** 2026-11-22

## Contexto

O objetivo é avisar no mesmo dia em que um custo fora do padrão aparece no billing, com poucos falsos positivos. As alternativas avaliadas:

| Opção                                      | Problema                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| Limite fixo ("avise acima de US$ 100/dia") | não acompanha crescimento nem serviços de tamanhos diferentes                           |
| Média e desvio padrão móveis               | um pico dentro da janela infla o desvio e esconde o pico seguinte                       |
| Modelos de série temporal (Prophet, ARIMA) | precisam de meses de histórico, são difíceis de explicar e caros para rodar por serviço |
| AWS Cost Anomaly Detection                 | só AWS, sem regras de negócio próprias                                                  |

## Decisão

Para cada chave (serviço, por padrão) e cada dia:

- referência = 28 dias anteriores, a partir do primeiro dia com dado;
- esperado = mediana da janela × fator do dia da semana (mediana daquele dia / mediana geral, exigindo pelo menos duas amostras);
- σ = 1,4826 × MAD dos resíduos, com piso de 2% da mediana para séries constantes;
- anomalia se escore ≥ 3,5, impacto ≥ mínimo absoluto (padrão 25) e aumento ≥ 20%;
- série esparsa ou nova (mediana zero) só alerta com salto de 3x sobre o maior valor já visto, para que um serviço novo gere um alerta no primeiro dia, e não um por dia;
- severidade pelo impacto em dinheiro, subindo um nível quando o escore passa de 10.

Só picos são reportados: queda de custo raramente exige ação imediata e geraria ruído quando alguém desliga um recurso de propósito.

## Consequências

- Explicável para quem recebe o alerta: "US$ 112 contra US$ 60 esperados, causado pelo nat-0f1e…".
- Funciona com 14 dias de histórico e custa O(n · janela) por série, barato para rodar a cada importação.
- Não modela tendência de longo prazo nem sazonalidade mensal (fechamento contábil, Black Friday). Se isso gerar falsos positivos, o próximo passo é um fator de calendário ou um modelo dedicado para as séries mais caras.
