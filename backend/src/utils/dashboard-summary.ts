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
  getParentStagePaymentDate,
  getPaymentTimingTriggerDate,
  hasUnpaidSupplyOrderPayment,
  getAdvancePaymentCapital,
  getAdvancePaymentRevenue,
  isAdvancePaymentCompleted,
  isAdvancePaymentPaid,
  isAdvancePaymentPending,
  isParentStagePaymentOrder,
  isSupplyOrderMilestoneCurrent as isCanonicalSupplyOrderMilestoneCurrent,
  isExpiredDeliveryPeriodEntry,
  isStatus2DpExpiredDeliveryEntry,
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
  latestBillReturnCycle,
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

type Finance1ActivityCounts = {
  supplyOrdersPlacedInSelectedFy: number;
  supplyOrdersPlacedInFollowingFy: number;
  regularSupplyOrdersPlacedInSelectedFy: number;
  stageSupplyOrdersPlacedInSelectedFy: number;
  regularSupplyOrdersPlacedLater: number;
  stageSupplyOrdersPlacedLater: number;
  supplyOrdersPlacedByYearEndCancelledLater: number;
  regularSupplyOrdersCompletedLater: number;
  stageSupplyOrdersCompletedLater: number;
  regularSupplyOrderPaymentsWithBillSentLater: number;
  stageSupplyOrderPaymentsWithBillSentLater: number;
  supplyOrdersPlacedByYearEndStillUnpaid: number;
  soPaymentsInSelectedFy: number;
  soPaymentsInFollowingFy: number;
  regularPaymentsPaidInSelectedFy: number;
  regularPaymentsDueInSelectedFy: number;
  regularPaymentsPaidLater: number;
  regularPaymentsDueLater: number;
  stagePaymentsPaidInSelectedFy: number;
  stagePaymentsDueInSelectedFy: number;
  stagePaymentsPaidLater: number;
  stagePaymentsDueLater: number;
  supplementaryPaymentsInSelectedFy: number;
  supplementaryPaymentsInFollowingFy: number;
  advancePaymentsInSelectedFy: number;
  advancePaymentsInFollowingFy: number;
  billsSentInSelectedFy: number;
  billsSentInFollowingFy: number;
  selectedFyBillsPaidInSelectedFy: number;
  selectedFyBillsPaidInFollowingFy: number;
  selectedFyBillsDateOrderConflict: number;
  selectedFyBillsStillUnpaid: number;
  selectedFyBillsStoppedByNfa: number;
  selectedFyBillsStoppedByNfaInSelectedFy: number;
  selectedFyBillsStoppedByNfaLater: number;
  filesClosedInSelectedFy: number;
  filesClosedInFollowingFy: number;
  filesActiveAtYearEndClosedLater: number;
  filesActiveAtYearEndDemandCancelledLater: number;
};

type Finance1AmountMetric = {
  count: number;
  capital: number;
  revenue: number;
  total: number;
};

type Finance1PaymentFlow = {
  regular: Finance1AmountMetric;
  stage: Finance1AmountMetric;
  supplementary: Finance1AmountMetric;
  advance: Finance1AmountMetric;
  total: Finance1AmountMetric;
};

