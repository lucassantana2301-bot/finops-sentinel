import { createHmac } from 'node:crypto';
import type { GetCostAndUsageCommand, GetCostAndUsageCommandOutput } from '@aws-sdk/client-cost-explorer';
import type { AlertEvent } from '@fns/core';
import { describe, expect, it, vi } from 'vitest';
import {
  AwsCostExplorerSource,
  AzureCostManagementSource,
  fetchWithRetry,
  HttpError,
  SlackNotifier,
  WebhookNotifier,
  type FetchLike,
} from '../src/index.js';

const noSleep = { sleep: async () => undefined };
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

describe('fetchWithRetry', () => {
  it('repete 429 respeitando Retry-After e para no sucesso', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '7' } }))
      .mockResolvedValueOnce(json({ ok: true }));
    const response = await fetchWithRetry('https://x.test', {}, { fetchImpl, sleep });
    expect(response.status).toBe(200);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('não repete erro de autenticação', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(new Response('nope', { status: 401 }));
    await expect(fetchWithRetry('https://x.test', {}, { fetchImpl, ...noSleep })).rejects.toBeInstanceOf(HttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('desiste depois do número máximo de tentativas em erro de rede', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(fetchWithRetry('https://x.test', {}, { fetchImpl, retries: 2, ...noSleep })).rejects.toThrow(
      'fetch failed',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('AwsCostExplorerSource', () => {
  it('pagina, trata End como exclusivo e mapeia faturado x amortizado', async () => {
    const pages: GetCostAndUsageCommandOutput[] = [
      {
        $metadata: {},
        NextPageToken: 'p2',
        ResultsByTime: [
          {
            TimePeriod: { Start: '2026-11-01', End: '2026-11-02' },
            Groups: [
              {
                Keys: ['Amazon Elastic Compute Cloud - Compute', '100000000001'],
                Metrics: {
                  UnblendedCost: { Amount: '10', Unit: 'USD' },
                  AmortizedCost: { Amount: '7.5', Unit: 'USD' },
                },
              },
            ],
          },
        ],
      },
      {
        $metadata: {},
        ResultsByTime: [
          {
            TimePeriod: { Start: '2026-11-02', End: '2026-11-03' },
            Groups: [
              {
                Keys: ['Amazon Simple Storage Service', '100000000001'],
                Metrics: { UnblendedCost: { Amount: '0', Unit: 'USD' }, AmortizedCost: { Amount: '0', Unit: 'USD' } },
              },
            ],
          },
        ],
      },
    ];
    const inputs: unknown[] = [];
    const client = {
      send: vi.fn(async (command: GetCostAndUsageCommand) => {
        inputs.push(command.input);
        return pages.shift()!;
      }),
    };
    const source = new AwsCostExplorerSource({ payerAccountId: '900000000001', client });
    const records = await source.fetch({ from: '2026-11-01', to: '2026-11-02' });

    expect(inputs[0]).toMatchObject({ TimePeriod: { Start: '2026-11-01', End: '2026-11-03' }, Granularity: 'DAILY' });
    expect(inputs[1]).toMatchObject({ NextPageToken: 'p2' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      billedCost: 10,
      effectiveCost: 7.5,
      serviceCategory: 'Compute',
      subAccountId: '100000000001',
    });
  });

  it('valida a conta pagadora', () => {
    expect(() => new AwsCostExplorerSource({ payerAccountId: '123', client: { send: vi.fn() } })).toThrow(/12 dígitos/);
  });
});

describe('AzureCostManagementSource', () => {
  const scope = '/subscriptions/a1b2c3d4-0000-4000-8000-000000000001';
  const tokenProvider = { getToken: async () => 'token' };
  const columns = [
    { name: 'Cost' },
    { name: 'UsageDate' },
    { name: 'ServiceName' },
    { name: 'SubscriptionId' },
    { name: 'Currency' },
  ];

  it('junta ActualCost e AmortizedCost e segue nextLink do ARM', async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
      const body = String(init?.body);
      bodies.push(body);
      const amortized = body.includes('AmortizedCost');
      if (url.includes('skiptoken')) {
        return json({
          properties: {
            columns,
            rows: [[3, 20261102, 'Storage', 'A1B2C3D4-0000-4000-8000-000000000001', 'USD']],
            nextLink: null,
          },
        });
      }
      return json({
        properties: {
          columns,
          rows: [[amortized ? 6 : 10, 20261101, 'Virtual Machines', 'A1B2C3D4-0000-4000-8000-000000000001', 'USD']],
          nextLink: amortized
            ? null
            : `https://management.azure.com${scope}/providers/Microsoft.CostManagement/query?skiptoken=abc`,
        },
      });
    });
    const source = new AzureCostManagementSource({ scope, tokenProvider, http: { fetchImpl, ...noSleep } });
    const records = await source.fetch({ from: '2026-11-01', to: '2026-11-02' });

    const vm = records.find((r) => r.serviceName === 'Virtual Machines')!;
    expect(vm).toMatchObject({ billedCost: 10, effectiveCost: 6, date: '2026-11-01', serviceCategory: 'Compute' });
    expect(vm.subAccountId).toBe('a1b2c3d4-0000-4000-8000-000000000001');
    expect(records.find((r) => r.serviceName === 'Storage')).toMatchObject({ billedCost: 3, effectiveCost: 0 });
    expect(fetchImpl.mock.calls[0]![1]!.headers).toMatchObject({ authorization: 'Bearer token' });
  });

  it('não segue nextLink para outro host (o token iria junto)', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      json({ properties: { columns, rows: [], nextLink: 'https://evil.example/collect' } }),
    );
    const source = new AzureCostManagementSource({ scope, tokenProvider, http: { fetchImpl, ...noSleep } });
    await expect(source.fetch({ from: '2026-11-01', to: '2026-11-02' })).rejects.toThrow(/host inesperado/);
  });

  it('rejeita escopo que permitiria path traversal no ARM', () => {
    expect(() => new AzureCostManagementSource({ scope: '/subscriptions/../../providers/x', tokenProvider })).toThrow(
      /inválido/,
    );
  });
});

