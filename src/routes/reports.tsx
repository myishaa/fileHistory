import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  CircleHelp,
  FileSpreadsheet,
  FileText,
  Lock,
  RotateCcw,
  Save,
  Unlock,
} from "lucide-react";
import {
  fetchMasterFirms,
  fetchFilesForYear,
  fetchMerCashOutgo,
  fetchReportPreferences,
  saveMerCashOutgo,
  saveReportPreferences,
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
import { DateInput } from "@/components/date-input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  isContractFileType,
  isBiddingApplicableForFile,
  isDeliveryInspectionApplicableByGroup,
} from "@/lib/file-type-groups";
import { downloadBackendExport } from "@/lib/export-download";
import {
  advancePaymentEntries,
  countExpectedSupplyOrderRows,
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
  fileCategoryOptions,
  filterFilesByCategory,
  getVisibleFileCategoryKeys,
  getVisibleFileCategoryOptions,
  serializeFileCategories,
  type FileCategoryKey,
} from "@/lib/file-categories";
import {
  buildMmgSummaryRows,
  normalizeMmgSummaryFields,
  type MmgSummaryRow,
} from "@/lib/mmg-summary";
import {
  hasBillReturnHistory,
  hasCompletedBillReturn,
  hasOpenBillReturn,
  hasReturnedBill,
  hasReturnedBillPaid,
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
import { formatThousandsAndLakhs, getInrAmount } from "@/lib/money";
import {
  ALL_ACTIVE_FILES_YEAR,
  displayFinancialYearLabel,
  isActivePlusCurrentFyClosedYear,
  isAllActiveFilesYear,
  isCancelledFile,
} from "@/lib/year-filter";
import {
  calculateFirmRatingScore,
  formatFirmRatingScore,
  normalizeFirmRatingConfig,
} from "@/lib/firm-rating";

export const Route = createFileRoute("/reports")({
  component: ReportsPage,
});

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
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
};

