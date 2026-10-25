import type { FileRecord, SupplementaryBillDetail, SupplyOrderDetail } from "../types.js";
import {
  advancePaymentEntries,
  areRequiredAdvanceGuaranteesReceived,
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
  getParentStagePaymentDate,
  getPaymentTimingTriggerDate,
  isAdvancePaymentCompleted,
  isAdvancePaymentPaid,
  isAdvancePaymentPending,
  isParentStagePaymentOrder,
  isSupplyOrderMilestoneCurrent as isCanonicalSupplyOrderMilestoneCurrent,
  isExpiredDeliveryPeriodEntry,
  isExtendedDeliveryPeriodEntry,
  isValidDeliveryPeriodEntry,
  rawSupplyOrders as normalizedRawSupplyOrders,
} from "./effective-deliveries.js";
import {
  isBiddingApplicableForFile,
  isContractFileType,
  isDeliveryInspectionApplicableByGroup,
} from "./file-type-groups.js";
import {
  getReturnedBillCashOutgoEventDate,
  hasBillReturnHistory,
  hasCompletedBillReturn,
  hasOpenBillReturn,
  hasReturnedBill,
  hasReturnedBillPaid,
  latestBillReturnCycle,
  normalizeBillReturnCycles,
} from "./refloat-returned-bill.js";

const biddingNonRfpDelayMilestoneKey = "biddingNonRfp";
const biddingNonRfpDelayMilestoneLabel = "Bidding";
const biddingRfpDelayMilestoneKey = "biddingRfp";
const biddingRfpDelayMilestoneLabel = "Bidding";
const gemUndertakingDelayMilestoneKey = "gemUndertaking";
const gemUndertakingDelayMilestoneLabel = "GeM Undertaking";
const nonTcecTechnicalEvaluationDelayKey = "nonTcecTechnicalEvaluation";
const nonTcecTechnicalEvaluationDelayLabel = "Non-TCEC Technical Evaluation";
const billReturnedDelayMilestoneKey = "billReturnedForCorrection";
const supplementaryBillReturnedDelayMilestoneKey = "supplementaryBillReturnedForCorrection";
const supplementaryBillReturnedDelayMilestoneLabel = "Supplementary bill returned for correction";

export type CashOutgoRow = {
  monthKey: string;
  month: string;
  capital: number;
  revenue: number;
  total: number;
};

export type DelayStatusRow = {
  fileId: string;
  fileRef: string;
  division: string;
  indentor: string;
  description: string;
  milestoneKey: string;
  milestone: string;
  stageStartDate: string | undefined;
  daysInStage: number;
  cumulativeDelayDays: number | null;
  lastFilledDate: string;
  focusSection?: string;
  focusTarget?: string;
  biddingBreakupKey?: string;
};

export type BgReceiptDelayRow = {
  thresholdDays: number;
  nextThresholdDays?: number;
  label: string;
  psb: number;
  pwb: number;
  psbPwb: number;
  count: number;
};

export type WarrantyBgMismatchRow = {
  bufferDays: number;
  label: string;
  pwb: number;
  psbPwb: number;
  count: number;
};

export type BgStatusSummaryAuditCount = {
  milestone: string;
  stage: string;
  supplyOrderCaseCount: number;
  uniqueFileCount: number;
};

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

export type StatusSummaryTableRow = {
  milestone: string;
  counts: Partial<Record<StatusSummaryDisplayColumn, number | string>>;
};

export type StatusSummaryTableGroup = {
  key: string;
  title: string;
  columns: StatusSummaryDisplayColumn[];
  rows: StatusSummaryTableRow[];
};

const commonStatusColumns = ["Total", "In process", "Pending", "Completed"] as const;
const fileClosedMilestone = "File Closed";

const statusSummaryColumns = [
  "Total",
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
  "Bills returned",
  "Return pending",
  "Submitted total",
  "Returned total",
  "Submitted",
  "Returned",
  "Resubmitted total",
  "Resubmitted and Unpaid",
  "Paid",
  "Returned paid",
  "Normal paid",
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
  },
  {
    key: "psbPwb",
    label: "PSB+PWB",
    completedLabel: "Received",
    totalLabel: "Total files",
    current: "combinedBgReceivedDate",
  },
  {
    key: "irPreparation",
    label: "IR Preparation",
    completedLabel: "Completed",
    totalLabel: "Total files",
    current: "irPreparationDate",
    applies: (file: FileRecord) => isYes(file.ir),
  },
  {
    key: "irReceipt",
    label: "IR Receipt",
    completedLabel: "Completed",
    totalLabel: "Total files",
    current: "irReceiptDate",
    applies: (file: FileRecord) => isYes(file.ir),
  },
  {
    key: "billPreparation",
    label: "Bill preparation",
    completedLabel: "Completed",
    totalLabel: "Total files",
    current: "billPreparationDate",
  },
  {
    key: "billSentForPayment",
    label: "Bill sent for payment",
    completedLabel: "Completed",
    totalLabel: "Total files",
    current: "billSentForPaymentDate",
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
  "Bill returned for correction",
  "Payment",
];

function isSupplyOrderDrivenMilestoneName(name: string) {
  return supplyOrderMilestoneNames.some(
    (milestone) => normalizeMilestoneName(milestone) === normalizeMilestoneName(name),
  );
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

export function buildReportsSummary({
  files,
  pendingBillingFiles,
  division,
  selectedYear,
  delayDays,
  delayMilestone,
  expectedCashOutgoDays = 0,
  historicalFromDate,
  historicalToDate,
  cashOutgoAsOfDate,
  cashOutgoPaymentCutoffDate,
  bgReceiptDelayDays = [10, 30, 60],
  bgReturnOffsetDays = 60,
}: {
  files: FileRecord[];
  pendingBillingFiles?: FileRecord[];
  division: string;
  selectedYear?: string;
  delayDays: number;
  delayMilestone: string;
  expectedCashOutgoDays?: number;
  historicalFromDate?: string;
  historicalToDate?: string;
  cashOutgoAsOfDate?: string;
  cashOutgoPaymentCutoffDate?: string;
  bgReceiptDelayDays?: number[];
  bgReturnOffsetDays?: number;
}) {
  const divisionFiles =
    division === "all" ? files : files.filter((file) => file.division === division);
  const reportFiles = divisionFiles.filter((file) => !isCancelledFile(file));
  const nonDemandCancelledReportFiles = divisionFiles.filter((file) => !isDemandCancelled(file));
  const pendingBillingDivisionFiles =
    division === "all"
      ? (pendingBillingFiles ?? files)
      : (pendingBillingFiles ?? files).filter((file) => file.division === division);
  const pendingBillingReportFiles = pendingBillingDivisionFiles.filter(
    (file) => !isCancelledFile(file),
  );
  const activeStatusFiles = reportFiles;
  const delayRows = getDelayStatusRows(activeStatusFiles, delayDays, delayMilestone);
  const historicalRange =
    historicalFromDate && historicalToDate && historicalFromDate <= historicalToDate
      ? { fromDate: historicalFromDate, toDate: historicalToDate }
      : undefined;

  return {
    expectedCashOutgoDays,
    activeDivision: division,
    reportFileCount: reportFiles.length,
    statusSummaryGroups: getStatusSummaryTableGroups(
      activeStatusFiles,
      bgReturnOffsetDays,
      nonDemandCancelledReportFiles,
    ),
    expectedCashOutgoDpRows: getExpectedCashOutgoByDpRows(
      reportFiles,
      expectedCashOutgoDays,
      cashOutgoAsOfDate,
    ),
    expectedCashOutgoReceiptRows: getExpectedCashOutgoByReceiptRows(
      reportFiles,
      expectedCashOutgoDays,
      cashOutgoAsOfDate,
    ),
    expectedCashOutgoReceiptPendingBillRows: getExpectedCashOutgoByReceiptPendingBillRows(
      pendingBillingReportFiles,
      expectedCashOutgoDays,
      historicalRange,
    ),
    expectedCashOutgoBillPreparationRows: getExpectedCashOutgoByBillPreparationRows(
      pendingBillingReportFiles,
      historicalRange,
      cashOutgoAsOfDate,
    ),
    billSentForPaymentRows: getBillSentForPaymentRows(
      pendingBillingReportFiles,
      historicalRange,
      cashOutgoAsOfDate,
    ),
    actualCashOutgoRows: getActualCashOutgoRows(
      reportFiles,
      historicalRange,
      cashOutgoPaymentCutoffDate,
    ),
    supplementaryBillSentForPaymentRows: getSupplementaryBillSentForPaymentRows(
      pendingBillingReportFiles,
      historicalRange,
      cashOutgoAsOfDate,
    ),
    supplementaryActualCashOutgoRows: getSupplementaryActualCashOutgoRows(
      reportFiles,
      historicalRange,
      cashOutgoPaymentCutoffDate,
    ),
    pendingReturnedBillRows: getReturnedBillCashOutgoRows(
      pendingBillingReportFiles,
      "pendingReturnedBills",
      historicalRange,
    ),
    returnedBillResubmittedRows: getReturnedBillCashOutgoRows(
      pendingBillingReportFiles,
      "returnedBillsResubmitted",
      historicalRange,
    ),
    returnedBillPaidRows: getReturnedBillCashOutgoRows(
      reportFiles,
      "returnedBillsPaid",
      historicalRange,
      cashOutgoPaymentCutoffDate,
    ),
    supplementaryPendingReturnedBillRows: getSupplementaryReturnedBillCashOutgoRows(
      pendingBillingReportFiles,
      "supplementaryPendingReturnedBills",
      historicalRange,
    ),
    supplementaryReturnedBillResubmittedRows: getSupplementaryReturnedBillCashOutgoRows(
      pendingBillingReportFiles,
      "supplementaryReturnedBillsResubmitted",
      historicalRange,
    ),
    supplementaryReturnedBillPaidRows: getSupplementaryReturnedBillCashOutgoRows(
      reportFiles,
      "supplementaryReturnedBillsPaid",
      historicalRange,
      cashOutgoPaymentCutoffDate,
    ),
    monthlyFileInflow: getMonthlyFileInflow(nonDemandCancelledReportFiles, selectedYear),
    monthWiseSupplyOrder: getMonthWiseSupplyOrder(nonDemandCancelledReportFiles, selectedYear),
    dailyFileInflow: getDailyFileInflow(nonDemandCancelledReportFiles, selectedYear),
    dailySupplyOrder: getDailySupplyOrder(nonDemandCancelledReportFiles, selectedYear),
    dailyDeliverySchedule: getDailyDeliverySchedule(nonDemandCancelledReportFiles, selectedYear),
    dailyBgExpiry: getDailyBgExpiry(nonDemandCancelledReportFiles, selectedYear),
    dailyPaymentDue: getDailyPaymentDue(
      nonDemandCancelledReportFiles,
      selectedYear,
      expectedCashOutgoDays,
    ),
    dailyPaymentCompleted: getDailyPaymentCompleted(nonDemandCancelledReportFiles, selectedYear),
    dailyCompletedDeliveries: getDailyCompletedDeliveries(nonDemandCancelledReportFiles, selectedYear),
    monthWiseDeliverySchedule: getMonthWiseDeliverySchedule(
      nonDemandCancelledReportFiles,
      selectedYear,
    ),
    monthWiseCompletedDeliveries: getMonthWiseCompletedDeliveries(
      nonDemandCancelledReportFiles,
      selectedYear,
    ),
    monthWiseBgExpiry: getMonthWiseBgExpiry(divisionFiles, selectedYear),
    preBidMeetingRows: getPreBidMeetingRows(divisionFiles, selectedYear),
    preBidMeetingDailyRows: getPreBidMeetingDailyRows(divisionFiles, selectedYear),
    bgReceiptDelayRows: getBgReceiptDelayRows(nonDemandCancelledReportFiles, bgReceiptDelayDays),
    warrantyBgMismatchRows: getWarrantyBgMismatchRows(
      nonDemandCancelledReportFiles,
      bgReturnOffsetDays,
    ),
    delayRows,
    delaySummary: getDelayStatusSummary(delayRows, delayMilestone),
    delayMilestoneOptions,
  };
}

function getPreBidMeetingRows(files: FileRecord[], selectedYear?: string) {
  const rows = new Map<
    string,
    {
      preBidDue: number;
      preBidCompleted: number;
      refloatPreBidDue: number;
      refloatPreBidCompleted: number;
      count: number;
    }
  >();
  const activityRange = getActivityYearDateRange(selectedYear);
  const add = (
    date: string | undefined,
    key: "preBidDue" | "preBidCompleted" | "refloatPreBidDue" | "refloatPreBidCompleted",
  ) => {
    if (activityRange && !isDateInRange(date, activityRange)) return;
    const month = getMonthKey(date);
    if (!month) return;
    const current = rows.get(month) ?? {
      preBidDue: 0,
      preBidCompleted: 0,
      refloatPreBidDue: 0,
      refloatPreBidCompleted: 0,
      count: 0,
    };
    current[key] += 1;
    current.count += 1;
    rows.set(month, current);
  };
  files.forEach((file) => {
    if (isDemandCancelled(file)) return;
    if (!isBiddingApplicableForFile(file)) return;
    if (isYes(file.preBidMeeting) && hasFilledString(file.preBidMeetingDate)) {
      add(
        file.preBidMeetingDate,
        isDateBeforeToday(file.preBidMeetingDate) ? "preBidCompleted" : "preBidDue",
      );
    }
    if (
      isYes(file.refloat) &&
      isYes(file.refloatPreBidMeeting) &&
      hasFilledString(file.refloatPreBidMeetingDate)
    ) {
      add(
        file.refloatPreBidMeetingDate,
        isDateBeforeToday(file.refloatPreBidMeetingDate)
          ? "refloatPreBidCompleted"
          : "refloatPreBidDue",
      );
    }
  });
  return Array.from(rows.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, counts]) => ({ name, monthKey: name, ...counts }));
}

function getPreBidMeetingDailyRows(files: FileRecord[], selectedYear?: string) {
  const rows = new Map<string, {
    preBidDue: number;
    preBidCompleted: number;
    refloatPreBidDue: number;
    refloatPreBidCompleted: number;
    count: number;
  }>();
  const activityRange = getActivityYearDateRange(selectedYear);
  const add = (
    date: string | undefined,
    key: "preBidDue" | "preBidCompleted" | "refloatPreBidDue" | "refloatPreBidCompleted",
  ) => {
    if (!hasDate(date) || (activityRange && !isDateInRange(date, activityRange))) return;
    const current = rows.get(date!) ?? {
      preBidDue: 0,
      preBidCompleted: 0,
      refloatPreBidDue: 0,
      refloatPreBidCompleted: 0,
      count: 0,
    };
    current[key] += 1;
    current.count += 1;
    rows.set(date!, current);
  };
  files.forEach((file) => {
    if (isDemandCancelled(file) || !isBiddingApplicableForFile(file)) return;
    if (isYes(file.preBidMeeting) && hasFilledString(file.preBidMeetingDate)) {
      add(file.preBidMeetingDate, isDateBeforeToday(file.preBidMeetingDate) ? "preBidCompleted" : "preBidDue");
    }
    if (isYes(file.refloat) && isYes(file.refloatPreBidMeeting) && hasFilledString(file.refloatPreBidMeetingDate)) {
      add(
        file.refloatPreBidMeetingDate,
        isDateBeforeToday(file.refloatPreBidMeetingDate)
          ? "refloatPreBidCompleted"
          : "refloatPreBidDue",
      );
    }
  });
  return Array.from(rows.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, monthKey: date.slice(0, 7), ...counts }));
}

