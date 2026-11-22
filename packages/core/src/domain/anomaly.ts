import { dailyMatrix, dimensionKey, type Dimension } from './aggregation.js';
import type { CostMetric, CostRecord } from './cost-record.js';
import { addDays, dayOfWeek, maxDate, type IsoDate, type Period } from './dates.js';
import { DomainError } from './errors.js';
import { median, medianAbsoluteDeviation, relativeChange, round } from './money.js';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

export function isSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value);
}

export type AnomalyKind = 'spike' | 'new_spend';

export interface AnomalyDriver {
  key: string;
  actual: number;
  expected: number;
  delta: number;
}

export interface Anomaly {
  /** Identificador estável (dimensão + chave + dia): base da deduplicação de alertas. */
  id: string;
  kind: AnomalyKind;
  date: IsoDate;
  dimension: Dimension;
  key: string;
  actual: number;
  expected: number;
  /** Custo acima do esperado no dia. */
  impact: number;
  /** Variação relativa sobre o esperado; null para gasto novo (base zero). */
  relativeChange: number | null;
  /** Escore z robusto (desvios do MAD). */
  score: number;
  severity: Severity;
  /** Recursos (ou contas) que mais cresceram no dia: ponto de partida da investigação. */
  drivers: AnomalyDriver[];
}

export interface AnomalyOptions {
  dimension: Dimension;
  metric: CostMetric;
  /** Janela móvel de referência, em dias anteriores ao dia avaliado. */
  windowDays: number;
  /** Mínimo de dias de histórico na janela para avaliar o dia. */
  minHistoryDays: number;
  /** Limiar do escore z robusto. 3,5 é o valor de Iglewicz & Hoaglin para outliers. */
  zThreshold: number;
  /** Impacto absoluto mínimo por dia (na moeda do billing). Evita alertas de centavos. */
  minImpact: number;
  /** Aumento relativo mínimo sobre o esperado (0,2 = 20%). */
  minRelativeChange: number;
  /** Impacto diário a partir do qual a severidade sobe, independentemente do escore. */
  impactSeverity: { medium: number; high: number; critical: number };
  /** Considera o padrão semanal (fim de semana costuma custar menos em produção). */
  weekdaySeasonality: boolean;
  /** Primeiro dia com dados no histórico; dias anteriores não contam como "custo zero". */
  dataStart?: IsoDate;
}

export const DEFAULT_ANOMALY_OPTIONS: AnomalyOptions = {
  dimension: 'service',
  metric: 'effectiveCost',
  windowDays: 28,
  minHistoryDays: 14,
  zThreshold: 3.5,
  minImpact: 25,
  minRelativeChange: 0.2,
  impactSeverity: { medium: 50, high: 250, critical: 1000 },
  weekdaySeasonality: true,
};

const MAD_TO_SIGMA = 1.4826;
const MAX_SCORE = 99;
const SPARSE_JUMP_FACTOR = 3;

function validate(options: AnomalyOptions): void {
  if (options.windowDays < 7) throw new DomainError('windowDays deve ser >= 7', 'INVALID_OPTIONS');
  if (options.minHistoryDays < 3 || options.minHistoryDays > options.windowDays) {
    throw new DomainError('minHistoryDays deve estar entre 3 e windowDays', 'INVALID_OPTIONS');
  }
  if (options.zThreshold <= 0) throw new DomainError('zThreshold deve ser positivo', 'INVALID_OPTIONS');
  if (options.minImpact < 0 || options.minRelativeChange < 0) {
    throw new DomainError('minImpact e minRelativeChange não podem ser negativos', 'INVALID_OPTIONS');
  }
}

/**
 * Severidade é dinheiro: o critério principal é o impacto no dia. O escore só sobe um nível quando o
 * desvio é extremo (>= 10σ), porque aí o padrão mudou mesmo que o valor ainda seja pequeno.
 */
function severityFrom(score: number, impact: number, thresholds: AnomalyOptions['impactSeverity']): Severity {
  const byImpact: Severity =
    impact >= thresholds.critical
      ? 'critical'
      : impact >= thresholds.high
        ? 'high'
        : impact >= thresholds.medium
          ? 'medium'
          : 'low';
  const rank = severityRank(byImpact);
  return score >= 10 && rank < severityRank('high') ? SEVERITIES[rank + 1]! : byImpact;
}

interface Baseline {
  expected: number;
  sigma: number;
}

/**
 * Valor esperado e dispersão para o dia avaliado.
 *
 * Usa mediana e MAD em vez de média e desvio padrão: um pico dentro da janela não "contamina" a
 * referência, então dois dias seguidos de pico continuam sendo detectados. Com sazonalidade, o
 * esperado é a mediana geral multiplicada pelo fator do dia da semana.
 */
function baselineFor(
  window: readonly number[],
  windowDates: readonly IsoDate[],
  target: IsoDate,
  seasonal: boolean,
): Baseline {
  const overall = median(window);
  const factors = new Map<number, number>();

  if (seasonal && overall > 0) {
    const byWeekday = new Map<number, number[]>();
    windowDates.forEach((date, i) => {
      const dow = dayOfWeek(date);
      const bucket = byWeekday.get(dow);
      if (bucket) bucket.push(window[i]!);
      else byWeekday.set(dow, [window[i]!]);
    });
    for (const [dow, values] of byWeekday) {
      // Com uma única amostra o fator vira ruído; exige pelo menos duas semanas daquele dia.
      if (values.length >= 2) factors.set(dow, median(values) / overall);
    }
  }

  const expectedAt = (date: IsoDate): number => overall * (factors.get(dayOfWeek(date)) ?? 1);
  const residuals = window.map((value, i) => value - expectedAt(windowDates[i]!));
  const sigma = MAD_TO_SIGMA * medianAbsoluteDeviation(residuals);
  const expected = expectedAt(target);
  // Série constante tem MAD zero: um piso evita divisão por zero e escores infinitos por centavos.
  return { expected, sigma: Math.max(sigma, overall * 0.02, 0.01) };
}

