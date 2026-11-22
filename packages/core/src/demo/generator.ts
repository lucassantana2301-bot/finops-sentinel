import type { CostRecord, PricingCategory, Provider, ServiceCategory } from '../domain/cost-record.js';
import { addDays, dateRange, daysBetween, isWeekend, type IsoDate } from '../domain/dates.js';
import { round } from '../domain/money.js';

/**
 * Gerador de dados sintéticos determinístico (mesma semente = mesmo dataset).
 *
 * Simula uma empresa com AWS e Azure e injeta de propósito os problemas que o sistema deve encontrar:
 * pico de NAT Gateway, gasto novo de Azure OpenAI, ambiente de dev ligado 24x7, volumes gp2,
 * instâncias de geração anterior, IP ocioso e recursos sem tag. Serve para demo, testes e screenshots.
 * Todos os IDs são fictícios.
 */

interface ResourceSpec {
  provider: Provider;
  billingAccountId: string;
  subAccountId: string;
  serviceName: string;
  serviceCategory: ServiceCategory;
  region: string;
  resourceId: string;
  usageType: string | null;
  instanceType: string | null;
  pricingCategory: PricingCategory;
  dailyCost: number;
  /** Fator aplicado em sábado/domingo (1 = ligado 24x7). */
  weekendFactor: number;
  /** Crescimento linear ao longo do período (0,15 = +15% do início ao fim). */
  growth: number;
  tags: Record<string, string>;
  /** Dia (relativo ao fim) a partir do qual o recurso existe. 0 = desde o início. */
  startsDaysBeforeEnd?: number;
  /** Multiplicadores em dias específicos, contados a partir do fim (1 = último dia). */
  spikes?: Record<number, number>;
}

const AWS_PAYER = '900000000001';
const AWS_PROD = '100000000001';
const AWS_DEV = '100000000002';
const AZURE_BILLING = 'contoso-ea-0001';
const AZURE_PROD = 'a1b2c3d4-0000-4000-8000-000000000001';
const AZURE_DATA = 'a1b2c3d4-0000-4000-8000-000000000002';

function aws(spec: Omit<ResourceSpec, 'provider' | 'billingAccountId'>): ResourceSpec {
  return { provider: 'aws', billingAccountId: AWS_PAYER, ...spec };
}

function azure(spec: Omit<ResourceSpec, 'provider' | 'billingAccountId'>): ResourceSpec {
  return { provider: 'azure', billingAccountId: AZURE_BILLING, ...spec };
}

const azureId = (sub: string, rg: string, type: string, name: string) =>
  `/subscriptions/${sub}/resourcegroups/${rg}/providers/${type}/${name}`.toLowerCase();

const PROD = { env: 'prod', 'cost-center': 'cc-1001' };

