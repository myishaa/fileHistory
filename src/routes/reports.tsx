import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { downloadBackendExport, type ExportTable } from "@/lib/export-download";
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

type CashOutGoPlanDetailSectionKey =
  | "billsSubmitted"
  | "billsAtHand"
  | "deliveredBillsPending"
  | "dpBasedForecast"
  | "dpExpired";

type CashOutGoPlanExpandedSections = Record<CashOutGoPlanDetailSectionKey, boolean>;

const defaultCashOutGoPlanExpandedSections: CashOutGoPlanExpandedSections = {
  billsSubmitted: false,
  billsAtHand: false,
  deliveredBillsPending: false,
  dpBasedForecast: false,
  dpExpired: false,
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

type SoPaymentMatrixFieldKey =
  | "fileUniqueNo"
  | "demandDescription"
  | "soNo"
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
    activeUser?.role === "editor" ||
    (activeUser?.role === "universal_viewer" && activeUser.cashOutgoEditScope === "global");
  const canEditCashOutGoPlan =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    activeUser?.role === "editor" ||
    (activeUser?.role === "universal_viewer" &&
      (activeUser.cashOutgoEditScope === "personal" ||
        activeUser.cashOutgoEditScope === "global"));
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
  const [cashOutGoPlanIncludePreviousFy, setCashOutGoPlanIncludePreviousFy] = useState(false);
  const [soPaymentMatrixFields, setSoPaymentMatrixFields] = useState<SoPaymentMatrixFieldKey[]>([
    "fileUniqueNo",
    "demandDescription",
    "soNo",
    "soDate",
    "firmName",
    "division",
  ]);
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
  const [selectedFileYear, setSelectedFileYear] = useState(() => settings.financialYear || "all");
  const [fileYearLocked, setFileYearLocked] = useState(false);
  const [fileInitiationFromDate, setFileInitiationFromDate] = useState("");
  const [fileInitiationToDate, setFileInitiationToDate] = useState("");
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
  const isPreSoExpectedCashOutgoReport = reportMode === "preSoExpectedCashOutgo";
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
  const expectedCashOutgoDaysStorageKey = `recordkeeper:expected-cash-outgo-days:${
    activeUser?.id ?? "anonymous"
  }`;
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
  const resetWarrantyBgBufferDays = () => {
    setWarrantyBgBufferDays("60");
    setWarrantyBgBufferUnlocked(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(warrantyBgBufferStorageKey, "60");
    }
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
  const resetExpectedCashOutgoDays = () => {
    const defaultDays = String(DEFAULT_DP_OFFSET_DAYS);
    setExpectedCashOutgoDays(defaultDays);
    setExpectedCashOutgoDaysDraft(defaultDays);
    setExpectedCashOutgoDaysUnlocked(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(expectedCashOutgoDaysStorageKey, defaultDays);
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
  const fileYearFilterStorageKey = `recordkeeper:file-year-filter:${activeUser?.id ?? "anonymous"}`;
  const fileInitiationDateRangeStorageKey = `recordkeeper:file-initiation-date-range:${
    activeUser?.id ?? "anonymous"
  }`;
  const defaultFileYear = fileYearOptions.includes(settings.financialYear)
    ? settings.financialYear
    : (fileYearOptions[0] ?? "all");
  const fileYearAllOptionLabel = isAllFilesYear(settings.selectedYear)
    ? "Entire database"
    : "All file years";
  const activeFileYear =
    selectedFileYear === "all" || fileYearOptions.includes(selectedFileYear)
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
    if (typeof window === "undefined" || !fileYearOptions.length) return;
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
      setSelectedFileYear(year === "all" || fileYearOptions.includes(year) ? year : defaultFileYear);
    } catch {
      setFileYearLocked(false);
      setSelectedFileYear(defaultFileYear);
    }
  }, [defaultFileYear, fileYearFilterStorageKey, fileYearOptions, isPreSoExpectedCashOutgoReport]);
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
  const fileMatchesActiveFileYear = (file: FileRecord) =>
    (activeFileYear === "all" || file.year === activeFileYear) &&
    fileMatchesInitiationDateRange(file, activeFileInitiationDateRange);
  const fileYearFilterDisabled = isFileYearFilterDisabledReport(reportMode);
  const fileCategoryFilterDisabled = isFileCategoryFilterDisabledReport(reportMode);
  const fileYearFilterActive = !fileYearFilterDisabled && activeFileYear !== defaultFileYear;
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
    if (activeFileYear !== "all") params.set("fileYear", activeFileYear);
    Object.entries(fileInitiationDateQueryParams).forEach(([key, value]) => params.set(key, value));
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
  const toggleSoPaymentMatrixField = (fieldKey: SoPaymentMatrixFieldKey, checked: boolean) => {
    setSoPaymentMatrixFields((current) => {
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
  const resetSoPaymentMatrixFields = () =>
    setSoPaymentMatrixFields([...soPaymentMatrixDefaultFields]);
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
    const enabledField =
      field === "billOffsetDays"
        ? "useCustomBillOffsetDays"
        : field === "handSubmissionOffsetDays"
          ? "useCustomHandSubmissionOffsetDays"
          : "useCustomDpOffsetDays";
    const defaultValue =
      field === "billOffsetDays"
        ? DEFAULT_BILL_PAYMENT_OFFSET_DAYS
        : field === "handSubmissionOffsetDays"
          ? DEFAULT_BILL_SUBMISSION_OFFSET_DAYS
          : DEFAULT_DP_OFFSET_DAYS;
    setCashOutGoPlan((plan) =>
      plan
        ? recalculateCashOutGoPlan(
            {
              ...plan,
              settings: {
                ...plan.settings,
                [field]: nextValue,
                [enabledField]: nextValue !== defaultValue,
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
        ? recalculateCashOutGoPlan(
            {
              ...plan,
              settings: {
                ...plan.settings,
                [field]: reset.value,
                [reset.enabledField]: false,
              },
            },
            { preserveExpectedSentDate: field === "billOffsetDays" },
          )
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
      const effectiveBillPaymentOffsetDays = getEffectiveBillPaymentOffsetDays(plan.settings);
      const updateRows = (rows: CashOutGoPlanDetailRow[]) =>
        rows.map((row) =>
          row.rowKey === rowKey
            ? (() => {
                const normalizedValue =
                  field === "billOffsetOverride" &&
                  hasFilledString(value) &&
                  readMerAmount(value) === effectiveBillPaymentOffsetDays
                    ? ""
                    : value;
                return {
                  ...row,
                  [field]: normalizedValue,
                  expectedSentDateOverride:
                    field === "expectedSentDate" ? normalizedValue : row.expectedSentDateOverride,
                };
              })()
            : row,
        );
      return recalculateCashOutGoPlan(
        {
          ...plan,
          billsSubmitted: updateRows(plan.billsSubmitted),
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
            ? { ...row, expectedSentDate: "", expectedSentDateOverride: "" }
            : row,
        );
      return recalculateCashOutGoPlan({
        ...plan,
        billsSubmitted: resetRows(plan.billsSubmitted),
        billsAtHand: resetRows(plan.billsAtHand),
        deliveredBillsPending: resetRows(plan.deliveredBillsPending),
        dpBasedForecast: resetRows(plan.dpBasedForecast ?? []),
        dpExpired: resetRows(plan.dpExpired ?? []),
      });
    });
  };
  const resetCashOutGoPlanBillOffsetOverride = (rowKey: string) => {
    updateCashOutGoPlanRow(rowKey, "billOffsetOverride", "");
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
  const selectedMonthlyReportColumns =
    selectedMonthlyReport && monthlyReportBreakupYear && selectedMonthlyReport.monthRowsByYear
      ? selectedMonthlyReport.columns
      : (selectedMonthlyReport?.yearColumns ?? selectedMonthlyReport?.columns);
  const selectedMonthlyReportRows =
    selectedMonthlyReport && monthlyReportBreakupYear && selectedMonthlyReport.monthRowsByYear
      ? (selectedMonthlyReport.monthRowsByYear[monthlyReportBreakupYear] ?? [])
      : (selectedMonthlyReport?.yearRows ?? selectedMonthlyReport?.rows);
  const selectedMonthlyReportExportColumns =
    selectedMonthlyReport?.columns ?? selectedMonthlyReportColumns ?? [];
  const selectedMonthlyReportExportRows = selectedMonthlyReport
    ? getMonthlyReportExportRows(selectedMonthlyReport, monthlyReportBreakupYear)
    : [];
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
  );
  const pendingLiabilityDescription = [
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
  const exportCashOutgoPdf = () =>
    reportMode === "merData"
      ? printExpectedCashOutgoToPdf(
          merExportRows,
          selectedReportTitle,
          cashOutgoExportDescription,
          cashOutgoEmptyMessage,
        )
      : reportMode === "currentMonthLiability"
        ? printCurrentLiabilityToPdf(
            selectedCashOutgoRows,
            selectedReportTitle,
            cashOutgoExportDescription,
          )
        : printExpectedCashOutgoToPdf(
            selectedCashOutgoRows,
            selectedReportTitle,
            cashOutgoExportDescription,
            cashOutgoEmptyMessage,
          );
  const exportCashOutgoExcel = () =>
    reportMode === "merData"
      ? exportExpectedCashOutgoToExcel(
          merExportRows,
          selectedReportTitle,
          cashOutgoExportDescription,
          cashOutgoEmptyMessage,
        )
      : reportMode === "currentMonthLiability"
        ? exportCurrentLiabilityToExcel(
            selectedCashOutgoRows,
            selectedReportTitle,
            cashOutgoExportDescription,
          )
        : exportExpectedCashOutgoToExcel(
            selectedCashOutgoRows,
            selectedReportTitle,
            cashOutgoExportDescription,
            cashOutgoEmptyMessage,
          );
  const soPaymentMatrixExportDescription = reportExportContextDescription;
  const exportSoPaymentMatrix = (format: "excel" | "pdf") =>
    exportSoPaymentMatrixReport(
      soPaymentMatrixRows,
      soPaymentMatrixColumns,
      soPaymentMatrixMonthKeys,
      selectedReportTitle,
      soPaymentMatrixExportDescription,
      format,
    );
  const exportPaymentCompletedMatrix = (format: "excel" | "pdf") =>
    exportSoPaymentMatrixReport(
      paymentCompletedMatrixRows,
      soPaymentMatrixColumns,
      soPaymentMatrixMonthKeys,
      selectedReportTitle,
      soPaymentMatrixExportDescription,
      format,
    );
  const exportMmgSummaryPdf = () =>
    exportMmgSummary(mmgSummaryRows, selectedReportTitle, "pdf", reportExportContextDescription);
  const exportMmgSummaryExcel = () =>
    exportMmgSummary(mmgSummaryRows, selectedReportTitle, "excel", reportExportContextDescription);
  const delayStatusExportDescription = getReportExportDescription(
    reportExportContextDescription,
    "Stages whose current milestone has remained open beyond the selected threshold.",
  );
  const exportDelayStatusPdf = () =>
    printDelayStatusToPdf(delayStatusRows, selectedReportTitle, delayStatusExportDescription);
  const exportDelayStatusExcel = () =>
    exportDelayStatusToExcel(delayStatusRows, selectedReportTitle, delayStatusExportDescription);
  const firmDatabaseExportDescription = getReportExportDescription(
    reportExportContextDescription,
    "Firm-wise supply order, value, delivery, BG, rating, and coverage analysis. Payment performance fields are excluded.",
  );
  const exportFirmDatabasePdf = () =>
    exportFirmDatabaseReport(
      firmDatabaseRows,
      visibleFirmReportColumns,
      selectedReportTitle,
      "pdf",
      firmDatabaseExportDescription,
    );
  const exportFirmDatabaseExcel = () =>
    exportFirmDatabaseReport(
      firmDatabaseRows,
      visibleFirmReportColumns,
      selectedReportTitle,
      "excel",
      firmDatabaseExportDescription,
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
    if (!uniqueFileIds.length) return;
    const sourceFocus = getMmgSummarySourceFocus(row.key);
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `fileIds:${uniqueFileIds.map(encodeURIComponent).join(",")}`,
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
    setFileCategoryFilterTouched(true);
    setSelectedFileCategories((current) =>
      checked
        ? visibleFileCategoryKeys.filter((key) => new Set([...current, category]).has(key))
        : current.filter((key) => key !== category),
    );
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
              <FileYearFilter
                value={activeFileYear}
                options={fileYearOptions}
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
                disabled={fileCategoryFilterDisabled}
                active={fileCategoryFilterActive}
                onChange={toggleFileCategory}
              />
              {isPreSoExpectedCashOutgoReport ? (
                <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                  Report is fixed for: Global filter = All active files; Subfilter = All file
                  years; Date range is blocked.
                </div>
              ) : null}
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
              paymentMode={demandAnalysisPaymentMode}
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
                    onReset={resetWarrantyBgBufferDays}
                  />
                ) : undefined
              }
              onPdf={() =>
                exportMonthlyOperationalReport(
                  selectedReportTitle,
                  getReportExportDescription(
                    reportExportContextDescription,
                    selectedMonthlyReport.description,
                  ),
                  selectedMonthlyReportExportColumns,
                  selectedMonthlyReportExportRows,
                  "pdf",
                )
              }
              onExcel={() =>
                exportMonthlyOperationalReport(
                  selectedReportTitle,
                  getReportExportDescription(
                    reportExportContextDescription,
                    selectedMonthlyReport.description,
                  ),
                  selectedMonthlyReportExportColumns,
                  selectedMonthlyReportExportRows,
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
              onPdf={() =>
                exportMonthlyOperationalReport(
                  selectedReportTitle,
                  getReportExportDescription(
                    reportExportContextDescription,
                    pendingLiabilityDescription,
                  ),
                  ageingReportColumns,
                  pendingLiabilityAgeingRows,
                  "pdf",
                )
              }
              onExcel={() =>
                exportMonthlyOperationalReport(
                  selectedReportTitle,
                  getReportExportDescription(
                    reportExportContextDescription,
                    pendingLiabilityDescription,
                  ),
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
          ) : reportMode === "cashOutGoPlan" ? (
            <CashOutGoPlanReport
              plan={cashOutGoPlan}
              loading={cashOutGoPlanLoading}
              saving={cashOutGoPlanSaving}
              dirty={cashOutGoPlanDirty}
              error={cashOutGoPlanError}
              includePreviousFy={cashOutGoPlanIncludePreviousFy}
              canEdit={canEditCashOutGoPlan}
              onIncludePreviousFyChange={setCashOutGoPlanIncludePreviousFy}
              onSettingChange={updateCashOutGoPlanSettings}
              onOffsetReset={resetCashOutGoPlanOffset}
              onRowChange={updateCashOutGoPlanRow}
              onExpectedSentDateReset={resetCashOutGoPlanExpectedSentDate}
              onBillOffsetOverrideReset={resetCashOutGoPlanBillOffsetOverride}
              onOpenSourceFile={openCashOutGoPlanSource}
              onOpenRowsSearch={openCashOutGoPlanRowsSearch}
              divisions={divisions}
              activeDivision={activeDivision}
              onDivisionChange={setSelectedDivision}
              onSave={persistCashOutGoPlan}
              saveDisabled={!cashOutGoPlanDirty}
              onPdf={(expandedSections) =>
                cashOutGoPlan &&
                exportCashOutGoPlan(
                  cashOutGoPlan,
                  "pdf",
                  reportExportContextDescription,
                  expandedSections,
                )
              }
              onExcel={(expandedSections) =>
                cashOutGoPlan &&
                exportCashOutGoPlan(
                  cashOutGoPlan,
                  "excel",
                  reportExportContextDescription,
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
              defaultOffset={preSoDefaultStageOffset}
              loading={preSoPlanLoading}
              saving={preSoPlanSaving}
              dirty={preSoPlanDirty}
              canSave={preSoPlanCanSave}
              canSaveStageOffsets={preSoPlanCanSaveStageOffsets}
              error={preSoPlanError}
              onSave={savePreSoPlan}
              currentYearContext={preSoCurrentYearContext}
              globalYearLabel={displayFinancialYearLabel(settings.selectedYear)}
              onFileDraftChange={updatePreSoFileDraft}
              onOpenFile={openPreSoFileInSearch}
            />
          ) : reportMode === "soPaymentMatrix" ? (
            <SoPaymentMatrixReport
              title={selectedReportTitle}
              titleHelper={reportModeHelperText.soPaymentMatrix}
              description="Shows pending expected payments month-wise for the current filtered file set."
              monthAmountHelper={[
                "Shows expected pending payment amount falling in this month.",
                "If more than one stage/payment event of the same S.O. falls in the month, the amounts are added.",
                "Click a non-zero amount to open the contributing file in Search.",
              ]}
              rows={soPaymentMatrixRows}
              selectedFields={soPaymentMatrixFields}
              fieldOptions={soPaymentMatrixFieldOptions}
              columns={soPaymentMatrixColumns}
              monthKeys={soPaymentMatrixMonthKeys}
              onFieldChange={toggleSoPaymentMatrixField}
              onResetFields={resetSoPaymentMatrixFields}
              onOpenRows={openSoPaymentMatrixSearch}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={() => exportSoPaymentMatrix("pdf")}
                  onExcel={() => exportSoPaymentMatrix("excel")}
                />
              }
            />
          ) : reportMode === "paymentCompletedMatrix" ? (
            <SoPaymentMatrixReport
              title={selectedReportTitle}
              titleHelper={reportModeHelperText.paymentCompletedMatrix}
              description="Shows completed payments month-wise for the current filtered file set."
              monthAmountHelper={[
                "Shows actual completed payment amount falling in this month.",
                "If more than one stage/payment event of the same S.O. falls in the month, the amounts are added.",
                "Click a non-zero amount to open the contributing file in Search.",
              ]}
              rows={paymentCompletedMatrixRows}
              selectedFields={soPaymentMatrixFields}
              fieldOptions={soPaymentMatrixFieldOptions}
              columns={soPaymentMatrixColumns}
              monthKeys={soPaymentMatrixMonthKeys}
              onFieldChange={toggleSoPaymentMatrixField}
              onResetFields={resetSoPaymentMatrixFields}
              onOpenRows={openSoPaymentMatrixSearch}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={() => exportPaymentCompletedMatrix("pdf")}
                  onExcel={() => exportPaymentCompletedMatrix("excel")}
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
  | "cashOutGoPlan"
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
type DrillPathItem = { label: string; href?: string };
const supplementaryBillInclusionNotes = {
  itemsDeliveredBillsPrepared: [
    "Includes returned supplementary bills pending correction/resubmission.",
  ],
  billsSubmitted: ["Includes supplementary bills sent/resubmitted to PCDA and unpaid."],
  spentTillDateFy: [
    "Includes paid supplementary bills by payment date.",
    "Supplementary actual amount is used; if blank, supplementary bill amount is used.",
    "For past months, entered MER values still override app-entered actuals.",
  ],
  billsPaidInMonth: [
    "Includes paid supplementary bills through Actual Cash Outgo by payment date.",
    "Supplementary actual amount is used; if blank, supplementary bill amount is used.",
  ],
  currentMonthLiability: [
    "Includes supplementary bills that are submitted/resubmitted and unpaid.",
  ],
  cashOutgoForMonth: ["Includes supplementary bills expected to be paid."],
  expectedExpenditureTillMonth: [
    "Includes supplementary bills submitted/resubmitted/returned.",
  ],
} satisfies Partial<Record<ReportMode, HelperText>>;
const reportModeHelperText = {
  mmgSummary: [
    "File Year restricts source files first.",
    "Date range, when enabled, filters the summary by Demand received date.",
  ],
  demandProcessingAnalysis: [
    "File Year restricts source files first.",
    "The selected pair is read as From date -> To date; the report calculates days between those two dates.",
    "Fields that would create an obvious reverse lifecycle pair are hidden from the opposite panel.",
    "Negative results are valid selected pairs where the To date is earlier than the From date, for example delivery completed before D.P. date. They are excluded from average/median/min/max and shown under Negative results.",
    "Unified payment means all payment routes are merged into one payment timeline: normal bills, stage bills, advance bills, returned/resubmitted bills, supplementary bills, and returned supplementary bills.",
    "Example: Unified bill submission/resubmission date -> Unified payment date measures payment delay from whichever bill submission/resubmission event applies to that payment.",
    "Date range, when enabled, filters demand processing by the selected From date.",
  ],
  firmDatabase: [
    "File Year restricts source files first.",
    "Without date range, values come from S.O.s inside those selected files.",
    "Date range, when enabled, further filters firm performance by S.O. date.",
  ],
  merData: [
    "MER corresponds to Global Filter F.Y.",
    "For Active files, MER uses the official Current FY.",
    "For Active + Current FY closed, MER uses the official Current FY.",
    "For a specific FY, MER uses that selected FY.",
    "File Year subfilter is not applied to this report.",
  ],
  supplementaryBillsPaid: [
    "Paid supplementary bills are counted by supplementary Payment Date.",
    "Supplementary actual amount is used; if blank, supplementary bill amount is used.",
    "Returned and paid supplementary bills are included.",
  ],
  soPaymentMatrix: [
    "Shows one row per S.O. with expected pending payment amount placed under the month in which payment is expected.",
    "It works for all file types; stage-payment S.O.s are read stage-wise and normal S.O.s are read from the main payment schedule.",
    "The field selector changes only the left-side descriptive columns. Apr-Mar month columns and payment calculation remain fixed.",
    "Rows without a derivable expected payment month inside the selected FY are not shown.",
  ],
  paymentCompletedMatrix: [
    "Shows one row per S.O. with completed payment amount placed under the actual payment month.",
    "It works for all file types; stage-payment S.O.s are read stage-wise and normal S.O.s are read from the main payment date.",
    "The field selector changes only the left-side descriptive columns. Apr-Mar month columns and payment calculation remain fixed.",
    "Rows without a completed payment month inside the selected FY are not shown.",
  ],
} satisfies Partial<Record<ReportMode, HelperText>>;
type HelperText = string | string[];
const CASH_OUT_GO_RED_ROW_HELPER =
  "A row turns red when Expected sent/resubmission date is before today and Actual sent date is still blank.";
const soPaymentMatrixDefaultFields: SoPaymentMatrixFieldKey[] = [
  "fileUniqueNo",
  "demandDescription",
  "soNo",
  "soDate",
  "firmName",
  "division",
];
const soPaymentMatrixFieldOptions: SoPaymentMatrixColumnOption[] = [
  {
    key: "fileUniqueNo",
    label: "File unique no.",
    helper: "Shows the file unique/control number for the S.O. row.",
  },
  {
    key: "demandDescription",
    label: "Demand description",
    helper: "Shows the demand/item description from the file.",
  },
  { key: "soNo", label: "S.O. No.", helper: "Shows S.O. No.; GEM S.O. No. is used if S.O. No. is blank." },
  { key: "soDate", label: "S.O. date", helper: "Shows the supply order date." },
  { key: "firmName", label: "Firm name", helper: "Shows the firm name recorded in the S.O." },
  { key: "division", label: "Division", helper: "Shows the file division." },
  {
    key: "fileCategory",
    label: "File category",
    helper: "Shows the file category/workflow group such as Goods & Services or Contract.",
  },
  { key: "fileType", label: "File type", helper: "Shows the file type such as AMC, MPC, CARS, CAPSI, O&M, etc." },
  { key: "indentor", label: "Indentor", helper: "Shows the file indentor." },
  { key: "mode", label: "Mode", helper: "Shows the procurement mode recorded in the file." },
  { key: "firmType", label: "Firm type", helper: "Shows the firm type recorded in the S.O." },
  {
    key: "demandInitiationYear",
    label: "Demand initiation year",
    helper: "Shows the financial year in which the file was initiated.",
  },
  {
    key: "demandValue",
    label: "Demand value",
    helper: "Shows Capital + Revenue demand value from the file.",
  },
  { key: "capitalValue", label: "Capital value", helper: "Shows the file capital demand value." },
  { key: "revenueValue", label: "Revenue value", helper: "Shows the file revenue demand value." },
  { key: "soValue", label: "S.O. value", helper: "Shows Capital + Revenue value of the S.O." },
  {
    key: "paymentBasis",
    label: "Payment basis",
    helper: "Shows whether the amount came from stage payment, bill submission, bill preparation, delivery/job completion, or D.P.",
  },
];
const fileYearSubfilterHelper = [
  "This is a File Initiation Year subfilter applied after the Global filter.",
  "Global filter decides the main file universe: all files, active files, active + current FY closed, or FY Activity.",
  "Report FY rule: All files / All active files / Active + current FY closed use Current FY from Settings for month columns, MER, and date defaults.",
  "Report FY rule: A specific FY in Global filter uses that same selected FY for month columns, MER, and date defaults.",
  "Future-year payments do not change previous-FY actual cash outgo. Previous-FY reports change only if dates/amounts/MER are backdated or edited into that FY.",
  "A specific FY here means files initiated in that FY only; it does not mean activity year.",
  "All file years means no extra initiation-year restriction inside the selected Global filter.",
  "When Global Filter is All files, the no-restriction option is labelled Entire database.",
  "Global All files + Entire database shows every accessible database file; Global All files + a specific FY shows every accessible file initiated in that FY.",
  "Example: Global FY Activity 2026-27 + File Year 2025-26 shows files initiated in 2025-26 that remained active/continued in 2026-27.",
  "After you change File Year, that choice stays for the current tab session.",
  "Lock keeps this File Year selection fixed on Dashboard and Reports until you unlock it.",
];
const fileInitiationDateRangeHelper = [
  "Further narrows the File Year Subfilter using exact file initiation date.",
  "Leave both dates blank when no initiation date restriction is required.",
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
      "merData",
      "cashOutGoPlan",
      "preSoExpectedCashOutgo",
      "soPaymentMatrix",
      "paymentCompletedMatrix",
    ]),
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
  const custom = reportModeHelperText[mode];
  const supplementary = supplementaryBillInclusionNotes[mode];
  const commonFilters =
    "Uses the current Global filter, File Year subfilter, initiation date range, division, file category, and user access wherever applicable. FY rule: All files / All active files / Active + current FY closed use Current FY from Settings; a specific Global FY uses that same FY. Future-year payments do not change previous-FY actual cash outgo unless data is backdated or edited into that FY.";
  if (custom && supplementary) return [...flattenHelperText(custom), ...flattenHelperText(supplementary)];
  if (custom) return custom;
  if (supplementary) return [commonFilters, ...flattenHelperText(supplementary)];
  if (mode === "cashOutGoPlan") {
    return [
      "Shows month-wise cash outgo planning using MER for past months and software forecast rows for pending payments.",
      "Editable row dates/offsets depend on the user's Cash Out Go Plan access level.",
      commonFilters,
    ];
  }
  if (mode === "preSoExpectedCashOutgo") {
    return [
      "Plans expected cash outgo for active files where S.O. is not yet placed.",
      "Report is fixed to All active files and All file years; initiation date range is blocked.",
    ];
  }
  if (mode === "itemsDeliveredBillsPending") {
    return [
      "Shows delivered/D.P. done cases where bill preparation is still pending.",
      "Expected payment is derived from the relevant delivery/job completion/D.P. trigger plus configured offset days.",
      commonFilters,
    ];
  }
  if (mode === "itemsDeliveredBillsPrepared") {
    return [
      "Shows delivered/D.P. done cases where bill is prepared but payment workflow is not completed.",
      "Date range, when enabled, filters by Bill preparation date.",
      commonFilters,
    ];
  }
  if (mode === "billsSubmitted") {
    return [
      "Shows bills sent/submitted to PCDA where payment is still pending.",
      "Date range, when enabled, filters by Bill sent/submission date.",
      commonFilters,
    ];
  }
  if (mode === "expectedCashOutgoFy") {
    return [
      "Shows expected cash outgo by D.P. for unpaid S.O.s in the selected FY.",
      "Rows are placed in month by D.P./revised D.P. plus offset logic.",
      commonFilters,
    ];
  }
  if (mode === "spentTillDateFy") {
    return [
      "Shows actual cash outgo by payment date.",
      "For past months, MER values can supersede software-entered actuals where MER is entered.",
      commonFilters,
    ];
  }
  if (mode === "billsPaidInMonth") {
    return [
      "Shows bills paid in the selected month.",
      "Normal and supplementary paid bill rows are included.",
      commonFilters,
    ];
  }
  if (mode === "cashOutgoForMonth") {
    return [
      "Shows expected cash outgo exclusively for the selected month.",
      "Combines bill-prepared, bill-sent/payment-pending, and D.P.-based expected rows.",
      commonFilters,
    ];
  }
  if (mode === "expectedExpenditureTillMonth") {
    return [
      "Shows expected expenditure up to the selected month.",
      "Combines actual cash outgo and expected pending expenditure up to that month.",
      commonFilters,
    ];
  }
  if (mode === "currentMonthLiability") {
    return [
      "Shows cumulative unpaid liability up to the selected month.",
      "Rows are included when payment remains pending as on that month context.",
      commonFilters,
    ];
  }
  if (isReturnedBillReportMode(mode)) {
    return [
      "Tracks returned bill rows by the selected returned-bill status.",
      "Date range, when enabled, filters by the returned-bill event relevant to this report.",
      commonFilters,
    ];
  }
  if (
    mode === "supplementaryBillsSubmitted" ||
    mode === "supplementaryPendingReturnedBills" ||
    mode === "supplementaryReturnedBillsResubmitted" ||
    mode === "supplementaryReturnedBillsPaid"
  ) {
    return [
      "Tracks supplementary bill rows by the selected supplementary-bill status.",
      "Date range, when enabled, filters by the relevant supplementary-bill event date.",
      commonFilters,
    ];
  }
  if (mode === "monthlyFileInflow") {
    return ["Shows month-wise file inflow based on demand/file initiation dates.", commonFilters];
  }
  if (mode === "monthWiseSupplyOrder") {
    return ["Shows month-wise S.O. placement counts/values by S.O. date.", commonFilters];
  }
  if (mode === "monthWiseDeliverySchedule") {
    return ["Shows month-wise delivery schedule by D.P./revised D.P. dates.", commonFilters];
  }
  if (mode === "monthWiseCompletedDeliveries") {
    return [
      "Shows month-wise completed deliveries/job completions.",
      "Uses material receipt date where delivery/inspection applies and job completion date where applicable.",
      commonFilters,
    ];
  }
  if (mode === "monthWiseBgExpiry") {
    return ["Shows month-wise BG expiry based on BG validity dates.", commonFilters];
  }
  if (mode === "preBidMeetings") {
    return ["Shows pre-bid meeting schedule/status by applicable pre-bid meeting dates.", commonFilters];
  }
  if (mode === "bgReceiptDelay") {
    return [
      "Shows BG receipt delay using the selected delay-day thresholds.",
      "Delay is calculated only where BG is applicable and receipt is due/pending.",
      commonFilters,
    ];
  }
  if (mode === "warrantyBgMismatch") {
    return [
      "Shows warranty/BG validity mismatch cases using the selected buffer days.",
      "Uses recorded warranty/BG validity dates for comparison.",
      commonFilters,
    ];
  }
  if (mode === "delayStatus") {
    return [
      "Shows files currently stuck beyond the selected delay threshold at their current stage.",
      "Milestones already cleared before the delay limit are not counted as current delay.",
      commonFilters,
    ];
  }
  if (mode === "pendingLiabilityAgeing") {
    return [
      "Shows unpaid liabilities grouped by ageing bucket as on the selected date.",
      "Ageing starts from delivery/job completion, bill preparation, or bill sent trigger as applicable.",
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

function isFileYearFilterDisabledReport(mode: ReportMode) {
  return mode === "merData" || mode === "cashOutGoPlan" || mode === "preSoExpectedCashOutgo";
}

function isFileCategoryFilterDisabledReport(mode: ReportMode) {
  return mode === "merData" || mode === "cashOutGoPlan";
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

function getDateRangeHelperText(mode: ReportMode): HelperText {
  const commonPrefix = "Global filter, division, file category, and File Year are applied first.";
  if (mode === "mmgSummary") {
    return ["Date range filters source files by Demand received date.", commonPrefix];
  }
  if (mode === "demandProcessingAnalysis") {
    return [
      "Date range filters rows by the selected From field date in Demand Processing analysis.",
      commonPrefix,
    ];
  }
  if (mode === "firmDatabase") {
    return ["Date range filters Firm Performance by S.O. date.", commonPrefix];
  }
  if (mode === "itemsDeliveredBillsPending") {
    return [
      "Date range filters by delivery/job completion date or D.P. basis date.",
      "To date is also used as the as-on date for pending bill preparation checks.",
      commonPrefix,
    ];
  }
  if (mode === "itemsDeliveredBillsPrepared") {
    return [
      "Date range filters by Bill preparation date.",
      "To date is also used as the as-on date for pending bill submission/payment checks.",
      commonPrefix,
    ];
  }
  if (mode === "billsSubmitted") {
    return [
      "Date range filters by Bill sent/submission date.",
      "To date is also used as the as-on date for pending payment checks.",
      commonPrefix,
    ];
  }
  if (mode === "spentTillDateFy" || mode === "supplementaryBillsPaid") {
    return ["Date range filters by payment date.", commonPrefix];
  }
  if (
    mode === "pendingReturnedBills" ||
    mode === "returnedBillsResubmitted" ||
    mode === "returnedBillsPaid"
  ) {
    return [
      "Date range filters by the returned-bill event date relevant to this report.",
      commonPrefix,
    ];
  }
  if (mode === "supplementaryBillsSubmitted") {
    return [
      "Date range filters by supplementary bill sent/resubmitted date.",
      "To date is also used as the as-on date for pending payment checks.",
      commonPrefix,
    ];
  }
  if (
    mode === "supplementaryPendingReturnedBills" ||
    mode === "supplementaryReturnedBillsResubmitted" ||
    mode === "supplementaryReturnedBillsPaid"
  ) {
    return [
      "Date range filters by the supplementary returned-bill event date relevant to this report.",
      commonPrefix,
    ];
  }
  return ["Date range filters this report by its primary transaction date.", commonPrefix];
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

function getCashOutgoTitleHelper(mode: ReportMode): HelperText | undefined {
  if (mode === "soPaymentMatrix") return reportModeHelperText.soPaymentMatrix;
  if (mode === "paymentCompletedMatrix") return reportModeHelperText.paymentCompletedMatrix;
  if (mode === "supplementaryBillsPaid") return reportModeHelperText.supplementaryBillsPaid;
  return supplementaryBillInclusionNotes[mode];
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
    `Global filter: ${displayFinancialYearLabel(globalYear)}`,
    `File Year Subfilter: ${formatFileYearSubfilterExportLabel(
      globalYear,
      fileYear,
      fileYearFilterDisabled,
    )}`,
    `Initiation date range: ${
      fileYearFilterDisabled ? "Not applied" : formatExportDateRange(fileInitiationDateRange)
    }`,
    `Division: ${division === "all" ? "All accessible divisions" : division}`,
    `File Category: ${
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
    `Global filter: ${displayFinancialYearLabel(globalYear)}`,
    `File Year Subfilter: ${formatFileYearSubfilterExportLabel(
      globalYear,
      fileYear,
      fileYearFilterDisabled,
    )}`,
    `Initiation date range: ${
      fileYearFilterDisabled ? "Not applied" : formatExportDateRange(fileInitiationDateRange)
    }`,
    `Division: ${division === "all" ? "All accessible divisions" : division}`,
    `File Category: ${
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

function getMonthlyReportExportRows(
  report: MonthlyReportConfig,
  breakupYear?: string,
): Array<Record<string, number | string>> {
  if (!report.monthRowsByYear) return report.rows;
  if (breakupYear) return report.monthRowsByYear[breakupYear] ?? [];
  return Object.keys(report.monthRowsByYear)
    .sort()
    .flatMap((year) => report.monthRowsByYear?.[year] ?? []);
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
  fileCount: number;
  average: number;
  median: number;
  min: number;
  max: number;
  negative: number;
  negativeFileCount: number;
};
type DemandProcessingAnalysisUnit = "demand" | "order" | "stage" | "advance";
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
            Average date gap calculated from records where both selected dates are filled.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
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
                  "Segregates unified payment analysis by Online or Offline payment mode.",
                  "Any includes both modes and rows where mode is blank.",
                  "Online/Offline works best with unified payment date fields because those merge normal, stage, advance, returned, and supplementary bill flows.",
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

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <DemandMetric
            label="File count"
            value={stats.fileCount}
            onClick={onOpenUsed}
            helperText={[
              `${getAnalysisUnitCountLabel(analysisUnit)} may be higher when one file has multiple matching rows.`,
              "The clicker opens files in Search, so this tile shows unique file count.",
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
              "These are rows where the selected To date is earlier than the selected From date.",
              "They can happen even for logically correct pairs, for example delivery completed before D.P. date.",
              "Negative results are excluded from average, median, minimum, and maximum days.",
              "This tile shows unique file count because the clicker opens matching files in Search.",
            ]}
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
              unlocked={selectedDaysUnlocked}
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
              Date range
              {helperText ? (
                <FloatingHelper
                  text={helperText}
                  label="Date range help"
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
            unlocked={selectedDaysUnlocked}
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
  unlocked,
  onValueChange,
  onUnlockedChange,
  onSave,
  onReset,
}: {
  value: string;
  unlocked: boolean;
  onValueChange: (value: string) => void;
  onUnlockedChange?: (unlocked: boolean) => void;
  onSave?: () => void;
  onReset?: () => void;
}) {
  const normalizedDays = normalizeExpectedCashOutgoDays(value);
  const active = unlocked || normalizedDays !== String(DEFAULT_DP_OFFSET_DAYS);
  return (
    <div className={filterLabelClass(active, "w-[190px] text-xs font-medium")}>
      <span className="mb-1 flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
        Days after base date
        <FloatingHelper
          text="Default is 10 days. Use reset to restore the default days."
          className="size-5 border-0 bg-transparent shadow-none"
          iconClassName="size-3"
        />
      </span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          min="0"
          value={unlocked ? value : normalizedDays}
          disabled={!unlocked}
          onChange={(event) => onValueChange(event.target.value)}
          className={filterControlClass(
            active,
            "h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-70",
          )}
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
        <FloatingHelper
          text={[
            "Lock/Unlock controls whether this days field can be edited.",
            "This is saved in this browser for the current logged-in user; it is not a global software setting.",
            "Locked uses the current browser-saved/default value.",
            "Unlocked allows temporary editing before saving or resetting.",
          ]}
          label="Lock or unlock days help"
          className="size-8 border-0 bg-transparent shadow-none"
          iconClassName="size-3"
        />
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
        <FloatingHelper
          text="Save stores the currently entered days value in this browser for the current logged-in user."
          label="Save days help"
          className="size-8 border-0 bg-transparent shadow-none"
          iconClassName="size-3"
        />
        <button
          type="button"
          onClick={onReset}
          disabled={!onReset}
          className="btn-ghost h-9 w-9 p-0"
          title="Reset offset days"
          aria-label="Reset offset days"
        >
          <RotateCcw className="size-4" />
        </button>
        <FloatingHelper
          text="Reset clears the custom browser-saved value and restores this control to its software default."
          label="Reset days help"
          className="size-8 border-0 bg-transparent shadow-none"
          iconClassName="size-3"
        />
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
            "This buffer is saved in this browser for the current logged-in user; it is not a global software setting.",
            "Unlock to change the warranty BG buffer.",
            "Reset restores the default 60-day buffer for this browser/user.",
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
          Buffer days
          <FloatingHelper
            text="Default is 60 days. Use reset to restore the default browser/user value."
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
        text="Reset restores the warranty BG buffer to the default 60 days in this browser for the current logged-in user."
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
  const divisionFilterActive = activeDivision !== "all";
  return (
    <>
      {showDivision ? (
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
            <option value="all">Divisions</option>
            {divisions.map((division) => (
              <option key={division.id} value={division.name}>
                {division.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {onPdf || onExcel ? (
        <div className="inline-flex h-9 overflow-hidden rounded-md border border-border bg-card">
          {onPdf ? (
            <button
              type="button"
              onClick={onPdf}
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
              onClick={onExcel}
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
}: {
  selectedCategories: FileCategoryKey[];
  options: FileCategoryOption[];
  disabled?: boolean;
  active?: boolean;
  onChange: (category: FileCategoryKey, checked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedVisibleCount = options.filter((option) =>
    selectedCategories.includes(option.key),
  ).length;
  const summary = `${selectedVisibleCount}/${options.length} selected`;

  return (
    <div className={filterLabelClass(active, "flex flex-col gap-1 text-xs text-muted-foreground")}>
      <span>File category</span>
      <div
        className={
          filterControlClass(active, "rounded-md border border-input bg-background") +
          (disabled ? " opacity-60" : "")
        }
      >
        <button
          type="button"
          aria-expanded={open}
          disabled={disabled}
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
        {open && !disabled ? (
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
  const helperText = disabled
    ? [
        "File Year is not used for this report.",
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
          File year
          <FloatingHelper
            text={helperText}
            label="File year subfilter help"
            side="top"
            className="size-5 border-0 bg-transparent shadow-none"
            iconClassName="size-3"
          />
        </span>
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={filterControlClass(
            active,
            "h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
          )}
        >
          <option value="all">{allOptionLabel}</option>
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
        disabled={disabled}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:hover:bg-muted"
        title={
          disabled
            ? "File year is not used for this report"
            : locked
              ? "Unlock file year"
              : "Lock file year"
        }
        aria-label={
          disabled
            ? "File year is not used for this report"
            : locked
              ? "Unlock file year"
              : "Lock file year"
        }
      >
        {locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
      </button>
      <FloatingHelper
        text={[
          "This lock is session based; it is kept only for the current browser session/tab.",
          "Lock keeps this File Year selection fixed on Dashboard and Reports until you unlock it or the session resets.",
          "Unlock allows the File Year subfilter to follow changes again.",
        ]}
        label="File year lock help"
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
  const [divisionPopupRow, setDivisionPopupRow] = useState<FirmDatabaseRow | undefined>();
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
                        formatThousandsAndLakhs(capital)
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {editing && canEdit ? (
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
          text={`Reset restores ${label} to the default ${defaultDays} days. Cash Out Go Plan offsets are saved to the database only when you use Save settings/Save plan, according to your access level.`}
          label={`${label} reset help`}
          className="size-8 border-0 bg-transparent shadow-none"
          iconClassName="size-3"
        />
      </span>
    </div>
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
  onIncludePreviousFyChange,
  onSettingChange,
  onOffsetReset,
  onRowChange,
  onExpectedSentDateReset,
  onBillOffsetOverrideReset,
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
  canEdit: boolean;
  onIncludePreviousFyChange: (value: boolean) => void;
  onSettingChange: (
    field: "billOffsetDays" | "handSubmissionOffsetDays" | "dpOffsetDays",
    value: string,
  ) => void;
  onOffsetReset: (field: "billOffsetDays" | "handSubmissionOffsetDays" | "dpOffsetDays") => void;
  onRowChange: (
    rowKey: string,
    field: "expectedSentDate" | "billOffsetOverride" | "manualExpectedPaymentDate",
    value: string,
  ) => void;
  onExpectedSentDateReset: (rowKey: string) => void;
  onBillOffsetOverrideReset: (rowKey: string) => void;
  onOpenSourceFile: (row: CashOutGoPlanDetailRow) => void;
  onOpenRowsSearch: (rows: CashOutGoPlanDetailRow[]) => void;
  divisions: Division[];
  activeDivision: string;
  onDivisionChange: (division: string) => void;
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
  const handSubmissionOffsetActive = Boolean(plan?.settings.useCustomHandSubmissionOffsetDays);
  const billPaymentOffsetActive = Boolean(plan?.settings.useCustomBillOffsetDays);
  const dpOffsetActive = Boolean(plan?.settings.useCustomDpOffsetDays);
  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold">Cash Out Go Plan</h2>
              <FloatingHelper
                text={[
                  "Admin, Sub-admin and Editor can save the official/global Cash Out Go Plan.",
                  "Universal Viewer type 1 - View only: can vary filters/view results but cannot save Cash Out Go Plan or MER.",
                  "Universal Viewer type 2 - Personal Cash Out Go only: can save Cash Out Go Plan offsets and row dates for that own account only.",
                  "Universal Viewer type 3 - Global Cash Out Go + MER: can save the official/global Cash Out Go Plan and MER for the software.",
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
            <button
              type="button"
              className="btn-ghost h-9 px-3"
              onClick={() => onPdf(expandedDetailSections)}
              disabled={!plan}
            >
              <FileText className="size-4" />
              PDF
            </button>
            <button
              type="button"
              className="btn-ghost h-9 px-3"
              onClick={() => onExcel(expandedDetailSections)}
              disabled={!plan}
            >
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
          <CashOutGoPlanOffsetControl
            label="Bill submission offset"
            defaultDays={DEFAULT_BILL_SUBMISSION_OFFSET_DAYS}
            customDays={plan?.settings.handSubmissionOffsetDays}
            customEnabled={Boolean(plan?.settings.useCustomHandSubmissionOffsetDays)}
            disabled={!plan || !canEdit}
            active={handSubmissionOffsetActive}
            helperText={[
              "Used for Bills at Hand rows.",
              "Default is 5 days.",
              "If the entered value is different from default, it is treated as custom and highlighted red.",
              "Reset returns this offset to default.",
            ]}
            onCustomDaysChange={(value) => onSettingChange("handSubmissionOffsetDays", value)}
            onReset={() => onOffsetReset("handSubmissionOffsetDays")}
          />
          <CashOutGoPlanOffsetControl
            label="Bill payment offset"
            defaultDays={DEFAULT_BILL_PAYMENT_OFFSET_DAYS}
            customDays={plan?.settings.billOffsetDays}
            customEnabled={Boolean(plan?.settings.useCustomBillOffsetDays)}
            disabled={!plan || !canEdit}
            active={billPaymentOffsetActive}
            helperText={[
              "Used to calculate Expected payment after a bill is sent/resubmitted.",
              "Default is 5 days.",
              "Row Payment Offset Override applies only to that row and supersedes this value.",
              "If the entered value is different from default, it is treated as custom and highlighted red.",
              "Reset returns this offset to default.",
            ]}
            onCustomDaysChange={(value) => onSettingChange("billOffsetDays", value)}
            onReset={() => onOffsetReset("billOffsetDays")}
          />
          <CashOutGoPlanOffsetControl
            label="D.P. offset"
            defaultDays={DEFAULT_DP_OFFSET_DAYS}
            customDays={plan?.settings.dpOffsetDays}
            customEnabled={Boolean(plan?.settings.useCustomDpOffsetDays)}
            disabled={!plan || !canEdit}
            active={dpOffsetActive}
            helperText={[
              "Used for D.P.-based expected sent/resubmission dates.",
              "Default is 10 days.",
              "For Items Based on D.P., one extra day is added after D.P. before this offset.",
              "If the entered value is different from default, it is treated as custom and highlighted red.",
              "Reset returns this offset to default.",
            ]}
            onCustomDaysChange={(value) => onSettingChange("dpOffsetDays", value)}
            onReset={() => onOffsetReset("dpOffsetDays")}
          />
          {canEdit ? (
          <div className="flex items-end gap-1">
            <button
              type="button"
              className="btn-ghost h-9 px-2 text-xs"
              onClick={onSave}
              disabled={!plan || saving || !dirty}
              title="Save Cash Out Go Plan settings and row overrides to backend global settings"
            >
              <Save className="size-3.5" />
              Save settings
            </button>
            <FloatingHelper
              text={[
                "This save is not browser-session only.",
                "It saves Cash Out Go Plan settings and row overrides to the backend.",
                "The saved scope depends on access: Admin/Sub-admin/Editor and Universal Viewer type 3 save the official/global plan; Universal Viewer type 2 saves only that viewer's personal plan.",
              ]}
              label="Save settings help"
              className="size-8"
              iconClassName="size-3"
            />
          </div>
          ) : null}
          <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium">
            <input
              type="checkbox"
              checked={includePreviousFy}
              onChange={(event) => onIncludePreviousFyChange(event.target.checked)}
            />
            Include previous FY submitted bills
            <PreviousFySubmittedBillsHelper
              label="Previous FY submitted bills help"
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
          <CashOutGoSummaryTable plan={plan} onOpenRowsSearch={onOpenRowsSearch} />
          <CashOutGoMonthTable
            rows={plan.expenditureTillDate}
            title="Expenditure Till Date"
            titleHelper={[
              "For past months, MER values supersede software payment entries when MER has capital or revenue value.",
              "If MER is blank for a past month, software payment entries are used.",
              "The current month is always shown, even if zero, using software payment entries.",
            ]}
          />
          <CashOutGoDetailTable
            title="Bills Submitted to PCDA"
            helperText={[
              "Shows bills already sent/submitted to PCDA where payment is still expected.",
              "Expected payment date is calculated from sent/submission date plus payment offset days unless manually overridden.",
              CASH_OUT_GO_RED_ROW_HELPER,
            ]}
            rows={plan.billsSubmitted}
            open={expandedDetailSections.billsSubmitted}
            onOpenChange={(open) =>
              setExpandedDetailSections((current) => ({ ...current, billsSubmitted: open }))
            }
            onRowChange={onRowChange}
            onExpectedSentDateReset={onExpectedSentDateReset}
            onBillOffsetOverrideReset={onBillOffsetOverrideReset}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            editable={canEdit}
            saving={saving}
            saveDisabled={saveDisabled}
          />
          <CashOutGoDetailTable
            title="Bills at Hand"
            helperText={[
              "Expected sent/resubmission is calculated from the base date plus Bill submission Offset Days. Edit the date for a row if a specific submission/resubmission date is expected.",
              CASH_OUT_GO_RED_ROW_HELPER,
            ]}
            rows={plan.billsAtHand}
            open={expandedDetailSections.billsAtHand}
            onOpenChange={(open) =>
              setExpandedDetailSections((current) => ({ ...current, billsAtHand: open }))
            }
            onRowChange={onRowChange}
            onExpectedSentDateReset={onExpectedSentDateReset}
            onBillOffsetOverrideReset={onBillOffsetOverrideReset}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            editable={canEdit}
            saving={saving}
            saveDisabled={saveDisabled}
          />
          <CashOutGoDetailTable
            title="Items Delivered and Bills Yet to Be Prepared"
            helperText={[
              "Expected sent/resubmission is calculated as base date plus D.P. offset days. Base date is Material Receipt Date when delivery/inspection applies; otherwise it is Job Completion Date for non-contract IR No files, or Revised D.P./D.P. date plus one day for files like MPC, AMC etc.",
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
            onBillOffsetOverrideReset={onBillOffsetOverrideReset}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            editable={canEdit}
            saving={saving}
            saveDisabled={saveDisabled}
          />
          <CashOutGoDetailTable
            title="Items Based on D.P."
            helperText={[
              "Forecasts bills from D.P. dates where delivery/job completion is not yet recorded.",
              "Expected sent/resubmission is calculated from D.P. plus one day and D.P. offset days.",
              "D.P. dates after 31 March of the selected FY are excluded.",
              "If expected payment goes beyond 31 March of the selected FY, the row remains visible but counts as zero in the plan.",
              CASH_OUT_GO_RED_ROW_HELPER,
            ]}
            rows={plan.dpBasedForecast ?? []}
            open={expandedDetailSections.dpBasedForecast}
            onOpenChange={(open) =>
              setExpandedDetailSections((current) => ({ ...current, dpBasedForecast: open }))
            }
            onRowChange={onRowChange}
            onExpectedSentDateReset={onExpectedSentDateReset}
            onBillOffsetOverrideReset={onBillOffsetOverrideReset}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            editable={canEdit}
            saving={saving}
            saveDisabled={saveDisabled}
            dpOnly
          />
          <CashOutGoDetailTable
            title="D.P. Expired"
            helperText={[
              "Shows D.P. expired cases included for expected payment planning.",
              CASH_OUT_GO_RED_ROW_HELPER,
            ]}
            rows={plan.dpExpired ?? []}
            open={expandedDetailSections.dpExpired}
            onOpenChange={(open) =>
              setExpandedDetailSections((current) => ({ ...current, dpExpired: open }))
            }
            onRowChange={onRowChange}
            onExpectedSentDateReset={onExpectedSentDateReset}
            onBillOffsetOverrideReset={onBillOffsetOverrideReset}
            onOpenFile={onOpenSourceFile}
            onOpenRowsSearch={onOpenRowsSearch}
            onSave={onSave}
            editable={canEdit}
            saving={saving}
            saveDisabled={saveDisabled}
            expectedPaymentEditable
            dpOnly
          />
          <CashOutGoMonthTable
            rows={plan.monthwisePlan}
            title="Monthwise Revised Cash Out Go Plan"
            titleHelper={[
              "For past months, MER values supersede software payment entries when MER has capital or revenue value.",
              "For current and future months, the plan uses software entries and forecasts from bills submitted, bills at hand, delivered items, D.P.-based forecast, and D.P. expired cases.",
              "Use this as the consolidated month-wise projection for expected expenditure.",
            ]}
          />
          <CashOutGoTotalExpectedTable plan={plan} />
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
  defaultOffset,
  loading,
  saving,
  dirty,
  canSave,
  canSaveStageOffsets,
  error,
  onSave,
  currentYearContext,
  globalYearLabel,
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
  defaultOffset: PreSoStageOffset;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  canSave: boolean;
  canSaveStageOffsets: boolean;
  error?: string;
  onSave: () => void;
  currentYearContext: boolean;
  globalYearLabel: string;
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
            <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
              Global filter: {globalYearLabel || "-"}
            </div>
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
                  text="Save plan stores selected Pre-S.O. files, tentative dates, and stage offset settings in the database according to the user's permitted scope."
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

      {activeTab === "stages" ? (
        <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <h3 className="mb-3 text-sm font-semibold">Stages</h3>
          <p className="mb-4 text-xs text-muted-foreground">
            Select one or more Status-4 stages. Stage-wise default offset days are used to calculate
            tentative S.O. and payment dates unless manually entered against a file.
          </p>
          {!canSaveStageOffsets ? (
            <div className="mb-4 rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
              Stage offset defaults are controlled globally by Admin/Sub-admin. You can still save
              file selection and tentative dates where permitted.
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
                    text="Reset restores this stage to the current default S.O. and payment offset days. Changes are saved to the database only when Save plan is used."
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
                              <th className="px-3 py-2 text-left font-medium">File</th>
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
                                      "Example: if today is 12-09-2026 and S.O. offset is 30 days, tentative S.O. date becomes 12-10-2026.",
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
                                      {getPreSoFileRef(row.file)}
                                    </button>
                                  </td>
                                  <td className="px-3 py-2">{row.file.demandDescription || "-"}</td>
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
                                    <input
                                      type="date"
                                      value={row.draft.tentativeSoDate || row.calculatedSoDate}
                                      disabled={!row.draft.included}
                                      onChange={(event) =>
                                        onFileDraftChange(row.file.id, {
                                          tentativeSoDate: event.target.value,
                                        })
                                      }
                                      className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="date"
                                      value={row.draft.tentativePaymentDate || row.calculatedPaymentDate}
                                      disabled={!row.draft.included}
                                      onChange={(event) =>
                                        onFileDraftChange(row.file.id, {
                                          tentativePaymentDate: event.target.value,
                                        })
                                      }
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
                        {formatCurrency(row.capital)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(row.revenue)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(row.total)}
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
                        {formatCurrency(row.capital)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(row.revenue)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(row.total)}
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
                        "groupLabel" in row
                          ? `${row.groupKey}:${row.monthKey}`
                          : row.monthKey
                      }
                      className="border-t border-border"
                    >
                      {"groupLabel" in row ? (
                        <td className="px-3 py-2">{row.groupLabel}</td>
                      ) : null}
                      <td className="px-3 py-2">{formatMonthKeyLabel(row.monthKey)}</td>
                      <td className="px-3 py-2 text-right">{row.count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(row.capital)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(row.revenue)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(row.total)}
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
  fieldOptions,
  columns,
  monthKeys,
  actions,
  onFieldChange,
  onResetFields,
  onOpenRows,
}: {
  title: string;
  titleHelper?: HelperText;
  description: string;
  monthAmountHelper: HelperText;
  rows: SoPaymentMatrixRow[];
  selectedFields: SoPaymentMatrixFieldKey[];
  fieldOptions: SoPaymentMatrixColumnOption[];
  columns: SoPaymentMatrixColumnOption[];
  monthKeys: string[];
  actions?: ReactNode;
  onFieldChange: (fieldKey: SoPaymentMatrixFieldKey, checked: boolean) => void;
  onResetFields: () => void;
  onOpenRows: (rows: SoPaymentMatrixRow[], monthKey?: string) => void;
}) {
  const [fieldsDropdownOpen, setFieldsDropdownOpen] = useState(false);
  const monthTotals = monthKeys.map((monthKey) => ({
    monthKey,
    amount: rows.reduce((sum, row) => sum + (row.monthAmounts[monthKey] ?? 0), 0),
  }));
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
        {actions}
      </div>

      <div className="mb-4 rounded-lg border border-border bg-secondary/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Select file fields
            <FloatingHelper
              text={[
                "Select one or more file/S.O. fields to show on the left side of the matrix.",
                "Apr-Mar month columns are fixed and always show expected pending payment amount.",
                "Changing these fields does not change report filtering or payment calculation.",
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
              className="rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Reset fields
            </button>
          </div>
        </div>
      </div>

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
                      {getSoPaymentMatrixFieldValue(row, column.key)}
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
                            {formatCurrency(amount)}
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
                      {formatCurrency(row.total)}
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
                        {formatCurrency(total.amount)}
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCurrency(grandTotal)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function getPreSoStageOptions(): PreSoStageOption[] {
  const supplyOrderIndex = milestoneDefinitions.findIndex((milestone) => milestone.key === "supplyOrder");
  const preSoMilestones =
    supplyOrderIndex >= 0 ? milestoneDefinitions.slice(0, supplyOrderIndex) : milestoneDefinitions;
  const requiredBgMilestones = milestoneDefinitions.filter(
    (milestone) => milestone.key === "psb" || milestone.key === "psbPwb",
  );
  return [
    { key: "workflowNotStarted", label: "Workflow Not Started" },
    ...preSoMilestones.map((milestone) => ({ key: milestone.key, label: milestone.label })),
    { key: "financialSanction", label: "Financial Sanction" },
    ...requiredBgMilestones.map((milestone) => ({ key: milestone.key, label: milestone.label })),
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
  return file.uniqueCode || file.imms || file.fileNo || file.title || file.id;
}

function formatPreSoSelectFilesCurrency(value: number) {
  return `${formatThousandsAndLakhs(value / 100_000, 2)} L`;
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
    ),
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
      ...expandedDetailTables,
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
        headers: ["Capital", "Revenue", "Total"],
        rows: [
          [
            formatCurrency(getCashOutGoTotalExpectedRow(plan).capital),
            formatCurrency(getCashOutGoTotalExpectedRow(plan).revenue),
            formatCurrency(getCashOutGoTotalExpectedRow(plan).total),
          ],
        ],
      },
    ],
  });
}

const cashOutGoPlanDetailExportColumns = [
  "File",
  "Description",
  "Firm",
  "Source",
  "Base date",
  "Expected sent/resubmission",
  "Payment Offset",
  "Expected payment",
  "Capital",
  "Revenue",
  "Total",
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
    { key: "billsAtHand", title: "Bills at Hand", rows: plan.billsAtHand },
    {
      key: "deliveredBillsPending",
      title: "Items Delivered and Bills Yet to Be Prepared",
      rows: plan.deliveredBillsPending,
    },
    { key: "dpBasedForecast", title: "Items Based on D.P.", rows: plan.dpBasedForecast ?? [] },
    { key: "dpExpired", title: "D.P. Expired", rows: plan.dpExpired ?? [] },
  ];

  return sections
    .filter((section) => expandedSections[section.key])
    .map((section) => ({
      title: section.title,
      headers: cashOutGoPlanDetailExportColumns,
      rows: section.rows.map(getCashOutGoPlanDetailExportRow),
    }));
}

function getCashOutGoPlanDetailExportRow(row: CashOutGoPlanDetailRow) {
  const sentOrExpectedDate = row.actualSentDate
    ? `Actual sent: ${row.actualSentDate}`
    : row.expectedSentDate || "";
  const paymentOffset = row.billOffsetOverride
    ? `${row.billOffsetOverride} days (override)`
    : `${row.billOffsetDays} days`;

  return [
    row.fileRef,
    row.description,
    row.firm,
    row.amountSource,
    row.baseDate,
    sentOrExpectedDate,
    paymentOffset,
    row.expectedPaymentDate,
    formatCurrency(row.capital),
    formatCurrency(row.revenue),
    formatCurrency(row.total),
  ];
}

function CashOutGoMonthTable({
  rows,
  title,
  titleHelper,
}: {
  rows: ExpectedCashOutgoRow[];
  title: string;
  titleHelper?: HelperText;
}) {
  return (
    <CashOutgoReport
      rows={rows}
      title={title}
      titleHelper={titleHelper}
      emptyMessage="No rows found."
    />
  );
}

function CashOutGoTotalExpectedTable({ plan }: { plan: CashOutGoPlanPayload }) {
  const row = getCashOutGoTotalExpectedRow(plan);
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
      <h2 className="text-base font-bold">Total Expected Expenditure</h2>
      <div className="mt-5 overflow-hidden rounded-lg border border-border">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
              <th className="px-3 py-2.5 text-right font-semibold">Capital</th>
              <th className="px-3 py-2.5 text-right font-semibold">Revenue</th>
              <th className="px-3 py-2.5 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-card">
              <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(row.capital)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(row.revenue)}</td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums">
                {formatCurrency(row.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CashOutGoDetailTable({
  title,
  helperText,
  rows,
  onRowChange,
  onExpectedSentDateReset,
  onBillOffsetOverrideReset,
  onOpenFile,
  onOpenRowsSearch,
  onSave,
  editable = true,
  saving = false,
  saveDisabled = false,
  expectedPaymentEditable = false,
  dpOnly = false,
  open,
  onOpenChange,
}: {
  title: string;
  helperText?: HelperText;
  rows: CashOutGoPlanDetailRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRowChange: (
    rowKey: string,
    field: "expectedSentDate" | "billOffsetOverride" | "manualExpectedPaymentDate",
    value: string,
  ) => void;
  onExpectedSentDateReset?: (rowKey: string) => void;
  onBillOffsetOverrideReset?: (rowKey: string) => void;
  onOpenFile?: (row: CashOutGoPlanDetailRow) => void;
  onOpenRowsSearch?: (rows: CashOutGoPlanDetailRow[]) => void;
  onSave?: () => void;
  editable?: boolean;
  saving?: boolean;
  saveDisabled?: boolean;
  expectedPaymentEditable?: boolean;
  dpOnly?: boolean;
}) {
  const totals = getCashOutGoSectionTotals(rows);
  const columnCount = 11;
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
              <th className="px-3 py-2">
                <span className="inline-flex items-center gap-1.5">
                  Expected sent/resubmission
                  <FloatingHelper
                    text={[
                      "This is the expected date for sending or resubmitting the bill.",
                      "If you edit this field, it becomes a manual row override and is highlighted red.",
                      "Use the reset icon beside Save to clear the manual override and return to the software-calculated date.",
                      "Changing this date also changes Expected payment because payment is calculated after bill sent/resubmission.",
                    ]}
                    className="size-5 border-0 bg-transparent shadow-none"
                    iconClassName="size-3"
                  />
                </span>
              </th>
              <th className="px-3 py-2">
                <span className="inline-flex items-center gap-1.5">
                  Payment Offset Override
                  <FloatingHelper
                    text={[
                      "Optional row-specific payment offset.",
                      "When blank, the global/default Bill payment offset is used and shown below the input.",
                      "If the entered value equals the global/default offset, it is treated as no override and saved blank.",
                      "When filled, this row becomes a manual override and is highlighted red.",
                      "Use the reset icon beside Save to clear this row override.",
                      "It changes Expected payment only; it should not change Expected sent/resubmission.",
                    ]}
                    className="size-5 border-0 bg-transparent shadow-none"
                    iconClassName="size-3"
                  />
                </span>
              </th>
              <th className="px-3 py-2">
                <span className="inline-flex items-center gap-1.5">
                  Expected payment
                  <FloatingHelper
                    text={[
                      "Calculated from actual/expected sent/resubmission date plus payment offset days.",
                      "Row Payment Offset Override supersedes the global/default payment offset for that row.",
                      "If a manual Expected payment date is entered, that row field is highlighted red.",
                    ]}
                    className="size-5 border-0 bg-transparent shadow-none"
                    iconClassName="size-3"
                  />
                </span>
              </th>
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
                          value={row.expectedSentDate || ""}
                          onChange={(event) =>
                            onRowChange(row.rowKey, "expectedSentDate", event.target.value)
                          }
                          className={filterControlClass(
                            Boolean(row.expectedSentDateOverride),
                            "h-8 rounded-md border border-input bg-background px-2 text-sm",
                          )}
                          disabled={dpOnly || !editable}
                        />
                        {!dpOnly && onSave && editable ? (
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={onSave}
                              disabled={saving || saveDisabled}
                              className="rounded border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {saving ? "Saving..." : "Save"}
                            </button>
                            <FloatingHelper
                              text="Save stores this row override in the database. The saved scope depends on access: official/global for permitted roles, or personal-only for Universal Viewer type 2."
                              label="Save row override help"
                              className="size-7 border-0 bg-transparent shadow-none"
                              iconClassName="size-3"
                            />
                            <button
                              type="button"
                              onClick={() => onExpectedSentDateReset?.(row.rowKey)}
                              disabled={saving || !row.expectedSentDateOverride}
                              className="rounded border border-border p-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                              title="Reset Expected sent/resubmission to software-calculated date"
                              aria-label="Reset Expected sent/resubmission to software-calculated date"
                            >
                              <RotateCcw className="size-3.5" />
                            </button>
                            <FloatingHelper
                              text="Reset clears the database-saved manual expected sent/resubmission override and returns to the software-calculated date."
                              label="Reset expected sent override help"
                              className="size-7 border-0 bg-transparent shadow-none"
                              iconClassName="size-3"
                            />
                          </span>
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
                          value={row.billOffsetOverride || ""}
                          placeholder={`Default ${row.billOffsetDays}`}
                          onChange={(event) =>
                            onRowChange(row.rowKey, "billOffsetOverride", event.target.value)
                          }
                          className={filterControlClass(
                            Boolean(row.billOffsetOverride),
                            "h-8 w-24 rounded-md border border-input bg-background px-2 text-sm",
                          )}
                          disabled={!editable}
                        />
                        <span
                          className={
                            "text-[11px] leading-none " +
                            (row.billOffsetOverride ? "text-destructive" : "text-muted-foreground")
                          }
                        >
                          {row.billOffsetOverride
                            ? `Override ${row.billOffsetOverride} days`
                            : `Using default ${row.billOffsetDays} days`}
                        </span>
                        {onSave && editable ? (
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={onSave}
                              disabled={saving || saveDisabled}
                              className="rounded border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {saving ? "Saving..." : "Save"}
                            </button>
                            <FloatingHelper
                              text="Save stores this row-specific payment offset override in the database. The saved scope depends on your Cash Out Go Plan access level."
                              label="Save payment offset override help"
                              className="size-7 border-0 bg-transparent shadow-none"
                              iconClassName="size-3"
                            />
                            <button
                              type="button"
                              onClick={() => onBillOffsetOverrideReset?.(row.rowKey)}
                              disabled={saving || !row.billOffsetOverride}
                              className="rounded border border-border p-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                              title="Reset Payment Offset Override to global/default offset"
                              aria-label="Reset Payment Offset Override to global/default offset"
                            >
                              <RotateCcw className="size-3.5" />
                            </button>
                            <FloatingHelper
                              text="Reset clears this database-saved row-specific payment offset and returns to the applicable global/default offset."
                              label="Reset payment offset override help"
                              className="size-7 border-0 bg-transparent shadow-none"
                              iconClassName="size-3"
                            />
                          </span>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {expectedPaymentEditable ? (
                      <div className="flex flex-col items-start gap-1">
                        <input
                          type="date"
                          value={row.manualExpectedPaymentDate || ""}
                          onChange={(event) =>
                            onRowChange(row.rowKey, "manualExpectedPaymentDate", event.target.value)
                          }
                          className={filterControlClass(
                            Boolean(row.manualExpectedPaymentDate),
                            "h-8 rounded-md border border-input bg-background px-2 text-sm",
                          )}
                          disabled={!editable}
                        />
                        {onSave && editable ? (
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
        <TooltipContent side={side} align="center" className="max-w-xs leading-relaxed">
          <ul className="list-disc space-y-1 pl-4">
            {flattenHelperText(text).map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
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
        <TooltipContent side="top" align="center" className="max-w-sm leading-relaxed">
          <ul className="list-disc space-y-1 pl-4 text-xs">
            {flattenHelperText(text).map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PreviousFySubmittedBillsHelper({
  label = "Previous FY submitted bills help",
  className = "",
  iconClassName = "size-3",
}: {
  label?: string;
  className?: string;
  iconClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rows = [
    {
      filter: "All files",
      unchecked: "All accessible database files can enter the file pool, but submitted bills are counted only if submission/resubmission date is inside the selected FY.",
      checked: "Submitted/resubmitted bills from previous FYs are also included if payment is pending.",
      effect: "Broadest file pool; checkbox still controls previous-FY submitted pending bills.",
    },
    {
      filter: "All active files",
      unchecked: "File pool is broad, but earlier-FY submitted bills stay excluded from submitted-bill section.",
      checked: "All earlier-FY submitted pending bills from active accessible files are included.",
      effect: "This checkbox can still be required even with All active files.",
    },
    {
      filter: "Active + current FY closed",
      unchecked: "Active files plus current-FY closed files can enter the file pool, but submitted bills are counted only if submission/resubmission date is inside the selected FY.",
      checked: "Previous-FY submitted pending bills are also included from that active/current-FY-closed file pool.",
      effect: "Useful when current planning includes active files and current-FY closed files, but some pending bills were submitted in previous FYs.",
    },
    {
      filter: "Selected FY, e.g. 2026-27",
      unchecked: "Submitted bills only if submission/resubmission date is inside 2026-27.",
      checked: "Also includes submitted/resubmitted bills before 2026-27 if payment is pending.",
      effect: "Useful for pending bills submitted in previous FYs.",
    },
    {
      filter: "User access / permitted files",
      unchecked: "Only accessible files are considered; submitted bills are restricted to selected FY.",
      checked: "Earlier-FY submitted pending bills are included only within accessible files.",
      effect: "It never brings back files outside the user's permitted access.",
    },
  ];
  return (
    <>
      <button
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
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[82vh] w-[min(94vw,980px)] overflow-auto rounded-xl border border-sky-100 bg-[#f4f9ff] p-4 text-xs leading-relaxed text-foreground shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Include previous FY submitted bills
                </div>
                <div className="mt-1 text-muted-foreground">
                  Behavior is two-layered: Global Filter first decides the file pool; this checkbox then decides whether earlier-FY submitted pending bills from that pool are included.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Close
              </button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-sky-100 bg-white/70">
              <table className="min-w-[860px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-sky-100 bg-sky-50 text-foreground">
                    <th className="px-2 py-2 font-semibold">Global filter situation</th>
                    <th className="px-2 py-2 font-semibold">Unchecked</th>
                    <th className="px-2 py-2 font-semibold">Checked</th>
                    <th className="px-2 py-2 font-semibold">Important effect</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.filter} className="border-b border-sky-100/80 last:border-0">
                      <td className="px-2 py-2 align-top font-medium text-foreground">
                        {row.filter}
                      </td>
                      <td className="px-2 py-2 align-top text-muted-foreground">
                        {row.unchecked}
                      </td>
                      <td className="px-2 py-2 align-top text-muted-foreground">{row.checked}</td>
                      <td className="px-2 py-2 align-top text-muted-foreground">{row.effect}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 rounded-md border border-sky-100 bg-white/70 px-3 py-2 text-muted-foreground">
              Example: selected FY is 2026-27. A bill submitted on 25-Mar-2026 with payment pending is included only when this checkbox is checked, provided the file also passes current filters.
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
  onOpenMonth?: (monthKey: string) => void;
  onOpenAll?: () => void;
}) {
  const totals = getExpectedCashOutgoTotals(rows);
  const descriptionWithHelper = [description, ...flattenHelperText(titleHelper)]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 space-y-4">
        <div className="min-w-0">
          <h2 className="text-base font-bold">{title}</h2>
          {descriptionWithHelper ? <ReportDescription description={descriptionWithHelper} /> : null}
        </div>
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-secondary/10 p-2">
          <div className="grid w-full grid-cols-2 gap-2 text-right text-xs sm:w-[280px]">
            <div className="rounded-md border border-border bg-card px-3 py-2">
              <div className="whitespace-nowrap text-muted-foreground">Total Capital</div>
              <div className="font-semibold tabular-nums">{formatCurrency(totals.capital)}</div>
            </div>
            <div className="rounded-md border border-border bg-card px-3 py-2">
              <div className="whitespace-nowrap text-muted-foreground">Total Revenue</div>
              <div className="font-semibold tabular-nums">{formatCurrency(totals.revenue)}</div>
            </div>
          </div>
          {controls}
          {actions}
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
            Live/current delays only: files stuck in their current milestone or S.O. stage for more
            than {thresholdDays} days. Already-cleared historical delays are excluded.
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
  description?: string,
) {
  const columns = firmDatabaseColumns.filter((column) => visibleColumns.includes(column.key));
  const includeDivisionReferences = columns.some((column) => column.key === "divisions");
  const divisionReferenceRows = rows.map((row, index) => [
    index + 1,
    String(row.firmName ?? ""),
    row.divisionNames.length ? row.divisionNames.join(", ") : "-",
  ]);
  void downloadBackendExport({
    format,
    title,
    description,
    tables: [
      {
        title,
        headers: columns.map((column) =>
          column.key === "divisions" ? "Division ref. No." : column.label,
        ),
        rows: rows.map((row, index) =>
          columns.map((column) => {
            if (column.key === "serial") return String(index + 1);
            if (column.key === "divisions") return String(index + 1);
            return String(row[column.key] ?? "");
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

async function downloadDelayStatus(
  rows: DelayStatusRow[],
  title: string,
  format: "excel" | "pdf",
  description?: string,
) {
  const exportColumns = delayStatusColumns.filter((column) => column.key !== "action");
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
    if (isCancelledFile(file)) return;
    filePaymentOrders(file).forEach((order, orderIndex) => {
      if (!isPaymentOrderActive(file, order) || isYes(order.soCancelled)) return;
      const row = createEmptySoPaymentMatrixRow(file, order, orderIndex);
      if (isYes(order.stagePayment) && order.stageDeliveries?.length) {
        order.stageDeliveries.forEach((stage, stageIndex) => {
          if (hasFilledString(stage.paymentDate)) return;
          const entry = getStagePaymentMatrixEntry(file, order, stage, stageIndex, paymentOffsetDays);
          if (!entry || !allowedMonths.has(entry.monthKey) || entry.amount <= 0) return;
          addSoPaymentMatrixAmount(row, entry.monthKey, entry.amount, entry.focusTarget, entry.basis);
        });
      } else if (!hasFilledString(order.paymentDate)) {
        const entry = getOrderPaymentMatrixEntry(file, order, orderIndex, paymentOffsetDays);
        if (entry && allowedMonths.has(entry.monthKey) && entry.amount > 0) {
          addSoPaymentMatrixAmount(row, entry.monthKey, entry.amount, entry.focusTarget, entry.basis);
        }
      }
      if (row.total > 0) rows.push(row);
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
    if (isCancelledFile(file)) return;
    filePaymentOrders(file).forEach((order, orderIndex) => {
      if (!isPaymentOrderActive(file, order) || isYes(order.soCancelled)) return;
      const row = createEmptySoPaymentMatrixRow(file, order, orderIndex);
      if (isYes(order.stagePayment) && order.stageDeliveries?.length) {
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
  if (fieldKey === "soDate") return formatDateDisplay(order.soDate);
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
) {
  const monthTotals = monthKeys.map((monthKey) =>
    rows.reduce((sum, row) => sum + (row.monthAmounts[monthKey] ?? 0), 0),
  );
  void downloadBackendExport({
    format,
    title,
    description,
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
                  return amount || "";
                }),
                row.total,
              ]),
              [
                ...columns.map((_, index) => (index === 0 ? "Total" : "")),
                ...monthTotals.map((amount) => amount || ""),
                rows.reduce((sum, row) => sum + row.total, 0),
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
    description: getDescriptionWithUniqueCode(file),
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
    description: getDescriptionWithUniqueCode(file),
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
    description: getDescriptionWithUniqueCode(file),
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
          description: getDescriptionWithUniqueCode(file),
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
        description: getDescriptionWithUniqueCode(file),
        milestoneKey: billReturnedDelayMilestoneKey,
        milestone: "Returned Bills",
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
          description: getDescriptionWithUniqueCode(file),
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
  if (key === "action") return "";
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
      stage: "Total",
      count: countReturnedBillOrders(files),
    },
    {
      milestone: "Returned Bills",
      stage: "Pending",
      count: countReturnedBillPendingOrders(files),
    },
    {
      milestone: "Returned Bills",
      stage: "Completed",
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
      stage: "Total",
      count: countReturnedBillOrders(files),
    },
    {
      milestone: "Returned Bills",
      stage: "Pending",
      count: countReturnedBillPendingOrders(files),
    },
    {
      milestone: "Returned Bills",
      stage: "Completed",
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
      !isSupplyOrderCancelled(file, order) &&
      !isYes(order.shortclosure),
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
