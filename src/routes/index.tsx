import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { type FileRecord, useAccessibleDivisions, useAccessibleFiles } from "@/lib/files-store";
import { BadgeIndianRupee, CheckCircle2, ClipboardList, FileText, Layers3 } from "lucide-react";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/search" });
  },
});

export function Dashboard() {
  const files = useAccessibleFiles();
  const divisions = useAccessibleDivisions();
  const navigate = useNavigate();
  const [selectedDivision, setSelectedDivision] = useState("all");
  const selectedDivisionIsAccessible =
    selectedDivision === "all" || divisions.some((division) => division.name === selectedDivision);
  const activeDivision = selectedDivisionIsAccessible ? selectedDivision : "all";
  const dashboardFiles = useMemo(
    () =>
      activeDivision === "all" ? files : files.filter((file) => file.division === activeDivision),
    [activeDivision, files],
  );
  const dashboardDivisions = useMemo(
    () =>
      activeDivision === "all"
        ? divisions
        : divisions.filter((division) => division.name === activeDivision),
    [activeDivision, divisions],
  );

  const modeCounts = getModeCounts(dashboardFiles);
  const workflowStatusGroups = getWorkflowStatusGroups(dashboardFiles);
  const financeTotals = {
    allocatedCapital: dashboardDivisions.reduce(
      (sum, division) => sum + (parseAmount(division.allocatedCapital) ?? 0),
      0,
    ),
    allocatedRevenue: dashboardDivisions.reduce(
      (sum, division) => sum + (parseAmount(division.allocatedRevenue) ?? 0),
      0,
    ),
    bookedCapital: dashboardFiles.reduce(
      (sum, file) =>
        sum + (hasAmount(file.soValueCapital) ? 0 : (parseAmount(file.valueCapital) ?? 0)),
      0,
    ),
    bookedRevenue: dashboardFiles.reduce(
      (sum, file) =>
        sum + (hasAmount(file.soValueRevenue) ? 0 : (parseAmount(file.valueRevenue) ?? 0)),
      0,
    ),
    spentCapital: dashboardFiles.reduce(
      (sum, file) => sum + (parseAmount(file.soValueCapital) ?? 0),
      0,
    ),
    spentRevenue: dashboardFiles.reduce(
      (sum, file) => sum + (parseAmount(file.soValueRevenue) ?? 0),
      0,
    ),
  };
  const capitalBookedPercent = getPercent(
    financeTotals.bookedCapital,
    financeTotals.allocatedCapital,
  );
  const revenueBookedPercent = getPercent(
    financeTotals.bookedRevenue,
    financeTotals.allocatedRevenue,
  );
  const capitalSpentPercent = getPercent(
    financeTotals.spentCapital,
    financeTotals.allocatedCapital,
  );
  const revenueSpentPercent = getPercent(
    financeTotals.spentRevenue,
    financeTotals.allocatedRevenue,
  );

  const summaryStats = [
    {
      label: "Total files",
      value: dashboardFiles.length,
      icon: FileText,
      hint: "All files added",
      tone: "primary",
      searchFilter: "totalFiles",
    },
    {
      label: "Demands controlled",
      value: dashboardFiles.filter((file) => hasFilledField(file, "imms")).length,
      icon: ClipboardList,
      hint: "IMMS number filled",
      tone: "accent",
      searchFilter: "demandsControlled",
    },
    {
      label: "TCEC files",
      value: dashboardFiles.filter((file) => isYes(file.tcec)).length,
      icon: CheckCircle2,
      hint: "TCEC marked Yes",
      tone: "success",
      searchFilter: "tcecFiles",
    },
    {
      label: "Non TCEC files",
      value: dashboardFiles.filter((file) => isNo(file.tcec)).length,
      icon: ClipboardList,
      hint: "TCEC marked No",
      tone: "accent",
      searchFilter: "nonTcecFiles",
    },
    {
      label: "High value files",
      value: dashboardFiles.filter((file) => isYes(file.highValue)).length,
      icon: ClipboardList,
      hint: "High value marked Yes",
      tone: "accent",
      searchFilter: "highValueFiles",
    },
    {
      label: "R&QA vetting",
      value: dashboardFiles.filter((file) => isYes(file.rqa)).length,
      icon: CheckCircle2,
      hint: "R&QA marked Yes",
      tone: "success",
      searchFilter: "rqaVetting",
    },
    {
      label: "IFA concurrence",
      value: dashboardFiles.filter((file) => isYes(file.ifa)).length,
      icon: ClipboardList,
      hint: "IFA marked Yes",
      tone: "accent",
      searchFilter: "ifaConcurrence",
    },
    {
      label: "Booked percentage",
      value: {
        capital: formatPercent(capitalBookedPercent),
        revenue: formatPercent(revenueBookedPercent),
      },
      icon: BadgeIndianRupee,
      hint: "Capital / Revenue booked",
      tone: "success",
    },
    {
      label: "Spent percentage",
      value: {
        capital: formatPercent(capitalSpentPercent),
        revenue: formatPercent(revenueSpentPercent),
      },
      icon: BadgeIndianRupee,
      hint: "Capital / Revenue spent",
      tone: "success",
    },
  ];

  const financeStats = [
    { label: "Capital allocated", value: financeTotals.allocatedCapital },
    { label: "Revenue allocated", value: financeTotals.allocatedRevenue },
    { label: "Capital booked", value: financeTotals.bookedCapital },
    { label: "Revenue booked", value: financeTotals.bookedRevenue },
  ];
  const openSearchFilter = (dashboardFilter: string) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter,
        division: activeDivision === "all" ? undefined : activeDivision,
      },
    });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Summary</h2>
            <p className="text-xs text-muted-foreground">Demand and supply order status</p>
          </div>
          <label className="flex min-w-[220px] flex-col gap-1 text-xs text-muted-foreground">
            <span>Division</span>
            <select
              value={activeDivision}
              onChange={(event) => setSelectedDivision(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="all">All accessible divisions</option>
              {divisions.map((division) => (
                <option key={division.id} value={division.name}>
                  {division.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)]">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {summaryStats.map((stat) => (
              <SummaryMetric
                key={stat.label}
                {...stat}
                onClick={stat.searchFilter ? () => openSearchFilter(stat.searchFilter) : undefined}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Workflow Status</h2>
          <p className="text-xs text-muted-foreground">
            Stage counts based on their own date fields
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)]">
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
            {workflowStatusGroups.map((group) => (
              <div
                key={group.title}
                className="rounded-lg border border-border bg-secondary/35 p-4"
              >
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  {group.title}
                </h3>
                <div className="mt-3 space-y-2">
                  {group.statuses.map((status) => (
                    <button
                      type="button"
                      key={status.label}
                      onClick={() => openSearchFilter(status.searchFilter)}
                      className="flex w-full items-center justify-between gap-3 rounded-md bg-card px-3 py-2 text-left hover:bg-accent"
                    >
                      <span className="text-sm font-medium">{status.label}</span>
                      <span className="text-base font-semibold tabular-nums">{status.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-5">
        <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold">Bidding mode</h2>
              <p className="text-xs text-muted-foreground">Files grouped by bidding mode</p>
            </div>
            <div className="size-8 grid place-items-center rounded-md bg-accent text-accent-foreground">
              <Layers3 className="size-4" />
            </div>
          </div>
          {modeCounts.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {modeCounts.map((mode) => (
                <button
                  type="button"
                  key={mode.name}
                  onClick={() => openSearchFilter(`mode:${mode.name}`)}
                  className="rounded-lg border border-border bg-secondary/35 p-4 text-left hover:bg-accent"
                >
                  <div className="text-xs text-muted-foreground">{mode.name}</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight">{mode.count}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No modes recorded yet.</div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold">Finance</h2>
              <p className="text-xs text-muted-foreground">Allocated and booked amounts</p>
            </div>
            <div className="size-8 grid place-items-center rounded-md bg-success/15 text-success">
              <BadgeIndianRupee className="size-4" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {financeStats.map((stat) => (
              <div key={stat.label} className="rounded-lg border border-border bg-secondary/35 p-4">
                <div className="text-xs text-muted-foreground">{stat.label}</div>
                <div className="mt-2 text-2xl font-semibold tracking-tight">
                  {formatCurrency(stat.value)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-border bg-card p-4">
            <div className="text-xs font-medium text-muted-foreground">Spent from S.O. value</div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-md border border-border bg-secondary/35 px-3 py-2.5">
                <div className="text-[11px] text-muted-foreground">Capital spent</div>
                <div className="mt-1 text-lg font-semibold tracking-tight">
                  {formatCurrency(financeTotals.spentCapital)}
                </div>
              </div>
              <div className="rounded-md border border-border bg-secondary/35 px-3 py-2.5">
                <div className="text-[11px] text-muted-foreground">Revenue spent</div>
                <div className="mt-1 text-lg font-semibold tracking-tight">
                  {formatCurrency(financeTotals.spentRevenue)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string;
  value: number | string | { capital: string; revenue: string };
  icon: typeof FileText;
  tone: "primary" | "success" | "accent";
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={
            "size-8 grid place-items-center rounded-md " +
            (tone === "success"
              ? "bg-success/15 text-success"
              : tone === "primary"
                ? "bg-primary/10 text-primary"
                : "bg-accent text-accent-foreground")
          }
        >
          <Icon className="size-4" />
        </div>
      </div>
      {typeof value === "object" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-md border border-border bg-card px-2 py-2">
            <div className="text-[11px] text-muted-foreground">Capital</div>
            <div className="text-lg font-semibold tracking-tight">{value.capital}</div>
          </div>
          <div className="rounded-md border border-border bg-card px-2 py-2">
            <div className="text-[11px] text-muted-foreground">Revenue</div>
            <div className="text-lg font-semibold tracking-tight">{value.revenue}</div>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-lg border border-border bg-secondary/35 p-4 text-left hover:bg-accent"
      >
        {content}
      </button>
    );
  }

  return <div className="rounded-lg border border-border bg-secondary/35 p-4">{content}</div>;
}

function getModeCounts(files: ReturnType<typeof useAccessibleFiles>) {
  const modes = ["OBM", "PBM", "SBM", "LBM", "LPC"];
  const counts = files.reduce<Record<string, number>>((current, file) => {
    const mode = file.mode?.trim().toUpperCase();
    if (!mode || !modes.includes(mode)) return current;
    current[mode] = (current[mode] ?? 0) + 1;
    return current;
  }, {});

  return modes.map((name) => ({ name, count: counts[name] ?? 0 }));
}

const workflowStatusGroups = [
  {
    title: "Scrutiny & Demand",
    statuses: [
      {
        label: "Scrutiny completed",
        searchFilter: "scrutinyCompleted",
        matches: (file) => hasFilledField(file, "scrutinyCompletionDate"),
      },
      {
        label: "Scrutiny under progress",
        searchFilter: "scrutinyUnderProgress",
        matches: (file) => !hasFilledField(file, "scrutinyDate"),
      },
    ],
  },
  {
    title: "Pre-TCEC",
    statuses: [
      {
        label: "Completed",
        searchFilter: "preTcecCompleted",
        matches: (file) => isYes(file.tcec) && hasFilledField(file, "preTcecMinutesDate"),
      },
      {
        label: "Remaining",
        searchFilter: "preTcecRemaining",
        matches: (file) => isYes(file.tcec) && !hasFilledField(file, "preTcecMinutesDate"),
      },
    ],
  },
  {
    title: "High value committee",
    statuses: [
      {
        label: "Completed",
        searchFilter: "highValueCompleted",
        matches: (file) => hasFilledField(file, "highValueMinutesDate"),
      },
      {
        label: "Remaining",
        searchFilter: "highValueRemaining",
        matches: (file) => hasFilledField(file, "highValueMeetingDate"),
      },
    ],
  },
  {
    title: "AD vetting",
    statuses: [
      {
        label: "Completed",
        searchFilter: "adCompleted",
        matches: (file) => hasFilledField(file, "adVettingDate"),
      },
      {
        label: "Remaining",
        searchFilter: "adRemaining",
        matches: (file) =>
          hasFilledField(file, "preTcecDate") && !hasFilledField(file, "adVettingDate"),
      },
    ],
  },
  {
    title: "R&QA approval",
    statuses: [
      {
        label: "Completed",
        searchFilter: "rqaCompleted",
        matches: (file) => hasFilledField(file, "rqaApprovalDate"),
      },
      {
        label: "Remaining",
        searchFilter: "rqaRemaining",
        matches: (file) => isYes(file.rqa) && !hasFilledField(file, "rqaApprovalDate"),
      },
    ],
  },
  {
    title: "IFA concurrence",
    statuses: [
      {
        label: "Completed",
        searchFilter: "ifaCompleted",
        matches: (file) => hasFilledField(file, "ifaFinalDate"),
      },
      {
        label: "Remaining",
        searchFilter: "ifaRemaining",
        matches: (file) => hasFilledField(file, "ifaSentDate"),
      },
    ],
  },
  {
    title: "CFA approval",
    statuses: [
      {
        label: "Completed",
        searchFilter: "cfaCompleted",
        matches: (file) => hasFilledField(file, "cfaDate"),
      },
    ],
  },
  {
    title: "Supply order",
    statuses: [
      {
        label: "Completed",
        searchFilter: "soCompleted",
        matches: (file) => hasFilledField(file, "soNo"),
      },
      {
        label: "Remaining",
        searchFilter: "soRemaining",
        matches: (file) => !hasFilledField(file, "soNo"),
      },
    ],
  },
] satisfies Array<{
  title: string;
  statuses: Array<{
    label: string;
    searchFilter: string;
    matches: (file: FileRecord) => boolean;
  }>;
}>;

function getWorkflowStatusGroups(files: ReturnType<typeof useAccessibleFiles>) {
  return workflowStatusGroups.map((group) => ({
    title: group.title,
    statuses: group.statuses.map((status) => ({
      label: status.label,
      searchFilter: status.searchFilter,
      count: files.filter(status.matches).length,
    })),
  }));
}

function hasFilledField(file: FileRecord, key: keyof FileRecord) {
  const value = file[key];
  return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
}

function isYes(value: string | undefined) {
  return value?.trim().toLowerCase() === "yes";
}

function isNo(value: string | undefined) {
  return value?.trim().toLowerCase() === "no";
}

function parseAmount(value: string | undefined) {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasAmount(value: string | undefined) {
  return parseAmount(value) !== undefined;
}

function getPercent(value: number, total: number) {
  if (total <= 0) return undefined;
  return (value / total) * 100;
}

function formatPercent(value: number | undefined) {
  if (value === undefined) return "0%";
  return `${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(value);
}
