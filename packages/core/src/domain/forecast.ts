import { dailyMatrix, dimensionKey, type Dimension } from './aggregation.js';
import type { CostMetric, CostRecord } from './cost-record.js';
import {
  addDays,
  dateRange,
  dayOfWeek,
  maxDate,
  minDate,
  monthPeriod,
  periodLength,
  type IsoDate,
  type IsoMonth,
} from './dates.js';
import { DomainError } from './errors.js';
import { median, medianAbsoluteDeviation, round, sum } from './money.js';

export type Confidence = 'high' | 'medium' | 'low';

export interface MonthForecast {
  month: IsoMonth;
  /** Último dia com dado considerado (billing costuma chegar com 24 a 48 h de atraso). */
  asOf: IsoDate;
  actualToDate: number;
  projectedRemaining: number;
  forecast: number;
  /** Faixa de ~80% (±1,28σ), assumindo dias independentes. */
  forecastLow: number;
  forecastHigh: number;
  daysElapsed: number;
  daysInMonth: number;
  /** Média diária dos últimos 7 dias com dado. */
  dailyRunRate: number;
  confidence: Confidence;
}

export interface ForecastOptions {
  month: IsoMonth;
  asOf: IsoDate;
  metric?: CostMetric;
  /** Dias de histórico usados para projetar o restante do mês. */
  lookbackDays?: number;
  /** Primeiro dia com dados; antes dele não existe "custo zero". */
  dataStart?: IsoDate;
}

const Z_80 = 1.2816;
const MAD_TO_SIGMA = 1.4826;

/**
 * Projeção de fechamento do mês: realizado até `asOf` + mediana por dia da semana do histórico
 * recente para cada dia restante. A mediana ignora picos isolados (uma anomalia de ontem não infla
 * a previsão do mês inteiro) e o recorte por dia da semana respeita a queda típica do fim de semana.
 */
export function forecastMonth(records: readonly CostRecord[], options: ForecastOptions): MonthForecast {
  const metric = options.metric ?? 'effectiveCost';
  const lookbackDays = options.lookbackDays ?? 28;
  if (lookbackDays < 7) throw new DomainError('lookbackDays deve ser >= 7', 'INVALID_OPTIONS');

  const month = monthPeriod(options.month);
  const daysInMonth = periodLength(month);
  const dataStart =
    options.dataStart ??
    records.reduce<IsoDate | null>((min, r) => (min === null || r.date < min ? r.date : min), null);

  const elapsedEnd = minDate(options.asOf, month.to);
  const actualToDate =
    elapsedEnd < month.from
      ? 0
      : sum(records.filter((r) => r.date >= month.from && r.date <= elapsedEnd).map((r) => r[metric]));
  const daysElapsed = elapsedEnd < month.from ? 0 : periodLength({ from: month.from, to: elapsedEnd });

  const historyFrom = maxDate(addDays(options.asOf, -(lookbackDays - 1)), dataStart ?? options.asOf);
  const history =
    dataStart === null || historyFrom > options.asOf
      ? { dates: [] as IsoDate[], values: [] as number[] }
      : (() => {
          const matrix = dailyMatrix(records, { from: historyFrom, to: options.asOf }, null, metric);
          return { dates: matrix.dates, values: matrix.series.get('total') ?? matrix.dates.map(() => 0) };
        })();

  const remainingDates =
    options.asOf >= month.to ? [] : dateRange({ from: maxDate(addDays(options.asOf, 1), month.from), to: month.to });

  let projectedRemaining = 0;
  let variance = 0;
  if (remainingDates.length > 0 && history.values.length > 0) {
    const overall = median(history.values);
    const overallSigma = MAD_TO_SIGMA * medianAbsoluteDeviation(history.values);
    const byWeekday = new Map<number, number[]>();
    history.dates.forEach((date, i) => {
      const dow = dayOfWeek(date);
      const bucket = byWeekday.get(dow);
      if (bucket) bucket.push(history.values[i]!);
      else byWeekday.set(dow, [history.values[i]!]);
    });
    for (const date of remainingDates) {
      const sample = byWeekday.get(dayOfWeek(date));
      const usable = sample && sample.length >= 2;
      const expected = usable ? median(sample) : overall;
      const sigma = usable ? MAD_TO_SIGMA * medianAbsoluteDeviation(sample) : overallSigma;
      projectedRemaining += expected;
      variance += sigma * sigma;
    }
  }

  const forecast = actualToDate + projectedRemaining;
  const spread = Z_80 * Math.sqrt(variance);
  const recent = history.values.slice(-7);
  const confidence: Confidence =
    remainingDates.length === 0
      ? 'high'
      : history.values.length >= 21
        ? 'high'
        : history.values.length >= 7
          ? 'medium'
          : 'low';

  return {
    month: options.month,
    asOf: options.asOf,
    actualToDate: round(actualToDate),
    projectedRemaining: round(projectedRemaining),
    forecast: round(forecast),
    forecastLow: round(Math.max(actualToDate, forecast - spread)),
    forecastHigh: round(forecast + spread),
    daysElapsed,
    daysInMonth,
    dailyRunRate: recent.length === 0 ? 0 : round(sum(recent) / recent.length),
    confidence,
  };
}

