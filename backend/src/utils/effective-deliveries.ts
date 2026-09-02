import type { FileRecord, SupplyOrderDetail } from "../types.js";
import { isContractFileType, isDeliveryInspectionApplicableByGroup } from "./file-type-groups.js";

type SupplyOrderEntry = {
  order: SupplyOrderDetail;
  orderIndex: number;
  stageIndex?: number;
};

type PaymentEntry = SupplyOrderEntry & {
  advancePayment?: boolean;
};

function getBaseSupplyOrderRows(file: FileRecord) {
  return file.supplyOrders?.map((row) => ({ ...row })).filter(hasFilledObjectValue) ?? [];
}

function getEffectiveSupplyOrderRows(file: FileRecord) {
  const rows = getBaseSupplyOrderRows(file);
  if (!hasExplicitSupplyOrderCount(file.noOfSo)) return rows;
  return rows.slice(0, parseExpectedSupplyOrderCount(file.noOfSo));
}

export function countSupplyOrderRows(file: FileRecord) {
  return getEffectiveSupplyOrderRows(file).length;
}

export function countExpectedSupplyOrderRows(file: FileRecord) {
  if (hasExplicitSupplyOrderCount(file.noOfSo)) return parseExpectedSupplyOrderCount(file.noOfSo);
  return getBaseSupplyOrderRows(file).length;
}

export function rawSupplyOrders(file: FileRecord) {
  return getEffectiveSupplyOrderRows(file);
}

export function expectedSupplyOrders(file: FileRecord) {
  const rows = getEffectiveSupplyOrderRows(file);
  const missing = countExpectedSupplyOrderRows(file) - rows.length;
  if (missing <= 0) return rows;
  return [
    ...rows,
    ...Array.from(
      { length: missing },
      (): SupplyOrderDetail => ({
        currentMilestone: "Supply Order",
      }),
    ),
  ];
}

export function fileSupplyOrders(file: FileRecord) {
  return fileSupplyOrderEntries(file).map((entry) => entry.order);
}

export function fileSupplyOrderEntries(file: FileRecord) {
  return getEffectiveSupplyOrderRows(file).flatMap((order, orderIndex) =>
    expandSupplyOrderStageEntries(order, orderIndex),
  );
}

export function effectiveSupplyOrderEntries(files: FileRecord[]) {
  return files.flatMap((file) =>
    fileSupplyOrderEntries(file).map(({ order, orderIndex, stageIndex }) => ({
      file,
      order,
      orderIndex,
      stageIndex,
    })),
  );
}

export function filePaymentOrders(file: FileRecord) {
  return filePaymentEntries(file).map((entry) => entry.order);
}

export function filePaymentEntries(file: FileRecord): PaymentEntry[] {
  const effectiveRows = getEffectiveSupplyOrderRows(file);
  return effectiveRows.flatMap((order, orderIndex) => {
    const paymentOrders =
      isYes(order.stageDelivery) && !isYes(order.stagePayment)
        ? [{ order, orderIndex }]
        : expandSupplyOrderStageEntries(order, orderIndex);
    const advanceOrder = getAdvancePaymentOrder(order);
    return advanceOrder
      ? [...paymentOrders, { order: advanceOrder, orderIndex, advancePayment: true }]
      : paymentOrders;
  });
}

export function effectivePaymentEntries(files: FileRecord[]) {
  return files.flatMap((file) => filePaymentOrders(file).map((order) => ({ file, order })));
}

export function advancePaymentEntries(files: FileRecord[]) {
  return files.flatMap((file) =>
    rawSupplyOrders(file)
      .filter(isAdvancePaymentApplicable)
      .map((order) => ({ file, order, advance: order.advancePaymentDetail ?? {} })),
  );
}

export function isAdvancePaymentApplicable(order: SupplyOrderDetail) {
  return isYes(order.advancePayment);
}

export function isAdvancePaymentPaid(order: SupplyOrderDetail) {
  return hasFilledString(order.advancePaymentDetail?.paymentDate);
}

export function isAdvancePaymentCompleted(order: SupplyOrderDetail) {
  return isAdvancePaymentPaid(order);
}

export function isAdvancePaymentPending(order: SupplyOrderDetail) {
  return (
    isAdvancePaymentApplicable(order) &&
    normalizeMilestoneName(order.advancePaymentDetail?.currentMilestone) === "advancepayment" &&
    !isAdvancePaymentPaid(order)
  );
}

export function getAdvancePaymentCapital(order: SupplyOrderDetail) {
  const advance = order.advancePaymentDetail;
  return advance?.actualPaymentCapital || "";
}

