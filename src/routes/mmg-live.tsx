import { createFileRoute } from "@tanstack/react-router";
import { Activity, BarChart3, IndianRupee, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/mmg-live")({
  component: MmgLivePage,
});

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

type MmgLiveOption = "status1" | "status2" | "finance";

type StatusFlowRow = {
  key: string;
  label: string;
  total?: number;
  active?: number;
  pending?: number;
  reviewed?: number;
  cleared?: number;
  liveBids?: number;
  liveSupplyOrders?: number;
  valid?: number;
  expired?: number;
  extended?: number;
  completed?: number;
  due?: number;
  overdue?: number;
};

type LiveStatusRow = {
  division: string;
  counts: Record<string, number>;
  total: number;
};

type FinanceTotals = {
  allocatedCapital: number;
  allocatedRevenue: number;
  bookedCapital: number;
  bookedRevenue: number;
  projectedCapital: number;
  projectedRevenue: number;
  spentCapital: number;
  spentRevenue: number;
};

type MmgLiveResponse = {
  live: {
    enabled: boolean;
    options: MmgLiveOption[];
    selectedYear: string;
    updatedAt: string;
    summary: {
      dashboardFileCount: number;
      statusFlow: StatusFlowRow[];
      liveStatusRows: LiveStatusRow[];
      visibleLiveMilestoneNames: string[];
      financeTotals: FinanceTotals;
    };
  };
};

function MmgLivePage() {
  const [data, setData] = useState<MmgLiveResponse["live"] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(undefined);
    fetch(`${API_BASE_URL}/api/live/mmg`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`MMG live request failed: ${response.status}`);
        return (await response.json()) as MmgLiveResponse;
      })
      .then((body) => setData(body.live))
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : "MMG live could not load."),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 300000);
    return () => window.clearInterval(interval);
  }, []);

  if (loading && !data) {
    return <LiveShell title="MMG live">Loading...</LiveShell>;
  }

  if (error) {
    return <LiveShell title="MMG live">{error}</LiveShell>;
  }

  if (!data?.enabled) {
    return <LiveShell title="MMG live">MMG live is not active.</LiveShell>;
  }

  return (
    <main className="min-h-screen bg-background px-4 py-5 text-foreground lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-semibold">MMG live</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Financial year {data.selectedYear} · {data.summary.dashboardFileCount} files
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
          >
            <RefreshCw className="size-4" />
            Refresh
          </button>
        </div>

        <div className="space-y-5">
          {data.options.includes("status1") ? (
            <LivePanel title="Status-1" icon={<Activity className="size-5" />}>
              <StatusOneTable rows={data.summary.statusFlow} />
            </LivePanel>
          ) : null}
          {data.options.includes("status2") ? (
            <LivePanel title="Status-2" icon={<BarChart3 className="size-5" />}>
              <StatusTwoTable
                rows={data.summary.liveStatusRows}
                milestones={data.summary.visibleLiveMilestoneNames}
              />
            </LivePanel>
          ) : null}
          {data.options.includes("finance") ? (
            <LivePanel title="Finance totals" icon={<IndianRupee className="size-5" />}>
              <FinanceGrid totals={data.summary.financeTotals} />
            </LivePanel>
          ) : null}
          {!data.options.length ? (
            <div className="rounded-md border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
              No MMG live options have been selected.
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function LiveShell({ title, children }: { title: string; children: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
      <div className="rounded-md border border-border bg-card p-5 text-center shadow-[var(--shadow-card)]">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{children}</p>
      </div>
    </main>
  );
}

function LivePanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function StatusOneTable({ rows }: { rows: StatusFlowRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead className="bg-secondary text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Milestone</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
            <th className="px-3 py-2 text-right font-medium">In process</th>
            <th className="px-3 py-2 text-right font-medium">Pending</th>
            <th className="px-3 py-2 text-right font-medium">Reviewed</th>
            <th className="px-3 py-2 text-right font-medium">Cleared</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/60 last:border-b-0">
              <td className="px-3 py-2 font-medium">{row.label}</td>
              <td className="px-3 py-2 text-right tabular-nums">{getStatusTotalCount(row)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {row.active ?? row.valid ?? row.due ?? 0}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {row.pending ?? row.expired ?? row.overdue ?? 0}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {row.reviewed ?? row.extended ?? 0}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {row.cleared ?? row.completed ?? 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getStatusTotalCount(row: StatusFlowRow) {
  if (row.total !== undefined) return row.total;
  if (row.valid !== undefined || row.expired !== undefined || row.extended !== undefined) {
    return (row.valid ?? 0) + (row.expired ?? 0) + (row.extended ?? 0);
  }
  return (row.completed ?? 0) + (row.due ?? 0) + (row.overdue ?? 0);
}

function StatusTwoTable({ rows, milestones }: { rows: LiveStatusRow[]; milestones: string[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead className="bg-secondary text-xs text-muted-foreground">
          <tr>
            <th className="sticky left-0 bg-secondary px-3 py-2 text-left font-medium">Division</th>
            {milestones.map((milestone) => (
              <th key={milestone} className="px-3 py-2 text-right font-medium">
                {milestone}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.division} className="border-b border-border/60 last:border-b-0">
              <td className="sticky left-0 bg-card px-3 py-2 font-medium">{row.division}</td>
              {milestones.map((milestone) => (
                <td key={milestone} className="px-3 py-2 text-right tabular-nums">
                  {row.counts[milestone] ?? 0}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FinanceGrid({ totals }: { totals: FinanceTotals }) {
  const rows = [
    ["Allocated", totals.allocatedCapital, totals.allocatedRevenue],
    ["Intended", totals.projectedCapital, totals.projectedRevenue],
    ["Booked", totals.bookedCapital, totals.bookedRevenue],
    ["Committed", totals.spentCapital, totals.spentRevenue],
  ] as const;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {rows.map(([label, capital, revenue]) => (
        <div key={label} className="rounded-md border border-border bg-background p-3">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="mt-2 text-sm">
            <div>Capital: {formatLakhs(capital)} L</div>
            <div>Revenue: {formatLakhs(revenue)} L</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatLakhs(value: number) {
  const lakhs = value / 100000;
  return lakhs.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
