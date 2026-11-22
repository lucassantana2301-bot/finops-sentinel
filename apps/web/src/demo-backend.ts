/**
 * Backend de demonstração que roda 100% no navegador.
 *
 * Usado no build estático publicado no GitHub Pages (VITE_DEMO_MODE=true): instancia o mesmo
 * SentinelService da API com o dataset sintético, então a demo exercita exatamente o domínio
 * que vai para produção, sem servidor e sem credenciais de nuvem.
 */
import {
  generateDemoDataset,
  InMemoryAlertStateStore,
  InMemoryCostRepository,
  parseDimension,
  SentinelService,
  type Budget,
} from '@fns/core';
import type { DashboardData, DashboardQuery } from './api';

/** Mesmos orçamentos do .env.example, para a demo bater com a documentação. */
export const DEMO_BUDGETS: Budget[] = [
  { id: 'total', name: 'Conta inteira', amount: 4600 },
  { id: 'pagamentos', name: 'Time pagamentos', amount: 2600, scope: { dimension: 'tag:team', key: 'pagamentos' } },
];

let servicePromise: Promise<SentinelService> | null = null;

async function createService(): Promise<SentinelService> {
  const service = new SentinelService({
    repository: new InMemoryCostRepository(),
    alertState: new InMemoryAlertStateStore(),
    config: { budgets: DEMO_BUDGETS, recommendations: { requiredTags: ['team', 'env'] } },
  });
  await service.importRecords(generateDemoDataset(), 'demo');
  return service;
}

/** Singleton preguiçoso; se a criação falhar, a próxima chamada tenta de novo em vez de cachear o erro. */
function getService(): Promise<SentinelService> {
  servicePromise ??= createService().catch((error: unknown) => {
    servicePromise = null;
    throw error;
  });
  return servicePromise;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('requisição cancelada', 'AbortError');
}

export async function loadDemoStatus(
  signal: AbortSignal,
): Promise<{ from: string | null; to: string | null; records: number }> {
  const service = await getService();
  throwIfAborted(signal);
  const { from, to, records } = await service.status();
  return { from, to, records };
}

export async function loadDemoDashboard(query: DashboardQuery, signal: AbortSignal): Promise<DashboardData> {
  const service = await getService();
  throwIfAborted(signal);
  const dimension = parseDimension(query.groupBy);
  const period = { from: query.from, to: query.to };
  const [overview, summary, timeseries, anomalies, forecast, recommendations] = await Promise.all([
    service.overview(),
    service.summary({ ...period, dimension, limit: 8 }),
    service.timeseries({ ...period, dimension, top: 6 }),
    service.anomalies(period),
    service.forecast(),
    service.recommendations(),
  ]);
  throwIfAborted(signal);
  return { overview, summary, timeseries, anomalies, forecast, recommendations };
}