function getExpectedCashOutgoByDpRows(
  files: FileRecord[],
  offsetDays = 0,
  asOfDate?: string,
): CashOutgoRow[] {
  const totals = new Map<string, CashOutgoRow>();

  files.forEach((file) => {
    if (isDemandCancelled(file)) return;
    fileSupplyOrders(file).forEach((order) => {
      const deliveryPeriodDate = getDeliveryPeriodDate(order);
      if (
        !hasFilledString(deliveryPeriodDate) ||
        !isPaymentOrderActive(file, order) ||
        isShortclosureNoFurtherAction(order)
      ) {
        return;
      }
      if (!isExpectedDpCashOutgoPending(file, order, asOfDate)) return;
      const cashOutgoDate = addDays(deliveryPeriodDate, offsetDays + 1);
      if (!cashOutgoDate) return;

      addCashOutgoTotal(totals, cashOutgoDate, file, getDpForecastOrder(order));
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getMonthlyFileInflow(files: FileRecord[], selectedYear?: string) {
  const counts = new Map<string, number>();
  const activityRange = getActivityYearDateRange(selectedYear);
  files.forEach((file) => {
    if (activityRange && !isDateInRange(file.receivedDate, activityRange)) return;
    const month = getMonthKey(file.receivedDate);
    if (!month) return;
    counts.set(month, (counts.get(month) ?? 0) + 1);
  });
  return monthCountRows(counts);
}

function getDailyFileInflow(files: FileRecord[], selectedYear?: string) {
  const counts = new Map<string, number>();
  const activityRange = getActivityYearDateRange(selectedYear);
  files.forEach((file) => {
    const date = file.receivedDate;
    if (!hasDate(date) || (activityRange && !isDateInRange(date, activityRange))) return;
    counts.set(date!, (counts.get(date!) ?? 0) + 1);
  });
  return dailyCountRows(counts);
}

function getMonthWiseSupplyOrder(files: FileRecord[], selectedYear?: string) {
  const counts = new Map<string, { supplyOrders: number; fileIds: Set<string> }>();
  const fiscalYearFiles = new Map<string, Set<string>>();
  const activityRange = getActivityYearDateRange(selectedYear);
  files.forEach((file) => {
    normalizedRawSupplyOrders(file).forEach((order) => {
      if (activityRange && !isDateInRange(order.soDate, activityRange)) return;
      const month = getMonthKey(order.soDate);
      if (!month) return;
      const current = counts.get(month) ?? { supplyOrders: 0, fileIds: new Set<string>() };
      current.supplyOrders += 1;
      current.fileIds.add(file.id);
      counts.set(month, current);
      const [calendarYear, calendarMonth] = month.split("-").map(Number);
      const fiscalYearKey = String(calendarMonth >= 4 ? calendarYear : calendarYear - 1);
      const yearFiles = fiscalYearFiles.get(fiscalYearKey) ?? new Set<string>();
      yearFiles.add(file.id);
      fiscalYearFiles.set(fiscalYearKey, yearFiles);
    });
  });
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({
      name,
      monthKey: name,
      count: value.supplyOrders,
      fileCount: value.fileIds.size,
      fiscalYearFileCount: (fiscalYearFiles.get(
        String(Number(name.slice(5, 7)) >= 4 ? Number(name.slice(0, 4)) : Number(name.slice(0, 4)) - 1),
      ) ?? new Set()).size,
    }));
}

function getDailySupplyOrder(files: FileRecord[], selectedYear?: string) {
  const counts = new Map<string, { supplyOrders: number; fileIds: Set<string> }>();
  const activityRange = getActivityYearDateRange(selectedYear);
  files.forEach((file) => {
    normalizedRawSupplyOrders(file).forEach((order) => {
      const date = order.soDate;
      if (!hasDate(date) || (activityRange && !isDateInRange(date, activityRange))) return;
      const current = counts.get(date!) ?? { supplyOrders: 0, fileIds: new Set<string>() };
      current.supplyOrders += 1;
      current.fileIds.add(file.id);
      counts.set(date!, current);
    });
  });
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      date,
      monthKey: date.slice(0, 7),
      count: value.supplyOrders,
      fileCount: value.fileIds.size,
    }));
}

function getMonthWiseDeliverySchedule(files: FileRecord[], selectedYear?: string) {
  const rows = new Map<string, { grossCount: number; netCount: number; completedCount: number }>();
  const activityRange = getActivityYearDateRange(selectedYear);
  effectiveSupplyOrderEntries(files).forEach(({ file, order }) => {
    if (isDemandCancelled(file) || isSupplyOrderCancelled(file, order)) return;
    const deliveryPeriodDate = getDeliveryPeriodDate(order);
    if (!isDeliveryFructified(file, order) && (!activityRange || isDateInRange(deliveryPeriodDate, activityRange))) {
      const month = getMonthKey(deliveryPeriodDate);
      if (month) {
        const current = rows.get(month) ?? { grossCount: 0, netCount: 0, completedCount: 0 };
        if (!isDateBeforeToday(deliveryPeriodDate)) current.grossCount += 1;
        else current.netCount += 1;
        rows.set(month, current);
      }
    }

    const completionDate = getDeliveryCompletionScheduleDate(file, order);
    const completionMonth = getMonthKey(completionDate);
    if (completionMonth && (!activityRange || isDateInRange(completionDate, activityRange))) {
      const current = rows.get(completionMonth) ?? { grossCount: 0, netCount: 0, completedCount: 0 };
      current.completedCount += 1;
      rows.set(completionMonth, current);
    }
  });
  return Array.from(rows.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, counts]) => ({ name, monthKey: name, ...counts }));
}

function getDailyDeliverySchedule(files: FileRecord[], selectedYear?: string) {
  const rows = new Map<string, { grossCount: number; netCount: number; completedCount: number }>();
  const activityRange = getActivityYearDateRange(selectedYear);
  effectiveSupplyOrderEntries(files).forEach(({ file, order }) => {
    if (isDemandCancelled(file) || isSupplyOrderCancelled(file, order)) return;
    const deliveryPeriodDate = getDeliveryPeriodDate(order);
    if (!isDeliveryFructified(file, order) && hasDate(deliveryPeriodDate) && (!activityRange || isDateInRange(deliveryPeriodDate, activityRange))) {
      const current = rows.get(deliveryPeriodDate!) ?? { grossCount: 0, netCount: 0, completedCount: 0 };
      if (!isDateBeforeToday(deliveryPeriodDate)) current.grossCount += 1;
      else current.netCount += 1;
      rows.set(deliveryPeriodDate!, current);
    }

    const completionDate = getDeliveryCompletionScheduleDate(file, order);
    if (hasDate(completionDate) && (!activityRange || isDateInRange(completionDate, activityRange))) {
      const current = rows.get(completionDate!) ?? { grossCount: 0, netCount: 0, completedCount: 0 };
      current.completedCount += 1;
      rows.set(completionDate!, current);
    }
  });
  return Array.from(rows.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, monthKey: date.slice(0, 7), ...counts }));
}

function getMonthWiseCompletedDeliveries(files: FileRecord[], selectedYear?: string) {
  const counts = new Map<string, number>();
  const activityRange = getActivityYearDateRange(selectedYear);
  effectiveSupplyOrderEntries(files).forEach(({ file, order }) => {
    if (isDemandCancelled(file) || isSupplyOrderCancelled(file, order)) return;
    const completionDate = getDeliveryCompletionScheduleDate(file, order);
    if (activityRange && !isDateInRange(completionDate, activityRange)) return;
    const month = getMonthKey(completionDate);
    if (!month) return;
    counts.set(month, (counts.get(month) ?? 0) + 1);
  });
  return monthCountRows(counts);
}

function getDailyCompletedDeliveries(files: FileRecord[], selectedYear?: string) {
  const counts = new Map<string, number>();
  const activityRange = getActivityYearDateRange(selectedYear);
  effectiveSupplyOrderEntries(files).forEach(({ file, order }) => {
    if (isDemandCancelled(file) || isSupplyOrderCancelled(file, order)) return;
    const date = getDeliveryCompletionScheduleDate(file, order);
    if (!hasDate(date) || (activityRange && !isDateInRange(date, activityRange))) return;
    counts.set(date!, (counts.get(date!) ?? 0) + 1);
  });
  return dailyCountRows(counts);
}

