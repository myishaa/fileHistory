import type { FileRecord, SupplyOrderDetail } from "../types.js";
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
} from "./effective-deliveries.js";

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
  lastFilledDate: string;
  focusSection?: string;
  focusTarget?: string;
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
  "To be returned",
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
    current: "adVettingDate",
    applies: (file: FileRecord) => isYes(file.ad),
  },
  {
    key: "rqa",
    label: "R&QA",
    totalLabel: "Total cases",
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
  { key: "bidding", label: "Bidding", totalLabel: "Total files", current: "biddingStageOver" },
  {
    key: "postTcec",
    label: "Post-TCEC",
    totalLabel: "Total cases",
    reviewed: "postTcecDate",
    current: "postTcecMinutesDate",
    applies: (file: FileRecord) => isYes(file.tcec),
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
    key: "bankGuarantee",
    label: "Bank Guarantee",
    completedLabel: "Received",
    totalLabel: "Total files",
    current: "bgValidityDate",
    applies: (file: FileRecord) => isYes(file.bg),
  },
  { key: "payment", label: "Payment", totalLabel: "Total files", current: "paymentDate" },
] satisfies MilestoneDefinition[];

const supplyOrderMilestoneNames = [
  "Financial Sanction",
  "Advance Payment",
  "Supply Order",
  "Bank Guarantee",
  "Delivery",
  "IR Preparation",
  "IR Receipt",
  "Bill preparation",
  "Bill sent for payment",
  "Payment",
];

const supplyOrderDateKeys = new Set<keyof SupplyOrderDetail>([
  "financialSanctionDate",
  "soDate",
  "bgValidityDate",
  "irPreparationDate",
  "irReceiptDate",
  "billPreparationDate",
  "billSentForPaymentDate",
  "paymentDate",
  "soCancelledDate",
]);

export function buildReportsSummary({
  files,
  division,
  delayDays,
  delayMilestone,
  expectedCashOutgoDays = 0,
  historicalFromDate,
  historicalToDate,
  cashOutgoAsOfDate,
}: {
  files: FileRecord[];
  division: string;
  delayDays: number;
  delayMilestone: string;
  expectedCashOutgoDays?: number;
  historicalFromDate?: string;
  historicalToDate?: string;
  cashOutgoAsOfDate?: string;
}) {
  const reportFiles =
    (division === "all" ? files : files.filter((file) => file.division === division)).filter(
      (file) => !isCancelledFile(file),
    );
  const activeStatusFiles = reportFiles;
  const delayRows = getDelayStatusRows(activeStatusFiles, delayDays, delayMilestone);
  const historicalRange =
    historicalFromDate && historicalToDate && historicalFromDate <= historicalToDate
      ? { fromDate: historicalFromDate, toDate: historicalToDate }
      : undefined;

  return {
    activeDivision: division,
    reportFileCount: reportFiles.length,
    statusSummaryGroups: getStatusSummaryTableGroups(activeStatusFiles),
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
      reportFiles,
      expectedCashOutgoDays,
      historicalRange,
    ),
    expectedCashOutgoBillPreparationRows: getExpectedCashOutgoByBillPreparationRows(
      reportFiles,
      historicalRange,
      cashOutgoAsOfDate,
    ),
    billSentForPaymentRows: getBillSentForPaymentRows(
      reportFiles,
      historicalRange,
      cashOutgoAsOfDate,
    ),
    actualCashOutgoRows: getActualCashOutgoRows(reportFiles, historicalRange),
    delayRows,
    delaySummary: getDelayStatusSummary(delayRows),
  };
}