type Finance1FileTypeDistributionRow = {
  fileType: string;
  files: number;
  filesWithSo: number;
  filesWithSoLive: number;
  activeAtFyEnd: number;
  closedByFyEnd: number;
  cancelledByFyEnd: number;
  active: number;
  closed: number;
  cancelled: number;
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
  activityCounts: Finance1ActivityCounts;
  activityCountsForFileScope: {
    supplyOrdersPlacedInSelectedFy: number;
    liveSupplyOrdersPlacedInSelectedFy: number;
    filesClosedInSelectedFy: number;
  };
  activityCountsForFileScopeByInitiationYear: Array<{
    initiationYear: string;
    supplyOrdersPlaced: number;
    liveSupplyOrders: number;
    filesClosed: number;
    supplyOrderFileIds: string[];
    liveSupplyOrderFileIds: string[];
    closedFileIds: string[];
  }>;
  paymentsRecordedInSelectedFy: Finance1PaymentFlow;
  drillFileIds: Record<string, string[]>;
  fileGroup: Finance1AmountMetric;
  fileTypeDistribution: Finance1FileTypeDistributionRow[];
  firmTypeDistribution: Finance1FirmTypeDistributionRow[];
  cancelledByFyEnd: number;
  activeAtFyEnd: number;
  closedByFyEnd: number;
  intendedAtFyEnd: Finance1AmountMetric;
  bookedAtFyEnd: Finance1AmountMetric;
  committedAtFyEnd: Finance1AmountMetric;
  uncommittedEstimateAtFyEnd: Finance1AmountMetric;
  paidByFyEnd: Finance1AmountMetric;
  unpaidLiabilityAtFyEnd: Finance1AmountMetric;
  yearEndLiabilityPaidLater: Finance1AmountMetric;
  yearEndLiabilityStillUnpaidToday: Finance1AmountMetric;
  yearEndLiabilityClosedByNfa: Finance1AmountMetric;
  otherPaymentMadeLater: number;
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
  "Material Receipt",
  "D.P. expired",
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
  "Material Receipt",
  "D.P. expired",
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
    applies: (file: FileRecord) =>
      isBiddingApplicableForFile(file) && !isYes(file.refloat),
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
  milestoneClearingFiles,
  divisions,
  settings,
  division = "all",
  liveMilestones,
  financeFiles,
  financeAllocationOverride,
  financeCarryForwardSourceYear,
  financeFirmTypeActivityYear,
  finance1Year,
  finance1AsOfDate,
  finance1InitiationFrom,
  finance1InitiationTo,
}: {
  files: FileRecord[];
  firmHistoryFiles?: FileRecord[];
  milestoneClearingFiles?: FileRecord[];
  financeFiles?: FileRecord[];
  divisions: Division[];
  settings: AppSettings;
  division?: string;
  liveMilestones?: string[];
  financeAllocationOverride?: { allocatedCapital: number; allocatedRevenue: number };
  financeCarryForwardSourceYear?: string;
  financeFirmTypeActivityYear?: string;
  finance1Year?: string;
  finance1AsOfDate?: string;
  finance1InitiationFrom?: string;
  finance1InitiationTo?: string;
}) {
  const activeDivision = division?.trim() || "all";
  const dashboardFiles =
    activeDivision === "all" ? files : files.filter((file) => file.division === activeDivision);
  const dashboardProcessFiles = dashboardFiles.filter((file) => !isYes(file.demandCancelled));
  const activeDashboardFiles = dashboardProcessFiles.filter((file) => !isCancelledFile(file));
  const processHistoryDashboardFiles = dashboardProcessFiles;
  const rawFinanceFiles = financeFiles ?? files;
  const dashboardFinanceFiles =
    activeDivision === "all"
      ? rawFinanceFiles
      : rawFinanceFiles.filter((file) => file.division === activeDivision);
  const dashboardProcessFinanceFiles = dashboardFinanceFiles.filter(
    (file) => !isYes(file.demandCancelled),
  );
  const activeDashboardFinanceFiles = dashboardProcessFinanceFiles.filter(
    (file) => !isCancelledFile(file),
  );
  const dashboardDivisions =
    activeDivision === "all" ? divisions : divisions.filter((item) => item.name === activeDivision);
  const rawFirmHistoryFiles = firmHistoryFiles ?? files;
  const dashboardFirmHistoryFiles =
    activeDivision === "all"
      ? rawFirmHistoryFiles
      : rawFirmHistoryFiles.filter((file) => file.division === activeDivision);
  const dashboardProcessFirmHistoryFiles = dashboardFirmHistoryFiles.filter(
    (file) => !isYes(file.demandCancelled),
  );
  const rawMilestoneClearingFiles = milestoneClearingFiles ?? dashboardProcessFiles;
  const dashboardMilestoneClearingFiles =
    activeDivision === "all"
      ? rawMilestoneClearingFiles
      : rawMilestoneClearingFiles.filter((file) => file.division === activeDivision);
  const dashboardProcessMilestoneClearingFiles = dashboardMilestoneClearingFiles.filter(
    (file) => !isYes(file.demandCancelled),
  );
  const analyticsSummary = getAnalyticsSummary(
    dashboardProcessFiles,
    dashboardDivisions,
    settings.valueThresholdLevels,
    settings.selectedYear,
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
    settings.financialYear,
    financeAllocationOverride,
    financeCarryForwardSourceYear,
  );
  const finance1FiscalYear = finance1Year || settings.financialYear;
  const matchesFinance1InitiationRange = (file: FileRecord) => {
    if (!finance1InitiationFrom && !finance1InitiationTo) return true;
    const date = file.receivedDate ?? "";
    return Boolean(
      date &&
        (!finance1InitiationFrom || date >= finance1InitiationFrom) &&
        (!finance1InitiationTo || date <= finance1InitiationTo),
    );
  };
  const finance1ScopeFiles = dashboardFinanceFiles.filter(matchesFinance1InitiationRange);
  const globalFinance1ScopeFiles = activeDashboardFiles.filter(matchesFinance1InitiationRange);
  const finance1Summary = getFinance1Summary(
    finance1ScopeFiles,
    finance1FiscalYear,
    finance1AsOfDate,
  );
  const globalFinance1ScopeIds = new Set(globalFinance1ScopeFiles.map((file) => file.id));
  const finance1ScopesMatch =
    finance1ScopeFiles.length === globalFinance1ScopeFiles.length &&
    finance1ScopeFiles.every((file) => globalFinance1ScopeIds.has(file.id));
  const globalFilterFinance1Summary = finance1ScopesMatch
    ? finance1Summary
    : getFinance1Summary(globalFinance1ScopeFiles, finance1FiscalYear, finance1AsOfDate);
  finance1Summary.intendedAtFyEnd = globalFilterFinance1Summary.intendedAtFyEnd;
  finance1Summary.bookedAtFyEnd = globalFilterFinance1Summary.bookedAtFyEnd;
  finance1Summary.committedAtFyEnd = globalFilterFinance1Summary.committedAtFyEnd;
  finance1Summary.uncommittedEstimateAtFyEnd = globalFilterFinance1Summary.uncommittedEstimateAtFyEnd;
  finance1Summary.activityCountsForFileScope =
    globalFilterFinance1Summary.activityCountsForFileScope;
  finance1Summary.activityCountsForFileScopeByInitiationYear =
    globalFilterFinance1Summary.activityCountsForFileScopeByInitiationYear;
  finance1Summary.drillFileIds = {
    ...finance1Summary.drillFileIds,
    intendedAtFyEnd: globalFilterFinance1Summary.drillFileIds.intendedAtFyEnd ?? [],
    bookedAtFyEnd: globalFilterFinance1Summary.drillFileIds.bookedAtFyEnd ?? [],
    committedAtFyEnd: globalFilterFinance1Summary.drillFileIds.committedAtFyEnd ?? [],
    "fyActivity:soPlaced": globalFilterFinance1Summary.drillFileIds["fyActivity:soPlaced"] ?? [],
    "fyActivity:liveSo": globalFilterFinance1Summary.drillFileIds["fyActivity:liveSo"] ?? [],
    "fyActivity:filesClosed": globalFilterFinance1Summary.drillFileIds["fyActivity:filesClosed"] ?? [],
  };

  return {
    activeDivision,
    valueThresholdLevels: settings.valueThresholdLevels,
    dashboardFileCount: dashboardProcessFiles.length,
    dashboardDivisions,
    modeCounts: getModeCounts(processHistoryDashboardFiles, settings.modes),
    gemBiddingModeCounts: getGemBiddingModeCounts(
      processHistoryDashboardFiles,
      settings.gemBiddingModes,
    ),
    topSummaryStats: getAttributeSummaryStats(dashboardProcessFiles),
    fileTypeStats: getFileTypeSummaryStats(dashboardProcessFiles, settings.fileTypes),
    firmTypeStats: getFirmTypeSummaryStats(dashboardProcessFiles, settings.firmTypes),
    manualMilestoneFlow,
    visibleLiveMilestoneNames,
    liveStatusRows: getLiveStatusDivisionRows(
      activeDashboardFiles,
      dashboardDivisions,
      visibleLiveMilestoneNames,
    ),
    statusSummaryGroups: getStatusSummaryTableGroups(
      dashboardProcessFiles,
      settings.bgReturnOffsetDays ?? 60,
    ),
    statusFlow: getMilestoneFlow(dashboardProcessFiles, settings.bgReturnOffsetDays ?? 60),
    miscellaneousCounts: getMiscellaneousCounts(dashboardFiles),
    analytics: {
      ...analyticsSummary,
      divisionTurnaroundRanking: getDivisionTurnaroundRanking(processHistoryDashboardFiles),
      milestoneClearingRanking: getMilestoneClearingRanking(dashboardProcessMilestoneClearingFiles),
      biddingModeMix: getBiddingModeMix(processHistoryDashboardFiles),
      topFirmSupplyOrders: getTopFirmSupplyOrders(dashboardProcessFirmHistoryFiles),
      firmAnalysis: getFirmAnalysisRows(dashboardProcessFirmHistoryFiles),
      monthWiseSupplyOrder: getMonthWiseSupplyOrder(dashboardProcessFiles),
      tcecStatus: getTcecStatusSummary(dashboardProcessFiles, settings.selectedYear),
      cncSummary: getCncSummary(dashboardProcessFiles, settings.selectedYear),
    },
    financeTotals,
    financeFirmTypeDistributions: {
      supplyOrderValue: getSupplyOrderValueDistributionByFirmType(
        activeDashboardFiles,
        settings.firmTypes,
        financeFirmTypeActivityYear,
      ),
      actualPayment: getActualPaymentDistributionByFirmType(
        activeDashboardFinanceFiles,
        settings.firmTypes,
        financeFirmTypeActivityYear,
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
    finance1Summary,
  };
}

function getFinanceTotals(
  files: FileRecord[],
  divisions: Division[],
  selectedYear?: string,
  currentFinancialYear?: string,
  allocationOverride?: { allocatedCapital: number; allocatedRevenue: number },
  carryForwardSourceYear?: string,
) {
  const financeYear = getFinancialYearDateRange(selectedYear) ? selectedYear : currentFinancialYear;
  const financeYearRange = getFinancialYearDateRange(financeYear);
  const todayDate = formatLocalDate(new Date());
  const paymentLiabilityEntries = getFinancePaymentLiabilityEntries(files);
  const actualPaymentEntries = paymentLiabilityEntries.filter((entry) =>
    isDateOnOrBefore(entry.paymentDate, todayDate),
  );
  const paymentInYearEntries = financeYearRange
    ? actualPaymentEntries.filter((entry) => isDateWithinRange(entry.paymentDate, financeYearRange))
    : actualPaymentEntries;
  const sameYearPaidEntries = financeYearRange
    ? paymentInYearEntries.filter((entry) => isDateWithinRange(entry.sourceDate, financeYearRange))
    : [];
  const advancePaymentInYearEntries = advancePaymentEntries(files).filter(({ order }) =>
    isDateOnOrBefore(order.advancePaymentDetail?.paymentDate, todayDate) &&
    (financeYearRange
      ? isDateWithinRange(order.advancePaymentDetail?.paymentDate, financeYearRange)
      : true),
  );
  const paymentSourceYearTotals = new Map<
    string,
    { count: number; capital: number; revenue: number; fileIds: Set<string> }
  >();
  const addPaymentSourceYearEntry = (
    sourceDate: string | undefined,
    capital: number,
    revenue: number,
    fileId: string,
  ) => {
    const sourceYear = getFinancialYearForDate(sourceDate) ?? "unclassified";
    const current = paymentSourceYearTotals.get(sourceYear) ?? {
      count: 0,
      capital: 0,
      revenue: 0,
      fileIds: new Set<string>(),
    };
    current.count += 1;
    current.capital += capital;
    current.revenue += revenue;
    current.fileIds.add(fileId);
    paymentSourceYearTotals.set(sourceYear, current);
  };
  paymentInYearEntries.forEach((entry) =>
    addPaymentSourceYearEntry(entry.sourceDate, entry.capital, entry.revenue, entry.file.id),
  );
  advancePaymentInYearEntries.forEach(({ file, order }) => {
    if (isSupplyOrderCancelled(file, order)) return;
    addPaymentSourceYearEntry(
      order.soDate,
      getInrAmount(getAdvancePaymentCapital(order), file) ?? 0,
      getInrAmount(getAdvancePaymentRevenue(order), file) ?? 0,
      file.id,
    );
  });
  const paymentSourceYearBreakdown = Array.from(paymentSourceYearTotals.entries())
    .map(([sourceYear, totals]) => ({
      sourceYear,
      count: totals.count,
      capital: totals.capital,
      revenue: totals.revenue,
      fileIds: Array.from(totals.fileIds),
    }))
    .sort((a, b) => {
      if (a.sourceYear === "unclassified") return 1;
      if (b.sourceYear === "unclassified") return -1;
      return a.sourceYear.localeCompare(b.sourceYear);
    });
  const paidTillDateAdvanceEntries = advancePaymentEntries(files).filter(
    ({ file, order }) =>
      !isSupplyOrderCancelled(file, order) &&
      isDateOnOrBefore(order.advancePaymentDetail?.paymentDate, todayDate),
  );
  const carryForwardRows = getFinanceCarryForwardRows(
    files,
    financeYear,
    carryForwardSourceYear,
  );
  return {
    allocatedCapital:
      allocationOverride?.allocatedCapital ??
      divisions.reduce((sum, division) => sum + (parseAmount(division.allocatedCapital) ?? 0), 0),
    allocatedRevenue:
      allocationOverride?.allocatedRevenue ??
      divisions.reduce((sum, division) => sum + (parseAmount(division.allocatedRevenue) ?? 0), 0),
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
        (!isCancelledFile(file) && !hasFilledField(file, "imms") && getFileCommittedCapitalValue(file) <= 0
          ? (getInrAmount(file.valueCapital, file) ?? 0)
          : 0),
      0,
    ),
    projectedRevenue: files.reduce(
      (sum, file) =>
        sum +
        (!isCancelledFile(file) && !hasFilledField(file, "imms") && getFileCommittedRevenueValue(file) <= 0
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
    estimateLessCommittedCapital: files.reduce((sum, file) => {
      if (isCancelledFile(file) || isSoCancelledFile(file)) return sum;
      const committed = getFileCommittedCapitalValue(file);
      return committed > 0
        ? sum + (getInrAmount(file.valueCapital, file) ?? 0) - committed
        : sum;
    }, 0),
    estimateLessCommittedRevenue: files.reduce((sum, file) => {
      if (isCancelledFile(file) || isSoCancelledFile(file)) return sum;
      const committed = getFileCommittedRevenueValue(file);
      return committed > 0
        ? sum + (getInrAmount(file.valueRevenue, file) ?? 0) - committed
        : sum;
    }, 0),
    paidTillDateCapital:
      actualPaymentEntries.reduce((sum, entry) => sum + entry.capital, 0) +
      paidTillDateAdvanceEntries.reduce(
        (sum, { file, order }) =>
          sum + (getInrAmount(getAdvancePaymentCapital(order), file) ?? 0),
        0,
      ),
    paidTillDateRevenue:
      actualPaymentEntries.reduce((sum, entry) => sum + entry.revenue, 0) +
      paidTillDateAdvanceEntries.reduce(
        (sum, { file, order }) =>
          sum + (getInrAmount(getAdvancePaymentRevenue(order), file) ?? 0),
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
    advanceCapital: advancePaymentInYearEntries.reduce(
      (sum, { file, order }) =>
        sum +
        (isSupplyOrderCancelled(file, order)
          ? 0
          : (getInrAmount(getAdvancePaymentCapital(order), file) ?? 0)),
      0,
    ),
    advanceRevenue: advancePaymentInYearEntries.reduce(
      (sum, { file, order }) =>
        sum +
        (isSupplyOrderCancelled(file, order)
          ? 0
          : (getInrAmount(getAdvancePaymentRevenue(order), file) ?? 0)),
      0,
    ),
    paymentSourceYearBreakdown,
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

function getFinanceCarryForwardRows(
  files: FileRecord[],
  selectedYear: string | undefined,
  sourceYearScope?: string,
) {
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
  const todayDate = formatLocalDate(new Date());
  const carryForward = new Map<string, Omit<FinanceCarryForwardRow, "year" | "filter">>();
  const clearedCarryForward = new Map<string, Omit<FinanceCarryForwardRow, "year" | "filter">>();
  const previousCarryForward = new Map<string, Omit<FinanceCarryForwardRow, "year" | "filter">>();
  const futureClearedCarryForward = new Map<
    string,
    Omit<FinanceCarryForwardRow, "year" | "filter">
  >();

  const addCarryForwardEntry = (
    sourceDate: string | undefined,
    paymentDate: string | undefined,
    capital: number,
    revenue: number,
  ) => {
    const sourceYear = getFinancialYearForDate(sourceDate);
    if (!sourceYear) return;
    const paymentOccurredByToday = isDateOnOrBefore(paymentDate, todayDate);
    const paidInSelectedYear =
      paymentOccurredByToday && isDateWithinRange(paymentDate, range);
    const unpaidAtSelectedYearEnd =
      !paymentOccurredByToday || !hasFilledString(paymentDate) || isDateAfter(paymentDate, range.end);

    if (sourceYear === financialYear && unpaidAtSelectedYearEnd) {
      addFinanceCarryForward(carryForward, sourceYear, capital, revenue);
    }
    if (
      sourceYear === financialYear &&
      paymentOccurredByToday &&
      hasFilledString(paymentDate) &&
      isDateAfter(paymentDate, range.end)
    ) {
      const clearingYear = getFinancialYearForDate(paymentDate);
      if (clearingYear && clearingYear > financialYear) {
        addFinanceCarryForward(futureClearedCarryForward, clearingYear, capital, revenue);
      }
    }
    const matchesPreviousSourceScope = !sourceYearScope || sourceYear === sourceYearScope;
    if (
      sourceYear !== financialYear &&
      sourceYear < financialYear &&
      matchesPreviousSourceScope &&
      paidInSelectedYear
    ) {
      addFinanceCarryForward(clearedCarryForward, sourceYear, capital, revenue);
    }
    if (
      sourceYear !== financialYear &&
      sourceYear < financialYear &&
      matchesPreviousSourceScope &&
      unpaidAtSelectedYearEnd
    ) {
      addFinanceCarryForward(previousCarryForward, sourceYear, capital, revenue);
    }
  };

  for (const entry of getFinancePaymentLiabilityEntries(files)) {
    addCarryForwardEntry(entry.sourceDate, entry.paymentDate, entry.capital, entry.revenue);
  }

  for (const { file, order } of advancePaymentEntries(files)) {
    if (isSupplyOrderCancelled(file, order)) continue;
    if (shouldSkipSeparateAdvanceCarryForward(order)) continue;
    const paymentDate = order.advancePaymentDetail?.paymentDate;
    const paidByToday = isDateOnOrBefore(paymentDate, todayDate);
    const paidCapital = paidByToday
      ? getInrAmount(getAdvancePaymentCapital(order), file) ?? 0
      : 0;
    const paidRevenue = paidByToday
      ? getInrAmount(getAdvancePaymentRevenue(order), file) ?? 0
      : 0;
    const unpaidCapital = Math.max(
      0,
      getAdvanceFinanceAllocationCapital(file, order) - paidCapital,
    );
    const unpaidRevenue = Math.max(
      0,
      getAdvanceFinanceAllocationRevenue(file, order) - paidRevenue,
    );
    if (paidCapital + paidRevenue > 0) {
      addCarryForwardEntry(order.soDate, paymentDate, paidCapital, paidRevenue);
    }
    if (unpaidCapital + unpaidRevenue > 0) {
      addCarryForwardEntry(order.soDate, undefined, unpaidCapital, unpaidRevenue);
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

function getAdvanceFinancePaymentCapital(file: FileRecord, order: SupplyOrderDetail) {
  return (
    getInrAmount(order.advancePaymentDetail?.actualPaymentCapital, file) ??
    getInrAmount(order.advancePaymentDetail?.stageAmountCapital, file) ??
    0
  );
}

function getAdvanceFinancePaymentRevenue(file: FileRecord, order: SupplyOrderDetail) {
  return (
    getInrAmount(order.advancePaymentDetail?.actualPaymentRevenue, file) ??
    getInrAmount(order.advancePaymentDetail?.stageAmountRevenue, file) ??
    0
  );
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

const defaultGemBiddingModeOptions = ["Custom", "Catalogue", "Comparison"];

function getGemBiddingModeCounts(files: FileRecord[], configuredModes?: string[]) {
  const gemBiddingModeOptions = normalizeGemBiddingModes(configuredModes);
  const counts = files.reduce<Record<string, number>>((current, file) => {
    if (!isYes(file.gem)) return current;
    const mode = normalizeGemBiddingMode(file.gemBiddingMode, gemBiddingModeOptions);
    if (!mode) return current;
    current[mode] = (current[mode] ?? 0) + 1;
    return current;
  }, {});
  return gemBiddingModeOptions.map((name) => ({ name, count: counts[name] ?? 0 }));
}

function normalizeGemBiddingMode(value: string | undefined, options = defaultGemBiddingModeOptions) {
  const normalized = value?.trim().toLowerCase();
  return options.find((mode) => mode.toLowerCase() === normalized);
}

function normalizeGemBiddingModes(values?: string[]) {
  const seen = new Set<string>();
  return [...defaultGemBiddingModeOptions, ...(values ?? [])]
    .map((value) => value.trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
  return countReturnedBillOrders(
    files,
    (order) => !isShortclosureNoFurtherAction(order) && hasOpenBillReturn(order),
  );
}

function countReturnedBillsResubmitted(files: FileRecord[]) {
  return countReturnedBillOrders(
    files,
    (order) =>
      hasCompletedBillReturn(order) &&
      !hasFilledString(order.paymentDate) &&
      !isShortclosureNoFurtherAction(order),
  );
}

function countReturnedBillsPaid(files: FileRecord[]) {
  return countReturnedBillOrders(files, hasReturnedBillPaid);
}

function countSupplementaryBillPendingOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(
    files,
    (bill) => isSupplementaryBillPaymentPending(bill),
    true,
  );
}

function countSupplementaryBillNormalPendingOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(
    files,
    (bill) =>
      isSupplementaryBillPaymentPending(bill) && !hasSupplementaryBillReturnHistory(bill),
    true,
  );
}

function countSupplementaryBillReturnedPendingOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(
    files,
    (bill) =>
      isSupplementaryBillPaymentPending(bill) &&
      hasSupplementaryBillReturnHistory(bill) &&
      !hasCompletedSupplementaryBillReturn(bill),
    true,
  );
}

function countSupplementaryBillResubmittedPendingOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(
    files,
    (bill) =>
      isSupplementaryBillPaymentPending(bill) && hasCompletedSupplementaryBillReturn(bill),
    true,
  );
}

function countSupplementaryBillSubmittedOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(files, isSupplementaryBillSubmitted);
}

function countSupplementaryBillReturnedOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(files, isSupplementaryBillReturned, true);
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
  pendingOnly = false,
) {
  return files.reduce((count, file) => {
    return (
      count +
      rawSupplyOrders(file).reduce((orderCount, order) => {
        if (
          !isPaymentOrderActive(file, order) ||
          (pendingOnly && isShortclosureNoFurtherAction(order))
        ) return orderCount;
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

function hasOpenSupplementaryBillReturn(bill: SupplementaryBillDetail) {
  const latest = latestBillReturnCycle(bill.billReturnCycles);
  return Boolean(latest && !hasFilledString(latest.resubmittedDate));
}

function hasCompletedSupplementaryBillReturn(bill: SupplementaryBillDetail) {
  const latest = latestBillReturnCycle(bill.billReturnCycles);
  return Boolean(latest && hasFilledString(latest.resubmittedDate));
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
  if (normalized === "deliveryperiod") return countDpDatePendingCases(files);
  if (normalized === "materialreceipt") return countMaterialReceiptPendingCases(files);
  if (normalized === "dpexpired") return countStatus2DpExpiredCases(files);
  if (isBgMilestoneKey(normalized)) return countBgPendingOrders(files, normalized);
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
  if (normalized === "dpexpired") return 0;
  if (normalized === "materialreceipt") return countMaterialReceiptCompletedCases(files);
  if (isBgMilestoneKey(normalized)) return countBgReceivedOrders(files, normalized);
  if (normalized === "refloatbidding") {
    return files.filter(
      (file) => !isCancelledFile(file) && isYes(file.refloat) && isRefloatBiddingStageComplete(file),
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
    .filter(isVisibleLiveStatusMilestoneName);
  const configured = values.length ? values : defaultManualMilestones;
  return appendFileClosedMilestone(
    dedupeLiveStatusMilestones(
      insertAdvancePaymentMilestone(
        insertSupplementaryBillReturnedMilestone(
          insertBillSentMilestone(
            insertDpExpiredMilestone(insertMaterialReceiptMilestone(
              insertJobCompletionMilestone(insertRefloatMilestones(configured)),
            )),
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

function insertMaterialReceiptMilestone(milestones: string[]) {
  const hasMaterialReceipt = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "materialreceipt",
  );
  const deliveryPeriodIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "deliveryperiod",
  );
  if (hasMaterialReceipt || deliveryPeriodIndex === -1) return milestones;
  return [
    ...milestones.slice(0, deliveryPeriodIndex + 1),
    "Material Receipt",
    ...milestones.slice(deliveryPeriodIndex + 1),
  ];
}

function insertDpExpiredMilestone(milestones: string[]) {
  const withoutExpired = milestones.filter(
    (milestone) => normalizeMilestoneName(milestone) !== "dpexpired",
  );
  const receiptIndex = withoutExpired.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "materialreceipt",
  );
  if (receiptIndex === -1) return withoutExpired;
  return [
    ...withoutExpired.slice(0, receiptIndex + 1),
    "D.P. expired",
    ...withoutExpired.slice(receiptIndex + 1),
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
  const expiredIndex = visible.indexOf("D.P. expired");
  const receiptIndex = visible.indexOf("Material Receipt");
  if (expiredIndex !== -1 && receiptIndex !== -1) {
    visible.splice(expiredIndex, 1);
    visible.splice(visible.indexOf("Material Receipt") + 1, 0, "D.P. expired");
  }
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
  if (normalized === "deliveryperiod") return countDpDatePendingCases(files);
  if (normalized === "materialreceipt") return countMaterialReceiptPendingCases(files);
  if (normalized === "dpexpired") return countStatus2DpExpiredCases(files);
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
  if (isSupplyOrderDrivenMilestoneName(milestoneName)) {
    return countCurrentSupplyOrderMilestoneStatuses(files, normalized);
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

function countDpDatePendingCases(files: FileRecord[]) {
  return rawSupplyOrderEntries(files).reduce((total, { file, order }) => {
    if (
      isSupplyOrderCancelled(file, order) ||
      isYes(order.shortclosure) ||
      isShortclosureNoFurtherAction(order) ||
      !hasSupplyOrderDate(order)
    ) {
      return total;
    }
    if (isYes(order.stageDelivery)) {
      return (
        total +
        (order.stageDeliveries ?? []).filter((stage) => {
          const dpDate = stage.revisedDp || stage.dpDate || order.revisedDp || order.dpDate;
          return (
            !hasFilledString(dpDate) &&
            normalizeMilestoneName(stage.currentMilestone).replace(/\d+$/, "") ===
              "deliveryperiod"
          );
        }).length
      );
    }
    return total +
      (!hasFilledString(order.revisedDp || order.dpDate) &&
      normalizeMilestoneName(getCanonicalSupplyOrderCurrentMilestone(file, order)) ===
        "deliveryperiod"
        ? 1
        : 0);
  }, 0);
}

function countMaterialReceiptPendingCases(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      !isSupplyOrderCancelled(file, order) &&
      !isYes(order.shortclosure) &&
      !isShortclosureNoFurtherAction(order) &&
      hasSupplyOrderDate(order) &&
      isPhysicalDeliveryWorkflow(file) &&
      !normalizeCompletedMilestones(order.completedMilestones).some(
        (milestone) => normalizeMilestoneName(milestone) === "delivery",
      ) &&
      (isValidDeliveryPeriodEntry(file, order) || isExtendedDeliveryPeriodEntry(file, order)),
  ).length;
}

function countStatus2DpExpiredCases(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(({ file, order }) =>
    isStatus2DpExpiredDeliveryEntry(file, order),
  ).length;
}

function countMaterialReceiptCompletedCases(files: FileRecord[]) {
  return effectiveSupplyOrderEntries(files).filter(
    ({ file, order }) =>
      !isSupplyOrderCancelled(file, order) &&
      hasSupplyOrderDate(order) &&
      isPhysicalDeliveryWorkflow(file) &&
      (hasFilledString(order.materialReceiptDate) ||
        normalizeCompletedMilestones(order.completedMilestones).some(
          (milestone) => normalizeMilestoneName(milestone) === "delivery",
        )),
  ).length;
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

function getMilestoneFlow(files: FileRecord[], bgReturnOffsetDays = 60) {
  const flow = milestoneDefinitions.map((milestone) => {
    const applicableFiles = files.filter((file) => isMilestoneApplicable(file, milestone));
    const reachedFiles = applicableFiles.filter((file) => isEligibleMilestone(file, milestone));
    const activeFiles = applicableFiles.filter((file) => isManualActiveMilestone(file, milestone));
    const reviewedFiles = activeFiles.filter((file) => isMilestoneReviewed(file, milestone));
    const clearedFiles = applicableFiles.filter((file) => isMilestoneComplete(file, milestone));
    const pendingFiles = activeFiles.filter((file) => isPendingMilestone(file, milestone));

    if (milestone.key === "refloatBidding") {
      const inProgressFiles = applicableFiles.filter(
        (file) => !isCancelledFile(file) && isRefloatBiddingInProgressFile(file),
      );
      const liveFiles = applicableFiles.filter(
        (file) => !isCancelledFile(file) && isYes(file.refloat) && isFileTenderLive(file),
      );
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
        liveBids: liveFiles.length,
        overdueBids: inProgressFiles.filter(isRefloatBidOverdue).length,
        inProcessBids: inProgressFiles.filter(
          (file) => !isFileTenderLive(file) && !isRefloatBidOverdue(file),
        ).length,
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
        cleared: clearedFiles.length,
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
        financialSanctionCompletedFiles: applicableFiles.filter(
          (file) => countCompletedSupplyOrderMilestoneStatuses([file], "financialsanction") > 0,
        ).length,
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
        total: applicableFiles.length,
        underProcess: supplyOrderPreviousStage,
        active: activeFiles.length,
        pending: countCurrentSupplyOrderMilestoneStatuses(applicableFiles, "supplyorder"),
        reviewed: reviewedFiles.length,
        hasReviewed: Boolean(milestone.reviewed),
        cleared: clearedFiles.length,
        activeLabel: "In process",
        liveSupplyOrders: countLiveSupplyOrders(files),
        supplyOrderPlacedCount: countCompletedSupplyOrderMilestoneStatuses(
          applicableFiles,
          "supplyorder",
        ),
        supplyOrderPlacedFiles: applicableFiles.filter(
          (file) => countCompletedSupplyOrderMilestoneStatuses([file], "supplyorder") > 0,
        ).length,
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
        bgToBeReturned: countBgToBeReturnedOrders(
          files,
          milestone.key,
          bgReturnOffsetDays,
        ),
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
      const paymentDue = countPaymentDueOrders(files);
      const paymentInProcess = countPaymentInProcessOrders(files);
      const paymentSubmitted = countPaymentSubmittedOrders(files);
      const allPaymentPending = files.reduce(
        (sum, file) => sum + getPaymentPendingRowCount(file),
        0,
      );
      const advancePaid = countAdvancePaymentPaidOrders(files);
      const advancePending = countAdvancePaymentPendingOrders(files);
      const billsReturnedForCorrection = countBillsReturnedForCorrection(files);
      const returnedBillsPending = countStatusPaymentReturnedBillsPending(files);
      const returnedBillsResubmitted = countStatusPaymentReturnedBillsResubmitted(files);
      const paymentPending =
        paymentDue + paymentInProcess + paymentSubmitted + returnedBillsPending + returnedBillsResubmitted;
      const returnedBillsPaid = countReturnedBillsPaid(files);
      const supplementarySubmitted = countSupplementaryBillSubmittedOrders(files);
      const supplementaryPending = countSupplementaryBillPendingOrders(files);
      const supplementaryNormalPending = countSupplementaryBillNormalPendingOrders(files);
      const supplementaryResubmittedPending = countSupplementaryBillResubmittedPendingOrders(files);
      const supplementaryReturnedForCorrection = countSupplementaryBillReturnHistoryOrders(files);
      const supplementaryReturnedPending = countSupplementaryBillReturnedPendingOrders(files);
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
        allPaymentPending,
        advancePaid,
        advancePending,
        billsReturnedForCorrection,
        returnedBillsPending,
        returnedBillsResubmitted,
        returnedBillsPaid,
        supplementarySubmitted,
        supplementaryPending,
        supplementaryNormalPending,
        supplementaryResubmittedPending,
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
      total: applicableFiles.length,
      underProcess: countAtPreviousStageFiles(applicableFiles, milestone),
      active: activeFiles.length,
      pending: pendingFiles.length,
      reviewed: reviewedFiles.length,
      hasReviewed: Boolean(milestone.reviewed),
      cleared: clearedFiles.length,
      activeLabel: getMilestoneActiveLabel(milestone.key),
      liveBids:
        milestone.key === "bidding"
          ? applicableFiles.filter(
              (file) =>
                !isCancelledFile(file) && !isYes(file.refloat) && isFileTenderLive(file),
            )
              .length
          : undefined,
      overdueBids:
        milestone.key === "bidding"
          ? applicableFiles.filter(
              (file) =>
                !isCancelledFile(file) && isBiddingInProgressFile(file) && isBidOverdue(file),
            )
              .length
          : undefined,
      inProcessBids:
        milestone.key === "bidding"
          ? applicableFiles.filter(
              (file) =>
                !isCancelledFile(file) &&
                isBiddingInProgressFile(file) &&
                !isFileTenderLive(file) &&
                !isBidOverdue(file),
            ).length
          : undefined,
      completed:
        milestone.key === "delivery" ? countDeliveryCompletedOrders(files) : undefined,
      due: milestone.key === "delivery" ? countDeliveryPendingOrders(files) : undefined,
      overdue: milestone.key === "delivery" ? countDeliveryOverdueOrders(files) : undefined,
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

function getAnalyticsSummary(
  files: FileRecord[],
  divisions: Division[],
  valueThresholdLevels: AppSettings["valueThresholdLevels"] = [],
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
    monthWiseBgExpiry: getMonthWiseBgExpiry(files),
    biddingModeMix: getBiddingModeMix(files),
    fileValueThresholds: getFileValueThresholds(files, valueThresholdLevels),
    soValueThresholds: getSupplyOrderValueThresholds(files, valueThresholdLevels),
    divisionRiskRanking: getDivisionRiskRanking(files),
    divisionPaymentPendingRanking: getDivisionPaymentPendingRanking(files),
    tcecStatus: getTcecStatusSummary(files, selectedYear),
    cncSummary: getCncSummary(files, selectedYear),
  };
}

type TcecStatusStage = "pre" | "post";

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
  const counts = new Map<string, { count: number; soCount: number }>();
  files.forEach((file) => {
    const name = getAnalyticsName(file.division, "Unassigned");
    const current = counts.get(name) ?? { count: 0, soCount: 0 };
    current.count += 1;
    const datedOrders = rawSupplyOrders(file).filter(hasSupplyOrderDate).length;
    current.soCount += datedOrders || (hasFilledString(file.soDate) ? 1 : 0);
    counts.set(name, current);
  });
  return Array.from(counts.entries())
    .map(([name, values]) => ({ name, ...values }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
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
    rawSupplyOrders(file).forEach((order) => {
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
  activityYear?: string,
) {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  const capitalTotals = new Map<string, number>();
  const revenueTotals = new Map<string, number>();
  const fileIdsByFirmType = new Map<string, Set<string>>();
  const configured = getConfiguredFirmTypes(configuredFirmTypes);
  const activityYearRange = getFinancialYearDateRange(activityYear);
  rawSupplyOrderEntries(files).forEach(({ file, order }) => {
    if (isSupplyOrderCancelled(file, order)) return;
    if (activityYearRange && !isDateWithinRange(order.soDate, activityYearRange)) return;
    const value = getSupplyOrderTotalValue(file, order);
    if (value <= 0) return;
    const name = getFirmTypeDistributionName(order, configured);
    totals.set(name, (totals.get(name) ?? 0) + value);
    counts.set(name, (counts.get(name) ?? 0) + 1);
    capitalTotals.set(name, (capitalTotals.get(name) ?? 0) + (getInrAmount(order.soValueCapital, file) ?? 0));
    revenueTotals.set(name, (revenueTotals.get(name) ?? 0) + (getInrAmount(order.soValueRevenue, file) ?? 0));
    const fileIds = fileIdsByFirmType.get(name) ?? new Set<string>();
    fileIds.add(file.id);
    fileIdsByFirmType.set(name, fileIds);
  });
  return mapDistributionEntriesToRows(totals, configured).map((row) => ({
    ...row,
    count: counts.get(row.name) ?? 0,
    capital: Math.round(capitalTotals.get(row.name) ?? 0),
    revenue: Math.round(revenueTotals.get(row.name) ?? 0),
    fileIds: Array.from(fileIdsByFirmType.get(row.name) ?? []),
  }));
}

function getActualPaymentDistributionByFirmType(
  files: FileRecord[],
  configuredFirmTypes: string[] | undefined,
  activityYear?: string,
) {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  const capitalTotals = new Map<string, number>();
  const revenueTotals = new Map<string, number>();
  const fileIdsByFirmType = new Map<string, Set<string>>();
  const configured = getConfiguredFirmTypes(configuredFirmTypes);
  const activityYearRange = getFinancialYearDateRange(activityYear);
  const todayDate = formatLocalDate(new Date());
  getFinancePaymentLiabilityEntries(files).forEach((entry) => {
    if (!isDateOnOrBefore(entry.paymentDate, todayDate)) return;
    if (activityYearRange && !isDateWithinRange(entry.paymentDate, activityYearRange)) return;
    const value = entry.capital + entry.revenue;
    if (value <= 0) return;
    const name = getFirmTypeDistributionName(entry.order, configured);
    totals.set(name, (totals.get(name) ?? 0) + value);
    counts.set(name, (counts.get(name) ?? 0) + 1);
    capitalTotals.set(name, (capitalTotals.get(name) ?? 0) + entry.capital);
    revenueTotals.set(name, (revenueTotals.get(name) ?? 0) + entry.revenue);
    const fileIds = fileIdsByFirmType.get(name) ?? new Set<string>();
    fileIds.add(entry.file.id);
    fileIdsByFirmType.set(name, fileIds);
  });
  advancePaymentEntries(files).forEach(({ file, order }) => {
    if (isSupplyOrderCancelled(file, order)) return;
    if (!isDateOnOrBefore(order.advancePaymentDetail?.paymentDate, todayDate)) return;
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
    counts.set(name, (counts.get(name) ?? 0) + 1);
    capitalTotals.set(name, (capitalTotals.get(name) ?? 0) + (getInrAmount(getAdvancePaymentCapital(order), file) ?? 0));
    revenueTotals.set(name, (revenueTotals.get(name) ?? 0) + (getInrAmount(getAdvancePaymentRevenue(order), file) ?? 0));
    const fileIds = fileIdsByFirmType.get(name) ?? new Set<string>();
    fileIds.add(file.id);
    fileIdsByFirmType.set(name, fileIds);
  });
  return mapDistributionEntriesToRows(totals, configured).map((row) => ({
    ...row,
    count: counts.get(row.name) ?? 0,
    capital: Math.round(capitalTotals.get(row.name) ?? 0),
    revenue: Math.round(revenueTotals.get(row.name) ?? 0),
    fileIds: Array.from(fileIdsByFirmType.get(row.name) ?? []),
  }));
}

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
  if (entry.kind !== "main") return entry.sourceDate;
  return getPaymentWorkflowStartDate(entry.file, entry.order);
}

function getFinance1Summary(
  files: FileRecord[],
  fiscalYear: string,
  asOfDate = getFinanceSnapshotDate(),
): Finance1Summary {
  const range = getFinancialYearDateRange(fiscalYear);
  const todayDate = asOfDate;
  const cutoffDate = range ? (todayDate < range.end ? todayDate : range.end) : "";
  const selectedActivityRange = range ? { ...range, end: cutoffDate } : undefined;
  const isLaterActivityDate = (date: string | undefined) =>
    Boolean(range && isDateAfterDate(date, range.end) && isDateOnOrBefore(date, todayDate));
  const activityCountsForFileScope = {
    supplyOrdersPlacedInSelectedFy: 0,
    liveSupplyOrdersPlacedInSelectedFy: 0,
    filesClosedInSelectedFy: 0,
  };
  const activityCountsByInitiationYear = new Map<
    string,
    {
      supplyOrdersPlaced: number;
      liveSupplyOrders: number;
      filesClosed: number;
      supplyOrderFileIds: Set<string>;
      liveSupplyOrderFileIds: Set<string>;
      closedFileIds: Set<string>;
    }
  >();
  const getActivityCountsForInitiationYear = (file: FileRecord) => {
    const initiationYear = file.year?.trim() || "FY unavailable";
    const existing = activityCountsByInitiationYear.get(initiationYear);
    if (existing) return existing;
    const counts = {
      supplyOrdersPlaced: 0,
      liveSupplyOrders: 0,
      filesClosed: 0,
      supplyOrderFileIds: new Set<string>(),
      liveSupplyOrderFileIds: new Set<string>(),
      closedFileIds: new Set<string>(),
    };
    activityCountsByInitiationYear.set(initiationYear, counts);
    return counts;
  };
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
    activityCountsForFileScope,
    activityCountsForFileScopeByInitiationYear: [],
    paymentsRecordedInSelectedFy: {
      regular: createFinance1Metric(),
      stage: createFinance1Metric(),
      supplementary: createFinance1Metric(),
      advance: createFinance1Metric(),
      total: createFinance1Metric(),
    },
    activityCounts: {
      supplyOrdersPlacedInSelectedFy: 0,
      supplyOrdersPlacedInFollowingFy: 0,
      regularSupplyOrdersPlacedInSelectedFy: 0,
      stageSupplyOrdersPlacedInSelectedFy: 0,
      regularSupplyOrdersPlacedLater: 0,
      stageSupplyOrdersPlacedLater: 0,
      supplyOrdersPlacedByYearEndCancelledLater: 0,
      regularSupplyOrdersCompletedLater: 0,
      stageSupplyOrdersCompletedLater: 0,
      regularSupplyOrderPaymentsWithBillSentLater: 0,
      stageSupplyOrderPaymentsWithBillSentLater: 0,
      supplyOrdersPlacedByYearEndStillUnpaid: 0,
      soPaymentsInSelectedFy: 0,
      soPaymentsInFollowingFy: 0,
      regularPaymentsPaidInSelectedFy: 0,
      regularPaymentsDueInSelectedFy: 0,
      regularPaymentsPaidLater: 0,
      regularPaymentsDueLater: 0,
      stagePaymentsPaidInSelectedFy: 0,
      stagePaymentsDueInSelectedFy: 0,
      stagePaymentsPaidLater: 0,
      stagePaymentsDueLater: 0,
      supplementaryPaymentsInSelectedFy: 0,
      supplementaryPaymentsInFollowingFy: 0,
      advancePaymentsInSelectedFy: 0,
      advancePaymentsInFollowingFy: 0,
      billsSentInSelectedFy: 0,
      billsSentInFollowingFy: 0,
      selectedFyBillsPaidInSelectedFy: 0,
      selectedFyBillsPaidInFollowingFy: 0,
      selectedFyBillsDateOrderConflict: 0,
      selectedFyBillsStillUnpaid: 0,
      selectedFyBillsStoppedByNfa: 0,
      selectedFyBillsStoppedByNfaInSelectedFy: 0,
      selectedFyBillsStoppedByNfaLater: 0,
      filesClosedInSelectedFy: 0,
      filesClosedInFollowingFy: 0,
      filesActiveAtYearEndClosedLater: 0,
      filesActiveAtYearEndDemandCancelledLater: 0,
    },
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
    uncommittedEstimateAtFyEnd: createFinance1Metric(),
    paidByFyEnd: createFinance1Metric(),
    unpaidLiabilityAtFyEnd: createFinance1Metric(),
    yearEndLiabilityPaidLater: createFinance1Metric(),
    yearEndLiabilityStillUnpaidToday: createFinance1Metric(),
    yearEndLiabilityClosedByNfa: createFinance1Metric(),
    otherPaymentMadeLater: 0,
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
  const getFileTypeRow = (fileType: string) => {
    const label = fileType.trim() || "Not specified";
    const key = label.toLowerCase();
    const existing = fileTypeDistribution.get(key);
    if (existing) return existing;
    const row: Finance1FileTypeDistributionRow = {
      fileType: label,
      files: 0,
      filesWithSo: 0,
      filesWithSoLive: 0,
      activeAtFyEnd: 0,
      closedByFyEnd: 0,
      cancelledByFyEnd: 0,
      active: 0,
      closed: 0,
      cancelled: 0,
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

    const cancelledByFyEnd =
      isYes(file.demandCancelled) && isDateOnOrBefore(file.demandCancelledDate, cutoffDate);
    const closedByFyEnd = isDateOnOrBefore(file.fileClosureDate, cutoffDate);
    if (selectedActivityRange && isDateWithinRange(file.fileClosureDate, selectedActivityRange)) {
      summary.activityCounts.filesClosedInSelectedFy += 1;
      addDrillFile("activity:filesClosed:selected", file);
    }
    if (isLaterActivityDate(file.fileClosureDate)) {
      summary.activityCounts.filesClosedInFollowingFy += 1;
      addDrillFile("activity:filesClosed:later", file);
      if (!cancelledByFyEnd && !closedByFyEnd) {
        summary.activityCounts.filesActiveAtYearEndClosedLater += 1;
      }
    }
    if (
      !cancelledByFyEnd &&
      !closedByFyEnd &&
      isYes(file.demandCancelled) &&
      isLaterActivityDate(file.demandCancelledDate)
    ) {
      summary.activityCounts.filesActiveAtYearEndDemandCancelledLater += 1;
      addDrillFile("activity:filesDemandCancelledLater", file);
    }
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

    const fileTypeRow = getFileTypeRow(file.fileType ?? "");
    fileTypeRow.files += 1;
    fileTypeRow.capital += demandCapital;
    fileTypeRow.revenue += demandRevenue;
    fileTypeRow.total += demandCapital + demandRevenue;
    if (cancelledByFyEnd) fileTypeRow.cancelledByFyEnd += 1;
    else if (closedByFyEnd) fileTypeRow.closedByFyEnd += 1;
    else fileTypeRow.activeAtFyEnd += 1;
    const cancelledLive = isCancelledFile(file);
    const closedLive = isFileClosed(file);
    if (cancelledLive) fileTypeRow.cancelled += 1;
    else if (closedLive) fileTypeRow.closed += 1;
    else fileTypeRow.active += 1;
    const fileTypeKey = `fileType:${fileTypeRow.fileType.toLowerCase()}`;
    addDrillFile(`${fileTypeKey}:files`, file);
    const hasSoLive = normalizedFileSupplyOrders(file).some(
      (order) => hasSupplyOrderDate(order) && !isSupplyOrderCancelled(file, order),
    );
    if (hasSoLive) {
      fileTypeRow.filesWithSoLive += 1;
      addDrillFile(`${fileTypeKey}:liveWithSo`, file);
    }
    if (cancelledByFyEnd) addDrillFile(`${fileTypeKey}:cancelled`, file);
    if (closedByFyEnd) addDrillFile(`${fileTypeKey}:closed`, file);
    if (!cancelledByFyEnd && !closedByFyEnd) addDrillFile(`${fileTypeKey}:active`, file);
    if (cancelledLive) addDrillFile(`${fileTypeKey}:liveCancelled`, file);
    if (closedLive) addDrillFile(`${fileTypeKey}:liveClosed`, file);
    if (!cancelledLive && !closedLive) addDrillFile(`${fileTypeKey}:liveActive`, file);

    const immsDoneByFyEnd = isDateOnOrBefore(file.immsDate, cutoffDate);
    const soRowsByFyEnd = normalizedFileSupplyOrders(file).filter(
      (order) =>
        hasFilledString(order.soDate) &&
        isDateOnOrBefore(order.soDate, cutoffDate) &&
        !isSupplyOrderCancelledByCutoff(file, order, cutoffDate),
    );
    const supplyOrderRowsByFyEnd = normalizedRawSupplyOrders(file).filter(
      (order) =>
        hasFilledString(order.soDate) &&
        isDateOnOrBefore(order.soDate, cutoffDate) &&
        !isSupplyOrderCancelledByCutoff(file, order, cutoffDate),
    );
    if (selectedActivityRange) {
      normalizedRawSupplyOrders(file).forEach((order) => {
        if (
          isDateWithinRange(order.soDate, selectedActivityRange) &&
          !isSupplyOrderCancelledByCutoff(file, order, cutoffDate)
        ) {
          summary.activityCounts.supplyOrdersPlacedInSelectedFy += 1;
          if (isYes(order.stageDelivery)) {
            summary.activityCounts.stageSupplyOrdersPlacedInSelectedFy += 1;
            addDrillFile("activity:soPlaced:stage:selected", file);
          } else {
            summary.activityCounts.regularSupplyOrdersPlacedInSelectedFy += 1;
            addDrillFile("activity:soPlaced:regular:selected", file);
          }
        }
      });
    }
    if (range) {
      normalizedRawSupplyOrders(file).forEach((order) => {
        if (isLaterActivityDate(order.soDate) && !isSupplyOrderCancelledByCutoff(file, order, cutoffDate)) {
          summary.activityCounts.supplyOrdersPlacedInFollowingFy += 1;
          if (isYes(order.stageDelivery)) {
            summary.activityCounts.stageSupplyOrdersPlacedLater += 1;
            addDrillFile("activity:soPlaced:stage:later", file);
          } else {
            summary.activityCounts.regularSupplyOrdersPlacedLater += 1;
            addDrillFile("activity:soPlaced:regular:later", file);
          }
        }
      });
    }
    const supplyOrdersCancelledLater = normalizedRawSupplyOrders(file).filter(
      (order) =>
        isDateOnOrBefore(order.soDate, cutoffDate) &&
        isDateAfterDate(order.soCancelledDate, cutoffDate) &&
        isDateOnOrBefore(order.soCancelledDate, todayDate) &&
        isYes(order.soCancelled),
    );
    summary.activityCounts.supplyOrdersPlacedByYearEndCancelledLater += supplyOrdersCancelledLater.length;
    if (supplyOrdersCancelledLater.length) addDrillFile("activity:soCancelledLater", file);
    normalizedSupplyOrderEntries([file]).forEach(({ order }) => {
      const placedByYearEnd =
        isDateOnOrBefore(order.soDate, cutoffDate) &&
        !isSupplyOrderCancelledByCutoff(file, order, cutoffDate);
      if (!placedByYearEnd) return;
      if (isLaterActivityDate(order.materialReceiptDate) || isLaterActivityDate(order.jobCompletionDate)) {
        if (isYes(order.stageDelivery)) {
          summary.activityCounts.stageSupplyOrdersCompletedLater += 1;
          addDrillFile("activity:soCompletedLater:stage", file);
        } else {
          summary.activityCounts.regularSupplyOrdersCompletedLater += 1;
          addDrillFile("activity:soCompletedLater:regular", file);
        }
      }
    });
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
    if (
      !cancelledByFyEnd &&
      selectedActivityRange &&
      isDateWithinRange(file.immsDate, selectedActivityRange) &&
      !hasSoByFyEnd
    ) {
      summary.immsDoneSoNotPlacedByFyEnd += 1;
      addFinance1Amount(summary.bookedAtFyEnd, demandCapital, demandRevenue);
      addDrillFile("bookedAtFyEnd", file);
    }
    if (!cancelledByFyEnd && hasSoByFyEnd) {
      summary.soPlacedByFyEnd += 1;
      addDrillFile("committedAtFyEnd", file);
      addDrillFile("soPlacedByFyEnd", file);
      const committedCapital = supplyOrderRowsByFyEnd.reduce(
        (sum, order) => sum + (getInrAmount(order.soValueCapital, file) ?? 0),
        0,
      );
      const committedRevenue = supplyOrderRowsByFyEnd.reduce(
        (sum, order) => sum + (getInrAmount(order.soValueRevenue, file) ?? 0),
        0,
      );
      const uncommittedCapital = demandCapital - committedCapital;
      const uncommittedRevenue = demandRevenue - committedRevenue;
      if (uncommittedCapital !== 0 || uncommittedRevenue !== 0) {
        addFinance1Amount(
          summary.uncommittedEstimateAtFyEnd,
          uncommittedCapital,
          uncommittedRevenue,
        );
        addDrillFile("uncommittedEstimateAtFyEnd", file);
      }
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
      const isDeliveryPending = isIrClearingApplicable(file);
      addDrillFile(
        isDeliveryPending ? "materialReceiptPendingByFyEnd" : "jobCompletionPendingByFyEnd",
        file,
      );
      if (
        supplyOrderRowsByFyEnd.some((order) =>
          isOrderDeliveryOrJobDoneByCutoff(order, todayDate),
        )
      ) {
        addDrillFile("deliveryJobPendingCompletedLater", file);
        addDrillFile(
          isDeliveryPending
            ? "deliveryPendingCompletedLater"
            : "jobCompletionPendingCompletedLater",
          file,
        );
      } else {
        addDrillFile("deliveryJobPendingStillOpenToday", file);
        addDrillFile(
          isDeliveryPending
            ? "deliveryPendingStillOpenToday"
            : "jobCompletionPendingStillOpenToday",
          file,
        );
      }
    }
    if (billSentByFyEnd) {
      summary.billSentByFyEnd += 1;
      addDrillFile("billSentByFyEnd", file);
    }
    const paymentLiabilityEntries = getFinancePaymentLiabilityEntries([file]);
    paymentLiabilityEntries.forEach((entry) => {
      const billSentDate = entry.kind === "supplementary"
        ? entry.bill.billSentForPaymentDate
        : entry.order.billSentForPaymentDate;
      if (entry.kind === "main") {
        const placedByYearEnd =
          isDateOnOrBefore(entry.order.soDate, cutoffDate) &&
          !isSupplyOrderCancelledByCutoff(file, entry.order, cutoffDate);
        if (placedByYearEnd && isLaterActivityDate(billSentDate)) {
          const isStagePaymentCase = isYes(entry.order.stageDelivery) && isYes(entry.order.stagePayment);
          if (isStagePaymentCase) {
            summary.activityCounts.stageSupplyOrderPaymentsWithBillSentLater += 1;
            addDrillFile("activity:billsSentLater:stage", file);
          } else {
            summary.activityCounts.regularSupplyOrderPaymentsWithBillSentLater += 1;
            addDrillFile("activity:billsSentLater:regular", file);
          }
        }
        if (placedByYearEnd && entry.pending) {
          summary.activityCounts.supplyOrdersPlacedByYearEndStillUnpaid += 1;
          addDrillFile("activity:paymentStillUnpaid", file);
        }
        const isStagePaymentCase = isYes(entry.order.stageDelivery) && isYes(entry.order.stagePayment);
        const paymentDueDate = getPaymentWorkflowStartDate(entry.file, entry.order);
        if (selectedActivityRange && isDateWithinRange(paymentDueDate, selectedActivityRange)) {
          if (isStagePaymentCase) {
            summary.activityCounts.stagePaymentsDueInSelectedFy += 1;
            addDrillFile("activity:paymentDue:stage:selected", file);
          } else {
            summary.activityCounts.regularPaymentsDueInSelectedFy += 1;
            addDrillFile("activity:paymentDue:regular:selected", file);
          }
        } else if (isLaterActivityDate(paymentDueDate)) {
          if (isStagePaymentCase) {
            summary.activityCounts.stagePaymentsDueLater += 1;
            addDrillFile("activity:paymentDue:stage:later", file);
          } else {
            summary.activityCounts.regularPaymentsDueLater += 1;
            addDrillFile("activity:paymentDue:regular:later", file);
          }
        }
        if (selectedActivityRange && isDateWithinRange(entry.paymentDate, selectedActivityRange)) {
          if (isStagePaymentCase) {
            summary.activityCounts.stagePaymentsPaidInSelectedFy += 1;
            addDrillFile("activity:paymentPaid:stage:selected", file);
          } else {
            summary.activityCounts.regularPaymentsPaidInSelectedFy += 1;
            addDrillFile("activity:paymentPaid:regular:selected", file);
          }
        } else if (isLaterActivityDate(entry.paymentDate)) {
          if (isStagePaymentCase) {
            summary.activityCounts.stagePaymentsPaidLater += 1;
            addDrillFile("activity:paymentPaid:stage:later", file);
          } else {
            summary.activityCounts.regularPaymentsPaidLater += 1;
            addDrillFile("activity:paymentPaid:regular:later", file);
          }
        }
      }
      const selectedFyBill = Boolean(selectedActivityRange && isDateWithinRange(billSentDate, selectedActivityRange));
      if (selectedFyBill) {
        summary.activityCounts.billsSentInSelectedFy += 1;
        addDrillFile("activity:billsSent:selected", file);
      }
      if (isLaterActivityDate(billSentDate)) {
        summary.activityCounts.billsSentInFollowingFy += 1;
        addDrillFile("activity:billsSent:later", file);
      }
      if (selectedActivityRange && isDateWithinRange(entry.paymentDate, selectedActivityRange)) {
        const paymentMetric = entry.kind === "supplementary"
          ? summary.paymentsRecordedInSelectedFy.supplementary
          : isYes(entry.order.stageDelivery) && isYes(entry.order.stagePayment)
            ? summary.paymentsRecordedInSelectedFy.stage
            : summary.paymentsRecordedInSelectedFy.regular;
        addFinance1Amount(paymentMetric, entry.capital, entry.revenue);
        addDrillFile("activity:paymentPaid:all:selected", file);
        if (entry.kind === "supplementary") {
          summary.activityCounts.supplementaryPaymentsInSelectedFy += 1;
          addDrillFile("activity:supplementaryPaid:selected", file);
        } else summary.activityCounts.soPaymentsInSelectedFy += 1;
      }
      if (selectedFyBill) {
        if (
          isDateOnOrBefore(entry.paymentDate, todayDate) &&
          hasFilledString(billSentDate) &&
          entry.paymentDate! < billSentDate!
        ) {
          summary.activityCounts.selectedFyBillsDateOrderConflict += 1;
        } else if (selectedActivityRange && isDateWithinRange(entry.paymentDate, selectedActivityRange)) {
          summary.activityCounts.selectedFyBillsPaidInSelectedFy += 1;
          addDrillFile("activity:selectedBillsPaid:selected", file);
        } else if (isLaterActivityDate(entry.paymentDate)) {
          summary.activityCounts.selectedFyBillsPaidInFollowingFy += 1;
          addDrillFile("activity:selectedBillsPaid:later", file);
        } else if (!isDateOnOrBefore(entry.paymentDate, todayDate)) {
          if (isFinanceLiabilityClosedByNoFurtherAction(entry.order, todayDate)) {
            summary.activityCounts.selectedFyBillsStoppedByNfa += 1;
            addDrillFile("activity:selectedBillsStoppedNfa", file);
            if (selectedActivityRange && isDateWithinRange(entry.order.noFurtherActionDate, selectedActivityRange)) {
              summary.activityCounts.selectedFyBillsStoppedByNfaInSelectedFy += 1;
              addDrillFile("activity:selectedBillsStoppedNfa:selected", file);
            } else {
              summary.activityCounts.selectedFyBillsStoppedByNfaLater += 1;
              addDrillFile("activity:selectedBillsStoppedNfa:later", file);
            }
          } else {
            summary.activityCounts.selectedFyBillsStillUnpaid += 1;
            addDrillFile("activity:selectedBillsStillUnpaid", file);
          }
        }
      }
      if (isLaterActivityDate(entry.paymentDate)) {
        if (entry.kind === "supplementary") {
          summary.activityCounts.supplementaryPaymentsInFollowingFy += 1;
          addDrillFile("activity:supplementaryPaid:later", file);
        } else summary.activityCounts.soPaymentsInFollowingFy += 1;
      }
    });
    advancePaymentEntries([file]).forEach(({ order }) => {
      const paymentDate = order.advancePaymentDetail?.paymentDate;
      const billSentDate = order.advancePaymentDetail?.billSentForPaymentDate;
      const selectedFyBill = Boolean(selectedActivityRange && isDateWithinRange(billSentDate, selectedActivityRange));
      if (selectedFyBill) {
        summary.activityCounts.billsSentInSelectedFy += 1;
        addDrillFile("activity:billsSent:selected", file);
      }
      if (isLaterActivityDate(billSentDate)) {
        summary.activityCounts.billsSentInFollowingFy += 1;
        addDrillFile("activity:billsSent:later", file);
      }
      if (selectedActivityRange && isDateWithinRange(paymentDate, selectedActivityRange)) {
        addFinance1Amount(
          summary.paymentsRecordedInSelectedFy.advance,
          getInrAmount(getAdvancePaymentCapital(order), file) ?? 0,
          getInrAmount(getAdvancePaymentRevenue(order), file) ?? 0,
        );
        summary.activityCounts.advancePaymentsInSelectedFy += 1;
        addDrillFile("activity:advancePaid:selected", file);
        addDrillFile("activity:paymentPaid:all:selected", file);
      }
      if (isLaterActivityDate(paymentDate)) {
        summary.activityCounts.advancePaymentsInFollowingFy += 1;
        addDrillFile("activity:advancePaid:later", file);
      }
      if (selectedFyBill) {
        if (
          isDateOnOrBefore(paymentDate, todayDate) &&
          hasFilledString(billSentDate) &&
          paymentDate! < billSentDate!
        ) {
          summary.activityCounts.selectedFyBillsDateOrderConflict += 1;
        } else if (selectedActivityRange && isDateWithinRange(paymentDate, selectedActivityRange)) {
          summary.activityCounts.selectedFyBillsPaidInSelectedFy += 1;
          addDrillFile("activity:selectedBillsPaid:selected", file);
        } else if (isLaterActivityDate(paymentDate)) {
          summary.activityCounts.selectedFyBillsPaidInFollowingFy += 1;
          addDrillFile("activity:selectedBillsPaid:later", file);
        } else if (!isDateOnOrBefore(paymentDate, todayDate)) {
          if (isUnpaidAdvanceClearedByNoFurtherAction(order, todayDate)) {
            summary.activityCounts.selectedFyBillsStoppedByNfa += 1;
            addDrillFile("activity:selectedBillsStoppedNfa", file);
            if (selectedActivityRange && isDateWithinRange(order.noFurtherActionDate, selectedActivityRange)) {
              summary.activityCounts.selectedFyBillsStoppedByNfaInSelectedFy += 1;
              addDrillFile("activity:selectedBillsStoppedNfa:selected", file);
            } else {
              summary.activityCounts.selectedFyBillsStoppedByNfaLater += 1;
              addDrillFile("activity:selectedBillsStoppedNfa:later", file);
            }
          } else {
            summary.activityCounts.selectedFyBillsStillUnpaid += 1;
            addDrillFile("activity:selectedBillsStillUnpaid", file);
          }
        }
      }
    });
    const paymentLiabilitiesAtFyEnd = getFinancePaymentLiabilityEntries([file], cutoffDate);
    const hasRegularPaymentByFyEnd = paymentLiabilitiesAtFyEnd.some((entry) =>
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
    const hasSubmittedUnpaidBillByFyEnd = paymentLiabilitiesAtFyEnd.some((entry) => {
      const submittedDate =
        entry.kind === "supplementary"
          ? entry.bill.billSentForPaymentDate
          : entry.order.billSentForPaymentDate;
      return (
        isDateOnOrBefore(submittedDate, cutoffDate) &&
        !isDateOnOrBefore(entry.paymentDate, cutoffDate)
      );
    });
    if (hasSubmittedUnpaidBillByFyEnd) {
      addDrillFile("billsSubmittedButUnpaid", file);
    }
    if (deliveryJobDoneByFyEnd && !billSentByFyEnd) {
      addDrillFile("paymentDueButBillNotSubmitted", file);
      const allYearEndOrdersStopped =
        supplyOrderRowsByFyEnd.length > 0 &&
        supplyOrderRowsByFyEnd.every((order) =>
          isFinanceLiabilityClosedByNoFurtherAction(order, todayDate),
        );
      if (allYearEndOrdersStopped) {
        addDrillFile("paymentDueClosedByNfa", file);
      } else if (supplyOrderRowsByFyEnd.some((order) => isOrderBillSentByCutoff(order, todayDate))) {
        addDrillFile("paymentDueBillSubmittedLater", file);
      } else {
        addDrillFile("paymentDueStillNotSubmittedToday", file);
      }
    }

    paymentLiabilitiesAtFyEnd.forEach((entry) => {
      const submittedDate =
        entry.kind === "supplementary"
          ? entry.bill.billSentForPaymentDate
          : entry.order.billSentForPaymentDate;
      if (
        isDateOnOrBefore(submittedDate, cutoffDate) &&
        !isDateOnOrBefore(entry.paymentDate, cutoffDate)
      ) {
        if (
          isDateAfterDate(entry.paymentDate, cutoffDate) &&
          isDateOnOrBefore(entry.paymentDate, todayDate)
        ) {
          addDrillFile("billsSubmittedUnpaidPaidLater", file);
        } else if (isFinanceLiabilityClosedByNoFurtherAction(entry.order, todayDate)) {
          addDrillFile("billsSubmittedUnpaidClosedByNfa", file);
        } else {
          addDrillFile("billsSubmittedUnpaidStillToday", file);
        }
      }
      if (isDateOnOrBefore(entry.paymentDate, cutoffDate)) {
        if (isDateOnOrBefore(entry.sourceDate, cutoffDate)) {
          addFinance1Amount(summary.paidByFyEnd, entry.capital, entry.revenue);
          addDrillFile("paidByFyEnd", file);
        }
        return;
      }
      const liabilityDate = getFinance1LiabilityDate(entry);
      if (isDateOnOrBefore(liabilityDate, cutoffDate)) {
        addFinance1Amount(summary.unpaidLiabilityAtFyEnd, entry.capital, entry.revenue);
        addDrillFile("unpaidLiabilityAtFyEnd", file);

        if (
          isDateAfterDate(entry.paymentDate, cutoffDate) &&
          isDateOnOrBefore(entry.paymentDate, todayDate)
        ) {
          addFinance1Amount(summary.yearEndLiabilityPaidLater, entry.capital, entry.revenue);
          addDrillFile("yearEndLiabilityPaidLater", file);
          addDrillFile("activity:yearEndLiabilityPaidLater", file);
        } else if (isFinanceLiabilityClosedByNoFurtherAction(entry.order, todayDate)) {
          addFinance1Amount(summary.yearEndLiabilityClosedByNfa, entry.capital, entry.revenue);
          addDrillFile("yearEndLiabilityClosedByNfa", file);
          addDrillFile("activity:yearEndLiabilityNfa", file);
        } else {
          addFinance1Amount(summary.yearEndLiabilityStillUnpaidToday, entry.capital, entry.revenue);
          addDrillFile("yearEndLiabilityStillUnpaidToday", file);
          addDrillFile("activity:yearEndLiabilityStillUnpaid", file);
        }
      }
    });

    let hasOtherPaymentMadeLater = false;
    paymentLiabilityEntries.forEach((entry) => {
      if (isDateOnOrBefore(entry.paymentDate, todayDate)) {
        addFinance1Amount(summary.paidTillDate, entry.capital, entry.revenue);
        addDrillFile("paidTillDate", file);
      } else if (isDateOnOrBefore(entry.sourceDate, todayDate)) {
        addFinance1Amount(summary.balanceUnpaidToday, entry.capital, entry.revenue);
        addDrillFile("balanceUnpaidToday", file);
      }
      if (
        isDateAfterDate(entry.paymentDate, cutoffDate) &&
        isDateOnOrBefore(entry.paymentDate, todayDate) &&
        !isDateOnOrBefore(getFinance1LiabilityDate(entry), cutoffDate)
      ) {
        hasOtherPaymentMadeLater = true;
      }
    });

    let hasPaymentMadeLater = paymentLiabilityEntries.some(
      (entry) =>
        isDateAfterDate(entry.paymentDate, cutoffDate) &&
        isDateOnOrBefore(entry.paymentDate, todayDate),
    );

    advancePaymentEntries([file]).forEach(({ order }) => {
      if (isUnpaidAdvanceClearedByNoFurtherAction(order, cutoffDate)) return;
      if (isSupplyOrderCancelledByCutoff(file, order, cutoffDate)) return;
      const paymentDate = order.advancePaymentDetail?.paymentDate;
      const paidByFyEnd = isDateOnOrBefore(paymentDate, cutoffDate);
      const paidByToday = isDateOnOrBefore(paymentDate, todayDate);
      const paidCapital = getInrAmount(getAdvancePaymentCapital(order), file) ?? 0;
      const paidRevenue = getInrAmount(getAdvancePaymentRevenue(order), file) ?? 0;
      const allocatedCapital = getAdvanceFinanceAllocationCapital(file, order);
      const allocatedRevenue = getAdvanceFinanceAllocationRevenue(file, order);
      const advanceLiabilityDate =
        order.advancePaymentDetail?.expectedPaymentDate || order.soDate;
      if (allocatedCapital + allocatedRevenue <= 0) return;

      if (paidByFyEnd && paidCapital + paidRevenue > 0) {
        addFinance1Amount(summary.paidByFyEnd, paidCapital, paidRevenue);
        addDrillFile("paidByFyEnd", file);
      }

      const unpaidAtFyEndCapital = Math.max(0, allocatedCapital - (paidByFyEnd ? paidCapital : 0));
      const unpaidAtFyEndRevenue = Math.max(0, allocatedRevenue - (paidByFyEnd ? paidRevenue : 0));
      if (
        isDateOnOrBefore(advanceLiabilityDate, cutoffDate) &&
        unpaidAtFyEndCapital + unpaidAtFyEndRevenue > 0
      ) {
        addFinance1Amount(
          summary.unpaidLiabilityAtFyEnd,
          unpaidAtFyEndCapital,
          unpaidAtFyEndRevenue,
        );
        addDrillFile("unpaidLiabilityAtFyEnd", file);

        const paidAfterCutoff =
          isDateAfterDate(paymentDate, cutoffDate) && isDateOnOrBefore(paymentDate, todayDate);
        const paidLaterCapital = paidAfterCutoff
          ? Math.min(unpaidAtFyEndCapital, paidCapital)
          : 0;
        const paidLaterRevenue = paidAfterCutoff
          ? Math.min(unpaidAtFyEndRevenue, paidRevenue)
          : 0;
        const remainingCapital = Math.max(0, unpaidAtFyEndCapital - paidLaterCapital);
        const remainingRevenue = Math.max(0, unpaidAtFyEndRevenue - paidLaterRevenue);
        if (paidLaterCapital + paidLaterRevenue > 0) {
          addFinance1Amount(
            summary.yearEndLiabilityPaidLater,
            paidLaterCapital,
            paidLaterRevenue,
          );
          addDrillFile("yearEndLiabilityPaidLater", file);
          addDrillFile("activity:yearEndLiabilityPaidLater", file);
        }
        if (remainingCapital + remainingRevenue > 0) {
          if (isUnpaidAdvanceClearedByNoFurtherAction(order, todayDate)) {
            addFinance1Amount(
              summary.yearEndLiabilityClosedByNfa,
              remainingCapital,
              remainingRevenue,
            );
            addDrillFile("yearEndLiabilityClosedByNfa", file);
            addDrillFile("activity:yearEndLiabilityNfa", file);
          } else {
            addFinance1Amount(
              summary.yearEndLiabilityStillUnpaidToday,
              remainingCapital,
              remainingRevenue,
            );
            addDrillFile("yearEndLiabilityStillUnpaidToday", file);
            addDrillFile("activity:yearEndLiabilityStillUnpaid", file);
          }
        }
      }
      if (
        unpaidAtFyEndCapital + unpaidAtFyEndRevenue > 0 &&
        isDateOnOrBefore(advanceLiabilityDate, cutoffDate)
      ) {
        summary.advancePendingByFyEnd += 1;
        addDrillFile("advancePendingByFyEnd", file);
        if (isDateAfterDate(paymentDate, cutoffDate) && isDateOnOrBefore(paymentDate, todayDate)) {
          addDrillFile("advancePendingPaidLater", file);
        } else if (isUnpaidAdvanceClearedByNoFurtherAction(order, todayDate)) {
          addDrillFile("advancePendingClosedByNfa", file);
        } else {
          addDrillFile("advancePendingStillToday", file);
        }
      }

      if (paidByToday && paidCapital + paidRevenue > 0) {
        addFinance1Amount(summary.paidTillDate, paidCapital, paidRevenue);
        addDrillFile("paidTillDate", file);
      }

      const unpaidTodayCapital = Math.max(0, allocatedCapital - (paidByToday ? paidCapital : 0));
      const unpaidTodayRevenue = Math.max(0, allocatedRevenue - (paidByToday ? paidRevenue : 0));
      if (
        unpaidTodayCapital + unpaidTodayRevenue > 0 &&
        !isUnpaidAdvanceIncludedInShortclosedBalance(order) &&
        !isSupplyOrderCancelled(file, order) &&
        isDateOnOrBefore(order.soDate, todayDate)
      ) {
        addFinance1Amount(summary.balanceUnpaidToday, unpaidTodayCapital, unpaidTodayRevenue);
        addDrillFile("balanceUnpaidToday", file);
      }
      if (
        isDateAfterDate(order.advancePaymentDetail?.paymentDate, cutoffDate) &&
        isDateOnOrBefore(order.advancePaymentDetail?.paymentDate, todayDate)
      ) {
        hasPaymentMadeLater = true;
        if (!isDateOnOrBefore(advanceLiabilityDate, cutoffDate)) {
          hasOtherPaymentMadeLater = true;
        }
      }
    });

    if (
      normalizedFileSupplyOrders(file).some(
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
    if (hasOtherPaymentMadeLater) {
      summary.otherPaymentMadeLater += 1;
      addDrillFile("otherPaymentMadeLater", file);
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
  [
    summary.paymentsRecordedInSelectedFy.regular,
    summary.paymentsRecordedInSelectedFy.stage,
    summary.paymentsRecordedInSelectedFy.supplementary,
    summary.paymentsRecordedInSelectedFy.advance,
  ].forEach((metric) => {
    addFinance1Amount(
      summary.paymentsRecordedInSelectedFy.total,
      metric.capital,
      metric.revenue,
      metric.count,
    );
  });
  if (selectedActivityRange) {
    files.forEach((file) => {
      if (isDateWithinRange(file.fileClosureDate, selectedActivityRange)) {
        activityCountsForFileScope.filesClosedInSelectedFy += 1;
        const initiationYearCounts = getActivityCountsForInitiationYear(file);
        initiationYearCounts.filesClosed += 1;
        initiationYearCounts.closedFileIds.add(file.id);
        addDrillFile("fyActivity:filesClosed", file);
      }
      normalizedRawSupplyOrders(file).forEach((order) => {
        if (isDateWithinRange(order.soDate, selectedActivityRange)) {
          activityCountsForFileScope.supplyOrdersPlacedInSelectedFy += 1;
          const initiationYearCounts = getActivityCountsForInitiationYear(file);
          initiationYearCounts.supplyOrdersPlaced += 1;
          initiationYearCounts.supplyOrderFileIds.add(file.id);
          addDrillFile("fyActivity:soPlaced", file);
          if (
            !hasFilledString(file.fileClosureDate) &&
            !isYes(order.soCancelled) &&
            !isYes(order.shortclosure)
          ) {
            activityCountsForFileScope.liveSupplyOrdersPlacedInSelectedFy += 1;
            initiationYearCounts.liveSupplyOrders += 1;
            initiationYearCounts.liveSupplyOrderFileIds.add(file.id);
            addDrillFile("fyActivity:liveSo", file);
          }
        }
      });
    });
  }
  summary.drillFileIds = Object.fromEntries(
    Array.from(drillFileIds, ([key, ids]) => [key, Array.from(ids)]),
  );
  summary.activityCountsForFileScope = activityCountsForFileScope;
  summary.activityCountsForFileScopeByInitiationYear = Array.from(
    activityCountsByInitiationYear,
    ([initiationYear, counts]) => ({
      initiationYear,
      supplyOrdersPlaced: counts.supplyOrdersPlaced,
      liveSupplyOrders: counts.liveSupplyOrders,
      filesClosed: counts.filesClosed,
      supplyOrderFileIds: Array.from(counts.supplyOrderFileIds),
      liveSupplyOrderFileIds: Array.from(counts.liveSupplyOrderFileIds),
      closedFileIds: Array.from(counts.closedFileIds),
    }),
  ).sort((a, b) => {
    if (a.initiationYear === "FY unavailable") return 1;
    if (b.initiationYear === "FY unavailable") return -1;
    return b.initiationYear.localeCompare(a.initiationYear);
  });
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
  const value = date?.trim();
  return Boolean(value) && value! <= cutoffDate;
}

function isDateAfterDate(date: string | undefined, cutoffDate: string) {
  const value = date?.trim();
  return Boolean(value) && value! > cutoffDate;
}

function getTopIndentorsByFiles(files: FileRecord[]) {
  const counts = new Map<string, { count: number; soCount: number }>();
  files.forEach((file) => {
    const name = getAnalyticsName(file.indentor, "Unassigned indentor");
    const current = counts.get(name) ?? { count: 0, soCount: 0 };
    current.count += 1;
    const datedOrders = rawSupplyOrders(file).filter(hasSupplyOrderDate).length;
    current.soCount += datedOrders || (hasFilledString(file.soDate) ? 1 : 0);
    counts.set(name, current);
  });
  return Array.from(counts.entries())
    .map(([name, values]) => ({ name, ...values }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
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
        fileCount: fileIds.length,
        sampleSize: durations.length,
        fileIds: fileIds.join(","),
        sortOrder: index,
      };
    })
    .filter((item) => item.sampleSize > 0)
    .sort(
      (a, b) =>
        b.averageDays - a.averageDays ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name),
    );
}

type MilestoneClearingDurationRow = { fileId: string; stageDays: number; cumulativeDays: number };

function getMilestoneClearingDurationRows(
  files: FileRecord[],
  definition: (typeof milestoneClearingDefinitions)[number],
) {
  if (definition.name === "GeM Undertaking") {
    return files
      .filter(
        (file) =>
          isYes(file.gem) &&
          (file.gemBiddingMode ?? "").trim().toLowerCase() !== "comparison",
      )
      .flatMap((file) => {
        const rows: MilestoneClearingDurationRow[] = [];
        const normalRow = getMilestoneClearingDurationRow(
          file,
          file.cfaDate,
          file.gemUndertakingDate,
        );
        if (normalRow) rows.push(normalRow);
        if (isYes(file.refloat)) {
          const refloatStart = isYes(file.tcec)
            ? file.postTcecDate
            : file.refloatRecommendationDate;
          const refloatRow = getMilestoneClearingDurationRow(
            file,
            refloatStart,
            file.refloatGemUndertakingDate,
          );
          if (refloatRow) rows.push(refloatRow);
        }
        return rows;
      });
  }
  if (definition.name === "RFP Vetting") {
    return files
      .filter((file) => isMilestoneClearingDefinitionApplicable(file, definition))
      .map((file) =>
        getMilestoneClearingDurationRow(
          file,
          getRfpVettingStartDate(file),
          file.rfpVettingApprovalDate,
        ),
      )
      .filter((row): row is MilestoneClearingDurationRow => Boolean(row));
  }
  if (definition.name === "Bidding") {
    return files.flatMap((file) => getMilestoneClearingBiddingDurationRows(file));
  }
  if (definition.name === "Post-TCEC") {
    return files
      .filter((file) => isMilestoneClearingDefinitionApplicable(file, definition))
      .map((file) =>
        getMilestoneClearingDurationRow(file, file.postTcecDate, file.postTcecMinutesDate),
      )
      .filter((row): row is MilestoneClearingDurationRow => Boolean(row));
  }
  if (definition.name === "Refloat Post-TCEC") {
    return files
      .filter((file) => isMilestoneClearingDefinitionApplicable(file, definition))
      .map((file) =>
        getMilestoneClearingDurationRow(
          file,
          file.refloatPostTcecDate,
          file.refloatPostTcecMinutesDate,
        ),
      )
      .filter((row): row is MilestoneClearingDurationRow => Boolean(row));
  }
  if (definition.name === "CNC") {
    return files
      .filter((file) => isMilestoneClearingDefinitionApplicable(file, definition))
      .map((file) =>
        getMilestoneClearingDurationRow(file, file.postTcecMinutesDate, file.cncApprovalDate),
      )
      .filter((row): row is MilestoneClearingDurationRow => Boolean(row));
  }
  if (definition.name === "Non-TCEC Technical Evaluation") {
    return files
      .filter(
        (file) =>
          !isYes(file.tcec) &&
          isBiddingApplicableForFile(file),
      )
      .flatMap((file) => getNonTcecTechnicalEvaluationDurationRows(file));
  }
  if (definition.name === "Financial Sanction") {
    return files
      .filter((file) => isYes(file.tcec))
      .flatMap((file) =>
        rawSupplyOrders(file)
          .map((order) =>
            getMilestoneClearingDurationRow(file, file.cncApprovalDate, order.financialSanctionDate),
          )
          .filter((row): row is MilestoneClearingDurationRow => Boolean(row)),
      );
  }
  if (definition.name === "Payment cycle (PCDA)") {
    const regularPaymentRows = files.flatMap((file) =>
      normalizedPaymentEntries([file])
        .filter(
          ({ file: entryFile, order }) =>
            order.includeInPaymentTiming !== false &&
            isPaymentOrderActive(entryFile, order) &&
            !hasBillReturnHistory(order) &&
            hasFilledString(order.billSentForPaymentDate) &&
            hasFilledString(order.paymentDate),
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
    const supplementaryRows = files.flatMap((file) =>
      rawSupplyOrders(file)
        .filter((order) => isPaymentOrderActive(file, order))
        .flatMap((order) =>
          getSupplementaryBills(order)
            .filter(
              (bill) =>
                bill.includeInPaymentTiming !== false &&
                !hasBillReturnHistory(bill) &&
                hasFilledString(bill.billSentForPaymentDate) &&
                hasFilledString(bill.paymentDate),
            )
            .map((bill) =>
              getMilestoneClearingDurationRow(
                file,
                bill.billSentForPaymentDate,
                bill.paymentDate,
              ),
            )
            .filter((row): row is MilestoneClearingDurationRow => Boolean(row)),
        ),
    );
    return [...regularPaymentRows, ...supplementaryRows];
  }
  if (definition.name === "Payment (ASL + PCDA)") {
    const regularAndAdvanceRows = files.flatMap((file) =>
      normalizedPaymentEntries([file])
        .filter(({ file: entryFile, order }) => {
          const isAdvancePayment = order.stageDeliveryLabel === "Advance Payment";
          const submissionDate = order.billSentForPaymentDate;
          const paid = hasFilledString(order.paymentDate);
          return (
            order.includeInPaymentTiming !== false &&
            isPaymentOrderActive(entryFile, order) &&
            paid &&
            !hasBillReturnHistory(order) &&
            (isAdvancePayment || hasFilledString(order.soDate)) &&
            hasFilledString(submissionDate)
          );
        })
        .map(({ file: entryFile, order }) => {
          const isAdvancePayment = order.stageDeliveryLabel === "Advance Payment";
          const submissionDate = order.billSentForPaymentDate;
          const startDate = isAdvancePayment
            ? submissionDate
            : getPaymentTimingTriggerDate(entryFile, order);
          return getMilestoneClearingDurationRow(entryFile, startDate, order.paymentDate);
        })
        .filter((row): row is MilestoneClearingDurationRow => Boolean(row)),
    );
    const supplementaryRows = files.flatMap((file) =>
      rawSupplyOrders(file)
        .filter((order) => isPaymentOrderActive(file, order))
        .flatMap((order) =>
          getSupplementaryBills(order)
            .filter((bill) =>
              bill.includeInPaymentTiming !== false &&
              !hasBillReturnHistory(bill) &&
              hasFilledString(bill.billSentForPaymentDate) &&
              hasFilledString(bill.paymentDate),
            )
            .map((bill) => {
              return getMilestoneClearingDurationRow(
                file,
                bill.billSentForPaymentDate,
                bill.paymentDate,
              );
            })
            .filter((row): row is MilestoneClearingDurationRow => Boolean(row)),
        ),
    );
    return [...regularAndAdvanceRows, ...supplementaryRows];
  }
  if (definition.name === "Payment cycle (ASL)") {
    return files.flatMap((file) =>
      effectivePaymentEntries([file])
        .filter(
          ({ file: entryFile, order }) =>
            order.includeInPaymentTiming !== false &&
            !isAdvancePaymentClearingRow(order) &&
            isPaymentOrderActive(entryFile, order) &&
            hasFilledString(order.soDate) &&
            hasFilledString(order.billSentForPaymentDate),
        )
        .map(({ file: entryFile, order }) =>
          getMilestoneClearingDurationRow(
            entryFile,
            getPaymentTimingTriggerDate(entryFile, order),
            order.billSentForPaymentDate,
          ),
        )
        .filter((row): row is MilestoneClearingDurationRow => Boolean(row)),
    );
  }
  if (definition.name === "IR Preparation") {
    return files.flatMap((file) =>
      isIrClearingApplicable(file)
        ? rawSupplyOrders(file)
            .filter((order) => !isSupplyOrderCancelled(file, order))
            .flatMap((order) =>
              isYes(order.stageDelivery) && order.stageDeliveries?.length
                ? order.stageDeliveries
                : [order],
            )
            .map((delivery) =>
              getMilestoneClearingDurationRow(file, delivery.materialReceiptDate, delivery.irPreparationDate),
            )
            .filter((row): row is MilestoneClearingDurationRow => Boolean(row))
        : [],
    );
  }
  if (definition.name === "IR Receipt") {
    return files.flatMap((file) =>
      isIrClearingApplicable(file)
        ? rawSupplyOrders(file)
            .filter((order) => !isSupplyOrderCancelled(file, order))
            .flatMap((order) =>
              isYes(order.stageDelivery) && order.stageDeliveries?.length
                ? order.stageDeliveries
                : [order],
            )
            .map((delivery) =>
              getMilestoneClearingDurationRow(file, delivery.irPreparationDate, delivery.irReceiptDate),
            )
            .filter((row): row is MilestoneClearingDurationRow => Boolean(row))
        : [],
    );
  }
  if (definition.name === "Job Completion") {
    return files.flatMap((file) =>
      isJobCompletionWorkflow(file)
        ? effectivePaymentEntries([file])
            .filter(
              ({ file: entryFile, order }) =>
                !isAdvancePaymentClearingRow(order) && isPaymentOrderActive(entryFile, order),
            )
            .map(({ file: entryFile, order }) => {
              const commonStagePayment = isParentStagePaymentOrder(order);
              return getMilestoneClearingDurationRow(
                entryFile,
                commonStagePayment ? getParentStageDeliveryPeriodDate(order) : getDeliveryPeriodDate(order),
                commonStagePayment
                  ? getParentStagePaymentDate(order, "jobCompletionDate")
                  : order.jobCompletionDate,
              );
            })
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
    return files.flatMap((file) =>
      rawSupplyOrders(file)
        .map((order) =>
          getMilestoneClearingDurationRow(
            file,
            isYes(file.tcec) ? file.cncApprovalDate : order.financialSanctionDate,
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
          definition.getEndDate?.(file),
        ),
        definition.getEndDate?.(file),
      ),
    )
    .filter((row): row is MilestoneClearingDurationRow => Boolean(row));
}

function getReturnedBillClearingDurationRows(
  file: FileRecord,
  entry: Pick<SupplyOrderDetail, "billReturnCycles">,
) {
  const latest = latestBillReturnCycle(entry.billReturnCycles);
  if (!latest) return [];
  const row = getMilestoneClearingDurationRow(file, latest.returnedDate, latest.resubmittedDate);
  return row ? [row] : [];
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
  const supplyOrderIndex = milestoneClearingDefinitions.findIndex(
    (definition) => definition.name === "Supply Order",
  );
  const fileMilestones = milestoneClearingDefinitions.slice(
    0,
    supplyOrderIndex < 0 ? milestoneClearingDefinitions.length : supplyOrderIndex,
  );
  for (let candidateIndex = 0; candidateIndex < fileMilestones.length; candidateIndex++) {
    if (candidateIndex === index) continue;
    const candidate = fileMilestones[candidateIndex];
    if (!isMilestoneClearingDefinitionApplicable(file, candidate)) continue;
    const previousEndDate = candidate.getEndDate?.(file);
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
  if (isIrClearingApplicable(file)) {
    return isParentStagePaymentOrder(order)
      ? getParentStagePaymentDate(order, "irReceiptDate")
      : order.irReceiptDate;
  }
  if (isJobCompletionWorkflow(file)) {
    return isParentStagePaymentOrder(order)
      ? getParentStagePaymentDate(order, "jobCompletionDate")
      : order.jobCompletionDate;
  }
  if (
    isParentStagePaymentOrder(order) &&
    isContractFileType(file) &&
    !isYes(order.shortclosure)
  ) {
    return addDays(getParentStageDeliveryPeriodDate(order), 1);
  }
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
    if (isDeliveryFructified(file, order)) return;
    const month = getMonthKey(getDeliveryPeriodDate(order));
    if (!month) return;
    const current = rows.get(month) ?? { grossCount: 0, netCount: 0 };
    if (!isDateBeforeToday(getDeliveryPeriodDate(order))) {
      current.grossCount += 1;
    }
    if (isDateBeforeToday(getDeliveryPeriodDate(order))) {
      current.netCount += 1;
    }
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
    if (isYes(file.demandCancelled)) return [];
    const capital = getInrAmount(file.valueCapital, file) ?? 0;
    const revenue = getInrAmount(file.valueRevenue, file) ?? 0;
    return [{ capital, revenue }];
  });
}

function getSupplyOrderValueThresholds(
  files: FileRecord[],
  levels: AppSettings["valueThresholdLevels"],
) {
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
  const fileIds = new Map<string, Set<string>>();
  files.forEach((file) => {
    const pendingCount = getPaymentPendingRowCount(file);
    if (!pendingCount) return;
    const name = getAnalyticsName(file.division, "Unassigned");
    counts.set(name, (counts.get(name) ?? 0) + pendingCount);
    const ids = fileIds.get(name) ?? new Set<string>();
    ids.add(file.id);
    fileIds.set(name, ids);
  });
  return mapEntriesToSortedRows(counts, "count").map((row) => ({
    ...row,
    fileIds: [...(fileIds.get(row.name) ?? [])].sort().join(","),
  }));
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
    (entry) =>
      entry.pending &&
      !isYes(entry.order.noFurtherAction) &&
      (entry.kind === "supplementary" ||
        hasFilledString(entry.order.billPreparationDate) ||
        hasFilledString(entry.order.billSentForPaymentDate) ||
        hasBillReturnHistory(entry.order) ||
        hasPaymentDueCompletion(entry.file, entry.order)),
  ).length;
  const advancePendingCount = advancePaymentEntries([file]).filter(
    ({ file: entryFile, order }) =>
      isAdvancePaymentPending(order) &&
      isPaymentOrderActive(entryFile, order) &&
      !isYes(order.noFurtherAction),
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
    name: "GeM Undertaking",
    getEndDate: (file: FileRecord) => getGeMUndertakingEndDate(file),
    applies: (file: FileRecord) =>
      isYes(file.gem) &&
      (file.gemBiddingMode ?? "").trim().toLowerCase() !== "comparison",
  },
  {
    name: "RFP Vetting",
    getEndDate: (file: FileRecord) => file.rfpVettingApprovalDate,
    applies: (file: FileRecord) => isYes(file.rfpVetting),
  },
  {
    name: "Bidding",
    getEndDate: (file: FileRecord) => getMilestoneClearingBiddingEndDate(file),
    applies: (file: FileRecord) =>
      isBiddingApplicableForFile(file) &&
      (!isYes(file.tcec) || isYes(file.biddingStageOver)),
  },
  {
    name: "Non-TCEC Technical Evaluation",
    getEndDate: (file: FileRecord) => getNonTcecTechnicalEvaluationEndDate(file),
    applies: (file: FileRecord) =>
      !isYes(file.tcec) &&
      isBiddingApplicableForFile(file),
  },
  {
    name: "Post-TCEC",
    getStartDate: (file: FileRecord) => file.postTcecDate,
    getEndDate: (file: FileRecord) => file.postTcecMinutesDate,
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    name: "Refloat Post-TCEC",
    getStartDate: (file: FileRecord) => file.refloatPostTcecDate,
    getEndDate: (file: FileRecord) => file.refloatPostTcecMinutesDate,
    applies: (file: FileRecord) => isYes(file.tcec) && isYes(file.refloat),
  },
  {
    name: "CNC",
    getStartDate: (file: FileRecord) => file.postTcecMinutesDate,
    getEndDate: (file: FileRecord) => file.cncApprovalDate,
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    name: "Financial Sanction",
    getEndDate: () => undefined,
    applies: (file: FileRecord) => isYes(file.tcec),
  },
  {
    name: "Supply Order",
    getStartDate: (file: FileRecord) => file.cfaDate,
    getEndDate: getFirstSoDate,
  },
  {
    name: "Job Completion",
    applies: (file: FileRecord) => isJobCompletionWorkflow(file),
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
    name: "Payment cycle (ASL)",
    getStartDate: () => undefined,
    getEndDate: () => undefined,
  },
  {
    name: "Payment cycle (PCDA)",
    getStartDate: (file: FileRecord) => getEarliestSupplyOrderDate(file, "billSentForPaymentDate"),
    getEndDate: getFirstPaymentDate,
  },
  {
    name: "Payment (ASL + PCDA)",
    getStartDate: () => undefined,
    getEndDate: () => undefined,
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
  if (isBgMilestoneKey(normalizedMilestone)) return !isSupplyOrderCancelled(file, order);
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
      hasUnpaidSupplyOrderPayment(order) &&
      !isSupplyOrderCancelled(file, order) &&
      !isShortclosureNoFurtherAction(order),
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
      !isShortclosureNoFurtherAction(order) &&
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
      !isShortclosureNoFurtherAction(order) &&
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
    !isShortclosureNoFurtherAction(order) &&
    (normalized === "psb" || normalized === "psbpwb"
      ? hasFilledString(order.soDate)
      : isPwbDueForWorkflow(file, order))
  );
}

function isPwbDueForWorkflow(file: FileRecord, order: SupplyOrderDetail) {
  return isJobCompletionWorkflow(file)
    ? hasFilledString(order.jobCompletionDate)
    : hasFilledString(order.materialReceiptDate);
}

function isBgCurrentOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb" || normalized === "psbpwb") {
    return hasFilledString(order.soDate) && !isBgReceivedOrder(order, category);
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

function countBgToBeReturnedOrders(files: FileRecord[], category: string, offsetDays = 60) {
  return rawSupplyOrderEntries(files).filter(({ file, order }) =>
    isBgReturnDueOrder(file, order, category, offsetDays),
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

function isBgReturnDueOrder(
  file: FileRecord,
  order: SupplyOrderDetail,
  category: string,
  offsetDays = 60,
) {
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
      : isWarrantyBgReturnPurposeComplete(file, order, normalizedCategory, offsetDays))
  );
}

function isWarrantyBgReturnPurposeComplete(
  file: FileRecord,
  order: SupplyOrderDetail,
  category: string,
  offsetDays = 60,
) {
  if (category !== "pwb" && category !== "psbpwb") return false;
  if (!isBgCategoryApplicable(file, order, category)) return false;
  if (!hasFilledString(order.warrantyPeriodDate)) return false;
  return isDateBeforeToday(addDays(order.warrantyPeriodDate, offsetDays));
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
  const paymentStartDate = getPaymentWorkflowStartDate(file, order);
  return hasFilledString(paymentStartDate) && !isDateAfterToday(paymentStartDate);
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
      !isShortclosureNoFurtherAction(order),
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
      !isShortclosureNoFurtherAction(order),
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
      isPaymentOrderActive(file, order) &&
      !isShortclosureNoFurtherAction(order),
  ).length;
}

function countPaymentDueOrders(files: FileRecord[]) {
  return effectivePaymentEntries(files).filter(({ file, order }) =>
    isPaymentDueOrder(file, order) && !hasBillReturnHistory(order),
  ).length;
}

function countPaymentInProcessOrders(files: FileRecord[]) {
  return effectivePaymentEntries(files).filter(({ file, order }) =>
    isPaymentInProcessOrder(file, order) && !hasBillReturnHistory(order),
  ).length;
}

function countPaymentSubmittedOrders(files: FileRecord[]) {
  return effectivePaymentEntries(files).filter(({ file, order }) =>
    isPaymentSubmittedOrder(file, order) && !hasBillReturnHistory(order),
  ).length;
}

function countStatusPaymentReturnedBillsPending(files: FileRecord[]) {
  return effectivePaymentEntries(files).filter(
    ({ file, order }) =>
      isPaymentOrderActive(file, order) &&
      !isShortclosureNoFurtherAction(order) &&
      hasOpenBillReturn(order),
  ).length;
}

function countStatusPaymentReturnedBillsResubmitted(files: FileRecord[]) {
  return effectivePaymentEntries(files).filter(
    ({ file, order }) =>
      isPaymentOrderActive(file, order) &&
      hasCompletedBillReturn(order) &&
      !hasFilledString(order.paymentDate) &&
      !isShortclosureNoFurtherAction(order),
  ).length;
}

function isNormalPaymentOpenOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasPaymentWorkflowStarted(file, order) &&
    !hasFilledString(order.paymentDate) &&
    isPaymentOrderActive(file, order) &&
    !isShortclosureNoFurtherAction(order)
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
    ({ file, order }) =>
      isAdvancePaymentPending(order) &&
      isPaymentOrderActive(file, order) &&
      !isShortclosureNoFurtherAction(order),
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
  const rawOrders = rawSupplyOrders(file);
  if (rawOrders.length)
    return rawOrders
      .filter((order) => !isYes(order.soCancelled))
      .reduce((sum, order) => sum + (getInrAmount(order.soValueCapital, file) ?? 0), 0);
  return isYes(file.soCancelled) ? 0 : (getInrAmount(file.soValueCapital, file) ?? 0);
}

function getFileCommittedRevenueValue(file: FileRecord) {
  const rawOrders = rawSupplyOrders(file);
  if (rawOrders.length)
    return rawOrders
      .filter((order) => !isYes(order.soCancelled))
      .reduce((sum, order) => sum + (getInrAmount(order.soValueRevenue, file) ?? 0), 0);
  return isYes(file.soCancelled) ? 0 : (getInrAmount(file.soValueRevenue, file) ?? 0);
}

function getSupplyOrderTotalValue(file: FileRecord, order: SupplyOrderDetail) {
  return (
    (getInrAmount(order.soValueCapital, file) ?? 0) +
    (getInrAmount(order.soValueRevenue, file) ?? 0)
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
  const actualPayment = getInrAmount(order.actualPaymentCapital, file);
  if (actualPayment !== undefined) return actualPayment;
  const soValue = getInrAmount(order.soValueCapital, file) ?? 0;
  if (order.stageDeliveryLabel || !isYes(order.advancePayment)) return soValue;
  return Math.max(0, soValue - getAdvanceFinanceAllocationCapital(file, order));
}

function getFinancePaymentRevenue(file: FileRecord, order: SupplyOrderDetail) {
  if (isYes(order.shortclosure)) {
    return (
      getInrAmount(order.actualPaymentRevenue, file) ??
      getInrAmount(order.billAmountRevenue, file) ??
      0
    );
  }
  const actualPayment = getInrAmount(order.actualPaymentRevenue, file);
  if (actualPayment !== undefined) return actualPayment;
  const soValue = getInrAmount(order.soValueRevenue, file) ?? 0;
  if (order.stageDeliveryLabel || !isYes(order.advancePayment)) return soValue;
  return Math.max(0, soValue - getAdvanceFinanceAllocationRevenue(file, order));
}

function getAdvanceFinanceAllocationCapital(file: FileRecord, order: SupplyOrderDetail) {
  return (
    getInrAmount(order.advancePaymentDetail?.stageAmountCapital, file) ??
    getInrAmount(order.advancePaymentDetail?.actualPaymentCapital, file) ??
    0
  );
}

function getAdvanceFinanceAllocationRevenue(file: FileRecord, order: SupplyOrderDetail) {
  return (
    getInrAmount(order.advancePaymentDetail?.stageAmountRevenue, file) ??
    getInrAmount(order.advancePaymentDetail?.actualPaymentRevenue, file) ??
    0
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

function isFinanceLiabilityClosedByNoFurtherAction(order: SupplyOrderDetail, asOfDate: string) {
  return (
    isYes(order.shortclosure) &&
    isYes(order.noFurtherAction) &&
    (!order.noFurtherActionDate || order.noFurtherActionDate <= asOfDate)
  );
}

function isUnpaidAdvanceIncludedInShortclosedBalance(order: SupplyOrderDetail) {
  return (
    isYes(order.shortclosure) &&
    !hasFilledString(order.advancePaymentDetail?.paymentDate) &&
    !isYes(order.noFurtherAction)
  );
}

function isUnpaidAdvanceClearedByNoFurtherAction(order: SupplyOrderDetail, asOfDate?: string) {
  return (
    isYes(order.shortclosure) &&
    isYes(order.noFurtherAction) &&
    (!asOfDate || !order.noFurtherActionDate || order.noFurtherActionDate <= asOfDate) &&
    !hasFilledString(order.advancePaymentDetail?.paymentDate)
  );
}

function shouldSkipSeparateAdvanceCarryForward(order: SupplyOrderDetail, asOfDate?: string) {
  return (
    isUnpaidAdvanceIncludedInShortclosedBalance(order) ||
    isUnpaidAdvanceClearedByNoFurtherAction(order, asOfDate)
  );
}

function getFinancePaymentLiabilityEntries(
  files: FileRecord[],
  asOfDate?: string,
): FinancePaymentLiabilityEntry[] {
  return files.flatMap((file) => {
    if (isYes(file.demandCancelled)) return [];
    return rawSupplyOrders(file).flatMap((baseOrder) => {
      if (isSupplyOrderCancelled(file, baseOrder)) return [];
      const paymentOrders = normalizedFilePaymentOrders({ ...file, supplyOrders: [baseOrder] })
        .filter((order) => order.stageDeliveryLabel !== "Advance Payment")
        .filter((order) => isPaymentOrderActive(file, order));
      const noFurtherActionEffective =
        isYes(baseOrder.shortclosure) &&
        isYes(baseOrder.noFurtherAction) &&
        (!asOfDate || !baseOrder.noFurtherActionDate || baseOrder.noFurtherActionDate <= asOfDate);
      const mainEntries = paymentOrders
        .filter((order) =>
          noFurtherActionEffective
            ? hasFilledString(order.paymentDate) &&
              (!asOfDate || order.paymentDate! <= asOfDate)
            : isYes(baseOrder.shortclosure)
              ? hasFilledString(order.paymentDate) &&
                (!asOfDate || order.paymentDate! <= asOfDate)
              : isFinanceMainPaymentLiabilityRelevant(file, order),
        )
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
      if (isYes(baseOrder.shortclosure) && !noFurtherActionEffective) {
        const paidCapital = paymentOrders.reduce(
          (total, order) =>
            total + (hasFilledString(order.paymentDate) ? getFinancePaymentCapital(file, order) : 0),
          0,
        );
        const paidRevenue = paymentOrders.reduce(
          (total, order) =>
            total + (hasFilledString(order.paymentDate) ? getFinancePaymentRevenue(file, order) : 0),
          0,
        );
        const advance = baseOrder.advancePaymentDetail;
        const advancePaid = isYes(baseOrder.advancePayment) && hasFilledString(advance?.paymentDate);
        const remainingCapital = Math.max(
          0,
          (getInrAmount(baseOrder.soValueCapital, file) ?? 0) - paidCapital -
            (advancePaid ? getAdvanceFinanceAllocationCapital(file, baseOrder) : 0),
        );
        const remainingRevenue = Math.max(
          0,
          (getInrAmount(baseOrder.soValueRevenue, file) ?? 0) - paidRevenue -
            (advancePaid ? getAdvanceFinanceAllocationRevenue(file, baseOrder) : 0),
        );
        if (remainingCapital + remainingRevenue > 0) {
          mainEntries.push({
            kind: "main",
            file,
            order: baseOrder,
            sourceDate: baseOrder.soDate,
            paymentDate: undefined,
            capital: remainingCapital,
            revenue: remainingRevenue,
            pending: paymentOrders.some((order) => hasPaymentWorkflowStarted(file, order)),
          });
        }
      }
      const supplementaryEntries = getSupplementaryBills(baseOrder)
        .filter((bill) => isSupplementaryPaymentRelevant(bill))
        .filter(
          (bill) =>
            !noFurtherActionEffective ||
            (hasFilledString(bill.paymentDate) && (!asOfDate || bill.paymentDate! <= asOfDate)),
        )
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

function getNonTcecTechnicalEvaluationDurationRows(file: FileRecord) {
  const rows: MilestoneClearingDurationRow[] = [];
  const firstCycleEndDate = isYes(file.refloat)
    ? file.refloatRecommendationDate
    : getEarliestSupplyOrderDate(file, "financialSanctionDate");
  const firstCycleRow = isYes(file.biddingStageOver)
    ? getMilestoneClearingDurationRow(file, file.bidOpeningDate, firstCycleEndDate)
    : undefined;
  if (firstCycleRow) rows.push(firstCycleRow);

  if (
    isYes(file.refloat) &&
    hasFilledString(file.refloatBidOpeningDate) &&
    isYes(file.refloatBiddingStageOver)
  ) {
    const secondCycleRow = getMilestoneClearingDurationRow(
      file,
      file.refloatBidOpeningDate,
      getEarliestSupplyOrderDate(file, "financialSanctionDate"),
    );
    if (secondCycleRow) rows.push(secondCycleRow);
  }
  return rows;
}

function getNonTcecTechnicalEvaluationEndDate(file: FileRecord) {
  if (isYes(file.refloat) && hasFilledString(file.refloatBidOpeningDate)) {
    return getEarliestSupplyOrderDate(file, "financialSanctionDate");
  }
  if (isYes(file.refloat)) return file.refloatRecommendationDate;
  return getEarliestSupplyOrderDate(file, "financialSanctionDate");
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
    return isYes(file.refloat) && isRefloatBiddingStageComplete(file);
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
  const bidDate = isYes(file.refloat) ? file.refloatBiddingDate : file.bidDate;
  const bidOpeningDate = isYes(file.refloat) ? file.refloatBidOpeningDate : file.bidOpeningDate;
  return (
    isBiddingApplicableForFile(file) &&
    hasFilledString(bidDate) &&
    hasFilledString(bidOpeningDate) &&
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
    !isRefloatBiddingStageComplete(file)
  );
}

function isRefloatBiddingStageComplete(file: FileRecord) {
  return isYes(isYes(file.tcec) ? file.biddingStageOver : file.refloatBiddingStageOver);
}

function getEffectiveBidDate(file: FileRecord) {
  return isYes(file.refloat) ? file.refloatBiddingDate : file.bidDate;
}

function getEffectiveBidOpeningDate(file: FileRecord) {
  return isYes(file.refloat) ? file.refloatBidOpeningDate : file.bidOpeningDate;
}

function getRfpVettingStartDate(file: FileRecord) {
  const gemUndertakingApplies =
    isYes(file.gem) &&
    (file.gemBiddingMode ?? "").trim().toLowerCase() !== "comparison" &&
    hasFilledString(file.cfaDate);
  return gemUndertakingApplies ? file.gemUndertakingDate : file.cfaDate;
}

function getGeMUndertakingEndDate(file: FileRecord) {
  if (
    !isYes(file.tcec) &&
    isYes(file.refloat) &&
    hasFilledString(file.refloatRecommendationDate) &&
    hasFilledString(file.refloatGemUndertakingDate)
  ) {
    return file.refloatGemUndertakingDate;
  }
  return file.gemUndertakingDate;
}

function getMilestoneClearingBiddingStartDate(file: FileRecord) {
  if (isYes(file.refloat) && isYes(file.tcec)) {
    return hasFilledString(file.postTcecMinutesDate) ? file.postTcecMinutesDate : undefined;
  }
  if (!isYes(file.tcec)) return file.cfaDate;
  if (!hasFilledString(file.cfaDate)) return undefined;
  const gemUndertakingApplies =
    isYes(file.gem) &&
    (file.gemBiddingMode ?? "").trim().toLowerCase() !== "comparison";
  if (gemUndertakingApplies && !hasFilledString(file.gemUndertakingDate)) return undefined;
  if (isYes(file.rfpVetting) && !hasFilledString(file.rfpVettingApprovalDate)) return undefined;
  const candidates = [
    file.cfaDate,
    gemUndertakingApplies ? file.gemUndertakingDate : undefined,
    isYes(file.rfpVetting) ? file.rfpVettingApprovalDate : undefined,
  ].filter((value): value is string => hasFilledString(value));
  return candidates.sort(
    (a, b) => (parseLocalDateTime(b) ?? 0) - (parseLocalDateTime(a) ?? 0),
  )[0];
}

function getMilestoneClearingBiddingEndDate(file: FileRecord) {
  if (!isYes(file.tcec)) {
    return isYes(file.refloat) && hasFilledString(file.refloatBiddingDate)
      ? file.refloatBiddingDate
      : file.bidDate;
  }
  return isYes(file.refloat) ? file.refloatPostTcecDate : file.postTcecDate;
}

function getMilestoneClearingBiddingDurationRows(file: FileRecord) {
  if (!isBiddingApplicableForFile(file)) return [];
  if (!isYes(file.tcec)) {
    const rows: MilestoneClearingDurationRow[] = [];
    const normalRow = getMilestoneClearingDurationRow(file, file.cfaDate, file.bidDate);
    if (normalRow) rows.push(normalRow);
    if (
      isYes(file.refloat) &&
      isYes(file.biddingStageOver) &&
      hasFilledString(file.refloatRecommendationDate)
    ) {
      const refloatRow = getMilestoneClearingDurationRow(
        file,
        file.refloatRecommendationDate,
        file.refloatBiddingDate,
      );
      if (refloatRow) rows.push(refloatRow);
    }
    return rows;
  }
  if (!isYes(file.biddingStageOver)) return [];
  const row = getMilestoneClearingDurationRow(
    file,
    getMilestoneClearingBiddingStartDate(file),
    getMilestoneClearingBiddingEndDate(file),
  );
  return row ? [row] : [];
}

function isBidOverdue(file: FileRecord) {
  return (
    isBiddingApplicableForFile(file) &&
    isNo(file.bidOpened) &&
    isDateBeforeToday(getEffectiveBidOpeningDate(file))
  );
}

function isRefloatBidOverdue(file: FileRecord) {
  return isNo(file.bidOpened) && isDateBeforeToday(file.refloatBidOpeningDate);
}

function isLiveSupplyOrder(file: FileRecord) {
  return rawSupplyOrders(file).some(
    (order) =>
      isSupplyOrderTabComplete(file, order) &&
      hasUnpaidSupplyOrderPayment(order) &&
      !isShortclosureNoFurtherAction(order) &&
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
    isYes(order.shortclosure) ||
    isShortclosureNoFurtherAction(order)
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
    !isYes(order.shortclosure) &&
    !isShortclosureNoFurtherAction(order)
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
    !isShortclosureNoFurtherAction(order) &&
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
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && !isShortclosureNoFurtherAction(order),
    )
  );
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
  if (isContractFileType(file)) {
    if (isYes(order.shortclosure)) {
      return isParentStagePaymentOrder(order)
        ? getParentStagePaymentDate(order, "jobCompletionDate")
        : order.jobCompletionDate;
    }
    return addDays(
      isParentStagePaymentOrder(order) ? getParentStageDeliveryPeriodDate(order) : getDeliveryPeriodDate(order),
      1,
    );
  }
  if (isDeliveryInspectionApplicable(file)) {
    if (isParentStagePaymentOrder(order)) {
      return getParentStagePaymentDate(order, "materialReceiptDate");
    }
    return order.materialReceiptDate;
  }
  if (
    !isContractFileType(file) &&
    isNo(file.ir) &&
    isParentStagePaymentOrder(order)
  ) {
    return getParentStagePaymentDate(order, "jobCompletionDate");
  }
  return getNonInspectionPaymentDueDate(file, order);
}

function getNonInspectionPaymentDueDate(file: FileRecord, order: SupplyOrderDetail) {
  if (!isContractFileType(file) && isNo(file.ir)) return order.jobCompletionDate;
  return addDays(getDeliveryPeriodDate(order), 1);
}

function getParentStageDeliveryPeriodDate(order: SupplyOrderDetail) {
  if (!isParentStagePaymentOrder(order) || !order.stageDeliveries?.length) return undefined;
  const dates = order.stageDeliveries.map((stage) => stage.revisedDp || stage.dpDate || "");
  if (dates.some((date) => !hasFilledString(date))) return undefined;
  return dates.sort((a, b) => a.localeCompare(b)).at(-1);
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

export function getFinanceSnapshotDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
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
