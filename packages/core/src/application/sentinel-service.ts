import { buildAlertEvents, type AlertEvent } from '../domain/alerts.js';
import {
  breakdown,
  dailySeries,
  totalCost,
  type BreakdownItem,
  type DailyPoint,
  type Dimension,
} from '../domain/aggregation.js';
import {
  DEFAULT_ANOMALY_OPTIONS,
  detectAnomalies,
  severityRank,
  type Anomaly,
  type AnomalyOptions,
  type Severity,
} from '../domain/anomaly.js';
import type { CostMetric, CostRecord } from '../domain/cost-record.js';
import {
  addDays,
  isIsoMonth,
  maxDate,
  monthOf,
  monthPeriod,
  periodLength,
  previousPeriod,
  type IsoDate,
  type IsoMonth,
  type Period,
} from '../domain/dates.js';
import { DomainError } from '../domain/errors.js';
import {
  evaluateBudget,
  forecastMonth,
  validateBudget,
  type Budget,
  type BudgetStatus,
  type MonthForecast,
} from '../domain/forecast.js';
import { relativeChange, round, sum } from '../domain/money.js';
import { generateRecommendations, type Recommendation, type RecommendationConfig } from '../domain/recommendations.js';
import type { AlertStateStore, CostRepository, CostSource, Logger, Notifier, ReplaceScope } from './ports.js';

export interface SentinelConfig {
  budgets: Budget[];
  anomaly: Partial<AnomalyOptions>;
  recommendations: Partial<RecommendationConfig>;
  /** Tamanho do período padrão quando a consulta não informa datas. */
  defaultPeriodDays: number;
  /** Maior intervalo aceito numa consulta (protege a API de varreduras enormes). */
  maxPeriodDays: number;
}

export const DEFAULT_SENTINEL_CONFIG: SentinelConfig = {
  budgets: [],
  anomaly: {},
  recommendations: {},
  defaultPeriodDays: 30,
  maxPeriodDays: 400,
};

export interface SentinelDependencies {
  repository: CostRepository;
  alertState: AlertStateStore;
  notifiers?: Notifier[];
  logger?: Logger;
  config?: Partial<SentinelConfig>;
  now?: () => Date;
}

export interface ImportSummary {
  origin: string;
  inserted: number;
  removed: number;
  period: Period | null;
}

export interface PeriodQuery {
  from?: IsoDate;
  to?: IsoDate;
}

export interface SummaryResult {
  period: Period;
  previousPeriod: Period;
  currency: string;
  metric: CostMetric;
  total: number;
  previousTotal: number;
  change: number | null;
  dimension: Dimension;
  items: BreakdownItem[];
}

export interface OverviewResult {
  currency: string;
  dataFrom: IsoDate;
  dataTo: IsoDate;
  last30Days: { total: number; previousTotal: number; change: number | null };
  month: MonthForecast;
  budgets: BudgetStatus[];
  anomalies: { count: number; bySeverity: Record<Severity, number>; totalImpact: number };
  savings: { monthly: number; recommendations: number };
}

export interface AlertRunResult {
  evaluated: number;
  sent: number;
  skippedDuplicates: number;
  failures: { notifier: string; message: string }[];
  events: AlertEvent[];
}

const noopLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** Casos de uso do FinOps Sentinel. Não conhece HTTP, banco ou SDK de nuvem: só as portas. */
export class SentinelService {
  private readonly repository: CostRepository;
  private readonly alertState: AlertStateStore;
  private readonly notifiers: Notifier[];
  private readonly logger: Logger;
  private readonly config: SentinelConfig;
  private readonly now: () => Date;

  constructor(deps: SentinelDependencies) {
    this.repository = deps.repository;
    this.alertState = deps.alertState;
    this.notifiers = deps.notifiers ?? [];
    this.logger = deps.logger ?? noopLogger;
    this.config = { ...DEFAULT_SENTINEL_CONFIG, ...deps.config };
    this.now = deps.now ?? (() => new Date());
    const ids = new Set<string>();
    for (const budget of this.config.budgets) {
      validateBudget(budget);
      if (ids.has(budget.id)) throw new DomainError(`orçamento duplicado: ${budget.id}`, 'INVALID_BUDGET');
      ids.add(budget.id);
    }
  }

  get budgets(): readonly Budget[] {
    return this.config.budgets;
  }

