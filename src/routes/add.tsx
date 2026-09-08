import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Fragment,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createMasterFirm,
  fetchFile,
  fetchMasterFirms,
  fetchNextUniqueCode,
  fetchIndentors,
  store,
  type Division,
  type FileMessage,
  type FileMarker,
  type FileRecord,
  type FileRemark,
  type FirmDetail,
  type FirmRatingConfig,
  type MasterFirm,
  type SpecialFileMarker,
  type BillReturnCycle,
  type SupplementaryBillDetail,
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
import {
  ChevronRight,
  MessageSquare,
  Save,
  Eraser,
  Lock,
  Plus,
  Printer,
  Trash2,
  Unlock,
} from "lucide-react";
import { promptDeletionPassword, requestDeletionPassword } from "@/lib/delete-password";
import { downloadBackendExport, getExportFileName } from "@/lib/export-download";
import {
  getMilestoneValidationTarget,
  validateMilestoneCompletionConsistency,
} from "@/lib/milestone-validation";
import { fileSupplyOrders as expandedFileSupplyOrders } from "@/lib/effective-deliveries";
import { displayFinancialYearLabel } from "@/lib/year-filter";
import { DateInput } from "@/components/date-input";
import {
  getConfiguredFileTypeGroup,
  isBiddingApplicableForFile,
  isContractFileType,
} from "@/lib/file-type-groups";
import { SearchableDropdown } from "@/components/searchable-dropdown";
import {
  formatFirmRatingScore,
  calculateFirmRatingScore,
  normalizeFirmRatingConfig,
} from "@/lib/firm-rating";

export const Route = createFileRoute("/add")({
  validateSearch: (search: Record<string, unknown>) => ({
    fileId: typeof search.fileId === "string" ? search.fileId : undefined,
    section: typeof search.section === "string" ? search.section : undefined,
    milestone: typeof search.milestone === "string" ? search.milestone : undefined,
    focusTarget: typeof search.focusTarget === "string" ? search.focusTarget : undefined,
    drillPath: typeof search.drillPath === "string" ? search.drillPath : undefined,
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
  tcec: "NO",
  fileType: "Goods & Services",
  fileTypeGroup: "goodsServices",
  mode: "",
  gem: "No",
  gemBiddingMode: "",
  highValue: "No",
  ad: "No",
  rqa: "No",
  ifa: "No",
  psb: "",
  bg: "No",
  ir: "No",
  rfpVetting: "No",
  highValueMeetingDate: "",
  highValueMinutesDate: "",
  adSentDate: "",
  preTcecDate: "",
  preTcecMinutesDate: "",
  preTcecCommitteeNo: "",
  adVettingDate: "",
  rqaSentDate: "",
  rqaApprovalDate: "",
  ifaSentDate: "",
  ifaFinalDate: "",
  cfaSentDate: "",
  cfaDate: "",
  gemUndertakingDate: "",
  rfpVettingInitiationDate: "",
  rfpVettingApprovalDate: "",
  preBidMeeting: "No",
  preBidMeetingDate: "",
  tenderLive: "No",
  bidNumber: "",
  bidDate: "",
  bidOpeningDate: "",
  bidOpened: "NO",
  refloat: "No",
  refloatPreBidMeeting: "No",
  refloatPreBidMeetingDate: "",
  postTcecDate: "",
  postTcecMinutesDate: "",
  postTcecCommitteeNumber: "",
  refloatBiddingDate: "",
  refloatBidOpeningDate: "",
  refloatPostTcecDate: "",
  refloatPostTcecMinutesDate: "",
  refloatPostTcecCommitteeNo: "",
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
  bqBasis: "",
  dpExtension: "No",
  dpExtensionCount: "",
  ld: "No",
  ldType: "",
  ldPercentage: "",
  revisedDp: "",
  materialReceiptDate: "",
  jobCompletionDate: "",
  irPreparationDate: "",
  irReceiptDate: "",
  billPreparationDate: "",
  billSentForPaymentDate: "",
  billAmountCapital: "",
  billAmountRevenue: "",
  paymentDate: "",
  paymentMode: "",
  actualPaymentCapital: "",
  actualPaymentRevenue: "",
  demandCancelled: "No",
  demandCancelledDate: "",
  soCancelled: "No",
  soCancelledDate: "",
  shortclosure: "No",
  shortclosureDate: "",
  fileClosureDate: "",
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
  "Delivery",
  "Bill sent for payment",
  "Payment",
  "File Closed",
];
const fileClosedMilestone = "File Closed";

type DrillPathItem = { label: string; href?: string };

function parseDrillPath(value: string | undefined): DrillPathItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (typeof item === "string") return { label: item.trim() };
        if (!item || typeof item !== "object") return undefined;
        const label = typeof item.label === "string" ? item.label.trim() : "";
        const href = typeof item.href === "string" ? item.href.trim() : "";
        return label ? { label, href: href || undefined } : undefined;
      })
      .filter((item): item is DrillPathItem => Boolean(item))
      .slice(0, 12);
  } catch {
    return value
      .split(">")
      .map((item) => ({ label: item.trim() }))
      .filter((item) => item.label)
      .slice(0, 12);
  }
}

function getCurrentHref() {
  if (typeof window === "undefined") return undefined;
  return `${window.location.pathname}${window.location.search}`;
}

