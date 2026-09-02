import type { BillReturnCycle, FileRecord, SupplyOrderDetail } from "../types.js";

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
}

export function normalizeBillReturnCycles(cycles: BillReturnCycle[] | undefined) {
  return (Array.isArray(cycles) ? cycles : []).filter((cycle) =>
    [cycle.returnedDate, cycle.reason, cycle.resubmittedDate, cycle.remarks].some(hasFilledString),
  );
}

export function hasOpenBillReturn(order: Pick<SupplyOrderDetail, "billReturnCycles">) {
  return normalizeBillReturnCycles(order.billReturnCycles).some(
    (cycle) => hasFilledString(cycle.returnedDate) && !hasFilledString(cycle.resubmittedDate),
  );
}

export function hasReturnedBill(order: Pick<SupplyOrderDetail, "billReturnCycles">) {
  return normalizeBillReturnCycles(order.billReturnCycles).some((cycle) =>
    hasFilledString(cycle.returnedDate),
  );
}

export function hasResubmittedBillReturn(order: Pick<SupplyOrderDetail, "billReturnCycles">) {
  return normalizeBillReturnCycles(order.billReturnCycles).some(
    (cycle) => hasFilledString(cycle.returnedDate) && hasFilledString(cycle.resubmittedDate),
  );
}

export function hasCompletedBillReturn(order: Pick<SupplyOrderDetail, "billReturnCycles">) {
  return hasResubmittedBillReturn(order) && !hasOpenBillReturn(order);
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

function earliestDate(dates: Array<string | undefined>) {
  return dates.filter(hasFilledString).sort()[0];
}

export function getReturnedBillCashOutgoEventDate(
  order: Pick<SupplyOrderDetail, "billReturnCycles" | "paymentDate">,
  mode: ReturnedBillCashOutgoMode,
) {
  const cycles = normalizeBillReturnCycles(order.billReturnCycles);
  if (mode === "returnedBills") {
    return earliestDate(cycles.map((cycle) => cycle.returnedDate));
  }
  if (mode === "pendingReturnedBills") {
    return earliestDate(
      cycles
        .filter((cycle) => hasFilledString(cycle.returnedDate) && !hasFilledString(cycle.resubmittedDate))
        .map((cycle) => cycle.returnedDate),
    );
  }
  if (mode === "returnedBillsResubmitted") {
    if (!hasCompletedBillReturn(order)) return undefined;
    return earliestDate(cycles.map((cycle) => cycle.resubmittedDate));
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
