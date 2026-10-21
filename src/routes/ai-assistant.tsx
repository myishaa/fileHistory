import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  BrainCircuit,
  ChartNoAxesCombined,
  CircleHelp,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/ai-assistant")({
  component: AiAssistantPage,
});

const monthlyPayments = [
  { month: "Apr", fy2526: 35, fy2627: 48, fy2728: 42 },
  { month: "May", fy2526: 42, fy2627: 56, fy2728: 51 },
  { month: "Jun", fy2526: 51, fy2627: 61, fy2728: 59 },
  { month: "Jul", fy2526: 46, fy2627: 73, fy2728: 64 },
  { month: "Aug", fy2526: 62, fy2627: 68, fy2728: 72 },
  { month: "Sep", fy2526: 57, fy2627: 81, fy2728: 75 },
  { month: "Oct", fy2526: 73, fy2627: 77, fy2728: 83 },
  { month: "Nov", fy2526: 66, fy2627: 89, fy2728: 86 },
  { month: "Dec", fy2526: 78, fy2627: 94, fy2728: 91 },
  { month: "Jan", fy2526: 84, fy2627: 102, fy2728: 98 },
  { month: "Feb", fy2526: 96, fy2627: 110, fy2728: 106 },
  { month: "Mar", fy2526: 118, fy2627: 126, fy2728: 119 },
];

const yearlyFinance = [
  { year: "2024-25", mer: 785, recorded: 742 },
  { year: "2025-26", mer: 862, recorded: 814 },
  { year: "2026-27", mer: 934, recorded: 801 },
];

const paymentMix = [
  { year: "2024-25", regular: 596, advance: 78, supplementary: 68 },
  { year: "2025-26", regular: 641, advance: 96, supplementary: 77 },
  { year: "2026-27", regular: 614, advance: 104, supplementary: 83 },
];

const chartColors = {
  mer: "var(--chart-color-1)",
  recorded: "var(--chart-color-2)",
  previous: "var(--chart-color-3)",
  current: "var(--chart-color-4)",
  next: "var(--chart-color-5)",
  advance: "var(--chart-color-2)",
  supplementary: "var(--chart-color-3)",
  regular: "var(--chart-color-1)",
};

function formatLakhs(value: number) {
  return `${value.toLocaleString("en-IN")} L`;
}

