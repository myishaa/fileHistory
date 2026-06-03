import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type FileRecord,
  type SupplyOrderDetail,
  useAccessibleDivisions,
  useAccessibleFiles,
  useActiveUser,
  useSettings,
} from "@/lib/files-store";
import { formatThousandsAndLakhs, getInrAmount, hasAmount, parseAmount } from "@/lib/money";
import { ArrowRight, FileSpreadsheet, FileText, Search } from "lucide-react";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/search", search: { dashboardFilter: undefined, division: undefined } });
  },
});

type DashboardTab = "snapshot" | "status" | "analytics" | "finance";
type StatusActionMode = "pdf" | "excel" | "search";
type AnalyticsPanelKey =
  | "divisionFiles"
  | "divisionValue"
  | "divisionTurnaround"
  | "fileDistribution"
  | "topFirms"
  | "indentorsByFiles"
  | "indentorsByValue"
  | "milestoneClearing"
  | "monthlyInflow"
  | "biddingMode"
  | "fileValueThresholds"
  | "riskLoad"
  | "paymentPending"
  | "milestoneClearingTable";
type SummarySubMetric = { label: string; value: number | string; searchFilter?: string };
type FinanceSplitValue = { capital: string; revenue: string };
type SummaryMetricValue = number | string | FinanceSplitValue | SummarySubMetric[];
type SummaryStat = {
  label: string;
  value: SummaryMetricValue;
  hint?: string;
  searchFilter?: string;
};

const chartColors = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--destructive))",
];

const statusActionModes = [
  { key: "pdf", label: "PDF", icon: FileText },
  { key: "excel", label: "Excel", icon: FileSpreadsheet },
  { key: "search", label: "Search file", icon: Search },
] satisfies Array<{ key: StatusActionMode; label: string; icon: typeof Search }>;

