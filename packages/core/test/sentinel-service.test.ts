import { describe, expect, it, vi } from 'vitest';
import {
  DomainError,
  InMemoryAlertStateStore,
  InMemoryCostRepository,
  SentinelService,
  type Notifier,
} from '../src/index.js';
import { record, series } from './helpers.js';

function makeService(notifiers: Notifier[] = [], budgets = [{ id: 'total', name: 'Total', amount: 1000 }]) {
  return new SentinelService({
    repository: new InMemoryCostRepository(),
    alertState: new InMemoryAlertStateStore(),
    notifiers,
    config: { budgets },
    now: () => new Date('2026-11-21T12:00:00Z'),
  });
}

describe('SentinelService', () => {
  it('reimportar o mesmo export é idempotente (substitui o escopo)', async () => {
    const service = makeService();
    const data = series('2026-11-01', 10, () => 10);
    await service.importRecords(data, 'cur');
    const second = await service.importRecords(data, 'cur');
    expect(second).toMatchObject({ inserted: 10, removed: 10 });
    expect((await service.summary({ dimension: 'service' })).total).toBe(100);
  });

  it('importar outra conta pagadora não apaga a primeira', async () => {
    const service = makeService();
    await service.importRecords(
      series('2026-11-01', 10, () => 10),
      'a',
    );
    await service.importRecords(
      series('2026-11-01', 10, () => 5, { billingAccountId: 'outra' }),
      'b',
    );
    expect((await service.summary({ dimension: 'service' })).total).toBe(150);
  });

  it('recusa misturar moedas', async () => {
    const service = makeService();
    await service.importRecords([record()], 'usd');
    await expect(service.importRecords([record({ currency: 'BRL', billingAccountId: 'br' })], 'brl')).rejects.toThrow(
      /moedas diferentes/,
    );
  });

  it('período padrão termina no último dia com dado, não em hoje', async () => {
    const service = makeService();
    await service.importRecords(
      series('2026-10-01', 40, () => 10),
      'x',
    );
    expect(await service.resolvePeriod()).toEqual({ from: '2026-10-11', to: '2026-11-09' });
    await expect(service.resolvePeriod({ from: '2026-11-09', to: '2026-11-01' })).rejects.toThrow(DomainError);
  });

  it('sem dados, consultas falham com NO_DATA', async () => {
    await expect(makeService().summary({ dimension: 'service' })).rejects.toMatchObject({ code: 'NO_DATA' });
  });

  it('não reenvia o mesmo alerta e reenvia quando o canal falhou', async () => {
    const send = vi.fn<Notifier['send']>().mockRejectedValueOnce(new Error('fora do ar')).mockResolvedValue(undefined);
    const service = makeService([{ name: 'fake', send }]);
    await service.importRecords(
      series('2026-10-01', 50, () => 100),
      'x',
    );

    const failed = await service.runAlerts({ minSeverity: 'low' });
    expect(failed).toMatchObject({ sent: 0, failures: [{ notifier: 'fake', message: 'fora do ar' }] });

    const retried = await service.runAlerts({ minSeverity: 'low' });
    expect(retried.sent).toBeGreaterThan(0);

    const again = await service.runAlerts({ minSeverity: 'low' });
    expect(again).toMatchObject({ sent: 0, skippedDuplicates: retried.sent });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('dry run não envia nem marca como enviado', async () => {
    const send = vi.fn<Notifier['send']>().mockResolvedValue(undefined);
    const service = makeService([{ name: 'fake', send }]);
    await service.importRecords(
      series('2026-10-01', 50, () => 100),
      'x',
    );
    const dry = await service.runAlerts({ minSeverity: 'low', dryRun: true });
    expect(dry.events.length).toBeGreaterThan(0);
    expect(send).not.toHaveBeenCalled();
    expect((await service.runAlerts({ minSeverity: 'low' })).sent).toBe(dry.events.length);
  });

  it('rejeita orçamentos duplicados na configuração', () => {
    expect(() =>
      makeService(
        [],
        [
          { id: 'a', name: 'A', amount: 1 },
          { id: 'a', name: 'B', amount: 2 },
        ],
      ),
    ).toThrow(/duplicado/);
  });
});
