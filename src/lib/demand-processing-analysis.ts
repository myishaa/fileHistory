import type {
  AdvancePaymentDetail,
  BillReturnCycle,
  FileRecord,
  StageDeliveryDetail,
  SupplementaryBillDetail,
  SupplyOrderDetail,
} from "@/lib/files-store";
import { getInrAmount } from "@/lib/money";

export type DemandProcessingDateScope = "file" | "order" | "stage" | "advance";

export type DemandProcessingDateField = {
  id: string;
  label: string;
  group: string;
  scope: DemandProcessingDateScope;
  getValue: (
    file: FileRecord,
    order?: SupplyOrderDetail,
    stage?: StageDeliveryDetail,
    advance?: AdvancePaymentDetail,
  ) => string | undefined;
};

export type DemandProcessingPreset = {
  id: string;
  name: string;
  fromFieldId: string;
  toFieldId: string;
  active?: boolean;
};

export type DemandProcessingAnalysisRow = {
  fileId: string;
  fileRef: string;
  division: string;
  orderRef: string;
  orderIndex?: number;
  stageIndex?: number;
  basis: "File" | "S.O." | "Stage" | "Advance";
  fromDate: string;
  toDate: string;
  gapDays: number;
  valueCapital: number;
  valueRevenue: number;
  paymentMode?: string;
};

type DateFieldConfig = {
  id: string;
  label: string;
  group: string;
  scope: DemandProcessingDateScope;
  key: string;
};

