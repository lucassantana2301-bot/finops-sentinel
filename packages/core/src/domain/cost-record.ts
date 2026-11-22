import { isIsoDate, type IsoDate } from './dates.js';

/**
 * Modelo canônico de custo, baseado no FinOps Open Cost and Usage Specification (FOCUS 1.0).
 *
 * Cada provedor exporta billing num formato próprio (AWS CUR 2.0, Azure Cost Details). Os adapters de
 * ingestão traduzem tudo para este modelo, e o resto do sistema (anomalias, previsão, recomendações)
 * não sabe de qual nuvem o dado veio. Os nomes seguem as colunas FOCUS para facilitar a auditoria.
 */

export const PROVIDERS = ['aws', 'azure', 'gcp', 'other'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** FOCUS ChargeCategory. */
export const CHARGE_CATEGORIES = ['Usage', 'Purchase', 'Tax', 'Credit', 'Adjustment'] as const;
export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number];

/**
 * FOCUS PricingCategory.
 * Standard = preço de tabela (on-demand), Dynamic = spot, Committed = coberto por Savings Plan/Reserva.
 */
export const PRICING_CATEGORIES = ['Standard', 'Dynamic', 'Committed', 'Other'] as const;
export type PricingCategory = (typeof PRICING_CATEGORIES)[number];

/** FOCUS ServiceCategory (subconjunto usado nas regras). */
export const SERVICE_CATEGORIES = [
  'Compute',
  'Storage',
  'Databases',
  'Networking',
  'AI and Machine Learning',
  'Analytics',
  'Management and Governance',
  'Security',
  'Other',
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export interface CostRecord {
  /** ChargePeriodStart truncado para o dia (UTC). */
  date: IsoDate;
  provider: Provider;
  /** Conta pagadora (AWS payer account / Azure billing account). */
  billingAccountId: string;
  /** Conta de uso (AWS linked account / Azure subscription). */
  subAccountId: string;
  serviceName: string;
  serviceCategory: ServiceCategory;
  /** Região normalizada (ex.: us-east-1, brazilsouth) ou "global". */
  region: string;
  resourceId: string | null;
  /** Tipo de uso bruto (AWS line_item_usage_type / Azure meter) usado por regras específicas. */
  usageType: string | null;
  /** Tipo de instância ou SKU de VM (m5.xlarge, Standard_D4s_v3). */
  instanceType: string | null;
  chargeCategory: ChargeCategory;
  pricingCategory: PricingCategory;
  /** Valor faturado (cash): o que aparece na fatura do mês. */
  billedCost: number;
  /** Valor efetivo (amortizado): distribui upfronts de Savings Plans/Reservas pelo uso coberto. */
  effectiveCost: number;
  currency: string;
  /** Tags normalizadas: chaves em minúsculas, sem prefixos "user:" / "user_". */
  tags: Readonly<Record<string, string>>;
}

export type CostMetric = 'effectiveCost' | 'billedCost';

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

export function isServiceCategory(value: string): value is ServiceCategory {
  return (SERVICE_CATEGORIES as readonly string[]).includes(value);
}

export function isChargeCategory(value: string): value is ChargeCategory {
  return (CHARGE_CATEGORIES as readonly string[]).includes(value);
}

export function isPricingCategory(value: string): value is PricingCategory {
  return (PRICING_CATEGORIES as readonly string[]).includes(value);
}

/** Retorna a lista de problemas do registro (vazia = válido). */
export function validateCostRecord(record: CostRecord): string[] {
  const problems: string[] = [];
  if (!isIsoDate(record.date)) problems.push(`data inválida "${record.date}"`);
  if (!isProvider(record.provider)) problems.push(`provedor inválido "${record.provider}"`);
  if (record.subAccountId.trim() === '') problems.push('conta/assinatura vazia');
  if (record.serviceName.trim() === '') problems.push('serviço vazio');
  if (!Number.isFinite(record.billedCost)) problems.push('billedCost não numérico');
  if (!Number.isFinite(record.effectiveCost)) problems.push('effectiveCost não numérico');
  if (!/^[A-Z]{3}$/.test(record.currency)) problems.push(`moeda inválida "${record.currency}"`);
  return problems;
}

const TAG_PREFIXES = /^(user:|user_|aws:|tag:)/i;

/**
 * Normaliza chaves de tag entre provedores.
 * AWS CUR 2.0 exporta `user_team`, o CUR legado `resourceTags/user:team`, o Azure `team` ou `Team`.
 */
export function normalizeTagKey(key: string): string {
  return key
    .trim()
    .replace(/^resourcetags\//i, '')
    .replace(TAG_PREFIXES, '')
    .toLowerCase();
}

export function normalizeTags(raw: Readonly<Record<string, unknown>>): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    const normalizedKey = normalizeTagKey(key);
    if (normalizedKey === '' || text === '') continue;
    tags[normalizedKey] = text;
  }
  return tags;
}

/**
 * Lê o campo de tags dos exports. Aceita JSON (`{"team":"x"}`) e o formato do Azure sem chaves
 * (`"team": "x","env": "prod"`). Retorna objeto vazio se não houver tags ou o conteúdo for inválido:
 * tag corrompida não pode derrubar a importação inteira.
 */
export function parseTagsField(raw: string | undefined): Record<string, string> {
  const value = raw?.trim() ?? '';
  if (value === '' || value === '{}' || value === 'null') return {};
  const candidate = value.startsWith('{') ? value : `{${value}}`;
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return normalizeTags(parsed as Record<string, unknown>);
    }
  } catch {
    // JSON quebrado não é adivinhado: melhor sem tag do que com tag errada.
    if (value.startsWith('{')) return {};
    // Formato chave=valor;chave=valor, usado por algumas ferramentas de terceiros.
    const pairs = value.split(/[;,]/).map((pair) => pair.split(/[=:]/));
    const entries = pairs.filter((p) => p.length === 2).map(([k, v]) => [k!.replace(/"/g, ''), v!.replace(/"/g, '')]);
    return normalizeTags(Object.fromEntries(entries));
  }
  return {};
}

/**
 * Nome curto para exibição: o ID completo de recurso do Azure (/subscriptions/.../vm-portal-01) e o ARN
 * da AWS ficam ilegíveis em tabela. O ID completo continua nos dados para busca e auditoria.
 */
export function shortResourceName(resourceId: string): string {
  if (resourceId.startsWith('/subscriptions/')) return resourceId.split('/').filter(Boolean).at(-1) ?? resourceId;
  if (resourceId.startsWith('arn:')) return resourceId.split(/[:/]/).at(-1) ?? resourceId;
  return resourceId;
}
