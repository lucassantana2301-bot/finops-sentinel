import { generateDemoDataset, toFocusCsv } from '@fns/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createContainer } from '../src/container.js';
import { apiKeyMatches, buildApp } from '../src/http/app.js';

const API_KEY = 'test-key-0123456789abcdef0123456789';
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

async function makeApp(env: Record<string, string> = {}): Promise<FastifyInstance> {
  const config = loadConfig({ NODE_ENV: 'test', SOURCES: '', API_KEY, LOG_LEVEL: 'silent', ...env });
  const container = await createContainer(config, silent);
  await container.bootstrap();
  return buildApp({ container });
}

const csv = toFocusCsv(generateDemoDataset({ endDate: '2026-11-20', days: 60 }));
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function withData(): Promise<FastifyInstance> {
  app = await makeApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/imports',
    headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'text/csv' },
    payload: csv,
  });
  expect(response.statusCode).toBe(201);
  return app;
}

describe('API HTTP', () => {
  it('health responde mesmo sem dados', async () => {
    app = await makeApp();
    expect((await app.inject('/health/live')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/health/ready')).json()).toMatchObject({ records: 0 });
  });

  it('sem dados as consultas retornam 404 NO_DATA', async () => {
    app = await makeApp();
    const response = await app.inject('/api/v1/summary');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'NO_DATA' });
  });

  it('importação exige API key válida', async () => {
    app = await makeApp();
    const base = {
      method: 'POST' as const,
      url: '/api/v1/imports',
      headers: { 'content-type': 'text/csv' },
      payload: csv,
    };
    expect((await app.inject(base)).statusCode).toBe(401);
    expect((await app.inject({ ...base, headers: { ...base.headers, 'x-api-key': 'errada' } })).statusCode).toBe(401);
  });

  it('sem API_KEY configurada a escrita fica desligada, nunca aberta', async () => {
    const config = loadConfig({ NODE_ENV: 'test', SOURCES: '', LOG_LEVEL: 'silent' });
    const container = await createContainer(config, silent);
    app = await buildApp({ container });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { 'content-type': 'text/csv' },
      payload: csv,
    });
    expect(response.statusCode).toBe(503);
  });

  it('importa, consulta e reimporta de forma idempotente', async () => {
    app = await withData();
    const summary = (await app.inject('/api/v1/summary?groupBy=tag:Team&limit=3')).json();
    expect(summary).toMatchObject({ dimension: 'tag:team', currency: 'USD', period: { to: '2026-11-20' } });
    expect(summary.items).toHaveLength(3);

    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { 'x-api-key': API_KEY, 'content-type': 'text/csv' },
      payload: csv,
    });
    expect(again.json()).toMatchObject({ format: 'focus', removed: again.json().inserted });
    expect((await app.inject('/api/v1/summary?groupBy=tag:Team&limit=3')).json().total).toBe(summary.total);
  });

  it('expõe série, anomalias, previsão, recomendações e visão geral', async () => {
    app = await withData();
    const series = (await app.inject('/api/v1/timeseries?groupBy=provider&from=2026-11-01&to=2026-11-20')).json();
    expect(series.points).toHaveLength(20);
    expect(series.keys).toEqual(expect.arrayContaining(['aws', 'azure']));

    const anomalies = (await app.inject('/api/v1/anomalies?minSeverity=medium')).json();
    expect(anomalies.items.map((a: { key: string }) => a.key)).toEqual(
      expect.arrayContaining(['Amazon EC2', 'Azure OpenAI']),
    );

    expect((await app.inject('/api/v1/forecast?month=2026-11')).json().forecast).toMatchObject({
      month: '2026-11',
      asOf: '2026-11-20',
    });
    expect((await app.inject('/api/v1/recommendations')).json().items.length).toBeGreaterThan(5);
    expect((await app.inject('/api/v1/overview')).json()).toMatchObject({ dataTo: '2026-11-20' });
  });

  it('valida parâmetros com 400 e mensagem clara', async () => {
    app = await withData();
    const badDate = await app.inject('/api/v1/summary?from=2026-02-30');
    expect(badDate.statusCode).toBe(400);
    expect(badDate.json().issues[0].path).toBe('from');
    expect((await app.inject('/api/v1/summary?groupBy=nada')).json()).toMatchObject({ error: 'INVALID_DIMENSION' });
    expect((await app.inject('/api/v1/summary?groupBy=nada')).statusCode).toBe(400);
    expect((await app.inject('/api/v1/summary?from=2026-11-10&to=2026-11-01')).statusCode).toBe(400);
    expect((await app.inject('/api/v1/forecast?month=2026-13')).statusCode).toBe(400);
  });

  it('rejeita CSV irreconhecível com 422 e corpo vazio com 415', async () => {
    app = await makeApp();
    const headers = { authorization: `Bearer ${API_KEY}`, 'content-type': 'text/csv' };
    const unknown = await app.inject({ method: 'POST', url: '/api/v1/imports', headers, payload: 'a,b\n1,2\n' });
    expect(unknown.statusCode).toBe(422);
    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
      payload: {},
    });
    expect(empty.statusCode).toBe(415);
  });

  it('executa alertas em dry run sem notificar', async () => {
    app = await withData();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/alerts/run?dryRun=true&minSeverity=low',
      headers: { 'x-api-key': API_KEY },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ sent: 0 });
  });

  it('rota inexistente responde 404 em JSON', async () => {
    app = await makeApp();
    expect((await app.inject('/api/v1/nada')).json()).toMatchObject({ error: 'NOT_FOUND' });
  });
});

describe('configuração', () => {
  it('exige API_KEY em produção e credenciais das fontes', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/API_KEY: obrigatória em produção/);
    expect(() => loadConfig({ SOURCES: 'aws' })).toThrow(/AWS_PAYER_ACCOUNT_ID/);
    expect(() => loadConfig({ SOURCES: 'gcp' })).toThrow(/SOURCES aceita/);
    expect(() => loadConfig({ BUDGETS: '{oops' })).toThrow(/BUDGETS não é JSON/);
    expect(() => loadConfig({ BUDGETS: '[{"id":"x","name":"X","amount":-1}]' })).toThrow(/BUDGETS/);
  });

  it('lê orçamentos com escopo', () => {
    const config = loadConfig({
      BUDGETS: '[{"id":"pag","name":"Pagamentos","amount":2600,"scope":{"dimension":"tag:team","key":"pagamentos"}}]',
    });
    expect(config.BUDGETS[0]).toMatchObject({ id: 'pag', scope: { dimension: 'tag:team' } });
  });

  it('compara API key em tempo constante, inclusive com tamanhos diferentes', () => {
    expect(apiKeyMatches(API_KEY, API_KEY)).toBe(true);
    expect(apiKeyMatches('curta', API_KEY)).toBe(false);
    expect(apiKeyMatches(undefined, API_KEY)).toBe(false);
  });
});
