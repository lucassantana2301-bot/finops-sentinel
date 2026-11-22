import type { ReactNode } from 'react';
import type { Recommendations as RecommendationsData } from '../api';
import { money } from '../format';

const CATEGORY: Record<string, string> = {
  waste: 'Desperdício',
  modernization: 'Modernização',
  commitment: 'Compromisso',
  scheduling: 'Agendamento',
  architecture: 'Arquitetura',
  governance: 'Governança',
};
const CONFIDENCE = { low: 'baixa', medium: 'média', high: 'alta' } as const;
const EFFORT = { low: 'baixo', medium: 'médio', high: 'alto' } as const;
const PROVIDER: Record<string, string> = {
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'GCP',
  multi: 'Multicloud',
  other: 'Outro',
};

/** Renderiza `código` inline sem dangerouslySetInnerHTML (o texto vem da API). */
function withCode(text: string): ReactNode[] {
  return text
    .split(/(`[^`]+`)/g)
    .map((part, i) =>
      part.startsWith('`') && part.endsWith('`') ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
}

export function Recommendations({ data }: { data: RecommendationsData }) {
  return (
    <section className="panel" aria-labelledby="recs-title">
      <header className="panel-header">
        <h2 id="recs-title">Recomendações de economia</h2>
        <span className="panel-meta">
          {money(data.totalMonthlySavings, data.currency)}/mês somando as estimativas (podem se sobrepor)
        </span>
      </header>
      {data.items.length === 0 ? (
        <p className="empty">Nenhuma recomendação para o período.</p>
      ) : (
        <ol className="recs">
          {data.items.map((r) => (
            <li key={r.id} className="rec">
              <div className="rec-head">
                <span className={`tag category-${r.category}`}>{CATEGORY[r.category] ?? r.category}</span>
                <span className="tag">{PROVIDER[r.provider] ?? r.provider}</span>
                <h3>{r.title}</h3>
                {r.estimatedMonthlySavings > 0 && (
                  <span className="rec-savings">
                    {money(r.estimatedMonthlySavings, data.currency)}
                    <small>/mês</small>
                  </span>
                )}
              </div>
              <p>{withCode(r.description)}</p>
              <p className="rec-action">
                <strong>Ação:</strong> {withCode(r.action)}
              </p>
              <p className="rec-meta">
                confiança {CONFIDENCE[r.confidence]} · esforço {EFFORT[r.effort]}
                {r.resources.length > 0 && ` · ${r.resources.length} recurso(s)`}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
