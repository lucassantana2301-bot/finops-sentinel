import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateRange,
  isIsoDate,
  median,
  monthPeriod,
  normalizeDate,
  percentile,
  previousPeriod,
  relativeChange,
  round,
  sum,
} from '../src/index.js';

describe('datas', () => {
  it('valida datas de calendário de verdade', () => {
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
  });

  it('normaliza os formatos dos exports para dia UTC', () => {
    expect(normalizeDate('2026-11-01T00:00:00Z')).toBe('2026-11-01');
    expect(normalizeDate('2026-11-01 00:00:00')).toBe('2026-11-01');
    expect(normalizeDate('11/05/2026')).toBe('2026-11-05'); // Azure: MM/DD/YYYY
    expect(normalizeDate('20261105')).toBe('2026-11-05');
    // 22h em São Paulo já é dia seguinte em UTC: o dia de cobrança é o UTC.
    expect(normalizeDate('2026-11-01T22:00:00-03:00')).toBe('2026-11-02');
    expect(normalizeDate('ontem')).toBeNull();
    expect(normalizeDate('')).toBeNull();
  });

  it('calcula meses e períodos sem erro de fuso ou ano bissexto', () => {
    expect(monthPeriod('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(dateRange({ from: '2026-11-01', to: '2026-11-03' })).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(previousPeriod({ from: '2026-11-01', to: '2026-11-30' })).toEqual({ from: '2026-10-02', to: '2026-10-31' });
    expect(() => monthPeriod('2026-13')).toThrow(/mês inválido/);
  });
});

describe('aritmética', () => {
  it('soma muitos valores pequenos sem acumular erro de float', () => {
    const values = Array.from({ length: 1_000_000 }, () => 0.1);
    expect(sum(values)).toBeCloseTo(100_000, 9);
    expect(sum([1e16, 1, -1e16])).toBe(1);
  });

  it('estatísticas robustas', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(percentile([10, 20, 30, 40, 50], 0.1)).toBeCloseTo(14);
    expect(relativeChange(110, 100)).toBeCloseTo(0.1);
    expect(relativeChange(5, 0)).toBeNull();
    expect(round(-0.001)).toBe(0);
    expect(Object.is(round(-0.001), -0)).toBe(false);
  });
});
