import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileSpreadsheet, FileText } from "lucide-react";
import {
  fetchFilesForYear,
  type Division,
  type DemandProcessingDayRange,
  type FileRecord,
  type StageDeliveryDetail,
  type SupplyOrderDetail,
  useActiveUser,
  useAccessibleDivisions,
  useSettings,
} from "@/lib/files-store";
import { downloadBackendExport } from "@/lib/export-download";
import {
  advancePaymentEntries,
  countExpectedSupplyOrderRows,
  expectedSupplyOrders as normalizedExpectedSupplyOrders,
  filePaymentOrders as normalizedFilePaymentOrders,
  fileSupplyOrders as normalizedFileSupplyOrders,
  getActualPaymentCapital,
  getActualPaymentRevenue,
  isAdvancePaymentCompleted,
  isAdvancePaymentPaid,
  isAdvancePaymentPending,
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
  displayFinancialYearLabel,
  isAllActiveFilesYear,
  isCancelledFile,
} from "@/lib/year-filter";

export const Route = createFileRoute("/reports")({
  component: ReportsPage,
});

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

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
  monthlyFileInflow: MonthCountRow[];
  monthWiseSupplyOrder: MonthCountRow[];
  monthWiseDeliverySchedule: MonthWiseDeliveryScheduleRow[];
  monthWiseCompletedDeliveries: MonthCountRow[];
  monthWiseBgExpiry: MonthWiseBgExpiryRow[];
  delayRows: DelayStatusRow[];
  delaySummary: ReturnType<typeof getDelayStatusSummary>;
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

