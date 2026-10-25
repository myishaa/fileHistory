type StageDp = {
  dpDate?: string;
  revisedDp?: string;
};

type OrderDp = {
  dpDate?: string;
  revisedDp?: string;
  stageDelivery?: string;
  stageDeliveryCount?: string;
  stageDeliveries?: StageDp[];
};

type StagePreparationDate = { billPreparationDate?: string };

type ExportApplicabilityContext = {
  inspectionApplicable: boolean;
  biddingApplicable: boolean;
  file: Record<string, unknown>;
  order?: Record<string, unknown>;
};

const tcecExportFields = new Set([
  "preTcecDate", "preTcecMinutesDate", "preTcecCommitteeNo",
  "postTcecDate", "postTcecMinutesDate", "postTcecCommitteeNumber",
  "cncDate", "cncApprovalDate", "refloatPostTcecDate",
  "refloatPostTcecMinutesDate", "refloatPostTcecCommitteeNo",
]);
const refloatExportFields = new Set([
  "refloatPreBidMeeting", "refloatPreBidMeetingDate", "refloatBiddingDate",
  "refloatBidOpeningDate", "refloatPostTcecDate", "refloatPostTcecMinutesDate",
  "refloatPostTcecCommitteeNo", "refloatRecommendationDate", "refloatBiddingStageOver",
]);
const biddingDetailExportFields = new Set([
  "preBidMeetingDate", "bidNumber", "bidDate", "bidOpeningDate", "tenderLive",
  "bidOpened", "refloatPreBidMeeting", "refloatPreBidMeetingDate", "refloatBiddingDate",
  "refloatBidOpeningDate", "rst", "biddingStageOver", "refloatBiddingStageOver",
]);
const psbExportFields = new Set([
  "psbBgNo", "psbBgAmount", "psbBgReceivedDate", "psbBgValidityDate", "psbBgReturnDate",
]);
const pwbExportFields = new Set([
  "pwbBgNo", "pwbBgAmount", "pwbBgReceivedDate", "pwbBgValidityDate", "pwbBgReturnDate",
]);
const combinedBgExportFields = new Set([
  "combinedBgNo", "combinedBgAmount", "combinedBgReceivedDate",
  "combinedBgValidityDate", "combinedBgReturnDate",
]);

function isYes(value: unknown) {
  return String(value ?? "").trim().toLowerCase() === "yes";
}

export function isQuickEntryExportFieldApplicable(
  key: string,
  context: ExportApplicabilityContext,
) {
  const { file, order } = context;
  if (key === "materialReceiptDate" || key === "irPreparationDate" || key === "irReceiptDate" ||
      key === "stageMaterialReceiptDate" || key === "stageIrPreparationDate" || key === "stageIrReceiptDate") {
    return context.inspectionApplicable;
  }
  if (key === "actualJobCompletionDate" || key === "jobCompletionDate" ||
      key === "stageActualJobCompletionDate" || key === "stageJobCompletionDate") {
    return !context.inspectionApplicable;
  }
  if (tcecExportFields.has(key) && !isYes(file.tcec)) return false;
  if (refloatExportFields.has(key) && !isYes(file.refloat)) return false;
  if (biddingDetailExportFields.has(key) && !context.biddingApplicable) return false;
  if (key === "preBidMeetingDate" && !isYes(file.preBidMeeting)) return false;
  if (key === "refloatPreBidMeetingDate" && !isYes(file.refloatPreBidMeeting)) return false;
  if ((key === "highValueMeetingDate" || key === "highValueMinutesDate") && !isYes(file.highValue)) return false;
  if ((key === "adSentDate" || key === "adVettingDate") && !isYes(file.ad)) return false;
  if ((key === "rqaSentDate" || key === "rqaApprovalDate") && !isYes(file.rqa)) return false;
  if ((key === "ifaSentDate" || key === "ifaFinalDate") && !isYes(file.ifa)) return false;
  if (
    (key === "gemBiddingMode" || key === "gemUndertakingDate" || key === "refloatGemUndertakingDate") &&
    !isYes(file.gem)
  ) return false;
  if (key === "refloatGemUndertakingDate" && !isYes(file.refloat)) return false;
  if (key === "refloatRecommendationDate" && (!isYes(file.refloat) || isYes(file.tcec))) return false;
  if (key === "refloatBiddingStageOver" && (!isYes(file.refloat) || isYes(file.tcec))) return false;
  if ((key === "rfpVettingInitiationDate" || key === "rfpVettingApprovalDate") && !isYes(file.rfpVetting)) return false;

  if (psbExportFields.has(key)) {
    return isYes(order?.psbApplicable) &&
      ["PSB", "PSB and PWB separately"].includes(String(order?.bgCoverageType ?? ""));
  }
  if (pwbExportFields.has(key)) {
    return isYes(file.bg) && ["PWB", "PSB and PWB separately"].includes(String(order?.bgCoverageType ?? ""));
  }
  if (combinedBgExportFields.has(key)) {
    return isYes(file.bg) && order?.bgCoverageType === "PSB+PWB";
  }
  if (key.startsWith("stage") && key !== "stageDelivery" && key !== "stageDeliveryCount" &&
      key !== "stagePayment" && !isYes(order?.stageDelivery)) return false;
  if (key.startsWith("advance") && key !== "advancePayment" && !isYes(order?.advancePayment)) return false;
  if (["stagePaymentDate", "stagePaymentMode", "stageActualPaymentCapital", "stageActualPaymentRevenue", "stageBillNo", "stageBillPreparationDate", "stageBillSentForPaymentDate", "stageBillReturnHistory"].includes(key) &&
      !isYes(order?.stagePayment)) return false;
  return true;
}