export function getAdvancePaymentRevenue(order: SupplyOrderDetail) {
  const advance = order.advancePaymentDetail;
  return advance?.actualPaymentRevenue || "";
}

export function getActualPaymentCapital(order: SupplyOrderDetail) {
  return order.actualPaymentCapital || "";
}

export function getActualPaymentRevenue(order: SupplyOrderDetail) {
  return order.actualPaymentRevenue || "";
}

export function getEffectiveSupplyOrderCurrentMilestone(
  file: FileRecord,
  order: SupplyOrderDetail,
) {
  if (isFinancialSanctionPendingOrder(file, order)) return "financialsanction";
  if (isSupplyOrderPendingOrder(order)) return "supplyorder";
  if (isDeliveryPeriodCurrentOrder(file, order)) return "deliveryperiod";
  if (hasOpenBillReturn(order)) return "billreturnedforcorrection";
  const current = normalizeMilestoneName(order.currentMilestone);
  if (
    current &&
    current !== "deliveryperiod" &&
    current !== "jobcompletion" &&
    current !== "billpreparation" &&
    isSupplyOrderMilestoneApplicable(file, order, current)
  ) {
    return current;
  }
  if (isJobCompletionCurrentOrder(file, order)) return "jobcompletion";
  if (isDueDeliveryOrder(file, order)) return "delivery";
  if (isBgCurrentOrder(file, order, "psb")) return "psb";
  if (isBgCurrentOrder(file, order, "psbpwb")) return "psbpwb";
  if (isBgCurrentOrder(file, order, "pwb")) return "pwb";
  if (isIrPreparationCurrentOrder(file, order)) return "irpreparation";
  if (isIrReceiptCurrentOrder(file, order)) return "irreceipt";
  if (isBillPreparationCurrentOrder(file, order)) return "billpreparation";
  if (isBillSentForPaymentCurrentOrder(order)) return "billsentforpayment";
  if (isPaymentCurrentOrder(file, order)) return "payment";
  return "";
}

export function isSupplyOrderMilestoneCurrent(
  file: FileRecord,
  order: SupplyOrderDetail,
  milestone: string,
) {
  return getEffectiveSupplyOrderCurrentMilestone(file, order) === normalizeMilestoneName(milestone);
}

export function isValidDeliveryPeriodEntry(file: FileRecord, order: SupplyOrderDetail) {
  const deliveryPeriodDate = getDeliveryPeriodDate(order);
  return (
    isActiveDeliveryPeriodEntry(file, order, deliveryPeriodDate) &&
    !isExtendedDeliveryPeriodOrder(order) &&
    isTodayWithinDeliveryPeriod(order, deliveryPeriodDate)
  );
}

export function isExpiredDeliveryPeriodEntry(file: FileRecord, order: SupplyOrderDetail) {
  const deliveryPeriodDate = getDeliveryPeriodDate(order);
  return (
    isActiveDeliveryPeriodEntry(file, order, deliveryPeriodDate) &&
    isDateBeforeToday(deliveryPeriodDate)
  );
}

export function isExtendedDeliveryPeriodEntry(file: FileRecord, order: SupplyOrderDetail) {
  const deliveryPeriodDate = getDeliveryPeriodDate(order);
  return (
    isActiveDeliveryPeriodEntry(file, order, deliveryPeriodDate) &&
    isExtendedDeliveryPeriodOrder(order) &&
    !isDateBeforeToday(deliveryPeriodDate)
  );
}

export function getDeliveryPeriodDate(order: SupplyOrderDetail) {
  return order.revisedDp || order.dpDate;
}

function getDeliveryPeriodStartDate(order: SupplyOrderDetail) {
  return order.deliveryPeriodStartDate || order.soDate;
}

function expandSupplyOrderStages(order: SupplyOrderDetail) {
  return expandSupplyOrderStageEntries(order, 0).map((entry) => entry.order);
}

