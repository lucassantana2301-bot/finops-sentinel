import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  addDays,
  assertIsoDate,
  DomainError,
  generateDemoDataset,
  InMemoryAlertStateStore,
  InMemoryCostRepository,
  isSeverity,
  parseCostExport,
  parseDimension,
  SentinelService,
  severityRank,
  toFocusCsv,
  type Budget,
} from '@fns/core';
import { collectReport, renderMarkdown } from './report.js';

export const HELP = `finops-sentinel: análise de custo de nuvem a partir de exports de billing

Uso:
  finops-sentinel report <arquivo.csv> [arquivo2.csv ...] [opções]
  finops-sentinel demo [--out demo.csv] [--days 90] [--end YYYY-MM-DD]

Formatos aceitos: FOCUS 1.0, AWS CUR (legado e 2.0), Azure Cost Details (detecção automática).

Opções do report:
  --from YYYY-MM-DD        início do período (padrão: 30 dias até o último dia com dado)
  --to YYYY-MM-DD          fim do período
  --group-by <dimensão>    service, provider, subAccount, region, resource ou tag:<chave> (padrão: service)
  --budget <valor>         orçamento mensal total, para avaliar o fechamento do mês
  --required-tags a,b      tags obrigatórias para a regra de governança (padrão: team,env)
  --format markdown|json   formato da saída (padrão: markdown)
  --fail-on <severidade>   sai com código 3 se houver anomalia de severidade >= low|medium|high|critical
  -h, --help               mostra esta ajuda

Códigos de saída: 0 ok, 1 erro, 2 uso inválido, 3 anomalia acima do limite (--fail-on).`;

export class UsageError extends Error {}

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
}

export const nodeIo: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, content) => writeFile(path, content, 'utf8'),
};

async function report(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      'group-by': { type: 'string', default: 'service' },
      budget: { type: 'string' },
      'required-tags': { type: 'string', default: 'team,env' },
      format: { type: 'string', default: 'markdown' },
      'fail-on': { type: 'string' },
    },
  });
  if (positionals.length === 0) throw new UsageError('informe ao menos um arquivo CSV');
  if (values.format !== 'markdown' && values.format !== 'json')
    throw new UsageError('--format deve ser markdown ou json');
  if (values['fail-on'] && !isSeverity(values['fail-on'])) throw new UsageError('--fail-on inválido');

  const budgets: Budget[] = [];
  if (values.budget !== undefined) {
    const amount = Number(values.budget);
    if (!Number.isFinite(amount) || amount <= 0) throw new UsageError('--budget deve ser um número positivo');
    budgets.push({ id: 'total', name: 'Total', amount });
  }

  const service = new SentinelService({
    repository: new InMemoryCostRepository(),
    alertState: new InMemoryAlertStateStore(),
    config: {
      budgets,
      recommendations: {
        requiredTags: values['required-tags']!.split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      },
    },
  });

  for (const file of positionals) {
    const result = parseCostExport(await io.readFile(file));
    await service.importRecords(result.records, file);
    io.stderr(`${file}: ${result.format}, ${result.records.length} registros, ${result.errorCount} erro(s)\n`);
    for (const issue of result.errors.slice(0, 5)) io.stderr(`  linha ${issue.line}: ${issue.message}\n`);
  }

  const data = await collectReport(service, {
    groupBy: parseDimension(values['group-by']!),
    ...(values.from ? { from: assertIsoDate(values.from, '--from') } : {}),
    ...(values.to ? { to: assertIsoDate(values.to, '--to') } : {}),
  });
  io.stdout(values.format === 'json' ? `${JSON.stringify(data, null, 2)}\n` : renderMarkdown(data));

  const failOn = values['fail-on'];
  if (
    failOn &&
    isSeverity(failOn) &&
    data.anomalies.items.some((a) => severityRank(a.severity) >= severityRank(failOn))
  ) {
    return 3;
  }
  return 0;
}

async function demo(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      out: { type: 'string' },
      days: { type: 'string', default: '90' },
      end: { type: 'string' },
    },
  });
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 7 || days > 730) throw new UsageError('--days deve ser inteiro entre 7 e 730');
  const endDate = values.end ? assertIsoDate(values.end, '--end') : addDays(new Date().toISOString().slice(0, 10), -2);
  const csv = toFocusCsv(generateDemoDataset({ days, endDate }));
  if (values.out) {
    await io.writeFile(values.out, csv);
    io.stderr(`dataset de demonstração salvo em ${values.out}\n`);
  } else io.stdout(csv);
  return 0;
}

export async function run(argv: string[], io: Io = nodeIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (!command || command === '-h' || command === '--help' || rest.includes('--help') || rest.includes('-h')) {
      io.stdout(`${HELP}\n`);
      return command ? 0 : 2;
    }
    if (command === 'report') return await report(rest, io);
    if (command === 'demo') return await demo(rest, io);
    throw new UsageError(`comando desconhecido: ${command}`);
  } catch (error) {
    if (
      error instanceof UsageError ||
      (error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS'))
    ) {
      io.stderr(`erro: ${error.message}\n\n${HELP}\n`);
      return 2;
    }
    if (error instanceof DomainError) {
      io.stderr(`erro: ${error.message}\n`);
      return 1;
    }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      io.stderr(`erro: arquivo não encontrado: ${(error as NodeJS.ErrnoException).path ?? ''}\n`);
      return 1;
    }
    throw error;
  }
}
