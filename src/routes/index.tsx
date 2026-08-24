import { createFileRoute, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
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
import {
  isBiddingApplicableForFile,
  isDeliveryInspectionApplicableByGroup,
} from "@/lib/file-type-groups";
import {
  advancePaymentEntries,
  countExpectedSupplyOrderRows,
  effectivePaymentEntries as normalizedPaymentEntries,
  effectiveSupplyOrderEntries as normalizedSupplyOrderEntries,
  expectedSupplyOrders as normalizedExpectedSupplyOrders,
  filePaymentOrders as normalizedFilePaymentOrders,
  fileSupplyOrders as normalizedFileSupplyOrders,
  isExpiredDeliveryPeriodEntry,
  isExtendedDeliveryPeriodEntry,
  getAdvancePaymentCapital,
  getAdvancePaymentRevenue,
  isAdvancePaymentCompleted,
  isAdvancePaymentPaid,
  isAdvancePaymentPending,
  isValidDeliveryPeriodEntry,
  rawSupplyOrders as normalizedRawSupplyOrders,
} from "@/lib/effective-deliveries";
import { downloadBackendExport, downloadBackendFileSearchExport } from "@/lib/export-download";
import {
  allFileCategoryKeys,
  fileCategoryOptions,
  fileMatchesCategory,
  filterFilesByCategory,
  getVisibleFileCategoryKeys,
  getVisibleFileCategoryOptions,
  serializeFileCategories,
  type FileCategoryKey,
} from "@/lib/file-categories";
import { formatThousandsAndLakhs, getInrAmount, hasAmount, parseAmount } from "@/lib/money";
import { isCancelledFile } from "@/lib/year-filter";
import { formatIsoDateForDisplay } from "@/components/date-input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowRight, FileSpreadsheet, FileText, Info, Search } from "lucide-react";

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
type FinanceFirmTypeDistributionKey = "supplyOrderValue" | "actualPayment";
type FirmAnalysisRoleKey = "bq" | "invited" | "participated" | "order";
type FirmAnalysisOperator = "or" | "and";
type AnalyticsPanelKey =
  | "divisionFiles"
  | "divisionValue"
  | "divisionTotalValue"
  | "divisionTurnaround"
  | "topFirms"
  | "firmAnalysis"
  | "indentorsByFiles"
  | "indentorsByValue"
  | "biddingMode"
  | "fileValueThresholds"
  | "paymentPending"
  | "preBidMeetings"
  | "tcecStatus"
  | "cncSummary"
  | "suspectedAnomaly"
  | "delayStatus"
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
type AnalyticsSearchTarget = {
  dashboardFilter?: string;
  division?: string;
  analyticsType?: "firm" | "indentor";
  analyticsNames?: string[];
  focusSection?: string;
  focusMilestone?: string;
  focusTarget?: string;
};
type TcecStatusStage = "pre" | "post";
type SummarySubMetric = { label: string; value: number | string; searchFilter?: string };
type FinanceSplitValue = { capital: string; revenue: string };
type SummaryMetricValue = number | string | FinanceSplitValue | SummarySubMetric[];
type FinanceCarryForwardTotal = { count: number; capital: number; revenue: number; total: number };
type FinanceCarryForwardRow = FinanceCarryForwardTotal & {
  year: string;
  filter: string;
};
type DelayStatusSummary = {
  averageDays: number;
  longestDays: number;
  byMilestone: Array<{ key: string; label: string; count: number }>;
};
type PreBidMeetingRow = {
  name: string;
  monthKey: string;
  count: number;
  preBidDue: number;
  preBidCompleted: number;
  refloatPreBidDue: number;
  refloatPreBidCompleted: number;
};
type SuspectedAnomalyRow = {
  signature: string;
  fileId: string;
  fileRef: string;
  division: string;
  indentor: string;
  description: string;
  block: string;
  rule: string;
  ruleKey?: string;
  previousField: string;
  previousDate: string;
  laterField: string;
  laterDate: string;
  accepted: "No";
  requestStatus?: string;
  userExplanation?: string;
  adminMessage?: string;
  requestedByName?: string;
  requestedAt?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  scope?: string;
};
type AnomalyAcceptanceRow = {
  signature: string;
  reason?: string;
  ruleKey?: string;
  ruleLabel?: string;
  previousField?: string;
  previousValue?: string;
  laterField?: string;
  laterValue?: string;
  context?: string;
  fileId?: string;
  fileRef?: string;
  status: string;
  scope: string;
  requestedByName?: string;
  requestedAt?: string;
  acceptedByName?: string;
  acceptedAt?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  revokedByName?: string;
  revokedAt?: string;
  adminMessage?: string;
};
type AnomalyRuleRow = {
  id: string;
  name: string;
  description: string;
  ruleType: string;
  fieldA: string;
  operator: string;
  fieldB?: string;
  fixedValue?: string;
  thresholdDays?: number;
  severity: string;
  scope: string;
  enabled: boolean;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
};
type AnomalyRuleField = { key: string; label: string; scope: string };
type SummaryStat = {
  label: string;
  value: SummaryMetricValue;
  hint?: string;
  searchFilter?: string;
};

function hasAnomalyAdminAccess(role?: string) {
  return role === "admin" || role === "sub_admin";
}

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
  gemBiddingModeCounts: ReturnType<typeof getGemBiddingModeCounts>;
  topSummaryStats: SummaryStat[];
  fileTypeStats: SummaryStat;
  firmTypeStats: SummaryStat;
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
    paidCapital: number;
    paidRevenue: number;
    sameYearPaidCapital?: number;
    sameYearPaidRevenue?: number;
    advanceCapital: number;
    advanceRevenue: number;
    carryForward?: FinanceCarryForwardTotal;
    clearedCarryForward?: FinanceCarryForwardTotal;
    previousCarryForward?: FinanceCarryForwardTotal;
    futureClearedCarryForward?: FinanceCarryForwardTotal;
    carryForwardBreakup?: FinanceCarryForwardRow[];
    clearedCarryForwardBreakup?: FinanceCarryForwardRow[];
    previousCarryForwardBreakup?: FinanceCarryForwardRow[];
    futureClearedCarryForwardBreakup?: FinanceCarryForwardRow[];
  };
  financeFirmTypeDistributions: Record<
    FinanceFirmTypeDistributionKey,
    Array<{ name: string; value: number; share: number }>
  >;
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

async function fetchMonthWiseDeliverySchedule(query: string, signal: AbortSignal) {
  const response = await fetch(
    `${API_BASE_URL}/api/dashboard/monthwise-delivery-schedule?${query}`,
    {
      credentials: "include",
      signal,
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(
      body?.error ?? `Month-wise delivery schedule request failed: ${response.status}`,
    );
  }
  return (await response.json()) as {
    rows: Array<{ name: string; monthKey: string; grossCount: number; netCount: number }>;
  };
}

async function fetchSuspectedAnomalies(query: string, signal: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}/api/dashboard/suspected-anomalies?${query}`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Suspected anomaly request failed: ${response.status}`);
  }
  return (await response.json()) as { rows: SuspectedAnomalyRow[] };
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
  return (await response.json()) as {
    summary: {
      statusSummaryGroups: StatusSummaryTableGroup[];
      delaySummary: DelayStatusSummary;
      preBidMeetingRows: PreBidMeetingRow[];
    };
  };
}

async function downloadDashboardStatusFiles({
  dashboardFilter,
  division,
  selectedYear,
  fileCategories,
  format,
  title,
}: {
  dashboardFilter: string;
  division: string;
  selectedYear: string;
  fileCategories: FileCategoryKey[];
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
      fileCategories: serializeFileCategories(fileCategories),
      ...(division === "all" ? {} : { divisionFilter: division }),
    },
  });
}

const divisionFilterableAnalyticsPanels: AnalyticsPanelKey[] = [
  "topFirms",
  "indentorsByFiles",
  "indentorsByValue",
  "biddingMode",
  "fileValueThresholds",
  "paymentPending",
  "preBidMeetings",
  "tcecStatus",
  "cncSummary",
  "suspectedAnomaly",
  "delayStatus",
  "milestoneClearingTable",
];
const analyticsResultLimitOptions = [
  { value: "5", label: "Top 5" },
  { value: "10", label: "Top 10" },
  { value: "20", label: "Top 20" },
  { value: "50", label: "Top 50" },
  { value: "all", label: "All" },
] satisfies Array<{ value: AnalyticsResultLimitKey; label: string }>;
const delayMilestoneOptions = [
  { key: "scrutiny", label: "Scrutiny" },
  { key: "highValue", label: "High Value" },
  { key: "tcec", label: "Pre-TCEC" },
  { key: "ad", label: "AD" },
  { key: "rqa", label: "R&QA" },
  { key: "control", label: "Controlling" },
  { key: "ifa", label: "IFA" },
  { key: "cfa", label: "CFA" },
  { key: "bidding", label: "Bidding" },
  { key: "postTcec", label: "Post-TCEC" },
  { key: "cnc", label: "CNC" },
  { key: "financialSanction", label: "Financial Sanction" },
  { key: "supplyOrder", label: "Supply Order" },
  { key: "advancePayment", label: "Advance Payment" },
  { key: "psb", label: "PSB" },
  { key: "pwb", label: "PWB" },
  { key: "psbPwb", label: "PSB+PWB" },
  { key: "delivery", label: "Delivery" },
  { key: "jobCompletion", label: "Job Completion" },
  { key: "irPreparation", label: "IR Preparation" },
  { key: "irReceipt", label: "IR Receipt" },
  { key: "billPreparation", label: "Bill preparation" },
  { key: "billSentForPayment", label: "Bill sent for payment" },
  { key: "payment", label: "Payment" },
];
const financeFirmTypeDistributionOptions = [
  { key: "supplyOrderValue", label: "S.O. value by firm type" },
  { key: "actualPayment", label: "Actual payment by firm type" },
] satisfies Array<{ key: FinanceFirmTypeDistributionKey; label: string }>;
const firmAnalysisRoleOptions = [
  { key: "bq", label: "BQ" },
  { key: "invited", label: "Invited" },
  { key: "participated", label: "Participated" },
  { key: "order", label: "Got order" },
] satisfies Array<{ key: FirmAnalysisRoleKey; label: string }>;
const fileClosedMilestone = "File Closed";
const supplyOrderMilestoneNames = [
  "Financial Sanction",
  "Advance Payment",
  "Supply Order",
  "PSB",
  "PWB",
  "PSB+PWB",
  "Delivery",
  "Job Completion",
  "IR Preparation",
  "IR Receipt",
  "Bill preparation",
  "Bill sent for payment",
  "Payment",
];

function isDivisionFilterableAnalyticsPanel(panelKey: AnalyticsPanelKey) {
  return divisionFilterableAnalyticsPanels.includes(panelKey);
}

function isAnalyticsPanelKey(value: unknown): value is AnalyticsPanelKey {
  return (
    value === "divisionFiles" ||
    value === "divisionValue" ||
    value === "divisionTotalValue" ||
    value === "divisionTurnaround" ||
    value === "topFirms" ||
    value === "firmAnalysis" ||
    value === "indentorsByFiles" ||
    value === "indentorsByValue" ||
    value === "biddingMode" ||
    value === "fileValueThresholds" ||
    value === "paymentPending" ||
    value === "tcecStatus" ||
    value === "cncSummary" ||
    value === "suspectedAnomaly" ||
    value === "delayStatus" ||
    value === "milestoneClearingTable"
  );
}

