import { createFileRoute, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Division,
  type FileRecord,
  type BillReturnCycle,
  type SupplementaryBillDetail,
  type SupplyOrderDetail,
  type ValueThresholdLevel,
  fetchFilesForYear,
  store,
  useAccessibleDivisions,
  useAccessibleFiles,
  useActiveUser,
  useSettings,
} from "@/lib/files-store";
import {
  isBiddingApplicableForFile,
  isContractFileType,
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
  getEffectiveSupplyOrderCurrentMilestone as getCanonicalSupplyOrderCurrentMilestone,
  isExpiredDeliveryPeriodEntry,
  isExtendedDeliveryPeriodEntry,
  getAdvancePaymentCapital,
  getAdvancePaymentRevenue,
  isAdvancePaymentCompleted,
  isAdvancePaymentPaid,
  isAdvancePaymentPending,
  isSupplyOrderMilestoneCurrent as isCanonicalSupplyOrderMilestoneCurrent,
  isValidDeliveryPeriodEntry,
  rawSupplyOrders as normalizedRawSupplyOrders,
} from "@/lib/effective-deliveries";
import { downloadBackendExport, downloadBackendFileSearchExport } from "@/lib/export-download";
import { promptPassword } from "@/lib/delete-password";
import {
  allFileCategoryKeys,
  fileMatchesCategory,
  filterFilesByCategory,
  getVisibleFileCategoryKeys,
  getVisibleFileCategoryOptions,
  serializeFileCategories,
  type FileCategoryOption,
  type FileCategoryKey,
} from "@/lib/file-categories";
import { formatThousandsAndLakhs, getInrAmount, hasAmount, parseAmount } from "@/lib/money";
import {
  hasBillReturnHistory,
  hasCompletedBillReturn,
  hasOpenBillReturn,
  hasReturnedBill,
  hasReturnedBillPaid,
  normalizeBillReturnCycles,
} from "@/lib/refloat-returned-bill";
import {
  isActivePlusCurrentFyClosedYear,
  isAllActiveFilesYear,
  isAllFilesYear,
  isCancelledFile,
  normalizeFinancialYearLabel,
} from "@/lib/year-filter";
import { DateInput, formatIsoDateForDisplay } from "@/components/date-input";
import { HelperContent } from "@/components/helper-content";
import { SearchableDropdown } from "@/components/searchable-dropdown";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  fileMatchesInitiationDateRange,
  getActiveFileInitiationDateRange,
  getFileInitiationDateSearchParams,
  type FileInitiationDateRange,
} from "@/lib/file-initiation-date-filter";
import { filterControlClass, filterLabelClass } from "@/lib/active-filter-style";
import {
  ArrowRight,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Info,
  Lock,
  RotateCcw,
  Search,
  Unlock,
} from "lucide-react";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/quick-entry" });
  },
});

type DashboardTab =
  | "snapshot"
  | "status"
  | "liveStatus"
  | "status3"
  | "status4"
  | "analytics"
  | "finance"
  | "finance1";
const dashboardTabOptions = [
  { key: "status", label: "Status-1" },
  { key: "liveStatus", label: "Status-2" },
  { key: "status3", label: "Status-3" },
  { key: "status4", label: "Status-4" },
  { key: "snapshot", label: "Snapshot" },
  { key: "analytics", label: "Analytics" },
  { key: "finance", label: "Finance" },
  { key: "finance1", label: "FY Snapshot" },
] satisfies Array<{ key: DashboardTab; label: string }>;
type StatusActionMode = "pdf" | "excel" | "search";
type Status4DrillMode = "threshold" | "monthwise";
type Status4DrillState = {
  fiscalYear?: string;
  mode?: Status4DrillMode;
  monthKey?: string;
};
type Status4SortKey = "label" | "total" | `milestone:${string}`;
type Status4SearchFilter = {
  milestone: string;
  metric: Status4MetricKey;
  fiscalYear: string;
  monthKey?: string;
  minValue?: number;
  maxValue?: number;
};
type Status4MetricKey = "applicable" | "cleared" | "current";
type Status4MilestoneMetrics = Record<Status4MetricKey, number>;
type DrillPathItem = { label: string; href?: string };
type DivisionValueSortMode = "value" | "percent";
type DivisionValueDisplayMode = "value" | "percent" | "both";
type AnalyticsResultLimitKey = "5" | "10" | "20" | "50" | "all";
type AnalyticsSortDirection = "desc" | "asc";
type IndentorValueSortKey = "value" | "capital" | "revenue";
type MilestoneClearingViewMode = "ranking" | "chronological";
type MilestoneClearingThresholdFilter = "all" | "unmatched" | `level:${string}`;
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
type CountValueAnalysisMode =
  | "demandValue"
  | "soValue"
  | "countDemandValue"
  | "countSoValue"
  | "countDemandValuePercent"
  | "countSoValuePercent";
type CountValueAnalysisSource = "demand" | "supplyOrder";
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
  helper?: string[];
  helperExamples?: HelperExamples;
  exportNote?: string;
  divisionValueDisplayMode?: DivisionValueDisplayMode;
  columns: AnalyticsTableColumn[];
  rows: Array<Record<string, number | string>>;
};
type HelperExamples = {
  title: string;
  items: string[];
};
type HelperDetails = {
  title: string;
  items: string[];
  buttonLabel?: string;
};

const fileYearSubfilterHelper = [
  "Global Filter first decides the file set.",
  "File Initiation Year then keeps only files started in the selected FY.",
  "All file years means no extra initiation-year restriction.",
  "When Global Filter is All files, the no-restriction option is called Entire database.",
  "Example: Global Filter 2026-27 + Subfilter 2025-26 shows 2025-26 files visible in the 2026-27 file set.",
  "This selection stays for the current browser tab session.",
];

const fileYearLockHelper = [
  "Locks the current File Initiation Year selection for Dashboard and Reports in this browser tab session.",
  "It is not saved as a permanent user or admin setting.",
  "Unlock it when you want File Initiation Year to return to the session default behavior.",
];

const fileInitiationDateRangeHelper = [
  "Further narrows the File Initiation Year subfilter using exact file initiation date.",
  "Leave both dates blank when no initiation date restriction is required.",
];

const analyticsMainHelper = [
  "Analysis and ranking view for the selected dashboard file set.",
  "Use it to compare divisions, firms, indentors, value slabs, delays, and milestone clearing.",
  "Most numbers can be clicked to open the matching files in Search.",
  "Cancelled demand is excluded from normal analytics.",
  "Value/liability panels exclude cancelled S.O. rows; history/statistical panels may include them.",
];

const dashboardTabHelpers: Partial<Record<DashboardTab, string[]>> = {
  status: [
    "Main workflow progress view.",
    "Shows live and completed counts for each processing stage.",
    "Use this as the reference view for status counts.",
    "Cancelled demand is excluded except from its own cancellation counter.",
    "Total files is a file-scope count. Fully S.O.-cancelled files may remain in that total for history/context, but live workflow, payment, delivery, BG, and liability counters exclude them.",
    "D.P. Valid and D.P. Extended are shown separately.",
  ],
  liveStatus: [
    "Live division-wise status view.",
    "Shows where files are pending right now.",
    "Cancelled demand and File Closed are not counted as live work.",
    "Delivery Period combines normal valid D.P. and extended valid D.P.",
    "Delivered material or completed job is removed from live Delivery Period.",
  ],
  status3: [
    "Tabular replica/view of Status-1.",
    "Uses the same counter and clicker logic as Status-1.",
    "Shows the same information in grouped table form.",
    "A Status-3 number should match the related Status-1 counter, or the sum of related Status-1 counters.",
  ],
  status4: [
    "File-processing view up to Supply Order placement.",
    "One file counts once, even if it has multiple S.O.s.",
    "Applicable means the file is eligible for that stage.",
    "Cancelled S.O. does not affect Status-4.",
  ],
  snapshot: [
    "Quick statistical snapshot of the selected file set.",
    "Use it to see file type, firm type, mode, and attribute distribution.",
    "Cancelled demand is excluded.",
    "Cancelled S.O. and shortclosed S.O. records can remain visible in Firm Type, File Type, PSB, and other statistical/history views when they belong to the selected Global/Subfilter scope.",
  ],
  analytics: analyticsMainHelper,
  finance: [
    "Finance and value/liability view.",
    "Shows allocation, intended, booked, committed, payment, and carry-forward values.",
    "Cancelled demand is excluded.",
    "Cancelled S.O. rows are excluded from finance value calculations.",
  ],
  finance1: [
    "Select an FY to see files started in that FY, their value, payments, pending liabilities, and present status.",
    "Select any FY. Subfilter is locked to the same FY for this page.",
    "For a running FY, FY-end cards are provisional because they use the selected FY-end cutoff and the data entered so far.",
    "Today cards remain live and show the latest stored payment/liability position.",
  ],
};

type AnalyticsSearchTarget = {
  dashboardFilter?: string;
  extraDashboardFilters?: string[];
  division?: string;
  includeModes?: string[];
  analyticsType?: "firm" | "indentor";
  analyticsNames?: string[];
  capitalOnly?: boolean;
  revenueOnly?: boolean;
  focusSection?: string;
  focusMilestone?: string;
  focusTarget?: string;
  drillPath?: DrillPathItem[];
};
type TcecStatusStage = "pre" | "post";
type SummarySubMetric = {
  label: string;
  value: number | string;
  searchFilter?: string;
  help?: string | readonly string[];
};
type FinanceSplitValue = { capital: string; revenue: string };
type FinanceSplitHelp = { capital: string | string[]; revenue: string | string[] };
type SummaryMetricValue = number | string | FinanceSplitValue | SummarySubMetric[];
type FinanceCarryForwardTotal = { count: number; capital: number; revenue: number; total: number };
type FinanceCarryForwardRow = FinanceCarryForwardTotal & {
  year: string;
  filter: string;
};
type FinancePaymentLiabilityEntry =
  | {
      kind: "main";
      file: FileRecord;
      order: SupplyOrderDetail;
      sourceDate?: string;
      paymentDate?: string;
      capital: number;
      revenue: number;
      pending: boolean;
    }
  | {
      kind: "supplementary";
      file: FileRecord;
      order: SupplyOrderDetail;
      bill: SupplementaryBillDetail;
      sourceDate?: string;
      paymentDate?: string;
      capital: number;
      revenue: number;
      pending: boolean;
    };
type DelayStatusSummary = {
  averageDays: number;
  longestDays: number;
  byMilestone: Array<{ key: string; label: string; count: number }>;
};
type DelayMilestoneOption = { key: string; label: string };
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
  controlNo: string;
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
type SummaryStat = {
  label: string;
  value: SummaryMetricValue;
  hint?: string | string[];
  searchFilter?: string;
};

function hasAnomalyAdminAccess(role?: string) {
  return role === "admin" || role === "sub_admin";
}

const statusFileExportHelpers = {
  pdf: [
    "Exports the complete Status-1 file-status table as a PDF.",
    "The export uses the same Global Filter, File Initiation Year subfilter, initiation date range, division, and File Type filter visible on Dashboard.",
  ],
  excel: [
    "Exports the complete Status-1 file-status table as an Excel file.",
    "The export uses the same Global Filter, File Initiation Year subfilter, initiation date range, division, and File Type filter visible on Dashboard.",
  ],
} as const;

const dashboardSectionRuleHelpers = {
  status1: [
    "Main workflow view. Use it as the reference for all status counts.",
    "Live numbers mean action is still pending now. Completed/cleared numbers mean the stage is already crossed.",
    "Cancelled demand is excluded, except from its own cancellation counter.",
    "File Closed is shown or hidden as per the selected Global Filter.",
    "D.P. Valid and D.P. Extended are separate here.",
  ],
  status2: [
    "Live division-wise view. It shows where files are pending right now.",
    "Cancelled demand and File Closed are not counted as live work.",
    "Each file is counted at its current pending milestone.",
    "Delivery Period includes both normal valid D.P. and extended valid D.P.",
    "If material is received or job is completed, the file is no longer counted in live Delivery Period.",
  ],
  status3: [
    "Status-3 is the tabular replica/view of Status-1.",
    "It uses the same counter logic and clicker logic as Status-1.",
    "Counts are displayed in grouped table form.",
    "Any Status-3 number should match the corresponding Status-1 live/history counter.",
    "Where Status-1 splits a stage into multiple boxes, the Status-3 number may be the sum of the relevant Status-1 counters.",
  ],
  status4: [
    "File-processing view up to Supply Order placement.",
    "It is file based: one file counts once, even if it has multiple S.O.s.",
    "Cancelled demand is excluded.",
    "Cancelled S.O. does not affect Status-4.",
    "Applicable means the file is eligible for that stage.",
  ],
  snapshot: [
    "Snapshot is statistical, not live workflow liability.",
    "Cancelled demand files are excluded from normal snapshot numbers.",
    "Cancelled S.O. history can remain visible in statistical views such as PSB, Firm Type, and File Type.",
    "File Closed follows the selected Global Filter.",
    "Clickers open the same statistical set represented by the number.",
  ],
  finance: [
    "Finance is a mixed live/activity value view, not a frozen FY-end file-group report.",
    "When a specific FY is selected, some values use that FY as an activity-date filter, while other values show the current position of the selected dashboard file set.",
    "Intended, Booked, and Committed can change later if file/S.O. data is added, corrected, cancelled, shortclosed, or edited after that FY.",
    "Payment in FY and Carry Forward use payment/S.O. dates to place rows in the selected FY context.",
    "Files may belong to an earlier FY by initiation year but still contribute here if the finance activity/date rule matches this Finance view.",
    "Cancelled demand files are excluded.",
    "Cancelled S.O. rows are excluded from value calculations and finance liability.",
    "Shortclosed S.O. rows remain included for completed/history views. In liability, balance, and carry-forward views, only real pending payable items are counted; the old full S.O. value is not treated as payable by itself.",
    "File Closed follows the selected Global Filter.",
  ],
  analytics: [
    "Analytics uses the same Dashboard Global Filter, File Initiation Year subfilter, initiation date, division, and File Type filter.",
    "Cancelled demand files are excluded from normal analytics.",
    "Cancelled S.O. treatment depends on the panel: value/liability panels exclude cancelled S.O. rows; statistical/history panels may include them.",
    "Clicking an analytics number opens Search with the same panel logic.",
    "Milestone clearing is stage/file based; finance panels are value/liability based.",
  ],
} as const;

const deliveryPeriodMetricHelpers = {
  valid: [
    "S.O. exists and the original D.P. date is today or later.",
    "No revised D.P. is present; revised/extended cases are not counted here.",
    "Material receipt/job completion must still be pending.",
    "Cancelled demand and cancelled S.O. are excluded. Shortclosed S.O. rows are included where completed/history or pending liability still exists.",
  ],
  expired: [
    "S.O. exists and the effective D.P. date is before today.",
    "Material receipt/job completion must still be pending.",
    "Cancelled demand and cancelled S.O. are excluded. Shortclosed S.O. rows are included where completed/history or pending liability still exists.",
  ],
  extended: [
    "Revised D.P. exists and the revised/effective D.P. date is today or later.",
    "Material receipt/job completion must still be pending.",
    "This is kept separate from normal D.P. Valid in Status-1 and Status-3.",
  ],
} as const;

const statusActionModes = [
  {
    key: "pdf",
    label: "PDF",
    icon: FileText,
    helper: [
      "When a Status-1 count is clicked, opens the matching files as a PDF.",
      "The clicked count decides the extra status condition applied to the export.",
    ],
  },
  {
    key: "excel",
    label: "Excel",
    icon: FileSpreadsheet,
    helper: [
      "When a Status-1 count is clicked, downloads the matching files in Excel format.",
      "The clicked count decides the extra status condition applied to the export.",
    ],
  },
  {
    key: "search",
    label: "Search file",
    icon: Search,
    helper: [
      "When a Status-1 count is clicked, opens the matching files in Search Files.",
      "The landing carries Dashboard filter context and focuses the matching status condition.",
    ],
  },
] satisfies Array<{
  key: StatusActionMode;
  label: string;
  icon: typeof Search;
  helper: string[];
}>;

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

type DashboardSummaryPayload = {
  activeDivision: string;
  valueThresholdLevels: ValueThresholdLevel[];
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
  financeTotals: {
    allocatedCapital: number;
    allocatedRevenue: number;
    bookedCapital: number;
    bookedRevenue: number;
    projectedCapital: number;
    projectedRevenue: number;
    spentCapital: number;
    spentRevenue: number;
    paidTillDateCapital?: number;
    paidTillDateRevenue?: number;
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
  finance1Summary?: Finance1Summary;
};

type CoBiddingFirmRow = {
  key: string;
  uniqueNumber: string;
  name: string;
  city: string;
  tendersParticipated: number;
  soCount: number;
  soValue: number;
  count: number;
};

type CoBiddingTenderRow = {
  id: string;
  uniqueCode: string;
  controlNo: string;
  itemDescription: string;
  indentor: string;
  soYear: string;
  soFirm: string;
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

type Status3WorkflowGroup = {
  key: string;
  title: string;
  sections: StatusSummaryTableGroup[];
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

async function fetchCoBiddingResults(query: string, signal: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}/api/dashboard/co-bidding-firms?${query}`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Co-bidding request failed: ${response.status}`);
  }
  return (await response.json()) as { firms: CoBiddingFirmRow[]; tenders: CoBiddingTenderRow[] };
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
      delayMilestoneOptions?: DelayMilestoneOption[];
      preBidMeetingRows: PreBidMeetingRow[];
    };
  };
}

async function downloadDashboardStatusFiles({
  dashboardFilter,
  division,
  selectedYear,
  fileYear,
  fileInitiationDateRange,
  fileCategories,
  format,
  title,
}: {
  dashboardFilter: string;
  division: string;
  selectedYear: string;
  fileYear?: string;
  fileInitiationDateRange?: FileInitiationDateRange;
  fileCategories?: string;
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
      ...(fileYear && fileYear !== "all" ? { fileYear } : {}),
      ...getFileInitiationDateSearchParams(fileInitiationDateRange),
      ...(fileCategories ? { fileCategories } : {}),
      ...(division === "all" ? {} : { divisionFilter: division }),
    },
  });
}

const analyticsResultLimitOptions = [
  { value: "5", label: "Top 5" },
  { value: "10", label: "Top 10" },
  { value: "20", label: "Top 20" },
  { value: "50", label: "Top 50" },
  { value: "all", label: "All" },
] satisfies Array<{ value: AnalyticsResultLimitKey; label: string }>;
const fallbackDelayMilestoneOptions = [
  { key: "workflowNotStarted", label: "Workflow Not Started" },
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
  { key: "billReturnedForCorrection", label: "Returned Bills" },
  {
    key: "supplementaryBillReturnedForCorrection",
    label: "Supplementary bill returned for correction",
  },
  { key: "payment", label: "Payment" },
] satisfies DelayMilestoneOption[];
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
const dashboardSummaryQueryVersion = "5";
const supplyOrderMilestoneNames = [
  "Financial Sanction",
  "Advance Payment",
  "Supply Order",
  "Delivery Period",
  "PSB",
  "PWB",
  "PSB+PWB",
  "Job Completion",
  "IR Preparation",
  "IR Receipt",
  "Bill preparation",
  "Bill sent for payment",
  "Bill returned for correction",
  "Payment",
];
const status2MilestoneHelpers: Record<string, readonly string[]> = {
  financialsanction: [
    "Header: Financial Sanction",
    "Counts files currently pending for Financial Sanction.",
    "Cleared cases move out of this live Status-2 option.",
  ],
  advancepayment: [
    "Header: Advance Payment",
    "Counts active S.O. rows where Advance Payment is Yes, Advance Payment is the current milestone, and advance payment date is blank.",
    "Cancelled demand, File Closed, and cancelled S.O. rows are excluded from this live count.",
  ],
  supplyorder: [
    "Header: Supply Order",
    "Counts files currently pending for S.O. placement after Financial Sanction.",
    "S.O. already placed moves out of this pending live option.",
  ],
  deliveryperiod: [
    "Header: Delivery Period",
    "Counts S.O./stage rows whose normal or revised D.P. is currently active, with delivery/job completion still pending.",
    "Future stages that have not started, completed rows, cancelled demands, and cancelled S.O.s are excluded.",
    "Clicking opens matching files; a file with multiple qualifying stages appears once in Search.",
  ],
  psb: [
    "Header: PSB",
    "Counts active S.O. rows where PSB is applicable and PSB receipt is still pending.",
    "Cancelled demand, File Closed, and cancelled S.O. rows are excluded from this live count.",
  ],
  pwb: [
    "Header: PWB",
    "Counts active S.O. rows where PWB is applicable and PWB receipt is still pending.",
    "Cancelled demand, File Closed, and cancelled S.O. rows are excluded from this live count.",
  ],
  psbpwb: [
    "Header: PSB+PWB",
    "Counts active S.O. rows where combined PSB+PWB is applicable and receipt is still pending.",
    "Cancelled demand, File Closed, and cancelled S.O. rows are excluded from this live count.",
  ],
  jobcompletion: [
    "Header: Job Completion",
    "Counts active contract/service S.O./stage rows where job completion is due and not yet done.",
    "Completed jobs move out of this live option.",
  ],
  irpreparation: [
    "Header: IR Preparation",
    "Counts active inspection cases where material is received and IR preparation is still pending.",
    "IR prepared cases move to IR Receipt pending where applicable.",
  ],
  irreceipt: [
    "Header: IR Receipt",
    "Counts active inspection cases where IR is prepared/sent and IR receipt is still pending.",
    "IR received cases move out of this live option.",
  ],
  billpreparation: [
    "Header: Bill preparation",
    "Counts active payable cases where delivery/job condition is met but bill preparation is still pending.",
    "Returned-bill correction cases are tracked separately.",
  ],
  billsentforpayment: [
    "Header: Bill sent for payment",
    "Counts active payable cases where bill is prepared but not yet sent/submitted for payment.",
    "Returned-bill correction cases are tracked separately.",
  ],
  billreturnedforcorrection: [
    "Header: Returned Bills",
    "Counts active returned-bill cases where correction/resubmission is still pending.",
    "Paid or resubmitted returned bills move out of this live option.",
  ],
  supplementarybillreturnedforcorrection: [
    "Header: Supplementary bill returned for correction",
    "Counts active supplementary returned-bill cases where correction/resubmission is still pending.",
    "Supplementary bills without an open return are not counted here.",
  ],
  payment: [
    "Header: Payment",
    "Counts active payable S.O./stage rows where payment is due, in process, or submitted but not paid.",
    "This is a payment-case count, not a unique-file count. One file can contribute more than one pending payment case.",
    "Bills returned for correction are tracked separately until resubmitted.",
  ],
};

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
    value === "preBidMeetings" ||
    value === "tcecStatus" ||
    value === "cncSummary" ||
    value === "suspectedAnomaly" ||
    value === "delayStatus" ||
    value === "milestoneClearingTable"
  );
}

function isDashboardTab(value: unknown): value is DashboardTab {
  return typeof value === "string" && dashboardTabOptions.some((option) => option.key === value);
}

export function Dashboard() {
  const locationSearch = useRouterState({ select: (state) => state.location.search });
  const files = useAccessibleFiles();
  const divisions = useAccessibleDivisions();
  const settings = useSettings();
  const activeUser = useActiveUser();
  const navigate = useNavigate();
  const divisionFilterStorageKey = `recordkeeper:division-filter:${activeUser?.id ?? "anonymous"}`;
  const fileCategoryFilterStorageKey = `recordkeeper:file-category-filter:${activeUser?.id ?? "anonymous"}`;
  const fileYearFilterStorageKey = `recordkeeper:file-year-filter:${activeUser?.id ?? "anonymous"}`;
  const fileInitiationDateRangeStorageKey = `recordkeeper:file-initiation-date-range:${
    activeUser?.id ?? "anonymous"
  }`;
  const [selectedDivision, setSelectedDivision] = useState(() => {
    if (typeof window === "undefined") return "all";
    return window.sessionStorage.getItem(divisionFilterStorageKey) ?? "all";
  });
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
    const requestedTab = typeof locationSearch.tab === "string" ? locationSearch.tab : undefined;
    const requestedPanel =
      typeof locationSearch.analyticsPanel === "string" ? locationSearch.analyticsPanel : undefined;
    setActiveDashboardTab(isDashboardTab(requestedTab) ? requestedTab : "status");
    if (isAnalyticsPanelKey(requestedPanel)) setActiveAnalyticsPanel(requestedPanel);
  }, [locationSearch.analyticsPanel, locationSearch.tab]);
  const [topFirmLimit, setTopFirmLimit] = useState<AnalyticsResultLimitKey>("20");
  const [selectedFirmAnalysisFirm, setSelectedFirmAnalysisFirm] = useState("");
  const [firmAnalysisView, setFirmAnalysisView] = useState<"existing" | "coParticipants">("existing");
  const [coParticipantFirm, setCoParticipantFirm] = useState("");
  const [selectedCoParticipantFirm, setSelectedCoParticipantFirm] = useState("");
  const [coBiddingFirms, setCoBiddingFirms] = useState<CoBiddingFirmRow[]>([]);
  const [coBiddingTenders, setCoBiddingTenders] = useState<CoBiddingTenderRow[]>([]);
  const [coBiddingLoading, setCoBiddingLoading] = useState(false);
  const [coBiddingError, setCoBiddingError] = useState<string>();
  const [firmAnalysisOperators, setFirmAnalysisOperators] = useState<
    Record<string, FirmAnalysisOperator>
  >({});
  const [negatedFirmAnalysisRoles, setNegatedFirmAnalysisRoles] = useState<FirmAnalysisRoleKey[]>(
    [],
  );
  const [selectedFirmAnalysisRoles, setSelectedFirmAnalysisRoles] = useState<FirmAnalysisRoleKey[]>(
    ["bq", "invited", "participated", "order"],
  );
  const [countValueAnalysisMode, setCountValueAnalysisMode] =
    useState<CountValueAnalysisMode>("demandValue");
  const [financeFirmTypeDistributionKey, setFinanceFirmTypeDistributionKey] =
    useState<FinanceFirmTypeDistributionKey>("supplyOrderValue");
  const [indentorsByFilesLimit, setIndentorsByFilesLimit] = useState<AnalyticsResultLimitKey>("10");
  const [indentorsByValueLimit, setIndentorsByValueLimit] = useState<AnalyticsResultLimitKey>("10");
  const [indentorsByValueSortKey, setIndentorsByValueSortKey] =
    useState<IndentorValueSortKey>("value");
  const [topFirmPage, setTopFirmPage] = useState(1);
  const [indentorsByFilesPage, setIndentorsByFilesPage] = useState(1);
  const [indentorsByValuePage, setIndentorsByValuePage] = useState(1);
  const [analyticsSortDirections, setAnalyticsSortDirections] = useState<
    Partial<Record<AnalyticsPanelKey, AnalyticsSortDirection>>
  >({});
  const [milestoneClearingViewMode, setMilestoneClearingViewMode] =
    useState<MilestoneClearingViewMode>("chronological");
  const [milestoneClearingValueThreshold, setMilestoneClearingValueThreshold] =
    useState<MilestoneClearingThresholdFilter>("all");
  const [milestoneClearingMode, setMilestoneClearingMode] = useState("all");
  const [milestoneClearingSourceFiles, setMilestoneClearingSourceFiles] = useState<FileRecord[]>();
  const [milestoneClearingFilesLoading, setMilestoneClearingFilesLoading] = useState(false);
  const [milestoneClearingFilesError, setMilestoneClearingFilesError] = useState<string>();
  const [analyticsDelayDays, setAnalyticsDelayDays] = useState("5");
  const [analyticsDelayMilestoneKey, setAnalyticsDelayMilestoneKey] = useState("all");
  const [tcecStatusStage, setTcecStatusStage] = useState<TcecStatusStage>("pre");
  const [selectedPreBidFiscalYear, setSelectedPreBidFiscalYear] = useState("");
  const [selectedTcecFiscalYear, setSelectedTcecFiscalYear] = useState("");
  const [selectedTcecCommittee, setSelectedTcecCommittee] = useState("");
  const [selectedCncFiscalYear, setSelectedCncFiscalYear] = useState("");
  const [selectedFileCategories, setSelectedFileCategories] =
    useState<FileCategoryKey[]>(() => {
      if (typeof window === "undefined") return allFileCategoryKeys;
      try {
        const saved = JSON.parse(
          window.sessionStorage.getItem(fileCategoryFilterStorageKey) ?? "null",
        );
        const selected = Array.isArray(saved?.selected)
          ? saved.selected.filter((key: unknown): key is FileCategoryKey =>
              allFileCategoryKeys.includes(key as FileCategoryKey),
            )
          : undefined;
        return selected?.length ? selected : allFileCategoryKeys;
      } catch {
        return allFileCategoryKeys;
      }
    });
  const [fileCategoryFilterTouched, setFileCategoryFilterTouched] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const saved = JSON.parse(
        window.sessionStorage.getItem(fileCategoryFilterStorageKey) ?? "null",
      );
      return saved?.touched === true;
    } catch {
      return false;
    }
  });
  const [selectedFileYear, setSelectedFileYear] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = JSON.parse(window.sessionStorage.getItem(fileYearFilterStorageKey) ?? "null");
        if (typeof saved?.year === "string") return saved.year;
      } catch {
        // Fall through to the current FY default.
      }
    }
    return settings.financialYear || "all";
  });
  const [fileYearLocked, setFileYearLocked] = useState(false);
  const [fileInitiationFromDate, setFileInitiationFromDate] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const saved = JSON.parse(
        window.sessionStorage.getItem(fileInitiationDateRangeStorageKey) ?? "null",
      );
      return typeof saved?.fromDate === "string" ? saved.fromDate : "";
    } catch {
      return "";
    }
  });
  const [fileInitiationToDate, setFileInitiationToDate] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const saved = JSON.parse(
        window.sessionStorage.getItem(fileInitiationDateRangeStorageKey) ?? "null",
      );
      return typeof saved?.toDate === "string" ? saved.toDate : "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(divisionFilterStorageKey, selectedDivision);
  }, [divisionFilterStorageKey, selectedDivision]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(
      fileCategoryFilterStorageKey,
      JSON.stringify({ selected: selectedFileCategories, touched: fileCategoryFilterTouched }),
    );
  }, [fileCategoryFilterStorageKey, fileCategoryFilterTouched, selectedFileCategories]);
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
  const [analyticsDelaySummary, setAnalyticsDelaySummary] = useState<DelayStatusSummary>();
  const [analyticsPreBidRows, setAnalyticsPreBidRows] = useState<PreBidMeetingRow[]>([]);
  const [suspectedAnomalyRows, setSuspectedAnomalyRows] = useState<SuspectedAnomalyRow[]>([]);
  const [suspectedAnomalyLoading, setSuspectedAnomalyLoading] = useState(false);
  const [suspectedAnomalyError, setSuspectedAnomalyError] = useState<string | undefined>();
  const [anomalyAcceptances, setAnomalyAcceptances] = useState<AnomalyAcceptanceRow[]>([]);
  const [anomalyAdminLoading, setAnomalyAdminLoading] = useState(false);
  const [anomalyAdminError, setAnomalyAdminError] = useState<string | undefined>();
  const [status4Drill, setStatus4Drill] = useState<Status4DrillState>({});
  const [status4SortKey, setStatus4SortKey] = useState<Status4SortKey>("label");
  const [status4SortDirection, setStatus4SortDirection] = useState<AnalyticsSortDirection>("asc");
  const [status4SourceFiles, setStatus4SourceFiles] = useState<FileRecord[]>();
  const [status4FilesLoading, setStatus4FilesLoading] = useState(false);
  const [status4FilesError, setStatus4FilesError] = useState<string>();
  const [backendDelayMilestoneOptions, setBackendDelayMilestoneOptions] = useState<
    DelayMilestoneOption[]
  >([]);
  const hasLoadedDashboardSummaryRef = useRef(false);
  const effectiveDelayMilestoneOptions = backendDelayMilestoneOptions.length
    ? backendDelayMilestoneOptions
    : fallbackDelayMilestoneOptions;
  useEffect(() => {
    if (
      analyticsDelayMilestoneKey !== "all" &&
      !effectiveDelayMilestoneOptions.some((option) => option.key === analyticsDelayMilestoneKey)
    ) {
      setAnalyticsDelayMilestoneKey("all");
    }
  }, [analyticsDelayMilestoneKey, effectiveDelayMilestoneOptions]);
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
    () =>
      getVisibleFileCategoryKeys(
        activeUser?.role === "editor" ? activeUser.allowedFileCategories : undefined,
        settings.fileTypes,
      ),
    [activeUser?.allowedFileCategories, activeUser?.role, settings.fileTypes],
  );
  const visibleFileCategoryOptions = useMemo(
    () =>
      getVisibleFileCategoryOptions(
        activeUser?.role === "editor" ? activeUser.allowedFileCategories : undefined,
        settings.fileTypes,
      ),
    [activeUser?.allowedFileCategories, activeUser?.role, settings.fileTypes],
  );
  useEffect(() => {
    setSelectedFileCategories((current) => {
      const allFixedSelected = allFileCategoryKeys.every((key) => current.includes(key));
      const visible = new Set(visibleFileCategoryKeys);
      const next = current.filter((key) => visible.has(key));
      if (allFixedSelected && next.length < visibleFileCategoryKeys.length) {
        return visibleFileCategoryKeys;
      }
      return next.length ? next : visibleFileCategoryKeys;
    });
  }, [visibleFileCategoryKeys]);
  const selectedDivisionIsAccessible =
    selectedDivision === "all" || divisions.some((division) => division.name === selectedDivision);
  const activeDivision = selectedDivisionIsAccessible ? selectedDivision : "all";
  const fileYearOptions = useMemo(
    () => Array.from(new Set(settings.financialYears ?? [])).filter(Boolean),
    [settings.financialYears],
  );
  const availableFileYearOptions = useMemo(() => {
    const globalYearStart = getFinancialYearStartNumber(settings.selectedYear);
    if (globalYearStart === undefined) return fileYearOptions;
    return fileYearOptions.filter((year) => {
      const yearStart = getFinancialYearStartNumber(year);
      return yearStart === undefined || yearStart <= globalYearStart;
    });
  }, [fileYearOptions, settings.selectedYear]);
  const finance1Year =
    normalizeFinancialYearLabel(settings.selectedYear) ||
    settings.financialYear ||
    availableFileYearOptions[0] ||
    "";
  const defaultFileYear =
    getFinancialYearStartNumber(settings.selectedYear) !== undefined &&
    availableFileYearOptions.includes(settings.selectedYear)
      ? settings.selectedYear
      : availableFileYearOptions.includes(settings.financialYear)
        ? settings.financialYear
        : (availableFileYearOptions[0] ?? "all");
  const fileYearAllOptionLabel = isAllFilesYear(settings.selectedYear)
    ? "Entire database"
    : "All file years";
  const activeFileYear =
    activeDashboardTab === "finance1"
      ? finance1Year || defaultFileYear
      : selectedFileYear === "all" || availableFileYearOptions.includes(selectedFileYear)
        ? selectedFileYear
        : defaultFileYear;
  useEffect(() => {
    if (typeof window === "undefined" || !availableFileYearOptions.length) return;
    const saved = window.sessionStorage.getItem(fileYearFilterStorageKey);
    if (!saved) {
      setFileYearLocked(false);
      setSelectedFileYear(defaultFileYear);
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      const locked = parsed?.locked === true;
      const year = typeof parsed?.year === "string" ? parsed.year : defaultFileYear;
      setFileYearLocked(locked);
      setSelectedFileYear(
        year === "all" || availableFileYearOptions.includes(year) ? year : defaultFileYear,
      );
    } catch {
      setFileYearLocked(false);
      setSelectedFileYear(defaultFileYear);
    }
  }, [availableFileYearOptions, defaultFileYear, fileYearFilterStorageKey]);
  const updateFileYearSelection = (year: string) => {
    setSelectedFileYear(year);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        fileYearFilterStorageKey,
        JSON.stringify({ locked: fileYearLocked, year }),
      );
    }
  };
  const toggleFileYearLock = () => {
    const nextLocked = !fileYearLocked;
    setFileYearLocked(nextLocked);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        fileYearFilterStorageKey,
        JSON.stringify({ locked: nextLocked, year: activeFileYear }),
      );
    }
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem(fileInitiationDateRangeStorageKey);
    if (!saved) {
      setFileInitiationFromDate("");
      setFileInitiationToDate("");
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      setFileInitiationFromDate(typeof parsed?.fromDate === "string" ? parsed.fromDate : "");
      setFileInitiationToDate(typeof parsed?.toDate === "string" ? parsed.toDate : "");
    } catch {
      setFileInitiationFromDate("");
      setFileInitiationToDate("");
    }
  }, [fileInitiationDateRangeStorageKey]);
  const updateFileInitiationDateRange = (patch: Partial<FileInitiationDateRange>) => {
    const nextFromDate = patch.fromDate ?? fileInitiationFromDate;
    const nextToDate = patch.toDate ?? fileInitiationToDate;
    setFileInitiationFromDate(nextFromDate);
    setFileInitiationToDate(nextToDate);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        fileInitiationDateRangeStorageKey,
        JSON.stringify({ fromDate: nextFromDate, toDate: nextToDate }),
      );
    }
  };
  const clearFileInitiationDateRange = () =>
    updateFileInitiationDateRange({ fromDate: "", toDate: "" });
  const activeFileInitiationDateRange = useMemo(
    () => getActiveFileInitiationDateRange(fileInitiationFromDate, fileInitiationToDate),
    [fileInitiationFromDate, fileInitiationToDate],
  );
  const fileInitiationDateQueryParams = useMemo(
    () => getFileInitiationDateSearchParams(activeFileInitiationDateRange),
    [activeFileInitiationDateRange],
  );
  const divisionFilterActive = activeDivision !== "all";
  const fileYearFilterActive =
    activeDashboardTab === "finance1" ? false : activeFileYear !== "all";
  const fileYearSubfilterLockedByPage = activeDashboardTab === "finance1";
  const fileInitiationDateFilterActive = Boolean(activeFileInitiationDateRange);
  const fileCategoryFilterActive =
    fileCategoryFilterTouched &&
    selectedFileCategories.filter((category) => visibleFileCategoryKeys.includes(category))
      .length !== visibleFileCategoryKeys.length;
  const activeFileCategoriesParam = fileCategoryFilterActive
    ? serializeFileCategories(selectedFileCategories)
    : undefined;
  const dashboardExportDescription = getDashboardExportDescription({
    globalYear: settings.selectedYear,
    fileYear: activeFileYear,
    division: activeDivision,
    fileInitiationDateRange: activeFileInitiationDateRange,
    selectedFileCategories,
    visibleFileCategoryOptions,
  });
  const dashboardFiles = useMemo(
    () =>
      (activeDivision === "all" ? files : files.filter((file) => file.division === activeDivision))
        .filter((file) => activeFileYear === "all" || file.year === activeFileYear)
        .filter((file) => fileMatchesInitiationDateRange(file, activeFileInitiationDateRange)),
    [activeDivision, activeFileInitiationDateRange, activeFileYear, files],
  );
  const categoryFilteredDashboardFiles = useMemo(
    () =>
      fileCategoryFilterActive
        ? filterFilesByCategory(dashboardFiles, selectedFileCategories)
        : dashboardFiles,
    [dashboardFiles, fileCategoryFilterActive, selectedFileCategories],
  );
  const dashboardProcessFiles = useMemo(
    () => categoryFilteredDashboardFiles.filter((file) => !isYes(file.demandCancelled)),
    [categoryFilteredDashboardFiles],
  );
  const activeDashboardStatusFiles = useMemo(
    () => dashboardProcessFiles.filter((file) => !isCancelledFile(file)),
    [dashboardProcessFiles],
  );
  const finance1ScopedFiles = useMemo(() => {
    const divisionScopedFiles =
      activeDivision === "all" ? files : files.filter((file) => file.division === activeDivision);
    return fileCategoryFilterActive
      ? filterFilesByCategory(divisionScopedFiles, selectedFileCategories)
      : divisionScopedFiles;
  }, [activeDivision, fileCategoryFilterActive, files, selectedFileCategories]);
  const localFinance1Summary = useMemo(
    () => getFinance1Summary(finance1ScopedFiles, finance1Year),
    [finance1ScopedFiles, finance1Year],
  );
  const processHistoryDashboardFiles = dashboardProcessFiles;
  const dashboardDivisions = useMemo(
    () =>
      activeDivision === "all"
        ? divisions
        : divisions.filter((division) => division.name === activeDivision),
    [activeDivision, divisions],
  );
  const filteredAnalyticsFiles = activeDashboardStatusFiles;

  const dashboardSummaryQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("version", dashboardSummaryQueryVersion);
    params.set("division", activeDivision);
    params.set("selectedYear", settings.selectedYear);
    if (activeFileYear !== "all") params.set("fileYear", activeFileYear);
    Object.entries(fileInitiationDateQueryParams).forEach(([key, value]) => params.set(key, value));
    if (activeFileCategoriesParam) params.set("fileCategories", activeFileCategoriesParam);
    if (finance1Year) params.set("finance1Year", finance1Year);
    if (selectedLiveMilestones) {
      params.set("liveMilestones", selectedLiveMilestones.join(","));
    }
    return params.toString();
  }, [
    activeDivision,
    fileInitiationDateQueryParams,
    activeFileYear,
    activeFileCategoriesParam,
    finance1Year,
    selectedLiveMilestones,
    settings.selectedYear,
  ]);
  const coBiddingQuery = useMemo(() => {
    if (!coParticipantFirm.trim()) return "";
    const params = new URLSearchParams(dashboardSummaryQuery);
    params.set("mainFirm", coParticipantFirm.trim());
    if (selectedCoParticipantFirm) params.set("partnerKey", selectedCoParticipantFirm);
    return params.toString();
  }, [coParticipantFirm, dashboardSummaryQuery, selectedCoParticipantFirm]);
  useEffect(() => {
    if (
      !coBiddingQuery ||
      activeDashboardTab !== "analytics" ||
      activeAnalyticsPanel !== "firmAnalysis" ||
      firmAnalysisView !== "coParticipants"
    ) {
      setCoBiddingFirms([]);
      setCoBiddingTenders([]);
      setCoBiddingError(undefined);
      return;
    }
    const controller = new AbortController();
    setCoBiddingLoading(true);
    setCoBiddingError(undefined);
    fetchCoBiddingResults(coBiddingQuery, controller.signal)
      .then((payload) => {
        setCoBiddingFirms(payload.firms);
        setCoBiddingTenders(payload.tenders);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setCoBiddingFirms([]);
        setCoBiddingTenders([]);
        setCoBiddingError(error instanceof Error ? error.message : "Could not load co-bidding data.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCoBiddingLoading(false);
      });
    return () => controller.abort();
  }, [
    activeAnalyticsPanel,
    activeDashboardTab,
    coBiddingQuery,
    firmAnalysisView,
  ]);
  const dashboardSummary =
    dashboardSummaryState?.query === dashboardSummaryQuery
      ? dashboardSummaryState.summary
      : undefined;
  const finance1Summary = dashboardSummary?.finance1Summary
    ? {
        ...localFinance1Summary,
        ...dashboardSummary.finance1Summary,
        fileTypeDistribution: dashboardSummary.finance1Summary.fileTypeDistribution ?? [],
        firmTypeDistribution: dashboardSummary.finance1Summary.firmTypeDistribution ?? [],
      }
    : localFinance1Summary;
  const analyticsDelayQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("division", activeDivision);
    params.set("selectedYear", settings.selectedYear);
    if (activeFileYear !== "all") params.set("fileYear", activeFileYear);
    Object.entries(fileInitiationDateQueryParams).forEach(([key, value]) => params.set(key, value));
    if (activeFileCategoriesParam) params.set("fileCategories", activeFileCategoriesParam);
    params.set("delayDays", analyticsDelayDays || "0");
    params.set("expectedCashOutgoDays", "0");
    params.set("delayMilestone", analyticsDelayMilestoneKey);
    return params.toString();
  }, [
    activeDivision,
    activeFileYear,
    analyticsDelayDays,
    analyticsDelayMilestoneKey,
    fileInitiationDateQueryParams,
    activeFileCategoriesParam,
    settings.selectedYear,
  ]);
  const suspectedAnomalyQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("division", activeDivision);
    params.set("selectedYear", settings.selectedYear);
    if (activeFileYear !== "all") params.set("fileYear", activeFileYear);
    Object.entries(fileInitiationDateQueryParams).forEach(([key, value]) => params.set(key, value));
    if (activeFileCategoriesParam) params.set("fileCategories", activeFileCategoriesParam);
    return params.toString();
  }, [
    activeDivision,
    activeFileYear,
    fileInitiationDateQueryParams,
    activeFileCategoriesParam,
    settings.selectedYear,
  ]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `recordkeeper:anomaly-filter-scope:${activeUser?.id ?? "anonymous"}`;
    window.sessionStorage.setItem(
      key,
      JSON.stringify({ selectedYear: settings.selectedYear, query: suspectedAnomalyQuery }),
    );
    window.dispatchEvent(new Event("recordkeeper:anomaly-scope-changed"));
  }, [activeUser?.id, settings.selectedYear, suspectedAnomalyQuery]);
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
    if (activeDashboardTab !== "status4") return;
    let cancelled = false;
    setStatus4FilesLoading(true);
    setStatus4FilesError(undefined);
    fetchFilesForYear(settings.selectedYear)
      .then((payload) => {
        if (!cancelled) setStatus4SourceFiles(payload.files);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setStatus4SourceFiles(undefined);
        setStatus4FilesError(error instanceof Error ? error.message : "Status-4 data failed.");
      })
      .finally(() => {
        if (!cancelled) setStatus4FilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDashboardTab, settings.selectedYear]);

  useEffect(() => {
    if (activeDashboardTab !== "analytics" || activeAnalyticsPanel !== "delayStatus") return;
    const controller = new AbortController();
    fetchDashboardStatusSummary(analyticsDelayQuery, controller.signal)
      .then((payload) => {
        setAnalyticsDelaySummary(payload.summary.delaySummary);
        if (payload.summary.delayMilestoneOptions?.length) {
          setBackendDelayMilestoneOptions(payload.summary.delayMilestoneOptions);
        }
      })
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
    store
      .listSuspectedAnomalyAcceptances()
      .then((acceptancePayload) => {
        if (cancelled) return;
        setAnomalyAcceptances(acceptancePayload.acceptances);
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

  useEffect(() => {
    if (activeDashboardTab !== "analytics" || activeAnalyticsPanel !== "milestoneClearingTable") {
      return;
    }
    let cancelled = false;
    setMilestoneClearingFilesLoading(true);
    setMilestoneClearingFilesError(undefined);
    fetchFilesForYear(settings.selectedYear)
      .then((payload) => {
        if (!cancelled) setMilestoneClearingSourceFiles(payload.files);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setMilestoneClearingSourceFiles(undefined);
        setMilestoneClearingFilesError(
          error instanceof Error ? error.message : "Milestone clearing filter data failed.",
        );
      })
      .finally(() => {
        if (!cancelled) setMilestoneClearingFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeAnalyticsPanel, activeDashboardTab, settings.selectedYear]);

  const needsLocalDashboardFallback = !dashboardSummary;
  const localModeCounts = needsLocalDashboardFallback
    ? getModeCounts(processHistoryDashboardFiles, settings.modes)
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
    ? getMilestoneFlow(dashboardProcessFiles)
    : undefined;
  const localMiscellaneousCounts = needsLocalDashboardFallback
    ? getMiscellaneousCounts(categoryFilteredDashboardFiles)
    : undefined;
  const localAnalytics = needsLocalDashboardFallback
    ? {
        ...getAnalyticsSummary(
          dashboardProcessFiles,
          dashboardDivisions,
          settings.valueThresholdLevels,
          settings.selectedYear,
        ),
        divisionTurnaroundRanking: getDivisionTurnaroundRanking(processHistoryDashboardFiles),
        topFirmSupplyOrders: getTopFirmSupplyOrders(dashboardProcessFiles),
        firmAnalysis: getFirmAnalysisRows(dashboardProcessFiles),
        monthWiseSupplyOrder: getMonthWiseSupplyOrder(dashboardProcessFiles),
        biddingModeMix: getBiddingModeMix(processHistoryDashboardFiles),
        tcecStatus: getTcecStatusSummary(dashboardProcessFiles, settings.selectedYear),
        cncSummary: getCncSummary(dashboardProcessFiles, settings.selectedYear),
      }
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
        paidCapital: getFinancePaymentLiabilityEntries(activeDashboardStatusFiles).reduce(
          (sum, entry) =>
            sum +
            (getFinancialYearForDate(entry.paymentDate) === localFinanceYear ? entry.capital : 0),
          0,
        ),
        paidRevenue: getFinancePaymentLiabilityEntries(activeDashboardStatusFiles).reduce(
          (sum, entry) =>
            sum +
            (getFinancialYearForDate(entry.paymentDate) === localFinanceYear ? entry.revenue : 0),
          0,
        ),
        sameYearPaidCapital: getFinancePaymentLiabilityEntries(activeDashboardStatusFiles).reduce(
          (sum, entry) =>
            sum +
            (getFinancialYearForDate(entry.sourceDate) === localFinanceYear &&
            getFinancialYearForDate(entry.paymentDate) === localFinanceYear
              ? entry.capital
              : 0),
          0,
        ),
        sameYearPaidRevenue: getFinancePaymentLiabilityEntries(activeDashboardStatusFiles).reduce(
          (sum, entry) =>
            sum +
            (getFinancialYearForDate(entry.sourceDate) === localFinanceYear &&
            getFinancialYearForDate(entry.paymentDate) === localFinanceYear
              ? entry.revenue
              : 0),
          0,
        ),
        advanceCapital: advancePaymentEntries(activeDashboardStatusFiles).reduce(
          (sum, { file, order }) =>
            sum +
            (isSupplyOrderCancelled(file, order) ||
            getFinancialYearForDate(order.advancePaymentDetail?.paymentDate) !==
              localFinanceYear
              ? 0
              : (getInrAmount(getAdvancePaymentCapital(order), file) ?? 0)),
          0,
        ),
        advanceRevenue: advancePaymentEntries(activeDashboardStatusFiles).reduce(
          (sum, { file, order }) =>
            sum +
            (isSupplyOrderCancelled(file, order) ||
            getFinancialYearForDate(order.advancePaymentDetail?.paymentDate) !==
              localFinanceYear
              ? 0
              : (getInrAmount(getAdvancePaymentRevenue(order), file) ?? 0)),
          0,
        ),
      }
    : undefined;
  const dashboardFileCount =
    dashboardSummary?.dashboardFileCount ?? dashboardProcessFiles.length;
  const dashboardDivisionsForView = dashboardSummary?.dashboardDivisions ?? dashboardDivisions;
  const modeCounts = dashboardSummary?.modeCounts ?? localModeCounts ?? [];
  const gemBiddingModeCounts =
    dashboardSummary?.gemBiddingModeCounts ??
    (needsLocalDashboardFallback ? getGemBiddingModeCounts(processHistoryDashboardFiles) : []);
  const topSummaryStats =
    dashboardSummary?.topSummaryStats ??
    (needsLocalDashboardFallback ? getAttributeSummaryStats(dashboardProcessFiles) : []);
  const firmTypeStats =
    dashboardSummary?.firmTypeStats ??
    (needsLocalDashboardFallback
      ? getFirmTypeSummaryStats(dashboardProcessFiles, settings.firmTypes)
      : null);
  const fileTypeStats =
    dashboardSummary?.fileTypeStats ??
    (needsLocalDashboardFallback
      ? getFileTypeSummaryStats(dashboardProcessFiles, settings.fileTypes)
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
  const statusDisplayFlow = useMemo(() => combineJobCompletionAndIr(statusFlow), [statusFlow]);
  const statusDisplayNodeCount =
    statusDisplayFlow.length + (statusDisplayFlow.some((milestone) => milestone.key === "payment") ? 1 : 0);
  const status4Files = useMemo(() => {
    if (!status4SourceFiles) return dashboardProcessFiles;
    const divisionScopedFiles =
      activeDivision === "all"
        ? status4SourceFiles
        : status4SourceFiles.filter((file) => file.division === activeDivision);
    const scopedFiles = divisionScopedFiles.filter(
      (file) =>
        (activeFileYear === "all" || file.year === activeFileYear) &&
        fileMatchesInitiationDateRange(file, activeFileInitiationDateRange),
    );
    const categoryScopedFiles = fileCategoryFilterActive
      ? filterFilesByCategory(scopedFiles, selectedFileCategories)
      : scopedFiles;
    return categoryScopedFiles.filter((file) => !isYes(file.demandCancelled));
  }, [
    activeDivision,
    activeFileInitiationDateRange,
    activeFileYear,
    dashboardProcessFiles,
    fileCategoryFilterActive,
    selectedFileCategories,
    status4SourceFiles,
  ]);
  const miscellaneousCounts = dashboardSummary?.miscellaneousCounts ??
    localMiscellaneousCounts ?? {
      liveFiles: 0,
      fileClosed: 0,
      ld: 0,
      billsReturnedForCorrection: 0,
      returnedBillsPending: 0,
      returnedBillsResubmitted: 0,
      returnedBillsPaid: 0,
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
      soValueThresholds: [],
      divisionRiskRanking: [],
      divisionPaymentPendingRanking: [],
    };
  const effectiveValueThresholdLevels = dashboardSummary?.valueThresholdLevels?.length
    ? dashboardSummary.valueThresholdLevels
    : settings.valueThresholdLevels;
  const milestoneClearingAvailableFiles = useMemo(() => {
    if (!milestoneClearingSourceFiles) return filteredAnalyticsFiles;
    const divisionScopedFiles =
      activeDivision === "all"
        ? milestoneClearingSourceFiles
        : milestoneClearingSourceFiles.filter((file) => file.division === activeDivision);
    const scopedFiles = divisionScopedFiles.filter(
      (file) =>
        (activeFileYear === "all" || file.year === activeFileYear) &&
        fileMatchesInitiationDateRange(file, activeFileInitiationDateRange),
    );
    return (fileCategoryFilterActive
      ? filterFilesByCategory(scopedFiles, selectedFileCategories)
      : scopedFiles
    ).filter((file) => !isCancelledFile(file));
  }, [
    activeDivision,
    activeFileInitiationDateRange,
    activeFileYear,
    fileCategoryFilterActive,
    filteredAnalyticsFiles,
    milestoneClearingSourceFiles,
    selectedFileCategories,
  ]);
  const milestoneClearingModeOptions = useMemo(
    () =>
      getConfiguredModes(
        settings.modes,
        milestoneClearingAvailableFiles.map((file) => file.mode),
      ),
    [milestoneClearingAvailableFiles, settings.modes],
  );
  const milestoneClearingFilteredFiles = useMemo(
    () =>
      filterMilestoneClearingFiles(milestoneClearingAvailableFiles, {
        valueThreshold: milestoneClearingValueThreshold,
        mode: milestoneClearingMode,
        valueThresholdLevels: effectiveValueThresholdLevels,
      }),
    [
      milestoneClearingAvailableFiles,
      milestoneClearingMode,
      milestoneClearingValueThreshold,
      effectiveValueThresholdLevels,
    ],
  );
  const localMilestoneClearingRows = useMemo(
    () => getMilestoneClearingRanking(milestoneClearingFilteredFiles),
    [milestoneClearingFilteredFiles],
  );
  const milestoneClearingFiltersActive =
    milestoneClearingValueThreshold !== "all" || milestoneClearingMode !== "all";
  const milestoneClearingRows =
    localMilestoneClearingRows.length || milestoneClearingFiltersActive
      ? localMilestoneClearingRows
      : analytics.milestoneClearingRanking;
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
    paidTillDateCapital: undefined,
    paidTillDateRevenue: undefined,
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
  const localFinancePaidTillDate = useMemo(() => {
    const paymentEntries = getFinancePaymentLiabilityEntries(activeDashboardStatusFiles).filter(
      (entry) => hasFilledString(entry.paymentDate),
    );
    const finalCapital = paymentEntries.reduce((sum, entry) => sum + entry.capital, 0);
    const finalRevenue = paymentEntries.reduce((sum, entry) => sum + entry.revenue, 0);
    const advance = advancePaymentEntries(activeDashboardStatusFiles)
      .filter(
        ({ file, order }) =>
          !isSupplyOrderCancelled(file, order) &&
          hasFilledString(order.advancePaymentDetail?.paymentDate),
      )
      .reduce(
        (totals, { file, order }) => ({
          capital: totals.capital + (getInrAmount(getAdvancePaymentCapital(order), file) ?? 0),
          revenue: totals.revenue + (getInrAmount(getAdvancePaymentRevenue(order), file) ?? 0),
        }),
        { capital: 0, revenue: 0 },
      );
    return {
      capital: finalCapital + advance.capital,
      revenue: finalRevenue + advance.revenue,
    };
  }, [activeDashboardStatusFiles]);
  const financePaidTillDate = {
    capital: financeTotals.paidTillDateCapital ?? localFinancePaidTillDate.capital,
    revenue: financeTotals.paidTillDateRevenue ?? localFinancePaidTillDate.revenue,
  };
  const selectedFinanceYear = getFinancialYearDateRange(settings.selectedYear)
    ? settings.selectedYear
    : settings.financialYear;
  const selectedFinanceYearLabel = selectedFinanceYear || "selected FY";
  const isSameGlobalAndSubfilterFinanceFy =
    Boolean(getFinancialYearDateRange(settings.selectedYear)) &&
    Boolean(getFinancialYearDateRange(activeFileYear)) &&
    settings.selectedYear === activeFileYear;
  const isCurrentFinanceYearSameFyView =
    isSameGlobalAndSubfilterFinanceFy && selectedFinanceYear === settings.financialYear;
  const selectedGlobalFinanceYearStart = getFinancialYearStartNumber(settings.selectedYear);
  const activeFileYearStart = getFinancialYearStartNumber(activeFileYear);
  const isSpecificGlobalFinanceFy = selectedGlobalFinanceYearStart !== undefined;
  const isSpecificGlobalEarlierFileYearFinanceView =
    isSpecificGlobalFinanceFy &&
    activeFileYearStart !== undefined &&
    activeFileYearStart < selectedGlobalFinanceYearStart;
  const isAllFilesEntireDatabaseFinanceView =
    isAllFilesYear(settings.selectedYear) && activeFileYear === "all";
  const isAllFilesSpecificFileYearFinanceView =
    isAllFilesYear(settings.selectedYear) && activeFileYear !== "all";
  const isSpecificGlobalAllFileYearsFinanceView =
    isSpecificGlobalFinanceFy && activeFileYear === "all";
  const isAllActiveFilesAllYearsFinanceView =
    isAllActiveFilesYear(settings.selectedYear) && activeFileYear === "all";
  const isAllActiveFilesSpecificFileYearFinanceView =
    isAllActiveFilesYear(settings.selectedYear) && activeFileYear !== "all";
  const isActivePlusCurrentFyClosedFinanceView = isActivePlusCurrentFyClosedYear(
    settings.selectedYear,
  );
  const isFinanceCombinationAllowed =
    isAllFilesEntireDatabaseFinanceView ||
    isAllFilesSpecificFileYearFinanceView ||
    isSameGlobalAndSubfilterFinanceFy ||
    isSpecificGlobalEarlierFileYearFinanceView ||
    isSpecificGlobalAllFileYearsFinanceView ||
    isAllActiveFilesAllYearsFinanceView ||
    isAllActiveFilesSpecificFileYearFinanceView ||
    isActivePlusCurrentFyClosedFinanceView;
  const isFinanceCombinationBlocked = !isFinanceCombinationAllowed;
  const financeCombinationBlockedReason = {
    title: "Finance view not available for this filter combination",
    description:
      "This combination mixes file universe, initiation year, allocation year, payment year, and carry-forward basis in a way that can confuse interpretation.",
  };
  const financeUsefulCombinations = [
    {
      title: "Finance default",
      filters: `Global Filter = current FY ${settings.financialYear}, Subfilter = All file years`,
      use: "Use for day-to-day Finance monitoring across all initiation years in the current FY.",
      helper: [
        "Best for current-FY payments, carry-forward, cleared carry-forward, and firm-type activity.",
        "Payment values use payment or advance-payment dates inside the current FY.",
        "Firm Type Distribution uses S.O.s placed and payments made inside the current FY.",
        "Live cumulative boxes are hidden here so this view stays focused on FY movement.",
      ],
    },
    {
      title: "Cumulative database position",
      filters: "Switch Global Filter to All files, then choose Subfilter = Entire database",
      use: "Use for total allocated, intended, booked, committed, paid-till-date, and firm-type distribution across the full accessible database.",
      helper: [
        "Best for overall finance position of the complete accessible database.",
        "Entire database is available only when Global Filter is All files.",
        "For All active files, the matching no-restriction subfilter is All file years.",
        "Allocation is summed across all configured FYs.",
        "Firm Type Distribution is cumulative across the visible database.",
        "FY movement boxes are hidden to keep this view cumulative.",
        "Do not use this for a selected-FY performance question.",
      ],
    },
    {
      title: "Cumulative initiation-year position",
      filters: "Global Filter = All files, Subfilter = specific FY",
      use: "Use for cumulative/current-position Finance of all files initiated in one FY.",
      helper: [
        "Best for seeing the full historical/current position of one initiation-year file group.",
        "It includes files from that initiation year regardless of whether they are active or closed.",
        "Values are cumulative/current-position values for that initiation-year file set.",
        "Firm Type Distribution is cumulative for that initiation-year file group.",
        "FY movement boxes are hidden to keep it consistent with cumulative Finance views.",
      ],
    },
    {
      title: "Same-FY finance",
      filters: "Global Filter FY = Subfilter",
      use: "Use for a clean selected-FY file-set view, where allocation and file initiation year are the same.",
      helper: [
        "Best for asking how files started in the selected FY stand right now.",
        "Allocation belongs to the same selected FY.",
        "Intended, Booked, Committed, and Paid Till Date are live/current.",
        "Firm Type Distribution uses S.O.s placed and payments made inside the selected FY.",
        "Payment in FY uses payment or advance-payment dates inside that FY.",
      ],
    },
    {
      title: "FY movement across all file years",
      filters: "Global Filter = target FY, Subfilter = All file years",
      use: "Use for broad selected-FY payment and carry-forward movement across all initiation years.",
      helper: [
        "Best for previous liabilities carried into or cleared during the target FY.",
        "Payment in FY uses payment or advance-payment dates inside the target FY.",
        "Firm Type Distribution uses S.O.s placed and payments made during the target FY.",
        "Carry-forward panels are grouped by liability/source FY.",
        "Live cumulative boxes are hidden so this view stays focused on FY movement.",
      ],
    },
    {
      title: "Earlier files performing in a later FY",
      filters: "Global Filter = target FY, Subfilter = earlier FY",
      use: "Use to see how files initiated in an earlier FY moved, got paid, or carried forward during the target FY.",
      helper: [
        "Best for questions like: how did 2025-26 files perform in 2026-27?",
        "File Initiation Year selects the older file-start year.",
        "Global Filter selects the later FY being reviewed.",
        "Firm Type Distribution counts only target-FY S.O.s/payments for that older file group.",
        "Useful for Payment in FY, cleared carry-forward, and later-year movement analysis.",
      ],
    },
    {
      title: "Active workload",
      filters: "Global Filter = All active files, Subfilter = All file years",
      use: "Use for the current finance position of active, non-cancelled work across all initiation years.",
      helper: [
        "Best for current pending/active workload monitoring from a finance angle.",
        "Closed files are excluded.",
        "Values are live/current across all initiation years.",
        "Firm Type Distribution is hidden because this is an operational active-file view.",
        "Payment in FY and carry-forward boxes are hidden because this is not an Activity-FY movement view.",
        "Use this instead of Active + current FY closed when working inside Finance.",
      ],
    },
    {
      title: "Active workload by initiation FY",
      filters: "Global Filter = All active files, Subfilter = specific FY",
      use: "Use for the current finance position of active files initiated in one FY.",
      helper: [
        "Best for seeing active workload that originated in one specific FY.",
        "Closed files are excluded.",
        "Firm Type Distribution is hidden because this is an operational active-file view.",
        "Payment in FY and carry-forward boxes are hidden to keep this view cumulative/current-position based.",
        "Use this when the initiation year itself matters for active files.",
      ],
    },
    {
      title: "Active plus current-FY closed workload",
      filters: "Global Filter = Active + current FY closed, Subfilter = All file years or specific FY",
      use: "Use for current operational finance position including active files and files closed during the current FY.",
      helper: [
        "Best for day-to-day monitoring where current-FY closed files should remain visible.",
        "Values are cumulative/current-position values for the selected file universe.",
        "A specific File Initiation Year narrows this same universe by initiation year.",
        "Firm Type Distribution is hidden because this is an operational workload view.",
        "FY movement boxes are hidden to keep the view consistent with cumulative Finance views.",
      ],
    },
  ];
  const financeLiveValueBasisLabel = isAllFilesEntireDatabaseFinanceView
    ? "Basis: cumulative entire database"
    : isAllFilesSpecificFileYearFinanceView
      ? `Basis: all files initiated in FY ${activeFileYear}`
    : activeFileYear === "all"
      ? isActivePlusCurrentFyClosedFinanceView
        ? "Basis: active + current-FY closed files, all initiation years"
        : isAllActiveFilesYear(settings.selectedYear)
        ? "Basis: active files, all initiation years"
        : "Basis: visible files, all initiation years"
      : isActivePlusCurrentFyClosedFinanceView
        ? `Basis: active + current-FY closed files initiated in FY ${activeFileYear}`
        : `Basis: files initiated in FY ${activeFileYear}`;
  const financeFirmTypeBasisLabel = isSpecificGlobalFinanceFy
    ? `Basis: Global Filter ${selectedFinanceYearLabel}`
    : financeLiveValueBasisLabel;
  const financeAllocationBasisLabel = isAllFilesEntireDatabaseFinanceView
    ? "Basis: all-FY allocation"
    : isAllFilesSpecificFileYearFinanceView
      ? `Basis: allocation FY ${activeFileYear}`
    : `Basis: allocation FY ${selectedFinanceYearLabel}`;
  const financePaymentInYearBasisLabel = `Basis: payment date in FY ${selectedFinanceYearLabel}`;
  const financePreviousCarryBasisLabel = `Basis: older FY liability still unpaid at ${selectedFinanceYearLabel} end`;
  const financeClearedCarryBasisLabel = `Basis: older FY liability paid in ${selectedFinanceYearLabel}`;
  const financeCarryForwardBasisLabel = `Basis: liability source FY ${selectedFinanceYearLabel}`;
  const financeFutureClearedCarryBasisLabel = `Basis: ${selectedFinanceYearLabel} liabilities paid after FY end`;
  const isCumulativeFinancePositionView =
    isAllFilesEntireDatabaseFinanceView ||
    isAllFilesSpecificFileYearFinanceView ||
    isAllActiveFilesAllYearsFinanceView ||
    isAllActiveFilesSpecificFileYearFinanceView ||
    isActivePlusCurrentFyClosedFinanceView;
  const shouldShowPreviousCarryForwardPanels =
    !isSameGlobalAndSubfilterFinanceFy || isCurrentFinanceYearSameFyView;
  const shouldShowFinanceLivePositionCards = !isSpecificGlobalAllFileYearsFinanceView;
  const shouldShowFinanceFirmTypeDistribution =
    isSpecificGlobalFinanceFy ||
    isAllFilesEntireDatabaseFinanceView ||
    isAllFilesSpecificFileYearFinanceView;
  const shouldHideCarryForwardRowYear = isSpecificGlobalAllFileYearsFinanceView;
  const financeFirmTypeActivityYear = isSpecificGlobalFinanceFy
    ? selectedFinanceYear
    : undefined;
  const financePaymentInYearCapital = financeTotals.paidCapital + financeTotals.advanceCapital;
  const financePaymentInYearRevenue = financeTotals.paidRevenue + financeTotals.advanceRevenue;
  const financePaidTillDateCapitalPercent = getPercent(
    financePaidTillDate.capital,
    financeTotals.allocatedCapital,
  );
  const financePaidTillDateRevenuePercent = getPercent(
    financePaidTillDate.revenue,
    financeTotals.allocatedRevenue,
  );
  const financePaymentInYearCapitalPercent = getPercent(
    financePaymentInYearCapital,
    financeTotals.allocatedCapital,
  );
  const financePaymentInYearRevenuePercent = getPercent(
    financePaymentInYearRevenue,
    financeTotals.allocatedRevenue,
  );
  const financePreviousCarryExampleSource = isSpecificGlobalEarlierFileYearFinanceView
    ? `FY ${activeFileYear} liability`
    : "older liability/source FY";
  const financeCarryForwardExamples = {
    previous: [
      `${financePreviousCarryExampleSource}: ₹100 was unpaid before ${selectedFinanceYearLabel}.`,
      `Paid during ${selectedFinanceYearLabel}: ₹40.`,
      `Unpaid at ${selectedFinanceYearLabel} end: ₹60.`,
      isSpecificGlobalEarlierFileYearFinanceView
        ? `This panel shows ₹60 for FY ${activeFileYear} source liabilities still unpaid.`
        : "This panel shows ₹60 as still unpaid from previous FY liabilities.",
    ],
    cleared: [
      `${financePreviousCarryExampleSource}: ₹100 was pending at the start of ${selectedFinanceYearLabel}.`,
      `Paid during ${selectedFinanceYearLabel}: ₹40.`,
      "This panel shows ₹40 as cleared carry forward.",
      isSpecificGlobalEarlierFileYearFinanceView
        ? `The row belongs to FY ${activeFileYear} source liability.`
        : "The row belongs to the original liability/source FY.",
    ],
    carryForward: [
      `Liability/source date belongs to ${selectedFinanceYearLabel}: ₹75.`,
      "Payment date is blank or after FY end.",
      `This panel shows ₹75 as Carry Forward of ${selectedFinanceYearLabel}.`,
      "It covers S.O., bill, stage, supplementary, or advance-payment liability source dates as applicable.",
      "For shortclosed S.O.s, only real pending payable items are carried forward; the old full S.O. value is not carried forward merely because the S.O. exists.",
    ],
    futureCleared: [
      `${selectedFinanceYearLabel} liability/source-FY carry-forward at FY end: ₹75.`,
      "Paid in a later FY: ₹50.",
      "This panel shows ₹50 as cleared later.",
      "The unpaid balance, if any, continues as pending carry-forward.",
    ],
  };
  const financeFirmTypeDistributions = dashboardSummary?.financeFirmTypeDistributions ?? {
    supplyOrderValue: getSupplyOrderValueDistributionByFirmType(
      activeDashboardStatusFiles,
      settings.firmTypes,
      financeFirmTypeActivityYear,
    ),
    actualPayment: getActualPaymentDistributionByFirmType(
      activeDashboardStatusFiles,
      settings.firmTypes,
      financeFirmTypeActivityYear,
    ),
  };
  const financeFirmTypeDistributionRows =
    financeFirmTypeDistributions[financeFirmTypeDistributionKey] ?? [];
  const financeFirmTypeDistributionExportRows = shouldShowFinanceFirmTypeDistribution
    ? financeFirmTypeDistributionRows
    : [];
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
    statusDisplayFlow,
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
    label: "Bidding Mode",
    value: modeCounts.map((mode) => ({
      label: mode.name,
      value: mode.count,
      searchFilter: `mode:${mode.name}`,
      help: [
        `Includes files where Bidding Mode is ${mode.name}.`,
        "Cancelled demand files are excluded.",
        "File Closed follows the selected Global Filter.",
        "Cancelled S.O. and shortclosed S.O. history can remain visible in Snapshot statistics.",
      ],
    })),
    hint: [
      "Files are grouped by bidding mode from the selected Dashboard file set.",
      "Cancelled demand files are excluded.",
      "File Closed follows the selected Global Filter; cancelled S.O. and shortclosed S.O. history can remain visible in Snapshot statistics.",
    ],
  };
  const gemBiddingModeSummaryStat: SummaryStat = {
    label: "GeM bidding mode",
    value: gemBiddingModeCounts.map((mode) => ({
      label: mode.name,
      value: mode.count,
      searchFilter: `gemBiddingMode:${encodeURIComponent(mode.name)}`,
      help: [
        `Includes GeM files where GeM Bidding Mode is ${mode.name}.`,
        "Cancelled demand files are excluded.",
        "File Closed follows the selected Global Filter.",
        "Cancelled S.O. and shortclosed S.O. history can remain visible in Snapshot statistics.",
      ],
    })),
    hint: [
      "GeM files are grouped by GeM bidding mode from the selected Dashboard file set.",
      "Cancelled demand files are excluded.",
      "File Closed follows the selected Global Filter; cancelled S.O. and shortclosed S.O. history can remain visible in Snapshot statistics.",
    ],
  };

  const compactSummaryStats: SummaryStat[] = [];

  const summaryStats: SummaryStat[] = [];
  const snapshotExportRows = getSnapshotExportRows([
    ...topSummaryStats,
    biddingTypeSummaryStat,
    gemBiddingModeSummaryStat,
    ...(fileTypeStats ? [fileTypeStats] : []),
    ...(firmTypeStats ? [firmTypeStats] : []),
    ...compactSummaryStats,
    ...summaryStats,
  ]);

  const shortclosedPayableHelper =
    "Shortclosed S.O. value remains in committed/history views, but payable/balance/carry-forward values count only real pending payable items.";
  const paymentPendingLogicDetails: HelperDetails = {
    title: "Payment pending and shortclosure logic",
    buttonLabel: "Payment logic",
    items: [
      "A payment is pending when a real payable workflow has started or become due, and payment date is still blank.",
      "Main/stage payment signals include bill prepared date, bill sent for payment date, returned bill cycle, material receipt/IR path, job completion, D.P./revised D.P. trigger where applicable, or an entered bill/payment amount.",
      "Advance Payment = Yes by itself means advance is applicable. It becomes pending only when advance bill/payment details, advance amount, or advance return/resubmission workflow exists and advance payment date is blank.",
      "Supplementary bill becomes pending when it is submitted, returned, or resubmitted and its payment date is blank.",
      "For shortclosed S.O.s, the old full S.O. value is not treated as payable merely because the S.O. exists. Only the real pending payable items above are counted.",
    ],
  };
  const shortclosedPayableHelp = (items: string | string[]) => (
    <HelperWithExamples items={items} details={paymentPendingLogicDetails} />
  );
  const financeHelperText = isSameGlobalAndSubfilterFinanceFy
    ? {
        rules: [
          `Same-FY view: Global Filter FY and Subfilter are both ${selectedFinanceYearLabel}.`,
          "The file set is narrowed to that same FY context.",
          "Intended, Booked, Committed, and Paid Till Date are live/current values for this visible file set.",
          "Firm Type Distribution is restricted to S.O.s placed and payments made in this Global Filter FY.",
          `Payment in ${selectedFinanceYearLabel} is the only top value box restricted by actual payment/advance payment date within this FY.`,
          shortclosedPayableHelper,
          "Percentages compare each value with the selected FY allocation.",
        ],
        allocated: [
          `Budget allocation for ${selectedFinanceYearLabel} and the selected division.`,
          "This is setup/budget data, not file transaction data.",
          "It changes only if the allocation setup for this FY/division is edited.",
        ],
        intended: [
          `Live intended value for visible ${selectedFinanceYearLabel} files where Controlled/S.O. value has not replaced the estimate.`,
          "This is a current value, so later Controlled/S.O. entry can move it to Booked or Committed.",
          "The percentage is against the selected FY allocation.",
        ],
        booked: [
          `Live booked value for visible ${selectedFinanceYearLabel} files where Controlled/file booking exists and committed S.O. value has not replaced it.`,
          "This is a current value, so later S.O. entry can move it to Committed.",
          "The percentage is against the selected FY allocation.",
        ],
        committed: [
          `Live committed value from effective S.O.s in the visible ${selectedFinanceYearLabel} file set.`,
          "This is current effective S.O. value, not a frozen FY-end figure.",
          "Shortclosed S.O.s remain here as S.O. history because shortclosure is not cancellation.",
          "The percentage is against the selected FY allocation.",
        ],
        paidTillDate: [
          `Total paid till date for the visible ${selectedFinanceYearLabel} file set.`,
          "Includes final/stage/supplementary payments and advance payments.",
          "It is not restricted to payments made inside this FY.",
          "The percentage is against the selected FY allocation.",
        ],
        paymentInYear: [
          `Payments actually made during ${selectedFinanceYearLabel} for the visible same-FY file set.`,
          "Uses payment date or advance payment date.",
          "Includes final/stage/supplementary payments and advance payments.",
          "This complements Paid Till Date: Paid Till Date is cumulative, while this box is FY-payment-date based.",
        ],
          previousCarryForward: isCurrentFinanceYearSameFyView
          ? [
              `Older-FY liabilities still unpaid in the current FY ${selectedFinanceYearLabel} view.`,
              "This is must-have current-year monitoring because unpaid liabilities from earlier years still require action now.",
              "It includes older liability/source FYs that belong to the visible same-FY file set.",
            ]
          : [
              "Hidden in historical same-FY view to avoid confusion.",
              "For older-FY liability movement, use Global Filter = target FY and Subfilter = earlier FY.",
            ],
        clearedCarryForward: isCurrentFinanceYearSameFyView
          ? [
              `Older-FY carry-forward liabilities paid during current FY ${selectedFinanceYearLabel}.`,
              "This shows how much previous-year pending liability has been cleared in the current FY.",
              "It uses payment date in the current FY and liability source from an earlier FY.",
            ]
          : [
              "Hidden in historical same-FY view to avoid confusion.",
              "For older-FY carry-forward cleared during a target FY, use Global Filter = target FY and Subfilter = earlier FY.",
            ],
        carryForward: [
          `Unpaid ${selectedFinanceYearLabel} liabilities remaining at FY end for this same-FY file set.`,
          "Uses liability source date, usually S.O./bill source date.",
          shortclosedPayableHelper,
          "If paid after FY end, the same liability can appear in the cleared-later panel.",
        ],
        futureClearedCarryForward: [
          `${selectedFinanceYearLabel} carry-forward liabilities from this same-FY file set that were paid after FY end.`,
          "This intentionally updates when later payment entries are made.",
          "It helps explain what happened later to unpaid year-end liabilities.",
        ],
          firmType: [
            `Activity-year distribution by firm type for the visible ${selectedFinanceYearLabel} file set.`,
            `S.O. value counts only S.O.s placed during ${selectedFinanceYearLabel}.`,
            `Actual payment counts only payment and advance-payment dates falling in ${selectedFinanceYearLabel}.`,
            "The File Initiation Year subfilter only narrows which files are eligible.",
            "Supplementary bill payments are included by their payment date.",
          ],
        }
    : isSpecificGlobalEarlierFileYearFinanceView
      ? {
          rules: [
            `Continuation view: Global Filter is ${selectedFinanceYearLabel} and Subfilter is ${activeFileYear}.`,
            `The file set is earlier-FY files initiated in ${activeFileYear} that are visible in the ${selectedFinanceYearLabel} context.`,
            "Use this to see how older files performed in the later target FY.",
            "Intended, Booked, Committed, and Paid Till Date are live/current values for this visible earlier-file set.",
            `Firm Type Distribution is restricted to S.O.s placed and payments made in ${selectedFinanceYearLabel}.`,
            shortclosedPayableHelper,
            `Payment in ${selectedFinanceYearLabel} and carry-forward boxes use ${selectedFinanceYearLabel} activity/liability rules.`,
          ],
          allocated: [
            `Budget allocation for ${selectedFinanceYearLabel} and the selected division.`,
            `The file set is initiated in ${activeFileYear}, but allocation remains the target FY allocation.`,
            "Use this comparison as a later-year workload/payment view, not as a pure initiation-year budget view.",
          ],
          intended: [
            `Live intended value of visible files initiated in ${activeFileYear}.`,
            `These are earlier-FY files still relevant to the ${selectedFinanceYearLabel} view.`,
            "This is current/live and can change when Controlled/S.O. fields are entered or corrected.",
          ],
          booked: [
            `Live booked value of visible files initiated in ${activeFileYear}.`,
            "Includes files where Controlled/file booking exists and committed S.O. value has not replaced it yet.",
            "This is current/live and can move to Committed after S.O. entry.",
          ],
          committed: [
            `Live committed value from effective S.O.s for visible files initiated in ${activeFileYear}.`,
            "Uses current effective S.O. value; cancelled S.O. rows are excluded.",
            "Shortclosed S.O.s remain included as S.O. history.",
            "This is not frozen at the target FY end.",
          ],
          paidTillDate: [
            `Total paid till date for visible files initiated in ${activeFileYear}.`,
            "Includes final/stage/supplementary payments and advance payments.",
            `It is not restricted to payments made inside ${selectedFinanceYearLabel}.`,
          ],
          paymentInYear: [
            `Payments actually made during ${selectedFinanceYearLabel} for visible files initiated in ${activeFileYear}.`,
            "Uses payment date or advance payment date.",
            "Includes final/stage/supplementary payments and advance payments.",
            "This is the clean box for later-FY payment movement of earlier-FY files.",
          ],
          previousCarryForward: [
            `FY ${activeFileYear} liability/source rows within files initiated in ${activeFileYear} that remain unpaid at ${selectedFinanceYearLabel} end.`,
            `This view intentionally restricts previous carry-forward to FY ${activeFileYear} source liability.`,
            "Before FY-end, this is a live/provisional unpaid position and can reduce if payment is made before year end.",
          ],
          clearedCarryForward: [
            `FY ${activeFileYear} carry-forward liabilities within files initiated in ${activeFileYear} that were paid during ${selectedFinanceYearLabel}.`,
            `This uses payment date in ${selectedFinanceYearLabel} and liability/source FY ${activeFileYear}.`,
            "Use it to see how much of that earlier-FY pending liability was cleared in the target FY.",
          ],
          carryForward: [
            `${selectedFinanceYearLabel} liabilities within files initiated in ${activeFileYear} that are currently unpaid and would carry forward if still unpaid at FY-end.`,
            shortclosedPayableHelper,
            "This is live/provisional before FY-end; values may reduce if payment is made before year end.",
            "After FY-end, it becomes the final carry-forward position for those liabilities.",
          ],
          futureClearedCarryForward: [
            `${selectedFinanceYearLabel} carry-forward liabilities within files initiated in ${activeFileYear} that were paid after FY-end.`,
            "This explains later clearing of target-FY liabilities from the earlier-file set.",
            "It mainly becomes meaningful after the target FY has ended.",
          ],
          firmType: [
            `Activity-year distribution by firm type for visible files initiated in ${activeFileYear}.`,
            `S.O. value counts only S.O.s placed during ${selectedFinanceYearLabel}.`,
            `Actual payment counts only payment and advance-payment dates falling in ${selectedFinanceYearLabel}.`,
            `Only files initiated in ${activeFileYear} are eligible.`,
            "Supplementary bill payments are included by their payment date.",
          ],
        }
    : isSpecificGlobalAllFileYearsFinanceView
      ? {
          rules: [
            `FY movement view: Global Filter is ${selectedFinanceYearLabel} and Subfilter is All file years.`,
            "The view is focused on payment and carry-forward movement across all initiation years.",
            "Live position boxes such as Intended, Booked, Committed, and Paid Till Date are hidden here to avoid mixing current position with FY movement.",
            `Payment in ${selectedFinanceYearLabel} uses actual payment/advance payment date inside ${selectedFinanceYearLabel}.`,
            shortclosedPayableHelper,
            "Carry-forward panels are grouped by liability/source FY.",
          ],
          allocated: [
            `Budget allocation for ${selectedFinanceYearLabel} and the selected division.`,
            "This gives the selected-FY budget reference for the movement view.",
            "It is setup/budget data, not file transaction data.",
          ],
          intended: [
            "Hidden in FY movement view to avoid mixing live current position with selected-FY movement.",
          ],
          booked: [
            "Hidden in FY movement view to avoid mixing live current position with selected-FY movement.",
          ],
          committed: [
            "Hidden in FY movement view to avoid mixing live current position with selected-FY movement.",
          ],
          paidTillDate: [
            "Hidden in FY movement view because it is cumulative till date, not selected-FY payment movement.",
          ],
          paymentInYear: [
            `Payments actually made during ${selectedFinanceYearLabel} across all visible initiation years.`,
            "Uses payment date or advance payment date.",
            "Includes final/stage/supplementary payments and advance payments.",
            "This is the main payment box for this broad FY movement view.",
          ],
          previousCarryForward: [
            `All liability/source FYs earlier than ${selectedFinanceYearLabel} that remain unpaid at ${selectedFinanceYearLabel} end.`,
            "Because File Initiation Year is All file years, this includes all previous liability years, grouped year-wise in the panel.",
            "Each year clicker opens only that liability/source FY within the current global/division/category context.",
          ],
          clearedCarryForward: [
            `All earlier-FY carry-forward liabilities paid during ${selectedFinanceYearLabel}.`,
            "Because File Initiation Year is All file years, this includes all previous liability years, grouped year-wise in the panel.",
            "Each year clicker opens only that liability/source FY paid in the selected FY.",
          ],
          carryForward: [
            `${selectedFinanceYearLabel} liabilities that are currently unpaid and would carry forward if still unpaid at FY-end.`,
            "This is liability-source-FY based and covers all visible initiation years.",
            shortclosedPayableHelper,
            "Before FY-end, this is live/provisional.",
          ],
          futureClearedCarryForward: [
            `${selectedFinanceYearLabel} carry-forward liabilities that were paid after FY-end.`,
            "This covers all visible initiation years.",
            "It mainly becomes meaningful after the selected FY has ended.",
          ],
          firmType: [
            `S.O. value by firm type is restricted to S.O.s placed during ${selectedFinanceYearLabel}.`,
            `Actual payment by firm type is restricted to payment/advance payment dates falling in ${selectedFinanceYearLabel}.`,
            "Supplementary bill payments are included by their payment date.",
            "All visible initiation years are eligible.",
            "This distribution is Global Filter FY based, not live cumulative.",
          ],
        }
    : isAllFilesSpecificFileYearFinanceView
      ? {
          rules: [
            `Cumulative initiation-year view: Global Filter is All files and Subfilter is ${activeFileYear}.`,
            `The file set includes all accessible files initiated in FY ${activeFileYear}.`,
            "Active, closed, and historical files from that initiation year remain in scope as permitted by access and File Type filters.",
            "Intended, Booked, Committed, Paid Till Date, and Firm Type Distribution are cumulative/current-position values for this initiation-year file set.",
            "FY-specific movement boxes are hidden to keep this view cumulative and current-position based.",
          ],
          allocated: [
            `Budget allocation for FY ${activeFileYear} and the selected division.`,
            `The file set is all files initiated in FY ${activeFileYear}, so allocation also uses FY ${activeFileYear}.`,
            "Percentages compare this initiation-year file group with the same FY allocation.",
          ],
          intended: [
            `Live intended value of all visible files initiated in FY ${activeFileYear}.`,
            "Includes files where Controlled/S.O. value has not replaced the estimate yet.",
            "Cancelled files are excluded from finance value calculations.",
          ],
          booked: [
            `Live booked value of all visible files initiated in FY ${activeFileYear}.`,
            "Includes files where Controlled/file booking exists and committed S.O. value has not replaced it yet.",
            "Cancelled files are excluded from finance value calculations.",
          ],
          committed: [
            `Live committed value of all visible files initiated in FY ${activeFileYear}.`,
            "Uses current effective S.O. value; cancelled S.O. rows are excluded.",
            "Shortclosed S.O.s remain included as S.O. history.",
            "Closed files from this initiation year remain included.",
          ],
          paidTillDate: [
            `Total paid till date for all visible files initiated in FY ${activeFileYear}.`,
            "Includes final/stage/supplementary payments and advance payments.",
            "It is cumulative till date, not restricted to payments made inside the selected FY.",
          ],
          paymentInYear: [
            "Hidden in cumulative initiation-year view to avoid mixing FY-payment movement with current-position values.",
          ],
          previousCarryForward: [
            "Hidden in cumulative initiation-year view because this is an FY-specific movement box.",
          ],
          clearedCarryForward: [
            "Hidden in cumulative initiation-year view because this is an FY-specific movement box.",
          ],
          carryForward: [
            "Hidden in cumulative initiation-year view because this is an FY-specific movement box.",
          ],
          futureClearedCarryForward: [
            "Hidden in cumulative initiation-year view because this is an FY-specific movement box.",
          ],
          firmType: [
            `Cumulative distribution by firm type for all visible files initiated in FY ${activeFileYear}.`,
            "S.O. value basis uses current effective S.O. value grouped by S.O. firm type.",
            "Actual payment basis uses paid-till-date rows grouped by related S.O. firm type.",
            "Actual payment includes supplementary bill payments and advance payments.",
            "This is not restricted by S.O. date or payment date because Global Filter is All files.",
          ],
        }
    : isActivePlusCurrentFyClosedFinanceView
      ? {
          rules: [
            activeFileYear === "all"
              ? "Current operational workload view: Global Filter is Active + current FY closed and Subfilter is All file years."
              : `Current operational workload view: Global Filter is Active + current FY closed and Subfilter is ${activeFileYear}.`,
            "The file set includes currently active, non-cancelled files plus files closed during the current FY.",
            "A specific File Initiation Year narrows this same active/current-FY-closed universe by initiation year.",
            "Intended, Booked, Committed, and Paid Till Date are live/current values for this operational workload.",
            "Firm Type Distribution is hidden here because this is an operational workload view, not an Activity-FY or cumulative All-files view.",
            "FY-specific movement boxes are hidden to keep this view cumulative and current-position based.",
          ],
          allocated: [
            `Budget allocation for ${selectedFinanceYearLabel} and the selected division.`,
            "Allocation remains FY setup data, even though the file set is an operational workload universe.",
            "Percentages compare operational workload values with this selected FY allocation.",
          ],
          intended: [
            activeFileYear === "all"
              ? "Live intended value of active plus current-FY-closed files across all initiation years."
              : `Live intended value of active plus current-FY-closed files initiated in FY ${activeFileYear}.`,
            "Includes files where Controlled/S.O. value has not replaced the estimate yet.",
            "Cancelled files are excluded.",
          ],
          booked: [
            activeFileYear === "all"
              ? "Live booked value of active plus current-FY-closed files across all initiation years."
              : `Live booked value of active plus current-FY-closed files initiated in FY ${activeFileYear}.`,
            "Includes files where Controlled/file booking exists and committed S.O. value has not replaced it yet.",
            "Cancelled files are excluded.",
          ],
          committed: [
            activeFileYear === "all"
              ? "Live committed value of active plus current-FY-closed files across all initiation years."
              : `Live committed value of active plus current-FY-closed files initiated in FY ${activeFileYear}.`,
            "Uses current effective S.O. value; cancelled S.O. rows are excluded.",
            "Shortclosed S.O.s remain included as S.O. history.",
            "Files closed during the current FY remain included in this operational view.",
          ],
          paidTillDate: [
            activeFileYear === "all"
              ? "Total paid till date for active plus current-FY-closed files across all initiation years."
              : `Total paid till date for active plus current-FY-closed files initiated in FY ${activeFileYear}.`,
            "Includes final/stage/supplementary payments and advance payments.",
            "It is cumulative till date, not restricted to payments made inside the selected FY.",
          ],
          paymentInYear: [
            "Hidden in Active + current FY closed view to avoid mixing FY-payment movement with cumulative operational values.",
          ],
          previousCarryForward: [
            "Hidden in Active + current FY closed view because this is an FY-specific movement box.",
          ],
          clearedCarryForward: [
            "Hidden in Active + current FY closed view because this is an FY-specific movement box.",
          ],
          carryForward: [
            "Hidden in Active + current FY closed view because this is an FY-specific movement box.",
          ],
          futureClearedCarryForward: [
            "Hidden in Active + current FY closed view because this is an FY-specific movement box.",
          ],
          firmType: [
            "Hidden in Active + current FY closed view.",
            "Use a specific Activity FY for FY-wise S.O./payment firm distribution.",
            "Use Global Filter = All files for cumulative firm distribution.",
          ],
        }
    : isAllActiveFilesAllYearsFinanceView
      ? {
          rules: [
            "Active workload view: Global Filter is All active files and Subfilter is All file years.",
            "The file set includes currently active, non-cancelled files across all initiation years.",
            "Closed files are excluded by the Global Filter.",
            "Intended, Booked, Committed, and Paid Till Date are live/current values for active workload.",
            "Firm Type Distribution is hidden here because this is an operational workload view, not an Activity-FY or cumulative All-files view.",
            "FY-specific movement boxes are hidden to keep this active workload view cumulative and current-position based.",
          ],
          allocated: [
            `Budget allocation for ${selectedFinanceYearLabel} and the selected division.`,
            "Allocation remains FY setup data, even though active files may have been initiated in different years.",
            "Percentages compare active-workload values with this selected FY allocation.",
          ],
          intended: [
            "Live intended value of active files across all initiation years.",
            "Includes active files where Controlled/S.O. value has not replaced the estimate yet.",
            "Closed and cancelled files are excluded by this Global Filter.",
          ],
          booked: [
            "Live booked value of active files across all initiation years.",
            "Includes active files where Controlled/file booking exists and committed S.O. value has not replaced it yet.",
            "Closed and cancelled files are excluded by this Global Filter.",
          ],
          committed: [
            "Live committed value of active files across all initiation years.",
            "Uses current effective S.O. value; cancelled S.O. rows are excluded.",
            "Shortclosed S.O.s remain included as S.O. history.",
            "Closed and cancelled files are excluded by this Global Filter.",
          ],
          paidTillDate: [
            "Total paid till date for active files across all initiation years.",
            "Includes final/stage/supplementary payments and advance payments.",
            "It is not restricted to payments made inside the selected FY.",
          ],
          paymentInYear: [
            "Hidden in Active workload view to avoid mixing FY-payment activity with cumulative active-file values.",
          ],
          previousCarryForward: [
            "Hidden in Active workload view because this is an FY-specific movement box.",
          ],
          clearedCarryForward: [
            "Hidden in Active workload view because this is an FY-specific movement box.",
          ],
          carryForward: [
            "Hidden in Active workload view because this is an FY-specific movement box.",
          ],
          futureClearedCarryForward: [
            "Hidden in Active workload view because this is an FY-specific movement box.",
          ],
          firmType: [
            "Hidden in All active files view.",
            "Use a specific Activity FY for FY-wise S.O./payment firm distribution.",
            "Use Global Filter = All files for cumulative firm distribution.",
          ],
        }
    : isAllActiveFilesSpecificFileYearFinanceView
      ? {
          rules: [
            `Active initiation-year view: Global Filter is All active files and Subfilter is ${activeFileYear}.`,
            `The file set includes currently active, non-cancelled files initiated in FY ${activeFileYear}.`,
            "Closed files are excluded by the Global Filter.",
            "Intended, Booked, Committed, and Paid Till Date are live/current values for this active initiation-year file set.",
            "Firm Type Distribution is hidden here because this is an operational workload view, not an Activity-FY or cumulative All-files view.",
            "Payment in FY and carry-forward boxes are hidden because this is an operational active-file view.",
          ],
          allocated: [
            `Budget allocation for ${selectedFinanceYearLabel} and the selected division.`,
            `The file set is active files initiated in FY ${activeFileYear}, but allocation remains Finance FY setup data.`,
            "Use the visible basis line to compare allocation FY and file-set basis.",
          ],
          intended: [
            `Live intended value of active files initiated in FY ${activeFileYear}.`,
            "Includes active files where Controlled/S.O. value has not replaced the estimate yet.",
            "Closed and cancelled files are excluded by this Global Filter.",
          ],
          booked: [
            `Live booked value of active files initiated in FY ${activeFileYear}.`,
            "Includes active files where Controlled/file booking exists and committed S.O. value has not replaced it yet.",
            "Closed and cancelled files are excluded by this Global Filter.",
          ],
          committed: [
            `Live committed value of active files initiated in FY ${activeFileYear}.`,
            "Uses current effective S.O. value; cancelled S.O. rows are excluded.",
            "Shortclosed S.O.s remain included as S.O. history.",
            "Closed and cancelled files are excluded by this Global Filter.",
          ],
          paidTillDate: [
            `Total paid till date for active files initiated in FY ${activeFileYear}.`,
            "Includes final/stage/supplementary payments and advance payments.",
            "It is not restricted to payments made inside the selected Finance FY.",
          ],
          paymentInYear: [
            "Hidden in All active files view to avoid mixing FY-payment movement with cumulative active-file values.",
          ],
          previousCarryForward: [
            "Hidden in All active files view because this is an FY-specific movement box.",
          ],
          clearedCarryForward: [
            "Hidden in All active files view because this is an FY-specific movement box.",
          ],
          carryForward: [
            "Hidden in All active files view because this is an FY-specific movement box.",
          ],
          futureClearedCarryForward: [
            "Hidden in All active files view because this is an FY-specific movement box.",
          ],
          firmType: [
            "Hidden in All active files view, even when a File Initiation Year is selected.",
            "Use a specific Activity FY for FY-wise S.O./payment firm distribution.",
            "Use Global Filter = All files plus this Subfilter for cumulative file-group distribution.",
          ],
        }
    : isAllFilesEntireDatabaseFinanceView
      ? {
          rules: [
            "Entire database view: Global Filter is All files and Subfilter is Entire database.",
            "All visible finance boxes are cumulative/live and use the full visible database file set.",
            "Allocated is the sum of allocations across all configured FYs for the visible divisions.",
            "Percentages compare database-wide live values with all-FY allocation.",
            "FY-specific movement boxes are hidden in this view to keep the all-database position clean.",
          ],
          allocated: [
            "Sum of allocations across all configured financial years for the visible divisions.",
            "This is used only for All files + Entire database so the allocation basis matches the all-database value basis.",
            "It changes if any FY allocation setup is edited.",
          ],
          intended: [
            "Live intended value across the entire visible database.",
            "Includes files where Controlled/S.O. value has not replaced the estimate yet.",
            "The percentage is against total allocation across all configured FYs.",
          ],
          booked: [
            "Live booked value across the entire visible database.",
            "Includes files where Controlled/file booking exists and committed S.O. value has not replaced it yet.",
            "The percentage is against total allocation across all configured FYs.",
          ],
          committed: [
            "Live committed value across the entire visible database.",
            "Uses current effective S.O. value; cancelled S.O. rows are excluded.",
            "Shortclosed S.O.s remain included as S.O. history.",
            "The percentage is against total allocation across all configured FYs.",
          ],
          paidTillDate: [
            "Total paid till date across the entire visible database.",
            "Includes final/stage/supplementary payments and advance payments.",
            "The percentage is against total allocation across all configured FYs.",
          ],
          paymentInYear: [
            "Hidden in Entire database view to avoid mixing FY-payment activity with cumulative all-database values.",
          ],
          previousCarryForward: [
            "Hidden in Entire database view because this is an FY-specific movement box.",
          ],
          clearedCarryForward: [
            "Hidden in Entire database view because this is an FY-specific movement box.",
          ],
          carryForward: [
            "Hidden in Entire database view because this is an FY-specific movement box.",
          ],
          futureClearedCarryForward: [
            "Hidden in Entire database view because this is an FY-specific movement box.",
          ],
          firmType: [
            "Cumulative distribution by firm type across the entire visible database.",
            "S.O. value basis uses current effective S.O. value grouped by S.O. firm type.",
            "Actual payment basis uses paid-till-date rows grouped by related S.O. firm type.",
            "Actual payment includes supplementary bill payments and advance payments.",
            "This is not restricted by S.O. date or payment date because Global Filter is All files.",
          ],
        }
    : {
        rules: dashboardSectionRuleHelpers.finance,
        allocated: [
          "Budget allocation for the selected financial year and selected division.",
          "It is not based on individual files or S.O. rows.",
          "It changes only if the allocation setup for this FY/division is edited.",
          "File Closed and Shortclosed S.O. do not affect this amount.",
        ],
        intended: [
          "Estimated value of live requirements where demand is not yet controlled.",
          "This is a current-position value for files visible under the Dashboard filters.",
          "It is not frozen at the end of the selected FY.",
          "If Controlled/S.O. is entered later, the file can move out of Intended.",
          "Earlier-FY files may appear if the selected Dashboard context includes them.",
          "Shortclosed S.O. files remain included because shortclosure is not cancellation.",
          "File Closed visibility follows the selected Global Filter.",
        ],
        booked: [
          "Amount booked at file level through Controlled where no S.O./committed value has replaced it yet.",
          "This is a current-position value, not an as-on-FY-end value.",
          "If S.O. value is entered later, the file can move from Booked to Committed.",
          "Earlier-FY files may appear if the selected Dashboard context includes them.",
          "Shortclosed S.O. files remain included.",
          "File Closed visibility follows the selected Global Filter.",
        ],
        committed: [
          "Committed value from effective supply orders.",
          "This is current effective S.O. value for the selected Dashboard file set.",
          "It is not frozen at selected FY end and is not purely S.O.-date based.",
          "Later S.O. edits, cancellations, shortclosures, or value corrections can update it.",
          "Earlier-FY files may appear if the selected Dashboard context includes them.",
          "Shortclosed S.O. rows remain included.",
          shortclosedPayableHelper,
          "File Closed visibility follows the selected Global Filter.",
        ],
        paidTillDate: [
          "Current cumulative paid amount against the visible Dashboard file set.",
          "Includes final/main/stage payments, supplementary payments, and advance payments.",
          "There is no payment-FY restriction in this box.",
          "It follows the same current/live file-set context as Intended, Booked, and Committed.",
          "If payment dates or amounts are entered or corrected later, this value can change.",
        ],
        paymentInYear: [
          `Actual payment amount where payment date or advance payment date falls in ${selectedFinanceYearLabel}.`,
          "This is payment-date based, not file-initiation-FY based.",
          "Includes main, stage, returned, supplementary, and advance payment amounts.",
          "It can include payments for files initiated in earlier FYs if their payment date falls in the selected FY and the file is visible in the Dashboard context.",
          "If a payment/advance date or amount is edited later, this selected-FY payment value can change.",
          "Closed Files are included when they pass the selected year, date, and File Type filters.",
          "Shortclosed S.O. rows remain included.",
        ],
        previousCarryForward: [
          "Unpaid payment rows from earlier FYs that are still unpaid.",
          "This is liability-source-FY based, not file-initiation-FY based.",
          "Rows can belong to files initiated in an earlier or later FY if their S.O./bill liability source year and Dashboard context match.",
          "If payment dates are entered or corrected later, this carry-forward position can change.",
          "Supplementary bills are included if they are still unpaid.",
          "Closed Files are included when payment liability history matches.",
          "Shortclosed S.O. rows remain included.",
          "Liability FY button opens the matching pending files/S.O.",
        ],
        clearedCarryForward: [
          `Earlier-FY carry-forward rows that were paid during ${selectedFinanceYearLabel}.`,
          "This uses payment date in the selected FY and liability source from an earlier FY.",
          "It is not restricted to files initiated in the selected FY.",
          "If a payment date is edited later, rows can move into or out of this panel.",
          "Supplementary bills are included if their payment date falls in this FY.",
          "Closed Files are included when payment liability history matches.",
          "Shortclosed S.O. rows remain included.",
          "Liability FY button shows the FY from which the liability came.",
        ],
        carryForward: [
          `Liability/source rows of ${selectedFinanceYearLabel} that remain unpaid at FY end.`,
          "This uses the liability source year, usually S.O./bill source date, not file initiation year.",
          "It can include visible files initiated outside the selected FY if their liability source belongs to this FY.",
          "If payment is later recorded after FY end, that row may also appear in the cleared-later panel.",
          "Supplementary bills are included if they remain unpaid at FY end.",
          "Closed Files are included when payment liability history matches.",
          "Shortclosed S.O. rows remain included.",
          "Liability FY button opens the contributing files/S.O.",
        ],
        futureClearedCarryForward: [
          `${selectedFinanceYearLabel} carry-forward rows that were paid after this FY ended.`,
          "This tracks later payment of liabilities sourced from the selected FY.",
          "It is not a frozen year-end snapshot; later payment entries intentionally update this panel.",
          "It is not restricted by file initiation FY.",
          "Supplementary bills are included if they were carried forward and later paid.",
          "Closed Files are included when payment liability history matches.",
          "Shortclosed S.O. rows remain included.",
          "Clearing FY button shows the future clearing FY.",
        ],
        firmType: [
          "Firm Type Distribution is shown only for specific Activity FY views and cumulative All-files views.",
          "For a specific Activity FY, it counts S.O.s placed and payments made during that FY.",
          "For Global Filter = All files, it is cumulative for the selected file universe.",
          "It is hidden in active operational workload views.",
        ],
      };

  const financeBoxTitleClass = "text-sm font-extrabold text-foreground";
  const financeActivityYearExportLabel = isAllFilesYear(settings.selectedYear)
    ? "All files"
    : isAllActiveFilesYear(settings.selectedYear)
      ? "All active files"
      : isActivePlusCurrentFyClosedYear(settings.selectedYear)
        ? "Active + current FY closed"
        : `FY ${selectedFinanceYearLabel}`;
  const financeFileYearExportLabel =
    activeFileYear === "all"
      ? isAllFilesYear(settings.selectedYear)
        ? "Entire database"
        : "All file years"
      : `FY ${activeFileYear}`;
  const financeExportTitle =
    activeDivision === "all"
      ? `Finance summary - Global Filter ${financeActivityYearExportLabel} - Subfilter ${financeFileYearExportLabel} - All divisions`
      : `Finance summary - Global Filter ${financeActivityYearExportLabel} - Subfilter ${financeFileYearExportLabel} - ${activeDivision}`;
  const financeExportRows = [
    {
      category: "Allocated",
      capital: formatCurrency(financeTotals.allocatedCapital),
      revenue: formatCurrency(financeTotals.allocatedRevenue),
      notes: isAllFilesEntireDatabaseFinanceView
        ? "Sum of allocations across all configured FYs for the visible divisions."
        : isAllFilesSpecificFileYearFinanceView
          ? `Allocated amount for FY ${activeFileYear}.`
        : "Allocated amount for the selected financial year.",
    },
    ...(shouldShowFinanceLivePositionCards
      ? [
          {
            category: "Intended",
            capital: formatCurrency(financeTotals.projectedCapital),
            revenue: formatCurrency(financeTotals.projectedRevenue),
            notes: `Against allocation: Capital ${formatPercent(capitalProjectedPercent)}, Revenue ${formatPercent(
              revenueProjectedPercent,
            )}. Current-position value; not frozen at FY end.`,
          },
          {
            category: "Booked",
            capital: formatCurrency(financeTotals.bookedCapital),
            revenue: formatCurrency(financeTotals.bookedRevenue),
            notes: `Against allocation: Capital ${formatPercent(capitalBookedPercent)}, Revenue ${formatPercent(
              revenueBookedPercent,
            )}. Current-position value; later S.O. entry can move it to Committed.`,
          },
          {
            category: "Committed",
            capital: formatCurrency(financeTotals.spentCapital),
            revenue: formatCurrency(financeTotals.spentRevenue),
            notes: `Against allocation: Capital ${formatPercent(capitalSpentPercent)}, Revenue ${formatPercent(
              revenueSpentPercent,
            )}. Current effective S.O. value; not a frozen selected-FY snapshot.`,
          },
          {
            category: "Paid Till Date",
            capital: formatCurrency(financePaidTillDate.capital),
            revenue: formatCurrency(financePaidTillDate.revenue),
            notes:
              `Current cumulative paid amount against ${financeLiveValueBasisLabel.replace(/^Basis: /, "")}, including final/stage/supplementary payments and advance payments; no payment-FY restriction.`,
          },
        ]
      : []),
    ...(!isCumulativeFinancePositionView
      ? [
          {
            category: `Payment in ${selectedFinanceYearLabel}`,
            capital: formatCurrency(financePaymentInYearCapital),
            revenue: formatCurrency(financePaymentInYearRevenue),
            notes: `Actual payment amount with payment/advance payment date in ${selectedFinanceYearLabel}; includes final, stage, supplementary, and advance payments.`,
          },
          {
            category: `Carry Forward from previous FYs as on ${selectedFinanceYearLabel} end`,
            capital: formatCurrency(financeTotals.previousCarryForward?.capital ?? 0),
            revenue: formatCurrency(financeTotals.previousCarryForward?.revenue ?? 0),
            notes: `${financeTotals.previousCarryForward?.count ?? 0} older liability/source-FY rows still unpaid at ${selectedFinanceYearLabel} end. For shortclosed S.O.s, only real pending payable items are counted, not the full old S.O. value.`,
          },
          {
            category: `Cleared Carry Forward in ${selectedFinanceYearLabel}`,
            capital: formatCurrency(financeTotals.clearedCarryForward?.capital ?? 0),
            revenue: formatCurrency(financeTotals.clearedCarryForward?.revenue ?? 0),
            notes: `${financeTotals.clearedCarryForward?.count ?? 0} older liability/source-FY rows paid in ${selectedFinanceYearLabel}.`,
          },
          {
            category: `Carry Forward of ${selectedFinanceYearLabel}`,
            capital: formatCurrency(financeTotals.carryForward?.capital ?? 0),
            revenue: formatCurrency(financeTotals.carryForward?.revenue ?? 0),
            notes: `${financeTotals.carryForward?.count ?? 0} ${selectedFinanceYearLabel} liability/source-FY rows unpaid by FY end. For shortclosed S.O.s, only real pending payable items are counted, not the full old S.O. value.`,
          },
          {
            category: `Carry Forward of ${selectedFinanceYearLabel} cleared later`,
            capital: formatCurrency(financeTotals.futureClearedCarryForward?.capital ?? 0),
            revenue: formatCurrency(financeTotals.futureClearedCarryForward?.revenue ?? 0),
            notes: `${financeTotals.futureClearedCarryForward?.count ?? 0} ${selectedFinanceYearLabel} liability/source-FY rows paid in later FYs.`,
          },
        ]
      : []),
  ];
  const getAnalyticsSortDirection = (panelKey: AnalyticsPanelKey) =>
    analyticsSortDirections[panelKey] ?? getDefaultAnalyticsSortDirection(panelKey);
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
      analytics.topFirmSupplyOrders,
      getAnalyticsSortDirection("topFirms"),
    ),
  );
  const firmAnalysisRows = analytics.firmAnalysis ?? [];
  const selectedFirmAnalysisRow =
    firmAnalysisRows.find((row) => row.name === selectedFirmAnalysisFirm);
  useEffect(() => {
    if (
      selectedFirmAnalysisFirm &&
      !firmAnalysisRows.some((row) => row.name === selectedFirmAnalysisFirm)
    ) {
      setSelectedFirmAnalysisFirm("");
    }
  }, [firmAnalysisRows, selectedFirmAnalysisFirm]);
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
      analytics.topIndentorsByFiles,
      getAnalyticsSortDirection("indentorsByFiles"),
    ),
  );
  const topIndentorsByValueRankedRows = withAnalyticsRanks(
    sortIndentorValueRows(
      analytics.topIndentorsByValue,
      indentorsByValueSortKey,
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
      : analytics.monthWiseDeliverySchedule?.length
        ? analytics.monthWiseDeliverySchedule
        : localMonthWiseDeliveryScheduleRows;
  const activeTcecStatus =
    tcecStatusStage === "pre"
      ? analytics.tcecStatus.pre
      : analytics.tcecStatus.post;
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
    ? activeTcecStatus.meetings
        .filter((row) => row.committee === activeTcecCommittee)
        .filter(
          (row) =>
            !selectedTcecFiscalYear ||
            getFinancialYearForDate(row.meetingDate) === selectedTcecFiscalYear,
        )
    : [];
  const displayedTcecRows = selectedTcecFiscalYear ? activeTcecCommitteeRows : tcecFyRows;
  const cncFyRows = getFiscalYearSummaryRows(analytics.cncSummary, "cncDate", [
    "reviewed",
    "approved",
    "financialSanctionSigned",
    "supplyOrderPlaced",
    "approvalPending",
    "financialSanctionPending",
    "supplyOrderPending",
  ]);
  const displayedCncRows = selectedCncFiscalYear
    ? analytics.cncSummary.filter(
        (row) => getFinancialYearForDate(String(row.cncDate ?? "")) === selectedCncFiscalYear,
      )
    : cncFyRows;
  const analyticsPanels: AnalyticsPanel[] = [
    {
      key: "divisionFiles",
      title: "Division ranking by files",
      subtitle: "Number of files",
      helper: [
        "Global Filter and File Initiation Year first decide the file set.",
        "Count shows number of selected files under each division.",
        "This is file-level comparison, so cancellation visibility follows the selected global file set.",
      ],
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
      helper: [
        "Global Filter and File Initiation Year first decide the file set.",
        "Intended, booked, committed, and S.O. values are calculated from those selected files, not from the date the value activity happened.",
        "Cancelled S.O. value is excluded from S.O.-value calculations; shortclosed S.O.s remain included.",
        "For All files / All active files / Active + current FY closed, allocation uses the current FY allocation.",
      ],
      columns: withRankAnalyticsColumns(
        getDivisionValueAnalyticsColumns(visibleDivisionValueMetrics, divisionValueDisplayMode),
      ),
      rows: analytics.divisionValueRanking,
    },
    {
      key: "divisionTotalValue",
      title: "Division ranking by total value",
      subtitle: "Allocated, intended, booked, and committed totals",
      helper: [
        "Global Filter and File Initiation Year first decide the file set.",
        "Intended, booked, committed, and S.O. totals are calculated from those selected files, not from the date the value activity happened.",
        "Cancelled S.O. value is excluded from S.O.-value calculations; shortclosed S.O.s remain included.",
        "For All files / All active files / Active + current FY closed, allocation uses the current FY allocation.",
      ],
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
      helper: [
        "Global Filter and File Initiation Year first decide the file set.",
        "Average is calculated from Demand received date to first S.O. date inside selected files.",
        "Cancelled demand files are excluded.",
        "File Closed, Cancelled S.O., and Shortclosed S.O. files remain included when they belong to the selected global file set.",
      ],
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
      helper: [
        "Division access, Global Filter, File Initiation Year, initiation date range, and File Type filter first decide the accessible file set.",
        "Cancelled demand files are excluded.",
        "Because this is firm history, File Closed, cancelled S.O., and shortclosed S.O. records can still contribute when they belong to the selected file set.",
        "Ranking uses S.O. values recorded inside those selected files.",
        "If FY 2025-26 is selected, the file set is narrowed by that FY context, but S.O.s inside those files can still be counted even if the S.O. date is in another FY.",
      ],
      helperExamples: {
        title: "Firm ranking examples",
        items: [
          "File Initiation Year FY 2025-26 selected: a file initiated in FY 2025-26 can contribute all S.O.s recorded in that file, even if one S.O. date is in FY 2026-27.",
          "Cancelled S.O. exists for a firm: it can still contribute to firm history because the firm did receive an order.",
          "File Closed selected through All files: the closed file can still contribute to firm ranking if it has S.O. firm/value history.",
          "Demand Cancelled file: it is excluded from this ranking.",
        ],
      },
      columns: withRankAnalyticsColumns(getValueAnalyticsColumns("Firm", "S.O. value")),
      rows: topFirmPagination.rows,
    },
    {
      key: "firmAnalysis",
      title: "Firm Analysis",
      subtitle: selectedFirmAnalysisRow
        ? `BQ, invited, tender participation, and order conversion for ${selectedFirmAnalysisRow.name}`
        : "Select a firm to see BQ, invitation, tender participation, and order conversion.",
      helper: [
        "Division access, Global Filter, File Initiation Year, initiation date range, and File Type filter first decide the accessible file set.",
        "Firm counts are taken from BQ, invitation, tender participation, and S.O. entries inside those selected files.",
        "Cancelled demand files are excluded.",
        "Because this is firm history, File Closed, cancelled S.O., and shortclosed S.O. records can still contribute when they belong to the selected file set.",
      ],
      helperExamples: {
        title: "Firm Analysis examples",
        items: [
          "BQ checked: a firm is counted if it appears in BQ firms for a selected file.",
          "Invited checked: a firm is counted if it appears in invited firms for a selected file.",
          "Bidders checked: a firm is counted if it participated as a bidder in a selected file.",
          "Order checked: a firm is counted if it appears in S.O. firm details, including cancelled or shortclosed S.O. history.",
          "The same file can contribute to more than one role if the firm appears at multiple stages.",
        ],
      },
      columns: getFirmAnalysisColumns(),
      rows: selectedFirmAnalysisDisplayRows,
    },
    {
      key: "indentorsByFiles",
      title: "Top indentors by files",
      subtitle: "Number of files raised",
      helper: [
        "Global Filter and File Initiation Year first decide the file set.",
        "Count shows number of selected files raised by each indentor.",
        "Cancelled demand files are excluded.",
        "File Closed, Cancelled S.O., and Shortclosed S.O. files remain included when they belong to the selected global file set.",
      ],
      columns: withRankAnalyticsColumns(getCountAnalyticsColumns("Indentor")),
      rows: indentorsByFilesPagination.rows,
    },
    {
      key: "indentorsByValue",
      title: "Top indentors by value",
      subtitle: "Total demand value",
      exportNote: `Sorted by ${
        indentorValueSortOptions.find((option) => option.key === indentorsByValueSortKey)?.label ??
        "Total"
      } value.`,
      helper: [
        "Global Filter and File Initiation Year first decide the file set.",
        "Capital value is the sum of demand Capital value from selected files.",
        "Revenue value is the sum of demand Revenue value from selected files.",
        "Total value is Capital value plus Revenue value, and sorting is by Total value.",
        "It does not apply a separate activity-date filter.",
        "Cancelled demand files are excluded.",
        "File Closed, Cancelled S.O., and Shortclosed S.O. files remain included when they belong to the selected global file set.",
      ],
      columns: withRankAnalyticsColumns(getIndentorValueAnalyticsColumns()),
      rows: indentorsByValuePagination.rows,
    },
    {
      key: "biddingMode",
      title: "Bidding mode mix",
      subtitle: "Distribution by mode",
      helper: [
        "Global Filter and File Initiation Year first decide the file set.",
        "Count shows selected files grouped by bidding mode.",
        "Cancelled demand files are excluded.",
        "File Closed, Cancelled S.O., and Shortclosed S.O. files remain included when they belong to the selected global file set.",
      ],
      columns: getCountAnalyticsColumns("Mode"),
      rows: analytics.biddingModeMix,
    },
    {
      key: "fileValueThresholds",
      title: "Count and Value analysis",
      subtitle: getCountValueAnalysisSubtitle(countValueAnalysisMode),
      helper: [
        "Global Filter and File Initiation Year first decide the file set.",
        "Count mode groups selected files by configured value slabs.",
        "S.O. value mode uses supply order values recorded inside those selected files.",
        "Cancelled demand files are excluded.",
        "Cancelled S.O. and shortclosed S.O. rows remain included in S.O. value slabs for historical analysis.",
      ],
      helperExamples: {
        title: "Count and Value examples",
        items: [
          "File value mode: a file with demand value 8 lakh appears in the 0-10 lakh slab.",
          "S.O. value mode: if one file has S.O.s of 6 lakh and 35 lakh, it can contribute to both matching S.O. slabs.",
          "Cancelled S.O. of 20 lakh: it remains included in S.O. value slabs.",
          "Shortclosed S.O. of 20 lakh: it remains included.",
        ],
      },
      columns: getCountValueAnalysisColumns(countValueAnalysisMode),
      rows: getCountValueAnalysisRows(analytics, countValueAnalysisMode),
    },
    {
      key: "paymentPending",
      title: "Payment pending by division",
      subtitle: "Delivery/job completion done but payment not completed",
      helper: [
        "Global Filter and File Initiation Year first decide the file set.",
        "Payment pending is calculated from the current payment status inside those selected files.",
        "Includes main S.O. payments, stage-wise payments, returned main bills, advance payments, and supplementary bills.",
        "This is a payment-case count, not a unique-file count. One file can contribute more than one pending payment case.",
        "For physical delivery/inspection cases, payment can become pending after material receipt.",
        "For Goods & Services where IR is No, payment can become pending after Job Completion.",
        "For AMC/MPC/CARS/CAPSI/O&M contract files, payment can become pending from D.P./Revised D.P.; Job Completion can also trigger it when service is completed earlier.",
        "Main/stage payment is counted when payment workflow has started or payment is due and Payment Date is blank.",
        "Advance Payment is counted when Advance Payment is Yes and Advance Payment Date is blank.",
        "Supplementary bill is counted when it is submitted, returned, or resubmitted and Supplementary Payment Date is blank.",
        "Cancelled S.O.s are excluded.",
        "Shortclosed S.O.s remain included if payment is still pending for work already delivered/completed.",
      ],
      helperExamples: {
        title: "Payment pending examples",
        items: [
          "Material received, but Payment Date is blank.",
          "Job completion done, but Payment Date is blank.",
          "A stage delivery/job is completed, but payment date for that stage is blank.",
          "A returned main bill is still unpaid.",
          "Advance Payment is Yes, but advance payment date is blank.",
          "A supplementary bill is submitted, returned, or resubmitted, but payment date is blank.",
          "Cancelled S.O.: excluded.",
          "Shortclosed S.O.: payment for delivered/completed work can still keep the file pending.",
        ],
      },
      columns: withRankAnalyticsColumns(getCountAnalyticsColumns("Division")),
      rows: withAnalyticsRanks(
        sortAnalyticsRows(
          withAssignedDivisionRows(
            analytics.divisionPaymentPendingRanking,
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
      helper: [
        "Global Filter and File Initiation Year first decide the file set.",
        "FY/month rows here are grouped by Pre-Bid Meeting date.",
        "Refloat Pre-Bid entries are included with Pre-Bid meeting counts where applicable.",
        "Active files excludes File Closed and all-S.O.-cancelled files.",
        "All files or a specific FY can include them if they belong to the selected set and their Pre-Bid dates exist.",
        "Shortclosed S.O. status does not remove the file from Pre-Bid history.",
      ],
      helperExamples: {
        title: "Pre-Bid examples",
        items: [
          "File initiated in FY 2025-26 with Pre-Bid Meeting Date 10-May-2026: File Initiation Year FY 2025-26 can select the file, but the row appears under FY 2026-27 because the Pre-Bid date falls there.",
          "Active files selected: File Closed and all-S.O.-cancelled files with Pre-Bid date are excluded.",
          "All files or a specific FY selected: the same closed file can appear in the month/FY where its Pre-Bid date falls.",
          "Refloat Pre-Bid Date 15-Jul-2026 filled: it is counted in Refloat Pre-Bid history.",
          "If S.O. gets shortclosed: the earlier Pre-Bid history remains valid and can remain visible.",
        ],
      },
      columns: selectedPreBidFiscalYear
        ? getPreBidMeetingAnalyticsColumns()
        : getFiscalPreBidMeetingAnalyticsColumns(setSelectedPreBidFiscalYear),
      rows: displayedPreBidRows,
    },
    {
      key: "tcecStatus",
      title: "TCEC summary",
      subtitle: selectedTcecFiscalYear
        ? tcecStatusStage === "pre"
          ? `Pre-TCEC committee-wise status for FY ${selectedTcecFiscalYear}`
          : `Post-TCEC committee-wise status for FY ${selectedTcecFiscalYear}`
        : tcecStatusStage === "pre"
          ? "Pre-TCEC FY-wise review and minutes status"
          : "Post-TCEC FY-wise review and minutes status",
      helper: [
        "Global Filter first decides the file set and, when it is a specific FY, restricts TCEC activity dates to that FY.",
        "File Initiation Year only narrows which files can contribute.",
        "FY rows here are grouped by TCEC meeting date.",
        "Committee rows are grouped by the selected Pre-TCEC or Post-TCEC committee number.",
        "Pre-TCEC remains separate from Post-TCEC because they are different workflow stages.",
        "Post-TCEC includes Refloat Post-TCEC where the stage meaning is the same.",
        "Active files excludes File Closed and all-S.O.-cancelled files.",
        "All files or a specific FY can include them if they belong to the selected set and their TCEC dates exist.",
        "Shortclosed S.O. status does not remove the file from TCEC history.",
      ],
      helperExamples: {
        title: "TCEC examples",
        items: [
          "File initiated in FY 2025-26 with Post-TCEC Date 05-Apr-2026: File Initiation Year FY 2025-26 can select the file, but the row appears under FY 2026-27 because the Post-TCEC date falls there.",
          "Active files selected: File Closed and all-S.O.-cancelled files with TCEC dates are excluded.",
          "All files or a specific FY selected: the same closed file can appear in Pre-TCEC or Post-TCEC history if the relevant TCEC date exists.",
          "Post-TCEC selected: normal Post-TCEC and Refloat Post-TCEC are counted together.",
          "Pre-TCEC selected: Pre-TCEC remains separate and is not mixed with Post-TCEC.",
          "Minutes Date blank: the file is reviewed/pending, not signed.",
        ],
      },
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
      helper: [
        "Global Filter first decides the file set and, when it is a specific FY, restricts CNC Date to that FY.",
        "File Initiation Year only narrows which files can contribute.",
        "FY/date rows here are grouped by CNC Date.",
        "Reviewed means CNC Date is filled.",
        "Approval status is based on CNC Approval Date.",
        "Financial Sanction is the next applicable stage after CNC approval.",
        "Active files excludes File Closed and all-S.O.-cancelled files.",
        "All files or a specific FY can include them if they belong to the selected set and their CNC Date exists.",
        "Shortclosed S.O. status does not remove the file from CNC history.",
      ],
      helperExamples: {
        title: "CNC examples",
        items: [
          "File initiated in FY 2025-26 with CNC Date 20-Apr-2026: File Initiation Year FY 2025-26 can select the file, but the row appears under FY 2026-27 because CNC Date falls there.",
          "CNC Date filled and CNC Approval Date blank: the file counts as reviewed and approval pending.",
          "CNC Approval Date filled but no non-cancelled S.O. has Financial Sanction: the file counts under Financial Sanction pending.",
          "Financial Sanction completed but no non-cancelled S.O. placed: the file counts under S.O. pending.",
          "Active files selected: File Closed and all-S.O.-cancelled files with CNC Date are excluded.",
          "All files or a specific FY selected: the same closed file can appear in CNC summary.",
          "Shortclosed S.O. later: CNC history remains valid because shortclosure is not cancellation.",
        ],
      },
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
      helper: [
        "The bell count and this list use the same file scope: Global Filter, File Initiation Year, initiation date, Division, and File Type, limited to files you are allowed to access.",
        "Rows show suspected data issues detected inside the files selected by these filters.",
        "For anomaly detection, inactive means File Closed, Cancelled demand, or every S.O. in the file is cancelled.",
        "Inactive does not mean payment completed.",
        "Active files with required Yes/No flags left blank are shown as data-completeness anomalies.",
        "Accepted or suppressed anomaly rules may affect what remains visible.",
      ],
      helperExamples: {
        title: "Anomaly examples",
        items: [
          "File Closed but BG return is blank: the file can appear as a suspected anomaly.",
          "File Closed but payment liability is still pending: the file can appear as a suspected anomaly.",
          "Active file with TCEC, GeM, or IFA left blank: the file can appear as a data-completeness anomaly.",
          "Cancelled demand: anomaly rules that only apply to active files should treat it as inactive.",
          "All S.O.s cancelled: the file is treated as inactive for anomaly checks even if File Closed is not ticked.",
          "An accepted anomaly may stop appearing until the acceptance is revoked or the rule changes.",
        ],
      },
      columns: getSuspectedAnomalyColumns(
        acceptSuspectedAnomaly,
        hasAnomalyAdminAccess(activeUser?.role) ? reviewSuspectedAnomaly : undefined,
      ),
      rows: suspectedAnomalyRows.map((row) => ({ ...row, name: row.fileRef })),
    },
    {
      key: "delayStatus",
      title: "Delay status",
      subtitle: `Live files currently stuck for more than ${Number.parseInt(analyticsDelayDays, 10) || 0} days. Average ${analyticsDelaySummary?.averageDays ?? 0} days; longest ${analyticsDelaySummary?.longestDays ?? 0} days.`,
      helper: [
        "Global Filter and File Initiation Year first decide the file set.",
        "Delay is calculated only from the current pending milestone/order state inside those selected files.",
        "Historical delays at milestones already cleared are excluded from Delay Status.",
        "Panel filters such as Delay days and Milestone further narrow this view.",
      ],
      helperExamples: {
        title: "Delay examples",
        items: [
          "Delay days set to 30: a file pending at a milestone for 31 days can appear.",
          "Delay days set to 60: the same 31-day pending file will not appear.",
          "Milestone set to Scrutiny: only files currently delayed at Scrutiny are counted.",
          "Milestone set to All milestones: files delayed at any pending milestone can appear.",
          "A milestone already cleared before the delay limit is not counted because it is not a live/current delay.",
        ],
      },
      columns: getCountAnalyticsColumns("Milestone", "File count"),
      rows: (analyticsDelaySummary?.byMilestone ?? []).map((row) => ({
        ...row,
        name: row.label,
      })),
    },
    {
      key: "milestoneClearingTable",
      title: "Milestone clearing ranking",
      subtitle:
        milestoneClearingViewMode === "chronological"
          ? "Milestones in chronological workflow order"
          : "Slowest milestones by average clearing time",
      helper: [
        "Global Filter and File Initiation Year first decide the file set.",
        "Clearing duration is calculated from milestone dates inside those selected files.",
        "From Supply Order onward, each valid S.O./stage/payment row contributes one sample to the average.",
        "Cancelled S.O. rows are included for Supply Order placement clearing, but excluded from later S.O./payment-side clearing milestones.",
        "Panel filters such as Value Threshold and Mode further narrow both the counts and Search landings.",
      ],
      helperExamples: {
        title: "Milestone clearing examples",
        items: [
          "Scrutiny cleared in 4 days: it contributes 4 days to Scrutiny average.",
          "One file with 3 valid S.O. rows contributes 3 samples from Supply Order onward.",
          "Value Threshold set to 0-10 lakh: only matching files contribute to the displayed milestone averages.",
          "Mode set to PBM: only selected PBM files contribute to the displayed milestone averages.",
          "If one file has multiple S.O./stage rows, a clicker may focus the matching row or milestone inside that file.",
          "Chronological view shows workflow order; ranking view sorts by slowest average clearing time.",
        ],
      },
      columns:
        milestoneClearingViewMode === "chronological"
          ? getMilestoneClearingAnalyticsColumns("chronological")
          : withRankAnalyticsColumns(getMilestoneClearingAnalyticsColumns("ranking")),
      rows: withAnalyticsRanks(
        sortMilestoneClearingRows(
          getMilestoneClearingDisplayRows(milestoneClearingRows, milestoneClearingViewMode),
          milestoneClearingViewMode,
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
  const analyticsSortControlEnabled =
    displayedAnalyticsPanel.columns.some((column) => column.key === "rank") &&
    !(
      displayedAnalyticsPanel.key === "milestoneClearingTable" &&
      milestoneClearingViewMode === "chronological"
    );
  const analyticsLimitControl =
    selectedAnalyticsPanel.key === "topFirms"
      ? {
          value: topFirmLimit,
          onChange: (value: AnalyticsResultLimitKey) => {
            setTopFirmLimit(value);
            setTopFirmPage(1);
          },
          total: analytics.topFirmSupplyOrders.length,
        }
      : selectedAnalyticsPanel.key === "indentorsByFiles"
        ? {
            value: indentorsByFilesLimit,
            onChange: (value: AnalyticsResultLimitKey) => {
              setIndentorsByFilesLimit(value);
              setIndentorsByFilesPage(1);
            },
            total: analytics.topIndentorsByFiles.length,
          }
        : selectedAnalyticsPanel.key === "indentorsByValue"
          ? {
              value: indentorsByValueLimit,
              onChange: (value: AnalyticsResultLimitKey) => {
                setIndentorsByValueLimit(value);
                setIndentorsByValuePage(1);
              },
              total: analytics.topIndentorsByValue.length,
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

  const selectDashboardTab = (tab: DashboardTab) => {
    setActiveDashboardTab(tab);
    navigate({
      to: "/dashboard",
      search: {
        tab,
        analyticsPanel: tab === "analytics" ? activeAnalyticsPanel : undefined,
      },
      replace: true,
    });
  };

  const selectAnalyticsPanel = (panel: AnalyticsPanelKey) => {
    setActiveAnalyticsPanel(panel);
    navigate({
      to: "/dashboard",
      search: {
        tab: "analytics",
        analyticsPanel: panel,
      },
      replace: true,
    });
  };

  const openSearchFilter = (dashboardFilter: string) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter,
        selectedYear: settings.selectedYear,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        drillPath: serializeDrillPath(getDashboardDrillPath(activeDashboardTab, dashboardFilter)),
      },
    });
  };
  const openFinance1Drilldown = (key: string, section: string, metric: string) => {
    const fileIds = finance1Summary.drillFileIds?.[key] ?? [];
    if (!fileIds.length) return;
    const snapshotHref = `/dashboard?tab=finance1&finance1Year=${encodeURIComponent(finance1Summary.fiscalYear)}`;
    const focus = getFinance1DrillFocus(key, section, metric);
    const focusTargets = focus.focusTarget
      ? fileIds
          .map((fileId) => `${encodeURIComponent(fileId)}=${encodeURIComponent(focus.focusTarget!)}`)
          .join(",")
      : undefined;
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `snapshotFileIds:${fileIds.map(encodeURIComponent).join(",")}`,
        selectedYear: "__all_files__",
        fileYear: "all",
        division: activeDivision === "all" ? undefined : activeDivision,
        focusSection: focus.focusSection,
        focusMilestone: focus.focusMilestone,
        focusTarget: focus.focusTarget,
        focusTargets,
        drillPath: serializeDrillPath([
          drillItem("Dashboard", "/dashboard"),
          drillItem("FY Snapshot", snapshotHref),
          drillItem(finance1Summary.fiscalYear, snapshotHref),
          drillItem(section, snapshotHref),
          drillItem(metric),
        ]),
      },
    });
  };
  const finance1DrillClick = (key: string, section: string, metric: string) =>
    finance1Summary.drillFileIds?.[key]?.length
      ? () => openFinance1Drilldown(key, section, metric)
      : undefined;
  const openLiveStatusFilter = (division: string, milestoneName: string) => {
    const filterMilestoneName = normalizeLiveStatusMilestoneName(milestoneName);
    const dashboardFilter =
      normalizeMilestoneName(filterMilestoneName) === "supplementarybillreturnedforcorrection"
        ? "supplementaryBill:returned"
        : normalizeMilestoneName(filterMilestoneName) === "deliveryperiod"
          ? "deliveryPeriodLive"
          : `manualMilestoneCurrent:${filterMilestoneName}`;
    navigate({
      to: "/search",
      search: {
        dashboardFilter,
        selectedYear: settings.selectedYear,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        division,
        fileCategories: activeFileCategoriesParam,
        drillPath: serializeDrillPath([
          drillItem("Dashboard", "/dashboard"),
          drillItem("Status-2", "/dashboard?tab=liveStatus"),
          drillItem(division, "/dashboard?tab=liveStatus"),
          drillItem(filterMilestoneName),
        ]),
      },
    });
  };
  const openStatus4Filter = (filter: Status4SearchFilter) => {
    const dashboardFilter = getStatus4DashboardFilter(filter);
    const focusTarget = getStatus4SearchFocusTarget(filter.milestone, filter.metric);
    navigate({
      to: "/search",
      search: {
        dashboardFilter,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        selectedYear: settings.selectedYear,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        focusSection: focusTarget ? "Supply order and payment" : undefined,
        focusTarget,
        drillPath: serializeDrillPath(getStatus4DrillPath(filter)),
      },
    });
  };
  const openAnalyticsResultsInSearch = () => {
    if (!analyticsTransferType || displayedAnalyticsPanel.rows.length === 0) return;
    const analyticsHref = getAnalyticsPanelHref(displayedAnalyticsPanel.key);
    navigate({
      to: "/search",
      search: {
        dashboardFilter: undefined,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        selectedYear: settings.selectedYear,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
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
        demandCancelledPresenceFilter: analyticsTransferType ? "exclude" : undefined,
        drillPath: serializeDrillPath([
          drillItem("Dashboard", "/dashboard"),
          drillItem("Analytics", analyticsHref),
          drillItem(displayedAnalyticsPanel.title, analyticsHref),
          drillItem("Send to Search Files"),
        ]),
      },
    });
  };
  const openAnalyticsSearchTarget = (target: AnalyticsSearchTarget) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter: target.dashboardFilter,
        extraDashboardFilters: target.extraDashboardFilters?.length
          ? JSON.stringify(target.extraDashboardFilters)
          : undefined,
        division:
          target.division ??
          (activeDivision === "all" ? undefined : activeDivision),
        includeModes: target.includeModes?.length ? target.includeModes.join(",") : undefined,
        fileCategories: activeFileCategoriesParam,
        selectedYear: settings.selectedYear,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        analyticsType: target.analyticsType,
        analyticsNames: target.analyticsNames?.length
          ? JSON.stringify(target.analyticsNames)
          : undefined,
        demandCancelledPresenceFilter: target.analyticsType ? "exclude" : undefined,
        capitalOnly: target.capitalOnly || undefined,
        revenueOnly: target.revenueOnly || undefined,
        focusSection: target.focusSection,
        focusMilestone: target.focusMilestone,
        focusTarget: target.focusTarget,
        drillPath: serializeDrillPath(
          target.drillPath ??
            getAnalyticsDrillPath(
              displayedAnalyticsPanel.key,
              displayedAnalyticsPanel.title,
              target.dashboardFilter,
            ),
        ),
      },
    });
  };
  const openCoBiddingSearch = (rows: CoBiddingTenderRow[]) => {
    if (!rows.length) return;
    const ids = rows.map((row) => row.id);
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `fileIds:${ids.join(",")}`,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        selectedYear: settings.selectedYear,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        drillPath: serializeDrillPath([
          drillItem("Dashboard", "/dashboard"),
          drillItem("Analytics", "/dashboard?tab=analytics"),
          drillItem("Firm Analysis", "/dashboard?tab=analytics&analyticsPanel=firmAnalysis"),
          drillItem("Co-bidding Firms"),
          ...(coParticipantFirm ? [drillItem(coParticipantFirm)] : []),
          ...(selectedCoParticipantFirm
            ? [
                drillItem(
                  coBiddingFirms.find((firm) => firm.key === selectedCoParticipantFirm)?.name ??
                    "Co-bidding firm",
                ),
              ]
            : []),
          ...(rows.length === 1
            ? [drillItem(rows[0].uniqueCode || rows[0].controlNo || "Shared tender")]
            : []),
        ]),
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
    return getAnalyticsSearchTarget(displayedAnalyticsPanel.key, row, column.key, {
      milestoneClearingMode,
      milestoneClearingValueThreshold,
      valueThresholdLevels: effectiveValueThresholdLevels,
      selectedTcecFiscalYear,
    });
  };
  const getAnalyticsColumnTotalSearchTarget = (
    column: AnalyticsTableColumn,
  ): AnalyticsSearchTarget | undefined =>
    getAnalyticsTotalSearchTarget(displayedAnalyticsPanel.key, column.key, {
      countValueAnalysisMode,
      selectedPreBidFiscalYear,
      selectedTcecFiscalYear,
      selectedCncFiscalYear,
      tcecStatusStage,
    });
  async function acceptSuspectedAnomaly(row: Record<string, number | string>) {
    const signature = String(row.signature ?? "");
    if (!signature) return;
    const reason = window.prompt("Message/reason to Admin for accepting this anomaly:");
    if (!reason?.trim()) return;
    try {
      await store.acceptSuspectedAnomaly(signature, reason.trim());
      const [acceptancePayload, anomalyPayload] = await Promise.all([
        store.listSuspectedAnomalyAcceptances(),
        fetchSuspectedAnomalies(suspectedAnomalyQuery, new AbortController().signal),
      ]);
      setAnomalyAcceptances(acceptancePayload.acceptances);
      setSuspectedAnomalyRows(anomalyPayload.rows);
    } catch (error) {
      console.error(error);
      window.alert(
        error instanceof Error ? error.message : "Could not request anomaly acceptance.",
      );
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
    const password = await promptPassword("Enter your account password to clear selected anomalies:");
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
  const toggleFileCategory = (category: FileCategoryKey, checked: boolean) => {
    setFileCategoryFilterTouched(true);
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
        fileYear: activeFileYear,
        fileInitiationDateRange: activeFileInitiationDateRange,
        fileCategories: activeFileCategoriesParam,
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
          {dashboardTabOptions.map((tab) => {
            const tabKey = tab.key;
            const helper = dashboardTabHelpers[tabKey];
            return (
              <div key={tab.key} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => selectDashboardTab(tabKey)}
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
                {helper ? (
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${tab.label} help`}
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
                        >
                          <Info className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        align="start"
                        className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
                      >
                        <HelperBulletList items={helper} />
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-end justify-end gap-3">
          <div className="flex shrink-0 items-end gap-2">
            <div className="flex items-end gap-1.5">
              <label
                className={filterLabelClass(
                  fileYearFilterActive,
                  "flex min-w-[160px] flex-col gap-1 text-xs text-muted-foreground",
                )}
              >
                <span className="inline-flex items-center gap-1">
                  File Initiation Year
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="File initiation year subfilter help"
                          className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <Info className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        align="start"
                        className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
                      >
                        <HelperBulletList items={fileYearSubfilterHelper} />
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </span>
                <select
                  data-testid="dashboard-file-year-select"
                  value={activeFileYear}
                  onChange={(event) => updateFileYearSelection(event.target.value)}
                  disabled={fileYearSubfilterLockedByPage}
                  className={filterControlClass(
                    fileYearFilterActive,
                    "h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-80",
                  )}
                >
                  {fileYearSubfilterLockedByPage ? (
                    <option value={activeFileYear}>{activeFileYear || "Select FY"}</option>
                  ) : (
                    <>
                      <option value="all">{fileYearAllOptionLabel}</option>
                      {availableFileYearOptions.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </label>
              <div className="flex flex-col items-center gap-1">
                <FloatingHelp label="File initiation year lock help">{fileYearLockHelper}</FloatingHelp>
                <button
                  type="button"
                  onClick={toggleFileYearLock}
                  disabled={fileYearSubfilterLockedByPage}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent"
                  title={
                    fileYearSubfilterLockedByPage
                      ? "Locked to selected FY for FY Snapshot"
                      : fileYearLocked
                        ? "Unlock file year"
                        : "Lock file year"
                  }
                  aria-label={
                    fileYearSubfilterLockedByPage
                      ? "Locked to selected FY for FY Snapshot"
                      : fileYearLocked
                        ? "Unlock file year"
                        : "Lock file year"
                  }
                >
                  {fileYearSubfilterLockedByPage || fileYearLocked ? (
                    <Lock className="size-4" />
                  ) : (
                    <Unlock className="size-4" />
                  )}
                </button>
              </div>
            </div>
            <FileInitiationDateRangeFilter
              fromDate={fileInitiationFromDate}
              toDate={fileInitiationToDate}
              active={fileInitiationDateFilterActive}
              onFromDateChange={(fromDate) => updateFileInitiationDateRange({ fromDate })}
              onToDateChange={(toDate) => updateFileInitiationDateRange({ toDate })}
              onClear={clearFileInitiationDateRange}
            />
          </div>
          <label
            className={filterLabelClass(
              divisionFilterActive,
              "flex min-w-[150px] flex-col gap-1 text-xs text-muted-foreground",
            )}
          >
            <span>Division</span>
            <select
              value={activeDivision}
              onChange={(event) => setSelectedDivision(event.target.value)}
              className={filterControlClass(
                divisionFilterActive,
                "h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40",
              )}
            >
              <option value="all">Divisions</option>
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
            active={fileCategoryFilterActive}
            onChange={toggleFileCategory}
          />
        </div>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold">Snapshot</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  printSnapshotRowsToPdf(snapshotExportRows, "Snapshot", dashboardExportDescription)
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent"
              >
                <FileText className="size-3.5" />
                Export PDF
              </button>
              <button
                type="button"
                onClick={() =>
                  exportSnapshotRowsToExcel(
                    snapshotExportRows,
                    "Snapshot",
                    dashboardExportDescription,
                  )
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent"
              >
                <FileSpreadsheet className="size-3.5" />
                Export Excel
              </button>
            </div>
          </div>
          <SectionRuleToolbar title="Global rules" items={dashboardSectionRuleHelpers.snapshot} />
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
          <SectionRuleToolbar title="Global rules" items={dashboardSectionRuleHelpers.status1} />
          <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)]">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">File status</h3>
              </div>
              <div className="flex flex-wrap items-end justify-end gap-2">
                <div className="flex rounded-md border border-border bg-secondary/40 p-1">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        printStatusPageRowsToPdf(
                          statusPageExportRows,
                          statusPageExportTitle,
                          dashboardExportDescription,
                        )
                      }
                      className="flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    >
                      <FileText className="size-3.5" />
                      Export PDF
                    </button>
                    <FloatingHelp label="Export PDF status helper">
                      {statusFileExportHelpers.pdf}
                    </FloatingHelp>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        exportStatusPageRowsToExcel(
                          statusPageExportRows,
                          statusPageExportTitle,
                          dashboardExportDescription,
                        )
                      }
                      className="flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    >
                      <FileSpreadsheet className="size-3.5" />
                      Export Excel
                    </button>
                    <FloatingHelp label="Export Excel status helper">
                      {statusFileExportHelpers.excel}
                    </FloatingHelp>
                  </div>
                </div>
                <div className="flex rounded-md border border-border bg-secondary/40 p-1">
                  {statusActionModes.map((mode) => {
                    const Icon = mode.icon;
                    const selected = statusActionMode === mode.key;
                    return (
                      <div key={mode.key} className="flex items-center gap-0.5">
                        <button
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
                        <FloatingHelp label={`${mode.label} status action helper`}>
                          {mode.helper}
                        </FloatingHelp>
                      </div>
                    );
                  })}
                </div>
                <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1 text-[11px] font-medium text-muted-foreground">
                    <span>Total files</span>
                    <FloatingHelp label="Total files cancellation helper">
                      {[
                        "Shows files in the selected Global/Subfilter scope.",
                        "Demand-cancelled files are excluded except from cancellation-specific counters.",
                        "Fully S.O.-cancelled files may remain in this total for history/context.",
                        "Live workflow, payment, delivery, BG, and liability counters exclude cancelled S.O. rows.",
                        "Use the S.O. cancelled counter to review cancelled S.O. records.",
                      ]}
                    </FloatingHelp>
                  </div>
                  <div className="text-lg font-semibold tabular-nums">{dashboardFileCount}</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {statusDisplayFlow.map((milestone, index) => {
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

                if ("jobLive" in milestone && "irPreparationPending" in milestone) {
                  return (
                    <JobCompletionIrFlowNode
                      key={milestone.key}
                      milestone={milestone}
                      index={index}
                      isLast={false}
                      onJobCompletedClick={() => handleStatusFilter("jobCompletionCompleted")}
                      onJobDueClick={() => handleStatusFilter("jobCompletionDue")}
                      onIrPreparationPendingClick={() =>
                        handleStatusFilter("irPreparationPending")
                      }
                      onIrReceiptPendingClick={() => handleStatusFilter("irReceiptPending")}
                      onIrCompletedClick={() => handleStatusFilter("irCompleted")}
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
                      title={getWorkflowDisplayLabel(milestone.label)}
                      isLast={false}
                      items={[
                        {
                          label: "IR Preparation Pending",
                          count: milestone.irPreparationPending,
                          onClick: () => handleStatusFilter("irPreparationPending"),
                          help: [
                            "Includes files where IR preparation is still pending after delivery/job completion.",
                            "Cancelled demand files are excluded.",
                            "File Closed follows the selected Global Filter.",
                          ],
                        },
                        {
                          label: "IR Receipt Pending",
                          count: milestone.irReceiptPending,
                          onClick: () => handleStatusFilter("irReceiptPending"),
                          help: [
                            "Includes files where IR has been prepared but IR receipt is still pending.",
                            "Cancelled demand files are excluded.",
                            "File Closed follows the selected Global Filter.",
                          ],
                        },
                        {
                          label: "IR Completed",
                          count: milestone.irCompleted,
                          onClick: () => handleStatusFilter("irCompleted"),
                          help: [
                            "Includes files where IR receipt/completion is recorded.",
                            "Cancelled demand files are excluded.",
                            "File Closed follows the selected Global Filter.",
                          ],
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
                      title={getWorkflowDisplayLabel(milestone.label)}
                      isLast={false}
                      items={[
                        {
                          label: "Due",
                          count: milestone.preBidDue,
                          onClick: () => handleStatusFilter("preBidMeeting:due"),
                          help: [
                            "Includes files where Pre-bid Meeting is due and not yet completed.",
                            "Cancelled demand files are excluded.",
                            "File Closed follows the selected Global Filter.",
                          ],
                        },
                        {
                          label: "Completed",
                          count: milestone.preBidCompleted,
                          onClick: () => handleStatusFilter("preBidMeeting:completed"),
                          help: [
                            "Includes files where Pre-bid Meeting completion is recorded.",
                            "Cancelled demand files are excluded.",
                            "File Closed follows the selected Global Filter.",
                          ],
                        },
                        {
                          label: "Refloat Due",
                          count: milestone.refloatPreBidDue,
                          onClick: () => handleStatusFilter("refloatPreBidMeeting:due"),
                          help: [
                            "Includes refloat files where Pre-bid Meeting is due and not yet completed.",
                            "Cancelled demand files are excluded.",
                            "File Closed follows the selected Global Filter.",
                          ],
                        },
                        {
                          label: "Refloat Completed",
                          count: milestone.refloatPreBidCompleted,
                          onClick: () => handleStatusFilter("refloatPreBidMeeting:completed"),
                          help: [
                            "Includes refloat files where Pre-bid Meeting completion is recorded.",
                            "Cancelled demand files are excluded.",
                            "File Closed follows the selected Global Filter.",
                          ],
                        },
                      ]}
                    />
                  );
                }

                return (
                  <Fragment key={milestone.key}>
                  <MilestoneFlowNode
                    milestone={milestone}
                    index={index}
                    isLast={false}
                    onTotalClick={() => handleStatusFilter(`milestoneTotal:${milestone.key}`)}
                    onUnderProcessClick={() =>
                      handleStatusFilter(
                        milestone.key === "supplyOrder"
                          ? "statusSummary:Supply Order:At Previous Stage"
                          : `milestoneUnderProcess:${milestone.key}`,
                      )
                    }
                    onActiveClick={() => handleStatusFilter(`milestoneActive:${milestone.key}`)}
                    onReviewedClick={() => handleStatusFilter(`milestoneReviewed:${milestone.key}`)}
                    onPendingClick={() => handleStatusFilter(`milestonePending:${milestone.key}`)}
                    onClearedClick={() => handleStatusFilter(`milestoneCleared:${milestone.key}`)}
                    onLiveBidsClick={() => handleStatusFilter("liveBids")}
                    onBidOverdueClick={() => handleStatusFilter("bidOverdue")}
                    onRefloatLiveBidsClick={() =>
                      handleStatusFilter(getStatusSummaryDashboardFilter("Refloat bidding", "Live"))
                    }
                    onRefloatInProcessBidsClick={() =>
                      handleStatusFilter(getStatusSummaryDashboardFilter("Refloat bidding", "In process"))
                    }
                    onRefloatBidOverdueClick={() =>
                      handleStatusFilter(getStatusSummaryDashboardFilter("Refloat bidding", "Opening overdue"))
                    }
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
                    onPaymentDueClick={() => handleStatusFilter("paymentDueOnly")}
                    onPaymentInProcessClick={() => handleStatusFilter("paymentInProcess")}
                    onPaymentSubmittedClick={() => handleStatusFilter("paymentSubmitted")}
                    onBillsReturnedClick={() => handleStatusFilter("billReturn:any")}
                    onReturnedBillsPendingClick={() => handleStatusFilter("billReturn:pending")}
                    onReturnedBillsResubmittedClick={() =>
                      handleStatusFilter("billReturn:resubmitted")
                    }
                    onReturnedBillsPaidClick={() => handleStatusFilter("billReturn:paid")}
                    onSupplementaryPendingClick={() =>
                      handleStatusFilter("supplementaryBill:submitted")
                    }
                    onSupplementaryReturnedClick={() => handleStatusFilter("supplementaryBill:any")}
                    onSupplementaryReturnedPendingClick={() =>
                      handleStatusFilter("supplementaryBill:returned")
                    }
                    onSupplementaryResubmittedClick={() =>
                      handleStatusFilter("supplementaryBill:resubmitted")
                    }
                    onSupplementaryPaidClick={() => handleStatusFilter("supplementaryBill:paid")}
                    onReturnedSupplementaryPaidClick={() =>
                      handleStatusFilter("supplementaryBill:returnPaid")
                    }
                  />
                  {milestone.key === "payment" ? (
                    <SupplementaryBillFlowNode
                      key="supplementaryBill"
                      milestone={milestone}
                      index={index + 1}
                      isLast={false}
                      onSupplementaryPendingClick={() =>
                        handleStatusFilter("supplementaryBill:submitted")
                      }
                      onSupplementaryReturnedClick={() =>
                        handleStatusFilter("supplementaryBill:any")
                      }
                      onSupplementaryReturnedPendingClick={() =>
                        handleStatusFilter("supplementaryBill:returned")
                      }
                      onSupplementaryResubmittedClick={() =>
                        handleStatusFilter("supplementaryBill:resubmitted")
                      }
                      onSupplementaryPaidClick={() => handleStatusFilter("supplementaryBill:paid")}
                      onReturnedSupplementaryPaidClick={() =>
                        handleStatusFilter("supplementaryBill:returnPaid")
                      }
                      onSupplementaryPaymentPendingClick={() =>
                        handleStatusFilter("supplementaryBill:pending")
                      }
                    />
                  ) : null}
                </Fragment>
                );
              })}
              <StatusFlowNode
                index={statusDisplayNodeCount}
                title="Miscellaneous"
                isLast
                items={[
                  {
                    label: "Live files",
                    count: miscellaneousCounts.liveFiles,
                    onClick: () => handleStatusFilter("miscLiveFiles"),
                    help: [
                      "Includes non-closed files under the selected Dashboard filters.",
                      "Cancelled demand files are excluded from the active base.",
                    ],
                  },
                  {
                    label: "File closed",
                    count: miscellaneousCounts.fileClosed,
                    onClick: () => handleStatusFilter("miscFileClosed"),
                    help: [
                      "Includes files marked as File Closed.",
                      "Cancelled demand files are excluded.",
                      "Cancelled S.O. does not by itself remove a file from this count.",
                    ],
                  },
                  {
                    label: "LD",
                    count: miscellaneousCounts.ld,
                    onClick: () => handleStatusFilter("miscLd"),
                    help: [
                      "Includes files/S.O. records where LD is applicable or recorded.",
                      "Cancelled demand files are excluded.",
                      "File Closed follows the selected Global Filter.",
                    ],
                  },
                  {
                    label: "Demand cancelled",
                    count: miscellaneousCounts.demandCancelled,
                    onClick: () => handleStatusFilter("miscDemandCancelled"),
                    help: [
                      "Shows only files specifically marked Demand Cancelled.",
                      "These files are excluded from other Status counters and clickers.",
                    ],
                  },
                  {
                    label: "S.O. cancelled",
                    count: miscellaneousCounts.soCancelled,
                    onClick: () => handleStatusFilter("miscSoCancelled"),
                    help: [
                      "Includes files/S.O. rows where S.O. Cancelled is recorded.",
                      "Cancelled demand files are excluded.",
                      "File Closed follows the selected Global Filter.",
                    ],
                  },
                  {
                    label: "Shortclosed S.O.",
                    count: miscellaneousCounts.shortclosedSo,
                    onClick: () => handleStatusFilter("miscShortclosedSo"),
                    help: [
                      "Includes files/S.O. rows where Shortclosed S.O. is recorded.",
                      "Cancelled demand files are excluded.",
                      "File Closed follows the selected Global Filter.",
                    ],
                  },
                  {
                    label: "Files with Multiple S.O.",
                    count: miscellaneousCounts.multipleSupplyOrders,
                    onClick: () => handleStatusFilter("miscMultipleSupplyOrders"),
                    help: [
                      "Counts files that have more than one S.O.; it is file based, not S.O.-row based.",
                      "A single file with three S.O.s counts as 1.",
                      "Cancelled demand files are excluded.",
                    ],
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
          exportDescription={dashboardExportDescription}
        />
      ) : null}

      {activeDashboardTab === "status3" ? (
        <DashboardStatusSummarySection
          milestones={statusDisplayFlow}
          miscellaneousCounts={miscellaneousCounts}
          loading={dashboardSummaryLoading}
          error={dashboardSummaryError}
          exportDescription={dashboardExportDescription}
          onOpenStatus={(milestone, stage) =>
            openSearchFilter(getStatusSummaryDashboardFilter(milestone, stage))
          }
        />
      ) : null}

      {activeDashboardTab === "status4" ? (
        <Status4Section
          files={status4Files}
          milestones={manualMilestoneFlow}
          visibleMilestoneNames={visibleLiveMilestoneNames}
          valueThresholdLevels={effectiveValueThresholdLevels}
          drill={status4Drill}
          sortKey={status4SortKey}
          sortDirection={status4SortDirection}
          loading={status4FilesLoading}
          error={status4FilesError}
          onDrillChange={(nextDrill) => {
            setStatus4Drill(nextDrill);
            setStatus4SortKey("label");
            setStatus4SortDirection("asc");
          }}
          onSortChange={(nextSortKey) => {
            if (nextSortKey === status4SortKey) {
              setStatus4SortDirection((current) => (current === "asc" ? "desc" : "asc"));
            } else {
              setStatus4SortKey(nextSortKey);
              setStatus4SortDirection(nextSortKey === "label" ? "asc" : "desc");
            }
          }}
          onCountClick={openStatus4Filter}
          exportDescription={dashboardExportDescription}
        />
      ) : null}

      {activeDashboardTab === "analytics" ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-bold">Analytics</h2>
          </div>
          <SectionRuleToolbar title="Global rules" items={dashboardSectionRuleHelpers.analytics} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
              <div className="space-y-1">
                {analyticsPanels.map((panel) => {
                  const selected = selectedAnalyticsPanel.key === panel.key;
                  return (
                    <div key={panel.key} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => selectAnalyticsPanel(panel.key)}
                        className={
                          "min-w-0 flex-1 rounded-md px-3 py-2 text-left text-sm font-medium transition " +
                          (selected
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground")
                        }
                      >
                        {panel.title}
                      </button>
                      {panel.helper ? (
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                aria-label={`${panel.title} note`}
                                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
                              >
                                <Info className="size-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="right"
                              align="start"
                              className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
                            >
                              <HelperWithExamples
                                items={panel.helper}
                                examples={panel.helperExamples}
                              />
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </aside>
            <div className="min-w-0">
              <AnalyticsChartCard
                title={
                  displayedAnalyticsPanel.key === "firmAnalysis" &&
                  firmAnalysisView === "coParticipants"
                    ? "Co-bidding Firms"
                    : displayedAnalyticsPanel.title
                }
                subtitle={
                  displayedAnalyticsPanel.key === "firmAnalysis" &&
                  firmAnalysisView === "coParticipants"
                    ? "Select a firm to see the other firms that co-bid with it."
                    : displayedAnalyticsPanel.subtitle
                }
                helper={
                  displayedAnalyticsPanel.key === "firmAnalysis" &&
                  firmAnalysisView === "coParticipants"
                    ? [
                        "Choose a main firm to list firms that bid in the same tender files.",
                        "Count is the number of distinct files shared by the firm pair. A refloat cycle in the same file does not add another count.",
                        "A cancelled S.O. does not by itself exclude the file from co-bidding results.",
                        "Co-bidding results use the same filtered file set as the rest of Analytics.",
                      ]
                    : displayedAnalyticsPanel.helper
                }
                helperExamples={
                  displayedAnalyticsPanel.key === "firmAnalysis" &&
                  firmAnalysisView === "coParticipants"
                    ? undefined
                    : displayedAnalyticsPanel.helperExamples
                }
                actions={
                  <>
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
                    {selectedAnalyticsPanel.key === "indentorsByValue" ? (
                      <IndentorValueSortControl
                        value={indentorsByValueSortKey}
                        onChange={(value) => {
                          setIndentorsByValueSortKey(value);
                          setIndentorsByValuePage(1);
                        }}
                      />
                    ) : null}
                    {displayedAnalyticsPanel.key === "milestoneClearingTable" ? (
                      <>
                        <MilestoneClearingFilterControls
                          valueThreshold={milestoneClearingValueThreshold}
                          mode={milestoneClearingMode}
                          valueThresholdLevels={effectiveValueThresholdLevels}
                          modes={milestoneClearingModeOptions}
                          onValueThresholdChange={setMilestoneClearingValueThreshold}
                          onModeChange={setMilestoneClearingMode}
                        />
                        <MilestoneClearingViewModeControl
                          value={milestoneClearingViewMode}
                          onChange={setMilestoneClearingViewMode}
                        />
                      </>
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
                    {!(displayedAnalyticsPanel.key === "firmAnalysis" && firmAnalysisView === "coParticipants") ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            printAnalyticsPanelToPdf(
                              getAnalyticsExportPanel(displayedAnalyticsPanel, {
                            topFirmRows: topFirmRankedRows,
                            indentorsByFilesRows: topIndentorsByFilesRankedRows,
                            indentorsByValueRows: topIndentorsByValueRankedRows,
                            preBidRows: selectedPreBidFiscalYear
                              ? displayedPreBidRows
                              : analyticsPreBidRows.map((row) => ({ ...row, name: row.monthKey })),
                            selectedPreBidFiscalYear,
                            tcecMeetingRows: selectedTcecMeetingRows,
                            selectedTcecFiscalYear,
                            selectedTcecCommittee: activeTcecCommittee,
                            cncRows: selectedCncFiscalYear
                              ? displayedCncRows
                              : analytics.cncSummary,
                            selectedCncFiscalYear,
                            tcecStage: tcecStatusStage,
                              }),
                              dashboardExportDescription,
                            )
                          }
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent"
                        >
                          Export PDF
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            exportAnalyticsPanelToExcel(
                              getAnalyticsExportPanel(displayedAnalyticsPanel, {
                            topFirmRows: topFirmRankedRows,
                            indentorsByFilesRows: topIndentorsByFilesRankedRows,
                            indentorsByValueRows: topIndentorsByValueRankedRows,
                            preBidRows: selectedPreBidFiscalYear
                              ? displayedPreBidRows
                              : analyticsPreBidRows.map((row) => ({ ...row, name: row.monthKey })),
                            selectedPreBidFiscalYear,
                            tcecMeetingRows: selectedTcecMeetingRows,
                            selectedTcecFiscalYear,
                            selectedTcecCommittee: activeTcecCommittee,
                            cncRows: selectedCncFiscalYear
                              ? displayedCncRows
                              : analytics.cncSummary,
                            selectedCncFiscalYear,
                            tcecStage: tcecStatusStage,
                              }),
                              dashboardExportDescription,
                            )
                          }
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent"
                        >
                          Export Excel
                        </button>
                      </>
                    ) : null}
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
                    <label
                      className={filterLabelClass(
                        analyticsDelayDays !== "5",
                        "flex w-32 flex-col gap-1 text-xs text-muted-foreground",
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        Days
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                aria-label="Delay status days help"
                                className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                              >
                                <Info className="size-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              align="start"
                              className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
                            >
                              <HelperBulletList items="Default is 5 days. Use reset to restore the default threshold." />
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="0"
                          value={analyticsDelayDays}
                          onChange={(event) => setAnalyticsDelayDays(event.target.value)}
                          className={filterControlClass(
                            analyticsDelayDays !== "5",
                            "h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40",
                          )}
                        />
                        <button
                          type="button"
                          onClick={() => setAnalyticsDelayDays("5")}
                          className="btn-ghost h-8 w-8 p-0"
                          title="Reset days"
                          aria-label="Reset days"
                        >
                          <RotateCcw className="size-3.5" />
                        </button>
                      </span>
                    </label>
                    <label
                      className={filterLabelClass(
                        analyticsDelayMilestoneKey !== "all",
                        "flex min-w-44 flex-col gap-1 text-xs text-muted-foreground",
                      )}
                    >
                      <span>Milestone</span>
                      <select
                        value={analyticsDelayMilestoneKey}
                        onChange={(event) => setAnalyticsDelayMilestoneKey(event.target.value)}
                        className={filterControlClass(
                          analyticsDelayMilestoneKey !== "all",
                          "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40",
                        )}
                      >
                        <option value="all">All milestones</option>
                        {effectiveDelayMilestoneOptions.map((milestone) => (
                          <option key={milestone.key} value={milestone.key}>
                            {milestone.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
                {displayedAnalyticsPanel.key === "firmAnalysis" ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2 border-b border-border" role="tablist" aria-label="Firm Analysis views">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={firmAnalysisView === "existing"}
                        onClick={() => setFirmAnalysisView("existing")}
                        className={`border-b-2 px-3 py-2 text-sm font-medium ${firmAnalysisView === "existing" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                      >
                        Firm Analysis
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={firmAnalysisView === "coParticipants"}
                        onClick={() => setFirmAnalysisView("coParticipants")}
                        className={`border-b-2 px-3 py-2 text-sm font-medium ${firmAnalysisView === "coParticipants" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                      >
                        Co-bidding Firms
                      </button>
                    </div>
                    {firmAnalysisView === "existing" ? (
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
                    ) : (
                      <CoParticipantControls
                        firms={firmAnalysisRows
                          .filter((row) => row.participated > 0)
                          .map((row) => String(row.name))}
                        selectedFirm={coParticipantFirm}
                        coBiddingFirms={coBiddingFirms}
                        coBiddingTenders={coBiddingTenders}
                        selectedPartnerName={
                          coBiddingFirms.find((firm) => firm.key === selectedCoParticipantFirm)?.name ?? ""
                        }
                        loading={coBiddingLoading}
                        onOpenAll={() => openCoBiddingSearch(coBiddingTenders)}
                        onExport={(format) => {
                          const partnerName = coBiddingFirms.find((firm) => firm.key === selectedCoParticipantFirm)?.name;
                          void downloadBackendExport({
                            format,
                            title: "Co-bidding Firms",
                            subtitle: coParticipantFirm
                              ? `Selected firm: ${coParticipantFirm}${partnerName ? `; Co-bidding firm: ${partnerName}` : ""}`
                              : undefined,
                            description: `Each shared file is counted once per firm pair. Cancelled S.O.s do not exclude an otherwise matching file.\n${dashboardExportDescription}`,
                            fileName: "co-bidding-firms",
                            tables: [
                              {
                                title: "Co-bidding firms",
                                headers: [
                                  "Unique Number",
                                  "Name",
                                  "City",
                                  "Bids Submitted",
                                  "S.O. Received",
                                  "Total S.O. Value",
                                  "Count",
                                ],
                                rows: coBiddingFirms.map((firm) => [
                                  firm.uniqueNumber,
                                  firm.name,
                                  firm.city,
                                  firm.tendersParticipated,
                                  firm.soCount,
                                  firm.soValue,
                                  firm.count,
                                ]),
                              },
                              ...(coBiddingTenders.length ? [{
                                title: "Shared tender details",
                                headers: ["Unique Code", "Control No.", "Item Description", "Indentor", "S.O. Year", "S.O. Firm"],
                                rows: coBiddingTenders.map((tender) => [
                                  tender.uniqueCode,
                                  tender.controlNo,
                                  tender.itemDescription,
                                  tender.indentor,
                                  tender.soYear,
                                  tender.soFirm,
                                ]),
                              }] : []),
                            ],
                          });
                        }}
                        onFirmChange={(firm) => {
                          setCoParticipantFirm(firm);
                          setSelectedCoParticipantFirm("");
                        }}
                      />
                    )}
                  </div>
                ) : null}
                {displayedAnalyticsPanel.key === "fileValueThresholds" ? (
                  <>
                    <DashboardBreadcrumb
                      items={[
                        { label: "Analytics" },
                        {
                          label: "Count and Value analysis",
                          onClick:
                            countValueAnalysisMode === "demandValue"
                              ? undefined
                              : () => setCountValueAnalysisMode("demandValue"),
                        },
                        {
                          label:
                            countValueAnalysisOptions.find(
                              (option) => option.key === countValueAnalysisMode,
                            )?.label ?? "Demand Value",
                        },
                      ]}
                    />
                    <CountValueAnalysisControls
                      mode={countValueAnalysisMode}
                      onModeChange={setCountValueAnalysisMode}
                    />
                  </>
                ) : null}
                {displayedAnalyticsPanel.key === "tcecStatus" ? (
                  <>
                    <DashboardBreadcrumb
                      items={[
                        { label: "Analytics" },
                        {
                          label: selectedTcecFiscalYear ? "Years" : "TCEC summary",
                          onClick: selectedTcecFiscalYear
                            ? () => {
                                setSelectedTcecFiscalYear("");
                                setSelectedTcecCommittee("");
                              }
                            : undefined,
                        },
                        selectedTcecFiscalYear
                          ? {
                              label: selectedTcecFiscalYear,
                              onClick: activeTcecCommittee
                                ? () => setSelectedTcecCommittee("")
                                : undefined,
                            }
                          : undefined,
                        activeTcecCommittee ? { label: activeTcecCommittee } : undefined,
                      ].filter(Boolean)}
                    />
                    <TcecStatusControls
                      stage={tcecStatusStage}
                      selectedCommittee={activeTcecCommittee}
                      onStageChange={(stage) => {
                        setTcecStatusStage(stage);
                        setSelectedTcecFiscalYear("");
                        setSelectedTcecCommittee("");
                      }}
                    />
                  </>
                ) : null}
                {displayedAnalyticsPanel.key === "preBidMeetings" ? (
                  <DashboardBreadcrumb
                    items={[
                      { label: "Analytics" },
                      {
                        label: selectedPreBidFiscalYear ? "Years" : "Pre-Bid Meetings",
                        onClick: selectedPreBidFiscalYear
                          ? () => setSelectedPreBidFiscalYear("")
                          : undefined,
                      },
                      selectedPreBidFiscalYear ? { label: selectedPreBidFiscalYear } : undefined,
                    ].filter(Boolean)}
                  />
                ) : null}
                {displayedAnalyticsPanel.key === "cncSummary" ? (
                  <DashboardBreadcrumb
                    items={[
                      { label: "Analytics" },
                      {
                        label: selectedCncFiscalYear ? "Years" : "CNC summary",
                        onClick: selectedCncFiscalYear
                          ? () => setSelectedCncFiscalYear("")
                          : undefined,
                      },
                      selectedCncFiscalYear ? { label: selectedCncFiscalYear } : undefined,
                    ].filter(Boolean)}
                  />
                ) : null}
                {displayedAnalyticsPanel.key === "milestoneClearingTable" ? (
                  <DashboardBreadcrumb
                    items={[
                      { label: "Analytics" },
                      { label: "Milestone clearing ranking" },
                      {
                        label:
                          milestoneClearingViewMode === "chronological"
                            ? "Chronological"
                            : "Ranking",
                      },
                    ]}
                  />
                ) : null}
                {displayedAnalyticsPanel.key === "suspectedAnomaly" ? (
                  <DashboardBreadcrumb
                    items={[{ label: "Analytics" }, { label: "Monitoring / Exceptions" }]}
                  />
                ) : null}
                {displayedAnalyticsPanel.key === "firmAnalysis" && firmAnalysisView === "coParticipants" ? null :
                  displayedAnalyticsPanel.key === "suspectedAnomaly" ? (
                  <SuspectedAnomalyGroupedView
                    rows={suspectedAnomalyRows}
                    acceptances={anomalyAcceptances}
                    isAdmin={hasAnomalyAdminAccess(activeUser?.role)}
                    onRequest={(row) => void acceptSuspectedAnomaly(row)}
                    onAdminReview={(signature, action) =>
                      void reviewSuspectedAnomaly(signature, action)
                    }
                    onClearSelected={(signatures) =>
                      void clearSelectedSuspectedAnomalies(signatures)
                    }
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
                    getColumnTotalSearchTarget={getAnalyticsColumnTotalSearchTarget}
                    onOpenSearchTarget={openAnalyticsSearchTarget}
                  />
                )}
                {displayedAnalyticsPanel.key === "firmAnalysis" && firmAnalysisView === "coParticipants" ? (
                  <section className="mt-5 space-y-5">
                    <p className="max-w-4xl border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
                      A firm pair is counted once per file, including refloat cycles. Cancelled
                      S.O.s do not exclude an otherwise matching file. Results use the current
                      Analytics file scope.
                    </p>
                    <CoBiddingFirmTable
                      mainFirm={coParticipantFirm}
                      firms={coBiddingFirms}
                      onViewTenders={setSelectedCoParticipantFirm}
                    />
                    <CoParticipantResultsPlaceholder
                      mainFirm={coParticipantFirm}
                      coBiddingFirm={selectedCoParticipantFirm}
                      partnerName={
                        coBiddingFirms.find((firm) => firm.key === selectedCoParticipantFirm)?.name ?? ""
                      }
                      tenders={coBiddingTenders}
                      loading={coBiddingLoading}
                      error={coBiddingError}
                      onOpenTender={(tender) => openCoBiddingSearch([tender])}
                    />
                  </section>
                ) : null}
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
                      getColumnTotalSearchTarget={(column) =>
                        getTcecCommitteeTotalSearchTarget(
                          tcecStatusStage,
                          activeTcecCommittee,
                          selectedTcecFiscalYear,
                          column.key,
                        )
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

      {activeDashboardTab === "finance1" ? (
        <section>
          <TooltipProvider delayDuration={150}>
            <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)]">
              <div className="mb-5">
                <div>
                  <h2 className="text-sm font-bold">
                    FY Snapshot - {finance1Summary.fiscalYear || "Select FY"}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Select an FY to see files started in that FY, their value, payments, pending
                    liabilities, and present status. For a running FY, FY-end cards are provisional;
                    today cards remain live.
                  </p>
                </div>
              </div>
              <SectionRuleToolbar
                  title="FY Snapshot rule"
                  items={[
                    "Select an FY to review files started in that FY.",
                    "For completed FYs, FY-end cards use dates available on or before the FY-end date.",
                    "For a running FY, FY-end cards are provisional because they use the selected FY-end cutoff and the data entered so far.",
                    "Select any FY. Subfilter is locked to the same FY for this page.",
                    "Division and File Type filters still apply.",
                    "Paid values include regular, stage, supplementary, and advance payments.",
                  ]}
              />

              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="rounded-lg border border-border bg-secondary/35 p-4">
                  <FinanceSectionTitle
                    title="File Group Summary"
                    help={[
                      "This section is the selected-FY file group only.",
                      "Previous-year files are not included.",
                      "Estimated value comes from demand/file value.",
                    ]}
                  />
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    <Finance1AmountMetricCard
                      title="Files Initiated"
                      metric={finance1Summary.fileGroup}
                      unitLabel="files"
                      help="Files whose initiation/received date falls in the selected Snapshot FY."
                      onClick={finance1DrillClick("fileGroup", "File Group Summary", "Files Initiated")}
                    />
                    <Finance1CountMetricCard
                      title="Cancelled by FY-end"
                      value={finance1Summary.cancelledByFyEnd}
                      onClick={finance1DrillClick("cancelledByFyEnd", "File Group Summary", "Cancelled by FY-end")}
                    />
                    <Finance1CountMetricCard
                      title="Active at FY-end"
                      value={finance1Summary.activeAtFyEnd}
                      onClick={finance1DrillClick("activeAtFyEnd", "File Group Summary", "Active at FY-end")}
                    />
                    <Finance1CountMetricCard
                      title="Closed by FY-end"
                      value={finance1Summary.closedByFyEnd}
                      onClick={finance1DrillClick("closedByFyEnd", "File Group Summary", "Closed by FY-end")}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-secondary/35 p-4 xl:col-span-2">
                  <FinanceSectionTitle
                    title="Financial Position at FY-end"
                    help={[
                      "These values show where the selected-FY initiated files stood at FY end.",
                      "Committed uses S.O.s placed on or before FY end.",
                      "Paid by FY-end includes regular, stage, supplementary, and advance payments with payment dates on or before FY end.",
                    ]}
                  />
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <Finance1AmountMetricCard
                      title="Intended at FY-end"
                      metric={finance1Summary.intendedAtFyEnd}
                      unitLabel="files"
                      onClick={finance1DrillClick("intendedAtFyEnd", "Financial Position at FY-end", "Intended at FY-end")}
                    />
                    <Finance1AmountMetricCard
                      title="Booked at FY-end"
                      metric={finance1Summary.bookedAtFyEnd}
                      unitLabel="files"
                      onClick={finance1DrillClick("bookedAtFyEnd", "Financial Position at FY-end", "Booked at FY-end")}
                    />
                    <Finance1AmountMetricCard
                      title="Committed at FY-end"
                      metric={finance1Summary.committedAtFyEnd}
                      unitLabel="S.O.s"
                      help={shortclosedPayableHelp([
                        "Historical S.O. value committed by FY-end.",
                        "Shortclosed S.O.s remain included here because shortclosure is not cancellation.",
                      ])}
                      onClick={finance1DrillClick("committedAtFyEnd", "Financial Position at FY-end", "Committed at FY-end")}
                    />
                    <Finance1AmountMetricCard
                      title="Paid by FY-end"
                      metric={finance1Summary.paidByFyEnd}
                      unitLabel="payment rows"
                      help={`Payments made by FY-end (${finance1Summary.cutoffDate.split("-").reverse().join("-")}) for files started in this FY. Example: a payment dated on or before FY-end counts; a later payment does not.`}
                      onClick={finance1DrillClick("paidByFyEnd", "Financial Position at FY-end", "Paid by FY-end")}
                    />
                    <Finance1AmountMetricCard
                      title="Unpaid liability at FY-end"
                      metric={finance1Summary.unpaidLiabilityAtFyEnd}
                      showCount={false}
                      help={shortclosedPayableHelp([
                        `Unpaid amounts whose liability date was on or before ${finance1Summary.cutoffDate.split("-").reverse().join("-")}.`,
                        "For staged S.O.s, each stage uses its revised D.P. or D.P.; stages scheduled after FY-end are excluded.",
                        "Payments made later remain counted as unpaid at FY-end.",
                        "For shortclosed S.O.s, only real pending payable items are counted.",
                      ])}
                      onClick={finance1DrillClick("unpaidLiabilityAtFyEnd", "Financial Position at FY-end", "Unpaid liability at FY-end")}
                    />
                    <Finance1AmountMetricCard
                      title="Total paid till today (live)"
                      metric={finance1Summary.paidTillDate}
                      unitLabel="payment rows"
                      help="Payments actually made by today for files started in this FY. Example: a payment made after FY-end appears here, but not in Paid by FY-end."
                      onClick={finance1DrillClick("paidTillDate", "Financial Position at FY-end", "Total paid till today (live)")}
                    />
                    <Finance1AmountMetricCard
                      title="Balance unpaid till today (live)"
                      metric={finance1Summary.balanceUnpaidToday}
                      showCount={false}
                      help={shortclosedPayableHelp([
                        "Shows unpaid payable balance that is still open today.",
                        "For normal S.O.s, this follows placed S.O./stage/advance/payment rows as applicable and reduces as payments are recorded.",
                        "For shortclosed S.O.s, only real pending payable items are counted.",
                      ])}
                      onClick={finance1DrillClick("balanceUnpaidToday", "Financial Position at FY-end", "Balance unpaid till today (live)")}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="rounded-lg border border-border bg-secondary/35 p-4">
                  <FinanceSectionTitle
                    title="Workflow Position at FY-end"
                    help={[
                      "Counts files from the selected file group at the FY-end cutoff.",
                      "These are file counts, not amount totals.",
                    ]}
                  />
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    <Finance1CountMetricCard
                      title="Controlled by FY-end"
                      value={finance1Summary.noImmsByFyEnd}
                      onClick={finance1DrillClick("intendedAtFyEnd", "Workflow Position at FY-end", "Controlled by FY-end")}
                    />
                    <Finance1CountMetricCard
                      title="Controlled done, S.O. not placed"
                      value={finance1Summary.immsDoneSoNotPlacedByFyEnd}
                      onClick={finance1DrillClick("bookedAtFyEnd", "Workflow Position at FY-end", "Controlled done, S.O. not placed")}
                    />
                    <Finance1CountMetricCard
                      title="S.O. placed"
                      value={finance1Summary.soPlacedByFyEnd}
                      onClick={finance1DrillClick("soPlacedByFyEnd", "Workflow Position at FY-end", "S.O. placed")}
                    />
                    <Finance1CountMetricCard
                      title="Delivery/Job completed"
                      value={finance1Summary.deliveryJobDoneByFyEnd}
                      onClick={finance1DrillClick("deliveryJobDoneByFyEnd", "Workflow Position at FY-end", "Delivery/Job completed")}
                    />
                    <Finance1CountMetricCard
                      title="Bill sent for payment"
                      value={finance1Summary.billSentByFyEnd}
                      onClick={finance1DrillClick("billSentByFyEnd", "Workflow Position at FY-end", "Bill sent for payment")}
                    />
                    <Finance1CountMetricCard
                      title="Payment completed"
                      value={finance1Summary.paymentCompletedByFyEnd}
                      onClick={finance1DrillClick("paymentCompletedByFyEnd", "Workflow Position at FY-end", "Payment completed")}
                    />
                    <Finance1CountMetricCard
                      title="File closed"
                      value={finance1Summary.fileClosedByFyEnd}
                      onClick={finance1DrillClick("closedByFyEnd", "Workflow Position at FY-end", "File closed")}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-secondary/35 p-4">
                  <FinanceSectionTitle
                    title="Pending Position at FY-end"
                    help={[
                      "Pending position is only for selected-FY initiated files.",
                      "Previous FY carry-forward is deliberately not included.",
                    ]}
                  />
                  <div className="mt-3 grid grid-cols-1 gap-3">
                    <Finance1AmountMetricCard
                      title="S.O. value unpaid at FY-end"
                      metric={finance1Summary.unpaidLiabilityAtFyEnd}
                      showCount={false}
                      onClick={finance1DrillClick("unpaidLiabilityAtFyEnd", "Pending Position at FY-end", "S.O. value unpaid at FY-end")}
                    />
                    <Finance1CountMetricCard
                      title="Bills submitted but unpaid"
                      value={finance1Summary.drillFileIds?.billsSubmittedButUnpaid?.length ?? 0}
                      onClick={finance1DrillClick("billsSubmittedButUnpaid", "Pending Position at FY-end", "Bills submitted but unpaid")}
                    />
                    <Finance1CountMetricCard
                      title="Payment due but bill not submitted"
                      value={finance1Summary.drillFileIds?.paymentDueButBillNotSubmitted?.length ?? 0}
                      onClick={finance1DrillClick("paymentDueButBillNotSubmitted", "Pending Position at FY-end", "Payment due but bill not submitted")}
                    />
                    <Finance1CountMetricCard
                      title="Advance pending at FY-end"
                      value={finance1Summary.advancePendingByFyEnd}
                      onClick={finance1DrillClick("advancePendingByFyEnd", "Pending Position at FY-end", "Advance pending at FY-end")}
                    />
                    <Finance1CountMetricCard
                      title="Delivery/Job pending"
                      value={finance1Summary.drillFileIds?.deliveryJobPendingByFyEnd?.length ?? 0}
                      onClick={finance1DrillClick("deliveryJobPendingByFyEnd", "Pending Position at FY-end", "Delivery/Job pending")}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-secondary/35 p-4">
                  <FinanceSectionTitle
                    title="Later Movement (live)"
                    help={[
                      "Later movement tracks only the same selected-FY file group.",
                      "Paid after FY-end includes regular, stage, supplementary, and advance payments.",
                      "Today cards use current stored data and are not limited to the FY-end date.",
                    ]}
                  />
                  <div className="mt-3 grid grid-cols-1 gap-3">
                    <Finance1CountMetricCard
                      title="S.O. placed after FY-end"
                      value={finance1Summary.soPlacedLater}
                      onClick={finance1DrillClick("soPlacedLater", "Later Movement (live)", "S.O. placed after FY-end")}
                    />
                    <Finance1CountMetricCard
                      title="Payment made after FY-end"
                      value={finance1Summary.paymentMadeLater}
                      onClick={finance1DrillClick("paymentMadeLater", "Later Movement (live)", "Payment made after FY-end")}
                    />
                    <Finance1CountMetricCard
                      title="File closed after FY-end"
                      value={finance1Summary.fileClosedLater}
                      onClick={finance1DrillClick("fileClosedLater", "Later Movement (live)", "File closed after FY-end")}
                    />
                    <Finance1CountMetricCard
                      title="Active files"
                      value={finance1Summary.stillPendingToday}
                      onClick={finance1DrillClick("stillPendingToday", "Later Movement (live)", "Active files")}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-border bg-secondary/35 p-4">
                <FinanceSectionTitle
                  title="File Type Distribution at FY-end"
                  help={[
                    "Includes only files initiated in the selected FY; files initiated in earlier FYs are not included.",
                    "Counts each included file once if it had at least one S.O. still valid at FY-end. Multiple S.O.s or delivery stages on one file still count as one file.",
                    "Status columns are evaluated as on the FY-end cutoff date.",
                    "Value is the file demand/estimated value of that selected FY file group.",
                  ]}
                />
                <div className="mt-3 overflow-x-auto rounded-md border border-border bg-card">
                  <table className="w-full min-w-[760px] border-collapse text-xs">
                    <thead className="bg-secondary text-muted-foreground">
                      <tr>
                        <th className="border-b border-border px-3 py-2 text-left font-semibold">
                          File Type
                        </th>
                        <th className="border-b border-border px-3 py-2 text-right font-semibold">
                          Files
                        </th>
                        <th className="border-b border-border px-3 py-2 text-right font-semibold">
                          Files with S.O.
                        </th>
                        <th className="border-b border-border px-3 py-2 text-right font-semibold">
                          Active at FY-end
                        </th>
                        <th className="border-b border-border px-3 py-2 text-right font-semibold">
                          Closed by FY-end
                        </th>
                        <th className="border-b border-border px-3 py-2 text-right font-semibold">
                          Cancelled by FY-end
                        </th>
                        <th className="border-b border-border px-3 py-2 text-right font-semibold">
                          Value Share
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {finance1Summary.fileTypeDistribution.length ? (
                        finance1Summary.fileTypeDistribution.map((row) => (
                          <tr key={row.fileType} className="border-t border-border">
                            <td className="px-3 py-2 font-medium">
                              <Finance1DrillCell onClick={finance1DrillClick(`fileType:${row.fileType.toLowerCase()}:files`, "File Type Distribution at FY-end", row.fileType)}>
                                {row.fileType}
                              </Finance1DrillCell>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <Finance1DrillCell onClick={finance1DrillClick(`fileType:${row.fileType.toLowerCase()}:files`, "File Type Distribution at FY-end", `${row.fileType}: Files`)}>
                                {row.files}
                              </Finance1DrillCell>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <Finance1DrillCell onClick={finance1DrillClick(`fileType:${row.fileType.toLowerCase()}:withSo`, "File Type Distribution at FY-end", `${row.fileType}: Files with S.O.`)}>
                                {row.filesWithSo}
                              </Finance1DrillCell>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <Finance1DrillCell onClick={finance1DrillClick(`fileType:${row.fileType.toLowerCase()}:active`, "File Type Distribution at FY-end", `${row.fileType}: Active at FY-end`)}>
                                {row.activeAtFyEnd}
                              </Finance1DrillCell>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <Finance1DrillCell onClick={finance1DrillClick(`fileType:${row.fileType.toLowerCase()}:closed`, "File Type Distribution at FY-end", `${row.fileType}: Closed by FY-end`)}>
                                {row.closedByFyEnd}
                              </Finance1DrillCell>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <Finance1DrillCell onClick={finance1DrillClick(`fileType:${row.fileType.toLowerCase()}:cancelled`, "File Type Distribution at FY-end", `${row.fileType}: Cancelled by FY-end`)}>
                                {row.cancelledByFyEnd}
                              </Finance1DrillCell>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <Finance1DrillCell onClick={finance1DrillClick(`fileType:${row.fileType.toLowerCase()}:files`, "File Type Distribution at FY-end", `${row.fileType}: Value Share`)}>
                                {formatPercent(
                                  finance1Summary.fileGroup.total
                                    ? (row.total / finance1Summary.fileGroup.total) * 100
                                    : 0,
                                )}
                              </Finance1DrillCell>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="px-3 py-3 text-muted-foreground" colSpan={7}>
                            No file type distribution available for the selected FY.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-border bg-secondary/35 p-4">
                <FinanceSectionTitle
                  title="Firm Type Distribution at FY-end"
                  help={[
                    "Frozen distribution of non-cancelled S.O.s placed by FY-end for files initiated in the selected FY.",
                    "S.O.s counts actual Supply Order records; delivery stages are not counted as separate S.O.s.",
                    "Grouped by firm type recorded in S.O. details.",
                    "Value is S.O. value placed by FY-end; S.O.s cancelled by FY-end are excluded.",
                  ]}
                />
                <div className="mt-3 overflow-x-auto rounded-md border border-border bg-card">
                  <table className="w-full min-w-[640px] border-collapse text-xs">
                    <thead className="bg-secondary text-muted-foreground">
                      <tr>
                        <th className="border-b border-border px-3 py-2 text-left font-semibold">
                          Firm Type
                        </th>
                        <th className="border-b border-border px-3 py-2 text-right font-semibold">
                          S.O.s
                        </th>
                        <th className="border-b border-border px-3 py-2 text-right font-semibold">
                          Capital
                        </th>
                        <th className="border-b border-border px-3 py-2 text-right font-semibold">
                          Revenue
                        </th>
                        <th className="border-b border-border px-3 py-2 text-right font-semibold">
                          Total S.O. Value
                        </th>
                        <th className="border-b border-border px-3 py-2 text-right font-semibold">
                          Share
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {finance1Summary.firmTypeDistribution.length ? (
                        finance1Summary.firmTypeDistribution.map((row) => (
                          <tr key={row.firmType} className="border-t border-border">
                            <td className="px-3 py-2 font-medium">
                              <Finance1DrillCell onClick={finance1DrillClick(`firmType:${row.firmType.toLowerCase()}`, "Firm Type Distribution at FY-end", row.firmType)}>
                                {row.firmType}
                              </Finance1DrillCell>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <Finance1DrillCell onClick={finance1DrillClick(`firmType:${row.firmType.toLowerCase()}`, "Firm Type Distribution at FY-end", `${row.firmType}: S.O.s`)}>
                                {row.supplyOrders}
                              </Finance1DrillCell>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <Finance1DrillCell onClick={finance1DrillClick(`firmType:${row.firmType.toLowerCase()}`, "Firm Type Distribution at FY-end", `${row.firmType}: Capital`)}>
                                {formatCurrency(row.capital)}
                              </Finance1DrillCell>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <Finance1DrillCell onClick={finance1DrillClick(`firmType:${row.firmType.toLowerCase()}`, "Firm Type Distribution at FY-end", `${row.firmType}: Revenue`)}>
                                {formatCurrency(row.revenue)}
                              </Finance1DrillCell>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">
                              <Finance1DrillCell onClick={finance1DrillClick(`firmType:${row.firmType.toLowerCase()}`, "Firm Type Distribution at FY-end", `${row.firmType}: Total S.O. Value`)}>
                                {formatCurrency(row.total)}
                              </Finance1DrillCell>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <Finance1DrillCell onClick={finance1DrillClick(`firmType:${row.firmType.toLowerCase()}`, "Firm Type Distribution at FY-end", `${row.firmType}: Share`)}>
                                {formatPercent(
                                  finance1Summary.committedAtFyEnd.total
                                    ? (row.total / finance1Summary.committedAtFyEnd.total) * 100
                                    : 0,
                                )}
                              </Finance1DrillCell>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="px-3 py-3 text-muted-foreground" colSpan={6}>
                            No firm type distribution available for S.O.s placed by FY-end.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </TooltipProvider>
        </section>
      ) : null}

      {activeDashboardTab === "finance" ? (
        <section>
          <TooltipProvider delayDuration={150}>
            <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-sm font-bold">Finance</h2>
                  <p className="text-xs text-muted-foreground">
                    Live/current finance values plus selected-FY activity and liability views
                  </p>
                </div>
                {!isFinanceCombinationBlocked ? (
                  <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    title="Export Finance PDF"
                    aria-label="Export Finance PDF"
                    onClick={() =>
                      printFinanceRowsToPdf(
                        financeExportRows,
                        financeExportTitle,
                        financeFirmTypeDistributionExportRows,
                        selectedFinanceFirmTypeDistributionLabel,
                        dashboardExportDescription,
                      )
                    }
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent"
                  >
                    <FileText className="size-3.5" />
                    PDF
                  </button>
                  <button
                    type="button"
                    title="Export Finance Excel"
                    aria-label="Export Finance Excel"
                    onClick={() =>
                      exportFinanceRowsToExcel(
                        financeExportRows,
                        financeExportTitle,
                        financeFirmTypeDistributionExportRows,
                        selectedFinanceFirmTypeDistributionLabel,
                        dashboardExportDescription,
                      )
                    }
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent"
                  >
                    <FileSpreadsheet className="size-3.5" />
                    Excel
                  </button>
                  </div>
                ) : null}
              </div>
              {isFinanceCombinationBlocked ? (
                <div className="rounded-lg border border-dashed border-border bg-secondary/35 p-5">
                  <h3 className="text-sm font-bold text-foreground">
                    {financeCombinationBlockedReason.title}
                  </h3>
                  <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                    {financeCombinationBlockedReason.description}
                  </p>
                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Useful Finance combinations
                    </div>
                    <div className="mt-2 grid gap-3 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-3">
                      {financeUsefulCombinations.map((combination) => (
                        <div
                          key={combination.title}
                          className="rounded-md border border-border bg-card px-3 py-2.5"
                        >
                          <div className="font-semibold text-foreground">
                            {combination.title}
                          </div>
                          <div className="mt-1 font-medium text-foreground/80">
                            {combination.filters}
                          </div>
                          <div className="mt-1">{combination.use}</div>
                          <ul className="mt-2 space-y-1">
                            {combination.helper.map((item) => (
                              <li key={item} className="flex gap-1.5">
                                <span aria-hidden="true">-</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <>
              <SectionRuleToolbar
                title={
                  isSameGlobalAndSubfilterFinanceFy
                    ? "Same-FY rules"
                    : isAllFilesSpecificFileYearFinanceView
                      ? "Initiation-year rules"
                      : isSpecificGlobalEarlierFileYearFinanceView
                        ? "Continuation rules"
                        : isSpecificGlobalAllFileYearsFinanceView
                          ? "FY movement rules"
                          : isActivePlusCurrentFyClosedFinanceView
                            ? "Current workload rules"
                            : isAllActiveFilesAllYearsFinanceView
                              ? "Active workload rules"
                              : isAllActiveFilesSpecificFileYearFinanceView
                                ? "Active initiation-year rules"
                                : "Global rules"
                }
                items={financeHelperText.rules}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-lg border border-border bg-secondary/35 p-4">
                  <FinanceSectionTitle
                    title="Allocated"
                    basis={financeAllocationBasisLabel}
                    help={financeHelperText.allocated}
                  />
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FinanceAmountTile
                      label="Capital"
                      value={financeTotals.allocatedCapital}
                      help={[
                        "Capital allocation entered in division/year setup for the selected financial year.",
                        "This is budget setup data, not file/S.O. transaction data.",
                        "Future file activity does not update this value unless allocation setup is edited.",
                      ]}
                    />
                    <FinanceAmountTile
                      label="Revenue"
                      value={financeTotals.allocatedRevenue}
                      help={[
                        "Revenue allocation entered in division/year setup for the selected financial year.",
                        "This is budget setup data, not file/S.O. transaction data.",
                        "Future file activity does not update this value unless allocation setup is edited.",
                      ]}
                    />
                  </div>
                </div>
                {shouldShowFinanceLivePositionCards ? (
                <div className="rounded-lg border border-border bg-secondary/35 p-4">
                  <FinanceSectionTitle
                    title="Intended"
                    basis={financeLiveValueBasisLabel}
                    help={financeHelperText.intended}
                  />
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FinanceAmountTile
                      label="Capital"
                      value={financeTotals.projectedCapital}
                      percentLabel={`${formatPercent(capitalProjectedPercent)} of allocation`}
                      help={[
                        "Capital intended amount from files not booked through Controlled yet.",
                        "Capital intended percent equals Capital intended amount divided by Capital allocation.",
                        "Current/live value; it can change when later workflow fields are entered or corrected.",
                        "Shortclosed S.O. files remain included.",
                      ]}
                    />
                    <FinanceAmountTile
                      label="Revenue"
                      value={financeTotals.projectedRevenue}
                      percentLabel={`${formatPercent(revenueProjectedPercent)} of allocation`}
                      help={[
                        "Revenue intended amount from files not booked through Controlled yet.",
                        "Revenue intended percent equals Revenue intended amount divided by Revenue allocation.",
                        "Current/live value; it can change when later workflow fields are entered or corrected.",
                        "Shortclosed S.O. files remain included.",
                      ]}
                    />
                  </div>
                </div>
                ) : null}
                {shouldShowFinanceLivePositionCards ? (
                <div className="rounded-lg border border-border bg-secondary/35 p-4">
                  <FinanceSectionTitle
                    title="Booked"
                    basis={financeLiveValueBasisLabel}
                    help={financeHelperText.booked}
                  />
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FinanceAmountTile
                      label="Capital"
                      value={financeTotals.bookedCapital}
                      percentLabel={`${formatPercent(capitalBookedPercent)} of allocation`}
                      help={[
                        "Capital booking from Controlled/file value before committed S.O. value is available.",
                        "Capital booked percent equals Capital booked amount divided by Capital allocation.",
                        "Current/live value; future S.O. entry or value correction can update it.",
                        "Shortclosed S.O. files remain included.",
                      ]}
                    />
                    <FinanceAmountTile
                      label="Revenue"
                      value={financeTotals.bookedRevenue}
                      percentLabel={`${formatPercent(revenueBookedPercent)} of allocation`}
                      help={[
                        "Revenue booking from Controlled/file value before committed S.O. value is available.",
                        "Revenue booked percent equals Revenue booked amount divided by Revenue allocation.",
                        "Current/live value; future S.O. entry or value correction can update it.",
                        "Shortclosed S.O. files remain included.",
                      ]}
                    />
                  </div>
                </div>
                ) : null}
                {shouldShowFinanceLivePositionCards ? (
                <div className="rounded-lg border border-border bg-secondary/35 p-4">
                  <FinanceSectionTitle
                    title="Committed"
                    basis={financeLiveValueBasisLabel}
                    help={shortclosedPayableHelp(financeHelperText.committed)}
                  />
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FinanceAmountTile
                      label="Capital"
                      value={financeTotals.spentCapital}
                      percentLabel={`${formatPercent(capitalSpentPercent)} of allocation`}
                      help={[
                        "Capital value committed through effective supply orders.",
                        "Capital committed percent equals Capital S.O. value divided by Capital allocation.",
                        "Current/live value; not a frozen selected-FY snapshot.",
                        "Shortclosed S.O. rows remain included.",
                      ]}
                    />
                    <FinanceAmountTile
                      label="Revenue"
                      value={financeTotals.spentRevenue}
                      percentLabel={`${formatPercent(revenueSpentPercent)} of allocation`}
                      help={[
                        "Revenue value committed through effective supply orders.",
                        "Revenue committed percent equals Revenue S.O. value divided by Revenue allocation.",
                        "Current/live value; not a frozen selected-FY snapshot.",
                        "Shortclosed S.O. rows remain included.",
                      ]}
                    />
                  </div>
                </div>
                ) : null}
                {shouldShowFinanceLivePositionCards ? (
                <div className="rounded-lg border border-border bg-secondary/35 p-4">
                  <FinanceSectionTitle
                    title="Paid Till Date"
                    basis={financeLiveValueBasisLabel}
                    help={shortclosedPayableHelp(financeHelperText.paidTillDate)}
                  />
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FinanceAmountTile
                      label="Capital"
                      value={financePaidTillDate.capital}
                      percentLabel={`${formatPercent(financePaidTillDateCapitalPercent)} of allocation`}
                      help={[
                        `Capital paid till date against ${financeLiveValueBasisLabel.replace(/^Basis: /, "")}.`,
                        "Capital paid till date percent equals Capital paid till date divided by Capital allocation.",
                        "Includes Capital final/stage/supplementary payments and Capital advance payments.",
                        "Not restricted to the selected payment FY.",
                      ]}
                    />
                    <FinanceAmountTile
                      label="Revenue"
                      value={financePaidTillDate.revenue}
                      percentLabel={`${formatPercent(financePaidTillDateRevenuePercent)} of allocation`}
                      help={[
                        `Revenue paid till date against ${financeLiveValueBasisLabel.replace(/^Basis: /, "")}.`,
                        "Revenue paid till date percent equals Revenue paid till date divided by Revenue allocation.",
                        "Includes Revenue final/stage/supplementary payments and Revenue advance payments.",
                        "Not restricted to the selected payment FY.",
                      ]}
                    />
                  </div>
                </div>
                ) : null}
                {!isCumulativeFinancePositionView ? (
                  <div className="rounded-lg border border-border bg-secondary/35 p-4">
                    <FinanceSectionTitle
                      title={`Payment in ${selectedFinanceYearLabel}`}
                      basis={financePaymentInYearBasisLabel}
                      help={shortclosedPayableHelp(financeHelperText.paymentInYear)}
                    />
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FinanceAmountTile
                        label="Capital"
                        value={financePaymentInYearCapital}
                        percentLabel={`${formatPercent(financePaymentInYearCapitalPercent)} of allocation`}
                        help={[
                          `Capital payment total where payment/advance payment date falls in ${selectedFinanceYearLabel}.`,
                          "Capital payment-in-FY percent equals Capital payment-in-FY divided by Capital allocation.",
                          "Includes Capital final/stage/supplementary payments and Capital advance payments.",
                          activeFileYear === "all"
                            ? "All visible initiation years are eligible."
                            : `Only files initiated in FY ${activeFileYear} are eligible.`,
                          "Uses payment date, not file initiation date.",
                          "Shortclosed S.O. rows remain included.",
                        ]}
                      />
                      <FinanceAmountTile
                        label="Revenue"
                        value={financePaymentInYearRevenue}
                        percentLabel={`${formatPercent(financePaymentInYearRevenuePercent)} of allocation`}
                        help={[
                          `Revenue payment total where payment/advance payment date falls in ${selectedFinanceYearLabel}.`,
                          "Revenue payment-in-FY percent equals Revenue payment-in-FY divided by Revenue allocation.",
                          "Includes Revenue final/stage/supplementary payments and Revenue advance payments.",
                          activeFileYear === "all"
                            ? "All visible initiation years are eligible."
                            : `Only files initiated in FY ${activeFileYear} are eligible.`,
                          "Uses payment date, not file initiation date.",
                          "Shortclosed S.O. rows remain included.",
                        ]}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              {!isCumulativeFinancePositionView ? (
                <div className="mt-4 rounded-lg border border-border bg-secondary/35 p-4">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
                    {shouldShowPreviousCarryForwardPanels ? (
                    <>
                      <FinanceCarryForwardPanel
                        title={`Carry Forward from previous FYs`}
                        basis={financePreviousCarryBasisLabel}
                        total={financeTotals.previousCarryForward}
                        rows={financeTotals.previousCarryForwardBreakup}
                        hideRowYear={shouldHideCarryForwardRowYear}
                        emptyText={`No older unpaid carry-forward as on ${selectedFinanceYearLabel} end.`}
                        help={financeHelperText.previousCarryForward}
                        details={paymentPendingLogicDetails}
                        examples={{
                          title: "Example",
                          items: financeCarryForwardExamples.previous,
                        }}
                        onOpenFilter={openSearchFilter}
                      />
                      <FinanceCarryForwardPanel
                        title={`Cleared Carry Forward in ${selectedFinanceYearLabel}`}
                        basis={financeClearedCarryBasisLabel}
                        total={financeTotals.clearedCarryForward}
                        rows={financeTotals.clearedCarryForwardBreakup}
                        hideRowYear={shouldHideCarryForwardRowYear}
                        emptyText={`No previous-year carry-forward cleared in ${selectedFinanceYearLabel}.`}
                        help={financeHelperText.clearedCarryForward}
                        details={paymentPendingLogicDetails}
                        examples={{
                          title: "Example",
                          items: financeCarryForwardExamples.cleared,
                        }}
                        onOpenFilter={openSearchFilter}
                      />
                    </>
                    ) : null}
                    <FinanceCarryForwardPanel
                      title={`Carry Forward of ${selectedFinanceYearLabel}`}
                      basis={financeCarryForwardBasisLabel}
                      total={financeTotals.carryForward}
                      rows={financeTotals.carryForwardBreakup}
                      emptyText={`No ${selectedFinanceYearLabel} payment rows carried forward.`}
                      help={financeHelperText.carryForward}
                      details={paymentPendingLogicDetails}
                      examples={{
                        title: "Example",
                        items: financeCarryForwardExamples.carryForward,
                      }}
                      onOpenFilter={openSearchFilter}
                    />
                    <FinanceCarryForwardPanel
                      title={`${selectedFinanceYearLabel} Carry Forward cleared later`}
                      basis={financeFutureClearedCarryBasisLabel}
                      total={financeTotals.futureClearedCarryForward}
                      rows={financeTotals.futureClearedCarryForwardBreakup}
                      emptyText={`No ${selectedFinanceYearLabel} carry-forward cleared in later FYs.`}
                      help={financeHelperText.futureClearedCarryForward}
                      details={paymentPendingLogicDetails}
                      examples={{
                        title: "Example",
                        items: financeCarryForwardExamples.futureCleared,
                      }}
                      onOpenFilter={openSearchFilter}
                    />
                  </div>
                </div>
              ) : null}
              {shouldShowFinanceFirmTypeDistribution ? (
              <div className="mt-4 rounded-lg border border-border bg-secondary/35 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className={financeBoxTitleClass}>Firm Type Distribution</div>
                      <FloatingHelp label="Firm type distribution help">
                        {financeHelperText.firmType}
                      </FloatingHelp>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {financeFirmTypeBasisLabel}
                    </p>
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
              ) : null}
                </>
              )}
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
  splitHelp,
  compact = false,
}: {
  label: string;
  value: SummaryMetricValue;
  onClick?: () => void;
  onSubMetricClick?: (dashboardFilter: string) => void;
  titleClassName?: string;
  help?: string | readonly string[];
  splitHelp?: FinanceSplitHelp;
  compact?: boolean;
}) {
  const subMetrics = Array.isArray(value) ? value : undefined;
  const content = (
    <>
      <div className="flex items-center justify-between">
        <div className={titleClassName ?? "text-sm font-bold text-muted-foreground"}>
          {label}
        </div>
        {help ? <FloatingHelp label={`${label} help`}>{help}</FloatingHelp> : null}
      </div>
      {subMetrics ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {subMetrics.map((item, index) => {
            const subMetricKey = [
              item.searchFilter,
              item.label,
              typeof item.value === "string" || typeof item.value === "number"
                ? item.value
                : index,
              index,
            ]
              .filter((part) => part !== undefined && part !== "")
              .join(":");
            const subContent = (
              <>
                <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <span>{item.label}</span>
                  {item.help ? <InlineInfoIcon /> : null}
                </div>
                <div className="text-lg font-semibold tracking-tight">{item.value}</div>
              </>
            );
            const wrapSubMetricHelp = (element: ReactElement) =>
              item.help ? (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>{element}</TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="center"
                      className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
                    >
                      <HelperBulletList items={item.help} />
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                element
              );

            const searchFilter = item.searchFilter;
            if (searchFilter && onSubMetricClick) {
              return wrapSubMetricHelp(
                <button
                  key={subMetricKey}
                  type="button"
                  onClick={() => onSubMetricClick(searchFilter)}
                  className="rounded-md border border-border bg-card px-2 py-2 text-left hover:bg-accent"
                >
                  {subContent}
                </button>
              );
            }

            return wrapSubMetricHelp(
              <div key={subMetricKey} className="rounded-md border border-border bg-card px-2 py-2">
                {subContent}
              </div>
            );
          })}
        </div>
      ) : isFinanceSplitValue(value) ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-md border border-border bg-card px-2 py-2">
            <div className="flex items-center justify-between gap-1">
              <div className="text-xs font-medium text-muted-foreground">Capital</div>
              {splitHelp?.capital ? (
                <FloatingHelp label={`${label} capital help`}>{splitHelp.capital}</FloatingHelp>
              ) : null}
            </div>
            <div className="text-lg font-semibold tracking-tight">{value.capital}</div>
          </div>
          <div className="rounded-md border border-border bg-card px-2 py-2">
            <div className="flex items-center justify-between gap-1">
              <div className="text-xs font-medium text-muted-foreground">Revenue</div>
              {splitHelp?.revenue ? (
                <FloatingHelp label={`${label} revenue help`}>{splitHelp.revenue}</FloatingHelp>
              ) : null}
            </div>
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

function SectionRuleToolbar({
  title,
  items,
}: {
  title: string;
  items: string | readonly string[];
}) {
  return (
    <div className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-secondary/20 px-2.5 py-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </span>
      <FloatingHelp label={`${title} help`}>{items}</FloatingHelp>
    </div>
  );
}

function FloatingHelp({ label, children }: { label: string; children: ReactNode }) {
  const content =
    typeof children === "string" ||
    (Array.isArray(children) && children.every((item) => typeof item === "string")) ? (
      <HelperBulletList items={children as string | readonly string[]} />
    ) : (
      children
    );

  return (
    <TooltipProvider delayDuration={150}>
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
        <TooltipContent
          side="top"
          align="end"
          className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function FinanceSectionTitle({
  title,
  basis,
  help,
}: {
  title: string;
  basis?: string;
  help: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="text-sm font-extrabold text-foreground">{title}</div>
        {basis ? <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">{basis}</div> : null}
      </div>
      <FloatingHelp label={`${title} finance help`}>{help}</FloatingHelp>
    </div>
  );
}

function FinanceAmountTile({
  label,
  value,
  percentLabel,
  help,
}: {
  label: string;
  value: number;
  percentLabel?: string;
  help: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <FloatingHelp label={`${label} amount help`}>{help}</FloatingHelp>
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight">{formatCurrency(value)}</div>
      {percentLabel ? (
        <div className="mt-1 text-[11px] font-medium text-muted-foreground">{percentLabel}</div>
      ) : null}
    </div>
  );
}

function Finance1AmountMetricCard({
  title,
  metric,
  help,
  unitLabel = "rows",
  showCount = true,
  onClick,
}: {
  title: string;
  metric: Finance1AmountMetric;
  help?: ReactNode;
  unitLabel?: string;
  showCount?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <span>{title}</span>
            {help ? <FloatingHelp label={`${title} help`}>{help}</FloatingHelp> : null}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        aria-label={`Open files for ${title}`}
        title={onClick ? `Open files for ${title}` : undefined}
        className="mt-1 w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default enabled:cursor-pointer enabled:hover:bg-accent/40"
      >
        <div className="flex items-center justify-between gap-2">
          {showCount ? (
            <div className="text-xs text-muted-foreground">
              {metric.count}{unitLabel ? ` ${unitLabel}` : ""}
            </div>
          ) : <span />}
          <div className="flex items-center gap-1.5 text-right text-sm font-semibold">
            {formatCurrency(metric.total)}
            {onClick ? <Search aria-hidden="true" className="h-3.5 w-3.5 text-primary" /> : null}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          <div>Capital {formatCurrency(metric.capital)}</div>
          <div>Revenue {formatCurrency(metric.revenue)}</div>
        </div>
      </button>
    </div>
  );
}

function Finance1CountMetricCard({
  title,
  value,
  onClick,
}: {
  title: string;
  value: number;
  onClick?: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="text-[11px] font-semibold text-foreground">{title}</div>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        aria-label={`Open files for ${title}`}
        title={onClick ? `Open files for ${title}` : undefined}
        className="mt-1 inline-flex items-center gap-1 rounded text-left text-lg font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default enabled:cursor-pointer enabled:text-primary enabled:hover:underline"
      >
        {Math.max(0, value)}
        {onClick ? <Search aria-hidden="true" className="h-3.5 w-3.5" /> : null}
      </button>
    </div>
  );
}

function Finance1DrillCell({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={onClick ? "Open matching files" : undefined}
      className="cursor-pointer rounded px-1 py-0.5 text-primary underline decoration-dotted underline-offset-2 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:text-inherit disabled:no-underline enabled:hover:bg-accent/60 enabled:hover:decoration-solid"
    >
      {children}
    </button>
  );
}

function FinanceCarryForwardPanel({
  title,
  basis,
  total,
  rows,
  emptyText,
  help,
  examples,
  details,
  hideRowYear = false,
  onOpenFilter,
}: {
  title: string;
  basis?: string;
  total?: FinanceCarryForwardTotal;
  rows?: FinanceCarryForwardRow[];
  hideRowYear?: boolean;
  emptyText: string;
  help: string | string[];
  examples?: HelperExamples;
  details?: HelperDetails;
  onOpenFilter: (filter: string) => void;
}) {
  const safeTotal = total ?? { count: 0, capital: 0, revenue: 0, total: 0 };
  const getRowLabel = (row: FinanceCarryForwardRow) => {
    const [, mode = ""] = row.filter.split(":");
    if (mode === "previousCarryForward" || mode === "clearedCarryForward") {
      return hideRowYear ? "Previous year liability" : `FY ${row.year} liability`;
    }
    if (mode === "futureClearedCarryForward") return `Cleared in FY ${row.year}`;
    return "Activity year liability";
  };
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <div className="text-[11px] font-semibold text-foreground">{title}</div>
            <FloatingHelp label={`${title} help`}>
              <HelperWithExamples items={help} examples={examples} details={details} />
            </FloatingHelp>
          </div>
          {basis ? (
            <div className="mt-0.5 text-[10px] font-medium text-muted-foreground">{basis}</div>
          ) : null}
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
              className="flex w-full items-center rounded border border-border bg-background px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="font-medium">{getRowLabel(row)}</span>
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
  exportDescription,
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
  exportDescription?: string;
  onMilestoneToggle: (milestoneName: string) => void;
  onSelectAllMilestones: () => void;
  onClearMilestones: () => void;
  onLockMilestones: () => void;
  lockedMilestoneNames?: string[];
  onCountClick: (division: string, milestoneName: string) => void;
}) {
  const selectedMilestoneSet = new Set(visibleMilestoneNames);
  const displayedMilestones = milestones.filter((milestone) =>
    selectedMilestoneSet.has(milestone.name),
  );
  const liveTotal = rows.length
    ? rows.reduce((sum, row) => sum + row.total, 0)
    : displayedMilestones.reduce((sum, milestone) => sum + milestone.current, 0);
  const lockMatchesCurrentSelection =
    lockedMilestoneNames !== undefined &&
    lockedMilestoneNames.length === visibleMilestoneNames.length &&
    lockedMilestoneNames.every((name) => selectedMilestoneSet.has(name));

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-bold">Live status</h2>
      </div>
      <SectionRuleToolbar title="Global rules" items={dashboardSectionRuleHelpers.status2} />
      <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">Division-wise current milestones</h3>
            <p className="text-xs text-muted-foreground">
              Counts show how many files / S.O. are currently at each selected milestone.
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
                  printLiveStatusRowsToPdf(
                    rows,
                    displayedMilestones,
                    "Live status dashboard",
                    exportDescription,
                  )
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
                  exportLiveStatusRowsToExcel(
                    rows,
                    displayedMilestones,
                    "Live status dashboard",
                    exportDescription,
                  )
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
              const currentCount = getLiveStatusMilestoneDisplayCount(rows, milestone);
              const helperKey = normalizeMilestoneName(milestone.label);
              const helper =
                status2MilestoneHelpers[
                  helperKey === "dp" || helperKey === "deliveryperiodmilestone"
                    ? "deliveryperiod"
                    : helperKey
                ];
              return (
                <div key={milestone.name} className="flex items-center gap-0.5">
                  <label
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
                    <span className="max-w-[150px] truncate">
                      {getWorkflowDisplayLabel(milestone.label)}
                    </span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 tabular-nums">
                      {currentCount}
                    </span>
                  </label>
                  {helper ? (
                    <FloatingHelp label={`${getWorkflowDisplayLabel(milestone.label)} Status-2 help`}>
                      {helper}
                    </FloatingHelp>
                  ) : null}
                </div>
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
                  {displayedMilestones.map((milestone) => {
                    const helperKey = normalizeMilestoneName(milestone.label);
                    const helper =
                      status2MilestoneHelpers[
                        helperKey === "dp" || helperKey === "deliveryperiodmilestone"
                          ? "deliveryperiod"
                          : helperKey
                      ];
                    const label = getWorkflowDisplayLabel(milestone.label);
                    return (
                      <th key={milestone.name} className="px-3 py-2 text-center font-medium">
                        <span className="inline-flex max-w-full items-center justify-center gap-1.5 align-middle">
                          <span className="truncate">{label}</span>
                          {helper ? (
                            <TooltipProvider delayDuration={150}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                                    aria-label={`${label} Status-2 help`}
                                  >
                                    <Info className="size-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  align="start"
                                  className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
                                >
                                  <HelperBulletList items={helper} />
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : null}
                        </span>
                      </th>
                    );
                  })}
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
                      const count = getLiveStatusRowMilestoneCount(row, milestone);
                      return (
                        <td key={milestone.name} className="px-2 py-2 text-center">
                          {count > 0 ? (
                            <button
                              type="button"
                              onClick={() => onCountClick(row.division, milestone.name)}
                              className="h-8 min-w-12 rounded-md border border-border bg-secondary/35 px-2 font-semibold tabular-nums transition hover:bg-accent hover:ring-2 hover:ring-ring/25"
                              aria-label={`Open ${count} ${row.division} files at ${getWorkflowDisplayLabel(milestone.label)}`}
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

function getLiveStatusRowMilestoneCount(
  row: LiveStatusDivisionRow,
  milestone: LiveStatusMilestone,
) {
  const exactCount = row.counts[milestone.name];
  if (exactCount !== undefined) return exactCount;
  const normalizedMilestone = normalizeMilestoneName(milestone.name);
  const matchingEntry = Object.entries(row.counts).find(
    ([name]) => normalizeMilestoneName(name) === normalizedMilestone,
  );
  return matchingEntry ? matchingEntry[1] : 0;
}

function getLiveStatusMilestoneDisplayCount(
  rows: LiveStatusDivisionRow[],
  milestone: LiveStatusMilestone,
) {
  if (
    !rows.length ||
    !rows.some((row) =>
      Object.keys(row.counts).some(
        (name) => normalizeMilestoneName(name) === normalizeMilestoneName(milestone.name),
      ),
    )
  ) {
    return milestone.current;
  }
  return rows.reduce((sum, row) => sum + getLiveStatusRowMilestoneCount(row, milestone), 0);
}

type Status4TableRow = {
  key: string;
  label: string;
  sortValue: string | number;
  files: FileRecord[];
  total: number;
  metrics: Record<string, Status4MilestoneMetrics>;
  fiscalYear?: string;
  monthKey?: string;
  minValue?: number;
  maxValue?: number;
  onLabelClick?: () => void;
};

function Status4Section({
  files,
  milestones,
  visibleMilestoneNames,
  valueThresholdLevels,
  drill,
  sortKey,
  sortDirection,
  loading,
  error,
  exportDescription,
  onDrillChange,
  onSortChange,
  onCountClick,
}: {
  files: FileRecord[];
  milestones: LiveStatusMilestone[];
  visibleMilestoneNames: string[];
  valueThresholdLevels: ValueThresholdLevel[];
  drill: Status4DrillState;
  sortKey: Status4SortKey;
  sortDirection: AnalyticsSortDirection;
  loading: boolean;
  error?: string;
  exportDescription?: string;
  onDrillChange: (drill: Status4DrillState) => void;
  onSortChange: (sortKey: Status4SortKey) => void;
  onCountClick: (filter: Status4SearchFilter) => void;
}) {
  const selectedMilestoneSet = new Set(visibleMilestoneNames);
  const displayedMilestones = getStatus4Milestones(
    milestones.filter((milestone) => selectedMilestoneSet.has(milestone.name)),
  );
  const thresholdRanges = getStatus4ThresholdRanges(valueThresholdLevels);
  const rows = getStatus4DisplayRows({
    files,
    milestones: displayedMilestones,
    drill,
    thresholdRanges,
    sortKey,
    sortDirection,
    onDrillChange,
  });
  const tableLabel = getStatus4TableLabel(drill);
  const breadcrumbItems = getStatus4BreadcrumbItems(drill);
  const canShowTable =
    displayedMilestones.length > 0 && (!drill.fiscalYear || drill.mode !== undefined);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-bold">Status-4</h2>
      </div>
      <SectionRuleToolbar title="Global rules" items={dashboardSectionRuleHelpers.status4} />
      <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">{tableLabel}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {breadcrumbItems.map((item, index) => (
                <Fragment key={`${item.label}-${index}`}>
                  {index > 0 ? <span>/</span> : null}
                  {item.drill ? (
                    <button
                      type="button"
                      onClick={() => onDrillChange(item.drill!)}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {item.label}
                    </button>
                  ) : (
                    <span>{item.label}</span>
                  )}
                </Fragment>
              ))}
            </div>
          </div>
          <div className="flex rounded-md border border-border bg-secondary/40 p-1">
            <button
              type="button"
              onClick={() =>
                printStatus4RowsToPdf(rows, displayedMilestones, tableLabel, exportDescription)
              }
              disabled={!canShowTable || !rows.length}
              className="flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <FileText className="size-3.5" />
              PDF
            </button>
            <button
              type="button"
              onClick={() =>
                exportStatus4RowsToExcel(rows, displayedMilestones, tableLabel, exportDescription)
              }
              disabled={!canShowTable || !rows.length}
              className="flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <FileSpreadsheet className="size-3.5" />
              Excel
            </button>
          </div>
        </div>

        {loading ? (
          <div className="mb-3 rounded-md border border-border bg-secondary/25 px-3 py-2 text-sm text-muted-foreground">
            Loading Status-4 data...
          </div>
        ) : null}
        {error ? (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Status-4 data unavailable: {error}
          </div>
        ) : null}

        <Status4HelperToolbar drill={drill} />

        {drill.fiscalYear && !drill.mode ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onDrillChange({ fiscalYear: drill.fiscalYear, mode: "threshold" })}
              className="rounded-md border border-border bg-secondary/30 p-4 text-left hover:bg-accent"
            >
              <div className="text-sm font-semibold">Value Threshold</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Preset value ranges with Status-2 stage counts.
              </div>
            </button>
            <button
              type="button"
              onClick={() => onDrillChange({ fiscalYear: drill.fiscalYear, mode: "monthwise" })}
              className="rounded-md border border-border bg-secondary/30 p-4 text-left hover:bg-accent"
            >
              <div className="text-sm font-semibold">Monthwise</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Month rows first, then value range breakup for a selected month.
              </div>
            </button>
          </div>
        ) : null}

        {!displayedMilestones.length ? (
          <div className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">
            Select at least one Status-2 milestone to show Status-4 counts.
          </div>
        ) : null}

        {canShowTable ? (
          <Status4Table
            rows={rows}
            milestones={displayedMilestones}
            rowHeaderLabel={getStatus4RowHeaderLabel(drill)}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSortChange={onSortChange}
            onCountClick={onCountClick}
          />
        ) : null}
      </div>
    </section>
  );
}

function Status4Table({
  rows,
  milestones,
  rowHeaderLabel,
  sortKey,
  sortDirection,
  onSortChange,
  onCountClick,
}: {
  rows: Status4TableRow[];
  milestones: LiveStatusMilestone[];
  rowHeaderLabel: string;
  sortKey: Status4SortKey;
  sortDirection: AnalyticsSortDirection;
  onSortChange: (sortKey: Status4SortKey) => void;
  onCountClick: (filter: Status4SearchFilter) => void;
}) {
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);

  return rows.length ? (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-44" />
          <col className="w-24" />
          {milestones.map((milestone) => (
            <col key={milestone.name} className="w-32" />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-border text-xs uppercase text-muted-foreground">
            <Status4SortableHeader
              label={rowHeaderLabel}
              sortKey="label"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onSortChange={onSortChange}
              align="left"
            />
            <Status4SortableHeader
              label="Total"
              sortKey="total"
              activeSortKey={sortKey}
              sortDirection={sortDirection}
              onSortChange={onSortChange}
            />
            {milestones.map((milestone) => (
              <Status4SortableHeader
                key={milestone.name}
                label={getWorkflowDisplayLabel(milestone.label)}
                sortKey={`milestone:${milestone.name}`}
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSortChange={onSortChange}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/60 last:border-0">
              <td className="px-3 py-2 font-medium">
                {row.onLabelClick ? (
                  <button
                    type="button"
                    onClick={row.onLabelClick}
                    className="text-left text-foreground hover:text-primary hover:underline"
                  >
                    {row.label}
                  </button>
                ) : (
                  row.label
                )}
              </td>
              <td className="px-3 py-2 text-center font-semibold tabular-nums">{row.total}</td>
              {milestones.map((milestone) => {
                const metrics =
                  row.metrics[milestone.name] ??
                  ({ applicable: 0, cleared: 0, current: 0 } satisfies Status4MilestoneMetrics);
                return (
                  <td key={milestone.name} className="px-2 py-2 text-center">
                    <Status4MetricCell
                      metrics={metrics}
                      milestone={milestone.name}
                      fiscalYear={row.fiscalYear}
                      monthKey={row.monthKey}
                      minValue={row.minValue}
                      maxValue={row.maxValue}
                      onCountClick={onCountClick}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-secondary/25 font-semibold">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2 text-center tabular-nums">{grandTotal}</td>
            {milestones.length ? <td colSpan={milestones.length} className="px-2 py-2" /> : null}
          </tr>
        </tfoot>
      </table>
    </div>
  ) : (
    <div className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">
      No Status-4 data available for the selected scope.
    </div>
  );
}

function Status4SortableHeader({
  label,
  sortKey,
  activeSortKey,
  sortDirection,
  onSortChange,
  align = "center",
}: {
  label: string;
  sortKey: Status4SortKey;
  activeSortKey: Status4SortKey;
  sortDirection: AnalyticsSortDirection;
  onSortChange: (sortKey: Status4SortKey) => void;
  align?: "left" | "center";
}) {
  const active = sortKey === activeSortKey;
  return (
    <th className={`px-3 py-2 font-medium ${align === "left" ? "text-left" : "text-center"}`}>
      <button
        type="button"
        onClick={() => onSortChange(sortKey)}
        className="inline-flex max-w-full items-center gap-1 hover:text-foreground"
      >
        <span className="truncate">{label}</span>
        {active ? <span>{sortDirection === "asc" ? "A-Z" : "Z-A"}</span> : null}
      </button>
    </th>
  );
}

function Status4MetricCell({
  metrics,
  milestone,
  fiscalYear,
  monthKey,
  minValue,
  maxValue,
  onCountClick,
}: {
  metrics: Status4MilestoneMetrics;
  milestone: string;
  fiscalYear?: string;
  monthKey?: string;
  minValue?: number;
  maxValue?: number;
  onCountClick: (filter: Status4SearchFilter) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card text-xs font-semibold tabular-nums">
      {getStatus4MetricKeys().map((metric) => {
        const value = metrics[metric] ?? 0;
        const label = getStatus4MetricLabel(metric);
        return value > 0 && fiscalYear ? (
          <button
            key={metric}
            type="button"
            aria-label={`${label}: ${value}`}
            onClick={() =>
              onCountClick({ milestone, metric, fiscalYear, monthKey, minValue, maxValue })
            }
            className="flex h-7 w-full items-center justify-center border-b border-border px-2 text-center text-foreground last:border-b-0 hover:bg-accent"
            title={label}
          >
            {value}
          </button>
        ) : (
          <span
            key={metric}
            className="flex h-7 items-center justify-center border-b border-border px-2 text-center text-muted-foreground last:border-b-0"
            title={label}
          >
            {value}
          </span>
        );
      })}
    </div>
  );
}

function getStatus4MetricKeys(): Status4MetricKey[] {
  return ["applicable", "cleared", "current"];
}

function getStatus4MetricLabel(metric: Status4MetricKey) {
  if (metric === "applicable") return "Applicable";
  if (metric === "cleared") return "Cleared";
  return "Current";
}

function getStatus4BreadcrumbItems(drill: Status4DrillState) {
  const items: Array<{ label: string; drill?: Status4DrillState }> = [
    { label: "FY", drill: drill.fiscalYear ? {} : undefined },
  ];
  if (drill.fiscalYear) {
    items.push({
      label: drill.fiscalYear,
      drill: drill.mode ? { fiscalYear: drill.fiscalYear } : undefined,
    });
  }
  if (drill.mode === "threshold") items.push({ label: "Value Threshold" });
  if (drill.mode === "monthwise") {
    items.push({
      label: "Monthwise",
      drill: drill.monthKey ? { fiscalYear: drill.fiscalYear, mode: "monthwise" } : undefined,
    });
  }
  if (drill.monthKey) items.push({ label: formatMonthKeyLabel(drill.monthKey) });
  return items;
}

function getStatus4TableLabel(drill: Status4DrillState) {
  if (!drill.fiscalYear) return "FY wise current status";
  if (!drill.mode) return `${drill.fiscalYear} drill-down`;
  if (drill.mode === "threshold") return `${drill.fiscalYear} value threshold status`;
  if (drill.monthKey) return `${formatMonthKeyLabel(drill.monthKey)} value threshold status`;
  return `${drill.fiscalYear} monthwise status`;
}

function getStatus4RowHeaderLabel(drill: Status4DrillState) {
  if (!drill.fiscalYear) return "FY";
  if (drill.mode === "monthwise" && !drill.monthKey) return "Month";
  return "Value Range";
}

function Status4HelperToolbar({ drill }: { drill: Status4DrillState }) {
  const helpers = getStatus4HelperItems(drill);
  return (
    <div className="mb-4 rounded-lg border border-border bg-secondary/20 px-3 py-2">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Status-4 helper
      </div>
      <div className="flex flex-wrap gap-2">
        {helpers.map((helper) => (
          <div
            key={helper.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 text-xs"
          >
            <span className="font-medium text-foreground">{helper.label}</span>
            <FloatingHelp label={`${helper.label} help`}>{helper.items}</FloatingHelp>
          </div>
        ))}
      </div>
    </div>
  );
}

function getStatus4HelperItems(drill: Status4DrillState): Array<{
  label: string;
  items: string[];
}> {
  const common = [
    {
      label: "Total",
      items: [
        "Total is the number of Demand-Cancelled-excluded files in that row.",
        "It is file count, not number of stages or number of supply orders.",
        "Cancelled S.O. does not reduce Status-4 Total because Status-4 is up to order placement.",
      ],
    },
    {
      label: "Applicable",
      items: [
        "Files for which that milestone is relevant/applicable.",
        "Example: IFA applies only where IFA is marked Yes; TCEC stages apply only to TCEC files.",
      ],
    },
    {
      label: "Cleared",
      items: [
        "Applicable files where that milestone has already been completed/cleared.",
        "For Supply Order, cancelled S.O. still counts as cleared/placed because placement happened before cancellation.",
        "Click a non-zero cleared count to open matching files in Search.",
      ],
    },
    {
      label: "Current",
      items: [
        "Files currently pending/live at that milestone.",
        "This is live current position, not historical delay or past stuck position.",
      ],
    },
    {
      label: "Milestone columns",
      items: [
        "Columns come from selected Status-2 milestones.",
        "Status-4 shows stages up to Supply Order and excludes later delivery/payment milestones.",
      ],
    },
  ];

  if (!drill.fiscalYear) {
    return [
      {
        label: "FY",
        items: [
          "Rows are grouped by file initiation/received financial year.",
          "Click an FY row to choose Value Threshold or Monthwise drill-down for that FY.",
        ],
      },
      ...common,
    ];
  }

  if (!drill.mode) {
    return [
      {
        label: "Value Threshold",
        items: [
          "Shows value-range rows for the selected FY.",
          "Value range uses Demand Capital + Demand Revenue for the file.",
          "Use it to see milestone progress by demand-value slab.",
        ],
      },
      {
        label: "Monthwise",
        items: [
          "Shows month rows inside the selected FY.",
          "Month is file initiation/received month, not S.O. month or delivery month.",
          "Click a month to see value-threshold breakup inside that month.",
        ],
      },
    ];
  }

  if (drill.mode === "monthwise" && !drill.monthKey) {
    return [
      {
        label: "Month",
        items: [
          "Rows are grouped by file initiation/received month within the selected FY.",
          "Click a month to drill into value-threshold rows for only that month.",
        ],
      },
      ...common,
    ];
  }

  return [
    {
      label: "Value Range",
      items: drill.monthKey
        ? [
            "Rows are value ranges for files initiated/received in the selected month.",
            "Value range uses Demand Capital + Demand Revenue for the file.",
            "Unmatched appears if a file has no matching configured value slab.",
          ]
        : [
            "Rows are value ranges for files initiated/received in the selected FY.",
            "Value range uses Demand Capital + Demand Revenue for the file.",
            "Unmatched appears if a file has no matching configured value slab.",
          ],
    },
    ...common,
  ];
}

function getStatus4DisplayRows({
  files,
  milestones,
  drill,
  thresholdRanges,
  sortKey,
  sortDirection,
  onDrillChange,
}: {
  files: FileRecord[];
  milestones: LiveStatusMilestone[];
  drill: Status4DrillState;
  thresholdRanges: Status4ThresholdRange[];
  sortKey: Status4SortKey;
  sortDirection: AnalyticsSortDirection;
  onDrillChange: (drill: Status4DrillState) => void;
}) {
  if (!drill.fiscalYear) {
    return sortStatus4Rows(
      groupStatus4RowsByKey({
        files,
        milestones,
        getKey: (file) => getFinancialYearForDate(file.receivedDate) ?? "undated",
        getLabel: (key) => (key === "undated" ? "Undated" : key),
        getSortValue: (key) =>
          key === "undated" ? Number.MAX_SAFE_INTEGER : getStatus4FySortValue(key),
        getRowMeta: (key) => ({
          fiscalYear: key,
          onLabelClick: () => onDrillChange({ fiscalYear: key }),
        }),
      }),
      sortKey,
      sortDirection,
    );
  }

  const fiscalYearFiles = files.filter(
    (file) => getStatus4FileFiscalYear(file) === drill.fiscalYear,
  );
  if (drill.mode === "monthwise" && !drill.monthKey) {
    return sortStatus4Rows(
      groupStatus4RowsByKey({
        files: fiscalYearFiles,
        milestones,
        getKey: (file) => getMonthKey(file.receivedDate) ?? "undated",
        getLabel: (key) => (key === "undated" ? "Undated" : formatMonthKeyLabel(key)),
        getSortValue: (key) => (key === "undated" ? "9999-99" : key),
        getRowMeta: (key) => ({
          fiscalYear: drill.fiscalYear,
          monthKey: key === "undated" ? undefined : key,
          onLabelClick:
            key === "undated"
              ? undefined
              : () =>
                  onDrillChange({
                    fiscalYear: drill.fiscalYear,
                    mode: "monthwise",
                    monthKey: key,
                  }),
        }),
      }),
      sortKey,
      sortDirection,
    );
  }

  const thresholdSourceFiles = drill.monthKey
    ? fiscalYearFiles.filter((file) => getMonthKey(file.receivedDate) === drill.monthKey)
    : fiscalYearFiles;
  return sortStatus4Rows(
    getStatus4ThresholdRows(
      thresholdSourceFiles,
      milestones,
      thresholdRanges,
      drill.fiscalYear,
      drill.monthKey,
    ),
    sortKey,
    sortDirection,
  );
}

type Status4ThresholdRange = {
  key: string;
  label: string;
  sortValue: number;
  minValue?: number;
  maxValue?: number;
};

function getStatus4ThresholdRanges(levels: ValueThresholdLevel[]): Status4ThresholdRange[] {
  const ranges = new Map<string, Status4ThresholdRange>();
  levels.forEach((level, index) => {
    const minValue = parseAmount(level.minValue);
    const maxValue = parseAmount(level.maxValue);
    const key = `${minValue ?? ""}:${maxValue ?? ""}`;
    if (ranges.has(key)) return;
    ranges.set(key, {
      key,
      label: formatThresholdRange(level),
      sortValue: index,
      minValue,
      maxValue,
    });
  });
  return Array.from(ranges.values());
}

function getStatus4ThresholdRows(
  files: FileRecord[],
  milestones: LiveStatusMilestone[],
  ranges: Status4ThresholdRange[],
  fiscalYear: string,
  monthKey?: string,
) {
  const rows = ranges.map((range) => {
    const rangeFiles = files.filter((file) =>
      isStatus4ValueRangeMatch(file, range.minValue, range.maxValue),
    );
    return buildStatus4TableRow({
      key: `threshold:${range.key}`,
      label: range.label,
      sortValue: range.sortValue,
      files: rangeFiles,
      milestones,
      fiscalYear,
      monthKey,
      minValue: range.minValue,
      maxValue: range.maxValue,
    });
  });
  const matchedFiles = new Set(rows.flatMap((row) => row.files.map((file) => file.id)));
  const unmatchedFiles = files.filter((file) => !matchedFiles.has(file.id));
  if (unmatchedFiles.length) {
    rows.push(
      buildStatus4TableRow({
        key: "threshold:unmatched",
        label: "Unmatched",
        sortValue: Number.MAX_SAFE_INTEGER,
        files: unmatchedFiles,
        milestones,
        fiscalYear,
        monthKey,
      }),
    );
  }
  return rows;
}

function groupStatus4RowsByKey({
  files,
  milestones,
  getKey,
  getLabel,
  getSortValue,
  getRowMeta,
}: {
  files: FileRecord[];
  milestones: LiveStatusMilestone[];
  getKey: (file: FileRecord) => string;
  getLabel: (key: string) => string;
  getSortValue: (key: string) => string | number;
  getRowMeta: (key: string) => Partial<Status4TableRow>;
}) {
  const groups = new Map<string, FileRecord[]>();
  files.forEach((file) => {
    const key = getKey(file);
    groups.set(key, [...(groups.get(key) ?? []), file]);
  });
  return Array.from(groups.entries()).map(([key, groupFiles]) =>
    buildStatus4TableRow({
      key,
      label: getLabel(key),
      sortValue: getSortValue(key),
      files: groupFiles,
      milestones,
      ...getRowMeta(key),
    }),
  );
}

function buildStatus4TableRow({
  key,
  label,
  sortValue,
  files,
  milestones,
  fiscalYear,
  monthKey,
  minValue,
  maxValue,
  onLabelClick,
}: {
  key: string;
  label: string;
  sortValue: string | number;
  files: FileRecord[];
  milestones: LiveStatusMilestone[];
  fiscalYear?: string;
  monthKey?: string;
  minValue?: number;
  maxValue?: number;
  onLabelClick?: () => void;
}): Status4TableRow {
  const metrics = Object.fromEntries(
    milestones.map((milestone) => [
      milestone.name,
      getStatus4MilestoneMetrics(files, milestone.name),
    ]),
  ) as Record<string, Status4MilestoneMetrics>;
  return {
    key,
    label,
    sortValue,
    files,
    metrics,
    total: files.length,
    fiscalYear,
    monthKey,
    minValue,
    maxValue,
    onLabelClick,
  };
}

function sortStatus4Rows(
  rows: Status4TableRow[],
  sortKey: Status4SortKey,
  sortDirection: AnalyticsSortDirection,
) {
  const direction = sortDirection === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const aValue =
      sortKey === "label"
        ? a.sortValue
        : sortKey === "total"
          ? a.total
          : (a.metrics[sortKey.slice("milestone:".length)]?.current ?? 0);
    const bValue =
      sortKey === "label"
        ? b.sortValue
        : sortKey === "total"
          ? b.total
          : (b.metrics[sortKey.slice("milestone:".length)]?.current ?? 0);
    if (typeof aValue === "number" && typeof bValue === "number") {
      return (aValue - bValue) * direction || String(a.label).localeCompare(String(b.label));
    }
    return String(aValue).localeCompare(String(bValue)) * direction;
  });
}

function getStatus4FySortValue(fiscalYear: string) {
  const match = fiscalYear.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function getStatus4Milestones(milestones: LiveStatusMilestone[]) {
  const supplyOrderIndex = milestoneDefinitions.findIndex(
    (milestone) => normalizeMilestoneName(milestone.label) === "supplyorder",
  );
  return milestones.filter((milestone) => {
    const normalized = normalizeMilestoneName(milestone.name);
    const definitionIndex = milestoneDefinitions.findIndex(
      (definition) => normalizeMilestoneName(definition.label) === normalized,
    );
    return (
      definitionIndex !== -1 &&
      (supplyOrderIndex === -1 || definitionIndex <= supplyOrderIndex) &&
      normalized !== "deliveryperiod" &&
      normalized !== "advancepayment"
    );
  });
}

function getStatus4MilestoneMetrics(
  files: FileRecord[],
  milestoneName: string,
): Status4MilestoneMetrics {
  const normalized = normalizeMilestoneName(milestoneName);
  if (normalized === "financialsanction") {
    return {
      applicable: files.length,
      cleared: files.filter(isStatus4FinancialSanctionCleared).length,
      current: files.filter(isStatus4FinancialSanctionCurrent).length,
    };
  }
  if (normalized === "supplyorder") {
    return {
      applicable: files.length,
      cleared: files.filter(isStatus4SupplyOrderCleared).length,
      current: files.filter(isStatus4SupplyOrderCurrent).length,
    };
  }
  if (normalized === "billreturnedforcorrection") {
    return {
      applicable: countBillsReturnedForCorrection(files),
      cleared: countReturnedBillsResubmitted(files),
      current: countReturnedBillsPending(files),
    };
  }
  const milestone = milestoneDefinitions.find(
    (item) => normalizeMilestoneName(item.label) === normalized,
  );
  if (!milestone) {
    return {
      applicable: files.filter((file) => !isCancelledFile(file)).length,
      cleared: getManualMilestoneCompletedCount(files, milestoneName),
      current: getLiveStatusMilestoneCount(files, milestoneName),
    };
  }
  const applicableFiles = files.filter((file) => isMilestoneApplicable(file, milestone));
  return {
    applicable: applicableFiles.length,
    cleared: applicableFiles.filter((file) => isMilestoneComplete(file, milestone)).length,
    current: getLiveStatusMilestoneCount(applicableFiles, milestoneName),
  };
}

function isStatus4FinancialSanctionCleared(file: FileRecord) {
  if (isYes(file.demandCancelled)) return false;
  return (
    normalizeCompletedMilestones(file.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === "financialsanction",
    ) || rawSupplyOrders(file).some(isFinancialSanctionCompletedOrder)
  );
}

function isStatus4SupplyOrderCleared(file: FileRecord) {
  if (isYes(file.demandCancelled)) return false;
  return (
    normalizeCompletedMilestones(file.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === "supplyorder",
    ) || rawSupplyOrders(file).some(hasSupplyOrderDate)
  );
}

function isStatus4FinancialSanctionCurrent(file: FileRecord) {
  if (isYes(file.demandCancelled) || isFileClosed(file)) return false;
  return countCurrentSupplyOrderMilestoneStatuses([file], "financialsanction") > 0;
}

function isStatus4SupplyOrderCurrent(file: FileRecord) {
  if (isYes(file.demandCancelled) || isFileClosed(file)) return false;
  return countCurrentSupplyOrderMilestoneStatuses([file], "supplyorder") > 0;
}

function isStatus4MetricKey(value: string): value is Status4MetricKey {
  return value === "applicable" || value === "cleared" || value === "current";
}

function isStatus4MetricMatch(file: FileRecord, milestoneName: string, metric: Status4MetricKey) {
  const normalized = normalizeMilestoneName(milestoneName);
  if (normalized === "financialsanction") {
    if (metric === "applicable") return true;
    if (metric === "cleared") return isStatus4FinancialSanctionCleared(file);
    return isStatus4FinancialSanctionCurrent(file);
  }
  if (normalized === "supplyorder") {
    if (metric === "applicable") return true;
    if (metric === "cleared") return isStatus4SupplyOrderCleared(file);
    return isStatus4SupplyOrderCurrent(file);
  }
  if (normalized === "billreturnedforcorrection") {
    if (metric === "applicable") return countBillsReturnedForCorrection([file]) > 0;
    if (metric === "cleared") return countReturnedBillsResubmitted([file]) > 0;
    return countReturnedBillsPending([file]) > 0;
  }
  const milestone = milestoneDefinitions.find(
    (item) => normalizeMilestoneName(item.label) === normalized,
  );
  if (!milestone) {
    if (metric === "applicable") return !isCancelledFile(file);
    if (metric === "cleared") return getManualMilestoneCompletedCount([file], milestoneName) > 0;
    return getLiveStatusMilestoneCount([file], milestoneName) > 0;
  }
  if (metric === "applicable") return isMilestoneApplicable(file, milestone);
  if (metric === "cleared")
    return isMilestoneApplicable(file, milestone) && isMilestoneComplete(file, milestone);
  return getLiveStatusMilestoneCount([file], milestoneName) > 0;
}

function getStatus4FileFiscalYear(file: FileRecord) {
  return getFinancialYearForDate(file.receivedDate) ?? "undated";
}

function isStatus4ValueRangeMatch(file: FileRecord, minValue?: number, maxValue?: number) {
  const capital = getInrAmount(file.valueCapital, file);
  const revenue = getInrAmount(file.valueRevenue, file);
  if (
    (minValue !== undefined || maxValue !== undefined) &&
    capital === undefined &&
    revenue === undefined
  ) {
    return false;
  }
  const value = (capital ?? 0) + (revenue ?? 0);
  if (minValue !== undefined && value < minValue) return false;
  if (maxValue !== undefined && value > maxValue) return false;
  return true;
}

function getStatus4DashboardFilter({
  milestone,
  metric,
  fiscalYear,
  monthKey,
  minValue,
  maxValue,
}: Status4SearchFilter) {
  return [
    "status4",
    encodeURIComponent(milestone),
    metric,
    encodeURIComponent(fiscalYear),
    encodeURIComponent(monthKey ?? "all"),
    minValue ?? "",
    maxValue ?? "",
  ].join(":");
}

function getStatus4SearchFocusTarget(milestone: string, metric: Status4MetricKey) {
  if (metric !== "cleared") return undefined;
  const normalized = normalizeMilestoneName(milestone);
  if (normalized === "financialsanction") return "financialsanction:completed";
  if (normalized === "supplyorder") return "supplyorder:placed";
  return undefined;
}

function formatStatus4ValueRangeTitle(minValue?: number, maxValue?: number) {
  const minLabel = minValue !== undefined ? formatLakhRangeAmount(minValue) : "0";
  if (maxValue !== undefined) return `${minLabel}-${formatLakhRangeAmount(maxValue)} L`;
  return `${minLabel} L+`;
}

function FileCategoryFilter({
  selectedCategories,
  options,
  active,
  onChange,
}: {
  selectedCategories: FileCategoryKey[];
  options: FileCategoryOption[];
  active: boolean;
  onChange: (category: FileCategoryKey, checked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedVisibleCount = options.filter((option) =>
    selectedCategories.includes(option.key),
  ).length;
  const summary = `${selectedVisibleCount}/${options.length} selected`;

  return (
    <div className={filterLabelClass(active, "flex flex-col gap-1 text-xs text-muted-foreground")}>
      <span>File Type</span>
      <div className={filterControlClass(active, "rounded-md border border-input bg-background")}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex min-h-9 w-full items-center justify-between gap-3 px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent/60"
        >
          <span className="truncate">{summary}</span>
          <ChevronDown
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
        {open ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-2 py-2">
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
        ) : null}
      </div>
    </div>
  );
}

function FileInitiationDateRangeFilter({
  fromDate,
  toDate,
  active,
  disabled = false,
  onFromDateChange,
  onToDateChange,
  onClear,
}: {
  fromDate: string;
  toDate: string;
  active: boolean;
  disabled?: boolean;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  onClear: () => void;
}) {
  const hasRange = Boolean(fromDate || toDate);
  return (
    <div className={filterLabelClass(active, "flex flex-col gap-1 text-xs text-muted-foreground")}>
      <span className="inline-flex items-center gap-1">
        Initiation date
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Initiation date range help"
                className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Info className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              align="start"
              className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
            >
              <HelperBulletList items={fileInitiationDateRangeHelper} />
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </span>
      <div className="flex items-center gap-1.5">
        <DateInput
          value={fromDate}
          onChange={onFromDateChange}
          disabled={disabled}
          className={filterControlClass(
            active,
            "h-9 w-[132px] rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60",
          )}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <DateInput
          value={toDate}
          onChange={onToDateChange}
          disabled={disabled}
          className={filterControlClass(
            active,
            "h-9 w-[132px] rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60",
          )}
        />
        {hasRange ? (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DashboardStatusSummarySection({
  milestones,
  miscellaneousCounts,
  loading,
  error,
  exportDescription,
  onOpenStatus,
}: {
  milestones: ReturnType<typeof combineJobCompletionAndIr>;
  miscellaneousCounts: ReturnType<typeof getMiscellaneousCounts>;
  loading: boolean;
  error?: string;
  exportDescription?: string;
  onOpenStatus: (milestone: string, stage: string) => void;
}) {
  const status3Presentation = useMemo(
    () => getStatus3Presentation(milestones, miscellaneousCounts),
    [milestones, miscellaneousCounts],
  );
  const { groups: visibleGroups, exportGroups } = status3Presentation;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-bold">Status-3</h2>
      </div>
      <SectionRuleToolbar title="Global rules" items={dashboardSectionRuleHelpers.status3} />
      <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">Status summary</h3>
            <p className="text-xs text-muted-foreground">
              Files / S.O. at each stage across all milestones.
            </p>
          </div>
          <div className="flex rounded-md border border-border bg-secondary/40 p-1">
            <button
              type="button"
              onClick={() =>
                printStatusSummaryGroupsToPdf(exportGroups, "Status-3", exportDescription)
              }
              disabled={!exportGroups.length}
              className="flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <FileText className="size-3.5" />
              PDF
            </button>
            <button
              type="button"
              onClick={() =>
                exportStatusSummaryGroupsToExcel(exportGroups, "Status-3", exportDescription)
              }
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
        ) : loading && !milestones.length ? (
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
            Loading status summary...
          </div>
        ) : (
          <div className="space-y-4">
            {visibleGroups.map((group) => (
              <Status3WorkflowSection key={group.key} group={group} onOpenStatus={onOpenStatus} />
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

function Status3WorkflowSection({
  group,
  onOpenStatus,
}: {
  group: Status3WorkflowGroup;
  onOpenStatus: (milestone: string, stage: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="border-b border-border pb-1">
        <h4 className="text-xs font-bold uppercase text-muted-foreground">{group.title}</h4>
      </div>
      <div className="space-y-3">
        {group.sections.map((section) => (
          <Status3TableSection key={section.key} group={section} onOpenStatus={onOpenStatus} />
        ))}
      </div>
    </div>
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
      <div className="border-b border-border bg-secondary/25 px-3 py-2 text-xs font-semibold text-foreground">
        {group.title}
      </div>
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
                  <td className={cellClass}>
                    <Status3MilestoneNameCell name={row.milestone} />
                  </td>
                  {group.columns.map((column) => (
                    <td key={column} className="px-3 py-2.5 text-right tabular-nums">
                      <DashboardStatusSummaryValue
                        value={row.counts[column] ?? (column === "Due" ? row.counts["In process"] : undefined)}
                        milestone={row.milestone}
                        stage={column}
                        onClick={() => {
                          const target = getStatus3OpenTarget(row.milestone, column);
                          onOpenStatus(target.milestone, target.stage);
                        }}
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

function Status3MilestoneNameCell({ name }: { name: string }) {
  const helper = getStatus3MilestoneHelper(name);
  const displayName = getWorkflowDisplayLabel(name);
  if (!helper) return displayName;
  return (
    <span className="inline-flex max-w-[16rem] items-center gap-1.5 align-middle">
      <span className="truncate">{displayName}</span>
      <FloatingHelp label={`${displayName} status logic`}>{helper}</FloatingHelp>
    </span>
  );
}

function getStatus3OpenTarget(milestone: string, stage: string) {
  const milestoneKey = normalizeMilestoneName(milestone);
  const stageKey = normalizeMilestoneName(stage);
  if (
    stageKey === "due" &&
    ["scrutiny", "highvalue", "pretcec", "ad", "rqa", "controlling", "ifa", "cfa", "posttcec", "refloatposttcec", "cnc"].includes(milestoneKey)
  ) {
    return { milestone, stage: "In process" };
  }
  if (milestoneKey === "jobcompletionir") {
    if (stageKey === "jobcompletiondue") return { milestone: "Job Completion", stage: "Due" };
    if (stageKey === "jobcompletiondone") return { milestone: "Job Completion", stage: "Done" };
    if (stageKey === "irpreparationpending")
      return { milestone: "IR Preparation", stage: "Pending" };
    if (stageKey === "irreceiptpending") return { milestone: "IR Receipt", stage: "Pending" };
    if (stageKey === "ircompleted") return { milestone: "IR Receipt", stage: "Completed" };
  }
  if (milestoneKey === "advancepayment") {
    if (stageKey === "advancepending") return { milestone, stage: "Pending" };
    if (stageKey === "advancecompleted") return { milestone, stage: "Completed" };
  }
  return { milestone, stage };
}

function getStatus3MilestoneHelper(name: string) {
  if (name === "Delivery Period") {
    return "Includes all file types after S.O. DP is entered. Valid means current/future DP, Expired means DP has passed, and Extended means revised DP is active. For IR No or contract files, completion is checked through Job Completion.";
  }
  if (name === "Delivery") {
    return "Physical delivery/inspection only. Includes Goods & Services where IR is Yes. Excludes Goods & Services with IR No and contract files such as AMC, MPC, CARS, CAPSI, and O&M.";
  }
  if (name === "Job Completion") {
    return "Non-delivery inspection workflow. Includes Goods & Services where IR is No and contract files such as AMC, MPC, CARS, CAPSI, and O&M. Due starts after the DP has passed and job completion is still blank.";
  }
  return undefined;
}

function testIdSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getStatus3Presentation(
  milestones: ReturnType<typeof combineJobCompletionAndIr>,
  miscellaneousCounts: ReturnType<typeof getMiscellaneousCounts>,
) {
  const entries = milestones as unknown as Array<Record<string, unknown>>;
  const byKey = new Map(entries.map((entry) => [String(entry.key ?? ""), entry]));
  const metric = (entry: Record<string, unknown> | undefined, key: string) =>
    typeof entry?.[key] === "number" ? (entry[key] as number) : undefined;
  const label = (entry: Record<string, unknown> | undefined, fallback: string) =>
    typeof entry?.label === "string" ? entry.label : fallback;
  const makeRow = (milestone: string, counts: StatusSummaryTableRow["counts"]) => ({
    milestone,
    counts,
  });
  const flowRow = (
    key: string,
    columns: Array<[string, string]>,
    rowLabel?: string,
  ) => {
    const entry = byKey.get(key);
    if (!entry) return undefined;
    return makeRow(
      rowLabel ?? label(entry, key),
      Object.fromEntries(columns.map(([column, field]) => [column, metric(entry, field)])),
    );
  };
  const section = (
    title: string,
    columns: string[],
    rows: Array<StatusSummaryTableRow | undefined>,
  ): StatusSummaryTableGroup | undefined => {
    const presentRows = rows.filter((row): row is StatusSummaryTableRow => Boolean(row));
    return presentRows.length
      ? { key: `${testIdSlug(title)}-${presentRows.map((row) => testIdSlug(row.milestone)).join("-")}`, title, columns, rows: presentRows }
      : undefined;
  };
  const approvalColumns = ["Total", "Completed", "Due", "Reviewed", "Pending"];
  const approvalRows = [
    "scrutiny",
    "highValue",
    "tcec",
    "ad",
    "rqa",
    "control",
    "cfa",
  ].flatMap((key) => {
    const entry = byKey.get(key);
    if (!entry) return [];
    return [
      makeRow(label(entry, key), {
        Total: metric(entry, "total"),
        Completed: metric(entry, "cleared"),
        Due: metric(entry, "active"),
        Reviewed: metric(entry, "reviewed"),
        Pending: metric(entry, "pending"),
      }),
    ];
  });
  const ifa = byKey.get("ifa");
  const dueColumns = ["Total", "Completed", "At previous stage", "Due", "Reviewed", "Pending"];
  const workflowGroups = [
    buildStatus3WorkflowGroup("up-to-cfa", "Up to CFA", [
      section("Approval movement", approvalColumns, approvalRows),
      section("Approval movement", dueColumns, [
        ifa
          ? makeRow(label(ifa, "IFA"), {
              Total: metric(ifa, "total"),
              Completed: metric(ifa, "cleared"),
              "At previous stage": metric(ifa, "underProcess"),
              Due: metric(ifa, "active"),
              Reviewed: metric(ifa, "reviewed"),
              Pending: metric(ifa, "pending"),
            })
          : undefined,
      ]),
    ]),
    buildStatus3WorkflowGroup("cfa-to-so", "CFA to S.O.", [
      section("Tender movement", [
        "Live",
        "In process",
        "Opening overdue",
        "Completed",
        "At previous stages",
      ], [flowRow("bidding", [
        ["Live", "liveBids"],
        ["In process", "inProcessBids"],
        ["Opening overdue", "overdueBids"],
        ["Completed", "cleared"],
        ["At previous stages", "underProcess"],
      ], "Bidding")]),
      section("Pre-Bid Meeting", [
        "Due",
        "Completed",
        "Refloat Due",
        "Refloat Completed",
      ], [makeRow("Pre-Bid Meeting", {
        Due: byKey.get("preBidMeeting") ? metric(byKey.get("preBidMeeting"), "preBidDue") : undefined,
        Completed: byKey.get("preBidMeeting") ? metric(byKey.get("preBidMeeting"), "preBidCompleted") : undefined,
        "Refloat Due": byKey.get("preBidMeeting") ? metric(byKey.get("preBidMeeting"), "refloatPreBidDue") : undefined,
        "Refloat Completed": byKey.get("preBidMeeting") ? metric(byKey.get("preBidMeeting"), "refloatPreBidCompleted") : undefined,
      })]),
      section("Committee / Refloat", dueColumns, [
        flowRow("postTcec", [["Total", "total"], ["Completed", "cleared"], ["At previous stage", "underProcess"], ["Due", "active"], ["Reviewed", "reviewed"], ["Pending", "pending"]]),
      ]),
      section("Refloat bidding", [
        "Live",
        "In process",
        "Opening overdue",
        "Completed",
      ], [flowRow("refloatBidding", [["Live", "liveBids"], ["In process", "inProcessBids"], ["Opening overdue", "overdueBids"], ["Completed", "cleared"]], "Refloat bidding")]),
      section("Committee / Refloat", dueColumns, [
        flowRow("refloatPostTcec", [["Total", "total"], ["Completed", "cleared"], ["At previous stage", "underProcess"], ["Due", "active"], ["Reviewed", "reviewed"], ["Pending", "pending"]]),
        flowRow("cnc", [["Total", "total"], ["Completed", "cleared"], ["At previous stage", "underProcess"], ["Due", "active"], ["Reviewed", "reviewed"], ["Pending", "pending"]]),
      ]),
      section("Financial Sanction", ["Completed", "Pending", "At previous stage"], [
        flowRow("financialSanction", [["Completed", "financialSanctionCompleted"], ["Pending", "financialSanctionPending"], ["At previous stage", "underProcess"]]),
      ]),
      section("Supply Order", ["Placed", "Live", "Pending", "At Previous Stage"], [
        flowRow("supplyOrder", [["Placed", "cleared"], ["Live", "liveSupplyOrders"], ["Pending", "pending"], ["At Previous Stage", "underProcess"]]),
      ]),
    ]),
    buildStatus3WorkflowGroup("so-till-payment", "S.O. till payment", [
      section("Delivery Period / Milestone", [
        "Valid",
        "Expired",
        "Extended",
      ], [flowRow("deliveryPeriod", [["Valid", "valid"], ["Expired", "expired"], ["Extended", "extended"]], "Delivery Period / Milestone")]),
      section("Security / Warranty BG", [
        "Received",
        "Pending",
        "Expired",
        "To be returned",
        "Returned",
      ], ["psb", "pwb", "psbPwb"].map((key) => flowRow(key, [["Received", "cleared"], ["Pending", "pending"], ["Expired", "bgExpired"], ["To be returned", "bgToBeReturned"], ["Returned", "bgReturned"]]))),
      section("Delivery", ["Completed", "Pending", "Overdue"], [
        flowRow("delivery", [["Completed", "completed"], ["Pending", "due"], ["Overdue", "overdue"]]),
      ]),
      section("Job Completion / IR", [
        "Job Completion Due",
        "Job Completion Done",
        "IR Preparation Pending",
        "IR Receipt Pending",
        "IR Completed",
      ], [flowRow("jobCompletionIr", [["Job Completion Due", "jobLive"], ["Job Completion Done", "jobCompleted"], ["IR Preparation Pending", "irPreparationPending"], ["IR Receipt Pending", "irReceiptPending"], ["IR Completed", "irCompleted"]], "Job Completion / IR")]),
      section("Bill movement", ["Completed", "Pending"], [
        flowRow("billPreparation", [["Completed", "cleared"], ["Pending", "pending"]], "Bill preparation"),
        flowRow("billSentForPayment", [["Completed", "cleared"], ["Pending", "pending"]], "Bill sent for payment"),
      ]),
      section("Payment", [
        "Due",
        "In process",
        "Submitted and unpaid",
        "Completed",
      ], [flowRow("payment", [["Due", "paymentDue"], ["In process", "paymentInProcess"], ["Submitted and unpaid", "paymentSubmitted"], ["Completed", "cleared"]], "Payment")]),
      section("Advance Payment", [
        "Advance Pending",
        "Advance Completed",
      ], [flowRow("payment", [["Advance Pending", "advancePending"], ["Advance Completed", "advancePaid"]], "Advance Payment")]),
      section("Returned Bills", [
        "Bills returned",
        "Return pending",
        "Resubmitted",
        "Returned paid",
      ], [flowRow("payment", [["Bills returned", "billsReturnedForCorrection"], ["Return pending", "returnedBillsPending"], ["Resubmitted", "returnedBillsResubmitted"], ["Returned paid", "returnedBillsPaid"]], "Returned Bills")]),
      section("Supplementary Bill", [
        "Submitted total",
        "Returned total",
        "Return pending",
        "Resubmitted total",
        "Returned paid",
        "Normal paid",
        "Pending",
      ], [flowRow("payment", [["Submitted total", "supplementarySubmitted"], ["Returned total", "supplementaryReturnedForCorrection"], ["Return pending", "supplementaryReturnedPending"], ["Resubmitted total", "supplementaryReturnedResubmitted"], ["Returned paid", "supplementaryReturnedPaid"], ["Normal paid", "supplementaryNormalPaid"], ["Pending", "supplementaryPending"]], "Supplementary Bill")]),
    ]),
    buildStatus3WorkflowGroup("miscellaneous", "Miscellaneous", [
      section("Miscellaneous", ["Live files", "File closed", "LD", "Demand cancelled", "S.O. cancelled", "Shortclosed S.O.", "Files with Multiple S.O."], [
        makeRow("Miscellaneous", {
          "Live files": miscellaneousCounts.liveFiles,
          "File closed": miscellaneousCounts.fileClosed,
          LD: miscellaneousCounts.ld,
          "Demand cancelled": miscellaneousCounts.demandCancelled,
          "S.O. cancelled": miscellaneousCounts.soCancelled,
          "Shortclosed S.O.": miscellaneousCounts.shortclosedSo,
          "Files with Multiple S.O.": miscellaneousCounts.multipleSupplyOrders,
        }),
      ]),
    ]),
  ].filter((group) => group.sections.length);

  return {
    groups: workflowGroups,
    exportGroups: workflowGroups.flatMap((group) => group.sections),
  };
}

function buildStatus3WorkflowGroup(
  key: string,
  title: string,
  sections: Array<StatusSummaryTableGroup | undefined>,
): Status3WorkflowGroup {
  return {
    key,
    title,
    sections: sections.filter((section): section is StatusSummaryTableGroup =>
      Boolean(section?.rows.length),
    ),
  };
}

type LiveStatusDivisionRow = {
  division: string;
  total: number;
  counts: Record<string, number>;
};
type LiveStatusMilestone = { name: string; label: string; current: number; completed: number };

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
  if (normalized === "bankguarantee") return countAllBgPendingOrders(files);
  if (isBgMilestoneKey(normalized)) return countBgPendingOrders(files, normalized);
  if (normalized === "supplementarybillreturnedforcorrection") {
    return countSupplementaryBillReturnedOrders(files);
  }
  if (normalized === "refloatbidding") {
    return files.filter((file) => !isCancelledFile(file) && isRefloatBiddingInProgressFile(file))
      .length;
  }
  if (normalized === "refloatposttcec") {
    return files.filter(
      (file) =>
        !isCancelledFile(file) &&
        isYes(file.refloat) &&
        isYes(file.tcec) &&
        isYes(file.biddingStageOver) &&
        !hasFilledField(file, "refloatPostTcecMinutesDate"),
    ).length;
  }
  if (normalized === "bidding") {
    return files.filter(
      (file) =>
        !isCancelledFile(file) &&
        isBiddingApplicableForFile(file) &&
        !isYes(file.refloat) &&
        hasFilledString(file.cfaDate) &&
        !isYes(file.biddingStageOver),
    ).length;
  }
  if (isSupplyOrderDrivenMilestoneName(milestoneName)) {
    return countCurrentSupplyOrderMilestoneStatuses(files, normalized);
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
    (isBiddingApplicableForFile(file)
      ? isYes(file.biddingStageOver)
      : hasFilledString(file.cfaDate)) &&
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
  return getCanonicalSupplyOrderCurrentMilestone(file, order);
}

function isOrderCurrentForMilestone(
  file: FileRecord,
  order: SupplyOrderDetail,
  normalizedMilestone: string,
) {
  return isCanonicalSupplyOrderMilestoneCurrent(file, order, normalizedMilestone);
}

function supplyOrderMilestoneRows(file: FileRecord, normalizedMilestone: string) {
  if (normalizedMilestone === "financialsanction") return expectedSupplyOrders(file);
  if (normalizedMilestone === "supplyorder" || isBgMilestoneKey(normalizedMilestone)) {
    return expectedSupplyOrders(file);
  }
  if (isPaymentMilestone(normalizedMilestone)) {
    return normalizedFilePaymentOrders(file);
  }
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
  const normalized = normalizeMilestoneName(milestone);
  if (isYes(file.demandCancelled)) return false;
  if (!isPaymentMilestone(normalized) && isCancelledFile(file)) return false;
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
      isOrderActiveForCurrentMilestone(file, order, normalized) &&
      isOrderCurrentForMilestone(file, order, normalized),
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
  const normalized = normalizeMilestoneName(milestone);
  if (isYes(file.demandCancelled)) return false;
  if (!isPaymentMilestone(normalized) && isCancelledFile(file)) return false;
  if (normalized === "supplyorder") return hasPlacedSupplyOrder(file);
  if (normalized === "advancepayment") {
    return advancePaymentEntries([file]).some(
      ({ file: entryFile, order }) =>
        isAdvancePaymentCompleted(order) && isPaymentOrderActive(entryFile, order),
    );
  }
  if (normalized === "billsentforpayment") return hasCompletedBillSentForPaymentOrder(file);
  if (normalized === "billreturnedforcorrection") return hasResolvedBillReturnOrder(file);
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
      isOrderActiveForMilestone(file, order, normalized) &&
      (normalized === "financialsanction"
        ? hasFilledString(order.financialSanctionDate) ||
          order.completedMilestones?.some((item) => normalizeMilestoneName(item) === normalized)
        : isDateCompletedPaymentMilestoneOrder(order, normalized)
          ? true
          : normalized === "billsentforpayment"
            ? !hasOpenBillReturn(order) &&
              (hasFilledString(order.billSentForPaymentDate) ||
                order.completedMilestones?.some(
                  (item) => normalizeMilestoneName(item) === normalized,
                ))
            : normalized === "billreturnedforcorrection"
              ? hasCompletedBillReturn(order)
              : order.completedMilestones?.some(
                  (item) => normalizeMilestoneName(item) === normalized,
                )),
  );
}

function isDateCompletedPaymentMilestoneOrder(
  order: SupplyOrderDetail,
  normalizedMilestone: string,
) {
  if (normalizedMilestone === "irpreparation") return hasFilledString(order.irPreparationDate);
  if (normalizedMilestone === "irreceipt") return hasFilledString(order.irReceiptDate);
  if (normalizedMilestone === "billpreparation") return hasFilledString(order.billPreparationDate);
  if (normalizedMilestone === "billsentforpayment") {
    return !hasOpenBillReturn(order) && hasFilledString(order.billSentForPaymentDate);
  }
  return false;
}

function hasCompletedBillSentForPaymentOrder(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some(
    (order) =>
      isPaymentOrderActive(file, order) &&
      !hasOpenBillReturn(order) &&
      (hasFilledString(order.billSentForPaymentDate) ||
        order.completedMilestones?.some(
          (item) => normalizeMilestoneName(item) === "billsentforpayment",
        )),
  );
}

function hasResolvedBillReturnOrder(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some(
    (order) => isPaymentOrderActive(file, order) && hasCompletedBillReturn(order),
  );
}

function countCurrentSupplyOrderMilestoneStatuses(
  files: FileRecord[],
  normalizedMilestone: string,
) {
  if (isBgMilestoneKey(normalizedMilestone))
    return countBgPendingOrders(files, normalizedMilestone);
  return files.reduce((total, file) => {
    if (isYes(file.demandCancelled)) return total;
    if (!isPaymentMilestone(normalizedMilestone) && isCancelledFile(file)) return total;
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
          isOrderActiveForCurrentMilestone(file, order, normalizedMilestone) &&
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
    if (isYes(file.demandCancelled)) return total;
    if (!isPaymentMilestone(normalizedMilestone) && isCancelledFile(file)) return total;
    if (normalizedMilestone === "advancepayment") {
      return (
        total +
        advancePaymentEntries([file]).filter(
          ({ file: entryFile, order }) =>
            isAdvancePaymentCompleted(order) && isPaymentOrderActive(entryFile, order),
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
    if (normalizedMilestone === "billreturnedforcorrection") {
      return (
        total +
        normalizedFilePaymentOrders(file).filter(
          (order) => isPaymentOrderActive(file, order) && hasCompletedBillReturn(order),
        ).length
      );
    }
    return (
      total +
      supplyOrderMilestoneRows(file, normalizedMilestone).filter(
        (order) =>
          isOrderActiveForMilestone(file, order, normalizedMilestone) &&
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
  const metrics: StatusMetric[] = [
    {
      label: "Currently running",
      count: milestone.current,
      onClick: onCurrentClick,
      statusKind: "live",
      help: [
        `Includes files currently pending at ${milestone.name}.`,
        "Cancelled demand files are excluded.",
        "File Closed follows the selected Global Filter.",
      ],
    },
    {
      label: "Delivery Completed",
      count: milestone.completed,
      onClick: onCompletedClick,
      statusKind: "history",
      help: [
        `Includes files where ${milestone.name} completion is recorded.`,
        "Cancelled demand files are excluded.",
        "File Closed follows the selected Global Filter.",
      ],
    },
  ];

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
            {metrics.map((metric) => (
              <StatusMetricBox
                key={metric.label}
                metric={{
                  ...metric,
                  toneCount: metric.label === "Currently running",
                }}
                tone={tone}
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

function StatusFlowNode({
  index,
  title,
  items,
  isLast,
}: {
  index: number;
  title: string;
  items: Array<{ label: string; count: number; onClick?: () => void; help?: string | string[] }>;
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
          <span
            className={`grid gap-1.5 ${
              items.length === 1
                ? "grid-cols-1"
                : items.length === 4
                  ? "grid-cols-2"
                  : "grid-cols-3"
            }`}
          >
            {items.map((item) => (
              <StatusSubBox
                key={item.label}
                label={item.label}
                count={item.count}
                onClick={item.onClick}
                help={item.help}
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
  help,
}: {
  label: string;
  count: number;
  onClick?: () => void;
  help?: string | string[];
}) {
  const tone = getMilestoneTone(count);
  const content = (
    <>
      <span className="flex items-center justify-center gap-1 text-[9px] font-medium uppercase leading-tight text-muted-foreground">
        <span>{label}</span>
        {help ? <InlineInfoIcon /> : null}
      </span>
      <span className="block text-base font-semibold tabular-nums">{count}</span>
    </>
  );
  const wrapWithTooltip = (element: ReactElement) =>
    help ? (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>{element}</TooltipTrigger>
          <TooltipContent
            side="top"
            align="center"
            className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
          >
            <HelperBulletList items={help} />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : (
      element
    );

  if (!onClick) {
    return wrapWithTooltip(
      <div className="rounded-md border border-border bg-card px-2 py-1 text-center">{content}</div>
    );
  }

  return wrapWithTooltip(
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
  testId?: string;
  toneCount?: boolean;
  statusKind?: "live" | "history";
  help?: string | string[];
};

function getStatusMetricTooltip(metric: StatusMetric) {
  if (metric.help) return metric.help;
  if (metric.statusKind === "live") {
    return [
      "Includes files currently pending/live for this counter.",
      "Cancelled demand files are excluded.",
      "File Closed follows the selected Global Filter.",
    ];
  }
  if (metric.statusKind === "history") {
    return [
      "Includes files where this activity is already completed/recorded.",
      "Cancelled demand files are excluded.",
      "File Closed follows the selected Global Filter.",
    ];
  }
  return undefined;
}

function InlineInfoIcon() {
  return (
    <span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
      <Info className="size-2.5" />
    </span>
  );
}

function StatusMetricBox({
  metric,
  tone,
}: {
  metric: StatusMetric;
  tone: ReturnType<typeof getMilestoneTone>;
}) {
  const content = (
    <>
      <span className="flex items-center justify-center gap-1 text-[9px] font-medium uppercase leading-tight text-muted-foreground">
        <span>{metric.label}</span>
        {getStatusMetricTooltip(metric) ? <InlineInfoIcon /> : null}
      </span>
      <span className="block text-base font-semibold tabular-nums">{metric.count}</span>
    </>
  );
  const className =
    "min-h-12 rounded-md border px-2 py-1.5 text-center transition hover:ring-2 hover:ring-ring/30 " +
    (metric.toneCount ? tone.activeCount : "border-border bg-card hover:bg-accent");

  const tooltip = getStatusMetricTooltip(metric);
  const wrapWithTooltip = (element: ReactElement) =>
    tooltip ? (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>{element}</TooltipTrigger>
          <TooltipContent
            side="top"
            align="center"
            className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
          >
            {Array.isArray(tooltip) ? <HelperBulletList items={tooltip} /> : tooltip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : (
      element
    );

  if (!metric.onClick) {
    return wrapWithTooltip(
      <div className={className.replace(" hover:ring-2 hover:ring-ring/30", "")}>{content}</div>,
    );
  }

  return wrapWithTooltip(
    <button type="button" onClick={metric.onClick} data-testid={metric.testId} className={className}>
      {content}
    </button>,
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
        { key: "asc", label: "Ascending" },
        { key: "desc", label: "Descending" },
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

const indentorValueSortOptions = [
  { key: "value", label: "Total" },
  { key: "capital", label: "Capital" },
  { key: "revenue", label: "Revenue" },
] satisfies Array<{ key: IndentorValueSortKey; label: string }>;

function IndentorValueSortControl({
  value,
  onChange,
}: {
  value: IndentorValueSortKey;
  onChange: (value: IndentorValueSortKey) => void;
}) {
  return (
    <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium">
      <span className="text-muted-foreground">Sort by</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as IndentorValueSortKey)}
        className="h-6 min-w-20 bg-transparent text-xs text-foreground outline-none"
      >
        {indentorValueSortOptions.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MilestoneClearingViewModeControl({
  value,
  onChange,
}: {
  value: MilestoneClearingViewMode;
  onChange: (mode: MilestoneClearingViewMode) => void;
}) {
  const active = value !== "ranking";
  return (
    <div
      className={filterControlClass(
        active,
        "flex h-8 items-center gap-1 rounded-md border border-border bg-card p-0.5 text-xs font-medium",
      )}
    >
      {[
        { key: "ranking", label: "Ranking" },
        { key: "chronological", label: "Chronological" },
      ].map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key as MilestoneClearingViewMode)}
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

function MilestoneClearingFilterControls({
  valueThreshold,
  mode,
  valueThresholdLevels,
  modes,
  onValueThresholdChange,
  onModeChange,
}: {
  valueThreshold: MilestoneClearingThresholdFilter;
  mode: string;
  valueThresholdLevels: ValueThresholdLevel[];
  modes: string[];
  onValueThresholdChange: (value: MilestoneClearingThresholdFilter) => void;
  onModeChange: (value: string) => void;
}) {
  return (
    <>
      <MilestoneClearingSelect
        label="Value"
        value={valueThreshold}
        onChange={(value) => onValueThresholdChange(value as MilestoneClearingThresholdFilter)}
      >
        <option value="all">All values</option>
        {valueThresholdLevels.map((level) => (
          <option key={level.id} value={`level:${level.id}`}>
            {formatMilestoneClearingThresholdOption(level)}
          </option>
        ))}
        {valueThresholdLevels.length ? <option value="unmatched">Unmatched</option> : null}
      </MilestoneClearingSelect>
      <MilestoneClearingSelect label="Mode" value={mode} onChange={onModeChange}>
        <option value="all">All modes</option>
        {modes.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </MilestoneClearingSelect>
    </>
  );
}

function MilestoneClearingSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const active = value !== "all";
  return (
    <label
      className={filterControlClass(
        active,
        "flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium",
      )}
    >
      <span className={filterLabelClass(active, "text-muted-foreground")}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={
          "h-6 min-w-24 bg-transparent text-xs outline-none " +
          (active ? "text-destructive" : "text-foreground")
        }
      >
        {children}
      </select>
    </label>
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
  loading,
  error,
  isAdmin,
  onReview,
}: {
  acceptances: AnomalyAcceptanceRow[];
  loading: boolean;
  error?: string;
  isAdmin: boolean;
  onReview: (signature: string, action: string) => void;
}) {
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
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading anomaly control...</p>
        ) : null}
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
                          <button
                            className="rounded border border-border px-2 py-1 hover:bg-accent"
                            type="button"
                            onClick={() => onReview(row.signature, "approve_file")}
                          >
                            File
                          </button>
                          <button
                            className="rounded border border-border px-2 py-1 hover:bg-accent"
                            type="button"
                            onClick={() => onReview(row.signature, "approve_universal")}
                          >
                            Universal
                          </button>
                          <button
                            className="rounded border border-border px-2 py-1 hover:bg-accent"
                            type="button"
                            onClick={() => onReview(row.signature, "reject")}
                          >
                            Send correction to user
                          </button>
                          <button
                            className="rounded border border-border px-2 py-1 hover:bg-accent"
                            type="button"
                            onClick={() => onReview(row.signature, "revoke")}
                          >
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
  return (
    <div className="flex w-full max-w-5xl flex-col gap-2">
      <label className="flex w-72 max-w-full flex-col gap-1 text-xs text-muted-foreground">
        <span>Firm</span>
        <SearchableDropdown
          value={selectedFirm}
          onChange={onFirmChange}
          options={firms}
          deferChangeUntilSelect
          typeAheadOnly
          allowCustomValue={false}
          placeholder={firms.length ? "Select Firm Name" : "No firm data available"}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
        />
      </label>
      <div className="flex flex-wrap gap-2 rounded-md border border-border bg-secondary/20 px-3 py-2">
        {firmAnalysisRoleOptions.map((role) => {
          const isSelected = selectedRoles.includes(role.key);
          return (
            <button
              key={role.key}
              type="button"
              onClick={() => onToggleRole(role.key, !isSelected)}
              className={
                "h-9 rounded-md border px-3 text-xs font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/40 " +
                (isSelected
                  ? "border-primary/60 bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground")
              }
              aria-pressed={isSelected}
            >
              {role.label}
            </button>
          );
        })}
      </div>
      <div className="flex min-h-[3rem] flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
        {selectedOrderedRoles.map((roleKey, index) => {
          const role = firmAnalysisRoleOptions.find((option) => option.key === roleKey);
          const nextRole = selectedOrderedRoles[index + 1];
          return (
            <Fragment key={roleKey}>
              <div
                className={
                  "grid h-9 min-w-0 grid-cols-[4.25rem_minmax(0,1fr)] items-center overflow-hidden rounded-md border text-xs shadow-sm " +
                  (negatedRoles.includes(roleKey)
                    ? "border-destructive/40"
                    : "border-primary/40")
                }
              >
                <label className="flex h-full items-center justify-center gap-1 border-r border-border bg-secondary/40 px-2 text-[11px] font-semibold">
                  <input
                    type="checkbox"
                    checked={negatedRoles.includes(roleKey)}
                    onChange={(event) => onToggleNot(roleKey, event.target.checked)}
                    className="size-3 rounded border-input"
                  />
                  NOT
                </label>
                <span className="truncate px-3 text-xs font-semibold">
                  {role?.label ?? roleKey}
                </span>
              </div>
              {nextRole ? (
                <select
                  value={operators[firmAnalysisOperatorKey(roleKey, nextRole)] ?? "and"}
                  onChange={(event) =>
                    onOperatorChange(roleKey, nextRole, event.target.value as FirmAnalysisOperator)
                  }
                  className="h-8 w-20 rounded-md border border-input bg-background px-2 text-center text-xs font-semibold uppercase text-foreground shadow-sm"
                >
                  <option value="and">AND</option>
                  <option value="or">OR</option>
                </select>
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function CoParticipantControls({
  firms,
  selectedFirm,
  coBiddingFirms,
  coBiddingTenders,
  selectedPartnerName,
  loading,
  onOpenAll,
  onExport,
  onFirmChange,
}: {
  firms: string[];
  selectedFirm: string;
  coBiddingFirms: CoBiddingFirmRow[];
  coBiddingTenders: CoBiddingTenderRow[];
  selectedPartnerName: string;
  loading: boolean;
  onOpenAll: () => void;
  onExport: (format: "pdf" | "excel") => void;
  onFirmChange: (firm: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-80 max-w-full flex-col gap-1 text-xs text-muted-foreground">
          <span>Find firms that tendered with</span>
          <SearchableDropdown
            value={selectedFirm}
            onChange={onFirmChange}
            options={firms}
            deferChangeUntilSelect
            typeAheadOnly
            allowCustomValue={false}
            placeholder="Select Firm Name"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!coBiddingTenders.length}
          onClick={onOpenAll}
          title="Open the currently displayed shared files in Search Files"
          aria-label="Open all matching results in Search Files"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium disabled:opacity-50"
        >
          <Search className="size-3.5" />
          Open all results in Search Files
        </button>
        <button
          type="button"
          disabled={!coBiddingFirms.length}
          onClick={() => onExport("pdf")}
          aria-label="Export co-participating firms as PDF"
          className="inline-flex h-8 items-center rounded-md border border-border bg-card px-2.5 text-xs font-medium disabled:opacity-50"
        >
          Export PDF
        </button>
        <button
          type="button"
          disabled={!coBiddingFirms.length}
          onClick={() => onExport("excel")}
          aria-label="Export co-participating firms as Excel"
          className="inline-flex h-8 items-center rounded-md border border-border bg-card px-2.5 text-xs font-medium disabled:opacity-50"
        >
          Export Excel
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading co-bidding results…</p>
      ) : null}
      {selectedPartnerName ? (
        <p className="text-xs text-muted-foreground">
          Selected pair: {selectedFirm}, {selectedPartnerName}. {coBiddingTenders.length} shared
          file(s).
        </p>
      ) : null}
    </div>
  );
}

function CoBiddingFirmTable({
  mainFirm,
  firms,
  onViewTenders,
}: {
  mainFirm: string;
  firms: CoBiddingFirmRow[];
  onViewTenders: (firm: string) => void;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">
          Firms that co-bid with {mainFirm || "the selected firm"}
        </h3>
        <p className="text-xs text-muted-foreground">
          Results use the same filtered file set currently applied to Analytics.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[1040px] table-fixed border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="w-28 px-2 py-2 font-semibold">Unique Number</th>
              <th className="w-44 px-2 py-2 font-semibold">Name</th>
              <th className="w-28 px-2 py-2 font-semibold">City</th>
              <th className="w-32 px-2 py-2 text-right font-semibold">Bids Submitted</th>
              <th className="w-24 px-2 py-2 text-right font-semibold">S.O. Received</th>
              <th className="w-36 px-2 py-2 text-right font-semibold">Total S.O. Value</th>
              <th className="w-20 px-2 py-2 text-right font-semibold">Count</th>
            </tr>
          </thead>
          <tbody>
            {firms.length ? (
              firms.map((firm) => (
                <tr key={firm.key} className="border-t border-border">
                  <td className="px-3 py-2">{firm.uniqueNumber}</td>
                  <td className="px-3 py-2">{firm.name}</td>
                  <td className="px-3 py-2">{firm.city}</td>
                  <td className="px-2 py-2 text-right">{firm.tendersParticipated}</td>
                  <td className="px-2 py-2 text-right">{firm.soCount}</td>
                  <td className="px-2 py-2 text-right">{formatCurrency(firm.soValue)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onViewTenders(firm.key)}
                      title={`Show ${firm.count} shared tenders`}
                      className="text-sm font-medium text-primary underline decoration-dotted underline-offset-2 hover:text-primary/80"
                    >
                      {firm.count}
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Matching co-bidding firms and their shared tender counts will appear here. Click
                  a count to load those files below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CoParticipantResultsPlaceholder({
  mainFirm,
  coBiddingFirm,
  partnerName,
  tenders,
  loading,
  error,
  onOpenTender,
}: {
  mainFirm: string;
  coBiddingFirm: string;
  partnerName: string;
  tenders: CoBiddingTenderRow[];
  loading: boolean;
  error?: string;
  onOpenTender: (tender: CoBiddingTenderRow) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Shared tender details</h3>
        <p className="text-xs text-muted-foreground">
          {coBiddingFirm
            ? `${mainFirm}, ${partnerName || "selected firm"}`
            : "Click a firm's count above to show the shared file details here."}
        </p>
        {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th
                className="px-3 py-2 font-semibold text-primary underline decoration-dotted underline-offset-2"
                title="Select a result's Unique Code to open that result in Search Files"
              >
                Unique Code
              </th>
              <th className="px-3 py-2 font-semibold">Control No.</th>
              <th className="px-3 py-2 font-semibold">Item Description</th>
              <th className="px-3 py-2 font-semibold">Indentor</th>
              <th className="px-3 py-2 font-semibold">S.O. Year</th>
              <th className="px-3 py-2 font-semibold">S.O. Firm</th>
            </tr>
          </thead>
          <tbody>
            {tenders.length ? (
              tenders.map((tender) => (
                <tr key={tender.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpenTender(tender)}
                      className="font-medium text-primary underline decoration-dotted underline-offset-2 hover:text-primary/80"
                    >
                      {tender.uniqueCode || "Open file"}
                    </button>
                  </td>
                  <td className="px-3 py-2">{tender.controlNo || "—"}</td>
                  <td className="px-3 py-2">{tender.itemDescription || "—"}</td>
                  <td className="px-3 py-2">{tender.indentor || "—"}</td>
                  <td className="px-3 py-2">{tender.soYear || "—"}</td>
                  <td className="px-3 py-2">{tender.soFirm || "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {loading
                    ? "Loading shared tenders…"
                    : coBiddingFirm
                      ? "No shared tender files found in this filter scope."
                      : "Shared tender rows will appear here. Select a row's Count above."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const countValueAnalysisOptions: Array<{ key: CountValueAnalysisMode; label: string }> = [
  { key: "demandValue", label: "Demand Value" },
  { key: "soValue", label: "S.O. Value" },
  { key: "countDemandValue", label: "Count-Demand value" },
  { key: "countSoValue", label: "Count-S.O. value" },
  { key: "countDemandValuePercent", label: "Count-Demand Value (%)" },
  { key: "countSoValuePercent", label: "Count-S.O. Value (%)" },
];

function CountValueAnalysisControls({
  mode,
  onModeChange,
}: {
  mode: CountValueAnalysisMode;
  onModeChange: (mode: CountValueAnalysisMode) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {countValueAnalysisOptions.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onModeChange(option.key)}
          className={
            "h-8 rounded-md border px-3 text-xs font-semibold transition " +
            (mode === option.key
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-foreground hover:bg-accent")
          }
          aria-pressed={mode === option.key}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function AnalyticsChartCard({
  title,
  subtitle,
  helper,
  helperExamples,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  helper?: string[] | string;
  helperExamples?: HelperExamples;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-1.5">
          <div className="min-w-0">
            <h3 className="text-sm font-bold">{title}</h3>
            {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          {helper ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${title} note`}
                    className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    <Info className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  align="start"
                  className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
                >
                  <HelperWithExamples items={helper} examples={helperExamples} />
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

function HelperWithExamples({
  items,
  examples,
  details,
}: {
  items: string[] | string;
  examples?: HelperExamples;
  details?: HelperDetails;
}) {
  const [showExamples, setShowExamples] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const showSidePanel = (examples && showExamples) || (details && showDetails);

  return (
    <div className={showSidePanel ? "grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)]" : "space-y-3"}>
      <div className="space-y-3">
        <HelperBulletList items={items} />
        {examples || details ? (
          <div className="flex flex-wrap gap-2">
            {details ? (
              <button
                type="button"
                onClick={() => {
                  setShowDetails((current) => !current);
                  setShowExamples(false);
                }}
                className="rounded border border-primary/40 bg-background px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
                aria-expanded={showDetails}
              >
                {showDetails ? `Hide ${details.buttonLabel ?? "details"}` : details.buttonLabel ?? "Details"}
              </button>
            ) : null}
            {examples ? (
            <button
              type="button"
              onClick={() => {
                setShowExamples((current) => !current);
                setShowDetails(false);
              }}
              className="rounded border border-primary/40 bg-background px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
              aria-expanded={showExamples}
            >
              {showExamples ? "Hide examples" : "Examples"}
            </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {details && showDetails ? (
        <div className="rounded-md border border-border bg-background p-3 text-popover-foreground shadow-sm">
          <div className="mb-2 font-semibold">{details.title}</div>
          <HelperBulletList items={details.items} />
        </div>
      ) : null}
      {examples && showExamples ? (
        <div className="rounded-md border border-border bg-background p-3 text-popover-foreground shadow-sm">
          <div className="mb-2 font-semibold">{examples.title}</div>
          <HelperBulletList items={examples.items} />
        </div>
      ) : null}
    </div>
  );
}

function HelperBulletList({ items }: { items: readonly string[] | string }) {
  const bullets = splitHelperText(items);
  return <HelperContent lines={bullets} />;
}

function splitHelperText(items: readonly string[] | string) {
  const source = Array.isArray(items) ? items : [items];
  return source
    .flatMap((item) => protectHelperAbbreviations(item).split("\n"))
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9])/))
    .map((item) =>
      restoreHelperAbbreviations(item)
        .trim()
        .replace(/^[-*]\s+/, ""),
    )
    .filter(Boolean);
}

function protectHelperAbbreviations(text: string) {
  return text
    .replaceAll("S.O.", "S§O§")
    .replaceAll("D.P.", "D§P§")
    .replaceAll("F.Y.", "F§Y§")
    .replaceAll("FY.", "FY§")
    .replaceAll("No.", "No§");
}

function restoreHelperAbbreviations(text: string) {
  return text
    .replaceAll("S§O§", "S.O.")
    .replaceAll("D§P§", "D.P.")
    .replaceAll("F§Y§", "F.Y.")
    .replaceAll("FY§", "FY.")
    .replaceAll("No§", "No.");
}

function DashboardBreadcrumb({
  items,
}: {
  items: Array<{ label: string; onClick?: () => void } | undefined>;
}) {
  const visibleItems = items.filter((item): item is { label: string; onClick?: () => void } =>
    Boolean(item),
  );
  if (visibleItems.length < 2) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {visibleItems.map((item, index) => (
        <Fragment key={`${item.label}-${index}`}>
          {index > 0 ? <span>/</span> : null}
          {item.onClick ? (
            <button
              type="button"
              onClick={item.onClick}
              className="font-medium text-foreground hover:text-primary hover:underline"
            >
              {item.label}
            </button>
          ) : (
            <span>{item.label}</span>
          )}
        </Fragment>
      ))}
    </div>
  );
}

function getCountAnalyticsColumns(nameLabel: string, countLabel = "Count"): AnalyticsTableColumn[] {
  return [
    { key: "name", label: nameLabel, align: "left" },
    { key: "count", label: countLabel },
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

function withSequenceAnalyticsColumns(columns: AnalyticsTableColumn[]) {
  return [{ key: "rank", label: "Order" }, ...columns];
}

function getDefaultAnalyticsSortDirection(panelKey: AnalyticsPanelKey): AnalyticsSortDirection {
  return panelKey === "milestoneClearingTable" ? "asc" : "desc";
}

function getValueAnalyticsColumns(nameLabel: string, valueLabel: string): AnalyticsTableColumn[] {
  return [
    { key: "name", label: nameLabel, align: "left" },
    { key: "value", label: valueLabel, format: (value) => formatCurrency(Number(value)) },
  ];
}

function getIndentorValueAnalyticsColumns(): AnalyticsTableColumn[] {
  return [
    { key: "name", label: "Indentor", align: "left" },
    { key: "capital", label: "Capital value", format: (value) => formatCurrency(Number(value)) },
    { key: "revenue", label: "Revenue value", format: (value) => formatCurrency(Number(value)) },
    { key: "value", label: "Total value", format: (value) => formatCurrency(Number(value)) },
  ];
}

function getFirmAnalysisColumns(): AnalyticsTableColumn[] {
  return [
    { key: "name", label: "Firm", align: "left" },
    { key: "selectedRolesLabel", label: "Boolean selection", align: "left" },
    { key: "selectedRoles", label: "Matching cases" },
  ];
}

function getCountValueAnalysisColumns(mode: CountValueAnalysisMode): AnalyticsTableColumn[] {
  const isSupplyOrder =
    mode === "soValue" || mode === "countSoValue" || mode === "countSoValuePercent";
  const isPercentOnly = mode === "countDemandValuePercent" || mode === "countSoValuePercent";
  const isContribution = mode === "countDemandValue" || mode === "countSoValue";
  if (isPercentOnly) {
    const countGroup = isSupplyOrder ? "S.O. Count %" : "Demand Count %";
    return [
      { key: "range", label: "Value range", align: "left" },
      {
        key: "revenueCountContribution",
        label: "Revenue",
        group: countGroup,
        format: (value) => formatContributionPercent(Number(value)),
      },
      {
        key: "capitalCountContribution",
        label: "Capital",
        group: countGroup,
        format: (value) => formatContributionPercent(Number(value)),
      },
      {
        key: "countContribution",
        label: "Total",
        group: countGroup,
        format: (value) => formatContributionPercent(Number(value)),
      },
      {
        key: "revenueContribution",
        label: "Revenue",
        group: "Value %",
        format: (value) => formatContributionPercent(Number(value)),
      },
      {
        key: "capitalContribution",
        label: "Capital",
        group: "Value %",
        format: (value) => formatContributionPercent(Number(value)),
      },
      {
        key: "valueContribution",
        label: "Total",
        group: "Value %",
        format: (value) => formatContributionPercent(Number(value)),
      },
    ];
  }
  if (isContribution) {
    const countGroup = isSupplyOrder ? "S.O. Count" : "Demands";
    return [
      { key: "range", label: "Value range", align: "left" },
      { key: "revenueCount", label: "Revenue", group: countGroup },
      { key: "capitalCount", label: "Capital", group: countGroup },
      { key: "count", label: "Total count", group: countGroup },
      {
        key: "revenue",
        label: "Revenue",
        group: "Value",
        format: (value) => formatCurrency(Number(value)),
      },
      {
        key: "capital",
        label: "Capital",
        group: "Value",
        format: (value) => formatCurrency(Number(value)),
      },
      {
        key: "value",
        label: "Total",
        group: "Value",
        format: (value) => formatCurrency(Number(value)),
      },
    ];
  }
  if (mode === "demandValue" || mode === "soValue") {
    return [
      { key: "range", label: "Value range", align: "left" },
      { key: "count", label: "Count", group: "Count" },
      {
        key: "countContribution",
        label: "Count (%)",
        group: "Count",
        format: (value) => formatContributionPercent(Number(value)),
      },
      {
        key: "valueContribution",
        label: "Value (%)",
        group: "Value",
        format: (value) => formatContributionPercent(Number(value)),
      },
      {
        key: "value",
        label: "Value",
        group: "Value",
        format: (value) => formatCurrency(Number(value)),
      },
    ];
  }
  return [
    { key: "range", label: "Value range", align: "left" },
    { key: "count", label: isSupplyOrder ? "S.O." : "Demands" },
    { key: "capital", label: "Capital", format: (value) => formatCurrency(Number(value)) },
    { key: "revenue", label: "Revenue", format: (value) => formatCurrency(Number(value)) },
    { key: "value", label: "Total", format: (value) => formatCurrency(Number(value)) },
  ];
}

function getCountValueAnalysisSubtitle(mode: CountValueAnalysisMode) {
  if (mode === "soValue") return "Supply orders grouped by admin configured threshold levels";
  if (mode === "countDemandValue")
    return "Demand count share and value share by configured threshold levels";
  if (mode === "countSoValue")
    return "Supply order count share and value share by configured threshold levels";
  if (mode === "countDemandValuePercent") return "Demand count and value share by threshold levels";
  if (mode === "countSoValuePercent") return "S.O. count and value share by threshold levels";
  return "Demands grouped by admin configured threshold levels";
}

function getCountValueAnalysisRows(
  analytics: {
    fileValueThresholds?: Array<Record<string, number | string>>;
    soValueThresholds?: Array<Record<string, number | string>>;
  },
  mode: CountValueAnalysisMode,
) {
  const rows =
    mode === "soValue" || mode === "countSoValue" || mode === "countSoValuePercent"
      ? (analytics.soValueThresholds ?? [])
      : (analytics.fileValueThresholds ?? []);
  if (
    mode === "demandValue" ||
    mode === "soValue" ||
    mode === "countDemandValue" ||
    mode === "countSoValue" ||
    mode === "countDemandValuePercent" ||
    mode === "countSoValuePercent"
  ) {
    const normalizedRows = rows.map((row) => {
      const count = Number(row.count ?? 0);
      const capital = Number(row.capital ?? 0);
      const revenue = Number(row.revenue ?? 0);
      const rawCapitalCount = Number(row.capitalCount ?? row.capital_count ?? 0);
      const rawRevenueCount = Number(row.revenueCount ?? row.revenue_count ?? 0);
      const hasCountBreakup = rawCapitalCount + rawRevenueCount > 0 || count <= 0;
      const appliesTo = String(row.appliesTo ?? "").toLowerCase();
      let inferredCapitalCount =
        appliesTo === "capital" || (capital > 0 && revenue <= 0) ? count : 0;
      let inferredRevenueCount =
        appliesTo === "revenue" || (revenue > 0 && capital <= 0) ? count : 0;
      if (!hasCountBreakup && !inferredCapitalCount && !inferredRevenueCount) {
        const totalValue = capital + revenue;
        inferredCapitalCount = totalValue > 0 ? Math.round((count * capital) / totalValue) : 0;
        inferredRevenueCount = Math.max(0, count - inferredCapitalCount);
      }
      return {
        ...row,
        count,
        capitalCount: hasCountBreakup ? rawCapitalCount : inferredCapitalCount,
        revenueCount: hasCountBreakup ? rawRevenueCount : inferredRevenueCount,
        capital,
        revenue,
        value: Number(row.value ?? 0),
      };
    });
    const totalCount = normalizedRows.reduce((sum, row) => sum + row.count, 0);
    const totalCapitalCount = normalizedRows.reduce((sum, row) => sum + row.capitalCount, 0);
    const totalRevenueCount = normalizedRows.reduce((sum, row) => sum + row.revenueCount, 0);
    const totalCapital = normalizedRows.reduce((sum, row) => sum + row.capital, 0);
    const totalRevenue = normalizedRows.reduce((sum, row) => sum + row.revenue, 0);
    const totalValue = normalizedRows.reduce((sum, row) => sum + row.value, 0);
    return normalizedRows.map((row) => ({
      ...row,
      countContribution: roundContributionPercent(getPercent(row.count, totalCount)),
      capitalCountContribution: roundContributionPercent(
        getPercent(row.capitalCount, totalCapitalCount),
      ),
      revenueCountContribution: roundContributionPercent(
        getPercent(row.revenueCount, totalRevenueCount),
      ),
      capitalContribution: roundContributionPercent(getPercent(row.capital, totalCapital)),
      revenueContribution: roundContributionPercent(getPercent(row.revenue, totalRevenue)),
      valueContribution: roundContributionPercent(getPercent(row.value, totalValue)),
    }));
  }
  return rows;
}

function getSuspectedAnomalyColumns(
  onAccept: (row: Record<string, number | string>) => void,
  onAdminReview?: (signature: string, action: string) => void,
): AnalyticsTableColumn[] {
  return [
    { key: "controlNo", label: "Control No.", align: "left" },
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

function getMilestoneClearingAnalyticsColumns(
  mode: MilestoneClearingViewMode,
): AnalyticsTableColumn[] {
  const columns: AnalyticsTableColumn[] = [
    {
      key: "name",
      label: "Milestone",
      align: "left",
      render: (value) => <MilestoneClearingNameCell name={String(value)} />,
    },
    { key: "averageDays", label: "Avg days" },
  ];
  if (mode === "chronological") {
    columns.push(
      { key: "cumulativeDays", label: "Cumulative" },
      { key: "minDays", label: "Minimum" },
      { key: "maxDays", label: "Maximum" },
      { key: "medianDays", label: "Median" },
    );
  }
  columns.push({ key: "fileCount", label: "Files" }, { key: "sampleSize", label: "Samples" });
  return columns;
}

function MilestoneClearingNameCell({ name }: { name: string }) {
  const helper = getMilestoneClearingHelper(name);
  const displayName = getWorkflowDisplayLabel(name);
  if (!helper) return displayName;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
      <span className="truncate">{displayName}</span>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
              aria-label={`${displayName} clearing time logic`}
            >
              <Info className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            align="start"
            className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
          >
            <HelperBulletList items={helper} />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

function getMilestoneClearingHelper(name: string) {
  const helpers: Record<string, string> = {
    scrutiny: "Scrutiny clearing = Scrutiny Completion Date - Received Date.",
    highvalue:
      "High Value clearing = High Value Minutes Date - latest applicable completed milestone date on or before High Value Minutes Date. Falls back to Received Date if none exists.",
    pretcec:
      "Pre-TCEC clearing = Pre-TCEC Minutes Date - latest applicable completed milestone date on or before Pre-TCEC Minutes Date.",
    ad: "AD clearing = AD Vetting Date - latest applicable completed milestone date on or before AD Vetting Date.",
    rqa: "R&QA clearing = R&QA Approval Date - latest applicable completed milestone date on or before R&QA Approval Date.",
    controlling:
      "Controlling clearing = Demand Control Date - latest applicable completed milestone date on or before Demand Control Date.",
    ifa: "IFA clearing = IFA Final Date - latest applicable completed milestone date on or before IFA Final Date.",
    cfa: "CFA clearing = CFA Date - latest applicable completed milestone date on or before CFA Date.",
    bidding:
      "Bidding clearing = Bid Opening Date - latest applicable completed milestone date on or before Bid Opening Date. For refloat cases, Refloat Bid Opening Date is used.",
    posttcec:
      "Post-TCEC clearing = Post-TCEC Minutes Date - latest applicable completed milestone date on or before Post-TCEC Minutes Date.",
    cnc: "CNC clearing = CNC Approval Date - latest applicable completed milestone date on or before CNC Approval Date.",
    supplyorder:
      "Supply Order clearing = S.O. Date - latest applicable file-level completed milestone date on or before S.O. Date. Cancelled S.O. rows are included here because placement happened before cancellation.",
    irpreparation:
      "IR Preparation clearing = IR Preparation Date - Material Receipt Date, counted per applicable S.O./stage row.",
    irreceipt:
      "IR Receipt clearing = IR Receipt Date - IR Sent Date, counted per applicable S.O./stage row.",
    billpreparation:
      "Bill preparation clearing = Bill Preparation Date - IR Receipt Date for Material Receipt cases; otherwise from DP/Revised DP + 1 day for Job Completion cases.",
    billsentforpayment:
      "Bill sent for payment clearing = Bill Sent for Payment Date - Bill Preparation Date.",
    billreturnedforcorrection:
      "Returned Bills clearing = Resubmitted Date - Returned Date, counted per completed return cycle.",
    supplementarybillreturnedforcorrection:
      "Supplementary bill returned for correction clearing = Supplementary Resubmitted Date - Supplementary Returned Date, counted per completed supplementary return cycle.",
    payment:
      "Payment clearing = Payment Date - Bill Sent for Payment Date. Cancelled S.O. rows are excluded.",
  };
  return helpers[normalizeMilestoneName(name)];
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
    {
      key: "name",
      label: "CNC Date",
      align: "left",
      format: (value) => formatIsoDateForDisplay(String(value)),
    },
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

function sortIndentorValueRows(
  rows: Array<Record<string, number | string>>,
  sortKey: IndentorValueSortKey,
  direction: AnalyticsSortDirection,
) {
  return [...rows].sort((a, b) => {
    const left = Number(a[sortKey] ?? 0);
    const right = Number(b[sortKey] ?? 0);
    const diff = direction === "desc" ? right - left : left - right;
    if (diff !== 0) return diff;
    const leftTotal = Number(a.value ?? 0);
    const rightTotal = Number(b.value ?? 0);
    const totalDiff = rightTotal - leftTotal;
    if (totalDiff !== 0) return totalDiff;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });
}

function sortMilestoneClearingRows(
  rows: Array<Record<string, number | string>>,
  mode: MilestoneClearingViewMode,
  _direction: AnalyticsSortDirection,
) {
  if (mode === "ranking") return sortAnalyticsRows(rows, _direction);
  const sortedRows = [...rows].sort(
    (a, b) =>
      getMilestoneClearingSequence(a) - getMilestoneClearingSequence(b) ||
      String(a.name ?? "").localeCompare(String(b.name ?? "")),
  );
  return sortedRows;
}

function getMilestoneClearingDisplayRows(
  rows: Array<Record<string, number | string>>,
  mode: MilestoneClearingViewMode,
) {
  if (mode === "ranking") return rows;
  const rowsByName = new Map(
    rows.map((row) => [normalizeAnalyticsName(String(row.name ?? "")), row] as const),
  );
  let cumulativeAverageDays = 0;
  return milestoneClearingDefinitions.flatMap((definition, index) => {
    const row = rowsByName.get(normalizeAnalyticsName(definition.name));
    if (!row || Number(row.sampleSize ?? 0) <= 0) return [];
    cumulativeAverageDays += Number(row.averageDays ?? 0);
    return [
      {
        ...row,
        cumulativeDays: Math.round(cumulativeAverageDays),
        sortOrder: Number(row.sortOrder ?? index),
      },
    ];
  });
}

function getMilestoneClearingSequence(row: Record<string, number | string>) {
  const sortOrder = Number(row.sortOrder);
  if (Number.isFinite(sortOrder)) return sortOrder;
  return getMilestoneClearingDefinitionOrder(String(row.name ?? ""));
}

function getMilestoneClearingDefinitionOrder(name: string) {
  const normalizedName = normalizeAnalyticsName(name);
  const index = milestoneClearingDefinitions.findIndex(
    (definition) => normalizeAnalyticsName(definition.name) === normalizedName,
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
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
  const visible = Math.min(5, totalPages);
  const half = Math.floor(visible / 2);
  let startPage = Math.max(1, currentPage - half);
  const lastPage = Math.min(totalPages, startPage + visible - 1);
  startPage = Math.max(1, lastPage - visible + 1);
  return Array.from({ length: lastPage - startPage + 1 }, (_, index) => startPage + index);
}

function getAnalyticsSearchTarget(
  panelKey: AnalyticsPanelKey,
  row: Record<string, number | string>,
  columnKey: string,
  context?: AnalyticsSearchContext,
): AnalyticsSearchTarget | undefined {
  const name = String(row.name ?? row.range ?? row.fileRef ?? "").trim();
  if (
    !name ||
    columnKey === "rank" ||
    (columnKey === "name" && panelKey !== "cncSummary" && panelKey !== "preBidMeetings") ||
    columnKey === "range"
  )
    return undefined;

  if (panelKey === "divisionFiles" && columnKey === "count") {
    return { division: name, focusSection: "File details", focusTarget: "division" };
  }
  if (panelKey === "divisionTurnaround" && columnKey === "sampleSize") {
    return {
      dashboardFilter: "divisionTurnaroundSample",
      division: name,
      focusSection: "Supply order and payment",
      focusTarget: "supplyorder:any",
    };
  }
  if (panelKey === "paymentPending" && columnKey === "count") {
    return {
      dashboardFilter: "analyticsPaymentPending",
      division: name,
      focusSection: "Supply order and payment",
      focusTarget: "payment:pending",
    };
  }
  if (panelKey === "preBidMeetings") {
    const fiscalYear = String(row.fiscalYear ?? "").trim();
    if (/^\d{4}-\d{2}$/.test(fiscalYear)) {
      const filterByColumn: Record<string, string> = {
        count: `preBidMeetingCombinedFy:all:${fiscalYear}`,
        preBidDue: `preBidMeetingFy:due:${fiscalYear}`,
        preBidCompleted: `preBidMeetingFy:completed:${fiscalYear}`,
        refloatPreBidDue: `refloatPreBidMeetingFy:due:${fiscalYear}`,
        refloatPreBidCompleted: `refloatPreBidMeetingFy:completed:${fiscalYear}`,
      };
      const dashboardFilter = filterByColumn[columnKey];
      return dashboardFilter ? { dashboardFilter, focusSection: "Bidding details" } : undefined;
    }
    const monthKey = String(row.monthKey ?? row.name ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return undefined;
    const filterByColumn: Record<string, string> = {
      name: `preBidMeetingCombined:all:${monthKey}`,
      count: `preBidMeetingCombined:all:${monthKey}`,
      preBidDue: `preBidMeeting:due:${monthKey}`,
      preBidCompleted: `preBidMeeting:completed:${monthKey}`,
      refloatPreBidDue: `refloatPreBidMeeting:due:${monthKey}`,
      refloatPreBidCompleted: `refloatPreBidMeeting:completed:${monthKey}`,
    };
    const dashboardFilter = filterByColumn[columnKey];
    return dashboardFilter ? { dashboardFilter, focusSection: "Bidding details" } : undefined;
  }
  if (
    panelKey === "tcecStatus" &&
    (columnKey === "reviewed" || columnKey === "signed" || columnKey === "pending")
  ) {
    const stage = String(row.stage ?? "pre") === "post" ? "post" : "pre";
    const fiscalYear = String(row.fiscalYear ?? context?.selectedTcecFiscalYear ?? "").trim();
    if (/^\d{4}-\d{2}$/.test(fiscalYear)) {
      const committee = String(row.name ?? "").trim();
      const isCommitteeRow = Boolean(
        row.committee === undefined && committee && committee !== fiscalYear,
      );
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
    return {
      analyticsType: "firm",
      analyticsNames: [name],
      focusSection: "Firm details",
    };
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
    return {
      analyticsType: "indentor",
      analyticsNames: [name],
      focusSection: "File details",
      focusTarget: "indentor",
    };
  }
  if (
    panelKey === "indentorsByValue" &&
    (columnKey === "capital" || columnKey === "revenue" || columnKey === "value")
  ) {
    return {
      analyticsType: "indentor",
      analyticsNames: [name],
      capitalOnly: columnKey === "capital",
      revenueOnly: columnKey === "revenue",
      focusSection: "File details",
      focusTarget: "indentor",
    };
  }
  if (panelKey === "biddingMode" && columnKey === "count") {
    return {
      dashboardFilter: `mode:${name.toUpperCase()}`,
      focusSection: "Bidding details",
    };
  }
  if (panelKey === "fileValueThresholds") {
    if (
      columnKey === "count" ||
      columnKey === "capitalCount" ||
      columnKey === "revenueCount" ||
      columnKey === "capital" ||
      columnKey === "revenue" ||
      columnKey === "value" ||
      columnKey === "countContribution" ||
      columnKey === "capitalCountContribution" ||
      columnKey === "revenueCountContribution" ||
      columnKey === "capitalContribution" ||
      columnKey === "revenueContribution" ||
      columnKey === "valueContribution"
    ) {
      const isSupplyOrder = row.source === "supplyOrder";
      const metricByColumn: Record<string, "capital" | "revenue" | "total" | undefined> = {
        capitalCount: "capital",
        capitalCountContribution: "capital",
        capital: "capital",
        capitalContribution: "capital",
        revenueCount: "revenue",
        revenueCountContribution: "revenue",
        revenue: "revenue",
        revenueContribution: "revenue",
      };
      const metric = metricByColumn[columnKey];
      const filterPrefix = isSupplyOrder ? "soValueThreshold" : "valueThreshold";
      return {
        dashboardFilter: `${filterPrefix}:${encodeURIComponent(name)}${metric ? `:${metric}` : ""}`,
        focusSection: isSupplyOrder ? "Supply order and payment" : "File details",
        focusTarget: isSupplyOrder
          ? "supplyorder:any"
          : metric === "revenue"
            ? "valueRevenue"
            : "valueCapital",
      };
    }
    return undefined;
  }
  if (panelKey === "suspectedAnomaly" && columnKey !== "action" && columnKey !== "rank") {
    const fileId = String(row.fileId ?? "").trim();
    return fileId
      ? {
          dashboardFilter: `anomalyFile:${encodeURIComponent(fileId)}`,
          ...getSuspectedAnomalySearchFocus(row),
        }
      : undefined;
  }
  if (panelKey === "milestoneClearingTable" && columnKey === "fileCount") {
    const target = withMilestoneClearingSearchFilters(
      getMilestoneClearingSearchTarget(name),
      context,
    );
    const fileIds = String(row.fileIds ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (!target || !fileIds.length) return target;
    return {
      ...target,
      dashboardFilter: `fileIds:${fileIds.map(encodeURIComponent).join(",")}`,
      ...getMilestoneClearingSearchFocus(name, target),
    };
  }
  return undefined;
}

type AnalyticsSearchContext = {
  milestoneClearingMode: string;
  milestoneClearingValueThreshold: MilestoneClearingThresholdFilter;
  valueThresholdLevels: ValueThresholdLevel[];
  selectedTcecFiscalYear?: string;
};

function withMilestoneClearingSearchFilters(
  target: AnalyticsSearchTarget | undefined,
  context: AnalyticsSearchContext | undefined,
): AnalyticsSearchTarget | undefined {
  if (!target || !context) return target;
  const extraDashboardFilters: string[] = [...(target.extraDashboardFilters ?? [])];
  if (context.milestoneClearingValueThreshold === "unmatched") {
    extraDashboardFilters.push("valueThreshold:Unmatched");
  } else if (context.milestoneClearingValueThreshold.startsWith("level:")) {
    const levelId = context.milestoneClearingValueThreshold.slice("level:".length).trim();
    if (levelId) extraDashboardFilters.push(`valueThresholdId:${levelId}`);
  }
  const includeModes =
    context.milestoneClearingMode && context.milestoneClearingMode !== "all"
      ? [context.milestoneClearingMode]
      : target.includeModes;
  return {
    ...target,
    extraDashboardFilters: extraDashboardFilters.length ? extraDashboardFilters : undefined,
    includeModes,
  };
}

type AnalyticsTotalSearchContext = {
  countValueAnalysisMode: CountValueAnalysisMode;
  selectedPreBidFiscalYear: string;
  selectedTcecFiscalYear: string;
  selectedCncFiscalYear: string;
  tcecStatusStage: TcecStatusStage;
};

function getAnalyticsTotalSearchTarget(
  panelKey: AnalyticsPanelKey,
  columnKey: string,
  context: AnalyticsTotalSearchContext,
): AnalyticsSearchTarget | undefined {
  if (columnKey === "rank" || columnKey === "name" || columnKey === "range") return undefined;
  if (panelKey === "fileValueThresholds") {
    const isSupplyOrder =
      context.countValueAnalysisMode === "soValue" ||
      context.countValueAnalysisMode === "countSoValue" ||
      context.countValueAnalysisMode === "countSoValuePercent";
    const metricByColumn: Record<string, string> = {
      count: "total",
      countContribution: "total",
      capitalCount: "capital",
      capitalCountContribution: "capital",
      revenueCount: "revenue",
      revenueCountContribution: "revenue",
      capital: "capital",
      revenue: "revenue",
      value: "total",
      valueContribution: "total",
    };
    const metric = metricByColumn[columnKey];
    return metric
      ? {
          dashboardFilter: `${isSupplyOrder ? "soValueThresholdTotal" : "valueThresholdTotal"}:${metric}`,
          focusSection: isSupplyOrder ? "Supply order and payment" : "File details",
          focusTarget: isSupplyOrder
            ? "supplyorder:any"
            : metric === "revenue"
              ? "valueRevenue"
              : "valueCapital",
        }
      : undefined;
  }
  if (panelKey === "preBidMeetings") {
    const fiscalYear = context.selectedPreBidFiscalYear;
    const filterByColumn: Record<string, string> = fiscalYear
      ? {
          count: `preBidMeetingCombinedFy:all:${fiscalYear}`,
          preBidDue: `preBidMeetingFy:due:${fiscalYear}`,
          preBidCompleted: `preBidMeetingFy:completed:${fiscalYear}`,
          refloatPreBidDue: `refloatPreBidMeetingFy:due:${fiscalYear}`,
          refloatPreBidCompleted: `refloatPreBidMeetingFy:completed:${fiscalYear}`,
        }
      : {
          count: "preBidMeetingCombined:all",
          preBidDue: "preBidMeeting:due",
          preBidCompleted: "preBidMeeting:completed",
          refloatPreBidDue: "refloatPreBidMeeting:due",
          refloatPreBidCompleted: "refloatPreBidMeeting:completed",
        };
    const dashboardFilter = filterByColumn[columnKey];
    return dashboardFilter ? { dashboardFilter, focusSection: "Bidding details" } : undefined;
  }
  if (
    panelKey === "tcecStatus" &&
    (columnKey === "reviewed" || columnKey === "signed" || columnKey === "pending")
  ) {
    return {
      dashboardFilter: getTcecStatusFiscalYearDashboardFilter(
        context.tcecStatusStage,
        columnKey,
        context.selectedTcecFiscalYear || "all",
      ),
      focusSection: "TCEC block",
    };
  }
  if (panelKey === "cncSummary" && isCncSummaryMetric(columnKey)) {
    return {
      dashboardFilter: getCncSummaryFiscalYearDashboardFilter(
        columnKey,
        context.selectedCncFiscalYear || "all",
      ),
      focusSection: "Approval block",
    };
  }
  return undefined;
}

function getTcecMeetingSearchTarget(
  stage: TcecStatusStage,
  row: Record<string, number | string>,
  columnKey: string,
): AnalyticsSearchTarget | undefined {
  if (
    columnKey !== "name" &&
    columnKey !== "reviewed" &&
    columnKey !== "signed" &&
    columnKey !== "pending"
  ) {
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

function getTcecCommitteeTotalSearchTarget(
  stage: TcecStatusStage,
  committee: string,
  fiscalYear: string,
  columnKey: string,
): AnalyticsSearchTarget | undefined {
  if (columnKey !== "reviewed" && columnKey !== "signed" && columnKey !== "pending") {
    return undefined;
  }
  const cleanCommittee = committee.trim();
  if (!cleanCommittee) return undefined;
  return {
    dashboardFilter: fiscalYear
      ? getTcecStatusFiscalYearDashboardFilter(stage, columnKey, fiscalYear, cleanCommittee)
      : getTcecStatusDashboardFilter(stage, columnKey, cleanCommittee),
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
  if (
    source.includes("division") ||
    source.includes("description") ||
    source.includes("indentor")
  ) {
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

function getFinance1DrillFocus(
  key: string,
  section: string,
  metric: string,
): Pick<AnalyticsSearchTarget, "focusSection" | "focusMilestone" | "focusTarget"> {
  const normalizedKey = key.toLowerCase();
  const normalizedSection = section.toLowerCase();
  const normalizedMetric = metric.toLowerCase();

  if (normalizedKey.includes("filegroup")) {
    return { focusSection: "File details", focusTarget: "receivedDate" };
  }
  if (normalizedKey.includes("closed") || normalizedMetric.includes("file closed")) {
    return { focusSection: "Milestones", focusMilestone: "File Closed" };
  }
  if (normalizedKey.includes("cancelled") || normalizedMetric.includes("cancelled")) {
    return { focusSection: "File details", focusTarget: "demandCancelled" };
  }
  if (normalizedKey.includes("booked") || normalizedMetric.includes("controlled done")) {
    return { focusSection: "Scrutiny and control", focusTarget: "immsDate" };
  }
  if (normalizedKey.includes("intended") || normalizedMetric.includes("controlled by")) {
    return { focusSection: "Scrutiny and control", focusTarget: "imms" };
  }
  if (normalizedKey.includes("billssubmitted") || normalizedMetric.includes("bill sent")) {
    return { focusSection: "Supply order and payment", focusTarget: "billsentforpayment:completed" };
  }
  if (normalizedKey.includes("paymentduebutbillnotsubmitted")) {
    return { focusSection: "Supply order and payment", focusTarget: "billpreparation:pending" };
  }
  if (normalizedKey.includes("advancepending")) {
    return { focusSection: "Supply order and payment", focusTarget: "advancepayment:pending" };
  }
  if (normalizedKey.includes("deliveryjobdone")) {
    return {
      focusSection: "Supply order and payment",
      focusTarget: "delivery:completed|jobcompletion:completed",
    };
  }
  if (normalizedKey.includes("deliveryjobpending")) {
    return {
      focusSection: "Supply order and payment",
      focusTarget: "delivery:pending|jobcompletion:pending",
    };
  }
  if (
    normalizedKey.includes("committed") ||
    normalizedKey.includes("soplaced") ||
    normalizedKey.includes("withso") ||
    normalizedKey.includes("soplacedlater") ||
    normalizedMetric.includes("s.o. placed") ||
    normalizedMetric.includes("committed")
  ) {
    return { focusSection: "Supply order and payment", focusTarget: "supplyorder:placed" };
  }
  if (normalizedKey.includes("advance")) {
    return { focusSection: "Supply order and payment", focusTarget: "advancepayment:pending" };
  }
  if (normalizedKey.includes("paymentdue") || normalizedKey.includes("unpaid")) {
    return { focusSection: "Supply order and payment", focusTarget: "payment:pending" };
  }
  if (normalizedKey.includes("paid") || normalizedKey.includes("paymentmade")) {
    return { focusSection: "Supply order and payment", focusTarget: "payment:completed" };
  }
  if (normalizedKey.includes("delivery") || normalizedMetric.includes("delivery")) {
    return { focusSection: "Supply order and payment", focusTarget: "delivery:pending" };
  }
  if (normalizedSection.includes("firm type")) {
    return { focusSection: "Supply order and payment", focusTarget: "firmtype:any" };
  }
  if (normalizedSection.includes("file type") || normalizedSection.includes("file group")) {
    return { focusSection: "File details", focusTarget: "fileType" };
  }
  if (normalizedKey.includes("active") || normalizedKey.includes("stillpending")) {
    return { focusSection: "File details" };
  }
  return { focusSection: "Timeline" };
}

function getMilestoneClearingSearchTarget(name: string): AnalyticsSearchTarget | undefined {
  const normalized = normalizeMilestoneName(name);
  if (normalized === "billpreparation") {
    return {
      dashboardFilter: "manualMilestoneCompleted:Bill preparation",
      focusSection: "Supply order and payment",
      focusTarget: "billpreparation:completed",
    };
  }
  if (normalized === "billsentforpayment" || normalized === "billsenttocda") {
    return {
      dashboardFilter: "manualMilestoneCompleted:Bill sent for payment",
      focusSection: "Supply order and payment",
      focusTarget: "billsentforpayment:completed",
    };
  }
  if (normalized === "billreturnedforcorrection") {
    return {
      dashboardFilter: "billReturn:resubmitted",
      focusSection: "Supply order and payment",
      focusTarget: "billreturnedforcorrection:resubmitted",
    };
  }
  if (normalized === "supplementarybillreturnedforcorrection") {
    return {
      dashboardFilter: "supplementaryBill:resubmitted",
      focusSection: "Supply order and payment",
      focusTarget: "supplementarybill:resubmitted",
    };
  }
  if (normalized === "delivery") return { dashboardFilter: "deliveryCompleted" };
  if (normalized === "payment") return { dashboardFilter: "milestoneCleared:payment" };
  const milestone = milestoneDefinitions.find(
    (item) => normalizeMilestoneName(item.label) === normalized,
  );
  if (milestone) return { dashboardFilter: `milestoneCleared:${milestone.key}` };
  return undefined;
}

function getMilestoneClearingSearchFocus(
  name: string,
  target: AnalyticsSearchTarget,
): Pick<AnalyticsSearchTarget, "focusSection" | "focusMilestone" | "focusTarget"> {
  if (target.focusSection || target.focusMilestone || target.focusTarget) {
    return {
      focusSection: target.focusSection,
      focusMilestone: target.focusMilestone,
      focusTarget: target.focusTarget,
    };
  }
  const normalized = normalizeMilestoneName(name);
  if (normalized === "scrutiny" || normalized === "controlling") {
    return { focusSection: "Scrutiny and control" };
  }
  if (
    normalized === "highvalue" ||
    normalized === "pretcec" ||
    normalized === "ad" ||
    normalized === "rqa" ||
    normalized === "ifa" ||
    normalized === "cfa" ||
    normalized === "posttcec" ||
    normalized === "cnc"
  ) {
    return { focusSection: normalized.includes("tcec") ? "TCEC block" : "Approval block" };
  }
  if (normalized === "bidding") return { focusSection: "Bidding details" };
  return { focusSection: "Supply order and payment" };
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

function formatAnomalyScope(scope: string | undefined) {
  return scope === "universal" ? "Universal" : "File";
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
  if (
    value ===
    "stagedeliveryperiodsoverlapacceptableifstagesruninparallelacceptthisanomalyforthisfileifintentional"
  ) {
    return "Stage delivery periods overlap";
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

const anomalyWorkflowTabHelp: Record<AnomalyWorkflowTab, string> = {
  current:
    "Current suspected anomalies still affecting the selected files, including rejected or revoked items if the data issue still exists.",
  sent: "Requests/messages raised for Admin review and still awaiting decision.",
  fileAccepted: "Admin accepted the exception for that specific file only.",
  universalAccepted: "Admin accepted the exception as a general rule for all matching files.",
  rejected: "Admin did not accept the request and sent it back for correction.",
  revoked: "Earlier accepted exception was withdrawn, so the anomaly can appear again.",
};

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
  const currentRows = rows.filter((row) => row.requestStatus !== "pending");
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
  const currentGroups = groupSuspectedAnomalyRows(currentRows);
  const sentGroups = groupSuspectedAnomalyRows(sentRows);
  const decisionGroups = groupAnomalyAcceptances(decisionRows);
  const currentRowNumberBySignature = new Map(
    currentGroups.flatMap((group) => group.items).map((row, index) => [row.signature, index + 1]),
  );
  const sentRowNumberBySignature = new Map(
    sentGroups.flatMap((group) => group.items).map((row, index) => [row.signature, index + 1]),
  );
  const decisionRowNumberBySignature = new Map(
    decisionGroups.flatMap((group) => group.items).map((row, index) => [row.signature, index + 1]),
  );
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
        {(tab === "sent" ? sentGroups : currentGroups).map((group) => (
          <div key={group.title} className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/40 px-3 py-2">
              <h3 className="text-sm font-semibold">{group.title}</h3>
              <span className="text-xs text-muted-foreground">{group.items.length} file(s)</span>
            </div>
            <div className="divide-y divide-border/70">
              {group.items.map((row) => (
                <div
                  key={row.signature}
                  className="grid gap-3 px-3 py-3 text-xs md:grid-cols-[3rem_1.2fr_2fr_1.4fr]"
                >
                  <div className="font-semibold text-muted-foreground">
                    {tab === "sent"
                      ? sentRowNumberBySignature.get(row.signature)
                      : currentRowNumberBySignature.get(row.signature)}
                  </div>
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
                        {isAdmin
                          ? `Message from ${row.requestedByName || "User"}`
                          : "Message to Admin"}
                        : {row.userExplanation}
                      </div>
                    ) : null}
                    {row.adminMessage ? (
                      <div className="font-medium text-destructive">
                        Message to User: {row.adminMessage}
                      </div>
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
                        <button
                          type="button"
                          onClick={() => onAdminReview(row.signature, "approve_file")}
                          className="rounded border border-border px-2 py-1 font-semibold hover:bg-accent"
                        >
                          Accept file
                        </button>
                        <button
                          type="button"
                          onClick={() => onAdminReview(row.signature, "approve_universal")}
                          className="rounded border border-border px-2 py-1 font-semibold hover:bg-accent"
                        >
                          Accept universal
                        </button>
                        <button
                          type="button"
                          onClick={() => onAdminReview(row.signature, "reject")}
                          className="rounded border border-border px-2 py-1 font-semibold hover:bg-accent"
                        >
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
        {decisionGroups.map((group) => (
          <div key={group.title} className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/40 px-3 py-2">
              <h3 className="text-sm font-semibold">{group.title}</h3>
              <span className="text-xs text-muted-foreground">{group.items.length} file(s)</span>
            </div>
            <div className="divide-y divide-border/70">
              {group.items.map((row) => (
                <div
                  key={row.signature}
                  className="grid gap-3 px-3 py-3 text-xs md:grid-cols-[3rem_1.1fr_2fr_1fr]"
                >
                  <div className="font-semibold text-muted-foreground">
                    {decisionRowNumberBySignature.get(row.signature)}
                  </div>
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
                    <span className="font-semibold">
                      {row.fileRef || "File reference not available"}
                    </span>
                  </div>
                  <div>
                    <div>
                      {row.previousField || "Expected"}: {row.previousValue || "-"}
                    </div>
                    <div>
                      {row.laterField || "Found"}: {row.laterValue || "-"}
                    </div>
                    {row.reason ? (
                      <div className="mt-1 text-muted-foreground">
                        {isAdmin
                          ? `Message from ${row.requestedByName || "User"}`
                          : "Message to Admin"}
                        : {row.reason}
                      </div>
                    ) : null}
                    {row.adminMessage ? (
                      <div className="mt-1 font-medium text-destructive">
                        Message to User: {row.adminMessage}
                      </div>
                    ) : null}
                  </div>
	                  <div>
	                    <div className="font-medium">{formatAnomalyStatus(row.status)}</div>
	                    <div className="text-muted-foreground">
	                      {formatAnomalyScope(row.scope)} decision
	                    </div>
	                    <div className="text-muted-foreground">
	                      {row.reviewedByName || row.revokedByName || row.requestedByName || "-"}
	                    </div>
                    <div className="text-muted-foreground">
                      {(row.reviewedAt || row.revokedAt || row.requestedAt || "").slice(0, 10)}
                    </div>
                    {isAdmin &&
                    (row.status === "approved_file" || row.status === "approved_universal") ? (
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
        <TooltipProvider delayDuration={150}>
          {tabs.map((item) => (
            <div key={item.key} className="inline-flex overflow-hidden rounded-md border border-border">
              <button
                type="button"
                onClick={() => setTab(item.key)}
                className={
                  "px-3 py-1.5 text-xs font-semibold " +
                  (tab === item.key ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")
                }
              >
                {item.label} ({item.count})
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${item.label} help`}
                    className={
                      "inline-flex w-7 items-center justify-center border-l border-border text-xs " +
                      (tab === item.key
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground")
                    }
                  >
                    <Info className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  align="start"
                  className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
                >
                  {anomalyWorkflowTabHelp[item.key]}
                </TooltipContent>
              </Tooltip>
            </div>
          ))}
        </TooltipProvider>
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
  getColumnTotalSearchTarget,
  onOpenSearchTarget,
}: {
  columns: AnalyticsTableColumn[];
  rows: Array<Record<string, number | string>>;
  getCellSearchTarget?: (
    row: Record<string, number | string>,
    column: AnalyticsTableColumn,
  ) => AnalyticsSearchTarget | undefined;
  getColumnTotalSearchTarget?: (column: AnalyticsTableColumn) => AnalyticsSearchTarget | undefined;
  onOpenSearchTarget?: (target: AnalyticsSearchTarget) => void;
}) {
  if (!rows.length) {
    return <div className="text-sm text-muted-foreground">No data available.</div>;
  }
  const groupedHeaders = getAnalyticsGroupedHeaders(columns);
  const hasGroupedHeaders = groupedHeaders.some((header) => header.group);
  const totalCells = getAnalyticsTotalCells(columns, rows, getColumnTotalSearchTarget);
  const showTotalFooter =
    Boolean(onOpenSearchTarget) &&
    totalCells.some((cell, index) => index > 0 && cell.searchTarget && cell.value !== "0");

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
                {groupedHeaders.map((header, index) => (
                  <th
                    key={header.key}
                    colSpan={header.colSpan}
                    rowSpan={header.group ? 1 : 2}
                    className={
                      "px-3 py-2 font-medium " +
                      getAnalyticsHeaderSectionClass(
                        header.group,
                        groupedHeaders[index - 1]?.group,
                      ) +
                      (header.align === "left" ? "text-left" : "text-center")
                    }
                  >
                    {header.label}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                {columns
                  .map((column, index) => ({ column, index }))
                  .filter(({ column }) => column.group)
                  .map(({ column, index }) => (
                    <th
                      key={column.key}
                      className={
                        "px-3 py-2 text-center font-medium " +
                        getAnalyticsColumnSectionClass(column, columns[index - 1])
                      }
                    >
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
              {columns.map((column, columnIndex) => {
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
                      getAnalyticsColumnSectionClass(column, columns[columnIndex - 1]) +
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
        {showTotalFooter ? (
          <tfoot>
            <tr className="border-t border-border bg-muted/40 font-semibold">
              {totalCells.map((cell, index) => (
                <td
                  key={columns[index]?.key ?? index}
                  className={
                    "whitespace-pre-line px-3 py-2 tabular-nums " +
                    getAnalyticsColumnSectionClass(columns[index], columns[index - 1]) +
                    ((columns[index]?.align ?? "right") === "left"
                      ? "text-left font-medium"
                      : "text-center")
                  }
                >
                  {cell.searchTarget &&
                  onOpenSearchTarget &&
                  (index === 0 || cell.value !== "0") ? (
                    <button
                      type="button"
                      onClick={() => onOpenSearchTarget(cell.searchTarget!)}
                      className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10"
                    >
                      {cell.value}
                    </button>
                  ) : (
                    cell.value
                  )}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function getAnalyticsHeaderSectionClass(
  group: string | undefined,
  previousGroup: string | undefined,
) {
  if (!group) return "";
  const tint = getAnalyticsSectionTintClass(group);
  const divider = previousGroup !== group ? "border-l border-border " : "";
  return `${divider}${tint}`;
}

function getAnalyticsColumnSectionClass(
  column: AnalyticsTableColumn | undefined,
  previousColumn: AnalyticsTableColumn | undefined,
) {
  const group = column?.group;
  if (!group) return "";
  const tint = getAnalyticsSectionTintClass(group);
  const divider = previousColumn?.group !== group ? "border-l border-border " : "";
  return `${divider}${tint}`;
}

function getAnalyticsSectionTintClass(group: string) {
  const normalizedGroup = group.toLowerCase();
  if (normalizedGroup.includes("value")) return "bg-muted/30 ";
  return "bg-muted/10 ";
}

function getAnalyticsTotalCells(
  columns: AnalyticsTableColumn[],
  rows: Array<Record<string, number | string>>,
  getColumnTotalSearchTarget?: (column: AnalyticsTableColumn) => AnalyticsSearchTarget | undefined,
) {
  const numericCells = columns.slice(1).map((column) => {
    const total = rows.reduce((sum, row) => {
      const value = Number(row[column.key] ?? 0);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
    const formattedValue = column.format ? column.format(total, {}) : String(total);
    return {
      value: formattedValue,
      searchTarget: getColumnTotalSearchTarget?.(column),
    };
  });
  const primaryTotalTarget = numericCells.find(
    (cell) => cell.searchTarget && cell.value !== "0",
  )?.searchTarget;
  return [{ value: "Total", searchTarget: primaryTotalTarget }, ...numericCells];
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
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          First
        </button>
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
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
          className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          Last
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
  onRefloatLiveBidsClick,
  onRefloatInProcessBidsClick,
  onRefloatBidOverdueClick,
  onLiveSupplyOrdersClick,
  onFinancialSanctionPendingClick,
  onFinancialSanctionCompletedClick,
  onBgExpiredClick,
  onBgToBeReturnedClick,
  onBgReturnedClick,
  onAdvancePaidClick,
  onAdvancePendingClick,
  onPaymentDueClick,
  onPaymentInProcessClick,
  onPaymentSubmittedClick,
  onBillsReturnedClick,
  onReturnedBillsPendingClick,
  onReturnedBillsResubmittedClick,
  onReturnedBillsPaidClick,
  onSupplementaryPendingClick,
  onSupplementaryReturnedClick,
  onSupplementaryReturnedPendingClick,
  onSupplementaryResubmittedClick,
  onSupplementaryPaidClick,
  onReturnedSupplementaryPaidClick,
  onSupplementaryPaymentPendingClick,
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
    paymentDue?: number;
    paymentInProcess?: number;
    paymentSubmitted?: number;
    billsReturnedForCorrection?: number;
    returnedBillsPending?: number;
    returnedBillsResubmitted?: number;
    returnedBillsPaid?: number;
    supplementarySubmitted?: number;
    supplementaryPending?: number;
    supplementaryReturnedForCorrection?: number;
    supplementaryReturnedPending?: number;
    supplementaryReturnedResubmitted?: number;
    supplementaryPaid?: number;
    supplementaryNormalPaid?: number;
    supplementaryReturnedPaid?: number;
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
  onRefloatLiveBidsClick?: () => void;
  onRefloatInProcessBidsClick?: () => void;
  onRefloatBidOverdueClick?: () => void;
  onLiveSupplyOrdersClick: () => void;
  onFinancialSanctionPendingClick: () => void;
  onFinancialSanctionCompletedClick: () => void;
  onBgExpiredClick: () => void;
  onBgToBeReturnedClick: () => void;
  onBgReturnedClick: () => void;
  onAdvancePaidClick: () => void;
  onAdvancePendingClick: () => void;
  onPaymentDueClick: () => void;
  onPaymentInProcessClick: () => void;
  onPaymentSubmittedClick: () => void;
  onBillsReturnedClick: () => void;
  onReturnedBillsPendingClick: () => void;
  onReturnedBillsResubmittedClick: () => void;
  onReturnedBillsPaidClick: () => void;
  onSupplementaryPendingClick: () => void;
  onSupplementaryReturnedClick?: () => void;
  onSupplementaryReturnedPendingClick?: () => void;
  onSupplementaryResubmittedClick?: () => void;
  onSupplementaryPaidClick: () => void;
  onReturnedSupplementaryPaidClick?: () => void;
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
    onRefloatLiveBidsClick,
    onRefloatInProcessBidsClick,
    onRefloatBidOverdueClick,
    onLiveSupplyOrdersClick,
    onFinancialSanctionPendingClick,
    onFinancialSanctionCompletedClick,
    onBgExpiredClick,
    onBgToBeReturnedClick,
    onBgReturnedClick,
    onAdvancePaidClick,
    onAdvancePendingClick,
    onPaymentDueClick,
    onPaymentInProcessClick,
    onPaymentSubmittedClick,
    onBillsReturnedClick,
    onReturnedBillsPendingClick,
    onReturnedBillsResubmittedClick,
    onReturnedBillsPaidClick,
    onSupplementaryPendingClick,
    onSupplementaryReturnedClick,
    onSupplementaryReturnedPendingClick,
    onSupplementaryResubmittedClick,
    onSupplementaryPaidClick,
    onReturnedSupplementaryPaidClick,
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
              <span className="block truncate text-sm font-semibold">
                {getWorkflowDisplayLabel(milestone.label)}
              </span>
            </span>
          </span>
          {milestone.key === "payment" ? (
            <PaymentMetricGrid metrics={metrics} tone={tone} />
          ) : (
            <GroupedStatusMetricGrid
              metrics={metrics}
              tone={tone}
              fallbackClassName={metricGridClass}
            />
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

function PaymentMetricGrid({
  metrics,
  tone,
}: {
  metrics: StatusMetric[];
  tone: ReturnType<typeof getMilestoneTone>;
}) {
  const metricByLabel = new Map(metrics.map((metric) => [metric.label.toLowerCase(), metric]));
  const findMetric = (label: string) => metricByLabel.get(label.toLowerCase()) ?? { label, count: 0 };
  const relabelMetric = (fromLabel: string, toLabel: string) => {
    const metric = findMetric(fromLabel);
    return { ...metric, label: toLabel };
  };
  const rows = [
    {
      label: "Payment counters",
      className: "grid-cols-2 sm:grid-cols-4",
      metrics: [
        findMetric("Due"),
        findMetric("In process"),
        findMetric("Submitted and unpaid"),
        findMetric("Completed"),
      ],
    },
    {
      label: "",
      className: "grid-cols-2",
      metrics: [findMetric("Advance Pending"), relabelMetric("Advance Paid", "Advance Completed")],
    },
    {
      label: "",
      className: "grid-cols-2 sm:grid-cols-4",
      metrics: [
        findMetric("Bills returned"),
        findMetric("Return pending"),
        findMetric("Resubmitted"),
        findMetric("Returned paid"),
      ],
    },
  ];
  return (
    <span className="grid gap-1.5">
      {rows.map((row, index) => (
        <span key={index} className="grid gap-1.5">
          {row.label ? (
            <span className="text-[10px] font-semibold uppercase leading-tight text-muted-foreground">
              {row.label}
            </span>
          ) : null}
          <span className={"grid gap-1.5 " + row.className}>
            {row.metrics.map((metric) => (
              <StatusMetricBox key={metric.label} metric={metric} tone={tone} />
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

function SupplementaryBillFlowNode({
  milestone,
  index,
  isLast,
  onSupplementaryPendingClick,
  onSupplementaryReturnedClick,
  onSupplementaryReturnedPendingClick,
  onSupplementaryResubmittedClick,
  onSupplementaryPaidClick,
  onReturnedSupplementaryPaidClick,
  onSupplementaryPaymentPendingClick,
}: {
  milestone: {
    supplementarySubmitted?: number;
    supplementaryPending?: number;
    supplementaryReturnedForCorrection?: number;
    supplementaryReturnedPending?: number;
    supplementaryReturnedResubmitted?: number;
    supplementaryPaid?: number;
    supplementaryNormalPaid?: number;
    supplementaryReturnedPaid?: number;
  };
  index: number;
  isLast: boolean;
  onSupplementaryPendingClick: () => void;
  onSupplementaryReturnedClick: () => void;
  onSupplementaryReturnedPendingClick: () => void;
  onSupplementaryResubmittedClick: () => void;
  onSupplementaryPaidClick: () => void;
  onReturnedSupplementaryPaidClick: () => void;
  onSupplementaryPaymentPendingClick: () => void;
}) {
  const pending = milestone.supplementaryPending ?? 0;
  const tone = getMilestoneTone(pending);
  const metrics: StatusMetric[] = [
    {
      label: "Submitted total",
      count: milestone.supplementarySubmitted ?? 0,
      onClick: onSupplementaryPendingClick,
      testId: "status-counter-payment-supplementary-submitted",
      statusKind: "history",
    },
    {
      label: "Returned total",
      count: milestone.supplementaryReturnedForCorrection ?? 0,
      onClick: onSupplementaryReturnedClick,
      testId: "status-counter-payment-supplementary-returned",
      statusKind: "history",
    },
    {
      label: "Return pending",
      count: milestone.supplementaryReturnedPending ?? 0,
      onClick: onSupplementaryReturnedPendingClick,
      testId: "status-counter-payment-supplementary-return-pending",
      statusKind: "live",
    },
    {
      label: "Resubmitted total",
      count: milestone.supplementaryReturnedResubmitted ?? 0,
      onClick: onSupplementaryResubmittedClick,
      testId: "status-counter-payment-supplementary-resubmitted",
      statusKind: "history",
    },
    {
      label: "Returned paid",
      count: milestone.supplementaryReturnedPaid ?? 0,
      onClick: onReturnedSupplementaryPaidClick,
      testId: "status-counter-payment-supplementary-returned-paid",
      statusKind: "history",
    },
    {
      label: "Normal paid",
      count: milestone.supplementaryNormalPaid ?? milestone.supplementaryPaid ?? 0,
      onClick: onSupplementaryPaidClick,
      testId: "status-counter-payment-supplementary-paid",
      statusKind: "history",
    },
    {
      label: "Pending",
      count: milestone.supplementaryPending ?? 0,
      onClick: onSupplementaryPaymentPendingClick,
      testId: "status-counter-payment-supplementary-pending",
      statusKind: "live",
    },
  ];

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
              <span className="block truncate text-sm font-semibold">Supplementary Bill</span>
            </span>
          </span>
          <span className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {metrics.map((metric) => (
              <StatusMetricBox key={metric.label} metric={metric} tone={tone} />
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

function GroupedStatusMetricGrid({
  metrics,
  tone,
  fallbackClassName,
}: {
  metrics: StatusMetric[];
  tone: ReturnType<typeof getMilestoneTone>;
  fallbackClassName: string;
}) {
  const active = metrics.find((metric) => metric.toneCount);
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
      <span className="flex items-center justify-center gap-1 text-[9px] font-medium uppercase leading-tight text-muted-foreground">
        <span>{metric.label}</span>
        {getStatusMetricTooltip(metric) ? <InlineInfoIcon /> : null}
      </span>
      <span className={(compact ? "text-sm" : "text-base") + " block font-semibold tabular-nums"}>
        {metric.count}
      </span>
    </>
  );
  const baseClass =
    "min-h-12 rounded-md border border-border px-2 py-1.5 text-center transition hover:ring-2 hover:ring-ring/30 " +
    (className ?? "bg-card hover:bg-accent");
  const tooltip = getStatusMetricTooltip(metric);
  const wrapWithTooltip = (element: ReactElement) =>
    tooltip ? (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>{element}</TooltipTrigger>
          <TooltipContent
            side="top"
            align="center"
            className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
          >
            {Array.isArray(tooltip) ? <HelperBulletList items={tooltip} /> : tooltip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : (
      element
    );

  if (!metric.onClick) {
    return wrapWithTooltip(
      <div className={baseClass.replace(" hover:ring-2 hover:ring-ring/30", "")}>{content}</div>,
    );
  }

  return wrapWithTooltip(
    <button
      type="button"
      onClick={metric.onClick}
      data-testid={metric.testId}
      className={baseClass}
    >
      {content}
    </button>,
  );
}

function getStatusMetricHelp(milestoneKey: string, label: string): string | string[] | undefined {
  const normalizedLabel = normalizeMilestoneName(label);
  if (milestoneKey === "bidding") {
    if (normalizedLabel === "live") {
      return [
        "CFA approval date exists, bidding is applicable, Tender Live is Yes, and Bidding Stage Over is not Yes.",
        "Files only live on tender portal are not counted unless the file has entered bidding through CFA.",
        "Cancelled demand and File Closed are excluded from this live counter.",
      ];
    }
    if (normalizedLabel === "inprocess") {
      return [
        "CFA approval date exists and Bidding Stage Over is not Yes.",
        "Tender Live is not Yes and bid opening is not overdue.",
      ];
    }
    if (normalizedLabel === "openingoverdue") {
      return [
        "Bidding is applicable and bid opening date has passed while Bid Opened is not Yes.",
        "This is still inside bidding until Bidding Stage Over is Yes.",
      ];
    }
    if (normalizedLabel === "completed") {
      return "Bidding Stage Over is Yes.";
    }
    if (normalizedLabel === "atpreviousstage" || normalizedLabel === "atpreviousstages") {
      return "Files eligible for bidding but not yet inside live/in-process/overdue bidding.";
    }
  }

  if (milestoneKey === "refloatBidding") {
    if (normalizedLabel === "live") {
      return [
        "Refloat is Yes, refloat bidding date exists, Tender Live is Yes, and Bidding Stage Over is not Yes.",
        "This mirrors normal bidding live logic for refloat cases.",
      ];
    }
    if (normalizedLabel === "inprocess") {
      return [
        "Refloat is Yes and refloat bidding date exists.",
        "Tender Live is not Yes, refloat bid opening is not overdue, and Bidding Stage Over is not Yes.",
      ];
    }
    if (normalizedLabel === "openingoverdue") {
      return "Refloat bid opening date has passed while bidding is still not over.";
    }
  }

  if (milestoneKey === "supplyOrder") {
    if (normalizedLabel === "placed" || normalizedLabel === "completed") {
      return [
        "File has reached Supply Order placement.",
        "This is file based: multiple S.O.s in one file count once.",
        "For Status-4/order-placement history, cancelled S.O. does not remove the file from placed count.",
      ];
    }
    if (normalizedLabel === "live") {
      return [
        "S.O. exists and the effective D.P. is still today or later.",
        "Cancelled S.O. rows are excluded. Shortclosed S.O. rows are treated like concluded S.O.s; only curtailed future delivery/payment work is ignored.",
      ];
    }
    if (normalizedLabel === "pending") {
      return "Files currently waiting at Supply Order stage after financial sanction.";
    }
  }

  if (isBgMilestoneKey(milestoneKey)) {
    if (normalizedLabel === "tobereceived" || normalizedLabel === "pending") {
      return "BG is applicable and receipt is still pending for that BG category.";
    }
    if (normalizedLabel === "expired") {
      return "BG validity date is before today and the BG has not been returned.";
    }
    if (normalizedLabel === "tobereturned") {
      return "BG return is due because S.O. is cancelled/shortclosed or warranty plus buffer has crossed.";
    }
    if (normalizedLabel === "returned") {
      return "BG return date is filled.";
    }
  }

  if (milestoneKey === "payment") {
    if (normalizedLabel === "due") {
      return [
        "Payment workflow has become due, but bill preparation date and bill sent for payment date are still blank.",
        "For physical delivery/inspection files, due starts after material receipt.",
        "For Goods & Services where IR is No, due starts after Job Completion.",
        "For AMC/MPC/CARS/CAPSI/O&M contract files, due can start from D.P./Revised D.P.; Job Completion can also trigger it when service is completed earlier.",
        "One file can contribute more than one payment case when it has multiple payable stages.",
        "This does not mean the bill is already with payment authority; that is counted separately under Submitted and unpaid.",
      ];
    }
    if (normalizedLabel === "inprocess") {
      return "Bill preparation date exists but bill sent for payment date is still blank.";
    }
    if (normalizedLabel === "submitted" || normalizedLabel === "submittedandunpaid") {
      return "Bill sent for payment date exists and payment date is still blank.";
    }
    if (normalizedLabel === "completed") {
      return "Payment date exists.";
    }
  }

  if (normalizedLabel === "total" || normalizedLabel === "totalfiles") {
    return "Applicable files/cases for this milestone under the selected Dashboard filters.";
  }
  if (normalizedLabel === "completed" || normalizedLabel === "cleared") {
    return "Files/cases where this milestone is already completed.";
  }
  if (normalizedLabel === "pending") {
    return "Files/cases currently pending at this milestone.";
  }
  if (normalizedLabel === "reviewed") {
    return "Review/sent date exists but final completion for the milestone is still pending.";
  }
  if (normalizedLabel === "atpreviousstage") {
    return "Eligible files that have not yet reached this milestone.";
  }
  return undefined;
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
  onRefloatLiveBidsClick,
  onRefloatInProcessBidsClick,
  onRefloatBidOverdueClick,
  onLiveSupplyOrdersClick,
  onFinancialSanctionPendingClick,
  onFinancialSanctionCompletedClick,
  onBgExpiredClick,
  onBgToBeReturnedClick,
  onBgReturnedClick,
  onAdvancePaidClick,
  onAdvancePendingClick,
  onPaymentDueClick,
  onPaymentInProcessClick,
  onPaymentSubmittedClick,
  onBillsReturnedClick,
  onReturnedBillsPendingClick,
  onReturnedBillsResubmittedClick,
  onReturnedBillsPaidClick,
  onSupplementaryPendingClick,
  onSupplementaryReturnedClick,
  onSupplementaryReturnedPendingClick,
  onSupplementaryResubmittedClick,
  onSupplementaryPaidClick,
  onReturnedSupplementaryPaidClick,
  onSupplementaryPaymentPendingClick,
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
    paymentDue?: number;
    paymentInProcess?: number;
    paymentSubmitted?: number;
    billsReturnedForCorrection?: number;
    returnedBillsPending?: number;
    returnedBillsResubmitted?: number;
    returnedBillsPaid?: number;
    supplementarySubmitted?: number;
    supplementaryPending?: number;
    supplementaryReturnedForCorrection?: number;
    supplementaryReturnedPending?: number;
    supplementaryReturnedResubmitted?: number;
    supplementaryPaid?: number;
    supplementaryNormalPaid?: number;
    supplementaryReturnedPaid?: number;
  };
  onTotalClick: () => void;
  onUnderProcessClick: () => void;
  onActiveClick: () => void;
  onReviewedClick: () => void;
  onPendingClick: () => void;
  onClearedClick: () => void;
  onLiveBidsClick: () => void;
  onBidOverdueClick: () => void;
  onRefloatLiveBidsClick?: () => void;
  onRefloatInProcessBidsClick?: () => void;
  onRefloatBidOverdueClick?: () => void;
  onLiveSupplyOrdersClick: () => void;
  onFinancialSanctionPendingClick: () => void;
  onFinancialSanctionCompletedClick: () => void;
  onBgExpiredClick: () => void;
  onBgToBeReturnedClick: () => void;
  onBgReturnedClick: () => void;
  onAdvancePaidClick: () => void;
  onAdvancePendingClick: () => void;
  onPaymentDueClick: () => void;
  onPaymentInProcessClick: () => void;
  onPaymentSubmittedClick: () => void;
  onBillsReturnedClick: () => void;
  onReturnedBillsPendingClick: () => void;
  onReturnedBillsResubmittedClick: () => void;
  onReturnedBillsPaidClick: () => void;
  onSupplementaryPendingClick?: () => void;
  onSupplementaryReturnedClick?: () => void;
  onSupplementaryReturnedPendingClick?: () => void;
  onSupplementaryResubmittedClick?: () => void;
  onSupplementaryPaidClick?: () => void;
  onReturnedSupplementaryPaidClick?: () => void;
  onSupplementaryPaymentPendingClick?: () => void;
}): StatusMetric[] {
  const total = {
    label: milestone.totalLabel,
    count: milestone.total,
    onClick: onTotalClick,
    statusKind: "history" as const,
    help: getStatusMetricHelp(milestone.key, milestone.totalLabel),
  };
  const completed = {
    label: milestone.completedLabel,
    count: milestone.cleared,
    onClick: onClearedClick,
    statusKind: "history" as const,
    help: getStatusMetricHelp(milestone.key, milestone.completedLabel),
  };
  const previous = {
    label: "At previous stage",
    count: milestone.underProcess,
    onClick: onUnderProcessClick,
    statusKind: "live" as const,
    help: getStatusMetricHelp(milestone.key, "At previous stage"),
  };
  const active = {
    label: milestone.activeLabel,
    count: milestone.active,
    onClick: onActiveClick,
    toneCount: true,
    statusKind: "live" as const,
    help: getStatusMetricHelp(milestone.key, milestone.activeLabel),
  };
  const reviewed = {
    label: "Reviewed",
    count: milestone.reviewed,
    onClick: onReviewedClick,
    statusKind: "live" as const,
    help: getStatusMetricHelp(milestone.key, "Reviewed"),
  };
  const pending = {
    label: milestone.pendingLabel,
    count: milestone.pending,
    onClick: onPendingClick,
    statusKind: "live" as const,
    help: getStatusMetricHelp(milestone.key, milestone.pendingLabel),
  };

  if (milestone.key === "scrutiny" || milestone.key === "cfa") {
    return [active, reviewed, pending, total, completed];
  }

  if (["highValue", "tcec", "control"].includes(milestone.key)) {
    return [total, completed, active, reviewed, pending];
  }

  if (["ifa", "postTcec", "cnc"].includes(milestone.key)) {
    return [total, completed, previous, active, reviewed, pending];
  }

  if (milestone.key === "refloatBidding") {
    return [
      {
        label: "Live",
        count: milestone.liveBids ?? 0,
        onClick: onRefloatLiveBidsClick,
        statusKind: "live" as const,
        help: getStatusMetricHelp(milestone.key, "Live"),
      },
      {
        label: "In process",
        count: milestone.inProcessBids ?? 0,
        onClick: onRefloatInProcessBidsClick,
        statusKind: "live" as const,
        help: getStatusMetricHelp(milestone.key, "In process"),
      },
      {
        label: "Opening overdue",
        count: milestone.overdueBids ?? 0,
        onClick: onRefloatBidOverdueClick,
        statusKind: "live" as const,
        help: getStatusMetricHelp(milestone.key, "Opening overdue"),
      },
      completed,
    ];
  }

  if (milestone.key === "refloatPostTcec") {
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
        statusKind: "history",
        help: getStatusMetricHelp(milestone.key, "Completed"),
      },
      {
        label: "Pending",
        count: milestone.financialSanctionPending ?? milestone.pending,
        onClick: onFinancialSanctionPendingClick,
        statusKind: "live",
        help: getStatusMetricHelp(milestone.key, "Pending"),
      },
      previous,
    ];
  }

  if (milestone.key === "bidding") {
    return [
      {
        label: "Live",
        count: milestone.liveBids ?? 0,
        onClick: onLiveBidsClick,
        statusKind: "live",
        help: getStatusMetricHelp(milestone.key, "Live"),
      },
      {
        label: "In process",
        count: milestone.inProcessBids ?? 0,
        onClick: onActiveClick,
        statusKind: "live",
        help: getStatusMetricHelp(milestone.key, "In process"),
      },
      {
        label: "Opening overdue",
        count: milestone.overdueBids ?? 0,
        onClick: onBidOverdueClick,
        statusKind: "live",
        help: getStatusMetricHelp(milestone.key, "Opening overdue"),
      },
      completed,
      {
        label: "At previous stages",
        count: milestone.underProcess,
        onClick: onUnderProcessClick,
        statusKind: "live",
        help: getStatusMetricHelp(milestone.key, "At previous stages"),
      },
    ];
  }

  if (milestone.key === "supplyOrder") {
    return [
      completed,
      {
        label: "Live",
        count: milestone.liveSupplyOrders ?? 0,
        onClick: onLiveSupplyOrdersClick,
        statusKind: "live",
        help: getStatusMetricHelp(milestone.key, "Live"),
      },
      {
        label: milestone.pendingLabel,
        count: milestone.pending,
        onClick: onPendingClick,
        statusKind: "live",
        help: getStatusMetricHelp(milestone.key, milestone.pendingLabel),
      },
      {
        label: "At Previous Stage",
        count: milestone.underProcess,
        onClick: onUnderProcessClick,
        statusKind: "live",
        help: getStatusMetricHelp(milestone.key, "At Previous Stage"),
      },
    ];
  }

  if (isBgMilestoneKey(milestone.key)) {
    return [
      {
        label: milestone.pendingLabel,
        count: milestone.pending,
        onClick: onPendingClick,
        statusKind: "live",
        help: getStatusMetricHelp(milestone.key, milestone.pendingLabel),
      },
      completed,
      {
        label: "Expired",
        count: milestone.bgExpired ?? 0,
        onClick: onBgExpiredClick,
        statusKind: "live",
        help: getStatusMetricHelp(milestone.key, "Expired"),
      },
      {
        label: "To be returned",
        count: milestone.bgToBeReturned ?? 0,
        onClick: onBgToBeReturnedClick,
        statusKind: "live",
        help: getStatusMetricHelp(milestone.key, "To be returned"),
      },
      {
        label: "Returned",
        count: milestone.bgReturned ?? 0,
        onClick: onBgReturnedClick,
        statusKind: "history",
        help: getStatusMetricHelp(milestone.key, "Returned"),
      },
    ];
  }

  if (milestone.key === "payment") {
    return [
      {
        label: "Due",
        count: milestone.paymentDue ?? 0,
        onClick: onPaymentDueClick,
        statusKind: "live",
        help: getStatusMetricHelp(milestone.key, "Due"),
      },
      {
        label: "In process",
        count: milestone.paymentInProcess ?? 0,
        onClick: onPaymentInProcessClick,
        statusKind: "live",
        help: getStatusMetricHelp(milestone.key, "In process"),
      },
      {
        label: "Submitted and unpaid",
        count: milestone.paymentSubmitted ?? 0,
        onClick: onPaymentSubmittedClick,
        statusKind: "live",
        help: getStatusMetricHelp(milestone.key, "Submitted and unpaid"),
      },
      completed,
      {
        label: "Advance Paid",
        count: milestone.advancePaid ?? 0,
        onClick: onAdvancePaidClick,
        statusKind: "history",
      },
      {
        label: "Advance Pending",
        count: milestone.advancePending ?? 0,
        onClick: onAdvancePendingClick,
        statusKind: "live",
      },
      {
        label: "Bills returned",
        count: milestone.billsReturnedForCorrection ?? 0,
        onClick: onBillsReturnedClick,
        statusKind: "history",
      },
      {
        label: "Return pending",
        count: milestone.returnedBillsPending ?? 0,
        onClick: onReturnedBillsPendingClick,
        statusKind: "live",
      },
      {
        label: "Resubmitted",
        count: milestone.returnedBillsResubmitted ?? 0,
        onClick: onReturnedBillsResubmittedClick,
        statusKind: "live",
      },
      {
        label: "Returned paid",
        count: milestone.returnedBillsPaid ?? 0,
        onClick: onReturnedBillsPaidClick,
        statusKind: "history",
      },
      {
        label: "Supplementary submitted total",
        count: milestone.supplementarySubmitted ?? 0,
        onClick: onSupplementaryPendingClick,
        testId: "status-counter-payment-supplementary-submitted",
        statusKind: "history",
      },
      {
        label: "Supp. returned total",
        count: milestone.supplementaryReturnedForCorrection ?? 0,
        onClick: onSupplementaryReturnedClick,
        testId: "status-counter-payment-supplementary-returned",
        statusKind: "history",
      },
      {
        label: "Supp. return pending",
        count: milestone.supplementaryReturnedPending ?? 0,
        onClick: onSupplementaryReturnedPendingClick,
        testId: "status-counter-payment-supplementary-return-pending",
        statusKind: "live",
      },
      {
        label: "Supp. resubmitted total",
        count: milestone.supplementaryReturnedResubmitted ?? 0,
        onClick: onSupplementaryResubmittedClick,
        testId: "status-counter-payment-supplementary-resubmitted",
        statusKind: "history",
      },
      {
        label: "Supp. returned paid",
        count: milestone.supplementaryReturnedPaid ?? 0,
        onClick: onReturnedSupplementaryPaidClick,
        testId: "status-counter-payment-supplementary-returned-paid",
        statusKind: "history",
      },
      {
        label: "Normal supplementary paid",
        count: milestone.supplementaryNormalPaid ?? milestone.supplementaryPaid ?? 0,
        onClick: onSupplementaryPaidClick,
        testId: "status-counter-payment-supplementary-paid",
        statusKind: "history",
      },
      {
        label: "Supplementary pending",
        count: milestone.supplementaryPending ?? 0,
        onClick: onSupplementaryPaymentPendingClick,
        testId: "status-counter-payment-supplementary-pending",
        statusKind: "live",
      },
    ];
  }

  return [total, completed, active, previous];
}

function getStatusMetricsForExport(metrics: StatusMetric[], milestoneKey: string) {
  if (milestoneKey !== "scrutiny" && milestoneKey !== "cfa") return metrics;

  const active = metrics.find((metric) => metric.toneCount);
  return [
    metrics.find((metric) => metric.label === "Total files"),
    metrics.find((metric) => metric.label === "Completed"),
    active,
    metrics.find((metric) => metric.label === "Reviewed"),
    metrics.find((metric) => metric.label === "Pending"),
  ]
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
              <span className="block truncate text-sm font-semibold">
                {getWorkflowDisplayLabel(milestone.label)}
              </span>
            </span>
          </span>
          <span className="grid grid-cols-3 gap-1.5">
            <DeliveryPeriodMetricButton
              label="Valid"
              count={milestone.valid}
              onClick={onValidClick}
              help={deliveryPeriodMetricHelpers.valid}
            />
            <DeliveryPeriodMetricButton
              label="Expired"
              count={milestone.expired}
              onClick={onExpiredClick}
              help={deliveryPeriodMetricHelpers.expired}
              className={tone.count}
            />
            <DeliveryPeriodMetricButton
              label="Extended"
              count={milestone.extended}
              onClick={onExtendedClick}
              help={deliveryPeriodMetricHelpers.extended}
            />
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

function DeliveryPeriodMetricButton({
  label,
  count,
  onClick,
  help,
  className,
}: {
  label: string;
  count: number;
  onClick: () => void;
  help: string | string[];
  className?: string;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            className={
              "rounded-md px-2 py-1 text-center hover:ring-2 hover:ring-ring/30 " +
              (className ?? "border border-border bg-card hover:bg-accent")
            }
          >
            <span className="block text-[9px] font-medium uppercase leading-tight text-muted-foreground">
              <span className="inline-flex items-center justify-center gap-1">
                <span>{label}</span>
                <InlineInfoIcon />
              </span>
            </span>
            <span className="block text-base font-semibold tabular-nums">{count}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="center"
          className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg text-xs leading-relaxed"
        >
          <HelperBulletList items={help} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
  const metrics: StatusMetric[] = [
    {
      label: "Delivery Completed",
      count: milestone.completed,
      onClick: onCompletedClick,
      statusKind: "history",
      help: [
        "Includes files/S.O. rows where material receipt is recorded.",
        "Cancelled demand files are excluded.",
        "Cancelled S.O. rows are excluded. Shortclosed S.O. rows remain included when delivery/job completion history exists.",
      ],
    },
    {
      label: "Delivery Pending",
      count: milestone.due,
      onClick: onDueClick,
      statusKind: "live",
      help: [
        "Includes files/S.O. rows where delivery is still pending and effective D.P. is today or later.",
        "Today is counted as valid.",
        "Delivered material and cancelled S.O. rows are excluded. Shortclosed S.O. rows remain due only if pending delivery/work still exists.",
      ],
    },
    {
      label: "Delivery Overdue",
      count: milestone.overdue,
      onClick: onOverdueClick,
      statusKind: "live",
      help: [
        "Includes files/S.O. rows where delivery is still pending and effective D.P. is before today.",
        "Delivered material and cancelled S.O. rows are excluded. Shortclosed S.O. rows remain overdue only if pending delivery/work still exists.",
        "Cancelled demand files are excluded.",
      ],
    },
  ];

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
              <span className="block truncate text-sm font-semibold">
                {getWorkflowDisplayLabel(milestone.label)}
              </span>
            </span>
          </span>
          <span className="flex flex-col gap-1.5">
            <span className="grid grid-cols-3 gap-1.5">
              {metrics.map((metric) => (
                <StatusMetricBox
                  key={metric.label}
                  metric={{
                    ...metric,
                    toneCount: metric.label !== "Delivery Completed",
                  }}
                  tone={metric.label === "Delivery Overdue" ? getMilestoneTone(milestone.overdue) : tone}
                />
              ))}
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
  const metrics: StatusMetric[] = [
    {
      label: "Job Completion Due",
      count: milestone.jobLive,
      onClick: onJobDueClick,
      statusKind: "live",
      help: [
        "Includes work/service S.O. rows where job completion is still pending and the contract/job period is valid today or later.",
        "Today is counted as valid.",
        "Completed jobs and cancelled S.O. rows are excluded. Shortclosed S.O. rows remain due only if pending work still exists.",
      ],
    },
    {
      label: "Job Completion Done",
      count: milestone.jobCompleted,
      onClick: onJobCompletedClick,
      statusKind: "history",
      help: [
        "Includes work/service S.O. rows where job completion is recorded.",
        "Cancelled demand files are excluded.",
        "Cancelled S.O. rows are excluded. Shortclosed S.O. rows remain included when job completion history exists.",
      ],
    },
  ];

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
              <span className="block truncate text-sm font-semibold">
                {getWorkflowDisplayLabel(milestone.label)}
              </span>
            </span>
          </span>
          <span className="grid grid-cols-2 gap-1.5">
            {metrics.map((metric) => (
              <StatusMetricBox
                key={metric.label}
                metric={{
                  ...metric,
                  toneCount: metric.label === "Job Completion Due",
                }}
                tone={tone}
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

function JobCompletionIrFlowNode({
  milestone,
  index,
  isLast,
  onJobCompletedClick,
  onJobDueClick,
  onIrPreparationPendingClick,
  onIrReceiptPendingClick,
  onIrCompletedClick,
}: {
  milestone: {
    key: string;
    label: string;
    jobCompleted: number;
    jobLive: number;
    irPreparationPending: number;
    irReceiptPending: number;
    irCompleted: number;
  };
  index: number;
  isLast: boolean;
  onJobCompletedClick: () => void;
  onJobDueClick: () => void;
  onIrPreparationPendingClick: () => void;
  onIrReceiptPendingClick: () => void;
  onIrCompletedClick: () => void;
}) {
  const tone = getMilestoneTone(
    milestone.jobLive || milestone.irPreparationPending || milestone.irReceiptPending,
  );
  const jobMetrics: StatusMetric[] = [
    {
      label: "Job Completion Due",
      count: milestone.jobLive,
      onClick: onJobDueClick,
      statusKind: "live",
    },
    {
      label: "Job Completion Done",
      count: milestone.jobCompleted,
      onClick: onJobCompletedClick,
      statusKind: "history",
    },
  ];
  const irMetrics: StatusMetric[] = [
    {
      label: "IR Preparation Pending",
      count: milestone.irPreparationPending,
      onClick: onIrPreparationPendingClick,
      statusKind: "live",
    },
    {
      label: "IR Receipt Pending",
      count: milestone.irReceiptPending,
      onClick: onIrReceiptPendingClick,
      statusKind: "live",
    },
    {
      label: "IR Completed",
      count: milestone.irCompleted,
      onClick: onIrCompletedClick,
      statusKind: "history",
    },
  ];

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
              <span className="block truncate text-sm font-semibold">Job Completion / IR</span>
            </span>
          </span>
          <span className="grid gap-1.5">
            <span className="grid grid-cols-2 gap-1.5">
              {jobMetrics.map((metric) => (
                <StatusMetricBox key={metric.label} metric={metric} tone={tone} />
              ))}
            </span>
            <span className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              {irMetrics.map((metric) => (
                <StatusMetricBox key={metric.label} metric={metric} tone={tone} />
              ))}
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
        help: getSnapshotAttributeSubMetricHelp(attribute.yesLabel, true, attribute.key),
      },
      {
        label: attribute.noLabel,
        value: files.filter((file) => !isSnapshotAttributeYes(file, attribute.key)).length,
        searchFilter: `attribute:${attribute.key}:no`,
        help: getSnapshotAttributeSubMetricHelp(attribute.noLabel, false, attribute.key),
      },
    ],
    hint: [
      `${attribute.yesLabel} and ${attribute.noLabel} files from the selected Dashboard file set.`,
      attribute.key === "psb"
        ? "PSB is treated as a snapshot statistic, so cancelled S.O. rows remain visible when PSB was applicable."
        : "Cancelled demand files are excluded; File Closed follows the Global Filter; cancelled S.O. and shortclosed S.O. history can remain visible in Snapshot statistics.",
    ],
  }));
}

function getSnapshotAttributeSubMetricHelp(
  label: string,
  expectedYes: boolean,
  key: keyof FileRecord,
): string[] {
  const presence = expectedYes ? "Yes/available" : "No/not available";
  const common = [
    `Includes files where ${label} is ${presence}.`,
    "Cancelled demand files are excluded.",
    "File Closed follows the selected Global Filter.",
  ];
  if (key === "psb") {
    return [
      `Includes files based on PSB applicability in S.O. details.`,
      "Cancelled S.O. rows remain included here because Snapshot is statistical.",
      ...common.slice(1),
    ];
  }
  if (key === "bg") {
    return [
      `Includes files where Warranty is ${presence}.`,
      "Cancelled S.O. rows remain included here because Snapshot is statistical.",
      ...common.slice(1),
    ];
  }
  return [
    ...common,
    "Cancelled S.O. and shortclosed S.O. history can remain visible in Snapshot statistics.",
  ];
}

function isSnapshotAttributeYes(file: FileRecord, key: string) {
  if (key === "psb") return isPsbApplicableFile(file);
  return isYes(String(file[key as keyof FileRecord] ?? ""));
}

function isPsbApplicableFile(file: FileRecord) {
  return rawSupplyOrders(file).some(
    (order) =>
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
      help: [
        `Includes files where File Type is ${fileType}.`,
        "Cancelled demand files are excluded.",
        "File Closed follows the selected Global Filter.",
        "Cancelled S.O. and shortclosed S.O. history can remain visible in Snapshot statistics.",
      ],
    })),
    hint: [
      "Files are grouped by File Type from the selected Dashboard file set.",
      "Custom file types added in Settings are included when they exist in the selected data.",
      "Cancelled demand files are excluded; File Closed follows the Global Filter; cancelled S.O. and shortclosed S.O. history can remain visible in Snapshot statistics.",
    ],
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
    value: getConfiguredFirmTypes(firmTypes, files).map((firmType) => ({
      label: firmType,
      value: files.filter((file) =>
        fileSupplyOrders(file).some((order) => isFirmTypeMatch(order, firmType)),
      ).length,
      searchFilter: `firmType:${encodeURIComponent(firmType)}`,
      help: [
        `Includes files having at least one S.O. row with Firm Type ${firmType}.`,
        "The count is file based: one matching S.O. is enough.",
        "Cancelled demand files are excluded.",
        "Cancelled S.O. and shortclosed S.O. history can remain visible in Snapshot firm statistics.",
      ],
    })),
    hint: [
      "Files are grouped by firm type recorded in S.O. details.",
      "This is firm-side history, so cancelled, closed, and shortclosed S.O. context can remain visible where a firm had an order.",
      "The count is file-based; one matching S.O. firm type is enough for the file to appear in that firm type.",
    ],
  };
}

function getConfiguredFirmTypes(
  firmTypes: string[] | undefined,
  files: ReturnType<typeof useAccessibleFiles> = [],
) {
  const defaults = ["MSE", "MSE (Women)", "Non-MSE"];
  const seen = new Set<string>();
  const existingFirmTypes = files.flatMap((file) => fileSupplyOrders(file).map(getEffectiveFirmType));
  return [...(firmTypes?.length ? firmTypes : defaults), ...existingFirmTypes]
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
  return getEffectiveFirmType(order).toUpperCase() === expected;
}

function getMiscellaneousCounts(files: ReturnType<typeof useAccessibleFiles>) {
  const activeFiles = files.filter((file) => !isCancelledFile(file));
  return {
    liveFiles: activeFiles.filter(isLiveFile).length,
    fileClosed: activeFiles.filter(isFileClosed).length,
    ld: countLdOrders(activeFiles),
    billsReturnedForCorrection: countBillsReturnedForCorrection(activeFiles),
    returnedBillsPending: countReturnedBillsPending(activeFiles),
    returnedBillsResubmitted: countReturnedBillsResubmitted(activeFiles),
    returnedBillsPaid: countReturnedBillsPaid(activeFiles),
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

function countBillsReturnedForCorrection(files: FileRecord[]) {
  return countReturnedBillOrders(files, hasReturnedBill);
}

function countReturnedBillsPending(files: FileRecord[]) {
  return countReturnedBillOrders(files, hasOpenBillReturn);
}

function countReturnedBillsResubmitted(files: FileRecord[]) {
  return countReturnedBillOrders(files, hasCompletedBillReturn);
}

function countReturnedBillsPaid(files: FileRecord[]) {
  return countReturnedBillOrders(files, hasReturnedBillPaid);
}

function countReturnedBillOrders(
  files: FileRecord[],
  predicate: (order: SupplyOrderDetail) => boolean,
) {
  return files.reduce((count, file) => {
    return (
      count +
      normalizedFilePaymentOrders(file).filter(
        (order) => isPaymentOrderActive(file, order) && predicate(order),
      ).length
    );
  }, 0);
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
  selectedYear?: string,
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
    monthWiseBgExpiry: getMonthWiseBgExpiry(files, selectedYear),
    biddingModeMix: getBiddingModeMix(files),
    fileValueThresholds: getFileValueThresholds(files, valueThresholdLevels),
    soValueThresholds: getSupplyOrderValueThresholds(files, valueThresholdLevels),
    divisionRiskRanking: getDivisionRiskRanking(files),
    divisionPaymentPendingRanking: getDivisionPaymentPendingRanking(files),
    tcecStatus: getTcecStatusSummary(files, selectedYear),
    cncSummary: getCncSummary(files, selectedYear),
  };
}

function getCncSummary(files: FileRecord[], selectedYear?: string) {
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
  const activityRange = getFinancialYearDateRange(selectedYear);
  files.forEach((file) => {
    if (!hasFilledString(file.cncDate)) return;
    const cncDate = file.cncDate!;
    if (activityRange && !isDateWithinRange(cncDate, activityRange)) return;
    const approved = hasFilledString(file.cncApprovalDate);
    const financialSanctionSigned = hasOrderFinancialSanctionCompleted(file);
    const supplyOrderPlaced = hasPlacedSupplyOrder(file);
    const current = rows.get(cncDate) ?? {
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
  const totals = new Map<
    string,
    {
      name: string;
      stage: TcecStatusStage;
      fiscalYear: string;
      reviewed: number;
      signed: number;
      pending: number;
    }
  >();
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
  return Array.from(totals.values()).sort(
    (a, b) => b.reviewed - a.reviewed || a.name.localeCompare(b.name),
  );
}

function getTcecStatusSummary(files: FileRecord[], selectedYear?: string) {
  return {
    pre: getTcecStageStatus(files, "pre", selectedYear),
    post: getTcecStageStatus(files, "post", selectedYear),
  };
}

function getTcecStageStatus(files: FileRecord[], stage: TcecStatusStage, selectedYear?: string) {
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
  const activityRange = getFinancialYearDateRange(selectedYear);
  files.forEach((file) => {
    const minutesDate = getTcecMinutesDate(file, stage);
    const meetingDate = getTcecMeetingDate(file, stage);
    if (!hasFilledString(meetingDate) && !hasFilledString(minutesDate)) return;
    const activityDate = meetingDate || minutesDate;
    if (activityRange && !isDateWithinRange(activityDate, activityRange)) return;
    const committee = getTcecCommittee(file, stage) || "Unassigned committee";
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
    const meetingCurrent = meetingRows.get(meetingKey) ?? {
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
    if (isYes(file.demandCancelled)) return;
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
    rawSupplyOrders(file).forEach((order) => {
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
  return firmAnalysisRoleOptions.map((role) => role.key).filter((role) => roles.includes(role));
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
      return nextRole
        ? [roleToken, operators[firmAnalysisOperatorKey(role, nextRole)] ?? "and"]
        : [roleToken];
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
  return role === "bq" ? 1 : role === "invited" ? 2 : role === "participated" ? 4 : 8;
}

function getFileFirmAnalysisRoles(file: FileRecord) {
  const biddingApplicable = isBiddingApplicableForFile(file);
  const bq = biddingApplicable ? getFirmNameSet(file.bqFirms) : new Set<string>();
  const invited = biddingApplicable ? getFirmNameSet(file.invitedFirms) : new Set<string>();
  const participated = biddingApplicable ? getFirmNameSet(file.bidderFirms) : new Set<string>();
  const order = new Set<string>();
  fileSupplyOrders(file).forEach((orderRow) => {
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

type Finance1AmountMetric = {
  count: number;
  capital: number;
  revenue: number;
  total: number;
};

type Finance1FileTypeDistributionRow = {
  fileType: string;
  files: number;
  filesWithSo: number;
  activeAtFyEnd: number;
  closedByFyEnd: number;
  cancelledByFyEnd: number;
  capital: number;
  revenue: number;
  total: number;
};

type Finance1FirmTypeDistributionRow = {
  firmType: string;
  supplyOrders: number;
  capital: number;
  revenue: number;
  total: number;
};

type Finance1Summary = {
  fiscalYear: string;
  cutoffDate: string;
  fileGroupFiles?: FileRecord[];
  drillFileIds?: Record<string, string[]>;
  fileGroup: Finance1AmountMetric;
  fileTypeDistribution: Finance1FileTypeDistributionRow[];
  firmTypeDistribution: Finance1FirmTypeDistributionRow[];
  cancelledByFyEnd: number;
  activeAtFyEnd: number;
  closedByFyEnd: number;
  intendedAtFyEnd: Finance1AmountMetric;
  bookedAtFyEnd: Finance1AmountMetric;
  committedAtFyEnd: Finance1AmountMetric;
  paidByFyEnd: Finance1AmountMetric;
  unpaidLiabilityAtFyEnd: Finance1AmountMetric;
  paidTillDate: Finance1AmountMetric;
  balanceUnpaidToday: Finance1AmountMetric;
  noImmsByFyEnd: number;
  immsDoneSoNotPlacedByFyEnd: number;
  soPlacedByFyEnd: number;
  deliveryJobDoneByFyEnd: number;
  billSentByFyEnd: number;
  paymentCompletedByFyEnd: number;
  advancePendingByFyEnd: number;
  fileClosedByFyEnd: number;
  soPlacedLater: number;
  paymentMadeLater: number;
  fileClosedLater: number;
  stillPendingToday: number;
};

function createFinance1Metric(): Finance1AmountMetric {
  return { count: 0, capital: 0, revenue: 0, total: 0 };
}

function addFinance1Amount(
  metric: Finance1AmountMetric,
  capital: number,
  revenue: number,
  count = 1,
) {
  metric.count += count;
  metric.capital += capital;
  metric.revenue += revenue;
  metric.total += capital + revenue;
}

function getFinance1LiabilityDate(entry: FinancePaymentLiabilityEntry) {
  if (entry.kind === "main" && hasFilledString(entry.order.stageDeliveryLabel)) {
    return entry.order.revisedDp || entry.order.dpDate;
  }
  return entry.sourceDate;
}

function getFinance1Summary(files: FileRecord[], fiscalYear: string): Finance1Summary {
  const range = getFinancialYearDateRange(fiscalYear);
  const cutoffDate = range?.end ?? "";
  const todayDate = formatLocalDate(new Date());
  const fileGroupFiles = range
    ? files.filter((file) => isDateWithinRange(file.receivedDate, range))
    : [];
  const drillFileIds = new Map<string, Set<string>>();
  const addDrillFile = (key: string, file: FileRecord) => {
    const ids = drillFileIds.get(key) ?? new Set<string>();
    ids.add(file.id);
    drillFileIds.set(key, ids);
  };
  const summary: Finance1Summary = {
    fiscalYear,
    cutoffDate,
    fileGroupFiles,
    drillFileIds: {},
    fileGroup: createFinance1Metric(),
    fileTypeDistribution: [],
    firmTypeDistribution: [],
    cancelledByFyEnd: 0,
    activeAtFyEnd: 0,
    closedByFyEnd: 0,
    intendedAtFyEnd: createFinance1Metric(),
    bookedAtFyEnd: createFinance1Metric(),
    committedAtFyEnd: createFinance1Metric(),
    paidByFyEnd: createFinance1Metric(),
    unpaidLiabilityAtFyEnd: createFinance1Metric(),
    paidTillDate: createFinance1Metric(),
    balanceUnpaidToday: createFinance1Metric(),
    noImmsByFyEnd: 0,
    immsDoneSoNotPlacedByFyEnd: 0,
    soPlacedByFyEnd: 0,
    deliveryJobDoneByFyEnd: 0,
    billSentByFyEnd: 0,
    paymentCompletedByFyEnd: 0,
    advancePendingByFyEnd: 0,
    fileClosedByFyEnd: 0,
    soPlacedLater: 0,
    paymentMadeLater: 0,
    fileClosedLater: 0,
    stillPendingToday: 0,
  };
  if (!range) return summary;

  const fileTypeDistribution = new Map<string, Finance1FileTypeDistributionRow>();
  const firmTypeDistribution = new Map<string, Finance1FirmTypeDistributionRow>();
  const getFileTypeRow = (fileType: string | undefined) => {
    const label = fileType?.trim() || "Not specified";
    const key = label.toLowerCase();
    const existing = fileTypeDistribution.get(key);
    if (existing) return existing;
    const row: Finance1FileTypeDistributionRow = {
      fileType: label,
      files: 0,
      filesWithSo: 0,
      activeAtFyEnd: 0,
      closedByFyEnd: 0,
      cancelledByFyEnd: 0,
      capital: 0,
      revenue: 0,
      total: 0,
    };
    fileTypeDistribution.set(key, row);
    return row;
  };
  const getFirmTypeRow = (firmType: string) => {
    const label = firmType.trim() || "Unassigned firm type";
    const key = label.toLowerCase();
    const existing = firmTypeDistribution.get(key);
    if (existing) return existing;
    const row: Finance1FirmTypeDistributionRow = {
      firmType: label,
      supplyOrders: 0,
      capital: 0,
      revenue: 0,
      total: 0,
    };
    firmTypeDistribution.set(key, row);
    return row;
  };

  fileGroupFiles.forEach((file) => {
    addDrillFile("fileGroup", file);
    const demandCapital = getInrAmount(file.valueCapital, file) ?? 0;
    const demandRevenue = getInrAmount(file.valueRevenue, file) ?? 0;
    addFinance1Amount(summary.fileGroup, demandCapital, demandRevenue);

    const cancelledByFyEnd = isYes(file.demandCancelled) && isDateOnOrBefore(file.demandCancelledDate, cutoffDate);
    const closedByFyEnd = isDateOnOrBefore(file.fileClosureDate, cutoffDate);
    if (cancelledByFyEnd) {
      summary.cancelledByFyEnd += 1;
      addDrillFile("cancelledByFyEnd", file);
    }
    if (closedByFyEnd) {
      summary.closedByFyEnd += 1;
      addDrillFile("closedByFyEnd", file);
    }
    if (!cancelledByFyEnd && !closedByFyEnd) {
      summary.activeAtFyEnd += 1;
      addDrillFile("activeAtFyEnd", file);
    }

    const fileTypeRow = getFileTypeRow(file.fileType);
    fileTypeRow.files += 1;
    fileTypeRow.capital += demandCapital;
    fileTypeRow.revenue += demandRevenue;
    fileTypeRow.total += demandCapital + demandRevenue;
    if (cancelledByFyEnd) fileTypeRow.cancelledByFyEnd += 1;
    else if (closedByFyEnd) fileTypeRow.closedByFyEnd += 1;
    else fileTypeRow.activeAtFyEnd += 1;
    const fileTypeKey = `fileType:${fileTypeRow.fileType.toLowerCase()}`;
    addDrillFile(`${fileTypeKey}:files`, file);
    if (cancelledByFyEnd) addDrillFile(`${fileTypeKey}:cancelled`, file);
    if (closedByFyEnd) addDrillFile(`${fileTypeKey}:closed`, file);
    if (!cancelledByFyEnd && !closedByFyEnd) addDrillFile(`${fileTypeKey}:active`, file);

    const immsDoneByFyEnd = isDateOnOrBefore(file.immsDate, cutoffDate);
    const soRowsByFyEnd = fileSupplyOrders(file).filter(
      (order) =>
        hasFilledString(order.soDate) &&
        isDateOnOrBefore(order.soDate, cutoffDate) &&
        !isSupplyOrderCancelledByCutoff(file, order, cutoffDate),
    );
    const supplyOrderRowsByFyEnd = rawSupplyOrders(file).filter(
      (order) =>
        hasFilledString(order.soDate) &&
        isDateOnOrBefore(order.soDate, cutoffDate) &&
        !isSupplyOrderCancelledByCutoff(file, order, cutoffDate),
    );
    const hasSoByFyEnd = supplyOrderRowsByFyEnd.length > 0;
    if (hasSoByFyEnd) {
      fileTypeRow.filesWithSo += 1;
      addDrillFile(`${fileTypeKey}:withSo`, file);
    }

    if (!cancelledByFyEnd && !immsDoneByFyEnd && !hasSoByFyEnd) {
      summary.noImmsByFyEnd += 1;
      addFinance1Amount(summary.intendedAtFyEnd, demandCapital, demandRevenue);
      addDrillFile("intendedAtFyEnd", file);
    }
    if (!cancelledByFyEnd && immsDoneByFyEnd && !hasSoByFyEnd) {
      summary.immsDoneSoNotPlacedByFyEnd += 1;
      addFinance1Amount(summary.bookedAtFyEnd, demandCapital, demandRevenue);
      addDrillFile("bookedAtFyEnd", file);
    }
    if (!cancelledByFyEnd && hasSoByFyEnd) {
      summary.soPlacedByFyEnd += 1;
      addDrillFile("committedAtFyEnd", file);
      addDrillFile("soPlacedByFyEnd", file);
      supplyOrderRowsByFyEnd.forEach((order) => {
        const soCapital = getInrAmount(order.soValueCapital, file) ?? 0;
        const soRevenue = getInrAmount(order.soValueRevenue, file) ?? 0;
        addFinance1Amount(
          summary.committedAtFyEnd,
          soCapital,
          soRevenue,
          0,
        );
        const firmTypeRow = getFirmTypeRow(getEffectiveFirmType(order));
        firmTypeRow.capital += soCapital;
        firmTypeRow.revenue += soRevenue;
        firmTypeRow.total += soCapital + soRevenue;
        addDrillFile(`firmType:${firmTypeRow.firmType.toLowerCase()}`, file);
      });
      summary.committedAtFyEnd.count += supplyOrderRowsByFyEnd.length;
      supplyOrderRowsByFyEnd.forEach((order) => {
        const firmTypeRow = getFirmTypeRow(getEffectiveFirmType(order));
        firmTypeRow.supplyOrders += 1;
        addDrillFile(`firmType:${firmTypeRow.firmType.toLowerCase()}`, file);
      });
    }

    const deliveryJobDoneByFyEnd = soRowsByFyEnd.some((order) =>
      isOrderDeliveryOrJobDoneByCutoff(order, cutoffDate),
    );
    const billSentByFyEnd = soRowsByFyEnd.some((order) =>
      isOrderBillSentByCutoff(order, cutoffDate),
    );
    if (deliveryJobDoneByFyEnd) {
      summary.deliveryJobDoneByFyEnd += 1;
      addDrillFile("deliveryJobDoneByFyEnd", file);
    }
    if (soRowsByFyEnd.length && !deliveryJobDoneByFyEnd) {
      addDrillFile("deliveryJobPendingByFyEnd", file);
    }
    if (billSentByFyEnd) {
      summary.billSentByFyEnd += 1;
      addDrillFile("billSentByFyEnd", file);
    }
    const paymentLiabilityEntries = getFinancePaymentLiabilityEntries([file]);
    const hasRegularPaymentByFyEnd = paymentLiabilityEntries.some((entry) =>
      isDateOnOrBefore(entry.paymentDate, cutoffDate),
    );
    const hasAdvancePaymentByFyEnd = advancePaymentEntries([file]).some(
      ({ order }) =>
        !isSupplyOrderCancelledByCutoff(file, order, cutoffDate) &&
        isDateOnOrBefore(order.advancePaymentDetail?.paymentDate, cutoffDate),
    );
    if (hasRegularPaymentByFyEnd || hasAdvancePaymentByFyEnd) {
      summary.paymentCompletedByFyEnd += 1;
      addDrillFile("paymentCompletedByFyEnd", file);
    }
    if (billSentByFyEnd && !hasRegularPaymentByFyEnd) {
      addDrillFile("billsSubmittedButUnpaid", file);
    }
    if (deliveryJobDoneByFyEnd && !billSentByFyEnd) {
      addDrillFile("paymentDueButBillNotSubmitted", file);
    }

    paymentLiabilityEntries.forEach((entry) => {
      if (isDateOnOrBefore(entry.paymentDate, cutoffDate)) {
        if (isDateOnOrBefore(entry.sourceDate, cutoffDate)) {
          addFinance1Amount(summary.paidByFyEnd, entry.capital, entry.revenue);
          addDrillFile("paidByFyEnd", file);
        }
        return;
      }
      if (isDateOnOrBefore(getFinance1LiabilityDate(entry), cutoffDate)) {
        addFinance1Amount(summary.unpaidLiabilityAtFyEnd, entry.capital, entry.revenue);
        addDrillFile("unpaidLiabilityAtFyEnd", file);
      }
    });

    paymentLiabilityEntries.forEach((entry) => {
      if (isDateOnOrBefore(entry.paymentDate, todayDate)) {
        addFinance1Amount(summary.paidTillDate, entry.capital, entry.revenue);
        addDrillFile("paidTillDate", file);
      } else if (isDateOnOrBefore(entry.sourceDate, todayDate)) {
        addFinance1Amount(summary.balanceUnpaidToday, entry.capital, entry.revenue);
        addDrillFile("balanceUnpaidToday", file);
      }
    });

    let hasPaymentMadeLater = paymentLiabilityEntries.some((entry) =>
      isDateAfterDate(entry.paymentDate, cutoffDate),
    );

    advancePaymentEntries([file]).forEach(({ order }) => {
      if (isSupplyOrderCancelledByCutoff(file, order, cutoffDate)) return;
      const capital = getInrAmount(getAdvancePaymentCapital(order), file) ?? 0;
      const revenue = getInrAmount(getAdvancePaymentRevenue(order), file) ?? 0;
      if (capital + revenue <= 0) return;
      if (isDateOnOrBefore(order.advancePaymentDetail?.paymentDate, cutoffDate)) {
        addFinance1Amount(summary.paidByFyEnd, capital, revenue);
        addDrillFile("paidByFyEnd", file);
      } else if (isDateOnOrBefore(order.soDate, cutoffDate)) {
        summary.advancePendingByFyEnd += 1;
        addFinance1Amount(summary.unpaidLiabilityAtFyEnd, capital, revenue);
        addDrillFile("advancePendingByFyEnd", file);
        addDrillFile("unpaidLiabilityAtFyEnd", file);
      }

      if (isDateOnOrBefore(order.advancePaymentDetail?.paymentDate, todayDate)) {
        addFinance1Amount(summary.paidTillDate, capital, revenue);
        addDrillFile("paidTillDate", file);
      } else if (!isSupplyOrderCancelled(file, order) && isDateOnOrBefore(order.soDate, todayDate)) {
        addFinance1Amount(summary.balanceUnpaidToday, capital, revenue);
        addDrillFile("balanceUnpaidToday", file);
      }
      if (isDateAfterDate(order.advancePaymentDetail?.paymentDate, cutoffDate)) {
        hasPaymentMadeLater = true;
      }
    });

    if (
      fileSupplyOrders(file).some(
        (order) =>
          hasFilledString(order.soDate) &&
          isDateAfterDate(order.soDate, cutoffDate) &&
          !isSupplyOrderCancelledByCutoff(file, order, cutoffDate),
      )
    ) {
      summary.soPlacedLater += 1;
      addDrillFile("soPlacedLater", file);
    }
    if (hasPaymentMadeLater) {
      summary.paymentMadeLater += 1;
      addDrillFile("paymentMadeLater", file);
    }
    if (isDateAfterDate(file.fileClosureDate, cutoffDate)) {
      summary.fileClosedLater += 1;
      addDrillFile("fileClosedLater", file);
    }
    if (!isCancelledFile(file) && !isFileClosed(file)) {
      summary.stillPendingToday += 1;
      addDrillFile("stillPendingToday", file);
    }
  });

  summary.fileClosedByFyEnd = summary.closedByFyEnd;
  summary.fileTypeDistribution = Array.from(fileTypeDistribution.values()).sort((a, b) =>
    b.total !== a.total ? b.total - a.total : a.fileType.localeCompare(b.fileType),
  );
  summary.firmTypeDistribution = Array.from(firmTypeDistribution.values()).sort((a, b) =>
    b.total !== a.total ? b.total - a.total : a.firmType.localeCompare(b.firmType),
  );
  summary.drillFileIds = Object.fromEntries(
    Array.from(drillFileIds, ([key, ids]) => [key, Array.from(ids)]),
  );
  return summary;
}

function isSupplyOrderCancelledByCutoff(
  file: FileRecord,
  order: SupplyOrderDetail,
  cutoffDate: string,
) {
  return (
    (isYes(file.demandCancelled) && isDateOnOrBefore(file.demandCancelledDate, cutoffDate)) ||
    (isYes(order.soCancelled) && isDateOnOrBefore(order.soCancelledDate, cutoffDate))
  );
}

function isOrderDeliveryOrJobDoneByCutoff(order: SupplyOrderDetail, cutoffDate: string) {
  return (
    isDateOnOrBefore(order.materialReceiptDate, cutoffDate) ||
    isDateOnOrBefore(order.jobCompletionDate, cutoffDate) ||
    (order.stageDeliveries ?? []).some(
      (stage) =>
        isDateOnOrBefore(stage.materialReceiptDate, cutoffDate) ||
        isDateOnOrBefore(stage.jobCompletionDate, cutoffDate),
    )
  );
}

function isOrderBillSentByCutoff(order: SupplyOrderDetail, cutoffDate: string) {
  return (
    isDateOnOrBefore(order.billSentForPaymentDate, cutoffDate) ||
    (order.stageDeliveries ?? []).some((stage) =>
      isDateOnOrBefore(stage.billSentForPaymentDate, cutoffDate),
    ) ||
    getSupplementaryBills(order).some((bill) =>
      isDateOnOrBefore(bill.billSentForPaymentDate, cutoffDate),
    )
  );
}

function isDateOnOrBefore(date: string | undefined, cutoffDate: string) {
  return hasFilledString(date) && date! <= cutoffDate;
}

function isDateAfterDate(date: string | undefined, cutoffDate: string) {
  return hasFilledString(date) && date! > cutoffDate;
}

function getSupplyOrderValueDistributionByFirmType(
  files: FileRecord[],
  configuredFirmTypes: string[] | undefined,
  activityYear?: string,
) {
  const totals = new Map<string, number>();
  const configured = getConfiguredFirmTypes(configuredFirmTypes);
  const activityYearRange = getFinancialYearDateRange(activityYear);
  rawSupplyOrderEntries(files).forEach(({ file, order }) => {
    if (isSupplyOrderCancelled(file, order)) return;
    if (activityYearRange && !isDateWithinRange(order.soDate, activityYearRange)) return;
    const value = getSupplyOrderTotalValue(file, order);
    if (value <= 0) return;
    const name = getFirmTypeDistributionName(order, configured);
    totals.set(name, (totals.get(name) ?? 0) + value);
  });
  return mapDistributionEntriesToRows(totals, configured);
}

function getActualPaymentDistributionByFirmType(
  files: FileRecord[],
  configuredFirmTypes: string[] | undefined,
  activityYear?: string,
) {
  const totals = new Map<string, number>();
  const configured = getConfiguredFirmTypes(configuredFirmTypes);
  const activityYearRange = getFinancialYearDateRange(activityYear);
  getFinancePaymentLiabilityEntries(files).forEach((entry) => {
    if (!hasFilledString(entry.paymentDate)) return;
    if (activityYearRange && !isDateWithinRange(entry.paymentDate, activityYearRange)) return;
    const value = entry.capital + entry.revenue;
    if (value <= 0) return;
    const name = getFirmTypeDistributionName(entry.order, configured);
    totals.set(name, (totals.get(name) ?? 0) + value);
  });
  advancePaymentEntries(files).forEach(({ file, order }) => {
    if (isSupplyOrderCancelled(file, order)) return;
    if (!hasFilledString(order.advancePaymentDetail?.paymentDate)) return;
    if (
      activityYearRange &&
      !isDateWithinRange(order.advancePaymentDetail?.paymentDate, activityYearRange)
    )
      return;
    const value =
      (getInrAmount(getAdvancePaymentCapital(order), file) ?? 0) +
      (getInrAmount(getAdvancePaymentRevenue(order), file) ?? 0);
    if (value <= 0) return;
    const name = getFirmTypeDistributionName(order, configured);
    totals.set(name, (totals.get(name) ?? 0) + value);
  });
  return mapDistributionEntriesToRows(totals, configured);
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
  const totals = new Map<string, { capital: number; revenue: number; value: number }>();
  files.forEach((file) => {
    const name = getAnalyticsName(file.indentor, "Unassigned indentor");
    const current = totals.get(name) ?? { capital: 0, revenue: 0, value: 0 };
    const capital = getInrAmount(file.valueCapital, file) ?? 0;
    const revenue = getInrAmount(file.valueRevenue, file) ?? 0;
    current.capital += capital;
    current.revenue += revenue;
    current.value += capital + revenue;
    totals.set(name, current);
  });
  return Array.from(totals.entries())
    .map(([name, values]) => ({ name, ...values }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function filterMilestoneClearingFiles(
  files: FileRecord[],
  filters: {
    valueThreshold: MilestoneClearingThresholdFilter;
    mode: string;
    valueThresholdLevels: ValueThresholdLevel[];
  },
) {
  return files.filter((file) => {
    if (
      filters.mode !== "all" &&
      (file.mode ?? "").trim().toUpperCase() !== filters.mode.trim().toUpperCase()
    ) {
      return false;
    }
    if (
      !isMilestoneClearingValueThresholdMatch(
        file,
        filters.valueThreshold,
        filters.valueThresholdLevels,
      )
    ) {
      return false;
    }
    return true;
  });
}

function isMilestoneClearingValueThresholdMatch(
  file: FileRecord,
  filter: MilestoneClearingThresholdFilter,
  levels: ValueThresholdLevel[],
) {
  if (filter === "all") return true;
  const capital = getInrAmount(file.valueCapital, file) ?? 0;
  const revenue = getInrAmount(file.valueRevenue, file) ?? 0;
  const valueType = capital > 0 ? "capital" : revenue > 0 ? "revenue" : undefined;
  const amount = valueType === "capital" ? capital : valueType === "revenue" ? revenue : 0;
  if (!valueType || amount <= 0) return filter === "unmatched";
  const matchedLevel = levels.find((level) => isThresholdMatch(level, valueType, amount));
  if (filter === "unmatched") return !matchedLevel;
  const levelId = filter.startsWith("level:") ? filter.slice("level:".length) : "";
  return Boolean(levelId && matchedLevel?.id === levelId);
}

function getMilestoneClearingRanking(files: FileRecord[]) {
  return milestoneClearingDefinitions
    .map((definition, index) => {
      const durations = getMilestoneClearingDurationRows(files, definition);
      const stats = getDurationStats(
        durations.map((row) => row.stageDays),
        durations.map((row) => row.cumulativeDays),
      );
      return {
        name: definition.name,
        ...stats,
        fileCount: Array.from(new Set(durations.map((row) => row.fileId))).length,
        sampleSize: durations.length,
        fileIds: Array.from(new Set(durations.map((row) => row.fileId))).join(","),
        sortOrder: index,
      };
    })
    .filter((item) => item.sampleSize > 0)
    .sort((a, b) => b.averageDays - a.averageDays);
}

type MilestoneClearingDurationRow = { fileId: string; stageDays: number; cumulativeDays: number };

function getMilestoneClearingDurationRows(
  files: FileRecord[],
  definition: (typeof milestoneClearingDefinitions)[number],
) {
  if (definition.name === "Payment") {
    return files.flatMap((file) =>
      effectivePaymentEntries([file])
        .filter(
          ({ file: entryFile, order }) =>
            !isAdvancePaymentClearingRow(order) && isPaymentOrderActive(entryFile, order),
        )
        .map(({ file: entryFile, order }) =>
          getMilestoneClearingDurationRow(
            entryFile,
            order.billSentForPaymentDate,
            order.paymentDate,
          ),
        )
        .filter((row): row is MilestoneClearingDurationRow => Boolean(row)),
    );
  }
  if (definition.name === "IR Preparation") {
    return files.flatMap((file) =>
      isIrClearingApplicable(file)
        ? effectivePaymentEntries([file])
            .filter(({ file: entryFile, order }) => !isSupplyOrderCancelled(entryFile, order))
            .map(({ file: entryFile, order }) =>
              getMilestoneClearingDurationRow(
                entryFile,
                order.materialReceiptDate,
                order.irPreparationDate,
              ),
            )
            .filter((row): row is MilestoneClearingDurationRow => Boolean(row))
        : [],
    );
  }
  if (definition.name === "IR Receipt") {
    return files.flatMap((file) =>
      isIrClearingApplicable(file)
        ? effectivePaymentEntries([file])
            .filter(({ file: entryFile, order }) => !isSupplyOrderCancelled(entryFile, order))
            .map(({ file: entryFile, order }) =>
              getMilestoneClearingDurationRow(
                entryFile,
                order.irPreparationDate,
                order.irReceiptDate,
              ),
            )
            .filter((row): row is MilestoneClearingDurationRow => Boolean(row))
        : [],
    );
  }
  if (definition.name === "Bill preparation") {
    return files.flatMap((file) =>
      effectivePaymentEntries([file])
        .filter(
          ({ file: entryFile, order }) =>
            !isAdvancePaymentClearingRow(order) && isPaymentOrderActive(entryFile, order),
        )
        .map(({ file: entryFile, order }) =>
          getMilestoneClearingDurationRow(
            entryFile,
            getBillPreparationStartDate(file, order),
            order.billPreparationDate,
          ),
        )
        .filter((row): row is MilestoneClearingDurationRow => Boolean(row)),
    );
  }
  if (definition.name === "Bill sent for payment") {
    return files.flatMap((file) =>
      effectivePaymentEntries([file])
        .filter(
          ({ file: entryFile, order }) =>
            !isAdvancePaymentClearingRow(order) && isPaymentOrderActive(entryFile, order),
        )
        .map(({ file: entryFile, order }) =>
          getMilestoneClearingDurationRow(
            entryFile,
            order.billPreparationDate,
            order.billSentForPaymentDate,
          ),
        )
        .filter((row): row is MilestoneClearingDurationRow => Boolean(row)),
    );
  }
  if (definition.name === "Bill returned for correction") {
    return files.flatMap((file) =>
      effectivePaymentEntries([file])
        .filter(({ file: entryFile, order }) => isPaymentOrderActive(entryFile, order))
        .flatMap(({ file: entryFile, order }) =>
          getReturnedBillClearingDurationRows(entryFile, order),
        ),
    );
  }
  if (definition.name === "Supplementary bill returned for correction") {
    return files.flatMap((file) =>
      rawSupplyOrders(file)
        .filter((order) => isPaymentOrderActive(file, order))
        .flatMap((order) =>
          getSupplementaryBills(order).flatMap((bill) =>
            getReturnedBillClearingDurationRows(file, bill),
          ),
        ),
    );
  }
  if (definition.name === "Supply Order") {
    const definitionIndex = milestoneClearingDefinitions.indexOf(definition);
    return files.flatMap((file) =>
      rawSupplyOrders(file)
        .map((order) =>
          getMilestoneClearingDurationRow(
            file,
            getPreviousApplicableMilestoneCompletionDate(file, definitionIndex, order.soDate),
            order.soDate,
          ),
        )
        .filter((row): row is MilestoneClearingDurationRow => Boolean(row)),
    );
  }
  const definitionIndex = milestoneClearingDefinitions.indexOf(definition);
  return files
    .filter((file) => isMilestoneClearingDefinitionApplicable(file, definition))
    .map((file) =>
      getMilestoneClearingDurationRow(
        file,
        getPreviousApplicableMilestoneCompletionDate(
          file,
          definitionIndex,
          definition.getEndDate(file),
        ),
        definition.getEndDate(file),
      ),
    )
    .filter((row): row is MilestoneClearingDurationRow => Boolean(row));
}

function getReturnedBillClearingDurationRows(
  file: FileRecord,
  entry: Pick<SupplyOrderDetail, "billReturnCycles">,
) {
  return normalizeBillReturnCycles(entry.billReturnCycles)
    .map((cycle) =>
      getMilestoneClearingDurationRow(file, cycle.returnedDate, cycle.resubmittedDate),
    )
    .filter((row): row is MilestoneClearingDurationRow => Boolean(row));
}

function getMilestoneClearingDurationRow(
  file: FileRecord,
  startDate: string | undefined,
  endDate: string | undefined,
) {
  const stageDays = getDayDifference(startDate, endDate);
  const cumulativeDays = getDayDifference(file.receivedDate, endDate);
  if (
    stageDays === undefined ||
    cumulativeDays === undefined ||
    stageDays < 0 ||
    cumulativeDays < 0
  ) {
    return undefined;
  }
  return { fileId: file.id, stageDays, cumulativeDays };
}

function isMilestoneClearingDefinitionApplicable(
  file: FileRecord,
  definition: (typeof milestoneClearingDefinitions)[number],
) {
  const applies = "applies" in definition ? definition.applies : undefined;
  return applies ? applies(file) : true;
}

function getPreviousApplicableMilestoneCompletionDate(
  file: FileRecord,
  index: number,
  currentEndDate: string | undefined,
) {
  if (index <= 0) return file.receivedDate;
  const currentEndTime = parseLocalDateTime(currentEndDate ?? "");
  if (currentEndTime === undefined) return file.receivedDate;
  const candidates = [file.receivedDate];
  for (let previousIndex = 0; previousIndex < index; previousIndex++) {
    const previous = milestoneClearingDefinitions[previousIndex];
    if (!isMilestoneClearingDefinitionApplicable(file, previous)) continue;
    const previousEndDate = previous.getEndDate(file);
    const previousEndTime = parseLocalDateTime(previousEndDate ?? "");
    if (previousEndTime === undefined || previousEndTime > currentEndTime) continue;
    candidates.push(previousEndDate);
  }
  return candidates
    .filter((date): date is string => Boolean(date))
    .sort((a, b) => (parseLocalDateTime(b) ?? 0) - (parseLocalDateTime(a) ?? 0))[0];
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
    rawSupplyOrders(file).forEach((order) => {
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

function getMonthWiseBgExpiry(files: FileRecord[], selectedYear?: string) {
  const rows = new Map<string, { psb: number; pwb: number; psbPwb: number; count: number }>();
  const categories = ["psb", "pwb", "psbpwb"] as const;
  const activityRange = getFinancialYearDateRange(selectedYear);
  rawSupplyOrderEntries(files).forEach(({ file, order }) => {
    categories.forEach((category) => {
      const validityDate = getBgValidityDate(order, category);
      if (
        !isBgCategoryApplicable(file, order, category) ||
        !isBgReceivedOrder(order, category) ||
        hasFilledString(getBgReturnDate(order, category)) ||
        (activityRange && !isDateWithinRange(validityDate, activityRange))
      ) {
        return;
      }
      const month = getMonthKey(validityDate);
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
    isJobCompletionDone(order) ||
    (order.completedMilestones ?? []).some(
      (milestone) => normalizeMilestoneName(milestone) === "delivery",
    )
  );
}

function isIrClearingApplicable(file: FileRecord) {
  return isDeliveryInspectionApplicable(file) && isYes(file.ir);
}

function getBillPreparationStartDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isIrClearingApplicable(file)) return order.irReceiptDate;
  return getPaymentWorkflowStartDate(file, order);
}

function isAdvancePaymentClearingRow(order: SupplyOrderDetail) {
  return order.stageDeliveryLabel === "Advance Payment";
}

function isJobCompletionDone(order: SupplyOrderDetail) {
  return hasFilledString(order.jobCompletionDate);
}

function isBillPreparationCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  if (isYes(order.shortclosure)) return false;
  if (hasFilledString(order.billPreparationDate)) return false;
  if (isDeliveryInspectionApplicable(file)) {
    return isYes(file.ir) && hasFilledString(order.irReceiptDate);
  }
  return hasFilledString(getPaymentWorkflowStartDate(file, order));
}

function getDeliveryCompletionMonthDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate || order.jobCompletionDate;
  return isJobCompletionDone(order) ? order.jobCompletionDate : undefined;
}

function getBiddingModeMix(files: FileRecord[]) {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
    const name = getAnalyticsName(file.mode?.trim().toUpperCase(), "Unassigned");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return mapEntriesToSortedRows(counts, "count");
}

function getFileValueThresholds(files: FileRecord[], levels: ValueThresholdLevel[]) {
  return getValueThresholdRows(files, levels, "demand", (file) => {
    if (isYes(file.demandCancelled)) return [];
    const capital = getInrAmount(file.valueCapital, file) ?? 0;
    const revenue = getInrAmount(file.valueRevenue, file) ?? 0;
    return [{ capital, revenue }];
  });
}

function getSupplyOrderValueThresholds(files: FileRecord[], levels: ValueThresholdLevel[]) {
  return getValueThresholdRows(files, levels, "supplyOrder", (file) => {
    if (isYes(file.demandCancelled)) return [];
    return rawSupplyOrders(file).map((order) => ({
      capital: getInrAmount(order.soValueCapital, file) ?? 0,
      revenue: getInrAmount(order.soValueRevenue, file) ?? 0,
    }));
  });
}

function getValueThresholdRows(
  files: FileRecord[],
  levels: ValueThresholdLevel[],
  source: CountValueAnalysisSource,
  getEntries: (file: FileRecord) => Array<{ capital: number; revenue: number }>,
) {
  if (!levels.length) return [];
  const rows = levels.map((level) => ({
    name: level.label,
    source,
    appliesTo: formatThresholdAppliesTo(level.appliesTo),
    range: formatThresholdRange(level),
    count: 0,
    capitalCount: 0,
    revenueCount: 0,
    capital: 0,
    revenue: 0,
    value: 0,
  }));
  const unmatched = {
    name: "Unmatched",
    appliesTo: "Both",
    range: "Outside configured ranges",
    count: 0,
    capitalCount: 0,
    revenueCount: 0,
    capital: 0,
    revenue: 0,
    value: 0,
    source,
  };

  files.forEach((file) => {
    getEntries(file).forEach(({ capital, revenue }) => {
      const valueType = capital > 0 ? "capital" : revenue > 0 ? "revenue" : undefined;
      const amount = valueType === "capital" ? capital : valueType === "revenue" ? revenue : 0;
      if (!valueType || amount <= 0) return;
      const matchIndex = levels.findIndex((level) => isThresholdMatch(level, valueType, amount));
      const row = matchIndex >= 0 ? rows[matchIndex] : unmatched;
      row.count += 1;
      if (valueType === "capital") row.capitalCount += 1;
      if (valueType === "revenue") row.revenueCount += 1;
      row.capital += capital;
      row.revenue += revenue;
      row.value += capital + revenue;
    });
  });

  const allRows = unmatched.count ? [...rows, unmatched] : rows;
  const totalCount = allRows.reduce((sum, row) => sum + row.count, 0);
  const totalCapitalCount = allRows.reduce((sum, row) => sum + row.capitalCount, 0);
  const totalRevenueCount = allRows.reduce((sum, row) => sum + row.revenueCount, 0);
  const totalCapital = allRows.reduce((sum, row) => sum + row.capital, 0);
  const totalRevenue = allRows.reduce((sum, row) => sum + row.revenue, 0);
  const totalValue = allRows.reduce((sum, row) => sum + row.value, 0);
  return allRows.map((row) =>
    roundThresholdAnalyticsRow(
      row,
      totalCount,
      totalCapitalCount,
      totalRevenueCount,
      totalCapital,
      totalRevenue,
      totalValue,
    ),
  );
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

function roundThresholdAnalyticsRow(
  row: {
    name: string;
    source: CountValueAnalysisSource;
    appliesTo: string;
    range: string;
    count: number;
    capitalCount: number;
    revenueCount: number;
    capital: number;
    revenue: number;
    value: number;
  },
  totalCount: number,
  totalCapitalCount: number,
  totalRevenueCount: number,
  totalCapital: number,
  totalRevenue: number,
  totalValue: number,
) {
  return {
    ...row,
    capital: Math.round(row.capital),
    revenue: Math.round(row.revenue),
    value: Math.round(row.value),
    countContribution: roundContributionPercent(getPercent(row.count, totalCount)),
    capitalCountContribution: roundContributionPercent(
      getPercent(row.capitalCount, totalCapitalCount),
    ),
    revenueCountContribution: roundContributionPercent(
      getPercent(row.revenueCount, totalRevenueCount),
    ),
    capitalContribution: roundContributionPercent(getPercent(row.capital, totalCapital)),
    revenueContribution: roundContributionPercent(getPercent(row.revenue, totalRevenue)),
    valueContribution: roundContributionPercent(getPercent(row.value, totalValue)),
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

function formatMilestoneClearingThresholdOption(level: ValueThresholdLevel) {
  const range = formatThresholdRange(level);
  const appliesTo = formatThresholdAppliesTo(level.appliesTo);
  return appliesTo === "Both" ? range : `${range} (${appliesTo})`;
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
  if (isYes(file.demandCancelled)) return 0;
  const liabilityPendingCount = getFinancePaymentLiabilityEntries([file]).filter(
    (entry) => entry.pending,
  ).length;
  const advancePendingCount = advancePaymentEntries([file]).filter(
    ({ file: entryFile, order }) =>
      isAdvancePaymentPending(order) && isPaymentOrderActive(entryFile, order),
  ).length;
  return liabilityPendingCount + advancePendingCount;
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
    applies: (file: FileRecord) => isYes(file.highValue),
  },
  {
    name: "Pre-TCEC",
    getStartDate: (file: FileRecord) => file.preTcecDate,
    getEndDate: (file: FileRecord) => file.preTcecMinutesDate,
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    name: "AD",
    getStartDate: (file: FileRecord) => file.adSentDate,
    getEndDate: (file: FileRecord) => file.adVettingDate,
    applies: (file: FileRecord) => isYes(file.ad),
  },
  {
    name: "R&QA",
    getStartDate: (file: FileRecord) => file.rqaSentDate,
    getEndDate: (file: FileRecord) => file.rqaApprovalDate,
    applies: (file: FileRecord) => isYes(file.rqa),
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
    applies: (file: FileRecord) => isYes(file.ifa),
  },
  {
    name: "CFA",
    getStartDate: (file: FileRecord) => file.cfaSentDate,
    getEndDate: (file: FileRecord) => file.cfaDate,
  },
  {
    name: "Bidding",
    getStartDate: getEffectiveBidDate,
    getEndDate: getEffectiveBidOpeningDate,
    applies: (file: FileRecord) => isBiddingApplicableForFile(file),
  },
  {
    name: "Post-TCEC",
    getStartDate: (file: FileRecord) => getTcecMeetingDate(file, "post"),
    getEndDate: (file: FileRecord) => getTcecMinutesDate(file, "post"),
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    name: "CNC",
    getStartDate: (file: FileRecord) => file.cncDate,
    getEndDate: (file: FileRecord) => file.cncApprovalDate,
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    name: "Supply Order",
    getStartDate: (file: FileRecord) => file.cfaDate,
    getEndDate: getFirstSoDate,
  },
  {
    name: "IR Preparation",
    getStartDate: (file: FileRecord) => getEarliestSupplyOrderDate(file, "materialReceiptDate"),
    getEndDate: (file: FileRecord) => getEarliestSupplyOrderDate(file, "irPreparationDate"),
  },
  {
    name: "IR Receipt",
    getStartDate: (file: FileRecord) => getEarliestSupplyOrderDate(file, "irPreparationDate"),
    getEndDate: (file: FileRecord) => getEarliestSupplyOrderDate(file, "irReceiptDate"),
  },
  {
    name: "Bill preparation",
    getStartDate: (file: FileRecord) =>
      isIrClearingApplicable(file)
        ? getEarliestSupplyOrderDate(file, "irReceiptDate")
        : getEarliestSupplyOrderDate(file, "materialReceiptDate"),
    getEndDate: (file: FileRecord) => getEarliestSupplyOrderDate(file, "billPreparationDate"),
  },
  {
    name: "Bill sent for payment",
    getStartDate: (file: FileRecord) => getEarliestSupplyOrderDate(file, "billPreparationDate"),
    getEndDate: (file: FileRecord) => getEarliestSupplyOrderDate(file, "billSentForPaymentDate"),
  },
  {
    name: "Bill returned for correction",
    getStartDate: getEarliestBillReturnDate,
    getEndDate: getEarliestBillResubmissionDate,
  },
  {
    name: "Supplementary bill returned for correction",
    getStartDate: () => "",
    getEndDate: () => "",
  },
  {
    name: "Payment",
    getStartDate: (file: FileRecord) => getEarliestSupplyOrderDate(file, "billSentForPaymentDate"),
    getEndDate: getFirstPaymentDate,
  },
];

function getEffectiveBidDate(file: FileRecord) {
  return isYes(file.refloat) && hasFilledString(file.refloatBiddingDate)
    ? file.refloatBiddingDate
    : file.bidDate;
}

function getFileTotalValue(file: FileRecord) {
  return (
    (getInrAmount(file.valueCapital, file) ?? 0) + (getInrAmount(file.valueRevenue, file) ?? 0)
  );
}

function getFileCommittedCapitalValue(file: FileRecord) {
  const rawOrders = rawSupplyOrders(file);
  if (rawOrders.length) {
    return rawOrders
      .filter((order) => !isYes(order.soCancelled))
      .reduce((sum, order) => sum + (getInrAmount(order.soValueCapital, file) ?? 0), 0);
  }
  return isYes(file.soCancelled) ? 0 : (getInrAmount(file.soValueCapital, file) ?? 0);
}

function getFileCommittedRevenueValue(file: FileRecord) {
  const rawOrders = rawSupplyOrders(file);
  if (rawOrders.length) {
    return rawOrders
      .filter((order) => !isYes(order.soCancelled))
      .reduce((sum, order) => sum + (getInrAmount(order.soValueRevenue, file) ?? 0), 0);
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

function mapDistributionEntriesToRows(values: Map<string, number>, seedNames: string[] = []) {
  const seededValues = new Map(values);
  seedNames.forEach((name) => {
    if (!seededValues.has(name)) seededValues.set(name, 0);
  });
  const total = Array.from(seededValues.values()).reduce((sum, value) => sum + value, 0);
  return Array.from(seededValues.entries())
    .map(([name, value]) => ({
      name,
      value: Math.round(value),
      share: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function getFirmTypeDistributionName(
  order: SupplyOrderDetail,
  configuredFirmTypes: string[],
) {
  const raw = getEffectiveFirmType(order);
  if (!raw) return "Unassigned firm type";
  const configuredMatch = configuredFirmTypes.find(
    (firmType) => firmType.toLowerCase() === raw.toLowerCase(),
  );
  return configuredMatch ?? raw;
}

function getEffectiveFirmType(order: SupplyOrderDetail) {
  const firmType = order.firmType?.trim() || "";
  const firmTypeOther = order.firmTypeOther?.trim() || "";
  if (firmType.toUpperCase() === "OTHER") return firmTypeOther || firmType;
  return firmType || firmTypeOther;
}

function getRoundedAverage(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getDurationStats(values: number[], cumulativeValues = values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sampleSize = sorted.length;
  const middle = Math.floor(sampleSize / 2);
  const medianDays =
    sampleSize === 0
      ? 0
      : sampleSize % 2 === 1
        ? sorted[middle]
        : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
  return {
    averageDays: getRoundedAverage(sorted),
    cumulativeDays: getRoundedAverage(cumulativeValues),
    minDays: sorted[0] ?? 0,
    maxDays: sorted[sampleSize - 1] ?? 0,
    medianDays,
    sampleSize,
  };
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

function getEarliestBillReturnDate(file: FileRecord) {
  return getEarliestBillReturnCycleDate(file, "returnedDate");
}

function getEarliestBillResubmissionDate(file: FileRecord) {
  return getEarliestBillReturnCycleDate(file, "resubmittedDate");
}

function getEarliestBillReturnCycleDate(file: FileRecord, key: keyof BillReturnCycle) {
  const dates = fileSupplyOrders(file)
    .flatMap((order) => normalizeBillReturnCycles(order.billReturnCycles))
    .map((cycle) => cycle[key])
    .filter(hasFilledString)
    .sort();
  return dates[0] ?? "";
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
  return finalPaymentOrders(file).some((order) => isNormalPaymentOpenOrder(file, order));
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
    applies: (file) => isBiddingApplicableForFile(file) && !isYes(file.refloat),
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
    key: "refloatBidding",
    label: "Refloat bidding",
    totalLabel: "Total cases",
    completedLabel: "Completed",
    pendingLabel: "In progress",
    current: "biddingStageOver",
    applies: (file) => isYes(file.refloat),
  },
  {
    key: "refloatPostTcec",
    label: "Refloat Post-TCEC",
    totalLabel: "Total cases",
    reviewed: "refloatPostTcecDate",
    current: "refloatPostTcecMinutesDate",
    applies: (file) => isYes(file.refloat) && isYes(file.tcec) && isYes(file.biddingStageOver),
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
  "Refloat bidding",
  "Refloat Post-TCEC",
  "CNC",
  "Financial Sanction",
  "Supply Order",
  "Delivery Period",
  "PSB",
  "PWB",
  "PSB+PWB",
  "Job Completion",
  "Bill sent for payment",
  "Bill returned for correction",
  "Supplementary bill returned for correction",
  "Advance Payment",
  "Payment",
  fileClosedMilestone,
];
const protectedLiveStatusMilestones = [
  "Refloat bidding",
  "Refloat Post-TCEC",
  "Bill returned for correction",
  "Supplementary bill returned for correction",
  "Job Completion",
];

function getConfiguredMilestones(milestones: string[] | undefined) {
  const values = (milestones ?? [])
    .map((item) => normalizeLiveStatusMilestoneName(item.trim()))
    .filter(isVisibleLiveStatusMilestoneName);
  const configured = values.length ? values : defaultManualMilestones;
  return appendFileClosedMilestone(
    dedupeLiveStatusMilestones(
      insertAdvancePaymentMilestone(
        insertSupplementaryBillReturnedMilestone(
          insertBillSentMilestone(
            insertJobCompletionMilestone(insertRefloatMilestones(configured)),
          ),
        ),
      ),
    ),
  );
}

function isVisibleLiveStatusMilestoneName(name: string | undefined): name is string {
  if (!name) return false;
  return normalizeMilestoneName(name) !== "bankguarantee";
}

function insertRefloatMilestones(milestones: string[]) {
  const hasRefloatBidding = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "refloatbidding",
  );
  const hasRefloatPostTcec = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "refloatposttcec",
  );
  if (hasRefloatBidding && hasRefloatPostTcec) return milestones;
  const postTcecIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "posttcec",
  );
  const cncIndex = milestones.findIndex((milestone) => normalizeMilestoneName(milestone) === "cnc");
  let insertIndex = postTcecIndex === -1 ? cncIndex : postTcecIndex + 1;
  if (insertIndex < 0) insertIndex = milestones.length;
  const additions = [
    hasRefloatBidding ? undefined : "Refloat bidding",
    hasRefloatPostTcec ? undefined : "Refloat Post-TCEC",
  ].filter((item): item is string => Boolean(item));
  return [...milestones.slice(0, insertIndex), ...additions, ...milestones.slice(insertIndex)];
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
  const hasBillReturned = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "billreturnedforcorrection",
  );
  const paymentIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "payment",
  );
  if (paymentIndex === -1) return milestones;
  let next = milestones;
  if (!hasBillSent) {
    next = [...next.slice(0, paymentIndex), "Bill sent for payment", ...next.slice(paymentIndex)];
  }
  if (hasBillReturned) return next;
  const nextPaymentIndex = next.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "payment",
  );
  return [
    ...next.slice(0, nextPaymentIndex),
    "Bill returned for correction",
    ...next.slice(nextPaymentIndex),
  ];
}

function insertSupplementaryBillReturnedMilestone(milestones: string[]) {
  const hasSupplementaryBillReturned = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "supplementarybillreturnedforcorrection",
  );
  const paymentIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "payment",
  );
  if (hasSupplementaryBillReturned || paymentIndex === -1) return milestones;
  return [
    ...milestones.slice(0, paymentIndex),
    "Supplementary bill returned for correction",
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
    (milestone) => normalizeMilestoneName(milestone) === "deliveryperiod",
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

function normalizeLiveStatusMilestoneName(milestone: string) {
  const configured = normalizeConfiguredMilestoneLabel(milestone);
  const normalized = normalizeMilestoneName(configured);
  if (normalized === "delivery") return "Delivery Period";
  return configured;
}

function getLiveStatusMilestoneLabel(milestone: string) {
  if (normalizeMilestoneName(milestone) === "supplementarybillreturnedforcorrection") {
    return "Supp. bill returned";
  }
  return normalizeMilestoneName(milestone) === "deliveryperiod" ? "D.P." : milestone;
}

function dedupeLiveStatusMilestones(milestones: string[]) {
  const seen = new Set<string>();
  const deduped: string[] = [];
  milestones.forEach((milestone) => {
    const name = normalizeLiveStatusMilestoneName(milestone);
    const normalized = normalizeMilestoneName(name);
    if (!name || seen.has(normalized)) return;
    seen.add(normalized);
    deduped.push(name);
  });
  return deduped;
}

function getVisibleLiveMilestoneNames(
  liveMilestones: string[] | undefined,
  manualMilestoneFlow: Array<{ name: string }>,
) {
  const available = new Set(manualMilestoneFlow.map((milestone) => milestone.name));
  const visible = dedupeLiveStatusMilestones(
    liveMilestones
      ?.map((name) => normalizeLiveStatusMilestoneName(name))
      .filter((name) => isVisibleLiveStatusMilestoneName(name) && available.has(name)) ??
      manualMilestoneFlow
        .map((milestone) => milestone.name)
        .filter(isVisibleLiveStatusMilestoneName),
  );
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
    .map((name) => normalizeLiveStatusMilestoneName(name.trim()))
    .filter(isVisibleLiveStatusMilestoneName)
    .filter((name) => normalizeMilestoneName(name) !== normalizeMilestoneName(fileClosedMilestone));
  const extras = files
    .map((file) => file.currentMilestone?.trim())
    .map((name) => (name ? normalizeLiveStatusMilestoneName(name) : name))
    .filter(isVisibleLiveStatusMilestoneName)
    .filter((name) => !configured.includes(name));
  return dedupeLiveStatusMilestones([...configured, ...Array.from(new Set(extras)).sort()]).map(
    (name) => ({
      name,
      label: getLiveStatusMilestoneLabel(name),
      current: getManualMilestoneCurrentCount(files, name),
      completed: getManualMilestoneCompletedCount(files, name),
    }),
  );
}

function getManualMilestoneCurrentCount(files: FileRecord[], name: string) {
  const normalized = normalizeMilestoneName(name);
  if (isBgMilestoneKey(normalized)) return countBgPendingOrders(files, normalized);
  if (normalized === "supplementarybillreturnedforcorrection") {
    return countSupplementaryBillReturnedOrders(files);
  }
  if (normalized === "refloatbidding") {
    return files.filter((file) => !isCancelledFile(file) && isRefloatBiddingInProgressFile(file))
      .length;
  }
  if (normalized === "refloatposttcec") {
    return files.filter(
      (file) =>
        !isCancelledFile(file) &&
        isYes(file.refloat) &&
        isYes(file.tcec) &&
        isYes(file.biddingStageOver) &&
        !hasFilledField(file, "refloatPostTcecMinutesDate"),
    ).length;
  }
  if (normalized === "bidding") {
    return files.filter(
      (file) =>
        !isCancelledFile(file) &&
        isBiddingApplicableForFile(file) &&
        !isYes(file.refloat) &&
        hasFilledString(file.cfaDate) &&
        !isYes(file.biddingStageOver),
    ).length;
  }
  if (isSupplyOrderDrivenMilestoneName(name)) {
    return countCurrentSupplyOrderMilestoneStatuses(files, normalized);
  }
  return files.filter((file) => !isCancelledFile(file) && file.currentMilestone === name).length;
}

function getManualMilestoneCompletedCount(files: FileRecord[], name: string) {
  const normalized = normalizeMilestoneName(name);
  if (isBgMilestoneKey(normalized)) return countBgReceivedOrders(files, normalized);
  if (normalized === "refloatbidding") {
    return files.filter(
      (file) => !isCancelledFile(file) && isYes(file.refloat) && isYes(file.biddingStageOver),
    ).length;
  }
  if (normalized === "refloatposttcec") {
    return files.filter(
      (file) =>
        !isCancelledFile(file) &&
        isYes(file.refloat) &&
        isYes(file.tcec) &&
        hasFilledField(file, "refloatPostTcecMinutesDate"),
    ).length;
  }
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

    if (milestone.key === "refloatBidding") {
      const inProgressFiles = processFiles.filter(isRefloatBiddingInProgressFile);
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: milestone.completedLabel ?? "Completed",
        totalLabel: milestone.totalLabel ?? "Total",
        pendingLabel: milestone.pendingLabel ?? getMilestonePendingLabel(milestone),
        total,
        underProcess: 0,
        active: inProgressFiles.length,
        pending: inProgressFiles.length,
        reviewed: 0,
        hasReviewed: false,
        cleared,
        activeLabel: "In progress",
        liveBids: inProgressFiles.filter(isFileTenderLive).length,
        overdueBids: inProgressFiles.filter(isRefloatBidOverdue).length,
        inProcessBids: inProgressFiles.filter(
          (file) => !isFileTenderLive(file) && !isRefloatBidOverdue(file),
        ).length,
      };
    }

    if (milestone.key === "refloatPostTcec") {
      const pendingRefloatPostTcec = processFiles.filter(
        (file) => !hasFilledField(file, "refloatPostTcecMinutesDate"),
      );
      const reviewedRefloatPostTcec = pendingRefloatPostTcec.filter((file) =>
        hasFilledField(file, "refloatPostTcecDate"),
      );
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: milestone.completedLabel ?? "Completed",
        totalLabel: milestone.totalLabel ?? "Total",
        pendingLabel: milestone.pendingLabel ?? getMilestonePendingLabel(milestone),
        total,
        underProcess: files.filter(
          (file) =>
            !isCancelledFile(file) &&
            isYes(file.refloat) &&
            isYes(file.tcec) &&
            !isYes(file.biddingStageOver),
        ).length,
        active: pendingRefloatPostTcec.length,
        pending: pendingRefloatPostTcec.length,
        reviewed: reviewedRefloatPostTcec.length,
        hasReviewed: Boolean(milestone.reviewed),
        cleared,
        activeLabel: getMilestoneActiveLabel(milestone.key),
      };
    }

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
        total,
        underProcess: supplyOrderPreviousStage,
        active: activeFiles.length,
        pending: countCurrentSupplyOrderMilestoneStatuses(applicableFiles, "supplyorder"),
        reviewed: reviewedFiles.length,
        hasReviewed: Boolean(milestone.reviewed),
        cleared,
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
      const paymentDue = countPaymentDueOrders(files);
      const paymentInProcess = countPaymentInProcessOrders(files);
      const paymentSubmitted = countPaymentSubmittedOrders(files);
      const paymentPending = paymentDue + paymentInProcess + paymentSubmitted;
      const advancePaid = countAdvancePaymentPaidOrders(files);
      const advancePending = countAdvancePaymentPendingOrders(files);
      const billsReturnedForCorrection = countBillsReturnedForCorrection(files);
      const returnedBillsPending = countReturnedBillsPending(files);
      const returnedBillsResubmitted = countReturnedBillsResubmitted(files);
      const returnedBillsPaid = countReturnedBillsPaid(files);
      const supplementarySubmitted = countSupplementaryBillSubmittedOrders(files);
      const supplementaryPending = countSupplementaryBillPendingOrders(files);
      const supplementaryReturnedForCorrection = countSupplementaryBillReturnHistoryOrders(files);
      const supplementaryReturnedPending = countSupplementaryBillReturnedOrders(files);
      const supplementaryReturnedResubmitted = countSupplementaryBillResubmittedOrders(files);
      const supplementaryPaid = countSupplementaryBillPaidOrders(files);
      const supplementaryNormalPaid = countNormalSupplementaryBillPaidOrders(files);
      const supplementaryReturnedPaid = countReturnedSupplementaryBillPaidOrders(files);
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
        paymentDue,
        paymentInProcess,
        paymentSubmitted,
        advancePaid,
        advancePending,
        billsReturnedForCorrection,
        returnedBillsPending,
        returnedBillsResubmitted,
        returnedBillsPaid,
        supplementarySubmitted,
        supplementaryPending,
        supplementaryReturnedForCorrection,
        supplementaryReturnedPending,
        supplementaryReturnedResubmitted,
        supplementaryPaid,
        supplementaryNormalPaid,
        supplementaryReturnedPaid,
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
      activeLabel: getMilestoneActiveLabel(milestone.key),
      liveBids:
        milestone.key === "bidding"
          ? processFiles.filter((file) => isBiddingInProgressFile(file) && isFileTenderLive(file))
              .length
          : undefined,
      overdueBids:
        milestone.key === "bidding"
          ? processFiles.filter((file) => isBiddingInProgressFile(file) && isBidOverdue(file))
              .length
          : undefined,
      inProcessBids:
        milestone.key === "bidding"
          ? processFiles.filter(
              (file) =>
                isBiddingInProgressFile(file) && !isFileTenderLive(file) && !isBidOverdue(file),
            ).length
          : undefined,
      completed:
        milestone.key === "delivery" ? countDeliveryCompletedOrders(files) : undefined,
      due: milestone.key === "delivery" ? countDeliveryPendingOrders(files) : undefined,
      overdue: milestone.key === "delivery" ? countDeliveryOverdueOrders(files) : undefined,
    };
  });
  const supplyOrderIndex = flow.findIndex((milestone) => milestone.key === "supplyOrder");
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

  if (paymentIndex === -1) return [...withDeliveryPeriod, jobCompletion, ir];
  return [
    ...withDeliveryPeriod.slice(0, paymentIndex),
    jobCompletion,
    ir,
    ...withDeliveryPeriod.slice(paymentIndex),
  ];
}

function combineJobCompletionAndIr(statusFlow: ReturnType<typeof getMilestoneFlow>) {
  const ir = statusFlow.find(
    (
      milestone,
    ): milestone is Extract<(typeof statusFlow)[number], { irPreparationPending: number }> =>
      "irPreparationPending" in milestone,
  );

  if (!ir) return statusFlow;

  return statusFlow.flatMap((milestone) => {
    if ("irPreparationPending" in milestone) return [];
    if (!("jobLive" in milestone) || "due" in milestone) return [milestone];

    return [
      {
        ...milestone,
        key: "jobCompletionIr",
        label: "Job Completion / IR",
        irPreparationPending: ir.irPreparationPending,
        irReceiptPending: ir.irReceiptPending,
        irCompleted: ir.irCompleted,
      },
    ];
  });
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

const dueActiveMilestoneKeys = new Set([
  "scrutiny",
  "highValue",
  "tcec",
  "ad",
  "rqa",
  "control",
  "ifa",
  "cfa",
  "postTcec",
  "refloatPostTcec",
  "cnc",
]);

function getMilestoneActiveLabel(key: string) {
  return dueActiveMilestoneKeys.has(key) ? "Due" : "In process";
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

  const targetIndex = milestoneDefinitions.findIndex((item) => item.key === milestone.key);
  if (targetIndex <= 0) return hasMilestoneDate(file, "receivedDate");
  if (isFlexiblePreControlMilestone(milestone)) {
    const scrutiny = milestoneDefinitions.find((item) => item.key === "scrutiny");
    return scrutiny ? isMilestoneComplete(file, scrutiny) : hasMilestoneDate(file, "receivedDate");
  }
  const controlIndex = milestoneDefinitions.findIndex((item) => item.key === "control");
  if (controlIndex >= 0 && targetIndex >= controlIndex) {
    return milestoneDefinitions.slice(0, targetIndex).every((item) => {
      if (!isMilestoneApplicable(file, item)) return true;
      return isMilestoneComplete(file, item);
    });
  }
  return milestoneDefinitions.slice(0, targetIndex).every((item) => {
    if (item.key !== "scrutiny") return true;
    return !isMilestoneApplicable(file, item) || isMilestoneComplete(file, item);
  });
}

function isFlexiblePreControlMilestone(
  milestone: Pick<(typeof milestoneDefinitions)[number], "key">,
) {
  return ["highValue", "tcec", "ad", "rqa"].includes(milestone.key);
}

function isMilestoneComplete(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (milestone.key === "bidding") {
    return isYes(file.biddingStageOver);
  }
  if (milestone.key === "refloatBidding") {
    return isYes(file.refloat) && isYes(file.biddingStageOver);
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

function getWorkflowDisplayLabel(value: string | undefined) {
  return normalizeMilestoneName(value) === "billreturnedforcorrection"
    ? "Returned Bills"
    : (value ?? "");
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
  return isYes(file.demandCancelled) || isYes(order.soCancelled);
}

function isPaymentOrderActive(file: FileRecord, order: SupplyOrderDetail) {
  return !isYes(file.demandCancelled) && !isYes(order.soCancelled);
}

function isOrderActiveForMilestone(
  file: FileRecord,
  order: SupplyOrderDetail,
  normalizedMilestone: string,
) {
  return isPaymentMilestone(normalizedMilestone)
    ? isPaymentOrderActive(file, order)
    : !isSupplyOrderCancelled(file, order);
}

function isOrderActiveForCurrentMilestone(
  file: FileRecord,
  order: SupplyOrderDetail,
  normalizedMilestone: string,
) {
  return isPaymentMilestone(normalizedMilestone)
    ? isPaymentOrderActive(file, order)
    : !isSupplyOrderCancelled(file, order) && !isYes(order.shortclosure);
}

function isPaymentMilestone(normalizedMilestone: string) {
  return [
    "advancepayment",
    "billpreparation",
    "billsentforpayment",
    "billreturnedforcorrection",
    "payment",
  ].includes(normalizedMilestone);
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
  }
  if (!isYes(order.advancePayment) && !isNo(order.advancePayment)) return false;
  return true;
}

function isSupplyOrderPendingOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    !isSupplyOrderCancelled(file, order) &&
    !isYes(order.shortclosure) &&
    isFinancialSanctionCompletedOrder(order) &&
    !isSupplyOrderTabComplete(file, order)
  );
}

function isDeliveryPeriodCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    !isSupplyOrderCancelled(file, order) &&
    !isYes(order.shortclosure) &&
    hasSupplyOrderDate(order) &&
    !isYes(order.stageDelivery) &&
    !hasFilledString(getDeliveryDueDate(order))
  );
}

function isSoCancelledFile(file: FileRecord) {
  const orders = rawSupplyOrders(file);
  return orders.length > 0 && orders.every((order) => isYes(order.soCancelled));
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
      !isYes(order.shortclosure) &&
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
      !isYes(order.shortclosure) &&
      isDateBeforeToday(getDeliveryPeriodDate(order)),
  ).length;
}

function countJobCompletionLiveOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      !isSupplyOrderCancelled(file, order) &&
      !isYes(order.shortclosure) &&
      isJobCompletionCurrentOrder(file, order),
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

function countAllBgPendingOrders(files: FileRecord[]) {
  return (
    countBgPendingOrders(files, "psb") +
    countBgPendingOrders(files, "pwb") +
    countBgPendingOrders(files, "psbpwb")
  );
}

function isBgPendingOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  return (
    isBgCategoryApplicable(file, order, category) &&
    !isBgReceivedOrder(order, category) &&
    !isSupplyOrderCancelled(file, order) &&
    !isYes(order.shortclosure) &&
    (normalized === "psb" || normalized === "psbpwb"
      ? isFinancialSanctionCompletedOrder(order)
      : isPwbDueForWorkflow(file, order))
  );
}

function isPwbDueForWorkflow(file: FileRecord, order: SupplyOrderDetail) {
  return isJobCompletionWorkflow(file)
    ? hasFilledString(order.jobCompletionDate)
    : hasFilledString(order.materialReceiptDate);
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
      !isSupplyOrderCancelled(file, order) &&
      !isYes(order.shortclosure),
  ).length;
}

function countIrReceiptPendingOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isDeliveryInspectionApplicable(file) &&
      isYes(file.ir) &&
      hasFilledString(order.irPreparationDate) &&
      !hasFilledString(order.irReceiptDate) &&
      !isSupplyOrderCancelled(file, order) &&
      !isYes(order.shortclosure),
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
    ({ file, order }) => hasFilledString(order.paymentDate) && isPaymentOrderActive(file, order),
  ).length;
}

function countPaymentPendingOrders(files: FileRecord[]) {
  return effectivePaymentEntries(files).filter(
    ({ file, order }) =>
      hasPaymentWorkflowStarted(file, order) &&
      !hasFilledString(order.paymentDate) &&
      isPaymentOrderActive(file, order),
  ).length;
}

function countPaymentDueOrders(files: FileRecord[]) {
  return effectivePaymentEntries(files).filter(({ file, order }) =>
    isPaymentDueOrder(file, order),
  ).length;
}

function countPaymentInProcessOrders(files: FileRecord[]) {
  return effectivePaymentEntries(files).filter(({ file, order }) =>
    isPaymentInProcessOrder(file, order),
  ).length;
}

function countPaymentSubmittedOrders(files: FileRecord[]) {
  return effectivePaymentEntries(files).filter(({ file, order }) =>
    isPaymentSubmittedOrder(file, order),
  ).length;
}

function isNormalPaymentOpenOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasPaymentWorkflowStarted(file, order) &&
    !hasFilledString(order.paymentDate) &&
    isPaymentOrderActive(file, order) &&
    !hasBillReturnHistory(order)
  );
}

function isPaymentDueOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    isNormalPaymentOpenOrder(file, order) &&
    !hasFilledString(order.billPreparationDate) &&
    !hasFilledString(order.billSentForPaymentDate)
  );
}

function isPaymentInProcessOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    isNormalPaymentOpenOrder(file, order) &&
    hasFilledString(order.billPreparationDate) &&
    !hasFilledString(order.billSentForPaymentDate)
  );
}

function isPaymentSubmittedOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    isNormalPaymentOpenOrder(file, order) && hasFilledString(order.billSentForPaymentDate)
  );
}

function countAdvancePaymentPaidOrders(files: FileRecord[]) {
  return advancePaymentEntries(files).filter(
    ({ file, order }) => isAdvancePaymentPaid(order) && isPaymentOrderActive(file, order),
  ).length;
}

function countAdvancePaymentPendingOrders(files: FileRecord[]) {
  return advancePaymentEntries(files).filter(
    ({ file, order }) => isAdvancePaymentPending(order) && isPaymentOrderActive(file, order),
  ).length;
}

function countSupplementaryBillPendingOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(files, isSupplementaryBillPaymentPending);
}

function countSupplementaryBillSubmittedOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(files, isSupplementaryBillSubmitted);
}

function countSupplementaryBillReturnedOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(files, isSupplementaryBillReturned);
}

function countSupplementaryBillReturnHistoryOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(files, hasSupplementaryBillReturnHistory);
}

function countSupplementaryBillResubmittedOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(files, isSupplementaryBillResubmitted);
}

function countSupplementaryBillPaidOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(files, isSupplementaryBillPaid);
}

function countNormalSupplementaryBillPaidOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(files, isNormalSupplementaryBillPaid);
}

function countReturnedSupplementaryBillPaidOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(files, isReturnedSupplementaryBillPaid);
}

function countSupplementaryBillOrders(
  files: FileRecord[],
  predicate: (bill: SupplementaryBillDetail) => boolean,
) {
  return files.reduce((count, file) => {
    return (
      count +
      rawSupplyOrders(file).reduce((orderCount, order) => {
        if (!isPaymentOrderActive(file, order)) return orderCount;
        return orderCount + getSupplementaryBills(order).filter(predicate).length;
      }, 0)
    );
  }, 0);
}

function hasSupplementaryBillPending(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    return getSupplementaryBills(order).some(isSupplementaryBillPaymentPending);
  });
}

function hasSupplementaryBillSubmitted(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    return getSupplementaryBills(order).some(isSupplementaryBillSubmitted);
  });
}

function hasSupplementaryBillPaid(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    return getSupplementaryBills(order).some(isNormalSupplementaryBillPaid);
  });
}

function hasReturnedSupplementaryBillPaid(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    return getSupplementaryBills(order).some(isReturnedSupplementaryBillPaid);
  });
}

function hasSupplementaryBillReturnHistoryFile(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    return getSupplementaryBills(order).some(hasSupplementaryBillReturnHistory);
  });
}

function hasSupplementaryBillReturned(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    return getSupplementaryBills(order).some(isSupplementaryBillReturned);
  });
}

function hasSupplementaryBillResubmitted(file: FileRecord) {
  return normalizedFilePaymentOrders(file).some((order) => {
    if (!isPaymentOrderActive(file, order)) return false;
    return getSupplementaryBills(order).some(isSupplementaryBillResubmitted);
  });
}

function getSupplementaryBills(order: SupplyOrderDetail) {
  return Array.isArray(order.supplementaryBills)
    ? order.supplementaryBills.filter(
        (bill): bill is NonNullable<SupplyOrderDetail["supplementaryBills"]>[number] =>
          Boolean(bill) && typeof bill === "object" && !Array.isArray(bill),
      )
    : [];
}

function hasSupplementaryBillData(
  bill: NonNullable<SupplyOrderDetail["supplementaryBills"]>[number],
) {
  return (
    [
      bill.billNo,
      bill.billAmountCapital,
      bill.billAmountRevenue,
      bill.billSentForPaymentDate,
      bill.paymentDate,
      bill.paymentMode,
      bill.actualPaymentCapital,
      bill.actualPaymentRevenue,
      bill.remarks,
    ].some(hasFilledString) || Boolean(bill.billReturnCycles?.some(hasBillReturnCycleData))
  );
}

function hasBillReturnCycleData(cycle: NonNullable<SupplyOrderDetail["billReturnCycles"]>[number]) {
  return [cycle.returnedDate, cycle.reason, cycle.resubmittedDate, cycle.remarks].some(
    hasFilledString,
  );
}

function hasSupplementaryBillReturnHistory(bill: SupplementaryBillDetail) {
  return (bill.billReturnCycles ?? []).some(hasBillReturnCycleData);
}

function isSupplementaryBillSubmitted(bill: SupplementaryBillDetail) {
  return hasFilledString(bill.billSentForPaymentDate);
}

function isSupplementaryBillPaymentPending(bill: SupplementaryBillDetail) {
  return hasFilledString(bill.billSentForPaymentDate) && !hasFilledString(bill.paymentDate);
}

function isSupplementaryBillReturned(bill: SupplementaryBillDetail) {
  return !hasFilledString(bill.paymentDate) && hasOpenSupplementaryBillReturn(bill);
}

function isSupplementaryBillResubmitted(bill: SupplementaryBillDetail) {
  return hasCompletedSupplementaryBillReturn(bill);
}

function isSupplementaryBillPaid(bill: SupplementaryBillDetail) {
  return hasSupplementaryBillData(bill) && hasFilledString(bill.paymentDate);
}

function isReturnedSupplementaryBillPaid(bill: SupplementaryBillDetail) {
  return isSupplementaryBillPaid(bill) && hasCompletedSupplementaryBillReturn(bill);
}

function isNormalSupplementaryBillPaid(bill: SupplementaryBillDetail) {
  return isSupplementaryBillPaid(bill) && !hasSupplementaryBillReturnHistory(bill);
}

function getFinancePaymentLiabilityEntries(files: FileRecord[]): FinancePaymentLiabilityEntry[] {
  return files.flatMap((file) => {
    if (isYes(file.demandCancelled)) return [];
    return rawSupplyOrders(file).flatMap((baseOrder) => {
      if (isSupplyOrderCancelled(file, baseOrder)) return [];
      const mainEntries = normalizedFilePaymentOrders({ ...file, supplyOrders: [baseOrder] })
        .filter((order) => order.stageDeliveryLabel !== "Advance Payment")
        .filter((order) => isPaymentOrderActive(file, order))
        .filter((order) => isFinanceMainPaymentLiabilityRelevant(file, order))
        .map(
          (order): FinancePaymentLiabilityEntry => ({
            kind: "main",
            file,
            order,
            sourceDate: order.soDate || baseOrder.soDate,
            paymentDate: order.paymentDate,
            capital: getFinancePaymentCapital(file, order),
            revenue: getFinancePaymentRevenue(file, order),
            pending: hasPaymentWorkflowStarted(file, order) && !hasFilledString(order.paymentDate),
          }),
        );
      const supplementaryEntries = getSupplementaryBills(baseOrder)
        .filter((bill) => isSupplementaryPaymentRelevant(bill))
        .map(
          (bill): FinancePaymentLiabilityEntry => ({
            kind: "supplementary",
            file,
            order: baseOrder,
            bill,
            sourceDate: baseOrder.soDate,
            paymentDate: bill.paymentDate,
            capital: getSupplementaryFinancePaymentCapital(file, bill),
            revenue: getSupplementaryFinancePaymentRevenue(file, bill),
            pending: isSupplementaryPaymentPending(bill),
          }),
        );
      return [...mainEntries, ...supplementaryEntries];
    });
  });
}

function isSupplementaryPaymentRelevant(bill: SupplementaryBillDetail) {
  return (
    hasFilledString(bill.billSentForPaymentDate) ||
    hasFilledString(bill.paymentDate) ||
    hasSupplementaryBillReturnHistory(bill)
  );
}

function isSupplementaryPaymentPending(bill: SupplementaryBillDetail) {
  return (
    !hasFilledString(bill.paymentDate) &&
    (isSupplementaryBillSubmitted(bill) ||
      isSupplementaryBillReturned(bill) ||
      isSupplementaryBillResubmitted(bill))
  );
}

function getFinancePaymentCapital(file: FileRecord, order: SupplyOrderDetail) {
  if (isYes(order.shortclosure)) {
    return (
      getInrAmount(order.actualPaymentCapital, file) ??
      getInrAmount(order.billAmountCapital, file) ??
      0
    );
  }
  return (
    getInrAmount(order.actualPaymentCapital, file) ?? getInrAmount(order.soValueCapital, file) ?? 0
  );
}

function getFinancePaymentRevenue(file: FileRecord, order: SupplyOrderDetail) {
  if (isYes(order.shortclosure)) {
    return (
      getInrAmount(order.actualPaymentRevenue, file) ??
      getInrAmount(order.billAmountRevenue, file) ??
      0
    );
  }
  return (
    getInrAmount(order.actualPaymentRevenue, file) ?? getInrAmount(order.soValueRevenue, file) ?? 0
  );
}

function isFinanceMainPaymentLiabilityRelevant(file: FileRecord, order: SupplyOrderDetail) {
  if (!isYes(order.shortclosure)) return true;
  return (
    hasPaymentWorkflowStarted(file, order) ||
    hasFilledString(order.paymentDate) ||
    hasFilledString(order.actualPaymentCapital) ||
    hasFilledString(order.actualPaymentRevenue) ||
    hasFilledString(order.billAmountCapital) ||
    hasFilledString(order.billAmountRevenue)
  );
}

function getSupplementaryFinancePaymentCapital(file: FileRecord, bill: SupplementaryBillDetail) {
  return (
    getInrAmount(bill.actualPaymentCapital, file) ?? getInrAmount(bill.billAmountCapital, file) ?? 0
  );
}

function getSupplementaryFinancePaymentRevenue(file: FileRecord, bill: SupplementaryBillDetail) {
  return (
    getInrAmount(bill.actualPaymentRevenue, file) ?? getInrAmount(bill.billAmountRevenue, file) ?? 0
  );
}

function hasOpenSupplementaryBillReturn(bill: SupplementaryBillDetail) {
  return (bill.billReturnCycles ?? []).some(
    (cycle) => hasFilledString(cycle.returnedDate) && !hasFilledString(cycle.resubmittedDate),
  );
}

function hasCompletedSupplementaryBillReturn(bill: SupplementaryBillDetail) {
  return (bill.billReturnCycles ?? []).some(
    (cycle) => hasFilledString(cycle.returnedDate) && hasFilledString(cycle.resubmittedDate),
  );
}

function hasAdvancePaymentPaid(file: FileRecord) {
  return advancePaymentEntries([file]).some(
    ({ file: entryFile, order }) =>
      isAdvancePaymentPaid(order) && isPaymentOrderActive(entryFile, order),
  );
}

function hasAdvancePaymentPending(file: FileRecord) {
  return advancePaymentEntries([file]).some(
    ({ file: entryFile, order }) =>
      isAdvancePaymentPending(order) && isPaymentOrderActive(entryFile, order),
  );
}

function hasPaymentWorkflowStarted(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasFilledString(order.billPreparationDate) ||
    hasFilledString(order.billSentForPaymentDate) ||
    hasBillReturnHistory(order) ||
    isPaymentDueByDeliveryOrPeriod(file, order)
  );
}

function isPaymentDueByDeliveryOrPeriod(file: FileRecord, order: SupplyOrderDetail) {
  return hasFilledString(getPaymentWorkflowStartDate(file, order));
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

function getTcecCommittee(file: FileRecord, stage: TcecStatusStage) {
  return stage === "pre"
    ? file.preTcecCommitteeNo?.trim()
    : file.refloatPostTcecCommitteeNo?.trim() || file.postTcecCommitteeNumber?.trim();
}

function getTcecMeetingDate(file: FileRecord, stage: TcecStatusStage) {
  return stage === "pre" ? file.preTcecDate : file.refloatPostTcecDate || file.postTcecDate;
}

function getTcecMinutesDate(file: FileRecord, stage: TcecStatusStage) {
  return stage === "pre"
    ? file.preTcecMinutesDate
    : file.refloatPostTcecMinutesDate || file.postTcecMinutesDate;
}

function isNo(value: string | undefined) {
  return value?.trim().toLowerCase() === "no";
}

function isFileTenderLive(file: FileRecord) {
  const bidDate = isYes(file.refloat) ? file.refloatBiddingDate : file.bidDate;
  const bidOpeningDate = isYes(file.refloat) ? file.refloatBidOpeningDate : file.bidOpeningDate;
  return (
    isBiddingApplicableForFile(file) &&
    !isYes(file.bidOpened) &&
    !isYes(file.biddingStageOver) &&
    hasFilledField(file, isYes(file.refloat) ? "refloatBiddingDate" : "bidDate") &&
    hasFilledField(file, isYes(file.refloat) ? "refloatBidOpeningDate" : "bidOpeningDate") &&
    !isDateAfterToday(bidDate) &&
    !isDateBeforeToday(bidOpeningDate)
  );
}

function isBiddingInProgressFile(file: FileRecord) {
  return (
    isBiddingApplicableForFile(file) &&
    !isYes(file.refloat) &&
    hasFilledString(file.cfaDate) &&
    !isYes(file.biddingStageOver)
  );
}

function isRefloatBiddingInProgressFile(file: FileRecord) {
  return (
    isBiddingApplicableForFile(file) &&
    isYes(file.refloat) &&
    hasFilledString(file.refloatBiddingDate) &&
    !isYes(file.biddingStageOver)
  );
}

function getEffectiveBidOpeningDate(file: FileRecord) {
  return isYes(file.refloat) && hasFilledString(file.refloatBidOpeningDate)
    ? file.refloatBidOpeningDate
    : file.bidOpeningDate;
}

function isRefloatBidOverdue(file: FileRecord) {
  return isNo(file.bidOpened) && isDateBeforeToday(file.refloatBidOpeningDate);
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
  fiscalYear = "",
) {
  if (!isBiddingApplicableForFile(file)) return false;
  const applies = refloat
    ? isYes(file.refloat) && isYes(file.refloatPreBidMeeting)
    : isYes(file.preBidMeeting);
  const date = refloat ? file.refloatPreBidMeetingDate : file.preBidMeetingDate;
  if (!applies || !hasFilledString(date)) return false;
  if (monthKey && getMonthKey(date) !== monthKey) return false;
  if (fiscalYear && fiscalYear !== "all" && getFinancialYearForDate(date) !== fiscalYear) {
    return false;
  }
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

function isBgCurrentOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
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
    isPwbDueForWorkflow(file, order) &&
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
  if (isYes(order.soCancelled)) return true;
  const normalizedCategory = normalizeMilestoneName(category);
  if (isYes(order.shortclosure) && normalizedCategory === "psb") return true;
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
  return hasFilledString(getPaymentWorkflowStartDate(file, order));
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
  if (
    !hasSupplyOrderDate(order) ||
    !isJobCompletionWorkflow(file) ||
    isJobCompletionDone(order) ||
    isYes(order.shortclosure)
  ) {
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
      (order) =>
        !isSupplyOrderCancelled(file, order) &&
        hasSupplyOrderDate(order) &&
        isJobCompletionDone(order),
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
  return isDueDeliveryOrder(file, order) && isCurrentDeliveryPeriodOrder(order);
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
  if (isYes(order.shortclosure)) return order.jobCompletionDate;
  if (!isContractFileType(file) && isNo(file.ir)) return order.jobCompletionDate;
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

function getFinancialYearStartNumber(financialYear: string | undefined) {
  const match = (financialYear ?? "").match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
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

type SnapshotExportRow = {
  section: string;
  metric: string;
  value: string | number;
};

function getSnapshotExportRows(stats: SummaryStat[]): SnapshotExportRow[] {
  return stats.flatMap((stat) => {
    if (Array.isArray(stat.value)) {
      return stat.value.map((item) => ({
        section: stat.label,
        metric: item.label,
        value: item.value,
      }));
    }
    if (isFinanceSplitValue(stat.value)) {
      return [
        { section: stat.label, metric: "Capital", value: stat.value.capital },
        { section: stat.label, metric: "Revenue", value: stat.value.revenue },
      ];
    }
    return [{ section: "Snapshot", metric: stat.label, value: stat.value }];
  });
}

function getDashboardExportDescription({
  globalYear,
  fileYear,
  division,
  fileInitiationDateRange,
  selectedFileCategories,
  visibleFileCategoryOptions,
}: {
  globalYear: string;
  fileYear: string;
  division: string;
  fileInitiationDateRange?: FileInitiationDateRange;
  selectedFileCategories: FileCategoryKey[];
  visibleFileCategoryOptions: FileCategoryOption[];
}) {
  const selectedCategoryLabels = visibleFileCategoryOptions
    .filter((option) => selectedFileCategories.includes(option.key))
    .map((option) => option.label);
  return [
    `Global Filter: ${globalYear}`,
    `File Initiation Year subfilter: ${
      fileYear === "all"
        ? isAllFilesYear(globalYear)
          ? "Entire database"
          : "All file years"
        : fileYear
    }`,
    `Initiation date range: ${formatDateRangeForExport(fileInitiationDateRange)}`,
    `Division: ${division === "all" ? "All accessible divisions" : division}`,
    `File Type: ${
      selectedCategoryLabels.length === visibleFileCategoryOptions.length
        ? "All visible categories"
        : selectedCategoryLabels.join(", ") || "None"
    }`,
  ].join("\n");
}

function formatDateRangeForExport(range: FileInitiationDateRange | undefined) {
  if (!range) return "All initiation dates";
  const fromDate = range.fromDate ? formatIsoDateForDisplay(range.fromDate) : "Start";
  const toDate = range.toDate ? formatIsoDateForDisplay(range.toDate) : "End";
  return `${fromDate} to ${toDate}`;
}

function getAnalyticsExportPanel(
  panel: AnalyticsPanel,
 fullRows: {
    topFirmRows: Array<Record<string, number | string>>;
    indentorsByFilesRows: Array<Record<string, number | string>>;
    indentorsByValueRows: Array<Record<string, number | string>>;
    preBidRows: Array<Record<string, number | string>>;
    selectedPreBidFiscalYear: string;
    tcecMeetingRows: Array<Record<string, number | string>>;
    selectedTcecFiscalYear: string;
    selectedTcecCommittee: string;
    cncRows: Array<Record<string, number | string>>;
    selectedCncFiscalYear: string;
    tcecStage: TcecStatusStage;
  },
): AnalyticsPanel {
  if (panel.key === "topFirms") return { ...panel, rows: fullRows.topFirmRows };
  if (panel.key === "indentorsByFiles") return { ...panel, rows: fullRows.indentorsByFilesRows };
  if (panel.key === "indentorsByValue") return { ...panel, rows: fullRows.indentorsByValueRows };
  if (panel.key === "preBidMeetings") {
    return getPreBidMeetingExportPanel(panel, fullRows);
  }
  if (panel.key === "tcecStatus") {
    return getTcecStatusExportPanel(panel, fullRows);
  }
  if (panel.key === "cncSummary") {
    return getCncSummaryExportPanel(panel, fullRows);
  }
  return panel;
}

function getPreBidMeetingExportPanel(
  panel: AnalyticsPanel,
  context: {
    preBidRows: Array<Record<string, number | string>>;
    selectedPreBidFiscalYear: string;
  },
): AnalyticsPanel {
  const pathItems = ["Dashboard", "Analytics", "Pre-Bid Meetings"];
  if (context.selectedPreBidFiscalYear) {
    pathItems.push(`FY ${context.selectedPreBidFiscalYear}`);
  } else {
    pathItems.push("FY-wise");
  }

  const reportPath = pathItems.join(" > ");
  const purpose = context.selectedPreBidFiscalYear
    ? `Month-wise Pre-Bid Meeting and Refloat Pre-Bid Meeting status in FY ${context.selectedPreBidFiscalYear}.`
    : "FY-wise Pre-Bid Meeting and Refloat Pre-Bid Meeting status.";
  const exportNote = [`Report path: ${reportPath}`, `Purpose: ${purpose}`].join("\n");

  if (context.selectedPreBidFiscalYear) {
    return {
      ...panel,
      title: "Pre-Bid Meetings",
      subtitle: `Month-wise status for FY ${context.selectedPreBidFiscalYear}`,
      exportNote,
      columns: getPreBidMeetingAnalyticsColumns(),
      rows: context.preBidRows,
    };
  }

  return {
    ...panel,
    title: "Pre-Bid Meetings FY-wise status",
    subtitle: "Pre-Bid and Refloat Pre-Bid meeting status",
    exportNote,
    columns: getFiscalPreBidMeetingAnalyticsColumns(() => undefined),
    rows: context.preBidRows,
  };
}

function getTcecStatusExportPanel(
  panel: AnalyticsPanel,
  context: {
    tcecMeetingRows: Array<Record<string, number | string>>;
    selectedTcecFiscalYear: string;
    selectedTcecCommittee: string;
    tcecStage: TcecStatusStage;
  },
): AnalyticsPanel {
  const stageLabel = getTcecStageLabel(context.tcecStage);
  const pathItems = ["Dashboard", "Analytics", "TCEC summary", stageLabel];

  if (context.selectedTcecFiscalYear) {
    pathItems.push(`FY ${context.selectedTcecFiscalYear}`);
  } else {
    pathItems.push("FY-wise");
  }

  if (context.selectedTcecCommittee) pathItems.push(context.selectedTcecCommittee);

  const reportPath = pathItems.join(" > ");
  const purpose = getTcecExportPurpose(context);
  const exportNote = [`Report path: ${reportPath}`, `Purpose: ${purpose}`].join("\n");

  if (context.selectedTcecCommittee) {
    return {
      ...panel,
      title: `${stageLabel} - ${context.selectedTcecCommittee}`,
      subtitle: `Meeting-date wise status for FY ${context.selectedTcecFiscalYear}`,
      exportNote,
      columns: getTcecMeetingColumns(context.tcecStage),
      rows: context.tcecMeetingRows,
    };
  }

  if (context.selectedTcecFiscalYear) {
    return {
      ...panel,
      title: `${stageLabel} committee-wise status`,
      subtitle: `FY ${context.selectedTcecFiscalYear}`,
      exportNote,
      columns: getTcecStatusColumns(context.tcecStage, () => undefined),
      rows: panel.rows,
    };
  }

  return {
    ...panel,
    title: `${stageLabel} FY-wise status`,
    subtitle: "Files reviewed, minutes signed, and minutes pending",
    exportNote,
    columns: getFiscalTcecStatusColumns(context.tcecStage, () => undefined),
    rows: panel.rows,
  };
}

function getCncSummaryExportPanel(
  panel: AnalyticsPanel,
  context: {
    cncRows: Array<Record<string, number | string>>;
    selectedCncFiscalYear: string;
  },
): AnalyticsPanel {
  const pathItems = ["Dashboard", "Analytics", "CNC summary"];
  if (context.selectedCncFiscalYear) {
    pathItems.push(`FY ${context.selectedCncFiscalYear}`);
  } else {
    pathItems.push("FY-wise");
  }

  const reportPath = pathItems.join(" > ");
  const purpose = context.selectedCncFiscalYear
    ? `CNC date-wise review, approval, financial sanction, and S.O. status in FY ${context.selectedCncFiscalYear}.`
    : "FY-wise CNC review, approval, financial sanction, and S.O. status.";
  const exportNote = [`Report path: ${reportPath}`, `Purpose: ${purpose}`].join("\n");

  if (context.selectedCncFiscalYear) {
    return {
      ...panel,
      title: "CNC summary",
      subtitle: `CNC date-wise status for FY ${context.selectedCncFiscalYear}`,
      exportNote,
      columns: getCncSummaryColumns(),
      rows: context.cncRows,
    };
  }

  return {
    ...panel,
    title: "CNC summary FY-wise status",
    subtitle: "CNC review, approval, financial sanction, and S.O. status",
    exportNote,
    columns: getFiscalCncSummaryColumns(() => undefined),
    rows: context.cncRows,
  };
}

function getTcecStageLabel(stage: TcecStatusStage) {
  return stage === "pre" ? "Pre-TCEC" : "Post-TCEC";
}

function getTcecExportPurpose(context: {
  tcecStage: TcecStatusStage;
  selectedTcecFiscalYear: string;
  selectedTcecCommittee: string;
}) {
  const stageLabel = getTcecStageLabel(context.tcecStage);
  if (context.selectedTcecCommittee) {
    return `${stageLabel} meeting-date status for ${context.selectedTcecCommittee} in FY ${context.selectedTcecFiscalYear}.`;
  }
  if (context.selectedTcecFiscalYear) {
    return `${stageLabel} committee-wise status in FY ${context.selectedTcecFiscalYear}.`;
  }
  return `${stageLabel} FY-wise review and minutes status.`;
}

const dashboardFilterTitles: Record<string, string> = {
  deliveryCompleted: "Delivery Completed",
  deliveryDue: "Delivery Pending",
  deliveryOverdue: "Delivery Overdue",
  jobCompletionCompleted: "Job Completion Done",
  jobCompletionDue: "Job Completion Due",
  jobCompletionLive: "Job Completion Due",
  jobCompletionPeriodOver: "Milestone Period Over",
  deliveryPeriodLive: "Delivery Period / Milestone - Live",
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
  analyticsPaymentPending: "Analytics - Payment pending by division",
  paymentDueOnly: "Payment - Due",
  paymentInProcess: "Payment - In process",
  paymentSubmitted: "Payment - Submitted and unpaid",
  advancePaid: "Payment - Advance Paid",
  advancePending: "Payment - Advance Pending",
  "billReturn:any": "Bills returned",
  "billReturn:pending": "Returned bills pending",
  "billReturn:resubmitted": "Returned bills resubmitted",
  "billReturn:paid": "Returned bills paid",
  "supplementaryBill:any": "Payment - Supplementary returned",
  "supplementaryBill:submitted": "Payment - Supplementary submitted total",
  "supplementaryBill:pending": "Payment - Supplementary pending",
  "supplementaryBill:returned": "Payment - Supplementary returned",
  "supplementaryBill:resubmitted": "Payment - Supplementary resubmitted",
  "supplementaryBill:paid": "Payment - Normal supplementary paid",
  "supplementaryBill:returnPaid": "Payment - Returned supplementary paid",
  miscLiveFiles: "Miscellaneous - Live files",
  miscFileClosed: "Miscellaneous - File closed",
  miscLd: "Miscellaneous - LD",
  miscDemandCancelled: "Miscellaneous - Demand cancelled",
  miscSoCancelled: "Miscellaneous - S.O. cancelled",
  miscShortclosedSo: "Miscellaneous - Shortclosed S.O.",
  miscMultipleSupplyOrders: "Miscellaneous - Files with Multiple S.O.",
};

function isPaymentDue(file: FileRecord) {
  return isPaymentPending(file);
}

function hasPaymentDueOnly(file: FileRecord) {
  return effectivePaymentEntries([file]).some(({ file: entryFile, order }) =>
    isPaymentDueOrder(entryFile, order),
  );
}

function hasPaymentInProcess(file: FileRecord) {
  return effectivePaymentEntries([file]).some(({ file: entryFile, order }) =>
    isPaymentInProcessOrder(entryFile, order),
  );
}

function hasPaymentSubmitted(file: FileRecord) {
  return effectivePaymentEntries([file]).some(({ file: entryFile, order }) =>
    isPaymentSubmittedOrder(entryFile, order),
  );
}

function isPaymentCompleted(file: FileRecord) {
  return effectivePaymentEntries([file]).some(
    ({ file: entryFile, order }) =>
      hasFilledString(order.paymentDate) && isPaymentOrderActive(entryFile, order),
  );
}

function matchesFinanceCarryForwardFilter(file: FileRecord, filter: string) {
  const [, mode = "", rawSelectedYear = "", rawSourceYear = ""] = filter.split(":");
  const selectedYear = decodeStatusFilterPart(rawSelectedYear);
  const sourceYear = decodeStatusFilterPart(rawSourceYear);
  const range = getFinancialYearDateRange(selectedYear);
  if (!selectedYear || !sourceYear || !range) return false;
  const matchesEntry = (sourceDate: string | undefined, paymentDate: string | undefined) => {
    const orderYear = getFinancialYearForDate(sourceDate);
    if (!orderYear) return false;
    const paidInSelectedYear = isDateWithinRange(paymentDate, range);
    const unpaidAtSelectedYearEnd =
      !hasFilledString(paymentDate) || isDateAfter(paymentDate, range.end);
    if (mode === "futureClearedCarryForward") {
      return (
        orderYear === selectedYear &&
        hasFilledString(paymentDate) &&
        isDateAfter(paymentDate, range.end) &&
        getFinancialYearForDate(paymentDate) === sourceYear
      );
    }
    if (orderYear !== sourceYear) return false;
    if (mode === "carryForward") return orderYear === selectedYear && unpaidAtSelectedYearEnd;
    if (mode === "clearedCarryForward") return orderYear < selectedYear && paidInSelectedYear;
    if (mode === "previousCarryForward") return orderYear < selectedYear && unpaidAtSelectedYearEnd;
    return false;
  };
  return (
    getFinancePaymentLiabilityEntries([file]).some((entry) =>
      matchesEntry(entry.sourceDate, entry.paymentDate),
    ) ||
    advancePaymentEntries([file]).some(
      ({ file: entryFile, order }) =>
        !isSupplyOrderCancelled(entryFile, order) &&
        matchesEntry(order.soDate, order.advancePaymentDetail?.paymentDate),
    )
  );
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
  if (milestone === "Miscellaneous") {
    const miscFilters: Record<string, string> = {
      "Live files": "miscLiveFiles",
      "File closed": "miscFileClosed",
      LD: "miscLd",
      "Demand cancelled": "miscDemandCancelled",
      "S.O. cancelled": "miscSoCancelled",
      "Shortclosed S.O.": "miscShortclosedSo",
      "Files with Multiple S.O.": "miscMultipleSupplyOrders",
    };
    return miscFilters[stage] ?? "miscLiveFiles";
  }
  const filterMilestone =
    normalizeMilestoneName(milestone) === "deliveryperiodmilestone" ? "Delivery Period" : milestone;
  return `statusSummary:${encodeURIComponent(filterMilestone)}:${encodeURIComponent(stage)}`;
}

function serializeDrillPath(parts: DrillPathItem[]) {
  const cleanParts = parts
    .map((part) => ({
      label: part.label.trim(),
      href: part.href?.trim() || undefined,
    }))
    .filter((part) => part.label);
  return cleanParts.length ? JSON.stringify(cleanParts) : undefined;
}

function drillItem(label: string, href?: string): DrillPathItem {
  return { label, href };
}

function getDashboardTabDrillLabel(tab: DashboardTab) {
  if (tab === "status") return "Status-1";
  if (tab === "liveStatus") return "Status-2";
  if (tab === "status3") return "Status-3";
  if (tab === "status4") return "Status-4";
  if (tab === "snapshot") return "Snapshot";
  if (tab === "analytics") return "Analytics";
  if (tab === "finance") return "Finance";
  if (tab === "finance1") return "FY Snapshot";
  return "Dashboard";
}

function getDashboardTabHref(tab: DashboardTab) {
  if (tab === "status") return "/dashboard?tab=status";
  if (tab === "liveStatus") return "/dashboard?tab=liveStatus";
  if (tab === "status3") return "/dashboard?tab=status3";
  if (tab === "status4") return "/dashboard?tab=status4";
  if (tab === "snapshot") return "/dashboard?tab=snapshot";
  if (tab === "analytics") return "/dashboard?tab=analytics";
  if (tab === "finance") return "/dashboard?tab=finance";
  if (tab === "finance1") return "/dashboard?tab=finance1";
  return "/dashboard";
}

function getAnalyticsPanelHref(panel: AnalyticsPanelKey) {
  return `/dashboard?tab=analytics&analyticsPanel=${encodeURIComponent(panel)}`;
}

function splitDashboardFilterTitle(title: string) {
  return title
    .split(" - ")
    .map((part) => part.trim())
    .filter(Boolean);
}

function getDashboardDrillPath(tab: DashboardTab, dashboardFilter: string) {
  const tabHref = getDashboardTabHref(tab);
  return [
    drillItem("Dashboard", "/dashboard"),
    drillItem(getDashboardTabDrillLabel(tab), tabHref),
    ...splitDashboardFilterTitle(getDashboardFilterTitle(dashboardFilter)).map((part) =>
      drillItem(part, tabHref),
    ),
  ];
}

function getStatus4DrillPath(filter: Status4SearchFilter) {
  const status4Href = "/dashboard?tab=status4";
  const parts = [
    drillItem("Dashboard", "/dashboard"),
    drillItem("Status-4", status4Href),
    drillItem(filter.fiscalYear, status4Href),
  ];
  if (filter.monthKey) parts.push(drillItem(formatMonthKeyLabel(filter.monthKey), status4Href));
  if (filter.minValue !== undefined || filter.maxValue !== undefined) {
    parts.push(
      drillItem(formatStatus4ValueRangeTitle(filter.minValue, filter.maxValue), status4Href),
    );
  }
  parts.push(
    drillItem(filter.milestone, status4Href),
    drillItem(getStatus4MetricLabel(filter.metric)),
  );
  return parts;
}

function getAnalyticsDrillPath(
  panel: AnalyticsPanelKey,
  panelTitle: string,
  dashboardFilter: string | undefined,
) {
  const analyticsHref = getAnalyticsPanelHref(panel);
  return [
    drillItem("Dashboard", "/dashboard"),
    drillItem("Analytics", analyticsHref),
    drillItem(panelTitle, analyticsHref),
    ...(dashboardFilter
      ? splitDashboardFilterTitle(getDashboardFilterTitle(dashboardFilter)).map((part) =>
          drillItem(part, analyticsHref),
        )
      : []),
  ];
}

function matchesStatus4DashboardFilter(file: FileRecord, filter: string) {
  const [
    ,
    rawMilestone = "",
    rawMetric = "current",
    rawFiscalYear = "",
    rawMonthKey = "all",
    rawMin = "",
    rawMax = "",
  ] = filter.split(":");
  const milestone = decodeStatusFilterPart(rawMilestone);
  const metric = isStatus4MetricKey(rawMetric) ? rawMetric : "current";
  const fiscalYear = decodeStatusFilterPart(rawFiscalYear);
  const monthKey = decodeStatusFilterPart(rawMonthKey);
  const minValue = parseAmount(rawMin);
  const maxValue = parseAmount(rawMax);
  if (fiscalYear && fiscalYear !== "all" && getStatus4FileFiscalYear(file) !== fiscalYear) {
    return false;
  }
  if (monthKey && monthKey !== "all" && getMonthKey(file.receivedDate) !== monthKey) {
    return false;
  }
  if (!isStatus4ValueRangeMatch(file, minValue, maxValue)) return false;
  return isStatus4MetricMatch(file, milestone, metric);
}

function matchesDashboardFilter(file: FileRecord, filter: string) {
  if (!shouldAllowDemandCancelledDashboardFilter(filter) && isYes(file.demandCancelled)) {
    return false;
  }
  if (!shouldAllowInactiveDashboardFilter(filter) && isCancelledFile(file)) return false;
  if (filter.startsWith("financeCarryForward:")) {
    return matchesFinanceCarryForwardFilter(file, filter);
  }
  if (filter.startsWith("status4:")) return matchesStatus4DashboardFilter(file, filter);
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
    return rawSupplyOrders(file).some((order) => getMonthKey(order.soDate) === monthKey);
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
  if (filter.startsWith("tcecStatusFy:")) return matchesTcecStatusFiscalYearFilter(file, filter);
  if (filter.startsWith("tcecStatus:")) return matchesTcecStatusFilter(file, filter);
  if (filter.startsWith("cncSummaryFy:")) return matchesCncSummaryFiscalYearFilter(file, filter);
  if (filter.startsWith("cncSummary:")) return matchesCncSummaryFilter(file, filter);
  if (filter.startsWith("mode:")) {
    return matchesBiddingModeValue(file.mode, decodeURIComponent(filter.slice("mode:".length)));
  }
  if (filter === "divisionTurnaroundSample") return isDivisionTurnaroundSample(file);
  if (filter.startsWith("gemBiddingMode:")) {
    const mode = decodeURIComponent(filter.slice("gemBiddingMode:".length)).trim().toLowerCase();
    return isYes(file.gem) && (file.gemBiddingMode ?? "").trim().toLowerCase() === mode;
  }
  if (filter.startsWith("manualMilestoneCurrent:")) {
    const milestone = filter.slice("manualMilestoneCurrent:".length);
    const normalized = normalizeMilestoneName(milestone);
    if (isBgMilestoneKey(normalized)) return isBgToBeReceived(file, milestone);
    if (normalized === "supplementarybillreturnedforcorrection") {
      return hasSupplementaryBillReturned(file);
    }
    if (normalized === "refloatbidding") {
      return !isCancelledFile(file) && isRefloatBiddingInProgressFile(file);
    }
    if (normalized === "refloatposttcec") {
      return (
        !isCancelledFile(file) &&
        isYes(file.refloat) &&
        isYes(file.tcec) &&
        isYes(file.biddingStageOver) &&
        !hasFilledField(file, "refloatPostTcecMinutesDate")
      );
    }
    if (normalized === "bidding") {
      return (
        !isCancelledFile(file) &&
        isBiddingApplicableForFile(file) &&
        !isYes(file.refloat) &&
        hasFilledString(file.cfaDate) &&
        !isYes(file.biddingStageOver)
      );
    }
    if (isSupplyOrderDrivenMilestoneName(milestone)) {
      return matchesCurrentSupplyOrderDrivenMilestone(file, milestone);
    }
    return file.currentMilestone === milestone;
  }
  if (filter.startsWith("manualMilestoneCompleted:")) {
    const milestone = filter.slice("manualMilestoneCompleted:".length);
    const normalized = normalizeMilestoneName(milestone);
    if (isBgMilestoneKey(normalized)) return isBgReceived(file, milestone);
    if (normalized === "refloatbidding") {
      return !isCancelledFile(file) && isYes(file.refloat) && isYes(file.biddingStageOver);
    }
    if (normalized === "refloatposttcec") {
      return (
        !isCancelledFile(file) &&
        isYes(file.refloat) &&
        isYes(file.tcec) &&
        hasFilledField(file, "refloatPostTcecMinutesDate")
      );
    }
    if (normalized === "bidding") {
      return (
        !isCancelledFile(file) &&
        isBiddingApplicableForFile(file) &&
        !isYes(file.refloat) &&
        isYes(file.biddingStageOver)
      );
    }
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
  if (filter === "liveBids") return isBiddingInProgressFile(file) && isFileTenderLive(file);
  if (filter === "bidOverdue") return isBiddingInProgressFile(file) && isBidOverdue(file);
  if (filter.startsWith("preBidMeetingCombined:")) {
    const [, state = "all", monthKey = ""] = filter.split(":");
    if (state === "all") {
      return (
        isPreBidMeetingStatus(file, false, "due", monthKey) ||
        isPreBidMeetingStatus(file, false, "completed", monthKey) ||
        isPreBidMeetingStatus(file, true, "due", monthKey) ||
        isPreBidMeetingStatus(file, true, "completed", monthKey)
      );
    }
    if (state === "due" || state === "completed") {
      return (
        isPreBidMeetingStatus(file, false, state, monthKey) ||
        isPreBidMeetingStatus(file, true, state, monthKey)
      );
    }
    return false;
  }
  if (filter.startsWith("preBidMeetingCombinedFy:")) {
    const [, state = "all", fiscalYear = ""] = filter.split(":");
    if (state === "all") {
      return (
        isPreBidMeetingStatus(file, false, "due", "", fiscalYear) ||
        isPreBidMeetingStatus(file, false, "completed", "", fiscalYear) ||
        isPreBidMeetingStatus(file, true, "due", "", fiscalYear) ||
        isPreBidMeetingStatus(file, true, "completed", "", fiscalYear)
      );
    }
    if (state === "due" || state === "completed") {
      return (
        isPreBidMeetingStatus(file, false, state, "", fiscalYear) ||
        isPreBidMeetingStatus(file, true, state, "", fiscalYear)
      );
    }
    return false;
  }
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
  if (filter === "deliveryPeriodLive")
    return isDeliveryPeriodValid(file) || isDeliveryPeriodExtended(file);
  if (filter === "irPreparationPending") return isIrPreparationPending(file);
  if (filter === "irReceiptPending") return isIrReceiptPending(file);
  if (filter === "irCompleted") return isIrCompleted(file);
  if (filter === "paymentDue") return isPaymentDue(file);
  if (filter === "paymentDueOnly") return hasPaymentDueOnly(file);
  if (filter === "paymentInProcess") return hasPaymentInProcess(file);
  if (filter === "paymentSubmitted") return hasPaymentSubmitted(file);
  if (filter === "advancePaid") return hasAdvancePaymentPaid(file);
  if (filter === "advancePending") return hasAdvancePaymentPending(file);
  if (filter === "supplementaryBill:any") return hasSupplementaryBillReturnHistoryFile(file);
  if (filter === "supplementaryBill:submitted") return hasSupplementaryBillSubmitted(file);
  if (filter === "supplementaryBill:pending") return hasSupplementaryBillPending(file);
  if (filter === "supplementaryBill:returned") return hasSupplementaryBillReturned(file);
  if (filter === "supplementaryBill:resubmitted") return hasSupplementaryBillResubmitted(file);
  if (filter === "supplementaryBill:paid") return hasSupplementaryBillPaid(file);
  if (filter === "supplementaryBill:returnPaid") return hasReturnedSupplementaryBillPaid(file);
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
    if (milestone.key === "financialSanction") {
      return (
        matchesCurrentSupplyOrderDrivenMilestone(file, "financialsanction") ||
        matchesCompletedSupplyOrderDrivenMilestone(file, "financialsanction")
      );
    }
    return isBgMilestoneKey(milestone.key)
      ? fileSupplyOrders(file).some((order) => isBgCategoryApplicable(file, order, milestone.key))
      : isMilestoneApplicable(file, milestone);
  }
  if (filter.startsWith("milestoneUnderProcess:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(22));
    if (milestone?.key === "refloatPostTcec") {
      return isYes(file.refloat) && isYes(file.tcec) && !isYes(file.biddingStageOver);
    }
    if (milestone?.key === "refloatBidding") return false;
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
        isBiddingInProgressFile(file) &&
        !isFileTenderLive(file) &&
        !isBidOverdue(file)
      );
    }
    if (milestone.key === "refloatBidding") {
      return (
        isRefloatBiddingInProgressFile(file) &&
        !isFileTenderLive(file) &&
        !isRefloatBidOverdue(file)
      );
    }
    if (milestone.key === "refloatPostTcec") {
      return (
        isYes(file.refloat) &&
        isYes(file.tcec) &&
        isYes(file.biddingStageOver) &&
        !hasFilledField(file, "refloatPostTcecMinutesDate")
      );
    }
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
    if (milestone?.key === "refloatPostTcec") {
      return (
        isYes(file.refloat) &&
        isYes(file.tcec) &&
        isYes(file.biddingStageOver) &&
        hasFilledField(file, "refloatPostTcecDate") &&
        !hasFilledField(file, "refloatPostTcecMinutesDate")
      );
    }
    return milestone ? isMilestoneReviewed(file, milestone) : true;
  }
  if (filter.startsWith("milestonePending:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(17));
    if (milestone?.key === "refloatBidding") {
      return isRefloatBiddingInProgressFile(file);
    }
    if (milestone?.key === "refloatPostTcec") {
      return (
        isYes(file.refloat) &&
        isYes(file.tcec) &&
        isYes(file.biddingStageOver) &&
        !hasFilledField(file, "refloatPostTcecMinutesDate")
      );
    }
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
    if (milestone.key === "refloatBidding") {
      return isYes(file.refloat) && isYes(file.biddingStageOver);
    }
    if (milestone.key === "refloatPostTcec") {
      return (
        isYes(file.refloat) &&
        isYes(file.tcec) &&
        hasFilledField(file, "refloatPostTcecMinutesDate")
      );
    }
    if (milestone.key === "payment") return isPaymentCompleted(file);
    if (milestone.key === "supplyOrder") return isStatus4SupplyOrderCleared(file);
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
  const fileCommittee = getTcecCommittee(file, stage);
  if ((fileCommittee ?? "").toLowerCase() !== committee) return false;
  const minutesDate = getTcecMinutesDate(file, stage);
  const fileMeetingDate = getTcecMeetingDate(file, stage);
  if (metric === "signed" && !hasFilledString(minutesDate)) return false;
  if (metric === "pending" && hasFilledString(minutesDate)) return false;
  if (meetingDate && fileMeetingDate !== meetingDate) return false;
  return true;
}

function matchesTcecStatusFiscalYearFilter(file: FileRecord, filter: string) {
  const [, rawStage = "pre", rawMetric = "reviewed", rawFiscalYear = "", rawCommittee = ""] =
    filter.split(":");
  const stage = decodeStatusFilterPart(rawStage) === "post" ? "post" : "pre";
  const metric = decodeStatusFilterPart(rawMetric);
  if (metric !== "reviewed" && metric !== "signed" && metric !== "pending") return false;
  const fiscalYear = decodeStatusFilterPart(rawFiscalYear).trim();
  const committee = decodeStatusFilterPart(rawCommittee).trim().toLowerCase();
  const fileCommittee = getTcecCommittee(file, stage);
  if (committee && (fileCommittee ?? "").toLowerCase() !== committee) return false;
  const meetingDate = getTcecMeetingDate(file, stage);
  if (!hasFilledString(meetingDate)) return false;
  if (fiscalYear !== "all" && getFinancialYearForDate(meetingDate) !== fiscalYear) return false;
  const minutesDate = getTcecMinutesDate(file, stage);
  if (metric === "signed" && !hasFilledString(minutesDate)) return false;
  if (metric === "pending" && hasFilledString(minutesDate)) return false;
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

function matchesCncSummaryFiscalYearFilter(file: FileRecord, filter: string) {
  const [, rawMetric = "reviewed", rawFiscalYear = ""] = filter.split(":");
  const metric = decodeStatusFilterPart(rawMetric);
  const fiscalYear = decodeStatusFilterPart(rawFiscalYear).trim();
  if (!hasFilledString(file.cncDate)) return false;
  if (fiscalYear !== "all" && getFinancialYearForDate(file.cncDate) !== fiscalYear) return false;
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
    filter === "miscShortclosedSo" ||
    filter.startsWith("supplyOrderMonth:") ||
    filter.startsWith("supplyOrderYear:")
  );
}

function isInactiveHistoryDashboardFilter(filter: string) {
  return (
    filter === "divisionTurnaroundSample" ||
    filter.startsWith("mode:") ||
    filter.startsWith("gemBiddingMode:") ||
    filter.startsWith("preBidMeetingCombined:") ||
    filter.startsWith("preBidMeetingCombinedFy:") ||
    filter.startsWith("preBidMeeting:") ||
    filter.startsWith("refloatPreBidMeeting:") ||
    filter.startsWith("preBidMeetingFy:") ||
    filter.startsWith("refloatPreBidMeetingFy:") ||
    filter.startsWith("tcecStatus:") ||
    filter.startsWith("tcecStatusFy:") ||
    filter.startsWith("cncSummary:") ||
    filter.startsWith("cncSummaryFy:")
  );
}

function shouldAllowInactiveDashboardFilter(filter: string) {
  return (
    filter.startsWith("attribute:") ||
    filter.startsWith("fileType:") ||
    filter.startsWith("fileCategory:") ||
    filter.startsWith("firmType:") ||
    filter.startsWith("status4:") ||
    filter === "milestoneTotal:supplyOrder" ||
    filter === "milestoneCleared:supplyOrder" ||
    filter.startsWith("valueThreshold:") ||
    filter.startsWith("valueThresholdTotal:") ||
    filter.startsWith("soValueThreshold:") ||
    filter.startsWith("soValueThresholdTotal:") ||
    isCancellationDashboardFilter(filter) ||
    isInactiveHistoryDashboardFilter(filter)
  );
}

function shouldAllowDemandCancelledDashboardFilter(filter: string) {
  return filter === "miscDemandCancelled";
}

function isDivisionTurnaroundSample(file: FileRecord) {
  const days = getDayDifference(file.receivedDate, getFirstSoDate(file));
  return days !== undefined && days >= 0;
}

function matchesBiddingModeValue(value: string | undefined, expected: string) {
  const normalizedValue = (value ?? "").trim().toUpperCase();
  const normalizedExpected = expected.trim().toUpperCase();
  if (normalizedExpected === "UNASSIGNED") return !normalizedValue;
  return normalizedValue === normalizedExpected;
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
    if (stageKey === "atpreviousstage") {
      return (
        matchesCurrentSupplyOrderDrivenMilestone(file, "financialsanction") &&
        !matchesCompletedSupplyOrderDrivenMilestone(file, "supplyorder")
      );
    }
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

  if (milestoneKey === "billreturnedforcorrection" || milestoneKey === "returnedbills") {
    const orders = normalizedFilePaymentOrders(file).filter((order) =>
      isPaymentOrderActive(file, order),
    );
    if (stageKey === "total" || stageKey === "billsreturned") return orders.some(hasReturnedBill);
    if (stageKey === "pending" || stageKey === "returnpending") return orders.some(hasOpenBillReturn);
    if (stageKey === "completed" || stageKey === "resubmitted")
      return orders.some(hasCompletedBillReturn);
    if (stageKey === "returnedpaid") return orders.some(hasReturnedBillPaid);
  }

  if (milestoneKey === "supplementarybills") {
    if (stageKey === "submitted") return hasSupplementaryBillPending(file);
    if (stageKey === "returned") return hasSupplementaryBillReturned(file);
    if (stageKey === "resubmitted") return hasSupplementaryBillResubmitted(file);
    if (stageKey === "paid") return hasSupplementaryBillPaid(file);
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
    if (stageKey === "returned") return isBgReturned(file, category);
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

  if (milestoneKey === "bidding") {
    const biddingInProgress = isBiddingInProgressFile(file);
    if (stageKey === "live") return biddingInProgress && isFileTenderLive(file);
    if (stageKey === "inprocess") {
      return biddingInProgress && !isFileTenderLive(file) && !isBidOverdue(file);
    }
    if (stageKey === "openingoverdue") return biddingInProgress && isBidOverdue(file);
    if (stageKey === "completed") {
      const milestone = milestoneDefinitions.find((item) => item.key === "bidding");
      return Boolean(milestone && !isCancelledFile(file) && isMilestoneComplete(file, milestone));
    }
  }

  if (milestoneKey === "payment") {
    if (stageKey === "completed") return isPaymentCompleted(file);
    if (stageKey === "pending") return isPaymentPending(file);
    if (stageKey === "due") return hasPaymentDueOnly(file);
    if (stageKey === "inprocess") return hasPaymentInProcess(file);
    if (stageKey === "submitted" || stageKey === "submittedandunpaid")
      return hasPaymentSubmitted(file);
    if (stageKey === "total" || stageKey === "totalfiles") {
      return isPaymentPending(file) || isPaymentCompleted(file);
    }
  }

  if (milestoneKey === "supplementarybill" || milestoneKey === "supplementarybills") {
    if (stageKey === "submittedtotal" || stageKey === "submitted")
      return hasSupplementaryBillSubmitted(file);
    if (stageKey === "returnedtotal" || stageKey === "returned")
      return hasSupplementaryBillReturnHistoryFile(file);
    if (stageKey === "returnpending") return hasSupplementaryBillReturned(file);
    if (stageKey === "resubmittedtotal" || stageKey === "resubmitted")
      return hasSupplementaryBillResubmitted(file);
    if (stageKey === "returnedpaid") return hasReturnedSupplementaryBillPaid(file);
    if (stageKey === "normalpaid" || stageKey === "paid") return hasSupplementaryBillPaid(file);
    if (stageKey === "pending") return hasSupplementaryBillPending(file);
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

  if (milestone.key === "refloatBidding") {
    const refloatInProgress = isRefloatBiddingInProgressFile(file);
    if (stageKey === "live") return refloatInProgress && isFileTenderLive(file);
    if (stageKey === "inprocess")
      return refloatInProgress && !isFileTenderLive(file) && !isRefloatBidOverdue(file);
    if (stageKey === "openingoverdue") return refloatInProgress && isRefloatBidOverdue(file);
    if (stageKey === "completed") return inProcess && isMilestoneComplete(file, milestone);
    if (stageKey === "atpreviousstage" || stageKey === "atpreviousstages") return false;
  }

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
  if (stageKey === "live" && milestone.key === "bidding")
    return isBiddingInProgressFile(file) && isFileTenderLive(file);
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
    const milestoneLabel = getWorkflowDisplayLabel(milestone.label);
    if ("valid" in milestone) {
      rows.push(
        { section: milestoneLabel, metric: "Valid", count: milestone.valid },
        { section: milestoneLabel, metric: "Expired", count: milestone.expired },
        { section: milestoneLabel, metric: "Extended", count: milestone.extended },
      );
      return;
    }

    if ("due" in milestone) {
      rows.push(
        { section: milestoneLabel, metric: "Completed", count: milestone.completed },
        { section: milestoneLabel, metric: "Pending", count: milestone.due },
        { section: milestoneLabel, metric: "Overdue", count: milestone.overdue },
      );
      return;
    }

    if ("irPreparationPending" in milestone) {
      rows.push(
        {
          section: milestoneLabel,
          metric: "IR Preparation Pending",
          count: milestone.irPreparationPending,
        },
        {
          section: milestoneLabel,
          metric: "IR Receipt Pending",
          count: milestone.irReceiptPending,
        },
        { section: milestoneLabel, metric: "IR Completed", count: milestone.irCompleted },
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
        onPaymentDueClick: noop,
        onPaymentInProcessClick: noop,
        onPaymentSubmittedClick: noop,
        onBillsReturnedClick: noop,
        onReturnedBillsPendingClick: noop,
        onReturnedBillsResubmittedClick: noop,
        onReturnedBillsPaidClick: noop,
        onSupplementaryPendingClick: noop,
        onSupplementaryReturnedClick: noop,
        onSupplementaryReturnedPendingClick: noop,
        onSupplementaryResubmittedClick: noop,
        onSupplementaryPaidClick: noop,
        onReturnedSupplementaryPaidClick: noop,
        onSupplementaryPaymentPendingClick: noop,
      }),
      milestone.key,
    ).forEach((metric) => {
      rows.push({ section: milestoneLabel, metric: metric.label, count: metric.count });
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
      metric: "Shortclosed S.O.",
      count: miscellaneousCounts.shortclosedSo,
    },
    {
      section: "Miscellaneous",
      metric: "Files with Multiple S.O.",
      count: miscellaneousCounts.multipleSupplyOrders,
    },
  );

  return rows;
}

function exportStatusSummaryGroupsToExcel(
  groups: StatusSummaryTableGroup[],
  title: string,
  description?: string,
) {
  void downloadStatusSummaryGroups(groups, title, "excel", description);
}

function printStatusSummaryGroupsToPdf(
  groups: StatusSummaryTableGroup[],
  title: string,
  description?: string,
) {
  void downloadStatusSummaryGroups(groups, title, "pdf", description);
}

async function downloadStatusSummaryGroups(
  groups: StatusSummaryTableGroup[],
  title: string,
  format: "excel" | "pdf",
  description?: string,
) {
  await downloadBackendExport({
    format,
    title,
    description,
    tables: groups.map((group) => ({
      title: group.title,
      headers: ["S.No.", "Milestone", ...group.columns],
      rows: group.rows.map((row, index) => [
        index + 1,
        getWorkflowDisplayLabel(row.milestone),
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
                <td>${escapeHtml(getWorkflowDisplayLabel(row.milestone))}</td>
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

function exportStatusPageRowsToExcel(
  rows: StatusPageExportRow[],
  title: string,
  description?: string,
) {
  void downloadStatusPageRows(rows, title, "excel", description);
}

function getLiveStatusTableHtml(rows: LiveStatusDivisionRow[], milestones: LiveStatusMilestone[]) {
  const headers = [
    "S.No.",
    "Division",
    "Total",
    ...milestones.map((milestone) => getWorkflowDisplayLabel(milestone.label)),
  ];
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
                        ...milestones.map((milestone) =>
                          String(getLiveStatusRowMilestoneCount(row, milestone)),
                        ),
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
  description?: string,
) {
  void downloadLiveStatusRows(rows, milestones, title, "excel", description);
}

function printLiveStatusRowsToPdf(
  rows: LiveStatusDivisionRow[],
  milestones: LiveStatusMilestone[],
  title: string,
  description?: string,
) {
  void downloadLiveStatusRows(rows, milestones, title, "pdf", description);
}

function printStatusPageRowsToPdf(
  rows: StatusPageExportRow[],
  title: string,
  description?: string,
) {
  void downloadStatusPageRows(rows, title, "pdf", description);
}

function exportSnapshotRowsToExcel(rows: SnapshotExportRow[], title: string, description?: string) {
  void downloadSnapshotRows(rows, title, "excel", description);
}

function printSnapshotRowsToPdf(rows: SnapshotExportRow[], title: string, description?: string) {
  void downloadSnapshotRows(rows, title, "pdf", description);
}

async function downloadSnapshotRows(
  rows: SnapshotExportRow[],
  title: string,
  format: "excel" | "pdf",
  description?: string,
) {
  await downloadBackendExport({
    format,
    title,
    description,
    tables: [
      {
        headers: ["S.No.", "Section", "Metric", "Value"],
        rows: rows.map((row, index) => [index + 1, row.section, row.metric, row.value]),
      },
    ],
  });
}

function exportStatus4RowsToExcel(
  rows: Status4TableRow[],
  milestones: ReturnType<typeof getStatus4Milestones>,
  title: string,
  description?: string,
) {
  void downloadStatus4Rows(rows, milestones, title, "excel", description);
}

function printStatus4RowsToPdf(
  rows: Status4TableRow[],
  milestones: ReturnType<typeof getStatus4Milestones>,
  title: string,
  description?: string,
) {
  void downloadStatus4Rows(rows, milestones, title, "pdf", description);
}

async function downloadStatus4Rows(
  rows: Status4TableRow[],
  milestones: ReturnType<typeof getStatus4Milestones>,
  title: string,
  format: "excel" | "pdf",
  description?: string,
) {
  await downloadBackendExport({
    format,
    title,
    description,
    tables: [
      {
        headers: [
          "S.No.",
          "Group",
          "Total",
          ...milestones.flatMap((milestone) => [
            `${getWorkflowDisplayLabel(milestone.label)} - Applicable`,
            `${getWorkflowDisplayLabel(milestone.label)} - Current`,
            `${getWorkflowDisplayLabel(milestone.label)} - Cleared`,
          ]),
        ],
        rows: rows.map((row, index) => [
          index + 1,
          row.label,
          row.total,
          ...milestones.flatMap((milestone) => {
            const metrics =
              row.metrics[milestone.name] ??
              ({ applicable: 0, current: 0, cleared: 0 } satisfies Status4MilestoneMetrics);
            return [metrics.applicable, metrics.current, metrics.cleared];
          }),
        ]),
      },
    ],
  });
}

async function downloadStatusPageRows(
  rows: StatusPageExportRow[],
  title: string,
  format: "excel" | "pdf",
  description?: string,
) {
  await downloadBackendExport({
    format,
    title,
    description,
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
  description?: string,
) {
  await downloadBackendExport({
    format,
    title,
    description,
    tables: [
      {
        headers: [
          "S.No.",
          "Division",
          "Total",
          ...milestones.map((milestone) => getWorkflowDisplayLabel(milestone.label)),
        ],
        rows: rows.map((row, index) => [
          index + 1,
          row.division,
          row.total,
          ...milestones.map((milestone) => getLiveStatusRowMilestoneCount(row, milestone)),
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
  description?: string,
) {
  void downloadFinanceRows(
    rows,
    title,
    firmTypeDistributionRows,
    firmTypeDistributionLabel,
    "excel",
    description,
  );
}

function exportAnalyticsPanelToExcel(panel: AnalyticsPanel, description?: string) {
  void downloadAnalyticsPanel(panel, "excel", description);
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

function printAnalyticsPanelToPdf(panel: AnalyticsPanel, description?: string) {
  void downloadAnalyticsPanel(panel, "pdf", description);
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
  description?: string,
) {
  void downloadFinanceRows(
    rows,
    title,
    firmTypeDistributionRows,
    firmTypeDistributionLabel,
    "pdf",
    description,
  );
}

async function downloadFinanceRows(
  rows: FinanceExportRow[],
  title: string,
  firmTypeDistributionRows: FinanceFirmTypeDistributionExportRow[],
  firmTypeDistributionLabel: string,
  format: "excel" | "pdf",
  description?: string,
) {
  await downloadBackendExport({
    format,
    title,
    description,
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
      ...(firmTypeDistributionRows.length
        ? [
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
          ]
        : []),
    ],
  });
}

async function downloadAnalyticsPanel(
  panel: AnalyticsPanel,
  format: "excel" | "pdf",
  description?: string,
) {
  const includeSerialColumn = shouldIncludeAnalyticsExportSerialColumn(panel.key);
  const headers = panel.columns.map(getAnalyticsExportHeader);
  const columnWidths = getAnalyticsExportColumnWidths(panel.key, includeSerialColumn);
  const rows = panel.rows.map((row, index) => {
    const values = panel.columns.map((column) =>
      getAnalyticsCellValue(row, column).replace(/\n/g, " "),
    );
    return includeSerialColumn ? [index + 1, ...values] : values;
  });
  await downloadBackendExport({
    format,
    title: panel.title,
    subtitle: panel.subtitle,
    description: [description, panel.exportNote, ...(panel.helper ?? [])]
      .filter(Boolean)
      .join("\n"),
    tables: [
      {
        headers: includeSerialColumn ? ["S.No.", ...headers] : headers,
        rows,
        ...(columnWidths ? { columnWidths } : {}),
      },
    ],
  });
}

function getAnalyticsExportColumnWidths(
  panelKey: AnalyticsPanelKey,
  includeSerialColumn: boolean,
) {
  if (panelKey !== "cncSummary") return undefined;
  const widths = [90, 82, 82, 104, 78, 88, 108, 82];
  return includeSerialColumn ? [38, ...widths] : widths;
}

function shouldIncludeAnalyticsExportSerialColumn(panelKey: AnalyticsPanelKey) {
  return !(
    panelKey === "divisionFiles" ||
    panelKey === "divisionValue" ||
    panelKey === "divisionTotalValue" ||
    panelKey === "divisionTurnaround" ||
    panelKey === "topFirms" ||
    panelKey === "indentorsByFiles" ||
    panelKey === "indentorsByValue" ||
    panelKey === "biddingMode" ||
    panelKey === "fileValueThresholds" ||
    panelKey === "paymentPending"
  );
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
    if (normalizeMilestoneName(milestone) === "deliveryperiod") return "D.P. Current";
    return `${milestone} - Pending`;
  }
  if (filter.startsWith("manualMilestoneCompleted:")) {
    const milestone = filter.slice("manualMilestoneCompleted:".length);
    return `${milestone} - Completed`;
  }
  if (filter.startsWith("statusSummary:")) {
    const [, rawMilestone = "", rawStage = ""] = filter.split(":");
    const milestone = decodeStatusFilterPart(rawMilestone);
    const stage = decodeStatusFilterPart(rawStage);
    return `${milestone} - ${formatStatusSummaryStageLabel(stage)}`;
  }
  if (filter.startsWith("status4:")) {
    const [
      ,
      rawMilestone = "",
      rawMetric = "current",
      rawFiscalYear = "",
      rawMonthKey = "all",
      rawMin = "",
      rawMax = "",
    ] = filter.split(":");
    const milestone = decodeStatusFilterPart(rawMilestone);
    const metric = isStatus4MetricKey(rawMetric) ? rawMetric : "current";
    const fiscalYear = decodeStatusFilterPart(rawFiscalYear);
    const monthKey = decodeStatusFilterPart(rawMonthKey);
    const minValue = parseAmount(rawMin);
    const maxValue = parseAmount(rawMax);
    const parts = [`Status-4`, fiscalYear, milestone, getStatus4MetricLabel(metric)].filter(
      Boolean,
    );
    if (monthKey && monthKey !== "all") parts.push(formatMonthKeyLabel(monthKey));
    if (minValue !== undefined || maxValue !== undefined) {
      parts.push(formatStatus4ValueRangeTitle(minValue, maxValue));
    }
    return parts.join(" - ");
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
      category === "all"
        ? "Warranty BG"
        : category === "psbpwb"
          ? "PSB+PWB"
          : category.toUpperCase();
    return `Warranty / BG mismatch ${categoryLabel} - +${days} days`;
  }
  if (filter.startsWith("mode:")) {
    return `Bidding Mode - ${decodeURIComponent(filter.slice("mode:".length))}`;
  }
  if (filter.startsWith("gemBiddingMode:")) {
    return `GeM bidding mode - ${decodeURIComponent(filter.slice("gemBiddingMode:".length))}`;
  }
  if (filter.startsWith("valueThreshold:")) {
    const { label, metric } = parseValueThresholdDashboardFilterTitle(filter, "valueThreshold:");
    return `Demand Value Threshold${metric ? ` ${metric}` : ""} - ${label}`;
  }
  if (filter.startsWith("valueThresholdTotal:")) {
    const [, metric = "total"] = filter.split(":");
    const label = metric === "capital" ? "Capital" : metric === "revenue" ? "Revenue" : "Total";
    return `Demand Value Threshold - ${label}`;
  }
  if (filter.startsWith("soValueThreshold:")) {
    const { label, metric } = parseValueThresholdDashboardFilterTitle(filter, "soValueThreshold:");
    return `S.O. Value Threshold${metric ? ` ${metric}` : ""} - ${label}`;
  }
  if (filter.startsWith("soValueThresholdTotal:")) {
    const [, metric = "total"] = filter.split(":");
    const label = metric === "capital" ? "Capital" : metric === "revenue" ? "Revenue" : "Total";
    return `S.O. Value Threshold - ${label}`;
  }
  if (filter === "divisionTurnaroundSample") return "Division Turnaround - Sample files";
  if (filter.startsWith("preBidMeetingFy:") || filter.startsWith("refloatPreBidMeetingFy:")) {
    const [kind = "", state = "all", rawFy = ""] = filter.split(":");
    const fiscalYear = decodeStatusFilterPart(rawFy);
    const isRefloat = kind === "refloatPreBidMeetingFy";
    const stateLabel = state === "due" ? "Due" : state === "completed" ? "Completed" : "Total";
    return `${isRefloat ? "Refloat Pre-Bid Meeting" : "Pre-Bid Meeting"} - ${stateLabel}${
      fiscalYear ? ` - FY ${fiscalYear}` : ""
    }`;
  }
  if (filter.startsWith("preBidMeetingCombinedFy:")) {
    const [, state = "all", rawFy = ""] = filter.split(":");
    const fiscalYear = decodeStatusFilterPart(rawFy);
    const stateLabel = state === "due" ? "Due" : state === "completed" ? "Completed" : "Total";
    return `Pre-Bid Meeting - ${stateLabel}${fiscalYear ? ` - FY ${fiscalYear}` : ""}`;
  }
  if (filter.startsWith("preBidMeetingCombined:")) {
    const [, state = "all", rawMonth = ""] = filter.split(":");
    const month = decodeStatusFilterPart(rawMonth);
    const stateLabel = state === "due" ? "Due" : state === "completed" ? "Completed" : "Total";
    return `Pre-Bid Meeting - ${stateLabel}${month ? ` - ${month}` : ""}`;
  }
  if (filter.startsWith("tcecStatus:")) {
    const [, rawStage = "pre", rawMetric = "reviewed", rawCommittee = "", rawDate = ""] =
      filter.split(":");
    const stage = decodeStatusFilterPart(rawStage) === "post" ? "Post-TCEC" : "Pre-TCEC";
    const metric = decodeStatusFilterPart(rawMetric);
    const metricLabel =
      metric === "signed"
        ? "Minutes signed"
        : metric === "pending"
          ? "Minutes pending"
          : "Files reviewed";
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
      metric === "signed"
        ? "Minutes signed"
        : metric === "pending"
          ? "Minutes pending"
          : "Files reviewed";
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

function parseValueThresholdDashboardFilterTitle(filter: string, prefix: string) {
  const parts = filter.slice(prefix.length).split(":");
  const rawMetric = parts.length > 1 ? decodeURIComponent(parts[parts.length - 1]) : "";
  const metric =
    rawMetric === "capital" ? "Capital" : rawMetric === "revenue" ? "Revenue" : "";
  if (metric) parts.pop();
  return {
    label: decodeURIComponent(parts.join(":")),
    metric,
  };
}

function formatStatusSummaryStageLabel(stage: string) {
  const normalized = normalizeMilestoneName(stage);
  if (normalized === "total" || normalized === "totalfiles") return "Total";
  if (normalized === "atpreviousstage") return "At previous stage";
  if (normalized === "inprocess") return "In process";
  if (normalized === "pending") return "Pending";
  if (normalized === "completed" || normalized === "cleared") return "Completed";
  if (normalized === "reviewed") return "Reviewed";
  if (normalized === "billsreturned") return "Bills returned";
  if (normalized === "returnpending") return "Return pending";
  if (normalized === "resubmitted") return "Resubmitted";
  if (normalized === "returnedpaid") return "Returned paid";
  return stage;
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

function roundContributionPercent(value: number | undefined) {
  if (value === undefined) return 0;
  return Number(value.toFixed(1));
}

function formatContributionPercent(value: number | undefined) {
  if (value === undefined) return "0";
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 1,
  }).format(value);
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
