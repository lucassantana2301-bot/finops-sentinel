import { dailyMatrix, breakdown } from './aggregation.js';
import type { CostRecord, Provider } from './cost-record.js';
import { isWeekend, periodLength, type Period } from './dates.js';
import { formatMoney, formatPercent, percentile, round, sum } from './money.js';
import type { Confidence } from './forecast.js';

export type RecommendationCategory =
  'waste' | 'modernization' | 'commitment' | 'scheduling' | 'architecture' | 'governance';

export type Effort = 'low' | 'medium' | 'high';

export interface Recommendation {
  id: string;
  ruleId: string;
  category: RecommendationCategory;
  provider: Provider | 'multi';
  title: string;
  description: string;
  /** Próximo passo concreto. */
  action: string;
  /** Economia mensal estimada (0 para recomendações de governança). */
  estimatedMonthlySavings: number;
  /** Custo mensal atual do que é afetado. */
  monthlyCost: number;
  confidence: Confidence;
  effort: Effort;
  resources: string[];
  evidence: Record<string, string | number>;
}

export interface RecommendationConfig {
  /** Tags obrigatórias para alocação de custo (showback). */
  requiredTags: string[];
  /** Participação de custo sem tag a partir da qual gera recomendação. */
  untaggedShareThreshold: number;
  /** Desconto típico de compromisso de 1 ano sem upfront, por provedor. Ajuste ao seu contrato. */
  commitmentDiscountRate: Partial<Record<Provider, number>>;
  /** Compromisso mensal mínimo para valer a recomendação. */
  minMonthlyCommitment: number;
  nonProdTagKey: string;
  nonProdTagValues: string[];
  /** Recomendações abaixo deste valor são descartadas (exceto governança). */
  minMonthlySavings: number;
  /** Mínimo de dias de dados para regras baseadas em série temporal. */
  minHistoryDays: number;
}

export const DEFAULT_RECOMMENDATION_CONFIG: RecommendationConfig = {
  requiredTags: ['team', 'env'],
  untaggedShareThreshold: 0.1,
  commitmentDiscountRate: { aws: 0.27, azure: 0.3, gcp: 0.25 },
  minMonthlyCommitment: 100,
  nonProdTagKey: 'env',
  nonProdTagValues: ['dev', 'development', 'staging', 'stage', 'test', 'qa', 'hml', 'homolog', 'sandbox'],
  minMonthlySavings: 1,
  minHistoryDays: 14,
};

export interface RuleContext {
  records: readonly CostRecord[];
  period: Period;
  config: RecommendationConfig;
  /** Converte custo do período em custo mensal (30 dias). */
  monthly: (cost: number) => number;
  /** Formata valor na moeda do billing, para os textos. */
  money: (value: number) => string;
}

