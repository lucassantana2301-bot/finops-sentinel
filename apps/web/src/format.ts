const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function money(value: number, currency: string, compact = false): string {
  const key = `${currency}|${compact}`;
  let formatter = moneyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      maximumFractionDigits: compact ? 1 : 2,
      ...(compact ? { notation: 'compact' as const } : {}),
    });
    moneyFormatters.set(key, formatter);
  }
  return formatter.format(value);
}

export function percent(fraction: number | null, options: { signed?: boolean; decimals?: number } = {}): string {
  if (fraction === null || !Number.isFinite(fraction)) return '—';
  const text = new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    maximumFractionDigits: options.decimals ?? 1,
  }).format(fraction);
  return options.signed && fraction > 0 ? `+${text}` : text;
}

/** "2026-11-12" → "12/11". Data em UTC: sem Date local para não voltar um dia no fuso de São Paulo. */
export function shortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}

export function longDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/** ID de recurso do Azure/ARN da AWS reduzidos ao nome final, para caber na tabela. */
export function shortName(key: string): string {
  if (key.startsWith('/subscriptions/')) return key.split('/').filter(Boolean).at(-1) ?? key;
  if (key.startsWith('arn:')) return key.split(/[:/]/).at(-1) ?? key;
  return key;
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