function ReportsPage() {
  const divisions = useAccessibleDivisions();
  const settings = useSettings();
  const activeUser = useActiveUser();
  const navigate = useNavigate();
  const [selectedDivision, setSelectedDivision] = useState("all");
  const [reportMode, setReportMode] = useState<ReportMode>("mmgSummary");
  const [expandedReportGroups, setExpandedReportGroups] = useState({
    cashOutgo: false,
    supplyOrderDelivery: false,
  });
  const [demandAnalysisPresetId, setDemandAnalysisPresetId] = useState(
    builtInDemandProcessingPresets[1]?.id ?? "",
  );
  const [demandAnalysisFromFieldId, setDemandAnalysisFromFieldId] = useState("file.immsDate");
  const [demandAnalysisToFieldId, setDemandAnalysisToFieldId] = useState("order.soDate");
  const [demandAnalysisFilters, setDemandAnalysisFilters] = useState<DemandProcessingFilterRow[]>(
    [],
  );
  const [expectedCashOutgoDays, setExpectedCashOutgoDays] = useState("0");
  const [historicalReportFromDate, setHistoricalReportFromDate] = useState(() =>
    getFinancialYearStartDate(settings.selectedYear || settings.financialYear),
  );
  const [historicalReportToDate, setHistoricalReportToDate] = useState(() =>
    formatLocalDate(new Date()),
  );
  const [selectedCashOutgoMonth, setSelectedCashOutgoMonth] = useState(() => getCurrentMonthKey());
  const [selectedFileCategories, setSelectedFileCategories] =
    useState<FileCategoryKey[]>(allFileCategoryKeys);
  const [reportsSummary, setReportsSummary] = useState<ReportsSummaryPayload | undefined>();
  const [mmgFiles, setMmgFiles] = useState<FileRecord[]>([]);
  const [mmgPreviousFiles, setMmgPreviousFiles] = useState<FileRecord[]>([]);
  const [mmgLoading, setMmgLoading] = useState(false);
  const [mmgError, setMmgError] = useState<string | undefined>();
  const [reportsLoading, setReportsLoading] = useState(false);
  const [hasLoadedReports, setHasLoadedReports] = useState(false);
  const [reportsError, setReportsError] = useState<string | undefined>();
  const hasLoadedReportsRef = useRef(false);
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
  const expectedCashOutgoOffsetDays = getDelayThresholdDays(expectedCashOutgoDays) || 0;
  const reportsQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("division", activeDivision);
    params.set("fileCategories", serializeFileCategories(selectedFileCategories));
    params.set("delayDays", "5");
    params.set("expectedCashOutgoDays", String(expectedCashOutgoOffsetDays));
    params.set("delayMilestone", "all");
    params.set("selectedYear", settings.selectedYear);
    if (isHistoricalDateRangeReport(reportMode)) {
      params.set("historicalFromDate", historicalReportFromDate);
      params.set("historicalToDate", historicalReportToDate);
    }
    if (isMonthSelectionReport(reportMode)) {
      params.set("cashOutgoMonth", selectedCashOutgoMonth);
    }
    return params.toString();
  }, [
    activeDivision,
    expectedCashOutgoOffsetDays,
    historicalReportFromDate,
    historicalReportToDate,
    reportMode,
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

  const expectedCashOutgoDpRows = reportsSummary?.expectedCashOutgoDpRows ?? [];
  const expectedCashOutgoReceiptRows = reportsSummary?.expectedCashOutgoReceiptRows ?? [];
  const expectedCashOutgoReceiptPendingBillRows =
    reportsSummary?.expectedCashOutgoReceiptPendingBillRows ?? [];
  const expectedCashOutgoBillPreparationRows =
    reportsSummary?.expectedCashOutgoBillPreparationRows ?? [];
  const billSentForPaymentRows = reportsSummary?.billSentForPaymentRows ?? [];
  const actualCashOutgoRows = reportsSummary?.actualCashOutgoRows ?? [];
  const today = formatLocalDate(new Date());
  const currentMonthKey = getCurrentMonthKey();
  const effectiveFinancialYear = isAllActiveFilesYear(settings.selectedYear)
    ? settings.financialYear
    : settings.selectedYear || settings.financialYear;
  useEffect(() => {
    setHistoricalReportFromDate(getFinancialYearStartDate(effectiveFinancialYear));
    setHistoricalReportToDate(formatLocalDate(new Date()));
  }, [effectiveFinancialYear]);
  const mmgFilteredFiles = filterFilesByCategory(
    filterMmgFilesByDivision(mmgFiles, activeDivision),
    selectedFileCategories,
  );
  const mmgPreviousFilteredFiles = filterFilesByCategory(
    filterMmgFilesByDivision(
      mmgPreviousFiles.filter((file) => isPreviousFinancialYearFile(file, effectiveFinancialYear)),
      activeDivision,
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
    ),
    financialYear: effectiveFinancialYear,
    modes: settings.modes,
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
  const demandAnalysisRows = useMemo(
    () =>
      filterDemandProcessingRows(
        demandAnalysisAllRows,
        demandAnalysisSourceFiles,
        demandAnalysisFilters,
        demandProcessingFilterFields,
      ),
    [
      demandAnalysisAllRows,
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
  const spentTillSelectedMonthRows = filterRowsByMonthRange(
    actualCashOutgoRows,
    fyRange.startMonthKey,
    selectedCashOutgoMonth,
  );
  const currentLiabilityRows = getCurrentMonthLiabilityRows(
    expectedCashOutgoReceiptRows,
    selectedCashOutgoMonth,
  );
  const billsPaidInMonthRows = combineRowsForMonth(selectedCashOutgoMonth, [actualCashOutgoRows]);
  const cashOutgoForMonthRows = combineRowsForMonth(selectedCashOutgoMonth, [
    expectedCashOutgoBillPreparationRows,
    billSentForPaymentRows,
    expectedCashOutgoFyRows,
  ]);
  const expectedExpenditureTillMonthRows = combineRowsAsSingleMonth(selectedCashOutgoMonth, [
    spentTillSelectedMonthRows,
    cashOutgoForMonthRows,
  ]);
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
  });
  const selectedMonthlyReport = getMonthlyReportConfig(reportMode, reportsSummary);
  const reportTitle = getEightReportTitle(reportMode, {
    today: isHistoricalDateRangeReport(reportMode) ? historicalReportToDate : today,
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
      : reportTitleWithDivision;
  const reportLogic = getCashOutgoReportLogic(reportMode, {
    today,
    monthKey: isMonthSelectionReport(reportMode) ? selectedCashOutgoMonth : currentMonthKey,
    financialYear: effectiveFinancialYear,
  });
  const cashOutgoEmptyMessage =
    reportMode === "billsPaidInMonth"
      ? "No bills paid found for the selected month."
      : "No expected cash outgo rows found.";
  const exportCashOutgoPdf = () =>
    reportMode === "currentMonthLiability"
      ? printCurrentLiabilityToPdf(selectedCashOutgoRows, selectedReportTitle, reportLogic)
      : printExpectedCashOutgoToPdf(
          selectedCashOutgoRows,
          selectedReportTitle,
          reportLogic,
          cashOutgoEmptyMessage,
        );
  const exportCashOutgoExcel = () =>
    reportMode === "currentMonthLiability"
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
  const selectedReportMode = reportModes.find((mode) => mode.key === reportMode) ?? reportModes[0];
  const historicalDateRangeControls = isHistoricalDateRangeReport(reportMode)
    ? {
        fromDate: historicalReportFromDate,
        toDate: historicalReportToDate,
        onFromDateChange: setHistoricalReportFromDate,
        onToDateChange: setHistoricalReportToDate,
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
    isHistoricalDateRangeReport(reportMode)
      ? { fromDate: historicalReportFromDate, toDate: historicalReportToDate }
      : isMonthSelectionReport(reportMode)
        ? { asOfDate: getMonthEndDate(selectedCashOutgoMonth) }
        : undefined;
  const openCashOutgoSearch = (mode: CashOutgoFilterMode, monthKey: string) => {
    const dateContext = getCashOutgoDateContext();
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
      },
    });
  };
  const openCashOutgoAnySearch = (modes: CashOutgoFilterMode[], monthKey: string) => {
    const dateContext = getCashOutgoDateContext();
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
      },
    });
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
    const rows = mode === "reverse" ? demandAnalysisRows.filter((row) => row.gapDays < 0) : demandAnalysisRows;
    const fileIds = Array.from(new Set(rows.map((row) => row.fileId))).filter(Boolean);
    if (!fileIds.length) return;
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `fileIds:${fileIds.map(encodeURIComponent).join(",")}`,
        division: activeDivision === "all" ? undefined : activeDivision,
        fileCategories: serializeFileCategories(selectedFileCategories),
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
      },
    });
  };
  const openDemandProcessingFile = (row: DemandProcessingAnalysisRow) => {
    const focus = getDemandProcessingRowFocus(row, demandAnalysisFromFieldId, demandAnalysisToFieldId);
    navigate({
      to: "/add",
      search: {
        fileId: row.fileId,
        section: focus.section,
        focusTarget: focus.focusTarget,
        quickFocus: false,
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
            <CollapsibleReportGroup
              title="Cash Outgo"
              modes={cashOutgoReportModes}
              activeMode={reportMode}
              expanded={expandedReportGroups.cashOutgo}
              onToggle={() =>
                setExpandedReportGroups((current) => ({
                  ...current,
                  cashOutgo: !current.cashOutgo,
                }))
              }
              onSelect={setReportMode}
            />
            <CollapsibleReportGroup
              title="Supply order & delivery"
              modes={supplyOrderDeliveryReportModes}
              activeMode={reportMode}
              expanded={expandedReportGroups.supplyOrderDelivery}
              onToggle={() =>
                setExpandedReportGroups((current) => ({
                  ...current,
                  supplyOrderDelivery: !current.supplyOrderDelivery,
                }))
              }
              onSelect={setReportMode}
            />
          </div>
        </aside>
        <div className="min-w-0 space-y-4">
          <div className="rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
            <FileCategoryFilter
              selectedCategories={selectedFileCategories}
              options={visibleFileCategoryOptions}
              onChange={toggleFileCategory}
            />
          </div>
          {reportsError || (reportsLoading && !hasLoadedReports) || mmgError ? (
            <div
              className={
                "rounded-md border px-3 py-2 text-xs " +
                (reportsError || mmgError
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border bg-secondary/30 text-muted-foreground")
              }
            >
              {reportsError || mmgError
                ? `Reports API unavailable: ${reportsError || mmgError}`
                : "Updating reports..."}
            </div>
          ) : null}

          {reportMode === "mmgSummary" ? (
            <MmgSummaryReport
              rows={mmgSummaryRows}
              title={selectedReportTitle}
              loading={mmgLoading}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                  onPdf={exportMmgSummaryPdf}
                  onExcel={exportMmgSummaryExcel}
                />
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
              onOpenFile={openDemandProcessingFile}
              actions={
                <ReportHeaderActions
                  divisions={divisions}
                  activeDivision={activeDivision}
                  onDivisionChange={setSelectedDivision}
                />
              }
            />
          ) : selectedMonthlyReport ? (
            <MonthlyOperationalReport
              title={selectedReportTitle}
              description={selectedMonthlyReport.description}
              columns={selectedMonthlyReport.columns}
              rows={selectedMonthlyReport.rows}
              onOpenSearch={openMonthlyReportSearch}
              onPdf={() =>
                exportMonthlyOperationalReport(
                  selectedReportTitle,
                  selectedMonthlyReport.description,
                  selectedMonthlyReport.columns,
                  selectedMonthlyReport.rows,
                  "pdf",
                )
              }
              onExcel={() =>
                exportMonthlyOperationalReport(
                  selectedReportTitle,
                  selectedMonthlyReport.description,
                  selectedMonthlyReport.columns,
                  selectedMonthlyReport.rows,
                  "excel",
                )
              }
            />
          ) : reportMode === "itemsDeliveredBillsPending" ? (
            <ExpectedCashOutgoReport
              rows={expectedCashOutgoReceiptPendingBillRows}
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
              selectedDays={expectedCashOutgoDays}
              onDaysChange={setExpectedCashOutgoDays}
              dateRange={historicalDateRangeControls}
              onOpenMonth={(monthKey) =>
                openCashOutgoSearch("expectedReceiptPendingBill", monthKey)
              }
            />
          ) : reportMode === "currentMonthLiability" ? (
            <CurrentMonthLiabilityReport
              rows={currentLiabilityRows}
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
              selectedDays={expectedCashOutgoDays}
              onDaysChange={setExpectedCashOutgoDays}
              monthSelection={monthSelectionControls}
              onOpenMonth={(monthKey) => openCashOutgoSearch("expectedReceiptThrough", monthKey)}
            />
          ) : reportMode === "itemsDeliveredBillsPrepared" ? (
            <ExpectedCashOutgoReport
              rows={expectedCashOutgoBillPreparationRows}
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
              onOpenMonth={(monthKey) => openCashOutgoSearch("billPreparation", monthKey)}
            />
          ) : reportMode === "billsSubmitted" ? (
            <ExpectedCashOutgoReport
              rows={billSentForPaymentRows}
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
              onOpenMonth={(monthKey) => openCashOutgoSearch("billSent", monthKey)}
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
              selectedDays={expectedCashOutgoDays}
              onDaysChange={setExpectedCashOutgoDays}
              onOpenMonth={(monthKey) => openCashOutgoSearch("expectedDp", monthKey)}
            />
          ) : reportMode === "spentTillDateFy" ? (
            <ExpectedCashOutgoReport
              rows={spentTillDateFyRows}
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
              onOpenMonth={(monthKey) => openCashOutgoSearch("actual", monthKey)}
            />
          ) : reportMode === "billsPaidInMonth" ? (
            <ExpectedCashOutgoReport
              rows={billsPaidInMonthRows}
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
              monthSelection={monthSelectionControls}
              emptyMessage={cashOutgoEmptyMessage}
              onOpenMonth={(monthKey) => openCashOutgoSearch("actual", monthKey)}
            />
          ) : reportMode === "cashOutgoForMonth" ? (
            <ExpectedCashOutgoReport
              rows={cashOutgoForMonthRows}
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
              monthSelection={monthSelectionControls}
              onOpenMonth={(monthKey) =>
                openCashOutgoAnySearch(["billPreparation", "billSent", "expectedDp"], monthKey)
              }
            />
          ) : (
            <ExpectedCashOutgoReport
              rows={expectedExpenditureTillMonthRows}
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
              monthSelection={monthSelectionControls}
              onOpenMonth={(monthKey) =>
                openCashOutgoAnySearch(
                  ["actualThrough", "billPreparation", "billSent", "expectedDp"],
                  monthKey,
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
  | "itemsDeliveredBillsPending"
  | "itemsDeliveredBillsPrepared"
  | "billsSubmitted"
  | "expectedCashOutgoFy"
  | "spentTillDateFy"
  | "billsPaidInMonth"
  | "currentMonthLiability"
  | "cashOutgoForMonth"
  | "expectedExpenditureTillMonth"
  | "monthlyFileInflow"
  | "monthWiseSupplyOrder"
  | "monthWiseDeliverySchedule"
  | "monthWiseCompletedDeliveries"
  | "monthWiseBgExpiry";
type CashOutgoFilterMode =
  | "expectedDp"
  | "expectedReceipt"
  | "expectedReceiptThrough"
  | "expectedReceiptPendingBill"
  | "billPreparation"
  | "billSent"
  | "actual"
  | "actualThrough";

const reportModes = [
  { key: "mmgSummary", label: "MMG Summary" },
  { key: "demandProcessingAnalysis", label: "Demand processing analysis" },
  { key: "itemsDeliveredBillsPending", label: "Items delivered & bills yet to be prepared" },
  { key: "itemsDeliveredBillsPrepared", label: "Items delivered and bills prepared" },
  { key: "billsSubmitted", label: "Bills submitted" },
  { key: "expectedCashOutgoFy", label: "Expected cash outgo for FY" },
  { key: "spentTillDateFy", label: "Spent till date" },
  { key: "billsPaidInMonth", label: "Bills paid in month" },
  { key: "cashOutgoForMonth", label: "Cash outgo for month" },
  { key: "expectedExpenditureTillMonth", label: "Expected expenditure till month" },
  { key: "currentMonthLiability", label: "Current month's liability" },
  { key: "monthlyFileInflow", label: "Monthly file inflow" },
  { key: "monthWiseSupplyOrder", label: "Month-wise Supply Order" },
  { key: "monthWiseDeliverySchedule", label: "Month-wise Delivery Schedule" },
  { key: "monthWiseCompletedDeliveries", label: "Month-wise completed deliveries" },
  { key: "monthWiseBgExpiry", label: "Month-wise BG expiry" },
] satisfies Array<{ key: ReportMode; label: string }>;
const mmgReportMode = reportModes[0];
const demandProcessingReportMode = reportModes[1];
const cashOutgoReportModes = reportModes.slice(2, 11);
const supplyOrderDeliveryReportModes = reportModes.slice(11);
const fileClosedMilestone = "File Closed";
const delayStatusPageSizeOptions = [25, 50, 100] as const;

function ReportModeButton({
  mode,
  selected,
  onSelect,
}: {
  mode: (typeof reportModes)[number];
  selected: boolean;
  onSelect: (mode: ReportMode) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mode.key)}
      className={
        "w-full rounded-md px-3 py-2 text-left text-sm font-medium transition " +
        (selected
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-accent hover:text-foreground")
      }
    >
      {mode.label}
    </button>
  );
}

function CollapsibleReportGroup({
  title,
  modes,
  activeMode,
  expanded,
  onToggle,
  onSelect,
}: {
  title: string;
  modes: ReadonlyArray<(typeof reportModes)[number]>;
  activeMode: ReportMode;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (mode: ReportMode) => void;
}) {
  const hasActiveMode = modes.some((mode) => mode.key === activeMode);
  return (
    <div className="rounded-md border border-border bg-background/60">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={
          "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide transition " +
          (hasActiveMode ? "text-foreground" : "text-muted-foreground hover:text-foreground")
        }
      >
        <span>{title}</span>
        <ChevronDown
          className={"h-4 w-4 transition-transform " + (expanded ? "rotate-180" : "")}
          aria-hidden="true"
        />
      </button>
      {expanded ? (
        <div className="space-y-1 border-t border-border p-1.5">
          {modes.map((mode) => (
            <ReportModeButton
              key={mode.key}
              mode={mode}
              selected={activeMode === mode.key}
              onSelect={onSelect}
            />
          ))}
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
  return [];
}

function isHistoricalDateRangeReport(mode: ReportMode) {
  return (
    mode === "itemsDeliveredBillsPending" ||
    mode === "itemsDeliveredBillsPrepared" ||
    mode === "billsSubmitted" ||
    mode === "spentTillDateFy"
  );
}

function isMonthSelectionReport(mode: ReportMode) {
  return (
    mode === "currentMonthLiability" ||
    mode === "billsPaidInMonth" ||
    mode === "cashOutgoForMonth" ||
    mode === "expectedExpenditureTillMonth"
  );
}

function getEightReportTitle(
  mode: ReportMode,
  context: { today: string; monthKey: string; financialYear: string },
) {
  const asOnDate = formatDateTitle(context.today);
  const monthLabel = formatMonthTitle(context.monthKey);
  const fyLabel = displayFinancialYearLabel(context.financialYear);
  if (mode === "itemsDeliveredBillsPending") {
    return `Items delivered & bills are yet to be prepared as on ${asOnDate}`;
  }
  if (mode === "demandProcessingAnalysis") return "Demand processing analysis";
  if (mode === "itemsDeliveredBillsPrepared") {
    return `Items delivered and bills prepared as on ${asOnDate}`;
  }
  if (mode === "billsSubmitted") return `Bills submitted as on ${asOnDate}`;
  if (mode === "expectedCashOutgoFy") return `Expected cash outgo for FY ${fyLabel}`;
  if (mode === "spentTillDateFy") {
    return `Spent till as on ${asOnDate}`;
  }
  if (mode === "billsPaidInMonth") return `Bills paid in ${monthLabel}`;
  if (mode === "currentMonthLiability") return `Liability till ${monthLabel}`;
  if (mode === "cashOutgoForMonth") return `Cash outgo for ${monthLabel}`;
  if (mode === "expectedExpenditureTillMonth") {
    return `Expected expenditure till ${monthLabel}`;
  }
  if (mode === "monthlyFileInflow") return "Monthly file inflow";
  if (mode === "monthWiseSupplyOrder") return "Month-wise Supply Order";
  if (mode === "monthWiseDeliverySchedule") return "Month-wise Delivery Schedule";
  if (mode === "monthWiseCompletedDeliveries") return "Month-wise completed deliveries";
  if (mode === "monthWiseBgExpiry") return "Month-wise BG expiry";
  return "Delay status";
}

function getCashOutgoReportLogic(
  mode: ReportMode,
  context: { today: string; monthKey: string; financialYear: string },
) {
  if (mode === "itemsDeliveredBillsPending") {
    return "Expected cash outgo by material receipt date; for AMC, MPC, O&M and CARS, by effective D.P.";
  }
  if (mode === "itemsDeliveredBillsPrepared") {
    return "Expected cash outgo by Bill preparation date; delivery prerequisite uses material receipt for Goods & Services and effective D.P. for AMC, MPC, O&M and CARS.";
  }
  if (mode === "billsSubmitted") {
    return "Bills sent for payment; delivery prerequisite uses material receipt for Goods & Services and effective D.P. for AMC, MPC, O&M and CARS.";
  }
  if (mode === "expectedCashOutgoFy") {
    return "Expected cash outgo by effective D.P.; Goods & Services remain here until material receipt, while AMC, MPC, O&M and CARS remain here until bill workflow starts.";
  }
  if (mode === "spentTillDateFy") {
    return "Actual payment made monthwise";
  }
  if (mode === "billsPaidInMonth") {
    return "Bills paid by payment date";
  }
  if (mode === "currentMonthLiability") {
    return "Unpaid delivered items so far";
  }
  if (mode === "cashOutgoForMonth") {
    return "Total of:\n(i) Undelivered materials so far\n(ii) Items delivered and bills prepared\n(iii) Bills submitted";
  }
  if (mode === "expectedExpenditureTillMonth") {
    return "Total of:\n(i) Spent till date\n(ii) Cash outgo for current month";
  }
  return "";
}

function getMonthlyReportConfig(
  mode: ReportMode,
  summary: ReportsSummaryPayload | undefined,
):
  | {
      description: string;
      columns: MonthlyReportColumn[];
      rows: Array<Record<string, number | string>>;
    }
  | undefined {
  if (!summary) return undefined;
  const monthLabelColumn: MonthlyReportColumn = { key: "month", label: "Month", align: "left" };
  if (mode === "monthlyFileInflow") {
    return {
      description: "Files received by month.",
      columns: [
        monthLabelColumn,
        {
          key: "count",
          label: "Files",
          align: "right",
          getFilter: (row) => `fileInflowMonth:${row.monthKey}`,
        },
      ],
      rows: summary.monthlyFileInflow.map(withMonthLabel),
    };
  }
  if (mode === "monthWiseSupplyOrder") {
    return {
      description: "Supply orders placed by month.",
      columns: [
        monthLabelColumn,
        {
          key: "count",
          label: "Supply Orders",
          align: "right",
          getFilter: (row) => `supplyOrderMonth:${row.monthKey}`,
        },
      ],
      rows: summary.monthWiseSupplyOrder.map(withMonthLabel),
    };
  }
  if (mode === "monthWiseDeliverySchedule") {
    return {
      description: "S.O./delivery rows with D.P. expiring by month.",
      columns: [
        monthLabelColumn,
        {
          key: "grossCount",
          label: "D.P. expiring",
          align: "right",
          getFilter: (row) => `deliverySchedule:gross:${row.monthKey}`,
        },
        {
          key: "netCount",
          label: "Net pending",
          align: "right",
          getFilter: (row) => `deliverySchedule:net:${row.monthKey}`,
        },
      ],
      rows: summary.monthWiseDeliverySchedule.map(withMonthLabel),
    };
  }
  if (mode === "monthWiseCompletedDeliveries") {
    return {
      description: "Goods & Services delivery rows completed by material receipt month.",
      columns: [
        monthLabelColumn,
        {
          key: "count",
          label: "Completed deliveries",
          align: "right",
          getFilter: (row) => `completedDeliveryMonth:${row.monthKey}`,
        },
      ],
      rows: summary.monthWiseCompletedDeliveries.map(withMonthLabel),
    };
  }
  if (mode === "monthWiseBgExpiry") {
    return {
      description: "BG validity dates expiring by month.",
      columns: [
        monthLabelColumn,
        {
          key: "count",
          label: "Total",
          align: "right",
          getFilter: (row) => `bgExpiryMonth:all:${row.monthKey}`,
        },
        {
          key: "psb",
          label: "PSB",
          align: "right",
          getFilter: (row) => `bgExpiryMonth:psb:${row.monthKey}`,
        },
        {
          key: "pwb",
          label: "PWB",
          align: "right",
          getFilter: (row) => `bgExpiryMonth:pwb:${row.monthKey}`,
        },
        {
          key: "psbPwb",
          label: "PSB+PWB",
          align: "right",
          getFilter: (row) => `bgExpiryMonth:psbpwb:${row.monthKey}`,
        },
      ],
      rows: summary.monthWiseBgExpiry.map(withMonthLabel),
    };
  }
  return undefined;
}

function withMonthLabel(row: { name: string; monthKey: string } & Record<string, number | string>) {
  return { ...row, month: formatMonthTitle(row.monthKey || row.name) };
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
  getValue: (
    context: DemandProcessingRowContext,
  ) => string | number | undefined;
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
  const fileTypeOptions = uniqueOptions(settings.fileTypes, ["Goods & Services", "AMC", "MPC", "CARS", "O&M"]);
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
  { id: "file.division", label: "Division", group: "File details", type: "select", options: divisionOptions, getValue: ({ file }) => file.division },
  { id: "file.indentor", label: "Indentor", group: "File details", type: "select", options: indentorOptions, getValue: ({ file }) => file.indentor },
  { id: "file.demandDescription", label: "Demand description", group: "File details", type: "text", getValue: ({ file }) => file.demandDescription },
  { id: "file.mode", label: "Bidding type", group: "File details", type: "select", options: modeOptions, getValue: ({ file }) => file.mode },
  { id: "file.valueCapital", label: "Demand value capital", group: "File details", type: "amount", getValue: ({ file }) => file.valueCapital },
  { id: "file.valueRevenue", label: "Demand value revenue", group: "File details", type: "amount", getValue: ({ file }) => file.valueRevenue },
  { id: "file.tcec", label: "TCEC", group: "Attributes", type: "yesNo", getValue: ({ file }) => file.tcec },
  { id: "file.gem", label: "GeM", group: "Attributes", type: "yesNo", getValue: ({ file }) => file.gem },
  { id: "file.highValue", label: "High Value", group: "Attributes", type: "yesNo", getValue: ({ file }) => file.highValue },
  { id: "file.ad", label: "AD", group: "Attributes", type: "yesNo", getValue: ({ file }) => file.ad },
  { id: "file.rqa", label: "R&QA", group: "Attributes", type: "yesNo", getValue: ({ file }) => file.rqa },
  { id: "file.ifa", label: "IFA", group: "Attributes", type: "yesNo", getValue: ({ file }) => file.ifa },
  { id: "file.bg", label: "Warranty", group: "Attributes", type: "yesNo", getValue: ({ file }) => file.bg },
  { id: "file.ir", label: "IR", group: "Attributes", type: "yesNo", getValue: ({ file }) => file.ir },
  { id: "file.rfpVetting", label: "RFP vetting", group: "Attributes", type: "yesNo", getValue: ({ file }) => file.rfpVetting },
  { id: "order.soNo", label: "S.O. No.", group: "Supply Order", type: "text", getValue: ({ order }) => order?.soNo },
  { id: "order.firm", label: "Firm", group: "Supply Order", type: "text", getValue: ({ order }) => order?.firm },
  { id: "order.firmType", label: "Firm type", group: "Supply Order", type: "select", options: firmTypeOptions, getValue: ({ order }) => order?.firmType },
  { id: "order.soValueCapital", label: "S.O. value capital", group: "Supply Order", type: "amount", getValue: ({ order }) => order?.soValueCapital },
  { id: "order.soValueRevenue", label: "S.O. value revenue", group: "Supply Order", type: "amount", getValue: ({ order }) => order?.soValueRevenue },
  { id: "order.psbApplicable", label: "PSB applicable", group: "Security/Warranty BG", type: "yesNo", getValue: ({ order }) => order?.psbApplicable },
  { id: "order.bgCoverageType", label: "BG coverage type", group: "Security/Warranty BG", type: "select", options: ["None", "PSB", "PWB", "PSB+PWB", "PSB and PWB separately"], getValue: ({ order }) => order?.bgCoverageType },
  { id: "order.stageDelivery", label: "Stage delivery", group: "Supply Order", type: "yesNo", getValue: ({ order }) => order?.stageDelivery },
  { id: "order.stagePayment", label: "Stage payment", group: "Supply Order", type: "yesNo", getValue: ({ order }) => order?.stagePayment },
  { id: "order.advancePayment", label: "Advance payment", group: "Supply Order", type: "yesNo", getValue: ({ order }) => order?.advancePayment },
  { id: "order.dpExtension", label: "D.P. extension", group: "Delivery Period", type: "yesNo", getValue: ({ order }) => order?.dpExtension },
  { id: "order.ld", label: "LD", group: "Delivery Period", type: "yesNo", getValue: ({ order }) => order?.ld },
  ];
}

function getDemandProcessingFilterFields(context: {
  settings: ReturnType<typeof useSettings>;
  divisions: Division[];
  files: FileRecord[];
}): DemandProcessingFilterField[] {
  return [
    ...demandProcessingDateFields.map((field): DemandProcessingFilterField => ({
    id: field.id,
    label: field.label,
    group: field.group,
    type: "date",
    getValue: ({ file, order, stage }) => field.getValue(file, order, stage),
  })),
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
  onOpenFile,
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
  onUpdateFilter: (
    id: string,
    patch: Partial<Omit<DemandProcessingFilterRow, "id">>,
  ) => void;
  onRemoveFilter: (id: string) => void;
  onResetFilters: () => void;
  onOpenUsed: () => void;
  onOpenReverse: () => void;
  onOpenRange: (row: DemandProcessingRangeRow) => void;
  onOpenFile: (row: DemandProcessingAnalysisRow) => void;
}) {
  const fromField = getDemandProcessingField(fromFieldId);
  const toField = getDemandProcessingField(toFieldId);
  const visibleRows = rows.slice(0, 100);
  return (
    <div className="rounded-md border border-border bg-card shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
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

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">File</th>
                <th className="px-3 py-2 text-left font-medium">Division</th>
                <th className="px-3 py-2 text-left font-medium">Basis</th>
                <th className="px-3 py-2 text-left font-medium">S.O./stage</th>
                <th className="px-3 py-2 text-left font-medium">From date</th>
                <th className="px-3 py-2 text-left font-medium">To date</th>
                <th className="px-3 py-2 text-right font-medium">Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleRows.map((row, index) => (
                <tr key={`${row.fileId}:${row.orderRef}:${index}`} className="bg-card">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpenFile(row)}
                      className="text-left font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {row.fileRef}
                    </button>
                  </td>
                  <td className="px-3 py-2">{row.division}</td>
                  <td className="px-3 py-2">{row.basis}</td>
                  <td className="px-3 py-2">{row.orderRef}</td>
                  <td className="px-3 py-2">{formatDateDisplay(row.fromDate)}</td>
                  <td className="px-3 py-2">{formatDateDisplay(row.toDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.gapDays}</td>
                </tr>
              ))}
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No rows found for this date pair.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {rows.length > visibleRows.length ? (
          <p className="text-xs text-muted-foreground">
            Showing first {visibleRows.length} of {rows.length} matching rows.
          </p>
        ) : null}
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
            <summary className="cursor-pointer rounded px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-foreground">
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
  onUpdate: (
    id: string,
    patch: Partial<Omit<DemandProcessingFilterRow, "id">>,
  ) => void;
  onRemove: (id: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Filters</h3>
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
        <h3 className="text-sm font-semibold">{getAnalysisUnitBucketTitle(analysisUnit)}</h3>
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
      ) : (
        <input
          type={field.type === "date" ? "date" : field.type === "amount" ? "number" : "text"}
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
  return (
    <div className="rounded-md border border-border bg-secondary/20 px-3 py-2">{content}</div>
  );
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
  const median =
    gaps.length % 2 === 0 ? (gaps[middle - 1] + gaps[middle]) / 2 : gaps[middle];
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
  const maxGapByUnit = new Map<string, { gapDays: number; fileId: string }>();
  rows.forEach((row) => {
    const key = getDemandProcessingUnitKey(row, analysisUnit);
    const current = maxGapByUnit.get(key);
    if (!current || row.gapDays > current.gapDays) {
      maxGapByUnit.set(key, { gapDays: row.gapDays, fileId: row.fileId });
    }
  });
  const normalizedRanges = ranges.map((range) => ({
    id: range.id || range.label,
    label: range.label,
    minDays: parseOptionalDay(range.minDays),
    maxDays: parseOptionalDay(range.maxDays),
    count: 0,
    fileIds: [] as string[],
  }));
  maxGapByUnit.forEach(({ gapDays, fileId }) => {
    const range = normalizedRanges.find(
      (item) =>
        (item.minDays === undefined || gapDays >= item.minDays) &&
        (item.maxDays === undefined || gapDays <= item.maxDays),
    );
    if (!range) return;
    range.count += 1;
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
  description,
  actions,
  selectedDays,
  onDaysChange,
  dateRange,
  monthSelection,
  emptyMessage = "No expected cash outgo rows found.",
  onOpenMonth,
}: {
  rows: ExpectedCashOutgoRow[];
  title: string;
  description: string;
  actions: ReactNode;
  selectedDays?: string;
  onDaysChange?: (value: string) => void;
  dateRange?: HistoricalDateRangeControlsProps;
  monthSelection?: MonthSelectionControlsProps;
  emptyMessage?: string;
  onOpenMonth?: (monthKey: string) => void;
}) {
  return (
    <CashOutgoReport
      rows={rows}
      title={title}
      description={description}
      emptyMessage={emptyMessage}
      actions={actions}
      onOpenMonth={onOpenMonth}
      controls={
        <>
          {monthSelection ? <MonthSelectionControls {...monthSelection} /> : null}
          {dateRange ? <HistoricalDateRangeControls {...dateRange} /> : null}
          {selectedDays !== undefined && onDaysChange ? (
            <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
              <span>Days after base date</span>
              <input
                type="number"
                min="0"
                value={selectedDays}
                onChange={(event) => onDaysChange(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
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

function HistoricalDateRangeControls({
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
}: HistoricalDateRangeControlsProps) {
  return (
    <>
      <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
        <span>From</span>
        <input
          type="date"
          value={fromDate}
          max={toDate}
          onChange={(event) => {
            if (event.target.value) onFromDateChange(event.target.value);
          }}
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
        />
      </label>
      <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
        <span>To</span>
        <input
          type="date"
          value={toDate}
          min={fromDate}
          onChange={(event) => {
            if (event.target.value) onToDateChange(event.target.value);
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
}: {
  rows: ExpectedCashOutgoRow[];
  onOpenMonth: (monthKey: string) => void;
}) {
  return (
    <CashOutgoReport
      rows={rows}
      title="Actual cash out go monthly"
      description="Uses payment date, excluding S.O. cancelled rows only when cancellation date is filled."
      emptyMessage="No actual cash out go rows found."
      onOpenMonth={onOpenMonth}
    />
  );
}

function CurrentMonthLiabilityReport({
  rows,
  title,
  description,
  actions,
  selectedDays,
  onDaysChange,
  monthSelection,
  onOpenMonth,
}: {
  rows: ExpectedCashOutgoRow[];
  title: string;
  description: string;
  actions: ReactNode;
  selectedDays: string;
  onDaysChange: (value: string) => void;
  monthSelection?: MonthSelectionControlsProps;
  onOpenMonth?: (monthKey: string) => void;
}) {
  return (
    <CashOutgoReport
      rows={rows}
      title={title}
      description={description}
      emptyMessage="No unpaid liability found for the current month."
      actions={actions}
      onOpenMonth={onOpenMonth}
      controls={
        <>
          {monthSelection ? <MonthSelectionControls {...monthSelection} /> : null}
          <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
            <span>Days after base date</span>
            <input
              type="number"
              min="0"
              value={selectedDays}
              onChange={(event) => onDaysChange(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
        </>
      }
    />
  );
}

function MonthlyOperationalReport({
  title,
  description,
  columns,
  rows,
  onOpenSearch,
  onPdf,
  onExcel,
}: {
  title: string;
  description: string;
  columns: MonthlyReportColumn[];
  rows: Array<Record<string, number | string>>;
  onOpenSearch: (dashboardFilter: string) => void;
  onPdf: () => void;
  onExcel: () => void;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
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

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
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
                    {columns.map((column) => {
                      const value = String(row[column.key] ?? "");
                      const filter = column.getFilter?.(row);
                      return (
                        <td
                          key={column.key}
                          className={
                            "px-3 py-2.5 " +
                            (column.align === "right" ? "text-right tabular-nums" : "text-left")
                          }
                        >
                          {filter && value !== "0" ? (
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
          </table>
        </div>
      </div>
    </div>
  );
}

function ReportHeaderActions({
  divisions,
  activeDivision,
  onDivisionChange,
  onPdf,
  onExcel,
}: {
  divisions: ReturnType<typeof useAccessibleDivisions>;
  activeDivision: string;
  onDivisionChange: (division: string) => void;
  onPdf?: () => void;
  onExcel?: () => void;
}) {
  return (
    <>
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

function MmgSummaryReport({
  rows,
  title,
  loading,
  actions,
}: {
  rows: MmgSummaryRow[];
  title: string;
  loading: boolean;
  actions: ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
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
              rows.map((row) => (
                <tr key={row.key} className="border-b border-border/70 last:border-0">
                  <td className="px-3 py-2 font-medium">{row.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.value}</td>
                </tr>
              ))
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

function CashOutgoReport({
  rows,
  title,
  description,
  emptyMessage,
  actions,
  controls,
  onOpenMonth,
}: {
  rows: ExpectedCashOutgoRow[];
  title: string;
  description?: string;
  emptyMessage: string;
  actions?: ReactNode;
  controls?: ReactNode;
  onOpenMonth?: (monthKey: string) => void;
}) {
  const totals = getExpectedCashOutgoTotals(rows);

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? (
            <p className="whitespace-pre-line text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2">
          {controls}
          {actions}
        </div>
        <div className="grid grid-cols-2 gap-2 text-right text-xs">
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
            <div className="text-muted-foreground">Total Capital</div>
            <div className="font-semibold tabular-nums">{formatCurrency(totals.capital)}</div>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
            <div className="text-muted-foreground">Total Revenue</div>
            <div className="font-semibold tabular-nums">{formatCurrency(totals.revenue)}</div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
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
                <CashOutgoTotalsRow totals={totals} />
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </div>
  );
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
            <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
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
}: {
  totals: Pick<ExpectedCashOutgoRow, "capital" | "revenue">;
}) {
  return (
    <tr className="border-t border-border bg-muted/40 font-semibold">
      <td className="px-3 py-2.5 text-right tabular-nums" />
      <td className="px-3 py-2.5 text-left">Total</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(totals.capital)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(totals.revenue)}</td>
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
        "inline-flex min-w-8 justify-center rounded px-2 py-0.5 text-xs font-semibold transition hover:ring-2 hover:ring-ring/30 " +
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
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof delayStatusPageSizeOptions)[number]>(25);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = rows.length ? (safePage - 1) * pageSize : 0;
  const pageEnd = Math.min(pageStart + pageSize, rows.length);
  const visibleRows = rows.slice(pageStart, pageEnd);
  const pageNumbers = getPaginationPages(safePage, totalPages);

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
          <h2 className="text-sm font-semibold">{title}</h2>
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
          <div className="text-muted-foreground">Delayed files</div>
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
              onClick={() => onOpenMilestone(item.key)}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="text-muted-foreground">{item.label}</span>{" "}
              <span className="font-semibold tabular-nums">{item.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div>
          {rows.length
            ? `Showing ${pageStart + 1}-${pageEnd} of ${rows.length} delayed files`
            : "No delayed files"}
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
              <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
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
                    No delayed files found.
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
    description: "Files whose current milestone has remained open beyond the selected threshold.",
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
            : `<tr><td colspan="${exportColumns.length}">No delayed files found.</td></tr>`
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

function getActualCashOutgoRows(files: FileRecord[]): ExpectedCashOutgoRow[] {
  const totals = new Map<string, ExpectedCashOutgoRow>();

  files.forEach((file) => {
    if (isCancelledFile(file)) return;
    filePaymentOrders(file).forEach((order) => {
      if (!hasFilledString(order.paymentDate) || isYes(order.soCancelled)) return;
      const paymentDate = order.paymentDate;
      if (!paymentDate) return;

      addCashOutgoTotal(totals, paymentDate, file, order, "actual");
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
      amountType === "actual" ? getActualPaymentCapital(order) : order.soValueCapital,
      file,
    ) ?? 0;
  const revenue =
    getInrAmount(
      amountType === "actual" ? getActualPaymentRevenue(order) : order.soValueRevenue,
      file,
    ) ?? 0;
  current.capital += capital;
  current.revenue += revenue;
  current.total += capital + revenue;
  totals.set(monthKey, current);
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
    getCurrentMilestoneDelay(file, thresholdDays, selectedMilestoneKey),
    ...getCurrentOrderMilestoneDelayRows(file, thresholdDays, selectedMilestoneKey),
  ];
}

function getCurrentMilestoneDelay(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
) {
  const milestone = getActiveDelayMilestone(file);
  if (!milestone) return undefined;
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
    start: (file: FileRecord, order: SupplyOrderDetail) =>
      order.financialSanctionDate || getMainTimelineLastFilledDateValue(file),
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
    start: (file: FileRecord, order: SupplyOrderDetail) =>
      order.financialSanctionDate || getMainTimelineLastFilledDateValue(file),
    complete: (order: SupplyOrderDetail) => order.combinedBgReceivedDate,
  },
  {
    key: "delivery",
    label: "Delivery",
    current: "delivery",
    start: (file: FileRecord, order: SupplyOrderDetail) =>
      order.soDate || order.financialSanctionDate || getMainTimelineLastFilledDateValue(file),
    complete: (order: SupplyOrderDetail) => order.materialReceiptDate,
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
      order.irReceiptDate || order.materialReceiptDate,
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
  if (isCancelledFile(file) || !shouldUseOrderMilestoneRows(file)) return [];
  return orderDelayMilestones.flatMap((milestone) => {
    if (selectedMilestoneKey !== "all" && selectedMilestoneKey !== milestone.key) return [];
    const rows =
      milestone.key === "financialSanction" || milestone.key === "advancePayment"
        ? rawSupplyOrders(file)
        : fileSupplyOrders(file);
    return rows.flatMap((order, index) => {
      if (isSupplyOrderCancelled(file, order)) return [];
      if (milestone.key === "advancePayment") {
        if (!isAdvancePaymentPending(order)) return [];
      } else if (!isOrderCurrentForMilestone(file, order, normalizeMilestoneName(milestone.current))) {
        return [];
      }
      if (hasDate(milestone.complete(order))) return [];
      const stageStartDate = milestone.start(file, order);
      const daysInStage = getDaysSinceDate(stageStartDate);
      if (daysInStage === undefined || daysInStage <= thresholdDays) return [];
      return [
        {
          fileId: file.id,
          fileRef: getSupplyOrderDelayReference(file, order, index),
          division: file.division ?? "",
          indentor: file.indentor ?? "",
          description: file.demandDescription ?? "",
          milestoneKey: milestone.key,
          milestone: milestone.label,
          stageStartDate,
          daysInStage,
          lastFilledDate: getLastFilledDateValue(file) ?? "",
          focusSection: "Supply order and payment",
          focusTarget: `${milestone.current}:pending`,
        },
      ];
    });
  });
}

function getSupplyOrderDelayReference(file: FileRecord, order: SupplyOrderDetail, index: number) {
  const orderRef = order.soNo || order.gemSoNo || `S.O. ${index + 1}`;
  return `${getFileReference(file)} / ${orderRef}`;
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

function getMainTimelineLastFilledDateValue(file: FileRecord) {
  return [
    file.receivedDate,
    file.scrutinyDate,
    file.scrutinyResponseDate,
    file.scrutinyCompletionDate,
    file.immsDate,
    file.highValueMeetingDate,
    file.highValueMinutesDate,
    file.preTcecDate,
    file.preTcecMinutesDate,
    file.adVettingDate,
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
    file.preTcecDate,
    file.preTcecMinutesDate,
    file.adVettingDate,
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
    file.preTcecDate,
    file.preTcecMinutesDate,
    file.adVettingDate,
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

function getDelayStatusDashboardFilter(days: number, milestoneKey: string) {
  return `delayStatus:${days}:${milestoneKey || "all"}`;
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
    (totals, row) => ({
      capital: totals.capital + row.capital,
      revenue: totals.revenue + row.revenue,
    }),
    { capital: 0, revenue: 0 },
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
  "To be returned",
  "Returned",
  "In process",
  "Opening overdue",
  "Live",
  "Completed",
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
];

function getStatusSummaryTableGroups(files: FileRecord[]): StatusSummaryTableGroup[] {
  const byMilestone = new Map<string, StatusSummaryTableRow & { columns: StatusSummaryColumn[] }>();

  getStatusSummaryRows(files).forEach((row) => {
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
  const paymentGroup = orderedGroups.find((group) => group.title === "Payment");
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
  const advancePaymentRows = [
    {
      milestone: "Advance Payment",
      stage: "Completed",
      count: advancePaymentEntries(files).filter(
        ({ file, order }) => isAdvancePaymentPaid(order) && !isSupplyOrderCancelled(file, order),
      ).length,
    },
    {
      milestone: "Advance Payment",
      stage: "Pending",
      count: advancePaymentEntries(files).filter(
        ({ file, order }) => isAdvancePaymentPending(order) && !isSupplyOrderCancelled(file, order),
      ).length,
    },
  ];

  const lastBgIndex = Math.max(
    withDeliveryPeriod.map((row) => row.milestone).lastIndexOf("PSB"),
    withDeliveryPeriod.map((row) => row.milestone).lastIndexOf("PWB"),
    withDeliveryPeriod.map((row) => row.milestone).lastIndexOf("PSB+PWB"),
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

  if (lastBgIndex === -1) return [...withDeliveryPeriod, ...deliveryRows, ...advancePaymentRows];
  return [
    ...withDeliveryPeriod.slice(0, lastBgIndex + 1),
    ...deliveryRows,
    ...withDeliveryPeriod.slice(lastBgIndex + 1),
    ...advancePaymentRows,
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
      base("Pending", countCurrentOrderDrivenMilestoneStatuses(applicableFiles, "supplyorder")),
      base("At Previous Stage", countAtPreviousStageFiles(applicableFiles, milestone)),
    ];
  }

  if (milestone.key === "financialSanction") {
    return [
      base("At Previous Stage", countFinancialSanctionPreviousStageFiles(applicableFiles)),
      base("Completed", countCompletedOrderDrivenMilestoneStatuses(applicableFiles, "financialsanction")),
      base("Pending", countCurrentOrderDrivenMilestoneStatuses(applicableFiles, "financialsanction")),
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
    (sum, file) => sum + fileSupplyOrders(file).filter((order) => predicate(file, order)).length,
    0,
  );
}

function countPaymentCompletedOrders(files: FileRecord[]) {
  return files.reduce(
    (sum, file) =>
      sum +
      filePaymentOrders(file).filter(
        (order) => hasFilledString(order.paymentDate) && !isSupplyOrderCancelled(file, order),
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
          !isSupplyOrderCancelled(file, order),
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
        (order) => !isSupplyOrderCancelled(file, order) && isCompletedDeliveryOrder(order),
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

function getEffectiveOrderCurrentMilestone(file: FileRecord, order: SupplyOrderDetail) {
  if (isSupplyOrderPendingOrder(file, order)) return "supplyorder";
  const current = normalizeMilestoneName(order.currentMilestone);
  if (current && isOrderMilestoneApplicable(file, current)) return current;
  return "";
}

function isOrderMilestoneApplicable(file: FileRecord, normalizedMilestone: string) {
  if (normalizedMilestone === "bankguarantee") return isYes(file.bg);
  if (normalizedMilestone === "delivery") return isDeliveryInspectionApplicable(file);
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
    if (isCancelledFile(file)) return total;
    if (normalizedMilestone === "advancepayment") {
      return (
        total +
        advancePaymentEntries([file]).filter(
          ({ file: entryFile, order }) =>
            isAdvancePaymentPending(order) && !isSupplyOrderCancelled(entryFile, order),
        ).length
      );
    }
    if (!shouldUseOrderMilestoneRows(file)) {
      return (
        total + (normalizeMilestoneName(file.currentMilestone) === normalizedMilestone ? 1 : 0)
      );
    }
    return (
      total +
      expectedSupplyOrders(file).filter(
        (order) =>
          !isSupplyOrderCancelled(file, order) &&
          (normalizedMilestone === "supplyorder"
            ? isSupplyOrderPendingOrder(file, order)
            : getEffectiveOrderCurrentMilestone(file, order) === normalizedMilestone),
      ).length
    );
  }, 0);
}

function countFinancialSanctionPreviousStageFiles(files: FileRecord[]) {
  return files.filter((file) => {
    if (isCancelledFile(file)) return false;
    if (!isYes(file.biddingStageOver)) return false;
    if (isYes(file.tcec) && !hasFilledString(file.cncApprovalDate)) return false;
    if (matchesCompletedSupplyOrderDrivenMilestone(file, "financialsanction")) return false;
    return countCurrentOrderDrivenMilestoneStatuses([file], "financialsanction") === 0;
  }).length;
}

function countCompletedOrderDrivenMilestoneStatuses(
  files: FileRecord[],
  normalizedMilestone: string,
) {
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
          !isSupplyOrderCancelled(file, order) &&
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
        (order) => !isSupplyOrderCancelled(file, order) && isPendingDeliveryOrder(order),
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
        (order) => !isSupplyOrderCancelled(file, order) && isOverdueDeliveryOrder(order),
      ).length
    );
  }, 0);
}

function hasPaymentWorkflowStarted(file: FileRecord, order: SupplyOrderDetail) {
  return (
    isPaymentDueByDeliveryOrPeriod(file, order) ||
    hasFilledString(order.billPreparationDate) ||
    hasFilledString(order.billSentForPaymentDate)
  );
}

function isPaymentDueByDeliveryOrPeriod(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return hasFilledString(order.materialReceiptDate);
  const dueDate = getDeliveryPeriodDate(order);
  return hasFilledString(dueDate) && isDateBeforeToday(dueDate);
}

function isSupplyOrderCancelled(file: FileRecord, order: SupplyOrderDetail) {
  return isYes(file.demandCancelled) || isYes(order.soCancelled);
}

function isSupplyOrderPlaced(file: FileRecord) {
  const supplyOrderMilestone = milestoneDefinitions.find(
    (milestone) => milestone.key === "supplyOrder",
  );
  return supplyOrderMilestone ? isMilestoneComplete(file, supplyOrderMilestone) : false;
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

function isPendingDeliveryOrder(order: SupplyOrderDetail) {
  return isDueDeliveryOrder(order) && isCurrentDeliveryPeriodOrder(order);
}

function isOverdueDeliveryOrder(order: SupplyOrderDetail) {
  return isDueDeliveryOrder(order) && isDateBeforeToday(getDeliveryPeriodDate(order));
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
  if (isYes(order.soCancelled)) return true;
  const validityDate = getBgValidityDate(order, category);
  const normalizedCategory = normalizeMilestoneName(category);
  return (
    !isSupplyOrderCancelled(file, order) &&
    (normalizedCategory === "psb"
      ? hasFilledString(order.irReceiptDate)
      : hasFilledString(order.paymentDate) &&
        hasFilledString(validityDate) &&
        isDateBeforeToday(validityDate))
  );
}

function isBgExpiredOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const validityDate = getBgValidityDate(order, category);
  return (
    isBgCategoryApplicable(file, order, category) &&
    isBgReceivedOrder(order, category) &&
    !hasFilledString(getBgReturnDate(order, category)) &&
    !isSupplyOrderCancelled(file, order) &&
    !hasFilledString(order.paymentDate) &&
    hasFilledString(validityDate) &&
    isDateBefore(validityDate, getDeliveryPeriodDate(order)) &&
    isDateBeforeToday(validityDate)
  );
}

function isDeliveryInspectionApplicable(file: FileRecord) {
  const fileType = (file.fileType ?? "").trim().toLowerCase();
  return fileType !== "amc" && fileType !== "mpc" && fileType !== "cars" && fileType !== "o&m";
}

function getDeliveryPeriodDate(order: SupplyOrderDetail) {
  return getLaterDate(order.dpDate, order.revisedDp);
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

function isBidOverdue(file: FileRecord) {
  return (
    isNo(file.bidOpened) &&
    (isDateBeforeToday(file.bidOpeningDate) || isDateBeforeToday(file.refloatBidOpeningDate))
  );
}

function hasSupplyOrderDate(order: SupplyOrderDetail) {
  return hasFilledString(order.soDate);
}

function isFinancialSanctionCompletedOrder(order: SupplyOrderDetail) {
  return (
    hasFilledString(order.financialSanctionDate) ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === "financialsanction",
    )
  );
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