function getMonthWiseBgExpiry(files: FileRecord[], selectedYear?: string) {
  const rows = new Map<string, { psb: number; pwb: number; psbPwb: number; count: number }>();
  const categories = ["psb", "pwb", "psbpwb"] as const;
  const activityRange = getActivityYearDateRange(selectedYear);
  rawSupplyOrderEntries(files).forEach(({ file, order }) => {
    if (isDemandCancelled(file)) return;
    categories.forEach((category) => {
      const validityDate = getBgValidityDate(order, category);
      if (
        !isBgCategoryApplicable(file, order, category) ||
        !isBgReceivedOrder(order, category) ||
        hasFilledString(getBgReturnDate(order, category)) ||
        (activityRange && !isDateInRange(validityDate, activityRange))
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

function getDailyBgExpiry(files: FileRecord[], selectedYear?: string) {
  const rows = new Map<string, { psb: number; pwb: number; psbPwb: number; count: number }>();
  const categories = ["psb", "pwb", "psbpwb"] as const;
  const activityRange = getActivityYearDateRange(selectedYear);
  rawSupplyOrderEntries(files).forEach(({ file, order }) => {
    if (isDemandCancelled(file)) return;
    categories.forEach((category) => {
      const validityDate = getBgValidityDate(order, category);
      if (
        !isBgCategoryApplicable(file, order, category) ||
        !isBgReceivedOrder(order, category) ||
        hasFilledString(getBgReturnDate(order, category)) ||
        !hasDate(validityDate) ||
        (activityRange && !isDateInRange(validityDate, activityRange))
      ) {
        return;
      }
      const current = rows.get(validityDate!) ?? { psb: 0, pwb: 0, psbPwb: 0, count: 0 };
      if (category === "psbpwb") current.psbPwb += 1;
      else current[category] += 1;
      current.count += 1;
      rows.set(validityDate!, current);
    });
  });
  return Array.from(rows.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, monthKey: date.slice(0, 7), ...counts }));
}

function getDailyPaymentDue(files: FileRecord[], selectedYear: string | undefined, offsetDays: number) {
  const counts = new Map<string, number>();
  const activityRange = getActivityYearDateRange(selectedYear);
  const addDue = (date: string | undefined) => {
    if (!hasDate(date) || (activityRange && !isDateInRange(date, activityRange))) return;
    counts.set(date!, (counts.get(date!) ?? 0) + 1);
  };

  files.forEach((file) => {
    normalizedFilePaymentOrders(file).forEach((order) => {
      if (isSupplyOrderCancelled(file, order) || isShortclosureNoFurtherAction(order)) return;
      if (order.stageDeliveryLabel === "Advance Payment") {
        if (
          hasFilledString(order.paymentDate) ||
          !areRequiredAdvanceGuaranteesReceived(file, order) ||
          (getInrAmount(order.soValueCapital, file) ?? 0) +
            (getInrAmount(order.soValueRevenue, file) ?? 0) <=
            0
        ) return;
        addDue(order.advancePaymentDetail?.expectedPaymentDate);
        return;
      }

      if (hasFilledString(order.paymentDate)) return;
      const capital = getInrAmount(getPlannedCashOutgoCapital(order), file) ?? 0;
      const revenue = getInrAmount(getPlannedCashOutgoRevenue(order), file) ?? 0;
      if (capital + revenue <= 0) return;

      let expectedDate: string | undefined;
      if (hasFilledString(order.billSentForPaymentDate)) {
        expectedDate = addDays(order.billSentForPaymentDate, offsetDays);
      } else if (hasFilledString(order.billPreparationDate)) {
        expectedDate = addDays(order.billPreparationDate, offsetDays);
      } else if (isParentStagePaymentOrder(order)) {
        expectedDate = addDays(
          getParentStagePaymentDate(order, "materialReceiptDate"),
          offsetDays,
        );
      } else {
        const receiptDate = isDeliveryInspectionApplicable(file)
          ? order.materialReceiptDate
          : getNonInspectionPaymentDueDate(file, order);
        expectedDate = hasFilledString(receiptDate)
          ? addDays(receiptDate, offsetDays)
          : addDays(getDeliveryPeriodDate(order), offsetDays + 1);
      }
      addDue(expectedDate);
    });

    normalizedRawSupplyOrders(file).forEach((order) => {
      if (isSupplyOrderCancelled(file, order) || isShortclosureNoFurtherAction(order)) return;
      getSupplementaryBills(order).forEach((bill) => {
        if (
          hasFilledString(bill.paymentDate) ||
          hasOpenSupplementaryBillReturn(bill) ||
          !hasFilledString(getActiveSupplementaryBillSubmissionDate(bill)) ||
          (getInrAmount(bill.billAmountCapital, file) ?? 0) +
            (getInrAmount(bill.billAmountRevenue, file) ?? 0) <=
            0
        ) return;
        addDue(addDays(getActiveSupplementaryBillSubmissionDate(bill), offsetDays));
      });
    });
  });

  return dailyCountRows(counts);
}

function getDailyPaymentCompleted(files: FileRecord[], selectedYear?: string) {
  const counts = new Map<string, number>();
  const activityRange = getActivityYearDateRange(selectedYear);
  const addCompleted = (date: string | undefined, amount: number) => {
    if (
      !hasDate(date) ||
      amount <= 0 ||
      (activityRange && !isDateInRange(date, activityRange))
    ) return;
    counts.set(date!, (counts.get(date!) ?? 0) + 1);
  };

  files.forEach((file) => {
    normalizedFilePaymentOrders(file).forEach((order) => {
      if (isSupplyOrderCancelled(file, order) || !hasFilledString(order.paymentDate)) return;
      const capital = getInrAmount(
        getActualPaymentCapital(order) || getPlannedCashOutgoCapital(order),
        file,
      ) ?? 0;
      const revenue = getInrAmount(
        getActualPaymentRevenue(order) || getPlannedCashOutgoRevenue(order),
        file,
      ) ?? 0;
      addCompleted(order.paymentDate, capital + revenue);
    });

    normalizedRawSupplyOrders(file).forEach((order) => {
      if (isSupplyOrderCancelled(file, order)) return;
      getSupplementaryBills(order).forEach((bill) => {
        const capital = getInrAmount(bill.actualPaymentCapital || bill.billAmountCapital, file) ?? 0;
        const revenue = getInrAmount(bill.actualPaymentRevenue || bill.billAmountRevenue, file) ?? 0;
        addCompleted(bill.paymentDate, capital + revenue);
      });
    });
  });

  return dailyCountRows(counts);
}

function getBgReceiptDelayRows(files: FileRecord[], thresholds: number[]): BgReceiptDelayRow[] {
  const normalizedThresholds = Array.from(
    new Set(
      thresholds
        .map((item) => Number.parseInt(String(item), 10))
        .filter((item) => Number.isInteger(item) && item >= 0),
    ),
  ).sort((a, b) => a - b);
  const days = normalizedThresholds.length ? normalizedThresholds : [10, 30, 60];
  const categories = ["psb", "pwb", "psbpwb"] as const;
  return days.map((thresholdDays, index) => {
    const nextThresholdDays = days[index + 1];
    const counts = { psb: 0, pwb: 0, psbPwb: 0, count: 0 };
    rawSupplyOrderEntries(files).forEach(({ file, order }) => {
      if (
        isDemandCancelled(file) ||
        isYes(order.soCancelled)
      )
        return;
      categories.forEach((category) => {
        if (!isBgCategoryApplicable(file, order, category)) return;
        if (isBgReceivedOrder(order, category)) return;
        const baseDate = getBgReceiptDelayBaseDate(file, order, category);
        if (!hasFilledString(baseDate)) return;
        const delayDays = getDaysSinceDate(baseDate);
        if (delayDays === undefined || delayDays <= thresholdDays) return;
        if (nextThresholdDays !== undefined && delayDays > nextThresholdDays) return;
        if (category === "psb") counts.psb += 1;
        if (category === "pwb") counts.pwb += 1;
        if (category === "psbpwb") counts.psbPwb += 1;
        counts.count += 1;
      });
    });
    return {
      thresholdDays,
      nextThresholdDays,
      label: nextThresholdDays === undefined
        ? `>${thresholdDays} days`
        : `${thresholdDays + 1}-${nextThresholdDays} days`,
      ...counts,
    };
  });
}

function getBgReceiptDelayBaseDate(
  file: FileRecord,
  order: SupplyOrderDetail,
  category: "psb" | "pwb" | "psbpwb",
) {
  if (category === "psb" || category === "psbpwb" || isAmcMpcOmFile(file)) return order.soDate;
  if (isDeliveryInspectionApplicable(file) && isYes(file.ir)) return order.irReceiptDate;
  const useMaterialReceipt = isDeliveryInspectionApplicable(file);
  if (isGoodsServicesIrNo(file) && isYes(order.stageDelivery) && order.stageDeliveries?.length) {
    const stageDates = order.stageDeliveries.map((stage) => stage.actualJobCompletionDate);
    if (isYes(order.stagePayment)) {
      return stageDates
        .filter((value): value is string => hasFilledString(value))
        .sort((a, b) => a.localeCompare(b))[0];
    }
    if (stageDates.some((value) => !hasFilledString(value))) return undefined;
    return stageDates
      .filter((value): value is string => hasFilledString(value))
      .sort((a, b) => b.localeCompare(a))[0];
  }
  const stageDates = isYes(order.stageDelivery)
    ? (order.stageDeliveries ?? [])
        .map((stage) => (useMaterialReceipt ? stage.materialReceiptDate : stage.actualJobCompletionDate))
        .filter((value): value is string => hasFilledString(value))
    : [];
  const orderDate = useMaterialReceipt ? order.materialReceiptDate : order.actualJobCompletionDate;
  return [...stageDates, orderDate]
    .filter((value): value is string => hasFilledString(value))
    .sort((a, b) => a.localeCompare(b))[0];
}

function getWarrantyBgMismatchRows(
  files: FileRecord[],
  bufferDays: number,
): WarrantyBgMismatchRow[] {
  const normalizedBufferDays = Number.isInteger(bufferDays) && bufferDays >= 0 ? bufferDays : 60;
  const counts = { pwb: 0, psbPwb: 0, count: 0 };
  const categories = ["pwb", "psbpwb"] as const;
  rawSupplyOrderEntries(files).forEach(({ file, order }) => {
    if (isDemandCancelled(file) || isYes(order.soCancelled)) return;
    categories.forEach((category) => {
      if (!isWarrantyBgMismatchOrder(file, order, category, normalizedBufferDays)) return;
      if (category === "pwb") counts.pwb += 1;
      if (category === "psbpwb") counts.psbPwb += 1;
      counts.count += 1;
    });
  });
  return [
    {
      bufferDays: normalizedBufferDays,
      label: `Warranty + ${normalizedBufferDays} days`,
      ...counts,
    },
  ];
}

function isWarrantyBgMismatchOrder(
  file: FileRecord,
  order: SupplyOrderDetail,
  category: "pwb" | "psbpwb",
  bufferDays: number,
) {
  if (!isWarrantyBgCategoryApplicable(file, order, category)) return false;
  if (!isBgReceivedOrder(order, category)) return false;
  if (hasFilledString(getBgReturnDate(order, category))) return false;
  const warrantyPeriodDate = order.warrantyPeriodDate;
  const validityDate = getBgValidityDate(order, category);
  if (!hasFilledString(warrantyPeriodDate) || !hasFilledString(validityDate)) return false;
  const requiredValidityDate = addDays(warrantyPeriodDate, bufferDays);
  return hasFilledString(requiredValidityDate) && validityDate! < requiredValidityDate!;
}

function monthCountRows(counts: Map<string, number>) {
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, monthKey: name, count }));
}

function dailyCountRows(counts: Map<string, number>) {
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, monthKey: date.slice(0, 7), count }));
}

function getMonthKey(date: string | undefined) {
  return date && hasDate(date) ? date.slice(0, 7) : undefined;
}

