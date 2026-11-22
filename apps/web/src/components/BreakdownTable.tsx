import type { Summary } from '../api';
import { money, percent, shortName } from '../format';

interface Props {
  summary: Summary;
  groupLabel: string;
}

export function BreakdownTable({ summary, groupLabel }: Props) {
  const max = summary.items[0]?.cost ?? 0;
  return (
    <section className="panel" aria-labelledby="breakdown-title">
      <header className="panel-header">
        <h2 id="breakdown-title">Maiores custos por {groupLabel}</h2>
        <span className="panel-meta">{money(summary.total, summary.currency)} no período</span>
      </header>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{groupLabel}</th>
            <th scope="col" className="num">
              Custo
            </th>
            <th scope="col" className="num">
              Participação
            </th>
          </tr>
        </thead>
        <tbody>
          {summary.items.map((item) => (
            <tr key={item.key}>
              <td title={item.key}>
                <span className="truncate">{shortName(item.key)}</span>
                <span className="bar" aria-hidden="true">
                  <span style={{ width: `${max === 0 ? 0 : (item.cost / max) * 100}%` }} />
                </span>
              </td>
              <td className="num">{money(item.cost, summary.currency)}</td>
              <td className="num">{percent(item.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
