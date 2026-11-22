import type { Forecast } from '../api';
import { money, percent } from '../format';

const STATUS = {
  on_track: { label: 'Dentro do orçamento', icon: '✔' },
  at_risk: { label: 'Em risco', icon: '▲' },
  over_budget: { label: 'Estourado', icon: '✖' },
} as const;

export function Budgets({ forecast }: { forecast: Forecast }) {
  const { currency } = forecast;
  return (
    <section className="panel" aria-labelledby="budgets-title">
      <header className="panel-header">
        <h2 id="budgets-title">Orçamentos · {forecast.forecast.month}</h2>
        <span className="panel-meta">dados até {forecast.forecast.asOf}</span>
      </header>
      {forecast.budgets.length === 0 ? (
        <p className="empty">
          Nenhum orçamento configurado. Defina a variável <code>BUDGETS</code> na API.
        </p>
      ) : (
        <ul className="budgets">
          {forecast.budgets.map((b) => {
            const status = STATUS[b.status];
            return (
              <li key={b.budget.id}>
                <div className="budget-head">
                  <strong>{b.budget.name}</strong>
                  <span className={`badge status-${b.status}`}>
                    <span aria-hidden="true">{status.icon}</span> {status.label}
                  </span>
                </div>
                <div
                  className="budget-meter-track"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(b.forecastUtilization * 100)}
                  aria-label={`Previsão: ${percent(b.forecastUtilization, { decimals: 0 })} do orçamento`}
                >
                  <div
                    className="budget-meter-actual"
                    style={{ width: `${Math.min(b.actualUtilization, 1) * 100}%` }}
                  />
                  <div
                    className={`budget-meter-fill status-${b.status}`}
                    style={{ width: `${Math.min(b.forecastUtilization, 1) * 100}%` }}
                  />
                </div>
                <p className="budget-numbers">
                  Realizado {money(b.forecast.actualToDate, currency)} ({percent(b.actualUtilization, { decimals: 0 })})
                  · previsão {money(b.forecast.forecast, currency)} ({percent(b.forecastUtilization, { decimals: 0 })})
                  de {money(b.budget.amount, currency)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
