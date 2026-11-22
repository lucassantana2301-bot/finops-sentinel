/**
 * Paleta categórica (modo escuro) validada para daltonismo: ΔE CVD >= 8,4 entre vizinhos e
 * contraste >= 3:1 sobre a superfície.
 */
export const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c'] as const;
export const OTHERS_COLOR = '#6b6a65';
export const SURFACE = '#1a1a19';
export const GRID = '#2c2c2a';
export const AXIS = '#898781';

/**
 * A cor segue a entidade, não a posição no ranking: quem já tinha cor mantém a mesma quando o período
 * muda e outra série entra no top 6; só as novas pegam um slot livre, sempre na ordem fixa da paleta.
 */
export function assignColors(
  keys: readonly string[],
  previous: ReadonlyMap<string, string>,
  others = 'Outros',
): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const key of keys) {
    if (key === others) result.set(key, OTHERS_COLOR);
    else {
      const color = previous.get(key);
      if (color && !used.has(color)) {
        result.set(key, color);
        used.add(color);
      }
    }
  }
  for (const key of keys) {
    if (result.has(key)) continue;
    const color = SERIES_COLORS.find((candidate) => !used.has(candidate)) ?? OTHERS_COLOR;
    result.set(key, color);
    used.add(color);
  }
  return result;
}