function getExpectedCashOutgoByDpRows(
  files: FileRecord[],
  offsetDays = 0,
  asOfDate?: string,
): CashOutgoRow[] {
  const totals = new Map<string, CashOutgoRow>();

  files.forEach((file) => {
    if (isCancelledFile(file)) return;
    fileSupplyOrders(file).forEach((order) => {
      const deliveryPeriodDate = getDeliveryPeriodDate(order);
      if (!hasFilledString(deliveryPeriodDate) || isSupplyOrderCancelled(file, order)) return;
      if (!isExpectedDpCashOutgoPending(file, order, asOfDate)) return;
      const cashOutgoDate = addDays(deliveryPeriodDate, offsetDays + 1);
      if (!cashOutgoDate) return;

      addCashOutgoTotal(totals, cashOutgoDate, file, order);
    });
  });

  return finalizeCashOutgoRows(totals);
}

function isExpectedDpCashOutgoPending(
  file: FileRecord,
  order: SupplyOrderDetail,
  asOfDate?: string,
) {
  if (isDeliveryInspectionApplicable(file)) {
    return asOfDate
      ? isMissingOrAfter(order.materialReceiptDate, asOfDate) &&
          isMissingOrAfter(order.paymentDate, asOfDate)
      : !hasFilledString(order.materialReceiptDate) && !hasFilledString(order.paymentDate);
  }

  return asOfDate
    ? isMissingOrAfter(order.billPreparationDate, asOfDate) &&
        isMissingOrAfter(order.billSentForPaymentDate, asOfDate) &&
        isMissingOrAfter(order.paymentDate, asOfDate)
    : !hasFilledString(order.billPreparationDate) &&
        !hasFilledString(order.billSentForPaymentDate) &&
        !hasFilledString(order.paymentDate);
}