const RESOURCES: ResourceSpec[] = [
  // ---- AWS produção: API de pagamentos
  ...[1, 2, 3, 4].map((n) =>
    aws({
      subAccountId: AWS_PROD,
      serviceName: 'Amazon EC2',
      serviceCategory: 'Compute',
      region: 'us-east-1',
      resourceId: `i-0a1b2c3d4e5f6000${n}`,
      usageType: 'USE1-BoxUsage:m5.xlarge',
      instanceType: 'm5.xlarge',
      pricingCategory: 'Standard',
      dailyCost: 4.61,
      weekendFactor: 0.9,
      growth: 0.12,
      tags: { ...PROD, team: 'pagamentos', app: 'payments-api' },
    }),
  ),
  aws({
    subAccountId: AWS_PROD,
    serviceName: 'Amazon EC2',
    serviceCategory: 'Compute',
    region: 'us-east-1',
    resourceId: 'i-0c4c4c4c4c4c40001',
    usageType: 'USE1-BoxUsage:c4.2xlarge',
    instanceType: 'c4.2xlarge',
    pricingCategory: 'Standard',
    dailyCost: 9.55,
    weekendFactor: 1,
    growth: 0,
    tags: { ...PROD, team: 'dados', app: 'etl-worker' },
  }),
  aws({
    subAccountId: AWS_PROD,
    serviceName: 'Amazon EC2',
    serviceCategory: 'Compute',
    region: 'us-east-1',
    resourceId: 'i-0sp0sp0sp0sp00001',
    usageType: 'USE1-BoxUsage:m6i.2xlarge',
    instanceType: 'm6i.2xlarge',
    pricingCategory: 'Committed',
    dailyCost: 6.9,
    weekendFactor: 1,
    growth: 0,
    tags: { ...PROD, team: 'plataforma', app: 'kafka' },
  }),
  aws({
    subAccountId: AWS_PROD,
    serviceName: 'Amazon EC2',
    serviceCategory: 'Compute',
    region: 'us-east-1',
    resourceId: 'nat-0f1e2d3c4b5a60001',
    usageType: 'USE1-NatGateway-Bytes',
    instanceType: null,
    pricingCategory: 'Standard',
    dailyCost: 7.8,
    weekendFactor: 0.8,
    growth: 0.05,
    tags: { ...PROD, team: 'plataforma' },
    spikes: { 9: 7.5, 8: 6.2 },
  }),
  aws({
    subAccountId: AWS_PROD,
    serviceName: 'Amazon EC2',
    serviceCategory: 'Storage',
    region: 'us-east-1',
    resourceId: 'vol-0aa11bb22cc330001',
    usageType: 'USE1-EBS:VolumeUsage.gp2',
    instanceType: null,
    pricingCategory: 'Standard',
    dailyCost: 3.33,
    weekendFactor: 1,
    growth: 0,
    tags: { ...PROD, team: 'pagamentos' },
  }),
  aws({
    subAccountId: AWS_PROD,
    serviceName: 'Amazon EC2',
    serviceCategory: 'Storage',
    region: 'us-east-1',
    resourceId: 'vol-0aa11bb22cc330002',
    usageType: 'USE1-EBS:VolumeUsage.gp2',
    instanceType: null,
    pricingCategory: 'Standard',
    dailyCost: 1.67,
    weekendFactor: 1,
    growth: 0,
    tags: {},
  }),
  aws({
    subAccountId: AWS_PROD,
    serviceName: 'Amazon EC2',
    serviceCategory: 'Networking',
    region: 'us-east-1',
    resourceId: 'eipalloc-0123456789abc0001',
    usageType: 'USE1-PublicIPv4:IdleAddress',
    instanceType: null,
    pricingCategory: 'Standard',
    dailyCost: 0.12,
    weekendFactor: 1,
    growth: 0,
    tags: {},
  }),
  aws({
    subAccountId: AWS_PROD,
    serviceName: 'Amazon RDS',
    serviceCategory: 'Databases',
    region: 'us-east-1',
    resourceId: 'arn:aws:rds:us-east-1:100000000001:db:payments-prod',
    usageType: 'USE1-Multi-AZUsage:db.r6g.xlarge',
    instanceType: 'db.r6g.xlarge',
    pricingCategory: 'Standard',
    dailyCost: 23.4,
    weekendFactor: 1,
    growth: 0.04,
    tags: { ...PROD, team: 'pagamentos', app: 'payments-api' },
  }),
  aws({
    subAccountId: AWS_PROD,
    serviceName: 'Amazon S3',
    serviceCategory: 'Storage',
    region: 'us-east-1',
    resourceId: 'datalake-raw-zone',
    usageType: 'USE1-TimedStorage-ByteHrs',
    instanceType: null,
    pricingCategory: 'Standard',
    dailyCost: 5.2,
    weekendFactor: 1,
    growth: 0.25,
    tags: { ...PROD, team: 'dados' },
  }),
  aws({
    subAccountId: AWS_PROD,
    serviceName: 'AWS Lambda',
    serviceCategory: 'Compute',
    region: 'us-east-1',
    resourceId: 'arn:aws:lambda:us-east-1:100000000001:function:webhook-dispatcher',
    usageType: 'USE1-Lambda-GB-Second',
    instanceType: null,
    pricingCategory: 'Standard',
    dailyCost: 1.9,
    weekendFactor: 0.7,
    growth: 0.1,
    tags: { ...PROD, team: 'pagamentos' },
  }),
  aws({
    subAccountId: AWS_PROD,
    serviceName: 'Amazon CloudWatch',
    serviceCategory: 'Management and Governance',
    region: 'us-east-1',
    resourceId: 'cloudwatch-logs',
    usageType: 'USE1-DataProcessing-Bytes',
    instanceType: null,
    pricingCategory: 'Standard',
    dailyCost: 2.6,
    weekendFactor: 0.85,
    growth: 0.08,
    tags: {},
  }),
  // ---- AWS dev: ligado 24x7, geração anterior
  ...[1, 2, 3].map((n) =>
    aws({
      subAccountId: AWS_DEV,
      serviceName: 'Amazon EC2',
      serviceCategory: 'Compute',
      region: 'sa-east-1',
      resourceId: `i-0dev0dev0dev0000${n}`,
      usageType: 'SAE1-BoxUsage:t2.large',
      instanceType: 't2.large',
      pricingCategory: 'Standard',
      dailyCost: 3.57,
      weekendFactor: 1,
      growth: 0,
      tags: { env: 'dev', team: 'pagamentos', 'cost-center': 'cc-2001' },
    }),
  ),
  aws({
    subAccountId: AWS_DEV,
    serviceName: 'Amazon RDS',
    serviceCategory: 'Databases',
    region: 'sa-east-1',
    resourceId: 'arn:aws:rds:sa-east-1:100000000002:db:payments-dev',
    usageType: 'SAE1-InstanceUsage:db.t3.medium',
    instanceType: 'db.t3.medium',
    pricingCategory: 'Standard',
    dailyCost: 3.1,
    weekendFactor: 1,
    growth: 0,
    tags: { env: 'dev', team: 'pagamentos' },
  }),
  // ---- Azure produção: portal do cliente
  ...[1, 2].map((n) =>
    azure({
      subAccountId: AZURE_PROD,
      serviceName: 'Virtual Machines',
      serviceCategory: 'Compute',
      region: 'brazilsouth',
      resourceId: azureId(AZURE_PROD, 'rg-portal-prod', 'microsoft.compute/virtualmachines', `vm-portal-0${n}`),
      usageType: 'D4s v3',
      instanceType: 'Standard_D4s_v3',
      pricingCategory: 'Standard',
      dailyCost: 8.83,
      weekendFactor: 1,
      growth: 0,
      tags: { ...PROD, team: 'portal', app: 'customer-portal' },
    }),
  ),
  azure({
    subAccountId: AZURE_PROD,
    serviceName: 'SQL Database',
    serviceCategory: 'Databases',
    region: 'brazilsouth',
    resourceId: azureId(AZURE_PROD, 'rg-portal-prod', 'microsoft.sql/servers', 'sql-portal-prod'),
    usageType: 'vCore',
    instanceType: null,
    pricingCategory: 'Standard',
    dailyCost: 12.1,
    weekendFactor: 1,
    growth: 0.03,
    tags: { ...PROD, team: 'portal', app: 'customer-portal' },
  }),
  azure({
    subAccountId: AZURE_PROD,
    serviceName: 'Storage',
    serviceCategory: 'Storage',
    region: 'brazilsouth',
    resourceId: azureId(AZURE_PROD, 'rg-portal-prod', 'microsoft.storage/storageaccounts', 'stportalprod'),
    usageType: 'Hot LRS Data Stored',
    instanceType: null,
    pricingCategory: 'Standard',
    dailyCost: 2.4,
    weekendFactor: 1,
    growth: 0.18,
    tags: { ...PROD, team: 'portal' },
  }),
  azure({
    subAccountId: AZURE_PROD,
    serviceName: 'Bandwidth',
    serviceCategory: 'Networking',
    region: 'brazilsouth',
    resourceId: azureId(AZURE_PROD, 'rg-portal-prod', 'microsoft.network/frontdoors', 'fd-portal'),
    usageType: 'Data Transfer Out',
    instanceType: null,
    pricingCategory: 'Standard',
    dailyCost: 3.9,
    weekendFactor: 0.75,
    growth: 0.1,
    tags: {},
  }),
  // ---- Azure dados: gasto novo de IA nos últimos dias
  azure({
    subAccountId: AZURE_DATA,
    serviceName: 'Azure OpenAI',
    serviceCategory: 'AI and Machine Learning',
    region: 'eastus2',
    resourceId: azureId(AZURE_DATA, 'rg-ml-sandbox', 'microsoft.cognitiveservices/accounts', 'oai-assistente'),
    usageType: 'gpt-4o Input Tokens',
    instanceType: null,
    pricingCategory: 'Standard',
    dailyCost: 46,
    weekendFactor: 0.6,
    growth: 0,
    tags: { env: 'staging', team: 'ml' },
    startsDaysBeforeEnd: 4,
  }),
  azure({
    subAccountId: AZURE_DATA,
    serviceName: 'Azure Databricks',
    serviceCategory: 'Analytics',
    region: 'eastus2',
    resourceId: azureId(AZURE_DATA, 'rg-lakehouse', 'microsoft.databricks/workspaces', 'dbw-lakehouse'),
    usageType: 'Premium Jobs Compute DBU',
    instanceType: null,
    pricingCategory: 'Standard',
    dailyCost: 15.5,
    weekendFactor: 0.35,
    growth: 0.06,
    // Sem a tag "team": aparece na regra de governança.
    tags: { env: 'prod', 'cost-center': 'cc-3001' },
  }),
];

