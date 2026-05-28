import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { type FileRecord, useAccessibleDivisions, useAccessibleFiles } from "@/lib/files-store";
import { formatThousandsAndLakhs, getInrAmount, hasAmount, parseAmount } from "@/lib/money";

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
  const [activeDashboardTab, setActiveDashboardTab] = useState<"snapshot" | "status" | "finance">(
    "snapshot",
  );
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
        sum + (hasAmount(file.soValueCapital) ? 0 : (getInrAmount(file.valueCapital, file) ?? 0)),
      0,
    ),
    bookedRevenue: dashboardFiles.reduce(
      (sum, file) =>
        sum + (hasAmount(file.soValueRevenue) ? 0 : (getInrAmount(file.valueRevenue, file) ?? 0)),
      0,
    ),
    projectedCapital: dashboardFiles.reduce(
      (sum, file) =>
        sum + (!hasFilledField(file, "imms") ? (getInrAmount(file.valueCapital, file) ?? 0) : 0),
      0,
    ),
    projectedRevenue: dashboardFiles.reduce(
      (sum, file) =>
        sum + (!hasFilledField(file, "imms") ? (getInrAmount(file.valueRevenue, file) ?? 0) : 0),
      0,
    ),
    spentCapital: dashboardFiles.reduce(
      (sum, file) => sum + (getInrAmount(file.soValueCapital, file) ?? 0),
      0,
    ),
    spentRevenue: dashboardFiles.reduce(
      (sum, file) => sum + (getInrAmount(file.soValueRevenue, file) ?? 0),
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
  const capitalProjectedPercent = getPercent(
    financeTotals.projectedCapital,
    financeTotals.allocatedCapital,
  );
  const revenueProjectedPercent = getPercent(
    financeTotals.projectedRevenue,
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

  const topSummaryStats = [
    {
      label: "Demand",
      value: [
        {
          label: "Total",
          value: dashboardFiles.length,
          searchFilter: "totalFiles",
        },
        {
          label: "Controlled",
          value: dashboardFiles.filter((file) => hasFilledField(file, "imms")).length,
          searchFilter: "demandsControlled",
        },
      ],
      hint: "Total and controlled demands",
    },
    {
      label: "TCEC",
      value: [
        {
          label: "TCEC",
          value: dashboardFiles.filter((file) => isYes(file.tcec)).length,
          searchFilter: "tcecFiles",
        },
        {
          label: "Non TCEC",
          value: dashboardFiles.filter((file) => isNo(file.tcec)).length,
          searchFilter: "nonTcecFiles",
        },
      ],
      hint: "TCEC and non TCEC files",
    },
    {
      label: "AD",
      value: [
        {
          label: "High value",
          value: dashboardFiles.filter((file) => isYes(file.highValue)).length,
          searchFilter: "highValueFiles",
        },
        {
          label: "AD vetting",
          value: dashboardFiles.filter((file) => isYes(file.ad)).length,
          searchFilter: "adYes",
        },
      ],
      hint: "High value and AD yes",
    },
  ];

  const compactSummaryStats = [
    {
      label: "R&QA",
      value: dashboardFiles.filter((file) => isYes(file.rqa)).length,
      hint: "R&QA marked Yes",
      searchFilter: "rqaVetting",
    },
    {
      label: "IFA",
      value: dashboardFiles.filter((file) => isYes(file.ifa)).length,
      hint: "IFA marked Yes",
      searchFilter: "ifaConcurrence",
    },
  ];

  const summaryStats = [
    {
      label: "Bids",
      value: [
        {
          label: "Live",
          value: dashboardFiles.filter(isFileTenderLive).length,
          searchFilter: "liveBids",
        },
        {
          label: "Overdue",
          value: dashboardFiles.filter(isBidOverdue).length,
          searchFilter: "bidOverdue",
        },
      ],
      hint: "Live and overdue bids",
    },
    {
      label: "Supply Orders",
      value: [
        {
          label: "Total",
          value: dashboardFiles.filter((file) => hasFilledField(file, "soDate")).length,
          searchFilter: "supplyOrders",
        },
        {
          label: "Live",
          value: dashboardFiles.filter(isLiveSupplyOrder).length,
          searchFilter: "liveSupplyOrders",
        },
      ],
      hint: "Total and live supply orders",
    },
    {
      label: "BG",
      value: [
        {
          label: "To be received",
          value: dashboardFiles.filter(isBgToBeReceived).length,
          searchFilter: "bgToBeReceived",
        },
        {
          label: "To be returned",
          value: dashboardFiles.filter(isBgToBeReturned).length,
          searchFilter: "bgToBeReturned",
        },
      ],
      hint: "BG receipt and return status",
    },
    {
      label: "DP",
      value: [
        {
          label: "Extension",
          value: dashboardFiles.filter((file) => isYes(file.dpExtension)).length,
          searchFilter: "dpExtension",
        },
        {
          label: "Expired",
          value: dashboardFiles.filter(isDpExpired).length,
          searchFilter: "dpExpired",
        },
      ],
      hint: "DP extension and expiry status",
    },
    {
      label: "Delivery and Payment",
      value: [
        {
          label: "Delivery due",
          value: dashboardFiles.filter(isDeliveryOverdue).length,
          searchFilter: "deliveryOverdue",
        },
        {
          label: "Payment due",
          value: dashboardFiles.filter(isPaymentDue).length,
          searchFilter: "paymentDue",
        },
      ],
      hint: "Overdue delivery and pending payment",
    },
  ];

  const financePercentStats = [
    {
      label: "Projected",
      value: {
        capital: formatPercent(capitalProjectedPercent),
        revenue: formatPercent(revenueProjectedPercent),
      },
      hint: "Capital / Revenue projected against allocation",
    },
    {
      label: "Booked",
      value: {
        capital: formatPercent(capitalBookedPercent),
        revenue: formatPercent(revenueBookedPercent),
      },
      hint: "Capital / Revenue booked in INR",
    },
    {
      label: "Committed",
      value: {
        capital: formatPercent(capitalSpentPercent),
        revenue: formatPercent(revenueSpentPercent),
      },
      hint: "Capital / Revenue committed in INR",
    },
  ];
  const financeBoxTitleClass = "text-sm font-extrabold text-foreground";

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-card)]">
          {[
            { key: "snapshot", label: "Snapshot" },
            { key: "status", label: "Status" },
            { key: "finance", label: "Finance" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveDashboardTab(tab.key as "snapshot" | "status" | "finance")}
              className={
                "h-8 rounded-md px-3 text-sm font-medium transition-colors " +
                (activeDashboardTab === tab.key
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              {tab.label}
            </button>
          ))}
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

      {activeDashboardTab === "snapshot" ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-bold">Snapshot</h2>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)]">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {topSummaryStats.map((stat) => (
                <SummaryMetric
                  key={stat.label}
                  {...stat}
                  onClick={
                    stat.searchFilter ? () => openSearchFilter(stat.searchFilter) : undefined
                  }
                  onSubMetricClick={(dashboardFilter) => openSearchFilter(dashboardFilter)}
                />
              ))}
              <div className="grid grid-cols-2 gap-2">
                {compactSummaryStats.map((stat) => (
                  <SummaryMetric
                    key={stat.label}
                    {...stat}
                    compact
                    onClick={() => openSearchFilter(stat.searchFilter)}
                    onSubMetricClick={(dashboardFilter) => openSearchFilter(dashboardFilter)}
                  />
                ))}
              </div>
              {summaryStats.map((stat) => (
                <SummaryMetric
                  key={stat.label}
                  {...stat}
                  onClick={
                    stat.searchFilter ? () => openSearchFilter(stat.searchFilter) : undefined
                  }
                  onSubMetricClick={(dashboardFilter) => openSearchFilter(dashboardFilter)}
                />
              ))}
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-sm font-bold">Bidding mode</h2>
                <p className="text-xs text-muted-foreground">Files grouped by bidding mode</p>
              </div>
            </div>
            {modeCounts.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
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
        </section>
      ) : null}

      {activeDashboardTab === "status" ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-bold">Status</h2>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)]">
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
              {workflowStatusGroups.map((group) => (
                <div
                  key={group.title}
                  className="rounded-lg border border-border bg-secondary/35 p-4"
                >
                  <h3 className="text-xs font-extrabold uppercase text-foreground">
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
      ) : null}

      {activeDashboardTab === "finance" ? (
        <section>
          <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-sm font-bold">Finance</h2>
                <p className="text-xs text-muted-foreground">Allocated and booked amounts</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-lg border border-border bg-secondary/35 p-4">
                <div className={financeBoxTitleClass}>Allocated</div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-md border border-border bg-card px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">Capital</div>
                    <div className="mt-1 text-lg font-semibold tracking-tight">
                      {formatCurrency(financeTotals.allocatedCapital)}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-card px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">Revenue</div>
                    <div className="mt-1 text-lg font-semibold tracking-tight">
                      {formatCurrency(financeTotals.allocatedRevenue)}
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/35 p-4">
                <div className={financeBoxTitleClass}>Projected</div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-md border border-border bg-card px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">Capital</div>
                    <div className="mt-1 text-lg font-semibold tracking-tight">
                      {formatCurrency(financeTotals.projectedCapital)}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-card px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">Revenue</div>
                    <div className="mt-1 text-lg font-semibold tracking-tight">
                      {formatCurrency(financeTotals.projectedRevenue)}
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/35 p-4">
                <div className={financeBoxTitleClass}>Booked</div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-md border border-border bg-card px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">Capital</div>
                    <div className="mt-1 text-lg font-semibold tracking-tight">
                      {formatCurrency(financeTotals.bookedCapital)}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-card px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">Revenue</div>
                    <div className="mt-1 text-lg font-semibold tracking-tight">
                      {formatCurrency(financeTotals.bookedRevenue)}
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/35 p-4">
                <div className={financeBoxTitleClass}>Committed</div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-md border border-border bg-card px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">Capital</div>
                    <div className="mt-1 text-lg font-semibold tracking-tight">
                      {formatCurrency(financeTotals.spentCapital)}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-card px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">Revenue</div>
                    <div className="mt-1 text-lg font-semibold tracking-tight">
                      {formatCurrency(financeTotals.spentRevenue)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {financePercentStats.map((stat) => (
                <SummaryMetric key={stat.label} {...stat} titleClassName={financeBoxTitleClass} />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  onClick,
  onSubMetricClick,
  titleClassName,
  compact = false,
}: {
  label: string;
  value:
    | number
    | string
    | { capital: string; revenue: string }
    | Array<{ label: string; value: number | string; searchFilter?: string }>;
  onClick?: () => void;
  onSubMetricClick?: (dashboardFilter: string) => void;
  titleClassName?: string;
  compact?: boolean;
}) {
  const subMetrics = Array.isArray(value) ? value : undefined;
  const content = (
    <>
      <div className="flex items-center justify-between">
        <div className={titleClassName ?? "text-sm font-bold text-muted-foreground"}>{label}</div>
      </div>
      {subMetrics ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {subMetrics.map((item) => {
            const subContent = (
              <>
                <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
                <div className="text-lg font-semibold tracking-tight">{item.value}</div>
              </>
            );

            if (item.searchFilter && onSubMetricClick) {
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => onSubMetricClick(item.searchFilter!)}
                  className="rounded-md border border-border bg-card px-2 py-2 text-left hover:bg-accent"
                >
                  {subContent}
                </button>
              );
            }

            return (
              <div key={item.label} className="rounded-md border border-border bg-card px-2 py-2">
                {subContent}
              </div>
            );
          })}
        </div>
      ) : typeof value === "object" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-md border border-border bg-card px-2 py-2">
            <div className="text-xs font-medium text-muted-foreground">Capital</div>
            <div className="text-lg font-semibold tracking-tight">{value.capital}</div>
          </div>
          <div className="rounded-md border border-border bg-card px-2 py-2">
            <div className="text-xs font-medium text-muted-foreground">Revenue</div>
            <div className="text-lg font-semibold tracking-tight">{value.revenue}</div>
          </div>
        </div>
      ) : (
        <div
          className={
            compact
              ? "mt-3 text-xl font-semibold tracking-tight"
              : "mt-3 text-2xl font-semibold tracking-tight"
          }
        >
          {value}
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={
          "rounded-lg border border-border bg-secondary/35 text-left hover:bg-accent " +
          (compact ? "p-3" : "p-4")
        }
      >
        {content}
      </button>
    );
  }

  return (
    <div className={"rounded-lg border border-border bg-secondary/35 " + (compact ? "p-3" : "p-4")}>
      {content}
    </div>
  );
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
    title: "Scrutiny",
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

function isFileTenderLive(file: FileRecord) {
  if (hasDate(file.refloatBiddingDate) && hasDate(file.refloatBidOpeningDate)) {
    return isDateInRangeToday(file.refloatBiddingDate, file.refloatBidOpeningDate);
  }

  return isDateInRangeToday(file.bidDate, file.bidOpeningDate);
}

function isBidOverdue(file: FileRecord) {
  const activeOpeningDate = file.refloatBidOpeningDate || file.bidOpeningDate;
  return isNo(file.bidOpened) && isDateBeforeToday(activeOpeningDate);
}

function isLiveSupplyOrder(file: FileRecord) {
  return hasFilledField(file, "soDate") && isDateAfterToday(file.dpDate);
}

function isBgToBeReceived(file: FileRecord) {
  return (
    isYes(file.bg) && hasFilledField(file, "soDate") && !hasFilledField(file, "bgValidityDate")
  );
}

function isBgToBeReturned(file: FileRecord) {
  return (
    isYes(file.bg) &&
    hasFilledField(file, "bgValidityDate") &&
    isDateBeforeToday(file.bgValidityDate) &&
    !hasFilledField(file, "bgReturnDate")
  );
}

function isDpExpired(file: FileRecord) {
  return isDateBeforeToday(file.dpDate) && !hasFilledField(file, "revisedDp");
}

function isDeliveryOverdue(file: FileRecord) {
  const deliveryDate = hasFilledField(file, "revisedDp") ? file.revisedDp : file.dpDate;
  return isDateBeforeToday(deliveryDate);
}

function isPaymentDue(file: FileRecord) {
  return hasFilledField(file, "materialReceiptDate") && !hasFilledField(file, "paymentDate");
}

function isDateInRangeToday(startDate: string | undefined, endDate: string | undefined) {
  const startTime = parseLocalDateTime(startDate ?? "");
  const endTime = parseLocalDateTime(endDate ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));

  if (startTime === undefined || endTime === undefined || todayTime === undefined) {
    return false;
  }

  return startTime <= todayTime && todayTime <= endTime;
}

function isDateBeforeToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));

  if (dateTime === undefined || todayTime === undefined) {
    return false;
  }

  return dateTime < todayTime;
}

function isDateAfterToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));

  if (dateTime === undefined || todayTime === undefined) {
    return false;
  }

  return dateTime > todayTime;
}

function hasDate(date: string | undefined) {
  return parseLocalDateTime(date ?? "") !== undefined;
}

function parseLocalDateTime(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00`);
  const time = parsed.getTime();
  return Number.isNaN(time) ? undefined : time;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  return formatThousandsAndLakhs(value);
}
