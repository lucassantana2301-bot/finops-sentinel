import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AwsCostExplorerSource,
  AzureCostManagementSource,
  azureIdentityTokenProvider,
  SlackNotifier,
  WebhookNotifier,
} from '@fns/connectors';
import {
  generateDemoDataset,
  InMemoryAlertStateStore,
  InMemoryCostRepository,
  parseCostExport,
  SentinelService,
  type CostSource,
  type Logger,
  type Notifier,
  type Severity,
} from '@fns/core';
import type { AppConfig } from './config.js';

export interface Container {
  service: SentinelService;
  sources: CostSource[];
  /** Carrega dados iniciais (demo e/ou arquivos locais). */
  bootstrap(): Promise<void>;
  syncAll(): Promise<void>;
  config: AppConfig;
}

const MAX_FILE_BYTES = 500 * 1024 * 1024;

async function loadDataDir(service: SentinelService, dir: string, logger: Logger): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    logger.warn('DATA_DIR não encontrado, nada a importar', { dir });
    return;
  }
  for (const name of entries.filter((entry) => entry.toLowerCase().endsWith('.csv')).sort()) {
    const file = path.join(dir, name);
    const info = await stat(file);
    if (info.size > MAX_FILE_BYTES) {
      logger.warn('arquivo ignorado por tamanho', { file: name, bytes: info.size });
      continue;
    }
    const result = parseCostExport(await readFile(file, 'utf8'));
    await service.importRecords(result.records, `file:${name}`);
    if (result.errorCount > 0) logger.warn('linhas com erro na importação', { file: name, errors: result.errorCount });
  }
}

export async function createContainer(config: AppConfig, logger: Logger): Promise<Container> {
  const notifiers: Notifier[] = [];
  if (config.ALERT_SLACK_WEBHOOK_URL) notifiers.push(new SlackNotifier(config.ALERT_SLACK_WEBHOOK_URL));
  if (config.ALERT_WEBHOOK_URL) {
    notifiers.push(
      new WebhookNotifier(config.ALERT_WEBHOOK_URL, {
        ...(config.ALERT_WEBHOOK_SECRET ? { secret: config.ALERT_WEBHOOK_SECRET } : {}),
        allowInsecureLocalhost: config.NODE_ENV !== 'production',
      }),
    );
  }

  const service = new SentinelService({
    repository: new InMemoryCostRepository(),
    alertState: new InMemoryAlertStateStore(),
    notifiers,
    logger,
    config: {
      budgets: config.BUDGETS,
      recommendations: { requiredTags: config.REQUIRED_TAGS },
    },
  });

  const sources: CostSource[] = [];
  if (config.SOURCES.includes('aws')) {
    sources.push(new AwsCostExplorerSource({ payerAccountId: config.AWS_PAYER_ACCOUNT_ID! }));
  }
  if (config.SOURCES.includes('azure')) {
    sources.push(
      new AzureCostManagementSource({ scope: config.AZURE_SCOPE!, tokenProvider: await azureIdentityTokenProvider() }),
    );
  }

  const syncAll = async () => {
    // Fontes independentes: a queda de uma não impede a outra de atualizar.
    await Promise.all(
      sources.map(async (source) => {
        try {
          const summary = await service.syncSource(source, config.SYNC_DAYS);
          logger.info('sincronização concluída', { source: source.name, inserted: summary.inserted });
        } catch (error) {
          logger.error('sincronização falhou', {
            source: source.name,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
  };

  return {
    service,
    sources,
    config,
    syncAll,
    async bootstrap() {
      if (config.SOURCES.includes('demo')) {
        await service.importRecords(generateDemoDataset(), 'demo');
        logger.info('dataset de demonstração carregado');
      }
      if (config.SOURCES.includes('files')) await loadDataDir(service, config.DATA_DIR, logger);
      if (sources.length > 0) await syncAll();
    },
  };
}

export const alertSeverity = (config: AppConfig): Severity => config.ALERT_MIN_SEVERITY as Severity;
