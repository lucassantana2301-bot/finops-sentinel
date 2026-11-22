import type { Logger } from '@fns/core';

/**
 * Job periódico simples, sem sobreposição: se uma execução demorar mais que o intervalo, a próxima
 * é pulada em vez de empilhar. Para várias réplicas da API, rode os jobs em um só lugar
 * (CronJob do Kubernetes chamando POST /api/v1/alerts/run) para não duplicar alertas.
 */
export class IntervalJob {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly name: string,
    private readonly intervalMs: number,
    private readonly task: () => Promise<unknown>,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.intervalMs <= 0 || this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('execução anterior ainda em andamento, pulando', { job: this.name });
      return;
    }
    this.running = true;
    try {
      await this.task();
    } catch (error) {
      this.logger.error('job falhou', {
        job: this.name,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.running = false;
    }
  }
}
