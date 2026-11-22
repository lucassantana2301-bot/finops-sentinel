import { describe, expect, it } from 'vitest';
import { generateDemoDataset, generateRecommendations, isWeekend, type RecommendationRule } from '../src/index.js';
import { record, series } from './helpers.js';

const PERIOD = { from: '2026-10-22', to: '2026-11-20' };

describe('recomendações sobre o dataset de demonstração', () => {
  const { recommendations, errors } = generateRecommendations(generateDemoDataset({ endDate: '2026-11-20' }), PERIOD);
  const byRule = (ruleId: string) => recommendations.filter((r) => r.ruleId === ruleId);

  it('encontra cada problema injetado no dataset', () => {
    expect(errors).toEqual([]);
    expect(
      byRule('commitment-coverage')
        .map((r) => r.provider)
        .sort(),
    ).toEqual(['aws', 'azure']);
    expect(byRule('nonprod-scheduling')).toHaveLength(1);
    expect(byRule('ebs-gp2-to-gp3')[0]!.resources).toHaveLength(2);
    expect(byRule('idle-public-ip')[0]!.confidence).toBe('high');
    expect(byRule('nat-gateway-data-processing')).toHaveLength(1);
    expect(byRule('untagged-spend')).toHaveLength(1);
    expect(
      byRule('previous-generation-instance')
        .map((r) => r.evidence.tipoAtual)
        .sort(),
    ).toEqual(['Standard_D4s_v3', 'c4.2xlarge', 't2.large']);
  });

  it('ordena por economia e deixa governança por último', () => {
    const savings = recommendations.filter((r) => r.category !== 'governance').map((r) => r.estimatedMonthlySavings);
    expect(savings).toEqual([...savings].sort((a, b) => b - a));
    expect(recommendations.at(-1)!.category).toBe('governance');
  });
});

describe('regras isoladas', () => {
  it('ambiente não produtivo já agendado não gera recomendação', () => {
    const scheduled = series('2026-10-22', 30, (date) => (isWeekend(date) ? 0.5 : 10), {
      tags: { env: 'dev', team: 'x' },
    });
    const { recommendations } = generateRecommendations(scheduled, PERIOD);
    expect(recommendations.find((r) => r.ruleId === 'nonprod-scheduling')).toBeUndefined();
  });

  it('compromisso usa o piso (p10), não a média: picos não viram compromisso ocioso', () => {
    const spiky = series('2026-10-22', 30, (_, i) => (i % 5 === 0 ? 500 : 20));
    const [rec] = generateRecommendations(spiky, PERIOD).recommendations.filter(
      (r) => r.ruleId === 'commitment-coverage',
    );
    expect(rec!.monthlyCost).toBeCloseTo(600);
  });

  it('pouco custo sem tag não gera alerta de governança', () => {
    const records = [
      record({ date: '2026-11-01', effectiveCost: 95 }),
      record({ date: '2026-11-01', effectiveCost: 5, tags: {} }),
    ];
    expect(
      generateRecommendations(records, PERIOD).recommendations.find((r) => r.ruleId === 'untagged-spend'),
    ).toBeUndefined();
  });

  it('uma regra com erro não derruba as demais', () => {
    const broken: RecommendationRule = {
      id: 'quebrada',
      evaluate: () => {
        throw new Error('boom');
      },
    };
    const result = generateRecommendations([], PERIOD, {}, [broken]);
    expect(result.errors).toEqual([{ ruleId: 'quebrada', message: 'boom' }]);
  });
});