export type QuickEntryExportRowPlanItem = {
  rowType: "S.O. summary" | "Stage" | "S.O. payment" | "Stage payment" | "Advance" | "Supplementary bill";
  stageIndex?: number;
  supplementaryItemIndex?: number;
};

export type QuickEntryExportRowPlanOptions = {
  includeOrderPayment?: boolean;
  stagePaymentIndexes?: number[];
  includeAdvance?: boolean;
  supplementarySentDates?: string[];
};

export type QuickEntryBillLifecycleEvent = {
  eventType: "Bill sent" | "Returned" | "Resubmitted" | "Paid";
  eventDate: string;
  cycleIndex?: number;
  reason?: string;
  remarks?: string;
};

export function getQuickEntryBillLifecycleEvents(
  sentDate: string | undefined,
  cycles: Array<{ returnedDate?: string; resubmittedDate?: string; reason?: string; remarks?: string }> = [],
  paymentDate?: string,
): QuickEntryBillLifecycleEvent[] {
  const events: Array<QuickEntryBillLifecycleEvent & { sequence: number }> = [];
  let sequence = 0;
  if (sentDate) events.push({ eventType: "Bill sent", eventDate: sentDate, sequence: sequence++ });
  cycles.forEach((cycle, cycleIndex) => {
    if (cycle.returnedDate) events.push({
      eventType: "Returned", eventDate: cycle.returnedDate, cycleIndex,
      reason: cycle.reason, remarks: cycle.remarks, sequence: sequence++,
    });
    if (cycle.resubmittedDate) events.push({
      eventType: "Resubmitted", eventDate: cycle.resubmittedDate, cycleIndex,
      reason: cycle.reason, remarks: cycle.remarks, sequence: sequence++,
    });
  });
  if (paymentDate) events.push({ eventType: "Paid", eventDate: paymentDate, sequence: sequence++ });
  return events
    .sort((left, right) => left.eventDate.localeCompare(right.eventDate) || left.sequence - right.sequence)
    .map(({ sequence: _sequence, ...event }) => event);
}

export function getQuickEntryAdvanceStageIndex(stages: unknown[]) {
  return stages.length ? 0 : undefined;
}

