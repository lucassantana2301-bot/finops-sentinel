/** Linha do CSV com cabeçalhos já normalizados para minúsculas. */
export type CsvRow = Readonly<Record<string, string | undefined>>;

/** Erro de uma linha específica; a importação continua e o erro vai para o relatório. */
export class RowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RowError';
  }
}

/** Primeiro valor não vazio entre os aliases de coluna (exports mudam de nome entre versões). */
export function pick(row: CsvRow, ...columns: string[]): string | undefined {
  for (const column of columns) {
    const value = row[column];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return undefined;
}

export function required(row: CsvRow, label: string, ...columns: string[]): string {
  const value = pick(row, ...columns);
  if (value === undefined) throw new RowError(`coluna obrigatória vazia: ${label}`);
  return value;
}

/**
 * Converte número dos exports. Aceita notação científica (o CUR usa 1.2E-7) e rejeita qualquer
 * coisa ambígua: vírgula decimal num export em inglês indica arquivo corrompido ou reprocessado.
 */
export function parseAmount(raw: string | undefined, label: string, fallback?: number): number {
  if (raw === undefined || raw.trim() === '') {
    if (fallback !== undefined) return fallback;
    throw new RowError(`valor vazio em ${label}`);
  }
  const value = raw.trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value))
    throw new RowError(`valor não numérico em ${label}: "${value}"`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new RowError(`valor fora do intervalo em ${label}`);
  return parsed;
}

export function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw || raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