describe('notificadores', () => {
  const event: AlertEvent = {
    kind: 'anomaly',
    dedupKey: 'anomaly:x',
    severity: 'high',
    anomaly: {
      id: 'x',
      kind: 'spike',
      date: '2026-11-12',
      dimension: 'service',
      key: 'Amazon EC2',
      actual: 100,
      expected: 50,
      impact: 50,
      relativeChange: 1,
      score: 12,
      severity: 'high',
      drivers: [],
    },
  };

  it('Slack só aceita hooks.slack.com via HTTPS', () => {
    expect(() => new SlackNotifier('http://hooks.slack.com/services/x')).toThrow(/HTTPS/);
    expect(() => new SlackNotifier('https://evil.example/services/x')).toThrow(/hooks.slack.com/);
  });

  it('Slack monta blocos com o texto do alerta', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response('ok'));
    await new SlackNotifier('https://hooks.slack.com/services/T/B/X', { fetchImpl }).send([event], { currency: 'USD' });
    const payload = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)) as { blocks: { text?: { text: string } }[] };
    expect(payload.blocks[1]!.text!.text).toContain('Pico de custo em Amazon EC2');
  });

  it('webhook assina o corpo com HMAC-SHA256', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response('ok'));
    const secret = 'segredo-de-teste-123';
    await new WebhookNotifier('https://hooks.example/finops', { secret, http: { fetchImpl } }).send([event], {
      currency: 'USD',
    });
    const init = fetchImpl.mock.calls[0]![1]!;
    const expected = createHmac('sha256', secret).update(String(init.body)).digest('hex');
    expect((init.headers as Record<string, string>)['x-finops-signature']).toBe(`sha256=${expected}`);
  });

  it('erro do canal não vaza a URL secreta', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response('no', { status: 404 }));
    const notifier = new SlackNotifier('https://hooks.slack.com/services/T/B/SECRET', { fetchImpl });
    await expect(notifier.send([event], { currency: 'USD' })).rejects.toThrow(
      /^Slack recusou a mensagem \(HTTP 404\)$/,
    );
  });
});