const dateFieldConfigs: DateFieldConfig[] = [
  { id: "file.receivedDate", label: "Demand received date", group: "File details", scope: "file", key: "receivedDate" },
  { id: "file.demandCancelledDate", label: "Demand cancelled date", group: "File details", scope: "file", key: "demandCancelledDate" },
  { id: "file.scrutinyDate", label: "Scrutiny date", group: "Scrutiny", scope: "file", key: "scrutinyDate" },
  { id: "file.scrutinyResponseDate", label: "Scrutiny response date", group: "Scrutiny", scope: "file", key: "scrutinyResponseDate" },
  { id: "file.scrutinyCompletionDate", label: "Scrutiny completion date", group: "Scrutiny", scope: "file", key: "scrutinyCompletionDate" },
  { id: "file.immsDate", label: "Demand control date", group: "Scrutiny", scope: "file", key: "immsDate" },
  { id: "file.highValueMeetingDate", label: "High Value meeting date", group: "Approval / vetting", scope: "file", key: "highValueMeetingDate" },
  { id: "file.highValueMinutesDate", label: "High Value minutes date", group: "Approval / vetting", scope: "file", key: "highValueMinutesDate" },
  { id: "file.preTcecDate", label: "Pre-TCEC date", group: "TCEC", scope: "file", key: "preTcecDate" },
  { id: "file.preTcecMinutesDate", label: "Pre-TCEC minutes date", group: "TCEC", scope: "file", key: "preTcecMinutesDate" },
  { id: "file.postTcecDate", label: "Post-TCEC date", group: "TCEC", scope: "file", key: "postTcecDate" },
  { id: "file.postTcecMinutesDate", label: "Post-TCEC minutes date", group: "TCEC", scope: "file", key: "postTcecMinutesDate" },
  { id: "file.refloatPostTcecDate", label: "Refloat Post-TCEC date", group: "TCEC", scope: "file", key: "refloatPostTcecDate" },
  { id: "file.refloatPostTcecMinutesDate", label: "Refloat Post-TCEC minutes date", group: "TCEC", scope: "file", key: "refloatPostTcecMinutesDate" },
  { id: "file.adSentDate", label: "AD sent date", group: "Approval / vetting", scope: "file", key: "adSentDate" },
  { id: "file.adVettingDate", label: "AD vetting date", group: "Approval / vetting", scope: "file", key: "adVettingDate" },
  { id: "file.rqaSentDate", label: "R&QA sent date", group: "Approval / vetting", scope: "file", key: "rqaSentDate" },
  { id: "file.rqaApprovalDate", label: "R&QA approval date", group: "Approval / vetting", scope: "file", key: "rqaApprovalDate" },
  { id: "file.ifaSentDate", label: "IFA sent date", group: "Approval / vetting", scope: "file", key: "ifaSentDate" },
  { id: "file.ifaFinalDate", label: "IFA final date", group: "Approval / vetting", scope: "file", key: "ifaFinalDate" },
  { id: "file.cfaSentDate", label: "CFA sent date", group: "Approval / vetting", scope: "file", key: "cfaSentDate" },
  { id: "file.cfaDate", label: "CFA approval date", group: "Approval / vetting", scope: "file", key: "cfaDate" },
  { id: "file.gemUndertakingDate", label: "GeM undertaking date", group: "Bidding", scope: "file", key: "gemUndertakingDate" },
  { id: "file.rfpVettingInitiationDate", label: "RFP vetting initiation date", group: "Bidding", scope: "file", key: "rfpVettingInitiationDate" },
  { id: "file.rfpVettingApprovalDate", label: "RFP vetting approval date", group: "Bidding", scope: "file", key: "rfpVettingApprovalDate" },
  { id: "file.bidDate", label: "Bid date", group: "Bidding", scope: "file", key: "bidDate" },
  { id: "file.bidOpeningDate", label: "Bid opening date", group: "Bidding", scope: "file", key: "bidOpeningDate" },
  { id: "file.refloatBiddingDate", label: "Refloat bidding date", group: "Bidding", scope: "file", key: "refloatBiddingDate" },
  { id: "file.refloatBidOpeningDate", label: "Refloat bid opening date", group: "Bidding", scope: "file", key: "refloatBidOpeningDate" },
  { id: "file.cncDate", label: "CNC date", group: "Bidding", scope: "file", key: "cncDate" },
  { id: "file.cncApprovalDate", label: "CNC approval date", group: "Bidding", scope: "file", key: "cncApprovalDate" },
  { id: "order.financialSanctionDate", label: "Financial Sanction date", group: "Financial Sanction", scope: "order", key: "financialSanctionDate" },
  { id: "order.soDate", label: "S.O. date", group: "Supply Order", scope: "order", key: "soDate" },
  { id: "order.dpDate", label: "D.P. date", group: "Delivery Period", scope: "order", key: "dpDate" },
  { id: "order.revisedDp", label: "Revised D.P.", group: "Delivery Period", scope: "order", key: "revisedDp" },
  { id: "order.psbBgReceivedDate", label: "PSB BG received date", group: "Security/Warranty BG", scope: "order", key: "psbBgReceivedDate" },
  { id: "order.psbBgValidityDate", label: "PSB BG validity date", group: "Security/Warranty BG", scope: "order", key: "psbBgValidityDate" },
  { id: "order.psbBgReturnDate", label: "PSB BG return date", group: "Security/Warranty BG", scope: "order", key: "psbBgReturnDate" },
  { id: "order.pwbBgReceivedDate", label: "PWB BG received date", group: "Security/Warranty BG", scope: "order", key: "pwbBgReceivedDate" },
  { id: "order.pwbBgValidityDate", label: "PWB BG validity date", group: "Security/Warranty BG", scope: "order", key: "pwbBgValidityDate" },
  { id: "order.pwbBgReturnDate", label: "PWB BG return date", group: "Security/Warranty BG", scope: "order", key: "pwbBgReturnDate" },
  { id: "order.combinedBgReceivedDate", label: "PSB+PWB BG received date", group: "Security/Warranty BG", scope: "order", key: "combinedBgReceivedDate" },
  { id: "order.combinedBgValidityDate", label: "PSB+PWB BG validity date", group: "Security/Warranty BG", scope: "order", key: "combinedBgValidityDate" },
  { id: "order.combinedBgReturnDate", label: "PSB+PWB BG return date", group: "Security/Warranty BG", scope: "order", key: "combinedBgReturnDate" },
  { id: "order.materialReceiptDate", label: "Material receipt date", group: "Delivery / IR", scope: "order", key: "materialReceiptDate" },
  { id: "order.jobCompletionDate", label: "Job Completion Date", group: "Delivery / IR", scope: "order", key: "jobCompletionDate" },
  { id: "order.irPreparationDate", label: "IR preparation date", group: "Delivery / IR", scope: "order", key: "irPreparationDate" },
  { id: "order.irReceiptDate", label: "IR receipt date", group: "Delivery / IR", scope: "order", key: "irReceiptDate" },
  { id: "order.billPreparationDate", label: "Bill preparation date", group: "Bill / Payment", scope: "order", key: "billPreparationDate" },
  { id: "order.billSentForPaymentDate", label: "Bill sent for payment date", group: "Bill / Payment", scope: "order", key: "billSentForPaymentDate" },
  { id: "order.paymentDate", label: "Payment date", group: "Bill / Payment", scope: "order", key: "paymentDate" },
  { id: "payment.unifiedSubmissionDate", label: "Unified bill submission / resubmission date", group: "Bill / Payment", scope: "order", key: "__unifiedSubmissionDate" },
  { id: "payment.unifiedReturnDate", label: "Unified bill return date", group: "Bill / Payment", scope: "order", key: "__unifiedReturnDate" },
  { id: "payment.unifiedPaymentDate", label: "Unified payment date", group: "Bill / Payment", scope: "order", key: "__unifiedPaymentDate" },
  { id: "order.soCancelledDate", label: "S.O. cancelled date", group: "Cancellation / Closure", scope: "order", key: "soCancelledDate" },
  { id: "stage.deliveryPeriodStartDate", label: "Stage delivery period start date", group: "Stage delivery", scope: "stage", key: "deliveryPeriodStartDate" },
  { id: "stage.dpDate", label: "Stage D.P. date", group: "Stage delivery", scope: "stage", key: "dpDate" },
  { id: "stage.revisedDp", label: "Stage revised D.P.", group: "Stage delivery", scope: "stage", key: "revisedDp" },
  { id: "stage.materialReceiptDate", label: "Stage material receipt date", group: "Stage delivery", scope: "stage", key: "materialReceiptDate" },
  { id: "stage.jobCompletionDate", label: "Stage Job Completion Date", group: "Stage delivery", scope: "stage", key: "jobCompletionDate" },
  { id: "stage.irPreparationDate", label: "Stage IR preparation date", group: "Stage delivery", scope: "stage", key: "irPreparationDate" },
  { id: "stage.irReceiptDate", label: "Stage IR receipt date", group: "Stage delivery", scope: "stage", key: "irReceiptDate" },
  { id: "stage.billPreparationDate", label: "Stage bill preparation date", group: "Stage payment", scope: "stage", key: "billPreparationDate" },
  { id: "stage.billSentForPaymentDate", label: "Stage bill sent for payment date", group: "Stage payment", scope: "stage", key: "billSentForPaymentDate" },
  { id: "stage.paymentDate", label: "Stage payment date", group: "Stage payment", scope: "stage", key: "paymentDate" },
  { id: "advance.billPreparationDate", label: "Advance bill preparation date", group: "Advance payment", scope: "advance", key: "billPreparationDate" },
  { id: "advance.billSentForPaymentDate", label: "Advance bill sent for payment date", group: "Advance payment", scope: "advance", key: "billSentForPaymentDate" },
  { id: "advance.paymentDate", label: "Advance payment date", group: "Advance payment", scope: "advance", key: "paymentDate" },
];