function expandSupplyOrderStageEntries(
  order: SupplyOrderDetail,
  orderIndex: number,
): SupplyOrderEntry[] {
  if (!isYes(order.stageDelivery) || !order.stageDeliveries?.length) {
    return [{ order, orderIndex }];
  }

  return order.stageDeliveries.map((stage, index) => {
    const useStagePayment = isYes(order.stagePayment);
    const useCommonPayment = !useStagePayment && index === order.stageDeliveries!.length - 1;
    const previousStage = index > 0 ? order.stageDeliveries![index - 1] : undefined;
    const previousDeliveryPeriodDate = previousStage
      ? previousStage.revisedDp || previousStage.dpDate
      : undefined;
    return {
      order: {
        ...order,
        ...stage,
        deliveryPeriodStartDate:
          stage.deliveryPeriodStartDate ||
          (index === 0 ? order.soDate : getNextDate(previousDeliveryPeriodDate) || order.soDate),
        soValueCapital: stage.stageAmountCapital ?? "",
        soValueRevenue: stage.stageAmountRevenue ?? "",
        billAmountCapital: "",
        billAmountRevenue: "",
        currentMilestone: stage.currentMilestone ?? "",
        completedMilestones: stage.completedMilestones ?? [],
        billPreparationDate: useStagePayment
          ? (stage.billPreparationDate ?? "")
          : useCommonPayment
            ? order.billPreparationDate
            : "",
        billSentForPaymentDate: useStagePayment
          ? (stage.billSentForPaymentDate ?? "")
          : useCommonPayment
            ? order.billSentForPaymentDate
            : "",
        billReturnCycles: useStagePayment
          ? (stage.billReturnCycles ?? [])
          : useCommonPayment
            ? (order.billReturnCycles ?? [])
            : [],
        paymentDate: useStagePayment
          ? (stage.paymentDate ?? "")
          : useCommonPayment
            ? order.paymentDate
            : "",
        paymentMode: useStagePayment
          ? (stage.paymentMode ?? "")
          : useCommonPayment
            ? order.paymentMode
            : "",
        actualPaymentCapital: useStagePayment
          ? (stage.actualPaymentCapital ?? "")
          : useCommonPayment
            ? order.actualPaymentCapital
            : "",
        actualPaymentRevenue: useStagePayment
          ? (stage.actualPaymentRevenue ?? "")
          : useCommonPayment
            ? order.actualPaymentRevenue
            : "",
        stageDeliveries: undefined,
        stageDeliveryLabel: `Delivery-${index + 1}`,
      },
      orderIndex,
      stageIndex: index,
    };
  });
}

function getAdvancePaymentOrder(order: SupplyOrderDetail): SupplyOrderDetail | undefined {
  if (!isYes(order.stageDelivery) || !isYes(order.stagePayment) || !isYes(order.advancePayment)) {
    return undefined;
  }
  const advance = order.advancePaymentDetail;
  if (!advance || !hasFilledObjectValue(advance)) return undefined;
  return {
    ...order,
    soDate: "",
    soValueCapital: advance.stageAmountCapital ?? "",
    soValueRevenue: advance.stageAmountRevenue ?? "",
    billAmountCapital: "",
    billAmountRevenue: "",
    materialReceiptDate: "",
    jobCompletionDate: "",
    irPreparationDate: "",
    irReceiptDate: "",
    billPreparationDate: advance.billPreparationDate ?? "",
    billSentForPaymentDate: advance.billSentForPaymentDate ?? "",
    billReturnCycles: advance.billReturnCycles ?? [],
    paymentDate: advance.paymentDate ?? "",
    paymentMode: advance.paymentMode ?? "",
    actualPaymentCapital: advance.actualPaymentCapital || "",
    actualPaymentRevenue: advance.actualPaymentRevenue || "",
    currentMilestone: "",
    completedMilestones: [],
    stageDeliveries: undefined,
    stageDeliveryLabel: "Advance Payment",
  };
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
      "shortclosure",
      "stageDelivery",
      "stagePayment",
    ].includes(key)
  );
}

function parseExpectedSupplyOrderCount(value: string | undefined) {
  const count = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function hasExplicitSupplyOrderCount(value: string | undefined) {
  return String(value ?? "").trim() !== "";
}

function isYes(value: string | undefined) {
  return value?.trim().toLowerCase() === "yes";
}

function isNo(value: string | undefined) {
  return value?.trim().toLowerCase() === "no";
}

function normalizeCompletedMilestones(values: string[] | undefined) {
  return Array.isArray(values) ? values : [];
}

export function normalizeMilestoneName(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isActiveDeliveryPeriodEntry(
  file: FileRecord,
  order: SupplyOrderDetail,
  deliveryPeriodDate: string | undefined,
) {
  return (
    hasFilledString(order.soDate) &&
    Boolean(deliveryPeriodDate) &&
    !isYes(file.demandCancelled) &&
    !isYes(order.soCancelled) &&
    !isYes(order.shortclosure) &&
    !isDateAfterToday(getDeliveryPeriodStartDate(order)) &&
    !isDeliveryPeriodComplete(file, order)
  );
}

function isDeliveryPeriodComplete(file: FileRecord, order: SupplyOrderDetail) {
  return isPaymentDrivenFileType(file)
    ? isJobCompletionDone(order)
    : hasFilledString(order.materialReceiptDate);
}

function isJobCompletionDone(order: SupplyOrderDetail) {
  return hasFilledString(order.jobCompletionDate);
}

function isDeliveryInspectionApplicable(file: FileRecord) {
  return isDeliveryInspectionApplicableByGroup(file);
}

function isPhysicalDeliveryWorkflow(file: FileRecord) {
  return isDeliveryInspectionApplicable(file);
}

function isJobCompletionWorkflow(file: FileRecord) {
  return !isPhysicalDeliveryWorkflow(file);
}

function isFinancialSanctionReached(file: FileRecord) {
  return hasFilledString(file.cfaDate) || hasFilledString(file.cncApprovalDate);
}

function isFinancialSanctionCompletedOrder(order: SupplyOrderDetail) {
  return (
    hasFilledString(order.financialSanctionDate) ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === "financialsanction",
    )
  );
}

function isFinancialSanctionPendingOrder(file: FileRecord, order: SupplyOrderDetail) {
  return isFinancialSanctionReached(file) && !isFinancialSanctionCompletedOrder(order);
}

function isSupplyOrderComplete(order: SupplyOrderDetail) {
  return (
    hasFilledString(order.soDate) ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === "supplyorder",
    )
  );
}