export function Dashboard() {
  const files = useAccessibleFiles();
  const divisions = useAccessibleDivisions();
  const settings = useSettings();
  const activeUser = useActiveUser();
  const navigate = useNavigate();
  const [selectedDivision, setSelectedDivision] = useState("all");
  const [activeDashboardTab, setActiveDashboardTab] = useState<DashboardTab>("status");
  const [statusActionMode, setStatusActionMode] = useState<StatusActionMode>("search");
  const [activeAnalyticsPanel, setActiveAnalyticsPanel] =
    useState<AnalyticsPanelKey>("divisionFiles");
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
  const manualMilestoneFlow = getManualMilestoneFlow(
    dashboardFiles,
    getConfiguredMilestones(settings.milestones),
  );
  const statusFlow = getMilestoneFlow(dashboardFiles);
  const miscellaneousCounts = getMiscellaneousCounts(dashboardFiles);
  const statusPageExportTitle =
    activeUser?.role === "admin"
      ? "ASL Buildup"
      : activeDivision === "all"
        ? dashboardDivisions.map((division) => division.name).join(", ") || "Status"
        : activeDivision;
  const statusPageExportRows = getStatusPageExportRows(
    statusFlow,
    miscellaneousCounts,
    dashboardFiles.length,
  );
  const analytics = getAnalyticsSummary(dashboardFiles);
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

  const topSummaryStats: SummaryStat[] = getAttributeSummaryStats(dashboardFiles);
  const biddingTypeSummaryStat: SummaryStat = {
    label: "Bidding type",
    value: modeCounts.map((mode) => ({
      label: mode.name,
      value: mode.count,
      searchFilter: `mode:${mode.name}`,
    })),
    hint: "Files grouped by bidding type",
  };
  const fileTypeSummaryStat: SummaryStat = {
    label: "File type",
    value: getFileTypeCounts(dashboardFiles).map((fileType) => ({
      label: fileType.name,
      value: fileType.count,
      searchFilter: `fileType:${fileType.name}`,
    })),
    hint: "Files grouped by file type",
  };

  const compactSummaryStats: SummaryStat[] = [];

  const summaryStats: SummaryStat[] = [];

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
  const financeExportTitle =
    activeDivision === "all"
      ? "Finance summary - All divisions"
      : `Finance summary - ${activeDivision}`;
  const financeExportRows = [
    {
      category: "Allocated",
      capital: formatCurrency(financeTotals.allocatedCapital),
      revenue: formatCurrency(financeTotals.allocatedRevenue),
      notes: "Allocated amount",
    },
    {
      category: "Projected",
      capital: formatCurrency(financeTotals.projectedCapital),
      revenue: formatCurrency(financeTotals.projectedRevenue),
      notes: `Against allocation: Capital ${formatPercent(capitalProjectedPercent)}, Revenue ${formatPercent(
        revenueProjectedPercent,
      )}`,
    },
    {
      category: "Booked",
      capital: formatCurrency(financeTotals.bookedCapital),
      revenue: formatCurrency(financeTotals.bookedRevenue),
      notes: `Against allocation: Capital ${formatPercent(capitalBookedPercent)}, Revenue ${formatPercent(
        revenueBookedPercent,
      )}`,
    },
    {
      category: "Committed",
      capital: formatCurrency(financeTotals.spentCapital),
      revenue: formatCurrency(financeTotals.spentRevenue),
      notes: `Against allocation: Capital ${formatPercent(capitalSpentPercent)}, Revenue ${formatPercent(
        revenueSpentPercent,
      )}`,
    },
  ];
  const analyticsPanels: Array<{
    key: AnalyticsPanelKey;
    title: string;
    subtitle: string;
    content: ReactNode;
  }> = [
    {
      key: "divisionFiles",
      title: "Division ranking by files",
      subtitle: "Number of files, descending",
      content: <AnalyticsBarChart data={analytics.divisionFileRanking} valueKey="count" />,
    },
    {
      key: "divisionValue",
      title: "Division ranking by value",
      subtitle: "Total demand value",
      content: (
        <AnalyticsBarChart
          data={analytics.divisionValueRanking}
          valueKey="value"
          valueFormatter={formatCompactCurrency}
        />
      ),
    },
    {
      key: "divisionTurnaround",
      title: "Division turnaround ranking",
      subtitle: "Average days from received date to first S.O.",
      content: (
        <AnalyticsBarChart
          data={analytics.divisionTurnaroundRanking}
          valueKey="averageDays"
          valueFormatter={(value) => `${value}d`}
        />
      ),
    },
    {
      key: "fileDistribution",
      title: "File distribution",
      subtitle: "Share by division",
      content: <AnalyticsPieChart data={analytics.divisionFileRanking.slice(0, 8)} />,
    },
    {
      key: "topFirms",
      title: "Top 20 firms by S.O. value",
      subtitle: "Supply order value, capital plus revenue",
      content: (
        <AnalyticsBarChart
          data={analytics.topFirmSupplyOrders}
          valueKey="value"
          valueFormatter={formatCompactCurrency}
          height={420}
        />
      ),
    },
    {
      key: "indentorsByFiles",
      title: "Top 10 indentors by files",
      subtitle: "Number of files raised",
      content: <AnalyticsBarChart data={analytics.topIndentorsByFiles} valueKey="count" />,
    },
    {
      key: "indentorsByValue",
      title: "Top 10 indentors by value",
      subtitle: "Total demand value",
      content: (
        <AnalyticsBarChart
          data={analytics.topIndentorsByValue}
          valueKey="value"
          valueFormatter={formatCompactCurrency}
        />
      ),
    },
    {
      key: "milestoneClearing",
      title: "Milestones by clearing time",
      subtitle: "Average clearing time in days",
      content: (
        <AnalyticsLineChart data={analytics.milestoneClearingRanking} valueKey="averageDays" />
      ),
    },
    {
      key: "monthlyInflow",
      title: "Monthly file inflow",
      subtitle: "Files received by month",
      content: <AnalyticsLineChart data={analytics.monthlyFileInflow} valueKey="count" />,
    },
    {
      key: "biddingMode",
      title: "Bidding mode mix",
      subtitle: "Distribution by mode",
      content: <AnalyticsPieChart data={analytics.biddingModeMix} />,
    },
    {
      key: "fileValueThresholds",
      title: "File value thresholds",
      subtitle: "Number of files by total demand value",
      content: <AnalyticsBarChart data={analytics.fileValueThresholds} valueKey="count" />,
    },
    {
      key: "riskLoad",
      title: "Risk load by division",
      subtitle: "Delivery pending, expired DP, LD, or cancelled S.O.",
      content: <AnalyticsBarChart data={analytics.divisionRiskRanking} valueKey="count" />,
    },
    {
      key: "paymentPending",
      title: "Payment pending by division",
      subtitle: "Material received but payment not completed",
      content: (
        <AnalyticsBarChart data={analytics.divisionPaymentPendingRanking} valueKey="count" />
      ),
    },
    {
      key: "milestoneClearingTable",
      title: "Milestone clearing ranking",
      subtitle: "Slowest milestones by average clearing time",
      content: (
        <AnalyticsRankingTable
          columns={[
            { key: "name", label: "Milestone", align: "left" },
            { key: "averageDays", label: "Avg days", format: (value) => `${value}d` },
            { key: "sampleSize", label: "Files" },
          ]}
          rows={analytics.milestoneClearingRanking}
        />
      ),
    },
  ];
  const selectedAnalyticsPanel =
    analyticsPanels.find((panel) => panel.key === activeAnalyticsPanel) ?? analyticsPanels[0];

  const openSearchFilter = (dashboardFilter: string) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter,
        division: activeDivision === "all" ? undefined : activeDivision,
      },
    });
  };
  const handleStatusFilter = (dashboardFilter: string) => {
    if (statusActionMode === "search") {
      openSearchFilter(dashboardFilter);
      return;
    }

    const exportFiles = dashboardFiles.filter((file) =>
      matchesDashboardFilter(file, dashboardFilter),
    );
    if (statusActionMode === "excel") {
      exportStatusFilesToExcel(exportFiles, dashboardFilter);
      return;
    }

    printStatusFilesToPdf(exportFiles, dashboardFilter);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-card)]">
          {[
            { key: "status", label: "Status" },
            { key: "snapshot", label: "Snapshot" },
            { key: "analytics", label: "Analytics" },
            { key: "finance", label: "Finance" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveDashboardTab(tab.key as DashboardTab)}
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
              {topSummaryStats.map((stat) => {
                const searchFilter = stat.searchFilter;
                return (
                  <SummaryMetric
                    key={stat.label}
                    {...stat}
                    onClick={searchFilter ? () => openSearchFilter(searchFilter) : undefined}
                    onSubMetricClick={(dashboardFilter) => openSearchFilter(dashboardFilter)}
                  />
                );
              })}
              <SummaryMetric
                {...biddingTypeSummaryStat}
                onSubMetricClick={(dashboardFilter) => openSearchFilter(dashboardFilter)}
              />
              <SummaryMetric
                {...fileTypeSummaryStat}
                onSubMetricClick={(dashboardFilter) => openSearchFilter(dashboardFilter)}
              />
              <div className="grid grid-cols-2 gap-2">
                {compactSummaryStats.map((stat) => {
                  const searchFilter = stat.searchFilter;
                  return (
                    <SummaryMetric
                      key={stat.label}
                      {...stat}
                      compact
                      onClick={searchFilter ? () => openSearchFilter(searchFilter) : undefined}
                      onSubMetricClick={(dashboardFilter) => openSearchFilter(dashboardFilter)}
                    />
                  );
                })}
              </div>
              {summaryStats.map((stat) => {
                const searchFilter = stat.searchFilter;
                return (
                  <SummaryMetric
                    key={stat.label}
                    {...stat}
                    onClick={searchFilter ? () => openSearchFilter(searchFilter) : undefined}
                    onSubMetricClick={(dashboardFilter) => openSearchFilter(dashboardFilter)}
                  />
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {activeDashboardTab === "status" ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-bold">Status</h2>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)]">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">File status</h3>
              </div>
              <div className="flex flex-wrap items-end justify-end gap-2">
                <div className="flex rounded-md border border-border bg-secondary/40 p-1">
                  <button
                    type="button"
                    onClick={() =>
                      printStatusPageRowsToPdf(statusPageExportRows, statusPageExportTitle)
                    }
                    className="flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    <FileText className="size-3.5" />
                    Export PDF
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      exportStatusPageRowsToExcel(statusPageExportRows, statusPageExportTitle)
                    }
                    className="flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    <FileSpreadsheet className="size-3.5" />
                    Export Excel
                  </button>
                </div>
                <div className="flex rounded-md border border-border bg-secondary/40 p-1">
                  {statusActionModes.map((mode) => {
                    const Icon = mode.icon;
                    const selected = statusActionMode === mode.key;
                    return (
                      <button
                        key={mode.key}
                        type="button"
                        onClick={() => setStatusActionMode(mode.key)}
                        className={
                          "flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium transition " +
                          (selected
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground")
                        }
                        aria-pressed={selected}
                      >
                        <Icon className="size-3.5" />
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
                <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-right">
                  <div className="text-[11px] font-medium text-muted-foreground">Total files</div>
                  <div className="text-lg font-semibold tabular-nums">{dashboardFiles.length}</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {statusFlow.map((milestone, index) => {
                if ("valid" in milestone) {
                  return (
                    <DeliveryPeriodFlowNode
                      key={milestone.key}
                      milestone={milestone}
                      index={index}
                      isLast={false}
                      onValidClick={() => handleStatusFilter("deliveryPeriodValid")}
                      onExpiredClick={() => handleStatusFilter("deliveryPeriodExpired")}
                      onExtendedClick={() => handleStatusFilter("deliveryPeriodExtended")}
                    />
                  );
                }

                if ("due" in milestone) {
                  return (
                    <DeliveryFlowNode
                      key={milestone.key}
                      milestone={milestone}
                      index={index}
                      isLast={false}
                      onCompletedClick={() => handleStatusFilter("deliveryCompleted")}
                      onDueClick={() => handleStatusFilter("deliveryDue")}
                    />
                  );
                }

                return (
                  <MilestoneFlowNode
                    key={milestone.key}
                    milestone={milestone}
                    index={index}
                    isLast={false}
                    onTotalClick={() => handleStatusFilter(`milestoneTotal:${milestone.key}`)}
                    onUnderProcessClick={() =>
                      handleStatusFilter(`milestoneUnderProcess:${milestone.key}`)
                    }
                    onActiveClick={() => handleStatusFilter(`milestoneActive:${milestone.key}`)}
                    onReviewedClick={() => handleStatusFilter(`milestoneReviewed:${milestone.key}`)}
                    onPendingClick={() => handleStatusFilter(`milestonePending:${milestone.key}`)}
                    onClearedClick={() => handleStatusFilter(`milestoneCleared:${milestone.key}`)}
                    onLiveBidsClick={() => handleStatusFilter("liveBids")}
                    onBidOverdueClick={() => handleStatusFilter("bidOverdue")}
                    onLiveSupplyOrdersClick={() => handleStatusFilter("liveSupplyOrders")}
                  />
                );
              })}
              <StatusFlowNode
                index={statusFlow.length}
                title="Miscellaneous"
                isLast
                items={[
                  {
                    label: "LD",
                    count: miscellaneousCounts.ld,
                    onClick: () => handleStatusFilter("miscLd"),
                  },
                  {
                    label: "Demand cancelled",
                    count: miscellaneousCounts.demandCancelled,
                    onClick: () => handleStatusFilter("miscDemandCancelled"),
                  },
                  {
                    label: "S.O. cancelled",
                    count: miscellaneousCounts.soCancelled,
                    onClick: () => handleStatusFilter("miscSoCancelled"),
                  },
                  {
                    label: "Multiple S.O.",
                    count: miscellaneousCounts.multipleSupplyOrders,
                    onClick: () => handleStatusFilter("miscMultipleSupplyOrders"),
                  },
                ]}
              />
            </div>
          </div>
        </section>
      ) : null}

      {activeDashboardTab === "analytics" ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-bold">Analytics</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
              <div className="space-y-1">
                {analyticsPanels.map((panel) => {
                  const selected = selectedAnalyticsPanel.key === panel.key;
                  return (
                    <button
                      key={panel.key}
                      type="button"
                      onClick={() => setActiveAnalyticsPanel(panel.key)}
                      className={
                        "w-full rounded-md px-3 py-2 text-left text-sm font-medium transition " +
                        (selected
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground")
                      }
                    >
                      {panel.title}
                    </button>
                  );
                })}
              </div>
            </aside>
            <div className="min-w-0">
              <AnalyticsChartCard
                title={selectedAnalyticsPanel.title}
                subtitle={selectedAnalyticsPanel.subtitle}
              >
                {selectedAnalyticsPanel.content}
              </AnalyticsChartCard>
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
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => printFinanceRowsToPdf(financeExportRows, financeExportTitle)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent"
                >
                  <FileText className="size-3.5" />
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => exportFinanceRowsToExcel(financeExportRows, financeExportTitle)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent"
                >
                  <FileSpreadsheet className="size-3.5" />
                  Excel
                </button>
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
  value: SummaryMetricValue;
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

            const searchFilter = item.searchFilter;
            if (searchFilter && onSubMetricClick) {
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => onSubMetricClick(searchFilter)}
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
      ) : isFinanceSplitValue(value) ? (
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
          {typeof value === "string" || typeof value === "number" ? value : ""}
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

function isFinanceSplitValue(value: SummaryMetricValue): value is FinanceSplitValue {
  return !Array.isArray(value) && typeof value === "object" && value !== null;
}

function ManualMilestoneFlowNode({
  milestone,
  index,
  isLast,
  onCurrentClick,
  onCompletedClick,
}: {
  milestone: {
    name: string;
    current: number;
    completed: number;
  };
  index: number;
  isLast: boolean;
  onCurrentClick: () => void;
  onCompletedClick: () => void;
}) {
  const tone = getMilestoneTone(milestone.current);

  return (
    <div className="relative min-w-0">
      <div
        className={
          "group flex h-full w-full flex-col justify-between rounded-lg border p-2.5 text-left transition hover:shadow-[var(--shadow-card)] " +
          tone.card
        }
      >
        <span className="flex flex-col gap-2">
          <span className="flex min-w-0 items-center gap-2 border-b border-border/60 pb-2">
            <span
              className={
                "grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-bold " +
                tone.step
              }
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{milestone.name}</span>
            </span>
          </span>
          <span className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onCurrentClick}
              className={
                "rounded-md px-2 py-1 text-center hover:ring-2 hover:ring-ring/30 " + tone.count
              }
            >
              <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
                Currently running
              </span>
              <span className="block text-base font-semibold tabular-nums">
                {milestone.current}
              </span>
            </button>
            <button
              type="button"
              onClick={onCompletedClick}
              className="rounded-md border border-border bg-card px-2 py-1 text-center hover:bg-accent hover:ring-2 hover:ring-ring/30"
            >
              <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
                Completed
              </span>
              <span className="block text-base font-semibold tabular-nums">
                {milestone.completed}
              </span>
            </button>
          </span>
        </span>
      </div>
      {!isLast ? (
        <div className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 translate-x-1/2 rounded-full border border-border bg-card p-1 text-muted-foreground xl:block">
          <ArrowRight className="size-4" />
        </div>
      ) : null}
    </div>
  );
}

function StatusFlowNode({
  index,
  title,
  items,
  isLast,
}: {
  index: number;
  title: string;
  items: Array<{ label: string; count: number; onClick?: () => void }>;
  isLast: boolean;
}) {
  const tone = getMilestoneTone(items.reduce((sum, item) => sum + item.count, 0));

  return (
    <div className="relative min-w-0">
      <div
        className={
          "group flex h-full w-full flex-col justify-between rounded-lg border p-2.5 text-left transition hover:shadow-[var(--shadow-card)] " +
          tone.card
        }
      >
        <span className="flex flex-col gap-2">
          <span className="flex min-w-0 items-center gap-2 border-b border-border/60 pb-2">
            <span
              className={
                "grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-bold " +
                tone.step
              }
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{title}</span>
            </span>
          </span>
          <span className="grid grid-cols-3 gap-1.5">
            {items.map((item) => (
              <StatusSubBox
                key={item.label}
                label={item.label}
                count={item.count}
                onClick={item.onClick}
              />
            ))}
          </span>
        </span>
      </div>
      {!isLast ? (
        <div className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 translate-x-1/2 rounded-full border border-border bg-card p-1 text-muted-foreground xl:block">
          <ArrowRight className="size-4" />
        </div>
      ) : null}
    </div>
  );
}

function StatusSubBox({
  label,
  count,
  onClick,
}: {
  label: string;
  count: number;
  onClick?: () => void;
}) {
  const tone = getMilestoneTone(count);
  const content = (
    <>
      <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
        {label}
      </span>
      <span className="block text-base font-semibold tabular-nums">{count}</span>
    </>
  );

  if (!onClick) {
    return (
      <div className="rounded-md border border-border bg-card px-2 py-1 text-center">{content}</div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-md border border-border bg-card px-2 py-1 text-center hover:bg-accent hover:ring-2 hover:ring-ring/30"
      }
    >
      {content}
    </button>
  );
}

type StatusMetric = {
  label: string;
  count: number;
  onClick?: () => void;
  toneCount?: boolean;
};

function StatusMetricBox({
  metric,
  tone,
}: {
  metric: StatusMetric;
  tone: ReturnType<typeof getMilestoneTone>;
}) {
  const content = (
    <>
      <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
        {metric.label}
      </span>
      <span className="block text-base font-semibold tabular-nums">{metric.count}</span>
    </>
  );
  const className =
    "min-h-12 rounded-md border px-2 py-1.5 text-center transition hover:ring-2 hover:ring-ring/30 " +
    (metric.toneCount ? tone.activeCount : "border-border bg-card hover:bg-accent");

  if (!metric.onClick) {
    return (
      <div className={className.replace(" hover:ring-2 hover:ring-ring/30", "")}>{content}</div>
    );
  }

  return (
    <button type="button" onClick={metric.onClick} className={className}>
      {content}
    </button>
  );
}

function AnalyticsChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="mb-4">
        <h3 className="text-sm font-bold">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function AnalyticsBarChart({
  data,
  valueKey,
  valueFormatter = formatNumber,
  height = 320,
}: {
  data: Array<{ name: string } & Record<string, number | string>>;
  valueKey: string;
  valueFormatter?: (value: number) => string;
  height?: number;
}) {
  if (!data.length) {
    return <div className="text-sm text-muted-foreground">No data available.</div>;
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 18, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
          <XAxis
            type="number"
            tickFormatter={(value) => valueFormatter(Number(value))}
            tick={{ fontSize: 11 }}
            stroke="hsl(var(--muted-foreground))"
          />
          <YAxis
            type="category"
            dataKey="name"
            width={118}
            tick={{ fontSize: 11 }}
            stroke="hsl(var(--muted-foreground))"
          />
          <Tooltip
            formatter={(value) => valueFormatter(Number(value))}
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          <Bar dataKey={valueKey} radius={[0, 4, 4, 0]} fill="hsl(var(--primary))" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AnalyticsPieChart({ data }: { data: Array<{ name: string; count: number }> }) {
  if (!data.length) {
    return <div className="text-sm text-muted-foreground">No data available.</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_0.9fr]">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="name" innerRadius={52} outerRadius={88}>
              {data.map((item, index) => (
                <Cell key={item.name} fill={chartColors[index % chartColors.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatNumber(Number(value))}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-2 self-center">
        {data.map((item, index) => (
          <div key={item.name} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: chartColors[index % chartColors.length] }}
              />
              <span className="truncate">{item.name}</span>
            </span>
            <span className="font-semibold tabular-nums">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsLineChart({
  data,
  valueKey,
}: {
  data: Array<{ name: string } & Record<string, number | string>>;
  valueKey: string;
}) {
  if (!data.length) {
    return <div className="text-sm text-muted-foreground">No data available.</div>;
  }

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 18, left: 4, bottom: 64 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="name"
            interval={0}
            angle={-35}
            textAnchor="end"
            tick={{ fontSize: 10 }}
            stroke="hsl(var(--muted-foreground))"
          />
          <YAxis
            tickFormatter={(value) => `${value}d`}
            tick={{ fontSize: 11 }}
            stroke="hsl(var(--muted-foreground))"
          />
          <Tooltip
            formatter={(value) => `${formatNumber(Number(value))}d`}
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey={valueKey}
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function AnalyticsRankingTable({
  columns,
  rows,
}: {
  columns: Array<{
    key: string;
    label: string;
    align?: "left" | "right";
    format?: (value: number | string) => string;
  }>;
  rows: Array<Record<string, number | string>>;
}) {
  if (!rows.length) {
    return <div className="text-sm text-muted-foreground">No data available.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase text-muted-foreground">
            {columns.map((column) => (
              <th
                key={column.key}
                className={
                  "py-2 font-medium " + (column.align === "left" ? "text-left" : "text-right")
                }
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.name)} className="border-b border-border/60 last:border-0">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={
                    "py-2 tabular-nums " +
                    (column.align === "left" ? "text-left font-medium" : "text-right")
                  }
                >
                  {column.format
                    ? column.format(row[column.key] ?? "")
                    : String(row[column.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalyticsMetric({
  label,
  value,
  helper,
  onClick,
}: {
  label: string;
  value: number | string;
  helper: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
      <span className="mt-2 block text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
      <span className="mt-1 block text-xs text-muted-foreground">{helper}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-xl border border-border bg-card p-4 text-left shadow-[var(--shadow-card)] hover:bg-accent"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      {content}
    </div>
  );
}

function AnalyticsMiniMetric({
  label,
  value,
  helper,
  onClick,
}: {
  label: string;
  value: number | string;
  helper: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="text-[11px] font-medium uppercase text-muted-foreground">{label}</span>
      <span className="mt-1 block text-xl font-semibold tabular-nums">{value}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{helper}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-md border border-border bg-secondary/35 px-3 py-2 text-left hover:bg-accent"
      >
        {content}
      </button>
    );
  }

  return <div className="rounded-md border border-border bg-secondary/35 px-3 py-2">{content}</div>;
}

function AnalyticsBarList({
  items,
  total,
  emptyLabel,
  onClick,
}: {
  items: Array<{ name: string; count: number }>;
  total: number;
  emptyLabel: string;
  onClick?: (item: { name: string; count: number }) => void;
}) {
  if (!items.length) return <div className="text-sm text-muted-foreground">{emptyLabel}</div>;

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const width = Math.max(4, getPercent(item.count, total) ?? 0);
        const row = (
          <>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{item.name}</span>
              <span className="shrink-0 font-semibold tabular-nums">{item.count}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
            </div>
          </>
        );

        if (onClick) {
          return (
            <button
              key={item.name}
              type="button"
              onClick={() => onClick(item)}
              className="w-full rounded-md border border-border bg-secondary/25 px-3 py-2 text-left hover:bg-accent"
            >
              {row}
            </button>
          );
        }

        return (
          <div
            key={item.name}
            className="rounded-md border border-border bg-secondary/25 px-3 py-2"
          >
            {row}
          </div>
        );
      })}
    </div>
  );
}

function MilestoneFlowNode({
  milestone,
  index,
  isLast,
  onTotalClick,
  onUnderProcessClick,
  onActiveClick,
  onReviewedClick,
  onPendingClick,
  onClearedClick,
  onLiveBidsClick,
  onBidOverdueClick,
  onLiveSupplyOrdersClick,
}: {
  milestone: {
    key: string;
    label: string;
    completedLabel: string;
    totalLabel: string;
    pendingLabel: string;
    total: number;
    underProcess: number;
    active: number;
    pending: number;
    reviewed: number;
    hasReviewed: boolean;
    cleared: number;
    activeLabel: string;
    liveBids?: number;
    overdueBids?: number;
    inProcessBids?: number;
    liveSupplyOrders?: number;
  };
  index: number;
  isLast: boolean;
  onTotalClick: () => void;
  onUnderProcessClick: () => void;
  onActiveClick: () => void;
  onReviewedClick: () => void;
  onPendingClick: () => void;
  onClearedClick: () => void;
  onLiveBidsClick: () => void;
  onBidOverdueClick: () => void;
  onLiveSupplyOrdersClick: () => void;
}) {
  const tone = getMilestoneTone(milestone.active);
  const widthPercent =
    milestone.total > 0 ? Math.round((milestone.cleared / milestone.total) * 100) : 0;
  const metrics = getStatusMetrics({
    milestone,
    onTotalClick,
    onUnderProcessClick,
    onActiveClick,
    onReviewedClick,
    onPendingClick,
    onClearedClick,
    onLiveBidsClick,
    onBidOverdueClick,
    onLiveSupplyOrdersClick,
  });
  const metricGridClass = "grid grid-cols-2 gap-1.5 sm:grid-cols-3";

  return (
    <div className="relative min-w-0">
      <div
        className={
          "group flex h-full w-full flex-col justify-between rounded-lg border p-2.5 text-left transition hover:shadow-[var(--shadow-card)] " +
          tone.card
        }
      >
        <span className="flex flex-col gap-2">
          <span className="flex min-w-0 items-center gap-2 border-b border-border/60 pb-2">
            <span
              className={
                "grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-bold " +
                tone.step
              }
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{milestone.label}</span>
            </span>
          </span>
          {milestone.key === "scrutiny" || milestone.key === "cfa" ? (
            <ScrutinyMetricGrid metrics={metrics} tone={tone} />
          ) : (
            <span className={metricGridClass}>
              {metrics.map((metric) => (
                <StatusMetricBox key={metric.label} metric={metric} tone={tone} />
              ))}
            </span>
          )}
        </span>
        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-background">
          <span
            className={"block h-full rounded-full " + tone.bar}
            style={{ width: `${widthPercent}%` }}
          />
        </span>
      </div>
      {!isLast ? (
        <div className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 translate-x-1/2 rounded-full border border-border bg-card p-1 text-muted-foreground xl:block">
          <ArrowRight className="size-4" />
        </div>
      ) : null}
    </div>
  );
}

function ScrutinyMetricGrid({
  metrics,
  tone,
}: {
  metrics: StatusMetric[];
  tone: ReturnType<typeof getMilestoneTone>;
}) {
  const active = metrics.find((metric) => metric.label === "In process");
  const reviewed = metrics.find((metric) => metric.label === "Reviewed");
  const pending = metrics.find((metric) => metric.label === "Pending");
  const total = metrics.find((metric) => metric.label === "Total files");
  const completed = metrics.find((metric) => metric.label === "Completed");

  if (!active || !reviewed || !pending || !total || !completed) {
    return (
      <span className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {metrics.map((metric) => (
          <StatusMetricBox key={metric.label} metric={metric} tone={tone} />
        ))}
      </span>
    );
  }

  return (
    <span className="grid gap-1.5">
      <span className="grid grid-cols-2 gap-1.5">
        <StatusMetricBox metric={total} tone={tone} />
        <StatusMetricBox metric={completed} tone={tone} />
      </span>
      <span className={"grid grid-cols-3 gap-1.5 rounded-md border p-1.5 " + tone.activeGroup}>
        <MetricButton metric={active} className={tone.activeCount} />
        <MetricButton metric={reviewed} className="bg-card hover:bg-accent" compact />
        <MetricButton metric={pending} className="bg-card hover:bg-accent" compact />
      </span>
    </span>
  );
}

function MetricButton({
  metric,
  className,
  compact = false,
}: {
  metric: StatusMetric;
  className?: string;
  compact?: boolean;
}) {
  const content = (
    <>
      <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
        {metric.label}
      </span>
      <span className={(compact ? "text-sm" : "text-base") + " block font-semibold tabular-nums"}>
        {metric.count}
      </span>
    </>
  );
  const baseClass =
    "min-h-12 rounded-md border border-border px-2 py-1.5 text-center transition hover:ring-2 hover:ring-ring/30 " +
    (className ?? "bg-card hover:bg-accent");

  if (!metric.onClick) {
    return (
      <div className={baseClass.replace(" hover:ring-2 hover:ring-ring/30", "")}>{content}</div>
    );
  }

  return (
    <button type="button" onClick={metric.onClick} className={baseClass}>
      {content}
    </button>
  );
}

function getStatusMetrics({
  milestone,
  onTotalClick,
  onUnderProcessClick,
  onActiveClick,
  onReviewedClick,
  onPendingClick,
  onClearedClick,
  onLiveBidsClick,
  onBidOverdueClick,
  onLiveSupplyOrdersClick,
}: {
  milestone: {
    key: string;
    completedLabel: string;
    totalLabel: string;
    pendingLabel: string;
    total: number;
    underProcess: number;
    active: number;
    pending: number;
    reviewed: number;
    cleared: number;
    activeLabel: string;
    liveBids?: number;
    overdueBids?: number;
    inProcessBids?: number;
    liveSupplyOrders?: number;
  };
  onTotalClick: () => void;
  onUnderProcessClick: () => void;
  onActiveClick: () => void;
  onReviewedClick: () => void;
  onPendingClick: () => void;
  onClearedClick: () => void;
  onLiveBidsClick: () => void;
  onBidOverdueClick: () => void;
  onLiveSupplyOrdersClick: () => void;
}): StatusMetric[] {
  const total = {
    label: milestone.totalLabel,
    count: milestone.total,
    onClick: onTotalClick,
  };
  const completed = {
    label: milestone.completedLabel,
    count: milestone.cleared,
    onClick: onClearedClick,
  };
  const previous = {
    label: "At previous stage",
    count: milestone.underProcess,
    onClick: onUnderProcessClick,
  };
  const active = {
    label: milestone.activeLabel,
    count: milestone.active,
    onClick: onActiveClick,
    toneCount: true,
  };
  const reviewed = { label: "Reviewed", count: milestone.reviewed, onClick: onReviewedClick };
  const pending = {
    label: milestone.pendingLabel,
    count: milestone.pending,
    onClick: onPendingClick,
  };

  if (milestone.key === "scrutiny" || milestone.key === "cfa") {
    return [active, reviewed, pending, total, completed];
  }

  if (["highValue", "tcec", "ifa", "postTcec", "cnc"].includes(milestone.key)) {
    return [total, completed, previous, active, reviewed, pending];
  }

  if (milestone.key === "bidding") {
    return [
      { label: "Live", count: milestone.liveBids ?? 0, onClick: onLiveBidsClick },
      { label: "In process", count: milestone.inProcessBids ?? 0, onClick: onActiveClick },
      { label: "Opening overdue", count: milestone.overdueBids ?? 0, onClick: onBidOverdueClick },
      completed,
      { label: "At previous stages", count: milestone.underProcess, onClick: onUnderProcessClick },
    ];
  }

  if (milestone.key === "supplyOrder") {
    return [
      completed,
      { label: "Live", count: milestone.liveSupplyOrders ?? 0, onClick: onLiveSupplyOrdersClick },
      { label: milestone.pendingLabel, count: milestone.pending, onClick: onPendingClick },
      { label: "At previous stages", count: milestone.underProcess, onClick: onUnderProcessClick },
    ];
  }

  if (milestone.key === "bankGuarantee") {
    return [
      total,
      completed,
      { label: milestone.pendingLabel, count: milestone.pending, onClick: onPendingClick },
      previous,
    ];
  }

  if (milestone.key === "payment") {
    return [
      completed,
      { label: milestone.pendingLabel, count: milestone.pending, onClick: onPendingClick },
      previous,
    ];
  }

  return [total, completed, active, previous];
}

function getStatusMetricsForExport(metrics: StatusMetric[], milestoneKey: string) {
  if (milestoneKey !== "scrutiny" && milestoneKey !== "cfa") return metrics;

  const displayOrder = ["Total files", "Completed", "In process", "Reviewed", "Pending"];
  return displayOrder
    .map((label) => metrics.find((metric) => metric.label === label))
    .filter((metric): metric is StatusMetric => Boolean(metric));
}

function DeliveryPeriodFlowNode({
  milestone,
  index,
  isLast,
  onValidClick,
  onExpiredClick,
  onExtendedClick,
}: {
  milestone: {
    key: string;
    label: string;
    valid: number;
    expired: number;
    extended: number;
  };
  index: number;
  isLast: boolean;
  onValidClick: () => void;
  onExpiredClick: () => void;
  onExtendedClick: () => void;
}) {
  const tone = getMilestoneTone(milestone.expired);

  return (
    <div className="relative min-w-0">
      <div
        className={
          "group flex h-full w-full flex-col justify-between rounded-lg border p-2.5 text-left transition hover:shadow-[var(--shadow-card)] " +
          tone.card
        }
      >
        <span className="flex flex-col gap-2">
          <span className="flex min-w-0 items-center gap-2 border-b border-border/60 pb-2">
            <span
              className={
                "grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-bold " +
                tone.step
              }
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{milestone.label}</span>
            </span>
          </span>
          <span className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={onValidClick}
              className="rounded-md border border-border bg-card px-2 py-1 text-center hover:bg-accent hover:ring-2 hover:ring-ring/30"
            >
              <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
                Valid
              </span>
              <span className="block text-base font-semibold tabular-nums">{milestone.valid}</span>
            </button>
            <button
              type="button"
              onClick={onExpiredClick}
              className={
                "rounded-md px-2 py-1 text-center hover:ring-2 hover:ring-ring/30 " + tone.count
              }
            >
              <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
                Expired
              </span>
              <span className="block text-base font-semibold tabular-nums">
                {milestone.expired}
              </span>
            </button>
            <button
              type="button"
              onClick={onExtendedClick}
              className="rounded-md border border-border bg-card px-2 py-1 text-center hover:bg-accent hover:ring-2 hover:ring-ring/30"
            >
              <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
                Extended
              </span>
              <span className="block text-base font-semibold tabular-nums">
                {milestone.extended}
              </span>
            </button>
          </span>
        </span>
      </div>
      {!isLast ? (
        <div className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 translate-x-1/2 rounded-full border border-border bg-card p-1 text-muted-foreground xl:block">
          <ArrowRight className="size-4" />
        </div>
      ) : null}
    </div>
  );
}

const previousStageLabelKeys = new Set([
  "highValue",
  "tcec",
  "ad",
  "rqa",
  "control",
  "ifa",
  "cfa",
  "bidding",
  "cnc",
  "postTcec",
  "supplyOrder",
  "bankGuarantee",
  "payment",
]);

function DeliveryFlowNode({
  milestone,
  index,
  isLast,
  onCompletedClick,
  onDueClick,
}: {
  milestone: {
    key: string;
    label: string;
    completed: number;
    due: number;
  };
  index: number;
  isLast: boolean;
  onCompletedClick: () => void;
  onDueClick: () => void;
}) {
  const tone = getMilestoneTone(milestone.due);

  return (
    <div className="relative min-w-0">
      <div
        className={
          "group flex h-full w-full flex-col justify-between rounded-lg border p-2.5 text-left transition hover:shadow-[var(--shadow-card)] " +
          tone.card
        }
      >
        <span className="flex flex-col gap-2">
          <span className="flex min-w-0 items-center gap-2 border-b border-border/60 pb-2">
            <span
              className={
                "grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-bold " +
                tone.step
              }
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{milestone.label}</span>
            </span>
          </span>
          <span className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onCompletedClick}
              className="rounded-md border border-border bg-card px-2 py-1 text-center hover:bg-accent hover:ring-2 hover:ring-ring/30"
            >
              <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
                Completed
              </span>
              <span className="block text-base font-semibold tabular-nums">
                {milestone.completed}
              </span>
            </button>
            <button
              type="button"
              onClick={onDueClick}
              className={
                "rounded-md px-2 py-1 text-center hover:ring-2 hover:ring-ring/30 " + tone.count
              }
            >
              <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
                Pending
              </span>
              <span className="block text-base font-semibold tabular-nums">{milestone.due}</span>
            </button>
          </span>
        </span>
      </div>
      {!isLast ? (
        <div className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 translate-x-1/2 rounded-full border border-border bg-card p-1 text-muted-foreground xl:block">
          <ArrowRight className="size-4" />
        </div>
      ) : null}
    </div>
  );
}

function getMilestoneTone(count: number) {
  if (count === 0) {
    return {
      card: "border-success/30 bg-success/10 hover:bg-success/15",
      step: "bg-success text-success-foreground",
      count: "bg-success/15 text-foreground",
      activeCount: "border-success/45 bg-success/20 text-foreground hover:bg-success/25",
      activeGroup: "border-success/35 bg-success/15",
      bar: "bg-success",
    };
  }
  if (count >= 10) {
    return {
      card: "border-destructive/30 bg-destructive/10 hover:bg-destructive/15",
      step: "bg-destructive text-destructive-foreground",
      count: "bg-destructive/15 text-foreground",
      activeCount:
        "border-destructive/45 bg-destructive/20 text-foreground hover:bg-destructive/25",
      activeGroup: "border-destructive/35 bg-destructive/15",
      bar: "bg-destructive",
    };
  }
  return {
    card: "border-warning/35 bg-warning/10 hover:bg-warning/15",
    step: "bg-warning text-warning-foreground",
    count: "bg-warning/15 text-foreground",
    activeCount: "border-warning/50 bg-warning/20 text-foreground hover:bg-warning/25",
    activeGroup: "border-warning/40 bg-warning/15",
    bar: "bg-warning",
  };
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

function getFileTypeCounts(files: ReturnType<typeof useAccessibleFiles>) {
  const fileTypes = ["General", "AMC", "MPC"];
  const counts = files.reduce<Record<string, number>>((current, file) => {
    const fileType = file.fileType?.trim();
    if (!fileType || !fileTypes.includes(fileType)) return current;
    current[fileType] = (current[fileType] ?? 0) + 1;
    return current;
  }, {});

  return fileTypes.map((name) => ({ name, count: counts[name] ?? 0 }));
}

const snapshotAttributeDefinitions = [
  { key: "tcec", label: "TCEC", yesLabel: "TCEC", noLabel: "Non TCEC" },
  { key: "gte", label: "GTE", yesLabel: "GTE", noLabel: "Non GTE" },
  { key: "gem", label: "GeM", yesLabel: "GeM", noLabel: "Non GeM" },
  { key: "highValue", label: "High Value", yesLabel: "High Value", noLabel: "Non High Value" },
  { key: "ad", label: "AD", yesLabel: "AD", noLabel: "Non AD" },
  { key: "rqa", label: "R&QA", yesLabel: "R&QA", noLabel: "Non R&QA" },
  { key: "ifa", label: "IFA", yesLabel: "IFA", noLabel: "Non IFA" },
  { key: "psb", label: "PSB", yesLabel: "PSB", noLabel: "Non PSB" },
  { key: "bg", label: "BG", yesLabel: "BG", noLabel: "Non BG" },
  {
    key: "rfpVetting",
    label: "RFP vetting",
    yesLabel: "RFP vetting",
    noLabel: "Non RFP vetting",
  },
  { key: "refloat", label: "Refloat", yesLabel: "Refloat", noLabel: "Non Refloat" },
  { key: "rst", label: "RST", yesLabel: "RST", noLabel: "Non RST" },
] satisfies Array<{
  key: keyof FileRecord;
  label: string;
  yesLabel: string;
  noLabel: string;
}>;

function getAttributeSummaryStats(files: ReturnType<typeof useAccessibleFiles>): SummaryStat[] {
  return snapshotAttributeDefinitions.map((attribute) => ({
    label: attribute.label,
    value: [
      {
        label: attribute.yesLabel,
        value: files.filter((file) => isYes(String(file[attribute.key] ?? ""))).length,
        searchFilter: `attribute:${attribute.key}:yes`,
      },
      {
        label: attribute.noLabel,
        value: files.filter((file) => isNo(String(file[attribute.key] ?? ""))).length,
        searchFilter: `attribute:${attribute.key}:no`,
      },
    ],
    hint: `${attribute.yesLabel} and ${attribute.noLabel} files`,
  }));
}

function getMiscellaneousCounts(files: ReturnType<typeof useAccessibleFiles>) {
  return {
    ld: files.filter((file) => fileSupplyOrders(file).some((order) => isYes(order.ld))).length,
    demandCancelled: files.filter((file) =>
      fileSupplyOrders(file).some((order) => isYes(order.demandCancelled)),
    ).length,
    soCancelled: files.filter((file) =>
      fileSupplyOrders(file).some((order) => isYes(order.soCancelled)),
    ).length,
    multipleSupplyOrders: files.filter((file) => fileSupplyOrders(file).length > 1).length,
  };
}

function getAnalyticsSummary(files: ReturnType<typeof useAccessibleFiles>) {
  return {
    divisionFileRanking: getDivisionFileRanking(files),
    divisionValueRanking: getDivisionValueRanking(files),
    divisionTurnaroundRanking: getDivisionTurnaroundRanking(files),
    topFirmSupplyOrders: getTopFirmSupplyOrders(files),
    topIndentorsByFiles: getTopIndentorsByFiles(files),
    topIndentorsByValue: getTopIndentorsByValue(files),
    milestoneClearingRanking: getMilestoneClearingRanking(files),
    monthlyFileInflow: getMonthlyFileInflow(files),
    biddingModeMix: getBiddingModeMix(files),
    fileValueThresholds: getFileValueThresholds(files),
    divisionRiskRanking: getDivisionRiskRanking(files),
    divisionPaymentPendingRanking: getDivisionPaymentPendingRanking(files),
  };
}

function getDivisionFileRanking(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const name = getAnalyticsName(file.division, "Unassigned");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return mapEntriesToSortedRows(counts, "count");
}

function getDivisionValueRanking(files: FileRecord[]) {
  const totals = new Map<string, number>();
  files.forEach((file) => {
    const name = getAnalyticsName(file.division, "Unassigned");
    totals.set(name, (totals.get(name) ?? 0) + getFileTotalValue(file));
  });
  return mapEntriesToSortedRows(totals, "value");
}

function getDivisionTurnaroundRanking(files: FileRecord[]) {
  const durations = new Map<string, number[]>();
  files.forEach((file) => {
    const days = getDayDifference(file.receivedDate, getFirstSoDate(file));
    if (days === undefined || days < 0) return;
    const name = getAnalyticsName(file.division, "Unassigned");
    durations.set(name, [...(durations.get(name) ?? []), days]);
  });

  return Array.from(durations.entries())
    .map(([name, values]) => ({
      name,
      averageDays: getRoundedAverage(values),
      sampleSize: values.length,
    }))
    .sort((a, b) => b.averageDays - a.averageDays);
}

function getTopFirmSupplyOrders(files: FileRecord[]) {
  const totals = new Map<string, number>();
  files.forEach((file) => {
    fileSupplyOrders(file).forEach((order) => {
      const name = getAnalyticsName(order.firm, "Unassigned firm");
      const value = getSupplyOrderTotalValue(file, order);
      if (value <= 0) return;
      totals.set(name, (totals.get(name) ?? 0) + value);
    });
  });
  return mapEntriesToSortedRows(totals, "value").slice(0, 20);
}

function getTopIndentorsByFiles(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const name = getAnalyticsName(file.indentor, "Unassigned indentor");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return mapEntriesToSortedRows(counts, "count").slice(0, 10);
}

function getTopIndentorsByValue(files: FileRecord[]) {
  const totals = new Map<string, number>();
  files.forEach((file) => {
    const name = getAnalyticsName(file.indentor, "Unassigned indentor");
    totals.set(name, (totals.get(name) ?? 0) + getFileTotalValue(file));
  });
  return mapEntriesToSortedRows(totals, "value").slice(0, 10);
}

function getMilestoneClearingRanking(files: FileRecord[]) {
  return milestoneClearingDefinitions
    .map((definition) => {
      const durations = files
        .map((file) => getDayDifference(definition.getStartDate(file), definition.getEndDate(file)))
        .filter((days): days is number => days !== undefined && days >= 0);
      return {
        name: definition.name,
        averageDays: getRoundedAverage(durations),
        sampleSize: durations.length,
      };
    })
    .filter((item) => item.sampleSize > 0)
    .sort((a, b) => b.averageDays - a.averageDays);
}

function getMonthlyFileInflow(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const month = getMonthKey(file.receivedDate ?? file.date);
    if (!month) return;
    counts.set(month, (counts.get(month) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([name, count]) => ({ name, count }));
}

function getBiddingModeMix(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const name = getAnalyticsName(file.mode?.trim().toUpperCase(), "Unassigned");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return mapEntriesToSortedRows(counts, "count");
}

function getFileValueThresholds(files: FileRecord[]) {
  const values = files.map(getFileTotalValue);
  return [
    { name: "< 10,00,000", count: values.filter((value) => value < 1_000_000).length },
    { name: "> 10,00,000", count: values.filter((value) => value > 1_000_000).length },
    { name: "> 50,00,000", count: values.filter((value) => value > 5_000_000).length },
    { name: "> 1,00,00,000", count: values.filter((value) => value > 10_000_000).length },
  ];
}

function getDivisionRiskRanking(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    if (!isRiskFile(file)) return;
    const name = getAnalyticsName(file.division, "Unassigned");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return mapEntriesToSortedRows(counts, "count");
}

function getDivisionPaymentPendingRanking(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    if (!isPaymentPending(file)) return;
    const name = getAnalyticsName(file.division, "Unassigned");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return mapEntriesToSortedRows(counts, "count");
}

function isRiskFile(file: FileRecord) {
  return (
    isDeliveryDue(file) ||
    isDeliveryPeriodExpired(file) ||
    fileSupplyOrders(file).some(
      (order) => isYes(order.ld) || isYes(order.demandCancelled) || isYes(order.soCancelled),
    )
  );
}

const milestoneClearingDefinitions = [
  {
    name: "Scrutiny",
    getStartDate: (file: FileRecord) => file.receivedDate,
    getEndDate: (file: FileRecord) => file.scrutinyCompletionDate,
  },
  {
    name: "High Value",
    getStartDate: (file: FileRecord) => file.highValueMeetingDate,
    getEndDate: (file: FileRecord) => file.highValueMinutesDate,
  },
  {
    name: "Pre-TCEC",
    getStartDate: (file: FileRecord) => file.preTcecDate,
    getEndDate: (file: FileRecord) => file.preTcecMinutesDate,
  },
  {
    name: "AD",
    getStartDate: (file: FileRecord) => file.preTcecMinutesDate ?? file.receivedDate,
    getEndDate: (file: FileRecord) => file.adVettingDate,
  },
  {
    name: "R&QA",
    getStartDate: (file: FileRecord) => file.receivedDate,
    getEndDate: (file: FileRecord) => file.rqaApprovalDate,
  },
  {
    name: "Controlling",
    getStartDate: (file: FileRecord) => file.receivedDate,
    getEndDate: (file: FileRecord) => file.immsDate,
  },
  {
    name: "IFA",
    getStartDate: (file: FileRecord) => file.ifaSentDate,
    getEndDate: (file: FileRecord) => file.ifaFinalDate,
  },
  {
    name: "CFA",
    getStartDate: (file: FileRecord) => file.cfaSentDate,
    getEndDate: (file: FileRecord) => file.cfaDate,
  },
  {
    name: "Post-TCEC",
    getStartDate: (file: FileRecord) => file.postTcecDate,
    getEndDate: (file: FileRecord) => file.postTcecMinutesDate,
  },
  {
    name: "CNC",
    getStartDate: (file: FileRecord) => file.cncDate,
    getEndDate: (file: FileRecord) => file.cncApprovalDate,
  },
  {
    name: "Supply Order",
    getStartDate: (file: FileRecord) => file.cfaDate,
    getEndDate: getFirstSoDate,
  },
  {
    name: "Bank Guarantee",
    getStartDate: getFirstSoDate,
    getEndDate: (file: FileRecord) => getEarliestSupplyOrderDate(file, "bgValidityDate"),
  },
  {
    name: "Delivery",
    getStartDate: getFirstSoDate,
    getEndDate: (file: FileRecord) => getEarliestSupplyOrderDate(file, "materialReceiptDate"),
  },
  {
    name: "Payment",
    getStartDate: (file: FileRecord) => getEarliestSupplyOrderDate(file, "materialReceiptDate"),
    getEndDate: getFirstPaymentDate,
  },
];

function getFileTotalValue(file: FileRecord) {
  return (
    (getInrAmount(file.valueCapital, file) ?? 0) + (getInrAmount(file.valueRevenue, file) ?? 0)
  );
}

function getSupplyOrderTotalValue(file: FileRecord, order: SupplyOrderDetail) {
  return (
    (getInrAmount(order.soValueCapital, file) ?? 0) +
    (getInrAmount(order.soValueRevenue, file) ?? 0)
  );
}

function mapEntriesToSortedRows<T extends "count" | "value">(values: Map<string, number>, key: T) {
  return Array.from(values.entries())
    .map(
      ([name, value]) =>
        ({ name, [key]: Math.round(value) }) as { name: string } & Record<T, number>,
    )
    .sort((a, b) => b[key] - a[key]);
}

function getRoundedAverage(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getAnalyticsName(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function getMonthKey(date: string | undefined) {
  if (!date || !hasDate(date)) return undefined;
  return date.slice(0, 7);
}

function getAverageCycleMetric(
  files: FileRecord[],
  label: string,
  startKey: keyof FileRecord,
  getEndDate: (file: FileRecord) => string | undefined,
) {
  const durations = files
    .map((file) => {
      const startDate = file[startKey];
      return getDayDifference(
        typeof startDate === "string" ? startDate : undefined,
        getEndDate(file),
      );
    })
    .filter((value): value is number => value !== undefined && value >= 0);
  const average = durations.length
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
    : undefined;

  return {
    label,
    value: average === undefined ? "-" : `${average}d`,
    sampleSize: durations.length,
  };
}

function getDayDifference(fromDate: string | undefined, toDate: string | undefined) {
  const fromTime = parseLocalDateTime(fromDate ?? "");
  const toTime = parseLocalDateTime(toDate ?? "");
  if (fromTime === undefined || toTime === undefined) return undefined;
  return Math.round((toTime - fromTime) / 86_400_000);
}

function getFirstSoDate(file: FileRecord) {
  return getEarliestSupplyOrderDate(file, "soDate");
}

function getFirstPaymentDate(file: FileRecord) {
  return getEarliestSupplyOrderDate(file, "paymentDate");
}

function getEarliestSupplyOrderDate(file: FileRecord, key: keyof SupplyOrderDetail) {
  return fileSupplyOrders(file)
    .map((order) => String(order[key] ?? ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))[0];
}

function isSupplyOrderPlacedByDate(file: FileRecord) {
  return fileSupplyOrders(file).some(hasSupplyOrderDate);
}

function isPaymentPending(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) => hasFilledString(order.materialReceiptDate) && !hasFilledString(order.paymentDate),
  );
}

const milestoneDefinitions = [
  {
    key: "scrutiny",
    label: "Scrutiny",
    totalLabel: "Total files",
    reviewed: "scrutinyDate",
    current: "scrutinyCompletionDate",
  },
  {
    key: "highValue",
    label: "High Value",
    totalLabel: "Total cases",
    reviewed: "highValueMeetingDate",
    current: "highValueMinutesDate",
    applies: (file) => isYes(file.highValue),
  },
  {
    key: "tcec",
    label: "Pre-TCEC",
    totalLabel: "Total cases",
    reviewed: "preTcecDate",
    current: "preTcecMinutesDate",
    applies: (file) => isYes(file.tcec),
  },
  {
    key: "ad",
    label: "AD",
    totalLabel: "Total cases",
    current: "adVettingDate",
    applies: (file) => isYes(file.ad),
  },
  {
    key: "rqa",
    label: "R&QA",
    totalLabel: "Total cases",
    current: "rqaApprovalDate",
    applies: (file) => isYes(file.rqa),
  },
  { key: "control", label: "Controlling", totalLabel: "Total files", current: "immsDate" },
  {
    key: "ifa",
    label: "IFA",
    totalLabel: "Total cases",
    reviewed: "ifaSentDate",
    current: "ifaFinalDate",
    applies: (file) => isYes(file.ifa),
  },
  {
    key: "cfa",
    label: "CFA",
    totalLabel: "Total files",
    reviewed: "cfaSentDate",
    current: "cfaDate",
  },
  {
    key: "bidding",
    label: "Bidding",
    totalLabel: "Total files",
    current: "biddingStageOver",
  },
  {
    key: "postTcec",
    label: "Post-TCEC",
    totalLabel: "Total cases",
    reviewed: "postTcecDate",
    current: "postTcecMinutesDate",
    applies: (file) => isYes(file.tcec),
  },
  {
    key: "cnc",
    label: "CNC",
    totalLabel: "Total cases",
    reviewed: "cncDate",
    current: "cncApprovalDate",
    applies: (file) => isYes(file.tcec),
  },
  {
    key: "supplyOrder",
    label: "Supply Order",
    completedLabel: "Placed",
    totalLabel: "Total files",
    current: "soDate",
  },
  {
    key: "bankGuarantee",
    label: "Bank Guarantee",
    completedLabel: "Received",
    totalLabel: "Total files",
    current: "bgValidityDate",
    applies: (file) => isYes(file.bg),
  },
  { key: "payment", label: "Payment", totalLabel: "Total files", current: "paymentDate" },
] satisfies Array<{
  key: string;
  label: string;
  completedLabel?: string;
  totalLabel?: string;
  pendingLabel?: string;
  reviewed?: keyof FileRecord | keyof SupplyOrderDetail;
  current: keyof FileRecord | keyof SupplyOrderDetail;
  applies?: (file: FileRecord) => boolean;
}>;

const defaultManualMilestones = [
  "Scrutiny",
  "High Value",
  "Pre-TCEC",
  "AD",
  "R&QA",
  "Controlled",
  "IFA",
  "CFA",
  "Bidding",
  "Post-TCEC",
  "CNC",
  "Supply Order",
  "Delivery Period",
  "Bank Guarantee",
  "Delivery",
  "Payment",
];

function getConfiguredMilestones(milestones: string[] | undefined) {
  const values = (milestones ?? []).map((item) => item.trim()).filter(Boolean);
  return values.length ? values : defaultManualMilestones;
}

function getManualMilestoneFlow(
  files: ReturnType<typeof useAccessibleFiles>,
  milestones: string[],
) {
  return milestones.map((name) => ({
    name,
    current: files.filter((file) => file.currentMilestone === name).length,
    completed: files.filter((file) => file.completedMilestones?.includes(name)).length,
  }));
}

function getMilestoneFlow(files: ReturnType<typeof useAccessibleFiles>) {
  const flow = milestoneDefinitions.map((milestone) => {
    const applicableFiles = files.filter((file) => isMilestoneApplicable(file, milestone));
    const reachedFiles = applicableFiles.filter((file) => isEligibleMilestone(file, milestone));
    const activeFiles = applicableFiles.filter((file) => isManualActiveMilestone(file, milestone));
    const reviewedFiles = activeFiles.filter((file) => isMilestoneReviewed(file, milestone));
    const clearedFiles = applicableFiles.filter((file) => isMilestoneComplete(file, milestone));
    const pendingFiles = activeFiles.filter((file) => isPendingMilestone(file, milestone));
    const total = applicableFiles.length;
    const cleared = clearedFiles.length;
    const pending = pendingFiles.length;

    if (milestone.key === "bankGuarantee") {
      const eligibleBgFiles = applicableFiles.filter(isBankGuaranteeEligible);
      const activeBgFiles = eligibleBgFiles.filter((file) =>
        isManualActiveMilestone(file, milestone),
      );
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: milestone.completedLabel ?? "Completed",
        totalLabel: milestone.totalLabel ?? "Total files",
        pendingLabel: getMilestonePendingLabel(milestone),
        total: eligibleBgFiles.length,
        underProcess: Math.max(
          0,
          applicableFiles.filter((file) => !isEligibleMilestone(file, milestone)).length,
        ),
        active: activeBgFiles.length,
        pending: activeBgFiles.filter((file) => !hasMilestoneDate(file, milestone.current)).length,
        reviewed: 0,
        hasReviewed: Boolean(milestone.reviewed),
        cleared: eligibleBgFiles.filter((file) => hasMilestoneDate(file, milestone.current)).length,
        activeLabel: "In process",
      };
    }

    return {
      key: milestone.key,
      label: milestone.label,
      completedLabel: milestone.completedLabel ?? "Completed",
      totalLabel: milestone.totalLabel ?? "Total",
      pendingLabel: getMilestonePendingLabel(milestone),
      total,
      underProcess: Math.max(0, applicableFiles.length - reachedFiles.length),
      active: activeFiles.length,
      pending,
      reviewed: reviewedFiles.length,
      hasReviewed: Boolean(milestone.reviewed),
      cleared,
      activeLabel: "In process",
      liveBids:
        milestone.key === "bidding" ? applicableFiles.filter(isFileTenderLive).length : undefined,
      overdueBids:
        milestone.key === "bidding" ? applicableFiles.filter(isBidOverdue).length : undefined,
      inProcessBids:
        milestone.key === "bidding"
          ? activeFiles.filter((file) => !isFileTenderLive(file)).length
          : undefined,
      liveSupplyOrders:
        milestone.key === "supplyOrder"
          ? applicableFiles.filter(isLiveSupplyOrder).length
          : undefined,
    };
  });
  const supplyOrderIndex = flow.findIndex((milestone) => milestone.key === "supplyOrder");
  const delivery = {
    key: "delivery",
    label: "Delivery",
    completed: files.filter(isDeliveryCompleted).length,
    due: files.filter(isDeliveryDue).length,
  };
  const deliveryPeriod = {
    key: "deliveryPeriod",
    label: "Delivery Period",
    valid: files.filter(isDeliveryPeriodValid).length,
    expired: files.filter(isDeliveryPeriodExpired).length,
    extended: files.filter(isDeliveryPeriodExtended).length,
  };

  const withDeliveryPeriod =
    supplyOrderIndex === -1
      ? [...flow, deliveryPeriod]
      : [
          ...flow.slice(0, supplyOrderIndex + 1),
          deliveryPeriod,
          ...flow.slice(supplyOrderIndex + 1),
        ];
  const bankGuaranteeIndex = withDeliveryPeriod.findIndex(
    (milestone) => milestone.key === "bankGuarantee",
  );

  if (bankGuaranteeIndex === -1) return [...withDeliveryPeriod, delivery];
  return [
    ...withDeliveryPeriod.slice(0, bankGuaranteeIndex + 1),
    delivery,
    ...withDeliveryPeriod.slice(bankGuaranteeIndex + 1),
  ];
}

function getMilestonePendingLabel(milestone: (typeof milestoneDefinitions)[number]) {
  if (!("pendingLabel" in milestone)) return "Pending";
  return typeof milestone.pendingLabel === "string" ? milestone.pendingLabel : "Pending";
}

function isPendingMilestone(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (milestone.reviewed) {
    return (
      isManualActiveMilestone(file, milestone) &&
      !hasMilestoneDate(file, milestone.reviewed) &&
      !isMilestoneComplete(file, milestone)
    );
  }

  return isManualActiveMilestone(file, milestone) && !isMilestoneComplete(file, milestone);
}

function isEligibleMilestone(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  return (
    isMilestoneApplicable(file, milestone) && isPreviousApplicableMilestoneComplete(file, milestone)
  );
}

function isMilestoneApplicable(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  return milestone.applies ? milestone.applies(file) : true;
}

function isPreviousApplicableMilestoneComplete(
  file: FileRecord,
  milestone: (typeof milestoneDefinitions)[number],
) {
  if (milestone.key === "bankGuarantee") {
    return isSupplyOrderPlaced(file);
  }

  let previousMilestone: (typeof milestoneDefinitions)[number] | undefined;
  for (const item of milestoneDefinitions) {
    if (item.key === milestone.key) break;
    if (isMilestoneApplicable(file, item)) {
      previousMilestone = item;
    }
  }
  return previousMilestone
    ? isMilestoneComplete(file, previousMilestone)
    : hasMilestoneDate(file, "receivedDate");
}

function isMilestoneComplete(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (milestone.key === "bidding") {
    return isYes(file.biddingStageOver);
  }
  return hasMilestoneDate(file, milestone.current);
}

function isMilestoneReviewed(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (!milestone.reviewed) return false;
  return (
    isManualActiveMilestone(file, milestone) &&
    hasMilestoneDate(file, milestone.reviewed) &&
    !isMilestoneComplete(file, milestone)
  );
}

function isManualActiveMilestone(
  file: FileRecord,
  milestone: (typeof milestoneDefinitions)[number],
) {
  const current = normalizeMilestoneName(file.currentMilestone);
  return getMilestoneNameAliases(milestone).some(
    (name) => current === normalizeMilestoneName(name),
  );
}

function getMilestoneNameAliases(milestone: (typeof milestoneDefinitions)[number]) {
  return milestone.key === "control" ? [milestone.label, "Controlled"] : [milestone.label];
}

function normalizeMilestoneName(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function hasMilestoneDate(file: FileRecord, key: keyof FileRecord | keyof SupplyOrderDetail) {
  return supplyOrderDateKeys.has(key as keyof SupplyOrderDetail)
    ? fileSupplyOrders(file).some((order) => hasFilledString(order[key as keyof SupplyOrderDetail]))
    : hasFilledField(file, key as keyof FileRecord);
}

const supplyOrderDateKeys = new Set<keyof SupplyOrderDetail>([
  "soDate",
  "bgValidityDate",
  "paymentDate",
]);

function fileSupplyOrders(file: FileRecord) {
  const rows =
    file.supplyOrders
      ?.map((row) => ({ ...row }))
      .filter((row) => Object.values(row).some((value) => Boolean(String(value ?? "").trim()))) ??
    [];
  if (rows.length) return rows;

  const legacy: SupplyOrderDetail = {
    soDate: file.soDate,
    dpDate: file.dpDate,
    bgValidityDate: file.bgValidityDate,
    dpExtension: file.dpExtension,
    revisedDp: file.revisedDp,
    materialReceiptDate: file.materialReceiptDate,
    paymentDate: file.paymentDate,
    bgReturnDate: file.bgReturnDate,
    soCancelled: file.soCancelled,
  };
  return Object.values(legacy).some((value) => Boolean(String(value ?? "").trim())) ? [legacy] : [];
}

function hasFilledField(file: FileRecord, key: keyof FileRecord) {
  const value = file[key];
  return typeof value === "string" ? hasFilledString(value) : Boolean(value);
}

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
}

function isYes(value: string | undefined) {
  return value?.trim().toLowerCase() === "yes";
}

function isNo(value: string | undefined) {
  return value?.trim().toLowerCase() === "no";
}

function isFileTenderLive(file: FileRecord) {
  return isYes(file.tenderLive);
}

function isBidOverdue(file: FileRecord) {
  return (
    isNo(file.bidOpened) &&
    (isDateBeforeToday(file.bidOpeningDate) || isDateBeforeToday(file.refloatBidOpeningDate))
  );
}

function isLiveSupplyOrder(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) =>
      hasSupplyOrderDate(order) &&
      !hasFilledString(order.materialReceiptDate) &&
      !isYes(order.soCancelled),
  );
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

function isDeliveryCompleted(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isCompletedDeliveryOrder);
}

function isDeliveryDue(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isDueDeliveryOrder);
}

function isDeliveryActive(file: FileRecord) {
  return isSupplyOrderPlaced(file);
}

function isCompletedDeliveryOrder(order: SupplyOrderDetail) {
  return hasSupplyOrderDate(order) && hasFilledString(order.materialReceiptDate);
}

function isDueDeliveryOrder(order: SupplyOrderDetail) {
  return (
    hasSupplyOrderDate(order) &&
    !hasFilledString(order.materialReceiptDate) &&
    !isYes(order.soCancelled)
  );
}

function getDeliveryDueDate(order: SupplyOrderDetail) {
  return hasFilledString(order.revisedDp) ? order.revisedDp : order.dpDate;
}

function isDeliveryPeriodValid(file: FileRecord) {
  return isDeliveryPeriodActive(file) && fileSupplyOrders(file).some(isValidDeliveryPeriodOrder);
}

function isDeliveryPeriodExpired(file: FileRecord) {
  return isDeliveryPeriodActive(file) && fileSupplyOrders(file).some(isExpiredDeliveryPeriodOrder);
}

function isDeliveryPeriodExtended(file: FileRecord) {
  return isDeliveryPeriodActive(file) && fileSupplyOrders(file).some(isExtendedDeliveryPeriodOrder);
}

function isDeliveryPeriodActive(file: FileRecord) {
  return isSupplyOrderPlaced(file);
}

function isSupplyOrderPlaced(file: FileRecord) {
  const supplyOrderMilestone = milestoneDefinitions.find(
    (milestone) => milestone.key === "supplyOrder",
  );
  return supplyOrderMilestone ? isMilestoneComplete(file, supplyOrderMilestone) : false;
}

function isBankGuaranteeEligible(file: FileRecord) {
  return (
    isYes(file.bg) &&
    fileSupplyOrders(file).some((order) => hasSupplyOrderDate(order) && !isYes(order.soCancelled))
  );
}

function isValidDeliveryPeriodOrder(order: SupplyOrderDetail) {
  return (
    hasSupplyOrderDate(order) &&
    !hasFilledString(order.revisedDp) &&
    isDateAfterToday(order.dpDate) &&
    !hasFilledString(order.materialReceiptDate)
  );
}

function isExpiredDeliveryPeriodOrder(order: SupplyOrderDetail) {
  const deliveryPeriodDate = getDeliveryPeriodDate(order);
  return (
    hasSupplyOrderDate(order) &&
    Boolean(deliveryPeriodDate) &&
    isDateBeforeToday(deliveryPeriodDate) &&
    !hasFilledString(order.materialReceiptDate)
  );
}

function isExtendedDeliveryPeriodOrder(order: SupplyOrderDetail) {
  return (
    hasSupplyOrderDate(order) &&
    hasFilledString(order.revisedDp) &&
    isDateAfterToday(order.revisedDp) &&
    !hasFilledString(order.materialReceiptDate)
  );
}

function getDeliveryPeriodDate(order: SupplyOrderDetail) {
  return hasFilledString(order.revisedDp) ? order.revisedDp : order.dpDate;
}

function hasSupplyOrderDate(order: SupplyOrderDetail) {
  return hasFilledString(order.soDate);
}

const statusExportHeaders = ["Division", "Indentor", "Demand description", "Last status", "Date"];
const statusPageExportHeaders = ["Section", "Metric", "Count"];
const financeExportHeaders = ["Category", "Capital", "Revenue", "Notes"];

type StatusPageExportRow = {
  section: string;
  metric: string;
  count: number;
};

type FinanceExportRow = {
  category: string;
  capital: string;
  revenue: string;
  notes: string;
};

const dashboardFilterTitles: Record<string, string> = {
  deliveryCompleted: "Delivery - Completed",
  deliveryDue: "Delivery - Pending",
  deliveryPeriodValid: "Delivery Period - Valid",
  deliveryPeriodExpired: "Delivery Period - Expired",
  deliveryPeriodExtended: "Delivery Period - Extended",
  liveBids: "Bidding - Live",
  bidOverdue: "Bidding - Opening overdue",
  liveSupplyOrders: "Supply Order - Live",
  miscLd: "Miscellaneous - LD",
  miscDemandCancelled: "Miscellaneous - Demand cancelled",
  miscSoCancelled: "Miscellaneous - S.O. cancelled",
  miscMultipleSupplyOrders: "Miscellaneous - Multiple S.O.",
};

const fileDateFields = [
  { key: "receivedDate", label: "Received" },
  { key: "scrutinyDate", label: "Scrutiny" },
  { key: "scrutinyResponseDate", label: "Scrutiny response" },
  { key: "scrutinyCompletionDate", label: "Scrutiny completion" },
  { key: "immsDate", label: "Controlling" },
  { key: "highValueMeetingDate", label: "High Value meeting" },
  { key: "highValueMinutesDate", label: "High Value minutes" },
  { key: "preTcecDate", label: "Pre-TCEC" },
  { key: "preTcecMinutesDate", label: "Pre-TCEC minutes" },
  { key: "adVettingDate", label: "AD vetting" },
  { key: "rqaApprovalDate", label: "R&QA approval" },
  { key: "ifaSentDate", label: "IFA sent" },
  { key: "ifaFinalDate", label: "IFA final" },
  { key: "cfaSentDate", label: "CFA sent" },
  { key: "cfaDate", label: "CFA" },
  { key: "gemUndertakingDate", label: "GEM undertaking" },
  { key: "rfpVettingInitiationDate", label: "RFP vetting initiation" },
  { key: "rfpVettingApprovalDate", label: "RFP vetting approval" },
  { key: "bidDate", label: "Bid" },
  { key: "bidOpeningDate", label: "Bid opening" },
  { key: "refloatBiddingDate", label: "Refloat bidding" },
  { key: "refloatBidOpeningDate", label: "Refloat bid opening" },
  { key: "postTcecDate", label: "Post-TCEC" },
  { key: "postTcecMinutesDate", label: "Post-TCEC minutes" },
  { key: "refloatPostTcecDate", label: "Refloat Post-TCEC" },
  { key: "refloatPostTcecMinutesDate", label: "Refloat Post-TCEC minutes" },
  { key: "cncDate", label: "CNC" },
  { key: "cncApprovalDate", label: "CNC approval" },
] satisfies Array<{ key: keyof FileRecord; label: string }>;

const supplyOrderDateFields = [
  { key: "soDate", label: "Supply Order" },
  { key: "dpDate", label: "Delivery period" },
  { key: "bgValidityDate", label: "BG validity" },
  { key: "revisedDp", label: "Revised DP" },
  { key: "materialReceiptDate", label: "Material receipt" },
  { key: "paymentDate", label: "Payment" },
  { key: "bgReturnDate", label: "BG return" },
] satisfies Array<{ key: keyof SupplyOrderDetail; label: string }>;

function isPaymentDue(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) => hasFilledString(order.materialReceiptDate) && !hasFilledString(order.paymentDate),
  );
}

function matchesDashboardFilter(file: FileRecord, filter: string) {
  if (filter.startsWith("mode:")) return (file.mode ?? "").trim().toUpperCase() === filter.slice(5);
  if (filter.startsWith("fileType:")) return (file.fileType ?? "").trim() === filter.slice(9);
  if (filter.startsWith("manualMilestoneCurrent:")) {
    return file.currentMilestone === filter.slice("manualMilestoneCurrent:".length);
  }
  if (filter.startsWith("manualMilestoneCompleted:")) {
    return Boolean(
      file.completedMilestones?.includes(filter.slice("manualMilestoneCompleted:".length)),
    );
  }
  if (filter === "totalFiles") return true;
  if (filter === "demandsControlled") return hasAny(file, ["imms"]);
  if (filter === "tcecFiles") return isYes(file.tcec);
  if (filter === "nonTcecFiles") return isNo(file.tcec);
  if (filter === "highValueFiles") return isYes(file.highValue);
  if (filter === "adYes") return isYes(file.ad);
  if (filter === "rqaVetting") return isYes(file.rqa);
  if (filter === "ifaConcurrence") return isYes(file.ifa);
  if (filter === "liveBids") return isFileTenderLive(file);
  if (filter === "bidOverdue") return isBidOverdue(file);
  if (filter === "supplyOrders") return hasAny(file, ["soDate"]);
  if (filter === "liveSupplyOrders") return isLiveSupplyOrder(file);
  if (filter === "bgToBeReceived") return isBgToBeReceived(file);
  if (filter === "bgToBeReturned") return isBgToBeReturned(file);
  if (filter === "dpExtension") return isYes(file.dpExtension);
  if (filter === "dpExpired") return isDpExpired(file);
  if (filter === "deliveryOverdue") return isDeliveryOverdue(file);
  if (filter === "deliveryCompleted") return isDeliveryCompleted(file);
  if (filter === "deliveryDue") return isDeliveryDue(file);
  if (filter === "deliveryPeriodValid") return isDeliveryPeriodValid(file);
  if (filter === "deliveryPeriodExpired") return isDeliveryPeriodExpired(file);
  if (filter === "deliveryPeriodExtended") return isDeliveryPeriodExtended(file);
  if (filter === "paymentDue") return isPaymentDue(file);
  if (filter === "miscLd") return fileSupplyOrders(file).some((order) => isYes(order.ld));
  if (filter === "miscDemandCancelled") {
    return fileSupplyOrders(file).some((order) => isYes(order.demandCancelled));
  }
  if (filter === "miscSoCancelled") {
    return fileSupplyOrders(file).some((order) => isYes(order.soCancelled));
  }
  if (filter === "miscMultipleSupplyOrders") return fileSupplyOrders(file).length > 1;
  if (filter === "scrutinyCompleted") return hasAny(file, ["scrutinyCompletionDate"]);
  if (filter === "scrutinyUnderProgress") return !hasAny(file, ["scrutinyDate"]);
  if (filter === "preTcecCompleted")
    return isYes(file.tcec) && hasAny(file, ["preTcecMinutesDate"]);
  if (filter === "preTcecRemaining")
    return isYes(file.tcec) && !hasAny(file, ["preTcecMinutesDate"]);
  if (filter === "highValueCompleted") return hasAny(file, ["highValueMinutesDate"]);
  if (filter === "highValueRemaining") return hasAny(file, ["highValueMeetingDate"]);
  if (filter === "adCompleted") return hasAny(file, ["adVettingDate"]);
  if (filter === "adRemaining")
    return hasAny(file, ["preTcecDate"]) && !hasAny(file, ["adVettingDate"]);
  if (filter === "rqaCompleted") return hasAny(file, ["rqaApprovalDate"]);
  if (filter === "rqaRemaining") return isYes(file.rqa) && !hasAny(file, ["rqaApprovalDate"]);
  if (filter === "ifaCompleted") return hasAny(file, ["ifaFinalDate"]);
  if (filter === "ifaRemaining") return hasAny(file, ["ifaSentDate"]);
  if (filter === "cfaCompleted") return hasAny(file, ["cfaDate"]);
  if (filter.startsWith("milestoneTotal:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(15));
    if (!milestone) return true;
    return milestone.key === "bankGuarantee"
      ? isBankGuaranteeEligible(file)
      : isMilestoneApplicable(file, milestone);
  }
  if (filter.startsWith("milestoneUnderProcess:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(22));
    return milestone
      ? isMilestoneApplicable(file, milestone) && !isEligibleMilestone(file, milestone)
      : true;
  }
  if (filter.startsWith("milestoneActive:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(16));
    if (!milestone) return true;
    if (milestone.key === "bidding") {
      return isManualActiveMilestone(file, milestone) && !isFileTenderLive(file);
    }
    return isManualActiveMilestone(file, milestone);
  }
  if (filter.startsWith("milestone:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(10));
    return milestone ? isPendingMilestone(file, milestone) : true;
  }
  if (filter.startsWith("milestoneReviewed:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(18));
    return milestone ? isMilestoneReviewed(file, milestone) : true;
  }
  if (filter.startsWith("milestonePending:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(17));
    return milestone ? isPendingMilestone(file, milestone) : true;
  }
  if (filter.startsWith("milestoneCleared:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(17));
    if (!milestone) return true;
    return milestone.key === "bankGuarantee"
      ? isBankGuaranteeEligible(file) && hasMilestoneDate(file, milestone.current)
      : isClearedMilestone(file, milestone);
  }
  if (filter.startsWith("milestoneEligible:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(18));
    return milestone ? isEligibleMilestone(file, milestone) : true;
  }
  if (filter === "soCompleted") return hasAny(file, ["soNo"]);
  if (filter === "soRemaining") return !hasAny(file, ["soNo"]);
  return true;
}

function getStatusPageExportRows(
  statusFlow: ReturnType<typeof getMilestoneFlow>,
  miscellaneousCounts: ReturnType<typeof getMiscellaneousCounts>,
  totalFiles: number,
): StatusPageExportRow[] {
  const noop = () => undefined;
  const rows: StatusPageExportRow[] = [
    { section: "Overall", metric: "Total files", count: totalFiles },
  ];

  statusFlow.forEach((milestone) => {
    if ("valid" in milestone) {
      rows.push(
        { section: milestone.label, metric: "Valid", count: milestone.valid },
        { section: milestone.label, metric: "Expired", count: milestone.expired },
        { section: milestone.label, metric: "Extended", count: milestone.extended },
      );
      return;
    }

    if ("due" in milestone) {
      rows.push(
        { section: milestone.label, metric: "Completed", count: milestone.completed },
        { section: milestone.label, metric: "Pending", count: milestone.due },
      );
      return;
    }

    getStatusMetricsForExport(
      getStatusMetrics({
        milestone,
        onTotalClick: noop,
        onUnderProcessClick: noop,
        onActiveClick: noop,
        onReviewedClick: noop,
        onPendingClick: noop,
        onClearedClick: noop,
        onLiveBidsClick: noop,
        onBidOverdueClick: noop,
        onLiveSupplyOrdersClick: noop,
      }),
      milestone.key,
    ).forEach((metric) => {
      rows.push({ section: milestone.label, metric: metric.label, count: metric.count });
    });
  });

  rows.push(
    { section: "Miscellaneous", metric: "LD", count: miscellaneousCounts.ld },
    {
      section: "Miscellaneous",
      metric: "Demand cancelled",
      count: miscellaneousCounts.demandCancelled,
    },
    { section: "Miscellaneous", metric: "S.O. cancelled", count: miscellaneousCounts.soCancelled },
    {
      section: "Miscellaneous",
      metric: "Multiple S.O.",
      count: miscellaneousCounts.multipleSupplyOrders,
    },
  );

  return rows;
}

function exportStatusPageRowsToExcel(rows: StatusPageExportRow[], title: string) {
  const worksheet = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        <table>
          <thead>
            <tr><th colspan="3">${escapeHtml(title)}</th></tr>
            <tr>${statusPageExportHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) =>
                  `<tr>${[row.section, row.metric, row.count]
                    .map((value) => `<td>${escapeHtml(value)}</td>`)
                    .join("")}</tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;
  const blob = new Blob([worksheet], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${getExportFileName(title)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printStatusPageRowsToPdf(rows: StatusPageExportRow[], title: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    window.alert("Please allow pop-ups to generate the PDF report.");
    return;
  }

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
          h1 { font-size: 18px; margin: 0 0 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #d1d5db; padding: 7px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; font-weight: 700; }
          td:nth-child(3), th:nth-child(3) { text-align: right; }
          @media print { body { margin: 12mm; } }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <table>
          <thead>
            <tr>${statusPageExportHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) =>
                  `<tr>${[row.section, row.metric, row.count]
                    .map((value) => `<td>${escapeHtml(value)}</td>`)
                    .join("")}</tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function exportStatusFilesToExcel(files: FileRecord[], dashboardFilter: string) {
  const rows = getStatusExportRows(files);
  const title = getDashboardFilterTitle(dashboardFilter);
  const worksheet = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        <table>
          <thead>
            <tr><th colspan="5">${escapeHtml(title)}</th></tr>
            <tr>${statusExportHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) =>
                  `<tr>${[
                    row.division,
                    row.indentor,
                    row.demandDescription,
                    row.lastDateDescription,
                    row.lastDate,
                  ]
                    .map((value) => `<td>${escapeHtml(value)}</td>`)
                    .join("")}</tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;
  const blob = new Blob([worksheet], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${getExportFileName(title)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportFinanceRowsToExcel(rows: FinanceExportRow[], title: string) {
  const worksheet = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        <table>
          <thead>
            <tr><th colspan="4">${escapeHtml(title)}</th></tr>
            <tr>${financeExportHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) =>
                  `<tr>${[row.category, row.capital, row.revenue, row.notes]
                    .map((value) => `<td>${escapeHtml(value)}</td>`)
                    .join("")}</tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;
  const blob = new Blob([worksheet], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${getExportFileName(title)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printStatusFilesToPdf(files: FileRecord[], dashboardFilter: string) {
  const rows = getStatusExportRows(files);
  const title = getDashboardFilterTitle(dashboardFilter);
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    window.alert("Please allow pop-ups to generate the PDF report.");
    return;
  }

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
          h1 { font-size: 18px; margin: 0 0 4px; }
          p { margin: 0 0 16px; color: #4b5563; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; font-weight: 700; }
          @media print { body { margin: 12mm; } }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <p>Total records: ${rows.length}</p>
        <table>
          <thead>
            <tr>${statusExportHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) =>
                  `<tr>${[
                    row.division,
                    row.indentor,
                    row.demandDescription,
                    row.lastDateDescription,
                    row.lastDate,
                  ]
                    .map((value) => `<td>${escapeHtml(value)}</td>`)
                    .join("")}</tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function printFinanceRowsToPdf(rows: FinanceExportRow[], title: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    window.alert("Please allow pop-ups to generate the PDF report.");
    return;
  }

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
          h1 { font-size: 18px; margin: 0 0 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #d1d5db; padding: 7px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; font-weight: 700; }
          td:nth-child(2), td:nth-child(3), th:nth-child(2), th:nth-child(3) { text-align: right; }
          @media print { body { margin: 12mm; } }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <table>
          <thead>
            <tr>${financeExportHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) =>
                  `<tr>${[row.category, row.capital, row.revenue, row.notes]
                    .map((value) => `<td>${escapeHtml(value)}</td>`)
                    .join("")}</tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function getStatusExportRows(files: FileRecord[]) {
  return files.map((file) => {
    const lastDate = getLastFilledDate(file);
    return {
      division: file.division ?? "",
      indentor: file.indentor ?? "",
      demandDescription: file.demandDescription ?? "",
      lastDateDescription: lastDate?.label ?? "",
      lastDate: lastDate?.value ?? "",
    };
  });
}

function getLastFilledDate(file: FileRecord) {
  const fileDates = fileDateFields
    .map((field) => ({ label: field.label, value: String(file[field.key] ?? "") }))
    .filter((field) => hasDate(field.value));
  const supplyOrderDates = fileSupplyOrders(file).flatMap((order, index) =>
    supplyOrderDateFields
      .map((field) => ({
        label: `${field.label}${fileSupplyOrders(file).length > 1 ? ` (S.O. ${index + 1})` : ""}`,
        value: String(order[field.key] ?? ""),
      }))
      .filter((field) => hasDate(field.value)),
  );

  return [...fileDates, ...supplyOrderDates].sort(
    (a, b) => (parseLocalDateTime(b.value) ?? 0) - (parseLocalDateTime(a.value) ?? 0),
  )[0];
}

function getDashboardFilterTitle(filter: string) {
  if (filter.startsWith("milestoneTotal:")) {
    return `${getMilestoneTitle(filter.slice(15))} - Total files`;
  }
  if (filter.startsWith("milestoneUnderProcess:")) {
    return `${getMilestoneTitle(filter.slice(22))} - At previous stage`;
  }
  if (filter.startsWith("milestoneActive:")) {
    return `${getMilestoneTitle(filter.slice(16))} - In process`;
  }
  if (filter.startsWith("milestoneReviewed:")) {
    return `${getMilestoneTitle(filter.slice(18))} - Reviewed`;
  }
  if (filter.startsWith("milestonePending:")) {
    return `${getMilestoneTitle(filter.slice(17))} - Pending`;
  }
  if (filter.startsWith("milestoneCleared:")) {
    return `${getMilestoneTitle(filter.slice(17))} - Completed`;
  }
  return dashboardFilterTitles[filter] ?? "Status export";
}

function getMilestoneTitle(key: string) {
  return milestoneDefinitions.find((milestone) => milestone.key === key)?.label ?? key;
}

function getExportFileName(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(value: string | number | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isClearedMilestone(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  return isMilestoneApplicable(file, milestone) && isMilestoneComplete(file, milestone);
}

function hasAny(file: FileRecord, keys: Array<keyof FileRecord>) {
  return keys.some((key) => hasFilledField(file, key));
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

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactCurrency(value: number) {
  if (Math.abs(value) >= 10_000_000) {
    return `${formatThousandsAndLakhs(value / 10_000_000, 1)} Cr`;
  }
  if (Math.abs(value) >= 100_000) {
    return `${formatThousandsAndLakhs(value / 100_000, 1)} L`;
  }
  return formatThousandsAndLakhs(value, 0);
}