export const demandProcessingDateFields: DemandProcessingDateField[] = dateFieldConfigs.map(
  (field) => ({
    ...field,
    getValue: (file, order, stage, advance) => {
      const source =
        field.scope === "file" ? file : field.scope === "order" ? order : field.scope === "stage" ? stage : advance;
      return String((source as Record<string, unknown> | undefined)?.[field.key] ?? "") || undefined;
    },
  }),
);

export const builtInDemandProcessingPresets: DemandProcessingPreset[] = [
  { id: "builtin-received-control", name: "Demand control based on Demand received date", fromFieldId: "file.receivedDate", toFieldId: "file.immsDate", active: true },
  { id: "builtin-control-so", name: "S.O. based on Demand control date", fromFieldId: "file.immsDate", toFieldId: "order.soDate", active: true },
  { id: "builtin-fs-so", name: "S.O. based on Financial Sanction date", fromFieldId: "order.financialSanctionDate", toFieldId: "order.soDate", active: true },
  { id: "builtin-so-material", name: "Material receipt based on S.O. date", fromFieldId: "order.soDate", toFieldId: "order.materialReceiptDate", active: true },
  { id: "builtin-payment-submission-payment", name: "Payment: Unified payment based on Unified bill submission / resubmission", fromFieldId: "payment.unifiedSubmissionDate", toFieldId: "payment.unifiedPaymentDate", active: true },
  { id: "builtin-payment-material-submission", name: "Payment: Unified bill submission / resubmission based on Material receipt", fromFieldId: "order.materialReceiptDate", toFieldId: "payment.unifiedSubmissionDate", active: true },
  { id: "builtin-payment-job-submission", name: "Payment: Unified bill submission / resubmission based on Job Completion", fromFieldId: "order.jobCompletionDate", toFieldId: "payment.unifiedSubmissionDate", active: true },
  { id: "builtin-payment-material-payment", name: "Payment: Unified payment based on Material receipt", fromFieldId: "order.materialReceiptDate", toFieldId: "payment.unifiedPaymentDate", active: true },
  { id: "builtin-ifa", name: "IFA final based on IFA sent date", fromFieldId: "file.ifaSentDate", toFieldId: "file.ifaFinalDate", active: true },
  { id: "builtin-pre-tcec", name: "Pre-TCEC minutes based on Pre-TCEC date", fromFieldId: "file.preTcecDate", toFieldId: "file.preTcecMinutesDate", active: true },
  { id: "builtin-post-tcec", name: "Post-TCEC minutes based on Post-TCEC date", fromFieldId: "file.postTcecDate", toFieldId: "file.postTcecMinutesDate", active: true },
  { id: "builtin-refloat-post-tcec", name: "Refloat Post-TCEC minutes based on Refloat Post-TCEC date", fromFieldId: "file.refloatPostTcecDate", toFieldId: "file.refloatPostTcecMinutesDate", active: true },
  { id: "builtin-cnc", name: "CNC approval based on CNC date", fromFieldId: "file.cncDate", toFieldId: "file.cncApprovalDate", active: true },
];

