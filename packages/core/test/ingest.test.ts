import { describe, expect, it } from 'vitest';
import { generateDemoDataset, IngestError, parseCostExport, parseTagsField, toFocusCsv } from '../src/index.js';

const CUR2_HEADER =
  'line_item_usage_start_date,bill_payer_account_id,line_item_usage_account_id,line_item_product_code,product_region_code,line_item_resource_id,line_item_usage_type,product_instance_type,line_item_line_item_type,line_item_unblended_cost,line_item_currency_code,savings_plan_savings_plan_effective_cost,savings_plan_total_commitment_to_date,savings_plan_used_commitment,resource_tags';

describe('detecção e FOCUS', () => {
  it('faz ida e volta FOCUS sem perder informação', () => {
    const original = generateDemoDataset({ endDate: '2026-11-20', days: 10 });
    const parsed = parseCostExport(toFocusCsv(original));
    expect(parsed.format).toBe('focus');
    expect(parsed.errorCount).toBe(0);
    // A taxa do Savings Plan tem custo efetivo zero mas faturado positivo: precisa sobreviver.
    expect(parsed.records).toHaveLength(original.length);
    const first = parsed.records.find((r) => r.resourceId === original[0]!.resourceId)!;
    expect(first).toMatchObject({
      provider: original[0]!.provider,
      instanceType: original[0]!.instanceType,
      usageType: original[0]!.usageType,
      tags: original[0]!.tags,
    });
    expect(first.effectiveCost).toBeCloseTo(original[0]!.effectiveCost, 6);
  });

  it('rejeita formato desconhecido e CSV vazio', () => {
    expect(() => parseCostExport('a,b\n1,2\n')).toThrow(IngestError);
    expect(() => parseCostExport('')).toThrow(/vazio/);
  });

  it('reporta erros de linha com número e rejeita o arquivo se forem muitos', () => {
    const header =
      'ChargePeriodStart,ProviderName,BillingAccountId,ServiceName,BilledCost,EffectiveCost,BillingCurrency';
    const good = Array.from({ length: 99 }, () => '2026-11-01,AWS,1,Amazon S3,1.5,1.5,USD');
    const result = parseCostExport([header, ...good, '2026-11-01,AWS,1,Amazon S3,abc,1,USD'].join('\n'), {
      maxErrorRatio: 0.05,
    });
    expect(result.records).toHaveLength(99);
    expect(result.errors).toEqual([{ line: 101, message: expect.stringContaining('não numérico') }]);

    const bad = Array.from({ length: 10 }, () => '2026-11-01,AWS,1,Amazon S3,abc,1,USD');
    expect(() => parseCostExport([header, ...bad].join('\n'))).toThrow(/arquivo rejeitado/);
  });
});

