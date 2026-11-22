import type { Overview } from '../api';
import { money, percent } from '../format';

interface Props {
  overview: Overview;
}

const CONFIDENCE = { high: 'alta', medium: 'média', low: 'baixa' } as const;

export function KpiCards({ overview }: Props) {
  const { currency, last30Days, month, anomalies, savings, budgets } = overview;
  const mainBudget = budgets[0];
  // Custo subir é ruim: a cor do delta inverte a convenção de "verde = sobe".
  const trend =
    last30Days.change === null ? 'flat' : last30Days.change > 0.02 ? 'up' : last30Days.change < -0.02 ? 'down' : 'flat';

  return (
    <section className="kpis" aria-label="Indicadores principais">
      <article className="kpi">
        <h2>Custo efetivo · 30 dias</h2>
        <p className="kpi-value">{money(last30Days.total, currency)}</p>
        <p className={`kpi-delta delta-${trend}`}>
          <span aria-hidden="true">{trend === 'up' ? '▲' : trend === 'down' ? '▼' : '■'}</span>{' '}
          {percent(last30Days.change, { signed: true })} vs. 30 dias anteriores
        </p>
      </article>

      <article className="kpi">
        <h2>Previsão de fechamento · {month.month}</h2>
        <p className="kpi-value">{money(month.forecast, currency)}</p>
        <p className="kpi-sub">
          faixa {money(month.forecastLow, currency, true)} a {money(month.forecastHigh, currency, true)} · confiança{' '}
          {CONFIDENCE[month.confidence]}
        </p>
        {mainBudget && (
          <div className="budget-meter" title={`Orçamento ${mainBudget.budget.name}`}>
            <div className="budget-meter-track">
              <div
                className={`budget-meter-fill status-${mainBudget.status}`}
                style={{ width: `${Math.min(mainBudget.forecastUtilization, 1) * 100}%` }}
              />
            </div>
            <span>
              {percent(mainBudget.forecastUtilization, { decimals: 0 })} de{' '}
              {money(mainBudget.budget.amount, currency, true)}
            </span>
          </div>
        )}
      </article>

      <article className="kpi">
        <h2>Anomalias · 30 dias</h2>
        <p className="kpi-value">{anomalies.count}</p>
        <p className="kpi-sub">
          {anomalies.bySeverity.critical + anomalies.bySeverity.high} alta(s)/crítica(s) · impacto{' '}
          {money(anomalies.totalImpact, currency)}
        </p>
      </article>

      <article className="kpi kpi-accent">
        <h2>Economia potencial</h2>
        <p className="kpi-value">
          {money(savings.monthly, currency)}
          <small>/mês</small>
        </p>
        <p className="kpi-sub">{savings.recommendations} recomendação(ões) · estimativas podem se sobrepor</p>
      </article>
    </section>
  );
}