export function getDemandProcessingField(id: string) {
  return demandProcessingDateFields.find((field) => field.id === id);
}

export function getDemandProcessingFieldGroups() {
  const groups = new Map<string, DemandProcessingDateField[]>();
  demandProcessingDateFields.forEach((field) => {
    groups.set(field.group, [...(groups.get(field.group) ?? []), field]);
  });
  return Array.from(groups, ([title, fields]) => ({ title, fields }));
}

export function normalizeDemandProcessingPresets(value: unknown): DemandProcessingPreset[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const record = item as Record<string, unknown>;
      const id = String(record.id ?? "").trim();
      const name = String(record.name ?? "").trim();
      const fromFieldId = String(record.fromFieldId ?? "").trim();
      const toFieldId = String(record.toFieldId ?? "").trim();
      if (!id || !name || !getDemandProcessingField(fromFieldId) || !getDemandProcessingField(toFieldId)) {
        return undefined;
      }
      return { id, name, fromFieldId, toFieldId, active: record.active !== false };
    })
    .filter((preset): preset is DemandProcessingPreset => Boolean(preset));
}

export function getDemandProcessingPresets(customPresets: unknown) {
  return [
    ...builtInDemandProcessingPresets,
    ...normalizeDemandProcessingPresets(customPresets).filter((preset) => preset.active !== false),
  ];
}

