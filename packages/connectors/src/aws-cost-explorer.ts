import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  type GetCostAndUsageCommandInput,
  type GetCostAndUsageCommandOutput,
} from '@aws-sdk/client-cost-explorer';
import { addDays, classifyService, normalizeDate, type CostRecord, type CostSource, type Period } from '@fns/core';

/** Subconjunto do client usado aqui: permite injetar um fake nos testes sem mockar o SDK. */
export interface CostExplorerLike {
  send(command: GetCostAndUsageCommand): Promise<GetCostAndUsageCommandOutput>;
}

export interface AwsCostExplorerOptions {
  /** ID da conta pagadora (usado como BillingAccountId e escopo de substituição na importação). */
  payerAccountId: string;
  client?: CostExplorerLike;
  /** Limite de páginas por sincronização: cada chamada da API Cost Explorer custa US$ 0,01. */
  maxPages?: number;
}

/**
 * Lê custo diário por serviço e conta via AWS Cost Explorer (somente leitura: `ce:GetCostAndUsage`).
 *
 * O Cost Explorer não traz recurso nem tag na mesma consulta, então regras por recurso (gp2, IP ocioso)
 * só funcionam com o CUR/FOCUS. Use esta fonte para começar rápido e o Data Exports para o detalhe.
 * O endpoint é sempre us-east-1, independentemente da região dos recursos.
 */
export class AwsCostExplorerSource implements CostSource {
  readonly name = 'aws-cost-explorer';
  private readonly client: CostExplorerLike;
  private readonly maxPages: number;

  constructor(private readonly options: AwsCostExplorerOptions) {
    if (!/^\d{12}$/.test(options.payerAccountId)) throw new Error('payerAccountId deve ter 12 dígitos');
    this.client = options.client ?? new CostExplorerClient({ region: 'us-east-1' });
    this.maxPages = options.maxPages ?? 20;
  }

  async fetch(period: Period): Promise<CostRecord[]> {
    const records: CostRecord[] = [];
    let nextPageToken: string | undefined;
    let pages = 0;

    do {
      const input: GetCostAndUsageCommandInput = {
        // A API trata End como exclusivo.
        TimePeriod: { Start: period.from, End: addDays(period.to, 1) },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost', 'AmortizedCost'],
        GroupBy: [
          { Type: 'DIMENSION', Key: 'SERVICE' },
          { Type: 'DIMENSION', Key: 'LINKED_ACCOUNT' },
        ],
        ...(nextPageToken ? { NextPageToken: nextPageToken } : {}),
      };
      const output = await this.client.send(new GetCostAndUsageCommand(input));
      records.push(...this.map(output));
      nextPageToken = output.NextPageToken;
      pages++;
    } while (nextPageToken && pages < this.maxPages);

    if (nextPageToken) {
      throw new Error(`Cost Explorer retornou mais de ${this.maxPages} páginas; reduza o período ou aumente maxPages`);
    }
    return records;
  }

  private map(output: GetCostAndUsageCommandOutput): CostRecord[] {
    const records: CostRecord[] = [];
    for (const result of output.ResultsByTime ?? []) {
      const date = normalizeDate(result.TimePeriod?.Start ?? '');
      if (!date) continue;
      for (const group of result.Groups ?? []) {
        const [service, account] = group.Keys ?? [];
        const billed = Number(group.Metrics?.UnblendedCost?.Amount ?? 0);
        const effective = Number(group.Metrics?.AmortizedCost?.Amount ?? billed);
        if (!service || !account || !Number.isFinite(billed) || !Number.isFinite(effective)) continue;
        if (billed === 0 && effective === 0) continue;
        records.push({
          date,
          provider: 'aws',
          billingAccountId: this.options.payerAccountId,
          subAccountId: account,
          serviceName: service,
          serviceCategory: classifyService('aws', service),
          region: 'global',
          resourceId: null,
          usageType: null,
          instanceType: null,
          chargeCategory: 'Usage',
          pricingCategory: 'Other',
          billedCost: billed,
          effectiveCost: effective,
          currency: (group.Metrics?.UnblendedCost?.Unit ?? 'USD').toUpperCase(),
          tags: {},
        });
      }
    }
    return records;
  }
}
