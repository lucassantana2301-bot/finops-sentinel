import { describe, expect, it } from 'vitest';
import {
  buildAlertEvents,
  evaluateBudget,
  forecastMonth,
  isWeekend,
  renderAlertText,
  type Anomaly,
} from '../src/index.js';
import { series } from './helpers.js';

/** Intl usa espaço não separável depois do símbolo da moeda. */
const text = (value: string) => value.replace(/\u00a0/g, ' ');

describe('previsão do mês', () => {
  it('custo constante fecha exatamente no valor diário x dias do mês', () => {
    const records = series('2026-10-01', 50, () => 100); // até 19/11
    const forecast = forecastMonth(records, { month: '2026-11', asOf: '2026-11-19' });
    expect(forecast).toMatchObject({
      actualToDate: 1900,
      projectedRemaining: 1100,
      forecast: 3000,
      daysElapsed: 19,
      confidence: 'high',
    });
    expect(forecast.forecastLow).toBe(3000);
  });

  it('respeita o padrão semanal e ignora pico isolado', () => {
    const records = series('2026-10-01', 50, (date, i) => (i === 48 ? 5000 : isWeekend(date) ? 20 : 100));
    const forecast = forecastMonth(records, { month: '2026-11', asOf: '2026-11-19' });
    // Restam 20 a 30/11: 7 dias úteis + 4 de fim de semana.
    expect(forecast.projectedRemaining).toBe(7 * 100 + 4 * 20);
  });

  it('mês encerrado: previsão é o realizado', () => {
    const records = series('2026-10-01', 50, () => 10);
    const forecast = forecastMonth(records, { month: '2026-10', asOf: '2026-11-19' });
    expect(forecast).toMatchObject({ forecast: 310, projectedRemaining: 0, confidence: 'high' });
  });

  it('pouco histórico reduz a confiança', () => {
    const records = series('2026-11-15', 5, () => 10);
    expect(forecastMonth(records, { month: '2026-11', asOf: '2026-11-19' }).confidence).toBe('low');
  });
});

describe('orçamentos e alertas', () => {
  const records = [
    ...series('2026-10-01', 50, () => 100, { tags: { team: 'pagamentos' } }),
    ...series('2026-10-01', 50, () => 50, { tags: { team: 'portal' } }),
  ];
  const options = { month: '2026-11', asOf: '2026-11-19' };

  it('avalia por escopo de tag e marca risco pela previsão', () => {
    const status = evaluateBudget(
      records,
      { id: 'pag', name: 'Pagamentos', amount: 2800, scope: { dimension: 'tag:team', key: 'pagamentos' } },
      options,
    );
    expect(status).toMatchObject({ status: 'at_risk', crossedByActual: [], crossedByForecast: [0.8, 1] });
    expect(status.forecast.forecast).toBe(3000);

    const over = evaluateBudget(records, { id: 'tudo', name: 'Total', amount: 2500 }, options);
    expect(over.status).toBe('over_budget');
  });

  it('valida orçamento', () => {
    expect(() => evaluateBudget(records, { id: 'x', name: 'X', amount: 0 }, options)).toThrow(/valor inválido/);
    expect(() => evaluateBudget(records, { id: 'x', name: 'X', amount: 10, thresholds: [3] }, options)).toThrow(
      /limiar/,
    );
  });

  it('gera um evento por orçamento, com o maior limiar e prioridade para o realizado', () => {
    const status = evaluateBudget(records, { id: 'tudo', name: 'Total', amount: 3000 }, options);
    // Realizado 2850 (95%) e previsão 4500 (150%): realizado cruza 0,8; previsão cruza 1.
    const events = buildAlertEvents({ anomalies: [], budgets: [status], minSeverity: 'low' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'budget', threshold: 1, basis: 'forecast', severity: 'high' });
    expect(events[0]!.dedupKey).toBe('budget:tudo:2026-11:forecast:1');
    expect(text(renderAlertText(events[0]!, 'USD'))).toContain('deve fechar o mês em US$ 4.500,00');
  });

  it('filtra por severidade mínima e escreve texto legível', () => {
    const anomaly: Anomaly = {
      id: 'service:Amazon EC2:2026-11-12',
      kind: 'spike',
      date: '2026-11-12',
      dimension: 'service',
      key: 'Amazon EC2',
      actual: 112.84,
      expected: 60.09,
      impact: 52.75,
      relativeChange: 0.88,
      score: 14,
      severity: 'high',
      drivers: [{ key: '/subscriptions/x/resourcegroups/rg/providers/a/b/nat-01', actual: 60, expected: 8, delta: 52 }],
    };
    expect(buildAlertEvents({ anomalies: [anomaly], budgets: [], minSeverity: 'critical' })).toEqual([]);
    const [event] = buildAlertEvents({ anomalies: [anomaly], budgets: [], minSeverity: 'medium' });
    expect(text(renderAlertText(event!, 'USD'))).toBe(
      '[alta] Pico de custo em Amazon EC2 (2026-11-12): US$ 112,84 contra US$ 60,09 esperados (+US$ 52,75). Maiores variações: nat-01 (+US$ 52,00).',
    );
  });
});