function getActivityYearDateRange(financialYear: string | undefined) {
  const match = (financialYear ?? "").match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return undefined;
  const startYear = Number(match[1]);
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

function isDateInRange(date: string | undefined, range: { start: string; end: string }) {
  return hasDate(date) && date! >= range.start && date! <= range.end;
}

function countPreBidMeetingStatuses(
  files: FileRecord[],
  refloat: boolean,
  state: "due" | "completed",
) {
  return files.filter((file) => isPreBidMeetingStatus(file, refloat, state)).length;
}

function isPreBidMeetingStatus(file: FileRecord, refloat: boolean, state: "due" | "completed") {
  if (isDemandCancelled(file)) return false;
  if (!isBiddingApplicableForFile(file)) return false;
  const applies = refloat
    ? isYes(file.refloat) && isYes(file.refloatPreBidMeeting)
    : isYes(file.preBidMeeting);
  const date = refloat ? file.refloatPreBidMeetingDate : file.preBidMeetingDate;
  if (!applies || !hasFilledString(date)) return false;
  return state === "completed" ? isDateBeforeToday(date) : !isDateBeforeToday(date);
}

function isDeliveryFructified(file: FileRecord, order: SupplyOrderDetail) {
  return isDeliveryInspectionApplicable(file)
    ? hasFilledString(order.materialReceiptDate)
    : hasFilledString(order.actualJobCompletionDate);
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

function getDeliveryCompletionScheduleDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  return hasFilledString(order.actualJobCompletionDate)
    ? order.actualJobCompletionDate
    : undefined;
}

function isExpectedDpCashOutgoPending(
  file: FileRecord,
  order: SupplyOrderDetail,
  asOfDate?: string,
) {
  if (isDeliveryInspectionApplicable(file)) {
    return asOfDate
      ? isMissingOrAfter(order.materialReceiptDate, asOfDate) &&
          isMissingOrAfter(order.billPreparationDate, asOfDate) &&
          isMissingOrAfter(order.billSentForPaymentDate, asOfDate) &&
          isMissingOrAfter(order.paymentDate, asOfDate)
      : !hasFilledString(order.materialReceiptDate) &&
          !hasFilledString(order.billPreparationDate) &&
          !hasFilledString(order.billSentForPaymentDate) &&
          !hasFilledString(order.paymentDate);
  }

  return asOfDate
    ? isMissingOrAfter(order.billPreparationDate, asOfDate) &&
        isMissingOrAfter(order.billSentForPaymentDate, asOfDate) &&
        isMissingOrAfter(order.paymentDate, asOfDate) &&
        isMissingOrAfter(order.jobCompletionDate, asOfDate)
    : !hasFilledString(order.billPreparationDate) &&
        !hasFilledString(order.billSentForPaymentDate) &&
        !hasFilledString(order.paymentDate) &&
        !hasFilledString(order.jobCompletionDate);
}

function getExpectedCashOutgoByReceiptRows(
  files: FileRecord[],
  offsetDays = 0,
  asOfDate?: string,
): CashOutgoRow[] {
  const totals = new Map<string, CashOutgoRow>();

  files.forEach((file) => {
    if (isDemandCancelled(file)) return;
    fileSupplyOrders(file).forEach((order) => {
      if (!isPaymentOrderActive(file, order) || isShortclosureNoFurtherAction(order)) return;
      const reportDate = getReceiptPendingBillReportDate(file, order);
      if (!hasFilledString(reportDate)) return;
      if (asOfDate) {
        if (!isOnOrBefore(reportDate, asOfDate)) return;
        if (!isMissingOrAfter(order.paymentDate, asOfDate)) return;
      } else if (hasFilledString(order.paymentDate)) {
        return;
      }
      const cashOutgoDate = addDays(reportDate, offsetDays);
      if (!cashOutgoDate) return;

      addCashOutgoTotal(totals, cashOutgoDate, file, order);
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getExpectedCashOutgoByReceiptPendingBillRows(
  files: FileRecord[],
  offsetDays = 0,
  dateRange?: { fromDate: string; toDate: string },
): CashOutgoRow[] {
  const totals = new Map<string, CashOutgoRow>();

  files.forEach((file) => {
    if (isDemandCancelled(file)) return;
    fileSupplyOrders(file).forEach((order) => {
      if (
        !isPaymentOrderActive(file, order) ||
        isShortclosureNoFurtherAction(order)
      ) {
        return;
      }
      const triggerDate = getReceiptPendingBillReportDate(file, order) ?? "";
      if (!hasFilledString(triggerDate)) return;
      if (dateRange) {
        if (!isOnOrBefore(triggerDate, dateRange.toDate)) return;
        if (!isMissingOrAfter(order.billPreparationDate, dateRange.toDate)) return;
        if (!isMissingOrAfter(order.paymentDate, dateRange.toDate)) return;
      } else {
        if (hasFilledString(order.billPreparationDate)) return;
        if (hasFilledString(order.paymentDate)) return;
      }
      const cashOutgoDate = addDays(triggerDate, offsetDays);
      if (!cashOutgoDate) return;
      if (dateRange && !isWithinDateRange(triggerDate, dateRange)) return;

      addCashOutgoTotal(totals, cashOutgoDate, file, order);
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getReceiptPendingBillReportDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  return getNonInspectionPaymentDueDate(file, order);
}

function getExpectedCashOutgoByBillPreparationRows(
  files: FileRecord[],
  dateRange?: { fromDate: string; toDate: string },
  asOfDate?: string,
): CashOutgoRow[] {
  const totals = new Map<string, CashOutgoRow>();

  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
    filePaymentOrders(file).forEach((order) => {
      const isAdvancePayment = order.stageDeliveryLabel === "Advance Payment";
      if (!isPaymentOrderActive(file, order) || isShortclosureNoFurtherAction(order)) return;
      const reportDate = getReceiptPendingBillReportDate(file, order);
      if (!isAdvancePayment && !hasFilledString(reportDate)) return;
      if (!hasFilledString(order.billPreparationDate)) return;
      if (asOfDate) {
        if (!isAdvancePayment && !isOnOrBefore(reportDate, asOfDate)) return;
        if (!isOnOrBefore(order.billPreparationDate, asOfDate)) return;
        if (
          !isMissingOrAfter(order.billSentForPaymentDate, asOfDate) &&
          !hasOpenBillReturn(order)
        ) {
          return;
        }
        if (!isMissingOrAfter(order.paymentDate, asOfDate)) return;
      } else if (dateRange) {
        if (!isAdvancePayment && !isOnOrBefore(reportDate, dateRange.toDate)) return;
        if (!isOnOrBefore(order.billPreparationDate, dateRange.toDate)) return;
        if (
          !isMissingOrAfter(order.billSentForPaymentDate, dateRange.toDate) &&
          !hasOpenBillReturn(order)
        ) {
          return;
        }
        if (!isMissingOrAfter(order.paymentDate, dateRange.toDate)) return;
      } else if (hasFilledString(order.paymentDate)) {
        return;
      } else if (hasFilledString(order.billSentForPaymentDate) && !hasOpenBillReturn(order)) {
        return;
      }
      const billPreparationDate = order.billPreparationDate;
      if (!billPreparationDate) return;
      if (dateRange && !isWithinDateRange(billPreparationDate, dateRange)) return;

      addCashOutgoTotal(totals, billPreparationDate, file, order);
    });

    rawSupplyOrders(file).forEach((order) => {
      if (!isPaymentOrderActive(file, order) || isShortclosureNoFurtherAction(order)) return;
      getSupplementaryBills(order).forEach((bill) => {
        if (hasFilledString(bill.paymentDate)) return;
        const returnedDate = getSupplementaryReturnedBillCashOutgoEventDate(
          bill,
          "supplementaryPendingReturnedBills",
        );
        if (!returnedDate) return;
        if (asOfDate) {
          if (!isOnOrBefore(returnedDate, asOfDate)) return;
        } else if (dateRange) {
          if (!isOnOrBefore(returnedDate, dateRange.toDate)) return;
        }
        if (dateRange && !isWithinDateRange(returnedDate, dateRange)) return;

        addSupplementaryBillCashOutgoTotal(totals, returnedDate, file, bill);
      });
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getBillSentForPaymentRows(
  files: FileRecord[],
  dateRange?: { fromDate: string; toDate: string },
  asOfDate?: string,
): CashOutgoRow[] {
  const totals = new Map<string, CashOutgoRow>();

  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
    filePaymentOrders(file).forEach((order) => {
      const isAdvancePayment = order.stageDeliveryLabel === "Advance Payment";
      if (!isPaymentOrderActive(file, order) || isShortclosureNoFurtherAction(order)) return;
      const reportDate = getReceiptPendingBillReportDate(file, order);
      if (!isAdvancePayment && !hasFilledString(reportDate)) return;
      if (!hasFilledString(order.billPreparationDate)) return;
      if (!hasFilledString(order.billSentForPaymentDate)) return;
      if (hasOpenBillReturn(order)) return;
      if (asOfDate) {
        if (!isAdvancePayment && !isOnOrBefore(reportDate, asOfDate)) return;
        if (!isOnOrBefore(order.billPreparationDate, asOfDate)) return;
        if (!isOnOrBefore(order.billSentForPaymentDate, asOfDate)) return;
        if (!isMissingOrAfter(order.paymentDate, asOfDate)) return;
      } else if (dateRange) {
        if (!isAdvancePayment && !isOnOrBefore(reportDate, dateRange.toDate)) return;
        if (!isOnOrBefore(order.billPreparationDate, dateRange.toDate)) return;
        if (!isOnOrBefore(order.billSentForPaymentDate, dateRange.toDate)) return;
        if (!isMissingOrAfter(order.paymentDate, dateRange.toDate)) return;
      } else if (hasFilledString(order.paymentDate)) {
        return;
      }
      const billSentForPaymentDate = order.billSentForPaymentDate;
      if (!billSentForPaymentDate) return;
      if (dateRange && !isWithinDateRange(billSentForPaymentDate, dateRange)) return;

      addCashOutgoTotal(totals, billSentForPaymentDate, file, order);
    });

    rawSupplyOrders(file).forEach((order) => {
      if (!isPaymentOrderActive(file, order) || isShortclosureNoFurtherAction(order)) return;
      getSupplementaryBills(order).forEach((bill) => {
        if (asOfDate) {
          if (!isMissingOrAfter(bill.paymentDate, asOfDate)) return;
        } else if (dateRange) {
          if (!isMissingOrAfter(bill.paymentDate, dateRange.toDate)) return;
        } else if (hasFilledString(bill.paymentDate)) {
          return;
        }
        if (hasOpenSupplementaryBillReturn(bill)) return;
        const activeSubmissionDate = getActiveSupplementaryBillSubmissionDate(bill);
        if (!activeSubmissionDate) return;
        if (asOfDate) {
          if (!isOnOrBefore(activeSubmissionDate, asOfDate)) return;
        } else if (dateRange) {
          if (!isOnOrBefore(activeSubmissionDate, dateRange.toDate)) return;
        }
        if (dateRange && !isWithinDateRange(activeSubmissionDate, dateRange)) return;

        addSupplementaryBillCashOutgoTotal(totals, activeSubmissionDate, file, bill);
      });
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getSupplementaryBillSentForPaymentRows(
  files: FileRecord[],
  dateRange?: { fromDate: string; toDate: string },
  asOfDate?: string,
): CashOutgoRow[] {
  const totals = new Map<string, CashOutgoRow>();

  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
    rawSupplyOrders(file).forEach((order) => {
      if (!isPaymentOrderActive(file, order) || isShortclosureNoFurtherAction(order)) return;
      getSupplementaryBills(order).forEach((bill) => {
        if (asOfDate) {
          if (!isMissingOrAfter(bill.paymentDate, asOfDate)) return;
        } else if (dateRange) {
          if (!isMissingOrAfter(bill.paymentDate, dateRange.toDate)) return;
        } else if (hasFilledString(bill.paymentDate)) {
          return;
        }
        if (hasOpenSupplementaryBillReturn(bill)) return;
        const activeSubmissionDate = getActiveSupplementaryBillSubmissionDate(bill);
        if (!activeSubmissionDate) return;
        if (asOfDate) {
          if (!isOnOrBefore(activeSubmissionDate, asOfDate)) return;
        } else if (dateRange) {
          if (!isOnOrBefore(activeSubmissionDate, dateRange.toDate)) return;
        }
        if (dateRange && !isWithinDateRange(activeSubmissionDate, dateRange)) return;

        addSupplementaryBillCashOutgoTotal(totals, activeSubmissionDate, file, bill);
      });
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getActualCashOutgoRows(
  files: FileRecord[],
  dateRange?: { fromDate: string; toDate: string },
  paymentCutoffDate?: string,
): CashOutgoRow[] {
  const totals = new Map<string, CashOutgoRow>();

  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
    filePaymentOrders(file).forEach((order) => {
      if (!hasFilledString(order.paymentDate) || isYes(order.soCancelled)) return;

      const paymentDate = order.paymentDate;
      if (!paymentDate || isBeyondPaymentCutoff(paymentDate, paymentCutoffDate)) return;
      if (dateRange && !isWithinDateRange(paymentDate, dateRange)) return;

      addCashOutgoTotal(totals, paymentDate, file, order, "actual");
    });

    rawSupplyOrders(file).forEach((order) => {
      if (isYes(order.soCancelled)) return;
      getSupplementaryBills(order).forEach((bill) => {
        if (!hasFilledString(bill.paymentDate)) return;
        const paymentDate = bill.paymentDate;
        if (!paymentDate || isBeyondPaymentCutoff(paymentDate, paymentCutoffDate)) return;
        if (dateRange && !isWithinDateRange(paymentDate, dateRange)) return;

        addSupplementaryBillCashOutgoTotal(totals, paymentDate, file, bill, "actual");
      });
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getSupplementaryActualCashOutgoRows(
  files: FileRecord[],
  dateRange?: { fromDate: string; toDate: string },
  paymentCutoffDate?: string,
): CashOutgoRow[] {
  const totals = new Map<string, CashOutgoRow>();

  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
    rawSupplyOrders(file).forEach((order) => {
      if (!isPaymentOrderActive(file, order)) return;
      getSupplementaryBills(order).forEach((bill) => {
        if (!hasFilledString(bill.paymentDate)) return;
        const paymentDate = bill.paymentDate;
        if (!paymentDate || isBeyondPaymentCutoff(paymentDate, paymentCutoffDate)) return;
        if (dateRange && !isWithinDateRange(paymentDate, dateRange)) return;

        addSupplementaryBillCashOutgoTotal(totals, paymentDate, file, bill, "actual");
      });
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getReturnedBillCashOutgoRows(
  files: FileRecord[],
  mode: "returnedBills" | "pendingReturnedBills" | "returnedBillsResubmitted" | "returnedBillsPaid",
  dateRange?: { fromDate: string; toDate: string },
  paymentCutoffDate?: string,
): CashOutgoRow[] {
  const totals = new Map<string, CashOutgoRow>();

  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
    filePaymentOrders(file).forEach((order) => {
      if (
        !isPaymentOrderActive(file, order) ||
        (mode !== "returnedBills" &&
          mode !== "returnedBillsPaid" &&
          isShortclosureNoFurtherAction(order))
      ) return;
      const eventDate = getReturnedBillCashOutgoEventDate(order, mode);
      if (!eventDate) return;
      if (mode === "returnedBillsPaid" && isBeyondPaymentCutoff(eventDate, paymentCutoffDate))
        return;
      if (dateRange && !isWithinDateRange(eventDate, dateRange)) return;

      addCashOutgoTotal(
        totals,
        eventDate,
        file,
        order,
        mode === "returnedBillsPaid" ? "actual" : "planned",
      );
    });
  });

  return finalizeCashOutgoRows(totals);
}

function earliestDate(dates: Array<string | undefined>) {
  return dates.filter(hasFilledString).sort()[0];
}

type SupplementaryReturnedBillCashOutgoMode =
  | "supplementaryPendingReturnedBills"
  | "supplementaryReturnedBillsResubmitted"
  | "supplementaryReturnedBillsPaid";

function getSupplementaryReturnedBillCashOutgoRows(
  files: FileRecord[],
  mode: SupplementaryReturnedBillCashOutgoMode,
  dateRange?: { fromDate: string; toDate: string },
  paymentCutoffDate?: string,
): CashOutgoRow[] {
  const totals = new Map<string, CashOutgoRow>();

  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
    rawSupplyOrders(file).forEach((order) => {
      if (
        !isPaymentOrderActive(file, order) ||
        (mode !== "supplementaryReturnedBillsPaid" && isShortclosureNoFurtherAction(order))
      ) return;
      getSupplementaryBills(order).forEach((bill) => {
        const eventDate = getSupplementaryReturnedBillCashOutgoEventDate(bill, mode);
        if (!eventDate) return;
        if (
          mode === "supplementaryReturnedBillsPaid" &&
          isBeyondPaymentCutoff(eventDate, paymentCutoffDate)
        ) return;
        if (dateRange && !isWithinDateRange(eventDate, dateRange)) return;

        addSupplementaryBillCashOutgoTotal(
          totals,
          eventDate,
          file,
          bill,
          mode === "supplementaryReturnedBillsPaid" ? "actual" : "planned",
        );
      });
    });
  });

  return finalizeCashOutgoRows(totals);
}

function isBeyondPaymentCutoff(paymentDate: string, cutoffDate?: string) {
  return Boolean(cutoffDate && paymentDate > cutoffDate);
}

function getSupplementaryReturnedBillCashOutgoEventDate(
  bill: SupplementaryBillDetail,
  mode: SupplementaryReturnedBillCashOutgoMode,
) {
  const latest = latestBillReturnCycle(bill.billReturnCycles);

  if (mode === "supplementaryPendingReturnedBills") {
    if (hasFilledString(bill.paymentDate)) return undefined;
    return latest && !hasFilledString(latest.resubmittedDate) ? latest.returnedDate : undefined;
  }
  if (mode === "supplementaryReturnedBillsResubmitted") {
    if (hasFilledString(bill.paymentDate) || !latest || !hasFilledString(latest.resubmittedDate)) {
      return undefined;
    }
    return latest.resubmittedDate;
  }
  return isReturnedSupplementaryBillPaid(bill) ? bill.paymentDate : undefined;
}

function addCashOutgoTotal(
  totals: Map<string, CashOutgoRow>,
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
  totals: Map<string, CashOutgoRow>,
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

function getDpForecastOrder(order: SupplyOrderDetail): SupplyOrderDetail {
  if (order.stageDeliveryLabel || !isYes(order.advancePayment)) return order;
  const advance = order.advancePaymentDetail;
  const allocatedCapital =
    parseAmount(advance?.stageAmountCapital) ?? parseAmount(advance?.actualPaymentCapital) ?? 0;
  const allocatedRevenue =
    parseAmount(advance?.stageAmountRevenue) ?? parseAmount(advance?.actualPaymentRevenue) ?? 0;
  const plannedCapital = parseAmount(getPlannedCashOutgoCapital(order)) ?? 0;
  const plannedRevenue = parseAmount(getPlannedCashOutgoRevenue(order)) ?? 0;
  return {
    ...order,
    billAmountCapital: hasFilledString(order.billAmountCapital)
      ? order.billAmountCapital
      : String(Math.max(0, plannedCapital - allocatedCapital)),
    billAmountRevenue: hasFilledString(order.billAmountRevenue)
      ? order.billAmountRevenue
      : String(Math.max(0, plannedRevenue - allocatedRevenue)),
  };
}

function getPlannedCashOutgoRevenue(order: SupplyOrderDetail) {
  return hasFilledString(order.billAmountRevenue) ? order.billAmountRevenue : order.soValueRevenue;
}

function finalizeCashOutgoRows(totals: Map<string, CashOutgoRow>) {
  return Array.from(totals.values())
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .map((row) => ({
      ...row,
      capital: Math.round(row.capital),
      revenue: Math.round(row.revenue),
      total: Math.round(row.total),
    }));
}

function isWithinDateRange(date: string, range: { fromDate: string; toDate: string }) {
  return date >= range.fromDate && date <= range.toDate;
}

function isOnOrBefore(date: string | undefined, toDate: string) {
  return hasFilledString(date) && date! <= toDate;
}

function isMissingOrAfter(date: string | undefined, toDate: string) {
  return !hasFilledString(date) || date! > toDate;
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
    getGemUndertakingDelay(file, thresholdDays, selectedMilestoneKey),
    getBiddingDelay(file, thresholdDays, selectedMilestoneKey),
    ...getNonTcecTechnicalEvaluationDelayRows(file, thresholdDays, selectedMilestoneKey),
    getCurrentMilestoneDelay(file, thresholdDays, selectedMilestoneKey),
    ...getPreSubmissionPaymentDelayRows(file, thresholdDays, selectedMilestoneKey),
    ...getPostSubmissionPaymentDelayRows(file, thresholdDays, selectedMilestoneKey),
    ...getCumulativePaymentDelayRows(file, thresholdDays, selectedMilestoneKey),
    ...getCurrentOrderMilestoneDelayRows(file, thresholdDays, selectedMilestoneKey),
    ...getReturnedBillDelayRows(file, thresholdDays, selectedMilestoneKey),
    ...getSupplementaryBillReturnedDelayRows(file, thresholdDays, selectedMilestoneKey),
  ];
}

function getGemUndertakingDelay(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
): DelayStatusRow | undefined {
  const isRefloatGem = isYes(file.refloat);
  const isRefloatTcecGem = isRefloatGem && isYes(file.tcec);
  const startDate = isRefloatTcecGem
    ? file.postTcecDate
    : isRefloatGem
      ? file.refloatRecommendationDate
      : file.cfaDate;
  const endDate = isRefloatGem ? file.refloatGemUndertakingDate : file.gemUndertakingDate;
  if (
    (selectedMilestoneKey !== "all" && selectedMilestoneKey !== gemUndertakingDelayMilestoneKey) ||
    isCancelledFile(file) ||
    isFileClosed(file) ||
    !isYes(file.gem) ||
    !isBiddingApplicableForFile(file) ||
    !hasFilledString(startDate) ||
    hasFilledString(endDate)
  ) {
    return undefined;
  }
  const daysInStage = getDaysSinceDate(startDate);
  if (daysInStage === undefined || daysInStage <= thresholdDays) return undefined;
  return {
    fileId: file.id,
    fileRef: file.imms ?? "",
    division: file.division ?? "",
    indentor: file.indentor ?? "",
    description: file.demandDescription ?? "",
    milestoneKey: gemUndertakingDelayMilestoneKey,
    milestone: gemUndertakingDelayMilestoneLabel,
    stageStartDate: startDate,
    daysInStage,
    cumulativeDelayDays: null,
    lastFilledDate: getLastFilledDateValue(file) ?? "",
    focusSection: isRefloatGem ? "Bidding details" : "Milestones",
    focusTarget: isRefloatGem ? "refloatGemUndertakingDate" : "gemUndertakingDate",
  };
}

function getNonTcecTechnicalEvaluationDelayRows(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
): DelayStatusRow[] {
  if (
    (selectedMilestoneKey !== "all" && selectedMilestoneKey !== nonTcecTechnicalEvaluationDelayKey) ||
    isCancelledFile(file) ||
    isFileClosed(file) ||
    isYes(file.tcec) ||
    !isBiddingApplicableForFile(file)
  ) {
    return [];
  }

  const cycle = getNonTcecTechnicalEvaluationCycle(file);
  if (!isYes(cycle.stageOver)) return [];
  const stageStartDate = cycle.stageStartDate;
  const daysInStage = getDaysSinceDate(stageStartDate);
  if (daysInStage === undefined || daysInStage <= thresholdDays) return [];
  if (cycle.endDate) return [];

  return [{
    fileId: file.id,
    fileRef: file.imms ?? "",
    division: file.division ?? "",
    indentor: file.indentor ?? "",
    description: file.demandDescription ?? "",
    milestoneKey: nonTcecTechnicalEvaluationDelayKey,
    milestone: nonTcecTechnicalEvaluationDelayLabel,
    stageStartDate,
    daysInStage,
    cumulativeDelayDays: null,
    lastFilledDate: getLastFilledDateValue(file) ?? "",
    focusSection: "Milestones",
    focusTarget: cycle.focusTarget,
  }];
}

function getNonTcecTechnicalEvaluationCycle(file: FileRecord) {
  const refloat = isYes(file.refloat);
  const refloatCycle = refloat && hasFilledString(file.refloatBidOpeningDate);
  if (refloatCycle) {
    return {
      stageStartDate: file.refloatBidOpeningDate,
      endDate: getEarliestSupplyOrderDate(file, "financialSanctionDate"),
      stageOver: file.refloatBiddingStageOver,
      focusTarget: "financialSanction" as const,
    };
  }
  return {
    stageStartDate: file.bidOpeningDate,
    endDate: refloat
      ? file.refloatRecommendationDate
      : getEarliestSupplyOrderDate(file, "financialSanctionDate"),
    stageOver: file.biddingStageOver,
    focusTarget: refloat ? "refloatRecommendationDate" : "financialSanction",
  };
}

function getBiddingDelay(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
): DelayStatusRow | undefined {
  if (
    selectedMilestoneKey !== "all" &&
    selectedMilestoneKey !== "bidding" &&
    selectedMilestoneKey !== biddingNonRfpDelayMilestoneKey &&
    selectedMilestoneKey !== biddingRfpDelayMilestoneKey &&
    selectedMilestoneKey !== "refloatBidding"
  ) {
    return undefined;
  }
  const status = getBiddingDelayStatus(file);
  if (!status) return undefined;
  const statusMilestoneKey = isYes(file.refloat)
    ? "refloatBidding"
    : isYes(file.rfpVetting)
      ? biddingRfpDelayMilestoneKey
      : biddingNonRfpDelayMilestoneKey;
  const daysInStage = getDaysSinceDate(status.stageStartDate);
  if (daysInStage === undefined || daysInStage <= thresholdDays) return undefined;
  if (selectedMilestoneKey === "bidding" && statusMilestoneKey === "refloatBidding") return undefined;
  if (
    selectedMilestoneKey !== "all" &&
    selectedMilestoneKey !== "bidding" &&
    selectedMilestoneKey !== statusMilestoneKey
  ) {
    return undefined;
  }
  return {
    fileId: file.id,
    fileRef: file.imms ?? "",
    division: file.division ?? "",
    indentor: file.indentor ?? "",
    description: file.demandDescription ?? "",
    milestoneKey: statusMilestoneKey === "refloatBidding" ? statusMilestoneKey : "bidding",
    milestone:
      statusMilestoneKey === "refloatBidding"
        ? "Refloat bidding"
        : "Bidding",
    stageStartDate: status.stageStartDate,
    daysInStage,
    cumulativeDelayDays: null,
    lastFilledDate: getLastFilledDateValue(file) ?? "",
    focusSection: "Bidding details",
    focusTarget: status.focusTarget,
    biddingBreakupKey: status.key,
  };
}

function getBiddingDelayStatus(file: FileRecord) {
  if (isCancelledFile(file) || isFileClosed(file)) return undefined;
  if (!isBiddingApplicableForFile(file)) return undefined;
  const refloat = isYes(file.refloat);
  const nonTcecRefloatRestart =
    refloat &&
    !isYes(file.tcec) &&
    isYes(file.biddingStageOver) &&
    hasFilledString(file.refloatRecommendationDate);
  if (nonTcecRefloatRestart) {
    if (hasFilledString(file.refloatBiddingDate)) return undefined;
    return {
      key: "tenderLivePending",
      stageStartDate: file.refloatRecommendationDate,
      focusTarget: "refloatBiddingDate",
    };
  }
  if (refloat && !isYes(file.tcec)) return undefined;
  if ((!refloat && !hasFilledString(file.cfaDate)) || (refloat && isYes(file.biddingStageOver))) return undefined;
  const bidDate = refloat ? file.refloatBiddingDate : file.bidDate;
  const bidOpeningDate = refloat ? file.refloatBidOpeningDate : file.bidOpeningDate;
  if (!refloat && hasFilledString(bidDate)) return undefined;
  const prerequisiteDoneDate = refloat
    ? getRefloatBiddingStartDate(file) ?? file.refloatBiddingDate
    : file.cfaDate;
  if (refloat && !hasFilledString(bidDate) && !prerequisiteDoneDate) return undefined;
  if (!refloat && isYes(file.gem) && !hasFilledString(file.gemUndertakingDate)) {
    return {
      key: "gemUndertakingPending",
      stageStartDate: file.cfaDate,
      focusTarget: "gemUndertakingDate",
    };
  }
  if (!hasFilledString(bidDate)) {
    return {
      key: "tenderLivePending",
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
      stageStartDate: bidOpeningDate,
      focusTarget: isYes(file.refloat) ? "refloatBidOpeningDate" : "bidOpeningDate",
    };
  }
  if (isYes(file.bidOpened)) {
    return {
      key: "biddingStageCompletionPending",
      stageStartDate: bidOpeningDate || bidDate || prerequisiteDoneDate,
      focusTarget: "biddingStageOver",
    };
  }
  return undefined;
}

function getRefloatBiddingStartDate(file: FileRecord) {
  if (isYes(file.tcec)) {
    return hasFilledString(file.postTcecMinutesDate) ? file.postTcecMinutesDate : undefined;
  }
  if (!hasFilledString(file.bidOpeningDate)) return undefined;
  return latestDateValue([
    file.bidOpeningDate,
    isYes(file.refloatPreBidMeeting) ? file.refloatPreBidMeetingDate : undefined,
  ]);
}

function getWorkflowNotStartedDelay(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
): DelayStatusRow | undefined {
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
    cumulativeDelayDays: null,
    lastFilledDate: getLastFilledDateValue(file) ?? "",
    focusSection: "Timeline",
  };
}

function getCurrentMilestoneDelay(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
): DelayStatusRow | undefined {
  const milestone = getActiveDelayMilestone(file);
  if (!milestone) return undefined;
  if (milestone.key === "payment") return undefined;
  if (milestone.key === "financialSanction") return undefined;
  if (milestone.key === "bidding") return undefined;
  if (milestone.key === "refloatBidding") return undefined;
  if (milestone.key === "postTcec" && (!isYes(file.tcec) || !isYes(file.biddingStageOver))) {
    return undefined;
  }
  if (milestone.key === "supplyOrder" && shouldUseOrderMilestoneRows(file)) return undefined;
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
    cumulativeDelayDays: getCumulativeDelayDays(file, milestone),
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
    "cfaSentDate",
    "cfaDate",
    ...(isYes(file.highValue) ? ["highValueMeetingDate", "highValueMinutesDate"] as const : []),
    ...(isYes(file.ad) ? ["adSentDate", "adVettingDate"] as const : []),
    ...(isYes(file.tcec)
      ? ["preTcecDate", "preTcecMinutesDate", "postTcecDate", "postTcecMinutesDate", "cncDate", "cncApprovalDate"] as const
      : []),
    ...(isYes(file.rqa) ? ["rqaSentDate", "rqaApprovalDate"] as const : []),
    ...(isYes(file.ifa) ? ["ifaSentDate", "ifaFinalDate"] as const : []),
    ...(isYes(file.gem)
      ? ["gemUndertakingDate", "refloatGemUndertakingDate"] as const
      : []),
    ...(isYes(file.rfpVetting)
      ? ["rfpVettingInitiationDate", "rfpVettingApprovalDate"] as const
      : []),
    ...(isBiddingApplicableForFile(file) && isYes(file.preBidMeeting)
      ? ["preBidMeetingDate"] as const
      : []),
    ...(isBiddingApplicableForFile(file) ? ["bidDate", "bidOpeningDate"] as const : []),
    ...(isBiddingApplicableForFile(file) && isYes(file.refloat)
      ? ["refloatBiddingDate", "refloatBidOpeningDate"] as const
      : []),
    ...(isBiddingApplicableForFile(file) &&
    isYes(file.refloat) &&
    isYes(file.refloatPreBidMeeting)
      ? ["refloatPreBidMeetingDate"] as const
      : []),
    ...(isYes(file.refloat) && isYes(file.tcec)
      ? ["refloatPostTcecDate", "refloatPostTcecMinutesDate"] as const
      : []),
  ];
  if (workflowDateKeys.some((key) => hasFilledString(String(file[key] ?? "")))) return false;
  return !rawSupplyOrders(file).some((order) => hasMeaningfulSupplyOrderWorkflowData(file, order));
}

function hasMeaningfulSupplyOrderWorkflowData(file: FileRecord, order: SupplyOrderDetail) {
  const orderDateKeys = [
    order.financialSanctionDate,
    order.soDate,
    order.dpDate,
    order.materialReceiptDate,
    order.jobCompletionDate,
    order.billPreparationDate,
    order.billSentForPaymentDate,
    order.paymentDate,
  ];
  if (isDeliveryInspectionApplicable(file) && isYes(file.ir)) {
    orderDateKeys.push(order.irPreparationDate, order.irReceiptDate);
  }
  return orderDateKeys.some(hasFilledString);
}

const orderDelayMilestones = [
  {
    key: "financialSanction",
    label: "Financial Sanction (TCEC cases)",
    current: "financialsanction",
    start: (file: FileRecord) => getFinancialSanctionDelayStartDate(file),
    complete: (_file: FileRecord, order: SupplyOrderDetail) => order.financialSanctionDate,
  },
  {
    key: "supplyOrder",
    label: "Supply Order",
    current: "supplyorder",
    start: (file: FileRecord, order: SupplyOrderDetail) =>
      isYes(file.tcec)
        ? getTcecSupplyOrderDelayStartDate(file, order)
        : order.financialSanctionDate,
    complete: (_file: FileRecord, order: SupplyOrderDetail) => order.soDate,
  },
  {
    key: "advancePayment",
    label: "Advance Payment",
    current: "advancepayment",
    start: (_file: FileRecord, order: SupplyOrderDetail) => order.soDate,
    complete: (_file: FileRecord, order: SupplyOrderDetail) =>
      isAdvancePaymentCompleted(order) ? "9999-12-31" : undefined,
  },
  {
    key: "psb",
    label: "PSB",
    current: "psb",
    start: (_file: FileRecord, order: SupplyOrderDetail) => order.soDate,
    complete: (_file: FileRecord, order: SupplyOrderDetail) =>
      isBgReceivedOrder(order, "psb") ? getBgReceivedDate(order, "psb") || "9999-12-31" : undefined,
  },
  {
    key: "pwb",
    label: "PWB",
    current: "pwb",
    start: (file: FileRecord, order: SupplyOrderDetail) => {
      if (isDeliveryInspectionApplicable(file) && isYes(file.ir)) return order.irReceiptDate;
      if (!isGoodsServicesIrNo(file)) return order.materialReceiptDate;
      if (isYes(order.stageDelivery) && order.stageDeliveries?.length) {
        const dates = order.stageDeliveries
          .map((stage) => stage.actualJobCompletionDate)
          .filter((value): value is string => hasFilledString(value))
          .sort((a, b) => a.localeCompare(b));
        if (isYes(order.stagePayment)) return dates[0];
        if (dates.length !== order.stageDeliveries.length) return undefined;
        return dates[dates.length - 1];
      }
      return order.actualJobCompletionDate;
    },
    complete: (_file: FileRecord, order: SupplyOrderDetail) =>
      isBgReceivedOrder(order, "pwb") ? getBgReceivedDate(order, "pwb") || "9999-12-31" : undefined,
  },
  {
    key: "psbPwb",
    label: "PSB+PWB",
    current: "psbpwb",
    start: (_file: FileRecord, order: SupplyOrderDetail) => order.soDate,
    complete: (_file: FileRecord, order: SupplyOrderDetail) =>
      isBgReceivedOrder(order, "psbpwb")
        ? getBgReceivedDate(order, "psbpwb") || "9999-12-31"
        : undefined,
  },
  {
    key: "delivery",
    label: "Delivery",
    current: "delivery",
    start: (_file: FileRecord, order: SupplyOrderDetail) => getDeliveryPeriodDate(order),
    complete: (_file: FileRecord, order: SupplyOrderDetail) => order.materialReceiptDate,
    applies: (file: FileRecord) => isDeliveryInspectionApplicable(file),
  },
  {
    key: "jobCompletion",
    label: "Job Completion",
    current: "jobcompletion",
    start: (_file: FileRecord, order: SupplyOrderDetail) => getDeliveryPeriodDate(order),
    complete: (_file: FileRecord, order: SupplyOrderDetail) =>
      isJobCompletionDone(order) ? "9999-12-31" : undefined,
    applies: (file: FileRecord) => isJobCompletionWorkflow(file),
  },
  {
    key: "irPreparation",
    label: "IR Preparation",
    current: "irpreparation",
    start: (_file: FileRecord, order: SupplyOrderDetail) => order.materialReceiptDate,
    complete: (_file: FileRecord, order: SupplyOrderDetail) => order.irPreparationDate,
    applies: (file: FileRecord) => isDeliveryInspectionApplicable(file) && isYes(file.ir),
  },
  {
    key: "irReceipt",
    label: "IR Receipt",
    current: "irreceipt",
    start: (_file: FileRecord, order: SupplyOrderDetail) => order.irPreparationDate,
    complete: (_file: FileRecord, order: SupplyOrderDetail) => order.irReceiptDate,
    applies: (file: FileRecord) => isDeliveryInspectionApplicable(file) && isYes(file.ir),
  },
  {
    key: "billPreparation",
    label: "Bill preparation",
    current: "billpreparation",
    start: (file: FileRecord, order: SupplyOrderDetail) => {
      if (isGoodsServicesIrNo(file) && isParentStagePaymentOrder(order)) {
        return getParentStagePaymentDate(order, "jobCompletionDate");
      }
      if (!isDeliveryInspectionApplicable(file)) return order.jobCompletionDate;
      return isParentStagePaymentOrder(order)
        ? getParentStagePaymentDate(order, "irReceiptDate")
        : order.irReceiptDate;
    },
    complete: (_file: FileRecord, order: SupplyOrderDetail) => order.billPreparationDate,
  },
  {
    key: "billSentForPayment",
    label: "Bill sent for payment",
    current: "billsentforpayment",
    start: (_file: FileRecord, order: SupplyOrderDetail) => order.billPreparationDate,
    complete: (_file: FileRecord, order: SupplyOrderDetail) => order.billSentForPaymentDate,
  },
  {
    key: "billReturnedForCorrection",
    label: "Bill returned for correction",
    current: "billreturnedforcorrection",
    start: (_file: FileRecord, order: SupplyOrderDetail) => getEarliestOpenBillReturnDate(order),
    complete: (_file: FileRecord, order: SupplyOrderDetail) =>
      hasOpenBillReturn(order) ? undefined : "9999-12-31",
  },
  {
    key: "payment",
    label: "Payment",
    current: "payment",
    start: (file: FileRecord, order: SupplyOrderDetail) =>
      getPaymentWorkflowStartDate(file, order) || order.billSentForPaymentDate,
    complete: (_file: FileRecord, order: SupplyOrderDetail) => order.paymentDate,
  },
] as const;

const orderDelayMilestoneKeys = new Set<string>(
  orderDelayMilestones.map((milestone) => milestone.key),
);

export const delayMilestoneOptions = [
  { key: "workflowNotStarted", label: "Workflow Not Started" },
  { key: gemUndertakingDelayMilestoneKey, label: gemUndertakingDelayMilestoneLabel },
  { key: "bidding", label: "Bidding" },
  { key: nonTcecTechnicalEvaluationDelayKey, label: nonTcecTechnicalEvaluationDelayLabel },
  ...milestoneDefinitions
    .filter((milestone) => milestone.key !== "payment" && !orderDelayMilestoneKeys.has(milestone.key))
    .map((milestone) => ({ key: milestone.key, label: milestone.label })),
  ...orderDelayMilestones
    .filter((milestone) => milestone.key !== "payment")
    .map((milestone) => ({ key: milestone.key, label: milestone.label })),
  { key: "paymentPreSubmission", label: "Payment cycle (ASL)" },
  { key: "paymentPostSubmission", label: "Payment cycle (PCDA)" },
  { key: "paymentCumulative", label: "Payment (ASL + PCDA)" },
  {
    key: supplementaryBillReturnedDelayMilestoneKey,
    label: supplementaryBillReturnedDelayMilestoneLabel,
  },
];

function getPreSubmissionPaymentDelayRows(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
): DelayStatusRow[] {
  if (
    (selectedMilestoneKey !== "all" && selectedMilestoneKey !== "paymentPreSubmission") ||
    isFileClosed(file) ||
    isYes(file.demandCancelled)
  ) {
    return [];
  }
  return normalizedFilePaymentEntries(file).flatMap(({ order, advancePayment }) => {
    if (
      advancePayment ||
      order.includeInPaymentTiming === false ||
      !isPaymentOrderActive(file, order) ||
      isYes(order.noFurtherAction) ||
      !hasFilledString(order.soDate) ||
      hasFilledString(order.billSentForPaymentDate) ||
      hasFilledString(order.paymentDate) ||
      hasBillReturnHistory(order)
    ) {
      return [];
    }
    const stageStartDate = getPaymentTimingTriggerDate(file, order);
    const daysInStage = getDaysSinceDate(stageStartDate);
    if (daysInStage === undefined || daysInStage <= thresholdDays) return [];
    return [{
      fileId: file.id,
      fileRef: file.imms ?? "",
      division: file.division ?? "",
      indentor: file.indentor ?? "",
      description: file.demandDescription ?? "",
      milestoneKey: "paymentPreSubmission",
      milestone: "Payment cycle (ASL)",
      stageStartDate,
      daysInStage,
      cumulativeDelayDays: null,
      lastFilledDate: getLastFilledDateValue(file) ?? "",
      focusSection: "Supply order and payment",
      focusTarget: "billsentforpayment:pending",
    }];
  });
}

function getPostSubmissionPaymentDelayRows(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
): DelayStatusRow[] {
  if (
    (selectedMilestoneKey !== "all" && selectedMilestoneKey !== "paymentPostSubmission") ||
    isFileClosed(file) ||
    isYes(file.demandCancelled)
  ) {
    return [];
  }
  const makeRow = (submissionDate: string | undefined, focusTarget: string) => {
    const daysInStage = getDaysSinceDate(submissionDate);
    if (daysInStage === undefined || daysInStage <= thresholdDays) return undefined;
    return {
      fileId: file.id,
      fileRef: file.imms ?? "",
      division: file.division ?? "",
      indentor: file.indentor ?? "",
      description: file.demandDescription ?? "",
      milestoneKey: "paymentPostSubmission",
      milestone: "Payment cycle (PCDA)",
      stageStartDate: submissionDate,
      daysInStage,
      cumulativeDelayDays: null,
      lastFilledDate: getLastFilledDateValue(file) ?? "",
      focusSection: "Supply order and payment",
      focusTarget,
    } satisfies DelayStatusRow;
  };
  const regularAndAdvanceRows = normalizedFilePaymentEntries(file).flatMap(
    ({ order, advancePayment, orderIndex, stageIndex }) => {
      if (
        order.includeInPaymentTiming === false ||
        !isPaymentOrderActive(file, order) ||
        isYes(order.noFurtherAction) ||
        (!advancePayment && !hasFilledString(order.soDate)) ||
        !hasFilledString(order.billSentForPaymentDate) ||
        hasFilledString(order.paymentDate) ||
        hasBillReturnHistory(order)
      ) {
        return [];
      }
      const focusTarget = advancePayment
        ? `advancepayment:pending:${orderIndex}`
        : getDelayStatusFocusTarget("payment", order, orderIndex, stageIndex);
      const row = makeRow(order.billSentForPaymentDate, focusTarget);
      return row ? [row] : [];
    },
  );
  const supplementaryRows = rawSupplyOrders(file).flatMap((order, orderIndex) => {
    if (!isPaymentOrderActive(file, order) || isYes(order.noFurtherAction)) return [];
    return getSupplementaryBills(order).flatMap((bill, billIndex) => {
      if (
        bill.includeInPaymentTiming === false ||
        !hasFilledString(bill.billSentForPaymentDate) ||
        hasFilledString(bill.paymentDate) ||
        hasBillReturnHistory(bill)
      ) {
        return [];
      }
      const row = makeRow(
        bill.billSentForPaymentDate,
        `supplementarybill:submitted:${orderIndex}:${billIndex}`,
      );
      return row ? [row] : [];
    });
  });
  return [...regularAndAdvanceRows, ...supplementaryRows];
}

function getCumulativePaymentDelayRows(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
): DelayStatusRow[] {
  if (
    (selectedMilestoneKey !== "all" && selectedMilestoneKey !== "paymentCumulative") ||
    isFileClosed(file) ||
    isYes(file.demandCancelled)
  ) {
    return [];
  }
  const today = formatLocalDate(new Date());
  const makeRow = (
    startDate: string | undefined,
    hasPayment: boolean,
    focusTarget: string,
    requireSubmission: boolean,
  ) => {
    if (hasPayment || (requireSubmission && !hasFilledString(startDate))) return undefined;
    const daysInStage = getDateDifference(startDate, today);
    if (daysInStage === undefined || daysInStage <= thresholdDays) return undefined;
    return {
      fileId: file.id,
      fileRef: file.imms ?? "",
      division: file.division ?? "",
      indentor: file.indentor ?? "",
      description: file.demandDescription ?? "",
      milestoneKey: "paymentCumulative",
      milestone: "Payment (ASL + PCDA)",
      stageStartDate: startDate,
      daysInStage,
      cumulativeDelayDays: null,
      lastFilledDate: getLastFilledDateValue(file) ?? "",
      focusSection: "Supply order and payment",
      focusTarget,
    } satisfies DelayStatusRow;
  };
  const regularAndAdvanceRows = normalizedFilePaymentEntries(file).flatMap(
    ({ order, advancePayment, orderIndex, stageIndex }) => {
      if (
        order.includeInPaymentTiming === false ||
        !isPaymentOrderActive(file, order) ||
        isYes(order.noFurtherAction) ||
        (!advancePayment && !hasFilledString(order.soDate)) ||
        hasBillReturnHistory(order)
      ) {
        return [];
      }
      const startDate = advancePayment
        ? order.billSentForPaymentDate
        : getPaymentTimingTriggerDate(file, order);
      const focusTarget = advancePayment
        ? `advancepayment:pending:${orderIndex}`
        : getDelayStatusFocusTarget("payment", order, orderIndex, stageIndex);
      const row = makeRow(
        startDate,
        hasFilledString(order.paymentDate),
        focusTarget,
        Boolean(advancePayment),
      );
      return row ? [row] : [];
    },
  );
  const supplementaryRows = rawSupplyOrders(file).flatMap((order, orderIndex) => {
    if (!isPaymentOrderActive(file, order) || isYes(order.noFurtherAction)) return [];
    return getSupplementaryBills(order).flatMap((bill, billIndex) => {
      if (bill.includeInPaymentTiming === false || hasBillReturnHistory(bill)) return [];
      const row = makeRow(
        bill.billSentForPaymentDate,
        hasFilledString(bill.paymentDate),
        `supplementarybill:submitted:${orderIndex}:${billIndex}`,
        true,
      );
      return row ? [row] : [];
    });
  });
  return [...regularAndAdvanceRows, ...supplementaryRows];
}

function getCurrentOrderMilestoneDelayRows(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
): DelayStatusRow[] {
  if (isYes(file.demandCancelled)) return [];
  return orderDelayMilestones.flatMap((milestone) => {
    if (milestone.key === "payment") return [];
    if (selectedMilestoneKey !== "all" && selectedMilestoneKey !== milestone.key) return [];
    if (milestone.key === "financialSanction" && !isYes(file.tcec)) return [];
    // Returned-bill delays are emitted by getReturnedBillDelayRows below.
    if (milestone.key === "billReturnedForCorrection") return [];
    const orderLevelMilestone =
      milestone.key === "supplyOrder" || isBgMilestoneKey(milestone.key);
    const entries: Array<{
      order: SupplyOrderDetail;
      orderIndex: number;
      stageIndex?: number;
    }> =
      milestone.key === "financialSanction" ||
      milestone.key === "advancePayment" ||
      orderLevelMilestone
        ? milestone.key === "financialSanction"
          ? expectedSupplyOrders(file).map((order, orderIndex) => ({ order, orderIndex }))
          : milestone.key === "supplyOrder"
            ? expectedSupplyOrders(file).map((order, orderIndex) => ({ order, orderIndex }))
            : rawSupplyOrders(file).map((order, orderIndex) => ({ order, orderIndex }))
        : ["billPreparation", "billSentForPayment", "payment"].includes(milestone.key)
            ? normalizedFilePaymentEntries(file).filter(({ advancePayment }) => !advancePayment)
          : normalizedFileSupplyOrderEntries(file);
    return entries.flatMap(({ order, orderIndex, stageIndex }) => {
      const normalizedCurrent = normalizeMilestoneName(milestone.current);
      if (!isOrderActiveForCurrentMilestone(file, order, normalizedCurrent)) return [];
      if ("applies" in milestone && milestone.applies && !milestone.applies(file)) return [];
      if (
        isAfterWarrantyBgDelayMilestone(milestone.key) &&
        hasPendingWarrantyBgBeforeLaterMilestone(file, order)
      ) {
        return [];
      }
      if (milestone.key === "advancePayment") {
        if (!isAdvancePaymentPending(order)) return [];
      } else if (!isOrderCurrentForDelayMilestone(file, order, normalizedCurrent)) {
        return [];
      }
      if (hasDate(milestone.complete(file, order))) return [];
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
          stageStartDate,
          daysInStage,
          cumulativeDelayDays: null,
          lastFilledDate: getLastFilledDateValue(file) ?? "",
          focusSection: "Supply order and payment",
          focusTarget: getDelayStatusFocusTarget(milestone.current, order, orderIndex, stageIndex),
        },
      ];
    });
  });
}

function isAfterWarrantyBgDelayMilestone(key: string) {
  return (
    key === "irPreparation" ||
    key === "irReceipt" ||
    key === "billPreparation" ||
    key === "billSentForPayment" ||
    key === "payment"
  );
}

function hasPendingWarrantyBgBeforeLaterMilestone(file: FileRecord, order: SupplyOrderDetail) {
  return (
    (isWarrantyBgCategoryApplicable(file, order, "pwb") &&
      !hasFilledString(order.pwbBgReceivedDate)) ||
    (isWarrantyBgCategoryApplicable(file, order, "psbpwb") &&
      !hasFilledString(order.combinedBgReceivedDate))
  );
}

function getSupplementaryBillReturnedDelayRows(
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
    if (!isPaymentOrderActive(file, order) || isShortclosureNoFurtherAction(order)) return [];
    return getSupplementaryBills(order).flatMap((bill, billIndex) => {
      if (!isSupplementaryBillReturned(bill)) return [];
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
          milestone: supplementaryBillReturnedDelayMilestoneLabel,
          stageStartDate,
          daysInStage,
          cumulativeDelayDays: null,
          lastFilledDate: getLastFilledDateValue(file) ?? "",
          focusSection: "Supply order and payment",
          focusTarget: `supplementarybill:returned:${orderIndex}:${billIndex}`,
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
    if (!isPaymentOrderActive(file, order) || isShortclosureNoFurtherAction(order) || !hasOpenBillReturn(order)) return [];
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
        stageStartDate,
        daysInStage,
        cumulativeDelayDays: null,
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
  if (milestone.key === "cnc") {
    return isYes(file.tcec) ? file.postTcecMinutesDate : undefined;
  }
  if (milestone.key === "postTcec" &&
    (!isYes(file.tcec) || !isYes(file.biddingStageOver) || !hasFilledString(file.bidOpeningDate))) {
    return undefined;
  }
  if (milestone.key === "refloatPostTcec" &&
    (!isYes(file.refloat) || !isYes(file.tcec) || !isYes(file.biddingStageOver) || !hasFilledString(file.refloatBidOpeningDate))) {
    return undefined;
  }
  const milestoneIndex = milestoneDefinitions.findIndex((item) => item.key === milestone.key);
  const fileMilestoneEnd = milestoneDefinitions.findIndex(
    (item) => item.key === "financialSanction",
  );
  const possiblePredecessors = isFlexiblePreControlMilestone(milestone)
    ? milestoneDefinitions
        .slice(0, fileMilestoneEnd < 0 ? milestoneDefinitions.length : fileMilestoneEnd)
        .filter(
          (candidate) =>
            candidate.key === "scrutiny" || isFlexiblePreControlMilestone(candidate),
        )
    : milestoneDefinitions.slice(0, milestoneIndex);
  const currentDate = formatLocalDate(new Date());
  const cutoff = parseLocalDateTime(currentDate);
  const candidates = [file.receivedDate].filter((date): date is string => {
    const time = parseLocalDateTime(date ?? "");
    return time !== undefined && (cutoff === undefined || time <= cutoff);
  });

  possiblePredecessors.forEach((candidate) => {
    if (
      candidate.key === milestone.key ||
      !isMilestoneApplicable(file, candidate) ||
      !isMilestoneComplete(file, candidate)
    ) {
      return;
    }
    const date = getMilestoneCompletionDate(file, candidate);
    const time = parseLocalDateTime(date ?? "");
    if (date && time !== undefined && (cutoff === undefined || time <= cutoff)) {
      candidates.push(date);
    }
  });

  return latestDateValue(candidates);
}

function getCumulativeDelayDays(file: FileRecord, milestone: MilestoneDefinition) {
  if (!milestone.reviewed || !milestone.current || milestone.key === "financialSanction") {
    return null;
  }
  return getDaysSinceDate(getMilestoneStageStartDate(file, milestone)) ?? null;
}

function getMilestoneCompletionDate(file: FileRecord, milestone: MilestoneDefinition) {
  if (milestone.key === "bidding") {
    return isYes(file.refloat) ? file.refloatBidOpeningDate : file.bidOpeningDate;
  }
  if (milestone.key === "refloatBidding") {
    return file.refloatBidOpeningDate;
  }
  return getFieldDateValue(file, milestone.current);
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

function getDateDifference(startDate: string | undefined, endDate: string | undefined) {
  const startTime = parseLocalDateTime(startDate ?? "");
  const endTime = parseLocalDateTime(endDate ?? "");
  if (startTime === undefined || endTime === undefined) return undefined;
  return Math.round((endTime - startTime) / 86_400_000);
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
    file.refloatGemUndertakingDate,
    file.refloatRecommendationDate,
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
    file.refloatGemUndertakingDate,
    file.refloatRecommendationDate,
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
    file.refloatGemUndertakingDate,
    file.refloatRecommendationDate,
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

function getDelayStatusSummary(rows: DelayStatusRow[], selectedMilestoneKey: string) {
  const totalDays = rows.reduce((sum, row) => sum + row.daysInStage, 0);
  const counts = new Map<
    string,
    { key: string; label: string; caseCount: number; fileIds: Set<string> }
  >();
  rows.forEach((row) => {
    const current = counts.get(row.milestoneKey) ?? {
      key: row.milestoneKey,
      label: row.milestone,
      caseCount: 0,
      fileIds: new Set<string>(),
    };
    current.caseCount += 1;
    current.fileIds.add(row.fileId);
    counts.set(row.milestoneKey, current);
  });
  if (selectedMilestoneKey === "all") {
    if (!counts.has(gemUndertakingDelayMilestoneKey)) {
      counts.set(gemUndertakingDelayMilestoneKey, {
        key: gemUndertakingDelayMilestoneKey,
        label: gemUndertakingDelayMilestoneLabel,
        caseCount: 0,
        fileIds: new Set<string>(),
      });
    }
    if (!counts.has("bidding")) {
      counts.set("bidding", {
        key: "bidding",
        label: "Bidding",
        caseCount: 0,
        fileIds: new Set<string>(),
      });
    }
  }

  return {
    averageDays: rows.length ? Math.round(totalDays / rows.length) : 0,
    longestDays: rows.reduce((max, row) => Math.max(max, row.daysInStage), 0),
    byMilestone: Array.from(counts.values())
      .map(({ key, label, caseCount, fileIds }) => ({
        key,
        label,
        count:
          key === "financialSanction" ||
          key === nonTcecTechnicalEvaluationDelayKey ||
          key === "paymentPreSubmission" ||
          key === "paymentPostSubmission" ||
          key === "paymentCumulative" ||
          ["psb", "pwb", "psbPwb"].includes(key)
            ? caseCount
            : fileIds.size,
        ...(["financialSanction", nonTcecTechnicalEvaluationDelayKey, "paymentPreSubmission", "paymentPostSubmission", "paymentCumulative", "psb", "pwb", "psbPwb"].includes(key)
          ? { fileCount: fileIds.size }
          : {}),
      }))
      .sort((a, b) => b.count - a.count),
  };
}

export function getStatusSummaryTableGroups(
  files: FileRecord[],
  bgReturnOffsetDays = 60,
  bgReturnTrackingFiles = files,
): StatusSummaryTableGroup[] {
  const byMilestone = new Map<string, StatusSummaryTableRow & { columns: StatusSummaryColumn[] }>();

  [
    ...getStatusSummaryRows(files, bgReturnOffsetDays, bgReturnTrackingFiles),
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
    {
      milestone: "Supplementary Bill",
      stage: "Submitted total",
      count: countSupplementaryBillSubmittedOrders(files),
    },
    {
      milestone: "Supplementary Bill",
      stage: "Returned total",
      count: countSupplementaryBillReturnedOrders(files),
    },
    {
      milestone: "Supplementary Bill",
      stage: "Return pending",
      count: countSupplementaryBillReturnedPendingOrders(files),
    },
    {
      milestone: "Supplementary Bill",
      stage: "Resubmitted total",
      count: countSupplementaryBillResubmittedOrders(files),
    },
    {
      milestone: "Supplementary Bill",
      stage: "Returned paid",
      count: countReturnedSupplementaryBillPaidOrders(files),
    },
    {
      milestone: "Supplementary Bill",
      stage: "Normal paid",
      count: countNormalSupplementaryBillPaidOrders(files),
    },
    {
      milestone: "Supplementary Bill",
      stage: "Pending",
      count: countSupplementaryBillPendingOrders(files),
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

  if (columns.includes("Due") && columns.includes("Submitted")) {
    return ["Due", "In process", "Submitted", "Completed"].filter((column) =>
      columns.includes(column as StatusSummaryColumn),
    ) as StatusSummaryColumn[];
  }

  if (columns.includes("Bills returned")) {
    return ["Bills returned", "Return pending", "Resubmitted and Unpaid", "Returned paid"].filter((column) =>
      columns.includes(column as StatusSummaryColumn),
    ) as StatusSummaryColumn[];
  }

  if (columns.includes("Submitted total")) {
    return [
      "Submitted total",
      "Returned total",
      "Return pending",
      "Resubmitted total",
      "Returned paid",
      "Normal paid",
      "Pending",
    ].filter((column) => columns.includes(column as StatusSummaryColumn)) as StatusSummaryColumn[];
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
  if (columns.length === 2 && columns.includes("Total") && columns.includes("Pending")) {
    return "Financial Sanction";
  }
  if (columns.includes("Total cases")) return "Case approval milestones";
  if (columns.includes("Reviewed")) return "File approval milestones";
  if (columns.includes("Opening overdue")) return "Bidding";
  if (columns.includes("Placed")) return "Supply Order";
  if (columns.includes("Received")) return "PSB / PWB";
  if (columns.includes("Valid")) return "Delivery Period";
  if (columns.includes("Refloat Due")) return "Pre-Bid Meeting";
  if (columns.some((column) => ["Submitted", "Returned", "Resubmitted and Unpaid", "Paid"].includes(column))) {
    return "Payment";
  }
  if (columns.includes("Submitted total")) return "Payment";
  if (columns.includes("Bills returned")) return "Payment";
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

function getStatusSummaryRows(
  files: FileRecord[],
  bgReturnOffsetDays = 60,
  bgReturnTrackingFiles = files,
): StatusSummaryRow[] {
  const rows = milestoneDefinitions.flatMap((milestone) =>
    getMilestoneStatusRows(files, milestone, bgReturnOffsetDays, bgReturnTrackingFiles),
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
        ({ file, order }) =>
          isAdvancePaymentPending(order) &&
          isPaymentOrderActive(file, order) &&
          !isShortclosureNoFurtherAction(order),
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

function countDeliveryPeriodEntries(
  files: FileRecord[],
  predicate: (file: FileRecord, order: SupplyOrderDetail) => boolean,
) {
  return files.reduce(
    (count, file) =>
      count + fileSupplyOrders(file).filter((order) => predicate(file, order)).length,
    0,
  );
}

function getMilestoneStatusRows(
  files: FileRecord[],
  milestone: MilestoneDefinition,
  bgReturnOffsetDays = 60,
  bgReturnTrackingFiles = files,
): StatusSummaryRow[] {
  const applicableFiles = files.filter((file) => isMilestoneApplicable(file, milestone));
  const processFiles = applicableFiles.filter((file) => !isCancelledFile(file));
  const reachedFiles = processFiles.filter((file) => isEligibleMilestone(file, milestone));
  const activeFiles = processFiles.filter((file) => isManualActiveMilestone(file, milestone));
  const reviewedFiles = activeFiles.filter((file) => isMilestoneReviewed(file, milestone));
  const pendingFiles = activeFiles.filter((file) => isPendingMilestone(file, milestone));
  const clearedFiles = processFiles.filter((file) => isMilestoneComplete(file, milestone));
  const base = (stage: string, count: number) => ({ milestone: milestone.label, stage, count });

  if (isBgMilestoneKey(milestone.key)) {
    return [
      base("Received", countBgReceivedOrders(processFiles, milestone.key)),
      base("Pending", countBgPendingOrders(processFiles, milestone.key)),
      base("Expired", countBgExpiredOrders(processFiles, milestone.key)),
      base(
        "To be returned",
        countBgToBeReturnedOrders(
          bgReturnTrackingFiles,
          milestone.key,
          bgReturnOffsetDays,
        ),
      ),
      base("Returned", countBgReturnedOrders(processFiles, milestone.key)),
    ];
  }

  if (milestone.key === "payment") {
    return [
      base("Due", countPaymentDueOrders(processFiles)),
      base("In process", countPaymentInProcessOrders(processFiles)),
      base("Submitted", countPaymentSubmittedOrders(processFiles)),
      base("Completed", countPaymentCompletedOrders(processFiles)),
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
      base(
        "Live",
        processFiles.filter((file) => isYes(file.refloat) && isFileTenderLive(file)).length,
      ),
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
        processFiles.filter(
          (file) => isYes(file.refloat) && isYes(file.tcec) && !isYes(file.biddingStageOver),
        ).length,
      ),
      base("In process", pendingRefloatPostTcec.length),
      base("Reviewed", reviewedRefloatPostTcec.length),
      base("Pending", pendingRefloatPostTcec.length),
    ];
  }

  if (milestone.key === "bidding") {
    const biddingInProgressFiles = processFiles.filter(isBiddingInProgressFile);
    return [
      base("Completed", clearedFiles.length),
      base(
        "In process",
        biddingInProgressFiles.filter((file) => !isFileTenderLive(file) && !isBidOverdue(file))
          .length,
      ),
      base("Opening overdue", biddingInProgressFiles.filter(isBidOverdue).length),
      base(
        "Live",
        processFiles.filter((file) => !isYes(file.refloat) && isFileTenderLive(file)).length,
      ),
      base("At previous stages", countAtPreviousStageFiles(applicableFiles, milestone)),
    ];
  }

  if (milestone.key === "supplyOrder") {
    return [
      base("Placed", countCompletedOrderDrivenMilestoneStatuses(files, "supplyorder")),
      base("Live", countLiveSupplyOrders(files)),
      base(
        "At Previous Stage",
        countCurrentOrderDrivenMilestoneStatuses(files, "financialsanction"),
      ),
      base("Pending", countCurrentOrderDrivenMilestoneStatuses(files, "supplyorder")),
    ];
  }

  if (milestone.key === "financialSanction") {
    const completed = countCompletedOrderDrivenMilestoneStatuses(files, "financialsanction");
    const pending = countCurrentOrderDrivenMilestoneStatuses(files, "financialsanction");
    return [
      base("At Previous Stage", countFinancialSanctionPreviousStageFiles(files)),
      base("Completed", completed),
      base("Pending", pending),
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
    return isYes(file.refloat) && isRefloatBiddingStageComplete(file);
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

function hasMilestoneDate(file: FileRecord, key: keyof FileRecord | keyof SupplyOrderDetail) {
  return supplyOrderDateKeys.has(key as keyof SupplyOrderDetail)
    ? fileSupplyOrders(file).some((order) => {
        const value = order[key as keyof SupplyOrderDetail];
        return typeof value === "string" && hasFilledString(value);
      })
    : hasFilledField(file, key as keyof FileRecord);
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

function finalPaymentOrders(file: FileRecord) {
  return filePaymentOrders(file).filter((order) => order.stageDeliveryLabel !== "Advance Payment");
}

function countPaymentCompletedOrders(files: FileRecord[]) {
  return files.reduce(
    (sum, file) =>
      sum +
      finalPaymentOrders(file).filter(
        (order) => hasFilledString(order.paymentDate) && isPaymentOrderActive(file, order),
      ).length,
    0,
  );
}

function countPaymentPendingOrders(files: FileRecord[]) {
  return files.reduce(
    (sum, file) =>
      sum +
      finalPaymentOrders(file).filter(
        (order) =>
          hasPaymentWorkflowStarted(file, order) &&
          !hasFilledString(order.paymentDate) &&
          isPaymentOrderActive(file, order),
      ).length,
    0,
  );
}

function countPaymentDueOrders(files: FileRecord[]) {
  return countFinalPaymentOrders(files, isPaymentDueOrder);
}

function countPaymentInProcessOrders(files: FileRecord[]) {
  return countFinalPaymentOrders(files, isPaymentInProcessOrder);
}

function countPaymentSubmittedOrders(files: FileRecord[]) {
  return countFinalPaymentOrders(files, isPaymentSubmittedOrder);
}

function countFinalPaymentOrders(
  files: FileRecord[],
  predicate: (file: FileRecord, order: SupplyOrderDetail) => boolean,
) {
  return files.reduce(
    (sum, file) => sum + finalPaymentOrders(file).filter((order) => predicate(file, order)).length,
    0,
  );
}

function isNormalPaymentOpenOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasPaymentWorkflowStarted(file, order) &&
    !hasFilledString(order.paymentDate) &&
    isPaymentOrderActive(file, order) &&
    !isShortclosureNoFurtherAction(order) &&
    !hasReturnedBill(order)
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

function countSupplementaryBillSubmittedOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(files, isSupplementaryBillSubmitted);
}

function countSupplementaryBillReturnedOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(files, isSupplementaryBillReturned);
}

function countSupplementaryBillReturnedPendingOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(files, isSupplementaryBillReturnPending);
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

function countSupplementaryBillPendingOrders(files: FileRecord[]) {
  return countSupplementaryBillOrders(files, isSupplementaryBillPaymentPending, true);
}

function countSupplementaryBillOrders(
  files: FileRecord[],
  predicate: (bill: SupplementaryBillDetail) => boolean,
  pendingOnly = false,
) {
  return files.reduce(
    (sum, file) =>
      sum +
      rawSupplyOrders(file).reduce((orderCount, order) => {
        if (
          !isPaymentOrderActive(file, order) ||
          (pendingOnly && isShortclosureNoFurtherAction(order))
        ) return orderCount;
        return orderCount + getSupplementaryBills(order).filter(predicate).length;
      }, 0),
    0,
  );
}

function getSupplementaryBills(order: SupplyOrderDetail): SupplementaryBillDetail[] {
  return Array.isArray(order.supplementaryBills)
    ? order.supplementaryBills.filter(
        (bill): bill is SupplementaryBillDetail =>
          Boolean(bill) && typeof bill === "object" && hasSupplementaryBillData(bill),
      )
    : [];
}

function hasSupplementaryBillData(bill: SupplementaryBillDetail) {
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

function isSupplementaryBillSubmitted(bill: SupplementaryBillDetail) {
  return hasFilledString(bill.billSentForPaymentDate);
}

function isSupplementaryBillReturned(bill: SupplementaryBillDetail) {
  return hasSupplementaryBillReturnHistory(bill);
}

function isSupplementaryBillReturnPending(bill: SupplementaryBillDetail) {
  return !hasFilledString(bill.paymentDate) && hasOpenSupplementaryBillReturn(bill);
}

function isSupplementaryBillResubmitted(bill: SupplementaryBillDetail) {
  return hasCompletedSupplementaryBillReturn(bill);
}

function isSupplementaryBillPaid(bill: SupplementaryBillDetail) {
  return hasFilledString(bill.paymentDate);
}

function isNormalSupplementaryBillPaid(bill: SupplementaryBillDetail) {
  return isSupplementaryBillPaid(bill) && !hasSupplementaryBillReturnHistory(bill);
}

function isReturnedSupplementaryBillPaid(bill: SupplementaryBillDetail) {
  return isSupplementaryBillPaid(bill) && hasCompletedSupplementaryBillReturn(bill);
}

function isSupplementaryBillPaymentPending(bill: SupplementaryBillDetail) {
  return hasFilledString(bill.billSentForPaymentDate) && !hasFilledString(bill.paymentDate);
}

function hasSupplementaryBillReturnHistory(bill: SupplementaryBillDetail) {
  return (bill.billReturnCycles ?? []).some(hasBillReturnCycleData);
}

function getActiveSupplementaryBillSubmissionDate(bill: SupplementaryBillDetail) {
  const latest = latestBillReturnCycle(bill.billReturnCycles);
  return latest?.resubmittedDate || bill.billSentForPaymentDate;
}

function hasOpenSupplementaryBillReturn(bill: SupplementaryBillDetail) {
  const latest = latestBillReturnCycle(bill.billReturnCycles);
  return Boolean(latest && !hasFilledString(latest.resubmittedDate));
}

function hasCompletedSupplementaryBillReturn(bill: SupplementaryBillDetail) {
  const latest = latestBillReturnCycle(bill.billReturnCycles);
  return Boolean(latest && hasFilledString(latest.resubmittedDate));
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
          !isShortclosureNoFurtherAction(order),
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

function isWarrantyBgCategoryApplicable(
  file: FileRecord,
  order: SupplyOrderDetail,
  category: string,
) {
  const normalized = normalizeMilestoneName(category);
  return (
    (normalized === "pwb" || normalized === "psbpwb") &&
    isBgCategoryApplicable(file, order, normalized)
  );
}

function isOrderCurrentForMilestone(
  file: FileRecord,
  order: SupplyOrderDetail,
  normalizedMilestone: string,
) {
  return isCanonicalSupplyOrderMilestoneCurrent(file, order, normalizedMilestone);
}

function isOrderCurrentForDelayMilestone(
  file: FileRecord,
  order: SupplyOrderDetail,
  normalizedMilestone: string,
) {
  if (isOrderCurrentForMilestone(file, order, normalizedMilestone)) return true;
  if (!isParentStagePaymentOrder(order)) return false;
  return (order.stageDeliveries ?? []).some((stage) =>
    isOrderCurrentForMilestone(file, { ...order, ...stage }, normalizedMilestone),
  );
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

function isOrderMilestoneApplicable(file: FileRecord, normalizedMilestone: string) {
  if (normalizedMilestone === "bankguarantee") return isYes(file.bg);
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

function countCurrentOrderDrivenMilestoneStatuses(
  files: FileRecord[],
  normalizedMilestone: string,
) {
  return files.reduce((total, file) => {
    if (isYes(file.demandCancelled)) return total;
    if (!isPaymentMilestone(normalizedMilestone) && isCancelledFile(file)) return total;
    if (normalizedMilestone === "financialsanction" && !shouldUseOrderMilestoneRows(file)) {
      return (
        total +
        (isFinancialSanctionReached(file) &&
        !matchesCompletedSupplyOrderDrivenMilestone(file, "financialsanction")
          ? 1
          : 0)
      );
    }
    if (normalizedMilestone === "advancepayment") {
      return (
        total +
        advancePaymentEntries([file]).filter(
          ({ file: entryFile, order }) =>
            isAdvancePaymentPending(order) && isPaymentOrderActive(entryFile, order),
        ).length
      );
    }
    if (normalizedMilestone === "payment") {
      return total + countPaymentPendingOrders([file]);
    }
    if (!shouldUseOrderMilestoneRows(file)) {
      return (
        total + (normalizeMilestoneName(file.currentMilestone) === normalizedMilestone ? 1 : 0)
      );
    }
    return (
      total +
      orderDrivenMilestoneRows(file, normalizedMilestone).filter(
        (order) =>
          isOrderActiveForCurrentMilestone(file, order, normalizedMilestone) &&
          isOrderCurrentForMilestone(file, order, normalizedMilestone),
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
  if (isYes(file.tcec)) return current === "cnc" && !hasFilledString(file.cncApprovalDate);
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
        (file.completedMilestones?.some(
          (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
        )
          ? 1
          : 0)
      );
    }
    return (
      total +
      orderDrivenMilestoneRows(file, normalizedMilestone).filter(
        (order) =>
          isOrderActiveForMilestone(file, order, normalizedMilestone) &&
          (normalizedMilestone === "financialsanction"
            ? hasFilledString(order.financialSanctionDate)
            : isDateCompletedPaymentMilestoneOrder(order, normalizedMilestone)
              ? true
              : order.completedMilestones?.some(
                  (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
                )),
      ).length
    );
  }, 0);
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
      return Boolean(
        fileSupplyOrders(file).some(
          (order) =>
            !isSupplyOrderCancelled(file, order) && hasFilledString(order.financialSanctionDate),
        ),
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
  const triggerDate = getPaymentWorkflowStartDate(file, order);
  return hasFilledString(triggerDate) && !isDateAfterToday(triggerDate);
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
  if (isGoodsServicesIrNo(file) && isParentStagePaymentOrder(order)) {
    return getParentStagePaymentDate(order, "jobCompletionDate");
  }
  if (isDeliveryInspectionApplicable(file)) {
    return isParentStagePaymentOrder(order)
      ? getParentStagePaymentDate(order, "materialReceiptDate")
      : order.materialReceiptDate;
  }
  return getNonInspectionPaymentDueDate(file, order);
}

function getParentStageDeliveryPeriodDate(order: SupplyOrderDetail) {
  if (!isParentStagePaymentOrder(order) || !order.stageDeliveries?.length) return undefined;
  const dates = order.stageDeliveries.map((stage) => stage.revisedDp || stage.dpDate || "");
  if (dates.some((date) => !hasFilledString(date))) return undefined;
  return dates.sort((a, b) => a.localeCompare(b)).at(-1);
}

function getNonInspectionPaymentDueDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isGoodsServicesIrNo(file)) return order.jobCompletionDate;
  const dpTrigger = addDays(getDeliveryPeriodDate(order), 1);
  if (!isContractFileType(file) || !hasFilledString(order.jobCompletionDate)) return dpTrigger;
  if (!dpTrigger) return order.jobCompletionDate;
  return order.jobCompletionDate! < dpTrigger ? order.jobCompletionDate : dpTrigger;
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

export function getBgStatusSummaryAuditCounts(
  files: FileRecord[],
  bgReturnOffsetDays = 60,
): BgStatusSummaryAuditCount[] {
  const entries = rawSupplyOrderEntries(files.filter((file) => !isCancelledFile(file)));
  const bgReturnEntries = rawSupplyOrderEntries(
    files.filter((file) => !isDemandCancelled(file)),
  );
  const categories = [
    { milestone: "PSB", category: "psb" },
    { milestone: "PWB", category: "pwb" },
    { milestone: "PSB+PWB", category: "psbpwb" },
  ];

  return categories.flatMap(({ milestone, category }) => {
    const stages = [
      {
        stage: "Received",
        qualifies: (file: FileRecord, order: SupplyOrderDetail) =>
          isBgCategoryApplicable(file, order, category) &&
          isBgReceivedOrder(order, category) &&
          !isSupplyOrderCancelled(file, order),
      },
      {
        stage: "Pending",
        qualifies: (file: FileRecord, order: SupplyOrderDetail) =>
          isBgPendingOrder(file, order, category),
      },
      {
        stage: "Expired",
        qualifies: (file: FileRecord, order: SupplyOrderDetail) =>
          isBgExpiredOrder(file, order, category),
      },
      {
        stage: "To be returned",
        qualifies: (file: FileRecord, order: SupplyOrderDetail) =>
          isBgReturnDueOrder(file, order, category, bgReturnOffsetDays),
      },
      {
        stage: "Returned",
        qualifies: (file: FileRecord, order: SupplyOrderDetail) =>
          isBgReturnedOrder(file, order, category),
      },
    ];
    return stages.map(({ stage, qualifies }) => {
      const stageEntries = stage === "To be returned" ? bgReturnEntries : entries;
      const matches = stageEntries.filter(({ file, order }) => qualifies(file, order));
      return {
        milestone,
        stage,
        supplyOrderCaseCount: matches.length,
        uniqueFileCount: new Set(matches.map(({ file }) => file.id)).size,
      };
    });
  });
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

function isBgReceivedOrder(order: SupplyOrderDetail, category: string) {
  return (
    hasFilledString(getBgReceivedDate(order, category)) ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === normalizeMilestoneName(category),
    )
  );
}

function isCancelledFile(file: FileRecord) {
  if (isDemandCancelled(file)) return true;
  const orders = rawSupplyOrders(file);
  if (orders.length === 0) return false;
  return orders.every((order) => isYes(order.soCancelled));
}

function isDemandCancelled(file: FileRecord) {
  return isYes(file.demandCancelled);
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
  return isPaymentMilestone(normalizedMilestone)
    ? isPaymentOrderActive(file, order) && !isShortclosureNoFurtherAction(order)
    : !isSupplyOrderCancelled(file, order);
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

function isFileClosed(file: Pick<FileRecord, "completedMilestones">) {
  return Boolean(
    file.completedMilestones?.some(
      (milestone) =>
        normalizeMilestoneName(milestone) === normalizeMilestoneName(fileClosedMilestone),
    ),
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
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some((order) => isCompletedDeliveryOrder(file, order))
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

function isDeliveryDue(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isSupplyOrderPlaced(file) &&
    fileSupplyOrders(file).some(
      (order) => !isSupplyOrderCancelled(file, order) && isPendingDeliveryOrder(file, order),
    )
  );
}

function isCompletedDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasSupplyOrderDate(order) &&
    isDeliveryInspectionApplicable(file) &&
    hasFilledString(order.materialReceiptDate)
  );
}

function isJobCompletionWorkflow(file: FileRecord) {
  return !isDeliveryInspectionApplicable(file);
}

function isGoodsServicesIrNo(file: FileRecord) {
  return !isContractFileType(file) && isNo(file.ir);
}

function isAmcMpcOmFile(file: FileRecord) {
  return isContractFileType(file);
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
    !isCompletedDeliveryOrder(file, order) &&
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
  const normalizedCategory = normalizeMilestoneName(category);
  if (isYes(order.soCancelled)) return true;
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
  if (!isWarrantyBgCategoryApplicable(file, order, category)) return false;
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

function getEffectiveBidOpeningDate(file: FileRecord) {
  return isYes(file.refloat) ? file.refloatBidOpeningDate : file.bidOpeningDate;
}

function getFinancialSanctionDelayStartDate(file: FileRecord) {
  if (isYes(file.tcec)) return file.cncApprovalDate;
  if (isBiddingApplicableForFile(file)) return getEffectiveBidOpeningDate(file);
  return file.cfaDate;
}

function getTcecSupplyOrderDelayStartDate(file: FileRecord, order: SupplyOrderDetail) {
  void order;
  return file.cncApprovalDate;
}

function isRefloatBidOverdue(file: FileRecord) {
  return isNo(file.bidOpened) && isDateBeforeToday(file.refloatBidOpeningDate);
}

function isBidOverdue(file: FileRecord) {
  return isNo(file.bidOpened) && isDateBeforeToday(getEffectiveBidOpeningDate(file));
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

function isDateBefore(date: string | undefined, reference: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const referenceTime = parseLocalDateTime(reference ?? "");
  return dateTime !== undefined && referenceTime !== undefined && dateTime < referenceTime;
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

function parseLocalDateTime(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00`);
  const time = parsed.getTime();
  return Number.isNaN(time) ? undefined : time;
}

function addDays(date: string | undefined, days: number) {
  const time = parseLocalDateTime(date ?? "");
  if (time === undefined) return undefined;
  const next = new Date(time);
  next.setDate(next.getDate() + days);
  return formatLocalDate(next);
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthLabel(date: string) {
  const time = parseLocalDateTime(date);
  if (time === undefined) return date;
  const parsed = new Date(time);
  const month = new Intl.DateTimeFormat("en-IN", { month: "short" }).format(parsed).slice(0, 3);
  return `${month}-${parsed.getFullYear()}`;
}

function parseAmount(value: string | number | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (!value) return undefined;
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getInrAmount(
  value: string | number | undefined,
  file: Pick<FileRecord, "currency" | "exchangeRate">,
) {
  const amount = parseAmount(value);
  if (amount === undefined) return undefined;
  const currency = file.currency?.trim().toLowerCase();
  if (!currency || currency === "inr" || currency === "rs" || currency === "rupee") return amount;
  const exchangeRate = parseAmount(file.exchangeRate);
  return exchangeRate === undefined ? amount : amount * exchangeRate;
}
