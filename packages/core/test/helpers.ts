import { addDays, dateRange, isWeekend, type CostRecord, type IsoDate } from '../src/index.js';

export function record(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    date: '2026-11-01',
    provider: 'aws',
    billingAccountId: '900000000001',
    subAccountId: '100000000001',
    serviceName: 'Amazon EC2',
    serviceCategory: 'Compute',
    region: 'us-east-1',
    resourceId: 'i-001',
    usageType: null,
    instanceType: null,
    chargeCategory: 'Usage',
    pricingCategory: 'Standard',
    billedCost: 10,
    effectiveCost: 10,
    currency: 'USD',
    tags: { team: 'plataforma', env: 'prod' },
    ...overrides,
  };
}

/** Série diária: `valueAt(data, índice)` define o custo de cada dia. */
export function series(
  from: IsoDate,
  days: number,
  valueAt: (date: IsoDate, index: number) => number,
  overrides: Partial<CostRecord> = {},
): CostRecord[] {
  return dateRange({ from, to: addDays(from, days - 1) }).map((date, index) => {
    const value = valueAt(date, index);
    return record({ date, billedCost: value, effectiveCost: value, ...overrides });
  });
}

/** Ruído determinístico pequeno (±2%) para evitar MAD zero artificial. */
export const jitter = (index: number) => 1 + ((index * 7919) % 41) / 1000 - 0.02;

export const weekdayPattern = (date: IsoDate, base: number, weekendFactor: number) =>
  isWeekend(date) ? base * weekendFactor : base;
