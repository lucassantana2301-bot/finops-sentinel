import type { AlertEvent } from '../domain/alerts.js';
import type { CostRecord, Provider } from '../domain/cost-record.js';
import type { IsoDate, Period } from '../domain/dates.js';

/**
 * Lote de importação. Exports de billing são reemitidos várias vezes no mês (o CUR é reescrito a cada
 * atualização), então importar é "substituir o escopo": apaga o que existia do mesmo provedor/conta
 * pagadora no intervalo de datas do lote e grava o novo. Assim reimportar o mesmo arquivo é idempotente.
 */
export interface ImportBatch {
  records: readonly CostRecord[];
  scope: ReplaceScope[];
}

export interface ReplaceScope {
  provider: Provider;
  billingAccountId: string;
  period: Period;
}

export interface CostRepository {
  replace(batch: ImportBatch): Promise<{ inserted: number; removed: number }>;
  list(period: Period): Promise<CostRecord[]>;
  bounds(): Promise<{ from: IsoDate; to: IsoDate } | null>;
  currencies(): Promise<string[]>;
  count(): Promise<number>;
}

/** Fonte de dados conectada diretamente à nuvem (API de custo). */
export interface CostSource {
  readonly name: string;
  fetch(period: Period): Promise<CostRecord[]>;
}

export interface Notifier {
  readonly name: string;
  send(events: readonly AlertEvent[], context: { currency: string }): Promise<void>;
}

/** Memória dos alertas já enviados, para não repetir notificação a cada execução. */
export interface AlertStateStore {
  wasSent(dedupKey: string): Promise<boolean>;
  markSent(dedupKey: string, sentAt: Date): Promise<void>;
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}