/** PRNG mulberry32: rápido, determinístico e suficiente para ruído de demonstração. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoOptions {
  /** Último dia do dataset (padrão: anteontem, imitando o atraso do billing). */
  endDate?: IsoDate;
  days?: number;
  seed?: number;
}

export function generateDemoDataset(options: DemoOptions = {}): CostRecord[] {
  const end = options.endDate ?? addDays(new Date().toISOString().slice(0, 10), -2);
  const days = options.days ?? 90;
  const random = mulberry32(options.seed ?? 42);
  const start = addDays(end, -(days - 1));
  const records: CostRecord[] = [];

  for (const date of dateRange({ from: start, to: end })) {
    const daysBeforeEnd = daysBetween(date, end) + 1;
    const progress = days === 1 ? 1 : daysBetween(start, date) / (days - 1);
    for (const spec of RESOURCES) {
      if (spec.startsDaysBeforeEnd !== undefined && daysBeforeEnd > spec.startsDaysBeforeEnd) continue;
      const seasonal = isWeekend(date) ? spec.weekendFactor : 1;
      const noise = 1 + (random() - 0.5) * 0.08;
      const spike = spec.spikes?.[daysBeforeEnd] ?? 1;
      const value = round(spec.dailyCost * (1 + spec.growth * progress) * seasonal * noise * spike, 6);
      // Compromisso: o custo faturado cai na linha de taxa do Savings Plan; o efetivo fica no uso.
      const billedCost = spec.pricingCategory === 'Committed' ? 0 : value;
      records.push({
        date,
        provider: spec.provider,
        billingAccountId: spec.billingAccountId,
        subAccountId: spec.subAccountId,
        serviceName: spec.serviceName,
        serviceCategory: spec.serviceCategory,
        region: spec.region,
        resourceId: spec.resourceId,
        usageType: spec.usageType,
        instanceType: spec.instanceType,
        chargeCategory: 'Usage',
        pricingCategory: spec.pricingCategory,
        billedCost,
        effectiveCost: value,
        currency: 'USD',
        tags: spec.tags,
      });
    }
    // Taxa recorrente do Savings Plan (faturada todo dia, efetivo zero: já está no uso coberto).
    records.push({
      date,
      provider: 'aws',
      billingAccountId: AWS_PAYER,
      subAccountId: AWS_PROD,
      serviceName: 'Savings Plans for AWS Compute usage',
      serviceCategory: 'Compute',
      region: 'global',
      resourceId: 'arn:aws:savingsplans::900000000001:savingsplan/demo-0001',
      usageType: 'ComputeSP:1yrNoUpfront',
      instanceType: null,
      chargeCategory: 'Purchase',
      pricingCategory: 'Other',
      billedCost: 6.9,
      effectiveCost: 0,
      currency: 'USD',
      tags: {},
    });
  }
  return records;
}
