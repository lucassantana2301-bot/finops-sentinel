import { describe, expect, it } from 'vitest';
import { addDays, longDate, money, percent, shortDate, shortName } from './format';

const text = (value: string) => value.replace(/\u00a0/g, ' ');

describe('format', () => {
  it('formata moeda em pt-BR', () => {
    expect(text(money(1234.5, 'USD'))).toBe('US$ 1.234,50');
    expect(text(money(1234.5, 'BRL'))).toBe('R$ 1.234,50');
  });

  it('formata percentual com sinal só quando pedido e positivo', () => {
    expect(percent(0.078, { signed: true })).toBe('+7,8%');
    expect(percent(-0.05, { signed: true })).toBe('-5%');
    expect(percent(null)).toBe('—');
  });

  it('não desloca datas por fuso', () => {
    expect(shortDate('2026-11-01')).toBe('01/11');
    expect(longDate('2026-11-01')).toBe('01/11/2026');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('encurta IDs de recurso do Azure e ARNs', () => {
    expect(shortName('/subscriptions/x/resourcegroups/rg/providers/microsoft.compute/virtualmachines/vm-01')).toBe(
      'vm-01',
    );
    expect(shortName('arn:aws:rds:us-east-1:123:db:payments-prod')).toBe('payments-prod');
    expect(shortName('Amazon EC2')).toBe('Amazon EC2');
  });
});
