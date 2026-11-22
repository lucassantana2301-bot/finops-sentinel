import type { AlertStateStore, CostRepository, ImportBatch } from '../application/ports.js';
import type { CostRecord } from '../domain/cost-record.js';
import { inPeriod, type IsoDate, type Period } from '../domain/dates.js';

/**
 * Repositório em memória, ordenado por data. Atende bem até alguns milhões de linhas agregadas por dia;
 * para histórico longo de CUR por recurso, implemente `CostRepository` sobre Postgres/ClickHouse.
 */
export class InMemoryCostRepository implements CostRepository {
  private records: CostRecord[] = [];

  async replace(batch: ImportBatch): Promise<{ inserted: number; removed: number }> {
    const before = this.records.length;
    const kept = this.records.filter(
      (record) =>
        !batch.scope.some(
          (scope) =>
            scope.provider === record.provider &&
            scope.billingAccountId === record.billingAccountId &&
            inPeriod(record.date, scope.period),
        ),
    );
    const removed = before - kept.length;
    this.records = [...kept, ...batch.records].sort((a, b) => a.date.localeCompare(b.date));
    return { inserted: batch.records.length, removed };
  }

  async list(period: Period): Promise<CostRecord[]> {
    return this.records.filter((record) => inPeriod(record.date, period));
  }

  async bounds(): Promise<{ from: IsoDate; to: IsoDate } | null> {
    if (this.records.length === 0) return null;
    return { from: this.records[0]!.date, to: this.records[this.records.length - 1]!.date };
  }

  async currencies(): Promise<string[]> {
    return [...new Set(this.records.map((record) => record.currency))].sort();
  }

  async count(): Promise<number> {
    return this.records.length;
  }
}

export class InMemoryAlertStateStore implements AlertStateStore {
  private readonly sent = new Map<string, Date>();

  async wasSent(dedupKey: string): Promise<boolean> {
    return this.sent.has(dedupKey);
  }

  async markSent(dedupKey: string, sentAt: Date): Promise<void> {
    this.sent.set(dedupKey, sentAt);
  }
}