function AiAssistantPage() {
  const [paymentYears, setPaymentYears] = useState("all");
  const visiblePayments = useMemo(
    () => (paymentYears === "recent" ? monthlyPayments.slice(0, 9) : monthlyPayments),
    [paymentYears],
  );

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-5 lg:px-7">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-primary">
            <BrainCircuit className="size-4" />
            AI Assistant
          </div>
          <h1 className="text-2xl font-bold">Procurement insights</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Explore financial movement and procurement trends across years.
          </p>
        </div>
      </header>

      <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm text-foreground">
        <CircleHelp className="mt-0.5 size-4 shrink-0 text-amber-700" />
        <p><strong>UI preview:</strong> charts use illustrative sample figures only. They are not connected to live records or an AI service.</p>
      </div>

          <section className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
            <div>
              <h2 className="text-base font-semibold">Financial trends</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">Compare recorded outgo against plans and review how payment composition changes over time.</p>
            </div>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Payment trend range
              <select
                value={paymentYears}
                onChange={(event) => setPaymentYears(event.target.value)}
                className="h-9 min-w-48 rounded-md border border-input bg-background px-2.5 text-sm text-foreground"
              >
                <option value="all">Full FY view (Apr–Mar)</option>
                <option value="recent">Apr–Dec comparison</option>
              </select>
            </label>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <article className="min-w-0 rounded-md border border-border bg-card p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Monthly recorded payments by FY</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Same month compared across financial years · ₹ lakh</p>
                </div>
                <ChartNoAxesCombined className="size-4 shrink-0 text-primary" />
              </div>
              <div className="h-[285px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={visiblePayments} margin={{ top: 8, right: 12, left: 2, bottom: 2 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(value: number) => `${value}`} tickLine={false} axisLine={false} width={40} />
                    <Tooltip formatter={(value) => [formatLakhs(Number(value)), "Recorded payments"]} />
                    <Legend />
                    <Line type="monotone" dataKey="fy2526" name="FY 2025-26" stroke={chartColors.previous} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="fy2627" name="FY 2026-27" stroke={chartColors.current} strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="fy2728" name="FY 2027-28" stroke={chartColors.next} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="min-w-0 rounded-md border border-border bg-card p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">MER vs Recorded Payments</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Annual totals · ₹ lakh · Difference is MER minus Recorded Payments</p>
                </div>
                <ArrowUpRight className="size-4 shrink-0 text-primary" />
              </div>
              <div className="h-[285px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={yearlyFinance} margin={{ top: 8, right: 12, left: 2, bottom: 2 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="year" axisLine={{ stroke: "#94a3b8", strokeDasharray: "3 3" }} tickLine={{ stroke: "#94a3b8", strokeDasharray: "3 3" }} />
                    <YAxis allowDecimals={false} axisLine={{ stroke: "#94a3b8", strokeDasharray: "3 3" }} tickLine={{ stroke: "#94a3b8", strokeDasharray: "3 3" }} width={42} label={{ value: "Value (Lakhs)", angle: -90, position: "insideLeft" }} />
                    <Tooltip formatter={(value) => [formatLakhs(Number(value))]} />
                    <Legend />
                    <Bar dataKey="mer" name="MER" fill={chartColors.mer} radius={0} />
                    <Bar dataKey="recorded" name="Recorded Payments" fill={chartColors.recorded} radius={0} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="min-w-0 rounded-md border border-border bg-card p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold">Recorded payment composition</h3>
                <p className="mt-1 text-xs text-muted-foreground">Regular/stage, advance, and supplementary payments · ₹ lakh</p>
              </div>
              <div className="h-[255px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={paymentMix} margin={{ top: 8, right: 12, left: 2, bottom: 2 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="year" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} width={42} />
                    <Tooltip formatter={(value) => [formatLakhs(Number(value))]} />
                    <Legend />
                    <Area type="monotone" dataKey="regular" name="Regular / stage" stackId="1" stroke={chartColors.regular} fill={chartColors.regular} fillOpacity={0.72} />
                    <Area type="monotone" dataKey="advance" name="Advance" stackId="1" stroke={chartColors.advance} fill={chartColors.advance} fillOpacity={0.72} />
                    <Area type="monotone" dataKey="supplementary" name="Supplementary" stackId="1" stroke={chartColors.supplementary} fill={chartColors.supplementary} fillOpacity={0.72} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </article>

            <aside className="rounded-md border border-border bg-secondary/25 p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <h3 className="text-sm font-semibold">Insight preview</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Examples of observations an AI assistant could prepare from connected reports.</p>
              <ul className="mt-4 divide-y divide-border text-sm">
                <li className="flex gap-3 py-3 first:pt-0"><span className="mt-0.5 text-primary">01</span><span>Compare each month with the same month in earlier FYs to spot seasonal payment patterns.</span></li>
                <li className="flex gap-3 py-3"><span className="mt-0.5 text-primary">02</span><span>Highlight months where recorded payments are substantially above or below MER.</span></li>
                <li className="flex gap-3 py-3 last:pb-0"><span className="mt-0.5 text-primary">03</span><span>Separate regular, advance, and supplementary payments so changes in composition are visible.</span></li>
              </ul>
            </aside>
          </section>

          <section className="overflow-x-auto rounded-md border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Annual comparison</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Illustrative values shown in ₹ lakh</p>
            </div>
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead className="bg-secondary/30 text-left text-xs text-muted-foreground">
                <tr><th className="px-4 py-2.5 font-medium">Financial year</th><th className="px-4 py-2.5 text-right font-medium">MER</th><th className="px-4 py-2.5 text-right font-medium">Recorded Payments</th><th className="px-4 py-2.5 text-right font-medium">Difference</th></tr>
              </thead>
              <tbody>
                {yearlyFinance.map((row) => (
                  <tr key={row.year} className="border-t border-border/70">
                    <td className="px-4 py-2.5 font-medium">FY {row.year}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatLakhs(row.mer)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatLakhs(row.recorded)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatLakhs(row.mer - row.recorded)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
    </main>
  );
}
