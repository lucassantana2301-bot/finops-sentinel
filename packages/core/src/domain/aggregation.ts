import type { CostMetric, CostRecord } from './cost-record.js';
import { dateRange, inPeriod, type IsoDate, type Period } from './dates.js';
import { DomainError } from './errors.js';
import { round, sum } from './money.js';

/**
 * Dimensões de agrupamento. `tag:<chave>` agrupa pelo valor da tag (ex.: `tag:team`),
 * que é como FinOps faz showback/chargeback por time.
 */
export type Dimension =
  | 'service'
  | 'serviceCategory'
  | 'provider'
  | 'subAccount'
  | 'region'
  | 'resource'
  | 'pricingCategory'
  | `tag:${string}`;

export const UNTAGGED = '(sem tag)';
export const NO_RESOURCE = '(sem recurso)';
export const OTHERS = 'Outros';

const FIXED_DIMENSIONS = new Set([
  'service',
  'serviceCategory',
  'provider',
  'subAccount',
  'region',
  'resource',
  'pricingCategory',
]);
const TAG_DIMENSION = /^tag:[a-z0-9_.:/@+=-]{1,128}$/i;

export function isDimension(value: string): value is Dimension {
  return FIXED_DIMENSIONS.has(value) || TAG_DIMENSION.test(value);
}

export function parseDimension(value: string): Dimension {
  if (!isDimension(value)) {
    throw new DomainError(
      `dimensão inválida "${value}". Use service, serviceCategory, provider, subAccount, region, resource, pricingCategory ou tag:<chave>`,
      'INVALID_DIMENSION',
    );
  }
  return value.startsWith('tag:') ? (`tag:${value.slice(4).toLowerCase()}` as Dimension) : value;
}

export function dimensionKey(record: CostRecord, dimension: Dimension): string {
  switch (dimension) {
    case 'service':
      return record.serviceName;
    case 'serviceCategory':
      return record.serviceCategory;
    case 'provider':
      return record.provider;
    case 'subAccount':
      return record.subAccountId;
    case 'region':
      return record.region;
    case 'resource':
      return record.resourceId ?? NO_RESOURCE;
    case 'pricingCategory':
      return record.pricingCategory;
    default:
      return record.tags[dimension.slice(4)] ?? UNTAGGED;
  }
}

export function filterByPeriod(records: readonly CostRecord[], period: Period): CostRecord[] {
  return records.filter((record) => inPeriod(record.date, period));
}

export function totalCost(records: readonly CostRecord[], metric: CostMetric = 'effectiveCost'): number {
  return sum(records.map((record) => record[metric]));
}

export interface BreakdownItem {
  key: string;
  cost: number;
  /** Participação no total, de 0 a 1. */
  share: number;
}

export function breakdown(
  records: readonly CostRecord[],
  dimension: Dimension,
  metric: CostMetric = 'effectiveCost',
): BreakdownItem[] {
  const groups = new Map<string, number[]>();
  for (const record of records) {
    const key = dimensionKey(record, dimension);
    const bucket = groups.get(key);
    if (bucket) bucket.push(record[metric]);
    else groups.set(key, [record[metric]]);
  }
  const totals = [...groups].map(([key, values]) => ({ key, cost: sum(values) }));
  const grandTotal = sum(totals.map((item) => item.cost));
  return totals
    .map((item) => ({
      key: item.key,
      cost: round(item.cost, 4),
      share: grandTotal === 0 ? 0 : round(item.cost / grandTotal, 6),
    }))
    .sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key));
}

/**
 * Matriz dia × chave com custo diário, preenchendo dias sem custo com zero.
 * Sem o preenchimento, um serviço que some num dia não apareceria como queda na série.
 */
export function dailyMatrix(
  records: readonly CostRecord[],
  period: Period,
  dimension: Dimension | null,
  metric: CostMetric = 'effectiveCost',
): { dates: IsoDate[]; series: Map<string, number[]> } {
  const dates = dateRange(period);
  const index = new Map(dates.map((date, i) => [date, i]));
  const series = new Map<string, number[]>();
  for (const record of records) {
    const position = index.get(record.date);
    if (position === undefined) continue;
    const key = dimension ? dimensionKey(record, dimension) : 'total';
    let values = series.get(key);
    if (!values) {
      values = new Array<number>(dates.length).fill(0);
      series.set(key, values);
    }
    values[position] = values[position]! + record[metric];
  }
  return { dates, series };
}

export interface DailyPoint {
  date: IsoDate;
  total: number;
  values: Record<string, number>;
}

/** Série diária com as `top` maiores chaves e o restante agrupado em "Outros". */
export function dailySeries(
  records: readonly CostRecord[],
  period: Period,
  dimension: Dimension,
  options: { top?: number; metric?: CostMetric } = {},
): { keys: string[]; points: DailyPoint[] } {
  const top = options.top ?? 6;
  const metric = options.metric ?? 'effectiveCost';
  const { dates, series } = dailyMatrix(records, period, dimension, metric);

  const ranked = [...series]
    .map(([key, values]) => ({ key, total: sum(values) }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  const kept = ranked.slice(0, top).map((item) => item.key);
  const hasOthers = ranked.length > top;
  const keys = hasOthers ? [...kept, OTHERS] : kept;
  const keptSet = new Set(kept);

  const points = dates.map((date, i) => {
    const values: Record<string, number> = {};
    let others = 0;
    let total = 0;
    for (const [key, daily] of series) {
      const value = daily[i]!;
      total += value;
      if (keptSet.has(key)) values[key] = round(value, 4);
      else others += value;
    }
    if (hasOthers) values[OTHERS] = round(others, 4);
    return { date, total: round(total, 4), values };
  });

  return { keys, points };
}
