import type { FileRecord, SupplyOrderDetail } from "@/lib/files-store";

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
    ...Array.from({ length: missing }, (): SupplyOrderDetail => ({
      currentMilestone: "Supply Order",
    })),
  ];
}

export function fileSupplyOrders(file: FileRecord) {
  return getEffectiveSupplyOrderRows(file).flatMap((order) => expandSupplyOrderStages(order));
}

export function effectiveSupplyOrderEntries(files: FileRecord[]) {
  return files.flatMap((file) => fileSupplyOrders(file).map((order) => ({ file, order })));
}

export function filePaymentOrders(file: FileRecord) {
  const effectiveRows = getEffectiveSupplyOrderRows(file);
  const orders = effectiveRows.flatMap((order) =>
    isYes(order.stageDelivery) && !isYes(order.stagePayment)
      ? [order]
      : expandSupplyOrderStages(order),
  );
  const advanceOrders =
    effectiveRows
      .map((order) => getAdvancePaymentOrder(order))
      .filter((order): order is SupplyOrderDetail => Boolean(order));
  return [...orders, ...advanceOrders];
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
  return (
    isAdvancePaymentPaid(order) ||
    normalizeCompletedMilestones(order.advancePaymentDetail?.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === "advancepayment",
    )
  );
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
  return advance?.actualPaymentCapital || advance?.stageAmountCapital || "";
}

export function getAdvancePaymentRevenue(order: SupplyOrderDetail) {
  const advance = order.advancePaymentDetail;
  return advance?.actualPaymentRevenue || advance?.stageAmountRevenue || "";
}

export function getActualPaymentCapital(order: SupplyOrderDetail) {
  return order.actualPaymentCapital || order.soValueCapital;
}

export function getActualPaymentRevenue(order: SupplyOrderDetail) {
  return order.actualPaymentRevenue || order.soValueRevenue;
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
    !isExtendedDeliveryPeriodOrder(order) &&
    isDateBeforeToday(deliveryPeriodDate)
  );
}

export function isExtendedDeliveryPeriodEntry(file: FileRecord, order: SupplyOrderDetail) {
  const deliveryPeriodDate = getDeliveryPeriodDate(order);
  return (
    isActiveDeliveryPeriodEntry(file, order, deliveryPeriodDate) &&
    isExtendedDeliveryPeriodOrder(order)
  );
}

export function getDeliveryPeriodDate(order: SupplyOrderDetail) {
  return getLaterDate(order.dpDate, order.revisedDp);
}

function getDeliveryPeriodStartDate(order: SupplyOrderDetail) {
  return order.deliveryPeriodStartDate || order.soDate;
}

function expandSupplyOrderStages(order: SupplyOrderDetail) {
  if (!isYes(order.stageDelivery) || !order.stageDeliveries?.length) return [order];

  return order.stageDeliveries.map((stage, index) => {
    const useStagePayment = isYes(order.stagePayment);
    const useCommonPayment = !useStagePayment && index === order.stageDeliveries!.length - 1;
    const previousStage = index > 0 ? order.stageDeliveries![index - 1] : undefined;
    const previousDeliveryPeriodDate = previousStage
      ? getLaterDate(previousStage.dpDate, previousStage.revisedDp)
      : undefined;
    return {
      ...order,
      ...stage,
      deliveryPeriodStartDate:
        stage.deliveryPeriodStartDate ||
        (index === 0 ? order.soDate : getNextDate(previousDeliveryPeriodDate) || order.soDate),
      soValueCapital: stage.stageAmountCapital ?? "",
      soValueRevenue: stage.stageAmountRevenue ?? "",
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
          ? order.actualPaymentCapital || order.soValueCapital
          : "",
      actualPaymentRevenue: useStagePayment
        ? (stage.actualPaymentRevenue ?? "")
        : useCommonPayment
          ? order.actualPaymentRevenue || order.soValueRevenue
          : "",
      stageDeliveries: undefined,
      stageDeliveryLabel: `Delivery-${index + 1}`,
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
    materialReceiptDate: "",
    irPreparationDate: "",
    irReceiptDate: "",
    billPreparationDate: advance.billPreparationDate ?? "",
    billSentForPaymentDate: advance.billSentForPaymentDate ?? "",
    paymentDate: advance.paymentDate ?? "",
    paymentMode: advance.paymentMode ?? "",
    actualPaymentCapital: advance.actualPaymentCapital || advance.stageAmountCapital || "",
    actualPaymentRevenue: advance.actualPaymentRevenue || advance.stageAmountRevenue || "",
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

function normalizeCompletedMilestones(values: string[] | undefined) {
  return Array.isArray(values) ? values : [];
}

function normalizeMilestoneName(value: string | undefined) {
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
    !isLegacySoCancelledFile(file) &&
    !isYes(order.soCancelled) &&
    !isDateAfterToday(getDeliveryPeriodStartDate(order)) &&
    !isDeliveryPeriodComplete(file, order)
  );
}

function isLegacySoCancelledFile(file: FileRecord) {
  return isYes(file.soCancelled) && (file.supplyOrders?.length ?? 0) === 0;
}

function isDeliveryPeriodComplete(file: FileRecord, order: SupplyOrderDetail) {
  return isPaymentDrivenFileType(file)
    ? hasFilledString(order.paymentDate)
    : hasFilledString(order.materialReceiptDate);
}

function isPaymentDrivenFileType(file: FileRecord) {
  return ["amc", "mpc", "cars", "o&m"].includes((file.fileType ?? "").trim().toLowerCase());
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
