import { parse } from 'csv-parse/sync';
import { validateCostRecord, type CostRecord } from '../domain/cost-record.js';
import { IngestError } from '../domain/errors.js';
import { mapAwsCurRow } from './aws-cur.js';
import { mapAzureRow } from './azure.js';
import { mapFocusRow } from './focus.js';
import { RowError, type CsvRow } from './row.js';

export { toFocusCsv, providerFromName } from './focus.js';

export const EXPORT_FORMATS = ['focus', 'aws-cur', 'azure-cost-details'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface RowIssue {
  /** Linha no arquivo (1 = cabeçalho). */
  line: number;
  message: string;
}

export interface IngestResult {
  format: ExportFormat;
  records: CostRecord[];
  rowsRead: number;
  /** Linhas ignoradas de propósito (custo zero). */
  rowsSkipped: number;
  errors: RowIssue[];
  /** Total de erros, mesmo quando a lista foi truncada. */
  errorCount: number;
}

export interface IngestOptions {
  format?: ExportFormat | 'auto';
  /** Máximo de erros guardados no relatório (o restante só é contado). */
  maxReportedErrors?: number;
  /** Proporção de linhas com erro que invalida o arquivo inteiro. */
  maxErrorRatio?: number;
}

const MAPPERS: Record<ExportFormat, (row: CsvRow) => CostRecord | null> = {
  focus: mapFocusRow,
  'aws-cur': mapAwsCurRow,
  'azure-cost-details': mapAzureRow,
};

export function detectFormat(headers: readonly string[]): ExportFormat | null {
  const set = new Set(headers);
  if (set.has('chargeperiodstart') && set.has('billedcost')) return 'focus';
  if (set.has('line_item_usage_start_date') || set.has('lineitem/usagestartdate')) return 'aws-cur';
  if (set.has('metercategory') && (set.has('costinbillingcurrency') || set.has('cost') || set.has('pretaxcost'))) {
    return 'azure-cost-details';
  }
  return null;
}

/**
 * Lê um export de billing (FOCUS, AWS CUR ou Azure Cost Details) e devolve registros canônicos.
 *
 * Erros de linha não interrompem a importação: são reportados com o número da linha. Mas se mais
 * de `maxErrorRatio` das linhas falharem, o arquivo é rejeitado inteiro: importar meio CUR geraria
 * uma queda falsa de custo, que é pior do que não importar.
 */
export function parseCostExport(content: string, options: IngestOptions = {}): IngestResult {
  const maxReported = options.maxReportedErrors ?? 50;
  const maxErrorRatio = options.maxErrorRatio ?? 0.05;

  let rows: CsvRow[];
  let headers: string[] = [];
  try {
    rows = parse(content, {
      bom: true,
      columns: (header: string[]) => {
        headers = header.map((h) => h.trim().toLowerCase());
        return headers;
      },
      skip_empty_lines: true,
      relax_column_count: false,
    }) as CsvRow[];
  } catch (error) {
    throw new IngestError(`CSV inválido: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (headers.length === 0) throw new IngestError('arquivo vazio');
  const format = options.format && options.format !== 'auto' ? options.format : detectFormat(headers);
  if (!format) {
    throw new IngestError(
      'formato não reconhecido: envie um export FOCUS 1.0, AWS CUR (legado ou 2.0) ou Azure Cost Details',
    );
  }

  const mapper = MAPPERS[format];
  const records: CostRecord[] = [];
  const errors: RowIssue[] = [];
  let errorCount = 0;
  let rowsSkipped = 0;

  rows.forEach((row, index) => {
    const line = index + 2;
    try {
      const record = mapper(row);
      if (record === null) {
        rowsSkipped++;
        return;
      }
      const problems = validateCostRecord(record);
      if (problems.length > 0) throw new RowError(problems.join('; '));
      records.push(record);
    } catch (error) {
      if (!(error instanceof RowError)) throw error;
      errorCount++;
      if (errors.length < maxReported) errors.push({ line, message: error.message });
    }
  });

  if (rows.length > 0 && errorCount / rows.length > maxErrorRatio) {
    const sample = errors
      .slice(0, 3)
      .map((e) => `linha ${e.line}: ${e.message}`)
      .join(' | ');
    throw new IngestError(`${errorCount} de ${rows.length} linhas com erro, arquivo rejeitado. Exemplos: ${sample}`);
  }

  return { format, records, rowsRead: rows.length, rowsSkipped, errors, errorCount };
}