function normalizedExportDate(value: string | undefined) {
  const date = value?.slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

export function getQuickEntrySupplementaryStageIndex(
  supplementarySentDate: string | undefined,
  stages: StagePreparationDate[],
) {
  const supplementaryDate = normalizedExportDate(supplementarySentDate);
  if (!supplementaryDate || !stages.length) return undefined;

  const datedStages = stages
    .map((stage, stageIndex) => ({
      stageIndex,
      date: normalizedExportDate(stage.billPreparationDate),
    }))
    .filter((stage) => stage.date)
    .sort((left, right) => left.date.localeCompare(right.date) || left.stageIndex - right.stageIndex);
  if (!datedStages.length) return undefined;

  const nextStage = datedStages.find((stage) => stage.date >= supplementaryDate);
  if (!nextStage) return stages.length - 1;
  return Math.max(0, nextStage.stageIndex - 1);
}

export function getQuickEntryExportRowPlan(
  viewMode: "collapsed" | "expanded",
  isStaged: boolean,
  stages: StagePreparationDate[],
  options: QuickEntryExportRowPlanOptions = {},
): QuickEntryExportRowPlanItem[] {
  const hasStages = isStaged && stages.length > 0;
  const includeStageRows = viewMode === "expanded" && hasStages;
  const rows: QuickEntryExportRowPlanItem[] = includeStageRows
    ? [
        { rowType: "S.O. summary" },
        ...stages.map((_, stageIndex) => ({ rowType: "Stage" as const, stageIndex })),
      ]
    : [{ rowType: "S.O. summary" }];
  if (options.includeOrderPayment) rows.push({ rowType: "S.O. payment" });
  for (const stageIndex of options.stagePaymentIndexes ?? []) {
    rows.push({ rowType: "Stage payment", stageIndex });
  }
  if (options.includeAdvance) rows.push({ rowType: "Advance", ...(hasStages ? { stageIndex: 0 } : {}) });
  return [
    ...rows,
    ...(options.supplementarySentDates ?? []).map((sentDate, supplementaryItemIndex) => ({
      rowType: "Supplementary bill" as const,
      supplementaryItemIndex,
      ...(hasStages
        ? { stageIndex: getQuickEntrySupplementaryStageIndex(sentDate, stages) }
        : {}),
    })),
  ];
}

export function getQuickEntryExportDpDate(order: OrderDp) {
  const stageCount = Number.parseInt(order.stageDeliveryCount ?? "", 10);
  const effectiveStageCount = Number.isFinite(stageCount) && stageCount > 0
    ? stageCount
    : order.stageDeliveries?.length ?? 0;

  if (order.stageDelivery?.trim().toLowerCase() === "yes" && effectiveStageCount > 1) {
    const lastStage = order.stageDeliveries?.[effectiveStageCount - 1];
    return lastStage?.revisedDp || lastStage?.dpDate || "";
  }

  return order.revisedDp || order.dpDate || "";
}

type ExportAmountRecord = {
  soValueCapital?: unknown;
  soValueRevenue?: unknown;
  stageAmountCapital?: unknown;
  stageAmountRevenue?: unknown;
  actualPaymentCapital?: unknown;
  actualPaymentRevenue?: unknown;
  paymentDate?: unknown;
};

type ExportAmountOrder = ExportAmountRecord & {
  stageDelivery?: string;
  stagePayment?: string;
  advancePayment?: string;
  stageDeliveries?: ExportAmountRecord[];
  advancePaymentDetail?: ExportAmountRecord;
  supplementaryBills?: ExportAmountRecord[];
};

function amountValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.replace(/[₹,$\s]/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : undefined;
}

function recordedPairTotal(record: ExportAmountRecord, capitalKey: "soValueCapital" | "stageAmountCapital" | "actualPaymentCapital", revenueKey: "soValueRevenue" | "stageAmountRevenue" | "actualPaymentRevenue") {
  const capital = amountValue(record[capitalKey]);
  const revenue = amountValue(record[revenueKey]);
  if (capital === undefined && revenue === undefined) return undefined;
  return (capital ?? 0) + (revenue ?? 0);
}

export function getQuickEntryExportSoAmount(order: ExportAmountOrder) {
  const orderTotal = recordedPairTotal(order, "soValueCapital", "soValueRevenue");
  if (orderTotal !== undefined) return orderTotal;
  const stages = order.stageDelivery?.trim().toLowerCase() === "yes"
    ? order.stageDeliveries ?? []
    : [];
  if (!stages.length) return undefined;
  const stageTotals = stages.map((stage) => recordedPairTotal(stage, "stageAmountCapital", "stageAmountRevenue"));
  if (stageTotals.some((amount) => amount === undefined)) return undefined;
  return stageTotals.reduce<number>((total, amount) => total + (amount ?? 0), 0);
}

export function getQuickEntryExportSoAmountComponent(
  order: ExportAmountOrder,
  component: "capital" | "revenue",
  stage?: ExportAmountRecord,
) {
  const orderKey = component === "capital" ? "soValueCapital" : "soValueRevenue";
  const stageKey = component === "capital" ? "stageAmountCapital" : "stageAmountRevenue";
  if (stage) return amountValue(stage[stageKey]);

  if (recordedPairTotal(order, "soValueCapital", "soValueRevenue") !== undefined) {
    return amountValue(order[orderKey]);
  }

  const stages = order.stageDelivery?.trim().toLowerCase() === "yes"
    ? order.stageDeliveries ?? []
    : [];
  if (!stages.length) return undefined;
  const stageTotals = stages.map((item) =>
    recordedPairTotal(item, "stageAmountCapital", "stageAmountRevenue"),
  );
  if (stageTotals.some((amount) => amount === undefined)) return undefined;
  const componentValues = stages.map((item) => amountValue(item[stageKey]));
  if (componentValues.every((amount) => amount === undefined)) return undefined;
  return componentValues.reduce<number>((total, amount) => total + (amount ?? 0), 0);
}

export function getQuickEntryExportPaidSoFar(order: ExportAmountOrder) {
  const paidRecords: ExportAmountRecord[] = [];
  const stagewise = order.stagePayment?.trim().toLowerCase() === "yes";
  const stages = order.stageDelivery?.trim().toLowerCase() === "yes"
    ? order.stageDeliveries ?? []
    : [];
  if (stagewise && stages.length) {
    paidRecords.push(...stages.filter((stage) => Boolean(stage.paymentDate)));
  } else if (order.paymentDate) {
    paidRecords.push(order);
  }
  if (order.advancePayment?.trim().toLowerCase() === "yes" && order.advancePaymentDetail?.paymentDate) {
    paidRecords.push(order.advancePaymentDetail);
  }
  paidRecords.push(...(order.supplementaryBills ?? []).filter((bill) => Boolean(bill.paymentDate)));
  return paidRecords.reduce(
    (total, record) => total + (recordedPairTotal(record, "actualPaymentCapital", "actualPaymentRevenue") ?? 0),
    0,
  );
}