function DrillPathTrail({
  items,
  fallbackHref,
}: {
  items: DrillPathItem[];
  fallbackHref?: string;
}) {
  if (!items.length) return null;
  return (
    <nav
      aria-label="Dashboard drill path"
      className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
    >
      {items.map((item, index) => {
        const href = item.href ?? fallbackHref;
        const labelClassName =
          "rounded px-1 py-0.5 transition " +
          (index === items.length - 1
            ? "font-medium text-foreground"
            : "hover:bg-accent hover:text-foreground");
        return (
          <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1">
            {index > 0 ? <ChevronRight className="size-3" aria-hidden="true" /> : null}
            {href ? (
              <a href={href} className={labelClassName}>
                {item.label}
              </a>
            ) : (
              <span className={labelClassName}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

const supplyOrderDrivenMilestoneKeys = new Set([
  "financialsanction",
  "supplyorder",
  "deliveryperiod",
  "bankguarantee",
  "psb",
  "pwb",
  "psbpwb",
  "delivery",
  "irpreparation",
  "irreceipt",
  "billpreparation",
  "billsentforpayment",
  "billreturnedforcorrection",
  "advancepayment",
  "payment",
]);
const supplyOrderMilestoneNames = [
  "Financial Sanction",
  "Supply Order",
  "Delivery Period",
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
  "Delivery Period": "dpDate",
  PSB: "psbBgReceivedDate",
  PWB: "pwbBgReceivedDate",
  "PSB+PWB": "combinedBgReceivedDate",
  Delivery: "materialReceiptDate",
  "IR Preparation": "irPreparationDate",
  "IR Receipt": "irReceiptDate",
  "Job Completion": "jobCompletionDate",
  "Bill preparation": "billPreparationDate",
  "Bill sent for payment": "billSentForPaymentDate",
  Payment: "paymentDate",
} as const satisfies Partial<Record<SupplyOrderMilestoneName, keyof SupplyOrderDetail>>;

type FormState = typeof empty;
type FieldKey = keyof FormState;
type SupplyOrderKey = keyof SupplyOrderDetail;
type AdvancePaymentKey = keyof AdvancePaymentDetail;
type StageDeliveryKey = keyof StageDeliveryDetail;
const specialBoardSections = new Set(["Timeline", "Remarks Summary", "Milestones"]);

function getEditFileHeading(form: FormState, file: FileRecord | undefined) {
  return (
    [
      form.demandDescription,
      file?.demandDescription,
      form.fileNo,
      file?.fileNo,
      form.uniqueCode,
      file?.uniqueCode,
      form.imms,
      file?.imms,
    ]
      .map((value) => value?.trim())
      .find((value): value is string => Boolean(value)) ?? "Edit file details"
  );
}

function createEmptyForm(financialYear: string): FormState {
  return { ...empty, year: financialYear };
}

const formKeys = Object.keys(empty) as FieldKey[];

function createFormFromFile(file: FileRecord, financialYear: string): FormState {
  const supplyOrderCount = normalizeSupplyOrderRows(file).length;
  const noOfSo = String(
    clampSupplyOrderCount(
      hasFilledValue(file.noOfSo) ? (file.noOfSo ?? "") : String(supplyOrderCount),
    ),
  );
  return {
    ...createEmptyForm(financialYear),
    ...Object.fromEntries(
      formKeys.map((key) => [
        key,
        normalizeDefaultYesNoValue(key, String((file as Record<string, unknown>)[key] ?? "")),
      ]),
    ),
    valueCapitalSelected: hasNonZeroAmount(file.valueCapital) ? "Yes" : "",
    valueRevenueSelected: hasNonZeroAmount(file.valueRevenue) ? "Yes" : "",
    noOfSo,
    year: file.year ?? financialYear,
  } as FormState;
}

function createFirmDetailsFromFile(file: FileRecord | undefined): FirmDetailsState {
  return {
    bqFirms: normalizeFirmRows(file?.bqFirms),
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

function getAddFileYearOptions(financialYear: string, financialYears: string[], locked: boolean) {
  return locked
    ? [financialYear].filter(Boolean)
    : getLatestTwoYears(financialYear, financialYears);
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

function getFormFieldsForDirtyFromForm(sectionTitle: string, source: FormState) {
  const sectionFields =
    extraSections.find((section) => section.title === sectionTitle)?.fields ?? [];
  return Object.fromEntries(sectionFields.map((field) => [field.key, source[field.key] ?? ""]));
}

function isDirtyValueEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeDirtyValue(key: string, value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => normalizeDirtyValue(key, item))
      .filter((item) => {
        if (Array.isArray(item)) return item.length > 0;
        if (item && typeof item === "object") return Object.keys(item).length > 0;
        return hasFilledValue(String(item ?? ""));
      });
    return normalized.length ? normalized : undefined;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([childKey, childValue]) => [childKey, normalizeDirtyValue(childKey, childValue)])
      .filter(([, childValue]) => {
        if (Array.isArray(childValue)) return childValue.length > 0;
        if (childValue && typeof childValue === "object") return Object.keys(childValue).length > 0;
        return hasFilledValue(String(childValue ?? ""));
      });
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  if (key === "bgCoverageType" && text.toLowerCase() === "none") return undefined;
  if (
    text.toLowerCase() === "no" &&
    [
      "advancePayment",
      "demandCancelled",
      "dpExtension",
      "ld",
      "psbApplicable",
      "shortclosure",
      "soCancelled",
      "stageDelivery",
      "stagePayment",
    ].includes(key)
  ) {
    return undefined;
  }
  return value;
}

function normalizeDirtyObject<T extends Record<string, unknown>>(
  value: T | undefined,
): Record<string, unknown> {
  const normalized = normalizeDirtyValue("", value ?? {});
  return normalized && typeof normalized === "object" && !Array.isArray(normalized)
    ? normalized
    : {};
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
        firmUniqueNo: row.firmUniqueNo ?? "",
        emailId: row.emailId ?? "",
        address: row.address ?? "",
        city: row.city ?? "",
        contactNo: row.contactNo ?? "",
      }))
      .filter(
        (row) =>
          row.firmName ||
          row.firmUniqueNo ||
          row.emailId ||
          row.address ||
          row.city ||
          row.contactNo,
      ) ?? [];
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
  "postTcecDate",
  "postTcecMinutesDate",
  "postTcecCommitteeNumber",
  "refloatPostTcecDate",
  "refloatPostTcecMinutesDate",
  "refloatPostTcecCommitteeNo",
  "cncDate",
  "cncApprovalDate",
];

const gemDisabledKeys: FieldKey[] = ["gemBiddingMode", "gemUndertakingDate", "gemSoNo"];
const rfpVettingDisabledKeys: FieldKey[] = ["rfpVettingInitiationDate", "rfpVettingApprovalDate"];
const highValueDisabledKeys: FieldKey[] = ["highValueMeetingDate", "highValueMinutesDate"];
const rqaDisabledKeys: FieldKey[] = ["rqaSentDate", "rqaApprovalDate"];
const ifaDisabledKeys: FieldKey[] = ["ifaSentDate", "ifaFinalDate"];
const bgDisabledKeys: FieldKey[] = [];
const preBidMeetingDisabledKeys: FieldKey[] = ["preBidMeetingDate"];
const refloatDisabledKeys: FieldKey[] = [
  "refloatPreBidMeeting",
  "refloatPreBidMeetingDate",
  "refloatBiddingDate",
  "refloatBidOpeningDate",
  "refloatPostTcecDate",
  "refloatPostTcecMinutesDate",
  "refloatPostTcecCommitteeNo",
];
const refloatPreBidMeetingDisabledKeys: FieldKey[] = ["refloatPreBidMeetingDate"];
const biddingStageOverDisabledKeys: FieldKey[] = [
  "postTcecDate",
  "postTcecMinutesDate",
  "postTcecCommitteeNumber",
  "refloatPostTcecDate",
  "refloatPostTcecMinutesDate",
  "refloatPostTcecCommitteeNo",
  "cncDate",
  "cncApprovalDate",
];
const supplyOrderBgDisabledKeys: SupplyOrderKey[] = [];
const supplyOrderIrDisabledKeys: SupplyOrderKey[] = [
  "materialReceiptDate",
  "irPreparationDate",
  "irReceiptDate",
];
const tcecCommitteeKeys: FieldKey[] = [
  "preTcecCommitteeNo",
  "postTcecCommitteeNumber",
  "refloatPostTcecCommitteeNo",
];

const yesNo = ["Yes", "No"];
const yesNoCaps = ["YES", "NO"];
const gemBiddingModeOptions = ["", "Custom", "Catalogue", "Comparison"];
const defaultFirmTypes = ["MSE", "MSE (Women)", "Non-MSE"];
const defaultFileTypeOptions = ["Goods & Services", "AMC", "MPC", "CARS", "O&M"];
const defaultModeOptions = ["OBM", "PBM", "SBM", "LBM", "LPC"];
const paymentModeOptions = ["Select", "Online", "Offline"];
const bgCoverageTypeOptions = ["None", "PSB", "PWB", "PSB+PWB", "PSB and PWB separately"];
type FirmDetailsState = {
  bqFirms: FirmDetail[];
  invitedFirms: FirmDetail[];
  bidderFirms: FirmDetail[];
};

const emptyFirmDetail: Required<FirmDetail> = {
  firmName: "",
  city: "",
  address: "",
  emailId: "",
  firmUniqueNo: "",
  contactNo: "",
};

function firmNameOption(firm: MasterFirm) {
  return firm.firmName?.trim() || "";
}

function firmUniqueNoOption(firm: MasterFirm) {
  return firm.firmUniqueNo?.trim() || "";
}

function normalizeFirmLookupValue(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function findLinkedMasterFirm(
  firms: MasterFirm[],
  row:
    | Pick<FirmDetail, "firmName" | "firmUniqueNo">
    | Pick<SupplyOrderDetail, "firm" | "firmUniqueNo">,
) {
  const firmName = "firmName" in row ? row.firmName : row.firm;
  const firmUniqueNo = row.firmUniqueNo;
  const normalizedUniqueNo = normalizeFirmLookupValue(firmUniqueNo);
  if (normalizedUniqueNo) {
    const byUniqueNo = firms.find(
      (firm) => normalizeFirmLookupValue(firm.firmUniqueNo) === normalizedUniqueNo,
    );
    if (byUniqueNo) return byUniqueNo;
  }
  const normalizedName = normalizeFirmLookupValue(firmName);
  if (normalizedName) {
    return firms.find((firm) => normalizeFirmLookupValue(firm.firmName) === normalizedName);
  }
  return undefined;
}

function numericOnly(value: string) {
  return value.replace(/\D/g, "");
}

function isValidEmailFormat(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return !trimmed || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
const emptySupplyOrder: Required<SupplyOrderDetail> = {
  currentMilestone: "",
  completedMilestones: [],
  financialSanctionDate: "",
  psbApplicable: "No",
  bgCoverageType: "None",
  psbBgNo: "",
  psbBgAmount: "",
  psbBgReceivedDate: "",
  psbBgValidityDate: "",
  psbBgReturnDate: "",
  pwbBgNo: "",
  pwbBgAmount: "",
  pwbBgReceivedDate: "",
  pwbBgValidityDate: "",
  pwbBgReturnDate: "",
  combinedBgNo: "",
  combinedBgAmount: "",
  combinedBgReceivedDate: "",
  combinedBgValidityDate: "",
  combinedBgReturnDate: "",
  warrantyPeriodDate: "",
  soNo: "",
  gemSoNo: "",
  soDate: "",
  soValueCapital: "",
  soValueRevenue: "",
  dpDate: "",
  firm: "",
  firmUniqueNo: "",
  firmContactNo: "",
  firmCity: "",
  firmType: "",
  firmTypeOther: "",
  dpExtension: "No",
  dpExtensionCount: "",
  ld: "No",
  ldType: "",
  ldPercentage: "",
  revisedDp: "",
  materialReceiptDate: "",
  jobCompletionDate: "",
  irPreparationDate: "",
  irReceiptDate: "",
  billPreparationDate: "",
  billNo: "",
  billSentForPaymentDate: "",
  paymentDate: "",
  billReturnCycles: [],
  billAmountCapital: "",
  billAmountRevenue: "",
  paymentMode: "",
  actualPaymentCapital: "",
  actualPaymentRevenue: "",
  demandCancelled: "No",
  soCancelled: "No",
  soCancelledDate: "",
  shortclosure: "No",
  shortclosureDate: "",
  stageDelivery: "No",
  stageDeliveryCount: "",
  deliveryPeriodStartDate: "",
  stageDeliveryLabel: "",
  stagePayment: "No",
  advancePayment: "No",
  advancePaymentDetail: {},
  stageDeliveries: [],
  supplementaryBills: [],
  firmRatingValues: {},
};

const emptyAdvancePayment: Required<AdvancePaymentDetail> = {
  currentMilestone: "",
  completedMilestones: [],
  stageAmountCapital: "",
  stageAmountRevenue: "",
  billPreparationDate: "",
  billNo: "",
  billSentForPaymentDate: "",
  paymentDate: "",
  billReturnCycles: [],
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
  billNo: "",
  billSentForPaymentDate: "",
  paymentDate: "",
  billReturnCycles: [],
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
  { key: "firmUniqueNo", label: "Firm Unique No." },
  { key: "firmType", label: "Firm type" },
  { key: "psbApplicable", label: "PSB applicable", options: yesNo },
  { key: "bgCoverageType", label: "BG coverage type", options: bgCoverageTypeOptions },
  { key: "psbBgNo", label: "PSB BG No." },
  { key: "psbBgAmount", label: "PSB BG amount" },
  { key: "psbBgReceivedDate", label: "PSB received date", type: "date" },
  { key: "psbBgValidityDate", label: "PSB validity date", type: "date" },
  { key: "psbBgReturnDate", label: "PSB return date", type: "date" },
  { key: "pwbBgNo", label: "PWB BG No." },
  { key: "pwbBgAmount", label: "PWB BG amount" },
  { key: "pwbBgReceivedDate", label: "PWB received date", type: "date" },
  { key: "pwbBgValidityDate", label: "PWB validity date", type: "date" },
  { key: "pwbBgReturnDate", label: "PWB return date", type: "date" },
  { key: "combinedBgNo", label: "PSB+PWB BG No." },
  { key: "combinedBgAmount", label: "PSB+PWB BG amount" },
  { key: "combinedBgReceivedDate", label: "PSB+PWB received date", type: "date" },
  { key: "combinedBgValidityDate", label: "PSB+PWB validity date", type: "date" },
  { key: "combinedBgReturnDate", label: "PSB+PWB return date", type: "date" },
  { key: "warrantyPeriodDate", label: "Warranty period", type: "date" },
  { key: "dpExtension", label: "DP extension (Yes/No)", options: yesNo },
  { key: "dpExtensionCount", label: "Extension count", type: "number" },
  { key: "ld", label: "LD", options: yesNo },
  { key: "revisedDp", label: "Revised D.P.", type: "date" },
  { key: "materialReceiptDate", label: "Material receipt date", type: "date" },
  { key: "jobCompletionDate", label: "Job Completion Date", type: "date" },
  { key: "irPreparationDate", label: "IR Preparation", type: "date" },
  { key: "irReceiptDate", label: "IR Receipt", type: "date" },
  { key: "billPreparationDate", label: "Bill preparation", type: "date" },
  { key: "billNo", label: "Bill No." },
  { key: "billSentForPaymentDate", label: "Bill sent for payment", type: "date" },
  { key: "billReturnCycles", label: "Bill returned for correction" },
  { key: "billAmountCapital", label: "Bill amount" },
  { key: "paymentDate", label: "Payment Date", type: "date" },
  { key: "paymentMode", label: "Payment mode(Online/Offline)", options: paymentModeOptions },
  { key: "actualPaymentCapital", label: "Actual payment amount" },
  { key: "shortclosure", label: "Shortclosure (Yes/No)", options: yesNo },
  { key: "shortclosureDate", label: "Shortclosure date", type: "date" },
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
  { key: "jobCompletionDate", label: "Job Completion Date", type: "date" },
  { key: "irPreparationDate", label: "IR Preparation", type: "date" },
  { key: "irReceiptDate", label: "IR Receipt", type: "date" },
  { key: "billPreparationDate", label: "Bill preparation", type: "date" },
  { key: "billNo", label: "Bill No." },
  { key: "billSentForPaymentDate", label: "Bill sent for payment", type: "date" },
  { key: "billReturnCycles", label: "Bill returned for correction" },
  { key: "paymentDate", label: "Payment Date", type: "date" },
  { key: "paymentMode", label: "Payment mode(Online/Offline)", options: paymentModeOptions },
  { key: "actualPaymentCapital", label: "Actual payment amount" },
];

const advancePaymentFields: ExtraField<AdvancePaymentKey>[] = [
  { key: "stageAmountCapital", label: "Advance amount" },
  { key: "billPreparationDate", label: "Bill preparation", type: "date" },
  { key: "billNo", label: "Bill No." },
  { key: "billSentForPaymentDate", label: "Bill sent for payment", type: "date" },
  { key: "billReturnCycles", label: "Bill returned for correction" },
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
    "firmUniqueNo",
    "firmType",
    "firmTypeOther",
    "stageDelivery",
    "stageDeliveryCount",
    "stagePayment",
    "advancePayment",
  ],
  bg: [
    "psbApplicable",
    "bgCoverageType",
    "psbBgNo",
    "psbBgAmount",
    "psbBgReceivedDate",
    "psbBgValidityDate",
    "psbBgReturnDate",
    "pwbBgNo",
    "pwbBgAmount",
    "pwbBgReceivedDate",
    "pwbBgValidityDate",
    "pwbBgReturnDate",
    "combinedBgNo",
    "combinedBgAmount",
    "combinedBgReceivedDate",
    "combinedBgValidityDate",
    "combinedBgReturnDate",
    "warrantyPeriodDate",
  ],
  dp: ["dpDate", "dpExtension", "dpExtensionCount", "ld", "revisedDp"],
  delivery: ["materialReceiptDate", "jobCompletionDate", "irPreparationDate", "irReceiptDate"],
  payment: [
    "billPreparationDate",
    "billNo",
    "billSentForPaymentDate",
    "billReturnCycles",
    "billAmountCapital",
    "paymentDate",
    "paymentMode",
    "actualPaymentCapital",
  ],
  supplementaryBills: [],
  firmRating: [],
  miscellaneous: ["shortclosure", "shortclosureDate", "soCancelled", "soCancelledDate"],
} satisfies Record<string, SupplyOrderKey[]>;

const supplyOrderSubviewTabs = [
  { key: "supplyOrder", label: "Supply order" },
  { key: "bg", label: "Security/Warranty" },
  { key: "dp", label: "D.P." },
  { key: "delivery", label: "Delivery & Inspection" },
  { key: "payment", label: "Payment" },
  { key: "supplementaryBills", label: "Supplementary Bills" },
  { key: "firmRating", label: "Firm Rating" },
  { key: "miscellaneous", label: "Shortclosure / Cancellation" },
] as const;

const supplyOrderFieldPrerequisites = {
  soNo: ["financialSanctionDate"],
  gemSoNo: ["soNo"],
  soDate: ["soNo"],
  soValueCapital: ["soDate"],
  firm: ["soDate"],
  firmUniqueNo: ["soDate"],
  firmContactNo: ["firm"],
  firmCity: ["firm"],
  firmType: ["firm"],
  firmTypeOther: ["firmType"],
  stageDelivery: ["firm"],
  stageDeliveryCount: ["stageDelivery"],
  stagePayment: ["stageDelivery"],
  advancePayment: ["stagePayment"],
  psbApplicable: ["financialSanctionDate"],
  bgCoverageType: ["financialSanctionDate"],
  psbBgNo: ["bgCoverageType"],
  psbBgAmount: ["psbBgNo"],
  psbBgReceivedDate: ["psbBgNo"],
  psbBgValidityDate: ["psbBgReceivedDate"],
  psbBgReturnDate: ["psbBgValidityDate"],
  pwbBgNo: ["bgCoverageType"],
  pwbBgAmount: ["pwbBgNo"],
  pwbBgReceivedDate: ["pwbBgNo"],
  pwbBgValidityDate: ["pwbBgReceivedDate"],
  pwbBgReturnDate: ["pwbBgValidityDate"],
  combinedBgNo: ["bgCoverageType"],
  combinedBgAmount: ["combinedBgNo"],
  combinedBgReceivedDate: ["combinedBgNo"],
  combinedBgValidityDate: ["combinedBgReceivedDate"],
  combinedBgReturnDate: ["combinedBgValidityDate"],
  dpDate: ["soDate"],
  dpExtension: ["dpDate"],
  dpExtensionCount: ["dpExtension"],
  ld: ["dpDate"],
  revisedDp: ["dpDate"],
  materialReceiptDate: ["dpDate"],
  jobCompletionDate: ["dpDate"],
  irPreparationDate: ["materialReceiptDate"],
  irReceiptDate: ["irPreparationDate"],
  billPreparationDate: ["materialReceiptDate"],
  billNo: ["billPreparationDate"],
  billSentForPaymentDate: ["billPreparationDate"],
  billReturnCycles: ["billSentForPaymentDate"],
  billAmountCapital: ["billPreparationDate"],
  paymentDate: ["billSentForPaymentDate"],
  paymentMode: ["paymentDate"],
  actualPaymentCapital: ["paymentDate"],
  shortclosure: ["soDate"],
  shortclosureDate: ["shortclosure"],
  soCancelled: ["soDate"],
  soCancelledDate: ["soCancelled"],
} satisfies Partial<Record<SupplyOrderKey, SupplyOrderKey[]>>;

type SupplyOrderSubviewKey = (typeof supplyOrderSubviewTabs)[number]["key"];

type SupplementaryBillDraft = {
  id: string;
  billNo: string;
  billAmountCapital: string;
  billAmountRevenue: string;
  billSentForPaymentDate: string;
  billReturnCycles: BillReturnCycle[];
  paymentDate: string;
  paymentMode: string;
  actualPaymentCapital: string;
  actualPaymentRevenue: string;
  remarks: string;
};

function createSupplementaryBillDraft(): SupplementaryBillDraft {
  return {
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    billNo: "",
    billAmountCapital: "",
    billAmountRevenue: "",
    billSentForPaymentDate: "",
    billReturnCycles: [],
    paymentDate: "",
    paymentMode: "",
    actualPaymentCapital: "",
    actualPaymentRevenue: "",
    remarks: "",
  };
}

function normalizeSupplementaryBillDrafts(
  bills: SupplementaryBillDetail[] | undefined,
): SupplementaryBillDraft[] {
  return (Array.isArray(bills) ? bills : []).map((bill, index) => ({
    id: bill.id || `supplementary-bill-${index}`,
    billNo: bill.billNo ?? "",
    billAmountCapital: bill.billAmountCapital ?? "",
    billAmountRevenue: bill.billAmountRevenue ?? "",
    billSentForPaymentDate: bill.billSentForPaymentDate ?? "",
    billReturnCycles: normalizeBillReturnCycles(bill.billReturnCycles),
    paymentDate: bill.paymentDate ?? "",
    paymentMode: bill.paymentMode ?? "",
    actualPaymentCapital: bill.actualPaymentCapital ?? "",
    actualPaymentRevenue: bill.actualPaymentRevenue ?? "",
    remarks: bill.remarks ?? "",
  }));
}

function cleanSupplementaryBills(
  bills: SupplementaryBillDetail[] | undefined,
): SupplementaryBillDetail[] {
  return normalizeSupplementaryBillDrafts(bills)
    .map((bill) => ({
      id: bill.id,
      billNo: bill.billNo.trim() || undefined,
      billAmountCapital: bill.billAmountCapital || undefined,
      billAmountRevenue: bill.billAmountRevenue || undefined,
      billSentForPaymentDate: bill.billSentForPaymentDate || undefined,
      billReturnCycles: normalizeBillReturnCycles(bill.billReturnCycles),
      paymentDate: bill.paymentDate || undefined,
      paymentMode: cleanPaymentModeValue(bill.paymentMode) || undefined,
      actualPaymentCapital: bill.actualPaymentCapital || undefined,
      actualPaymentRevenue: bill.actualPaymentRevenue || undefined,
      remarks: bill.remarks.trim() || undefined,
    }))
    .filter((bill) => hasMeaningfulSupplyOrderDataValue("supplementaryBills", bill));
}

const supplyOrderSubviewMilestones = {
  supplyOrder: ["Financial Sanction", "Supply Order"],
  bg: ["PSB", "PWB", "PSB+PWB"],
  dp: ["Delivery Period"],
  delivery: ["Delivery", "Job Completion", "IR Preparation", "IR Receipt"],
  payment: ["Bill preparation", "Bill sent for payment", "Bill returned for correction", "Payment"],
  supplementaryBills: [],
  firmRating: [],
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
      { key: "receivedDate", label: "Demand received date", type: "date" },
      { key: "fileType", label: "File Type", options: defaultFileTypeOptions },
      { key: "mode", label: "Mode", options: defaultModeOptions },
      { key: "tcec", label: "TCEC (Yes/No)", options: yesNoCaps },
      { key: "gem", label: "GeM (Yes/No)", options: yesNo },
      { key: "highValue", label: "High value (Yes/No)", options: yesNo },
      { key: "ad", label: "AD (Yes/No)", options: yesNo },
      { key: "rqa", label: "R&QA (Yes/No)", options: yesNo },
      { key: "ifa", label: "IFA (Yes/No)", options: yesNo },
      { key: "bg", label: "Warranty (Yes/No)", options: yesNo },
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
      { key: "refloatPostTcecCommitteeNo", label: "Refloat Post-TCEC committee" },
      { key: "refloatPostTcecDate", label: "Refloat Post-TCEC date", type: "date" },
      {
        key: "refloatPostTcecMinutesDate",
        label: "Refloat Post-TCEC minutes date",
        type: "date",
      },
    ],
  },
  {
    title: "Approval block",
    fields: [
      { key: "highValueMeetingDate", label: "High value meeting date", type: "date" },
      { key: "highValueMinutesDate", label: "High value minutes date", type: "date" },
      { key: "adSentDate", label: "AD sent date", type: "date" },
      { key: "adVettingDate", label: "AD Vetting date", type: "date" },
      { key: "rqaSentDate", label: "R&QA sent date", type: "date" },
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
      { key: "gemBiddingMode", label: "GeM Bidding Mode", options: gemBiddingModeOptions },
      { key: "gemUndertakingDate", label: "GeM undertaking date", type: "date" },
      { key: "rfpVettingInitiationDate", label: "RFP vetting initiation", type: "date" },
      { key: "rfpVettingApprovalDate", label: "RFP vetting approval", type: "date" },
      { key: "preBidMeeting", label: "Pre-Bid Meeting (Yes/No)", options: yesNo },
      { key: "preBidMeetingDate", label: "Pre-Bid Meeting date", type: "date" },
      { key: "bidNumber", label: "Bid number" },
      { key: "bidDate", label: "Bid date", type: "date" },
      { key: "bidOpeningDate", label: "Bid closing", type: "date" },
      { key: "tenderLive", label: "Tender live", options: yesNo },
      { key: "bidOpened", label: "Bid opened", options: yesNoCaps },
      { key: "refloat", label: "Refloat (Yes/No)", options: yesNo },
      { key: "refloatPreBidMeeting", label: "Refloat Pre-Bid Meeting (Yes/No)", options: yesNo },
      { key: "refloatPreBidMeetingDate", label: "Refloat Pre-Bid Meeting date", type: "date" },
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

const cfaApprovalGatedSectionTitles = new Set([
  "Bidding details",
  "Supply order and payment",
  "Firm details",
]);
const cfaApprovalGatedFieldKeys = new Set<FieldKey>(
  extraSections
    .filter((section) => cfaApprovalGatedSectionTitles.has(section.title))
    .flatMap((section) => section.fields.map((field) => field.key)),
);

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
  const canViewExistingFile =
    (activeUser?.role === "viewer" || activeUser?.role === "universal_viewer") && Boolean(fileId);
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
  const effectiveFinancialYear = settings.financialYear;
  const {
    fileId,
    section,
    milestone,
    focusTarget,
    drillPath: rawDrillPath,
    quickFocus,
  } = Route.useSearch();
  const navigate = useNavigate();
  const drillPath = useMemo(() => parseDrillPath(rawDrillPath), [rawDrillPath]);
  const currentFileHref = getCurrentHref();
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
  useEffect(() => {
    const nextGroup = getConfiguredFileTypeGroup(form.fileType, settings.fileTypeGroups);
    if (form.fileTypeGroup === nextGroup) return;
    setForm((current) => ({ ...current, fileTypeGroup: nextGroup }));
  }, [form.fileType, form.fileTypeGroup, settings.fileTypeGroups]);
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
  const fileClosedDone = completedMilestones.some(
    (item) => normalizeMilestoneName(item) === normalizeMilestoneName(fileClosedMilestone),
  );
  const [activeYears, setActiveYears] = useState<string[]>(() =>
    normalizeSelectableActiveYears(
      normalizeActiveYears(editingFile, effectiveFinancialYear),
      getAddFileYearOptions(
        effectiveFinancialYear,
        settings.financialYears,
        settings.yearSelectionLocked,
      ),
      effectiveFinancialYear,
      settings.yearSelectionLocked,
    ),
  );
  const [saved, setSaved] = useState(false);
  const [unlockedSections, setUnlockedSections] = useState<Set<string>>(() => new Set());
  const [demandCancelledUnlocked, setDemandCancelledUnlocked] = useState(false);
  const [paidStageUnfreezeKeys, setPaidStageUnfreezeKeys] = useState<Set<string>>(() => new Set());
  const [activeBoardSection, setActiveBoardSection] = useState(section ?? "File details");
  const [focusedMilestone, setFocusedMilestone] = useState(milestone ?? "");
  const quickFieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const quickFocusAppliedRef = useRef("");
  const fieldFocusAppliedRef = useRef("");
  const skipMilestonePruneRef = useRef(false);
  const divisionsRef = useRef(divisions);
  const filesRef = useRef(files);
  divisionsRef.current = divisions;
  filesRef.current = files;
  useEffect(() => {
    if (fileClosedDone || !form.fileClosureDate) return;
    setForm((current) => ({ ...current, fileClosureDate: "" }));
  }, [fileClosedDone, form.fileClosureDate]);
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
      setPaidStageUnfreezeKeys(new Set());
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
        setPaidStageUnfreezeKeys(new Set());
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setLoadedFile(undefined);
        setFileLoadStatus("error");
        setDemandCancelledUnlocked(false);
        setPaidStageUnfreezeKeys(new Set());
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
  const unlockPaidStage = async (orderIndex: number, stageIndex: number) => {
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    const allowed = await requestDeletionPassword(`unfreeze paid Delivery-${stageIndex + 1}`);
    if (!allowed) return;
    setPaidStageUnfreezeKeys((current) => {
      const next = new Set(current);
      next.add(stageFreezeKey(orderIndex, stageIndex));
      return next;
    });
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
  const savedActiveYearsForDirty = useMemo(
    () =>
      normalizeSelectableActiveYears(
        normalizeActiveYears(editingFile, effectiveFinancialYear),
        getAddFileYearOptions(
          effectiveFinancialYear,
          settings.financialYears,
          settings.yearSelectionLocked,
        ),
        effectiveFinancialYear,
        settings.yearSelectionLocked,
      ),
    [editingFile, effectiveFinancialYear, settings.financialYears, settings.yearSelectionLocked],
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
        getAddFileYearOptions(
          effectiveFinancialYear,
          settings.financialYears,
          settings.yearSelectionLocked,
        ),
        effectiveFinancialYear,
        settings.yearSelectionLocked,
      ),
    );
    setUnlockedSections(new Set());
    setDemandCancelledUnlocked(false);
    // The file object is re-read from localStorage on each render; reset only when the edited id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingFile?.id, effectiveFinancialYear, settings.yearSelectionLocked]);

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
  const uniqueCodeGateLocked = !readOnlyMode && !hasFilledValue(formWithLockedYear.uniqueCode);
  const cfaApprovalGateLocked = !readOnlyMode && !hasFilledValue(formWithLockedYear.cfaDate);
  const activeYearOptions = useMemo(
    () =>
      getAddFileYearOptions(
        effectiveFinancialYear,
        settings.financialYears,
        settings.yearSelectionLocked,
      ),
    [effectiveFinancialYear, settings.financialYears, settings.yearSelectionLocked],
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
  const preBidMeetingIsNo = isNo(formWithLockedYear.preBidMeeting);
  const refloatIsNo = isNo(formWithLockedYear.refloat);
  const refloatPreBidMeetingIsNo = isNo(formWithLockedYear.refloatPreBidMeeting);
  const biddingApplicable = isBiddingApplicableForFile(formWithLockedYear);
  const gemComparisonNoBidding =
    isYes(formWithLockedYear.gem) && formWithLockedYear.gemBiddingMode === "Comparison";
  const visibleExtraSections = useMemo(
    () =>
      extraSections.filter(
        (section) =>
          biddingApplicable ||
          (gemComparisonNoBidding && section.title === "Bidding details") ||
          (section.title !== "Bidding details" && section.title !== "Firm details"),
      ),
    [biddingApplicable, gemComparisonNoBidding],
  );
  useEffect(() => {
    if (specialBoardSections.has(activeBoardSection)) return;
    if (visibleExtraSections.some((section) => section.title === activeBoardSection)) return;
    setActiveBoardSection("Supply order and payment");
  }, [activeBoardSection, visibleExtraSections]);
  const adDisabledByDivision = isDivisionAdNo(formWithLockedYear.division, divisions);
  const milestoneOptions = useMemo(
    () => getConfiguredMilestones(settings.milestones),
    [settings.milestones],
  );
  const fileLevelMilestoneOptions = useMemo(
    () =>
      milestoneOptions.filter(
        (milestone) => !supplyOrderDrivenMilestoneKeys.has(normalizeMilestoneName(milestone)),
      ),
    [milestoneOptions],
  );
  const applicableMilestones = getApplicableMilestones(
    milestoneOptions,
    formWithLockedYear,
    supplyOrders,
    divisions,
  );
  const fileLevelApplicableMilestones = getApplicableMilestones(
    fileLevelMilestoneOptions,
    formWithLockedYear,
    supplyOrders,
    divisions,
  );
  const supplyOrderMilestoneProgress = useMemo(
    () =>
      getSupplyOrderMilestoneProgress(
        milestoneOptions,
        supplyOrders,
        formWithLockedYear,
        shouldUseSupplyOrderMilestones(supplyOrders, currentMilestone, completedMilestones),
        currentMilestone,
      ),
    [completedMilestones, currentMilestone, formWithLockedYear, milestoneOptions, supplyOrders],
  );
  const mainMilestoneDisplayLabels = useMemo(() => {
    if (!deliveryInspectionInactive) return {};
    return { delivery: "Job Completion" };
  }, [deliveryInspectionInactive]);
  const inactiveMainMilestones = useMemo(() => new Set(supplyOrderDrivenMilestoneKeys), []);
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
        activeUser?.role === "editor" ? activeUser.allowedFileCategories : undefined,
      ),
    [activeUser?.allowedFileCategories, activeUser?.role, formWithLockedYear.mode, settings.modes],
  );
  const configuredFileTypeOptions = useMemo(
    () =>
      filterFileTypeOptionsForUser(
        getConfiguredFileTypes(settings.fileTypes, formWithLockedYear.fileType),
        activeUser?.role === "editor" ? activeUser.allowedFileCategories : undefined,
      ),
    [
      activeUser?.allowedFileCategories,
      activeUser?.role,
      formWithLockedYear.fileType,
      settings.fileTypes,
    ],
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
      current && !fileLevelApplicableMilestones.has(current) ? "" : current,
    );
    setCompletedMilestones((current) => {
      const next = current.filter((item) => fileLevelMilestoneOptions.includes(item));
      return next.length === current.length ? current : next;
    });
  }, [fileLevelApplicableMilestones, fileLevelMilestoneOptions]);

  const activeSection = visibleExtraSections.find(
    (section) => section.title === activeBoardSection,
  );
  const activeSectionIndex = visibleExtraSections.findIndex(
    (section) => section.title === activeBoardSection,
  );
  const activeSectionCfaApprovalLocked = Boolean(
    activeSection &&
    cfaApprovalGateLocked &&
    cfaApprovalGatedSectionTitles.has(activeSection.title),
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

  useEffect(() => {
    if (quickFocus || !focusTarget || !editingFile || !activeSection) return;
    if (activeSection.title === "Supply order and payment") return;

    const focusKey = `${editingFile.id}:${activeSection.title}:${focusTarget}`;
    if (fieldFocusAppliedRef.current === focusKey) return;

    let cancelled = false;
    let timeoutId: number | undefined;
    let attempts = 0;
    const focusWhenReady = () => {
      if (cancelled) return;
      const target = quickFieldRefs.current[focusTarget];
      if (!target && attempts < 20) {
        attempts += 1;
        timeoutId = window.setTimeout(focusWhenReady, 100);
        return;
      }
      if (!target) return;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      if (!("disabled" in target && target.disabled)) {
        target.focus();
        if ("select" in target && typeof target.select === "function") target.select();
      }
      fieldFocusAppliedRef.current = focusKey;
    };
    timeoutId = window.setTimeout(focusWhenReady, 150);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [activeSection, editingFile, focusTarget, quickFocus]);

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
    if (uniqueCodeGateLocked && k !== "division") return;
    if (cfaApprovalGateLocked && cfaApprovalGatedFieldKeys.has(k)) return;
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
      setSupplyOrders((current) => resizeSupplyOrders(current, count, formWithLockedYear));
      return;
    }
    if (k === "gem") {
      setSupplyOrders((current) =>
        current.map((order) => (isNo(v) ? { ...order, gemSoNo: "", paymentMode: "" } : order)),
      );
    }
    if (k === "bg" && isNo(v)) {
      setSupplyOrders((current) =>
        current.map((order) => ({
          ...order,
          bgCoverageType:
            order.bgCoverageType === "PWB" ||
            order.bgCoverageType === "PSB+PWB" ||
            order.bgCoverageType === "PSB and PWB separately"
              ? isYes(order.psbApplicable ?? "")
                ? "PSB"
                : "None"
              : order.bgCoverageType,
          pwbBgNo: "",
          pwbBgAmount: "",
          pwbBgReceivedDate: "",
          pwbBgValidityDate: "",
          pwbBgReturnDate: "",
          combinedBgNo: "",
          combinedBgAmount: "",
          combinedBgReceivedDate: "",
          combinedBgValidityDate: "",
          combinedBgReturnDate: "",
        })),
      );
    }
    if (k === "bg" && isYes(v)) {
      setSupplyOrders((current) =>
        current.map((order) =>
          !hasFilledValue(order.bgCoverageType) || order.bgCoverageType === "None"
            ? { ...order, bgCoverageType: "PWB" }
            : order,
        ),
      );
    }
    if (k === "ir" && isNo(v)) {
      setSupplyOrders((current) =>
        current.map((order) => ({
          ...order,
          materialReceiptDate: "",
          irPreparationDate: "",
          irReceiptDate: "",
          stageDeliveries: (order.stageDeliveries ?? []).map((stage) => ({
            ...stage,
            materialReceiptDate: "",
            irPreparationDate: "",
            irReceiptDate: "",
          })),
        })),
      );
    }
    if (k === "ir" && isYes(v)) {
      setSupplyOrders((current) =>
        current.map((order) => ({
          ...order,
          jobCompletionDate: "",
          stageDeliveries: (order.stageDeliveries ?? []).map((stage) => ({
            ...stage,
            jobCompletionDate: "",
          })),
        })),
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
      if (k === "refloat" && isYes(v)) {
        patch.biddingStageOver = "No";
      }
      if (k === "division") {
        if (f.division.trim().toLowerCase() !== v.trim().toLowerCase()) {
          patch.indentor = "";
        }
      }
      const next = applyConditionalRules({ ...f, ...patch });
      return isDivisionAdNo(next.division, divisions)
        ? { ...next, ad: "No", adSentDate: "", adVettingDate: "" }
        : next;
    });
  };
  const updateSupplyOrder = async (index: number, key: SupplyOrderKey, value: string) => {
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    if (key === "stageDeliveryCount") {
      const nextCount = getStageDeliveryCount(formatIntegerInput(value));
      const order = supplyOrders[index];
      const lockedOrder = savedSupplyOrdersForLocks[index];
      const protectedStages = (order?.stageDeliveries ?? []).filter(
        (_stage, stageIndex) =>
          stageIndex >= nextCount &&
          isPaidStageFrozen(
            index,
            stageIndex,
            lockedOrder?.stageDeliveries?.[stageIndex],
            paidStageUnfreezeKeys,
          ),
      );
      if (protectedStages.length) {
        const allowed = await requestDeletionPassword("reduce stages with paid payment rows");
        if (!allowed) return;
      }
    }
    let rejectedMessage = "";
    setSupplyOrders((current) =>
      current.map((order, orderIndex) => {
        if (orderIndex !== index) return order;
        if (isSupplyOrderDateKey(key) && hasFilledValue(value) && !isCompleteDateValue(value)) {
          return { ...order, [key]: clampDateYearInput(value) };
        }
        if (
          key === "financialSanctionDate" &&
          !hasFilledValue(value) &&
          hasFilledValue(order.soDate)
        ) {
          rejectedMessage = "Clear the S.O. date before removing the Financial Sanction date.";
          return order;
        }
        if (
          key === "soDate" &&
          hasFilledValue(value) &&
          !hasFilledValue(order.financialSanctionDate)
        ) {
          rejectedMessage = "Enter the Financial Sanction date before entering the S.O. date.";
          return order;
        }
        const patchedOrder = applySupplyOrderRules(
          getSupplyOrderPatch(order, key, value),
          formWithLockedYear,
        );
        return patchedOrder;
      }),
    );
    if (rejectedMessage) {
      window.setTimeout(() => {
        alert(rejectedMessage);
      }, 100);
    }
  };
  const updateSupplyOrderBillReturns = (index: number, billReturnCycles: BillReturnCycle[]) => {
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    setSupplyOrders((current) =>
      current.map((order, orderIndex) =>
        orderIndex === index
          ? applySupplyOrderRules({ ...order, billReturnCycles }, formWithLockedYear)
          : order,
      ),
    );
  };
  const patchSupplyOrder = (index: number, patch: Partial<SupplyOrderDetail>) => {
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    setSupplyOrders((current) =>
      current.map((order, orderIndex) =>
        orderIndex === index
          ? applySupplyOrderRules({ ...order, ...patch }, formWithLockedYear)
          : order,
      ),
    );
  };
  const updateSupplyOrderCurrentMilestone = (index: number, milestone: string) => {
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    setSupplyOrders((current) =>
      current.map((order, orderIndex) => {
        if (orderIndex !== index) return order;
        const currentMilestone = order.currentMilestone === milestone ? "" : milestone;
        return applySupplyOrderRules({ ...order, currentMilestone }, formWithLockedYear);
      }),
    );
  };
  const updateSupplyOrderCompletedMilestones = (index: number, milestones: string[]) => {
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
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
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    setSupplyOrders((current) =>
      current.map((order, index) => {
        if (index !== orderIndex) return order;
        const stageDeliveries = resizeStageDeliveries(
          order.stageDeliveries ?? [],
          getStageDeliveryCount(order.stageDeliveryCount),
        );
        if (
          isPaidStageFrozen(
            orderIndex,
            stageIndex,
            savedSupplyOrdersForLocks[orderIndex]?.stageDeliveries?.[stageIndex],
            paidStageUnfreezeKeys,
          )
        ) {
          return order;
        }
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
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    setSupplyOrders((current) =>
      current.map((order, index) => {
        if (index !== orderIndex) return order;
        const stageDeliveries = resizeStageDeliveries(
          order.stageDeliveries ?? [],
          getStageDeliveryCount(order.stageDeliveryCount),
        );
        if (
          isPaidStageFrozen(
            orderIndex,
            stageIndex,
            savedSupplyOrdersForLocks[orderIndex]?.stageDeliveries?.[stageIndex],
            paidStageUnfreezeKeys,
          )
        ) {
          return order;
        }
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
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    setSupplyOrders((current) =>
      current.map((order, index) => {
        if (index !== orderIndex) return order;
        const stageDeliveries = resizeStageDeliveries(
          order.stageDeliveries ?? [],
          getStageDeliveryCount(order.stageDeliveryCount),
        );
        if (
          isPaidStageFrozen(
            orderIndex,
            stageIndex,
            savedSupplyOrdersForLocks[orderIndex]?.stageDeliveries?.[stageIndex],
            paidStageUnfreezeKeys,
          )
        ) {
          return order;
        }
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
  const updateStageDeliveryBillReturns = (
    orderIndex: number,
    stageIndex: number,
    billReturnCycles: BillReturnCycle[],
  ) => {
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    setSupplyOrders((current) =>
      current.map((order, index) => {
        if (index !== orderIndex) return order;
        const stageDeliveries = resizeStageDeliveries(
          order.stageDeliveries ?? [],
          getStageDeliveryCount(order.stageDeliveryCount),
        );
        if (
          isPaidStageFrozen(
            orderIndex,
            stageIndex,
            savedSupplyOrdersForLocks[orderIndex]?.stageDeliveries?.[stageIndex],
            paidStageUnfreezeKeys,
          )
        ) {
          return order;
        }
        const nextStageDeliveries = stageDeliveries.map((stage, itemIndex) =>
          itemIndex === stageIndex
            ? applyStageDeliveryRules({ ...stage, billReturnCycles }, formWithLockedYear)
            : stage,
        );
        return applySupplyOrderRules(
          { ...order, stageDeliveries: nextStageDeliveries },
          formWithLockedYear,
        );
      }),
    );
  };
  const updateAdvancePayment = (orderIndex: number, key: AdvancePaymentKey, value: string) => {
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    setSupplyOrders((current) =>
      current.map((order, index) => {
        if (index !== orderIndex) return order;
        const advancePaymentDetail = applyAdvancePaymentRules(
          {
            ...emptyAdvancePayment,
            ...(order.advancePaymentDetail ?? {}),
            [key]:
              key === "stageAmountCapital" ||
              key === "stageAmountRevenue" ||
              key === "actualPaymentCapital" ||
              key === "actualPaymentRevenue"
                ? formatDecimalInput(value)
                : value,
          },
          isYes(order.advancePayment ?? ""),
        );
        return applySupplyOrderRules({ ...order, advancePaymentDetail }, formWithLockedYear);
      }),
    );
  };
  const updateAdvancePaymentBillReturns = (
    orderIndex: number,
    billReturnCycles: BillReturnCycle[],
  ) => {
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    setSupplyOrders((current) =>
      current.map((order, index) => {
        if (index !== orderIndex) return order;
        const advancePaymentDetail = applyAdvancePaymentRules(
          {
            ...emptyAdvancePayment,
            ...(order.advancePaymentDetail ?? {}),
            billReturnCycles,
          },
          isYes(order.advancePayment ?? ""),
        );
        return applySupplyOrderRules({ ...order, advancePaymentDetail }, formWithLockedYear);
      }),
    );
  };
  const toggleSectionLock = (sectionTitle: string) => {
    if (readOnlyMode || uniqueCodeGateLocked) return;
    if (cfaApprovalGateLocked && cfaApprovalGatedSectionTitles.has(sectionTitle)) return;
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
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    setFirmDetails((current) => ({
      ...current,
      [group]: current[group].map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row,
      ),
    }));
  };
  const patchFirmDetail = (
    group: keyof FirmDetailsState,
    index: number,
    patch: Partial<FirmDetail>,
  ) => {
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    setFirmDetails((current) => ({
      ...current,
      [group]: current[group].map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    }));
  };
  const addFirmDetail = (group: keyof FirmDetailsState) => {
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    setFirmDetails((current) => ({
      ...current,
      [group]: [...current[group], { ...emptyFirmDetail }],
    }));
  };
  const deleteFirmDetail = (group: keyof FirmDetailsState, index: number) => {
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    setFirmDetails((current) => ({
      ...current,
      [group]: current[group].filter((_, rowIndex) => rowIndex !== index),
    }));
  };
  const deleteSelectedFirmDetails = (group: keyof FirmDetailsState, indexes: number[]) => {
    if (readOnlyMode || uniqueCodeGateLocked || cfaApprovalGateLocked) return;
    const selected = new Set(indexes);
    setFirmDetails((current) => ({
      ...current,
      [group]: current[group].filter((_, rowIndex) => !selected.has(rowIndex)),
    }));
  };
  const addRemark = (sectionTitle: string) => {
    if (readOnlyMode || uniqueCodeGateLocked) return;
    if (cfaApprovalGateLocked && cfaApprovalGatedSectionTitles.has(sectionTitle)) return;
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
    if (readOnlyMode || uniqueCodeGateLocked) return;
    if (
      cfaApprovalGateLocked &&
      fileRemarks.some(
        (remark) => remark.id === remarkId && cfaApprovalGatedSectionTitles.has(remark.section),
      )
    ) {
      return;
    }
    setFileRemarks((current) =>
      current.map((remark) => (remark.id === remarkId ? { ...remark, text } : remark)),
    );
  };
  const updateRemarkDate = (remarkId: string, date: string) => {
    if (readOnlyMode || uniqueCodeGateLocked) return;
    if (
      cfaApprovalGateLocked &&
      fileRemarks.some(
        (remark) => remark.id === remarkId && cfaApprovalGatedSectionTitles.has(remark.section),
      )
    ) {
      return;
    }
    setFileRemarks((current) =>
      current.map((remark) => (remark.id === remarkId ? { ...remark, createdAt: date } : remark)),
    );
  };
  const deleteRemark = (remarkId: string) => {
    if (readOnlyMode || uniqueCodeGateLocked) return;
    if (
      cfaApprovalGateLocked &&
      fileRemarks.some(
        (remark) => remark.id === remarkId && cfaApprovalGatedSectionTitles.has(remark.section),
      )
    ) {
      return;
    }
    setFileRemarks((current) => current.filter((remark) => remark.id !== remarkId));
  };
  const addMarker = (code: string) => {
    if (readOnlyMode || uniqueCodeGateLocked) return;
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setFileMarkers((current) => [
      ...current.filter((marker) => marker.text.trim().toUpperCase() !== trimmed),
      {
        id: createMarkerId(),
        text: trimmed,
        createdAt: formatLocalDate(new Date()),
      },
    ]);
  };
  const updateMarker = (markerId: string, text: string) => {
    if (readOnlyMode || uniqueCodeGateLocked) return;
    const trimmed = text.trim().toUpperCase();
    setFileMarkers((current) => [
      ...current.filter(
        (marker) => marker.id !== markerId && marker.text.trim().toUpperCase() !== trimmed,
      ),
      ...current
        .filter((marker) => marker.id === markerId)
        .map((marker) => ({ ...marker, text: trimmed })),
    ]);
  };
  const deleteMarker = (markerId: string) => {
    if (readOnlyMode || uniqueCodeGateLocked) return;
    setFileMarkers((current) => current.filter((marker) => marker.id !== markerId));
  };
  const firmDetailsLocked = isEditing && !unlockedSections.has("Firm details");
  const fileMarkersLocked = isEditing && !unlockedSections.has("File Markers");
  const supplyOrdersLocked = isEditing && !unlockedSections.has("Supply order and payment");
  const milestonesLocked = isEditing && !unlockedSections.has("Milestones");
  const getSectionRemarksForDirty = (remarks: FileRemark[], sectionTitle: string) =>
    cleanFileRemarks(remarks.filter((remark) => remark.section === sectionTitle)) ?? [];
  const getFormFieldsForDirty = (sectionTitle: string) => {
    const sectionFields =
      extraSections.find((section) => section.title === sectionTitle)?.fields ?? [];
    return Object.fromEntries(
      sectionFields.map((field) => [field.key, formWithLockedYear[field.key] ?? ""]),
    );
  };
  const isSectionDirty = (sectionTitle: string) => {
    if (!isEditing) return false;
    const remarksChanged = !isDirtyValueEqual(
      getSectionRemarksForDirty(fileRemarks, sectionTitle),
      getSectionRemarksForDirty(createRemarksFromFile(editingFile), sectionTitle),
    );
    if (sectionTitle === "Firm details") {
      return (
        !isDirtyValueEqual(firmDetails, savedFirmDetailsForLocks) ||
        formWithLockedYear.bqBasis !== savedFormForLocks.bqBasis ||
        remarksChanged
      );
    }
    if (sectionTitle === "File Markers") {
      return !isDirtyValueEqual(
        cleanFileMarkers(fileMarkers) ?? [],
        cleanFileMarkers(createMarkersFromFile(editingFile)) ?? [],
      );
    }
    if (sectionTitle === "Supply order and payment") {
      const currentSupplyOrdersForDirty = cleanSupplyOrderRows(
        supplyOrders,
        formWithLockedYear,
      ).map((order) => normalizeDirtyObject(order as Record<string, unknown>));
      const savedSupplyOrdersForDirty = cleanSupplyOrderRows(
        savedSupplyOrdersForLocks,
        formWithLockedYear,
      ).map((order) => normalizeDirtyObject(order as Record<string, unknown>));
      return (
        !isDirtyValueEqual(currentSupplyOrdersForDirty, savedSupplyOrdersForDirty) ||
        formWithLockedYear.noOfSo !== savedFormForLocks.noOfSo ||
        remarksChanged
      );
    }
    if (sectionTitle === "File details") {
      return (
        !isDirtyValueEqual(getFormFieldsForDirty(sectionTitle), {
          ...getFormFieldsForDirtyFromForm(sectionTitle, savedFormForLocks),
        }) ||
        !isDirtyValueEqual(activeYears, savedActiveYearsForDirty) ||
        remarksChanged
      );
    }
    return (
      !isDirtyValueEqual(
        getFormFieldsForDirty(sectionTitle),
        getFormFieldsForDirtyFromForm(sectionTitle, savedFormForLocks),
      ) || remarksChanged
    );
  };
  const renderSectionUnlockButton = (sectionTitle: string) => {
    if (!isEditing || readOnlyMode) return null;
    if (cfaApprovalGateLocked && cfaApprovalGatedSectionTitles.has(sectionTitle)) return null;

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
  const renderSectionUpdateButton = (
    options: { testId?: string | null; className?: string; dirty?: boolean } = {},
  ) => {
    if (readOnlyMode || !isEditing) return null;
    const dirty = options.dirty ?? (activeSection ? isSectionDirty(activeSection.title) : false);
    return (
      <InlineUpdateButton
        saved={saved}
        disabled={uniqueCodeGateLocked || !dirty}
        testId={options.testId === undefined ? "add-save" : (options.testId ?? undefined)}
        className={options.className}
        onSave={() =>
          save({
            returnToQuickEntry: Boolean(quickFocus),
          })
        }
      />
    );
  };
  const renderLocalUpdateButton = (dirty?: boolean) =>
    renderSectionUpdateButton({ testId: null, dirty });
  const renderSectionFields = (section: (typeof extraSections)[number]) => (
    <div className="grid grid-cols-1 gap-4">
      {section.fields.map((field) => {
        const sectionCfaApprovalLocked =
          cfaApprovalGateLocked && cfaApprovalGatedSectionTitles.has(section.title);
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
              disabled={fieldReadOnly || uniqueCodeGateLocked || sectionCfaApprovalLocked}
              lockFilledFields={lockFilledFields}
              lockedSelectionFilled={
                hasFileValueForLock(savedFormForLocks, "valueCapital") ||
                hasFileValueForLock(savedFormForLocks, "valueRevenue")
              }
              lockedValueFilled={
                hasFileValueForLock(savedFormForLocks, "valueCapital") ||
                hasFileValueForLock(savedFormForLocks, "valueRevenue")
              }
              inputRef={(element) => {
                quickFieldRefs.current.valueCapital = element;
              }}
              onChange={(patch) => {
                if (readOnlyMode || uniqueCodeGateLocked || sectionCfaApprovalLocked) return;
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
              disabled={fieldReadOnly || uniqueCodeGateLocked || sectionCfaApprovalLocked}
              lockFilledFields={lockFilledFields}
              lockedValueFilled={
                hasFileValueForLock(savedFormForLocks, "soValueCapital") ||
                hasFileValueForLock(savedFormForLocks, "soValueRevenue")
              }
              onChange={(patch) => {
                if (readOnlyMode || uniqueCodeGateLocked || sectionCfaApprovalLocked) return;
                setForm((current) => applyConditionalRules({ ...current, ...patch }));
              }}
            />
          );
        }

        if (field.key === "gemBiddingMode" && !isYes(formWithLockedYear.gem)) {
          return null;
        }
        if (
          section.title === "Bidding details" &&
          !biddingApplicable &&
          field.key !== "gemBiddingMode"
        ) {
          return null;
        }

        const dynamicFieldDisabled =
          field.key === "year" ||
          field.key === "uniqueCode" ||
          field.key === "tenderLive" ||
          fieldReadOnly ||
          (uniqueCodeGateLocked && field.key !== "division") ||
          sectionCfaApprovalLocked ||
          (lockFilledFields && hasFileValueForLock(savedFormForLocks, field.key)) ||
          (["ad", "adSentDate", "adVettingDate"].includes(field.key) && adDisabledByDivision) ||
          (tcecIsNo && tcecDisabledKeys.includes(field.key)) ||
          (gemIsNo && gemDisabledKeys.includes(field.key)) ||
          (highValueIsNo && highValueDisabledKeys.includes(field.key)) ||
          (rqaIsNo && rqaDisabledKeys.includes(field.key)) ||
          (ifaIsNo && ifaDisabledKeys.includes(field.key)) ||
          (bgIsNo && bgDisabledKeys.includes(field.key)) ||
          (rfpVettingIsNo && rfpVettingDisabledKeys.includes(field.key)) ||
          (preBidMeetingIsNo && preBidMeetingDisabledKeys.includes(field.key)) ||
          (!isYes(formWithLockedYear.biddingStageOver) &&
            biddingStageOverDisabledKeys.includes(field.key)) ||
          (refloatIsNo && refloatDisabledKeys.includes(field.key)) ||
          (refloatPreBidMeetingIsNo && refloatPreBidMeetingDisabledKeys.includes(field.key)) ||
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
                disabled={demandCancelledUnlocked || uniqueCodeGateLocked}
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
    if (uniqueCodeGateLocked) {
      alert(
        "Select Division and wait for Unique code generation before entering or saving file details.",
      );
      return;
    }
    const requestedSupplyOrderCount = clampSupplyOrderCount(formWithLockedYear.noOfSo);
    const requestedSupplyOrders = resizeSupplyOrders(supplyOrders, requestedSupplyOrderCount);
    const useSupplyOrderMilestonesForSave = shouldUseSupplyOrderMilestones(
      requestedSupplyOrders,
      currentMilestone,
      completedMilestones,
    );
    const ordersWithMainMilestoneBridge = useSupplyOrderMilestonesForSave
      ? bridgeMainCurrentMilestoneToSupplyOrder(requestedSupplyOrders, currentMilestone)
      : requestedSupplyOrders;
    const cleanedRequestedSupplyOrders = cleanSupplyOrderRows(
      ordersWithMainMilestoneBridge,
      formWithLockedYear,
    );
    const cleanedSupplyOrders = cleanedRequestedSupplyOrders.filter(hasMeaningfulSupplyOrderData);
    if (
      isYes(formWithLockedYear.demandCancelled) &&
      hasPlacedSupplyOrderRows(cleanedSupplyOrders)
    ) {
      alert(
        "Demand can be cancelled only before any Supply Order is placed. Use S.O. cancelled for placed Supply Orders.",
      );
      return;
    }
    const stageAutofilledSupplyOrders = autoFillStageDeliveriesForSave(
      cleanedSupplyOrders,
      formWithLockedYear,
    );
    const supplyOrdersForSave = useSupplyOrderMilestonesForSave
      ? stageAutofilledSupplyOrders
      : clearSupplyOrderMilestones(stageAutofilledSupplyOrders);
    const supplyOrderMilestoneProgressForSave = getSupplyOrderMilestoneProgress(
      milestoneOptions,
      supplyOrdersForSave,
      formWithLockedYear,
      useSupplyOrderMilestonesForSave,
      currentMilestone,
    );
    const completedMilestonesForSave = getCompletedMilestonesForSave(
      fileLevelMilestoneOptions,
      fileLevelApplicableMilestones,
      completedMilestones,
      formWithLockedYear,
      supplyOrderMilestoneProgressForSave,
    );
    const currentMilestoneForSave =
      useSupplyOrderMilestonesForSave && getSupplyOrderMilestoneByName(currentMilestone)
        ? ""
        : currentMilestone;
    const payload = {
      ...toFilePayload(
        clearDivisionDisabledFields(applyConditionalRules(formWithLockedYear), divisions),
      ),
      ...firstSupplyOrderMirrorPatch(cleanedSupplyOrders),
      noOfSo: String(requestedSupplyOrderCount),
      supplyOrders: supplyOrdersForSave,
      remarks: cleanFileRemarks(fileRemarks) ?? [],
      markers: cleanFileMarkers(fileMarkers) ?? [],
      activeYears,
      bqBasis: biddingApplicable ? formWithLockedYear.bqBasis : "",
      bqFirms:
        biddingApplicable && formWithLockedYear.bqBasis === "Firm"
          ? (cleanFirmRows(firmDetails.bqFirms) ?? [])
          : [],
      invitedFirms: biddingApplicable ? (cleanFirmRows(firmDetails.invitedFirms) ?? []) : [],
      bidderFirms: biddingApplicable ? (cleanFirmRows(firmDetails.bidderFirms) ?? []) : [],
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
    const supplyOrderTabCompletionErrors = getSupplyOrderTabCompletionErrors(
      supplyOrdersForSave,
      formWithLockedYear,
    );
    const supplyOrderDateChronologyErrors = getSupplyOrderDateChronologyErrors(supplyOrdersForSave);
    const paymentBlockedByBgErrors = getPaymentBlockedByBgErrors(
      supplyOrdersForSave,
      formWithLockedYear,
    );
    const milestonesForValidation = fileLevelMilestoneOptions;
    const milestoneErrors = [
      ...supplyOrderTabCompletionErrors,
      ...supplyOrderDateChronologyErrors,
      ...supplyOrderMilestoneErrors,
      ...paymentBlockedByBgErrors,
      ...validateMilestoneCompletionConsistency(
        payload as Partial<FileRecord>,
        milestonesForValidation,
      ),
    ];
    if (milestoneErrors.length) {
      const targetMilestone =
        getMilestoneValidationTarget(milestoneErrors, fileLevelMilestoneOptions) ?? "";
      const hasSupplyOrderMilestoneErrors =
        supplyOrderTabCompletionErrors.length > 0 ||
        supplyOrderDateChronologyErrors.length > 0 ||
        supplyOrderMilestoneErrors.length > 0;
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
          getAddFileYearOptions(
            effectiveFinancialYear,
            settings.financialYears,
            settings.yearSelectionLocked,
          ),
          effectiveFinancialYear,
          settings.yearSelectionLocked,
        ),
      );
      setUnlockedSections(new Set());
      setPaidStageUnfreezeKeys(new Set());
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
                ? getEditFileHeading(formWithLockedYear, editingFile)
                : "Add a new file"}
          </h2>
          {drillPath.length ? (
            <DrillPathTrail
              items={[
                ...drillPath,
                {
                  label: readOnlyMode ? "View File" : "File Details",
                  href: currentFileHref,
                },
              ]}
              fallbackHref={currentFileHref}
            />
          ) : null}
          <p className="text-xs text-muted-foreground mt-1">
            {readOnlyMode
              ? "Viewer access is read-only. You can inspect milestones, dates, and file details."
              : isEditing
                ? "Update the filled and unfilled details for this file."
                : "All fields are optional — save now and complete missing details later."}
          </p>
        </div>

        <SectionBoard
          active={activeBoardSection}
          sections={visibleExtraSections}
          onOpen={setActiveBoardSection}
        />

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          {uniqueCodeGateLocked ? (
            <div className="md:col-span-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Select Division and wait for Unique code generation to activate the remaining fields.
            </div>
          ) : null}
          {activeSectionCfaApprovalLocked ? (
            <div className="md:col-span-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Enter CFA approval date in Approval block to activate this section.
            </div>
          ) : null}
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
              milestoneDisplayLabels={mainMilestoneDisplayLabels}
              inactiveMilestones={inactiveMainMilestones}
              focusedMilestone={focusedMilestone}
              disabled={readOnlyMode || uniqueCodeGateLocked}
              lockFilledFields={milestonesLocked}
              fileClosureDate={formWithLockedYear.fileClosureDate}
              lockControl={renderSectionUnlockButton("Milestones")}
              onCurrentChange={setCurrentMilestone}
              onCompletedChange={setCompletedMilestones}
              onFileClosureDateChange={(value) => update("fileClosureDate", value)}
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
                  disabled={readOnlyMode || uniqueCodeGateLocked || activeSectionCfaApprovalLocked}
                  lockFilledFields={firmDetailsLocked}
                  firmUniqueNoLabel={settings.firmUniqueNoLabel || "Firm Unique No."}
                  bqBasis={form.bqBasis}
                  quickFocus={Boolean(quickFocus && activeSection.title === "Firm details")}
                  renderUpdateButton={renderLocalUpdateButton}
                  onBqBasisChange={(value) => update("bqBasis", value)}
                  onAdd={addFirmDetail}
                  onChange={updateFirmDetail}
                  onPatch={patchFirmDetail}
                  onDelete={deleteFirmDetail}
                  onDeleteSelected={deleteSelectedFirmDetails}
                />
              ) : activeSection.title === "File Markers" ? (
                <FileMarkersBlock
                  markers={fileMarkers}
                  markerOptions={settings.specialFileMarkers ?? []}
                  disabled={readOnlyMode || uniqueCodeGateLocked}
                  lockFilledFields={fileMarkersLocked}
                  renderUpdateButton={renderLocalUpdateButton}
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
                  currentMilestone={currentMilestone}
                  completedMilestones={completedMilestones}
                  disabled={readOnlyMode || uniqueCodeGateLocked || activeSectionCfaApprovalLocked}
                  lockFilledFields={supplyOrdersLocked}
                  firmUniqueNoLabel={settings.firmUniqueNoLabel || "Firm Unique No."}
                  firmRatingConfig={settings.firmRatingConfig}
                  firmTypeOptions={firmTypeOptions}
                  gemDisabled={gemIsNo}
                  bgDisabled={bgIsNo}
                  irDisabled={irIsNo}
                  paidStageUnfreezeKeys={paidStageUnfreezeKeys}
                  quickFocus={Boolean(
                    quickFocus && activeSection.title === "Supply order and payment",
                  )}
                  focusTarget={focusTarget}
                  renderUpdateButton={renderLocalUpdateButton}
                  onCountChange={
                    supplyOrdersLocked && hasFileValueForLock(savedFormForLocks, "noOfSo")
                      ? () => undefined
                      : (value) => update("noOfSo", value)
                  }
                  onOrderChange={updateSupplyOrder}
                  onOrderBillReturnsChange={updateSupplyOrderBillReturns}
                  onOrderPatch={patchSupplyOrder}
                  onOrderCurrentMilestoneChange={updateSupplyOrderCurrentMilestone}
                  onOrderCompletedMilestonesChange={updateSupplyOrderCompletedMilestones}
                  onStageCurrentMilestoneChange={updateStageDeliveryCurrentMilestone}
                  onStageCompletedMilestonesChange={updateStageDeliveryCompletedMilestones}
                  onAdvancePaymentChange={updateAdvancePayment}
                  onAdvancePaymentBillReturnsChange={updateAdvancePaymentBillReturns}
                  onStageDeliveryChange={updateStageDelivery}
                  onStageDeliveryBillReturnsChange={updateStageDeliveryBillReturns}
                  onPaidStageUnfreeze={unlockPaidStage}
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
                  disabled={readOnlyMode || uniqueCodeGateLocked || activeSectionCfaApprovalLocked}
                />
              ) : null}
              {editingFile && activeSection.title !== "File Markers" ? (
                <SectionMessages
                  fileId={editingFile.id}
                  sectionTitle={activeSection.title}
                  messages={activeSectionMessages}
                  activeUserRole={activeUser?.role}
                  messagesEnabled={selectedDivision?.messagesEnabled !== false}
                  renderUpdateButton={
                    activeSection.title === "Supply order and payment"
                      ? renderLocalUpdateButton
                      : undefined
                  }
                />
              ) : null}
            </section>
          )}
          {activeSection?.title !== "Supply order and payment" && renderSectionUpdateButton() ? (
            <div className="md:col-span-2 flex justify-end border-t border-border/60 pt-4">
              {renderSectionUpdateButton()}
            </div>
          ) : null}
        </div>
        <div className="px-5 py-4 border-t border-border bg-secondary/40 flex flex-wrap items-center justify-between gap-2">
          <div>
            {isEditing && !readOnlyMode && activeSection?.title === "File details" && (
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
            {!isEditing && !readOnlyMode ? (
              <button
                type="button"
                onClick={() =>
                  save({
                    returnToQuickEntry: Boolean(quickFocus),
                  })
                }
                data-testid="add-save"
                disabled={uniqueCodeGateLocked}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
  sections,
  onOpen,
}: {
  active: string;
  sections: typeof extraSections;
  onOpen: (sectionTitle: string) => void;
}) {
  const links = [
    "Timeline",
    "Remarks Summary",
    "Milestones",
    ...sections.map((section) => section.title),
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
            data-testid={`add-section-${testIdSlug(label)}`}
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
                  <DateInput
                    value={getRemarkDateInputValue(remark.createdAt)}
                    onChange={(value) => onDateChange(remark.id, value)}
                    disabled={disabled}
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
  renderUpdateButton,
}: {
  fileId: string;
  sectionTitle: string;
  messages: FileMessage[];
  activeUserRole?: string;
  messagesEnabled: boolean;
  renderUpdateButton?: (dirty?: boolean) => ReactNode;
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
      {renderUpdateButton ? (
        <div className="mt-3 flex justify-end border-t border-border/60 pt-3">
          {renderUpdateButton()}
        </div>
      ) : null}
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
  markerOptions,
  disabled,
  lockFilledFields,
  renderUpdateButton,
  onAdd,
  onChange,
  onDelete,
}: {
  markers: FileMarker[];
  markerOptions: SpecialFileMarker[];
  disabled: boolean;
  lockFilledFields: boolean;
  renderUpdateButton?: (dirty?: boolean) => ReactNode;
  onAdd: (code: string) => void;
  onChange: (markerId: string, text: string) => void;
  onDelete: (markerId: string) => void;
}) {
  const locked = disabled || lockFilledFields;
  const [selectedCode, setSelectedCode] = useState("");
  const configuredCodes = new Set(markerOptions.map((marker) => marker.code.trim().toUpperCase()));
  const markerByCode = new Map(
    markerOptions.map((marker) => [marker.code.trim().toUpperCase(), marker]),
  );
  const extraCodes = Array.from(
    new Set(
      markers
        .map((marker) => marker.text.trim().toUpperCase())
        .filter((code) => code && !configuredCodes.has(code)),
    ),
  );
  const allOptions = [
    ...markerOptions,
    ...extraCodes.map((code) => ({ code, description: "Unconfigured marker code" })),
  ];
  const selectedCodes = new Set(markers.map((marker) => marker.text.trim().toUpperCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Special File Markers</div>
          <div className="text-xs text-muted-foreground">
            Select configured marker codes for special scenarios linked to this file.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedCode}
            onChange={(event) => setSelectedCode(event.target.value)}
            disabled={locked || markerOptions.length === 0}
            className="h-8 min-w-44 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">Select marker</option>
            {markerOptions.map((marker) => (
              <option
                key={marker.code}
                value={marker.code}
                disabled={selectedCodes.has(marker.code.trim().toUpperCase())}
              >
                {marker.code}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              onAdd(selectedCode);
              setSelectedCode("");
            }}
            disabled={locked || !selectedCode}
            className={
              "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent" +
              disabledCls(locked || !selectedCode)
            }
          >
            <Plus className="size-3.5" /> Attach marker
          </button>
        </div>
      </div>

      {markerOptions.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
          Add marker codes in Settings before attaching them to files.
        </div>
      ) : null}

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
              <select
                value={marker.text}
                onChange={(event) => onChange(marker.id, event.target.value)}
                disabled={locked}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">Select marker</option>
                {allOptions.map((option) => (
                  <option
                    key={option.code}
                    value={option.code}
                    disabled={
                      selectedCodes.has(option.code.trim().toUpperCase()) &&
                      option.code.trim().toUpperCase() !== marker.text.trim().toUpperCase()
                    }
                  >
                    {option.code}
                  </option>
                ))}
              </select>
              {markerByCode.get(marker.text.trim().toUpperCase())?.description ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  {markerByCode.get(marker.text.trim().toUpperCase())?.description}
                </div>
              ) : null}
              {renderUpdateButton ? (
                <div className="mt-3 flex justify-end border-t border-border/60 pt-3">
                  {renderUpdateButton()}
                </div>
              ) : null}
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
  firmUniqueNoLabel,
  bqBasis,
  quickFocus,
  renderUpdateButton,
  onBqBasisChange,
  onAdd,
  onChange,
  onPatch,
  onDelete,
  onDeleteSelected,
}: {
  details: FirmDetailsState;
  lockedDetails: FirmDetailsState;
  disabled: boolean;
  lockFilledFields: boolean;
  firmUniqueNoLabel: string;
  bqBasis: string;
  quickFocus?: boolean;
  renderUpdateButton?: (dirty?: boolean) => ReactNode;
  onBqBasisChange: (value: string) => void;
  onAdd: (group: keyof FirmDetailsState) => void;
  onChange: (
    group: keyof FirmDetailsState,
    index: number,
    key: keyof FirmDetail,
    value: string,
  ) => void;
  onPatch: (group: keyof FirmDetailsState, index: number, patch: Partial<FirmDetail>) => void;
  onDelete: (group: keyof FirmDetailsState, index: number) => void;
  onDeleteSelected: (group: keyof FirmDetailsState, indexes: number[]) => void;
}) {
  const [activeTab, setActiveTab] = useState<keyof FirmDetailsState>("bqFirms");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());
  const [masterFirms, setMasterFirms] = useState<MasterFirm[]>([]);
  const [firmSaveMessage, setFirmSaveMessage] = useState<string | undefined>();
  const tabs: { key: keyof FirmDetailsState; label: string }[] = [
    { key: "bqFirms", label: "BQ" },
    { key: "invitedFirms", label: "Invited" },
    { key: "bidderFirms", label: "Bidders" },
  ];
  const rows = details[activeTab];
  const firmInputRefs = useRef<Record<string, HTMLInputElement | HTMLButtonElement | null>>({});
  const firmQuickFocusAppliedRef = useRef("");
  const latestFirmRowsRef = useRef(rows);
  const firmCounts = {
    bqFirms: details.bqFirms.length,
    invitedFirms: details.invitedFirms.length,
    bidderFirms: details.bidderFirms.length,
  };
  const bqBasisOptions = ["Firm", "GeM", "User estimate", "LPP"];
  const showFirmRows = activeTab !== "bqFirms" || bqBasis === "Firm";
  const selectedIndexes = [...selectedRows].filter((index) => index < rows.length);
  const firmNameOptionMap = useMemo(() => {
    const map = new Map<string, MasterFirm>();
    for (const firm of masterFirms) {
      const option = firmNameOption(firm);
      if (option) map.set(option, firm);
    }
    return map;
  }, [masterFirms]);
  const firmUniqueNoOptionMap = useMemo(() => {
    const map = new Map<string, MasterFirm>();
    for (const firm of masterFirms) {
      const option = firmUniqueNoOption(firm);
      if (option) map.set(option, firm);
    }
    return map;
  }, [masterFirms]);
  const firmNameOptions = useMemo(() => Array.from(firmNameOptionMap.keys()), [firmNameOptionMap]);
  const firmUniqueNoOptions = useMemo(
    () => Array.from(firmUniqueNoOptionMap.keys()),
    [firmUniqueNoOptionMap],
  );

  const loadMasterFirms = () => {
    fetchMasterFirms({ pageSize: 500 })
      .then((result) => setMasterFirms(result.firms))
      .catch((error) => {
        console.error(error);
        setFirmSaveMessage(
          error instanceof Error ? error.message : "Failed to load firm database.",
        );
      });
  };

  useEffect(() => {
    setSelectedRows(new Set());
  }, [activeTab, rows.length]);

  useEffect(() => {
    loadMasterFirms();
  }, []);

  useEffect(() => {
    if (disabled || !masterFirms.length) return;
    rows.forEach((row, index) => {
      const selectedFirm = findLinkedMasterFirm(masterFirms, row);
      if (!selectedFirm) return;
      const patch: Partial<FirmDetail> = {};
      if (!hasFilledValue(row.firmName) && selectedFirm.firmName) {
        patch.firmName = selectedFirm.firmName;
      }
      if (!hasFilledValue(row.firmUniqueNo) && selectedFirm.firmUniqueNo) {
        patch.firmUniqueNo = selectedFirm.firmUniqueNo;
      }
      if (Object.keys(patch).length) onPatch(activeTab, index, patch);
    });
  }, [activeTab, disabled, masterFirms, onPatch, rows]);

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
        for (const key of [
          "firmName",
          "firmUniqueNo",
          "emailId",
          "address",
          "city",
          "contactNo",
        ] as const) {
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

  const applyMasterFirm = (group: keyof FirmDetailsState, index: number, firm: MasterFirm) => {
    onPatch(group, index, {
      firmName: firm.firmName ?? "",
      emailId: firm.emailId ?? "",
      firmUniqueNo: firm.firmUniqueNo ?? "",
      city: firm.city ?? "",
      address: firm.address ?? "",
      contactNo: firm.contactNo ?? "",
    });
  };

  const addRowToFirmDatabase = async (index: number, row: FirmDetail) => {
    const payload = {
      firmName: row.firmName?.trim() || undefined,
      emailId: row.emailId?.trim() || undefined,
      firmUniqueNo: row.firmUniqueNo?.trim() || undefined,
      city: row.city?.trim() || undefined,
      address: row.address?.trim() || undefined,
      contactNo: row.contactNo?.trim() || undefined,
    };
    if (!payload.firmName && !payload.emailId && !payload.firmUniqueNo) return;
    if (!isValidEmailFormat(payload.emailId)) {
      setFirmSaveMessage("Enter a valid email id.");
      return;
    }
    try {
      setFirmSaveMessage(undefined);
      const result = await createMasterFirm(payload);
      applyMasterFirm(activeTab, index, result.firm);
      setMasterFirms((current) => [
        result.firm,
        ...current.filter((firm) => firm.id !== result.firm.id),
      ]);
      setFirmSaveMessage("Firm added to database.");
    } catch (error) {
      setFirmSaveMessage(error instanceof Error ? error.message : "Failed to add firm.");
    }
  };

  return (
    <div className="space-y-4">
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

      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <div className="mb-1.5 text-xs font-medium">BQ firms</div>
          <input
            value={bqBasis === "Firm" ? firmCounts.bqFirms : 0}
            readOnly
            disabled={disabled}
            className={inputCls + disabledCls(disabled)}
          />
        </label>
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

      {activeTab === "bqFirms" ? (
        <label className="block max-w-xs">
          <div className="mb-1.5 text-xs font-medium">BQ</div>
          <select
            value={bqBasis}
            onChange={(event) => onBqBasisChange(event.target.value)}
            disabled={disabled}
            className={inputCls + disabledCls(disabled)}
          >
            <option value="">BQ</option>
            {bqBasisOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{selectedIndexes.length} selected</div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => exportFirmDetails(details, "pdf")}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent"
          >
            <Printer className="size-3.5" /> Export PDF
          </button>
          <button
            type="button"
            onClick={() => exportFirmDetails(details, "excel")}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent"
          >
            <Save className="size-3.5" /> Export Excel
          </button>
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
      </div>
      {firmSaveMessage ? (
        <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          {firmSaveMessage}
        </div>
      ) : null}

      {showFirmRows ? (
        <div className="space-y-3">
          {rows.map((row, index) => {
            const lockedRow = lockedDetails[activeTab][index];
            const rowHasValue =
              hasFilledValue(lockedRow?.firmName) ||
              hasFilledValue(lockedRow?.city) ||
              hasFilledValue(lockedRow?.address) ||
              hasFilledValue(lockedRow?.emailId) ||
              hasFilledValue(lockedRow?.firmUniqueNo) ||
              hasFilledValue(lockedRow?.contactNo);
            const firmNameDisabled =
              disabled || (lockFilledFields && hasFilledValue(lockedRow?.firmName));
            const cityDisabled = disabled || (lockFilledFields && hasFilledValue(lockedRow?.city));
            const addressDisabled =
              disabled || (lockFilledFields && hasFilledValue(lockedRow?.address));
            const emailDisabled =
              disabled || (lockFilledFields && hasFilledValue(lockedRow?.emailId));
            const firmUniqueNoDisabled =
              disabled || (lockFilledFields && hasFilledValue(lockedRow?.firmUniqueNo));
            const contactNoDisabled =
              disabled || (lockFilledFields && hasFilledValue(lockedRow?.contactNo));
            const rowActionDisabled = disabled || (lockFilledFields && rowHasValue);
            const addFirmDisabled =
              disabled ||
              (!hasFilledValue(row.firmName) &&
                !hasFilledValue(row.emailId) &&
                !hasFilledValue(row.firmUniqueNo));
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
                  <SearchableDropdown
                    inputRef={(element) => {
                      firmInputRefs.current[`${index}:firmName`] = element;
                    }}
                    value={row.firmName ?? ""}
                    onChange={(value) => {
                      const selectedFirm = firmNameOptionMap.get(value);
                      if (selectedFirm) {
                        applyMasterFirm(activeTab, index, selectedFirm);
                      } else {
                        onChange(activeTab, index, "firmName", value);
                      }
                    }}
                    options={firmNameOptions}
                    placeholder="Firm name"
                    disabled={firmNameDisabled}
                    className={inputCls + disabledCls(firmNameDisabled)}
                  />
                </label>
                <label className="block">
                  <div className="mb-1.5 text-xs font-medium">{firmUniqueNoLabel}</div>
                  <SearchableDropdown
                    inputRef={(element) => {
                      firmInputRefs.current[`${index}:firmUniqueNo`] = element;
                    }}
                    value={row.firmUniqueNo ?? ""}
                    onChange={(value) => {
                      const selectedFirm = firmUniqueNoOptionMap.get(value);
                      if (selectedFirm) {
                        applyMasterFirm(activeTab, index, selectedFirm);
                      } else {
                        onChange(activeTab, index, "firmUniqueNo", value);
                      }
                    }}
                    options={firmUniqueNoOptions}
                    placeholder={firmUniqueNoLabel}
                    disabled={firmUniqueNoDisabled}
                    className={inputCls + disabledCls(firmUniqueNoDisabled)}
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
                    pattern="[^\s@]+@[^\s@]+\.[^\s@]+"
                    aria-invalid={!isValidEmailFormat(row.emailId)}
                    disabled={emailDisabled}
                    className={
                      inputCls +
                      disabledCls(emailDisabled) +
                      (!isValidEmailFormat(row.emailId) ? " border-destructive" : "")
                    }
                  />
                </label>
                <label className="block">
                  <div className="mb-1.5 text-xs font-medium">Address</div>
                  <input
                    ref={(element) => {
                      firmInputRefs.current[`${index}:address`] = element;
                    }}
                    value={row.address ?? ""}
                    onChange={(event) => onChange(activeTab, index, "address", event.target.value)}
                    disabled={addressDisabled}
                    className={inputCls + disabledCls(addressDisabled)}
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
                  <div className="mb-1.5 text-xs font-medium">Contact No.</div>
                  <input
                    ref={(element) => {
                      firmInputRefs.current[`${index}:contactNo`] = element;
                    }}
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={row.contactNo ?? ""}
                    onChange={(event) =>
                      onChange(activeTab, index, "contactNo", numericOnly(event.target.value))
                    }
                    disabled={contactNoDisabled}
                    className={inputCls + disabledCls(contactNoDisabled)}
                  />
                </label>
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => void addRowToFirmDatabase(index, row)}
                    disabled={addFirmDisabled}
                    className={
                      "inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent" +
                      disabledCls(addFirmDisabled)
                    }
                  >
                    <Plus className="size-3.5" /> Add
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteFirm(index)}
                    disabled={rowActionDisabled}
                    aria-label="Delete firm"
                    title="Delete firm"
                    className={
                      "inline-flex size-9 items-center justify-center rounded-md border border-destructive/30 bg-background text-destructive hover:bg-destructive/10" +
                      disabledCls(rowActionDisabled)
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {renderUpdateButton ? (
                  <div className="flex justify-end border-t border-border/60 pt-3 md:col-span-5">
                    {renderUpdateButton()}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {showFirmRows ? (
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
      ) : null}
    </div>
  );
}

function AddBreadcrumb({
  items,
}: {
  items: Array<{ label: string; onClick?: () => void } | undefined>;
}) {
  const visibleItems = items.filter((item): item is { label: string; onClick?: () => void } =>
    Boolean(item),
  );
  if (visibleItems.length < 2) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {visibleItems.map((item, index) => (
        <Fragment key={`${item.label}-${index}`}>
          {index > 0 ? <span>/</span> : null}
          {item.onClick ? (
            <button
              type="button"
              onClick={item.onClick}
              className="font-medium text-foreground hover:text-primary hover:underline"
            >
              {item.label}
            </button>
          ) : (
            <span>{item.label}</span>
          )}
        </Fragment>
      ))}
    </div>
  );
}

function InlineUpdateButton({
  saved,
  disabled,
  onSave,
  testId,
  className = "",
}: {
  saved: boolean;
  disabled: boolean;
  onSave: () => void;
  testId?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={disabled}
      data-testid={testId}
      className={
        "inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 " +
        className
      }
    >
      <Save className="size-3.5" /> {disabled ? "Inactive" : saved ? "Saved" : "Update"}
    </button>
  );
}

function SupplyOrdersBlock({
  form,
  lockedForm,
  orders,
  lockedOrders,
  currentMilestone,
  completedMilestones,
  disabled,
  lockFilledFields,
  firmUniqueNoLabel,
  firmRatingConfig,
  firmTypeOptions,
  gemDisabled,
  bgDisabled,
  irDisabled,
  paidStageUnfreezeKeys,
  quickFocus,
  focusTarget,
  renderUpdateButton,
  onCountChange,
  onOrderChange,
  onOrderBillReturnsChange,
  onOrderPatch,
  onOrderCurrentMilestoneChange,
  onOrderCompletedMilestonesChange,
  onStageCurrentMilestoneChange,
  onStageCompletedMilestonesChange,
  onAdvancePaymentChange,
  onAdvancePaymentBillReturnsChange,
  onStageDeliveryChange,
  onStageDeliveryBillReturnsChange,
  onPaidStageUnfreeze,
}: {
  form: FormState;
  lockedForm: FormState;
  orders: SupplyOrderDetail[];
  lockedOrders: SupplyOrderDetail[];
  currentMilestone: string;
  completedMilestones: string[];
  disabled: boolean;
  lockFilledFields: boolean;
  firmUniqueNoLabel: string;
  firmRatingConfig?: FirmRatingConfig;
  firmTypeOptions: string[];
  gemDisabled: boolean;
  bgDisabled: boolean;
  irDisabled: boolean;
  paidStageUnfreezeKeys: Set<string>;
  quickFocus?: boolean;
  focusTarget?: string;
  renderUpdateButton?: (dirty?: boolean) => ReactNode;
  onCountChange: (value: string) => void;
  onOrderChange: (index: number, key: SupplyOrderKey, value: string) => void;
  onOrderBillReturnsChange: (index: number, billReturnCycles: BillReturnCycle[]) => void;
  onOrderPatch: (index: number, patch: Partial<SupplyOrderDetail>) => void;
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
  onAdvancePaymentBillReturnsChange: (
    orderIndex: number,
    billReturnCycles: BillReturnCycle[],
  ) => void;
  onStageDeliveryChange: (
    orderIndex: number,
    stageIndex: number,
    key: StageDeliveryKey,
    value: string,
  ) => void;
  onStageDeliveryBillReturnsChange: (
    orderIndex: number,
    stageIndex: number,
    billReturnCycles: BillReturnCycle[],
  ) => void;
  onPaidStageUnfreeze: (orderIndex: number, stageIndex: number) => void;
}) {
  const orderFieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const focusBlockRefs = useRef<Record<string, HTMLElement | null>>({});
  const orderQuickFocusAppliedRef = useRef("");
  const focusAppliedRef = useRef("");
  const latestOrdersRef = useRef(orders);
  const [activeSubview, setActiveSubview] = useState<SupplyOrderSubviewKey>("supplyOrder");
  const [downstreamOverrideUnlocked, setDownstreamOverrideUnlocked] = useState(false);
  const [masterFirms, setMasterFirms] = useState<MasterFirm[]>([]);
  const [openCardKeys, setOpenCardKeys] = useState<Set<string>>(new Set());
  const deliveryInspectionInactive = isDeliveryInspectionInactive(form);
  const effectiveIrDisabled = irDisabled || deliveryInspectionInactive;
  const focusConfigs = useMemo(() => parseSupplyOrderFocusTargets(focusTarget), [focusTarget]);
  const focusConfig = focusConfigs[0];
  const effectiveFocusSubview = focusConfig?.subview;
  const ratingFields = normalizeFirmRatingConfig(firmRatingConfig).fields;
  const focusBlockKeys = useMemo(
    () =>
      Array.from(
        new Set(focusConfigs.flatMap((config) => getSupplyOrderFocusKeys(orders, config, form))),
      ),
    [focusConfigs, form, orders],
  );
  const focusFieldKeys = useMemo(
    () =>
      Array.from(new Set(focusConfigs.flatMap((config) => getSupplyOrderFocusFieldKeys(config)))),
    [focusConfigs],
  );
  const focusBlockKeySet = useMemo(() => new Set(focusBlockKeys), [focusBlockKeys]);
  const useOrderMilestones = shouldUseSupplyOrderMilestones(
    orders,
    currentMilestone,
    completedMilestones,
  );
  const firmNameOptionMap = useMemo(() => {
    const map = new Map<string, MasterFirm>();
    for (const firm of masterFirms) {
      const option = firmNameOption(firm);
      if (option) map.set(option, firm);
    }
    return map;
  }, [masterFirms]);
  const firmUniqueNoOptionMap = useMemo(() => {
    const map = new Map<string, MasterFirm>();
    for (const firm of masterFirms) {
      const option = firmUniqueNoOption(firm);
      if (option) map.set(option, firm);
    }
    return map;
  }, [masterFirms]);
  const firmNameOptions = useMemo(() => Array.from(firmNameOptionMap.keys()), [firmNameOptionMap]);
  const firmUniqueNoOptions = useMemo(
    () => Array.from(firmUniqueNoOptionMap.keys()),
    [firmUniqueNoOptionMap],
  );
  const activeSubviewSupplyOrderFields = supplyOrderSubviewFields[
    activeSubview
  ] as readonly SupplyOrderKey[];
  const activeSubviewMilestones = supplyOrderSubviewMilestones[
    activeSubview
  ] as readonly SupplyOrderMilestoneName[];
  const activeSubviewFields = supplyOrderFields.filter((field) =>
    activeSubview === "delivery" && deliveryInspectionInactive
      ? field.key === "jobCompletionDate"
      : activeSubviewSupplyOrderFields.includes(field.key as SupplyOrderKey),
  );
  const noOfSoDirty = form.noOfSo !== lockedForm.noOfSo || orders.length !== lockedOrders.length;
  const getOrderSubviewDirty = (
    order: SupplyOrderDetail,
    lockedOrder: SupplyOrderDetail | undefined,
    fieldsToRender: ExtraField[],
  ) => {
    if (activeSubview === "firmRating") {
      return !isDirtyValueEqual(
        normalizeDirtyObject(order.firmRatingValues ?? {}),
        normalizeDirtyObject(lockedOrder?.firmRatingValues ?? {}),
      );
    }
    if (activeSubview === "supplementaryBills") {
      return !isDirtyValueEqual(
        cleanSupplementaryBills(order.supplementaryBills),
        cleanSupplementaryBills(lockedOrder?.supplementaryBills),
      );
    }
    const keys = expandSupplyOrderDirtyKeys(
      fieldsToRender.map((field) => field.key as SupplyOrderKey),
    );
    const currentValues = normalizeDirtyObject(
      Object.fromEntries(keys.map((key) => [key, order[key] ?? ""])),
    );
    const lockedValues = normalizeDirtyObject(
      Object.fromEntries(keys.map((key) => [key, lockedOrder?.[key] ?? ""])),
    );
    const milestonesChanged =
      activeSubviewMilestones.length > 0 &&
      (!isDirtyValueEqual(
        normalizeDirtyValue("currentMilestone", order.currentMilestone),
        normalizeDirtyValue("currentMilestone", lockedOrder?.currentMilestone),
      ) ||
        !isDirtyValueEqual(
          normalizeDirtyValue("completedMilestones", order.completedMilestones),
          normalizeDirtyValue("completedMilestones", lockedOrder?.completedMilestones),
        ));
    return !isDirtyValueEqual(currentValues, lockedValues) || milestonesChanged;
  };
  const getAdvancePaymentDirty = (
    order: SupplyOrderDetail,
    lockedOrder: SupplyOrderDetail | undefined,
  ) =>
    !isDirtyValueEqual(
      normalizeDirtyObject(
        applyAdvancePaymentRules(
          order.advancePaymentDetail ?? {},
          isYes(order.advancePayment ?? ""),
        ),
      ),
      normalizeDirtyObject(
        applyAdvancePaymentRules(
          lockedOrder?.advancePaymentDetail ?? {},
          isYes(lockedOrder?.advancePayment ?? ""),
        ),
      ),
    );
  const getStageDeliveryDirty = (
    stage: StageDeliveryDetail,
    lockedOrder: SupplyOrderDetail | undefined,
    stageIndex: number,
  ) =>
    !isDirtyValueEqual(
      normalizeDirtyObject(stage as Record<string, unknown>),
      normalizeDirtyObject(
        (lockedOrder?.stageDeliveries?.[stageIndex] ?? {}) as Record<string, unknown>,
      ),
    );

  useEffect(() => {
    if (effectiveFocusSubview) setActiveSubview(effectiveFocusSubview);
  }, [effectiveFocusSubview]);

  useEffect(() => {
    fetchMasterFirms({ pageSize: 500 })
      .then((result) => setMasterFirms(result.firms))
      .catch((error) => console.error(error));
  }, []);

  useEffect(() => {
    if (disabled || !masterFirms.length) return;
    orders.forEach((order, index) => {
      const selectedFirm = findLinkedMasterFirm(masterFirms, order);
      if (!selectedFirm) return;
      const patch: Partial<SupplyOrderDetail> = {};
      if (!hasFilledValue(order.firm) && selectedFirm.firmName) {
        patch.firm = selectedFirm.firmName;
      }
      if (!hasFilledValue(order.firmUniqueNo) && selectedFirm.firmUniqueNo) {
        patch.firmUniqueNo = selectedFirm.firmUniqueNo;
      }
      if (Object.keys(patch).length) onOrderPatch(index, patch);
    });
  }, [disabled, masterFirms, onOrderPatch, orders]);

  useEffect(() => {
    latestOrdersRef.current = orders;
  });

  const setCardOpen = (key: string, open: boolean) => {
    setOpenCardKeys((current) => {
      if (open === current.has(key)) return current;
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const unlockDownstreamOverride = async () => {
    if (disabled || downstreamOverrideUnlocked) return;
    const allowed = await requestDeletionPassword("unlock downstream delivery/payment fields");
    if (allowed) setDownstreamOverrideUnlocked(true);
  };

  const applyMasterFirmToOrder = (index: number, firm: MasterFirm) => {
    onOrderPatch(index, {
      firm: firm.firmName ?? "",
      firmUniqueNo: firm.firmUniqueNo ?? "",
      firmContactNo: firm.contactNo ?? "",
      firmCity: firm.city ?? "",
    });
  };

  const clearMasterFirmFromOrder = (index: number) => {
    onOrderPatch(index, {
      firm: "",
      firmUniqueNo: "",
      firmContactNo: "",
      firmCity: "",
    });
  };

  const addSupplementaryBillDraft = (orderIndex: number) => {
    if (disabled) return;
    const currentBills = normalizeSupplementaryBillDrafts(orders[orderIndex]?.supplementaryBills);
    onOrderPatch(orderIndex, {
      supplementaryBills: [...currentBills, createSupplementaryBillDraft()],
    });
  };
  const updateSupplementaryBillDraft = (
    orderIndex: number,
    draftId: string,
    patch: Partial<SupplementaryBillDraft>,
  ) => {
    const currentBills = normalizeSupplementaryBillDrafts(orders[orderIndex]?.supplementaryBills);
    onOrderPatch(orderIndex, {
      supplementaryBills: currentBills.map((bill) =>
        bill.id === draftId ? { ...bill, ...patch } : bill,
      ),
    });
  };
  const removeSupplementaryBillDraft = (orderIndex: number, draftId: string) => {
    if (disabled) return;
    const currentBills = normalizeSupplementaryBillDrafts(orders[orderIndex]?.supplementaryBills);
    onOrderPatch(orderIndex, {
      supplementaryBills: currentBills.filter((bill) => bill.id !== draftId),
    });
  };

  const updateOrderFirmLookup = (
    index: number,
    key: "firm" | "firmUniqueNo",
    value: string,
    optionMap: Map<string, MasterFirm>,
  ) => {
    const selectedFirm = optionMap.get(value);
    if (selectedFirm) {
      applyMasterFirmToOrder(index, selectedFirm);
      return;
    }
    if (!hasFilledValue(value)) {
      clearMasterFirmFromOrder(index);
      return;
    }
    onOrderPatch(index, {
      firm: key === "firm" ? value : "",
      firmUniqueNo: key === "firmUniqueNo" ? value : "",
      firmContactNo: "",
      firmCity: "",
    });
  };

  useEffect(() => {
    if (!focusConfigs.length || activeSubview !== effectiveFocusSubview) return;
    const appliedKey = `${focusTarget ?? ""}:${focusBlockKeys.join("|")}:${focusFieldKeys.join("|")}:${activeSubview}`;
    if (focusAppliedRef.current === appliedKey) return;
    const blockKey = focusBlockKeys[0];
    if (!blockKey) return;

    let cancelled = false;
    let timeoutId: number | undefined;
    let attempts = 0;
    const focusWhenReady = () => {
      if (cancelled) return;
      focusBlockKeys.forEach((key) => {
        const block = focusBlockRefs.current[key];
        const parentBlockKey = getSupplyOrderParentFocusBlockKey(key);
        const parentBlock = parentBlockKey ? focusBlockRefs.current[parentBlockKey] : undefined;
        if (parentBlock instanceof HTMLDetailsElement) parentBlock.open = true;
        if (block instanceof HTMLDetailsElement) block.open = true;
      });
      const focusedBlock = focusBlockRefs.current[blockKey];
      if (!focusedBlock && attempts < 20) {
        attempts += 1;
        timeoutId = window.setTimeout(focusWhenReady, 100);
        return;
      }
      if (!focusedBlock) return;
      if (focusedBlock instanceof HTMLDetailsElement) focusedBlock.open = true;
      let parentDetails = focusedBlock?.parentElement?.closest("details") ?? null;
      while (parentDetails) {
        parentDetails.open = true;
        parentDetails = parentDetails.parentElement?.closest("details") ?? null;
      }
      const focusedField = focusFieldKeys
        .map((fieldKey) => orderFieldRefs.current[fieldKey])
        .find((element): element is HTMLElement => element instanceof HTMLElement);
      if (!focusedField && focusFieldKeys.length && attempts < 20) {
        attempts += 1;
        timeoutId = window.setTimeout(focusWhenReady, 100);
        return;
      }
      (focusedField ?? focusedBlock).scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      focusAppliedRef.current = appliedKey;
    };
    timeoutId = window.setTimeout(focusWhenReady, 150);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [
    activeSubview,
    effectiveFocusSubview,
    focusBlockKeys,
    focusConfigs,
    focusFieldKeys,
    focusTarget,
  ]);

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
            (effectiveIrDisabled && supplyOrderIrDisabledKeys.includes(key)) ||
            (!effectiveIrDisabled && key === "jobCompletionDate")
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <AddBreadcrumb
            items={[
              {
                label: "Supply order and payment",
                onClick:
                  activeSubview !== "supplyOrder"
                    ? () => setActiveSubview("supplyOrder")
                    : undefined,
              },
              activeSubview !== "supplyOrder"
                ? {
                    label:
                      activeSubview === "delivery" && deliveryInspectionInactive
                        ? "Job Completion"
                        : (supplyOrderSubviewTabs.find((tab) => tab.key === activeSubview)?.label ??
                          "Supply order"),
                  }
                : undefined,
            ]}
          />
          <div className="flex flex-wrap gap-2 rounded-md border border-border bg-secondary/20 p-1.5">
            {supplyOrderSubviewTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActiveSubview(tab.key);
                }}
                data-testid={`add-so-tab-${tab.key}`}
                className={
                  "h-8 rounded px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 " +
                  (activeSubview === tab.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground")
                }
              >
                {tab.key === "delivery" && deliveryInspectionInactive
                  ? "Job Completion"
                  : tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeSubview === "supplyOrder" ? (
        <div className="space-y-3">
          <DynamicField
            field={{ key: "noOfSo", label: "No. of S.O.", type: "number", min: 1 }}
            value={form.noOfSo}
            disabled={disabled || (lockFilledFields && hasFilledValue(lockedForm.noOfSo))}
            onChange={onCountChange}
            inputRef={(element) => {
              orderFieldRefs.current.noOfSo = element;
            }}
          />
          {renderUpdateButton ? (
            <div className="flex justify-end border-t border-border/60 pt-3">
              {renderUpdateButton(noOfSoDirty)}
            </div>
          ) : null}
        </div>
      ) : null}

      {!activeSubviewFields.length &&
      !activeSubviewMilestones.length &&
      activeSubview !== "firmRating" &&
      activeSubview !== "supplementaryBills" ? (
        <div className="rounded-md border border-dashed border-border bg-secondary/20 px-4 py-6 text-sm text-muted-foreground">
          No fields in this tab.
        </div>
      ) : null}

      {isDownstreamSubview(activeSubview) &&
      orders.some((order) => !isSupplyOrderAndDpComplete(order, form)) ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div>
            <div className="font-medium">
              Complete Supply Order and D.P. details before editing this tab.
            </div>
            <div className="text-xs">
              Incomplete orders stay locked unless you unlock these downstream fields.
            </div>
          </div>
          <button
            type="button"
            onClick={unlockDownstreamOverride}
            disabled={disabled || downstreamOverrideUnlocked}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-400 bg-background px-2.5 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downstreamOverrideUnlocked ? (
              <>
                <Unlock className="size-3.5" /> Downstream unlocked
              </>
            ) : (
              <>
                <Lock className="size-3.5" /> Unlock with password
              </>
            )}
          </button>
        </div>
      ) : null}

      {activeSubviewFields.length ||
      activeSubviewMilestones.length ||
      activeSubview === "firmRating" ||
      activeSubview === "supplementaryBills"
        ? orders.map((order, index) => {
            const lockedOrder = lockedOrders[index];
            const stageFields =
              activeSubview === "delivery" && deliveryInspectionInactive
                ? (["jobCompletionDate"] as readonly StageDeliveryKey[])
                : getStagedDeliverySubviewFields(activeSubview);
            const useStageFields = Boolean(stageFields && isYes(order.stageDelivery ?? ""));
            const useStageCards =
              useStageFields && (activeSubview !== "payment" || isYes(order.stagePayment ?? ""));
            const stageDeliveries = resizeStageDeliveries(
              order.stageDeliveries ?? [],
              getStageDeliveryCount(order.stageDeliveryCount),
            );
            const advancePaymentDetail = applyAdvancePaymentRules(
              order.advancePaymentDetail ?? {},
              isYes(order.advancePayment ?? ""),
            );
            const showAdvancePaymentBlock =
              activeSubview === "payment" &&
              isYes(order.stagePayment ?? "") &&
              isYes(order.advancePayment ?? "");
            const showOrderMilestoneControls = useOrderMilestones || activeSubview === "bg";
            const orderMilestones = showOrderMilestoneControls
              ? getApplicableSupplyOrderMilestones(order, {
                  bgDisabled,
                  irDisabled: irDisabled || deliveryInspectionInactive,
                  fileType: form.fileType,
                  ir: form.ir,
                }).filter((milestone) => activeSubviewMilestones.includes(milestone))
              : [];
            const fieldsToRender = activeSubviewFields.filter((field) =>
              shouldShowSupplyOrderField(field.key as SupplyOrderKey, order),
            );
            const orderSubviewDirty = getOrderSubviewDirty(order, lockedOrder, fieldsToRender);
            const advancePaymentDirty = getAdvancePaymentDirty(order, lockedOrder);
            const baseCompletion = getSupplyOrderSubviewCompletion({
              activeSubview,
              order,
              fieldsToRender,
              form,
              gemDisabled,
              bgDisabled,
              irDisabled: effectiveIrDisabled,
            });
            const ratingValues = order.firmRatingValues ?? {};
            const ratingScore = calculateFirmRatingScore(ratingValues, firmRatingConfig);
            const ratingFilled = ratingFields.filter((field) =>
              hasFilledValue(ratingValues[field.id]),
            ).length;
            const completion =
              activeSubview === "firmRating"
                ? getFirmRatingCompletion(ratingFilled, ratingFields.length)
                : baseCompletion;
            const orderTitle = getSupplyOrderDisplayTitle(order, index);
            const orderSummary = getSupplyOrderDisplaySummary(
              order,
              form.fileType,
              form.fileTypeGroup,
            );
            const orderFocusKey = `order:${index}`;
            const directOrderFocusMatch = focusBlockKeySet.has(orderFocusKey);
            const supplementaryChildFocusMatch = focusBlockKeys.some((key) =>
              key.startsWith(`supplementary:${index}:`),
            );
            const childFocusMatch = focusBlockKeys.some(
              (key) =>
                key === `advance:${index}` ||
                key.startsWith(`stage:${index}:`) ||
                key.startsWith(`supplementary:${index}:`),
            );
            const orderOpen =
              openCardKeys.has(orderFocusKey) || directOrderFocusMatch || childFocusMatch;
            const focusClass = directOrderFocusMatch
              ? " border-primary bg-primary/5 ring-2 ring-primary/40"
              : childFocusMatch
                ? supplementaryChildFocusMatch
                  ? ""
                  : " border-primary/70"
                : "";
            const downstreamLocked =
              isDownstreamSubview(activeSubview) &&
              !downstreamOverrideUnlocked &&
              !isSupplyOrderAndDpComplete(order, form);

            return (
              <details
                key={index}
                data-testid={`add-supply-order-${index}`}
                ref={(element) => {
                  focusBlockRefs.current[orderFocusKey] = element;
                }}
                open={orderOpen}
                onToggle={(event) => setCardOpen(orderFocusKey, event.currentTarget.open)}
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
                  {activeSubview === "firmRating" ? (
                    <FirmRatingFieldsBlock
                      fields={ratingFields}
                      values={ratingValues}
                      score={ratingScore}
                      disabled={disabled || downstreamLocked}
                      lockFilledFields={lockFilledFields}
                      lockedValues={lockedOrder?.firmRatingValues}
                      onChange={(fieldId, value) =>
                        onOrderPatch(index, {
                          firmRatingValues: {
                            ...(order.firmRatingValues ?? {}),
                            [fieldId]: value,
                          },
                        })
                      }
                    />
                  ) : null}

                  {orderMilestones.length && !useStageCards ? (
                    <SupplyOrderMilestonesBlock
                      milestones={orderMilestones}
                      order={order}
                      disabled={disabled || downstreamLocked}
                      lockFilledFields={lockFilledFields}
                      lockedOrder={lockedOrder}
                      fileType={form.fileType}
                      fileTypeGroup={form.fileTypeGroup}
                      completionForm={form}
                      ir={form.ir}
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
                          <AdvancePaymentMilestonesBlock advance={advancePaymentDetail} />
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
                                    disabled={disabled || downstreamLocked}
                                    lockFilledFields={lockFilledFields}
                                    testId={`add-field-supplyOrder-${index}-advance-stageAmountCapital`}
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
                                    disabled={disabled || downstreamLocked}
                                    lockFilledFields={lockFilledFields}
                                    testId={`add-field-supplyOrder-${index}-advance-actualPaymentCapital`}
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
                              if (key === "billReturnCycles") {
                                return (
                                  <BillReturnCyclesBlock
                                    key={key}
                                    cycles={advancePaymentDetail.billReturnCycles}
                                    lockedCycles={
                                      lockedOrder?.advancePaymentDetail?.billReturnCycles
                                    }
                                    disabled={
                                      disabled ||
                                      downstreamLocked ||
                                      (lockFilledFields &&
                                        hasFilledValue(
                                          String(
                                            lockedOrder?.advancePaymentDetail?.billReturnCycles ??
                                              "",
                                          ),
                                        ))
                                    }
                                    lockFilledFields={lockFilledFields}
                                    testIdPrefix={`add-field-supplyOrder-${index}-advance-billReturnCycles`}
                                    onChange={(cycles) =>
                                      onAdvancePaymentBillReturnsChange(index, cycles)
                                    }
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
                                    downstreamLocked ||
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
                          {renderUpdateButton ? (
                            <div className="mt-4 flex justify-end border-t border-border/60 pt-3">
                              {renderUpdateButton(advancePaymentDirty)}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {stageDeliveries.map((stage, stageIndex) => {
                        const stageMilestones = getStageDeliveryMilestonesForSubview(
                          activeSubview,
                          order,
                          form.fileType,
                          form.ir,
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
                        const stageDeliveryDirty = getStageDeliveryDirty(
                          stage,
                          lockedOrder,
                          stageIndex,
                        );
                        const stageFocusMatch =
                          focusBlockKeySet.has(stageFocusKey) ||
                          focusConfigs.some((config) =>
                            isStageFocusMatch(
                              stage,
                              config,
                              form,
                              order,
                              stageIndex,
                              stageDeliveries,
                            ),
                          );
                        const paidStageFrozen = isPaidStageFrozen(
                          index,
                          stageIndex,
                          lockedOrder?.stageDeliveries?.[stageIndex],
                          paidStageUnfreezeKeys,
                        );
                        const stageControlDisabled =
                          disabled || downstreamLocked || paidStageFrozen;
                        const stageOpen = openCardKeys.has(stageFocusKey) || stageFocusMatch;
                        return (
                          <details
                            key={stageIndex}
                            data-testid={`add-supply-order-${index}-stage-${stageIndex}`}
                            ref={(element) => {
                              focusBlockRefs.current[stageFocusKey] = element;
                            }}
                            open={stageOpen}
                            onToggle={(event) =>
                              setCardOpen(stageFocusKey, event.currentTarget.open)
                            }
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
                                <span className="block truncate">
                                  {deliveryInspectionInactive
                                    ? `Delivery Period-${stageIndex + 1}`
                                    : `Delivery-${stageIndex + 1}`}
                                </span>
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
                              {paidStageFrozen ? (
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                                  <span className="font-medium">
                                    Paid stage locked to protect payment data.
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => onPaidStageUnfreeze(index, stageIndex)}
                                    disabled={disabled || downstreamLocked}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-400 bg-background px-2.5 font-medium text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    <Lock className="size-3.5" /> Unfreeze with password
                                  </button>
                                </div>
                              ) : null}
                              {stageMilestones.length ? (
                                <SupplyOrderMilestonesBlock
                                  title={
                                    deliveryInspectionInactive
                                      ? "Job Completion milestone"
                                      : "Delivery milestone"
                                  }
                                  milestones={stageMilestones}
                                  order={effectiveStageMilestoneRow}
                                  disabled={stageControlDisabled}
                                  lockFilledFields={lockFilledFields}
                                  lockedOrder={lockedOrder?.stageDeliveries?.[stageIndex]}
                                  fileType={form.fileType}
                                  fileTypeGroup={form.fileTypeGroup}
                                  ir={form.ir}
                                  stageScoped
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
                                      disabled={stageControlDisabled}
                                      lockFilledFields={lockFilledFields}
                                      testId={`add-field-supplyOrder-${index}-stage-${stageIndex}-stageAmountCapital`}
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
                                      disabled={stageControlDisabled}
                                      lockFilledFields={lockFilledFields}
                                      testId={`add-field-supplyOrder-${index}-stage-${stageIndex}-actualPaymentCapital`}
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
                                if (key === "billReturnCycles") {
                                  return (
                                    <BillReturnCyclesBlock
                                      key={key}
                                      cycles={stage.billReturnCycles}
                                      lockedCycles={
                                        lockedOrder?.stageDeliveries?.[stageIndex]?.billReturnCycles
                                      }
                                      disabled={
                                        stageControlDisabled ||
                                        (lockFilledFields &&
                                          hasFilledValue(
                                            String(
                                              lockedOrder?.stageDeliveries?.[stageIndex]
                                                ?.billReturnCycles ?? "",
                                            ),
                                          ))
                                      }
                                      lockFilledFields={lockFilledFields}
                                      testIdPrefix={`add-field-supplyOrder-${index}-stage-${stageIndex}-billReturnCycles`}
                                      onChange={(cycles) =>
                                        onStageDeliveryBillReturnsChange(index, stageIndex, cycles)
                                      }
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
                                          stageControlDisabled ||
                                          (lockFilledFields &&
                                            hasFilledValue(String(lockedValue ?? ""))) ||
                                          isDpExtensionFieldInactive(form, key, stage)
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
                                          disabled={
                                            stageControlDisabled ||
                                            (lockFilledFields && detailLocked)
                                          }
                                          onTypeChange={(value) =>
                                            onStageDeliveryChange(
                                              index,
                                              stageIndex,
                                              "ldType",
                                              value,
                                            )
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
                                      stageControlDisabled ||
                                      (lockFilledFields &&
                                        hasFilledValue(String(lockedValue ?? ""))) ||
                                      isDpExtensionFieldInactive(form, key, stage) ||
                                      (effectiveIrDisabled &&
                                        (supplyOrderIrDisabledKeys as readonly string[]).includes(
                                          key,
                                        )) ||
                                      (!effectiveIrDisabled && key === "jobCompletionDate")
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
                              {renderUpdateButton ? (
                                <div className="flex justify-end border-t border-border/60 pt-3">
                                  {renderUpdateButton(stageDeliveryDirty)}
                                </div>
                              ) : null}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {fieldsToRender.map((field) => {
                        const key = field.key as SupplyOrderKey;
                        const sequentiallyLocked = isSupplyOrderFieldSequentiallyLocked(key, order);
                        const cancellationControlLocked =
                          lockFilledFields && isCancellationSupplyOrderField(key);
                        const fieldDisabled =
                          disabled ||
                          downstreamLocked ||
                          sequentiallyLocked ||
                          cancellationControlLocked ||
                          (lockFilledFields && hasFilledValue(String(lockedOrder?.[key] ?? ""))) ||
                          (gemDisabled && key === "gemSoNo") ||
                          (bgDisabled && supplyOrderBgDisabledKeys.includes(key)) ||
                          (effectiveIrDisabled && supplyOrderIrDisabledKeys.includes(key)) ||
                          (!effectiveIrDisabled && key === "jobCompletionDate") ||
                          isDpExtensionFieldInactive(form, key, order);
                        const renderedField =
                          key === "firmType"
                            ? {
                                ...field,
                                options: mergeOptions(firmTypeOptions, order.firmType),
                              }
                            : key === "firmUniqueNo"
                              ? { ...field, label: firmUniqueNoLabel }
                              : field;

                        if (field.key === "soValueCapital") {
                          return (
                            <SoValueField
                              key={field.key}
                              capitalSelected={form.valueCapitalSelected === "Yes"}
                              revenueSelected={form.valueRevenueSelected === "Yes"}
                              capitalValue={order.soValueCapital ?? ""}
                              revenueValue={order.soValueRevenue ?? ""}
                              disabled={disabled || downstreamLocked || sequentiallyLocked}
                              lockFilledFields={lockFilledFields}
                              testId={`add-field-supplyOrder-${index}-soValueCapital`}
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

                        if (key === "firm" || key === "firmUniqueNo") {
                          const value = String(order[key] ?? "");
                          const options = key === "firm" ? firmNameOptions : firmUniqueNoOptions;
                          const optionMap =
                            key === "firm" ? firmNameOptionMap : firmUniqueNoOptionMap;
                          return (
                            <label key={field.key} className="block">
                              <div className="mb-1.5 text-xs font-medium">
                                {renderedField.label}
                              </div>
                              <SearchableDropdown
                                value={value}
                                onChange={(nextValue) => {
                                  updateOrderFirmLookup(index, key, nextValue, optionMap);
                                }}
                                options={options}
                                disabled={fieldDisabled}
                                className={inputCls + disabledCls(fieldDisabled)}
                                inputRef={(element) => {
                                  orderFieldRefs.current[`${index}:${key}`] = element;
                                }}
                              />
                            </label>
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
                              disabled={disabled || downstreamLocked || sequentiallyLocked}
                              lockFilledFields={lockFilledFields}
                              testId={`add-field-supplyOrder-${index}-actualPaymentCapital`}
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

                        if (field.key === "billAmountCapital") {
                          return (
                            <AmountByValueTypeField
                              key={field.key}
                              label="Bill amount"
                              capitalSelected={form.valueCapitalSelected === "Yes"}
                              revenueSelected={form.valueRevenueSelected === "Yes"}
                              capitalValue={order.billAmountCapital ?? ""}
                              revenueValue={order.billAmountRevenue ?? ""}
                              disabled={disabled || downstreamLocked || sequentiallyLocked}
                              lockFilledFields={lockFilledFields}
                              testId={`add-field-supplyOrder-${index}-billAmountCapital`}
                              lockedValueFilled={
                                hasFilledValue(lockedOrder?.billAmountCapital) ||
                                hasFilledValue(lockedOrder?.billAmountRevenue)
                              }
                              onChange={(patch) => {
                                if ("capital" in patch) {
                                  onOrderChange(index, "billAmountCapital", patch.capital ?? "");
                                }
                                if ("revenue" in patch) {
                                  onOrderChange(index, "billAmountRevenue", patch.revenue ?? "");
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
                                disabled={fieldDisabled}
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
                                    downstreamLocked ||
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

                        if (field.key === "billReturnCycles") {
                          return (
                            <BillReturnCyclesBlock
                              key={field.key}
                              cycles={order.billReturnCycles}
                              lockedCycles={lockedOrder?.billReturnCycles}
                              disabled={fieldDisabled}
                              lockFilledFields={lockFilledFields}
                              testIdPrefix={`add-field-supplyOrder-${index}-billReturnCycles`}
                              onChange={(cycles) => onOrderBillReturnsChange(index, cycles)}
                            />
                          );
                        }

                        return (
                          <DynamicField
                            key={field.key}
                            field={renderedField}
                            value={String(order[key] ?? "")}
                            radioName={`supplyOrder-${index}-${field.key}`}
                            disabled={fieldDisabled}
                            onChange={(value) =>
                              onOrderChange(
                                index,
                                key,
                                key === "firmContactNo" ? numericOnly(value) : value,
                              )
                            }
                            inputRef={(element) => {
                              orderFieldRefs.current[`${index}:${key}`] = element;
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                  {renderUpdateButton && (!useStageCards || activeSubview === "payment") ? (
                    <div className="mt-4 flex justify-end border-t border-border/60 pt-3">
                      {renderUpdateButton(orderSubviewDirty)}
                    </div>
                  ) : null}
                  {activeSubview === "supplementaryBills" ? (
                    <SupplementaryBillsDraftBlock
                      orderIndex={index}
                      bills={normalizeSupplementaryBillDrafts(order.supplementaryBills)}
                      disabled={disabled || downstreamLocked}
                      capitalSelected={form.valueCapitalSelected === "Yes"}
                      revenueSelected={form.valueRevenueSelected === "Yes"}
                      focusBlockRefs={focusBlockRefs}
                      focusBlockKeySet={focusBlockKeySet}
                      onAdd={() => addSupplementaryBillDraft(index)}
                      onChange={(draftId, patch) =>
                        updateSupplementaryBillDraft(index, draftId, patch)
                      }
                      onRemove={(draftId) => removeSupplementaryBillDraft(index, draftId)}
                    />
                  ) : null}
                </div>
              </details>
            );
          })
        : null}
    </div>
  );
}

function SupplementaryBillsDraftBlock({
  orderIndex,
  bills,
  disabled,
  capitalSelected,
  revenueSelected,
  focusBlockRefs,
  focusBlockKeySet,
  onAdd,
  onChange,
  onRemove,
}: {
  orderIndex: number;
  bills: SupplementaryBillDraft[];
  disabled: boolean;
  capitalSelected: boolean;
  revenueSelected: boolean;
  focusBlockRefs: MutableRefObject<Record<string, HTMLElement | null>>;
  focusBlockKeySet: Set<string>;
  onAdd: () => void;
  onChange: (draftId: string, patch: Partial<SupplementaryBillDraft>) => void;
  onRemove: (draftId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Supplementary bills</div>
          <div className="text-xs text-muted-foreground">
            For unplanned payment authority deductions or adjustments.
          </div>
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="size-3.5" />
          Add bill
        </button>
      </div>
      {bills.length ? (
        <div className="space-y-3">
          {bills.map((bill, index) => {
            const completion = getSupplementaryBillCompletion(bill, {
              valueCapitalSelected: capitalSelected ? "Yes" : "No",
              valueRevenueSelected: revenueSelected ? "Yes" : "No",
            });
            const status = getCompletionStatus(completion);
            const isCurrentReturned = isSupplementaryBillFocusMatch(bill, "current");
            const focusKey = `supplementary:${orderIndex}:${index}`;
            const isFocused = focusBlockKeySet.has(focusKey);
            return (
              <div
                key={bill.id}
                ref={(element) => {
                  focusBlockRefs.current[focusKey] = element;
                }}
                className={
                  "rounded-md border bg-background/70 p-4 " +
                  getCompletionBorderClass(status) +
                  (isFocused ? " ring-2 ring-primary/40" : "")
                }
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={"size-2.5 shrink-0 rounded-full " + getCompletionDotClass(status)}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 text-sm font-medium">
                      Supplementary bill {index + 1}
                    </div>
                    <span
                      className={
                        "rounded-full border px-2 py-0.5 text-[11px] font-medium " +
                        getCompletionBadgeClass(status)
                      }
                    >
                      {status === "complete" ? "Full" : status === "partial" ? "Partial" : "Nil"}
                    </span>
                    <label
                      className={
                        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium " +
                        (isCurrentReturned
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-secondary/30 text-muted-foreground")
                      }
                      title="Auto-derived from open supplementary bill return"
                    >
                      <input
                        type="checkbox"
                        checked={isCurrentReturned}
                        readOnly
                        tabIndex={-1}
                        className="size-3 accent-primary"
                        aria-label={`Supplementary bill ${index + 1} returned for correction current`}
                      />
                      Current
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(bill.id)}
                    disabled={disabled}
                    className="inline-flex size-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={`Remove supplementary bill ${index + 1}`}
                    title="Remove"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <DynamicField
                    field={{ key: "billNo", label: "Bill No." } as ExtraField<FieldKey>}
                    value={bill.billNo}
                    disabled={disabled}
                    radioName={`supplementaryBill-${bill.id}-billNo`}
                    onChange={(value) => onChange(bill.id, { billNo: value })}
                  />
                  <AmountByValueTypeField
                    label="Supplementary bill amount"
                    capitalSelected={capitalSelected}
                    revenueSelected={revenueSelected}
                    capitalValue={bill.billAmountCapital}
                    revenueValue={bill.billAmountRevenue}
                    disabled={disabled}
                    testId={`add-field-supplementaryBill-${bill.id}-billAmountCapital`}
                    onChange={(patch) =>
                      onChange(bill.id, {
                        billAmountCapital: patch.capital ?? "",
                        billAmountRevenue: patch.revenue ?? "",
                      })
                    }
                  />
                  <DynamicField
                    field={
                      {
                        key: "billSentForPaymentDate",
                        label: "Supplementary bill submitted",
                        type: "date",
                      } as ExtraField<SupplyOrderKey>
                    }
                    value={bill.billSentForPaymentDate}
                    disabled={disabled}
                    radioName={`supplementaryBill-${bill.id}-billSentForPaymentDate`}
                    onChange={(value) => onChange(bill.id, { billSentForPaymentDate: value })}
                  />
                  <div className="md:col-span-2">
                    <BillReturnCyclesBlock
                      cycles={bill.billReturnCycles}
                      disabled={disabled}
                      lockFilledFields={false}
                      testIdPrefix={`add-field-supplementaryBill-${bill.id}-billReturnCycles`}
                      onChange={(cycles) => onChange(bill.id, { billReturnCycles: cycles })}
                    />
                  </div>
                  <DynamicField
                    field={
                      {
                        key: "paymentDate",
                        label: "Supplementary bill paid",
                        type: "date",
                      } as ExtraField<SupplyOrderKey>
                    }
                    value={bill.paymentDate}
                    disabled={disabled}
                    radioName={`supplementaryBill-${bill.id}-paymentDate`}
                    onChange={(value) => onChange(bill.id, { paymentDate: value })}
                  />
                  <DynamicField
                    field={
                      {
                        key: "paymentMode",
                        label: "Payment mode(Online/Offline)",
                        options: paymentModeOptions,
                      } as ExtraField<SupplyOrderKey>
                    }
                    value={bill.paymentMode}
                    disabled={disabled}
                    radioName={`supplementaryBill-${bill.id}-paymentMode`}
                    onChange={(value) => onChange(bill.id, { paymentMode: value })}
                  />
                  <AmountByValueTypeField
                    label="Supplementary payment amount"
                    capitalSelected={capitalSelected}
                    revenueSelected={revenueSelected}
                    capitalValue={bill.actualPaymentCapital}
                    revenueValue={bill.actualPaymentRevenue}
                    disabled={disabled}
                    testId={`add-field-supplementaryBill-${bill.id}-actualPaymentCapital`}
                    onChange={(patch) =>
                      onChange(bill.id, {
                        actualPaymentCapital: patch.capital ?? "",
                        actualPaymentRevenue: patch.revenue ?? "",
                      })
                    }
                  />
                  <div className="md:col-span-2">
                    <DynamicField
                      field={
                        {
                          key: "remarks",
                          label: "Remarks",
                          type: "textarea",
                        } as ExtraField<FieldKey>
                      }
                      value={bill.remarks}
                      disabled={disabled}
                      radioName={`supplementaryBill-${bill.id}-remarks`}
                      onChange={(value) => onChange(bill.id, { remarks: value })}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function FirmRatingFieldsBlock({
  fields,
  values,
  lockedValues,
  score,
  disabled,
  lockFilledFields,
  onChange,
}: {
  fields: FirmRatingConfig["fields"];
  values: Record<string, string>;
  lockedValues?: Record<string, string>;
  score: number | undefined;
  disabled: boolean;
  lockFilledFields: boolean;
  onChange: (fieldId: string, value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {fields.map((field) => {
          const fieldDisabled =
            disabled || (lockFilledFields && hasFilledValue(lockedValues?.[field.id]));
          return (
            <label key={field.id} className="block">
              <div className="mb-1.5 text-xs font-medium">{field.label}</div>
              <input
                type="number"
                min="0"
                step="0.01"
                value={values[field.id] ?? ""}
                onChange={(event) => onChange(field.id, event.target.value)}
                disabled={fieldDisabled}
                className={inputCls + disabledCls(fieldDisabled)}
              />
            </label>
          );
        })}
      </div>
      <div className="rounded-md border border-border bg-background px-4 py-3 text-sm">
        <span className="font-medium">Final score: </span>
        <span className="text-muted-foreground">{formatFirmRatingScore(score) || "Not rated"}</span>
      </div>
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

function parseSupplyOrderFocusTarget(
  target: string | undefined,
): SupplyOrderFocusConfig | undefined {
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

function parseSupplyOrderFocusTargets(target: string | undefined): SupplyOrderFocusConfig[] {
  return (target ?? "")
    .split("|")
    .map((item) => parseSupplyOrderFocusTarget(item))
    .filter((item): item is SupplyOrderFocusConfig => Boolean(item));
}

function parseFocusIndex(value: string) {
  if (!value.trim()) return undefined;
  const index = Number.parseInt(value, 10);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

function getSupplyOrderFocusSubview(kind: string, state = ""): SupplyOrderSubviewKey | undefined {
  if (kind === "financialsanction" || kind === "supplyorder" || kind === "firmtype")
    return "supplyOrder";
  if (kind === "stagedelivery" || kind === "stagepayment") return "supplyOrder";
  if (kind === "advancepayment" && state === "yes") return "supplyOrder";
  if (kind === "securitybg" || kind === "bankguarantee" || isBgFocusKind(kind)) return "bg";
  if (kind === "deliveryperiod" || kind === "dpextension" || kind === "ld") return "dp";
  if (
    kind === "delivery" ||
    kind === "jobcompletion" ||
    kind === "irpreparation" ||
    kind === "irreceipt"
  )
    return "delivery";
  if (kind === "socancelled" || kind === "shortclosure") return "miscellaneous";
  if (
    kind === "billpreparation" ||
    kind === "billsentforpayment" ||
    kind === "billreturnedforcorrection" ||
    kind === "payment" ||
    kind === "advancepayment" ||
    kind === "actualpayment"
  ) {
    return "payment";
  }
  if (kind === "supplementarybill") return "supplementaryBills";
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
    const advancePaymentDetail = applyAdvancePaymentRules(
      order.advancePaymentDetail ?? {},
      isYes(order.advancePayment ?? ""),
    );

    if (config.kind === "supplementarybill") {
      normalizeSupplementaryBillDrafts(order.supplementaryBills).forEach((bill, billIndex) => {
        if (config.stageIndex !== undefined && config.stageIndex !== billIndex) return;
        if (isSupplementaryBillFocusMatch(bill, config.state)) {
          keys.push(`supplementary:${orderIndex}:${billIndex}`);
        }
      });
      continue;
    }

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

    if (config.orderIndex !== undefined && (config.stageIndex === undefined || !useStageCards)) {
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

function getSupplyOrderFocusFieldKeys(config: SupplyOrderFocusConfig) {
  if (config.orderIndex === undefined) return [];
  const fieldKey = getSupplyOrderFocusFieldKey(config.kind, config.state);
  if (!fieldKey) return [];
  if (config.kind === "advancepayment") return [`${config.orderIndex}:advance:${fieldKey}`];
  if (config.stageIndex !== undefined) {
    return [`${config.orderIndex}:stage:${config.stageIndex}:${fieldKey}`];
  }
  return [`${config.orderIndex}:${fieldKey}`];
}

function getSupplyOrderFocusFieldKey(kind: string, state: string) {
  if (kind === "deliveryperiod") return state === "extended" ? "revisedDp" : "dpDate";
  const milestone = getSupplyOrderMilestoneByName(kind);
  if (!milestone) return undefined;
  return supplyOrderMilestoneDateKeys[milestone];
}

function getSupplyOrderParentFocusBlockKey(blockKey: string) {
  const [, rawOrderIndex] = blockKey.split(":");
  if (rawOrderIndex === undefined) return undefined;
  if (blockKey.startsWith("stage:")) return `order:${rawOrderIndex}`;
  if (blockKey.startsWith("supplementary:")) return `order:${rawOrderIndex}`;
  return undefined;
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
  if (
    config.kind !== "payment" &&
    config.kind !== "advancepayment" &&
    config.kind !== "billpreparation" &&
    config.kind !== "billsentforpayment" &&
    config.kind !== "billreturnedforcorrection" &&
    config.kind !== "actualpayment"
  ) {
    return false;
  }
  if (config.kind === "advancepayment" && config.state === "yes") return false;
  return isFocusRowMatch(payment, config, form);
}

function isStageDrivenFocusKind(kind: string) {
  return [
    "deliveryperiod",
    "delivery",
    "jobcompletion",
    "irpreparation",
    "irreceipt",
    "billpreparation",
    "billsentforpayment",
    "billreturnedforcorrection",
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
    ? previousStage.revisedDp || previousStage.dpDate
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
    billReturnCycles: useStagePayment
      ? (stage.billReturnCycles ?? [])
      : useCommonPayment
        ? parentOrder.billReturnCycles
        : [],
    paymentMode: useStagePayment
      ? (stage.paymentMode ?? "")
      : useCommonPayment
        ? parentOrder.paymentMode
        : "",
    actualPaymentCapital: useStagePayment
      ? (stage.actualPaymentCapital ?? "")
      : useCommonPayment
        ? parentOrder.actualPaymentCapital
        : "",
    actualPaymentRevenue: useStagePayment
      ? (stage.actualPaymentRevenue ?? "")
      : useCommonPayment
        ? parentOrder.actualPaymentRevenue
        : "",
  };
}

function isFocusRowMatch(
  row: SupplyOrderFocusRow,
  config: SupplyOrderFocusConfig,
  form: FormState,
) {
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

  if (config.kind === "firmtype") {
    return hasFilledValue(row.firmType) || hasFilledValue(row.firmTypeOther);
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

  if (config.kind === "supplementarybill") {
    const bills = Array.isArray(row.supplementaryBills) ? row.supplementaryBills : [];
    return bills.some((bill) => {
      if (!bill || typeof bill !== "object" || Array.isArray(bill)) return false;
      return isSupplementaryBillFocusMatch(bill, state);
    });
  }

  if (config.kind === "securitybg") {
    return ["psb", "pwb", "psbpwb"].some((category) =>
      isFocusBgStateMatch(row, { ...config, kind: category }, form),
    );
  }

  if (isBgFocusKind(config.kind)) {
    return isFocusBgStateMatch(row, config, form, completed, current);
  }

  if (config.kind === "deliveryperiod") {
    const effectiveDp = row.revisedDp || row.dpDate;
    if (state === "pending") {
      return hasFilledValue(effectiveDp) && !hasFilledValue(row.materialReceiptDate);
    }
    if (state === "extended") return hasFilledValue(row.revisedDp);
    if (state === "expired" || state === "overdue") {
      return (
        hasFilledValue(effectiveDp) &&
        !hasFilledValue(row.materialReceiptDate) &&
        effectiveDp! < formatLocalDate(new Date())
      );
    }
    return (
      hasFilledValue(effectiveDp) &&
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
    if (isJobCompletionWorkflow(form.fileType, form.ir, form.fileTypeGroup)) {
      if (state === "completed" || state === "received") return isJobCompletionDone(row);
      if (state === "overdue")
        return getDerivedJobCompletionMilestoneState(
          row,
          form.fileType,
          form.ir,
          form.fileTypeGroup,
        ).current;
      return getDerivedJobCompletionMilestoneState(row, form.fileType, form.ir, form.fileTypeGroup)
        .current;
    }
    if (state === "completed" || state === "received")
      return completed || hasFilledValue(row.materialReceiptDate);
    if (state === "overdue") {
      const effectiveDp = row.revisedDp || row.dpDate;
      return (
        hasFilledValue(effectiveDp) &&
        !hasFilledValue(row.materialReceiptDate) &&
        effectiveDp! < formatLocalDate(new Date())
      );
    }
    return getDerivedDeliveryMilestoneState(row, form.fileType, form.ir, form.fileTypeGroup)
      .current;
  }

  if (config.kind === "jobcompletion") {
    if (!isJobCompletionWorkflow(form.fileType, form.ir, form.fileTypeGroup)) return false;
    if (state === "completed" || state === "received") return isJobCompletionDone(row);
    return getDerivedJobCompletionMilestoneState(row, form.fileType, form.ir, form.fileTypeGroup)
      .current;
  }

  if (config.kind === "irpreparation") {
    if (isNo(form.ir)) return false;
    if (state === "completed") return completed || hasFilledValue(row.irPreparationDate);
    return (
      current || (hasFilledValue(row.materialReceiptDate) && !hasFilledValue(row.irPreparationDate))
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
      current || isAutoCurrentSupplyOrderMilestone(row, "Bill preparation", form.fileType, form.ir)
    );
  }

  if (config.kind === "billsentforpayment") {
    if (state === "completed") return completed || hasFilledValue(row.billSentForPaymentDate);
    return (
      current ||
      (hasFilledValue(row.billPreparationDate) && !hasFilledValue(row.billSentForPaymentDate))
    );
  }

  if (config.kind === "billreturnedforcorrection") {
    const hasAnyReturn = normalizeBillReturnCycles(row.billReturnCycles).length > 0;
    const hasOpenReturn = hasOpenBillReturn(row);
    const hasResubmittedReturn = hasResubmittedBillReturn(row);
    if (state === "pending" || state === "current") {
      return !hasFilledValue(row.paymentDate) && hasOpenReturn;
    }
    if (state === "resubmitted" || state === "completed") {
      return (
        hasAnyReturn && !hasOpenReturn && (hasResubmittedReturn || hasFilledValue(row.paymentDate))
      );
    }
    if (state === "paid" || state === "actual") {
      return hasAnyReturn && hasFilledValue(row.paymentDate);
    }
    return hasAnyReturn;
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
    if (state === "liability") return hasPaymentWorkflowStarted(row, form);
    if (state === "completed" || state === "paid" || state === "actual") {
      return completed || hasFilledValue(row.paymentDate);
    }
    if (state === "overdue") {
      return (
        hasPaymentWorkflowStarted(row, form) &&
        !hasFilledValue(row.paymentDate) &&
        isBeforeCurrentMonth(getPaymentFocusStartDate(row, form))
      );
    }
    return hasPaymentWorkflowStarted(row, form) && !hasFilledValue(row.paymentDate);
  }

  if (config.kind === "actualpayment") {
    return hasNonZeroAmount(row.actualPaymentCapital) || hasNonZeroAmount(row.actualPaymentRevenue);
  }

  if (config.kind === "socancelled") {
    return isYes(row.soCancelled ?? "");
  }

  if (config.kind === "shortclosure") {
    return isYes(row.shortclosure ?? "");
  }

  return false;
}

function isFocusBgStateMatch(
  row: SupplyOrderFocusRow,
  config: SupplyOrderFocusConfig,
  form: FormState,
  completed = isFocusMilestoneCompleted(row, config.kind),
  current = normalizeMilestoneName(String(row.currentMilestone ?? "")) === config.kind,
) {
  if (!isFocusBgApplicable(row, config.kind, form)) return false;
  const state = config.state;
  const receivedDate = getFocusBgReceivedDate(row, config.kind);
  const validityDate = getFocusBgValidityDate(row, config.kind);
  const returnDate = getFocusBgReturnDate(row, config.kind);
  const received = completed || hasFilledValue(receivedDate);
  if (state === "any" || state === "total" || state === "totalfiles") return true;
  if (state === "received" || state === "completed") return received;
  if (state === "validity" || state === "expiring") return hasFilledValue(validityDate);
  if (state === "returned") return hasFilledValue(returnDate);
  if (state === "expired") {
    return (
      received &&
      !hasFilledValue(returnDate) &&
      (config.kind === "psb"
        ? !(isYes(form.ir)
            ? hasFilledValue(row.irReceiptDate)
            : hasFilledValue(row.jobCompletionDate))
        : !hasFilledValue(row.paymentDate)) &&
      hasFilledValue(validityDate) &&
      String(validityDate) < formatLocalDate(new Date())
    );
  }
  if (state === "tobereturned") {
    return (
      received &&
      !hasFilledValue(returnDate) &&
      (isYes(row.soCancelled) ||
        (config.kind === "psb"
          ? isYes(form.ir)
            ? hasFilledValue(row.irReceiptDate)
            : hasFilledValue(row.jobCompletionDate)
          : hasFilledValue(row.paymentDate) &&
            hasFilledValue(validityDate) &&
            String(validityDate) < formatLocalDate(new Date())))
    );
  }
  if (current) return true;
  if (received) return false;
  if (config.kind === "pwb") return hasFilledValue(row.materialReceiptDate);
  if (config.kind === "psb" || config.kind === "psbpwb") {
    return hasFilledValue(row.financialSanctionDate);
  }
  return hasFilledValue(row.soDate);
}

function isFocusMilestoneCompleted(row: SupplyOrderFocusRow, kind: string) {
  if (kind === "advancepayment") {
    return hasFilledValue(row.paymentDate);
  }
  if (kind === "deliveryperiod") {
    return hasFilledValue(row.revisedDp || row.dpDate);
  }
  const dateKey = supplyOrderMilestoneNames.find(
    (milestone) => normalizeMilestoneName(milestone) === kind,
  );
  const completedByDate = dateKey
    ? hasFilledValue((row as Record<string, unknown>)[supplyOrderMilestoneDateKeys[dateKey]])
    : false;
  const dateDrivenMilestones = new Set([
    "financialsanction",
    "supplyorder",
    "deliveryperiod",
    "psb",
    "pwb",
    "psbpwb",
    "irpreparation",
    "irreceipt",
    "billpreparation",
    "billsentforpayment",
    "payment",
  ]);
  if (dateDrivenMilestones.has(kind)) {
    return completedByDate;
  }
  const completedByManualMilestone = normalizeCompletedMilestones(row.completedMilestones).some(
    (milestone) => normalizeMilestoneName(milestone) === kind,
  );
  return completedByDate || completedByManualMilestone;
}

function isBgFocusKind(kind: string) {
  return kind === "psb" || kind === "pwb" || kind === "psbpwb";
}

function isFocusBgApplicable(row: SupplyOrderFocusRow, kind: string, form: Pick<FormState, "bg">) {
  if (kind === "psb") {
    return (
      isYes(row.psbApplicable ?? "") &&
      (row.bgCoverageType === "PSB" || row.bgCoverageType === "PSB and PWB separately")
    );
  }
  if (kind === "pwb") {
    return (
      isYes(form.bg) &&
      (row.bgCoverageType === "PWB" || row.bgCoverageType === "PSB and PWB separately")
    );
  }
  if (kind === "psbpwb") return isYes(form.bg) && row.bgCoverageType === "PSB+PWB";
  return false;
}

function getFocusBgReceivedDate(row: SupplyOrderFocusRow, kind: string) {
  if (kind === "psb") return row.psbBgReceivedDate;
  if (kind === "pwb") return row.pwbBgReceivedDate;
  if (kind === "psbpwb") return row.combinedBgReceivedDate;
  return undefined;
}

function getFocusBgValidityDate(row: SupplyOrderFocusRow, kind: string) {
  if (kind === "psb") return row.psbBgValidityDate;
  if (kind === "pwb") return row.pwbBgValidityDate;
  if (kind === "psbpwb") return row.combinedBgValidityDate;
  return undefined;
}

function getFocusBgReturnDate(row: SupplyOrderFocusRow, kind: string) {
  if (kind === "psb") return row.psbBgReturnDate;
  if (kind === "pwb") return row.pwbBgReturnDate;
  if (kind === "psbpwb") return row.combinedBgReturnDate;
  return undefined;
}

function hasPaymentWorkflowStarted(
  row: SupplyOrderFocusRow,
  form: Pick<FormState, "fileType" | "fileTypeGroup" | "ir">,
) {
  return (
    hasFilledValue(row.billPreparationDate) ||
    hasFilledValue(row.billSentForPaymentDate) ||
    hasBillReturnHistory(row) ||
    isPaymentDueByDeliveryOrPeriod(row, form)
  );
}

function hasBillReturnHistory(
  row: Pick<SupplyOrderDetail, "billReturnCycles"> | MilestoneRowState,
) {
  return (
    normalizeBillReturnCycles(row.billReturnCycles as BillReturnCycle[] | undefined).length > 0
  );
}

function getPaymentFocusStartDate(
  row: SupplyOrderFocusRow,
  form: Pick<FormState, "fileType" | "fileTypeGroup" | "ir">,
) {
  if (!isJobCompletionWorkflow(form.fileType, form.ir, form.fileTypeGroup)) {
    return row.materialReceiptDate;
  }
  if (!isContractFileType(form) && isNo(form.ir)) return row.jobCompletionDate;
  return getNextLocalDate(row.revisedDp || row.dpDate);
}

function isBeforeCurrentMonth(date: string | undefined) {
  return hasFilledValue(date) && date!.slice(0, 7) < formatLocalDate(new Date()).slice(0, 7);
}

function isPaymentDueByDeliveryOrPeriod(
  row: SupplyOrderFocusRow,
  form: Pick<FormState, "fileType" | "fileTypeGroup" | "ir">,
) {
  if (isContractNoInspectionWorkflow(form.fileType, form.ir, form.fileTypeGroup)) {
    const dueDate = getNextLocalDate(row.revisedDp || row.dpDate);
    return hasFilledValue(dueDate) && dueDate! <= formatLocalDate(new Date());
  }
  if (!isJobCompletionWorkflow(form.fileType, form.ir, form.fileTypeGroup)) {
    return hasFilledValue(isYes(form.ir) ? row.materialReceiptDate : row.jobCompletionDate);
  }
  return isJobCompletionDone(row);
}

type SupplyOrderCompletionStatus = "empty" | "partial" | "complete";

type CompletionCount = {
  filled: number;
  total: number;
};

function isDownstreamSubview(activeSubview: SupplyOrderSubviewKey) {
  return (
    activeSubview === "delivery" ||
    activeSubview === "payment" ||
    activeSubview === "firmRating" ||
    activeSubview === "supplementaryBills"
  );
}

function expandSupplyOrderDirtyKeys(keys: SupplyOrderKey[]) {
  const expanded = new Set<SupplyOrderKey>(keys);
  if (expanded.has("soValueCapital")) expanded.add("soValueRevenue");
  if (expanded.has("billAmountCapital")) expanded.add("billAmountRevenue");
  if (expanded.has("actualPaymentCapital")) expanded.add("actualPaymentRevenue");
  if (expanded.has("ld")) {
    expanded.add("ldType");
    expanded.add("ldPercentage");
  }
  return Array.from(expanded);
}

function getFirmRatingCompletion(filled: number, total: number) {
  const status: SupplyOrderCompletionStatus =
    total === 0 || filled === 0 ? "empty" : filled >= total ? "complete" : "partial";
  return {
    status,
    filled,
    total,
    label: status === "complete" ? "Complete" : status === "partial" ? "Partial" : "Empty",
  };
}

function isSupplyOrderAndDpComplete(order: SupplyOrderDetail, form: FormState) {
  return isSupplyOrderTabComplete(order, form) && isDpDetailsComplete(order, form);
}

function isDpDetailsComplete(order: SupplyOrderDetail, form: FormState) {
  if (isYes(order.stageDelivery ?? "")) {
    const stageCount = getStageDeliveryCount(order.stageDeliveryCount);
    if (stageCount <= 0) return false;
    const stages = resizeStageDeliveries(order.stageDeliveries ?? [], stageCount);
    return stages.every((stage) => isStageDpDetailsComplete(stage, form));
  }

  return isOrderDpDetailsComplete(order);
}

function isOrderDpDetailsComplete(order: SupplyOrderDetail) {
  if (!isCompleteDateValue(order.dpDate ?? "")) return false;
  if (isYes(order.dpExtension ?? "")) {
    if (!hasFilledValue(order.dpExtensionCount)) return false;
    if (!isCompleteDateValue(order.revisedDp ?? "")) return false;
  }
  if (isYes(order.ld ?? "")) {
    if (!hasFilledValue(order.ldType)) return false;
    if (!hasFilledValue(order.ldPercentage)) return false;
  }
  return true;
}

function isStageDpDetailsComplete(stage: StageDeliveryDetail, form: FormState) {
  if (!hasStageAmount(stage, form)) return false;
  if (!isCompleteDateValue(stage.deliveryPeriodStartDate ?? "")) return false;
  if (!isCompleteDateValue(stage.dpDate ?? "")) return false;
  if (isYes(stage.dpExtension ?? "")) {
    if (!hasFilledValue(stage.dpExtensionCount)) return false;
    if (!isCompleteDateValue(stage.revisedDp ?? "")) return false;
  }
  if (isYes(stage.ld ?? "")) {
    if (!hasFilledValue(stage.ldType)) return false;
    if (!hasFilledValue(stage.ldPercentage)) return false;
  }
  return true;
}

function hasStageAmount(stage: StageDeliveryDetail, form: FormState) {
  if (form.valueCapitalSelected === "Yes") return hasFilledValue(stage.stageAmountCapital);
  if (form.valueRevenueSelected === "Yes") return hasFilledValue(stage.stageAmountRevenue);
  return hasFilledValue(stage.stageAmountCapital) || hasFilledValue(stage.stageAmountRevenue);
}

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

  if (
    activeSubview === "delivery" &&
    isJobCompletionWorkflow(form.fileType, form.ir, form.fileTypeGroup)
  ) {
    const counts = useStageCards
      ? stageDeliveries.reduce<CompletionCount>(
          (current, stage) => addSingleCompletion(current, isJobCompletionDone(stage)),
          { filled: 0, total: 0 },
        )
      : addSingleCompletion({ filled: 0, total: 0 }, isJobCompletionDone(order));
    const status = getCompletionStatus(counts);
    return {
      ...counts,
      status,
      label: status === "complete" ? "Complete" : status === "partial" ? "Partial" : "Empty",
    };
  }

  if (activeSubview === "supplementaryBills") {
    const counts = normalizeSupplementaryBillDrafts(order.supplementaryBills).reduce(
      (current, bill) => addCompletionCounts(current, getSupplementaryBillCompletion(bill, form)),
      { filled: 0, total: 0 },
    );
    const status = getCompletionStatus(counts);
    return {
      ...counts,
      status,
      label: status === "complete" ? "Complete" : status === "partial" ? "Partial" : "Empty",
    };
  }

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
    const advance = applyAdvancePaymentRules(order.advancePaymentDetail ?? {}, true);
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
        if (!irDisabled && key === "jobCompletionDate") return fieldCounts;
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
  if (
    activeSubview === "delivery" &&
    isJobCompletionWorkflow(form.fileType, form.ir, form.fileTypeGroup)
  ) {
    let counts = addSingleCompletion({ filled: 0, total: 0 }, isJobCompletionDone(stage));
    counts = addSingleCompletion(counts, hasFilledValue(stage.jobCompletionDate));
    const status = getCompletionStatus(counts);
    return {
      ...counts,
      status,
      label: status === "complete" ? "Complete" : status === "partial" ? "Partial" : "Empty",
    };
  }

  const counts = stageFields.reduce<CompletionCount>(
    (fieldCounts, key) => {
      if (irDisabled && (supplyOrderIrDisabledKeys as readonly string[]).includes(key)) {
        return fieldCounts;
      }
      if (!irDisabled && key === "jobCompletionDate") return fieldCounts;
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
    "billNo",
    "billSentForPaymentDate",
    "billReturnCycles",
    "paymentDate",
    "paymentMode",
    "actualPaymentCapital",
  ].includes(key);
}

function getStageDeliveryMilestonesForSubview(
  activeSubview: SupplyOrderSubviewKey,
  order: SupplyOrderDetail,
  fileType?: string,
  ir?: string,
) {
  if (activeSubview === "delivery") {
    return getApplicableSupplyOrderMilestones(order, {
      bgDisabled: true,
      irDisabled: false,
      fileType,
      ir,
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
    (irDisabled && supplyOrderIrDisabledKeys.includes(key)) ||
    (!irDisabled && key === "jobCompletionDate")
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
  if (key === "billReturnCycles" && !hasBillReturnHistory(order)) return counts;
  if (key === "billAmountCapital") {
    return addAmountCompletion(counts, order.billAmountCapital, order.billAmountRevenue, form);
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
  if (key === "billReturnCycles" && !hasBillReturnHistory(row)) return counts;
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

function addCompletionCounts(left: CompletionCount, right: CompletionCount) {
  return {
    filled: left.filled + right.filled,
    total: left.total + right.total,
  };
}

function getCompletionStatus({ filled, total }: CompletionCount): SupplyOrderCompletionStatus {
  if (!total || filled === 0) return "empty";
  if (filled === total) return "complete";
  return "partial";
}

function getSupplementaryBillCompletion(
  bill: SupplementaryBillDraft | SupplementaryBillDetail,
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected">,
): CompletionCount {
  let counts: CompletionCount = { filled: 0, total: 0 };
  counts = addSingleCompletion(counts, hasFilledValue(bill.billNo));
  counts = addAmountCompletion(counts, bill.billAmountCapital, bill.billAmountRevenue, form);
  counts = addSingleCompletion(counts, hasFilledValue(bill.billSentForPaymentDate));
  counts = addSingleCompletion(counts, hasFilledValue(bill.paymentDate));
  counts = addSingleCompletion(counts, hasFilledValue(cleanPaymentModeValue(bill.paymentMode)));
  counts = addAmountCompletion(counts, bill.actualPaymentCapital, bill.actualPaymentRevenue, form);
  return normalizeBillReturnCycles(bill.billReturnCycles).reduce((current, cycle) => {
    let cycleCounts = addSingleCompletion(current, hasFilledValue(cycle.returnedDate));
    cycleCounts = addSingleCompletion(cycleCounts, hasFilledValue(cycle.reason));
    cycleCounts = addSingleCompletion(cycleCounts, hasFilledValue(cycle.resubmittedDate));
    return cycleCounts;
  }, counts);
}

function hasMeaningfulSupplyOrderValue(
  key: string,
  value: string,
  amountKind?: "stage" | "advance",
) {
  const normalized = value.trim();
  if (!normalized) return false;
  if (["dpExtension", "ld", "soCancelled", "shortclosure"].includes(key)) {
    return isYes(normalized);
  }
  if (["stageDelivery", "stagePayment", "advancePayment"].includes(key)) {
    return isYes(normalized) || isNo(normalized);
  }
  if (amountKind && key === "paymentMode") return hasSelectablePaymentMode(normalized);
  return true;
}

function getSupplyOrderDisplayTitle(order: SupplyOrderDetail, index: number) {
  return order.soNo?.trim() || order.gemSoNo?.trim() || `Supply Order ${index + 1}`;
}

function getSupplyOrderDisplaySummary(
  order: SupplyOrderDetail,
  fileType: string,
  fileTypeGroup?: string,
) {
  const stageDpLabel = getStageDpRibbonLabel(order, fileType, fileTypeGroup);
  const deliveryPeriodLabel = getDeliveryPeriodRibbonLabel(order);
  return [
    order.firm,
    order.soDate ? `S.O. date ${order.soDate}` : "",
    deliveryPeriodLabel,
    stageDpLabel,
  ]
    .filter(Boolean)
    .join(" | ");
}

function getDeliveryPeriodRibbonLabel(order: SupplyOrderDetail) {
  if (isYes(order.stageDelivery) && order.stageDeliveries?.length) {
    const firstStage = order.stageDeliveries[0];
    return formatDeliveryPeriodRibbonLabel(firstStage?.revisedDp, firstStage?.dpDate);
  }
  return formatDeliveryPeriodRibbonLabel(order.revisedDp, order.dpDate);
}

function formatDeliveryPeriodRibbonLabel(revisedDp?: string, dpDate?: string) {
  const effectiveDp = revisedDp || dpDate;
  if (!effectiveDp) return "";
  return revisedDp && dpDate && revisedDp !== dpDate
    ? `D.P. ${revisedDp} (original ${dpDate})`
    : `D.P. ${effectiveDp}`;
}

function getStageDpRibbonLabel(order: SupplyOrderDetail, fileType: string, fileTypeGroup?: string) {
  if (!isContractFileType({ fileType, fileTypeGroup }) || !isYes(order.stageDelivery)) return "";
  const stageCount = getStageDeliveryCount(order.stageDeliveryCount);
  if (stageCount <= 1 || !order.stageDeliveries?.length) return "";
  const stages = resizeStageDeliveries(order.stageDeliveries, stageCount);
  const lastStage = stages.at(-1);
  const date = formatRibbonDate(lastStage?.revisedDp || lastStage?.dpDate);
  return isDpExpiryWordHiddenFileType(fileType) ? `D.P. ${date}` : `D.P. expiry ${date}`;
}

function getCompletionBorderClass(status: SupplyOrderCompletionStatus) {
  if (status === "complete") return "border-success/70";
  if (status === "partial") return "border-warning/70";
  return "border-destructive/70";
}

function getCompletionDotClass(status: SupplyOrderCompletionStatus) {
  if (status === "complete") return "bg-success";
  if (status === "partial") return "bg-warning";
  return "bg-destructive";
}

function getCompletionBadgeClass(status: SupplyOrderCompletionStatus) {
  if (status === "complete") return "border-success/40 bg-success/10 text-success";
  if (status === "partial") return "border-warning/40 bg-warning/10 text-warning";
  return "border-destructive/40 bg-destructive/10 text-destructive";
}

type MilestoneRowState = {
  currentMilestone?: string;
  completedMilestones?: string[];
  [key: string]: unknown;
};

function getDerivedDeliveryMilestoneState(
  row: MilestoneRowState,
  fileType?: string,
  ir?: string,
  fileTypeGroup?: string,
) {
  const periodTrackingOnly = isJobCompletionWorkflow(fileType, ir, fileTypeGroup);
  const completed =
    !periodTrackingOnly &&
    (isCompleteDateValue(String(row.materialReceiptDate ?? "")) ||
      normalizeCompletedMilestones(row.completedMilestones).some(
        (milestone) => normalizeMilestoneName(milestone) === "delivery",
      ));
  const effectiveDp = String(row.revisedDp ?? "") || String(row.dpDate ?? "") || undefined;
  const current =
    !completed &&
    !isYes(String(row.soCancelled ?? "")) &&
    isCompleteDateValue(String(row.soDate ?? "")) &&
    isCompleteDateValue(effectiveDp ?? "");
  return { current, completed };
}

function isJobCompletionDone(row: MilestoneRowState) {
  return isCompleteDateValue(String(row.jobCompletionDate ?? ""));
}

function normalizeBillReturnCycles(cycles: BillReturnCycle[] | undefined) {
  return (Array.isArray(cycles) ? cycles : []).filter((cycle) =>
    [cycle.returnedDate, cycle.reason, cycle.resubmittedDate, cycle.remarks].some(hasFilledValue),
  );
}

function hasOpenBillReturn(row: Pick<SupplyOrderDetail, "billReturnCycles"> | MilestoneRowState) {
  return normalizeBillReturnCycles(row.billReturnCycles as BillReturnCycle[] | undefined).some(
    (cycle) =>
      isCompleteBillReturnDateValue(String(cycle.returnedDate ?? "")) &&
      !isCompleteBillReturnDateValue(String(cycle.resubmittedDate ?? "")),
  );
}

function hasResubmittedBillReturn(
  row: Pick<SupplyOrderDetail, "billReturnCycles"> | MilestoneRowState,
) {
  return normalizeBillReturnCycles(row.billReturnCycles as BillReturnCycle[] | undefined).some(
    (cycle) =>
      isCompleteBillReturnDateValue(String(cycle.returnedDate ?? "")) &&
      isCompleteBillReturnDateValue(String(cycle.resubmittedDate ?? "")),
  );
}

function isSupplementaryBillFocusMatch(bill: SupplementaryBillDetail, state: string) {
  const hasOpenReturn = hasOpenBillReturn(bill);
  const hasResubmittedReturn = hasResubmittedBillReturn(bill);
  if (state === "anyreturned") {
    return normalizeBillReturnCycles(bill.billReturnCycles).some((cycle) =>
      hasFilledValue(cycle.returnedDate),
    );
  }
  if (state === "paid" || state === "actual") return hasFilledValue(bill.paymentDate);
  if (state === "returned" || state === "pending" || state === "current") {
    return !hasFilledValue(bill.paymentDate) && hasOpenReturn;
  }
  if (state === "resubmitted" || state === "completed") {
    return !hasFilledValue(bill.paymentDate) && !hasOpenReturn && hasResubmittedReturn;
  }
  return (
    hasFilledValue(bill.billSentForPaymentDate) &&
    !hasOpenReturn &&
    !hasResubmittedReturn &&
    !hasFilledValue(bill.paymentDate)
  );
}

function isCompleteBillReturnDateValue(value: string) {
  return isCompleteDateValue(value) || /^\d{2}-\d{2}-\d{4}$/.test(value);
}

function getDerivedJobCompletionMilestoneState(
  row: MilestoneRowState,
  fileType?: string,
  ir?: string,
  fileTypeGroup?: string,
) {
  const completed =
    isJobCompletionWorkflow(fileType, ir, fileTypeGroup) && isJobCompletionDone(row);
  const effectiveDp = String(row.revisedDp ?? "") || String(row.dpDate ?? "") || undefined;
  const autoCurrent =
    isJobCompletionWorkflow(fileType, ir, fileTypeGroup) &&
    !completed &&
    !isYes(String(row.soCancelled ?? "")) &&
    isCompleteDateValue(String(row.soDate ?? "")) &&
    isCompleteDateValue(effectiveDp ?? "") &&
    effectiveDp! < formatLocalDate(new Date());
  const current = isJobCompletionWorkflow(fileType, ir, fileTypeGroup) && !completed && autoCurrent;
  return { current, completed, autoCurrent };
}

function isAutoCurrentSupplyOrderMilestone(
  row: MilestoneRowState,
  milestone: SupplyOrderMilestoneName,
  fileType?: string,
  ir?: string,
  fileTypeGroup?: string,
) {
  if (milestone === "Delivery Period") {
    const effectiveDp = String(row.revisedDp ?? "") || String(row.dpDate ?? "");
    return (
      !isYes(String(row.soCancelled ?? "")) &&
      !isYes(String(row.stageDelivery ?? "")) &&
      isCompleteDateValue(String(row.soDate ?? "")) &&
      !isCompleteDateValue(effectiveDp)
    );
  }
  if (milestone === "Delivery") {
    return getDerivedDeliveryMilestoneState(row, fileType, ir, fileTypeGroup).current;
  }
  if (milestone === "Job Completion") {
    return getDerivedJobCompletionMilestoneState(row, fileType, ir, fileTypeGroup).autoCurrent;
  }
  if (isYes(String(row.soCancelled ?? ""))) return false;
  if (milestone === "Payment") {
    return (
      hasPaymentWorkflowStarted(row as SupplyOrderFocusRow, { fileType, fileTypeGroup, ir }) &&
      !isCompleteDateValue(String(row.paymentDate ?? ""))
    );
  }
  if (milestone === "PSB") {
    return (
      isFinancialSanctionCompletedForOrder(row) &&
      !isCompleteDateValue(String(row.psbBgReceivedDate ?? ""))
    );
  }
  if (milestone === "PSB+PWB") {
    return (
      isFinancialSanctionCompletedForOrder(row) &&
      !isCompleteDateValue(String(row.combinedBgReceivedDate ?? ""))
    );
  }
  if (milestone === "Bill returned for correction") {
    return !isCompleteDateValue(String(row.paymentDate ?? "")) && hasOpenBillReturn(row);
  }
  if (milestone === "Bill preparation") {
    if (isCompleteDateValue(String(row.billPreparationDate ?? ""))) return false;
    if (isJobCompletionWorkflow(fileType, ir, fileTypeGroup)) {
      return isCompleteDateValue(String(row.jobCompletionDate ?? ""));
    }
    return isYes(String(ir ?? "")) && isCompleteDateValue(String(row.irReceiptDate ?? ""));
  }
  if (milestone === "Bill sent for payment") {
    return (
      isCompleteDateValue(String(row.billPreparationDate ?? "")) &&
      !hasOpenBillReturn(row) &&
      !isCompleteDateValue(String(row.billSentForPaymentDate ?? ""))
    );
  }
  if (!isCompleteDateValue(String(row.materialReceiptDate ?? ""))) return false;
  if (milestone === "PWB") return !isCompleteDateValue(String(row.pwbBgReceivedDate ?? ""));
  if (milestone === "IR Preparation") {
    return !isCompleteDateValue(String(row.irPreparationDate ?? ""));
  }
  if (milestone === "IR Receipt") {
    return (
      isCompleteDateValue(String(row.irPreparationDate ?? "")) &&
      !isCompleteDateValue(String(row.irReceiptDate ?? ""))
    );
  }
  return false;
}

function SupplyOrderMilestonesBlock({
  title = "Order milestone",
  milestones,
  order,
  lockedOrder,
  fileType,
  fileTypeGroup,
  completionForm,
  ir,
  stageScoped = false,
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
  fileTypeGroup?: string;
  completionForm?: Pick<FormState, "gem" | "valueCapitalSelected" | "valueRevenueSelected">;
  ir?: string;
  stageScoped?: boolean;
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
    if (
      milestone === "Financial Sanction" ||
      milestone === "Supply Order" ||
      milestone === "PSB" ||
      milestone === "PWB" ||
      milestone === "PSB+PWB" ||
      milestone === "IR Preparation" ||
      milestone === "IR Receipt" ||
      milestone === "Job Completion" ||
      milestone === "Bill preparation" ||
      milestone === "Bill sent for payment" ||
      milestone === "Payment"
    )
      return;
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
        const derivedDelivery = getDerivedDeliveryMilestoneState(
          order,
          fileType,
          ir,
          fileTypeGroup,
        );
        const isDeliveryMilestone = milestone === "Delivery";
        const isJobCompletionMilestone = milestone === "Job Completion";
        const isDateDrivenMilestone =
          milestone === "Financial Sanction" ||
          milestone === "Supply Order" ||
          milestone === "PSB" ||
          milestone === "PWB" ||
          milestone === "PSB+PWB" ||
          milestone === "IR Preparation" ||
          milestone === "IR Receipt" ||
          milestone === "Job Completion" ||
          milestone === "Bill preparation" ||
          milestone === "Bill sent for payment" ||
          milestone === "Bill returned for correction" ||
          milestone === "Payment";
        const dateKey = supplyOrderMilestoneDateKeys[milestone];
        const isAutoCurrentMilestone = isAutoCurrentSupplyOrderMilestone(
          order,
          milestone,
          fileType,
          ir,
          fileTypeGroup,
        );
        const isDerivedCurrentMilestone =
          milestone === "Delivery Period" ||
          milestone === "PSB" ||
          milestone === "PWB" ||
          milestone === "PSB+PWB";
        const isCurrent =
          milestone === "Bill sent for payment" && hasOpenBillReturn(order)
            ? false
            : isDeliveryMilestone
              ? derivedDelivery.current
              : isJobCompletionMilestone
                ? getDerivedJobCompletionMilestoneState(order, fileType, ir, fileTypeGroup).current
                : isDerivedCurrentMilestone
                  ? isAutoCurrentMilestone
                  : isAutoCurrentMilestone ||
                    normalizeMilestoneName(String(order.currentMilestone ?? "")) ===
                      normalizeMilestoneName(milestone);
        const isCompleted = isDeliveryMilestone
          ? derivedDelivery.completed
          : isJobCompletionMilestone
            ? getDerivedJobCompletionMilestoneState(order, fileType, ir, fileTypeGroup).completed
            : isDateDrivenMilestone
              ? milestone === "Supply Order"
                ? isSupplyOrderTabComplete(order, completionForm)
                : milestone === "Bill sent for payment"
                  ? isSupplyOrderMilestoneDateComplete(order, milestone, { stageScoped }) &&
                    !hasOpenBillReturn(order)
                  : milestone === "Bill returned for correction"
                    ? hasBillReturnHistory(order) &&
                      (isCompleteDateValue(order.paymentDate ?? "") ||
                        (hasResubmittedBillReturn(order) && !hasOpenBillReturn(order)))
                    : isSupplyOrderMilestoneDateComplete(order, milestone, { stageScoped })
              : completedSet.has(milestone);
        const lockedValueFilled =
          (lockedOrder
            ? milestone === "Supply Order"
              ? isSupplyOrderTabComplete(lockedOrder, completionForm)
              : isSupplyOrderMilestoneDateComplete(lockedOrder, milestone, { stageScoped })
            : false) || lockedCompletedSet.has(milestone);
        const currentDisabled =
          disabled ||
          lockFilledFields ||
          milestone === "Financial Sanction" ||
          isDeliveryMilestone ||
          isJobCompletionMilestone ||
          milestone === "Bill preparation" ||
          milestone === "Bill sent for payment" ||
          milestone === "Bill returned for correction" ||
          milestone === "Payment" ||
          isAutoCurrentMilestone ||
          isDerivedCurrentMilestone ||
          (milestone === "Payment" &&
            isJobCompletionWorkflow(fileType, ir) &&
            !isJobCompletionDone(order)) ||
          (milestone === "Supply Order" &&
            !isCompleteDateValue(String(order.financialSanctionDate ?? ""))) ||
          isCompleted;
        const completedDisabled =
          disabled ||
          lockFilledFields ||
          isDeliveryMilestone ||
          isJobCompletionMilestone ||
          isDateDrivenMilestone;
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
                data-testid={`add-so-milestone-${testIdSlug(title)}-${testIdSlug(milestone)}-current`}
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
                data-testid={`add-so-milestone-${testIdSlug(title)}-${testIdSlug(milestone)}-done`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AdvancePaymentMilestonesBlock({ advance }: { advance: AdvancePaymentDetail }) {
  const milestone = "Advance Payment";
  const isCurrent = normalizeMilestoneName(advance.currentMilestone) === "advancepayment";
  const isCompleted = hasFilledValue(advance.paymentDate);

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
            disabled
            readOnly
            className="size-4 accent-primary disabled:cursor-not-allowed"
            aria-label="Advance Payment is current when advance payment is applicable and payment date is blank"
          />
        </div>
        <div className="flex justify-center">
          <input
            type="checkbox"
            checked={isCompleted}
            disabled
            readOnly
            className="size-4 accent-primary disabled:cursor-not-allowed"
            aria-label="Advance Payment is completed when payment date is filled"
          />
        </div>
      </div>
    </div>
  );
}

function BillReturnCyclesBlock({
  cycles,
  lockedCycles,
  disabled,
  lockFilledFields,
  testIdPrefix,
  onChange,
}: {
  cycles: BillReturnCycle[] | undefined;
  lockedCycles?: BillReturnCycle[];
  disabled: boolean;
  lockFilledFields: boolean;
  testIdPrefix: string;
  onChange: (cycles: BillReturnCycle[]) => void;
}) {
  const rows = normalizeBillReturnCycles(cycles);
  const displayRows = rows.length
    ? rows
    : [{ returnedDate: "", reason: "", resubmittedDate: "", remarks: "" }];
  const lockedRows = normalizeBillReturnCycles(lockedCycles);
  const updateCycle = (index: number, patch: Partial<BillReturnCycle>) => {
    const next = displayRows.map((cycle, cycleIndex) =>
      cycleIndex === index ? { ...cycle, ...patch } : cycle,
    );
    onChange(normalizeBillReturnCycles(next));
  };
  const addCycle = () => {
    onChange([...rows, { returnedDate: "", reason: "", resubmittedDate: "", remarks: "" }]);
  };
  const deleteCycle = (index: number) => {
    onChange(rows.filter((_, cycleIndex) => cycleIndex !== index));
  };

  return (
    <div className="rounded-md border border-border bg-background/70 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">Bill returned for correction</div>
        <button
          type="button"
          onClick={addCycle}
          disabled={disabled}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="size-3.5" /> Add return
        </button>
      </div>
      <div className="space-y-3">
        {displayRows.map((cycle, index) => {
          const lockedCycle = lockedRows[index];
          const rowDisabled =
            disabled || (lockFilledFields && hasFilledObjectValue(lockedCycle ?? {}));
          return (
            <div key={index} className="rounded-md border border-border bg-secondary/15 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Return {index + 1}
                </div>
                <button
                  type="button"
                  onClick={() => deleteCycle(index)}
                  disabled={rowDisabled || !rows.length}
                  className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`Delete return ${index + 1}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Returned date
                  </span>
                  <DateInput
                    value={cycle.returnedDate ?? ""}
                    onChange={(value) => updateCycle(index, { returnedDate: value })}
                    disabled={rowDisabled}
                    data-testid={`${testIdPrefix}-${index}-returnedDate`}
                    className={inputCls + disabledCls(rowDisabled)}
                  />
                </label>
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Reason
                  </span>
                  <input
                    value={cycle.reason ?? ""}
                    onChange={(event) => updateCycle(index, { reason: event.target.value })}
                    disabled={rowDisabled}
                    data-testid={`${testIdPrefix}-${index}-reason`}
                    className={inputCls + disabledCls(rowDisabled)}
                  />
                </label>
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Resubmitted date
                  </span>
                  <DateInput
                    value={cycle.resubmittedDate ?? ""}
                    onChange={(value) => updateCycle(index, { resubmittedDate: value })}
                    disabled={rowDisabled}
                    data-testid={`${testIdPrefix}-${index}-resubmittedDate`}
                    className={inputCls + disabledCls(rowDisabled)}
                  />
                </label>
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Remarks
                  </span>
                  <input
                    value={cycle.remarks ?? ""}
                    onChange={(event) => updateCycle(index, { remarks: event.target.value })}
                    disabled={rowDisabled}
                    data-testid={`${testIdPrefix}-${index}-remarks`}
                    className={inputCls + disabledCls(rowDisabled)}
                  />
                </label>
              </div>
            </div>
          );
        })}
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
            form,
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
            ...getSupplyOrderTimelineItems(form, supplyOrders, enabledTimelineFields.length),
          ],
        },
      ];
  const allItems = timelineGroups.flatMap((group) => group.items);
  const filledItems = getFilledTimelineItems(allItems);
  const visibleGroups = showAllDates
    ? timelineGroups
        .map((group) => ({
          ...group,
          items: getFullTimelineItems(group.items),
        }))
        .filter((group) => group.items.length > 0)
    : [{ title: "Timeline by actual date", items: filledItems }];

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
            onClick={() => exportTimelineReport(form, filledItems, "pdf")}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            <Printer className="size-3.5" /> Export PDF
          </button>
          <button
            type="button"
            onClick={() => exportTimelineReport(form, filledItems, "excel")}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            <Save className="size-3.5" /> Export Excel
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
  milestoneDisplayLabels,
  inactiveMilestones,
  focusedMilestone,
  disabled,
  lockFilledFields,
  fileClosureDate,
  lockControl,
  onCurrentChange,
  onCompletedChange,
  onFileClosureDateChange,
}: {
  milestones: string[];
  applicableMilestones: Set<string>;
  currentMilestone: string;
  completedMilestones: string[];
  autoCompletedMilestones: string[];
  lockedCurrentMilestone: string;
  lockedCompletedMilestones: string[];
  supplyOrderMilestoneProgress: Record<string, MilestoneProgress>;
  milestoneDisplayLabels?: Record<string, string>;
  inactiveMilestones?: Set<string>;
  focusedMilestone: string;
  disabled: boolean;
  lockFilledFields: boolean;
  fileClosureDate: string;
  lockControl: ReactNode;
  onCurrentChange: (value: string) => void;
  onCompletedChange: (value: string[]) => void;
  onFileClosureDateChange: (value: string) => void;
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
  const applicableCount = applicableMilestoneList.length;
  const applicableCompletedCount = applicableMilestoneList.filter((milestone) =>
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
            const displayLabel = milestoneDisplayLabels?.[milestoneKey] ?? milestone;
            const isInactive = inactiveMilestoneKeys.has(milestoneKey);
            const orderProgress = supplyOrderMilestoneProgress[milestoneKey];
            const isOrderDriven = Boolean(orderProgress);
            const isCompleted = orderProgress
              ? Boolean(orderProgress.total && orderProgress.completed === orderProgress.total)
              : completedSet.has(milestone);
            const isAutoCompleted = autoCompletedSet.has(milestone);
            const isCurrent = orderProgress
              ? Boolean(orderProgress.current)
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
                  isCurrent ? "bg-primary/10 font-semibold text-primary" : ""
                } ${isCompleted ? "text-muted-foreground" : ""} ${
                  isInactive ? "bg-secondary/20 text-muted-foreground" : ""
                } ${
                  normalizeMilestoneName(focusedMilestone) === normalizeMilestoneName(milestone)
                    ? "ring-2 ring-primary/40"
                    : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate">{displayLabel}</div>
                  {orderProgress ? (
                    <div className="text-[11px] font-normal text-muted-foreground">
                      {orderProgress.completed}/{orderProgress.total}{" "}
                      {orderProgress.label ?? `${getMilestoneProgressUnit(displayLabel)} done`}
                    </div>
                  ) : null}
                  {isInactive ? (
                    <div className="text-[11px] font-normal text-muted-foreground">
                      Controlled in Supply order and payment
                    </div>
                  ) : null}
                  {isFileClosed ? (
                    <label className="mt-2 grid max-w-xs gap-1 text-xs font-normal text-muted-foreground">
                      <span>File Closure Date</span>
                      <DateInput
                        value={fileClosureDate}
                        disabled={disabled || !isCompleted || lockFilledFields}
                        onChange={onFileClosureDateChange}
                        className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </label>
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
                      aria-label={`Mark ${displayLabel} as current`}
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
                    aria-label={`Mark ${displayLabel} as completed`}
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

function getSupplyOrderTimelineItems(
  form: Pick<FormState, "fileType" | "ir">,
  supplyOrders: SupplyOrderDetail[],
  startOrder: number,
) {
  const showOrderNumber = supplyOrders.length > 1;
  return supplyOrders.flatMap((order, orderIndex) =>
    getSupplyOrderTimelineItemsForOrder(form, order, orderIndex, startOrder + orderIndex * 100).map(
      (item) => ({
        ...item,
        label: showOrderNumber ? `${item.label} (S.O. ${orderIndex + 1})` : item.label,
      }),
    ),
  );
}

function getSupplyOrderTimelineGroup(
  form: Pick<FormState, "fileType" | "ir">,
  order: SupplyOrderDetail,
  orderIndex: number,
  startOrder: number,
): TimelineGroup {
  const titleParts = [`Supply Order ${orderIndex + 1}`];
  if (hasFilledValue(order.soNo)) titleParts.push(String(order.soNo));
  return {
    title: titleParts.join(" - "),
    items: getSupplyOrderTimelineItemsForOrder(form, order, orderIndex, startOrder),
  };
}

function getSupplyOrderTimelineItemsForOrder(
  form: Pick<FormState, "fileType" | "ir">,
  order: SupplyOrderDetail,
  orderIndex: number,
  startOrder: number,
) {
  const dateFields = supplyOrderFields.filter((field) => field.type === "date");
  const billSentIndex = dateFields.findIndex((field) => field.key === "billSentForPaymentDate");
  const billReturnOrder =
    startOrder + (billSentIndex === -1 ? dateFields.length : billSentIndex) + 0.1;
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
    ...getBillReturnTimelineItems(
      order.billReturnCycles,
      `so:${orderIndex}:billReturn`,
      "Bill return",
      billReturnOrder,
    ),
    ...getStageTimelineItems(form, order, orderIndex, startOrder + dateFields.length),
    ...getAdvancePaymentTimelineItems(order, orderIndex, startOrder + dateFields.length + 50),
    ...getSupplementaryBillTimelineItems(order, orderIndex, startOrder + dateFields.length + 70),
  ];
}

function getStageTimelineItems(
  form: Pick<FormState, "fileType" | "ir">,
  order: SupplyOrderDetail,
  orderIndex: number,
  startOrder: number,
) {
  if (!isYes(order.stageDelivery ?? "") || !order.stageDeliveries?.length) return [];
  const stageDateFields = stageDeliveryFields.filter((field) => field.type === "date");
  const billSentIndex = stageDateFields.findIndex(
    (field) => field.key === "billSentForPaymentDate",
  );
  const stageLabel = isJobCompletionWorkflow(form.fileType, form.ir, form.fileTypeGroup)
    ? "Delivery Period"
    : "Delivery";
  return resizeStageDeliveries(
    order.stageDeliveries,
    getStageDeliveryCount(order.stageDeliveryCount),
  ).flatMap((stage, stageIndex) => {
    const stageStartOrder = startOrder + stageIndex * (stageDateFields.length + 2);
    const stageItems = stageDateFields.map((field, fieldIndex) => {
      const key = field.key as StageDeliveryKey;
      return {
        id: `so:${orderIndex}:stage:${stageIndex}:${key}`,
        label: `${stageLabel}-${stageIndex + 1}: ${field.label}`,
        date: String(stage[key] ?? ""),
        order: stageStartOrder + fieldIndex,
      };
    });
    return [
      ...stageItems,
      ...getBillReturnTimelineItems(
        stage.billReturnCycles,
        `so:${orderIndex}:stage:${stageIndex}:billReturn`,
        `${stageLabel}-${stageIndex + 1}: Bill return`,
        stageStartOrder + (billSentIndex === -1 ? stageDateFields.length : billSentIndex) + 0.1,
      ),
    ];
  });
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
  const advance = applyAdvancePaymentRules(order.advancePaymentDetail ?? {}, true);
  const advanceDateFields = advancePaymentFields.filter((field) => field.type === "date");
  const billSentIndex = advanceDateFields.findIndex(
    (field) => field.key === "billSentForPaymentDate",
  );
  const advanceItems = advanceDateFields.map((field, fieldIndex) => {
    const key = field.key as AdvancePaymentKey;
    return {
      id: `so:${orderIndex}:advance:${key}`,
      label: `Advance Payment: ${field.label}`,
      date: String(advance[key] ?? ""),
      order: startOrder + fieldIndex,
    };
  });
  return [
    ...advanceItems,
    ...getBillReturnTimelineItems(
      advance.billReturnCycles,
      `so:${orderIndex}:advance:billReturn`,
      "Advance Payment: Bill return",
      startOrder + (billSentIndex === -1 ? advanceDateFields.length : billSentIndex) + 0.1,
    ),
  ];
}

function getBillReturnTimelineItems(
  cycles: BillReturnCycle[] | undefined,
  idPrefix: string,
  labelPrefix: string,
  startOrder: number,
) {
  return normalizeBillReturnCycles(cycles).flatMap((cycle, cycleIndex) => {
    const cycleLabel = `${labelPrefix} ${cycleIndex + 1}`;
    return [
      {
        id: `${idPrefix}:${cycleIndex}:returned`,
        label: `${cycleLabel}: Returned`,
        date: String(cycle.returnedDate ?? ""),
        order: startOrder + cycleIndex * 0.2,
      },
      {
        id: `${idPrefix}:${cycleIndex}:resubmitted`,
        label: `${cycleLabel}: Resubmitted`,
        date: String(cycle.resubmittedDate ?? ""),
        order: startOrder + cycleIndex * 0.2 + 0.1,
      },
    ];
  });
}

function getSupplementaryBillTimelineItems(
  order: SupplyOrderDetail,
  orderIndex: number,
  startOrder: number,
) {
  return cleanSupplementaryBills(order.supplementaryBills).flatMap((bill, billIndex) => {
    const billLabel = `Supplementary Bill ${billIndex + 1}`;
    const billStartOrder = startOrder + billIndex * 10;
    return [
      {
        id: `so:${orderIndex}:supplementary:${billIndex}:submitted`,
        label: `${billLabel}: Submitted`,
        date: String(bill.billSentForPaymentDate ?? ""),
        order: billStartOrder,
      },
      ...getBillReturnTimelineItems(
        bill.billReturnCycles,
        `so:${orderIndex}:supplementary:${billIndex}:billReturn`,
        `${billLabel}: Bill return`,
        billStartOrder + 0.1,
      ),
      {
        id: `so:${orderIndex}:supplementary:${billIndex}:paid`,
        label: `${billLabel}: Paid`,
        date: String(bill.paymentDate ?? ""),
        order: billStartOrder + 1,
      },
    ];
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

function exportTimelineReport(
  form: FormState,
  filledItems: TimelineItem[],
  format: "excel" | "pdf",
) {
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
    format,
    title: "File Timeline",
    fileName: `${getExportFileName(form.imms || form.uniqueCode || "timeline")}.${
      format === "excel" ? "xls" : "pdf"
    }`,
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

function exportFirmDetails(details: FirmDetailsState, format: "excel" | "pdf") {
  const firmUniqueNoLabel = store.getSettings().firmUniqueNoLabel || "Firm Unique No.";
  const firmRows = (rows: FirmDetail[]) =>
    rows.length
      ? rows.map((row, index) => [
          index + 1,
          row.firmName || "Not set",
          row.firmUniqueNo || "Not set",
          row.emailId || "Not set",
          row.address || "Not set",
          row.city || "Not set",
          row.contactNo || "Not set",
        ])
      : [["No firm rows found."]];

  void downloadBackendExport({
    format,
    title: "Firm Details",
    fileName: `${getExportFileName("firm-details")}.${format === "excel" ? "xls" : "pdf"}`,
    tables: [
      {
        title: "BQ firms",
        headers: [
          "S.No.",
          "Firm name",
          firmUniqueNoLabel,
          "Email",
          "Address",
          "City",
          "Contact No.",
        ],
        rows: firmRows(details.bqFirms),
      },
      {
        title: "Invited firms",
        headers: [
          "S.No.",
          "Firm name",
          firmUniqueNoLabel,
          "Email",
          "Address",
          "City",
          "Contact No.",
        ],
        rows: firmRows(details.invitedFirms),
      },
      {
        title: "Bidder firms",
        headers: [
          "S.No.",
          "Firm name",
          firmUniqueNoLabel,
          "Email",
          "Address",
          "City",
          "Contact No.",
        ],
        rows: firmRows(details.bidderFirms),
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
      address: row.address?.trim() || undefined,
      emailId: row.emailId?.trim() || undefined,
      firmUniqueNo: row.firmUniqueNo?.trim() || undefined,
      contactNo: row.contactNo?.trim() || undefined,
    }))
    .filter(
      (row) =>
        row.firmName || row.city || row.address || row.emailId || row.firmUniqueNo || row.contactNo,
    );
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
  const seen = new Set<string>();
  const cleaned = markers
    .map((marker) => ({
      id: marker.id || createMarkerId(),
      text: marker.text.trim().toUpperCase(),
      createdAt: getRemarkDateInputValue(marker.createdAt) || formatLocalDate(new Date()),
    }))
    .filter((marker) => {
      if (!marker.text || seen.has(marker.text)) return false;
      seen.add(marker.text);
      return true;
    });
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
    .filter((item) => item && normalizeMilestoneName(item) !== "bankguarantee");
  const configured = values.length ? values : defaultMilestones;
  return appendFileClosedMilestone(
    insertSupplyOrderBgMilestones(
      insertBillSentMilestone(insertFinancialSanctionMilestone(configured)),
    ),
  );
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
    const customKey = `fileType:${encodeURIComponent(fileType.trim())}`;
    if (allowed.has(customKey)) return true;
    if (normalized === "amc") return allowed.has("amc");
    if (normalized === "mpc") return allowed.has("mpc");
    if (normalized === "cars") return allowed.has("cars");
    if (normalized === "o&m") return allowed.has("om");
    return normalized === "goods & services" && allowed.has("goodsServices");
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

function insertSupplyOrderBgMilestones(milestones: string[]) {
  const bgMilestones = ["PSB", "PWB", "PSB+PWB"];
  const withoutBg = milestones.filter(
    (milestone) =>
      !bgMilestones.some((bg) => normalizeMilestoneName(bg) === normalizeMilestoneName(milestone)),
  );
  const supplyOrderIndex = withoutBg.findIndex(
    (milestone) => normalizeMilestoneName(milestone) === "supplyorder",
  );
  const insertAt = supplyOrderIndex === -1 ? withoutBg.length : supplyOrderIndex + 1;
  return [...withoutBg.slice(0, insertAt), ...bgMilestones, ...withoutBg.slice(insertAt)];
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
  if (key === "bidding" || key === "prebidmeeting" || key === "refloatprebidmeeting") {
    return isBiddingApplicableForFile(form);
  }
  if (key === "pretcec" || key === "posttcec" || key === "cnc") return isYes(form.tcec);
  if (key === "ad") return isYes(form.ad) && !isDivisionAdNo(form.division, divisions);
  if (key === "rqa") return isYes(form.rqa);
  if (key === "ifa") return isYes(form.ifa);
  if (key === "psb")
    return supplyOrders.some(
      (order) =>
        isYes(order.psbApplicable ?? "") &&
        (order.bgCoverageType === "PSB" || order.bgCoverageType === "PSB and PWB separately"),
    );
  if (key === "pwb")
    return (
      isYes(form.bg) &&
      supplyOrders.some(
        (order) =>
          order.bgCoverageType === "PWB" || order.bgCoverageType === "PSB and PWB separately",
      )
    );
  if (key === "psbpwb")
    return isYes(form.bg) && supplyOrders.some((order) => order.bgCoverageType === "PSB+PWB");
  if (key === "irpreparation" || key === "irreceipt") {
    return isYes(form.ir) && !isJobCompletionWorkflow(form.fileType, form.ir, form.fileTypeGroup);
  }

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

function shouldUseSupplyOrderMilestones(
  orders: SupplyOrderDetail[],
  currentMilestone = "",
  completedMilestones: string[] = [],
) {
  return (
    orders.length > 1 ||
    isMainMilestoneAtOrAfterSupplyOrderStart(currentMilestone) ||
    completedMilestones.some(isMainMilestoneAtOrAfterSupplyOrderStart) ||
    orders.some(
      (order) =>
        hasMeaningfulSupplyOrderData(order) ||
        isYes(order.stageDelivery ?? "") ||
        isYes(order.stagePayment ?? ""),
    )
  );
}

function isMainMilestoneAtOrAfterSupplyOrderStart(milestone: string | undefined) {
  const key = normalizeMilestoneName(milestone);
  return (
    key === "financialsanction" ||
    supplyOrderMilestoneNames.some((item) => normalizeMilestoneName(item) === key)
  );
}

function hasMeaningfulSupplyOrderData(order: SupplyOrderDetail) {
  return Object.entries(order).some(([key, value]) =>
    hasMeaningfulSupplyOrderDataValue(key, value),
  );
}

function hasMeaningfulSupplyOrderDataValue(key: string, value: unknown): boolean {
  if (key === "currentMilestone" || key === "completedMilestones") return false;
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
  if (key === "bgCoverageType" && text.toLowerCase() === "none") return false;
  return !(
    text.toLowerCase() === "no" &&
    [
      "advancePayment",
      "demandCancelled",
      "dpExtension",
      "ld",
      "psbApplicable",
      "soCancelled",
      "stageDelivery",
      "stagePayment",
    ].includes(key)
  );
}

function clearSupplyOrderMilestones(orders: SupplyOrderDetail[]) {
  return orders.map((order) => ({
    ...order,
    currentMilestone: undefined,
    completedMilestones: [],
  }));
}

function bridgeMainCurrentMilestoneToSupplyOrder(
  orders: SupplyOrderDetail[],
  currentMilestone: string,
) {
  const orderMilestone = getSupplyOrderMilestoneByName(currentMilestone);
  if (!orderMilestone || !orders.length) return orders;
  if (orders.some((order) => hasFilledValue(order.currentMilestone))) return orders;
  return orders.map((order, index) =>
    index === 0 ? { ...order, currentMilestone: orderMilestone } : order,
  );
}

function getApplicableSupplyOrderMilestones(
  order: SupplyOrderDetail,
  options: { bgDisabled: boolean; irDisabled: boolean; fileType?: string; ir?: string },
) {
  return supplyOrderMilestoneNames.filter((milestone) => {
    if (milestone === "Delivery") return !isJobCompletionWorkflow(options.fileType, options.ir);
    if (milestone === "Job Completion")
      return isJobCompletionWorkflow(options.fileType, options.ir);
    if (milestone === "PSB")
      return (
        isYes(order.psbApplicable ?? "") &&
        (order.bgCoverageType === "PSB" || order.bgCoverageType === "PSB and PWB separately")
      );
    if (milestone === "PWB")
      return (
        !options.bgDisabled &&
        (order.bgCoverageType === "PWB" || order.bgCoverageType === "PSB and PWB separately")
      );
    if (milestone === "PSB+PWB") return !options.bgDisabled && order.bgCoverageType === "PSB+PWB";
    if (milestone === "IR Preparation" || milestone === "IR Receipt") {
      return !options.irDisabled && !isJobCompletionWorkflow(options.fileType, options.ir);
    }
    return true;
  });
}

function getSupplyOrderMilestoneProgress(
  milestones: string[],
  orders: SupplyOrderDetail[],
  form: Pick<
    FormState,
    "bg" | "ir" | "fileType" | "mode" | "biddingStageOver" | "tcec" | "cfaDate" | "cncApprovalDate"
  >,
  forceUse = shouldUseSupplyOrderMilestones(orders),
  mainCurrentMilestone = "",
): Record<string, MilestoneProgress> {
  if (!forceUse) return {};
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
        isSupplyOrderMilestoneComplete(order, orderMilestone, form),
      ).length;
      const partiallyCompleted = completed > 0 && completed < applicableOrders.length;
      const current =
        applicableOrders.some((order) => {
          if (orderMilestone === "Financial Sanction") {
            return (
              isFinancialSanctionReachedForForm(form) &&
              !isYes(order.soCancelled ?? "") &&
              !isCompleteDateValue(order.financialSanctionDate ?? "")
            );
          }
          return (
            (normalizeMilestoneName(orderMilestone) !== "billpreparation" &&
              normalizeMilestoneName(order.currentMilestone ?? "") ===
                normalizeMilestoneName(orderMilestone)) ||
            isAutoCurrentSupplyOrderMilestone(order, orderMilestone, form.fileType, form.ir)
          );
        }) ||
        (orderMilestone !== "Financial Sanction" &&
          normalizeMilestoneName(mainCurrentMilestone) ===
            normalizeMilestoneName(orderMilestone)) ||
        partiallyCompleted;
      return [
        [normalizeMilestoneName(milestone), { completed, total: applicableOrders.length, current }],
      ];
    }),
  );
}

function getDeliveryMilestoneProgress(
  orders: SupplyOrderDetail[],
  form: Pick<FormState, "bg" | "ir" | "fileType">,
): MilestoneProgress | undefined {
  const rows = expandedFileSupplyOrders({ supplyOrders: orders } as FileRecord).filter(
    (order) => isCompleteDateValue(order.soDate ?? "") && !isYes(order.soCancelled),
  );
  if (!rows.length) return undefined;
  if (isJobCompletionWorkflow(form.fileType, form.ir, form.fileTypeGroup)) {
    const completed = rows.filter(isJobCompletionDone).length;
    const current =
      rows.some(
        (order) => getDerivedJobCompletionMilestoneState(order, form.fileType, form.ir).current,
      ) ||
      (completed > 0 && completed < rows.length);
    return {
      completed,
      total: rows.length,
      current,
      label: "job completions done",
    };
  }
  const completed = rows.filter(
    (order) => getDerivedDeliveryMilestoneState(order, form.fileType, form.ir).completed,
  ).length;
  const current =
    rows.some((order) => getDerivedDeliveryMilestoneState(order, form.fileType, form.ir).current) ||
    (completed > 0 && completed < rows.length);
  return {
    completed,
    total: rows.length,
    current,
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
          fileType: form.fileType,
          ir: form.ir,
        }).includes(milestone),
    );
  }
  return getApplicableOrdersForMilestone(orders, milestone, form);
}

function isStageDrivenMilestone(milestone: SupplyOrderMilestoneName) {
  return (
    milestone === "Delivery" ||
    milestone === "Job Completion" ||
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
  form: Pick<FormState, "bg" | "ir" | "fileType">,
) {
  if (!shouldUseSupplyOrderMilestones(orders)) return [];
  const errors: string[] = [];
  orders.forEach((order, index) => {
    if (!hasFilledValue(order.soDate) && !hasMeaningfulSupplyOrderData(order)) return;
    const label = `Supply Order ${index + 1}`;
    const applicable = getApplicableSupplyOrderMilestones(order, {
      bgDisabled: isNo(form.bg),
      irDisabled: isNo(form.ir),
      fileType: form.fileType,
      ir: form.ir,
    });
    const completed = new Set(
      normalizeCompletedMilestones(order.completedMilestones).map(normalizeMilestoneName),
    );

    for (const milestone of applicable) {
      const isCompleted = completed.has(normalizeMilestoneName(milestone));
      const hasDate = isSupplyOrderMilestoneDateComplete(order, milestone);
      if (isCompleted && !hasDate && milestone !== "Financial Sanction") {
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

function getSupplyOrderTabCompletionErrors(
  orders: SupplyOrderDetail[],
  form: Pick<FormState, "gem" | "valueCapitalSelected" | "valueRevenueSelected">,
) {
  const errors: string[] = [];
  orders.forEach((order, index) => {
    const missingFields = getMissingSupplyOrderTabFields(order, form);
    if (!missingFields.length) return;
    const missingLabels = missingFields
      .map((key) => getSupplyOrderTabFieldLabel(key, form))
      .join(", ");
    errors.push(
      `Supply Order ${index + 1}: Supply order tab is partially filled. Complete these fields or clear the Supply order tab fields: ${missingLabels}.`,
    );
  });
  return errors;
}

function getSupplyOrderDateChronologyErrors(orders: SupplyOrderDetail[]) {
  const errors: string[] = [];
  orders.forEach((order, index) => {
    const orderLabel = `Supply Order ${index + 1}`;
    if (isDateBefore(order.soDate, order.financialSanctionDate)) {
      errors.push(`${orderLabel}: S.O. date cannot be earlier than Financial Sanction date.`);
    }
    if (isDateBefore(order.dpDate, order.soDate)) {
      errors.push(`${orderLabel}: D.P. date cannot be earlier than S.O. date.`);
    }
    const stages = resizeStageDeliveries(
      order.stageDeliveries ?? [],
      getStageDeliveryCount(order.stageDeliveryCount),
    );
    stages.forEach((stage, stageIndex) => {
      if (!isDateBefore(stage.dpDate, order.soDate)) return;
      errors.push(
        `${orderLabel} Delivery-${stageIndex + 1}: D.P. date cannot be earlier than S.O. date.`,
      );
    });
  });
  return errors;
}

function isSupplyOrderMilestoneDateComplete(
  order: SupplyOrderDetail,
  milestone: SupplyOrderMilestoneName,
  options: { stageScoped?: boolean } = {},
) {
  if (milestone === "Delivery Period") {
    return isCompleteDateValue(String((order.revisedDp ?? "") || (order.dpDate ?? "")));
  }
  const dateKey = supplyOrderMilestoneDateKeys[milestone];
  if (!dateKey) return false;
  if (options.stageScoped) return isCompleteDateValue(String(order[dateKey] ?? ""));
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
  return isCompleteDateValue(String(order[dateKey] ?? ""));
}

function getSupplyOrderMilestoneByName(milestone: string): SupplyOrderMilestoneName | undefined {
  return supplyOrderMilestoneNames.find(
    (item) => normalizeMilestoneName(item) === normalizeMilestoneName(milestone),
  );
}

function getApplicableOrdersForMilestone(
  orders: SupplyOrderDetail[],
  milestone: SupplyOrderMilestoneName,
  form: Pick<FormState, "bg" | "ir" | "fileType">,
) {
  if ((milestone === "PWB" || milestone === "PSB+PWB") && isNo(form.bg)) return [];
  if ((milestone === "IR Preparation" || milestone === "IR Receipt") && isNo(form.ir)) return [];
  return orders.filter((order) => {
    if (milestone === "Financial Sanction") return true;
    if (milestone === "Supply Order") return true;
    if (milestone === "PSB" || milestone === "PWB" || milestone === "PSB+PWB") {
      return getApplicableSupplyOrderMilestones(order, {
        bgDisabled: isNo(form.bg),
        irDisabled: isNo(form.ir),
        fileType: form.fileType,
        ir: form.ir,
      }).includes(milestone);
    }
    if (!isCompleteDateValue(order.soDate ?? "")) return false;
    return getApplicableSupplyOrderMilestones(order, {
      bgDisabled: isNo(form.bg),
      irDisabled: isNo(form.ir),
      fileType: form.fileType,
      ir: form.ir,
    }).includes(milestone);
  });
}

function isSupplyOrderMilestoneComplete(
  order: SupplyOrderDetail,
  milestone: SupplyOrderMilestoneName,
  form?: Pick<FormState, "gem" | "valueCapitalSelected" | "valueRevenueSelected">,
) {
  if (milestone === "Financial Sanction") return isFinancialSanctionCompletedForOrder(order);
  if (milestone === "Supply Order") return isSupplyOrderTabComplete(order, form);
  if (milestone === "PSB") return isCompleteDateValue(order.psbBgReceivedDate ?? "");
  if (milestone === "PWB") return isCompleteDateValue(order.pwbBgReceivedDate ?? "");
  if (milestone === "PSB+PWB") return isCompleteDateValue(order.combinedBgReceivedDate ?? "");
  if (milestone === "IR Preparation") return isCompleteDateValue(order.irPreparationDate ?? "");
  if (milestone === "IR Receipt") return isCompleteDateValue(order.irReceiptDate ?? "");
  if (milestone === "Job Completion") return isJobCompletionDone(order);
  if (milestone === "Bill preparation") {
    return isCompleteDateValue(order.billPreparationDate ?? "");
  }
  if (milestone === "Bill sent for payment") {
    return isCompleteDateValue(order.billSentForPaymentDate ?? "") && !hasOpenBillReturn(order);
  }
  if (milestone === "Bill returned for correction") {
    return (
      hasBillReturnHistory(order) &&
      (isCompleteDateValue(order.paymentDate ?? "") ||
        (hasResubmittedBillReturn(order) && !hasOpenBillReturn(order)))
    );
  }
  if (milestone === "Payment") return isCompleteDateValue(order.paymentDate ?? "");
  return normalizeCompletedMilestones(order.completedMilestones).some(
    (item) => normalizeMilestoneName(item) === normalizeMilestoneName(milestone),
  );
}

const requiredSupplyOrderTabFields = [
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
] as const satisfies SupplyOrderKey[];

function isSupplyOrderTabComplete(
  order: MilestoneRowState | SupplyOrderDetail,
  form?: Pick<FormState, "gem" | "valueCapitalSelected" | "valueRevenueSelected">,
) {
  return (
    hasSupplyOrderTabData(order as SupplyOrderDetail) &&
    getMissingSupplyOrderTabFields(order as SupplyOrderDetail, form).length === 0
  );
}

function hasSupplyOrderTabData(order: SupplyOrderDetail) {
  return requiredSupplyOrderTabFields.some((key) => {
    if (key === "stageDelivery" || key === "stagePayment" || key === "advancePayment") {
      return isYes(String(order[key] ?? ""));
    }
    if (key === "soValueCapital") {
      return hasFilledValue(order.soValueCapital) || hasFilledValue(order.soValueRevenue);
    }
    return hasFilledValue(String(order[key] ?? ""));
  });
}

function getMissingSupplyOrderTabFields(
  order: SupplyOrderDetail,
  form?: Pick<FormState, "gem" | "valueCapitalSelected" | "valueRevenueSelected">,
) {
  if (!hasSupplyOrderTabData(order)) return [];
  return getRequiredSupplyOrderTabFields(order, form).filter(
    (key) => !isSupplyOrderTabFieldComplete(order, key, form),
  );
}

function getRequiredSupplyOrderTabFields(
  order: SupplyOrderDetail,
  form?: Pick<FormState, "gem" | "valueCapitalSelected" | "valueRevenueSelected">,
) {
  return requiredSupplyOrderTabFields.filter((key) => {
    if (key === "gemSoNo") return !isNo(form?.gem);
    if (key === "firmTypeOther") return (order.firmType ?? "").trim().toUpperCase() === "OTHER";
    if (key === "stageDeliveryCount" || key === "stagePayment") {
      return isYes(order.stageDelivery ?? "");
    }
    if (key === "advancePayment") {
      return isYes(order.stageDelivery ?? "") && isYes(order.stagePayment ?? "");
    }
    return true;
  });
}

function isSupplyOrderTabFieldComplete(
  order: SupplyOrderDetail,
  key: SupplyOrderKey,
  form?: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected">,
) {
  if (key === "soValueCapital") {
    const capitalSelected = form?.valueCapitalSelected === "Yes";
    const revenueSelected = form?.valueRevenueSelected === "Yes";
    if (capitalSelected) return hasFilledValue(order.soValueCapital);
    if (revenueSelected) return hasFilledValue(order.soValueRevenue);
    return hasFilledValue(order.soValueCapital) || hasFilledValue(order.soValueRevenue);
  }
  return hasMeaningfulSupplyOrderValue(key, String(order[key] ?? ""));
}

function getSupplyOrderTabFieldLabel(
  key: SupplyOrderKey,
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected">,
) {
  if (key === "soValueCapital") {
    if (form.valueCapitalSelected === "Yes") return "S.O. value (Capital)";
    if (form.valueRevenueSelected === "Yes") return "S.O. value (Revenue)";
    return "S.O. value";
  }
  return supplyOrderFields.find((field) => field.key === key)?.label ?? key;
}

function dateLabelForSupplyOrderMilestone(milestone: SupplyOrderMilestoneName) {
  const dateKey = supplyOrderMilestoneDateKeys[milestone];
  if (!dateKey) return "date";
  const field = supplyOrderFields.find((item) => item.key === dateKey);
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
    psbApplicable: row.psbApplicable || undefined,
    bgCoverageType: row.bgCoverageType || undefined,
    psbBgNo: row.psbBgNo?.trim() || undefined,
    psbBgAmount: row.psbBgAmount || undefined,
    psbBgReceivedDate: row.psbBgReceivedDate || undefined,
    psbBgValidityDate: row.psbBgValidityDate || undefined,
    psbBgReturnDate: row.psbBgReturnDate || undefined,
    pwbBgNo: row.pwbBgNo?.trim() || undefined,
    pwbBgAmount: row.pwbBgAmount || undefined,
    pwbBgReceivedDate: row.pwbBgReceivedDate || undefined,
    pwbBgValidityDate: row.pwbBgValidityDate || undefined,
    pwbBgReturnDate: row.pwbBgReturnDate || undefined,
    combinedBgNo: row.combinedBgNo?.trim() || undefined,
    combinedBgAmount: row.combinedBgAmount || undefined,
    combinedBgReceivedDate: row.combinedBgReceivedDate || undefined,
    combinedBgValidityDate: row.combinedBgValidityDate || undefined,
    combinedBgReturnDate: row.combinedBgReturnDate || undefined,
    warrantyPeriodDate: row.warrantyPeriodDate || undefined,
    soNo: row.soNo?.trim() || undefined,
    gemSoNo: row.gemSoNo?.trim() || undefined,
    soDate: row.soDate || undefined,
    soValueCapital: row.soValueCapital || undefined,
    soValueRevenue: row.soValueRevenue || undefined,
    dpDate: row.dpDate || undefined,
    firm: row.firm?.trim() || undefined,
    firmType: row.firmType || undefined,
    firmTypeOther: row.firmTypeOther?.trim() || undefined,
    dpExtension: row.dpExtension || undefined,
    dpExtensionCount: row.dpExtensionCount || undefined,
    ld: row.ld || undefined,
    ldType: row.ldType || undefined,
    ldPercentage: row.ldPercentage || undefined,
    revisedDp: row.revisedDp || undefined,
    materialReceiptDate: row.materialReceiptDate || undefined,
    jobCompletionDate: row.jobCompletionDate || undefined,
    irPreparationDate: row.irPreparationDate || undefined,
    irReceiptDate: row.irReceiptDate || undefined,
    billPreparationDate: row.billPreparationDate || undefined,
    billNo: row.billNo?.trim() || undefined,
    billSentForPaymentDate: row.billSentForPaymentDate || undefined,
    billReturnCycles: normalizeBillReturnCycles(row.billReturnCycles),
    billAmountCapital: row.billAmountCapital || undefined,
    billAmountRevenue: row.billAmountRevenue || undefined,
    paymentDate: row.paymentDate || undefined,
    paymentMode: cleanPaymentModeValue(row.paymentMode) || undefined,
    actualPaymentCapital: row.actualPaymentCapital || undefined,
    actualPaymentRevenue: row.actualPaymentRevenue || undefined,
    shortclosure: row.shortclosure || undefined,
    shortclosureDate:
      isYes(row.shortclosure ?? "") && hasFilledValue(row.shortclosureDate)
        ? row.shortclosureDate
        : undefined,
    soCancelled: row.soCancelled || undefined,
    soCancelledDate:
      isYes(row.soCancelled ?? "") && hasFilledValue(row.soCancelledDate)
        ? row.soCancelledDate
        : undefined,
    stageDelivery: row.stageDelivery || undefined,
    stageDeliveryCount: row.stageDeliveryCount || undefined,
    stagePayment: row.stagePayment || undefined,
    advancePayment: row.advancePayment || undefined,
    advancePaymentDetail: cleanAdvancePaymentDetail(
      row.advancePaymentDetail,
      isYes(row.advancePayment ?? ""),
    ),
    stageDeliveries: cleanStageDeliveryRows(row.stageDeliveries ?? [], form, row),
    supplementaryBills: cleanSupplementaryBills(row.supplementaryBills),
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
    warnings.push(...getSupplementaryBillChronologyWarnings(order, orderLabel, form));

    if (isYes(order.soCancelled ?? "") && !hasFilledValue(order.soCancelledDate)) {
      warnings.push(`${orderLabel}: S.O. cancelled is Yes, but S.O. cancelled date is blank.`);
    }
    if (isYes(order.shortclosure ?? "") && !hasFilledValue(order.shortclosureDate)) {
      warnings.push(`${orderLabel}: Shortclosure is Yes, but Shortclosure date is blank.`);
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

function getPaymentBlockedByBgErrors(rows: SupplyOrderDetail[], form: Pick<FormState, "bg">) {
  const errors: string[] = [];
  rows.forEach((order, orderIndex) => {
    if (isYes(order.soCancelled) || areRequiredBankGuaranteesReceived(order, form)) return;
    const orderLabel = `Supply Order ${orderIndex + 1}`;
    if (hasOrderLevelPaymentProgress(order)) {
      errors.push(
        `${orderLabel}: Payment cannot be marked/current/paid until required PSB/PWB is received.`,
      );
    }
    if (hasAdvancePaymentProgress(order.advancePaymentDetail)) {
      errors.push(
        `${orderLabel}: Advance payment cannot be paid until required PSB/PWB is received.`,
      );
    }
    const stages = resizeStageDeliveries(
      order.stageDeliveries ?? [],
      getStageDeliveryCount(order.stageDeliveryCount),
    );
    stages.forEach((stage, stageIndex) => {
      if (hasStagePaymentProgress(stage)) {
        errors.push(
          `${orderLabel} Delivery-${stageIndex + 1}: Payment cannot be marked/current/paid until required PSB/PWB is received.`,
        );
      }
    });
  });
  return errors;
}

function areRequiredBankGuaranteesReceived(
  order: MilestoneRowState | SupplyOrderDetail,
  form: Pick<FormState, "bg">,
) {
  const psbRequired =
    isYes(order.psbApplicable) &&
    (order.bgCoverageType === "PSB" || order.bgCoverageType === "PSB and PWB separately");
  const pwbRequired =
    isYes(form.bg) &&
    (order.bgCoverageType === "PWB" || order.bgCoverageType === "PSB and PWB separately");
  const combinedRequired = isYes(form.bg) && order.bgCoverageType === "PSB+PWB";
  return (
    (!psbRequired || isCompleteDateValue(order.psbBgReceivedDate ?? "")) &&
    (!pwbRequired || isCompleteDateValue(order.pwbBgReceivedDate ?? "")) &&
    (!combinedRequired || isCompleteDateValue(order.combinedBgReceivedDate ?? ""))
  );
}

function isFinancialSanctionCompletedForOrder(order: MilestoneRowState | SupplyOrderDetail) {
  return isCompleteDateValue(order.financialSanctionDate ?? "");
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
    normalizeBillReturnCycles(order.billReturnCycles).length > 0 ||
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
    normalizeMilestoneName(advance?.currentMilestone) === "advancepayment"
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
  normalizeBillReturnCycles(order.billReturnCycles).forEach((cycle, index) => {
    const label = `${orderLabel} Bill return ${index + 1}`;
    if (isDateBefore(cycle.returnedDate, order.billSentForPaymentDate)) {
      warnings.push(`${label}: Return date is earlier than bill sent for payment date.`);
    }
    if (isDateBefore(cycle.resubmittedDate, cycle.returnedDate)) {
      warnings.push(`${label}: Resubmitted date is earlier than return date.`);
    }
    if (
      hasFilledValue(order.paymentDate) &&
      hasFilledValue(cycle.returnedDate) &&
      !hasFilledValue(cycle.resubmittedDate)
    ) {
      warnings.push(`${label}: Resubmission date is missing before payment.`);
    }
  });
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

function getSupplementaryBillChronologyWarnings(
  order: SupplyOrderDetail,
  orderLabel: string,
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected">,
) {
  const warnings: string[] = [];
  cleanSupplementaryBills(order.supplementaryBills).forEach((bill, billIndex) => {
    const label = `${orderLabel} Supplementary bill ${billIndex + 1}`;
    if (isDateBefore(bill.billSentForPaymentDate, order.soDate)) {
      warnings.push(`${label}: Submitted date is earlier than S.O. date.`);
    }
    if (isDateBefore(bill.paymentDate, bill.billSentForPaymentDate)) {
      warnings.push(`${label}: Payment date is earlier than submitted date.`);
    }
    normalizeBillReturnCycles(bill.billReturnCycles).forEach((cycle, cycleIndex) => {
      const returnLabel = `${label} return ${cycleIndex + 1}`;
      if (isDateBefore(cycle.returnedDate, bill.billSentForPaymentDate)) {
        warnings.push(`${returnLabel}: Returned date is earlier than submitted date.`);
      }
      if (isDateBefore(cycle.resubmittedDate, cycle.returnedDate)) {
        warnings.push(`${returnLabel}: Resubmitted date is earlier than returned date.`);
      }
      if (isDateBefore(bill.paymentDate, cycle.returnedDate)) {
        warnings.push(`${label}: Payment date is earlier than returned date.`);
      }
      if (isDateBefore(bill.paymentDate, cycle.resubmittedDate)) {
        warnings.push(`${label}: Payment date is earlier than resubmitted date.`);
      }
      if (
        hasFilledValue(bill.paymentDate) &&
        hasFilledValue(cycle.returnedDate) &&
        !hasFilledValue(cycle.resubmittedDate)
      ) {
        warnings.push(`${returnLabel}: Resubmission date is missing before payment.`);
      }
    });
    if (
      hasFilledValue(bill.paymentDate) &&
      !hasSelectedAmount(bill.actualPaymentCapital, bill.actualPaymentRevenue, form)
    ) {
      warnings.push(`${label}: Payment date is filled, but actual payment amount is missing.`);
    }
    if (hasFilledValue(bill.paymentDate) && !hasSelectablePaymentMode(bill.paymentMode)) {
      warnings.push(`${label}: Payment date is filled, but payment mode is missing.`);
    }
  });
  return warnings;
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
  const effectiveDpDate = stage.revisedDp || stage.dpDate;
  const dueDate = getNextLocalDate(effectiveDpDate);
  return hasFilledValue(dueDate) && dueDate! <= formatLocalDate(new Date());
}

function getStageDeliveryPeriodRibbonLabel(
  order: SupplyOrderDetail,
  stages: StageDeliveryDetail[],
  stageIndex: number,
) {
  const startDate = getStageDeliveryPeriodStartDate(order, stages, stageIndex);
  const stage = stages[stageIndex];
  const endDate = stage?.revisedDp || stage?.dpDate;
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
  const previousEndDate = previousStage?.revisedDp || previousStage?.dpDate;
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

function cleanAdvancePaymentDetail(
  row: AdvancePaymentDetail | undefined,
  advancePaymentActive = false,
) {
  if (!row) return {};
  const normalized = applyAdvancePaymentRules(row, advancePaymentActive);
  const completedMilestones = normalizeCompletedMilestones(normalized.completedMilestones);
  const cleaned = {
    currentMilestone: normalized.currentMilestone || undefined,
    completedMilestones: completedMilestones.length ? completedMilestones : undefined,
    stageAmountCapital: normalized.stageAmountCapital || undefined,
    stageAmountRevenue: normalized.stageAmountRevenue || undefined,
    billPreparationDate: normalized.billPreparationDate || undefined,
    billNo: normalized.billNo?.trim() || undefined,
    billSentForPaymentDate: normalized.billSentForPaymentDate || undefined,
    billReturnCycles: normalizeBillReturnCycles(normalized.billReturnCycles),
    paymentDate: normalized.paymentDate || undefined,
    paymentMode: cleanPaymentModeValue(normalized.paymentMode) || undefined,
    actualPaymentCapital: normalized.actualPaymentCapital || undefined,
    actualPaymentRevenue: normalized.actualPaymentRevenue || undefined,
  };
  return Object.values(cleaned).some(Boolean) ? cleaned : {};
}

function cleanStageDeliveryRows(
  rows: StageDeliveryDetail[],
  form?: Pick<FormState, "fileType" | "ir" | "valueCapitalSelected" | "valueRevenueSelected">,
  parentOrder?: SupplyOrderDetail,
) {
  const normalizedRows = rows.map((row) => applyStageDeliveryRules(row, form));
  const cleaned = normalizedRows.map((normalized, index) => {
    const effectiveRow = parentOrder
      ? getEffectiveStageFocusRow(normalized, parentOrder, index, normalizedRows)
      : normalized;
    const deliveryState = getDerivedDeliveryMilestoneState(effectiveRow, form?.fileType, form?.ir);
    const completedMilestones = normalizeCompletedMilestones(normalized.completedMilestones)
      .filter(
        (milestone) => !["delivery", "jobcompletion"].includes(normalizeMilestoneName(milestone)),
      )
      .concat(deliveryState.completed ? ["Delivery"] : [])
      .concat(isJobCompletionDone(normalized) ? ["Job Completion"] : []);
    const normalizedCurrent = normalizeMilestoneName(normalized.currentMilestone ?? "");
    const currentMilestone =
      !isJobCompletionWorkflow(form?.fileType, form?.ir, form?.fileTypeGroup) &&
      deliveryState.current
        ? "Delivery"
        : ["delivery", "payment"].includes(normalizedCurrent)
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
      jobCompletionDate: normalized.jobCompletionDate || undefined,
      irPreparationDate: normalized.irPreparationDate || undefined,
      irReceiptDate: normalized.irReceiptDate || undefined,
      billPreparationDate: normalized.billPreparationDate || undefined,
      billNo: normalized.billNo?.trim() || undefined,
      billSentForPaymentDate: normalized.billSentForPaymentDate || undefined,
      billReturnCycles: normalizeBillReturnCycles(normalized.billReturnCycles),
      paymentDate: normalized.paymentDate || undefined,
      paymentMode: cleanPaymentModeValue(normalized.paymentMode) || undefined,
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
      .filter(hasMeaningfulSupplyOrderData) ?? [];
  return rows;
}

function firstSupplyOrderMirrorPatch(rows: SupplyOrderDetail[]) {
  if (!rows.length) return emptyFirstSupplyOrderMirrorPatch();

  const first = rows.find(hasMeaningfulSupplyOrderData);
  if (!first) return emptyFirstSupplyOrderMirrorPatch();
  return {
    financialSanctionDate: first.financialSanctionDate || null,
    soNo: first.soNo || null,
    gemSoNo: first.gemSoNo || null,
    soDate: first.soDate || null,
    soValueCapital: first.soValueCapital || null,
    soValueRevenue: first.soValueRevenue || null,
    billAmountCapital: first.billAmountCapital || null,
    billAmountRevenue: first.billAmountRevenue || null,
    dpDate: first.dpDate || null,
    firm: first.firm || null,
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
    shortclosure: first.shortclosure || null,
    shortclosureDate: first.shortclosureDate || null,
    soCancelled: first.soCancelled || null,
    soCancelledDate: first.soCancelledDate || null,
    stageDelivery: first.stageDelivery || null,
    stageDeliveryCount: first.stageDeliveryCount || null,
    stagePayment: first.stagePayment || null,
    advancePayment: first.advancePayment || null,
    advancePaymentDetail: cleanAdvancePaymentDetail(
      first.advancePaymentDetail,
      isYes(first.advancePayment ?? ""),
    ),
    stageDeliveries: cleanStageDeliveryRows(first.stageDeliveries ?? [], undefined, first),
  };
}

function emptyFirstSupplyOrderMirrorPatch() {
  return {
    financialSanctionDate: null,
    soNo: null,
    gemSoNo: null,
    soDate: null,
    soValueCapital: null,
    soValueRevenue: null,
    billAmountCapital: null,
    billAmountRevenue: null,
    dpDate: null,
    firm: null,
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
    shortclosure: null,
    shortclosureDate: null,
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

function resizeSupplyOrders(
  rows: SupplyOrderDetail[],
  count: number,
  form?: Pick<
    FormState,
    "bg" | "valueCapitalSelected" | "valueRevenueSelected" | "ir" | "fileType"
  >,
) {
  return Array.from({ length: count }, (_, index) => {
    const existingRow = rows[index];
    const baseOrder =
      !existingRow && isYes(form?.bg ?? "")
        ? { ...emptySupplyOrder, bgCoverageType: "PWB" }
        : { ...emptySupplyOrder, ...(existingRow ?? {}) };
    return applySupplyOrderRules(baseOrder, form);
  });
}

function resizeStageDeliveries(rows: StageDeliveryDetail[], count: number) {
  return Array.from({ length: count }, (_, index) =>
    applyStageDeliveryRules({ ...emptyStageDelivery, ...(rows[index] ?? {}) }),
  );
}

function stageFreezeKey(orderIndex: number, stageIndex: number) {
  return `${orderIndex}:${stageIndex}`;
}

function hasPaidStagePayment(stage: StageDeliveryDetail | undefined) {
  if (!stage) return false;
  return (
    hasFilledValue(stage.paymentDate) ||
    hasNonZeroAmount(stage.actualPaymentCapital) ||
    hasNonZeroAmount(stage.actualPaymentRevenue)
  );
}

function isPaidStageFrozen(
  orderIndex: number,
  stageIndex: number,
  stage: StageDeliveryDetail | undefined,
  unfreezeKeys: Set<string>,
) {
  return hasPaidStagePayment(stage) && !unfreezeKeys.has(stageFreezeKey(orderIndex, stageIndex));
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
  return Boolean(
    cleanFirmRows(file?.bqFirms ?? []) ||
    cleanFirmRows(file?.invitedFirms ?? []) ||
    cleanFirmRows(file?.bidderFirms ?? []),
  );
}

function applyConditionalRules(form: FormState) {
  let next = normalizeBlankYesNoFields(form);
  if (!isBiddingApplicableForFile(next)) {
    next = {
      ...next,
      gemUndertakingDate:
        isYes(next.gem) && next.gemBiddingMode === "Comparison" ? next.gemUndertakingDate : "",
      rfpVetting: "No",
      rfpVettingInitiationDate: "",
      rfpVettingApprovalDate: "",
      preBidMeeting: "No",
      preBidMeetingDate: "",
      bidNumber: "",
      bidDate: "",
      bidOpeningDate: "",
      tenderLive: "No",
      bidOpened: "NO",
      refloat: "No",
      refloatPreBidMeeting: "No",
      refloatPreBidMeetingDate: "",
      refloatBiddingDate: "",
      refloatBidOpeningDate: "",
      refloatPostTcecDate: "",
      refloatPostTcecMinutesDate: "",
      refloatPostTcecCommitteeNo: "",
      rst: "No",
      biddingStageOver: "No",
    };
  }
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
      billAmountRevenue: "",
    };
  }
  if (next.valueRevenueSelected === "Yes") {
    next = {
      ...next,
      valueCapital: "",
      valueCapitalSelected: "",
      soValueCapital: "",
      billAmountCapital: "",
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
      postTcecDate: "",
      postTcecMinutesDate: "",
      postTcecCommitteeNumber: "",
      refloatPostTcecDate: "",
      refloatPostTcecMinutesDate: "",
      refloatPostTcecCommitteeNo: "",
      cncDate: "",
      cncApprovalDate: "",
    };
  }
  if (isNo(next.gem)) {
    next = {
      ...next,
      gemBiddingMode: "",
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
  if (isNo(next.rqa)) {
    next = {
      ...next,
      rqaSentDate: "",
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
      pwbBgNo: "",
      pwbBgAmount: "",
      pwbBgReceivedDate: "",
      pwbBgValidityDate: "",
      pwbBgReturnDate: "",
      combinedBgNo: "",
      combinedBgAmount: "",
      combinedBgReceivedDate: "",
      combinedBgValidityDate: "",
      combinedBgReturnDate: "",
      warrantyPeriodDate: "",
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
  if (isNo(next.preBidMeeting)) {
    next = {
      ...next,
      preBidMeetingDate: "",
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
      refloatPreBidMeeting: "No",
      refloatPreBidMeetingDate: "",
      refloatBiddingDate: "",
      refloatBidOpeningDate: "",
      refloatPostTcecDate: "",
      refloatPostTcecMinutesDate: "",
      refloatPostTcecCommitteeNo: "",
    };
  }
  if (isNo(next.refloatPreBidMeeting)) {
    next = {
      ...next,
      refloatPreBidMeetingDate: "",
    };
  }
  if (isYes(next.dpExtension)) {
    next = {
      ...next,
      dpExtensionCount: getInitialExtensionCount(next.dpExtensionCount),
    };
  }
  if (!isYes(next.dpExtension)) {
    next = {
      ...next,
      dpExtensionCount: "",
      revisedDp: "",
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

const defaultNoFieldValues = {
  gte: "No",
  tcec: "NO",
  gem: "No",
  highValue: "No",
  ad: "No",
  rqa: "No",
  ifa: "No",
  bg: "No",
  ir: "No",
  rfpVetting: "No",
  preBidMeeting: "No",
  tenderLive: "No",
  bidOpened: "NO",
  refloat: "No",
  refloatPreBidMeeting: "No",
  rst: "No",
  biddingStageOver: "No",
  demandCancelled: "No",
  soCancelled: "No",
  shortclosure: "No",
} as const satisfies Partial<Record<FieldKey, string>>;

function normalizeBlankYesNoFields(form: FormState) {
  let changed = false;
  const next = { ...form };
  for (const [key, defaultValue] of Object.entries(defaultNoFieldValues) as Array<
    [keyof typeof defaultNoFieldValues, string]
  >) {
    if (hasFilledValue(next[key])) continue;
    next[key] = defaultValue;
    changed = true;
  }
  return changed ? next : form;
}

function normalizeDefaultYesNoValue(key: FieldKey, value: string) {
  if (hasFilledValue(value)) return value;
  return defaultNoFieldValues[key as keyof typeof defaultNoFieldValues] ?? empty[key];
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
      billAmountRevenue: "",
      actualPaymentRevenue: "",
      advancePaymentDetail: applyAdvancePaymentValueTypeRules(
        next.advancePaymentDetail ?? {},
        form,
        isYes(next.advancePayment ?? ""),
      ),
    };
  }
  if (form?.valueRevenueSelected === "Yes") {
    next = {
      ...next,
      soValueCapital: "",
      billAmountCapital: "",
      actualPaymentCapital: "",
      advancePaymentDetail: applyAdvancePaymentValueTypeRules(
        next.advancePaymentDetail ?? {},
        form,
        isYes(next.advancePayment ?? ""),
      ),
    };
  }
  if (isYes(next.dpExtension ?? "")) {
    next = { ...next, dpExtensionCount: getInitialExtensionCount(next.dpExtensionCount ?? "") };
  }
  if (!isYes(next.dpExtension ?? "")) {
    next = { ...next, dpExtensionCount: "", revisedDp: "" };
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
          billNo: "",
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
  if (!hasFilledValue(next.psbApplicable)) {
    next = { ...next, psbApplicable: "No" };
  }
  if (!hasFilledValue(next.bgCoverageType)) {
    next = { ...next, bgCoverageType: "None" };
  }
  if (isNo(next.psbApplicable ?? "")) {
    next = {
      ...next,
      psbBgNo: "",
      psbBgAmount: "",
      psbBgReceivedDate: "",
      psbBgValidityDate: "",
      psbBgReturnDate: "",
      bgCoverageType:
        next.bgCoverageType === "PSB" || next.bgCoverageType === "PSB and PWB separately"
          ? "None"
          : next.bgCoverageType === "PSB+PWB"
            ? "PWB"
            : next.bgCoverageType,
    };
  }
  if (form && isNo(form.bg)) {
    next = {
      ...next,
      pwbBgNo: "",
      pwbBgAmount: "",
      pwbBgReceivedDate: "",
      pwbBgValidityDate: "",
      pwbBgReturnDate: "",
      combinedBgNo: "",
      combinedBgAmount: "",
      combinedBgReceivedDate: "",
      combinedBgValidityDate: "",
      combinedBgReturnDate: "",
      warrantyPeriodDate: "",
      bgCoverageType:
        next.bgCoverageType === "PWB" ||
        next.bgCoverageType === "PSB+PWB" ||
        next.bgCoverageType === "PSB and PWB separately"
          ? isYes(next.psbApplicable ?? "")
            ? "PSB"
            : "None"
          : next.bgCoverageType,
    };
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
        true,
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
  form:
    | Partial<
        Pick<
          FormState,
          | "bg"
          | "ir"
          | "fileType"
          | "fileTypeGroup"
          | "mode"
          | "biddingStageOver"
          | "tcec"
          | "cfaDate"
          | "cncApprovalDate"
          | "gem"
          | "valueCapitalSelected"
          | "valueRevenueSelected"
        >
      >
    | undefined,
) {
  const deliveryState = getDerivedDeliveryMilestoneState(order, form?.fileType, form?.ir);
  const jobCompletionState = getDerivedJobCompletionMilestoneState(order, form?.fileType, form?.ir);
  const applicable = getApplicableSupplyOrderMilestones(order, {
    bgDisabled: form ? isNo(form.bg) : false,
    irDisabled: form ? isNo(form.ir) : false,
    fileType: form?.fileType,
    ir: form?.ir,
  });
  const applicableByKey = new Map<string, string>(
    applicable.map((milestone) => [normalizeMilestoneName(milestone), milestone]),
  );
  const completedMilestones = normalizeCompletedMilestones(order.completedMilestones)
    .map((milestone) => applicableByKey.get(normalizeMilestoneName(milestone)))
    .filter((milestone): milestone is string => Boolean(milestone));
  const financialSanctionMilestone = applicableByKey.get("financialsanction");
  const supplyOrderMilestone = applicableByKey.get("supplyorder");
  const deliveryPeriodMilestone = applicableByKey.get("deliveryperiod");
  const psbMilestone = applicableByKey.get("psb");
  const pwbMilestone = applicableByKey.get("pwb");
  const combinedBgMilestone = applicableByKey.get("psbpwb");
  const irPreparationMilestone = applicableByKey.get("irpreparation");
  const irReceiptMilestone = applicableByKey.get("irreceipt");
  const jobCompletionMilestone = applicableByKey.get("jobcompletion");
  const billPreparationMilestone = applicableByKey.get("billpreparation");
  const billSentForPaymentMilestone = applicableByKey.get("billsentforpayment");
  const billReturnedForCorrectionMilestone = applicableByKey.get("billreturnedforcorrection");
  const paymentMilestone = applicableByKey.get("payment");
  const contractNoInspectionPaymentDue = isContractNoInspectionPaymentDue(order, form);
  const completedWithDateDrivenMilestones = [
    ...completedMilestones.filter((milestone) => {
      const normalized = normalizeMilestoneName(milestone);
      return (
        normalized !== "financialsanction" &&
        normalized !== "supplyorder" &&
        normalized !== "deliveryperiod" &&
        normalized !== "psb" &&
        normalized !== "pwb" &&
        normalized !== "psbpwb" &&
        normalized !== "irpreparation" &&
        normalized !== "irreceipt" &&
        normalized !== "jobcompletion" &&
        normalized !== "billpreparation" &&
        normalized !== "billsentforpayment" &&
        normalized !== "billreturnedforcorrection" &&
        normalized !== "payment"
      );
    }),
    ...(isCompleteDateValue(order.financialSanctionDate ?? "") && financialSanctionMilestone
      ? [financialSanctionMilestone]
      : []),
    ...(isSupplyOrderTabComplete(order, form) && supplyOrderMilestone
      ? [supplyOrderMilestone]
      : []),
    ...(isCompleteDateValue((order.revisedDp ?? "") || (order.dpDate ?? "")) &&
    deliveryPeriodMilestone
      ? [deliveryPeriodMilestone]
      : []),
    ...(isCompleteDateValue(order.psbBgReceivedDate ?? "") && psbMilestone ? [psbMilestone] : []),
    ...(isCompleteDateValue(order.pwbBgReceivedDate ?? "") && pwbMilestone ? [pwbMilestone] : []),
    ...(isCompleteDateValue(order.combinedBgReceivedDate ?? "") && combinedBgMilestone
      ? [combinedBgMilestone]
      : []),
    ...(isCompleteDateValue(order.irPreparationDate ?? "") && irPreparationMilestone
      ? [irPreparationMilestone]
      : []),
    ...(isCompleteDateValue(order.irReceiptDate ?? "") && irReceiptMilestone
      ? [irReceiptMilestone]
      : []),
    ...(isCompleteDateValue(order.jobCompletionDate ?? "") && jobCompletionMilestone
      ? [jobCompletionMilestone]
      : []),
    ...(isCompleteDateValue(order.billPreparationDate ?? "") && billPreparationMilestone
      ? [billPreparationMilestone]
      : []),
    ...(isCompleteDateValue(order.billSentForPaymentDate ?? "") &&
    !hasOpenBillReturn(order) &&
    billSentForPaymentMilestone
      ? [billSentForPaymentMilestone]
      : []),
    ...(hasBillReturnHistory(order) &&
    (isCompleteDateValue(order.paymentDate ?? "") ||
      (hasResubmittedBillReturn(order) && !hasOpenBillReturn(order))) &&
    billReturnedForCorrectionMilestone
      ? [billReturnedForCorrectionMilestone]
      : []),
    ...(isCompleteDateValue(order.paymentDate ?? "") && paymentMilestone ? [paymentMilestone] : []),
  ];
  const completedWithDerivedDelivery = deliveryState.completed
    ? [
        ...completedWithDateDrivenMilestones.filter((milestone) => milestone !== "Delivery"),
        "Delivery",
      ]
    : completedWithDateDrivenMilestones;
  const rawManualCurrentMilestone =
    applicableByKey.get(normalizeMilestoneName(order.currentMilestone ?? "")) ?? "";
  const manualCurrentMilestone = [
    "financialsanction",
    "psb",
    "pwb",
    "psbpwb",
    "jobcompletion",
    "billpreparation",
    "billsentforpayment",
    "billreturnedforcorrection",
    "payment",
  ].includes(normalizeMilestoneName(rawManualCurrentMilestone))
    ? ""
    : rawManualCurrentMilestone;
  const financialSanctionReached = Boolean(form) && isFinancialSanctionReachedForForm(form);
  const financialSanctionBecomesCurrent =
    financialSanctionReached &&
    !isCompleteDateValue(order.financialSanctionDate ?? "") &&
    Boolean(financialSanctionMilestone);
  const financialSanctionMovesToSupplyOrder =
    isCompleteDateValue(order.financialSanctionDate ?? "") &&
    !isCompleteDateValue(order.soDate ?? "") &&
    Boolean(supplyOrderMilestone);
  const supplyOrderMovesToDeliveryPeriod =
    isSupplyOrderTabComplete(order, form) &&
    !isYes(order.stageDelivery ?? "") &&
    !isCompleteDateValue((order.revisedDp ?? "") || (order.dpDate ?? "")) &&
    Boolean(deliveryPeriodMilestone) &&
    (!manualCurrentMilestone || normalizeMilestoneName(manualCurrentMilestone) === "supplyorder");
  const deliveryMovesToIrPreparation =
    isCompleteDateValue(order.materialReceiptDate ?? "") &&
    !isCompleteDateValue(order.irPreparationDate ?? "") &&
    Boolean(irPreparationMilestone) &&
    (!manualCurrentMilestone || normalizeMilestoneName(manualCurrentMilestone) === "delivery");
  const irPreparationMovesToIrReceipt =
    isCompleteDateValue(order.irPreparationDate ?? "") &&
    !isCompleteDateValue(order.irReceiptDate ?? "") &&
    Boolean(irReceiptMilestone) &&
    (!manualCurrentMilestone || normalizeMilestoneName(manualCurrentMilestone) === "irpreparation");
  const billPreparationBecomesCurrent =
    isAutoCurrentSupplyOrderMilestone(
      order as MilestoneRowState,
      "Bill preparation",
      form?.fileType,
      form?.ir,
      form?.fileTypeGroup,
    ) &&
    Boolean(billPreparationMilestone) &&
    (!manualCurrentMilestone ||
      normalizeMilestoneName(manualCurrentMilestone) === "irreceipt" ||
      normalizeMilestoneName(manualCurrentMilestone) === "jobcompletion");
  const billPreparationMovesToBillSent =
    isCompleteDateValue(order.billPreparationDate ?? "") &&
    !isCompleteDateValue(order.billSentForPaymentDate ?? "") &&
    Boolean(billSentForPaymentMilestone) &&
    (!manualCurrentMilestone ||
      normalizeMilestoneName(manualCurrentMilestone) === "billpreparation");
  const jobCompletionMovesToPayment =
    isJobCompletionWorkflow(form?.fileType, form?.ir, form?.fileTypeGroup) &&
    isJobCompletionDone(order) &&
    !isCompleteDateValue(order.paymentDate ?? "") &&
    Boolean(paymentMilestone) &&
    (!manualCurrentMilestone || normalizeMilestoneName(manualCurrentMilestone) === "jobcompletion");
  const deliveryPeriodMovesToPayment =
    contractNoInspectionPaymentDue &&
    !isCompleteDateValue(order.paymentDate ?? "") &&
    Boolean(paymentMilestone) &&
    (!manualCurrentMilestone ||
      normalizeMilestoneName(manualCurrentMilestone) === "deliveryperiod" ||
      normalizeMilestoneName(manualCurrentMilestone) === "jobcompletion" ||
      normalizeMilestoneName(manualCurrentMilestone) === "billpreparation");
  const billSentForPaymentMovesToPayment =
    isCompleteDateValue(order.billSentForPaymentDate ?? "") &&
    !isCompleteDateValue(order.paymentDate ?? "") &&
    Boolean(paymentMilestone) &&
    (!manualCurrentMilestone ||
      normalizeMilestoneName(manualCurrentMilestone) === "billsentforpayment");
  const paymentRollsBackToBillSent =
    !isCompleteDateValue(order.billSentForPaymentDate ?? "") &&
    isCompleteDateValue(order.billPreparationDate ?? "") &&
    Boolean(billSentForPaymentMilestone) &&
    (normalizeMilestoneName(manualCurrentMilestone) === "payment" ||
      isCompleteDateValue(order.paymentDate ?? ""));
  const billReturnedForCorrectionBecomesCurrent =
    hasOpenBillReturn(order) &&
    !isCompleteDateValue(order.paymentDate ?? "") &&
    Boolean(billReturnedForCorrectionMilestone);
  const paymentRollsBackToJobCompletion =
    isJobCompletionWorkflow(form?.fileType, form?.ir, form?.fileTypeGroup) &&
    !isContractNoInspectionWorkflow(form?.fileType, form?.ir, form?.fileTypeGroup) &&
    normalizeMilestoneName(manualCurrentMilestone) === "payment" &&
    !isJobCompletionDone(order);
  const supplyOrderRollsBackToFinancialSanction =
    !isCompleteDateValue(order.financialSanctionDate ?? "") &&
    Boolean(financialSanctionMilestone) &&
    normalizeMilestoneName(manualCurrentMilestone) === "supplyorder";
  const currentMilestone =
    !isJobCompletionWorkflow(form?.fileType, form?.ir, form?.fileTypeGroup) && deliveryState.current
      ? "Delivery"
      : financialSanctionBecomesCurrent
        ? financialSanctionMilestone!
        : financialSanctionMovesToSupplyOrder
          ? supplyOrderMilestone!
          : supplyOrderMovesToDeliveryPeriod
            ? deliveryPeriodMilestone!
            : deliveryMovesToIrPreparation
              ? irPreparationMilestone!
              : irPreparationMovesToIrReceipt
                ? irReceiptMilestone!
                : billPreparationBecomesCurrent
                  ? billPreparationMilestone!
                  : billPreparationMovesToBillSent
                    ? billSentForPaymentMilestone!
                    : billReturnedForCorrectionBecomesCurrent
                      ? billReturnedForCorrectionMilestone!
                      : jobCompletionMovesToPayment
                        ? paymentMilestone!
                        : deliveryPeriodMovesToPayment
                          ? paymentMilestone!
                          : billSentForPaymentMovesToPayment
                            ? paymentMilestone!
                            : paymentRollsBackToBillSent
                              ? billSentForPaymentMilestone!
                              : supplyOrderRollsBackToFinancialSanction
                                ? financialSanctionMilestone!
                                : manualCurrentMilestone === "Delivery"
                                  ? ""
                                  : manualCurrentMilestone;
  const normalizedCurrentMilestone = paymentRollsBackToJobCompletion ? "" : currentMilestone;
  return {
    ...order,
    currentMilestone: completedWithDerivedDelivery.includes(normalizedCurrentMilestone)
      ? ""
      : normalizedCurrentMilestone,
    completedMilestones: Array.from(new Set(completedWithDerivedDelivery)),
  };
}

function applyAdvancePaymentRules(
  advancePayment: AdvancePaymentDetail,
  advancePaymentActive = false,
) {
  const next = { ...emptyAdvancePayment, ...advancePayment };
  const completed = hasFilledValue(next.paymentDate);
  const current = advancePaymentActive && !completed;
  return {
    ...next,
    currentMilestone: current ? "Advance Payment" : "",
    completedMilestones: [],
  };
}

function applyAdvancePaymentValueTypeRules(
  advancePayment: AdvancePaymentDetail,
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected"> | undefined,
  advancePaymentActive = false,
) {
  let next = applyAdvancePaymentRules(advancePayment, advancePaymentActive);
  if (form?.valueCapitalSelected === "Yes") {
    next = { ...next, stageAmountRevenue: "", actualPaymentRevenue: "" };
  }
  if (form?.valueRevenueSelected === "Yes") {
    next = { ...next, stageAmountCapital: "", actualPaymentCapital: "" };
  }
  return next;
}

function autoFillStageDeliveries(
  order: SupplyOrderDetail,
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected" | "fileType"> | undefined,
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
    if (hasPaidStagePayment(stage)) {
      previousEndDate = stage.revisedDp || stage.dpDate || previousEndDate;
      return stage;
    }
    const suggestedStartDate = index === 0 ? order.soDate : getNextLocalDate(previousEndDate);
    const effectiveStartDate = stage.deliveryPeriodStartDate || suggestedStartDate || "";
    const suggestedEndDate = getStageIntervalEndDate(effectiveStartDate, form?.fileType);
    const nextStage = applyStageDeliveryValueTypeRules(
      applyStageDeliveryRules({
        ...stage,
        deliveryPeriodStartDate: effectiveStartDate,
        dpDate: stage.dpDate || suggestedEndDate || "",
        stageAmountCapital:
          useCapital &&
          capitalAmounts[index] !== undefined &&
          !hasFilledValue(stage.stageAmountCapital)
            ? capitalAmounts[index]
            : useRevenue
              ? ""
              : stage.stageAmountCapital,
        stageAmountRevenue:
          useRevenue &&
          revenueAmounts[index] !== undefined &&
          !hasFilledValue(stage.stageAmountRevenue)
            ? revenueAmounts[index]
            : useCapital
              ? ""
              : stage.stageAmountRevenue,
      }),
      form,
    );
    previousEndDate = nextStage.revisedDp || nextStage.dpDate;
    return nextStage;
  });

  return {
    order: applySupplyOrderRules({ ...order, stageDeliveries: stages }, form),
    changed: true,
  };
}

function autoFillStageDeliveriesForSave(
  orders: SupplyOrderDetail[],
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected" | "fileType"> | undefined,
) {
  return orders.map((order) =>
    isYes(order.stageDelivery ?? "") ? autoFillStageDeliveries(order, form).order : order,
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
  const totalRupees = Math.round(amount);
  const initialStageRupees = Math.round(totalRupees / stageCount);
  let remainingRupees = totalRupees;
  return Array.from({ length: stageCount }, (_, index) => {
    const stageRupees = index === stageCount - 1 ? remainingRupees : initialStageRupees;
    remainingRupees -= stageRupees;
    return formatDecimalInput(String(stageRupees));
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
  if (!isYes(next.dpExtension ?? "")) {
    next = { ...next, dpExtensionCount: "", revisedDp: "" };
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
    key !== "billAmountCapital" &&
    key !== "billAmountRevenue" &&
    key !== "actualPaymentCapital" &&
    key !== "actualPaymentRevenue" &&
    key !== "psbBgAmount" &&
    key !== "pwbBgAmount" &&
    key !== "combinedBgAmount"
  ) {
    return applySupplyOrderRules({ ...order, [key]: value }, undefined);
  }

  const amount = formatDecimalInput(value);
  if (key === "psbBgAmount" || key === "pwbBgAmount" || key === "combinedBgAmount") {
    return applySupplyOrderRules({ ...order, [key]: amount }, undefined);
  }
  if (key === "soValueCapital" || key === "soValueRevenue") {
    const billKey = key === "soValueCapital" ? "billAmountCapital" : "billAmountRevenue";
    const oldSoAmount = order[key];
    const oldBillAmount = order[billKey];
    const shouldMirrorToBillAmount =
      !hasFilledValue(oldBillAmount) ||
      formatDecimalInput(String(oldBillAmount ?? "")) ===
        formatDecimalInput(String(oldSoAmount ?? ""));
    const pairedKey = key === "soValueCapital" ? "soValueRevenue" : "soValueCapital";
    const pairedBillKey = key === "soValueCapital" ? "billAmountRevenue" : "billAmountCapital";
    return {
      ...order,
      [key]: amount,
      ...(shouldMirrorToBillAmount ? { [billKey]: amount } : {}),
      ...(hasNonZeroAmount(amount) ? { [pairedKey]: "", [pairedBillKey]: "" } : {}),
    };
  }
  const pairedKey =
    key === "actualPaymentCapital"
      ? "actualPaymentRevenue"
      : key === "actualPaymentRevenue"
        ? "actualPaymentCapital"
        : key === "billAmountCapital"
          ? "billAmountRevenue"
          : "billAmountCapital";
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

function isDeliveryInspectionInactive(
  form: Pick<FormState, "fileType" | "fileTypeGroup" | "ir" | "mode">,
) {
  return isJobCompletionWorkflow(form.fileType, form.ir, form.fileTypeGroup);
}

function isJobCompletionWorkflow(
  fileType: string | undefined,
  ir: string | undefined,
  fileTypeGroup?: string,
) {
  return isContractFileType({ fileType, fileTypeGroup }) || isNo(ir);
}

function isContractNoInspectionWorkflow(
  fileType: string | undefined,
  ir: string | undefined,
  fileTypeGroup?: string,
) {
  return isContractFileType({ fileType, fileTypeGroup }) && isNo(ir);
}

function isContractNoInspectionPaymentDue(
  order: Pick<SupplyOrderDetail, "dpDate" | "revisedDp">,
  form: Pick<FormState, "fileType" | "fileTypeGroup" | "ir"> | undefined,
) {
  if (!form || !isContractNoInspectionWorkflow(form.fileType, form.ir, form.fileTypeGroup)) {
    return false;
  }
  const dueDate = getNextLocalDate(order.revisedDp || order.dpDate);
  return hasFilledValue(dueDate) && dueDate! <= formatLocalDate(new Date());
}

function isFinancialSanctionReachedForForm(
  form: Pick<FormState, "mode" | "biddingStageOver" | "tcec" | "cfaDate" | "cncApprovalDate">,
) {
  if (isYes(form.tcec)) return hasFilledValue(form.cncApprovalDate);
  return isBiddingApplicableForFile(form)
    ? isYes(form.biddingStageOver)
    : hasFilledValue(form.cfaDate);
}

function isDpExpiryWordHiddenFileType(fileType: string | undefined) {
  const normalized = (fileType ?? "").trim().toLowerCase();
  return normalized === "amc" || normalized === "mpc" || normalized === "o&m";
}

function isDpExtensionInactiveFileType(fileType: string | undefined) {
  return false;
}

function isDpExtensionFieldInactive(
  form: Pick<FormState, "fileType">,
  key: string,
  row?: Pick<SupplyOrderDetail | StageDeliveryDetail, "dpExtension">,
) {
  if ((key === "dpExtensionCount" || key === "revisedDp") && !isYes(row?.dpExtension ?? "")) {
    return true;
  }
  return (
    isDpExtensionInactiveFileType(form.fileType) &&
    (key === "dpExtension" || key === "dpExtensionCount" || key === "revisedDp")
  );
}

function shouldShowSupplyOrderField(key: SupplyOrderKey, order: SupplyOrderDetail) {
  const coverageType = String(order.bgCoverageType ?? "None");
  const showPsb =
    isYes(order.psbApplicable ?? "") &&
    (coverageType === "PSB" || coverageType === "PSB and PWB separately");
  const showPwb = coverageType === "PWB" || coverageType === "PSB and PWB separately";
  const showCombined = coverageType === "PSB+PWB";
  if (
    key === "psbBgNo" ||
    key === "psbBgAmount" ||
    key === "psbBgReceivedDate" ||
    key === "psbBgValidityDate" ||
    key === "psbBgReturnDate"
  ) {
    return showPsb;
  }
  if (
    key === "pwbBgNo" ||
    key === "pwbBgAmount" ||
    key === "pwbBgReceivedDate" ||
    key === "pwbBgValidityDate" ||
    key === "pwbBgReturnDate"
  ) {
    return showPwb;
  }
  if (
    key === "combinedBgNo" ||
    key === "combinedBgAmount" ||
    key === "combinedBgReceivedDate" ||
    key === "combinedBgValidityDate" ||
    key === "combinedBgReturnDate"
  ) {
    return showCombined;
  }
  if (key === "warrantyPeriodDate") {
    return showPwb || showCombined;
  }
  if (key === "stageDeliveryCount" || key === "stagePayment") {
    return isYes(order.stageDelivery ?? "");
  }
  if (key === "advancePayment") {
    return isYes(order.stageDelivery ?? "") && isYes(order.stagePayment ?? "");
  }
  if (key === "shortclosureDate") {
    return isYes(order.shortclosure ?? "");
  }
  if (key === "soCancelledDate") {
    return isYes(order.soCancelled ?? "");
  }
  return true;
}

function isSupplyOrderFieldSequentiallyLocked(key: SupplyOrderKey, order: SupplyOrderDetail) {
  return isSupplyOrderFieldMissingPrerequisite(key, order, new Set());
}

function isCancellationSupplyOrderField(key: SupplyOrderKey) {
  return (
    key === "shortclosure" ||
    key === "shortclosureDate" ||
    key === "soCancelled" ||
    key === "soCancelledDate"
  );
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
      !hasCompletedSupplyOrderPrerequisite(order, prerequisite) ||
      isSupplyOrderFieldMissingPrerequisite(prerequisite, order, visited),
  );
}

function hasCompletedSupplyOrderPrerequisite(
  order: SupplyOrderDetail,
  prerequisite: SupplyOrderKey,
) {
  const value = String(order[prerequisite] ?? "");
  if (isSupplyOrderDateKey(prerequisite)) return isCompleteDateValue(value);
  return hasFilledValue(value);
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
  return isDivisionAdNo(form.division, divisions)
    ? { ...form, ad: "No", adSentDate: "", adVettingDate: "" }
    : form;
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
    (["ad", "adSentDate", "adVettingDate"].includes(key) &&
      isDivisionAdNo(form.division, divisions)) ||
    (isNo(form.tcec) && tcecDisabledKeys.includes(key)) ||
    (isNo(form.gem) && gemDisabledKeys.includes(key)) ||
    (isNo(form.highValue) && highValueDisabledKeys.includes(key)) ||
    (isNo(form.rqa) && rqaDisabledKeys.includes(key)) ||
    (isNo(form.ifa) && ifaDisabledKeys.includes(key)) ||
    (isNo(form.bg) && bgDisabledKeys.includes(key)) ||
    (isNo(form.rfpVetting) && rfpVettingDisabledKeys.includes(key)) ||
    (isNo(form.preBidMeeting) && preBidMeetingDisabledKeys.includes(key)) ||
    (!isYes(form.biddingStageOver) && biddingStageOverDisabledKeys.includes(key)) ||
    (isNo(form.refloat) && refloatDisabledKeys.includes(key)) ||
    (isNo(form.refloatPreBidMeeting) && refloatPreBidMeetingDisabledKeys.includes(key))
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
  const initials = words
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return (
    initials ||
    name
      .replace(/[^a-z0-9]+/gi, "")
      .slice(0, 4)
      .toUpperCase()
  );
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
  inputRef,
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
  inputRef?: (element: HTMLInputElement | null) => void;
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
              data-testid="add-field-valueCapitalSelected"
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
              data-testid="add-field-valueRevenueSelected"
              className="size-4 rounded border-input"
            />
            Revenue
          </label>
        </div>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => updateValue(event.target.value)}
          inputMode="decimal"
          disabled={valueDisabled}
          placeholder="Enter value"
          data-testid="add-field-valueAmount"
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
  testId = "add-field-soValueCapital",
  onChange,
}: {
  capitalSelected: boolean;
  revenueSelected: boolean;
  capitalValue: string;
  revenueValue: string;
  disabled: boolean;
  lockFilledFields?: boolean;
  lockedValueFilled?: boolean;
  testId?: string;
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
      testId={testId}
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
  testId,
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
  testId?: string;
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
          data-testid={testId}
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
  const testId = `add-field-${radioName ?? String(field.key)}`;
  if (field.options && (field.control === "radio" || isYesNoOptions(field.options))) {
    return (
      <Field label={field.label}>
        <RadioGroup
          name={radioName ?? field.key}
          testId={testId}
          options={field.options}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      </Field>
    );
  }

  if (field.typeahead && field.options) {
    return (
      <Field label={field.label}>
        <SearchableDropdown
          value={value}
          onChange={onChange}
          options={field.options}
          disabled={disabled}
          placeholder={field.placeholder}
          inputRef={inputRef as (element: HTMLInputElement | null) => void}
          data-testid={testId}
          className={inputCls + disabledCls(disabled)}
        />
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
          data-testid={testId}
          className={inputCls + disabledCls(disabled)}
        >
          <option value="">Select</option>
          {field.options
            .filter((option) => option.trim().toLowerCase() !== "select")
            .map((option) => (
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
          data-testid={testId}
          className={textareaCls + disabledCls(disabled)}
        />
      </Field>
    );
  }

  return (
    <Field label={field.label}>
      {field.type === "date" ? (
        <DateInput
          ref={inputRef as (element: HTMLInputElement | null) => void}
          value={value}
          onChange={onChange}
          disabled={disabled}
          data-testid={testId}
          className={inputCls + disabledCls(disabled)}
        />
      ) : (
        <input
          ref={inputRef}
          type={field.key === "exchangeRate" ? "text" : (field.type ?? "text")}
          value={value}
          onChange={(e) =>
            onChange(
              field.key === "exchangeRate" ? formatDecimalInput(e.target.value) : e.target.value,
            )
          }
          disabled={disabled}
          data-testid={testId}
          min={
            field.type === "number"
              ? field.key === "noOfSo"
                ? Math.max(1, field.min ?? 1)
                : (field.min ?? 0)
              : undefined
          }
          step={field.key === "exchangeRate" ? "any" : field.type === "number" ? 1 : undefined}
          inputMode={field.key === "exchangeRate" ? "decimal" : undefined}
          placeholder={field.placeholder}
          className={inputCls + disabledCls(disabled)}
        />
      )}
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

function hasSelectablePaymentMode(value: unknown) {
  const normalized = String(value ?? "").trim();
  return Boolean(normalized && normalized.toLowerCase() !== "select");
}

function cleanPaymentModeValue(value: unknown) {
  return hasSelectablePaymentMode(value) ? String(value ?? "").trim() : "";
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

function formatDateTextInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length < 4) return digits;
  if (digits.length < 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function isCompleteDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isSupplyOrderDateKey(key: SupplyOrderKey) {
  return supplyOrderFields.some((field) => field.key === key && field.type === "date");
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
  testId,
  options,
  value,
  disabled,
  onChange,
}: {
  name: string;
  testId?: string;
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
            data-testid={testId ? `${testId}-${testIdSlug(option)}` : undefined}
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

function testIdSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
