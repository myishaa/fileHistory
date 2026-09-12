import type {
  AppSettings,
  BillReturnCycle,
  Division,
  FileRecord,
  SupplementaryBillDetail,
  SupplyOrderDetail,
} from "../types.js";
import {
  advancePaymentEntries,
  countExpectedSupplyOrderRows,
  effectivePaymentEntries as normalizedPaymentEntries,
  effectiveSupplyOrderEntries as normalizedSupplyOrderEntries,
  expectedSupplyOrders as normalizedExpectedSupplyOrders,
  filePaymentOrders as normalizedFilePaymentOrders,
  fileSupplyOrders as normalizedFileSupplyOrders,
  getEffectiveSupplyOrderCurrentMilestone as getCanonicalSupplyOrderCurrentMilestone,
  getAdvancePaymentCapital,
  getAdvancePaymentRevenue,
  isAdvancePaymentCompleted,
  isAdvancePaymentPaid,
  isAdvancePaymentPending,
  isSupplyOrderMilestoneCurrent as isCanonicalSupplyOrderMilestoneCurrent,
  isExpiredDeliveryPeriodEntry,
  isExtendedDeliveryPeriodEntry,
  isValidDeliveryPeriodEntry,
  rawSupplyOrders as normalizedRawSupplyOrders,
} from "./effective-deliveries.js";
import { allFileCategoryKeys, matchesFileCategorySelection } from "./file-categories.js";
import {
  isBiddingApplicableForFile,
  isContractFileType,
  isDeliveryInspectionApplicableByGroup,
} from "./file-type-groups.js";
import {
  hasBillReturnHistory,
  hasCompletedBillReturn,
  hasOpenBillReturn,
  hasReturnedBill,
  hasReturnedBillPaid,
  normalizeBillReturnCycles,
} from "./refloat-returned-bill.js";
import { getStatusSummaryTableGroups } from "./report-summary.js";

export type DashboardSummary = ReturnType<typeof buildDashboardSummary>;

