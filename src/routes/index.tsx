import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  type Division,
  type FileRecord,
  type SupplyOrderDetail,
  type ValueThresholdLevel,
  store,
  useAccessibleDivisions,
  useAccessibleFiles,
  useActiveUser,
  useSettings,
} from "@/lib/files-store";
import { downloadBackendExport, downloadBackendFileSearchExport } from "@/lib/export-download";
import { formatThousandsAndLakhs, getInrAmount, hasAmount, parseAmount } from "@/lib/money";
import { isCancelledFile } from "@/lib/year-filter";
import { ArrowRight, FileSpreadsheet, FileText, Search } from "lucide-react";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/search", search: { dashboardFilter: undefined, division: undefined } });
  },
});

type DashboardTab = "snapshot" | "status" | "liveStatus" | "status3" | "analytics" | "finance";
type StatusActionMode = "pdf" | "excel" | "search";
type DivisionValueSortMode = "value" | "percent";
type DivisionValueDisplayMode = "value" | "percent" | "both";
type AnalyticsResultLimitKey = "5" | "10" | "20" | "50" | "all";
type AnalyticsSortDirection = "desc" | "asc";
type DivisionValueSortKey =
  | "allocatedCapital"
  | "allocatedRevenue"
  | "intendedCapital"
  | "intendedRevenue"
  | "bookedCapital"
  | "bookedRevenue"
  | "committedCapital"
  | "committedRevenue";
type DivisionTotalValueSortKey =
  | "allocatedTotal"
  | "intendedTotal"
  | "bookedTotal"
  | "committedTotal";
type DivisionValueMetricKey = "allocated" | "intended" | "booked" | "committed";
type AnalyticsPanelKey =
  | "divisionFiles"
  | "divisionValue"
  | "divisionTotalValue"
  | "divisionTurnaround"
  | "topFirms"
  | "indentorsByFiles"
  | "indentorsByValue"
  | "monthlyInflow"
  | "biddingMode"
  | "fileValueThresholds"
  | "paymentPending"
  | "milestoneClearingTable";
type AnalyticsTableColumn = {
  key: string;
  label: string;
  group?: string;
  align?: "left" | "right";
  format?: (value: number | string, row: Record<string, number | string>) => string;
  render?: (value: number | string, row: Record<string, number | string>) => ReactNode;
};
type AnalyticsPanel = {
  key: AnalyticsPanelKey;
  title: string;
  subtitle: string;
  exportNote?: string;
  divisionValueDisplayMode?: DivisionValueDisplayMode;
  columns: AnalyticsTableColumn[];
  rows: Array<Record<string, number | string>>;
};
type SummarySubMetric = { label: string; value: number | string; searchFilter?: string };
type FinanceSplitValue = { capital: string; revenue: string };
type SummaryMetricValue = number | string | FinanceSplitValue | SummarySubMetric[];
type SummaryStat = {
  label: string;
  value: SummaryMetricValue;
  hint?: string;
  searchFilter?: string;
};

const statusActionModes = [
  { key: "pdf", label: "PDF", icon: FileText },
  { key: "excel", label: "Excel", icon: FileSpreadsheet },
  { key: "search", label: "Search file", icon: Search },
] satisfies Array<{ key: StatusActionMode; label: string; icon: typeof Search }>;

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

type DashboardSummaryPayload = {
  activeDivision: string;
  activeAnalyticsDivision: string;
  dashboardFileCount: number;
  dashboardDivisions: Division[];
  modeCounts: ReturnType<typeof getModeCounts>;
  topSummaryStats: SummaryStat[];
  manualMilestoneFlow: ReturnType<typeof getManualMilestoneFlow>;
  visibleLiveMilestoneNames: string[];
  liveStatusRows: ReturnType<typeof getLiveStatusDivisionRows>;
  statusFlow: ReturnType<typeof getMilestoneFlow>;
  miscellaneousCounts: ReturnType<typeof getMiscellaneousCounts>;
  analytics: ReturnType<typeof getAnalyticsSummary>;
  divisionFilteredAnalytics: ReturnType<typeof getAnalyticsSummary>;
  financeTotals: {
    allocatedCapital: number;
    allocatedRevenue: number;
    bookedCapital: number;
    bookedRevenue: number;
    projectedCapital: number;
    projectedRevenue: number;
    spentCapital: number;
    spentRevenue: number;
  };
  financePercents: {
    capitalBooked?: number;
    revenueBooked?: number;
    capitalProjected?: number;
    revenueProjected?: number;
    capitalSpent?: number;
    revenueSpent?: number;
  };
};

type StatusSummaryTableRow = {
  milestone: string;
  counts: Partial<Record<string, number | string>>;
};

type StatusSummaryTableGroup = {
  key: string;
  title: string;
  columns: string[];
  rows: StatusSummaryTableRow[];
};

async function fetchDashboardSummary(query: string, signal: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}/api/dashboard/summary?${query}`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Dashboard summary request failed: ${response.status}`);
  }
  return (await response.json()) as { summary: DashboardSummaryPayload };
}

async function fetchDashboardStatusSummary(query: string, signal: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}/api/reports/summary?${query}`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Status summary request failed: ${response.status}`);
  }
  return (await response.json()) as { summary: { statusSummaryGroups: StatusSummaryTableGroup[] } };
}

async function downloadDashboardStatusFiles({
  dashboardFilter,
  division,
  selectedYear,
  format,
  title,
}: {
  dashboardFilter: string;
  division: string;
  selectedYear: string;
  format: "excel" | "pdf";
  title: string;
}) {
  await downloadBackendFileSearchExport({
    format,
    title,
    columns: statusExportFileColumns,
    query: {
      dashboardFilter,
      selectedYear,
      ...(division === "all" ? {} : { divisionFilter: division }),
    },
  });
}

const divisionFilterableAnalyticsPanels: AnalyticsPanelKey[] = [
  "topFirms",
  "indentorsByFiles",
  "indentorsByValue",
  "monthlyInflow",
  "biddingMode",
  "fileValueThresholds",
  "paymentPending",
  "milestoneClearingTable",
];
const analyticsResultLimitOptions = [
  { value: "5", label: "Top 5" },
  { value: "10", label: "Top 10" },
  { value: "20", label: "Top 20" },
  { value: "50", label: "Top 50" },
  { value: "all", label: "All" },
] satisfies Array<{ value: AnalyticsResultLimitKey; label: string }>;
const fileClosedMilestone = "File Closed";

function isDivisionFilterableAnalyticsPanel(panelKey: AnalyticsPanelKey) {
  return divisionFilterableAnalyticsPanels.includes(panelKey);
}