export function Dashboard() {
  const locationSearch = useRouterState({ select: (state) => state.location.search });
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
  useEffect(() => {
    const requestedTab =
      typeof locationSearch.tab === "string" ? locationSearch.tab : undefined;
    const requestedPanel =
      typeof locationSearch.analyticsPanel === "string"
        ? locationSearch.analyticsPanel
        : undefined;
    if (requestedTab === "analytics") setActiveDashboardTab("analytics");
    if (isAnalyticsPanelKey(requestedPanel)) setActiveAnalyticsPanel(requestedPanel);
  }, [locationSearch.analyticsPanel, locationSearch.tab]);
  const [topFirmLimit, setTopFirmLimit] = useState<AnalyticsResultLimitKey>("20");
  const [selectedFirmAnalysisFirm, setSelectedFirmAnalysisFirm] = useState("");
  const [firmAnalysisOperators, setFirmAnalysisOperators] = useState<Record<string, FirmAnalysisOperator>>({});
  const [negatedFirmAnalysisRoles, setNegatedFirmAnalysisRoles] = useState<FirmAnalysisRoleKey[]>([]);
  const [selectedFirmAnalysisRoles, setSelectedFirmAnalysisRoles] = useState<FirmAnalysisRoleKey[]>(
    ["bq", "invited", "participated", "order"],
  );
  const [financeFirmTypeDistributionKey, setFinanceFirmTypeDistributionKey] =
    useState<FinanceFirmTypeDistributionKey>("supplyOrderValue");
  const [indentorsByFilesLimit, setIndentorsByFilesLimit] = useState<AnalyticsResultLimitKey>("10");
  const [indentorsByValueLimit, setIndentorsByValueLimit] = useState<AnalyticsResultLimitKey>("10");
  const [topFirmPage, setTopFirmPage] = useState(1);
  const [indentorsByFilesPage, setIndentorsByFilesPage] = useState(1);
  const [indentorsByValuePage, setIndentorsByValuePage] = useState(1);
  const [analyticsSortDirections, setAnalyticsSortDirections] = useState<
    Partial<Record<AnalyticsPanelKey, AnalyticsSortDirection>>
  >({});
  const [selectedAnalyticsDivision, setSelectedAnalyticsDivision] = useState("all");
  const [analyticsDelayDays, setAnalyticsDelayDays] = useState("5");
  const [analyticsDelayMilestoneKey, setAnalyticsDelayMilestoneKey] = useState("all");
  const [tcecStatusStage, setTcecStatusStage] = useState<TcecStatusStage>("pre");
  const [selectedPreBidFiscalYear, setSelectedPreBidFiscalYear] = useState("");
  const [selectedTcecFiscalYear, setSelectedTcecFiscalYear] = useState("");
  const [selectedTcecCommittee, setSelectedTcecCommittee] = useState("");
  const [selectedCncFiscalYear, setSelectedCncFiscalYear] = useState("");
  const [selectedFileCategories, setSelectedFileCategories] =
    useState<FileCategoryKey[]>(allFileCategoryKeys);
  const [selectedLiveMilestones, setSelectedLiveMilestones] = useState<string[] | undefined>(
    settings.liveStatusLockedFields,
  );
  const [dashboardSummaryState, setDashboardSummaryState] = useState<
    { query: string; summary: DashboardSummaryPayload } | undefined
  >();
  const [monthWiseDeliveryScheduleState, setMonthWiseDeliveryScheduleState] = useState<
    | {
        query: string;
        rows: Array<{ name: string; monthKey: string; grossCount: number; netCount: number }>;
      }
    | undefined
  >();
  const [dashboardSummaryLoading, setDashboardSummaryLoading] = useState(false);
  const [hasLoadedDashboardSummary, setHasLoadedDashboardSummary] = useState(false);
  const [dashboardSummaryError, setDashboardSummaryError] = useState<string | undefined>();
  const [status3Groups, setStatus3Groups] = useState<StatusSummaryTableGroup[]>([]);
  const [analyticsDelaySummary, setAnalyticsDelaySummary] = useState<DelayStatusSummary>();
  const [analyticsPreBidRows, setAnalyticsPreBidRows] = useState<PreBidMeetingRow[]>([]);
  const [suspectedAnomalyRows, setSuspectedAnomalyRows] = useState<SuspectedAnomalyRow[]>([]);
  const [suspectedAnomalyLoading, setSuspectedAnomalyLoading] = useState(false);
  const [suspectedAnomalyError, setSuspectedAnomalyError] = useState<string | undefined>();
  const [anomalyAcceptances, setAnomalyAcceptances] = useState<AnomalyAcceptanceRow[]>([]);
  const [anomalyRules, setAnomalyRules] = useState<AnomalyRuleRow[]>([]);
  const [anomalyRuleFields, setAnomalyRuleFields] = useState<AnomalyRuleField[]>([]);
  const [anomalyAdminLoading, setAnomalyAdminLoading] = useState(false);
  const [anomalyAdminError, setAnomalyAdminError] = useState<string | undefined>();
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
  const visibleFileCategoryKeys = useMemo(
    () => getVisibleFileCategoryKeys(activeUser?.allowedFileCategories),
    [activeUser?.allowedFileCategories],
  );
  const visibleFileCategoryOptions = useMemo(
    () => getVisibleFileCategoryOptions(activeUser?.allowedFileCategories),
    [activeUser?.allowedFileCategories],
  );
  useEffect(() => {
    setSelectedFileCategories((current) => {
      const visible = new Set(visibleFileCategoryKeys);
      const next = current.filter((key) => visible.has(key));
      return next.length ? next : visibleFileCategoryKeys;
    });
  }, [visibleFileCategoryKeys]);
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
  const categoryFilteredDashboardFiles = useMemo(
    () => filterFilesByCategory(dashboardFiles, selectedFileCategories),
    [dashboardFiles, selectedFileCategories],
  );
  const activeDashboardStatusFiles = useMemo(
    () => categoryFilteredDashboardFiles.filter((file) => !isCancelledFile(file)),
    [categoryFilteredDashboardFiles],
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
        ? activeDashboardStatusFiles
        : filterFilesByCategory(
            files.filter((file) => file.division === activeAnalyticsDivision),
            selectedFileCategories,
          ).filter((file) => !isCancelledFile(file)),
    [activeAnalyticsDivision, activeDashboardStatusFiles, files, selectedFileCategories],
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
    params.set("fileCategories", serializeFileCategories(selectedFileCategories));
    if (selectedLiveMilestones) {
      params.set("liveMilestones", selectedLiveMilestones.join(","));
    }
    return params.toString();
  }, [
    activeDivision,
    activeAnalyticsDivision,
    selectedFileCategories,
    selectedLiveMilestones,
    settings.selectedYear,
  ]);
  const dashboardSummary =
    dashboardSummaryState?.query === dashboardSummaryQuery
      ? dashboardSummaryState.summary
      : undefined;
  const status3Query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("division", activeDivision);
    params.set("selectedYear", settings.selectedYear);
    params.set("fileCategories", serializeFileCategories(selectedFileCategories));
    params.set("delayDays", "5");
    params.set("expectedCashOutgoDays", "10");
    params.set("delayMilestone", "all");
    return params.toString();
  }, [activeDivision, selectedFileCategories, settings.selectedYear]);
  const analyticsDelayQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("division", activeAnalyticsDivision);
    params.set("selectedYear", settings.selectedYear);
    params.set("fileCategories", serializeFileCategories(selectedFileCategories));
    params.set("delayDays", analyticsDelayDays || "0");
    params.set("expectedCashOutgoDays", "0");
    params.set("delayMilestone", analyticsDelayMilestoneKey);
    return params.toString();
  }, [
    activeAnalyticsDivision,
    analyticsDelayDays,
    analyticsDelayMilestoneKey,
    selectedFileCategories,
    settings.selectedYear,
  ]);
  const suspectedAnomalyQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("division", activeDivision);
    params.set("analyticsDivision", activeAnalyticsDivision);
    params.set("selectedYear", settings.selectedYear);
    params.set("fileCategories", serializeFileCategories(selectedFileCategories));
    return params.toString();
  }, [activeAnalyticsDivision, activeDivision, selectedFileCategories, settings.selectedYear]);
  useEffect(() => {
    const controller = new AbortController();
    const delay = hasLoadedDashboardSummaryRef.current ? 180 : 0;
    const timeoutId = window.setTimeout(() => {
      setDashboardSummaryLoading(true);
      setDashboardSummaryError(undefined);

      fetchDashboardSummary(dashboardSummaryQuery, controller.signal)
        .then((payload) => {
          setDashboardSummaryState({ query: dashboardSummaryQuery, summary: payload.summary });
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
    const controller = new AbortController();
    fetchMonthWiseDeliverySchedule(dashboardSummaryQuery, controller.signal)
      .then((payload) => {
        setMonthWiseDeliveryScheduleState({ query: dashboardSummaryQuery, rows: payload.rows });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error(error);
      });

    return () => controller.abort();
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

  useEffect(() => {
    if (activeDashboardTab !== "analytics" || activeAnalyticsPanel !== "delayStatus") return;
    const controller = new AbortController();
    fetchDashboardStatusSummary(analyticsDelayQuery, controller.signal)
      .then((payload) => setAnalyticsDelaySummary(payload.summary.delaySummary))
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setAnalyticsDelaySummary(undefined);
      });

    return () => controller.abort();
  }, [activeAnalyticsPanel, activeDashboardTab, analyticsDelayQuery]);

  useEffect(() => {
    if (activeDashboardTab !== "analytics" || activeAnalyticsPanel !== "preBidMeetings") return;
    const controller = new AbortController();
    fetchDashboardStatusSummary(analyticsDelayQuery, controller.signal)
      .then((payload) => setAnalyticsPreBidRows(payload.summary.preBidMeetingRows ?? []))
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setAnalyticsPreBidRows([]);
      });

    return () => controller.abort();
  }, [activeAnalyticsPanel, activeDashboardTab, analyticsDelayQuery]);

  useEffect(() => {
    if (activeDashboardTab !== "analytics" || activeAnalyticsPanel !== "suspectedAnomaly") return;
    const controller = new AbortController();
    setSuspectedAnomalyLoading(true);
    setSuspectedAnomalyError(undefined);
    fetchSuspectedAnomalies(suspectedAnomalyQuery, controller.signal)
      .then((payload) => setSuspectedAnomalyRows(payload.rows))
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setSuspectedAnomalyError(
          error instanceof Error ? error.message : "Suspected anomaly request failed.",
        );
        setSuspectedAnomalyRows([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSuspectedAnomalyLoading(false);
      });

    return () => controller.abort();
  }, [activeAnalyticsPanel, activeDashboardTab, suspectedAnomalyQuery]);

  useEffect(() => {
    if (activeDashboardTab !== "analytics" || activeAnalyticsPanel !== "suspectedAnomaly") return;
    let cancelled = false;
    setAnomalyAdminLoading(true);
    setAnomalyAdminError(undefined);
    Promise.all([store.listSuspectedAnomalyAcceptances(), store.listAnomalyRules()])
      .then(([acceptancePayload, rulePayload]) => {
        if (cancelled) return;
        setAnomalyAcceptances(acceptancePayload.acceptances);
        setAnomalyRules(rulePayload.rules);
        setAnomalyRuleFields(rulePayload.fields);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setAnomalyAdminError(
          error instanceof Error ? error.message : "Anomaly admin data request failed.",
        );
      })
      .finally(() => {
        if (!cancelled) setAnomalyAdminLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeAnalyticsPanel, activeDashboardTab, suspectedAnomalyRows.length]);

  const needsLocalDashboardFallback = !dashboardSummary;
  const localModeCounts = needsLocalDashboardFallback
    ? getModeCounts(activeDashboardStatusFiles, settings.modes)
    : undefined;
  const localManualMilestoneFlow = needsLocalDashboardFallback
    ? getManualMilestoneFlow(
        activeDashboardStatusFiles,
        getConfiguredMilestones(settings.milestones),
      )
    : undefined;
  const localVisibleLiveMilestoneNames =
    needsLocalDashboardFallback && localManualMilestoneFlow
      ? getVisibleLiveMilestoneNames(selectedLiveMilestones, localManualMilestoneFlow)
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
    ? getMiscellaneousCounts(categoryFilteredDashboardFiles)
    : undefined;
  const localAnalytics = needsLocalDashboardFallback
    ? getAnalyticsSummary(
        activeDashboardStatusFiles,
        dashboardDivisions,
        settings.valueThresholdLevels,
      )
    : undefined;
  const localDivisionFilteredAnalytics = needsLocalDashboardFallback
    ? getAnalyticsSummary(
        filteredAnalyticsFiles,
        filteredAnalyticsDivisions,
        settings.valueThresholdLevels,
      )
    : undefined;
  const localMonthWiseDeliveryScheduleRows = useMemo(
    () => getMonthWiseDeliverySchedule(filteredAnalyticsFiles),
    [filteredAnalyticsFiles],
  );
  const localFinanceYear = getFinancialYearDateRange(settings.selectedYear)
    ? settings.selectedYear
    : settings.financialYear;
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
        bookedCapital: activeDashboardStatusFiles.reduce(
          (sum, file) =>
            sum +
            (isCancelledFile(file)
              ? 0
              : hasFilledField(file, "imms") && getFileCommittedCapitalValue(file) <= 0
                ? (getInrAmount(file.valueCapital, file) ?? 0)
                : 0),
          0,
        ),
        bookedRevenue: activeDashboardStatusFiles.reduce(
          (sum, file) =>
            sum +
            (isCancelledFile(file)
              ? 0
              : hasFilledField(file, "imms") && getFileCommittedRevenueValue(file) <= 0
                ? (getInrAmount(file.valueRevenue, file) ?? 0)
                : 0),
          0,
        ),
        projectedCapital: activeDashboardStatusFiles.reduce(
          (sum, file) =>
            sum +
            (!isCancelledFile(file) && !hasFilledField(file, "imms")
              ? (getInrAmount(file.valueCapital, file) ?? 0)
              : 0),
          0,
        ),
        projectedRevenue: activeDashboardStatusFiles.reduce(
          (sum, file) =>
            sum +
            (!isCancelledFile(file) && !hasFilledField(file, "imms")
              ? (getInrAmount(file.valueRevenue, file) ?? 0)
              : 0),
          0,
        ),
        spentCapital: activeDashboardStatusFiles.reduce(
          (sum, file) => sum + (isSoCancelledFile(file) ? 0 : getFileCommittedCapitalValue(file)),
          0,
        ),
        spentRevenue: activeDashboardStatusFiles.reduce(
          (sum, file) => sum + (isSoCancelledFile(file) ? 0 : getFileCommittedRevenueValue(file)),
          0,
        ),
        paidCapital: effectivePaymentEntries(activeDashboardStatusFiles).reduce(
          (sum, { file, order }) =>
            sum +
            (isSupplyOrderCancelled(file, order)
              ? 0
              : getFinancialYearForDate(order.paymentDate) === localFinanceYear
                ? (getInrAmount(order.actualPaymentCapital, file) ?? 0)
                : 0),
          0,
        ),
        paidRevenue: effectivePaymentEntries(activeDashboardStatusFiles).reduce(
          (sum, { file, order }) =>
            sum +
            (isSupplyOrderCancelled(file, order)
              ? 0
              : getFinancialYearForDate(order.paymentDate) === localFinanceYear
                ? (getInrAmount(order.actualPaymentRevenue, file) ?? 0)
                : 0),
          0,
        ),
        sameYearPaidCapital: effectivePaymentEntries(activeDashboardStatusFiles).reduce(
          (sum, { file, order }) =>
            sum +
            (isSupplyOrderCancelled(file, order)
              ? 0
              : getFinancialYearForDate(order.soDate) === localFinanceYear &&
                  getFinancialYearForDate(order.paymentDate) === localFinanceYear
                ? (getInrAmount(order.actualPaymentCapital, file) ?? 0)
                : 0),
          0,
        ),
        sameYearPaidRevenue: effectivePaymentEntries(activeDashboardStatusFiles).reduce(
          (sum, { file, order }) =>
            sum +
            (isSupplyOrderCancelled(file, order)
              ? 0
              : getFinancialYearForDate(order.soDate) === localFinanceYear &&
                  getFinancialYearForDate(order.paymentDate) === localFinanceYear
                ? (getInrAmount(order.actualPaymentRevenue, file) ?? 0)
                : 0),
          0,
        ),
        advanceCapital: advancePaymentEntries(activeDashboardStatusFiles).reduce(
          (sum, { file, order }) =>
            sum +
            (isSupplyOrderCancelled(file, order)
              ? 0
              : (getInrAmount(getAdvancePaymentCapital(order), file) ?? 0)),
          0,
        ),
        advanceRevenue: advancePaymentEntries(activeDashboardStatusFiles).reduce(
          (sum, { file, order }) =>
            sum +
            (isSupplyOrderCancelled(file, order)
              ? 0
              : (getInrAmount(getAdvancePaymentRevenue(order), file) ?? 0)),
          0,
        ),
      }
    : undefined;
  const dashboardFileCount =
    dashboardSummary?.dashboardFileCount ?? activeDashboardStatusFiles.length;
  const dashboardDivisionsForView = dashboardSummary?.dashboardDivisions ?? dashboardDivisions;
  const modeCounts = dashboardSummary?.modeCounts ?? localModeCounts ?? [];
  const gemBiddingModeCounts =
    dashboardSummary?.gemBiddingModeCounts ??
    (needsLocalDashboardFallback ? getGemBiddingModeCounts(activeDashboardStatusFiles) : []);
  const topSummaryStats =
    dashboardSummary?.topSummaryStats ??
    (needsLocalDashboardFallback ? getAttributeSummaryStats(activeDashboardStatusFiles) : []);
  const firmTypeStats =
    dashboardSummary?.firmTypeStats ??
    (needsLocalDashboardFallback
      ? getFirmTypeSummaryStats(activeDashboardStatusFiles, settings.firmTypes)
      : null);
  const fileTypeStats =
    dashboardSummary?.fileTypeStats ??
    (needsLocalDashboardFallback
      ? getFileTypeSummaryStats(activeDashboardStatusFiles, settings.fileTypes)
      : null);
  const manualMilestoneFlow =
    dashboardSummary?.manualMilestoneFlow ?? localManualMilestoneFlow ?? [];
  const visibleLiveMilestoneNames =
    selectedLiveMilestones && manualMilestoneFlow
      ? getVisibleLiveMilestoneNames(selectedLiveMilestones, manualMilestoneFlow)
      : getVisibleLiveMilestoneNames(
          dashboardSummary?.visibleLiveMilestoneNames ?? localVisibleLiveMilestoneNames,
          manualMilestoneFlow,
        );
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
      shortclosedSo: 0,
      multipleSupplyOrders: 0,
    };
  const analytics = dashboardSummary?.analytics ??
    localAnalytics ?? {
      divisionFileRanking: [],
      divisionValueRanking: [],
      divisionTurnaroundRanking: [],
      topFirmSupplyOrders: [],
      firmAnalysis: [],
      topIndentorsByFiles: [],
      topIndentorsByValue: [],
      milestoneClearingRanking: [],
      monthlyFileInflow: [],
      monthWiseSupplyOrder: [],
      monthWiseDeliverySchedule: [],
      monthWiseCompletedDeliveries: [],
      monthWiseBgExpiry: [],
      biddingModeMix: [],
      fileValueThresholds: [],
      divisionRiskRanking: [],
      divisionPaymentPendingRanking: [],
    };
  const divisionFilteredAnalytics =
    dashboardSummary?.divisionFilteredAnalytics ?? localDivisionFilteredAnalytics ?? analytics;
  const assignedDivisionNames = getAssignedDivisionNames(activeUser?.divisionIds, divisions);
  const financeTotalDefaults = {
    allocatedCapital: 0,
    allocatedRevenue: 0,
    bookedCapital: 0,
    bookedRevenue: 0,
    projectedCapital: 0,
    projectedRevenue: 0,
    spentCapital: 0,
    spentRevenue: 0,
    paidCapital: 0,
    paidRevenue: 0,
    sameYearPaidCapital: 0,
    sameYearPaidRevenue: 0,
    advanceCapital: 0,
    advanceRevenue: 0,
    carryForward: { count: 0, capital: 0, revenue: 0, total: 0 },
    clearedCarryForward: { count: 0, capital: 0, revenue: 0, total: 0 },
    previousCarryForward: { count: 0, capital: 0, revenue: 0, total: 0 },
    futureClearedCarryForward: { count: 0, capital: 0, revenue: 0, total: 0 },
    carryForwardBreakup: [],
    clearedCarryForwardBreakup: [],
    previousCarryForwardBreakup: [],
    futureClearedCarryForwardBreakup: [],
  };
  const financeTotals = {
    ...financeTotalDefaults,
    ...(dashboardSummary?.financeTotals ?? localFinanceTotals),
  };
  const selectedFinanceYear = getFinancialYearDateRange(settings.selectedYear)
    ? settings.selectedYear
    : settings.financialYear;
  const selectedFinanceYearLabel = selectedFinanceYear || "selected FY";
  const financeFirmTypeDistributions = dashboardSummary?.financeFirmTypeDistributions ?? {
    supplyOrderValue: getSupplyOrderValueDistributionByFirmType(
      activeDashboardStatusFiles,
      settings.firmTypes,
    ),
    actualPayment: getActualPaymentDistributionByFirmType(
      activeDashboardStatusFiles,
      settings.firmTypes,
    ),
  };
  const financeFirmTypeDistributionRows =
    financeFirmTypeDistributions[financeFirmTypeDistributionKey] ?? [];
  const selectedFinanceFirmTypeDistributionLabel =
    financeFirmTypeDistributionOptions.find(
      (option) => option.key === financeFirmTypeDistributionKey,
    )?.label ?? "Firm type distribution";
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
  const capitalSameYearPaidPercent = getPercent(
    financeTotals.sameYearPaidCapital ?? 0,
    financeTotals.spentCapital,
  );
  const revenueSameYearPaidPercent = getPercent(
    financeTotals.sameYearPaidRevenue ?? 0,
    financeTotals.spentRevenue,
  );
  const biddingTypeSummaryStat: SummaryStat = {
    label: "Bidding Mode",
    value: modeCounts.map((mode) => ({
      label: mode.name,
      value: mode.count,
      searchFilter: `mode:${mode.name}`,
    })),
    hint: "Files grouped by bidding mode",
  };
  const gemBiddingModeSummaryStat: SummaryStat = {
    label: "GeM bidding mode",
    value: gemBiddingModeCounts.map((mode) => ({
      label: mode.name,
      value: mode.count,
      searchFilter: `gemBiddingMode:${encodeURIComponent(mode.name)}`,
    })),
    hint: "GeM files grouped by bidding mode",
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
    {
      label: "Paid",
      value: {
        capital: `${formatCurrency(financeTotals.sameYearPaidCapital ?? 0)} (${formatPercent(capitalSameYearPaidPercent)})`,
        revenue: `${formatCurrency(financeTotals.sameYearPaidRevenue ?? 0)} (${formatPercent(revenueSameYearPaidPercent)})`,
      },
      hint: `Payment made in ${selectedFinanceYearLabel} only against S.O.s placed in ${selectedFinanceYearLabel}. Percent is against committed S.O. value shown for this selected FY view.`,
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
    {
      category: `Payment in ${selectedFinanceYearLabel}`,
      capital: formatCurrency(financeTotals.paidCapital),
      revenue: formatCurrency(financeTotals.paidRevenue),
      notes: `Actual payment amount with Payment Date in ${selectedFinanceYearLabel}.`,
    },
    {
      category: "Paid",
      capital: formatCurrency(financeTotals.sameYearPaidCapital ?? 0),
      revenue: formatCurrency(financeTotals.sameYearPaidRevenue ?? 0),
      notes: `Payment made in ${selectedFinanceYearLabel} against S.O.s placed in ${selectedFinanceYearLabel}.`,
    },
    {
      category: "Advance Payment",
      capital: formatCurrency(financeTotals.advanceCapital),
      revenue: formatCurrency(financeTotals.advanceRevenue),
      notes: "Actual advance amount where entered, otherwise planned advance amount.",
    },
    {
      category: `Carry Forward from previous FYs as on ${selectedFinanceYearLabel} end`,
      capital: formatCurrency(financeTotals.previousCarryForward?.capital ?? 0),
      revenue: formatCurrency(financeTotals.previousCarryForward?.revenue ?? 0),
      notes: `${financeTotals.previousCarryForward?.count ?? 0} older carry-forward rows still unpaid at ${selectedFinanceYearLabel} end.`,
    },
    {
      category: `Cleared Carry Forward in ${selectedFinanceYearLabel}`,
      capital: formatCurrency(financeTotals.clearedCarryForward?.capital ?? 0),
      revenue: formatCurrency(financeTotals.clearedCarryForward?.revenue ?? 0),
      notes: `${financeTotals.clearedCarryForward?.count ?? 0} previous-year carry-forward rows paid in ${selectedFinanceYearLabel}.`,
    },
    {
      category: `Carry Forward of ${selectedFinanceYearLabel}`,
      capital: formatCurrency(financeTotals.carryForward?.capital ?? 0),
      revenue: formatCurrency(financeTotals.carryForward?.revenue ?? 0),
      notes: `${financeTotals.carryForward?.count ?? 0} payment rows from S.O. placed in ${selectedFinanceYearLabel} and unpaid by FY end.`,
    },
    {
      category: `Carry Forward of ${selectedFinanceYearLabel} cleared later`,
      capital: formatCurrency(financeTotals.futureClearedCarryForward?.capital ?? 0),
      revenue: formatCurrency(financeTotals.futureClearedCarryForward?.revenue ?? 0),
      notes: `${financeTotals.futureClearedCarryForward?.count ?? 0} ${selectedFinanceYearLabel} carry-forward rows paid in later FYs.`,
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
  const firmAnalysisRows = divisionFilteredAnalytics.firmAnalysis ?? [];
  const selectedFirmAnalysisRow =
    firmAnalysisRows.find((row) => row.name === selectedFirmAnalysisFirm) ?? firmAnalysisRows[0];
  useEffect(() => {
    if (!selectedFirmAnalysisRow) {
      if (selectedFirmAnalysisFirm) setSelectedFirmAnalysisFirm("");
      return;
    }
    if (!selectedFirmAnalysisFirm || !firmAnalysisRows.some((row) => row.name === selectedFirmAnalysisFirm)) {
      setSelectedFirmAnalysisFirm(String(selectedFirmAnalysisRow.name));
    }
  }, [firmAnalysisRows, selectedFirmAnalysisFirm, selectedFirmAnalysisRow]);
  const selectedFirmAnalysisDisplayRows = selectedFirmAnalysisRow
    ? [
        {
          ...selectedFirmAnalysisRow,
          selectedRoles: getFirmAnalysisSelectedRoleCount(
            selectedFirmAnalysisRow,
            selectedFirmAnalysisRoles,
            firmAnalysisOperators,
            negatedFirmAnalysisRoles,
          ),
          selectedRolesExpression: getFirmAnalysisExpression(
            selectedFirmAnalysisRoles,
            firmAnalysisOperators,
            negatedFirmAnalysisRoles,
          ),
          selectedRolesLabel: getFirmAnalysisExpressionLabel(
            selectedFirmAnalysisRoles,
            firmAnalysisOperators,
            negatedFirmAnalysisRoles,
          ),
        },
      ]
    : [];
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
  const monthWiseDeliveryScheduleRows =
    monthWiseDeliveryScheduleState?.query === dashboardSummaryQuery
      ? monthWiseDeliveryScheduleState.rows
      : divisionFilteredAnalytics.monthWiseDeliverySchedule?.length
        ? divisionFilteredAnalytics.monthWiseDeliverySchedule
        : localMonthWiseDeliveryScheduleRows;
  const activeTcecStatus =
    tcecStatusStage === "pre"
      ? divisionFilteredAnalytics.tcecStatus.pre
      : divisionFilteredAnalytics.tcecStatus.post;
  const preBidFyRows = getFiscalYearSummaryRows(analyticsPreBidRows, "monthKey", [
    "count",
    "preBidDue",
    "preBidCompleted",
    "refloatPreBidDue",
    "refloatPreBidCompleted",
  ]);
  const displayedPreBidRows = selectedPreBidFiscalYear
    ? analyticsPreBidRows
        .filter((row) => getFiscalYearForMonthKey(row.monthKey) === selectedPreBidFiscalYear)
        .map((row) => ({ ...row, name: row.monthKey }))
    : preBidFyRows;
  const tcecFyRows = getFiscalYearSummaryRows(activeTcecStatus.meetings, "meetingDate", [
    "reviewed",
    "signed",
    "pending",
  ]).map((row) => ({ ...row, stage: tcecStatusStage }));
  const activeTcecCommitteeRows = selectedTcecFiscalYear
    ? getTcecCommitteeRowsForFiscalYear(activeTcecStatus.meetings, selectedTcecFiscalYear)
    : activeTcecStatus.committees;
  const selectedTcecCommitteeExists = activeTcecCommitteeRows.some(
    (row) => row.name === selectedTcecCommittee,
  );
  const activeTcecCommittee = selectedTcecCommitteeExists ? selectedTcecCommittee : "";
  const selectedTcecMeetingRows = activeTcecCommittee
    ? activeTcecStatus.meetings.filter((row) => row.committee === activeTcecCommittee)
        .filter(
          (row) =>
            !selectedTcecFiscalYear ||
            getFinancialYearForDate(row.meetingDate) === selectedTcecFiscalYear,
        )
    : [];
  const displayedTcecRows = selectedTcecFiscalYear ? activeTcecCommitteeRows : tcecFyRows;
  const cncFyRows = getFiscalYearSummaryRows(divisionFilteredAnalytics.cncSummary, "cncDate", [
    "reviewed",
    "approved",
    "financialSanctionSigned",
    "supplyOrderPlaced",
    "approvalPending",
    "financialSanctionPending",
    "supplyOrderPending",
  ]);
  const displayedCncRows = selectedCncFiscalYear
    ? divisionFilteredAnalytics.cncSummary.filter(
        (row) => getFinancialYearForDate(String(row.cncDate ?? "")) === selectedCncFiscalYear,
      )
    : cncFyRows;
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
      subtitle: "Average days from Demand received date to first S.O.",
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
      key: "firmAnalysis",
      title: "Firm Analysis",
      subtitle: selectedFirmAnalysisRow
        ? `BQ, invited, tender participation, and order conversion for ${selectedFirmAnalysisRow.name}`
        : "Select a firm to see BQ, invitation, tender participation, and order conversion.",
      columns: getFirmAnalysisColumns(),
      rows: selectedFirmAnalysisDisplayRows,
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
      key: "preBidMeetings",
      title: "Pre-Bid Meetings",
      subtitle: selectedPreBidFiscalYear
        ? `Month-wise Pre-Bid Meeting schedule for FY ${selectedPreBidFiscalYear}`
        : "FY-wise Pre-Bid Meeting schedule",
      columns: selectedPreBidFiscalYear
        ? getPreBidMeetingAnalyticsColumns()
        : getFiscalPreBidMeetingAnalyticsColumns(setSelectedPreBidFiscalYear),
      rows: displayedPreBidRows,
    },
    {
      key: "tcecStatus",
      title: "TCEC summary",
      subtitle:
        selectedTcecFiscalYear
          ? tcecStatusStage === "pre"
            ? `Pre-TCEC committee-wise status for FY ${selectedTcecFiscalYear}`
            : `Post-TCEC committee-wise status for FY ${selectedTcecFiscalYear}`
          : tcecStatusStage === "pre"
            ? "Pre-TCEC FY-wise review and minutes status"
            : "Post-TCEC FY-wise review and minutes status",
      columns: selectedTcecFiscalYear
        ? getTcecStatusColumns(tcecStatusStage, setSelectedTcecCommittee)
        : getFiscalTcecStatusColumns(tcecStatusStage, setSelectedTcecFiscalYear),
      rows: displayedTcecRows,
    },
    {
      key: "cncSummary",
      title: "CNC summary",
      subtitle: selectedCncFiscalYear
        ? `CNC date-wise review, approval, financial sanction, and S.O. status for FY ${selectedCncFiscalYear}`
        : "FY-wise CNC review, approval, financial sanction, and S.O. status",
      columns: selectedCncFiscalYear
        ? getCncSummaryColumns()
        : getFiscalCncSummaryColumns(setSelectedCncFiscalYear),
      rows: displayedCncRows,
    },
    {
      key: "suspectedAnomaly",
      title: "Suspected anomaly",
      subtitle: suspectedAnomalyError
        ? `Anomaly check unavailable: ${suspectedAnomalyError}`
        : suspectedAnomalyLoading
          ? "Checking suspected data issues..."
          : `${suspectedAnomalyRows.length} active suspected data issue${
              suspectedAnomalyRows.length === 1 ? "" : "s"
            } found.`,
      columns: getSuspectedAnomalyColumns(
        acceptSuspectedAnomaly,
        hasAnomalyAdminAccess(activeUser?.role) ? reviewSuspectedAnomaly : undefined,
      ),
      rows: suspectedAnomalyRows.map((row) => ({ ...row, name: row.fileRef })),
    },
    {
      key: "delayStatus",
      title: "Delay status",
      subtitle: `Files stuck for more than ${Number.parseInt(analyticsDelayDays, 10) || 0} days. Average ${analyticsDelaySummary?.averageDays ?? 0} days; longest ${analyticsDelaySummary?.longestDays ?? 0} days.`,
      columns: getCountAnalyticsColumns("Milestone"),
      rows: (analyticsDelaySummary?.byMilestone ?? []).map((row) => ({
        ...row,
        name: row.label,
      })),
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
  const toggleFirmAnalysisRole = (role: FirmAnalysisRoleKey, checked: boolean) => {
    setSelectedFirmAnalysisRoles((current) => {
      const next = checked
        ? Array.from(new Set([...current, role]))
        : current.filter((item) => item !== role);
      return next.length ? next : current;
    });
  };

  const openSearchFilter = (dashboardFilter: string) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter,
        selectedYear: settings.selectedYear,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: serializeFileCategories(selectedFileCategories),
      },
    });
  };
  const openLiveStatusFilter = (division: string, milestoneName: string) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `manualMilestoneCurrent:${milestoneName}`,
        division,
        fileCategories: serializeFileCategories(selectedFileCategories),
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
        fileCategories: serializeFileCategories(selectedFileCategories),
        analyticsType: analyticsTransferType,
        analyticsNames: JSON.stringify(
          displayedAnalyticsPanel.rows
            .map((row) => ("name" in row ? row.name : undefined))
            .filter(
              (name): name is number | string =>
                typeof name === "number" || typeof name === "string",
            )
            .map((name) => String(name)),
        ),
      },
    });
  };
  const openAnalyticsSearchTarget = (target: AnalyticsSearchTarget) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter: target.dashboardFilter,
        division:
          target.division ??
          (activeAnalyticsDivision === "all" ? undefined : activeAnalyticsDivision),
        fileCategories: serializeFileCategories(selectedFileCategories),
        analyticsType: target.analyticsType,
        analyticsNames: target.analyticsNames?.length
          ? JSON.stringify(target.analyticsNames)
          : undefined,
        focusSection: target.focusSection,
        focusMilestone: target.focusMilestone,
        focusTarget: target.focusTarget,
      },
    });
  };
  const getAnalyticsCellSearchTarget = (
    row: Record<string, number | string>,
    column: AnalyticsTableColumn,
  ): AnalyticsSearchTarget | undefined => {
    if (displayedAnalyticsPanel.key === "delayStatus" && column.key === "count") {
      const milestoneKey = String(row.key ?? "all");
      return {
        dashboardFilter: `delayStatus:${Number.parseInt(analyticsDelayDays, 10) || 0}:${
          milestoneKey || "all"
        }`,
      };
    }
    return getAnalyticsSearchTarget(displayedAnalyticsPanel.key, row, column.key);
  };
  async function acceptSuspectedAnomaly(row: Record<string, number | string>) {
    const signature = String(row.signature ?? "");
    if (!signature) return;
    const reason = window.prompt("Message/reason to Admin for accepting this anomaly:");
    if (!reason?.trim()) return;
    try {
      await store.acceptSuspectedAnomaly(signature, reason.trim());
      const [acceptancePayload, rulePayload, anomalyPayload] = await Promise.all([
        store.listSuspectedAnomalyAcceptances(),
        store.listAnomalyRules(),
        fetchSuspectedAnomalies(suspectedAnomalyQuery, new AbortController().signal),
      ]);
      setAnomalyAcceptances(acceptancePayload.acceptances);
      setAnomalyRules(rulePayload.rules);
      setAnomalyRuleFields(rulePayload.fields);
      setSuspectedAnomalyRows(anomalyPayload.rows);
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : "Could not request anomaly acceptance.");
    }
  }
  async function reviewSuspectedAnomaly(signature: string, action: string) {
    const adminMessage =
      action === "reject"
        ? window.prompt("Correction message to User explaining what should be fixed:")
        : undefined;
    if (action === "reject" && !adminMessage?.trim()) return;
    try {
      await store.reviewSuspectedAnomaly(signature, action, adminMessage?.trim());
      const [acceptancePayload, anomalyPayload] = await Promise.all([
        store.listSuspectedAnomalyAcceptances(),
        fetchSuspectedAnomalies(suspectedAnomalyQuery, new AbortController().signal),
      ]);
      setAnomalyAcceptances(acceptancePayload.acceptances);
      setSuspectedAnomalyRows(anomalyPayload.rows);
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : "Could not review anomaly.");
    }
  }
  async function clearSelectedSuspectedAnomalies(signatures: string[]) {
    if (!signatures.length) return;
    const password = window.prompt("Enter your account password to clear selected anomalies:");
    if (!password?.trim()) return;
    try {
      await store.clearSuspectedAnomalyHistory(password.trim(), signatures);
      const acceptancePayload = await store.listSuspectedAnomalyAcceptances();
      setAnomalyAcceptances(acceptancePayload.acceptances);
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : "Could not clear anomaly history.");
    }
  }
  async function toggleAnomalyRule(rule: AnomalyRuleRow) {
    try {
      await store.updateAnomalyRule(rule.id, { enabled: !rule.enabled });
      const payload = await store.listAnomalyRules();
      setAnomalyRules(payload.rules);
      setAnomalyRuleFields(payload.fields);
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : "Could not update anomaly rule.");
    }
  }
  async function createAnomalyRuleFromPrompt() {
    const name = window.prompt("Rule name:");
    if (!name?.trim()) return;
    const fieldA = window.prompt(
      `Field A key:\n${anomalyRuleFields.map((field) => `${field.key} - ${field.label}`).join("\n")}`,
    );
    if (!fieldA?.trim()) return;
    const ruleType = window.prompt("Rule type: date_order, required_field, delay_days", "date_order");
    if (!ruleType?.trim()) return;
    const fieldB = window.prompt("Field B key:");
    if (!fieldB?.trim()) return;
    const operator =
      ruleType === "required_field"
        ? "requires"
        : window.prompt("Operator: not_before or not_after", "not_before");
    if (!operator?.trim()) return;
    const thresholdDays =
      ruleType === "delay_days"
        ? Number.parseInt(window.prompt("Threshold days:", "0") ?? "", 10)
        : undefined;
    try {
      await store.createAnomalyRule({
        name: name.trim(),
        ruleType: ruleType.trim(),
        fieldA: fieldA.trim(),
        operator: operator.trim(),
        fieldB: fieldB.trim(),
        thresholdDays,
        severity: "Medium",
        scope: "all",
        enabled: true,
      });
      const [rulePayload, anomalyPayload] = await Promise.all([
        store.listAnomalyRules(),
        fetchSuspectedAnomalies(suspectedAnomalyQuery, new AbortController().signal),
      ]);
      setAnomalyRules(rulePayload.rules);
      setAnomalyRuleFields(rulePayload.fields);
      setSuspectedAnomalyRows(anomalyPayload.rows);
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : "Could not create anomaly rule.");
    }
  }
  const toggleFileCategory = (category: FileCategoryKey, checked: boolean) => {
    setSelectedFileCategories((current) =>
      checked
        ? visibleFileCategoryKeys.filter((key) => new Set([...current, category]).has(key))
        : current.filter((key) => key !== category),
    );
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
        fileCategories: selectedFileCategories,
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
              data-testid={`dashboard-tab-${tab.key}`}
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
        <FileCategoryFilter
          selectedCategories={selectedFileCategories}
          options={visibleFileCategoryOptions}
          onChange={toggleFileCategory}
        />
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
              <SummaryMetric
                {...gemBiddingModeSummaryStat}
                onSubMetricClick={(dashboardFilter) => openSearchFilter(dashboardFilter)}
              />
              {fileTypeStats ? (
                <SummaryMetric
                  {...fileTypeStats}
                  onSubMetricClick={(dashboardFilter) => openSearchFilter(dashboardFilter)}
                />
              ) : null}
              {firmTypeStats ? (
                <SummaryMetric
                  {...firmTypeStats}
                  onSubMetricClick={(dashboardFilter) => openSearchFilter(dashboardFilter)}
                />
              ) : null}
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

                if ("jobLive" in milestone && !("due" in milestone)) {
                  return (
                    <JobCompletionFlowNode
                      key={milestone.key}
                      milestone={milestone}
                      index={index}
	                      isLast={false}
	                      onJobCompletedClick={() => handleStatusFilter("jobCompletionCompleted")}
	                      onJobDueClick={() => handleStatusFilter("jobCompletionDue")}
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

                if ("irPreparationPending" in milestone) {
                  return (
                    <StatusFlowNode
                      key={milestone.key}
                      index={index}
                      title={milestone.label}
                      isLast={false}
                      items={[
                        {
                          label: "IR Preparation Pending",
                          count: milestone.irPreparationPending,
                          onClick: () => handleStatusFilter("irPreparationPending"),
                        },
                        {
                          label: "IR Receipt Pending",
                          count: milestone.irReceiptPending,
                          onClick: () => handleStatusFilter("irReceiptPending"),
                        },
                        {
                          label: "IR Completed",
                          count: milestone.irCompleted,
                          onClick: () => handleStatusFilter("irCompleted"),
                        },
                      ]}
                    />
                  );
                }

                if ("preBidDue" in milestone) {
                  return (
                    <StatusFlowNode
                      key={milestone.key}
                      index={index}
                      title={milestone.label}
                      isLast={false}
                      items={[
                        {
                          label: "Due",
                          count: milestone.preBidDue,
                          onClick: () => handleStatusFilter("preBidMeeting:due"),
                        },
                        {
                          label: "Completed",
                          count: milestone.preBidCompleted,
                          onClick: () => handleStatusFilter("preBidMeeting:completed"),
                        },
                        {
                          label: "Refloat Due",
                          count: milestone.refloatPreBidDue,
                          onClick: () => handleStatusFilter("refloatPreBidMeeting:due"),
                        },
                        {
                          label: "Refloat Completed",
                          count: milestone.refloatPreBidCompleted,
                          onClick: () => handleStatusFilter("refloatPreBidMeeting:completed"),
                        },
                      ]}
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
                    onFinancialSanctionPendingClick={() =>
                      handleStatusFilter("manualMilestoneCurrent:Financial Sanction")
                    }
                    onFinancialSanctionCompletedClick={() =>
                      handleStatusFilter("manualMilestoneCompleted:Financial Sanction")
                    }
                    onBgExpiredClick={() =>
                      handleStatusFilter(
                        isBgMilestoneKey(milestone.key)
                          ? `bgExpired:${milestone.key}`
                          : "bgExpired",
                      )
                    }
                    onBgToBeReturnedClick={() =>
                      handleStatusFilter(
                        isBgMilestoneKey(milestone.key)
                          ? `bgToBeReturned:${milestone.key}`
                          : "bgToBeReturned",
                      )
                    }
                    onBgReturnedClick={() =>
                      handleStatusFilter(
                        isBgMilestoneKey(milestone.key)
                          ? `bgReturned:${milestone.key}`
                          : "bgReturned",
                      )
                    }
                    onAdvancePaidClick={() => handleStatusFilter("advancePaid")}
                    onAdvancePendingClick={() => handleStatusFilter("advancePending")}
                  />
                );
              })}
              <StatusFlowNode
                index={statusFlow.length}
                title="Cancellation"
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
                    label: "Shortclosed S.O.",
                    count: miscellaneousCounts.shortclosedSo,
                    onClick: () => handleStatusFilter("miscShortclosedSo"),
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
                {displayedAnalyticsPanel.key === "delayStatus" ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex w-24 flex-col gap-1 text-xs text-muted-foreground">
                      <span>Days</span>
                      <input
                        type="number"
                        min="0"
                        value={analyticsDelayDays}
                        onChange={(event) => setAnalyticsDelayDays(event.target.value)}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                      />
                    </label>
                    <label className="flex min-w-44 flex-col gap-1 text-xs text-muted-foreground">
                      <span>Milestone</span>
                      <select
                        value={analyticsDelayMilestoneKey}
                        onChange={(event) => setAnalyticsDelayMilestoneKey(event.target.value)}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                      >
                        <option value="all">All milestones</option>
                        {delayMilestoneOptions.map((milestone) => (
                          <option key={milestone.key} value={milestone.key}>
                            {milestone.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
                {displayedAnalyticsPanel.key === "firmAnalysis" ? (
                  <FirmAnalysisControls
                    firms={firmAnalysisRows.map((row) => String(row.name))}
                    selectedFirm={selectedFirmAnalysisRow?.name ?? ""}
                    operators={firmAnalysisOperators}
                    negatedRoles={negatedFirmAnalysisRoles}
                    selectedRoles={selectedFirmAnalysisRoles}
                    onFirmChange={setSelectedFirmAnalysisFirm}
                    onOperatorChange={(leftRole, rightRole, operator) =>
                      setFirmAnalysisOperators((current) => ({
                        ...current,
                        [firmAnalysisOperatorKey(leftRole, rightRole)]: operator,
                      }))
                    }
                    onToggleNot={(role, checked) =>
                      setNegatedFirmAnalysisRoles((current) =>
                        checked
                          ? Array.from(new Set([...current, role]))
                          : current.filter((item) => item !== role),
                      )
                    }
                    onToggleRole={toggleFirmAnalysisRole}
                  />
                ) : null}
                {displayedAnalyticsPanel.key === "tcecStatus" ? (
                  <TcecStatusControls
                    stage={tcecStatusStage}
                    selectedCommittee={activeTcecCommittee}
                    onStageChange={(stage) => {
                      setTcecStatusStage(stage);
                      setSelectedTcecFiscalYear("");
                      setSelectedTcecCommittee("");
                    }}
                  />
                ) : null}
                {displayedAnalyticsPanel.key === "preBidMeetings" && selectedPreBidFiscalYear ? (
                  <div className="mb-3">
                    <button
                      type="button"
                      onClick={() => setSelectedPreBidFiscalYear("")}
                      className="h-8 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent"
                    >
                      Back to FY summary
                    </button>
                  </div>
                ) : null}
                {displayedAnalyticsPanel.key === "tcecStatus" && selectedTcecFiscalYear ? (
                  <div className="mb-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTcecFiscalYear("");
                        setSelectedTcecCommittee("");
                      }}
                      className="h-8 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent"
                    >
                      Back to FY summary
                    </button>
                    {activeTcecCommittee ? (
                      <button
                        type="button"
                        onClick={() => setSelectedTcecCommittee("")}
                        className="h-8 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent"
                      >
                        Back to committees
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {displayedAnalyticsPanel.key === "cncSummary" && selectedCncFiscalYear ? (
                  <div className="mb-3">
                    <button
                      type="button"
                      onClick={() => setSelectedCncFiscalYear("")}
                      className="h-8 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent"
                    >
                      Back to FY summary
                    </button>
                  </div>
                ) : null}
                {displayedAnalyticsPanel.key === "suspectedAnomaly" ? (
                  <SuspectedAnomalyGroupedView
                    rows={suspectedAnomalyRows}
                    acceptances={anomalyAcceptances}
                    isAdmin={hasAnomalyAdminAccess(activeUser?.role)}
                    onRequest={(row) => void acceptSuspectedAnomaly(row)}
                    onAdminReview={(signature, action) => void reviewSuspectedAnomaly(signature, action)}
                    onClearSelected={(signatures) => void clearSelectedSuspectedAnomalies(signatures)}
                    onOpenRow={(row) => {
                      const target = getAnalyticsSearchTarget("suspectedAnomaly", row, "fileRef");
                      if (target) openAnalyticsSearchTarget(target);
                    }}
                  />
                ) : (
                  <AnalyticsRankingTable
                    columns={displayedAnalyticsPanel.columns}
                    rows={displayedAnalyticsPanel.rows}
                    getCellSearchTarget={getAnalyticsCellSearchTarget}
                    onOpenSearchTarget={openAnalyticsSearchTarget}
                  />
                )}
                {displayedAnalyticsPanel.key === "tcecStatus" && activeTcecCommittee ? (
                  <div className="mt-4 space-y-2">
                    <div>
                      <h3 className="text-sm font-semibold">{activeTcecCommittee} meeting dates</h3>
                      <p className="text-xs text-muted-foreground">
                        {tcecStatusStage === "pre" ? "Pre-TCEC Date" : "Post-TCEC Date"} wise
                        reviewed files and minutes status.
                      </p>
                    </div>
                    <AnalyticsRankingTable
                      columns={getTcecMeetingColumns(tcecStatusStage)}
                      rows={selectedTcecMeetingRows}
                      getCellSearchTarget={(row, column) =>
                        getTcecMeetingSearchTarget(tcecStatusStage, row, column.key)
                      }
                      onOpenSearchTarget={openAnalyticsSearchTarget}
                    />
                  </div>
                ) : null}
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
          <TooltipProvider delayDuration={150}>
          <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-sm font-bold">Finance</h2>
                <p className="text-xs text-muted-foreground">Allocated and booked amounts</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    printFinanceRowsToPdf(
                      financeExportRows,
                      financeExportTitle,
                      financeFirmTypeDistributionRows,
                      selectedFinanceFirmTypeDistributionLabel,
                    )
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent"
                >
                  <FileText className="size-3.5" />
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() =>
                    exportFinanceRowsToExcel(
                      financeExportRows,
                      financeExportTitle,
                      financeFirmTypeDistributionRows,
                      selectedFinanceFirmTypeDistributionLabel,
                    )
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent"
                >
                  <FileSpreadsheet className="size-3.5" />
                  Excel
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-lg border border-border bg-secondary/35 p-4">
                <FinanceSectionTitle
                  title="Allocated"
                  help="Budget allocation for the selected financial year and selected division, split into Capital and Revenue."
                />
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FinanceAmountTile
                    label="Capital"
                    value={financeTotals.allocatedCapital}
                    help="Capital allocation entered in division/year setup for the selected financial year."
                  />
                  <FinanceAmountTile
                    label="Revenue"
                    value={financeTotals.allocatedRevenue}
                    help="Revenue allocation entered in division/year setup for the selected financial year."
                  />
                </div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/35 p-4">
                <FinanceSectionTitle
                  title="Intended"
                  help="Estimated value of live requirements where IMMS/booking is not yet filled. This shows likely future load against allocation."
                />
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FinanceAmountTile
                    label="Capital"
                    value={financeTotals.projectedCapital}
                    help="Capital intended amount from active files that are not booked through IMMS yet."
                  />
                  <FinanceAmountTile
                    label="Revenue"
                    value={financeTotals.projectedRevenue}
                    help="Revenue intended amount from active files that are not booked through IMMS yet."
                  />
                </div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/35 p-4">
                <FinanceSectionTitle
                  title="Booked"
                  help="Amount booked at file level through IMMS where no S.O./committed value has replaced it yet."
                />
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FinanceAmountTile
                    label="Capital"
                    value={financeTotals.bookedCapital}
                    help="Capital booking from IMMS/file value before committed S.O. value is available."
                  />
                  <FinanceAmountTile
                    label="Revenue"
                    value={financeTotals.bookedRevenue}
                    help="Revenue booking from IMMS/file value before committed S.O. value is available."
                  />
                </div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/35 p-4">
                <FinanceSectionTitle
                  title="Committed"
                  help="Committed value from effective supply orders, excluding cancelled S.O. rows."
                />
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FinanceAmountTile
                    label="Capital"
                    value={financeTotals.spentCapital}
                    help="Capital value committed through effective supply orders."
                  />
                  <FinanceAmountTile
                    label="Revenue"
                    value={financeTotals.spentRevenue}
                    help="Revenue value committed through effective supply orders."
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {financePercentStats.map((stat) => (
                <SummaryMetric
                  key={stat.label}
                  {...stat}
                  help={stat.hint}
                  titleClassName={financeBoxTitleClass}
                />
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-border bg-secondary/35 p-4">
              <FinanceSectionTitle
                title={`Payment in ${selectedFinanceYearLabel}`}
                help={`Actual final payment amount where Payment Date falls in ${selectedFinanceYearLabel}, excluding cancelled S.O. rows and advance payment rows.`}
              />
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FinanceAmountTile
                  label="Capital"
                  value={financeTotals.paidCapital}
                  help={`Capital actual payment total from final payment rows paid in ${selectedFinanceYearLabel}.`}
                />
                <FinanceAmountTile
                  label="Revenue"
                  value={financeTotals.paidRevenue}
                  help={`Revenue actual payment total from final payment rows paid in ${selectedFinanceYearLabel}.`}
                />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
                <FinanceCarryForwardPanel
                  title={`Carry Forward from previous FYs`}
                  total={financeTotals.previousCarryForward}
                  rows={financeTotals.previousCarryForwardBreakup}
                  emptyText={`No older unpaid carry-forward rows as on ${selectedFinanceYearLabel} end.`}
                  help={`Payment rows from FYs before ${selectedFinanceYearLabel} that are still unpaid by ${selectedFinanceYearLabel} end. Year buttons open the pending files/S.O.`}
                  onOpenFilter={openSearchFilter}
                />
                <FinanceCarryForwardPanel
                  title={`Cleared Carry Forward in ${selectedFinanceYearLabel}`}
                  total={financeTotals.clearedCarryForward}
                  rows={financeTotals.clearedCarryForwardBreakup}
                  emptyText={`No previous-year carry-forward cleared in ${selectedFinanceYearLabel}.`}
                  help={`Older carry-forward payment rows whose Payment Date falls inside ${selectedFinanceYearLabel}. Year buttons show which previous FY they came from.`}
                  onOpenFilter={openSearchFilter}
                />
                <FinanceCarryForwardPanel
                  title={`Carry Forward of ${selectedFinanceYearLabel}`}
                  total={financeTotals.carryForward}
                  rows={financeTotals.carryForwardBreakup}
                  emptyText={`No ${selectedFinanceYearLabel} payment rows carried forward.`}
                  help={`Payment rows from S.O. placed in ${selectedFinanceYearLabel} where Payment Date is blank or after ${selectedFinanceYearLabel} end. Year buttons open the contributing files/S.O.`}
                  onOpenFilter={openSearchFilter}
                />
                <FinanceCarryForwardPanel
                  title={`${selectedFinanceYearLabel} Carry Forward cleared later`}
                  total={financeTotals.futureClearedCarryForward}
                  rows={financeTotals.futureClearedCarryForwardBreakup}
                  emptyText={`No ${selectedFinanceYearLabel} carry-forward cleared in later FYs.`}
                  help={`Payment rows that became carry-forward at ${selectedFinanceYearLabel} end and were paid in a later FY. Year buttons show the future clearing FY.`}
                  onOpenFilter={openSearchFilter}
                />
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-border bg-secondary/35 p-4">
              <FinanceSectionTitle
                title="Advance Payment"
                help="Advance payment amount entered against advance payment rows. If actual advance amount is not entered, planned advance amount is used."
              />
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FinanceAmountTile
                  label="Capital"
                  value={financeTotals.advanceCapital}
                  help="Capital advance payment total, using actual amount where available."
                />
                <FinanceAmountTile
                  label="Revenue"
                  value={financeTotals.advanceRevenue}
                  help="Revenue advance payment total, using actual amount where available."
                />
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-border bg-secondary/35 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className={financeBoxTitleClass}>Firm Type Distribution</div>
                    <FloatingHelp label="Firm type distribution help">
                      Splits S.O. value or actual payment value by firm type. Change the selector to compare commitment basis versus payment basis.
                    </FloatingHelp>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selectedFinanceFirmTypeDistributionLabel}
                  </p>
                </div>
                <div className="inline-flex rounded-md border border-border bg-background p-1">
                  {financeFirmTypeDistributionOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setFinanceFirmTypeDistributionKey(option.key)}
                      className={
                        "h-8 rounded px-2.5 text-xs font-medium transition " +
                        (financeFirmTypeDistributionKey === option.key
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground")
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <FinanceFirmTypeDistributionTable rows={financeFirmTypeDistributionRows} />
            </div>
          </div>
          </TooltipProvider>
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
  help,
  compact = false,
}: {
  label: string;
  value: SummaryMetricValue;
  onClick?: () => void;
  onSubMetricClick?: (dashboardFilter: string) => void;
  titleClassName?: string;
  help?: string;
  compact?: boolean;
}) {
  const subMetrics = Array.isArray(value) ? value : undefined;
  const content = (
    <>
      <div className="flex items-center justify-between">
        <div className={titleClassName ?? "text-sm font-bold text-muted-foreground"}>{label}</div>
        {help ? <FloatingHelp label={`${label} help`}>{help}</FloatingHelp> : null}
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

function FloatingHelp({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="end" className="max-w-72 leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

function FinanceSectionTitle({ title, help }: { title: string; help: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="text-sm font-extrabold text-foreground">{title}</div>
      <FloatingHelp label={`${title} finance help`}>{help}</FloatingHelp>
    </div>
  );
}

function FinanceAmountTile({
  label,
  value,
  help,
}: {
  label: string;
  value: number;
  help: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <FloatingHelp label={`${label} amount help`}>{help}</FloatingHelp>
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight">{formatCurrency(value)}</div>
    </div>
  );
}

function FinanceCarryForwardPanel({
  title,
  total,
  rows,
  emptyText,
  help,
  onOpenFilter,
}: {
  title: string;
  total?: FinanceCarryForwardTotal;
  rows?: FinanceCarryForwardRow[];
  emptyText: string;
  help: string;
  onOpenFilter: (filter: string) => void;
}) {
  const safeTotal = total ?? { count: 0, capital: 0, revenue: 0, total: 0 };
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <div className="text-[11px] font-semibold text-foreground">{title}</div>
            <FloatingHelp label={`${title} help`}>{help}</FloatingHelp>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{safeTotal.count} rows</div>
        </div>
        <div className="text-right text-sm font-semibold">{formatCurrency(safeTotal.total)}</div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <div>Capital {formatCurrency(safeTotal.capital)}</div>
        <div>Revenue {formatCurrency(safeTotal.revenue)}</div>
      </div>
      <div className="mt-3 space-y-1">
        {rows?.length ? (
          rows.map((row) => (
            <button
              key={`${title}-${row.year}`}
              type="button"
              onClick={() => onOpenFilter(row.filter)}
              className="flex w-full items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="font-medium">{row.year}</span>
              <span className="text-muted-foreground">
                {row.count} / {formatCurrency(row.total)}
              </span>
            </button>
          ))
        ) : (
          <div className="rounded border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground">
            {emptyText}
          </div>
        )}
      </div>
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

function FileCategoryFilter({
  selectedCategories,
  options,
  onChange,
}: {
  selectedCategories: FileCategoryKey[];
  options: typeof fileCategoryOptions;
  onChange: (category: FileCategoryKey, checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>File category</span>
      <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5">
        {options.map((option) => (
          <label
            key={option.key}
            className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-foreground"
          >
            <input
              type="checkbox"
              checked={selectedCategories.includes(option.key)}
              onChange={(event) => onChange(option.key, event.target.checked)}
              className="size-4 rounded border-input"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
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
                        milestone={row.milestone}
                        stage={column}
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
  milestone,
  stage,
  onClick,
}: {
  value: number | string | undefined;
  milestone: string;
  stage: string;
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
      data-testid={`status-counter-${testIdSlug(milestone)}-${testIdSlug(stage)}`}
      className={
        "inline-flex min-w-8 justify-center rounded px-2 py-0.5 text-xs font-semibold transition hover:ring-2 hover:ring-ring/30 " +
        (value === 0 ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-foreground")
      }
    >
      {value}
    </button>
  );
}

function testIdSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function hideStatus3PendingColumn(groups: StatusSummaryTableGroup[]) {
  const keepPendingMilestones = new Set([
    "Delivery",
    "Payment",
    "Advance Payment",
    "PSB",
    "PWB",
    "PSB+PWB",
    "Financial Sanction",
    "Supply Order",
  ]);
  return groups.map((group) => ({
    ...group,
    columns: group.columns.filter(
      (column) =>
        column !== "Pending" || group.rows.some((row) => keepPendingMilestones.has(row.milestone)),
    ),
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
  const orderedGroups = moveStatus3FinancialSanctionAfterBidding(visibleGroups);

  return {
    groups: orderedGroups,
    deliveryPeriodGroup,
    exportGroups: insertStatus3GroupAfterCommon(orderedGroups, deliveryPeriodGroup),
  };
}

function moveStatus3FinancialSanctionAfterBidding(groups: StatusSummaryTableGroup[]) {
  const financialIndex = groups.findIndex((group) =>
    group.rows.some((row) => row.milestone === "Financial Sanction"),
  );
  if (financialIndex === -1) return groups;
  const nextGroups = [...groups];
  const [financialGroup] = nextGroups.splice(financialIndex, 1);
  const biddingIndex = nextGroups.findIndex((group) =>
    group.rows.some((row) => row.milestone === "Bidding"),
  );
  if (biddingIndex === -1) {
    const supplyOrderIndex = nextGroups.findIndex((group) =>
      group.rows.some((row) => row.milestone === "Supply Order"),
    );
    if (supplyOrderIndex === -1) return [...nextGroups, financialGroup];
    nextGroups.splice(supplyOrderIndex, 0, financialGroup);
    return nextGroups;
  }
  nextGroups.splice(biddingIndex + 1, 0, financialGroup);
  return nextGroups;
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
          title: "Delivery Period / Milestone",
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
          getLiveStatusMilestoneCount(divisionFiles, milestoneName),
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

function isPaymentMilestoneName(name: string) {
  return normalizeMilestoneName(name) === "payment";
}

function normalizeCompletedMilestones(value: string[] | undefined) {
  return Array.from(new Set((value ?? []).map((milestone) => milestone.trim()).filter(Boolean)));
}

function getLiveStatusMilestoneCount(files: FileRecord[], milestoneName: string) {
  const normalized = normalizeMilestoneName(milestoneName);
  if (isBgMilestoneKey(normalized)) return countBgPendingOrders(files, normalized);
  if (isSupplyOrderDrivenMilestoneName(milestoneName)) {
    return countCurrentSupplyOrderMilestoneStatuses(files, normalized);
  }
  if (normalized === "bidding") {
    return files.filter(
      (file) =>
        !isCancelledFile(file) &&
        isBiddingApplicableForFile(file) &&
        normalizeMilestoneName(file.currentMilestone) === "bidding",
    ).length;
  }
  return files.filter((file) => !isCancelledFile(file) && file.currentMilestone === milestoneName)
    .length;
}

function isSupplyOrderDrivenMilestoneName(name: string) {
  const normalized = normalizeMilestoneName(name);
  return supplyOrderMilestoneNames.some(
    (milestone) => normalizeMilestoneName(milestone) === normalized,
  );
}

function shouldUseOrderMilestoneRows(file: FileRecord) {
  return countExpectedSupplyOrderRows(file) > 1 || rawSupplyOrders(file).length > 0;
}

function isFinancialSanctionReached(file: FileRecord) {
  return (
    !isCancelledFile(file) &&
    (isBiddingApplicableForFile(file) ? isYes(file.biddingStageOver) : hasFilledString(file.cfaDate)) &&
    (!isYes(file.tcec) || hasFilledString(file.cncApprovalDate))
  );
}

function isFinancialSanctionPendingOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    isFinancialSanctionReached(file) &&
    !isSupplyOrderCancelled(file, order) &&
    !isFinancialSanctionCompletedOrder(order)
  );
}

function getEffectiveOrderCurrentMilestone(file: FileRecord, order: SupplyOrderDetail) {
  if (isFinancialSanctionPendingOrder(file, order)) return "financialsanction";
  if (isSupplyOrderPendingOrder(file, order)) return "supplyorder";
  const current = normalizeMilestoneName(order.currentMilestone);
  if (current && current !== "billpreparation" && isOrderMilestoneApplicable(file, current)) {
    return current;
  }
  if (isJobCompletionCurrentOrder(file, order)) return "jobcompletion";
  if (isDueDeliveryOrder(file, order)) return "delivery";
  if (isBgCurrentOrder(order, "psbpwb") && isBgCategoryApplicable(file, order, "psbpwb")) {
    return "psbpwb";
  }
  if (isBgCurrentOrder(order, "pwb") && isBgCategoryApplicable(file, order, "pwb")) {
    return "pwb";
  }
  if (
    isYes(file.ir) &&
    hasFilledString(order.materialReceiptDate) &&
    !hasFilledString(order.irPreparationDate)
  ) {
    return "irpreparation";
  }
  if (
    isYes(file.ir) &&
    hasFilledString(order.irPreparationDate) &&
    !hasFilledString(order.irReceiptDate)
  ) {
    return "irreceipt";
  }
  if (isBillPreparationCurrentOrder(file, order)) return "billpreparation";
  return "";
}

function isOrderCurrentForMilestone(
  file: FileRecord,
  order: SupplyOrderDetail,
  normalizedMilestone: string,
) {
  if (normalizedMilestone === "financialsanction") {
    return isFinancialSanctionPendingOrder(file, order);
  }
  if (normalizedMilestone === "supplyorder") return isSupplyOrderPendingOrder(file, order);
  if (normalizedMilestone === "jobcompletion") {
    return isJobCompletionCurrentOrder(file, order);
  }
  if (normalizedMilestone === "billpreparation") {
    return isBillPreparationCurrentOrder(file, order);
  }
  const current = normalizeMilestoneName(order.currentMilestone);
  if (current === normalizedMilestone && isOrderMilestoneApplicable(file, current)) return true;
  if (normalizedMilestone === "delivery") {
    return isDueDeliveryOrder(file, order);
  }
  if (normalizedMilestone === "psbpwb") {
    return (
      isBgCategoryApplicable(file, order, "psbpwb") &&
      isFinancialSanctionCompletedOrder(order) &&
      !hasFilledString(order.combinedBgReceivedDate)
    );
  }
  if (normalizedMilestone === "pwb") {
    return (
      isBgCategoryApplicable(file, order, "pwb") &&
      hasFilledString(order.materialReceiptDate) &&
      !hasFilledString(order.pwbBgReceivedDate)
    );
  }
  if (normalizedMilestone === "irpreparation") {
    return (
      isYes(file.ir) &&
      hasFilledString(order.materialReceiptDate) &&
      !hasFilledString(order.irPreparationDate)
    );
  }
  if (normalizedMilestone === "irreceipt") {
    return (
      isYes(file.ir) &&
      hasFilledString(order.irPreparationDate) &&
      !hasFilledString(order.irReceiptDate)
    );
  }
  if (normalizedMilestone === "payment") {
    return hasPaymentWorkflowStarted(file, order) && !hasFilledString(order.paymentDate);
  }
  return false;
}

function supplyOrderMilestoneRows(file: FileRecord, normalizedMilestone: string) {
  if (normalizedMilestone === "financialsanction") return expectedSupplyOrders(file);
  if (normalizedMilestone === "supplyorder" || isBgMilestoneKey(normalizedMilestone)) {
    return expectedSupplyOrders(file);
  }
  if (normalizedMilestone === "payment") return normalizedFilePaymentOrders(file);
  return fileSupplyOrders(file);
}

function isOrderMilestoneApplicable(file: FileRecord, normalizedMilestone: string) {
  if (isBgMilestoneKey(normalizedMilestone)) {
    return fileSupplyOrders(file).some((order) =>
      isBgCategoryApplicable(file, order, normalizedMilestone),
    );
  }
  if (normalizedMilestone === "delivery") return isPhysicalDeliveryWorkflow(file);
  if (normalizedMilestone === "jobcompletion") return isJobCompletionWorkflow(file);
  if (normalizedMilestone === "irpreparation" || normalizedMilestone === "irreceipt") {
    return isYes(file.ir);
  }
  return true;
}

function matchesCurrentSupplyOrderDrivenMilestone(file: FileRecord, milestone: string) {
  if (isCancelledFile(file)) return false;
  const normalized = normalizeMilestoneName(milestone);
  if (normalized === "advancepayment") return hasAdvancePaymentPending(file);
  if (normalized === "payment") return isPaymentPending(file);
  if (!shouldUseOrderMilestoneRows(file)) {
    if (normalized === "financialsanction") {
      return (
        isFinancialSanctionReached(file) &&
        !matchesCompletedSupplyOrderDrivenMilestone(file, "financialsanction")
      );
    }
    return normalizeMilestoneName(file.currentMilestone) === normalized;
  }
  return supplyOrderMilestoneRows(file, normalized).some(
    (order) =>
      !isSupplyOrderCancelled(file, order) && isOrderCurrentForMilestone(file, order, normalized),
  );
}

function matchesDeliveryPendingStatus(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && isPendingDeliveryOrder(file, order),
    )
  );
}

function matchesDeliveryOverdueStatus(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && isOverdueDeliveryOrder(file, order),
    )
  );
}

function matchesCompletedSupplyOrderDrivenMilestone(file: FileRecord, milestone: string) {
  if (isCancelledFile(file)) return false;
  const normalized = normalizeMilestoneName(milestone);
  if (normalized === "supplyorder") return hasPlacedSupplyOrder(file);
  if (normalized === "advancepayment") {
    return advancePaymentEntries([file]).some(
      ({ file: entryFile, order }) =>
        isAdvancePaymentCompleted(order) && !isSupplyOrderCancelled(entryFile, order),
    );
  }
  if (!shouldUseOrderMilestoneRows(file)) {
    if (normalized === "financialsanction") {
      return Boolean(
        file.completedMilestones?.some((item) => normalizeMilestoneName(item) === normalized) ||
        fileSupplyOrders(file).some(
          (order) =>
            !isSupplyOrderCancelled(file, order) &&
            (hasFilledString(order.financialSanctionDate) ||
              order.completedMilestones?.some(
                (item) => normalizeMilestoneName(item) === normalized,
              )),
        ),
      );
    }
    return Boolean(
      file.completedMilestones?.some((item) => normalizeMilestoneName(item) === normalized),
    );
  }
  return supplyOrderMilestoneRows(file, normalized).some(
    (order) =>
      !isSupplyOrderCancelled(file, order) &&
      (normalized === "financialsanction"
        ? hasFilledString(order.financialSanctionDate) ||
          order.completedMilestones?.some((item) => normalizeMilestoneName(item) === normalized)
        : order.completedMilestones?.some((item) => normalizeMilestoneName(item) === normalized)),
  );
}

function countCurrentSupplyOrderMilestoneStatuses(
  files: FileRecord[],
  normalizedMilestone: string,
) {
  if (isBgMilestoneKey(normalizedMilestone))
    return countBgPendingOrders(files, normalizedMilestone);
  return files.reduce((total, file) => {
    if (isCancelledFile(file)) return total;
    if (normalizedMilestone === "advancepayment") {
      return total + countAdvancePaymentPendingOrders([file]);
    }
    if (normalizedMilestone === "payment") {
      return total + countPaymentPendingOrders([file]);
    }
    if (!shouldUseOrderMilestoneRows(file)) {
      if (normalizedMilestone === "financialsanction") {
        return (
          total +
          (isFinancialSanctionReached(file) &&
          !matchesCompletedSupplyOrderDrivenMilestone(file, "financialsanction")
            ? 1
            : 0)
        );
      }
      return (
        total + (normalizeMilestoneName(file.currentMilestone) === normalizedMilestone ? 1 : 0)
      );
    }
    return (
      total +
      supplyOrderMilestoneRows(file, normalizedMilestone).filter(
        (order) =>
          !isSupplyOrderCancelled(file, order) &&
          isOrderCurrentForMilestone(file, order, normalizedMilestone),
      ).length
    );
  }, 0);
}

function countCompletedSupplyOrderMilestoneStatuses(
  files: FileRecord[],
  normalizedMilestone: string,
) {
  if (isBgMilestoneKey(normalizedMilestone))
    return countBgReceivedOrders(files, normalizedMilestone);
  if (normalizedMilestone === "supplyorder") return countPlacedSupplyOrders(files);
  return files.reduce((total, file) => {
    if (isCancelledFile(file)) return total;
    if (normalizedMilestone === "advancepayment") {
      return (
        total +
        advancePaymentEntries([file]).filter(
          ({ file: entryFile, order }) =>
            isAdvancePaymentCompleted(order) && !isSupplyOrderCancelled(entryFile, order),
        ).length
      );
    }
    if (!shouldUseOrderMilestoneRows(file)) {
      if (normalizedMilestone === "financialsanction") {
        return (
          total +
          (fileSupplyOrders(file).some(
            (order) =>
              !isSupplyOrderCancelled(file, order) &&
              (hasFilledString(order.financialSanctionDate) ||
                normalizeCompletedMilestones(order.completedMilestones).some(
                  (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
                )),
          )
            ? 1
            : 0)
        );
      }
      return (
        total +
        (normalizeCompletedMilestones(file.completedMilestones).some(
          (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
        )
          ? 1
          : 0)
      );
    }
    return (
      total +
      supplyOrderMilestoneRows(file, normalizedMilestone).filter(
        (order) =>
          !isSupplyOrderCancelled(file, order) &&
          (normalizedMilestone === "financialsanction"
            ? hasFilledString(order.financialSanctionDate) ||
              normalizeCompletedMilestones(order.completedMilestones).some(
                (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
              )
            : normalizeCompletedMilestones(order.completedMilestones).some(
                (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
              )),
      ).length
    );
  }, 0);
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
                Delivery Completed
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
          <span className={`grid gap-1.5 ${items.length === 4 ? "grid-cols-2" : "grid-cols-3"}`}>
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

function TcecStatusControls({
  stage,
  selectedCommittee,
  onStageChange,
}: {
  stage: TcecStatusStage;
  selectedCommittee: string;
  onStageChange: (stage: TcecStatusStage) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-secondary/20 p-2">
      <div className="inline-flex overflow-hidden rounded-md border border-border bg-card">
        {[
          { key: "pre", label: "Pre-TCEC" },
          { key: "post", label: "Post-TCEC" },
        ].map((option) => {
          const selected = stage === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onStageChange(option.key as TcecStatusStage)}
              className={
                "h-8 px-3 text-xs font-semibold transition " +
                (selected
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div className="text-xs text-muted-foreground">
        {selectedCommittee
          ? `Showing meeting dates for ${selectedCommittee}`
          : "Click a committee number to see meeting dates."}
      </div>
    </div>
  );
}

function AnomalyGovernancePanel({
  acceptances,
  rules,
  fields,
  loading,
  error,
  isAdmin,
  onReview,
  onToggleRule,
  onCreateRule,
}: {
  acceptances: AnomalyAcceptanceRow[];
  rules: AnomalyRuleRow[];
  fields: AnomalyRuleField[];
  loading: boolean;
  error?: string;
  isAdmin: boolean;
  onReview: (signature: string, action: string) => void;
  onToggleRule: (rule: AnomalyRuleRow) => void;
  onCreateRule: () => void;
}) {
  const fieldLabel = (key?: string) =>
    fields.find((field) => field.key === key)?.label ?? key ?? "";
  const anomalySummary = (row: AnomalyAcceptanceRow) => ({
    title: row.ruleLabel || humanizeCompactAnomalyLabel(row.ruleKey) || "Anomaly exception",
    detail:
      row.previousField || row.laterField
        ? `${row.previousField || "Expected"}: ${row.previousValue || "-"}; ${row.laterField || "Found"}: ${row.laterValue || "-"}`
        : row.context
          ? `Context: ${row.context}`
          : "",
  });
  const formatStatus = (status: string) =>
    status
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  return (
    <div className="mt-4 space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Anomaly exception workflow</h3>
            <p className="text-xs text-muted-foreground">
              User requests stay here for admin approval, rejection, or revocation.
            </p>
          </div>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {loading ? <p className="text-xs text-muted-foreground">Loading anomaly control...</p> : null}
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-secondary/60 text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Rule</th>
                <th className="px-3 py-2">Message from User</th>
                <th className="px-3 py-2">Requested by</th>
                <th className="px-3 py-2">Reviewed by</th>
                {isAdmin ? <th className="px-3 py-2">Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {acceptances.length ? (
                acceptances.map((row) => {
                  const summary = anomalySummary(row);
                  return (
                  <tr key={row.signature} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium">{formatStatus(row.status)}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{summary.title}</span>
                      {summary.detail ? (
                        <span className="mt-1 block text-muted-foreground">{summary.detail}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{row.reason || "-"}</td>
                    <td className="px-3 py-2">
                      {row.requestedByName || row.acceptedByName || "-"}
                      <span className="block text-muted-foreground">
                        {(row.requestedAt || row.acceptedAt || "").slice(0, 10)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {row.reviewedByName || "-"}
                      <span className="block text-muted-foreground">
                        {(row.reviewedAt || row.revokedAt || "").slice(0, 10)}
                      </span>
                    </td>
                    {isAdmin ? (
                      <td className="space-x-1 px-3 py-2">
                        <button className="rounded border border-border px-2 py-1 hover:bg-accent" type="button" onClick={() => onReview(row.signature, "approve_file")}>
                          File
                        </button>
                        <button className="rounded border border-border px-2 py-1 hover:bg-accent" type="button" onClick={() => onReview(row.signature, "approve_universal")}>
                          Universal
                        </button>
                        <button className="rounded border border-border px-2 py-1 hover:bg-accent" type="button" onClick={() => onReview(row.signature, "reject")}>
                          Send correction to user
                        </button>
                        <button className="rounded border border-border px-2 py-1 hover:bg-accent" type="button" onClick={() => onReview(row.signature, "revoke")}>
                          Revoke
                        </button>
                      </td>
                    ) : null}
                  </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="px-3 py-3 text-muted-foreground" colSpan={isAdmin ? 6 : 5}>
                    No anomaly exception requests yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Custom anomaly rules</h3>
            <p className="text-xs text-muted-foreground">
              Admin-defined date order, required field, and delay checks.
            </p>
          </div>
          {isAdmin ? (
            <button
              type="button"
              onClick={onCreateRule}
              className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-accent"
            >
              Add rule
            </button>
          ) : null}
        </div>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-secondary/60 text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Rule</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Condition</th>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Status</th>
                {isAdmin ? <th className="px-3 py-2">Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {rules.length ? (
                rules.map((rule) => (
                  <tr key={rule.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium">{rule.name}</td>
                    <td className="px-3 py-2">{rule.ruleType}</td>
                    <td className="px-3 py-2">
                      {fieldLabel(rule.fieldA)} {rule.operator} {fieldLabel(rule.fieldB)}
                      {rule.thresholdDays !== undefined ? ` (${rule.thresholdDays} days)` : ""}
                    </td>
                    <td className="px-3 py-2">{rule.severity}</td>
                    <td className="px-3 py-2">{rule.enabled ? "Enabled" : "Disabled"}</td>
                    {isAdmin ? (
                      <td className="px-3 py-2">
                        <button className="rounded border border-border px-2 py-1 hover:bg-accent" type="button" onClick={() => onToggleRule(rule)}>
                          {rule.enabled ? "Disable" : "Enable"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-3 text-muted-foreground" colSpan={isAdmin ? 6 : 5}>
                    No custom rules configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FirmAnalysisControls({
  firms,
  selectedFirm,
  operators,
  negatedRoles,
  selectedRoles,
  onFirmChange,
  onOperatorChange,
  onToggleNot,
  onToggleRole,
}: {
  firms: string[];
  selectedFirm: string;
  operators: Record<string, FirmAnalysisOperator>;
  negatedRoles: FirmAnalysisRoleKey[];
  selectedRoles: FirmAnalysisRoleKey[];
  onFirmChange: (firm: string) => void;
  onOperatorChange: (
    leftRole: FirmAnalysisRoleKey,
    rightRole: FirmAnalysisRoleKey,
    operator: FirmAnalysisOperator,
  ) => void;
  onToggleNot: (role: FirmAnalysisRoleKey, checked: boolean) => void;
  onToggleRole: (role: FirmAnalysisRoleKey, checked: boolean) => void;
}) {
  const selectedOrderedRoles = firmAnalysisRoleOptions
    .map((role) => role.key)
    .filter((role) => selectedRoles.includes(role));
  const roleColumnClass = "minmax(8.75rem, 1fr)";
  return (
    <div className="flex w-full max-w-5xl flex-col gap-2">
      <label className="flex w-72 max-w-full flex-col gap-1 text-xs text-muted-foreground">
        <span>Firm</span>
        <select
          value={selectedFirm}
          onChange={(event) => onFirmChange(event.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
        >
          {firms.length ? null : <option value="">No firm data</option>}
          {firms.map((firm) => (
            <option key={firm} value={firm}>
              {firm}
            </option>
          ))}
        </select>
      </label>
      <div
        className="grid min-h-[4.5rem] w-full items-center gap-2 rounded-md border border-border bg-secondary/20 px-3 py-2"
        style={{
          gridTemplateColumns: `${roleColumnClass} 5rem ${roleColumnClass} 5rem ${roleColumnClass} 5rem ${roleColumnClass}`,
        }}
      >
        {firmAnalysisRoleOptions.map((role) => {
          const isSelected = selectedRoles.includes(role.key);
          const selectedIndex = selectedOrderedRoles.indexOf(role.key);
          const nextRole = selectedIndex >= 0 ? selectedOrderedRoles[selectedIndex + 1] : undefined;
          const shouldShowOperator = Boolean(isSelected && nextRole);
          return (
            <Fragment key={role.key}>
              <div
                className={
                  "grid h-11 min-w-0 grid-cols-[4.25rem_minmax(0,1fr)] items-center overflow-hidden rounded-md border text-xs shadow-sm " +
                  (isSelected
                    ? "border-primary/50 bg-background text-foreground"
                    : "border-border bg-background/50 text-muted-foreground")
                }
              >
                <label
                  className={
                    "flex h-full items-center justify-center gap-1 border-r px-2 text-[11px] font-semibold " +
                    (isSelected ? "border-primary/30 bg-primary/10" : "border-border bg-secondary/30")
                  }
                >
                  <input
                    type="checkbox"
                    checked={negatedRoles.includes(role.key)}
                    disabled={!isSelected}
                    onChange={(event) => onToggleNot(role.key, event.target.checked)}
                    className="size-3 rounded border-input disabled:opacity-40"
                  />
                  NOT
                </label>
                <button
                  type="button"
                  onClick={() => onToggleRole(role.key, !isSelected)}
                  className="h-full min-w-0 truncate px-3 text-left text-xs font-semibold hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring/40"
                  aria-pressed={isSelected}
                >
                  {role.label}
                </button>
              </div>
              {role.key === "order" ? null : (
                <div className="flex h-11 items-center justify-center">
                  {shouldShowOperator && nextRole ? (
                    <select
                      value={operators[firmAnalysisOperatorKey(role.key, nextRole)] ?? "and"}
                      onChange={(event) =>
                        onOperatorChange(role.key, nextRole, event.target.value as FirmAnalysisOperator)
                      }
                      className="h-8 w-20 rounded-md border border-input bg-background px-2 text-center text-xs font-semibold uppercase text-foreground shadow-sm"
                    >
                      <option value="and">AND</option>
                      <option value="or">OR</option>
                    </select>
                  ) : (
                    <span className="block h-8 w-20" aria-hidden="true" />
                  )}
                </div>
              )}
            </Fragment>
          );
        })}
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

function getMonthCountAnalyticsColumns(): AnalyticsTableColumn[] {
  return [
    {
      key: "name",
      label: "Month",
      align: "left",
      format: (value) => formatMonthKeyLabel(String(value)),
    },
    { key: "count", label: "Count" },
  ];
}

function getPreBidMeetingAnalyticsColumns(): AnalyticsTableColumn[] {
  return [
    {
      key: "name",
      label: "Month",
      align: "left",
      format: (value) => formatMonthKeyLabel(String(value)),
    },
    { key: "count", label: "Total" },
    { key: "preBidDue", label: "Due" },
    { key: "preBidCompleted", label: "Completed" },
    { key: "refloatPreBidDue", label: "Refloat Due" },
    { key: "refloatPreBidCompleted", label: "Refloat Completed" },
  ];
}

function getFiscalPreBidMeetingAnalyticsColumns(
  onFiscalYearClick: (fiscalYear: string) => void,
): AnalyticsTableColumn[] {
  return [
    getFiscalYearDrilldownColumn(onFiscalYearClick),
    { key: "count", label: "Total" },
    { key: "preBidDue", label: "Due" },
    { key: "preBidCompleted", label: "Completed" },
    { key: "refloatPreBidDue", label: "Refloat Due" },
    { key: "refloatPreBidCompleted", label: "Refloat Completed" },
  ];
}

function getFiscalTcecStatusColumns(
  _stage: TcecStatusStage,
  onFiscalYearClick: (fiscalYear: string) => void,
): AnalyticsTableColumn[] {
  return [
    getFiscalYearDrilldownColumn(onFiscalYearClick),
    { key: "reviewed", label: "Files reviewed" },
    { key: "signed", label: "Minutes signed" },
    { key: "pending", label: "Minutes pending" },
  ];
}

function getFiscalYearDrilldownColumn(
  onFiscalYearClick: (fiscalYear: string) => void,
): AnalyticsTableColumn {
  return {
    key: "name",
    label: "FY",
    align: "left",
    render: (value) => (
      <button
        type="button"
        onClick={() => onFiscalYearClick(String(value))}
        className="rounded-md px-2 py-1 text-left font-semibold text-primary hover:bg-primary/10"
      >
        {String(value)}
      </button>
    ),
  };
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

function getFirmAnalysisColumns(): AnalyticsTableColumn[] {
  return [
    { key: "name", label: "Firm", align: "left" },
    { key: "selectedRolesLabel", label: "Boolean selection", align: "left" },
    { key: "selectedRoles", label: "Matching cases" },
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

function getSuspectedAnomalyColumns(
  onAccept: (row: Record<string, number | string>) => void,
  onAdminReview?: (signature: string, action: string) => void,
): AnalyticsTableColumn[] {
  return [
    { key: "fileRef", label: "File", align: "left" },
    { key: "division", label: "Division", align: "left" },
    { key: "block", label: "Block", align: "left" },
    { key: "rule", label: "Rule", align: "left" },
    {
      key: "previousDate",
      label: "Expected / previous",
      align: "left",
      format: (value, row) => `${row.previousField || "Previous"}\n${value}`,
    },
    {
      key: "laterDate",
      label: "Found / later",
      align: "left",
      format: (value, row) => `${row.laterField || "Later"}\n${value}`,
    },
    {
      key: "action",
      label: "Action",
      align: "left",
      render: (_value, row) => {
        const signature = String(row.signature ?? "");
        if (onAdminReview && signature) {
          return (
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => onAdminReview(signature, "approve_file")}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs font-semibold text-foreground hover:bg-accent"
              >
                Accept file
              </button>
              <button
                type="button"
                onClick={() => onAdminReview(signature, "approve_universal")}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs font-semibold text-foreground hover:bg-accent"
              >
                Accept universal
              </button>
            </div>
          );
        }
        return (
          <button
            type="button"
            onClick={() => onAccept(row)}
            className="rounded-md border border-border bg-card px-2 py-1 text-xs font-semibold text-foreground hover:bg-accent"
          >
            Send request/message to Admin
          </button>
        );
      },
    },
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

function getTcecStatusColumns(
  stage: TcecStatusStage,
  onCommitteeClick: (committee: string) => void,
): AnalyticsTableColumn[] {
  return [
    {
      key: "name",
      label: stage === "pre" ? "Pre-TCEC Committee" : "Post-TCEC Committee",
      align: "left",
      render: (value) => (
        <button
          type="button"
          onClick={() => onCommitteeClick(String(value))}
          className="rounded-md px-2 py-1 text-left font-semibold text-primary hover:bg-primary/10"
        >
          {String(value)}
        </button>
      ),
    },
    { key: "reviewed", label: "Files reviewed" },
    { key: "signed", label: "Minutes signed" },
    { key: "pending", label: "Minutes pending" },
  ];
}

function getTcecMeetingColumns(stage: TcecStatusStage): AnalyticsTableColumn[] {
  return [
    {
      key: "name",
      label: stage === "pre" ? "Pre-TCEC Date" : "Post-TCEC Date",
      align: "left",
      format: (value) => formatIsoDateForDisplay(String(value)),
    },
    { key: "reviewed", label: "Files reviewed" },
    { key: "signed", label: "Minutes signed" },
    { key: "pending", label: "Minutes pending" },
  ];
}

function getCncSummaryColumns(): AnalyticsTableColumn[] {
  return [
    { key: "name", label: "CNC Date", align: "left", format: (value) => formatIsoDateForDisplay(String(value)) },
    { key: "reviewed", label: "Cases reviewed" },
    { key: "approved", label: "CNC approved" },
    { key: "financialSanctionSigned", label: "Financial sanction signed" },
    { key: "supplyOrderPlaced", label: "S.O. placed" },
    { key: "approvalPending", label: "Approval pending" },
    { key: "financialSanctionPending", label: "Financial sanction pending" },
    { key: "supplyOrderPending", label: "S.O. pending" },
  ];
}

function getFiscalCncSummaryColumns(
  onFiscalYearClick: (fiscalYear: string) => void,
): AnalyticsTableColumn[] {
  return [
    getFiscalYearDrilldownColumn(onFiscalYearClick),
    { key: "reviewed", label: "Cases reviewed" },
    { key: "approved", label: "CNC approved" },
    { key: "financialSanctionSigned", label: "Financial sanction signed" },
    { key: "supplyOrderPlaced", label: "S.O. placed" },
    { key: "approvalPending", label: "Approval pending" },
    { key: "financialSanctionPending", label: "Financial sanction pending" },
    { key: "supplyOrderPending", label: "S.O. pending" },
  ];
}

function getMonthWiseSupplyOrderColumns(
  onMonthClick: (monthKey: string) => void,
): AnalyticsTableColumn[] {
  return [
    {
      key: "name",
      label: "Month",
      align: "left",
      format: (_value, row) => formatMonthKeyLabel(String(row.monthKey || row.name || "")),
    },
    {
      key: "count",
      label: "Supply Orders",
      render: (value, row) => (
        <button
          type="button"
          onClick={() => onMonthClick(String(row.monthKey || row.name || ""))}
          className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10"
        >
          {String(value)}
        </button>
      ),
    },
  ];
}

function getMonthWiseDeliveryScheduleColumns(
  mode: "gross" | "net",
  onMonthClick: (monthKey: string) => void,
): AnalyticsTableColumn[] {
  return [
    {
      key: "name",
      label: "Month",
      align: "left",
      format: (_value, row) => formatMonthKeyLabel(String(row.monthKey || row.name || "")),
    },
    {
      key: "count",
      label: mode === "gross" ? "D.P. expiring" : "Net pending",
      render: (value, row) => (
        <button
          type="button"
          onClick={() => onMonthClick(String(row.monthKey || row.name || ""))}
          className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10"
        >
          {String(value)}
        </button>
      ),
    },
  ];
}

function getMonthWiseBgExpiryColumns(
  onMonthClick: (category: string, monthKey: string) => void,
): AnalyticsTableColumn[] {
  const countColumn = (key: string, label: string, category: string): AnalyticsTableColumn => ({
    key,
    label,
    render: (value, row) => (
      <button
        type="button"
        onClick={() => onMonthClick(category, String(row.monthKey || row.name || ""))}
        className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10"
      >
        {String(value)}
      </button>
    ),
  });
  return [
    {
      key: "name",
      label: "Month",
      align: "left",
      format: (_value, row) => formatMonthKeyLabel(String(row.monthKey || row.name || "")),
    },
    countColumn("count", "Total", "all"),
    countColumn("psb", "PSB", "psb"),
    countColumn("pwb", "PWB", "pwb"),
    countColumn("psbPwb", "PSB+PWB", "psbpwb"),
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

function getAnalyticsSearchTarget(
  panelKey: AnalyticsPanelKey,
  row: Record<string, number | string>,
  columnKey: string,
): AnalyticsSearchTarget | undefined {
  const name = String(row.name ?? row.range ?? row.fileRef ?? "").trim();
  if (
    !name ||
    columnKey === "rank" ||
    (columnKey === "name" && panelKey !== "cncSummary" && panelKey !== "preBidMeetings") ||
    columnKey === "range"
  )
    return undefined;

  if (panelKey === "divisionFiles" && columnKey === "count") return { division: name };
  if (panelKey === "divisionTurnaround" && columnKey === "sampleSize") return { division: name };
  if (panelKey === "paymentPending" && columnKey === "count") {
    return { dashboardFilter: "paymentDue", division: name };
  }
  if (panelKey === "preBidMeetings") {
    const fiscalYear = String(row.fiscalYear ?? "").trim();
    if (/^\d{4}-\d{2}$/.test(fiscalYear)) {
      const filterByColumn: Record<string, string> = {
        count: `preBidMeetingFy:all:${fiscalYear}`,
        preBidDue: `preBidMeetingFy:due:${fiscalYear}`,
        preBidCompleted: `preBidMeetingFy:completed:${fiscalYear}`,
        refloatPreBidDue: `refloatPreBidMeetingFy:due:${fiscalYear}`,
        refloatPreBidCompleted: `refloatPreBidMeetingFy:completed:${fiscalYear}`,
      };
      const dashboardFilter = filterByColumn[columnKey];
      return dashboardFilter
        ? { dashboardFilter, focusSection: "Bidding details" }
        : undefined;
    }
    const monthKey = String(row.monthKey ?? row.name ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return undefined;
    const filterByColumn: Record<string, string> = {
      name: `preBidMeeting:all:${monthKey}`,
      count: `preBidMeeting:all:${monthKey}`,
      preBidDue: `preBidMeeting:due:${monthKey}`,
      preBidCompleted: `preBidMeeting:completed:${monthKey}`,
      refloatPreBidDue: `refloatPreBidMeeting:due:${monthKey}`,
      refloatPreBidCompleted: `refloatPreBidMeeting:completed:${monthKey}`,
    };
    const dashboardFilter = filterByColumn[columnKey];
    return dashboardFilter
      ? { dashboardFilter, focusSection: "Bidding details" }
      : undefined;
  }
  if (
    panelKey === "tcecStatus" &&
    (columnKey === "reviewed" || columnKey === "signed" || columnKey === "pending")
  ) {
    const stage = String(row.stage ?? "pre") === "post" ? "post" : "pre";
    const fiscalYear = String(row.fiscalYear ?? "").trim();
    if (/^\d{4}-\d{2}$/.test(fiscalYear)) {
      const committee = String(row.name ?? "").trim();
      const isCommitteeRow = Boolean(row.committee === undefined && committee && committee !== fiscalYear);
      return {
        dashboardFilter: isCommitteeRow
          ? getTcecStatusFiscalYearDashboardFilter(stage, columnKey, fiscalYear, committee)
          : getTcecStatusFiscalYearDashboardFilter(stage, columnKey, fiscalYear),
        focusSection: "TCEC block",
      };
    }
    return {
      dashboardFilter: getTcecStatusDashboardFilter(stage, columnKey, name),
      focusSection: "TCEC block",
    };
  }
  if (panelKey === "cncSummary" && isCncSummaryMetric(columnKey)) {
    const fiscalYear = String(row.fiscalYear ?? "").trim();
    if (/^\d{4}-\d{2}$/.test(fiscalYear)) {
      if (columnKey === "name") return undefined;
      return {
        dashboardFilter: getCncSummaryFiscalYearDashboardFilter(columnKey, fiscalYear),
        focusSection: "Approval block",
      };
    }
    const cncDate = String(row.cncDate ?? row.name ?? "").trim();
    if (!cncDate) return undefined;
    return {
      dashboardFilter: getCncSummaryDashboardFilter(columnKey, cncDate),
      focusSection: "Approval block",
    };
  }
  if (panelKey === "topFirms" && columnKey === "value") {
    return { analyticsType: "firm", analyticsNames: [name] };
  }
  if (panelKey === "firmAnalysis") {
    const firm = String(row.name ?? "").trim();
    if (!firm || columnKey === "name") return undefined;
    const expression = String(row.selectedRolesExpression ?? "").trim();
    if (columnKey === "selectedRoles" && expression) {
      return {
        dashboardFilter: `firmAnalysis:expr:${expression}:${encodeURIComponent(firm)}`,
        focusSection: "Firm details",
      };
    }
  }
  if (panelKey === "indentorsByFiles" && columnKey === "count") {
    return { analyticsType: "indentor", analyticsNames: [name] };
  }
  if (panelKey === "indentorsByValue" && columnKey === "value") {
    return { analyticsType: "indentor", analyticsNames: [name] };
  }
  if (panelKey === "biddingMode" && columnKey === "count") {
    return { dashboardFilter: `mode:${name.toUpperCase()}` };
  }
  if (panelKey === "fileValueThresholds" && columnKey === "count") {
    return { dashboardFilter: `valueThreshold:${encodeURIComponent(name)}` };
  }
  if (
    panelKey === "suspectedAnomaly" &&
    columnKey !== "action" &&
    columnKey !== "rank"
  ) {
    const fileId = String(row.fileId ?? "").trim();
    return fileId
      ? {
          dashboardFilter: `anomalyFile:${encodeURIComponent(fileId)}`,
          ...getSuspectedAnomalySearchFocus(row),
        }
      : undefined;
  }
  if (panelKey === "milestoneClearingTable" && columnKey === "sampleSize") {
    return getMilestoneClearingSearchTarget(name);
  }
  return undefined;
}

function getTcecMeetingSearchTarget(
  stage: TcecStatusStage,
  row: Record<string, number | string>,
  columnKey: string,
): AnalyticsSearchTarget | undefined {
  if (columnKey !== "name" && columnKey !== "reviewed" && columnKey !== "signed" && columnKey !== "pending") {
    return undefined;
  }
  const committee = String(row.committee ?? "").trim();
  const meetingDate = String(row.meetingDate ?? row.name ?? "").trim();
  if (!committee || !meetingDate) return undefined;
  const metric = columnKey === "name" ? "reviewed" : columnKey;
  return {
    dashboardFilter: getTcecStatusDashboardFilter(stage, metric, committee, meetingDate),
    focusSection: "TCEC block",
  };
}

function getSuspectedAnomalySearchFocus(row: Record<string, number | string>) {
  const block = normalizeMilestoneName(String(row.block ?? ""));
  const rule = normalizeMilestoneName(String(row.rule ?? ""));
  const previousField = normalizeMilestoneName(String(row.previousField ?? ""));
  const laterField = normalizeMilestoneName(String(row.laterField ?? ""));
  const source = `${block} ${rule} ${previousField} ${laterField}`;

  if (block === "datacompleteness") {
    return { focusSection: "File details" };
  }
  if (
    block === "bidding" ||
    block === "prebidmeeting" ||
    block === "refloat" ||
    block === "refloatprebidmeeting"
  ) {
    return { focusSection: "Bidding details" };
  }
  if (block === "tcec") return { focusSection: "TCEC block" };
  if (block === "scrutiny" || block === "control") {
    return { focusSection: "Scrutiny and control" };
  }
  if (block === "closure") {
    return { focusSection: "Milestones", focusMilestone: "File Closed" };
  }
  if (
    block === "highvalue" ||
    block === "ad" ||
    block === "rqa" ||
    block === "ifa" ||
    block === "cfa" ||
    block === "cnc"
  ) {
    return { focusSection: "Approval block" };
  }
  if (block === "cancellation" && !source.includes("so")) {
    return { focusSection: "File details" };
  }

  const supplyOrderTarget = getSuspectedAnomalySupplyOrderFocusTarget(source);
  if (supplyOrderTarget) {
    return { focusSection: "Supply order and payment", focusTarget: supplyOrderTarget };
  }
  if (source.includes("division") || source.includes("description") || source.includes("indentor")) {
    return { focusSection: "File details" };
  }
  return { focusSection: "Timeline" };
}

function getSuspectedAnomalySupplyOrderFocusTarget(source: string) {
  const paddedSource = ` ${source} `;
  if (source.includes("psbpwb") || source.includes("combinedbg")) return "psbpwb:any";
  if (source.includes("pwb")) return "pwb:any";
  if (source.includes("psb")) return "psb:any";
  if (source.includes("bankguarantee") || source.includes("bg")) return "securitybg:any";
  if (source.includes("deliveryperiod") || source.includes("reviseddp") || source.includes("dp")) {
    return "deliveryperiod:any";
  }
  if (source.includes("stagedelivery")) return "stagedelivery:any";
  if (source.includes("stagepayment")) return "stagepayment:any";
  if (source.includes("advancepayment")) return "advancepayment:yes";
  if (source.includes("jobcompletion")) return "jobcompletion:any";
  if (source.includes("delivery") || source.includes("materialreceipt")) return "delivery:any";
  if (source.includes("irpreparation")) return "irpreparation:any";
  if (source.includes("irreceipt") || paddedSource.includes(" ir ")) return "irreceipt:any";
  if (source.includes("billpreparation")) return "billpreparation:any";
  if (source.includes("billsentforpayment")) return "billsentforpayment:any";
  if (source.includes("actualpayment")) return "actualpayment:yes";
  if (source.includes("payment")) return "payment:any";
  if (source.includes("financialsanction")) return "financialsanction:any";
  if (source.includes("firmtype")) return "firmtype:any";
  if (source.includes("firm") || source.includes("supplyorder") || source.includes("so")) {
    return "supplyorder:any";
  }
  return undefined;
}

function getCncSummaryDashboardFilter(metric: string, cncDate: string) {
  return `cncSummary:${encodeURIComponent(metric)}:${encodeURIComponent(cncDate)}`;
}

function getCncSummaryFiscalYearDashboardFilter(metric: string, fiscalYear: string) {
  return `cncSummaryFy:${encodeURIComponent(metric)}:${encodeURIComponent(fiscalYear)}`;
}

function isCncSummaryMetric(value: string) {
  return (
    value === "name" ||
    value === "reviewed" ||
    value === "approved" ||
    value === "financialSanctionSigned" ||
    value === "supplyOrderPlaced" ||
    value === "approvalPending" ||
    value === "financialSanctionPending" ||
    value === "supplyOrderPending"
  );
}

function getTcecStatusDashboardFilter(
  stage: string,
  metric: string,
  committee: string,
  meetingDate?: string,
) {
  return [
    "tcecStatus",
    encodeURIComponent(stage),
    encodeURIComponent(metric),
    encodeURIComponent(committee),
    meetingDate ? encodeURIComponent(meetingDate) : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(":");
}

function getTcecStatusFiscalYearDashboardFilter(
  stage: string,
  metric: string,
  fiscalYear: string,
  committee?: string,
) {
  return [
    "tcecStatusFy",
    encodeURIComponent(stage),
    encodeURIComponent(metric),
    encodeURIComponent(fiscalYear),
    committee ? encodeURIComponent(committee) : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(":");
}

function getMilestoneClearingSearchTarget(name: string): AnalyticsSearchTarget | undefined {
  const normalized = normalizeMilestoneName(name);
  if (normalized === "delivery") return { dashboardFilter: "deliveryCompleted" };
  if (normalized === "payment") return { dashboardFilter: "milestoneCleared:payment" };
  const milestone = milestoneDefinitions.find(
    (item) => normalizeMilestoneName(item.label) === normalized,
  );
  if (milestone) return { dashboardFilter: `milestoneCleared:${milestone.key}` };
  return undefined;
}

type AnomalyWorkflowTab =
  | "current"
  | "sent"
  | "fileAccepted"
  | "universalAccepted"
  | "rejected"
  | "revoked";

function formatAnomalyStatus(status: string) {
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function groupSuspectedAnomalyRows(rows: SuspectedAnomalyRow[]) {
  const groups = new Map<string, SuspectedAnomalyRow[]>();
  rows.forEach((row) => {
    const key = row.rule || row.ruleKey || "Suspected anomaly";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });
  return Array.from(groups.entries()).map(([title, items]) => ({ title, items }));
}

function groupAnomalyAcceptances(rows: AnomalyAcceptanceRow[]) {
  const groups = new Map<string, AnomalyAcceptanceRow[]>();
  rows.forEach((row) => {
    const key = row.ruleLabel || humanizeCompactAnomalyLabel(row.ruleKey) || "Anomaly exception";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });
  return Array.from(groups.entries()).map(([title, items]) => ({ title, items }));
}

function humanizeCompactAnomalyLabel(value?: string) {
  if (!value) return "";
  if (value === "fileclosedbutbgreturnpendingexists") {
    return "File is closed but BG return is still pending";
  }
  return value
    .replace(/fileclosed/g, "File closed ")
    .replace(/bgreturn/g, " BG return ")
    .replace(/pending/g, " pending ")
    .replace(/exists/g, " exists ")
    .replace(/jobcompletion/g, " Job Completion ")
    .replace(/financialsanction/g, " Financial Sanction ")
    .replace(/supplyorder/g, " Supply Order ")
    .replace(/should/g, " should ")
    .replace(/not/g, " not ")
    .replace(/before/g, " before ")
    .replace(/after/g, " after ")
    .replace(/date/g, " date ")
    .replace(/\s+/g, " ")
    .trim();
}

function SuspectedAnomalyGroupedView({
  rows,
  acceptances,
  isAdmin,
  onRequest,
  onAdminReview,
  onClearSelected,
  onOpenRow,
}: {
  rows: SuspectedAnomalyRow[];
  acceptances: AnomalyAcceptanceRow[];
  isAdmin: boolean;
  onRequest: (row: Record<string, number | string>) => void;
  onAdminReview: (signature: string, action: string) => void;
  onClearSelected: (signatures: string[]) => void;
  onOpenRow: (row: Record<string, number | string>) => void;
}) {
  const [tab, setTab] = useState<AnomalyWorkflowTab>("current");
  const [selectedDecisionSignatures, setSelectedDecisionSignatures] = useState<string[]>([]);
  const currentRows = rows.filter(
    (row) =>
      row.requestStatus !== "pending" &&
      row.requestStatus !== "rejected" &&
      row.requestStatus !== "revoked",
  );
  const sentRows = rows.filter((row) => row.requestStatus === "pending");
  const fileAcceptedRows = acceptances.filter((row) => row.status === "approved_file");
  const universalAcceptedRows = acceptances.filter((row) => row.status === "approved_universal");
  const rejectedRows = acceptances.filter((row) => row.status === "rejected");
  const revokedRows = acceptances.filter((row) => row.status === "revoked");
  const decisionRows =
    tab === "fileAccepted"
      ? fileAcceptedRows
      : tab === "universalAccepted"
        ? universalAcceptedRows
        : tab === "rejected"
          ? rejectedRows
          : tab === "revoked"
            ? revokedRows
            : [];
  const tabs: Array<{ key: AnomalyWorkflowTab; label: string; count: number }> = [
    { key: "current", label: "Current", count: currentRows.length },
    { key: "sent", label: isAdmin ? "Received request" : "Sent", count: sentRows.length },
    { key: "fileAccepted", label: "File Accepted", count: fileAcceptedRows.length },
    { key: "universalAccepted", label: "Universal Accepted", count: universalAcceptedRows.length },
    { key: "rejected", label: "Rejected", count: rejectedRows.length },
    { key: "revoked", label: "Revoked", count: revokedRows.length },
  ];
  const canClearDecisionRows = tab === "rejected" || tab === "revoked";
  const selectedDecisionSet = new Set(selectedDecisionSignatures);
  const toggleDecisionSignature = (signature: string) => {
    setSelectedDecisionSignatures((current) =>
      current.includes(signature)
        ? current.filter((item) => item !== signature)
        : [...current, signature],
    );
  };
  useEffect(() => {
    setSelectedDecisionSignatures([]);
  }, [tab]);
  const decisionSignatureKey = decisionRows.map((row) => row.signature).join("|");
  useEffect(() => {
    setSelectedDecisionSignatures((current) =>
      current.filter((signature) => decisionRows.some((row) => row.signature === signature)),
    );
  }, [decisionSignatureKey]);

  const renderActiveGroups = (activeRows: SuspectedAnomalyRow[]) => {
    if (!activeRows.length) {
      return <div className="text-sm text-muted-foreground">No anomalies in this tab.</div>;
    }
    return (
      <div className="space-y-3">
        {groupSuspectedAnomalyRows(activeRows).map((group) => (
          <div key={group.title} className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/40 px-3 py-2">
              <h3 className="text-sm font-semibold">{group.title}</h3>
              <span className="text-xs text-muted-foreground">{group.items.length} file(s)</span>
            </div>
            <div className="divide-y divide-border/70">
              {group.items.map((row) => (
                <div key={row.signature} className="grid gap-3 px-3 py-3 text-xs md:grid-cols-[1.2fr_2fr_1.4fr]">
                  <div>
                    <button
                      type="button"
                      onClick={() => onOpenRow(row as unknown as Record<string, number | string>)}
                      className="font-semibold text-primary hover:underline"
                    >
                      {row.fileRef}
                    </button>
                    <div className="mt-1 text-muted-foreground">{row.division || "-"}</div>
                    <div className="text-muted-foreground">{row.block}</div>
                  </div>
                  <div className="space-y-1">
                    <div>
                      <span className="font-medium">{row.previousField || "Expected"}:</span>{" "}
                      {row.previousDate || "-"}
                    </div>
                    <div>
                      <span className="font-medium">{row.laterField || "Found"}:</span>{" "}
                      {row.laterDate || "-"}
                    </div>
                    {row.userExplanation ? (
                      <div className="text-muted-foreground">
                        {isAdmin ? `Message from ${row.requestedByName || "User"}` : "Message to Admin"}:{" "}
                        {row.userExplanation}
                      </div>
                    ) : null}
                    {row.adminMessage ? (
                      <div className="font-medium text-destructive">Message to User: {row.adminMessage}</div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-start gap-1">
                    {row.requestStatus ? (
                      <span className="rounded border border-border px-2 py-1 font-medium">
                        {formatAnomalyStatus(row.requestStatus)}
                      </span>
                    ) : null}
                    {isAdmin ? (
                      <>
                        <button type="button" onClick={() => onAdminReview(row.signature, "approve_file")} className="rounded border border-border px-2 py-1 font-semibold hover:bg-accent">
                          Accept file
                        </button>
                        <button type="button" onClick={() => onAdminReview(row.signature, "approve_universal")} className="rounded border border-border px-2 py-1 font-semibold hover:bg-accent">
                          Accept universal
                        </button>
                        <button type="button" onClick={() => onAdminReview(row.signature, "reject")} className="rounded border border-border px-2 py-1 font-semibold hover:bg-accent">
                          Send correction to user
                        </button>
                      </>
                    ) : row.requestStatus === "pending" ? (
                      <span className="text-muted-foreground">Message sent to Admin</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onRequest(row as unknown as Record<string, number | string>)}
                        className="rounded border border-border px-2 py-1 font-semibold hover:bg-accent"
                      >
                        Send request/message to Admin
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderDecisionRows = (decisionTabRows: AnomalyAcceptanceRow[]) => {
    if (!decisionTabRows.length) {
      return <div className="text-sm text-muted-foreground">No anomalies in this tab.</div>;
    }
    return (
      <div className="space-y-3">
        {groupAnomalyAcceptances(decisionTabRows).map((group) => (
          <div key={group.title} className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/40 px-3 py-2">
              <h3 className="text-sm font-semibold">{group.title}</h3>
              <span className="text-xs text-muted-foreground">{group.items.length} file(s)</span>
            </div>
            <div className="divide-y divide-border/70">
              {group.items.map((row) => (
                <div key={row.signature} className="grid gap-3 px-3 py-3 text-xs md:grid-cols-[1.1fr_2fr_1fr]">
                  <div className="flex items-start gap-2">
                    {canClearDecisionRows ? (
                      <input
                        type="checkbox"
                        checked={selectedDecisionSet.has(row.signature)}
                        onChange={() => toggleDecisionSignature(row.signature)}
                        className="mt-0.5"
                        aria-label={`Select ${row.fileRef || "anomaly"}`}
                      />
                    ) : null}
                    <span className="font-semibold">{row.fileRef || "File reference not available"}</span>
                  </div>
                  <div>
                    <div>{row.previousField || "Expected"}: {row.previousValue || "-"}</div>
                    <div>{row.laterField || "Found"}: {row.laterValue || "-"}</div>
                    {row.reason ? (
                      <div className="mt-1 text-muted-foreground">
                        {isAdmin ? `Message from ${row.requestedByName || "User"}` : "Message to Admin"}:{" "}
                        {row.reason}
                      </div>
                    ) : null}
                    {row.adminMessage ? <div className="mt-1 font-medium text-destructive">Message to User: {row.adminMessage}</div> : null}
                  </div>
                  <div>
                    <div className="font-medium">{formatAnomalyStatus(row.status)}</div>
                    <div className="text-muted-foreground">
                      {row.reviewedByName || row.revokedByName || row.requestedByName || "-"}
                    </div>
                    <div className="text-muted-foreground">
                      {(row.reviewedAt || row.revokedAt || row.requestedAt || "").slice(0, 10)}
                    </div>
                    {isAdmin && (row.status === "approved_file" || row.status === "approved_universal") ? (
                      <button
                        type="button"
                        onClick={() => onAdminReview(row.signature, "revoke")}
                        className="mt-2 rounded border border-border px-2 py-1 font-semibold hover:bg-accent"
                      >
                        Revoke
                      </button>
                    ) : null}
                    {canClearDecisionRows ? (
                      <button
                        type="button"
                        onClick={() => onClearSelected([row.signature])}
                        className="mt-2 rounded border border-border px-2 py-1 font-semibold text-destructive hover:bg-destructive/10"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={
              "rounded-md border px-3 py-1.5 text-xs font-semibold " +
              (tab === item.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-accent")
            }
          >
            {item.label} ({item.count})
          </button>
        ))}
        {canClearDecisionRows && selectedDecisionSignatures.length ? (
          <button
            type="button"
            onClick={() => onClearSelected(selectedDecisionSignatures)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10"
          >
            Clear selected ({selectedDecisionSignatures.length})
          </button>
        ) : null}
      </div>
      {tab === "current"
        ? renderActiveGroups(currentRows)
        : tab === "sent"
          ? renderActiveGroups(sentRows)
          : renderDecisionRows(decisionRows)}
    </div>
  );
}

function AnalyticsRankingTable({
  columns,
  rows,
  getCellSearchTarget,
  onOpenSearchTarget,
}: {
  columns: AnalyticsTableColumn[];
  rows: Array<Record<string, number | string>>;
  getCellSearchTarget?: (
    row: Record<string, number | string>,
    column: AnalyticsTableColumn,
  ) => AnalyticsSearchTarget | undefined;
  onOpenSearchTarget?: (target: AnalyticsSearchTarget) => void;
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
          {rows.map((row, rowIndex) => (
            <tr
              key={String(row.signature ?? row.name ?? row.fileRef ?? rowIndex)}
              className="border-b border-border/60 last:border-0"
            >
              {columns.map((column) => {
                const value = row[column.key] ?? "";
                const renderedValue = column.render
                  ? column.render(value, row)
                  : column.format
                    ? column.format(value, row)
                    : String(value);
                const searchTarget = getCellSearchTarget?.(row, column);
                const content =
                  searchTarget && onOpenSearchTarget ? (
                    <button
                      type="button"
                      onClick={() => onOpenSearchTarget(searchTarget)}
                      className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10"
                    >
                      {renderedValue}
                    </button>
                  ) : (
                    renderedValue
                  );
                return (
                  <td
                    key={column.key}
                    className={
                      "whitespace-pre-line px-3 py-2 tabular-nums " +
                      (column.align === "left" ? "text-left font-medium" : "text-center")
                    }
                  >
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FinanceFirmTypeDistributionTable({
  rows,
}: {
  rows: Array<{ name: string; value: number; share: number }>;
}) {
  if (!rows.length) {
    return (
      <div className="text-sm text-muted-foreground">No firm type distribution available.</div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[540px] table-fixed text-sm">
        <colgroup>
          <col className="w-[46%]" />
          <col className="w-[30%]" />
          <col className="w-[24%]" />
        </colgroup>
        <thead className="bg-secondary/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Firm type</th>
            <th className="px-3 py-2 text-right font-medium">Value</th>
            <th className="px-3 py-2 text-right font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-border/70">
              <td className="px-3 py-2 font-medium">{row.name}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.value)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatPercent(row.share)}</td>
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
  onFinancialSanctionPendingClick,
  onFinancialSanctionCompletedClick,
  onBgExpiredClick,
  onBgToBeReturnedClick,
  onBgReturnedClick,
  onAdvancePaidClick,
  onAdvancePendingClick,
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
    financialSanctionPending?: number;
    financialSanctionCompleted?: number;
    bgExpired?: number;
    bgToBeReturned?: number;
    bgReturned?: number;
    advancePaid?: number;
    advancePending?: number;
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
  onFinancialSanctionPendingClick: () => void;
  onFinancialSanctionCompletedClick: () => void;
  onBgExpiredClick: () => void;
  onBgToBeReturnedClick: () => void;
  onBgReturnedClick: () => void;
  onAdvancePaidClick: () => void;
  onAdvancePendingClick: () => void;
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
    onFinancialSanctionPendingClick,
    onFinancialSanctionCompletedClick,
    onBgExpiredClick,
    onBgToBeReturnedClick,
    onBgReturnedClick,
    onAdvancePaidClick,
    onAdvancePendingClick,
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
          <GroupedStatusMetricGrid
            metrics={metrics}
            tone={tone}
            fallbackClassName={metricGridClass}
          />
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

function GroupedStatusMetricGrid({
  metrics,
  tone,
  fallbackClassName,
}: {
  metrics: StatusMetric[];
  tone: ReturnType<typeof getMilestoneTone>;
  fallbackClassName: string;
}) {
  const active = metrics.find((metric) => metric.label === "In process");
  const reviewed = metrics.find((metric) => metric.label === "Reviewed");
  const pending = metrics.find((metric) => metric.label === "Pending");
  const groupedLabels = new Set([active?.label, reviewed?.label, pending?.label]);
  const remainingMetrics = metrics.filter((metric) => !groupedLabels.has(metric.label));

  if (!active || !reviewed || !pending) {
    return (
      <span className={fallbackClassName}>
        {metrics.map((metric) => (
          <StatusMetricBox key={metric.label} metric={metric} tone={tone} />
        ))}
      </span>
    );
  }

  return (
    <span className="grid gap-1.5">
      {remainingMetrics.length ? (
        <span className="grid grid-cols-2 gap-1.5">
          {remainingMetrics.map((metric) => (
            <StatusMetricBox key={metric.label} metric={metric} tone={tone} />
          ))}
        </span>
      ) : null}
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
  onFinancialSanctionPendingClick,
  onFinancialSanctionCompletedClick,
  onBgExpiredClick,
  onBgToBeReturnedClick,
  onBgReturnedClick,
  onAdvancePaidClick,
  onAdvancePendingClick,
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
    financialSanctionPending?: number;
    financialSanctionCompleted?: number;
    bgExpired?: number;
    bgToBeReturned?: number;
    bgReturned?: number;
    advancePaid?: number;
    advancePending?: number;
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
  onFinancialSanctionPendingClick: () => void;
  onFinancialSanctionCompletedClick: () => void;
  onBgExpiredClick: () => void;
  onBgToBeReturnedClick: () => void;
  onBgReturnedClick: () => void;
  onAdvancePaidClick: () => void;
  onAdvancePendingClick: () => void;
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

  if (["highValue", "tcec"].includes(milestone.key)) {
    return [total, completed, active, reviewed, pending];
  }

  if (["ifa", "postTcec", "cnc"].includes(milestone.key)) {
    return [total, completed, previous, active, reviewed, pending];
  }

  if (["ad", "rqa"].includes(milestone.key)) {
    return [total, completed, active, reviewed, pending];
  }

  if (milestone.key === "financialSanction") {
    return [
      {
        label: "Completed",
        count: milestone.financialSanctionCompleted ?? milestone.cleared,
        onClick: onFinancialSanctionCompletedClick,
      },
      {
        label: "Pending",
        count: milestone.financialSanctionPending ?? milestone.pending,
        onClick: onFinancialSanctionPendingClick,
      },
      previous,
    ];
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
      {
        label: "At Previous Stage",
        count: milestone.underProcess,
        onClick: () => openSearchFilter("milestonePending:financialSanction"),
      },
    ];
  }

  if (isBgMilestoneKey(milestone.key)) {
    return [
      { label: milestone.pendingLabel, count: milestone.pending, onClick: onPendingClick },
      completed,
      {
        label: "Expired",
        count: milestone.bgExpired ?? 0,
        onClick: onBgExpiredClick,
      },
      {
        label: "To be returned",
        count: milestone.bgToBeReturned ?? 0,
        onClick: onBgToBeReturnedClick,
      },
      {
        label: "Returned",
        count: milestone.bgReturned ?? 0,
        onClick: onBgReturnedClick,
      },
    ];
  }

  if (milestone.key === "payment") {
    return [
      completed,
      { label: milestone.pendingLabel, count: milestone.pending, onClick: onPendingClick },
      {
        label: "Advance Paid",
        count: milestone.advancePaid ?? 0,
        onClick: onAdvancePaidClick,
      },
      {
        label: "Advance Pending",
        count: milestone.advancePending ?? 0,
        onClick: onAdvancePendingClick,
      },
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
  "financialSanction",
  "supplyOrder",
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
          <span className="flex flex-col gap-1.5">
            <span className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={onCompletedClick}
                className="rounded-md border border-border bg-card px-2 py-1 text-center hover:bg-accent hover:ring-2 hover:ring-ring/30"
              >
                <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
                  Delivery Completed
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
                  Delivery Pending
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
                  Delivery Overdue
                </span>
                <span className="block text-base font-semibold tabular-nums">
                  {milestone.overdue}
                </span>
              </button>
            </span>
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

function JobCompletionFlowNode({
  milestone,
  index,
  isLast,
  onJobCompletedClick,
  onJobDueClick,
}: {
  milestone: {
    key: string;
    label: string;
    jobCompleted: number;
    jobLive: number;
  };
  index: number;
  isLast: boolean;
  onJobCompletedClick: () => void;
  onJobDueClick: () => void;
}) {
  const tone = getMilestoneTone(milestone.jobLive);

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
	              onClick={onJobDueClick}
	              className={
	                "rounded-md px-2 py-1 text-center hover:ring-2 hover:ring-ring/30 " +
	                getMilestoneTone(milestone.jobLive).count
	              }
	            >
	              <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
	                Job Completion Due
	              </span>
	              <span className="block text-base font-semibold tabular-nums">{milestone.jobLive}</span>
	            </button>
	            <button
	              type="button"
              onClick={onJobCompletedClick}
              className="rounded-md border border-border bg-card px-2 py-1 text-center hover:bg-accent hover:ring-2 hover:ring-ring/30"
	            >
	              <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
	                Job Completion Done
	              </span>
              <span className="block text-base font-semibold tabular-nums">
                {milestone.jobCompleted}
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

function getModeCounts(files: ReturnType<typeof useAccessibleFiles>, configuredModes?: string[]) {
  const modes = getConfiguredModes(
    configuredModes,
    files.map((file) => file.mode),
  );
  const counts = files.reduce<Record<string, number>>((current, file) => {
    const mode = file.mode?.trim().toUpperCase();
    if (!mode) return current;
    current[mode] = (current[mode] ?? 0) + 1;
    return current;
  }, {});

  return modes.map((name) => ({ name, count: counts[name] ?? 0 }));
}

const gemBiddingModeOptions = ["Custom", "Catalogue", "Comparison"];

function getGemBiddingModeCounts(files: ReturnType<typeof useAccessibleFiles>) {
  const counts = files.reduce<Record<string, number>>((current, file) => {
    if (!isYes(file.gem)) return current;
    const mode = normalizeGemBiddingMode(file.gemBiddingMode);
    if (!mode) return current;
    current[mode] = (current[mode] ?? 0) + 1;
    return current;
  }, {});

  return gemBiddingModeOptions.map((name) => ({ name, count: counts[name] ?? 0 }));
}

function normalizeGemBiddingMode(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return gemBiddingModeOptions.find((mode) => mode.toLowerCase() === normalized);
}

function getConfiguredModes(
  configuredModes: string[] | undefined,
  existingModes: Array<string | undefined>,
) {
  const defaults = ["OBM", "PBM", "SBM", "LBM", "LPC"];
  const seen = new Set<string>();
  return [...(configuredModes?.length ? configuredModes : defaults), ...existingModes]
    .map((mode) => mode?.trim().toUpperCase() ?? "")
    .filter((mode) => {
      if (!mode) return false;
      if (seen.has(mode)) return false;
      seen.add(mode);
      return true;
    });
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
  { key: "bg", label: "Warranty", yesLabel: "Warranty", noLabel: "Non Warranty" },
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
        value: files.filter((file) => isSnapshotAttributeYes(file, attribute.key)).length,
        searchFilter: `attribute:${attribute.key}:yes`,
      },
      {
        label: attribute.noLabel,
        value: files.filter((file) => !isSnapshotAttributeYes(file, attribute.key)).length,
        searchFilter: `attribute:${attribute.key}:no`,
      },
    ],
    hint: `${attribute.yesLabel} and ${attribute.noLabel} files`,
  }));
}

function isSnapshotAttributeYes(file: FileRecord, key: string) {
  if (key === "psb") return isPsbApplicableFile(file);
  return isYes(String(file[key as keyof FileRecord] ?? ""));
}

function isPsbApplicableFile(file: FileRecord) {
  return rawSupplyOrders(file).some(
    (order) =>
      !isSupplyOrderCancelled(file, order) &&
      isYes(order.psbApplicable) &&
      (order.bgCoverageType === "PSB" || order.bgCoverageType === "PSB and PWB separately"),
  );
}

function getFileTypeSummaryStats(
  files: ReturnType<typeof useAccessibleFiles>,
  fileTypes: string[] | undefined,
): SummaryStat {
  return {
    label: "File Type",
    value: getConfiguredFileTypes(fileTypes, files).map((fileType) => ({
      label: fileType,
      value: files.filter((file) => isFileTypeMatch(file, fileType)).length,
      searchFilter: `fileType:${encodeURIComponent(fileType)}`,
    })),
    hint: "Files grouped by file type",
  };
}

function getConfiguredFileTypes(
  fileTypes: string[] | undefined,
  files: ReturnType<typeof useAccessibleFiles>,
) {
  const seen = new Set<string>();
  const values = [...(fileTypes ?? []), ...files.map((file) => file.fileType ?? "")]
    .map((fileType) => fileType.trim())
    .filter((fileType) => {
      const key = fileType.toLowerCase();
      if (!fileType || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return values.length ? values : ["Goods & Services", "AMC", "MPC", "CARS", "O&M"];
}

function isFileTypeMatch(file: FileRecord, fileType: string) {
  return (file.fileType ?? "").trim().toLowerCase() === fileType.trim().toLowerCase();
}

function getFirmTypeSummaryStats(
  files: ReturnType<typeof useAccessibleFiles>,
  firmTypes: string[] | undefined,
): SummaryStat {
  return {
    label: "Firm Type",
    value: getConfiguredFirmTypes(firmTypes).map((firmType) => ({
      label: firmType,
      value: files.filter((file) =>
        fileSupplyOrders(file).some((order) => isFirmTypeMatch(order, firmType)),
      ).length,
      searchFilter: `firmType:${encodeURIComponent(firmType)}`,
    })),
    hint: "Files grouped by supply order firm type",
  };
}

function getConfiguredFirmTypes(firmTypes: string[] | undefined) {
  const defaults = ["MSE", "MSE (Women)", "Non-MSE"];
  const seen = new Set<string>();
  return (firmTypes?.length ? firmTypes : defaults)
    .map((firmType) => firmType.trim())
    .filter((firmType) => {
      if (!firmType) return false;
      const key = firmType.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isFirmTypeMatch(order: SupplyOrderDetail, firmType: string) {
  const expected = firmType.trim().toUpperCase();
  return (
    order.firmType?.trim().toUpperCase() === expected ||
    order.firmTypeOther?.trim().toUpperCase() === expected
  );
}

function getMiscellaneousCounts(files: ReturnType<typeof useAccessibleFiles>) {
  const activeFiles = files.filter((file) => !isCancelledFile(file));
  return {
    liveFiles: activeFiles.filter(isLiveFile).length,
    fileClosed: activeFiles.filter(isFileClosed).length,
    ld: countLdOrders(activeFiles),
    demandCancelled: files.filter((file) => isYes(file.demandCancelled)).length,
    soCancelled: files.filter((file) =>
      fileSupplyOrders(file).some((order) => isYes(order.soCancelled)),
    ).length,
    shortclosedSo: files.filter((file) =>
      fileSupplyOrders(file).some((order) => isYes(order.shortclosure)),
    ).length,
    multipleSupplyOrders: activeFiles.filter((file) => countExpectedSupplyOrderRows(file) > 1)
      .length,
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
    firmAnalysis: getFirmAnalysisRows(files),
    topIndentorsByFiles: getTopIndentorsByFiles(files),
    topIndentorsByValue: getTopIndentorsByValue(files),
    milestoneClearingRanking: getMilestoneClearingRanking(files),
    monthlyFileInflow: getMonthlyFileInflow(files),
    monthWiseSupplyOrder: getMonthWiseSupplyOrder(files),
    monthWiseDeliverySchedule: getMonthWiseDeliverySchedule(files),
    monthWiseBgExpiry: getMonthWiseBgExpiry(files),
    biddingModeMix: getBiddingModeMix(files),
    fileValueThresholds: getFileValueThresholds(files, valueThresholdLevels),
    divisionRiskRanking: getDivisionRiskRanking(files),
    divisionPaymentPendingRanking: getDivisionPaymentPendingRanking(files),
    tcecStatus: getTcecStatusSummary(files),
    cncSummary: getCncSummary(files),
  };
}

function getCncSummary(files: FileRecord[]) {
  const rows = new Map<
    string,
    {
      name: string;
      cncDate: string;
      reviewed: number;
      approved: number;
      financialSanctionSigned: number;
      supplyOrderPlaced: number;
      approvalPending: number;
      financialSanctionPending: number;
      supplyOrderPending: number;
    }
  >();
  files.forEach((file) => {
    if (!hasFilledString(file.cncDate)) return;
    const cncDate = file.cncDate!;
    const approved = hasFilledString(file.cncApprovalDate);
    const financialSanctionSigned = hasOrderFinancialSanctionCompleted(file);
    const supplyOrderPlaced = hasPlacedSupplyOrder(file);
    const current =
      rows.get(cncDate) ??
      {
        name: cncDate,
        cncDate,
        reviewed: 0,
        approved: 0,
        financialSanctionSigned: 0,
        supplyOrderPlaced: 0,
        approvalPending: 0,
        financialSanctionPending: 0,
        supplyOrderPending: 0,
      };
    current.reviewed += 1;
    current.approved += approved ? 1 : 0;
    current.financialSanctionSigned += financialSanctionSigned ? 1 : 0;
    current.supplyOrderPlaced += supplyOrderPlaced ? 1 : 0;
    current.approvalPending += approved ? 0 : 1;
    current.financialSanctionPending += approved && !financialSanctionSigned ? 1 : 0;
    current.supplyOrderPending += financialSanctionSigned && !supplyOrderPlaced ? 1 : 0;
    rows.set(cncDate, current);
  });
  return Array.from(rows.values()).sort((a, b) => b.cncDate.localeCompare(a.cncDate));
}

function getFiscalYearSummaryRows<T extends Record<string, unknown>>(
  rows: T[],
  dateKey: keyof T,
  metricKeys: string[],
) {
  const totals = new Map<string, Record<string, number | string>>();
  rows.forEach((row) => {
    const date = String(row[dateKey] ?? "");
    const fiscalYear =
      dateKey === "monthKey" ? getFiscalYearForMonthKey(date) : getFinancialYearForDate(date);
    if (!fiscalYear) return;
    const current = totals.get(fiscalYear) ?? {
      name: fiscalYear,
      fiscalYear,
    };
    metricKeys.forEach((key) => {
      current[key] = Number(current[key] ?? 0) + Number(row[key] ?? 0);
    });
    totals.set(fiscalYear, current);
  });
  return Array.from(totals.values()).sort((a, b) =>
    String(b.fiscalYear ?? "").localeCompare(String(a.fiscalYear ?? "")),
  );
}

function getTcecCommitteeRowsForFiscalYear(
  rows: Array<{
    committee: string;
    meetingDate: string;
    stage: TcecStatusStage;
    reviewed: number;
    signed: number;
    pending: number;
  }>,
  fiscalYear: string,
) {
  const totals = new Map<string, { name: string; stage: TcecStatusStage; fiscalYear: string; reviewed: number; signed: number; pending: number }>();
  rows
    .filter((row) => getFinancialYearForDate(row.meetingDate) === fiscalYear)
    .forEach((row) => {
      const current = totals.get(row.committee) ?? {
        name: row.committee,
        stage: row.stage,
        fiscalYear,
        reviewed: 0,
        signed: 0,
        pending: 0,
      };
      current.reviewed += row.reviewed;
      current.signed += row.signed;
      current.pending += row.pending;
      totals.set(row.committee, current);
    });
  return Array.from(totals.values()).sort((a, b) => b.reviewed - a.reviewed || a.name.localeCompare(b.name));
}

function getTcecStatusSummary(files: FileRecord[]) {
  return {
    pre: getTcecStageStatus(files, "pre"),
    post: getTcecStageStatus(files, "post"),
  };
}

function getTcecStageStatus(files: FileRecord[], stage: TcecStatusStage) {
  const committeeRows = new Map<string, { reviewed: number; signed: number; pending: number }>();
  const meetingRows = new Map<
    string,
    {
      name: string;
      committee: string;
      meetingDate: string;
      stage: TcecStatusStage;
      reviewed: number;
      signed: number;
      pending: number;
    }
  >();
  files.forEach((file) => {
    const committee =
      stage === "pre" ? file.preTcecCommitteeNo?.trim() : file.postTcecCommitteeNumber?.trim();
    if (!committee) return;
    const minutesDate = stage === "pre" ? file.preTcecMinutesDate : file.postTcecMinutesDate;
    const meetingDate = stage === "pre" ? file.preTcecDate : file.postTcecDate;
    const signed = hasFilledString(minutesDate);
    const committeeCurrent = committeeRows.get(committee) ?? {
      reviewed: 0,
      signed: 0,
      pending: 0,
    };
    committeeCurrent.reviewed += 1;
    committeeCurrent.signed += signed ? 1 : 0;
    committeeCurrent.pending += signed ? 0 : 1;
    committeeRows.set(committee, committeeCurrent);
    if (!hasFilledString(meetingDate)) return;
    const meetingKey = `${committee}\u0000${meetingDate}`;
    const meetingCurrent =
      meetingRows.get(meetingKey) ??
      {
        name: meetingDate!,
        committee,
        meetingDate: meetingDate!,
        stage,
        reviewed: 0,
        signed: 0,
        pending: 0,
      };
    meetingCurrent.reviewed += 1;
    meetingCurrent.signed += signed ? 1 : 0;
    meetingCurrent.pending += signed ? 0 : 1;
    meetingRows.set(meetingKey, meetingCurrent);
  });
  return {
    committees: Array.from(committeeRows.entries())
      .map(([name, counts]) => ({ name, stage, ...counts }))
      .sort((a, b) => b.reviewed - a.reviewed || a.name.localeCompare(b.name)),
    meetings: Array.from(meetingRows.values()).sort(
      (a, b) =>
        a.committee.localeCompare(b.committee) ||
        b.meetingDate.localeCompare(a.meetingDate) ||
        a.name.localeCompare(b.name),
    ),
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
    const committedCapital = isSoCancelledFile(file) ? 0 : getFileCommittedCapitalValue(file);
    const committedRevenue = isSoCancelledFile(file) ? 0 : getFileCommittedRevenueValue(file);
    totals.set(name, {
      allocatedCapital: current.allocatedCapital,
      allocatedRevenue: current.allocatedRevenue,
      intendedCapital:
        current.intendedCapital + (!hasFilledField(file, "imms") ? demandCapital : 0),
      intendedRevenue:
        current.intendedRevenue + (!hasFilledField(file, "imms") ? demandRevenue : 0),
      bookedCapital:
        current.bookedCapital +
        (!cancelled && hasFilledField(file, "imms") && committedCapital <= 0 ? demandCapital : 0),
      bookedRevenue:
        current.bookedRevenue +
        (!cancelled && hasFilledField(file, "imms") && committedRevenue <= 0 ? demandRevenue : 0),
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
      if (isSupplyOrderCancelled(file, order)) return;
      const name = getAnalyticsName(order.firm, "Unassigned firm");
      const value = getSupplyOrderTotalValue(file, order);
      if (value <= 0) return;
      totals.set(name, (totals.get(name) ?? 0) + value);
    });
  });
  return mapEntriesToSortedRows(totals, "value");
}

function getFirmAnalysisRows(files: FileRecord[]) {
  const rows = new Map<
    string,
    {
      name: string;
      bq: number;
      invited: number;
      participated: number;
      order: number;
      roleMaskCounts: string;
    }
  >();
  const getRow = (name: string) =>
    rows.get(name) ?? {
      name,
      bq: 0,
      invited: 0,
      participated: 0,
      order: 0,
      roleMaskCounts: "{}",
    };
  files.forEach((file) => {
    const roles = getFileFirmAnalysisRoles(file);
    const firmNames = new Set<string>();
    Object.values(roles).forEach((set) => set.forEach((name) => firmNames.add(name)));
    firmNames.forEach((name) => {
      const row = getRow(name);
      const mask = getFirmAnalysisRoleMask(roles, name);
      const roleMaskCounts = readFirmAnalysisRoleMaskCounts(row.roleMaskCounts);
      roleMaskCounts[mask] = (roleMaskCounts[mask] ?? 0) + 1;
      row.bq += roles.bq.has(name) ? 1 : 0;
      row.invited += roles.invited.has(name) ? 1 : 0;
      row.participated += roles.participated.has(name) ? 1 : 0;
      row.order += roles.order.has(name) ? 1 : 0;
      row.roleMaskCounts = JSON.stringify(roleMaskCounts);
      rows.set(name, row);
    });
  });
  return Array.from(rows.values()).sort(
    (a, b) =>
      b.order - a.order ||
      b.participated - a.participated ||
      b.invited - a.invited ||
      a.name.localeCompare(b.name),
  );
}

function getFirmAnalysisSelectedRoleCount(
  row: Record<string, number | string>,
  roles: FirmAnalysisRoleKey[],
  operators: Record<string, FirmAnalysisOperator>,
  negatedRoles: FirmAnalysisRoleKey[],
) {
  if (!roles.length) return 0;
  const orderedRoles = getSelectedFirmAnalysisRoles(roles);
  const counts = readFirmAnalysisRoleMaskCounts(String(row.roleMaskCounts ?? "{}"));
  const negated = new Set(negatedRoles);
  return Object.entries(counts).reduce((total, [rawMask, count]) => {
    const mask = Number(rawMask);
    if (!Number.isFinite(mask)) return total;
    const matches = evaluateFirmAnalysisExpression(mask, orderedRoles, operators, negated);
    return matches ? total + count : total;
  }, 0);
}

function getSelectedFirmAnalysisRoles(roles: FirmAnalysisRoleKey[]) {
  return firmAnalysisRoleOptions
    .map((role) => role.key)
    .filter((role) => roles.includes(role));
}

function evaluateFirmAnalysisExpression(
  mask: number,
  roles: FirmAnalysisRoleKey[],
  operators: Record<string, FirmAnalysisOperator>,
  negatedRoles: Set<FirmAnalysisRoleKey>,
) {
  if (!roles.length) return false;
  let result = getFirmAnalysisRoleBoolean(mask, roles[0], negatedRoles);
  for (let index = 1; index < roles.length; index++) {
    const previousRole = roles[index - 1];
    const role = roles[index];
    const operator = operators[firmAnalysisOperatorKey(previousRole, role)] ?? "and";
    const value = getFirmAnalysisRoleBoolean(mask, role, negatedRoles);
    result = operator === "and" ? result && value : result || value;
  }
  return result;
}

function getFirmAnalysisRoleBoolean(
  mask: number,
  role: FirmAnalysisRoleKey,
  negatedRoles: Set<FirmAnalysisRoleKey>,
) {
  const value = Boolean(mask & firmAnalysisRoleBit(role));
  return negatedRoles.has(role) ? !value : value;
}

function getFirmAnalysisExpression(
  roles: FirmAnalysisRoleKey[],
  operators: Record<string, FirmAnalysisOperator>,
  negatedRoles: FirmAnalysisRoleKey[],
) {
  const orderedRoles = getSelectedFirmAnalysisRoles(roles);
  const negated = new Set(negatedRoles);
  return orderedRoles
    .flatMap((role, index) => {
      const nextRole = orderedRoles[index + 1];
      const roleToken = negated.has(role) ? `not.${role}` : role;
      return nextRole ? [roleToken, operators[firmAnalysisOperatorKey(role, nextRole)] ?? "and"] : [roleToken];
    })
    .join(",");
}

function getFirmAnalysisExpressionLabel(
  roles: FirmAnalysisRoleKey[],
  operators: Record<string, FirmAnalysisOperator>,
  negatedRoles: FirmAnalysisRoleKey[],
) {
  const orderedRoles = getSelectedFirmAnalysisRoles(roles);
  const negated = new Set(negatedRoles);
  return orderedRoles
    .flatMap((role, index) => {
      const option = firmAnalysisRoleOptions.find((item) => item.key === role);
      const label = `${negated.has(role) ? "NOT " : ""}${option?.label ?? role}`;
      const nextRole = orderedRoles[index + 1];
      return nextRole
        ? [label, (operators[firmAnalysisOperatorKey(role, nextRole)] ?? "and").toUpperCase()]
        : [label];
    })
    .join(" ");
}

function firmAnalysisOperatorKey(leftRole: FirmAnalysisRoleKey, rightRole: FirmAnalysisRoleKey) {
  return `${leftRole}:${rightRole}`;
}

function readFirmAnalysisRoleMaskCounts(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([mask, count]) => [mask, Number(count)])
        .filter(([, count]) => Number.isFinite(count)),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

function getFirmAnalysisRoleMask(
  roles: ReturnType<typeof getFileFirmAnalysisRoles>,
  firmName: string,
) {
  return firmAnalysisRoleOptions.reduce(
    (mask, role) => (roles[role.key].has(firmName) ? mask | firmAnalysisRoleBit(role.key) : mask),
    0,
  );
}

function firmAnalysisRoleBit(role: FirmAnalysisRoleKey) {
  return role === "bq"
    ? 1
    : role === "invited"
      ? 2
      : role === "participated"
        ? 4
        : 8;
}

function getFileFirmAnalysisRoles(file: FileRecord) {
  const biddingApplicable = isBiddingApplicableForFile(file);
  const bq = biddingApplicable ? getFirmNameSet(file.bqFirms) : new Set<string>();
  const invited = biddingApplicable ? getFirmNameSet(file.invitedFirms) : new Set<string>();
  const participated = biddingApplicable ? getFirmNameSet(file.bidderFirms) : new Set<string>();
  const order = new Set<string>();
  fileSupplyOrders(file).forEach((orderRow) => {
    if (isSupplyOrderCancelled(file, orderRow)) return;
    const name = normalizeFirmAnalysisName(orderRow.firm);
    if (name) order.add(name);
  });
  return { bq, invited, participated, order };
}

function getFirmNameSet(rows: Array<{ firmName?: string }> | undefined) {
  const names = new Set<string>();
  (rows ?? []).forEach((row) => {
    const name = normalizeFirmAnalysisName(row.firmName);
    if (name) names.add(name);
  });
  return names;
}

function normalizeFirmAnalysisName(value: string | undefined) {
  return value?.trim() || "";
}

function getSupplyOrderValueDistributionByFirmType(
  files: FileRecord[],
  configuredFirmTypes: string[] | undefined,
) {
  const totals = new Map<string, number>();
  effectiveSupplyOrderEntries(files).forEach(({ file, order }) => {
    if (isSupplyOrderCancelled(file, order)) return;
    const value = getSupplyOrderTotalValue(file, order);
    if (value <= 0) return;
    const name = getFirmTypeDistributionName(order, configuredFirmTypes);
    totals.set(name, (totals.get(name) ?? 0) + value);
  });
  return mapDistributionEntriesToRows(totals);
}

function getActualPaymentDistributionByFirmType(
  files: FileRecord[],
  configuredFirmTypes: string[] | undefined,
) {
  const totals = new Map<string, number>();
  effectivePaymentEntries(files).forEach(({ file, order }) => {
    if (isSupplyOrderCancelled(file, order)) return;
    const value =
      (getInrAmount(order.actualPaymentCapital, file) ?? 0) +
      (getInrAmount(order.actualPaymentRevenue, file) ?? 0);
    if (value <= 0) return;
    const name = getFirmTypeDistributionName(order, configuredFirmTypes);
    totals.set(name, (totals.get(name) ?? 0) + value);
  });
  return mapDistributionEntriesToRows(totals);
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
      const durations = getMilestoneClearingDurations(files, definition);
      return {
        name: definition.name,
        averageDays: getRoundedAverage(durations),
        sampleSize: durations.length,
      };
    })
    .filter((item) => item.sampleSize > 0)
    .sort((a, b) => b.averageDays - a.averageDays);
}

function getMilestoneClearingDurations(
  files: FileRecord[],
  definition: (typeof milestoneClearingDefinitions)[number],
) {
  if (definition.name === "Delivery") {
    return files.flatMap((file) =>
      isDeliveryInspectionApplicable(file)
        ? fileSupplyOrders(file)
            .filter((order) => !isSupplyOrderCancelled(file, order))
            .map((order) =>
              getDayDifference(
                order.deliveryPeriodStartDate || order.soDate,
                order.materialReceiptDate,
              ),
            )
            .filter((days): days is number => days !== undefined && days >= 0)
        : [],
    );
  }
  if (definition.name === "Payment") {
    return files.flatMap((file) =>
      effectivePaymentEntries([file])
        .filter(({ file: entryFile, order }) => !isSupplyOrderCancelled(entryFile, order))
        .map(({ order }) => order)
        .map((order) =>
          getDayDifference(getPaymentWorkflowStartDate(file, order), order.paymentDate),
        )
        .filter((days): days is number => days !== undefined && days >= 0),
    );
  }
  if (definition.name === "Supply Order") {
    return files.flatMap((file) =>
      rawSupplyOrders(file)
        .filter((order) => !isSupplyOrderCancelled(file, order))
        .map((order) => getDayDifference(file.cfaDate, order.soDate))
        .filter((days): days is number => days !== undefined && days >= 0),
    );
  }
  return files
    .map((file) => getDayDifference(definition.getStartDate(file), definition.getEndDate(file)))
    .filter((days): days is number => days !== undefined && days >= 0);
}

function getMonthlyFileInflow(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const month = getMonthKey(file.receivedDate);
    if (!month) return;
    counts.set(month, (counts.get(month) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([name, count]) => ({ name, count }));
}

function getMonthWiseSupplyOrder(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    if (isCancelledFile(file)) return;
    rawSupplyOrders(file).forEach((order) => {
      if (isSupplyOrderCancelled(file, order)) return;
      const month = getMonthKey(order.soDate);
      if (!month) return;
      counts.set(month, (counts.get(month) ?? 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, count, monthKey: name }));
}

function getMonthWiseDeliverySchedule(files: FileRecord[]) {
  const rows = new Map<string, { grossCount: number; netCount: number }>();
  effectiveSupplyOrderEntries(files).forEach(({ file, order }) => {
    if (isCancelledFile(file) || isSupplyOrderCancelled(file, order)) return;
    const month = getMonthKey(getDeliveryPeriodDate(order));
    if (!month) return;
    const current = rows.get(month) ?? { grossCount: 0, netCount: 0 };
    current.grossCount += 1;
    if (!isDeliveryFructified(file, order)) current.netCount += 1;
    rows.set(month, current);
  });

  return Array.from(rows.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, counts]) => ({ name, monthKey: name, ...counts }));
}

function getMonthWiseBgExpiry(files: FileRecord[]) {
  const rows = new Map<string, { psb: number; pwb: number; psbPwb: number; count: number }>();
  const categories = ["psb", "pwb", "psbpwb"] as const;
  rawSupplyOrderEntries(files).forEach(({ file, order }) => {
    categories.forEach((category) => {
      if (
        !isBgCategoryApplicable(file, order, category) ||
        !isBgReceivedOrder(order, category) ||
        hasFilledString(getBgReturnDate(order, category))
      ) {
        return;
      }
      const month = getMonthKey(getBgValidityDate(order, category));
      if (!month) return;
      const current = rows.get(month) ?? { psb: 0, pwb: 0, psbPwb: 0, count: 0 };
      if (category === "psb") current.psb += 1;
      if (category === "pwb") current.pwb += 1;
      if (category === "psbpwb") current.psbPwb += 1;
      current.count += 1;
      rows.set(month, current);
    });
  });

  return Array.from(rows.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, counts]) => ({ name, monthKey: name, ...counts }));
}

function isDeliveryFructified(file: FileRecord, order: SupplyOrderDetail) {
  return (
    (isDeliveryInspectionApplicable(file) && hasFilledString(order.materialReceiptDate)) ||
    (!isDeliveryInspectionApplicable(file) && isJobCompletionDone(order)) ||
    (order.completedMilestones ?? []).some(
      (milestone) => normalizeMilestoneName(milestone) === "delivery",
    )
  );
}

function isJobCompletionDone(order: SupplyOrderDetail) {
  return hasFilledString(order.jobCompletionDate);
}

function isBillPreparationCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  if (hasFilledString(order.billPreparationDate)) return false;
  if (isDeliveryInspectionApplicable(file)) {
    return isYes(file.ir) && hasFilledString(order.irReceiptDate);
  }
  return isJobCompletionDone(order);
}

function getDeliveryCompletionMonthDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  return isJobCompletionDone(order) ? getDeliveryPeriodDate(order) : undefined;
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
    const riskCount = getRiskRowCount(file);
    if (!riskCount) return;
    const name = getAnalyticsName(file.division, "Unassigned");
    counts.set(name, (counts.get(name) ?? 0) + riskCount);
  });
  return mapEntriesToSortedRows(counts, "count");
}

function getDivisionPaymentPendingRanking(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const pendingCount = getPaymentPendingRowCount(file);
    if (!pendingCount) return;
    const name = getAnalyticsName(file.division, "Unassigned");
    counts.set(name, (counts.get(name) ?? 0) + pendingCount);
  });
  return mapEntriesToSortedRows(counts, "count");
}

function getRiskRowCount(file: FileRecord) {
  if (isCancelledFile(file)) return isYes(file.demandCancelled) ? 1 : 0;
  const deliveryRiskCount = fileSupplyOrders(file).filter(
    (order) =>
      !isSupplyOrderCancelled(file, order) &&
      (isPendingDeliveryOrder(file, order) || isExpiredDeliveryPeriodEntry(file, order)),
  ).length;
  const orderRiskCount = fileSupplyOrders(file).filter(
    (order) => isYes(order.ld) || isYes(order.soCancelled),
  ).length;
  return (isYes(file.demandCancelled) ? 1 : 0) + deliveryRiskCount + orderRiskCount;
}

function getPaymentPendingRowCount(file: FileRecord) {
  if (isCancelledFile(file)) return 0;
  return effectivePaymentEntries([file]).filter(
    ({ file: entryFile, order }) =>
      !isSupplyOrderCancelled(entryFile, order) &&
      hasPaymentWorkflowStarted(file, order) &&
      !hasFilledString(order.paymentDate),
  ).length;
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
    getStartDate: (file: FileRecord) => file.adSentDate,
    getEndDate: (file: FileRecord) => file.adVettingDate,
  },
  {
    name: "R&QA",
    getStartDate: (file: FileRecord) => file.rqaSentDate,
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
  const orders = fileSupplyOrders(file).filter(
    (order) => !isYes(order.soCancelled) && !isYes(order.shortclosure),
  );
  if (orders.length) {
    return orders.reduce((sum, order) => sum + (getInrAmount(order.soValueCapital, file) ?? 0), 0);
  }
  return isYes(file.soCancelled) ? 0 : (getInrAmount(file.soValueCapital, file) ?? 0);
}

function getFileCommittedRevenueValue(file: FileRecord) {
  const orders = fileSupplyOrders(file).filter(
    (order) => !isYes(order.soCancelled) && !isYes(order.shortclosure),
  );
  if (orders.length) {
    return orders.reduce((sum, order) => sum + (getInrAmount(order.soValueRevenue, file) ?? 0), 0);
  }
  return isYes(file.soCancelled) ? 0 : (getInrAmount(file.soValueRevenue, file) ?? 0);
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

function mapDistributionEntriesToRows(values: Map<string, number>) {
  const total = Array.from(values.values()).reduce((sum, value) => sum + value, 0);
  return Array.from(values.entries())
    .map(([name, value]) => ({
      name,
      value: Math.round(value),
      share: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function getFirmTypeDistributionName(
  order: SupplyOrderDetail,
  configuredFirmTypes: string[] | undefined,
) {
  const configured = getConfiguredFirmTypes(configuredFirmTypes);
  const raw = order.firmTypeOther?.trim() || order.firmType?.trim() || "";
  if (!raw) return "Unassigned firm type";
  const configuredMatch = configured.find(
    (firmType) => firmType.toLowerCase() === raw.toLowerCase(),
  );
  return configuredMatch ?? raw;
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

function formatMonthKeyLabel(monthKey: string) {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthKey;
  const [, year, monthText] = match;
  const monthIndex = Number(monthText) - 1;
  const monthNames = [
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
  ];
  return monthNames[monthIndex] ? `${monthNames[monthIndex]}-${year}` : monthKey;
}

function getFiscalYearForMonthKey(monthKey: string) {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return undefined;
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
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
  return effectivePaymentEntries([file]).some(
    ({ file: entryFile, order }) =>
      hasPaymentWorkflowStarted(file, order) &&
      !hasFilledString(order.paymentDate) &&
      !isSupplyOrderCancelled(entryFile, order),
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
    reviewed: "adSentDate",
    current: "adVettingDate",
    applies: (file) => isYes(file.ad),
  },
  {
    key: "rqa",
    label: "R&QA",
    totalLabel: "Total cases",
    reviewed: "rqaSentDate",
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
    applies: (file) => isBiddingApplicableForFile(file),
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
    key: "financialSanction",
    label: "Financial Sanction",
    completedLabel: "Completed",
    totalLabel: "Total files",
    pendingLabel: "Pending",
    current: "financialSanctionDate",
  },
  {
    key: "supplyOrder",
    label: "Supply Order",
    completedLabel: "Placed",
    totalLabel: "Total files",
    current: "soDate",
  },
  {
    key: "psb",
    label: "PSB",
    completedLabel: "Received",
    totalLabel: "Total files",
    current: "psbBgReceivedDate",
  },
  {
    key: "pwb",
    label: "PWB",
    completedLabel: "Received",
    totalLabel: "Total files",
    current: "pwbBgReceivedDate",
    applies: (file) => isYes(file.bg),
  },
  {
    key: "psbPwb",
    label: "PSB+PWB",
    completedLabel: "Received",
    totalLabel: "Total files",
    current: "combinedBgReceivedDate",
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
  "Financial Sanction",
  "Supply Order",
  "Delivery Period",
  "PSB",
  "PWB",
  "PSB+PWB",
  "Delivery",
  "Job Completion",
  "Bill sent for payment",
  "Advance Payment",
  "Payment",
  fileClosedMilestone,
];
const protectedLiveStatusMilestones = ["Job Completion"];

function getConfiguredMilestones(milestones: string[] | undefined) {
  const values = (milestones ?? [])
    .map((item) => normalizeConfiguredMilestoneLabel(item.trim()))
    .filter(Boolean);
  const configured = values.length ? values : defaultManualMilestones;
  return appendFileClosedMilestone(
    insertAdvancePaymentMilestone(insertBillSentMilestone(insertJobCompletionMilestone(configured))),
  );
}

function appendFileClosedMilestone(milestones: string[]) {
  const withoutFileClosed = milestones.filter(
    (milestone) =>
      normalizeMilestoneName(milestone) !== normalizeMilestoneName(fileClosedMilestone),
  );
  return [...withoutFileClosed, fileClosedMilestone];
}

function insertBillSentMilestone(milestones: string[]) {
  const hasBillSent = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "billsentforpayment",
  );
  const paymentIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "payment",
  );
  if (hasBillSent || paymentIndex === -1) return milestones;
  return [
    ...milestones.slice(0, paymentIndex),
    "Bill sent for payment",
    ...milestones.slice(paymentIndex),
  ];
}

function insertAdvancePaymentMilestone(milestones: string[]) {
  const hasAdvancePayment = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "advancepayment",
  );
  const paymentIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "payment",
  );
  if (hasAdvancePayment || paymentIndex === -1) return milestones;
  return [
    ...milestones.slice(0, paymentIndex),
    "Advance Payment",
    ...milestones.slice(paymentIndex),
  ];
}

function insertJobCompletionMilestone(milestones: string[]) {
  const hasJobCompletion = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "jobcompletion",
  );
  const deliveryIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "delivery",
  );
  if (hasJobCompletion || deliveryIndex === -1) return milestones;
  return [
    ...milestones.slice(0, deliveryIndex + 1),
    "Job Completion",
    ...milestones.slice(deliveryIndex + 1),
  ];
}

function normalizeConfiguredMilestoneLabel(milestone: string) {
  return normalizeMilestoneName(milestone) === "controlled" ? "Controlling" : milestone;
}

function getVisibleLiveMilestoneNames(
  liveMilestones: string[] | undefined,
  manualMilestoneFlow: Array<{ name: string }>,
) {
  const available = new Set(manualMilestoneFlow.map((milestone) => milestone.name));
  const visible = (
    liveMilestones?.filter((name) => available.has(name)) ??
    manualMilestoneFlow.map((milestone) => milestone.name)
  ).filter(Boolean);
  protectedLiveStatusMilestones.forEach((milestone) => {
    if (available.has(milestone) && !visible.includes(milestone)) visible.push(milestone);
  });
  return visible;
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
    current: getManualMilestoneCurrentCount(files, name),
    completed: getManualMilestoneCompletedCount(files, name),
  }));
}

function getManualMilestoneCurrentCount(files: FileRecord[], name: string) {
  const normalized = normalizeMilestoneName(name);
  if (isBgMilestoneKey(normalized)) return countBgPendingOrders(files, normalized);
  if (isSupplyOrderDrivenMilestoneName(name)) {
    return countCurrentSupplyOrderMilestoneStatuses(files, normalized);
  }
  return files.filter((file) => !isCancelledFile(file) && file.currentMilestone === name).length;
}

function getManualMilestoneCompletedCount(files: FileRecord[], name: string) {
  const normalized = normalizeMilestoneName(name);
  if (isBgMilestoneKey(normalized)) return countBgReceivedOrders(files, normalized);
  if (isSupplyOrderDrivenMilestoneName(name)) {
    return countCompletedSupplyOrderMilestoneStatuses(files, normalized);
  }
  return files.filter((file) => !isCancelledFile(file) && file.completedMilestones?.includes(name))
    .length;
}

function countFinancialSanctionPreviousStageFiles(files: FileRecord[]) {
  return files.filter(isFinancialSanctionPreviousStageFile).length;
}

function isFinancialSanctionPreviousStageFile(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  if (matchesCompletedSupplyOrderDrivenMilestone(file, "financialsanction")) return false;
  if (matchesCurrentSupplyOrderDrivenMilestone(file, "financialsanction")) return false;
  const current = normalizeMilestoneName(file.currentMilestone);
  if (isYes(file.tcec)) return current === "cnc" && !hasFilledField(file, "cncApprovalDate");
  return isBiddingApplicableForFile(file)
    ? current === "bidding" && !isYes(file.biddingStageOver)
    : current === "cfa" && !hasFilledField(file, "cfaDate");
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

    if (milestone.key === "financialSanction") {
      const financialSanctionCompleted = countCompletedSupplyOrderMilestoneStatuses(
        applicableFiles,
        "financialsanction",
      );
      const financialSanctionPending = countCurrentSupplyOrderMilestoneStatuses(
        applicableFiles,
        "financialsanction",
      );
      const financialSanctionPreviousStage =
        countFinancialSanctionPreviousStageFiles(applicableFiles);
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: "Completed",
        totalLabel: milestone.totalLabel ?? "Total files",
        pendingLabel: "Pending",
        total: financialSanctionCompleted + financialSanctionPending,
        underProcess: financialSanctionPreviousStage,
        active: financialSanctionPending,
        pending: financialSanctionPending,
        reviewed: 0,
        hasReviewed: false,
        cleared: financialSanctionCompleted,
        activeLabel: "Pending",
        financialSanctionPending,
        financialSanctionCompleted,
      };
    }

    if (milestone.key === "supplyOrder") {
      const supplyOrderPreviousStage = countCurrentSupplyOrderMilestoneStatuses(
        applicableFiles,
        "financialsanction",
      );
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: milestone.completedLabel ?? "Completed",
        totalLabel: milestone.totalLabel ?? "Total",
        pendingLabel: getMilestonePendingLabel(milestone),
        total: countEffectiveSupplyOrders(applicableFiles),
        underProcess: supplyOrderPreviousStage,
        active: activeFiles.length,
        pending: countCurrentSupplyOrderMilestoneStatuses(applicableFiles, "supplyorder"),
        reviewed: reviewedFiles.length,
        hasReviewed: Boolean(milestone.reviewed),
        cleared: countPlacedSupplyOrders(files),
        activeLabel: "In process",
        liveSupplyOrders: countLiveSupplyOrders(files),
      };
    }

    if (isBgMilestoneKey(milestone.key)) {
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: milestone.completedLabel ?? "Completed",
        totalLabel: milestone.totalLabel ?? "Total files",
        pendingLabel: getMilestonePendingLabel(milestone),
        total: countBgApplicableOrders(files, milestone.key),
        underProcess: countAtPreviousStageFiles(applicableFiles, milestone),
        active: countBgPendingOrders(files, milestone.key),
        pending: countBgPendingOrders(files, milestone.key),
        reviewed: 0,
        hasReviewed: Boolean(milestone.reviewed),
        cleared: countBgReceivedOrders(files, milestone.key),
        bgExpired: countBgExpiredOrders(files, milestone.key),
        bgToBeReturned: countBgToBeReturnedOrders(files, milestone.key),
        bgReturned: countBgReturnedOrders(files, milestone.key),
        activeLabel: "In process",
      };
    }

    if (milestone.key === "payment") {
      const paymentCompleted = countPaymentCompletedOrders(files);
      const paymentPending = countPaymentPendingOrders(files);
      const advancePaid = countAdvancePaymentPaidOrders(files);
      const advancePending = countAdvancePaymentPendingOrders(files);
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: milestone.completedLabel ?? "Completed",
        totalLabel: milestone.totalLabel ?? "Total",
        pendingLabel: getMilestonePendingLabel(milestone),
        total: paymentCompleted + paymentPending,
        underProcess: countAtPreviousStageFiles(applicableFiles, milestone),
        active: activeFiles.length,
        pending: paymentPending,
        reviewed: reviewedFiles.length,
        hasReviewed: Boolean(milestone.reviewed),
        cleared: paymentCompleted,
        advancePaid,
        advancePending,
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
      underProcess: countAtPreviousStageFiles(applicableFiles, milestone),
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
    due: countDeliveryPendingOrders(files),
    overdue: countDeliveryOverdueOrders(files),
  };
  const jobCompletion = {
    key: "jobCompletion",
    label: "Job Completion",
    jobCompleted: countJobCompletionCompletedOrders(files),
    jobLive: countJobCompletionLiveOrders(files),
    jobPeriodOver: countJobCompletionPeriodOverOrders(files),
  };
  const ir = {
    key: "ir",
    label: "IR",
    irPreparationPending: countIrPreparationPendingOrders(files),
    irReceiptPending: countIrReceiptPendingOrders(files),
    irCompleted: countIrCompletedOrders(files),
  };
  const deliveryPeriod = {
    key: "deliveryPeriod",
    label: "Delivery Period / Milestone",
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
  const paymentIndex = withDeliveryPeriod.findIndex((milestone) => milestone.key === "payment");

  if (paymentIndex === -1) return [...withDeliveryPeriod, delivery, jobCompletion, ir];
  return [
    ...withDeliveryPeriod.slice(0, paymentIndex),
    delivery,
    jobCompletion,
    ir,
    ...withDeliveryPeriod.slice(paymentIndex),
  ];
}

function countAtPreviousStageFiles(
  files: FileRecord[],
  milestone: (typeof milestoneDefinitions)[number],
) {
  return files.filter((file) => isAtPreviousStageFile(file, milestone)).length;
}

function isAtPreviousStageFile(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (!isEligibleMilestone(file, milestone)) return false;
  if (isMilestoneComplete(file, milestone)) return false;
  if (isManualActiveMilestone(file, milestone)) return false;
  if (isMilestoneReviewed(file, milestone)) return false;
  if (milestone.key === "bidding" && (isFileTenderLive(file) || isBidOverdue(file))) return false;
  if (isSupplyOrderDrivenMilestoneName(milestone.label)) {
    const normalized = normalizeMilestoneName(milestone.label);
    if (countCurrentSupplyOrderMilestoneStatuses([file], normalized) > 0) return false;
    if (countCompletedSupplyOrderMilestoneStatuses([file], normalized) > 0) return false;
  }
  return true;
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
  if (isBgMilestoneKey(milestone.key)) {
    return fileSupplyOrders(file).some((order) =>
      isBgCategoryApplicable(file, order, milestone.key),
    );
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
  if (!isBiddingApplicableForFile(file)) return false;
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
  if (supplyOrderDateKeys.has(key as keyof SupplyOrderDetail)) {
    return fileSupplyOrders(file).some((order) => {
      const value = order[key as keyof SupplyOrderDetail];
      return typeof value === "string" && hasFilledString(value);
    });
  }
  return hasFilledField(file, key as keyof FileRecord);
}

const supplyOrderDateKeys = new Set<keyof SupplyOrderDetail>([
  "financialSanctionDate",
  "soDate",
  "psbBgReceivedDate",
  "psbBgValidityDate",
  "psbBgReturnDate",
  "pwbBgReceivedDate",
  "pwbBgValidityDate",
  "pwbBgReturnDate",
  "combinedBgReceivedDate",
  "combinedBgValidityDate",
  "combinedBgReturnDate",
  "warrantyPeriodDate",
  "jobCompletionDate",
  "irPreparationDate",
  "irReceiptDate",
  "billPreparationDate",
  "billSentForPaymentDate",
  "paymentDate",
  "soCancelledDate",
]);

function fileSupplyOrders(file: FileRecord) {
  return normalizedFileSupplyOrders(file);
}

function rawSupplyOrders(file: FileRecord) {
  return normalizedRawSupplyOrders(file);
}

function expectedSupplyOrders(file: FileRecord) {
  return normalizedExpectedSupplyOrders(file);
}

function rawSupplyOrderEntries(files: FileRecord[]) {
  return files.flatMap((file) => rawSupplyOrders(file).map((order) => ({ file, order })));
}

function hasFilledObjectValue(value: Record<string, unknown>) {
  return Object.values(value).some((item) => {
    if (Array.isArray(item)) return item.length > 0;
    return hasFilledString(String(item ?? ""));
  });
}

function effectiveSupplyOrderEntries(files: FileRecord[]) {
  return normalizedSupplyOrderEntries(files);
}

function effectivePaymentEntries(files: FileRecord[]) {
  return normalizedPaymentEntries(files).filter(
    ({ order }) => order.stageDeliveryLabel !== "Advance Payment",
  );
}

function isSupplyOrderCancelled(file: FileRecord, order: SupplyOrderDetail) {
  return isYes(file.demandCancelled) || isYes(order.soCancelled) || isYes(order.shortclosure);
}

function hasSupplyOrderValue(file: FileRecord, order: SupplyOrderDetail) {
  const capitalSelected = (getInrAmount(file.valueCapital, file) ?? 0) !== 0;
  const revenueSelected = (getInrAmount(file.valueRevenue, file) ?? 0) !== 0;
  if (capitalSelected) return hasFilledString(order.soValueCapital);
  if (revenueSelected) return hasFilledString(order.soValueRevenue);
  return hasFilledString(order.soValueCapital) || hasFilledString(order.soValueRevenue);
}

function isSupplyOrderTabComplete(file: FileRecord, order: SupplyOrderDetail) {
  if (!hasFilledString(order.soNo)) return false;
  if (!isNo(file.gem) && !hasFilledString(order.gemSoNo)) return false;
  if (!hasFilledString(order.soDate)) return false;
  if (!hasSupplyOrderValue(file, order)) return false;
  if (!hasFilledString(order.firm)) return false;
  if (!hasFilledString(order.firmType)) return false;
  if (
    (order.firmType ?? "").trim().toUpperCase() === "OTHER" &&
    !hasFilledString(order.firmTypeOther)
  ) {
    return false;
  }
  if (!isYes(order.stageDelivery) && !isNo(order.stageDelivery)) return false;
  if (isYes(order.stageDelivery)) {
    if (!hasFilledString(order.stageDeliveryCount)) return false;
    if (!isYes(order.stagePayment) && !isNo(order.stagePayment)) return false;
    if (isYes(order.stagePayment) && !isYes(order.advancePayment) && !isNo(order.advancePayment)) {
      return false;
    }
  }
  return true;
}

function isSupplyOrderPendingOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    !isSupplyOrderCancelled(file, order) &&
    isFinancialSanctionCompletedOrder(order) &&
    !isSupplyOrderTabComplete(file, order)
  );
}

function isSoCancelledFile(file: FileRecord) {
  const orders = rawSupplyOrders(file);
  return (
    orders.length > 0 &&
    orders.every((order) => isYes(order.soCancelled) || isYes(order.shortclosure))
  );
}

function countEffectiveSupplyOrders(files: FileRecord[]) {
  return files.reduce((total, file) => total + countExpectedSupplyOrderRows(file), 0);
}

function countPlacedSupplyOrders(files: FileRecord[]) {
  return rawSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isSupplyOrderTabComplete(file, order) && !isSupplyOrderCancelled(file, order),
  ).length;
}

function countLiveSupplyOrders(files: FileRecord[]) {
  return rawSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isSupplyOrderTabComplete(file, order) &&
      !hasFilledString(order.paymentDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countDeliveryCompletedOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      hasSupplyOrderDate(order) &&
      isPhysicalDeliveryWorkflow(file) &&
      hasFilledString(order.materialReceiptDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countDeliveryPendingOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      hasSupplyOrderDate(order) &&
      isPhysicalDeliveryWorkflow(file) &&
      !isCompletedDeliveryOrder(file, order) &&
      !isSupplyOrderCancelled(file, order) &&
      isCurrentDeliveryPeriodOrder(order),
  ).length;
}

function countDeliveryOverdueOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      hasSupplyOrderDate(order) &&
      isPhysicalDeliveryWorkflow(file) &&
      !isCompletedDeliveryOrder(file, order) &&
      !isSupplyOrderCancelled(file, order) &&
      isDateBeforeToday(getDeliveryPeriodDate(order)),
  ).length;
}

function countJobCompletionLiveOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      !isSupplyOrderCancelled(file, order) && isJobCompletionCurrentOrder(file, order),
  ).length;
}

function countJobCompletionCompletedOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      hasSupplyOrderDate(order) &&
      isJobCompletionWorkflow(file) &&
      isJobCompletionDone(order) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countJobCompletionPeriodOverOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      hasSupplyOrderDate(order) &&
      isJobCompletionWorkflow(file) &&
      !isJobCompletionDone(order) &&
      !isSupplyOrderCancelled(file, order) &&
      isDateBeforeToday(getDeliveryPeriodDate(order)),
  ).length;
}

function countDeliveryPeriodValidOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(({ file, order }) =>
    isValidDeliveryPeriodEntry(file, order),
  ).length;
}

function countDeliveryPeriodExpiredOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(({ file, order }) =>
    isExpiredDeliveryPeriodEntry(file, order),
  ).length;
}

function countDeliveryPeriodExtendedOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(({ file, order }) =>
    isExtendedDeliveryPeriodEntry(file, order),
  ).length;
}

function isBgMilestoneKey(key: string) {
  const normalized = normalizeMilestoneName(key);
  return normalized === "psb" || normalized === "pwb" || normalized === "psbpwb";
}

function isBgCategoryApplicable(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") {
    return (
      isYes(order.psbApplicable) &&
      (order.bgCoverageType === "PSB" || order.bgCoverageType === "PSB and PWB separately")
    );
  }
  if (normalized === "pwb") {
    return (
      isYes(file.bg) &&
      (order.bgCoverageType === "PWB" || order.bgCoverageType === "PSB and PWB separately")
    );
  }
  if (normalized === "psbpwb") return isYes(file.bg) && order.bgCoverageType === "PSB+PWB";
  return false;
}

function getBgReceivedDate(order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") return order.psbBgReceivedDate;
  if (normalized === "pwb") return order.pwbBgReceivedDate;
  if (normalized === "psbpwb") return order.combinedBgReceivedDate;
  return undefined;
}

function getBgValidityDate(order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") return order.psbBgValidityDate;
  if (normalized === "pwb") return order.pwbBgValidityDate;
  if (normalized === "psbpwb") return order.combinedBgValidityDate;
  return undefined;
}

function getBgReturnDate(order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") return order.psbBgReturnDate;
  if (normalized === "pwb") return order.pwbBgReturnDate;
  if (normalized === "psbpwb") return order.combinedBgReturnDate;
  return undefined;
}

function countBgApplicableOrders(files: FileRecord[], category: string) {
  return files
    .flatMap((file) => expectedSupplyOrders(file).map((order) => ({ file, order })))
    .filter(
      ({ file, order }) =>
        isBgCategoryApplicable(file, order, category) && !isSupplyOrderCancelled(file, order),
    ).length;
}

function countBgReceivedOrders(files: FileRecord[], category: string) {
  return files
    .flatMap((file) => expectedSupplyOrders(file).map((order) => ({ file, order })))
    .filter(
      ({ file, order }) =>
        isBgCategoryApplicable(file, order, category) &&
        isBgReceivedOrder(order, category) &&
        !isSupplyOrderCancelled(file, order),
    ).length;
}

function countBgPendingOrders(files: FileRecord[], category: string) {
  return files
    .flatMap((file) => expectedSupplyOrders(file).map((order) => ({ file, order })))
    .filter(({ file, order }) => isBgPendingOrder(file, order, category)).length;
}

function isBgPendingOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  return (
    isBgCategoryApplicable(file, order, category) &&
    !isBgReceivedOrder(order, category) &&
    !isSupplyOrderCancelled(file, order) &&
    (normalized === "psb" || normalized === "psbpwb"
      ? isFinancialSanctionCompletedOrder(order)
      : hasFilledString(order.materialReceiptDate))
  );
}

function countBgToBeReturnedOrders(files: FileRecord[], category: string) {
  return rawSupplyOrderEntries(files).filter(({ file, order }) =>
    isBgReturnDueOrder(file, order, category),
  ).length;
}

function countBgReturnedOrders(files: FileRecord[], category: string) {
  return rawSupplyOrderEntries(files).filter(({ file, order }) =>
    isBgReturnedOrder(file, order, category),
  ).length;
}

function countBgExpiredOrders(files: FileRecord[], category: string) {
  return rawSupplyOrderEntries(files).filter(({ file, order }) =>
    isBgExpiredOrder(file, order, category),
  ).length;
}

function countIrPreparationPendingOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isDeliveryInspectionApplicable(file) &&
      isYes(file.ir) &&
      hasSupplyOrderDate(order) &&
      hasFilledString(order.materialReceiptDate) &&
      !hasFilledString(order.irPreparationDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countIrReceiptPendingOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isDeliveryInspectionApplicable(file) &&
      isYes(file.ir) &&
      hasFilledString(order.irPreparationDate) &&
      !hasFilledString(order.irReceiptDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countIrCompletedOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isDeliveryInspectionApplicable(file) &&
      isYes(file.ir) &&
      hasFilledString(order.irReceiptDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countPaymentCompletedOrders(files: FileRecord[]) {
  return effectivePaymentEntries(files).filter(
    ({ file, order }) => hasFilledString(order.paymentDate) && !isSupplyOrderCancelled(file, order),
  ).length;
}

function countPaymentPendingOrders(files: FileRecord[]) {
  return effectivePaymentEntries(files).filter(
    ({ file, order }) =>
      hasPaymentWorkflowStarted(file, order) &&
      !hasFilledString(order.paymentDate) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countAdvancePaymentPaidOrders(files: FileRecord[]) {
  return advancePaymentEntries(files).filter(
    ({ file, order }) => isAdvancePaymentPaid(order) && !isSupplyOrderCancelled(file, order),
  ).length;
}

function countAdvancePaymentPendingOrders(files: FileRecord[]) {
  return advancePaymentEntries(files).filter(
    ({ file, order }) => isAdvancePaymentPending(order) && !isSupplyOrderCancelled(file, order),
  ).length;
}

function hasAdvancePaymentPaid(file: FileRecord) {
  return advancePaymentEntries([file]).some(
    ({ file: entryFile, order }) =>
      isAdvancePaymentPaid(order) && !isSupplyOrderCancelled(entryFile, order),
  );
}

function hasAdvancePaymentPending(file: FileRecord) {
  return advancePaymentEntries([file]).some(
    ({ file: entryFile, order }) =>
      isAdvancePaymentPending(order) && !isSupplyOrderCancelled(entryFile, order),
  );
}

function hasPaymentWorkflowStarted(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasFilledString(order.billPreparationDate) ||
    hasFilledString(order.billSentForPaymentDate) ||
    isPaymentDueByDeliveryOrPeriod(file, order)
  );
}

function isPaymentDueByDeliveryOrPeriod(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return hasPaymentDueCompletion(file, order);
  return isJobCompletionDone(order);
}

function countLdOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ order }) => isYes(order.ld) && !isYes(order.soCancelled) && !isYes(order.shortclosure),
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
  return isBiddingApplicableForFile(file) && isYes(file.tenderLive);
}

function getEffectiveBidOpeningDate(file: FileRecord) {
  return isYes(file.refloat) && hasFilledString(file.refloatBidOpeningDate)
    ? file.refloatBidOpeningDate
    : file.bidOpeningDate;
}

function isBidOverdue(file: FileRecord) {
  return (
    isBiddingApplicableForFile(file) &&
    isNo(file.bidOpened) &&
    isDateBeforeToday(getEffectiveBidOpeningDate(file))
  );
}

function isPreBidMeetingStatus(
  file: FileRecord,
  refloat: boolean,
  state: "due" | "completed",
  monthKey = "",
) {
  if (isCancelledFile(file)) return false;
  const applies = refloat
    ? isYes(file.refloat) && isYes(file.refloatPreBidMeeting)
    : isYes(file.preBidMeeting);
  const date = refloat ? file.refloatPreBidMeetingDate : file.preBidMeetingDate;
  if (!applies || !hasFilledString(date)) return false;
  if (monthKey && getMonthKey(date) !== monthKey) return false;
  return state === "completed" ? isDateBeforeToday(date) : !isDateBeforeToday(date);
}

function isLiveSupplyOrder(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) =>
      isSupplyOrderTabComplete(file, order) &&
      !hasFilledString(order.paymentDate) &&
      !isSupplyOrderCancelled(file, order),
  );
}

function isBgToBeReceived(file: FileRecord, category = "psb") {
  return expectedSupplyOrders(file).some((order) => isBgPendingOrder(file, order, category));
}

function isBgCurrentOrder(order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (
    normalized === "psbpwb" &&
    isFinancialSanctionCompletedOrder(order) &&
    !hasFilledString(order.combinedBgReceivedDate)
  ) {
    return true;
  }
  if (
    normalized === "pwb" &&
    hasFilledString(order.materialReceiptDate) &&
    !hasFilledString(order.pwbBgReceivedDate)
  ) {
    return true;
  }
  return normalizeMilestoneName(order.currentMilestone) === normalizeMilestoneName(category);
}

function isBgToBeReturned(file: FileRecord, category = "psb") {
  return rawSupplyOrders(file).some((order) => isBgReturnDueOrder(file, order, category));
}

function isBgExpired(file: FileRecord, category = "psb") {
  return rawSupplyOrders(file).some((order) => isBgExpiredOrder(file, order, category));
}

function isBgReturned(file: FileRecord, category = "psb") {
  return rawSupplyOrders(file).some((order) => isBgReturnedOrder(file, order, category));
}

function isBgReturnedOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  return (
    isBgCategoryApplicable(file, order, category) &&
    hasFilledString(getBgReturnDate(order, category))
  );
}

function isBgReturnDueOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  if (
    !isBgCategoryApplicable(file, order, category) ||
    !isBgReceivedOrder(order, category) ||
    hasFilledString(getBgReturnDate(order, category))
  )
    return false;
  if (isYes(order.soCancelled) || isYes(order.shortclosure)) return true;
  const normalizedCategory = normalizeMilestoneName(category);
  return (
    !isSupplyOrderCancelled(file, order) &&
    (normalizedCategory === "psb"
      ? isPsbReturnPurposeComplete(file, order)
      : isWarrantyBgReturnPurposeComplete(file, order, normalizedCategory))
  );
}

function isWarrantyBgReturnPurposeComplete(
  file: FileRecord,
  order: SupplyOrderDetail,
  category: string,
) {
  if (category !== "pwb" && category !== "psbpwb") return false;
  if (!isBgCategoryApplicable(file, order, category)) return false;
  if (!hasFilledString(order.warrantyPeriodDate)) return false;
  return isDateBeforeToday(addDays(order.warrantyPeriodDate, 60));
}

function isWarrantyBgMismatchOrder(
  file: FileRecord,
  order: SupplyOrderDetail,
  category: string,
  bufferDays: number,
) {
  if (category !== "pwb" && category !== "psbpwb") return false;
  if (!isBgCategoryApplicable(file, order, category)) return false;
  if (!isBgReceivedOrder(order, category)) return false;
  if (hasFilledString(getBgReturnDate(order, category))) return false;
  const validityDate = getBgValidityDate(order, category);
  if (!hasFilledString(order.warrantyPeriodDate) || !hasFilledString(validityDate)) return false;
  const requiredValidityDate = addDays(order.warrantyPeriodDate, bufferDays);
  return hasFilledString(requiredValidityDate) && validityDate < requiredValidityDate;
}

function isPsbReturnPurposeComplete(file: FileRecord, order: SupplyOrderDetail) {
  if (!isDeliveryInspectionApplicable(file)) {
    if (isYes(order.stageDelivery) && order.stageDeliveries?.length) {
      return order.stageDeliveries.every(isJobCompletionDone);
    }
    return isJobCompletionDone(order);
  }
  if (isYes(order.stageDelivery) && order.stageDeliveries?.length) {
    return order.stageDeliveries.every((stage) => hasPsbReturnCompletion(file, stage));
  }
  return hasPsbReturnCompletion(file, order);
}

function hasPaymentDueCompletion(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return hasFilledString(order.materialReceiptDate);
  return isJobCompletionDone(order);
}

function hasPsbReturnCompletion(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return hasFilledString(order.irReceiptDate);
  return isJobCompletionDone(order);
}

function isBgExpiredOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const validityDate = getBgValidityDate(order, category);
  const normalizedCategory = normalizeMilestoneName(category);
  return (
    isBgCategoryApplicable(file, order, category) &&
    isBgReceivedOrder(order, category) &&
    !hasFilledString(getBgReturnDate(order, category)) &&
    !isSupplyOrderCancelled(file, order) &&
    (normalizedCategory === "psb"
      ? !isPsbReturnPurposeComplete(file, order)
      : !hasFilledString(order.paymentDate)) &&
    hasFilledString(validityDate) &&
    isDateBeforeToday(validityDate)
  );
}

function isDpExpired(file: FileRecord) {
  return fileSupplyOrders(file).some((order) => isDateBeforeToday(getDeliveryPeriodDate(order)));
}

function isDeliveryOverdue(file: FileRecord) {
  return (
    !isCancelledFile(file) &&
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && isOverdueDeliveryOrder(file, order),
    )
  );
}

function isDeliveryCompleted(file: FileRecord) {
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && isCompletedDeliveryOrder(file, order),
    )
  );
}

function isDeliveryDue(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && isPendingDeliveryOrder(file, order),
    )
  );
}

function isDeliveryActive(file: FileRecord) {
  return isDeliveryInspectionApplicable(file) && isSupplyOrderPlaced(file);
}

function isPhysicalDeliveryWorkflow(file: FileRecord) {
  return isDeliveryInspectionApplicable(file);
}

function isJobCompletionWorkflow(file: FileRecord) {
  return !isPhysicalDeliveryWorkflow(file);
}

function isJobCompletionCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  if (!hasSupplyOrderDate(order) || !isJobCompletionWorkflow(file) || isJobCompletionDone(order)) {
    return false;
  }
  return isDateBeforeToday(getDeliveryPeriodDate(order));
}

function isDeliveryInspectionApplicable(file: FileRecord) {
  return isDeliveryInspectionApplicableByGroup(file);
}

function isCompletedDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasSupplyOrderDate(order) &&
    isPhysicalDeliveryWorkflow(file) &&
    hasFilledString(order.materialReceiptDate)
  );
}

function isJobCompletionLive(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isSupplyOrderPlaced(file) &&
    effectiveSupplyOrderEntries([file]).some(
      ({ file: entryFile, order }) =>
        !isSupplyOrderCancelled(entryFile, order) && isJobCompletionCurrentOrder(entryFile, order),
    )
  );
}

function isJobCompletionCompleted(file: FileRecord) {
  if (isCancelledFile(file) || !isJobCompletionWorkflow(file)) return false;
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && hasSupplyOrderDate(order) && isJobCompletionDone(order),
    )
  );
}

function isJobCompletionPeriodOver(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) =>
        !isSupplyOrderCancelled(file, order) &&
        hasSupplyOrderDate(order) &&
        isJobCompletionWorkflow(file) &&
        !isJobCompletionDone(order) &&
        isDateBeforeToday(getDeliveryPeriodDate(order)),
    )
  );
}

function isDueDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasSupplyOrderDate(order) &&
    isPhysicalDeliveryWorkflow(file) &&
    !isCompletedDeliveryOrder(file, order) &&
    !isYes(order.soCancelled) &&
    !isYes(order.shortclosure)
  );
}

function isPendingDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  const dueDate = getDeliveryDueDate(order);
  return isDueDeliveryOrder(file, order) && hasFilledString(dueDate) && !isDateBeforeToday(dueDate);
}

function getDeliveryDueDate(order: SupplyOrderDetail) {
  return order.revisedDp || order.dpDate;
}

function isCurrentDeliveryPeriodOrder(order: SupplyOrderDetail) {
  const deliveryDueDate = getDeliveryDueDate(order);
  return (
    hasFilledString(deliveryDueDate) &&
    !isDateAfterToday(order.deliveryPeriodStartDate || order.soDate) &&
    !isDateBeforeToday(deliveryDueDate)
  );
}

function isOverdueDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return isDueDeliveryOrder(file, order) && isDateBeforeToday(getDeliveryDueDate(order));
}

function isDeliveryPeriodValid(file: FileRecord) {
  return (
    isDeliveryPeriodActive(file) &&
    fileSupplyOrders(file).some((order) => isValidDeliveryPeriodEntry(file, order))
  );
}

function isDeliveryPeriodExpired(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isDeliveryPeriodActive(file) &&
    fileSupplyOrders(file).some((order) => isExpiredDeliveryPeriodEntry(file, order))
  );
}

function isDeliveryPeriodExtended(file: FileRecord) {
  return (
    isDeliveryPeriodActive(file) &&
    fileSupplyOrders(file).some((order) => isExtendedDeliveryPeriodEntry(file, order))
  );
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
    expectedSupplyOrders(file).some((order) => !isSupplyOrderCancelled(file, order))
  );
}

function isBgReceived(file: FileRecord, category = "psb") {
  return expectedSupplyOrders(file).some(
    (order) =>
      isBgCategoryApplicable(file, order, category) &&
      isBgReceivedOrder(order, category) &&
      !isSupplyOrderCancelled(file, order),
  );
}

function isBgReceivedOrder(order: SupplyOrderDetail, category: string) {
  return (
    hasFilledString(getBgReceivedDate(order, category)) ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === normalizeMilestoneName(category),
    )
  );
}

function isFinancialSanctionCompletedOrder(order: SupplyOrderDetail) {
  return (
    hasFilledString(order.financialSanctionDate) ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === "financialsanction",
    )
  );
}

function getDeliveryPeriodDate(order: SupplyOrderDetail) {
  return order.revisedDp || order.dpDate;
}

function getPaymentWorkflowStartDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  return addDays(getDeliveryPeriodDate(order), 1);
}

function addDays(date: string | undefined, days: number) {
  const time = parseLocalDateTime(date ?? "");
  if (time === undefined) return undefined;
  const next = new Date(time);
  next.setDate(next.getDate() + days);
  return formatLocalDate(next);
}

function getFinancialYearDateRange(financialYear: string | undefined) {
  const match = (financialYear ?? "").match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return undefined;
  const startYear = Number(match[1]);
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

function getFinancialYearForDate(date: string | undefined) {
  const time = parseLocalDateTime(date ?? "");
  if (time === undefined) return undefined;
  const parsed = new Date(time);
  const year = parsed.getFullYear();
  const month = parsed.getMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function isDateWithinRange(date: string | undefined, range: { start: string; end: string }) {
  return hasFilledString(date) && date! >= range.start && date! <= range.end;
}

function isDateAfter(date: string | undefined, reference: string) {
  return hasFilledString(date) && date! > reference;
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

type FinanceFirmTypeDistributionExportRow = {
  name: string;
  value: number;
  share: number;
};

const dashboardFilterTitles: Record<string, string> = {
  deliveryCompleted: "Delivery Completed",
  deliveryDue: "Delivery Pending",
  deliveryOverdue: "Delivery Overdue",
  jobCompletionCompleted: "Job Completion Done",
  jobCompletionDue: "Job Completion Due",
  jobCompletionLive: "Job Completion Due",
  jobCompletionPeriodOver: "Milestone Period Over",
  deliveryPeriodValid: "Delivery Period / Milestone - Valid",
  deliveryPeriodExpired: "Delivery Period / Milestone - Expired",
  deliveryPeriodExtended: "Delivery Period / Milestone - Extended",
  irPreparationPending: "IR - Preparation pending",
  irReceiptPending: "IR - Receipt pending",
  irCompleted: "IR - Completed",
  liveBids: "Bidding - Live",
  bidOverdue: "Bidding - Opening overdue",
  "preBidMeeting:due": "Pre-Bid Meeting - Due",
  "preBidMeeting:completed": "Pre-Bid Meeting - Completed",
  "refloatPreBidMeeting:due": "Refloat Pre-Bid Meeting - Due",
  "refloatPreBidMeeting:completed": "Refloat Pre-Bid Meeting - Completed",
  liveSupplyOrders: "Supply Order - Live",
  bgReceived: "PSB - Received",
  bgToBeReceived: "PSB - Pending",
  bgExpired: "PSB - Expired",
  bgToBeReturned: "PSB - To be returned",
  bgReturned: "PSB - Returned",
  advancePaid: "Payment - Advance Paid",
  advancePending: "Payment - Advance Pending",
  miscLiveFiles: "Cancellation - Live files",
  miscFileClosed: "Cancellation - File closed",
  miscLd: "Cancellation - LD",
  miscDemandCancelled: "Cancellation - Demand cancelled",
  miscSoCancelled: "Cancellation - S.O. cancelled",
  miscShortclosedSo: "Cancellation - Shortclosed S.O.",
  miscMultipleSupplyOrders: "Cancellation - Multiple S.O.",
};

function isPaymentDue(file: FileRecord) {
  return isPaymentPending(file);
}

function isPaymentCompleted(file: FileRecord) {
  return effectivePaymentEntries([file]).some(
    ({ file: entryFile, order }) =>
      hasFilledString(order.paymentDate) && !isSupplyOrderCancelled(entryFile, order),
  );
}

function matchesFinanceCarryForwardFilter(file: FileRecord, filter: string) {
  const [, mode = "", rawSelectedYear = "", rawSourceYear = ""] = filter.split(":");
  const selectedYear = decodeStatusFilterPart(rawSelectedYear);
  const sourceYear = decodeStatusFilterPart(rawSourceYear);
  const range = getFinancialYearDateRange(selectedYear);
  if (!selectedYear || !sourceYear || !range) return false;
  return effectivePaymentEntries([file]).some(({ file: entryFile, order }) => {
    if (isSupplyOrderCancelled(entryFile, order)) return false;
    const orderYear = getFinancialYearForDate(order.soDate);
    if (!orderYear || orderYear !== sourceYear) return false;
    const paymentDate = order.paymentDate;
    const paidInSelectedYear = isDateWithinRange(paymentDate, range);
    const unpaidAtSelectedYearEnd = !hasFilledString(paymentDate) || isDateAfter(paymentDate, range.end);
    if (mode === "carryForward") return orderYear === selectedYear && unpaidAtSelectedYearEnd;
    if (mode === "clearedCarryForward") return orderYear < selectedYear && paidInSelectedYear;
    if (mode === "previousCarryForward") return orderYear < selectedYear && unpaidAtSelectedYearEnd;
    if (mode === "futureClearedCarryForward") {
      return (
        orderYear === selectedYear &&
        hasFilledString(paymentDate) &&
        isDateAfter(paymentDate, range.end) &&
        getFinancialYearForDate(paymentDate) === sourceYear
      );
    }
    return false;
  });
}

function isIrPreparationPending(file: FileRecord) {
  return (
    isDeliveryInspectionApplicable(file) &&
    isYes(file.ir) &&
    fileSupplyOrders(file).some(
      (order) =>
        hasSupplyOrderDate(order) &&
        hasFilledString(order.materialReceiptDate) &&
        !hasFilledString(order.irPreparationDate) &&
        !isSupplyOrderCancelled(file, order),
    )
  );
}

function isIrReceiptPending(file: FileRecord) {
  return (
    isDeliveryInspectionApplicable(file) &&
    isYes(file.ir) &&
    fileSupplyOrders(file).some(
      (order) =>
        hasFilledString(order.irPreparationDate) &&
        !hasFilledString(order.irReceiptDate) &&
        !isSupplyOrderCancelled(file, order),
    )
  );
}

function isIrCompleted(file: FileRecord) {
  return (
    isDeliveryInspectionApplicable(file) &&
    isYes(file.ir) &&
    fileSupplyOrders(file).some(
      (order) => hasFilledString(order.irReceiptDate) && !isSupplyOrderCancelled(file, order),
    )
  );
}

function getStatusSummaryDashboardFilter(milestone: string, stage: string) {
  return `statusSummary:${encodeURIComponent(milestone)}:${encodeURIComponent(stage)}`;
}

function matchesDashboardFilter(file: FileRecord, filter: string) {
  if (!isCancellationDashboardFilter(filter) && isCancelledFile(file)) return false;
  if (filter.startsWith("financeCarryForward:")) {
    return matchesFinanceCarryForwardFilter(file, filter);
  }
  if (filter.startsWith("statusSummary:")) {
    const [, rawMilestone = "", rawStage = ""] = filter.split(":");
    const milestone = decodeStatusFilterPart(rawMilestone);
    const stage = decodeStatusFilterPart(rawStage);
    return matchesStatusSummaryFilter(file, milestone, stage);
  }
  if (filter.startsWith("firmType:")) {
    const firmType = decodeURIComponent(filter.slice("firmType:".length)).trim().toUpperCase();
    if (!firmType) return true;
    return fileSupplyOrders(file).some((order) => isFirmTypeMatch(order, firmType));
  }
  if (filter.startsWith("supplyOrderMonth:")) {
    const monthKey = filter.slice("supplyOrderMonth:".length);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return true;
    return rawSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && getMonthKey(order.soDate) === monthKey,
    );
  }
  if (filter.startsWith("fileInflowMonth:")) {
    const monthKey = filter.slice("fileInflowMonth:".length);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return true;
    return getMonthKey(file.receivedDate) === monthKey;
  }
  if (filter.startsWith("deliverySchedule:")) {
    const [, mode = "gross", monthKey = ""] = filter.split(":");
    if ((mode !== "gross" && mode !== "net") || !/^\d{4}-\d{2}$/.test(monthKey)) return true;
    return effectiveSupplyOrderEntries([file]).some(({ file: entryFile, order }) => {
      if (isSupplyOrderCancelled(entryFile, order)) return false;
      if (getMonthKey(getDeliveryPeriodDate(order)) !== monthKey) return false;
      return mode === "gross" || !isDeliveryFructified(entryFile, order);
    });
  }
  if (filter.startsWith("completedDeliveryMonth:")) {
    const monthKey = filter.slice("completedDeliveryMonth:".length);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return true;
    return effectiveSupplyOrderEntries([file]).some(
      ({ file: entryFile, order }) =>
        !isSupplyOrderCancelled(entryFile, order) &&
        getMonthKey(getDeliveryCompletionMonthDate(entryFile, order)) === monthKey,
    );
  }
  if (filter.startsWith("bgExpiryMonth:")) {
    const [, category = "all", monthKey = ""] = filter.split(":");
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return true;
    const categories = category === "all" ? ["psb", "pwb", "psbpwb"] : [category];
    return rawSupplyOrderEntries([file]).some(({ file: entryFile, order }) =>
      categories.some(
        (item) =>
          isBgMilestoneKey(item) &&
          isBgCategoryApplicable(entryFile, order, item) &&
          isBgReceivedOrder(order, item) &&
          !hasFilledString(getBgReturnDate(order, item)) &&
          getMonthKey(getBgValidityDate(order, item)) === monthKey,
      ),
    );
  }
  if (filter.startsWith("warrantyBgMismatch:")) {
    const [, category = "all", rawDays = "60"] = filter.split(":");
    const days = Number.parseInt(rawDays, 10);
    const normalizedDays = Number.isInteger(days) && days >= 0 ? days : 60;
    const categories = category === "all" ? ["pwb", "psbpwb"] : [category];
    return rawSupplyOrderEntries([file]).some(({ file: entryFile, order }) =>
      categories.some(
        (item) =>
          isBgMilestoneKey(item) &&
          isWarrantyBgMismatchOrder(entryFile, order, item, normalizedDays),
      ),
    );
  }
  if (filter.startsWith("tcecStatus:")) return matchesTcecStatusFilter(file, filter);
  if (filter.startsWith("cncSummary:")) return matchesCncSummaryFilter(file, filter);
  if (filter.startsWith("mode:")) {
    return (
      (file.mode ?? "").trim().toUpperCase() ===
      decodeURIComponent(filter.slice("mode:".length)).trim().toUpperCase()
    );
  }
  if (filter.startsWith("gemBiddingMode:")) {
    const mode = decodeURIComponent(filter.slice("gemBiddingMode:".length)).trim().toLowerCase();
    return isYes(file.gem) && (file.gemBiddingMode ?? "").trim().toLowerCase() === mode;
  }
  if (filter.startsWith("manualMilestoneCurrent:")) {
    const milestone = filter.slice("manualMilestoneCurrent:".length);
    if (isBgMilestoneKey(normalizeMilestoneName(milestone)))
      return isBgToBeReceived(file, milestone);
    if (isSupplyOrderDrivenMilestoneName(milestone)) {
      return matchesCurrentSupplyOrderDrivenMilestone(file, milestone);
    }
    return file.currentMilestone === milestone;
  }
  if (filter.startsWith("manualMilestoneCompleted:")) {
    const milestone = filter.slice("manualMilestoneCompleted:".length);
    if (isBgMilestoneKey(normalizeMilestoneName(milestone))) return isBgReceived(file, milestone);
    if (isSupplyOrderDrivenMilestoneName(milestone)) {
      return matchesCompletedSupplyOrderDrivenMilestone(file, milestone);
    }
    return Boolean(file.completedMilestones?.includes(milestone));
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
  if (filter.startsWith("preBidMeeting:") || filter.startsWith("refloatPreBidMeeting:")) {
    const [kind = "", state = "all", monthKey = ""] = filter.split(":");
    const refloat = kind === "refloatPreBidMeeting";
    if (state === "all") {
      return (
        isPreBidMeetingStatus(file, refloat, "due", monthKey) ||
        isPreBidMeetingStatus(file, refloat, "completed", monthKey)
      );
    }
    if (state === "due" || state === "completed") {
      return isPreBidMeetingStatus(file, refloat, state, monthKey);
    }
    return false;
  }
  if (filter === "supplyOrders") return hasAny(file, ["soDate"]);
  if (filter === "liveSupplyOrders") return isLiveSupplyOrder(file);
  if (filter === "bgReceived") return isBgReceived(file, "psb");
  if (filter === "bgToBeReceived") return isBgToBeReceived(file, "psb");
  if (filter === "bgExpired") return isBgExpired(file, "psb");
  if (filter === "bgToBeReturned") return isBgToBeReturned(file, "psb");
  if (filter === "bgReturned") return isBgReturned(file, "psb");
  if (filter.startsWith("bgExpired:")) {
    const category = filter.slice("bgExpired:".length);
    return isBgMilestoneKey(category) ? isBgExpired(file, category) : true;
  }
  if (filter.startsWith("bgToBeReturned:")) {
    const category = filter.slice("bgToBeReturned:".length);
    return isBgMilestoneKey(category) ? isBgToBeReturned(file, category) : true;
  }
  if (filter.startsWith("bgReturned:")) {
    const category = filter.slice("bgReturned:".length);
    return isBgMilestoneKey(category) ? isBgReturned(file, category) : true;
  }
  if (filter === "dpExtension") return isYes(file.dpExtension);
  if (filter === "dpExpired") return isDpExpired(file);
  if (filter === "deliveryOverdue") return isDeliveryOverdue(file);
  if (filter === "deliveryCompleted") return isDeliveryCompleted(file);
  if (filter === "deliveryDue") return isDeliveryDue(file);
  if (filter === "jobCompletionCompleted") return isJobCompletionCompleted(file);
  if (filter === "jobCompletionDue" || filter === "jobCompletionLive")
    return isJobCompletionLive(file);
  if (filter === "jobCompletionPeriodOver") return isJobCompletionPeriodOver(file);
  if (filter === "deliveryPeriodValid") return isDeliveryPeriodValid(file);
  if (filter === "deliveryPeriodExpired") return isDeliveryPeriodExpired(file);
  if (filter === "deliveryPeriodExtended") return isDeliveryPeriodExtended(file);
  if (filter === "irPreparationPending") return isIrPreparationPending(file);
  if (filter === "irReceiptPending") return isIrReceiptPending(file);
  if (filter === "irCompleted") return isIrCompleted(file);
  if (filter === "paymentDue") return isPaymentDue(file);
  if (filter === "advancePaid") return hasAdvancePaymentPaid(file);
  if (filter === "advancePending") return hasAdvancePaymentPending(file);
  if (filter === "miscLiveFiles") return isLiveFile(file);
  if (filter === "miscFileClosed") return isFileClosed(file);
  if (filter === "miscLd") return fileSupplyOrders(file).some((order) => isYes(order.ld));
  if (filter === "miscDemandCancelled") {
    return isYes(file.demandCancelled);
  }
  if (filter === "miscSoCancelled") {
    return fileSupplyOrders(file).some((order) => isYes(order.soCancelled));
  }
  if (filter === "miscShortclosedSo") {
    return fileSupplyOrders(file).some((order) => isYes(order.shortclosure));
  }
  if (filter === "miscMultipleSupplyOrders") return countExpectedSupplyOrderRows(file) > 1;
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
    if (milestone.key === "payment") return isPaymentPending(file) || isPaymentCompleted(file);
    return isBgMilestoneKey(milestone.key)
      ? fileSupplyOrders(file).some((order) => isBgCategoryApplicable(file, order, milestone.key))
      : isMilestoneApplicable(file, milestone);
  }
  if (filter.startsWith("milestoneUnderProcess:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(22));
    if (milestone?.key === "supplyOrder") {
      return countExpectedSupplyOrderRows(file) > 0 && !hasOrderFinancialSanctionCompleted(file);
    }
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
    if (milestone?.key === "payment") return isPaymentPending(file);
    if (milestone && isBgMilestoneKey(milestone.key)) return isBgToBeReceived(file, milestone.key);
    if (milestone?.key === "supplyOrder") {
      return matchesCurrentSupplyOrderDrivenMilestone(file, "supplyorder");
    }
    return milestone ? isPendingMilestone(file, milestone) : true;
  }
  if (filter.startsWith("milestoneCleared:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(17));
    if (!milestone) return true;
    if (milestone.key === "payment") return isPaymentCompleted(file);
    if (isBgMilestoneKey(milestone.key)) return isBgReceived(file, milestone.key);
    return isClearedMilestone(file, milestone);
  }
  if (filter.startsWith("milestoneEligible:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(18));
    return milestone ? isEligibleMilestone(file, milestone) : true;
  }
  if (filter === "soCompleted") return hasPlacedSupplyOrder(file);
  if (filter === "soRemaining") return hasCurrentSupplyOrderMilestoneRow(file);
  return true;
}

function matchesTcecStatusFilter(file: FileRecord, filter: string) {
  const [, rawStage = "pre", rawMetric = "reviewed", rawCommittee = "", rawMeetingDate = ""] =
    filter.split(":");
  const stage = decodeStatusFilterPart(rawStage) === "post" ? "post" : "pre";
  const metric = decodeStatusFilterPart(rawMetric);
  if (metric !== "reviewed" && metric !== "signed" && metric !== "pending") return false;
  const committee = decodeStatusFilterPart(rawCommittee).trim().toLowerCase();
  if (!committee) return false;
  const meetingDate = decodeStatusFilterPart(rawMeetingDate).trim();
  const fileCommittee =
    stage === "pre" ? file.preTcecCommitteeNo?.trim() : file.postTcecCommitteeNumber?.trim();
  if ((fileCommittee ?? "").toLowerCase() !== committee) return false;
  const minutesDate = stage === "pre" ? file.preTcecMinutesDate : file.postTcecMinutesDate;
  const fileMeetingDate = stage === "pre" ? file.preTcecDate : file.postTcecDate;
  if (metric === "signed" && !hasFilledString(minutesDate)) return false;
  if (metric === "pending" && hasFilledString(minutesDate)) return false;
  if (meetingDate && fileMeetingDate !== meetingDate) return false;
  return true;
}

function matchesCncSummaryFilter(file: FileRecord, filter: string) {
  const [, rawMetric = "reviewed", rawCncDate = ""] = filter.split(":");
  const metric = decodeStatusFilterPart(rawMetric);
  const cncDate = decodeStatusFilterPart(rawCncDate).trim();
  if (!cncDate || file.cncDate !== cncDate) return false;
  const approved = hasFilledString(file.cncApprovalDate);
  const financialSanctionSigned = hasOrderFinancialSanctionCompleted(file);
  const supplyOrderPlaced = hasPlacedSupplyOrder(file);
  if (metric === "name" || metric === "reviewed") return true;
  if (metric === "approved") return approved;
  if (metric === "financialSanctionSigned") return financialSanctionSigned;
  if (metric === "supplyOrderPlaced") return supplyOrderPlaced;
  if (metric === "approvalPending") return !approved;
  if (metric === "financialSanctionPending") return approved && !financialSanctionSigned;
  if (metric === "supplyOrderPending") return financialSanctionSigned && !supplyOrderPlaced;
  return false;
}

function isCancellationDashboardFilter(filter: string) {
  return (
    filter === "miscDemandCancelled" ||
    filter === "miscSoCancelled" ||
    filter === "miscShortclosedSo"
  );
}

function decodeStatusFilterPart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hasOrderFinancialSanctionCompleted(file: FileRecord) {
  return rawSupplyOrders(file).some(
    (order) =>
      !isSupplyOrderCancelled(file, order) &&
      (hasFilledString(order.financialSanctionDate) ||
        normalizeCompletedMilestones(order.completedMilestones).some(
          (milestone) => normalizeMilestoneName(milestone) === "financialsanction",
        )),
  );
}

function matchesStatusSummaryFilter(file: FileRecord, milestoneLabel: string, stageLabel: string) {
  const rawMilestoneKey = normalizeMilestoneName(milestoneLabel);
  const milestoneKey = rawMilestoneKey === "deliveryjob" ? "delivery" : rawMilestoneKey;
  const stageKey = normalizeStatusStage(stageLabel);

  if (milestoneKey === "supplyorder") {
    if (stageKey === "placed")
      return matchesCompletedSupplyOrderDrivenMilestone(file, "supplyorder");
    if (stageKey === "live") return hasLiveSupplyOrderRow(file);
    if (stageKey === "pending") return hasCurrentSupplyOrderMilestoneRow(file);
  }

  if (milestoneKey === "financialsanction") {
    const completed = matchesCompletedSupplyOrderDrivenMilestone(file, "financialsanction");
    const pending = matchesCurrentSupplyOrderDrivenMilestone(file, "financialsanction");
    if (stageKey === "total" || stageKey === "totalfiles") return completed;
    if (stageKey === "atpreviousstage") return isFinancialSanctionPreviousStageFile(file);
    if (stageKey === "pending") return pending;
  }

  if (milestoneKey === "advancepayment") {
    if (stageKey === "completed") return hasAdvancePaymentPaid(file);
    if (stageKey === "pending") return hasAdvancePaymentPending(file);
  }

  if (isBgMilestoneKey(milestoneKey)) {
    const category = milestoneKey;
    if (stageKey === "total" || stageKey === "totalfiles") {
      return expectedSupplyOrders(file).some(
        (order) =>
          isBgCategoryApplicable(file, order, category) && !isSupplyOrderCancelled(file, order),
      );
    }
    if (stageKey === "received") return isBgReceived(file, category);
    if (stageKey === "pending") return isBgToBeReceived(file, category);
    if (stageKey === "expired") return isBgExpired(file, category);
    if (stageKey === "tobereturned") return isBgToBeReturned(file, category);
  }

  if (milestoneKey === "deliveryperiod") {
    if (stageKey === "valid") return isDeliveryPeriodValid(file);
    if (stageKey === "expired") return isDeliveryPeriodExpired(file);
    if (stageKey === "extended") return isDeliveryPeriodExtended(file);
  }

  if (milestoneKey === "delivery") {
    if (stageKey === "completed") return isDeliveryCompleted(file);
    if (stageKey === "pending") return matchesDeliveryPendingStatus(file);
    if (stageKey === "overdue") return matchesDeliveryOverdueStatus(file);
  }

  if (milestoneKey === "jobcompletion") {
    if (stageKey === "due" || stageKey === "livemilestone") return isJobCompletionLive(file);
    if (stageKey === "done" || stageKey === "completed") return isJobCompletionCompleted(file);
  }

  if (milestoneKey === "prebidmeeting") {
    if (stageKey === "due") return isPreBidMeetingStatus(file, false, "due");
    if (stageKey === "completed") return isPreBidMeetingStatus(file, false, "completed");
    if (stageKey === "refloatdue") return isPreBidMeetingStatus(file, true, "due");
    if (stageKey === "refloatcompleted") return isPreBidMeetingStatus(file, true, "completed");
  }

  if (milestoneKey === "payment") {
    if (stageKey === "completed") return isPaymentCompleted(file);
    if (stageKey === "pending") return isPaymentPending(file);
    if (stageKey === "total" || stageKey === "totalfiles") {
      return isPaymentPending(file) || isPaymentCompleted(file);
    }
  }

  if (
    milestoneKey === "irpreparation" ||
    milestoneKey === "irreceipt" ||
    milestoneKey === "billpreparation" ||
    milestoneKey === "billsentforpayment"
  ) {
    if (stageKey === "completed")
      return matchesCompletedSupplyOrderDrivenMilestone(file, milestoneKey);
    if (stageKey === "pending") return matchesCurrentSupplyOrderDrivenMilestone(file, milestoneKey);
    if (stageKey === "total" || stageKey === "totalfiles") {
      return (
        matchesCompletedSupplyOrderDrivenMilestone(file, milestoneKey) ||
        matchesCurrentSupplyOrderDrivenMilestone(file, milestoneKey)
      );
    }
  }

  const milestone = milestoneDefinitions.find(
    (item) => normalizeMilestoneName(item.label) === milestoneKey,
  );
  if (!milestone) return false;

  const applicable = isMilestoneApplicable(file, milestone);
  const inProcess = applicable && !isCancelledFile(file);
  const reached = inProcess && isEligibleMilestone(file, milestone);

  if (stageKey === "total" || stageKey === "totalfiles" || stageKey === "totalcases") {
    return applicable;
  }
  if (stageKey === "inprocess") {
    if (milestone.key === "bidding") {
      return (
        isManualActiveMilestone(file, milestone) && !isFileTenderLive(file) && !isBidOverdue(file)
      );
    }
    return isManualActiveMilestone(file, milestone);
  }
  if (stageKey === "reviewed") return isMilestoneReviewed(file, milestone);
  if (stageKey === "pending") return isPendingMilestone(file, milestone);
  if (stageKey === "completed") return inProcess && isMilestoneComplete(file, milestone);
  if (stageKey === "live" && milestone.key === "bidding") return isFileTenderLive(file);
  if (stageKey === "openingoverdue" && milestone.key === "bidding") return isBidOverdue(file);
  if (stageKey === "atpreviousstage" || stageKey === "atpreviousstages")
    return isAtPreviousStageFile(file, milestone);

  return false;
}

function normalizeStatusStage(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function hasPlacedSupplyOrder(file: FileRecord) {
  return rawSupplyOrders(file).some(
    (order) => isSupplyOrderTabComplete(file, order) && !isSupplyOrderCancelled(file, order),
  );
}

function hasLiveSupplyOrderRow(file: FileRecord) {
  return rawSupplyOrders(file).some(
    (order) =>
      isSupplyOrderTabComplete(file, order) &&
      !hasFilledString(order.paymentDate) &&
      !isSupplyOrderCancelled(file, order),
  );
}

function hasCurrentSupplyOrderMilestoneRow(file: FileRecord) {
  return rawSupplyOrders(file).some((order) => isSupplyOrderPendingOrder(file, order));
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

    if ("irPreparationPending" in milestone) {
      rows.push(
        {
          section: milestone.label,
          metric: "IR Preparation Pending",
          count: milestone.irPreparationPending,
        },
        {
          section: milestone.label,
          metric: "IR Receipt Pending",
          count: milestone.irReceiptPending,
        },
        { section: milestone.label, metric: "IR Completed", count: milestone.irCompleted },
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
        onFinancialSanctionPendingClick: noop,
        onFinancialSanctionCompletedClick: noop,
        onBgExpiredClick: noop,
        onBgToBeReturnedClick: noop,
        onBgReturnedClick: noop,
        onAdvancePaidClick: noop,
        onAdvancePendingClick: noop,
      }),
      milestone.key,
    ).forEach((metric) => {
      rows.push({ section: milestone.label, metric: metric.label, count: metric.count });
    });
  });

  rows.push(
    { section: "Cancellation", metric: "Live files", count: miscellaneousCounts.liveFiles },
    { section: "Cancellation", metric: "File closed", count: miscellaneousCounts.fileClosed },
    { section: "Cancellation", metric: "LD", count: miscellaneousCounts.ld },
    {
      section: "Cancellation",
      metric: "Demand cancelled",
      count: miscellaneousCounts.demandCancelled,
    },
    { section: "Cancellation", metric: "S.O. cancelled", count: miscellaneousCounts.soCancelled },
    {
      section: "Cancellation",
      metric: "Shortclosed S.O.",
      count: miscellaneousCounts.shortclosedSo,
    },
    {
      section: "Cancellation",
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

function exportFinanceRowsToExcel(
  rows: FinanceExportRow[],
  title: string,
  firmTypeDistributionRows: FinanceFirmTypeDistributionExportRow[],
  firmTypeDistributionLabel: string,
) {
  void downloadFinanceRows(
    rows,
    title,
    firmTypeDistributionRows,
    firmTypeDistributionLabel,
    "excel",
  );
}

function exportAnalyticsPanelToExcel(panel: AnalyticsPanel) {
  void downloadAnalyticsPanel(panel, "excel");
}

function getAnalyticsCellValue(row: Record<string, number | string>, column: AnalyticsTableColumn) {
  const value = row[column.key] ?? "";
  return column.format ? column.format(value, row) : String(value);
}

function getAnalyticsExportHeader(column: AnalyticsTableColumn) {
  return column.group ? `${column.group} - ${column.label}` : column.label;
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

function printFinanceRowsToPdf(
  rows: FinanceExportRow[],
  title: string,
  firmTypeDistributionRows: FinanceFirmTypeDistributionExportRow[],
  firmTypeDistributionLabel: string,
) {
  void downloadFinanceRows(rows, title, firmTypeDistributionRows, firmTypeDistributionLabel, "pdf");
}

async function downloadFinanceRows(
  rows: FinanceExportRow[],
  title: string,
  firmTypeDistributionRows: FinanceFirmTypeDistributionExportRow[],
  firmTypeDistributionLabel: string,
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
      {
        title: `Firm Type Distribution - ${firmTypeDistributionLabel}`,
        headers: ["S.No.", "Firm type", "Value", "Share"],
        rows: firmTypeDistributionRows.map((row, index) => [
          index + 1,
          row.name,
          formatCurrency(row.value),
          formatPercent(row.share),
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
        headers: ["S.No.", ...panel.columns.map(getAnalyticsExportHeader)],
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
  if (filter.startsWith("manualMilestoneCurrent:")) {
    const milestone = filter.slice("manualMilestoneCurrent:".length);
    return `${milestone} - Pending`;
  }
  if (filter.startsWith("manualMilestoneCompleted:")) {
    const milestone = filter.slice("manualMilestoneCompleted:".length);
    return `${milestone} - Completed`;
  }
  if (filter.startsWith("bgExpired:")) {
    return `${getMilestoneTitle(filter.slice("bgExpired:".length))} - Expired`;
  }
  if (filter.startsWith("bgToBeReturned:")) {
    return `${getMilestoneTitle(filter.slice("bgToBeReturned:".length))} - To be returned`;
  }
  if (filter.startsWith("bgReturned:")) {
    return `${getMilestoneTitle(filter.slice("bgReturned:".length))} - Returned`;
  }
  if (filter.startsWith("supplyOrderMonth:")) {
    return `Supply Orders - ${formatMonthKeyLabel(filter.slice("supplyOrderMonth:".length))}`;
  }
  if (filter.startsWith("fileInflowMonth:")) {
    return `File Inflow - ${formatMonthKeyLabel(filter.slice("fileInflowMonth:".length))}`;
  }
  if (filter.startsWith("deliverySchedule:")) {
    const [, mode = "gross", monthKey = ""] = filter.split(":");
    return `Delivery Schedule ${mode === "net" ? "Net Pending" : "D.P. Expiring"} - ${formatMonthKeyLabel(monthKey)}`;
  }
  if (filter.startsWith("completedDeliveryMonth:")) {
    return `Completed Deliveries - ${formatMonthKeyLabel(
      filter.slice("completedDeliveryMonth:".length),
    )}`;
  }
  if (filter.startsWith("anomalyFile:")) return "Suspected anomaly";
  if (filter.startsWith("bgExpiryMonth:")) {
    const [, category = "all", monthKey = ""] = filter.split(":");
    const categoryLabel =
      category === "all" ? "All BG" : category === "psbpwb" ? "PSB+PWB" : category.toUpperCase();
    return `BG Expiry ${categoryLabel} - ${formatMonthKeyLabel(monthKey)}`;
  }
  if (filter.startsWith("bgReceiptDelay:")) {
    const [, category = "all", days = ""] = filter.split(":");
    const categoryLabel =
      category === "all" ? "All BG" : category === "psbpwb" ? "PSB+PWB" : category.toUpperCase();
    return `BG Receipt Delay ${categoryLabel} - > ${days} days`;
  }
  if (filter.startsWith("warrantyBgMismatch:")) {
    const [, category = "all", days = ""] = filter.split(":");
    const categoryLabel =
      category === "all" ? "Warranty BG" : category === "psbpwb" ? "PSB+PWB" : category.toUpperCase();
    return `Warranty / BG mismatch ${categoryLabel} - +${days} days`;
  }
  if (filter.startsWith("mode:")) {
    return `Bidding Mode - ${decodeURIComponent(filter.slice("mode:".length))}`;
  }
  if (filter.startsWith("gemBiddingMode:")) {
    return `GeM bidding mode - ${decodeURIComponent(filter.slice("gemBiddingMode:".length))}`;
  }
  if (filter.startsWith("valueThreshold:")) {
    return `File Value Threshold - ${decodeURIComponent(filter.slice("valueThreshold:".length))}`;
  }
  if (filter.startsWith("preBidMeetingFy:") || filter.startsWith("refloatPreBidMeetingFy:")) {
    const [kind = "", state = "all", rawFy = ""] = filter.split(":");
    const fiscalYear = decodeStatusFilterPart(rawFy);
    const isRefloat = kind === "refloatPreBidMeetingFy";
    const stateLabel =
      state === "due" ? "Due" : state === "completed" ? "Completed" : "Total";
    return `${isRefloat ? "Refloat Pre-Bid Meeting" : "Pre-Bid Meeting"} - ${stateLabel}${
      fiscalYear ? ` - FY ${fiscalYear}` : ""
    }`;
  }
  if (filter.startsWith("tcecStatus:")) {
    const [, rawStage = "pre", rawMetric = "reviewed", rawCommittee = "", rawDate = ""] =
      filter.split(":");
    const stage = decodeStatusFilterPart(rawStage) === "post" ? "Post-TCEC" : "Pre-TCEC";
    const metric = decodeStatusFilterPart(rawMetric);
    const metricLabel =
      metric === "signed" ? "Minutes signed" : metric === "pending" ? "Minutes pending" : "Files reviewed";
    const committee = decodeStatusFilterPart(rawCommittee);
    const date = decodeStatusFilterPart(rawDate);
    return `${stage} ${metricLabel}${committee ? ` - ${committee}` : ""}${date ? ` - ${date}` : ""}`;
  }
  if (filter.startsWith("tcecStatusFy:")) {
    const [, rawStage = "pre", rawMetric = "reviewed", rawFy = "", rawCommittee = ""] =
      filter.split(":");
    const stage = decodeStatusFilterPart(rawStage) === "post" ? "Post-TCEC" : "Pre-TCEC";
    const metric = decodeStatusFilterPart(rawMetric);
    const metricLabel =
      metric === "signed" ? "Minutes signed" : metric === "pending" ? "Minutes pending" : "Files reviewed";
    const fiscalYear = decodeStatusFilterPart(rawFy);
    const committee = decodeStatusFilterPart(rawCommittee);
    return `${stage} ${metricLabel}${fiscalYear ? ` - FY ${fiscalYear}` : ""}${committee ? ` - ${committee}` : ""}`;
  }
  if (filter.startsWith("cncSummary:")) {
    const [, rawMetric = "reviewed", rawDate = ""] = filter.split(":");
    const metric = decodeStatusFilterPart(rawMetric);
    const date = decodeStatusFilterPart(rawDate);
    const metricLabel =
      metric === "approved"
        ? "CNC approved"
        : metric === "financialSanctionSigned"
          ? "Financial sanction signed"
          : metric === "supplyOrderPlaced"
            ? "S.O. placed"
            : metric === "approvalPending"
              ? "Approval pending"
              : metric === "financialSanctionPending"
                ? "Financial sanction pending"
                : metric === "supplyOrderPending"
                  ? "S.O. pending"
                  : "Cases reviewed";
    return `CNC Summary ${metricLabel}${date ? ` - ${date}` : ""}`;
  }
  if (filter.startsWith("cncSummaryFy:")) {
    const [, rawMetric = "reviewed", rawFy = ""] = filter.split(":");
    const metric = decodeStatusFilterPart(rawMetric);
    const fiscalYear = decodeStatusFilterPart(rawFy);
    const metricLabel =
      metric === "approved"
        ? "CNC approved"
        : metric === "financialSanctionSigned"
          ? "Financial sanction signed"
          : metric === "supplyOrderPlaced"
            ? "S.O. placed"
            : metric === "approvalPending"
              ? "Approval pending"
              : metric === "financialSanctionPending"
                ? "Financial sanction pending"
                : metric === "supplyOrderPending"
                  ? "S.O. pending"
                  : "Cases reviewed";
    return `CNC Summary ${metricLabel}${fiscalYear ? ` - FY ${fiscalYear}` : ""}`;
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

function isDateBefore(date: string | undefined, reference: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const referenceTime = parseLocalDateTime(reference ?? "");
  return dateTime !== undefined && referenceTime !== undefined && dateTime < referenceTime;
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