  async importRecords(records: readonly CostRecord[], origin: string): Promise<ImportSummary> {
    if (records.length === 0) return { origin, inserted: 0, removed: 0, period: null };

    const incoming = [...new Set(records.map((r) => r.currency))];
    const existing = await this.repository.currencies();
    const all = new Set([...incoming, ...existing]);
    if (all.size > 1) {
      // Somar USD com BRL produz números sem sentido. Conversão cambial é decisão de negócio (taxa do dia?
      // do fechamento?), então o sistema recusa em vez de converter silenciosamente.
      throw new DomainError(
        `moedas diferentes no histórico (${[...all].sort().join(', ')}). Use exports na mesma moeda de faturamento.`,
        'CURRENCY_MISMATCH',
      );
    }

    const scopes = new Map<string, ReplaceScope>();
    for (const record of records) {
      const key = `${record.provider}|${record.billingAccountId}`;
      const scope = scopes.get(key);
      if (!scope) {
        scopes.set(key, {
          provider: record.provider,
          billingAccountId: record.billingAccountId,
          period: { from: record.date, to: record.date },
        });
      } else {
        if (record.date < scope.period.from) scope.period.from = record.date;
        if (record.date > scope.period.to) scope.period.to = record.date;
      }
    }

    const result = await this.repository.replace({ records, scope: [...scopes.values()] });
    const dates = [...scopes.values()].map((s) => s.period);
    const period = {
      from: dates.reduce((min, p) => (p.from < min ? p.from : min), dates[0]!.from),
      to: dates.reduce((max, p) => (p.to > max ? p.to : max), dates[0]!.to),
    };
    this.logger.info('importação concluída', { origin, ...result, ...period });
    return { origin, ...result, period };
  }

  async syncSource(source: CostSource, days = 35): Promise<ImportSummary> {
    const today = this.now().toISOString().slice(0, 10);
    const period = { from: addDays(today, -days), to: addDays(today, -1) };
    const records = await source.fetch(period);
    return this.importRecords(records, source.name);
  }

  async status(): Promise<{ records: number; from: IsoDate | null; to: IsoDate | null; currency: string }> {
    const [count, bounds, currency] = await Promise.all([
      this.repository.count(),
      this.repository.bounds(),
      this.currency(),
    ]);
    return { records: count, from: bounds?.from ?? null, to: bounds?.to ?? null, currency };
  }

  /**
   * Período padrão termina no último dia COM DADO, não em "hoje": billing chega com atraso de 1 a 2 dias
   * e terminar em hoje mostraria uma queda falsa de custo no final de todo gráfico.
   */
  async resolvePeriod(query: PeriodQuery = {}, defaultDays = this.config.defaultPeriodDays): Promise<Period> {
    const bounds = await this.requireData();
    const to = query.to ?? bounds.to;
    const from = query.from ?? addDays(to, -(defaultDays - 1));
    if (from > to) throw new DomainError('"from" deve ser anterior ou igual a "to"', 'INVALID_PERIOD');
    if (periodLength({ from, to }) > this.config.maxPeriodDays) {
      throw new DomainError(`período máximo é de ${this.config.maxPeriodDays} dias`, 'INVALID_PERIOD');
    }
    return { from, to };
  }

  async summary(
    query: PeriodQuery & { dimension: Dimension; metric?: CostMetric; limit?: number },
  ): Promise<SummaryResult> {
    const metric = query.metric ?? 'effectiveCost';
    const period = await this.resolvePeriod(query);
    const previous = previousPeriod(period);
    const [records, previousRecords, currency] = await Promise.all([
      this.repository.list(period),
      this.repository.list(previous),
      this.currency(),
    ]);
    const total = totalCost(records, metric);
    const previousTotal = totalCost(previousRecords, metric);
    const change = relativeChange(total, previousTotal);
    return {
      period,
      previousPeriod: previous,
      currency,
      metric,
      total: round(total),
      previousTotal: round(previousTotal),
      change: change === null ? null : round(change, 4),
      dimension: query.dimension,
      items: breakdown(records, query.dimension, metric).slice(0, query.limit ?? 50),
    };
  }

  async timeseries(
    query: PeriodQuery & { dimension: Dimension; top?: number; metric?: CostMetric },
  ): Promise<{ period: Period; currency: string; keys: string[]; points: DailyPoint[] }> {
    const period = await this.resolvePeriod(query);
    const [records, currency] = await Promise.all([this.repository.list(period), this.currency()]);
    const series = dailySeries(records, period, query.dimension, {
      ...(query.top !== undefined ? { top: query.top } : {}),
      ...(query.metric ? { metric: query.metric } : {}),
    });
    return { period, currency, ...series };
  }

  async anomalies(
    query: PeriodQuery & { dimension?: Dimension; minSeverity?: Severity } = {},
  ): Promise<{ period: Period; currency: string; items: Anomaly[] }> {
    const bounds = await this.requireData();
    const period = await this.resolvePeriod(query);
    const options = {
      ...DEFAULT_ANOMALY_OPTIONS,
      ...this.config.anomaly,
      ...(query.dimension ? { dimension: query.dimension } : {}),
    };
    const history = { from: maxDate(addDays(period.from, -options.windowDays), bounds.from), to: period.to };
    const [records, currency] = await Promise.all([this.repository.list(history), this.currency()]);
    const minRank = severityRank(query.minSeverity ?? 'low');
    const items = detectAnomalies(records, period, { ...options, dataStart: bounds.from }).filter(
      (a) => severityRank(a.severity) >= minRank,
    );
    return { period, currency, items };
  }

