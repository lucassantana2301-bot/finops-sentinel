import { stringify } from 'csv-stringify/sync';
import {
  isChargeCategory,
  isServiceCategory,
  parseTagsField,
  type CostRecord,
  type PricingCategory,
  type Provider,
} from '../domain/cost-record.js';
import { addDays, normalizeDate } from '../domain/dates.js';
import { classifyService } from '../domain/service-catalog.js';
import { parseAmount, pick, required, RowError, type CsvRow } from './row.js';

/**
 * FOCUS 1.0: formato aberto suportado nativamente pelo AWS Data Exports e pelo Azure Cost Management.
 * É o caminho recomendado: já traz BilledCost e EffectiveCost separados para as duas nuvens.
 */

export function providerFromName(name: string): Provider {
  const value = name.toLowerCase();
  if (value === 'aws' || value.includes('amazon')) return 'aws';
  if (value.includes('microsoft') || value.includes('azure')) return 'azure';
  if (value.includes('google') || value === 'gcp') return 'gcp';
  return 'other';
}

function pricingCategory(raw: string | undefined, chargeCategory: string): PricingCategory {
  switch ((raw ?? '').toLowerCase().replace(/[\s_-]/g, '')) {
    case 'standard':
    case 'ondemand':
      return 'Standard';
    case 'dynamic':
    case 'spot':
      return 'Dynamic';
    case 'committed':
    case 'commitmentbased':
      return 'Committed';
    case 'other':
      return 'Other';
    default:
      return chargeCategory === 'Usage' ? 'Standard' : 'Other';
  }
}

export function mapFocusRow(row: CsvRow): CostRecord | null {
  const date = normalizeDate(required(row, 'ChargePeriodStart', 'chargeperiodstart'));
  if (!date) throw new RowError('ChargePeriodStart inválido');

  const provider = providerFromName(required(row, 'ProviderName', 'providername', 'provider'));
  const billedCost = parseAmount(pick(row, 'billedcost'), 'BilledCost');
  const effectiveCost = parseAmount(pick(row, 'effectivecost'), 'EffectiveCost', billedCost);
  if (billedCost === 0 && effectiveCost === 0) return null;

  const rawCharge = pick(row, 'chargecategory') ?? 'Usage';
  const chargeCategory = isChargeCategory(rawCharge) ? rawCharge : 'Adjustment';
  const serviceName = required(row, 'ServiceName', 'servicename');
  const rawCategory = pick(row, 'servicecategory') ?? '';
  const billingAccountId = required(row, 'BillingAccountId', 'billingaccountid');

  return {
    date,
    provider,
    billingAccountId,
    subAccountId: pick(row, 'subaccountid') ?? billingAccountId,
    serviceName,
    serviceCategory: isServiceCategory(rawCategory) ? rawCategory : classifyService(provider, serviceName),
    region: (pick(row, 'regionid', 'region') ?? 'global').toLowerCase(),
    resourceId: pick(row, 'resourceid') ?? null,
    usageType: pick(row, 'x_usagetype', 'x_skumetertype') ?? null,
    instanceType: pick(row, 'x_instancetype', 'x_skumetersubcategory') ?? null,
    chargeCategory,
    pricingCategory: pricingCategory(pick(row, 'pricingcategory'), chargeCategory),
    billedCost,
    effectiveCost,
    currency: (pick(row, 'billingcurrency') ?? 'USD').toUpperCase(),
    tags: parseTagsField(pick(row, 'tags')),
  };
}

const PROVIDER_NAMES: Record<Provider, string> = {
  aws: 'AWS',
  azure: 'Microsoft',
  gcp: 'Google Cloud',
  other: 'Other',
};

/** Exporta registros em FOCUS 1.0 (com colunas de extensão x_). Usado pela CLI e pelos exemplos. */
export function toFocusCsv(records: readonly CostRecord[]): string {
  const rows = records.map((r) => ({
    ChargePeriodStart: `${r.date}T00:00:00Z`,
    ChargePeriodEnd: `${addDays(r.date, 1)}T00:00:00Z`,
    ProviderName: PROVIDER_NAMES[r.provider],
    BillingAccountId: r.billingAccountId,
    SubAccountId: r.subAccountId,
    ServiceName: r.serviceName,
    ServiceCategory: r.serviceCategory,
    RegionId: r.region,
    ResourceId: r.resourceId ?? '',
    ChargeCategory: r.chargeCategory,
    PricingCategory: r.pricingCategory,
    BilledCost: r.billedCost.toFixed(6),
    EffectiveCost: r.effectiveCost.toFixed(6),
    BillingCurrency: r.currency,
    Tags: Object.keys(r.tags).length === 0 ? '' : JSON.stringify(r.tags),
    x_UsageType: r.usageType ?? '',
    x_InstanceType: r.instanceType ?? '',
  }));
  return stringify(rows, { header: true, record_delimiter: '\n' });
}
