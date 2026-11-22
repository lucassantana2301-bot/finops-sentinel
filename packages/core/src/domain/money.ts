/**
 * Soma com compensação de Neumaier.
 *
 * Um mês de CUR tem centenas de milhares de linhas com custos de 10^-7 a 10^4. Somar ingenuamente em
 * float acumula erro; a compensação mantém o erro na ordem do último dígito sem precisar de decimal.js
 * (custo de nuvem é analítico, não contábil: não existe "centavo perdido" a conciliar).
 */
export function sum(values: Iterable<number>): number {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const next = total + value;
    compensation += Math.abs(total) >= Math.abs(value) ? total - next + value : value - next + total;
    total = next;
  }
  return total + compensation;
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  // Evita "-0" na serialização.
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Variação relativa segura: retorna null quando a base é zero (crescimento indefinido). */
export function relativeChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Desvio absoluto mediano (MAD), estimador de dispersão robusto a outliers. */
export function medianAbsoluteDeviation(values: readonly number[], center = median(values)): number {
  return median(values.map((v) => Math.abs(v - center)));
}

/** Percentil por interpolação linear (p entre 0 e 1). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(Math.max(p, 0), 1) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (rank - low);
}

export function formatMoney(value: number, currency: string, locale = 'pt-BR'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

export function formatPercent(fraction: number, decimals = 1, locale = 'pt-BR'): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: decimals }).format(fraction);
}
