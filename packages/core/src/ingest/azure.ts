import { parseTagsField, type ChargeCategory, type CostRecord, type PricingCategory } from '../domain/cost-record.js';
import { normalizeDate } from '../domain/dates.js';
import { classifyService } from '../domain/service-catalog.js';
import { parseAmount, parseJsonObject, pick, required, RowError, type CsvRow } from './row.js';

/**
 * Azure Cost Management, export "Cost and usage details" (EA e MCA).
 *
 * Esse export traz um único valor de custo por linha: o "Actual cost" é faturado e o "Amortized cost"
 * é efetivo. Como não dá para saber pelo arquivo qual dos dois foi exportado, o mesmo valor vai para
 * as duas métricas. Para ter as duas separadas, prefira o export FOCUS do próprio Azure.
 */

function chargeCategory(chargeType: string): ChargeCategory {
  switch (chargeType.toLowerCase()) {
    case 'usage':
    case 'unusedreservation':
    case 'unusedsavingsplan':
      return 'Usage';
    case 'purchase':
      return 'Purchase';
    case 'refund':
      return 'Credit';
    case 'tax':
      return 'Tax';
    default:
      return 'Adjustment';
  }
}

function pricingCategory(pricingModel: string, chargeType: string): PricingCategory {
  switch (pricingModel.toLowerCase().replace(/\s/g, '')) {
    case 'reservation':
    case 'savingsplan':
      return 'Committed';
    case 'spot':
      return 'Dynamic';
    case 'ondemand':
    case '':
      return chargeType.toLowerCase() === 'usage' ? 'Standard' : 'Other';
    default:
      return 'Other';
  }
}

export function mapAzureRow(row: CsvRow): CostRecord | null {
  const date = normalizeDate(required(row, 'Date', 'date', 'usagedatetime'));
  if (!date) throw new RowError('Date inválido');

  const cost = parseAmount(pick(row, 'costinbillingcurrency', 'cost', 'pretaxcost'), 'CostInBillingCurrency');
  if (cost === 0) return null;

  const subscription = required(row, 'SubscriptionId', 'subscriptionid', 'subscriptionguid');
  const serviceName = required(row, 'MeterCategory', 'metercategory', 'servicename', 'consumedservice');
  const chargeType = pick(row, 'chargetype') ?? 'Usage';
  const info = parseJsonObject(pick(row, 'additionalinfo'));
  const vmSize =
    typeof info.ServiceType === 'string' ? info.ServiceType : typeof info.VMSize === 'string' ? info.VMSize : null;

  return {
    date,
    provider: 'azure',
    billingAccountId: pick(row, 'billingaccountid', 'billingaccountname') ?? subscription,
    subAccountId: subscription,
    serviceName,
    serviceCategory: classifyService('azure', serviceName),
    region: (pick(row, 'resourcelocation', 'location') ?? 'global').toLowerCase().replace(/\s+/g, ''),
    resourceId: pick(row, 'resourceid', 'instanceid')?.toLowerCase() ?? null,
    usageType: pick(row, 'metername', 'metersubcategory') ?? null,
    instanceType: pick(row, 'armskuname') ?? vmSize,
    chargeCategory: chargeCategory(chargeType),
    pricingCategory: pricingCategory(pick(row, 'pricingmodel') ?? '', chargeType),
    billedCost: cost,
    effectiveCost: cost,
    currency: (pick(row, 'billingcurrency', 'billingcurrencycode', 'currency') ?? 'USD').toUpperCase(),
    tags: parseTagsField(pick(row, 'tags')),
  };
}
