import { describe, expect, it } from 'vitest';
import { addDays, detectAnomalies, isWeekend, type CostRecord } from '../src/index.js';
import { jitter, record, series } from './helpers.js';

const START = '2026-09-01';
const lastDay = (days: number) => addDays(START, days - 1);
const evaluate = (records: CostRecord[], days: number, from = lastDay(days)) =>
  detectAnomalies(records, { from, to: lastDay(days) }, { minImpact: 10 });

describe('detecção de anomalias', () => {
  it('detecta pico isolado e aponta o recurso responsável', () => {
    const base = series(START, 60, (_, i) => 100 * jitter(i));
    const spikeDay = lastDay(60);
    const records = [
      ...base.filter((r) => r.date !== spikeDay),
      record({ date: spikeDay, billedCost: 100, effectiveCost: 100, resourceId: 'i-001' }),
      record({ date: spikeDay, billedCost: 180, effectiveCost: 180, resourceId: 'nat-gw' }),
    ];
    const [anomaly] = evaluate(records, 60);
    expect(anomaly).toMatchObject({ kind: 'spike', date: spikeDay, key: 'Amazon EC2' });
    expect(anomaly!.impact).toBeGreaterThan(150);
    expect(anomaly!.drivers[0]).toMatchObject({ key: 'nat-gw', delta: 180 });
  });

  it('não confunde queda de fim de semana com anomalia (e pega pico no fim de semana)', () => {
    const value = (date: string, i: number) => (isWeekend(date) ? 40 : 100) * jitter(i);
    const records = series(START, 70, value);
    expect(detectAnomalies(records, { from: addDays(START, 35), to: lastDay(70) }, { minImpact: 10 })).toEqual([]);

    // Sábado a 95 não é absurdo num dia útil, mas é 2,4x o sábado típico.
    const saturday = [...Array(70).keys()]
      .map((i) => addDays(START, i))
      .filter((d) => new Date(d).getUTCDay() === 6)
      .at(-1)!;
    const withSpike = records.map((r) => (r.date === saturday ? { ...r, billedCost: 95, effectiveCost: 95 } : r));
    const found = detectAnomalies(withSpike, { from: saturday, to: saturday }, { minImpact: 10 });
    expect(found).toHaveLength(1);
    expect(found[0]!.expected).toBeLessThan(50);
  });

  it('detecta dois dias seguidos de pico (a mediana não absorve o primeiro)', () => {
    const records = series(START, 60, (_, i) => (i >= 58 ? 300 : 100 * jitter(i)));
    expect(evaluate(records, 60, lastDay(59)).map((a) => a.date)).toEqual([lastDay(60), lastDay(59)]);
  });

  it('gasto novo gera um alerta só, no primeiro dia', () => {
    const base = series(START, 60, (_, i) => 50 * jitter(i));
    const fresh = series(addDays(START, 55), 5, () => 80, {
      serviceName: 'Azure OpenAI',
      serviceCategory: 'AI and Machine Learning',
    });
    const found = evaluate([...base, ...fresh], 60, addDays(START, 50)).filter((a) => a.key === 'Azure OpenAI');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'new_spend', date: addDays(START, 55), relativeChange: null });
  });

  it('ignora variação pequena em dinheiro mesmo com escore alto', () => {
    const records = series(START, 40, (_, i) => (i === 39 ? 5 : 1));
    expect(detectAnomalies(records, { from: lastDay(40), to: lastDay(40) }, { minImpact: 25 })).toEqual([]);
  });

  it('não avalia sem histórico mínimo e não trata "antes dos dados" como custo zero', () => {
    const records = series(START, 10, (_, i) => (i === 9 ? 500 : 100));
    expect(evaluate(records, 10, START)).toEqual([]);
  });

  it('classifica severidade pelo impacto em dinheiro', () => {
    const records = series(START, 60, (_, i) => (i === 59 ? 1600 : 100 * jitter(i)));
    expect(evaluate(records, 60)[0]!.severity).toBe('critical');
  });

  it('valida parâmetros', () => {
    expect(() => detectAnomalies([], { from: START, to: START }, { windowDays: 3 })).toThrow(/windowDays/);
    expect(detectAnomalies([], { from: START, to: START })).toEqual([]);
  });
});