export function Dashboard() {
  const files = useMemo<FileRecord[]>(() => [], []);
  const divisions = useAccessibleDivisions();
  const settings = useSettings();
  const activeUser = useActiveUser();
  const navigate = useNavigate();
  const [selectedDivision, setSelectedDivision] = useState("all");
  const [activeDashboardTab, setActiveDashboardTab] = useState<DashboardTab>("status");
  const [statusActionMode, setStatusActionMode] = useState<StatusActionMode>("search");
  const [activeAnalyticsPanel, setActiveAnalyticsPanel] =
    useState<AnalyticsPanelKey>("divisionFiles");
  const [divisionValueSortMode, setDivisionValueSortMode] =
    useState<DivisionValueSortMode>("value");
  const [divisionValueDisplayMode, setDivisionValueDisplayMode] =
    useState<DivisionValueDisplayMode>("both");
  const [divisionValueSortKey, setDivisionValueSortKey] =
    useState<DivisionValueSortKey>("allocatedCapital");
  const [visibleDivisionValueMetrics, setVisibleDivisionValueMetrics] = useState<
    DivisionValueMetricKey[]
  >(["allocated", "intended", "booked", "committed"]);
  const [divisionTotalValueSortMode, setDivisionTotalValueSortMode] =
    useState<DivisionValueSortMode>("value");
  const [divisionTotalValueDisplayMode, setDivisionTotalValueDisplayMode] =
    useState<DivisionValueDisplayMode>("both");
  const [divisionTotalValueSortKey, setDivisionTotalValueSortKey] =
    useState<DivisionTotalValueSortKey>("allocatedTotal");
  const [visibleDivisionTotalValueMetrics, setVisibleDivisionTotalValueMetrics] = useState<
    DivisionValueMetricKey[]
  >(["allocated", "intended", "booked", "committed"]);
  const [topFirmLimit, setTopFirmLimit] = useState<AnalyticsResultLimitKey>("20");
  const [indentorsByFilesLimit, setIndentorsByFilesLimit] = useState<AnalyticsResultLimitKey>("10");
  const [indentorsByValueLimit, setIndentorsByValueLimit] = useState<AnalyticsResultLimitKey>("10");
  const [topFirmPage, setTopFirmPage] = useState(1);
  const [indentorsByFilesPage, setIndentorsByFilesPage] = useState(1);
  const [indentorsByValuePage, setIndentorsByValuePage] = useState(1);
  const [analyticsSortDirections, setAnalyticsSortDirections] = useState<
    Partial<Record<AnalyticsPanelKey, AnalyticsSortDirection>>
  >({});
  const [selectedAnalyticsDivision, setSelectedAnalyticsDivision] = useState("all");
  const [selectedLiveMilestones, setSelectedLiveMilestones] = useState<string[] | undefined>(
    settings.liveStatusLockedFields,
  );
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummaryPayload | undefined>();
  const [dashboardSummaryLoading, setDashboardSummaryLoading] = useState(false);
  const [hasLoadedDashboardSummary, setHasLoadedDashboardSummary] = useState(false);
  const [dashboardSummaryError, setDashboardSummaryError] = useState<string | undefined>();
  const [status3Groups, setStatus3Groups] = useState<StatusSummaryTableGroup[]>([]);
  const [status3Loading, setStatus3Loading] = useState(false);
  const [status3Error, setStatus3Error] = useState<string | undefined>();
  const hasLoadedDashboardSummaryRef = useRef(false);
  useEffect(() => {
    const visibleSortKeys = visibleDivisionValueMetrics.flatMap(
      (metric) => divisionValueMetricSortKeys[metric],
    );
    if (!visibleSortKeys.includes(divisionValueSortKey)) {
      setDivisionValueSortKey(visibleSortKeys[0] ?? "allocatedCapital");
    }
  }, [divisionValueSortKey, visibleDivisionValueMetrics]);
  useEffect(() => {
    const visibleSortKeys = visibleDivisionTotalValueMetrics.map(
      (metric) => divisionTotalValueMetricSortKeys[metric],
    );
    if (!visibleSortKeys.includes(divisionTotalValueSortKey)) {
      setDivisionTotalValueSortKey(visibleSortKeys[0] ?? "allocatedTotal");
    }
  }, [divisionTotalValueSortKey, visibleDivisionTotalValueMetrics]);
  useEffect(() => {
    setSelectedLiveMilestones(settings.liveStatusLockedFields);
  }, [settings.liveStatusLockedFields, activeUser?.id]);
  const selectedDivisionIsAccessible =
    selectedDivision === "all" || divisions.some((division) => division.name === selectedDivision);
  const activeDivision = selectedDivisionIsAccessible ? selectedDivision : "all";
  const selectedAnalyticsDivisionIsAccessible =
    selectedAnalyticsDivision === "all" ||
    divisions.some((division) => division.name === selectedAnalyticsDivision);
  const activeAnalyticsDivision = selectedAnalyticsDivisionIsAccessible
    ? selectedAnalyticsDivision
    : "all";
  const dashboardFiles = useMemo(
    () =>
      activeDivision === "all" ? files : files.filter((file) => file.division === activeDivision),
    [activeDivision, files],
  );
  const activeDashboardStatusFiles = useMemo(
    () => dashboardFiles,
    [dashboardFiles],
  );
  const dashboardDivisions = useMemo(
    () =>
      activeDivision === "all"
        ? divisions
        : divisions.filter((division) => division.name === activeDivision),
    [activeDivision, divisions],
  );
  const filteredAnalyticsFiles = useMemo(
    () =>
      activeAnalyticsDivision === "all"
        ? dashboardFiles
        : files.filter((file) => file.division === activeAnalyticsDivision),
    [activeAnalyticsDivision, dashboardFiles, files],
  );
  const filteredAnalyticsDivisions = useMemo(
    () =>
      activeAnalyticsDivision === "all"
        ? dashboardDivisions
        : divisions.filter((division) => division.name === activeAnalyticsDivision),
    [activeAnalyticsDivision, dashboardDivisions, divisions],
  );

  const dashboardSummaryQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("division", activeDivision);
    params.set("analyticsDivision", activeAnalyticsDivision);
    params.set("selectedYear", settings.selectedYear);
    if (selectedLiveMilestones) {
      params.set("liveMilestones", selectedLiveMilestones.join(","));
    }
    return params.toString();
  }, [activeDivision, activeAnalyticsDivision, selectedLiveMilestones, settings.selectedYear]);
  const status3Query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("division", activeDivision);
    params.set("selectedYear", settings.selectedYear);
    params.set("delayDays", "5");
    params.set("expectedCashOutgoDays", "10");
    params.set("delayMilestone", "all");
    return params.toString();
  }, [activeDivision, settings.selectedYear]);

  useEffect(() => {
    const controller = new AbortController();
    const delay = hasLoadedDashboardSummaryRef.current ? 180 : 0;
    const timeoutId = window.setTimeout(() => {
      setDashboardSummaryLoading(true);
      setDashboardSummaryError(undefined);

      fetchDashboardSummary(dashboardSummaryQuery, controller.signal)
        .then((payload) => {
          setDashboardSummary(payload.summary);
          setHasLoadedDashboardSummary(true);
          hasLoadedDashboardSummaryRef.current = true;
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.error(error);
          setDashboardSummaryError(
            error instanceof Error ? error.message : "Dashboard summary request failed.",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setDashboardSummaryLoading(false);
        });
    }, delay);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [dashboardSummaryQuery]);

  useEffect(() => {
    if (activeDashboardTab !== "status3") return;
    const controller = new AbortController();
    setStatus3Loading(true);
    setStatus3Error(undefined);
    fetchDashboardStatusSummary(status3Query, controller.signal)
      .then((payload) => setStatus3Groups(payload.summary.statusSummaryGroups))
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setStatus3Error(error instanceof Error ? error.message : "Status summary request failed.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatus3Loading(false);
      });

    return () => controller.abort();
  }, [activeDashboardTab, status3Query]);

  const needsLocalDashboardFallback = !dashboardSummary;
  const localModeCounts = needsLocalDashboardFallback ? getModeCounts(dashboardFiles) : undefined;
  const localManualMilestoneFlow = needsLocalDashboardFallback
    ? getManualMilestoneFlow(
        activeDashboardStatusFiles,
        getConfiguredMilestones(settings.milestones),
      )
    : undefined;
  const localVisibleLiveMilestoneNames =
    needsLocalDashboardFallback && localManualMilestoneFlow
      ? (selectedLiveMilestones?.filter((name) =>
          localManualMilestoneFlow.some((milestone) => milestone.name === name),
        ) ?? localManualMilestoneFlow.map((milestone) => milestone.name))
      : undefined;
  const localLiveStatusRows =
    needsLocalDashboardFallback && localVisibleLiveMilestoneNames
      ? getLiveStatusDivisionRows(
          activeDashboardStatusFiles,
          dashboardDivisions,
          localVisibleLiveMilestoneNames,
        )
      : undefined;
  const localStatusFlow = needsLocalDashboardFallback
    ? getMilestoneFlow(activeDashboardStatusFiles)
    : undefined;
  const localMiscellaneousCounts = needsLocalDashboardFallback
    ? getMiscellaneousCounts(dashboardFiles)
    : undefined;
  const localAnalytics = needsLocalDashboardFallback
    ? getAnalyticsSummary(dashboardFiles, dashboardDivisions, settings.valueThresholdLevels)
    : undefined;
  const localDivisionFilteredAnalytics = needsLocalDashboardFallback
    ? getAnalyticsSummary(
        filteredAnalyticsFiles,
        filteredAnalyticsDivisions,
        settings.valueThresholdLevels,
      )
    : undefined;
  const localFinanceTotals = needsLocalDashboardFallback
    ? {
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
            sum +
            (isCancelledFile(file)
              ? 0
              : hasAmount(file.soValueCapital)
                ? 0
                : (getInrAmount(file.valueCapital, file) ?? 0)),
          0,
        ),
        bookedRevenue: dashboardFiles.reduce(
          (sum, file) =>
            sum +
            (isCancelledFile(file)
              ? 0
              : hasAmount(file.soValueRevenue)
                ? 0
                : (getInrAmount(file.valueRevenue, file) ?? 0)),
          0,
        ),
        projectedCapital: dashboardFiles.reduce(
          (sum, file) =>
            sum +
            (!isCancelledFile(file) && !hasFilledField(file, "imms")
              ? (getInrAmount(file.valueCapital, file) ?? 0)
              : 0),
          0,
        ),
        projectedRevenue: dashboardFiles.reduce(
          (sum, file) =>
            sum +
            (!isCancelledFile(file) && !hasFilledField(file, "imms")
              ? (getInrAmount(file.valueRevenue, file) ?? 0)
              : 0),
          0,
        ),
        spentCapital: dashboardFiles.reduce(
          (sum, file) =>
            sum + (isCancelledFile(file) ? 0 : (getInrAmount(file.soValueCapital, file) ?? 0)),
          0,
        ),
        spentRevenue: dashboardFiles.reduce(
          (sum, file) =>
            sum + (isCancelledFile(file) ? 0 : (getInrAmount(file.soValueRevenue, file) ?? 0)),
          0,
        ),
      }
    : undefined;
  const dashboardFileCount = dashboardSummary?.dashboardFileCount ?? dashboardFiles.length;
  const dashboardDivisionsForView = dashboardSummary?.dashboardDivisions ?? dashboardDivisions;
  const modeCounts = dashboardSummary?.modeCounts ?? localModeCounts ?? [];
  const topSummaryStats =
    dashboardSummary?.topSummaryStats ??
    (needsLocalDashboardFallback ? getAttributeSummaryStats(dashboardFiles) : []);
  const manualMilestoneFlow = dashboardSummary?.manualMilestoneFlow ?? localManualMilestoneFlow;
  const visibleLiveMilestoneNames =
    selectedLiveMilestones && manualMilestoneFlow
      ? selectedLiveMilestones.filter((name) =>
          manualMilestoneFlow.some((milestone) => milestone.name === name),
        )
      : (dashboardSummary?.visibleLiveMilestoneNames ?? localVisibleLiveMilestoneNames ?? []);
  const lockLiveStatusSelection = () => {
    store.updateSettings({ liveStatusLockedFields: visibleLiveMilestoneNames });
  };
  const liveStatusRows = dashboardSummary?.liveStatusRows ?? localLiveStatusRows ?? [];
  const statusFlow = dashboardSummary?.statusFlow ?? localStatusFlow ?? [];
  const miscellaneousCounts = dashboardSummary?.miscellaneousCounts ??
    localMiscellaneousCounts ?? {
      liveFiles: 0,
      fileClosed: 0,
      ld: 0,
      demandCancelled: 0,
      soCancelled: 0,
      multipleSupplyOrders: 0,
    };
  const analytics = dashboardSummary?.analytics ??
    localAnalytics ?? {
      divisionFileRanking: [],
      divisionValueRanking: [],
      divisionTurnaroundRanking: [],
      topFirmSupplyOrders: [],
      topIndentorsByFiles: [],
      topIndentorsByValue: [],
      milestoneClearingRanking: [],
      monthlyFileInflow: [],
      biddingModeMix: [],
      fileValueThresholds: [],
      divisionRiskRanking: [],
      divisionPaymentPendingRanking: [],
    };
  const divisionFilteredAnalytics =
    dashboardSummary?.divisionFilteredAnalytics ?? localDivisionFilteredAnalytics ?? analytics;
  const assignedDivisionNames = getAssignedDivisionNames(activeUser?.divisionIds, divisions);
  const financeTotals = dashboardSummary?.financeTotals ??
    localFinanceTotals ?? {
      allocatedCapital: 0,
      allocatedRevenue: 0,
      bookedCapital: 0,
      bookedRevenue: 0,
      projectedCapital: 0,
      projectedRevenue: 0,
      spentCapital: 0,
      spentRevenue: 0,
    };
  const statusPageExportTitle =
    activeUser?.role === "admin"
      ? "ASL Buildup"
      : activeDivision === "all"
        ? dashboardDivisionsForView.map((division) => division.name).join(", ") || "Status"
        : activeDivision;
  const statusPageExportRows = getStatusPageExportRows(
    statusFlow,
    miscellaneousCounts,
    dashboardFileCount,
  );
  const capitalBookedPercent =
    dashboardSummary?.financePercents.capitalBooked ??
    getPercent(financeTotals.bookedCapital, financeTotals.allocatedCapital);
  const revenueBookedPercent =
    dashboardSummary?.financePercents.revenueBooked ??
    getPercent(financeTotals.bookedRevenue, financeTotals.allocatedRevenue);
  const capitalProjectedPercent =
    dashboardSummary?.financePercents.capitalProjected ??
    getPercent(financeTotals.projectedCapital, financeTotals.allocatedCapital);
  const revenueProjectedPercent =
    dashboardSummary?.financePercents.revenueProjected ??
    getPercent(financeTotals.projectedRevenue, financeTotals.allocatedRevenue);
  const capitalSpentPercent =
    dashboardSummary?.financePercents.capitalSpent ??
    getPercent(financeTotals.spentCapital, financeTotals.allocatedCapital);
  const revenueSpentPercent =
    dashboardSummary?.financePercents.revenueSpent ??
    getPercent(financeTotals.spentRevenue, financeTotals.allocatedRevenue);
  const biddingTypeSummaryStat: SummaryStat = {
    label: "Bidding type",
    value: modeCounts.map((mode) => ({
      label: mode.name,
      value: mode.count,
      searchFilter: `mode:${mode.name}`,
    })),
    hint: "Files grouped by bidding type",
  };

  const compactSummaryStats: SummaryStat[] = [];

  const summaryStats: SummaryStat[] = [];

  const financePercentStats = [
    {
      label: "Intended",
      value: {
        capital: formatPercent(capitalProjectedPercent),
        revenue: formatPercent(revenueProjectedPercent),
      },
      hint: "Capital / Revenue intended against allocation",
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
      category: "Intended",
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
  const getAnalyticsSortDirection = (panelKey: AnalyticsPanelKey) =>
    analyticsSortDirections[panelKey] ?? "desc";
  const setAnalyticsSortDirection = (
    panelKey: AnalyticsPanelKey,
    direction: AnalyticsSortDirection,
  ) => {
    setAnalyticsSortDirections((current) => ({ ...current, [panelKey]: direction }));
    if (panelKey === "topFirms") setTopFirmPage(1);
    if (panelKey === "indentorsByFiles") setIndentorsByFilesPage(1);
    if (panelKey === "indentorsByValue") setIndentorsByValuePage(1);
  };
  const topFirmRankedRows = withAnalyticsRanks(
    sortAnalyticsRows(
      divisionFilteredAnalytics.topFirmSupplyOrders,
      getAnalyticsSortDirection("topFirms"),
    ),
  );
  const topIndentorsByFilesRankedRows = withAnalyticsRanks(
    sortAnalyticsRows(
      divisionFilteredAnalytics.topIndentorsByFiles,
      getAnalyticsSortDirection("indentorsByFiles"),
    ),
  );
  const topIndentorsByValueRankedRows = withAnalyticsRanks(
    sortAnalyticsRows(
      divisionFilteredAnalytics.topIndentorsByValue,
      getAnalyticsSortDirection("indentorsByValue"),
    ),
  );
  const topFirmPagination = getAnalyticsPagination(topFirmRankedRows, topFirmLimit, topFirmPage);
  const indentorsByFilesPagination = getAnalyticsPagination(
    topIndentorsByFilesRankedRows,
    indentorsByFilesLimit,
    indentorsByFilesPage,
  );
  const indentorsByValuePagination = getAnalyticsPagination(
    topIndentorsByValueRankedRows,
    indentorsByValueLimit,
    indentorsByValuePage,
  );
  const analyticsPanels: AnalyticsPanel[] = [
    {
      key: "divisionFiles",
      title: "Division ranking by files",
      subtitle: "Number of files",
      columns: withRankAnalyticsColumns(getCountAnalyticsColumns("Division")),
      rows: withAnalyticsRanks(
        sortAnalyticsRows(
          withAssignedDivisionRows(analytics.divisionFileRanking, assignedDivisionNames),
          getAnalyticsSortDirection("divisionFiles"),
        ),
      ),
    },
    {
      key: "divisionValue",
      title: "Division ranking by value",
      subtitle: "",
      columns: withRankAnalyticsColumns(
        getDivisionValueAnalyticsColumns(visibleDivisionValueMetrics, divisionValueDisplayMode),
      ),
      rows: analytics.divisionValueRanking,
    },
    {
      key: "divisionTotalValue",
      title: "Division ranking by total value",
      subtitle: "Allocated, intended, booked, and committed totals",
      columns: withRankAnalyticsColumns(
        getDivisionTotalValueAnalyticsColumns(
          visibleDivisionTotalValueMetrics,
          divisionTotalValueDisplayMode,
        ),
      ),
      rows: analytics.divisionValueRanking,
    },
    {
      key: "divisionTurnaround",
      title: "Division turnaround ranking",
      subtitle: "Average days from received date to first S.O.",
      columns: withRankAnalyticsColumns(getAverageDaysAnalyticsColumns("Division")),
      rows: withAnalyticsRanks(
        sortAnalyticsRows(
          withAssignedDivisionRows(analytics.divisionTurnaroundRanking, assignedDivisionNames),
          getAnalyticsSortDirection("divisionTurnaround"),
        ),
      ),
    },
    {
      key: "topFirms",
      title: "Firms ranking by S.O. value",
      subtitle: "Supply order value, capital plus revenue",
      columns: withRankAnalyticsColumns(getValueAnalyticsColumns("Firm", "S.O. value")),
      rows: topFirmPagination.rows,
    },
    {
      key: "indentorsByFiles",
      title: "Top indentors by files",
      subtitle: "Number of files raised",
      columns: withRankAnalyticsColumns(getCountAnalyticsColumns("Indentor")),
      rows: indentorsByFilesPagination.rows,
    },
    {
      key: "indentorsByValue",
      title: "Top indentors by value",
      subtitle: "Total demand value",
      columns: withRankAnalyticsColumns(getValueAnalyticsColumns("Indentor", "Total value")),
      rows: indentorsByValuePagination.rows,
    },
    {
      key: "monthlyInflow",
      title: "Monthly file inflow",
      subtitle: "Files received by month",
      columns: getCountAnalyticsColumns("Month"),
      rows: divisionFilteredAnalytics.monthlyFileInflow,
    },
    {
      key: "biddingMode",
      title: "Bidding mode mix",
      subtitle: "Distribution by mode",
      columns: getCountAnalyticsColumns("Mode"),
      rows: divisionFilteredAnalytics.biddingModeMix,
    },
    {
      key: "fileValueThresholds",
      title: "File value thresholds",
      subtitle: "Files grouped by admin configured threshold levels",
      columns: getFileValueThresholdColumns(),
      rows: divisionFilteredAnalytics.fileValueThresholds,
    },
    {
      key: "paymentPending",
      title: "Payment pending by division",
      subtitle: "Material received but payment not completed",
      columns: withRankAnalyticsColumns(getCountAnalyticsColumns("Division")),
      rows: withAnalyticsRanks(
        sortAnalyticsRows(
          withAssignedDivisionRows(
            divisionFilteredAnalytics.divisionPaymentPendingRanking,
            assignedDivisionNames,
          ),
          getAnalyticsSortDirection("paymentPending"),
        ),
      ),
    },
    {
      key: "milestoneClearingTable",
      title: "Milestone clearing ranking",
      subtitle: "Slowest milestones by average clearing time",
      columns: withRankAnalyticsColumns(getAverageDaysAnalyticsColumns("Milestone")),
      rows: withAnalyticsRanks(
        sortAnalyticsRows(
          divisionFilteredAnalytics.milestoneClearingRanking,
          getAnalyticsSortDirection("milestoneClearingTable"),
        ),
      ),
    },
  ];
  const selectedAnalyticsPanel =
    analyticsPanels.find((panel) => panel.key === activeAnalyticsPanel) ?? analyticsPanels[0];
  const displayedAnalyticsPanel =
    selectedAnalyticsPanel.key === "divisionValue"
      ? {
          ...selectedAnalyticsPanel,
          divisionValueDisplayMode,
          exportNote: getDivisionValueRankingCriteria(divisionValueSortKey, divisionValueSortMode),
          rows: withAnalyticsRanks(
            sortDivisionValueRows(
              withAssignedDivisionRows(selectedAnalyticsPanel.rows, assignedDivisionNames),
              divisionValueSortKey,
              divisionValueSortMode,
              getAnalyticsSortDirection("divisionValue"),
            ),
          ),
        }
      : selectedAnalyticsPanel.key === "divisionTotalValue"
        ? {
            ...selectedAnalyticsPanel,
            divisionValueDisplayMode: divisionTotalValueDisplayMode,
            rows: withAnalyticsRanks(
              sortDivisionTotalValueRows(
                withAssignedDivisionRows(selectedAnalyticsPanel.rows, assignedDivisionNames),
                divisionTotalValueSortKey,
                divisionTotalValueSortMode,
                getAnalyticsSortDirection("divisionTotalValue"),
              ),
            ),
          }
        : selectedAnalyticsPanel;
  const analyticsDivisionFilterEnabled = isDivisionFilterableAnalyticsPanel(
    selectedAnalyticsPanel.key,
  );
  const analyticsSortControlEnabled = displayedAnalyticsPanel.columns.some(
    (column) => column.key === "rank",
  );
  const analyticsLimitControl =
    selectedAnalyticsPanel.key === "topFirms"
      ? {
          value: topFirmLimit,
          onChange: (value: AnalyticsResultLimitKey) => {
            setTopFirmLimit(value);
            setTopFirmPage(1);
          },
          total: divisionFilteredAnalytics.topFirmSupplyOrders.length,
        }
      : selectedAnalyticsPanel.key === "indentorsByFiles"
        ? {
            value: indentorsByFilesLimit,
            onChange: (value: AnalyticsResultLimitKey) => {
              setIndentorsByFilesLimit(value);
              setIndentorsByFilesPage(1);
            },
            total: divisionFilteredAnalytics.topIndentorsByFiles.length,
          }
        : selectedAnalyticsPanel.key === "indentorsByValue"
          ? {
              value: indentorsByValueLimit,
              onChange: (value: AnalyticsResultLimitKey) => {
                setIndentorsByValueLimit(value);
                setIndentorsByValuePage(1);
              },
              total: divisionFilteredAnalytics.topIndentorsByValue.length,
            }
          : undefined;
  const analyticsPagination =
    selectedAnalyticsPanel.key === "topFirms"
      ? {
          ...topFirmPagination,
          onPageChange: setTopFirmPage,
        }
      : selectedAnalyticsPanel.key === "indentorsByFiles"
        ? {
            ...indentorsByFilesPagination,
            onPageChange: setIndentorsByFilesPage,
          }
        : selectedAnalyticsPanel.key === "indentorsByValue"
          ? {
              ...indentorsByValuePagination,
              onPageChange: setIndentorsByValuePage,
            }
          : undefined;
  const analyticsTransferType =
    selectedAnalyticsPanel.key === "topFirms"
      ? "firm"
      : selectedAnalyticsPanel.key === "indentorsByFiles" ||
          selectedAnalyticsPanel.key === "indentorsByValue"
        ? "indentor"
        : undefined;

  const openSearchFilter = (dashboardFilter: string) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter,
        division: activeDivision === "all" ? undefined : activeDivision,
      },
    });
  };
  const openLiveStatusFilter = (division: string, milestoneName: string) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `manualMilestoneCurrent:${milestoneName}`,
        division,
      },
    });
  };
  const openAnalyticsResultsInSearch = () => {
    if (!analyticsTransferType || displayedAnalyticsPanel.rows.length === 0) return;
    navigate({
      to: "/search",
      search: {
        dashboardFilter: undefined,
        division: activeAnalyticsDivision === "all" ? undefined : activeAnalyticsDivision,
        analyticsType: analyticsTransferType,
        analyticsNames: JSON.stringify(displayedAnalyticsPanel.rows.map((row) => String(row.name))),
      },
    });
  };
  const toggleDivisionValueMetric = (metric: DivisionValueMetricKey) => {
    setVisibleDivisionValueMetrics((current) => {
      if (current.includes(metric)) {
        return current.length === 1 ? current : current.filter((item) => item !== metric);
      }
      return [...current, metric];
    });
  };
  const toggleDivisionTotalValueMetric = (metric: DivisionValueMetricKey) => {
    setVisibleDivisionTotalValueMetrics((current) => {
      if (current.includes(metric)) {
        return current.length === 1 ? current : current.filter((item) => item !== metric);
      }
      return [...current, metric];
    });
  };
  const handleStatusFilter = async (dashboardFilter: string) => {
    if (statusActionMode === "search") {
      openSearchFilter(dashboardFilter);
      return;
    }

    const title = getDashboardFilterTitle(dashboardFilter);
    try {
      await downloadDashboardStatusFiles({
        dashboardFilter,
        division: activeDivision,
        selectedYear: settings.selectedYear,
        format: statusActionMode === "excel" ? "excel" : "pdf",
        title,
      });
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : "Status export failed.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-card)]">
          {[
            { key: "status", label: "Status-1" },
            { key: "liveStatus", label: "Status-2" },
            { key: "status3", label: "Status-3" },
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
      {dashboardSummaryError || (dashboardSummaryLoading && !hasLoadedDashboardSummary) ? (
        <div
          className={
            "rounded-md border px-3 py-2 text-xs " +
            (dashboardSummaryError
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-border bg-secondary/30 text-muted-foreground")
          }
        >
          {dashboardSummaryError
            ? `Dashboard API unavailable, showing local fallback: ${dashboardSummaryError}`
            : "Updating dashboard summary..."}
        </div>
      ) : null}

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
            <h2 className="text-sm font-bold">Status-1</h2>
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
                  <div className="text-lg font-semibold tabular-nums">{dashboardFileCount}</div>
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
                      onOverdueClick={() => handleStatusFilter("deliveryOverdue")}
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
                    label: "Live files",
                    count: miscellaneousCounts.liveFiles,
                    onClick: () => handleStatusFilter("miscLiveFiles"),
                  },
                  {
                    label: "File closed",
                    count: miscellaneousCounts.fileClosed,
                    onClick: () => handleStatusFilter("miscFileClosed"),
                  },
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

      {activeDashboardTab === "liveStatus" ? (
        <LiveStatusSection
          milestones={manualMilestoneFlow}
          visibleMilestoneNames={visibleLiveMilestoneNames}
          rows={liveStatusRows}
          totalFiles={dashboardFileCount}
          onMilestoneToggle={(milestoneName) =>
            setSelectedLiveMilestones((current) => {
              const selected = current ?? manualMilestoneFlow.map((milestone) => milestone.name);
              return selected.includes(milestoneName)
                ? selected.filter((name) => name !== milestoneName)
                : [...selected, milestoneName];
            })
          }
          onSelectAllMilestones={() =>
            setSelectedLiveMilestones(manualMilestoneFlow.map((milestone) => milestone.name))
          }
          onClearMilestones={() => setSelectedLiveMilestones([])}
          onLockMilestones={lockLiveStatusSelection}
          lockedMilestoneNames={settings.liveStatusLockedFields}
          onCountClick={openLiveStatusFilter}
        />
      ) : null}

      {activeDashboardTab === "status3" ? (
        <DashboardStatusSummarySection
          groups={status3Groups}
          loading={status3Loading}
          error={status3Error}
          onOpenStatus={(milestone, stage) =>
            openSearchFilter(getStatusSummaryDashboardFilter(milestone, stage))
          }
        />
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
                title={displayedAnalyticsPanel.title}
                subtitle={displayedAnalyticsPanel.subtitle}
                actions={
                  <>
                    {analyticsDivisionFilterEnabled ? (
                      <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium">
                        <span className="text-muted-foreground">Division</span>
                        <select
                          value={activeAnalyticsDivision}
                          onChange={(event) => setSelectedAnalyticsDivision(event.target.value)}
                          className="h-6 min-w-32 bg-transparent text-xs text-foreground outline-none"
                        >
                          <option value="all">All divisions</option>
                          {divisions.map((division) => (
                            <option key={division.id} value={division.name}>
                              {division.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {analyticsLimitControl ? (
                      <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium">
                        <span className="text-muted-foreground">Show</span>
                        <select
                          value={analyticsLimitControl.value}
                          onChange={(event) =>
                            analyticsLimitControl.onChange(
                              event.target.value as AnalyticsResultLimitKey,
                            )
                          }
                          className="h-6 min-w-20 bg-transparent text-xs text-foreground outline-none"
                        >
                          {analyticsResultLimitOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span className="text-muted-foreground">
                          of {analyticsLimitControl.total}
                        </span>
                      </label>
                    ) : null}
                    {analyticsSortControlEnabled ? (
                      <AnalyticsSortDirectionControl
                        value={getAnalyticsSortDirection(selectedAnalyticsPanel.key)}
                        onChange={(direction) =>
                          setAnalyticsSortDirection(selectedAnalyticsPanel.key, direction)
                        }
                      />
                    ) : null}
                    {analyticsTransferType ? (
                      <button
                        type="button"
                        onClick={openAnalyticsResultsInSearch}
                        disabled={displayedAnalyticsPanel.rows.length === 0}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Search className="size-3.5" />
                        Send to Search Files
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => printAnalyticsPanelToPdf(displayedAnalyticsPanel)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent"
                    >
                      Export PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => exportAnalyticsPanelToExcel(displayedAnalyticsPanel)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent"
                    >
                      Export Excel
                    </button>
                  </>
                }
              >
                {displayedAnalyticsPanel.key === "divisionValue" ? (
                  <DivisionValueSortControls
                    mode={divisionValueSortMode}
                    displayMode={divisionValueDisplayMode}
                    sortKey={divisionValueSortKey}
                    visibleMetrics={visibleDivisionValueMetrics}
                    onModeChange={setDivisionValueSortMode}
                    onDisplayModeChange={setDivisionValueDisplayMode}
                    onSortKeyChange={setDivisionValueSortKey}
                    onToggleMetric={toggleDivisionValueMetric}
                  />
                ) : null}
                {displayedAnalyticsPanel.key === "divisionTotalValue" ? (
                  <DivisionTotalValueSortControls
                    mode={divisionTotalValueSortMode}
                    displayMode={divisionTotalValueDisplayMode}
                    sortKey={divisionTotalValueSortKey}
                    visibleMetrics={visibleDivisionTotalValueMetrics}
                    onModeChange={setDivisionTotalValueSortMode}
                    onDisplayModeChange={setDivisionTotalValueDisplayMode}
                    onSortKeyChange={setDivisionTotalValueSortKey}
                    onToggleMetric={toggleDivisionTotalValueMetric}
                  />
                ) : null}
                <AnalyticsRankingTable
                  columns={displayedAnalyticsPanel.columns}
                  rows={displayedAnalyticsPanel.rows}
                />
                {analyticsPagination && analyticsPagination.totalPages > 1 ? (
                  <AnalyticsPaginationControls {...analyticsPagination} />
                ) : null}
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
                <div className={financeBoxTitleClass}>Intended</div>
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

function LiveStatusSection({
  milestones,
  visibleMilestoneNames,
  rows,
  totalFiles,
  onMilestoneToggle,
  onSelectAllMilestones,
  onClearMilestones,
  onLockMilestones,
  lockedMilestoneNames,
  onCountClick,
}: {
  milestones: LiveStatusMilestone[];
  visibleMilestoneNames: string[];
  rows: LiveStatusDivisionRow[];
  totalFiles: number;
  onMilestoneToggle: (milestoneName: string) => void;
  onSelectAllMilestones: () => void;
  onClearMilestones: () => void;
  onLockMilestones: () => void;
  lockedMilestoneNames?: string[];
  onCountClick: (division: string, milestoneName: string) => void;
}) {
  const liveTotal = milestones.reduce((sum, milestone) => sum + milestone.current, 0);
  const selectedMilestoneSet = new Set(visibleMilestoneNames);
  const displayedMilestones = milestones.filter((milestone) =>
    selectedMilestoneSet.has(milestone.name),
  );
  const lockMatchesCurrentSelection =
    lockedMilestoneNames !== undefined &&
    lockedMilestoneNames.length === visibleMilestoneNames.length &&
    lockedMilestoneNames.every((name) => selectedMilestoneSet.has(name));

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-bold">Live status</h2>
      </div>
      <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">Division-wise current milestones</h3>
            <p className="text-xs text-muted-foreground">
              Counts show how many files are currently at each selected milestone.
            </p>
          </div>
          <div className="flex gap-2 text-right text-xs">
            <div className="rounded-md border border-border bg-secondary/40 px-3 py-2">
              <div className="text-muted-foreground">Live counted</div>
              <div className="text-lg font-semibold tabular-nums">{liveTotal}</div>
            </div>
            <div className="rounded-md border border-border bg-secondary/40 px-3 py-2">
              <div className="text-muted-foreground">Total files</div>
              <div className="text-lg font-semibold tabular-nums">{totalFiles}</div>
            </div>
          </div>
        </div>
        <div className="mb-4 rounded-md border border-border bg-secondary/25 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase text-muted-foreground">Milestones</div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  printLiveStatusRowsToPdf(rows, displayedMilestones, "Live status dashboard")
                }
                disabled={!displayedMilestones.length}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
              >
                <FileText className="size-3.5" />
                PDF
              </button>
              <button
                type="button"
                onClick={() =>
                  exportLiveStatusRowsToExcel(rows, displayedMilestones, "Live status dashboard")
                }
                disabled={!displayedMilestones.length}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
              >
                <FileSpreadsheet className="size-3.5" />
                Excel
              </button>
              <button
                type="button"
                onClick={onSelectAllMilestones}
                className="h-7 rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-accent"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={onClearMilestones}
                className="h-7 rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-accent"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={onLockMilestones}
                className="h-7 rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-accent"
              >
                {lockMatchesCurrentSelection ? "Locked" : "Lock selection"}
              </button>
            </div>
          </div>
          {lockedMilestoneNames !== undefined ? (
            <div className="mb-2 text-xs text-muted-foreground">
              Locked for this login. Change the selection and lock again to update it.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {milestones.map((milestone) => {
              const checked = selectedMilestoneSet.has(milestone.name);
              return (
                <label
                  key={milestone.name}
                  className={
                    "flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition " +
                    (checked
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground")
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onMilestoneToggle(milestone.name)}
                    className="size-3 accent-primary"
                  />
                  <span className="max-w-[150px] truncate">{milestone.name}</span>
                  <span className="rounded bg-secondary px-1.5 py-0.5 tabular-nums">
                    {milestone.current}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        {displayedMilestones.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-48" />
                <col className="w-24" />
                {displayedMilestones.map((milestone) => (
                  <col key={milestone.name} className="w-28" />
                ))}
              </colgroup>
              <thead>
                <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Division</th>
                  <th className="px-3 py-2 text-center font-medium">Total</th>
                  {displayedMilestones.map((milestone) => (
                    <th key={milestone.name} className="px-3 py-2 text-center font-medium">
                      <span className="block truncate">{milestone.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.division} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 font-medium">{row.division}</td>
                    <td className="px-3 py-2 text-center font-semibold tabular-nums">
                      {row.total}
                    </td>
                    {displayedMilestones.map((milestone) => {
                      const count = row.counts[milestone.name] ?? 0;
                      return (
                        <td key={milestone.name} className="px-2 py-2 text-center">
                          {count > 0 ? (
                            <button
                              type="button"
                              onClick={() => onCountClick(row.division, milestone.name)}
                              className="h-8 min-w-12 rounded-md border border-border bg-secondary/35 px-2 font-semibold tabular-nums transition hover:bg-accent hover:ring-2 hover:ring-ring/25"
                              aria-label={`Open ${count} ${row.division} files at ${milestone.name}`}
                            >
                              {count}
                            </button>
                          ) : (
                            <span className="inline-flex h-8 min-w-12 items-center justify-center rounded-md border border-border/60 bg-card px-2 text-muted-foreground tabular-nums">
                              0
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">
            Select at least one milestone to show division-wise counts.
          </div>
        )}
        {!rows.length && displayedMilestones.length ? (
          <div className="mt-3 text-sm text-muted-foreground">No division data available.</div>
        ) : null}
      </div>
    </section>
  );
}

function DashboardStatusSummarySection({
  groups,
  loading,
  error,
  onOpenStatus,
}: {
  groups: StatusSummaryTableGroup[];
  loading: boolean;
  error?: string;
  onOpenStatus: (milestone: string, stage: string) => void;
}) {
  const status3Presentation = useMemo(
    () => getStatus3Presentation(hideStatus3PendingColumn(groups)),
    [groups],
  );
  const { groups: visibleGroups, deliveryPeriodGroup, exportGroups } = status3Presentation;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-bold">Status-3</h2>
      </div>
      <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">Status summary</h3>
            <p className="text-xs text-muted-foreground">
              Files at each stage across all milestones.
            </p>
          </div>
          <div className="flex rounded-md border border-border bg-secondary/40 p-1">
            <button
              type="button"
              onClick={() => printStatusSummaryGroupsToPdf(exportGroups, "Status-3")}
              disabled={!exportGroups.length}
              className="flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <FileText className="size-3.5" />
              PDF
            </button>
            <button
              type="button"
              onClick={() => exportStatusSummaryGroupsToExcel(exportGroups, "Status-3")}
              disabled={!exportGroups.length}
              className="flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <FileSpreadsheet className="size-3.5" />
              Excel
            </button>
          </div>
        </div>
        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : loading && !groups.length ? (
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
            Loading status summary...
          </div>
        ) : (
          <div className="space-y-4">
            {visibleGroups.map((group) => (
              <Fragment key={group.key}>
                <Status3TableSection group={group} onOpenStatus={onOpenStatus} />
                {group.rows.some((row) => row.milestone === "Supply Order") &&
                deliveryPeriodGroup ? (
                  <Status3TableSection group={deliveryPeriodGroup} onOpenStatus={onOpenStatus} />
                ) : null}
              </Fragment>
            ))}
            {!visibleGroups.length ? (
              <div className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">
                No status summary rows found.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function Status3TableSection({
  group,
  onOpenStatus,
}: {
  group: StatusSummaryTableGroup;
  onOpenStatus: (milestone: string, stage: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto">
        <table className="w-auto min-w-[480px] max-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
              <th className="sticky left-0 bg-muted py-2.5 pl-3 pr-4 font-semibold">Milestone</th>
              {group.columns.map((column) => (
                <th key={column} className="px-3 py-2.5 text-right font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row, rowIndex) => {
              const rowClass =
                "border-b border-border/60 last:border-0 " +
                (rowIndex % 2 === 0 ? "bg-card" : "bg-secondary/15");
              const cellClass =
                "sticky left-0 py-2.5 pl-3 pr-4 font-medium " +
                (rowIndex % 2 === 0 ? "bg-card" : "bg-secondary/15");

              return (
                <tr key={row.milestone} className={rowClass}>
                  <td className={cellClass}>{row.milestone}</td>
                  {group.columns.map((column) => (
                    <td key={column} className="px-3 py-2.5 text-right tabular-nums">
                      <DashboardStatusSummaryValue
                        value={row.counts[column]}
                        onClick={() => onOpenStatus(row.milestone, column)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DashboardStatusSummaryValue({
  value,
  onClick,
}: {
  value: number | string | undefined;
  onClick: () => void;
}) {
  if (value === undefined || value === "") {
    return <span className="text-muted-foreground/40">-</span>;
  }
  if (value === "-") {
    return <span className="text-muted-foreground">-</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex min-w-8 justify-center rounded px-2 py-0.5 text-xs font-semibold transition hover:ring-2 hover:ring-ring/30 " +
        (value === 0 ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-foreground")
      }
    >
      {value}
    </button>
  );
}

function hideStatus3PendingColumn(groups: StatusSummaryTableGroup[]) {
  return groups.map((group) => ({
    ...group,
    columns: group.columns.filter((column) => column !== "Pending"),
  }));
}

function getStatus3Presentation(groups: StatusSummaryTableGroup[]) {
  const { groups: withoutDeliveryPeriod, deliveryPeriodGroup } =
    extractStatus3DeliveryPeriodGroup(groups);
  const visibleGroups = withoutDeliveryPeriod.map((group) => {
    const rows = [...group.rows];
    swapStatus3Rows(rows, "Delivery", "Payment");
    return { ...group, rows };
  });

  return {
    groups: visibleGroups,
    deliveryPeriodGroup,
    exportGroups: insertStatus3GroupAfterCommon(visibleGroups, deliveryPeriodGroup),
  };
}

function extractStatus3DeliveryPeriodGroup(groups: StatusSummaryTableGroup[]) {
  let deliveryPeriodGroup: StatusSummaryTableGroup | undefined;
  const remainingGroups = groups
    .map((group) => {
      const deliveryPeriodRows = group.rows.filter((row) => row.milestone === "Delivery Period");
      if (deliveryPeriodRows.length) {
        deliveryPeriodGroup = {
          ...group,
          key: "delivery-period-mini-section",
          title: "Delivery Period",
          rows: deliveryPeriodRows,
        };
      }
      return {
        ...group,
        rows: group.rows.filter((row) => row.milestone !== "Delivery Period"),
      };
    })
    .filter((group) => group.rows.length);

  return { groups: remainingGroups, deliveryPeriodGroup };
}

function insertStatus3GroupAfterCommon(
  groups: StatusSummaryTableGroup[],
  deliveryPeriodGroup: StatusSummaryTableGroup | undefined,
) {
  if (!deliveryPeriodGroup) return groups;
  const commonIndex = groups.findIndex((group) => group.key === "common");
  if (commonIndex === -1) return [deliveryPeriodGroup, ...groups];
  return [
    ...groups.slice(0, commonIndex + 1),
    deliveryPeriodGroup,
    ...groups.slice(commonIndex + 1),
  ];
}

function swapStatus3Rows(
  rows: StatusSummaryTableRow[],
  firstMilestone: string,
  secondMilestone: string,
) {
  const firstIndex = rows.findIndex((row) => row.milestone === firstMilestone);
  const secondIndex = rows.findIndex((row) => row.milestone === secondMilestone);
  if (firstIndex === -1 || secondIndex === -1) return;
  [rows[firstIndex], rows[secondIndex]] = [rows[secondIndex], rows[firstIndex]];
}

type LiveStatusDivisionRow = {
  division: string;
  total: number;
  counts: Record<string, number>;
};
type LiveStatusMilestone = { name: string; current: number; completed: number };

function getLiveStatusDivisionRows(
  files: ReturnType<typeof useAccessibleFiles>,
  divisions: Division[],
  milestoneNames: string[],
): LiveStatusDivisionRow[] {
  const configuredDivisionNames = divisions.map((division) => division.name);
  const fileDivisionNames = Array.from(
    new Set(
      files.map((file) => file.division?.trim()).filter((name): name is string => Boolean(name)),
    ),
  );
  const divisionNames = Array.from(new Set([...configuredDivisionNames, ...fileDivisionNames]));

  return divisionNames
    .map((division) => {
      const divisionFiles = files.filter((file) => file.division === division);
      const counts = Object.fromEntries(
        milestoneNames.map((milestoneName) => [
          milestoneName,
          divisionFiles.filter(
            (file) => !isCancelledFile(file) && file.currentMilestone === milestoneName,
          ).length,
        ]),
      ) as Record<string, number>;
      return {
        division,
        counts,
        total: Object.values(counts).reduce((sum, count) => sum + count, 0),
      };
    })
    .sort((a, b) => b.total - a.total || a.division.localeCompare(b.division));
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

const divisionValueSortOptions = [
  { key: "allocatedCapital", label: "Allocated C" },
  { key: "allocatedRevenue", label: "Allocated R" },
  { key: "intendedCapital", label: "Intended C" },
  { key: "intendedRevenue", label: "Intended R" },
  { key: "bookedCapital", label: "Booked C" },
  { key: "bookedRevenue", label: "Booked R" },
  { key: "committedCapital", label: "Committed C" },
  { key: "committedRevenue", label: "Committed R" },
] satisfies Array<{ key: DivisionValueSortKey; label: string }>;

const divisionValueMetricOptions = [
  { key: "allocated", label: "Allocated" },
  { key: "intended", label: "Intended" },
  { key: "booked", label: "Booked" },
  { key: "committed", label: "Committed" },
] satisfies Array<{ key: DivisionValueMetricKey; label: string }>;

const divisionValueMetricSortKeys = {
  allocated: ["allocatedCapital", "allocatedRevenue"],
  intended: ["intendedCapital", "intendedRevenue"],
  booked: ["bookedCapital", "bookedRevenue"],
  committed: ["committedCapital", "committedRevenue"],
} satisfies Record<DivisionValueMetricKey, DivisionValueSortKey[]>;

const divisionValueSortExportLabels = {
  allocatedCapital: "Allocated Capital",
  allocatedRevenue: "Allocated Revenue",
  intendedCapital: "Intended Capital",
  intendedRevenue: "Intended Revenue",
  bookedCapital: "Booked Capital",
  bookedRevenue: "Booked Revenue",
  committedCapital: "Committed Capital",
  committedRevenue: "Committed Revenue",
} satisfies Record<DivisionValueSortKey, string>;

const divisionTotalValueSortOptions = [
  { key: "allocatedTotal", label: "Allocated" },
  { key: "intendedTotal", label: "Intended" },
  { key: "bookedTotal", label: "Booked" },
  { key: "committedTotal", label: "Committed" },
] satisfies Array<{ key: DivisionTotalValueSortKey; label: string }>;

const divisionTotalValueMetricSortKeys = {
  allocated: "allocatedTotal",
  intended: "intendedTotal",
  booked: "bookedTotal",
  committed: "committedTotal",
} satisfies Record<DivisionValueMetricKey, DivisionTotalValueSortKey>;

function AnalyticsSortDirectionControl({
  value,
  onChange,
}: {
  value: AnalyticsSortDirection;
  onChange: (direction: AnalyticsSortDirection) => void;
}) {
  return (
    <div className="flex h-8 items-center gap-1 rounded-md border border-border bg-card p-0.5 text-xs font-medium">
      {[
        { key: "desc", label: "Desc" },
        { key: "asc", label: "Asc" },
      ].map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key as AnalyticsSortDirection)}
          className={
            "h-7 rounded px-2.5 transition " +
            (value === option.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground")
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function DivisionValueSortControls({
  mode,
  displayMode,
  sortKey,
  visibleMetrics,
  onModeChange,
  onDisplayModeChange,
  onSortKeyChange,
  onToggleMetric,
}: {
  mode: DivisionValueSortMode;
  displayMode: DivisionValueDisplayMode;
  sortKey: DivisionValueSortKey;
  visibleMetrics: DivisionValueMetricKey[];
  onModeChange: (mode: DivisionValueSortMode) => void;
  onDisplayModeChange: (mode: DivisionValueDisplayMode) => void;
  onSortKeyChange: (key: DivisionValueSortKey) => void;
  onToggleMetric: (key: DivisionValueMetricKey) => void;
}) {
  const visibleSortKeys = new Set(
    visibleMetrics.flatMap((metric) => divisionValueMetricSortKeys[metric]),
  );
  const sortOptions = divisionValueSortOptions.filter((option) => visibleSortKeys.has(option.key));

  return (
    <div className="mb-3 space-y-2 rounded-md border border-border bg-secondary/25 px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-24 font-semibold text-muted-foreground">Fields to display</span>
        <div className="flex flex-wrap items-center gap-1">
          {divisionValueMetricOptions.map((option) => (
            <label
              key={option.key}
              className={
                "flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 font-medium transition " +
                (visibleMetrics.includes(option.key)
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              <input
                type="checkbox"
                checked={visibleMetrics.includes(option.key)}
                onChange={() => onToggleMetric(option.key)}
                className="size-3 accent-primary"
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-2">
        <span className="min-w-24 font-semibold text-muted-foreground">Display as</span>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {[
            { key: "value", label: "Value" },
            { key: "percent", label: "%" },
            { key: "both", label: "Both" },
          ].map((item) => (
            <label
              key={item.key}
              className={
                "flex h-7 cursor-pointer items-center gap-1.5 rounded px-2 font-medium transition " +
                (displayMode === item.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              <input
                type="checkbox"
                checked={displayMode === item.key}
                onChange={() => onDisplayModeChange(item.key as DivisionValueDisplayMode)}
                className="size-3 accent-current"
              />
              {item.label}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-2">
        <span className="min-w-24 font-semibold text-muted-foreground">Sort according to</span>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {[
            { key: "value", label: "Value" },
            { key: "percent", label: "%" },
          ].map((item) => (
            <label
              key={item.key}
              className={
                "flex h-7 cursor-pointer items-center gap-1.5 rounded px-2 font-medium transition " +
                (mode === item.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              <input
                type="checkbox"
                checked={mode === item.key}
                onChange={() => onModeChange(item.key as DivisionValueSortMode)}
                className="size-3 accent-current"
              />
              {item.label}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {sortOptions.map((option) => (
            <label
              key={option.key}
              className={
                "flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 font-medium transition " +
                (sortKey === option.key
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              <input
                type="checkbox"
                checked={sortKey === option.key}
                onChange={() => onSortKeyChange(option.key)}
                className="size-3 accent-primary"
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function getDivisionValueRankingCriteria(
  sortKey: DivisionValueSortKey,
  mode: DivisionValueSortMode,
) {
  const label = divisionValueSortExportLabels[sortKey];
  if (sortKey.startsWith("allocated") || mode === "value") {
    return `Ranking criteria: ${label}`;
  }
  return `Ranking criteria: ${label} percentage against allocation`;
}

function DivisionTotalValueSortControls({
  mode,
  displayMode,
  sortKey,
  visibleMetrics,
  onModeChange,
  onDisplayModeChange,
  onSortKeyChange,
  onToggleMetric,
}: {
  mode: DivisionValueSortMode;
  displayMode: DivisionValueDisplayMode;
  sortKey: DivisionTotalValueSortKey;
  visibleMetrics: DivisionValueMetricKey[];
  onModeChange: (mode: DivisionValueSortMode) => void;
  onDisplayModeChange: (mode: DivisionValueDisplayMode) => void;
  onSortKeyChange: (key: DivisionTotalValueSortKey) => void;
  onToggleMetric: (key: DivisionValueMetricKey) => void;
}) {
  const visibleSortKeys = new Set(
    visibleMetrics.map((metric) => divisionTotalValueMetricSortKeys[metric]),
  );
  const sortOptions = divisionTotalValueSortOptions.filter((option) =>
    visibleSortKeys.has(option.key),
  );

  return (
    <div className="mb-3 space-y-2 rounded-md border border-border bg-secondary/25 px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-24 font-semibold text-muted-foreground">Fields to display</span>
        <div className="flex flex-wrap items-center gap-1">
          {divisionValueMetricOptions.map((option) => (
            <label
              key={option.key}
              className={
                "flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 font-medium transition " +
                (visibleMetrics.includes(option.key)
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              <input
                type="checkbox"
                checked={visibleMetrics.includes(option.key)}
                onChange={() => onToggleMetric(option.key)}
                className="size-3 accent-primary"
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-2">
        <span className="min-w-24 font-semibold text-muted-foreground">Display as</span>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {[
            { key: "value", label: "Value" },
            { key: "percent", label: "%" },
            { key: "both", label: "Both" },
          ].map((item) => (
            <label
              key={item.key}
              className={
                "flex h-7 cursor-pointer items-center gap-1.5 rounded px-2 font-medium transition " +
                (displayMode === item.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              <input
                type="checkbox"
                checked={displayMode === item.key}
                onChange={() => onDisplayModeChange(item.key as DivisionValueDisplayMode)}
                className="size-3 accent-current"
              />
              {item.label}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-2">
        <span className="min-w-24 font-semibold text-muted-foreground">Sort according to</span>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {[
            { key: "value", label: "Value" },
            { key: "percent", label: "%" },
          ].map((item) => (
            <label
              key={item.key}
              className={
                "flex h-7 cursor-pointer items-center gap-1.5 rounded px-2 font-medium transition " +
                (mode === item.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              <input
                type="checkbox"
                checked={mode === item.key}
                onChange={() => onModeChange(item.key as DivisionValueSortMode)}
                className="size-3 accent-current"
              />
              {item.label}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {sortOptions.map((option) => (
            <label
              key={option.key}
              className={
                "flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 font-medium transition " +
                (sortKey === option.key
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              <input
                type="checkbox"
                checked={sortKey === option.key}
                onChange={() => onSortKeyChange(option.key)}
                className="size-3 accent-primary"
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnalyticsChartCard({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">{title}</h3>
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

function getCountAnalyticsColumns(nameLabel: string): AnalyticsTableColumn[] {
  return [
    { key: "name", label: nameLabel, align: "left" },
    { key: "count", label: "Count" },
  ];
}

function withRankAnalyticsColumns(columns: AnalyticsTableColumn[]) {
  return [{ key: "rank", label: "Rank" }, ...columns];
}

function getValueAnalyticsColumns(nameLabel: string, valueLabel: string): AnalyticsTableColumn[] {
  return [
    { key: "name", label: nameLabel, align: "left" },
    { key: "value", label: valueLabel, format: (value) => formatCurrency(Number(value)) },
  ];
}

function getFileValueThresholdColumns(): AnalyticsTableColumn[] {
  return [
    { key: "range", label: "Value range", align: "left" },
    { key: "count", label: "Files" },
    { key: "capital", label: "Capital", format: (value) => formatCurrency(Number(value)) },
    { key: "revenue", label: "Revenue", format: (value) => formatCurrency(Number(value)) },
    { key: "value", label: "Total", format: (value) => formatCurrency(Number(value)) },
  ];
}

function getDivisionValueAnalyticsColumns(
  visibleMetrics: DivisionValueMetricKey[],
  displayMode: DivisionValueDisplayMode,
): AnalyticsTableColumn[] {
  const groupedLabel = (label: string, forceValueOnly = false) => {
    if (forceValueOnly || displayMode === "value") return `${label} (Lakhs)`;
    if (displayMode === "percent") return `${label} (%)`;
    return `${label} (Lakhs / %)`;
  };
  const currencyColumn = (
    key: string,
    group: string,
    label: string,
    allocationKey: "allocatedCapital" | "allocatedRevenue",
    showPercent = true,
  ): AnalyticsTableColumn => ({
    key,
    group,
    label,
    format: (value, row) =>
      showPercent
        ? formatDivisionValueDisplay(Number(value), Number(row[allocationKey]), displayMode)
        : formatLakhsValue(Number(value)),
    render: (value, row) =>
      showPercent
        ? renderDivisionValueDisplay(Number(value), Number(row[allocationKey]), displayMode)
        : formatLakhsValue(Number(value)),
  });
  const columns: AnalyticsTableColumn[] = [{ key: "name", label: "Division", align: "left" }];
  if (visibleMetrics.includes("allocated")) {
    columns.push(
      currencyColumn(
        "allocatedCapital",
        groupedLabel("Allocated", true),
        "Capital",
        "allocatedCapital",
        false,
      ),
      currencyColumn(
        "allocatedRevenue",
        groupedLabel("Allocated", true),
        "Revenue",
        "allocatedRevenue",
        false,
      ),
    );
  }
  if (visibleMetrics.includes("intended")) {
    columns.push(
      currencyColumn("intendedCapital", groupedLabel("Intended"), "Capital", "allocatedCapital"),
      currencyColumn("intendedRevenue", groupedLabel("Intended"), "Revenue", "allocatedRevenue"),
    );
  }
  if (visibleMetrics.includes("booked")) {
    columns.push(
      currencyColumn("bookedCapital", groupedLabel("Booked"), "Capital", "allocatedCapital"),
      currencyColumn("bookedRevenue", groupedLabel("Booked"), "Revenue", "allocatedRevenue"),
    );
  }
  if (visibleMetrics.includes("committed")) {
    columns.push(
      currencyColumn("committedCapital", groupedLabel("Committed"), "Capital", "allocatedCapital"),
      currencyColumn("committedRevenue", groupedLabel("Committed"), "Revenue", "allocatedRevenue"),
    );
  }
  return columns;
}

function getDivisionTotalValueAnalyticsColumns(
  visibleMetrics: DivisionValueMetricKey[],
  displayMode: DivisionValueDisplayMode,
): AnalyticsTableColumn[] {
  const totalColumn = (key: string, label: string, showPercent = true): AnalyticsTableColumn => ({
    key,
    label,
    format: (value, row) =>
      showPercent
        ? formatDivisionValueDisplay(Number(value), Number(row.allocatedTotal), displayMode)
        : formatLakhsValue(Number(value)),
    render: (value, row) =>
      showPercent
        ? renderDivisionValueDisplay(Number(value), Number(row.allocatedTotal), displayMode)
        : formatLakhsValue(Number(value)),
  });
  const columns: AnalyticsTableColumn[] = [{ key: "name", label: "Division", align: "left" }];
  if (visibleMetrics.includes("allocated")) {
    columns.push(totalColumn("allocatedTotal", "Allocated total", false));
  }
  if (visibleMetrics.includes("intended")) {
    columns.push(
      totalColumn("intendedTotal", getDivisionTotalValueColumnLabel("Intended", displayMode)),
    );
  }
  if (visibleMetrics.includes("booked")) {
    columns.push(
      totalColumn("bookedTotal", getDivisionTotalValueColumnLabel("Booked", displayMode)),
    );
  }
  if (visibleMetrics.includes("committed")) {
    columns.push(
      totalColumn("committedTotal", getDivisionTotalValueColumnLabel("Committed", displayMode)),
    );
  }
  return columns;
}

function getDivisionTotalValueColumnLabel(label: string, displayMode: DivisionValueDisplayMode) {
  if (displayMode === "value") return `${label} total`;
  if (displayMode === "percent") return `${label} total %`;
  return `${label} total (Lakhs / %)`;
}

function sortDivisionValueRows(
  rows: Array<Record<string, number | string>>,
  sortKey: DivisionValueSortKey,
  mode: DivisionValueSortMode,
  direction: AnalyticsSortDirection,
) {
  return [...rows].sort((a, b) => {
    const aValue = getDivisionValueSortValue(a, sortKey, mode);
    const bValue = getDivisionValueSortValue(b, sortKey, mode);
    if (bValue !== aValue) return direction === "desc" ? bValue - aValue : aValue - bValue;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });
}

function getDivisionValueSortValue(
  row: Record<string, number | string>,
  sortKey: DivisionValueSortKey,
  mode: DivisionValueSortMode,
) {
  const value = Number(row[sortKey] ?? 0);
  if (mode === "value" || sortKey.startsWith("allocated")) return value;
  const allocationKey = sortKey.endsWith("Revenue") ? "allocatedRevenue" : "allocatedCapital";
  const allocation = Number(row[allocationKey] ?? 0);
  return allocation > 0 ? value / allocation : 0;
}

function sortDivisionTotalValueRows(
  rows: Array<Record<string, number | string>>,
  sortKey: DivisionTotalValueSortKey,
  mode: DivisionValueSortMode,
  direction: AnalyticsSortDirection,
) {
  return [...rows].sort((a, b) => {
    const aValue = getDivisionTotalValueSortValue(a, sortKey, mode);
    const bValue = getDivisionTotalValueSortValue(b, sortKey, mode);
    if (bValue !== aValue) return direction === "desc" ? bValue - aValue : aValue - bValue;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });
}

function getDivisionTotalValueSortValue(
  row: Record<string, number | string>,
  sortKey: DivisionTotalValueSortKey,
  mode: DivisionValueSortMode,
) {
  const value = Number(row[sortKey] ?? 0);
  if (mode === "value" || sortKey === "allocatedTotal") return value;
  const allocation = Number(row.allocatedTotal ?? 0);
  return allocation > 0 ? value / allocation : 0;
}

function getAverageDaysAnalyticsColumns(nameLabel: string): AnalyticsTableColumn[] {
  return [
    { key: "name", label: nameLabel, align: "left" },
    { key: "averageDays", label: "Avg days", format: (value) => `${value}d` },
    { key: "sampleSize", label: "Files" },
  ];
}

function withAnalyticsRanks(rows: Array<Record<string, number | string>>) {
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function sortAnalyticsRows(
  rows: Array<Record<string, number | string>>,
  direction: AnalyticsSortDirection,
) {
  return direction === "desc" ? rows : [...rows].reverse();
}

function withAssignedDivisionRows(
  rows: Array<Record<string, number | string>>,
  assignedDivisionNames: string[],
) {
  if (!assignedDivisionNames.length) return rows;
  const existingNames = new Set(rows.map((row) => normalizeAnalyticsName(String(row.name ?? ""))));
  const assignedRows: Array<Record<string, number | string>> = assignedDivisionNames
    .filter((name) => !existingNames.has(normalizeAnalyticsName(name)))
    .map((name) => ({
      name,
      count: 0,
      averageDays: 0,
      sampleSize: 0,
      allocatedCapital: 0,
      allocatedRevenue: 0,
      allocatedTotal: 0,
      intendedCapital: 0,
      intendedRevenue: 0,
      intendedTotal: 0,
      bookedCapital: 0,
      bookedRevenue: 0,
      bookedTotal: 0,
      committedCapital: 0,
      committedRevenue: 0,
      committedTotal: 0,
    }));
  return assignedRows.length ? [...rows, ...assignedRows] : rows;
}

function getAssignedDivisionNames(divisionIds: string[] | undefined, divisions: Division[]) {
  if (!divisionIds?.length) return [];
  const assignedIds = new Set(divisionIds);
  return divisions
    .filter((division) => assignedIds.has(division.id))
    .map((division) => division.name)
    .filter(Boolean);
}

function normalizeAnalyticsName(value: string) {
  return value.trim().toLowerCase();
}

function getAnalyticsPagination(
  rows: Array<Record<string, number | string>>,
  limit: AnalyticsResultLimitKey,
  requestedPage: number,
) {
  const pageSize = limit === "all" ? rows.length || 1 : Number(limit);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, rows.length);
  return {
    rows: limit === "all" ? rows : rows.slice(start, end),
    page,
    pageSize,
    total: rows.length,
    totalPages,
    start: rows.length ? start + 1 : 0,
    end,
    pageNumbers: getAnalyticsPaginationPages(page, totalPages),
  };
}

function getAnalyticsPaginationPages(currentPage: number, totalPages: number) {
  const firstPage = Math.max(1, currentPage - 2);
  const lastPage = Math.min(totalPages, firstPage + 4);
  const startPage = Math.max(1, lastPage - 4);
  return Array.from({ length: lastPage - startPage + 1 }, (_, index) => startPage + index);
}

function AnalyticsRankingTable({
  columns,
  rows,
}: {
  columns: AnalyticsTableColumn[];
  rows: Array<Record<string, number | string>>;
}) {
  if (!rows.length) {
    return <div className="text-sm text-muted-foreground">No data available.</div>;
  }
  const groupedHeaders = getAnalyticsGroupedHeaders(columns);
  const hasGroupedHeaders = groupedHeaders.some((header) => header.group);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] table-fixed border-collapse text-sm">
        <colgroup>
          {columns.map((column, index) => (
            <col key={column.key} className={index === 0 ? "w-40" : "w-32"} />
          ))}
        </colgroup>
        <thead>
          {hasGroupedHeaders ? (
            <>
              <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                {groupedHeaders.map((header) => (
                  <th
                    key={header.key}
                    colSpan={header.colSpan}
                    rowSpan={header.group ? 1 : 2}
                    className={
                      "px-3 py-2 font-medium " +
                      (header.align === "left" ? "text-left" : "text-center")
                    }
                  >
                    {header.label}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                {columns
                  .filter((column) => column.group)
                  .map((column) => (
                    <th key={column.key} className="px-3 py-2 text-center font-medium">
                      {column.label}
                    </th>
                  ))}
              </tr>
            </>
          ) : (
            <tr className="border-b border-border text-xs uppercase text-muted-foreground">
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={
                    "px-3 py-2 font-medium " +
                    (column.align === "left" ? "text-left" : "text-center")
                  }
                >
                  {column.label}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.name)} className="border-b border-border/60 last:border-0">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={
                    "whitespace-pre-line px-3 py-2 tabular-nums " +
                    (column.align === "left" ? "text-left font-medium" : "text-center")
                  }
                >
                  {column.render
                    ? column.render(row[column.key] ?? "", row)
                    : column.format
                      ? column.format(row[column.key] ?? "", row)
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

function AnalyticsPaginationControls({
  page,
  totalPages,
  total,
  start,
  end,
  pageNumbers,
  onPageChange,
}: ReturnType<typeof getAnalyticsPagination> & {
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="text-xs text-muted-foreground">
        Showing {start}-{end} of {total}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          Previous
        </button>
        {pageNumbers.map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            onClick={() => onPageChange(pageNumber)}
            className={
              "h-8 min-w-8 rounded-md border px-2 text-xs font-medium " +
              (pageNumber === page
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-accent")
            }
          >
            {pageNumber}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function getAnalyticsGroupedHeaders(columns: AnalyticsTableColumn[]) {
  const headers: Array<{
    key: string;
    label: string;
    group?: string;
    colSpan: number;
    align?: "left" | "right";
  }> = [];

  columns.forEach((column) => {
    if (!column.group) {
      headers.push({
        key: column.key,
        label: column.label,
        colSpan: 1,
        align: column.align,
      });
      return;
    }

    const previous = headers[headers.length - 1];
    if (previous?.group === column.group) {
      previous.colSpan += 1;
      return;
    }

    headers.push({
      key: column.group,
      label: column.group,
      group: column.group,
      colSpan: 1,
    });
  });

  return headers;
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
      completed,
      { label: milestone.pendingLabel, count: milestone.pending, onClick: onPendingClick },
    ];
  }

  if (milestone.key === "payment") {
    return [
      completed,
      { label: milestone.pendingLabel, count: milestone.pending, onClick: onPendingClick },
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
  onOverdueClick,
}: {
  milestone: {
    key: string;
    label: string;
    completed: number;
    due: number;
    overdue: number;
  };
  index: number;
  isLast: boolean;
  onCompletedClick: () => void;
  onDueClick: () => void;
  onOverdueClick: () => void;
}) {
  const tone = getMilestoneTone(milestone.overdue || milestone.due);

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
            <button
              type="button"
              onClick={onOverdueClick}
              className={
                "rounded-md px-2 py-1 text-center hover:ring-2 hover:ring-ring/30 " +
                getMilestoneTone(milestone.overdue).count
              }
            >
              <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
                Overdue
              </span>
              <span className="block text-base font-semibold tabular-nums">
                {milestone.overdue}
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
    liveFiles: files.filter(isLiveFile).length,
    fileClosed: files.filter(isFileClosed).length,
    ld: countLdOrders(files),
    demandCancelled: files.filter((file) =>
      fileSupplyOrders(file).some((order) => isYes(order.demandCancelled)),
    ).length,
    soCancelled: files.filter((file) =>
      fileSupplyOrders(file).some((order) => isYes(order.soCancelled)),
    ).length,
    multipleSupplyOrders: files.filter((file) => fileSupplyOrders(file).length > 1).length,
  };
}

function isLiveFile(file: FileRecord) {
  return !isFileClosed(file) && !isCancelledFile(file);
}

function isFileClosed(file: Pick<FileRecord, "completedMilestones">) {
  return Boolean(
    file.completedMilestones?.some(
      (milestone) =>
        normalizeMilestoneName(milestone) === normalizeMilestoneName(fileClosedMilestone),
    ),
  );
}

function getAnalyticsSummary(
  files: ReturnType<typeof useAccessibleFiles>,
  divisions: Division[],
  valueThresholdLevels: ValueThresholdLevel[] = [],
) {
  return {
    divisionFileRanking: getDivisionFileRanking(files),
    divisionValueRanking: getDivisionValueRanking(files, divisions),
    divisionTurnaroundRanking: getDivisionTurnaroundRanking(files),
    topFirmSupplyOrders: getTopFirmSupplyOrders(files),
    topIndentorsByFiles: getTopIndentorsByFiles(files),
    topIndentorsByValue: getTopIndentorsByValue(files),
    milestoneClearingRanking: getMilestoneClearingRanking(files),
    monthlyFileInflow: getMonthlyFileInflow(files),
    biddingModeMix: getBiddingModeMix(files),
    fileValueThresholds: getFileValueThresholds(files, valueThresholdLevels),
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

function getDivisionValueRanking(files: FileRecord[], divisions: Division[]) {
  const totals = new Map<
    string,
    {
      allocatedCapital: number;
      allocatedRevenue: number;
      intendedCapital: number;
      intendedRevenue: number;
      bookedCapital: number;
      bookedRevenue: number;
      committedCapital: number;
      committedRevenue: number;
    }
  >();
  const getCurrent = (name: string) =>
    totals.get(name) ?? {
      allocatedCapital: 0,
      allocatedRevenue: 0,
      intendedCapital: 0,
      intendedRevenue: 0,
      bookedCapital: 0,
      bookedRevenue: 0,
      committedCapital: 0,
      committedRevenue: 0,
    };

  divisions.forEach((division) => {
    const name = getAnalyticsName(division.name, "Unassigned");
    const current = getCurrent(name);
    totals.set(name, {
      ...current,
      allocatedCapital: current.allocatedCapital + (parseAmount(division.allocatedCapital) ?? 0),
      allocatedRevenue: current.allocatedRevenue + (parseAmount(division.allocatedRevenue) ?? 0),
    });
  });

  files.forEach((file) => {
    const name = getAnalyticsName(file.division, "Unassigned");
    const current = getCurrent(name);
    const cancelled = isCancelledFile(file);
    const demandCapital = cancelled ? 0 : (getInrAmount(file.valueCapital, file) ?? 0);
    const demandRevenue = cancelled ? 0 : (getInrAmount(file.valueRevenue, file) ?? 0);
    const committedCapital = cancelled ? 0 : getFileCommittedCapitalValue(file);
    const committedRevenue = cancelled ? 0 : getFileCommittedRevenueValue(file);
    totals.set(name, {
      allocatedCapital: current.allocatedCapital,
      allocatedRevenue: current.allocatedRevenue,
      intendedCapital:
        current.intendedCapital + (!hasFilledField(file, "imms") ? demandCapital : 0),
      intendedRevenue:
        current.intendedRevenue + (!hasFilledField(file, "imms") ? demandRevenue : 0),
      bookedCapital: current.bookedCapital + (committedCapital > 0 ? 0 : demandCapital),
      bookedRevenue: current.bookedRevenue + (committedRevenue > 0 ? 0 : demandRevenue),
      committedCapital: current.committedCapital + committedCapital,
      committedRevenue: current.committedRevenue + committedRevenue,
    });
  });
  return Array.from(totals.entries())
    .map(([name, values]) => ({
      name,
      allocatedCapital: Math.round(values.allocatedCapital),
      allocatedRevenue: Math.round(values.allocatedRevenue),
      allocatedTotal: Math.round(values.allocatedCapital + values.allocatedRevenue),
      intendedCapital: Math.round(values.intendedCapital),
      intendedRevenue: Math.round(values.intendedRevenue),
      intendedTotal: Math.round(values.intendedCapital + values.intendedRevenue),
      bookedCapital: Math.round(values.bookedCapital),
      bookedRevenue: Math.round(values.bookedRevenue),
      bookedTotal: Math.round(values.bookedCapital + values.bookedRevenue),
      committedCapital: Math.round(values.committedCapital),
      committedRevenue: Math.round(values.committedRevenue),
      committedTotal: Math.round(values.committedCapital + values.committedRevenue),
    }))
    .sort(
      (a, b) => b.allocatedCapital + b.allocatedRevenue - (a.allocatedCapital + a.allocatedRevenue),
    );
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
  return mapEntriesToSortedRows(totals, "value");
}

function getTopIndentorsByFiles(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const name = getAnalyticsName(file.indentor, "Unassigned indentor");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return mapEntriesToSortedRows(counts, "count");
}

function getTopIndentorsByValue(files: FileRecord[]) {
  const totals = new Map<string, number>();
  files.forEach((file) => {
    const name = getAnalyticsName(file.indentor, "Unassigned indentor");
    totals.set(name, (totals.get(name) ?? 0) + getFileTotalValue(file));
  });
  return mapEntriesToSortedRows(totals, "value");
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

function getFileValueThresholds(files: FileRecord[], levels: ValueThresholdLevel[]) {
  if (!levels.length) return [];
  const rows = levels.map((level) => ({
    name: level.label,
    appliesTo: formatThresholdAppliesTo(level.appliesTo),
    range: formatThresholdRange(level),
    count: 0,
    capital: 0,
    revenue: 0,
    value: 0,
  }));
  const unmatched = {
    name: "Unmatched",
    appliesTo: "Both",
    range: "Outside configured ranges",
    count: 0,
    capital: 0,
    revenue: 0,
    value: 0,
  };

  files.forEach((file) => {
    if (isCancelledFile(file)) return;
    const capital = getInrAmount(file.valueCapital, file) ?? 0;
    const revenue = getInrAmount(file.valueRevenue, file) ?? 0;
    const valueType = capital > 0 ? "capital" : revenue > 0 ? "revenue" : undefined;
    const amount = valueType === "capital" ? capital : valueType === "revenue" ? revenue : 0;
    if (!valueType || amount <= 0) return;
    const matchIndex = levels.findIndex((level) => isThresholdMatch(level, valueType, amount));
    const row = matchIndex >= 0 ? rows[matchIndex] : unmatched;
    row.count += 1;
    row.capital += capital;
    row.revenue += revenue;
    row.value += capital + revenue;
  });

  const roundedRows = rows.map(roundThresholdAnalyticsRow);
  return unmatched.count ? [...roundedRows, roundThresholdAnalyticsRow(unmatched)] : roundedRows;
}

function isThresholdMatch(
  level: ValueThresholdLevel,
  valueType: "capital" | "revenue",
  value: number,
) {
  if (level.appliesTo !== "both" && level.appliesTo !== valueType) return false;
  const min = parseAmount(level.minValue);
  const max = parseAmount(level.maxValue);
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

function roundThresholdAnalyticsRow(row: {
  name: string;
  appliesTo: string;
  range: string;
  count: number;
  capital: number;
  revenue: number;
  value: number;
}) {
  return {
    ...row,
    capital: Math.round(row.capital),
    revenue: Math.round(row.revenue),
    value: Math.round(row.value),
  };
}

function formatThresholdAppliesTo(value: ValueThresholdLevel["appliesTo"]) {
  if (value === "capital") return "Capital";
  if (value === "revenue") return "Revenue";
  return "Both";
}

function formatThresholdRange(level: ValueThresholdLevel) {
  const min = parseAmount(level.minValue);
  const max = parseAmount(level.maxValue);
  if (min !== undefined && max !== undefined) {
    return `${formatLakhRangeAmount(min)}-${formatLakhRangeAmount(max)} L`;
  }
  if (min !== undefined) return `${formatLakhRangeAmount(min)} L+`;
  if (max !== undefined) return `0-${formatLakhRangeAmount(max)} L`;
  return "Any value";
}

function formatLakhRangeAmount(value: number) {
  const lakhs = value / 100000;
  return Number.isInteger(lakhs)
    ? String(lakhs)
    : lakhs.toLocaleString("en-IN", { maximumFractionDigits: 2 });
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

function getFileCommittedCapitalValue(file: FileRecord) {
  const orders = file.supplyOrders?.filter((order) =>
    Object.values(order).some((value) => Boolean(String(value ?? "").trim())),
  );
  if (orders?.length) {
    return orders.reduce((sum, order) => sum + (getInrAmount(order.soValueCapital, file) ?? 0), 0);
  }
  return getInrAmount(file.soValueCapital, file) ?? 0;
}

function getFileCommittedRevenueValue(file: FileRecord) {
  const orders = file.supplyOrders?.filter((order) =>
    Object.values(order).some((value) => Boolean(String(value ?? "").trim())),
  );
  if (orders?.length) {
    return orders.reduce((sum, order) => sum + (getInrAmount(order.soValueRevenue, file) ?? 0), 0);
  }
  return getInrAmount(file.soValueRevenue, file) ?? 0;
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
  if (isCancelledFile(file)) return false;
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
  "Controlling",
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
  fileClosedMilestone,
];

function getConfiguredMilestones(milestones: string[] | undefined) {
  const values = (milestones ?? [])
    .map((item) => normalizeConfiguredMilestoneLabel(item.trim()))
    .filter(Boolean);
  const configured = values.length ? values : defaultManualMilestones;
  return appendFileClosedMilestone(configured);
}

function appendFileClosedMilestone(milestones: string[]) {
  const withoutFileClosed = milestones.filter(
    (milestone) =>
      normalizeMilestoneName(milestone) !== normalizeMilestoneName(fileClosedMilestone),
  );
  return [...withoutFileClosed, fileClosedMilestone];
}

function normalizeConfiguredMilestoneLabel(milestone: string) {
  return normalizeMilestoneName(milestone) === "controlled" ? "Controlling" : milestone;
}

function getManualMilestoneFlow(
  files: ReturnType<typeof useAccessibleFiles>,
  milestones: string[],
) {
  const configured = milestones
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => normalizeMilestoneName(name) !== normalizeMilestoneName(fileClosedMilestone));
  const extras = files
    .map((file) => file.currentMilestone?.trim())
    .filter((name): name is string => Boolean(name))
    .filter((name) => !configured.includes(name));
  return [...configured, ...Array.from(new Set(extras)).sort()].map((name) => ({
    name,
    current: files.filter((file) => !isCancelledFile(file) && file.currentMilestone === name)
      .length,
    completed: files.filter((file) => file.completedMilestones?.includes(name)).length,
  }));
}

function getMilestoneFlow(files: ReturnType<typeof useAccessibleFiles>) {
  const flow = milestoneDefinitions.map((milestone) => {
    const applicableFiles = files.filter((file) => isMilestoneApplicable(file, milestone));
    const processFiles = applicableFiles.filter((file) => !isCancelledFile(file));
    const reachedFiles = processFiles.filter((file) => isEligibleMilestone(file, milestone));
    const activeFiles = processFiles.filter((file) => isManualActiveMilestone(file, milestone));
    const reviewedFiles = activeFiles.filter((file) => isMilestoneReviewed(file, milestone));
    const clearedFiles = processFiles.filter((file) => isMilestoneComplete(file, milestone));
    const pendingFiles = activeFiles.filter((file) => isPendingMilestone(file, milestone));
    const total = applicableFiles.length;
    const cleared = clearedFiles.length;
    const pending = pendingFiles.length;

    if (milestone.key === "supplyOrder") {
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: milestone.completedLabel ?? "Completed",
        totalLabel: milestone.totalLabel ?? "Total",
        pendingLabel: getMilestonePendingLabel(milestone),
        total: countEffectiveSupplyOrders(applicableFiles),
        underProcess: Math.max(0, processFiles.length - reachedFiles.length),
        active: activeFiles.length,
        pending,
        reviewed: reviewedFiles.length,
        hasReviewed: Boolean(milestone.reviewed),
        cleared: countPlacedSupplyOrders(files),
        activeLabel: "In process",
        liveSupplyOrders: countLiveSupplyOrders(files),
      };
    }

    if (milestone.key === "bankGuarantee") {
      const eligibleBgFiles = processFiles.filter(isBankGuaranteeEligible);
      const activeBgFiles = eligibleBgFiles.filter((file) =>
        isManualActiveMilestone(file, milestone),
      );
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: milestone.completedLabel ?? "Completed",
        totalLabel: milestone.totalLabel ?? "Total files",
        pendingLabel: getMilestonePendingLabel(milestone),
        total: countBgApplicableOrders(files),
        underProcess: Math.max(
          0,
          processFiles.filter((file) => !isEligibleMilestone(file, milestone)).length,
        ),
        active: activeBgFiles.length,
        pending: countBgPendingOrders(files),
        reviewed: 0,
        hasReviewed: Boolean(milestone.reviewed),
        cleared: countBgReceivedOrders(files),
        activeLabel: "In process",
      };
    }

    if (milestone.key === "payment") {
      const paymentCompleted = countPaymentCompletedOrders(files);
      const paymentPending = countPaymentPendingOrders(files);
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: milestone.completedLabel ?? "Completed",
        totalLabel: milestone.totalLabel ?? "Total",
        pendingLabel: getMilestonePendingLabel(milestone),
        total: paymentCompleted + paymentPending,
        underProcess: Math.max(0, processFiles.length - reachedFiles.length),
        active: activeFiles.length,
        pending: paymentPending,
        reviewed: reviewedFiles.length,
        hasReviewed: Boolean(milestone.reviewed),
        cleared: paymentCompleted,
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
      underProcess: Math.max(0, processFiles.length - reachedFiles.length),
      active: activeFiles.length,
      pending,
      reviewed: reviewedFiles.length,
      hasReviewed: Boolean(milestone.reviewed),
      cleared,
      activeLabel: "In process",
      liveBids:
        milestone.key === "bidding" ? processFiles.filter(isFileTenderLive).length : undefined,
      overdueBids:
        milestone.key === "bidding" ? processFiles.filter(isBidOverdue).length : undefined,
      inProcessBids:
        milestone.key === "bidding"
          ? activeFiles.filter((file) => !isFileTenderLive(file) && !isBidOverdue(file)).length
          : undefined,
    };
  });
  const supplyOrderIndex = flow.findIndex((milestone) => milestone.key === "supplyOrder");
  const delivery = {
    key: "delivery",
    label: "Delivery",
    completed: countDeliveryCompletedOrders(files),
    due: countLiveSupplyOrders(files),
    overdue: countDeliveryOverdueOrders(files),
  };
  const deliveryPeriod = {
    key: "deliveryPeriod",
    label: "Delivery Period",
    valid: countDeliveryPeriodValidOrders(files),
    expired: countDeliveryPeriodExpiredOrders(files),
    extended: countDeliveryPeriodExtendedOrders(files),
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
  if (isCancelledFile(file)) return false;
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
  if (isCancelledFile(file)) return false;
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
  if (isCancelledFile(file)) return false;
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
  if (isCancelledFile(file)) return false;
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
  "irPreparationDate",
  "irReceiptDate",
  "billPreparationDate",
  "billSentForPaymentDate",
  "paymentDate",
  "soCancelledDate",
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
    irPreparationDate: file.irPreparationDate,
    irReceiptDate: file.irReceiptDate,
    billPreparationDate: file.billPreparationDate,
    billSentForPaymentDate: file.billSentForPaymentDate,
    paymentDate: file.paymentDate,
    bgReturnDate: file.bgReturnDate,
    ld: file.ld,
    demandCancelled: file.demandCancelled,
    soCancelled: file.soCancelled,
    soCancelledDate: file.soCancelledDate,
  };
  return Object.values(legacy).some((value) => Boolean(String(value ?? "").trim())) ? [legacy] : [];
}

function effectiveSupplyOrderEntries(files: FileRecord[]) {
  return files.flatMap((file) => fileSupplyOrders(file).map((order) => ({ file, order })));
}

function isSupplyOrderCancelled(file: FileRecord, order: SupplyOrderDetail) {
  return (
    isYes(file.demandCancelled) ||
    isYes(file.soCancelled) ||
    isYes(order.demandCancelled) ||
    isYes(order.soCancelled)
  );
}

function countEffectiveSupplyOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).length;
}

function countPlacedSupplyOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(({ order }) => hasSupplyOrderDate(order)).length;
}

function countLiveSupplyOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      hasSupplyOrderDate(order) &&
      !hasFilledString(order.materialReceiptDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countDeliveryCompletedOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      hasSupplyOrderDate(order) &&
      hasFilledString(order.materialReceiptDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countDeliveryOverdueOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      hasSupplyOrderDate(order) &&
      !hasFilledString(order.materialReceiptDate) &&
      !isSupplyOrderCancelled(file, order) &&
      isDateBeforeToday(getDeliveryPeriodDate(order)),
  ).length;
}

function countDeliveryPeriodValidOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      hasSupplyOrderDate(order) &&
      Boolean(getDeliveryPeriodDate(order)) &&
      isDateAfterToday(getDeliveryPeriodDate(order)) &&
      !hasFilledString(order.materialReceiptDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countDeliveryPeriodExpiredOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      hasSupplyOrderDate(order) &&
      Boolean(getDeliveryPeriodDate(order)) &&
      isDateBeforeToday(getDeliveryPeriodDate(order)) &&
      !hasFilledString(order.materialReceiptDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countDeliveryPeriodExtendedOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      hasSupplyOrderDate(order) &&
      hasFilledString(order.revisedDp) &&
      Boolean(getDeliveryPeriodDate(order)) &&
      isDateAfterToday(getDeliveryPeriodDate(order)) &&
      !hasFilledString(order.materialReceiptDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countBgApplicableOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) => isYes(file.bg) && !isSupplyOrderCancelled(file, order),
  ).length;
}

function countBgReceivedOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isYes(file.bg) &&
      hasFilledString(order.bgValidityDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countBgPendingOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isYes(file.bg) &&
      hasSupplyOrderDate(order) &&
      !hasFilledString(order.bgValidityDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countPaymentCompletedOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) => hasFilledString(order.paymentDate) && !isSupplyOrderCancelled(file, order),
  ).length;
}

function countPaymentPendingOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      hasFilledString(order.materialReceiptDate) &&
      !hasFilledString(order.paymentDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countLdOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ order }) => isYes(order.ld) && !isYes(order.soCancelled),
  ).length;
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
  return fileSupplyOrders(file).some((order) => isDateBeforeToday(getDeliveryPeriodDate(order)));
}

function isDeliveryOverdue(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isOverdueDeliveryOrder);
}

function isDeliveryCompleted(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isCompletedDeliveryOrder);
}

function isDeliveryDue(file: FileRecord) {
  if (isCancelledFile(file)) return false;
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
  return getLaterDate(order.dpDate, order.revisedDp);
}

function isOverdueDeliveryOrder(order: SupplyOrderDetail) {
  return isDueDeliveryOrder(order) && isDateBeforeToday(getDeliveryDueDate(order));
}

function isDeliveryPeriodValid(file: FileRecord) {
  return isDeliveryPeriodActive(file) && fileSupplyOrders(file).some(isValidDeliveryPeriodOrder);
}

function isDeliveryPeriodExpired(file: FileRecord) {
  if (isCancelledFile(file)) return false;
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
  if (isCancelledFile(file)) return false;
  return (
    isYes(file.bg) &&
    fileSupplyOrders(file).some((order) => hasSupplyOrderDate(order) && !isYes(order.soCancelled))
  );
}

function isValidDeliveryPeriodOrder(order: SupplyOrderDetail) {
  const deliveryPeriodDate = getDeliveryPeriodDate(order);
  return (
    hasSupplyOrderDate(order) &&
    Boolean(deliveryPeriodDate) &&
    isDateAfterToday(deliveryPeriodDate) &&
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
  const deliveryPeriodDate = getDeliveryPeriodDate(order);
  return (
    hasSupplyOrderDate(order) &&
    hasFilledString(order.revisedDp) &&
    Boolean(deliveryPeriodDate) &&
    isDateAfterToday(deliveryPeriodDate) &&
    !hasFilledString(order.materialReceiptDate)
  );
}

function getDeliveryPeriodDate(order: SupplyOrderDetail) {
  return getLaterDate(order.dpDate, order.revisedDp);
}

function getLaterDate(first: string | undefined, second: string | undefined) {
  const firstTime = parseLocalDateTime(first ?? "");
  const secondTime = parseLocalDateTime(second ?? "");
  if (firstTime === undefined) return second;
  if (secondTime === undefined) return first;
  return secondTime > firstTime ? second : first;
}

function hasSupplyOrderDate(order: SupplyOrderDetail) {
  return hasFilledString(order.soDate);
}

const statusExportFileColumns = [
  { key: "division", label: "Division" },
  { key: "indentor", label: "Indentor" },
  { key: "demandDescription", label: "Demand description" },
  { key: "lastDateDescription", label: "Last status" },
  { key: "lastDate", label: "Date" },
];
const statusPageExportHeaders = ["S.No.", "Section", "Metric", "Count"];
const financeExportHeaders = ["S.No.", "Category", "Capital", "Revenue", "Notes"];

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
  deliveryOverdue: "Delivery - Overdue",
  deliveryPeriodValid: "Delivery Period - Valid",
  deliveryPeriodExpired: "Delivery Period - Expired",
  deliveryPeriodExtended: "Delivery Period - Extended",
  liveBids: "Bidding - Live",
  bidOverdue: "Bidding - Opening overdue",
  liveSupplyOrders: "Supply Order - Live",
  miscLiveFiles: "Miscellaneous - Live files",
  miscFileClosed: "Miscellaneous - File closed",
  miscLd: "Miscellaneous - LD",
  miscDemandCancelled: "Miscellaneous - Demand cancelled",
  miscSoCancelled: "Miscellaneous - S.O. cancelled",
  miscMultipleSupplyOrders: "Miscellaneous - Multiple S.O.",
};

function isPaymentDue(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) => hasFilledString(order.materialReceiptDate) && !hasFilledString(order.paymentDate),
  );
}

function getStatusSummaryDashboardFilter(milestone: string, stage: string) {
  return `statusSummary:${encodeURIComponent(milestone)}:${encodeURIComponent(stage)}`;
}

function matchesDashboardFilter(file: FileRecord, filter: string) {
  if (filter.startsWith("mode:")) return (file.mode ?? "").trim().toUpperCase() === filter.slice(5);
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
  if (filter === "miscLiveFiles") return isLiveFile(file);
  if (filter === "miscFileClosed") return isFileClosed(file);
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
      return (
        isManualActiveMilestone(file, milestone) && !isFileTenderLive(file) && !isBidOverdue(file)
      );
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
        { section: milestone.label, metric: "Overdue", count: milestone.overdue },
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
    { section: "Miscellaneous", metric: "Live files", count: miscellaneousCounts.liveFiles },
    { section: "Miscellaneous", metric: "File closed", count: miscellaneousCounts.fileClosed },
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

function exportStatusSummaryGroupsToExcel(groups: StatusSummaryTableGroup[], title: string) {
  void downloadStatusSummaryGroups(groups, title, "excel");
}

function printStatusSummaryGroupsToPdf(groups: StatusSummaryTableGroup[], title: string) {
  void downloadStatusSummaryGroups(groups, title, "pdf");
}

async function downloadStatusSummaryGroups(
  groups: StatusSummaryTableGroup[],
  title: string,
  format: "excel" | "pdf",
) {
  await downloadBackendExport({
    format,
    title,
    tables: groups.map((group) => ({
      title: group.title,
      headers: ["S.No.", "Milestone", ...group.columns],
      rows: group.rows.map((row, index) => [
        index + 1,
        row.milestone,
        ...group.columns.map((column) => row.counts[column] ?? "-"),
      ]),
    })),
  });
}

function getStatusSummaryGroupHtml(group: StatusSummaryTableGroup) {
  return `
    <table>
      <thead>
        <tr>
          <th>S.No.</th>
          <th>Milestone</th>
          ${group.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${group.rows
          .map(
            (row, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(row.milestone)}</td>
                ${group.columns
                  .map((column) => `<td>${escapeHtml(row.counts[column] ?? "-")}</td>`)
                  .join("")}
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function exportStatusPageRowsToExcel(rows: StatusPageExportRow[], title: string) {
  void downloadStatusPageRows(rows, title, "excel");
}

function getLiveStatusTableHtml(rows: LiveStatusDivisionRow[], milestones: LiveStatusMilestone[]) {
  const headers = ["S.No.", "Division", "Total", ...milestones.map((milestone) => milestone.name)];
  return `
    <table>
      <thead>
        <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${
          rows.length
            ? rows
                .map(
                  (row, index) => `
                    <tr>
                      ${[
                        String(index + 1),
                        row.division,
                        String(row.total),
                        ...milestones.map((milestone) => String(row.counts[milestone.name] ?? 0)),
                      ]
                        .map((value) => `<td>${escapeHtml(value)}</td>`)
                        .join("")}
                    </tr>
                  `,
                )
                .join("")
            : `<tr><td colspan="${headers.length}">No division data available.</td></tr>`
        }
      </tbody>
    </table>
  `;
}

function exportLiveStatusRowsToExcel(
  rows: LiveStatusDivisionRow[],
  milestones: LiveStatusMilestone[],
  title: string,
) {
  void downloadLiveStatusRows(rows, milestones, title, "excel");
}

function printLiveStatusRowsToPdf(
  rows: LiveStatusDivisionRow[],
  milestones: LiveStatusMilestone[],
  title: string,
) {
  void downloadLiveStatusRows(rows, milestones, title, "pdf");
}

function printStatusPageRowsToPdf(rows: StatusPageExportRow[], title: string) {
  void downloadStatusPageRows(rows, title, "pdf");
}

async function downloadStatusPageRows(
  rows: StatusPageExportRow[],
  title: string,
  format: "excel" | "pdf",
) {
  await downloadBackendExport({
    format,
    title,
    tables: [
      {
        headers: statusPageExportHeaders,
        rows: rows.map((row, index) => [index + 1, row.section, row.metric, row.count]),
      },
    ],
  });
}

async function downloadLiveStatusRows(
  rows: LiveStatusDivisionRow[],
  milestones: LiveStatusMilestone[],
  title: string,
  format: "excel" | "pdf",
) {
  await downloadBackendExport({
    format,
    title,
    tables: [
      {
        headers: ["S.No.", "Division", "Total", ...milestones.map((milestone) => milestone.name)],
        rows: rows.map((row, index) => [
          index + 1,
          row.division,
          row.total,
          ...milestones.map((milestone) => row.counts[milestone.name] ?? 0),
        ]),
      },
    ],
  });
}

function exportFinanceRowsToExcel(rows: FinanceExportRow[], title: string) {
  void downloadFinanceRows(rows, title, "excel");
}

function exportAnalyticsPanelToExcel(panel: AnalyticsPanel) {
  void downloadAnalyticsPanel(panel, "excel");
}

function getAnalyticsCellValue(row: Record<string, number | string>, column: AnalyticsTableColumn) {
  const value = row[column.key] ?? "";
  return column.format ? column.format(value, row) : String(value);
}

function getAnalyticsHeaderHtml(columns: AnalyticsTableColumn[], includeSerial = false) {
  const groupedHeaders = getAnalyticsGroupedHeaders(columns);
  const hasGroupedHeaders = groupedHeaders.some((header) => header.group);

  if (!hasGroupedHeaders) {
    return `<tr>${includeSerial ? "<th>S.No.</th>" : ""}${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>`;
  }

  return `
    <tr>
      ${includeSerial ? `<th rowspan="2">S.No.</th>` : ""}
      ${groupedHeaders
        .map((header) =>
          header.group
            ? `<th colspan="${header.colSpan}">${escapeHtml(header.label)}</th>`
            : `<th rowspan="2">${escapeHtml(header.label)}</th>`,
        )
        .join("")}
    </tr>
    <tr>
      ${columns
        .filter((column) => column.group)
        .map((column) => `<th>${escapeHtml(column.label)}</th>`)
        .join("")}
    </tr>
  `;
}

function printAnalyticsPanelToPdf(panel: AnalyticsPanel) {
  void downloadAnalyticsPanel(panel, "pdf");
}

function getAnalyticsExportCellHtml(
  row: Record<string, number | string>,
  column: AnalyticsTableColumn,
  panel: AnalyticsPanel,
) {
  if (panel.key === "divisionValue" && column.group) {
    const value = Number(row[column.key] ?? 0);
    const allocatedKey = column.key.endsWith("Revenue") ? "allocatedRevenue" : "allocatedCapital";
    const displayMode = panel.divisionValueDisplayMode ?? "both";
    if (column.key.startsWith("allocated") || displayMode === "value") {
      return `<td class="value-cell">${escapeHtml(formatLakhsValue(value))}</td>`;
    }
    const percent = formatDivisionValuePercent(value, Number(row[allocatedKey] ?? 0));
    if (displayMode === "percent") {
      return `<td class="value-cell">${escapeHtml(percent)}</td>`;
    }
    return `
      <td class="value-cell">
        <table class="split-value">
          <tr>
            <td class="amount">${escapeHtml(formatLakhsValue(value))}</td>
            <td class="percent">${escapeHtml(percent === "-" ? "-" : `(${percent})`)}</td>
          </tr>
        </table>
      </td>
    `;
  }
  if (panel.key === "divisionTotalValue" && column.key.endsWith("Total")) {
    const value = Number(row[column.key] ?? 0);
    const displayMode = panel.divisionValueDisplayMode ?? "both";
    if (column.key === "allocatedTotal" || displayMode === "value") {
      return `<td class="value-cell">${escapeHtml(formatLakhsValue(value))}</td>`;
    }
    const percent = formatDivisionValuePercent(value, Number(row.allocatedTotal ?? 0));
    if (displayMode === "percent") {
      return `<td class="value-cell">${escapeHtml(percent)}</td>`;
    }
    return `
      <td class="value-cell">
        <table class="split-value">
          <tr>
            <td class="amount">${escapeHtml(formatLakhsValue(value))}</td>
            <td class="percent">${escapeHtml(percent === "-" ? "-" : `(${percent})`)}</td>
          </tr>
        </table>
      </td>
    `;
  }

  return `<td>${escapeHtml(getAnalyticsCellValue(row, column)).replace(/\n/g, "<br />")}</td>`;
}

function printFinanceRowsToPdf(rows: FinanceExportRow[], title: string) {
  void downloadFinanceRows(rows, title, "pdf");
}

async function downloadFinanceRows(
  rows: FinanceExportRow[],
  title: string,
  format: "excel" | "pdf",
) {
  await downloadBackendExport({
    format,
    title,
    tables: [
      {
        headers: financeExportHeaders,
        rows: rows.map((row, index) => [
          index + 1,
          row.category,
          row.capital,
          row.revenue,
          row.notes,
        ]),
      },
    ],
  });
}

async function downloadAnalyticsPanel(panel: AnalyticsPanel, format: "excel" | "pdf") {
  await downloadBackendExport({
    format,
    title: panel.title,
    subtitle: panel.subtitle,
    description: panel.exportNote,
    tables: [
      {
        headers: ["S.No.", ...panel.columns.map((column) => column.label)],
        rows: panel.rows.map((row, index) => [
          index + 1,
          ...panel.columns.map((column) => getAnalyticsCellValue(row, column).replace(/\n/g, " ")),
        ]),
      },
    ],
  });
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
  return `${formatThousandsAndLakhs(value / 100_000, 2)} Lakh`;
}

function formatLakhsValue(value: number) {
  return formatThousandsAndLakhs(value / 100_000, 2);
}

function formatDivisionValuePercent(value: number, allocatedValue: number) {
  const percent = getPercent(value, allocatedValue);
  return percent === undefined ? "-" : formatPercent(percent);
}

function formatDivisionValueDisplay(
  value: number,
  allocatedValue: number,
  displayMode: DivisionValueDisplayMode,
) {
  if (displayMode === "value") return formatLakhsValue(value);
  const percent = formatDivisionValuePercent(value, allocatedValue);
  if (displayMode === "percent") return percent;
  return `${formatLakhsValue(value)}\n${percent === "-" ? "-" : `(${percent})`}`;
}

function renderDivisionValueDisplay(
  value: number,
  allocatedValue: number,
  displayMode: DivisionValueDisplayMode,
) {
  if (displayMode === "value") return formatLakhsValue(value);
  const percent = formatDivisionValuePercent(value, allocatedValue);
  if (displayMode === "percent") return percent;
  return (
    <span className="inline-flex w-full items-baseline justify-center gap-2 whitespace-nowrap">
      <span>{formatLakhsValue(value)}</span>
      <span className="text-xs text-muted-foreground">
        {percent === "-" ? "-" : `(${percent})`}
      </span>
    </span>
  );
}

function formatLakhsValueWithPercent(value: number, allocatedValue: number) {
  const percent = getPercent(value, allocatedValue);
  return `${formatLakhsValue(value)}\n${percent === undefined ? "-" : `(${formatPercent(percent)})`}`;
}

function renderLakhsValueWithPercent(value: number, allocatedValue: number) {
  const percent = getPercent(value, allocatedValue);
  return (
    <span className="inline-flex w-full items-baseline justify-center gap-2 whitespace-nowrap">
      <span>{formatLakhsValue(value)}</span>
      <span className="text-xs text-muted-foreground">
        {percent === undefined ? "-" : `(${formatPercent(percent)})`}
      </span>
    </span>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(value);
}