type FinanceCarryForwardRow = {
  year: string;
  count: number;
  capital: number;
  revenue: number;
  total: number;
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
  "File Closed",
];
const fileClosedMilestone = "File Closed";
const protectedLiveStatusMilestones = [
  "Refloat bidding",
  "Refloat Post-TCEC",
  "Bill returned for correction",
  "Supplementary bill returned for correction",
  "Job Completion",
];
const supplyOrderMilestoneNames = [
  "Financial Sanction",
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
  "Advance Payment",
  "Payment",
];

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
  { key: "rfpVetting", label: "RFP vetting", yesLabel: "RFP vetting", noLabel: "Non RFP vetting" },
  { key: "refloat", label: "Refloat", yesLabel: "Refloat", noLabel: "Non Refloat" },
  { key: "rst", label: "RST", yesLabel: "RST", noLabel: "Non RST" },
] satisfies Array<{
  key: keyof FileRecord;
  label: string;
  yesLabel: string;
  noLabel: string;
}>;

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
    applies: (file: FileRecord) => isYes(file.highValue),
  },
  {
    key: "tcec",
    label: "Pre-TCEC",
    totalLabel: "Total cases",
    reviewed: "preTcecDate",
    current: "preTcecMinutesDate",
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    key: "ad",
    label: "AD",
    totalLabel: "Total cases",
    reviewed: "adSentDate",
    current: "adVettingDate",
    applies: (file: FileRecord) => isYes(file.ad),
  },
  {
    key: "rqa",
    label: "R&QA",
    totalLabel: "Total cases",
    reviewed: "rqaSentDate",
    current: "rqaApprovalDate",
    applies: (file: FileRecord) => isYes(file.rqa),
  },
  { key: "control", label: "Controlling", totalLabel: "Total files", current: "immsDate" },
  {
    key: "ifa",
    label: "IFA",
    totalLabel: "Total cases",
    reviewed: "ifaSentDate",
    current: "ifaFinalDate",
    applies: (file: FileRecord) => isYes(file.ifa),
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
    applies: (file: FileRecord) => isBiddingApplicableForFile(file),
  },
  {
    key: "postTcec",
    label: "Post-TCEC",
    totalLabel: "Total cases",
    reviewed: "postTcecDate",
    current: "postTcecMinutesDate",
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    key: "refloatBidding",
    label: "Refloat bidding",
    totalLabel: "Total cases",
    completedLabel: "Completed",
    pendingLabel: "In progress",
    current: "biddingStageOver",
    applies: (file: FileRecord) => isYes(file.refloat),
  },
  {
    key: "refloatPostTcec",
    label: "Refloat Post-TCEC",
    totalLabel: "Total cases",
    reviewed: "refloatPostTcecDate",
    current: "refloatPostTcecMinutesDate",
    applies: (file: FileRecord) =>
      isYes(file.refloat) && isYes(file.tcec) && isYes(file.biddingStageOver),
  },
  {
    key: "cnc",
    label: "CNC",
    totalLabel: "Total cases",
    reviewed: "cncDate",
    current: "cncApprovalDate",
    applies: (file: FileRecord) => isYes(file.tcec),
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
    applies: (file: FileRecord) => isYes(file.bg),
  },
  {
    key: "psbPwb",
    label: "PSB+PWB",
    completedLabel: "Received",
    totalLabel: "Total files",
    current: "combinedBgReceivedDate",
    applies: (file: FileRecord) => isYes(file.bg),
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

const supplyOrderDateKeys = new Set<keyof SupplyOrderDetail>([
  "financialSanctionDate",
  "soDate",
  "psbBgReceivedDate",
  "pwbBgReceivedDate",
  "combinedBgReceivedDate",
  "jobCompletionDate",
  "irPreparationDate",
  "irReceiptDate",
  "billPreparationDate",
  "billSentForPaymentDate",
  "paymentDate",
  "soCancelledDate",
  "shortclosureDate",
]);

export function buildDashboardSummary({
  files,
  firmHistoryFiles,
  divisions,
  settings,
  division = "all",
  liveMilestones,
  financeFiles,
}: {
  files: FileRecord[];
  firmHistoryFiles?: FileRecord[];
  financeFiles?: FileRecord[];
  divisions: Division[];
  settings: AppSettings;
  division?: string;
  liveMilestones?: string[];
}) {
  const activeDivision =
    division === "all" || divisions.some((item) => item.name === division) ? division : "all";
  const dashboardFiles =
    activeDivision === "all" ? files : files.filter((file) => file.division === activeDivision);
  const activeDashboardFiles = dashboardFiles.filter((file) => !isCancelledFile(file));
  const processHistoryDashboardFiles = dashboardFiles.filter((file) => !isYes(file.demandCancelled));
  const rawFinanceFiles = financeFiles ?? files;
  const dashboardFinanceFiles =
    activeDivision === "all"
      ? rawFinanceFiles
      : rawFinanceFiles.filter((file) => file.division === activeDivision);
  const activeDashboardFinanceFiles = dashboardFinanceFiles.filter(
    (file) => !isCancelledFile(file),
  );
  const dashboardDivisions =
    activeDivision === "all" ? divisions : divisions.filter((item) => item.name === activeDivision);
  const rawFirmHistoryFiles = firmHistoryFiles ?? files;
  const dashboardFirmHistoryFiles =
    activeDivision === "all"
      ? rawFirmHistoryFiles
      : rawFirmHistoryFiles.filter((file) => file.division === activeDivision);
  const analyticsSummary = getAnalyticsSummary(
    activeDashboardFiles,
    dashboardDivisions,
    settings.valueThresholdLevels,
  );
  const manualMilestoneFlow = getManualMilestoneFlow(
    activeDashboardFiles,
    getConfiguredMilestones(settings.milestones),
  );
  const visibleLiveMilestoneNames = getVisibleLiveMilestoneNames(
    liveMilestones,
    manualMilestoneFlow,
  );
  const financeTotals = getFinanceTotals(
    activeDashboardFiles,
    dashboardDivisions,
    settings.selectedYear,
    activeDashboardFinanceFiles,
    settings.financialYear,
  );

  return {
    activeDivision,
    valueThresholdLevels: settings.valueThresholdLevels,
    dashboardFileCount: activeDashboardFiles.length,
    dashboardDivisions,
    modeCounts: getModeCounts(processHistoryDashboardFiles, settings.modes),
    gemBiddingModeCounts: getGemBiddingModeCounts(processHistoryDashboardFiles),
    topSummaryStats: getAttributeSummaryStats(activeDashboardFiles),
    fileTypeStats: getFileTypeSummaryStats(activeDashboardFiles, settings.fileTypes),
    firmTypeStats: getFirmTypeSummaryStats(activeDashboardFiles, settings.firmTypes),
    manualMilestoneFlow,
    visibleLiveMilestoneNames,
    liveStatusRows: getLiveStatusDivisionRows(
      activeDashboardFiles,
      dashboardDivisions,
      visibleLiveMilestoneNames,
    ),
    statusSummaryGroups: getStatusSummaryTableGroups(activeDashboardFiles),
    statusFlow: getMilestoneFlow(activeDashboardFiles),
    miscellaneousCounts: getMiscellaneousCounts(dashboardFiles),
    analytics: {
      ...analyticsSummary,
      divisionTurnaroundRanking: getDivisionTurnaroundRanking(processHistoryDashboardFiles),
      biddingModeMix: getBiddingModeMix(processHistoryDashboardFiles),
      topFirmSupplyOrders: getTopFirmSupplyOrders(dashboardFirmHistoryFiles),
      firmAnalysis: getFirmAnalysisRows(dashboardFirmHistoryFiles),
      monthWiseSupplyOrder: getMonthWiseSupplyOrder(dashboardFiles),
      tcecStatus: getTcecStatusSummary(dashboardFiles),
      cncSummary: getCncSummary(dashboardFiles),
    },
    financeTotals,
    financeFirmTypeDistributions: {
      supplyOrderValue: getSupplyOrderValueDistributionByFirmType(
        activeDashboardFiles,
        settings.firmTypes,
      ),
      actualPayment: getActualPaymentDistributionByFirmType(
        activeDashboardFinanceFiles,
        settings.firmTypes,
      ),
    },
    financePercents: {
      capitalBooked: getPercent(financeTotals.bookedCapital, financeTotals.allocatedCapital),
      revenueBooked: getPercent(financeTotals.bookedRevenue, financeTotals.allocatedRevenue),
      capitalProjected: getPercent(financeTotals.projectedCapital, financeTotals.allocatedCapital),
      revenueProjected: getPercent(financeTotals.projectedRevenue, financeTotals.allocatedRevenue),
      capitalSpent: getPercent(financeTotals.spentCapital, financeTotals.allocatedCapital),
      revenueSpent: getPercent(financeTotals.spentRevenue, financeTotals.allocatedRevenue),
    },
  };
}

function getFinanceTotals(
  files: FileRecord[],
  divisions: Division[],
  selectedYear?: string,
  financeFiles = files,
  currentFinancialYear?: string,
) {
  const financeYear = getFinancialYearDateRange(selectedYear) ? selectedYear : currentFinancialYear;
  const financeYearRange = getFinancialYearDateRange(financeYear);
  const paymentLiabilityEntries = getFinancePaymentLiabilityEntries(financeFiles);
  const actualPaymentEntries = paymentLiabilityEntries.filter((entry) =>
    hasFilledString(entry.paymentDate),
  );
  const paymentInYearEntries = financeYearRange
    ? actualPaymentEntries.filter((entry) => isDateWithinRange(entry.paymentDate, financeYearRange))
    : actualPaymentEntries;
  const sameYearPaidEntries = financeYearRange
    ? paymentInYearEntries.filter((entry) => isDateWithinRange(entry.sourceDate, financeYearRange))
    : [];
  const carryForwardRows = getFinanceCarryForwardRows(financeFiles, financeYear);
  return {
    allocatedCapital: divisions.reduce(
      (sum, division) => sum + (parseAmount(division.allocatedCapital) ?? 0),
      0,
    ),
    allocatedRevenue: divisions.reduce(
      (sum, division) => sum + (parseAmount(division.allocatedRevenue) ?? 0),
      0,
    ),
    bookedCapital: files.reduce(
      (sum, file) =>
        sum +
        (isCancelledFile(file)
          ? 0
          : hasFilledField(file, "imms") && getFileCommittedCapitalValue(file) <= 0
            ? (getInrAmount(file.valueCapital, file) ?? 0)
            : 0),
      0,
    ),
    bookedRevenue: files.reduce(
      (sum, file) =>
        sum +
        (isCancelledFile(file)
          ? 0
          : hasFilledField(file, "imms") && getFileCommittedRevenueValue(file) <= 0
            ? (getInrAmount(file.valueRevenue, file) ?? 0)
            : 0),
      0,
    ),
    projectedCapital: files.reduce(
      (sum, file) =>
        sum +
        (!isCancelledFile(file) && !hasFilledField(file, "imms")
          ? (getInrAmount(file.valueCapital, file) ?? 0)
          : 0),
      0,
    ),
    projectedRevenue: files.reduce(
      (sum, file) =>
        sum +
        (!isCancelledFile(file) && !hasFilledField(file, "imms")
          ? (getInrAmount(file.valueRevenue, file) ?? 0)
          : 0),
      0,
    ),
    spentCapital: files.reduce(
      (sum, file) => sum + (isSoCancelledFile(file) ? 0 : getFileCommittedCapitalValue(file)),
      0,
    ),
    spentRevenue: files.reduce(
      (sum, file) => sum + (isSoCancelledFile(file) ? 0 : getFileCommittedRevenueValue(file)),
      0,
    ),
    paidCapital: paymentInYearEntries.reduce(
      (sum, entry) => sum + entry.capital,
      0,
    ),
    paidRevenue: paymentInYearEntries.reduce(
      (sum, entry) => sum + entry.revenue,
      0,
    ),
    sameYearPaidCapital: sameYearPaidEntries.reduce(
      (sum, entry) => sum + entry.capital,
      0,
    ),
    sameYearPaidRevenue: sameYearPaidEntries.reduce(
      (sum, entry) => sum + entry.revenue,
      0,
    ),
    advanceCapital: advancePaymentEntries(files).reduce(
      (sum, { file, order }) =>
        sum +
        (isSupplyOrderCancelled(file, order)
          ? 0
          : (getInrAmount(getAdvancePaymentCapital(order), file) ?? 0)),
      0,
    ),
    advanceRevenue: advancePaymentEntries(files).reduce(
      (sum, { file, order }) =>
        sum +
        (isSupplyOrderCancelled(file, order)
          ? 0
          : (getInrAmount(getAdvancePaymentRevenue(order), file) ?? 0)),
      0,
    ),
    carryForward: sumFinanceCarryForwardRows(carryForwardRows.carryForward),
    clearedCarryForward: sumFinanceCarryForwardRows(carryForwardRows.clearedCarryForward),
    previousCarryForward: sumFinanceCarryForwardRows(carryForwardRows.previousCarryForward),
    futureClearedCarryForward: sumFinanceCarryForwardRows(
      carryForwardRows.futureClearedCarryForward,
    ),
    carryForwardBreakup: carryForwardRows.carryForward,
    clearedCarryForwardBreakup: carryForwardRows.clearedCarryForward,
    previousCarryForwardBreakup: carryForwardRows.previousCarryForward,
    futureClearedCarryForwardBreakup: carryForwardRows.futureClearedCarryForward,
  };
}

function getFinanceCarryForwardRows(files: FileRecord[], selectedYear: string | undefined) {
  const range = getFinancialYearDateRange(selectedYear);
  if (!range || !selectedYear) {
    return {
      carryForward: [] as FinanceCarryForwardRow[],
      clearedCarryForward: [] as FinanceCarryForwardRow[],
      previousCarryForward: [] as FinanceCarryForwardRow[],
      futureClearedCarryForward: [] as FinanceCarryForwardRow[],
    };
  }
  const financialYear = selectedYear;
  const carryForward = new Map<string, Omit<FinanceCarryForwardRow, "year" | "filter">>();
  const clearedCarryForward = new Map<string, Omit<FinanceCarryForwardRow, "year" | "filter">>();
  const previousCarryForward = new Map<string, Omit<FinanceCarryForwardRow, "year" | "filter">>();
  const futureClearedCarryForward = new Map<
    string,
    Omit<FinanceCarryForwardRow, "year" | "filter">
  >();

  for (const entry of getFinancePaymentLiabilityEntries(files)) {
    const sourceYear = getFinancialYearForDate(entry.sourceDate);
    if (!sourceYear) continue;
    const paymentDate = entry.paymentDate;
    const paidInSelectedYear = isDateWithinRange(paymentDate, range);
    const unpaidAtSelectedYearEnd =
      !hasFilledString(paymentDate) || isDateAfter(paymentDate, range.end);
    const capital = entry.capital;
    const revenue = entry.revenue;

    if (sourceYear === financialYear && unpaidAtSelectedYearEnd) {
      addFinanceCarryForward(carryForward, sourceYear, capital, revenue);
    }
    if (
      sourceYear === financialYear &&
      hasFilledString(paymentDate) &&
      isDateAfter(paymentDate, range.end)
    ) {
      const clearingYear = getFinancialYearForDate(paymentDate);
      if (clearingYear && clearingYear > financialYear) {
        addFinanceCarryForward(futureClearedCarryForward, clearingYear, capital, revenue);
      }
    }
    if (sourceYear !== financialYear && sourceYear < financialYear && paidInSelectedYear) {
      addFinanceCarryForward(clearedCarryForward, sourceYear, capital, revenue);
    }
    if (sourceYear !== financialYear && sourceYear < financialYear && unpaidAtSelectedYearEnd) {
      addFinanceCarryForward(previousCarryForward, sourceYear, capital, revenue);
    }
  }

  return {
    carryForward: mapFinanceCarryForwardRows(carryForward, "carryForward", financialYear),
    clearedCarryForward: mapFinanceCarryForwardRows(
      clearedCarryForward,
      "clearedCarryForward",
      financialYear,
    ),
    previousCarryForward: mapFinanceCarryForwardRows(
      previousCarryForward,
      "previousCarryForward",
      financialYear,
    ),
    futureClearedCarryForward: mapFinanceCarryForwardRows(
      futureClearedCarryForward,
      "futureClearedCarryForward",
      financialYear,
    ),
  };
}

function addFinanceCarryForward(
  rows: Map<string, Omit<FinanceCarryForwardRow, "year" | "filter">>,
  year: string,
  capital: number,
  revenue: number,
) {
  const current = rows.get(year) ?? { count: 0, capital: 0, revenue: 0, total: 0 };
  current.count += 1;
  current.capital += capital;
  current.revenue += revenue;
  current.total += capital + revenue;
  rows.set(year, current);
}

function mapFinanceCarryForwardRows(
  rows: Map<string, Omit<FinanceCarryForwardRow, "year" | "filter">>,
  mode: string,
  selectedYear: string,
) {
  return Array.from(rows.entries())
    .map(([year, row]) => ({
      year,
      count: row.count,
      capital: Math.round(row.capital),
      revenue: Math.round(row.revenue),
      total: Math.round(row.total),
      filter: `financeCarryForward:${mode}:${encodeURIComponent(selectedYear)}:${encodeURIComponent(year)}`,
    }))
    .sort((a, b) => b.year.localeCompare(a.year));
}

function sumFinanceCarryForwardRows(rows: FinanceCarryForwardRow[]) {
  return rows.reduce(
    (total, row) => ({
      count: total.count + row.count,
      capital: total.capital + row.capital,
      revenue: total.revenue + row.revenue,
      total: total.total + row.total,
    }),
    { count: 0, capital: 0, revenue: 0, total: 0 },
  );
}

function getModeCounts(files: FileRecord[], configuredModes: string[] | undefined) {
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

function getGemBiddingModeCounts(files: FileRecord[]) {
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

function getAttributeSummaryStats(files: FileRecord[]) {
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

function getFileTypeSummaryStats(files: FileRecord[], fileTypes: string[] | undefined) {
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

function getConfiguredFileTypes(fileTypes: string[] | undefined, files: FileRecord[]) {
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

function getFirmTypeSummaryStats(files: FileRecord[], firmTypes: string[] | undefined) {
  return {
    label: "Firm Type",
    value: getConfiguredFirmTypes(firmTypes, files).map((firmType) => ({
      label: firmType,
      value: files.filter((file) =>
        normalizedFileSupplyOrders(file).some((order) => isFirmTypeMatch(order, firmType)),
      ).length,
      searchFilter: `firmType:${encodeURIComponent(firmType)}`,
    })),
    hint: "Files grouped by supply order firm type",
  };
}

function getConfiguredFirmTypes(firmTypes: string[] | undefined, files: FileRecord[] = []) {
  const defaults = ["MSE", "MSE (Women)", "Non-MSE"];
  const seen = new Set<string>();
  const existingFirmTypes = files.flatMap((file) =>
    normalizedFileSupplyOrders(file).map(getEffectiveFirmType),
  );
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

function getMiscellaneousCounts(files: FileRecord[]) {
  const activeFiles = files.filter((file) => !isCancelledFile(file));
  return {
    liveFiles: activeFiles.filter((file) => !isFileClosed(file)).length,
    fileClosed: activeFiles.filter(isFileClosed).length,
    ld: countLdOrders(activeFiles),
    billsReturnedForCorrection: countBillsReturnedForCorrection(activeFiles),
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

function countSupplementaryBillPendingOrders(files: FileRecord[]) {
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
  return (
    hasFilledString(bill.billSentForPaymentDate) &&
    !hasOpenSupplementaryBillReturn(bill) &&
    !hasCompletedSupplementaryBillReturn(bill) &&
    !hasFilledString(bill.paymentDate)
  );
}

function isSupplementaryBillReturned(bill: SupplementaryBillDetail) {
  return !hasFilledString(bill.paymentDate) && hasOpenSupplementaryBillReturn(bill);
}

function isSupplementaryBillResubmitted(bill: SupplementaryBillDetail) {
  return (
    !hasFilledString(bill.paymentDate) &&
    !hasOpenSupplementaryBillReturn(bill) &&
    hasCompletedSupplementaryBillReturn(bill)
  );
}

function isSupplementaryBillPaid(bill: SupplementaryBillDetail) {
  return hasSupplementaryBillData(bill) && hasFilledString(bill.paymentDate);
}

function isReturnedSupplementaryBillPaid(bill: SupplementaryBillDetail) {
  return isSupplementaryBillPaid(bill) && hasCompletedSupplementaryBillReturn(bill);
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

function getManualMilestoneFlow(files: FileRecord[], milestones: string[]) {
  const configured = milestones
    .map((name) => normalizeLiveStatusMilestoneName(name.trim()))
    .filter(Boolean)
    .filter((name) => normalizeMilestoneName(name) !== normalizeMilestoneName(fileClosedMilestone));
  const extras = files
    .map((file) => file.currentMilestone?.trim())
    .map((name) => (name ? normalizeLiveStatusMilestoneName(name) : name))
    .filter((name): name is string => Boolean(name))
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
  if (normalized === "refloatbidding") {
    return files.filter(
      (file) => !isCancelledFile(file) && isYes(file.refloat) && !isYes(file.biddingStageOver),
    ).length;
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

function getConfiguredMilestones(milestones: string[] | undefined) {
  const values = (milestones ?? [])
    .map((item) => normalizeLiveStatusMilestoneName(item.trim()))
    .filter(Boolean);
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
      .filter((name) => available.has(name)) ??
      manualMilestoneFlow.map((milestone) => milestone.name),
  );
  protectedLiveStatusMilestones.forEach((milestone) => {
    if (available.has(milestone) && !visible.includes(milestone)) visible.push(milestone);
  });
  return visible;
}

function getLiveStatusDivisionRows(
  files: FileRecord[],
  divisions: Division[],
  milestoneNames: string[],
) {
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
  if (normalized === "bankguarantee") return countBgPendingOrders(files, "psb");
  if (isBgMilestoneKey(normalized)) return countBgPendingOrders(files, normalized);
  if (normalized === "supplementarybillreturnedforcorrection") {
    return countSupplementaryBillReturnedOrders(files);
  }
  if (normalized === "refloatbidding") {
    return files.filter(
      (file) => !isCancelledFile(file) && isYes(file.refloat) && !isYes(file.biddingStageOver),
    ).length;
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
  if (normalizedMilestone === "delivery") return isDeliveryInspectionApplicable(file);
  if (normalizedMilestone === "jobcompletion") return isJobCompletionWorkflow(file);
  if (normalizedMilestone === "irpreparation" || normalizedMilestone === "irreceipt") {
    return isYes(file.ir);
  }
  return true;
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
          countCompletedSupplyOrderMilestoneStatuses([file], "financialsanction") === 0
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
              !isSupplyOrderCancelled(file, order) && hasFilledString(order.financialSanctionDate),
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
    if (normalizedMilestone === "billsentforpayment") {
      return (
        total +
        normalizedFilePaymentOrders(file).filter(
          (order) =>
            isPaymentOrderActive(file, order) &&
            !hasOpenBillReturn(order) &&
            hasFilledString(order.billSentForPaymentDate),
        ).length
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
            ? hasFilledString(order.financialSanctionDate)
            : normalizedMilestone === "billsentforpayment"
              ? !hasOpenBillReturn(order) &&
                (hasFilledString(order.billSentForPaymentDate) ||
                  normalizeCompletedMilestones(order.completedMilestones).some(
                    (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
                  ))
              : normalizeCompletedMilestones(order.completedMilestones).some(
                  (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
                )),
      ).length
    );
  }, 0);
}

function countFinancialSanctionPreviousStageFiles(files: FileRecord[]) {
  return files.filter(isFinancialSanctionPreviousStageFile).length;
}

function isFinancialSanctionPreviousStageFile(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  if (countCompletedSupplyOrderMilestoneStatuses([file], "financialsanction") > 0) return false;
  if (countCurrentSupplyOrderMilestoneStatuses([file], "financialsanction") > 0) return false;
  const current = normalizeMilestoneName(file.currentMilestone);
  if (isYes(file.tcec)) return current === "cnc" && !hasFilledString(file.cncApprovalDate);
  return isBiddingApplicableForFile(file)
    ? current === "bidding" && !isYes(file.biddingStageOver)
    : current === "cfa" && !hasFilledString(file.cfaDate);
}

function getMilestoneFlow(files: FileRecord[]) {
  const flow = milestoneDefinitions.map((milestone) => {
    const applicableFiles = files.filter((file) => isMilestoneApplicable(file, milestone));
    const reachedFiles = applicableFiles.filter((file) => isEligibleMilestone(file, milestone));
    const activeFiles = applicableFiles.filter((file) => isManualActiveMilestone(file, milestone));
    const reviewedFiles = activeFiles.filter((file) => isMilestoneReviewed(file, milestone));
    const clearedFiles = applicableFiles.filter((file) => isMilestoneComplete(file, milestone));
    const pendingFiles = activeFiles.filter((file) => isPendingMilestone(file, milestone));

    if (milestone.key === "refloatBidding") {
      const inProgressFiles = applicableFiles.filter((file) => !isYes(file.biddingStageOver));
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: milestone.completedLabel ?? "Completed",
        totalLabel: milestone.totalLabel ?? "Total",
        pendingLabel: milestone.pendingLabel ?? getMilestonePendingLabel(milestone),
        total: applicableFiles.length,
        underProcess: 0,
        active: inProgressFiles.length,
        pending: inProgressFiles.length,
        reviewed: 0,
        hasReviewed: false,
        cleared: clearedFiles.length,
        activeLabel: "In progress",
      };
    }

    if (milestone.key === "refloatPostTcec") {
      const pendingRefloatPostTcec = applicableFiles.filter(
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
        total: applicableFiles.length,
        underProcess: files.filter((file) => isYes(file.refloat) && !isYes(file.biddingStageOver))
          .length,
        active: pendingRefloatPostTcec.length,
        pending: pendingRefloatPostTcec.length,
        reviewed: reviewedRefloatPostTcec.length,
        hasReviewed: Boolean(milestone.reviewed),
        cleared: clearedFiles.length,
        activeLabel: "In process",
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

    if (
      milestone.key === "irPreparation" ||
      milestone.key === "irReceipt" ||
      milestone.key === "billPreparation" ||
      milestone.key === "billSentForPayment"
    ) {
      const normalized = normalizeMilestoneName(milestone.label);
      const completed = countCompletedSupplyOrderMilestoneStatuses(applicableFiles, normalized);
      const pending = countCurrentSupplyOrderMilestoneStatuses(applicableFiles, normalized);
      return {
        key: milestone.key,
        label: milestone.label,
        completedLabel: milestone.completedLabel ?? "Completed",
        totalLabel: milestone.totalLabel ?? "Total",
        pendingLabel: getMilestonePendingLabel(milestone),
        total: completed + pending,
        underProcess: countAtPreviousStageFiles(applicableFiles, milestone),
        active: pending,
        pending,
        reviewed: 0,
        hasReviewed: Boolean(milestone.reviewed),
        cleared: completed,
        activeLabel: "In process",
      };
    }

    if (milestone.key === "payment") {
      const paymentCompleted = countPaymentCompletedOrders(files);
      const paymentPending = countPaymentPendingOrders(files);
      const advancePaid = countAdvancePaymentPaidOrders(files);
      const advancePending = countAdvancePaymentPendingOrders(files);
      const billsReturnedForCorrection = countBillsReturnedForCorrection(files);
      const returnedBillsPending = countReturnedBillsPending(files);
      const returnedBillsResubmitted = countReturnedBillsResubmitted(files);
      const returnedBillsPaid = countReturnedBillsPaid(files);
      const supplementaryPending = countSupplementaryBillPendingOrders(files);
      const supplementaryReturnedForCorrection = countSupplementaryBillReturnHistoryOrders(files);
      const supplementaryReturnedPending = countSupplementaryBillReturnedOrders(files);
      const supplementaryReturnedResubmitted = countSupplementaryBillResubmittedOrders(files);
      const supplementaryPaid = countSupplementaryBillPaidOrders(files);
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
        advancePaid,
        advancePending,
        billsReturnedForCorrection,
        returnedBillsPending,
        returnedBillsResubmitted,
        returnedBillsPaid,
        supplementaryPending,
        supplementaryReturnedForCorrection,
        supplementaryReturnedPending,
        supplementaryReturnedResubmitted,
        supplementaryPaid,
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
      total: applicableFiles.length,
      underProcess: countAtPreviousStageFiles(applicableFiles, milestone),
      active: activeFiles.length,
      pending: pendingFiles.length,
      reviewed: reviewedFiles.length,
      hasReviewed: Boolean(milestone.reviewed),
      cleared: clearedFiles.length,
      activeLabel: "In process",
      liveBids:
        milestone.key === "bidding" ? applicableFiles.filter(isFileTenderLive).length : undefined,
      overdueBids:
        milestone.key === "bidding" ? applicableFiles.filter(isBidOverdue).length : undefined,
      inProcessBids:
        milestone.key === "bidding"
          ? activeFiles.filter((file) => !isFileTenderLive(file) && !isBidOverdue(file)).length
          : undefined,
    };
  });
  const preBidMeeting = {
    key: "preBidMeeting",
    label: "Pre-Bid Meeting",
    preBidDue: countPreBidMeetingFiles(files, false, "due"),
    preBidCompleted: countPreBidMeetingFiles(files, false, "completed"),
    refloatPreBidDue: countPreBidMeetingFiles(files, true, "due"),
    refloatPreBidCompleted: countPreBidMeetingFiles(files, true, "completed"),
  };
  const biddingIndex = flow.findIndex((milestone) => milestone.key === "bidding");
  const withPreBid =
    biddingIndex === -1
      ? [...flow, preBidMeeting]
      : [...flow.slice(0, biddingIndex + 1), preBidMeeting, ...flow.slice(biddingIndex + 1)];
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
  const supplyOrderIndexWithPreBid = withPreBid.findIndex(
    (milestone) => milestone.key === "supplyOrder",
  );
  const withDeliveryPeriod =
    supplyOrderIndexWithPreBid === -1
      ? [...withPreBid, deliveryPeriod]
      : [
          ...withPreBid.slice(0, supplyOrderIndexWithPreBid + 1),
          deliveryPeriod,
          ...withPreBid.slice(supplyOrderIndexWithPreBid + 1),
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

function getAnalyticsSummary(
  files: FileRecord[],
  divisions: Division[],
  valueThresholdLevels: AppSettings["valueThresholdLevels"] = [],
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
    soValueThresholds: getSupplyOrderValueThresholds(files, valueThresholdLevels),
    divisionRiskRanking: getDivisionRiskRanking(files),
    divisionPaymentPendingRanking: getDivisionPaymentPendingRanking(files),
    tcecStatus: getTcecStatusSummary(files),
    cncSummary: getCncSummary(files),
  };
}

type TcecStatusStage = "pre" | "post";

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
    const minutesDate = getTcecMinutesDate(file, stage);
    const meetingDate = getTcecMeetingDate(file, stage);
    if (!hasFilledString(meetingDate) && !hasFilledString(minutesDate)) return;
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
  const totals = new Map<string, Record<string, number>>();
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
    fileSupplyOrders(file).forEach((order) => {
      const name = getAnalyticsName(order.firm, "Unassigned firm");
      const value = getSupplyOrderTotalValue(file, order);
      if (value <= 0) return;
      totals.set(name, (totals.get(name) ?? 0) + value);
    });
  });
  return mapEntriesToSortedRows(totals, "value");
}

type FirmAnalysisRoleKey = "bq" | "invited" | "participated" | "order";

const firmAnalysisRoleKeys: FirmAnalysisRoleKey[] = ["bq", "invited", "participated", "order"];

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
  return firmAnalysisRoleKeys.reduce(
    (mask, role) => (roles[role].has(firmName) ? mask | firmAnalysisRoleBit(role) : mask),
    0,
  );
}

function firmAnalysisRoleBit(role: FirmAnalysisRoleKey) {
  return role === "bq" ? 1 : role === "invited" ? 2 : role === "participated" ? 4 : 8;
}

function getSupplyOrderValueDistributionByFirmType(
  files: FileRecord[],
  configuredFirmTypes: string[] | undefined,
) {
  const totals = new Map<string, number>();
  const configured = getConfiguredFirmTypes(configuredFirmTypes);
  effectiveSupplyOrderEntries(files).forEach(({ file, order }) => {
    if (isSupplyOrderCancelled(file, order)) return;
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
) {
  const totals = new Map<string, number>();
  const configured = getConfiguredFirmTypes(configuredFirmTypes);
  getFinancePaymentLiabilityEntries(files).forEach((entry) => {
    if (!hasFilledString(entry.paymentDate)) return;
    const value = entry.capital + entry.revenue;
    if (value <= 0) return;
    const name = getFirmTypeDistributionName(entry.order, configured);
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

function getMilestoneClearingRanking(files: FileRecord[]) {
  return milestoneClearingDefinitions
    .map((definition, index) => {
      const durations = getMilestoneClearingDurationRows(files, definition);
      const fileIds = Array.from(new Set(durations.map((row) => row.fileId)));
      const stats = getDurationStats(
        durations.map((row) => row.stageDays),
        durations.map((row) => row.cumulativeDays),
      );
      return {
        name: definition.name,
        ...stats,
        sampleSize: fileIds.length,
        fileIds: fileIds.join(","),
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
        .filter((order) => !isSupplyOrderCancelled(file, order))
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
  if (isYes(order.shortclosure)) return false;
  if (hasFilledString(order.billPreparationDate)) return false;
  if (isDeliveryInspectionApplicable(file)) {
    return isYes(file.ir) && hasFilledString(order.irReceiptDate);
  }
  return hasFilledString(getNonInspectionPaymentDueDate(file, order));
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

type CountValueAnalysisSource = "demand" | "supplyOrder";

function getFileValueThresholds(files: FileRecord[], levels: AppSettings["valueThresholdLevels"]) {
  return getValueThresholdRows(files, levels, "demand", (file) => {
    if (isCancelledFile(file)) return [];
    const capital = getInrAmount(file.valueCapital, file) ?? 0;
    const revenue = getInrAmount(file.valueRevenue, file) ?? 0;
    return [{ capital, revenue }];
  });
}

function getSupplyOrderValueThresholds(
  files: FileRecord[],
  levels: AppSettings["valueThresholdLevels"],
) {
  return getValueThresholdRows(files, levels, "supplyOrder", (file) =>
    rawSupplyOrders(file)
      .filter((order) => !isSupplyOrderCancelled(file, order))
      .map((order) => ({
        capital: getInrAmount(order.soValueCapital, file) ?? 0,
        revenue: getInrAmount(order.soValueRevenue, file) ?? 0,
      })),
  );
}

function getValueThresholdRows(
  files: FileRecord[],
  levels: AppSettings["valueThresholdLevels"],
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
  level: AppSettings["valueThresholdLevels"][number],
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

function formatThresholdAppliesTo(value: AppSettings["valueThresholdLevels"][number]["appliesTo"]) {
  if (value === "capital") return "Capital";
  if (value === "revenue") return "Revenue";
  return "Both";
}

function formatThresholdRange(level: AppSettings["valueThresholdLevels"][number]) {
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
  if (isYes(file.demandCancelled)) return 0;
  return normalizedFilePaymentOrders(file)
    .filter((order) => order.stageDeliveryLabel !== "Advance Payment")
    .some(
    (order) =>
      isPaymentOrderActive(file, order) &&
      hasPaymentWorkflowStarted(file, order) &&
      !hasFilledString(order.paymentDate),
  )
    ? 1
    : 0;
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

function hasFilledObjectValue(value: Record<string, unknown>): boolean {
  return Object.entries(value).some(([key, item]) => {
    if (Array.isArray(item)) {
      return item.some((row) => hasFilledObjectValue(row as Record<string, unknown>));
    }
    if (item && typeof item === "object") {
      return hasFilledObjectValue(item as Record<string, unknown>);
    }
    const text = String(item ?? "").trim();
    if (!hasFilledString(text)) return false;
    return !isDefaultNoField(key, text);
  });
}

function isDefaultNoField(key: string, value: string) {
  return (
    value.toLowerCase() === "no" &&
    ["demandCancelled", "dpExtension", "ld", "soCancelled"].includes(key)
  );
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
      !isSupplyOrderCancelled(file, order) &&
      !isYes(order.shortclosure),
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
      hasSupplyOrderDate(order) &&
      isJobCompletionWorkflow(file) &&
      !isJobCompletionDone(order) &&
      !isSupplyOrderCancelled(file, order) &&
      !isYes(order.shortclosure) &&
      isDateBeforeToday(getDeliveryPeriodDate(order)),
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
  if (normalized === "psbpwb") {
    return isYes(file.bg) && order.bgCoverageType === "PSB+PWB";
  }
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
    !isYes(order.shortclosure) &&
    (normalized === "psb" || normalized === "psbpwb"
      ? isFinancialSanctionCompletedOrder(order)
      : hasFilledString(order.materialReceiptDate))
  );
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

function isFinancialSanctionCompletedOrder(order: SupplyOrderDetail) {
  return hasFilledString(order.financialSanctionDate);
}

function hasOrderFinancialSanctionCompleted(file: FileRecord) {
  return rawSupplyOrders(file).some(
    (order) => !isSupplyOrderCancelled(file, order) && isFinancialSanctionCompletedOrder(order),
  );
}

function hasPlacedSupplyOrder(file: FileRecord) {
  return rawSupplyOrders(file).some(
    (order) => isSupplyOrderTabComplete(file, order) && !isSupplyOrderCancelled(file, order),
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

function countLdOrders(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ order }) => isYes(order.ld) && !isYes(order.soCancelled),
  ).length;
}

function hasSupplyOrderDate(order: SupplyOrderDetail) {
  return hasFilledString(order.soDate);
}

function hasFilledField(file: FileRecord, key: keyof FileRecord) {
  const value = file[key];
  return typeof value === "string" ? hasFilledString(value) : Boolean(value);
}

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
}

function parseAmount(value: string | number | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getInrAmount(value: string | number | undefined, file: FileRecord) {
  const amount = parseAmount(value);
  if (amount === undefined) return undefined;
  const currency = (file.currency ?? "INR").trim().toUpperCase();
  if (!currency || currency === "INR") return amount;
  const exchangeRate = parseAmount(file.exchangeRate);
  if (exchangeRate === undefined || exchangeRate <= 0) return undefined;
  return amount * exchangeRate;
}

function getFileTotalValue(file: FileRecord) {
  return (
    (getInrAmount(file.valueCapital, file) ?? 0) + (getInrAmount(file.valueRevenue, file) ?? 0)
  );
}

function getFileCommittedCapitalValue(file: FileRecord) {
  const orders = fileSupplyOrders(file).filter((order) => !isYes(order.soCancelled));
  if (orders.length)
    return orders.reduce((sum, order) => sum + (getInrAmount(order.soValueCapital, file) ?? 0), 0);
  return isYes(file.soCancelled) ? 0 : (getInrAmount(file.soValueCapital, file) ?? 0);
}

function getFileCommittedRevenueValue(file: FileRecord) {
  const orders = fileSupplyOrders(file).filter((order) => !isYes(order.soCancelled));
  if (orders.length)
    return orders.reduce((sum, order) => sum + (getInrAmount(order.soValueRevenue, file) ?? 0), 0);
  return isYes(file.soCancelled) ? 0 : (getInrAmount(file.soValueRevenue, file) ?? 0);
}

function getSupplyOrderTotalValue(file: FileRecord, order: SupplyOrderDetail) {
  return (
    (getInrAmount(order.soValueCapital, file) ?? 0) +
    (getInrAmount(order.soValueRevenue, file) ?? 0)
  );
}

function getFinancePaymentCapital(file: FileRecord, order: SupplyOrderDetail) {
  return (
    getInrAmount(order.actualPaymentCapital, file) ?? getInrAmount(order.soValueCapital, file) ?? 0
  );
}

function getFinancePaymentRevenue(file: FileRecord, order: SupplyOrderDetail) {
  return (
    getInrAmount(order.actualPaymentRevenue, file) ?? getInrAmount(order.soValueRevenue, file) ?? 0
  );
}

function getFinancePaymentLiabilityEntries(files: FileRecord[]): FinancePaymentLiabilityEntry[] {
  return files.flatMap((file) => {
    if (isYes(file.demandCancelled)) return [];
    return rawSupplyOrders(file).flatMap((baseOrder) => {
      if (isSupplyOrderCancelled(file, baseOrder)) return [];
      const mainEntries = normalizedFilePaymentOrders({ ...file, supplyOrders: [baseOrder] })
        .filter((order) => order.stageDeliveryLabel !== "Advance Payment")
        .filter((order) => isPaymentOrderActive(file, order))
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

function countPreBidMeetingFiles(
  files: FileRecord[],
  refloat: boolean,
  state: "due" | "completed",
) {
  return files.filter((file) => isPreBidMeetingFile(file, refloat, state)).length;
}

function isPreBidMeetingFile(file: FileRecord, refloat: boolean, state: "due" | "completed") {
  if (!isBiddingApplicableForFile(file)) return false;
  const applies = refloat
    ? isYes(file.refloat) && isYes(file.refloatPreBidMeeting)
    : isYes(file.preBidMeeting);
  const date = refloat ? file.refloatPreBidMeetingDate : file.preBidMeetingDate;
  if (!applies || !hasFilledString(date)) return false;
  return state === "completed" ? isDateBeforeToday(date) : !isDateBeforeToday(date);
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

function isPaymentPending(file: FileRecord) {
  return getFinancePaymentLiabilityEntries([file]).some((entry) => entry.pending);
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
      if (isFlexiblePreControlMilestone(item)) return isMilestoneComplete(file, item);
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
  if (milestone.key === "bidding") return isYes(file.biddingStageOver);
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

function hasMilestoneDate(file: FileRecord, key: keyof FileRecord | keyof SupplyOrderDetail) {
  return supplyOrderDateKeys.has(key as keyof SupplyOrderDetail)
    ? fileSupplyOrders(file).some((order) => {
        const value = order[key as keyof SupplyOrderDetail];
        return typeof value === "string" && hasFilledString(value);
      })
    : hasFilledField(file, key as keyof FileRecord);
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
  return isBiddingApplicableForFile(file) && isYes(file.tenderLive);
}

function getEffectiveBidDate(file: FileRecord) {
  return isYes(file.refloat) && hasFilledString(file.refloatBiddingDate)
    ? file.refloatBiddingDate
    : file.bidDate;
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

function isLiveSupplyOrder(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) =>
      isSupplyOrderTabComplete(file, order) &&
      !hasFilledString(order.paymentDate) &&
      !isSupplyOrderCancelled(file, order),
  );
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

function isDeliveryPeriodCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    !isSupplyOrderCancelled(file, order) &&
    !isYes(order.shortclosure) &&
    hasSupplyOrderDate(order) &&
    !isYes(order.stageDelivery) &&
    !hasFilledString(getDeliveryDueDate(order))
  );
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
    rawSupplyOrders(file).some((order) => hasSupplyOrderDate(order) && !isYes(order.soCancelled))
  );
}

function isCancelledFile(file: FileRecord) {
  if (isYes(file.demandCancelled)) return true;
  const orders = rawSupplyOrders(file);
  if (orders.length === 0) return false;
  return orders.every((order) => isYes(order.soCancelled));
}

function isSoCancelledFile(file: FileRecord) {
  const orders = rawSupplyOrders(file);
  return orders.length > 0 && orders.every((order) => isYes(order.soCancelled));
}

function isFileClosed(file: Pick<FileRecord, "completedMilestones">) {
  return Boolean(
    file.completedMilestones?.some(
      (milestone) =>
        normalizeMilestoneName(milestone) === normalizeMilestoneName(fileClosedMilestone),
    ),
  );
}

function getDeliveryPeriodDate(order: SupplyOrderDetail) {
  return order.revisedDp || order.dpDate;
}

function getPaymentWorkflowStartDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  if (isYes(order.shortclosure)) return order.jobCompletionDate;
  return getNonInspectionPaymentDueDate(file, order);
}

function getNonInspectionPaymentDueDate(file: FileRecord, order: SupplyOrderDetail) {
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

function getLaterDate(first: string | undefined, second: string | undefined) {
  const firstTime = parseLocalDateTime(first ?? "");
  const secondTime = parseLocalDateTime(second ?? "");
  if (firstTime === undefined) return second;
  if (secondTime === undefined) return first;
  return secondTime > firstTime ? second : first;
}

function isDateBefore(date: string | undefined, reference: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const referenceTime = parseLocalDateTime(reference ?? "");
  return dateTime !== undefined && referenceTime !== undefined && dateTime < referenceTime;
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

function getPercent(value: number, total: number) {
  if (total <= 0) return undefined;
  return (value / total) * 100;
}

function roundContributionPercent(value: number | undefined) {
  if (value === undefined) return 0;
  return Number(value.toFixed(1));
}
