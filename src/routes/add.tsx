import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchFile,
  fetchNextUniqueCode,
  fetchIndentors,
  store,
  type Division,
  type FileMessage,
  type FileMarker,
  type FileRecord,
  type FileRemark,
  type FirmDetail,
  type AdvancePaymentDetail,
  type StageDeliveryDetail,
  type SupplyOrderDetail,
  type ValueThresholdLevel,
  useAccessibleDivisions,
  useActiveUser,
  useDivisions,
  useFiles,
  useMessages,
  useSettings,
} from "@/lib/files-store";
import { MessageSquare, Save, Eraser, Lock, Plus, Printer, Trash2, Unlock } from "lucide-react";
import { promptDeletionPassword, requestDeletionPassword } from "@/lib/delete-password";
import { downloadBackendExport, getExportFileName } from "@/lib/export-download";
import {
  getMilestoneValidationTarget,
  validateMilestoneCompletionConsistency,
} from "@/lib/milestone-validation";
import { fileSupplyOrders as expandedFileSupplyOrders } from "@/lib/effective-deliveries";
import { displayFinancialYearLabel, isAllActiveFilesYear } from "@/lib/year-filter";

export const Route = createFileRoute("/add")({
  validateSearch: (search: Record<string, unknown>) => ({
    fileId: typeof search.fileId === "string" ? search.fileId : undefined,
    section: typeof search.section === "string" ? search.section : undefined,
    milestone: typeof search.milestone === "string" ? search.milestone : undefined,
    focusTarget: typeof search.focusTarget === "string" ? search.focusTarget : undefined,
    quickFocus: search.quickFocus === true || search.quickFocus === "true",
  }),
  component: AddFilePage,
});

const empty = {
  title: "",
  division: "",
  officer: "",
  imms: "",
  date: "",
  year: "",
  uniqueCode: "",
  receivedDate: "",
  scrutinyDate: "",
  scrutinyResponseDate: "",
  scrutinyCompletionDate: "",
  immsDate: "",
  fileNo: "",
  indentor: "",
  demandDescription: "",
  valueCapital: "",
  valueRevenue: "",
  currency: "INR",
  exchangeRate: "1",
  gte: "No",
  valueCapitalSelected: "",
  valueRevenueSelected: "",
  tcec: "",
  fileType: "Goods & Services",
  mode: "",
  gem: "",
  highValue: "",
  ad: "",
  rqa: "",
  ifa: "",
  psb: "",
  bg: "",
  ir: "",
  rfpVetting: "No",
  highValueMeetingDate: "",
  highValueMinutesDate: "",
  preTcecDate: "",
  preTcecMinutesDate: "",
  preTcecCommitteeNo: "",
  adVettingDate: "",
  rqaApprovalDate: "",
  ifaSentDate: "",
  ifaFinalDate: "",
  cfaSentDate: "",
  cfaDate: "",
  gemUndertakingDate: "",
  rfpVettingInitiationDate: "",
  rfpVettingApprovalDate: "",
  tenderLive: "No",
  bidNumber: "",
  bidDate: "",
  bidOpeningDate: "",
  bidOpened: "",
  refloat: "No",
  postTcecDate: "",
  postTcecMinutesDate: "",
  postTcecCommitteeNumber: "",
  refloatBiddingDate: "",
  refloatBidOpeningDate: "",
  rst: "No",
  biddingStageOver: "No",
  cncDate: "",
  cncApprovalDate: "",
  noOfSo: "1",
  soNo: "",
  gemSoNo: "",
  soDate: "",
  soValueCapital: "",
  soValueRevenue: "",
  dpDate: "",
  firm: "",
  bgValidityDate: "",
  dpExtension: "No",
  dpExtensionCount: "",
  ld: "No",
  ldType: "",
  ldPercentage: "",
  revisedDp: "",
  materialReceiptDate: "",
  irPreparationDate: "",
  irReceiptDate: "",
  billPreparationDate: "",
  billSentForPaymentDate: "",
  paymentDate: "",
  paymentMode: "",
  actualPaymentCapital: "",
  actualPaymentRevenue: "",
  bgReturnDate: "",
  demandCancelled: "No",
  demandCancelledDate: "",
  soCancelled: "No",
  soCancelledDate: "",
};

const defaultMilestones = [
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
  "CNC",
  "Financial Sanction",
  "Supply Order",
  "Delivery Period",
  "Bank Guarantee",
  "Delivery",
  "Bill sent for payment",
  "Payment",
  "File Closed",
];
const fileClosedMilestone = "File Closed";
const supplyOrderMilestoneNames = [
  "Financial Sanction",
  "Supply Order",
  "Bank Guarantee",
  "Delivery",
  "IR Preparation",
  "IR Receipt",
  "Bill preparation",
  "Bill sent for payment",
  "Payment",
] as const;
type SupplyOrderMilestoneName = (typeof supplyOrderMilestoneNames)[number];

type MilestoneProgress = {
  completed: number;
  total: number;
  current?: boolean;
  label?: string;
};

const supplyOrderMilestoneDateKeys = {
  "Financial Sanction": "financialSanctionDate",
  "Supply Order": "soDate",
  "Bank Guarantee": "bgValidityDate",
  Delivery: "materialReceiptDate",
  "IR Preparation": "irPreparationDate",
  "IR Receipt": "irReceiptDate",
  "Bill preparation": "billPreparationDate",
  "Bill sent for payment": "billSentForPaymentDate",
  Payment: "paymentDate",
} as const satisfies Record<SupplyOrderMilestoneName, keyof SupplyOrderDetail>;

type FormState = typeof empty;
type FieldKey = keyof FormState;
type SupplyOrderKey = keyof SupplyOrderDetail;
type AdvancePaymentKey = keyof AdvancePaymentDetail;
type StageDeliveryKey = keyof StageDeliveryDetail;

function createEmptyForm(financialYear: string): FormState {
  return { ...empty, year: financialYear };
}

const formKeys = Object.keys(empty) as FieldKey[];

function createFormFromFile(file: FileRecord, financialYear: string): FormState {
  const supplyOrderCount = normalizeSupplyOrderRows(file).length;
  const noOfSo = String(
    clampSupplyOrderCount(hasFilledValue(file.noOfSo) ? (file.noOfSo ?? "") : String(supplyOrderCount)),
  );
  return {
    ...createEmptyForm(financialYear),
    ...Object.fromEntries(
      formKeys.map((key) => [key, String((file as Record<string, unknown>)[key] ?? empty[key])]),
    ),
    valueCapitalSelected: hasNonZeroAmount(file.valueCapital) ? "Yes" : "",
    valueRevenueSelected: hasNonZeroAmount(file.valueRevenue) ? "Yes" : "",
    noOfSo,
    year: file.year ?? financialYear,
  } as FormState;
}

function createFirmDetailsFromFile(file: FileRecord | undefined): FirmDetailsState {
  return {
    invitedFirms: normalizeFirmRows(file?.invitedFirms),
    bidderFirms: normalizeFirmRows(file?.bidderFirms),
  };
}

function normalizeCompletedMilestones(value: string[] | undefined) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeActiveYears(file: FileRecord | undefined, financialYear: string) {
  const years = file?.activeYears?.length ? file.activeYears : [file?.year ?? financialYear];
  return Array.from(new Set(years.filter(Boolean)));
}

function getLatestTwoYears(financialYear: string, financialYears: string[]) {
  return Array.from(new Set([financialYear, ...financialYears].filter(Boolean)))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 2);
}

function normalizeSelectableActiveYears(
  years: string[],
  options: string[],
  fallbackYear: string,
  locked: boolean,
) {
  if (locked) return [fallbackYear].filter(Boolean);
  const allowed = new Set(options);
  const selected = years.filter((year) => allowed.has(year));
  return selected.length ? [selected[0]] : [fallbackYear].filter(Boolean);
}

function getAutoCompletedMilestones(
  milestones: string[],
  applicableMilestones: Set<string>,
  form: FormState,
) {
  if (!isYes(form.biddingStageOver)) return [];
  const biddingMilestone = milestones.find(
    (milestone) =>
      normalizeMilestoneName(milestone) === "bidding" && applicableMilestones.has(milestone),
  );
  return biddingMilestone ? [biddingMilestone] : [];
}

function getCompletedMilestonesForSave(
  milestones: string[],
  applicableMilestones: Set<string>,
  completedMilestones: string[],
  form: FormState,
  supplyOrderMilestoneProgress: Record<string, { completed: number; total: number }> = {},
) {
  const autoCompleted = getAutoCompletedMilestones(milestones, applicableMilestones, form);
  const orderDrivenMilestones = new Set(
    milestones
      .filter((milestone) => supplyOrderMilestoneProgress[normalizeMilestoneName(milestone)])
      .map(normalizeMilestoneName),
  );
  const autoCompletedOrderMilestones = milestones.filter((milestone) => {
    const progress = supplyOrderMilestoneProgress[normalizeMilestoneName(milestone)];
    return progress && progress.total > 0 && progress.completed >= progress.total;
  });
  const completedSet = new Set([
    ...completedMilestones.filter(
      (milestone) => !orderDrivenMilestones.has(normalizeMilestoneName(milestone)),
    ),
    ...autoCompleted,
    ...autoCompletedOrderMilestones,
  ]);
  return milestones.filter((milestone) => completedSet.has(milestone));
}

function createSupplyOrdersFromFile(file: FileRecord | undefined): SupplyOrderDetail[] {
  const rows = normalizeSupplyOrderRows(file);
  if (!file) return resizeSupplyOrders(rows, clampSupplyOrderCount(empty.noOfSo));
  const count = clampSupplyOrderCount(
    hasFilledValue(file.noOfSo) ? (file.noOfSo ?? "") : String(rows.length),
  );
  return resizeSupplyOrders(rows, count);
}

function normalizeFirmRows(rows: FirmDetail[] | undefined): Required<FirmDetail>[] {
  const normalized =
    rows
      ?.map((row) => ({
        firmName: row.firmName ?? "",
        city: row.city ?? "",
        emailId: row.emailId ?? "",
      }))
      .filter((row) => row.firmName || row.city || row.emailId) ?? [];
  return normalized;
}

type ExtraField<K extends string = FieldKey> = {
  key: K;
  label: string;
  type?: "date" | "number" | "textarea";
  control?: "radio";
  options?: string[];
  placeholder?: string;
  typeahead?: boolean;
  min?: number;
};

const tcecDisabledKeys: FieldKey[] = [
  "highValueMeetingDate",
  "highValueMinutesDate",
  "preTcecDate",
  "preTcecMinutesDate",
  "preTcecCommitteeNo",
  "adVettingDate",
  "postTcecDate",
  "postTcecMinutesDate",
  "postTcecCommitteeNumber",
  "cncDate",
  "cncApprovalDate",
];

const gemDisabledKeys: FieldKey[] = ["gemUndertakingDate", "gemSoNo"];
const rfpVettingDisabledKeys: FieldKey[] = ["rfpVettingInitiationDate", "rfpVettingApprovalDate"];
const highValueDisabledKeys: FieldKey[] = ["highValueMeetingDate", "highValueMinutesDate"];
const rqaDisabledKeys: FieldKey[] = ["rqaApprovalDate"];
const ifaDisabledKeys: FieldKey[] = ["ifaSentDate", "ifaFinalDate"];
const bgDisabledKeys: FieldKey[] = ["bgValidityDate", "bgReturnDate"];
const refloatDisabledKeys: FieldKey[] = ["refloatBiddingDate", "refloatBidOpeningDate"];
const supplyOrderBgDisabledKeys: SupplyOrderKey[] = ["bgValidityDate", "bgReturnDate"];
const supplyOrderIrDisabledKeys: SupplyOrderKey[] = ["irPreparationDate", "irReceiptDate"];
const tcecCommitteeKeys: FieldKey[] = ["preTcecCommitteeNo", "postTcecCommitteeNumber"];

const yesNo = ["Yes", "No"];
const yesNoCaps = ["YES", "NO"];
const defaultFirmTypes = ["MSE", "MSE (Women)", "Non-MSE"];
const defaultFileTypeOptions = ["Goods & Services", "AMC", "MPC", "CARS", "O&M"];
const defaultModeOptions = ["OBM", "PBM", "SBM", "LBM", "LPC"];
const paymentModeOptions = ["Online", "Offline"];
type FirmDetailsState = {
  invitedFirms: FirmDetail[];
  bidderFirms: FirmDetail[];
};

const emptyFirmDetail: Required<FirmDetail> = { firmName: "", city: "", emailId: "" };
const emptySupplyOrder: Required<SupplyOrderDetail> = {
  currentMilestone: "",
  completedMilestones: [],
  financialSanctionDate: "",
  soNo: "",
  gemSoNo: "",
  soDate: "",
  soValueCapital: "",
  soValueRevenue: "",
  dpDate: "",
  firm: "",
  firmType: "",
  firmTypeOther: "",
  bgValidityDate: "",
  dpExtension: "No",
  dpExtensionCount: "",
  ld: "No",
  ldType: "",
  ldPercentage: "",
  revisedDp: "",
  materialReceiptDate: "",
  irPreparationDate: "",
  irReceiptDate: "",
  billPreparationDate: "",
  billSentForPaymentDate: "",
  paymentDate: "",
  paymentMode: "",
  actualPaymentCapital: "",
  actualPaymentRevenue: "",
  bgReturnDate: "",
  demandCancelled: "No",
  soCancelled: "No",
  soCancelledDate: "",
  stageDelivery: "No",
  stageDeliveryCount: "",
  deliveryPeriodStartDate: "",
  stageDeliveryLabel: "",
  stagePayment: "No",
  advancePayment: "No",
  advancePaymentDetail: {},
  stageDeliveries: [],
};

const emptyAdvancePayment: Required<AdvancePaymentDetail> = {
  currentMilestone: "",
  completedMilestones: [],
  stageAmountCapital: "",
  stageAmountRevenue: "",
  billPreparationDate: "",
  billSentForPaymentDate: "",
  paymentDate: "",
  paymentMode: "",
  actualPaymentCapital: "",
  actualPaymentRevenue: "",
};

const emptyStageDelivery: Required<StageDeliveryDetail> = {
  stageAmountCapital: "",
  stageAmountRevenue: "",
  currentMilestone: "",
  completedMilestones: [],
  deliveryPeriodStartDate: "",
  dpDate: "",
  dpExtension: "No",
  dpExtensionCount: "",
  ld: "No",
  revisedDp: "",
  materialReceiptDate: "",
  irPreparationDate: "",
  irReceiptDate: "",
  billPreparationDate: "",
  billSentForPaymentDate: "",
  paymentDate: "",
  paymentMode: "",
  actualPaymentCapital: "",
  actualPaymentRevenue: "",
};

const supplyOrderFields: ExtraField<SupplyOrderKey>[] = [
  { key: "financialSanctionDate", label: "Financial Sanction", type: "date" },
  { key: "soNo", label: "S.O. No." },
  { key: "gemSoNo", label: "GeM S.O. NO." },
  { key: "soDate", label: "S.O. date", type: "date" },
  { key: "soValueCapital", label: "S.O. value" },
  { key: "dpDate", label: "D.P. date", type: "date" },
  { key: "firm", label: "Firm" },
  { key: "firmType", label: "Firm type" },
  { key: "bgValidityDate", label: "BG validity date", type: "date" },
  { key: "dpExtension", label: "DP extension (Yes/No)", options: yesNo },
  { key: "dpExtensionCount", label: "Extension count", type: "number" },
  { key: "ld", label: "LD", options: yesNo },
  { key: "revisedDp", label: "Revised D.P.", type: "date" },
  { key: "materialReceiptDate", label: "Material receipt date", type: "date" },
  { key: "irPreparationDate", label: "IR Preparation", type: "date" },
  { key: "irReceiptDate", label: "IR Receipt", type: "date" },
  { key: "billPreparationDate", label: "Bill preparation", type: "date" },
  { key: "billSentForPaymentDate", label: "Bill sent for payment", type: "date" },
  { key: "paymentDate", label: "Payment Date", type: "date" },
  { key: "paymentMode", label: "Payment mode(Online/Offline)", options: paymentModeOptions },
  { key: "actualPaymentCapital", label: "Actual payment amount" },
  { key: "bgReturnDate", label: "BG return date", type: "date" },
  { key: "soCancelled", label: "S.O. cancelled (Yes/No)", options: yesNo },
  { key: "soCancelledDate", label: "S.O. cancelled date", type: "date" },
  { key: "stageDelivery", label: "Stage Delivery", control: "radio", options: yesNo },
  { key: "stageDeliveryCount", label: "No. of stage deliveries", type: "number" },
  { key: "stagePayment", label: "Stage payment", control: "radio", options: yesNo },
  { key: "advancePayment", label: "Advance Payment", control: "radio", options: yesNo },
];

const stageDeliveryFields: ExtraField<StageDeliveryKey>[] = [
  { key: "stageAmountCapital", label: "Stage amount" },
  { key: "deliveryPeriodStartDate", label: "Period start date", type: "date" },
  { key: "dpDate", label: "D.P. date", type: "date" },
  { key: "dpExtension", label: "DP extension (Yes/No)", options: yesNo },
  { key: "dpExtensionCount", label: "Extension count", type: "number" },
  { key: "ld", label: "LD", options: yesNo },
  { key: "revisedDp", label: "Revised D.P.", type: "date" },
  { key: "materialReceiptDate", label: "Material receipt date", type: "date" },
  { key: "irPreparationDate", label: "IR Preparation", type: "date" },
  { key: "irReceiptDate", label: "IR Receipt", type: "date" },
  { key: "billPreparationDate", label: "Bill preparation", type: "date" },
  { key: "billSentForPaymentDate", label: "Bill sent for payment", type: "date" },
  { key: "paymentDate", label: "Payment Date", type: "date" },
  { key: "paymentMode", label: "Payment mode(Online/Offline)", options: paymentModeOptions },
  { key: "actualPaymentCapital", label: "Actual payment amount" },
];

const advancePaymentFields: ExtraField<AdvancePaymentKey>[] = [
  { key: "stageAmountCapital", label: "Advance amount" },
  { key: "billPreparationDate", label: "Bill preparation", type: "date" },
  { key: "billSentForPaymentDate", label: "Bill sent for payment", type: "date" },
  { key: "paymentDate", label: "Payment Date", type: "date" },
  { key: "paymentMode", label: "Payment mode(Online/Offline)", options: paymentModeOptions },
  { key: "actualPaymentCapital", label: "Actual payment amount" },
];

const supplyOrderSubviewFields = {
  supplyOrder: [
    "financialSanctionDate",
    "soNo",
    "gemSoNo",
    "soDate",
    "soValueCapital",
    "firm",
    "firmType",
    "firmTypeOther",
    "stageDelivery",
    "stageDeliveryCount",
    "stagePayment",
    "advancePayment",
  ],
  bg: ["bgValidityDate", "bgReturnDate"],
  dp: ["dpDate", "dpExtension", "dpExtensionCount", "ld", "revisedDp"],
  delivery: ["materialReceiptDate", "irPreparationDate", "irReceiptDate"],
  payment: [
    "billPreparationDate",
    "billSentForPaymentDate",
    "paymentDate",
    "paymentMode",
    "actualPaymentCapital",
  ],
  miscellaneous: ["soCancelled", "soCancelledDate"],
} satisfies Record<string, SupplyOrderKey[]>;

const supplyOrderSubviewTabs = [
  { key: "supplyOrder", label: "Supply order" },
  { key: "bg", label: "BG" },
  { key: "dp", label: "D.P." },
  { key: "delivery", label: "Delivery & Inspection" },
  { key: "payment", label: "Payment" },
  { key: "miscellaneous", label: "Miscellaneous" },
] as const;

const supplyOrderFieldPrerequisites = {
  soNo: ["financialSanctionDate"],
  gemSoNo: ["soNo"],
  soDate: ["soNo"],
  soValueCapital: ["soDate"],
  firm: ["soDate"],
  firmType: ["firm"],
  firmTypeOther: ["firmType"],
  stageDelivery: ["firm"],
  stageDeliveryCount: ["stageDelivery"],
  stagePayment: ["stageDelivery"],
  advancePayment: ["stagePayment"],
  bgValidityDate: ["soDate"],
  bgReturnDate: ["bgValidityDate"],
  dpDate: ["soDate"],
  dpExtension: ["dpDate"],
  dpExtensionCount: ["dpExtension"],
  ld: ["dpDate"],
  revisedDp: ["dpDate"],
  materialReceiptDate: ["dpDate"],
  irPreparationDate: ["materialReceiptDate"],
  irReceiptDate: ["irPreparationDate"],
  billPreparationDate: ["materialReceiptDate"],
  billSentForPaymentDate: ["billPreparationDate"],
  paymentDate: ["billSentForPaymentDate"],
  paymentMode: ["paymentDate"],
  actualPaymentCapital: ["paymentDate"],
  soCancelled: ["soDate"],
  soCancelledDate: ["soCancelled"],
} satisfies Partial<Record<SupplyOrderKey, SupplyOrderKey[]>>;

type SupplyOrderSubviewKey = (typeof supplyOrderSubviewTabs)[number]["key"];

const supplyOrderSubviewMilestones = {
  supplyOrder: ["Financial Sanction", "Supply Order"],
  bg: ["Bank Guarantee"],
  dp: [],
  delivery: ["Delivery", "IR Preparation", "IR Receipt"],
  payment: ["Bill preparation", "Bill sent for payment", "Payment"],
  miscellaneous: [],
} as const satisfies Record<SupplyOrderSubviewKey, readonly SupplyOrderMilestoneName[]>;

const stagedDeliverySubviewFields = {
  dp: ["stageAmountCapital", "deliveryPeriodStartDate", ...supplyOrderSubviewFields.dp],
  delivery: supplyOrderSubviewFields.delivery,
  payment: ["stageAmountCapital", ...supplyOrderSubviewFields.payment],
} satisfies Partial<Record<SupplyOrderSubviewKey, StageDeliveryKey[]>>;

type StagedDeliverySubviewKey = keyof typeof stagedDeliverySubviewFields;

function getStagedDeliverySubviewFields(activeSubview: SupplyOrderSubviewKey) {
  return activeSubview in stagedDeliverySubviewFields
    ? stagedDeliverySubviewFields[activeSubview as StagedDeliverySubviewKey]
    : undefined;
}

const extraSections: { title: string; fields: ExtraField[] }[] = [
  {
    title: "File details",
    fields: [
      { key: "uniqueCode", label: "Unique code" },
      { key: "division", label: "Division" },
      { key: "indentor", label: "Indentor" },
      { key: "demandDescription", label: "Description", type: "textarea" },
      { key: "valueCapital", label: "Value" },
      { key: "currency", label: "Currency" },
      { key: "exchangeRate", label: "Exchange rate", type: "number" },
      { key: "gte", label: "GTE", options: yesNo },
      { key: "receivedDate", label: "Received date", type: "date" },
      { key: "fileType", label: "File Type", options: defaultFileTypeOptions },
      { key: "mode", label: "Mode", options: defaultModeOptions },
      { key: "tcec", label: "TCEC (Yes/No)", options: yesNoCaps },
      { key: "gem", label: "GeM (Yes/No)", options: yesNo },
      { key: "highValue", label: "High value (Yes/No)", options: yesNo },
      { key: "ad", label: "AD (Yes/No)", options: yesNo },
      { key: "rqa", label: "R&QA (Yes/No)", options: yesNo },
      { key: "ifa", label: "IFA (Yes/No)", options: yesNo },
      { key: "psb", label: "PSB (Yes/No)", options: yesNo },
      { key: "bg", label: "BG (Yes/No)", options: yesNo },
      { key: "ir", label: "IR (Yes/No)", options: yesNo },
      { key: "rfpVetting", label: "RFP vetting", options: yesNo },
      { key: "demandCancelled", label: "Demand cancelled (Yes/No)", options: yesNo },
      { key: "demandCancelledDate", label: "Demand cancelled date", type: "date" },
    ],
  },
  {
    title: "Scrutiny and control",
    fields: [
      { key: "scrutinyDate", label: "Scrutiny date", type: "date" },
      { key: "scrutinyResponseDate", label: "Scrutiny response", type: "date" },
      { key: "scrutinyCompletionDate", label: "Scrutiny completion date", type: "date" },
      { key: "imms", label: "Control number" },
      { key: "immsDate", label: "Control date", type: "date" },
      { key: "fileNo", label: "File Number" },
    ],
  },
  {
    title: "TCEC block",
    fields: [
      { key: "preTcecCommitteeNo", label: "Pre-TCEC committee" },
      { key: "preTcecDate", label: "Pre-TCEC Date", type: "date" },
      { key: "preTcecMinutesDate", label: "Pre-TCEC minutes date", type: "date" },
      { key: "postTcecCommitteeNumber", label: "Post-TCEC committee" },
      { key: "postTcecDate", label: "Post-TCEC date", type: "date" },
      { key: "postTcecMinutesDate", label: "Post-TCEC minutes date", type: "date" },
    ],
  },
  {
    title: "Approval block",
    fields: [
      { key: "highValueMeetingDate", label: "High value meeting date", type: "date" },
      { key: "highValueMinutesDate", label: "High value minutes date", type: "date" },
      { key: "adVettingDate", label: "AD Vetting date", type: "date" },
      { key: "rqaApprovalDate", label: "R&QA approval date", type: "date" },
      { key: "ifaSentDate", label: "IFA sent date", type: "date" },
      { key: "ifaFinalDate", label: "IFA final date", type: "date" },
      { key: "cfaSentDate", label: "CFA sent date", type: "date" },
      { key: "cfaDate", label: "CFA approval date", type: "date" },
      { key: "cncDate", label: "CNC date", type: "date" },
      { key: "cncApprovalDate", label: "CNC approval date", type: "date" },
    ],
  },
  {
    title: "Bidding details",
    fields: [
      { key: "gemUndertakingDate", label: "GeM undertaking date", type: "date" },
      { key: "rfpVettingInitiationDate", label: "RFP vetting initiation", type: "date" },
      { key: "rfpVettingApprovalDate", label: "RFP vetting approval", type: "date" },
      { key: "bidNumber", label: "Bid number" },
      { key: "bidDate", label: "Bid date", type: "date" },
      { key: "bidOpeningDate", label: "Bid closing", type: "date" },
      { key: "tenderLive", label: "Tender live", options: yesNo },
      { key: "bidOpened", label: "Bid opened", options: yesNoCaps },
      { key: "refloat", label: "Refloat (Yes/No)", options: yesNo },
      { key: "refloatBiddingDate", label: "Refloat bidding date", type: "date" },
      { key: "refloatBidOpeningDate", label: "Refloat bid closing date", type: "date" },
      { key: "rst", label: "RST (Yes/No)", options: yesNo },
      { key: "biddingStageOver", label: "Bidding stage over", options: yesNo },
    ],
  },
  {
    title: "Supply order and payment",
    fields: [{ key: "noOfSo", label: "No. of S.O.", type: "number" }],
  },
  {
    title: "Firm details",
    fields: [],
  },
  {
    title: "File Markers",
    fields: [],
  },
];

const timelineFields = extraSections
  .flatMap((section) => section.fields)
  .filter((field) => field.type === "date")
  .map((field) => ({ key: field.key, label: field.label }));

type TimelineItem = {
  id: string;
  label: string;
  date: string;
  order: number;
};

type TimelineGroup = {
  title: string;
  items: TimelineItem[];
};

function AddFilePage() {
  const activeUser = useActiveUser();
  const { fileId } = Route.useSearch();
  const canEditFiles =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    activeUser?.role === "editor";
  const canViewExistingFile = activeUser?.role === "viewer" && Boolean(fileId);
  if (!canEditFiles && !canViewExistingFile) {
    return (
      <div className="max-w-xl rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <h1 className="text-sm font-semibold">File editing unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your account can view records only.</p>
      </div>
    );
  }

  return <AddFileEditor readOnlyMode={!canEditFiles} />;
}

