import { describe, expect, it } from 'vitest';
import { assignColors, OTHERS_COLOR, SERIES_COLORS } from './theme';

describe('assignColors', () => {
  it('atribui na ordem fixa da paleta e reserva cinza para "Outros"', () => {
    const colors = assignColors(['EC2', 'RDS', 'Outros'], new Map());
    expect(colors.get('EC2')).toBe(SERIES_COLORS[0]);
    expect(colors.get('RDS')).toBe(SERIES_COLORS[1]);
    expect(colors.get('Outros')).toBe(OTHERS_COLOR);
  });

  it('mantém a cor de quem continua visível quando o ranking muda', () => {
    const first = assignColors(['EC2', 'RDS', 'S3'], new Map());
    const second = assignColors(['RDS', 'Lambda', 'EC2'], first);
    expect(second.get('EC2')).toBe(first.get('EC2'));
    expect(second.get('RDS')).toBe(first.get('RDS'));
    expect(second.get('Lambda')).toBe(SERIES_COLORS[2]);
  });
});