function getExpectedCashOutgoByReceiptRows(
  files: FileRecord[],
  offsetDays = 0,
  asOfDate?: string,
): CashOutgoRow[] {
  const totals = new Map<string, CashOutgoRow>();

  files.forEach((file) => {
    if (isCancelledFile(file)) return;
    fileSupplyOrders(file).forEach((order) => {
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
    if (isCancelledFile(file)) return;
    fileSupplyOrders(file).forEach((order) => {
      if (isSupplyOrderCancelled(file, order)) return;
      const reportDate = getReceiptPendingBillReportDate(file, order);
      if (!hasFilledString(reportDate)) return;
      if (dateRange) {
        if (!isOnOrBefore(reportDate, dateRange.toDate)) return;
        if (!isMissingOrAfter(order.billPreparationDate, dateRange.toDate)) return;
        if (!isMissingOrAfter(order.paymentDate, dateRange.toDate)) return;
      } else {
        if (hasFilledString(order.billPreparationDate)) return;
        if (hasFilledString(order.paymentDate)) return;
      }
      const cashOutgoDate = addDays(reportDate, offsetDays);
      if (!cashOutgoDate) return;
      if (dateRange && !isWithinDateRange(cashOutgoDate, dateRange)) return;

      addCashOutgoTotal(totals, cashOutgoDate, file, order);
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getReceiptPendingBillReportDate(file: FileRecord, order: SupplyOrderDetail) {
  return isDeliveryInspectionApplicable(file)
    ? order.materialReceiptDate
    : addDays(getDeliveryPeriodDate(order), 1);
}

function getExpectedCashOutgoByBillPreparationRows(
  files: FileRecord[],
  dateRange?: { fromDate: string; toDate: string },
  asOfDate?: string,
): CashOutgoRow[] {
  const totals = new Map<string, CashOutgoRow>();

  files.forEach((file) => {
    if (isCancelledFile(file)) return;
    filePaymentOrders(file).forEach((order) => {
      const isAdvancePayment = order.stageDeliveryLabel === "Advance Payment";
      if (isSupplyOrderCancelled(file, order)) return;
      const reportDate = getReceiptPendingBillReportDate(file, order);
      if (!isAdvancePayment && !hasFilledString(reportDate)) return;
      if (!hasFilledString(order.billPreparationDate)) return;
      if (asOfDate) {
        if (!isAdvancePayment && !isOnOrBefore(reportDate, asOfDate)) return;
        if (!isOnOrBefore(order.billPreparationDate, asOfDate)) return;
        if (!isMissingOrAfter(order.billSentForPaymentDate, asOfDate)) return;
        if (!isMissingOrAfter(order.paymentDate, asOfDate)) return;
      } else if (dateRange) {
        if (!isAdvancePayment && !isOnOrBefore(reportDate, dateRange.toDate)) return;
        if (!isOnOrBefore(order.billPreparationDate, dateRange.toDate)) return;
        if (!isMissingOrAfter(order.billSentForPaymentDate, dateRange.toDate)) return;
        if (!isMissingOrAfter(order.paymentDate, dateRange.toDate)) return;
      } else if (hasFilledString(order.paymentDate)) {
        return;
      } else if (hasFilledString(order.billSentForPaymentDate)) {
        return;
      }
      const billPreparationDate = order.billPreparationDate;
      if (!billPreparationDate) return;
      if (dateRange && !isWithinDateRange(billPreparationDate, dateRange)) return;

      addCashOutgoTotal(totals, billPreparationDate, file, order);
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
    if (isCancelledFile(file)) return;
    filePaymentOrders(file).forEach((order) => {
      const isAdvancePayment = order.stageDeliveryLabel === "Advance Payment";
      if (isSupplyOrderCancelled(file, order)) return;
      const reportDate = getReceiptPendingBillReportDate(file, order);
      if (!isAdvancePayment && !hasFilledString(reportDate)) return;
      if (!hasFilledString(order.billPreparationDate)) return;
      if (!hasFilledString(order.billSentForPaymentDate)) return;
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
  });

  return finalizeCashOutgoRows(totals);
}

function getActualCashOutgoRows(
  files: FileRecord[],
  dateRange?: { fromDate: string; toDate: string },
): CashOutgoRow[] {
  const totals = new Map<string, CashOutgoRow>();

  files.forEach((file) => {
    if (isCancelledFile(file)) return;
    filePaymentOrders(file).forEach((order) => {
      if (!hasFilledString(order.paymentDate) || isYes(order.soCancelled)) return;

      const paymentDate = order.paymentDate;
      if (!paymentDate) return;
      if (dateRange && !isWithinDateRange(paymentDate, dateRange)) return;

      addCashOutgoTotal(totals, paymentDate, file, order, "actual");
    });
  });

  return finalizeCashOutgoRows(totals);
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
    getCurrentMilestoneDelay(file, thresholdDays, selectedMilestoneKey),
    ...getCurrentOrderMilestoneDelayRows(file, thresholdDays, selectedMilestoneKey),
  ];
}

function getCurrentMilestoneDelay(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
): DelayStatusRow | undefined {
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
    key: "bankGuarantee",
    label: "Bank Guarantee",
    current: "bankguarantee",
    start: (file: FileRecord, order: SupplyOrderDetail) =>
      order.soDate || order.financialSanctionDate || getMainTimelineLastFilledDateValue(file),
    complete: (order: SupplyOrderDetail) => order.bgValidityDate,
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
    start: (_file: FileRecord, order: SupplyOrderDetail) => order.billSentForPaymentDate,
    complete: (order: SupplyOrderDetail) => order.paymentDate,
  },
] as const;

const orderDelayMilestoneKeys = new Set<string>(
  orderDelayMilestones.map((milestone) => milestone.key),
);

const delayMilestoneOptions = [
  ...milestoneDefinitions
    .filter((milestone) => !orderDelayMilestoneKeys.has(milestone.key))
    .map((milestone) => ({ key: milestone.key, label: milestone.label })),
  ...orderDelayMilestones.map((milestone) => ({ key: milestone.key, label: milestone.label })),
];

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
      } else if (getEffectiveOrderCurrentMilestone(file, order) !== milestone.current) {
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

function getSupplyOrderDelayReference(
  file: FileRecord,
  order: SupplyOrderDetail,
  index: number,
) {
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
      order.bgValidityDate,
      order.revisedDp,
      order.materialReceiptDate,
      order.irPreparationDate,
      order.irReceiptDate,
      order.billPreparationDate,
      order.billSentForPaymentDate,
      order.paymentDate,
      order.bgReturnDate,
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
    order.bgValidityDate,
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
  if (columns.length === 2 && columns.includes("Total") && columns.includes("Pending")) {
    return "Financial Sanction";
  }
  if (columns.includes("Total cases")) return "Case approval milestones";
  if (columns.includes("Reviewed")) return "File approval milestones";
  if (columns.includes("Opening overdue")) return "Bidding";
  if (columns.includes("Placed")) return "Supply Order";
  if (columns.includes("Received")) return "Bank Guarantee";
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
        ({ file, order }) =>
          isAdvancePaymentPending(order) && !isSupplyOrderCancelled(file, order),
      ).length,
    },
  ];

  const bankGuaranteeIndex = withDeliveryPeriod.findIndex(
    (row) => row.milestone === "Bank Guarantee",
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

  if (bankGuaranteeIndex === -1)
    return [...withDeliveryPeriod, ...deliveryRows, ...advancePaymentRows];
  return [
    ...withDeliveryPeriod.slice(0, bankGuaranteeIndex + 4),
    ...deliveryRows,
    ...withDeliveryPeriod.slice(bankGuaranteeIndex + 4),
    ...advancePaymentRows,
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
): StatusSummaryRow[] {
  const applicableFiles = files.filter((file) => isMilestoneApplicable(file, milestone));
  const processFiles = applicableFiles.filter((file) => !isCancelledFile(file));
  const reachedFiles = processFiles.filter((file) => isEligibleMilestone(file, milestone));
  const activeFiles = processFiles.filter((file) => isManualActiveMilestone(file, milestone));
  const reviewedFiles = activeFiles.filter((file) => isMilestoneReviewed(file, milestone));
  const pendingFiles = activeFiles.filter((file) => isPendingMilestone(file, milestone));
  const clearedFiles = processFiles.filter((file) => isMilestoneComplete(file, milestone));
  const base = (stage: string, count: number) => ({ milestone: milestone.label, stage, count });

  if (milestone.key === "bankGuarantee") {
    const eligibleBgFiles = processFiles.filter(isBankGuaranteeEligible);
    return [
      base("Received", countBgReceivedOrders(eligibleBgFiles)),
      base("Pending", countBgPendingOrders(eligibleBgFiles)),
      base("Expired", eligibleBgFiles.filter(isBgExpired).length),
      base("To be returned", eligibleBgFiles.filter(isBgToBeReturned).length),
      base(
        "At previous stage",
        processFiles.filter((file) => !isEligibleMilestone(file, milestone)).length,
      ),
    ];
  }

  if (milestone.key === "payment") {
    return [
      base("Completed", countPaymentCompletedOrders(processFiles)),
      base("Pending", countPaymentPendingOrders(processFiles)),
      base("At previous stage", Math.max(0, processFiles.length - reachedFiles.length)),
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
      base("At previous stages", Math.max(0, applicableFiles.length - reachedFiles.length)),
    ];
  }

  if (milestone.key === "supplyOrder") {
    return [
      base("Placed", countCompletedOrderDrivenMilestoneStatuses(files, "supplyorder")),
      base("Live", countLiveSupplyOrders(files)),
      base("Pending", countCurrentOrderDrivenMilestoneStatuses(files, "supplyorder")),
      base("At previous stages", Math.max(0, applicableFiles.length - reachedFiles.length)),
    ];
  }

  if (milestone.key === "financialSanction") {
    const completed = countCompletedOrderDrivenMilestoneStatuses(files, "financialsanction");
    const pending = countCurrentOrderDrivenMilestoneStatuses(files, "financialsanction");
    return [base("Completed", completed), base("Pending", pending)];
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
      base("At previous stage", Math.max(0, applicableFiles.length - reachedFiles.length)),
      base("In process", activeFiles.length),
      base("Reviewed", reviewedFiles.length),
      base("Pending", pendingFiles.length),
    ];
  }

  return [
    base(milestone.totalLabel ?? "Total", applicableFiles.length),
    base("Completed", clearedFiles.length),
    base("In process", activeFiles.length),
    base("At previous stage", Math.max(0, applicableFiles.length - reachedFiles.length)),
  ];
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
  if (milestone.key === "bankGuarantee") return isYes(file.bg);

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
          hasPaymentWorkflowStarted(order) &&
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
        (order) => hasSupplyOrderDate(order) && !isSupplyOrderCancelled(file, order),
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
          hasSupplyOrderDate(order) &&
          !hasFilledString(order.paymentDate) &&
          !isSupplyOrderCancelled(file, order),
      ).length,
    0,
  );
}

function shouldUseOrderMilestoneRows(file: FileRecord) {
  return (
    countExpectedSupplyOrderRows(file) > 1 ||
    rawSupplyOrders(file).length > 0
  );
}

function getEffectiveOrderCurrentMilestone(file: FileRecord, order: SupplyOrderDetail) {
  const current = normalizeMilestoneName(order.currentMilestone);
  if (current && isOrderMilestoneApplicable(file, current)) return current;
  return "";
}

function orderDrivenMilestoneRows(file: FileRecord, normalizedMilestone: string) {
  if (normalizedMilestone === "financialsanction") return rawSupplyOrders(file);
  if (normalizedMilestone === "supplyorder" || normalizedMilestone === "bankguarantee") {
    return expectedSupplyOrders(file);
  }
  if (normalizedMilestone === "payment") return filePaymentOrders(file);
  return fileSupplyOrders(file);
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
      return total + (normalizeMilestoneName(file.currentMilestone) === normalizedMilestone ? 1 : 0);
    }
    return (
      total +
      orderDrivenMilestoneRows(file, normalizedMilestone).filter(
        (order) =>
          !isSupplyOrderCancelled(file, order) &&
          getEffectiveOrderCurrentMilestone(file, order) === normalizedMilestone,
      ).length
    );
  }, 0);
}

function countCompletedOrderDrivenMilestoneStatuses(
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
            isAdvancePaymentCompleted(order) && !isSupplyOrderCancelled(entryFile, order),
        ).length
      );
    }
    if (!shouldUseOrderMilestoneRows(file)) {
    if (normalizedMilestone === "financialsanction") {
      return (
        total +
        (file.completedMilestones?.some(
          (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
        ) ||
        fileSupplyOrders(file).some(
          (order) =>
            !isSupplyOrderCancelled(file, order) &&
            (hasFilledString(order.financialSanctionDate) ||
              order.completedMilestones?.some(
                (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
              )),
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
          !isSupplyOrderCancelled(file, order) &&
          (normalizedMilestone === "financialsanction"
            ? hasFilledString(order.financialSanctionDate) ||
              order.completedMilestones?.some(
                (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
              )
            : order.completedMilestones?.some(
                (milestone) => normalizeMilestoneName(milestone) === normalizedMilestone,
              )),
      ).length
    );
  }, 0);
}

function matchesCompletedSupplyOrderDrivenMilestone(file: FileRecord, milestone: string) {
  if (isCancelledFile(file)) return false;
  const normalized = normalizeMilestoneName(milestone);
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
  return orderDrivenMilestoneRows(file, normalized).some(
    (order) =>
      !isSupplyOrderCancelled(file, order) &&
      (normalized === "financialsanction"
        ? hasFilledString(order.financialSanctionDate) ||
          order.completedMilestones?.some((item) => normalizeMilestoneName(item) === normalized)
        : order.completedMilestones?.some((item) => normalizeMilestoneName(item) === normalized)),
  );
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

function hasPaymentWorkflowStarted(order: SupplyOrderDetail) {
  return (
    hasFilledString(order.materialReceiptDate) ||
    hasFilledString(order.billPreparationDate) ||
    hasFilledString(order.billSentForPaymentDate)
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
    expectedSupplyOrders(file).some((order) => !isSupplyOrderCancelled(file, order))
  );
}

function isBgReceived(file: FileRecord) {
  return expectedSupplyOrders(file).some(
    (order) =>
      isYes(file.bg) &&
      isBgReceivedOrder(order) &&
      !isSupplyOrderCancelled(file, order),
  );
}

function isBgToBeReceived(file: FileRecord) {
  return expectedSupplyOrders(file).some(
    (order) =>
      isYes(file.bg) &&
      isBgCurrentOrder(order) &&
      !isBgReceivedOrder(order) &&
      !isSupplyOrderCancelled(file, order),
  );
}

function countBgReceivedOrders(files: FileRecord[]) {
  return files.reduce(
    (total, file) =>
      total +
      expectedSupplyOrders(file).filter(
        (order) => isYes(file.bg) && isBgReceivedOrder(order) && !isSupplyOrderCancelled(file, order),
      ).length,
    0,
  );
}

function countBgPendingOrders(files: FileRecord[]) {
  return files.reduce(
    (total, file) =>
      total +
      expectedSupplyOrders(file).filter(
        (order) =>
          isYes(file.bg) &&
          isBgCurrentOrder(order) &&
          !isBgReceivedOrder(order) &&
          !isSupplyOrderCancelled(file, order),
      ).length,
    0,
  );
}

function isBgCurrentOrder(order: SupplyOrderDetail) {
  return normalizeMilestoneName(order.currentMilestone) === "bankguarantee";
}

function isBgReceivedOrder(order: SupplyOrderDetail) {
  return (
    hasFilledString(order.bgValidityDate) ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === "bankguarantee",
    )
  );
}

function isCancelledFile(file: FileRecord) {
  if (isYes(file.demandCancelled)) return true;
  const orders = rawSupplyOrders(file);
  if (orders.length === 0) return isYes(file.soCancelled);
  return orders.every((order) => isYes(order.soCancelled));
}

function isSupplyOrderCancelled(file: FileRecord, order: SupplyOrderDetail) {
  return isYes(file.demandCancelled) || isLegacySoCancelledFile(file) || isYes(order.soCancelled);
}

function isLegacySoCancelledFile(file: FileRecord) {
  return isYes(file.soCancelled) && (file.supplyOrders?.length ?? 0) === 0;
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
      hasSupplyOrderDate(order) &&
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

function isBgToBeReturned(file: FileRecord) {
  return rawSupplyOrders(file).some((order) => isBgReturnDueOrder(file, order));
}

function isBgExpired(file: FileRecord) {
  return rawSupplyOrders(file).some((order) => isBgExpiredOrder(file, order));
}

function isBgReturnDueOrder(file: FileRecord, order: SupplyOrderDetail) {
  if (!isYes(file.bg) || !isBgReceivedOrder(order) || hasFilledString(order.bgReturnDate)) return false;
  if (isYes(order.soCancelled)) return true;
  return (
    !isSupplyOrderCancelled(file, order) &&
    hasFilledString(order.paymentDate) &&
    hasFilledString(order.bgValidityDate) &&
    (isYes(file.psb) || isDateBeforeToday(order.bgValidityDate))
  );
}

function isBgExpiredOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    isYes(file.bg) &&
    isBgReceivedOrder(order) &&
    !hasFilledString(order.bgReturnDate) &&
    !isSupplyOrderCancelled(file, order) &&
    !hasFilledString(order.paymentDate) &&
    hasFilledString(order.bgValidityDate) &&
    isDateBefore(order.bgValidityDate, getDeliveryPeriodDate(order)) &&
    isDateBeforeToday(order.bgValidityDate)
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
