import { classifyService, normalizeDate, type CostRecord, type CostSource, type Period } from '@fns/core';
import { fetchWithRetry, type RetryOptions } from './http.js';

export interface TokenProvider {
  getToken(): Promise<string>;
}

export interface AzureCostManagementOptions {
  /**
   * Escopo da consulta: `/subscriptions/<id>`, `/providers/Microsoft.Billing/billingAccounts/<id>`
   * ou `/providers/Microsoft.Management/managementGroups/<id>`.
   */
  scope: string;
  tokenProvider: TokenProvider;
  http?: RetryOptions;
  maxPages?: number;
}

const ARM_ORIGIN = 'https://management.azure.com';
const API_VERSION = '2023-11-01';
const SCOPE_PATTERN =
  /^\/(subscriptions\/[0-9a-f-]{36}|providers\/Microsoft\.Billing\/billingAccounts\/[A-Za-z0-9:_-]+|providers\/Microsoft\.Management\/managementGroups\/[A-Za-z0-9._-]+)$/i;

interface QueryResponse {
  properties?: { columns?: { name: string }[]; rows?: unknown[][]; nextLink?: string | null };
}

type CostType = 'ActualCost' | 'AmortizedCost';

/**
 * Token do Microsoft Entra ID via @azure/identity (Service Principal, Managed Identity, az login).
 * A identidade precisa só do papel "Cost Management Reader" no escopo.
 */
export async function azureIdentityTokenProvider(): Promise<TokenProvider> {
  const { DefaultAzureCredential } = await import('@azure/identity');
  const credential = new DefaultAzureCredential();
  return {
    async getToken() {
      const token = await credential.getToken(`${ARM_ORIGIN}/.default`);
      if (!token) throw new Error('não foi possível obter token do Azure');
      return token.token;
    },
  };
}

/**
 * Custo diário por serviço e assinatura via API Query do Azure Cost Management.
 * Faz duas consultas (ActualCost e AmortizedCost) e junta, para ter faturado e efetivo como no FOCUS.
 */
export class AzureCostManagementSource implements CostSource {
  readonly name = 'azure-cost-management';
  private readonly maxPages: number;

  constructor(private readonly options: AzureCostManagementOptions) {
    // O escopo vira caminho de URL autenticada: validar evita path traversal para outros endpoints do ARM.
    if (!SCOPE_PATTERN.test(options.scope)) throw new Error(`escopo do Azure inválido: ${options.scope}`);
    this.maxPages = options.maxPages ?? 50;
  }

  async fetch(period: Period): Promise<CostRecord[]> {
    const [actual, amortized] = await Promise.all([
      this.query('ActualCost', period),
      this.query('AmortizedCost', period),
    ]);
    const merged = new Map<string, CostRecord>();
    const keyOf = (r: CostRecord) => `${r.date}|${r.subAccountId}|${r.serviceName}`;

    for (const record of actual) merged.set(keyOf(record), { ...record, effectiveCost: 0 });
    for (const record of amortized) {
      const existing = merged.get(keyOf(record));
      if (existing) existing.effectiveCost += record.billedCost;
      else merged.set(keyOf(record), { ...record, billedCost: 0, effectiveCost: record.billedCost });
    }
    return [...merged.values()].filter((r) => r.billedCost !== 0 || r.effectiveCost !== 0);
  }

  private async query(type: CostType, period: Period): Promise<CostRecord[]> {
    const body = JSON.stringify({
      type,
      timeframe: 'Custom',
      timePeriod: { from: `${period.from}T00:00:00Z`, to: `${period.to}T23:59:59Z` },
      dataset: {
        granularity: 'Daily',
        aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
        grouping: [
          { type: 'Dimension', name: 'ServiceName' },
          { type: 'Dimension', name: 'SubscriptionId' },
        ],
      },
    });

    const records: CostRecord[] = [];
    let url: string | null =
      `${ARM_ORIGIN}${this.options.scope}/providers/Microsoft.CostManagement/query?api-version=${API_VERSION}`;
    let pages = 0;

    while (url && pages < this.maxPages) {
      const token = await this.options.tokenProvider.getToken();
      const response = await fetchWithRetry(
        url,
        { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body },
        this.options.http,
      );
      const payload = (await response.json()) as QueryResponse;
      records.push(...this.map(payload));
      url = this.safeNextLink(payload.properties?.nextLink ?? null);
      pages++;
    }
    if (url) throw new Error(`Cost Management retornou mais de ${this.maxPages} páginas`);
    return records;
  }

  /** nextLink vem da resposta; só é seguido se apontar para o próprio ARM (o token vai junto). */
  private safeNextLink(link: string | null): string | null {
    if (!link) return null;
    const parsed = new URL(link);
    if (parsed.origin !== ARM_ORIGIN) throw new Error(`nextLink para host inesperado: ${parsed.host}`);
    return parsed.toString();
  }

  private map(payload: QueryResponse): CostRecord[] {
    const columns = (payload.properties?.columns ?? []).map((c) => c.name.toLowerCase());
    const at = (name: string) => columns.indexOf(name);
    const costIndex = at('cost') >= 0 ? at('cost') : at('pretaxcost');
    const dateIndex = at('usagedate');
    const serviceIndex = at('servicename');
    const subscriptionIndex = at('subscriptionid');
    const currencyIndex = at('currency');
    if ([costIndex, dateIndex, serviceIndex, subscriptionIndex].some((i) => i < 0)) {
      throw new Error(`resposta do Cost Management sem as colunas esperadas: ${columns.join(', ')}`);
    }

    const records: CostRecord[] = [];
    for (const row of payload.properties?.rows ?? []) {
      const cost = Number(row[costIndex]);
      const date = normalizeDate(String(row[dateIndex] ?? ''));
      const service = String(row[serviceIndex] ?? '');
      const subscription = String(row[subscriptionIndex] ?? '').toLowerCase();
      if (!date || !service || !subscription || !Number.isFinite(cost) || cost === 0) continue;
      records.push({
        date,
        provider: 'azure',
        billingAccountId: this.options.scope,
        subAccountId: subscription,
        serviceName: service,
        serviceCategory: classifyService('azure', service),
        region: 'global',
        resourceId: null,
        usageType: null,
        instanceType: null,
        chargeCategory: 'Usage',
        pricingCategory: 'Other',
        billedCost: cost,
        effectiveCost: cost,
        currency: currencyIndex >= 0 ? String(row[currencyIndex] ?? 'USD').toUpperCase() : 'USD',
        tags: {},
      });
    }
    return records;
  }
}