type CashOutGoPlanDetailRow = {
  rowKey: string;
  section: "submitted" | "hand" | "delivered" | "dp" | "dpExpired";
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

type CashOutGoPlanPayload = {
  financialYear: string;
  today: string;
  settings: {
    billOffsetDays: number;
    useCustomBillOffsetDays: boolean;
    handSubmissionOffsetDays: number;
    useCustomHandSubmissionOffsetDays: boolean;
    dpOffsetDays: number;
    useCustomDpOffsetDays: boolean;
  };
  allocation: {
    divisionId: string;
    capital: number;
    revenue: number;
  };
  expenditureTillDate: ExpectedCashOutgoRow[];
  billsSubmitted: CashOutGoPlanDetailRow[];
  billsAtHand: CashOutGoPlanDetailRow[];
  deliveredBillsPending: CashOutGoPlanDetailRow[];
  dpBasedForecast: CashOutGoPlanDetailRow[];
  dpExpired: CashOutGoPlanDetailRow[];
  monthwisePlan: ExpectedCashOutgoRow[];
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

async function fetchCashOutGoPlan(
  financialYear: string,
  includePreviousFySubmitted: boolean,
  divisionId: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    financialYear,
    includePreviousFySubmitted: String(includePreviousFySubmitted),
    divisionId,
  });
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
  const editableRows = [
    ...plan.billsSubmitted,
    ...plan.billsAtHand,
    ...plan.deliveredBillsPending,
    ...(plan.dpBasedForecast ?? []),
    ...(plan.dpExpired ?? []),
  ].map((row) => ({
    rowKey: row.rowKey,
    expectedSentDate: row.expectedSentDateOverride,
    expectedPaymentDate: row.manualExpectedPaymentDate,
    billOffsetOverride: row.billOffsetOverride,
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
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Cash Out Go Plan save failed: ${response.status}`);
  }
}

function ReportsPage() {
  const divisions = useAccessibleDivisions();
  const settings = useSettings();
  const activeUser = useActiveUser();
  const navigate = useNavigate();
  const [selectedDivision, setSelectedDivision] = useState("all");
  const [reportMode, setReportMode] = useState<ReportMode>("mmgSummary");
  const [firmReportSortKey, setFirmReportSortKey] = useState<FirmDatabaseSortKey>("firmName");
  const [firmReportSortDirection, setFirmReportSortDirection] =
    useState<FirmDatabaseSortDirection>("asc");
  const [visibleFirmReportColumns, setVisibleFirmReportColumns] = useState<FirmDatabaseColumnKey[]>(
    defaultFirmDatabaseColumnKeys,
  );
  const [savedFirmReportDefaultColumns, setSavedFirmReportDefaultColumns] = useState<
    FirmDatabaseColumnKey[]
  >(defaultFirmDatabaseColumnKeys);
  const [expandedReportGroups, setExpandedReportGroups] = useState({
    cashOutgo: false,
    supplyOrderDelivery: false,
    monitoring: false,
  });
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
  const [demandAnalysisFilters, setDemandAnalysisFilters] = useState<DemandProcessingFilterRow[]>(
    [],
  );
  const [expectedCashOutgoDays, setExpectedCashOutgoDays] = useState(
    String(DEFAULT_DP_OFFSET_DAYS),
  );
  const [expectedCashOutgoDaysDraft, setExpectedCashOutgoDaysDraft] = useState(
    String(DEFAULT_DP_OFFSET_DAYS),
  );
  const [expectedCashOutgoDaysUnlocked, setExpectedCashOutgoDaysUnlocked] = useState(false);
  const [delayStatusDays, setDelayStatusDays] = useState("5");
  const [delayStatusMilestoneKey, setDelayStatusMilestoneKey] = useState("all");
  const [bgReceiptDelayDays, setBgReceiptDelayDays] = useState(["10", "30", "60"]);
  const [bgReceiptDelayUnlocked, setBgReceiptDelayUnlocked] = useState(false);
  const [warrantyBgBufferDays, setWarrantyBgBufferDays] = useState("60");
  const [warrantyBgBufferUnlocked, setWarrantyBgBufferUnlocked] = useState(false);
  const [monthlyReportBreakupYear, setMonthlyReportBreakupYear] = useState<string | undefined>();
  const [historicalReportFromDate, setHistoricalReportFromDate] = useState(() =>
    getFinancialYearStartDate(settings.selectedYear || settings.financialYear),
  );
  const [historicalReportToDate, setHistoricalReportToDate] = useState(() =>
    formatLocalDate(new Date()),
  );
  const [cashOutgoCurrentFyFilter, setCashOutgoCurrentFyFilter] = useState(false);
  const [cashOutgoDateRangeFilter, setCashOutgoDateRangeFilter] = useState(false);
  const [reportScopeFromDate, setReportScopeFromDate] = useState(() =>
    getFinancialYearStartDate(settings.selectedYear || settings.financialYear),
  );
  const [reportScopeToDate, setReportScopeToDate] = useState(() => formatLocalDate(new Date()));
  const [reportScopeCurrentFyFilter, setReportScopeCurrentFyFilter] = useState(false);
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
  const [cashOutGoPlanIncludePreviousFy, setCashOutGoPlanIncludePreviousFy] = useState(false);
  const [selectedFileCategories, setSelectedFileCategories] =
    useState<FileCategoryKey[]>(allFileCategoryKeys);
  const [selectedFileYear, setSelectedFileYear] = useState("all");
  const [fileYearLocked, setFileYearLocked] = useState(false);
  const [reportsSummary, setReportsSummary] = useState<ReportsSummaryPayload | undefined>();
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
  const bgReceiptDelayStorageKey = `recordkeeper:bg-receipt-delay-days:${
    activeUser?.id ?? "anonymous"
  }`;
  const warrantyBgBufferStorageKey = `recordkeeper:warranty-bg-buffer-days:${
    activeUser?.id ?? "anonymous"
  }`;
  const expectedCashOutgoDaysStorageKey = `recordkeeper:expected-cash-outgo-days:${
    activeUser?.id ?? "anonymous"
  }`;
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
    const saved = window.localStorage.getItem(expectedCashOutgoDaysStorageKey);
    const normalized = normalizeExpectedCashOutgoDays(saved ?? String(DEFAULT_DP_OFFSET_DAYS));
    setExpectedCashOutgoDays(normalized);
    setExpectedCashOutgoDaysDraft(normalized);
    setExpectedCashOutgoDaysUnlocked(false);
  }, [expectedCashOutgoDaysStorageKey]);
  useEffect(() => {
    let active = true;
    fetchReportPreferences<FirmDatabaseReportPreferences>("firmDatabase")
      .then(({ preferences }) => {
        if (!active) return;
        const columns = normalizeFirmDatabaseColumnKeys(preferences.defaultColumns ?? []);
        const nextColumns = columns.length ? columns : defaultFirmDatabaseColumnKeys;
        setSavedFirmReportDefaultColumns(nextColumns);
        setVisibleFirmReportColumns(nextColumns);
      })
      .catch((error) => {
        if (!active) return;
        console.error(error);
        setSavedFirmReportDefaultColumns(defaultFirmDatabaseColumnKeys);
      });
    return () => {
      active = false;
    };
  }, [activeUser?.id]);
  const restoreFirmDatabaseDefaultColumns = () => {
    setVisibleFirmReportColumns(savedFirmReportDefaultColumns);
  };
  const saveFirmDatabaseDefaultColumns = () => {
    const nextColumns = normalizeFirmDatabaseColumnKeys(visibleFirmReportColumns);
    setSavedFirmReportDefaultColumns(nextColumns);
    void saveReportPreferences<FirmDatabaseReportPreferences>("firmDatabase", {
      defaultColumns: nextColumns,
    });
  };
  const toggleWarrantyBgBufferLock = (nextUnlocked: boolean) => {
    if (!nextUnlocked && typeof window !== "undefined") {
      const normalized = normalizeWarrantyBgBufferDays(warrantyBgBufferDays);
      setWarrantyBgBufferDays(normalized);
      window.localStorage.setItem(warrantyBgBufferStorageKey, normalized);
    }
    setWarrantyBgBufferUnlocked(nextUnlocked);
  };
  const saveExpectedCashOutgoDays = () => {
    const normalized = normalizeExpectedCashOutgoDays(expectedCashOutgoDaysDraft);
    setExpectedCashOutgoDays(normalized);
    setExpectedCashOutgoDaysDraft(normalized);
    setExpectedCashOutgoDaysUnlocked(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(expectedCashOutgoDaysStorageKey, normalized);
    }
  };
  const toggleExpectedCashOutgoDaysLock = (nextUnlocked: boolean) => {
    if (nextUnlocked) {
      setExpectedCashOutgoDaysDraft(expectedCashOutgoDays);
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
  const fileYearOptionsKey = fileYearOptions.join("|");
  const fileYearFilterStorageKey = `recordkeeper:file-year-filter:${activeUser?.id ?? "anonymous"}`;
  const activeFileYear =
    selectedFileYear === "all" || fileYearOptions.includes(selectedFileYear)
      ? selectedFileYear
      : "all";
  useEffect(() => {
    if (typeof window === "undefined" || !fileYearOptions.length) return;
    const saved = window.localStorage.getItem(fileYearFilterStorageKey);
    if (!saved) {
      setFileYearLocked(false);
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      const locked = parsed?.locked === true;
      const year = typeof parsed?.year === "string" ? parsed.year : "all";
      setFileYearLocked(locked);
      if (locked) {
        setSelectedFileYear(year === "all" || fileYearOptions.includes(year) ? year : "all");
      }
    } catch {
      setFileYearLocked(false);
    }
  }, [fileYearFilterStorageKey, fileYearOptionsKey, fileYearOptions.length]);
  const updateFileYearSelection = (year: string) => {
    setSelectedFileYear(year);
    if (fileYearLocked && typeof window !== "undefined") {
      window.localStorage.setItem(fileYearFilterStorageKey, JSON.stringify({ locked: true, year }));
    }
  };
  const toggleFileYearLock = () => {
    const nextLocked = !fileYearLocked;
    setFileYearLocked(nextLocked);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        fileYearFilterStorageKey,
        JSON.stringify({ locked: nextLocked, year: activeFileYear }),
      );
    }
  };
  const fileMatchesActiveFileYear = (file: FileRecord) =>
    activeFileYear === "all" || file.year === activeFileYear;
  const expectedCashOutgoOffsetDays = getDelayThresholdDays(expectedCashOutgoDays);
  const delayStatusThresholdDays = getDelayThresholdDays(delayStatusDays);
  const normalizedBgReceiptDelayDays = useMemo(
    () => normalizeBgReceiptDelayDays(bgReceiptDelayDays),
    [bgReceiptDelayDays],
  );
  const normalizedWarrantyBgBufferDays = getDelayThresholdDays(warrantyBgBufferDays) || 60;
  const currentFyFromDate = getFinancialYearStartDate(settings.financialYear);
  const currentFyToDate = formatLocalDate(new Date());
  const optionalCashOutgoDateFilterActive = isOptionalCashOutgoDateFilterReport(reportMode);
  const optionalReportScopeDateFilterActive = isReportScopeDateFilterReport(reportMode);
  const activeHistoricalDateRange = useMemo(() => {
    if (optionalCashOutgoDateFilterActive) {
      if (cashOutgoCurrentFyFilter) {
        return { fromDate: currentFyFromDate, toDate: currentFyToDate };
      }
      if (cashOutgoDateRangeFilter) {
        return { fromDate: historicalReportFromDate, toDate: historicalReportToDate };
      }
      return undefined;
    }
    return isHistoricalDateRangeReport(reportMode)
      ? { fromDate: historicalReportFromDate, toDate: historicalReportToDate }
      : undefined;
  }, [
    cashOutgoCurrentFyFilter,
    cashOutgoDateRangeFilter,
    currentFyFromDate,
    currentFyToDate,
    historicalReportFromDate,
    historicalReportToDate,
    optionalCashOutgoDateFilterActive,
    reportMode,
  ]);
  const activeReportScopeDateRange = useMemo(() => {
    if (!optionalReportScopeDateFilterActive) return undefined;
    if (reportScopeCurrentFyFilter) {
      return { fromDate: currentFyFromDate, toDate: currentFyToDate };
    }
    if (reportScopeDateRangeFilter) {
      return { fromDate: reportScopeFromDate, toDate: reportScopeToDate };
    }
    return undefined;
  }, [
    currentFyFromDate,
    currentFyToDate,
    optionalReportScopeDateFilterActive,
    reportScopeCurrentFyFilter,
    reportScopeDateRangeFilter,
    reportScopeFromDate,
    reportScopeToDate,
  ]);
  const reportsQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("division", activeDivision);
    params.set("fileCategories", serializeFileCategories(selectedFileCategories));
    params.set("delayDays", String(delayStatusThresholdDays));
    params.set("expectedCashOutgoDays", String(expectedCashOutgoOffsetDays));
    params.set("delayMilestone", delayStatusMilestoneKey);
    params.set("selectedYear", settings.selectedYear);
    if (activeFileYear !== "all") params.set("fileYear", activeFileYear);
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
    activeHistoricalDateRange,
    historicalReportFromDate,
    historicalReportToDate,
    reportMode,
    normalizedBgReceiptDelayDays,
    normalizedWarrantyBgBufferDays,
    selectedCashOutgoMonth,
    selectedFileCategories,
    settings.selectedYear,
  ]);

  useEffect(() => {
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
  }, [reportsQuery]);

  useEffect(() => {
    let active = true;
    setMmgLoading(true);
    setMmgError(undefined);
    Promise.all([fetchFilesForYear(settings.selectedYear), fetchFilesForYear("")])
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
  }, [settings.selectedYear]);

  useEffect(() => {
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
  }, []);

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
    if (reportMode !== "cashOutGoPlan") return;
    const controller = new AbortController();
    setCashOutGoPlanLoading(true);
    setCashOutGoPlanError(undefined);
    fetchCashOutGoPlan(
      effectiveFinancialYear,
      cashOutGoPlanIncludePreviousFy,
      activeDivisionId,
      controller.signal,
    )
      .then(({ plan }) => {
        setCashOutGoPlan(plan);
        setCashOutGoPlanSavedSnapshot(getCashOutGoPlanDirtySnapshot(plan));
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
  }, [reportMode, effectiveFinancialYear, cashOutGoPlanIncludePreviousFy, activeDivisionId]);
  useEffect(() => {
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
  }, [effectiveFinancialYear]);
  const mmgFilteredFiles = filterFilesByCategory(
    filterFilesByReceivedDateRange(
      filterMmgFilesByDivision(mmgFiles, activeDivision).filter(fileMatchesActiveFileYear),
      activeReportScopeDateRange,
    ),
    selectedFileCategories,
  );
  const mmgPreviousFilteredFiles = filterFilesByCategory(
    filterFilesByReceivedDateRange(
      filterMmgFilesByDivision(
        mmgPreviousFiles.filter(
          (file) =>
            isPreviousFinancialYearFile(file, effectiveFinancialYear) &&
            fileMatchesActiveFileYear(file),
        ),
        activeDivision,
      ),
      activeReportScopeDateRange,
    ),
    selectedFileCategories,
  );
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
    () => mmgFilteredFiles.filter((file) => !isCancelledFile(file)),
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
  const demandAnalysisRows = useMemo(
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
    capital: readMerAmount(row.capital),
    revenue: readMerAmount(row.revenue),
    total: readMerAmount(row.capital) + readMerAmount(row.revenue),
  }));
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
    if (!merDataDirty) return;
    setMerSaving(true);
    setMerError(undefined);
    saveMerCashOutgo(
      effectiveFinancialYear,
      merDraftRows.map((row) => ({
        monthKey: row.monthKey,
        capital: readMerAmount(row.capital),
        revenue: readMerAmount(row.revenue),
      })),
    )
      .then(({ rows }) => {
        setMerRows(rows);
        setMerDraftRows(buildMerDraftRows(effectiveFinancialYear, rows));
        setMerEditing(false);
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
    setCashOutGoPlan((plan) =>
      plan
        ? recalculateCashOutGoPlan({
            ...plan,
            settings: { ...plan.settings, [field]: nextValue },
          })
        : plan,
    );
  };
  const updateCashOutGoPlanSettingEnabled = (
    field:
      | "useCustomBillOffsetDays"
      | "useCustomHandSubmissionOffsetDays"
      | "useCustomDpOffsetDays",
    value: boolean,
  ) => {
    setCashOutGoPlan((plan) =>
      plan
        ? recalculateCashOutGoPlan({
            ...plan,
            settings: { ...plan.settings, [field]: value },
          })
        : plan,
    );
  };
  const resetCashOutGoPlanOffset = (
    field: "billOffsetDays" | "handSubmissionOffsetDays" | "dpOffsetDays",
  ) => {
    const resetMap = {
      billOffsetDays: {
        value: DEFAULT_BILL_PAYMENT_OFFSET_DAYS,
        enabledField: "useCustomBillOffsetDays",
      },
      handSubmissionOffsetDays: {
        value: DEFAULT_BILL_SUBMISSION_OFFSET_DAYS,
        enabledField: "useCustomHandSubmissionOffsetDays",
      },
      dpOffsetDays: {
        value: DEFAULT_DP_OFFSET_DAYS,
        enabledField: "useCustomDpOffsetDays",
      },
    } as const;
    const reset = resetMap[field];
    setCashOutGoPlan((plan) =>
      plan
        ? recalculateCashOutGoPlan({
            ...plan,
            settings: {
              ...plan.settings,
              [field]: reset.value,
              [reset.enabledField]: false,
            },
          })
        : plan,
    );
  };
  const updateCashOutGoPlanRow = (
    rowKey: string,
    field: "expectedSentDate" | "billOffsetOverride" | "manualExpectedPaymentDate",
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
              }
            : row,
        );
      return recalculateCashOutGoPlan({
        ...plan,
        billsSubmitted: updateRows(plan.billsSubmitted),
        billsAtHand: updateRows(plan.billsAtHand),
        deliveredBillsPending: updateRows(plan.deliveredBillsPending),
        dpBasedForecast: updateRows(plan.dpBasedForecast ?? []),
        dpExpired: updateRows(plan.dpExpired ?? []),
      });
    });
  };
  const persistCashOutGoPlan = () => {
    if (!cashOutGoPlan || !cashOutGoPlanDirty) return;
    setCashOutGoPlanSaving(true);
    setCashOutGoPlanError(undefined);
    saveCashOutGoPlan(cashOutGoPlan)
      .then(() =>
        fetchCashOutGoPlan(
          effectiveFinancialYear,
          cashOutGoPlanIncludePreviousFy,
          activeDivisionId,
        ).then(({ plan }) => {
          setCashOutGoPlan(plan);
          setCashOutGoPlanSavedSnapshot(getCashOutGoPlanDirtySnapshot(plan));
        }),
      )
      .catch((error: unknown) => {
        setCashOutGoPlanError(
          error instanceof Error ? error.message : "Cash Out Go Plan could not be saved.",
        );
      })
      .finally(() => setCashOutGoPlanSaving(false));
  };
  const monitoringSourceFiles = filterFilesByCategory(
    filterMmgFilesByDivision(mmgFiles, activeDivision).filter(fileMatchesActiveFileYear),
    selectedFileCategories,
  );
  const pendingLiabilityAgeingRows = useMemo(
    () => getPendingLiabilityAgeingRows(monitoringSourceFiles, historicalReportToDate),
    [historicalReportToDate, monitoringSourceFiles],
  );
  const selectedCashOutgoRows = getRowsForReportMode(reportMode, {
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
  });
  const selectedMonthlyReport = getMonthlyReportConfig(reportMode, reportsSummary);
  const selectedMonthlyReportColumns =
    selectedMonthlyReport && monthlyReportBreakupYear && selectedMonthlyReport.monthRowsByYear
      ? selectedMonthlyReport.columns
      : (selectedMonthlyReport?.yearColumns ?? selectedMonthlyReport?.columns);
  const selectedMonthlyReportRows =
    selectedMonthlyReport && monthlyReportBreakupYear && selectedMonthlyReport.monthRowsByYear
      ? (selectedMonthlyReport.monthRowsByYear[monthlyReportBreakupYear] ?? [])
      : (selectedMonthlyReport?.yearRows ?? selectedMonthlyReport?.rows);
  useEffect(() => {
    setMonthlyReportBreakupYear(undefined);
  }, [reportMode, settings.selectedYear]);
  useEffect(() => {
    if (
      monthlyReportBreakupYear &&
      selectedMonthlyReport?.monthRowsByYear &&
      !selectedMonthlyReport.monthRowsByYear[monthlyReportBreakupYear]
    ) {
      setMonthlyReportBreakupYear(undefined);
    }
  }, [monthlyReportBreakupYear, selectedMonthlyReport?.monthRowsByYear]);
  const reportTitle = getEightReportTitle(reportMode, {
    today:
      isHistoricalDateRangeReport(reportMode) || isAsOnDateReport(reportMode)
        ? historicalReportToDate
        : today,
    monthKey: isMonthSelectionReport(reportMode) ? selectedCashOutgoMonth : currentMonthKey,
    financialYear: effectiveFinancialYear,
  });
  const reportTitleWithDivision =
    activeDivision === "all"
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
    cashOutgoCurrentFyFilter,
    cashOutgoDateRangeFilter,
    currentFinancialYear: settings.financialYear,
    globalYear: settings.selectedYear,
  });
  const cashOutgoEmptyMessage =
    reportMode === "merData"
      ? "No MER data found."
      : reportMode === "billsPaidInMonth"
        ? "No bills paid found for the selected month."
        : "No expected cash outgo rows found.";
  const exportCashOutgoPdf = () =>
    reportMode === "merData"
      ? printExpectedCashOutgoToPdf(
          merExportRows,
          selectedReportTitle,
          reportLogic,
          cashOutgoEmptyMessage,
        )
      : reportMode === "currentMonthLiability"
        ? printCurrentLiabilityToPdf(selectedCashOutgoRows, selectedReportTitle, reportLogic)
        : printExpectedCashOutgoToPdf(
            selectedCashOutgoRows,
            selectedReportTitle,
            reportLogic,
            cashOutgoEmptyMessage,
          );
  const exportCashOutgoExcel = () =>
    reportMode === "merData"
      ? exportExpectedCashOutgoToExcel(
          merExportRows,
          selectedReportTitle,
          reportLogic,
          cashOutgoEmptyMessage,
        )
      : reportMode === "currentMonthLiability"
        ? exportCurrentLiabilityToExcel(selectedCashOutgoRows, selectedReportTitle, reportLogic)
        : exportExpectedCashOutgoToExcel(
            selectedCashOutgoRows,
            selectedReportTitle,
            reportLogic,
            cashOutgoEmptyMessage,
          );
  const exportMmgSummaryPdf = () => exportMmgSummary(mmgSummaryRows, selectedReportTitle, "pdf");
  const exportMmgSummaryExcel = () =>
    exportMmgSummary(mmgSummaryRows, selectedReportTitle, "excel");
  const exportDelayStatusPdf = () => printDelayStatusToPdf(delayStatusRows, selectedReportTitle);
  const exportDelayStatusExcel = () =>
    exportDelayStatusToExcel(delayStatusRows, selectedReportTitle);
  const exportFirmDatabasePdf = () =>
    exportFirmDatabaseReport(
      firmDatabaseRows,
      visibleFirmReportColumns,
      selectedReportTitle,
      "pdf",
    );
  const exportFirmDatabaseExcel = () =>
    exportFirmDatabaseReport(
      firmDatabaseRows,
      visibleFirmReportColumns,
      selectedReportTitle,
      "excel",
    );
  const selectedReportMode = reportModes.find((mode) => mode.key === reportMode) ?? reportModes[0];
  const historicalDateRangeControls = isHistoricalDateRangeReport(reportMode)
    ? optionalCashOutgoDateFilterActive
      ? {
          fromDate: historicalReportFromDate,
          toDate: historicalReportToDate,
          onFromDateChange: setHistoricalReportFromDate,
          onToDateChange: setHistoricalReportToDate,
          currentFyEnabled: cashOutgoCurrentFyFilter,
          dateRangeEnabled: cashOutgoDateRangeFilter,
          currentFyLabel: `Current FY (${displayFinancialYearLabel(settings.financialYear)})`,
          onCurrentFyEnabledChange: (checked: boolean) => {
            setCashOutgoCurrentFyFilter(checked);
            if (checked) setCashOutgoDateRangeFilter(false);
          },
          onDateRangeEnabledChange: (checked: boolean) => {
            setCashOutgoDateRangeFilter(checked);
            if (checked) setCashOutgoCurrentFyFilter(false);
          },
        }
      : {
          fromDate: historicalReportFromDate,
          toDate: historicalReportToDate,
          onFromDateChange: setHistoricalReportFromDate,
          onToDateChange: setHistoricalReportToDate,
        }
    : undefined;
  const reportScopeDateRangeControls = optionalReportScopeDateFilterActive
    ? {
        fromDate: reportScopeFromDate,
        toDate: reportScopeToDate,
        onFromDateChange: setReportScopeFromDate,
        onToDateChange: setReportScopeToDate,
        currentFyEnabled: reportScopeCurrentFyFilter,
        dateRangeEnabled: reportScopeDateRangeFilter,
        currentFyLabel: `Current FY (${displayFinancialYearLabel(settings.financialYear)})`,
        onCurrentFyEnabledChange: (checked: boolean) => {
          setReportScopeCurrentFyFilter(checked);
          if (checked) setReportScopeDateRangeFilter(false);
        },
        onDateRangeEnabledChange: (checked: boolean) => {
          setReportScopeDateRangeFilter(checked);
          if (checked) setReportScopeCurrentFyFilter(false);
        },
      }
    : undefined;
  const monthSelectionControls = isMonthSelectionReport(reportMode)
    ? {
        month: selectedCashOutgoMonth,
        options: cashOutgoMonthOptions,
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
        fileCategories: serializeFileCategories(selectedFileCategories),
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        selectedYear: getCashOutgoSearchYear(mode),
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
        fileCategories: serializeFileCategories(selectedFileCategories),
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
      },
    });
  };
  const openMonthlyReportSearch = (dashboardFilter: string) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: serializeFileCategories(selectedFileCategories),
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
      },
    });
  };
  const openDelayStatusSearch = (milestoneKey = delayStatusMilestoneKey) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter: getDelayStatusDashboardFilter(delayStatusThresholdDays, milestoneKey),
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: serializeFileCategories(selectedFileCategories),
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
      },
    });
  };
  const openBiddingDelayBreakupSearch = (breakupKey: string) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `biddingDelay:${delayStatusThresholdDays}:${breakupKey}`,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: serializeFileCategories(selectedFileCategories),
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
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
        fileCategories: serializeFileCategories(selectedFileCategories),
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        focusSection: "Supply order and payment",
        focusTarget: rows[0]?.sourceFocusTarget || getFallbackCashOutGoPlanFocusTarget(rows[0]),
        focusTargets: serializeCashOutGoPlanFocusTargets(rows),
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
      mode === "reverse" ? demandAnalysisRows.filter((row) => row.gapDays < 0) : demandAnalysisRows;
    const fileIds = Array.from(new Set(rows.map((row) => row.fileId))).filter(Boolean);
    if (!fileIds.length) return;
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `fileIds:${fileIds.map(encodeURIComponent).join(",")}`,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: serializeFileCategories(selectedFileCategories),
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
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
        fileCategories: serializeFileCategories(selectedFileCategories),
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
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
        fileCategories: serializeFileCategories(selectedFileCategories),
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        focusSection: "Supply order and payment",
        focusTarget: "payment:liability",
      },
    });
  };
  const openMmgSummaryFiles = (row: MmgSummaryRow) => {
    const fileIds = row.fileIds ?? [];
    const uniqueFileIds = Array.from(new Set(fileIds.filter(Boolean)));
    if (!uniqueFileIds.length) return;
    const sourceFocus = getMmgSummarySourceFocus(row.key);
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `fileIds:${uniqueFileIds.map(encodeURIComponent).join(",")}`,
        division: activeDivision === "all" ? undefined : activeDivision,
        selectedYear: settings.selectedYear,
        fileCategories: serializeFileCategories(selectedFileCategories),
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        ...sourceFocus,
        focusTargets: serializeMmgSummaryFocusTargets(row.focusTargets),
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
        fileCategories: serializeFileCategories(selectedFileCategories),
        fileYear: activeFileYear === "all" ? undefined : activeFileYear,
        focusSection: "Supply order and payment",
        focusTarget: "payment:liability",
        focusTargets: String(row.focusTargets ?? "") || undefined,
      },
    });
  };
  const toggleFileCategory = (category: FileCategoryKey, checked: boolean) => {
    setSelectedFileCategories((current) =>
      checked
        ? visibleFileCategoryKeys.filter((key) => new Set([...current, category]).has(key))
        : current.filter((key) => key !== category),
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="space-y-2">
            <CollapsibleReportGroup
              title="Supply order & delivery"
              modes={supplyOrderDeliveryReportModes}
              activeMode={reportMode}
              expanded={expandedReportGroups.supplyOrderDelivery}
              onToggle={() => toggleReportGroup("supplyOrderDelivery")}
              onSelect={setReportMode}
            />
            <CollapsibleReportGroup
              title="Cash Outgo"
              modes={cashOutgoReportModes}
              sections={cashOutgoReportGroups}
              hideSectionTitles
              activeMode={reportMode}
              expanded={expandedReportGroups.cashOutgo}
              onToggle={() => toggleReportGroup("cashOutgo")}
              onSelect={setReportMode}
            />
            <CollapsibleReportGroup
              title="Monitoring / Exceptions"
              modes={monitoringReportModes}
              activeMode={reportMode}
              expanded={expandedReportGroups.monitoring}
              onToggle={() => toggleReportGroup("monitoring")}
              onSelect={setReportMode}
            />
            <div className="space-y-1 rounded-md border border-border bg-background/60 p-1.5">
              <ReportModeButton
                mode={mmgReportMode}
                selected={reportMode === mmgReportMode.key}
                onSelect={setReportMode}
              />
              <ReportModeButton
                mode={demandProcessingReportMode}
                selected={reportMode === demandProcessingReportMode.key}
                onSelect={setReportMode}
              />
              <ReportModeButton
                mode={firmDatabaseReportMode}
                selected={reportMode === firmDatabaseReportMode.key}
                onSelect={setReportMode}
              />
            </div>
          </div>
        </aside>
        <div className="min-w-0 space-y-4">
          <div className="rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap items-end gap-3">
              <FileYearFilter
                value={activeFileYear}
                options={fileYearOptions}
                locked={fileYearLocked}
                onChange={updateFileYearSelection}
                onLockToggle={toggleFileYearLock}
              />
              <FileCategoryFilter
                selectedCategories={selectedFileCategories}
                options={visibleFileCategoryOptions}
                onChange={toggleFileCategory}
              />
            </div>
          </div>
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
              rows={demandAnalysisRows}
              stats={demandAnalysisStats}
              rangeRows={demandProcessingRangeRows}
              analysisUnit={demandAnalysisUnit}
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
              visibleColumns={visibleFirmReportColumns}
              onSortKeyChange={setFirmReportSortKey}
              onSortDirectionChange={setFirmReportSortDirection}
              onVisibleColumnsChange={setVisibleFirmReportColumns}
              onRestoreDefaultColumns={restoreFirmDatabaseDefaultColumns}
              onSaveDefaultColumns={saveFirmDatabaseDefaultColumns}
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
              viewMode={
                selectedMonthlyReport.supportsYearDrilldown
                  ? monthlyReportBreakupYear
                    ? "month"
                    : "year"
                  : "month"
              }
              breakupYear={monthlyReportBreakupYear}
              onOpenSearch={openMonthlyReportSearch}
              onYearSelect={
                selectedMonthlyReport.supportsYearDrilldown
                  ? setMonthlyReportBreakupYear
                  : undefined
              }
              onBackToYears={
                selectedMonthlyReport.supportsYearDrilldown
                  ? () => setMonthlyReportBreakupYear(undefined)
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
                  />
                ) : undefined
              }
              onPdf={() =>
                exportMonthlyOperationalReport(
                  selectedReportTitle,
                  selectedMonthlyReport.description,
                  selectedMonthlyReportColumns ?? selectedMonthlyReport.columns,
                  selectedMonthlyReportRows ?? selectedMonthlyReport.rows,
                  "pdf",
                )
              }
              onExcel={() =>
                exportMonthlyOperationalReport(
                  selectedReportTitle,
                  selectedMonthlyReport.description,
                  selectedMonthlyReportColumns ?? selectedMonthlyReport.columns,
                  selectedMonthlyReportRows ?? selectedMonthlyReport.rows,
                  "excel",
                )
              }
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
              description="Unpaid liabilities grouped by delivery/job completion, bill preparation or bill sent trigger."
              columns={ageingReportColumns}
              rows={pendingLiabilityAgeingRows}
              controls={
                <AsOnDateControl
                  date={historicalReportToDate}
                  onDateChange={setHistoricalReportToDate}
                />
              }
              onOpenSearch={(filter) => {
                const row = pendingLiabilityAgeingRows.find(
                  (item) => item.dashboardFilter === filter,
                );
                if (row) openAgeingSearch(row);
              }}
              onPdf={() =>
                exportMonthlyOperationalReport(
                  selectedReportTitle,
                  "Unpaid liabilities grouped by delivery/job completion, bill preparation or bill sent trigger.",
                  ageingReportColumns,
                  pendingLiabilityAgeingRows,
                  "pdf",
                )
              }
              onExcel={() =>
                exportMonthlyOperationalReport(
                  selectedReportTitle,
                  "Unpaid liabilities grouped by delivery/job completion, bill preparation or bill sent trigger.",
                  ageingReportColumns,
                  pendingLiabilityAgeingRows,
                  "excel",
                )
              }
            />
          ) : reportMode === "merData" ? (
            <MerDataReport
              rows={merDraftRows}
              title={reportTitle}
              financialYear={effectiveFinancialYear}
              loading={merLoading}
              saving={merSaving}
              editing={merEditing}
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
              onEdit={() => setMerEditing(true)}
              onCancel={resetMerDraftRows}
              onSave={saveMerRows}
              onAmountChange={updateMerDraftAmount}
            />
          ) : reportMode === "cashOutGoPlan" ? (
            <CashOutGoPlanReport
              plan={cashOutGoPlan}
              loading={cashOutGoPlanLoading}
              saving={cashOutGoPlanSaving}
              dirty={cashOutGoPlanDirty}
              error={cashOutGoPlanError}
              includePreviousFy={cashOutGoPlanIncludePreviousFy}
              onIncludePreviousFyChange={setCashOutGoPlanIncludePreviousFy}
              onSettingChange={updateCashOutGoPlanSettings}
              onSettingEnabledChange={updateCashOutGoPlanSettingEnabled}
              onOffsetReset={resetCashOutGoPlanOffset}
              onRowChange={updateCashOutGoPlanRow}
              onOpenSourceFile={openCashOutGoPlanSource}
              onOpenRowsSearch={openCashOutGoPlanRowsSearch}
              divisions={divisions}
              activeDivision={activeDivision}
              onDivisionChange={setSelectedDivision}
              onSave={persistCashOutGoPlan}
              saveDisabled={!cashOutGoPlanDirty}
              onPdf={() => cashOutGoPlan && exportCashOutGoPlan(cashOutGoPlan, "pdf")}
              onExcel={() => cashOutGoPlan && exportCashOutGoPlan(cashOutGoPlan, "excel")}
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
              onDaysChange={setExpectedCashOutgoDaysDraft}
              onSelectedDaysUnlockedChange={toggleExpectedCashOutgoDaysLock}
              onSelectedDaysSave={saveExpectedCashOutgoDays}
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
              onDaysChange={setExpectedCashOutgoDaysDraft}
              onSelectedDaysUnlockedChange={toggleExpectedCashOutgoDaysLock}
              onSelectedDaysSave={saveExpectedCashOutgoDays}
              monthSelection={monthSelectionControls}
              onOpenMonth={(monthKey) => openCashOutgoSearch("expectedReceiptThrough", monthKey)}
              onOpenAll={() =>
                openCashOutgoSearchWithContext(
                  "expectedReceiptThrough",
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
              onDaysChange={setExpectedCashOutgoDaysDraft}
              onSelectedDaysUnlockedChange={toggleExpectedCashOutgoDaysLock}
              onSelectedDaysSave={saveExpectedCashOutgoDays}
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
              onDaysChange={setExpectedCashOutgoDaysDraft}
              onSelectedDaysUnlockedChange={toggleExpectedCashOutgoDaysLock}
              onSelectedDaysSave={saveExpectedCashOutgoDays}
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
  | "cashOutGoPlan"
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
  { key: "cashOutGoPlan", label: "Cash Out Go Plan" },
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
  { key: "returnedBillsResubmitted", label: "Returned bills resubmitted" },
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
  { key: "monthWiseDeliverySchedule", label: "Month-wise Delivery Schedule" },
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
const supplementaryBillInclusionNotes = {
  itemsDeliveredBillsPrepared:
    "Includes returned supplementary bills pending correction/resubmission.",
  billsSubmitted: "Includes supplementary bills sent/resubmitted to PCDA and unpaid.",
  spentTillDateFy:
    "Includes paid supplementary bills by payment date.\nFor past months, entered MER values still override app-entered actuals.",
  billsPaidInMonth: "Includes paid supplementary bills through Actual Cash Outgo by payment date.",
  currentMonthLiability: "Includes supplementary bills that are submitted/resubmitted and unpaid.",
  cashOutgoForMonth: "Includes supplementary bills expected to be paid.",
  expectedExpenditureTillMonth: "Includes supplementary bills submitted/resubmitted/returned.",
} satisfies Partial<Record<ReportMode, string>>;
const reportModeHelperText = {
  supplementaryBillsPaid: "Returned and paid supplementary bills included.",
} satisfies Partial<Record<ReportMode, string>>;
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
const mmgReportMode = reportModes[0];
const demandProcessingReportMode = reportModes[1];
const firmDatabaseReportMode = reportModes[2];
const cashOutgoReportGroups: ReadonlyArray<ReportModeSection> = [
  {
    title: "MER",
    modes: getReportModeOptions(["merData", "cashOutGoPlan"]),
  },
  {
    title: "Billing / payment pending liability",
    modes: getReportModeOptions([
      "itemsDeliveredBillsPending",
      "itemsDeliveredBillsPrepared",
      "billsSubmitted",
      "currentMonthLiability",
    ]),
    summaryKeys: ["currentMonthLiability"],
  },
  {
    title: "Cash outgo / expected expenditure",
    modes: getReportModeOptions([
      "spentTillDateFy",
      "cashOutgoForMonth",
      "expectedExpenditureTillMonth",
    ]),
    summaryKeys: ["expectedExpenditureTillMonth"],
  },
  {
    title: "D.P.-based expected liability",
    modes: getReportModeOptions(["expectedCashOutgoFy"]),
  },
  {
    title: "Paid bills",
    modes: getReportModeOptions(["billsPaidInMonth"]),
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
const biddingDelayMilestoneLabel = "Bidding Delay";
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
};

type FirmDatabaseRow = Record<FirmDatabaseColumnKey, string | number> & {
  id: string;
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
  { key: "divisions", label: "Division names", group: "Risk / coverage" },
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
  const helperText = reportModeHelperText[mode.key];
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
      {helperText ? (
        <FloatingHelper
          text={helperText}
          label={`${mode.label} note`}
          className="size-8 shrink-0"
          iconClassName="size-3.5"
        />
      ) : null}
    </div>
  );
}

function CollapsibleReportGroup({
  title,
  modes,
  sections,
  activeMode,
  expanded,
  onToggle,
  onSelect,
  hideSectionTitles = false,
}: {
  title: string;
  modes: ReadonlyArray<ReportModeOption>;
  sections?: ReadonlyArray<ReportModeSection>;
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
        </div>
      ) : null}
    </div>
  );
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
  const withFirmName = columns.includes("firmName") ? columns : ["firmName", ...columns];
  return firmDatabaseColumns
    .map((column) => column.key)
    .filter((key) => new Set(withFirmName).has(key));
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
): mode is Extract<ReturnedBillCashOutgoMode, ReportMode> {
  return (
    mode === "pendingReturnedBills" ||
    mode === "returnedBillsResubmitted" ||
    mode === "returnedBillsPaid"
  );
}

function isReportScopeDateFilterReport(mode: ReportMode) {
  return mode === "mmgSummary" || mode === "demandProcessingAnalysis" || mode === "firmDatabase";
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
  if (mode === "returnedBillsResubmitted") return `Returned bills resubmitted as on ${asOnDate}`;
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
  if (mode === "monthWiseDeliverySchedule") return "Month-wise Delivery Schedule";
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
    return "Based on Chequeslips";
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

function getBillingPaymentReportDescription(
  mode: ReportMode,
  context: {
    activeHistoricalDateRange?: { fromDate: string; toDate: string };
    cashOutgoCurrentFyFilter: boolean;
    cashOutgoDateRangeFilter: boolean;
    currentFinancialYear: string;
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
              ? "Returned bill resubmitted"
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
  const scope = context.cashOutgoCurrentFyFilter
    ? `in Current FY ${displayFinancialYearLabel(context.currentFinancialYear)}`
    : context.cashOutgoDateRangeFilter && context.activeHistoricalDateRange
      ? `from ${formatDateDisplay(context.activeHistoricalDateRange.fromDate)} to ${formatDateDisplay(
          context.activeHistoricalDateRange.toDate,
        )}`
      : isAllActiveFilesYear(context.globalYear) ||
          isActivePlusCurrentFyClosedYear(context.globalYear)
        ? ""
        : "as per global filter";
  if (!scope) return "";
  const subfilterActive = context.cashOutgoCurrentFyFilter || context.cashOutgoDateRangeFilter;
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
      ...getYearDrilldownConfig(rows, columns, "fileInflowYear"),
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
      ...getYearDrilldownConfig(rows, columns, "supplyOrderYear"),
    };
  }
  if (mode === "monthWiseDeliverySchedule") {
    const columns: MonthlyReportColumn[] = [
      monthLabelColumn,
      {
        key: "grossCount",
        label: "D.P. expiring",
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
        label: "Net pending",
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
      ...getYearDrilldownConfig(rows, columns, "deliveryScheduleYear"),
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
      ...getYearDrilldownConfig(rows, columns, "completedDeliveryYear"),
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
      ...getYearDrilldownConfig(rows, columns, "bgExpiryYear"),
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
        "- Dates before today: Completed.",
        "- Dates today or later: Due.",
        "- Blank applicable dates: Suspected Anomaly.",
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
        "- PSB: uses S.O. date.",
        "- AMC/MPC/O&M warranty BGs: use S.O. date.",
        "- Physical delivery PWB/PSB+PWB: uses Material Receipt Date.",
        "- Goods & Services IR No with stages: starts after all stages are job-completed.",
        "- Final stage basis: latest stage Job Completion Date.",
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

function getYearDrilldownConfig(
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
    const year = monthKey.slice(0, 4);
    if (!/^\d{4}$/.test(year)) return;
    byYear.set(year, [...(byYear.get(year) ?? []), row]);
  });
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
    { key: "year", label: "Year", align: "left" },
    ...numericColumns.map((column) => ({
      ...column,
      getFilter: (row: Record<string, number | string>) =>
        getYearDashboardFilter(yearFilterPrefix, column.key, String(row.yearKey ?? "")),
    })),
  ];
  return {
    supportsYearDrilldown: true,
    yearColumns,
    yearRows,
    monthRowsByYear: Object.fromEntries(byYear.entries()),
  };
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
  if (prefix === "preBidMeetingFy") {
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
  return undefined;
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

function readNumericCell(value: number | string | undefined) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

type DemandProcessingStats = {
  count: number;
  unitCount: number;
  average: number;
  median: number;
  min: number;
  max: number;
  negative: number;
};
type DemandProcessingAnalysisUnit = "demand" | "order" | "stage" | "advance";
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
      getValue: ({ file }) => file.demandDescription,
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
  return { file, order, stage };
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
  rows,
  stats,
  rangeRows,
  analysisUnit,
  filters,
  filterFields,
  actions,
  onPresetChange,
  onFromFieldChange,
  onToFieldChange,
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
  rows: DemandProcessingAnalysisRow[];
  stats: DemandProcessingStats;
  rangeRows: DemandProcessingRangeRow[];
  analysisUnit: DemandProcessingAnalysisUnit;
  filters: DemandProcessingFilterRow[];
  filterFields: DemandProcessingFilterField[];
  actions?: ReactNode;
  onPresetChange: (presetId: string) => void;
  onFromFieldChange: (fieldId: string) => void;
  onToFieldChange: (fieldId: string) => void;
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
  return (
    <div className="rounded-md border border-border bg-card shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Average date gap calculated from records where both selected dates are filled.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[260px_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>Preset</span>
            <select
              value={selectedPresetId}
              onChange={(event) => onPresetChange(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="">Custom selection</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <DemandDateFieldSelector
            label="From date"
            value={fromFieldId}
            onChange={onFromFieldChange}
          />
          <DemandDateFieldSelector label="To date" value={toFieldId} onChange={onToFieldChange} />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <DemandMetric
            label={getAnalysisUnitCountLabel(analysisUnit)}
            value={stats.unitCount}
            onClick={onOpenUsed}
          />
          <DemandMetric label="Average days" value={formatGapNumber(stats.average)} />
          <DemandMetric label="Median days" value={formatGapNumber(stats.median)} />
          <DemandMetric label="Minimum" value={formatGapNumber(stats.min)} />
          <DemandMetric label="Maximum" value={formatGapNumber(stats.max)} />
          <DemandMetric
            label="Reverse dates"
            value={stats.negative}
            onClick={stats.negative ? onOpenReverse : undefined}
          />
        </div>

        <DemandProcessingRangeSummary
          rows={rangeRows}
          analysisUnit={analysisUnit}
          onOpenRange={onOpenRange}
        />

        <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
          Basis: {getAnalysisBasisLabel(fromField?.scope, toField?.scope)}. Selected gap:{" "}
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
  onChange,
}: {
  label: string;
  value: string;
  onChange: (fieldId: string) => void;
}) {
  const groups = getDemandProcessingFieldGroups();
  const selectedField = getDemandProcessingField(value);
  return (
    <div className="rounded-md border border-border bg-background">
      <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
        {label}: <span className="text-foreground">{selectedField?.label ?? "Select date"}</span>
      </div>
      <div className="max-h-72 overflow-y-auto p-2">
        {groups.map((group) => (
          <details key={`${label}:${group.title}`} className="group rounded-md">
            <summary className="cursor-pointer rounded px-2 py-1.5 text-sm font-bold uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-foreground">
              {group.title}
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
  onOpenRange,
}: {
  rows: DemandProcessingRangeRow[];
  analysisUnit: DemandProcessingAnalysisUnit;
  onOpenRange: (row: DemandProcessingRangeRow) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="mb-2">
        <h3 className="text-base font-bold">{getAnalysisUnitBucketTitle(analysisUnit)}</h3>
        <p className="text-xs text-muted-foreground">
          Each {getAnalysisUnitNoun(analysisUnit)} is counted once using its maximum gap days.
        </p>
      </div>
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
}: {
  label: string;
  value: ReactNode;
  onClick?: () => void;
}) {
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
    return { count: 0, unitCount: 0, average: 0, median: 0, min: 0, max: 0, negative: 0 };
  }
  const gaps = rows.map((row) => row.gapDays).sort((a, b) => a - b);
  const sum = gaps.reduce((total, gap) => total + gap, 0);
  const middle = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 0 ? (gaps[middle - 1] + gaps[middle]) / 2 : gaps[middle];
  return {
    count: rows.length,
    unitCount: new Set(rows.map((row) => getDemandProcessingUnitKey(row, analysisUnit))).size,
    average: sum / rows.length,
    median,
    min: gaps[0],
    max: gaps[gaps.length - 1],
    negative: rows.filter((row) => row.gapDays < 0).length,
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
    .filter((range): range is DemandProcessingDayRange => Boolean(range));
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
  if (fromScope === "stage" || toScope === "stage") return "stage-wise";
  if (fromScope === "advance" || toScope === "advance") return "advance-payment-wise";
  if (fromScope === "order" || toScope === "order") return "S.O.-wise";
  return "file-wise";
}

function getDemandProcessingAnalysisUnit(fromFieldId: string, toFieldId: string) {
  const fromScope = getDemandProcessingField(fromFieldId)?.scope;
  const toScope = getDemandProcessingField(toFieldId)?.scope;
  if (fromScope === "stage" || toScope === "stage") return "stage";
  if (fromScope === "advance" || toScope === "advance") return "advance";
  if (fromScope === "order" || toScope === "order") return "order";
  return "demand";
}

function getAnalysisUnitCountLabel(unit: DemandProcessingAnalysisUnit) {
  if (unit === "stage") return "No. of Stages";
  if (unit === "advance") return "No. of Advance Payments";
  if (unit === "order") return "No. of S.O.s";
  return "No. of Demands";
}

function getAnalysisUnitBucketTitle(unit: DemandProcessingAnalysisUnit) {
  if (unit === "stage") return "Stage age buckets";
  if (unit === "advance") return "Advance payment age buckets";
  if (unit === "order") return "S.O. age buckets";
  return "Demand age buckets";
}

function getAnalysisUnitNoun(unit: DemandProcessingAnalysisUnit) {
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
  onDaysChange,
  onSelectedDaysUnlockedChange,
  onSelectedDaysSave,
  dateRange,
  monthSelection,
  emptyMessage = "No expected cash outgo rows found.",
  onOpenMonth,
  onOpenAll,
}: {
  rows: ExpectedCashOutgoRow[];
  title: string;
  titleHelper?: string;
  description: string;
  actions: ReactNode;
  selectedDays?: string;
  selectedDaysUnlocked?: boolean;
  onDaysChange?: (value: string) => void;
  onSelectedDaysUnlockedChange?: (unlocked: boolean) => void;
  onSelectedDaysSave?: () => void;
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
              unlocked={selectedDaysUnlocked}
              onValueChange={onDaysChange}
              onUnlockedChange={onSelectedDaysUnlockedChange}
              onSave={onSelectedDaysSave}
            />
          ) : null}
        </>
      }
    />
  );
}

type HistoricalDateRangeControlsProps = {
  fromDate: string;
  toDate: string;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  currentFyEnabled?: boolean;
  dateRangeEnabled?: boolean;
  currentFyLabel?: string;
  onCurrentFyEnabledChange?: (checked: boolean) => void;
  onDateRangeEnabledChange?: (checked: boolean) => void;
};

type MonthSelectionControlsProps = {
  month: string;
  options: Array<{ value: string; label: string }>;
  onMonthChange: (value: string) => void;
};

function MonthSelectionControls({ month, options, onMonthChange }: MonthSelectionControlsProps) {
  return (
    <label className="flex w-40 flex-col gap-1 text-xs text-muted-foreground">
      <span>Month</span>
      <select
        value={month}
        onChange={(event) => onMonthChange(event.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
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
  onDateChange,
}: {
  date: string;
  onDateChange: (value: string) => void;
}) {
  return (
    <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
      <span>As on date</span>
      <DateInput
        value={date}
        onChange={(value) => {
          if (value) onDateChange(value);
        }}
        className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  );
}

function HistoricalDateRangeControls({
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  currentFyEnabled,
  dateRangeEnabled,
  currentFyLabel = "Current FY",
  onCurrentFyEnabledChange,
  onDateRangeEnabledChange,
}: HistoricalDateRangeControlsProps) {
  const optionalMode = Boolean(onCurrentFyEnabledChange || onDateRangeEnabledChange);
  const inputsDisabled = optionalMode && !dateRangeEnabled;
  return (
    <>
      {optionalMode ? (
        <div className="flex min-h-9 items-center gap-3 rounded-md border border-border bg-secondary/20 px-3 text-xs font-medium text-foreground">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={Boolean(currentFyEnabled)}
              onChange={(event) => onCurrentFyEnabledChange?.(event.target.checked)}
              className="size-3.5 rounded border-input"
            />
            {currentFyLabel}
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={Boolean(dateRangeEnabled)}
              onChange={(event) => onDateRangeEnabledChange?.(event.target.checked)}
              className="size-3.5 rounded border-input"
            />
            Date range
          </label>
        </div>
      ) : null}
      <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
        <span>From</span>
        <DateInput
          value={fromDate}
          max={toDate}
          disabled={inputsDisabled}
          onChange={(value) => {
            if (value) onFromDateChange(value);
          }}
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
        />
      </label>
      <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
        <span>To</span>
        <DateInput
          value={toDate}
          min={fromDate}
          disabled={inputsDisabled}
          onChange={(value) => {
            if (value) onToDateChange(value);
          }}
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
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
  onDaysChange,
  onSelectedDaysUnlockedChange,
  onSelectedDaysSave,
  monthSelection,
  onOpenMonth,
  onOpenAll,
}: {
  rows: ExpectedCashOutgoRow[];
  title: string;
  titleHelper?: string;
  description: string;
  actions: ReactNode;
  selectedDays: string;
  selectedDaysUnlocked: boolean;
  onDaysChange: (value: string) => void;
  onSelectedDaysUnlockedChange: (unlocked: boolean) => void;
  onSelectedDaysSave: () => void;
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
            unlocked={selectedDaysUnlocked}
            onValueChange={onDaysChange}
            onUnlockedChange={onSelectedDaysUnlockedChange}
            onSave={onSelectedDaysSave}
          />
        </>
      }
    />
  );
}

function CashOutgoOffsetDaysControl({
  value,
  unlocked,
  onValueChange,
  onUnlockedChange,
  onSave,
}: {
  value: string;
  unlocked: boolean;
  onValueChange: (value: string) => void;
  onUnlockedChange?: (unlocked: boolean) => void;
  onSave?: () => void;
}) {
  const normalizedDays = normalizeExpectedCashOutgoDays(value);
  return (
    <div className="text-xs font-medium">
      <span className="mb-1 block text-muted-foreground">Days after base date</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          min="0"
          value={unlocked ? value : normalizedDays}
          disabled={!unlocked}
          onChange={(event) => onValueChange(event.target.value)}
          className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-70"
        />
        <button
          type="button"
          onClick={() => onUnlockedChange?.(!unlocked)}
          className="btn-ghost h-9 w-9 p-0"
          title={unlocked ? "Lock offset days" : "Unlock offset days"}
          aria-label={unlocked ? "Lock offset days" : "Unlock offset days"}
        >
          {unlocked ? <Unlock className="size-4" /> : <Lock className="size-4" />}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!unlocked}
          className="btn-ghost h-9 w-9 p-0"
          title="Save offset days"
          aria-label="Save offset days"
        >
          <Save className="size-4" />
        </button>
      </span>
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
  const updateDay = (index: number, value: string) => {
    onDaysChange((current) => {
      const next = [...(current.length ? current : defaultBgReceiptDelayDays)];
      next[index] = value;
      return next;
    });
  };

  return (
    <div className="rounded-md border border-border bg-secondary/20 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
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
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {displayDays.map((day, index) => (
          <label key={index} className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>Threshold {index + 1}</span>
            <input
              type="number"
              min={0}
              value={day}
              disabled={!unlocked}
              onChange={(event) => updateDay(index, event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-70"
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
}: {
  days: string;
  unlocked: boolean;
  onUnlockedChange: (unlocked: boolean) => void;
  onDaysChange: (value: string) => void;
}) {
  const normalizedDays = normalizeWarrantyBgBufferDays(days);
  return (
    <div className="rounded-md border border-border bg-secondary/20 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
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
      </div>
      <label className="flex max-w-48 flex-col gap-1 text-xs text-muted-foreground">
        <span>Buffer days</span>
        <input
          type="number"
          min={0}
          value={days}
          disabled={!unlocked}
          onChange={(event) => onDaysChange(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-70"
        />
      </label>
    </div>
  );
}

function MonthlyOperationalReport({
  title,
  description,
  columns,
  rows,
  viewMode = "month",
  breakupYear,
  onOpenSearch,
  onYearSelect,
  onBackToYears,
  controls,
  onPdf,
  onExcel,
}: {
  title: string;
  description: string;
  columns: MonthlyReportColumn[];
  rows: Array<Record<string, number | string>>;
  viewMode?: MonthlyReportViewMode;
  breakupYear?: string;
  onOpenSearch: (dashboardFilter: string) => void;
  onYearSelect?: (year: string) => void;
  onBackToYears?: () => void;
  controls?: ReactNode;
  onPdf: () => void;
  onExcel: () => void;
}) {
  const totalCells = getMonthlyReportTotalCells(columns, rows, { viewMode, breakupYear });
  const showTotalFooter =
    viewMode === "month" &&
    totalCells.some((cell, index) => index > 0 && cell.filter && cell.value !== "0");
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <ReportDescription description={description} />
        </div>
        <div className="flex flex-wrap gap-2">
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
      {controls ? <div className="mb-5">{controls}</div> : null}
      {viewMode === "month" && onBackToYears ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <ReportBreadcrumb
            items={[
              { label: title },
              { label: "Years", onClick: onBackToYears },
              breakupYear ? { label: breakupYear } : undefined,
            ]}
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border">
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
                      const value = String(row[column.key] ?? "");
                      const filter = column.getFilter?.(row);
                      const totalLabelFilter =
                        columnIndex === 0 && value === "Total"
                          ? getMonthlyReportRowTotalFilter(columns, row)
                          : undefined;
                      const yearKey = String(row.yearKey ?? "");
                      const isYearLabel =
                        viewMode === "year" &&
                        column.key === "year" &&
                        /^\d{4}$/.test(yearKey) &&
                        Boolean(onYearSelect);
                      return (
                        <td
                          key={column.key}
                          className={
                            "px-3 py-2.5 " +
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
                              className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-primary/10"
                            >
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
      </div>
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

function ReportHeaderActions({
  divisions,
  activeDivision,
  onDivisionChange,
  showDivision = true,
  onPdf,
  onExcel,
}: {
  divisions: ReturnType<typeof useAccessibleDivisions>;
  activeDivision: string;
  onDivisionChange: (division: string) => void;
  showDivision?: boolean;
  onPdf?: () => void;
  onExcel?: () => void;
}) {
  return (
    <>
      {showDivision ? (
        <label className="flex min-w-[220px] flex-col gap-1 text-xs text-muted-foreground">
          <span>Division</span>
          <select
            value={activeDivision}
            onChange={(event) => onDivisionChange(event.target.value)}
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
      ) : null}
      {onPdf ? (
        <button
          type="button"
          onClick={onPdf}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
        >
          <FileText className="size-4" />
          PDF
        </button>
      ) : null}
      {onExcel ? (
        <button
          type="button"
          onClick={onExcel}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
        >
          <FileSpreadsheet className="size-4" />
          Excel
        </button>
      ) : null}
    </>
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

function FileYearFilter({
  value,
  options,
  locked,
  onChange,
  onLockToggle,
}: {
  value: string;
  options: string[];
  locked: boolean;
  onChange: (year: string) => void;
  onLockToggle: () => void;
}) {
  return (
    <div className="flex items-end gap-1.5">
      <label className="flex min-w-[160px] flex-col gap-1 text-xs text-muted-foreground">
        <span>File year</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
        >
          <option value="all">All file years</option>
          {options.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={onLockToggle}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent"
        title={locked ? "Unlock file year" : "Lock file year"}
        aria-label={locked ? "Unlock file year" : "Lock file year"}
      >
        {locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
      </button>
    </div>
  );
}

function FirmDatabaseReport({
  title,
  rows,
  loading,
  sortKey,
  sortDirection,
  visibleColumns,
  actions,
  onSortKeyChange,
  onSortDirectionChange,
  onVisibleColumnsChange,
  onRestoreDefaultColumns,
  onSaveDefaultColumns,
  onOpenFiles,
}: {
  title: string;
  rows: FirmDatabaseRow[];
  loading: boolean;
  sortKey: FirmDatabaseSortKey;
  sortDirection: FirmDatabaseSortDirection;
  visibleColumns: FirmDatabaseColumnKey[];
  actions: ReactNode;
  onSortKeyChange: (key: FirmDatabaseSortKey) => void;
  onSortDirectionChange: (direction: FirmDatabaseSortDirection) => void;
  onVisibleColumnsChange: (columns: FirmDatabaseColumnKey[]) => void;
  onRestoreDefaultColumns: () => void;
  onSaveDefaultColumns: () => void;
  onOpenFiles: (fileIds: string[]) => void;
}) {
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof firmDatabasePageSizeOptions)[number]>(25);
  const selectedColumns = firmDatabaseColumns.filter((column) =>
    visibleColumns.includes(column.key),
  );
  const groups = Array.from(new Set(firmDatabaseColumns.map((column) => column.group)));
  const summary = getFirmDatabaseSummary(rows);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = rows.length ? (safePage - 1) * pageSize : 0;
  const pageEnd = Math.min(pageStart + pageSize, rows.length);
  const visibleRows = rows.slice(pageStart, pageEnd);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const toggleColumn = (key: FirmDatabaseColumnKey, checked: boolean) => {
    if (key === "firmName") return;
    const next = checked
      ? firmDatabaseColumns
          .map((column) => column.key)
          .filter((columnKey) => new Set([...visibleColumns, key]).has(columnKey))
      : visibleColumns.filter((columnKey) => columnKey !== key);
    onVisibleColumnsChange(next.length ? next : ["firmName"]);
  };

  const setGroup = (group: string, checked: boolean) => {
    const groupKeys = firmDatabaseColumns
      .filter((column) => column.group === group)
      .map((column) => column.key);
    const next = checked
      ? firmDatabaseColumns
          .map((column) => column.key)
          .filter((key) => new Set([...visibleColumns, ...groupKeys]).has(key))
      : visibleColumns.filter((key) => !groupKeys.includes(key) || key === "firmName");
    onVisibleColumnsChange(next.length ? next : ["firmName"]);
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
        <div className="flex flex-wrap items-end justify-end gap-2">{actions}</div>
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
              className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
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
              className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setFieldsOpen((current) => !current)}
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
              className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
            >
              Default fields
            </button>
            <button
              type="button"
              onClick={onSaveDefaultColumns}
              className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
            >
              Save default
            </button>
            <button
              type="button"
              onClick={() =>
                onVisibleColumnsChange(firmDatabaseColumns.map((column) => column.key))
              }
              className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
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
                            disabled={column.key === "firmName"}
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
        onPrevious={() => setPage((current) => Math.max(1, current - 1))}
        onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
      />

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                {selectedColumns.map((column) => (
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
                      return (
                        <td
                          key={column.key}
                          className={
                            "px-3 py-2.5 align-top " +
                            (column.align === "right" ? "text-right tabular-nums" : "text-left")
                          }
                        >
                          {clickable ? (
                            <button
                              type="button"
                              onClick={() => onOpenFiles(clickTarget)}
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
                    colSpan={selectedColumns.length || 1}
                    className="px-3 py-8 text-center text-sm text-muted-foreground"
                  >
                    No firms found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
          onPrevious={() => setPage((current) => Math.max(1, current - 1))}
          onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
        />
      </div>
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
  onPrevious: () => void;
  onNext: () => void;
}) {
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
          <button
            type="button"
            onClick={onNext}
            disabled={safePage >= totalPages}
            className="px-2.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card"
          >
            Next
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
                const clickable = fileIds.length > 0 && Number(row.value) > 0;
                return (
                  <tr key={row.key} className="border-b border-border/70 last:border-0">
                    <td className="px-3 py-2 font-medium">{row.label}</td>
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
  dirty: boolean;
  error?: string;
  actions?: ReactNode;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onAmountChange: (monthKey: string, field: "capital" | "revenue", value: string) => void;
}) {
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
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            Month-wise MER values for FY {displayFinancialYearLabel(financialYear)}.
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2">
          {actions}
          {editing ? (
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
          ) : (
            <button
              type="button"
              onClick={onEdit}
              disabled={loading}
              className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-60"
            >
              Edit
            </button>
          )}
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
                      {editing ? (
                        <MerAmountInput
                          value={row.capital}
                          onChange={(value) => onAmountChange(row.monthKey, "capital", value)}
                        />
                      ) : (
                        formatThousandsAndLakhs(capital)
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {editing ? (
                        <MerAmountInput
                          value={row.revenue}
                          onChange={(value) => onAmountChange(row.monthKey, "revenue", value)}
                        />
                      ) : (
                        formatThousandsAndLakhs(revenue)
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {formatThousandsAndLakhs(capital + revenue)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-border bg-secondary/30 font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right">{formatThousandsAndLakhs(totals.capital)}</td>
                <td className="px-3 py-2 text-right">{formatThousandsAndLakhs(totals.revenue)}</td>
                <td className="px-3 py-2 text-right">{formatThousandsAndLakhs(totals.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MerAmountInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      inputMode="decimal"
      className="h-8 w-36 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring/40"
    />
  );
}

function CashOutGoPlanReport({
  plan,
  loading,
  saving,
  dirty,
  error,
  includePreviousFy,
  onIncludePreviousFyChange,
  onSettingChange,
  onSettingEnabledChange,
  onOffsetReset,
  onRowChange,
  onOpenSourceFile,
  onOpenRowsSearch,
  divisions,
  activeDivision,
  onDivisionChange,
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
  onIncludePreviousFyChange: (value: boolean) => void;
  onSettingChange: (
    field: "billOffsetDays" | "handSubmissionOffsetDays" | "dpOffsetDays",
    value: string,
  ) => void;
  onSettingEnabledChange: (
    field:
      | "useCustomBillOffsetDays"
      | "useCustomHandSubmissionOffsetDays"
      | "useCustomDpOffsetDays",
    value: boolean,
  ) => void;
  onOffsetReset: (field: "billOffsetDays" | "handSubmissionOffsetDays" | "dpOffsetDays") => void;
  onRowChange: (
    rowKey: string,
    field: "expectedSentDate" | "billOffsetOverride" | "manualExpectedPaymentDate",
    value: string,
  ) => void;
  onOpenSourceFile: (row: CashOutGoPlanDetailRow) => void;
  onOpenRowsSearch: (rows: CashOutGoPlanDetailRow[]) => void;
  divisions: Division[];
  activeDivision: string;
  onDivisionChange: (division: string) => void;
  onSave: () => void;
  saveDisabled: boolean;
  onPdf: () => void;
  onExcel: () => void;
}) {
  const totals = getExpectedCashOutgoTotals(plan?.monthwisePlan ?? []);
  const capitalPercent = plan
    ? getCashOutGoAllocationPercent(totals.capital, plan.allocation.capital)
    : "";
  const revenuePercent = plan
    ? getCashOutGoAllocationPercent(totals.revenue, plan.allocation.revenue)
    : "";
  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Cash Out Go Plan</h2>
            <ReportDescription description="Global FY cash-outgo plan using MER for past months and gross forecast values for pending bills." />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" className="btn-ghost h-9 px-3" onClick={onPdf} disabled={!plan}>
              <FileText className="size-4" />
              PDF
            </button>
            <button type="button" className="btn-ghost h-9 px-3" onClick={onExcel} disabled={!plan}>
              <FileSpreadsheet className="size-4" />
              Excel
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="text-xs font-medium">
            <span className="mb-1 block text-muted-foreground">Division</span>
            <select
              value={activeDivision}
              onChange={(event) => onDivisionChange(event.target.value)}
              className="h-9 min-w-40 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="all">All divisions</option>
              {divisions.map((division) => (
                <option key={division.id} value={division.name}>
                  {division.name}
                </option>
              ))}
            </select>
          </div>
          <div className="text-xs font-medium">
            <span className="mb-1 flex items-center gap-1.5 text-muted-foreground">
              Bill submission Offset Days
              <FloatingHelper text="Added to the Bills at Hand base date to calculate the expected sent/resubmission date. Default is 5 days unless Custom is enabled." />
            </span>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min="0"
                value={
                  plan?.settings.useCustomHandSubmissionOffsetDays
                    ? plan.settings.handSubmissionOffsetDays
                    : DEFAULT_BILL_SUBMISSION_OFFSET_DAYS
                }
                onChange={(event) =>
                  onSettingChange("handSubmissionOffsetDays", event.target.value)
                }
                className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
                disabled={!plan || !plan.settings.useCustomHandSubmissionOffsetDays}
              />
              <label className="flex h-9 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={Boolean(plan?.settings.useCustomHandSubmissionOffsetDays)}
                  onChange={(event) =>
                    onSettingEnabledChange(
                      "useCustomHandSubmissionOffsetDays",
                      event.target.checked,
                    )
                  }
                  disabled={!plan}
                />
                Custom
              </label>
              <span className="text-[11px] text-muted-foreground">Default 5</span>
              <button
                type="button"
                className="btn-ghost h-9 w-9 p-0"
                onClick={() => onOffsetReset("handSubmissionOffsetDays")}
                disabled={!plan}
                title="Reset Bill submission Offset Days"
                aria-label="Reset Bill submission Offset Days"
              >
                <RotateCcw className="size-4" />
              </button>
              <button
                type="button"
                className="btn-ghost h-9 w-9 p-0"
                onClick={onSave}
                disabled={!plan || saving || !dirty}
                title="Save Bill submission Offset Days"
                aria-label="Save Bill submission Offset Days"
              >
                <Save className="size-4" />
              </button>
            </span>
          </div>
          <div className="text-xs font-medium">
            <span className="mb-1 flex items-center gap-1.5 text-muted-foreground">
              Bill Payment Offset Days
              <FloatingHelper text="Added after the bill is sent/submitted to calculate the expected payment date. Default is 5 days unless Custom is enabled. Row overrides are saved separately below." />
            </span>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min="0"
                value={
                  plan?.settings.useCustomBillOffsetDays
                    ? plan.settings.billOffsetDays
                    : DEFAULT_BILL_PAYMENT_OFFSET_DAYS
                }
                onChange={(event) => onSettingChange("billOffsetDays", event.target.value)}
                className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
                disabled={!plan || !plan.settings.useCustomBillOffsetDays}
              />
              <label className="flex h-9 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={Boolean(plan?.settings.useCustomBillOffsetDays)}
                  onChange={(event) =>
                    onSettingEnabledChange("useCustomBillOffsetDays", event.target.checked)
                  }
                  disabled={!plan}
                />
                Custom
              </label>
              <span className="text-[11px] text-muted-foreground">Default 5</span>
              <button
                type="button"
                className="btn-ghost h-9 w-9 p-0"
                onClick={() => onOffsetReset("billOffsetDays")}
                disabled={!plan}
                title="Reset Bill Payment Offset Days"
                aria-label="Reset Bill Payment Offset Days"
              >
                <RotateCcw className="size-4" />
              </button>
              <button
                type="button"
                className="btn-ghost h-9 w-9 p-0"
                onClick={onSave}
                disabled={!plan || saving || !dirty}
                title="Save Bill Payment Offset Days"
                aria-label="Save Bill Payment Offset Days"
              >
                <Save className="size-4" />
              </button>
            </span>
          </div>
          <div className="text-xs font-medium">
            <span className="mb-1 flex items-center gap-1.5 text-muted-foreground">
              D.P. offset days
              <FloatingHelper text="Added to the delivery/job-completion due date to calculate the expected bill sent date. For Items Based on D.P., one extra day is also added after D.P. before this offset. Default is 10 days unless Custom is enabled." />
            </span>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min="0"
                value={
                  plan?.settings.useCustomDpOffsetDays
                    ? plan.settings.dpOffsetDays
                    : DEFAULT_DP_OFFSET_DAYS
                }
                onChange={(event) => onSettingChange("dpOffsetDays", event.target.value)}
                className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
                disabled={!plan || !plan.settings.useCustomDpOffsetDays}
              />
              <label className="flex h-9 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={Boolean(plan?.settings.useCustomDpOffsetDays)}
                  onChange={(event) =>
                    onSettingEnabledChange("useCustomDpOffsetDays", event.target.checked)
                  }
                  disabled={!plan}
                />
                Custom
              </label>
              <span className="text-[11px] text-muted-foreground">Default 10</span>
              <button
                type="button"
                className="btn-ghost h-9 w-9 p-0"
                onClick={() => onOffsetReset("dpOffsetDays")}
                disabled={!plan}
                title="Reset D.P. offset days"
                aria-label="Reset D.P. offset days"
              >
                <RotateCcw className="size-4" />
              </button>
              <button
                type="button"
                className="btn-ghost h-9 w-9 p-0"
                onClick={onSave}
                disabled={!plan || saving || !dirty}
                title="Save D.P. offset days"
                aria-label="Save D.P. offset days"
              >
                <Save className="size-4" />
              </button>
            </span>
          </div>
          <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium">
            <input
              type="checkbox"
              checked={includePreviousFy}
              onChange={(event) => onIncludePreviousFyChange(event.target.checked)}
            />
            Include previous FY submitted bills
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
          <CashOutGoSummaryTable plan={plan} onOpenRowsSearch={onOpenRowsSearch} />
          <CashOutGoMonthTable rows={plan.expenditureTillDate} title="Expenditure Till Date" />
          <CashOutGoDetailTable
            title="Bills Submitted to PCDA"
            rows={plan.billsSubmitted}
            onRowChange={onRowChange}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            saving={saving}
            saveDisabled={saveDisabled}
          />
          <CashOutGoDetailTable
            title="Bills at Hand"
            helperText="Expected sent/resubmission is calculated from the base date plus Bill submission Offset Days. Edit the date for a row if a specific submission/resubmission date is expected."
            rows={plan.billsAtHand}
            onRowChange={onRowChange}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            saving={saving}
            saveDisabled={saveDisabled}
          />
          <CashOutGoDetailTable
            title="Items Delivered and Bills Yet to Be Prepared"
            helperText="Expected sent/resubmission is calculated as base date plus D.P. offset days. Base date is Material Receipt Date when delivery/inspection applies; otherwise it is Job Completion Date for non-contract IR No files, or Revised D.P./D.P. date plus one day for files like MPC, AMC etc. Rows turn red after the expected date passes and the bill is still not sent/submitted."
            rows={plan.deliveredBillsPending}
            onRowChange={onRowChange}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            saving={saving}
            saveDisabled={saveDisabled}
          />
          <CashOutGoDetailTable
            title="Items Based on D.P."
            rows={plan.dpBasedForecast ?? []}
            onRowChange={onRowChange}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            saving={saving}
            saveDisabled={saveDisabled}
            dpOnly
          />
          <CashOutGoDetailTable
            title="D.P. Expired"
            rows={plan.dpExpired ?? []}
            onRowChange={onRowChange}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            saving={saving}
            saveDisabled={saveDisabled}
            expectedPaymentEditable
            dpOnly
          />
          <CashOutGoMonthTable
            rows={plan.monthwisePlan}
            title="Monthwise Revised Cash Out Go Plan"
          />
          <CashOutGoMonthTable
            rows={[getCashOutGoTotalExpectedRow(plan)]}
            title="Total Expected Expenditure"
          />
        </>
      ) : null}
    </div>
  );
}

function SummaryTile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{formatCurrency(value)}</div>
      {note ? <div className="mt-1 text-xs text-muted-foreground">{note}</div> : null}
    </div>
  );
}

function getCashOutGoAllocationPercent(value: number, allocation: number) {
  if (!allocation) return "Allocation not set";
  return `${((value / allocation) * 100).toFixed(1)}% of allocation`;
}

function getCashOutGoTotalExpectedRow(plan: CashOutGoPlanPayload): ExpectedCashOutgoRow {
  const totals = getExpectedCashOutgoTotals(plan.monthwisePlan);
  return {
    monthKey: "total",
    month: "Total Expected Expenditure",
    capital: totals.capital,
    revenue: totals.revenue,
    total: totals.total,
  };
}

function getCashOutGoSectionTotals(
  rows: Array<Pick<CashOutGoPlanDetailRow, "capital" | "revenue" | "total">>,
) {
  return rows.reduce(
    (sum, row) => ({
      capital: sum.capital + row.capital,
      revenue: sum.revenue + row.revenue,
      total: sum.total + row.total,
    }),
    { capital: 0, revenue: 0, total: 0 },
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
                  <span className="font-semibold">{formatCurrency(section.capital)}</span>
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-3 py-3 font-medium text-muted-foreground">Revenue</td>
              {sections.map((section) => (
                <td key={section.key} className="px-3 py-3 text-right tabular-nums">
                  <span className="font-semibold">{formatCurrency(section.revenue)}</span>
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
  const submitted = getCashOutGoSectionTotals(plan.billsSubmitted);
  const hand = getCashOutGoSectionTotals(plan.billsAtHand);
  const delivered = getCashOutGoSectionTotals(plan.deliveredBillsPending);
  const dp = getCashOutGoSectionTotals(plan.dpBasedForecast ?? []);
  const dpExpired = getCashOutGoSectionTotals(plan.dpExpired ?? []);
  return [
    { key: "expenditure", label: "Expenditure till date", ...expenditure, rows: [] },
    { key: "submitted", label: "Bills Submitted to PCDA", ...submitted, rows: plan.billsSubmitted },
    { key: "hand", label: "Bills at Hand", ...hand, rows: plan.billsAtHand },
    {
      key: "delivered",
      label: "Items Delivered and Bills Yet to Be Prepared",
      ...delivered,
      rows: plan.deliveredBillsPending,
    },
    { key: "dp", label: "Items Based on D.P.", ...dp, rows: plan.dpBasedForecast ?? [] },
    { key: "dpExpired", label: "D.P. Expired", ...dpExpired, rows: plan.dpExpired ?? [] },
    { key: "monthwise", label: "Monthwise Revised Cash Out Go Plan", ...monthwise, rows: [] },
  ];
}

function recalculateCashOutGoPlan(plan: CashOutGoPlanPayload): CashOutGoPlanPayload {
  const billPaymentOffsetDays = getEffectiveBillPaymentOffsetDays(plan.settings);
  const billSubmissionOffsetDays = getEffectiveBillSubmissionOffsetDays(plan.settings);
  const dpOffsetDays = getEffectiveDpOffsetDays(plan.settings);
  const recalcRows = (rows: CashOutGoPlanDetailRow[]) =>
    rows.map((row) => {
      const expectedSentDate =
        row.actualSentDate || row.expectedSentDateOverride
          ? row.expectedSentDate
          : row.section === "hand"
            ? (addDays(row.baseDate, billSubmissionOffsetDays) ?? "")
            : row.section === "delivered"
              ? (addDays(row.baseDate, dpOffsetDays) ?? "")
              : row.section === "dp"
                ? (addDays(row.baseDate, dpOffsetDays + 1) ?? "")
                : row.expectedSentDate;
      const offset = row.billOffsetOverride
        ? readMerAmount(row.billOffsetOverride)
        : billPaymentOffsetDays;
      const sentDate = row.actualSentDate || expectedSentDate;
      const expectedPaymentDate = row.manualExpectedPaymentDate || addDays(sentDate, offset) || "";
      return {
        ...row,
        expectedSentDate,
        billOffsetDays: row.billOffsetOverride ? offset : billPaymentOffsetDays,
        expectedPaymentDate,
        overdue: Boolean(expectedSentDate && expectedSentDate < plan.today && !row.actualSentDate),
      };
    });
  const billsSubmitted = recalcRows(plan.billsSubmitted);
  const billsAtHand = recalcRows(plan.billsAtHand);
  const deliveredBillsPending = recalcRows(plan.deliveredBillsPending);
  const dpBasedForecast = recalcRows(plan.dpBasedForecast ?? []);
  const dpExpired = recalcRows(plan.dpExpired ?? []);
  const nextPlan = {
    ...plan,
    billsSubmitted,
    billsAtHand,
    deliveredBillsPending,
    dpBasedForecast,
    dpExpired,
  };
  return {
    ...nextPlan,
    monthwisePlan: rebuildCashOutGoMonthwisePlan(nextPlan),
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

    const forecast = forecastRows
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
  return settings.useCustomBillOffsetDays
    ? settings.billOffsetDays
    : DEFAULT_BILL_PAYMENT_OFFSET_DAYS;
}

function getEffectiveBillSubmissionOffsetDays(settings: CashOutGoPlanPayload["settings"]) {
  return settings.useCustomHandSubmissionOffsetDays
    ? settings.handSubmissionOffsetDays
    : DEFAULT_BILL_SUBMISSION_OFFSET_DAYS;
}

function getEffectiveDpOffsetDays(settings: CashOutGoPlanPayload["settings"]) {
  return settings.useCustomDpOffsetDays ? settings.dpOffsetDays : DEFAULT_DP_OFFSET_DAYS;
}

function exportCashOutGoPlan(plan: CashOutGoPlanPayload, format: "excel" | "pdf") {
  const billPaymentOffsetDays = getEffectiveBillPaymentOffsetDays(plan.settings);
  const billSubmissionOffsetDays = getEffectiveBillSubmissionOffsetDays(plan.settings);
  const dpOffsetDays = getEffectiveDpOffsetDays(plan.settings);
  const detailHeaders = [
    "File",
    "Description",
    "Firm",
    "Amount source",
    "Base date",
    "Expected sent/resubmission",
    "Payment Offset Days",
    "Expected payment",
    "Capital",
    "Revenue",
    "Total",
    "Overdue",
  ];
  const detailRows = (rows: CashOutGoPlanDetailRow[]) =>
    rows.map((row) => [
      row.fileRef,
      row.description,
      row.firm,
      row.amountSource,
      row.baseDate,
      row.expectedSentDate,
      row.billOffsetOverride
        ? `${row.billOffsetOverride} (row override)`
        : `${row.billOffsetDays} (global/default)`,
      row.expectedPaymentDate,
      formatCurrency(row.capital),
      formatCurrency(row.revenue),
      formatCurrency(row.total),
      row.overdue ? "Yes" : "No",
    ]);
  void downloadBackendExport({
    format,
    title: "Cash Out Go Plan",
    description: `FY ${plan.financialYear}; Bill Payment Offset ${billPaymentOffsetDays} days; Bill submission Offset ${billSubmissionOffsetDays} days; D.P. offset ${dpOffsetDays} days`,
    fileName: `cash-out-go-plan-${plan.financialYear}.${format === "excel" ? "xls" : "pdf"}`,
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
            ...getCashOutGoSummarySections(plan).map((section) => formatCurrency(section.capital)),
          ],
          [
            "Revenue",
            ...getCashOutGoSummarySections(plan).map((section) => formatCurrency(section.revenue)),
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
      {
        title: "Bills Submitted to PCDA",
        headers: detailHeaders,
        rows: detailRows(plan.billsSubmitted),
      },
      { title: "Bills at Hand", headers: detailHeaders, rows: detailRows(plan.billsAtHand) },
      {
        title: "Items Delivered and Bills Yet to Be Prepared",
        headers: detailHeaders,
        rows: detailRows(plan.deliveredBillsPending),
      },
      {
        title: "Items Based on D.P.",
        headers: detailHeaders,
        rows: detailRows(plan.dpBasedForecast ?? []),
      },
      {
        title: "D.P. Expired",
        headers: detailHeaders,
        rows: detailRows(plan.dpExpired ?? []),
      },
      {
        title: "Monthwise Revised Cash Out Go Plan",
        headers: cashOutgoColumns.map((column) => column.label),
        rows: [
          ...plan.monthwisePlan.map((row, index) =>
            cashOutgoColumns.map((column) => getCashOutgoDisplayValue(row, column.key, index)),
          ),
          getCashOutgoTotalsExportRow(plan.monthwisePlan),
        ],
      },
      {
        title: "Total Expected Expenditure",
        headers: cashOutgoColumns.map((column) => column.label),
        rows: [getCashOutGoTotalExpectedRow(plan)].map((row, index) =>
          cashOutgoColumns.map((column) => getCashOutgoDisplayValue(row, column.key, index)),
        ),
      },
    ],
  });
}

function CashOutGoMonthTable({ rows, title }: { rows: ExpectedCashOutgoRow[]; title: string }) {
  return <CashOutgoReport rows={rows} title={title} emptyMessage="No rows found." />;
}

function CashOutGoDetailTable({
  title,
  helperText,
  rows,
  onRowChange,
  onOpenFile,
  onOpenRowsSearch,
  onSave,
  saving = false,
  saveDisabled = false,
  expectedPaymentEditable = false,
  dpOnly = false,
}: {
  title: string;
  helperText?: string;
  rows: CashOutGoPlanDetailRow[];
  onRowChange: (
    rowKey: string,
    field: "expectedSentDate" | "billOffsetOverride" | "manualExpectedPaymentDate",
    value: string,
  ) => void;
  onOpenFile?: (row: CashOutGoPlanDetailRow) => void;
  onOpenRowsSearch?: (rows: CashOutGoPlanDetailRow[]) => void;
  onSave?: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  expectedPaymentEditable?: boolean;
  dpOnly?: boolean;
}) {
  const totals = getCashOutGoSectionTotals(rows);
  const columnCount = 11;
  return (
    <details className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
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
        <span className="grid gap-0.5 text-right text-xs tabular-nums sm:grid-cols-4 sm:gap-3">
          <span className="font-semibold">{formatCurrency(totals.total)}</span>
          <span className="font-semibold">{formatCurrency(totals.capital)}</span>
          <span className="font-semibold">{formatCurrency(totals.revenue)}</span>
          <span className="text-muted-foreground">{rows.length}</span>
        </span>
      </summary>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <th className="px-3 py-2">File</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Firm</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Base date</th>
              <th className="px-3 py-2">Expected sent/resubmission</th>
              <th className="px-3 py-2">Payment Offset Override</th>
              <th className="px-3 py-2">Expected payment</th>
              <th className="px-3 py-2 text-right">Capital</th>
              <th className="px-3 py-2 text-right">Revenue</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr
                  key={row.rowKey}
                  className={
                    "border-b border-border/60 last:border-0 " +
                    (row.overdue ? "text-destructive" : "")
                  }
                >
                  <td className="px-3 py-2 font-medium">
                    {onOpenFile && row.fileId ? (
                      <button
                        type="button"
                        onClick={() => onOpenFile(row)}
                        className={
                          "text-left font-semibold underline-offset-2 hover:underline " +
                          (row.overdue ? "text-destructive" : "text-primary")
                        }
                      >
                        {row.fileRef}
                      </button>
                    ) : (
                      row.fileRef
                    )}
                  </td>
                  <td className="px-3 py-2">{row.description}</td>
                  <td className="px-3 py-2">{row.firm}</td>
                  <td className="px-3 py-2">{row.amountSource}</td>
                  <td className="px-3 py-2 tabular-nums">{row.baseDate}</td>
                  <td className="px-3 py-2">
                    {row.actualSentDate ? (
                      ""
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <input
                          type="date"
                          value={row.expectedSentDate}
                          onChange={(event) =>
                            onRowChange(row.rowKey, "expectedSentDate", event.target.value)
                          }
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                          disabled={dpOnly}
                        />
                        {!dpOnly && onSave ? (
                          <button
                            type="button"
                            onClick={onSave}
                            disabled={saving || saveDisabled}
                            className="rounded border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {saving ? "Saving..." : "Save"}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {dpOnly ? (
                      row.billOffsetDays
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <input
                          type="number"
                          min="0"
                          value={row.billOffsetOverride}
                          placeholder={`Global ${row.billOffsetDays}`}
                          onChange={(event) =>
                            onRowChange(row.rowKey, "billOffsetOverride", event.target.value)
                          }
                          className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm"
                        />
                        {onSave ? (
                          <button
                            type="button"
                            onClick={onSave}
                            disabled={saving || saveDisabled}
                            className="rounded border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {saving ? "Saving..." : "Save"}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {expectedPaymentEditable ? (
                      <div className="flex flex-col items-start gap-1">
                        <input
                          type="date"
                          value={row.manualExpectedPaymentDate}
                          onChange={(event) =>
                            onRowChange(row.rowKey, "manualExpectedPaymentDate", event.target.value)
                          }
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                        />
                        {onSave ? (
                          <button
                            type="button"
                            onClick={onSave}
                            disabled={saving || saveDisabled}
                            className="rounded border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {saving ? "Saving..." : "Save"}
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      row.expectedPaymentDate
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(row.capital)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(row.revenue)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {formatCurrency(row.total)}
                  </td>
                </tr>
              ))
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
    </details>
  );
}

function FloatingHelper({
  text,
  label = "More information",
  side = "right",
  className = "",
  iconClassName = "size-4",
}: {
  text: string;
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
              "inline-flex size-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              className
            }
          >
            <CircleHelp className={iconClassName} />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} align="center" className="max-w-xs leading-relaxed">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CashOutgoReport({
  rows,
  title,
  titleHelper,
  description,
  emptyMessage,
  actions,
  controls,
  onOpenMonth,
  onOpenAll,
}: {
  rows: ExpectedCashOutgoRow[];
  title: string;
  titleHelper?: string;
  description?: string;
  emptyMessage: string;
  actions?: ReactNode;
  controls?: ReactNode;
  onOpenMonth?: (monthKey: string) => void;
  onOpenAll?: () => void;
}) {
  const totals = getExpectedCashOutgoTotals(rows);
  const descriptionWithHelper = [description, titleHelper].filter(Boolean).join("\n");

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          {descriptionWithHelper ? <ReportDescription description={descriptionWithHelper} /> : null}
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2">
          {controls}
          {actions}
        </div>
        <div className="grid grid-cols-2 gap-2 text-right text-xs">
          <div className="rounded-md border border-border bg-secondary/20 px-3 py-2">
            <div className="text-muted-foreground">Total Capital</div>
            <div className="font-semibold tabular-nums">{formatCurrency(totals.capital)}</div>
          </div>
          <div className="rounded-md border border-border bg-secondary/20 px-3 py-2">
            <div className="text-muted-foreground">Total Revenue</div>
            <div className="font-semibold tabular-nums">{formatCurrency(totals.revenue)}</div>
          </div>
        </div>
      </div>

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
                        {column.key === "month" ? (
                          onOpenMonth ? (
                            <button
                              type="button"
                              onClick={() => onOpenMonth(row.monthKey)}
                              className="font-medium text-primary underline-offset-2 hover:underline"
                            >
                              {getCashOutgoDisplayValue(row, column.key, index)}
                            </button>
                          ) : (
                            <span className="font-medium">
                              {getCashOutgoDisplayValue(row, column.key, index)}
                            </span>
                          )
                        ) : (
                          getCashOutgoDisplayValue(row, column.key, index)
                        )}
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
                <CashOutgoTotalsRow totals={totals} onOpenAll={onOpenAll} />
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </div>
  );
}

function ReportDescription({ description }: { description: string }) {
  const lines = description
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    return (
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
        {lines.map((line) => (
          <li key={line}>{line.replace(/^[-*]\s+/, "")}</li>
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
                      {getCashOutgoDisplayValue(row, column.key, index)}
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
}: {
  totals: Pick<ExpectedCashOutgoRow, "capital" | "revenue">;
  onOpenAll?: () => void;
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
  const capital = formatCurrency(totals.capital);
  const revenue = formatCurrency(totals.revenue);
  return (
    <tr className="border-t border-border bg-accent font-semibold">
      <td className="px-3 py-2.5 text-right tabular-nums" />
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
            Files stuck in their current milestone for more than {thresholdDays} days.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex w-28 flex-col gap-1 text-xs text-muted-foreground">
            <span>Days</span>
            <input
              type="number"
              min="0"
              value={selectedDays}
              onChange={(event) => onDaysChange(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="flex min-w-[220px] flex-col gap-1 text-xs text-muted-foreground">
            <span>Milestone</span>
            <select
              value={selectedMilestoneKey}
              onChange={(event) => onMilestoneChange(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
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

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-sm">
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
                        <td
                          key={column.key}
                          className={
                            "px-3 py-2.5 " +
                            (column.align === "right" ? "text-right tabular-nums" : "text-left")
                          }
                        >
                          {column.key === "action" ? (
                            <button
                              type="button"
                              onClick={() => onOpenFile(row)}
                              className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-accent"
                            >
                              Open
                            </button>
                          ) : (
                            getDelayStatusDisplayValue(row, column.key, absoluteIndex)
                          )}
                        </td>
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
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getPaginationPages(currentPage: number, totalPages: number) {
  const firstPage = Math.max(1, currentPage - 2);
  const lastPage = Math.min(totalPages, firstPage + 4);
  const startPage = Math.max(1, lastPage - 4);
  return Array.from({ length: lastPage - startPage + 1 }, (_, index) => startPage + index);
}

function exportDelayStatusToExcel(rows: DelayStatusRow[], title: string) {
  void downloadDelayStatus(rows, title, "excel");
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
    const activeRawEntries = firmRawEntries.filter(
      ({ file, order }) => !isSupplyOrderCancelled(file, order),
    );
    const placedEntries = activeRawEntries.filter(({ file, order }) =>
      isSupplyOrderTabComplete(file, order),
    );
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
      new Set(placedEntries.map(({ file }) => file.division).filter(hasFilledString)),
    ).sort();
    const fileTypes = Array.from(
      new Set(placedEntries.map(({ file }) => file.fileType).filter(hasFilledString)),
    ).sort();
    const bgStats = getFirmBgStats(placedEntries);
    const bgTargets = getFirmBgTargets(placedEntries);
    const clickTargets: FirmDatabaseRow["clickTargets"] = {
      totalSupplyOrders: getUniqueEntryFileIds(placedEntries),
      runningSupplyOrders: getUniqueEntryFileIds(runningEntries),
      completedSupplyOrders: getUniqueEntryFileIds(completedEntries),
      cancelledSupplyOrders: getUniqueEntryFileIds(
        firmRawEntries.filter(({ file, order }) => isSupplyOrderCancelled(file, order)),
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
      divisionCount: getUniqueEntryFileIds(placedEntries),
    };

    const numeric: FirmDatabaseRow["numeric"] = {
      totalSupplyOrders: placedEntries.length,
      runningSupplyOrders: runningEntries.length,
      completedSupplyOrders: completedEntries.length,
      cancelledSupplyOrders: firmRawEntries.length - activeRawEntries.length,
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
    const dpDate = getDeliveryPeriodDate(stage);
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
  title: string,
  format: "excel" | "pdf",
) {
  const columns = firmDatabaseColumns.filter((column) => visibleColumns.includes(column.key));
  void downloadBackendExport({
    format,
    title,
    description:
      "Firm-wise supply order, value, delivery, BG, rating, and coverage analysis. Payment performance fields are excluded.",
    tables: [
      {
        headers: columns.map((column) => column.label),
        rows: rows.map((row, index) =>
          columns.map((column) =>
            String(column.key === "serial" ? index + 1 : (row[column.key] ?? "")),
          ),
        ),
      },
    ],
  });
}

function printDelayStatusToPdf(rows: DelayStatusRow[], title: string) {
  void downloadDelayStatus(rows, title, "pdf");
}

function exportMmgSummary(rows: MmgSummaryRow[], title: string, format: "excel" | "pdf") {
  void downloadBackendExport({
    format,
    title,
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
) {
  await downloadBackendExport({
    format,
    title,
    description,
    tables: [
      {
        headers: columns.map((column) => column.label),
        rows: rows.map((row) => columns.map((column) => String(row[column.key] ?? ""))),
      },
    ],
  });
}

async function downloadDelayStatus(rows: DelayStatusRow[], title: string, format: "excel" | "pdf") {
  const exportColumns = delayStatusColumns.filter((column) => column.key !== "action");
  await downloadBackendExport({
    format,
    title,
    description: "Stages whose current milestone has remained open beyond the selected threshold.",
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
  const exportColumns = delayStatusColumns.filter((column) => column.key !== "action");
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
) {
  exportCashOutgoToExcel(rows, title, emptyMessage, description);
}

function exportActualCashOutgoToExcel(rows: ExpectedCashOutgoRow[], title: string) {
  exportCashOutgoToExcel(rows, title, "No actual cash out go rows found.");
}

function exportCurrentLiabilityToExcel(
  rows: ExpectedCashOutgoRow[],
  title: string,
  description?: string,
) {
  exportCashOutgoToExcel(
    rows,
    title,
    "No unpaid liability found for the current month.",
    description,
  );
}

function exportCashOutgoToExcel(
  rows: ExpectedCashOutgoRow[],
  title: string,
  emptyMessage: string,
  description?: string,
) {
  void downloadCashOutgo(rows, title, emptyMessage, description, "excel");
}

function printExpectedCashOutgoToPdf(
  rows: ExpectedCashOutgoRow[],
  title: string,
  description?: string,
  emptyMessage = "No expected cash outgo rows found.",
) {
  printCashOutgoToPdf(rows, title, emptyMessage, description);
}

function printActualCashOutgoToPdf(rows: ExpectedCashOutgoRow[], title: string) {
  printCashOutgoToPdf(rows, title, "No actual cash out go rows found.");
}

function printCurrentLiabilityToPdf(
  rows: ExpectedCashOutgoRow[],
  title: string,
  description?: string,
) {
  printCashOutgoToPdf(rows, title, "No unpaid liability found for the current month.", description);
}

function printCashOutgoToPdf(
  rows: ExpectedCashOutgoRow[],
  title: string,
  emptyMessage: string,
  description?: string,
) {
  void downloadCashOutgo(rows, title, emptyMessage, description, "pdf");
}

async function downloadCashOutgo(
  rows: ExpectedCashOutgoRow[],
  title: string,
  emptyMessage: string,
  description: string | undefined,
  format: "excel" | "pdf",
) {
  await downloadBackendExport({
    format,
    title,
    description,
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
                <td>${escapeHtml(formatCurrency(totals.capital))}</td>
                <td>${escapeHtml(formatCurrency(totals.revenue))}</td>
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
  | "division"
  | "indentor"
  | "description"
  | "milestone"
  | "stageStartDate"
  | "daysInStage"
  | "action";
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
type MonthlyReportViewMode = "year" | "month";
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
  { key: "fileRef", label: "File", align: "left" },
  { key: "division", label: "Division", align: "left" },
  { key: "indentor", label: "Indentor", align: "left" },
  { key: "description", label: "Description", align: "left" },
  { key: "milestone", label: "Current milestone", align: "left" },
  { key: "stageStartDate", label: "Stage start date", align: "left" },
  { key: "daysInStage", label: "Days", align: "right" },
  { key: "action", label: "Search", align: "left" },
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
    if (isCancelledFile(file)) return;
    fileSupplyOrders(file).forEach((order) => {
      const deliveryPeriodDate = getDeliveryPeriodDate(order);
      if (!hasFilledString(deliveryPeriodDate) || isYes(order.soCancelled)) return;
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
    if (isCancelledFile(file)) return;
    fileSupplyOrders(file).forEach((order) => {
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
      capital: row ? String(row.capital ?? 0) : "0",
      revenue: row ? String(row.revenue ?? 0) : "0",
    };
  });
}

function getMerDraftDirtyRows(rows: MerCashOutgoDraftRow[]) {
  return rows.map((row) => ({
    monthKey: row.monthKey,
    capital: readMerAmount(row.capital),
    revenue: readMerAmount(row.revenue),
  }));
}

function getCashOutGoPlanDirtySnapshot(plan: CashOutGoPlanPayload) {
  return JSON.stringify({
    settings: plan.settings,
    rows: [
      ...plan.billsSubmitted,
      ...plan.billsAtHand,
      ...plan.deliveredBillsPending,
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
  rowGroups: ExpectedCashOutgoRow[][],
) {
  const totals = rowGroups
    .flatMap((rows) => rows.filter((row) => row.monthKey <= monthKey))
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
  const capital =
    getInrAmount(
      amountType === "actual" ? bill.actualPaymentCapital : bill.billAmountCapital,
      file,
    ) ?? 0;
  const revenue =
    getInrAmount(
      amountType === "actual" ? bill.actualPaymentRevenue : bill.billAmountRevenue,
      file,
    ) ?? 0;
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

function hasOpenSupplementaryBillReturn(bill: SupplementaryBillDetail) {
  return (bill.billReturnCycles ?? []).some(
    (cycle) => hasFilledString(cycle.returnedDate) && !hasFilledString(cycle.resubmittedDate),
  );
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
      if (!isPaymentPendingAsOf(order, asOnDate)) return;
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
        capital: formatCurrency(capital),
        revenue: formatCurrency(revenue),
        total: formatCurrency(capital + revenue),
        fileIds: Array.from(row.fileIds).join(","),
        focusTargets: serializeAgeingFocusTargets(row.focusTargets),
        dashboardFilter: `ageing:${encodeURIComponent(row.key)}`,
      };
    });
}

function serializeAgeingFocusTargets(focusTargets: Map<string, string>) {
  const encoded = Array.from(focusTargets.entries())
    .filter(([fileId, target]) => fileId && target)
    .map(([fileId, target]) => `${encodeURIComponent(fileId)}=${encodeURIComponent(target)}`)
    .join(",");
  return encoded || undefined;
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
  const openReturnedDate = earliestDate(
    (bill.billReturnCycles ?? [])
      .filter(
        (cycle) => hasFilledString(cycle.returnedDate) && !hasFilledString(cycle.resubmittedDate),
      )
      .map((cycle) => cycle.returnedDate),
  );
  if (openReturnedDate) return openReturnedDate;
  const resubmittedDates = (bill.billReturnCycles ?? [])
    .map((cycle) => cycle.resubmittedDate)
    .filter(hasFilledString)
    .sort();
  return resubmittedDates[resubmittedDates.length - 1] ?? bill.billSentForPaymentDate;
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
    fileRef: getFileReference(file),
    division: file.division ?? "",
    indentor: file.indentor ?? "",
    description: file.demandDescription ?? "",
    milestoneKey: biddingDelayMilestoneKey,
    milestone: biddingDelayMilestoneLabel,
    stageStartDate: status.stageStartDate,
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
    fileRef: getFileReference(file),
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
    fileRef: getFileReference(file),
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
          fileRef: getSupplyOrderDelayReference(file, order, orderIndex),
          division: file.division ?? "",
          indentor: file.indentor ?? "",
          description: file.demandDescription ?? "",
          milestoneKey: milestone.key,
          milestone: milestone.label,
          stageStartDate,
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
        fileRef: getSupplyOrderDelayReference(file, order, orderIndex),
        division: file.division ?? "",
        indentor: file.indentor ?? "",
        description: file.demandDescription ?? "",
        milestoneKey: billReturnedDelayMilestoneKey,
        milestone: "Bill returned for correction",
        stageStartDate,
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
          fileRef: `${getSupplyOrderDelayReference(file, order, orderIndex)} / Supp. bill ${billIndex + 1}`,
          division: file.division ?? "",
          indentor: file.indentor ?? "",
          description: file.demandDescription ?? "",
          milestoneKey: supplementaryBillReturnedDelayMilestoneKey,
          milestone: "Supplementary bill returned for correction",
          stageStartDate,
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
  return earliestDate(
    (order.billReturnCycles ?? [])
      .filter(
        (cycle) => hasFilledString(cycle.returnedDate) && !hasFilledString(cycle.resubmittedDate),
      )
      .map((cycle) => cycle.returnedDate),
  );
}

function getEarliestOpenSupplementaryBillReturnDate(bill: SupplementaryBillDetail) {
  return earliestDate(
    (bill.billReturnCycles ?? [])
      .filter(
        (cycle) => hasFilledString(cycle.returnedDate) && !hasFilledString(cycle.resubmittedDate),
      )
      .map((cycle) => cycle.returnedDate),
  );
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
  let previousMilestone: MilestoneDefinition | undefined;
  for (const item of milestoneDefinitions) {
    if (item.key === milestone.key) break;
    if (isMilestoneApplicable(file, item)) previousMilestone = item;
  }
  return previousMilestone;
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
  const counts = new Map<string, { key: string; label: string; count: number }>();
  rows.forEach((row) => {
    const current = counts.get(row.milestoneKey) ?? {
      key: row.milestoneKey,
      label: row.milestone,
      count: 0,
    };
    current.count += 1;
    counts.set(row.milestoneKey, current);
  });

  return {
    averageDays: rows.length ? Math.round(totalDays / rows.length) : 0,
    longestDays: rows.reduce((max, row) => Math.max(max, row.daysInStage), 0),
    byMilestone: Array.from(counts.values()).sort((a, b) => b.count - a.count),
  };
}

function getDelayStatusDisplayValue(row: DelayStatusRow, key: DelayStatusColumnKey, index: number) {
  if (key === "serial") return String(index + 1);
  if (key === "action") return "";
  if (key === "daysInStage") return String(row.daysInStage);
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
  return ["", "Total", formatCurrency(totals.capital), formatCurrency(totals.revenue)];
}

function getCashOutgoDisplayValue(
  row: ExpectedCashOutgoRow,
  key: CashOutgoColumnKey,
  index: number,
) {
  if (key === "serial") return String(index + 1);
  if (key === "month") return row.month;
  return formatCurrency(row[key]);
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

const orderDelayMilestoneKeys = new Set(orderDelayMilestones.map((milestone) => milestone.key));

const delayMilestoneOptions = [
  { key: "workflowNotStarted", label: "Workflow Not Started" },
  { key: biddingDelayMilestoneKey, label: biddingDelayMilestoneLabel },
  ...milestoneDefinitions
    .filter((milestone) => !orderDelayMilestoneKeys.has(milestone.key))
    .map((milestone) => ({
      key: milestone.key,
      label: milestone.label,
    })),
  ...orderDelayMilestones.map((milestone) => ({
    key: milestone.key,
    label: milestone.label,
  })),
  { key: billReturnedDelayMilestoneKey, label: "Bill returned for correction" },
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
      milestone: "Bill returned for correction",
      stage: "Total",
      count: countReturnedBillOrders(files),
    },
    {
      milestone: "Bill returned for correction",
      stage: "Pending",
      count: countReturnedBillPendingOrders(files),
    },
    {
      milestone: "Bill returned for correction",
      stage: "Completed",
      count: countReturnedBillResubmittedOrders(files),
    },
    {
      milestone: "Bill returned for correction",
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
      milestone: "Bill returned for correction",
      stage: "Total",
      count: countReturnedBillOrders(files),
    },
    {
      milestone: "Bill returned for correction",
      stage: "Pending",
      count: countReturnedBillPendingOrders(files),
    },
    {
      milestone: "Bill returned for correction",
      stage: "Completed",
      count: countReturnedBillResubmittedOrders(files),
    },
    {
      milestone: "Bill returned for correction",
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
      base("At previous stage", countAtPreviousStageFiles(processFiles, milestone)),
    ];
  }

  if (milestone.key === "refloatBidding") {
    return [
      base(milestone.totalLabel ?? "Total", processFiles.length),
      base("In process", processFiles.filter((file) => !isYes(file.biddingStageOver)).length),
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
  let previousMilestone: MilestoneDefinition | undefined;
  for (const item of milestoneDefinitions) {
    if (item.key === milestone.key) break;
    if (isMilestoneApplicable(file, item)) previousMilestone = item;
  }
  return previousMilestone
    ? isMilestoneComplete(file, previousMilestone)
    : hasMilestoneDate(file, "receivedDate");
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
  return countPaymentOrders(files, hasCompletedBillReturn);
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
          !isSupplyOrderCancelled(file, order) &&
          !isYes(order.shortclosure),
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
    isYes(file.biddingStageOver) &&
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
  return current === "bidding" && !isYes(file.biddingStageOver);
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
    !isYes(order.shortclosure) &&
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
    fileSupplyOrders(file).some(isCompletedDeliveryOrder)
  );
}

function isDeliveryOverdue(file: FileRecord) {
  return (
    isDeliveryInspectionApplicable(file) &&
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(isOverdueDeliveryOrder)
  );
}

function isDeliveryDue(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isDeliveryInspectionApplicable(file) &&
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(isPendingDeliveryOrder)
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
    isYes(order.shortclosure)
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
    !isYes(order.shortclosure)
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
  return isDateBeforeToday(addDays(order.warrantyPeriodDate, 60));
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
  return getNonInspectionPaymentDueDate(file, order);
}

function getPaymentWorkflowStartDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
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

function getEffectiveBidOpeningDate(file: FileRecord) {
  return isYes(file.refloat) && hasFilledString(file.refloatBidOpeningDate)
    ? file.refloatBidOpeningDate
    : file.bidOpeningDate;
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
    if (isYes(order.stagePayment) && !isYes(order.advancePayment) && !isNo(order.advancePayment)) {
      return false;
    }
  }
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