export function buildDemandProcessingRows(
  files: FileRecord[],
  fromFieldId: string,
  toFieldId: string,
) {
  const fromField = getDemandProcessingField(fromFieldId);
  const toField = getDemandProcessingField(toFieldId);
  if (!fromField || !toField) return [];
  const usesUnifiedPaymentField =
    isUnifiedPaymentField(fromFieldId) || isUnifiedPaymentField(toFieldId);
  const scope = getAnalysisScope(fromField.scope, toField.scope);
  const rows: DemandProcessingAnalysisRow[] = [];

  files.forEach((file) => {
    const fileRef = file.fileNo || file.uniqueCode || file.title || "Untitled file";
    const addRow = (
      basis: DemandProcessingAnalysisRow["basis"],
      orderRef: string,
      fromDate: string | undefined,
      toDate: string | undefined,
      valueCapital: number,
      valueRevenue: number,
      orderIndex?: number,
      stageIndex?: number,
      paymentMode?: string,
    ) => {
      if (!isIsoDate(fromDate) || !isIsoDate(toDate)) return;
      rows.push({
        fileId: file.id,
        fileRef,
        division: file.division || "Unassigned",
        orderRef,
        orderIndex,
        stageIndex,
        basis,
        fromDate,
        toDate,
        gapDays: differenceInDays(fromDate, toDate),
        valueCapital,
        valueRevenue,
        paymentMode,
      });
    };

    if (usesUnifiedPaymentField) {
      (file.supplyOrders ?? []).forEach((order, orderIndex) => {
        getUnifiedPaymentEvents(file, order, orderIndex).forEach((event) => {
          addRow(
            event.basis,
            event.orderRef,
            getUnifiedDemandProcessingValue(fromField, file, order, event),
            getUnifiedDemandProcessingValue(toField, file, order, event),
            event.valueCapital,
            event.valueRevenue,
            orderIndex,
            event.stageIndex,
            event.paymentMode,
          );
        });
      });
      return;
    }

    if (scope === "file") {
      const value = getDemandProcessingFileValue(file);
      addRow(
        "File",
        "-",
        fromField.getValue(file),
        toField.getValue(file),
        value.capital,
        value.revenue,
      );
      return;
    }
    const orders = file.supplyOrders?.length ? file.supplyOrders : [{} as SupplyOrderDetail];
    orders.forEach((order, orderIndex) => {
      const orderRef = order.soNo || order.gemSoNo || `S.O. ${orderIndex + 1}`;
      const value = getDemandProcessingOrderValue(file, order);
      if (scope === "order") {
        addRow(
          "S.O.",
          orderRef,
          fromField.getValue(file, order),
          toField.getValue(file, order),
          value.capital,
          value.revenue,
          orderIndex,
        );
        return;
      }
      if (scope === "advance") {
        addRow(
          "Advance",
          `${orderRef} / Advance`,
          fromField.getValue(file, order, undefined, order.advancePaymentDetail),
          toField.getValue(file, order, undefined, order.advancePaymentDetail),
          value.capital,
          value.revenue,
          orderIndex,
        );
        return;
      }
      const stages = order.stageDeliveries ?? [];
      stages.forEach((stage, stageIndex) => {
        addRow(
          "Stage",
          `${orderRef} / Stage ${stageIndex + 1}`,
          fromField.getValue(file, order, stage),
          toField.getValue(file, order, stage),
          value.capital,
          value.revenue,
          orderIndex,
          stageIndex,
        );
      });
    });
  });
  return rows;
}