function isSupplyOrderPendingOrder(order: SupplyOrderDetail) {
  return isFinancialSanctionCompletedOrder(order) && !isSupplyOrderComplete(order);
}

function isDeliveryPeriodCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    isSupplyOrderComplete(order) &&
    !isYes(order.stageDelivery) &&
    !hasFilledString(getDeliveryPeriodDate(order)) &&
    !isDeliveryPeriodComplete(file, order)
  );
}

function isJobCompletionCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    isSupplyOrderComplete(order) &&
    isJobCompletionWorkflow(file) &&
    !isJobCompletionDone(order) &&
    isDateBeforeToday(getDeliveryPeriodDate(order))
  );
}

function isDueDeliveryOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    isSupplyOrderComplete(order) &&
    isPhysicalDeliveryWorkflow(file) &&
    hasFilledString(getDeliveryPeriodDate(order)) &&
    !hasFilledString(order.materialReceiptDate)
  );
}

function isBgCategoryApplicable(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") {
    return (
      order.psbApplicable === "Yes" &&
      (order.bgCoverageType === "PSB" || order.bgCoverageType === "PSB and PWB separately")
    );
  }
  if (normalized === "pwb") {
    return (
      file.bg === "Yes" &&
      (order.bgCoverageType === "PWB" || order.bgCoverageType === "PSB and PWB separately")
    );
  }
  if (normalized === "psbpwb") return file.bg === "Yes" && order.bgCoverageType === "PSB+PWB";
  return false;
}

function isBgReceivedOrder(order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  const date =
    normalized === "psb"
      ? order.psbBgReceivedDate
      : normalized === "pwb"
        ? order.pwbBgReceivedDate
        : normalized === "psbpwb"
          ? order.combinedBgReceivedDate
          : undefined;
  return (
    hasFilledString(date) ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === normalized,
    )
  );
}

function isBgCurrentOrder(file: FileRecord, order: SupplyOrderDetail, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (
    !isBgCategoryApplicable(file, order, normalized) ||
    !isFinancialSanctionCompletedOrder(order) ||
    hasBillingTrackingStarted(order)
  ) {
    return false;
  }
  return !isBgReceivedOrder(order, normalized);
}

function isIrPreparationCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    file.ir === "Yes" &&
    hasFilledString(order.materialReceiptDate) &&
    !hasFilledString(order.irPreparationDate)
  );
}

function isIrReceiptCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  return (
    file.ir === "Yes" &&
    hasFilledString(order.irPreparationDate) &&
    !hasFilledString(order.irReceiptDate)
  );
}

function isBillPreparationCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  if (hasFilledString(order.billPreparationDate)) return false;
  if (isJobCompletionWorkflow(file)) {
    return hasFilledString(getNonInspectionPaymentDueDate(file, order));
  }
  return file.ir === "Yes" && hasFilledString(order.irReceiptDate);
}

function isBillSentForPaymentCurrentOrder(order: SupplyOrderDetail) {
  return (
    hasFilledString(order.billPreparationDate) &&
    !hasOpenBillReturn(order) &&
    !hasFilledString(order.billSentForPaymentDate)
  );
}

function isPaymentCurrentOrder(file: FileRecord, order: SupplyOrderDetail) {
  return hasPaymentWorkflowStarted(file, order) && !hasFilledString(order.paymentDate);
}