  async forecast(
    query: { month?: IsoMonth } = {},
  ): Promise<{ currency: string; forecast: MonthForecast; budgets: BudgetStatus[] }> {
    const bounds = await this.requireData();
    const month = query.month ?? monthOf(bounds.to);
    if (!isIsoMonth(month)) throw new DomainError('mês inválido (use YYYY-MM)', 'INVALID_MONTH');
    const monthRange = monthPeriod(month);
    const asOf = bounds.to < monthRange.to ? bounds.to : monthRange.to;
    const history = { from: maxDate(addDays(asOf, -60), bounds.from), to: monthRange.to };
    const [records, currency] = await Promise.all([this.repository.list(history), this.currency()]);
    const options = { month, asOf, dataStart: bounds.from };
    return {
      currency,
      forecast: forecastMonth(records, options),
      budgets: this.config.budgets.map((budget) => evaluateBudget(records, budget, options)),
    };
  }

  async recommendations(query: { lookbackDays?: number } = {}): Promise<{
    period: Period;
    currency: string;
    totalMonthlySavings: number;
    items: Recommendation[];
    errors: { ruleId: string; message: string }[];
  }> {
    const bounds = await this.requireData();
    const lookback = query.lookbackDays ?? 30;
    const period = { from: maxDate(addDays(bounds.to, -(lookback - 1)), bounds.from), to: bounds.to };
    const [records, currency] = await Promise.all([this.repository.list(period), this.currency()]);
    const { recommendations, errors } = generateRecommendations(records, period, this.config.recommendations);
    for (const error of errors) this.logger.error('regra de recomendação falhou', error);
    return {
      period,
      currency,
      totalMonthlySavings: round(sum(recommendations.map((r) => r.estimatedMonthlySavings))),
      items: recommendations,
      errors,
    };
  }

  async overview(): Promise<OverviewResult> {
    const bounds = await this.requireData();
    const [summary, forecast, anomalies, recommendations] = await Promise.all([
      this.summary({ dimension: 'provider' }),
      this.forecast(),
      this.anomalies(),
      this.recommendations(),
    ]);
    const bySeverity: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const anomaly of anomalies.items) bySeverity[anomaly.severity]++;
    return {
      currency: summary.currency,
      dataFrom: bounds.from,
      dataTo: bounds.to,
      last30Days: { total: summary.total, previousTotal: summary.previousTotal, change: summary.change },
      month: forecast.forecast,
      budgets: forecast.budgets,
      anomalies: {
        count: anomalies.items.length,
        bySeverity,
        totalImpact: round(sum(anomalies.items.map((a) => a.impact))),
      },
      savings: { monthly: recommendations.totalMonthlySavings, recommendations: recommendations.items.length },
    };
  }

  /**
   * Avalia anomalias dos últimos dias e orçamentos do mês e notifica o que ainda não foi enviado.
   * Um evento só é marcado como enviado se todos os canais aceitarem; se algum falhar, ele volta na
   * próxima execução (preferimos um alerta repetido a um alerta perdido).
   */
  async runAlerts(
    options: { minSeverity?: Severity; lookbackDays?: number; dryRun?: boolean } = {},
  ): Promise<AlertRunResult> {
    const bounds = await this.repository.bounds();
    if (!bounds) return { evaluated: 0, sent: 0, skippedDuplicates: 0, failures: [], events: [] };

    const lookback = options.lookbackDays ?? 3;
    const [anomalies, forecast, currency] = await Promise.all([
      this.anomalies({ from: maxDate(addDays(bounds.to, -(lookback - 1)), bounds.from), to: bounds.to }),
      this.forecast(),
      this.currency(),
    ]);
    const events = buildAlertEvents({
      anomalies: anomalies.items,
      budgets: forecast.budgets,
      minSeverity: options.minSeverity ?? 'medium',
    });

    const pending: AlertEvent[] = [];
    let skippedDuplicates = 0;
    for (const event of events) {
      if (await this.alertState.wasSent(event.dedupKey)) skippedDuplicates++;
      else pending.push(event);
    }

    if (options.dryRun || pending.length === 0 || this.notifiers.length === 0) {
      return { evaluated: events.length, sent: 0, skippedDuplicates, failures: [], events: pending };
    }

    const failures: { notifier: string; message: string }[] = [];
    await Promise.all(
      this.notifiers.map(async (notifier) => {
        try {
          await notifier.send(pending, { currency });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push({ notifier: notifier.name, message });
          this.logger.error('falha ao enviar alertas', { notifier: notifier.name, message });
        }
      }),
    );

    if (failures.length === 0) {
      const sentAt = this.now();
      for (const event of pending) await this.alertState.markSent(event.dedupKey, sentAt);
    }
    return {
      evaluated: events.length,
      sent: failures.length === 0 ? pending.length : 0,
      skippedDuplicates,
      failures,
      events: pending,
    };
  }

  private async currency(): Promise<string> {
    return (await this.repository.currencies())[0] ?? 'USD';
  }

  private async requireData(): Promise<{ from: IsoDate; to: IsoDate }> {
    const bounds = await this.repository.bounds();
    if (!bounds) throw new DomainError('nenhum dado de custo importado ainda', 'NO_DATA');
    return bounds;
  }
}