function AddFileEditor({ readOnlyMode = false }: { readOnlyMode?: boolean }) {
  const divisions = useAccessibleDivisions();
  const files = useFiles();
  const messages = useMessages();
  const activeUser = useActiveUser();
  const settings = useSettings();
  const effectiveFinancialYear = isAllActiveFilesYear(settings.selectedYear)
    ? settings.financialYear
    : settings.selectedYear || settings.financialYear;
  const { fileId, section, milestone, focusTarget, quickFocus } = Route.useSearch();
  const navigate = useNavigate();
  const [loadedFile, setLoadedFile] = useState<FileRecord | undefined>();
  const [fileLoadStatus, setFileLoadStatus] = useState<"idle" | "loading" | "loaded" | "error">(
    fileId ? "loading" : "idle",
  );
  const [serverUniqueCode, setServerUniqueCode] = useState("");
  const editingFile = loadedFile;
  const isEditing = Boolean(fileId && editingFile);
  const [form, setForm] = useState(() =>
    applyConditionalRules(
      editingFile
        ? createFormFromFile(editingFile, effectiveFinancialYear)
        : createEmptyForm(effectiveFinancialYear),
    ),
  );
  const [firmDetails, setFirmDetails] = useState<FirmDetailsState>(() =>
    createFirmDetailsFromFile(editingFile),
  );
  const [supplyOrders, setSupplyOrders] = useState<SupplyOrderDetail[]>(() =>
    createSupplyOrdersFromFile(editingFile),
  );
  const demandCancellationHasPlacedSupplyOrder = hasPlacedSupplyOrderRows(supplyOrders);
  const [fileRemarks, setFileRemarks] = useState<FileRemark[]>(() =>
    createRemarksFromFile(editingFile),
  );
  const [fileMarkers, setFileMarkers] = useState<FileMarker[]>(() =>
    createMarkersFromFile(editingFile),
  );
  const [currentMilestone, setCurrentMilestone] = useState(editingFile?.currentMilestone ?? "");
  const [completedMilestones, setCompletedMilestones] = useState<string[]>(() =>
    normalizeCompletedMilestones(editingFile?.completedMilestones),
  );
  const [activeYears, setActiveYears] = useState<string[]>(() =>
    normalizeSelectableActiveYears(
      normalizeActiveYears(editingFile, effectiveFinancialYear),
      getLatestTwoYears(effectiveFinancialYear, settings.financialYears),
      effectiveFinancialYear,
      settings.yearSelectionLocked,
    ),
  );
  const [saved, setSaved] = useState(false);
  const [unlockedSections, setUnlockedSections] = useState<Set<string>>(() => new Set());
  const [demandCancelledUnlocked, setDemandCancelledUnlocked] = useState(false);
  const [activeBoardSection, setActiveBoardSection] = useState(section ?? "File details");
  const [focusedMilestone, setFocusedMilestone] = useState(milestone ?? "");
  const quickFieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const quickFocusAppliedRef = useRef("");
  const skipMilestonePruneRef = useRef(false);
  const divisionsRef = useRef(divisions);
  const filesRef = useRef(files);
  divisionsRef.current = divisions;
  filesRef.current = files;
  const selectedDivision = divisions.find(
    (division) => division.name.trim().toLowerCase() === form.division.trim().toLowerCase(),
  );
  const selectedDivisionName = form.division.trim();
  const selectedDivisionId = selectedDivision?.id ?? "";
  const uniqueCodeFinancialYear = activeYears[0] || effectiveFinancialYear;
  useEffect(() => {
    if (!fileId) {
      setLoadedFile(undefined);
      setFileLoadStatus("idle");
      setDemandCancelledUnlocked(false);
      return;
    }

    let cancelled = false;
    setFileLoadStatus("loading");
    fetchFile(fileId)
      .then(({ file }) => {
        if (cancelled) return;
        setLoadedFile(file);
        setFileLoadStatus("loaded");
        setDemandCancelledUnlocked(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setLoadedFile(undefined);
        setFileLoadStatus("error");
        setDemandCancelledUnlocked(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fileId]);
  const unlockDemandCancelled = async () => {
    if (readOnlyMode || demandCancelledUnlocked) return;
    const allowed = await requestDeletionPassword("unlock Demand cancelled");
    if (allowed) setDemandCancelledUnlocked(true);
  };
  const savedFormForLocks = useMemo(
    () =>
      editingFile
        ? applyConditionalRules(createFormFromFile(editingFile, effectiveFinancialYear))
        : createEmptyForm(effectiveFinancialYear),
    [editingFile, effectiveFinancialYear],
  );
  const savedFirmDetailsForLocks = useMemo(
    () => createFirmDetailsFromFile(editingFile),
    [editingFile],
  );
  const savedSupplyOrdersForLocks = useMemo(
    () => createSupplyOrdersFromFile(editingFile),
    [editingFile],
  );
  const savedCompletedMilestonesForLocks = useMemo(
    () => normalizeCompletedMilestones(editingFile?.completedMilestones),
    [editingFile?.completedMilestones],
  );

  useEffect(() => {
    skipMilestonePruneRef.current = true;
    setForm(
      applyConditionalRules(
        editingFile
          ? createFormFromFile(editingFile, effectiveFinancialYear)
          : createEmptyForm(effectiveFinancialYear),
      ),
    );
    setFirmDetails(createFirmDetailsFromFile(editingFile));
    setSupplyOrders(createSupplyOrdersFromFile(editingFile));
    setFileRemarks(createRemarksFromFile(editingFile));
    setFileMarkers(createMarkersFromFile(editingFile));
    setCurrentMilestone(editingFile?.currentMilestone ?? "");
    setCompletedMilestones(normalizeCompletedMilestones(editingFile?.completedMilestones));
    setActiveYears(
      normalizeSelectableActiveYears(
        normalizeActiveYears(editingFile, effectiveFinancialYear),
        getLatestTwoYears(effectiveFinancialYear, settings.financialYears),
        effectiveFinancialYear,
        settings.yearSelectionLocked,
      ),
    );
    setUnlockedSections(new Set());
    setDemandCancelledUnlocked(false);
    // The file object is re-read from localStorage on each render; reset only when the edited id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editingFile?.id,
    effectiveFinancialYear,
    settings.yearSelectionLocked,
  ]);

  useEffect(() => {
    setActiveBoardSection(section ?? "File details");
    setFocusedMilestone(milestone ?? "");
  }, [section, milestone, editingFile?.id]);

  useEffect(() => {
    if (isEditing) return;
    if (!uniqueCodeFinancialYear || !selectedDivisionName) {
      setServerUniqueCode("");
      return;
    }

    let cancelled = false;
    const fallbackUniqueCode = () =>
      generateUniqueCode(
        uniqueCodeFinancialYear,
        selectedDivisionName,
        divisionsRef.current,
        filesRef.current,
      );
    fetchNextUniqueCode({
      financialYear: uniqueCodeFinancialYear,
      division: selectedDivisionName,
      divisionId: selectedDivisionId || undefined,
    })
      .then(({ uniqueCode }) => {
        if (!cancelled) {
          setServerUniqueCode(uniqueCode || fallbackUniqueCode());
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setServerUniqueCode(fallbackUniqueCode());
      });
    return () => {
      cancelled = true;
    };
  }, [isEditing, selectedDivisionId, selectedDivisionName, uniqueCodeFinancialYear]);

  const generatedUniqueCode = isEditing ? form.uniqueCode : serverUniqueCode;
  const originYear = isEditing
    ? form.year || editingFile?.year || effectiveFinancialYear
    : activeYears[0] || effectiveFinancialYear;
  const formWithLockedYear = useMemo(
    () => ({
      ...form,
      year: originYear,
      uniqueCode: generatedUniqueCode,
    }),
    [form, generatedUniqueCode, originYear],
  );
  const activeYearOptions = useMemo(
    () => getLatestTwoYears(effectiveFinancialYear, settings.financialYears),
    [effectiveFinancialYear, settings.financialYears],
  );
  const [indentorOptions, setIndentorOptions] = useState<string[]>([]);
  useEffect(() => {
    if (!selectedDivision) {
      setIndentorOptions([]);
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      fetchIndentors({
        divisionId: selectedDivision.id,
        q: formWithLockedYear.indentor,
        page: 1,
        pageSize: 50,
      })
        .then((result) => {
          if (!controller.signal.aborted) {
            setIndentorOptions(result.indentors.map((indentor) => indentor.name));
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            console.error(error);
            setIndentorOptions([]);
          }
        });
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [selectedDivision, formWithLockedYear.indentor]);
  const tcecIsNo = isNo(formWithLockedYear.tcec);
  const gemIsNo = isNo(formWithLockedYear.gem);
  const highValueIsNo = isNo(formWithLockedYear.highValue);
  const rqaIsNo = isNo(formWithLockedYear.rqa);
  const ifaIsNo = isNo(formWithLockedYear.ifa);
  const bgIsNo = isNo(formWithLockedYear.bg);
  const deliveryInspectionInactive = isDeliveryInspectionInactive(formWithLockedYear);
  const irIsNo = isNo(formWithLockedYear.ir);
  const rfpVettingIsNo = isNo(formWithLockedYear.rfpVetting);
  const refloatIsNo = isNo(formWithLockedYear.refloat);
  const adVettingDisabled = isDivisionAdNo(formWithLockedYear.division, divisions);
  const milestoneOptions = useMemo(
    () => getConfiguredMilestones(settings.milestones),
    [settings.milestones],
  );
  const applicableMilestones = getApplicableMilestones(
    milestoneOptions,
    formWithLockedYear,
    supplyOrders,
    divisions,
  );
  const supplyOrderMilestoneProgress = useMemo(
    () => getSupplyOrderMilestoneProgress(milestoneOptions, supplyOrders, formWithLockedYear),
    [formWithLockedYear, milestoneOptions, supplyOrders],
  );
  const inactiveMainMilestones = useMemo(() => new Set<string>(), []);
  useEffect(() => {
    if (!inactiveMainMilestones.size) return;
    const inactiveKeys = new Set(Array.from(inactiveMainMilestones).map(normalizeMilestoneName));
    setCurrentMilestone((current) =>
      inactiveKeys.has(normalizeMilestoneName(current)) ? "" : current,
    );
    setCompletedMilestones((current) => {
      const next = current.filter(
        (milestone) => !inactiveKeys.has(normalizeMilestoneName(milestone)),
      );
      return next.length === current.length ? current : next;
    });
  }, [inactiveMainMilestones]);
  const firmTypeOptions = useMemo(
    () => getConfiguredFirmTypes(settings.firmTypes),
    [settings.firmTypes],
  );
  const configuredModeOptions = useMemo(
    () =>
      filterModeOptionsForUser(
        getConfiguredModes(settings.modes, formWithLockedYear.mode),
        activeUser?.allowedFileCategories,
      ),
    [activeUser?.allowedFileCategories, formWithLockedYear.mode, settings.modes],
  );
  const configuredFileTypeOptions = useMemo(
    () =>
      filterFileTypeOptionsForUser(
        getConfiguredFileTypes(settings.fileTypes, formWithLockedYear.fileType),
        activeUser?.allowedFileCategories,
      ),
    [activeUser?.allowedFileCategories, formWithLockedYear.fileType, settings.fileTypes],
  );

  useEffect(() => {
    setActiveYears((current) => {
      const next = normalizeSelectableActiveYears(
        current,
        activeYearOptions,
        effectiveFinancialYear,
        settings.yearSelectionLocked,
      );
      if (next.length === current.length && next.every((year, index) => year === current[index])) {
        return current;
      }
      return next;
    });
  }, [activeYearOptions, effectiveFinancialYear, settings.yearSelectionLocked]);

  useEffect(() => {
    if (skipMilestonePruneRef.current) {
      skipMilestonePruneRef.current = false;
      return;
    }
    setCurrentMilestone((current) =>
      current && !applicableMilestones.has(current) ? "" : current,
    );
    setCompletedMilestones((current) => {
      const next = current.filter((item) => milestoneOptions.includes(item));
      return next.length === current.length ? current : next;
    });
  }, [applicableMilestones, milestoneOptions]);

  const activeSection = extraSections.find((section) => section.title === activeBoardSection);
  const activeSectionIndex = extraSections.findIndex(
    (section) => section.title === activeBoardSection,
  );
  const activeSectionMessages =
    editingFile && activeSection
      ? messages.filter(
          (message) => message.fileId === editingFile.id && message.section === activeSection.title,
        )
      : [];
  useEffect(() => {
    if (!quickFocus || !editingFile || !activeSection) return;
    if (!unlockedSections.has(activeSection.title)) return;

    const focusKey = `${editingFile.id}:${activeSection.title}`;
    if (quickFocusAppliedRef.current === focusKey) return;

    window.setTimeout(() => {
      const firstUnfilledField = getUnfilledFieldKeys(
        activeSection,
        formWithLockedYear,
        divisions,
      ).find((fieldKey) => {
        const element = quickFieldRefs.current[fieldKey];
        return element && !("disabled" in element && element.disabled);
      });
      const target = firstUnfilledField ? quickFieldRefs.current[firstUnfilledField] : undefined;
      if (target) {
        quickFocusAppliedRef.current = focusKey;
        target.focus();
        if ("select" in target && typeof target.select === "function") target.select();
      }
    }, 100);
  }, [activeSection, divisions, editingFile, formWithLockedYear, quickFocus, unlockedSections]);

  const reduceSupplyOrderCountWithPassword = async (count: number) => {
    const currentCount = supplyOrders.length;
    if (count >= currentCount) return false;
    const removedOrders = supplyOrders.slice(count);
    const removedLabels = removedOrders
      .map((order, index) => getSupplyOrderDisplayTitle(order, count + index))
      .join(", ");
    const confirmed = window.confirm(
      [
        `Reducing S.O. count from ${currentCount} to ${count} will permanently delete ${
          currentCount - count
        } supply order(s).`,
        removedLabels ? `Deleted supply order(s): ${removedLabels}` : "",
        "All related BG, D.P., delivery, stage, payment, milestone, and cancellation data for the deleted supply order(s) will be erased when you save/update this file.",
        "",
        "Do you want to continue?",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (!confirmed) {
      setForm((f) => ({ ...f, noOfSo: String(currentCount) }));
      return true;
    }

    const allowed = await requestDeletionPassword(
      `reduce S.O. count from ${currentCount} to ${count}`,
    );
    if (!allowed) {
      setForm((f) => ({ ...f, noOfSo: String(currentCount) }));
      return true;
    }

    setForm((f) => ({ ...f, noOfSo: String(count) }));
    setSupplyOrders((current) => current.slice(0, count));
    return true;
  };

  const update = (k: keyof typeof form, v: string) => {
    if (readOnlyMode) return;
    if (k === "year") return;
    if (k === "demandCancelled" && isYes(v) && hasPlacedSupplyOrderRows(supplyOrders)) {
      alert(
        "Demand can be cancelled only before any Supply Order is placed. Use S.O. cancelled for placed Supply Orders.",
      );
      return;
    }
    if (k === "noOfSo") {
      const count = clampSupplyOrderCount(v);
      if (count < supplyOrders.length) {
        void reduceSupplyOrderCountWithPassword(count);
        return;
      }
      setForm((f) => ({ ...f, noOfSo: String(count) }));
      setSupplyOrders((current) => resizeSupplyOrders(current, count));
      return;
    }
    if (k === "gem") {
      setSupplyOrders((current) =>
        current.map((order) =>
          isNo(v)
            ? { ...order, gemSoNo: "", paymentMode: "" }
            : { ...order, paymentMode: order.paymentMode || "Online" },
        ),
      );
    }
    if (k === "bg" && isNo(v)) {
      setSupplyOrders((current) =>
        current.map((order) => ({ ...order, bgValidityDate: "", bgReturnDate: "" })),
      );
    }
    if (k === "ir" && isNo(v)) {
      setSupplyOrders((current) =>
        current.map((order) => ({ ...order, irPreparationDate: "", irReceiptDate: "" })),
      );
    }
    if (k === "fileType") {
      if (isDeliveryInspectionInactive({ ...formWithLockedYear, fileType: v })) {
        setForm((f) => ({ ...f, ir: "No" }));
      }
      setSupplyOrders((current) =>
        current.map((order) =>
          applySupplyOrderRules(order, { ...formWithLockedYear, fileType: v }),
        ),
      );
    }
    if (k === "biddingStageOver" && isYes(v)) {
      const currentIsBidding = normalizeMilestoneName(currentMilestone) === "bidding";
      const currentNeedsSelection = !currentMilestone || currentIsBidding;
      if (currentIsBidding) {
        setCurrentMilestone("");
      }
      if (currentNeedsSelection) {
        setActiveBoardSection("Milestones");
        setFocusedMilestone("");
        window.setTimeout(() => {
          alert(
            "Bidding is now marked completed. Please select the next current status in Milestones.",
          );
        }, 100);
      }
    }
    setForm((f) => {
      const patch: Partial<FormState> = { [k]: v };
      if (k === "currency" && isInr(v)) {
        patch.exchangeRate = "1";
      }
      if (k === "gem" && isYes(v)) {
        patch.paymentMode = "Online";
      }
      if (k === "division") {
        if (f.division.trim().toLowerCase() !== v.trim().toLowerCase()) {
          patch.indentor = "";
        }
      }
      const next = applyConditionalRules({ ...f, ...patch });
      return isDivisionAdNo(next.division, divisions) ? { ...next, adVettingDate: "" } : next;
    });
  };
  const updateSupplyOrder = (index: number, key: SupplyOrderKey, value: string) => {
    if (readOnlyMode) return;
    let autofilled = false;
    setSupplyOrders((current) =>
      current.map((order, orderIndex) => {
        if (orderIndex !== index) return order;
        const patchedOrder = applySupplyOrderRules(
          getSupplyOrderPatch(order, key, value),
          formWithLockedYear,
        );
        const shouldTryAutofill = shouldAutoFillStageDeliveryOnChange(key, patchedOrder);
        if (!shouldTryAutofill) return patchedOrder;
        if (hasExistingStageAutofillValues(patchedOrder)) {
          const confirmed = window.confirm(
            "Stage delivery dates/amounts already exist. Do you want to auto-fill them again based on S.O. date, S.O. value, and number of stages?",
          );
          if (!confirmed) return patchedOrder;
        }
        const result = autoFillStageDeliveries(patchedOrder, formWithLockedYear);
        autofilled = result.changed;
        return result.order;
      }),
    );
    if (autofilled) {
      window.setTimeout(() => {
        alert(
          "Stage delivery dates and stage amounts have been auto-filled based on S.O. date, S.O. value, and number of stages. Please check and edit fields if required.",
        );
      }, 100);
    }
  };
  const updateSupplyOrderCurrentMilestone = (index: number, milestone: string) => {
    if (readOnlyMode) return;
    setSupplyOrders((current) =>
      current.map((order, orderIndex) => {
        if (orderIndex !== index) return order;
        const currentMilestone = order.currentMilestone === milestone ? "" : milestone;
        return applySupplyOrderRules({ ...order, currentMilestone }, formWithLockedYear);
      }),
    );
  };
  const updateSupplyOrderCompletedMilestones = (index: number, milestones: string[]) => {
    if (readOnlyMode) return;
    setSupplyOrders((current) =>
      current.map((order, orderIndex) =>
        orderIndex === index
          ? applySupplyOrderRules({ ...order, completedMilestones: milestones }, formWithLockedYear)
          : order,
      ),
    );
  };
  const updateStageDeliveryCurrentMilestone = (
    orderIndex: number,
    stageIndex: number,
    milestone: string,
  ) => {
    if (readOnlyMode) return;
    setSupplyOrders((current) =>
      current.map((order, index) => {
        if (index !== orderIndex) return order;
        const stageDeliveries = resizeStageDeliveries(
          order.stageDeliveries ?? [],
          getStageDeliveryCount(order.stageDeliveryCount),
        );
        const nextStageDeliveries = stageDeliveries.map((stage, itemIndex) => {
          if (itemIndex !== stageIndex) return stage;
          const currentMilestone = stage.currentMilestone === milestone ? "" : milestone;
          return applyStageDeliveryRules({ ...stage, currentMilestone }, formWithLockedYear);
        });
        return applySupplyOrderRules(
          { ...order, stageDeliveries: nextStageDeliveries },
          formWithLockedYear,
        );
      }),
    );
  };
  const updateStageDeliveryCompletedMilestones = (
    orderIndex: number,
    stageIndex: number,
    milestones: string[],
  ) => {
    if (readOnlyMode) return;
    setSupplyOrders((current) =>
      current.map((order, index) => {
        if (index !== orderIndex) return order;
        const stageDeliveries = resizeStageDeliveries(
          order.stageDeliveries ?? [],
          getStageDeliveryCount(order.stageDeliveryCount),
        );
        const nextStageDeliveries = stageDeliveries.map((stage, itemIndex) =>
          itemIndex === stageIndex
            ? applyStageDeliveryRules(
                { ...stage, completedMilestones: milestones },
                formWithLockedYear,
              )
            : stage,
        );
        return applySupplyOrderRules(
          { ...order, stageDeliveries: nextStageDeliveries },
          formWithLockedYear,
        );
      }),
    );
  };
  const updateStageDelivery = (
    orderIndex: number,
    stageIndex: number,
    key: StageDeliveryKey,
    value: string,
  ) => {
    if (readOnlyMode) return;
    setSupplyOrders((current) =>
      current.map((order, index) => {
        if (index !== orderIndex) return order;
        const stageDeliveries = resizeStageDeliveries(
          order.stageDeliveries ?? [],
          getStageDeliveryCount(order.stageDeliveryCount),
        );
        const stage = applyStageDeliveryRules(
          {
            ...stageDeliveries[stageIndex],
            [key]:
              key === "dpExtensionCount"
                ? formatIntegerInput(value)
                : key === "ldPercentage"
                  ? formatPercentageInput(value)
                : key === "stageAmountCapital" ||
                    key === "stageAmountRevenue" ||
                    key === "actualPaymentCapital" ||
                    key === "actualPaymentRevenue"
                  ? formatDecimalInput(value)
                  : value,
          },
          formWithLockedYear,
        );
        const nextStageDeliveries = stageDeliveries.map((item, itemIndex) =>
          itemIndex === stageIndex ? stage : item,
        );
        return applySupplyOrderRules(
          { ...order, stageDeliveries: nextStageDeliveries },
          formWithLockedYear,
        );
      }),
    );
  };
  const updateAdvancePayment = (orderIndex: number, key: AdvancePaymentKey, value: string) => {
    if (readOnlyMode) return;
    setSupplyOrders((current) =>
      current.map((order, index) => {
        if (index !== orderIndex) return order;
        const advancePaymentDetail = applyAdvancePaymentRules({
          ...emptyAdvancePayment,
          ...(order.advancePaymentDetail ?? {}),
          [key]:
            key === "stageAmountCapital" ||
            key === "stageAmountRevenue" ||
            key === "actualPaymentCapital" ||
            key === "actualPaymentRevenue"
              ? formatDecimalInput(value)
              : value,
        });
        return applySupplyOrderRules({ ...order, advancePaymentDetail }, formWithLockedYear);
      }),
    );
  };
  const updateAdvancePaymentMilestone = (
    orderIndex: number,
    patch: Pick<AdvancePaymentDetail, "currentMilestone" | "completedMilestones">,
  ) => {
    if (readOnlyMode) return;
    setSupplyOrders((current) =>
      current.map((order, index) => {
        if (index !== orderIndex) return order;
        const advancePaymentDetail = applyAdvancePaymentRules({
          ...emptyAdvancePayment,
          ...(order.advancePaymentDetail ?? {}),
          ...patch,
        });
        return applySupplyOrderRules({ ...order, advancePaymentDetail }, formWithLockedYear);
      }),
    );
  };
  const toggleSectionLock = (sectionTitle: string) => {
    if (readOnlyMode) return;
    setUnlockedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionTitle)) {
        next.delete(sectionTitle);
      } else {
        next.add(sectionTitle);
      }
      return next;
    });
  };
  const updateFirmDetail = (
    group: keyof FirmDetailsState,
    index: number,
    key: keyof FirmDetail,
    value: string,
  ) => {
    if (readOnlyMode) return;
    setFirmDetails((current) => ({
      ...current,
      [group]: current[group].map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row,
      ),
    }));
  };
  const addFirmDetail = (group: keyof FirmDetailsState) => {
    if (readOnlyMode) return;
    setFirmDetails((current) => ({
      ...current,
      [group]: [...current[group], { ...emptyFirmDetail }],
    }));
  };
  const deleteFirmDetail = (group: keyof FirmDetailsState, index: number) => {
    if (readOnlyMode) return;
    setFirmDetails((current) => ({
      ...current,
      [group]: current[group].filter((_, rowIndex) => rowIndex !== index),
    }));
  };
  const deleteSelectedFirmDetails = (group: keyof FirmDetailsState, indexes: number[]) => {
    if (readOnlyMode) return;
    const selected = new Set(indexes);
    setFirmDetails((current) => ({
      ...current,
      [group]: current[group].filter((_, rowIndex) => !selected.has(rowIndex)),
    }));
  };
  const addRemark = (sectionTitle: string) => {
    if (readOnlyMode) return;
    setFileRemarks((current) => [
      ...current,
      {
        id: createRemarkId(),
        section: sectionTitle,
        text: "",
        createdAt: formatLocalDate(new Date()),
      },
    ]);
  };
  const updateRemark = (remarkId: string, text: string) => {
    if (readOnlyMode) return;
    setFileRemarks((current) =>
      current.map((remark) => (remark.id === remarkId ? { ...remark, text } : remark)),
    );
  };
  const updateRemarkDate = (remarkId: string, date: string) => {
    if (readOnlyMode) return;
    setFileRemarks((current) =>
      current.map((remark) => (remark.id === remarkId ? { ...remark, createdAt: date } : remark)),
    );
  };
  const deleteRemark = (remarkId: string) => {
    if (readOnlyMode) return;
    setFileRemarks((current) => current.filter((remark) => remark.id !== remarkId));
  };
  const addMarker = () => {
    if (readOnlyMode) return;
    setFileMarkers((current) => [
      ...current,
      {
        id: createMarkerId(),
        text: "",
        createdAt: formatLocalDate(new Date()),
      },
    ]);
  };
  const updateMarker = (markerId: string, text: string) => {
    if (readOnlyMode) return;
    setFileMarkers((current) =>
      current.map((marker) => (marker.id === markerId ? { ...marker, text } : marker)),
    );
  };
  const deleteMarker = (markerId: string) => {
    if (readOnlyMode) return;
    setFileMarkers((current) => current.filter((marker) => marker.id !== markerId));
  };
  const firmDetailsLocked = isEditing && !unlockedSections.has("Firm details");
  const fileMarkersLocked = isEditing && !unlockedSections.has("File Markers");
  const supplyOrdersLocked = isEditing && !unlockedSections.has("Supply order and payment");
  const milestonesLocked = isEditing && !unlockedSections.has("Milestones");
  const renderSectionUnlockButton = (sectionTitle: string) => {
    if (!isEditing || readOnlyMode) return null;

    return (
      <span className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => toggleSectionLock(sectionTitle)}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-background text-xs font-medium text-foreground border border-border hover:bg-accent"
        >
          {unlockedSections.has(sectionTitle) ? (
            <>
              <Unlock className="size-3.5" /> Unlocked
            </>
          ) : (
            <>
              <Lock className="size-3.5" /> Edit block
            </>
          )}
        </button>
        <span className="text-[11px] font-normal text-black">
          Click Update to save, else data will be lost.
        </span>
      </span>
    );
  };
  const renderSectionFields = (section: (typeof extraSections)[number]) => (
    <div className="grid grid-cols-1 gap-4">
      {section.fields.map((field) => {
        const renderedField =
          field.key === "division"
            ? {
                ...field,
                options: divisions.map((division) => division.name),
                placeholder: "Type or select division",
                typeahead: true,
              }
            : field.key === "indentor"
              ? {
                  ...field,
                  options: indentorOptions,
                  placeholder: selectedDivision
                    ? "Type or select indentor"
                    : "Select division first",
                  typeahead: true,
                }
              : field.key === "fileType"
                ? {
                    ...field,
                    options: configuredFileTypeOptions,
                  }
                : field.key === "mode"
                  ? {
                      ...field,
                      options: configuredModeOptions,
                    }
                  : field.key === "demandCancelled" && demandCancellationHasPlacedSupplyOrder
                    ? {
                        ...field,
                        label: `${field.label} - disabled after S.O. placement`,
                      }
                  : tcecCommitteeKeys.includes(field.key)
                    ? {
                        ...field,
                        options: getTcecCommitteeOptions(
                          settings.tcecCommittees,
                          formWithLockedYear[field.key],
                        ),
                      }
                    : field;
        const lockFilledFields = isEditing && !unlockedSections.has(section.title);
        const fieldReadOnly = readOnlyMode;

        if (field.key === "valueCapital") {
          return (
            <ValueField
              key={field.key}
              capitalValue={formWithLockedYear.valueCapital}
              revenueValue={formWithLockedYear.valueRevenue}
              capitalSelected={formWithLockedYear.valueCapitalSelected === "Yes"}
              revenueSelected={formWithLockedYear.valueRevenueSelected === "Yes"}
              thresholdMatch={findValueThresholdMatch(
                settings.valueThresholdLevels,
                formWithLockedYear,
              )}
              disabled={fieldReadOnly}
              lockFilledFields={lockFilledFields}
              lockedSelectionFilled={
                hasFileValueForLock(savedFormForLocks, "valueCapital") ||
                hasFileValueForLock(savedFormForLocks, "valueRevenue")
              }
              lockedValueFilled={
                hasFileValueForLock(savedFormForLocks, "valueCapital") ||
                hasFileValueForLock(savedFormForLocks, "valueRevenue")
              }
              onChange={(patch) => {
                if (readOnlyMode) return;
                const nextForm = applyConditionalRules({ ...formWithLockedYear, ...patch });
                setForm((current) => applyConditionalRules({ ...current, ...patch }));
                setSupplyOrders((current) =>
                  current.map((order) =>
                    applySupplyOrderRules(
                      {
                        ...order,
                        soValueCapital:
                          patch.valueCapitalSelected === "Yes" ? order.soValueCapital : "",
                        soValueRevenue:
                          patch.valueRevenueSelected === "Yes" ? order.soValueRevenue : "",
                      },
                      nextForm,
                    ),
                  ),
                );
              }}
            />
          );
        }

        if (field.key === "soValueCapital") {
          return (
            <SoValueField
              key={field.key}
              capitalSelected={formWithLockedYear.valueCapitalSelected === "Yes"}
              revenueSelected={formWithLockedYear.valueRevenueSelected === "Yes"}
              capitalValue={formWithLockedYear.soValueCapital}
              revenueValue={formWithLockedYear.soValueRevenue}
              disabled={fieldReadOnly}
              lockFilledFields={lockFilledFields}
              lockedValueFilled={
                hasFileValueForLock(savedFormForLocks, "soValueCapital") ||
                hasFileValueForLock(savedFormForLocks, "soValueRevenue")
              }
              onChange={(patch) => {
                if (readOnlyMode) return;
                setForm((current) => applyConditionalRules({ ...current, ...patch }));
              }}
            />
          );
        }

        const dynamicFieldDisabled =
          field.key === "year" ||
          field.key === "uniqueCode" ||
          field.key === "tenderLive" ||
          fieldReadOnly ||
          (lockFilledFields && hasFileValueForLock(savedFormForLocks, field.key)) ||
          (field.key === "adVettingDate" && adVettingDisabled) ||
          (tcecIsNo && tcecDisabledKeys.includes(field.key)) ||
          (gemIsNo && gemDisabledKeys.includes(field.key)) ||
          (highValueIsNo && highValueDisabledKeys.includes(field.key)) ||
          (rqaIsNo && rqaDisabledKeys.includes(field.key)) ||
          (ifaIsNo && ifaDisabledKeys.includes(field.key)) ||
          (bgIsNo && bgDisabledKeys.includes(field.key)) ||
          (field.key === "ir" && deliveryInspectionInactive) ||
          (rfpVettingIsNo && rfpVettingDisabledKeys.includes(field.key)) ||
          (refloatIsNo && refloatDisabledKeys.includes(field.key)) ||
          (field.key === "demandCancelled" &&
            (!demandCancelledUnlocked ||
              (demandCancellationHasPlacedSupplyOrder &&
                !isYes(formWithLockedYear.demandCancelled)))) ||
          (field.key === "demandCancelledDate" &&
            (!demandCancelledUnlocked || !isYes(formWithLockedYear.demandCancelled)));

        const fieldControl = (
          <DynamicField
            key={field.key}
            field={renderedField}
            value={formWithLockedYear[field.key]}
            disabled={dynamicFieldDisabled}
            onChange={(value) => update(field.key, value)}
            inputRef={(element) => {
              quickFieldRefs.current[field.key] = element;
            }}
          />
        );

        if (
          !["demandCancelled", "demandCancelledDate"].includes(field.key) ||
          fieldReadOnly ||
          field.key === "demandCancelledDate"
        ) {
          return fieldControl;
        }

        return (
          <div key={field.key} className="space-y-2">
            {fieldControl}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={unlockDemandCancelled}
                disabled={demandCancelledUnlocked}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {demandCancelledUnlocked ? (
                  <>
                    <Unlock className="size-3.5" /> Unlocked
                  </>
                ) : (
                  <>
                    <Lock className="size-3.5" /> Unlock with password
                  </>
                )}
              </button>
              <span className="text-xs text-muted-foreground">
                Required before changing demand cancellation.
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );

  const save = async (options?: { returnToQuickEntry?: boolean }) => {
    if (readOnlyMode) return;
    const requestedSupplyOrderCount = clampSupplyOrderCount(formWithLockedYear.noOfSo);
    const cleanedRequestedSupplyOrders = cleanSupplyOrderRows(
      resizeSupplyOrders(supplyOrders, requestedSupplyOrderCount),
      formWithLockedYear,
    );
    const cleanedSupplyOrders = cleanedRequestedSupplyOrders.filter(hasMeaningfulSupplyOrderData);
    if (isYes(formWithLockedYear.demandCancelled) && hasPlacedSupplyOrderRows(cleanedSupplyOrders)) {
      alert(
        "Demand can be cancelled only before any Supply Order is placed. Use S.O. cancelled for placed Supply Orders.",
      );
      return;
    }
    const supplyOrdersForSave = shouldUseSupplyOrderMilestones(cleanedSupplyOrders)
      ? cleanedSupplyOrders
      : clearSupplyOrderMilestones(cleanedSupplyOrders);
    const supplyOrderMilestoneProgressForSave = getSupplyOrderMilestoneProgress(
      milestoneOptions,
      supplyOrdersForSave,
      formWithLockedYear,
    );
    const completedMilestonesForSave = getCompletedMilestonesForSave(
      milestoneOptions,
      applicableMilestones,
      completedMilestones,
      formWithLockedYear,
      supplyOrderMilestoneProgressForSave,
    );
    const currentMilestoneForSave =
      shouldUseSupplyOrderMilestones(supplyOrdersForSave) &&
      getSupplyOrderMilestoneByName(currentMilestone)
        ? ""
        : currentMilestone;
    const payload = {
      ...toFilePayload(
        clearDivisionDisabledFields(applyConditionalRules(formWithLockedYear), divisions),
      ),
      ...legacySupplyOrderPatch(cleanedSupplyOrders),
      noOfSo: String(requestedSupplyOrderCount),
      supplyOrders: supplyOrdersForSave,
      remarks: cleanFileRemarks(fileRemarks) ?? [],
      markers: cleanFileMarkers(fileMarkers) ?? [],
      activeYears,
      invitedFirms: cleanFirmRows(firmDetails.invitedFirms) ?? [],
      bidderFirms: cleanFirmRows(firmDetails.bidderFirms) ?? [],
      currentMilestone: currentMilestoneForSave || null,
      completedMilestones: completedMilestonesForSave,
    };
    const stageWarnings = getStageDeliveryWarnings(
      supplyOrdersForSave,
      savedSupplyOrdersForLocks,
      formWithLockedYear,
      completedMilestonesForSave,
    );
    if (stageWarnings.length) {
      const confirmed = window.confirm(
        [
          "Please review these stage delivery/payment warnings before saving:",
          "",
          ...stageWarnings,
          "",
          "Do you still want to save?",
        ].join("\n"),
      );
      if (!confirmed) return;
    }
    const supplyOrderMilestoneErrors = getSupplyOrderMilestoneErrors(
      supplyOrdersForSave,
      formWithLockedYear,
    );
    const paymentBlockedByBgErrors = getPaymentBlockedByBgErrors(
      supplyOrdersForSave,
      formWithLockedYear,
    );
    const milestonesForValidation = shouldUseSupplyOrderMilestones(supplyOrdersForSave)
      ? milestoneOptions.filter((milestone) => !getSupplyOrderMilestoneByName(milestone))
      : milestoneOptions;
    const milestoneErrors = [
      ...supplyOrderMilestoneErrors,
      ...paymentBlockedByBgErrors,
      ...validateMilestoneCompletionConsistency(
        payload as Partial<FileRecord>,
        milestonesForValidation,
      ),
    ];
    if (milestoneErrors.length) {
      const targetMilestone = getMilestoneValidationTarget(milestoneErrors, milestoneOptions) ?? "";
      const hasSupplyOrderMilestoneErrors = supplyOrderMilestoneErrors.length > 0;
      setActiveBoardSection(
        hasSupplyOrderMilestoneErrors ? "Supply order and payment" : "Milestones",
      );
      setFocusedMilestone(hasSupplyOrderMilestoneErrors ? "" : targetMilestone);
      if (options?.returnToQuickEntry) {
        window.setTimeout(() => {
          alert(
            [
              "Milestone status needs to be updated before this Quick Entry can be saved.",
              "",
              ...milestoneErrors,
              "",
              hasSupplyOrderMilestoneErrors
                ? "Please update the local Supply order and payment status, then click Update."
                : "Please update the Milestones section, then click Update.",
            ].join("\n"),
          );
        }, 100);
        return;
      }
      window.setTimeout(() => {
        alert(["Please fix milestone status before saving:", ...milestoneErrors].join("\n"));
      }, 100);
      return;
    }
    if (editingFile) {
      const updatedFile = await store.updateFile(editingFile.id, payload as Partial<FileRecord>);
      setLoadedFile(updatedFile);
      setForm(applyConditionalRules(createFormFromFile(updatedFile, effectiveFinancialYear)));
      setFirmDetails(createFirmDetailsFromFile(updatedFile));
      setSupplyOrders(createSupplyOrdersFromFile(updatedFile));
      setFileRemarks(createRemarksFromFile(updatedFile));
      setFileMarkers(createMarkersFromFile(updatedFile));
      setCurrentMilestone(updatedFile.currentMilestone ?? "");
      setCompletedMilestones(normalizeCompletedMilestones(updatedFile.completedMilestones));
      setActiveYears(
        normalizeSelectableActiveYears(
          normalizeActiveYears(updatedFile, effectiveFinancialYear),
          getLatestTwoYears(effectiveFinancialYear, settings.financialYears),
          effectiveFinancialYear,
          settings.yearSelectionLocked,
        ),
      );
      setUnlockedSections(new Set());
      setSaved(true);
      if (options?.returnToQuickEntry) {
        setTimeout(() => {
          navigate({ to: "/quick-entry" });
        }, 250);
        return;
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => setSaved(false), 1200);
      return;
    } else {
      await store.addFile(payload as Omit<FileRecord, "id" | "createdAt">);
    }
    setSaved(true);
    setTimeout(() => {
      if (options?.returnToQuickEntry) {
        navigate({ to: "/quick-entry" });
        return;
      }
      navigate({ to: "/search", search: { dashboardFilter: undefined, division: undefined } });
    }, 700);
  };

  const handleQuickEntrySaveKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (readOnlyMode) return;
    if (!quickFocus || !isEditing || event.key !== "Enter" || event.metaKey || event.ctrlKey) {
      return;
    }

    const target = event.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    if (tagName === "button" || tagName === "a" || tagName === "select") return;
    if (tagName === "textarea" && event.shiftKey) return;
    if (
      target instanceof HTMLInputElement &&
      ["checkbox", "radio", "button", "submit"].includes(target.type)
    ) {
      return;
    }

    event.preventDefault();
    const confirmed = window.confirm(
      "Please verify the entry before saving.\n\nDo you want to save this update?",
    );
    if (!confirmed) return;

    save({ returnToQuickEntry: true });
  };

  const deleteFile = async () => {
    if (readOnlyMode) return;
    if (!editingFile) return;
    const label =
      editingFile.uniqueCode || editingFile.imms || editingFile.demandDescription || "this file";
    const deletionPassword = await promptDeletionPassword(`delete ${label}`);
    if (deletionPassword === null) return;
    store.deleteFile(editingFile.id, deletionPassword);
    navigate({ to: "/search", search: { dashboardFilter: undefined, division: undefined } });
  };

  if (fileId && fileLoadStatus === "loading") {
    return (
      <div className="w-full">
        <div className="bg-card border border-border rounded-md p-6 shadow-[var(--shadow-card)]">
          <h2 className="text-base font-semibold">Loading file...</h2>
          <p className="text-sm text-muted-foreground mt-1">Fetching this file from the backend.</p>
        </div>
      </div>
    );
  }

  if (fileId && !editingFile) {
    return (
      <div className="w-full">
        <div className="bg-card border border-border rounded-md p-6 shadow-[var(--shadow-card)]">
          <h2 className="text-base font-semibold">File not available</h2>
          <p className="text-sm text-muted-foreground mt-1">
            This file is either missing or not assigned to the active user's divisions.
          </p>
          <button
            type="button"
            onClick={() =>
              navigate({
                to: "/search",
                search: { dashboardFilter: undefined, division: undefined },
              })
            }
            className="mt-4 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            Back to search
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full" onKeyDownCapture={handleQuickEntrySaveKey}>
      <div className="bg-card border border-border rounded-md shadow-[var(--shadow-card)] overflow-hidden">
        <div className="p-5 border-b border-border bg-secondary/30">
          <h2 className="text-base font-semibold">
            {readOnlyMode
              ? "View file details"
              : isEditing
                ? "Edit file details"
                : "Add a new file"}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {readOnlyMode
              ? "Viewer access is read-only. You can inspect milestones, dates, and file details."
              : isEditing
                ? "Update the filled and unfilled details for this file."
                : "All fields are optional — save now and complete missing details later."}
          </p>
        </div>

        <SectionBoard active={activeBoardSection} onOpen={setActiveBoardSection} />

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeBoardSection === "Timeline" && (
            <TimelineBlock
              form={formWithLockedYear}
              supplyOrders={supplyOrders}
              divisions={divisions}
            />
          )}
          {activeBoardSection === "Remarks Summary" && (
            <RemarksSummaryBlock form={formWithLockedYear} remarks={fileRemarks} />
          )}
          {activeBoardSection === "Milestones" && (
            <MilestonesBlock
              milestones={milestoneOptions}
              applicableMilestones={applicableMilestones}
              currentMilestone={currentMilestone}
              completedMilestones={completedMilestones}
              autoCompletedMilestones={getAutoCompletedMilestones(
                milestoneOptions,
                applicableMilestones,
                formWithLockedYear,
              )}
              lockedCurrentMilestone={editingFile?.currentMilestone ?? ""}
              lockedCompletedMilestones={savedCompletedMilestonesForLocks}
              supplyOrderMilestoneProgress={supplyOrderMilestoneProgress}
              inactiveMilestones={inactiveMainMilestones}
              focusedMilestone={focusedMilestone}
              disabled={readOnlyMode}
              lockFilledFields={milestonesLocked}
              lockControl={renderSectionUnlockButton("Milestones")}
              onCurrentChange={setCurrentMilestone}
              onCompletedChange={setCompletedMilestones}
            />
          )}

          {activeSection && (
            <section
              key={activeSection.title}
              id={sectionId(activeSection.title)}
              className={sectionBlockCls(activeSectionIndex)}
            >
              <h3 className="text-sm font-semibold border-b border-border pb-2 mb-4 flex items-center gap-2">
                <span className={sectionStripeCls(activeSectionIndex)} />
                <span className="min-w-0 flex-1">{activeSection.title}</span>
                {renderSectionUnlockButton(activeSection.title)}
              </h3>
              {activeSection.title === "Firm details" ? (
                <FirmDetailsBlock
                  details={firmDetails}
                  lockedDetails={savedFirmDetailsForLocks}
                  disabled={readOnlyMode}
                  lockFilledFields={firmDetailsLocked}
                  quickFocus={Boolean(quickFocus && activeSection.title === "Firm details")}
                  onAdd={addFirmDetail}
                  onChange={updateFirmDetail}
                  onDelete={deleteFirmDetail}
                  onDeleteSelected={deleteSelectedFirmDetails}
                />
              ) : activeSection.title === "File Markers" ? (
                <FileMarkersBlock
                  markers={fileMarkers}
                  disabled={readOnlyMode}
                  lockFilledFields={fileMarkersLocked}
                  onAdd={addMarker}
                  onChange={updateMarker}
                  onDelete={deleteMarker}
                />
              ) : activeSection.title === "Supply order and payment" ? (
                <SupplyOrdersBlock
                  form={formWithLockedYear}
                  lockedForm={savedFormForLocks}
                  orders={supplyOrders}
                  lockedOrders={savedSupplyOrdersForLocks}
                  disabled={readOnlyMode}
                  lockFilledFields={supplyOrdersLocked}
                  firmTypeOptions={firmTypeOptions}
                  gemDisabled={gemIsNo}
                  bgDisabled={bgIsNo}
                  irDisabled={irIsNo}
                  quickFocus={Boolean(
                    quickFocus && activeSection.title === "Supply order and payment",
                  )}
                  focusTarget={focusTarget}
                  onCountChange={
                    supplyOrdersLocked && hasFileValueForLock(savedFormForLocks, "noOfSo")
                      ? () => undefined
                      : (value) => update("noOfSo", value)
                  }
                  onOrderChange={updateSupplyOrder}
                  onOrderCurrentMilestoneChange={updateSupplyOrderCurrentMilestone}
                  onOrderCompletedMilestonesChange={updateSupplyOrderCompletedMilestones}
                  onStageCurrentMilestoneChange={updateStageDeliveryCurrentMilestone}
                  onStageCompletedMilestonesChange={updateStageDeliveryCompletedMilestones}
                  onAdvancePaymentChange={updateAdvancePayment}
                  onAdvancePaymentMilestoneChange={updateAdvancePaymentMilestone}
                  onStageDeliveryChange={updateStageDelivery}
                />
              ) : (
                <>
                  {activeSection.title === "File details" ? (
                    <ActiveYearsField
                      years={activeYearOptions}
                      selectedYears={activeYears}
                      originYear={formWithLockedYear.year}
                      locked={settings.yearSelectionLocked || readOnlyMode}
                      onChange={setActiveYears}
                    />
                  ) : null}
                  {renderSectionFields(activeSection)}
                </>
              )}
              {activeSection.title !== "File Markers" ? (
                <SectionRemarks
                  sectionTitle={activeSection.title}
                  remarks={fileRemarks.filter((remark) => remark.section === activeSection.title)}
                  onAdd={() => addRemark(activeSection.title)}
                  onChange={updateRemark}
                  onDateChange={updateRemarkDate}
                  onDelete={deleteRemark}
                  disabled={readOnlyMode}
                />
              ) : null}
              {editingFile && activeSection.title !== "File Markers" ? (
                <SectionMessages
                  fileId={editingFile.id}
                  sectionTitle={activeSection.title}
                  messages={activeSectionMessages}
                  activeUserRole={activeUser?.role}
                  messagesEnabled={selectedDivision?.messagesEnabled !== false}
                />
              ) : null}
            </section>
          )}
        </div>
        <div className="px-5 py-4 border-t border-border bg-secondary/40 flex flex-wrap items-center justify-between gap-2">
          <div>
            {isEditing && !readOnlyMode && (
              <button
                type="button"
                onClick={deleteFile}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-destructive/30 bg-background text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-4" /> Delete file
              </button>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            {!isEditing && !readOnlyMode && (
              <button
                type="button"
                onClick={() => {
                  setForm(applyConditionalRules(createEmptyForm(effectiveFinancialYear)));
                  setFileRemarks([]);
                  setFileMarkers([]);
                  setActiveYears([effectiveFinancialYear]);
                  setCurrentMilestone("");
                  setCompletedMilestones([]);
                  setDemandCancelledUnlocked(false);
                }}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-sm hover:bg-accent"
              >
                <Eraser className="size-4" /> Clear
              </button>
            )}
            {!readOnlyMode ? (
              <button
                type="button"
                onClick={() =>
                  save({
                    returnToQuickEntry: Boolean(quickFocus),
                  })
                }
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
              >
                <Save className="size-4" /> {saved ? "Saved" : isEditing ? "Update" : "Save"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionBoard({
  active,
  onOpen,
}: {
  active: string;
  onOpen: (sectionTitle: string) => void;
}) {
  const links = [
    "Timeline",
    "Remarks Summary",
    "Milestones",
    ...extraSections.map((section) => section.title),
  ];

  return (
    <div className="border-b border-border bg-card px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Show section</span>
        {links.map((label) => (
          <button
            type="button"
            key={label}
            onClick={() => onOpen(label)}
            className={
              "inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium hover:bg-accent " +
              (active === label
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-secondary/50 text-foreground")
            }
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SectionRemarks({
  sectionTitle,
  remarks,
  onAdd,
  onChange,
  onDateChange,
  onDelete,
  disabled = false,
}: {
  sectionTitle: string;
  remarks: FileRemark[];
  onAdd: () => void;
  onChange: (remarkId: string, text: string) => void;
  onDateChange: (remarkId: string, date: string) => void;
  onDelete: (remarkId: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          {remarks.length ? `${remarks.length} remark${remarks.length === 1 ? "" : "s"}` : ""}
        </div>
        {!disabled ? (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
          >
            <Plus className="size-3.5" /> Add remark
          </button>
        ) : null}
      </div>

      {remarks.length ? (
        <div className="space-y-3">
          {remarks.map((remark) => (
            <div key={remark.id} className="rounded-md border border-border bg-secondary/20 p-3">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <label className="block">
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Date</div>
                  <input
                    type="date"
                    value={getRemarkDateInputValue(remark.createdAt)}
                    onChange={(event) =>
                      onDateChange(remark.id, clampDateYearInput(event.target.value))
                    }
                    disabled={disabled}
                    max="9999-12-31"
                    className={
                      "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40" +
                      disabledCls(disabled)
                    }
                  />
                </label>
                {!disabled ? (
                  <button
                    type="button"
                    onClick={() => onDelete(remark.id)}
                    aria-label={`Delete remark from ${sectionTitle}`}
                    title="Delete remark"
                    className="inline-flex size-8 items-center justify-center rounded-md border border-destructive/30 bg-background text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </div>
              <textarea
                value={remark.text}
                onChange={(event) => onChange(remark.id, event.target.value)}
                placeholder="Type remark"
                disabled={disabled}
                className={textareaCls + disabledCls(disabled)}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SectionMessages({
  fileId,
  sectionTitle,
  messages,
  activeUserRole,
  messagesEnabled,
}: {
  fileId: string;
  sectionTitle: string;
  messages: FileMessage[];
  activeUserRole?: string;
  messagesEnabled: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [action, setAction] = useState("");
  const pendingMessages = messages.filter((message) => message.status === "pending");
  const resolvedMessages = messages.filter((message) => message.status === "resolved");
  const canCreate = activeUserRole === "viewer" || activeUserRole === "division_user";
  const canResolve =
    activeUserRole === "admin" || activeUserRole === "sub_admin" || activeUserRole === "editor";
  const canDelete = activeUserRole === "admin" || canCreate;
  const draftWords = countMessageWords(draft);

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || draftWords > 20) return;
    setAction("Sending...");
    try {
      await store.createMessage(fileId, sectionTitle, text);
      setDraft("");
      setAction("Message sent.");
    } catch (error) {
      setAction(error instanceof Error ? error.message : "Message could not be sent.");
    }
  };

  const replyToMessage = async (messageId: string) => {
    const text = replyDrafts[messageId]?.trim() ?? "";
    if (!text || countMessageWords(text) > 20) return;
    setAction("Saving reply...");
    try {
      await store.replyToMessage(messageId, text);
      setReplyDrafts((current) => ({ ...current, [messageId]: "" }));
      setAction("Reply saved.");
    } catch (error) {
      setAction(error instanceof Error ? error.message : "Reply could not be saved.");
    }
  };

  const resolveMessage = async (messageId: string) => {
    setAction("Resolving...");
    try {
      await store.resolveMessage(messageId);
      setAction("Message resolved.");
    } catch (error) {
      setAction(error instanceof Error ? error.message : "Message could not be resolved.");
    }
  };

  const deleteMessage = async (messageId: string) => {
    setAction("Deleting...");
    try {
      await store.deleteMessage(messageId);
      setAction("Message deleted.");
    } catch (error) {
      setAction(error instanceof Error ? error.message : "Message could not be deleted.");
    }
  };

  return (
    <div className="mt-5 rounded-md border border-border bg-secondary/20 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">Messages</div>
            <div className="text-xs text-muted-foreground">
              Pending {pendingMessages.length} · Resolved {resolvedMessages.length}
            </div>
          </div>
        </div>
        {!messagesEnabled ? (
          <span className="rounded-full bg-secondary px-2 py-1 text-xs font-medium">
            Disabled for division
          </span>
        ) : null}
      </div>

      {canCreate ? (
        <div className="mb-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!messagesEnabled}
            placeholder="Add message"
            className={textareaCls + disabledCls(!messagesEnabled)}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div
              className={
                draftWords > 20 ? "text-xs text-destructive" : "text-xs text-muted-foreground"
              }
            >
              {draftWords}/20 words
            </div>
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={!draft.trim() || draftWords > 20 || !messagesEnabled}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      ) : null}

      {messages.length ? (
        <div className="space-y-2">
          {messages.map((message) => {
            const replyDraft = replyDrafts[message.id] ?? "";
            const replyWords = countMessageWords(replyDraft);
            return (
              <div key={message.id} className="rounded-md border border-border bg-background p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold">
                      {message.createdByName} · {formatRemarkDate(message.createdAt)}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{message.text}</p>
                  </div>
                  <span className="rounded-full bg-secondary px-2 py-1 text-xs font-medium capitalize">
                    {message.status}
                  </span>
                </div>

                {message.resolvedByName ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Resolved by {message.resolvedByName}
                    {message.resolvedAt ? ` on ${formatRemarkDate(message.resolvedAt)}` : ""}
                  </div>
                ) : null}

                {message.replies.length ? (
                  <div className="mt-2 space-y-1 border-t border-border pt-2">
                    {message.replies.map((reply) => (
                      <div key={reply.id} className="rounded bg-secondary/40 p-2 text-sm">
                        <div className="text-xs font-medium">
                          {reply.createdByName} · {formatRemarkDate(reply.createdAt)}
                        </div>
                        <div className="mt-1 whitespace-pre-wrap">{reply.text}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {canResolve && message.status === "pending" ? (
                  <div className="mt-2 border-t border-border pt-2">
                    <textarea
                      value={replyDraft}
                      onChange={(event) =>
                        setReplyDrafts((current) => ({
                          ...current,
                          [message.id]: event.target.value,
                        }))
                      }
                      placeholder="Reply"
                      className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <div
                        className={
                          replyWords > 20
                            ? "text-xs text-destructive"
                            : "text-xs text-muted-foreground"
                        }
                      >
                        {replyWords}/20 words
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void replyToMessage(message.id)}
                          disabled={!replyDraft.trim() || replyWords > 20}
                          className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
                        >
                          Reply
                        </button>
                        <button
                          type="button"
                          onClick={() => void resolveMessage(message.id)}
                          className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
                        >
                          Resolve
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {canDelete ? (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void deleteMessage(message.id)}
                      className="inline-flex h-8 items-center rounded-md border border-destructive/30 bg-background px-3 text-xs font-medium text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-background p-3 text-sm text-muted-foreground">
          No messages for this section.
        </div>
      )}
      {action ? <div className="mt-2 text-xs text-muted-foreground">{action}</div> : null}
    </div>
  );
}

function countMessageWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function ActiveYearsField({
  years,
  selectedYears,
  originYear,
  locked,
  onChange,
}: {
  years: string[];
  selectedYears: string[];
  originYear: string;
  locked: boolean;
  onChange: (years: string[]) => void;
}) {
  const toggleYear = (year: string) => {
    if (locked) return;
    onChange([year]);
  };

  return (
    <div className="rounded-md border border-border bg-secondary/20 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">Active year</div>
        {locked ? <div className="text-xs text-muted-foreground">Locked by admin</div> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {years.map((year) => (
          <label
            key={year}
            className={
              "inline-flex h-8 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm " +
              (locked ? "opacity-70" : "")
            }
          >
            <input
              type="radio"
              name="activeYear"
              checked={selectedYears.includes(year) || year === originYear}
              disabled={locked}
              onChange={() => toggleYear(year)}
              className="size-4 rounded border-input"
            />
            <span>{displayFinancialYearLabel(year)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function FileMarkersBlock({
  markers,
  disabled,
  lockFilledFields,
  onAdd,
  onChange,
  onDelete,
}: {
  markers: FileMarker[];
  disabled: boolean;
  lockFilledFields: boolean;
  onAdd: () => void;
  onChange: (markerId: string, text: string) => void;
  onDelete: (markerId: string) => void;
}) {
  const locked = disabled || lockFilledFields;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">File specific keywords</div>
          <div className="text-xs text-muted-foreground">
            These marker words are included in the main search box.
          </div>
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={locked}
          className={
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent" +
            disabledCls(locked)
          }
        >
          <Plus className="size-3.5" /> Add marker
        </button>
      </div>

      {markers.length ? (
        <div className="space-y-3">
          {markers.map((marker, index) => (
            <div key={marker.id} className="rounded-md border border-border bg-secondary/20 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">Marker {index + 1}</div>
                <button
                  type="button"
                  onClick={() => onDelete(marker.id)}
                  disabled={locked}
                  aria-label={`Delete marker ${index + 1}`}
                  title="Delete marker"
                  className={
                    "inline-flex size-8 items-center justify-center rounded-md border border-destructive/30 bg-background text-destructive hover:bg-destructive/10" +
                    disabledCls(locked)
                  }
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <textarea
                value={marker.text}
                onChange={(event) => onChange(marker.id, event.target.value)}
                placeholder="Type keyword or marker text"
                disabled={locked}
                className={textareaCls + disabledCls(locked)}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
          No file markers added yet.
        </div>
      )}
    </div>
  );
}

function FirmDetailsBlock({
  details,
  lockedDetails,
  disabled,
  lockFilledFields,
  quickFocus,
  onAdd,
  onChange,
  onDelete,
  onDeleteSelected,
}: {
  details: FirmDetailsState;
  lockedDetails: FirmDetailsState;
  disabled: boolean;
  lockFilledFields: boolean;
  quickFocus?: boolean;
  onAdd: (group: keyof FirmDetailsState) => void;
  onChange: (
    group: keyof FirmDetailsState,
    index: number,
    key: keyof FirmDetail,
    value: string,
  ) => void;
  onDelete: (group: keyof FirmDetailsState, index: number) => void;
  onDeleteSelected: (group: keyof FirmDetailsState, indexes: number[]) => void;
}) {
  const [activeTab, setActiveTab] = useState<keyof FirmDetailsState>("invitedFirms");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());
  const tabs: { key: keyof FirmDetailsState; label: string }[] = [
    { key: "invitedFirms", label: "Invited" },
    { key: "bidderFirms", label: "Bidders" },
  ];
  const rows = details[activeTab];
  const firmInputRefs = useRef<Record<string, HTMLInputElement | HTMLButtonElement | null>>({});
  const firmQuickFocusAppliedRef = useRef("");
  const latestFirmRowsRef = useRef(rows);
  const firmCounts = {
    invitedFirms: details.invitedFirms.length,
    bidderFirms: details.bidderFirms.length,
  };
  const selectedIndexes = [...selectedRows].filter((index) => index < rows.length);

  useEffect(() => {
    setSelectedRows(new Set());
  }, [activeTab, rows.length]);

  useEffect(() => {
    latestFirmRowsRef.current = rows;
  });

  useEffect(() => {
    if (!quickFocus) return;
    const focusKey = `firm-details:${activeTab}`;
    if (firmQuickFocusAppliedRef.current === focusKey) return;

    window.setTimeout(() => {
      const currentRows = latestFirmRowsRef.current;
      if (currentRows.length === 0) {
        firmInputRefs.current.addFirm?.focus();
        firmQuickFocusAppliedRef.current = focusKey;
        return;
      }

      for (const [index, row] of currentRows.entries()) {
        for (const key of ["firmName", "city", "emailId"] as const) {
          if (!hasFilledValue(row[key])) {
            firmInputRefs.current[`${index}:${key}`]?.focus();
            firmQuickFocusAppliedRef.current = focusKey;
            return;
          }
        }
      }
    }, 100);
  }, [activeTab, quickFocus, rows.length]);

  const toggleSelectedRow = (index: number, checked: boolean) => {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return next;
    });
  };

  const deleteFirm = (index: number) => {
    onDelete(activeTab, index);
    setSelectedRows(new Set());
  };

  const deleteSelectedFirms = () => {
    if (!selectedIndexes.length) return;
    onDeleteSelected(activeTab, selectedIndexes);
    setSelectedRows(new Set());
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block">
          <div className="mb-1.5 text-xs font-medium">Invited firms</div>
          <input
            value={firmCounts.invitedFirms}
            readOnly
            disabled={disabled}
            className={inputCls + disabledCls(disabled)}
          />
        </label>
        <label className="block">
          <div className="mb-1.5 text-xs font-medium">Bidders</div>
          <input
            value={firmCounts.bidderFirms}
            readOnly
            disabled={disabled}
            className={inputCls + disabledCls(disabled)}
          />
        </label>
      </div>

      <div className="inline-flex rounded-lg border border-border bg-background p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={
              "h-8 rounded-md px-3 text-sm font-medium transition-colors " +
              (activeTab === tab.key
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground")
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{selectedIndexes.length} selected</div>
        <button
          type="button"
          onClick={deleteSelectedFirms}
          disabled={disabled || selectedIndexes.length === 0}
          className={
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/30 bg-background px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10" +
            disabledCls(disabled || selectedIndexes.length === 0)
          }
        >
          <Trash2 className="size-3.5" /> Delete selected
        </button>
      </div>

      <div className="space-y-3">
        {rows.map((row, index) => {
          const lockedRow = lockedDetails[activeTab][index];
          const rowHasValue =
            hasFilledValue(lockedRow?.firmName) ||
            hasFilledValue(lockedRow?.city) ||
            hasFilledValue(lockedRow?.emailId);
          const firmNameDisabled =
            disabled || (lockFilledFields && hasFilledValue(lockedRow?.firmName));
          const cityDisabled = disabled || (lockFilledFields && hasFilledValue(lockedRow?.city));
          const emailDisabled =
            disabled || (lockFilledFields && hasFilledValue(lockedRow?.emailId));
          const rowActionDisabled = disabled || (lockFilledFields && rowHasValue);
          return (
            <div
              key={index}
              className="grid grid-cols-1 gap-3 rounded-md border border-border bg-secondary/20 p-3 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <label className="flex items-center gap-2 md:pt-7">
                <input
                  type="checkbox"
                  checked={selectedRows.has(index)}
                  onChange={(event) => toggleSelectedRow(index, event.target.checked)}
                  disabled={rowActionDisabled}
                  className="size-4 rounded border-border accent-primary"
                />
                <span className="text-xs text-muted-foreground md:sr-only">Select firm</span>
              </label>
              <label className="block">
                <div className="mb-1.5 text-xs font-medium">Firm name</div>
                <input
                  ref={(element) => {
                    firmInputRefs.current[`${index}:firmName`] = element;
                  }}
                  value={row.firmName ?? ""}
                  onChange={(event) => onChange(activeTab, index, "firmName", event.target.value)}
                  disabled={firmNameDisabled}
                  className={inputCls + disabledCls(firmNameDisabled)}
                />
              </label>
              <label className="block">
                <div className="mb-1.5 text-xs font-medium">City</div>
                <input
                  ref={(element) => {
                    firmInputRefs.current[`${index}:city`] = element;
                  }}
                  value={row.city ?? ""}
                  onChange={(event) => onChange(activeTab, index, "city", event.target.value)}
                  disabled={cityDisabled}
                  className={inputCls + disabledCls(cityDisabled)}
                />
              </label>
              <label className="block">
                <div className="mb-1.5 text-xs font-medium">Email id</div>
                <input
                  ref={(element) => {
                    firmInputRefs.current[`${index}:emailId`] = element;
                  }}
                  type="email"
                  value={row.emailId ?? ""}
                  onChange={(event) => onChange(activeTab, index, "emailId", event.target.value)}
                  disabled={emailDisabled}
                  className={inputCls + disabledCls(emailDisabled)}
                />
              </label>
              <button
                type="button"
                onClick={() => deleteFirm(index)}
                disabled={rowActionDisabled}
                aria-label="Delete firm"
                title="Delete firm"
                className={
                  "inline-flex size-9 items-center justify-center rounded-md border border-destructive/30 bg-background text-destructive hover:bg-destructive/10 md:self-end" +
                  disabledCls(rowActionDisabled)
                }
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        ref={(element) => {
          firmInputRefs.current.addFirm = element;
        }}
        type="button"
        onClick={() => onAdd(activeTab)}
        disabled={disabled}
        className={
          "h-9 rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-accent" +
          disabledCls(disabled)
        }
      >
        Add firm
      </button>
    </div>
  );
}

function SupplyOrdersBlock({
  form,
  lockedForm,
  orders,
  lockedOrders,
  disabled,
  lockFilledFields,
  firmTypeOptions,
  gemDisabled,
  bgDisabled,
  irDisabled,
  quickFocus,
  focusTarget,
  onCountChange,
  onOrderChange,
  onOrderCurrentMilestoneChange,
  onOrderCompletedMilestonesChange,
  onStageCurrentMilestoneChange,
  onStageCompletedMilestonesChange,
  onAdvancePaymentChange,
  onAdvancePaymentMilestoneChange,
  onStageDeliveryChange,
}: {
  form: FormState;
  lockedForm: FormState;
  orders: SupplyOrderDetail[];
  lockedOrders: SupplyOrderDetail[];
  disabled: boolean;
  lockFilledFields: boolean;
  firmTypeOptions: string[];
  gemDisabled: boolean;
  bgDisabled: boolean;
  irDisabled: boolean;
  quickFocus?: boolean;
  focusTarget?: string;
  onCountChange: (value: string) => void;
  onOrderChange: (index: number, key: SupplyOrderKey, value: string) => void;
  onOrderCurrentMilestoneChange: (index: number, milestone: string) => void;
  onOrderCompletedMilestonesChange: (index: number, milestones: string[]) => void;
  onStageCurrentMilestoneChange: (
    orderIndex: number,
    stageIndex: number,
    milestone: string,
  ) => void;
  onStageCompletedMilestonesChange: (
    orderIndex: number,
    stageIndex: number,
    milestones: string[],
  ) => void;
  onAdvancePaymentChange: (orderIndex: number, key: AdvancePaymentKey, value: string) => void;
  onAdvancePaymentMilestoneChange: (
    orderIndex: number,
    patch: Pick<AdvancePaymentDetail, "currentMilestone" | "completedMilestones">,
  ) => void;
  onStageDeliveryChange: (
    orderIndex: number,
    stageIndex: number,
    key: StageDeliveryKey,
    value: string,
  ) => void;
}) {
  const orderFieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const focusBlockRefs = useRef<Record<string, HTMLElement | null>>({});
  const orderQuickFocusAppliedRef = useRef("");
  const focusAppliedRef = useRef("");
  const latestOrdersRef = useRef(orders);
  const [activeSubview, setActiveSubview] = useState<SupplyOrderSubviewKey>("supplyOrder");
  const deliveryInspectionInactive = isDeliveryInspectionInactive(form);
  const effectiveIrDisabled = irDisabled || deliveryInspectionInactive;
  const focusConfig = useMemo(() => parseSupplyOrderFocusTarget(focusTarget), [focusTarget]);
  const effectiveFocusSubview =
    focusConfig?.subview === "delivery" && deliveryInspectionInactive ? "dp" : focusConfig?.subview;
  const focusBlockKeys = useMemo(
    () => (focusConfig ? getSupplyOrderFocusKeys(orders, focusConfig, form) : []),
    [focusConfig, form, orders],
  );
  const focusBlockKeySet = useMemo(() => new Set(focusBlockKeys), [focusBlockKeys]);
  const useOrderMilestones = shouldUseSupplyOrderMilestones(orders);
  const activeSubviewSupplyOrderFields = supplyOrderSubviewFields[
    activeSubview
  ] as readonly SupplyOrderKey[];
  const activeSubviewMilestones = supplyOrderSubviewMilestones[
    activeSubview
  ] as readonly SupplyOrderMilestoneName[];
  const activeSubviewFields = supplyOrderFields.filter((field) =>
    activeSubview === "delivery" && deliveryInspectionInactive
      ? false
      : activeSubviewSupplyOrderFields.includes(field.key as SupplyOrderKey),
  );

  useEffect(() => {
    if (activeSubview === "delivery" && deliveryInspectionInactive) {
      setActiveSubview("dp");
    }
  }, [activeSubview, deliveryInspectionInactive]);

  useEffect(() => {
    if (effectiveFocusSubview) setActiveSubview(effectiveFocusSubview);
  }, [effectiveFocusSubview]);

  useEffect(() => {
    latestOrdersRef.current = orders;
  });

  useEffect(() => {
    if (!focusConfig || activeSubview !== effectiveFocusSubview) return;
    const appliedKey = `${focusTarget ?? ""}:${focusBlockKeys.join("|")}:${activeSubview}`;
    if (focusAppliedRef.current === appliedKey) return;
    const blockKey = focusBlockKeys[0];
    if (!blockKey) return;

    window.setTimeout(() => {
      focusBlockRefs.current[blockKey]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      focusAppliedRef.current = appliedKey;
    }, 150);
  }, [activeSubview, effectiveFocusSubview, focusBlockKeys, focusConfig, focusTarget]);

  useEffect(() => {
    if (!quickFocus) return;
    const focusKey = "supply-order-and-payment";
    if (orderQuickFocusAppliedRef.current === focusKey) return;

    window.setTimeout(() => {
      if (!hasFilledValue(form.noOfSo)) {
        orderFieldRefs.current.noOfSo?.focus();
        orderQuickFocusAppliedRef.current = focusKey;
        return;
      }

      for (const [index, order] of latestOrdersRef.current.entries()) {
        for (const field of supplyOrderFields) {
          if (field.key === "soValueCapital") continue;
          const key = field.key as SupplyOrderKey;
          if (
            (gemDisabled && key === "gemSoNo") ||
            (bgDisabled && supplyOrderBgDisabledKeys.includes(key)) ||
            (effectiveIrDisabled && supplyOrderIrDisabledKeys.includes(key))
          ) {
            continue;
          }
          if (!hasFilledValue(String(order[key] ?? ""))) {
            orderFieldRefs.current[`${index}:${key}`]?.focus();
            orderQuickFocusAppliedRef.current = focusKey;
            return;
          }
        }
      }
    }, 100);
  }, [bgDisabled, effectiveIrDisabled, form.noOfSo, gemDisabled, orders.length, quickFocus]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 rounded-md border border-border bg-secondary/20 p-1.5">
        {supplyOrderSubviewTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              if (tab.key === "delivery" && deliveryInspectionInactive) return;
              setActiveSubview(tab.key);
            }}
            disabled={tab.key === "delivery" && deliveryInspectionInactive}
            title={
              tab.key === "delivery" && deliveryInspectionInactive
                ? "Delivery & Inspection is not applicable for AMC, MPC, CARS, or O&M files."
                : undefined
            }
            className={
              "h-8 rounded px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 " +
              (activeSubview === tab.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground")
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeSubview === "supplyOrder" ? (
        <DynamicField
          field={{ key: "noOfSo", label: "No. of S.O.", type: "number", min: 1 }}
          value={form.noOfSo}
          disabled={disabled || (lockFilledFields && hasFilledValue(lockedForm.noOfSo))}
          onChange={onCountChange}
          inputRef={(element) => {
            orderFieldRefs.current.noOfSo = element;
          }}
        />
      ) : null}

      {!activeSubviewFields.length ? (
        <div className="rounded-md border border-dashed border-border bg-secondary/20 px-4 py-6 text-sm text-muted-foreground">
          {activeSubview === "delivery" && deliveryInspectionInactive
            ? "Delivery & Inspection is not applicable for AMC, MPC, CARS, or O&M files."
            : "No fields in this tab."}
        </div>
      ) : null}

      {activeSubviewFields.length
        ? orders.map((order, index) => {
            const lockedOrder = lockedOrders[index];
            const stageFields = getStagedDeliverySubviewFields(activeSubview);
            const useStageFields = Boolean(stageFields && isYes(order.stageDelivery ?? ""));
            const useStageCards =
              useStageFields && (activeSubview !== "payment" || isYes(order.stagePayment ?? ""));
            const stageDeliveries = resizeStageDeliveries(
              order.stageDeliveries ?? [],
              getStageDeliveryCount(order.stageDeliveryCount),
            );
            const advancePaymentDetail = applyAdvancePaymentRules(order.advancePaymentDetail ?? {});
            const showAdvancePaymentBlock =
              activeSubview === "payment" &&
              isYes(order.stagePayment ?? "") &&
              isYes(order.advancePayment ?? "");
            const showOrderMilestoneControls = useOrderMilestones || activeSubview === "bg";
            const orderMilestones = showOrderMilestoneControls
              ? getApplicableSupplyOrderMilestones(order, {
                  bgDisabled,
                  irDisabled: irDisabled || deliveryInspectionInactive,
                }).filter((milestone) => activeSubviewMilestones.includes(milestone))
              : [];
            const fieldsToRender = activeSubviewFields.filter((field) =>
              shouldShowSupplyOrderField(field.key as SupplyOrderKey, order),
            );
            const completion = getSupplyOrderSubviewCompletion({
              activeSubview,
              order,
              fieldsToRender,
              form,
              gemDisabled,
              bgDisabled,
              irDisabled: effectiveIrDisabled,
            });
            const orderTitle = getSupplyOrderDisplayTitle(order, index);
            const orderSummary = getSupplyOrderDisplaySummary(order, form.fileType);
            const orderFocusKey = `order:${index}`;
            const directOrderFocusMatch = focusBlockKeySet.has(orderFocusKey);
            const childFocusMatch = focusBlockKeys.some(
              (key) => key === `advance:${index}` || key.startsWith(`stage:${index}:`),
            );
            const orderOpen = activeSubview === "bg" || directOrderFocusMatch || childFocusMatch;
            const focusClass = directOrderFocusMatch
              ? " border-primary bg-primary/5 ring-2 ring-primary/40"
              : childFocusMatch
                ? " border-primary/70"
              : "";

            return (
              <details
                key={index}
                ref={(element) => {
                  focusBlockRefs.current[orderFocusKey] = element;
                }}
                open={orderOpen || undefined}
                className={
                  "group overflow-hidden rounded-md border bg-card shadow-sm " +
                  getCompletionBorderClass(completion.status) +
                  focusClass
                }
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 text-sm font-semibold marker:hidden">
                  <span
                    className={
                      "size-2.5 shrink-0 rounded-full " + getCompletionDotClass(completion.status)
                    }
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{orderTitle}</span>
                    {orderSummary ? (
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {orderSummary}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={
                      "rounded-md border px-2 py-1 text-xs font-medium " +
                      getCompletionBadgeClass(completion.status)
                    }
                  >
                    {completion.label}
                    {completion.total ? ` ${completion.filled}/${completion.total}` : ""}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground group-open:hidden">
                    Open
                  </span>
                  <span className="hidden text-xs font-medium text-muted-foreground group-open:inline">
                    Close
                  </span>
                </summary>
                <div className="border-t border-border bg-secondary/15 p-4">
                  {orderMilestones.length && !useStageCards ? (
                    <SupplyOrderMilestonesBlock
                      milestones={orderMilestones}
                      order={order}
                      disabled={disabled}
                      lockFilledFields={lockFilledFields}
                      lockedOrder={lockedOrder}
                      fileType={form.fileType}
                      onCurrentChange={(milestone) =>
                        onOrderCurrentMilestoneChange(index, milestone)
                      }
                      onCompletedChange={(milestones) =>
                        onOrderCompletedMilestonesChange(index, milestones)
                      }
                    />
                  ) : null}

                  {useStageCards ? (
                    <div className="space-y-4">
                      {showAdvancePaymentBlock ? (
                        <div
                          ref={(element) => {
                            focusBlockRefs.current[`advance:${index}`] = element;
                          }}
                          className={
                            "rounded-md border border-border bg-background/70 p-4" +
                            (focusBlockKeySet.has(`advance:${index}`)
                              ? " border-primary bg-primary/5 ring-2 ring-primary/40"
                              : "")
                          }
                        >
                          <div className="mb-4 text-sm font-semibold">Advance Payment</div>
                          <AdvancePaymentMilestonesBlock
                            advance={advancePaymentDetail}
                            lockedAdvance={lockedOrder?.advancePaymentDetail}
                            disabled={disabled}
                            lockFilledFields={lockFilledFields}
                            onCurrentChange={() =>
                              onAdvancePaymentMilestoneChange(index, {
                                currentMilestone:
                                  normalizeMilestoneName(
                                    advancePaymentDetail.currentMilestone,
                                  ) === "advancepayment"
                                    ? ""
                                    : "Advance Payment",
                              })
                            }
                            onCompletedChange={(completedMilestones) =>
                              onAdvancePaymentMilestoneChange(index, { completedMilestones })
                            }
                          />
                          <div className="grid grid-cols-1 gap-4">
                            {advancePaymentFields.map((field) => {
                              const key = field.key;
                              const lockedValue = lockedOrder?.advancePaymentDetail?.[key];
                              if (key === "stageAmountCapital") {
                                return (
                                  <AmountByValueTypeField
                                    key={key}
                                    label="Advance amount"
                                    capitalSelected={form.valueCapitalSelected === "Yes"}
                                    revenueSelected={form.valueRevenueSelected === "Yes"}
                                    capitalValue={advancePaymentDetail.stageAmountCapital ?? ""}
                                    revenueValue={advancePaymentDetail.stageAmountRevenue ?? ""}
                                    disabled={disabled}
                                    lockFilledFields={lockFilledFields}
                                    lockedValueFilled={
                                      hasFilledValue(
                                        lockedOrder?.advancePaymentDetail?.stageAmountCapital,
                                      ) ||
                                      hasFilledValue(
                                        lockedOrder?.advancePaymentDetail?.stageAmountRevenue,
                                      )
                                    }
                                    onChange={(patch) => {
                                      if ("capital" in patch) {
                                        onAdvancePaymentChange(
                                          index,
                                          "stageAmountCapital",
                                          patch.capital ?? "",
                                        );
                                      }
                                      if ("revenue" in patch) {
                                        onAdvancePaymentChange(
                                          index,
                                          "stageAmountRevenue",
                                          patch.revenue ?? "",
                                        );
                                      }
                                    }}
                                  />
                                );
                              }
	                                if (key === "actualPaymentCapital") {
	                                  return (
	                                    <AmountByValueTypeField
                                    key={key}
                                    label="Actual payment amount"
                                    capitalSelected={form.valueCapitalSelected === "Yes"}
                                    revenueSelected={form.valueRevenueSelected === "Yes"}
                                    capitalValue={advancePaymentDetail.actualPaymentCapital ?? ""}
                                    revenueValue={advancePaymentDetail.actualPaymentRevenue ?? ""}
                                    disabled={disabled}
                                    lockFilledFields={lockFilledFields}
                                    lockedValueFilled={
                                      hasFilledValue(
                                        lockedOrder?.advancePaymentDetail?.actualPaymentCapital,
                                      ) ||
                                      hasFilledValue(
                                        lockedOrder?.advancePaymentDetail?.actualPaymentRevenue,
                                      )
                                    }
                                    onChange={(patch) => {
                                      if ("capital" in patch) {
                                        onAdvancePaymentChange(
                                          index,
                                          "actualPaymentCapital",
                                          patch.capital ?? "",
                                        );
                                      }
                                      if ("revenue" in patch) {
                                        onAdvancePaymentChange(
                                          index,
                                          "actualPaymentRevenue",
                                          patch.revenue ?? "",
                                        );
                                      }
                                    }}
                                  />
	                                  );
	                                }
	                                return (
                                <DynamicField
                                  key={key}
                                  field={field}
                                  value={String(advancePaymentDetail[key] ?? "")}
                                  radioName={`supplyOrder-${index}-advance-${key}`}
                                  disabled={
                                    disabled ||
                                    (lockFilledFields && hasFilledValue(String(lockedValue ?? "")))
                                  }
                                  onChange={(value) => onAdvancePaymentChange(index, key, value)}
                                  inputRef={(element) => {
                                    orderFieldRefs.current[`${index}:advance:${key}`] = element;
                                  }}
                                />
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      {stageDeliveries.map((stage, stageIndex) => {
                        const stageMilestones = getStageDeliveryMilestonesForSubview(
                          activeSubview,
                          order,
                        );
                        const stageCompletion = getSingleStageCompletion({
                          activeSubview,
                          stageFields: stageFields ?? [],
                          stage,
                          form,
                          irDisabled: effectiveIrDisabled,
                        });
                        const stagePeriodLabel = getStageDeliveryPeriodRibbonLabel(
                          order,
                          stageDeliveries,
                          stageIndex,
                        );
                        const effectiveStageMilestoneRow = getEffectiveStageFocusRow(
                          stage,
                          order,
                          stageIndex,
                          stageDeliveries,
                        );
                        const stageFocusKey = `stage:${index}:${stageIndex}`;
                        const stageFocusMatch =
                          focusBlockKeySet.has(stageFocusKey) ||
                          (Boolean(focusConfig) &&
                            isStageFocusMatch(
                              stage,
                              focusConfig!,
                              form,
                              order,
                              stageIndex,
                              stageDeliveries,
                            ));
                        return (
                          <details
                            key={stageIndex}
                            ref={(element) => {
                              focusBlockRefs.current[stageFocusKey] = element;
                            }}
                            open={stageFocusMatch || undefined}
                            className={
                              "group overflow-hidden rounded-md border bg-background/70 " +
                              getCompletionBorderClass(stageCompletion.status) +
                              (stageFocusMatch
                                ? " border-primary bg-primary/5 ring-2 ring-primary/40"
                                : "")
                            }
                          >
                            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 text-sm font-semibold marker:hidden">
                              <span
                                className={
                                  "size-2.5 shrink-0 rounded-full " +
                                  getCompletionDotClass(stageCompletion.status)
                                }
                                aria-hidden="true"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">Delivery-{stageIndex + 1}</span>
                                <span className="mt-0.5 block truncate text-xs font-medium text-muted-foreground">
                                  {stagePeriodLabel}
                                </span>
                              </span>
                              <span
                                className={
                                  "rounded-md border px-2 py-1 text-xs font-medium " +
                                  getCompletionBadgeClass(stageCompletion.status)
                                }
                              >
                                {stageCompletion.label}
                                {stageCompletion.total
                                  ? ` ${stageCompletion.filled}/${stageCompletion.total}`
                                  : ""}
                              </span>
                              <span className="text-xs font-medium text-muted-foreground group-open:hidden">
                                Open
                              </span>
                              <span className="hidden text-xs font-medium text-muted-foreground group-open:inline">
                                Close
                              </span>
                            </summary>
                            <div className="grid grid-cols-1 gap-4 border-t border-border p-4">
                              {stageMilestones.length ? (
                                <SupplyOrderMilestonesBlock
                                  title="Delivery milestone"
                                  milestones={stageMilestones}
                                  order={effectiveStageMilestoneRow}
                                  disabled={disabled}
                                  lockFilledFields={lockFilledFields}
                                  lockedOrder={lockedOrder?.stageDeliveries?.[stageIndex]}
                                  fileType={form.fileType}
                                  onCurrentChange={(milestone) =>
                                    onStageCurrentMilestoneChange(index, stageIndex, milestone)
                                  }
                                  onCompletedChange={(milestones) =>
                                    onStageCompletedMilestonesChange(index, stageIndex, milestones)
                                  }
                                />
                              ) : null}
                              {(stageFields ?? []).map((key) => {
                                if (!shouldShowStageDeliveryField(activeSubview, key)) {
                                  return null;
                                }
                                const field = stageDeliveryFields.find((item) => item.key === key);
                                if (!field) return null;
                                const lockedValue =
                                  lockedOrder?.stageDeliveries?.[stageIndex]?.[key];
                                if (key === "stageAmountCapital") {
                                  return (
                                    <AmountByValueTypeField
                                      key={key}
                                      label="Stage amount"
                                      capitalSelected={form.valueCapitalSelected === "Yes"}
                                      revenueSelected={form.valueRevenueSelected === "Yes"}
                                      capitalValue={stage.stageAmountCapital ?? ""}
                                      revenueValue={stage.stageAmountRevenue ?? ""}
                                      disabled={disabled}
                                      lockFilledFields={lockFilledFields}
                                      lockedValueFilled={
                                        hasFilledValue(
                                          lockedOrder?.stageDeliveries?.[stageIndex]
                                            ?.stageAmountCapital,
                                        ) ||
                                        hasFilledValue(
                                          lockedOrder?.stageDeliveries?.[stageIndex]
                                            ?.stageAmountRevenue,
                                        )
                                      }
                                      onChange={(patch) => {
                                        if ("capital" in patch) {
                                          onStageDeliveryChange(
                                            index,
                                            stageIndex,
                                            "stageAmountCapital",
                                            patch.capital ?? "",
                                          );
                                        }
                                        if ("revenue" in patch) {
                                          onStageDeliveryChange(
                                            index,
                                            stageIndex,
                                            "stageAmountRevenue",
                                            patch.revenue ?? "",
                                          );
                                        }
                                      }}
                                    />
                                  );
                                }
                                if (key === "actualPaymentCapital") {
                                  return (
                                    <AmountByValueTypeField
                                      key={key}
                                      label="Actual payment amount"
                                      capitalSelected={form.valueCapitalSelected === "Yes"}
                                      revenueSelected={form.valueRevenueSelected === "Yes"}
                                      capitalValue={stage.actualPaymentCapital ?? ""}
                                      revenueValue={stage.actualPaymentRevenue ?? ""}
                                      disabled={disabled}
                                      lockFilledFields={lockFilledFields}
                                      lockedValueFilled={
                                        hasFilledValue(
                                          lockedOrder?.stageDeliveries?.[stageIndex]
                                            ?.actualPaymentCapital,
                                        ) ||
                                        hasFilledValue(
                                          lockedOrder?.stageDeliveries?.[stageIndex]
                                            ?.actualPaymentRevenue,
                                        )
                                      }
                                      onChange={(patch) => {
                                        if ("capital" in patch) {
                                          onStageDeliveryChange(
                                            index,
                                            stageIndex,
                                            "actualPaymentCapital",
                                            patch.capital ?? "",
                                          );
                                        }
                                        if ("revenue" in patch) {
                                          onStageDeliveryChange(
                                            index,
                                            stageIndex,
                                            "actualPaymentRevenue",
                                            patch.revenue ?? "",
                                          );
                                        }
                                      }}
                                    />
                                  );
                                }
                                if (key === "ld") {
                                  const detailLocked =
                                    hasFilledValue(
                                      lockedOrder?.stageDeliveries?.[stageIndex]?.ldType,
                                    ) ||
                                    hasFilledValue(
                                      lockedOrder?.stageDeliveries?.[stageIndex]?.ldPercentage,
                                    );
                                  return (
                                    <Fragment key={key}>
                                      <DynamicField
                                        field={field}
                                        value={String(stage[key] ?? "")}
                                        radioName={`supplyOrder-${index}-stage-${stageIndex}-${key}`}
                                        disabled={
                                          disabled ||
                                          (lockFilledFields &&
                                            hasFilledValue(String(lockedValue ?? ""))) ||
                                          isDpExtensionFieldInactive(form, key)
                                        }
                                        onChange={(value) =>
                                          onStageDeliveryChange(index, stageIndex, key, value)
                                        }
                                        inputRef={(element) => {
                                          orderFieldRefs.current[
                                            `${index}:stage:${stageIndex}:${key}`
                                          ] = element;
                                        }}
                                      />
                                      {isYes(stage.ld ?? "") ? (
                                        <LdDetailField
                                          ldType={stage.ldType ?? ""}
                                          ldPercentage={stage.ldPercentage ?? ""}
                                          disabled={disabled || (lockFilledFields && detailLocked)}
                                          onTypeChange={(value) =>
                                            onStageDeliveryChange(index, stageIndex, "ldType", value)
                                          }
                                          onPercentageChange={(value) =>
                                            onStageDeliveryChange(
                                              index,
                                              stageIndex,
                                              "ldPercentage",
                                              value,
                                            )
                                          }
                                        />
                                      ) : null}
                                    </Fragment>
                                  );
                                }
                                return (
                                  <DynamicField
                                    key={key}
                                    field={field}
                                    value={String(stage[key] ?? "")}
                                    radioName={`supplyOrder-${index}-stage-${stageIndex}-${key}`}
                                    disabled={
                                      disabled ||
                                      (lockFilledFields &&
                                        hasFilledValue(String(lockedValue ?? ""))) ||
                                      isDpExtensionFieldInactive(form, key) ||
                                      (effectiveIrDisabled &&
                                        (supplyOrderIrDisabledKeys as readonly string[]).includes(
                                          key,
                                        ))
                                    }
                                    onChange={(value) =>
                                      onStageDeliveryChange(index, stageIndex, key, value)
                                    }
                                    inputRef={(element) => {
                                      orderFieldRefs.current[
                                        `${index}:stage:${stageIndex}:${key}`
                                      ] = element;
                                    }}
                                  />
                                );
                              })}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {fieldsToRender.map((field) => {
                        const key = field.key as SupplyOrderKey;
                        const sequentiallyLocked = isSupplyOrderFieldSequentiallyLocked(
                          key,
                          order,
                        );
                        const renderedField =
                          key === "firmType"
                            ? {
                                ...field,
                                options: mergeOptions(firmTypeOptions, order.firmType),
                              }
                            : field;

                        if (field.key === "soValueCapital") {
                          return (
                            <SoValueField
                              key={field.key}
                              capitalSelected={form.valueCapitalSelected === "Yes"}
                              revenueSelected={form.valueRevenueSelected === "Yes"}
                              capitalValue={order.soValueCapital ?? ""}
                              revenueValue={order.soValueRevenue ?? ""}
                              disabled={disabled || sequentiallyLocked}
                              lockFilledFields={lockFilledFields}
                              lockedValueFilled={
                                hasFilledValue(lockedOrder?.soValueCapital) ||
                                hasFilledValue(lockedOrder?.soValueRevenue)
                              }
                              onChange={(patch) => {
                                if ("soValueCapital" in patch) {
                                  onOrderChange(
                                    index,
                                    "soValueCapital",
                                    patch.soValueCapital ?? "",
                                  );
                                }
                                if ("soValueRevenue" in patch) {
                                  onOrderChange(
                                    index,
                                    "soValueRevenue",
                                    patch.soValueRevenue ?? "",
                                  );
                                }
                              }}
                            />
                          );
                        }

	                        if (field.key === "actualPaymentCapital") {
	                          return (
	                            <AmountByValueTypeField
                              key={field.key}
                              label="Actual payment amount"
                              capitalSelected={form.valueCapitalSelected === "Yes"}
                              revenueSelected={form.valueRevenueSelected === "Yes"}
                              capitalValue={order.actualPaymentCapital ?? ""}
                              revenueValue={order.actualPaymentRevenue ?? ""}
                              disabled={disabled || sequentiallyLocked}
                              lockFilledFields={lockFilledFields}
                              lockedValueFilled={
                                hasFilledValue(lockedOrder?.actualPaymentCapital) ||
                                hasFilledValue(lockedOrder?.actualPaymentRevenue)
                              }
                              onChange={(patch) => {
                                if ("capital" in patch) {
                                  onOrderChange(index, "actualPaymentCapital", patch.capital ?? "");
                                }
                                if ("revenue" in patch) {
                                  onOrderChange(index, "actualPaymentRevenue", patch.revenue ?? "");
                                }
                              }}
                            />
	                          );
	                        }
	
	                        if (field.key === "ld") {
	                          const detailLocked =
	                            hasFilledValue(lockedOrder?.ldType) ||
	                            hasFilledValue(lockedOrder?.ldPercentage);
	                          return (
	                            <Fragment key={field.key}>
	                              <DynamicField
	                                field={renderedField}
	                                value={String(order[key] ?? "")}
	                                radioName={`supplyOrder-${index}-${field.key}`}
	                                disabled={
	                                  disabled ||
                                    sequentiallyLocked ||
	                                  (lockFilledFields &&
	                                    hasFilledValue(String(lockedOrder?.[key] ?? ""))) ||
	                                  isDpExtensionFieldInactive(form, key)
	                                }
	                                onChange={(value) => onOrderChange(index, key, value)}
	                                inputRef={(element) => {
	                                  orderFieldRefs.current[`${index}:${key}`] = element;
	                                }}
	                              />
	                              {isYes(order.ld ?? "") ? (
	                                <LdDetailField
	                                  ldType={order.ldType ?? ""}
	                                  ldPercentage={order.ldPercentage ?? ""}
	                                  disabled={
                                      disabled ||
                                      sequentiallyLocked ||
                                      (lockFilledFields && detailLocked)
                                    }
	                                  onTypeChange={(value) => onOrderChange(index, "ldType", value)}
	                                  onPercentageChange={(value) =>
	                                    onOrderChange(index, "ldPercentage", value)
	                                  }
	                                />
	                              ) : null}
	                            </Fragment>
	                          );
	                        }
	
	                        return (
                          <DynamicField
                            key={field.key}
                            field={renderedField}
                            value={String(order[key] ?? "")}
                            radioName={`supplyOrder-${index}-${field.key}`}
                            disabled={
                              disabled ||
                              sequentiallyLocked ||
                              (lockFilledFields &&
                                hasFilledValue(String(lockedOrder?.[key] ?? ""))) ||
                              (gemDisabled && key === "gemSoNo") ||
                              (bgDisabled && supplyOrderBgDisabledKeys.includes(key)) ||
                              (effectiveIrDisabled && supplyOrderIrDisabledKeys.includes(key)) ||
                              isDpExtensionFieldInactive(form, key)
                            }
                            onChange={(value) => onOrderChange(index, key, value)}
                            inputRef={(element) => {
                              orderFieldRefs.current[`${index}:${key}`] = element;
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </details>
            );
          })
        : null}
    </div>
  );
}

type SupplyOrderFocusConfig = {
  kind: string;
  state: string;
  subview: SupplyOrderSubviewKey;
  orderIndex?: number;
  stageIndex?: number;
};

type SupplyOrderFocusRow = Partial<SupplyOrderDetail & StageDeliveryDetail & AdvancePaymentDetail>;

function parseSupplyOrderFocusTarget(target: string | undefined): SupplyOrderFocusConfig | undefined {
  if (!target) return undefined;
  const [rawKind = "", rawState = "", rawOrderIndex = "", rawStageIndex = ""] = target.split(":");
  const kind = normalizeMilestoneName(rawKind);
  const state = normalizeStatusStage(rawState || "current");
  const subview = getSupplyOrderFocusSubview(kind, state);
  if (!subview) return undefined;
  const orderIndex = parseFocusIndex(rawOrderIndex);
  const stageIndex = parseFocusIndex(rawStageIndex);
  return {
    kind,
    state,
    subview,
    orderIndex,
    stageIndex,
  };
}

function parseFocusIndex(value: string) {
  if (!value.trim()) return undefined;
  const index = Number.parseInt(value, 10);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

function getSupplyOrderFocusSubview(kind: string, state = ""): SupplyOrderSubviewKey | undefined {
  if (kind === "financialsanction" || kind === "supplyorder") return "supplyOrder";
  if (kind === "stagedelivery" || kind === "stagepayment") return "supplyOrder";
  if (kind === "advancepayment" && state === "yes") return "supplyOrder";
  if (kind === "bankguarantee") return "bg";
  if (kind === "deliveryperiod" || kind === "dpextension" || kind === "ld") return "dp";
  if (kind === "delivery" || kind === "irpreparation" || kind === "irreceipt") return "delivery";
  if (kind === "socancelled") return "miscellaneous";
  if (
    kind === "billpreparation" ||
    kind === "billsentforpayment" ||
    kind === "payment" ||
    kind === "advancepayment" ||
    kind === "actualpayment"
  ) {
    return "payment";
  }
  return undefined;
}

function getSupplyOrderFocusKeys(
  orders: SupplyOrderDetail[],
  config: SupplyOrderFocusConfig,
  form: FormState,
) {
  const keys: string[] = [];
  for (const [orderIndex, order] of orders.entries()) {
    if (config.orderIndex !== undefined && config.orderIndex !== orderIndex) continue;
    const stageDeliveries = resizeStageDeliveries(
      order.stageDeliveries ?? [],
      getStageDeliveryCount(order.stageDeliveryCount),
    );
    const useStageCards =
      isYes(order.stageDelivery ?? "") &&
      (config.subview !== "payment" || isYes(order.stagePayment ?? ""));
    const advancePaymentDetail = applyAdvancePaymentRules(order.advancePaymentDetail ?? {});

    if (
      isYes(order.stagePayment ?? "") &&
      isYes(order.advancePayment ?? "") &&
      isAdvancePaymentFocusMatch(advancePaymentDetail, config, form)
    ) {
      keys.push(`advance:${orderIndex}`);
    }

    if (useStageCards) {
      stageDeliveries.forEach((stage, stageIndex) => {
        if (config.stageIndex !== undefined && config.stageIndex !== stageIndex) return;
        if (config.stageIndex !== undefined && isStageDrivenFocusKind(config.kind)) {
          keys.push(`stage:${orderIndex}:${stageIndex}`);
          return;
        }
        if (isStageFocusMatch(stage, config, form, order, stageIndex, stageDeliveries)) {
          keys.push(`stage:${orderIndex}:${stageIndex}`);
        }
      });
    }

    if (config.orderIndex !== undefined && config.stageIndex === undefined) {
      keys.push(`order:${orderIndex}`);
      continue;
    }

    if (
      config.stageIndex === undefined &&
      isSupplyOrderFocusMatch(order, config, form, { useStageCards })
    ) {
      keys.push(`order:${orderIndex}`);
    }
  }
  return keys;
}

function isSupplyOrderFocusMatch(
  order: SupplyOrderDetail,
  config: SupplyOrderFocusConfig,
  form: FormState,
  options: { useStageCards: boolean },
) {
  if (isStageDrivenFocusKind(config.kind) && options.useStageCards) return false;
  return isFocusRowMatch(order, config, form);
}

function isStageFocusMatch(
  stage: StageDeliveryDetail,
  config: SupplyOrderFocusConfig,
  form: FormState,
  parentOrder?: SupplyOrderDetail,
  stageIndex = 0,
  siblingStages: StageDeliveryDetail[] = [],
) {
  if (!isStageDrivenFocusKind(config.kind)) return false;
  return isFocusRowMatch(
    getEffectiveStageFocusRow(stage, parentOrder, stageIndex, siblingStages),
    config,
    form,
  );
}

function isAdvancePaymentFocusMatch(
  payment: AdvancePaymentDetail,
  config: SupplyOrderFocusConfig,
  form: FormState,
) {
  if (config.kind !== "payment" && config.kind !== "advancepayment") return false;
  if (config.kind === "advancepayment" && config.state === "yes") return false;
  return isFocusRowMatch(payment, config, form);
}

function isStageDrivenFocusKind(kind: string) {
  return [
    "deliveryperiod",
    "delivery",
    "irpreparation",
    "irreceipt",
    "billpreparation",
    "billsentforpayment",
    "payment",
    "actualpayment",
    "dpextension",
    "ld",
  ].includes(kind);
}

function getEffectiveStageFocusRow(
  stage: StageDeliveryDetail,
  parentOrder: SupplyOrderDetail | undefined,
  stageIndex: number,
  siblingStages: StageDeliveryDetail[],
): SupplyOrderFocusRow {
  if (!parentOrder) return stage;
  const useStagePayment = isYes(parentOrder.stagePayment);
  const useCommonPayment = !useStagePayment && stageIndex === siblingStages.length - 1;
  const previousStage = stageIndex > 0 ? siblingStages[stageIndex - 1] : undefined;
  const previousDeliveryPeriodDate = previousStage
    ? getLaterDate(previousStage.dpDate, previousStage.revisedDp)
    : undefined;

  return {
    ...parentOrder,
    ...stage,
    soDate: parentOrder.soDate,
    deliveryPeriodStartDate:
      stage.deliveryPeriodStartDate ||
      (stageIndex === 0
        ? parentOrder.soDate
        : getNextLocalDate(previousDeliveryPeriodDate) || parentOrder.soDate),
    currentMilestone: stage.currentMilestone ?? "",
    completedMilestones: stage.completedMilestones ?? [],
    billPreparationDate: useStagePayment
      ? (stage.billPreparationDate ?? "")
      : useCommonPayment
        ? parentOrder.billPreparationDate
        : "",
    billSentForPaymentDate: useStagePayment
      ? (stage.billSentForPaymentDate ?? "")
      : useCommonPayment
        ? parentOrder.billSentForPaymentDate
        : "",
    paymentDate: useStagePayment
      ? (stage.paymentDate ?? "")
      : useCommonPayment
        ? parentOrder.paymentDate
        : "",
    paymentMode: useStagePayment
      ? (stage.paymentMode ?? "")
      : useCommonPayment
        ? parentOrder.paymentMode
        : "",
    actualPaymentCapital: useStagePayment
      ? (stage.actualPaymentCapital ?? "")
      : useCommonPayment
        ? parentOrder.actualPaymentCapital || parentOrder.soValueCapital
        : "",
    actualPaymentRevenue: useStagePayment
      ? (stage.actualPaymentRevenue ?? "")
      : useCommonPayment
        ? parentOrder.actualPaymentRevenue || parentOrder.soValueRevenue
        : "",
  };
}

function isFocusRowMatch(row: SupplyOrderFocusRow, config: SupplyOrderFocusConfig, form: FormState) {
  const completed = isFocusMilestoneCompleted(row, config.kind);
  const current = normalizeMilestoneName(String(row.currentMilestone ?? "")) === config.kind;
  const state = config.state;

  if (config.kind === "supplyorder") {
    if (state === "any") return true;
    if (state === "live") {
      return hasFilledValue(row.soDate) && !hasFilledValue(row.paymentDate);
    }
    if (state === "completed" || state === "placed") return completed || hasFilledValue(row.soDate);
    return current || !hasFilledValue(row.soDate);
  }

  if (config.kind === "financialsanction") {
    if (state === "completed") return completed || hasFilledValue(row.financialSanctionDate);
    return current || !hasFilledValue(row.financialSanctionDate);
  }

  if (config.kind === "stagedelivery") {
    return isYes(row.stageDelivery ?? "");
  }

  if (config.kind === "stagepayment") {
    return isYes(row.stagePayment ?? "");
  }

  if (config.kind === "advancepayment" && state === "yes") {
    return isYes(row.advancePayment ?? "");
  }

  if (config.kind === "bankguarantee") {
    if (state === "received" || state === "completed") return completed || hasFilledValue(row.bgValidityDate);
    if (state === "expired") {
      const effectiveDp = getLaterDate(row.dpDate, row.revisedDp);
      return (
        (completed || hasFilledValue(row.bgValidityDate)) &&
        !hasFilledValue(row.bgReturnDate) &&
        !hasFilledValue(row.paymentDate) &&
        hasFilledValue(row.bgValidityDate) &&
        hasFilledValue(effectiveDp) &&
        String(row.bgValidityDate) < effectiveDp! &&
        String(row.bgValidityDate) < formatLocalDate(new Date())
      );
    }
    if (state === "tobereturned") {
      return (
        (completed || hasFilledValue(row.bgValidityDate)) &&
        !hasFilledValue(row.bgReturnDate) &&
        (isYes(row.soCancelled) ||
          (hasFilledValue(row.paymentDate) &&
            hasFilledValue(row.bgValidityDate) &&
            (isYes(form.psb) || String(row.bgValidityDate) < formatLocalDate(new Date()))))
      );
    }
    return current || (hasFilledValue(row.soDate) && !hasFilledValue(row.bgValidityDate));
  }

  if (config.kind === "deliveryperiod") {
    const effectiveDp = getLaterDate(row.dpDate, row.revisedDp);
    if (state === "pending") {
      return hasFilledValue(effectiveDp) && !hasFilledValue(row.materialReceiptDate);
    }
    if (state === "extended") return hasFilledValue(row.revisedDp);
    if (state === "expired" || state === "overdue") {
      return hasFilledValue(effectiveDp) && !hasFilledValue(row.materialReceiptDate) && effectiveDp! < formatLocalDate(new Date());
    }
    return (
      hasFilledValue(effectiveDp) &&
      !hasFilledValue(row.revisedDp) &&
      !hasFilledValue(row.materialReceiptDate) &&
      effectiveDp! >= formatLocalDate(new Date())
    );
  }

  if (config.kind === "dpextension") {
    return isYes(row.dpExtension ?? "");
  }

  if (config.kind === "ld") {
    return isYes(row.ld ?? "");
  }

  if (config.kind === "delivery") {
    if (state === "completed" || state === "received") return completed || hasFilledValue(row.materialReceiptDate);
    if (state === "overdue") {
      const effectiveDp = getLaterDate(row.dpDate, row.revisedDp);
      return hasFilledValue(effectiveDp) && !hasFilledValue(row.materialReceiptDate) && effectiveDp! < formatLocalDate(new Date());
    }
    return getDerivedDeliveryMilestoneState(row, form.fileType).current;
  }

  if (config.kind === "irpreparation") {
    if (isNo(form.ir)) return false;
    if (state === "completed") return completed || hasFilledValue(row.irPreparationDate);
    return (
      current ||
      (hasFilledValue(row.materialReceiptDate) && !hasFilledValue(row.irPreparationDate))
    );
  }

  if (config.kind === "irreceipt") {
    if (isNo(form.ir)) return false;
    if (state === "completed") return completed || hasFilledValue(row.irReceiptDate);
    return current || (hasFilledValue(row.irPreparationDate) && !hasFilledValue(row.irReceiptDate));
  }

  if (config.kind === "billpreparation") {
    if (state === "completed") return completed || hasFilledValue(row.billPreparationDate);
    return (
      current ||
      (hasFilledValue(row.materialReceiptDate) && !hasFilledValue(row.billPreparationDate))
    );
  }

  if (config.kind === "billsentforpayment") {
    if (state === "completed") return completed || hasFilledValue(row.billSentForPaymentDate);
    return (
      current ||
      (hasFilledValue(row.billPreparationDate) && !hasFilledValue(row.billSentForPaymentDate))
    );
  }

  if (config.kind === "advancepayment") {
    if (state === "completed" || state === "paid" || state === "actual") {
      return completed || hasFilledValue(row.paymentDate);
    }
    return (
      normalizeMilestoneName(String(row.currentMilestone ?? "")) === "advancepayment" &&
      !hasFilledValue(row.paymentDate)
    );
  }

  if (config.kind === "payment") {
    if (state === "completed" || state === "paid" || state === "actual") {
      return completed || hasFilledValue(row.paymentDate);
    }
    return hasPaymentWorkflowStarted(row) && !hasFilledValue(row.paymentDate);
  }

  if (config.kind === "actualpayment") {
    return hasNonZeroAmount(row.actualPaymentCapital) || hasNonZeroAmount(row.actualPaymentRevenue);
  }

  if (config.kind === "socancelled") {
    return isYes(row.soCancelled ?? "");
  }

  return false;
}

function isFocusMilestoneCompleted(row: SupplyOrderFocusRow, kind: string) {
  const dateKey = supplyOrderMilestoneNames.find(
    (milestone) => normalizeMilestoneName(milestone) === kind,
  );
  const completedByDate = dateKey
    ? hasFilledValue((row as Record<string, unknown>)[supplyOrderMilestoneDateKeys[dateKey]])
    : false;
  const completedByManualMilestone = normalizeCompletedMilestones(row.completedMilestones).some(
    (milestone) => normalizeMilestoneName(milestone) === kind,
  );
  return completedByDate || completedByManualMilestone;
}

function hasPaymentWorkflowStarted(row: SupplyOrderFocusRow) {
  return (
    hasFilledValue(row.materialReceiptDate) ||
    hasFilledValue(row.billPreparationDate) ||
    hasFilledValue(row.billSentForPaymentDate)
  );
}

type SupplyOrderCompletionStatus = "empty" | "partial" | "complete";

type CompletionCount = {
  filled: number;
  total: number;
};

function getSupplyOrderSubviewCompletion({
  activeSubview,
  order,
  fieldsToRender,
  form,
  gemDisabled,
  bgDisabled,
  irDisabled,
}: {
  activeSubview: SupplyOrderSubviewKey;
  order: SupplyOrderDetail;
  fieldsToRender: ExtraField<SupplyOrderKey>[];
  form: FormState;
  gemDisabled: boolean;
  bgDisabled: boolean;
  irDisabled: boolean;
}) {
  const stageFields = getStagedDeliverySubviewFields(activeSubview);
  const useStageFields = Boolean(stageFields && isYes(order.stageDelivery ?? ""));
  const useStageCards =
    useStageFields && (activeSubview !== "payment" || isYes(order.stagePayment ?? ""));
  const stageDeliveries = resizeStageDeliveries(
    order.stageDeliveries ?? [],
    getStageDeliveryCount(order.stageDeliveryCount),
  );

  const counts = useStageCards
    ? getStageCompletionCount({
        activeSubview,
        order,
        stageFields: stageFields ?? [],
        stageDeliveries,
        form,
        irDisabled,
      })
    : fieldsToRender.reduce<CompletionCount>(
        (current, field) =>
          addSupplyOrderFieldCompletion(current, {
            order,
            field,
            form,
            gemDisabled,
            bgDisabled,
            irDisabled,
          }),
        { filled: 0, total: 0 },
      );

  const status = getCompletionStatus(counts);
  return {
    ...counts,
    status,
    label: status === "complete" ? "Complete" : status === "partial" ? "Partial" : "Empty",
  };
}

function getStageCompletionCount({
  activeSubview,
  order,
  stageFields,
  stageDeliveries,
  form,
  irDisabled,
}: {
  activeSubview: SupplyOrderSubviewKey;
  order: SupplyOrderDetail;
  stageFields: readonly StageDeliveryKey[];
  stageDeliveries: StageDeliveryDetail[];
  form: FormState;
  irDisabled: boolean;
}) {
  let counts: CompletionCount = { filled: 0, total: 0 };

  if (activeSubview === "payment" && isYes(order.advancePayment ?? "")) {
    const advance = applyAdvancePaymentRules(order.advancePaymentDetail ?? {});
    counts = advancePaymentFields.reduce(
      (current, field) =>
        addNestedPaymentFieldCompletion(current, field.key, advance, form, "advance"),
      counts,
    );
  }

  return stageDeliveries.reduce(
    (stageCounts, stage) =>
      stageFields.reduce((fieldCounts, key) => {
        if (irDisabled && (supplyOrderIrDisabledKeys as readonly string[]).includes(key)) {
          return fieldCounts;
        }
        return addNestedPaymentFieldCompletion(fieldCounts, key, stage, form, "stage");
      }, stageCounts),
    counts,
  );
}

function getSingleStageCompletion({
  activeSubview,
  stageFields,
  stage,
  form,
  irDisabled,
}: {
  activeSubview: SupplyOrderSubviewKey;
  stageFields: readonly StageDeliveryKey[];
  stage: StageDeliveryDetail;
  form: FormState;
  irDisabled: boolean;
}) {
  const counts = stageFields.reduce<CompletionCount>(
    (fieldCounts, key) => {
      if (irDisabled && (supplyOrderIrDisabledKeys as readonly string[]).includes(key)) {
        return fieldCounts;
      }
      if (!shouldShowStageDeliveryField(activeSubview, key)) return fieldCounts;
      return addNestedPaymentFieldCompletion(fieldCounts, key, stage, form, "stage");
    },
    { filled: 0, total: 0 },
  );
  const status = getCompletionStatus(counts);
  return {
    ...counts,
    status,
    label: status === "complete" ? "Complete" : status === "partial" ? "Partial" : "Empty",
  };
}

function shouldShowStageDeliveryField(activeSubview: SupplyOrderSubviewKey, key: StageDeliveryKey) {
  if (activeSubview !== "payment") return true;
  return [
    "stageAmountCapital",
    "billPreparationDate",
    "billSentForPaymentDate",
    "paymentDate",
    "paymentMode",
    "actualPaymentCapital",
  ].includes(key);
}

function getStageDeliveryMilestonesForSubview(
  activeSubview: SupplyOrderSubviewKey,
  order: SupplyOrderDetail,
) {
  if (activeSubview === "delivery") {
    return getApplicableSupplyOrderMilestones(order, {
      bgDisabled: true,
      irDisabled: false,
    }).filter((milestone) => supplyOrderSubviewMilestones.delivery.includes(milestone));
  }
  if (activeSubview === "payment" && isYes(order.stagePayment ?? "")) {
    return supplyOrderSubviewMilestones.payment;
  }
  return [];
}

function addSupplyOrderFieldCompletion(
  counts: CompletionCount,
  {
    order,
    field,
    form,
    gemDisabled,
    bgDisabled,
    irDisabled,
  }: {
    order: SupplyOrderDetail;
    field: ExtraField<SupplyOrderKey>;
    form: FormState;
    gemDisabled: boolean;
    bgDisabled: boolean;
    irDisabled: boolean;
  },
) {
  const key = field.key as SupplyOrderKey;
  if (
    (key === "firmTypeOther" && (order.firmType ?? "").trim().toUpperCase() !== "OTHER") ||
    isOptionalDpCompletionField(key) ||
    (gemDisabled && key === "gemSoNo") ||
    (bgDisabled && supplyOrderBgDisabledKeys.includes(key)) ||
    (irDisabled && supplyOrderIrDisabledKeys.includes(key))
  ) {
    return counts;
  }

  if (key === "soValueCapital") {
    return addAmountCompletion(counts, order.soValueCapital, order.soValueRevenue, form);
  }
  if (key === "actualPaymentCapital") {
    return addAmountCompletion(
      counts,
      order.actualPaymentCapital,
      order.actualPaymentRevenue,
      form,
    );
  }

  return addSingleCompletion(counts, hasMeaningfulSupplyOrderValue(key, String(order[key] ?? "")));
}

function addNestedPaymentFieldCompletion(
  counts: CompletionCount,
  key: StageDeliveryKey | AdvancePaymentKey,
  row: StageDeliveryDetail | AdvancePaymentDetail,
  form: FormState,
  amountKind: "stage" | "advance",
) {
  if (isOptionalDpCompletionField(key)) return counts;
  if (key === "stageAmountCapital") {
    return addAmountCompletion(counts, row.stageAmountCapital, row.stageAmountRevenue, form);
  }
  if (key === "actualPaymentCapital") {
    return addAmountCompletion(counts, row.actualPaymentCapital, row.actualPaymentRevenue, form);
  }
  const value = (row as Record<string, string | undefined>)[key];
  return addSingleCompletion(
    counts,
    hasMeaningfulSupplyOrderValue(key, String(value ?? ""), amountKind),
  );
}

function isOptionalDpCompletionField(key: string) {
  return ["dpExtension", "dpExtensionCount", "ld", "revisedDp"].includes(key);
}

function addAmountCompletion(
  counts: CompletionCount,
  capitalValue: string | undefined,
  revenueValue: string | undefined,
  form: FormState,
) {
  const capitalSelected = form.valueCapitalSelected === "Yes";
  const revenueSelected = form.valueRevenueSelected === "Yes";
  if (!capitalSelected && !revenueSelected) {
    return addSingleCompletion(
      counts,
      hasFilledValue(capitalValue) || hasFilledValue(revenueValue),
    );
  }

  let next = counts;
  if (capitalSelected) next = addSingleCompletion(next, hasFilledValue(capitalValue));
  if (revenueSelected) next = addSingleCompletion(next, hasFilledValue(revenueValue));
  return next;
}

function addSingleCompletion(counts: CompletionCount, filled: boolean) {
  return {
    filled: counts.filled + (filled ? 1 : 0),
    total: counts.total + 1,
  };
}

function getCompletionStatus({ filled, total }: CompletionCount): SupplyOrderCompletionStatus {
  if (!total || filled === 0) return "empty";
  if (filled === total) return "complete";
  return "partial";
}

function hasMeaningfulSupplyOrderValue(
  key: string,
  value: string,
  amountKind?: "stage" | "advance",
) {
  const normalized = value.trim();
  if (!normalized) return false;
  if (["dpExtension", "ld", "soCancelled"].includes(key)) {
    return isYes(normalized);
  }
  if (["stageDelivery", "stagePayment", "advancePayment"].includes(key)) {
    return isYes(normalized) || isNo(normalized);
  }
  if (amountKind && key === "paymentMode") return hasFilledValue(normalized);
  return true;
}

function getSupplyOrderDisplayTitle(order: SupplyOrderDetail, index: number) {
  return order.soNo?.trim() || order.gemSoNo?.trim() || `Supply Order ${index + 1}`;
}

function getSupplyOrderDisplaySummary(order: SupplyOrderDetail, fileType: string) {
  const stageDpLabel = getStageDpRibbonLabel(order, fileType);
  return [
    order.firm,
    order.soDate ? `S.O. date ${order.soDate}` : "",
    order.dpDate ? `D.P. ${order.dpDate}` : "",
    stageDpLabel,
  ]
    .filter(Boolean)
    .join(" | ");
}

function getStageDpRibbonLabel(order: SupplyOrderDetail, fileType: string) {
  if (!isStageDeliveryFileType(fileType) || !isYes(order.stageDelivery)) return "";
  const stageCount = getStageDeliveryCount(order.stageDeliveryCount);
  if (stageCount <= 1 || !order.stageDeliveries?.length) return "";
  const stages = resizeStageDeliveries(order.stageDeliveries, stageCount);
  const lastStage = stages.at(-1);
  const date = formatRibbonDate(getLaterDate(lastStage?.dpDate, lastStage?.revisedDp));
  return isDpExpiryWordHiddenFileType(fileType) ? `D.P. ${date}` : `D.P. expiry ${date}`;
}

function getCompletionBorderClass(status: SupplyOrderCompletionStatus) {
  if (status === "complete") return "border-success/70";
  if (status === "partial") return "border-destructive/70";
  return "border-warning/70";
}

function getCompletionDotClass(status: SupplyOrderCompletionStatus) {
  if (status === "complete") return "bg-success";
  if (status === "partial") return "bg-destructive";
  return "bg-warning";
}

function getCompletionBadgeClass(status: SupplyOrderCompletionStatus) {
  if (status === "complete") return "border-success/40 bg-success/10 text-success";
  if (status === "partial") return "border-destructive/40 bg-destructive/10 text-destructive";
  return "border-warning/40 bg-warning/10 text-warning";
}

type MilestoneRowState = {
  currentMilestone?: string;
  completedMilestones?: string[];
  [key: string]: unknown;
};

function getDerivedDeliveryMilestoneState(row: MilestoneRowState, fileType?: string) {
  const periodTrackingOnly = isStageDeliveryFileType(fileType);
  const completed =
    !periodTrackingOnly &&
    (hasFilledValue(String(row.materialReceiptDate ?? "")) ||
      normalizeCompletedMilestones(row.completedMilestones).some(
        (milestone) => normalizeMilestoneName(milestone) === "delivery",
      ));
  const effectiveDp = getLaterDate(
    String(row.dpDate ?? "") || undefined,
    String(row.revisedDp ?? "") || undefined,
  );
  const startDate = String(row.deliveryPeriodStartDate ?? row.soDate ?? "");
  const today = formatLocalDate(new Date());
  const current =
    !completed &&
    !isYes(String(row.soCancelled ?? "")) &&
    hasFilledValue(String(row.soDate ?? "")) &&
    hasFilledValue(startDate) &&
    hasFilledValue(effectiveDp) &&
    startDate <= today &&
    effectiveDp! >= today;
  return { current, completed };
}

function SupplyOrderMilestonesBlock({
  title = "Order milestone",
  milestones,
  order,
  lockedOrder,
  fileType,
  disabled,
  lockFilledFields,
  onCurrentChange,
  onCompletedChange,
}: {
  title?: string;
  milestones: SupplyOrderMilestoneName[];
  order: MilestoneRowState;
  lockedOrder: MilestoneRowState | undefined;
  fileType?: string;
  disabled: boolean;
  lockFilledFields: boolean;
  onCurrentChange: (milestone: string) => void;
  onCompletedChange: (milestones: string[]) => void;
}) {
  const completedSet = new Set(normalizeCompletedMilestones(order.completedMilestones));
  const lockedCompletedSet = new Set(
    normalizeCompletedMilestones(lockedOrder?.completedMilestones),
  );

  const toggleCompleted = (milestone: string) => {
    if (disabled) return;
    const next = new Set(completedSet);
    if (next.has(milestone)) {
      next.delete(milestone);
    } else {
      next.add(milestone);
    }
    onCompletedChange(
      mergeVisibleSupplyOrderCompletedMilestones(
        order.completedMilestones,
        milestones,
        milestones.filter((item) => next.has(item)),
      ),
    );
  };

  return (
    <div className="mb-4 overflow-hidden rounded-md border border-border bg-background/70">
      <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] border-b border-border bg-secondary/35 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
        <div>{title}</div>
        <div className="text-center">Current</div>
        <div className="text-center">Done</div>
      </div>
      {milestones.map((milestone) => {
        const derivedDelivery = getDerivedDeliveryMilestoneState(order, fileType);
        const isDeliveryMilestone = milestone === "Delivery";
        const isCurrent = isDeliveryMilestone
          ? derivedDelivery.current
          : order.currentMilestone === milestone;
        const isCompleted = isDeliveryMilestone
          ? derivedDelivery.completed
          : completedSet.has(milestone);
        const dateKey = supplyOrderMilestoneDateKeys[milestone];
        const lockedValueFilled =
          hasFilledValue(String(lockedOrder?.[dateKey] ?? "")) || lockedCompletedSet.has(milestone);
        const currentDisabled =
          disabled ||
          isDeliveryMilestone ||
          isCompleted;
        const completedDisabled =
          disabled || isDeliveryMilestone || (lockFilledFields && lockedValueFilled);
        return (
          <div
            key={milestone}
            className={
              "grid min-h-10 grid-cols-[minmax(0,1fr)_5rem_5rem] items-center border-b border-border px-3 py-2 text-sm last:border-b-0 " +
              (isCurrent ? "bg-primary/10 font-semibold text-primary" : "")
            }
          >
            <div className="min-w-0 truncate">{milestone}</div>
            <div className="flex justify-center">
              <input
                type="checkbox"
                checked={isCurrent}
                disabled={currentDisabled}
                onChange={() => onCurrentChange(milestone)}
                className="size-4 accent-primary disabled:cursor-not-allowed"
                aria-label={`Mark ${milestone} as current for this supply order`}
              />
            </div>
            <div className="flex justify-center">
              <input
                type="checkbox"
                checked={isCompleted}
                disabled={completedDisabled}
                onChange={() => toggleCompleted(milestone)}
                className="size-4 accent-primary disabled:cursor-not-allowed"
                aria-label={`Mark ${milestone} as completed for this supply order`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AdvancePaymentMilestonesBlock({
  advance,
  lockedAdvance,
  disabled,
  lockFilledFields,
  onCurrentChange,
  onCompletedChange,
}: {
  advance: AdvancePaymentDetail;
  lockedAdvance: AdvancePaymentDetail | undefined;
  disabled: boolean;
  lockFilledFields: boolean;
  onCurrentChange: () => void;
  onCompletedChange: (milestones: string[]) => void;
}) {
  const milestone = "Advance Payment";
  const completedSet = new Set(normalizeCompletedMilestones(advance.completedMilestones));
  const lockedCompletedSet = new Set(
    normalizeCompletedMilestones(lockedAdvance?.completedMilestones),
  );
  const isCurrent = normalizeMilestoneName(advance.currentMilestone) === "advancepayment";
  const isCompleted = completedSet.has(milestone);
  const lockedValueFilled =
    hasFilledValue(lockedAdvance?.paymentDate) || lockedCompletedSet.has(milestone);
  const currentDisabled =
    disabled ||
    isCompleted ||
    (lockFilledFields && hasFilledValue(lockedAdvance?.currentMilestone));
  const completedDisabled = disabled || (lockFilledFields && lockedValueFilled);

  const toggleCompleted = () => {
    if (disabled) return;
    const next = new Set(completedSet);
    if (next.has(milestone)) {
      next.delete(milestone);
    } else {
      next.add(milestone);
    }
    onCompletedChange(Array.from(next));
  };

  return (
    <div className="mb-4 overflow-hidden rounded-md border border-border bg-background/70">
      <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] border-b border-border bg-secondary/35 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
        <div>Advance milestone</div>
        <div className="text-center">Current</div>
        <div className="text-center">Done</div>
      </div>
      <div
        className={
          "grid min-h-10 grid-cols-[minmax(0,1fr)_5rem_5rem] items-center px-3 py-2 text-sm " +
          (isCurrent ? "bg-primary/10 font-semibold text-primary" : "")
        }
      >
        <div className="min-w-0 truncate">{milestone}</div>
        <div className="flex justify-center">
          <input
            type="checkbox"
            checked={isCurrent}
            disabled={currentDisabled}
            onChange={onCurrentChange}
            className="size-4 accent-primary disabled:cursor-not-allowed"
            aria-label="Mark Advance Payment as current"
          />
        </div>
        <div className="flex justify-center">
          <input
            type="checkbox"
            checked={isCompleted}
            disabled={completedDisabled}
            onChange={toggleCompleted}
            className="size-4 accent-primary disabled:cursor-not-allowed"
            aria-label="Mark Advance Payment as completed"
          />
        </div>
      </div>
    </div>
  );
}

function RemarksSummaryBlock({ form, remarks }: { form: FormState; remarks: FileRemark[] }) {
  const [stageFilter, setStageFilter] = useState("All");
  const [sortOrder, setSortOrder] = useState<"latest" | "oldest">("latest");
  const stageOptions = [
    "All",
    ...Array.from(new Set(remarks.map((remark) => remark.section).filter(Boolean))).sort(),
  ];
  const visibleRemarks = remarks
    .filter((remark) => remark.text.trim())
    .filter((remark) => stageFilter === "All" || remark.section === stageFilter)
    .sort((a, b) => {
      const direction = sortOrder === "latest" ? -1 : 1;
      return direction * compareRemarkDates(a.createdAt, b.createdAt);
    });

  return (
    <section
      id={sectionId("Remarks Summary")}
      className="md:col-span-2 scroll-mt-24 rounded-md border border-border bg-secondary/25 p-4"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div>
          <h3 className="text-sm font-semibold">Remarks Summary</h3>
          <span className="text-xs text-muted-foreground">
            {visibleRemarks.length} of {remarks.filter((remark) => remark.text.trim()).length}{" "}
            remarks shown
          </span>
        </div>
        <button
          type="button"
          onClick={() => printRemarksReport(form, visibleRemarks, stageFilter)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
        >
          <Printer className="size-3.5" /> Export PDF
        </button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block">
          <div className="mb-1.5 text-xs font-medium">Stage</div>
          <select
            value={stageFilter}
            onChange={(event) => setStageFilter(event.target.value)}
            className={inputCls}
          >
            {stageOptions.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className="mb-1.5 text-xs font-medium">Sort</div>
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as "latest" | "oldest")}
            className={inputCls}
          >
            <option value="latest">Latest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </div>

      {visibleRemarks.length ? (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-secondary/70 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-40 px-3 py-2 text-left font-semibold">Date</th>
                <th className="w-56 px-3 py-2 text-left font-semibold">Stage</th>
                <th className="px-3 py-2 text-left font-semibold">Remark</th>
              </tr>
            </thead>
            <tbody>
              {visibleRemarks.map((remark) => (
                <tr key={remark.id} className="border-t border-border">
                  <td className="px-3 py-2 align-top text-muted-foreground">
                    {formatRemarkDate(remark.createdAt)}
                  </td>
                  <td className="px-3 py-2 align-top font-medium">{remark.section}</td>
                  <td className="whitespace-pre-wrap px-3 py-2 align-top">{remark.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Remarks added through stage-wise Add remark buttons will appear here.
        </p>
      )}
    </section>
  );
}

function TimelineBlock({
  form,
  supplyOrders,
  divisions,
}: {
  form: FormState;
  supplyOrders: SupplyOrderDetail[];
  divisions: ReturnType<typeof useDivisions>;
}) {
  const [showAllDates, setShowAllDates] = useState(false);
  const [selectedSupplyOrderIndexes, setSelectedSupplyOrderIndexes] = useState<number[]>([]);
  const enabledTimelineFields = getEnabledTimelineFields(form, divisions);
  const useSupplyOrderSelector = shouldShowSupplyOrderTimelineSelector(supplyOrders);
  const selectableSupplyOrderIndexes = useMemo(
    () => supplyOrders.map((_, index) => index),
    [supplyOrders],
  );
  const activeSupplyOrderIndexes = useSupplyOrderSelector
    ? selectedSupplyOrderIndexes.filter((index) => index >= 0 && index < supplyOrders.length)
    : selectableSupplyOrderIndexes;
  const fileItems = enabledTimelineFields.map((field, index) => ({
    id: `file:${field.key}`,
    label: field.label,
    date: form[field.key],
    order: index,
  }));
  const timelineGroups = useSupplyOrderSelector
    ? [
        { title: "File timeline", items: fileItems },
        ...activeSupplyOrderIndexes.map((orderIndex) =>
          getSupplyOrderTimelineGroup(
            supplyOrders[orderIndex],
            orderIndex,
            enabledTimelineFields.length + orderIndex * 100,
          ),
        ),
      ]
    : [
        {
          title: "Timeline",
          items: [
            ...fileItems,
            ...getSupplyOrderTimelineItems(supplyOrders, enabledTimelineFields.length),
          ],
        },
      ];
  const allItems = timelineGroups.flatMap((group) => group.items);
  const filledItems = getFilledTimelineItems(allItems);
  const visibleGroups = timelineGroups
    .map((group) => ({
      ...group,
      items: showAllDates ? getFullTimelineItems(group.items) : getFilledTimelineItems(group.items),
    }))
    .filter((group) => showAllDates || group.items.length > 0);

  useEffect(() => {
    setSelectedSupplyOrderIndexes((current) => {
      const valid = current.filter((index) => index >= 0 && index < supplyOrders.length);
      if (valid.length) return valid;
      return selectableSupplyOrderIndexes;
    });
  }, [selectableSupplyOrderIndexes, supplyOrders.length]);

  const toggleSupplyOrderTimeline = (index: number, checked: boolean) => {
    setSelectedSupplyOrderIndexes((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return selectableSupplyOrderIndexes.filter((item) => next.has(item));
    });
  };

  return (
    <section
      id={sectionId("Timeline")}
      className="md:col-span-2 scroll-mt-24 rounded-md border border-border bg-secondary/25 p-4"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div>
          <h3 className="text-sm font-semibold">Timeline</h3>
          <span className="text-xs text-muted-foreground">
            {filledItems.length} of {allItems.length} date fields filled
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => printTimelineReport(form, filledItems)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            <Printer className="size-3.5" /> Print
          </button>
          <div className="inline-flex rounded-md border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => setShowAllDates(false)}
              className={
                "h-7 rounded px-2.5 text-xs font-medium " +
                (!showAllDates ? "bg-primary text-primary-foreground" : "text-muted-foreground")
              }
            >
              Filled only
            </button>
            <button
              type="button"
              onClick={() => setShowAllDates(true)}
              className={
                "h-7 rounded px-2.5 text-xs font-medium " +
                (showAllDates ? "bg-primary text-primary-foreground" : "text-muted-foreground")
              }
            >
              All dates
            </button>
          </div>
        </div>
      </div>

      {useSupplyOrderSelector ? (
        <div className="mb-4 rounded-md border border-border bg-card p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Supply order timeline
          </div>
          <div className="flex flex-wrap gap-2">
            {selectableSupplyOrderIndexes.map((orderIndex) => (
              <label
                key={orderIndex}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs font-medium"
              >
                <input
                  type="checkbox"
                  checked={activeSupplyOrderIndexes.includes(orderIndex)}
                  onChange={(event) => toggleSupplyOrderTimeline(orderIndex, event.target.checked)}
                />
                Supply Order {orderIndex + 1}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {filledItems.length === 0 && !showAllDates ? (
        <p className="text-sm text-muted-foreground">
          Timeline will appear here as date fields are filled.
        </p>
      ) : (
        <div className="space-y-4">
          {visibleGroups.map((group) => (
            <TimelineGroupBlock key={group.title} group={group} />
          ))}
        </div>
      )}
    </section>
  );
}

function TimelineGroupBlock({ group }: { group: TimelineGroup }) {
  const timelineMetrics = getTimelineMetrics(getFilledTimelineItems(group.items));
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
        {group.title}
      </div>
      <ol className="relative space-y-0">
        <span className="absolute left-[5.75rem] top-2 bottom-2 w-px bg-success/60" />
        {group.items.map((item) => {
          const metrics = timelineMetrics.get(getTimelineItemKey(item));
          return (
            <li key={item.id} className="relative pb-4 last:pb-0">
              <div className="grid grid-cols-[4.5rem_1.5rem_minmax(0,1fr)] items-start gap-2">
                <div className="pt-0.5 text-right text-[11px] font-medium text-muted-foreground">
                  {item.date ? formatDayCount(metrics?.gapDays) : "-"}
                </div>
                <div className="relative flex h-5 justify-center">
                  <span
                    className={
                      "mt-1.5 size-3 rounded-full border-2 border-card " +
                      (item.date
                        ? "bg-success shadow-[0_0_0_3px_var(--color-success)]/10"
                        : "bg-muted-foreground/35")
                    }
                  />
                </div>
                <div className="rounded-md border border-border bg-card px-3 py-2.5">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div
                      className={
                        item.date
                          ? "min-w-0 text-sm font-medium"
                          : "min-w-0 text-sm text-muted-foreground"
                      }
                    >
                      {item.label}
                    </div>
                    <div className="shrink-0 text-right text-[11px] font-medium text-muted-foreground">
                      {item.date ? formatDayCount(metrics?.cumulativeDays) : "-"}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.date ? formatTimelineDate(item.date) : "Not filled"}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function MilestonesBlock({
  milestones,
  applicableMilestones,
  currentMilestone,
  completedMilestones,
  autoCompletedMilestones,
  lockedCurrentMilestone,
  lockedCompletedMilestones,
  supplyOrderMilestoneProgress,
  inactiveMilestones,
  focusedMilestone,
  disabled,
  lockFilledFields,
  lockControl,
  onCurrentChange,
  onCompletedChange,
}: {
  milestones: string[];
  applicableMilestones: Set<string>;
  currentMilestone: string;
  completedMilestones: string[];
  autoCompletedMilestones: string[];
  lockedCurrentMilestone: string;
  lockedCompletedMilestones: string[];
  supplyOrderMilestoneProgress: Record<string, MilestoneProgress>;
  inactiveMilestones?: Set<string>;
  focusedMilestone: string;
  disabled: boolean;
  lockFilledFields: boolean;
  lockControl: ReactNode;
  onCurrentChange: (value: string) => void;
  onCompletedChange: (value: string[]) => void;
}) {
  const completedSet = new Set([...completedMilestones, ...autoCompletedMilestones]);
  const autoCompletedSet = new Set(autoCompletedMilestones);
  const lockedCompletedSet = new Set(lockedCompletedMilestones);
  const inactiveMilestoneKeys = new Set(
    Array.from(inactiveMilestones ?? []).map(normalizeMilestoneName),
  );
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const applicableMilestoneList = milestones.filter((milestone) =>
    applicableMilestones.has(milestone),
  );
  const activeApplicableMilestoneList = applicableMilestoneList.filter(
    (milestone) => !inactiveMilestoneKeys.has(normalizeMilestoneName(milestone)),
  );
  const applicableCount = activeApplicableMilestoneList.length;
  const applicableCompletedCount = activeApplicableMilestoneList.filter((milestone) =>
    (() => {
      const progress = supplyOrderMilestoneProgress[normalizeMilestoneName(milestone)];
      if (progress) return Boolean(progress.total && progress.completed === progress.total);
      return completedSet.has(milestone);
    })(),
  ).length;

  const toggleCurrent = (milestone: string) => {
    if (disabled) return;
    if (inactiveMilestoneKeys.has(normalizeMilestoneName(milestone))) return;
    const progress = supplyOrderMilestoneProgress[normalizeMilestoneName(milestone)];
    if (progress) return;
    const isCompleted = completedSet.has(milestone);
    if (!applicableMilestones.has(milestone) || isCompleted) return;
    onCurrentChange(currentMilestone === milestone ? "" : milestone);
  };

  const toggleCompleted = (milestone: string) => {
    if (disabled) return;
    if (inactiveMilestoneKeys.has(normalizeMilestoneName(milestone))) return;
    if (!applicableMilestones.has(milestone)) return;
    if (supplyOrderMilestoneProgress[normalizeMilestoneName(milestone)]) return;
    if (autoCompletedSet.has(milestone)) return;
    const next = new Set(completedSet);
    if (next.has(milestone)) {
      next.delete(milestone);
    } else {
      next.add(milestone);
      if (currentMilestone === milestone) {
        onCurrentChange("");
      }
    }
    onCompletedChange(
      milestones.filter((item) => applicableMilestones.has(item) && next.has(item)),
    );
  };

  useEffect(() => {
    if (!focusedMilestone) return;
    const target = rowRefs.current[normalizeMilestoneName(focusedMilestone)];
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusedMilestone]);

  return (
    <section
      id={sectionId("Milestones")}
      className="md:col-span-2 scroll-mt-24 rounded-md border border-border bg-secondary/25 p-4"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div>
          <h3 className="text-sm font-semibold">Milestones</h3>
          <span className="text-xs text-muted-foreground">
            Select the current stage and mark completed stages manually.
          </span>
        </div>
        {lockControl}
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold">Applicable stages</h4>
            <p className="text-xs text-muted-foreground">
              Select one current stage and mark completed stages.
            </p>
          </div>
          <span className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs tabular-nums text-muted-foreground">
            {applicableCompletedCount}/{applicableCount}
          </span>
        </div>
        <div className="overflow-hidden rounded-md border border-border bg-background">
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] border-b border-border bg-secondary/35 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
            <div>Stage</div>
            <div className="text-center">Current</div>
            <div className="text-center">Completed</div>
          </div>
          {applicableMilestoneList.map((milestone) => {
            const milestoneKey = normalizeMilestoneName(milestone);
            const isInactive = inactiveMilestoneKeys.has(milestoneKey);
            const orderProgress = isInactive ? undefined : supplyOrderMilestoneProgress[milestoneKey];
            const isOrderDriven = Boolean(orderProgress);
            const isCompleted = orderProgress
              ? Boolean(orderProgress.total && orderProgress.completed === orderProgress.total)
              : completedSet.has(milestone);
            const isAutoCompleted = autoCompletedSet.has(milestone);
            const isCurrent =
              orderProgress
                ? (orderProgress.current ??
                  (orderProgress.total > 0 && orderProgress.completed < orderProgress.total))
                : currentMilestone === milestone;
            const isFileClosed = normalizeMilestoneName(milestone) === "fileclosed";
            const currentDisabled =
              isInactive ||
              isFileClosed ||
              disabled ||
              isOrderDriven ||
              isCompleted ||
              (lockFilledFields && hasFilledValue(lockedCurrentMilestone));
            const completedDisabled =
              isInactive ||
              disabled ||
              isOrderDriven ||
              isAutoCompleted ||
              (lockFilledFields && lockedCompletedSet.has(milestone));
            return (
              <div
                key={milestone}
                ref={(element) => {
                  rowRefs.current[normalizeMilestoneName(milestone)] = element;
                }}
                className={`grid min-h-10 grid-cols-[minmax(0,1fr)_6rem_6rem] items-center border-b border-border px-3 py-2 text-sm last:border-b-0 ${
                  isCurrent && !isInactive ? "bg-primary/10 font-semibold text-primary" : ""
                } ${isCompleted ? "text-muted-foreground" : ""} ${
                  isInactive ? "bg-secondary/20 text-muted-foreground" : ""
                } ${
                  normalizeMilestoneName(focusedMilestone) === normalizeMilestoneName(milestone)
                    ? "ring-2 ring-primary/40"
                    : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate">{milestone}</div>
                  {orderProgress ? (
                    <div className="text-[11px] font-normal text-muted-foreground">
                      {orderProgress.completed}/{orderProgress.total}{" "}
                      {orderProgress.label ?? `${getMilestoneProgressUnit(milestone)} done`}
                    </div>
                  ) : null}
                  {isInactive ? (
                    <div className="text-[11px] font-normal text-muted-foreground">
                      Not applicable for this file type
                    </div>
                  ) : null}
                </div>
                <div className="flex justify-center">
                  {isFileClosed ? (
                    <span className="text-xs text-muted-foreground">-</span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={isCurrent}
                      disabled={currentDisabled}
                      onChange={() => toggleCurrent(milestone)}
                      className="size-4 accent-primary disabled:cursor-not-allowed"
                      aria-label={`Mark ${milestone} as current`}
                    />
                  )}
                </div>
                <div className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={isCompleted}
                    disabled={completedDisabled}
                    onChange={() => toggleCompleted(milestone)}
                    className="size-4 accent-primary disabled:cursor-not-allowed"
                    aria-label={`Mark ${milestone} as completed`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function mergeVisibleSupplyOrderCompletedMilestones(
  existing: string[] | undefined,
  visibleMilestones: readonly string[],
  selectedVisibleMilestones: readonly string[],
) {
  const visibleKeys = new Set(visibleMilestones.map(normalizeMilestoneName));
  const preserved = normalizeCompletedMilestones(existing).filter(
    (milestone) => !visibleKeys.has(normalizeMilestoneName(milestone)),
  );
  return Array.from(new Set([...preserved, ...selectedVisibleMilestones]));
}

function formatTimelineDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getTimelineDayGap(fromDate: string, toDate: string) {
  const fromTime = parseTimelineDateTime(fromDate);
  const toTime = parseTimelineDateTime(toDate);
  if (fromTime === undefined || toTime === undefined) return undefined;
  return Math.round((toTime - fromTime) / 86_400_000);
}

function parseTimelineDateTime(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  const time = parsed.getTime();
  return Number.isNaN(time) ? undefined : time;
}

function formatDayCount(days: number | undefined) {
  if (days === undefined) return "-";
  return `${days} ${Math.abs(days) === 1 ? "day" : "days"}`;
}

function getTimelineMetrics(items: TimelineItem[]) {
  const firstItem = items[0];
  return new Map(
    items.map((item, index) => {
      const previousItem = items[index - 1];
      const gapDays = previousItem ? getTimelineDayGap(previousItem.date, item.date) : undefined;
      const cumulativeDays = firstItem ? getTimelineDayGap(firstItem.date, item.date) : undefined;

      return [getTimelineItemKey(item), { gapDays, cumulativeDays }];
    }),
  );
}

function getFilledTimelineItems(items: TimelineItem[]) {
  return items
    .filter((item) => item.date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
}

function getFullTimelineItems(items: TimelineItem[]) {
  return [...items].sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date) || a.order - b.order;
    if (a.date) return -1;
    if (b.date) return 1;
    return a.order - b.order;
  });
}

function getSupplyOrderTimelineItems(supplyOrders: SupplyOrderDetail[], startOrder: number) {
  const showOrderNumber = supplyOrders.length > 1;
  return supplyOrders.flatMap((order, orderIndex) =>
    getSupplyOrderTimelineItemsForOrder(order, orderIndex, startOrder + orderIndex * 100).map(
      (item) => ({
        ...item,
        label: showOrderNumber ? `${item.label} (S.O. ${orderIndex + 1})` : item.label,
      }),
    ),
  );
}

function getSupplyOrderTimelineGroup(
  order: SupplyOrderDetail,
  orderIndex: number,
  startOrder: number,
): TimelineGroup {
  const titleParts = [`Supply Order ${orderIndex + 1}`];
  if (hasFilledValue(order.soNo)) titleParts.push(String(order.soNo));
  return {
    title: titleParts.join(" - "),
    items: getSupplyOrderTimelineItemsForOrder(order, orderIndex, startOrder),
  };
}

function getSupplyOrderTimelineItemsForOrder(
  order: SupplyOrderDetail,
  orderIndex: number,
  startOrder: number,
) {
  const dateFields = supplyOrderFields.filter((field) => field.type === "date");
  const orderItems = dateFields
    .filter((field) => field.key !== "revisedDp" || isYes(order.dpExtension ?? ""))
    .map((field, fieldIndex) => {
      const key = field.key as SupplyOrderKey;
      return {
        id: `so:${orderIndex}:${key}`,
        label: field.label,
        date: String(order[key] ?? ""),
        order: startOrder + fieldIndex,
      };
    });
  return [
    ...orderItems,
    ...getStageTimelineItems(order, orderIndex, startOrder + dateFields.length),
    ...getAdvancePaymentTimelineItems(order, orderIndex, startOrder + dateFields.length + 50),
  ];
}

function getStageTimelineItems(order: SupplyOrderDetail, orderIndex: number, startOrder: number) {
  if (!isYes(order.stageDelivery ?? "") || !order.stageDeliveries?.length) return [];
  const stageDateFields = stageDeliveryFields.filter((field) => field.type === "date");
  return resizeStageDeliveries(
    order.stageDeliveries,
    getStageDeliveryCount(order.stageDeliveryCount),
  ).flatMap((stage, stageIndex) =>
    stageDateFields.map((field, fieldIndex) => {
      const key = field.key as StageDeliveryKey;
      return {
        id: `so:${orderIndex}:stage:${stageIndex}:${key}`,
        label: `Delivery-${stageIndex + 1}: ${field.label}`,
        date: String(stage[key] ?? ""),
        order: startOrder + stageIndex * stageDateFields.length + fieldIndex,
      };
    }),
  );
}

function getAdvancePaymentTimelineItems(
  order: SupplyOrderDetail,
  orderIndex: number,
  startOrder: number,
) {
  if (
    !isYes(order.stageDelivery ?? "") ||
    !isYes(order.stagePayment ?? "") ||
    !isYes(order.advancePayment ?? "")
  ) {
    return [];
  }
  const advance = applyAdvancePaymentRules(order.advancePaymentDetail ?? {});
  const advanceDateFields = advancePaymentFields.filter((field) => field.type === "date");
  return advanceDateFields.map((field, fieldIndex) => {
    const key = field.key as AdvancePaymentKey;
    return {
      id: `so:${orderIndex}:advance:${key}`,
      label: `Advance Payment: ${field.label}`,
      date: String(advance[key] ?? ""),
      order: startOrder + fieldIndex,
    };
  });
}

function shouldShowSupplyOrderTimelineSelector(supplyOrders: SupplyOrderDetail[]) {
  return (
    supplyOrders.length > 1 ||
    supplyOrders.some(
      (order) =>
        isYes(order.stageDelivery ?? "") ||
        isYes(order.stagePayment ?? "") ||
        isYes(order.advancePayment ?? ""),
    )
  );
}

function getTimelineItemKey(item: TimelineItem) {
  return item.id;
}

function compareRemarkDates(a: string, b: string) {
  return getRemarkTime(a) - getRemarkTime(b);
}

function getRemarkTime(value: string) {
  const dateValue = getRemarkDateInputValue(value);
  const localTime = parseLocalDateTime(dateValue);
  if (localTime !== undefined) return localTime;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function printTimelineReport(form: FormState, filledItems: TimelineItem[]) {
  const details = [
    { label: "Control number", value: form.imms },
    { label: "Division", value: form.division },
    { label: "Description", value: form.demandDescription },
    { label: "Indentor", value: form.indentor },
  ];
  const timelineRows = filledItems.map((item, index) => {
    const firstItem = filledItems[0];
    const previousItem = filledItems[index - 1];
    const gapDays = previousItem ? getTimelineDayGap(previousItem.date, item.date) : undefined;
    const cumulativeDays = firstItem ? getTimelineDayGap(firstItem.date, item.date) : undefined;

    return [
      index + 1,
      item.label,
      formatTimelineDate(item.date),
      formatDayCount(gapDays),
      formatDayCount(cumulativeDays),
    ];
  });

  void downloadBackendExport({
    format: "pdf",
    title: "File Timeline",
    fileName: `${getExportFileName(form.imms || form.uniqueCode || "timeline")}.pdf`,
    tables: [
      {
        title: "File details",
        headers: ["S.No.", "Field", "Value"],
        rows: details.map((detail, index) => [index + 1, detail.label, detail.value || "Not set"]),
      },
      {
        title: "Timeline",
        headers: ["S.No.", "Field", "Date", "Time gap", "Cumulative time"],
        rows: timelineRows.length ? timelineRows : [["No timeline fields are filled."]],
      },
    ],
  });
}

function printRemarksReport(form: FormState, remarks: FileRemark[], stageFilter: string) {
  const details = [
    { label: "Unique code", value: form.uniqueCode },
    { label: "Control number", value: form.imms },
    { label: "Division", value: form.division },
    { label: "Indentor", value: form.indentor },
    { label: "Description", value: form.demandDescription },
  ];
  void downloadBackendExport({
    format: "pdf",
    title: "Remarks Summary",
    subtitle: `Stage: ${stageFilter}`,
    fileName: `${getExportFileName(form.imms || form.uniqueCode || "remarks-summary")}.pdf`,
    tables: [
      {
        title: "File details",
        headers: ["S.No.", "Field", "Value"],
        rows: details.map((detail, index) => [index + 1, detail.label, detail.value || "Not set"]),
      },
      {
        title: "Remarks",
        headers: ["S.No.", "Date", "Stage", "Remark"],
        rows: remarks.length
          ? remarks.map((remark, index) => [
              index + 1,
              formatRemarkDate(remark.createdAt),
              remark.section,
              remark.text,
            ])
          : [["No remarks are available for the selected filter."]],
      },
    ],
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sectionId(title: string) {
  return `add-section-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}

const inputCls =
  "w-full max-w-md h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition";

const textareaCls =
  "w-full max-w-2xl min-h-20 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition resize-y";

function sectionBlockCls(index: number) {
  const accents = [
    "border-l-primary",
    "border-l-success",
    "border-l-warning",
    "border-l-chart-5",
    "border-l-destructive",
    "border-l-chart-2",
  ];
  return `md:col-span-2 scroll-mt-24 rounded-md border border-l-2 border-border bg-card p-4 shadow-sm ${accents[index % accents.length]}`;
}

function sectionStripeCls(index: number) {
  const colors = [
    "bg-primary",
    "bg-success",
    "bg-warning",
    "bg-chart-5",
    "bg-destructive",
    "bg-chart-2",
  ];
  return `inline-block h-4 w-1 rounded-full ${colors[index % colors.length]}`;
}

function toFilePayload(form: FormState) {
  return Object.fromEntries(
    Object.entries(form)
      .filter(([key]) => key !== "valueCapitalSelected" && key !== "valueRevenueSelected")
      .map(([key, value]) => [key, value || null]),
  ) as Omit<import("@/lib/files-store").FileRecord, "id" | "createdAt">;
}

function cleanFirmRows(rows: FirmDetail[]) {
  const cleaned = rows
    .map((row) => ({
      firmName: row.firmName?.trim() || undefined,
      city: row.city?.trim() || undefined,
      emailId: row.emailId?.trim() || undefined,
    }))
    .filter((row) => row.firmName || row.city || row.emailId);
  return cleaned.length ? cleaned : undefined;
}

function createRemarksFromFile(file: FileRecord | undefined) {
  return (
    file?.remarks
      ?.map((remark) => ({
        id: remark.id || createRemarkId(),
        section: remark.section || "File details",
        text: remark.text ?? "",
        createdAt: getRemarkDateInputValue(remark.createdAt) || formatLocalDate(new Date()),
      }))
      .filter((remark) => remark.section) ?? []
  );
}

function cleanFileRemarks(remarks: FileRemark[]) {
  const cleaned = remarks
    .map((remark) => ({
      id: remark.id || createRemarkId(),
      section: remark.section,
      text: remark.text.trim(),
      createdAt: getRemarkDateInputValue(remark.createdAt) || formatLocalDate(new Date()),
    }))
    .filter((remark) => remark.section && remark.text);
  return cleaned.length ? cleaned : undefined;
}

function createMarkersFromFile(file: FileRecord | undefined) {
  return (
    file?.markers
      ?.map((marker) => ({
        id: marker.id || createMarkerId(),
        text: marker.text ?? "",
        createdAt: getRemarkDateInputValue(marker.createdAt) || formatLocalDate(new Date()),
      }))
      .filter((marker) => marker.id) ?? []
  );
}

function cleanFileMarkers(markers: FileMarker[]) {
  const cleaned = markers
    .map((marker) => ({
      id: marker.id || createMarkerId(),
      text: marker.text.trim(),
      createdAt: getRemarkDateInputValue(marker.createdAt) || formatLocalDate(new Date()),
    }))
    .filter((marker) => marker.text);
  return cleaned.length ? cleaned : undefined;
}

function createRemarkId() {
  return globalThis.crypto?.randomUUID?.() ?? `remark-${Date.now()}-${Math.random()}`;
}

function createMarkerId() {
  return globalThis.crypto?.randomUUID?.() ?? `marker-${Date.now()}-${Math.random()}`;
}

function formatRemarkDate(value: string) {
  if (!value) return "";
  const dateValue = getRemarkDateInputValue(value);
  const date = dateValue ? new Date(`${dateValue}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getRemarkDateInputValue(value: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatLocalDate(date);
}

function getTcecCommitteeOptions(committees: string[] | undefined, currentValue: string) {
  const values = (committees ?? []).filter(Boolean);
  return currentValue && !values.includes(currentValue) ? [...values, currentValue] : values;
}

function getConfiguredMilestones(milestones: string[] | undefined) {
  const values = (milestones ?? [])
    .map((item) => normalizeConfiguredMilestoneLabel(item.trim()))
    .filter(Boolean);
  const configured = values.length ? values : defaultMilestones;
  return appendFileClosedMilestone(insertBillSentMilestone(insertFinancialSanctionMilestone(configured)));
}

function getConfiguredFirmTypes(firmTypes: string[] | undefined) {
  const seen = new Set<string>();
  const values = (firmTypes?.length ? firmTypes : defaultFirmTypes)
    .map((firmType) => firmType.trim())
    .filter((firmType) => {
      if (!firmType) return false;
      const key = firmType.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return values.length ? values : defaultFirmTypes;
}

function getConfiguredFileTypes(fileTypes: string[] | undefined, currentFileType?: string) {
  const seen = new Set<string>();
  const values = [...defaultFileTypeOptions, ...(fileTypes ?? []), currentFileType ?? ""]
    .map((fileType) => fileType.trim())
    .filter((fileType) => {
      if (!fileType) return false;
      const key = fileType.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return values.length ? values : defaultFileTypeOptions;
}

function filterFileTypeOptionsForUser(
  fileTypes: string[],
  allowedCategories: string[] | null | undefined,
) {
  if (!Array.isArray(allowedCategories)) return fileTypes;
  const allowed = new Set(expandLegacyAllowedFileCategories(allowedCategories));
  return fileTypes.filter((fileType) => {
    const normalized = fileType.trim().toLowerCase();
    if (normalized === "amc") return allowed.has("amc");
    if (normalized === "mpc") return allowed.has("mpc");
    if (normalized === "cars") return allowed.has("cars");
    if (normalized === "o&m") return allowed.has("om");
    return allowed.has("goodsServices");
  });
}

function expandLegacyAllowedFileCategories(categories: string[]) {
  const categorySet = new Set(categories);
  if (
    categorySet.has("goodsServices") &&
    categorySet.has("amc") &&
    categorySet.has("mpc") &&
    categorySet.has("cars") &&
    !categorySet.has("om")
  ) {
    categorySet.add("om");
  }
  return Array.from(categorySet);
}

function getConfiguredModes(modes: string[] | undefined, currentMode?: string) {
  const seen = new Set<string>();
  const values = [...(modes?.length ? modes : defaultModeOptions), currentMode ?? ""]
    .map((mode) => mode.trim().toUpperCase())
    .filter((mode) => {
      if (!mode) return false;
      if (seen.has(mode)) return false;
      seen.add(mode);
      return true;
    });
  return values.length ? values : defaultModeOptions;
}

function filterModeOptionsForUser(modes: string[], allowedCategories: string[] | null | undefined) {
  if (!Array.isArray(allowedCategories)) return modes;
  const allowed = new Set(allowedCategories);
  return modes.filter((mode) => {
    const normalized = mode.trim().toUpperCase();
    return (
      allowed.has("goodsServices") || allowed.has("amc") || allowed.has("mpc") || allowed.has("om")
    );
  });
}

function mergeOptions(options: string[], currentValue: string | undefined) {
  const current = currentValue?.trim();
  if (!current) return options;
  return options.some((option) => option.toLowerCase() === current.toLowerCase())
    ? options
    : [...options, current];
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
  const paymentIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "payment",
  );
  if (hasBillSent || paymentIndex === -1) return milestones;
  return [
    ...milestones.slice(0, paymentIndex),
    "Bill sent for payment",
    ...milestones.slice(paymentIndex),
  ];
}

function insertFinancialSanctionMilestone(milestones: string[]) {
  const hasFinancialSanction = milestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "financialsanction",
  );
  const supplyOrderIndex = milestones.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "supplyorder",
  );
  if (hasFinancialSanction || supplyOrderIndex === -1) return milestones;
  return [
    ...milestones.slice(0, supplyOrderIndex),
    "Financial Sanction",
    ...milestones.slice(supplyOrderIndex),
  ];
}

function normalizeConfiguredMilestoneLabel(milestone: string) {
  return normalizeMilestoneName(milestone) === "controlled" ? "Controlling" : milestone;
}

function getApplicableMilestones(
  milestones: string[],
  form: FormState,
  supplyOrders: SupplyOrderDetail[],
  divisions: Division[],
) {
  return new Set(
    milestones.filter((milestone) =>
      isMilestoneApplicableToFile(milestone, form, supplyOrders, divisions),
    ),
  );
}

function isMilestoneApplicableToFile(
  milestone: string,
  form: FormState,
  supplyOrders: SupplyOrderDetail[],
  divisions: Division[],
) {
  const key = normalizeMilestoneName(milestone);

  if (key === "highvalue") return isYes(form.highValue);
  if (key === "pretcec" || key === "posttcec" || key === "cnc") return isYes(form.tcec);
  if (key === "ad") return isYes(form.ad) && !isDivisionAdNo(form.division, divisions);
  if (key === "rqa") return isYes(form.rqa);
  if (key === "ifa") return isYes(form.ifa);
  if (key === "bankguarantee") return isYes(form.bg);
  if (key === "irpreparation" || key === "irreceipt") return isYes(form.ir);

  return true;
}

function normalizeMilestoneName(value: string | undefined | null) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeStatusStage(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function shouldUseSupplyOrderMilestones(orders: SupplyOrderDetail[]) {
  return (
    orders.length > 1 ||
    orders.some(
      (order) =>
        hasMeaningfulSupplyOrderData(order) ||
        isYes(order.stageDelivery ?? "") ||
        isYes(order.stagePayment ?? ""),
    )
  );
}

function hasMeaningfulSupplyOrderData(order: SupplyOrderDetail) {
  return Object.entries(order).some(([key, value]) => hasMeaningfulSupplyOrderDataValue(key, value));
}

function hasMeaningfulSupplyOrderDataValue(key: string, value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) =>
      item && typeof item === "object"
        ? Object.entries(item).some(([childKey, childValue]) =>
            hasMeaningfulSupplyOrderDataValue(childKey, childValue),
          )
        : hasMeaningfulSupplyOrderDataValue(key, item),
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value).some(([childKey, childValue]) =>
      hasMeaningfulSupplyOrderDataValue(childKey, childValue),
    );
  }
  const text = String(value ?? "").trim();
  if (!text) return false;
  return !(
    text.toLowerCase() === "no" &&
    ["advancePayment", "demandCancelled", "dpExtension", "ld", "soCancelled", "stageDelivery", "stagePayment"].includes(
      key,
    )
  );
}

function clearSupplyOrderMilestones(orders: SupplyOrderDetail[]) {
  return orders.map((order) => ({
    ...order,
    currentMilestone: undefined,
    completedMilestones: [],
  }));
}

function getApplicableSupplyOrderMilestones(
  order: SupplyOrderDetail,
  options: { bgDisabled: boolean; irDisabled: boolean },
) {
  return supplyOrderMilestoneNames.filter((milestone) => {
    if (milestone === "Bank Guarantee") return !options.bgDisabled;
    if (milestone === "IR Preparation" || milestone === "IR Receipt") return !options.irDisabled;
    return true;
  });
}

function getSupplyOrderMilestoneProgress(
  milestones: string[],
  orders: SupplyOrderDetail[],
  form: Pick<FormState, "bg" | "ir" | "fileType">,
): Record<string, MilestoneProgress> {
  if (!shouldUseSupplyOrderMilestones(orders)) return {};
  return Object.fromEntries(
    milestones.flatMap((milestone) => {
      const orderMilestone = getSupplyOrderMilestoneByName(milestone);
      if (!orderMilestone) return [];
      if (orderMilestone === "Delivery") {
        const progress = getDeliveryMilestoneProgress(orders, form);
        return progress ? [[normalizeMilestoneName(milestone), progress]] : [];
      }
      const applicableOrders = getProgressRowsForMilestone(orders, orderMilestone, form);
      if (!applicableOrders.length) return [];
      const completed = applicableOrders.filter((order) =>
        isSupplyOrderMilestoneComplete(order, orderMilestone),
      ).length;
      return [[normalizeMilestoneName(milestone), { completed, total: applicableOrders.length }]];
    }),
  );
}

function getDeliveryMilestoneProgress(
  orders: SupplyOrderDetail[],
  form: Pick<FormState, "bg" | "ir" | "fileType">,
): MilestoneProgress | undefined {
  const rows = expandedFileSupplyOrders({ supplyOrders: orders } as FileRecord).filter(
    (order) =>
      hasFilledValue(order.soDate) &&
      hasFilledValue(order.deliveryPeriodStartDate) &&
      hasFilledValue(getLaterDate(order.dpDate, order.revisedDp)) &&
      !isYes(order.soCancelled),
  );
  if (!rows.length) return undefined;
  if (!isStageDeliveryFileType(form.fileType)) {
    const completed = rows.filter(
      (order) => getDerivedDeliveryMilestoneState(order, form.fileType).completed,
    ).length;
    const current = rows.some((order) => getDerivedDeliveryMilestoneState(order, form.fileType).current);
    return {
      completed,
      total: rows.length,
      current,
    };
  }
  const today = formatLocalDate(new Date());
  const reached = rows.filter((order) => {
    const startDate = order.deliveryPeriodStartDate || order.soDate || "";
    return hasFilledValue(startDate) && startDate <= today;
  }).length;
  const current = rows.some((order) => getDerivedDeliveryMilestoneState(order, form.fileType).current);
  return {
    completed: Math.min(reached, rows.length),
    total: rows.length,
    current,
    label: "periods",
  };
}

function getProgressRowsForMilestone(
  orders: SupplyOrderDetail[],
  milestone: SupplyOrderMilestoneName,
  form: Pick<FormState, "bg" | "ir" | "fileType">,
) {
  if (isStageDrivenMilestone(milestone)) {
    if ((milestone === "IR Preparation" || milestone === "IR Receipt") && isNo(form.ir)) return [];
    return expandedFileSupplyOrders({ supplyOrders: orders } as FileRecord).filter(
      (order) =>
        hasFilledValue(order.soDate) &&
        getApplicableSupplyOrderMilestones(order, {
          bgDisabled: isNo(form.bg),
          irDisabled: isNo(form.ir),
        }).includes(milestone),
    );
  }
  return getApplicableOrdersForMilestone(orders, milestone, form);
}

function isStageDrivenMilestone(milestone: SupplyOrderMilestoneName) {
  return (
    milestone === "Delivery" ||
    milestone === "IR Preparation" ||
    milestone === "IR Receipt" ||
    milestone === "Bill preparation" ||
    milestone === "Bill sent for payment" ||
    milestone === "Payment"
  );
}

function getMilestoneProgressUnit(milestone: string) {
  const orderMilestone = getSupplyOrderMilestoneByName(milestone);
  return orderMilestone && isStageDrivenMilestone(orderMilestone) ? "stages" : "supply orders";
}

function getSupplyOrderMilestoneErrors(
  orders: SupplyOrderDetail[],
  form: Pick<FormState, "bg" | "ir">,
) {
  if (!shouldUseSupplyOrderMilestones(orders)) return [];
  const errors: string[] = [];
  orders.forEach((order, index) => {
    if (!hasFilledValue(order.soDate) && !hasFilledObjectValue(order)) return;
    const label = `Supply Order ${index + 1}`;
    const applicable = getApplicableSupplyOrderMilestones(order, {
      bgDisabled: isNo(form.bg),
      irDisabled: isNo(form.ir),
    });
    const completed = new Set(
      normalizeCompletedMilestones(order.completedMilestones).map(normalizeMilestoneName),
    );

    for (const milestone of applicable) {
      const isCompleted = completed.has(normalizeMilestoneName(milestone));
      const hasDate = isSupplyOrderMilestoneDateComplete(order, milestone);
      if (isCompleted && !hasDate && milestone !== "Bank Guarantee" && milestone !== "Financial Sanction") {
        errors.push(
          `${label}: ${milestone} is marked done, but ${dateLabelForSupplyOrderMilestone(milestone)} is missing.`,
        );
      }
    }

    if (
      order.currentMilestone &&
      !applicable.some(
        (milestone) =>
          normalizeMilestoneName(milestone) ===
          normalizeMilestoneName(order.currentMilestone ?? ""),
      )
    ) {
      errors.push(`${label}: current milestone is not applicable to this supply order.`);
    }
  });
  return errors;
}

function isSupplyOrderMilestoneDateComplete(
  order: SupplyOrderDetail,
  milestone: SupplyOrderMilestoneName,
) {
  const dateKey = supplyOrderMilestoneDateKeys[milestone];
  if (
    (dateKey === "billPreparationDate" ||
      dateKey === "billSentForPaymentDate" ||
      dateKey === "paymentDate") &&
    isYes(order.stageDelivery) &&
    isYes(order.stagePayment)
  ) {
    const stages = resizeStageDeliveries(
      order.stageDeliveries ?? [],
      getStageDeliveryCount(order.stageDeliveryCount),
    );
    return stages.length > 0 && stages.every((stage) => hasFilledValue(stage[dateKey]));
  }
  return hasFilledValue(String(order[dateKey] ?? ""));
}

function getSupplyOrderMilestoneByName(milestone: string): SupplyOrderMilestoneName | undefined {
  return supplyOrderMilestoneNames.find(
    (item) => normalizeMilestoneName(item) === normalizeMilestoneName(milestone),
  );
}

function getApplicableOrdersForMilestone(
  orders: SupplyOrderDetail[],
  milestone: SupplyOrderMilestoneName,
  form: Pick<FormState, "bg" | "ir">,
) {
  if (milestone === "Bank Guarantee" && isNo(form.bg)) return [];
  if ((milestone === "IR Preparation" || milestone === "IR Receipt") && isNo(form.ir)) return [];
	  return orders.filter((order) => {
	    if (milestone === "Financial Sanction") return true;
	    if (milestone === "Supply Order") return true;
    if (milestone === "Bank Guarantee") {
      return getApplicableSupplyOrderMilestones(order, {
        bgDisabled: isNo(form.bg),
        irDisabled: isNo(form.ir),
      }).includes(milestone);
    }
    if (!hasFilledValue(order.soDate)) return false;
    return getApplicableSupplyOrderMilestones(order, {
      bgDisabled: isNo(form.bg),
      irDisabled: isNo(form.ir),
    }).includes(milestone);
  });
}

function isSupplyOrderMilestoneComplete(order: SupplyOrderDetail, milestone: SupplyOrderMilestoneName) {
  if (milestone === "Financial Sanction") return isFinancialSanctionCompletedForOrder(order);
  if (milestone === "Bank Guarantee") return isBankGuaranteeReceivedForOrder(order);
  return normalizeCompletedMilestones(order.completedMilestones).some(
    (item) => normalizeMilestoneName(item) === normalizeMilestoneName(milestone),
  );
}

function dateLabelForSupplyOrderMilestone(milestone: SupplyOrderMilestoneName) {
  const field = supplyOrderFields.find(
    (item) => item.key === supplyOrderMilestoneDateKeys[milestone],
  );
  return field?.label ?? "date";
}

function cleanSupplyOrderRows(
  rows: SupplyOrderDetail[],
  form?: Pick<FormState, "fileType" | "valueCapitalSelected" | "valueRevenueSelected">,
) {
  const normalized = rows.map((row) => applySupplyOrderRules(row, form));
  return normalized.map((row) => ({
    currentMilestone: row.currentMilestone || undefined,
    completedMilestones: normalizeCompletedMilestones(row.completedMilestones),
    financialSanctionDate: row.financialSanctionDate || undefined,
    soNo: row.soNo?.trim() || undefined,
    gemSoNo: row.gemSoNo?.trim() || undefined,
    soDate: row.soDate || undefined,
    soValueCapital: row.soValueCapital || undefined,
    soValueRevenue: row.soValueRevenue || undefined,
    dpDate: row.dpDate || undefined,
    firm: row.firm?.trim() || undefined,
    firmType: row.firmType || undefined,
    firmTypeOther: row.firmTypeOther?.trim() || undefined,
    bgValidityDate: row.bgValidityDate || undefined,
    dpExtension: row.dpExtension || undefined,
    dpExtensionCount: row.dpExtensionCount || undefined,
    ld: row.ld || undefined,
    ldType: row.ldType || undefined,
    ldPercentage: row.ldPercentage || undefined,
    revisedDp: row.revisedDp || undefined,
    materialReceiptDate: row.materialReceiptDate || undefined,
    irPreparationDate: row.irPreparationDate || undefined,
    irReceiptDate: row.irReceiptDate || undefined,
    billPreparationDate: row.billPreparationDate || undefined,
    billSentForPaymentDate: row.billSentForPaymentDate || undefined,
    paymentDate: row.paymentDate || undefined,
    paymentMode: row.paymentMode || undefined,
    actualPaymentCapital: row.actualPaymentCapital || undefined,
    actualPaymentRevenue: row.actualPaymentRevenue || undefined,
    bgReturnDate: row.bgReturnDate || undefined,
    soCancelled: row.soCancelled || undefined,
    soCancelledDate: row.soCancelledDate || undefined,
    stageDelivery: row.stageDelivery || undefined,
    stageDeliveryCount: row.stageDeliveryCount || undefined,
    stagePayment: row.stagePayment || undefined,
    advancePayment: row.advancePayment || undefined,
    advancePaymentDetail: cleanAdvancePaymentDetail(row.advancePaymentDetail),
    stageDeliveries: cleanStageDeliveryRows(row.stageDeliveries ?? [], form, row),
  }));
}

function getStageDeliveryWarnings(
  rows: SupplyOrderDetail[],
  lockedRows: SupplyOrderDetail[],
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected">,
  completedMilestones: string[],
) {
  const warnings: string[] = [];
  const paymentCompletedAtFileLevel = completedMilestones.some(
    (milestone) => normalizeMilestoneName(milestone) === "payment",
  );
  const hasAnyPaymentDate = rows.some((order) => hasAnyOrderPaymentDate(order));
  if (paymentCompletedAtFileLevel && !hasAnyPaymentDate) {
    warnings.push("File: Payment is marked completed, but no applicable payment date exists.");
  }
  rows.forEach((order, orderIndex) => {
    const orderLabel = `Supply Order ${orderIndex + 1}`;
    const stageDeliveryEnabled = isYes(order.stageDelivery ?? "");
    const stagePaymentEnabled = isYes(order.stagePayment ?? "");
    const advancePaymentEnabled = isYes(order.advancePayment ?? "");
    const stageCount = getStageDeliveryCount(order.stageDeliveryCount);
    const stages = resizeStageDeliveries(order.stageDeliveries ?? [], stageCount);
    const lockedStages = lockedRows[orderIndex]?.stageDeliveries ?? [];
    const orderPaymentCompleted = normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === "payment",
    );

    warnings.push(...getSupplyOrderChronologyWarnings(order, orderLabel, form));

    if (isYes(order.soCancelled ?? "") && !hasFilledValue(order.soCancelledDate)) {
      warnings.push(`${orderLabel}: S.O. cancelled is Yes, but S.O. cancelled date is blank.`);
    }

    if (orderPaymentCompleted && !hasAnyOrderPaymentDate(order)) {
      warnings.push(
        `${orderLabel}: Payment is marked completed, but no applicable payment date exists.`,
      );
    }

    if (stageDeliveryEnabled && stageCount < lockedStages.length) {
      const removedStagesWithData = lockedStages
        .slice(stageCount)
        .filter((stage) => hasFilledObjectValue(stage)).length;
      if (removedStagesWithData) {
        warnings.push(
          `${orderLabel}: reducing stage count will remove data from ${removedStagesWithData} later stage(s).`,
        );
      }
    }

    if (
      !stageDeliveryEnabled &&
      hasFilledObjectValue({
        ...(order.advancePaymentDetail ?? {}),
        ...(order.stageDeliveries ?? []),
      })
    ) {
      warnings.push(`${orderLabel}: Stage Delivery is No, but hidden stage/advance data exists.`);
    }

    if (stageDeliveryEnabled && !stagePaymentEnabled && hasAnyStagePaymentData(stages)) {
      warnings.push(`${orderLabel}: Stage Payment is No, but hidden stage payment data exists.`);
    }

    if (
      stageDeliveryEnabled &&
      stagePaymentEnabled &&
      !advancePaymentEnabled &&
      hasFilledObjectValue(order.advancePaymentDetail ?? {})
    ) {
      warnings.push(
        `${orderLabel}: Advance Payment is No, but hidden advance payment data exists.`,
      );
    }

    if (stageDeliveryEnabled) {
      stages.forEach((stage, stageIndex) => {
        const stageLabel = `${orderLabel} Delivery-${stageIndex + 1}`;
        warnings.push(...getStageChronologyWarnings(stage, order, stageLabel, form));
        if (!hasSelectedAmount(stage.stageAmountCapital, stage.stageAmountRevenue, form)) {
          warnings.push(`${stageLabel}: Stage amount is missing.`);
        }
        if (stagePaymentEnabled && !hasFilledValue(stage.dpDate)) {
          warnings.push(`${stageLabel}: D.P. date is missing while Stage Payment is Yes.`);
        }
        if (
          stagePaymentEnabled &&
          isStagePaymentDetailsDue(stage) &&
          ![
            stage.billPreparationDate,
            stage.billSentForPaymentDate,
            stage.paymentDate,
            stage.actualPaymentCapital,
            stage.actualPaymentRevenue,
          ].some(hasFilledValue)
        ) {
          warnings.push(`${stageLabel}: Stage payment details are missing.`);
        }
        if (hasWrongAmountSide(stage.stageAmountCapital, stage.stageAmountRevenue, form)) {
          warnings.push(`${stageLabel}: Stage amount has value on the wrong Capital/Revenue side.`);
        }
        if (hasWrongAmountSide(stage.actualPaymentCapital, stage.actualPaymentRevenue, form)) {
          warnings.push(
            `${stageLabel}: Actual payment amount has value on the wrong Capital/Revenue side.`,
          );
        }
      });
    }

    if (stageDeliveryEnabled && stagePaymentEnabled && advancePaymentEnabled) {
      const advance = order.advancePaymentDetail ?? {};
      warnings.push(...getAdvancePaymentChronologyWarnings(advance, order, orderLabel, form));
      if (isAdvancePaymentCompletedByCheckbox(advance) && !hasFilledValue(advance.paymentDate)) {
        warnings.push(`${orderLabel} Advance Payment: Completed is checked, but payment date is missing.`);
      }
      if (!hasSelectedAmount(advance.stageAmountCapital, advance.stageAmountRevenue, form)) {
        warnings.push(`${orderLabel} Advance Payment: Advance amount is missing.`);
      }
      if (!hasFilledValue(advance.billPreparationDate)) {
        warnings.push(`${orderLabel} Advance Payment: Bill preparation date is missing.`);
      }
      if (!hasFilledValue(advance.billSentForPaymentDate)) {
        warnings.push(`${orderLabel} Advance Payment: Bill sent for payment date is missing.`);
      }
      if (hasWrongAmountSide(advance.stageAmountCapital, advance.stageAmountRevenue, form)) {
        warnings.push(
          `${orderLabel} Advance Payment: Advance amount has value on the wrong Capital/Revenue side.`,
        );
      }
      if (hasWrongAmountSide(advance.actualPaymentCapital, advance.actualPaymentRevenue, form)) {
        warnings.push(
          `${orderLabel} Advance Payment: Actual payment amount has value on the wrong Capital/Revenue side.`,
        );
      }
    }
    if (isYes(order.soCancelled) && hasFilledValue(order.advancePaymentDetail?.paymentDate)) {
      warnings.push(
        `${orderLabel}: Is the advance settled? Enter details of settlement in File Marker field`,
      );
    }
  });
  return warnings;
}

function getPaymentBlockedByBgErrors(
  rows: SupplyOrderDetail[],
  form: Pick<FormState, "bg">,
) {
  if (isNo(form.bg)) return [];
  const errors: string[] = [];
  rows.forEach((order, orderIndex) => {
    if (isYes(order.soCancelled) || isBankGuaranteeReceivedForOrder(order)) return;
    const orderLabel = `Supply Order ${orderIndex + 1}`;
    if (hasOrderLevelPaymentProgress(order)) {
      errors.push(`${orderLabel}: Payment cannot be marked/current/paid until Bank Guarantee is received.`);
    }
    if (hasAdvancePaymentProgress(order.advancePaymentDetail)) {
      errors.push(`${orderLabel}: Advance payment cannot be paid until Bank Guarantee is received.`);
    }
    const stages = resizeStageDeliveries(
      order.stageDeliveries ?? [],
      getStageDeliveryCount(order.stageDeliveryCount),
    );
    stages.forEach((stage, stageIndex) => {
      if (hasStagePaymentProgress(stage)) {
        errors.push(
          `${orderLabel} Delivery-${stageIndex + 1}: Payment cannot be marked/current/paid until Bank Guarantee is received.`,
        );
      }
    });
  });
  return errors;
}

function isBankGuaranteeMilestone(milestone: string | undefined) {
  return normalizeMilestoneName(milestone ?? "") === "bankguarantee";
}

function isBankGuaranteeReceivedForOrder(order: MilestoneRowState | SupplyOrderDetail) {
  return (
    hasFilledValue(order.bgValidityDate) ||
    normalizeCompletedMilestones(order.completedMilestones).some(isBankGuaranteeMilestone)
  );
}

function isFinancialSanctionCompletedForOrder(order: MilestoneRowState | SupplyOrderDetail) {
  return (
    hasFilledValue(order.financialSanctionDate) ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === "financialsanction",
    )
  );
}

function isBankGuaranteePendingMilestoneRow(order: MilestoneRowState | SupplyOrderDetail) {
  return !isBankGuaranteeReceivedForOrder(order);
}

function hasOrderLevelPaymentProgress(order: SupplyOrderDetail) {
  return (
    normalizeMilestoneName(order.currentMilestone ?? "") === "payment" ||
    normalizeCompletedMilestones(order.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === "payment",
    ) ||
    hasFilledValue(order.paymentDate)
  );
}

function hasStagePaymentProgress(stage: StageDeliveryDetail) {
  return (
    normalizeMilestoneName(stage.currentMilestone ?? "") === "payment" ||
    normalizeCompletedMilestones(stage.completedMilestones).some(
      (milestone) => normalizeMilestoneName(milestone) === "payment",
    ) ||
    hasFilledValue(stage.paymentDate)
  );
}

function hasAdvancePaymentProgress(advance: AdvancePaymentDetail | undefined) {
  return (
    hasFilledValue(advance?.paymentDate) ||
    normalizeMilestoneName(advance?.currentMilestone) === "advancepayment" ||
    isAdvancePaymentCompletedByCheckbox(advance)
  );
}

function isAdvancePaymentCompletedByCheckbox(advance: AdvancePaymentDetail | undefined) {
  return normalizeCompletedMilestones(advance?.completedMilestones).some(
    (milestone) => normalizeMilestoneName(milestone) === "advancepayment",
  );
}

function getSupplyOrderChronologyWarnings(
  order: SupplyOrderDetail,
  orderLabel: string,
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected">,
) {
  const warnings: string[] = [];
  warnings.push(
    ...getPaymentChronologyWarnings(
      orderLabel,
      {
        soDate: order.soDate,
        dpDate: order.dpDate,
        revisedDp: order.revisedDp,
        materialReceiptDate: order.materialReceiptDate,
        billPreparationDate: order.billPreparationDate,
        billSentForPaymentDate: order.billSentForPaymentDate,
        paymentDate: order.paymentDate,
      },
      form,
      order.actualPaymentCapital,
      order.actualPaymentRevenue,
    ),
  );
  return warnings;
}

function getStageChronologyWarnings(
  stage: StageDeliveryDetail,
  order: SupplyOrderDetail,
  stageLabel: string,
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected">,
) {
  return getPaymentChronologyWarnings(
    stageLabel,
    {
      soDate: order.soDate,
      dpDate: stage.dpDate,
      revisedDp: stage.revisedDp,
      materialReceiptDate: stage.materialReceiptDate,
      billPreparationDate: stage.billPreparationDate,
      billSentForPaymentDate: stage.billSentForPaymentDate,
      paymentDate: stage.paymentDate,
    },
    form,
    stage.actualPaymentCapital,
    stage.actualPaymentRevenue,
  );
}

function getAdvancePaymentChronologyWarnings(
  advance: AdvancePaymentDetail,
  order: SupplyOrderDetail,
  orderLabel: string,
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected">,
) {
  return getPaymentChronologyWarnings(
    `${orderLabel} Advance Payment`,
    {
      soDate: order.soDate,
      billPreparationDate: advance.billPreparationDate,
      billSentForPaymentDate: advance.billSentForPaymentDate,
      paymentDate: advance.paymentDate,
    },
    form,
    advance.actualPaymentCapital,
    advance.actualPaymentRevenue,
  );
}

function getPaymentChronologyWarnings(
  label: string,
  dates: {
    soDate?: string;
    dpDate?: string;
    revisedDp?: string;
    materialReceiptDate?: string;
    billPreparationDate?: string;
    billSentForPaymentDate?: string;
    paymentDate?: string;
  },
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected">,
  actualPaymentCapital?: string,
  actualPaymentRevenue?: string,
) {
  const warnings: string[] = [];

  if (isDateBefore(dates.dpDate, dates.soDate)) {
    warnings.push(`${label}: D.P. date is earlier than S.O. date.`);
  }
  if (isDateBefore(dates.revisedDp, dates.soDate)) {
    warnings.push(`${label}: Revised D.P. date is earlier than S.O. date.`);
  }
  if (isDateBefore(dates.materialReceiptDate, dates.soDate)) {
    warnings.push(`${label}: Material receipt date is earlier than S.O. date.`);
  }
  if (isDateBefore(dates.billSentForPaymentDate, dates.billPreparationDate)) {
    warnings.push(`${label}: Bill sent for payment date is earlier than bill preparation date.`);
  }
  if (isDateBefore(dates.billSentForPaymentDate, dates.materialReceiptDate)) {
    warnings.push(`${label}: Bill sent for payment date is earlier than material receipt date.`);
  }
  if (isDateBefore(dates.billSentForPaymentDate, dates.soDate)) {
    warnings.push(`${label}: Bill sent for payment date is earlier than S.O. date.`);
  }
  if (isDateBefore(dates.paymentDate, dates.billSentForPaymentDate)) {
    warnings.push(`${label}: Payment date is earlier than bill sent for payment date.`);
  }
  if (isDateBefore(dates.paymentDate, dates.billPreparationDate)) {
    warnings.push(`${label}: Payment date is earlier than bill preparation date.`);
  }
  if (isDateBefore(dates.paymentDate, dates.materialReceiptDate)) {
    warnings.push(`${label}: Payment date is earlier than material receipt date.`);
  }
  if (isDateBefore(dates.paymentDate, dates.soDate)) {
    warnings.push(`${label}: Payment date is earlier than S.O. date.`);
  }
  if (
    hasFilledValue(dates.paymentDate) &&
    !hasSelectedAmount(actualPaymentCapital, actualPaymentRevenue, form)
  ) {
    warnings.push(`${label}: Payment date is filled, but Actual payment amount is missing.`);
  }

  return warnings;
}

function hasAnyOrderPaymentDate(order: SupplyOrderDetail) {
  return (
    hasFilledValue(order.paymentDate) ||
    hasFilledValue(order.advancePaymentDetail?.paymentDate) ||
    Boolean(order.stageDeliveries?.some((stage) => hasFilledValue(stage.paymentDate)))
  );
}

function isDateBefore(date: string | undefined, reference: string | undefined) {
  return hasFilledValue(date) && hasFilledValue(reference) && date! < reference!;
}

function isStagePaymentDetailsDue(stage: StageDeliveryDetail) {
  const effectiveDpDate = getLaterDate(stage.dpDate, stage.revisedDp);
  const dueDate = getNextLocalDate(effectiveDpDate);
  return hasFilledValue(dueDate) && dueDate! <= formatLocalDate(new Date());
}

function getStageDeliveryPeriodRibbonLabel(
  order: SupplyOrderDetail,
  stages: StageDeliveryDetail[],
  stageIndex: number,
) {
  const startDate = getStageDeliveryPeriodStartDate(order, stages, stageIndex);
  const endDate = getLaterDate(stages[stageIndex]?.dpDate, stages[stageIndex]?.revisedDp);
  return `Period: ${formatRibbonDate(startDate)} - ${formatRibbonDate(endDate)}`;
}

function getStageDeliveryPeriodStartDate(
  order: SupplyOrderDetail,
  stages: StageDeliveryDetail[],
  stageIndex: number,
) {
  const manualStartDate = stages[stageIndex]?.deliveryPeriodStartDate;
  if (hasFilledValue(manualStartDate)) return manualStartDate;
  if (stageIndex <= 0) return order.soDate;
  const previousStage = stages[stageIndex - 1];
  const previousEndDate = getLaterDate(previousStage?.dpDate, previousStage?.revisedDp);
  return getNextLocalDate(previousEndDate) ?? order.soDate;
}

function getNextLocalDate(date: string | undefined) {
  const parsed = parseLocalDate(date ?? "");
  if (!parsed) return undefined;
  parsed.setDate(parsed.getDate() + 1);
  return formatLocalDate(parsed);
}

function formatRibbonDate(date: string | undefined) {
  return hasFilledValue(date) ? String(date) : "Not set";
}

function getLaterDate(first: string | undefined, second: string | undefined) {
  if (!hasFilledValue(first)) return hasFilledValue(second) ? second : undefined;
  if (!hasFilledValue(second)) return first;
  return second! > first! ? second : first;
}

function hasAnyStagePaymentData(stages: StageDeliveryDetail[]) {
  return stages.some((stage) =>
    [
      stage.billPreparationDate,
      stage.billSentForPaymentDate,
      stage.paymentDate,
      stage.paymentMode,
      stage.actualPaymentCapital,
      stage.actualPaymentRevenue,
    ].some(hasFilledValue),
  );
}

function hasSelectedAmount(
  capital: string | undefined,
  revenue: string | undefined,
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected">,
) {
  if (form.valueCapitalSelected === "Yes") return hasNonZeroAmount(capital);
  if (form.valueRevenueSelected === "Yes") return hasNonZeroAmount(revenue);
  return hasNonZeroAmount(capital) || hasNonZeroAmount(revenue);
}

function hasWrongAmountSide(
  capital: string | undefined,
  revenue: string | undefined,
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected">,
) {
  return (
    (form.valueCapitalSelected === "Yes" && hasNonZeroAmount(revenue)) ||
    (form.valueRevenueSelected === "Yes" && hasNonZeroAmount(capital))
  );
}

function hasFilledObjectValue(value: Record<string, unknown>): boolean {
  return Object.values(value).some((item) => {
    if (Array.isArray(item))
      return item.some((row) => hasFilledObjectValue(row as Record<string, unknown>));
    return hasFilledValue(String(item ?? ""));
  });
}

function cleanAdvancePaymentDetail(row: AdvancePaymentDetail | undefined) {
  if (!row) return {};
  const normalized = applyAdvancePaymentRules(row);
  const completedMilestones = normalizeCompletedMilestones(normalized.completedMilestones);
  const cleaned = {
    currentMilestone: normalized.currentMilestone || undefined,
    completedMilestones: completedMilestones.length ? completedMilestones : undefined,
    stageAmountCapital: normalized.stageAmountCapital || undefined,
    stageAmountRevenue: normalized.stageAmountRevenue || undefined,
    billPreparationDate: normalized.billPreparationDate || undefined,
    billSentForPaymentDate: normalized.billSentForPaymentDate || undefined,
    paymentDate: normalized.paymentDate || undefined,
    paymentMode: normalized.paymentMode || undefined,
    actualPaymentCapital: normalized.actualPaymentCapital || undefined,
    actualPaymentRevenue: normalized.actualPaymentRevenue || undefined,
  };
  return Object.values(cleaned).some(Boolean) ? cleaned : {};
}

function cleanStageDeliveryRows(
  rows: StageDeliveryDetail[],
  form?: Pick<FormState, "fileType" | "valueCapitalSelected" | "valueRevenueSelected">,
  parentOrder?: SupplyOrderDetail,
) {
  const normalizedRows = rows.map((row) => applyStageDeliveryRules(row, form));
  const cleaned = normalizedRows.map((normalized, index) => {
    const effectiveRow = parentOrder
      ? getEffectiveStageFocusRow(normalized, parentOrder, index, normalizedRows)
      : normalized;
    const deliveryState = getDerivedDeliveryMilestoneState(effectiveRow, form?.fileType);
    const completedMilestones = normalizeCompletedMilestones(normalized.completedMilestones)
      .filter((milestone) => normalizeMilestoneName(milestone) !== "delivery")
      .concat(deliveryState.completed ? ["Delivery"] : []);
    const currentMilestone = deliveryState.current
      ? "Delivery"
      : normalizeMilestoneName(normalized.currentMilestone ?? "") === "delivery"
        ? ""
        : normalized.currentMilestone;
    return {
      stageAmountCapital: normalized.stageAmountCapital || undefined,
      stageAmountRevenue: normalized.stageAmountRevenue || undefined,
      currentMilestone: currentMilestone || undefined,
      completedMilestones: completedMilestones.length ? completedMilestones : undefined,
      deliveryPeriodStartDate: normalized.deliveryPeriodStartDate || undefined,
      dpDate: normalized.dpDate || undefined,
      dpExtension: normalized.dpExtension || undefined,
      dpExtensionCount: normalized.dpExtensionCount || undefined,
      ld: normalized.ld || undefined,
      ldType: normalized.ldType || undefined,
      ldPercentage: normalized.ldPercentage || undefined,
      revisedDp: normalized.revisedDp || undefined,
      materialReceiptDate: normalized.materialReceiptDate || undefined,
      irPreparationDate: normalized.irPreparationDate || undefined,
      irReceiptDate: normalized.irReceiptDate || undefined,
      billPreparationDate: normalized.billPreparationDate || undefined,
      billSentForPaymentDate: normalized.billSentForPaymentDate || undefined,
      paymentDate: normalized.paymentDate || undefined,
      paymentMode: normalized.paymentMode || undefined,
      actualPaymentCapital: normalized.actualPaymentCapital || undefined,
      actualPaymentRevenue: normalized.actualPaymentRevenue || undefined,
    };
  });
  return cleaned;
}

function normalizeSupplyOrderRows(file: FileRecord | undefined) {
  const rows =
    file?.supplyOrders
      ?.map((row) => applySupplyOrderRules({ ...emptySupplyOrder, ...row }, undefined))
      .filter((row) => Object.values(row).some(Boolean)) ?? [];
  if (rows.length) return rows;
  if (!file) return [];

  const legacy = applySupplyOrderRules(
    {
      soNo: file.soNo ?? "",
      gemSoNo: file.gemSoNo ?? "",
      soDate: file.soDate ?? "",
      soValueCapital: file.soValueCapital ?? "",
      soValueRevenue: file.soValueRevenue ?? "",
      dpDate: file.dpDate ?? "",
      firm: file.firm ?? "",
      firmType: "",
      firmTypeOther: "",
      bgValidityDate: file.bgValidityDate ?? "",
      dpExtension: file.dpExtension ?? "No",
      dpExtensionCount: file.dpExtensionCount ?? "",
      ld: file.ld ?? "",
      revisedDp: file.revisedDp ?? "",
      materialReceiptDate: file.materialReceiptDate ?? "",
      irPreparationDate: file.irPreparationDate ?? "",
      irReceiptDate: file.irReceiptDate ?? "",
      billPreparationDate: file.billPreparationDate ?? "",
      billSentForPaymentDate: file.billSentForPaymentDate ?? "",
      paymentDate: file.paymentDate ?? "",
      paymentMode: file.paymentMode ?? "",
      actualPaymentCapital: "",
      actualPaymentRevenue: "",
      bgReturnDate: file.bgReturnDate ?? "",
      soCancelled: file.soCancelled ?? "No",
      soCancelledDate: file.soCancelledDate ?? "",
      stageDelivery: "No",
      stageDeliveryCount: "",
      stagePayment: "No",
      advancePayment: "No",
      advancePaymentDetail: {},
      stageDeliveries: [],
    },
    undefined,
  );
  return Object.values(legacy).some(Boolean) ? [legacy] : [];
}

function legacySupplyOrderPatch(rows: SupplyOrderDetail[]) {
  if (!rows.length) return emptyLegacySupplyOrderPatch();

  const first = rows.find(hasMeaningfulSupplyOrderData);
  if (!first) return emptyLegacySupplyOrderPatch();
  return {
    financialSanctionDate: first.financialSanctionDate || null,
    soNo: first.soNo || null,
    gemSoNo: first.gemSoNo || null,
    soDate: first.soDate || null,
    soValueCapital: first.soValueCapital || null,
    soValueRevenue: first.soValueRevenue || null,
    dpDate: first.dpDate || null,
    firm: first.firm || null,
    bgValidityDate: first.bgValidityDate || null,
    dpExtension: first.dpExtension || null,
    dpExtensionCount: first.dpExtensionCount || null,
    ld: first.ld || null,
    revisedDp: first.revisedDp || null,
    materialReceiptDate: first.materialReceiptDate || null,
    irPreparationDate: first.irPreparationDate || null,
    irReceiptDate: first.irReceiptDate || null,
    billPreparationDate: first.billPreparationDate || null,
    billSentForPaymentDate: first.billSentForPaymentDate || null,
    paymentDate: first.paymentDate || null,
    paymentMode: first.paymentMode || null,
    actualPaymentCapital: first.actualPaymentCapital || null,
    actualPaymentRevenue: first.actualPaymentRevenue || null,
    bgReturnDate: first.bgReturnDate || null,
    soCancelled: first.soCancelled || null,
    soCancelledDate: first.soCancelledDate || null,
    stageDelivery: first.stageDelivery || null,
    stageDeliveryCount: first.stageDeliveryCount || null,
    stagePayment: first.stagePayment || null,
    advancePayment: first.advancePayment || null,
    advancePaymentDetail: cleanAdvancePaymentDetail(first.advancePaymentDetail),
    stageDeliveries: cleanStageDeliveryRows(first.stageDeliveries ?? [], undefined, first),
  };
}

function emptyLegacySupplyOrderPatch() {
  return {
    financialSanctionDate: null,
    soNo: null,
    gemSoNo: null,
    soDate: null,
    soValueCapital: null,
    soValueRevenue: null,
    dpDate: null,
    firm: null,
    bgValidityDate: null,
    dpExtension: null,
    dpExtensionCount: null,
    ld: null,
    revisedDp: null,
    materialReceiptDate: null,
    irPreparationDate: null,
    irReceiptDate: null,
    billPreparationDate: null,
    billSentForPaymentDate: null,
    paymentDate: null,
    paymentMode: null,
    actualPaymentCapital: null,
    actualPaymentRevenue: null,
    bgReturnDate: null,
    soCancelled: null,
    soCancelledDate: null,
    stageDelivery: null,
    stageDeliveryCount: null,
    stagePayment: null,
    advancePayment: null,
    advancePaymentDetail: {},
    stageDeliveries: [],
  };
}

function resizeSupplyOrders(rows: SupplyOrderDetail[], count: number) {
  return Array.from({ length: count }, (_, index) =>
    applySupplyOrderRules({ ...emptySupplyOrder, ...(rows[index] ?? {}) }, undefined),
  );
}

function resizeStageDeliveries(rows: StageDeliveryDetail[], count: number) {
  return Array.from({ length: count }, (_, index) =>
    applyStageDeliveryRules({ ...emptyStageDelivery, ...(rows[index] ?? {}) }),
  );
}

function clampSupplyOrderCount(value: string) {
  const count = Number.parseInt(value, 10);
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(50, count));
}

function getStageDeliveryCount(value: string | undefined) {
  const count = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(50, count));
}

function hasSavedSupplyOrders(file: FileRecord | undefined) {
  return normalizeSupplyOrderRows(file).length > 0;
}

function hasPlacedSupplyOrderRows(rows: SupplyOrderDetail[]) {
  return rows.some((row) => hasFilledValue(row.soDate));
}

function hasSavedFirmDetails(file: FileRecord | undefined) {
  return Boolean(cleanFirmRows(file?.invitedFirms ?? []) || cleanFirmRows(file?.bidderFirms ?? []));
}

function applyConditionalRules(form: FormState) {
  let next = form;
  if (isInr(next.currency) && !next.exchangeRate) {
    next = {
      ...next,
      exchangeRate: "1",
    };
  }
  if (next.valueCapitalSelected === "Yes") {
    next = {
      ...next,
      valueRevenue: "",
      valueRevenueSelected: "",
      soValueRevenue: "",
    };
  }
  if (next.valueRevenueSelected === "Yes") {
    next = {
      ...next,
      valueCapital: "",
      valueCapitalSelected: "",
      soValueCapital: "",
    };
  }
  if (isNo(next.tcec)) {
    next = {
      ...next,
      highValueMeetingDate: "",
      highValueMinutesDate: "",
      preTcecDate: "",
      preTcecMinutesDate: "",
      preTcecCommitteeNo: "",
      adVettingDate: "",
      postTcecDate: "",
      postTcecMinutesDate: "",
      postTcecCommitteeNumber: "",
      cncDate: "",
      cncApprovalDate: "",
    };
  }
  if (isNo(next.gem)) {
    next = {
      ...next,
      gemUndertakingDate: "",
      gemSoNo: "",
    };
  }
  if (isNo(next.highValue)) {
    next = {
      ...next,
      highValueMeetingDate: "",
      highValueMinutesDate: "",
    };
  }
  if (isYes(next.gem) && !next.paymentMode) {
    next = {
      ...next,
      paymentMode: "Online",
    };
  }
  if (isNo(next.rqa)) {
    next = {
      ...next,
      rqaApprovalDate: "",
    };
  }
  if (isNo(next.ifa)) {
    next = {
      ...next,
      ifaSentDate: "",
      ifaFinalDate: "",
    };
  }
  if (isNo(next.bg)) {
    next = {
      ...next,
      bgValidityDate: "",
      bgReturnDate: "",
    };
  }
  if (isDeliveryInspectionInactive(next)) {
    next = {
      ...next,
      ir: "No",
      irPreparationDate: "",
      irReceiptDate: "",
    };
  }
  if (isNo(next.rfpVetting)) {
    next = {
      ...next,
      rfpVettingInitiationDate: "",
      rfpVettingApprovalDate: "",
    };
  }
  if (isNo(next.demandCancelled)) {
    next = {
      ...next,
      demandCancelledDate: "",
    };
  }
  if (isNo(next.refloat)) {
    next = {
      ...next,
      refloatBiddingDate: "",
      refloatBidOpeningDate: "",
    };
  }
  if (isYes(next.dpExtension)) {
    next = {
      ...next,
      dpExtensionCount: getInitialExtensionCount(next.dpExtensionCount),
    };
  }
  if (isNo(next.dpExtension)) {
    next = {
      ...next,
      dpExtensionCount: "",
    };
  }
  next = {
    ...next,
    tenderLive: getAutoTenderLive(next),
  };
  if (isYes(next.tenderLive)) {
    next = {
      ...next,
      bidOpened: "NO",
    };
  }
  return next;
}

function applySupplyOrderRules(
  order: SupplyOrderDetail,
  form:
    | (Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected"> &
        Partial<Pick<FormState, "bg" | "ir" | "fileType">>)
    | undefined,
) {
  let next: SupplyOrderDetail = { ...emptySupplyOrder, ...order };
  const dpExtensionInactive = isDpExtensionInactiveFileType(form?.fileType);
  if (form?.valueCapitalSelected === "Yes") {
    next = {
      ...next,
      soValueRevenue: "",
      actualPaymentRevenue: "",
      advancePaymentDetail: applyAdvancePaymentValueTypeRules(
        next.advancePaymentDetail ?? {},
        form,
      ),
    };
  }
  if (form?.valueRevenueSelected === "Yes") {
    next = {
      ...next,
      soValueCapital: "",
      actualPaymentCapital: "",
      advancePaymentDetail: applyAdvancePaymentValueTypeRules(
        next.advancePaymentDetail ?? {},
        form,
      ),
    };
  }
  if (isYes(next.dpExtension ?? "")) {
    next = { ...next, dpExtensionCount: getInitialExtensionCount(next.dpExtensionCount ?? "") };
  }
  if (isNo(next.dpExtension ?? "")) {
    next = { ...next, dpExtensionCount: "" };
  }
  if (!isYes(next.ld ?? "")) {
    next = { ...next, ldType: "", ldPercentage: "" };
  }
  if ((next.firmType ?? "").trim().toUpperCase() !== "OTHER") {
    next = { ...next, firmTypeOther: "" };
  }
  if (!hasFilledValue(next.stageDelivery)) {
    next = { ...next, stageDelivery: "No" };
  }
  if (!hasFilledValue(next.stagePayment)) {
    next = { ...next, stagePayment: "No" };
  }
  if (!hasFilledValue(next.advancePayment)) {
    next = { ...next, advancePayment: "No" };
  }
  if (isNo(next.stageDelivery ?? "")) {
    next = {
      ...next,
      stageDeliveryCount: "",
      stagePayment: "No",
      advancePayment: "No",
      advancePaymentDetail: {},
      stageDeliveries: [],
    };
  }
  if (isYes(next.stageDelivery ?? "")) {
    const stageDeliveryCount = String(getStageDeliveryCount(next.stageDeliveryCount));
    next = {
      ...next,
      stageDeliveryCount,
      stageDeliveries: resizeStageDeliveries(
        next.stageDeliveries ?? [],
        getStageDeliveryCount(stageDeliveryCount),
      ).map((stage) =>
        applyStageDeliveryValueTypeRules(applyStageDeliveryRules(stage, form), form),
      ),
    };
  }
  if (isNo(next.stagePayment ?? "")) {
    next = {
      ...next,
      advancePayment: "No",
      advancePaymentDetail: {},
      stageDeliveries: (next.stageDeliveries ?? []).map((stage) =>
        applyStageDeliveryRules({
          ...stage,
          billPreparationDate: "",
          billSentForPaymentDate: "",
          paymentDate: "",
          paymentMode: "",
          actualPaymentCapital: "",
          actualPaymentRevenue: "",
        }),
      ),
    };
  }
  if (isNo(next.advancePayment ?? "")) {
    next = { ...next, advancePaymentDetail: {} };
  }
  if (!isYes(next.ld ?? "")) {
    next = { ...next, ldType: "", ldPercentage: "" };
  }
  if (isYes(next.advancePayment ?? "")) {
    next = {
      ...next,
      advancePaymentDetail: applyAdvancePaymentValueTypeRules(
        next.advancePaymentDetail ?? {},
        form,
      ),
    };
  }
  if (dpExtensionInactive) {
    next = {
      ...next,
      dpExtension: "No",
      dpExtensionCount: "",
      revisedDp: "",
      stageDeliveries: (next.stageDeliveries ?? []).map((stage) =>
        applyStageDeliveryRules(stage, form),
      ),
    };
  }
  next = normalizeSupplyOrderMilestoneState(next, form);
  return next;
}

function normalizeSupplyOrderMilestoneState(
  order: SupplyOrderDetail,
  form: Partial<Pick<FormState, "bg" | "ir">> | undefined,
) {
  const deliveryState = getDerivedDeliveryMilestoneState(order, form?.fileType);
  const applicable = getApplicableSupplyOrderMilestones(order, {
    bgDisabled: form ? isNo(form.bg) : false,
    irDisabled: form ? isNo(form.ir) : false,
  });
  const applicableByKey = new Map<string, string>(
    applicable.map((milestone) => [normalizeMilestoneName(milestone), milestone]),
  );
  const completedMilestones = normalizeCompletedMilestones(order.completedMilestones)
    .map((milestone) => applicableByKey.get(normalizeMilestoneName(milestone)))
    .filter((milestone): milestone is string => Boolean(milestone));
  const completedWithDerivedDelivery = deliveryState.completed
    ? [...completedMilestones.filter((milestone) => milestone !== "Delivery"), "Delivery"]
    : completedMilestones;
  const manualCurrentMilestone =
    applicableByKey.get(normalizeMilestoneName(order.currentMilestone ?? "")) ?? "";
  const currentMilestone = deliveryState.current
    ? "Delivery"
    : manualCurrentMilestone === "Delivery"
      ? ""
      : manualCurrentMilestone;
  return {
    ...order,
    currentMilestone: completedWithDerivedDelivery.includes(currentMilestone)
      ? ""
      : currentMilestone,
    completedMilestones: Array.from(new Set(completedWithDerivedDelivery)),
  };
}

function applyAdvancePaymentRules(advancePayment: AdvancePaymentDetail) {
  return { ...emptyAdvancePayment, ...advancePayment };
}

function applyAdvancePaymentValueTypeRules(
  advancePayment: AdvancePaymentDetail,
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected"> | undefined,
) {
  let next = applyAdvancePaymentRules(advancePayment);
  if (form?.valueCapitalSelected === "Yes") {
    next = { ...next, stageAmountRevenue: "", actualPaymentRevenue: "" };
  }
  if (form?.valueRevenueSelected === "Yes") {
    next = { ...next, stageAmountCapital: "", actualPaymentCapital: "" };
  }
  return next;
}

function shouldAutoFillStageDeliveryOnChange(key: SupplyOrderKey, order: SupplyOrderDetail) {
  return (
    [
      "soDate",
      "soValueCapital",
      "soValueRevenue",
      "stageDelivery",
      "stageDeliveryCount",
      "stagePayment",
    ].includes(key) &&
    isYes(order.stageDelivery ?? "") &&
    getStageDeliveryCount(order.stageDeliveryCount) > 0 &&
    hasDate(order.soDate ?? "")
  );
}

function autoFillStageDeliveries(
  order: SupplyOrderDetail,
  form:
    | Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected" | "fileType">
    | undefined,
) {
  const stageCount = getStageDeliveryCount(order.stageDeliveryCount);
  const soDate = parseLocalDate(order.soDate ?? "");
  if (!stageCount || !soDate) return { order, changed: false };

  const capitalAmounts = getProportionalStageAmounts(order.soValueCapital, stageCount);
  const revenueAmounts = getProportionalStageAmounts(order.soValueRevenue, stageCount);
  const useCapital = hasNonZeroAmount(order.soValueCapital);
  const useRevenue = !useCapital && hasNonZeroAmount(order.soValueRevenue);
  const baseStages = resizeStageDeliveries(order.stageDeliveries ?? [], stageCount);
  let previousEndDate: string | undefined;
  const stages = baseStages.map((stage, index) => {
    const suggestedStartDate = index === 0 ? order.soDate : getNextLocalDate(previousEndDate);
    const effectiveStartDate = stage.deliveryPeriodStartDate || suggestedStartDate || "";
    const suggestedEndDate = getStageIntervalEndDate(effectiveStartDate, form?.fileType);
    const nextStage = applyStageDeliveryValueTypeRules(
      applyStageDeliveryRules({
        ...stage,
        deliveryPeriodStartDate: effectiveStartDate,
        dpDate: stage.dpDate || suggestedEndDate || "",
        stageAmountCapital:
          useCapital && capitalAmounts[index] !== undefined
            ? capitalAmounts[index]
            : useRevenue
              ? ""
              : stage.stageAmountCapital,
        stageAmountRevenue:
          useRevenue && revenueAmounts[index] !== undefined
            ? revenueAmounts[index]
            : useCapital
              ? ""
              : stage.stageAmountRevenue,
      }),
      form,
    );
    previousEndDate = getLaterDate(nextStage.dpDate, nextStage.revisedDp);
    return nextStage;
  });

  return {
    order: applySupplyOrderRules({ ...order, stageDeliveries: stages }, form),
    changed: true,
  };
}

function hasExistingStageAutofillValues(order: SupplyOrderDetail) {
  const stageCount = getStageDeliveryCount(order.stageDeliveryCount);
  return resizeStageDeliveries(order.stageDeliveries ?? [], stageCount).some((stage) =>
    [stage.dpDate, stage.stageAmountCapital, stage.stageAmountRevenue].some(hasFilledValue),
  );
}

function getStageIntervalEndDate(startDate: string, fileType: string | undefined) {
  const parsedStart = parseLocalDate(startDate);
  if (!parsedStart) return "";
  const { date: endDate, clamped } = addCalendarMonthsClamped(
    parsedStart,
    getStageIntervalMonths(fileType),
  );
  if (!clamped) {
    endDate.setDate(endDate.getDate() - 1);
  }
  return formatLocalDate(endDate);
}

function getStageIntervalMonths(fileType: string | undefined) {
  return (fileType ?? "").trim().toLowerCase() === "mpc" ? 1 : 3;
}

function addCalendarMonthsClamped(date: Date, months: number) {
  const targetMonthIndex = date.getMonth() + months;
  const targetYear = date.getFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const targetDay = Math.min(date.getDate(), lastDayOfTargetMonth);
  return {
    date: new Date(targetYear, targetMonth, targetDay),
    clamped: targetDay !== date.getDate(),
  };
}

function getProportionalStageAmounts(value: string | undefined, stageCount: number) {
  const amount = parseMoneyAmount(value);
  if (amount === undefined || amount === 0 || stageCount <= 0) return [];
  const cents = Math.round(amount * 100);
  const baseCents = Math.floor(cents / stageCount);
  let remainingCents = cents;
  return Array.from({ length: stageCount }, (_, index) => {
    const stageCents = index === stageCount - 1 ? remainingCents : baseCents;
    remainingCents -= stageCents;
    return formatDecimalInput((stageCents / 100).toFixed(2));
  });
}

function applyStageDeliveryRules(
  stage: StageDeliveryDetail,
  form?: Partial<Pick<FormState, "fileType">>,
) {
  let next: StageDeliveryDetail = { ...emptyStageDelivery, ...stage };
  if (isDpExtensionInactiveFileType(form?.fileType)) {
    next = {
      ...next,
      dpExtension: "No",
      dpExtensionCount: "",
      revisedDp: "",
    };
  }
  if (isYes(next.dpExtension ?? "")) {
    next = { ...next, dpExtensionCount: getInitialExtensionCount(next.dpExtensionCount ?? "") };
  }
  if (isNo(next.dpExtension ?? "")) {
    next = { ...next, dpExtensionCount: "" };
  }
  return next;
}

function applyStageDeliveryValueTypeRules(
  stage: StageDeliveryDetail,
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected"> | undefined,
) {
  let next = stage;
  if (form?.valueCapitalSelected === "Yes") {
    next = { ...next, stageAmountRevenue: "", actualPaymentRevenue: "" };
  }
  if (form?.valueRevenueSelected === "Yes") {
    next = { ...next, stageAmountCapital: "", actualPaymentCapital: "" };
  }
  return next;
}

function getSupplyOrderPatch(
  order: SupplyOrderDetail,
  key: SupplyOrderKey,
  value: string,
): SupplyOrderDetail {
  if (key === "stageDeliveryCount") {
    return applySupplyOrderRules({ ...order, [key]: formatIntegerInput(value) }, undefined);
  }

  if (key === "ldPercentage") {
    return applySupplyOrderRules({ ...order, [key]: formatPercentageInput(value) }, undefined);
  }

  if (
    key !== "soValueCapital" &&
    key !== "soValueRevenue" &&
    key !== "actualPaymentCapital" &&
    key !== "actualPaymentRevenue"
  ) {
    return applySupplyOrderRules({ ...order, [key]: value }, undefined);
  }

  const amount = formatDecimalInput(value);
  const pairedKey =
    key === "soValueCapital"
      ? "soValueRevenue"
      : key === "soValueRevenue"
        ? "soValueCapital"
        : key === "actualPaymentCapital"
          ? "actualPaymentRevenue"
          : "actualPaymentCapital";
  return {
    ...order,
    [key]: amount,
    ...(hasNonZeroAmount(amount) ? { [pairedKey]: "" } : {}),
  };
}

function hasNonZeroAmount(value: unknown) {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return false;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount !== 0;
}

function findValueThresholdMatch(
  levels: ValueThresholdLevel[] | undefined,
  form: Pick<
    FormState,
    | "valueCapital"
    | "valueRevenue"
    | "valueCapitalSelected"
    | "valueRevenueSelected"
    | "currency"
    | "exchangeRate"
  >,
) {
  if (!levels?.length) return undefined;
  const valueType =
    form.valueCapitalSelected === "Yes"
      ? "capital"
      : form.valueRevenueSelected === "Yes"
        ? "revenue"
        : undefined;
  if (!valueType) return undefined;
  const amount = parseMoneyAmount(valueType === "capital" ? form.valueCapital : form.valueRevenue);
  if (amount === undefined) return undefined;
  const currency = (form.currency || "INR").trim().toUpperCase();
  const exchangeRate = currency && currency !== "INR" ? parseMoneyAmount(form.exchangeRate) : 1;
  if (exchangeRate === undefined || exchangeRate <= 0) return undefined;
  const inrAmount = amount * exchangeRate;

  return levels.find((level) => {
    if (level.appliesTo !== "both" && level.appliesTo !== valueType) return false;
    const min = parseMoneyAmount(level.minValue);
    const max = parseMoneyAmount(level.maxValue);
    if (min !== undefined && inrAmount < min) return false;
    if (max !== undefined && inrAmount > max) return false;
    return true;
  });
}

function parseMoneyAmount(value: string | undefined) {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return undefined;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : undefined;
}

function isNo(value: unknown) {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === "no"
  );
}

function isYes(value: unknown) {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === "yes"
  );
}

function isDeliveryInspectionInactive(form: Pick<FormState, "fileType" | "mode">) {
  return isStageDeliveryFileType(form.fileType);
}

function isStageDeliveryFileType(fileType: string | undefined) {
  const normalized = (fileType ?? "").trim().toLowerCase();
  return (
    normalized === "amc" || normalized === "mpc" || normalized === "cars" || normalized === "o&m"
  );
}

function isDpExpiryWordHiddenFileType(fileType: string | undefined) {
  const normalized = (fileType ?? "").trim().toLowerCase();
  return normalized === "amc" || normalized === "mpc" || normalized === "o&m";
}

function isDpExtensionInactiveFileType(fileType: string | undefined) {
  const normalized = (fileType ?? "").trim().toLowerCase();
  return normalized === "amc" || normalized === "mpc" || normalized === "o&m";
}

function isDpExtensionFieldInactive(form: Pick<FormState, "fileType">, key: string) {
  return (
    isDpExtensionInactiveFileType(form.fileType) &&
    (key === "dpExtension" || key === "dpExtensionCount" || key === "revisedDp")
  );
}

function shouldShowSupplyOrderField(key: SupplyOrderKey, order: SupplyOrderDetail) {
  if (key === "stageDeliveryCount" || key === "stagePayment") {
    return isYes(order.stageDelivery ?? "");
  }
  if (key === "advancePayment") {
    return isYes(order.stageDelivery ?? "") && isYes(order.stagePayment ?? "");
  }
  return true;
}

function isSupplyOrderFieldSequentiallyLocked(key: SupplyOrderKey, order: SupplyOrderDetail) {
  return isSupplyOrderFieldMissingPrerequisite(key, order, new Set());
}

function isSupplyOrderFieldMissingPrerequisite(
  key: SupplyOrderKey,
  order: SupplyOrderDetail,
  visited: Set<SupplyOrderKey>,
) {
  if (visited.has(key)) return false;
  visited.add(key);
  const prerequisites = supplyOrderFieldPrerequisites[key] ?? [];
  return prerequisites.some(
    (prerequisite) =>
      !hasFilledValue(String(order[prerequisite] ?? "")) ||
      isSupplyOrderFieldMissingPrerequisite(prerequisite, order, visited),
  );
}

function isInr(value: string | undefined) {
  return (value ?? "").trim().toUpperCase() === "INR";
}

function getInitialExtensionCount(value: string) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? value : "1";
}

function getAutoTenderLive(form: FormState) {
  if (hasDate(form.refloatBiddingDate) && hasDate(form.refloatBidOpeningDate)) {
    return isTenderLiveOnCalendarDate(form.refloatBiddingDate, form.refloatBidOpeningDate)
      ? "Yes"
      : "No";
  }

  return isTenderLiveOnCalendarDate(form.bidDate, form.bidOpeningDate) ? "Yes" : "No";
}

function isTenderLiveOnCalendarDate(bidDate: string, bidOpeningDate: string) {
  const bidTime = parseLocalDateTime(bidDate);
  const openingTime = parseLocalDateTime(bidOpeningDate);
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));

  if (bidTime === undefined || openingTime === undefined || todayTime === undefined) {
    return false;
  }

  return bidTime <= todayTime && todayTime <= openingTime;
}

function hasDate(date: string) {
  return parseLocalDateTime(date) !== undefined;
}

function parseLocalDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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

function isDivisionAdNo(divisionName: string, divisions: ReturnType<typeof useDivisions>) {
  const division = divisions.find(
    (item) => item.name.trim().toLowerCase() === divisionName.trim().toLowerCase(),
  );
  return isNo(division?.ad ?? "");
}

function clearDivisionDisabledFields(form: FormState, divisions: ReturnType<typeof useDivisions>) {
  return isDivisionAdNo(form.division, divisions) ? { ...form, adVettingDate: "" } : form;
}

function getEnabledTimelineFields(form: FormState, divisions: ReturnType<typeof useDivisions>) {
  return timelineFields.filter((field) => !isTimelineFieldDisabled(field.key, form, divisions));
}

function isTimelineFieldDisabled(
  key: FieldKey,
  form: FormState,
  divisions: ReturnType<typeof useDivisions>,
) {
  return (
    (key === "adVettingDate" && isDivisionAdNo(form.division, divisions)) ||
    (isNo(form.tcec) && tcecDisabledKeys.includes(key)) ||
    (isNo(form.gem) && gemDisabledKeys.includes(key)) ||
    (isNo(form.highValue) && highValueDisabledKeys.includes(key)) ||
    (isNo(form.rqa) && rqaDisabledKeys.includes(key)) ||
    (isNo(form.ifa) && ifaDisabledKeys.includes(key)) ||
    (isNo(form.bg) && bgDisabledKeys.includes(key)) ||
    (isNo(form.rfpVetting) && rfpVettingDisabledKeys.includes(key)) ||
    (isNo(form.refloat) && refloatDisabledKeys.includes(key))
  );
}

function getSavedFileValue(file: FileRecord | undefined, key: FieldKey) {
  if (!file) return undefined;
  return (file as Record<string, unknown>)[key];
}

function generateUniqueCode(
  financialYear: string,
  divisionName: string,
  divisions: ReturnType<typeof useDivisions>,
  files: FileRecord[],
) {
  const division = divisions.find(
    (item) => item.name.trim().toLowerCase() === divisionName.trim().toLowerCase(),
  );
  const divisionCode = getDivisionCodeForUniqueCode(division?.code, division?.name ?? divisionName);
  const yearCode = getFinancialYearCode(financialYear);
  if (!yearCode || !divisionCode) return "";

  const prefix = `${yearCode}${divisionCode}`;
  const nextSerial =
    files.reduce((max, file) => {
      if (!file.uniqueCode?.startsWith(prefix)) return max;
      const serial = Number(file.uniqueCode.slice(prefix.length));
      return Number.isFinite(serial) ? Math.max(max, serial) : max;
    }, 0) + 1;

  return `${prefix}${String(nextSerial).padStart(3, "0")}`;
}

function getDivisionCodeForUniqueCode(code: string | undefined, name: string) {
  const explicitCode = (code ?? "").replace(/\s+/g, "").toUpperCase();
  if (explicitCode) return explicitCode;
  const words = name
    .trim()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  const initials = words.map((word) => word[0]).join("").toUpperCase();
  return initials || name.replace(/[^a-z0-9]+/gi, "").slice(0, 4).toUpperCase();
}

function getFinancialYearCode(financialYear: string) {
  const label = financialYear.trim();
  const startYearMatch = label.match(/\b(19\d{2}|20\d{2})\b/);
  if (startYearMatch) return startYearMatch[1].slice(-2);
  return label.replace(/\D/g, "").slice(0, 2);
}

function ValueField({
  capitalValue,
  revenueValue,
  capitalSelected,
  revenueSelected,
  thresholdMatch,
  disabled,
  lockFilledFields = false,
  lockedSelectionFilled = false,
  lockedValueFilled = false,
  onChange,
}: {
  capitalValue: string;
  revenueValue: string;
  capitalSelected: boolean;
  revenueSelected: boolean;
  thresholdMatch?: ValueThresholdLevel;
  disabled: boolean;
  lockFilledFields?: boolean;
  lockedSelectionFilled?: boolean;
  lockedValueFilled?: boolean;
  onChange: (
    patch: Pick<
      FormState,
      "valueCapital" | "valueRevenue" | "valueCapitalSelected" | "valueRevenueSelected"
    >,
  ) => void;
}) {
  const value = capitalSelected ? capitalValue : revenueSelected ? revenueValue : "";
  const selected = capitalSelected || revenueSelected;
  const selectionDisabled = disabled || (lockFilledFields && lockedSelectionFilled);
  const valueDisabled = disabled || !selected || (lockFilledFields && lockedValueFilled);

  const updateCapital = (checked: boolean) => {
    onChange({
      valueCapital: checked ? value : "",
      valueRevenue: "",
      valueCapitalSelected: checked ? "Yes" : "",
      valueRevenueSelected: "",
    });
  };

  const updateRevenue = (checked: boolean) => {
    onChange({
      valueCapital: "",
      valueRevenue: checked ? value : "",
      valueCapitalSelected: "",
      valueRevenueSelected: checked ? "Yes" : "",
    });
  };

  const updateValue = (nextValue: string) => {
    const cleanedValue = formatDecimalInput(nextValue);
    onChange({
      valueCapital: capitalSelected ? cleanedValue : "",
      valueRevenue: !capitalSelected && revenueSelected ? cleanedValue : "",
      valueCapitalSelected: capitalSelected ? "Yes" : "",
      valueRevenueSelected: !capitalSelected && revenueSelected ? "Yes" : "",
    });
  };

  return (
    <Field label="Value">
      <div className={`space-y-2 ${disabledCls(disabled)}`}>
        <div className="grid max-w-md grid-cols-2 gap-2">
          <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
            <input
              type="checkbox"
              checked={capitalSelected}
              disabled={selectionDisabled}
              onChange={(event) => updateCapital(event.target.checked)}
              className="size-4 rounded border-input"
            />
            Capital
          </label>
          <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
            <input
              type="checkbox"
              checked={revenueSelected}
              disabled={selectionDisabled}
              onChange={(event) => updateRevenue(event.target.checked)}
              className="size-4 rounded border-input"
            />
            Revenue
          </label>
        </div>
        <input
          value={value}
          onChange={(event) => updateValue(event.target.value)}
          inputMode="decimal"
          disabled={valueDisabled}
          placeholder="Enter value"
          className={inputCls + disabledCls(valueDisabled)}
        />
        <div className="min-h-5 text-xs text-muted-foreground">
          {thresholdMatch
            ? `Threshold: ${thresholdMatch.label}`
            : selected
              ? "No threshold level matched."
              : "Select Capital or Revenue to match a threshold."}
        </div>
      </div>
    </Field>
  );
}

function SoValueField({
  capitalSelected,
  revenueSelected,
  capitalValue,
  revenueValue,
  disabled,
  lockFilledFields = false,
  lockedValueFilled = false,
  onChange,
}: {
  capitalSelected: boolean;
  revenueSelected: boolean;
  capitalValue: string;
  revenueValue: string;
  disabled: boolean;
  lockFilledFields?: boolean;
  lockedValueFilled?: boolean;
  onChange: (patch: Pick<FormState, "soValueCapital" | "soValueRevenue">) => void;
}) {
  return (
    <AmountByValueTypeField
      label="S.O. value"
      capitalSelected={capitalSelected}
      revenueSelected={revenueSelected}
      capitalValue={capitalValue}
      revenueValue={revenueValue}
      disabled={disabled}
      lockFilledFields={lockFilledFields}
      lockedValueFilled={lockedValueFilled}
      onChange={(patch) =>
        onChange({
          soValueCapital: patch.capital ?? "",
          soValueRevenue: patch.revenue ?? "",
        })
      }
    />
  );
}

function AmountByValueTypeField({
  label,
  capitalSelected,
  revenueSelected,
  capitalValue,
  revenueValue,
  disabled,
  lockFilledFields = false,
  lockedValueFilled = false,
  onChange,
}: {
  label: string;
  capitalSelected: boolean;
  revenueSelected: boolean;
  capitalValue: string;
  revenueValue: string;
  disabled: boolean;
  lockFilledFields?: boolean;
  lockedValueFilled?: boolean;
  onChange: (patch: { capital?: string; revenue?: string }) => void;
}) {
  const selectedType = capitalSelected ? "Capital" : revenueSelected ? "Revenue" : "";
  const value = capitalSelected ? capitalValue : revenueSelected ? revenueValue : "";
  const fieldDisabled = disabled || !selectedType || (lockFilledFields && lockedValueFilled);

  const updateValue = (nextValue: string) => {
    const cleanedValue = formatDecimalInput(nextValue);
    onChange({
      capital: capitalSelected ? cleanedValue : "",
      revenue: revenueSelected ? cleanedValue : "",
    });
  };

  return (
    <Field label={label}>
      <div className={`space-y-2 ${disabledCls(fieldDisabled)}`}>
        <div className="grid max-w-md grid-cols-2 gap-2">
          <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
            <input
              type="checkbox"
              checked={capitalSelected}
              readOnly
              disabled
              className="size-4 rounded border-input"
            />
            Capital
          </label>
          <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
            <input
              type="checkbox"
              checked={revenueSelected}
              readOnly
              disabled
              className="size-4 rounded border-input"
            />
            Revenue
          </label>
        </div>
        <input
          value={value}
          onChange={(event) => updateValue(event.target.value)}
          inputMode="decimal"
          disabled={fieldDisabled}
          placeholder={
            selectedType
              ? `Enter S.O. ${selectedType.toLowerCase()} value`
              : "Select Capital or Revenue above"
          }
          className={inputCls + disabledCls(fieldDisabled)}
        />
      </div>
    </Field>
  );
}

function DynamicField({
  field,
  value,
  disabled = false,
  onChange,
  inputRef,
  radioName,
}: {
  field: ExtraField<FieldKey | SupplyOrderKey | StageDeliveryKey>;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  inputRef?: (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null) => void;
  radioName?: string;
}) {
  if (field.options && (field.control === "radio" || isYesNoOptions(field.options))) {
    return (
      <Field label={field.label}>
        <RadioGroup
          name={radioName ?? field.key}
          options={field.options}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      </Field>
    );
  }

  if (field.typeahead && field.options) {
    const listId = `${field.key}-options`;
    return (
      <Field label={field.label}>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.placeholder}
          list={listId}
          className={inputCls + disabledCls(disabled)}
        />
        <datalist id={listId}>
          {field.options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </Field>
    );
  }

  if (field.options) {
    return (
      <Field label={field.label}>
        <select
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={inputCls + disabledCls(disabled)}
        >
          <option value="">Select</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  if (field.type === "textarea") {
    return (
      <Field label={field.label}>
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.placeholder}
          className={textareaCls + disabledCls(disabled)}
        />
      </Field>
    );
  }

  return (
    <Field label={field.label}>
      <input
        ref={inputRef}
        type={field.key === "exchangeRate" ? "text" : (field.type ?? "text")}
        value={value}
        onChange={(e) =>
          onChange(
            field.key === "exchangeRate"
              ? formatDecimalInput(e.target.value)
              : field.type === "date"
                ? clampDateYearInput(e.target.value)
                : e.target.value,
          )
        }
        disabled={disabled}
        max={field.type === "date" ? "9999-12-31" : undefined}
        min={
          field.type === "number"
            ? field.key === "noOfSo"
              ? Math.max(1, field.min ?? 1)
              : field.min ?? 0
            : undefined
        }
        step={field.key === "exchangeRate" ? "any" : field.type === "number" ? 1 : undefined}
        inputMode={field.key === "exchangeRate" ? "decimal" : undefined}
        placeholder={field.placeholder}
        className={inputCls + disabledCls(disabled)}
      />
    </Field>
  );
}

function LdDetailField({
  ldType,
  ldPercentage,
  disabled,
  onTypeChange,
  onPercentageChange,
}: {
  ldType: string;
  ldPercentage: string;
  disabled: boolean;
  onTypeChange: (value: string) => void;
  onPercentageChange: (value: string) => void;
}) {
  const normalizedType = ldType.trim();
  const toggleType = (value: string) => {
    if (disabled) return;
    onTypeChange(normalizedType === value ? "" : value);
  };
  return (
    <Field label="LD detail">
      <div className="grid gap-2 rounded-md border border-border bg-secondary/20 p-2">
        <div className="flex flex-wrap gap-3 text-sm">
          {["Full", "Partial"].map((option) => (
            <label key={option} className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={normalizedType === option}
                disabled={disabled}
                onChange={() => toggleType(option)}
                className="size-4 accent-primary disabled:cursor-not-allowed"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
        <div className="relative">
          <input
            value={ldPercentage}
            onChange={(event) => onPercentageChange(event.target.value)}
            disabled={disabled}
            inputMode="decimal"
            placeholder="Enter LD"
            className={inputCls + " pr-8" + disabledCls(disabled)}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
            %
          </span>
        </div>
      </div>
    </Field>
  );
}

function disabledCls(disabled: boolean) {
  return disabled ? " opacity-60 cursor-not-allowed" : "";
}

function hasFilledValue(value: unknown) {
  return Boolean(String(value ?? "").trim());
}

function hasFileValueForLock(form: FormState, key: FieldKey) {
  return hasFilledValue(String(form[key] ?? ""));
}

function getUnfilledFieldKeys(
  section: (typeof extraSections)[number],
  form: FormState,
  divisions: ReturnType<typeof useDivisions>,
) {
  return section.fields
    .filter(
      (field) =>
        !["uniqueCode", "tenderLive"].includes(field.key) &&
        !isTimelineFieldDisabled(field.key, form, divisions) &&
        !hasFilledValue(String(form[field.key] ?? "")),
    )
    .map((field) => field.key);
}

function formatDecimalInput(value: string) {
  const digitsAndDots = value.replace(/[^\d.]/g, "");
  const [first, ...rest] = digitsAndDots.split(".");
  const decimalPart = rest.join("");
  const formattedInteger = formatThousandsAndLakhs(first);
  return rest.length > 0 ? `${formattedInteger}.${decimalPart}` : formattedInteger;
}

function formatPercentageInput(value: string) {
  const formatted = formatDecimalInput(value);
  const amount = Number(formatted.replace(/,/g, ""));
  if (!Number.isFinite(amount)) return formatted;
  if (amount > 100) return "100";
  return formatted;
}

function formatIntegerInput(value: string) {
  return value.replace(/\D/g, "");
}

function clampDateYearInput(value: string) {
  const [year = "", ...rest] = value.split("-");
  if (year.length <= 4) return value;
  return [year.slice(0, 4), ...rest].join("-");
}

function formatThousandsAndLakhs(integerPart: string) {
  const lastThree = integerPart.slice(-3);
  const beforeThousands = integerPart.slice(0, -3);

  if (!beforeThousands) return integerPart;

  const lastTwoBeforeThousands = beforeThousands.slice(-2);
  const lakhPart = beforeThousands.slice(0, -2);
  return [lakhPart, lastTwoBeforeThousands, lastThree].filter(Boolean).join(",");
}

function isYesNoOptions(options: string[]) {
  return (
    options.length === 2 && options[0].toLowerCase() === "yes" && options[1].toLowerCase() === "no"
  );
}

function RadioGroup({
  name,
  options,
  value,
  disabled,
  onChange,
}: {
  name: string;
  options: string[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className={`grid max-w-md grid-cols-2 gap-2 ${disabledCls(disabled)}`}>
      {options.map((option) => (
        <label
          key={option}
          className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"
        >
          <input
            type="radio"
            name={name}
            checked={value === option}
            disabled={disabled}
            onChange={() => onChange(option)}
            className="size-4 border-input"
          />
          {option}
        </label>
      ))}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-[240px_minmax(0,1fr)] md:items-start">
      <div className="flex min-h-10 items-center justify-between md:justify-start md:pt-0">
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