function hasPaymentWorkflowStarted(file: FileRecord, order: SupplyOrderDetail) {
  return (
    hasFilledString(order.billPreparationDate) ||
    hasFilledString(order.billSentForPaymentDate) ||
    hasBillReturnHistory(order) ||
    isPaymentWorkflowStartDateReached(file, order)
  );
}

function hasBillingTrackingStarted(order: SupplyOrderDetail) {
  return (
    hasFilledString(order.billPreparationDate) ||
    hasFilledString(order.billSentForPaymentDate) ||
    hasBillReturnHistory(order) ||
    hasFilledString(order.paymentDate)
  );
}

function getPaymentWorkflowStartDate(file: FileRecord, order: SupplyOrderDetail) {
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  return getNonInspectionPaymentDueDate(file, order);
}

function getNonInspectionPaymentDueDate(file: FileRecord, order: SupplyOrderDetail) {
  if (!isContractFileType(file) && isNo(file.ir)) return order.jobCompletionDate;
  return getNextDate(getDeliveryPeriodDate(order));
}

function isContractNoInspectionWorkflow(file: FileRecord) {
  return isContractFileType(file) && isNo(file.ir);
}

function isPaymentWorkflowStartDateReached(file: FileRecord, order: SupplyOrderDetail) {
  const startDate = getPaymentWorkflowStartDate(file, order);
  if (!hasFilledString(startDate)) return false;
  if (isContractNoInspectionWorkflow(file)) return !isDateAfterToday(startDate);
  return true;
}

function isSupplyOrderMilestoneApplicable(
  file: FileRecord,
  order: SupplyOrderDetail,
  normalizedMilestone: string,
) {
  if (normalizedMilestone === "delivery") return isPhysicalDeliveryWorkflow(file);
  if (normalizedMilestone === "jobcompletion") return isJobCompletionWorkflow(file);
  if (normalizedMilestone === "irpreparation" || normalizedMilestone === "irreceipt") {
    return file.ir === "Yes";
  }
  if (["psb", "pwb", "psbpwb"].includes(normalizedMilestone)) {
    return isBgCategoryApplicable(file, order, normalizedMilestone);
  }
  return true;
}

function hasOpenBillReturn(order: Pick<SupplyOrderDetail, "billReturnCycles">) {
  return normalizeBillReturnCycles(order.billReturnCycles).some(
    (cycle) => hasFilledString(cycle.returnedDate) && !hasFilledString(cycle.resubmittedDate),
  );
}

function hasBillReturnHistory(order: Pick<SupplyOrderDetail, "billReturnCycles">) {
  return normalizeBillReturnCycles(order.billReturnCycles).length > 0;
}

function normalizeBillReturnCycles(cycles: SupplyOrderDetail["billReturnCycles"]) {
  return (Array.isArray(cycles) ? cycles : []).filter((cycle) =>
    [cycle.returnedDate, cycle.reason, cycle.resubmittedDate, cycle.remarks].some(hasFilledString),
  );
}

function isPaymentDrivenFileType(file: FileRecord) {
  return isNo(file.ir) || isContractFileType(file);
}

function isExtendedDeliveryPeriodOrder(order: SupplyOrderDetail) {
  return isYes(order.dpExtension) || hasFilledString(order.revisedDp);
}

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
}

function getLaterDate(first: string | undefined, second: string | undefined) {
  const firstTime = parseLocalDateTime(first ?? "");
  const secondTime = parseLocalDateTime(second ?? "");
  if (firstTime === undefined) return second;
  if (secondTime === undefined) return first;
  return secondTime > firstTime ? second : first;
}

function isDateBeforeToday(date: string | undefined) {
  const time = parseLocalDateTime(date ?? "");
  if (time === undefined) return false;
  return time < getTodayTime();
}

function isDateAfterToday(date: string | undefined) {
  const time = parseLocalDateTime(date ?? "");
  if (time === undefined) return false;
  return time > getTodayTime();
}

function isTodayWithinDeliveryPeriod(
  order: SupplyOrderDetail,
  deliveryPeriodDate: string | undefined,
) {
  const startTime = parseLocalDateTime(getDeliveryPeriodStartDate(order) ?? "");
  const endTime = parseLocalDateTime(deliveryPeriodDate ?? "");
  const todayTime = getTodayTime();
  return (
    startTime !== undefined &&
    endTime !== undefined &&
    startTime <= todayTime &&
    todayTime <= endTime
  );
}

function getNextDate(date: string | undefined) {
  const time = parseLocalDateTime(date ?? "");
  if (time === undefined) return undefined;
  const next = new Date(time);
  next.setDate(next.getDate() + 1);
  return formatLocalDate(next);
}

function getTodayTime() {
  return parseLocalDateTime(formatLocalDate(new Date())) ?? 0;
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
