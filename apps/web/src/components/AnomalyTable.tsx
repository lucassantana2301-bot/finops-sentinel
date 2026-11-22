import type { Anomalies } from '../api';
import { longDate, money, percent, shortName } from '../format';

const SEVERITY = {
  low: { label: 'Baixa', icon: 'ℹ' },
  medium: { label: 'Média', icon: '!' },
  high: { label: 'Alta', icon: '▲' },
  critical: { label: 'Crítica', icon: '✖' },
} as const;

export function SeverityBadge({ severity }: { severity: keyof typeof SEVERITY }) {
  const { label, icon } = SEVERITY[severity];
  // Severidade nunca só pela cor: ícone + texto.
  return (
    <span className={`badge severity-${severity}`}>
      <span aria-hidden="true">{icon}</span> {label}
    </span>
  );
}

export function AnomalyTable({ anomalies }: { anomalies: Anomalies }) {
  const { items, currency } = anomalies;
  return (
    <section className="panel" aria-labelledby="anomalies-title">
      <header className="panel-header">
        <h2 id="anomalies-title">Anomalias de custo</h2>
        <span className="panel-meta">mediana móvel de 28 dias com sazonalidade semanal · escore z robusto</span>
      </header>
      {items.length === 0 ? (
        <p className="empty">Nenhuma anomalia no período.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Item</th>
              <th scope="col">Severidade</th>
              <th scope="col" className="num">
                Real
              </th>
              <th scope="col" className="num">
                Esperado
              </th>
              <th scope="col" className="num">
                Impacto
              </th>
              <th scope="col">Principal causa</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td>{longDate(a.date)}</td>
                <td title={a.key}>
                  {shortName(a.key)}
                  {a.kind === 'new_spend' && <span className="tag">gasto novo</span>}
                </td>
                <td>
                  <SeverityBadge severity={a.severity} />
                </td>
                <td className="num">{money(a.actual, currency)}</td>
                <td className="num">{money(a.expected, currency)}</td>
                <td className="num">
                  +{money(a.impact, currency)}
                  {a.relativeChange !== null && (
                    <small> ({percent(a.relativeChange, { signed: true, decimals: 0 })})</small>
                  )}
                </td>
                <td title={a.drivers[0]?.key}>{a.drivers[0] ? shortName(a.drivers[0].key) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