export interface BudgetScope {
  dimension: Dimension;
  key: string;
}

export interface Budget {
  id: string;
  name: string;
  /** Valor mensal na moeda do billing. */
  amount: number;
  /** Sem escopo = orçamento da conta inteira. */
  scope?: BudgetScope;
  /** Frações do orçamento que disparam alerta (padrão 80% e 100%). */
  thresholds?: number[];
}

export type BudgetHealth = 'on_track' | 'at_risk' | 'over_budget';

export interface BudgetStatus {
  budget: Budget;
  forecast: MonthForecast;
  actualUtilization: number;
  forecastUtilization: number;
  status: BudgetHealth;
  /** Limiares já atingidos pelo realizado. */
  crossedByActual: number[];
  /** Limiares que a previsão de fechamento vai atingir (alerta antecipado). */
  crossedByForecast: number[];
}

export const DEFAULT_BUDGET_THRESHOLDS = [0.8, 1];

export function validateBudget(budget: Budget): void {
  if (budget.id.trim() === '' || budget.name.trim() === '') {
    throw new DomainError('orçamento precisa de id e nome', 'INVALID_BUDGET');
  }
  if (!Number.isFinite(budget.amount) || budget.amount <= 0) {
    throw new DomainError(`orçamento "${budget.id}" com valor inválido`, 'INVALID_BUDGET');
  }
  for (const threshold of budget.thresholds ?? []) {
    if (!(threshold > 0 && threshold <= 2)) {
      throw new DomainError(`orçamento "${budget.id}": limiar ${threshold} fora de (0, 2]`, 'INVALID_BUDGET');
    }
  }
}

export function evaluateBudget(records: readonly CostRecord[], budget: Budget, options: ForecastOptions): BudgetStatus {
  validateBudget(budget);
  const scope = budget.scope;
  const dataStart =
    options.dataStart ??
    records.reduce<IsoDate | null>((min, r) => (min === null || r.date < min ? r.date : min), null);
  const scoped = scope ? records.filter((record) => dimensionKey(record, scope.dimension) === scope.key) : records;
  const forecast = forecastMonth(scoped, { ...options, ...(dataStart ? { dataStart } : {}) });
  const thresholds = [...(budget.thresholds ?? DEFAULT_BUDGET_THRESHOLDS)].sort((a, b) => a - b);

  const actualUtilization = forecast.actualToDate / budget.amount;
  const forecastUtilization = forecast.forecast / budget.amount;
  const status: BudgetHealth =
    actualUtilization >= 1 ? 'over_budget' : forecastUtilization >= 1 ? 'at_risk' : 'on_track';

  return {
    budget,
    forecast,
    actualUtilization: round(actualUtilization, 4),
    forecastUtilization: round(forecastUtilization, 4),
    status,
    crossedByActual: thresholds.filter((t) => actualUtilization >= t),
    crossedByForecast: thresholds.filter((t) => forecastUtilization >= t),
  };
}
