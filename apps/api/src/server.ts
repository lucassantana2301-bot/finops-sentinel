import type { Logger } from '@fns/core';
import { loadConfig } from './config.js';
import { alertSeverity, createContainer } from './container.js';
import { buildApp } from './http/app.js';
import { IntervalJob } from './scheduler.js';

async function main(): Promise<void> {
  const config = loadConfig();
  // Logger provisório até o Fastify subir (erros de configuração precisam aparecer).
  const bootLogger: Logger = {
    info: (message, data) => console.log(JSON.stringify({ level: 'info', message, ...data })),
    warn: (message, data) => console.warn(JSON.stringify({ level: 'warn', message, ...data })),
    error: (message, data) => console.error(JSON.stringify({ level: 'error', message, ...data })),
  };

  // O serviço recebe um logger que delega: começa no provisório e passa para o pino do Fastify.
  let target = bootLogger;
  const logger: Logger = {
    info: (message, data) => target.info(message, data),
    warn: (message, data) => target.warn(message, data),
    error: (message, data) => target.error(message, data),
  };

  const container = await createContainer(config, logger);
  const app = await buildApp({ container });
  target = {
    info: (message, data) => app.log.info(data ?? {}, message),
    warn: (message, data) => app.log.warn(data ?? {}, message),
    error: (message, data) => app.log.error(data ?? {}, message),
  };

  await container.bootstrap();

  const jobs = [
    new IntervalJob('sync', config.SYNC_INTERVAL_MINUTES * 60_000, () => container.syncAll(), logger),
    new IntervalJob(
      'alerts',
      config.ALERT_INTERVAL_MINUTES * 60_000,
      async () => {
        const result = await container.service.runAlerts({ minSeverity: alertSeverity(config) });
        if (result.sent > 0 || result.failures.length > 0)
          logger.info('alertas processados', { ...result, events: undefined });
      },
      logger,
    ),
  ];
  if (container.sources.length > 0) jobs[0]!.start();
  jobs[1]!.start();

  await app.listen({ host: config.HOST, port: config.PORT });

  const shutdown = async (signal: string) => {
    logger.info('encerrando', { signal });
    jobs.forEach((job) => job.stop());
    // Para de aceitar conexões e espera as requisições em andamento terminarem.
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ level: 'fatal', message: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