type UnifiedPaymentEvent = {
  basis: DemandProcessingAnalysisRow["basis"];
  orderRef: string;
  orderIndex: number;
  stageIndex?: number;
  submissionDate?: string;
  returnDate?: string;
  paymentDate?: string;
  paymentMode?: string;
  valueCapital: number;
  valueRevenue: number;
};

function isUnifiedPaymentField(fieldId: string) {
  return fieldId.startsWith("payment.unified");
}

function getUnifiedDemandProcessingValue(
  field: DemandProcessingDateField,
  file: FileRecord,
  order: SupplyOrderDetail,
  event: UnifiedPaymentEvent,
) {
  if (field.id === "payment.unifiedSubmissionDate") return event.submissionDate;
  if (field.id === "payment.unifiedReturnDate") return event.returnDate;
  if (field.id === "payment.unifiedPaymentDate") return event.paymentDate;
  return field.getValue(file, order);
}

function getUnifiedPaymentEvents(
  file: FileRecord,
  order: SupplyOrderDetail,
  orderIndex: number,
): UnifiedPaymentEvent[] {
  const orderRef = order.soNo || order.gemSoNo || `S.O. ${orderIndex + 1}`;
  const orderValue = getDemandProcessingOrderValue(file, order);
  const events: UnifiedPaymentEvent[] = [
    ...buildUnifiedPaymentEventsForPaymentObject({
      basis: "S.O.",
      orderRef,
      orderIndex,
      paymentObject: order,
      fallbackValue: orderValue,
    }),
  ];

  (order.stageDeliveries ?? []).forEach((stage, stageIndex) => {
    events.push(
      ...buildUnifiedPaymentEventsForPaymentObject({
        basis: "Stage",
        orderRef: `${orderRef} / Stage ${stageIndex + 1}`,
        orderIndex,
        stageIndex,
        paymentObject: stage,
        fallbackValue: orderValue,
        amountCapital: stage.stageAmountCapital,
        amountRevenue: stage.stageAmountRevenue,
        file,
      }),
    );
  });

  if (order.advancePaymentDetail) {
    events.push(
      ...buildUnifiedPaymentEventsForPaymentObject({
        basis: "Advance",
        orderRef: `${orderRef} / Advance`,
        orderIndex,
        paymentObject: order.advancePaymentDetail,
        fallbackValue: orderValue,
        amountCapital:
          order.advancePaymentDetail.actualPaymentCapital ||
          order.advancePaymentDetail.stageAmountCapital,
        amountRevenue:
          order.advancePaymentDetail.actualPaymentRevenue ||
          order.advancePaymentDetail.stageAmountRevenue,
        file,
      }),
    );
  }

  (order.supplementaryBills ?? []).forEach((bill, billIndex) => {
    events.push(
      ...buildUnifiedPaymentEventsForPaymentObject({
        basis: "S.O.",
        orderRef: `${orderRef} / Supplementary bill ${billIndex + 1}`,
        orderIndex,
        paymentObject: bill,
        fallbackValue: orderValue,
        amountCapital: bill.actualPaymentCapital || bill.billAmountCapital,
        amountRevenue: bill.actualPaymentRevenue || bill.billAmountRevenue,
        file,
      }),
    );
  });

  return events;
}

type PaymentLike = Pick<
  SupplyOrderDetail,
  "billSentForPaymentDate" | "billReturnCycles" | "paymentDate" | "paymentMode"
> &
  Partial<
    Pick<
      StageDeliveryDetail &
        AdvancePaymentDetail &
        SupplementaryBillDetail,
      | "stageAmountCapital"
      | "stageAmountRevenue"
      | "billAmountCapital"
      | "billAmountRevenue"
      | "actualPaymentCapital"
      | "actualPaymentRevenue"
    >
  >;

