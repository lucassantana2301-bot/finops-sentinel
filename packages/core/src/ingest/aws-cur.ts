import { normalizeTags, type ChargeCategory, type CostRecord, type PricingCategory } from '../domain/cost-record.js';
import { normalizeDate } from '../domain/dates.js';
import { awsServiceName, classifyService } from '../domain/service-catalog.js';
import { parseAmount, parseJsonObject, pick, required, RowError, type CsvRow } from './row.js';

/**
 * AWS Cost and Usage Report. Aceita o CUR 2.0 (snake_case, tags num mapa JSON) e o CUR legado
 * (`lineItem/UsageStartDate`, uma coluna por tag `resourceTags/user:team`).
 *
 * O custo efetivo segue a lógica de amortização documentada pela AWS: linhas cobertas por Savings Plan
 * ou Reserva levam o custo efetivo do compromisso, e as linhas de negação/upfront zeram para não
 * contar o mesmo dinheiro duas vezes.
 */

const COL = {
  date: ['line_item_usage_start_date', 'lineitem/usagestartdate'],
  payer: ['bill_payer_account_id', 'bill/payeraccountid'],
  account: ['line_item_usage_account_id', 'lineitem/usageaccountid'],
  product: ['line_item_product_code', 'lineitem/productcode'],
  productName: ['product_product_name', 'product/productname'],
  region: ['product_region_code', 'product/regioncode', 'product_region', 'product/region'],
  resource: ['line_item_resource_id', 'lineitem/resourceid'],
  usageType: ['line_item_usage_type', 'lineitem/usagetype'],
  instanceType: ['product_instance_type', 'product/instancetype'],
  lineType: ['line_item_line_item_type', 'lineitem/lineitemtype'],
  unblended: ['line_item_unblended_cost', 'lineitem/unblendedcost'],
  currency: ['line_item_currency_code', 'lineitem/currencycode'],
  spEffective: ['savings_plan_savings_plan_effective_cost', 'savingsplan/savingsplaneffectivecost'],
  spTotal: ['savings_plan_total_commitment_to_date', 'savingsplan/totalcommitmenttodate'],
  spUsed: ['savings_plan_used_commitment', 'savingsplan/usedcommitment'],
  riEffective: ['reservation_effective_cost', 'reservation/effectivecost'],
  riUnusedUpfront: [
    'reservation_unused_amortized_upfront_fee_for_billing_period',
    'reservation/unusedamortizedupfrontfeeforbillingperiod',
  ],
  riUnusedRecurring: ['reservation_unused_recurring_fee', 'reservation/unusedrecurringfee'],
  tags: ['resource_tags'],
  productMap: ['product'],
} as const;

const optional = (row: CsvRow, columns: readonly string[], label: string): number =>
  parseAmount(pick(row, ...columns), label, 0);

function chargeCategory(lineType: string): ChargeCategory {
  switch (lineType) {
    case 'Usage':
    case 'DiscountedUsage':
    case 'SavingsPlanCoveredUsage':
    case 'SavingsPlanNegation':
      return 'Usage';
    case 'Fee':
    case 'RIFee':
    case 'SavingsPlanRecurringFee':
    case 'SavingsPlanUpfrontFee':
      return 'Purchase';
    case 'Tax':
      return 'Tax';
    case 'Credit':
    case 'Refund':
    case 'EdpDiscount':
    case 'BundledDiscount':
    case 'PrivateRateDiscount':
    case 'DistributorDiscount':
      return 'Credit';
    default:
      return 'Adjustment';
  }
}

function effectiveCost(row: CsvRow, lineType: string, unblended: number): number {
  switch (lineType) {
    case 'SavingsPlanCoveredUsage':
      return optional(row, COL.spEffective, 'savings_plan_effective_cost');
    case 'DiscountedUsage':
      return optional(row, COL.riEffective, 'reservation_effective_cost');
    case 'SavingsPlanNegation':
    case 'SavingsPlanUpfrontFee':
    case 'Fee':
      // Negação anula o on-demand coberto; upfront já está amortizado no uso coberto.
      return 0;
    case 'SavingsPlanRecurringFee':
      // Só a parte do compromisso que não foi usada é custo efetivo (desperdício de compromisso).
      return Math.max(
        0,
        optional(row, COL.spTotal, 'sp_total_commitment') - optional(row, COL.spUsed, 'sp_used_commitment'),
      );
    case 'RIFee':
      return (
        optional(row, COL.riUnusedUpfront, 'ri_unused_upfront') +
        optional(row, COL.riUnusedRecurring, 'ri_unused_recurring')
      );
    default:
      return unblended;
  }
}

function pricingCategory(lineType: string, usageType: string): PricingCategory {
  if (lineType === 'DiscountedUsage' || lineType === 'SavingsPlanCoveredUsage') return 'Committed';
  if (/SpotUsage/i.test(usageType)) return 'Dynamic';
  if (lineType === 'Usage') return 'Standard';
  return 'Other';
}

function tagsOf(row: CsvRow): Record<string, string> {
  const map = parseJsonObject(pick(row, ...COL.tags));
  const legacy: Record<string, string> = {};
  for (const [column, value] of Object.entries(row)) {
    if (column.startsWith('resourcetags/') && value) legacy[column] = value;
  }
  return normalizeTags({ ...map, ...legacy });
}

export function mapAwsCurRow(row: CsvRow): CostRecord | null {
  const date = normalizeDate(required(row, 'line_item_usage_start_date', ...COL.date));
  if (!date) throw new RowError('line_item_usage_start_date inválido');

  const lineType = required(row, 'line_item_line_item_type', ...COL.lineType);
  const usageType = pick(row, ...COL.usageType) ?? '';
  const billedCost = parseAmount(pick(row, ...COL.unblended), 'line_item_unblended_cost');
  const effective = effectiveCost(row, lineType, billedCost);
  if (billedCost === 0 && effective === 0) return null;

  const productCode = required(row, 'line_item_product_code', ...COL.product);
  const serviceName = pick(row, ...COL.productName) ?? awsServiceName(productCode);
  const productMap = parseJsonObject(pick(row, ...COL.productMap));
  const instanceType =
    pick(row, ...COL.instanceType) ?? (typeof productMap.instance_type === 'string' ? productMap.instance_type : null);
  const account = required(row, 'line_item_usage_account_id', ...COL.account);

  return {
    date,
    provider: 'aws',
    billingAccountId: pick(row, ...COL.payer) ?? account,
    subAccountId: account,
    serviceName,
    serviceCategory: classifyService('aws', productCode),
    region: (pick(row, ...COL.region) ?? 'global').toLowerCase(),
    resourceId: pick(row, ...COL.resource) ?? null,
    usageType: usageType === '' ? null : usageType,
    instanceType: instanceType && instanceType !== '' ? instanceType : null,
    chargeCategory: chargeCategory(lineType),
    pricingCategory: pricingCategory(lineType, usageType),
    billedCost,
    effectiveCost: effective,
    currency: (pick(row, ...COL.currency) ?? 'USD').toUpperCase(),
    tags: tagsOf(row),
  };
}
