import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Fragment,
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
  useContext,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Info,
  Lock,
  RotateCcw,
  Save,
  Unlock,
} from "lucide-react";
import {
  fetchMasterFirms,
  fetchFilesForYear,
  fetchMerCashOutgo,
  fetchPreSoCashOutgoPlan,
  fetchReportPreferences,
  saveMerCashOutgo,
  savePreSoCashOutgoPlan,
  saveReportPreferences,
  store,
  type Division,
  type DemandProcessingDayRange,
  type FileRecord,
  type MasterFirm,
  type MerCashOutgoRow,
  type StageDeliveryDetail,
  type SupplementaryBillDetail,
  type SupplyOrderDetail,
  useActiveUser,
  useAccessibleDivisions,
  useSettings,
} from "@/lib/files-store";
import { DateInput, formatIsoDateForDisplay } from "@/components/date-input";
import { CompactTableText, getCompactTableTextWidth } from "@/components/compact-table-text";
import { HelperContent } from "@/components/helper-content";
import { ChartCopyButton, TableChartToggle, type ResultView } from "@/components/table-chart-toggle";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend as ChartLegend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { filterControlClass, filterLabelClass } from "@/lib/active-filter-style";
import {
  fileMatchesInitiationDateRange,
  getActiveFileInitiationDateRange,
  getFileInitiationDateSearchParams,
  type FileInitiationDateRange,
} from "@/lib/file-initiation-date-filter";
import {
  isContractFileType,
  isBiddingApplicableForFile,
  isDeliveryInspectionApplicableByGroup,
} from "@/lib/file-type-groups";
import { downloadBackendExport, type ExportPlot, type ExportTable } from "@/lib/export-download";
import {
  areRequiredAdvanceGuaranteesReceived,
  advancePaymentEntries,
  countExpectedSupplyOrderRows,
  effectiveSupplyOrderEntries,
  expectedSupplyOrders as normalizedExpectedSupplyOrders,
  fileSupplyOrderEntries as normalizedFileSupplyOrderEntries,
  filePaymentEntries as normalizedFilePaymentEntries,
  filePaymentOrders as normalizedFilePaymentOrders,
  fileSupplyOrders as normalizedFileSupplyOrders,
  getEffectiveSupplyOrderCurrentMilestone as getCanonicalSupplyOrderCurrentMilestone,
  getActualPaymentCapital,
  getActualPaymentRevenue,
  isAdvancePaymentCompleted,
  isAdvancePaymentPaid,
  isAdvancePaymentPending,
  isSupplyOrderMilestoneCurrent as isCanonicalSupplyOrderMilestoneCurrent,
  isExpiredDeliveryPeriodEntry,
  isExtendedDeliveryPeriodEntry,
  isValidDeliveryPeriodEntry,
  rawSupplyOrders as normalizedRawSupplyOrders,
} from "@/lib/effective-deliveries";
import {
  allFileCategoryKeys,
  filterFilesByCategory,
  getVisibleFileCategoryKeys,
  getVisibleFileCategoryOptions,
  serializeFileCategories,
  type FileCategoryOption,
  type FileCategoryKey,
} from "@/lib/file-categories";
import {
  buildMmgSummaryRows,
  normalizeMmgSummaryFields,
  type MmgSummarySourceOverrides,
  type MmgSummaryRow,
} from "@/lib/mmg-summary";
import {
  hasBillReturnHistory,
  hasCompletedBillReturn,
  hasOpenBillReturn,
  hasReturnedBill,
  hasReturnedBillPaid,
  latestBillReturnCycle,
  type ReturnedBillCashOutgoMode,
} from "@/lib/refloat-returned-bill";
import {
  buildDemandProcessingRows,
  builtInDemandProcessingPresets,
  getDemandProcessingField,
  getDemandProcessingFieldGroups,
  getDemandProcessingPresets,
  demandProcessingDateFields,
  type DemandProcessingAnalysisRow,
} from "@/lib/demand-processing-analysis";
import {
  formatAmountInput,
  formatThousandsAndLakhs,
  getInrAmount,
  handleFormattedAmountInput,
} from "@/lib/money";
import {
  ALL_FILES_YEAR,
  ALL_ACTIVE_FILES_YEAR,
  displayFinancialYearLabel,
  isActivePlusCurrentFyClosedYear,
  isAllActiveFilesYear,
  isAllFilesYear,
  isCancelledFile,
} from "@/lib/year-filter";
import {
  calculateFirmRatingScore,
  formatFirmRatingScore,
  normalizeFirmRatingConfig,
} from "@/lib/firm-rating";

export const Route = createFileRoute("/reports")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: typeof search.mode === "string" ? search.mode : undefined,
  }),
  component: ReportsPage,
});

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const ExportPlotContext = createContext<ExportPlot | undefined>(undefined);
const DEFAULT_BILL_PAYMENT_OFFSET_DAYS = 5;
const DEFAULT_BILL_SUBMISSION_OFFSET_DAYS = 5;
const DEFAULT_DP_OFFSET_DAYS = 10;

type ReportsSummaryPayload = {
  activeDivision: string;
  reportFileCount: number;
  statusSummaryGroups: StatusSummaryTableGroup[];
  expectedCashOutgoDpRows: ExpectedCashOutgoRow[];
  expectedCashOutgoReceiptRows: ExpectedCashOutgoRow[];
  expectedCashOutgoReceiptPendingBillRows: ExpectedCashOutgoRow[];
  expectedCashOutgoBillPreparationRows: ExpectedCashOutgoRow[];
  billSentForPaymentRows: ExpectedCashOutgoRow[];
  actualCashOutgoRows: ExpectedCashOutgoRow[];
  supplementaryBillSentForPaymentRows: ExpectedCashOutgoRow[];
  supplementaryActualCashOutgoRows: ExpectedCashOutgoRow[];
  pendingReturnedBillRows: ExpectedCashOutgoRow[];
  returnedBillResubmittedRows: ExpectedCashOutgoRow[];
  returnedBillPaidRows: ExpectedCashOutgoRow[];
  supplementaryPendingReturnedBillRows: ExpectedCashOutgoRow[];
  supplementaryReturnedBillResubmittedRows: ExpectedCashOutgoRow[];
  supplementaryReturnedBillPaidRows: ExpectedCashOutgoRow[];
  monthlyFileInflow: MonthCountRow[];
  monthWiseSupplyOrder: MonthCountRow[];
  monthWiseDeliverySchedule: MonthWiseDeliveryScheduleRow[];
  monthWiseCompletedDeliveries: MonthCountRow[];
  monthWiseBgExpiry: MonthWiseBgExpiryRow[];
  preBidMeetingRows: PreBidMeetingRow[];
  bgReceiptDelayRows: BgReceiptDelayRow[];
  warrantyBgMismatchRows: WarrantyBgMismatchRow[];
  delayRows: DelayStatusRow[];
  delaySummary: ReturnType<typeof getDelayStatusSummary>;
  delayMilestoneOptions?: Array<{ key: string; label: string }>;
};

type DashboardSummaryPayload = {
  dashboardFileCount: number;
  modeCounts: Array<{ name: string; count: number }>;
  topSummaryStats: Array<{
    label: string;
    value: Array<{ label: string; value: number | string; searchFilter?: string }>;
  }>;
  fileTypeStats?: {
    value: Array<{ label: string; value: number | string; searchFilter?: string }>;
  };
  firmTypeStats?: {
    value: Array<{ label: string; value: number | string; searchFilter?: string }>;
  };
  statusFlow: Array<Record<string, number | string | boolean | undefined>>;
  miscellaneousCounts?: Record<string, number | string | undefined>;
  financeTotals?: {
    allocatedCapital?: number;
    allocatedRevenue?: number;
    projectedCapital?: number;
    projectedRevenue?: number;
    bookedCapital?: number;
    bookedRevenue?: number;
    spentCapital?: number;
    spentRevenue?: number;
    paidCapital?: number;
    paidRevenue?: number;
    paidTillDateCapital?: number;
    paidTillDateRevenue?: number;
    advanceCapital?: number;
    advanceRevenue?: number;
  };
  finance1Summary?: {
    fiscalYear: string;
    cutoffDate: string;
    intendedAtFyEnd: FinanceReviewMetric;
    bookedAtFyEnd: FinanceReviewMetric;
    committedAtFyEnd: FinanceReviewMetric;
    paidByFyEnd: FinanceReviewMetric;
    unpaidLiabilityAtFyEnd: FinanceReviewMetric;
    paidTillDate: FinanceReviewMetric;
    balanceUnpaidToday: FinanceReviewMetric;
  };
  financePercents?: Record<string, number | undefined>;
};

type FinanceReviewMetric = { count: number; capital: number; revenue: number; total: number };

function buildMmgSourceOverridesFromDashboard(
  summary: DashboardSummaryPayload | undefined,
): MmgSummarySourceOverrides {
  if (!summary) return {};
  const overrides: MmgSummarySourceOverrides = {};
  const set = (key: string, value: number | string | undefined, dashboardFilter?: string) => {
    if (value === undefined || value === null || value === "") return;
    overrides[key] = { value: String(value), dashboardFilter };
  };
  const setMoney = (key: string, value: number | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    set(key, formatThousandsAndLakhs(value / 100_000, 2));
  };
  const setMoneyWithPercent = (
    key: string,
    value: number | undefined,
    percent: number | undefined,
  ) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    const money = formatThousandsAndLakhs(value / 100_000, 2);
    set(key, typeof percent === "number" ? `${money} / ${percent.toFixed(1)}%` : money);
  };
  const status = (key: string) => summary.statusFlow.find((row) => row.key === key);
  const numberFrom = (row: Record<string, unknown> | undefined, key: string) => {
    const value = row?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const snapshotValue = (label: string) => {
    for (const stat of summary.topSummaryStats) {
      const entry = stat.value.find((item) => item.label.toLowerCase() === label.toLowerCase());
      if (entry) return entry;
    }
    return undefined;
  };
  const fileTypeValue = (label: string) =>
    summary.fileTypeStats?.value.find((item) => item.label.toLowerCase() === label.toLowerCase());
  const modeValue = (mode: string) =>
    summary.modeCounts.find((item) => item.name.toUpperCase() === mode.toUpperCase());

  set("totalDemands", summary.dashboardFileCount);
  set("nonTcecDemands", snapshotValue("Non TCEC")?.value, "attribute:tcec:no");
  set("tcecDemands", snapshotValue("TCEC")?.value, "attribute:tcec:yes");
  ["obm", "pbm", "lpc", "sbm", "lbm"].forEach((key) => {
    const mode = key.toUpperCase();
    set(key, modeValue(mode)?.count, `mode:${mode}`);
  });
  [
    ["goodsServices", "Goods & Services"],
    ["amc", "AMC"],
    ["mpc", "MPC"],
    ["cars", "CARS"],
    ["om", "O&M"],
  ].forEach(([key, label]) =>
    set(key, fileTypeValue(label)?.value, `fileType:${encodeURIComponent(label)}`),
  );
  summary.modeCounts.forEach((row) => {
    const mode = row.name.trim().toUpperCase();
    if (mode) set(getMmgModeSourceKey(mode), row.count, `mode:${mode}`);
  });
  summary.fileTypeStats?.value.forEach((entry) => {
    const label = entry.label.trim();
    if (label) {
      set(
        getMmgFileTypeSourceKey(label),
        entry.value,
        entry.searchFilter ?? `fileType:${encodeURIComponent(label)}`,
      );
    }
  });
  summary.firmTypeStats?.value.forEach((entry) => {
    const label = entry.label.trim();
    if (label) {
      set(
        getMmgFirmTypeSourceKey(label),
        entry.value,
        entry.searchFilter ?? `firmType:${encodeURIComponent(label)}`,
      );
    }
  });

  const scrutiny = status("scrutiny");
  set("scrutinyCompleted", numberFrom(scrutiny, "cleared"), "milestoneCleared:scrutiny");
  set("scrutinyToBeDone", numberFrom(scrutiny, "active"), "milestoneActive:scrutiny");
  const highValue = status("highValue");
  set("highValueDemands", numberFrom(highValue, "total"), "milestoneTotal:highValue");
  set("highValueReviewCompleted", numberFrom(highValue, "cleared"), "milestoneCleared:highValue");
  const tcec = status("tcec");
  set("tcecCompleted", numberFrom(tcec, "cleared"), "milestoneCleared:tcec");
  set("tcecFilesWithMmgForMeeting", numberFrom(tcec, "active"), "milestoneActive:tcec");
  const ad = status("ad");
  set("adVettingDemands", numberFrom(ad, "total"), "milestoneTotal:ad");
  set("adVettingCompleted", numberFrom(ad, "cleared"), "milestoneCleared:ad");
  set("adVettingRemaining", numberFrom(ad, "pending"), "milestonePending:ad");
  const rqa = status("rqa");
  set("rqaDemands", numberFrom(rqa, "total"), "milestoneTotal:rqa");
  set("rqaVettingDone", numberFrom(rqa, "cleared"), "milestoneCleared:rqa");
  set("rqaVettingRemaining", numberFrom(rqa, "pending"), "milestonePending:rqa");
  const control = status("control");
  set("controllingDone", numberFrom(control, "cleared"), "milestoneCleared:control");
  set("controllingRemaining", numberFrom(control, "pending"), "milestonePending:control");
  const ifa = status("ifa");
  set("filesWithIfa", numberFrom(ifa, "active"), "milestoneActive:ifa");
  set("ifaApprovalDone", numberFrom(ifa, "cleared"), "milestoneCleared:ifa");
  const cfa = status("cfa");
  set("cfaApprovalDone", numberFrom(cfa, "cleared"), "milestoneCleared:cfa");
  set("cfaApprovalRemaining", numberFrom(cfa, "pending"), "milestonePending:cfa");
  const bidding = status("bidding");
  set("liveBids", numberFrom(bidding, "liveBids"), "liveBids");
  set("bidsOverdueToOpen", numberFrom(bidding, "overdueBids"), "bidOverdue");
  const preBidMeeting = status("preBidMeeting");
  set("preBidMeetingDue", numberFrom(preBidMeeting, "preBidDue"), "preBidMeeting:due");
  set(
    "preBidMeetingCompleted",
    numberFrom(preBidMeeting, "preBidCompleted"),
    "preBidMeeting:completed",
  );
  set(
    "refloatPreBidMeetingDue",
    numberFrom(preBidMeeting, "refloatPreBidDue"),
    "refloatPreBidMeeting:due",
  );
  set(
    "refloatPreBidMeetingCompleted",
    numberFrom(preBidMeeting, "refloatPreBidCompleted"),
    "refloatPreBidMeeting:completed",
  );
  const postTcec = status("postTcec");
  set("postTcecEvaluationInProgress", numberFrom(postTcec, "active"), "milestoneActive:postTcec");
  set("postTcecCompleted", numberFrom(postTcec, "cleared"), "milestoneCleared:postTcec");
  const cnc = status("cnc");
  set("cncInProgress", numberFrom(cnc, "active"), "milestoneActive:cnc");
  set("cncCompleted", numberFrom(cnc, "cleared"), "milestoneCleared:cnc");
  const financialSanction = status("financialSanction");
  set(
    "financialSanctionCompleted",
    numberFrom(financialSanction, "financialSanctionCompleted") ??
      numberFrom(financialSanction, "cleared"),
    "manualMilestoneCompleted:Financial Sanction",
  );
  set(
    "financialSanctionPending",
    numberFrom(financialSanction, "financialSanctionPending") ??
      numberFrom(financialSanction, "pending"),
    "manualMilestoneCurrent:Financial Sanction",
  );
  const supplyOrder = status("supplyOrder");
  set("soTotal", numberFrom(supplyOrder, "cleared"), "milestoneCleared:supplyOrder");
  set("soPlaced", numberFrom(supplyOrder, "cleared"), "milestoneCleared:supplyOrder");
  set("soPending", numberFrom(supplyOrder, "pending"), "milestonePending:supplyOrder");
  set("soLive", numberFrom(supplyOrder, "liveSupplyOrders"), "liveSupplyOrders");
  const deliveryPeriod = status("deliveryPeriod");
  set("deliveryPeriodValid", numberFrom(deliveryPeriod, "valid"), "deliveryPeriodValid");
  set("deliveryPeriodExpired", numberFrom(deliveryPeriod, "expired"), "deliveryPeriodExpired");
  set("deliveryPeriodExtended", numberFrom(deliveryPeriod, "extended"), "deliveryPeriodExtended");
  const ir = status("ir");
  set("irPreparationPending", numberFrom(ir, "irPreparationPending"), "irPreparationPending");
  set("irReceiptPending", numberFrom(ir, "irReceiptPending"), "irReceiptPending");
  set("irCompleted", numberFrom(ir, "irCompleted"), "irCompleted");
  const payment = status("payment");
  set("billSentForPaymentPending", numberFrom(payment, "paymentInProcess"), "paymentInProcess");
  set("paymentPending", numberFrom(payment, "pending"), "paymentDue");
  set("paymentCompleted", numberFrom(payment, "cleared"), "milestoneCleared:payment");
  set(
    "billsReturnedForCorrection",
    numberFrom(payment, "billsReturnedForCorrection"),
    "billReturn:any",
  );
  set("billsPendingCorrection", numberFrom(payment, "returnedBillsPending"), "billReturn:pending");
  // MMG's resubmitted count is historical, unlike Status-1's unpaid-only counter.
  set("returnedBillPaid", numberFrom(payment, "returnedBillsPaid"), "billReturn:paid");
  set("advancePaid", numberFrom(payment, "advancePaid"), "advancePaid");
  set("advancePending", numberFrom(payment, "advancePending"), "advancePending");
  set(
    "supplementaryBillsSubmittedPaymentPending",
    numberFrom(payment, "supplementarySubmitted"),
    "supplementaryBill:submitted",
  );
  set(
    "supplementaryBillReturnedForCorrection",
    numberFrom(payment, "supplementaryReturnedForCorrection"),
    "supplementaryBill:any",
  );
  set(
    "pendingReturnedSupplementaryBills",
    numberFrom(payment, "supplementaryReturnedPending"),
    "supplementaryBill:returned",
  );
  set(
    "returnedSupplementaryBillsResubmitted",
    numberFrom(payment, "supplementaryReturnedResubmitted"),
    "supplementaryBill:resubmitted",
  );
  set(
    "supplementaryBillsPaid",
    numberFrom(payment, "supplementaryNormalPaid"),
    "supplementaryBill:paid",
  );
  set(
    "returnedSupplementaryBillsPaid",
    numberFrom(payment, "supplementaryReturnedPaid"),
    "supplementaryBill:returnPaid",
  );
  set(
    "supplementaryBillsPending",
    numberFrom(payment, "supplementaryPending"),
    "supplementaryBill:pending",
  );

  set(
    "multipleSupplyOrders",
    summary.miscellaneousCounts?.multipleSupplyOrders,
    "miscMultipleSupplyOrders",
  );
  set("ld", summary.miscellaneousCounts?.ld, "miscLd");
  set("soCancelled", summary.miscellaneousCounts?.soCancelled, "miscSoCancelled");
  set("shortclosedSo", summary.miscellaneousCounts?.shortclosedSo, "miscShortclosedSo");
  set("cancelledDemands", summary.miscellaneousCounts?.demandCancelled, "miscDemandCancelled");
  setMoney("allocatedCapital", summary.financeTotals?.allocatedCapital);
  setMoney("allocatedRevenue", summary.financeTotals?.allocatedRevenue);
  setMoneyWithPercent(
    "intendedCapital",
    summary.financeTotals?.projectedCapital,
    summary.financePercents?.capitalProjected,
  );
  setMoneyWithPercent(
    "intendedRevenue",
    summary.financeTotals?.projectedRevenue,
    summary.financePercents?.revenueProjected,
  );
  setMoneyWithPercent(
    "bookedCapital",
    summary.financeTotals?.bookedCapital,
    summary.financePercents?.capitalBooked,
  );
  setMoneyWithPercent(
    "bookedRevenue",
    summary.financeTotals?.bookedRevenue,
    summary.financePercents?.revenueBooked,
  );
  setMoneyWithPercent(
    "committedCapital",
    summary.financeTotals?.spentCapital,
    summary.financePercents?.capitalSpent,
  );
  setMoneyWithPercent(
    "committedRevenue",
    summary.financeTotals?.spentRevenue,
    summary.financePercents?.revenueSpent,
  );
  setMoney("actualPaymentCapital", summary.financeTotals?.paidCapital);
  setMoney("actualPaymentRevenue", summary.financeTotals?.paidRevenue);
  setMoney(
    "totalPaymentsMadeThisYear",
    (summary.financeTotals?.paidCapital ?? 0) + (summary.financeTotals?.paidRevenue ?? 0),
  );
  setMoney("advancePaymentCapital", summary.financeTotals?.advanceCapital);
  setMoney("advancePaymentRevenue", summary.financeTotals?.advanceRevenue);

  const setBgSource = (prefix: "psb" | "pwb" | "psbPwb", statusKey: string) => {
    const row = status(statusKey);
    set(`${prefix}Pending`, numberFrom(row, "pending"), `milestonePending:${statusKey}`);
    set(`${prefix}Received`, numberFrom(row, "cleared"), `milestoneCleared:${statusKey}`);
    set(`${prefix}Expired`, numberFrom(row, "bgExpired"), `bgExpired:${statusKey}`);
    set(`${prefix}ToBeReturned`, numberFrom(row, "bgToBeReturned"), `bgToBeReturned:${statusKey}`);
    set(`${prefix}Returned`, numberFrom(row, "bgReturned"), `bgReturned:${statusKey}`);
  };
  setBgSource("psb", "psb");
  setBgSource("pwb", "pwb");
  setBgSource("psbPwb", "psbPwb");

  return overrides;
}

function getMmgModeSourceKey(mode: string) {
  const normalized = mode.trim().toUpperCase();
  const defaultKeys: Record<string, string> = {
    OBM: "obm",
    PBM: "pbm",
    LPC: "lpc",
    SBM: "sbm",
    LBM: "lbm",
  };
  return defaultKeys[normalized] ?? `mode:${encodeURIComponent(normalized)}`;
}

function getMmgFileTypeSourceKey(fileType: string) {
  const normalized = fileType.trim();
  const defaultKeys: Record<string, string> = {
    "goods & services": "goodsServices",
    amc: "amc",
    mpc: "mpc",
    cars: "cars",
    "o&m": "om",
  };
  return defaultKeys[normalized.toLowerCase()] ?? `fileType:${encodeURIComponent(normalized)}`;
}

function getMmgFirmTypeSourceKey(firmType: string) {
  return `firmType:${encodeURIComponent(firmType.trim().toLowerCase())}`;
}

const mmgSummarySourceDescriptions: Record<string, string> = {
  allocatedCapital: "Source: Finance allocated capital.",
  allocatedRevenue: "Source: Finance allocated revenue.",
  intendedCapital: "Source: Finance intended/projected capital, with Finance percentage.",
  intendedRevenue: "Source: Finance intended/projected revenue, with Finance percentage.",
  bookedCapital: "Source: Finance booked capital, with Finance percentage.",
  bookedRevenue: "Source: Finance booked revenue, with Finance percentage.",
  committedCapital: "Source: Finance committed/S.O. capital, with Finance percentage.",
  committedRevenue: "Source: Finance committed/S.O. revenue, with Finance percentage.",
  actualPaymentCapital: "Source: Finance actual paid capital.",
  actualPaymentRevenue: "Source: Finance actual paid revenue.",
  totalPaymentsMadeThisYear: "Source: Finance actual paid capital + actual paid revenue.",
  advancePaymentCapital: "Source: Finance advance payment capital.",
  advancePaymentRevenue: "Source: Finance advance payment revenue.",
  totalExpectedPaymentRemainingThisYear:
    "Source: Cash Out Go Plan, calculated as Monthwise Revised Cash Out Go Plan minus Expenditure till date.",
  totalDemands: "Source: Dashboard selected file count.",
  nonTcecDemands: "Source: Snapshot Non TCEC counter.",
  tcecDemands: "Source: Snapshot TCEC counter.",
  obm: "Source: Snapshot Mode counter for OBM.",
  pbm: "Source: Snapshot Mode counter for PBM.",
  lpc: "Source: Snapshot Mode counter for LPC.",
  sbm: "Source: Snapshot Mode counter for SBM.",
  lbm: "Source: Snapshot Mode counter for LBM.",
  goodsServices: "Source: Snapshot File Type counter for Goods & Services.",
  amc: "Source: Snapshot File Type counter for AMC.",
  mpc: "Source: Snapshot File Type counter for MPC.",
  cars: "Source: Snapshot File Type counter for CARS.",
  om: "Source: Snapshot File Type counter for O&M.",
  scrutinyCompleted: "Source: Status-1 Scrutiny completed.",
  filesWithUsersAfterScrutiny:
    "Source: MMG Summary calculation for files where Scrutiny Date is filled but Scrutiny Completion Date is blank.",
  scrutinyToBeDone: "Source: Status-1 Scrutiny in process.",
  highValueDemands: "Source: Status-1 High Value total.",
  highValueReviewCompleted: "Source: Status-1 High Value completed.",
  tcecCompleted: "Source: Status-1 Pre-TCEC completed.",
  tcecFilesWithMmgForMeeting: "Source: Status-1 Pre-TCEC in process.",
  adVettingDemands: "Source: Status-1 AD total.",
  adVettingCompleted: "Source: Status-1 AD completed.",
  adVettingRemaining: "Source: Status-1 AD pending.",
  rqaDemands: "Source: Status-1 R&QA total.",
  rqaVettingDone: "Source: Status-1 R&QA completed.",
  rqaVettingRemaining: "Source: Status-1 R&QA pending.",
  controllingDone: "Source: Status-1 Controlling completed.",
  controllingRemaining: "Source: Status-1 Controlling pending.",
  filesWithIfa: "Source: Status-1 IFA in process.",
  ifaApprovalDone: "Source: Status-1 IFA completed.",
  cfaApprovalDone: "Source: Status-1 CFA completed.",
  cfaApprovalRemaining: "Source: Status-1 CFA pending.",
  liveBids: "Source: Status-1 Bidding live.",
  bidsToBeOpened: "Source: MMG Summary calculation for bids due to be opened.",
  bidsOverdueToOpen: "Source: Status-1 Bidding opening overdue.",
  preBidMeetingDue: "Source: Status-1 Pre-Bid Meeting due.",
  preBidMeetingCompleted: "Source: Status-1 Pre-Bid Meeting completed.",
  refloatPreBidMeetingDue: "Source: Status-1 Refloat Pre-Bid Meeting due.",
  refloatPreBidMeetingCompleted: "Source: Status-1 Refloat Pre-Bid Meeting completed.",
  postTcecEvaluationInProgress: "Source: Status-1 Post-TCEC in process.",
  postTcecCompleted: "Source: Status-1 Post-TCEC completed.",
  cncInProgress: "Source: Status-1 CNC in process.",
  cncCompleted: "Source: Status-1 CNC completed.",
  financialSanctionCompleted: "Source: Status-1 Financial Sanction completed.",
  financialSanctionPending: "Source: Status-1 Financial Sanction pending.",
  soTotal: "Source: Status-1 S.O. placed.",
  soPlaced: "Source: Status-1 S.O. placed.",
  soPending: "Source: Status-1 S.O. pending.",
  soLive: "Source: Status-1 S.O. live.",
  deliveriesDueThisMonth:
    "Source: MMG Summary calculation for delivery-inspection cases with D.P. in the current month and material receipt pending.",
  deliveriesCompletedThisMonth:
    "Source: MMG Summary calculation for deliveries/job completions completed in the current month.",
  deliveryCompleted: "Source: MMG Summary calculation for completed delivery/job completion rows.",
  deliveryPending:
    "Source: MMG Summary calculation for active S.O. rows where delivery/job completion is pending.",
  deliveryOverdue:
    "Source: MMG Summary calculation for delivery-inspection rows where D.P. has expired and material receipt is pending.",
  deliveryPeriodValid: "Source: Status-1 Delivery Period valid.",
  deliveryPeriodExpired: "Source: Status-1 Delivery Period expired.",
  deliveryPeriodExtended: "Source: Status-1 Delivery Period extended.",
  irPreparationPending: "Source: Status-1 IR Preparation pending.",
  irReceiptPending: "Source: Status-1 IR Receipt pending.",
  irCompleted: "Source: Status-1 IR completed.",
  totalIrSentToUser: "Source: MMG Summary calculation for rows having IR Preparation Date.",
  totalIrReceived: "Source: MMG Summary calculation for rows having IR Receipt Date.",
  billPreparationPending:
    "Source: MMG Summary calculation for rows where billing workflow has started and Bill Preparation Date is blank.",
  billPreparationCompleted:
    "Source: MMG Summary calculation for rows having Bill Preparation Date.",
  billSentForPaymentPending: "Source: Status-1 Payment in process.",
  billSentForPaymentCompleted:
    "Source: MMG Summary calculation for rows having Bill Sent for Payment Date.",
  paymentPending: "Source: Status-1 Payment pending.",
  totalPendingPaymentStagesCases:
    "Source: MMG Summary calculation for all pending payment stage/case rows.",
  paymentCompleted: "Source: Status-1 Payment completed.",
  totalPaymentDueThisMonth:
    "Source: MMG Summary calculation for unpaid rows whose payment due basis date falls in the current month.",
  billsSentForCurrentMonthDeliveries:
    "Source: MMG Summary calculation for rows whose payment due basis date falls in the current month and Bill Sent for Payment Date is filled.",
  paymentDueFromPreviousMonths:
    "Source: MMG Summary calculation for unpaid rows whose payment due basis date is before the current month.",
  billsSentForPreviousMonthsDeliveries:
    "Source: MMG Summary calculation for rows whose payment due basis date is before the current month and Bill Sent for Payment Date falls in the current month.",
  totalBillsSentThisMonth:
    "Source: MMG Summary calculation for non-cancelled rows whose Bill Sent for Payment Date falls in the current month.",
  billsReturnedForCorrection: "Source: Status-1 Bills returned for correction.",
  billsPendingCorrection: "Source: Status-1 Return pending.",
  billsResubmittedAfterCorrection: "Source: returned-bill history, including bills later paid.",
  returnedBillPaid: "Source: Status-1 Returned bill paid.",
  supplementaryBillsSubmittedPaymentPending: "Source: Status-1 Supplementary submitted total.",
  supplementaryBillsPending: "Source: Status-1 Supplementary pending.",
  supplementaryBillsPaid: "Source: Status-1 Normal supplementary paid.",
  supplementaryBillReturnedForCorrection: "Source: Status-1 Supplementary returned total.",
  pendingReturnedSupplementaryBills: "Source: Status-1 Supplementary return pending.",
  returnedSupplementaryBillsResubmitted: "Source: Status-1 Supplementary resubmitted total.",
  returnedSupplementaryBillsPaid: "Source: Status-1 Supplementary returned paid.",
  advancePaid: "Source: Status-1 Advance paid.",
  advancePending: "Source: Status-1 Advance pending.",
  advancePaymentCount: "Source: MMG Summary calculation for advance payment rows.",
  liveFilesThisYear: "Source: MMG Summary calculation for non-cancelled files not closed.",
  closedFilesThisYear: "Source: MMG Summary calculation for non-cancelled files marked closed.",
  liveFilesPreviousYears:
    "Source: MMG Summary calculation for live files in the current visible filter context.",
  cancelledDemands: "Source: Status-1/Snapshot cancelled demand counter.",
  soCancelled: "Source: Status-1/Snapshot cancelled S.O. counter.",
  shortclosedSo: "Source: Status-1/Snapshot shortclosed S.O. counter.",
  deliveriesOverdue:
    "Source: MMG Summary calculation for overdue delivery-inspection rows with material receipt pending.",
  paymentsOverdue:
    "Source: MMG Summary calculation for files having overdue payment rows from previous months.",
  multipleSupplyOrders: "Source: Status-1 Files with Multiple S.O. counter.",
  ld: "Source: Status-1 LD counter.",
  dpExtension: "Source: MMG Summary calculation for active S.O. rows marked D.P. extension.",
  dpExtensionCount:
    "Source: MMG Summary calculation by summing D.P. Extension Count from active S.O. rows.",
  revisedDp: "Source: MMG Summary calculation for active S.O. rows having Revised D.P.",
  totalSoValuePlacedThisFy:
    "Source: MMG Summary calculation by summing active S.O. values where S.O. Date falls in the selected FY.",
  totalUnpaidSoValue:
    "Source: MMG Summary calculation by summing unpaid non-cancelled S.O. value in the visible MMG file context.",
  filesClosedPercentage:
    "Source: MMG Summary calculation: closed non-cancelled files divided by total non-cancelled files in the visible context.",
  psbPending: "Source: Status-1 PSB pending.",
  psbReceived: "Source: Status-1 PSB received.",
  psbExpired: "Source: Status-1 PSB expired.",
  psbToBeReturned: "Source: Status-1 PSB to be returned.",
  psbReturned: "Source: Status-1 PSB returned.",
  pwbPending: "Source: Status-1 PWB pending.",
  pwbReceived: "Source: Status-1 PWB received.",
  pwbExpired: "Source: Status-1 PWB expired.",
  pwbToBeReturned: "Source: Status-1 PWB to be returned.",
  pwbReturned: "Source: Status-1 PWB returned.",
  psbPwbPending: "Source: Status-1 PSB+PWB pending.",
  psbPwbReceived: "Source: Status-1 PSB+PWB received.",
  psbPwbExpired: "Source: Status-1 PSB+PWB expired.",
  psbPwbToBeReturned: "Source: Status-1 PSB+PWB to be returned.",
  psbPwbReturned: "Source: Status-1 PSB+PWB returned.",
};

function getMmgSummaryRowHelper(row: MmgSummaryRow): HelperText {
  const source = mmgSummarySourceDescriptions[row.key];
  if (source) {
    return [
      source,
      row.dashboardFilter
        ? `Clicker uses source dashboard filter: ${row.dashboardFilter}.`
        : "Value is fetched from the source dashboard total.",
    ];
  }
  if (row.key.startsWith("mode:")) {
    return ["Source: Snapshot/Mode counter for this configured mode."];
  }
  if (row.key.startsWith("fileType:")) {
    return ["Source: Snapshot/File Type counter for this configured file type."];
  }
  if (row.key.startsWith("firmType:")) {
    return ["Source: Snapshot/Firm Type counter for this configured firm type."];
  }
  return [
    "Calculated inside MMG Summary.",
    "No exact Status/Snapshot/Finance source counter is frozen for this field yet.",
  ];
}

function isMmgSummaryRowPendingReview(row: MmgSummaryRow) {
  return (
    !mmgSummarySourceDescriptions[row.key] &&
    !row.key.startsWith("mode:") &&
    !row.key.startsWith("fileType:") &&
    !row.key.startsWith("firmType:")
  );
}

type CashOutGoPlanDetailRow = {
  rowKey: string;
  section: "submitted" | "hand" | "delivered" | "dp" | "dpExpired" | "advance";
  fileId: string;
  fileRef: string;
  sourceFocusTarget: string;
  description: string;
  firm: string;
  amountSource: string;
  baseDate: string;
  expectedSentDate: string;
  expectedSentDateOverride: string;
  actualSentDate: string;
  manualExpectedPaymentDate: string;
  billOffsetDays: number;
  billOffsetOverride: string;
  expectedPaymentDate: string;
  capital: number;
  revenue: number;
  total: number;
  overdue: boolean;
};

const cashOutGoDetailPageSizeOptions = [10, 25, 50, 100] as const;

type CashOutGoPlanDetailSectionKey =
  | "billsSubmitted"
  | "chequeslipsNotReceived"
  | "expectedPaymentDateInPast"
  | "billsAtHand"
  | "deliveredBillsPending"
  | "dpBasedForecast"
  | "dpExpired"
  | "expectedPaymentInLaterFys"
  | "expenditureTillDate"
  | "monthwisePlan";

type CashOutGoPlanExpandedSections = Record<CashOutGoPlanDetailSectionKey, boolean>;

const defaultCashOutGoPlanExpandedSections: CashOutGoPlanExpandedSections = {
  billsSubmitted: false,
  chequeslipsNotReceived: false,
  expectedPaymentDateInPast: false,
  billsAtHand: false,
  deliveredBillsPending: false,
  dpBasedForecast: false,
  dpExpired: false,
  expectedPaymentInLaterFys: false,
  expenditureTillDate: false,
  monthwisePlan: false,
};

type CashOutGoPlanPayload = {
  financialYear: string;
  selectedFinancialYearEnd: string;
  currentFinancialYearEnd: string;
  today: string;
  settings: {
    billOffsetDays: number;
    defaultBillOffsetDays: number;
    useCustomBillOffsetDays: boolean;
    handSubmissionOffsetDays: number;
    defaultHandSubmissionOffsetDays: number;
    useCustomHandSubmissionOffsetDays: boolean;
    dpOffsetDays: number;
    defaultDpOffsetDays: number;
    useCustomDpOffsetDays: boolean;
  };
  allocation: {
    divisionId: string;
    capital: number;
    revenue: number;
  };
  expenditureTillDate: ExpectedCashOutgoRow[];
  billsSubmitted: CashOutGoPlanDetailRow[];
  chequeslipsNotReceived: CashOutGoPlanDetailRow[];
  expectedPaymentDateInPast: CashOutGoPlanDetailRow[];
  billsAtHand: CashOutGoPlanDetailRow[];
  deliveredBillsPending: CashOutGoPlanDetailRow[];
  dpBasedForecast: CashOutGoPlanDetailRow[];
  dpExpired: CashOutGoPlanDetailRow[];
  expectedPaymentInLaterFys: CashOutGoPlanDetailRow[];
  monthwisePlan: ExpectedCashOutgoRow[];
};

type SoPaymentMatrixFieldKey =
  | "fileUniqueNo"
  | "demandDescription"
  | "soNo"
  | "paymentItem"
  | "soDate"
  | "firmName"
  | "division"
  | "fileCategory"
  | "fileType"
  | "indentor"
  | "mode"
  | "firmType"
  | "demandInitiationYear"
  | "demandValue"
  | "capitalValue"
  | "revenueValue"
  | "soValue"
  | "paymentBasis";

type SoPaymentMatrixColumnOption = {
  key: SoPaymentMatrixFieldKey;
  label: string;
  helper: string;
};

type SoPaymentMatrixRow = {
  rowKey: string;
  fileId: string;
  file: FileRecord;
  order: SupplyOrderDetail;
  orderIndex: number;
  paymentItem?: string;
  paymentBasis: string;
  monthAmounts: Record<string, number>;
  monthFocusTargets: Record<string, string>;
  total: number;
};

type PreSoCashOutgoTab = "stages" | "selectFiles" | "totals" | "monthwise";
type PreSoMonthwiseGrouping = "month" | "fyMonth" | "stageMonth";
type PreSoStageOffset = {
  soOffsetDays: string;
  paymentOffsetDays: string;
};
type PreSoFileDraft = {
  included: boolean;
  tentativeSoDate: string;
  tentativePaymentDate: string;
};
type PreSoStageOption = {
  key: string;
  label: string;
};
type PreSoFileRow = {
  file: FileRecord;
  fileYear: string;
  stageKey: string;
  stageLabel: string;
  capital: number;
  revenue: number;
  draft: PreSoFileDraft;
  calculatedSoDate: string;
  calculatedPaymentDate: string;
  effectivePaymentDate: string;
};

type MonthCountRow = { name: string; monthKey: string; count: number };
type MonthWiseDeliveryScheduleRow = {
  name: string;
  monthKey: string;
  grossCount: number;
  netCount: number;
};
type MonthWiseBgExpiryRow = {
  name: string;
  monthKey: string;
  psb: number;
  pwb: number;
  psbPwb: number;
  count: number;
};
type PreBidMeetingRow = {
  name: string;
  monthKey: string;
  preBidDue: number;
  preBidCompleted: number;
  refloatPreBidDue: number;
  refloatPreBidCompleted: number;
  count: number;
};
type BgReceiptDelayRow = {
  thresholdDays: number;
  label: string;
  psb: number;
  pwb: number;
  psbPwb: number;
  count: number;
};

type WarrantyBgMismatchRow = {
  bufferDays: number;
  label: string;
  pwb: number;
  psbPwb: number;
  count: number;
};

async function fetchReportsSummary(query: string, signal: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}/api/reports/summary?${query}`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Reports request failed: ${response.status}`);
  }
  return (await response.json()) as { summary: ReportsSummaryPayload };
}

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

async function fetchCashOutGoPlan(
  financialYear: string,
  includePreviousFySubmitted: boolean,
  divisionId: string,
  signal?: AbortSignal,
  fileCategories?: string,
) {
  const query = new URLSearchParams({
    financialYear,
    includePreviousFySubmitted: String(includePreviousFySubmitted),
    divisionId,
  });
  if (fileCategories) query.set("fileCategories", fileCategories);
  const response = await fetch(`${API_BASE_URL}/api/reports/cash-out-go-plan?${query}`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Cash Out Go Plan request failed: ${response.status}`);
  }
  return (await response.json()) as { plan: CashOutGoPlanPayload };
}

async function saveCashOutGoPlan(plan: CashOutGoPlanPayload) {
  const allRows = [
    ...(plan.chequeslipsNotReceived ?? []),
    ...plan.billsSubmitted,
    ...(plan.dpBasedForecast ?? []),
    ...(plan.dpExpired ?? []),
    ...(plan.expectedPaymentDateInPast ?? []),
    ...plan.billsAtHand,
    ...plan.deliveredBillsPending,
    ...(plan.expectedPaymentInLaterFys ?? []),
  ];
  const advancePaymentDateUpdates = allRows
    .filter((row) => row.section === "advance")
    .map((row) => ({
      rowKey: row.rowKey,
      fileId: row.fileId,
      orderIndex: Number(row.sourceFocusTarget.split(":").at(-1)),
      expectedPaymentDate: row.manualExpectedPaymentDate,
    }));
  const editableRows = allRows.filter((row) => row.section !== "advance").map((row) => ({
    rowKey: row.rowKey,
    expectedSentDate: row.expectedSentDateOverride,
    expectedPaymentDate: row.manualExpectedPaymentDate,
    billOffsetOverride: row.billOffsetOverride || "",
  }));
  const response = await fetch(`${API_BASE_URL}/api/reports/cash-out-go-plan`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      billOffsetDays: plan.settings.billOffsetDays,
      useCustomBillOffsetDays: plan.settings.useCustomBillOffsetDays,
      handSubmissionOffsetDays: plan.settings.handSubmissionOffsetDays,
      useCustomHandSubmissionOffsetDays: plan.settings.useCustomHandSubmissionOffsetDays,
      dpOffsetDays: plan.settings.dpOffsetDays,
      useCustomDpOffsetDays: plan.settings.useCustomDpOffsetDays,
      rows: editableRows,
      advancePaymentDateUpdates,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Cash Out Go Plan save failed: ${response.status}`);
  }
}

function ReportsPage() {
  const locationSearch = useRouterState({ select: (state) => state.location.search });
  const divisions = useAccessibleDivisions();
  const settings = useSettings();
  const activeUser = useActiveUser();
  const canEditMerData =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    (activeUser?.role === "universal_viewer" && activeUser.cashOutgoEditScope === "global");
  const canEditCashOutGoPlan =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    activeUser?.role === "editor" ||
    (activeUser?.role === "universal_viewer" &&
      (activeUser.cashOutgoEditScope === "personal" ||
        activeUser.cashOutgoEditScope === "global"));
  const canEditCashOutGoPlanSettings =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    (activeUser?.role === "universal_viewer" &&
      (activeUser.cashOutgoEditScope === "personal" ||
        activeUser.cashOutgoEditScope === "global"));
  const navigate = useNavigate();
  const [selectedDivision, setSelectedDivision] = useState("all");
  const [reportMode, setReportMode] = useState<ReportMode>("mmgSummary");
  const [firmReportSortKey, setFirmReportSortKey] = useState<FirmDatabaseSortKey>("firmName");
  const [firmReportSortDirection, setFirmReportSortDirection] =
    useState<FirmDatabaseSortDirection>("asc");
  const [savedFirmReportSortKey, setSavedFirmReportSortKey] =
    useState<FirmDatabaseSortKey>("firmName");
  const [savedFirmReportSortDirection, setSavedFirmReportSortDirection] =
    useState<FirmDatabaseSortDirection>("asc");
  const [visibleFirmReportColumns, setVisibleFirmReportColumns] = useState<FirmDatabaseColumnKey[]>(
    defaultFirmDatabaseColumnKeys,
  );
  const [firmReportLayoutLocked, setFirmReportLayoutLocked] = useState(false);
  const [firmReportLayoutSaving, setFirmReportLayoutSaving] = useState(false);
  const [firmReportLayoutError, setFirmReportLayoutError] = useState("");
  const [savedFirmReportDefaultColumns, setSavedFirmReportDefaultColumns] = useState<
    FirmDatabaseColumnKey[]
  >(defaultFirmDatabaseColumnKeys);
  const [expandedReportGroups, setExpandedReportGroups] = useState({
    cashOutgo: false,
    supplyOrderDelivery: false,
    monitoring: false,
  });
  const [reportsSidePanelHooked, setReportsSidePanelHooked] = useState(true);
  const toggleReportGroup = (group: keyof typeof expandedReportGroups) => {
    setExpandedReportGroups((current) => ({
      cashOutgo: false,
      supplyOrderDelivery: false,
      monitoring: false,
      [group]: !current[group],
    }));
  };
  const [demandAnalysisPresetId, setDemandAnalysisPresetId] = useState(
    builtInDemandProcessingPresets[1]?.id ?? "",
  );
  const [demandAnalysisFromFieldId, setDemandAnalysisFromFieldId] = useState("file.immsDate");
  const [demandAnalysisToFieldId, setDemandAnalysisToFieldId] = useState("order.soDate");
  const [demandAnalysisPaymentMode, setDemandAnalysisPaymentMode] = useState("");
  const [demandAnalysisFilters, setDemandAnalysisFilters] = useState<DemandProcessingFilterRow[]>(
    [],
  );
  const [expectedCashOutgoDays, setExpectedCashOutgoDays] = useState(
    String(DEFAULT_DP_OFFSET_DAYS),
  );
  const [sharedExpectedCashOutgoDays, setSharedExpectedCashOutgoDays] = useState(
    String(DEFAULT_DP_OFFSET_DAYS),
  );
  const [expectedCashOutgoDaysDraft, setExpectedCashOutgoDaysDraft] = useState(
    String(DEFAULT_DP_OFFSET_DAYS),
  );
  const [expectedCashOutgoDaysUnlocked, setExpectedCashOutgoDaysUnlocked] = useState(false);
  const [expectedCashOutgoDaysSaving, setExpectedCashOutgoDaysSaving] = useState(false);
  const [expectedCashOutgoDaysError, setExpectedCashOutgoDaysError] = useState("");
  const [expectedCashOutgoDaysSaved, setExpectedCashOutgoDaysSaved] = useState(false);
  const [hasExpectedCashOutgoDaysOverride, setHasExpectedCashOutgoDaysOverride] = useState(false);
  const [expectedCashOutgoDaysReady, setExpectedCashOutgoDaysReady] = useState(false);
  const [delayStatusDays, setDelayStatusDays] = useState("5");
  const [delayStatusMilestoneKey, setDelayStatusMilestoneKey] = useState("all");
  const [bgReceiptDelayDays, setBgReceiptDelayDays] = useState(["10", "30", "60"]);
  const [bgReceiptDelayUnlocked, setBgReceiptDelayUnlocked] = useState(false);
  const [warrantyBgBufferDays, setWarrantyBgBufferDays] = useState("60");
  const [warrantyBgBufferUnlocked, setWarrantyBgBufferUnlocked] = useState(false);
  const [expandedMonthlyReportYears, setExpandedMonthlyReportYears] = useState<string[]>([]);
  const [historicalReportFromDate, setHistoricalReportFromDate] = useState(() =>
    getFinancialYearStartDate(settings.selectedYear || settings.financialYear),
  );
  const [historicalReportToDate, setHistoricalReportToDate] = useState(() =>
    formatLocalDate(new Date()),
  );
  const [cashOutgoDateRangeFilter, setCashOutgoDateRangeFilter] = useState(false);
  const [reportScopeFromDate, setReportScopeFromDate] = useState(() =>
    getFinancialYearStartDate(settings.selectedYear || settings.financialYear),
  );
  const [reportScopeToDate, setReportScopeToDate] = useState(() => formatLocalDate(new Date()));
  const [reportScopeDateRangeFilter, setReportScopeDateRangeFilter] = useState(false);
  const [selectedCashOutgoMonth, setSelectedCashOutgoMonth] = useState(() => getCurrentMonthKey());
  const [merRows, setMerRows] = useState<MerCashOutgoRow[]>([]);
  const [merDraftRows, setMerDraftRows] = useState<MerCashOutgoDraftRow[]>([]);
  const [merEditing, setMerEditing] = useState(false);
  const [merLoading, setMerLoading] = useState(false);
  const [merSaving, setMerSaving] = useState(false);
  const [merError, setMerError] = useState<string | undefined>();
  const [cashOutGoPlan, setCashOutGoPlan] = useState<CashOutGoPlanPayload | undefined>();
  const [cashOutGoPlanSavedSnapshot, setCashOutGoPlanSavedSnapshot] = useState("");
  const [cashOutGoPlanLoading, setCashOutGoPlanLoading] = useState(false);
  const [cashOutGoPlanSaving, setCashOutGoPlanSaving] = useState(false);
  const [cashOutGoPlanError, setCashOutGoPlanError] = useState<string | undefined>();
  const [cashOutGoPlanIncludePreviousFy, setCashOutGoPlanIncludePreviousFy] = useState(true);
  const [soPaymentMatrixFields, setSoPaymentMatrixFields] = useState<SoPaymentMatrixFieldKey[]>([
    ...soPaymentMatrixDefaultFields,
  ]);
  const [paymentCompletedMatrixFields, setPaymentCompletedMatrixFields] = useState<SoPaymentMatrixFieldKey[]>([
    ...soPaymentMatrixDefaultFields,
  ]);
  const [soPaymentMatrixLocked, setSoPaymentMatrixLocked] = useState(false);
  const [paymentCompletedMatrixLocked, setPaymentCompletedMatrixLocked] = useState(false);
  const [matrixFieldsPreferenceLoading, setMatrixFieldsPreferenceLoading] = useState(true);
  const [matrixFieldsPreferenceSaving, setMatrixFieldsPreferenceSaving] = useState(false);
  const [matrixFieldsPreferenceError, setMatrixFieldsPreferenceError] = useState("");
  const [preSoActiveTab, setPreSoActiveTab] = useState<PreSoCashOutgoTab>("stages");
  const [preSoSelectedStageKeys, setPreSoSelectedStageKeys] = useState<string[]>([]);
  const [preSoStageOffsets, setPreSoStageOffsets] = useState<Record<string, PreSoStageOffset>>({});
  const [preSoFileDrafts, setPreSoFileDrafts] = useState<Record<string, PreSoFileDraft>>({});
  const [preSoMonthwiseGrouping, setPreSoMonthwiseGrouping] =
    useState<PreSoMonthwiseGrouping>("month");
  const [preSoPlanLoading, setPreSoPlanLoading] = useState(false);
  const [preSoPlanSaving, setPreSoPlanSaving] = useState(false);
  const [preSoPlanError, setPreSoPlanError] = useState<string | undefined>();
  const [preSoPlanCanSave, setPreSoPlanCanSave] = useState(false);
  const [preSoPlanCanSaveStageOffsets, setPreSoPlanCanSaveStageOffsets] = useState(false);
  const [preSoSavedSnapshot, setPreSoSavedSnapshot] = useState("");
  const [selectedFileCategories, setSelectedFileCategories] =
    useState<FileCategoryKey[]>(allFileCategoryKeys);
  const [fileCategoryFilterTouched, setFileCategoryFilterTouched] = useState(false);
  const [fileCategoryLocked, setFileCategoryLocked] = useState(false);
  const [fileCategoryPreferenceLoading, setFileCategoryPreferenceLoading] = useState(true);
  const [fileCategoryPreferenceSaving, setFileCategoryPreferenceSaving] = useState(false);
  const [fileCategoryPreferenceError, setFileCategoryPreferenceError] = useState("");
  const [selectedFileYear, setSelectedFileYear] = useState(() => settings.financialYear || "all");
  const [fileYearLocked, setFileYearLocked] = useState(false);
  const [fileInitiationFromDate, setFileInitiationFromDate] = useState("");
  const [fileInitiationToDate, setFileInitiationToDate] = useState("");
  const [reportsSummary, setReportsSummary] = useState<ReportsSummaryPayload | undefined>();
  const [mmgDashboardSummary, setMmgDashboardSummary] = useState<
    DashboardSummaryPayload | undefined
  >();
  const [mmgFiles, setMmgFiles] = useState<FileRecord[]>([]);
  const [mmgPreviousFiles, setMmgPreviousFiles] = useState<FileRecord[]>([]);
  const [masterFirms, setMasterFirms] = useState<MasterFirm[]>([]);
  const [mmgLoading, setMmgLoading] = useState(false);
  const [mmgError, setMmgError] = useState<string | undefined>();
  const [firmDatabaseLoading, setFirmDatabaseLoading] = useState(false);
  const [firmDatabaseError, setFirmDatabaseError] = useState<string | undefined>();
  const [reportsLoading, setReportsLoading] = useState(false);
  const [hasLoadedReports, setHasLoadedReports] = useState(false);
  const [reportsError, setReportsError] = useState<string | undefined>();
  const hasLoadedReportsRef = useRef(false);
  const isPreSoExpectedCashOutgoReport = reportMode === "preSoExpectedCashOutgo";
  const needsMmgFiles = [
    "mmgSummary",
    "demandProcessingAnalysis",
    "firmDatabase",
    "preSoExpectedCashOutgo",
    "pendingLiabilityAgeing",
    "soPaymentMatrix",
    "paymentCompletedMatrix",
  ].includes(reportMode);
  const needsMmgPreviousFiles = reportMode === "mmgSummary";
  const needsMmgDashboardSummary = reportMode === "mmgSummary" || reportMode === "unifiedFinanceReview";
  const needsMasterFirms = reportMode === "firmDatabase";
  const needsMerRows = reportMode === "merData" || reportMode === "merComparison";
  useEffect(() => {
    const requestedMode = typeof locationSearch.mode === "string" ? locationSearch.mode : undefined;
    if (isReportMode(requestedMode)) {
      setReportMode(requestedMode);
    }
  }, [locationSearch.mode]);
  const bgReceiptDelayStorageKey = `recordkeeper:bg-receipt-delay-days:${
    activeUser?.id ?? "anonymous"
  }`;
  const warrantyBgBufferStorageKey = `recordkeeper:warranty-bg-buffer-days:${
    activeUser?.id ?? "anonymous"
  }`;
  useEffect(() => {
    if (!activeUser?.id) return;
    let active = true;
    setMatrixFieldsPreferenceLoading(true);
    setMatrixFieldsPreferenceError("");
    setSoPaymentMatrixFields([...soPaymentMatrixDefaultFields]);
    setPaymentCompletedMatrixFields([...soPaymentMatrixDefaultFields]);
    setSoPaymentMatrixLocked(false);
    setPaymentCompletedMatrixLocked(false);
    const loadPreference = (reportKey: string): Promise<{ locked?: boolean; fields?: unknown }> => {
      if (activeUser.id.startsWith("viewer:")) {
        try {
          return Promise.resolve(
            JSON.parse(
              window.localStorage.getItem(
                `recordkeeper:reports-matrix-fields:${activeUser.id}:${reportKey}`,
              ) || "{}",
            ),
          );
        } catch {
          return Promise.resolve({});
        }
      }
      return fetchReportPreferences<{ locked?: boolean; fields?: string[] }>(reportKey).then(
        ({ preferences }) => preferences,
      );
    };
    void Promise.all([loadPreference("paymentDueMatrix"), loadPreference("paymentCompletedMatrix")])
      .then(([due, completed]) => {
        if (!active) return;
        const validKeys = new Set(soPaymentMatrixFieldOptions.map((option) => option.key));
        if (Array.isArray(due.fields)) {
          const fields = due.fields.filter((key: unknown): key is SoPaymentMatrixFieldKey =>
            validKeys.has(key as SoPaymentMatrixFieldKey),
          );
          if (fields.length) setSoPaymentMatrixFields(fields);
          setSoPaymentMatrixLocked(due.locked === true);
        }
        if (Array.isArray(completed.fields)) {
          const fields = completed.fields.filter((key: unknown): key is SoPaymentMatrixFieldKey =>
            validKeys.has(key as SoPaymentMatrixFieldKey),
          );
          if (fields.length) setPaymentCompletedMatrixFields(fields);
          setPaymentCompletedMatrixLocked(completed.locked === true);
        }
      })
      .catch((error) => {
        if (active) {
          setMatrixFieldsPreferenceError(
            error instanceof Error ? error.message : "Payment matrix preferences could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setMatrixFieldsPreferenceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeUser?.id]);
  const expectedCashOutgoDaysStorageKey = `recordkeeper:expected-cash-outgo-days:${
    activeUser?.id ?? "anonymous"
  }`;
  const expectedCashOutgoDaysUsesLocalStorage = activeUser?.id.startsWith("viewer:") ?? false;
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
    if (!activeUser?.id) return;
    let active = true;
    setFileCategoryPreferenceLoading(true);
    setFileCategoryPreferenceError("");
    setFileCategoryLocked(false);
    setFileCategoryFilterTouched(false);
    setSelectedFileCategories(visibleFileCategoryKeys);
    const loadPreference = activeUser.id.startsWith("viewer:")
      ? Promise.resolve((() => {
          try {
            const saved = window.localStorage.getItem(
              `recordkeeper:reports-file-type:${activeUser.id}`,
            );
            return JSON.parse(saved || "{}");
          } catch {
            return {};
          }
        })())
      : fetchReportPreferences<{ locked?: boolean; categories?: string[] }>("fileTypeFilter")
          .then(({ preferences }) => preferences);
    void loadPreference
      .then((preferences) => {
        if (!active) return;
        if (preferences.locked === true && Array.isArray(preferences.categories)) {
          const visible = new Set(visibleFileCategoryKeys);
          setSelectedFileCategories(
            preferences.categories.filter(
              (key: string): key is FileCategoryKey => visible.has(key as FileCategoryKey),
            ),
          );
          setFileCategoryFilterTouched(true);
          setFileCategoryLocked(true);
        }
      })
      .catch((error) => {
        if (active) {
          setFileCategoryPreferenceError(
            error instanceof Error ? error.message : "File Type preference could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setFileCategoryPreferenceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeUser?.id, visibleFileCategoryKeys]);
  useEffect(() => {
    setSelectedFileCategories((current) => {
      if (fileCategoryLocked) {
        return current.filter((key) => visibleFileCategoryKeys.includes(key));
      }
      const allFixedSelected = allFileCategoryKeys.every((key) => current.includes(key));
      const visible = new Set(visibleFileCategoryKeys);
      const next = current.filter((key) => visible.has(key));
      if (allFixedSelected && next.length < visibleFileCategoryKeys.length) {
        return visibleFileCategoryKeys;
      }
      return next.length ? next : visibleFileCategoryKeys;
    });
  }, [visibleFileCategoryKeys, fileCategoryLocked]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(bgReceiptDelayStorageKey);
    if (!saved) {
      setBgReceiptDelayDays(defaultBgReceiptDelayDays);
      setBgReceiptDelayUnlocked(false);
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        setBgReceiptDelayDays(normalizeBgReceiptDelayDays(parsed.map(String)).map(String));
        setBgReceiptDelayUnlocked(false);
      }
    } catch {
      setBgReceiptDelayDays(defaultBgReceiptDelayDays);
      setBgReceiptDelayUnlocked(false);
    }
  }, [bgReceiptDelayStorageKey]);
  const toggleBgReceiptDelayLock = (nextUnlocked: boolean) => {
    if (!nextUnlocked && typeof window !== "undefined") {
      const normalized = normalizeBgReceiptDelayDays(bgReceiptDelayDays).map(String);
      setBgReceiptDelayDays(normalized);
      window.localStorage.setItem(bgReceiptDelayStorageKey, JSON.stringify(normalized));
    }
    setBgReceiptDelayUnlocked(nextUnlocked);
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(warrantyBgBufferStorageKey);
    setWarrantyBgBufferDays(normalizeWarrantyBgBufferDays(saved ?? "60"));
    setWarrantyBgBufferUnlocked(false);
  }, [warrantyBgBufferStorageKey]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    setExpectedCashOutgoDaysReady(false);
    const load = async () => {
      setExpectedCashOutgoDaysError("");
      setExpectedCashOutgoDaysSaved(false);
      try {
        const [preferencesResult, planResult] = await Promise.allSettled([
          expectedCashOutgoDaysUsesLocalStorage
            ? Promise.resolve({ preferences: {} as { expectedCashOutgoDays?: number } })
            : fetchReportPreferences<{ expectedCashOutgoDays?: number }>("cashOutgoOffsets"),
          fetchCashOutGoPlan(settings.financialYear, false, "all"),
        ]);
        if (planResult.status === "rejected") throw planResult.reason;
        if (!active) return;
        const preferences =
          preferencesResult.status === "fulfilled" ? preferencesResult.value.preferences : {};
        if (preferencesResult.status === "rejected" && !expectedCashOutgoDaysUsesLocalStorage) {
          setExpectedCashOutgoDaysError("Your saved offset could not be loaded; showing the shared value.");
        }
        const sharedDays = planResult.value.plan.settings.defaultDpOffsetDays;
        setSharedExpectedCashOutgoDays(String(sharedDays));
        const legacyDays = window.localStorage.getItem(expectedCashOutgoDaysStorageKey);
        const savedDays = expectedCashOutgoDaysUsesLocalStorage
          ? legacyDays
          : (preferences.expectedCashOutgoDays ?? legacyDays);
        const hasSavedOverride = expectedCashOutgoDaysUsesLocalStorage
          ? legacyDays !== null
          : preferences.expectedCashOutgoDays !== undefined || legacyDays !== null;
        const normalized = normalizeExpectedCashOutgoDays(
          savedDays === undefined || savedDays === null
            ? String(sharedDays)
            : String(savedDays),
        );
        if (!active) return;
        setExpectedCashOutgoDays(normalized);
        setExpectedCashOutgoDaysDraft(normalized);
        setExpectedCashOutgoDaysUnlocked(false);
        setHasExpectedCashOutgoDaysOverride(hasSavedOverride);
        if (
          !expectedCashOutgoDaysUsesLocalStorage &&
          preferencesResult.status === "fulfilled" &&
          preferences.expectedCashOutgoDays === undefined &&
          legacyDays !== null
        ) {
          await saveReportPreferences("cashOutgoOffsets", {
            expectedCashOutgoDays: Number(normalized),
          });
        }
        if (
          !expectedCashOutgoDaysUsesLocalStorage &&
          preferencesResult.status === "fulfilled"
        ) {
          window.localStorage.removeItem(expectedCashOutgoDaysStorageKey);
        }
      } catch (error) {
        if (!active) return;
        const legacyDays = window.localStorage.getItem(expectedCashOutgoDaysStorageKey);
        const normalized = normalizeExpectedCashOutgoDays(
          legacyDays ?? String(DEFAULT_DP_OFFSET_DAYS),
        );
        setSharedExpectedCashOutgoDays(String(DEFAULT_DP_OFFSET_DAYS));
        setExpectedCashOutgoDays(normalized);
        setExpectedCashOutgoDaysDraft(normalized);
        setExpectedCashOutgoDaysUnlocked(false);
        setHasExpectedCashOutgoDaysOverride(legacyDays !== null);
        setExpectedCashOutgoDaysError(
          error instanceof Error ? error.message : "Saved offset could not be loaded.",
        );
      } finally {
        if (active) setExpectedCashOutgoDaysReady(true);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [
    activeUser?.id,
    expectedCashOutgoDaysStorageKey,
    expectedCashOutgoDaysUsesLocalStorage,
    settings.financialYear,
  ]);
  useEffect(() => {
    let active = true;
    setFirmReportLayoutError("");
    const loadPreferences = activeUser?.id.startsWith("viewer:")
      ? Promise.resolve().then(() => {
          try {
            return {
              preferences: JSON.parse(
                window.localStorage.getItem(
                  `recordkeeper:firm-performance-layout:${activeUser.id}`,
                ) || "{}",
              ) as FirmDatabaseReportPreferences,
            };
          } catch {
            return { preferences: {} as FirmDatabaseReportPreferences };
          }
        })
      : fetchReportPreferences<FirmDatabaseReportPreferences>("firmDatabase");
    loadPreferences
      .then(({ preferences }) => {
        if (!active) return;
        const columns = normalizeFirmDatabaseColumnKeys(preferences.defaultColumns ?? []);
        const nextColumns = columns.length ? columns : defaultFirmDatabaseColumnKeys;
        setSavedFirmReportDefaultColumns(nextColumns);
        setVisibleFirmReportColumns(nextColumns);
        if (isFirmDatabaseSortKey(preferences.sortKey)) {
          setFirmReportSortKey(preferences.sortKey);
          setSavedFirmReportSortKey(preferences.sortKey);
        }
        if (preferences.sortDirection === "asc" || preferences.sortDirection === "desc") {
          setFirmReportSortDirection(preferences.sortDirection);
          setSavedFirmReportSortDirection(preferences.sortDirection);
        }
        setFirmReportLayoutLocked(preferences.locked === true);
      })
      .catch((error) => {
        if (!active) return;
        console.error(error);
        setSavedFirmReportDefaultColumns(defaultFirmDatabaseColumnKeys);
        setFirmReportLayoutLocked(false);
        setFirmReportLayoutError(
          error instanceof Error ? error.message : "Firm Performance layout could not be loaded.",
        );
      });
    return () => {
      active = false;
    };
  }, [activeUser?.id]);
  const restoreFirmDatabaseDefaultColumns = () => {
    setVisibleFirmReportColumns(savedFirmReportDefaultColumns);
    setFirmReportSortKey(savedFirmReportSortKey);
    setFirmReportSortDirection(savedFirmReportSortDirection);
  };
  const saveFirmDatabaseLayout = async (locked: boolean) => {
    const nextColumns = normalizeFirmDatabaseColumnKeys(visibleFirmReportColumns);
    setFirmReportLayoutSaving(true);
    setFirmReportLayoutError("");
    try {
      const preferences: FirmDatabaseReportPreferences = {
        defaultColumns: nextColumns,
        sortKey: firmReportSortKey,
        sortDirection: firmReportSortDirection,
        locked,
      };
      if (activeUser?.id.startsWith("viewer:")) {
        window.localStorage.setItem(
          `recordkeeper:firm-performance-layout:${activeUser.id}`,
          JSON.stringify(preferences),
        );
      } else {
        await saveReportPreferences<FirmDatabaseReportPreferences>("firmDatabase", preferences);
      }
      setSavedFirmReportDefaultColumns(nextColumns);
      setSavedFirmReportSortKey(firmReportSortKey);
      setSavedFirmReportSortDirection(firmReportSortDirection);
      setFirmReportLayoutLocked(locked);
    } catch (error) {
      setFirmReportLayoutError(
        error instanceof Error ? error.message : "Firm Performance layout could not be saved.",
      );
    } finally {
      setFirmReportLayoutSaving(false);
    }
  };
  const toggleWarrantyBgBufferLock = (nextUnlocked: boolean) => {
    if (!nextUnlocked && typeof window !== "undefined") {
      const normalized = normalizeWarrantyBgBufferDays(warrantyBgBufferDays);
      setWarrantyBgBufferDays(normalized);
      window.localStorage.setItem(warrantyBgBufferStorageKey, normalized);
    }
    setWarrantyBgBufferUnlocked(nextUnlocked);
  };
  const resetWarrantyBgBufferDays = () => {
    setWarrantyBgBufferDays("60");
    setWarrantyBgBufferUnlocked(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(warrantyBgBufferStorageKey, "60");
    }
  };
  const saveExpectedCashOutgoDays = async () => {
    const normalized = normalizeExpectedCashOutgoDays(expectedCashOutgoDaysDraft);
    setExpectedCashOutgoDaysSaving(true);
    setExpectedCashOutgoDaysError("");
    setExpectedCashOutgoDaysSaved(false);
    try {
      if (expectedCashOutgoDaysUsesLocalStorage) {
        window.localStorage.setItem(expectedCashOutgoDaysStorageKey, normalized);
      } else {
        await saveReportPreferences("cashOutgoOffsets", {
          expectedCashOutgoDays: Number(normalized),
        });
        window.localStorage.removeItem(expectedCashOutgoDaysStorageKey);
      }
      setExpectedCashOutgoDays(normalized);
      setExpectedCashOutgoDaysDraft(normalized);
      setExpectedCashOutgoDaysUnlocked(false);
      setExpectedCashOutgoDaysSaved(true);
      setHasExpectedCashOutgoDaysOverride(true);
    } catch (error) {
      setExpectedCashOutgoDaysError(
        error instanceof Error ? error.message : "Offset could not be saved to your account.",
      );
    } finally {
      setExpectedCashOutgoDaysSaving(false);
    }
  };
  const resetExpectedCashOutgoDays = async () => {
    setExpectedCashOutgoDaysSaving(true);
    setExpectedCashOutgoDaysError("");
    setExpectedCashOutgoDaysSaved(false);
    try {
      if (expectedCashOutgoDaysUsesLocalStorage) {
        window.localStorage.removeItem(expectedCashOutgoDaysStorageKey);
      } else {
        await saveReportPreferences("cashOutgoOffsets", {});
        window.localStorage.removeItem(expectedCashOutgoDaysStorageKey);
      }
      const resetDays = sharedExpectedCashOutgoDays;
      setExpectedCashOutgoDays(resetDays);
      setExpectedCashOutgoDaysDraft(resetDays);
      setExpectedCashOutgoDaysUnlocked(false);
      setExpectedCashOutgoDaysSaved(true);
      setHasExpectedCashOutgoDaysOverride(false);
    } catch (error) {
      setExpectedCashOutgoDaysError(
        error instanceof Error ? error.message : "Could not reset to the shared offset.",
      );
    } finally {
      setExpectedCashOutgoDaysSaving(false);
    }
  };
  const toggleExpectedCashOutgoDaysLock = (nextUnlocked: boolean) => {
    if (nextUnlocked) {
      setExpectedCashOutgoDaysDraft(expectedCashOutgoDays);
      setExpectedCashOutgoDaysSaved(false);
    } else {
      setExpectedCashOutgoDaysDraft(expectedCashOutgoDays);
    }
    setExpectedCashOutgoDaysUnlocked(nextUnlocked);
  };
  const selectedDivisionIsAccessible =
    selectedDivision === "all" || divisions.some((division) => division.name === selectedDivision);
  const activeDivision = selectedDivisionIsAccessible ? selectedDivision : "all";
  const activeDivisionId =
    activeDivision === "all"
      ? "all"
      : (divisions.find((division) => division.name === activeDivision)?.id ?? "all");
  const fileYearOptions = useMemo(
    () => Array.from(new Set(settings.financialYears ?? [])).filter(Boolean),
    [settings.financialYears],
  );
  const availableFileYearOptions = useMemo(() => {
    const globalYearStart = readFinancialYearStart(settings.selectedYear);
    if (globalYearStart === undefined) return fileYearOptions;
    return fileYearOptions.filter((year) => {
      const yearStart = readFinancialYearStart(year);
      return yearStart === undefined || yearStart <= globalYearStart;
    });
  }, [fileYearOptions, settings.selectedYear]);
  const fileYearFilterStorageKey = `recordkeeper:file-year-filter:${activeUser?.id ?? "anonymous"}`;
  const fileInitiationDateRangeStorageKey = `recordkeeper:file-initiation-date-range:${
    activeUser?.id ?? "anonymous"
  }`;
  const defaultFileYear = "all";
  const fileYearAllOptionLabel = isAllFilesYear(settings.selectedYear)
    ? "Entire database"
    : "All file years";
  const activeFileYear =
    selectedFileYear === "all" || availableFileYearOptions.includes(selectedFileYear)
      ? selectedFileYear
      : defaultFileYear;
  useEffect(() => {
    if (!isPreSoExpectedCashOutgoReport) return;
    if (settings.selectedYear !== ALL_ACTIVE_FILES_YEAR) {
      store.updateSessionSelectedYear(ALL_ACTIVE_FILES_YEAR);
    }
    if (activeFileYear !== "all") setSelectedFileYear("all");
    if (fileInitiationFromDate || fileInitiationToDate) {
      setFileInitiationFromDate("");
      setFileInitiationToDate("");
    }
  }, [
    activeFileYear,
    fileInitiationFromDate,
    fileInitiationToDate,
    isPreSoExpectedCashOutgoReport,
    settings.selectedYear,
  ]);
  useEffect(() => {
    if (typeof window === "undefined" || !availableFileYearOptions.length) return;
    if (isPreSoExpectedCashOutgoReport) {
      setFileYearLocked(true);
      setSelectedFileYear("all");
      return;
    }
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
  }, [
    availableFileYearOptions,
    defaultFileYear,
    fileYearFilterStorageKey,
    isPreSoExpectedCashOutgoReport,
  ]);
  const updateFileYearSelection = (year: string) => {
    setSelectedFileYear(year);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        fileYearFilterStorageKey,
        JSON.stringify({ locked: fileYearLocked, year }),
      );
      window.dispatchEvent(new Event("recordkeeper:filter-scope-changed"));
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
    if (isPreSoExpectedCashOutgoReport) {
      setFileInitiationFromDate("");
      setFileInitiationToDate("");
      return;
    }
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
  }, [fileInitiationDateRangeStorageKey, isPreSoExpectedCashOutgoReport]);
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
  const fileYearFilterDisabled = isFileYearFilterDisabledReport(reportMode);
  const fileMatchesActiveFileYear = (file: FileRecord) =>
    fileYearFilterDisabled ||
    ((activeFileYear === "all" || file.year === activeFileYear) &&
      fileMatchesInitiationDateRange(file, activeFileInitiationDateRange));
  const fileCategoryFilterDisabled = isFileCategoryFilterDisabledReport(reportMode);
  const fileYearFilterActive = !fileYearFilterDisabled && activeFileYear !== "all";
  const fileInitiationDateFilterActive =
    !fileYearFilterDisabled && Boolean(activeFileInitiationDateRange);
  const fileCategoryFilterActive =
    !fileCategoryFilterDisabled &&
    fileCategoryFilterTouched &&
    selectedFileCategories.filter((category) => visibleFileCategoryKeys.includes(category))
      .length !== visibleFileCategoryKeys.length;
  const activeFileCategoriesParam = fileCategoryFilterActive
    ? serializeFileCategories(selectedFileCategories)
    : undefined;
  const merComparisonIsOrganizationWide =
    activeDivision === "all" &&
    !fileCategoryFilterActive &&
    (activeUser?.role === "admin" ||
      activeUser?.role === "sub_admin" ||
      activeUser?.role === "universal_viewer");
  const cashOutGoPlanFileCategoriesParam =
    reportMode === "cashOutGoPlan" ? activeFileCategoriesParam : undefined;
  const expectedCashOutgoOffsetDays = getDelayThresholdDays(expectedCashOutgoDays);
  const delayStatusThresholdDays = getDelayThresholdDays(delayStatusDays);
  const normalizedBgReceiptDelayDays = useMemo(
    () => normalizeBgReceiptDelayDays(bgReceiptDelayDays),
    [bgReceiptDelayDays],
  );
  const normalizedWarrantyBgBufferDays = getDelayThresholdDays(warrantyBgBufferDays) || 60;
  const optionalCashOutgoDateFilterActive = isOptionalCashOutgoDateFilterReport(reportMode);
  const optionalReportScopeDateFilterActive = isReportScopeDateFilterReport(reportMode);
  const activeHistoricalDateRange = useMemo(() => {
    if (optionalCashOutgoDateFilterActive) {
      if (cashOutgoDateRangeFilter) {
        return { fromDate: historicalReportFromDate, toDate: historicalReportToDate };
      }
      return undefined;
    }
    return isHistoricalDateRangeReport(reportMode)
      ? { fromDate: historicalReportFromDate, toDate: historicalReportToDate }
      : undefined;
  }, [
    cashOutgoDateRangeFilter,
    historicalReportFromDate,
    historicalReportToDate,
    optionalCashOutgoDateFilterActive,
    reportMode,
  ]);
  const activeReportScopeDateRange = useMemo(() => {
    if (!optionalReportScopeDateFilterActive) return undefined;
    if (reportScopeDateRangeFilter) {
      return { fromDate: reportScopeFromDate, toDate: reportScopeToDate };
    }
    return undefined;
  }, [
    optionalReportScopeDateFilterActive,
    reportScopeDateRangeFilter,
    reportScopeFromDate,
    reportScopeToDate,
  ]);
  const reportsQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("division", activeDivision);
    if (!fileCategoryFilterDisabled && activeFileCategoriesParam) {
      params.set("fileCategories", activeFileCategoriesParam);
    }
    params.set("delayDays", String(delayStatusThresholdDays));
    params.set("expectedCashOutgoDays", String(expectedCashOutgoOffsetDays));
    params.set("delayMilestone", delayStatusMilestoneKey);
    params.set("selectedYear", settings.selectedYear);
    if (!fileYearFilterDisabled) {
      if (activeFileYear !== "all") params.set("fileYear", activeFileYear);
      Object.entries(fileInitiationDateQueryParams).forEach(([key, value]) => params.set(key, value));
    }
    if (reportMode === "bgReceiptDelay") {
      params.set("bgReceiptDelayDays", normalizedBgReceiptDelayDays.join(","));
    }
    if (reportMode === "warrantyBgMismatch") {
      params.set("warrantyBgBufferDays", String(normalizedWarrantyBgBufferDays));
    }
    if (activeHistoricalDateRange) {
      params.set("historicalFromDate", activeHistoricalDateRange.fromDate);
      params.set("historicalToDate", activeHistoricalDateRange.toDate);
    }
    if (isMonthSelectionReport(reportMode)) {
      params.set("cashOutgoMonth", selectedCashOutgoMonth);
    }
    return params.toString();
  }, [
    activeDivision,
    activeFileYear,
    delayStatusMilestoneKey,
    delayStatusThresholdDays,
    expectedCashOutgoOffsetDays,
    fileCategoryFilterDisabled,
    fileYearFilterDisabled,
    fileInitiationDateQueryParams,
    activeHistoricalDateRange,
    reportMode,
    normalizedBgReceiptDelayDays,
    normalizedWarrantyBgBufferDays,
    selectedCashOutgoMonth,
    activeFileCategoriesParam,
    settings.selectedYear,
  ]);

  useEffect(() => {
    if (!expectedCashOutgoDaysReady) return;
    const controller = new AbortController();
    const delay = hasLoadedReportsRef.current ? 180 : 0;
    const timeoutId = window.setTimeout(() => {
      setReportsLoading(true);
      setReportsError(undefined);
      fetchReportsSummary(reportsQuery, controller.signal)
        .then((payload) => {
          setReportsSummary(payload.summary);
          setHasLoadedReports(true);
          hasLoadedReportsRef.current = true;
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.error(error);
          setReportsError(error instanceof Error ? error.message : "Reports request failed.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setReportsLoading(false);
        });
    }, delay);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [expectedCashOutgoDaysReady, reportsQuery]);

  useEffect(() => {
    if (!expectedCashOutgoDaysReady) return;
    if (!needsMmgDashboardSummary) {
      setMmgDashboardSummary(undefined);
      return;
    }
    const controller = new AbortController();
    fetchDashboardSummary(reportsQuery, controller.signal)
      .then((payload) => setMmgDashboardSummary(payload.summary))
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setMmgDashboardSummary(undefined);
    });
    return () => controller.abort();
  }, [expectedCashOutgoDaysReady, needsMmgDashboardSummary, reportsQuery]);

  useEffect(() => {
    if (!needsMmgFiles) {
      setMmgFiles([]);
      setMmgPreviousFiles([]);
      setMmgError(undefined);
      setMmgLoading(false);
      return;
    }
    let active = true;
    setMmgLoading(true);
    setMmgError(undefined);
    const allFilesRequest = needsMmgPreviousFiles
      ? fetchFilesForYear("")
      : Promise.resolve({ files: [] as FileRecord[] });
    Promise.all([fetchFilesForYear(settings.selectedYear), allFilesRequest])
      .then(([current, allFiles]) => {
        if (!active) return;
        setMmgFiles(current.files);
        setMmgPreviousFiles(allFiles.files);
      })
      .catch((error) => {
        if (!active) return;
        console.error(error);
        setMmgError(error instanceof Error ? error.message : "MMG Summary request failed.");
      })
      .finally(() => {
        if (active) setMmgLoading(false);
      });
    return () => {
      active = false;
    };
  }, [needsMmgFiles, needsMmgPreviousFiles, reportMode, settings.selectedYear]);

  useEffect(() => {
    if (!needsMasterFirms) {
      setMasterFirms([]);
      setFirmDatabaseError(undefined);
      setFirmDatabaseLoading(false);
      return;
    }
    let active = true;
    setFirmDatabaseLoading(true);
    setFirmDatabaseError(undefined);
    fetchAllMasterFirms()
      .then((firms) => {
        if (active) setMasterFirms(firms);
      })
      .catch((error) => {
        if (!active) return;
        console.error(error);
        setFirmDatabaseError(
          error instanceof Error ? error.message : "Firm Performance request failed.",
        );
      })
      .finally(() => {
        if (active) setFirmDatabaseLoading(false);
      });
    return () => {
      active = false;
    };
  }, [needsMasterFirms]);

  const expectedCashOutgoDpRows = reportsSummary?.expectedCashOutgoDpRows ?? [];
  const expectedCashOutgoReceiptRows = reportsSummary?.expectedCashOutgoReceiptRows ?? [];
  const expectedCashOutgoReceiptPendingBillRows =
    reportsSummary?.expectedCashOutgoReceiptPendingBillRows ?? [];
  const expectedCashOutgoBillPreparationRows =
    reportsSummary?.expectedCashOutgoBillPreparationRows ?? [];
  const billSentForPaymentRows = reportsSummary?.billSentForPaymentRows ?? [];
  const actualCashOutgoRows = reportsSummary?.actualCashOutgoRows ?? [];
  const supplementaryBillSentForPaymentRows =
    reportsSummary?.supplementaryBillSentForPaymentRows ?? [];
  const supplementaryActualCashOutgoRows = reportsSummary?.supplementaryActualCashOutgoRows ?? [];
  const pendingReturnedBillRows = reportsSummary?.pendingReturnedBillRows ?? [];
  const returnedBillResubmittedRows = reportsSummary?.returnedBillResubmittedRows ?? [];
  const returnedBillPaidRows = reportsSummary?.returnedBillPaidRows ?? [];
  const supplementaryPendingReturnedBillRows =
    reportsSummary?.supplementaryPendingReturnedBillRows ?? [];
  const supplementaryReturnedBillResubmittedRows =
    reportsSummary?.supplementaryReturnedBillResubmittedRows ?? [];
  const supplementaryReturnedBillPaidRows = reportsSummary?.supplementaryReturnedBillPaidRows ?? [];
  const delayStatusRows = reportsSummary?.delayRows ?? [];
  const delayStatusSummary = reportsSummary?.delaySummary ?? getDelayStatusSummary(delayStatusRows);
  const today = formatLocalDate(new Date());
  const currentMonthKey = getCurrentMonthKey();
  const effectiveFinancialYear =
    isAllFilesYear(settings.selectedYear) ||
    isAllActiveFilesYear(settings.selectedYear) ||
    isActivePlusCurrentFyClosedYear(settings.selectedYear)
      ? settings.financialYear
      : settings.selectedYear || settings.financialYear;
  useEffect(() => {
    setHistoricalReportFromDate(getFinancialYearStartDate(effectiveFinancialYear));
    setHistoricalReportToDate(formatLocalDate(new Date()));
    setReportScopeFromDate(getFinancialYearStartDate(effectiveFinancialYear));
    setReportScopeToDate(formatLocalDate(new Date()));
  }, [effectiveFinancialYear]);
  useEffect(() => {
    if (reportMode !== "cashOutGoPlan" && reportMode !== "mmgSummary" && reportMode !== "unifiedFinanceReview") return;
    const controller = new AbortController();
    setCashOutGoPlanLoading(true);
    setCashOutGoPlanError(undefined);
    fetchCashOutGoPlan(
      effectiveFinancialYear,
      reportMode === "cashOutGoPlan" ? cashOutGoPlanIncludePreviousFy : false,
      activeDivisionId,
      controller.signal,
      cashOutGoPlanFileCategoriesParam,
    )
      .then(({ plan }) => {
        const exclusivePlan = enforceExclusiveCashOutGoPlanRows(plan);
        setCashOutGoPlan(exclusivePlan);
        setCashOutGoPlanSavedSnapshot(getCashOutGoPlanDirtySnapshot(exclusivePlan));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setCashOutGoPlan(undefined);
        setCashOutGoPlanSavedSnapshot("");
        setCashOutGoPlanError(
          error instanceof Error ? error.message : "Cash Out Go Plan could not be loaded.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setCashOutGoPlanLoading(false);
      });
    return () => controller.abort();
  }, [
    reportMode,
    effectiveFinancialYear,
    cashOutGoPlanIncludePreviousFy,
    activeDivisionId,
    cashOutGoPlanFileCategoriesParam,
  ]);
  useEffect(() => {
    if (!needsMerRows) {
      setMerRows([]);
      setMerDraftRows(buildMerDraftRows(effectiveFinancialYear, []));
      setMerError(undefined);
      setMerLoading(false);
      setMerEditing(false);
      return;
    }
    let active = true;
    setMerLoading(true);
    setMerError(undefined);
    fetchMerCashOutgo(effectiveFinancialYear)
      .then(({ rows }) => {
        if (!active) return;
        setMerRows(rows);
        setMerDraftRows(buildMerDraftRows(effectiveFinancialYear, rows));
        setMerEditing(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMerRows([]);
        setMerDraftRows(buildMerDraftRows(effectiveFinancialYear, []));
        setMerError(error instanceof Error ? error.message : "MER data could not be loaded.");
      })
      .finally(() => {
        if (active) setMerLoading(false);
      });
    return () => {
      active = false;
    };
  }, [effectiveFinancialYear, needsMerRows]);
  const mmgFilteredSourceFiles = filterFilesByReceivedDateRange(
    filterMmgFilesByDivision(mmgFiles, activeDivision).filter(fileMatchesActiveFileYear),
    activeReportScopeDateRange,
  );
  const mmgFilteredFiles = fileCategoryFilterActive
    ? filterFilesByCategory(mmgFilteredSourceFiles, selectedFileCategories)
    : mmgFilteredSourceFiles;
  const mmgPreviousFilteredSourceFiles = filterFilesByReceivedDateRange(
    filterMmgFilesByDivision(
      mmgPreviousFiles.filter(
        (file) =>
          isPreviousFinancialYearFile(file, effectiveFinancialYear) &&
          fileMatchesActiveFileYear(file),
      ),
      activeDivision,
    ),
    activeReportScopeDateRange,
  );
  const mmgPreviousFilteredFiles = fileCategoryFilterActive
    ? filterFilesByCategory(mmgPreviousFilteredSourceFiles, selectedFileCategories)
    : mmgPreviousFilteredSourceFiles;
  const preSoCurrentYearContext =
    isAllActiveFilesYear(settings.selectedYear) ||
    isActivePlusCurrentFyClosedYear(settings.selectedYear) ||
    settings.selectedYear === settings.financialYear;
  const preSoDefaultStageOffset = useMemo(
    () => getPreSoDefaultStageOffset(settings),
    [settings.preSoDefaultPaymentOffsetDays, settings.preSoDefaultSoOffsetDays],
  );
  const preSoStageOptions = useMemo(() => getPreSoStageOptions(), []);
  const preSoEligibleFiles = useMemo(
    () =>
      preSoCurrentYearContext
        ? mmgFilteredFiles.filter((file) => isPreSoExpectedCashOutgoEligibleFile(file))
        : [],
    [mmgFilteredFiles, preSoCurrentYearContext],
  );
  const preSoRows = useMemo(
    () =>
      buildPreSoExpectedCashOutgoRows({
        files: preSoEligibleFiles,
        selectedStageKeys: preSoSelectedStageKeys,
        stageOffsets: preSoStageOffsets,
        fileDrafts: preSoFileDrafts,
        today,
        defaultOffset: preSoDefaultStageOffset,
      }),
    [
      preSoDefaultStageOffset,
      preSoEligibleFiles,
      preSoFileDrafts,
      preSoSelectedStageKeys,
      preSoStageOffsets,
      today,
    ],
  );
  const preSoSelectedRows = preSoRows.filter((row) => row.draft.included);
  const preSoTotals = getPreSoExpectedCashOutgoTotals(preSoSelectedRows);
  const preSoMonthwiseRows = getPreSoExpectedCashOutgoMonthwiseRows(preSoSelectedRows);
  const preSoCurrentSnapshot = getPreSoPlanSnapshot(
    preSoSelectedStageKeys,
    preSoStageOffsets,
    preSoFileDrafts,
    preSoDefaultStageOffset,
  );
  const preSoPlanDirty = preSoCurrentSnapshot !== preSoSavedSnapshot;
  const updatePreSoStageOffset = (
    stageKey: string,
    field: keyof PreSoStageOffset,
    value: string,
  ) => {
    setPreSoStageOffsets((current) => ({
      ...current,
      [stageKey]: {
        soOffsetDays: current[stageKey]?.soOffsetDays ?? preSoDefaultStageOffset.soOffsetDays,
        paymentOffsetDays:
          current[stageKey]?.paymentOffsetDays ?? preSoDefaultStageOffset.paymentOffsetDays,
        [field]: value,
      },
    }));
  };
  const updatePreSoFileDraft = (
    fileId: string,
    patch: Partial<PreSoFileDraft>,
    defaults?: Partial<PreSoFileDraft>,
  ) => {
    setPreSoFileDrafts((current) => ({
      ...current,
      [fileId]: {
        included: current[fileId]?.included ?? defaults?.included ?? false,
        tentativeSoDate: current[fileId]?.tentativeSoDate ?? defaults?.tentativeSoDate ?? "",
        tentativePaymentDate:
          current[fileId]?.tentativePaymentDate ?? defaults?.tentativePaymentDate ?? "",
        ...patch,
      },
    }));
  };
  useEffect(() => {
    if (!isPreSoExpectedCashOutgoReport) return;
    let cancelled = false;
    setPreSoPlanLoading(true);
    setPreSoPlanError(undefined);
    fetchPreSoCashOutgoPlan()
      .then(({ plan }) => {
        if (cancelled) return;
        const loadedStageOffsets = Object.fromEntries(
          Object.entries(plan.stageOffsets ?? {}).map(([stageKey, offset]) => [
            stageKey,
            {
              soOffsetDays: String(offset.soOffsetDays ?? plan.defaultSoOffsetDays ?? 30),
              paymentOffsetDays: String(
                offset.paymentOffsetDays ?? plan.defaultPaymentOffsetDays ?? 30,
              ),
            },
          ]),
        );
        const loadedFileDrafts = Object.fromEntries(
          Object.entries(plan.filePlans ?? {}).map(([fileId, draft]) => [
            fileId,
            {
              included: Boolean(draft.included),
              tentativeSoDate: draft.tentativeSoDate ?? "",
              tentativePaymentDate: draft.tentativePaymentDate ?? "",
            },
          ]),
        );
        const loadedStageKeys = Object.keys(loadedStageOffsets);
        setPreSoSelectedStageKeys(loadedStageKeys);
        setPreSoStageOffsets(loadedStageOffsets);
        setPreSoFileDrafts(loadedFileDrafts);
        setPreSoPlanCanSave(Boolean(plan.canSave));
        setPreSoPlanCanSaveStageOffsets(Boolean(plan.canSaveStageOffsets));
        setPreSoSavedSnapshot(
          getPreSoPlanSnapshot(
            loadedStageKeys,
            loadedStageOffsets,
            loadedFileDrafts,
            getPreSoDefaultStageOffset({
              ...settings,
              preSoDefaultSoOffsetDays: plan.defaultSoOffsetDays,
              preSoDefaultPaymentOffsetDays: plan.defaultPaymentOffsetDays,
            }),
          ),
        );
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setPreSoPlanError("Unable to load saved Pre-S.O. plan.");
      })
      .finally(() => {
        if (!cancelled) setPreSoPlanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isPreSoExpectedCashOutgoReport]);
  const savePreSoPlan = () => {
    if (!preSoPlanCanSave) return;
    setPreSoPlanSaving(true);
    setPreSoPlanError(undefined);
    savePreSoCashOutgoPlan({
      stageOffsets: preSoSelectedStageKeys.map((stageKey) => {
        const offset = preSoStageOffsets[stageKey] ?? preSoDefaultStageOffset;
        return {
          stageKey,
          soOffsetDays: readPreSoOffsetDays(offset.soOffsetDays),
          paymentOffsetDays: readPreSoOffsetDays(offset.paymentOffsetDays),
        };
      }).filter(() => preSoPlanCanSaveStageOffsets),
      filePlans: preSoRows.map((row) => ({
        fileId: row.file.id,
        included: row.draft.included,
        tentativeSoDate: row.draft.tentativeSoDate,
        tentativePaymentDate: row.draft.tentativePaymentDate,
      })),
    })
      .then(() => setPreSoSavedSnapshot(preSoCurrentSnapshot))
      .catch((error) => {
        console.error(error);
        setPreSoPlanError("Unable to save Pre-S.O. plan.");
      })
      .finally(() => setPreSoPlanSaving(false));
  };
  const mmgSourceOverrides = useMemo(() => {
    const overrides = buildMmgSourceOverridesFromDashboard(mmgDashboardSummary);
    const remainingExpectedPayment = getCashOutGoPlanExpectedPaymentRemaining(cashOutGoPlan);
    if (remainingExpectedPayment !== undefined) {
      overrides.totalExpectedPaymentRemainingThisYear = {
        value: formatThousandsAndLakhs(remainingExpectedPayment / 100_000, 2),
      };
    }
    return overrides;
  }, [cashOutGoPlan, mmgDashboardSummary]);
  const mmgSummaryRows = buildMmgSummaryRows({
    files: mmgFilteredFiles,
    divisions:
      activeDivision === "all" ? divisions : divisions.filter((d) => d.name === activeDivision),
    previousYearFiles: mmgPreviousFilteredFiles,
    config: normalizeMmgSummaryFields(
      settings.mmgSummaryFields,
      settings.modes,
      settings.firmTypes,
      settings.fileTypes,
    ),
    financialYear: effectiveFinancialYear,
    modes: settings.modes,
    fileTypes: settings.fileTypes,
    firmTypes: settings.firmTypes,
    sourceOverrides: mmgSourceOverrides,
  });
  const demandProcessingPresets = getDemandProcessingPresets(settings.demandProcessingPresets);
  const selectedDemandPreset = demandProcessingPresets.find(
    (preset) => preset.id === demandAnalysisPresetId,
  );
  useEffect(() => {
    if (!selectedDemandPreset) return;
    setDemandAnalysisFromFieldId(selectedDemandPreset.fromFieldId);
    setDemandAnalysisToFieldId(selectedDemandPreset.toFieldId);
  }, [
    selectedDemandPreset?.fromFieldId,
    selectedDemandPreset?.id,
    selectedDemandPreset?.toFieldId,
  ]);
  const demandAnalysisSourceFiles = useMemo(
    () => mmgFilteredFiles.filter((file) => !isYes(file.demandCancelled)),
    [mmgFilteredFiles],
  );
  const demandProcessingFilterFields = useMemo(
    () =>
      getDemandProcessingFilterFields({
        settings,
        divisions,
        files: demandAnalysisSourceFiles,
      }),
    [demandAnalysisSourceFiles, divisions, settings],
  );
  const demandAnalysisAllRows = useMemo(
    () =>
      buildDemandProcessingRows(
        demandAnalysisSourceFiles,
        demandAnalysisFromFieldId,
        demandAnalysisToFieldId,
      ),
    [demandAnalysisFromFieldId, demandAnalysisSourceFiles, demandAnalysisToFieldId],
  );
  const demandAnalysisDateScopedRows = useMemo(
    () => filterDemandProcessingRowsByFromDate(demandAnalysisAllRows, activeReportScopeDateRange),
    [activeReportScopeDateRange, demandAnalysisAllRows],
  );
  const demandAnalysisFilteredRows = useMemo(
    () =>
      filterDemandProcessingRows(
        demandAnalysisDateScopedRows,
        demandAnalysisSourceFiles,
        demandAnalysisFilters,
        demandProcessingFilterFields,
      ),
    [
      demandAnalysisDateScopedRows,
      demandAnalysisFilters,
      demandAnalysisSourceFiles,
      demandProcessingFilterFields,
    ],
  );
  const demandAnalysisRows = useMemo(() => {
    if (!demandAnalysisPaymentMode) return demandAnalysisFilteredRows;
    const normalizedMode = demandAnalysisPaymentMode.toLowerCase();
    return demandAnalysisFilteredRows.filter(
      (row) => (row.paymentMode ?? "").trim().toLowerCase() === normalizedMode,
    );
  }, [demandAnalysisFilteredRows, demandAnalysisPaymentMode]);
  const demandAnalysisUnit = useMemo(
    () => getDemandProcessingAnalysisUnit(demandAnalysisFromFieldId, demandAnalysisToFieldId),
    [demandAnalysisFromFieldId, demandAnalysisToFieldId],
  );
  const demandAnalysisStats = useMemo(
    () => getDemandProcessingStats(demandAnalysisRows, demandAnalysisUnit),
    [demandAnalysisRows, demandAnalysisUnit],
  );
  const demandProcessingDayRanges = useMemo(
    () => normalizeDemandProcessingDayRanges(settings.demandProcessingDayRanges),
    [settings.demandProcessingDayRanges],
  );
  const demandProcessingRangeRows = useMemo(
    () =>
      getDemandProcessingRangeRows(
        demandAnalysisRows,
        demandProcessingDayRanges,
        demandAnalysisUnit,
      ),
    [demandAnalysisRows, demandAnalysisUnit, demandProcessingDayRanges],
  );
  const firmDatabaseRows = useMemo(() => {
    const rows = buildFirmDatabaseRows({
      firms: masterFirms,
      files: filterFilesForFirmPerformanceDateRange(
        demandAnalysisSourceFiles,
        activeReportScopeDateRange,
      ),
      ratingConfig: settings.firmRatingConfig,
    });
    const scopedRows = activeReportScopeDateRange ? rows.filter(hasFirmPerformanceActivity) : rows;
    return sortFirmDatabaseRows(scopedRows, firmReportSortKey, firmReportSortDirection);
  }, [
    activeReportScopeDateRange,
    demandAnalysisSourceFiles,
    firmReportSortDirection,
    firmReportSortKey,
    masterFirms,
    settings.firmRatingConfig,
  ]);
  const fyRange = getFinancialYearRange(effectiveFinancialYear);
  const cashOutgoMonthOptions = useMemo(
    () => getFinancialYearMonthOptions(effectiveFinancialYear, currentMonthKey),
    [effectiveFinancialYear, currentMonthKey],
  );
  useEffect(() => {
    if (!cashOutgoMonthOptions.length) return;
    if (cashOutgoMonthOptions.some((option) => option.value === selectedCashOutgoMonth)) return;
    setSelectedCashOutgoMonth(cashOutgoMonthOptions[cashOutgoMonthOptions.length - 1].value);
  }, [cashOutgoMonthOptions, selectedCashOutgoMonth]);
  const expectedCashOutgoFyRows = filterRowsByMonthRange(
    expectedCashOutgoDpRows,
    fyRange.startMonthKey,
    fyRange.endMonthKey,
  );
  const spentTillDateFyRows = actualCashOutgoRows;
  const merSoftwareComparisonRows = useMemo(() => {
    const paymentsByMonth = new Map<string, { capital: number; revenue: number }>();
    for (const row of spentTillDateFyRows) {
      const current = paymentsByMonth.get(row.monthKey) ?? { capital: 0, revenue: 0 };
      current.capital += row.capital;
      current.revenue += row.revenue;
      paymentsByMonth.set(row.monthKey, current);
    }
    return merDraftRows.map((row) => {
      const paid = paymentsByMonth.get(row.monthKey) ?? { capital: 0, revenue: 0 };
      const merCapital = readMerAmount(row.capital);
      const merRevenue = readMerAmount(row.revenue);
      const softwareCapital = paid.capital / 100_000;
      const softwareRevenue = paid.revenue / 100_000;
      return {
        monthKey: row.monthKey,
        month: row.month,
        merCapital,
        merRevenue,
        merTotal: merCapital + merRevenue,
        softwareCapital,
        softwareRevenue,
        softwareTotal: softwareCapital + softwareRevenue,
        difference: merCapital + merRevenue - softwareCapital - softwareRevenue,
      };
    });
  }, [merDraftRows, spentTillDateFyRows]);
  const merSoftwareComparisonTotals = merSoftwareComparisonRows.reduce(
    (total, row) => ({
      merCapital: total.merCapital + row.merCapital,
      merRevenue: total.merRevenue + row.merRevenue,
      merTotal: total.merTotal + row.merTotal,
      softwareCapital: total.softwareCapital + row.softwareCapital,
      softwareRevenue: total.softwareRevenue + row.softwareRevenue,
      softwareTotal: total.softwareTotal + row.softwareTotal,
      difference: total.difference + row.difference,
    }),
    { merCapital: 0, merRevenue: 0, merTotal: 0, softwareCapital: 0, softwareRevenue: 0, softwareTotal: 0, difference: 0 },
  );
  const currentLiabilityRows = getCurrentMonthLiabilityRows(
    combineCashOutgoRows([
      ...expectedCashOutgoReceiptPendingBillRows,
      ...expectedCashOutgoBillPreparationRows,
      ...billSentForPaymentRows,
    ]),
    selectedCashOutgoMonth,
  );
  const billsPaidInMonthRows = combineRowsForMonth(selectedCashOutgoMonth, [actualCashOutgoRows]);
  const cashOutgoForMonthRows = combineRowsForMonth(selectedCashOutgoMonth, [
    expectedCashOutgoBillPreparationRows,
    billSentForPaymentRows,
    expectedCashOutgoFyRows,
  ]);
  const expectedExpenditureTillMonthRows = combineRowsThroughMonthAsSingleMonth(
    selectedCashOutgoMonth,
    fyRange.startMonthKey,
    [
      spentTillDateFyRows,
      expectedCashOutgoBillPreparationRows,
      billSentForPaymentRows,
      expectedCashOutgoReceiptPendingBillRows,
    ],
  );
  const merExportRows = merDraftRows.map((row) => ({
    monthKey: row.monthKey,
    month: row.month,
    capital: merLakhsToInr(row.capital),
    revenue: merLakhsToInr(row.revenue),
    total: merLakhsToInr(row.capital) + merLakhsToInr(row.revenue),
  }));
  const soPaymentMatrixMonthKeys = useMemo(
    () => getFinancialYearMonthKeys(effectiveFinancialYear),
    [effectiveFinancialYear],
  );
  const soPaymentMatrixRows = useMemo(
    () =>
      buildSoPaymentMatrixRows({
        files: demandAnalysisSourceFiles,
        monthKeys: soPaymentMatrixMonthKeys,
        paymentOffsetDays: expectedCashOutgoOffsetDays,
      }),
    [demandAnalysisSourceFiles, expectedCashOutgoOffsetDays, soPaymentMatrixMonthKeys],
  );
  const paymentCompletedMatrixRows = useMemo(
    () =>
      buildPaymentCompletedMatrixRows({
        files: demandAnalysisSourceFiles,
        monthKeys: soPaymentMatrixMonthKeys,
      }),
    [demandAnalysisSourceFiles, soPaymentMatrixMonthKeys],
  );
  const soPaymentMatrixColumns = useMemo(
    () => getSoPaymentMatrixColumns(soPaymentMatrixFields),
    [soPaymentMatrixFields],
  );
  const paymentCompletedMatrixColumns = useMemo(
    () => getSoPaymentMatrixColumns(paymentCompletedMatrixFields),
    [paymentCompletedMatrixFields],
  );
  const updateMatrixFields = (
    setFields: Dispatch<SetStateAction<SoPaymentMatrixFieldKey[]>>,
    fieldKey: SoPaymentMatrixFieldKey,
    checked: boolean,
  ) => {
    setFields((current) => {
      if (checked) {
        const selected = new Set([...current, fieldKey]);
        return soPaymentMatrixFieldOptions
          .map((option) => option.key)
          .filter((key) => selected.has(key));
      }
      const next = current.filter((key) => key !== fieldKey);
      return next.length ? next : current;
    });
  };
  const saveMatrixFieldsLock = async (
    reportKey: string,
    locked: boolean,
    fields: SoPaymentMatrixFieldKey[],
  ) => {
    if (!activeUser?.id || matrixFieldsPreferenceSaving || matrixFieldsPreferenceLoading) return;
    setMatrixFieldsPreferenceSaving(true);
    setMatrixFieldsPreferenceError("");
    try {
      const preferences = { locked, fields };
      if (activeUser.id.startsWith("viewer:")) {
        window.localStorage.setItem(
          `recordkeeper:reports-matrix-fields:${activeUser.id}:${reportKey}`,
          JSON.stringify(preferences),
        );
      } else {
        await saveReportPreferences(reportKey, preferences);
      }
      if (reportKey === "paymentDueMatrix") setSoPaymentMatrixLocked(locked);
      else setPaymentCompletedMatrixLocked(locked);
    } catch (error) {
      setMatrixFieldsPreferenceError(
        error instanceof Error ? error.message : "Payment matrix preference could not be saved.",
      );
    } finally {
      setMatrixFieldsPreferenceSaving(false);
    }
  };
  const updateMerDraftAmount = (monthKey: string, field: "capital" | "revenue", value: string) => {
    setMerDraftRows((rows) =>
      rows.map((row) => (row.monthKey === monthKey ? { ...row, [field]: value } : row)),
    );
  };
  const resetMerDraftRows = () => {
    setMerDraftRows(buildMerDraftRows(effectiveFinancialYear, merRows));
    setMerEditing(false);
    setMerError(undefined);
  };
  const merDataDirty = !isReportDirtyValueEqual(
    getMerDraftDirtyRows(merDraftRows),
    getMerDraftDirtyRows(buildMerDraftRows(effectiveFinancialYear, merRows)),
  );
  const cashOutGoPlanDirty = cashOutGoPlan
    ? getCashOutGoPlanDirtySnapshot(cashOutGoPlan) !== cashOutGoPlanSavedSnapshot
    : false;
  const saveMerRows = () => {
    if (!canEditMerData || !merDataDirty) return;
    setMerSaving(true);
    setMerError(undefined);
    saveMerCashOutgo(
      effectiveFinancialYear,
      merDraftRows.map((row) => ({
        monthKey: row.monthKey,
        capital: merLakhsToInr(row.capital),
        revenue: merLakhsToInr(row.revenue),
      })),
    )
      .then(({ rows }) => {
        setMerRows(rows);
        setMerDraftRows(buildMerDraftRows(effectiveFinancialYear, rows));
        setMerEditing(false);
        if (cashOutGoPlan) {
          fetchCashOutGoPlan(
            effectiveFinancialYear,
            cashOutGoPlanIncludePreviousFy,
            activeDivisionId,
          )
            .then(({ plan }) => {
              const exclusivePlan = enforceExclusiveCashOutGoPlanRows(plan);
              setCashOutGoPlan(exclusivePlan);
              setCashOutGoPlanSavedSnapshot(getCashOutGoPlanDirtySnapshot(exclusivePlan));
            })
            .catch(() => {
              setCashOutGoPlanError(
                "MER was saved, but Cash Out Go Plan could not refresh. Reload the plan to update this section.",
              );
            });
        }
      })
      .catch((error: unknown) => {
        setMerError(error instanceof Error ? error.message : "MER data could not be saved.");
      })
      .finally(() => setMerSaving(false));
  };
  const updateCashOutGoPlanSettings = (
    field: "billOffsetDays" | "handSubmissionOffsetDays" | "dpOffsetDays",
    value: string,
  ) => {
    const nextValue = Math.max(0, Number.parseInt(value || "0", 10) || 0);
    const enabledField =
      field === "billOffsetDays"
        ? "useCustomBillOffsetDays"
        : field === "handSubmissionOffsetDays"
          ? "useCustomHandSubmissionOffsetDays"
          : "useCustomDpOffsetDays";
    const defaultValue =
      field === "billOffsetDays"
        ? cashOutGoPlan?.settings.defaultBillOffsetDays ?? DEFAULT_BILL_PAYMENT_OFFSET_DAYS
        : field === "handSubmissionOffsetDays"
          ? cashOutGoPlan?.settings.defaultHandSubmissionOffsetDays ?? DEFAULT_BILL_SUBMISSION_OFFSET_DAYS
          : cashOutGoPlan?.settings.defaultDpOffsetDays ?? DEFAULT_DP_OFFSET_DAYS;
    const isPersonalScope =
      activeUser?.role === "universal_viewer" && activeUser.cashOutgoEditScope === "personal";
    setCashOutGoPlan((plan) =>
      plan
        ? recalculateCashOutGoPlan(
            {
              ...plan,
              settings: {
                ...plan.settings,
                [field]: nextValue,
                [enabledField]: isPersonalScope ? nextValue !== defaultValue : true,
              },
            },
            { preserveExpectedSentDate: field === "billOffsetDays" },
          )
        : plan,
    );
  };
  const resetCashOutGoPlanOffset = (
    field: "billOffsetDays" | "handSubmissionOffsetDays" | "dpOffsetDays",
  ) => {
    const resetMap = {
      billOffsetDays: {
        value: cashOutGoPlan?.settings.defaultBillOffsetDays ?? DEFAULT_BILL_PAYMENT_OFFSET_DAYS,
        enabledField: "useCustomBillOffsetDays",
      },
      handSubmissionOffsetDays: {
        value: cashOutGoPlan?.settings.defaultHandSubmissionOffsetDays ?? DEFAULT_BILL_SUBMISSION_OFFSET_DAYS,
        enabledField: "useCustomHandSubmissionOffsetDays",
      },
      dpOffsetDays: {
        value: cashOutGoPlan?.settings.defaultDpOffsetDays ?? DEFAULT_DP_OFFSET_DAYS,
        enabledField: "useCustomDpOffsetDays",
      },
    } as const;
    const reset = resetMap[field];
    const isPersonalScope =
      activeUser?.role === "universal_viewer" && activeUser.cashOutgoEditScope === "personal";
    setCashOutGoPlan((plan) =>
      plan
        ? recalculateCashOutGoPlan(
            {
              ...plan,
              settings: {
                ...plan.settings,
                [field]: reset.value,
                [reset.enabledField]: !isPersonalScope,
              },
            },
            { preserveExpectedSentDate: field === "billOffsetDays" },
          )
        : plan,
    );
  };
  const updateCashOutGoPlanRow = (
    rowKey: string,
    field: "expectedSentDate" | "manualExpectedPaymentDate",
    value: string,
  ) => {
    setCashOutGoPlan((plan) => {
      if (!plan) return plan;
      const updateRows = (rows: CashOutGoPlanDetailRow[]) =>
        rows.map((row) =>
          row.rowKey === rowKey
            ? {
                ...row,
                [field]: value,
                expectedSentDateOverride:
                  field === "expectedSentDate" ? value : row.expectedSentDateOverride,
                ...(field === "expectedSentDate" ? { manualExpectedPaymentDate: "" } : {}),
              }
            : row,
        );
      return recalculateCashOutGoPlan(
        {
          ...plan,
          chequeslipsNotReceived: updateRows(plan.chequeslipsNotReceived ?? []),
          billsSubmitted: updateRows(plan.billsSubmitted),
          expectedPaymentInLaterFys: updateRows(plan.expectedPaymentInLaterFys ?? []),
          expectedPaymentDateInPast: updateRows(plan.expectedPaymentDateInPast ?? []),
          billsAtHand: updateRows(plan.billsAtHand),
          deliveredBillsPending: updateRows(plan.deliveredBillsPending),
          dpBasedForecast: updateRows(plan.dpBasedForecast ?? []),
          dpExpired: updateRows(plan.dpExpired ?? []),
        },
        { preserveExpectedSentDate: field !== "expectedSentDate" },
      );
    });
  };
  const resetCashOutGoPlanExpectedSentDate = (rowKey: string) => {
    setCashOutGoPlan((plan) => {
      if (!plan) return plan;
      const resetRows = (rows: CashOutGoPlanDetailRow[]) =>
        rows.map((row) =>
          row.rowKey === rowKey
            ? {
                ...row,
                expectedSentDate: "",
                expectedSentDateOverride: "",
                manualExpectedPaymentDate: "",
              }
            : row,
        );
      return recalculateCashOutGoPlan({
        ...plan,
        chequeslipsNotReceived: resetRows(plan.chequeslipsNotReceived ?? []),
        billsSubmitted: resetRows(plan.billsSubmitted),
        expectedPaymentInLaterFys: resetRows(plan.expectedPaymentInLaterFys ?? []),
        expectedPaymentDateInPast: resetRows(plan.expectedPaymentDateInPast ?? []),
        billsAtHand: resetRows(plan.billsAtHand),
        deliveredBillsPending: resetRows(plan.deliveredBillsPending),
        dpBasedForecast: resetRows(plan.dpBasedForecast ?? []),
        dpExpired: resetRows(plan.dpExpired ?? []),
      });
    });
  };
  const persistCashOutGoPlan = () => {
    if (!canEditCashOutGoPlan || !cashOutGoPlan || !cashOutGoPlanDirty) return;
    setCashOutGoPlanSaving(true);
    setCashOutGoPlanError(undefined);
    saveCashOutGoPlan(cashOutGoPlan)
      .then(() =>
        fetchCashOutGoPlan(
          effectiveFinancialYear,
          cashOutGoPlanIncludePreviousFy,
          activeDivisionId,
        ).then(({ plan }) => {
          const exclusivePlan = enforceExclusiveCashOutGoPlanRows(plan);
          setCashOutGoPlan(exclusivePlan);
          setCashOutGoPlanSavedSnapshot(getCashOutGoPlanDirtySnapshot(exclusivePlan));
        }),
      )
      .catch((error: unknown) => {
        setCashOutGoPlanError(
          error instanceof Error ? error.message : "Cash Out Go Plan could not be saved.",
        );
      })
      .finally(() => setCashOutGoPlanSaving(false));
  };
  const monitoringFilteredSourceFiles = filterMmgFilesByDivision(mmgFiles, activeDivision).filter(
    fileMatchesActiveFileYear,
  );
  const monitoringSourceFiles = fileCategoryFilterActive
    ? filterFilesByCategory(monitoringFilteredSourceFiles, selectedFileCategories)
    : monitoringFilteredSourceFiles;
  const pendingLiabilityAgeingRows = useMemo(
    () => getPendingLiabilityAgeingRows(monitoringSourceFiles, historicalReportToDate),
    [historicalReportToDate, monitoringSourceFiles],
  );
  const cashOutgoRowSources = {
    expectedCashOutgoReceiptPendingBillRows,
    expectedCashOutgoBillPreparationRows,
    billSentForPaymentRows,
    expectedCashOutgoFyRows,
    spentTillDateFyRows,
    billsPaidInMonthRows,
    currentLiabilityRows,
    cashOutgoForMonthRows,
    expectedExpenditureTillMonthRows,
    pendingReturnedBillRows,
    returnedBillResubmittedRows,
    returnedBillPaidRows,
    supplementaryBillSentForPaymentRows,
    supplementaryActualCashOutgoRows,
    supplementaryPendingReturnedBillRows,
    supplementaryReturnedBillResubmittedRows,
    supplementaryReturnedBillPaidRows,
  };
  const selectedCashOutgoRows = getRowsForReportMode(reportMode, cashOutgoRowSources);
  const selectedMonthlyReport = getMonthlyReportConfig(reportMode, reportsSummary);
  const selectedMonthlyReportYears = selectedMonthlyReport?.monthRowsByYear
    ? Object.keys(selectedMonthlyReport.monthRowsByYear).sort().join("\u0000")
    : "";
  const selectedMonthlyReportColumns = selectedMonthlyReport
    ? selectedMonthlyReport.supportsYearDrilldown
      ? getInlineMonthlyReportColumns(selectedMonthlyReport)
      : selectedMonthlyReport.columns
    : undefined;
  const selectedMonthlyReportRows = selectedMonthlyReport
    ? selectedMonthlyReport.supportsYearDrilldown
      ? getInlineMonthlyReportRows(selectedMonthlyReport, expandedMonthlyReportYears)
      : selectedMonthlyReport.rows
    : undefined;
  const selectedMonthlyReportExportColumns = selectedMonthlyReportColumns ?? [];
  const selectedMonthlyReportExportRows = selectedMonthlyReportRows ?? [];
  useEffect(() => {
    setExpandedMonthlyReportYears([]);
  }, [reportMode, settings.selectedYear]);
  useEffect(() => {
    if (!selectedMonthlyReportYears) return;
    const availableYears = new Set(selectedMonthlyReportYears.split("\u0000"));
    setExpandedMonthlyReportYears((current) =>
      current.filter((year) => availableYears.has(year)),
    );
  }, [selectedMonthlyReportYears]);
  const reportTitle = getEightReportTitle(reportMode, {
    today:
      isHistoricalDateRangeReport(reportMode) || isAsOnDateReport(reportMode)
        ? historicalReportToDate
        : today,
    monthKey: isMonthSelectionReport(reportMode) ? selectedCashOutgoMonth : currentMonthKey,
    financialYear: effectiveFinancialYear,
  });
  const reportTitleWithDivision =
    reportMode === "merComparison"
      ? `MER vs Recorded Payments - FY ${displayFinancialYearLabel(effectiveFinancialYear)} - ${activeDivision === "all" ? "All divisions" : activeDivision}`
      : activeDivision === "all"
        ? `${reportTitle} - All divisions`
        : `${reportTitle} - ${activeDivision}`;
  const selectedReportTitle =
    reportMode === "mmgSummary"
      ? activeDivision === "all"
        ? `MMG Summary - ${displayFinancialYearLabel(effectiveFinancialYear)} - All divisions`
        : `MMG Summary - ${displayFinancialYearLabel(effectiveFinancialYear)} - ${activeDivision}`
      : reportMode === "firmDatabase"
        ? activeDivision === "all"
          ? `Firm Performance - ${displayFinancialYearLabel(effectiveFinancialYear)} - All divisions`
          : `Firm Performance - ${displayFinancialYearLabel(effectiveFinancialYear)} - ${activeDivision}`
        : reportTitleWithDivision;
  const reportLogic = getCashOutgoReportLogic(reportMode, {
    today,
    monthKey: isMonthSelectionReport(reportMode) ? selectedCashOutgoMonth : currentMonthKey,
    financialYear: effectiveFinancialYear,
  });
  const billingPaymentReportDescription = getBillingPaymentReportDescription(reportMode, {
    activeHistoricalDateRange,
    cashOutgoDateRangeFilter,
    globalYear: settings.selectedYear,
  });
  const reportExportContextDescription = getReportsExportContextDescription({
    globalYear: settings.selectedYear,
    fileYear: activeFileYear,
    fileYearFilterDisabled,
    division: activeDivision,
    selectedFileCategories,
    visibleFileCategoryOptions,
    fileCategoryFilterDisabled,
    fileInitiationDateRange: activeFileInitiationDateRange,
    reportMode,
    activeHistoricalDateRange,
    activeReportScopeDateRange,
    selectedCashOutgoMonth,
    asOnDate: historicalReportToDate,
  });
  const cashOutgoExportDescription = getReportExportDescription(
    reportExportContextDescription,
    billingPaymentReportDescription || reportLogic,
    getCashOutgoTitleHelper(reportMode),
    reportMode === "expectedCashOutgoFy"
      ? `Analysis basis: D.P./revised D.P. date determines the report month, with a configured expected-payment offset of ${expectedCashOutgoOffsetDays} days.`
      : isMonthSelectionReport(reportMode)
        ? `Analysis basis: Selected month ${formatMonthTitle(selectedCashOutgoMonth)}.`
        : reportMode === "spentTillDateFy"
          ? `Analysis basis: Actual payment dates through ${formatIsoDateForDisplay(historicalReportToDate)}.`
          : undefined,
  );
  const cashOutgoEmptyMessage =
    reportMode === "merData"
      ? "No MER data found."
      : reportMode === "billsPaidInMonth"
        ? "No bills paid found for the selected month."
        : "No expected cash outgo rows found.";
  const cashOutgoCombinedExportDescription = getReportExportDescription(
    getReportsCombinedCashOutgoExportContextDescription({
      globalYear: settings.selectedYear,
      fileYear: activeFileYear,
      fileYearFilterDisabled,
      division: activeDivision,
      selectedFileCategories,
      visibleFileCategoryOptions,
      fileCategoryFilterDisabled,
      fileInitiationDateRange: activeFileInitiationDateRange,
      activeHistoricalDateRange,
      selectedCashOutgoMonth,
      asOnDate: historicalReportToDate,
    }),
    `Includes all ${combinedCashOutgoExportModes.length} Cash Outgo reports.`,
    "All the values are in Lakh.",
  );
  const cashOutGoPlanExportDescription = getReportExportDescription(
    reportExportContextDescription,
    "Analysis basis: Past-month values use MER where recorded; current and future months use plan entries and software forecasts.",
    `Previous FY submitted bills: ${cashOutGoPlanIncludePreviousFy ? "Included" : "Not included"}.`,
  );
  const pendingLiabilityDescription = [
    `Analysis basis: Liability ageing as of ${formatIsoDateForDisplay(historicalReportToDate)}.`,
    "Shows unpaid liabilities based on completed delivery/job completion, bill preparation, or bill sent date.",
    "A liability is pending if payment is blank, or payment was made after the selected date.",
    "Ageing is counted from the liability start date up to the selected date.",
    "If the liability start date is after the selected date, it is not counted.",
    "Historical view uses the latest dates entered in the file.",
    "Example: if Bill Sent date is 10-Sept and you select 31-Aug, it will not be counted as pending on 31-Aug.",
  ].join("\n");
  const exportAllCashOutgoReports = (format: "excel" | "pdf") => {
    const tables: ExportTable[] = combinedCashOutgoExportModes.map((mode) =>
      buildCashOutgoExportTable(mode, cashOutgoRowSources, {
        today:
          isHistoricalDateRangeReport(mode) || isAsOnDateReport(mode)
            ? historicalReportToDate
            : today,
        monthKey: isMonthSelectionReport(mode) ? selectedCashOutgoMonth : currentMonthKey,
        financialYear: effectiveFinancialYear,
      }),
    );
    void downloadBackendExport({
      format,
      title:
        activeDivision === "all"
          ? "Cash Outgo Reports - All divisions"
          : `Cash Outgo Reports - ${activeDivision}`,
      description: cashOutgoCombinedExportDescription,
      tables,
    });
  };
  const exportAllCashOutgoPdf = () => exportAllCashOutgoReports("pdf");
  const exportAllCashOutgoExcel = () => exportAllCashOutgoReports("excel");
  const exportCashOutgoPdf = (plot?: ExportPlot) =>
    reportMode === "merData"
      ? printExpectedCashOutgoToPdf(
          merExportRows,
          selectedReportTitle,
          cashOutgoExportDescription,
          cashOutgoEmptyMessage,
          plot,
        )
      : reportMode === "currentMonthLiability"
        ? printCurrentLiabilityToPdf(
            selectedCashOutgoRows,
            selectedReportTitle,
            cashOutgoExportDescription,
            plot,
          )
        : printExpectedCashOutgoToPdf(
            selectedCashOutgoRows,
            selectedReportTitle,
            cashOutgoExportDescription,
            cashOutgoEmptyMessage,
            plot,
          );
  const exportCashOutgoExcel = (plot?: ExportPlot) =>
    reportMode === "merData"
      ? exportExpectedCashOutgoToExcel(
          merExportRows,
          selectedReportTitle,
          cashOutgoExportDescription,
          cashOutgoEmptyMessage,
          plot,
        )
      : reportMode === "currentMonthLiability"
        ? exportCurrentLiabilityToExcel(
            selectedCashOutgoRows,
            selectedReportTitle,
            cashOutgoExportDescription,
            plot,
          )
        : exportExpectedCashOutgoToExcel(
            selectedCashOutgoRows,
            selectedReportTitle,
            cashOutgoExportDescription,
            cashOutgoEmptyMessage,
            plot,
          );
  const exportMerSoftwareComparison = (format: "pdf" | "excel", plot?: ExportPlot) => {
    const exportRows = merSoftwareComparisonRows.map((row) => [
      row.month,
      formatThousandsAndLakhs(readMerAmount(row.merCapital), 5),
      formatThousandsAndLakhs(readMerAmount(row.merRevenue), 5),
      formatThousandsAndLakhs(readMerAmount(row.merTotal), 5),
      formatThousandsAndLakhs(readMerAmount(row.softwareCapital), 5),
      formatThousandsAndLakhs(readMerAmount(row.softwareRevenue), 5),
      formatThousandsAndLakhs(readMerAmount(row.softwareTotal), 5),
      merComparisonIsOrganizationWide
        ? formatThousandsAndLakhs(readMerAmount(row.difference), 5)
        : "-",
    ]);
    void downloadBackendExport({
      format,
      title: `MER vs Recorded Payments - FY ${displayFinancialYearLabel(effectiveFinancialYear)} - ${activeDivision === "all" ? "All divisions" : activeDivision}`,
      description: [
        reportExportContextDescription,
        `FY: ${displayFinancialYearLabel(effectiveFinancialYear)}.`,
        "MER is the all-division amount entered for the month. Recorded Payments reflect payment entries available under the selected Division and other active report filters.",
        "Recorded Payments include S.O./stage, advance, and supplementary payments by payment date. Selecting one Division narrows Recorded Payments; MER remains all-division.",
        merComparisonIsOrganizationWide
          ? "Difference = MER minus Recorded Payments. All monetary values are shown in Lakhs."
          : "MER is shown as an all-division reference. Recorded Payments follow the selected scope, so no difference is calculated for this filtered view.",
      ].join("\n"),
      plot,
      tables: [{
        title: `Monthly comparison - FY ${displayFinancialYearLabel(effectiveFinancialYear)}`,
        headers: ["Month", "MER Capital", "MER Revenue", "MER Total", "Recorded Capital", "Recorded Revenue", "Recorded Total", merComparisonIsOrganizationWide ? "Difference (MER - Recorded)" : "Difference (all-scope only)"],
        rows: exportRows,
      }],
    });
  };
  const soPaymentMatrixExportDescription = reportExportContextDescription;
  const exportSoPaymentMatrix = (format: "excel" | "pdf", plot?: ExportPlot) =>
    exportSoPaymentMatrixReport(
      soPaymentMatrixRows,
      soPaymentMatrixColumns,
      soPaymentMatrixMonthKeys,
      selectedReportTitle,
      soPaymentMatrixExportDescription,
      format,
      plot,
    );
  const exportPaymentCompletedMatrix = (format: "excel" | "pdf", plot?: ExportPlot) =>
    exportSoPaymentMatrixReport(
      paymentCompletedMatrixRows,
      soPaymentMatrixColumns,
      soPaymentMatrixMonthKeys,
      selectedReportTitle,
      soPaymentMatrixExportDescription,
      format,
      plot,
    );
  const exportMmgSummaryPdf = () =>
    exportMmgSummary(mmgSummaryRows, selectedReportTitle, "pdf", reportExportContextDescription);
  const exportMmgSummaryExcel = () =>
    exportMmgSummary(mmgSummaryRows, selectedReportTitle, "excel", reportExportContextDescription);
  const delayStatusExportDescription = getReportExportDescription(
    reportExportContextDescription,
    `Analysis basis: ${delayStatusMilestoneKey === "all" ? "All milestones" : delayMilestoneOptions.find((item) => item.key === delayStatusMilestoneKey)?.label ?? delayStatusMilestoneKey}, delay threshold ${delayStatusThresholdDays} days.`,
    "Stages whose current milestone has remained open beyond the selected threshold.",
  );
  const exportDelayStatusPdf = () =>
    printDelayStatusToPdf(delayStatusRows, selectedReportTitle, delayStatusExportDescription);
  const exportDelayStatusExcel = () =>
    exportDelayStatusToExcel(delayStatusRows, selectedReportTitle, delayStatusExportDescription);
  const firmDatabaseExportDescription = getReportExportDescription(
    reportExportContextDescription,
    `Analysis basis: Sorted by ${firmDatabaseColumns.find((column) => column.key === firmReportSortKey)?.label ?? firmReportSortKey}, ${firmReportSortDirection === "asc" ? "ascending" : "descending"} order.`,
    "Firm-wise supply order value, delivery, BG, rating, and coverage analysis. This report does not assess payment timeliness or whether bills were paid.",
  );
  const exportFirmDatabasePdf = (plot?: ExportPlot) =>
    exportFirmDatabaseReport(
      firmDatabaseRows,
      visibleFirmReportColumns,
      firmReportSortKey,
      firmReportSortDirection,
      selectedReportTitle,
      "pdf",
      firmDatabaseExportDescription,
      plot,
    );
  const exportFirmDatabaseExcel = (plot?: ExportPlot) =>
    exportFirmDatabaseReport(
      firmDatabaseRows,
      visibleFirmReportColumns,
      firmReportSortKey,
      firmReportSortDirection,
      selectedReportTitle,
      "excel",
      firmDatabaseExportDescription,
      plot,
    );
  const selectedReportMode = reportModes.find((mode) => mode.key === reportMode) ?? reportModes[0];
  const historicalDateRangeChanged =
    historicalReportFromDate !== getFinancialYearStartDate(effectiveFinancialYear) ||
    historicalReportToDate !== today;
  const getReportSearchDrillPath = (details: Array<string | undefined> = []) =>
    serializeDrillPath([
      { label: "Reports", href: "/reports" },
      { label: selectedReportTitle, href: getReportModeHref(reportMode) },
      ...details
        .map((detail) => detail?.trim())
        .filter((detail): detail is string => Boolean(detail))
        .map((detail) => ({ label: detail, href: getReportModeHref(reportMode) })),
    ]);
  const historicalDateRangeControls = isHistoricalDateRangeReport(reportMode)
    ? optionalCashOutgoDateFilterActive
      ? {
          fromDate: historicalReportFromDate,
          toDate: historicalReportToDate,
          onFromDateChange: setHistoricalReportFromDate,
          onToDateChange: setHistoricalReportToDate,
          helperText: getDateRangeHelperText(reportMode),
          dateRangeEnabled: cashOutgoDateRangeFilter,
          active: cashOutgoDateRangeFilter,
          onDateRangeEnabledChange: (checked: boolean) => {
            setCashOutgoDateRangeFilter(checked);
          },
        }
      : {
          fromDate: historicalReportFromDate,
          toDate: historicalReportToDate,
          onFromDateChange: setHistoricalReportFromDate,
          onToDateChange: setHistoricalReportToDate,
          helperText: getDateRangeHelperText(reportMode),
          active: historicalDateRangeChanged,
        }
    : undefined;
  const reportScopeDateRangeControls = optionalReportScopeDateFilterActive
    ? {
        label: reportMode === "firmDatabase" ? "S.O. Date range" : undefined,
        fromDate: reportScopeFromDate,
        toDate: reportScopeToDate,
        onFromDateChange: setReportScopeFromDate,
        onToDateChange: setReportScopeToDate,
        helperText: getDateRangeHelperText(reportMode),
        dateRangeEnabled: reportScopeDateRangeFilter,
        active: reportScopeDateRangeFilter,
        onDateRangeEnabledChange: setReportScopeDateRangeFilter,
      }
    : undefined;
  const monthSelectionControls = isMonthSelectionReport(reportMode)
    ? {
        month: selectedCashOutgoMonth,
        options: cashOutgoMonthOptions,
        active: selectedCashOutgoMonth !== currentMonthKey,
        onMonthChange: setSelectedCashOutgoMonth,
      }
    : undefined;
  const getCashOutgoDateContext = () =>
    activeHistoricalDateRange
      ? activeHistoricalDateRange
      : isMonthSelectionReport(reportMode)
        ? { asOfDate: getMonthEndDate(selectedCashOutgoMonth) }
        : undefined;
  const getCashOutgoTotalMonthKey = (rows: ExpectedCashOutgoRow[]) =>
    rows.length === 1 ? (rows[0]?.monthKey ?? selectedCashOutgoMonth) : "all";
  const getCashOutgoTotalDateContext = (rows: ExpectedCashOutgoRow[]) => {
    if (rows.length === 1) return getCashOutgoDateContext();
    return activeHistoricalDateRange ?? getMonthRangeForCashOutgoRows(rows);
  };
  const getCashOutgoSearchYear = (mode: CashOutgoFilterMode) =>
    isActivePlusCurrentFyClosedYear(settings.selectedYear) && isPendingBillingCashOutgoMode(mode)
      ? ALL_ACTIVE_FILES_YEAR
      : undefined;
  const getCashOutgoAnySearchYear = (modes: CashOutgoFilterMode[]) =>
    isActivePlusCurrentFyClosedYear(settings.selectedYear) &&
    modes.some((mode) => isPendingBillingCashOutgoMode(mode))
      ? ALL_ACTIVE_FILES_YEAR
      : settings.selectedYear;
  const openCashOutgoSearch = (mode: CashOutgoFilterMode, monthKey: string) => {
    const dateContext = getCashOutgoDateContext();
    openCashOutgoSearchWithContext(mode, monthKey, dateContext);
  };
  const openCashOutgoSearchWithContext = (
    mode: CashOutgoFilterMode,
    monthKey: string,
    dateContext?: { fromDate?: string; toDate?: string; asOfDate?: string },
  ) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter: getCashOutgoDashboardFilter(
          mode,
          monthKey,
          expectedCashOutgoOffsetDays,
          dateContext,
        ),
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        selectedYear: getCashOutgoSearchYear(mode) ?? settings.selectedYear,
        drillPath: getReportSearchDrillPath([
          monthKey === "all" ? "All months" : formatMonthTitle(monthKey),
        ]),
      },
    });
  };
  const openCashOutgoAnySearch = (modes: CashOutgoFilterMode[], monthKey: string) => {
    const dateContext = getCashOutgoDateContext();
    openCashOutgoAnySearchWithContext(modes, monthKey, dateContext);
  };
  const openCashOutgoAnySearchWithContext = (
    modes: CashOutgoFilterMode[],
    monthKey: string,
    dateContext?: { fromDate?: string; toDate?: string; asOfDate?: string },
  ) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter: getCashOutgoAnyDashboardFilter(
          modes,
          monthKey,
          expectedCashOutgoOffsetDays,
          dateContext,
        ),
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        selectedYear: getCashOutgoAnySearchYear(modes),
        drillPath: getReportSearchDrillPath([
          monthKey === "all" ? "All months" : formatMonthTitle(monthKey),
        ]),
      },
    });
  };
  const openMonthlyReportSearch = (dashboardFilter: string) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        selectedYear: settings.selectedYear,
        drillPath: getReportSearchDrillPath(),
      },
    });
  };
  const openDelayStatusSearch = (milestoneKey = delayStatusMilestoneKey) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter: getDelayStatusDashboardFilter(delayStatusThresholdDays, milestoneKey),
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        selectedYear: settings.selectedYear,
        drillPath: getReportSearchDrillPath([milestoneKey === "all" ? undefined : milestoneKey]),
      },
    });
  };
  const openBiddingDelayBreakupSearch = (breakupKey: string) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `biddingDelay:${delayStatusThresholdDays}:${breakupKey}`,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        selectedYear: settings.selectedYear,
        drillPath: getReportSearchDrillPath([breakupKey]),
      },
    });
  };
  const openDelayStatusFile = (row: DelayStatusRow) => {
    navigate({
      to: "/add",
      search: {
        fileId: row.fileId,
        section: row.focusSection,
        milestone: row.focusSection === "Milestones" ? row.milestone : undefined,
        focusTarget: row.focusTarget,
        quickFocus: false,
      },
    });
  };
  const openCashOutGoPlanSource = (row: CashOutGoPlanDetailRow) => {
    if (!row.fileId) return;
    navigate({
      to: "/add",
      search: {
        fileId: row.fileId,
        section: "Supply order and payment",
        focusTarget: row.sourceFocusTarget || getFallbackCashOutGoPlanFocusTarget(row),
        quickFocus: false,
      },
    });
  };
  const openCashOutGoPlanRowsSearch = (rows: CashOutGoPlanDetailRow[]) => {
    const fileIds = Array.from(new Set(rows.map((row) => row.fileId).filter(Boolean)));
    if (!fileIds.length) return;
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `fileIds:${fileIds.map(encodeURIComponent).join(",")}`,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        selectedYear: settings.selectedYear,
        focusSection: "Supply order and payment",
        focusTarget: rows[0]?.sourceFocusTarget || getFallbackCashOutGoPlanFocusTarget(rows[0]),
        focusTargets: serializeCashOutGoPlanFocusTargets(rows),
        drillPath: getReportSearchDrillPath(),
      },
    });
  };
  const openSoPaymentMatrixSearch = (rows: SoPaymentMatrixRow[], monthKey?: string) => {
    const fileIds = Array.from(new Set(rows.map((row) => row.fileId).filter(Boolean)));
    if (!fileIds.length) return;
    const focusTargets = new Map<string, string>();
    rows.forEach((row) => {
      const focusTarget =
        (monthKey ? row.monthFocusTargets[monthKey] : undefined) ??
        Object.values(row.monthFocusTargets)[0] ??
        `payment:pending:${row.orderIndex}`;
      if (focusTarget) focusTargets.set(row.fileId, focusTarget);
    });
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `fileIds:${fileIds.map(encodeURIComponent).join(",")}`,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        selectedYear: settings.selectedYear,
        focusSection: "Supply order and payment",
        focusTarget: rows[0]
          ? ((monthKey ? rows[0].monthFocusTargets[monthKey] : undefined) ??
            Object.values(rows[0].monthFocusTargets)[0] ??
            `payment:pending:${rows[0].orderIndex}`)
          : undefined,
        focusTargets: serializeSoPaymentMatrixFocusTargets(focusTargets),
        drillPath: getReportSearchDrillPath([
          reportMode === "paymentCompletedMatrix"
            ? "Month-wise Payment completed Matrix"
            : "Month-wise Payment due Matrix",
          monthKey ? formatMonthTitle(monthKey) : undefined,
        ]),
      },
    });
  };
  const openPreSoFileInSearch = (row: PreSoFileRow) => {
    const fileId = row.file.id;
    if (!fileId) return;
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `fileIds:${encodeURIComponent(fileId)}`,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        selectedYear: ALL_ACTIVE_FILES_YEAR,
        focusSection: "Top",
        focusTarget: "demandDescription",
        drillPath: getReportSearchDrillPath(),
      },
    });
  };
  const serializeCashOutGoPlanFocusTargets = (rows: CashOutGoPlanDetailRow[]) => {
    return Array.from(
      rows.reduce((targets, row) => {
        if (row.fileId && row.sourceFocusTarget && !targets.has(row.fileId)) {
          targets.set(row.fileId, row.sourceFocusTarget);
        }
        return targets;
      }, new Map<string, string>()),
    )
      .map(([fileId, target]) => `${encodeURIComponent(fileId)}=${encodeURIComponent(target)}`)
      .join(",");
  };
  const getFallbackCashOutGoPlanFocusTarget = (row: CashOutGoPlanDetailRow | undefined) => {
    if (!row) return undefined;
    if (row.section === "advance") return "advancepayment:pending";
    if (row.section === "dp" || row.section === "dpExpired") return "deliveryperiod:any";
    if (row.section === "delivered") return "billpreparation:pending";
    if (row.section === "hand") return "billpreparation:completed";
    return "billsentforpayment:completed";
  };
  const addDemandProcessingFilter = () => {
    setDemandAnalysisFilters((current) => [
      ...current,
      createDemandProcessingFilterRow(demandProcessingFilterFields),
    ]);
  };
  const updateDemandProcessingFilter = (
    id: string,
    patch: Partial<Omit<DemandProcessingFilterRow, "id">>,
  ) => {
    setDemandAnalysisFilters((current) =>
      current.map((filter) => {
        if (filter.id !== id) return filter;
        const next = { ...filter, ...patch };
        if (patch.fieldId) {
          const definition = getDemandProcessingFilterField(
            patch.fieldId,
            demandProcessingFilterFields,
          );
          next.condition = getDefaultDemandProcessingCondition(definition);
          next.value = "";
          next.valueTo = "";
        }
        return next;
      }),
    );
  };
  const removeDemandProcessingFilter = (id: string) => {
    setDemandAnalysisFilters((current) => current.filter((filter) => filter.id !== id));
  };
  const resetDemandProcessingFilters = () => setDemandAnalysisFilters([]);
  const openDemandProcessingSearch = (mode: "used" | "reverse") => {
    const rows =
      mode === "reverse"
        ? demandAnalysisRows.filter((row) => row.gapDays < 0)
        : demandAnalysisRows.filter((row) => row.gapDays >= 0);
    const fileIds = Array.from(new Set(rows.map((row) => row.fileId))).filter(Boolean);
    if (!fileIds.length) return;
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `fileIds:${fileIds.map(encodeURIComponent).join(",")}`,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        selectedYear: settings.selectedYear,
        drillPath: getReportSearchDrillPath([
          mode === "reverse" ? "Negative results" : "Non-negative used rows",
        ]),
      },
    });
  };
  const openDemandProcessingRangeSearch = (row: DemandProcessingRangeRow) => {
    if (!row.fileIds.length) return;
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `fileIds:${row.fileIds.map(encodeURIComponent).join(",")}`,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        selectedYear: settings.selectedYear,
        drillPath: getReportSearchDrillPath([row.label]),
      },
    });
  };
  const openFirmDatabaseFiles = (fileIds: string[]) => {
    const uniqueFileIds = Array.from(new Set(fileIds.filter(Boolean)));
    if (!uniqueFileIds.length) return;
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `fileIds:${uniqueFileIds.map(encodeURIComponent).join(",")}`,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        selectedYear: settings.selectedYear,
        focusSection: "Supply order and payment",
        focusTarget: "payment:liability",
        drillPath: getReportSearchDrillPath(),
      },
    });
  };
  const openMmgSummaryFiles = (row: MmgSummaryRow) => {
    const fileIds = row.fileIds ?? [];
    const uniqueFileIds = Array.from(new Set(fileIds.filter(Boolean)));
    if (!uniqueFileIds.length && !row.dashboardFilter) return;
    const sourceFocus = getMmgSummarySourceFocus(row.key);
    navigate({
      to: "/search",
      search: {
        dashboardFilter:
          row.dashboardFilter ?? `fileIds:${uniqueFileIds.map(encodeURIComponent).join(",")}`,
        division: activeDivision === "all" ? undefined : activeDivision,
        selectedYear: settings.selectedYear,
        fileCategories: activeFileCategoriesParam,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        ...sourceFocus,
        focusTargets: serializeMmgSummaryFocusTargets(row.focusTargets),
        drillPath: getReportSearchDrillPath([row.label]),
      },
    });
  };
  const serializeMmgSummaryFocusTargets = (focusTargets: MmgSummaryRow["focusTargets"]) => {
    if (!focusTargets) return undefined;
    const encoded = Object.entries(focusTargets)
      .filter(([fileId, targets]) => fileId && targets.length > 0)
      .map(
        ([fileId, targets]) =>
          `${encodeURIComponent(fileId)}=${encodeURIComponent(targets.join("|"))}`,
      )
      .join(",");
    return encoded || undefined;
  };
  const openAgeingSearch = (row: Record<string, number | string>) => {
    const fileIds = String(row.fileIds ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const uniqueFileIds = Array.from(new Set(fileIds));
    if (!uniqueFileIds.length) return;
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `fileIds:${uniqueFileIds.map(encodeURIComponent).join(",")}`,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: activeFileCategoriesParam,
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...fileInitiationDateQueryParams,
        selectedYear: settings.selectedYear,
        focusSection: "Supply order and payment",
        focusTarget: "payment:liability",
        focusTargets: String(row.focusTargets ?? "") || undefined,
        drillPath: getReportSearchDrillPath([String(row.label ?? "")]),
      },
    });
  };
  const toggleFileCategory = (category: FileCategoryKey, checked: boolean) => {
    if (fileCategoryLocked) return;
    setFileCategoryFilterTouched(true);
    setSelectedFileCategories((current) =>
      checked
        ? visibleFileCategoryKeys.filter((key) => new Set([...current, category]).has(key))
        : current.filter((key) => key !== category),
    );
  };
  const toggleFileCategoryLock = async () => {
    if (!activeUser?.id || fileCategoryPreferenceSaving || fileCategoryPreferenceLoading) return;
    const nextLocked = !fileCategoryLocked;
    setFileCategoryPreferenceSaving(true);
    setFileCategoryPreferenceError("");
    try {
      const preferences = {
        locked: nextLocked,
        categories: selectedFileCategories,
      };
      if (activeUser.id.startsWith("viewer:")) {
        window.localStorage.setItem(
          `recordkeeper:reports-file-type:${activeUser.id}`,
          JSON.stringify(preferences),
        );
      } else {
        await saveReportPreferences("fileTypeFilter", preferences);
      }
      setFileCategoryLocked(nextLocked);
      if (nextLocked) setFileCategoryFilterTouched(true);
    } catch (error) {
      setFileCategoryPreferenceError(
        error instanceof Error ? error.message : "File Type preference could not be saved.",
      );
    } finally {
      setFileCategoryPreferenceSaving(false);
    }
  };
  const selectReportMode = (mode: ReportMode) => {
    if (mode === "preSoExpectedCashOutgo") {
      if (settings.selectedYear !== ALL_ACTIVE_FILES_YEAR) {
        store.updateSessionSelectedYear(ALL_ACTIVE_FILES_YEAR);
      }
      setFileYearLocked(true);
      setSelectedFileYear("all");
      setFileInitiationFromDate("");
      setFileInitiationToDate("");
    }
    setReportMode(mode);
    navigate({
      to: "/reports",
      search: { mode },
      replace: true,
    });
  };

  return (
    <div className="space-y-6">
      <div
        className={
          "grid grid-cols-1 gap-4 " +
          (reportsSidePanelHooked
            ? "lg:grid-cols-[260px_minmax(0,1fr)]"
            : "lg:grid-cols-[48px_minmax(0,1fr)]")
        }
      >
        {reportsSidePanelHooked ? (
        <aside className="rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Reports
            </div>
            <button
              type="button"
              onClick={() => setReportsSidePanelHooked(false)}
              className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Unhook side panel"
            >
              Unhook
            </button>
          </div>
          <div className="space-y-2">
            <CollapsibleReportGroup
              title="Supply order & delivery"
              modes={supplyOrderDeliveryReportModes}
              activeMode={reportMode}
              expanded={expandedReportGroups.supplyOrderDelivery}
              onToggle={() => toggleReportGroup("supplyOrderDelivery")}
              onSelect={selectReportMode}
            />
            <CollapsibleReportGroup
              title="Cash Outgo"
              modes={cashOutgoReportModes}
              sections={cashOutgoReportGroups}
              footer={
                <div className="space-y-1.5 border-t border-border p-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    Export all {combinedCashOutgoExportModes.length} reports
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={exportAllCashOutgoPdf}
                      className="inline-flex min-w-0 items-center justify-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-semibold text-foreground transition hover:bg-accent"
                    >
                      <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                      <span>PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={exportAllCashOutgoExcel}
                      className="inline-flex min-w-0 items-center justify-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-semibold text-foreground transition hover:bg-accent"
                    >
                      <FileSpreadsheet className="size-3.5 shrink-0" aria-hidden="true" />
                      <span>Excel</span>
                    </button>
                  </div>
                </div>
              }
              hideSectionTitles
              activeMode={reportMode}
              expanded={expandedReportGroups.cashOutgo}
              onToggle={() => toggleReportGroup("cashOutgo")}
              onSelect={selectReportMode}
            />
            <CollapsibleReportGroup
              title="Monitoring / Exceptions"
              modes={monitoringReportModes}
              activeMode={reportMode}
              expanded={expandedReportGroups.monitoring}
              onToggle={() => toggleReportGroup("monitoring")}
              onSelect={selectReportMode}
            />
            <div className="space-y-1 rounded-md border border-border bg-background/60 p-1.5">
              <ReportModeButton
                mode={mmgReportMode}
                selected={reportMode === mmgReportMode.key}
                onSelect={selectReportMode}
              />
              <ReportModeButton
                mode={demandProcessingReportMode}
                selected={reportMode === demandProcessingReportMode.key}
                onSelect={selectReportMode}
              />
              <ReportModeButton
                mode={firmDatabaseReportMode}
                selected={reportMode === firmDatabaseReportMode.key}
                onSelect={selectReportMode}
              />
            </div>
          </div>
        </aside>
        ) : (
          <aside className="rounded-xl border border-border bg-card p-2 shadow-[var(--shadow-card)]">
            <button
              type="button"
              onClick={() => setReportsSidePanelHooked(true)}
              className="flex h-full min-h-40 w-full items-center justify-center rounded-md border border-dashed border-border bg-background px-1 py-3 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Hook side panel"
              aria-label="Hook side panel"
            >
              <span className="[writing-mode:vertical-rl] rotate-180">Hook panel</span>
            </button>
          </aside>
        )}
        <div className="min-w-0 space-y-4">
          <div className="rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap items-end gap-3">
              {reportMode !== "merData" ? (
                <DivisionFilter
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                />
              ) : null}
              <FileYearFilter
                value={activeFileYear}
                options={availableFileYearOptions}
                locked={fileYearLocked}
                disabled={fileYearFilterDisabled}
                active={fileYearFilterActive}
                allOptionLabel={fileYearAllOptionLabel}
                onChange={updateFileYearSelection}
                onLockToggle={toggleFileYearLock}
              />
              <FileInitiationDateRangeFilter
                fromDate={fileInitiationFromDate}
                toDate={fileInitiationToDate}
                disabled={fileYearFilterDisabled}
                active={fileInitiationDateFilterActive}
                onFromDateChange={(fromDate) => updateFileInitiationDateRange({ fromDate })}
                onToDateChange={(toDate) => updateFileInitiationDateRange({ toDate })}
                onClear={clearFileInitiationDateRange}
              />
              <FileCategoryFilter
                selectedCategories={selectedFileCategories}
                options={visibleFileCategoryOptions}
                disabled={fileCategoryFilterDisabled || fileCategoryLocked || fileCategoryPreferenceLoading}
                active={fileCategoryFilterActive}
                onChange={toggleFileCategory}
                locked={fileCategoryLocked}
                lockDisabled={
                  fileCategoryFilterDisabled ||
                  fileCategoryPreferenceLoading ||
                  fileCategoryPreferenceSaving
                }
                browserOnly={activeUser?.id?.startsWith("viewer:") === true}
                onLockToggle={() => {
                  void toggleFileCategoryLock();
                }}
              />
              {isPreSoExpectedCashOutgoReport ? (
                <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                  Report is fixed for: Global Filter = All active files; Subfilter = All file
                  years; Date range is blocked.
                </div>
              ) : null}
            </div>
            {fileCategoryPreferenceError ? (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {fileCategoryPreferenceError}
              </p>
            ) : null}
            {reportMode === "cashOutGoPlan" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                File Type filters the file-based plan rows. Allocation and MER remain division-wide.
              </p>
            ) : null}
          </div>
          {matrixFieldsPreferenceError ? (
            <p className="text-xs text-destructive" role="alert">
              {matrixFieldsPreferenceError}
            </p>
          ) : null}
          {reportsError ||
          (reportsLoading && !hasLoadedReports) ||
          mmgError ||
          firmDatabaseError ? (
            <div
              className={
                "rounded-md border px-3 py-2 text-xs " +
                (reportsError || mmgError || firmDatabaseError
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border bg-secondary/30 text-muted-foreground")
              }
            >
              {reportsError || mmgError || firmDatabaseError
                ? `Reports API unavailable: ${reportsError || mmgError || firmDatabaseError}`
                : "Updating reports..."}
            </div>
          ) : null}

          {reportMode === "mmgSummary" ? (
            <MmgSummaryReport
              rows={mmgSummaryRows}
              title={selectedReportTitle}
              loading={mmgLoading}
              onOpenFiles={openMmgSummaryFiles}
              actions={
                <>
                  {reportScopeDateRangeControls ? (
                    <HistoricalDateRangeControls {...reportScopeDateRangeControls} />
                  ) : null}
                  <ReportHeaderActions
                    divisions={divisions}
                    activeDivision={activeDivision}
                    onDivisionChange={setSelectedDivision}
                    onPdf={exportMmgSummaryPdf}
                    onExcel={exportMmgSummaryExcel}
                  />
                </>
              }
            />
          ) : reportMode === "demandProcessingAnalysis" ? (
            <DemandProcessingAnalysisReport
              title={selectedReportTitle}
              presets={demandProcessingPresets}
              selectedPresetId={demandAnalysisPresetId}
              fromFieldId={demandAnalysisFromFieldId}
              toFieldId={demandAnalysisToFieldId}
              paymentMode={demandAnalysisPaymentMode}
              rows={demandAnalysisRows}
              stats={demandAnalysisStats}
              rangeRows={demandProcessingRangeRows}
              analysisUnit={demandAnalysisUnit}
              exportDescription={getReportExportDescription(
                reportExportContextDescription,
                `Analysis basis: ${getDemandProcessingField(demandAnalysisFromFieldId)?.label ?? "From date"} to ${getDemandProcessingField(demandAnalysisToFieldId)?.label ?? "To date"}${demandAnalysisPaymentMode ? `, payment mode: ${demandAnalysisPaymentMode}` : ""}.`,
                "Monetary values are in Lakh.",
              )}
              filters={demandAnalysisFilters}
              filterFields={demandProcessingFilterFields}
              onPresetChange={setDemandAnalysisPresetId}
              onFromFieldChange={(fieldId) => {
                setDemandAnalysisPresetId("");
                setDemandAnalysisFromFieldId(fieldId);
              }}
              onToFieldChange={(fieldId) => {
                setDemandAnalysisPresetId("");
                setDemandAnalysisToFieldId(fieldId);
              }}
              onResetDateFields={() => {
                setDemandAnalysisPresetId("");
                setDemandAnalysisFromFieldId("");
                setDemandAnalysisToFieldId("");
              }}
              onPaymentModeChange={setDemandAnalysisPaymentMode}
              onAddFilter={addDemandProcessingFilter}
              onUpdateFilter={updateDemandProcessingFilter}
              onRemoveFilter={removeDemandProcessingFilter}
              onResetFilters={resetDemandProcessingFilters}
              onOpenUsed={() => openDemandProcessingSearch("used")}
              onOpenReverse={() => openDemandProcessingSearch("reverse")}
              onOpenRange={openDemandProcessingRangeSearch}
              actions={
                <>
                  {reportScopeDateRangeControls ? (
                    <HistoricalDateRangeControls {...reportScopeDateRangeControls} />
                  ) : null}
                  <ReportHeaderActions
                    divisions={divisions}
                    activeDivision={activeDivision}
                    onDivisionChange={setSelectedDivision}
                  />
                </>
              }
            />
          ) : reportMode === "firmDatabase" ? (
            <FirmDatabaseReport
              title={selectedReportTitle}
      rows={firmDatabaseRows}
      loading={mmgLoading || firmDatabaseLoading}
      sortKey={firmReportSortKey}
      sortDirection={firmReportSortDirection}
      locked={firmReportLayoutLocked}
      saving={firmReportLayoutSaving}
      layoutError={firmReportLayoutError}
      visibleColumns={visibleFirmReportColumns}
      onSortKeyChange={setFirmReportSortKey}
      onSortDirectionChange={setFirmReportSortDirection}
      onVisibleColumnsChange={setVisibleFirmReportColumns}
      onRestoreDefaultColumns={restoreFirmDatabaseDefaultColumns}
      onLockToggle={() => void saveFirmDatabaseLayout(!firmReportLayoutLocked)}
      onOpenFiles={openFirmDatabaseFiles}
              actions={
                <>
                  {reportScopeDateRangeControls ? (
                    <HistoricalDateRangeControls {...reportScopeDateRangeControls} />
                  ) : null}
                  <ReportHeaderActions
                    divisions={divisions}
                    activeDivision={activeDivision}
                    onDivisionChange={setSelectedDivision}
                    onPdf={exportFirmDatabasePdf}
                    onExcel={exportFirmDatabaseExcel}
                  />
                </>
              }
            />
          ) : selectedMonthlyReport ? (
            <MonthlyOperationalReport
              title={selectedReportTitle}
              description={selectedMonthlyReport.description}
              columns={selectedMonthlyReportColumns ?? selectedMonthlyReport.columns}
              rows={selectedMonthlyReportRows ?? selectedMonthlyReport.rows}
              viewMode={selectedMonthlyReport.supportsYearDrilldown ? "inline" : "month"}
              onOpenSearch={openMonthlyReportSearch}
              onYearSelect={
                selectedMonthlyReport.supportsYearDrilldown
                  ? (year) =>
                      setExpandedMonthlyReportYears((current) =>
                        current.includes(year)
                          ? current.filter((item) => item !== year)
                          : [...current, year].sort(),
                      )
                  : undefined
              }
              controls={
                reportMode === "bgReceiptDelay" ? (
                  <BgReceiptDelayControls
                    days={bgReceiptDelayDays}
                    unlocked={bgReceiptDelayUnlocked}
                    onUnlockedChange={toggleBgReceiptDelayLock}
                    onDaysChange={setBgReceiptDelayDays}
                  />
                ) : reportMode === "warrantyBgMismatch" ? (
                  <WarrantyBgBufferControls
                    days={warrantyBgBufferDays}
                    unlocked={warrantyBgBufferUnlocked}
                    onUnlockedChange={toggleWarrantyBgBufferLock}
                    onDaysChange={setWarrantyBgBufferDays}
                    onReset={resetWarrantyBgBufferDays}
                  />
                ) : undefined
              }
              onPdf={(plot) => {
                void exportMonthlyOperationalReport(
                  selectedReportTitle,
                  getReportExportDescription(
                    reportExportContextDescription,
                    selectedMonthlyReport.description,
                    reportMode === "bgReceiptDelay"
                      ? `Analysis basis: BG receipt delay thresholds are ${normalizeBgReceiptDelayDays(bgReceiptDelayDays).join(", ")} days.`
                      : reportMode === "warrantyBgMismatch"
                        ? `Analysis basis: Warranty/BG comparison buffer is ${normalizedWarrantyBgBufferDays} days.`
                        : undefined,
                  ),
                  selectedMonthlyReportExportColumns,
                  selectedMonthlyReportExportRows,
                  "pdf",
                  plot,
                );
              }}
              onExcel={(plot) => {
                void exportMonthlyOperationalReport(
                  selectedReportTitle,
                  getReportExportDescription(
                    reportExportContextDescription,
                    selectedMonthlyReport.description,
                    reportMode === "bgReceiptDelay"
                      ? `Analysis basis: BG receipt delay thresholds are ${normalizeBgReceiptDelayDays(bgReceiptDelayDays).join(", ")} days.`
                      : reportMode === "warrantyBgMismatch"
                        ? `Analysis basis: Warranty/BG comparison buffer is ${normalizedWarrantyBgBufferDays} days.`
                        : undefined,
                  ),
                  selectedMonthlyReportExportColumns,
                  selectedMonthlyReportExportRows,
                  "excel",
                  plot,
                );
              }}
            />
          ) : reportMode === "delayStatus" ? (
            <DelayStatusReport
              rows={delayStatusRows}
              title={selectedReportTitle}
              summary={delayStatusSummary}
              thresholdDays={delayStatusThresholdDays}
              selectedDays={delayStatusDays}
              selectedMilestoneKey={delayStatusMilestoneKey}
              onDaysChange={setDelayStatusDays}
              onMilestoneChange={setDelayStatusMilestoneKey}
              onDaysReset={() => setDelayStatusDays("5")}
              onPdf={exportDelayStatusPdf}
              onExcel={exportDelayStatusExcel}
              onOpenFile={openDelayStatusFile}
              onOpenSearch={() => openDelayStatusSearch()}
              onOpenMilestone={(milestoneKey) => {
                setDelayStatusMilestoneKey(milestoneKey);
                openDelayStatusSearch(milestoneKey);
              }}
              onOpenBiddingBreakup={openBiddingDelayBreakupSearch}
            />
          ) : reportMode === "pendingLiabilityAgeing" ? (
            <MonthlyOperationalReport
              title={selectedReportTitle}
              description={pendingLiabilityDescription}
              columns={ageingReportColumns}
              rows={pendingLiabilityAgeingRows}
              unitNote="All the values are in Lakh."
              valueFormatter={(key, value) =>
                ["capital", "revenue", "total"].includes(key)
                  ? formatLakhValue(Number(value) || 0)
                  : String(value)
              }
              controls={
                <AsOnDateControl
                  date={historicalReportToDate}
                  active={historicalReportToDate !== today}
                  onDateChange={setHistoricalReportToDate}
                />
              }
              onOpenSearch={(filter) => {
                const row = pendingLiabilityAgeingRows.find(
                  (item) => item.dashboardFilter === filter,
                );
                if (row) openAgeingSearch(row);
              }}
              onPdf={(plot) =>
                exportMonthlyOperationalReport(
                  selectedReportTitle,
                  getReportExportDescription(
                    reportExportContextDescription,
                    pendingLiabilityDescription,
                    "All the values are in Lakh.",
                  ),
                  ageingReportColumns,
                  formatPendingLiabilityRowsForExport(pendingLiabilityAgeingRows),
                  "pdf",
                  plot,
                )
              }
              onExcel={(plot) =>
                exportMonthlyOperationalReport(
                  selectedReportTitle,
                  getReportExportDescription(
                    reportExportContextDescription,
                    pendingLiabilityDescription,
                    "All the values are in Lakh.",
                  ),
                  ageingReportColumns,
                  formatPendingLiabilityRowsForExport(pendingLiabilityAgeingRows),
                  "excel",
                  plot,
                )
              }
            />
          ) : reportMode === "merComparison" ? (
            <MerSoftwareComparisonReport
              rows={merSoftwareComparisonRows}
              totals={merSoftwareComparisonTotals}
              title={reportTitleWithDivision}
              showDifference={merComparisonIsOrganizationWide}
              loading={reportsLoading || merLoading}
              error={reportsError || merError}
              actions={!reportsLoading && !merLoading && !reportsError && !merError ? (
                <ReportHeaderActions
                  onPdf={(plot) => exportMerSoftwareComparison("pdf", plot)}
                  onExcel={(plot) => exportMerSoftwareComparison("excel", plot)}
                />
              ) : null}
            />
          ) : reportMode === "merData" ? (
            <MerDataReport
              rows={merDraftRows}
              title={reportTitle}
              financialYear={effectiveFinancialYear}
              loading={merLoading}
              saving={merSaving}
              editing={merEditing}
              canEdit={canEditMerData}
              dirty={merDataDirty}
              error={merError}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  showDivision={false}
                  onPdf={exportCashOutgoPdf}
                  onExcel={exportCashOutgoExcel}
                />
              }
              onEdit={() => canEditMerData && setMerEditing(true)}
              onCancel={resetMerDraftRows}
              onSave={saveMerRows}
              onAmountChange={updateMerDraftAmount}
            />
          ) : reportMode === "unifiedFinanceReview" ? (
            <UnifiedFinanceReviewReport
              title={reportTitleWithDivision}
              summary={mmgDashboardSummary}
              plan={cashOutGoPlan}
              loading={cashOutGoPlanLoading || reportsLoading}
              error={cashOutGoPlanError || reportsError}
              contextDescription={reportExportContextDescription}
            />
          ) : reportMode === "cashOutGoPlan" ? (
            <CashOutGoPlanReport
              plan={cashOutGoPlan}
              loading={cashOutGoPlanLoading}
              saving={cashOutGoPlanSaving}
              dirty={cashOutGoPlanDirty}
              error={cashOutGoPlanError}
              includePreviousFy={cashOutGoPlanIncludePreviousFy}
              canEdit={canEditCashOutGoPlan}
              canEditSettings={canEditCashOutGoPlanSettings}
              onIncludePreviousFyChange={setCashOutGoPlanIncludePreviousFy}
              onSettingChange={updateCashOutGoPlanSettings}
              onOffsetReset={resetCashOutGoPlanOffset}
              onRowChange={updateCashOutGoPlanRow}
              onExpectedSentDateReset={resetCashOutGoPlanExpectedSentDate}
              onOpenSourceFile={openCashOutGoPlanSource}
              onOpenRowsSearch={openCashOutGoPlanRowsSearch}
              onSave={persistCashOutGoPlan}
              saveDisabled={!cashOutGoPlanDirty}
              onPdf={(expandedSections) =>
                cashOutGoPlan &&
                exportCashOutGoPlan(
                  cashOutGoPlan,
                  "pdf",
                  cashOutGoPlanExportDescription,
                  expandedSections,
                )
              }
              onExcel={(expandedSections) =>
                cashOutGoPlan &&
                exportCashOutGoPlan(
                  cashOutGoPlan,
                  "excel",
                  cashOutGoPlanExportDescription,
                  expandedSections,
                )
              }
            />
          ) : reportMode === "preSoExpectedCashOutgo" ? (
            <PreSoExpectedCashOutgoReport
              activeTab={preSoActiveTab}
              onTabChange={setPreSoActiveTab}
              stageOptions={preSoStageOptions}
              selectedStageKeys={preSoSelectedStageKeys}
              onSelectedStageKeysChange={setPreSoSelectedStageKeys}
              stageOffsets={preSoStageOffsets}
              onStageOffsetChange={updatePreSoStageOffset}
              rows={preSoRows}
              selectedRows={preSoSelectedRows}
              totals={preSoTotals}
              monthwiseRows={preSoMonthwiseRows}
              monthwiseGrouping={preSoMonthwiseGrouping}
              onMonthwiseGroupingChange={setPreSoMonthwiseGrouping}
              exportContextDescription={reportExportContextDescription}
              defaultOffset={preSoDefaultStageOffset}
              loading={preSoPlanLoading}
              saving={preSoPlanSaving}
              dirty={preSoPlanDirty}
              canSave={preSoPlanCanSave}
              canSaveStageOffsets={preSoPlanCanSaveStageOffsets}
              error={preSoPlanError}
              onSave={savePreSoPlan}
              currentYearContext={preSoCurrentYearContext}
              onFileDraftChange={updatePreSoFileDraft}
              onOpenFile={openPreSoFileInSearch}
            />
          ) : reportMode === "soPaymentMatrix" ? (
            <SoPaymentMatrixReport
              title={selectedReportTitle}
              titleHelper={reportModeHelperText.soPaymentMatrix}
              description="Shows expected unpaid regular, stage, advance, and supplementary payments month-wise for the current filtered file set."
              monthAmountHelper={[
                "Shows expected pending payment amount falling in this month.",
                "Regular, stage, advance, and each submitted/resubmitted supplementary bill are counted as separate payment items.",
                "Supplementary bills are forecast from their latest active submission date plus the payment offset.",
                "Click a non-zero amount to open the contributing file in Search.",
              ]}
              rows={soPaymentMatrixRows}
              selectedFields={soPaymentMatrixFields}
              fieldsLocked={soPaymentMatrixLocked}
              preferenceLoading={matrixFieldsPreferenceLoading}
              preferenceSaving={matrixFieldsPreferenceSaving}
              fieldOptions={soPaymentMatrixFieldOptions}
              columns={soPaymentMatrixColumns}
              monthKeys={soPaymentMatrixMonthKeys}
              onFieldChange={(fieldKey, checked) =>
                updateMatrixFields(setSoPaymentMatrixFields, fieldKey, checked)
              }
              onResetFields={() => setSoPaymentMatrixFields([...soPaymentMatrixDefaultFields])}
              onLockToggle={() =>
                void saveMatrixFieldsLock(
                  "paymentDueMatrix",
                  !soPaymentMatrixLocked,
                  soPaymentMatrixFields,
                )
              }
              onOpenRows={openSoPaymentMatrixSearch}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={(plot) => exportSoPaymentMatrix("pdf", plot)}
                  onExcel={(plot) => exportSoPaymentMatrix("excel", plot)}
                />
              }
            />
          ) : reportMode === "paymentCompletedMatrix" ? (
            <SoPaymentMatrixReport
              title={selectedReportTitle}
              titleHelper={reportModeHelperText.paymentCompletedMatrix}
              description="Shows completed regular, stage, advance, and supplementary payments month-wise for the current filtered file set."
              monthAmountHelper={[
                "Shows actual completed payment amount falling in this month.",
                "Regular, stage, advance, and each supplementary bill are counted as separate payment items.",
                "For supplementary bills, actual paid amount is used; if blank, the bill amount is used.",
                "Click a non-zero amount to open the contributing file in Search.",
              ]}
              rows={paymentCompletedMatrixRows}
              selectedFields={paymentCompletedMatrixFields}
              fieldsLocked={paymentCompletedMatrixLocked}
              preferenceLoading={matrixFieldsPreferenceLoading}
              preferenceSaving={matrixFieldsPreferenceSaving}
              fieldOptions={soPaymentMatrixFieldOptions}
              columns={paymentCompletedMatrixColumns}
              monthKeys={soPaymentMatrixMonthKeys}
              onFieldChange={(fieldKey, checked) =>
                updateMatrixFields(setPaymentCompletedMatrixFields, fieldKey, checked)
              }
              onResetFields={() =>
                setPaymentCompletedMatrixFields([...soPaymentMatrixDefaultFields])
              }
              onLockToggle={() =>
                void saveMatrixFieldsLock(
                  "paymentCompletedMatrix",
                  !paymentCompletedMatrixLocked,
                  paymentCompletedMatrixFields,
                )
              }
              onOpenRows={openSoPaymentMatrixSearch}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={(plot) => exportPaymentCompletedMatrix("pdf", plot)}
                  onExcel={(plot) => exportPaymentCompletedMatrix("excel", plot)}
                />
              }
            />
          ) : reportMode === "itemsDeliveredBillsPending" ? (
            <ExpectedCashOutgoReport
              rows={expectedCashOutgoReceiptPendingBillRows}
              title={reportTitle}
              description={billingPaymentReportDescription || reportLogic}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={exportCashOutgoPdf}
                  onExcel={exportCashOutgoExcel}
                />
              }
              selectedDays={expectedCashOutgoDaysDraft}
              selectedDaysUnlocked={expectedCashOutgoDaysUnlocked}
              sharedDays={sharedExpectedCashOutgoDays}
              savingDays={expectedCashOutgoDaysSaving}
              daysError={expectedCashOutgoDaysError}
              daysSaved={expectedCashOutgoDaysSaved}
              hasPersonalOverride={hasExpectedCashOutgoDaysOverride}
              onDaysChange={setExpectedCashOutgoDaysDraft}
              onSelectedDaysUnlockedChange={toggleExpectedCashOutgoDaysLock}
              onSelectedDaysSave={saveExpectedCashOutgoDays}
              onSelectedDaysReset={resetExpectedCashOutgoDays}
              dateRange={historicalDateRangeControls}
              onOpenMonth={(monthKey) =>
                openCashOutgoSearch("expectedReceiptPendingBill", monthKey)
              }
              onOpenAll={() =>
                openCashOutgoSearchWithContext(
                  "expectedReceiptPendingBill",
                  getCashOutgoTotalMonthKey(expectedCashOutgoReceiptPendingBillRows),
                  getCashOutgoTotalDateContext(expectedCashOutgoReceiptPendingBillRows),
                )
              }
            />
          ) : reportMode === "currentMonthLiability" ? (
            <CurrentMonthLiabilityReport
              rows={currentLiabilityRows}
              title={reportTitle}
              titleHelper={supplementaryBillInclusionNotes.currentMonthLiability}
              description={reportLogic}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={exportCashOutgoPdf}
                  onExcel={exportCashOutgoExcel}
                />
              }
              selectedDays={expectedCashOutgoDaysDraft}
              selectedDaysUnlocked={expectedCashOutgoDaysUnlocked}
              sharedDays={sharedExpectedCashOutgoDays}
              savingDays={expectedCashOutgoDaysSaving}
              daysError={expectedCashOutgoDaysError}
              daysSaved={expectedCashOutgoDaysSaved}
              hasPersonalOverride={hasExpectedCashOutgoDaysOverride}
              onDaysChange={setExpectedCashOutgoDaysDraft}
              onSelectedDaysUnlockedChange={toggleExpectedCashOutgoDaysLock}
              onSelectedDaysSave={saveExpectedCashOutgoDays}
              onSelectedDaysReset={resetExpectedCashOutgoDays}
              monthSelection={monthSelectionControls}
              onOpenMonth={(monthKey) =>
                openCashOutgoAnySearch(
                  ["expectedReceiptPendingBillThrough", "billPreparationThrough", "billSentThrough"],
                  monthKey,
                )
              }
              onOpenAll={() =>
                openCashOutgoAnySearchWithContext(
                  ["expectedReceiptPendingBillThrough", "billPreparationThrough", "billSentThrough"],
                  getCashOutgoTotalMonthKey(currentLiabilityRows),
                  getCashOutgoTotalDateContext(currentLiabilityRows),
                )
              }
            />
          ) : reportMode === "itemsDeliveredBillsPrepared" ? (
            <ExpectedCashOutgoReport
              rows={expectedCashOutgoBillPreparationRows}
              title={reportTitle}
              titleHelper={supplementaryBillInclusionNotes.itemsDeliveredBillsPrepared}
              description={billingPaymentReportDescription || reportLogic}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={exportCashOutgoPdf}
                  onExcel={exportCashOutgoExcel}
                />
              }
              dateRange={historicalDateRangeControls}
              onOpenMonth={(monthKey) => openCashOutgoSearch("billPreparation", monthKey)}
              onOpenAll={() =>
                openCashOutgoSearchWithContext(
                  "billPreparation",
                  getCashOutgoTotalMonthKey(expectedCashOutgoBillPreparationRows),
                  getCashOutgoTotalDateContext(expectedCashOutgoBillPreparationRows),
                )
              }
            />
          ) : reportMode === "billsSubmitted" ? (
            <ExpectedCashOutgoReport
              rows={billSentForPaymentRows}
              title={reportTitle}
              titleHelper={supplementaryBillInclusionNotes.billsSubmitted}
              description={billingPaymentReportDescription || reportLogic}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={exportCashOutgoPdf}
                  onExcel={exportCashOutgoExcel}
                />
              }
              dateRange={historicalDateRangeControls}
              onOpenMonth={(monthKey) => openCashOutgoSearch("billSent", monthKey)}
              onOpenAll={() =>
                openCashOutgoSearchWithContext(
                  "billSent",
                  getCashOutgoTotalMonthKey(billSentForPaymentRows),
                  getCashOutgoTotalDateContext(billSentForPaymentRows),
                )
              }
            />
          ) : reportMode === "expectedCashOutgoFy" ? (
            <ExpectedCashOutgoReport
              rows={expectedCashOutgoFyRows}
              title={reportTitle}
              description={reportLogic}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={exportCashOutgoPdf}
                  onExcel={exportCashOutgoExcel}
                />
              }
              selectedDays={expectedCashOutgoDaysDraft}
              selectedDaysUnlocked={expectedCashOutgoDaysUnlocked}
              sharedDays={sharedExpectedCashOutgoDays}
              savingDays={expectedCashOutgoDaysSaving}
              daysError={expectedCashOutgoDaysError}
              daysSaved={expectedCashOutgoDaysSaved}
              hasPersonalOverride={hasExpectedCashOutgoDaysOverride}
              onDaysChange={setExpectedCashOutgoDaysDraft}
              onSelectedDaysUnlockedChange={toggleExpectedCashOutgoDaysLock}
              onSelectedDaysSave={saveExpectedCashOutgoDays}
              onSelectedDaysReset={resetExpectedCashOutgoDays}
              onOpenMonth={(monthKey) => openCashOutgoSearch("expectedDp", monthKey)}
              onOpenAll={() =>
                openCashOutgoSearchWithContext(
                  "expectedDp",
                  getCashOutgoTotalMonthKey(expectedCashOutgoFyRows),
                  getCashOutgoTotalDateContext(expectedCashOutgoFyRows),
                )
              }
            />
          ) : reportMode === "spentTillDateFy" ? (
            <ExpectedCashOutgoReport
              rows={spentTillDateFyRows}
              title={reportTitle}
              titleHelper={supplementaryBillInclusionNotes.spentTillDateFy}
              description={reportLogic}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={exportCashOutgoPdf}
                  onExcel={exportCashOutgoExcel}
                />
              }
              dateRange={historicalDateRangeControls}
              onOpenMonth={(monthKey) => openCashOutgoSearch("actual", monthKey)}
              onOpenAll={() =>
                openCashOutgoSearchWithContext(
                  "actual",
                  getCashOutgoTotalMonthKey(spentTillDateFyRows),
                  getCashOutgoTotalDateContext(spentTillDateFyRows),
                )
              }
            />
          ) : reportMode === "billsPaidInMonth" ? (
            <ExpectedCashOutgoReport
              rows={billsPaidInMonthRows}
              title={reportTitle}
              titleHelper={supplementaryBillInclusionNotes.billsPaidInMonth}
              description={reportLogic}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={exportCashOutgoPdf}
                  onExcel={exportCashOutgoExcel}
                />
              }
              monthSelection={monthSelectionControls}
              emptyMessage={cashOutgoEmptyMessage}
              onOpenMonth={(monthKey) => openCashOutgoSearch("actual", monthKey)}
              onOpenAll={() =>
                openCashOutgoSearchWithContext(
                  "actual",
                  getCashOutgoTotalMonthKey(billsPaidInMonthRows),
                  getCashOutgoTotalDateContext(billsPaidInMonthRows),
                )
              }
            />
          ) : isReturnedBillReportMode(reportMode) ? (
            <ExpectedCashOutgoReport
              rows={selectedCashOutgoRows}
              title={reportTitle}
              titleHelper={getCashOutgoTitleHelper(reportMode)}
              description={reportLogic}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={exportCashOutgoPdf}
                  onExcel={exportCashOutgoExcel}
                />
              }
              dateRange={historicalDateRangeControls}
              emptyMessage={cashOutgoEmptyMessage}
              onOpenMonth={(monthKey) => openCashOutgoSearch(reportMode, monthKey)}
              onOpenAll={() =>
                openCashOutgoSearchWithContext(
                  reportMode,
                  getCashOutgoTotalMonthKey(selectedCashOutgoRows),
                  getCashOutgoTotalDateContext(selectedCashOutgoRows),
                )
              }
            />
          ) : reportMode === "supplementaryBillsSubmitted" ? (
            <ExpectedCashOutgoReport
              rows={supplementaryBillSentForPaymentRows}
              title={reportTitle}
              titleHelper={reportModeHelperText.supplementaryBillsSubmitted}
              description={billingPaymentReportDescription || reportLogic}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={exportCashOutgoPdf}
                  onExcel={exportCashOutgoExcel}
                />
              }
              dateRange={historicalDateRangeControls}
              emptyMessage={cashOutgoEmptyMessage}
              onOpenMonth={(monthKey) => openCashOutgoSearch("supplementaryBillSent", monthKey)}
              onOpenAll={() =>
                openCashOutgoSearchWithContext(
                  "supplementaryBillSent",
                  getCashOutgoTotalMonthKey(supplementaryBillSentForPaymentRows),
                  getCashOutgoTotalDateContext(supplementaryBillSentForPaymentRows),
                )
              }
            />
          ) : reportMode === "supplementaryBillsPaid" ? (
            <ExpectedCashOutgoReport
              rows={supplementaryActualCashOutgoRows}
              title={reportTitle}
              titleHelper={reportModeHelperText.supplementaryBillsPaid}
              description={reportLogic}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={exportCashOutgoPdf}
                  onExcel={exportCashOutgoExcel}
                />
              }
              dateRange={historicalDateRangeControls}
              emptyMessage={cashOutgoEmptyMessage}
              onOpenMonth={(monthKey) => openCashOutgoSearch("supplementaryActual", monthKey)}
              onOpenAll={() =>
                openCashOutgoSearchWithContext(
                  "supplementaryActual",
                  getCashOutgoTotalMonthKey(supplementaryActualCashOutgoRows),
                  getCashOutgoTotalDateContext(supplementaryActualCashOutgoRows),
                )
              }
            />
          ) : reportMode === "cashOutgoForMonth" ? (
            <ExpectedCashOutgoReport
              rows={cashOutgoForMonthRows}
              title={reportTitle}
              titleHelper={supplementaryBillInclusionNotes.cashOutgoForMonth}
              description={reportLogic}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={exportCashOutgoPdf}
                  onExcel={exportCashOutgoExcel}
                />
              }
              monthSelection={monthSelectionControls}
              onOpenMonth={(monthKey) =>
                openCashOutgoAnySearch(["billPreparation", "billSent", "expectedDp"], monthKey)
              }
              onOpenAll={() =>
                openCashOutgoAnySearchWithContext(
                  ["billPreparation", "billSent", "expectedDp"],
                  getCashOutgoTotalMonthKey(cashOutgoForMonthRows),
                  getCashOutgoTotalDateContext(cashOutgoForMonthRows),
                )
              }
            />
          ) : (
            <ExpectedCashOutgoReport
              rows={expectedExpenditureTillMonthRows}
              title={reportTitle}
              titleHelper={supplementaryBillInclusionNotes.expectedExpenditureTillMonth}
              description={reportLogic}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={exportCashOutgoPdf}
                  onExcel={exportCashOutgoExcel}
                />
              }
              selectedDays={expectedCashOutgoDaysDraft}
              selectedDaysUnlocked={expectedCashOutgoDaysUnlocked}
              sharedDays={sharedExpectedCashOutgoDays}
              savingDays={expectedCashOutgoDaysSaving}
              daysError={expectedCashOutgoDaysError}
              daysSaved={expectedCashOutgoDaysSaved}
              hasPersonalOverride={hasExpectedCashOutgoDaysOverride}
              onDaysChange={setExpectedCashOutgoDaysDraft}
              onSelectedDaysUnlockedChange={toggleExpectedCashOutgoDaysLock}
              onSelectedDaysSave={saveExpectedCashOutgoDays}
              onSelectedDaysReset={resetExpectedCashOutgoDays}
              monthSelection={monthSelectionControls}
              onOpenMonth={(monthKey) =>
                openCashOutgoAnySearch(
                  [
                    "actualThrough",
                    "billPreparationThrough",
                    "billSentThrough",
                    "expectedReceiptPendingBillThrough",
                  ],
                  monthKey,
                )
              }
              onOpenAll={() =>
                openCashOutgoAnySearchWithContext(
                  [
                    "actualThrough",
                    "billPreparationThrough",
                    "billSentThrough",
                    "expectedReceiptPendingBillThrough",
                  ],
                  getCashOutgoTotalMonthKey(expectedExpenditureTillMonthRows),
                  getCashOutgoTotalDateContext(expectedExpenditureTillMonthRows),
                )
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

type ReportMode =
  | "mmgSummary"
  | "demandProcessingAnalysis"
  | "firmDatabase"
  | "merData"
  | "merComparison"
  | "cashOutGoPlan"
  | "unifiedFinanceReview"
  | "preSoExpectedCashOutgo"
  | "soPaymentMatrix"
  | "paymentCompletedMatrix"
  | "itemsDeliveredBillsPending"
  | "itemsDeliveredBillsPrepared"
  | "billsSubmitted"
  | "expectedCashOutgoFy"
  | "spentTillDateFy"
  | "billsPaidInMonth"
  | "currentMonthLiability"
  | "cashOutgoForMonth"
  | "expectedExpenditureTillMonth"
  | "pendingReturnedBills"
  | "returnedBillsResubmitted"
  | "returnedBillsPaid"
  | "supplementaryBillsSubmitted"
  | "supplementaryBillsPaid"
  | "supplementaryPendingReturnedBills"
  | "supplementaryReturnedBillsResubmitted"
  | "supplementaryReturnedBillsPaid"
  | "monthlyFileInflow"
  | "monthWiseSupplyOrder"
  | "monthWiseDeliverySchedule"
  | "monthWiseCompletedDeliveries"
  | "monthWiseBgExpiry"
  | "preBidMeetings"
  | "bgReceiptDelay"
  | "warrantyBgMismatch"
  | "delayStatus"
  | "pendingLiabilityAgeing";
type ReportDateRange = { fromDate: string; toDate: string };
type CashOutgoFilterMode =
  | "expectedDp"
  | "expectedReceipt"
  | "expectedReceiptThrough"
  | "expectedReceiptPendingBill"
  | "expectedReceiptPendingBillThrough"
  | "billPreparation"
  | "billPreparationThrough"
  | "billSent"
  | "billSentThrough"
  | "actual"
  | "actualThrough"
  | "expectedDpThrough"
  | "supplementaryBillSent"
  | "supplementaryActual"
  | "supplementaryPendingReturnedBills"
  | "supplementaryReturnedBillsResubmitted"
  | "supplementaryReturnedBillsPaid"
  | ReturnedBillCashOutgoMode;

const reportModes = [
  { key: "mmgSummary", label: "MMG Summary" },
  { key: "demandProcessingAnalysis", label: "Demand processing analysis" },
  { key: "firmDatabase", label: "Firm Performance" },
  { key: "merData", label: "MER Data" },
  { key: "merComparison", label: "MER vs Recorded Payments" },
  { key: "unifiedFinanceReview", label: "Unified Finance Review" },
  { key: "cashOutGoPlan", label: "Cash Out Go Plan" },
  { key: "preSoExpectedCashOutgo", label: "Pre-S.O. based expected cash outgo" },
  { key: "soPaymentMatrix", label: "Month-wise Payment due Matrix" },
  { key: "paymentCompletedMatrix", label: "Month-wise Payment completed Matrix" },
  {
    key: "itemsDeliveredBillsPending",
    label: "Delivery / D.P. Done, Bill Preparation Pending",
  },
  {
    key: "itemsDeliveredBillsPrepared",
    label: "Delivery / D.P. Done, Bill Prepared",
  },
  { key: "billsSubmitted", label: "Bills Submitted, Payment Pending" },
  { key: "expectedCashOutgoFy", label: "Expected Cash Outgo by D.P." },
  { key: "spentTillDateFy", label: "Actual Cash Outgo as on Date" },
  { key: "billsPaidInMonth", label: "Bills Paid in Selected Month" },
  { key: "pendingReturnedBills", label: "Pending returned bills" },
  { key: "returnedBillsResubmitted", label: "Returned bills resubmitted and unpaid" },
  { key: "returnedBillsPaid", label: "Returned bills paid" },
  { key: "supplementaryBillsSubmitted", label: "Supplementary bills submitted, payment pending" },
  { key: "supplementaryBillsPaid", label: "Supplementary bills paid" },
  { key: "supplementaryPendingReturnedBills", label: "Pending returned supplementary bills" },
  {
    key: "supplementaryReturnedBillsResubmitted",
    label: "Returned supplementary bills resubmitted",
  },
  { key: "supplementaryReturnedBillsPaid", label: "Returned supplementary bills paid" },
  { key: "cashOutgoForMonth", label: "Expected cash outgo exclusively for selected month" },
  { key: "expectedExpenditureTillMonth", label: "Expected Expenditure Up to Selected Month" },
  { key: "currentMonthLiability", label: "Cumulative Liability Up to Month" },
  { key: "monthlyFileInflow", label: "Monthly file inflow" },
  { key: "monthWiseSupplyOrder", label: "Month-wise Supply Order" },
  { key: "monthWiseDeliverySchedule", label: "Month-wise Delivery / Contract Period Schedule" },
  {
    key: "monthWiseCompletedDeliveries",
    label: "Month-wise completed deliveries / Job Completion",
  },
  { key: "monthWiseBgExpiry", label: "Month-wise BG expiry" },
  { key: "preBidMeetings", label: "Pre-Bid Meetings" },
  { key: "bgReceiptDelay", label: "BG receipt delay" },
  { key: "warrantyBgMismatch", label: "Warranty / BG mismatch" },
  { key: "delayStatus", label: "Delay Status" },
  { key: "pendingLiabilityAgeing", label: "Pending Liabilities" },
] satisfies Array<{ key: ReportMode; label: string }>;
type ReportModeOption = (typeof reportModes)[number];
type DrillPathItem = { label: string; href?: string };
const supplementaryBillInclusionNotes = {
  itemsDeliveredBillsPrepared: [
    "This shows delivered or D.P.-complete work with a prepared bill that is not fully paid yet.",
    "Cancelled demands and S.O.s are left out. For a shortclosed S.O., unpaid follow-up stays here while No Further Action is No.",
    "Closed files follow your filters. Other S.O.s in the same file continue as usual.",
    "A supplementary bill returned for correction stays here while it waits to be resubmitted.",
    "If you set a date range, it checks the Bill Preparation date. For example, a bill prepared in September is included when September is in range.",
  ],
  billsSubmitted: [
    "This shows bills sent to PCDA with no payment recorded yet.",
    "Cancelled demands and S.O.s are left out. For a shortclosed S.O., unpaid follow-up stays here while No Further Action is No.",
    "Closed files follow your filters. Other S.O.s in the same file continue as usual.",
    "Unpaid supplementary bills are included after they are sent or resubmitted.",
    "If you set a date range, it checks the latest Bill Sent/Submitted date. For example, a bill resubmitted in October is dated to October for this view.",
  ],
  spentTillDateFy: [
    "Paid supplementary bills appear in the FY of their payment date.",
    "The report uses the actual paid amount, or the bill amount if that is blank.",
    "MER is not used in this report.",
  ],
  billsPaidInMonth: [
    "Paid supplementary bills appear in the month of their payment date.",
    "The report uses the actual paid amount, or the bill amount if that is blank.",
  ],
  currentMonthLiability: [
    "This adds up unpaid work through the selected month: bills not yet prepared, prepared bills, and bills sent but not paid.",
    "Cancelled demands and S.O.s are left out. Unpaid amounts for a shortclosed S.O. remain while No Further Action is No.",
    "Closed files follow your filters. Other S.O.s in the same file continue as usual.",
    "Unpaid supplementary bills are included after they are sent or resubmitted.",
  ],
  cashOutgoForMonth: [
    "Expected supplementary-bill payments are included in the selected month.",
    "Unpaid work for a shortclosed S.O. stops counting when No Further Action is Yes.",
  ],
  expectedExpenditureTillMonth: [
    "This includes submitted, resubmitted, and returned supplementary bills in the selected period.",
    "Unpaid work for a shortclosed S.O. stops counting when No Further Action is Yes; payments already made remain in the history.",
  ],
} satisfies Partial<Record<ReportMode, HelperText>>;
const reportModeHelperText = {
  mmgSummary: [
    "File Initiation Year can narrow the summary to files started in a particular FY.",
    "The date range checks when each demand was received. For example, a demand received in June appears in June when June is inside your selected range.",
  ],
  demandProcessingAnalysis: [
    "File Initiation Year can narrow the files. Cancelled demands are left out; closed files follow the Global Filter you chose.",
    "Cancelled S.O.s are left out of S.O., stage, advance, and payment comparisons. Earlier steps through CFA can still be compared.",
    "Shortclosed S.O.s remain in a comparison when both dates are available.",
    "Choose two dates and the report shows how many days passed between them. Date pairs that cannot happen in the normal workflow are not offered.",
    "If the second date is earlier than the first, the result is listed under Negative results and is not included in averages or range totals.",
    "Unified payment treats regular, stage, advance, returned/resubmitted, and supplementary bills as separate payment events. For example, a resubmitted bill is timed from its latest resubmission to payment.",
    "When you set a date range, it checks the selected From date.",
  ],
  firmDatabase: [
    "File Initiation Year can narrow the files. Cancelled demands are left out; closed files follow your Global Filter.",
    "Cancelled and shortclosed S.O.s stay in the historical list. Performance, value, BG, rating, and delay measures use non-cancelled S.O.s.",
    "Total S.O. is a historical count, so it includes cancelled orders. The other measures do not.",
    "Average Delay Days compares completed, delayed S.O.s with their original D.P.",
    "Leave the date range blank to use all S.O.s in the selected files. Add a range to use only S.O.s placed during that period.",
  ],
  merData: [
    "This is the monthly cash-outgo amount your team recorded as MER.",
    "Enter amounts in lakh: 12.50 means ₹12.50 lakh. The table and exports also show lakh.",
    "Global Filter selects the FY. For Active Files, the report uses the Current FY set in Settings. File Initiation Year does not change MER.",
    "A past month's positive MER is shown as entered. If both MER amounts are zero, the report may use recorded payments instead; cancelled demands and S.O.s are left out of that fallback.",
  ],
  supplementaryBillsPaid: [
    "A supplementary bill appears in the FY and month when it was paid.",
    "The report uses the actual paid amount, or the bill amount if that is blank.",
    "Cancelled demands and S.O.s are left out. A paid bill remains in the history even if its S.O. was shortclosed or the bill was returned earlier.",
  ],
  supplementaryBillsSubmitted: [
    "This shows supplementary bills sent or resubmitted with no payment recorded yet.",
    "Cancelled demands and S.O.s are left out. For a shortclosed S.O., unpaid follow-up continues only while No Further Action is No.",
    "Unfinished supplementary work under a cancelled S.O. is flagged as an anomaly instead.",
  ],
  supplementaryPendingReturnedBills: [
    "This shows supplementary bills returned for correction that have not been resubmitted yet.",
    "Cancelled demands and cancelled S.O.s are left out. For a shortclosed S.O., unpaid follow-up continues only while No Further Action is No.",
    "Unfinished supplementary work under a cancelled S.O. is flagged as an anomaly instead.",
  ],
  supplementaryReturnedBillsResubmitted: [
    "This shows returned supplementary bills that were resubmitted but remain unpaid.",
    "Cancelled demands and cancelled S.O.s are left out. For a shortclosed S.O., unpaid follow-up continues only while No Further Action is No.",
    "Unfinished supplementary work under a cancelled S.O. is flagged as an anomaly instead.",
  ],
  supplementaryReturnedBillsPaid: [
    "This shows supplementary bills that were returned and later paid.",
    "The report uses the actual paid amount, or the bill amount if that is blank.",
    "Cancelled demands and S.O.s are left out; completed payments for shortclosed S.O.s remain included.",
  ],
  pendingReturnedBills: [
    "This shows bills returned for correction that are still waiting to be resubmitted.",
    "Cancelled demands and cancelled S.O.s are left out. For a shortclosed S.O., unpaid follow-up continues only while No Further Action is No.",
  ],
  returnedBillsResubmitted: [
    "This shows returned bills that were resubmitted but remain unpaid.",
    "Cancelled demands and cancelled S.O.s are left out. For a shortclosed S.O., unpaid follow-up continues only while No Further Action is No.",
  ],
  returnedBillsPaid: [
    "This shows bills that were returned and later paid.",
    "Cancelled demands and cancelled S.O.s are left out; completed payments for shortclosed S.O.s remain included.",
  ],
  soPaymentMatrix: [
    "This places unpaid regular, stage, advance, and supplementary payments in the month they are expected.",
    "A supplementary bill's estimate starts from its latest submission or resubmission date. A returned bill is not forecast again until it is resubmitted.",
    "Regular and stage payments follow the schedule for their file type.",
    "Cancelled demands and S.O.s are left out. No Further Action = Yes stops unpaid delivery and payment follow-up, but keeps recorded history and BG/warranty tracking. Other S.O.s in the file continue as usual.",
    "The months run April to March. A payment appears only when its expected date falls in the selected FY.",
  ],
  paymentCompletedMatrix: [
    "This places regular, stage, advance, and supplementary payments in the month they were paid.",
    "For a supplementary bill, the report uses the actual paid amount, or the bill amount if that is blank.",
    "Cancelled demands and S.O.s are left out. Payments already made for shortclosed S.O.s remain included; other S.O.s in the file continue as usual.",
    "The months run April to March. A payment appears only when its payment date falls in the selected FY.",
  ],
} satisfies Partial<Record<ReportMode, HelperText>>;
type HelperText = string | string[];
const CASH_OUT_GO_RED_ROW_HELPER =
  "A row turns red when its planned bill-submission date has passed but no actual submission date is recorded. A row expected to be paid after the selected FY-end stays here for you to review and edit, but is left out of that FY's totals and forecast.";
const soPaymentMatrixDefaultFields: SoPaymentMatrixFieldKey[] = [
  "fileUniqueNo",
  "demandDescription",
  "soNo",
  "paymentItem",
  "soDate",
  "firmName",
  "division",
];
const soPaymentMatrixFieldOptions: SoPaymentMatrixColumnOption[] = [
  {
    key: "fileUniqueNo",
    label: "File unique no.",
    helper: "Shows the file's unique code or control number.",
  },
  {
    key: "demandDescription",
    label: "Demand description",
    helper: "Shows the Demand Description from File Details.",
  },
  { key: "soNo", label: "S.O. No.", helper: "Shows the S.O. No., or the GeM S.O. No. if the first is blank." },
  {
    key: "paymentItem",
    label: "Payment item",
    helper: "Tells you whether this is a regular, stage, advance, or supplementary payment. Shows the supplementary bill number when available.",
  },
  { key: "soDate", label: "S.O. date", helper: "Shows when the S.O. was placed." },
  { key: "firmName", label: "Firm name", helper: "Shows the firm named on the S.O." },
  { key: "division", label: "Division", helper: "Shows the division handling the file." },
  {
    key: "fileCategory",
    label: "File category",
    helper: "Shows whether the file follows Goods & Services or Contract workflow rules.",
  },
  { key: "fileType", label: "File type", helper: "Shows the selected file type, such as AMC or MPC." },
  { key: "indentor", label: "Indentor", helper: "Shows who raised the demand." },
  { key: "mode", label: "Mode", helper: "Shows the procurement mode recorded for the file." },
  { key: "firmType", label: "Firm type", helper: "Shows the firm type recorded on the S.O." },
  {
    key: "demandInitiationYear",
    label: "Demand initiation year",
    helper: "Shows the FY when the file was started.",
  },
  {
    key: "demandValue",
    label: "Demand value",
    helper: "Shows the file's Capital and Revenue demand values combined.",
  },
  { key: "capitalValue", label: "Capital value", helper: "Shows the file's Capital demand value." },
  { key: "revenueValue", label: "Revenue value", helper: "Shows the file's Revenue demand value." },
  { key: "soValue", label: "S.O. value", helper: "Shows the S.O.'s Capital and Revenue values combined." },
  {
    key: "paymentBasis",
    label: "Payment basis",
    helper: "Explains what makes this payment due, such as a stage date, bill, delivery, job completion, or D.P.",
  },
];
const fileYearSubfilterHelper = [
  "Global Filter sets which files this report can use. File Initiation Year can narrow that list to files started in one FY.",
  "Choose All file years when you do not want to narrow the list by start year. With Global Filter = All files, this means the entire database.",
  "Example: Global Filter 2026-27 with File Initiation Year 2025-26 shows files started in 2025-26 that are included in the 2026-27 view.",
  "For month columns, MER, and default dates, broad file views use the Current FY set in Settings.",
  "Your selection and lock are saved for this browser tab only.",
];
const fileInitiationDateRangeHelper = [
  "Use this range to narrow the files selected by File Initiation Year.",
  "Leave both dates blank to skip the extra date restriction.",
];
type ReportModeSection = {
  title: string;
  modes: ReadonlyArray<ReportModeOption>;
  summaryKeys?: ReadonlyArray<ReportMode>;
};
const reportModeByKey = new Map(reportModes.map((mode) => [mode.key, mode]));
function getReportModeOptions(keys: ReadonlyArray<ReportMode>): ReportModeOption[] {
  return keys.map((key) => {
    const mode = reportModeByKey.get(key);
    if (!mode) throw new Error(`Unknown report mode: ${key}`);
    return mode;
  });
}
function isReportMode(value: unknown): value is ReportMode {
  return typeof value === "string" && reportModeByKey.has(value as ReportMode);
}
function getReportModeHref(mode: ReportMode) {
  return `/reports?mode=${encodeURIComponent(mode)}`;
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
const mmgReportMode = reportModes[0];
const demandProcessingReportMode = reportModes[1];
const firmDatabaseReportMode = reportModes[2];
const cashOutgoReportGroups: ReadonlyArray<ReportModeSection> = [
  {
    title: "MER",
    modes: getReportModeOptions([
      "unifiedFinanceReview",
      "merData",
      "merComparison",
      "cashOutGoPlan",
      "preSoExpectedCashOutgo",
      "soPaymentMatrix",
      "paymentCompletedMatrix",
    ]),
  },
  {
    title: "Returned bills",
    modes: getReportModeOptions([
      "pendingReturnedBills",
      "returnedBillsResubmitted",
      "returnedBillsPaid",
    ]),
  },
  {
    title: "Supplementary bills",
    modes: getReportModeOptions([
      "supplementaryBillsSubmitted",
      "supplementaryBillsPaid",
      "supplementaryPendingReturnedBills",
      "supplementaryReturnedBillsResubmitted",
      "supplementaryReturnedBillsPaid",
    ]),
  },
];
const cashOutgoReportModes = cashOutgoReportGroups.flatMap((group) => group.modes);
const combinedCashOutgoExportModes = cashOutgoReportGroups
  .filter((group) => group.title !== "MER")
  .flatMap((group) => group.modes.map((mode) => mode.key))
  .filter((mode) => mode !== "soPaymentMatrix" && mode !== "paymentCompletedMatrix");
const supplyOrderDeliveryReportModes = getReportModeOptions([
  "monthlyFileInflow",
  "monthWiseSupplyOrder",
  "monthWiseDeliverySchedule",
  "monthWiseCompletedDeliveries",
]);
const monitoringReportModes = getReportModeOptions([
  "monthWiseBgExpiry",
  "preBidMeetings",
  "bgReceiptDelay",
  "warrantyBgMismatch",
  "delayStatus",
  "pendingLiabilityAgeing",
]);
const fileClosedMilestone = "File Closed";
const delayStatusPageSizeOptions = [25, 50, 100] as const;
const biddingDelayMilestoneKey = "bidding";
const biddingDelayMilestoneLabel = "Bidding";
const billReturnedDelayMilestoneKey = "billReturnedForCorrection";
const supplementaryBillReturnedDelayMilestoneKey = "supplementaryBillReturnedForCorrection";
const biddingDelayBreakupOptions = [
  { key: "gemUndertakingPending", label: "GeM undertaking pending" },
  { key: "rfpVettingInitiationPending", label: "RFP vetting initiation pending" },
  { key: "rfpVettingApprovalPending", label: "RFP vetting approval pending" },
  { key: "tenderLivePending", label: "Tender live pending" },
  { key: "bidOpeningOverdue", label: "Bid opening overdue" },
  { key: "biddingStageCompletionPending", label: "Bidding stage completion pending" },
] as const;
const firmDatabasePageSizeOptions = [25, 50, 100] as const;

type FirmDatabaseColumnKey =
  | "serial"
  | "firmName"
  | "firmUniqueNo"
  | "emailId"
  | "contactNo"
  | "city"
  | "totalSupplyOrders"
  | "runningSupplyOrders"
  | "completedSupplyOrders"
  | "cancelledSupplyOrders"
  | "stageDeliveryOrders"
  | "capitalValue"
  | "revenueValue"
  | "totalValue"
  | "averageOrderValue"
  | "highestOrderValue"
  | "completedWithinDp"
  | "completedAfterDp"
  | "activeDelayedOrders"
  | "averageDelayDays"
  | "maxDelayDays"
  | "dpExtensionOrders"
  | "ldOrders"
  | "bgApplicableOrders"
  | "bgReceivedOrders"
  | "bgPendingOrders"
  | "bgDelayedOrders"
  | "bgReturnedOrders"
  | "averageRating"
  | "ratingCount"
  | "latestRating"
  | "deliveryRating"
  | "qualityRating"
  | "afterSalesServiceRating"
  | "highValueOrders"
  | "divisionCount"
  | "divisions"
  | "fileTypes";

type FirmDatabaseSortKey = Exclude<FirmDatabaseColumnKey, "serial">;
type FirmDatabaseSortDirection = "asc" | "desc";

type FirmDatabaseReportPreferences = {
  defaultColumns?: FirmDatabaseColumnKey[];
  sortKey?: FirmDatabaseSortKey;
  sortDirection?: FirmDatabaseSortDirection;
  locked?: boolean;
};

type FirmDatabaseRow = Record<FirmDatabaseColumnKey, string | number> & {
  id: string;
  divisionNames: string[];
  orderIds: string[];
  clickTargets: Partial<Record<FirmDatabaseColumnKey, string[]>>;
  numeric: Partial<Record<FirmDatabaseColumnKey, number>>;
};

type FirmDatabaseColumn = {
  key: FirmDatabaseColumnKey;
  label: string;
  group: string;
  align?: "left" | "right";
};

const firmDatabaseColumns: FirmDatabaseColumn[] = [
  { key: "serial", label: "S. No.", group: "Firm identity", align: "right" },
  { key: "firmName", label: "Firm name", group: "Firm identity" },
  { key: "firmUniqueNo", label: "Firm Unique No.", group: "Firm identity" },
  { key: "emailId", label: "Email", group: "Firm identity" },
  { key: "contactNo", label: "Contact No.", group: "Firm identity" },
  { key: "city", label: "City", group: "Firm identity" },
  { key: "totalSupplyOrders", label: "Total S.O.", group: "Supply orders", align: "right" },
  { key: "runningSupplyOrders", label: "Running S.O.", group: "Supply orders", align: "right" },
  { key: "completedSupplyOrders", label: "Completed S.O.", group: "Supply orders", align: "right" },
  { key: "cancelledSupplyOrders", label: "Cancelled S.O.", group: "Supply orders", align: "right" },
  {
    key: "stageDeliveryOrders",
    label: "Stage delivery S.O.",
    group: "Supply orders",
    align: "right",
  },
  { key: "capitalValue", label: "Capital value", group: "Value", align: "right" },
  { key: "revenueValue", label: "Revenue value", group: "Value", align: "right" },
  { key: "totalValue", label: "Total value", group: "Value", align: "right" },
  { key: "averageOrderValue", label: "Average S.O. value", group: "Value", align: "right" },
  { key: "highestOrderValue", label: "Highest S.O. value", group: "Value", align: "right" },
  {
    key: "completedWithinDp",
    label: "Completed within D.P.",
    group: "Delivery / Job completion",
    align: "right",
  },
  {
    key: "completedAfterDp",
    label: "Completed after D.P.",
    group: "Delivery / Job completion",
    align: "right",
  },
  {
    key: "activeDelayedOrders",
    label: "Active delayed S.O.",
    group: "Delivery / Job completion",
    align: "right",
  },
  {
    key: "averageDelayDays",
    label: "Average delay days",
    group: "Delivery / Job completion",
    align: "right",
  },
  {
    key: "maxDelayDays",
    label: "Max delay days",
    group: "Delivery / Job completion",
    align: "right",
  },
  {
    key: "dpExtensionOrders",
    label: "D.P. extension S.O.",
    group: "Delivery / Job completion",
    align: "right",
  },
  { key: "ldOrders", label: "LD S.O.", group: "Delivery / Job completion", align: "right" },
  {
    key: "bgApplicableOrders",
    label: "BG applicable S.O.",
    group: "BG / Security",
    align: "right",
  },
  { key: "bgReceivedOrders", label: "BG received S.O.", group: "BG / Security", align: "right" },
  { key: "bgPendingOrders", label: "BG pending S.O.", group: "BG / Security", align: "right" },
  { key: "bgDelayedOrders", label: "BG delayed S.O.", group: "BG / Security", align: "right" },
  { key: "bgReturnedOrders", label: "BG returned S.O.", group: "BG / Security", align: "right" },
  { key: "averageRating", label: "Average rating", group: "Rating", align: "right" },
  { key: "ratingCount", label: "Rating count", group: "Rating", align: "right" },
  { key: "latestRating", label: "Latest rating", group: "Rating", align: "right" },
  { key: "deliveryRating", label: "Delivery rating", group: "Rating", align: "right" },
  { key: "qualityRating", label: "Quality rating", group: "Rating", align: "right" },
  {
    key: "afterSalesServiceRating",
    label: "After Sales Service rating",
    group: "Rating",
    align: "right",
  },
  { key: "highValueOrders", label: "High value S.O.", group: "Risk / coverage", align: "right" },
  { key: "divisionCount", label: "Divisions served", group: "Risk / coverage", align: "right" },
  { key: "divisions", label: "Divisions", group: "Risk / coverage" },
  { key: "fileTypes", label: "File types", group: "Risk / coverage" },
];

const defaultFirmDatabaseColumnKeys: FirmDatabaseColumnKey[] = [
  "serial",
  "firmName",
  "firmUniqueNo",
  "contactNo",
  "city",
  "totalSupplyOrders",
  "runningSupplyOrders",
  "completedSupplyOrders",
  "capitalValue",
  "revenueValue",
  "totalValue",
  "averageDelayDays",
  "bgPendingOrders",
  "averageRating",
  "divisionCount",
  "fileTypes",
];

function ReportModeButton({
  mode,
  selected,
  onSelect,
  emphasized = false,
}: {
  mode: ReportModeOption;
  selected: boolean;
  onSelect: (mode: ReportMode) => void;
  emphasized?: boolean;
}) {
  const inactiveClass = emphasized
    ? "bg-secondary/40 text-foreground hover:bg-accent"
    : "text-muted-foreground hover:bg-accent hover:text-foreground";
  const helperText = getReportModeButtonHelper(mode.key);
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onSelect(mode.key)}
        className={
          "min-w-0 flex-1 rounded-md px-3 py-2 text-left text-sm font-medium transition " +
          (selected ? "bg-primary text-primary-foreground shadow-sm" : inactiveClass)
        }
      >
        {mode.label}
      </button>
      <FloatingHelper
        text={helperText}
        label={`${mode.label} note`}
        className="size-8 shrink-0"
        iconClassName="size-3"
      />
    </div>
  );
}

function getReportModeButtonHelper(mode: ReportMode): HelperText {
  const custom = (reportModeHelperText as Partial<Record<ReportMode, HelperText>>)[mode];
  const supplementary = (supplementaryBillInclusionNotes as Partial<Record<ReportMode, HelperText>>)[mode];
  const commonFilters =
    "The report follows your Global Filter, File Initiation Year, Division, File Type, and date range wherever those filters apply. Your access permissions also limit which files you can see.";
  if (custom && supplementary) return [...flattenHelperText(custom), ...flattenHelperText(supplementary)];
  if (custom) return custom;
  if (supplementary) return [commonFilters, ...flattenHelperText(supplementary)];
  if (mode === "cashOutGoPlan") {
    return [
      "For past months, positive MER replaces recorded payments; if both MER amounts are zero, recorded payments are used. Pending bills use the Cash Out Go forecast.",
      "Cancelled demands and S.O.s are left out of calculated actuals and forecasts.",
      "Shortclosed S.O.s stay in the plan while real billing, delivery, or payment work remains. Shortclosure can stop future work that has not started.",
      "What you can edit depends on your Cash Out Go Plan access.",
      commonFilters,
    ];
  }
  if (mode === "preSoExpectedCashOutgo") {
    return [
      "This estimates cash outgo for active files that do not yet have a live S.O.",
      "Cancelled demands, closed files, and files with a live S.O. are left out.",
      "This report always uses All Active Files and All file years. You cannot narrow it by initiation date.",
    ];
  }
  if (mode === "itemsDeliveredBillsPending") {
    return [
      "This shows delivered or completed work whose bill is not prepared yet.",
      "The expected date starts from the relevant delivery, Job Completion, or D.P. date, then uses the configured offset.",
      "Unpaid follow-up for a shortclosed S.O. stops when No Further Action is Yes.",
      "Cancelled demands and S.O.s are left out. Shortclosed S.O.s remain while payment work is still active.",
      "Closed files follow the Global Filter and File Initiation Year. Other S.O.s in the same file continue normally.",
      commonFilters,
    ];
  }
  if (mode === "itemsDeliveredBillsPrepared") {
    return [
      "This shows delivered or completed work with a prepared bill that is not fully paid yet.",
      "When enabled, the date range checks the Bill Preparation date.",
      "Unpaid follow-up for a shortclosed S.O. stops when No Further Action is Yes.",
      commonFilters,
    ];
  }
  if (mode === "billsSubmitted") {
    return [
      "This shows bills sent to PCDA with no payment recorded yet.",
      "When enabled, the date range checks the Bill Sent/Submission date.",
      "Unpaid follow-up for a shortclosed S.O. stops when No Further Action is Yes.",
      commonFilters,
    ];
  }
  if (mode === "expectedCashOutgoFy") {
    return [
      "This estimates payment follow-up by each unpaid S.O.'s D.P. or Revised D.P.",
      "The expected month uses that D.P. date and the configured offsets.",
      "For a specific FY, only dates inside that FY are counted.",
      "Unpaid follow-up for a shortclosed S.O. stops when No Further Action is Yes.",
      commonFilters,
    ];
  }
  if (mode === "spentTillDateFy") {
    return [
      "This shows payments by the date they were actually recorded as paid.",
      "MER is not used here.",
      "For a specific FY, only payment dates inside that FY are counted.",
      commonFilters,
    ];
  }
  if (mode === "billsPaidInMonth") {
    return [
      "This shows payments made in the selected month.",
      "Regular, supplementary, and applicable advance payments are included.",
      commonFilters,
    ];
  }
  if (mode === "cashOutgoForMonth") {
    return [
      "This shows the planned cash outgo for the selected month only.",
      "It combines prepared bills, submitted bills still unpaid, and eligible D.P.-based items.",
      commonFilters,
    ];
  }
  if (mode === "expectedExpenditureTillMonth") {
    return [
      "This adds actual outgo and expected pending expenditure from the start of the FY through the selected month.",
      commonFilters,
    ];
  }
  if (mode === "currentMonthLiability") {
    return [
      "This adds unpaid liabilities through the selected month.",
      "A bill is included only while payment is still pending at that point.",
      commonFilters,
    ];
  }
  if (isReturnedBillReportMode(mode)) {
    return [
      "This follows bills according to their current return, resubmission, or payment status.",
      "When enabled, the date range checks the return, resubmission, or payment event shown here.",
      commonFilters,
    ];
  }
  if (mode === "supplementaryBillsSubmitted") {
    return [
      "This follows supplementary bills according to their submission and payment status.",
      "When enabled, the date range checks the relevant supplementary-bill event.",
      commonFilters,
    ];
  }
  if (mode === "monthlyFileInflow") {
    return [
      "This groups files by when the demand was received or the file was initiated.",
      "For a specific FY, only those dates inside that FY are counted.",
      "Cancelled demands are left out. Closed files and files with cancelled or shortclosed S.O.s can still appear.",
      commonFilters,
    ];
  }
  if (mode === "monthWiseSupplyOrder") {
    return [
      "This counts S.O.s by the month they were placed.",
      "For a specific FY, only S.O. dates inside that FY are counted. File Initiation Year can also narrow the files.",
      "Cancelled demands are left out. Closed files and cancelled or shortclosed S.O.s can still appear in the history.",
      commonFilters,
    ];
  }
  if (mode === "monthWiseDeliverySchedule") {
    return [
      "This groups delivery dates and contract periods by their D.P., Revised D.P., or contract-period date.",
      "For a specific FY, only dates inside that FY are counted. File Initiation Year can also narrow the files.",
      "The pending count leaves out items already delivered or completed.",
      "Cancelled demands and S.O.s are left out. No Further Action stops future delivery follow-up for a shortclosed S.O.",
      "Closed files follow your filters. Contract and IR No. files use their contract-period or Job Completion dates.",
      commonFilters,
    ];
  }
  if (mode === "monthWiseCompletedDeliveries") {
    return [
      "This groups completed deliveries and Job Completions by the date each was recorded.",
      "For a specific FY, only completion dates inside that FY are counted. File Initiation Year can also narrow the files.",
      "Goods use the material receipt date; applicable contract work uses Job Completion.",
      "Cancelled demands and S.O.s are left out. Closed files and shortclosed S.O.s remain when completion was recorded.",
      commonFilters,
    ];
  }
  if (mode === "monthWiseBgExpiry") {
    return [
      "This groups bank guarantees by their validity/expiry date.",
      "For a specific FY, only expiry dates inside that FY are counted. File Initiation Year can also narrow the files.",
      "Cancelled demands are left out. Received, unreturned BGs can remain in the report for closed, cancelled, or shortclosed S.O.s.",
      commonFilters,
    ];
  }
  if (mode === "preBidMeetings") {
    return [
      "This shows pre-bid meetings by the date each meeting took place.",
      "For a specific FY, only meeting dates inside that FY are counted.",
      "Cancelled demands are left out. S.O. cancellation or shortclosure does not change this file-processing report.",
      commonFilters,
    ];
  }
  if (mode === "bgReceiptDelay") {
    return [
      "This shows guarantees that are late to arrive, using the selected day threshold.",
      "A delay is counted only when BG is required and receipt is still pending.",
      "Cancelled demands and S.O.s are left out. A shortclosed S.O. remains if its required BG has not arrived.",
      commonFilters,
    ];
  }
  if (mode === "warrantyBgMismatch") {
    return [
      "This finds differences between warranty and BG validity dates using the selected buffer.",
      "The comparison uses the dates recorded on the file and S.O.",
      "Cancelled demands and S.O.s are left out. A shortclosed S.O. remains while warranty or BG obligations continue.",
      commonFilters,
    ];
  }
  if (mode === "delayStatus") {
    return [
      "This shows work that is still at its current stage beyond the selected delay limit.",
      "A file can have more than one delayed S.O. or stage case. The Search clicker opens each matching file once.",
      "A stage cleared before the delay limit is not shown as currently delayed.",
      "Cancelled demands and S.O.s are left out. A shortclosed S.O. remains if a current workflow task is still pending.",
      commonFilters,
    ];
  }
  if (mode === "pendingLiabilityAgeing") {
    return [
      "This groups unpaid work by how long it has been pending, as of the selected date.",
      "The age starts from the applicable delivery, Job Completion, bill preparation, or submission date.",
      "Cancelled demands and S.O.s are left out. Shortclosed S.O.s remain while payment work is active; other S.O.s in the file continue normally.",
      commonFilters,
    ];
  }
  return commonFilters;
}

function CollapsibleReportGroup({
  title,
  modes,
  sections,
  footer,
  activeMode,
  expanded,
  onToggle,
  onSelect,
  hideSectionTitles = false,
}: {
  title: string;
  modes: ReadonlyArray<ReportModeOption>;
  sections?: ReadonlyArray<ReportModeSection>;
  footer?: ReactNode;
  activeMode: ReportMode;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (mode: ReportMode) => void;
  hideSectionTitles?: boolean;
}) {
  const hasActiveMode = modes.some((mode) => mode.key === activeMode);
  return (
    <div className="overflow-hidden rounded-md border border-border bg-secondary/20">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={
          "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-bold uppercase tracking-wide transition " +
          (hasActiveMode
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground")
        }
      >
        <span>{title}</span>
        <ChevronDown
          className={"h-4 w-4 transition-transform " + (expanded ? "rotate-180" : "")}
          aria-hidden="true"
        />
      </button>
      {expanded ? (
        <div className="space-y-1 border-t border-border bg-secondary/20 p-1.5">
          {sections ? (
            <div className="space-y-2">
              {sections.map((section) => {
                const summaryKeys = new Set(section.summaryKeys ?? []);
                return (
                  <div
                    key={section.title}
                    className="overflow-hidden rounded-md border border-border bg-secondary/20"
                  >
                    {!hideSectionTitles ? (
                      <div className="border-b border-border bg-accent px-2.5 py-1.5 text-[11px] font-bold uppercase text-foreground">
                        {section.title}
                      </div>
                    ) : null}
                    <div className="space-y-1 p-1.5">
                      {section.modes.map((mode) => (
                        <ReportModeButton
                          key={mode.key}
                          mode={mode}
                          selected={activeMode === mode.key}
                          emphasized={summaryKeys.has(mode.key)}
                          onSelect={onSelect}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            modes.map((mode) => (
              <ReportModeButton
                key={mode.key}
                mode={mode}
                selected={activeMode === mode.key}
                onSelect={onSelect}
              />
            ))
          )}
          {footer}
        </div>
      ) : null}
    </div>
  );
}

type CashOutgoRowSources = Parameters<typeof getRowsForReportMode>[1];

function buildCashOutgoExportTable(
  mode: ReportMode,
  rowSources: CashOutgoRowSources,
  titleContext: { today: string; monthKey: string; financialYear: string },
): ExportTable {
  const rows = getRowsForReportMode(mode, rowSources);
  return {
    title: getEightReportTitle(mode, titleContext),
    headers: cashOutgoColumns.map((column) => column.label),
    rows: rows.length
      ? [
          ...rows.map((row, index) =>
            cashOutgoColumns.map((column) => getCashOutgoDisplayValue(row, column.key, index)),
          ),
          getCashOutgoTotalsExportRow(rows),
        ]
      : [[getCashOutgoEmptyMessageForMode(mode)]],
  };
}

function getCashOutgoEmptyMessageForMode(mode: ReportMode) {
  if (mode === "billsPaidInMonth") return "No bills paid found for the selected month.";
  return "No expected cash outgo rows found.";
}

function getRowsForReportMode(
  mode: ReportMode,
  rows: {
    expectedCashOutgoReceiptPendingBillRows: ExpectedCashOutgoRow[];
    expectedCashOutgoBillPreparationRows: ExpectedCashOutgoRow[];
    billSentForPaymentRows: ExpectedCashOutgoRow[];
    expectedCashOutgoFyRows: ExpectedCashOutgoRow[];
    spentTillDateFyRows: ExpectedCashOutgoRow[];
    billsPaidInMonthRows: ExpectedCashOutgoRow[];
    currentLiabilityRows: ExpectedCashOutgoRow[];
    cashOutgoForMonthRows: ExpectedCashOutgoRow[];
    expectedExpenditureTillMonthRows: ExpectedCashOutgoRow[];
    pendingReturnedBillRows: ExpectedCashOutgoRow[];
    returnedBillResubmittedRows: ExpectedCashOutgoRow[];
    returnedBillPaidRows: ExpectedCashOutgoRow[];
    supplementaryBillSentForPaymentRows: ExpectedCashOutgoRow[];
    supplementaryActualCashOutgoRows: ExpectedCashOutgoRow[];
    supplementaryPendingReturnedBillRows: ExpectedCashOutgoRow[];
    supplementaryReturnedBillResubmittedRows: ExpectedCashOutgoRow[];
    supplementaryReturnedBillPaidRows: ExpectedCashOutgoRow[];
  },
) {
  if (mode === "itemsDeliveredBillsPending") return rows.expectedCashOutgoReceiptPendingBillRows;
  if (mode === "itemsDeliveredBillsPrepared") return rows.expectedCashOutgoBillPreparationRows;
  if (mode === "billsSubmitted") return rows.billSentForPaymentRows;
  if (mode === "expectedCashOutgoFy") return rows.expectedCashOutgoFyRows;
  if (mode === "spentTillDateFy") return rows.spentTillDateFyRows;
  if (mode === "billsPaidInMonth") return rows.billsPaidInMonthRows;
  if (mode === "currentMonthLiability") return rows.currentLiabilityRows;
  if (mode === "cashOutgoForMonth") return rows.cashOutgoForMonthRows;
  if (mode === "expectedExpenditureTillMonth") return rows.expectedExpenditureTillMonthRows;
  if (mode === "pendingReturnedBills") return rows.pendingReturnedBillRows;
  if (mode === "returnedBillsResubmitted") return rows.returnedBillResubmittedRows;
  if (mode === "returnedBillsPaid") return rows.returnedBillPaidRows;
  if (mode === "supplementaryBillsSubmitted") return rows.supplementaryBillSentForPaymentRows;
  if (mode === "supplementaryBillsPaid") return rows.supplementaryActualCashOutgoRows;
  if (mode === "supplementaryPendingReturnedBills") {
    return rows.supplementaryPendingReturnedBillRows;
  }
  if (mode === "supplementaryReturnedBillsResubmitted") {
    return rows.supplementaryReturnedBillResubmittedRows;
  }
  if (mode === "supplementaryReturnedBillsPaid") {
    return rows.supplementaryReturnedBillPaidRows;
  }
  return [];
}

function normalizeFirmDatabaseColumnKeys(value: unknown) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(firmDatabaseColumns.map((column) => column.key));
  const columns = value.filter(
    (item): item is FirmDatabaseColumnKey =>
      typeof item === "string" && allowed.has(item as FirmDatabaseColumnKey),
  );
  const withRequiredColumns = Array.from(new Set(["serial", "firmName", ...columns]));
  return firmDatabaseColumns
    .map((column) => column.key)
    .filter((key) => new Set(withRequiredColumns).has(key));
}

function isFirmDatabaseSortKey(value: unknown): value is FirmDatabaseSortKey {
  return (
    typeof value === "string" &&
    firmDatabaseColumns.some((column) => column.key === value && column.key !== "serial")
  );
}

function isHistoricalDateRangeReport(mode: ReportMode) {
  return (
    mode === "itemsDeliveredBillsPending" ||
    mode === "itemsDeliveredBillsPrepared" ||
    mode === "billsSubmitted" ||
    mode === "spentTillDateFy" ||
    mode === "pendingReturnedBills" ||
    mode === "returnedBillsResubmitted" ||
    mode === "returnedBillsPaid" ||
    mode === "supplementaryBillsSubmitted" ||
    mode === "supplementaryBillsPaid" ||
    mode === "supplementaryPendingReturnedBills" ||
    mode === "supplementaryReturnedBillsResubmitted" ||
    mode === "supplementaryReturnedBillsPaid"
  );
}

function isFileYearFilterDisabledReport(mode: ReportMode) {
  return (
    mode === "merData" ||
    mode === "merComparison" ||
    mode === "cashOutGoPlan" ||
    mode === "preSoExpectedCashOutgo"
  );
}

function isFileCategoryFilterDisabledReport(mode: ReportMode) {
  return mode === "merData";
}

function isOptionalCashOutgoDateFilterReport(mode: ReportMode) {
  return (
    mode === "itemsDeliveredBillsPending" ||
    mode === "itemsDeliveredBillsPrepared" ||
    mode === "billsSubmitted" ||
    mode === "pendingReturnedBills" ||
    mode === "returnedBillsResubmitted" ||
    mode === "returnedBillsPaid" ||
    mode === "supplementaryBillsSubmitted" ||
    mode === "supplementaryPendingReturnedBills" ||
    mode === "supplementaryReturnedBillsResubmitted" ||
    mode === "supplementaryReturnedBillsPaid"
  );
}

function isPendingBillingCashOutgoMode(mode: CashOutgoFilterMode) {
  return (
    mode === "expectedReceiptPendingBill" ||
    mode === "expectedReceiptPendingBillThrough" ||
    mode === "billPreparation" ||
    mode === "billPreparationThrough" ||
    mode === "billSent" ||
    mode === "billSentThrough" ||
    mode === "expectedDpThrough" ||
    mode === "supplementaryBillSent" ||
    mode === "pendingReturnedBills" ||
    mode === "returnedBillsResubmitted" ||
    mode === "supplementaryPendingReturnedBills" ||
    mode === "supplementaryReturnedBillsResubmitted"
  );
}

function isReturnedBillReportMode(
  mode: ReportMode,
): mode is Extract<CashOutgoFilterMode, ReportMode> {
  return (
    mode === "pendingReturnedBills" ||
    mode === "returnedBillsResubmitted" ||
    mode === "returnedBillsPaid" ||
    mode === "supplementaryPendingReturnedBills" ||
    mode === "supplementaryReturnedBillsResubmitted" ||
    mode === "supplementaryReturnedBillsPaid"
  );
}

function isReportScopeDateFilterReport(mode: ReportMode) {
  return mode === "mmgSummary" || mode === "demandProcessingAnalysis" || mode === "firmDatabase";
}

function getDateRangeHelperText(mode: ReportMode): HelperText {
  const commonPrefix =
    "First, the other filters choose the files. This date range then checks the event named above.";
  if (mode === "mmgSummary") {
    return ["The date range checks when the demand was received.", commonPrefix];
  }
  if (mode === "demandProcessingAnalysis") {
    return [
      "The date range checks the selected From date in Demand Processing Analysis.",
      commonPrefix,
    ];
  }
  if (mode === "firmDatabase") {
    return ["The date range checks when the S.O. was placed.", commonPrefix];
  }
  if (mode === "itemsDeliveredBillsPending") {
    return [
      "The date range checks the delivery, Job Completion, or D.P. date that applies to each row.",
      "The To date also sets the cutoff for bills that are still waiting to be prepared.",
      commonPrefix,
    ];
  }
  if (mode === "itemsDeliveredBillsPrepared") {
    return [
      "The date range checks when the bill was prepared.",
      "The To date also sets the cutoff for bills still waiting to be sent or paid.",
      commonPrefix,
    ];
  }
  if (mode === "billsSubmitted") {
    return [
      "The date range checks when the bill was sent or submitted.",
      "The To date also sets the cutoff for checking whether payment is still pending.",
      commonPrefix,
    ];
  }
  if (mode === "spentTillDateFy" || mode === "supplementaryBillsPaid") {
    return ["The date range checks when payment was made.", commonPrefix];
  }
  if (
    mode === "pendingReturnedBills" ||
    mode === "returnedBillsResubmitted" ||
    mode === "returnedBillsPaid"
  ) {
    return [
      "The date range checks the return, resubmission, or payment event shown by this report.",
      commonPrefix,
    ];
  }
  if (mode === "supplementaryBillsSubmitted") {
    return [
      "The date range checks when the supplementary bill was sent or resubmitted.",
      "The To date also sets the cutoff for checking pending payment.",
      commonPrefix,
    ];
  }
  if (
    mode === "supplementaryPendingReturnedBills" ||
    mode === "supplementaryReturnedBillsResubmitted" ||
    mode === "supplementaryReturnedBillsPaid"
  ) {
    return [
      "The date range checks the return, resubmission, or payment event shown in the report.",
      commonPrefix,
    ];
  }
  return ["The date range checks the main event date shown in this report.", commonPrefix];
}

function isMonthSelectionReport(mode: ReportMode) {
  return (
    mode === "currentMonthLiability" ||
    mode === "billsPaidInMonth" ||
    mode === "cashOutgoForMonth" ||
    mode === "expectedExpenditureTillMonth"
  );
}

function isAsOnDateReport(mode: ReportMode) {
  return mode === "pendingLiabilityAgeing";
}

function getEightReportTitle(
  mode: ReportMode,
  context: { today: string; monthKey: string; financialYear: string },
) {
  const asOnDate = formatDateTitle(context.today);
  const monthLabel = formatMonthTitle(context.monthKey);
  const fyLabel = displayFinancialYearLabel(context.financialYear);
  if (mode === "merData") return `MER Data for FY ${fyLabel}`;
  if (mode === "merComparison") return `MER vs Recorded Payments - FY ${fyLabel}`;
  if (mode === "soPaymentMatrix") return `Month-wise Payment due Matrix for FY ${fyLabel}`;
  if (mode === "paymentCompletedMatrix") {
    return `Month-wise Payment completed Matrix for FY ${fyLabel}`;
  }
  if (mode === "itemsDeliveredBillsPending") {
    return `Delivery / D.P. Done, Bill Preparation Pending as on ${asOnDate}`;
  }
  if (mode === "demandProcessingAnalysis") return "Demand processing analysis";
  if (mode === "itemsDeliveredBillsPrepared") {
    return `Delivery / D.P. Done, Bill Prepared as on ${asOnDate}`;
  }
  if (mode === "billsSubmitted") return `Bills Submitted, Payment Pending as on ${asOnDate}`;
  if (mode === "expectedCashOutgoFy") return `Expected Cash Outgo by D.P. for FY ${fyLabel}`;
  if (mode === "spentTillDateFy") {
    return `Actual Cash Outgo as on ${asOnDate}`;
  }
  if (mode === "billsPaidInMonth") return `Bills Paid in ${monthLabel}`;
  if (mode === "pendingReturnedBills") return `Pending returned bills as on ${asOnDate}`;
  if (mode === "returnedBillsResubmitted") return `Returned bills resubmitted and unpaid as on ${asOnDate}`;
  if (mode === "returnedBillsPaid") return `Returned bills paid as on ${asOnDate}`;
  if (mode === "supplementaryBillsSubmitted") {
    return `Supplementary bills submitted, payment pending as on ${asOnDate}`;
  }
  if (mode === "supplementaryBillsPaid") return `Supplementary bills paid as on ${asOnDate}`;
  if (mode === "supplementaryPendingReturnedBills") {
    return `Pending returned supplementary bills as on ${asOnDate}`;
  }
  if (mode === "supplementaryReturnedBillsResubmitted") {
    return `Returned supplementary bills resubmitted as on ${asOnDate}`;
  }
  if (mode === "supplementaryReturnedBillsPaid") {
    return `Returned supplementary bills paid as on ${asOnDate}`;
  }
  if (mode === "currentMonthLiability") {
    return `Cumulative Liability Up to ${monthLabel}`;
  }
  if (mode === "cashOutgoForMonth") return `Expected Cash Outgo in ${monthLabel}`;
  if (mode === "expectedExpenditureTillMonth") {
    return `Expected Expenditure Up to ${monthLabel}`;
  }
  if (mode === "monthlyFileInflow") return "Monthly file inflow";
  if (mode === "firmDatabase") return "Firm Performance";
  if (mode === "monthWiseSupplyOrder") return "Month-wise Supply Order";
  if (mode === "monthWiseDeliverySchedule")
    return "Month-wise Delivery / Contract Period Schedule";
  if (mode === "monthWiseCompletedDeliveries") {
    return "Month-wise completed deliveries / Job Completion";
  }
  if (mode === "monthWiseBgExpiry") return "Month-wise BG expiry";
  if (mode === "preBidMeetings") return "Pre-Bid Meetings";
  if (mode === "bgReceiptDelay") return "BG receipt delay";
  if (mode === "warrantyBgMismatch") return "Warranty / BG mismatch";
  if (mode === "delayStatus") return "Delay Status";
  if (mode === "pendingLiabilityAgeing") return `Pending Liabilities as on ${asOnDate}`;
  return "Delay status";
}

function getCashOutgoReportLogic(
  mode: ReportMode,
  context: { today: string; monthKey: string; financialYear: string },
) {
  const asOnDate = formatDateTitle(context.today);
  const monthLabel = formatMonthTitle(context.monthKey);
  if (mode === "itemsDeliveredBillsPending") {
    return "";
  }
  if (mode === "itemsDeliveredBillsPrepared") {
    return "";
  }
  if (mode === "billsSubmitted") {
    return "";
  }
  if (mode === "expectedCashOutgoFy") {
    return "";
  }
  if (mode === "spentTillDateFy") {
    return "Based on Cheque Slips";
  }
  if (mode === "billsPaidInMonth") {
    return "";
  }
  if (
    mode === "pendingReturnedBills" ||
    mode === "returnedBillsResubmitted" ||
    mode === "returnedBillsPaid" ||
    mode === "supplementaryPendingReturnedBills" ||
    mode === "supplementaryReturnedBillsResubmitted" ||
    mode === "supplementaryReturnedBillsPaid"
  ) {
    return "";
  }
  if (mode === "currentMonthLiability") {
    return "";
  }
  if (mode === "cashOutgoForMonth") {
    return [
      `- Bill prepared/Bills sent in ${monthLabel} and payment pending.`,
      `- Delivery/Job completion due in ${monthLabel}.`,
    ].join("\n");
  }
  if (mode === "expectedExpenditureTillMonth") {
    return [
      `- Actual Cash Outgo as on ${asOnDate} in FY ${displayFinancialYearLabel(context.financialYear)}.`,
      `- Delivery / D.P. Done, Bill Prepared up to ${monthLabel}.`,
      `- Bills Submitted, Payment Pending up to ${monthLabel}.`,
      `- Delivery / D.P. due up to ${monthLabel}.`,
    ].join("\n");
  }
  return "";
}

function getCashOutgoTitleHelper(mode: ReportMode): HelperText | undefined {
  if (mode === "soPaymentMatrix") return reportModeHelperText.soPaymentMatrix;
  if (mode === "paymentCompletedMatrix") return reportModeHelperText.paymentCompletedMatrix;
  if (mode in reportModeHelperText) {
    return (reportModeHelperText as Partial<Record<ReportMode, HelperText>>)[mode];
  }
  return (supplementaryBillInclusionNotes as Partial<Record<ReportMode, HelperText>>)[mode];
}

function getReportExportDescription(...items: Array<HelperText | undefined>) {
  return items.flatMap(flattenHelperText).filter(Boolean).join("\n");
}

function getReportsExportContextDescription({
  globalYear,
  fileYear,
  fileYearFilterDisabled,
  division,
  selectedFileCategories,
  visibleFileCategoryOptions,
  fileCategoryFilterDisabled,
  fileInitiationDateRange,
  reportMode,
  activeHistoricalDateRange,
  activeReportScopeDateRange,
  selectedCashOutgoMonth,
  asOnDate,
}: {
  globalYear: string;
  fileYear: string;
  fileYearFilterDisabled: boolean;
  division: string;
  selectedFileCategories: FileCategoryKey[];
  visibleFileCategoryOptions: FileCategoryOption[];
  fileCategoryFilterDisabled: boolean;
  fileInitiationDateRange?: FileInitiationDateRange;
  reportMode: ReportMode;
  activeHistoricalDateRange?: ReportDateRange;
  activeReportScopeDateRange?: ReportDateRange;
  selectedCashOutgoMonth: string;
  asOnDate: string;
}) {
  return [
    `Global Filter: ${displayFinancialYearLabel(globalYear)}`,
    `File Initiation Year subfilter: ${formatFileYearSubfilterExportLabel(
      globalYear,
      fileYear,
      fileYearFilterDisabled,
    )}`,
    `Initiation date range: ${
      fileYearFilterDisabled ? "Not applied" : formatExportDateRange(fileInitiationDateRange)
    }`,
    `Division: ${division === "all" ? "All accessible divisions" : division}`,
    `File Type: ${
      fileCategoryFilterDisabled
        ? "Not applied"
        : formatFileCategoryExportSelection(selectedFileCategories, visibleFileCategoryOptions)
    }`,
    getReportDateExportContext({
      reportMode,
      activeHistoricalDateRange,
      activeReportScopeDateRange,
      selectedCashOutgoMonth,
      asOnDate,
    }),
  ]
    .filter(Boolean)
    .join("\n");
}

function getReportsCombinedCashOutgoExportContextDescription({
  globalYear,
  fileYear,
  fileYearFilterDisabled,
  division,
  selectedFileCategories,
  visibleFileCategoryOptions,
  fileCategoryFilterDisabled,
  fileInitiationDateRange,
  activeHistoricalDateRange,
  selectedCashOutgoMonth,
  asOnDate,
}: {
  globalYear: string;
  fileYear: string;
  fileYearFilterDisabled: boolean;
  division: string;
  selectedFileCategories: FileCategoryKey[];
  visibleFileCategoryOptions: FileCategoryOption[];
  fileCategoryFilterDisabled: boolean;
  fileInitiationDateRange?: FileInitiationDateRange;
  activeHistoricalDateRange?: ReportDateRange;
  selectedCashOutgoMonth: string;
  asOnDate: string;
}) {
  return [
    `Global Filter: ${displayFinancialYearLabel(globalYear)}`,
    `File Initiation Year subfilter: ${formatFileYearSubfilterExportLabel(
      globalYear,
      fileYear,
      fileYearFilterDisabled,
    )}`,
    `Initiation date range: ${
      fileYearFilterDisabled ? "Not applied" : formatExportDateRange(fileInitiationDateRange)
    }`,
    `Division: ${division === "all" ? "All accessible divisions" : division}`,
    `File Type: ${
      fileCategoryFilterDisabled
        ? "Not applied"
        : formatFileCategoryExportSelection(selectedFileCategories, visibleFileCategoryOptions)
    }`,
    `As-on/date-range reports: ${formatExportDateRange(activeHistoricalDateRange)}`,
    `Month reports: ${
      selectedCashOutgoMonth === "all" ? "All months" : formatMonthTitle(selectedCashOutgoMonth)
    }`,
    `As on date: ${formatDateDisplay(asOnDate)}`,
  ].join("\n");
}

function formatExportDateRange(range?: ReportDateRange | FileInitiationDateRange) {
  if (!range) return "All dates";
  return `${formatDateDisplay(range.fromDate)} to ${formatDateDisplay(range.toDate)}`;
}

function formatFileCategoryExportSelection(
  selectedFileCategories: FileCategoryKey[],
  visibleFileCategoryOptions: FileCategoryOption[],
) {
  const visibleKeys = new Set(visibleFileCategoryOptions.map((option) => option.key));
  const selectedVisible = selectedFileCategories.filter((category) => visibleKeys.has(category));
  if (selectedVisible.length === visibleFileCategoryOptions.length) return "All visible categories";
  const labels = visibleFileCategoryOptions
    .filter((option) => selectedVisible.includes(option.key))
    .map((option) => option.label);
  return labels.length ? labels.join(", ") : "None selected";
}

function formatFileYearSubfilterExportLabel(
  globalYear: string,
  fileYear: string,
  disabled: boolean,
) {
  if (disabled) return "Not applied";
  if (fileYear !== "all") return fileYear;
  return isAllFilesYear(globalYear) ? "Entire database" : "All file years";
}

function getReportDateExportContext({
  reportMode,
  activeHistoricalDateRange,
  activeReportScopeDateRange,
  selectedCashOutgoMonth,
  asOnDate,
}: {
  reportMode: ReportMode;
  activeHistoricalDateRange?: ReportDateRange;
  activeReportScopeDateRange?: ReportDateRange;
  selectedCashOutgoMonth: string;
  asOnDate: string;
}) {
  if (isReportScopeDateFilterReport(reportMode)) {
    return `Report date range: ${formatExportDateRange(activeReportScopeDateRange)}`;
  }
  if (isHistoricalDateRangeReport(reportMode)) {
    return `Report date range: ${formatExportDateRange(activeHistoricalDateRange)}`;
  }
  if (isMonthSelectionReport(reportMode)) {
    return `Report month: ${
      selectedCashOutgoMonth === "all" ? "All months" : formatMonthTitle(selectedCashOutgoMonth)
    }`;
  }
  if (isAsOnDateReport(reportMode)) {
    return `As on date: ${formatDateDisplay(asOnDate)}`;
  }
  return "";
}

function getInlineMonthlyReportColumns(report: MonthlyReportConfig): MonthlyReportColumn[] {
  const yearColumns = report.yearColumns ?? report.columns;
  const monthColumns = new Map(report.columns.map((column) => [column.key, column]));
  return [
    { key: "periodLabel", label: "FY / Month", align: "left" },
    ...yearColumns.slice(1).map((yearColumn) => {
      const monthColumn = monthColumns.get(yearColumn.key);
      return {
        ...yearColumn,
        getFilter: (row: Record<string, number | string>) =>
          row.__displayKind === "month"
            ? monthColumn?.getFilter?.(row)
            : yearColumn.getFilter?.(row),
      };
    }),
  ];
}

function getInlineMonthlyReportRows(
  report: MonthlyReportConfig,
  expandedYears: string[],
): Array<Record<string, number | string>> {
  const expanded = new Set(expandedYears);
  const yearRows = report.yearRows ?? report.rows;
  const result: Array<Record<string, number | string>> = [];
  yearRows.forEach((row) => {
    const yearKey = String(row.yearKey ?? "");
    if (!/^\d{4}(?:-\d{2})?$/.test(yearKey)) {
      result.push({ ...row, periodLabel: String(row.year ?? "Total"), __displayKind: "total" });
      return;
    }
    const isExpanded = expanded.has(yearKey);
    result.push({
      ...row,
      periodLabel: yearKey,
      __displayKind: "year",
      __expanded: isExpanded ? 1 : 0,
    });
    if (isExpanded) {
      (report.monthRowsByYear?.[yearKey] ?? []).forEach((monthRow) => {
        result.push({
          ...monthRow,
          periodLabel: String(monthRow.month ?? monthRow.name ?? ""),
          __displayKind: "month",
          __yearKey: yearKey,
          __chartLabel: String(monthRow.month ?? monthRow.name ?? "").slice(0, 3),
          __fiscalYearLabel: formatFiscalYearChartTitle(yearKey),
        });
      });
    }
  });
  return result;
}

function getBillingPaymentReportDescription(
  mode: ReportMode,
  context: {
    activeHistoricalDateRange?: { fromDate: string; toDate: string };
    cashOutgoDateRangeFilter: boolean;
    globalYear: string;
  },
) {
  const basis =
    mode === "itemsDeliveredBillsPending"
      ? "Delivery/job completion done"
      : mode === "itemsDeliveredBillsPrepared"
        ? "Bill prepared"
        : mode === "billsSubmitted"
          ? "Bill sent for payment"
          : mode === "pendingReturnedBills"
            ? "Returned bill pending"
            : mode === "returnedBillsResubmitted"
              ? "Returned bill resubmitted and unpaid"
              : mode === "returnedBillsPaid"
                ? "Returned bill paid"
                : mode === "supplementaryBillsSubmitted"
                  ? "Supplementary bill sent/resubmitted"
                  : mode === "supplementaryBillsPaid"
                    ? "Supplementary bill paid"
                    : mode === "supplementaryPendingReturnedBills"
                      ? "Supplementary returned bill pending"
                      : mode === "supplementaryReturnedBillsResubmitted"
                        ? "Supplementary returned bill resubmitted"
                        : mode === "supplementaryReturnedBillsPaid"
                          ? "Supplementary returned bill paid"
                          : "";
  if (!basis) return "";
  const scope =
    context.cashOutgoDateRangeFilter && context.activeHistoricalDateRange
      ? `from ${formatDateDisplay(context.activeHistoricalDateRange.fromDate)} to ${formatDateDisplay(
          context.activeHistoricalDateRange.toDate,
        )}`
      : context.globalYear === ALL_FILES_YEAR
        ? "across all files in the global filter"
        : isAllActiveFilesYear(context.globalYear) ||
            isActivePlusCurrentFyClosedYear(context.globalYear)
          ? ""
          : "as per global filter";
  if (!scope) return "";
  const subfilterActive = context.cashOutgoDateRangeFilter;
  const activeOnlyNote =
    isActivePlusCurrentFyClosedYear(context.globalYear) && !subfilterActive
      ? " Pending billing/payment rows show active files only; closed files are monitored through anomaly control."
      : "";
  return `${basis} ${scope}.${activeOnlyNote}`;
}

function getMonthlyReportConfig(
  mode: ReportMode,
  summary: ReportsSummaryPayload | undefined,
): MonthlyReportConfig | undefined {
  if (!summary) return undefined;
  const monthLabelColumn: MonthlyReportColumn = { key: "month", label: "Month", align: "left" };
  if (mode === "monthlyFileInflow") {
    const columns: MonthlyReportColumn[] = [
      monthLabelColumn,
      {
        key: "count",
        label: "Files",
        align: "right",
        getFilter: (row) => `fileInflowMonth:${row.monthKey}`,
        getTotalFilter: (_rows, context) =>
          getYearDashboardFilter("fileInflowYear", "count", context.breakupYear ?? "all"),
      },
    ];
    const rows = summary.monthlyFileInflow.map(withMonthLabel);
    return {
      description: "",
      columns,
      rows,
      ...getFiscalYearDrilldownConfig(rows, columns, "fileInflowYear"),
    };
  }
  if (mode === "monthWiseSupplyOrder") {
    const columns: MonthlyReportColumn[] = [
      monthLabelColumn,
      {
        key: "count",
        label: "Supply Orders",
        align: "right",
        getFilter: (row) => `supplyOrderMonth:${row.monthKey}`,
        getTotalFilter: (_rows, context) =>
          getYearDashboardFilter("supplyOrderYear", "count", context.breakupYear ?? "all"),
      },
    ];
    const rows = summary.monthWiseSupplyOrder.map(withMonthLabel);
    return {
      description: "",
      columns,
      rows,
      ...getFiscalYearDrilldownConfig(rows, columns, "supplyOrderYear"),
    };
  }
  if (mode === "monthWiseDeliverySchedule") {
    const columns: MonthlyReportColumn[] = [
      monthLabelColumn,
      {
        key: "grossCount",
        label: "D.P./Contract period scheduled",
        align: "right",
        getFilter: (row) => `deliverySchedule:gross:${row.monthKey}`,
        getTotalFilter: (_rows, context) =>
          getYearDashboardFilter(
            "deliveryScheduleYear",
            "grossCount",
            context.breakupYear ?? "all",
          ),
      },
      {
        key: "netCount",
        label: "D.P./Contract period pending",
        align: "right",
        getFilter: (row) => `deliverySchedule:net:${row.monthKey}`,
        getTotalFilter: (_rows, context) =>
          getYearDashboardFilter("deliveryScheduleYear", "netCount", context.breakupYear ?? "all"),
      },
    ];
    const rows = summary.monthWiseDeliverySchedule.map(withMonthLabel);
    return {
      description: "",
      columns,
      rows,
      ...getFiscalYearDrilldownConfig(rows, columns, "deliveryScheduleYear"),
    };
  }
  if (mode === "monthWiseCompletedDeliveries") {
    const columns: MonthlyReportColumn[] = [
      monthLabelColumn,
      {
        key: "count",
        label: "Completed deliveries",
        align: "right",
        getFilter: (row) => `completedDeliveryMonth:${row.monthKey}`,
        getTotalFilter: (_rows, context) =>
          getYearDashboardFilter("completedDeliveryYear", "count", context.breakupYear ?? "all"),
      },
    ];
    const rows = summary.monthWiseCompletedDeliveries.map(withMonthLabel);
    return {
      description: "",
      columns,
      rows,
      ...getFiscalYearDrilldownConfig(rows, columns, "completedDeliveryYear"),
    };
  }
  if (mode === "monthWiseBgExpiry") {
    const columns: MonthlyReportColumn[] = [
      monthLabelColumn,
      {
        key: "count",
        label: "Total",
        align: "right",
        getFilter: (row) => `bgExpiryMonth:all:${row.monthKey}`,
        getTotalFilter: (_rows, context) =>
          getYearDashboardFilter("bgExpiryYear", "count", context.breakupYear ?? "all"),
      },
      {
        key: "psb",
        label: "PSB",
        align: "right",
        getFilter: (row) => `bgExpiryMonth:psb:${row.monthKey}`,
        getTotalFilter: (_rows, context) =>
          getYearDashboardFilter("bgExpiryYear", "psb", context.breakupYear ?? "all"),
      },
      {
        key: "pwb",
        label: "PWB",
        align: "right",
        getFilter: (row) => `bgExpiryMonth:pwb:${row.monthKey}`,
        getTotalFilter: (_rows, context) =>
          getYearDashboardFilter("bgExpiryYear", "pwb", context.breakupYear ?? "all"),
      },
      {
        key: "psbPwb",
        label: "PSB+PWB",
        align: "right",
        getFilter: (row) => `bgExpiryMonth:psbpwb:${row.monthKey}`,
        getTotalFilter: (_rows, context) =>
          getYearDashboardFilter("bgExpiryYear", "psbPwb", context.breakupYear ?? "all"),
      },
    ];
    const rows = summary.monthWiseBgExpiry.map(withMonthLabel);
    return {
      description: "BG validity dates expiring by month.",
      columns,
      rows,
      ...getFiscalYearDrilldownConfig(rows, columns, "bgExpiryYear"),
    };
  }
  if (mode === "preBidMeetings") {
    const columns: MonthlyReportColumn[] = [
      monthLabelColumn,
      {
        key: "count",
        label: "Total",
        align: "right",
        getFilter: (row) => `preBidMeeting:all:${row.monthKey}`,
        getTotalFilter: (_rows, context) =>
          getFiscalYearDashboardFilter("preBidMeetingFy", "count", context.breakupYear ?? "all"),
      },
      {
        key: "preBidDue",
        label: "Due",
        align: "right",
        getFilter: (row) => `preBidMeeting:due:${row.monthKey}`,
        getTotalFilter: (_rows, context) =>
          getFiscalYearDashboardFilter(
            "preBidMeetingFy",
            "preBidDue",
            context.breakupYear ?? "all",
          ),
      },
      {
        key: "preBidCompleted",
        label: "Completed",
        align: "right",
        getFilter: (row) => `preBidMeeting:completed:${row.monthKey}`,
        getTotalFilter: (_rows, context) =>
          getFiscalYearDashboardFilter(
            "preBidMeetingFy",
            "preBidCompleted",
            context.breakupYear ?? "all",
          ),
      },
      {
        key: "refloatPreBidDue",
        label: "Refloat Due",
        align: "right",
        getFilter: (row) => `refloatPreBidMeeting:due:${row.monthKey}`,
        getTotalFilter: (_rows, context) =>
          getFiscalYearDashboardFilter(
            "preBidMeetingFy",
            "refloatPreBidDue",
            context.breakupYear ?? "all",
          ),
      },
      {
        key: "refloatPreBidCompleted",
        label: "Refloat Completed",
        align: "right",
        getFilter: (row) => `refloatPreBidMeeting:completed:${row.monthKey}`,
        getTotalFilter: (_rows, context) =>
          getFiscalYearDashboardFilter(
            "preBidMeetingFy",
            "refloatPreBidCompleted",
            context.breakupYear ?? "all",
          ),
      },
    ];
    const rows = summary.preBidMeetingRows.map(withMonthLabel);
    return {
      description: [
        "- Month-wise Pre-Bid Meeting schedule.",
        "- When Global Filter is a specific FY, only Pre-Bid meeting dates inside that FY are counted. File Initiation Year can still narrow source files.",
        "- Dates before today: Completed.",
        "- Dates today or later: Due.",
      ].join("\n"),
      columns,
      rows,
      ...getFiscalYearDrilldownConfig(rows, columns, "preBidMeetingFy"),
    };
  }
  if (mode === "bgReceiptDelay") {
    return {
      description: [
        "- Counts applicable BG rows not received after configured days.",
        "- PSB and PSB+PWB: use S.O. date.",
        "- AMC/MPC/O&M warranty BGs: use S.O. date.",
        "- PWB only: uses Material Receipt Date / Job Completion Date as applicable.",
        "- Goods & Services IR No with staged delivery and no staged payment: starts after all stages are job-completed, using latest stage Job Completion Date.",
        "- Goods & Services IR No with staged payment: starts from the first completed payable stage, using earliest stage Job Completion Date.",
      ].join("\n"),
      columns: [
        { key: "label", label: "Delay", align: "left" },
        {
          key: "count",
          label: "Total",
          align: "right",
          getFilter: (row) => `bgReceiptDelay:all:${row.thresholdDays}`,
        },
        {
          key: "psb",
          label: "PSB",
          align: "right",
          getFilter: (row) => `bgReceiptDelay:psb:${row.thresholdDays}`,
        },
        {
          key: "pwb",
          label: "PWB",
          align: "right",
          getFilter: (row) => `bgReceiptDelay:pwb:${row.thresholdDays}`,
        },
        {
          key: "psbPwb",
          label: "PSB+PWB",
          align: "right",
          getFilter: (row) => `bgReceiptDelay:psbpwb:${row.thresholdDays}`,
        },
      ],
      rows: summary.bgReceiptDelayRows,
    };
  }
  if (mode === "warrantyBgMismatch") {
    return {
      description: [
        "- Counts active PWB/PSB+PWB rows.",
        "- Flags BG validity earlier than Warranty Period plus buffer days.",
      ].join("\n"),
      columns: [
        { key: "label", label: "Required cover", align: "left" },
        {
          key: "count",
          label: "Total",
          align: "right",
          getFilter: (row) => `warrantyBgMismatch:all:${row.bufferDays}`,
        },
        {
          key: "pwb",
          label: "PWB",
          align: "right",
          getFilter: (row) => `warrantyBgMismatch:pwb:${row.bufferDays}`,
        },
        {
          key: "psbPwb",
          label: "PSB+PWB",
          align: "right",
          getFilter: (row) => `warrantyBgMismatch:psbpwb:${row.bufferDays}`,
        },
      ],
      rows: summary.warrantyBgMismatchRows,
    };
  }
  return undefined;
}

function withMonthLabel(row: { name: string; monthKey: string } & Record<string, number | string>) {
  return { ...row, month: formatMonthTitle(row.monthKey || row.name) };
}

function getFiscalYearDrilldownConfig(
  monthRows: Array<Record<string, number | string>>,
  monthColumns: MonthlyReportColumn[],
  yearFilterPrefix: string,
): Pick<
  MonthlyReportConfig,
  "yearColumns" | "yearRows" | "monthRowsByYear" | "supportsYearDrilldown"
> {
  const numericColumns = monthColumns.filter((column) => column.key !== "month");
  const byYear = new Map<string, Array<Record<string, number | string>>>();
  monthRows.forEach((row) => {
    const monthKey = String(row.monthKey ?? "");
    const fiscalYear = getFiscalYearForMonthKey(monthKey);
    if (!fiscalYear) return;
    byYear.set(fiscalYear, [...(byYear.get(fiscalYear) ?? []), row]);
  });
  for (const [fiscalYear, rows] of byYear) {
    const startYear = Number(fiscalYear.slice(0, 4));
    const rowsByMonth = new Map(rows.map((row) => [String(row.monthKey ?? ""), row]));
    const completeMonths = Array.from({ length: 12 }, (_, index) => {
      const monthNumber = ((3 + index) % 12) + 1;
      const year = startYear + Math.floor((3 + index) / 12);
      const monthKey = `${year}-${String(monthNumber).padStart(2, "0")}`;
      const existing = rowsByMonth.get(monthKey);
      if (existing) return existing;
      const emptyRow: Record<string, number | string> = {
        name: monthKey,
        monthKey,
        month: formatMonthTitle(monthKey),
      };
      numericColumns.forEach((column) => {
        emptyRow[column.key] = 0;
      });
      return emptyRow;
    });
    byYear.set(fiscalYear, completeMonths);
  }
  const yearRows = Array.from(byYear.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, rows]) => {
      const row: Record<string, number | string> = {
        year,
        yearKey: year,
        monthKey: year,
      };
      numericColumns.forEach((column) => {
        row[column.key] = rows.reduce((sum, item) => sum + readNumericCell(item[column.key]), 0);
      });
      return row;
    });
  if (yearRows.length) {
    const totalRow: Record<string, number | string> = {
      year: "Total",
      yearKey: "all",
      monthKey: "all",
    };
    numericColumns.forEach((column) => {
      totalRow[column.key] = yearRows.reduce(
        (sum, row) => sum + readNumericCell(row[column.key]),
        0,
      );
    });
    yearRows.push(totalRow);
  }
  const yearColumns: MonthlyReportColumn[] = [
    { key: "year", label: "FY", align: "left" },
    ...numericColumns.map((column) => ({
      ...column,
      getFilter: (row: Record<string, number | string>) =>
        getFiscalYearDashboardFilter(yearFilterPrefix, column.key, String(row.yearKey ?? "")),
    })),
  ];
  return {
    supportsYearDrilldown: true,
    yearColumns,
    yearRows,
    monthRowsByYear: Object.fromEntries(byYear.entries()),
  };
}

function getYearDashboardFilter(prefix: string, columnKey: string, yearKey: string) {
  if (!yearKey) return undefined;
  if (prefix === "deliveryScheduleYear") {
    const mode = columnKey === "netCount" ? "net" : "gross";
    return `deliveryScheduleYear:${mode}:${yearKey}`;
  }
  if (prefix === "bgExpiryYear") {
    const category = columnKey === "count" ? "all" : columnKey === "psbPwb" ? "psbpwb" : columnKey;
    return `bgExpiryYear:${category}:${yearKey}`;
  }
  return `${prefix}:${yearKey}`;
}

function getFiscalYearDashboardFilter(prefix: string, columnKey: string, yearKey: string) {
  if (prefix !== "preBidMeetingFy") {
    return getYearDashboardFilter(prefix, columnKey, yearKey);
  }
  if (yearKey === "all") {
    const allFilterByColumn: Record<string, string> = {
      count: "preBidMeeting:all",
      preBidDue: "preBidMeeting:due",
      preBidCompleted: "preBidMeeting:completed",
      refloatPreBidDue: "refloatPreBidMeeting:due",
      refloatPreBidCompleted: "refloatPreBidMeeting:completed",
    };
    return allFilterByColumn[columnKey];
  }
  if (!/^\d{4}-\d{2}$/.test(yearKey)) return undefined;
  const filterByColumn: Record<string, string> = {
    count: `preBidMeetingFy:all:${yearKey}`,
    preBidDue: `preBidMeetingFy:due:${yearKey}`,
    preBidCompleted: `preBidMeetingFy:completed:${yearKey}`,
    refloatPreBidDue: `refloatPreBidMeetingFy:due:${yearKey}`,
    refloatPreBidCompleted: `refloatPreBidMeetingFy:completed:${yearKey}`,
  };
  return filterByColumn[columnKey];
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

function formatFiscalYearChartTitle(yearKey: string) {
  const match = yearKey.match(/^(\d{4})-(\d{2})$/);
  return match ? `FY ${match[1]} - ${match[2]}` : yearKey;
}

function readNumericCell(value: number | string | undefined) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

type DemandProcessingStats = {
  count: number;
  unitCount: number;
  fileCount: number;
  average: number;
  median: number;
  min: number;
  max: number;
  negative: number;
  negativeFileCount: number;
};
type DemandProcessingAnalysisUnit = "demand" | "order" | "stage" | "advance" | "bill";
const hiddenDemandProcessingDateFieldIds = new Set([
  "order.billPreparationDate",
  "order.billSentForPaymentDate",
  "order.paymentDate",
  "stage.billPreparationDate",
  "stage.billSentForPaymentDate",
  "stage.paymentDate",
  "advance.billPreparationDate",
  "advance.billSentForPaymentDate",
  "advance.paymentDate",
]);
const demandProcessingStageFieldScopes = new Set(["stage"]);
const demandProcessingAdvanceFieldScopes = new Set(["advance"]);
const demandProcessingReverseFieldPairs = new Set(
  [
    ["file.ifaFinalDate", "file.ifaSentDate"],
    ["file.cfaDate", "file.cfaSentDate"],
    ["file.cncApprovalDate", "file.cncDate"],
    ["file.preTcecMinutesDate", "file.preTcecDate"],
    ["file.postTcecMinutesDate", "file.postTcecDate"],
    ["file.refloatPostTcecMinutesDate", "file.refloatPostTcecDate"],
    ["order.irReceiptDate", "order.irPreparationDate"],
    ["order.psbBgReturnDate", "order.psbBgReceivedDate"],
    ["order.pwbBgReturnDate", "order.pwbBgReceivedDate"],
    ["order.combinedBgReturnDate", "order.combinedBgReceivedDate"],
    ["payment.unifiedPaymentDate", "payment.unifiedSubmissionDate"],
    ["payment.unifiedPaymentDate", "payment.unifiedReturnDate"],
  ].map(([from, to]) => `${from}→${to}`),
);
const demandProcessingFieldOrderRank = new Map<string, number>(
  [
    ["file.receivedDate", 10],
    ["file.scrutinyDate", 20],
    ["file.scrutinyResponseDate", 30],
    ["file.scrutinyCompletionDate", 40],
    ["file.immsDate", 50],
    ["file.highValueMeetingDate", 60],
    ["file.highValueMinutesDate", 70],
    ["file.adSentDate", 80],
    ["file.adVettingDate", 90],
    ["file.rqaSentDate", 100],
    ["file.rqaApprovalDate", 110],
    ["file.ifaSentDate", 120],
    ["file.ifaFinalDate", 130],
    ["file.cfaSentDate", 140],
    ["file.cfaDate", 150],
    ["file.gemUndertakingDate", 160],
    ["file.rfpVettingInitiationDate", 170],
    ["file.rfpVettingApprovalDate", 180],
    ["file.bidDate", 190],
    ["file.bidOpeningDate", 200],
    ["file.refloatBiddingDate", 210],
    ["file.refloatBidOpeningDate", 220],
    ["file.preTcecDate", 230],
    ["file.preTcecMinutesDate", 240],
    ["file.postTcecDate", 250],
    ["file.postTcecMinutesDate", 260],
    ["file.refloatPostTcecDate", 270],
    ["file.refloatPostTcecMinutesDate", 280],
    ["file.cncDate", 290],
    ["file.cncApprovalDate", 300],
    ["order.financialSanctionDate", 310],
    ["order.soDate", 320],
    ["order.dpDate", 330],
    ["order.revisedDp", 340],
    ["stage.deliveryPeriodStartDate", 350],
    ["stage.dpDate", 360],
    ["stage.revisedDp", 370],
    ["order.materialReceiptDate", 380],
    ["stage.materialReceiptDate", 380],
    ["order.jobCompletionDate", 390],
    ["stage.jobCompletionDate", 390],
    ["order.irPreparationDate", 400],
    ["stage.irPreparationDate", 400],
    ["order.irReceiptDate", 410],
    ["stage.irReceiptDate", 410],
    ["order.psbBgReceivedDate", 420],
    ["order.pwbBgReceivedDate", 420],
    ["order.combinedBgReceivedDate", 420],
    ["order.psbBgValidityDate", 430],
    ["order.pwbBgValidityDate", 430],
    ["order.combinedBgValidityDate", 430],
    ["payment.unifiedSubmissionDate", 440],
    ["payment.unifiedReturnDate", 450],
    ["payment.unifiedPaymentDate", 460],
    ["order.psbBgReturnDate", 470],
    ["order.pwbBgReturnDate", 470],
    ["order.combinedBgReturnDate", 470],
    ["order.soCancelledDate", 480],
    ["file.demandCancelledDate", 490],
  ],
);
type DemandProcessingRangeRow = {
  id: string;
  label: string;
  minDays?: number;
  maxDays?: number;
  count: number;
  valueCapital: number;
  valueRevenue: number;
  fileIds: string[];
};

type DemandProcessingFilterType = "date" | "text" | "select" | "yesNo" | "amount";
type DemandProcessingFilterCondition =
  | "filled"
  | "blank"
  | "equals"
  | "notEquals"
  | "contains"
  | "onOrAfter"
  | "onOrBefore"
  | "between"
  | "greaterThan"
  | "lessThan";
type DemandProcessingFilterRow = {
  id: string;
  fieldId: string;
  condition: DemandProcessingFilterCondition;
  value: string;
  valueTo: string;
};
type DemandProcessingFilterField = {
  id: string;
  label: string;
  group: string;
  type: DemandProcessingFilterType;
  options?: string[];
  getValue: (context: DemandProcessingRowContext) => string | number | undefined;
};
type DemandProcessingRowContext = {
  row: DemandProcessingAnalysisRow;
  file: FileRecord;
  order?: SupplyOrderDetail;
  stage?: StageDeliveryDetail;
};

function getDemandProcessingExtraFilterFields({
  settings,
  divisions,
  files,
}: {
  settings: ReturnType<typeof useSettings>;
  divisions: Division[];
  files: FileRecord[];
}): DemandProcessingFilterField[] {
  const fileTypeOptions = uniqueOptions(settings.fileTypes, [
    "Goods & Services",
    "AMC",
    "MPC",
    "CARS",
    "O&M",
  ]);
  const modeOptions = uniqueOptions(settings.modes, ["OBM", "PBM", "SBM", "LBM", "LPC"]);
  const firmTypeOptions = uniqueOptions(settings.firmTypes, ["MSE", "MSE (Women)", "Non-MSE"]);
  const divisionOptions = uniqueOptions(divisions.map((division) => division.name));
  const indentorOptions = uniqueOptions(files.map((file) => file.indentor));
  return [
    {
      id: "file.fileType",
      label: "File type",
      group: "File details",
      type: "select",
      options: fileTypeOptions,
      getValue: ({ file }) => file.fileType || "Goods & Services",
    },
    {
      id: "file.division",
      label: "Division",
      group: "File details",
      type: "select",
      options: divisionOptions,
      getValue: ({ file }) => file.division,
    },
    {
      id: "file.indentor",
      label: "Indentor",
      group: "File details",
      type: "select",
      options: indentorOptions,
      getValue: ({ file }) => file.indentor,
    },
    {
      id: "file.demandDescription",
      label: "Demand description",
      group: "File details",
      type: "text",
      getValue: ({ file }) => getDescriptionWithUniqueCode(file),
    },
    {
      id: "file.mode",
      label: "Bidding type",
      group: "File details",
      type: "select",
      options: modeOptions,
      getValue: ({ file }) => file.mode,
    },
    {
      id: "file.valueCapital",
      label: "Demand value capital",
      group: "File details",
      type: "amount",
      getValue: ({ file }) => file.valueCapital,
    },
    {
      id: "file.valueRevenue",
      label: "Demand value revenue",
      group: "File details",
      type: "amount",
      getValue: ({ file }) => file.valueRevenue,
    },
    {
      id: "file.tcec",
      label: "TCEC",
      group: "Attributes",
      type: "yesNo",
      getValue: ({ file }) => file.tcec,
    },
    {
      id: "file.gem",
      label: "GeM",
      group: "Attributes",
      type: "yesNo",
      getValue: ({ file }) => file.gem,
    },
    {
      id: "file.highValue",
      label: "High Value",
      group: "Attributes",
      type: "yesNo",
      getValue: ({ file }) => file.highValue,
    },
    {
      id: "file.ad",
      label: "AD",
      group: "Attributes",
      type: "yesNo",
      getValue: ({ file }) => file.ad,
    },
    {
      id: "file.rqa",
      label: "R&QA",
      group: "Attributes",
      type: "yesNo",
      getValue: ({ file }) => file.rqa,
    },
    {
      id: "file.ifa",
      label: "IFA",
      group: "Attributes",
      type: "yesNo",
      getValue: ({ file }) => file.ifa,
    },
    {
      id: "file.bg",
      label: "Warranty",
      group: "Attributes",
      type: "yesNo",
      getValue: ({ file }) => file.bg,
    },
    {
      id: "file.ir",
      label: "IR",
      group: "Attributes",
      type: "yesNo",
      getValue: ({ file }) => file.ir,
    },
    {
      id: "file.rfpVetting",
      label: "RFP vetting",
      group: "Attributes",
      type: "yesNo",
      getValue: ({ file }) => file.rfpVetting,
    },
    {
      id: "order.soNo",
      label: "S.O. No.",
      group: "Supply Order",
      type: "text",
      getValue: ({ order }) => order?.soNo,
    },
    {
      id: "order.firm",
      label: "Firm",
      group: "Supply Order",
      type: "text",
      getValue: ({ order }) => order?.firm,
    },
    {
      id: "order.firmType",
      label: "Firm type",
      group: "Supply Order",
      type: "select",
      options: firmTypeOptions,
      getValue: ({ order }) => order?.firmType,
    },
    {
      id: "order.soValueCapital",
      label: "S.O. value capital",
      group: "Supply Order",
      type: "amount",
      getValue: ({ order }) => order?.soValueCapital,
    },
    {
      id: "order.soValueRevenue",
      label: "S.O. value revenue",
      group: "Supply Order",
      type: "amount",
      getValue: ({ order }) => order?.soValueRevenue,
    },
    {
      id: "order.psbApplicable",
      label: "PSB applicable",
      group: "Security/Warranty BG",
      type: "yesNo",
      getValue: ({ order }) => order?.psbApplicable,
    },
    {
      id: "order.bgCoverageType",
      label: "BG coverage type",
      group: "Security/Warranty BG",
      type: "select",
      options: ["None", "PSB", "PWB", "PSB+PWB", "PSB and PWB separately"],
      getValue: ({ order }) => order?.bgCoverageType,
    },
    {
      id: "order.warrantyPeriodDate",
      label: "Warranty period",
      group: "Security/Warranty BG",
      type: "date",
      getValue: ({ order }) => order?.warrantyPeriodDate,
    },
    {
      id: "order.stageDelivery",
      label: "Stage delivery",
      group: "Supply Order",
      type: "yesNo",
      getValue: ({ order }) => order?.stageDelivery,
    },
    {
      id: "order.stagePayment",
      label: "Stage payment",
      group: "Supply Order",
      type: "yesNo",
      getValue: ({ order }) => order?.stagePayment,
    },
    {
      id: "order.advancePayment",
      label: "Advance payment",
      group: "Supply Order",
      type: "yesNo",
      getValue: ({ order }) => order?.advancePayment,
    },
    {
      id: "order.dpExtension",
      label: "D.P. extension",
      group: "Delivery Period",
      type: "yesNo",
      getValue: ({ order }) => order?.dpExtension,
    },
    {
      id: "order.ld",
      label: "LD",
      group: "Delivery Period",
      type: "yesNo",
      getValue: ({ order }) => order?.ld,
    },
    {
      id: "payment.unifiedPaymentMode",
      label: "Unified payment mode",
      group: "Bill / Payment",
      type: "select",
      options: ["Online", "Offline"],
      getValue: ({ row, order, stage }) =>
        row.paymentMode || stage?.paymentMode || order?.paymentMode,
    },
  ];
}

function getDemandProcessingFilterFields(context: {
  settings: ReturnType<typeof useSettings>;
  divisions: Division[];
  files: FileRecord[];
}): DemandProcessingFilterField[] {
  return [
    ...demandProcessingDateFields.map(
      (field): DemandProcessingFilterField => ({
        id: field.id,
        label: field.label,
        group: field.group,
        type: "date",
        getValue: ({ file, order, stage }) => field.getValue(file, order, stage),
      }),
    ),
    ...getDemandProcessingExtraFilterFields(context),
  ];
}

function uniqueOptions(values: Array<string | undefined>, fallback: string[] = []) {
  const seen = new Set<string>();
  return [...values, ...fallback]
    .map((value) => String(value ?? "").trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function createDemandProcessingFilterRow(
  filterFields: DemandProcessingFilterField[],
): DemandProcessingFilterRow {
  const field = filterFields[0];
  return {
    id: `filter-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    fieldId: field.id,
    condition: getDefaultDemandProcessingCondition(field),
    value: "",
    valueTo: "",
  };
}

function getDemandProcessingFilterField(
  fieldId: string,
  filterFields: DemandProcessingFilterField[],
) {
  return filterFields.find((field) => field.id === fieldId) ?? filterFields[0];
}

function getDefaultDemandProcessingCondition(field: DemandProcessingFilterField | undefined) {
  if (field?.type === "date" || field?.type === "amount") return "between" as const;
  if (field?.type === "yesNo") return "equals" as const;
  return "equals" as const;
}

function getDemandProcessingFilterGroups(filterFields: DemandProcessingFilterField[]) {
  const groups = new Map<string, DemandProcessingFilterField[]>();
  filterFields.forEach((field) => {
    groups.set(field.group, [...(groups.get(field.group) ?? []), field]);
  });
  return Array.from(groups, ([title, fields]) => ({ title, fields }));
}

function filterDemandProcessingRows(
  rows: DemandProcessingAnalysisRow[],
  files: FileRecord[],
  filters: DemandProcessingFilterRow[],
  filterFields: DemandProcessingFilterField[],
) {
  const activeFilters = filters.filter((filter) =>
    getDemandProcessingFilterField(filter.fieldId, filterFields),
  );
  if (!activeFilters.length) return rows;
  return rows.filter((row) => {
    const context = getDemandProcessingRowContext(row, files);
    if (!context) return false;
    return activeFilters.every((filter) =>
      isDemandProcessingFilterMatch(context, filter, filterFields),
    );
  });
}

function filterDemandProcessingRowsByFromDate(
  rows: DemandProcessingAnalysisRow[],
  range: ReportDateRange | undefined,
) {
  if (!range) return rows;
  return rows.filter((row) => isReportDateWithinRange(row.fromDate, range));
}

function getDemandProcessingRowContext(
  row: DemandProcessingAnalysisRow,
  files: FileRecord[],
): DemandProcessingRowContext | undefined {
  const file = files.find((item) => item.id === row.fileId);
  if (!file) return undefined;
  const order = row.orderIndex === undefined ? undefined : file.supplyOrders?.[row.orderIndex];
  const stage =
    row.stageIndex === undefined || !order ? undefined : order.stageDeliveries?.[row.stageIndex];
  return { row, file, order, stage };
}

function isDemandProcessingFilterMatch(
  context: DemandProcessingRowContext,
  filter: DemandProcessingFilterRow,
  filterFields: DemandProcessingFilterField[],
) {
  const field = getDemandProcessingFilterField(filter.fieldId, filterFields);
  const rawValue = field.getValue(context);
  const textValue = String(rawValue ?? "").trim();
  const normalized = textValue.toLowerCase();
  const value = filter.value.trim();
  const valueTo = filter.valueTo.trim();
  if (filter.condition === "filled") return Boolean(textValue);
  if (filter.condition === "blank") return !textValue;
  if (field.type === "date") {
    if (!isIsoDate(textValue)) return false;
    if (filter.condition === "between") {
      return (!value || textValue >= value) && (!valueTo || textValue <= valueTo);
    }
    if (filter.condition === "onOrAfter") return Boolean(value) && textValue >= value;
    if (filter.condition === "onOrBefore") return Boolean(value) && textValue <= value;
    if (filter.condition === "equals") return Boolean(value) && textValue === value;
    if (filter.condition === "notEquals") return Boolean(value) && textValue !== value;
    return false;
  }
  if (field.type === "amount") {
    const amount = parseNumberValue(textValue);
    const from = parseNumberValue(value);
    const to = parseNumberValue(valueTo);
    if (amount === undefined) return false;
    if (filter.condition === "between") {
      return (from === undefined || amount >= from) && (to === undefined || amount <= to);
    }
    if (filter.condition === "greaterThan") return from !== undefined && amount > from;
    if (filter.condition === "lessThan") return from !== undefined && amount < from;
    if (filter.condition === "equals") return from !== undefined && amount === from;
    if (filter.condition === "notEquals") return from !== undefined && amount !== from;
    return false;
  }
  if (field.type === "yesNo") {
    const desired = value.toLowerCase();
    if (filter.condition === "equals") return desired ? normalized === desired : true;
    if (filter.condition === "notEquals") return desired ? normalized !== desired : true;
    return false;
  }
  if (filter.condition === "contains") return normalized.includes(value.toLowerCase());
  if (filter.condition === "equals") return normalized === value.toLowerCase();
  if (filter.condition === "notEquals") return normalized !== value.toLowerCase();
  return false;
}

function parseNumberValue(value: string) {
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isIsoDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function DemandProcessingAnalysisReport({
  title,
  presets,
  selectedPresetId,
  fromFieldId,
  toFieldId,
  paymentMode,
  rows,
  stats,
  rangeRows,
  analysisUnit,
  exportDescription,
  filters,
  filterFields,
  actions,
  onPresetChange,
  onFromFieldChange,
  onToFieldChange,
  onResetDateFields,
  onPaymentModeChange,
  onAddFilter,
  onUpdateFilter,
  onRemoveFilter,
  onResetFilters,
  onOpenUsed,
  onOpenReverse,
  onOpenRange,
}: {
  title: string;
  presets: ReturnType<typeof getDemandProcessingPresets>;
  selectedPresetId: string;
  fromFieldId: string;
  toFieldId: string;
  paymentMode: string;
  rows: DemandProcessingAnalysisRow[];
  stats: DemandProcessingStats;
  rangeRows: DemandProcessingRangeRow[];
  analysisUnit: DemandProcessingAnalysisUnit;
  exportDescription: string;
  filters: DemandProcessingFilterRow[];
  filterFields: DemandProcessingFilterField[];
  actions?: ReactNode;
  onPresetChange: (presetId: string) => void;
  onFromFieldChange: (fieldId: string) => void;
  onToFieldChange: (fieldId: string) => void;
  onResetDateFields: () => void;
  onPaymentModeChange: (paymentMode: string) => void;
  onAddFilter: () => void;
  onUpdateFilter: (id: string, patch: Partial<Omit<DemandProcessingFilterRow, "id">>) => void;
  onRemoveFilter: (id: string) => void;
  onResetFilters: () => void;
  onOpenUsed: () => void;
  onOpenReverse: () => void;
  onOpenRange: (row: DemandProcessingRangeRow) => void;
}) {
  const fromField = getDemandProcessingField(fromFieldId);
  const toField = getDemandProcessingField(toFieldId);
  const [rangeChartExportPlot, setRangeChartExportPlot] = useState<ExportPlot | undefined>();
  const exportAnalysis = (format: "pdf" | "excel") => {
    void downloadBackendExport({
      format,
      title,
      description: exportDescription,
      plot: rangeChartExportPlot,
      tables: [
        {
          title: "Analysis summary",
          headers: ["Measure", "Value"],
          rows: [
            [analysisUnit === "bill" ? "Bill/payment count" : "Matched records", stats.count],
            ["File count", stats.fileCount],
            ["Average days", formatGapNumber(stats.average)],
            ["Median days", formatGapNumber(stats.median)],
            ["Minimum days", formatGapNumber(stats.min)],
            ["Maximum days", formatGapNumber(stats.max)],
            ["Negative results", stats.negative],
            ["Files with negative results", stats.negativeFileCount],
          ],
        },
        {
          title: getAnalysisUnitBucketTitle(analysisUnit),
          headers: ["Day range", "Count", "Capital", "Revenue"],
          rows: rangeRows.map((row) => [
            row.label,
            row.count,
            formatLakhValue(row.valueCapital),
            formatLakhValue(row.valueRevenue),
          ]),
        },
      ],
    });
  };
  useEffect(() => {
    if (
      isDemandProcessingFieldCompatible({
        candidateFieldId: toFieldId,
        selectedOtherFieldId: fromFieldId,
        side: "to",
      })
    ) {
      return;
    }
    const replacementToFieldId = getFirstCompatibleDemandProcessingFieldId({
      selectedOtherFieldId: fromFieldId,
      side: "to",
    });
    if (replacementToFieldId && replacementToFieldId !== toFieldId) {
      onToFieldChange(replacementToFieldId);
    }
  }, [fromFieldId, onToFieldChange, toFieldId]);
  return (
    <div className="rounded-md border border-border bg-card shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Date gaps use the selected record level; payment-event pairs count each bill once.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => exportAnalysis("pdf")}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent"
          >
            <FileText className="size-4" />
            PDF
          </button>
          <button
            type="button"
            onClick={() => exportAnalysis("excel")}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent"
          >
            <FileSpreadsheet className="size-4" />
            Excel
          </button>
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-accent"
              >
                <Info className="size-4" />
                Analysis guide
              </button>
            </DialogTrigger>
            <DialogContent className="max-h-[88vh] w-[min(56rem,calc(100vw-1rem))] max-w-[96vw] gap-0 overflow-hidden p-0">
              <DialogHeader className="border-b border-border px-5 py-4 pr-12">
                <DialogTitle className="text-lg">How Demand Processing Analysis counts dates</DialogTitle>
                <DialogDescription className="mt-1 text-[13px] leading-6">
                  The selected date pair determines the observation being measured. Both dates must be present.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[calc(88vh-6rem)] space-y-3 overflow-y-auto px-5 py-4 text-[13px] leading-6 text-foreground">
                <section className="rounded-md border border-primary/15 bg-primary/5 p-4">
                  <h3 className="font-semibold">Payment timing</h3>
                  <p>
                    For a returned bill, the report uses the last resubmission date before final payment. If the bill
                    was never returned, it uses the original bill-sent date. The bill contributes one duration, even
                    if it had several return cycles.
                  </p>
                </section>
                <section className="rounded-md border border-primary/15 bg-primary/5 p-4">
                  <h3 className="font-semibold">What counts as one bill</h3>
                  <p>
                    A regular S.O. bill, each stage bill, an advance payment, and each supplementary bill are separate
                    observations. Different bills under one S.O. are not combined. File count is still the number of
                    unique files, so it can be lower than the bill/payment count.
                  </p>
                </section>
                <section className="rounded-md border border-primary/15 bg-primary/5 p-4">
                  <h3 className="font-semibold">Example</h3>
                  <p>
                    A stage bill is submitted on 1 May, returned on 5 May, resubmitted on 8 May, returned again on
                    12 May, resubmitted on 15 May, and paid on 20 May. Its payment duration is counted once: 15 May
                    to 20 May = 5 days. The earlier attempts do not reuse the same final payment date.
                  </p>
                </section>
                <section className="rounded-md border border-primary/15 bg-primary/5 p-4">
                  <h3 className="font-semibold">Averages and day ranges</h3>
                  <p>
                    Averages and day-range buckets use the same observations. For example, if one S.O. has an advance
                    paid in 10 days and two stage bills paid in 20 and 75 days, the report counts three observations:
                    two in 0–30 days and one in 61–90 days. A file clicker opens unique files, not duplicate rows.
                  </p>
                </section>
                <section className="rounded-md border border-primary/15 bg-primary/5 p-4">
                  <h3 className="font-semibold">Negative results</h3>
                  <p>
                    If the selected To date is earlier than the From date, the result is shown as negative and left
                    out of average, median, minimum, maximum, and day-range buckets.
                  </p>
                </section>
              </div>
            </DialogContent>
          </Dialog>
          {actions}
        </div>
      </div>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[320px_minmax(0,1fr)_minmax(0,1fr)_190px]">
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>Preset</span>
            <select
              value={selectedPresetId}
              onChange={(event) => onPresetChange(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="">Custom selection</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {getDemandProcessingPresetPairLabel(preset)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onResetDateFields}
              className="h-8 rounded-md border border-border bg-secondary/40 px-2.5 text-xs font-medium text-foreground transition hover:bg-secondary"
            >
              Reset From/To fields
            </button>
          </div>
          <DemandDateFieldSelector
            label="From date"
            value={fromFieldId}
            otherValue={toFieldId}
            side="from"
            onChange={onFromFieldChange}
            onReset={() => onFromFieldChange("")}
          />
          <DemandDateFieldSelector
            label="To date"
            value={toFieldId}
            otherValue={fromFieldId}
            side="to"
            onChange={onToFieldChange}
            onReset={() => onToFieldChange("")}
          />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              Payment mode
              <FloatingHelper
                text={[
                  "Choose Online or Offline to limit unified payment events to that payment mode.",
                  "Any includes both modes, including events with no mode recorded.",
                ]}
                label="Demand processing payment mode help"
                className="size-5 border-0 bg-transparent shadow-none"
                iconClassName="size-3"
              />
            </span>
            <select
              value={paymentMode}
              onChange={(event) => onPaymentModeChange(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="">Any</option>
              <option value="Online">Online</option>
              <option value="Offline">Offline</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
          <DemandMetric
            label={analysisUnit === "bill" ? "Bill/payment count" : "Matched records"}
            value={stats.count}
            helperText={[
              analysisUnit === "bill"
                ? "Each regular, stage, advance, or supplementary bill contributes at most one observation for the selected date pair."
                : "Counts matching date-pair observations, not unique files.",
              "Both dates must be filled. Negative gaps are shown separately.",
            ]}
          />
          <DemandMetric
            label="File count"
            value={stats.fileCount}
            onClick={onOpenUsed}
            helperText={[
              `${getAnalysisUnitCountLabel(analysisUnit)} can exceed file count when a file has multiple matching observations.`,
              "Click to open the matching unique files in Search.",
            ]}
          />
          <DemandMetric label="Average days" value={formatGapNumber(stats.average)} />
          <DemandMetric label="Median days" value={formatGapNumber(stats.median)} />
          <DemandMetric label="Minimum" value={formatGapNumber(stats.min)} />
          <DemandMetric label="Maximum" value={formatGapNumber(stats.max)} />
          <DemandMetric
            label="Negative results"
            value={stats.negativeFileCount}
            onClick={stats.negativeFileCount ? onOpenReverse : undefined}
            helperText={[
              "These are unique files with at least one result where the selected To date is earlier than the selected From date.",
              "They can happen even for logically correct pairs, for example delivery completed before D.P. date.",
              "Negative results are excluded from average, median, minimum, and maximum days.",
              "This tile shows unique file count because the clicker opens matching files in Search.",
            ]}
          />
        </div>

        <DemandProcessingRangeSummary
          rows={rangeRows}
          analysisUnit={analysisUnit}
          onPlotChange={setRangeChartExportPlot}
          onOpenRange={onOpenRange}
        />

        <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
          Basis: {analysisUnit === "bill" ? "bill/payment-wise" : getAnalysisBasisLabel(fromField?.scope, toField?.scope)}. Selected gap:{" "}
          <span className="font-medium text-foreground">{fromField?.label ?? "From date"}</span> to{" "}
          <span className="font-medium text-foreground">{toField?.label ?? "To date"}</span>.
        </div>

        <DemandProcessingFilterBuilder
          filters={filters}
          filterFields={filterFields}
          onAdd={onAddFilter}
          onUpdate={onUpdateFilter}
          onRemove={onRemoveFilter}
          onReset={onResetFilters}
        />
      </div>
    </div>
  );
}

function DemandDateFieldSelector({
  label,
  value,
  otherValue,
  side,
  onChange,
  onReset,
}: {
  label: string;
  value: string;
  otherValue: string;
  side: "from" | "to";
  onChange: (fieldId: string) => void;
  onReset: () => void;
}) {
  const allGroups = getDemandProcessingFieldGroups().map((group) => ({
    ...group,
    fields: group.fields.filter((field) => !hiddenDemandProcessingDateFieldIds.has(field.id)),
  }));
  const groups = allGroups
    .map((group) => ({
      ...group,
      fields: group.fields.filter(
        (field) =>
          isDemandProcessingFieldCompatible({
            candidateFieldId: field.id,
            selectedOtherFieldId: otherValue,
            side,
          }),
      ),
    }))
    .filter((group) => group.fields.length);
  const visibleFieldCount = groups.reduce((sum, group) => sum + group.fields.length, 0);
  const allFieldCount = allGroups.reduce((sum, group) => sum + group.fields.length, 0);
  const hiddenByCompatibilityCount = Math.max(0, allFieldCount - visibleFieldCount);
  const selectedField = getDemandProcessingField(value);
  return (
    <div className="rounded-md border border-border bg-background">
      <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
        <div className="flex items-start justify-between gap-2">
          <div>
            {label}:{" "}
            <span className="text-foreground">{selectedField?.label ?? "Select date"}</span>
          </div>
          <button
            type="button"
            onClick={onReset}
            disabled={!value}
            title={`Reset ${label}`}
            aria-label={`Reset ${label}`}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/40 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>
        {hiddenByCompatibilityCount ? (
          <div className="mt-1 text-[11px] font-normal text-amber-700">
            {hiddenByCompatibilityCount} incompatible reverse/ambiguous field
            {hiddenByCompatibilityCount === 1 ? "" : "s"} hidden.
          </div>
        ) : null}
      </div>
      <div className="max-h-72 overflow-y-auto p-2">
        {groups.map((group) => (
          <details key={`${label}:${group.title}`} className="group rounded-md">
            <summary className="cursor-pointer rounded px-2 py-1.5 text-sm font-bold uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-foreground">
              <span className="inline-flex items-center gap-1.5">
                {group.title}
                {group.title === "Bill / Payment" ? (
                  <FloatingHelper
                    text={[
                      "Unified payment combines all payment routes into one timeline instead of showing separate normal, stage, advance, returned, and supplementary bill date fields.",
                      "Unified bill submission/resubmission means the applicable bill submission date, or the resubmission date after return, whichever is the active event for that payment flow.",
                      "Example: if a normal bill was returned and later resubmitted, unified submission uses the resubmission event for measuring resubmission -> payment delay.",
                      "Supplementary bills are included even though they do not have a bill preparation date.",
                    ]}
                    label="Unified payment fields help"
                    className="size-5 border-0 bg-transparent shadow-none normal-case"
                    iconClassName="size-3"
                  />
                ) : null}
              </span>
            </summary>
            <div className="space-y-1 pb-2 pl-2">
              {group.fields.map((field) => (
                <button
                  key={field.id}
                  type="button"
                  onClick={() => onChange(field.id)}
                  className={
                    "block w-full rounded px-2 py-1.5 text-left text-sm transition " +
                    (value === field.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground")
                  }
                >
                  {field.label}
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function getDemandProcessingPresetPairLabel(preset: { fromFieldId: string; toFieldId: string }) {
  const fromLabel = getDemandProcessingField(preset.fromFieldId)?.label ?? "From date";
  const toLabel = getDemandProcessingField(preset.toFieldId)?.label ?? "To date";
  return `${fromLabel} -> ${toLabel}`;
}

function isDemandProcessingFieldCompatible({
  candidateFieldId,
  selectedOtherFieldId,
  side,
}: {
  candidateFieldId: string;
  selectedOtherFieldId: string;
  side: "from" | "to";
}) {
  if (!selectedOtherFieldId) return true;
  const candidate = getDemandProcessingField(candidateFieldId);
  const other = getDemandProcessingField(selectedOtherFieldId);
  if (!candidate || !other) return true;
  const fromFieldId = side === "from" ? candidateFieldId : selectedOtherFieldId;
  const toFieldId = side === "from" ? selectedOtherFieldId : candidateFieldId;
  if (demandProcessingReverseFieldPairs.has(`${fromFieldId}→${toFieldId}`)) return false;
  const fromRank = demandProcessingFieldOrderRank.get(fromFieldId);
  const toRank = demandProcessingFieldOrderRank.get(toFieldId);
  if (fromRank !== undefined && toRank !== undefined && fromRank > toRank) return false;

  const candidateKind = getDemandProcessingFieldKind(candidateFieldId);
  const otherKind = getDemandProcessingFieldKind(selectedOtherFieldId);
  if (
    (candidateKind === "unified" && (otherKind === "stage" || otherKind === "advance")) ||
    (otherKind === "unified" && (candidateKind === "stage" || candidateKind === "advance"))
  ) {
    return false;
  }
  if (
    (candidateKind === "stage" && otherKind === "advance") ||
    (candidateKind === "advance" && otherKind === "stage")
  ) {
    return false;
  }
  return true;
}

function getFirstCompatibleDemandProcessingFieldId({
  selectedOtherFieldId,
  side,
}: {
  selectedOtherFieldId: string;
  side: "from" | "to";
}) {
  return getDemandProcessingFieldGroups()
    .flatMap((group) => group.fields)
    .filter((field) => !hiddenDemandProcessingDateFieldIds.has(field.id))
    .find((field) =>
      isDemandProcessingFieldCompatible({
        candidateFieldId: field.id,
        selectedOtherFieldId,
        side,
      }),
    )?.id;
}

function getDemandProcessingFieldKind(fieldId: string) {
  const field = getDemandProcessingField(fieldId);
  if (!field) return "unknown";
  if (fieldId.startsWith("payment.unified")) return "unified";
  if (demandProcessingStageFieldScopes.has(field.scope)) return "stage";
  if (demandProcessingAdvanceFieldScopes.has(field.scope)) return "advance";
  return "file-so";
}

function DemandProcessingFilterBuilder({
  filters,
  filterFields,
  onAdd,
  onUpdate,
  onRemove,
  onReset,
}: {
  filters: DemandProcessingFilterRow[];
  filterFields: DemandProcessingFilterField[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Omit<DemandProcessingFilterRow, "id">>) => void;
  onRemove: (id: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold">Filters</h3>
          <p className="text-xs text-muted-foreground">All filter rows are applied together.</p>
        </div>
        <div className="flex gap-2">
          {filters.length ? (
            <button
              type="button"
              onClick={onReset}
              className="h-8 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent"
            >
              Reset filters
            </button>
          ) : null}
          <button
            type="button"
            onClick={onAdd}
            className="h-8 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent"
          >
            + Add filter
          </button>
        </div>
      </div>
      {filters.length ? (
        <div className="space-y-2">
          {filters.map((filter) => (
            <DemandProcessingFilterEditor
              key={filter.id}
              filter={filter}
              filterFields={filterFields}
              onUpdate={(patch) => onUpdate(filter.id, patch)}
              onRemove={() => onRemove(filter.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
          No custom filters applied.
        </div>
      )}
    </div>
  );
}

function DemandProcessingRangeSummary({
  rows,
  analysisUnit,
  onPlotChange,
  onOpenRange,
}: {
  rows: DemandProcessingRangeRow[];
  analysisUnit: DemandProcessingAnalysisUnit;
  onPlotChange: (plot?: ExportPlot) => void;
  onOpenRange: (row: DemandProcessingRangeRow) => void;
}) {
  const [resultView, setResultView] = useState<ResultView>("table");
  const [metric, setMetric] = useState<"count" | "capital" | "revenue">("count");
  const metricOptions = [
    { key: "count", label: analysisUnit === "bill" ? "Bill/payment count" : "Records" },
    { key: "capital", label: "Capital value" },
    { key: "revenue", label: "Revenue value" },
  ] as const;
  const maxValue = Math.max(1, ...rows.map((row) => row[metric === "count" ? "count" : metric === "capital" ? "valueCapital" : "valueRevenue"]));
  const metricLabel = metricOptions.find((option) => option.key === metric)?.label ?? metric;
  const exportPlot: ExportPlot | undefined = useMemo(
    () => resultView === "table"
      ? undefined
      : {
          kind: "bar",
          title: `${getAnalysisUnitBucketTitle(analysisUnit)} · ${metricLabel}`,
          measure: metricLabel,
          unit: metric === "count" ? "Records" : "Lakh",
          xAxisTitle: "Day range",
          yAxisTitle: `${metricLabel}${metric === "count" ? "" : " Lakh"}`,
          categories: rows.map((row) => row.label),
          series: [{
            name: metricLabel,
            values: rows.map((row) => metric === "count" ? row.count : metric === "capital" ? row.valueCapital / 100_000 : row.valueRevenue / 100_000),
          }],
        },
    [analysisUnit, metric, metricLabel, resultView, rows],
  );
  const lastExportPlotRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const nextPlotKey = exportPlot ? JSON.stringify(exportPlot) : undefined;
    if (lastExportPlotRef.current === nextPlotKey) return;
    lastExportPlotRef.current = nextPlotKey;
    onPlotChange(exportPlot);
  }, [exportPlot, onPlotChange]);
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold">{getAnalysisUnitBucketTitle(analysisUnit)}</h3>
          <p className="text-xs text-muted-foreground">
            {analysisUnit === "bill"
              ? "Each bill/payment observation is counted once in the range matching its gap."
              : `Each ${getAnalysisUnitNoun(analysisUnit)} is counted once using its maximum gap days.`}
          </p>
        </div>
        <TableChartToggle value={resultView} onChange={setResultView} label="Day range summary view" />
      </div>
      {resultView !== "table" ? (
        <div className="space-y-3">
          <label className="flex w-fit items-center gap-2 text-xs font-medium text-muted-foreground">
            Measure
            <select
              value={metric}
              onChange={(event) => setMetric(event.target.value as typeof metric)}
              className="h-8 rounded-md border border-input bg-background px-2 text-foreground"
            >
              {metricOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
          <div role="group" aria-label="Day range chart" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {rows.map((row) => {
              const value = metric === "count" ? row.count : metric === "capital" ? row.valueCapital : row.valueRevenue;
              return (
                <button key={row.id} type="button" onClick={() => onOpenRange(row)} disabled={!row.count}
                  className="rounded-md border border-border bg-secondary/15 p-3 text-left disabled:cursor-default disabled:opacity-55"
                  title={row.count ? `Open ${row.label} contributing records` : undefined}>
                  <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
                  <span className="mt-1 block text-sm font-semibold tabular-nums">{metric === "count" ? value : formatCurrency(value)}</span>
                  <span className="mt-2 block h-2 overflow-hidden rounded-sm bg-muted">
                    <span className="block h-full bg-primary" style={{ width: `${value > 0 ? Math.max(2, value / maxValue * 100) : 0}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => onOpenRange(row)}
            disabled={row.count === 0}
            className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-left transition hover:border-primary/50 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="text-xs text-muted-foreground">{row.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{row.count}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border/60 pt-2 text-xs">
              <span>
                <span className="block text-muted-foreground">Capital</span>
                <span className="font-medium tabular-nums text-foreground">
                  {formatCurrency(row.valueCapital)}
                </span>
              </span>
              <span>
                <span className="block text-muted-foreground">Revenue</span>
                <span className="font-medium tabular-nums text-foreground">
                  {formatCurrency(row.valueRevenue)}
                </span>
              </span>
            </div>
          </button>
        ))}
      </div>
      )}
    </div>
  );
}

function DemandProcessingFilterEditor({
  filter,
  filterFields,
  onUpdate,
  onRemove,
}: {
  filter: DemandProcessingFilterRow;
  filterFields: DemandProcessingFilterField[];
  onUpdate: (patch: Partial<Omit<DemandProcessingFilterRow, "id">>) => void;
  onRemove: () => void;
}) {
  const field = getDemandProcessingFilterField(filter.fieldId, filterFields);
  const conditions = getDemandProcessingConditionOptions(field);
  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-card p-2 lg:grid-cols-[minmax(180px,1.3fr)_150px_minmax(160px,1fr)_minmax(160px,1fr)_80px]">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>Field</span>
        <select
          value={filter.fieldId}
          onChange={(event) => onUpdate({ fieldId: event.target.value })}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
        >
          {getDemandProcessingFilterGroups(filterFields).map((group) => (
            <optgroup key={group.title} label={group.title}>
              {group.fields.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>Condition</span>
        <select
          value={filter.condition}
          onChange={(event) =>
            onUpdate({ condition: event.target.value as DemandProcessingFilterCondition })
          }
          className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
        >
          {conditions.map((condition) => (
            <option key={condition.key} value={condition.key}>
              {condition.label}
            </option>
          ))}
        </select>
      </label>
      <DemandProcessingFilterValueInput
        label={filter.condition === "between" ? "From" : "Value"}
        field={field}
        filter={filter}
        valueKey="value"
        onUpdate={onUpdate}
      />
      <DemandProcessingFilterValueInput
        label="To"
        field={field}
        filter={filter}
        valueKey="valueTo"
        onUpdate={onUpdate}
      />
      <div className="flex items-end">
        <button
          type="button"
          onClick={onRemove}
          className="h-9 w-full rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-accent"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function DemandProcessingFilterValueInput({
  label,
  field,
  filter,
  valueKey,
  onUpdate,
}: {
  label: string;
  field: DemandProcessingFilterField;
  filter: DemandProcessingFilterRow;
  valueKey: "value" | "valueTo";
  onUpdate: (patch: Partial<Omit<DemandProcessingFilterRow, "id">>) => void;
}) {
  const disabled =
    filter.condition === "filled" ||
    filter.condition === "blank" ||
    (valueKey === "valueTo" && filter.condition !== "between");
  const value = filter[valueKey];
  const commonClass =
    "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-40";
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      {field.type === "select" || field.type === "yesNo" ? (
        <select
          value={value}
          disabled={disabled || valueKey === "valueTo"}
          onChange={(event) => onUpdate({ [valueKey]: event.target.value })}
          className={commonClass}
        >
          <option value="">Any</option>
          {(field.type === "yesNo" ? ["Yes", "No"] : (field.options ?? [])).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === "date" ? (
        <DateInput
          value={value}
          disabled={disabled}
          onChange={(nextValue) => onUpdate({ [valueKey]: nextValue })}
          className={commonClass}
        />
      ) : (
        <input
          type={field.type === "amount" ? "number" : "text"}
          value={value}
          disabled={disabled}
          onChange={(event) => onUpdate({ [valueKey]: event.target.value })}
          className={commonClass}
        />
      )}
    </label>
  );
}

function getDemandProcessingConditionOptions(field: DemandProcessingFilterField) {
  const common = [
    { key: "filled", label: "is filled" },
    { key: "blank", label: "is blank" },
  ] satisfies Array<{ key: DemandProcessingFilterCondition; label: string }>;
  if (field.type === "date") {
    return [
      { key: "between", label: "between" },
      { key: "onOrAfter", label: "on/after" },
      { key: "onOrBefore", label: "on/before" },
      { key: "equals", label: "is" },
      ...common,
    ] satisfies Array<{ key: DemandProcessingFilterCondition; label: string }>;
  }
  if (field.type === "amount") {
    return [
      { key: "between", label: "between" },
      { key: "greaterThan", label: "greater than" },
      { key: "lessThan", label: "less than" },
      { key: "equals", label: "is" },
      ...common,
    ] satisfies Array<{ key: DemandProcessingFilterCondition; label: string }>;
  }
  if (field.type === "text") {
    return [
      { key: "contains", label: "contains" },
      { key: "equals", label: "is" },
      { key: "notEquals", label: "is not" },
      ...common,
    ] satisfies Array<{ key: DemandProcessingFilterCondition; label: string }>;
  }
  return [
    { key: "equals", label: "is" },
    { key: "notEquals", label: "is not" },
    ...common,
  ] satisfies Array<{ key: DemandProcessingFilterCondition; label: string }>;
}

function DemandMetric({
  label,
  value,
  onClick,
  helperText,
}: {
  label: string;
  value: ReactNode;
  onClick?: () => void;
  helperText?: HelperText;
}) {
  if (helperText) {
    return (
      <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-left">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{label}</span>
          <FloatingHelper
            text={helperText}
            label={`${label} help`}
            className="size-5 border-0 bg-transparent shadow-none"
            iconClassName="size-3"
          />
        </div>
        <button
          type="button"
          onClick={onClick}
          disabled={!onClick}
          className="mt-1 block text-left text-lg font-semibold tabular-nums text-foreground disabled:cursor-default disabled:opacity-100"
        >
          {value}
        </button>
      </div>
    );
  }
  const content = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-left transition hover:border-primary/50 hover:bg-accent"
      >
        {content}
      </button>
    );
  }
  return <div className="rounded-md border border-border bg-secondary/20 px-3 py-2">{content}</div>;
}

function getDemandProcessingStats(
  rows: DemandProcessingAnalysisRow[],
  analysisUnit: DemandProcessingAnalysisUnit,
): DemandProcessingStats {
  if (!rows.length) {
    return {
      count: 0,
      unitCount: 0,
      fileCount: 0,
      average: 0,
      median: 0,
      min: 0,
      max: 0,
      negative: 0,
      negativeFileCount: 0,
    };
  }
  const negativeRows = rows.filter((row) => row.gapDays < 0);
  const negative = negativeRows.length;
  const negativeFileCount = new Set(negativeRows.map((row) => row.fileId)).size;
  const analysisRows = rows.filter((row) => row.gapDays >= 0);
  if (!analysisRows.length) {
    return {
      count: 0,
      unitCount: 0,
      fileCount: 0,
      average: 0,
      median: 0,
      min: 0,
      max: 0,
      negative,
      negativeFileCount,
    };
  }
  const gaps = analysisRows.map((row) => row.gapDays).sort((a, b) => a - b);
  const sum = gaps.reduce((total, gap) => total + gap, 0);
  const middle = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 0 ? (gaps[middle - 1] + gaps[middle]) / 2 : gaps[middle];
  return {
    count: analysisRows.length,
    unitCount: new Set(analysisRows.map((row) => getDemandProcessingUnitKey(row, analysisUnit)))
      .size,
    fileCount: new Set(analysisRows.map((row) => row.fileId)).size,
    average: sum / analysisRows.length,
    median,
    min: gaps[0],
    max: gaps[gaps.length - 1],
    negative,
    negativeFileCount,
  };
}

const defaultDemandProcessingDayRanges: DemandProcessingDayRange[] = [
  { id: "0-90", label: "0-90", minDays: "0", maxDays: "90" },
  { id: "91-180", label: "91-180", minDays: "91", maxDays: "180" },
  { id: "181-365", label: "181-365", minDays: "181", maxDays: "365" },
  { id: "365-plus", label: "365 and above", minDays: "366", maxDays: "" },
];

function normalizeDemandProcessingDayRanges(value: unknown): DemandProcessingDayRange[] {
  if (!Array.isArray(value)) return defaultDemandProcessingDayRanges;
  const ranges = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const record = item as Record<string, unknown>;
      const label = String(record.label ?? "").trim();
      if (!label) return undefined;
      return {
        id: String(record.id ?? label),
        label,
        minDays: String(record.minDays ?? "").trim(),
        maxDays: String(record.maxDays ?? "").trim(),
      };
    })
    .filter((range): range is NonNullable<typeof range> => Boolean(range));
  return ranges.length ? ranges : defaultDemandProcessingDayRanges;
}

function getDemandProcessingRangeRows(
  rows: DemandProcessingAnalysisRow[],
  ranges: DemandProcessingDayRange[],
  analysisUnit: DemandProcessingAnalysisUnit,
): DemandProcessingRangeRow[] {
  const maxGapByUnit = new Map<
    string,
    { gapDays: number; fileId: string; valueCapital: number; valueRevenue: number }
  >();
  rows.forEach((row) => {
    const key = getDemandProcessingUnitKey(row, analysisUnit);
    const current = maxGapByUnit.get(key);
    if (!current || row.gapDays > current.gapDays) {
      maxGapByUnit.set(key, {
        gapDays: row.gapDays,
        fileId: row.fileId,
        valueCapital: row.valueCapital,
        valueRevenue: row.valueRevenue,
      });
    }
  });
  const normalizedRanges = ranges.map((range) => ({
    id: range.id || range.label,
    label: range.label,
    minDays: parseOptionalDay(range.minDays),
    maxDays: parseOptionalDay(range.maxDays),
    count: 0,
    valueCapital: 0,
    valueRevenue: 0,
    fileIds: [] as string[],
  }));
  maxGapByUnit.forEach(({ gapDays, fileId, valueCapital, valueRevenue }) => {
    const range = normalizedRanges.find(
      (item) =>
        (item.minDays === undefined || gapDays >= item.minDays) &&
        (item.maxDays === undefined || gapDays <= item.maxDays),
    );
    if (!range) return;
    range.count += 1;
    range.valueCapital += valueCapital;
    range.valueRevenue += valueRevenue;
    if (!range.fileIds.includes(fileId)) range.fileIds.push(fileId);
  });
  return normalizedRanges;
}

function getDemandProcessingUnitKey(
  row: DemandProcessingAnalysisRow,
  analysisUnit: DemandProcessingAnalysisUnit,
) {
  if (analysisUnit === "bill") {
    return `${row.fileId}:bill:${row.paymentObjectKey ?? `${row.orderIndex ?? 0}:${row.stageIndex ?? "order"}`}`;
  }
  if (analysisUnit === "stage") {
    return `${row.fileId}:stage:${row.orderIndex ?? 0}:${row.stageIndex ?? 0}`;
  }
  if (analysisUnit === "advance") return `${row.fileId}:advance:${row.orderIndex ?? 0}`;
  if (analysisUnit === "order") return `${row.fileId}:order:${row.orderIndex ?? 0}`;
  return row.fileId;
}

function parseOptionalDay(value: string | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getDemandProcessingDashboardFilter(
  fromFieldId: string,
  toFieldId: string,
  mode: "used" | "reverse",
) {
  return `demandProcessing:${encodeURIComponent(fromFieldId)}:${encodeURIComponent(toFieldId)}:${mode}`;
}

function getDemandProcessingRowFocus(
  row: DemandProcessingAnalysisRow,
  fromFieldId: string,
  toFieldId: string,
) {
  const focusField = getDemandProcessingField(toFieldId) ?? getDemandProcessingField(fromFieldId);
  if (!focusField) return { section: "Timeline", focusTarget: undefined };
  if (focusField.scope === "file") {
    return { section: getDemandProcessingFileSection(focusField.group), focusTarget: undefined };
  }
  const kind = getDemandProcessingFocusKind(focusField.id);
  const orderIndex = row.orderIndex ?? 0;
  const stageIndex = row.stageIndex;
  const focusTarget =
    stageIndex === undefined
      ? `${kind}:any:${orderIndex}`
      : `${kind}:any:${orderIndex}:${stageIndex}`;
  return { section: "Supply order and payment", focusTarget };
}

function getDemandProcessingFileSection(group: string) {
  if (group === "Scrutiny") return "Scrutiny and control";
  if (group === "TCEC") return "TCEC block";
  if (group === "Approval / vetting") return "Approval block";
  if (group === "Bidding") return "Bidding details";
  return "File details";
}

function getDemandProcessingFocusKind(fieldId: string) {
  if (fieldId.includes("financialSanctionDate")) return "financialsanction";
  if (fieldId.includes("soDate")) return "supplyorder";
  if (fieldId.includes("psb")) return "psb";
  if (fieldId.includes("pwb")) return "pwb";
  if (fieldId.includes("combined")) return "psbpwb";
  if (fieldId.includes("dpDate") || fieldId.includes("revisedDp")) return "deliveryperiod";
  if (fieldId.includes("materialReceiptDate")) return "delivery";
  if (fieldId.includes("irPreparationDate")) return "irpreparation";
  if (fieldId.includes("irReceiptDate")) return "irreceipt";
  if (fieldId.includes("billPreparationDate")) return "billpreparation";
  if (fieldId.includes("billSentForPaymentDate")) return "billsentforpayment";
  if (fieldId.includes("paymentDate")) return "payment";
  if (fieldId.includes("soCancelledDate")) return "socancelled";
  return "supplyorder";
}

function formatGapNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getAnalysisBasisLabel(fromScope: string | undefined, toScope: string | undefined) {
  if (fromScope === "order" && toScope === "order") return "S.O.-wise";
  if (fromScope === "stage" || toScope === "stage") return "stage-wise";
  if (fromScope === "advance" || toScope === "advance") return "advance-payment-wise";
  if (fromScope === "order" || toScope === "order") return "S.O.-wise";
  return "file-wise";
}

function getDemandProcessingAnalysisUnit(fromFieldId: string, toFieldId: string) {
  if (fromFieldId.startsWith("payment.unified") || toFieldId.startsWith("payment.unified")) {
    return "bill";
  }
  const fromScope = getDemandProcessingField(fromFieldId)?.scope;
  const toScope = getDemandProcessingField(toFieldId)?.scope;
  if (fromScope === "stage" || toScope === "stage") return "stage";
  if (fromScope === "advance" || toScope === "advance") return "advance";
  if (fromScope === "order" || toScope === "order") return "order";
  return "demand";
}

function getAnalysisUnitCountLabel(unit: DemandProcessingAnalysisUnit) {
  if (unit === "bill") return "Bill/payment observations";
  if (unit === "stage") return "No. of Stages";
  if (unit === "advance") return "No. of Advance Payments";
  if (unit === "order") return "No. of S.O.s";
  return "No. of Demands";
}

function getAnalysisUnitBucketTitle(unit: DemandProcessingAnalysisUnit) {
  if (unit === "bill") return "Bill/payment age buckets";
  if (unit === "stage") return "Stage age buckets";
  if (unit === "advance") return "Advance payment age buckets";
  if (unit === "order") return "S.O. age buckets";
  return "Demand age buckets";
}

function getAnalysisUnitNoun(unit: DemandProcessingAnalysisUnit) {
  if (unit === "bill") return "bill/payment";
  if (unit === "stage") return "stage";
  if (unit === "advance") return "advance payment";
  if (unit === "order") return "S.O.";
  return "demand";
}

function formatDateDisplay(value: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}-${month}-${year}`;
}

function ExpectedCashOutgoReport({
  rows,
  title,
  titleHelper,
  description,
  actions,
  selectedDays,
  selectedDaysUnlocked = false,
  sharedDays,
  savingDays = false,
  daysError = "",
  daysSaved = false,
  hasPersonalOverride = false,
  onDaysChange,
  onSelectedDaysUnlockedChange,
  onSelectedDaysSave,
  onSelectedDaysReset,
  dateRange,
  monthSelection,
  emptyMessage = "No expected cash outgo rows found.",
  onOpenMonth,
  onOpenAll,
}: {
  rows: ExpectedCashOutgoRow[];
  title: string;
  titleHelper?: HelperText;
  description: string;
  actions: ReactNode;
  selectedDays?: string;
  selectedDaysUnlocked?: boolean;
  sharedDays?: string;
  savingDays?: boolean;
  daysError?: string;
  daysSaved?: boolean;
  hasPersonalOverride?: boolean;
  onDaysChange?: (value: string) => void;
  onSelectedDaysUnlockedChange?: (unlocked: boolean) => void;
  onSelectedDaysSave?: () => void;
  onSelectedDaysReset?: () => void;
  dateRange?: HistoricalDateRangeControlsProps;
  monthSelection?: MonthSelectionControlsProps;
  emptyMessage?: string;
  onOpenMonth?: (monthKey: string) => void;
  onOpenAll?: () => void;
}) {
  return (
    <CashOutgoReport
      rows={rows}
      title={title}
      titleHelper={titleHelper}
      description={description}
      emptyMessage={emptyMessage}
      actions={actions}
      onOpenMonth={onOpenMonth}
      onOpenAll={onOpenAll}
      controls={
        <>
          {monthSelection ? <MonthSelectionControls {...monthSelection} /> : null}
          {dateRange ? <HistoricalDateRangeControls {...dateRange} /> : null}
          {selectedDays !== undefined && onDaysChange ? (
            <CashOutgoOffsetDaysControl
              value={selectedDays}
              sharedDefaultDays={sharedDays}
              unlocked={selectedDaysUnlocked}
              saving={savingDays}
              error={daysError}
              saved={daysSaved}
              personalOverride={hasPersonalOverride}
              onValueChange={onDaysChange}
              onUnlockedChange={onSelectedDaysUnlockedChange}
              onSave={onSelectedDaysSave}
              onReset={onSelectedDaysReset}
            />
          ) : null}
        </>
      }
    />
  );
}

type HistoricalDateRangeControlsProps = {
  label?: string;
  fromDate: string;
  toDate: string;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  dateRangeEnabled?: boolean;
  active?: boolean;
  helperText?: HelperText;
  onDateRangeEnabledChange?: (checked: boolean) => void;
};

type MonthSelectionControlsProps = {
  month: string;
  options: Array<{ value: string; label: string }>;
  active?: boolean;
  onMonthChange: (value: string) => void;
};

function MonthSelectionControls({
  month,
  options,
  active = false,
  onMonthChange,
}: MonthSelectionControlsProps) {
  return (
    <label
      className={filterLabelClass(active, "flex w-40 flex-col gap-1 text-xs text-muted-foreground")}
    >
      <span>Month</span>
      <select
        value={month}
        onChange={(event) => onMonthChange(event.target.value)}
        className={filterControlClass(
          active,
          "h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40",
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function AsOnDateControl({
  date,
  active = false,
  onDateChange,
}: {
  date: string;
  active?: boolean;
  onDateChange: (value: string) => void;
}) {
  return (
    <label
      className={filterLabelClass(active, "flex w-36 flex-col gap-1 text-xs text-muted-foreground")}
    >
      <span>As on date</span>
      <DateInput
        value={date}
        onChange={(value) => {
          if (value) onDateChange(value);
        }}
        className={filterControlClass(
          active,
          "h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40",
        )}
      />
    </label>
  );
}

function HistoricalDateRangeControls({
  label = "Date range",
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  dateRangeEnabled,
  active = false,
  helperText,
  onDateRangeEnabledChange,
}: HistoricalDateRangeControlsProps) {
  const optionalMode = Boolean(onDateRangeEnabledChange);
  const inputsDisabled = optionalMode && !dateRangeEnabled;
  return (
    <>
      {optionalMode ? (
        <div
          className={filterControlClass(
            active,
            "flex min-h-9 items-center gap-3 rounded-md border border-border bg-secondary/20 px-3 text-xs font-medium text-foreground",
          )}
        >
          {onDateRangeEnabledChange ? (
            <label className={filterLabelClass(active, "flex items-center gap-1.5")}>
              <input
                type="checkbox"
                checked={Boolean(dateRangeEnabled)}
                onChange={(event) => onDateRangeEnabledChange(event.target.checked)}
                className="size-3.5 rounded border-input"
              />
              {label}
              {helperText ? (
                <FloatingHelper
                  text={helperText}
                  label={`${label} help`}
                  side="top"
                  className="size-5 border-0 bg-transparent shadow-none"
                  iconClassName="size-3"
                />
              ) : null}
            </label>
          ) : null}
        </div>
      ) : null}
      <label
        className={filterLabelClass(
          active,
          "flex w-36 flex-col gap-1 text-xs text-muted-foreground",
        )}
      >
        <span className="inline-flex items-center gap-1">
          From
          {!optionalMode && helperText ? (
            <FloatingHelper
              text={helperText}
              label="Date range help"
              side="top"
              className="size-5 border-0 bg-transparent shadow-none"
              iconClassName="size-3"
            />
          ) : null}
        </span>
        <DateInput
          value={fromDate}
          max={toDate}
          disabled={inputsDisabled}
          onChange={(value) => {
            if (value) onFromDateChange(value);
          }}
          className={filterControlClass(
            active,
            "h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40",
          )}
        />
      </label>
      <label
        className={filterLabelClass(
          active,
          "flex w-36 flex-col gap-1 text-xs text-muted-foreground",
        )}
      >
        <span>To</span>
        <DateInput
          value={toDate}
          min={fromDate}
          disabled={inputsDisabled}
          onChange={(value) => {
            if (value) onToDateChange(value);
          }}
          className={filterControlClass(
            active,
            "h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40",
          )}
        />
      </label>
    </>
  );
}

function ActualCashOutgoReport({
  rows,
  onOpenMonth,
  onOpenAll,
}: {
  rows: ExpectedCashOutgoRow[];
  onOpenMonth: (monthKey: string) => void;
  onOpenAll?: () => void;
}) {
  return (
    <CashOutgoReport
      rows={rows}
      title="Actual cash out go monthly"
      description="Uses payment date, excluding S.O. cancelled rows only when cancellation date is filled."
      emptyMessage="No actual cash out go rows found."
      onOpenMonth={onOpenMonth}
      onOpenAll={onOpenAll}
    />
  );
}

function CurrentMonthLiabilityReport({
  rows,
  title,
  titleHelper,
  description,
  actions,
  selectedDays,
  selectedDaysUnlocked,
  sharedDays,
  savingDays = false,
  daysError = "",
  daysSaved = false,
  hasPersonalOverride = false,
  onDaysChange,
  onSelectedDaysUnlockedChange,
  onSelectedDaysSave,
  onSelectedDaysReset,
  monthSelection,
  onOpenMonth,
  onOpenAll,
}: {
  rows: ExpectedCashOutgoRow[];
  title: string;
  titleHelper?: HelperText;
  description: string;
  actions: ReactNode;
  selectedDays: string;
  selectedDaysUnlocked: boolean;
  sharedDays?: string;
  savingDays?: boolean;
  daysError?: string;
  daysSaved?: boolean;
  hasPersonalOverride?: boolean;
  onDaysChange: (value: string) => void;
  onSelectedDaysUnlockedChange: (unlocked: boolean) => void;
  onSelectedDaysSave: () => void;
  onSelectedDaysReset: () => void;
  monthSelection?: MonthSelectionControlsProps;
  onOpenMonth?: (monthKey: string) => void;
  onOpenAll?: () => void;
}) {
  return (
    <CashOutgoReport
      rows={rows}
      title={title}
      titleHelper={titleHelper}
      description={description}
      emptyMessage="No unpaid liability found for the current month."
      actions={actions}
      onOpenMonth={onOpenMonth}
      onOpenAll={onOpenAll}
      controls={
        <>
          {monthSelection ? <MonthSelectionControls {...monthSelection} /> : null}
          <CashOutgoOffsetDaysControl
            value={selectedDays}
            sharedDefaultDays={sharedDays}
            unlocked={selectedDaysUnlocked}
            saving={savingDays}
            error={daysError}
            saved={daysSaved}
            personalOverride={hasPersonalOverride}
            onValueChange={onDaysChange}
            onUnlockedChange={onSelectedDaysUnlockedChange}
            onSave={onSelectedDaysSave}
            onReset={onSelectedDaysReset}
          />
        </>
      }
    />
  );
}

function CashOutgoOffsetDaysControl({
  value,
  sharedDefaultDays = String(DEFAULT_DP_OFFSET_DAYS),
  unlocked,
  saving = false,
  error = "",
  saved = false,
  personalOverride = false,
  onValueChange,
  onUnlockedChange,
  onSave,
  onReset,
}: {
  value: string;
  sharedDefaultDays?: string;
  unlocked: boolean;
  saving?: boolean;
  error?: string;
  saved?: boolean;
  personalOverride?: boolean;
  onValueChange: (value: string) => void;
  onUnlockedChange?: (unlocked: boolean) => void;
  onSave?: () => void;
  onReset?: () => void;
}) {
  const normalizedDays = normalizeExpectedCashOutgoDays(value);
  const normalizedSharedDays = normalizeExpectedCashOutgoDays(sharedDefaultDays);
  const active = unlocked || personalOverride;
  return (
    <div className={filterLabelClass(active, "w-[230px] max-w-full text-xs font-medium")}>
      <span className="mb-1 flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
        Days after base date
        <FloatingHelper
          text="This report follows the shared offset in Settings → Analytics and Reports → Offset days setting. Unlock and save to keep a personal override. Reset removes your override so this report follows the current shared value, including future Admin updates."
          className="size-5 border-0 bg-transparent shadow-none"
          iconClassName="size-3"
        />
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <input
          type="number"
          min="0"
          value={unlocked ? value : normalizedDays}
          disabled={!unlocked || saving}
          onChange={(event) => onValueChange(event.target.value)}
          className={filterControlClass(
            active,
            "h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-70",
          )}
        />
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
          <button
            type="button"
            onClick={() => onUnlockedChange?.(!unlocked)}
            disabled={saving}
            className="btn-ghost size-8 p-0"
            title={unlocked ? "Lock offset days" : "Unlock offset days"}
            aria-label={unlocked ? "Lock offset days" : "Unlock offset days"}
          >
            {unlocked ? <Unlock className="size-4" /> : <Lock className="size-4" />}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!unlocked || saving}
            className="btn-ghost size-8 p-0"
            title="Save offset days"
            aria-label="Save offset days"
          >
            <Save className="size-4" />
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={!onReset || saving}
            className="btn-ghost size-8 p-0"
            title="Reset offset days to the shared Settings value"
            aria-label="Reset offset days to the shared Settings value"
          >
            <RotateCcw className="size-4" />
          </button>
        </span>
      </span>
      {error ? <span className="mt-1 block text-xs text-destructive">{error}</span> : null}
      {!error && saved ? (
        <span className="mt-1 block text-xs text-muted-foreground">
          {personalOverride ? "Personal offset saved for your account." : "Offset saved for your account."}
        </span>
      ) : null}
      {!error && !unlocked && !personalOverride ? (
        <span className="mt-1 block text-xs text-muted-foreground">
          Using shared offset: {normalizedSharedDays} days
        </span>
      ) : null}
    </div>
  );
}

function BgReceiptDelayControls({
  days,
  unlocked,
  onUnlockedChange,
  onDaysChange,
}: {
  days: string[];
  unlocked: boolean;
  onUnlockedChange: (unlocked: boolean) => void;
  onDaysChange: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const displayDays = days.length ? days : defaultBgReceiptDelayDays;
  const normalizedDays = normalizeBgReceiptDelayDays(displayDays);
  const active =
    unlocked || normalizedDays.map(String).join(",") !== defaultBgReceiptDelayDays.join(",");
  const updateDay = (index: number, value: string) => {
    onDaysChange((current) => {
      const next = [...(current.length ? current : defaultBgReceiptDelayDays)];
      next[index] = value;
      return next;
    });
  };

  return (
    <div
      className={filterControlClass(active, "rounded-md border border-border bg-secondary/20 p-3")}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className={filterLabelClass(active, "text-xs text-muted-foreground")}>
          Delay thresholds from S.O. date:{" "}
          <span className="font-medium text-foreground">
            {normalizedDays.map((day) => `>${day}`).join(", ")} days
          </span>
        </div>
        <button
          type="button"
          onClick={() => onUnlockedChange(!unlocked)}
          className={
            "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition " +
            (unlocked
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground hover:bg-accent")
          }
        >
          {unlocked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />}
          {unlocked ? "Unlocked" : "Locked"}
        </button>
        <FloatingHelper
          text={[
            "Locked thresholds cannot be edited.",
            "These thresholds are saved in this browser for the current logged-in user; they are not global software settings.",
            "Unlock to change, add, remove, or reset BG receipt delay thresholds.",
            "Reset restores the default 10/30/60 day thresholds for this browser/user.",
          ]}
          label="BG receipt delay threshold lock help"
          className="size-8 border-0 bg-transparent shadow-none"
          iconClassName="size-3"
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {displayDays.map((day, index) => (
          <label
            key={index}
            className={filterLabelClass(
              active,
              "flex flex-col gap-1 text-xs text-muted-foreground",
            )}
          >
            <span>Threshold {index + 1}</span>
            <input
              type="number"
              min={0}
              value={day}
              disabled={!unlocked}
              onChange={(event) => updateDay(index, event.target.value)}
              className={filterControlClass(
                active,
                "h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-70",
              )}
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!unlocked || displayDays.length >= 6}
          onClick={() =>
            onDaysChange([...normalizedDays.map(String), String((normalizedDays.at(-1) ?? 0) + 30)])
          }
          className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          Add threshold
        </button>
        <button
          type="button"
          disabled={!unlocked || displayDays.length <= 1}
          onClick={() => onDaysChange(displayDays.slice(0, -1))}
          className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          Remove last
        </button>
        <button
          type="button"
          disabled={!unlocked}
          onClick={() => onDaysChange(defaultBgReceiptDelayDays)}
          className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          Reset 10/30/60
        </button>
      </div>
    </div>
  );
}

function WarrantyBgBufferControls({
  days,
  unlocked,
  onUnlockedChange,
  onDaysChange,
  onReset,
}: {
  days: string;
  unlocked: boolean;
  onUnlockedChange: (unlocked: boolean) => void;
  onDaysChange: (value: string) => void;
  onReset: () => void;
}) {
  const normalizedDays = normalizeWarrantyBgBufferDays(days);
  const active = unlocked || normalizedDays !== "60";
  return (
    <div
      className={filterControlClass(active, "rounded-md border border-border bg-secondary/20 p-3")}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className={filterLabelClass(active, "text-xs text-muted-foreground")}>
          Warranty BG cover required up to:{" "}
          <span className="font-medium text-foreground">
            Warranty period + {normalizedDays} days
          </span>
        </div>
        <button
          type="button"
          onClick={() => onUnlockedChange(!unlocked)}
          className={
            "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition " +
            (unlocked
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground hover:bg-accent")
          }
        >
          {unlocked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />}
          {unlocked ? "Unlocked" : "Locked"}
        </button>
        <FloatingHelper
          text={[
            "Locked buffer cannot be edited.",
            "This personal buffer is used only by the Warranty/BG mismatch report. It does not change when a BG becomes due for return; that system-wide offset is set in Settings → Workspace.",
            "Unlock to change the warranty BG buffer.",
            "Reset restores this report filter to its default 60 days for this browser/user.",
          ]}
          label="Warranty BG buffer lock help"
          className="size-8 border-0 bg-transparent shadow-none"
          iconClassName="size-3"
        />
      </div>
      <label
        className={filterLabelClass(
          active,
          "flex max-w-48 flex-col gap-1 text-xs text-muted-foreground",
        )}
      >
        <span className="inline-flex items-center gap-1.5">
            Mismatch buffer days
            <FloatingHelper
            text="Used only in this report to compare BG validity with the warranty period. It does not control the BG return-due date."
            className="size-5 border-0 bg-transparent shadow-none"
            iconClassName="size-3"
          />
        </span>
        <input
          type="number"
          min={0}
          value={days}
          disabled={!unlocked}
          onChange={(event) => onDaysChange(event.target.value)}
          className={filterControlClass(
            active,
            "h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-70",
          )}
        />
      </label>
      <button
        type="button"
        onClick={onReset}
        className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent"
        title="Reset buffer days"
        aria-label="Reset buffer days"
      >
        <RotateCcw className="size-3.5" />
        Reset
      </button>
      <FloatingHelper
        text="Reset restores this report-only mismatch buffer to 60 days for the current logged-in user."
        label="Reset warranty BG buffer help"
        className="ml-2 inline-flex size-8 border-0 bg-transparent shadow-none"
        iconClassName="size-3"
      />
    </div>
  );
}

function MonthlyOperationalReport({
  title,
  description,
  columns,
  rows,
  viewMode = "month",
  onOpenSearch,
  onYearSelect,
  controls,
  unitNote,
  valueFormatter,
  onPdf,
  onExcel,
}: {
  title: string;
  description: string;
  columns: MonthlyReportColumn[];
  rows: Array<Record<string, number | string>>;
  viewMode?: MonthlyReportViewMode;
  onOpenSearch: (dashboardFilter: string) => void;
  onYearSelect?: (year: string) => void;
  controls?: ReactNode;
  unitNote?: string;
  valueFormatter?: (key: string, value: number | string) => string;
  onPdf: (plot?: ExportPlot | ExportPlot[]) => void;
  onExcel: (plot?: ExportPlot | ExportPlot[]) => void;
}) {
  const [resultView, setResultView] = useState<ResultView>("table");
  const numericColumns = columns.slice(1).filter((column) =>
    rows.some((row) => typeof row[column.key] === "number"),
  );
  const bgExpiryColumns = [
    { key: "psb", label: "PSB", color: "#4472c4" },
    { key: "pwb", label: "PWB", color: "#ed7d31" },
    { key: "psbPwb", label: "PSB+PWB", color: "#70ad47" },
  ] as const;
  const isBgExpiryReport = bgExpiryColumns.every((category) =>
    columns.some((column) => column.key === category.key),
  );
  const [chartMetric, setChartMetric] = useState("");
  const selectedChartColumn = numericColumns.find((column) => column.key === chartMetric) ?? numericColumns[0];
  const chartRows = rows.filter((row) =>
    viewMode === "inline"
      ? row.__displayKind === "month"
      : String(row[columns[0]?.key ?? ""] ?? "") !== "Total",
  );
  const chartFiscalYears = Array.from(
    new Set(chartRows.map((row) => String(row.__yearKey ?? "")).filter(Boolean)),
  );
  const chartGroups =
    viewMode === "inline"
      ? chartFiscalYears.map((year) => ({
          year,
          rows: chartRows.filter((row) => row.__yearKey === year),
        }))
      : [{ year: "", rows: chartRows }];
  const totalCells = viewMode === "inline" ? [] : getMonthlyReportTotalCells(columns, rows, { viewMode });
  const exportPlots: ExportPlot[] | undefined =
    isBgExpiryReport && resultView === "bar"
      ? chartGroups.map((group) => ({
          kind: "bar",
          title: `${group.year ? `${formatFiscalYearChartTitle(group.year)} · ` : ""}${title} · BG type breakdown`,
          measure: "BG expiries",
          unit: "Count",
          xAxisTitle: viewMode === "inline" ? "Month" : columns[0]?.label ?? "Category",
          yAxisTitle: "Count",
          expandedYears: group.year ? [group.year] : [],
          stackedBars: true,
          categories: group.rows.map((row, index) =>
            String(
              viewMode === "inline"
                ? row.__chartLabel ?? row[columns[0]?.key ?? ""]
                : row[columns[0]?.key ?? ""] ?? `Row ${index + 1}`,
            ),
          ),
          series: bgExpiryColumns.map((category) => ({
            name: category.label,
            color: category.color,
            values: group.rows.map((row) => Number(row[category.key] ?? 0)),
          })),
        }))
      : resultView !== "table" && selectedChartColumn
      ? chartGroups.map((group) => {
          const fyTitle = group.year ? `${formatFiscalYearChartTitle(group.year)} · ` : "";
          return {
          kind: resultView === "line" ? "line" : "bar",
          title: `${fyTitle}${title} · ${selectedChartColumn.label}`,
          measure: selectedChartColumn.label,
          unit: unitNote,
          xAxisTitle: viewMode === "inline" ? "Month" : columns[0]?.label ?? "Category",
          yAxisTitle: `${selectedChartColumn.label}${unitNote ? ` ${unitNote}` : ""}`,
          expandedYears: group.year ? [group.year] : [],
          categories: group.rows.map((row, index) =>
            String(
              viewMode === "inline"
                ? row.__chartLabel ?? row[columns[0]?.key ?? ""]
                : row[columns[0]?.key ?? ""] ?? `Row ${index + 1}`,
            ),
          ),
          series: [
            {
              name: selectedChartColumn.label,
              values: group.rows.map((row) => Number(row[selectedChartColumn.key] ?? 0)),
            },
          ],
          };
        })
      : undefined;
  const exportPlot = exportPlots && exportPlots.length > 1 ? exportPlots : exportPlots?.[0];
  const showTotalFooter =
    viewMode === "month" &&
    totalCells.some((cell, index) => index > 0 && cell.filter && cell.value !== "0");
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <ReportDescription description={description} />
          {viewMode === "inline" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Expand years to see their months. Charts show months only for expanded years.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {numericColumns.length ? (
            <TableChartToggle value={resultView} onChange={setResultView} label={`${title} view`} views={["table", "bar", "line"]} />
          ) : null}
          <button
            type="button"
            onClick={() => onPdf(exportPlot)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
          >
            <FileText className="size-4" />
            PDF
          </button>
          <button
            type="button"
            onClick={() => onExcel(exportPlot)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
          >
            <FileSpreadsheet className="size-4" />
            Excel
          </button>
        </div>
      </div>
      {controls ? <div className="mb-5">{controls}</div> : null}
      {unitNote ? (
        <div className="mb-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm font-semibold text-foreground">
          {unitNote}
        </div>
      ) : null}

      {numericColumns.length && selectedChartColumn && resultView !== "table" ? (
        <div data-chart-copy-area className="mb-4 rounded-lg border border-border bg-background p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Each expanded FY is plotted separately. Select a bar to open its matching files.</p>
            {!(isBgExpiryReport && resultView === "bar") ? (
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                Measure
                <select value={selectedChartColumn.key} onChange={(event) => setChartMetric(event.target.value)}
                  className="h-8 max-w-64 rounded-md border border-input bg-background px-2 text-foreground">
                  {numericColumns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
                </select>
              </label>
            ) : (
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {bgExpiryColumns.map((category) => (
                  <span key={category.key} className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm" style={{ backgroundColor: category.color }} />
                    {category.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          {viewMode === "inline" && chartRows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Expand a year in the table to plot its monthly results.
            </div>
          ) : chartGroups.map((group) => (
            <section data-chart-copy-area key={group.year || "all"} className="mb-5 last:mb-0">
              <h4 className="mb-1 text-sm font-semibold text-foreground">{title}</h4>
              <div className="mb-2 flex items-center justify-between gap-2">
                {group.year ? (
                  <h3 className="text-sm font-semibold text-foreground">
                    {formatFiscalYearChartTitle(group.year)}
                  </h3>
                ) : <span />}
                <ChartCopyButton />
              </div>
              <div className="overflow-x-auto">
                <div className="h-[320px] min-w-[1120px]">
                  <ResponsiveContainer width="100%" height="100%">
                  {resultView === "line" ? (
                    <LineChart
                      data={group.rows.map((row) => ({
                        ...row,
                        chartLabel: String(row.__chartLabel ?? row[columns[0]?.key ?? ""] ?? ""),
                        chartValue: Number(row[selectedChartColumn.key] ?? 0),
                      }))}
                      margin={{ top: 12, right: 18, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="chartLabel" interval={0} minTickGap={0} tick={{ fontSize: 13 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 13 }} width={64}
                        label={{ value: unitNote || selectedChartColumn.label, angle: -90, position: "insideLeft", fontSize: 13 }} />
                      <ChartTooltip formatter={(value) => valueFormatter ? valueFormatter(selectedChartColumn.key, Number(value)) : Number(value).toLocaleString()} />
                      <Line type="monotone" dataKey="chartValue" name={selectedChartColumn.label} stroke="#0f766e" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  ) : isBgExpiryReport ? (
                    <BarChart
                      data={group.rows.map((row) => ({
                        ...row,
                        chartLabel: String(row.__chartLabel ?? row[columns[0]?.key ?? ""] ?? ""),
                      }))}
                      margin={{ top: 12, right: 18, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="chartLabel" interval={0} minTickGap={0} tick={{ fontSize: 13 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 13 }} width={64}
                        label={{ value: "Count", angle: -90, position: "insideLeft", fontSize: 13 }} />
                      <ChartTooltip
                        labelFormatter={(label, payload) =>
                          payload?.[0]?.payload?.__fiscalYearLabel
                            ? `${payload[0].payload.__fiscalYearLabel} · ${label}`
                            : label
                        }
                        formatter={(value, name) => [Number(value).toLocaleString(), name]}
                      />
                      {bgExpiryColumns.map((category) => (
                        <Bar
                          key={category.key}
                          dataKey={category.key}
                          name={category.label}
                          stackId="bg-expiry"
                          fill={category.color}
                          cursor="pointer"
                          onClick={(_entry, index) => {
                            const row = group.rows[index];
                            const filter = row && columns.find((column) => column.key === category.key)?.getFilter?.(row);
                            if (filter) onOpenSearch(filter);
                          }}
                        />
                      ))}
                      <ChartLegend />
                    </BarChart>
                  ) : (
                    <BarChart
                      data={group.rows.map((row) => ({
                        ...row,
                        chartLabel: String(row.__chartLabel ?? row[columns[0]?.key ?? ""] ?? ""),
                        chartValue: Number(row[selectedChartColumn.key] ?? 0),
                      }))}
                      margin={{ top: 12, right: 18, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="chartLabel" interval={0} minTickGap={0} tick={{ fontSize: 13 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 13 }} width={64}
                        label={{ value: unitNote || selectedChartColumn.label, angle: -90, position: "insideLeft", fontSize: 13 }} />
                      <ChartTooltip
                        labelFormatter={(label, payload) =>
                          payload?.[0]?.payload?.__fiscalYearLabel
                            ? `${payload[0].payload.__fiscalYearLabel} · ${label}`
                            : label
                        }
                        formatter={(value) =>
                          valueFormatter
                            ? valueFormatter(selectedChartColumn.key, Number(value))
                            : Number(value).toLocaleString()
                        }
                      />
                      <Bar
                        dataKey="chartValue"
                        name={selectedChartColumn.label}
                        fill="#0f766e"
                        cursor="pointer"
                        onClick={(_entry, index) => {
                          const row = group.rows[index];
                          const filter = row && selectedChartColumn.getFilter?.(row);
                          if (filter) onOpenSearch(filter);
                        }}
                      />
                    </BarChart>
                  )}
                  </ResponsiveContainer>
                </div>
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {resultView === "table" || !numericColumns.length ? <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={
                      "px-3 py-2.5 font-semibold " +
                      (column.align === "right" ? "text-right" : "text-left")
                    }
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row, index) => (
                  <tr
                    key={`${row.monthKey}:${index}`}
                    className={
                      "border-b border-border/60 last:border-0 " +
                      (index % 2 === 0 ? "bg-card" : "bg-secondary/15")
                    }
                  >
                    {columns.map((column, columnIndex) => {
                      const rawValue = row[column.key] ?? "";
                      const value = valueFormatter
                        ? valueFormatter(column.key, rawValue)
                        : String(rawValue);
                      const filter = column.getFilter?.(row);
                      const totalLabelFilter =
                        columnIndex === 0 && value === "Total"
                          ? getMonthlyReportRowTotalFilter(columns, row)
                          : undefined;
                      const yearKey = String(row.yearKey ?? "");
                      const isYearLabel =
                        viewMode === "inline" &&
                        column.key === "periodLabel" &&
                        row.__displayKind === "year" &&
                        Boolean(onYearSelect);
                      const isMonthLabel =
                        viewMode === "inline" &&
                        column.key === "periodLabel" &&
                        row.__displayKind === "month";
                      return (
                        <td
                          key={column.key}
                          className={
                            "px-3 py-2.5 " +
                            (isMonthLabel ? "pl-9 text-muted-foreground " : "") +
                            (column.align === "right" ? "text-right tabular-nums" : "text-left")
                          }
                        >
                          {totalLabelFilter ? (
                            <button
                              type="button"
                              onClick={() => onOpenSearch(totalLabelFilter)}
                              className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10"
                            >
                              {value}
                            </button>
                          ) : isYearLabel ? (
                            <button
                              type="button"
                              onClick={() => onYearSelect?.(yearKey)}
                              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10"
                            >
                              {row.__expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                              {value}
                            </button>
                          ) : filter && value !== "0" ? (
                            <button
                              type="button"
                              onClick={() => onOpenSearch(filter)}
                              className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10"
                            >
                              {value}
                            </button>
                          ) : (
                            value
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-3 py-8 text-center text-sm text-muted-foreground"
                  >
                    No rows found.
                  </td>
                </tr>
              )}
            </tbody>
            {showTotalFooter ? (
              <tfoot>
                <tr className="border-t border-border bg-muted/40 font-semibold">
                  {totalCells.map((cell, index) => (
                    <td
                      key={columns[index]?.key ?? index}
                      className={
                        "px-3 py-2.5 " +
                        ((columns[index]?.align ?? "left") === "right"
                          ? "text-right tabular-nums"
                          : "text-left")
                      }
                    >
                      {cell.filter && (index === 0 || cell.value !== "0") ? (
                        <button
                          type="button"
                          onClick={() => onOpenSearch(cell.filter!)}
                          className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10"
                        >
                      {valueFormatter
                        ? valueFormatter(columns[index]?.key ?? "", cell.value)
                        : cell.value}
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
      </div> : null}
    </div>
  );
}

function ReportBreadcrumb({
  items,
}: {
  items: Array<{ label: string; onClick?: () => void } | undefined>;
}) {
  const visibleItems = items.filter((item): item is { label: string; onClick?: () => void } =>
    Boolean(item),
  );
  if (visibleItems.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
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

function getMonthlyReportTotalCells(
  columns: MonthlyReportColumn[],
  rows: Array<Record<string, number | string>>,
  context: MonthlyReportTotalContext,
) {
  const numericCells = columns.slice(1).map((column) => {
    const total = rows.reduce((sum, row) => {
      const value = Number(row[column.key] ?? 0);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
    return {
      value: String(total),
      filter: column.getTotalFilter?.(rows, context),
    };
  });
  const primaryTotalFilter = numericCells.find((cell) => cell.filter && cell.value !== "0")?.filter;
  return [{ value: "Total", filter: primaryTotalFilter }, ...numericCells];
}

function getMonthlyReportRowTotalFilter(
  columns: MonthlyReportColumn[],
  row: Record<string, number | string>,
) {
  const primaryColumn = columns.slice(1).find((column) => {
    const value = Number(row[column.key] ?? 0);
    return Number.isFinite(value) && value > 0 && Boolean(column.getFilter?.(row));
  });
  return primaryColumn?.getFilter?.(row);
}

function DivisionFilter({
  divisions,
  activeDivision,
  onDivisionChange,
}: {
  divisions: ReturnType<typeof useAccessibleDivisions>;
  activeDivision: string;
  onDivisionChange: (division: string) => void;
}) {
  const divisionFilterActive = activeDivision !== "all";
  return (
    <label
      className={filterLabelClass(
        divisionFilterActive,
        "flex min-w-[150px] flex-col gap-1 text-xs text-muted-foreground",
      )}
    >
      <span>Division</span>
      <select
        value={activeDivision}
        onChange={(event) => onDivisionChange(event.target.value)}
        className={filterControlClass(
          divisionFilterActive,
          "h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40",
        )}
      >
        <option value="all">All divisions</option>
        {divisions.map((division) => (
          <option key={division.id} value={division.name}>
            {division.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReportHeaderActions({
  onPdf,
  onExcel,
  disabled = false,
}: {
  divisions?: ReturnType<typeof useAccessibleDivisions>;
  activeDivision?: string;
  onDivisionChange?: (division: string) => void;
  showDivision?: boolean;
  onPdf?: (plot?: ExportPlot) => void;
  onExcel?: (plot?: ExportPlot) => void;
  disabled?: boolean;
}) {
  const plot = useContext(ExportPlotContext);
  return (
    <>
      {onPdf || onExcel ? (
        <div className="inline-flex h-9 overflow-hidden rounded-md border border-border bg-card">
          {onPdf ? (
            <button
              type="button"
              onClick={() => onPdf(plot)}
              disabled={disabled}
              aria-label="Export PDF"
              title="Export PDF"
              className="inline-flex h-full items-center gap-1.5 px-3 text-sm font-medium hover:bg-accent"
            >
              <FileText className="size-4" />
              PDF
            </button>
          ) : null}
          {onPdf && onExcel ? <div className="h-full w-px bg-border" aria-hidden="true" /> : null}
          {onExcel ? (
            <button
              type="button"
              onClick={() => onExcel(plot)}
              disabled={disabled}
              aria-label="Export Excel"
              title="Export Excel"
              className="inline-flex h-full items-center gap-1.5 px-3 text-sm font-medium hover:bg-accent"
            >
              <FileSpreadsheet className="size-4" />
              Excel
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function FileCategoryFilter({
  selectedCategories,
  options,
  disabled = false,
  active = false,
  onChange,
  locked,
  lockDisabled,
  browserOnly,
  onLockToggle,
}: {
  selectedCategories: FileCategoryKey[];
  options: FileCategoryOption[];
  disabled?: boolean;
  active?: boolean;
  onChange: (category: FileCategoryKey, checked: boolean) => void;
  locked: boolean;
  lockDisabled: boolean;
  browserOnly: boolean;
  onLockToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedVisibleCount = options.filter((option) =>
    selectedCategories.includes(option.key),
  ).length;
  const summary = `${selectedVisibleCount}/${options.length} selected`;

  return (
    <div className={filterLabelClass(active, "flex flex-col gap-1 text-xs text-muted-foreground")}>
      <span>File Type</span>
      <div className="flex items-start gap-1.5">
        <div
          className={
            filterControlClass(active, "rounded-md border border-input bg-background") +
            (disabled && !locked ? " opacity-60" : "")
          }
        >
          <button
            type="button"
            aria-expanded={open}
            disabled={disabled && !locked}
            onClick={() => setOpen((current) => !current)}
            className={
              "flex min-h-9 w-full items-center justify-between gap-3 px-2 py-1.5 text-left text-sm hover:bg-accent/60 disabled:cursor-not-allowed " +
              (active ? "text-destructive" : "text-foreground")
            }
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
                    disabled={disabled}
                    onChange={(event) => onChange(option.key, event.target.checked)}
                    className="size-4 rounded border-input disabled:cursor-not-allowed"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onLockToggle}
          disabled={lockDisabled}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          title={locked ? "Unlock File Type filter" : "Lock and save File Type filter"}
          aria-label={locked ? "Unlock File Type filter" : "Lock and save File Type filter"}
        >
          {locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
        </button>
        <FloatingHelper
          text={browserOnly
            ? "Lock saves these File Type choices in this browser for the shared viewer. Unlock to change them."
            : "Lock saves these File Type choices for your account. They return when you sign in again. Unlock to change them."}
          label="File Type lock help"
          className="size-8 border-0 bg-transparent shadow-none"
          iconClassName="size-3"
        />
      </div>
    </div>
  );
}

function FileInitiationDateRangeFilter({
  fromDate,
  toDate,
  disabled = false,
  active = false,
  onFromDateChange,
  onToDateChange,
  onClear,
}: {
  fromDate: string;
  toDate: string;
  disabled?: boolean;
  active?: boolean;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  onClear: () => void;
}) {
  const hasRange = Boolean(fromDate || toDate);
  return (
    <div className={filterLabelClass(active, "flex flex-col gap-1 text-xs text-muted-foreground")}>
      <span className="inline-flex items-center gap-1">
        Initiation date
        <FloatingHelper
          text={fileInitiationDateRangeHelper}
          label="Initiation date range help"
          side="top"
          className="size-5 border-0 bg-transparent shadow-none"
          iconClassName="size-3"
        />
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

function FileYearFilter({
  value,
  options,
  locked,
  disabled = false,
  active = false,
  allOptionLabel = "All file years",
  onChange,
  onLockToggle,
}: {
  value: string;
  options: string[];
  locked: boolean;
  disabled?: boolean;
  active?: boolean;
  allOptionLabel?: string;
  onChange: (year: string) => void;
  onLockToggle: () => void;
}) {
  const disabledValue = "__not_applied__";
  const helperText = disabled
    ? [
        "File Initiation Year is not used for this report.",
        "This report uses the effective FY from the Global Filter.",
      ]
    : fileYearSubfilterHelper;
  return (
    <div className="flex items-end gap-1.5">
      <label
        className={filterLabelClass(
          active,
          "flex min-w-[160px] flex-col gap-1 text-xs text-muted-foreground",
        )}
      >
        <span className="inline-flex items-center gap-1">
          File Initiation Year
          <FloatingHelper
            text={helperText}
            label="File initiation year subfilter help"
            side="top"
            className="size-5 border-0 bg-transparent shadow-none"
            iconClassName="size-3"
          />
        </span>
        <select
          value={disabled ? disabledValue : value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={filterControlClass(
            active,
            "h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
          )}
        >
          {disabled ? (
            <option value={disabledValue}>Not applied</option>
          ) : (
            <>
              <option value="all">{allOptionLabel}</option>
              {options.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </>
          )}
        </select>
      </label>
      <button
        type="button"
        onClick={onLockToggle}
        disabled={disabled}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:hover:bg-muted"
        title={
          disabled
            ? "File initiation year is not used for this report"
            : locked
              ? "Unlock file initiation year"
              : "Lock file initiation year"
        }
        aria-label={
          disabled
            ? "File initiation year is not used for this report"
            : locked
              ? "Unlock file initiation year"
              : "Lock file initiation year"
        }
      >
        {locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
      </button>
      <FloatingHelper
        text={[
          "This lock is session based; it is kept only for the current browser session/tab.",
          "Lock keeps this File Initiation Year selection fixed on Dashboard and Reports until you unlock it or the session resets.",
          "Unlock allows the File Initiation Year subfilter to follow changes again.",
        ]}
        label="File initiation year lock help"
        className="size-8 border-0 bg-transparent shadow-none"
        iconClassName="size-3"
      />
    </div>
  );
}

function FirmDatabaseReport({
  title,
  rows,
  loading,
  sortKey,
  sortDirection,
  locked,
  saving,
  layoutError,
  visibleColumns,
  actions,
  onSortKeyChange,
  onSortDirectionChange,
  onVisibleColumnsChange,
  onRestoreDefaultColumns,
  onLockToggle,
  onOpenFiles,
}: {
  title: string;
  rows: FirmDatabaseRow[];
  loading: boolean;
  sortKey: FirmDatabaseSortKey;
  sortDirection: FirmDatabaseSortDirection;
  locked: boolean;
  saving: boolean;
  layoutError?: string;
  visibleColumns: FirmDatabaseColumnKey[];
  actions: ReactNode;
  onSortKeyChange: (key: FirmDatabaseSortKey) => void;
  onSortDirectionChange: (direction: FirmDatabaseSortDirection) => void;
  onVisibleColumnsChange: (columns: FirmDatabaseColumnKey[]) => void;
  onRestoreDefaultColumns: () => void;
  onLockToggle: () => void;
  onOpenFiles: (fileIds: string[]) => void;
}) {
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [resultView, setResultView] = useState<ResultView>("table");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof firmDatabasePageSizeOptions)[number]>(25);
  const [divisionPopupRow, setDivisionPopupRow] = useState<FirmDatabaseRow | undefined>();
  const selectedColumns = firmDatabaseColumns.filter(
    (column) => column.key === "serial" || visibleColumns.includes(column.key),
  );
  const analysisColumn = firmDatabaseColumns.find((column) => column.key === sortKey)!;
  const groups = Array.from(new Set(firmDatabaseColumns.map((column) => column.group)));
  const summary = getFirmDatabaseSummary(rows);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = rows.length ? (safePage - 1) * pageSize : 0;
  const pageEnd = Math.min(pageStart + pageSize, rows.length);
  const visibleRows = rows.slice(pageStart, pageEnd);
  const chartMaximum = Math.max(1, ...visibleRows.map((row) => row.numeric[sortKey] ?? 0));
  const firmChartAvailable = visibleRows.some((row) => row.numeric[sortKey] !== undefined);
  const firmChartUsesCurrency = [
    "capitalValue",
    "revenueValue",
    "totalValue",
    "averageOrderValue",
    "highestOrderValue",
  ].includes(sortKey);
  const exportPlot: ExportPlot | undefined =
    resultView !== "table" && firmChartAvailable
      ? {
          kind: "bar",
          title: `${title} · ${analysisColumn.label}`,
          measure: analysisColumn.label,
          unit: firmChartUsesCurrency ? "INR" : "Count",
          xAxisTitle: "Firm",
          yAxisTitle: `${analysisColumn.label} ${firmChartUsesCurrency ? "INR" : "Count"}`,
          categories: visibleRows.map((row) => String(row.firmName)),
          series: [{ name: analysisColumn.label, values: visibleRows.map((row) => row.numeric[sortKey] ?? 0) }],
        }
      : undefined;

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const toggleColumn = (key: FirmDatabaseColumnKey, checked: boolean) => {
    if (key === "firmName" || key === "serial") return;
    const next = checked
      ? firmDatabaseColumns
          .map((column) => column.key)
          .filter((columnKey) => new Set([...visibleColumns, key]).has(columnKey))
      : visibleColumns.filter((columnKey) => columnKey !== key);
    onVisibleColumnsChange(next.length ? next : ["serial", "firmName"]);
  };

  const setGroup = (group: string, checked: boolean) => {
    const groupKeys = firmDatabaseColumns
      .filter((column) => column.group === group)
      .map((column) => column.key);
    const next = checked
      ? firmDatabaseColumns
          .map((column) => column.key)
          .filter((key) => new Set([...visibleColumns, ...groupKeys]).has(key))
      : visibleColumns.filter(
          (key) => !groupKeys.includes(key) || key === "firmName" || key === "serial",
        );
    onVisibleColumnsChange(next.length ? next : ["serial", "firmName"]);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            Firm-wise supply order, value, delivery, BG, rating, and coverage analysis.
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2">
          {firmChartAvailable ? <TableChartToggle value={resultView} onChange={setResultView} label="Firm Performance view" /> : null}
          <ExportPlotContext.Provider value={exportPlot}>{actions}</ExportPlotContext.Provider>
        </div>
      </div>

      {loading ? (
        <div className="mb-5 rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          Updating Firm Performance report...
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FirmDatabaseStat label="Firms" value={summary.firms} />
        <FirmDatabaseStat
          label="Supply orders"
          value={summary.totalSupplyOrders}
          onClick={() => onOpenFiles(summary.totalSupplyOrderFileIds)}
        />
        <FirmDatabaseStat
          label="Running S.O."
          value={summary.runningSupplyOrders}
          onClick={() => onOpenFiles(summary.runningSupplyOrderFileIds)}
        />
        <FirmDatabaseStat label="Total value" value={formatCurrency(summary.totalValue)} />
      </div>

      <div className="mb-4 rounded-md border border-border bg-secondary/20 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] flex-1 text-xs text-muted-foreground sm:flex-none">
            <span className="mb-1 block">Sort field</span>
            <select
              value={sortKey}
              onChange={(event) => onSortKeyChange(event.target.value as FirmDatabaseSortKey)}
              disabled={locked}
              className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
            >
              {firmDatabaseColumns
                .filter((column) => column.key !== "serial")
                .map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="min-w-[150px] text-xs text-muted-foreground">
            <span className="mb-1 block">Order</span>
            <select
              value={sortDirection}
              onChange={(event) =>
                onSortDirectionChange(event.target.value as FirmDatabaseSortDirection)
              }
              disabled={locked}
              className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setFieldsOpen((current) => !current)}
            disabled={locked}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent"
          >
            <ChevronDown
              className={"size-4 transition-transform " + (fieldsOpen ? "rotate-180" : "")}
            />
            Display fields
            <span className="rounded border border-border bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
              {visibleColumns.length}/{firmDatabaseColumns.length}
            </span>
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRestoreDefaultColumns}
              disabled={locked || saving}
              className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent disabled:opacity-50"
            >
              Restore saved layout
            </button>
            <button
              type="button"
              onClick={onLockToggle}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent disabled:opacity-50"
              title={locked ? "Unlock your saved Firm Performance layout" : "Save and lock your Firm Performance layout"}
              aria-label={locked ? "Unlock Firm Performance layout" : "Save and lock Firm Performance layout"}
            >
              {locked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />}
              {saving ? "Saving..." : locked ? "Unlock layout" : "Lock and save layout"}
            </button>
            <button
              type="button"
              onClick={() =>
                onVisibleColumnsChange(firmDatabaseColumns.map((column) => column.key))
              }
              disabled={locked || saving}
              className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent disabled:opacity-50"
            >
              Select all
            </button>
          </div>
        </div>

        {fieldsOpen ? (
          <div className="mt-3 border-t border-border pt-3">
            <div className="mb-2 flex flex-wrap gap-2">
              {groups.map((group) => {
                const groupColumns = firmDatabaseColumns.filter((column) => column.group === group);
                const checkedCount = groupColumns.filter((column) =>
                  visibleColumns.includes(column.key),
                ).length;
                return (
                    <button
                      key={group}
                      type="button"
                      onClick={() => setGroup(group, checkedCount !== groupColumns.length)}
                      disabled={locked}
                      className="rounded-md border border-border bg-background px-2.5 py-1 text-xs hover:bg-accent"
                  >
                    {group} {checkedCount}/{groupColumns.length}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {groups.map((group) => {
                const groupColumns = firmDatabaseColumns.filter((column) => column.group === group);
                const checkedCount = groupColumns.filter((column) =>
                  visibleColumns.includes(column.key),
                ).length;
                return (
                  <div key={group} className="rounded-md border border-border bg-background p-3">
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold">
                      <input
                        type="checkbox"
                        checked={checkedCount === groupColumns.length}
                        ref={(element) => {
                          if (element) {
                            element.indeterminate =
                              checkedCount > 0 && checkedCount < groupColumns.length;
                          }
                        }}
                        onChange={(event) => setGroup(group, event.target.checked)}
                        disabled={locked}
                        className="size-4 rounded border-input"
                      />
                      <span>{group}</span>
                    </label>
                    <div className="space-y-1.5">
                      {groupColumns.map((column) => (
                        <label key={column.key} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={visibleColumns.includes(column.key)}
                            disabled={locked || column.key === "firmName" || column.key === "serial"}
                            onChange={(event) => toggleColumn(column.key, event.target.checked)}
                            className="size-4 rounded border-input"
                          />
                          <span>{column.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Lock and save stores your displayed fields and analysis sort for your account across future visits.
      </p>
      {layoutError ? (
        <p className="mb-3 text-xs text-destructive" role="alert">
          {layoutError}
        </p>
      ) : null}

      <FirmDatabasePaginationControls
        rowsLength={rows.length}
        pageStart={pageStart}
        pageEnd={pageEnd}
        pageSize={pageSize}
        safePage={safePage}
        totalPages={totalPages}
        onPageSizeChange={(nextPageSize) => {
          setPageSize(nextPageSize);
          setPage(1);
        }}
        onPageChange={setPage}
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
      />

      {resultView !== "table" && firmChartAvailable ? (
        <div data-chart-copy-area className="mb-4 rounded-lg border border-border bg-background p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Firm Performance · {analysisColumn.label}</h3>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
            Showing the firms on this table page, ranked by {analysisColumn.label}. Select a bar to open its matching files.
            </p>
            <ChartCopyButton />
          </div>
          <p className="mb-2 text-right text-xs text-muted-foreground">{analysisColumn.label}</p>
          <div role="group" aria-label="Firm performance chart" className="space-y-3">
            {visibleRows.map((row) => {
              const value = row.numeric[sortKey] ?? 0;
              const clickTarget = row.clickTargets[sortKey] ?? [];
              return (
                <button key={row.id} type="button" disabled={!clickTarget.length || value <= 0}
                  onClick={() => onOpenFiles(clickTarget)}
                  className="grid w-full grid-cols-[minmax(7rem,14rem)_minmax(4rem,1fr)] items-center gap-3 py-2 text-left disabled:cursor-default"
                  title={clickTarget.length ? `Open ${row.firmName} files` : undefined}>
                  <span className="truncate text-xs font-medium text-foreground">{row.firmName}</span>
                  <span className="min-w-0 pt-4">
                    <span className="relative block h-5 overflow-visible rounded-sm bg-muted">
                      <span className="block h-full rounded-sm bg-primary" style={{ width: value > 0 ? `${Math.max(1, value / chartMaximum * 100)}%` : "0%" }} />
                      <span className="absolute -top-4 -translate-x-full whitespace-nowrap text-xs font-semibold tabular-nums text-foreground" style={{ left: `${value > 0 ? Math.max(1, value / chartMaximum * 100) : 0}%` }}>
                        {firmChartUsesCurrency ? formatCurrency(value) : value.toLocaleString()}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {resultView === "table" || !firmChartAvailable ? <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                {selectedColumns.map((column) => (
                  <th key={column.key} className="px-3 py-2.5 text-left font-semibold">
                    {column.label}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-left font-semibold">
                  {analysisColumn.label}
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length ? (
                visibleRows.map((row, index) => (
                  <tr
                    key={row.id}
                    className={
                      "border-b border-border/60 last:border-0 " +
                      (index % 2 === 0 ? "bg-card" : "bg-secondary/15")
                    }
                  >
                    {selectedColumns.map((column) => {
                      const value =
                        column.key === "serial" ? pageStart + index + 1 : row[column.key];
                      const clickTarget = row.clickTargets[column.key] ?? [];
                      const numericValue = row.numeric[column.key];
                      const clickable =
                        clickTarget.length > 0 &&
                        numericValue !== undefined &&
                        numericValue > 0 &&
                        column.key !== "serial";
                      const textWidth = getCompactTableTextWidth(column.key, column.label);
                      const displayValue =
                        textWidth && typeof value === "string" ? (
                          <CompactTableText value={value} width={textWidth} />
                        ) : (
                          value
                        );
                      return (
                        <td
                          key={column.key}
                          className="px-3 py-2.5 text-left align-top"
                        >
                          {column.key === "divisions" ? (
                            <button
                              type="button"
                              onClick={() => setDivisionPopupRow(row)}
                              className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent"
                            >
                              View
                            </button>
                          ) : clickable ? (
                            <button
                              type="button"
                              onClick={() => onOpenFiles(clickTarget)}
                              className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10"
                            >
                              {displayValue}
                            </button>
                          ) : (
                            displayValue
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-left align-top">
                      {(() => {
                        const value = row[sortKey];
                        const clickTarget = row.clickTargets[sortKey] ?? [];
                        const clickable = clickTarget.length > 0 && (row.numeric[sortKey] ?? 0) > 0;
                        const textWidth = getCompactTableTextWidth(sortKey, analysisColumn.label);
                        const displayValue = textWidth && typeof value === "string" ? (
                          <CompactTableText value={value} width={textWidth} />
                        ) : value;
                        return clickable ? (
                          <button
                            type="button"
                            onClick={() => onOpenFiles(clickTarget)}
                            className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10"
                          >
                            {displayValue}
                          </button>
                        ) : displayValue;
                      })()}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={selectedColumns.length + 1}
                    className="px-3 py-8 text-center text-sm text-muted-foreground"
                  >
                    No firms found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div> : null}

      <div className="mt-3">
        <FirmDatabasePaginationControls
          rowsLength={rows.length}
          pageStart={pageStart}
          pageEnd={pageEnd}
          pageSize={pageSize}
          safePage={safePage}
          totalPages={totalPages}
          onPageSizeChange={(nextPageSize) => {
            setPageSize(nextPageSize);
            setPage(1);
          }}
          onPageChange={setPage}
          onPrevious={() => setPage((current) => Math.max(1, current - 1))}
          onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
        />
      </div>
      {divisionPopupRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Divisions served</h3>
                <p className="mt-1 text-xs text-muted-foreground">{divisionPopupRow.firmName}</p>
              </div>
              <button
                type="button"
                onClick={() => setDivisionPopupRow(undefined)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent"
              >
                Close
              </button>
            </div>
            {divisionPopupRow.divisionNames.length ? (
              <div className="max-h-80 overflow-y-auto rounded-md border border-border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                      <th className="w-16 px-3 py-2 text-right">S. No.</th>
                      <th className="px-3 py-2">Division</th>
                    </tr>
                  </thead>
                  <tbody>
                    {divisionPopupRow.divisionNames.map((division, divisionIndex) => (
                      <tr key={division} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2 text-right tabular-nums">{divisionIndex + 1}</td>
                        <td className="px-3 py-2">{division}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                No division linked.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FirmDatabasePaginationControls({
  rowsLength,
  pageStart,
  pageEnd,
  pageSize,
  safePage,
  totalPages,
  onPageSizeChange,
  onPageChange,
  onPrevious,
  onNext,
}: {
  rowsLength: number;
  pageStart: number;
  pageEnd: number;
  pageSize: (typeof firmDatabasePageSizeOptions)[number];
  safePage: number;
  totalPages: number;
  onPageSizeChange: (pageSize: (typeof firmDatabasePageSizeOptions)[number]) => void;
  onPageChange: (page: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const pageNumbers = getPaginationPages(safePage, totalPages);

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <div>
        {rowsLength ? `Showing ${pageStart + 1}-${pageEnd} of ${rowsLength} firms` : "No firms"}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value) as typeof pageSize)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
          >
            {firmDatabasePageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <div className="inline-flex h-8 overflow-hidden rounded-md border border-border bg-card">
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={safePage <= 1}
            className="border-r border-border px-2.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card"
          >
            First
          </button>
          <button
            type="button"
            onClick={onPrevious}
            disabled={safePage <= 1}
            className="px-2.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card"
          >
            Previous
          </button>
          <div className="flex items-center border-x border-border px-2.5 text-xs text-muted-foreground">
            Page <span className="ml-1 font-medium text-foreground">{safePage}</span>
            <span className="mx-1">of</span>
            <span className="font-medium text-foreground">{totalPages}</span>
          </div>
          {pageNumbers.map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              onClick={() => onPageChange(pageNumber)}
              className={
                "border-r border-border px-2.5 text-xs font-medium " +
                (pageNumber === safePage
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent")
              }
            >
              {pageNumber}
            </button>
          ))}
          <button
            type="button"
            onClick={onNext}
            disabled={safePage >= totalPages}
            className="px-2.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card"
          >
            Next
          </button>
          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
            disabled={safePage >= totalPages}
            className="border-l border-border px-2.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card"
          >
            Last
          </button>
        </div>
      </div>
    </div>
  );
}

function FirmDatabaseStat({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string | number;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </>
  );
  return (
    <div className="rounded-md border border-border bg-secondary/20 p-3">
      {onClick ? (
        <button type="button" onClick={onClick} className="block w-full text-left">
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  );
}

type MmgSummarySourceFocus = {
  focusSection: string;
  focusTarget?: string;
  focusMilestone?: string;
};

function getMmgSummarySourceFocus(rowKey: string): MmgSummarySourceFocus {
  if (rowKey.startsWith("mode:")) return { focusSection: "File details", focusTarget: "mode" };
  if (rowKey.startsWith("fileType:"))
    return { focusSection: "File details", focusTarget: "fileType" };
  if (rowKey.startsWith("firmType:"))
    return { focusSection: "Supply order and payment", focusTarget: "firmtype:any" };

  const fileDetails = (focusTarget: string): MmgSummarySourceFocus => ({
    focusSection: "File details",
    focusTarget,
  });
  const scrutiny = (focusTarget: string): MmgSummarySourceFocus => ({
    focusSection: "Scrutiny and control",
    focusTarget,
  });
  const tcec = (focusTarget: string): MmgSummarySourceFocus => ({
    focusSection: "TCEC block",
    focusTarget,
  });
  const approval = (focusTarget: string): MmgSummarySourceFocus => ({
    focusSection: "Approval block",
    focusTarget,
  });
  const bidding = (focusTarget: string): MmgSummarySourceFocus => ({
    focusSection: "Bidding details",
    focusTarget,
  });
  const supplyOrder = (focusTarget: string): MmgSummarySourceFocus => ({
    focusSection: "Supply order and payment",
    focusTarget,
  });

  const sourceByKey: Record<string, MmgSummarySourceFocus> = {
    intendedCapital: fileDetails("valueCapital"),
    intendedRevenue: fileDetails("valueCapital"),
    bookedCapital: fileDetails("valueCapital"),
    bookedRevenue: fileDetails("valueCapital"),
    committedCapital: supplyOrder("supplyorder:any"),
    committedRevenue: supplyOrder("supplyorder:any"),
    totalDemands: fileDetails("receivedDate"),
    nonTcecDemands: fileDetails("tcec"),
    tcecDemands: fileDetails("tcec"),
    obm: fileDetails("mode"),
    pbm: fileDetails("mode"),
    lpc: fileDetails("mode"),
    sbm: fileDetails("mode"),
    lbm: fileDetails("mode"),
    goodsServices: fileDetails("fileType"),
    amc: fileDetails("fileType"),
    mpc: fileDetails("fileType"),
    cars: fileDetails("fileType"),
    om: fileDetails("fileType"),
    scrutinyCompleted: scrutiny("scrutinyCompletionDate"),
    filesWithUsersAfterScrutiny: scrutiny("scrutinyResponseDate"),
    scrutinyToBeDone: scrutiny("scrutinyDate"),
    tcecCompleted: tcec("preTcecMinutesDate"),
    tcecFilesWithMmgForMeeting: tcec("preTcecDate"),
    highValueDemands: fileDetails("highValue"),
    highValueReviewCompleted: approval("highValueMinutesDate"),
    adVettingDemands: fileDetails("ad"),
    adVettingCompleted: approval("adVettingDate"),
    adVettingRemaining: approval("adSentDate"),
    rqaDemands: fileDetails("rqa"),
    rqaVettingDone: approval("rqaApprovalDate"),
    rqaVettingRemaining: approval("rqaSentDate"),
    controllingDone: scrutiny("immsDate"),
    controllingRemaining: scrutiny("imms"),
    filesWithIfa: approval("ifaSentDate"),
    ifaApprovalDone: approval("ifaFinalDate"),
    cfaApprovalDone: approval("cfaDate"),
    cfaApprovalRemaining: approval("cfaSentDate"),
    liveBids: bidding("tenderLive"),
    preBidMeetingDue: bidding("preBidMeetingDate"),
    preBidMeetingCompleted: bidding("preBidMeetingDate"),
    refloatPreBidMeetingDue: bidding("refloatPreBidMeetingDate"),
    refloatPreBidMeetingCompleted: bidding("refloatPreBidMeetingDate"),
    bidsToBeOpened: bidding("bidOpeningDate"),
    bidsOverdueToOpen: bidding("bidOpeningDate"),
    postTcecEvaluationInProgress: tcec("postTcecDate"),
    postTcecCompleted: tcec("postTcecMinutesDate"),
    cncInProgress: approval("cncDate"),
    cncCompleted: approval("cncApprovalDate"),
    financialSanctionCompleted: supplyOrder("financialsanction:completed"),
    financialSanctionPending: supplyOrder("financialsanction:pending"),
    soTotal: supplyOrder("supplyorder:any"),
    soPlaced: supplyOrder("supplyorder:placed"),
    soPending: supplyOrder("supplyorder:pending"),
    soLive: supplyOrder("supplyorder:live"),
    deliveriesDueThisMonth: supplyOrder("deliveryperiod:pending"),
    deliveriesCompletedThisMonth: supplyOrder("delivery:completed"),
    deliveryCompleted: supplyOrder("delivery:completed"),
    deliveryPending: supplyOrder("delivery:pending"),
    deliveryOverdue: supplyOrder("delivery:overdue"),
    deliveryPeriodValid: supplyOrder("deliveryperiod:valid"),
    deliveryPeriodExpired: supplyOrder("deliveryperiod:expired"),
    deliveryPeriodExtended: supplyOrder("dpextension:yes"),
    irPreparationPending: supplyOrder("irpreparation:pending"),
    irReceiptPending: supplyOrder("irreceipt:pending"),
    irCompleted: supplyOrder("irreceipt:completed"),
    totalIrSentToUser: supplyOrder("irpreparation:completed"),
    totalIrReceived: supplyOrder("irreceipt:completed"),
    billPreparationPending: supplyOrder("billpreparation:pending"),
    billPreparationCompleted: supplyOrder("billpreparation:completed"),
    billSentForPaymentPending: supplyOrder("billsentforpayment:pending"),
    billSentForPaymentCompleted: supplyOrder("billsentforpayment:completed"),
    paymentPending: supplyOrder("payment:pending"),
    totalPendingPaymentStagesCases: supplyOrder("payment:pending"),
    paymentCompleted: supplyOrder("payment:completed"),
    billsReturnedForCorrection: supplyOrder("billreturnedforcorrection:any"),
    billsPendingCorrection: supplyOrder("billreturnedforcorrection:pending"),
    billsResubmittedAfterCorrection: supplyOrder("billreturnedforcorrection:resubmitted"),
    returnedBillPaid: supplyOrder("billreturnedforcorrection:paid"),
    supplementaryBillsSubmittedPaymentPending: supplyOrder("supplementarybill:submitted"),
    supplementaryBillsPaid: supplyOrder("supplementarybill:paid"),
    supplementaryBillReturnedForCorrection: supplyOrder("supplementarybill:returned"),
    pendingReturnedSupplementaryBills: supplyOrder("supplementarybill:returned"),
    returnedSupplementaryBillsResubmitted: supplyOrder("supplementarybill:resubmitted"),
    returnedSupplementaryBillsPaid: supplyOrder("supplementarybill:paid"),
    totalPaymentDueThisMonth: supplyOrder("payment:pending"),
    billsSentForCurrentMonthDeliveries: supplyOrder("billsentforpayment:completed"),
    paymentDueFromPreviousMonths: supplyOrder("payment:pending"),
    billsSentForPreviousMonthsDeliveries: supplyOrder("billsentforpayment:completed"),
    totalBillsSentThisMonth: supplyOrder("billsentforpayment:completed"),
    totalPaymentsMadeThisYear: supplyOrder("actualpayment:any"),
    actualPaymentCapital: supplyOrder("actualpayment:any"),
    actualPaymentRevenue: supplyOrder("actualpayment:any"),
    advancePaymentCount: supplyOrder("advancepayment:yes"),
    advancePaid: supplyOrder("advancepayment:paid"),
    advancePending: supplyOrder("advancepayment:pending"),
    advancePaymentCapital: supplyOrder("advancepayment:yes"),
    advancePaymentRevenue: supplyOrder("advancepayment:yes"),
    totalExpectedPaymentRemainingThisYear: supplyOrder("payment:pending"),
    liveFilesThisYear: fileDetails("receivedDate"),
    closedFilesThisYear: { focusSection: "Milestones", focusMilestone: "File Closed" },
    liveFilesPreviousYears: fileDetails("receivedDate"),
    cancelledDemands: fileDetails("demandCancelled"),
    soCancelled: supplyOrder("socancelled:yes"),
    shortclosedSo: supplyOrder("shortclosure:yes"),
    deliveriesOverdue: supplyOrder("delivery:overdue"),
    paymentsOverdue: supplyOrder("payment:overdue"),
    psbPending: supplyOrder("psb:pending"),
    psbReceived: supplyOrder("psb:received"),
    psbExpired: supplyOrder("psb:expired"),
    psbToBeReturned: supplyOrder("psb:tobereturned"),
    psbReturned: supplyOrder("psb:returned"),
    pwbPending: supplyOrder("pwb:pending"),
    pwbReceived: supplyOrder("pwb:received"),
    pwbExpired: supplyOrder("pwb:expired"),
    pwbToBeReturned: supplyOrder("pwb:tobereturned"),
    pwbReturned: supplyOrder("pwb:returned"),
    psbPwbPending: supplyOrder("psbpwb:pending"),
    psbPwbReceived: supplyOrder("psbpwb:received"),
    psbPwbExpired: supplyOrder("psbpwb:expired"),
    psbPwbToBeReturned: supplyOrder("psbpwb:tobereturned"),
    psbPwbReturned: supplyOrder("psbpwb:returned"),
    multipleSupplyOrders: supplyOrder("supplyorder:any"),
    ld: supplyOrder("ld:yes"),
    dpExtension: supplyOrder("dpextension:yes"),
    dpExtensionCount: supplyOrder("dpextension:yes"),
    revisedDp: supplyOrder("deliveryperiod:extended"),
    totalSoValuePlacedThisFy: supplyOrder("supplyorder:placed"),
    totalUnpaidSoValue: supplyOrder("payment:pending"),
    filesClosedPercentage: { focusSection: "Milestones", focusMilestone: "File Closed" },
  };

  return sourceByKey[rowKey] ?? fileDetails("receivedDate");
}

function MmgSummaryReport({
  rows,
  title,
  loading,
  onOpenFiles,
  actions,
}: {
  rows: MmgSummaryRow[];
  title: string;
  loading: boolean;
  onOpenFiles: (row: MmgSummaryRow) => void;
  actions: ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            Selected fields and labels are managed from Settings.
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2">{actions}</div>
      </div>
      {loading ? (
        <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          Updating MMG Summary...
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold">Field</th>
              <th className="px-3 py-2 text-right font-semibold">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => {
                const fileIds = row.fileIds ?? [];
                const clickable =
                  (fileIds.length > 0 || Boolean(row.dashboardFilter)) && Number(row.value) > 0;
                const pendingReview = isMmgSummaryRowPendingReview(row);
                return (
                  <tr key={row.key} className="border-b border-border/70 last:border-0">
                    <td className="px-3 py-2 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={pendingReview ? "text-destructive" : undefined}>
                          {row.label}
                        </span>
                        <FloatingHelper
                          text={getMmgSummaryRowHelper(row)}
                          label={`${row.label} MMG Summary help`}
                          side="right"
                          className="size-5"
                          iconClassName="size-3"
                        />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {clickable ? (
                        <button
                          type="button"
                          onClick={() => onOpenFiles(row)}
                          className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10"
                        >
                          {row.value}
                        </button>
                      ) : (
                        row.value
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center text-muted-foreground">
                  No MMG Summary fields selected.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type MerCashOutgoDraftRow = {
  monthKey: string;
  month: string;
  capital: string;
  revenue: string;
};

function MerDataReport({
  rows,
  title,
  financialYear,
  loading,
  saving,
  editing,
  canEdit,
  dirty,
  error,
  actions,
  onEdit,
  onCancel,
  onSave,
  onAmountChange,
}: {
  rows: MerCashOutgoDraftRow[];
  title: string;
  financialYear: string;
  loading: boolean;
  saving: boolean;
  editing: boolean;
  canEdit: boolean;
  dirty: boolean;
  error?: string;
  actions?: ReactNode;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onAmountChange: (monthKey: string, field: "capital" | "revenue", value: string) => void;
}) {
  const [resultView, setResultView] = useState<ResultView>("table");
  const totals = rows.reduce(
    (sum, row) => {
      const capital = readMerAmount(row.capital);
      const revenue = readMerAmount(row.revenue);
      return {
        capital: sum.capital + capital,
        revenue: sum.revenue + revenue,
        total: sum.total + capital + revenue,
      };
    },
    { capital: 0, revenue: 0, total: 0 },
  );
  const maxMonthlyTotal = Math.max(
    1,
    ...rows.map((row) => readMerAmount(row.capital) + readMerAmount(row.revenue)),
  );
  const exportPlot: ExportPlot | undefined =
    !editing && resultView !== "table"
      ? {
          kind: resultView === "line" ? "line" : "bar",
          title: `${title} · FY ${displayFinancialYearLabel(financialYear)}`,
          measure: "Monthly Capital and Revenue",
          unit: "Lakh",
          xAxisTitle: "Month",
          yAxisTitle: "Amount Lakh",
          categories: rows.map((row) => row.month),
          series: [
            { name: "Capital", values: rows.map((row) => readMerAmount(row.capital)) },
            { name: "Revenue", values: rows.map((row) => readMerAmount(row.revenue)) },
          ],
        }
      : undefined;
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            Month-wise MER values for FY {displayFinancialYearLabel(financialYear)}. Enter amounts in Lakh.
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2">
          <ExportPlotContext.Provider value={exportPlot}>{actions}</ExportPlotContext.Provider>
          {!editing ? <TableChartToggle value={resultView} onChange={setResultView} label={`${title} view`} views={["table", "bar", "line"]} /> : null}
          {editing && canEdit ? (
            <>
              <button
                type="button"
                onClick={onCancel}
                disabled={saving}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={saving || loading || !dirty}
                className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </>
          ) : canEdit ? (
            <button
              type="button"
              onClick={onEdit}
              disabled={loading}
              className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-60"
            >
              Edit
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          Loading MER Data...
        </div>
      ) : (
        <>
          <div className="mb-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm font-semibold text-foreground">
            All the values are in Lakh.
          </div>
          {!editing && resultView !== "table" ? (
            <div data-chart-copy-area className="rounded-md border border-border bg-background p-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">Monthly MER · FY {displayFinancialYearLabel(financialYear)}</h3>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
                <div className="flex flex-wrap gap-4">
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" />Capital</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-emerald-600" />Revenue</span>
                <span>Monthly values in Lakh · FY {displayFinancialYearLabel(financialYear)}</span>
                </div>
                <ChartCopyButton />
              </div>
              {resultView === "line" ? (
                <div className="h-[320px] min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rows.map((row) => ({ month: row.month, capital: readMerAmount(row.capital), revenue: readMerAmount(row.revenue) }))} margin={{ top: 12, right: 18, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="month" tick={{ fontSize: 13 }} />
                      <YAxis tick={{ fontSize: 13 }} width={64}
                        label={{ value: "Lakhs", angle: -90, position: "insideLeft", fontSize: 13 }} />
                      <ChartTooltip formatter={(value) => formatMerChartValue(Number(value))} />
                      <ChartLegend />
                      <Line type="monotone" dataKey="capital" name="Capital" stroke="#0f766e" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
              <div className="overflow-x-auto">
                <div role="group" aria-label="Monthly MER bar chart" className="grid min-w-[1120px] grid-cols-12 gap-x-2">
                  {rows.map((row) => {
                  const capital = readMerAmount(row.capital);
                  const revenue = readMerAmount(row.revenue);
                  const total = capital + revenue;
                  return (
                    <div key={row.monthKey} className="min-w-0 text-center">
                      <span className="text-xs font-semibold tabular-nums text-foreground">{formatMerDisplayValue(total)}</span>
                      <span className="mt-1 flex h-36 items-end justify-center border-b border-border px-1">
                        <span className="flex w-full max-w-12 flex-col justify-end overflow-hidden rounded-t-sm" style={{ height: total ? `${Math.max(3, total / maxMonthlyTotal * 100)}%` : "0%" }}>
                          <span className="bg-emerald-600" style={{ height: total ? `${revenue / total * 100}%` : "0%" }} />
                          <span className="bg-primary" style={{ height: total ? `${capital / total * 100}%` : "0%" }} />
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">{row.month}</span>
                    </div>
                  );
                  })}
                </div>
              </div>
              )}
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">Month</th>
                <th className="px-3 py-2 text-right font-semibold">Capital</th>
                <th className="px-3 py-2 text-right font-semibold">Revenue</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const capital = readMerAmount(row.capital);
                const revenue = readMerAmount(row.revenue);
                return (
                  <tr key={row.monthKey} className="border-b border-border/70 last:border-0">
                    <td className="px-3 py-2 font-medium">{row.month}</td>
                    <td className="px-3 py-2 text-right">
                      {editing && canEdit ? (
                        <MerAmountInput
                          value={row.capital}
                          onChange={(value) => onAmountChange(row.monthKey, "capital", value)}
                        />
                      ) : (
                        formatMerDisplayValue(capital)
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {editing && canEdit ? (
                        <MerAmountInput
                          value={row.revenue}
                          onChange={(value) => onAmountChange(row.monthKey, "revenue", value)}
                        />
                      ) : (
                        formatMerDisplayValue(revenue)
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {formatMerDisplayValue(capital + revenue)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-border bg-secondary/30 font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right">{formatMerDisplayValue(totals.capital)}</td>
                <td className="px-3 py-2 text-right">{formatMerDisplayValue(totals.revenue)}</td>
                <td className="px-3 py-2 text-right">{formatMerDisplayValue(totals.total)}</td>
              </tr>
            </tbody>
          </table>
          </div>
          )}
        </>
      )}
    </div>
  );
}

function MerAmountInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      value={formatAmountInput(value)}
      onChange={(event) => handleFormattedAmountInput(event.currentTarget, onChange)}
      inputMode="decimal"
      className="h-8 w-36 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring/40"
    />
  );
}

function CashOutGoPlanOffsetControl({
  label,
  defaultDays,
  customDays,
  customEnabled,
  disabled,
  active,
  helperText,
  onReset,
  onCustomDaysChange,
}: {
  label: string;
  defaultDays: number;
  customDays?: number;
  customEnabled: boolean;
  disabled: boolean;
  active: boolean;
  helperText: HelperText;
  onReset: () => void;
  onCustomDaysChange: (value: string) => void;
}) {
  return (
    <div className={filterLabelClass(active, "text-xs font-medium")}>
      <span className="mb-1 flex items-center gap-1.5 text-muted-foreground">
        {label}
        <FloatingHelper text={helperText} />
      </span>
      <span className="flex items-center gap-1.5">
        <span className="flex h-9 items-center rounded-md border border-border bg-secondary/20 px-2 text-xs text-muted-foreground">
          Default {defaultDays}d
        </span>
        <input
          type="number"
          min="0"
          value={customEnabled ? (customDays ?? defaultDays) : defaultDays}
          onChange={(event) => onCustomDaysChange(event.target.value)}
          className={filterControlClass(
            active,
            "h-9 w-20 rounded-md border border-input bg-background px-2 text-sm",
          )}
          disabled={disabled}
          aria-label={`${label} days`}
        />
        <button
          type="button"
          className="btn-ghost h-9 w-9 p-0"
          onClick={onReset}
          disabled={disabled}
          title={`Reset ${label} to default`}
          aria-label={`Reset ${label} to default`}
        >
          <RotateCcw className="size-4" />
        </button>
        <FloatingHelper
          text={`Reset restores ${label} to the shared default of ${defaultDays} days. Save the plan to keep the selected value for future visits; it remains in your permitted personal or shared plan until changed and saved again.`}
          label={`${label} reset help`}
          className="size-8 border-0 bg-transparent shadow-none"
          iconClassName="size-3"
        />
      </span>
    </div>
  );
}

function MerSoftwareComparisonReport({
  rows,
  totals,
  title,
  showDifference,
  actions,
  loading,
  error,
}: {
  rows: Array<{
    monthKey: string;
    month: string;
    merCapital: number;
    merRevenue: number;
    merTotal: number;
    softwareCapital: number;
    softwareRevenue: number;
    softwareTotal: number;
    difference: number;
  }>;
  totals: {
    merCapital: number;
    merRevenue: number;
    merTotal: number;
    softwareCapital: number;
    softwareRevenue: number;
    softwareTotal: number;
    difference: number;
  };
  title: string;
  showDifference: boolean;
  actions?: ReactNode;
  loading: boolean;
  error?: string;
}) {
  const [resultView, setResultView] = useState<ResultView>("table");
  const [chartMeasure, setChartMeasure] = useState<"total" | "capital" | "revenue">("total");
  const amount = (value: number) => formatThousandsAndLakhs(value, 2);
  const merAmount = (value: number) => (value > 0 ? amount(value) : "-");
  const merKey = chartMeasure === "total" ? "merTotal" : chartMeasure === "capital" ? "merCapital" : "merRevenue";
  const recordedKey = chartMeasure === "total" ? "softwareTotal" : chartMeasure === "capital" ? "softwareCapital" : "softwareRevenue";
  const chartMax = Math.max(1, ...rows.flatMap((row) => [row[merKey], row[recordedKey]]));
  const exportPlot: ExportPlot | undefined = resultView !== "table"
    ? {
        kind: resultView === "line" ? "line" : "bar",
        title: `${title} · ${chartMeasure}`,
        measure: chartMeasure === "total" ? "Total value" : `${chartMeasure[0].toUpperCase()}${chartMeasure.slice(1)} value`,
        unit: "Lakh",
        xAxisTitle: "Payment month",
        yAxisTitle: `${chartMeasure === "total" ? "Total" : `${chartMeasure[0].toUpperCase()}${chartMeasure.slice(1)}`} amount Lakh`,
        categories: rows.map((row) => row.month),
        series: [
          { name: "MER", values: rows.map((row) => row[merKey]) },
          { name: "Recorded Payments", values: rows.map((row) => row[recordedKey]) },
        ],
      }
    : undefined;
  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            MER compared with Recorded Payments by payment month. Recorded Payments include S.O./stage, advance, and supplementary payments.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TableChartToggle value={resultView} onChange={setResultView} label={`${title} view`} views={["table", "bar", "line"]} />
          <ExportPlotContext.Provider value={exportPlot}>{actions}</ExportPlotContext.Provider>
        </div>
      </div>
      <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm font-semibold text-foreground">
        All the values are in Lakh.
      </div>
      {!showDifference ? (
        <p className="text-xs text-muted-foreground">
          MER is an all-division reference; recorded payments follow the selected scope. Difference is shown only for an all-division, all-file-type view.
        </p>
      ) : null}
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      ) : null}
      {loading ? (
        <div className="rounded-md border border-border bg-secondary/20 px-3 py-3 text-sm text-muted-foreground">Loading MER and Recorded Payments...</div>
      ) : null}
      {resultView !== "table" ? (
        <div data-chart-copy-area className="rounded-md border border-border bg-background p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Monthly MER and Recorded Payments, using the same FY rows as the table.</p>
            {resultView === "bar" ? <span className="text-xs text-muted-foreground">Amount (Lakhs)</span> : null}
            <label data-chart-copy-exclude className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Measure
              <select value={chartMeasure} onChange={(event) => setChartMeasure(event.target.value as typeof chartMeasure)}
                className="h-8 rounded-md border border-input bg-background px-2 text-foreground">
                <option value="total">Total</option><option value="capital">Capital</option><option value="revenue">Revenue</option>
              </select>
            </label>
            <ChartCopyButton />
          </div>
          <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" />MER</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-emerald-600" />Recorded Payments</span>
          </div>
          {resultView === "line" ? (
            <div className="h-[320px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 12, right: 18, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 13 }} />
                  <YAxis tick={{ fontSize: 13 }} width={64}
                    label={{ value: "Lakhs", angle: -90, position: "insideLeft", fontSize: 13 }} />
                  <ChartTooltip
                    formatter={(value, name) =>
                      name === "MER" ? formatMerChartValue(Number(value)) : `${amount(Number(value))} Lakh`
                    }
                  />
                  <ChartLegend />
                  <Line type="monotone" dataKey={merKey} name="MER" stroke="#0f766e" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey={recordedKey} name="Recorded Payments" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <div role="group" aria-label={`${title} chart`} className="grid min-w-[1120px] grid-cols-12 gap-2">
              {rows.map((row) => (
              <div key={row.monthKey} className="min-w-0 text-center">
                <div className="mb-2 truncate text-xs font-medium text-muted-foreground">{row.month}</div>
                <div className="flex h-36 items-end justify-center gap-1 border-b border-border px-1">
                  {[{ key: "mer", value: row[merKey], color: "bg-primary" }, { key: "recorded", value: row[recordedKey], color: "bg-emerald-600" }].map((bar) => (
                    <div key={bar.key} className="flex h-full w-8 items-end" title={`${bar.key === "mer" ? "MER" : "Recorded Payments"}: ${bar.key === "mer" ? formatMerChartValue(bar.value) : `${amount(bar.value)} Lakh`}`}>
                      <span className={`w-full rounded-t-sm ${bar.color}`} style={{ height: bar.value > 0 ? `${Math.max(2, bar.value / chartMax * 100)}%` : "0%" }} />
                    </div>
                  ))}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-1 text-[10px] tabular-nums text-muted-foreground">
                  <span>{merAmount(row[merKey])}</span><span>{amount(row[recordedKey])}</span>
                </div>
              </div>
              ))}
            </div>
          </div>
          )}
        </div>
      ) : (
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[920px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/30 text-xs text-muted-foreground">
              <th rowSpan={2} className="px-3 py-2 text-left font-semibold">Month</th>
              <th colSpan={3} className="px-3 py-2 text-center font-semibold">MER</th>
              <th colSpan={3} className="px-3 py-2 text-center font-semibold">Recorded Payments</th>
              <th rowSpan={2} className="px-3 py-2 text-right font-semibold">
                {showDifference ? "Difference (MER - Recorded)" : "Difference (all-scope only)"}
              </th>
            </tr>
            <tr className="border-b border-border bg-secondary/20 text-xs text-muted-foreground">
              {["Capital", "Revenue", "Total", "Capital", "Revenue", "Total"].map((label, index) => (
                <th key={`${label}-${index}`} className="px-3 py-2 text-right font-semibold">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && !error ? rows.map((row) => (
              <tr key={row.monthKey} className="border-b border-border/70 last:border-0">
                <td className="px-3 py-2 font-medium">{row.month}</td>
                <td className="px-3 py-2 text-right">{merAmount(row.merCapital)}</td>
                <td className="px-3 py-2 text-right">{merAmount(row.merRevenue)}</td>
                <td className="px-3 py-2 text-right font-medium">{merAmount(row.merTotal)}</td>
                <td className="px-3 py-2 text-right">{amount(row.softwareCapital)}</td>
                <td className="px-3 py-2 text-right">{amount(row.softwareRevenue)}</td>
                <td className="px-3 py-2 text-right font-medium">{amount(row.softwareTotal)}</td>
                <td className="px-3 py-2 text-right">{showDifference ? amount(row.difference) : "-"}</td>
              </tr>
            )) : null}
            {!loading && !error && rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-muted-foreground">No monthly data available for this FY.</td></tr>
            ) : null}
            <tr className="border-t-2 border-border bg-secondary/20 font-semibold">
              <td className="px-3 py-2">FY Total</td>
              <td className="px-3 py-2 text-right">{merAmount(totals.merCapital)}</td>
              <td className="px-3 py-2 text-right">{merAmount(totals.merRevenue)}</td>
              <td className="px-3 py-2 text-right">{merAmount(totals.merTotal)}</td>
              <td className="px-3 py-2 text-right">{amount(totals.softwareCapital)}</td>
              <td className="px-3 py-2 text-right">{amount(totals.softwareRevenue)}</td>
              <td className="px-3 py-2 text-right">{amount(totals.softwareTotal)}</td>
              <td className="px-3 py-2 text-right">{showDifference ? amount(totals.difference) : "-"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      )}
      {showDifference ? (
        <p className="text-xs text-muted-foreground">
          Difference = MER minus Recorded Payments. MER is an all-division total; recorded payments use the full accessible organization scope.
        </p>
      ) : null}
    </section>
  );
}

function CashOutGoPlanReport({
  plan,
  loading,
  saving,
  dirty,
  error,
  includePreviousFy,
  canEdit,
  canEditSettings,
  onIncludePreviousFyChange,
  onSettingChange,
  onOffsetReset,
  onRowChange,
  onExpectedSentDateReset,
  onOpenSourceFile,
  onOpenRowsSearch,
  onSave,
  saveDisabled,
  onPdf,
  onExcel,
}: {
  plan?: CashOutGoPlanPayload;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error?: string;
  includePreviousFy: boolean;
  canEdit: boolean;
  canEditSettings: boolean;
  onIncludePreviousFyChange: (value: boolean) => void;
  onSettingChange: (
    field: "billOffsetDays" | "handSubmissionOffsetDays" | "dpOffsetDays",
    value: string,
  ) => void;
  onOffsetReset: (field: "billOffsetDays" | "handSubmissionOffsetDays" | "dpOffsetDays") => void;
  onRowChange: (
    rowKey: string,
    field: "expectedSentDate" | "manualExpectedPaymentDate",
    value: string,
  ) => void;
  onExpectedSentDateReset: (rowKey: string) => void;
  onOpenSourceFile: (row: CashOutGoPlanDetailRow) => void;
  onOpenRowsSearch: (rows: CashOutGoPlanDetailRow[]) => void;
  onSave: () => void;
  saveDisabled: boolean;
  onPdf: (expandedSections: CashOutGoPlanExpandedSections) => void;
  onExcel: (expandedSections: CashOutGoPlanExpandedSections) => void;
}) {
  const [expandedDetailSections, setExpandedDetailSections] =
    useState<CashOutGoPlanExpandedSections>(defaultCashOutGoPlanExpandedSections);
  const totals = getExpectedCashOutgoTotals(plan?.monthwisePlan ?? []);
  const capitalPercent = plan
    ? getCashOutGoAllocationPercent(totals.capital, plan.allocation.capital)
    : "";
  const revenuePercent = plan
    ? getCashOutGoAllocationPercent(totals.revenue, plan.allocation.revenue)
    : "";
  const handSubmissionOffsetActive = Boolean(
    plan && plan.settings.handSubmissionOffsetDays !== plan.settings.defaultHandSubmissionOffsetDays,
  );
  const billPaymentOffsetActive = Boolean(
    plan && plan.settings.billOffsetDays !== plan.settings.defaultBillOffsetDays,
  );
  const dpOffsetActive = Boolean(
    plan && plan.settings.dpOffsetDays !== plan.settings.defaultDpOffsetDays,
  );
  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold">Cash Out Go Plan</h2>
              <FloatingHelper
                text={[
                  "Admin and Sub-admin can save the official Cash Out Go Plan and top offset settings.",
                  "Editor can save official row dates, but cannot change the top offset settings or MER.",
                  "Universal Viewer type 1 - View only: can vary filters/view results but cannot save Cash Out Go Plan or MER.",
                  "Universal Viewer type 2 - Personal Cash Out Go only: can save Cash Out Go Plan offsets and row dates for that own account only.",
                  "Universal Viewer type 3 - Global Cash Out Go + MER: can save the official Cash Out Go Plan, top offsets and MER for the software.",
                  "Division users/viewers can view permitted data but cannot save Cash Out Go Plan changes.",
                ]}
                label="Cash Out Go Plan access rules"
                className="size-7"
                iconClassName="size-3"
              />
            </div>
            <ReportDescription description="Global FY cash-outgo plan using MER for past months and gross forecast values for pending bills." />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ReportHeaderActions
              onPdf={() => onPdf(expandedDetailSections)}
              onExcel={() => onExcel(expandedDetailSections)}
              disabled={!plan}
            />
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <CashOutGoPlanOffsetControl
            label="Bill submission offset"
            defaultDays={plan?.settings.defaultHandSubmissionOffsetDays ?? DEFAULT_BILL_SUBMISSION_OFFSET_DAYS}
            customDays={plan?.settings.handSubmissionOffsetDays}
            customEnabled={handSubmissionOffsetActive}
            disabled={!plan || !canEditSettings}
            active={handSubmissionOffsetActive}
            helperText={[
              "This sets the planned submission date for Bills at Hand.",
              `The shared default is ${plan?.settings.defaultHandSubmissionOffsetDays ?? DEFAULT_BILL_SUBMISSION_OFFSET_DAYS} days after the bill-preparation or return date.`,
              "Reset returns to the shared default.",
            ]}
            onCustomDaysChange={(value) => onSettingChange("handSubmissionOffsetDays", value)}
            onReset={() => onOffsetReset("handSubmissionOffsetDays")}
          />
          <CashOutGoPlanOffsetControl
            label="Bill payment offset"
            defaultDays={plan?.settings.defaultBillOffsetDays ?? DEFAULT_BILL_PAYMENT_OFFSET_DAYS}
            customDays={plan?.settings.billOffsetDays}
            customEnabled={billPaymentOffsetActive}
            disabled={!plan || !canEditSettings}
            active={billPaymentOffsetActive}
            helperText={[
              "This sets the planned payment date after a bill is sent or resubmitted.",
              `The shared default is ${plan?.settings.defaultBillOffsetDays ?? DEFAULT_BILL_PAYMENT_OFFSET_DAYS} days after the submission date.`,
              "You can still set a different payment date for an individual row.",
              "Reset returns to the shared default.",
            ]}
            onCustomDaysChange={(value) => onSettingChange("billOffsetDays", value)}
            onReset={() => onOffsetReset("billOffsetDays")}
          />
          <CashOutGoPlanOffsetControl
            label="D.P. offset"
            defaultDays={plan?.settings.defaultDpOffsetDays ?? DEFAULT_DP_OFFSET_DAYS}
            customDays={plan?.settings.dpOffsetDays}
            customEnabled={dpOffsetActive}
            disabled={!plan || !canEditSettings}
            active={dpOffsetActive}
            helperText={[
              "This helps estimate when an undelivered item can be billed after its D.P.",
              "For Items Based on D.P., the plan adds one day after D.P., then this offset.",
              `The shared default for this offset is ${plan?.settings.defaultDpOffsetDays ?? DEFAULT_DP_OFFSET_DAYS} days, after the one-day step.`,
              "Reset returns to the shared default.",
            ]}
            onCustomDaysChange={(value) => onSettingChange("dpOffsetDays", value)}
            onReset={() => onOffsetReset("dpOffsetDays")}
          />
          {canEdit ? (
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-end gap-1">
              <button
                type="button"
                className="btn-ghost h-9 px-2 text-xs"
                onClick={onSave}
                disabled={!plan || saving || !dirty}
                title="Save permitted Cash Out Go Plan changes"
              >
                <Save className="size-3.5" />
                {saving ? "Saving..." : dirty ? "Save plan" : "Saved"}
              </button>
              <FloatingHelper
                text={[
                  "Save plan stores permitted Cash Out Go Plan changes in the software, not just in this browser session.",
                  "Saved offsets and row dates remain in your permitted personal or shared plan on future visits until changed and saved again.",
                  "Admin/Sub-admin and Universal Viewer type 3 can save official top offsets and individual forecast dates.",
                  "Editor can save official row dates only.",
                  "Universal Viewer type 2 saves only that viewer's personal plan.",
                ]}
                label="Save settings help"
                className="size-8"
                iconClassName="size-3"
              />
            </div>
            {saving ? (
              <span className="text-[11px] font-medium text-muted-foreground">Saving changes...</span>
            ) : dirty ? (
              <span className="text-[11px] font-medium text-amber-700">Unsaved changes</span>
            ) : null}
          </div>
          ) : null}
          <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium">
            <input
              type="checkbox"
              checked={includePreviousFy}
              onChange={(event) => onIncludePreviousFyChange(event.target.checked)}
            />
            Include previous FYs submitted bills
            <PreviousFySubmittedBillsHelper
              label="Previous FYs submitted bills help"
              className="size-6 border-0 bg-transparent shadow-none"
              iconClassName="size-3"
            />
          </label>
        </div>

        {error ? (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading Cash Out Go Plan...
          </div>
        ) : !plan ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No Cash Out Go Plan data loaded.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SummaryTile label="Grand FY Capital" value={totals.capital} note={capitalPercent} />
            <SummaryTile label="Grand FY Revenue" value={totals.revenue} note={revenuePercent} />
            <SummaryTile label="Grand FY Total" value={totals.total} />
          </div>
        )}
      </div>

      {plan ? (
        <>
          <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm font-semibold text-foreground">
            All the values are in Lakh.
          </div>
          <CashOutGoSummaryTable plan={plan} onOpenRowsSearch={onOpenRowsSearch} />
          <CashOutGoMonthTable
            rows={plan.expenditureTillDate}
            title="Expenditure Till Date"
            open={expandedDetailSections.expenditureTillDate}
            onOpenChange={(open) =>
              setExpandedDetailSections((current) => ({ ...current, expenditureTillDate: open }))
            }
            titleHelper={[
              "For a past month with a positive MER amount, the table shows MER instead of recorded payments.",
              "If both MER amounts are zero, the table uses recorded payments instead.",
              "The current month is always listed, even when its total is zero.",
            ]}
          />
          <CashOutGoDetailTable
            title="Bills Submitted to PCDA"
            showExpectedSentDate={false}
            currentFinancialYearEnd={plan.selectedFinancialYearEnd}
            helperText={[
              "These bills have already been sent to PCDA, but no payment is recorded yet.",
              "Expected payment is based on the submission date plus the payment offset, unless you set a different date for that row.",
              CASH_OUT_GO_RED_ROW_HELPER,
            ]}
            rows={plan.billsSubmitted}
            open={expandedDetailSections.billsSubmitted}
            onOpenChange={(open) =>
              setExpandedDetailSections((current) => ({ ...current, billsSubmitted: open }))
            }
            onRowChange={onRowChange}
            onExpectedSentDateReset={onExpectedSentDateReset}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            editable={canEdit}
            saving={saving}
            saveDisabled={saveDisabled}
          />
          <CashOutGoDetailTable
            title="Bills at Hand"
            currentFinancialYearEnd={plan.selectedFinancialYearEnd}
            helperText={[
              "These bills are prepared or returned, but are not currently submitted.",
              "The planned submission date starts from the preparation or return date plus the bill-submission offset. Change it when you expect a different date.",
              `The shared default is ${plan.settings.defaultHandSubmissionOffsetDays} days; a different plan-level offset or row date can change the result.`,
              CASH_OUT_GO_RED_ROW_HELPER,
            ]}
            rows={plan.billsAtHand}
            open={expandedDetailSections.billsAtHand}
            onOpenChange={(open) =>
              setExpandedDetailSections((current) => ({ ...current, billsAtHand: open }))
            }
            onRowChange={onRowChange}
            onExpectedSentDateReset={onExpectedSentDateReset}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            editable={canEdit}
            saving={saving}
            saveDisabled={saveDisabled}
          />
          <CashOutGoDetailTable
            title="Items Delivered and Bills Yet to Be Prepared"
            currentFinancialYearEnd={plan.selectedFinancialYearEnd}
            helperText={[
              "These items are delivered or complete, but their bills are not prepared yet.",
              "For Group A (Goods & Services), the plan starts from material receipt when IR = Yes, or Job Completion when IR = No. For Group B (Contract), it starts from D.P. or Revised D.P.",
              "The planned submission date uses the configured D.P. offset.",
              CASH_OUT_GO_RED_ROW_HELPER,
            ]}
            rows={plan.deliveredBillsPending}
            open={expandedDetailSections.deliveredBillsPending}
            onOpenChange={(open) =>
              setExpandedDetailSections((current) => ({
                ...current,
                deliveredBillsPending: open,
              }))
            }
            onRowChange={onRowChange}
            onExpectedSentDateReset={onExpectedSentDateReset}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            editable={canEdit}
            saving={saving}
            saveDisabled={saveDisabled}
          />
          <CashOutGoDetailTable
            title="Items Based on D.P."
            currentFinancialYearEnd={plan.selectedFinancialYearEnd}
            helperText={[
              "This section includes items not yet delivered or completed, plus eligible unpaid advances.",
              "For an item, the planned submission date starts one day after D.P. plus the D.P. offset. You can change it; payment is then planned using the bill-payment offset.",
              "An advance uses its own expected payment date, not the S.O.'s D.P.",
              "D.P. dates after 31 March of the selected FY are not included here.",
              "An advance appears only after its required PSB/PWB is received. Set its expected date in Add/Edit File → Supply Order → Advance Payment.",
              CASH_OUT_GO_RED_ROW_HELPER,
            ]}
            rows={plan.dpBasedForecast ?? []}
            open={expandedDetailSections.dpBasedForecast}
            onOpenChange={(open) =>
              setExpandedDetailSections((current) => ({ ...current, dpBasedForecast: open }))
            }
            onRowChange={onRowChange}
            onExpectedSentDateReset={onExpectedSentDateReset}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            editable={canEdit}
            saving={saving}
            saveDisabled={saveDisabled}
            allowDpExpectedSentDateEdit
            dpOnly
          />
          <CashOutGoMonthTable
            rows={plan.monthwisePlan}
            title="Monthwise Revised Cash Out Go Plan"
            open={expandedDetailSections.monthwisePlan}
            onOpenChange={(open) =>
              setExpandedDetailSections((current) => ({ ...current, monthwisePlan: open }))
            }
            singleRowBars
            showSerial={false}
            titleHelper={[
              "For past months, positive MER replaces recorded payments; if both MER amounts are zero, recorded payments are used.",
              "Current and future months combine recorded payments with the plan's pending bill, delivery, D.P., and eligible advance forecasts.",
              "This is the combined month-by-month view of expected expenditure.",
            ]}
          />
          <CashOutGoDetailTable
            title="Cheque Slips Not Received"
            currentFinancialYearEnd={plan.selectedFinancialYearEnd}
            helperText={[
              "These bills are still unpaid in the file, but a positive MER amount is recorded for their expected-payment month, after that month has passed. Bills expected this month stay in Bills Submitted to PCDA and remain in the current-month forecast.",
              "That is a warning, not proof that this particular bill was paid. For example, MER may include a different bill paid in the same month.",
              "If a bill is returned, it moves to Bills at Hand. After resubmission, its new expected-payment month is checked.",
              "A recorded payment removes it from this list. This history does not add to Cash Out Go totals or forecasts.",
            ]}
            rows={plan.chequeslipsNotReceived ?? []}
            open={expandedDetailSections.chequeslipsNotReceived}
            onOpenChange={(open) =>
              setExpandedDetailSections((current) => ({ ...current, chequeslipsNotReceived: open }))
            }
            onRowChange={() => undefined}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            editable={false}
            showExpectedSentDate={false}
          />
          <CashOutGoDetailTable
            title="Expected Payment Date in Past"
            currentFinancialYearEnd={plan.selectedFinancialYearEnd}
            helperText={[
              "These items are still unpaid, and their planned payment date has already passed.",
              "They stay out of monthly forecasts until you set a new date and save.",
              "You can change Expected bill submission or Expected payment. Changing submission recalculates payment using the bill-payment offset, then moves the row to the section and month that match the new date.",
              "A returned bill waiting for correction stays in Bills at Hand. Cheque Slips Not Received is a separate MER warning.",
            ]}
            rows={plan.expectedPaymentDateInPast ?? []}
            open={expandedDetailSections.expectedPaymentDateInPast}
            onOpenChange={(open) =>
              setExpandedDetailSections((current) => ({ ...current, expectedPaymentDateInPast: open }))
            }
            onRowChange={onRowChange}
            onExpectedSentDateReset={onExpectedSentDateReset}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            editable={canEdit}
            showOverdueHighlight={false}
            allowDpExpectedSentDateEdit
            preserveSourceDateEditability
            saving={saving}
            saveDisabled={saveDisabled}
          />
          <CashOutGoDetailTable
            title="D.P. Expired"
            currentFinancialYearEnd={plan.selectedFinancialYearEnd}
            helperText={[
              "These items have an expired D.P. If their planned payment date has also passed, they move to Expected Payment Date in Past.",
              "Set Expected bill submission to calculate payment from the bill-payment offset, or enter Expected payment directly. With neither date, the item stays as an unscheduled backlog and is not plotted by month.",
              "The section total includes undated items; monthly totals include only dated items within the selected FY.",
              "If a revised D.P. is still ahead, the item moves back to Items Based on D.P.",
              CASH_OUT_GO_RED_ROW_HELPER,
            ]}
            rows={plan.dpExpired ?? []}
            open={expandedDetailSections.dpExpired}
            onOpenChange={(open) =>
              setExpandedDetailSections((current) => ({ ...current, dpExpired: open }))
            }
            onRowChange={onRowChange}
            onExpectedSentDateReset={onExpectedSentDateReset}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            editable={canEdit}
            saving={saving}
            saveDisabled={saveDisabled}
            allowDpExpectedSentDateEdit
            dpOnly
          />
          <CashOutGoDetailTable
            title="Expected Payment in later FYs"
            helperText={[
              "These unsubmitted items have an Expected payment date after the selected FY.",
              "They remain visible for follow-up but do not add to this FY's totals or monthly forecast.",
              "For example, a payment planned for April 2027 appears here when the selected FY is 2026-27.",
              "When you select that later FY, an unpaid item returns to its usual work section.",
              CASH_OUT_GO_RED_ROW_HELPER,
            ]}
            rows={plan.expectedPaymentInLaterFys ?? []}
            open={expandedDetailSections.expectedPaymentInLaterFys}
            onOpenChange={(open) =>
              setExpandedDetailSections((current) => ({ ...current, expectedPaymentInLaterFys: open }))
            }
            onRowChange={onRowChange}
            onExpectedSentDateReset={onExpectedSentDateReset}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            editable={canEdit}
            saving={saving}
            saveDisabled={saveDisabled}
          />
        </>
      ) : null}
    </div>
  );
}

function PreSoExpectedCashOutgoReport({
  activeTab,
  onTabChange,
  stageOptions,
  selectedStageKeys,
  onSelectedStageKeysChange,
  stageOffsets,
  onStageOffsetChange,
  rows,
  selectedRows,
  totals,
  monthwiseRows,
  monthwiseGrouping,
  onMonthwiseGroupingChange,
  exportContextDescription,
  defaultOffset,
  loading,
  saving,
  dirty,
  canSave,
  canSaveStageOffsets,
  error,
  onSave,
  currentYearContext,
  onFileDraftChange,
  onOpenFile,
}: {
  activeTab: PreSoCashOutgoTab;
  onTabChange: (tab: PreSoCashOutgoTab) => void;
  stageOptions: PreSoStageOption[];
  selectedStageKeys: string[];
  onSelectedStageKeysChange: (keys: string[]) => void;
  stageOffsets: Record<string, PreSoStageOffset>;
  onStageOffsetChange: (stageKey: string, field: keyof PreSoStageOffset, value: string) => void;
  rows: PreSoFileRow[];
  selectedRows: PreSoFileRow[];
  totals: { capital: number; revenue: number; total: number };
  monthwiseRows: Array<{ monthKey: string; capital: number; revenue: number; total: number; count: number }>;
  monthwiseGrouping: PreSoMonthwiseGrouping;
  onMonthwiseGroupingChange: (grouping: PreSoMonthwiseGrouping) => void;
  exportContextDescription: string;
  defaultOffset: PreSoStageOffset;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  canSave: boolean;
  canSaveStageOffsets: boolean;
  error?: string;
  onSave: () => void;
  currentYearContext: boolean;
  onFileDraftChange: (
    fileId: string,
    patch: Partial<PreSoFileDraft>,
    defaults?: Partial<PreSoFileDraft>,
  ) => void;
  onOpenFile: (row: PreSoFileRow) => void;
}) {
  const selectedStageSet = new Set(selectedStageKeys);
  const selectedStageOptions = stageOptions.filter((stage) => selectedStageSet.has(stage.key));
  const groupedRowsByYear = getPreSoRowsGroupedByYearAndStage(rows, selectedStageOptions);
  const selectedStageTotals = selectedStageOptions
    .map((stage) => {
      const stageRows = selectedRows.filter((row) => row.stageKey === stage.key);
      const total = getPreSoExpectedCashOutgoTotals(stageRows);
      return {
        stage,
        count: stageRows.length,
        ...total,
      };
    })
    .filter((row) => row.count > 0);
  const selectedYearTotals = getPreSoSelectedYearTotals(selectedRows);
  const groupedMonthwiseRows = getPreSoGroupedMonthwiseRows(selectedRows, monthwiseGrouping);
  const visibleMonthwiseRows =
    monthwiseGrouping === "month" ? monthwiseRows : groupedMonthwiseRows;
  const exportMonthwise = (format: "pdf" | "excel") => {
    const groupLabel =
      monthwiseGrouping === "fyMonth"
        ? "FY"
        : monthwiseGrouping === "stageMonth"
          ? "Stage"
          : undefined;
    void downloadBackendExport({
      format,
      title: "Pre-S.O. based expected cash outgo - Monthwise",
      description: [
        exportContextDescription,
        `Grouped by ${monthwiseGrouping === "month" ? "month" : monthwiseGrouping === "fyMonth" ? "FY and month" : "stage and month"}.`,
        "All monetary values are shown in Lakhs.",
      ].join("\n"),
      tables: [
        {
          title: "Monthwise cash outgo",
          headers: [
            ...(groupLabel ? [groupLabel] : []),
            "Month",
            "Files",
            "Capital",
            "Revenue",
            "Total",
          ],
          rows: visibleMonthwiseRows.map((row) => [
            ...("groupLabel" in row ? [String(row.groupLabel)] : []),
            formatMonthKeyLabel(row.monthKey),
            row.count,
            formatLakhValue(row.capital),
            formatLakhValue(row.revenue),
            formatLakhValue(row.total),
          ]),
        },
      ],
    });
  };
  const toggleStage = (stageKey: string, checked: boolean) => {
    onSelectedStageKeysChange(
      checked
        ? stageOptions
            .map((stage) => stage.key)
            .filter((key) => key === stageKey || selectedStageSet.has(key))
        : selectedStageKeys.filter((key) => key !== stageKey),
    );
  };
  const setRowsIncluded = (targetRows: PreSoFileRow[], included: boolean) => {
    targetRows.forEach((row) =>
      onFileDraftChange(
        row.file.id,
        { included },
        {
          tentativeSoDate: row.calculatedSoDate,
          tentativePaymentDate: row.calculatedPaymentDate,
        },
      ),
    );
  };
  const tabClass = (tab: PreSoCashOutgoTab) =>
    "rounded-md border px-3 py-2 text-xs font-semibold transition " +
    (activeTab === tab
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-background hover:bg-accent");
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Pre-S.O. based expected cash outgo</h2>
            <ReportDescription
              description={
                "Planning report for demands where S.O. is not yet placed.\n" +
                "Only checked files contribute to the totals and monthwise cash outgo.\n" +
                "Use Save plan to lock the checked files and tentative dates for future use."
              }
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canSave ? (
              <span className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving || loading || !dirty}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  <Save className="size-3.5" />
                  {saving ? "Saving..." : dirty ? "Save plan" : "Saved"}
                </button>
                <FloatingHelper
                  text={[
                    "Save plan stores selected Pre-S.O. files, stage offsets, and tentative dates according to your permitted scope.",
                    "Saved offsets and dates remain available on future visits until changed and saved again.",
                    "Editors can save file-level tentative dates globally, but cannot change stage-wise offset defaults.",
                    "Stage-wise offset defaults are controlled by Admin/Sub-admin and Universal Viewer with Global Cash Out Go permission.",
                  ]}
                  label="Pre-S.O. save plan help"
                  className="size-8 border-0 bg-transparent shadow-none"
                  iconClassName="size-3"
                />
              </span>
            ) : null}
          </div>
        </div>
        {error ? (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {loading ? (
          <div className="mb-4 rounded-md border border-border bg-secondary/20 px-3 py-2 text-sm text-muted-foreground">
            Loading saved Pre-S.O. plan...
          </div>
        ) : null}
        {!currentYearContext ? (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            This report is meant for active/current FY contexts only. Change the Global FY filter to
            current FY / All active files / Active + current FY closed to use it.
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={tabClass("stages")} onClick={() => onTabChange("stages")}>
            Stages
          </button>
          <button
            type="button"
            className={tabClass("selectFiles")}
            onClick={() => onTabChange("selectFiles")}
          >
            Select Files
          </button>
          <button type="button" className={tabClass("totals")} onClick={() => onTabChange("totals")}>
            Total Capital / Revenue
          </button>
          <button
            type="button"
            className={tabClass("monthwise")}
            onClick={() => onTabChange("monthwise")}
          >
            Monthwise Cash Outgo
          </button>
        </div>
      </div>

      <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm font-semibold text-foreground">
        All the values are in Lakh.
      </div>

      {activeTab === "stages" ? (
        <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <h3 className="mb-3 text-sm font-semibold">Stages</h3>
          <p className="mb-4 text-xs text-muted-foreground">
            Select one or more Status-4 stages. Stage-wise default offset days are used to calculate
            tentative S.O. and payment dates unless manually entered against a file.
          </p>
          {!canSaveStageOffsets ? (
            <div className="mb-4 rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
              Editors can save file-level tentative dates globally, but cannot change stage-wise
              offset defaults. Stage offset defaults are controlled by Admin/Sub-admin and Universal
              Viewer with Global Cash Out Go permission.
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {stageOptions.map((stage) => {
              const selected = selectedStageSet.has(stage.key);
              const offset = stageOffsets[stage.key] ?? {
                soOffsetDays: defaultOffset.soOffsetDays,
                paymentOffsetDays: defaultOffset.paymentOffsetDays,
              };
              return (
                <div
                  key={stage.key}
                  className={
                    "rounded-md border p-3 " +
                    (selected ? "border-primary bg-primary/5" : "border-border bg-background")
                  }
                >
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => toggleStage(stage.key, event.target.checked)}
                    />
                    {stage.label}
                  </label>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-muted-foreground">
                      S.O. offset days
                      <input
                        type="number"
                        min="0"
                        value={offset.soOffsetDays}
                        disabled={!canSaveStageOffsets}
                        onChange={(event) =>
                          onStageOffsetChange(stage.key, "soOffsetDays", event.target.value)
                        }
                        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                      />
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Payment offset days
                      <input
                        type="number"
                        min="0"
                        value={offset.paymentOffsetDays}
                        disabled={!canSaveStageOffsets}
                        onChange={(event) =>
                          onStageOffsetChange(stage.key, "paymentOffsetDays", event.target.value)
                        }
                        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={!canSaveStageOffsets}
                    onClick={() => {
                      onStageOffsetChange(stage.key, "soOffsetDays", defaultOffset.soOffsetDays);
                      onStageOffsetChange(
                        stage.key,
                        "paymentOffsetDays",
                        defaultOffset.paymentOffsetDays,
                      );
                    }}
                    className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    Reset offset days
                  </button>
                  <FloatingHelper
                    text="Reset restores this stage to the current default S.O. and payment offsets. Use Save plan to keep the change; saved stage offsets remain in effect on future visits until changed and saved again."
                    label="Pre-S.O. stage offset reset help"
                    className="ml-2 inline-flex size-7 border-0 bg-transparent shadow-none"
                    iconClassName="size-3"
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeTab === "selectFiles" ? (
        <div className="space-y-4">
          {!selectedStageOptions.length ? (
            <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-[var(--shadow-card)]">
              Select stages first.
            </div>
          ) : (
            groupedRowsByYear.map((yearGroup) => (
              <details
                key={yearGroup.fileYear}
                open
                className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]"
              >
                <summary className="cursor-pointer text-sm font-semibold">
                  {yearGroup.fileYear} ({yearGroup.count} files,{" "}
                  {formatPreSoSelectFilesCurrency(yearGroup.total.total)})
                </summary>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setRowsIncluded(yearGroup.rows, true)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    Select all in FY
                  </button>
                  <button
                    type="button"
                    onClick={() => setRowsIncluded(yearGroup.rows, false)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    Clear FY
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  {yearGroup.stageGroups.map((stageGroup) => (
                    <details
                      key={`${yearGroup.fileYear}:${stageGroup.stage.key}`}
                      open
                      className="rounded-lg border border-border bg-background p-4"
                    >
                      <summary className="cursor-pointer text-sm font-semibold">
                        {stageGroup.stage.label} ({stageGroup.count} files,{" "}
                        {formatPreSoSelectFilesCurrency(stageGroup.total.total)})
                      </summary>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setRowsIncluded(stageGroup.rows, true)}
                          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                        >
                          Select all in stage
                        </button>
                        <button
                          type="button"
                          onClick={() => setRowsIncluded(stageGroup.rows, false)}
                          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                        >
                          Clear stage
                        </button>
                      </div>
                      <div className="mt-4 overflow-x-auto rounded-md border border-border">
                        <table className="w-full min-w-[1080px] text-sm">
                          <thead className="bg-secondary text-xs text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium">S. No.</th>
                              <th className="px-3 py-2 text-left font-medium">Use</th>
                              <th className="px-3 py-2 text-left font-medium">Control No.</th>
                              <th className="px-3 py-2 text-left font-medium">Demand description</th>
                              <th className="px-3 py-2 text-left font-medium">Division</th>
                              <th className="px-3 py-2 text-left font-medium">Mode</th>
                              <th className="px-3 py-2 text-right font-medium">Capital</th>
                              <th className="px-3 py-2 text-right font-medium">Revenue</th>
                              <th className="px-3 py-2 text-left font-medium">
                                Latest milestone date
                              </th>
                              <th className="px-3 py-2 text-left font-medium">
                                <span className="inline-flex items-center gap-1.5">
                                  Tentative S.O.
                                  <InfoCircleHelper
                                    label="Tentative S.O. help"
                                    text={[
                                      "Auto date = today plus S.O. offset days for the file's current Pre-S.O. stage.",
                                      `The offset comes from the current stage's setting (default ${defaultOffset.soOffsetDays} days); a saved stage-specific value takes precedence.`,
                                      "Latest milestone date is shown for reference only; it is not currently used as the calculation base.",
                                      "If you manually enter a date, that date is used for this file and is saved when Save plan is clicked.",
                                    ]}
                                  />
                                </span>
                              </th>
                              <th className="px-3 py-2 text-left font-medium">
                                <span className="inline-flex items-center gap-1.5">
                                  Tentative payment
                                  <InfoCircleHelper
                                    label="Tentative payment help"
                                    text={[
                                      "Auto date = tentative S.O. date plus payment offset days for the file's current Pre-S.O. stage.",
                                      "If Tentative S.O. is manually changed, tentative payment follows that changed S.O. date unless payment date is also manually edited.",
                                      "If you manually enter a payment date, that date is used for this file and is saved when Save plan is clicked.",
                                    ]}
                                  />
                                </span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {stageGroup.rows.map((row, rowIndex) => (
                                <tr key={row.file.id} className="border-t border-border">
                                  <td className="px-3 py-2 tabular-nums">{rowIndex + 1}</td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="checkbox"
                                      checked={row.draft.included}
                                      onChange={(event) =>
                                        onFileDraftChange(
                                          row.file.id,
                                          { included: event.target.checked },
                                          {
                                            tentativeSoDate: row.calculatedSoDate,
                                            tentativePaymentDate: row.calculatedPaymentDate,
                                          },
                                        )
                                      }
                                    />
                                  </td>
                                  <td className="px-3 py-2 font-medium">
                                    <button
                                      type="button"
                                      onClick={() => onOpenFile(row)}
                                      className="text-left font-semibold text-primary underline-offset-2 hover:underline"
                                    >
                                      {row.file.imms || "-"}
                                    </button>
                                  </td>
                                  <td className="px-3 py-2"><CompactTableText value={row.file.demandDescription || "-"} width={36} /></td>
                                  <td className="px-3 py-2">{row.file.division || "-"}</td>
                                  <td className="px-3 py-2">{row.file.mode || "-"}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {formatPreSoSelectFilesCurrency(row.capital)}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {formatPreSoSelectFilesCurrency(row.revenue)}
                                  </td>
                                  <td className="px-3 py-2 tabular-nums">
                                    {formatPreSoLatestMilestoneDate(row.file)}
                                  </td>
                                  <td className="px-3 py-2">
                                    <DateInput
                                      value={row.draft.tentativeSoDate || row.calculatedSoDate}
                                      onChange={(value) =>
                                        onFileDraftChange(row.file.id, { tentativeSoDate: value })
                                      }
                                      disabled={!row.draft.included}
                                      className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <DateInput
                                      value={row.draft.tentativePaymentDate || row.calculatedPaymentDate}
                                      onChange={(value) =>
                                        onFileDraftChange(row.file.id, { tentativePaymentDate: value })
                                      }
                                      disabled={!row.draft.included}
                                      className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                                    />
                                  </td>
                                </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            ))
          )}
        </div>
      ) : null}

      {activeTab === "totals" ? (
        <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <h3 className="mb-4 text-sm font-semibold">Selected file totals</h3>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-md border border-border bg-secondary/20 px-3 py-2">
              <div className="text-xs text-muted-foreground">Selected files</div>
              <div className="text-sm font-semibold tabular-nums">{selectedRows.length}</div>
            </div>
            <SummaryTile label="Capital" value={totals.capital} />
            <SummaryTile label="Revenue" value={totals.revenue} />
            <SummaryTile label="Total" value={totals.total} />
          </div>
          <h4 className="mb-3 mt-6 text-sm font-semibold">Stage-wise selected totals</h4>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-secondary text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Stage</th>
                  <th className="px-3 py-2 text-right font-medium">Files</th>
                  <th className="px-3 py-2 text-right font-medium">Capital</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {selectedStageTotals.length ? (
                  selectedStageTotals.map((row) => (
                    <tr key={row.stage.key} className="border-t border-border">
                      <td className="px-3 py-2">{row.stage.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatLakhValue(row.capital)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatLakhValue(row.revenue)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatLakhValue(row.total)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      No files selected yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <h4 className="mb-3 mt-6 text-sm font-semibold">FY-wise selected totals</h4>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-secondary text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">FY</th>
                  <th className="px-3 py-2 text-right font-medium">Files</th>
                  <th className="px-3 py-2 text-right font-medium">Capital</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {selectedYearTotals.length ? (
                  selectedYearTotals.map((row) => (
                    <tr key={row.fileYear} className="border-t border-border">
                      <td className="px-3 py-2">{row.fileYear}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatLakhValue(row.capital)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatLakhValue(row.revenue)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatLakhValue(row.total)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      No files selected yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeTab === "monthwise" ? (
        <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Monthwise cash outgo</h3>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-medium text-muted-foreground">
                Group by
                <select
                  value={monthwiseGrouping}
                  onChange={(event) =>
                    onMonthwiseGroupingChange(event.target.value as PreSoMonthwiseGrouping)
                  }
                  className="ml-2 h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                >
                  <option value="month">Month only</option>
                  <option value="fyMonth">FY → Month</option>
                  <option value="stageMonth">Stage → Month</option>
                </select>
              </label>
              <ReportHeaderActions
                onPdf={() => exportMonthwise("pdf")}
                onExcel={() => exportMonthwise("excel")}
                disabled={loading || visibleMonthwiseRows.length === 0}
              />
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-secondary text-xs text-muted-foreground">
                <tr>
                  {monthwiseGrouping === "month" ? null : (
                    <th className="px-3 py-2 text-left font-medium">
                      {monthwiseGrouping === "fyMonth" ? "FY" : "Stage"}
                    </th>
                  )}
                  <th className="px-3 py-2 text-left font-medium">Month</th>
                  <th className="px-3 py-2 text-right font-medium">Files</th>
                  <th className="px-3 py-2 text-right font-medium">Capital</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {(monthwiseGrouping === "month" ? monthwiseRows : groupedMonthwiseRows).length ? (
                  (monthwiseGrouping === "month" ? monthwiseRows : groupedMonthwiseRows).map((row) => (
                    <tr
                      key={
                        "groupKey" in row && typeof row.groupKey === "string"
                          ? `${row.groupKey}:${row.monthKey}`
                          : row.monthKey
                      }
                      className="border-t border-border"
                    >
                      {"groupLabel" in row ? (
                        <td className="px-3 py-2">{String(row.groupLabel)}</td>
                      ) : null}
                      <td className="px-3 py-2">{formatMonthKeyLabel(row.monthKey)}</td>
                      <td className="px-3 py-2 text-right">{row.count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatLakhValue(row.capital)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatLakhValue(row.revenue)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatLakhValue(row.total)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={monthwiseGrouping === "month" ? 5 : 6}
                      className="px-3 py-6 text-center text-muted-foreground"
                    >
                      No selected files with tentative payment dates.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SoPaymentMatrixReport({
  title,
  titleHelper,
  description,
  monthAmountHelper,
  rows,
  selectedFields,
  fieldsLocked,
  preferenceLoading,
  preferenceSaving,
  fieldOptions,
  columns,
  monthKeys,
  actions,
  onFieldChange,
  onResetFields,
  onLockToggle,
  onOpenRows,
}: {
  title: string;
  titleHelper?: HelperText;
  description: string;
  monthAmountHelper: HelperText;
  rows: SoPaymentMatrixRow[];
  selectedFields: SoPaymentMatrixFieldKey[];
  fieldsLocked: boolean;
  preferenceLoading: boolean;
  preferenceSaving: boolean;
  fieldOptions: SoPaymentMatrixColumnOption[];
  columns: SoPaymentMatrixColumnOption[];
  monthKeys: string[];
  actions?: ReactNode;
  onFieldChange: (fieldKey: SoPaymentMatrixFieldKey, checked: boolean) => void;
  onResetFields: () => void;
  onLockToggle: () => void;
  onOpenRows: (rows: SoPaymentMatrixRow[], monthKey?: string) => void;
}) {
  const [fieldsDropdownOpen, setFieldsDropdownOpen] = useState(false);
  const [resultView, setResultView] = useState<ResultView>("table");
  const monthTotals = monthKeys.map((monthKey) => ({
    monthKey,
    amount: rows.reduce((sum, row) => sum + (row.monthAmounts[monthKey] ?? 0), 0),
  }));
  const exportPlot: ExportPlot | undefined = resultView !== "table"
    ? {
        kind: resultView === "line" ? "line" : "bar",
        title: `${title} · monthly totals`,
        measure: "Monthly payment amount",
        unit: "Lakh",
        xAxisTitle: "Month",
        yAxisTitle: "Payment amount Lakh",
        categories: monthTotals.map((row) => formatSoPaymentMatrixMonthLabel(row.monthKey)),
        series: [{
          name: title.toLowerCase().includes("completed") ? "Recorded payments" : "Payment due",
          values: monthTotals.map((row) => row.amount / 100_000),
        }],
      }
    : undefined;
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const selectedFieldLabels = fieldOptions
    .filter((option) => selectedFields.includes(option.key))
    .map((option) => option.label);
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold">{title}</h2>
            {titleHelper ? <FloatingHelper text={titleHelper} /> : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TableChartToggle value={resultView} onChange={setResultView} label={`${title} view`} views={["table", "bar", "line"]} />
          <ExportPlotContext.Provider value={exportPlot}>{actions}</ExportPlotContext.Provider>
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-border bg-secondary/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Select file fields
            <FloatingHelper
              text={[
                "Select one or more file/S.O. fields to show on the left side of the matrix.",
                "Apr-Mar month columns are fixed; they show expected unpaid amounts in the Due matrix and actual paid amounts in the Completed matrix.",
                "Changing these fields does not change report filtering or payment calculation.",
                "Lock fields to save this matrix layout for your user across future visits. The Due and Completed matrices have separate saved layouts.",
              ]}
              label="S.O. payment matrix field selector help"
              className="size-5"
            />
          </div>
          <div className="flex min-w-[280px] flex-1 flex-wrap items-center justify-end gap-2">
            <div className="relative min-w-[260px] max-w-xl flex-1">
              <button
                type="button"
                onClick={() => setFieldsDropdownOpen((open) => !open)}
                className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm text-foreground shadow-sm hover:bg-accent/40"
                aria-expanded={fieldsDropdownOpen}
              >
                <span className="min-w-0 truncate">
                  {selectedFieldLabels.length
                    ? `${selectedFieldLabels.length} fields selected`
                    : "Select file fields"}
                </span>
                <ChevronDown
                  className={
                    "size-4 shrink-0 text-muted-foreground transition-transform " +
                    (fieldsDropdownOpen ? "rotate-180" : "")
                  }
                  aria-hidden="true"
                />
              </button>
              {fieldsDropdownOpen ? (
                <div className="absolute right-0 z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-border bg-popover p-2 text-sm text-popover-foreground shadow-lg">
                  <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Select file fields
                    </span>
                    <button
                      type="button"
                      onClick={onResetFields}
                      disabled={fieldsLocked || preferenceLoading || preferenceSaving}
                      className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Reset
                    </button>
                  </div>
                  <div className="space-y-1">
                    {fieldOptions.map((option) => (
                      <label
                        key={option.key}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFields.includes(option.key)}
                          onChange={(event) => onFieldChange(option.key, event.target.checked)}
                          disabled={fieldsLocked || preferenceLoading || preferenceSaving}
                          className="size-4"
                        />
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        <FloatingHelper
                          text={option.helper}
                          label={`${option.label} help`}
                          className="size-5 shrink-0"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onResetFields}
              disabled={fieldsLocked || preferenceLoading || preferenceSaving}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Reset fields
            </button>
            <button
              type="button"
              onClick={onLockToggle}
              disabled={preferenceLoading || preferenceSaving}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-semibold text-foreground hover:bg-accent disabled:opacity-50"
              title={fieldsLocked ? "Unlock this matrix's saved fields" : "Save and lock these fields for your user"}
              aria-label={fieldsLocked ? "Unlock saved matrix fields" : "Lock and save matrix fields"}
            >
              {fieldsLocked ? (
                <>
                  <Unlock className="size-3.5" aria-hidden="true" />
                  <span>{preferenceSaving ? "Saving..." : "Unlock fields"}</span>
                </>
              ) : (
                <>
                  <Lock className="size-3.5" aria-hidden="true" />
                  <span>{preferenceSaving ? "Saving..." : "Lock fields"}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="mb-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm font-semibold text-foreground">
        All the values are in Lakh.
      </div>

      {resultView !== "table" ? (
        <div data-chart-copy-area className="rounded-lg border border-border bg-background p-4" aria-label="Monthly payment chart">
          <div className="mb-4 flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
            <span>{resultView === "bar" ? "Amount (Lakhs) · " : ""}Monthly total · ₹ Lakh · Select a month to open contributing files</span>
            <ChartCopyButton />
          </div>
          {resultView === "line" ? (
            <div className="h-[320px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthTotals.map((month) => ({ ...month, label: formatSoPaymentMatrixMonthLabel(month.monthKey) }))} margin={{ top: 12, right: 18, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 13 }} />
                  <YAxis tick={{ fontSize: 13 }} width={64}
                    label={{ value: "Lakhs", angle: -90, position: "insideLeft", fontSize: 13 }} />
                  <ChartTooltip formatter={(value) => formatSoPaymentMatrixAmount(Number(value))} />
                  <Line type="monotone" dataKey="amount" name="Monthly total" stroke="#0f766e" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <div role="group" aria-label="Monthly payment bar chart" className="grid min-w-[1120px] grid-cols-12 gap-x-2">
            {monthTotals.map((month) => {
              const height = grandTotal > 0 && month.amount > 0
                ? Math.max(3, (month.amount / Math.max(...monthTotals.map((item) => item.amount), 1)) * 100)
                : 0;
              const monthRows = rows.filter((row) => (row.monthAmounts[month.monthKey] ?? 0) > 0);
              return (
                <button
                  key={month.monthKey}
                  type="button"
                  disabled={!month.amount}
                  onClick={() => onOpenRows(monthRows, month.monthKey)}
                  className="group flex min-w-0 flex-col items-stretch gap-1 rounded-sm text-center disabled:cursor-default"
                  title={month.amount ? `Open ${formatSoPaymentMatrixMonthLabel(month.monthKey)} contributing files` : undefined}
                >
                  <span className="text-xs font-semibold tabular-nums text-foreground">
                    {month.amount ? formatSoPaymentMatrixAmount(month.amount) : "-"}
                  </span>
                  <span className="flex h-32 items-end justify-center border-b border-border px-2">
                    <span
                      className="w-full max-w-12 rounded-t-sm bg-primary/80 transition-colors group-hover:bg-primary"
                      style={{ height: `${height}%` }}
                    />
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">{formatSoPaymentMatrixMonthLabel(month.monthKey)}</span>
                </button>
              );
            })}
            </div>
          </div>
          )}
        </div>
      ) : (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[1180px] border-collapse text-sm">
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-3 py-2 text-left font-medium">
                  {column.label}
                </th>
              ))}
              {monthKeys.map((monthKey) => (
                <th key={monthKey} className="px-3 py-2 text-right font-medium">
                  <span className="inline-flex items-center justify-end gap-1">
                    {formatSoPaymentMatrixMonthLabel(monthKey)}
                    <FloatingHelper
                      text={monthAmountHelper}
                      label={`${formatSoPaymentMatrixMonthLabel(monthKey)} column help`}
                      className="size-5"
                    />
                  </span>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.rowKey} className="border-t border-border">
                  {columns.map((column) => (
                    <td key={column.key} className="px-3 py-2 align-top">
                      {getCompactTableTextWidth(column.key) ? (
                        <CompactTableText
                          value={String(getSoPaymentMatrixFieldValue(row, column.key))}
                          width={getCompactTableTextWidth(column.key)!}
                        />
                      ) : (
                        getSoPaymentMatrixFieldValue(row, column.key)
                      )}
                    </td>
                  ))}
                  {monthKeys.map((monthKey) => {
                    const amount = row.monthAmounts[monthKey] ?? 0;
                    return (
                      <td key={monthKey} className="px-3 py-2 text-right tabular-nums">
                        {amount ? (
                          <button
                            type="button"
                            onClick={() => onOpenRows([row], monthKey)}
                            className="font-semibold text-primary underline-offset-2 hover:underline"
                          >
                        {formatSoPaymentMatrixAmount(amount)}
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    <button
                      type="button"
                      onClick={() => onOpenRows([row])}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {formatSoPaymentMatrixAmount(row.total)}
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length + monthKeys.length + 1}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  No S.O. payment rows found for the current filters.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length ? (
            <tfoot className="border-t border-border bg-muted/30 font-semibold">
              <tr>
                <td colSpan={columns.length} className="px-3 py-2">
                  Total
                </td>
                {monthTotals.map((total) => (
                  <td key={total.monthKey} className="px-3 py-2 text-right tabular-nums">
                    {total.amount ? (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenRows(
                            rows.filter((row) => (row.monthAmounts[total.monthKey] ?? 0) > 0),
                            total.monthKey,
                          )
                        }
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {formatSoPaymentMatrixAmount(total.amount)}
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatSoPaymentMatrixAmount(grandTotal)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      )}
    </div>
  );
}

function getPreSoStageOptions(): PreSoStageOption[] {
  const supplyOrderIndex = milestoneDefinitions.findIndex((milestone) => milestone.key === "supplyOrder");
  const preSoMilestones =
    supplyOrderIndex >= 0 ? milestoneDefinitions.slice(0, supplyOrderIndex) : milestoneDefinitions;
  return [
    { key: "workflowNotStarted", label: "Workflow Not Started" },
    ...preSoMilestones
      .filter((milestone) => milestone.key !== "psb" && milestone.key !== "psbPwb")
      .map((milestone) => ({ key: milestone.key, label: milestone.label })),
    { key: "financialSanction", label: "Financial Sanction" },
  ];
}

function getPreSoDefaultStageOffset(settings: {
  preSoDefaultSoOffsetDays?: number;
  preSoDefaultPaymentOffsetDays?: number;
}): PreSoStageOffset {
  return {
    soOffsetDays: String(
      Number.isFinite(settings.preSoDefaultSoOffsetDays)
        ? settings.preSoDefaultSoOffsetDays
        : 30,
    ),
    paymentOffsetDays: String(
      Number.isFinite(settings.preSoDefaultPaymentOffsetDays)
        ? settings.preSoDefaultPaymentOffsetDays
        : 30,
    ),
  };
}

function getPreSoPlanSnapshot(
  selectedStageKeys: string[],
  stageOffsets: Record<string, PreSoStageOffset>,
  fileDrafts: Record<string, PreSoFileDraft>,
  defaultOffset: PreSoStageOffset,
) {
  return JSON.stringify({
    selectedStageKeys: [...selectedStageKeys].sort(),
    stageOffsets: Object.fromEntries(
      [...selectedStageKeys].sort().map((stageKey) => {
        const offset = stageOffsets[stageKey] ?? defaultOffset;
        return [
          stageKey,
          {
            soOffsetDays: readPreSoOffsetDays(offset.soOffsetDays),
            paymentOffsetDays: readPreSoOffsetDays(offset.paymentOffsetDays),
          },
        ];
      }),
    ),
    fileDrafts: Object.fromEntries(
      Object.entries(fileDrafts)
        .filter(
          ([, draft]) =>
            draft.included || Boolean(draft.tentativeSoDate) || Boolean(draft.tentativePaymentDate),
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([fileId, draft]) => [
          fileId,
          {
            included: Boolean(draft.included),
            tentativeSoDate: draft.tentativeSoDate || "",
            tentativePaymentDate: draft.tentativePaymentDate || "",
          },
        ]),
    ),
  });
}

function isPreSoExpectedCashOutgoEligibleFile(file: FileRecord) {
  if (isCancelledFile(file) || isFileClosed(file)) return false;
  return !(file.supplyOrders ?? []).some(
    (order) => !isYes(order.soCancelled) && (hasFilledString(order.soDate) || hasFilledString(order.soNo)),
  );
}

function getPreSoFileStage(file: FileRecord): PreSoStageOption {
  const orderStage = getPreSoOrderDrivenStage(file);
  if (orderStage) return orderStage;
  if (normalizeMilestoneName(file.currentMilestone) === "financialsanction") {
    return { key: "financialSanction", label: "Financial Sanction" };
  }
  const milestone = getActiveDelayMilestone(file);
  if (milestone) return { key: milestone.key, label: milestone.label };
  return { key: "workflowNotStarted", label: "Workflow Not Started" };
}

function getPreSoOrderDrivenStage(file: FileRecord): PreSoStageOption | undefined {
  const financialSanctionActive = expectedSupplyOrders(file).some(
    (order) =>
      !isYes(order.soCancelled) &&
      !isYes(order.shortclosure) &&
      !hasFilledString(order.financialSanctionDate) &&
      !hasFilledString(order.soDate) &&
      !hasFilledString(order.soNo) &&
      normalizeMilestoneName(order.currentMilestone) === "financialsanction",
  );
  return financialSanctionActive ? { key: "financialSanction", label: "Financial Sanction" } : undefined;
}

function getPreSoFileYear(file: FileRecord) {
  if (hasFilledString(file.year)) return file.year!;
  const startYear = getFinancialYearStartFromDate(file.date);
  return startYear === undefined ? "FY not set" : `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function getFinancialYearStartFromDate(date: string | undefined) {
  const time = parseLocalDateTime(date ?? "");
  if (time === undefined) return undefined;
  const parsed = new Date(time);
  const year = parsed.getFullYear();
  return parsed.getMonth() >= 3 ? year : year - 1;
}

function sortPreSoFileYearLabels(a: string, b: string) {
  const aStart = readFinancialYearStart(a);
  const bStart = readFinancialYearStart(b);
  if (aStart !== undefined && bStart !== undefined) return bStart - aStart;
  if (aStart !== undefined) return -1;
  if (bStart !== undefined) return 1;
  return a.localeCompare(b);
}

function getPreSoRowsGroupedByYearAndStage(
  rows: PreSoFileRow[],
  selectedStageOptions: PreSoStageOption[],
) {
  const stageOrder = new Map(selectedStageOptions.map((stage, index) => [stage.key, index]));
  const yearMap = new Map<string, PreSoFileRow[]>();
  rows.forEach((row) => {
    const yearRows = yearMap.get(row.fileYear) ?? [];
    yearRows.push(row);
    yearMap.set(row.fileYear, yearRows);
  });
  return Array.from(yearMap.entries())
    .sort(([a], [b]) => sortPreSoFileYearLabels(a, b))
    .map(([fileYear, yearRows]) => {
      const stageMap = new Map<string, PreSoFileRow[]>();
      yearRows.forEach((row) => {
        const stageRows = stageMap.get(row.stageKey) ?? [];
        stageRows.push(row);
        stageMap.set(row.stageKey, stageRows);
      });
      const stageGroups = Array.from(stageMap.entries())
        .map(([stageKey, stageRows]) => ({
          stage: {
            key: stageKey,
            label: stageRows[0]?.stageLabel ?? stageKey,
          },
          rows: stageRows,
          count: stageRows.length,
          total: getPreSoExpectedCashOutgoTotals(stageRows),
        }))
        .sort(
          (a, b) =>
            (stageOrder.get(a.stage.key) ?? Number.MAX_SAFE_INTEGER) -
            (stageOrder.get(b.stage.key) ?? Number.MAX_SAFE_INTEGER),
        );
      return {
        fileYear,
        rows: yearRows,
        stageGroups,
        count: yearRows.length,
        total: getPreSoExpectedCashOutgoTotals(yearRows),
      };
    });
}

function buildPreSoExpectedCashOutgoRows({
  files,
  selectedStageKeys,
  stageOffsets,
  fileDrafts,
  today,
  defaultOffset,
}: {
  files: FileRecord[];
  selectedStageKeys: string[];
  stageOffsets: Record<string, PreSoStageOffset>;
  fileDrafts: Record<string, PreSoFileDraft>;
  today: string;
  defaultOffset: PreSoStageOffset;
}): PreSoFileRow[] {
  const selectedStages = new Set(selectedStageKeys);
  if (!selectedStages.size) return [];
  return files
    .map((file) => {
      const stage = getPreSoFileStage(file);
      if (!selectedStages.has(stage.key)) return undefined;
      const offset = stageOffsets[stage.key] ?? defaultOffset;
      const soOffsetDays = readPreSoOffsetDays(offset.soOffsetDays);
      const paymentOffsetDays = readPreSoOffsetDays(offset.paymentOffsetDays);
      const calculatedSoDate = addDays(today, soOffsetDays) ?? today;
      const calculatedPaymentDate = addDays(calculatedSoDate, paymentOffsetDays) ?? calculatedSoDate;
      const draft = fileDrafts[file.id] ?? {
        included: false,
        tentativeSoDate: "",
        tentativePaymentDate: "",
      };
      const effectivePaymentDate = draft.tentativePaymentDate || calculatedPaymentDate;
      return {
        file,
        fileYear: getPreSoFileYear(file),
        stageKey: stage.key,
        stageLabel: stage.label,
        capital: getInrAmount(file.valueCapital, file) ?? 0,
        revenue: getInrAmount(file.valueRevenue, file) ?? 0,
        draft,
        calculatedSoDate,
        calculatedPaymentDate,
        effectivePaymentDate,
      };
    })
    .filter((row): row is PreSoFileRow => Boolean(row))
    .sort((a, b) => a.stageLabel.localeCompare(b.stageLabel) || getPreSoFileRef(a.file).localeCompare(getPreSoFileRef(b.file)));
}

function readPreSoOffsetDays(value: string) {
  const parsed = Number.parseInt(value || "0", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function getPreSoExpectedCashOutgoTotals(rows: PreSoFileRow[]) {
  return rows.reduce(
    (total, row) => ({
      capital: total.capital + row.capital,
      revenue: total.revenue + row.revenue,
      total: total.total + row.capital + row.revenue,
    }),
    { capital: 0, revenue: 0, total: 0 },
  );
}

function getPreSoSelectedYearTotals(rows: PreSoFileRow[]) {
  const yearMap = new Map<
    string,
    { fileYear: string; count: number; capital: number; revenue: number; total: number }
  >();
  rows.forEach((row) => {
    const current = yearMap.get(row.fileYear) ?? {
      fileYear: row.fileYear,
      count: 0,
      capital: 0,
      revenue: 0,
      total: 0,
    };
    current.count += 1;
    current.capital += row.capital;
    current.revenue += row.revenue;
    current.total += row.capital + row.revenue;
    yearMap.set(row.fileYear, current);
  });
  return Array.from(yearMap.values()).sort((a, b) => sortPreSoFileYearLabels(a.fileYear, b.fileYear));
}

function getPreSoExpectedCashOutgoMonthwiseRows(rows: PreSoFileRow[]) {
  const monthMap = new Map<string, { monthKey: string; capital: number; revenue: number; total: number; count: number }>();
  rows.forEach((row) => {
    const monthKey = row.effectivePaymentDate.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return;
    const current = monthMap.get(monthKey) ?? {
      monthKey,
      capital: 0,
      revenue: 0,
      total: 0,
      count: 0,
    };
    current.capital += row.capital;
    current.revenue += row.revenue;
    current.total += row.capital + row.revenue;
    current.count += 1;
    monthMap.set(monthKey, current);
  });
  return Array.from(monthMap.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

function getPreSoGroupedMonthwiseRows(rows: PreSoFileRow[], grouping: PreSoMonthwiseGrouping) {
  if (grouping === "month") return [];
  const grouped = new Map<
    string,
    {
      groupKey: string;
      groupLabel: string;
      monthKey: string;
      capital: number;
      revenue: number;
      total: number;
      count: number;
    }
  >();
  rows.forEach((row) => {
    const monthKey = row.effectivePaymentDate.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return;
    const groupKey = grouping === "fyMonth" ? row.fileYear : row.stageKey;
    const groupLabel = grouping === "fyMonth" ? row.fileYear : row.stageLabel;
    const key = `${groupKey}:${monthKey}`;
    const current = grouped.get(key) ?? {
      groupKey,
      groupLabel,
      monthKey,
      capital: 0,
      revenue: 0,
      total: 0,
      count: 0,
    };
    current.capital += row.capital;
    current.revenue += row.revenue;
    current.total += row.capital + row.revenue;
    current.count += 1;
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).sort((a, b) => {
    if (grouping === "fyMonth") {
      const yearSort = sortPreSoFileYearLabels(a.groupLabel, b.groupLabel);
      if (yearSort !== 0) return yearSort;
    } else {
      const stageSort = a.groupLabel.localeCompare(b.groupLabel);
      if (stageSort !== 0) return stageSort;
    }
    return a.monthKey.localeCompare(b.monthKey);
  });
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

function getPreSoFileRef(file: FileRecord) {
  return file.uniqueCode || file.imms || file.id;
}

function formatPreSoSelectFilesCurrency(value: number) {
  return formatLakhValue(value);
}

function formatPreSoLatestMilestoneDate(file: FileRecord) {
  const latestDate = getPreSoLatestMilestoneDate(file);
  return latestDate ? formatIsoDateForDisplay(latestDate) : "-";
}

function getPreSoLatestMilestoneDate(file: FileRecord) {
  const dates: string[] = [];
  const addDate = (value: unknown) => {
    if (typeof value === "string" && hasDate(value)) dates.push(value);
  };

  milestoneDefinitions.forEach((milestone) => {
    if ("applies" in milestone && milestone.applies && !milestone.applies(file)) return;
    if ("reviewed" in milestone) addDate(file[milestone.reviewed as keyof FileRecord]);
    if ("current" in milestone) addDate(file[milestone.current as keyof FileRecord]);
  });

  expectedSupplyOrders(file).forEach((order) => {
    addDate(order.financialSanctionDate);
    addDate(order.advancePaymentDetail?.paymentDate);
  });

  return dates.sort((a, b) => b.localeCompare(a))[0];
}

function SummaryTile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{formatLakhValue(value)}</div>
      {note ? <div className="mt-1 text-xs text-muted-foreground">{note}</div> : null}
    </div>
  );
}

function getCashOutGoAllocationPercent(value: number, allocation: number) {
  if (!allocation) return "Allocation not set";
  return `${((value / allocation) * 100).toFixed(1)}% of allocation`;
}

function getCashOutGoSectionTotals(
  rows: Array<Pick<CashOutGoPlanDetailRow, "capital" | "revenue" | "total" | "expectedPaymentDate">>,
  currentFinancialYearEnd = "",
) {
  return getCashOutGoPlanIncludedRows(rows, currentFinancialYearEnd).reduce(
    (sum, row) => ({
      capital: sum.capital + row.capital,
      revenue: sum.revenue + row.revenue,
      total: sum.total + row.total,
    }),
    { capital: 0, revenue: 0, total: 0 },
  );
}

function getCashOutGoPlanIncludedRows<T extends Pick<CashOutGoPlanDetailRow, "expectedPaymentDate">>(
  rows: T[],
  currentFinancialYearEnd = "",
) {
  return rows.filter((row) =>
    !currentFinancialYearEnd ||
    !row.expectedPaymentDate ||
    row.expectedPaymentDate <= currentFinancialYearEnd
  );
}

function CashOutGoSummaryTable({
  plan,
  onOpenRowsSearch,
}: {
  plan: CashOutGoPlanPayload;
  onOpenRowsSearch: (rows: CashOutGoPlanDetailRow[]) => void;
}) {
  const sections = getCashOutGoSummarySections(plan);
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <h3 className="mb-4 text-base font-bold">Cash Out Go Plan Summary</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[1120px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
              <th className="px-3 py-2 text-left">Amount Type</th>
              {sections.map((section) => (
                <th key={section.key} className="px-3 py-2 text-right">
                  {section.rows.length ? (
                    <button
                      type="button"
                      onClick={() => onOpenRowsSearch(section.rows)}
                      className="font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      {section.label}
                    </button>
                  ) : (
                    section.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/60">
              <td className="px-3 py-3 font-medium text-muted-foreground">Capital</td>
              {sections.map((section) => (
                <td key={section.key} className="px-3 py-3 text-right tabular-nums">
                  <span className="font-semibold">{formatLakhValue(section.capital)}</span>
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-3 py-3 font-medium text-muted-foreground">Revenue</td>
              {sections.map((section) => (
                <td key={section.key} className="px-3 py-3 text-right tabular-nums">
                  <span className="font-semibold">{formatLakhValue(section.revenue)}</span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getCashOutGoSummarySections(plan: CashOutGoPlanPayload) {
  const expenditure = getExpectedCashOutgoTotals(plan.expenditureTillDate);
  const monthwise = getExpectedCashOutgoTotals(plan.monthwisePlan);
  const cutoffDate = plan.selectedFinancialYearEnd;
  const submitted = getCashOutGoSectionTotals(plan.billsSubmitted, cutoffDate);
  const hand = getCashOutGoSectionTotals(plan.billsAtHand, cutoffDate);
  const delivered = getCashOutGoSectionTotals(plan.deliveredBillsPending, cutoffDate);
  const dp = getCashOutGoSectionTotals(plan.dpBasedForecast ?? [], cutoffDate);
  const dpExpired = getCashOutGoSectionTotals(plan.dpExpired ?? [], cutoffDate);
  return [
    { key: "expenditure", label: "Expenditure till date", ...expenditure, rows: [] },
    {
      key: "submitted",
      label: "Bills Submitted to PCDA",
      ...submitted,
      rows: getCashOutGoPlanIncludedRows(plan.billsSubmitted, cutoffDate),
    },
    {
      key: "hand",
      label: "Bills at Hand",
      ...hand,
      rows: getCashOutGoPlanIncludedRows(plan.billsAtHand, cutoffDate),
    },
    {
      key: "delivered",
      label: "Items Delivered and Bills Yet to Be Prepared",
      ...delivered,
      rows: getCashOutGoPlanIncludedRows(plan.deliveredBillsPending, cutoffDate),
    },
    {
      key: "dp",
      label: "Items Based on D.P.",
      ...dp,
      rows: getCashOutGoPlanIncludedRows(plan.dpBasedForecast ?? [], cutoffDate),
    },
    {
      key: "dpExpired",
      label: "D.P. Expired",
      ...dpExpired,
      rows: getCashOutGoPlanIncludedRows(plan.dpExpired ?? [], cutoffDate),
    },
    { key: "monthwise", label: "Monthwise Revised Cash Out Go Plan", ...monthwise, rows: [] },
  ];
}

function getCashOutGoPlanExpectedPaymentRemaining(plan: CashOutGoPlanPayload | undefined) {
  if (!plan) return undefined;
  const expenditure = getExpectedCashOutgoTotals(plan.expenditureTillDate);
  const monthwise = getExpectedCashOutgoTotals(plan.monthwisePlan);
  return monthwise.total - expenditure.total;
}

function enforceExclusiveCashOutGoPlanRows(plan: CashOutGoPlanPayload): CashOutGoPlanPayload {
  const assigned = new Set<string>();
  const takeUnassigned = (rows: CashOutGoPlanDetailRow[] = []) =>
    rows.filter((row) => {
      if (assigned.has(row.rowKey)) return false;
      assigned.add(row.rowKey);
      return true;
    });

  const chequeslipsNotReceived = takeUnassigned(plan.chequeslipsNotReceived ?? []);
  const expectedPaymentDateInPast = takeUnassigned(plan.expectedPaymentDateInPast ?? []);
  const expectedPaymentInLaterFys = takeUnassigned(plan.expectedPaymentInLaterFys ?? []);
  const billsSubmitted = takeUnassigned(plan.billsSubmitted ?? []);
  const billsAtHand = takeUnassigned(plan.billsAtHand ?? []);
  const deliveredBillsPending = takeUnassigned(plan.deliveredBillsPending ?? []);
  const dpBasedForecast = takeUnassigned(plan.dpBasedForecast ?? []);
  const dpExpired = takeUnassigned(plan.dpExpired ?? []);

  return {
    ...plan,
    chequeslipsNotReceived,
    expectedPaymentDateInPast,
    expectedPaymentInLaterFys,
    billsSubmitted,
    billsAtHand,
    deliveredBillsPending,
    dpBasedForecast,
    dpExpired,
  };
}

function recalculateCashOutGoPlan(
  plan: CashOutGoPlanPayload,
  options: { preserveExpectedSentDate?: boolean } = {},
): CashOutGoPlanPayload {
  const billPaymentOffsetDays = getEffectiveBillPaymentOffsetDays(plan.settings);
  const billSubmissionOffsetDays = getEffectiveBillSubmissionOffsetDays(plan.settings);
  const dpOffsetDays = getEffectiveDpOffsetDays(plan.settings);
  const recalcRows = (rows: CashOutGoPlanDetailRow[]) =>
    rows.map((row) => {
      const calculatedExpectedSentDate =
        row.section === "hand"
          ? (addDays(row.baseDate, billSubmissionOffsetDays) ?? "")
          : row.section === "delivered"
            ? (addDays(row.baseDate, dpOffsetDays) ?? "")
            : row.section === "dp"
              ? (addDays(row.baseDate, dpOffsetDays + 1) ?? "")
              : row.expectedSentDate || "";
      const expectedSentDate =
        options.preserveExpectedSentDate && hasFilledString(row.expectedSentDate)
          ? row.expectedSentDate
          : row.actualSentDate || row.expectedSentDateOverride
            ? row.expectedSentDate || calculatedExpectedSentDate
            : calculatedExpectedSentDate;
      const rawOffsetOverride = hasFilledString(row.billOffsetOverride)
        ? readMerAmount(row.billOffsetOverride)
        : undefined;
      const billOffsetOverride =
        rawOffsetOverride === undefined || rawOffsetOverride === billPaymentOffsetDays
          ? ""
          : row.billOffsetOverride;
      const offset =
        rawOffsetOverride === undefined || rawOffsetOverride === billPaymentOffsetDays
          ? billPaymentOffsetDays
          : rawOffsetOverride;
      const sentDate = row.actualSentDate || expectedSentDate;
      const expectedPaymentDate = row.manualExpectedPaymentDate || addDays(sentDate, offset) || "";
          return {
        ...row,
        expectedSentDate,
        billOffsetOverride,
        billOffsetDays: hasFilledString(billOffsetOverride) ? offset : billPaymentOffsetDays,
        expectedPaymentDate,
        overdue: Boolean(expectedSentDate && expectedSentDate < plan.today && !row.actualSentDate),
      };
    });
  const chequeslipsNotReceived = recalcRows(plan.chequeslipsNotReceived ?? []);
  const chequeslipRowKeys = new Set(chequeslipsNotReceived.map((row) => row.rowKey));
  const billsSubmitted = recalcRows(plan.billsSubmitted).filter(
    (row) => !chequeslipRowKeys.has(row.rowKey),
  );
  const expectedPaymentDateInPast = recalcRows(plan.expectedPaymentDateInPast ?? []);
  const billsAtHand = recalcRows(plan.billsAtHand);
  const deliveredBillsPending = recalcRows(plan.deliveredBillsPending);
  const dpBasedForecast = recalcRows(plan.dpBasedForecast ?? []);
  const dpExpired = recalcRows(plan.dpExpired ?? []);
  const expectedPaymentInLaterFys = recalcRows(plan.expectedPaymentInLaterFys ?? []);
  const recalculatedRows = [
    ...chequeslipsNotReceived,
    ...billsSubmitted,
    ...expectedPaymentDateInPast,
    ...billsAtHand,
    ...deliveredBillsPending,
    ...dpBasedForecast,
    ...dpExpired,
    ...expectedPaymentInLaterFys,
  ];
  const isOpenReturnRow = (row: CashOutGoPlanDetailRow) =>
    row.sourceFocusTarget.includes("billreturnedforcorrection:pending") ||
    row.sourceFocusTarget.startsWith("supplementarybill:returned:");
  const isPastExpectedPayment = (row: CashOutGoPlanDetailRow) =>
    Boolean(row.expectedPaymentDate && row.expectedPaymentDate < plan.today);
  const selectedFyStart = readFinancialYearStart(plan.financialYear);
  const selectedFyEnd = selectedFyStart
    ? `${selectedFyStart + 1}-03-31`
    : "";
  const isExpectedAfterSelectedFy = (row: CashOutGoPlanDetailRow) =>
    row.section !== "submitted" &&
    Boolean(selectedFyEnd && row.expectedPaymentDate && row.expectedPaymentDate > selectedFyEnd);
  const expectedPaymentDateInPastRows = recalculatedRows.filter(
    (row) => isPastExpectedPayment(row) && !isOpenReturnRow(row),
  );
  const currentRows = recalculatedRows.filter(
    (row) =>
      (!isPastExpectedPayment(row) || isOpenReturnRow(row)) &&
      !isExpectedAfterSelectedFy(row),
  );
  const expectedPaymentInLaterFyRows = recalculatedRows.filter(isExpectedAfterSelectedFy);
  const rowsForSection = (section: CashOutGoPlanDetailRow["section"]) =>
    currentRows.filter((row) => row.section === section);
  const nextPlan = {
    ...plan,
    chequeslipsNotReceived,
    billsSubmitted: rowsForSection("submitted"),
    expectedPaymentDateInPast: expectedPaymentDateInPastRows,
    billsAtHand: rowsForSection("hand"),
    deliveredBillsPending: rowsForSection("delivered"),
    dpBasedForecast: currentRows.filter((row) => row.section === "dp" || row.section === "advance"),
    dpExpired: rowsForSection("dpExpired"),
    expectedPaymentInLaterFys: expectedPaymentInLaterFyRows,
  };
  const exclusivePlan = enforceExclusiveCashOutGoPlanRows(nextPlan);
  return {
    ...exclusivePlan,
    monthwisePlan: rebuildCashOutGoMonthwisePlan(exclusivePlan),
  };
}

function rebuildCashOutGoMonthwisePlan(plan: CashOutGoPlanPayload): ExpectedCashOutgoRow[] {
  const currentMonthKey = plan.today.slice(0, 7);
  const expenditureByMonth = new Map(plan.expenditureTillDate.map((row) => [row.monthKey, row]));
  const forecastRows = [
    ...plan.billsSubmitted,
    ...plan.billsAtHand,
    ...plan.deliveredBillsPending,
    ...(plan.dpBasedForecast ?? []),
    ...(plan.dpExpired ?? []),
  ];
  const inFyForecastRows = getCashOutGoPlanIncludedRows(
    forecastRows,
    plan.currentFinancialYearEnd,
  );

  return getFinancialYearMonthKeys(plan.financialYear).map((monthKey) => {
    const expenditure = expenditureByMonth.get(monthKey);
    if (monthKey < currentMonthKey) {
      return {
        monthKey,
        month: formatMonthLabel(`${monthKey}-01`),
        capital: expenditure?.capital ?? 0,
        revenue: expenditure?.revenue ?? 0,
        total: expenditure?.total ?? 0,
      };
    }

    const forecast = inFyForecastRows
      .filter((row) => row.expectedPaymentDate.slice(0, 7) === monthKey)
      .reduce(
        (sum, row) => ({
          capital: sum.capital + row.capital,
          revenue: sum.revenue + row.revenue,
        }),
        { capital: 0, revenue: 0 },
      );
    const actual = monthKey === currentMonthKey ? expenditure : undefined;
    const capital = forecast.capital + (actual?.capital ?? 0);
    const revenue = forecast.revenue + (actual?.revenue ?? 0);
    return {
      monthKey,
      month: formatMonthLabel(`${monthKey}-01`),
      capital,
      revenue,
      total: capital + revenue,
    };
  });
}

function getEffectiveBillPaymentOffsetDays(settings: CashOutGoPlanPayload["settings"]) {
  return settings.billOffsetDays;
}

function getEffectiveBillSubmissionOffsetDays(settings: CashOutGoPlanPayload["settings"]) {
  return settings.handSubmissionOffsetDays;
}

function getEffectiveDpOffsetDays(settings: CashOutGoPlanPayload["settings"]) {
  return settings.dpOffsetDays;
}

function exportCashOutGoPlan(
  plan: CashOutGoPlanPayload,
  format: "excel" | "pdf",
  description?: string,
  expandedSections: CashOutGoPlanExpandedSections = defaultCashOutGoPlanExpandedSections,
) {
  const billPaymentOffsetDays = getEffectiveBillPaymentOffsetDays(plan.settings);
  const billSubmissionOffsetDays = getEffectiveBillSubmissionOffsetDays(plan.settings);
  const dpOffsetDays = getEffectiveDpOffsetDays(plan.settings);
  const expandedDetailTables = getCashOutGoPlanExpandedDetailExportTables(plan, expandedSections);
  void downloadBackendExport({
    format,
    title: "Cash Out Go Plan",
    description: getReportExportDescription(
      description,
      `Plan FY: ${plan.financialYear}`,
      `Bill Payment Offset: ${billPaymentOffsetDays} days`,
      `Bill submission Offset: ${billSubmissionOffsetDays} days`,
      `D.P. offset: ${dpOffsetDays} days`,
      "All the values are in Lakh.",
    ),
    fileName: `cash-out-go-plan-${plan.financialYear}.${format === "excel" ? "xlsx" : "pdf"}`,
    tables: [
      {
        title: "Cash Out Go Plan Summary",
        headers: [
          "Amount Type",
          ...getCashOutGoSummarySections(plan).map((section) => section.label),
        ],
        rows: [
          [
            "Capital",
            ...getCashOutGoSummarySections(plan).map((section) => formatLakhValue(section.capital)),
          ],
          [
            "Revenue",
            ...getCashOutGoSummarySections(plan).map((section) => formatLakhValue(section.revenue)),
          ],
        ],
      },
      {
        title: "Expenditure Till Date",
        headers: cashOutgoColumns.map((column) => column.label),
        rows: plan.expenditureTillDate.map((row, index) =>
          cashOutgoColumns.map((column) => getCashOutgoDisplayValue(row, column.key, index)),
        ),
      },
      ...expandedDetailTables,
      {
        title: "Monthwise Revised Cash Out Go Plan",
        headers: cashOutgoColumns.filter((column) => column.key !== "serial").map((column) => column.label),
        rows: [
          ...plan.monthwisePlan.map((row, index) =>
            cashOutgoColumns
              .filter((column) => column.key !== "serial")
              .map((column) => getCashOutgoDisplayValue(row, column.key, index)),
          ),
          getCashOutgoTotalsExportRow(plan.monthwisePlan).slice(1),
        ],
      },
    ],
  });
}

const cashOutGoPlanDetailExportColumns = [
  "S. No.",
  "Control No.",
  "Description",
  "Firm",
  "Source",
  "Base date",
  "Expected bill submission",
  "Expected payment",
  "Capital",
  "Revenue",
  "Selected FY treatment",
];

function getCashOutGoPlanExpandedDetailExportTables(
  plan: CashOutGoPlanPayload,
  expandedSections: CashOutGoPlanExpandedSections,
): ExportTable[] {
  const sections: Array<{
    key: CashOutGoPlanDetailSectionKey;
    title: string;
    rows: CashOutGoPlanDetailRow[];
  }> = [
    { key: "billsSubmitted", title: "Bills Submitted to PCDA", rows: plan.billsSubmitted },
    {
      key: "chequeslipsNotReceived",
      title: "Cheque Slips Not Received",
      rows: plan.chequeslipsNotReceived ?? [],
    },
    {
      key: "expectedPaymentDateInPast",
      title: "Expected Payment Date in Past",
      rows: plan.expectedPaymentDateInPast ?? [],
    },
    { key: "billsAtHand", title: "Bills at Hand", rows: plan.billsAtHand },
    {
      key: "deliveredBillsPending",
      title: "Items Delivered and Bills Yet to Be Prepared",
      rows: plan.deliveredBillsPending,
    },
    { key: "dpBasedForecast", title: "Items Based on D.P.", rows: plan.dpBasedForecast ?? [] },
    { key: "dpExpired", title: "D.P. Expired", rows: plan.dpExpired ?? [] },
    {
      key: "expectedPaymentInLaterFys",
      title: "Expected Payment in later FYs",
      rows: plan.expectedPaymentInLaterFys ?? [],
    },
  ];

  return sections
    .filter((section) => expandedSections[section.key])
    .map((section) => {
      const headers =
        section.key === "billsSubmitted"
          ? cashOutGoPlanDetailExportColumns.filter((_, index) => index !== 6)
          : cashOutGoPlanDetailExportColumns;
      return {
        title: section.title,
        headers,
        rows: section.rows.map((row, index) => {
          const values = [
            index + 1,
            ...getCashOutGoPlanDetailExportRow(row, plan.selectedFinancialYearEnd),
          ];
          if (section.key === "chequeslipsNotReceived") {
            values[values.length - 1] =
              "Historical MER warning only; excluded from Cash Out Go totals and forecasts";
          } else if (section.key === "expectedPaymentDateInPast") {
            values[values.length - 1] =
              "Past expected date; excluded until date is updated and saved";
          } else if (section.key === "expectedPaymentInLaterFys") {
            values[values.length - 1] =
              "Expected after selected Plan FY; excluded from selected FY totals and monthly forecast";
          }
          return section.key === "billsSubmitted"
            ? values.filter((_, valueIndex) => valueIndex !== 6)
            : values;
        }),
      };
    });
}

function getCashOutGoPlanDetailExportRow(
  row: CashOutGoPlanDetailRow,
  currentFinancialYearEnd: string,
) {
  const sentOrExpectedDate = row.actualSentDate
    ? `Actual sent: ${row.actualSentDate}`
    : row.expectedSentDate || "";

  return [
    row.fileRef,
    row.description,
    row.firm,
    row.amountSource,
    row.baseDate,
    sentOrExpectedDate,
    row.expectedPaymentDate,
    formatLakhValue(row.capital),
    formatLakhValue(row.revenue),
    !row.expectedPaymentDate
      ? "No expected payment date; backlog is not in a monthly forecast"
      : row.expectedPaymentDate && currentFinancialYearEnd &&
          row.expectedPaymentDate > currentFinancialYearEnd
        ? "Excluded: expected payment is after selected FY-end"
        : "Included in selected FY forecast",
  ];
}

function CashOutGoMonthTable({
  rows,
  title,
  titleHelper,
  singleRowBars = false,
  showSerial = true,
  open,
  onOpenChange,
}: {
  rows: ExpectedCashOutgoRow[];
  title: string;
  titleHelper?: HelperText;
  singleRowBars?: boolean;
  showSerial?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <details
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      className="space-y-3"
    >
      <summary className="cursor-pointer text-base font-bold">{title}</summary>
      <CashOutgoReport
        rows={rows}
        title={title}
        titleHelper={titleHelper}
        singleRowBars={singleRowBars}
        showSerial={showSerial}
        showTitle={false}
        emptyMessage="No rows found."
      />
    </details>
  );
}

function CashOutGoDetailTable({
  title,
  currentFinancialYearEnd = "",
  helperText,
  rows,
  onRowChange,
  onExpectedSentDateReset,
  onOpenFile,
  onOpenRowsSearch,
  onSave,
  editable = true,
  saving = false,
  saveDisabled = false,
  showExpectedSentDate = true,
  showSectionTotals = true,
  showOverdueHighlight = true,
  allowDpExpectedSentDateEdit = false,
  dpOnly = false,
  preserveSourceDateEditability = false,
  open,
  onOpenChange,
}: {
  title: string;
  currentFinancialYearEnd?: string;
  helperText?: HelperText;
  rows: CashOutGoPlanDetailRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRowChange: (
    rowKey: string,
    field: "expectedSentDate" | "manualExpectedPaymentDate",
    value: string,
  ) => void;
  onExpectedSentDateReset?: (rowKey: string) => void;
  onOpenFile?: (row: CashOutGoPlanDetailRow) => void;
  onOpenRowsSearch?: (rows: CashOutGoPlanDetailRow[]) => void;
  onSave?: () => void;
  editable?: boolean;
  saving?: boolean;
  saveDisabled?: boolean;
  showExpectedSentDate?: boolean;
  showSectionTotals?: boolean;
  showOverdueHighlight?: boolean;
  allowDpExpectedSentDateEdit?: boolean;
  dpOnly?: boolean;
  preserveSourceDateEditability?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof cashOutGoDetailPageSizeOptions)[number]>(25);
  const totals = getCashOutGoSectionTotals(rows, currentFinancialYearEnd);
  const columnCount = showExpectedSentDate ? 10 : 9;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = rows.length ? (safePage - 1) * pageSize : 0;
  const pageEnd = Math.min(pageStart + pageSize, rows.length);
  const visibleRows = rows.slice(pageStart, pageEnd);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const renderPagination = (position: "top" | "bottom") => (
    <div
      className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
      aria-label={`${title} pagination, ${position}`}
    >
      <span>
        {rows.length ? `Showing ${pageStart + 1}-${pageEnd} of ${rows.length} rows` : "No rows"}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value) as (typeof cashOutGoDetailPageSizeOptions)[number]);
              setPage(1);
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
          >
            {cashOutGoDetailPageSizeOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setPage(1)}
          disabled={safePage === 1}
          className="h-8 rounded-md border border-border bg-background px-2.5 font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          First
        </button>
        <button
          type="button"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={safePage === 1}
          className="h-8 rounded-md border border-border bg-background px-2.5 font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Previous
        </button>
        <span>Page {safePage} of {totalPages}</span>
        <button
          type="button"
          onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          disabled={safePage === totalPages}
          className="h-8 rounded-md border border-border bg-background px-2.5 font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
        <button
          type="button"
          onClick={() => setPage(totalPages)}
          disabled={safePage === totalPages}
          className="h-8 rounded-md border border-border bg-background px-2.5 font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Last
        </button>
      </div>
    </div>
  );

  return (
    <details
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]"
    >
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {onOpenRowsSearch && rows.length ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                onOpenRowsSearch(rows);
              }}
              className="text-left text-base font-bold text-primary underline-offset-2 hover:underline"
            >
              {title}
            </button>
          ) : (
            <span className="text-base font-bold">{title}</span>
          )}
          {helperText ? <FloatingHelper text={helperText} /> : null}
        </span>
        <span
          className={`grid gap-x-5 gap-y-1 text-right tabular-nums ${
            showSectionTotals
              ? "grid-cols-2 sm:grid-cols-4 sm:gap-x-8 lg:gap-x-10"
              : "grid-cols-1"
          }`}
        >
          {showSectionTotals ? (
            <>
              <span className="flex flex-col">
                <span className="text-[11px] text-muted-foreground">Total</span>
                <span className="text-xs font-semibold">{formatLakhValue(totals.total)}</span>
              </span>
              <span className="flex flex-col">
                <span className="text-[11px] text-muted-foreground">Capital</span>
                <span className="text-xs font-semibold">{formatLakhValue(totals.capital)}</span>
              </span>
              <span className="flex flex-col">
                <span className="text-[11px] text-muted-foreground">Revenue</span>
                <span className="text-xs font-semibold">{formatLakhValue(totals.revenue)}</span>
              </span>
            </>
          ) : null}
          <span className="flex flex-col">
            <span className="text-[11px] text-muted-foreground">Rows</span>
            <span className="text-xs text-muted-foreground">{rows.length}</span>
          </span>
        </span>
      </summary>
      <div className="mb-3 mt-4">{renderPagination("top")}</div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[1360px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className={showExpectedSentDate ? "w-[4%]" : "w-[5%]"} />
            <col className={showExpectedSentDate ? "w-[10.5%]" : "w-[11.5%]"} />
            <col className={showExpectedSentDate ? "w-[17%]" : "w-[18%]"} />
            <col className={showExpectedSentDate ? "w-[15.5%]" : "w-[16%]"} />
            <col className={showExpectedSentDate ? "w-[9%]" : "w-[10.5%]"} />
            <col className={showExpectedSentDate ? "w-[9%]" : "w-[10.5%]"} />
            {showExpectedSentDate ? <col className="w-[11.5%]" /> : null}
            <col className={showExpectedSentDate ? "w-[9.5%]" : "w-[12.5%]"} />
            <col className={showExpectedSentDate ? "w-[7%]" : "w-[8%]"} />
            <col className={showExpectedSentDate ? "w-[7%]" : "w-[8%]"} />
          </colgroup>
          <thead>
            <tr className="border-b border-border/60 bg-background text-left">
              <th colSpan={columnCount} className="px-3 py-2 text-xs font-normal normal-case text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  Edit forecast dates inline; save changes, or reset a date to its calculated value.
                  <FloatingHelper
                  text={[
                      "Expected bill submission and Expected payment dates can be adjusted for an individual row where enabled.",
                      "Save stores your changes using the access scope for your account.",
                      "Reset clears that row's manual date in the draft. Save afterward to persist the change.",
                      "For an advance, editing or clearing Expected payment updates that S.O.'s Advance Payment date in Add/Edit File. It is not a separate plan-only override.",
                      "For other rows, Expected payment uses the sent/resubmission date and payment offset unless you set a row-specific date.",
                    ]}
                    label="Cash Out Go forecast date editing"
                    className="size-5 border-0 bg-transparent shadow-none"
                    iconClassName="size-3"
                  />
                </span>
              </th>
            </tr>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <th className="w-16 px-3 py-2 text-right">S. No.</th>
              <th className="px-3 py-2">Control No.</th>
              <th className="px-3 py-2 pr-1">Description</th>
              <th className="px-3 py-2 pl-1">Firm</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Base date</th>
              {showExpectedSentDate ? (
                <th className="px-3 py-2">Expected bill submission</th>
              ) : null}
              <th className="px-3 py-2">
                Expected payment
              </th>
              <th className="px-3 py-2 text-right">Capital</th>
              <th className="px-3 py-2 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              visibleRows.map((row, index) => {
                const highlightOverdue = showOverdueHighlight && row.overdue;
                const beyondCurrentFy = Boolean(
                  currentFinancialYearEnd &&
                    row.expectedPaymentDate &&
                    row.expectedPaymentDate > currentFinancialYearEnd,
                );
                const expectedSentDateEditable =
                  editable &&
                  ((!dpOnly &&
                    (!preserveSourceDateEditability ||
                      row.section === "hand" ||
                      row.section === "delivered")) ||
                    (allowDpExpectedSentDateEdit &&
                      (row.section === "dp" || row.section === "dpExpired"))) &&
                  !row.actualSentDate;
                return (
                <tr
                  key={row.rowKey}
                  title={beyondCurrentFy ? "Expected payment is after the selected FY-end; excluded from that FY's forecast totals." : undefined}
                  className={
                    "border-b border-border/60 last:border-0 " +
                    (beyondCurrentFy ? "bg-muted/60 text-muted-foreground opacity-60 " : "") +
                    (highlightOverdue ? "text-destructive" : "")
                  }
                >
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{pageStart + index + 1}</td>
                  <td className="overflow-hidden px-4 py-2 font-medium">
                    {onOpenFile && row.fileId ? (
                      <button
                        type="button"
                        onClick={() => onOpenFile(row)}
                        className={
                          "block max-w-full truncate text-left font-semibold underline-offset-2 hover:underline " +
                          (highlightOverdue ? "text-destructive" : "text-primary")
                        }
                        title={row.fileRef}
                      >
                        {row.fileRef}
                      </button>
                    ) : (
                      <span className="block max-w-full truncate" title={row.fileRef}>
                        {row.fileRef}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 pr-1">
                    <span
                      className="block max-w-[26ch] truncate"
                      title={row.description}
                      aria-label={row.description}
                      tabIndex={row.description.length > 26 ? 0 : undefined}
                    >
                      {row.description.length > 26
                        ? `${row.description.slice(0, 25)}…`
                        : row.description}
                    </span>
                  </td>
                  <td className="px-3 py-2 pl-1">{row.firm}</td>
                  <td className="px-3 py-2">{row.amountSource}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.baseDate || (row.section === "advance" ? (
                      <span
                        className="block max-w-36 whitespace-normal text-[11px] leading-snug text-muted-foreground"
                        title="Advance payments use their own expected payment date, not a base delivery date."
                      >
                        Advance uses its own due date.
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">No starting date is recorded for this row.</span>
                    ))}
                  </td>
                  {showExpectedSentDate ? (
                    <td className="px-3 py-2">
                      {row.actualSentDate ? (
                        <span
                          className="text-[11px] text-muted-foreground"
                          title={`Actual submission date: ${row.actualSentDate}`}
                        >
                          Submitted
                        </span>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <DateInput
                            value={row.expectedSentDate || ""}
                            onChange={(value) => onRowChange(row.rowKey, "expectedSentDate", value)}
                            className={filterControlClass(
                              Boolean(row.expectedSentDateOverride),
                              "h-8 w-28 max-w-full rounded-md border border-input bg-background px-2 text-sm",
                            )}
                            disabled={!expectedSentDateEditable}
                          />
                          {!row.expectedSentDate ? (
                            <span className="max-w-36 whitespace-normal text-[11px] leading-snug text-muted-foreground">
                              {row.section === "advance"
                                ? "Not used for an advance; its own due date is shown under Expected payment."
                                : "No submission date is planned yet."}
                            </span>
                          ) : null}
                          {expectedSentDateEditable && onSave ? (
                            <span className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={onSave}
                                disabled={saving || saveDisabled}
                              className="h-6 min-w-12 rounded border border-border px-2 text-[11px] font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {saving ? "Saving..." : "Save"}
                            </button>
                              <button
                                type="button"
                                onClick={() => onExpectedSentDateReset?.(row.rowKey)}
                                disabled={saving || !row.expectedSentDateOverride}
                                className="inline-flex size-6 items-center justify-center rounded border border-border hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                                title="Reset Expected bill submission to software-calculated date"
                                aria-label="Reset Expected bill submission to software-calculated date"
                              >
                                <RotateCcw className="size-3.5" />
                              </button>
                            </span>
                          ) : null}
                        </div>
                      )}
                    </td>
                  ) : null}
                  <td className="px-3 py-2 tabular-nums">
                    <div className="flex flex-col items-start gap-1">
                      <DateInput
                        value={row.manualExpectedPaymentDate || row.expectedPaymentDate || ""}
                        onChange={(value) =>
                          onRowChange(row.rowKey, "manualExpectedPaymentDate", value)
                        }
                        className={filterControlClass(
                          row.section !== "advance" && Boolean(row.manualExpectedPaymentDate),
                          "h-8 w-28 max-w-full rounded-md border border-input bg-background px-2 text-sm",
                        )}
                        disabled={!editable}
                      />
                      {onSave && editable ? (
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={onSave}
                            disabled={saving || saveDisabled}
                            className="h-6 min-w-12 rounded border border-border px-2 text-[11px] font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {saving ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => onRowChange(row.rowKey, "manualExpectedPaymentDate", "")}
                            disabled={saving || !row.manualExpectedPaymentDate}
                            className="inline-flex size-6 items-center justify-center rounded border border-border hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                            title={row.section === "advance" ? "Clear expected advance-payment date" : "Reset to calculated Expected payment date"}
                            aria-label={row.section === "advance" ? "Clear expected advance-payment date" : "Reset to calculated Expected payment date"}
                          >
                            <RotateCcw className="size-3.5" />
                          </button>
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatLakhValue(row.capital)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatLakhValue(row.revenue)}
                  </td>
                </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={columnCount}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  No rows found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3">{renderPagination("bottom")}</div>
    </details>
  );
}

function FloatingHelper({
  text,
  label = "More information",
  side = "right",
  className = "",
  iconClassName = "size-3",
}: {
  text: HelperText;
  label?: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  iconClassName?: string;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={(event) => event.preventDefault()}
            className={
              "inline-flex size-7 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              className
            }
          >
            <Info className={iconClassName} />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          align="center"
          className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg leading-relaxed"
        >
          <HelperContent lines={flattenHelperText(text)} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function InfoCircleHelper({
  text,
  label = "More information",
}: {
  text: HelperText;
  label?: string;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={(event) => event.preventDefault()}
            className="inline-flex size-5 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="center"
          className="w-fit max-w-[min(48rem,calc(100vw-2rem))] border border-border bg-background p-2 text-foreground shadow-lg leading-relaxed"
        >
          <HelperContent lines={flattenHelperText(text)} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PreviousFySubmittedBillsHelper({
  label = "Previous FYs submitted bills help",
  className = "",
  iconClassName = "size-3",
}: {
  label?: string;
  className?: string;
  iconClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  const close = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
        className={
          "inline-flex size-7 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
          className
        }
      >
        <Info className={iconClassName} />
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/35 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label={label}
          onClick={close}
        >
          <div
            className="max-h-[82vh] w-[min(92vw,520px)] overflow-auto rounded-xl border border-sky-100 bg-[#f4f9ff] p-4 text-xs leading-relaxed text-foreground shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Include previous FYs submitted bills
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Close
              </button>
            </div>
            <div className="space-y-2 rounded-lg border border-sky-100 bg-white/70 px-3 py-3 text-muted-foreground">
              <p>Global Filter and File Initiation Year first decide which files are considered.</p>
              <p>
                When unchecked, submitted bills are counted only if the submission/resubmission date
                falls in the selected FY.
              </p>
              <p>
                When checked, earlier-FY submitted/resubmitted bills are also included if payment is
                still pending and the file is otherwise permitted by the current filters.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function splitHelperText(text: string) {
  const protectedText = protectHelperAbbreviations(text);
  return protectedText
    .split("\n")
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

function flattenHelperText(text: HelperText | undefined) {
  if (!text) return [];
  return Array.isArray(text) ? text.flatMap(splitHelperText) : splitHelperText(text);
}

function CashOutgoReport({
  rows,
  title,
  titleHelper,
  description,
  emptyMessage,
  actions,
  controls,
  singleRowBars = false,
  showSerial = true,
  showTitle = true,
  onOpenMonth,
  onOpenAll,
}: {
  rows: ExpectedCashOutgoRow[];
  title: string;
  titleHelper?: HelperText;
  description?: string;
  emptyMessage: string;
  actions?: ReactNode;
  controls?: ReactNode;
  singleRowBars?: boolean;
  showSerial?: boolean;
  showTitle?: boolean;
  onOpenMonth?: (monthKey: string) => void;
  onOpenAll?: () => void;
}) {
  const [resultView, setResultView] = useState<ResultView>("table");
  const totals = getExpectedCashOutgoTotals(rows);
  const visibleColumns = showSerial
    ? cashOutgoColumns
    : cashOutgoColumns.filter((column) => column.key !== "serial");
  const maxMonthlyTotal = Math.max(1, ...rows.map((row) => row.capital + row.revenue));
  const maxCapital = Math.max(1, ...rows.map((row) => row.capital));
  const maxRevenue = Math.max(1, ...rows.map((row) => row.revenue));
  const exportPlot: ExportPlot | undefined = resultView !== "table"
    ? {
        kind: resultView === "line" ? "line" : "bar",
        title: `${title} · monthly values`,
        measure: "Monthly Capital and Revenue",
        unit: "Lakh",
        xAxisTitle: "Month",
        yAxisTitle: "Amount Lakh",
        categories: rows.map((row) => row.month),
        series: [
          { name: "Capital", values: rows.map((row) => row.capital / 100_000) },
          { name: "Revenue", values: rows.map((row) => row.revenue / 100_000) },
        ],
      }
    : undefined;
  const descriptionWithHelper = [description, ...flattenHelperText(titleHelper)]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 space-y-4">
        <div className="min-w-0">
          {showTitle ? <h2 className="text-base font-bold">{title}</h2> : null}
          {descriptionWithHelper ? <ReportDescription description={descriptionWithHelper} /> : null}
        </div>
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-secondary/10 p-2">
          <div className="grid w-full grid-cols-2 gap-2 text-right text-xs sm:w-[280px]">
            <div className="rounded-md border border-border bg-card px-3 py-2">
              <div className="whitespace-nowrap text-muted-foreground">Total Capital</div>
              <div className="font-semibold tabular-nums">{formatLakhValue(totals.capital)}</div>
            </div>
            <div className="rounded-md border border-border bg-card px-3 py-2">
              <div className="whitespace-nowrap text-muted-foreground">Total Revenue</div>
              <div className="font-semibold tabular-nums">{formatLakhValue(totals.revenue)}</div>
            </div>
          </div>
          {controls}
          <TableChartToggle value={resultView} onChange={setResultView} label={`${title} view`} views={["table", "bar", "line"]} />
          <ExportPlotContext.Provider value={exportPlot}>{actions}</ExportPlotContext.Provider>
        </div>
      </div>

      <div className="mb-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm font-semibold text-foreground">
        All the values are in Lakh.
      </div>

      {resultView !== "table" ? (
      <div data-chart-copy-area className="rounded-lg border border-border bg-background p-4" aria-label={`${title} monthly chart`}>
        <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
        <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" />Capital</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-emerald-600" />Revenue</span>
            {resultView === "bar" ? <span>Amount (Lakhs)</span> : null}
            <span>Select a month to open its contributing files. Values are in Lakh.</span>
            <ChartCopyButton />
          </div>
          {resultView === "line" ? (
            <div className="h-[320px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 12, right: 18, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 13 }} />
                  <YAxis tick={{ fontSize: 13 }} width={64}
                    label={{ value: "Lakhs", angle: -90, position: "insideLeft", fontSize: 13 }} />
                  <ChartTooltip formatter={(value) => `${formatLakhValue(Number(value))} Lakh`} />
                  <ChartLegend />
                  <Line type="monotone" dataKey="capital" name="Capital" stroke="#0f766e" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
          singleRowBars ? (
            <div className="space-y-5">
              {[
                { key: "capital" as const, label: "Capital", max: maxCapital, color: "bg-primary" },
                { key: "revenue" as const, label: "Revenue", max: maxRevenue, color: "bg-emerald-600" },
              ].map((measure) => (
                <section key={measure.key} className="rounded-md border border-border p-3">
                  <h3 className="mb-2 text-sm font-semibold">{measure.label}</h3>
                  <div className="overflow-x-auto">
                    <div role="group" aria-label="Monthly distribution bar chart" className="grid min-w-[1120px] grid-cols-12 gap-x-2">
                      {rows.map((row) => {
                        const value = row[measure.key];
                        const height = value > 0 ? Math.max(3, (value / measure.max) * 100) : 0;
                        return (
                          <button
                            key={row.monthKey}
                            type="button"
                            disabled={!value}
                            onClick={() => onOpenMonth?.(row.monthKey)}
                            className="group flex min-w-0 flex-col items-stretch gap-1 text-center disabled:cursor-default disabled:opacity-50"
                            title={value ? `Open ${row.month} contributing files` : undefined}
                          >
                            <span className="text-xs font-semibold tabular-nums text-foreground">
                              {formatLakhValue(value)}
                            </span>
                            <span className="flex h-36 items-end justify-center border-b border-border px-1">
                              <span
                                className={`w-full max-w-12 rounded-t-sm transition group-hover:opacity-80 ${measure.color}`}
                                style={{ height: `${height}%` }}
                              />
                            </span>
                            <span className="truncate whitespace-nowrap text-xs text-muted-foreground">
                              {row.month}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>
              ))}
            </div>
          ) : (
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[1120px] grid-cols-12 gap-x-2"
            >
            {rows.map((row) => {
              const total = row.capital + row.revenue;
              const height = total > 0 ? Math.max(3, total / maxMonthlyTotal * 100) : 0;
              return (
                <button key={row.monthKey} type="button" disabled={!total} onClick={() => onOpenMonth?.(row.monthKey)}
                  className="group flex min-w-0 flex-col items-stretch gap-1 text-center disabled:cursor-default disabled:opacity-50"
                  title={total ? `Open ${row.month} contributing files` : undefined}>
                  <span className="text-xs font-semibold tabular-nums text-foreground">{formatLakhValue(total)}</span>
                  <span className="flex h-36 items-end justify-center border-b border-border px-1">
                    <span className="flex w-full max-w-12 flex-col justify-end overflow-hidden rounded-t-sm transition group-hover:opacity-80" style={{ height: `${height}%` }}>
                      <span className="bg-emerald-600" style={{ height: total ? `${row.revenue / total * 100}%` : "0%" }} />
                      <span className="bg-primary" style={{ height: total ? `${row.capital / total * 100}%` : "0%" }} />
                    </span>
                  </span>
                  <span className="truncate whitespace-nowrap text-xs text-muted-foreground">{row.month}</span>
                </button>
              );
            })}
            </div>
          </div>
          ))}
        </div>
      ) : (
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] table-fixed border-collapse text-sm">
            <colgroup>
              {showSerial ? <col className="w-[12%]" /> : null}
              <col className={showSerial ? "w-[38%]" : "w-[50%]"} />
              <col className={showSerial ? "w-[25%]" : "w-[25%]"} />
              <col className={showSerial ? "w-[25%]" : "w-[25%]"} />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                {visibleColumns.map((column) => (
                  <th
                    key={column.key}
                    className={
                      "whitespace-nowrap px-3 py-2.5 font-semibold " +
                      (column.align === "right" ? "text-right" : "text-left")
                    }
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row, index) => (
                  <tr
                    key={row.monthKey}
                    className={
                      "border-b border-border/60 last:border-0 " +
                      (index % 2 === 0 ? "bg-card" : "bg-secondary/15")
                    }
                  >
                    {visibleColumns.map((column) => (
                      <td
                        key={column.key}
                        className={
                          "whitespace-nowrap px-3 py-2.5 tabular-nums " +
                          (column.align === "right" ? "text-right" : "text-left")
                        }
                      >
                        {column.key === "month" ? (
                          onOpenMonth ? (
                            <button
                              type="button"
                              onClick={() => onOpenMonth(row.monthKey)}
                              className="font-medium text-primary underline-offset-2 hover:underline"
                            >
                              {getCashOutgoDisplayValue(row, column.key, index, false)}
                            </button>
                          ) : (
                            <span className="font-medium">
                              {getCashOutgoDisplayValue(row, column.key, index, false)}
                            </span>
                          )
                        ) : (
                          getCashOutgoDisplayValue(row, column.key, index, false)
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={visibleColumns.length}
                    className="px-3 py-8 text-center text-sm text-muted-foreground"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length ? (
              <tfoot>
              <CashOutgoTotalsRow totals={totals} onOpenAll={onOpenAll} showSerial={showSerial} />
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
      )}
    </div>
  );
}

function ReportDescription({ description }: { description: string }) {
  const lines = splitHelperText(description);

  if (lines.length > 1) {
    return (
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
        {lines.map((line, index) => (
          <li key={`${line}-${index}`}>{line}</li>
        ))}
      </ul>
    );
  }

  return <p className="text-xs text-muted-foreground">{description}</p>;
}

function CashOutgoTable({
  rows,
  emptyMessage,
}: {
  rows: ExpectedCashOutgoRow[];
  emptyMessage: string;
}) {
  const totals = getExpectedCashOutgoTotals(rows);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              {cashOutgoColumns.map((column) => (
                <th
                  key={column.key}
                  className={
                    "px-3 py-2.5 font-semibold " +
                    (column.align === "right" ? "text-right" : "text-left")
                  }
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr
                  key={row.monthKey}
                  className={
                    "border-b border-border/60 last:border-0 " +
                    (index % 2 === 0 ? "bg-card" : "bg-secondary/15")
                  }
                >
                  {cashOutgoColumns.map((column) => (
                    <td
                      key={column.key}
                      className={
                        "px-3 py-2.5 tabular-nums " +
                        (column.align === "right" ? "text-right" : "text-left")
                      }
                    >
                      {getCashOutgoDisplayValue(row, column.key, index, false)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={cashOutgoColumns.length}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length ? (
            <tfoot>
              <CashOutgoTotalsRow totals={totals} />
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function CashOutgoTotalsRow({
  totals,
  onOpenAll,
  showSerial = true,
}: {
  totals: Pick<ExpectedCashOutgoRow, "capital" | "revenue">;
  onOpenAll?: () => void;
  showSerial?: boolean;
}) {
  const totalLabel = onOpenAll ? (
    <button
      type="button"
      onClick={onOpenAll}
      className="font-semibold text-primary underline-offset-2 hover:underline"
    >
      Total
    </button>
  ) : (
    "Total"
  );
  const capital = formatLakhValue(totals.capital);
  const revenue = formatLakhValue(totals.revenue);
  return (
    <tr className="border-t border-border bg-accent font-semibold">
      {showSerial ? <td className="px-3 py-2.5 text-right tabular-nums" /> : null}
      <td className="px-3 py-2.5 text-left">{totalLabel}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {onOpenAll ? (
          <button
            type="button"
            onClick={onOpenAll}
            className="font-semibold text-primary underline-offset-2 hover:underline"
          >
            {capital}
          </button>
        ) : (
          capital
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {onOpenAll ? (
          <button
            type="button"
            onClick={onOpenAll}
            className="font-semibold text-primary underline-offset-2 hover:underline"
          >
            {revenue}
          </button>
        ) : (
          revenue
        )}
      </td>
    </tr>
  );
}

function StatusCountValue({
  value,
  onClick,
}: {
  value: number | string | undefined;
  onClick?: () => void;
}) {
  if (value === undefined || value === "") {
    return <span className="text-muted-foreground/40">-</span>;
  }

  if (value === "-") {
    return <span className="text-muted-foreground">-</span>;
  }

  const isZero = value === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex min-w-8 justify-center rounded px-2 py-0.5 text-sm font-bold transition hover:ring-2 hover:ring-ring/30 " +
        (isZero ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-foreground")
      }
    >
      {value}
    </button>
  );
}

function DelayStatusReport({
  rows,
  title,
  summary,
  thresholdDays,
  selectedDays,
  selectedMilestoneKey,
  onDaysChange,
  onMilestoneChange,
  onDaysReset,
  onPdf,
  onExcel,
  onOpenFile,
  onOpenSearch,
  onOpenMilestone,
  onOpenBiddingBreakup,
}: {
  rows: DelayStatusRow[];
  title: string;
  summary: ReturnType<typeof getDelayStatusSummary>;
  thresholdDays: number;
  selectedDays: string;
  selectedMilestoneKey: string;
  onDaysChange: (value: string) => void;
  onMilestoneChange: (value: string) => void;
  onDaysReset: () => void;
  onPdf: () => void;
  onExcel: () => void;
  onOpenFile: (row: DelayStatusRow) => void;
  onOpenSearch: () => void;
  onOpenMilestone: (milestoneKey: string) => void;
  onOpenBiddingBreakup: (breakupKey: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof delayStatusPageSizeOptions)[number]>(25);
  const [showBiddingBreakup, setShowBiddingBreakup] = useState(false);
  const daysFilterActive = selectedDays !== "5";
  const milestoneFilterActive = selectedMilestoneKey !== "all";
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = rows.length ? (safePage - 1) * pageSize : 0;
  const pageEnd = Math.min(pageStart + pageSize, rows.length);
  const visibleRows = rows.slice(pageStart, pageEnd);
  const pageNumbers = getPaginationPages(safePage, totalPages);
  const biddingBreakupRows = getBiddingDelayBreakupRows(rows);

  useEffect(() => {
    setPage(1);
  }, [selectedDays, selectedMilestoneKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            Live/current delays only: files or S.O./stage cases stuck in their current milestone or
            S.O. stage for more than {thresholdDays} days. Already-cleared historical delays are
            excluded.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label
            className={filterLabelClass(
              daysFilterActive,
              "flex w-40 flex-col gap-1 text-xs text-muted-foreground",
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              Days
              <FloatingHelper
                text="Default is 5 days. Use reset to restore the default threshold."
                className="size-5 border-0 bg-transparent shadow-none"
                iconClassName="size-3"
              />
            </span>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min="0"
                value={selectedDays}
                onChange={(event) => onDaysChange(event.target.value)}
                className={filterControlClass(
                  daysFilterActive,
                  "h-9 min-w-0 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40",
                )}
              />
              <button
                type="button"
                onClick={onDaysReset}
                className="btn-ghost h-9 w-9 p-0"
                title="Reset days"
                aria-label="Reset days"
              >
                <RotateCcw className="size-4" />
              </button>
              <FloatingHelper
                text="Reset restores Delay Status threshold to the default 5 days for the current screen/session only; it is not saved as a global software setting."
                label="Reset delay status days help"
                className="size-8 border-0 bg-transparent shadow-none"
                iconClassName="size-3"
              />
            </span>
          </label>
          <label
            className={filterLabelClass(
              milestoneFilterActive,
              "flex min-w-[220px] flex-col gap-1 text-xs text-muted-foreground",
            )}
          >
            <span>Milestone</span>
            <select
              value={selectedMilestoneKey}
              onChange={(event) => onMilestoneChange(event.target.value)}
              className={filterControlClass(
                milestoneFilterActive,
                "h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40",
              )}
            >
              <option value="all">All milestones</option>
              {delayMilestoneOptions.map((milestone) => (
                <option key={milestone.key} value={milestone.key}>
                  {milestone.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onPdf}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
          >
            <FileText className="size-4" />
            PDF
          </button>
          <button
            type="button"
            onClick={onExcel}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
          >
            <FileSpreadsheet className="size-4" />
            Excel
          </button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <button
          type="button"
          onClick={onOpenSearch}
          className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-left hover:bg-accent"
        >
          <div className="text-muted-foreground">Delayed stages</div>
          <div className="font-semibold tabular-nums">{rows.length}</div>
        </button>
        <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
          <div className="text-muted-foreground">Average days</div>
          <div className="font-semibold tabular-nums">
            {summary.averageDays ? `${summary.averageDays} days` : "-"}
          </div>
        </div>
        <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
          <div className="text-muted-foreground">Longest delay</div>
          <div className="font-semibold tabular-nums">
            {summary.longestDays ? `${summary.longestDays} days` : "-"}
          </div>
        </div>
      </div>

      {selectedMilestoneKey === "all" && summary.byMilestone.length ? (
        <div className="mb-5 flex flex-wrap gap-2">
          {summary.byMilestone.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() =>
                item.key === biddingDelayMilestoneKey
                  ? setShowBiddingBreakup(true)
                  : onOpenMilestone(item.key)
              }
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="text-muted-foreground">{item.label}</span>{" "}
              <span className="font-semibold tabular-nums">{item.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {showBiddingBreakup ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-md border border-border bg-card p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold">Bidding Delay breakup</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Files delayed for more than {thresholdDays} days, grouped by earliest pending
                  bidding stage.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBiddingBreakup(false)}
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
              >
                Close
              </button>
            </div>
            <div className="space-y-2">
              {biddingBreakupRows.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onOpenBiddingBreakup(item.key)}
                  disabled={item.count === 0}
                  className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{item.label}</span>
                  <span className="font-semibold tabular-nums">{item.count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div>
          {rows.length
            ? `Showing ${pageStart + 1}-${pageEnd} of ${rows.length} delayed stages`
            : "No delayed stages"}
        </div>
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value) as typeof pageSize);
              setPage(1);
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
          >
            {delayStatusPageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      {totalPages > 1 ? (
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm"
          aria-label="Delay status pagination, top"
        >
          <div className="text-xs text-muted-foreground">Page {safePage} of {totalPages}</div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={safePage === 1}
              className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              First
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage === 1}
              className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              Previous
            </button>
            {pageNumbers.map((pageNumber) => (
              <button
                key={`top-${pageNumber}`}
                type="button"
                onClick={() => setPage(pageNumber)}
                className={
                  "h-8 min-w-8 rounded-md border px-2 text-xs font-medium " +
                  (pageNumber === safePage
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-accent")
                }
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage === totalPages}
              className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={safePage === totalPages}
              className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              Last
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                {delayStatusColumns.map((column) => (
                  <th
                    key={column.key}
                    className={
                      "px-3 py-2.5 font-semibold " +
                      (column.align === "right" ? "text-right" : "text-left")
                    }
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length ? (
                visibleRows.map((row, index) => {
                  const absoluteIndex = pageStart + index;
                  return (
                    <tr
                      key={`${row.fileId}:${row.milestoneKey}:${row.stageStartDate}:${absoluteIndex}`}
                      className={
                        "border-b border-border/60 last:border-0 " +
                        (index % 2 === 0 ? "bg-card" : "bg-secondary/15")
                      }
                    >
                      {delayStatusColumns.map((column) => (
                        (() => {
                          const compactWidth =
                            column.key === "description"
                              ? 36
                              : getCompactTableTextWidth(column.key, column.label);
                          const value =
                            getDelayStatusDisplayValue(row, column.key, absoluteIndex) || "-";
                          return (
                            <td
                              key={column.key}
                              className={
                                "px-3 py-2.5 " +
                                (column.align === "right"
                                  ? "text-right tabular-nums"
                                  : "text-left")
                              }
                            >
                              {column.key === "fileRef" ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenFile(row)}
                                  className="font-medium text-primary underline-offset-2 hover:underline"
                                >
                                  {value}
                                </button>
                              ) : compactWidth ? (
                                <CompactTableText value={value} width={compactWidth} />
                              ) : (
                                value
                              )}
                            </td>
                          );
                        })()
                      ))}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={delayStatusColumns.length}
                    className="px-3 py-8 text-center text-sm text-muted-foreground"
                  >
                    No delayed stages found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="text-xs text-muted-foreground">
            Page {safePage} of {totalPages}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={safePage === 1}
              className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              First
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage === 1}
              className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              Previous
            </button>
            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                className={
                  "h-8 min-w-8 rounded-md border px-2 text-xs font-medium " +
                  (pageNumber === safePage
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-accent")
                }
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage === totalPages}
              className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={safePage === totalPages}
              className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              Last
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getPaginationPages(currentPage: number, totalPages: number, maxVisible = 5) {
  const visible = Math.max(1, Math.min(maxVisible, totalPages));
  const half = Math.floor(visible / 2);
  let startPage = Math.max(1, currentPage - half);
  const endPage = Math.min(totalPages, startPage + visible - 1);
  startPage = Math.max(1, endPage - visible + 1);
  return Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
}

function exportDelayStatusToExcel(rows: DelayStatusRow[], title: string, description?: string) {
  void downloadDelayStatus(rows, title, "excel", description);
}

async function fetchAllMasterFirms() {
  const firms: MasterFirm[] = [];
  let page = 1;
  const pageSize = 500;
  for (;;) {
    const result = await fetchMasterFirms({ page, pageSize });
    firms.push(...result.firms);
    if (firms.length >= result.total || result.firms.length === 0) break;
    page += 1;
  }
  return firms;
}

function buildFirmDatabaseRows({
  firms,
  files,
  ratingConfig,
}: {
  firms: MasterFirm[];
  files: FileRecord[];
  ratingConfig: ReturnType<typeof useSettings>["firmRatingConfig"];
}): FirmDatabaseRow[] {
  const config = normalizeFirmRatingConfig(ratingConfig);
  return firms.map((firm) => {
    const rawEntries = files.flatMap((file) =>
      rawSupplyOrders(file).map((order, index) => ({
        file,
        order,
        orderKey: `${file.id}:${index}`,
      })),
    );
    const firmRawEntries = rawEntries.filter(({ order }) => doesOrderBelongToFirm(order, firm));
    const historicalPlacedEntries = firmRawEntries.filter(({ file, order }) =>
      isSupplyOrderTabComplete(file, order),
    );
    const activeRawEntries = historicalPlacedEntries.filter(
      ({ file, order }) => !isSupplyOrderCancelled(file, order),
    );
    const placedEntries = activeRawEntries;
    const completedEntries = placedEntries.filter(({ file, order }) =>
      isFirmSupplyOrderComplete(file, order),
    );
    const runningEntries = placedEntries.filter(
      ({ file, order }) => !isFirmSupplyOrderComplete(file, order),
    );
    const capitalValue = sumAmounts(placedEntries, "soValueCapital");
    const revenueValue = sumAmounts(placedEntries, "soValueRevenue");
    const orderValues = placedEntries.map(({ file, order }) => getOrderTotalValue(file, order));
    const totalValue = capitalValue + revenueValue;
    const delayEntries = placedEntries.map((entry) => ({
      ...entry,
      delay: getFirmOrderDelayResult(entry.file, entry.order),
    }));
    const completedDelayEntries = delayEntries.filter((entry) => entry.delay.completed);
    const delayedCompletedEntries = completedDelayEntries.filter(
      (entry) => entry.delay.delayDays > 0,
    );
    const delayDays = delayedCompletedEntries.map((entry) => entry.delay.delayDays);
    const ratingEntries = placedEntries
      .map(({ file, order }) => ({
        file,
        order,
        score: calculateFirmRatingScore(order.firmRatingValues, config),
      }))
      .filter(
        (entry): entry is { file: FileRecord; order: SupplyOrderDetail; score: number } =>
          entry.score !== undefined,
      );
    const fieldAverages = getFirmRatingFieldAverages(ratingEntries, config);
    const latestRating = ratingEntries
      .slice()
      .sort((a, b) =>
        String(b.order.soDate ?? "").localeCompare(String(a.order.soDate ?? "")),
      )[0]?.score;
    const divisions = Array.from(
      new Set(historicalPlacedEntries.map(({ file }) => file.division).filter(
        (value): value is string => hasFilledString(value),
      )),
    ).sort();
    const fileTypes = Array.from(
      new Set(historicalPlacedEntries.map(({ file }) => file.fileType).filter(
        (value): value is string => hasFilledString(value),
      )),
    ).sort();
    const bgStats = getFirmBgStats(placedEntries);
    const bgTargets = getFirmBgTargets(placedEntries);
    const clickTargets: FirmDatabaseRow["clickTargets"] = {
      totalSupplyOrders: getUniqueEntryFileIds(historicalPlacedEntries),
      runningSupplyOrders: getUniqueEntryFileIds(runningEntries),
      completedSupplyOrders: getUniqueEntryFileIds(completedEntries),
      cancelledSupplyOrders: getUniqueEntryFileIds(
        historicalPlacedEntries.filter(({ file, order }) => isSupplyOrderCancelled(file, order)),
      ),
      stageDeliveryOrders: getUniqueEntryFileIds(
        placedEntries.filter(({ order }) => isYes(order.stageDelivery)),
      ),
      completedWithinDp: getUniqueEntryFileIds(
        completedDelayEntries.filter((entry) => entry.delay.delayDays <= 0),
      ),
      completedAfterDp: getUniqueEntryFileIds(delayedCompletedEntries),
      activeDelayedOrders: getUniqueEntryFileIds(
        delayEntries.filter((entry) => entry.delay.activeDelayed),
      ),
      dpExtensionOrders: getUniqueEntryFileIds(
        placedEntries.filter(({ order }) => isYes(order.dpExtension)),
      ),
      ldOrders: getUniqueEntryFileIds(placedEntries.filter(({ order }) => isYes(order.ld))),
      bgApplicableOrders: bgTargets.bgApplicableOrders,
      bgReceivedOrders: bgTargets.bgReceivedOrders,
      bgPendingOrders: bgTargets.bgPendingOrders,
      bgDelayedOrders: bgTargets.bgDelayedOrders,
      bgReturnedOrders: bgTargets.bgReturnedOrders,
      ratingCount: getUniqueEntryFileIds(ratingEntries),
      highValueOrders: getUniqueEntryFileIds(
        placedEntries.filter(({ file }) => isYes(file.highValue)),
      ),
      divisionCount: getUniqueEntryFileIds(historicalPlacedEntries),
    };

    const numeric: FirmDatabaseRow["numeric"] = {
      totalSupplyOrders: historicalPlacedEntries.length,
      runningSupplyOrders: runningEntries.length,
      completedSupplyOrders: completedEntries.length,
      cancelledSupplyOrders: historicalPlacedEntries.length - activeRawEntries.length,
      stageDeliveryOrders: placedEntries.filter(({ order }) => isYes(order.stageDelivery)).length,
      capitalValue,
      revenueValue,
      totalValue,
      averageOrderValue: orderValues.length ? totalValue / orderValues.length : 0,
      highestOrderValue: Math.max(0, ...orderValues),
      completedWithinDp: completedDelayEntries.filter((entry) => entry.delay.delayDays <= 0).length,
      completedAfterDp: delayedCompletedEntries.length,
      activeDelayedOrders: delayEntries.filter((entry) => entry.delay.activeDelayed).length,
      averageDelayDays: delayDays.length
        ? delayDays.reduce((sum, value) => sum + value, 0) / delayDays.length
        : 0,
      maxDelayDays: Math.max(0, ...delayDays),
      dpExtensionOrders: placedEntries.filter(({ order }) => isYes(order.dpExtension)).length,
      ldOrders: placedEntries.filter(({ order }) => isYes(order.ld)).length,
      ...bgStats,
      averageRating: ratingEntries.length
        ? ratingEntries.reduce((sum, entry) => sum + entry.score, 0) / ratingEntries.length
        : 0,
      ratingCount: ratingEntries.length,
      latestRating: latestRating ?? 0,
      deliveryRating: fieldAverages.delivery ?? 0,
      qualityRating: fieldAverages.quality ?? 0,
      afterSalesServiceRating: fieldAverages.afterSalesService ?? 0,
      highValueOrders: placedEntries.filter(({ file }) => isYes(file.highValue)).length,
      divisionCount: divisions.length,
    };

    return {
      id: firm.id,
      divisionNames: divisions,
      orderIds: placedEntries.map((entry) => entry.orderKey),
      clickTargets,
      numeric,
      serial: 0,
      firmName: firm.firmName || "Not set",
      firmUniqueNo: firm.firmUniqueNo || "Not set",
      emailId: firm.emailId || "",
      contactNo: firm.contactNo || "",
      city: firm.city || "",
      totalSupplyOrders: numeric.totalSupplyOrders ?? 0,
      runningSupplyOrders: numeric.runningSupplyOrders ?? 0,
      completedSupplyOrders: numeric.completedSupplyOrders ?? 0,
      cancelledSupplyOrders: numeric.cancelledSupplyOrders ?? 0,
      stageDeliveryOrders: numeric.stageDeliveryOrders ?? 0,
      capitalValue: formatCurrency(numeric.capitalValue ?? 0),
      revenueValue: formatCurrency(numeric.revenueValue ?? 0),
      totalValue: formatCurrency(numeric.totalValue ?? 0),
      averageOrderValue: formatCurrency(numeric.averageOrderValue ?? 0),
      highestOrderValue: formatCurrency(numeric.highestOrderValue ?? 0),
      completedWithinDp: numeric.completedWithinDp ?? 0,
      completedAfterDp: numeric.completedAfterDp ?? 0,
      activeDelayedOrders: numeric.activeDelayedOrders ?? 0,
      averageDelayDays: formatNumber(numeric.averageDelayDays ?? 0),
      maxDelayDays: numeric.maxDelayDays ?? 0,
      dpExtensionOrders: numeric.dpExtensionOrders ?? 0,
      ldOrders: numeric.ldOrders ?? 0,
      bgApplicableOrders: numeric.bgApplicableOrders ?? 0,
      bgReceivedOrders: numeric.bgReceivedOrders ?? 0,
      bgPendingOrders: numeric.bgPendingOrders ?? 0,
      bgDelayedOrders: numeric.bgDelayedOrders ?? 0,
      bgReturnedOrders: numeric.bgReturnedOrders ?? 0,
      averageRating: formatFirmRatingScore(numeric.averageRating) || "",
      ratingCount: numeric.ratingCount ?? 0,
      latestRating: formatFirmRatingScore(numeric.latestRating) || "",
      deliveryRating: formatFirmRatingScore(numeric.deliveryRating) || "",
      qualityRating: formatFirmRatingScore(numeric.qualityRating) || "",
      afterSalesServiceRating: formatFirmRatingScore(numeric.afterSalesServiceRating) || "",
      highValueOrders: numeric.highValueOrders ?? 0,
      divisionCount: numeric.divisionCount ?? 0,
      divisions: divisions.join(", "),
      fileTypes: fileTypes.join(", "),
    };
  });
}

function doesOrderBelongToFirm(order: SupplyOrderDetail, firm: MasterFirm) {
  const orderUniqueNo = normalizeFirmMatchValue(order.firmUniqueNo);
  const firmUniqueNo = normalizeFirmMatchValue(firm.firmUniqueNo);
  if (orderUniqueNo && firmUniqueNo) return orderUniqueNo === firmUniqueNo;
  const orderName = normalizeFirmMatchValue(order.firm);
  const firmName = normalizeFirmMatchValue(firm.firmName);
  return Boolean(orderName && firmName && orderName === firmName);
}

function normalizeFirmMatchValue(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function sumAmounts(
  entries: Array<{ file: FileRecord; order: SupplyOrderDetail }>,
  key: "soValueCapital" | "soValueRevenue",
) {
  return entries.reduce((sum, { file, order }) => sum + (getInrAmount(order[key], file) ?? 0), 0);
}

function getOrderTotalValue(file: FileRecord, order: SupplyOrderDetail) {
  return (
    (getInrAmount(order.soValueCapital, file) ?? 0) +
    (getInrAmount(order.soValueRevenue, file) ?? 0)
  );
}

function isFirmSupplyOrderComplete(file: FileRecord, order: SupplyOrderDetail) {
  if (!isSupplyOrderTabComplete(file, order)) return false;
  if (isDeliveryInspectionApplicable(file)) {
    const stages = fileSupplyOrders({ ...file, supplyOrders: [order] });
    return stages.length > 0 && stages.every((stage) => hasFilledString(stage.materialReceiptDate));
  }
  return hasFilledString(order.jobCompletionDate) || isJobCompletionDone(order);
}

function getFirmOrderDelayResult(file: FileRecord, order: SupplyOrderDetail) {
  const stages = isDeliveryInspectionApplicable(file)
    ? fileSupplyOrders({ ...file, supplyOrders: [order] })
    : [order];
  const stageResults = stages.map((stage) => {
    const dpDate = stage.dpDate;
    const completionDate = isDeliveryInspectionApplicable(file)
      ? stage.materialReceiptDate
      : stage.jobCompletionDate;
    const completed =
      hasFilledString(completionDate) ||
      (!isDeliveryInspectionApplicable(file) && isJobCompletionDone(stage));
    const completionReference = hasFilledString(completionDate)
      ? completionDate
      : formatLocalDate(new Date());
    const delayDays = getPositiveDateDifferenceDays(dpDate, completionReference);
    return {
      completed,
      delayDays,
      activeDelayed: !completed && delayDays > 0,
    };
  });
  return {
    completed: stageResults.length > 0 && stageResults.every((result) => result.completed),
    delayDays: Math.max(0, ...stageResults.map((result) => result.delayDays)),
    activeDelayed: stageResults.some((result) => result.activeDelayed),
  };
}

function getPositiveDateDifferenceDays(fromDate: string | undefined, toDate: string | undefined) {
  const fromTime = parseLocalDateTime(fromDate ?? "");
  const toTime = parseLocalDateTime(toDate ?? "");
  if (fromTime === undefined || toTime === undefined) return 0;
  return Math.max(0, Math.floor((toTime - fromTime) / 86_400_000));
}

function getFirmBgStats(entries: Array<{ file: FileRecord; order: SupplyOrderDetail }>) {
  const stats = {
    bgApplicableOrders: 0,
    bgReceivedOrders: 0,
    bgPendingOrders: 0,
    bgDelayedOrders: 0,
    bgReturnedOrders: 0,
  };
  for (const { file, order } of entries) {
    const categories = ["psb", "pwb", "psbPwb"].filter((category) =>
      isBgCategoryApplicable(file, order, category),
    );
    if (!categories.length) continue;
    stats.bgApplicableOrders += 1;
    if (categories.some((category) => isBgReceivedOrder(order, category))) {
      stats.bgReceivedOrders += 1;
    }
    if (categories.some((category) => !isBgReceivedOrder(order, category))) {
      stats.bgPendingOrders += 1;
    }
    if (categories.some((category) => isBgPendingOrder(file, order, category))) {
      stats.bgDelayedOrders += 1;
    }
    if (categories.some((category) => isBgReturnedOrder(file, order, category))) {
      stats.bgReturnedOrders += 1;
    }
  }
  return stats;
}

function getFirmBgTargets(entries: Array<{ file: FileRecord; order: SupplyOrderDetail }>) {
  const targets: Partial<Record<FirmDatabaseColumnKey, string[]>> = {
    bgApplicableOrders: [],
    bgReceivedOrders: [],
    bgPendingOrders: [],
    bgDelayedOrders: [],
    bgReturnedOrders: [],
  };
  for (const entry of entries) {
    const categories = ["psb", "pwb", "psbPwb"].filter((category) =>
      isBgCategoryApplicable(entry.file, entry.order, category),
    );
    if (!categories.length) continue;
    targets.bgApplicableOrders?.push(entry.file.id);
    if (categories.some((category) => isBgReceivedOrder(entry.order, category))) {
      targets.bgReceivedOrders?.push(entry.file.id);
    }
    if (categories.some((category) => !isBgReceivedOrder(entry.order, category))) {
      targets.bgPendingOrders?.push(entry.file.id);
    }
    if (categories.some((category) => isBgPendingOrder(entry.file, entry.order, category))) {
      targets.bgDelayedOrders?.push(entry.file.id);
    }
    if (categories.some((category) => isBgReturnedOrder(entry.file, entry.order, category))) {
      targets.bgReturnedOrders?.push(entry.file.id);
    }
  }
  return {
    bgApplicableOrders: uniqueStrings(targets.bgApplicableOrders ?? []),
    bgReceivedOrders: uniqueStrings(targets.bgReceivedOrders ?? []),
    bgPendingOrders: uniqueStrings(targets.bgPendingOrders ?? []),
    bgDelayedOrders: uniqueStrings(targets.bgDelayedOrders ?? []),
    bgReturnedOrders: uniqueStrings(targets.bgReturnedOrders ?? []),
  };
}

function getUniqueEntryFileIds(entries: Array<{ file: FileRecord }>) {
  return uniqueStrings(entries.map((entry) => entry.file.id));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getFirmRatingFieldAverages(
  entries: Array<{ order: SupplyOrderDetail; score: number }>,
  config: ReturnType<typeof normalizeFirmRatingConfig>,
) {
  const result: Partial<Record<"delivery" | "quality" | "afterSalesService", number>> = {};
  for (const key of ["delivery", "quality", "afterSalesService"] as const) {
    const field = config.fields.find((item) => item.id === key);
    if (!field) continue;
    const values = entries
      .map(({ order }) => Number.parseFloat(order.firmRatingValues?.[field.id] ?? ""))
      .filter((value) => Number.isFinite(value));
    if (values.length) result[key] = values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return result;
}

function sortFirmDatabaseRows(
  rows: FirmDatabaseRow[],
  key: FirmDatabaseSortKey,
  direction: FirmDatabaseSortDirection,
) {
  const multiplier = direction === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const numericA = a.numeric[key];
    const numericB = b.numeric[key];
    if (numericA !== undefined || numericB !== undefined) {
      return ((numericA ?? 0) - (numericB ?? 0)) * multiplier;
    }
    return String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * multiplier;
  });
}

function getFirmDatabaseSummary(rows: FirmDatabaseRow[]) {
  return {
    firms: rows.length,
    totalSupplyOrders: rows.reduce((sum, row) => sum + (row.numeric.totalSupplyOrders ?? 0), 0),
    runningSupplyOrders: rows.reduce((sum, row) => sum + (row.numeric.runningSupplyOrders ?? 0), 0),
    totalValue: rows.reduce((sum, row) => sum + (row.numeric.totalValue ?? 0), 0),
    totalSupplyOrderFileIds: uniqueStrings(
      rows.flatMap((row) => row.clickTargets.totalSupplyOrders ?? []),
    ),
    runningSupplyOrderFileIds: uniqueStrings(
      rows.flatMap((row) => row.clickTargets.runningSupplyOrders ?? []),
    ),
  };
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function exportFirmDatabaseReport(
  rows: FirmDatabaseRow[],
  visibleColumns: FirmDatabaseColumnKey[],
  sortKey: FirmDatabaseSortKey,
  sortDirection: FirmDatabaseSortDirection,
  title: string,
  format: "excel" | "pdf",
  description?: string,
  plot?: ExportPlot,
) {
  const columns = firmDatabaseColumns.filter(
    (column) => column.key === "serial" || visibleColumns.includes(column.key),
  );
  const analysisColumn = firmDatabaseColumns.find((column) => column.key === sortKey)!;
  const includeAnalysisValueColumn = sortKey !== "firmName";
  const includeDivisionReferences = columns.some((column) => column.key === "divisions");
  const divisionReferenceRows = rows.map((row, index) => [
    index + 1,
    String(row.firmName ?? ""),
    row.divisionNames.length ? row.divisionNames.join(", ") : "-",
  ]);
  const monetaryColumnKeys = new Set<FirmDatabaseColumnKey>([
    "capitalValue",
    "revenueValue",
    "totalValue",
    "averageOrderValue",
    "highestOrderValue",
  ]);
  const exportDescription = getReportExportDescription(
    description,
    "Monetary values are in Lakh.",
  );
  const emphasizedColumns: number[] = [];
  let exportColumnIndex = 0;
  columns.forEach((column) => {
    if (column.key === sortKey) emphasizedColumns.push(exportColumnIndex);
    exportColumnIndex += 1;
    if (column.key === "firmName" && includeAnalysisValueColumn) {
      emphasizedColumns.push(exportColumnIndex);
      exportColumnIndex += 1;
    }
  });
  void downloadBackendExport({
    format,
    title,
    description: exportDescription,
    plot,
    tables: [
      {
        title,
        headers: columns.flatMap((column) => [
          column.key === "divisions" ? "Division ref. No." : column.label,
          ...(column.key === "firmName" && includeAnalysisValueColumn ? [analysisColumn.label] : []),
        ]),
        emphasizedColumns,
        rows: rows.map((row, index) =>
          columns.flatMap((column) => {
            const value =
              column.key === "serial"
                ? String(index + 1)
                : column.key === "divisions"
                  ? String(index + 1)
                  : monetaryColumnKeys.has(column.key)
                    ? formatLakhValue(row.numeric[column.key] ?? 0)
                    : String(row[column.key] ?? "");
            const analysisValue = monetaryColumnKeys.has(sortKey)
              ? formatLakhValue(row.numeric[sortKey] ?? 0)
              : String(row[sortKey] ?? "");
            return [
              value,
              ...(column.key === "firmName" && includeAnalysisValueColumn ? [analysisValue] : []),
            ];
          }),
        ),
      },
      ...(includeDivisionReferences
        ? [
            {
              title: "Division reference list",
              headers: ["S. No.", "Firm name", "Division list"],
              rows: divisionReferenceRows,
            },
          ]
        : []),
    ],
  });
}

function printDelayStatusToPdf(rows: DelayStatusRow[], title: string, description?: string) {
  void downloadDelayStatus(rows, title, "pdf", description);
}

function exportMmgSummary(
  rows: MmgSummaryRow[],
  title: string,
  format: "excel" | "pdf",
  description?: string,
) {
  void downloadBackendExport({
    format,
    title,
    description,
    tables: [
      {
        headers: ["Field", "Value"],
        columnWidths: [260, 510],
        rows: rows.length
          ? rows.map((row) => [row.label, row.value])
          : [["No MMG Summary fields selected."]],
      },
    ],
  });
}

async function exportMonthlyOperationalReport(
  title: string,
  description: string,
  columns: MonthlyReportColumn[],
  rows: Array<Record<string, number | string>>,
  format: "excel" | "pdf",
  plot?: ExportPlot | ExportPlot[],
) {
  const plots = Array.isArray(plot) ? plot : undefined;
  await downloadBackendExport({
    format,
    title,
    description,
    plot: Array.isArray(plot) ? undefined : plot,
    plots,
    tables: [
      {
        headers: columns.map((column) => column.label),
        rows: rows.map((row) => columns.map((column) => String(row[column.key] ?? ""))),
      },
    ],
  });
}

async function downloadDelayStatus(
  rows: DelayStatusRow[],
  title: string,
  format: "excel" | "pdf",
  description?: string,
) {
  const exportColumns = delayStatusColumns;
  await downloadBackendExport({
    format,
    title,
    description,
    tables: [
      {
        headers: exportColumns.map((column) => column.label),
        rows: rows.map((row, index) =>
          exportColumns.map((column) => getDelayStatusDisplayValue(row, column.key, index)),
        ),
      },
    ],
  });
}

function getDelayStatusTableHtml(rows: DelayStatusRow[]) {
  const exportColumns = delayStatusColumns;
  return `
    <table>
      <thead>
        <tr>
          ${exportColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${
          rows.length
            ? rows
                .map(
                  (row, index) => `
                    <tr>
                      ${exportColumns
                        .map(
                          (column) =>
                            `<td>${escapeHtml(getDelayStatusDisplayValue(row, column.key, index))}</td>`,
                        )
                        .join("")}
                    </tr>
                  `,
                )
                .join("")
            : `<tr><td colspan="${exportColumns.length}">No delayed stages found.</td></tr>`
        }
      </tbody>
    </table>
  `;
}

function getExportFileName(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function exportExpectedCashOutgoToExcel(
  rows: ExpectedCashOutgoRow[],
  title: string,
  description?: string,
  emptyMessage = "No expected cash outgo rows found.",
  plot?: ExportPlot,
) {
  exportCashOutgoToExcel(rows, title, emptyMessage, description, plot);
}

function exportActualCashOutgoToExcel(rows: ExpectedCashOutgoRow[], title: string) {
  exportCashOutgoToExcel(rows, title, "No actual cash out go rows found.");
}

function exportCurrentLiabilityToExcel(
  rows: ExpectedCashOutgoRow[],
  title: string,
  description?: string,
  plot?: ExportPlot,
) {
  exportCashOutgoToExcel(
    rows,
    title,
    "No unpaid liability found for the current month.",
    description,
    plot,
  );
}

function exportCashOutgoToExcel(
  rows: ExpectedCashOutgoRow[],
  title: string,
  emptyMessage: string,
  description?: string,
  plot?: ExportPlot,
) {
  void downloadCashOutgo(rows, title, emptyMessage, description, "excel", plot);
}

function printExpectedCashOutgoToPdf(
  rows: ExpectedCashOutgoRow[],
  title: string,
  description?: string,
  emptyMessage = "No expected cash outgo rows found.",
  plot?: ExportPlot,
) {
  printCashOutgoToPdf(rows, title, emptyMessage, description, plot);
}

function printActualCashOutgoToPdf(rows: ExpectedCashOutgoRow[], title: string) {
  printCashOutgoToPdf(rows, title, "No actual cash out go rows found.");
}

function printCurrentLiabilityToPdf(
  rows: ExpectedCashOutgoRow[],
  title: string,
  description?: string,
  plot?: ExportPlot,
) {
  printCashOutgoToPdf(rows, title, "No unpaid liability found for the current month.", description, plot);
}

function printCashOutgoToPdf(
  rows: ExpectedCashOutgoRow[],
  title: string,
  emptyMessage: string,
  description?: string,
  plot?: ExportPlot,
) {
  void downloadCashOutgo(rows, title, emptyMessage, description, "pdf", plot);
}

async function downloadCashOutgo(
  rows: ExpectedCashOutgoRow[],
  title: string,
  emptyMessage: string,
  description: string | undefined,
  format: "excel" | "pdf",
  plot?: ExportPlot,
) {
  await downloadBackendExport({
    format,
    title,
    description: getReportExportDescription(description, "All the values are in Lakh."),
    plot,
    tables: [
      {
        headers: cashOutgoColumns.map((column) => column.label),
        rows: rows.length
          ? [
              ...rows.map((row, index) =>
                cashOutgoColumns.map((column) => getCashOutgoDisplayValue(row, column.key, index)),
              ),
              getCashOutgoTotalsExportRow(rows),
            ]
          : [[emptyMessage]],
      },
    ],
  });
}

function getCashOutgoTableHtml(rows: ExpectedCashOutgoRow[], emptyMessage: string) {
  const totals = getExpectedCashOutgoTotals(rows);

  return `
    <table>
      <thead>
        <tr>
          ${cashOutgoColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${
          rows.length
            ? rows
                .map(
                  (row, index) => `
                    <tr>
                      ${cashOutgoColumns
                        .map(
                          (column) =>
                            `<td>${escapeHtml(getCashOutgoDisplayValue(row, column.key, index))}</td>`,
                        )
                        .join("")}
                    </tr>
                  `,
                )
                .join("")
            : `<tr><td colspan="${cashOutgoColumns.length}">${escapeHtml(emptyMessage)}</td></tr>`
        }
      </tbody>
      ${
        rows.length
          ? `<tfoot>
              <tr>
                <td></td>
                <td>Total</td>
                <td>${escapeHtml(formatLakhValue(totals.capital))}</td>
                <td>${escapeHtml(formatLakhValue(totals.revenue))}</td>
              </tr>
            </tfoot>`
          : ""
      }
    </table>
  `;
}

function escapeHtml(value: string | number | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function UnifiedFinanceReviewReport({
  title,
  summary,
  plan,
  loading,
  error,
  contextDescription,
}: {
  title: string;
  summary?: DashboardSummaryPayload;
  plan?: CashOutGoPlanPayload;
  loading: boolean;
  error?: string;
  contextDescription: string;
}) {
  const [view, setView] = useState<ResultView>("table");
  const finance = summary?.financeTotals;
  const snapshot = summary?.finance1Summary;
  const monthlyPlan = plan?.monthwisePlan ?? [];
  const actualByMonth = new Map((plan?.expenditureTillDate ?? []).map((row) => [row.monthKey, row]));
  const cashRows = monthlyPlan.map((row) => {
    const actual = actualByMonth.get(row.monthKey);
    return {
      month: row.month,
      monthKey: row.monthKey,
      planned: row.total,
      recorded: actual?.total ?? 0,
      variance: row.total - (actual?.total ?? 0),
    };
  });
  const plot: ExportPlot | undefined =
    view === "table" || !cashRows.length
      ? undefined
      : {
          kind: view === "line" ? "line" : "bar",
          title: `${title} · Cash Out Go monthly comparison`,
          measure: "Planned outgo and recorded payments",
          unit: "INR",
          xAxisTitle: "Month",
          yAxisTitle: "Amount INR",
          categories: cashRows.map((row) => row.month),
          series: [
            { name: "Planned outgo", values: cashRows.map((row) => row.planned) },
            { name: "Recorded payments", values: cashRows.map((row) => row.recorded) },
          ],
        };

  const positionRows: Array<[string, number, number]> = [
    ["Allocated", finance?.allocatedCapital ?? 0, finance?.allocatedRevenue ?? 0],
    ["Intended", finance?.projectedCapital ?? 0, finance?.projectedRevenue ?? 0],
    ["Booked", finance?.bookedCapital ?? 0, finance?.bookedRevenue ?? 0],
    ["Committed", finance?.spentCapital ?? 0, finance?.spentRevenue ?? 0],
    [
      "Paid during Activity Year",
      (finance?.paidCapital ?? 0) + (finance?.advanceCapital ?? 0),
      (finance?.paidRevenue ?? 0) + (finance?.advanceRevenue ?? 0),
    ],
    ["Paid till today (live)", finance?.paidTillDateCapital ?? 0, finance?.paidTillDateRevenue ?? 0],
  ];
  const snapshotRows: Array<[string, FinanceReviewMetric | undefined]> = [
    ["Intended at FY-end", snapshot?.intendedAtFyEnd],
    ["Booked at FY-end", snapshot?.bookedAtFyEnd],
    ["Committed at FY-end", snapshot?.committedAtFyEnd],
    ["Paid by FY-end", snapshot?.paidByFyEnd],
    ["Unpaid liability at FY-end", snapshot?.unpaidLiabilityAtFyEnd],
    ["Paid till today (live)", snapshot?.paidTillDate],
    ["Balance unpaid till today (live)", snapshot?.balanceUnpaidToday],
  ];
  const exportTables: ExportTable[] = [
    {
      title: "Finance Position · Active dashboard finance context",
      headers: ["Measure", "Capital", "Revenue", "Total"],
      rows: positionRows.map(([label, capital, revenue]) => [
        label,
        formatLakhValue(capital),
        formatLakhValue(revenue),
        formatLakhValue(capital + revenue),
      ]),
    },
    {
      title: `FY Snapshot · ${snapshot?.fiscalYear ?? "Selected FY"}`,
      headers: ["Measure", "Capital", "Revenue", "Total"],
      rows: snapshotRows.map(([label, metric]) => [
        label,
        formatLakhValue(metric?.capital ?? 0),
        formatLakhValue(metric?.revenue ?? 0),
        formatLakhValue(metric?.total ?? 0),
      ]),
    },
    {
      title: `Cash Out Go · ${plan?.financialYear ?? "Selected FY"}`,
      headers: ["Month", "Planned outgo", "Recorded payments", "Plan less recorded"],
      rows: cashRows.map((row) => [
        row.month,
        formatLakhValue(row.planned),
        formatLakhValue(row.recorded),
        formatLakhValue(row.variance),
      ]),
    },
  ];
  const exportUnified = (format: "pdf" | "excel") =>
    downloadBackendExport({
      format,
      title,
      description: [
        contextDescription,
        "Finance Position follows the active dashboard finance context.",
        "FY Snapshot separates frozen FY-end values from live paid/unpaid balances.",
        "Cash Out Go follows its plan FY and selected division; it does not inherit File Initiation Year or File Type filters.",
        "All monetary values are shown in Lakhs.",
      ].join("\n"),
      plot,
      tables: exportTables,
    });

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Finance Position, FY Snapshot, and Cash Out Go are shown separately because each uses a different time basis.</p>
          </div>
          <div className="flex items-center gap-2">
            <TableChartToggle value={view} onChange={setView} label="Cash Out Go comparison view" views={["table", "bar", "line"]} />
            <ReportHeaderActions onPdf={() => void exportUnified("pdf")} onExcel={() => void exportUnified("excel")} />
          </div>
        </div>
        {loading ? <div className="py-2 text-sm text-muted-foreground">Loading finance data…</div> : null}
        {error ? <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-bold">1. Finance Position</h3>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">Uses the active dashboard Global Filter, File Initiation Year, Division, and File Type context. Paid includes advance payments.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-2">Measure</th><th className="py-2 text-right">Capital</th><th className="py-2 text-right">Revenue</th><th className="py-2 text-right">Total</th></tr></thead>
            <tbody>{positionRows.map(([label, capital, revenue]) => <tr key={label} className="border-b border-border/70"><th className="py-2 text-left font-medium">{label}</th><td className="py-2 text-right tabular-nums">{formatCurrency(capital)}</td><td className="py-2 text-right tabular-nums">{formatCurrency(revenue)}</td><td className="py-2 text-right font-semibold tabular-nums">{formatCurrency(capital + revenue)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-bold">2. FY Snapshot · {snapshot?.fiscalYear ?? "Selected FY"}</h3>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">The first five rows are frozen at FY-end. The final two are live and change as payments are entered.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-2">Measure</th><th className="py-2 text-right">Capital</th><th className="py-2 text-right">Revenue</th><th className="py-2 text-right">Total</th></tr></thead>
            <tbody>{snapshotRows.map(([label, metric]) => <tr key={label} className="border-b border-border/70"><th className="py-2 text-left font-medium">{label}</th><td className="py-2 text-right tabular-nums">{formatCurrency(metric?.capital ?? 0)}</td><td className="py-2 text-right tabular-nums">{formatCurrency(metric?.revenue ?? 0)}</td><td className="py-2 text-right font-semibold tabular-nums">{formatCurrency(metric?.total ?? 0)}</td></tr>)}</tbody>
          </table>
        </div>
        {!snapshot ? <p className="mt-2 text-xs text-muted-foreground">Snapshot values are unavailable for this filter context.</p> : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">3. Cash Out Go · {plan?.financialYear ?? "Selected FY"}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Plan and recorded payment values use this plan FY and Division. “Plan less recorded” is a comparison, not a new liability calculation.</p>
          </div>
        </div>
        {view !== "table" && cashRows.length ? (
          <div data-chart-copy-area className="mb-4 rounded-md border border-border bg-background p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-foreground">Cash Out Go · Planned outgo and Recorded payments</h4>
              <ChartCopyButton />
            </div>
            <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              {view === "line" ? (
                <LineChart data={cashRows} margin={{ top: 12, right: 18, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 13 }} />
                  <YAxis tick={{ fontSize: 13 }} width={64}
                    label={{ value: "Lakhs", angle: -90, position: "insideLeft", fontSize: 13 }} />
                  <ChartTooltip formatter={(value) => formatCurrency(Number(value) || 0)} />
                  <ChartLegend />
                  <Line type="monotone" dataKey="planned" name="Planned outgo" stroke="#0f766e" strokeWidth={2} />
                  <Line type="monotone" dataKey="recorded" name="Recorded payments" stroke="#2563eb" strokeWidth={2} />
                </LineChart>
              ) : (
                <BarChart data={cashRows} margin={{ top: 12, right: 18, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 13 }} />
                  <YAxis tick={{ fontSize: 13 }} width={64}
                    label={{ value: "Lakhs", angle: -90, position: "insideLeft", fontSize: 13 }} />
                  <ChartTooltip formatter={(value) => formatCurrency(Number(value) || 0)} />
                  <ChartLegend />
                  <Bar dataKey="planned" name="Planned outgo" fill="#0f766e" />
                  <Bar dataKey="recorded" name="Recorded payments" fill="#2563eb" />
                </BarChart>
              )}
            </ResponsiveContainer>
            </div>
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-2">Month</th><th className="py-2 text-right">Planned outgo</th><th className="py-2 text-right">Recorded payments</th><th className="py-2 text-right">Plan less recorded</th></tr></thead>
            <tbody>{cashRows.map((row) => <tr key={row.monthKey} className="border-b border-border/70"><th className="py-2 text-left font-medium">{row.month}</th><td className="py-2 text-right tabular-nums">{formatCurrency(row.planned)}</td><td className="py-2 text-right tabular-nums">{formatCurrency(row.recorded)}</td><td className="py-2 text-right tabular-nums">{formatCurrency(row.variance)}</td></tr>)}</tbody>
          </table>
          {!cashRows.length ? <p className="py-4 text-sm text-muted-foreground">Cash Out Go plan data is not available.</p> : null}
        </div>
      </section>
    </div>
  );
}

type ExpectedCashOutgoRow = {
  monthKey: string;
  month: string;
  capital: number;
  revenue: number;
  total: number;
};

type DelayStatusRow = {
  fileId: string;
  fileRef: string;
  division: string;
  indentor: string;
  description: string;
  milestoneKey: string;
  milestone: string;
  stageStartDate: string;
  daysInStage: number;
  lastFilledDate: string;
  focusSection?: string;
  focusTarget?: string;
  biddingBreakupKey?: string;
};

type CashOutgoColumnKey = "serial" | "month" | "capital" | "revenue";
type DelayStatusColumnKey =
  | "serial"
  | "fileRef"
  | "indentor"
  | "description"
  | "milestone"
  | "stageStartDate"
  | "daysInStage";
type MonthlyReportColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
  getFilter?: (row: Record<string, number | string>) => string | undefined;
  getTotalFilter?: (
    rows: Array<Record<string, number | string>>,
    context: MonthlyReportTotalContext,
  ) => string | undefined;
};
type MonthlyReportViewMode = "year" | "month" | "inline";
type MonthlyReportTotalContext = {
  viewMode: MonthlyReportViewMode;
  breakupYear?: string;
};
type MonthlyReportConfig = {
  description: string;
  columns: MonthlyReportColumn[];
  rows: Array<Record<string, number | string>>;
  yearColumns?: MonthlyReportColumn[];
  yearRows?: Array<Record<string, number | string>>;
  monthRowsByYear?: Record<string, Array<Record<string, number | string>>>;
  supportsYearDrilldown?: boolean;
};

const cashOutgoColumns = [
  { key: "serial", label: "S.No.", align: "right" },
  { key: "month", label: "Month", align: "left" },
  { key: "capital", label: "Capital", align: "right" },
  { key: "revenue", label: "Revenue", align: "right" },
] satisfies Array<{ key: CashOutgoColumnKey; label: string; align: "left" | "right" }>;

const delayStatusColumns = [
  { key: "serial", label: "S.No.", align: "right" },
  { key: "fileRef", label: "Control No.", align: "left" },
  { key: "indentor", label: "Indentor", align: "left" },
  { key: "description", label: "Description", align: "left" },
  { key: "milestone", label: "Current milestone", align: "left" },
  { key: "stageStartDate", label: "Stage start date", align: "left" },
  { key: "daysInStage", label: "Days", align: "right" },
] satisfies Array<{ key: DelayStatusColumnKey; label: string; align: "left" | "right" }>;

const monthlyCountColumns: MonthlyReportColumn[] = [
  { key: "month", label: "Month", align: "left" },
  { key: "count", label: "Count", align: "right" },
];

const ageingReportColumns: MonthlyReportColumn[] = [
  { key: "bucket", label: "Ageing", align: "left" },
  {
    key: "count",
    label: "Count",
    align: "right",
    getFilter: (row) => String(row.dashboardFilter ?? ""),
  },
  { key: "capital", label: "Capital value", align: "right" },
  { key: "revenue", label: "Revenue value", align: "right" },
  { key: "total", label: "Total value", align: "right" },
];

const ageingBuckets = [
  { key: "0-30", label: "0-30 days", min: 0, max: 30 },
  { key: "31-60", label: "31-60 days", min: 31, max: 60 },
  { key: "61-90", label: "61-90 days", min: 61, max: 90 },
  { key: "90+", label: "90+ days", min: 91, max: Number.POSITIVE_INFINITY },
] as const;

function getExpectedCashOutgoByDpRows(files: FileRecord[], offsetDays = 0): ExpectedCashOutgoRow[] {
  const totals = new Map<string, ExpectedCashOutgoRow>();

  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
    fileSupplyOrders(file).forEach((order) => {
      const deliveryPeriodDate = getDeliveryPeriodDate(order);
      if (!hasFilledString(deliveryPeriodDate) || !isPaymentOrderActive(file, order)) return;
      if (hasFilledString(order.materialReceiptDate)) return;
      if (hasFilledString(order.paymentDate)) return;
      const cashOutgoDate = addDays(deliveryPeriodDate, offsetDays + 1);
      if (!cashOutgoDate) return;

      addCashOutgoTotal(totals, cashOutgoDate, file, order);
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getExpectedCashOutgoByReceiptRows(
  files: FileRecord[],
  offsetDays = 0,
): ExpectedCashOutgoRow[] {
  const totals = new Map<string, ExpectedCashOutgoRow>();

  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
    fileSupplyOrders(file).forEach((order) => {
      if (!isPaymentOrderActive(file, order)) return;
      const reportDate = getReceiptPendingBillReportDate(file, order);
      if (!hasFilledString(reportDate)) return;
      if (hasFilledString(order.paymentDate)) return;
      const cashOutgoDate = addDays(reportDate, offsetDays);
      if (!cashOutgoDate) return;

      addCashOutgoTotal(totals, cashOutgoDate, file, order);
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getReceiptPendingBillReportDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  return getNonInspectionPaymentDueDate(file, order);
}

function getActualCashOutgoRows(files: FileRecord[]): ExpectedCashOutgoRow[] {
  const totals = new Map<string, ExpectedCashOutgoRow>();

  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
    filePaymentOrders(file).forEach((order) => {
      if (!hasFilledString(order.paymentDate) || !isPaymentOrderActive(file, order)) return;
      const paymentDate = order.paymentDate;
      if (!paymentDate) return;

      addCashOutgoTotal(totals, paymentDate, file, order, "actual");
    });

    filePaymentOrders(file).forEach((order) => {
      if (!isPaymentOrderActive(file, order)) return;
      getSupplementaryBills(order).forEach((bill) => {
        if (!hasFilledString(bill.paymentDate)) return;
        const paymentDate = bill.paymentDate;
        if (!paymentDate) return;

        addSupplementaryBillCashOutgoTotal(totals, paymentDate, file, bill, "actual");
      });
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getCurrentMonthLiabilityRows(rows: ExpectedCashOutgoRow[], monthKey: string) {
  const totals = rows
    .filter((row) => row.monthKey <= monthKey)
    .reduce(
      (sum, row) => ({
        capital: sum.capital + row.capital,
        revenue: sum.revenue + row.revenue,
      }),
      { capital: 0, revenue: 0 },
    );

  if (totals.capital === 0 && totals.revenue === 0) return [];

  return [
    {
      monthKey,
      month: formatMonthLabel(`${monthKey}-01`),
      capital: Math.round(totals.capital),
      revenue: Math.round(totals.revenue),
      total: Math.round(totals.capital + totals.revenue),
    },
  ];
}

function getCurrentMonthKey() {
  return formatLocalDate(new Date()).slice(0, 7);
}

function getFinancialYearRange(financialYear: string) {
  const startYear = readFinancialYearStart(financialYear) ?? new Date().getFullYear();
  return {
    startMonthKey: `${startYear}-04`,
    endMonthKey: `${startYear + 1}-03`,
  };
}

function getFinancialYearStartDate(financialYear: string) {
  const startYear = readFinancialYearStart(financialYear) ?? new Date().getFullYear();
  return `${startYear}-04-01`;
}

function getFinancialYearMonthKeys(financialYear: string) {
  const startYear = readFinancialYearStart(financialYear) ?? new Date().getFullYear();
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(startYear, 3 + index, 1);
    return formatMonthKey(date);
  });
}

function buildMerDraftRows(
  financialYear: string,
  rows: Array<Pick<MerCashOutgoRow, "monthKey" | "capital" | "revenue">>,
): MerCashOutgoDraftRow[] {
  const byMonth = new Map(rows.map((row) => [row.monthKey, row]));
  return getFinancialYearMonthKeys(financialYear).map((monthKey) => {
    const row = byMonth.get(monthKey);
    return {
      monthKey,
      month: formatMonthLabel(`${monthKey}-01`),
      capital: formatThousandsAndLakhs(Number(row?.capital ?? 0) / 100_000, 5),
      revenue: formatThousandsAndLakhs(Number(row?.revenue ?? 0) / 100_000, 5),
    };
  });
}

function getMerDraftDirtyRows(rows: MerCashOutgoDraftRow[]) {
  return rows.map((row) => ({
    monthKey: row.monthKey,
    capital: merLakhsToInr(row.capital),
    revenue: merLakhsToInr(row.revenue),
  }));
}

function getCashOutGoPlanDirtySnapshot(plan: CashOutGoPlanPayload) {
  return JSON.stringify({
    settings: plan.settings,
    rows: [
      ...plan.billsSubmitted,
      ...(plan.expectedPaymentDateInPast ?? []),
      ...plan.billsAtHand,
      ...plan.deliveredBillsPending,
      ...(plan.expectedPaymentInLaterFys ?? []),
      ...(plan.dpBasedForecast ?? []),
      ...(plan.dpExpired ?? []),
    ].map((row) => ({
      rowKey: row.rowKey,
      expectedSentDate: row.expectedSentDate,
      expectedSentDateOverride: row.expectedSentDateOverride,
      manualExpectedPaymentDate: row.manualExpectedPaymentDate,
      billOffsetOverride: row.billOffsetOverride,
    })),
  });
}

function isReportDirtyValueEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readMerAmount(value: string | number | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(
    String(value ?? "")
      .replace(/,/g, "")
      .trim(),
  );
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMerDisplayValue(value: number) {
  return value > 0 ? formatThousandsAndLakhs(value, 5) : "-";
}

function formatMerChartValue(value: number) {
  const formatted = formatMerDisplayValue(value);
  return formatted === "-" ? formatted : `${formatted} Lakh`;
}

function merLakhsToInr(value: string | number | undefined) {
  return Math.round(readMerAmount(value) * 100_000);
}

function getFinancialYearMonthOptions(financialYear: string, currentMonthKey: string) {
  const range = getFinancialYearRange(financialYear);
  const endMonthKey = range.endMonthKey <= currentMonthKey ? range.endMonthKey : currentMonthKey;
  if (range.startMonthKey > endMonthKey) {
    return [{ value: currentMonthKey, label: formatMonthTitle(currentMonthKey) }];
  }

  const options: Array<{ value: string; label: string }> = [];
  let cursor = parseLocalMonth(range.startMonthKey);
  const end = parseLocalMonth(endMonthKey);
  if (!cursor || !end)
    return [{ value: currentMonthKey, label: formatMonthTitle(currentMonthKey) }];

  while (cursor <= end) {
    const value = formatMonthKey(cursor);
    options.push({ value, label: formatMonthTitle(value) });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return options;
}

function parseLocalMonth(monthKey: string) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return undefined;
  const parsed = new Date(`${monthKey}-01T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function formatMonthKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getMonthEndDate(monthKey: string) {
  const month = parseLocalMonth(monthKey);
  if (!month) return undefined;
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return formatLocalDate(end);
}

function filterMmgFilesByDivision(files: FileRecord[], activeDivision: string) {
  if (activeDivision === "all") return files;
  return files.filter((file) => file.division === activeDivision);
}

function filterFilesByReceivedDateRange(files: FileRecord[], range: ReportDateRange | undefined) {
  if (!range) return files;
  return files.filter((file) => isReportDateWithinRange(file.receivedDate, range));
}

function filterFilesForFirmPerformanceDateRange(
  files: FileRecord[],
  range: ReportDateRange | undefined,
) {
  if (!range) return files;
  return files
    .map((file) => ({
      ...file,
      supplyOrders: (file.supplyOrders ?? []).filter((order) =>
        isReportDateWithinRange(order.soDate, range),
      ),
    }))
    .filter((file) => (file.supplyOrders ?? []).length > 0);
}

function hasFirmPerformanceActivity(row: FirmDatabaseRow) {
  return (
    Number(row.numeric.totalSupplyOrders ?? 0) > 0 ||
    Number(row.numeric.cancelledSupplyOrders ?? 0) > 0
  );
}

function isReportDateWithinRange(date: string | undefined, range: ReportDateRange) {
  return hasFilledString(date) && date! >= range.fromDate && date! <= range.toDate;
}

function isPreviousFinancialYearFile(file: FileRecord, financialYear: string) {
  const selectedStart = readFinancialYearStart(financialYear);
  const fileStart = readFinancialYearStart(file.year ?? "");
  if (selectedStart === undefined || fileStart === undefined) return false;
  return fileStart < selectedStart;
}

function readFinancialYearStart(financialYear: string) {
  const match = financialYear.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function filterRowsByMonthRange(
  rows: ExpectedCashOutgoRow[],
  startMonthKey: string,
  endMonthKey: string,
) {
  return rows.filter((row) => row.monthKey >= startMonthKey && row.monthKey <= endMonthKey);
}

function getSoPaymentMatrixColumns(selectedFields: SoPaymentMatrixFieldKey[]) {
  const selected = new Set(selectedFields.length ? selectedFields : soPaymentMatrixDefaultFields);
  return soPaymentMatrixFieldOptions.filter((option) => selected.has(option.key));
}

function buildSoPaymentMatrixRows({
  files,
  monthKeys,
  paymentOffsetDays,
}: {
  files: FileRecord[];
  monthKeys: string[];
  paymentOffsetDays: number;
}): SoPaymentMatrixRow[] {
  const allowedMonths = new Set(monthKeys);
  const rows: SoPaymentMatrixRow[] = [];
  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
      filePaymentOrders(file).forEach((order, orderIndex) => {
      if (isSupplyOrderCancelled(file, order)) return;
      const row = createEmptySoPaymentMatrixRow(file, order, orderIndex);
      if (order.stageDeliveryLabel === "Advance Payment") {
        if (
          isShortclosureNoFurtherAction(order) ||
          hasOpenBillReturn(order) ||
          !areRequiredAdvanceGuaranteesReceived(file, order)
        ) return;
        const entry = getOrderPaymentMatrixEntry(file, order, orderIndex, paymentOffsetDays);
        if (entry && allowedMonths.has(entry.monthKey) && entry.amount > 0) {
          addSoPaymentMatrixAmount(row, entry.monthKey, entry.amount, entry.focusTarget, entry.basis);
        }
        if (row.total > 0) rows.push(row);
        return;
      }
      if (isYes(order.stagePayment) && order.stageDeliveries?.length) {
        order.stageDeliveries.forEach((stage, stageIndex) => {
          if (hasFilledString(stage.paymentDate)) return;
          if (isShortclosureNoFurtherAction(order)) return;
          const entry = getStagePaymentMatrixEntry(file, order, stage, stageIndex, paymentOffsetDays);
          if (!entry || !allowedMonths.has(entry.monthKey) || entry.amount <= 0) return;
          addSoPaymentMatrixAmount(row, entry.monthKey, entry.amount, entry.focusTarget, entry.basis);
        });
      } else if (!hasFilledString(order.paymentDate)) {
        if (isShortclosureNoFurtherAction(order)) return;
        const entry = getOrderPaymentMatrixEntry(file, order, orderIndex, paymentOffsetDays);
        if (entry && allowedMonths.has(entry.monthKey) && entry.amount > 0) {
          addSoPaymentMatrixAmount(row, entry.monthKey, entry.amount, entry.focusTarget, entry.basis);
        }
      }
      if (row.total > 0) rows.push(row);
    });
    rawSupplyOrders(file).forEach((order, orderIndex) => {
      if (isSupplyOrderCancelled(file, order)) return;
      getSupplementaryBills(order).forEach((bill, billIndex) => {
        if (
          isShortclosureNoFurtherAction(order) ||
          hasFilledString(bill.paymentDate) ||
          hasOpenSupplementaryBillReturn(bill)
        ) return;
        const submissionDate = getActiveSupplementaryBillSubmissionDate(bill);
        if (!hasFilledString(submissionDate)) return;
        const expectedDate = addDays(submissionDate, paymentOffsetDays);
        if (!expectedDate) return;
        const monthKey = expectedDate.slice(0, 7);
        if (!allowedMonths.has(monthKey)) return;
        const capital = getInrAmount(bill.billAmountCapital, file) ?? 0;
        const revenue = getInrAmount(bill.billAmountRevenue, file) ?? 0;
        if (capital + revenue <= 0) return;
        const row = createEmptySoPaymentMatrixRow(file, order, orderIndex);
        row.rowKey = `${row.rowKey}:supplementary:${bill.id || bill.billNo || billIndex}`;
        row.paymentItem = `Supplementary bill${bill.billNo ? ` ${bill.billNo}` : ` ${billIndex + 1}`}`;
        addSoPaymentMatrixAmount(
          row,
          monthKey,
          Math.round(capital + revenue),
          `supplementarybill:submitted:${orderIndex}:${billIndex}`,
          "Supplementary bill submitted",
        );
        rows.push(row);
      });
    });
  });
  return sortSoPaymentMatrixRows(rows);
}

function buildPaymentCompletedMatrixRows({
  files,
  monthKeys,
}: {
  files: FileRecord[];
  monthKeys: string[];
}): SoPaymentMatrixRow[] {
  const allowedMonths = new Set(monthKeys);
  const rows: SoPaymentMatrixRow[] = [];
  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
    filePaymentOrders(file).forEach((order, orderIndex) => {
      if (!isPaymentOrderActive(file, order)) return;
      const row = createEmptySoPaymentMatrixRow(file, order, orderIndex);
      if (order.stageDeliveryLabel === "Advance Payment") {
        const entry = getCompletedOrderPaymentMatrixEntry(file, order, orderIndex);
        if (entry && allowedMonths.has(entry.monthKey) && entry.amount > 0) {
          addSoPaymentMatrixAmount(
            row,
            entry.monthKey,
            entry.amount,
            `advancepayment:paid:${orderIndex}`,
            "Advance payment paid",
          );
        }
      } else if (isYes(order.stagePayment) && order.stageDeliveries?.length) {
        order.stageDeliveries.forEach((stage, stageIndex) => {
          const entry = getCompletedStagePaymentMatrixEntry(file, stage, stageIndex);
          if (!entry || !allowedMonths.has(entry.monthKey) || entry.amount <= 0) return;
          addSoPaymentMatrixAmount(row, entry.monthKey, entry.amount, entry.focusTarget, entry.basis);
        });
      } else {
        const entry = getCompletedOrderPaymentMatrixEntry(file, order, orderIndex);
        if (entry && allowedMonths.has(entry.monthKey) && entry.amount > 0) {
          addSoPaymentMatrixAmount(row, entry.monthKey, entry.amount, entry.focusTarget, entry.basis);
        }
      }
      if (row.total > 0) rows.push(row);
    });
    rawSupplyOrders(file).forEach((order, orderIndex) => {
      if (isSupplyOrderCancelled(file, order)) return;
      getSupplementaryBills(order).forEach((bill, billIndex) => {
        if (!hasFilledString(bill.paymentDate)) return;
        const monthKey = bill.paymentDate!.slice(0, 7);
        if (!allowedMonths.has(monthKey)) return;
        const capital =
          getInrAmount(bill.actualPaymentCapital || bill.billAmountCapital, file) ?? 0;
        const revenue =
          getInrAmount(bill.actualPaymentRevenue || bill.billAmountRevenue, file) ?? 0;
        if (capital + revenue <= 0) return;
        const row = createEmptySoPaymentMatrixRow(file, order, orderIndex);
        row.rowKey = `${row.rowKey}:supplementary:${bill.id || bill.billNo || billIndex}`;
        row.paymentItem = `Supplementary bill${bill.billNo ? ` ${bill.billNo}` : ` ${billIndex + 1}`}`;
        addSoPaymentMatrixAmount(
          row,
          monthKey,
          Math.round(capital + revenue),
          `supplementarybill:paid:${orderIndex}:${billIndex}`,
          "Supplementary bill paid",
        );
        rows.push(row);
      });
    });
  });
  return sortSoPaymentMatrixRows(rows);
}

function sortSoPaymentMatrixRows(rows: SoPaymentMatrixRow[]) {
  return rows.sort(
    (a, b) =>
      (a.file.division ?? "").localeCompare(b.file.division ?? "") ||
      getSoPaymentMatrixFieldValue(a, "fileUniqueNo").localeCompare(
        getSoPaymentMatrixFieldValue(b, "fileUniqueNo"),
      ) ||
      getSoPaymentMatrixFieldValue(a, "soDate").localeCompare(
        getSoPaymentMatrixFieldValue(b, "soDate"),
      ),
  );
}

function createEmptySoPaymentMatrixRow(
  file: FileRecord,
  order: SupplyOrderDetail,
  orderIndex: number,
): SoPaymentMatrixRow {
  const soRef = getSupplyOrderRef(order) || `S.O. ${orderIndex + 1}`;
  return {
    rowKey: `${file.id}:${orderIndex}:${soRef}`,
    fileId: file.id,
    file,
    order,
    orderIndex,
    paymentBasis: "",
    paymentItem: order.stageDeliveryLabel || "S.O. payment",
    monthAmounts: {},
    monthFocusTargets: {},
    total: 0,
  };
}

function addSoPaymentMatrixAmount(
  row: SoPaymentMatrixRow,
  monthKey: string,
  amount: number,
  focusTarget: string,
  basis: string,
) {
  row.monthAmounts[monthKey] = (row.monthAmounts[monthKey] ?? 0) + amount;
  row.monthFocusTargets[monthKey] = row.monthFocusTargets[monthKey] ?? focusTarget;
  row.total += amount;
  if (!row.paymentBasis) {
    row.paymentBasis = basis;
  } else if (!row.paymentBasis.split(" + ").includes(basis)) {
    row.paymentBasis = `${row.paymentBasis} + ${basis}`;
  }
}

function getStagePaymentMatrixEntry(
  file: FileRecord,
  order: SupplyOrderDetail,
  stage: StageDeliveryDetail,
  stageIndex: number,
  paymentOffsetDays: number,
) {
  const dateInfo = getExpectedPaymentDateInfo(file, stage, paymentOffsetDays);
  if (!dateInfo.date) return undefined;
  const capital = getInrAmount(stage.stageAmountCapital, file) ?? 0;
  const revenue = getInrAmount(stage.stageAmountRevenue, file) ?? 0;
  return {
    monthKey: dateInfo.date.slice(0, 7),
    amount: Math.round(capital + revenue),
    basis: `Stage payment - ${dateInfo.basis}`,
    focusTarget: `stagepayment:pending:${stageIndex}`,
  };
}

function getOrderPaymentMatrixEntry(
  file: FileRecord,
  order: SupplyOrderDetail,
  orderIndex: number,
  paymentOffsetDays: number,
) {
  if (order.stageDeliveryLabel === "Advance Payment") {
    const date = order.advancePaymentDetail?.expectedPaymentDate;
    if (!hasFilledString(date)) return undefined;
    const capital = getInrAmount(order.advancePaymentDetail?.stageAmountCapital, file) ?? 0;
    const revenue = getInrAmount(order.advancePaymentDetail?.stageAmountRevenue, file) ?? 0;
    return {
      monthKey: date!.slice(0, 7),
      amount: Math.round(capital + revenue),
      basis: "Expected Advance Payment Date",
      focusTarget: `advancepayment:pending:${orderIndex}`,
    };
  }
  const dateInfo = getExpectedPaymentDateInfo(file, order, paymentOffsetDays);
  if (!dateInfo.date) return undefined;
  const capital = getInrAmount(getPlannedCashOutgoCapital(order), file) ?? 0;
  const revenue = getInrAmount(getPlannedCashOutgoRevenue(order), file) ?? 0;
  return {
    monthKey: dateInfo.date.slice(0, 7),
    amount: Math.round(capital + revenue),
    basis: dateInfo.basis,
    focusTarget: `payment:pending:${orderIndex}`,
  };
}

function getCompletedStagePaymentMatrixEntry(
  file: FileRecord,
  stage: StageDeliveryDetail,
  stageIndex: number,
) {
  if (!hasFilledString(stage.paymentDate)) return undefined;
  const capital = getInrAmount(stage.actualPaymentCapital || stage.stageAmountCapital, file) ?? 0;
  const revenue = getInrAmount(stage.actualPaymentRevenue || stage.stageAmountRevenue, file) ?? 0;
  return {
    monthKey: stage.paymentDate!.slice(0, 7),
    amount: Math.round(capital + revenue),
    basis: "Completed stage payment",
    focusTarget: `stagepayment:completed:${stageIndex}`,
  };
}

function getCompletedOrderPaymentMatrixEntry(
  file: FileRecord,
  order: SupplyOrderDetail,
  orderIndex: number,
) {
  if (!hasFilledString(order.paymentDate)) return undefined;
  const capital = getInrAmount(getActualPaymentCapital(order) || getPlannedCashOutgoCapital(order), file) ?? 0;
  const revenue = getInrAmount(getActualPaymentRevenue(order) || getPlannedCashOutgoRevenue(order), file) ?? 0;
  return {
    monthKey: order.paymentDate!.slice(0, 7),
    amount: Math.round(capital + revenue),
    basis: "Completed payment",
    focusTarget: `payment:completed:${orderIndex}`,
  };
}

function getExpectedPaymentDateInfo(
  file: FileRecord,
  row: SupplyOrderDetail | StageDeliveryDetail,
  paymentOffsetDays: number,
) {
  if (hasFilledString(row.billSentForPaymentDate)) {
    return {
      date: addDays(row.billSentForPaymentDate, paymentOffsetDays),
      basis: "Bill sent",
    };
  }
  if (hasFilledString(row.billPreparationDate)) {
    return {
      date: addDays(row.billPreparationDate, paymentOffsetDays),
      basis: "Bill prepared",
    };
  }
  const receiptDate =
    "materialReceiptDate" in row && isDeliveryInspectionApplicable(file)
      ? row.materialReceiptDate
      : getNonInspectionPaymentDueDate(file, row as SupplyOrderDetail);
  if (hasFilledString(receiptDate)) {
    return {
      date: addDays(receiptDate, paymentOffsetDays),
      basis: isDeliveryInspectionApplicable(file) ? "Material receipt" : "Job completion",
    };
  }
  const dpDate = getDeliveryPeriodDate(row as SupplyOrderDetail);
  if (hasFilledString(dpDate)) {
    return {
      date: addDays(dpDate, paymentOffsetDays + 1),
      basis: "D.P.",
    };
  }
  return { date: undefined, basis: "No expected date" };
}

function getSoPaymentMatrixFieldValue(row: SoPaymentMatrixRow, fieldKey: SoPaymentMatrixFieldKey) {
  const file = row.file;
  const order = row.order;
  if (fieldKey === "fileUniqueNo") return getPreSoFileRef(file);
  if (fieldKey === "demandDescription") return file.demandDescription || "-";
  if (fieldKey === "soNo") return getSupplyOrderRef(order) || "-";
  if (fieldKey === "paymentItem") return row.paymentItem || "S.O. payment";
  if (fieldKey === "soDate") return formatDateDisplay(order.soDate ?? "");
  if (fieldKey === "firmName") return order.firm || "-";
  if (fieldKey === "division") return file.division || "-";
  if (fieldKey === "fileCategory") return isContractFileType(file) ? "Contract" : "Goods & Services";
  if (fieldKey === "fileType") return file.fileType || "-";
  if (fieldKey === "indentor") return file.indentor || "-";
  if (fieldKey === "mode") return file.mode || "-";
  if (fieldKey === "firmType") return order.firmType || "-";
  if (fieldKey === "demandInitiationYear") return file.year || "-";
  if (fieldKey === "demandValue") {
    const capital = getInrAmount(file.valueCapital, file) ?? 0;
    const revenue = getInrAmount(file.valueRevenue, file) ?? 0;
    return formatCurrency(capital + revenue);
  }
  if (fieldKey === "capitalValue") return formatCurrency(getInrAmount(file.valueCapital, file) ?? 0);
  if (fieldKey === "revenueValue") return formatCurrency(getInrAmount(file.valueRevenue, file) ?? 0);
  if (fieldKey === "soValue") {
    const capital = getInrAmount(order.soValueCapital, file) ?? 0;
    const revenue = getInrAmount(order.soValueRevenue, file) ?? 0;
    return formatCurrency(capital + revenue);
  }
  if (fieldKey === "paymentBasis") return row.paymentBasis || "-";
  return "-";
}

function getSoPaymentMatrixExportFieldValue(
  row: SoPaymentMatrixRow,
  fieldKey: SoPaymentMatrixFieldKey,
) {
  const file = row.file;
  const order = row.order;
  if (fieldKey === "demandValue") {
    return (getInrAmount(file.valueCapital, file) ?? 0) + (getInrAmount(file.valueRevenue, file) ?? 0);
  }
  if (fieldKey === "capitalValue") return getInrAmount(file.valueCapital, file) ?? 0;
  if (fieldKey === "revenueValue") return getInrAmount(file.valueRevenue, file) ?? 0;
  if (fieldKey === "soValue") {
    return (getInrAmount(order.soValueCapital, file) ?? 0) + (getInrAmount(order.soValueRevenue, file) ?? 0);
  }
  return getSoPaymentMatrixFieldValue(row, fieldKey);
}

function getSupplyOrderRef(order: SupplyOrderDetail) {
  return order.soNo || order.gemSoNo || "";
}

function formatSoPaymentMatrixMonthLabel(monthKey: string) {
  const month = parseLocalMonth(monthKey);
  if (!month) return monthKey;
  return month.toLocaleString("en-IN", { month: "short" });
}

function serializeSoPaymentMatrixFocusTargets(focusTargets: Map<string, string>) {
  const encoded = Array.from(focusTargets.entries())
    .map(([fileId, focusTarget]) => `${encodeURIComponent(fileId)}:${encodeURIComponent(focusTarget)}`)
    .join(",");
  return encoded || undefined;
}

function exportSoPaymentMatrixReport(
  rows: SoPaymentMatrixRow[],
  columns: SoPaymentMatrixColumnOption[],
  monthKeys: string[],
  title: string,
  description: string,
  format: "excel" | "pdf",
  plot?: ExportPlot,
) {
  const monthTotals = monthKeys.map((monthKey) =>
    rows.reduce((sum, row) => sum + (row.monthAmounts[monthKey] ?? 0), 0),
  );
  void downloadBackendExport({
    format,
    title,
    description: getReportExportDescription(description, "All the values are in Lakh."),
    plot,
    tables: [
      {
        headers: [
          ...columns.map((column) => column.label),
          ...monthKeys.map(formatSoPaymentMatrixMonthLabel),
          "Total",
        ],
        rows: rows.length
          ? [
              ...rows.map((row) => [
                ...columns.map((column) => getSoPaymentMatrixExportFieldValue(row, column.key)),
                ...monthKeys.map((monthKey) => {
                  const amount = row.monthAmounts[monthKey] ?? 0;
                  return amount ? formatSoPaymentMatrixAmount(amount) : "";
                }),
                formatSoPaymentMatrixAmount(row.total),
              ]),
              [
                ...columns.map((_, index) => (index === 0 ? "Total" : "")),
                ...monthTotals.map((amount) => (amount ? formatSoPaymentMatrixAmount(amount) : "")),
                formatSoPaymentMatrixAmount(rows.reduce((sum, row) => sum + row.total, 0)),
              ],
            ]
          : [["No S.O. payment rows found for the current filters."]],
      },
    ],
  });
}

function getMonthRangeForCashOutgoRows(rows: ExpectedCashOutgoRow[]) {
  const monthKeys = rows
    .map((row) => row.monthKey)
    .filter((monthKey) => /^\d{4}-\d{2}$/.test(monthKey))
    .sort();
  const firstMonth = monthKeys[0];
  const lastMonth = monthKeys[monthKeys.length - 1];
  if (!firstMonth || !lastMonth) return undefined;
  return {
    fromDate: `${firstMonth}-01`,
    toDate: getMonthEndDate(lastMonth),
  };
}

function combineCashOutgoRows(rows: ExpectedCashOutgoRow[]) {
  const totals = new Map<string, { capital: number; revenue: number }>();
  rows.forEach((row) => {
    const current = totals.get(row.monthKey) ?? { capital: 0, revenue: 0 };
    current.capital += row.capital;
    current.revenue += row.revenue;
    totals.set(row.monthKey, current);
  });
  return Array.from(totals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, totals]) => ({
      monthKey,
      month: formatMonthLabel(`${monthKey}-01`),
      capital: Math.round(totals.capital),
      revenue: Math.round(totals.revenue),
      total: Math.round(totals.capital + totals.revenue),
    }));
}

function combineRowsForMonth(monthKey: string, rowGroups: ExpectedCashOutgoRow[][]) {
  const totals = rowGroups
    .flatMap((rows) => rows.filter((row) => row.monthKey === monthKey))
    .reduce(
      (sum, row) => ({
        capital: sum.capital + row.capital,
        revenue: sum.revenue + row.revenue,
      }),
      { capital: 0, revenue: 0 },
    );
  return createSingleMonthRow(monthKey, totals);
}

function combineRowsAsSingleMonth(monthKey: string, rowGroups: ExpectedCashOutgoRow[][]) {
  const totals = rowGroups.flat().reduce(
    (sum, row) => ({
      capital: sum.capital + row.capital,
      revenue: sum.revenue + row.revenue,
    }),
    { capital: 0, revenue: 0 },
  );
  return createSingleMonthRow(monthKey, totals);
}

function combineRowsThroughMonthAsSingleMonth(
  monthKey: string,
  startMonthKey: string,
  rowGroups: ExpectedCashOutgoRow[][],
) {
  const totals = rowGroups
    .flatMap((rows) =>
      rows.filter((row) => row.monthKey >= startMonthKey && row.monthKey <= monthKey),
    )
    .reduce(
      (sum, row) => ({
        capital: sum.capital + row.capital,
        revenue: sum.revenue + row.revenue,
      }),
      { capital: 0, revenue: 0 },
    );
  return createSingleMonthRow(monthKey, totals);
}

function createSingleMonthRow(
  monthKey: string,
  totals: { capital: number; revenue: number },
): ExpectedCashOutgoRow[] {
  if (totals.capital === 0 && totals.revenue === 0) return [];
  return [
    {
      monthKey,
      month: formatMonthLabel(`${monthKey}-01`),
      capital: Math.round(totals.capital),
      revenue: Math.round(totals.revenue),
      total: Math.round(totals.capital + totals.revenue),
    },
  ];
}

function addCashOutgoTotal(
  totals: Map<string, ExpectedCashOutgoRow>,
  cashOutgoDate: string,
  file: FileRecord,
  order: SupplyOrderDetail,
  amountType: "planned" | "actual" = "planned",
) {
  const monthKey = cashOutgoDate.slice(0, 7);
  const current = totals.get(monthKey) ?? {
    monthKey,
    month: formatMonthLabel(cashOutgoDate),
    capital: 0,
    revenue: 0,
    total: 0,
  };
  const capital =
    getInrAmount(
      amountType === "actual" ? getActualPaymentCapital(order) : getPlannedCashOutgoCapital(order),
      file,
    ) ?? 0;
  const revenue =
    getInrAmount(
      amountType === "actual" ? getActualPaymentRevenue(order) : getPlannedCashOutgoRevenue(order),
      file,
    ) ?? 0;
  current.capital += capital;
  current.revenue += revenue;
  current.total += capital + revenue;
  totals.set(monthKey, current);
}

function addSupplementaryBillCashOutgoTotal(
  totals: Map<string, ExpectedCashOutgoRow>,
  cashOutgoDate: string,
  file: FileRecord,
  bill: SupplementaryBillDetail,
  amountType: "planned" | "actual" = "planned",
) {
  const monthKey = cashOutgoDate.slice(0, 7);
  const current = totals.get(monthKey) ?? {
    monthKey,
    month: formatMonthLabel(cashOutgoDate),
    capital: 0,
    revenue: 0,
    total: 0,
  };
  const capitalSource =
    amountType === "actual" && hasFilledString(bill.actualPaymentCapital)
      ? bill.actualPaymentCapital
      : bill.billAmountCapital;
  const revenueSource =
    amountType === "actual" && hasFilledString(bill.actualPaymentRevenue)
      ? bill.actualPaymentRevenue
      : bill.billAmountRevenue;
  const capital = getInrAmount(capitalSource, file) ?? 0;
  const revenue = getInrAmount(revenueSource, file) ?? 0;
  current.capital += capital;
  current.revenue += revenue;
  current.total += capital + revenue;
  totals.set(monthKey, current);
}

function getPlannedCashOutgoCapital(order: SupplyOrderDetail) {
  return hasFilledString(order.billAmountCapital) ? order.billAmountCapital : order.soValueCapital;
}

function getPlannedCashOutgoRevenue(order: SupplyOrderDetail) {
  return hasFilledString(order.billAmountRevenue) ? order.billAmountRevenue : order.soValueRevenue;
}

function getSupplementaryBills(order: SupplyOrderDetail): SupplementaryBillDetail[] {
  return Array.isArray(order.supplementaryBills)
    ? order.supplementaryBills.filter(
        (bill): bill is SupplementaryBillDetail => Boolean(bill) && typeof bill === "object",
      )
    : [];
}

function getActiveSupplementaryBillSubmissionDate(bill: SupplementaryBillDetail) {
  const latest = latestBillReturnCycle(bill.billReturnCycles);
  return latest?.resubmittedDate || bill.billSentForPaymentDate;
}

function hasOpenSupplementaryBillReturn(bill: SupplementaryBillDetail) {
  const latest = latestBillReturnCycle(bill.billReturnCycles);
  return Boolean(latest && !hasFilledString(latest.resubmittedDate));
}

function earliestDate(dates: Array<string | undefined>) {
  return dates.filter(hasFilledString).sort()[0];
}

function finalizeCashOutgoRows(totals: Map<string, ExpectedCashOutgoRow>) {
  return Array.from(totals.values())
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .map((row) => ({
      ...row,
      capital: Math.round(row.capital),
      revenue: Math.round(row.revenue),
      total: Math.round(row.total),
    }));
}

function getPendingLiabilityAgeingRows(files: FileRecord[], asOnDate: string) {
  const totals = new Map<string, AgeingAggregate>();
  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
    filePaymentOrders(file).forEach((order) => {
      if (!isPaymentOrderActive(file, order)) return;
      if (isShortclosureNoFurtherAction(order)) return;
      if (!isPaymentPendingAsOf(order, asOnDate)) return;
      if (
        order.stageDeliveryLabel === "Advance Payment" &&
        !areRequiredAdvanceGuaranteesReceived(file, order)
      ) return;
      const startDate = getPendingLiabilityStartDate(file, order);
      const days = getDaysBetween(startDate, asOnDate);
      if (days === undefined || days < 0) return;
      const bucket = getAgeingBucket(days);
      if (!bucket) return;
      addAgeingAggregate(totals, bucket.key, bucket.label, file, {
        capital: getInrAmount(getPlannedCashOutgoCapital(order), file) ?? 0,
        revenue: getInrAmount(getPlannedCashOutgoRevenue(order), file) ?? 0,
        focusTarget: getPendingLiabilityFocusTarget(order),
      });
    });

    filePaymentOrders(file).forEach((order) => {
      if (!isPaymentOrderActive(file, order)) return;
      if (isShortclosureNoFurtherAction(order)) return;
      getSupplementaryBills(order).forEach((bill) => {
        if (!isSupplementaryBillPaymentPendingAsOf(bill, asOnDate)) return;
        const startDate = getSupplementaryPendingLiabilityStartDate(bill);
        const days = getDaysBetween(startDate, asOnDate);
        if (days === undefined || days < 0) return;
        const bucket = getAgeingBucket(days);
        if (!bucket) return;
        addAgeingAggregate(totals, bucket.key, bucket.label, file, {
          capital: getInrAmount(bill.billAmountCapital, file) ?? 0,
          revenue: getInrAmount(bill.billAmountRevenue, file) ?? 0,
          focusTarget: hasOpenSupplementaryBillReturn(bill)
            ? "supplementarybill:returned"
            : "supplementarybill:submitted",
        });
      });
    });
  });
  return finalizeAgeingRows(totals);
}

type AgeingAggregate = {
  key: string;
  bucket: string;
  bucketKey: string;
  count: number;
  capital: number;
  revenue: number;
  fileIds: Set<string>;
  focusTargets: Map<string, string>;
};

function addAgeingAggregate(
  totals: Map<string, AgeingAggregate>,
  key: string,
  bucket: string,
  file: FileRecord,
  entry: { capital: number; revenue: number; focusTarget?: string },
) {
  const current = totals.get(key) ?? {
    key,
    bucket,
    bucketKey: key.includes(":") ? (key.split(":").at(-1) ?? key) : key,
    count: 0,
    capital: 0,
    revenue: 0,
    fileIds: new Set<string>(),
    focusTargets: new Map<string, string>(),
  };
  current.count += 1;
  current.capital += entry.capital;
  current.revenue += entry.revenue;
  current.fileIds.add(file.id);
  if (entry.focusTarget) {
    const existingTarget = current.focusTargets.get(file.id);
    if (
      !existingTarget ||
      getPendingLiabilityFocusPriority(entry.focusTarget) >
        getPendingLiabilityFocusPriority(existingTarget)
    ) {
      current.focusTargets.set(file.id, entry.focusTarget);
    }
  }
  totals.set(key, current);
}

function finalizeAgeingRows(totals: Map<string, AgeingAggregate>) {
  return Array.from(totals.values())
    .sort((a, b) => getAgeingBucketSort(a.bucketKey) - getAgeingBucketSort(b.bucketKey))
    .map((row) => {
      const capital = Math.round(row.capital);
      const revenue = Math.round(row.revenue);
      return {
        monthKey: row.key,
        bucket: row.bucket,
        bucketKey: row.bucketKey,
        count: row.count,
        capital,
        revenue,
        total: capital + revenue,
        fileIds: Array.from(row.fileIds).join(","),
        focusTargets: serializeAgeingFocusTargets(row.focusTargets),
        dashboardFilter: `ageing:${encodeURIComponent(row.key)}`,
      };
    });
}

function formatPendingLiabilityRowsForExport(
  rows: Array<Record<string, number | string>>,
) {
  return rows.map((row) => ({
    ...row,
    capital: formatLakhValue(Number(row.capital) || 0),
    revenue: formatLakhValue(Number(row.revenue) || 0),
    total: formatLakhValue(Number(row.total) || 0),
  }));
}

function serializeAgeingFocusTargets(focusTargets: Map<string, string>) {
  const encoded = Array.from(focusTargets.entries())
    .filter(([fileId, target]) => fileId && target)
    .map(([fileId, target]) => `${encodeURIComponent(fileId)}=${encodeURIComponent(target)}`)
    .join(",");
  return encoded;
}

function getPendingLiabilityFocusPriority(target: string) {
  if (target === "supplementarybill:returned") return 60;
  if (target === "billreturnedforcorrection:pending") return 50;
  if (target === "supplementarybill:submitted") return 40;
  if (target === "payment:pending") return 30;
  if (target === "billsentforpayment:pending") return 20;
  if (target === "billpreparation:pending") return 10;
  return 0;
}

function getPendingLiabilityFocusTarget(order: SupplyOrderDetail) {
  if (hasOpenBillReturn(order)) return "billreturnedforcorrection:pending";
  if (hasFilledString(order.billSentForPaymentDate)) return "payment:pending";
  if (hasFilledString(order.billPreparationDate)) return "billsentforpayment:pending";
  return "billpreparation:pending";
}

function getPendingLiabilityStartDate(file: FileRecord, order: SupplyOrderDetail) {
  if (order.stageDeliveryLabel === "Advance Payment") {
    return order.advancePaymentDetail?.expectedPaymentDate;
  }
  if (hasFilledString(order.billSentForPaymentDate)) return order.billSentForPaymentDate;
  if (hasFilledString(order.billPreparationDate)) return order.billPreparationDate;
  return getLiabilityTriggerDate(file, order);
}

function getLiabilityTriggerDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  return getNonInspectionPaymentDueDate(file, order);
}

function isPaymentPendingAsOf(order: SupplyOrderDetail, asOnDate: string) {
  return !hasFilledString(order.paymentDate) || order.paymentDate! > asOnDate;
}

function isSupplementaryBillPaymentPendingAsOf(bill: SupplementaryBillDetail, asOnDate: string) {
  return !hasFilledString(bill.paymentDate) || bill.paymentDate! > asOnDate;
}

function getSupplementaryPendingLiabilityStartDate(bill: SupplementaryBillDetail) {
  const latest = latestBillReturnCycle(bill.billReturnCycles);
  return latest?.resubmittedDate ?? latest?.returnedDate ?? bill.billSentForPaymentDate;
}

function getAgeingBucket(days: number) {
  return ageingBuckets.find((bucket) => days >= bucket.min && days <= bucket.max);
}

function getAgeingBucketSort(key: string) {
  const index = ageingBuckets.findIndex((bucket) => bucket.key === key);
  return index === -1 ? ageingBuckets.length : index;
}

function getDaysBetween(fromDate: string | undefined, toDate: string | undefined) {
  const fromTime = parseLocalDateTime(fromDate ?? "");
  const toTime = parseLocalDateTime(toDate ?? "");
  if (fromTime === undefined || toTime === undefined) return undefined;
  return Math.floor((toTime - fromTime) / 86_400_000);
}

function getDelayStatusRows(
  files: FileRecord[],
  thresholdDays: number,
  milestoneKey: string,
): DelayStatusRow[] {
  return files
    .flatMap((file) => getCurrentMilestoneDelayRows(file, thresholdDays, milestoneKey))
    .filter((row): row is DelayStatusRow => Boolean(row))
    .sort((a, b) => b.daysInStage - a.daysInStage || a.milestone.localeCompare(b.milestone));
}

function getCurrentMilestoneDelayRows(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
) {
  return [
    getWorkflowNotStartedDelay(file, thresholdDays, selectedMilestoneKey),
    getBiddingDelay(file, thresholdDays, selectedMilestoneKey),
    getCurrentMilestoneDelay(file, thresholdDays, selectedMilestoneKey),
    ...getCurrentOrderMilestoneDelayRows(file, thresholdDays, selectedMilestoneKey),
    ...getReturnedBillDelayRows(file, thresholdDays, selectedMilestoneKey),
    ...getSupplementaryReturnedBillDelayRows(file, thresholdDays, selectedMilestoneKey),
  ];
}

function getBiddingDelay(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
): DelayStatusRow | undefined {
  if (selectedMilestoneKey !== "all" && selectedMilestoneKey !== biddingDelayMilestoneKey) {
    return undefined;
  }
  const status = getBiddingDelayStatus(file);
  if (!status) return undefined;
  const daysInStage = getDaysSinceDate(status.stageStartDate);
  if (daysInStage === undefined || daysInStage <= thresholdDays) return undefined;
  return {
    fileId: file.id,
    fileRef: file.imms ?? "",
    division: file.division ?? "",
    indentor: file.indentor ?? "",
    description: file.demandDescription ?? "",
    milestoneKey: biddingDelayMilestoneKey,
    milestone: biddingDelayMilestoneLabel,
    stageStartDate: status.stageStartDate ?? "",
    daysInStage,
    lastFilledDate: getLastFilledDateValue(file) ?? "",
    focusSection: "Bidding details",
    focusTarget: status.focusTarget,
    biddingBreakupKey: status.key,
  };
}

function getBiddingDelayStatus(file: FileRecord) {
  if (isCancelledFile(file) || isFileClosed(file)) return undefined;
  if (!isBiddingApplicableForFile(file)) return undefined;
  if (!hasFilledString(file.cfaDate) || isYes(file.biddingStageOver)) return undefined;
  const bidDate = isYes(file.refloat) ? file.refloatBiddingDate : file.bidDate;
  const bidOpeningDate = isYes(file.refloat) ? file.refloatBidOpeningDate : file.bidOpeningDate;
  const prerequisiteDoneDate =
    latestDateValue([file.cfaDate, file.gemUndertakingDate, file.rfpVettingApprovalDate]) ??
    file.cfaDate;
  if (isYes(file.gem) && !hasFilledString(file.gemUndertakingDate)) {
    return {
      key: "gemUndertakingPending",
      label: "GeM undertaking pending",
      stageStartDate: file.cfaDate,
      focusTarget: "gemUndertakingDate",
    };
  }
  const rfpStartDate = isYes(file.gem) ? file.gemUndertakingDate || file.cfaDate : file.cfaDate;
  if (isYes(file.rfpVetting) && !hasFilledString(file.rfpVettingInitiationDate)) {
    return {
      key: "rfpVettingInitiationPending",
      label: "RFP vetting initiation pending",
      stageStartDate: rfpStartDate,
      focusTarget: "rfpVettingInitiationDate",
    };
  }
  if (
    isYes(file.rfpVetting) &&
    hasFilledString(file.rfpVettingInitiationDate) &&
    !hasFilledString(file.rfpVettingApprovalDate)
  ) {
    return {
      key: "rfpVettingApprovalPending",
      label: "RFP vetting approval pending",
      stageStartDate: file.rfpVettingInitiationDate,
      focusTarget: "rfpVettingApprovalDate",
    };
  }
  if (!isYes(file.tenderLive) && !hasFilledString(bidDate)) {
    return {
      key: "tenderLivePending",
      label: "Tender live pending",
      stageStartDate: prerequisiteDoneDate,
      focusTarget: "tenderLive",
    };
  }
  if (
    hasFilledString(bidOpeningDate) &&
    isDateBeforeToday(bidOpeningDate) &&
    !isYes(file.bidOpened)
  ) {
    return {
      key: "bidOpeningOverdue",
      label: "Bid opening overdue",
      stageStartDate: bidOpeningDate,
      focusTarget: isYes(file.refloat) ? "refloatBidOpeningDate" : "bidOpeningDate",
    };
  }
  if (isYes(file.bidOpened)) {
    return {
      key: "biddingStageCompletionPending",
      label: "Bidding stage completion pending",
      stageStartDate: bidOpeningDate || bidDate || prerequisiteDoneDate,
      focusTarget: "biddingStageOver",
    };
  }
  return undefined;
}

function getWorkflowNotStartedDelay(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
) {
  if (selectedMilestoneKey !== "all" && selectedMilestoneKey !== "workflowNotStarted") {
    return undefined;
  }
  if (!isWorkflowNotStartedFile(file)) return undefined;
  const stageStartDate = file.receivedDate || file.createdAt?.slice(0, 10);
  const daysInStage = getDaysSinceDate(stageStartDate);
  if (daysInStage === undefined || daysInStage <= thresholdDays) return undefined;
  return {
    fileId: file.id,
    fileRef: file.imms ?? "",
    division: file.division ?? "",
    indentor: file.indentor ?? "",
    description: file.demandDescription ?? "",
    milestoneKey: "workflowNotStarted",
    milestone: "Workflow Not Started",
    stageStartDate,
    daysInStage,
    lastFilledDate: getLastFilledDateValue(file) ?? "",
    focusSection: "Timeline",
  };
}

function getCurrentMilestoneDelay(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
) {
  const milestone = getActiveDelayMilestone(file);
  if (!milestone) return undefined;
  if (milestone.key === biddingDelayMilestoneKey) return undefined;
  if (selectedMilestoneKey !== "all" && milestone.key !== selectedMilestoneKey) return undefined;
  if (isMilestoneComplete(file, milestone)) return undefined;

  const stageStartDate = getMilestoneStageStartDate(file, milestone);
  const daysInStage = getDaysSinceDate(stageStartDate);
  if (daysInStage === undefined || daysInStage <= thresholdDays) return undefined;

  return {
    fileId: file.id,
    fileRef: file.imms ?? "",
    division: file.division ?? "",
    indentor: file.indentor ?? "",
    description: file.demandDescription ?? "",
    milestoneKey: milestone.key,
    milestone: milestone.label,
    stageStartDate,
    daysInStage,
    lastFilledDate: getLastFilledDateValue(file) ?? "",
    focusSection: "Milestones",
  };
}

function getActiveDelayMilestone(file: FileRecord) {
  return milestoneDefinitions.find((milestone) => isManualActiveMilestone(file, milestone));
}

function isWorkflowNotStartedFile(file: FileRecord) {
  if (isCancelledFile(file) || isFileClosed(file)) return false;
  if (hasFilledString(file.currentMilestone)) return false;
  if ((file.completedMilestones ?? []).length > 0) return false;
  const workflowDateKeys: Array<keyof FileRecord> = [
    "scrutinyDate",
    "scrutinyResponseDate",
    "scrutinyCompletionDate",
    "immsDate",
    "highValueMeetingDate",
    "highValueMinutesDate",
    "adSentDate",
    "preTcecDate",
    "preTcecMinutesDate",
    "adVettingDate",
    "rqaSentDate",
    "rqaApprovalDate",
    "ifaSentDate",
    "ifaFinalDate",
    "cfaSentDate",
    "cfaDate",
    "gemUndertakingDate",
    "rfpVettingInitiationDate",
    "rfpVettingApprovalDate",
    "preBidMeetingDate",
    "bidDate",
    "bidOpeningDate",
    "refloatPreBidMeetingDate",
    "refloatBiddingDate",
    "refloatBidOpeningDate",
    "postTcecDate",
    "postTcecMinutesDate",
    "refloatPostTcecDate",
    "refloatPostTcecMinutesDate",
    "cncDate",
    "cncApprovalDate",
  ];
  if (workflowDateKeys.some((key) => hasFilledString(String(file[key] ?? "")))) return false;
  return !rawSupplyOrders(file).some((order) => hasMeaningfulSupplyOrderWorkflowData(order));
}

function hasMeaningfulSupplyOrderWorkflowData(order: SupplyOrderDetail) {
  return [
    order.financialSanctionDate,
    order.soDate,
    order.dpDate,
    order.materialReceiptDate,
    order.jobCompletionDate,
    order.irPreparationDate,
    order.irReceiptDate,
    order.billPreparationDate,
    order.billSentForPaymentDate,
    order.paymentDate,
  ].some(hasFilledString);
}

const orderDelayMilestones = [
  {
    key: "financialSanction",
    label: "Financial Sanction",
    current: "financialsanction",
    start: (file: FileRecord) => getMainTimelineLastFilledDateValue(file),
    complete: (order: SupplyOrderDetail) => order.financialSanctionDate,
  },
  {
    key: "supplyOrder",
    label: "Supply Order",
    current: "supplyorder",
    start: (file: FileRecord, order: SupplyOrderDetail) =>
      order.financialSanctionDate || getMainTimelineLastFilledDateValue(file),
    complete: (order: SupplyOrderDetail) => order.soDate,
  },
  {
    key: "advancePayment",
    label: "Advance Payment",
    current: "advancepayment",
    start: (_file: FileRecord, order: SupplyOrderDetail) => order.soDate,
    complete: (order: SupplyOrderDetail) =>
      isAdvancePaymentCompleted(order) ? "9999-12-31" : undefined,
  },
  {
    key: "psb",
    label: "PSB",
    current: "psb",
    start: (_file: FileRecord, order: SupplyOrderDetail) => order.financialSanctionDate,
    complete: (order: SupplyOrderDetail) => order.psbBgReceivedDate,
  },
  {
    key: "pwb",
    label: "PWB",
    current: "pwb",
    start: (_file: FileRecord, order: SupplyOrderDetail) => order.materialReceiptDate,
    complete: (order: SupplyOrderDetail) => order.pwbBgReceivedDate,
  },
  {
    key: "psbPwb",
    label: "PSB+PWB",
    current: "psbpwb",
    start: (_file: FileRecord, order: SupplyOrderDetail) => order.financialSanctionDate,
    complete: (order: SupplyOrderDetail) => order.combinedBgReceivedDate,
  },
  {
    key: "delivery",
    label: "Delivery",
    current: "delivery",
    start: (_file: FileRecord, order: SupplyOrderDetail) => getDeliveryPeriodDate(order),
    complete: (order: SupplyOrderDetail) => order.materialReceiptDate,
    applies: (file: FileRecord) => isDeliveryInspectionApplicable(file),
  },
  {
    key: "jobCompletion",
    label: "Job Completion",
    current: "jobcompletion",
    start: (_file: FileRecord, order: SupplyOrderDetail) => getDeliveryPeriodDate(order),
    complete: (order: SupplyOrderDetail) => (isJobCompletionDone(order) ? "9999-12-31" : undefined),
    applies: (file: FileRecord) => isJobCompletionWorkflow(file),
  },
  {
    key: "irPreparation",
    label: "IR Preparation",
    current: "irpreparation",
    start: (_file: FileRecord, order: SupplyOrderDetail) => order.materialReceiptDate,
    complete: (order: SupplyOrderDetail) => order.irPreparationDate,
  },
  {
    key: "irReceipt",
    label: "IR Receipt",
    current: "irreceipt",
    start: (_file: FileRecord, order: SupplyOrderDetail) => order.irPreparationDate,
    complete: (order: SupplyOrderDetail) => order.irReceiptDate,
  },
  {
    key: "billPreparation",
    label: "Bill preparation",
    current: "billpreparation",
    start: (_file: FileRecord, order: SupplyOrderDetail) =>
      isDeliveryInspectionApplicable(_file) ? order.irReceiptDate : order.jobCompletionDate,
    complete: (order: SupplyOrderDetail) => order.billPreparationDate,
  },
  {
    key: "billSentForPayment",
    label: "Bill sent for payment",
    current: "billsentforpayment",
    start: (_file: FileRecord, order: SupplyOrderDetail) => order.billPreparationDate,
    complete: (order: SupplyOrderDetail) => order.billSentForPaymentDate,
  },
  {
    key: "payment",
    label: "Payment",
    current: "payment",
    start: (file: FileRecord, order: SupplyOrderDetail) =>
      getPaymentWorkflowStartDate(file, order) || order.billSentForPaymentDate,
    complete: (order: SupplyOrderDetail) => order.paymentDate,
  },
] as const;

function getCurrentOrderMilestoneDelayRows(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
): DelayStatusRow[] {
  if (isYes(file.demandCancelled)) return [];
  return orderDelayMilestones.flatMap((milestone) => {
    if (selectedMilestoneKey !== "all" && selectedMilestoneKey !== milestone.key) return [];
    const entries: Array<{
      order: SupplyOrderDetail;
      orderIndex: number;
      stageIndex?: number;
    }> =
      milestone.key === "financialSanction" || milestone.key === "advancePayment"
        ? milestone.key === "financialSanction"
          ? expectedSupplyOrders(file).map((order, orderIndex) => ({ order, orderIndex }))
          : rawSupplyOrders(file).map((order, orderIndex) => ({ order, orderIndex }))
        : normalizedFileSupplyOrderEntries(file);
    return entries.flatMap(({ order, orderIndex, stageIndex }) => {
      const normalizedCurrent = normalizeMilestoneName(milestone.current);
      if (!isOrderActiveForCurrentMilestone(file, order, normalizedCurrent)) return [];
      if ("applies" in milestone && milestone.applies && !milestone.applies(file)) return [];
      if (milestone.key === "advancePayment") {
        if (!isAdvancePaymentPending(order)) return [];
      } else if (!isOrderCurrentForMilestone(file, order, normalizedCurrent)) {
        return [];
      }
      if (hasDate(milestone.complete(order))) return [];
      const stageStartDate = milestone.start(file, order);
      const daysInStage = getDaysSinceDate(stageStartDate);
      if (daysInStage === undefined || daysInStage <= thresholdDays) return [];
      return [
        {
          fileId: file.id,
          fileRef: file.imms ?? "",
          division: file.division ?? "",
          indentor: file.indentor ?? "",
          description: file.demandDescription ?? "",
          milestoneKey: milestone.key,
          milestone: milestone.label,
          stageStartDate: stageStartDate ?? "",
          daysInStage,
          lastFilledDate: getLastFilledDateValue(file) ?? "",
          focusSection: "Supply order and payment",
          focusTarget: getDelayStatusFocusTarget(milestone.current, order, orderIndex, stageIndex),
        },
      ];
    });
  });
}

function getReturnedBillDelayRows(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
): DelayStatusRow[] {
  if (selectedMilestoneKey !== "all" && selectedMilestoneKey !== billReturnedDelayMilestoneKey) {
    return [];
  }
  if (isYes(file.demandCancelled)) return [];
  return normalizedFilePaymentEntries(file).flatMap(({ order, orderIndex, stageIndex }) => {
    if (!isPaymentOrderActive(file, order) || !hasOpenBillReturn(order)) return [];
    const stageStartDate = getEarliestOpenBillReturnDate(order);
    const daysInStage = getDaysSinceDate(stageStartDate);
    if (daysInStage === undefined || daysInStage <= thresholdDays) return [];
    return [
      {
        fileId: file.id,
        fileRef: file.imms ?? "",
        division: file.division ?? "",
        indentor: file.indentor ?? "",
        description: file.demandDescription ?? "",
        milestoneKey: billReturnedDelayMilestoneKey,
        milestone: "Returned Bills",
        stageStartDate: stageStartDate ?? "",
        daysInStage,
        lastFilledDate: getLastFilledDateValue(file) ?? "",
        focusSection: "Supply order and payment",
        focusTarget: getDelayStatusFocusTarget(
          "billreturnedforcorrection",
          order,
          orderIndex,
          stageIndex,
        ),
      },
    ];
  });
}

function getSupplementaryReturnedBillDelayRows(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
): DelayStatusRow[] {
  if (
    selectedMilestoneKey !== "all" &&
    selectedMilestoneKey !== supplementaryBillReturnedDelayMilestoneKey
  ) {
    return [];
  }
  if (isYes(file.demandCancelled)) return [];
  return rawSupplyOrders(file).flatMap((order, orderIndex) => {
    if (!isPaymentOrderActive(file, order)) return [];
    return getSupplementaryBills(order).flatMap((bill, billIndex) => {
      if (!hasOpenSupplementaryBillReturn(bill) || hasFilledString(bill.paymentDate)) return [];
      const stageStartDate = getEarliestOpenSupplementaryBillReturnDate(bill);
      const daysInStage = getDaysSinceDate(stageStartDate);
      if (daysInStage === undefined || daysInStage <= thresholdDays) return [];
      return [
        {
          fileId: file.id,
          fileRef: file.imms ?? "",
          division: file.division ?? "",
          indentor: file.indentor ?? "",
        description: file.demandDescription ?? "",
          milestoneKey: supplementaryBillReturnedDelayMilestoneKey,
          milestone: "Supplementary bill returned for correction",
          stageStartDate: stageStartDate ?? "",
          daysInStage,
          lastFilledDate: getLastFilledDateValue(file) ?? "",
          focusSection: "Supply order and payment",
          focusTarget: `supplementarybill:returned:${orderIndex}:${billIndex}`,
        },
      ];
    });
  });
}

function getDelayStatusFocusTarget(
  milestone: string,
  order: SupplyOrderDetail,
  orderIndex: number,
  stageIndex: number | undefined,
) {
  const normalizedMilestone = normalizeMilestoneName(milestone);
  const stagePaymentMilestones = new Set([
    "billpreparation",
    "billsentforpayment",
    "billreturnedforcorrection",
    "payment",
  ]);
  const shouldFocusStage =
    stageIndex !== undefined &&
    (!stagePaymentMilestones.has(normalizedMilestone) || isYes(order.stagePayment));
  return `${milestone}:pending:${orderIndex}${shouldFocusStage ? `:${stageIndex}` : ""}`;
}

function getSupplyOrderDelayReference(file: FileRecord, order: SupplyOrderDetail, index: number) {
  const orderRef = order.soNo || order.gemSoNo || `S.O. ${index + 1}`;
  return `${getFileReference(file)} / ${orderRef}`;
}

function getEarliestOpenBillReturnDate(order: SupplyOrderDetail) {
  const latest = latestBillReturnCycle(order.billReturnCycles);
  return latest && !hasFilledString(latest.resubmittedDate) ? latest.returnedDate : undefined;
}

function getEarliestOpenSupplementaryBillReturnDate(bill: SupplementaryBillDetail) {
  const latest = latestBillReturnCycle(bill.billReturnCycles);
  return latest && !hasFilledString(latest.resubmittedDate) ? latest.returnedDate : undefined;
}

function getSupplyOrderStageStartDate(file: FileRecord) {
  const supplyOrderMilestone = milestoneDefinitions.find(
    (milestone) => milestone.key === "supplyOrder",
  );
  return supplyOrderMilestone ? getMilestoneStageStartDate(file, supplyOrderMilestone) : undefined;
}

function getMilestoneStageStartDate(file: FileRecord, milestone: MilestoneDefinition) {
  void milestone;
  return getLastFilledDateValue(file);
}

function getPreviousApplicableMilestone(file: FileRecord, milestone: MilestoneDefinition) {
  const targetIndex = milestoneDefinitions.findIndex((item) => item.key === milestone.key);
  if (targetIndex <= 0) return undefined;
  if (isFlexiblePreControlMilestone(milestone)) {
    return milestoneDefinitions.find((item) => item.key === "scrutiny");
  }
  const controlIndex = milestoneDefinitions.findIndex((item) => item.key === "control");
  const previous = milestoneDefinitions.slice(0, targetIndex).filter((item) => {
    if (!isMilestoneApplicable(file, item)) return false;
    if (controlIndex >= 0 && targetIndex >= controlIndex) return true;
    return item.key === "scrutiny";
  });
  return previous[previous.length - 1];
}

function getFieldDateValue(file: FileRecord, key: keyof FileRecord | keyof SupplyOrderDetail) {
  if (supplyOrderDateKeys.has(key as keyof SupplyOrderDetail)) {
    return getEarliestSupplyOrderDate(file, key as keyof SupplyOrderDetail);
  }
  const value = file[key as keyof FileRecord];
  return typeof value === "string" && hasDate(value) ? value : undefined;
}

function getEarliestSupplyOrderDate(file: FileRecord, key: keyof SupplyOrderDetail) {
  return fileSupplyOrders(file)
    .map((order) => String(order[key] ?? ""))
    .filter(hasDate)
    .sort((a, b) => a.localeCompare(b))[0];
}

function getDaysSinceDate(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));
  if (dateTime === undefined || todayTime === undefined) return undefined;
  return Math.floor((todayTime - dateTime) / 86_400_000);
}

function latestDateValue(values: Array<string | undefined>) {
  return values
    .filter((value): value is string => hasFilledString(value))
    .sort((a, b) => (parseLocalDateTime(b) ?? 0) - (parseLocalDateTime(a) ?? 0))[0];
}

function getMainTimelineLastFilledDateValue(file: FileRecord) {
  return [
    file.receivedDate,
    file.scrutinyDate,
    file.scrutinyResponseDate,
    file.scrutinyCompletionDate,
    file.immsDate,
    file.highValueMeetingDate,
    file.highValueMinutesDate,
    file.adSentDate,
    file.preTcecDate,
    file.preTcecMinutesDate,
    file.adVettingDate,
    file.rqaSentDate,
    file.rqaApprovalDate,
    file.ifaSentDate,
    file.ifaFinalDate,
    file.cfaSentDate,
    file.cfaDate,
    file.gemUndertakingDate,
    file.rfpVettingInitiationDate,
    file.rfpVettingApprovalDate,
    file.bidDate,
    file.bidOpeningDate,
    file.refloatBiddingDate,
    file.refloatBidOpeningDate,
    file.postTcecDate,
    file.postTcecMinutesDate,
    file.refloatPostTcecDate,
    file.refloatPostTcecMinutesDate,
    file.cncDate,
    file.cncApprovalDate,
  ]
    .filter((value): value is string => hasDate(value))
    .sort((a, b) => b.localeCompare(a))[0];
}

function getLastFilledDateValue(file: FileRecord) {
  return [
    file.receivedDate,
    file.scrutinyDate,
    file.scrutinyResponseDate,
    file.scrutinyCompletionDate,
    file.immsDate,
    file.highValueMeetingDate,
    file.highValueMinutesDate,
    file.adSentDate,
    file.preTcecDate,
    file.preTcecMinutesDate,
    file.adVettingDate,
    file.rqaSentDate,
    file.rqaApprovalDate,
    file.ifaSentDate,
    file.ifaFinalDate,
    file.cfaSentDate,
    file.cfaDate,
    file.gemUndertakingDate,
    file.rfpVettingInitiationDate,
    file.rfpVettingApprovalDate,
    file.bidDate,
    file.bidOpeningDate,
    file.refloatBiddingDate,
    file.refloatBidOpeningDate,
    file.postTcecDate,
    file.postTcecMinutesDate,
    file.refloatPostTcecDate,
    file.refloatPostTcecMinutesDate,
    file.cncDate,
    file.cncApprovalDate,
    ...fileSupplyOrders(file).flatMap((order) => [
      order.financialSanctionDate,
      order.soDate,
      order.dpDate,
      order.psbBgReceivedDate,
      order.psbBgValidityDate,
      order.psbBgReturnDate,
      order.pwbBgReceivedDate,
      order.pwbBgValidityDate,
      order.pwbBgReturnDate,
      order.combinedBgReceivedDate,
      order.combinedBgValidityDate,
      order.combinedBgReturnDate,
      order.revisedDp,
      order.materialReceiptDate,
      order.irPreparationDate,
      order.irReceiptDate,
      order.billPreparationDate,
      order.billSentForPaymentDate,
      order.paymentDate,
      order.soCancelledDate,
    ]),
  ]
    .filter((value): value is string => hasDate(value))
    .sort((a, b) => b.localeCompare(a))[0];
}

function getOrderTimelineLastFilledDateValue(file: FileRecord, order: SupplyOrderDetail) {
  return [
    file.receivedDate,
    file.scrutinyDate,
    file.scrutinyResponseDate,
    file.scrutinyCompletionDate,
    file.immsDate,
    file.highValueMeetingDate,
    file.highValueMinutesDate,
    file.adSentDate,
    file.preTcecDate,
    file.preTcecMinutesDate,
    file.adVettingDate,
    file.rqaSentDate,
    file.rqaApprovalDate,
    file.ifaSentDate,
    file.ifaFinalDate,
    file.cfaSentDate,
    file.cfaDate,
    file.gemUndertakingDate,
    file.rfpVettingInitiationDate,
    file.rfpVettingApprovalDate,
    file.bidDate,
    file.bidOpeningDate,
    file.refloatBiddingDate,
    file.refloatBidOpeningDate,
    file.postTcecDate,
    file.postTcecMinutesDate,
    file.refloatPostTcecDate,
    file.refloatPostTcecMinutesDate,
    file.cncDate,
    file.cncApprovalDate,
    order.financialSanctionDate,
    order.soDate,
    order.dpDate,
    order.psbBgReceivedDate,
    order.psbBgValidityDate,
    order.psbBgReturnDate,
    order.pwbBgReceivedDate,
    order.pwbBgValidityDate,
    order.pwbBgReturnDate,
    order.combinedBgReceivedDate,
    order.combinedBgValidityDate,
    order.combinedBgReturnDate,
    order.revisedDp,
    order.materialReceiptDate,
    order.irPreparationDate,
    order.irReceiptDate,
    order.billPreparationDate,
    order.billSentForPaymentDate,
    order.paymentDate,
  ]
    .filter((value): value is string => hasDate(value))
    .sort((a, b) => b.localeCompare(a))[0];
}

function getFileReference(file: FileRecord) {
  return file.fileNo || file.uniqueCode || file.title || file.id;
}

function getDescriptionWithUniqueCode(file: FileRecord) {
  const uniqueCode = (file.uniqueCode ?? "").trim();
  const description = (file.demandDescription ?? "").trim();
  if (uniqueCode && description) return `${uniqueCode} — ${description}`;
  return description || uniqueCode;
}

function getDelayThresholdDays(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeExpectedCashOutgoDays(value: string) {
  const parsed = Number.parseInt(String(value), 10);
  return String(Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_DP_OFFSET_DAYS);
}

const defaultBgReceiptDelayDays = ["10", "30", "60"];

function normalizeBgReceiptDelayDays(value: string[]) {
  const days = Array.from(
    new Set(
      value
        .map((item) => Number.parseInt(String(item), 10))
        .filter((item) => Number.isInteger(item) && item >= 0),
    ),
  ).sort((a, b) => a - b);
  return (
    days.length ? days : defaultBgReceiptDelayDays.map((item) => Number.parseInt(item, 10))
  ).slice(0, 6);
}

function normalizeWarrantyBgBufferDays(value: string) {
  const parsed = Number.parseInt(String(value), 10);
  return String(Number.isInteger(parsed) && parsed >= 0 ? parsed : 60);
}

function getDelayStatusDashboardFilter(days: number, milestoneKey: string) {
  return `delayStatus:${days}:${milestoneKey || "all"}`;
}

function getBiddingDelayBreakupRows(rows: DelayStatusRow[]) {
  return biddingDelayBreakupOptions.map((option) => ({
    ...option,
    count: rows.filter(
      (row) =>
        row.milestoneKey === biddingDelayMilestoneKey && row.biddingBreakupKey === option.key,
    ).length,
  }));
}

function getCashOutgoDashboardFilter(
  mode: CashOutgoFilterMode,
  monthKey: string,
  offsetDays: number,
  dateContext?: { fromDate?: string; toDate?: string; asOfDate?: string },
) {
  const parts = [
    "cashOutgo",
    mode,
    encodeURIComponent(monthKey),
    String(offsetDays),
    dateContext?.fromDate ?? "",
    dateContext?.toDate ?? "",
    dateContext?.asOfDate ?? "",
  ];
  return parts.join(":");
}

function getCashOutgoAnyDashboardFilter(
  modes: CashOutgoFilterMode[],
  monthKey: string,
  offsetDays: number,
  dateContext?: { fromDate?: string; toDate?: string; asOfDate?: string },
) {
  const parts = [
    "cashOutgoAny",
    modes.map(encodeURIComponent).join(","),
    encodeURIComponent(monthKey),
    String(offsetDays),
    dateContext?.fromDate ?? "",
    dateContext?.toDate ?? "",
    dateContext?.asOfDate ?? "",
  ];
  return parts.join(":");
}

function getDelayStatusSummary(rows: DelayStatusRow[]) {
  const totalDays = rows.reduce((sum, row) => sum + row.daysInStage, 0);
  const counts = new Map<string, { key: string; label: string; fileIds: Set<string> }>();
  rows.forEach((row) => {
    const current = counts.get(row.milestoneKey) ?? {
      key: row.milestoneKey,
      label: row.milestone,
      fileIds: new Set<string>(),
    };
    current.fileIds.add(row.fileId);
    counts.set(row.milestoneKey, current);
  });

  return {
    averageDays: rows.length ? Math.round(totalDays / rows.length) : 0,
    longestDays: rows.reduce((max, row) => Math.max(max, row.daysInStage), 0),
    byMilestone: Array.from(counts.values())
      .map(({ key, label, fileIds }) => ({ key, label, count: fileIds.size }))
      .sort((a, b) => b.count - a.count),
  };
}

function getDelayStatusDisplayValue(row: DelayStatusRow, key: DelayStatusColumnKey, index: number) {
  if (key === "serial") return String(index + 1);
  if (key === "daysInStage") return String(row.daysInStage);
  if (key === "milestone") return getWorkflowDisplayLabel(row.milestone);
  return row[key];
}

function getExpectedCashOutgoTotals(rows: ExpectedCashOutgoRow[]) {
  return rows.reduce(
    (totals, row) => {
      const capital = Number(row.capital) || 0;
      const revenue = Number(row.revenue) || 0;
      return {
        capital: totals.capital + capital,
        revenue: totals.revenue + revenue,
        total: totals.total + capital + revenue,
      };
    },
    { capital: 0, revenue: 0, total: 0 },
  );
}

function getCashOutgoTotalsExportRow(rows: ExpectedCashOutgoRow[]) {
  const totals = getExpectedCashOutgoTotals(rows);
  return ["", "Total", formatLakhValue(totals.capital), formatLakhValue(totals.revenue)];
}

function getCashOutgoDisplayValue(
  row: ExpectedCashOutgoRow,
  key: CashOutgoColumnKey,
  index: number,
  includeUnit = false,
) {
  if (key === "serial") return String(index + 1);
  if (key === "month") return row.month;
  return includeUnit ? formatCurrency(row[key]) : formatLakhValue(row[key]);
}

function addDays(date: string | undefined, days: number) {
  const time = parseLocalDateTime(date ?? "");
  if (time === undefined) return undefined;
  const next = new Date(time);
  next.setDate(next.getDate() + days);
  return formatLocalDate(next);
}

function formatMonthLabel(date: string) {
  const time = parseLocalDateTime(date);
  if (time === undefined) return date;
  const parsed = new Date(time);
  return `${formatShortMonth(parsed)}-${parsed.getFullYear()}`;
}

function formatDateTitle(date: string) {
  const time = parseLocalDateTime(date);
  if (time === undefined) return date;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(new Date(time))
    .replace(/ /g, "-");
}

function formatMonthTitle(monthKey: string) {
  const time = parseLocalDateTime(`${monthKey}-01`);
  if (time === undefined) return monthKey;
  const parsed = new Date(time);
  return `${formatShortMonth(parsed)}-${parsed.getFullYear()}`;
}

function formatShortMonth(date: Date) {
  return new Intl.DateTimeFormat("en-IN", { month: "short" }).format(date).slice(0, 3);
}

function formatCurrency(value: number) {
  return `${formatThousandsAndLakhs(value / 100_000, 2)} Lakh`;
}

function formatLakhValue(value: number) {
  return formatThousandsAndLakhs(value / 100_000, 2);
}

function formatSoPaymentMatrixAmount(value: number) {
  return formatThousandsAndLakhs(value / 100_000, 2);
}

type MilestoneDefinition = {
  key: string;
  label: string;
  completedLabel?: string;
  totalLabel?: string;
  pendingLabel?: string;
  reviewed?: keyof FileRecord | keyof SupplyOrderDetail;
  current: keyof FileRecord | keyof SupplyOrderDetail;
  applies?: (file: FileRecord) => boolean;
};

type StatusSummaryRow = {
  milestone: string;
  stage: string;
  count: number;
};

type StatusSummaryTableRow = {
  milestone: string;
  counts: Partial<Record<StatusSummaryDisplayColumn, number | string>>;
};

type StatusSummaryTableGroup = {
  key: string;
  title: string;
  columns: StatusSummaryDisplayColumn[];
  rows: StatusSummaryTableRow[];
};

const commonStatusColumns = ["Total", "In process", "Pending", "Completed"] as const;

const statusSummaryColumns = [
  "Total files",
  "Total cases",
  "Placed",
  "Received",
  "Reviewed",
  "Pending",
  "At Previous Stage",
  "At previous stage",
  "At previous stages",
  "To be returned",
  "Returned",
  "Bills returned",
  "Return pending",
  "Resubmitted and Unpaid",
  "Returned paid",
  "In process",
  "Opening overdue",
  "Live",
  "Due",
  "Done",
  "Refloat Due",
  "Refloat Completed",
  "Live Milestone",
  "Completed",
  "Milestone Period Over",
  "Overdue",
  "Valid",
  "Expired",
  "Extended",
] as const;

type StatusSummaryColumn = (typeof statusSummaryColumns)[number];
type CommonStatusColumn = (typeof commonStatusColumns)[number];
type StatusSummaryDisplayColumn = StatusSummaryColumn | CommonStatusColumn;

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
  },
  {
    key: "psbPwb",
    label: "PSB+PWB",
    completedLabel: "Received",
    totalLabel: "Total files",
    current: "combinedBgReceivedDate",
  },
  { key: "payment", label: "Payment", totalLabel: "Total files", current: "paymentDate" },
] satisfies MilestoneDefinition[];

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

function isSupplyOrderDrivenMilestoneName(name: string) {
  return supplyOrderMilestoneNames.some(
    (milestone) => normalizeMilestoneName(milestone) === normalizeMilestoneName(name),
  );
}

const orderDelayMilestoneKeys = new Set<string>(orderDelayMilestones.map((milestone) => milestone.key));

const delayMilestoneOptions = [
  { key: "workflowNotStarted", label: "Workflow Not Started" },
  { key: biddingDelayMilestoneKey, label: biddingDelayMilestoneLabel },
  ...milestoneDefinitions
    .filter(
      (milestone) =>
        milestone.key !== biddingDelayMilestoneKey && !orderDelayMilestoneKeys.has(milestone.key),
    )
    .map((milestone) => ({
      key: milestone.key,
      label: milestone.label,
    })),
  ...orderDelayMilestones.map((milestone) => ({
    key: milestone.key,
    label: milestone.label,
  })),
  { key: billReturnedDelayMilestoneKey, label: "Returned Bills" },
  {
    key: supplementaryBillReturnedDelayMilestoneKey,
    label: "Supplementary bill returned for correction",
  },
];

function getStatusSummaryTableGroups(files: FileRecord[]): StatusSummaryTableGroup[] {
  const byMilestone = new Map<string, StatusSummaryTableRow & { columns: StatusSummaryColumn[] }>();

  [
    ...getStatusSummaryRows(files),
    {
      milestone: "Returned Bills",
      stage: "Bills returned",
      count: countReturnedBillOrders(files),
    },
    {
      milestone: "Returned Bills",
      stage: "Return pending",
      count: countReturnedBillPendingOrders(files),
    },
    {
      milestone: "Returned Bills",
      stage: "Resubmitted and Unpaid",
      count: countReturnedBillResubmittedOrders(files),
    },
    {
      milestone: "Returned Bills",
      stage: "Returned paid",
      count: countReturnedBillPaidOrders(files),
    },
  ].forEach((row) => {
    if (!isStatusSummaryColumn(row.stage)) return;
    const tableRow = byMilestone.get(row.milestone) ?? {
      milestone: row.milestone,
      counts: {},
      columns: [],
    };
    tableRow.counts[row.stage] = row.count;
    if (!tableRow.columns.includes(row.stage)) tableRow.columns.push(row.stage);
    byMilestone.set(row.milestone, tableRow);
  });

  const commonGroup: StatusSummaryTableGroup = {
    key: "common",
    title: "Common milestone status",
    columns: [...commonStatusColumns],
    rows: [],
  };
  const groups = new Map<string, StatusSummaryTableGroup>();
  Array.from(byMilestone.values()).forEach((row) => {
    const columns = getStatusSummaryColumnsForRow(row.columns);
    if (isCommonStatusRow(row)) {
      commonGroup.rows.push({
        milestone: row.milestone,
        counts: {
          Total: row.counts["Total files"] ?? row.counts["Total cases"],
          "In process": row.counts["In process"],
          Completed: row.counts.Completed,
          Pending: row.counts.Pending ?? "-",
        },
      });
      return;
    }

    const isFinancialSanctionRow = row.milestone === "Financial Sanction";
    const key = isFinancialSanctionRow ? "financialSanction" : columns.join("|");
    const group = groups.get(key) ?? {
      key,
      title: isFinancialSanctionRow ? "Financial Sanction" : getStatusSummaryGroupTitle(columns),
      columns,
      rows: [],
    };
    group.rows.push({ milestone: row.milestone, counts: row.counts });
    groups.set(key, group);
  });

  const orderedGroups = Array.from(groups.values());
  const paymentGroups = orderedGroups.filter((group) => group.title === "Payment");
  const paymentGroup = paymentGroups.length
    ? {
        key: "payment",
        title: "Payment",
        columns: Array.from(new Set(paymentGroups.flatMap((group) => group.columns))),
        rows: paymentGroups.flatMap((group) => group.rows),
      }
    : undefined;
  const nonPaymentGroups = orderedGroups.filter((group) => group.title !== "Payment");
  return [
    ...(commonGroup.rows.length ? [commonGroup] : []),
    ...nonPaymentGroups,
    ...(paymentGroup ? [paymentGroup] : []),
  ];
}

function isStatusSummaryColumn(stage: string): stage is StatusSummaryColumn {
  return statusSummaryColumns.includes(stage as StatusSummaryColumn);
}

function getStatusSummaryColumnsForRow(columns: StatusSummaryColumn[]): StatusSummaryColumn[] {
  if (columns.includes("Bills returned")) {
    return ["Bills returned", "Return pending", "Resubmitted and Unpaid", "Returned paid"].filter(
      (column) => columns.includes(column as StatusSummaryColumn),
    ) as StatusSummaryColumn[];
  }
  if (columns.includes("Refloat Due") || columns.includes("Refloat Completed")) {
    return ["Due", "Completed", "Refloat Due", "Refloat Completed"].filter((column) =>
      columns.includes(column as StatusSummaryColumn),
    ) as StatusSummaryColumn[];
  }

  if (columns.includes("Due") && columns.includes("Done")) {
    return ["Due", "Done"];
  }

  if (columns.includes("Opening overdue")) {
    return ["Live", "In process", "Opening overdue", "Completed"].filter((column) =>
      columns.includes(column as StatusSummaryColumn),
    ) as StatusSummaryColumn[];
  }

  if (columns.includes("Overdue") && columns.includes("Completed")) {
    return ["Completed", "Pending", "Overdue"].filter((column) =>
      columns.includes(column as StatusSummaryColumn),
    ) as StatusSummaryColumn[];
  }

  if (columns.length === 2 && columns.includes("Completed") && columns.includes("Pending")) {
    return ["Completed", "Pending"];
  }

  return statusSummaryColumns.filter((column) => columns.includes(column));
}

function isCommonStatusRow(row: StatusSummaryTableRow & { columns: StatusSummaryColumn[] }) {
  return (
    (row.columns.includes("Total files") || row.columns.includes("Total cases")) &&
    row.columns.includes("In process") &&
    row.columns.includes("Completed")
  );
}

function getStatusSummaryGroupTitle(columns: StatusSummaryDisplayColumn[]) {
  if (columns.includes("Total cases")) return "Case approval milestones";
  if (columns.includes("Reviewed")) return "File approval milestones";
  if (columns.includes("Opening overdue")) return "Bidding";
  if (columns.includes("Placed")) return "Supply Order";
  if (columns.includes("Received")) return "PSB / PWB";
  if (columns.includes("Valid")) return "Delivery Period";
  if (columns.includes("Refloat Due")) return "Pre-Bid Meeting";
  if (columns.includes("Returned paid")) return "Payment";
  if (columns.includes("Due") && columns.includes("Done")) return "Job Completion";
  if (columns.includes("Milestone Period Over")) return "Job Completion";
  if (columns.includes("Overdue")) {
    return "Delivery";
  }
  if (columns.length === 2 && columns.includes("Completed") && columns.includes("Pending")) {
    return "Payment";
  }
  return "Other milestones";
}

function getStatusSummaryRows(files: FileRecord[]): StatusSummaryRow[] {
  const rows = milestoneDefinitions.flatMap((milestone) =>
    getMilestoneStatusRows(files, milestone),
  );

  const supplyOrderIndex = rows.findIndex((row) => row.milestone === "Supply Order");
  const deliveryPeriodRows = [
    {
      milestone: "Delivery Period",
      stage: "Valid",
      count: countDeliveryPeriodEntries(files, isValidDeliveryPeriodEntry),
    },
    {
      milestone: "Delivery Period",
      stage: "Expired",
      count: countDeliveryPeriodEntries(files, isExpiredDeliveryPeriodEntry),
    },
    {
      milestone: "Delivery Period",
      stage: "Extended",
      count: countDeliveryPeriodEntries(files, isExtendedDeliveryPeriodEntry),
    },
  ];
  const withDeliveryPeriod =
    supplyOrderIndex === -1
      ? [...rows, ...deliveryPeriodRows]
      : [
          ...rows.slice(0, supplyOrderIndex + 4),
          ...deliveryPeriodRows,
          ...rows.slice(supplyOrderIndex + 4),
        ];
  const biddingIndex = withDeliveryPeriod.findIndex((row) => row.milestone === "Bidding");
  const preBidRows = [
    {
      milestone: "Pre-Bid Meeting",
      stage: "Due",
      count: countPreBidMeetingStatuses(files, false, "due"),
    },
    {
      milestone: "Pre-Bid Meeting",
      stage: "Completed",
      count: countPreBidMeetingStatuses(files, false, "completed"),
    },
    {
      milestone: "Pre-Bid Meeting",
      stage: "Refloat Due",
      count: countPreBidMeetingStatuses(files, true, "due"),
    },
    {
      milestone: "Pre-Bid Meeting",
      stage: "Refloat Completed",
      count: countPreBidMeetingStatuses(files, true, "completed"),
    },
  ];
  const withPreBid =
    biddingIndex === -1
      ? [...withDeliveryPeriod, ...preBidRows]
      : [
          ...withDeliveryPeriod.slice(0, biddingIndex + 1),
          ...preBidRows,
          ...withDeliveryPeriod.slice(biddingIndex + 1),
        ];
  const advancePaymentRows = [
    {
      milestone: "Advance Payment",
      stage: "Completed",
      count: advancePaymentEntries(files).filter(
        ({ file, order }) => isAdvancePaymentPaid(order) && isPaymentOrderActive(file, order),
      ).length,
    },
    {
      milestone: "Advance Payment",
      stage: "Pending",
      count: advancePaymentEntries(files).filter(
        ({ file, order }) => isAdvancePaymentPending(order) && isPaymentOrderActive(file, order),
      ).length,
    },
  ];
  const billReturnRows = [
    {
      milestone: "Returned Bills",
      stage: "Bills returned",
      count: countReturnedBillOrders(files),
    },
    {
      milestone: "Returned Bills",
      stage: "Return pending",
      count: countReturnedBillPendingOrders(files),
    },
    {
      milestone: "Returned Bills",
      stage: "Resubmitted and Unpaid",
      count: countReturnedBillResubmittedOrders(files),
    },
    {
      milestone: "Returned Bills",
      stage: "Returned paid",
      count: countReturnedBillPaidOrders(files),
    },
  ];

  const lastBgIndex = Math.max(
    withPreBid.map((row) => row.milestone).lastIndexOf("PSB"),
    withPreBid.map((row) => row.milestone).lastIndexOf("PWB"),
    withPreBid.map((row) => row.milestone).lastIndexOf("PSB+PWB"),
  );
  const deliveryRows = [
    {
      milestone: "Delivery",
      stage: "Completed",
      count: countCompletedDeliveryStatuses(files),
    },
    { milestone: "Delivery", stage: "Pending", count: countPendingDeliveryStatuses(files) },
    { milestone: "Delivery", stage: "Overdue", count: countOverdueDeliveryStatuses(files) },
  ];
  const jobCompletionRows = [
    {
      milestone: "Job Completion",
      stage: "Due",
      count: countLiveJobCompletionStatuses(files),
    },
    {
      milestone: "Job Completion",
      stage: "Done",
      count: countCompletedJobCompletionStatuses(files),
    },
  ];
  const deliveryMilestoneRows = [...deliveryRows, ...jobCompletionRows];

  if (lastBgIndex === -1)
    return [...withPreBid, ...deliveryMilestoneRows, ...advancePaymentRows, ...billReturnRows];
  return [
    ...withPreBid.slice(0, lastBgIndex + 1),
    ...deliveryMilestoneRows,
    ...withPreBid.slice(lastBgIndex + 1),
    ...advancePaymentRows,
    ...billReturnRows,
  ];
}

function getMilestoneStatusRows(
  files: FileRecord[],
  milestone: MilestoneDefinition,
): StatusSummaryRow[] {
  const applicableFiles = files.filter((file) => isMilestoneApplicable(file, milestone));
  const processFiles = applicableFiles.filter((file) => !isCancelledFile(file));
  const reachedFiles = processFiles.filter((file) => isEligibleMilestone(file, milestone));
  const activeFiles = processFiles.filter((file) => isManualActiveMilestone(file, milestone));
  const reviewedFiles = activeFiles.filter((file) => isMilestoneReviewed(file, milestone));
  const pendingFiles = activeFiles.filter((file) => isPendingMilestone(file, milestone));
  const clearedFiles = processFiles.filter((file) => isMilestoneComplete(file, milestone));
  const base = (stage: string, count: number) => ({
    milestone: milestone.label,
    stage,
    count,
  });

  if (isBgMilestoneKey(milestone.key)) {
    return [
      base("Received", countBgReceivedOrders(processFiles, milestone.key)),
      base("Pending", countBgPendingOrders(processFiles, milestone.key)),
      base("Expired", countBgExpiredOrders(processFiles, milestone.key)),
      base("To be returned", countBgToBeReturnedOrders(processFiles, milestone.key)),
      base("Returned", countBgReturnedOrders(processFiles, milestone.key)),
    ];
  }

  if (milestone.key === "payment") {
    return [
      base("Completed", countPaymentCompletedOrders(processFiles)),
      base("Pending", countPaymentPendingOrders(processFiles)),
    ];
  }

  if (
    milestone.key === "irPreparation" ||
    milestone.key === "irReceipt" ||
    milestone.key === "billPreparation" ||
    milestone.key === "billSentForPayment"
  ) {
    const normalized = normalizeMilestoneName(milestone.key);
    return [
      base("Completed", countCompletedOrderDrivenMilestoneStatuses(processFiles, normalized)),
      base("Pending", countCurrentOrderDrivenMilestoneStatuses(processFiles, normalized)),
    ];
  }

  if (milestone.key === "refloatBidding") {
    const refloatBiddingInProgressFiles = processFiles.filter(isRefloatBiddingInProgressFile);
    return [
      base("Live", refloatBiddingInProgressFiles.filter(isFileTenderLive).length),
      base(
        "In process",
        refloatBiddingInProgressFiles.filter(
          (file) => !isFileTenderLive(file) && !isRefloatBidOverdue(file),
        ).length,
      ),
      base("Opening overdue", refloatBiddingInProgressFiles.filter(isRefloatBidOverdue).length),
      base("Completed", clearedFiles.length),
    ];
  }

  if (milestone.key === "refloatPostTcec") {
    const pendingRefloatPostTcec = processFiles.filter(
      (file) => !hasFilledString(file.refloatPostTcecMinutesDate),
    );
    const reviewedRefloatPostTcec = pendingRefloatPostTcec.filter((file) =>
      hasFilledString(file.refloatPostTcecDate),
    );
    return [
      base(milestone.totalLabel ?? "Total", processFiles.length),
      base("Completed", clearedFiles.length),
      base(
        "At previous stage",
        files.filter((file) => isYes(file.refloat) && !isYes(file.biddingStageOver)).length,
      ),
      base("In process", pendingRefloatPostTcec.length),
      base("Reviewed", reviewedRefloatPostTcec.length),
      base("Pending", pendingRefloatPostTcec.length),
    ];
  }

  if (milestone.key === "bidding") {
    return [
      base("Completed", clearedFiles.length),
      base(
        "In process",
        activeFiles.filter((file) => !isFileTenderLive(file) && !isBidOverdue(file)).length,
      ),
      base("Opening overdue", applicableFiles.filter(isBidOverdue).length),
      base("Live", applicableFiles.filter(isFileTenderLive).length),
      base("At previous stages", countAtPreviousStageFiles(applicableFiles, milestone)),
    ];
  }

  if (milestone.key === "supplyOrder") {
    return [
      base("Placed", countCompletedOrderDrivenMilestoneStatuses(applicableFiles, "supplyorder")),
      base("Live", countLiveSupplyOrders(applicableFiles)),
      base(
        "At Previous Stage",
        countCurrentOrderDrivenMilestoneStatuses(applicableFiles, "financialsanction"),
      ),
      base("Pending", countCurrentOrderDrivenMilestoneStatuses(applicableFiles, "supplyorder")),
    ];
  }

  if (milestone.key === "financialSanction") {
    return [
      base("At Previous Stage", countFinancialSanctionPreviousStageFiles(applicableFiles)),
      base(
        "Completed",
        countCompletedOrderDrivenMilestoneStatuses(applicableFiles, "financialsanction"),
      ),
      base(
        "Pending",
        countCurrentOrderDrivenMilestoneStatuses(applicableFiles, "financialsanction"),
      ),
    ];
  }

  if (milestone.key === "scrutiny" || milestone.key === "cfa") {
    return [
      base("In process", activeFiles.length),
      base("Reviewed", reviewedFiles.length),
      base("Pending", pendingFiles.length),
      base("Total files", applicableFiles.length),
      base("Completed", clearedFiles.length),
    ];
  }

  if (["highValue", "tcec", "ifa", "postTcec", "cnc"].includes(milestone.key)) {
    return [
      base(milestone.totalLabel ?? "Total", applicableFiles.length),
      base("Completed", clearedFiles.length),
      base("At previous stage", countAtPreviousStageFiles(applicableFiles, milestone)),
      base("In process", activeFiles.length),
      base("Reviewed", reviewedFiles.length),
      base("Pending", pendingFiles.length),
    ];
  }

  return [
    base(milestone.totalLabel ?? "Total", applicableFiles.length),
    base("Completed", clearedFiles.length),
    base("In process", activeFiles.length),
    base("At previous stage", countAtPreviousStageFiles(applicableFiles, milestone)),
  ];
}

function countAtPreviousStageFiles(files: FileRecord[], milestone: MilestoneDefinition) {
  return files.filter((file) => isAtPreviousStageFile(file, milestone)).length;
}

function isAtPreviousStageFile(file: FileRecord, milestone: MilestoneDefinition) {
  if (!isEligibleMilestone(file, milestone)) return false;
  if (isMilestoneComplete(file, milestone)) return false;
  if (isManualActiveMilestone(file, milestone)) return false;
  if (isMilestoneReviewed(file, milestone)) return false;
  if (milestone.key === "bidding" && (isFileTenderLive(file) || isBidOverdue(file))) return false;
  if (isSupplyOrderDrivenMilestoneName(milestone.label)) {
    const normalized = normalizeMilestoneName(milestone.label);
    if (countCurrentOrderDrivenMilestoneStatuses([file], normalized) > 0) return false;
    if (countCompletedOrderDrivenMilestoneStatuses([file], normalized) > 0) return false;
  }
  return true;
}

function isMilestoneApplicable(file: FileRecord, milestone: MilestoneDefinition) {
  return milestone.applies ? milestone.applies(file) : true;
}

function isEligibleMilestone(file: FileRecord, milestone: MilestoneDefinition) {
  if (isCancelledFile(file)) return false;
  return (
    isMilestoneApplicable(file, milestone) && isPreviousApplicableMilestoneComplete(file, milestone)
  );
}

function isPreviousApplicableMilestoneComplete(file: FileRecord, milestone: MilestoneDefinition) {
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

function isFlexiblePreControlMilestone(milestone: Pick<MilestoneDefinition, "key">) {
  return ["highValue", "tcec", "ad", "rqa"].includes(milestone.key);
}

function isMilestoneComplete(file: FileRecord, milestone: MilestoneDefinition) {
  if (milestone.key === "bidding") return isYes(file.biddingStageOver);
  if (milestone.key === "refloatBidding") {
    return isYes(file.refloat) && isYes(file.biddingStageOver);
  }
  if (milestone.key === "financialSanction")
    return matchesCompletedSupplyOrderDrivenMilestone(file, "financialsanction");
  return hasMilestoneDate(file, milestone.current);
}

function isMilestoneReviewed(file: FileRecord, milestone: MilestoneDefinition) {
  if (isCancelledFile(file)) return false;
  if (!milestone.reviewed) return false;
  return (
    isManualActiveMilestone(file, milestone) &&
    hasMilestoneDate(file, milestone.reviewed) &&
    !isMilestoneComplete(file, milestone)
  );
}

function isPendingMilestone(file: FileRecord, milestone: MilestoneDefinition) {
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

function isManualActiveMilestone(file: FileRecord, milestone: MilestoneDefinition) {
  if (isCancelledFile(file)) return false;
  const current = normalizeMilestoneName(file.currentMilestone);
  return getMilestoneNameAliases(milestone).some(
    (name) => current === normalizeMilestoneName(name),
  );
}

function isFileClosed(file: Pick<FileRecord, "completedMilestones">) {
  return Boolean(
    file.completedMilestones?.some(
      (milestone) =>
        normalizeMilestoneName(milestone) === normalizeMilestoneName(fileClosedMilestone),
    ),
  );
}

function getMilestoneNameAliases(milestone: MilestoneDefinition) {
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

function normalizeCompletedMilestones(value: string[] | undefined) {
  return Array.from(new Set((value ?? []).map((milestone) => milestone.trim()).filter(Boolean)));
}

function isJobCompletionDone(order: SupplyOrderDetail) {
  return hasFilledString(order.jobCompletionDate);
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

function hasMilestoneDate(file: FileRecord, key: keyof FileRecord | keyof SupplyOrderDetail) {
  if (supplyOrderDateKeys.has(key as keyof SupplyOrderDetail)) {
    return fileSupplyOrders(file).some((order) => {
      const value = order[key as keyof SupplyOrderDetail];
      return typeof value === "string" && hasFilledString(value);
    });
  }
  return hasFilledField(file, key as keyof FileRecord);
}

function hasFilledField(file: FileRecord, key: keyof FileRecord) {
  const value = file[key];
  return typeof value === "string" ? hasFilledString(value) : Boolean(value);
}

function fileSupplyOrders(file: FileRecord) {
  return normalizedFileSupplyOrders(file);
}

function rawSupplyOrders(file: FileRecord) {
  return normalizedRawSupplyOrders(file);
}

function rawSupplyOrderEntries(files: FileRecord[]) {
  return files.flatMap((file) => rawSupplyOrders(file).map((order) => ({ file, order })));
}

function expectedSupplyOrders(file: FileRecord) {
  return normalizedExpectedSupplyOrders(file);
}

function hasFilledObjectValue(value: Record<string, unknown>): boolean {
  return Object.entries(value).some(([key, item]) => {
    if (Array.isArray(item)) {
      return item.some((row) => hasFilledObjectValue(row as Record<string, unknown>));
    }
    if (item && typeof item === "object") {
      return hasFilledObjectValue(item as Record<string, unknown>);
    }
    const text = String(item ?? "").trim();
    if (!text) return false;
    return !isDefaultNoField(key, text);
  });
}

function isDefaultNoField(key: string, value: string) {
  return (
    value.toLowerCase() === "no" &&
    [
      "advancePayment",
      "demandCancelled",
      "dpExtension",
      "ld",
      "soCancelled",
      "stageDelivery",
      "stagePayment",
    ].includes(key)
  );
}

function filePaymentOrders(file: FileRecord) {
  return normalizedFilePaymentOrders(file);
}

function countDeliveryPeriodEntries(
  files: FileRecord[],
  predicate: (file: FileRecord, order: SupplyOrderDetail) => boolean,
) {
  return files.reduce(
    (sum, file) =>
      sum +
      (isDeliveryInspectionApplicable(file)
        ? fileSupplyOrders(file).filter((order) => predicate(file, order)).length
        : 0),
    0,
  );
}

function countPaymentCompletedOrders(files: FileRecord[]) {
  return files.reduce(
    (sum, file) =>
      sum +
      filePaymentOrders(file).filter(
        (order) => hasFilledString(order.paymentDate) && isPaymentOrderActive(file, order),
      ).length,
    0,
  );
}

function countPaymentPendingOrders(files: FileRecord[]) {
  return files.reduce(
    (sum, file) =>
      sum +
      filePaymentOrders(file).filter(
        (order) =>
          hasPaymentWorkflowStarted(file, order) &&
          !hasFilledString(order.paymentDate) &&
          isPaymentOrderActive(file, order),
      ).length,
    0,
  );
}

function countReturnedBillOrders(files: FileRecord[]) {
  return countPaymentOrders(files, hasReturnedBill);
}

function countReturnedBillPendingOrders(files: FileRecord[]) {
  return countPaymentOrders(files, hasOpenBillReturn);
}

function countReturnedBillResubmittedOrders(files: FileRecord[]) {
  return countPaymentOrders(
    files,
    (order) =>
      hasCompletedBillReturn(order) &&
      !hasFilledString(order.paymentDate) &&
      !isShortclosureNoFurtherAction(order),
  );
}

function countReturnedBillPaidOrders(files: FileRecord[]) {
  return countPaymentOrders(files, hasReturnedBillPaid);
}

function countPaymentOrders(files: FileRecord[], predicate: (order: SupplyOrderDetail) => boolean) {
  return files.reduce(
    (sum, file) =>
      sum +
      filePaymentOrders(file).filter(
        (order) => isPaymentOrderActive(file, order) && predicate(order),
      ).length,
    0,
  );
}

function countCompletedDeliveryStatuses(files: FileRecord[]) {
  return files.reduce((total, file) => {
    if (isCancelledFile(file)) return total;
    if (!isDeliveryInspectionApplicable(file)) return total;
    return (
      total +
      fileSupplyOrders(file).filter(
        (order) => !isSupplyOrderCancelled(file, order) && isCompletedDeliveryOrder(file, order),
      ).length
    );
  }, 0);
}

function countCompletedJobCompletionStatuses(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      !isCancelledFile(file) &&
      isJobCompletionWorkflow(file) &&
      !isSupplyOrderCancelled(file, order) &&
      hasSupplyOrderDate(order) &&
      isJobCompletionDone(order),
  ).length;
}

function countLiveJobCompletionStatuses(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      !isCancelledFile(file) &&
      isJobCompletionWorkflow(file) &&
      !isSupplyOrderCancelled(file, order) &&
      isJobCompletionCurrentOrder(file, order),
  ).length;
}

function countJobCompletionPeriodOverStatuses(files: FileRecord[]) {
  return files.reduce((total, file) => {
    if (isCancelledFile(file) || !isJobCompletionWorkflow(file)) return total;
    return (
      total +
      fileSupplyOrders(file).filter(
        (order) =>
          !isSupplyOrderCancelled(file, order) &&
          hasSupplyOrderDate(order) &&
          !isJobCompletionDone(order) &&
          isDateBeforeToday(getDeliveryPeriodDate(order)),
      ).length
    );
  }, 0);
}

function countPlacedSupplyOrders(files: FileRecord[]) {
  return files.reduce(
    (sum, file) =>
      sum +
      rawSupplyOrders(file).filter(
        (order) => isSupplyOrderTabComplete(file, order) && !isSupplyOrderCancelled(file, order),
      ).length,
    0,
  );
}

function countLiveSupplyOrders(files: FileRecord[]) {
  return files.reduce(
    (sum, file) =>
      sum +
      rawSupplyOrders(file).filter(
        (order) =>
          isSupplyOrderTabComplete(file, order) &&
          !hasFilledString(order.paymentDate) &&
          !isSupplyOrderCancelled(file, order),
      ).length,
    0,
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

function isBgMilestoneKey(key: string) {
  const normalized = normalizeMilestoneName(key);
  return normalized === "psb" || normalized === "pwb" || normalized === "psbpwb";
}

function isOrderCurrentForMilestone(
  file: FileRecord,
  order: SupplyOrderDetail,
  normalizedMilestone: string,
) {
  return isCanonicalSupplyOrderMilestoneCurrent(file, order, normalizedMilestone);
}

function orderDrivenMilestoneRows(file: FileRecord, normalizedMilestone: string) {
  if (normalizedMilestone === "financialsanction") return expectedSupplyOrders(file);
  if (
    normalizedMilestone === "supplyorder" ||
    normalizedMilestone === "bankguarantee" ||
    isBgMilestoneKey(normalizedMilestone)
  ) {
    return expectedSupplyOrders(file);
  }
  if (isPaymentMilestone(normalizedMilestone)) return filePaymentOrders(file);
  return fileSupplyOrders(file);
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

function matchesCompletedSupplyOrderDrivenMilestone(file: FileRecord, milestone: string) {
  const normalized = normalizeMilestoneName(milestone);
  if (isYes(file.demandCancelled)) return false;
  if (!isPaymentMilestone(normalized) && isCancelledFile(file)) return false;
  if (normalized === "supplyorder") {
    return rawSupplyOrders(file).some(
      (order) => isSupplyOrderTabComplete(file, order) && !isSupplyOrderCancelled(file, order),
    );
  }
  if (!shouldUseOrderMilestoneRows(file)) {
    if (normalized === "financialsanction") {
      return fileSupplyOrders(file).some(
        (order) =>
          !isSupplyOrderCancelled(file, order) && hasFilledString(order.financialSanctionDate),
      );
    }
    return Boolean(
      file.completedMilestones?.some((item) => normalizeMilestoneName(item) === normalized),
    );
  }
  return orderDrivenMilestoneRows(file, normalized).some(
    (order) =>
      isOrderActiveForMilestone(file, order, normalized) &&
      (normalized === "financialsanction"
        ? hasFilledString(order.financialSanctionDate)
        : isDateCompletedPaymentMilestoneOrder(order, normalized)
          ? true
          : normalized === "billreturnedforcorrection"
            ? hasCompletedBillReturn(order)
            : order.completedMilestones?.some(
                (item) => normalizeMilestoneName(item) === normalized,
              )),
  );
}

function isOrderMilestoneApplicable(file: FileRecord, normalizedMilestone: string) {
  if (normalizedMilestone === "bankguarantee") return isYes(file.bg);
  if (normalizedMilestone === "delivery") return isDeliveryInspectionApplicable(file);
  if (normalizedMilestone === "jobcompletion") return isJobCompletionWorkflow(file);
  if (normalizedMilestone === "irpreparation" || normalizedMilestone === "irreceipt") {
    return isYes(file.ir);
  }
  return true;
}

function countCurrentOrderDrivenMilestoneStatuses(
  files: FileRecord[],
  normalizedMilestone: string,
) {
  return files.reduce((total, file) => {
    if (isYes(file.demandCancelled)) return total;
    if (!isPaymentMilestone(normalizedMilestone) && isCancelledFile(file)) return total;
    if (normalizedMilestone === "advancepayment") {
      return (
        total +
        advancePaymentEntries([file]).filter(
          ({ file: entryFile, order }) =>
            isAdvancePaymentPending(order) && isPaymentOrderActive(entryFile, order),
        ).length
      );
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
      orderDrivenMilestoneRows(file, normalizedMilestone).filter(
        (order) =>
          isOrderActiveForCurrentMilestone(file, order, normalizedMilestone) &&
          isCanonicalSupplyOrderMilestoneCurrent(file, order, normalizedMilestone),
      ).length
    );
  }, 0);
}

function countFinancialSanctionPreviousStageFiles(files: FileRecord[]) {
  return files.filter(isFinancialSanctionPreviousStageFile).length;
}

function isFinancialSanctionPreviousStageFile(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  if (matchesCompletedSupplyOrderDrivenMilestone(file, "financialsanction")) return false;
  if (countCurrentOrderDrivenMilestoneStatuses([file], "financialsanction") > 0) return false;
  const current = normalizeMilestoneName(file.currentMilestone);
  if (isYes(file.tcec)) return current === "cnc" && hasFilledString(file.cncApprovalDate) === false;
  return isBiddingApplicableForFile(file)
    ? current === "bidding" && !isYes(file.biddingStageOver)
    : current === "cfa" && !hasFilledString(file.cfaDate);
}

function countCompletedOrderDrivenMilestoneStatuses(
  files: FileRecord[],
  normalizedMilestone: string,
) {
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
      return (
        total +
        (file.completedMilestones?.some(
          (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
        )
          ? 1
          : 0)
      );
    }
    return (
      total +
      expectedSupplyOrders(file).filter(
        (order) =>
          isOrderActiveForMilestone(file, order, normalizedMilestone) &&
          order.completedMilestones?.some(
            (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
          ),
      ).length
    );
  }, 0);
}

function countPendingDeliveryStatuses(files: FileRecord[]) {
  return files.reduce((total, file) => {
    if (isCancelledFile(file)) return total;
    if (!isDeliveryInspectionApplicable(file)) return total;
    return (
      total +
      fileSupplyOrders(file).filter(
        (order) => !isSupplyOrderCancelled(file, order) && isPendingDeliveryOrder(file, order),
      ).length
    );
  }, 0);
}

function countOverdueDeliveryStatuses(files: FileRecord[]) {
  return files.reduce((total, file) => {
    if (isCancelledFile(file)) return total;
    if (!isDeliveryInspectionApplicable(file)) return total;
    return (
      total +
      fileSupplyOrders(file).filter(
        (order) => !isSupplyOrderCancelled(file, order) && isOverdueDeliveryOrder(file, order),
      ).length
    );
  }, 0);
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
  return hasPaymentDueCompletion(file, order);
}

function isSupplyOrderCancelled(file: FileRecord, order: SupplyOrderDetail) {
  return isYes(file.demandCancelled) || isYes(order.soCancelled);
}

function isPaymentOrderActive(file: FileRecord, order: SupplyOrderDetail) {
  return !isYes(file.demandCancelled) && !isYes(order.soCancelled);
}

function isShortclosureNoFurtherAction(order: SupplyOrderDetail) {
  return isYes(order.noFurtherAction);
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
  if (["psb", "pwb", "psbpwb"].includes(normalizeMilestoneName(normalizedMilestone))) {
    return !isSupplyOrderCancelled(file, order);
  }
  return isPaymentMilestone(normalizedMilestone)
    ? isPaymentOrderActive(file, order) && !isShortclosureNoFurtherAction(order)
    : !isSupplyOrderCancelled(file, order) && !isShortclosureNoFurtherAction(order);
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

function isSupplyOrderPlaced(file: FileRecord) {
  const supplyOrderMilestone = milestoneDefinitions.find(
    (milestone) => milestone.key === "supplyOrder",
  );
  return supplyOrderMilestone ? isMilestoneComplete(file, supplyOrderMilestone) : false;
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

function countBgReceivedOrders(files: FileRecord[], category: string) {
  return rawSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      isBgCategoryApplicable(file, order, category) &&
      isBgReceivedOrder(order, category) &&
      !isSupplyOrderCancelled(file, order),
  ).length;
}

function countBgPendingOrders(files: FileRecord[], category: string) {
  return rawSupplyOrderEntries(files).filter(({ file, order }) =>
    isBgPendingOrder(file, order, category),
  ).length;
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

function isBgReceivedOrder(order: SupplyOrderDetail, category: string) {
  return (
    hasFilledString(getBgReceivedDate(order, category)) ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === normalizeMilestoneName(category),
    )
  );
}

function isLiveSupplyOrder(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) =>
      isSupplyOrderTabComplete(file, order) &&
      !hasFilledString(order.paymentDate) &&
      !isSupplyOrderCancelled(file, order),
  );
}

function isDeliveryCompleted(file: FileRecord) {
  return (
    isDeliveryInspectionApplicable(file) &&
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some((order) => isCompletedDeliveryOrder(file, order))
  );
}

function isDeliveryOverdue(file: FileRecord) {
  return (
    isDeliveryInspectionApplicable(file) &&
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some((order) => isOverdueDeliveryOrder(file, order))
  );
}

function isDeliveryDue(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isDeliveryInspectionApplicable(file) &&
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some((order) => isPendingDeliveryOrder(file, order))
  );
}

function isPhysicalDeliveryWorkflow(file: FileRecord) {
  return isDeliveryInspectionApplicable(file);
}

function isCompletedDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasSupplyOrderDate(order) &&
    isPhysicalDeliveryWorkflow(file) &&
    hasFilledString(order.materialReceiptDate)
  );
}

function isJobCompletionWorkflow(file: FileRecord) {
  return !isDeliveryInspectionApplicable(file);
}

function isGoodsServicesIrNo(file: FileRecord) {
  return !isContractFileType(file) && isNo(file.ir);
}

function isJobCompletionCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  if (
    !hasSupplyOrderDate(order) ||
    !isJobCompletionWorkflow(file) ||
    isJobCompletionDone(order) ||
    isYes(order.shortclosure) ||
    isShortclosureNoFurtherAction(order)
  ) {
    return false;
  }
  return isDateBeforeToday(getDeliveryPeriodDate(order));
}

function isDueDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasSupplyOrderDate(order) &&
    isPhysicalDeliveryWorkflow(file) &&
    !isCompletedDeliveryOrder(file, order) &&
    !hasFilledString(order.materialReceiptDate) &&
    !isYes(order.soCancelled) &&
    !isYes(order.shortclosure) &&
    !isShortclosureNoFurtherAction(order)
  );
}

function isPendingDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return isDueDeliveryOrder(file, order) && isCurrentDeliveryPeriodOrder(order);
}

function isOverdueDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return isDueDeliveryOrder(file, order) && isDateBeforeToday(getDeliveryPeriodDate(order));
}

function isCurrentDeliveryPeriodOrder(order: SupplyOrderDetail) {
  const deliveryPeriodDate = getDeliveryPeriodDate(order);
  return (
    hasFilledString(deliveryPeriodDate) &&
    !isDateAfterToday(order.deliveryPeriodStartDate || order.soDate) &&
    !isDateBeforeToday(deliveryPeriodDate)
  );
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
  return isDateBeforeToday(
    addDays(order.warrantyPeriodDate, store.getSettings().bgReturnOffsetDays ?? 60),
  );
}

function isPsbReturnPurposeComplete(file: FileRecord, order: SupplyOrderDetail) {
  if (!isDeliveryInspectionApplicable(file)) {
    return isJobCompletionDone(order);
  }
  if (isYes(order.stageDelivery) && order.stageDeliveries?.length) {
    return order.stageDeliveries.every((stage) => hasPsbReturnCompletion(file, stage));
  }
  return hasPsbReturnCompletion(file, order);
}

function hasPaymentDueCompletion(file: FileRecord, order: SupplyOrderDetail) {
  return hasFilledString(getPaymentDueCompletionDate(file, order));
}

function getPaymentDueCompletionDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  if (isYes(order.shortclosure)) return order.jobCompletionDate;
  return getNonInspectionPaymentDueDate(file, order);
}

function getPaymentWorkflowStartDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  if (isYes(order.shortclosure)) return order.jobCompletionDate;
  return getNonInspectionPaymentDueDate(file, order);
}

function getNonInspectionPaymentDueDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isGoodsServicesIrNo(file)) return order.jobCompletionDate;
  return addDays(getDeliveryPeriodDate(order), 1);
}

function hasPsbReturnCompletion(file: FileRecord, order: SupplyOrderDetail) {
  return hasFilledString(getPsbReturnCompletionDate(file, order));
}

function getPsbReturnCompletionDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.irReceiptDate;
  return isJobCompletionDone(order)
    ? (getDeliveryPeriodDate(order) ?? "Job Completion")
    : undefined;
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

function isDeliveryInspectionApplicable(file: FileRecord) {
  return isDeliveryInspectionApplicableByGroup(file);
}

function getDeliveryPeriodDate(order: SupplyOrderDetail) {
  return order.revisedDp || order.dpDate;
}

function isDeliveryPeriodValid(file: FileRecord) {
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some((order) => isValidDeliveryPeriodEntry(file, order))
  );
}

function isDeliveryPeriodExpired(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some((order) => isExpiredDeliveryPeriodEntry(file, order))
  );
}

function isDeliveryPeriodExtended(file: FileRecord) {
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some((order) => isExtendedDeliveryPeriodEntry(file, order))
  );
}

function getLaterDate(first: string | undefined, second: string | undefined) {
  const firstTime = parseLocalDateTime(first ?? "");
  const secondTime = parseLocalDateTime(second ?? "");
  if (firstTime === undefined) return second;
  if (secondTime === undefined) return first;
  return secondTime > firstTime ? second : first;
}

function isFileTenderLive(file: FileRecord) {
  return isYes(file.tenderLive);
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
  return isNo(file.bidOpened) && isDateBeforeToday(getEffectiveBidOpeningDate(file));
}

function countPreBidMeetingStatuses(
  files: FileRecord[],
  refloat: boolean,
  state: "due" | "completed",
) {
  return files.filter((file) => isPreBidMeetingStatus(file, refloat, state)).length;
}

function isPreBidMeetingStatus(file: FileRecord, refloat: boolean, state: "due" | "completed") {
  if (!isBiddingApplicableForFile(file)) return false;
  if (isCancelledFile(file)) return false;
  const applies = refloat
    ? isYes(file.refloat) && isYes(file.refloatPreBidMeeting)
    : isYes(file.preBidMeeting);
  const date = refloat ? file.refloatPreBidMeetingDate : file.preBidMeetingDate;
  if (!applies || !hasFilledString(date)) return false;
  return state === "completed" ? isDateBeforeToday(date) : !isDateBeforeToday(date);
}

function hasSupplyOrderDate(order: SupplyOrderDetail) {
  return hasFilledString(order.soDate);
}

function isFinancialSanctionCompletedOrder(order: SupplyOrderDetail) {
  return hasFilledString(order.financialSanctionDate);
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

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
}

function isYes(value: string | undefined) {
  return value?.trim().toLowerCase() === "yes";
}

function isNo(value: string | undefined) {
  return value?.trim().toLowerCase() === "no";
}

function isDateBeforeToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));
  if (dateTime === undefined || todayTime === undefined) return false;
  return dateTime < todayTime;
}

function isDateAfterToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));
  if (dateTime === undefined || todayTime === undefined) return false;
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