function buildUnifiedPaymentEventsForPaymentObject({
  basis,
  orderRef,
  orderIndex,
  stageIndex,
  paymentObject,
  fallbackValue,
  amountCapital,
  amountRevenue,
  file,
}: {
  basis: DemandProcessingAnalysisRow["basis"];
  orderRef: string;
  orderIndex: number;
  stageIndex?: number;
  paymentObject: PaymentLike;
  fallbackValue: { capital: number; revenue: number };
  amountCapital?: string;
  amountRevenue?: string;
  file?: FileRecord;
}): UnifiedPaymentEvent[] {
  const value = {
    capital: file ? (getInrAmount(amountCapital, file) ?? fallbackValue.capital) : fallbackValue.capital,
    revenue: file ? (getInrAmount(amountRevenue, file) ?? fallbackValue.revenue) : fallbackValue.revenue,
  };
  const base = {
    basis,
    orderRef,
    orderIndex,
    stageIndex,
    paymentDate: paymentObject.paymentDate,
    paymentMode: cleanPaymentModeValue(paymentObject.paymentMode),
    valueCapital: value.capital,
    valueRevenue: value.revenue,
  };
  const cycles = normalizeBillReturnCycles(paymentObject.billReturnCycles);
  const returnedEvents = cycles
    .filter((cycle) => hasFilledString(cycle.returnedDate))
    .map((cycle) => ({
      ...base,
      returnDate: cycle.returnedDate,
      submissionDate: cycle.resubmittedDate,
    }));
  if (returnedEvents.length) return returnedEvents;
  if (hasFilledString(paymentObject.billSentForPaymentDate) || hasFilledString(paymentObject.paymentDate)) {
    return [{ ...base, submissionDate: paymentObject.billSentForPaymentDate }];
  }
  return [];
}

function normalizeBillReturnCycles(cycles: BillReturnCycle[] | undefined) {
  return (Array.isArray(cycles) ? cycles : []).filter((cycle) =>
    [cycle.returnedDate, cycle.reason, cycle.resubmittedDate, cycle.remarks].some(hasFilledString),
  );
}

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
}

function cleanPaymentModeValue(value: string | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.toLowerCase() === "select" ? "" : normalized;
}

function getDemandProcessingFileValue(file: FileRecord) {
  const placedOrders = file.supplyOrders?.filter(isSupplyOrderPlaced) ?? [];
  if (placedOrders.length) {
    return placedOrders.reduce(
      (total, order) => ({
        capital: total.capital + (getInrAmount(order.soValueCapital, file) ?? 0),
        revenue: total.revenue + (getInrAmount(order.soValueRevenue, file) ?? 0),
      }),
      { capital: 0, revenue: 0 },
    );
  }
  return getDemandValue(file);
}

function getDemandProcessingOrderValue(file: FileRecord, order: SupplyOrderDetail) {
  if (!isSupplyOrderPlaced(order)) return getDemandValue(file);
  return {
    capital: getInrAmount(order.soValueCapital, file) ?? 0,
    revenue: getInrAmount(order.soValueRevenue, file) ?? 0,
  };
}

function getDemandValue(file: FileRecord) {
  return {
    capital: getInrAmount(file.valueCapital, file) ?? 0,
    revenue: getInrAmount(file.valueRevenue, file) ?? 0,
  };
}

function isSupplyOrderPlaced(order: SupplyOrderDetail) {
  return Boolean(order.soDate?.trim());
}

function getAnalysisScope(
  fromScope: DemandProcessingDateScope,
  toScope: DemandProcessingDateScope,
): DemandProcessingDateScope {
  if (fromScope === "stage" || toScope === "stage") return "stage";
  if (fromScope === "advance" || toScope === "advance") return "advance";
  if (fromScope === "order" || toScope === "order") return "order";
  return "file";
}

function isIsoDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function differenceInDays(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T00:00:00Z`).getTime();
  const to = new Date(`${toDate}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}
