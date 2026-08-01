import type {
  AdvancePaymentDetail,
  FileRecord,
  StageDeliveryDetail,
  SupplyOrderDetail,
} from "@/lib/files-store";

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
};

type DateFieldConfig = {
  id: string;
  label: string;
  group: string;
  scope: DemandProcessingDateScope;
  key: string;
};

const dateFieldConfigs: DateFieldConfig[] = [
  { id: "file.receivedDate", label: "Received date", group: "File details", scope: "file", key: "receivedDate" },
  { id: "file.date", label: "Demand date", group: "File details", scope: "file", key: "date" },
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
  { id: "file.adVettingDate", label: "AD vetting date", group: "Approval / vetting", scope: "file", key: "adVettingDate" },
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
  { id: "order.irPreparationDate", label: "IR preparation date", group: "Delivery / IR", scope: "order", key: "irPreparationDate" },
  { id: "order.irReceiptDate", label: "IR receipt date", group: "Delivery / IR", scope: "order", key: "irReceiptDate" },
  { id: "order.billPreparationDate", label: "Bill preparation date", group: "Bill / Payment", scope: "order", key: "billPreparationDate" },
  { id: "order.billSentForPaymentDate", label: "Bill sent for payment date", group: "Bill / Payment", scope: "order", key: "billSentForPaymentDate" },
  { id: "order.paymentDate", label: "Payment date", group: "Bill / Payment", scope: "order", key: "paymentDate" },
  { id: "order.soCancelledDate", label: "S.O. cancelled date", group: "Cancellation / Closure", scope: "order", key: "soCancelledDate" },
  { id: "stage.deliveryPeriodStartDate", label: "Stage delivery period start date", group: "Stage delivery", scope: "stage", key: "deliveryPeriodStartDate" },
  { id: "stage.dpDate", label: "Stage D.P. date", group: "Stage delivery", scope: "stage", key: "dpDate" },
  { id: "stage.revisedDp", label: "Stage revised D.P.", group: "Stage delivery", scope: "stage", key: "revisedDp" },
  { id: "stage.materialReceiptDate", label: "Stage material receipt date", group: "Stage delivery", scope: "stage", key: "materialReceiptDate" },
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
  { id: "builtin-received-control", name: "Received date to Demand control date", fromFieldId: "file.receivedDate", toFieldId: "file.immsDate", active: true },
  { id: "builtin-control-so", name: "Demand control date to S.O. date", fromFieldId: "file.immsDate", toFieldId: "order.soDate", active: true },
  { id: "builtin-fs-so", name: "Financial Sanction date to S.O. date", fromFieldId: "order.financialSanctionDate", toFieldId: "order.soDate", active: true },
  { id: "builtin-so-material", name: "S.O. date to Material receipt date", fromFieldId: "order.soDate", toFieldId: "order.materialReceiptDate", active: true },
  { id: "builtin-material-payment", name: "Material receipt date to Payment date", fromFieldId: "order.materialReceiptDate", toFieldId: "order.paymentDate", active: true },
  { id: "builtin-bill-sent-payment", name: "Bill sent for payment date to Payment date", fromFieldId: "order.billSentForPaymentDate", toFieldId: "order.paymentDate", active: true },
  { id: "builtin-ifa", name: "IFA sent date to IFA final date", fromFieldId: "file.ifaSentDate", toFieldId: "file.ifaFinalDate", active: true },
  { id: "builtin-pre-tcec", name: "Pre-TCEC date to Pre-TCEC minutes date", fromFieldId: "file.preTcecDate", toFieldId: "file.preTcecMinutesDate", active: true },
  { id: "builtin-post-tcec", name: "Post-TCEC date to Post-TCEC minutes date", fromFieldId: "file.postTcecDate", toFieldId: "file.postTcecMinutesDate", active: true },
  { id: "builtin-cnc", name: "CNC date to CNC approval date", fromFieldId: "file.cncDate", toFieldId: "file.cncApprovalDate", active: true },
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
  const scope = getAnalysisScope(fromField.scope, toField.scope);
  const rows: DemandProcessingAnalysisRow[] = [];

  files.forEach((file) => {
    const fileRef = file.fileNo || file.uniqueCode || file.title || "Untitled file";
    const addRow = (
      basis: DemandProcessingAnalysisRow["basis"],
      orderRef: string,
      fromDate: string | undefined,
      toDate: string | undefined,
      orderIndex?: number,
      stageIndex?: number,
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
      });
    };

    if (scope === "file") {
      addRow("File", "-", fromField.getValue(file), toField.getValue(file));
      return;
    }
    const orders = file.supplyOrders?.length ? file.supplyOrders : [{} as SupplyOrderDetail];
    orders.forEach((order, orderIndex) => {
      const orderRef = order.soNo || order.gemSoNo || `S.O. ${orderIndex + 1}`;
      if (scope === "order") {
        addRow(
          "S.O.",
          orderRef,
          fromField.getValue(file, order),
          toField.getValue(file, order),
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
          orderIndex,
          stageIndex,
        );
      });
    });
  });
  return rows;
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
