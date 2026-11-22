import { useMemo, useRef } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { Timeseries } from '../api';
import { longDate, money, shortDate, shortName } from '../format';
import { assignColors, AXIS, GRID, SURFACE } from '../theme';

interface Props {
  data: Timeseries;
  groupLabel: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  currency,
  colors,
}: TooltipContentProps<number, string> & { currency: string; colors: ReadonlyMap<string, string> }) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((acc, item) => acc + (typeof item.value === 'number' ? item.value : 0), 0);
  return (
    <div className="chart-tooltip">
      <strong>{longDate(String(label))}</strong>
      <ul>
        {[...payload].reverse().map((item) => (
          <li key={String(item.dataKey)}>
            <span className="swatch" style={{ background: colors.get(String(item.dataKey)) }} aria-hidden="true" />
            <span className="tooltip-name">{shortName(String(item.name))}</span>
            <span className="tooltip-value">{money(Number(item.value), currency)}</span>
          </li>
        ))}
      </ul>
      <p className="tooltip-total">
        Total <span>{money(total, currency)}</span>
      </p>
    </div>
  );
}

export function CostChart({ data, groupLabel }: Props) {
  const rows = useMemo(() => data.points.map((point) => ({ date: point.date, ...point.values })), [data.points]);
  const registry = useRef<Map<string, string>>(new Map());
  const colors = useMemo(() => {
    const next = assignColors(data.keys, registry.current);
    registry.current = new Map([...registry.current, ...next]);
    return next;
  }, [data.keys]);

  return (
    <section className="panel" aria-labelledby="chart-title">
      <header className="panel-header">
        <h2 id="chart-title">Custo diário por {groupLabel}</h2>
        <ul className="legend" aria-label="Legenda">
          {data.keys.map((key) => (
            <li key={key}>
              <span className="swatch" style={{ background: colors.get(key) }} aria-hidden="true" />
              {shortName(key)}
            </li>
          ))}
        </ul>
      </header>
      <div className="chart" role="img" aria-label={`Gráfico de área empilhada do custo diário por ${groupLabel}`}>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              stroke={AXIS}
              tick={{ fill: AXIS, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(value: number) => money(value, data.currency, true)}
              stroke={AXIS}
              tick={{ fill: AXIS, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <Tooltip
              content={(props) => (
                <ChartTooltip
                  {...(props as TooltipContentProps<number, string>)}
                  currency={data.currency}
                  colors={colors}
                />
              )}
              cursor={{ stroke: AXIS, strokeDasharray: '3 3' }}
            />
            {data.keys.map((key) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                name={key}
                stackId="cost"
                fill={colors.get(key)}
                fillOpacity={0.85}
                // Traço da cor da superfície separa as camadas sem depender só da cor.
                stroke={SURFACE}
                strokeWidth={1.5}
                activeDot={{ r: 3, fill: colors.get(key), stroke: SURFACE, strokeWidth: 1.5 }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
