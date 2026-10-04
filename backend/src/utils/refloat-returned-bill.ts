import type { BillReturnCycle, FileRecord, SupplyOrderDetail } from "../types.js";

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
}

export function normalizeBillReturnCycles(cycles: BillReturnCycle[] | undefined) {
  return (Array.isArray(cycles) ? cycles : []).filter((cycle) =>
    [cycle.returnedDate, cycle.reason, cycle.resubmittedDate, cycle.remarks].some(hasFilledString),
  );
}

export function latestBillReturnCycle(cycles: BillReturnCycle[] | undefined) {
  return normalizeBillReturnCycles(cycles)
    .map((cycle, index) => ({ cycle, index }))
    .filter(({ cycle }) => hasFilledString(cycle.returnedDate))
    .sort((left, right) => {
      const dateDifference =
        returnCycleDateOrder(right.cycle.returnedDate) - returnCycleDateOrder(left.cycle.returnedDate);
      return dateDifference || right.index - left.index;
    })[0]?.cycle;
}

function returnCycleDateOrder(value: string | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  const normalized = iso
    ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : dmy
      ? `${dmy[3]}-${dmy[2]}-${dmy[1]}`
      : value;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function hasOpenBillReturn(order: Pick<SupplyOrderDetail, "billReturnCycles">) {
  const latest = latestBillReturnCycle(order.billReturnCycles);
  return Boolean(latest && !hasFilledString(latest.resubmittedDate));
}

export function hasReturnedBill(order: Pick<SupplyOrderDetail, "billReturnCycles">) {
  return Boolean(latestBillReturnCycle(order.billReturnCycles));
}

export function hasResubmittedBillReturn(order: Pick<SupplyOrderDetail, "billReturnCycles">) {
  const latest = latestBillReturnCycle(order.billReturnCycles);
  return Boolean(latest && hasFilledString(latest.resubmittedDate));
}

export function hasCompletedBillReturn(order: Pick<SupplyOrderDetail, "billReturnCycles">) {
  return hasResubmittedBillReturn(order);
}

export function hasReturnedBillPaid(
  order: Pick<SupplyOrderDetail, "billReturnCycles" | "paymentDate">,
) {
  return hasCompletedBillReturn(order) && hasFilledString(order.paymentDate);
}

export function hasBillReturnHistory(order: Pick<SupplyOrderDetail, "billReturnCycles">) {
  return normalizeBillReturnCycles(order.billReturnCycles).length > 0;
}

export type ReturnedBillCashOutgoMode =
  | "returnedBills"
  | "pendingReturnedBills"
  | "returnedBillsResubmitted"
  | "returnedBillsPaid";

export function getReturnedBillCashOutgoEventDate(
  order: Pick<SupplyOrderDetail, "billReturnCycles" | "paymentDate">,
  mode: ReturnedBillCashOutgoMode,
) {
  const cycles = normalizeBillReturnCycles(order.billReturnCycles);
  const latest = latestBillReturnCycle(cycles);
  if (mode === "returnedBills") {
    return latest?.returnedDate;
  }
  if (mode === "pendingReturnedBills") {
    return hasOpenBillReturn(order) ? latest?.returnedDate : undefined;
  }
  if (mode === "returnedBillsResubmitted") {
    if (!hasCompletedBillReturn(order) || hasFilledString(order.paymentDate)) return undefined;
    return latest?.resubmittedDate;
  }
  return hasReturnedBillPaid(order) ? order.paymentDate : undefined;
}

export function isRefloatBiddingCurrent(file: Pick<FileRecord, "refloat" | "biddingStageOver">) {
  return file.refloat === "Yes" && file.biddingStageOver !== "Yes";
}

export function isRefloatBiddingCompleted(file: Pick<FileRecord, "refloat" | "biddingStageOver">) {
  return file.refloat === "Yes" && file.biddingStageOver === "Yes";
}

export function isRefloatPostTcecCurrent(
  file: Pick<FileRecord, "refloat" | "tcec" | "biddingStageOver" | "refloatPostTcecMinutesDate">,
) {
  return (
    file.refloat === "Yes" &&
    file.tcec === "Yes" &&
    file.biddingStageOver === "Yes" &&
    !hasFilledString(file.refloatPostTcecMinutesDate)
  );
}

export function isRefloatPostTcecCompleted(file: Pick<FileRecord, "refloatPostTcecMinutesDate">) {
  return hasFilledString(file.refloatPostTcecMinutesDate);
}
