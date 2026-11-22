import { useEffect, useState } from 'react';
import { ApiError, loadDashboard, loadStatus, type DashboardData } from './api';
import { AnomalyTable } from './components/AnomalyTable';
import { BreakdownTable } from './components/BreakdownTable';
import { Budgets } from './components/Budgets';
import { CostChart } from './components/CostChart';
import { KpiCards } from './components/KpiCards';
import { Recommendations } from './components/Recommendations';
import { addDays, longDate } from './format';

const RANGES = [
  { days: 30, label: '30 dias' },
  { days: 60, label: '60 dias' },
  { days: 90, label: '90 dias' },
] as const;

const GROUPS = [
  { value: 'service', label: 'serviço' },
  { value: 'provider', label: 'provedor' },
  { value: 'subAccount', label: 'conta' },
  { value: 'tag:team', label: 'time' },
  { value: 'tag:env', label: 'ambiente' },
  { value: 'region', label: 'região' },
  { value: 'serviceCategory', label: 'categoria' },
] as const;

type State =
  { kind: 'loading' } | { kind: 'empty' } | { kind: 'error'; message: string } | { kind: 'ready'; data: DashboardData };

export function App() {
  const [days, setDays] = useState<number>(30);
  const [groupBy, setGroupBy] = useState<string>('service');
  const [dataTo, setDataTo] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const groupLabel = GROUPS.find((g) => g.value === groupBy)?.label ?? groupBy;

  useEffect(() => {
    const controller = new AbortController();
    loadStatus(controller.signal)
      .then((status) => (status.to ? setDataTo(status.to) : setState({ kind: 'empty' })))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ kind: 'error', message: error instanceof Error ? error.message : 'falha' });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!dataTo) return;
    // Cancela a requisição anterior ao trocar filtro: evita que uma resposta lenta sobrescreva a nova.
    const controller = new AbortController();
    setState((current) => (current.kind === 'ready' ? current : { kind: 'loading' }));
    loadDashboard({ from: addDays(dataTo, -(days - 1)), to: dataTo, groupBy }, controller.signal)
      .then((data) => setState({ kind: 'ready', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.code === 'NO_DATA') setState({ kind: 'empty' });
        else setState({ kind: 'error', message: error instanceof Error ? error.message : 'falha ao carregar' });
      });
    return () => controller.abort();
  }, [dataTo, days, groupBy]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#10b981" />
            <path
              d="M8 21l5-6 4 3 7-9"
              stroke="#fff"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <h1>FinOps Sentinel</h1>
            <p>AWS + Azure · modelo FOCUS 1.0{dataTo && ` · dados até ${longDate(dataTo)}`}</p>
          </div>
        </div>
        <div className="filters" role="group" aria-label="Filtros">
          <div className="segmented" role="radiogroup" aria-label="Período">
            {RANGES.map((range) => (
              <button
                key={range.days}
                type="button"
                role="radio"
                aria-checked={days === range.days}
                className={days === range.days ? 'active' : ''}
                onClick={() => setDays(range.days)}
              >
                {range.label}
              </button>
            ))}
          </div>
          <label className="select">
            <span>Agrupar por</span>
            <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
              {GROUPS.map((group) => (
                <option key={group.value} value={group.value}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <main>
        {state.kind === 'loading' && <p className="status">Carregando…</p>}
        {state.kind === 'empty' && (
          <div className="status">
            <h2>Nenhum dado de custo ainda</h2>
            <p>
              Envie um export FOCUS, CUR ou Azure Cost Details para <code>POST /api/v1/imports</code> ou suba a API com{' '}
              <code>SOURCES=demo</code>.
            </p>
          </div>
        )}
        {state.kind === 'error' && (
          <div className="status status-error" role="alert">
            <h2>Não foi possível carregar o painel</h2>
            <p>{state.message}</p>
          </div>
        )}
        {state.kind === 'ready' && (
          <>
            <KpiCards overview={state.data.overview} />
            <CostChart data={state.data.timeseries} groupLabel={groupLabel} />
            <div className="grid-2">
              <BreakdownTable summary={state.data.summary} groupLabel={groupLabel} />
              <Budgets forecast={state.data.forecast} />
            </div>
            <AnomalyTable anomalies={state.data.anomalies} />
            <Recommendations data={state.data.recommendations} />
          </>
        )}
      </main>

      <footer className="footer">
        Custos em valor efetivo (amortizado). Estimativas de economia são conservadoras e devem ser validadas antes da
        mudança.
      </footer>
    </div>
  );
}
