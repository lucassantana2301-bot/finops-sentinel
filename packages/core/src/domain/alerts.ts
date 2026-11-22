import { severityRank, type Anomaly, type Severity } from './anomaly.js';
import type { BudgetStatus } from './forecast.js';
import { shortResourceName } from './cost-record.js';
import { formatMoney } from './money.js';

export type AlertEvent =
  | {
      kind: 'anomaly';
      /** Chave de deduplicação: o mesmo pico nunca é notificado duas vezes. */
      dedupKey: string;
      severity: Severity;
      anomaly: Anomaly;
    }
  | {
      kind: 'budget';
      dedupKey: string;
      severity: Severity;
      status: BudgetStatus;
      threshold: number;
      basis: 'actual' | 'forecast';
    };

export interface AlertSelection {
  anomalies: readonly Anomaly[];
  budgets: readonly BudgetStatus[];
  minSeverity: Severity;
}

function budgetSeverity(threshold: number, basis: 'actual' | 'forecast'): Severity {
  if (threshold >= 1) return basis === 'actual' ? 'critical' : 'high';
  return basis === 'actual' ? 'medium' : 'low';
}

/**
 * Monta os eventos a notificar. Para orçamento, só o maior limiar atingido gera evento (quem passou
 * de 100% não precisa de um segundo aviso de 80%), e o realizado tem prioridade sobre a previsão.
 */
export function buildAlertEvents(selection: AlertSelection): AlertEvent[] {
  const minRank = severityRank(selection.minSeverity);
  const events: AlertEvent[] = [];

  for (const anomaly of selection.anomalies) {
    if (severityRank(anomaly.severity) < minRank) continue;
    events.push({ kind: 'anomaly', dedupKey: `anomaly:${anomaly.id}`, severity: anomaly.severity, anomaly });
  }

  for (const status of selection.budgets) {
    const actual = status.crossedByActual.at(-1);
    const forecast = status.crossedByForecast.at(-1);
    const chosen =
      actual !== undefined && (forecast === undefined || actual >= forecast)
        ? { threshold: actual, basis: 'actual' as const }
        : forecast !== undefined
          ? { threshold: forecast, basis: 'forecast' as const }
          : null;
    if (!chosen) continue;
    const severity = budgetSeverity(chosen.threshold, chosen.basis);
    if (severityRank(severity) < minRank) continue;
    events.push({
      kind: 'budget',
      dedupKey: `budget:${status.budget.id}:${status.forecast.month}:${chosen.basis}:${chosen.threshold}`,
      severity,
      status,
      threshold: chosen.threshold,
      basis: chosen.basis,
    });
  }

  return events.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

const SEVERITY_LABEL: Record<Severity, string> = {
  low: 'baixa',
  medium: 'média',
  high: 'alta',
  critical: 'crítica',
};

/** Texto curto (Slack/Teams/e-mail) em português. */
export function renderAlertText(event: AlertEvent, currency: string): string {
  const money = (value: number) => formatMoney(value, currency);
  if (event.kind === 'anomaly') {
    const a = event.anomaly;
    const head =
      a.kind === 'new_spend'
        ? `Gasto novo em ${a.key} (${a.date}): ${money(a.actual)} no dia, sem histórico anterior.`
        : `Pico de custo em ${a.key} (${a.date}): ${money(a.actual)} contra ${money(a.expected)} esperados (+${money(a.impact)}).`;
    const drivers = a.drivers.length
      ? ` Maiores variações: ${a.drivers.map((d) => `${shortResourceName(d.key)} (+${money(d.delta)})`).join(', ')}.`
      : '';
    return `[${SEVERITY_LABEL[event.severity]}] ${head}${drivers}`;
  }
  const s = event.status;
  const pct = Math.round(event.threshold * 100);
  const detail =
    event.basis === 'actual'
      ? `já consumiu ${Math.round(s.actualUtilization * 100)}% (${money(s.forecast.actualToDate)})`
      : `deve fechar o mês em ${money(s.forecast.forecast)} (${Math.round(s.forecastUtilization * 100)}%)`;
  return `[${SEVERITY_LABEL[event.severity]}] Orçamento "${s.budget.name}" (${money(s.budget.amount)}) ${detail}, acima do limiar de ${pct}%.`;
}
