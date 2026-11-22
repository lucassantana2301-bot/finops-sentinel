import type { SentinelService } from '@fns/core';

/** Tipos das respostas derivados direto do serviço: front e API não divergem sem o compilador avisar. */
export type Overview = Awaited<ReturnType<SentinelService['overview']>>;
export type Summary = Awaited<ReturnType<SentinelService['summary']>>;
export type Timeseries = Awaited<ReturnType<SentinelService['timeseries']>>;
export type Anomalies = Awaited<ReturnType<SentinelService['anomalies']>>;
export type Forecast = Awaited<ReturnType<SentinelService['forecast']>>;
export type Recommendations = Awaited<ReturnType<SentinelService['recommendations']>>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

const BASE = '/api/v1';

/**
 * Build estático da demo (GitHub Pages): o domínio roda no navegador em vez de chamar a API.
 * A checagem é resolvida em build, então o import dinâmico some do bundle de produção.
 */
export const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

async function get<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  signal: AbortSignal,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  const url = `${BASE}${path}${query.size > 0 ? `?${query}` : ''}`;
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new ApiError(body.message ?? `HTTP ${response.status}`, response.status, body.error ?? 'HTTP_ERROR');
  }
  return (await response.json()) as T;
}

export interface DashboardQuery {
  from: string;
  to: string;
  groupBy: string;
}

export interface DashboardData {
  overview: Overview;
  summary: Summary;
  timeseries: Timeseries;
  anomalies: Anomalies;
  forecast: Forecast;
  recommendations: Recommendations;
}

export async function loadDashboard(query: DashboardQuery, signal: AbortSignal): Promise<DashboardData> {
  if (IS_DEMO) return (await import('./demo-backend')).loadDemoDashboard(query, signal);
  const period = { from: query.from, to: query.to };
  const [overview, summary, timeseries, anomalies, forecast, recommendations] = await Promise.all([
    get<Overview>('/overview', {}, signal),
    get<Summary>('/summary', { ...period, groupBy: query.groupBy, limit: 8 }, signal),
    get<Timeseries>('/timeseries', { ...period, groupBy: query.groupBy, top: 6 }, signal),
    get<Anomalies>('/anomalies', period, signal),
    get<Forecast>('/forecast', {}, signal),
    get<Recommendations>('/recommendations', {}, signal),
  ]);
  return { overview, summary, timeseries, anomalies, forecast, recommendations };
}

export async function loadStatus(
  signal: AbortSignal,
): Promise<{ from: string | null; to: string | null; records: number }> {
  if (IS_DEMO) return (await import('./demo-backend')).loadDemoStatus(signal);
  return get('/status', {}, signal);
}