describe('AWS CUR', () => {
  it('amortiza Savings Plan sem contar o mesmo dinheiro duas vezes', () => {
    const rows = [
      // Uso coberto: faturado 10 (on-demand), efetivo 6,5 (taxa do SP)
      '2026-11-01T00:00:00Z,900000000001,100000000001,AmazonEC2,us-east-1,i-1,USE1-BoxUsage:m5.xlarge,m5.xlarge,SavingsPlanCoveredUsage,10,USD,6.5,,,"{""user_team"":""pagamentos"",""user_env"":""prod""}"',
      // Negação anula o on-demand faturado
      '2026-11-01T00:00:00Z,900000000001,100000000001,AmazonEC2,us-east-1,i-1,USE1-BoxUsage:m5.xlarge,m5.xlarge,SavingsPlanNegation,-10,USD,,,,',
      // Taxa recorrente: 7 de compromisso, 6,5 usados -> 0,5 de desperdício efetivo
      '2026-11-01T00:00:00Z,900000000001,100000000001,ComputeSavingsPlans,,arn:sp,ComputeSP:1yrNoUpfront,,SavingsPlanRecurringFee,7,USD,,7,6.5,',
      '2026-11-01T00:00:00Z,900000000001,100000000001,AmazonEC2,us-east-1,i-2,USE1-SpotUsage:c5.large,c5.large,Usage,1.2,USD,,,,',
      '2026-11-01T00:00:00Z,900000000001,100000000001,AmazonEC2,us-east-1,,,,Tax,0.8,USD,,,,',
      '2026-11-01T00:00:00Z,900000000001,100000000001,AmazonS3,us-east-1,bucket,USE1-Requests,,Usage,0,USD,,,,',
    ];
    const result = parseCostExport([CUR2_HEADER, ...rows].join('\n'));
    expect(result.format).toBe('aws-cur');
    expect(result.rowsSkipped).toBe(1);

    const covered = result.records[0]!;
    expect(covered).toMatchObject({
      serviceName: 'Amazon EC2',
      serviceCategory: 'Compute',
      pricingCategory: 'Committed',
      instanceType: 'm5.xlarge',
      billedCost: 10,
      effectiveCost: 6.5,
      tags: { team: 'pagamentos', env: 'prod' },
    });
    const billed = result.records.reduce((acc, r) => acc + r.billedCost, 0);
    const effective = result.records.reduce((acc, r) => acc + r.effectiveCost, 0);
    expect(billed).toBeCloseTo(10 - 10 + 7 + 1.2 + 0.8);
    expect(effective).toBeCloseTo(6.5 + 0 + 0.5 + 1.2 + 0.8);
    expect(result.records[3]!.pricingCategory).toBe('Dynamic');
    expect(result.records[4]!.chargeCategory).toBe('Tax');
  });

  it('aceita o CUR legado com uma coluna por tag', () => {
    const csv = [
      'lineItem/UsageStartDate,lineItem/UsageAccountId,lineItem/ProductCode,lineItem/LineItemType,lineItem/UnblendedCost,lineItem/CurrencyCode,resourceTags/user:Team',
      '2026-11-01T00:00:00Z,100000000001,AmazonRDS,Usage,3.2,USD,dados',
    ].join('\n');
    const [record] = parseCostExport(csv).records;
    expect(record).toMatchObject({ serviceName: 'Amazon RDS', serviceCategory: 'Databases', tags: { team: 'dados' } });
  });
});

describe('Azure Cost Details', () => {
  it('lê datas americanas, tags sem chaves e tamanho da VM do AdditionalInfo', () => {
    const csv = [
      'Date,BillingAccountId,SubscriptionId,MeterCategory,MeterName,ResourceLocation,ResourceId,CostInBillingCurrency,BillingCurrency,PricingModel,ChargeType,Tags,AdditionalInfo',
      '11/05/2026,ea-1,A1B2,Virtual Machines,D4s v3,Brazil South,/subscriptions/A1B2/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-01,8.83,BRL,OnDemand,Usage,"""team"": ""portal"",""Env"": ""prod""","{""ServiceType"":""Standard_D4s_v3""}"',
      '11/05/2026,ea-1,A1B2,Virtual Machines,D4s v3,Brazil South,/subscriptions/A1B2/x,2,BRL,Reservation,UnusedReservation,,',
    ].join('\n');
    const result = parseCostExport(csv);
    expect(result.format).toBe('azure-cost-details');
    expect(result.records[0]).toMatchObject({
      date: '2026-11-05',
      provider: 'azure',
      region: 'brazilsouth',
      instanceType: 'Standard_D4s_v3',
      currency: 'BRL',
      serviceCategory: 'Compute',
      resourceId: '/subscriptions/a1b2/resourcegroups/rg/providers/microsoft.compute/virtualmachines/vm-01',
      tags: { team: 'portal', env: 'prod' },
    });
    expect(result.records[1]).toMatchObject({ pricingCategory: 'Committed', chargeCategory: 'Usage' });
  });
});

describe('tags', () => {
  it('não derruba a importação com tag corrompida', () => {
    expect(parseTagsField('{"team": "x"')).toEqual({});
    expect(parseTagsField('team=x;env=prod')).toEqual({ team: 'x', env: 'prod' });
    expect(parseTagsField('{"user:CostCenter": " cc-1 ", "vazia": ""}')).toEqual({ costcenter: 'cc-1' });
  });
});