function driversFor(
  records: readonly CostRecord[],
  anomaly: Pick<Anomaly, 'dimension' | 'key' | 'date'>,
  windowPeriod: Period,
  metric: CostMetric,
): AnomalyDriver[] {
  const related = records.filter(
    (record) =>
      dimensionKey(record, anomaly.dimension) === anomaly.key &&
      record.date >= windowPeriod.from &&
      record.date <= anomaly.date,
  );
  const useResource = related.some((record) => record.resourceId !== null);
  const { series } = dailyMatrix(
    related,
    { from: windowPeriod.from, to: anomaly.date },
    useResource ? 'resource' : 'subAccount',
    metric,
  );
  const drivers: AnomalyDriver[] = [];
  for (const [key, values] of series) {
    const actual = values[values.length - 1]!;
    const expected = median(values.slice(0, -1));
    const delta = actual - expected;
    if (delta > 0) drivers.push({ key, actual: round(actual), expected: round(expected), delta: round(delta) });
  }
  return drivers.sort((a, b) => b.delta - a.delta).slice(0, 3);
}

/**
 * Detecta picos de custo diário por chave da dimensão (ex.: por serviço).
 *
 * `records` precisa incluir o histórico anterior ao período (pelo menos `windowDays`); o serviço de
 * aplicação já carrega esse intervalo. Só picos são reportados: queda de custo raramente exige ação
 * imediata e geraria ruído quando um recurso é desligado de propósito.
 */
export function detectAnomalies(
  records: readonly CostRecord[],
  period: Period,
  overrides: Partial<AnomalyOptions> = {},
): Anomaly[] {
  const options: AnomalyOptions = { ...DEFAULT_ANOMALY_OPTIONS, ...overrides };
  validate(options);

  const dataStart =
    options.dataStart ??
    records.reduce<IsoDate | null>((min, r) => (min === null || r.date < min ? r.date : min), null);
  if (dataStart === null) return [];

  const historyFrom = addDays(period.from, -options.windowDays);
  const { dates, series } = dailyMatrix(
    records,
    { from: historyFrom, to: period.to },
    options.dimension,
    options.metric,
  );
  const anomalies: Anomaly[] = [];

  for (const [key, values] of series) {
    for (let i = options.windowDays; i < dates.length; i++) {
      const date = dates[i]!;
      const windowStart = maxDate(dates[i - options.windowDays]!, dataStart);
      const startIndex = dates.indexOf(windowStart);
      if (startIndex < 0 || startIndex >= i) continue;

      const window = values.slice(startIndex, i);
      if (window.length < options.minHistoryDays) continue;
      const windowDates = dates.slice(startIndex, i);
      const actual = values[i]!;

      const historyTotal = window.reduce((acc, v) => acc + v, 0);
      const typical = median(window);
      let anomaly: Omit<Anomaly, 'drivers'> | null = null;

      if (typical === 0) {
        // Série esparsa ou gasto que acabou de surgir: sem mediana para comparar, exige um salto
        // claro sobre o maior valor já visto. Assim um serviço novo gera um alerta no primeiro dia,
        // e não um por dia até a janela "aprender" o novo patamar.
        const peak = Math.max(...window);
        if (actual >= options.minImpact && actual >= SPARSE_JUMP_FACTOR * peak) {
          const kind: AnomalyKind = historyTotal === 0 ? 'new_spend' : 'spike';
          anomaly = {
            id: `${options.dimension}:${key}:${date}`,
            kind,
            date,
            dimension: options.dimension,
            key,
            actual: round(actual),
            expected: 0,
            impact: round(actual),
            relativeChange: null,
            score: MAX_SCORE,
            severity: severityFrom(MAX_SCORE, actual, options.impactSeverity),
          };
        }
      } else {
        const { expected, sigma } = baselineFor(window, windowDates, date, options.weekdaySeasonality);
        const impact = actual - expected;
        const score = Math.min(impact / sigma, MAX_SCORE);
        const change = relativeChange(actual, expected);
        const relativeOk = change === null || change >= options.minRelativeChange;
        if (score >= options.zThreshold && impact >= options.minImpact && relativeOk) {
          anomaly = {
            id: `${options.dimension}:${key}:${date}`,
            kind: 'spike',
            date,
            dimension: options.dimension,
            key,
            actual: round(actual),
            expected: round(expected),
            impact: round(impact),
            relativeChange: change === null ? null : round(change, 4),
            score: round(score, 2),
            severity: severityFrom(score, impact, options.impactSeverity),
          };
        }
      }

      if (anomaly) {
        const drivers = driversFor(records, anomaly, { from: windowStart, to: date }, options.metric);
        anomalies.push({ ...anomaly, drivers });
      }
    }
  }

  return anomalies.sort(
    (a, b) =>
      b.date.localeCompare(a.date) || severityRank(b.severity) - severityRank(a.severity) || b.impact - a.impact,
  );
}
