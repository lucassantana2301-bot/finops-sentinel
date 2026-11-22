import { describe, expect, it } from 'vitest';
import { DEMO_BUDGETS, loadDemoDashboard, loadDemoStatus } from './demo-backend';
import { addDays } from './format';

describe('backend da demo (navegador)', () => {
  it('carrega o dataset sintético e expõe o período disponível', async () => {
    const status = await loadDemoStatus(new AbortController().signal);
    expect(status.records).toBeGreaterThan(0);
    expect(status.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(status.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('monta o painel com os mesmos blocos da API', async () => {
    const { to } = await loadDemoStatus(new AbortController().signal);
    const data = await loadDemoDashboard(
      { from: addDays(to!, -29), to: to!, groupBy: 'tag:team' },
      new AbortController().signal,
    );
    expect(data.summary.dimension).toBe('tag:team');
    expect(data.timeseries.points).toHaveLength(30);
    expect(data.anomalies.items.length).toBeGreaterThan(0);
    expect(data.recommendations.items.length).toBeGreaterThan(0);
    expect(data.forecast.budgets.map((b) => b.budget.id)).toEqual(DEMO_BUDGETS.map((b) => b.id));
  });

  it('respeita o cancelamento da requisição', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadDemoStatus(controller.signal)).rejects.toThrow(/cancelada/);
  });
});
