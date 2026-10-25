import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCopyButton } from "@/components/table-chart-toggle";

export type SnapshotChartRow = {
  label: string;
  values: Record<string, number>;
  color?: string;
  source?: unknown;
};

export type SnapshotChartSeries = {
  key: string;
  label: string;
  color: string;
};

const SHORT_MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTH_LABEL_INDEX = new Map<string, number>([
  ["jan", 0],
  ["january", 0],
  ["feb", 1],
  ["february", 1],
  ["mar", 2],
  ["march", 2],
  ["apr", 3],
  ["april", 3],
  ["may", 4],
  ["jun", 5],
  ["june", 5],
  ["jul", 6],
  ["july", 6],
  ["aug", 7],
  ["august", 7],
  ["sep", 8],
  ["sept", 8],
  ["september", 8],
  ["oct", 9],
  ["october", 9],
  ["nov", 10],
  ["november", 10],
  ["dec", 11],
  ["december", 11],
]);

function getMonthNumber(label: string) {
  return MONTH_LABEL_INDEX.get(label.trim().toLowerCase()) ?? -1;
}

export function SnapshotChartRenderer({
  title,
  rows,
  series,
  kind,
  valueLabel,
  formatValue,
  stacked = false,
  height = 440,
  periodLabel,
  showValues = false,
  maxWidth,
  onPointClick,
}: {
  title?: string;
  rows: SnapshotChartRow[];
  series: SnapshotChartSeries[];
  kind: "line" | "bar" | "column" | "pie";
  valueLabel: string;
  formatValue?: (value: number, seriesKey: string) => ReactNode;
  stacked?: boolean;
  height?: number;
  periodLabel?: string;
  showValues?: boolean;
  maxWidth?: number;
  onPointClick?: (row: SnapshotChartRow, seriesKey: string) => void;
}) {
  const formatCategory = (label: string) => {
    const isoMatch = label.match(/^(\d{4})-(\d{2})$/);
    if (isoMatch) {
      const monthNumber = Number(isoMatch[2]);
      return monthNumber >= 1 && monthNumber <= 12
        ? SHORT_MONTH_LABELS[monthNumber - 1]
        : label;
    }
    const namedMatch = label.match(/^([A-Za-z]+)[- ]\d{4}$/);
    if (!namedMatch) return label;
    const monthNumber = getMonthNumber(namedMatch[1]);
    return monthNumber >= 0 ? SHORT_MONTH_LABELS[monthNumber] : label;
  };
  const categories = rows.map((row) => formatCategory(row.label));
  const monthly =
    categories.length > 0 &&
    categories.every((label) => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(label));
  const axisStyle = { fill: "#707078", fontSize: 12 };
  const axisStroke = { stroke: "#9ca3af", strokeWidth: 1 };
  const categoryLabel = monthly ? "Month" : "Category";
  const axisTitleStyle = {
    fill: "#707078",
    fontSize: 12,
  };
  const formatter = (value: number, name: string) =>
    formatValue?.(Number(value), series.find((item) => item.label === name)?.key ?? name) ??
    Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const formatTick = (value: number) =>
    Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const values = rows.flatMap((row) => series.map((item) => row.values[item.key] ?? 0));
  const hasPieValues = rows.some((row) => (row.values[series[0]?.key] ?? 0) > 0);
  const maximum = Math.max(
    0,
    ...values,
    ...rows.map((row) =>
      stacked ? series.reduce((sum, item) => sum + (row.values[item.key] ?? 0), 0) : 0,
    ),
  );
  const numericAxisScale = getNumericAxisScale(maximum, !values.every(Number.isInteger));
  const numericAxisWidth = Math.max(72, formatTick(numericAxisScale.maximum).length * 8 + 42);
  const categoryAxisWidth = Math.min(
    220,
    Math.max(90, ...categories.map((label) => label.length * 7 + 18)),
  );
  const plotHeight = kind === "bar" ? Math.max(height, rows.length * 42 + 70) : height;
  const fiscalYears = rows.flatMap((row) => {
    const iso = row.label.match(/^(\d{4})-(\d{2})$/);
    const named = row.label.match(/^([A-Za-z]+)[- ](\d{4})$/);
    const month = iso
      ? Number(iso[2])
      : named
        ? getMonthNumber(named[1]) + 1
        : 0;
    const year = Number(iso?.[1] ?? named?.[2]);
    if (!month || !year) return [];
    const start = month >= 4 ? year : year - 1;
    return [`${start}-${String(start + 1).slice(-2)}`];
  });
  const distinctYears = [...new Set(fiscalYears)];
  const fiscalYear =
    periodLabel?.replace(/^FY\s+/, "") ??
    (distinctYears.length === 1 ? distinctYears[0] : undefined);

  return (
    <div
      data-analytics-chart-renderer
      data-snapshot-chart-renderer
      data-chart-copy-area
      className="mx-auto w-full min-w-0 rounded-none border border-border bg-background p-4"
      style={maxWidth ? { maxWidth } : undefined}
    >
      <div className="mb-2 grid min-w-0 grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[1fr_2fr_1fr]">
        <span className="min-w-0 text-sm font-semibold text-muted-foreground">
          {fiscalYear ? `FY ${fiscalYear}` : ""}
        </span>
        <h3
          data-chart-copy-title
          className="col-span-2 row-start-2 min-w-0 break-words text-center text-base font-semibold text-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1"
        >
          {title ?? valueLabel}
        </h3>
        <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3">
          <ChartCopyButton />
        </div>
      </div>
      {series.length > 1 && kind !== "pie" ? (
        <div className="mb-2 flex flex-col items-start gap-y-1 text-xs text-muted-foreground">
          {series.map((item) => (
            <span key={item.key} className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-sm" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative w-full min-w-0 overflow-x-auto">
        <div
          style={{
            height: plotHeight,
            minWidth: Math.max(
              numericAxisWidth + 260,
              kind === "bar" || kind === "pie" ? 360 : rows.length * (monthly ? 42 : 55),
            ),
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            {kind === "pie" ? (
              <PieChart>
                <Tooltip
                  formatter={(value, name) => [formatter(Number(value), String(name)), name]}
                  contentStyle={{
                    background: "var(--background)",
                    borderColor: "var(--border)",
                    borderRadius: 6,
                  }}
                />
                <Pie
                  data={rows.map((row, index) => ({
                    label: row.label,
                    value: row.values[series[0]?.key] ?? 0,
                    __rowIndex: index,
                  })).filter((row) => row.value > 0)}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius="78%"
                  paddingAngle={1}
                  isAnimationActive={false}
                  onClick={(payload) => {
                    const row = rows[Number(payload.__rowIndex)];
                    if (row && onPointClick) onPointClick(row, series[0]?.key ?? "value");
                  }}
                  cursor={onPointClick ? "pointer" : undefined}
                >
                  {rows.filter((row) => (row.values[series[0]?.key] ?? 0) > 0).map((row, index) => (
                    <Cell key={`${row.label}-${index}`} fill={row.color ?? rowPalette[index % rowPalette.length]} />
                  ))}
                </Pie>
              </PieChart>
            ) : kind === "line" ? (
              <LineChart
                data={rows.map((row, index) => ({ label: categories[index], ...row.values }))}
                margin={{ top: 16, right: 20, bottom: 22, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                <XAxis
                  dataKey="label"
                  interval={0}
                  tick={{ ...axisStyle }}
                  tickLine={axisStroke}
                  axisLine={axisStroke}
                  tickSize={6}
                  tickMargin={8}
                  height={48}
                  label={{
                    value: categoryLabel,
                    position: "insideBottom",
                    offset: -8,
                    ...axisTitleStyle,
                  }}
                />
                <YAxis
                  width={numericAxisWidth}
                  domain={[0, numericAxisScale.maximum]}
                  ticks={numericAxisScale.ticks}
                  allowDecimals={!values.every(Number.isInteger)}
                  tick={{ ...axisStyle }}
                  tickLine={axisStroke}
                  axisLine={axisStroke}
                  tickSize={6}
                  tickMargin={8}
                  tickFormatter={(value) =>
                    Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })
                  }
                  label={{
                    value: valueLabel,
                    angle: -90,
                    position: "insideLeft",
                    offset: 8,
                    textAnchor: "middle",
                    verticalAnchor: "middle",
                    ...axisTitleStyle,
                  }}
                />
                <Tooltip
                  formatter={formatter}
                  contentStyle={{
                    background: "var(--background)",
                    borderColor: "var(--border)",
                    borderRadius: 6,
                  }}
                />
                {series.map((item) => (
                  <Line
                    key={item.key}
                    type="monotone"
                    dataKey={item.key}
                    name={item.label}
                    stroke={item.color}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            ) : (
              <BarChart
                data={rows.map((row, index) => ({
                  label: categories[index],
                  ...row.values,
                  __source: row,
                }))}
                layout={kind === "bar" ? "vertical" : "horizontal"}
                margin={{
                  top: 16,
                  right: 20,
                  bottom: 22,
                  left: 8,
                }}
                barCategoryGap="24%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                <XAxis
                  type={kind === "bar" ? "number" : "category"}
                  domain={kind === "bar" ? [0, numericAxisScale.maximum] : undefined}
                  ticks={kind === "bar" ? numericAxisScale.ticks : undefined}
                  allowDecimals={!values.every(Number.isInteger)}
                  dataKey={kind === "bar" ? undefined : "label"}
                  interval={kind === "bar" ? undefined : 0}
                  tick={{ ...axisStyle }}
                  tickLine={axisStroke}
                  axisLine={axisStroke}
                  tickSize={6}
                  tickMargin={8}
                  tickFormatter={
                    kind === "bar"
                      ? (value) =>
                          Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })
                      : undefined
                  }
                  angle={kind === "column" && !monthly ? -42 : 0}
                  textAnchor={kind === "column" && !monthly ? "end" : "middle"}
                  height={kind === "column" ? (monthly ? 48 : 86) : kind === "bar" ? 42 : 48}
                  label={{
                    value: kind === "bar" ? valueLabel : categoryLabel,
                    position: "insideBottom",
                    offset: -8,
                    ...axisTitleStyle,
                  }}
                />
                <YAxis
                  type={kind === "bar" ? "category" : "number"}
                  domain={kind === "bar" ? undefined : [0, numericAxisScale.maximum]}
                  ticks={kind === "bar" ? undefined : numericAxisScale.ticks}
                  allowDecimals={!values.every(Number.isInteger)}
                  dataKey={kind === "bar" ? "label" : undefined}
                  width={kind === "bar" ? categoryAxisWidth : numericAxisWidth}
                  interval={kind === "bar" ? 0 : undefined}
                  tick={{ ...axisStyle }}
                  tickLine={axisStroke}
                  axisLine={axisStroke}
                  tickSize={6}
                  tickMargin={8}
                  tickFormatter={
                    kind === "bar"
                      ? undefined
                      : (value) =>
                          Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })
                  }
                  label={
                    kind === "bar"
                      ? undefined
                      : {
                          value: valueLabel,
                          angle: -90,
                          position: "insideLeft",
                          offset: 8,
                          textAnchor: "middle",
                          verticalAnchor: "middle",
                          ...axisTitleStyle,
                        }
                  }
                />
                <Tooltip
                  formatter={formatter}
                  contentStyle={{
                    background: "var(--background)",
                    borderColor: "var(--border)",
                    borderRadius: 6,
                  }}
                />
                {series.map((item) => (
                  <Bar
                    key={item.key}
                    dataKey={item.key}
                    name={item.label}
                    fill={item.color}
                    stackId={stacked ? "shared-stack" : undefined}
                    maxBarSize={kind === "column" ? 28 : 24}
                    radius={0}
                    cursor={onPointClick ? "pointer" : undefined}
                    onClick={(payload, index) => {
                      const row = rows[index];
                      if (row && onPointClick) onPointClick(row, item.key);
                      void payload;
                    }}
                  >
                    {rows.map((row, index) => (
                      <Cell key={index} fill={row.color ?? item.color} />
                    ))}
                    {showValues && (!stacked || item.key === series[series.length - 1]?.key) ? (
                      <LabelList
                        dataKey={
                          stacked
                            ? (row: Record<string, number>) =>
                                series.reduce((sum, entry) => sum + (row[entry.key] ?? 0), 0)
                            : item.key
                        }
                        position={kind === "bar" ? "right" : "top"}
                        fill={stacked ? "currentColor" : item.color}
                        formatter={formatTick}
                      />
                    ) : null}
                  </Bar>
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
        {kind === "pie" && !hasPieValues ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            No values to chart.
          </div>
        ) : null}
      </div>
      {kind === "pie" ? (
        <div className="mt-3 flex flex-col items-start gap-y-1.5 text-xs text-muted-foreground">
          {rows.map((row, index) => (
            <span key={`${row.label}-${index}`} className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: row.color ?? rowPalette[index % rowPalette.length] }} />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="shrink-0 font-medium text-foreground">
                {formatter(row.values[series[0]?.key] ?? 0, series[0]?.label ?? "Value")}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const rowPalette = [
  "#0f766e",
  "#2563eb",
  "#d97706",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#4f46e5",
  "#ea580c",
  "#0d9488",
  "#c026d3",
  "#64748b",
];

function getNumericAxisScale(maximum: number, allowDecimals: boolean) {
  if (allowDecimals && maximum > 0) {
    const roughInterval = maximum / 5;
    const magnitude = 10 ** Math.floor(Math.log10(roughInterval));
    const normalized = roughInterval / magnitude;
    const multiplier = [1, 2, 2.5, 5, 10].find((value) => value >= normalized) ?? 10;
    const interval = multiplier * magnitude;
    const paddedMaximum = maximum + Math.max(maximum * 0.05, interval * 0.1);
    const axisMaximum = Math.ceil(paddedMaximum / interval) * interval;
    return {
      maximum: axisMaximum,
      ticks: Array.from({ length: Math.round(axisMaximum / interval) + 1 }, (_, index) =>
        Number((index * interval).toPrecision(12)),
      ),
    };
  }

  const interval = maximum < 25 ? 5 : Math.max(10, Math.ceil(maximum / 50) * 10);
  const paddedMaximum = maximum + Math.max(maximum * 0.05, interval * 0.1);
  const axisMaximum = Math.max(interval, Math.ceil(paddedMaximum / interval) * interval);
  return {
    maximum: axisMaximum,
    ticks: Array.from({ length: Math.round(axisMaximum / interval) + 1 }, (_, index) => index * interval),
  };
}