export interface RecommendationRule {
  id: string;
  evaluate(context: RuleContext): Recommendation[];
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

const cost = (records: readonly CostRecord[]): number => sum(records.map((r) => r.effectiveCost));
const usageOnly = (records: readonly CostRecord[]): CostRecord[] => records.filter((r) => r.chargeCategory === 'Usage');

/** IPs públicos sem associação: custo puro, sem nenhum uso. */
export const idlePublicIpRule: RecommendationRule = {
  id: 'idle-public-ip',
  evaluate({ records, monthly }) {
    const idle = records.filter(
      (r) => r.provider === 'aws' && /(ElasticIP|PublicIPv4):IdleAddress/i.test(r.usageType ?? ''),
    );
    return [...groupBy(idle, (r) => r.resourceId ?? r.subAccountId)].map(([resource, items]) => {
      const monthlyCost = monthly(cost(items));
      return {
        id: `idle-public-ip:${resource}`,
        ruleId: 'idle-public-ip',
        category: 'waste',
        provider: 'aws',
        title: 'IP público ocioso',
        description: `O endereço ${resource} está alocado sem estar associado a nenhum recurso em execução. Desde 2024 a AWS cobra todo IPv4 público, inclusive o ocioso.`,
        action: `Libere o endereço com \`aws ec2 release-address --allocation-id ${resource}\` se ele não for necessário.`,
        estimatedMonthlySavings: round(monthlyCost),
        monthlyCost: round(monthlyCost),
        confidence: 'high',
        effort: 'low',
        resources: [resource],
        evidence: { conta: items[0]!.subAccountId, regiao: items[0]!.region },
      };
    });
  },
};

/** gp3 custa 20% menos por GB que gp2 e entrega 3.000 IOPS de base, sem depender do tamanho do volume. */
export const gp2ToGp3Rule: RecommendationRule = {
  id: 'ebs-gp2-to-gp3',
  evaluate({ records, monthly }) {
    const gp2 = records.filter((r) => r.provider === 'aws' && /EBS:VolumeUsage\.gp2$/i.test(r.usageType ?? ''));
    const volumes = groupBy(gp2, (r) => r.resourceId);
    if (volumes.size === 0) return [];
    const monthlyCost = monthly(cost(gp2));
    return [
      {
        id: 'ebs-gp2-to-gp3:all',
        ruleId: 'ebs-gp2-to-gp3',
        category: 'modernization',
        provider: 'aws',
        title: `Migrar ${volumes.size} ${volumes.size > 1 ? 'volumes' : 'volume'} EBS de gp2 para gp3`,
        description:
          'Volumes gp3 custam 20% menos por GB-mês que gp2 e têm 3.000 IOPS e 125 MB/s de base. A migração é online, sem parar a instância.',
        action:
          'Para cada volume: `aws ec2 modify-volume --volume-id <id> --volume-type gp3`. Revise volumes com IOPS acima de 3.000.',
        estimatedMonthlySavings: round(monthlyCost * 0.2),
        monthlyCost: round(monthlyCost),
        confidence: 'high',
        effort: 'low',
        resources: [...volumes.keys()].sort(),
        evidence: { volumes: volumes.size },
      },
    ];
  },
};

const AWS_PREVIOUS_GENERATION: Record<string, string> = {
  t1: 't3',
  t2: 't3',
  m1: 'm7i',
  m2: 'm7i',
  m3: 'm7i',
  m4: 'm7i ou m7g (Graviton)',
  c1: 'c7i',
  c3: 'c7i',
  c4: 'c7i ou c7g (Graviton)',
  r3: 'r7i',
  r4: 'r7i ou r7g (Graviton)',
  i2: 'i4i',
  d2: 'd3',
  g2: 'g5',
  g3: 'g5',
  p2: 'g5',
  x1: 'x2iedn',
};

function previousGenerationTarget(provider: Provider, instanceType: string): string | null {
  if (provider === 'aws') {
    const family = instanceType.split('.')[0]?.toLowerCase() ?? '';
    return AWS_PREVIOUS_GENERATION[family] ?? null;
  }
  if (provider === 'azure') {
    const versioned = /^Standard_([A-Z]+)(\d+)([a-z]*)_v([1-3])$/i.exec(instanceType);
    if (versioned) return `Standard_${versioned[1]}${versioned[2]}${versioned[3]}_v5`;
    if (/^(Basic|Standard)_A\d+$/i.test(instanceType)) return 'Standard_B (burstable) ou Dv5';
  }
  return null;
}

/** Gerações antigas custam mais por vCPU e entregam menos desempenho que as atuais. */
export const previousGenerationRule: RecommendationRule = {
  id: 'previous-generation-instance',
  evaluate({ records, monthly }) {
    const compute = usageOnly(records).filter((r) => r.serviceCategory === 'Compute' && r.instanceType && r.resourceId);
    const results: Recommendation[] = [];
    // Agrupa por conta + tipo: "3 instâncias t2.large" é uma decisão só, não três.
    for (const [group, items] of groupBy(compute, (r) => `${r.provider}|${r.subAccountId}|${r.instanceType}`)) {
      const sample = items[0]!;
      const target = previousGenerationTarget(sample.provider, sample.instanceType!);
      if (!target) continue;
      const resources = [...new Set(items.map((r) => r.resourceId!))].sort();
      const monthlyCost = monthly(cost(items));
      const plural = resources.length > 1;
      results.push({
        id: `previous-generation-instance:${group}`,
        ruleId: 'previous-generation-instance',
        category: 'modernization',
        provider: sample.provider,
        title: `Atualizar ${resources.length} ${plural ? 'instâncias' : 'instância'} ${sample.instanceType} para geração atual`,
        description: `${resources.length} ${plural ? 'recursos usam' : 'recurso usa'} ${sample.instanceType} na conta ${sample.subAccountId}, de geração anterior. Famílias atuais têm preço menor por vCPU e melhor desempenho.`,
        action: `Teste a família ${target} em homologação e troque o tipo na próxima janela de manutenção.`,
        // Estimativa conservadora: a diferença real costuma passar de 10% (e de 20% com Graviton).
        estimatedMonthlySavings: round(monthlyCost * 0.1),
        monthlyCost: round(monthlyCost),
        confidence: 'medium',
        effort: 'medium',
        resources,
        evidence: { tipoAtual: sample.instanceType!, sugestao: target, conta: sample.subAccountId },
      });
    }
    return results;
  },
};

/**
 * Cobertura de compromisso: o piso estável de compute on-demand (percentil 10 do gasto diário)
 * pode ser coberto por Savings Plan/Reserva sem risco de pagar por capacidade ociosa.
 */
export const commitmentCoverageRule: RecommendationRule = {
  id: 'commitment-coverage',
  evaluate({ records, period, config, money }) {
    const compute = usageOnly(records).filter((r) => r.serviceCategory === 'Compute');
    const results: Recommendation[] = [];
    for (const [provider, items] of groupBy(compute, (r) => r.provider)) {
      const onDemand = items.filter((r) => r.pricingCategory === 'Standard');
      const committed = items.filter((r) => r.pricingCategory === 'Committed');
      const { series } = dailyMatrix(onDemand, period, null);
      const daily = series.get('total') ?? [];
      const daysWithData = daily.filter((v) => v > 0).length;
      if (daysWithData < config.minHistoryDays) continue;

      const baselineDaily = percentile(daily, 0.1);
      const monthlyCommitment = baselineDaily * 30;
      if (monthlyCommitment < config.minMonthlyCommitment) continue;

      const rate = config.commitmentDiscountRate[provider as Provider] ?? 0.25;
      const onDemandTotal = cost(onDemand);
      const committedTotal = cost(committed);
      const coverage = onDemandTotal + committedTotal === 0 ? 0 : committedTotal / (onDemandTotal + committedTotal);
      const product = provider === 'aws' ? 'Compute Savings Plan' : 'Azure Savings Plan for Compute';
      const hourly = baselineDaily / 24;

      results.push({
        id: `commitment-coverage:${provider}`,
        ruleId: 'commitment-coverage',
        category: 'commitment',
        provider: provider as Provider,
        title: `Cobrir o piso de compute com ${product}`,
        description: `A cobertura de compromisso está em ${formatPercent(coverage)}. O gasto on-demand de compute nunca fica abaixo de ~${money(baselineDaily)} por dia (percentil 10), então esse piso pode ser comprometido sem risco de ociosidade.`,
        action: `Contrate ${product} de 1 ano com compromisso de ${money(round(hourly, 2))}/hora e reavalie a cobertura em 30 dias.`,
        estimatedMonthlySavings: round(monthlyCommitment * rate),
        monthlyCost: round(monthlyCommitment),
        confidence: 'medium',
        effort: 'low',
        resources: [],
        evidence: {
          coberturaAtual: round(coverage, 4),
          compromissoHora: round(hourly, 4),
          descontoAssumido: rate,
          diasAnalisados: daysWithData,
        },
      });
    }
    return results;
  },
};

/** Ambientes não produtivos ligados 24x7: desligar fora do horário comercial corta ~64% das horas. */
export const nonProdSchedulingRule: RecommendationRule = {
  id: 'nonprod-scheduling',
  evaluate({ records, period, config, monthly }) {
    const nonProd = new Set(config.nonProdTagValues.map((v) => v.toLowerCase()));
    const compute = usageOnly(records).filter(
      (r) => r.serviceCategory === 'Compute' && nonProd.has((r.tags[config.nonProdTagKey] ?? '').toLowerCase()),
    );
    const results: Recommendation[] = [];
    const groups = groupBy(
      compute,
      (r) => `${r.provider}|${r.subAccountId}|${r.tags[config.nonProdTagKey]!.toLowerCase()}`,
    );
    for (const [group, items] of groups) {
      const [provider, account, env] = group.split('|') as [Provider, string, string];
      const { dates, series } = dailyMatrix(items, period, null);
      const daily = series.get('total') ?? [];
      const weekend = daily.filter((_, i) => isWeekend(dates[i]!));
      const weekday = daily.filter((_, i) => !isWeekend(dates[i]!));
      if (weekend.length < 2 || weekday.length < 5) continue;
      const weekendAvg = sum(weekend) / weekend.length;
      const weekdayAvg = sum(weekday) / weekday.length;
      if (weekdayAvg <= 0 || weekendAvg / weekdayAvg < 0.6) continue; // já tem agendamento

      const monthlyCost = monthly(cost(items));
      const resources = [...new Set(items.map((r) => r.resourceId).filter((id): id is string => id !== null))].sort();
      results.push({
        id: `nonprod-scheduling:${provider}:${account}:${env}`,
        ruleId: 'nonprod-scheduling',
        category: 'scheduling',
        provider,
        title: `Desligar o ambiente "${env}" fora do horário comercial`,
        description: `O compute de ${env} na conta ${account} custa no fim de semana ${formatPercent(weekendAvg / weekdayAvg, 0)} do que custa num dia útil, ou seja, fica ligado 24x7.`,
        action:
          'Agende parada e partida (Instance Scheduler na AWS, Start/Stop VMs v2 no Azure) para 12h por dia útil. Estimativa conservadora de 50% de economia.',
        estimatedMonthlySavings: round(monthlyCost * 0.5),
        monthlyCost: round(monthlyCost),
        confidence: 'medium',
        effort: 'medium',
        resources,
        evidence: { mediaFimDeSemana: round(weekendAvg), mediaDiaUtil: round(weekdayAvg), recursos: resources.length },
      });
    }
    return results;
  },
};

/** NAT Gateway cobra por GB processado; tráfego para S3/DynamoDB pode sair por endpoint gratuito. */
export const natGatewayRule: RecommendationRule = {
  id: 'nat-gateway-data-processing',
  evaluate({ records, monthly, money }) {
    const nat = records.filter((r) => r.provider === 'aws' && /NatGateway-Bytes/i.test(r.usageType ?? ''));
    const monthlyCost = monthly(cost(nat));
    if (monthlyCost < 50) return [];
    const gateways = [...new Set(nat.map((r) => r.resourceId).filter((id): id is string => id !== null))].sort();
    return [
      {
        id: 'nat-gateway-data-processing:all',
        ruleId: 'nat-gateway-data-processing',
        category: 'architecture',
        provider: 'aws',
        title: 'Reduzir processamento de dados no NAT Gateway',
        description: `O processamento de dados nos NAT Gateways custa ~${money(monthlyCost)} por mês. Tráfego para S3 e DynamoDB passando pelo NAT é um caso comum e evitável.`,
        action:
          'Crie VPC Gateway Endpoints para S3 e DynamoDB (sem custo), use Interface Endpoints para ECR/STS e analise o VPC Flow Logs para achar os maiores destinos.',
        estimatedMonthlySavings: round(monthlyCost * 0.3),
        monthlyCost: round(monthlyCost),
        confidence: 'low',
        effort: 'medium',
        resources: gateways,
        evidence: { gateways: gateways.length },
      },
    ];
  },
};

/** Sem tags obrigatórias não existe showback: ninguém é dono do custo, e custo sem dono não cai. */
export const untaggedSpendRule: RecommendationRule = {
  id: 'untagged-spend',
  evaluate({ records, config, monthly, money }) {
    const usage = usageOnly(records);
    const total = cost(usage);
    if (total <= 0 || config.requiredTags.length === 0) return [];
    const untagged = usage.filter((r) => config.requiredTags.some((tag) => !r.tags[tag]));
    const untaggedCost = cost(untagged);
    const share = untaggedCost / total;
    if (share < config.untaggedShareThreshold) return [];
    const topServices = breakdown(untagged, 'service')
      .slice(0, 3)
      .map((item) => item.key);
    return [
      {
        id: 'untagged-spend:all',
        ruleId: 'untagged-spend',
        category: 'governance',
        provider: 'multi',
        title: `${formatPercent(share)} do custo sem as tags obrigatórias`,
        description: `Recursos sem ${config.requiredTags.map((t) => `"${t}"`).join(' e ')} somam ~${money(monthly(untaggedCost))} por mês e não podem ser atribuídos a nenhum time. Os maiores estão em: ${topServices.join(', ')}.`,
        action:
          'Aplique as tags com AWS Tag Policies / Azure Policy (efeito "deny" ou "modify") e corrija os recursos existentes pelo Resource Groups Tagging API.',
        estimatedMonthlySavings: 0,
        monthlyCost: round(monthly(untaggedCost)),
        confidence: 'high',
        effort: 'medium',
        resources: [],
        evidence: { participacao: round(share, 4), tagsObrigatorias: config.requiredTags.join(',') },
      },
    ];
  },
};

export const DEFAULT_RULES: readonly RecommendationRule[] = [
  commitmentCoverageRule,
  nonProdSchedulingRule,
  previousGenerationRule,
  gp2ToGp3Rule,
  idlePublicIpRule,
  natGatewayRule,
  untaggedSpendRule,
];

/**
 * Executa as regras sobre o período informado (normalmente os últimos 30 dias com dado).
 * Uma regra com erro não derruba as outras: o erro é devolvido para a camada de cima registrar.
 */
export function generateRecommendations(
  records: readonly CostRecord[],
  period: Period,
  overrides: Partial<RecommendationConfig> = {},
  rules: readonly RecommendationRule[] = DEFAULT_RULES,
): { recommendations: Recommendation[]; errors: { ruleId: string; message: string }[] } {
  const config = { ...DEFAULT_RECOMMENDATION_CONFIG, ...overrides };
  const days = periodLength(period);
  const inWindow = records.filter((r) => r.date >= period.from && r.date <= period.to);
  const context: RuleContext = {
    records: inWindow,
    period,
    config,
    monthly: (value) => (days === 0 ? 0 : (value / days) * 30),
    money: (value) => formatMoney(value, inWindow[0]?.currency ?? 'USD'),
  };

  const recommendations: Recommendation[] = [];
  const errors: { ruleId: string; message: string }[] = [];
  for (const rule of rules) {
    try {
      recommendations.push(...rule.evaluate(context));
    } catch (error) {
      errors.push({ ruleId: rule.id, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const relevant = recommendations.filter(
    (r) => r.category === 'governance' || r.estimatedMonthlySavings >= config.minMonthlySavings,
  );
  relevant.sort((a, b) => {
    if ((a.category === 'governance') !== (b.category === 'governance')) return a.category === 'governance' ? 1 : -1;
    return b.estimatedMonthlySavings - a.estimatedMonthlySavings || a.id.localeCompare(b.id);
  });
  return { recommendations: relevant, errors };
}
