import { formatMoney, formatPercent, shortResourceName, type SentinelService } from '@fns/core';

const pct = (value: number | null) => (value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${formatPercent(value)}`);

const SEVERITY_LABEL = { low: 'baixa', medium: 'média', high: 'alta', critical: 'crítica' } as const;
const CONFIDENCE_LABEL = { low: 'baixa', medium: 'média', high: 'alta' } as const;
const DIMENSION_LABEL: Record<string, string> = {
  service: 'serviço',
  serviceCategory: 'categoria',
  provider: 'provedor',
  subAccount: 'conta',
  region: 'região',
  resource: 'recurso',
  pricingCategory: 'modelo de preço',
};
const dimensionLabel = (dimension: string) =>
  DIMENSION_LABEL[dimension] ?? (dimension.startsWith('tag:') ? `tag "${dimension.slice(4)}"` : dimension);
const STATUS_LABEL = { on_track: 'dentro', at_risk: 'em risco', over_budget: 'estourado' } as const;

/** Tabela Markdown com escape de pipe (nomes de recurso do Azure podem ter caracteres especiais). */
function table(headers: string[], rows: string[][]): string {
  const escape = (cell: string) => cell.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escape).join(' | ')} |`),
  ].join('\n');
}

export interface ReportData {
  summary: Awaited<ReturnType<SentinelService['summary']>>;
  forecast: Awaited<ReturnType<SentinelService['forecast']>>;
  anomalies: Awaited<ReturnType<SentinelService['anomalies']>>;
  recommendations: Awaited<ReturnType<SentinelService['recommendations']>>;
}

export async function collectReport(
  service: SentinelService,
  options: { from?: string; to?: string; groupBy: Parameters<SentinelService['summary']>[0]['dimension'] },
): Promise<ReportData> {
  const period = { ...(options.from ? { from: options.from } : {}), ...(options.to ? { to: options.to } : {}) };
  const [summary, forecast, anomalies, recommendations] = await Promise.all([
    service.summary({ ...period, dimension: options.groupBy, limit: 10 }),
    service.forecast(),
    service.anomalies(period),
    service.recommendations(),
  ]);
  return { summary, forecast, anomalies, recommendations };
}

export function renderMarkdown(data: ReportData): string {
  const { summary, forecast, anomalies, recommendations } = data;
  const money = (value: number) => formatMoney(value, summary.currency);
  const lines: string[] = [];

  lines.push(`# Relatório FinOps: ${summary.period.from} a ${summary.period.to}`, '');
  lines.push(
    `**Custo efetivo:** ${money(summary.total)} (${pct(summary.change)} vs. ${summary.previousPeriod.from} a ${summary.previousPeriod.to})  `,
  );
  lines.push(
    `**Previsão de ${forecast.forecast.month}:** ${money(forecast.forecast.forecast)} (faixa ${money(forecast.forecast.forecastLow)} a ${money(forecast.forecast.forecastHigh)}, confiança ${CONFIDENCE_LABEL[forecast.forecast.confidence]})  `,
  );
  lines.push(
    `**Economia potencial:** ${money(recommendations.totalMonthlySavings)}/mês em ${recommendations.items.length} recomendação(ões)`,
    '',
  );

  lines.push(`## Maiores custos por ${dimensionLabel(summary.dimension)}`, '');
  lines.push(
    table(
      ['Item', 'Custo', '%'],
      summary.items.map((item) => [shortResourceName(item.key), money(item.cost), formatPercent(item.share)]),
    ),
    '',
  );

  if (forecast.budgets.length > 0) {
    lines.push('## Orçamentos', '');
    lines.push(
      table(
        ['Orçamento', 'Valor', 'Realizado', 'Previsão', 'Situação'],
        forecast.budgets.map((b) => [
          b.budget.name,
          money(b.budget.amount),
          `${money(b.forecast.actualToDate)} (${formatPercent(b.actualUtilization, 0)})`,
          `${money(b.forecast.forecast)} (${formatPercent(b.forecastUtilization, 0)})`,
          STATUS_LABEL[b.status],
        ]),
      ),
      '',
    );
  }

  lines.push(`## Anomalias (${anomalies.items.length})`, '');
  if (anomalies.items.length === 0) lines.push('Nenhuma anomalia no período.', '');
  else {
    lines.push(
      table(
        ['Data', 'Item', 'Real', 'Esperado', 'Impacto', 'Severidade', 'Principal causa'],
        anomalies.items.map((a) => [
          a.date,
          shortResourceName(a.key),
          money(a.actual),
          money(a.expected),
          `+${money(a.impact)}`,
          SEVERITY_LABEL[a.severity],
          a.drivers[0] ? shortResourceName(a.drivers[0].key) : '-',
        ]),
      ),
      '',
    );
  }

  lines.push('## Recomendações', '');
  if (recommendations.items.length === 0) lines.push('Nenhuma recomendação.', '');
  recommendations.items.forEach((r, i) => {
    const savings = r.estimatedMonthlySavings > 0 ? ` (economia estimada ${money(r.estimatedMonthlySavings)}/mês)` : '';
    lines.push(`${i + 1}. **${r.title}**${savings}  `);
    lines.push(`   ${r.description}  `);
    lines.push(`   _Ação:_ ${r.action}`);
  });
  lines.push('');
  return lines.join('\n');
}
