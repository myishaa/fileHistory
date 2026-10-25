import { Router } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import type {
  BillReturnCycle,
  FileMarker,
  FileRecord,
  FirmDetail,
  FileRemark,
  SupplementaryBillDetail,
  SupplyOrderDetail,
} from "../types.js";
import {
  canAccessDivision,
  canAccessFileCategory,
  canMutateFiles,
  canUseAllDivisions,
  getDivisionScopeCondition,
  getFileCategoryScopeCondition,
  requireAuth,
  type AuthRequest,
} from "../utils/auth.js";
import {
  getExportFileName,
  renderExcelDocument,
  renderPdfDocument,
} from "../utils/export-files.js";
import type {
  DatePresenceMode,
  FileSearchParams,
  IncludeExcludeFilter,
} from "../utils/file-search.js";
import {
  getFileCategorySqlCondition,
  normalizeFileCategories,
  type FileCategoryKey,
} from "../utils/file-categories.js";
import { rawSupplyOrders as normalizedRawSupplyOrders } from "../utils/effective-deliveries.js";
import {
  fromDbDate,
  fromDbJsonArray,
  fromDbText,
  toDbDate,
  toDbInteger,
  toDbNumber,
  toDbText,
} from "../utils/db-values.js";
import { clearDashboardReportCaches } from "../utils/cache.js";
import {
  getQuickEntryBillLifecycleEvents,
  getQuickEntryExportDpDate,
  getQuickEntryExportPaidSoFar,
  getQuickEntryExportSoAmountComponent,
  getQuickEntryExportRowPlan,
  isQuickEntryExportFieldApplicable,
} from "../utils/quick-entry-export.js";
import { asyncHandler, HttpError, requireObjectBody, requireParam } from "../utils/http.js";
import {
  contractFileTypeSql,
  isDeliveryInspectionApplicableByGroup,
  isBiddingApplicableForFile,
  isContractFileType,
  normalizeFileTypeGroups,
} from "../utils/file-type-groups.js";
import {
  buildFileProcessingChanges,
  createFileProcessingNotification,
} from "../utils/file-processing-notifications.js";

export const filesRouter = Router();
const allFilesYear = "__all_files__";
const allActiveFilesYear = "__all_active_files__";
const activePlusCurrentFyClosedYear = "__active_plus_current_fy_closed__";
const fileClosedMilestone = "File Closed";

function normalizeFinancialYearLabel(value: unknown) {
  const label = typeof value === "string" ? value.trim() : "";
  if (
    !label ||
    label === allFilesYear ||
    label === allActiveFilesYear ||
    label === activePlusCurrentFyClosedYear
  ) {
    return label;
  }
  const fullYearMatch = label.match(/^(\d{4})-(\d{4})$/);
  if (fullYearMatch) return `${fullYearMatch[1]}-${fullYearMatch[2].slice(-2)}`;
  const startYearMatch = label.match(/^(\d{4})$/);
  if (!startYearMatch) return label;
  const startYear = Number.parseInt(startYearMatch[1], 10);
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

const statusSummaryMilestones = [
  {
    key: "scrutiny",
    label: "Scrutiny",
    totalLabel: "Total files",
    reviewedColumn: "f.scrutiny_date",
    currentColumn: "f.scrutiny_completion_date",
  },
  {
    key: "highValue",
    label: "High Value",
    totalLabel: "Total cases",
    reviewedColumn: "f.high_value_meeting_date",
    currentColumn: "f.high_value_minutes_date",
    appliesColumn: "f.high_value",
  },
  {
    key: "tcec",
    label: "Pre-TCEC",
    totalLabel: "Total cases",
    reviewedColumn: "f.pre_tcec_date",
    currentColumn: "f.pre_tcec_minutes_date",
    appliesColumn: "f.tcec",
  },
  {
    key: "ad",
    label: "AD",
    totalLabel: "Total cases",
    reviewedColumn: "f.ad_sent_date",
    currentColumn: "f.ad_vetting_date",
    appliesColumn: "f.ad",
  },
  {
    key: "rqa",
    label: "R&QA",
    totalLabel: "Total cases",
    reviewedColumn: "f.rqa_sent_date",
    currentColumn: "f.rqa_approval_date",
    appliesColumn: "f.rqa",
  },
  {
    key: "control",
    label: "Controlling",
    totalLabel: "Total files",
    currentColumn: "f.imms_date",
    aliases: ["Controlling", "Controlled"],
  },
  {
    key: "ifa",
    label: "IFA",
    totalLabel: "Total cases",
    reviewedColumn: "f.ifa_sent_date",
    currentColumn: "f.ifa_final_date",
    appliesColumn: "f.ifa",
  },
  {
    key: "cfa",
    label: "CFA",
    totalLabel: "Total files",
    reviewedColumn: "f.cfa_sent_date",
    currentColumn: "f.cfa_date",
  },
  {
    key: "bidding",
    label: "Bidding",
    totalLabel: "Total files",
    currentColumn: "f.bidding_stage_over",
    yesComplete: true,
  },
  {
    key: "postTcec",
    label: "Post-TCEC",
    totalLabel: "Total cases",
    reviewedColumn: "f.post_tcec_date",
    currentColumn: "f.post_tcec_minutes_date",
    appliesColumn: "f.tcec",
  },
  {
    key: "refloatBidding",
    label: "Refloat bidding",
    totalLabel: "Total cases",
    pendingLabel: "In progress",
    currentColumn: "f.bidding_stage_over",
    appliesColumn: "f.refloat",
    yesComplete: true,
  },
  {
    key: "refloatPostTcec",
    label: "Refloat Post-TCEC",
    totalLabel: "Total cases",
    reviewedColumn: "f.refloat_post_tcec_date",
    currentColumn: "f.refloat_post_tcec_minutes_date",
    appliesColumn: "f.refloat",
  },
  {
    key: "cnc",
    label: "CNC",
    totalLabel: "Total cases",
    reviewedColumn: "f.cnc_date",
    currentColumn: "f.cnc_approval_date",
    appliesColumn: "f.tcec",
  },
  {
    key: "financialSanction",
    label: "Financial Sanction",
    totalLabel: "Total files",
    supplyOrderDate: "financial_sanction_date",
  },
  {
    key: "supplyOrder",
    label: "Supply Order",
    completedLabel: "Placed",
    totalLabel: "Total files",
    supplyOrderDate: "so_date",
  },
  {
    key: "psb",
    label: "PSB",
    completedLabel: "Received",
    totalLabel: "Total files",
    supplyOrderDate: "psb_bg_received_date",
  },
  {
    key: "pwb",
    label: "PWB",
    completedLabel: "Received",
    totalLabel: "Total files",
    appliesColumn: "f.bg",
    supplyOrderDate: "pwb_bg_received_date",
  },
  {
    key: "psbPwb",
    label: "PSB+PWB",
    completedLabel: "Received",
    totalLabel: "Total files",
    appliesColumn: "f.bg",
    supplyOrderDate: "combined_bg_received_date",
  },
  {
    key: "irPreparation",
    label: "IR Preparation",
    totalLabel: "Total files",
    appliesColumn: "f.ir",
    supplyOrderDate: "ir_preparation_date",
  },
  {
    key: "irReceipt",
    label: "IR Receipt",
    totalLabel: "Total files",
    appliesColumn: "f.ir",
    supplyOrderDate: "ir_receipt_date",
  },
  {
    key: "billPreparation",
    label: "Bill preparation",
    totalLabel: "Total files",
    supplyOrderDate: "bill_preparation_date",
  },
  {
    key: "billSentForPayment",
    label: "Bill sent for payment",
    totalLabel: "Total files",
    supplyOrderDate: "bill_sent_for_payment_date",
  },
  { key: "payment", label: "Payment", totalLabel: "Total files", supplyOrderDate: "payment_date" },
] as const;

type ValueKind = "text" | "date" | "number" | "integer" | "jsonArray" | "jsonObject";

const fileFields = {
  title: ["title", "text"],
  officer: ["officer", "text"],
  imms: ["imms", "text"],
  date: ["file_date", "date"],
  year: ["year", "text"],
  uniqueCode: ["unique_code", "text"],
  receivedDate: ["received_date", "date"],
  scrutinyDate: ["scrutiny_date", "date"],
  scrutinyResponseDate: ["scrutiny_response_date", "date"],
  scrutinyCompletionDate: ["scrutiny_completion_date", "date"],
  immsDate: ["imms_date", "date"],
  fileNo: ["file_no", "text"],
  indentor: ["indentor", "text"],
  demandDescription: ["demand_description", "text"],
  valueCapital: ["value_capital", "number"],
  valueRevenue: ["value_revenue", "number"],
  currency: ["currency", "text"],
  exchangeRate: ["exchange_rate", "number"],
  gte: ["gte", "text"],
  tcec: ["tcec", "text"],
  fileType: ["file_type", "text"],
  fileTypeGroup: ["file_type_group", "text"],
  mode: ["mode", "text"],
  gem: ["gem", "text"],
  gemBiddingMode: ["gem_bidding_mode", "text"],
  highValue: ["high_value", "text"],
  ad: ["ad", "text"],
  rqa: ["rqa", "text"],
  ifa: ["ifa", "text"],
  psb: ["psb", "text"],
  bg: ["bg", "text"],
  ir: ["ir", "text"],
  rfpVetting: ["rfp_vetting", "text"],
  highValueMeetingDate: ["high_value_meeting_date", "date"],
  highValueMinutesDate: ["high_value_minutes_date", "date"],
  adSentDate: ["ad_sent_date", "date"],
  preTcecDate: ["pre_tcec_date", "date"],
  preTcecMinutesDate: ["pre_tcec_minutes_date", "date"],
  preTcecCommitteeNo: ["pre_tcec_committee_no", "text"],
  adVettingDate: ["ad_vetting_date", "date"],
  rqaSentDate: ["rqa_sent_date", "date"],
  rqaApprovalDate: ["rqa_approval_date", "date"],
  ifaSentDate: ["ifa_sent_date", "date"],
  ifaFinalDate: ["ifa_final_date", "date"],
  cfaSentDate: ["cfa_sent_date", "date"],
  cfaDate: ["cfa_date", "date"],
  gemUndertakingDate: ["gem_undertaking_date", "date"],
  refloatGemUndertakingDate: ["refloat_gem_undertaking_date", "date"],
  refloatRecommendationDate: ["refloat_recommendation_date", "date"],
  rfpVettingInitiationDate: ["rfp_vetting_initiation_date", "date"],
  rfpVettingApprovalDate: ["rfp_vetting_approval_date", "date"],
  preBidMeeting: ["pre_bid_meeting", "text"],
  preBidMeetingDate: ["pre_bid_meeting_date", "date"],
  tenderLive: ["tender_live", "text"],
  bidNumber: ["bid_number", "text"],
  bidDate: ["bid_date", "date"],
  bidOpeningDate: ["bid_opening_date", "date"],
  bidOpened: ["bid_opened", "text"],
  refloat: ["refloat", "text"],
  refloatPreBidMeeting: ["refloat_pre_bid_meeting", "text"],
  refloatPreBidMeetingDate: ["refloat_pre_bid_meeting_date", "date"],
  postTcecDate: ["post_tcec_date", "date"],
  postTcecMinutesDate: ["post_tcec_minutes_date", "date"],
  postTcecCommitteeNumber: ["post_tcec_committee_number", "text"],
  refloatBiddingDate: ["refloat_bidding_date", "date"],
  refloatBidOpeningDate: ["refloat_bid_opening_date", "date"],
  refloatPostTcecDate: ["refloat_post_tcec_date", "date"],
  refloatPostTcecMinutesDate: ["refloat_post_tcec_minutes_date", "date"],
  refloatPostTcecCommitteeNo: ["refloat_post_tcec_committee_no", "text"],
  rst: ["rst", "text"],
  biddingStageOver: ["bidding_stage_over", "text"],
  refloatBiddingStageOver: ["refloat_bidding_stage_over", "text"],
  cncDate: ["cnc_date", "date"],
  cncApprovalDate: ["cnc_approval_date", "date"],
  noOfSo: ["no_of_so", "integer"],
  soNo: ["so_no", "text"],
  gemSoNo: ["gem_so_no", "text"],
  soDate: ["so_date", "date"],
  soValueCapital: ["so_value_capital", "number"],
  soValueRevenue: ["so_value_revenue", "number"],
  dpDate: ["dp_date", "date"],
  firm: ["firm", "text"],
  bqBasis: ["bq_basis", "text"],
  dpExtension: ["dp_extension", "text"],
  dpExtensionCount: ["dp_extension_count", "integer"],
  ld: ["ld", "text"],
  revisedDp: ["revised_dp", "date"],
  materialReceiptDate: ["material_receipt_date", "date"],
  irPreparationDate: ["ir_preparation_date", "date"],
  irReceiptDate: ["ir_receipt_date", "date"],
  billPreparationDate: ["bill_preparation_date", "date"],
  billSentForPaymentDate: ["bill_sent_for_payment_date", "date"],
  billReturnCycles: ["bill_return_cycles", "jsonArray"],
  paymentDate: ["payment_date", "date"],
  paymentMode: ["payment_mode", "text"],
  demandCancelled: ["demand_cancelled", "text"],
  demandCancelledDate: ["demand_cancelled_date", "date"],
  soCancelled: ["so_cancelled", "text"],
  soCancelledDate: ["so_cancelled_date", "date"],
  shortclosure: ["shortclosure", "text"],
  shortclosureDate: ["shortclosure_date", "date"],
  currentMilestone: ["current_milestone", "text"],
  fileClosureDate: ["file_closure_date", "date"],
} as const satisfies Record<string, readonly [string, ValueKind]>;

type SearchSql = {
  whereSql: string;
  values: unknown[];
  orderSql: string;
  limit: number;
  offset: number;
  page: number;
  pageSize: number;
};
type SearchSummaryTotals = Record<string, number>;

type ExportColumn = {
  key: string;
  label: string;
};
type FileSearchExportLayout = "columnwise" | "rowwise";
type FileSearchExportTable = {
  headers: string[];
  rows: string[][];
};

const supplyOrderFields = {
  currentMilestone: ["current_milestone", "text"],
  completedMilestones: ["completed_milestones", "jsonArray"],
  financialSanctionDate: ["financial_sanction_date", "date"],
  psbApplicable: ["psb_applicable", "text"],
  bgCoverageType: ["bg_coverage_type", "text"],
  psbBgNo: ["psb_bg_no", "text"],
  psbBgAmount: ["psb_bg_amount", "number"],
  psbBgReceivedDate: ["psb_bg_received_date", "date"],
  psbBgValidityDate: ["psb_bg_validity_date", "date"],
  psbBgReturnDate: ["psb_bg_return_date", "date"],
  pwbBgNo: ["pwb_bg_no", "text"],
  pwbBgAmount: ["pwb_bg_amount", "number"],
  pwbBgReceivedDate: ["pwb_bg_received_date", "date"],
  pwbBgValidityDate: ["pwb_bg_validity_date", "date"],
  pwbBgReturnDate: ["pwb_bg_return_date", "date"],
  combinedBgNo: ["combined_bg_no", "text"],
  combinedBgAmount: ["combined_bg_amount", "number"],
  combinedBgReceivedDate: ["combined_bg_received_date", "date"],
  combinedBgValidityDate: ["combined_bg_validity_date", "date"],
  combinedBgReturnDate: ["combined_bg_return_date", "date"],
  warrantyPeriodDate: ["warranty_period_date", "date"],
  soNo: ["so_no", "text"],
  gemSoNo: ["gem_so_no", "text"],
  soDate: ["so_date", "date"],
  soValueCapital: ["so_value_capital", "number"],
  soValueRevenue: ["so_value_revenue", "number"],
  billAmountCapital: ["bill_amount_capital", "number"],
  billAmountRevenue: ["bill_amount_revenue", "number"],
  dpDate: ["dp_date", "date"],
  firm: ["firm", "text"],
  firmUniqueNo: ["firm_unique_no", "text"],
  firmContactNo: ["firm_contact_no", "text"],
  firmCity: ["firm_city", "text"],
  firmType: ["firm_type", "text"],
  firmTypeOther: ["firm_type_other", "text"],
  dpExtension: ["dp_extension", "text"],
  dpExtensionCount: ["dp_extension_count", "integer"],
  ld: ["ld", "text"],
  ldType: ["ld_type", "text"],
  ldPercentage: ["ld_percentage", "number"],
  revisedDp: ["revised_dp", "date"],
  materialReceiptDate: ["material_receipt_date", "date"],
  actualJobCompletionDate: ["actual_job_completion_date", "date"],
  jobCompletionDate: ["job_completion_date", "date"],
  irPreparationDate: ["ir_preparation_date", "date"],
  irReceiptDate: ["ir_receipt_date", "date"],
  billPreparationDate: ["bill_preparation_date", "date"],
  billNo: ["bill_no", "text"],
  billSentForPaymentDate: ["bill_sent_for_payment_date", "date"],
  billReturnCycles: ["bill_return_cycles", "jsonArray"],
  paymentDate: ["payment_date", "date"],
  paymentMode: ["payment_mode", "text"],
  actualPaymentCapital: ["actual_payment_capital", "number"],
  actualPaymentRevenue: ["actual_payment_revenue", "number"],
  demandCancelled: ["demand_cancelled", "text"],
  soCancelled: ["so_cancelled", "text"],
  soCancelledDate: ["so_cancelled_date", "date"],
  shortclosure: ["shortclosure", "text"],
  shortclosureDate: ["shortclosure_date", "date"],
  noFurtherAction: ["no_further_action", "text"],
  noFurtherActionDate: ["no_further_action_date", "date"],
  stageDelivery: ["stage_delivery", "text"],
  stageDeliveryCount: ["stage_delivery_count", "integer"],
  stagePayment: ["stage_payment", "text"],
  advancePayment: ["advance_payment", "text"],
  advancePaymentDetail: ["advance_payment_detail", "jsonObject"],
  stageDeliveries: ["stage_deliveries", "jsonArray"],
  supplementaryBills: ["supplementary_bills", "jsonArray"],
  firmRatingValues: ["firm_rating_values", "jsonObject"],
} as const satisfies Record<string, readonly [string, ValueKind]>;

const stagedSupplyOrderExportKeys = new Set<string>([
  "currentMilestone",
  "deliveryPeriodStartDate",
  "dpDate",
  "dpExtension",
  "dpExtensionCount",
  "ld",
  "revisedDp",
  "stageDeliveryLabel",
  "stageAmountCapital",
  "stageAmountRevenue",
  "materialReceiptDate",
  "actualJobCompletionDate",
  "jobCompletionDate",
  "irPreparationDate",
  "irReceiptDate",
  "billPreparationDate",
  "billNo",
  "billSentForPaymentDate",
  "paymentDate",
  "paymentMode",
  "actualPaymentCapital",
  "actualPaymentRevenue",
]);

const advancePaymentDetailExportKeys = new Set<string>([
  "advanceStageAmountCapital",
  "advanceStageAmountRevenue",
  "advanceExpectedPaymentDate",
  "advancePaymentDate",
  "advanceActualPaymentCapital",
  "advanceActualPaymentRevenue",
]);

const supplementaryBillExportKeys = new Set<string>([
  "supplementaryBillNo",
  "supplementaryBillAmountCapital",
  "supplementaryBillAmountRevenue",
  "supplementaryBillSentForPaymentDate",
  "supplementaryBillReturnCycles",
  "supplementaryBillPaymentDate",
  "supplementaryBillPaymentMode",
  "supplementaryBillActualPaymentCapital",
  "supplementaryBillActualPaymentRevenue",
  "supplementaryBillRemarks",
]);

type FileRow = Record<string, unknown> & {
  id: string;
  division: string | null;
  created_at: Date | string;
  configured_file_types?: unknown;
  configured_file_type_groups?: unknown;
};

type FileChildren = {
  bqFirms: Map<string, FirmDetail[]>;
  invitedFirms: Map<string, FirmDetail[]>;
  bidderFirms: Map<string, FirmDetail[]>;
  supplyOrders: Map<string, SupplyOrderDetail[]>;
  remarks: Map<string, FileRemark[]>;
  markers: Map<string, FileMarker[]>;
  completedMilestones: Map<string, string[]>;
  activeYears: Map<string, string[]>;
};

function toDbValue(value: unknown, kind: ValueKind) {
  if (kind === "date") return toDbDate(value);
  if (kind === "number") return toDbNumber(value);
  if (kind === "integer") return toDbInteger(value);
  if (kind === "jsonArray") return JSON.stringify(Array.isArray(value) ? value : []);
  if (kind === "jsonObject")
    return JSON.stringify(value && typeof value === "object" && !Array.isArray(value) ? value : {});
  return toDbText(value);
}

function toFileFieldDbValue(frontendKey: string, value: unknown, kind: ValueKind) {
  if (frontendKey === "year") return normalizeFinancialYearLabel(value);
  if (frontendKey === "noOfSo") {
    const rawCount = String(value ?? "").trim();
    if (!rawCount) return null;
    const count = Number.parseInt(rawCount, 10);
    return Number.isFinite(count) ? Math.max(1, count) : null;
  }
  return toDbValue(value, kind);
}

function fromDbValue(value: unknown, kind: ValueKind) {
  if (kind === "jsonArray") return Array.isArray(value) ? value : [];
  if (kind === "jsonObject")
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (kind === "date") return fromDbDate(value);
  return fromDbText(value);
}

function readArray(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be an array.`);
  return value as Record<string, unknown>[];
}

function normalizeSupplyOrderCountInBody(body: Record<string, unknown>) {
  if (!Array.isArray(body.supplyOrders)) return body;
  const meaningfulRows = readArray(body.supplyOrders, "supplyOrders")!.filter(hasFilledValue);
  const requestedCount = readSupplyOrderCount(body.noOfSo);
  const count = Math.max(1, requestedCount ?? meaningfulRows.length);
  return {
    ...body,
    noOfSo: String(count),
    supplyOrders: meaningfulRows.slice(0, count),
  };
}

function trimRowsToSupplyOrderCount(rows: Record<string, unknown>[] | undefined, noOfSo: unknown) {
  if (!rows) return undefined;
  const rawCount = String(noOfSo ?? "").trim();
  if (!rawCount) return rows;
  const count = Number.parseInt(rawCount, 10);
  if (!Number.isFinite(count) || count < 1) return rows;
  return rows.slice(0, count);
}

function readSupplyOrderCount(value: unknown) {
  const rawCount = String(value ?? "").trim();
  if (!rawCount) return undefined;
  const count = Number.parseInt(rawCount, 10);
  if (!Number.isFinite(count) || count < 1) return undefined;
  return count;
}

function isNoText(value: unknown) {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === "no"
  );
}

function isJobCompletionWorkflowForPayload(file: {
  fileType?: unknown;
  fileTypeGroup?: unknown;
  ir?: unknown;
}) {
  return (
    isContractFileType({
      fileType: toDbText(file.fileType) ?? undefined,
      fileTypeGroup: toDbText(file.fileTypeGroup) ?? undefined,
    }) || isNoText(file.ir)
  );
}

function removeCompletedMilestones(value: unknown, removedKeys: Set<string>) {
  if (!Array.isArray(value)) return value;
  return value.filter((milestone) => !removedKeys.has(normalizeMilestoneName(String(milestone))));
}

function sanitizeStageDeliveriesForWorkflow(value: unknown, jobCompletionWorkflow: boolean) {
  if (!Array.isArray(value)) return value;
  return value.map((stage) => {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) return stage;
    const next = { ...(stage as Record<string, unknown>) };
    if (jobCompletionWorkflow) {
      next.materialReceiptDate = "";
      next.irPreparationDate = "";
      next.irReceiptDate = "";
    } else {
      next.actualJobCompletionDate = "";
      next.jobCompletionDate = "";
    }
    return next;
  });
}

function sanitizeSupplyOrderForWorkflow(
  row: Record<string, unknown>,
  jobCompletionWorkflow: boolean,
) {
  const next = { ...row };
  if (jobCompletionWorkflow) {
    next.materialReceiptDate = "";
    next.irPreparationDate = "";
    next.irReceiptDate = "";
    next.completedMilestones = removeCompletedMilestones(
      next.completedMilestones,
      new Set(["delivery", "irpreparation", "irreceipt"]),
    );
  } else {
    next.actualJobCompletionDate = "";
    next.jobCompletionDate = "";
    next.completedMilestones = removeCompletedMilestones(
      next.completedMilestones,
      new Set(["jobcompletion"]),
    );
  }
  next.stageDeliveries = sanitizeStageDeliveriesForWorkflow(
    next.stageDeliveries,
    jobCompletionWorkflow,
  );
  if (!isYesValue(next.stageDelivery)) {
    next.stageDelivery = "No";
    next.stageDeliveryCount = "";
    next.stagePayment = "No";
    next.stageDeliveries = [];
  } else {
    const stageCount = readSupplyOrderCount(next.stageDeliveryCount) ?? 1;
    const stages = readObjectArray(next.stageDeliveries);
    next.stageDeliveryCount = String(stageCount);
    next.stageDeliveries = stages.slice(0, stageCount);
    const isDeliveryMilestone = (milestone: unknown) =>
      ["deliveryperiod", "delivery", "jobcompletion", "irpreparation", "irreceipt"].includes(
        normalizeMilestoneName(String(milestone ?? "")),
      );
    next.dpDate = "";
    next.dpExtension = "No";
    next.dpExtensionCount = "";
    next.revisedDp = "";
    next.ld = "No";
    next.ldType = "";
    next.ldPercentage = "";
    next.deliveryPeriodStartDate = "";
    next.materialReceiptDate = "";
    next.actualJobCompletionDate = "";
    next.jobCompletionDate = "";
    next.irPreparationDate = "";
    next.irReceiptDate = "";
    next.currentMilestone = isDeliveryMilestone(next.currentMilestone) ? "" : next.currentMilestone;
    next.completedMilestones = Array.isArray(next.completedMilestones)
      ? next.completedMilestones.filter((milestone) => !isDeliveryMilestone(milestone))
      : [];
    if (isYesValue(next.stagePayment)) {
      next.includeInPaymentTiming = undefined;
      const isPaymentMilestone = (milestone: unknown) =>
        ["billpreparation", "billsentforpayment", "payment", "billreturnedforcorrection"].includes(
          normalizeMilestoneName(String(milestone ?? "")),
        );
      next.billPreparationDate = "";
      next.billNo = "";
      next.billSentForPaymentDate = "";
      next.billReturnCycles = [];
      next.billAmountCapital = "";
      next.billAmountRevenue = "";
      next.paymentDate = "";
      next.paymentMode = "";
      next.actualPaymentCapital = "";
      next.actualPaymentRevenue = "";
      next.currentMilestone = isPaymentMilestone(next.currentMilestone)
        ? ""
        : next.currentMilestone;
      next.completedMilestones = Array.isArray(next.completedMilestones)
        ? next.completedMilestones.filter((milestone) => !isPaymentMilestone(milestone))
        : [];
    }
    if (!isYesValue(next.stagePayment)) {
      next.stagePayment = "No";
      next.stageDeliveries = (next.stageDeliveries as Record<string, unknown>[]).map((stage) => {
        const currentMilestone = String(stage.currentMilestone ?? "");
        const isPaymentMilestone = (milestone: string) =>
          [
            "billpreparation",
            "billsentforpayment",
            "payment",
            "billreturnedforcorrection",
          ].includes(normalizeMilestoneName(milestone));
        return {
          ...stage,
          includeInPaymentTiming: undefined,
          currentMilestone: isPaymentMilestone(currentMilestone) ? "" : currentMilestone,
          completedMilestones: Array.isArray(stage.completedMilestones)
            ? stage.completedMilestones.filter(
                (milestone) => !isPaymentMilestone(String(milestone ?? "")),
              )
            : [],
          billPreparationDate: "",
          billNo: "",
          billSentForPaymentDate: "",
          billReturnCycles: [],
          paymentDate: "",
          paymentMode: "",
          actualPaymentCapital: "",
          actualPaymentRevenue: "",
        };
      });
    }
  }
  return next;
}

function sanitizeSupplyOrdersForWorkflow(
  rows: Record<string, unknown>[] | undefined,
  file: { fileType?: unknown; fileTypeGroup?: unknown; ir?: unknown },
) {
  if (!rows) return undefined;
  const jobCompletionWorkflow = isJobCompletionWorkflowForPayload(file);
  return rows.map((row) => sanitizeSupplyOrderForWorkflow(row, jobCompletionWorkflow));
}

function sanitizeFileBodyForWorkflow(
  body: Record<string, unknown>,
  file: { fileType?: unknown; fileTypeGroup?: unknown; ir?: unknown },
) {
  const jobCompletionWorkflow = isJobCompletionWorkflowForPayload(file);
  const next = { ...body };
  if (isNoText(next.ad)) {
    next.adSentDate = "";
    next.adVettingDate = "";
  }
  const workflowRelevantChange =
    "fileType" in body ||
    "fileTypeGroup" in body ||
    "ir" in body ||
    "materialReceiptDate" in body ||
    "irPreparationDate" in body ||
    "irReceiptDate" in body ||
    "supplyOrders" in body;
  if (jobCompletionWorkflow && workflowRelevantChange) {
    next.materialReceiptDate = "";
    next.irPreparationDate = "";
    next.irReceiptDate = "";
  }
  if ("supplyOrders" in body) {
    next.supplyOrders = sanitizeSupplyOrdersForWorkflow(
      readArray(body.supplyOrders, "supplyOrders"),
      file,
    );
  }
  sanitizeFileMilestoneState(next);
  return next;
}

async function resolveConfiguredFileTypeGroup(
  client: PoolClient,
  fileType: string | undefined,
  suppliedGroup: string | undefined,
) {
  if (!fileType?.trim()) return suppliedGroup;
  const result = await client.query<{ file_types: unknown; file_type_groups: unknown }>(
    "select file_types, file_type_groups from app_settings where id = true",
  );
  const configuredTypes = fromDbJsonArray(result.rows[0]?.file_types).filter(
    (value): value is string => typeof value === "string",
  );
  const configuredType = configuredTypes.find(
    (value) => value.trim().toLowerCase() === fileType.trim().toLowerCase(),
  );
  if (!configuredType) {
    throw new HttpError(400, `File Type is not configured in Settings: ${fileType}.`);
  }
  const group = normalizeFileTypeGroups(result.rows[0]?.file_type_groups, [configuredType])[0]
    .group;
  if (suppliedGroup && suppliedGroup !== group) {
    throw new HttpError(
      400,
      `File Type ${configuredType} belongs to ${group}, not ${suppliedGroup}.`,
    );
  }
  return group;
}

function sanitizeFileMilestoneState(body: Record<string, unknown>) {
  if (!("currentMilestone" in body)) return;
  const currentMilestone = toDbText(body.currentMilestone);
  const normalizedCurrent = normalizeMilestoneName(currentMilestone ?? "");
  if (!normalizedCurrent) return;

  const completedMilestones = Array.isArray(body.completedMilestones)
    ? body.completedMilestones.map((milestone) => normalizeMilestoneName(String(milestone ?? "")))
    : [];
  if (completedMilestones.includes(normalizedCurrent)) {
    body.currentMilestone = "";
    return;
  }

  const supplyOrders = Array.isArray(body.supplyOrders) ? body.supplyOrders : [];
  if (supplyOrders.length > 0 && isSupplyOrderDrivenMilestoneName(currentMilestone ?? "")) {
    body.currentMilestone = "";
  }
}

async function resolveDivisionId(client: PoolClient, division: unknown) {
  const name = toDbText(division);
  if (!name) return null;

  const result = await client.query<{ id: string }>(
    "select id from divisions where lower(name) = lower($1) and archived_at is null",
    [name],
  );
  if (!result.rows[0]) throw new HttpError(400, `Division not found: ${name}`);
  return result.rows[0].id;
}

function mapFile(row: FileRow, children: FileChildren): FileRecord {
  const file = {
    id: row.id,
    divisionId: fromDbText(row.division_id),
    division: fromDbText(row.division),
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    bqFirms: children.bqFirms.get(row.id) ?? [],
    invitedFirms: children.invitedFirms.get(row.id) ?? [],
    bidderFirms: children.bidderFirms.get(row.id) ?? [],
    supplyOrders: children.supplyOrders.get(row.id) ?? [],
    remarks: children.remarks.get(row.id) ?? [],
    markers: children.markers.get(row.id) ?? [],
    completedMilestones: children.completedMilestones.get(row.id) ?? [],
    activeYears: children.activeYears.get(row.id) ?? [],
  } as FileRecord;

  for (const [frontendKey, [column, kind]] of Object.entries(fileFields)) {
    (file as Record<string, unknown>)[frontendKey] = fromDbValue(row[column], kind);
  }

  if (!file.fileTypeGroup?.trim() && file.fileType) {
    file.fileTypeGroup = normalizeFileTypeGroups(
      row.configured_file_type_groups,
      fromDbJsonArray(row.configured_file_types).filter(
        (value): value is string => typeof value === "string",
      ),
    ).find(
      (entry) => entry.fileType.trim().toLowerCase() === file.fileType?.trim().toLowerCase(),
    )?.group;
  }

  return file;
}

async function loadChildren(fileIds: string[]): Promise<FileChildren> {
  const children: FileChildren = {
    bqFirms: new Map(),
    invitedFirms: new Map(),
    bidderFirms: new Map(),
    supplyOrders: new Map(),
    remarks: new Map(),
    markers: new Map(),
    completedMilestones: new Map(),
    activeYears: new Map(),
  };
  if (!fileIds.length) return children;

  const firmRows = await pool.query<{
    file_id: string;
    firm_type: "bq" | "invited" | "bidder";
    firm_name: string | null;
    city: string | null;
    address: string | null;
    email_id: string | null;
    firm_unique_no: string | null;
    contact_no: string | null;
  }>(
    `select file_id, firm_type, firm_name, city, address, email_id, firm_unique_no, contact_no
     from file_firms
     where file_id = any($1::uuid[])
     order by sort_order asc, id asc`,
    [fileIds],
  );
  for (const row of firmRows.rows) {
    const firm = {
      firmName: fromDbText(row.firm_name),
      city: fromDbText(row.city),
      address: fromDbText(row.address),
      emailId: fromDbText(row.email_id),
      firmUniqueNo: fromDbText(row.firm_unique_no),
      contactNo: fromDbText(row.contact_no),
    };
    const map =
      row.firm_type === "bq"
        ? children.bqFirms
        : row.firm_type === "invited"
          ? children.invitedFirms
          : children.bidderFirms;
    map.set(row.file_id, [...(map.get(row.file_id) ?? []), firm]);
  }

  const orderRows = await pool.query<Record<string, unknown> & { file_id: string }>(
    `select *
     from supply_orders
     where file_id = any($1::uuid[])
     order by sort_order asc, id asc`,
    [fileIds],
  );
  for (const row of orderRows.rows) {
    const order: SupplyOrderDetail = { id: String(row.id ?? "") };
    order.includeInPaymentTiming = row.include_in_payment_timing !== false;
    for (const [frontendKey, [column, kind]] of Object.entries(supplyOrderFields)) {
      (order as Record<string, unknown>)[frontendKey] = fromDbValue(row[column], kind);
    }
    children.supplyOrders.set(row.file_id, [
      ...(children.supplyOrders.get(row.file_id) ?? []),
      order,
    ]);
  }

  const remarkRows = await pool.query<{
    id: string;
    file_id: string;
    section: string;
    text: string;
    created_at: Date | string;
  }>(
    `select id, file_id, section, text, created_at
     from file_remarks
     where file_id = any($1::uuid[])
     order by created_at asc, id asc`,
    [fileIds],
  );
  for (const row of remarkRows.rows) {
    const remark = {
      id: row.id,
      section: row.section,
      text: row.text,
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    };
    children.remarks.set(row.file_id, [...(children.remarks.get(row.file_id) ?? []), remark]);
  }

  const markerRows = await pool.query<{
    id: string;
    file_id: string;
    text: string;
    created_at: Date | string;
  }>(
    `select id, file_id, text, created_at
     from file_markers
     where file_id = any($1::uuid[])
     order by sort_order asc, created_at asc, id asc`,
    [fileIds],
  );
  for (const row of markerRows.rows) {
    const marker = {
      id: row.id,
      text: row.text,
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    };
    children.markers.set(row.file_id, [...(children.markers.get(row.file_id) ?? []), marker]);
  }

  const milestoneRows = await pool.query<{ file_id: string; milestone: string }>(
    `select file_id, milestone
     from file_completed_milestones
     where file_id = any($1::uuid[])
     order by milestone asc`,
    [fileIds],
  );
  for (const row of milestoneRows.rows) {
    children.completedMilestones.set(row.file_id, [
      ...(children.completedMilestones.get(row.file_id) ?? []),
      row.milestone,
    ]);
  }

  const activeYearRows = await pool.query<{ file_id: string; financial_year: string }>(
    `select file_id, financial_year
     from file_year_activity
     where file_id = any($1::uuid[]) and status = 'active'
     order by financial_year asc`,
    [fileIds],
  );
  for (const row of activeYearRows.rows) {
    children.activeYears.set(row.file_id, [
      ...(children.activeYears.get(row.file_id) ?? []),
      row.financial_year,
    ]);
  }

  return children;
}

function combineWhere(whereSql: string, includeArchived: boolean) {
  const trimmed = whereSql.trim();
  const activeCondition = includeArchived ? "" : "f.archived_at is null";
  if (!activeCondition) return trimmed;
  if (!trimmed) return `where ${activeCondition}`;
  if (trimmed.toLowerCase().startsWith("where ")) {
    return `where ${activeCondition} and (${trimmed.slice(6)})`;
  }
  return `${trimmed} and ${activeCondition}`;
}

export async function loadFiles(whereSql = "", values: unknown[] = [], includeArchived = false) {
  const result = await pool.query<FileRow>(
    `select f.*, d.name as division,
            s.file_types as configured_file_types,
            s.file_type_groups as configured_file_type_groups
     from files f
     left join divisions d on d.id = f.division_id
     left join app_settings s on s.id = true
     ${combineWhere(whereSql, includeArchived)}
     order by f.created_at desc`,
    values,
  );
  const children = await loadChildren(result.rows.map((row) => row.id));
  return result.rows.map((row) => mapFile(row, children));
}

async function loadSearchFiles(searchSql: SearchSql) {
  const resultValues = [...searchSql.values, searchSql.limit, searchSql.offset];
  const limitPlaceholder = `$${searchSql.values.length + 1}`;
  const offsetPlaceholder = `$${searchSql.values.length + 2}`;
  const [countResult, result, summaryTotals] = await Promise.all([
    pool.query<{ total: string }>(
      `select count(*)::text as total
       from files f
       left join divisions d on d.id = f.division_id
       ${combineWhere(searchSql.whereSql, false)}`,
      searchSql.values,
    ),
    pool.query<FileRow>(
      `select f.*, d.name as division,
              s.file_types as configured_file_types,
              s.file_type_groups as configured_file_type_groups
       from files f
       left join divisions d on d.id = f.division_id
       left join app_settings s on s.id = true
       ${combineWhere(searchSql.whereSql, false)}
       ${searchSql.orderSql}
       limit ${limitPlaceholder}
       offset ${offsetPlaceholder}`,
      resultValues,
    ),
    loadSearchSummaryTotals(searchSql),
  ]);
  const children = await loadChildren(result.rows.map((row) => row.id));
  return {
    files: result.rows.map((row) => mapFile(row, children)),
    total: Number(countResult.rows[0]?.total ?? 0),
    summaryTotals,
  };
}

async function loadSearchSummaryTotals(searchSql: SearchSql): Promise<SearchSummaryTotals> {
  const whereSql = combineWhere(searchSql.whereSql, false);
  const [fileResult, supplyOrderResult, stageResult, advanceResult] = await Promise.all([
    pool.query<Record<string, string>>(
      `select
         coalesce(sum(${inrAmountExpression("f.value_capital")}), 0)::text as "valueCapital",
         coalesce(sum(${inrAmountExpression("f.value_revenue")}), 0)::text as "valueRevenue",
         coalesce(sum(coalesce(f.no_of_so, 0)), 0)::text as "noOfSo"
       from files f
       left join divisions d on d.id = f.division_id
       ${whereSql}`,
      searchSql.values,
    ),
    pool.query<Record<string, string>>(
      `select
         coalesce(sum(${inrAmountExpression("so.so_value_capital")}), 0)::text as "soValueCapital",
         coalesce(sum(${inrAmountExpression("so.so_value_revenue")}), 0)::text as "soValueRevenue",
         coalesce(sum(coalesce(so.psb_bg_amount, 0)), 0)::text as "psbBgAmount",
         coalesce(sum(coalesce(so.pwb_bg_amount, 0)), 0)::text as "pwbBgAmount",
         coalesce(sum(coalesce(so.combined_bg_amount, 0)), 0)::text as "combinedBgAmount",
         coalesce(sum(coalesce(so.dp_extension_count, 0)), 0)::text as "dpExtensionCount",
         coalesce(sum(coalesce(so.stage_delivery_count, 0)), 0)::text as "stageDeliveryCount",
         coalesce(sum(coalesce(so.actual_payment_capital, 0)), 0)::text as "actualPaymentCapital",
         coalesce(sum(coalesce(so.actual_payment_revenue, 0)), 0)::text as "actualPaymentRevenue"
       from supply_orders so
       join files f on f.id = so.file_id
       left join divisions d on d.id = f.division_id
       ${whereSql}`,
      searchSql.values,
    ),
    pool.query<Record<string, string>>(
      `select
         coalesce(sum(coalesce(nullif(regexp_replace(stage.value ->> 'stageAmountCapital', '[,[:space:]]', '', 'g'), '')::numeric, 0)), 0)::text as "stageAmountCapital",
         coalesce(sum(coalesce(nullif(regexp_replace(stage.value ->> 'stageAmountRevenue', '[,[:space:]]', '', 'g'), '')::numeric, 0)), 0)::text as "stageAmountRevenue"
       from supply_orders so
       join files f on f.id = so.file_id
       left join divisions d on d.id = f.division_id
       left join lateral jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) stage(value) on true
       ${whereSql}`,
      searchSql.values,
    ),
    pool.query<Record<string, string>>(
      `select
         coalesce(sum(coalesce(nullif(regexp_replace(so.advance_payment_detail ->> 'stageAmountCapital', '[,[:space:]]', '', 'g'), '')::numeric, 0)), 0)::text as "advanceStageAmountCapital",
         coalesce(sum(coalesce(nullif(regexp_replace(so.advance_payment_detail ->> 'stageAmountRevenue', '[,[:space:]]', '', 'g'), '')::numeric, 0)), 0)::text as "advanceStageAmountRevenue",
         coalesce(sum(coalesce(nullif(regexp_replace(so.advance_payment_detail ->> 'actualPaymentCapital', '[,[:space:]]', '', 'g'), '')::numeric, 0)), 0)::text as "advanceActualPaymentCapital",
         coalesce(sum(coalesce(nullif(regexp_replace(so.advance_payment_detail ->> 'actualPaymentRevenue', '[,[:space:]]', '', 'g'), '')::numeric, 0)), 0)::text as "advanceActualPaymentRevenue"
       from supply_orders so
       join files f on f.id = so.file_id
       left join divisions d on d.id = f.division_id
       ${whereSql}`,
      searchSql.values,
    ),
  ]);
  return {
    ...normalizeSearchSummaryRow(fileResult.rows[0]),
    ...normalizeSearchSummaryRow(supplyOrderResult.rows[0]),
    ...normalizeSearchSummaryRow(stageResult.rows[0]),
    ...normalizeSearchSummaryRow(advanceResult.rows[0]),
  };
}

function normalizeSearchSummaryRow(row: Record<string, string> | undefined): SearchSummaryTotals {
  const totals: SearchSummaryTotals = {};
  for (const [key, value] of Object.entries(row ?? {})) {
    const parsed = Number(value);
    totals[key] = Number.isFinite(parsed) ? parsed : 0;
  }
  return totals;
}

const fileExportDateFields = [
  ["receivedDate", "Demand received date"],
  ["scrutinyDate", "Scrutiny"],
  ["scrutinyResponseDate", "Scrutiny response"],
  ["scrutinyCompletionDate", "Scrutiny completion"],
  ["immsDate", "Controlling"],
  ["highValueMeetingDate", "High Value meeting"],
  ["highValueMinutesDate", "High Value minutes"],
  ["adSentDate", "AD sent"],
  ["preTcecDate", "Pre-TCEC"],
  ["preTcecMinutesDate", "Pre-TCEC minutes"],
  ["adVettingDate", "AD vetting"],
  ["rqaSentDate", "R&QA sent"],
  ["rqaApprovalDate", "R&QA approval"],
  ["ifaSentDate", "IFA sent"],
  ["ifaFinalDate", "IFA final"],
  ["cfaSentDate", "CFA sent"],
  ["cfaDate", "CFA approval"],
  ["preBidMeetingDate", "Pre-Bid Meeting"],
  ["bidDate", "Bid date"],
  ["bidOpeningDate", "Bid closing"],
  ["refloatPreBidMeetingDate", "Refloat Pre-Bid Meeting"],
  ["postTcecDate", "Post-TCEC"],
  ["postTcecMinutesDate", "Post-TCEC minutes"],
  ["refloatPostTcecDate", "Refloat Post-TCEC"],
  ["refloatPostTcecMinutesDate", "Refloat Post-TCEC minutes"],
  ["cncDate", "CNC"],
  ["cncApprovalDate", "CNC approval"],
] as const;

const supplyOrderExportDateFields = [
  ["financialSanctionDate", "Financial Sanction"],
  ["soDate", "S.O. date"],
  ["dpDate", "DP date"],
  ["revisedDp", "Revised DP"],
  ["materialReceiptDate", "Material receipt"],
  ["actualJobCompletionDate", "Actual Job Completion"],
  ["irPreparationDate", "IR Preparation"],
  ["irReceiptDate", "IR Receipt"],
  ["billPreparationDate", "Bill preparation"],
  ["billSentForPaymentDate", "Bill sent for payment"],
  ["paymentDate", "Payment"],
  ["soCancelledDate", "S.O. cancelled date"],
  ["shortclosureDate", "Shortclosure date"],
] as const;

function readDateTime(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const time = new Date(text).getTime();
  return Number.isNaN(time) ? undefined : time;
}

function getLastFilledDate(file: FileRecord) {
  const fileDates = fileExportDateFields.flatMap(([key, label]) => {
    const value = String((file as Record<string, unknown>)[key] ?? "").trim();
    const time = readDateTime(value);
    return time === undefined ? [] : [{ label, value, time }];
  });
  const orders = file.supplyOrders ?? [];
  const supplyOrderDates = orders.flatMap((order, index) =>
    supplyOrderExportDateFields.flatMap(([key, label]) => {
      const value = String((order as Record<string, unknown>)[key] ?? "").trim();
      const time = readDateTime(value);
      if (time === undefined) return [];
      return [
        {
          label: `${label}${orders.length > 1 ? ` (S.O. ${index + 1})` : ""}`,
          value,
          time,
        },
      ];
    }),
  );
  return [...fileDates, ...supplyOrderDates].sort((a, b) => b.time - a.time)[0];
}

function getFileExportValue(file: FileRecord, key: string) {
  if (key === "lastDateDescription") return getLastFilledDate(file)?.label ?? "";
  if (key === "lastDate") return getLastFilledDate(file)?.value ?? "";
  if (key === "bqFirms") return String(getFirmCount(file.bqFirms));
  if (key === "invitedFirms") return String(getFirmCount(file.invitedFirms));
  if (key === "bidderFirms") return String(getFirmCount(file.bidderFirms));
  const firmDetailValue = getFirmDetailExportValue(file, key);
  if (firmDetailValue !== undefined) return firmDetailValue;
  if (key === "noOfSo") return String(file.noOfSo || file.supplyOrders?.length || "");
  if (
    key in supplyOrderFields ||
    advancePaymentDetailExportKeys.has(key) ||
    supplementaryBillExportKeys.has(key)
  ) {
    return getRawSupplyOrders(file)
      .map((order) => getSupplyOrderExportValue(order, key).trim())
      .filter(Boolean)
      .join("; ");
  }
  return String((file as Record<string, unknown>)[key] ?? "");
}

function getFirmDetailExportValue(file: FileRecord, key: string) {
  const fieldKey = firmDetailExportFieldKey(key);
  if (!fieldKey) return undefined;
  if (!isBiddingApplicableForFile(file)) return "";
  const rows = key.startsWith("bq")
    ? file.bqFirms
    : key.startsWith("invited")
      ? file.invitedFirms
      : file.bidderFirms;
  return (rows ?? [])
    .map((firm, index, allRows) => {
      const value = String((firm as Record<string, unknown>)[fieldKey] ?? "").trim();
      if (!value) return "";
      return allRows.length > 1 ? `${index + 1}. ${value}` : value;
    })
    .filter(Boolean)
    .join("\n");
}

function firmDetailExportFieldKey(key: string) {
  if (!/^(bq|invited|bidder)Firm/.test(key)) return undefined;
  if (key.endsWith("Names")) return "firmName";
  if (key.endsWith("UniqueNos")) return "firmUniqueNo";
  if (key.endsWith("Emails")) return "emailId";
  if (key.endsWith("Cities")) return "city";
  if (key.endsWith("ContactNos")) return "contactNo";
  return undefined;
}

function buildFileSearchExportColumns(files: FileRecord[], columns: ExportColumn[]) {
  const maxSupplyOrders = Math.max(1, ...files.map((file) => getRawSupplyOrders(file).length));
  return columns.flatMap((column) => {
    if (!(column.key in supplyOrderFields) && !advancePaymentDetailExportKeys.has(column.key)) {
      return [
        {
          label: column.label,
          getValue: (file: FileRecord) => getFileExportValue(file, column.key),
        },
      ];
    }

    const maxStageCounts = Array.from({ length: maxSupplyOrders }, (_, orderIndex) =>
      Math.max(
        0,
        ...files.map((file) => getRawSupplyOrders(file)[orderIndex]?.stageDeliveries?.length ?? 0),
      ),
    );

    return Array.from({ length: maxSupplyOrders }, (_, orderIndex) => {
      const orderNumber = orderIndex + 1;
      const mainColumn = {
        label: `S.O. ${orderNumber} ${column.label}`,
        getValue: (file: FileRecord) => getMainSupplyOrderExportValue(file, column.key, orderIndex),
      };
      if (!stagedSupplyOrderExportKeys.has(column.key)) return [mainColumn];
      const stageColumns = Array.from({ length: maxStageCounts[orderIndex] }, (_, stageIndex) => ({
        label: `S.O. ${orderNumber} Delivery-${stageIndex + 1} ${column.label}`,
        getValue: (file: FileRecord) =>
          getStageSupplyOrderExportValue(file, column.key, orderIndex, stageIndex),
      }));
      return [mainColumn, ...stageColumns];
    }).flat();
  });
}

function buildFileSearchExportTable(
  files: FileRecord[],
  columns: ExportColumn[],
  layout: FileSearchExportLayout,
): FileSearchExportTable {
  if (layout === "rowwise") return buildRowwiseFileSearchExportTable(files, columns);
  const exportColumns = buildFileSearchExportColumns(files, columns);
  return {
    headers: ["S.No.", ...exportColumns.map((column) => column.label)],
    rows: files.map((file, index) => [
      String(index + 1),
      ...exportColumns.map((column) => column.getValue(file)),
    ]),
  };
}

function buildRowwiseFileSearchExportTable(
  files: FileRecord[],
  columns: ExportColumn[],
): FileSearchExportTable {
  const fileColumns = columns.filter((column) => !isSupplyOrderExportKey(column.key));
  const supplyOrderColumns = columns.filter((column) => isSupplyOrderExportKey(column.key));
  const headers = [
    "S.No.",
    ...fileColumns.map((column) => column.label),
    ...supplyOrderColumns.flatMap((column) => getRowwiseSupplyOrderExportHeaders(column)),
  ];
  const rows: string[][] = [];
  files.forEach((file, fileIndex) => {
    const rowEntries = supplyOrderColumns.length
      ? getRowwiseFileSearchExportEntries(file, supplyOrderColumns)
      : [{ orderIndex: -1, stageIndex: -1, supplementaryBillIndex: -1, billReturnCycleIndex: -1 }];
    rowEntries.forEach((entry, entryIndex) => {
      rows.push([
        String(fileIndex + 1),
        ...fileColumns.map((column) =>
          entryIndex === 0 ? getFileExportValue(file, column.key) || "Not set" : "",
        ),
        ...supplyOrderColumns.flatMap((column) =>
          getRowwiseSupplyOrderExportValues(file, column.key, entry),
        ),
      ]);
    });
  });
  return { headers, rows };
}

function normalizeSearchExportMoney(
  table: FileSearchExportTable,
  files: FileRecord[],
): FileSearchExportTable {
  const amountColumns = table.headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => isSearchExportMoneyHeader(header));
  if (!amountColumns.length) return table;

  const numberFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
  const rows = table.rows.map((row) => {
    const fileIndex = Number.parseInt(row[0] ?? "", 10) - 1;
    const file = files[fileIndex];
    if (!file) return row;
    const nextRow = [...row];
    for (const { header, index } of amountColumns) {
      const value = nextRow[index];
      if (!value) continue;
      let multiplier = 1;
      if (/^value\s*\((capital|revenue)\)$/i.test(header)) {
        const currency = (file.currency ?? "INR").trim().toUpperCase();
        if (currency && currency !== "INR") {
          const rate = Number(String(file.exchangeRate ?? "").replace(/,/g, "").trim());
          if (!Number.isFinite(rate) || rate <= 0) {
            nextRow[index] = "";
            continue;
          }
          multiplier = rate;
        }
      }
      nextRow[index] = String(value)
        .split(/([;\n])/)
        .map((part) => {
          if (part === ";" || part === "\n") return part;
          const match = part.match(/^(\s*(?:\d+\.\s*)?)(₹?\s*-?[\d,]+(?:\.\d+)?)(\s*)$/);
          if (!match) return part;
          const amount = Number(match[2].replace(/[₹,\s]/g, ""));
          if (!Number.isFinite(amount)) return part;
          return `${match[1]}${numberFormat.format((amount * multiplier) / 100_000)}${match[3]}`;
        })
        .join("");
    }
    return nextRow;
  });
  return { ...table, rows };
}

function isSearchExportMoneyHeader(header: string) {
  return /\b(value|amount)\b/i.test(header) || /\bactual payment (capital|revenue)\b/i.test(header);
}

type RowwiseFileSearchExportEntry = {
  order?: SupplyOrderDetail;
  orderIndex: number;
  stage?: NonNullable<SupplyOrderDetail["stageDeliveries"]>[number];
  stageIndex: number;
  supplementaryBill?: SupplementaryBillDetail;
  supplementaryBillIndex: number;
  billReturnCycle?: BillReturnCycle;
  billReturnCycleIndex: number;
  isPrimaryOrderRow?: boolean;
};

function getRowwiseFileSearchExportEntries(
  file: FileRecord,
  supplyOrderColumns: ExportColumn[],
): RowwiseFileSearchExportEntry[] {
  const orders = getRawSupplyOrders(file);
  if (!orders.length) {
    return [
      { orderIndex: -1, stageIndex: -1, supplementaryBillIndex: -1, billReturnCycleIndex: -1 },
    ];
  }
  const needsSupplementaryBillRows = supplyOrderColumns.some(
    (column) =>
      isSupplementaryBillExportField(column.key) &&
      column.key !== "supplementaryBillReturnCycles",
  );
  const needsBillReturnRows = supplyOrderColumns.some(
    (column) => column.key === "billReturnCycles",
  );
  const needsSupplementaryReturnRows = supplyOrderColumns.some(
    (column) => column.key === "supplementaryBillReturnCycles",
  );

  return orders.flatMap((order, orderIndex) => {
    const entries: RowwiseFileSearchExportEntry[] = [];
    const needsStageRows = supplyOrderColumns.some((column) =>
      shouldUseStageValueForFileSearchExport(order, column.key),
    );
    if (needsStageRows && order.stageDelivery === "Yes" && order.stageDeliveries?.length) {
      entries.push(
        ...order.stageDeliveries.map((stage, stageIndex) => ({
          order,
          orderIndex,
          stage,
          stageIndex,
          supplementaryBillIndex: -1,
          billReturnCycleIndex: -1,
        })),
      );
    }

    if (needsBillReturnRows) {
      normalizeBillReturnCyclesForExport(order.billReturnCycles).forEach(
        (billReturnCycle, billReturnCycleIndex) => {
          entries.push({
            order,
            orderIndex,
            stageIndex: -1,
            supplementaryBillIndex: -1,
            billReturnCycle,
            billReturnCycleIndex,
          });
        },
      );
    }

    if (needsSupplementaryBillRows || needsSupplementaryReturnRows) {
      normalizeSupplementaryBillsForExport(order.supplementaryBills).forEach(
        (supplementaryBill, supplementaryBillIndex) => {
          const cycles = normalizeBillReturnCyclesForExport(supplementaryBill.billReturnCycles);
          if (cycles.length && needsSupplementaryReturnRows) {
            cycles.forEach((billReturnCycle, billReturnCycleIndex) => {
              entries.push({
                order,
                orderIndex,
                stageIndex: -1,
                supplementaryBill,
                supplementaryBillIndex,
                billReturnCycle,
                billReturnCycleIndex,
              });
            });
            return;
          }
          if (needsSupplementaryBillRows) {
            entries.push({
              order,
              orderIndex,
              stageIndex: -1,
              supplementaryBill,
              supplementaryBillIndex,
              billReturnCycleIndex: -1,
            });
          }
        },
      );
    }

    if (!entries.length) {
      entries.push({
        order,
        orderIndex,
        stageIndex: -1,
        supplementaryBillIndex: -1,
        billReturnCycleIndex: -1,
      });
    }
    return entries.map((entry, index) => ({ ...entry, isPrimaryOrderRow: index === 0 }));
  });
}

function getRowwiseSupplyOrderExportHeaders(column: ExportColumn) {
  if (column.key === "billReturnCycles") {
    return [
      "Bill returned date",
      "Bill return reason",
      "Bill resubmitted date",
      "Bill return remarks",
    ];
  }
  if (column.key === "supplementaryBillReturnCycles") {
    return [
      "Supplementary bill returned date",
      "Supplementary bill return reason",
      "Supplementary bill resubmitted date",
      "Supplementary bill return remarks",
    ];
  }
  if (column.key === "supplementaryBills") {
    return [
      "Supplementary Bill No.",
      "Supplementary bill amount (Capital)",
      "Supplementary bill amount (Revenue)",
      "Supplementary bill sent for payment",
      "Supplementary payment date",
      "Supplementary payment mode",
      "Supplementary actual payment amount (Capital)",
      "Supplementary actual payment amount (Revenue)",
      "Supplementary bill remarks",
    ];
  }
  return [column.label];
}

function getRowwiseSupplyOrderExportValues(
  file: FileRecord,
  key: string,
  entry: RowwiseFileSearchExportEntry,
) {
  if (!entry.order) return getEmptyRowwiseSupplyOrderExportValues(key);
  if (key === "billReturnCycles") return getBillReturnCycleExportValues(entry.billReturnCycle);
  if (key === "supplementaryBillReturnCycles") {
    return getBillReturnCycleExportValues(
      entry.supplementaryBill ? entry.billReturnCycle : undefined,
    );
  }
  if (key === "supplementaryBills") {
    return getSupplementaryBillExportValues(entry.supplementaryBill);
  }
  if (supplementaryBillExportKeys.has(key)) {
    return [
      entry.supplementaryBill
        ? getSupplementaryBillSingleExportValue(entry.supplementaryBill, key)
        : "",
    ];
  }
  if (entry.stage && shouldUseStageValueForFileSearchExport(entry.order, key)) {
    return [String((entry.stage as Record<string, unknown>)[key] ?? "")];
  }
  if (!entry.isPrimaryOrderRow) return [""];
  return [getSupplyOrderExportValue(entry.order, key)];
}

function shouldUseStageValueForFileSearchExport(order: SupplyOrderDetail, key: string) {
  if (!stagedSupplyOrderExportKeys.has(key)) return false;
  if (
    [
      "billPreparationDate",
      "billNo",
      "billSentForPaymentDate",
      "paymentDate",
      "paymentMode",
      "actualPaymentCapital",
      "actualPaymentRevenue",
    ].includes(key)
  ) {
    return order.stagePayment === "Yes";
  }
  return true;
}

function getEmptyRowwiseSupplyOrderExportValues(key: string) {
  if (key === "billReturnCycles" || key === "supplementaryBillReturnCycles") {
    return ["", "", "", ""];
  }
  if (key === "supplementaryBills") return Array.from({ length: 9 }, () => "");
  return [""];
}

function getBillReturnCycleExportValues(cycle: BillReturnCycle | undefined) {
  return [
    cycle?.returnedDate ?? "",
    cycle?.reason ?? "",
    cycle?.resubmittedDate ?? "",
    cycle?.remarks ?? "",
  ];
}

function getSupplementaryBillExportValues(bill: SupplementaryBillDetail | undefined) {
  return [
    bill?.billNo ?? "",
    bill?.billAmountCapital ?? "",
    bill?.billAmountRevenue ?? "",
    bill?.billSentForPaymentDate ?? "",
    bill?.paymentDate ?? "",
    bill?.paymentMode ?? "",
    bill?.actualPaymentCapital ?? "",
    bill?.actualPaymentRevenue ?? "",
    bill?.remarks ?? "",
  ];
}

function getSupplementaryBillSingleExportValue(bill: SupplementaryBillDetail, key: string) {
  if (key === "supplementaryBillNo") return bill.billNo ?? "";
  if (key === "supplementaryBillAmountCapital") return bill.billAmountCapital ?? "";
  if (key === "supplementaryBillAmountRevenue") return bill.billAmountRevenue ?? "";
  if (key === "supplementaryBillSentForPaymentDate") return bill.billSentForPaymentDate ?? "";
  if (key === "supplementaryBillPaymentDate") return bill.paymentDate ?? "";
  if (key === "supplementaryBillPaymentMode") return bill.paymentMode ?? "";
  if (key === "supplementaryBillActualPaymentCapital") return bill.actualPaymentCapital ?? "";
  if (key === "supplementaryBillActualPaymentRevenue") return bill.actualPaymentRevenue ?? "";
  if (key === "supplementaryBillRemarks") return bill.remarks ?? "";
  return "";
}

function isSupplementaryBillExportField(key: string) {
  return key === "supplementaryBills" || supplementaryBillExportKeys.has(key);
}

function isSupplyOrderExportKey(key: string) {
  return (
    key in supplyOrderFields ||
    advancePaymentDetailExportKeys.has(key) ||
    supplementaryBillExportKeys.has(key)
  );
}

function getMainSupplyOrderExportValue(file: FileRecord, key: string, orderIndex: number) {
  const order = getRawSupplyOrders(file)[orderIndex];
  return order ? getSupplyOrderExportValue(order, key) : "";
}

function getStageSupplyOrderExportValue(
  file: FileRecord,
  key: string,
  orderIndex: number,
  stageIndex: number,
) {
  const stage = getRawSupplyOrders(file)[orderIndex]?.stageDeliveries?.[stageIndex];
  return stage ? String((stage as Record<string, unknown>)[key] ?? "") : "";
}

function getSupplyOrderExportValue(order: SupplyOrderDetail, key: string) {
  const advanceValue = getAdvancePaymentDetailExportValue(order, key);
  if (advanceValue !== undefined) return advanceValue;
  const supplementaryValue = getSupplementaryBillExportValue(order.supplementaryBills, key);
  if (supplementaryValue !== undefined) return supplementaryValue;
  if (key === "billReturnCycles") return formatBillReturnCyclesForExport(order.billReturnCycles);
  if (key === "supplementaryBills") {
    return formatSupplementaryBillsForExport(order.supplementaryBills);
  }
  return String((order as Record<string, unknown>)[key] ?? "");
}

function getSupplementaryBillExportValue(
  bills: SupplementaryBillDetail[] | undefined,
  key: string,
) {
  const rows = normalizeSupplementaryBillsForExport(bills);
  if (key === "supplementaryBillNo") return formatSupplementaryBillFieldForExport(rows, "billNo");
  if (key === "supplementaryBillAmountCapital") {
    return formatSupplementaryBillFieldForExport(rows, "billAmountCapital");
  }
  if (key === "supplementaryBillAmountRevenue") {
    return formatSupplementaryBillFieldForExport(rows, "billAmountRevenue");
  }
  if (key === "supplementaryBillSentForPaymentDate") {
    return formatSupplementaryBillFieldForExport(rows, "billSentForPaymentDate");
  }
  if (key === "supplementaryBillReturnCycles") {
    return formatSupplementaryBillReturnCyclesForExport(rows);
  }
  if (key === "supplementaryBillPaymentDate") {
    return formatSupplementaryBillFieldForExport(rows, "paymentDate");
  }
  if (key === "supplementaryBillPaymentMode") {
    return formatSupplementaryBillFieldForExport(rows, "paymentMode");
  }
  if (key === "supplementaryBillActualPaymentCapital") {
    return formatSupplementaryBillFieldForExport(rows, "actualPaymentCapital");
  }
  if (key === "supplementaryBillActualPaymentRevenue") {
    return formatSupplementaryBillFieldForExport(rows, "actualPaymentRevenue");
  }
  if (key === "supplementaryBillRemarks") {
    return formatSupplementaryBillFieldForExport(rows, "remarks");
  }
  return undefined;
}

function normalizeSupplementaryBillsForExport(bills: SupplementaryBillDetail[] | undefined) {
  return (bills ?? []).filter((bill) =>
    [
      bill.billNo,
      bill.billAmountCapital,
      bill.billAmountRevenue,
      bill.billSentForPaymentDate,
      bill.paymentDate,
      bill.paymentMode,
      bill.actualPaymentCapital,
      bill.actualPaymentRevenue,
      bill.remarks,
      formatBillReturnCyclesForExport(bill.billReturnCycles),
    ].some((value) => String(value ?? "").trim()),
  );
}

function normalizeBillReturnCyclesForExport(cycles: BillReturnCycle[] | undefined) {
  return (cycles ?? []).filter((cycle) =>
    [cycle.returnedDate, cycle.reason, cycle.resubmittedDate, cycle.remarks].some((value) =>
      String(value ?? "").trim(),
    ),
  );
}

function formatSupplementaryBillFieldForExport(
  bills: SupplementaryBillDetail[],
  key: keyof SupplementaryBillDetail,
) {
  return bills
    .map((bill, index, rows) => {
      const value = String(bill[key] ?? "").trim();
      if (!value) return "";
      return rows.length > 1 ? `${index + 1}. ${value}` : value;
    })
    .filter(Boolean)
    .join("; ");
}

function formatSupplementaryBillReturnCyclesForExport(bills: SupplementaryBillDetail[]) {
  return bills
    .map((bill, index, rows) => {
      const value = formatBillReturnCyclesForExport(bill.billReturnCycles);
      if (!value) return "";
      return rows.length > 1 ? `${index + 1}. ${value}` : value;
    })
    .filter(Boolean)
    .join("; ");
}

function formatSupplementaryBillsForExport(bills: SupplementaryBillDetail[] | undefined) {
  return normalizeSupplementaryBillsForExport(bills)
    .map((bill, index, rows) => {
      const parts = [
        bill.billNo ? `Bill No.: ${bill.billNo}` : "",
        bill.billAmountCapital ? `Amount capital: ${bill.billAmountCapital}` : "",
        bill.billAmountRevenue ? `Amount revenue: ${bill.billAmountRevenue}` : "",
        bill.billSentForPaymentDate ? `Submitted: ${bill.billSentForPaymentDate}` : "",
        formatBillReturnCyclesForExport(bill.billReturnCycles),
        bill.paymentDate ? `Paid: ${bill.paymentDate}` : "",
        bill.paymentMode ? `Mode: ${bill.paymentMode}` : "",
        bill.actualPaymentCapital ? `Actual capital: ${bill.actualPaymentCapital}` : "",
        bill.actualPaymentRevenue ? `Actual revenue: ${bill.actualPaymentRevenue}` : "",
        bill.remarks ? `Remarks: ${bill.remarks}` : "",
      ].filter(Boolean);
      if (!parts.length) return "";
      return rows.length > 1 ? `${index + 1}. ${parts.join("; ")}` : parts.join("; ");
    })
    .filter(Boolean)
    .join("; ");
}

function formatBillReturnCyclesForExport(cycles: BillReturnCycle[] | undefined) {
  return (cycles ?? [])
    .map((cycle, index, rows) => {
      const parts = [
        cycle.returnedDate ? `Returned: ${cycle.returnedDate}` : "",
        cycle.resubmittedDate ? `Resubmitted: ${cycle.resubmittedDate}` : "",
        cycle.reason ? `Reason: ${cycle.reason}` : "",
        cycle.remarks ? `Remarks: ${cycle.remarks}` : "",
      ].filter(Boolean);
      if (!parts.length) return "";
      return rows.length > 1 ? `${index + 1}. ${parts.join("; ")}` : parts.join("; ");
    })
    .filter(Boolean)
    .join("\n");
}

function getAdvancePaymentDetailExportValue(order: SupplyOrderDetail, key: string) {
  const detail = order.advancePaymentDetail;
  if (!detail) return undefined;
  if (key === "advanceStageAmountCapital") return String(detail.stageAmountCapital ?? "");
  if (key === "advanceStageAmountRevenue") return String(detail.stageAmountRevenue ?? "");
  if (key === "advanceExpectedPaymentDate") return String(detail.expectedPaymentDate ?? "");
  if (key === "advancePaymentDate") return String(detail.paymentDate ?? "");
  if (key === "advanceActualPaymentCapital") return String(detail.actualPaymentCapital ?? "");
  if (key === "advanceActualPaymentRevenue") return String(detail.actualPaymentRevenue ?? "");
  return undefined;
}

function getRawSupplyOrders(file: FileRecord) {
  return normalizedRawSupplyOrders(file);
}

function getFirmCount(rows: FirmDetail[] | undefined) {
  return (rows ?? []).filter((row) =>
    [row.firmName, row.city, row.address, row.emailId, row.firmUniqueNo, row.contactNo].some(
      (value) => String(value ?? "").trim(),
    ),
  ).length;
}

function readExportColumns(value: unknown): ExportColumn[] {
  if (!Array.isArray(value)) throw new HttpError(400, "columns must be an array.");
  return value
    .map((column) => {
      if (!column || typeof column !== "object") return undefined;
      const record = column as Record<string, unknown>;
      if (typeof record.key !== "string" || typeof record.label !== "string") return undefined;
      return { key: record.key, label: record.label };
    })
    .filter((column): column is ExportColumn => Boolean(column));
}

function readFileSearchExportLayout(value: unknown): FileSearchExportLayout {
  return value === "rowwise" ? "rowwise" : "columnwise";
}

function formatFileSearchExportLayout(layout: FileSearchExportLayout) {
  return layout === "rowwise" ? "Rowwise" : "Columnwise";
}

function readQueryString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readDivisionFilterQuery(query: Record<string, unknown>) {
  const value = readQueryString(query.divisionFilter) ?? readQueryString(query.division);
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") return undefined;
  return trimmed;
}

function readQueryDate(value: unknown) {
  const text = readQueryString(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function readQueryBoolean(value: unknown) {
  return value === "true" || value === true;
}

function readIncludeExcludeFilter(
  value: unknown,
  fallback: IncludeExcludeFilter = "none",
): IncludeExcludeFilter {
  return value === "include" || value === "exclude" || value === "none" ? value : fallback;
}

function readDatePresenceMode(value: unknown): DatePresenceMode | undefined {
  return value === "filled" || value === "blank" || value === "yes" || value === "no"
    ? value
    : undefined;
}

function readQueryList(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || !value.trim()) return [];
  let text = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string" && Boolean(item));
      }
      if (typeof parsed === "string" && parsed !== text) {
        text = parsed;
        continue;
      }
    } catch {
      // Fall back to the legacy comma-separated query format below.
    }
    break;
  }
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstOnlyQueryList(
  onlyValues: string[] | undefined,
  fallbackValues: string[] | undefined,
) {
  if (onlyValues?.length) return onlyValues.slice(0, 1);
  return fallbackValues ?? [];
}

function readAnalyticsType(value: unknown) {
  return value === "firm" || value === "indentor" ? value : undefined;
}

function readAnalyticsNameList(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string" && Boolean(item));
    }
  } catch {
    return readQueryList(value);
  }
  return [];
}

function readSearchParams(query: Record<string, unknown>): FileSearchParams {
  return {
    selectedYear: normalizeFinancialYearLabel(readQueryString(query.selectedYear)),
    milestoneClearingScope: readQueryBoolean(query.milestoneClearingScope),
    yearFilter: readQueryString(query.yearFilter),
    fileYear: readQueryString(query.fileYear),
    fileInitiationFrom: readQueryDate(query.fileInitiationFrom),
    fileInitiationTo: readQueryDate(query.fileInitiationTo),
    indentor: readQueryString(query.indentor),
    divisionFilter: readDivisionFilterQuery(query),
    valueFrom: readQueryString(query.valueFrom),
    valueTo: readQueryString(query.valueTo),
    valueThresholdFilter: readQueryString(query.valueThresholdFilter),
    soValueFrom: readQueryString(query.soValueFrom),
    soValueTo: readQueryString(query.soValueTo),
    soValueThresholdFilter: readQueryString(query.soValueThresholdFilter),
    soCapitalOnly: readQueryBoolean(query.soCapitalOnly),
    soRevenueOnly: readQueryBoolean(query.soRevenueOnly),
    capitalOnly: readQueryBoolean(query.capitalOnly),
    revenueOnly: readQueryBoolean(query.revenueOnly),
    description: readQueryString(query.description),
    firm: readQueryString(query.firm),
    firmIdentityUniqueNo: readQueryString(query.firmIdentityUniqueNo),
    firmIdentityName: readQueryString(query.firmIdentityName),
    firmUniqueNo: readQueryString(query.firmUniqueNo),
    firmContactNo: readQueryString(query.firmContactNo),
    firmCity: readQueryString(query.firmCity),
    firmSearchScopes: readQueryList(query.firmSearchScopes),
    soPresenceFilter: readIncludeExcludeFilter(query.soPresenceFilter),
    includeModes: readQueryList(query.includeModes),
    excludeModes: readQueryList(query.excludeModes),
    selectedModes: readQueryList(query.selectedModes),
    modePresenceFilter: readIncludeExcludeFilter(query.modePresenceFilter, "include"),
    includeGemBiddingModes: readQueryList(query.includeGemBiddingModes),
    excludeGemBiddingModes: readQueryList(query.excludeGemBiddingModes),
    selectedGemBiddingModes: readQueryList(query.selectedGemBiddingModes),
    gemModePresenceFilter: readIncludeExcludeFilter(query.gemModePresenceFilter, "include"),
    selectedFirmTypes: readQueryList(query.selectedFirmTypes),
    selectedFileTypes: readQueryList(query.selectedFileTypes),
    selectedBgCoverageTypes: readQueryList(query.selectedBgCoverageTypes),
    specialFileMarker: readQueryString(query.specialFileMarker),
    specialFileMarkers: readQueryList(query.specialFileMarkers),
    fileCategories: readOptionalFileCategories(query.fileCategories),
    advancePaymentFilter: readQueryBoolean(query.advancePaymentFilter),
    actualPaymentFilter: readQueryBoolean(query.actualPaymentFilter),
    stageDeliveryFilter: readQueryBoolean(query.stageDeliveryFilter),
    stagePaymentFilter: readQueryBoolean(query.stagePaymentFilter),
    dpExtensionFilter: readQueryBoolean(query.dpExtensionFilter),
    ldFilter: readQueryBoolean(query.ldFilter),
    highValue: readQueryBoolean(query.highValue),
    gte: readQueryBoolean(query.gte),
    ad: readQueryBoolean(query.ad),
    rqa: readQueryBoolean(query.rqa),
    ifaFilter: readQueryBoolean(query.ifaFilter),
    ifaPresenceFilter: readIncludeExcludeFilter(query.ifaPresenceFilter),
    psbFilter: readQueryBoolean(query.psbFilter),
    pwbFilter: readQueryBoolean(query.pwbFilter),
    psbPwbFilter: readQueryBoolean(query.psbPwbFilter),
    bgFilter: readQueryBoolean(query.bgFilter),
    rfpVettingFilter: readQueryBoolean(query.rfpVettingFilter),
    refloat: readQueryBoolean(query.refloat),
    cnc: readQueryBoolean(query.cnc),
    cncPresenceFilter: readIncludeExcludeFilter(query.cncPresenceFilter),
    tcec: readQueryBoolean(query.tcec),
    preBidMeetingFilter: readQueryBoolean(query.preBidMeetingFilter),
    preTcecCommittee: readQueryString(query.preTcecCommittee),
    postTcecCommittee: readQueryString(query.postTcecCommittee),
    dpFrom: readQueryString(query.dpFrom),
    dpTo: readQueryString(query.dpTo),
    demandReceiptFrom: readQueryString(query.demandReceiptFrom),
    demandReceiptTo: readQueryString(query.demandReceiptTo),
    demandControlFrom: readQueryString(query.demandControlFrom),
    demandControlTo: readQueryString(query.demandControlTo),
    highValueMinutesFrom: readQueryString(query.highValueMinutesFrom),
    highValueMinutesTo: readQueryString(query.highValueMinutesTo),
    preTcecDateFrom: readQueryString(query.preTcecDateFrom),
    preTcecDateTo: readQueryString(query.preTcecDateTo),
    preTcecMinutesFrom: readQueryString(query.preTcecMinutesFrom),
    preTcecMinutesTo: readQueryString(query.preTcecMinutesTo),
    rqaApprovalFrom: readQueryString(query.rqaApprovalFrom),
    rqaApprovalTo: readQueryString(query.rqaApprovalTo),
    ifaFinalFrom: readQueryString(query.ifaFinalFrom),
    ifaFinalTo: readQueryString(query.ifaFinalTo),
    cfaApprovalFrom: readQueryString(query.cfaApprovalFrom),
    cfaApprovalTo: readQueryString(query.cfaApprovalTo),
    postTcecDateFrom: readQueryString(query.postTcecDateFrom),
    postTcecDateTo: readQueryString(query.postTcecDateTo),
    postTcecMinutesFrom: readQueryString(query.postTcecMinutesFrom),
    postTcecMinutesTo: readQueryString(query.postTcecMinutesTo),
    cncDateFrom: readQueryString(query.cncDateFrom),
    cncDateTo: readQueryString(query.cncDateTo),
    preBidDateFrom: readQueryString(query.preBidDateFrom),
    preBidDateTo: readQueryString(query.preBidDateTo),
    biddingDateFrom: readQueryString(query.biddingDateFrom),
    biddingDateTo: readQueryString(query.biddingDateTo),
    bidOpeningDateFrom: readQueryString(query.bidOpeningDateFrom),
    bidOpeningDateTo: readQueryString(query.bidOpeningDateTo),
    billSubmittedFrom: readQueryString(query.billSubmittedFrom),
    billSubmittedTo: readQueryString(query.billSubmittedTo),
    financialSanctionFrom: readQueryString(query.financialSanctionFrom),
    financialSanctionTo: readQueryString(query.financialSanctionTo),
    soDateFrom: readQueryString(query.soDateFrom),
    soDateTo: readQueryString(query.soDateTo),
    advanceExpectedPaymentDateFrom: readQueryString(query.advanceExpectedPaymentDateFrom),
    advanceExpectedPaymentDateTo: readQueryString(query.advanceExpectedPaymentDateTo),
    materialReceiptFrom: readQueryString(query.materialReceiptFrom),
    materialReceiptTo: readQueryString(query.materialReceiptTo),
    actualJobCompletionFrom: readQueryString(query.actualJobCompletionFrom),
    actualJobCompletionTo: readQueryString(query.actualJobCompletionTo),
    paymentDateFrom: readQueryString(query.paymentDateFrom),
    paymentDateTo: readQueryString(query.paymentDateTo),
    bgReceivedFrom: readQueryString(query.bgReceivedFrom),
    bgReceivedTo: readQueryString(query.bgReceivedTo),
    bgValidityFrom: readQueryString(query.bgValidityFrom),
    bgValidityTo: readQueryString(query.bgValidityTo),
    bgReturnFrom: readQueryString(query.bgReturnFrom),
    bgReturnTo: readQueryString(query.bgReturnTo),
    fileClosureFrom: readQueryString(query.fileClosureFrom),
    fileClosureTo: readQueryString(query.fileClosureTo),
    dateFilterModes: readQueryList(query.dateFilterModes),
    fileClosedPresenceFilter: readIncludeExcludeFilter(query.fileClosedPresenceFilter),
    rstFilter: readQueryBoolean(query.rstFilter),
    soCancelledPresenceFilter: readIncludeExcludeFilter(query.soCancelledPresenceFilter),
    shortclosedSoPresenceFilter: readIncludeExcludeFilter(query.shortclosedSoPresenceFilter),
    multipleSupplyOrdersPresenceFilter: readIncludeExcludeFilter(
      query.multipleSupplyOrdersPresenceFilter,
    ),
    freeText: readQueryString(query.freeText),
    freeDate: readQueryString(query.freeDate),
    dashboardFilter: readQueryString(query.dashboardFilter),
    extraDashboardFilters: readQueryList(query.extraDashboardFilters),
    excludeDashboardFilters: readQueryList(query.excludeDashboardFilters),
    analyticsType: readAnalyticsType(query.analyticsType),
    analyticsNames: readAnalyticsNameList(query.analyticsNames),
    sortColumnKey: readQueryString(query.sortColumnKey),
    sortDirection: readQueryString(query.sortDirection) === "desc" ? "desc" : "asc",
    divisionWiseSort: readQueryBoolean(query.divisionWiseSort),
    requiredFilledFields: readQueryList(query.requiredFilledFields),
    anomalyPresenceFilter:
      readQueryString(query.anomalyPresenceFilter) === "has" ||
      readQueryString(query.anomalyPresenceFilter) === "none"
        ? (readQueryString(query.anomalyPresenceFilter) as "has" | "none")
        : undefined,
    anomalyFileIds: readQueryList(query.anomalyFileIds),
    anomalyFileIdsReady: readQueryBoolean(query.anomalyFileIdsReady),
    datePresenceField: readQueryString(query.datePresenceField),
    datePresenceMode: readDatePresenceMode(query.datePresenceMode),
    fieldConditionYesNoFields: readQueryList(query.fieldConditionYesNoFields),
    fieldConditionYesNoMode: readDatePresenceMode(query.fieldConditionYesNoMode),
    fieldConditionPresenceFields: readQueryList(query.fieldConditionPresenceFields),
    fieldConditionPresenceMode: readDatePresenceMode(query.fieldConditionPresenceMode),
  };
}

function readOptionalFileCategories(value: unknown) {
  if (readQueryString(value) === undefined) return undefined;
  const rawFileCategories = readQueryList(value);
  if (!rawFileCategories.length) return undefined;
  return normalizeFileCategories(rawFileCategories);
}

function readPositiveInteger(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function isYesSql(expression: string) {
  return `lower(coalesce(${expression}, '')) in ('yes', 'y')`;
}

function isNoSql(expression: string) {
  return `lower(coalesce(${expression}, '')) = 'no'`;
}

function hasTextSql(expression: string) {
  return `coalesce(${expression}::text, '') <> ''`;
}

function fileCategorySql(categories: FileCategoryKey[]) {
  return getFileCategorySqlCondition(categories);
}

function selectedFileTypesSql(selectedFileTypes: string[], values: unknown[]) {
  const normalizedFileTypes = selectedFileTypes
    .map((fileType) => fileType.trim().toLowerCase())
    .filter(Boolean);
  if (!normalizedFileTypes.length) return undefined;

  const predicates: string[] = [];
  if (normalizedFileTypes.includes("goods & services")) {
    predicates.push(`lower(trim(coalesce(f.file_type, ''))) in ('', 'goods & services')`);
  }

  const exactFileTypes = normalizedFileTypes.filter((fileType) => fileType !== "goods & services");
  if (exactFileTypes.length) {
    const placeholder = addSqlValue(values, Array.from(new Set(exactFileTypes)));
    predicates.push(`lower(trim(coalesce(f.file_type, ''))) = any(${placeholder}::text[])`);
  }

  return predicates.length ? `(${predicates.join(" or ")})` : undefined;
}

function bidOpeningOverdueSql(today = "current_date") {
  const openingDate = `(case when ${isYesSql("f.refloat")}
    then f.refloat_bid_opening_date else f.bid_opening_date end)`;
  return `${biddingApplicableSql()} and ${isNoSql("f.bid_opened")} and ${openingDate} is not null and ${openingDate} < ${today}`;
}

function refloatBiddingInProgressSql() {
  return `${biddingApplicableSql()}
    and ${isYesSql("f.refloat")}
    and ${hasTextSql("f.refloat_bidding_date")}
    and not ${isYesSql("f.bidding_stage_over")}`;
}

function refloatBidLiveSql() {
  return `${biddingApplicableSql()}
    and ${isYesSql("f.refloat")}
    and ${hasTextSql("f.refloat_bidding_date")}
    and ${hasTextSql("f.refloat_bid_opening_date")}
    and current_date between f.refloat_bidding_date and f.refloat_bid_opening_date`;
}

function normalBidLiveSql() {
  return `${biddingApplicableSql()}
    and not ${isYesSql("f.refloat")}
    and ${hasTextSql("f.bid_date")}
    and ${hasTextSql("f.bid_opening_date")}
    and current_date between f.bid_date and f.bid_opening_date`;
}

function refloatBidOpeningOverdueSql(today = "current_date") {
  return `${isNoSql("f.bid_opened")} and f.refloat_bid_opening_date is not null and f.refloat_bid_opening_date < ${today}`;
}

function normalizedSql(expression: string) {
  return `regexp_replace(lower(coalesce(${expression}, '')), '[^a-z0-9]+', '', 'g')`;
}

function fileClosedSql() {
  return completedMilestoneExists(`${normalizedSql("completed.milestone")} = 'fileclosed'`);
}

function getFinancialYearDateRange(financialYear: string | undefined) {
  const match = (financialYear ?? "").match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return undefined;
  const startYear = Number(match[1]);
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

function getReportFiscalYearDateRange(yearKey: string) {
  const match = yearKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return undefined;
  const startYear = Number(match[1]);
  if (Number(match[2]) !== (startYear + 1) % 100) return undefined;
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

function activeFilesSql() {
  return `(not ${fileClosedSql()}
    and lower(coalesce(f.demand_cancelled, '')) <> 'yes'
    and not ${allSupplyOrdersCancelledSql()})`;
}

function activePlusCurrentFyClosedSql(values: unknown[], financialYear: string | undefined) {
  const range = getFinancialYearDateRange(financialYear);
  if (!range) return activeFilesSql();
  const start = addSqlValue(values, range.start);
  const end = addSqlValue(values, range.end);
  return `(${activeFilesSql()} or (${fileClosedSql()}
    and f.file_closure_date between ${start}::date and ${end}::date
    and lower(coalesce(f.demand_cancelled, '')) <> 'yes'))`;
}

function specificFinancialYearSql(values: unknown[], financialYear: string | undefined) {
  const normalizedYear = normalizeFinancialYearLabel(financialYear);
  const range = getFinancialYearDateRange(normalizedYear);
  if (!normalizedYear || !range) return "true";
  const yearPlaceholder = addSqlValue(values, normalizedYear);
  const startPlaceholder = addSqlValue(values, range.start);
  const startYear = Number(range.start.slice(0, 4));
  return `(f.year = ${yearPlaceholder}::text or exists (
      select 1 from file_year_activity a
      where a.file_id = f.id and a.financial_year = ${yearPlaceholder}::text and a.status = 'active'
    ) or (
      nullif(substring(coalesce(f.year, '') from '(19[0-9]{2}|20[0-9]{2})'), '')::integer <= ${startYear}
      and lower(coalesce(f.demand_cancelled, '')) <> 'yes'
      and not ${allSupplyOrdersCancelledSql()}
      and (not ${fileClosedSql()} or f.file_closure_date >= ${startPlaceholder}::date)
    ))`;
}

function sqlLike(query: string) {
  return `%${query.trim().toLowerCase()}%`;
}

function isValidDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function parseSearchAmount(value: string | undefined) {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function addSqlValue(values: unknown[], value: unknown) {
  values.push(value);
  return `$${values.length}`;
}

function supplyOrderExists(condition: string) {
  return `exists (select 1 from supply_orders so where so.file_id = f.id and (${condition}))`;
}

function multipleSupplyOrdersSql() {
  return `(
    select count(*)
    from supply_orders so_multiple
    where so_multiple.file_id = f.id
  ) > 1`;
}

function earliestSupplyOrderDateSql(column: string) {
  return `case
    when ${supplyOrderExists(`so.${column} is not null`)} then (
      select min(so_date_value.${column})
      from supply_orders so_date_value
      where so_date_value.file_id = f.id and so_date_value.${column} is not null
    )
    else f.${column}
  end`;
}

function nonNegativeDateDiffSql(startDate: string, endDate: string) {
  return `(${startDate}) is not null and (${endDate}) is not null and ((${endDate}) - (${startDate})) >= 0`;
}

function applyIncludeExcludeSql(
  conditions: string[],
  filter: IncludeExcludeFilter | undefined,
  condition: string,
) {
  if (filter === "include") conditions.push(condition);
  if (filter === "exclude") conditions.push(`not (${condition})`);
}

const demandProcessingFileDateColumns: Record<string, string> = {
  receivedDate: "received_date",
  date: "date",
  demandCancelledDate: "demand_cancelled_date",
  fileClosureDate: "file_closure_date",
  scrutinyDate: "scrutiny_date",
  scrutinyResponseDate: "scrutiny_response_date",
  scrutinyCompletionDate: "scrutiny_completion_date",
  immsDate: "imms_date",
  highValueMeetingDate: "high_value_meeting_date",
  highValueMinutesDate: "high_value_minutes_date",
  preTcecDate: "pre_tcec_date",
  preTcecMinutesDate: "pre_tcec_minutes_date",
  postTcecDate: "post_tcec_date",
  postTcecMinutesDate: "post_tcec_minutes_date",
  refloatPostTcecDate: "refloat_post_tcec_date",
  refloatPostTcecMinutesDate: "refloat_post_tcec_minutes_date",
  adSentDate: "ad_sent_date",
  adVettingDate: "ad_vetting_date",
  rqaSentDate: "rqa_sent_date",
  rqaApprovalDate: "rqa_approval_date",
  ifaSentDate: "ifa_sent_date",
  ifaFinalDate: "ifa_final_date",
  cfaSentDate: "cfa_sent_date",
  cfaDate: "cfa_date",
  gemUndertakingDate: "gem_undertaking_date",
  refloatGemUndertakingDate: "refloat_gem_undertaking_date",
  refloatRecommendationDate: "refloat_recommendation_date",
  rfpVettingInitiationDate: "rfp_vetting_initiation_date",
  rfpVettingApprovalDate: "rfp_vetting_approval_date",
  preBidMeetingDate: "pre_bid_meeting_date",
  bidDate: "bid_date",
  bidOpeningDate: "bid_opening_date",
  refloatPreBidMeetingDate: "refloat_pre_bid_meeting_date",
  refloatBiddingDate: "refloat_bidding_date",
  refloatBidOpeningDate: "refloat_bid_opening_date",
  cncDate: "cnc_date",
  cncApprovalDate: "cnc_approval_date",
};

const demandProcessingOrderDateColumns: Record<string, string> = {
  financialSanctionDate: "financial_sanction_date",
  soDate: "so_date",
  dpDate: "dp_date",
  revisedDp: "revised_dp",
  psbBgReceivedDate: "psb_bg_received_date",
  psbBgValidityDate: "psb_bg_validity_date",
  psbBgReturnDate: "psb_bg_return_date",
  pwbBgReceivedDate: "pwb_bg_received_date",
  pwbBgValidityDate: "pwb_bg_validity_date",
  pwbBgReturnDate: "pwb_bg_return_date",
  combinedBgReceivedDate: "combined_bg_received_date",
  combinedBgValidityDate: "combined_bg_validity_date",
  combinedBgReturnDate: "combined_bg_return_date",
  warrantyPeriodDate: "warranty_period_date",
  materialReceiptDate: "material_receipt_date",
  actualJobCompletionDate: "actual_job_completion_date",
  jobCompletionDate: "job_completion_date",
  irPreparationDate: "ir_preparation_date",
  irReceiptDate: "ir_receipt_date",
  billPreparationDate: "bill_preparation_date",
  billSentForPaymentDate: "bill_sent_for_payment_date",
  paymentDate: "payment_date",
  soCancelledDate: "so_cancelled_date",
};

function demandProcessingFilterSql(filter: string) {
  const [, rawFrom = "", rawTo = "", mode = "used"] = filter.split(":");
  const fromFieldId = decodeFilterPart(rawFrom);
  const toFieldId = decodeFilterPart(rawTo);
  const scope = demandProcessingScope(fromFieldId, toFieldId);
  if (!scope || (mode !== "used" && mode !== "reverse")) return "false";

  if (scope === "file") {
    const fromExpression = demandProcessingDateExpression(fromFieldId);
    const toExpression = demandProcessingDateExpression(toFieldId);
    if (!fromExpression || !toExpression) return "false";
    return demandProcessingDatePairCondition(fromExpression, toExpression, mode);
  }

  if (scope === "stage") {
    const fromExpression = demandProcessingDateExpression(fromFieldId, "so", "stage_delivery");
    const toExpression = demandProcessingDateExpression(toFieldId, "so", "stage_delivery");
    if (!fromExpression || !toExpression) return "false";
    return supplyOrderExists(
      `not ${isYesSql("so.so_cancelled")}
       and exists (
         select 1
         from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_delivery(stage)
         where ${demandProcessingDatePairCondition(fromExpression, toExpression, mode)}
       )`,
    );
  }

  const fromExpression = demandProcessingDateExpression(fromFieldId);
  const toExpression = demandProcessingDateExpression(toFieldId);
  if (!fromExpression || !toExpression) return "false";
  return supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")}
     and ${demandProcessingDatePairCondition(fromExpression, toExpression, mode)}`,
  );
}

function decodeFilterPart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function demandProcessingScope(...fieldIds: string[]) {
  const scopes = fieldIds.map((fieldId) => fieldId.split(".")[0]);
  if (scopes.some((scope) => scope === "stage")) return "stage";
  if (scopes.some((scope) => scope === "advance")) return "advance";
  if (scopes.some((scope) => scope === "order")) return "order";
  if (scopes.every((scope) => scope === "file")) return "file";
  return undefined;
}

function demandProcessingDateExpression(
  fieldId: string,
  orderAlias = "so",
  stageAlias = "stage_delivery",
) {
  const [scope, key] = fieldId.split(".");
  if (!scope || !key) return undefined;
  if (scope === "file") {
    const column = demandProcessingFileDateColumns[key];
    return column ? `f.${column}` : undefined;
  }
  if (scope === "order") {
    const column = demandProcessingOrderDateColumns[key];
    return column ? `${orderAlias}.${column}` : undefined;
  }
  if (scope === "stage") {
    return `(nullif(${stageAlias}.stage ->> '${key.replace(/'/g, "''")}', '')::date)`;
  }
  if (scope === "advance") {
    return `(nullif(${orderAlias}.advance_payment_detail ->> '${key.replace(/'/g, "''")}', '')::date)`;
  }
  return undefined;
}

function demandProcessingDatePairCondition(
  fromExpression: string,
  toExpression: string,
  mode: string,
) {
  const base = `${fromExpression} is not null and ${toExpression} is not null`;
  return mode === "reverse" ? `${base} and ${toExpression} < ${fromExpression}` : base;
}

function supplyOrderDateRangeSql(
  column: string,
  from: string | undefined,
  to: string | undefined,
  values: unknown[],
) {
  if (!isValidDate(from) && !isValidDate(to)) return undefined;
  const dateConditions: string[] = [];
  if (isValidDate(from)) {
    const placeholder = addSqlValue(values, from);
    dateConditions.push(`so.${column} >= ${placeholder}::date`);
  }
  if (isValidDate(to)) {
    const placeholder = addSqlValue(values, to);
    dateConditions.push(`so.${column} <= ${placeholder}::date`);
  }
  return supplyOrderExists(dateConditions.join(" and "));
}

export function supplyOrderActualJobCompletionDateRangeSql(
  from: string | undefined,
  to: string | undefined,
  values: unknown[],
) {
  if (!isValidDate(from) && !isValidDate(to)) return undefined;
  const parentConditions: string[] = [];
  const stageConditions: string[] = [];
  if (isValidDate(from)) {
    const placeholder = `${addSqlValue(values, from)}::date`;
    parentConditions.push(`so.actual_job_completion_date >= ${placeholder}`);
    stageConditions.push(`nullif(btrim(actual_completion_stage.stage ->> 'actualJobCompletionDate'), '')::date >= ${placeholder}`);
  }
  if (isValidDate(to)) {
    const placeholder = `${addSqlValue(values, to)}::date`;
    parentConditions.push(`so.actual_job_completion_date <= ${placeholder}`);
    stageConditions.push(`nullif(btrim(actual_completion_stage.stage ->> 'actualJobCompletionDate'), '')::date <= ${placeholder}`);
  }
  return supplyOrderExists(`(
    (${parentConditions.join(" and ")})
    or exists (
      select 1
      from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as actual_completion_stage(stage)
      where ${stageConditions.join(" and ")}
    )
  )`);
}

function supplyOrderAnyDateRangeSql(
  columns: string[],
  from: string | undefined,
  to: string | undefined,
  values: unknown[],
) {
  if (!isValidDate(from) && !isValidDate(to)) return undefined;
  return supplyOrderExists(
    columns
      .map((column) => {
        const dateConditions: string[] = [];
        if (isValidDate(from)) {
          const placeholder = addSqlValue(values, from);
          dateConditions.push(`so.${column} >= ${placeholder}::date`);
        }
        if (isValidDate(to)) {
          const placeholder = addSqlValue(values, to);
          dateConditions.push(`so.${column} <= ${placeholder}::date`);
        }
        return `(${dateConditions.join(" and ")})`;
      })
      .join(" or "),
  );
}

function supplyOrderAnyDatePresenceSql(columns: string[]) {
  return supplyOrderExists(columns.map((column) => hasTextSql(`so.${column}`)).join(" or "));
}

function fileDateRangeSql(
  expression: string,
  from: string | undefined,
  to: string | undefined,
  values: unknown[],
) {
  if (!isValidDate(from) && !isValidDate(to)) return undefined;
  const dateConditions: string[] = [];
  if (isValidDate(from)) {
    const placeholder = addSqlValue(values, from);
    dateConditions.push(`${expression} >= ${placeholder}::date`);
  }
  if (isValidDate(to)) {
    const placeholder = addSqlValue(values, to);
    dateConditions.push(`${expression} <= ${placeholder}::date`);
  }
  return dateConditions.join(" and ");
}

function effectiveFirmTypeSql(orderAlias: string) {
  const firmType = `trim(coalesce(${orderAlias}.firm_type, ''))`;
  const firmTypeOther = `trim(coalesce(${orderAlias}.firm_type_other, ''))`;
  return `upper(case
    when upper(${firmType}) = 'OTHER' then coalesce(nullif(${firmTypeOther}, ''), ${firmType})
    when ${firmType} <> '' then ${firmType}
    else ${firmTypeOther}
  end)`;
}

function fileAnyDateRangeSql(
  expressions: string[],
  from: string | undefined,
  to: string | undefined,
  values: unknown[],
) {
  if (!isValidDate(from) && !isValidDate(to)) return undefined;
  return `(${expressions
    .map((expression) => `(${fileDateRangeSql(expression, from, to, values)})`)
    .join(" or ")})`;
}

function dateExpressionRangeSql(
  expression: string,
  from: string | undefined,
  to: string | undefined,
  values: unknown[],
) {
  if (!isValidDate(from) && !isValidDate(to)) return undefined;
  const dateConditions: string[] = [];
  if (isValidDate(from)) {
    const placeholder = addSqlValue(values, from);
    dateConditions.push(`${expression} >= ${placeholder}::date`);
  }
  if (isValidDate(to)) {
    const placeholder = addSqlValue(values, to);
    dateConditions.push(`${expression} <= ${placeholder}::date`);
  }
  return dateConditions.join(" and ");
}

function billReturnResubmissionDateRangeSql(
  source: string,
  from: string | undefined,
  to: string | undefined,
  values: unknown[],
) {
  const rangeSql = dateExpressionRangeSql(
    "nullif(bill_return.cycle ->> 'resubmittedDate', '')::date",
    from,
    to,
    values,
  );
  if (!rangeSql) return undefined;
  return `exists (
    select 1
    from jsonb_array_elements(coalesce(${source}, '[]'::jsonb)) as bill_return(cycle)
    where ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
      and ${rangeSql}
  )`;
}

function billSubmissionEventDateRangeSql(
  from: string | undefined,
  to: string | undefined,
  values: unknown[],
) {
  if (!isValidDate(from) && !isValidDate(to)) return undefined;
  const mainSent = dateExpressionRangeSql("so.bill_sent_for_payment_date", from, to, values);
  const mainResubmitted = billReturnResubmissionDateRangeSql(
    "so.bill_return_cycles",
    from,
    to,
    values,
  );
  const stageSent = dateExpressionRangeSql(
    "nullif(stage_row.stage ->> 'billSentForPaymentDate', '')::date",
    from,
    to,
    values,
  );
  const stageResubmitted = billReturnResubmissionDateRangeSql(
    "stage_row.stage -> 'billReturnCycles'",
    from,
    to,
    values,
  );
  const advanceSent = dateExpressionRangeSql(
    "nullif(so.advance_payment_detail ->> 'billSentForPaymentDate', '')::date",
    from,
    to,
    values,
  );
  const advanceResubmitted = billReturnResubmissionDateRangeSql(
    "so.advance_payment_detail -> 'billReturnCycles'",
    from,
    to,
    values,
  );
  const supplementarySent = dateExpressionRangeSql(
    "nullif(supplementary_bill.bill ->> 'billSentForPaymentDate', '')::date",
    from,
    to,
    values,
  );
  const supplementaryResubmitted = billReturnResubmissionDateRangeSql(
    "supplementary_bill.bill -> 'billReturnCycles'",
    from,
    to,
    values,
  );
  const conditions = [
    mainSent,
    mainResubmitted,
    advanceSent,
    advanceResubmitted,
    stageSent
      ? `exists (
        select 1
        from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
        where ${hasTextSql("stage_row.stage ->> 'billSentForPaymentDate'")}
          and ${stageSent}
      )`
      : undefined,
    stageResubmitted
      ? `exists (
        select 1
        from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
        where ${stageResubmitted}
      )`
      : undefined,
    supplementarySent || supplementaryResubmitted
      ? `exists (
        select 1
        from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
        where ${[supplementarySent, supplementaryResubmitted].filter(Boolean).join(" or ")}
      )`
      : undefined,
  ].filter((condition): condition is string => Boolean(condition));
  return conditions.length ? supplyOrderExists(`(${conditions.join(" or ")})`) : undefined;
}

function paymentEventDateRangeSql(
  from: string | undefined,
  to: string | undefined,
  values: unknown[],
) {
  if (!isValidDate(from) && !isValidDate(to)) return undefined;
  const mainPayment = dateExpressionRangeSql("so.payment_date", from, to, values);
  const stagePayment = dateExpressionRangeSql(
    "nullif(stage_row.stage ->> 'paymentDate', '')::date",
    from,
    to,
    values,
  );
  const advancePayment = dateExpressionRangeSql(
    "nullif(so.advance_payment_detail ->> 'paymentDate', '')::date",
    from,
    to,
    values,
  );
  const supplementaryPayment = dateExpressionRangeSql(
    "nullif(supplementary_bill.bill ->> 'paymentDate', '')::date",
    from,
    to,
    values,
  );
  const conditions = [
    mainPayment,
    advancePayment,
    stagePayment
      ? `exists (
        select 1
        from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
        where ${hasTextSql("stage_row.stage ->> 'paymentDate'")}
          and ${stagePayment}
      )`
      : undefined,
    supplementaryPayment
      ? `exists (
        select 1
        from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
        where ${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")}
          and ${supplementaryPayment}
      )`
      : undefined,
  ].filter((condition): condition is string => Boolean(condition));
  return conditions.length ? supplyOrderExists(`(${conditions.join(" or ")})`) : undefined;
}

function billSubmissionEventPresenceSql() {
  const returnedSubmission = (cycles: string) =>
    `exists (
      select 1
      from jsonb_array_elements(coalesce(${cycles}, '[]'::jsonb)) as bill_return(cycle)
      where ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
    )`;
  const stageSubmission = `exists (
    select 1
    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
    where ${hasTextSql("stage_row.stage ->> 'billSentForPaymentDate'")}
      or ${returnedSubmission("stage_row.stage -> 'billReturnCycles'")}
  )`;
  const supplementarySubmission = `exists (
    select 1
    from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
    where ${hasTextSql("supplementary_bill.bill ->> 'billSentForPaymentDate'")}
      or ${returnedSubmission("supplementary_bill.bill -> 'billReturnCycles'")}
  )`;
  return supplyOrderExists(`
    ${hasTextSql("so.bill_sent_for_payment_date")}
    or ${returnedSubmission("so.bill_return_cycles")}
    or ${hasTextSql("so.advance_payment_detail ->> 'billSentForPaymentDate'")}
    or ${returnedSubmission("so.advance_payment_detail -> 'billReturnCycles'")}
    or ${stageSubmission}
    or ${supplementarySubmission}
  `);
}

function paymentEventDatePresenceSql() {
  const stagePayment = `exists (
    select 1
    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
    where ${hasTextSql("stage_row.stage ->> 'paymentDate'")}
  )`;
  const supplementaryPayment = `exists (
    select 1
    from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
    where ${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")}
  )`;
  return supplyOrderExists(`
    ${hasTextSql("so.payment_date")}
    or ${hasTextSql("so.advance_payment_detail ->> 'paymentDate'")}
    or ${stagePayment}
    or ${supplementaryPayment}
  `);
}

function supplyOrderRowExists() {
  return "exists (select 1 from supply_orders so_existing where so_existing.file_id = f.id)";
}

function supplyOrderCountSql() {
  return `(select count(*)
    from supply_orders so_count
    where so_count.file_id = f.id)`;
}

function supplyOrderChildSql(childCondition: string, _unusedFileLevelCondition?: string) {
  return supplyOrderExists(childCondition);
}

function supplyOrderValueCompleteSql(orderAlias: string) {
  return `(case
    when coalesce(f.value_capital, 0) <> 0 then ${hasTextSql(`${orderAlias}.so_value_capital`)}
    when coalesce(f.value_revenue, 0) <> 0 then ${hasTextSql(`${orderAlias}.so_value_revenue`)}
    else (${hasTextSql(`${orderAlias}.so_value_capital`)} or ${hasTextSql(`${orderAlias}.so_value_revenue`)})
  end)`;
}

function supplyOrderTabCompleteSql(orderAlias: string) {
  return `${hasTextSql(`${orderAlias}.so_no`)}
    and (${isNoSql("f.gem")} or ${hasTextSql(`${orderAlias}.gem_so_no`)})
    and ${hasTextSql(`${orderAlias}.so_date`)}
    and ${supplyOrderValueCompleteSql(orderAlias)}
    and ${hasTextSql(`${orderAlias}.firm`)}
    and ${hasTextSql(`${orderAlias}.firm_type`)}
    and (upper(trim(coalesce(${orderAlias}.firm_type, ''))) <> 'OTHER' or ${hasTextSql(`${orderAlias}.firm_type_other`)})
    and (${isYesSql(`${orderAlias}.stage_delivery`)} or ${isNoSql(`${orderAlias}.stage_delivery`)})
    and (
      not ${isYesSql(`${orderAlias}.stage_delivery`)}
      or (
        ${hasTextSql(`${orderAlias}.stage_delivery_count`)}
        and (${isYesSql(`${orderAlias}.stage_payment`)} or ${isNoSql(`${orderAlias}.stage_payment`)})
      )
    )
    and (
      not (${isYesSql(`${orderAlias}.stage_delivery`)} and ${isYesSql(`${orderAlias}.stage_payment`)})
      or (${isYesSql(`${orderAlias}.advance_payment`)} or ${isNoSql(`${orderAlias}.advance_payment`)})
    )`;
}

function supplyOrderPendingOrderSql(orderAlias: string) {
  return `${financialSanctionCompletedOrderSql(orderAlias)}
    and not (${supplyOrderTabCompleteSql(orderAlias)})
    and not ${isYesSql(`${orderAlias}.no_further_action`)}
    and not ${isYesSql(`${orderAlias}.so_cancelled`)}`;
}

function effectiveDpDateSql(alias: string) {
  return `coalesce(${alias}.revised_dp, ${alias}.dp_date)`;
}

function supplyOrderValueTotalSql(capitalOnly: boolean, revenueOnly: boolean) {
  return supplyOrderValueTotalWhereSql(capitalOnly, revenueOnly, "true");
}

function supplyOrderValueTotalWhereSql(
  capitalOnly: boolean,
  revenueOnly: boolean,
  orderCondition: string,
) {
  const includeCapital = !revenueOnly || capitalOnly;
  const includeRevenue = !capitalOnly || revenueOnly;
  const valueParts = [
    includeCapital ? "coalesce(so.so_value_capital, 0)" : undefined,
    includeRevenue ? "coalesce(so.so_value_revenue, 0)" : undefined,
  ].filter((condition): condition is string => Boolean(condition));
  const orderValueSql = valueParts.join(" + ") || "0";
  return `coalesce((
    select sum(${orderValueSql})
    from supply_orders so
    where so.file_id = f.id
      and ${orderCondition}
  ), 0)`;
}

function hasSupplyOrderValueSql(capitalOnly: boolean, revenueOnly: boolean) {
  const includeCapital = !revenueOnly || capitalOnly;
  const includeRevenue = !capitalOnly || revenueOnly;
  const orderConditions = [
    includeCapital ? "so.so_value_capital is not null" : undefined,
    includeRevenue ? "so.so_value_revenue is not null" : undefined,
  ].filter((condition): condition is string => Boolean(condition));
  return supplyOrderExists(orderConditions.join(" or ") || "false");
}

function completedMilestoneExists(condition: string) {
  return `exists (
    select 1 from file_completed_milestones completed
    where completed.file_id = f.id and ${condition}
  )`;
}

function supplyOrderTextExpression(column: string) {
  return `(select string_agg(coalesce(so.${column}::text, ''), ' ' order by so.sort_order, so.id)
    from supply_orders so
    where so.file_id = f.id)`;
}

function concatSearchExpressions(expressions: string[], chunkSize = 50) {
  if (expressions.length === 0) return "''";
  const chunks: string[] = [];
  for (let index = 0; index < expressions.length; index += chunkSize) {
    chunks.push(`concat_ws(' ', ${expressions.slice(index, index + chunkSize).join(", ")})`);
  }
  return chunks.length === 1 ? chunks[0] : `concat_ws(' ', ${chunks.join(", ")})`;
}

function freeSearchTextExpression() {
  const fileTextColumns = Object.values(fileSearchColumns).map(
    (column) => `coalesce(${column}::text, '')`,
  );

  return concatSearchExpressions([
    ...fileTextColumns,
    `
    coalesce((
      select string_agg(concat_ws(' ',
        so.so_no,
        so.gem_so_no,
        so.so_date,
        so.so_value_capital,
        so.so_value_revenue,
        so.dp_date,
        so.firm,
        so.firm_type,
        so.firm_type_other,
        so.dp_extension,
        so.dp_extension_count,
        so.ld,
        so.revised_dp,
        so.material_receipt_date,
        so.bill_sent_for_payment_date,
        so.payment_date,
        so.payment_mode,
        so.demand_cancelled,
        so.so_cancelled,
        so.so_cancelled_date
      ), ' ' order by so.sort_order, so.id)
      from supply_orders so
      where so.file_id = f.id
    ), ''),
    coalesce((
      select string_agg(concat_ws(' ', ff.firm_name, ff.city, ff.address, ff.email_id, ff.firm_unique_no, ff.contact_no), ' ' order by ff.sort_order, ff.id)
      from file_firms ff
      where ff.file_id = f.id
    ), ''),
    coalesce((
      select string_agg(concat_ws(' ', fr.section, fr.text), ' ' order by fr.created_at, fr.id)
      from file_remarks fr
      where fr.file_id = f.id
    ), ''),
    coalesce((
      select string_agg(fm.text, ' ' order by fm.sort_order, fm.created_at, fm.id)
      from file_markers fm
      where fm.file_id = f.id
    ), ''),
    coalesce((
      select string_agg(completed.milestone, ' ' order by completed.milestone)
      from file_completed_milestones completed
      where completed.file_id = f.id
    ), ''),
    coalesce((
      select string_agg(activity.financial_year, ' ' order by activity.financial_year)
      from file_year_activity activity
      where activity.file_id = f.id and activity.status = 'active'
    ), '')`,
  ]);
}

const fileSearchColumns = {
  title: "f.title",
  division: "d.name",
  officer: "f.officer",
  imms: "f.imms",
  date: "f.file_date",
  year: "f.year",
  uniqueCode: "f.unique_code",
  receivedDate: "f.received_date",
  scrutinyDate: "f.scrutiny_date",
  scrutinyResponseDate: "f.scrutiny_response_date",
  scrutinyCompletionDate: "f.scrutiny_completion_date",
  immsDate: "f.imms_date",
  fileNo: "f.file_no",
  indentor: "f.indentor",
  demandDescription: "f.demand_description",
  valueCapital: "f.value_capital",
  valueRevenue: "f.value_revenue",
  currency: "f.currency",
  exchangeRate: "f.exchange_rate",
  gte: "f.gte",
  tcec: "f.tcec",
  fileType: "f.file_type",
  mode: "f.mode",
  gem: "f.gem",
  gemBiddingMode: "f.gem_bidding_mode",
  highValue: "f.high_value",
  ad: "f.ad",
  rqa: "f.rqa",
  ifa: "f.ifa",
  psb: "f.psb",
  bg: "f.bg",
  ir: "f.ir",
  rfpVetting: "f.rfp_vetting",
  highValueMeetingDate: "f.high_value_meeting_date",
  highValueMinutesDate: "f.high_value_minutes_date",
  adSentDate: "f.ad_sent_date",
  preTcecDate: "f.pre_tcec_date",
  preTcecMinutesDate: "f.pre_tcec_minutes_date",
  preTcecCommitteeNo: "f.pre_tcec_committee_no",
  adVettingDate: "f.ad_vetting_date",
  rqaSentDate: "f.rqa_sent_date",
  rqaApprovalDate: "f.rqa_approval_date",
  ifaSentDate: "f.ifa_sent_date",
  ifaFinalDate: "f.ifa_final_date",
  cfaSentDate: "f.cfa_sent_date",
  cfaDate: "f.cfa_date",
  gemUndertakingDate: "f.gem_undertaking_date",
  refloatGemUndertakingDate: "f.refloat_gem_undertaking_date",
  refloatRecommendationDate: "f.refloat_recommendation_date",
  rfpVettingInitiationDate: "f.rfp_vetting_initiation_date",
  rfpVettingApprovalDate: "f.rfp_vetting_approval_date",
  preBidMeeting: "f.pre_bid_meeting",
  preBidMeetingDate: "f.pre_bid_meeting_date",
  tenderLive: "f.tender_live",
  bidNumber: "f.bid_number",
  bidDate: "f.bid_date",
  bidOpeningDate: "f.bid_opening_date",
  bidOpened: "f.bid_opened",
  refloat: "f.refloat",
  refloatPreBidMeeting: "f.refloat_pre_bid_meeting",
  refloatPreBidMeetingDate: "f.refloat_pre_bid_meeting_date",
  postTcecDate: "f.post_tcec_date",
  postTcecMinutesDate: "f.post_tcec_minutes_date",
  postTcecCommitteeNumber: "f.post_tcec_committee_number",
  refloatBiddingDate: "f.refloat_bidding_date",
  refloatBidOpeningDate: "f.refloat_bid_opening_date",
  refloatBiddingStageOver: "f.refloat_bidding_stage_over",
  refloatPostTcecDate: "f.refloat_post_tcec_date",
  refloatPostTcecMinutesDate: "f.refloat_post_tcec_minutes_date",
  refloatPostTcecCommitteeNo: "f.refloat_post_tcec_committee_no",
  rst: "f.rst",
  biddingStageOver: "f.bidding_stage_over",
  cncDate: "f.cnc_date",
  cncApprovalDate: "f.cnc_approval_date",
  noOfSo: "f.no_of_so",
  soNo: "f.so_no",
  gemSoNo: "f.gem_so_no",
  soDate: "f.so_date",
  soValueCapital: "f.so_value_capital",
  soValueRevenue: "f.so_value_revenue",
  dpDate: "f.dp_date",
  firm: "f.firm",
  bqBasis: "f.bq_basis",
  dpExtension: "f.dp_extension",
  dpExtensionCount: "f.dp_extension_count",
  ld: "f.ld",
  revisedDp: "f.revised_dp",
  materialReceiptDate: "f.material_receipt_date",
  irPreparationDate: "f.ir_preparation_date",
  irReceiptDate: "f.ir_receipt_date",
  billPreparationDate: "f.bill_preparation_date",
  billSentForPaymentDate: "f.bill_sent_for_payment_date",
  paymentDate: "f.payment_date",
  paymentMode: "f.payment_mode",
  demandCancelled: "f.demand_cancelled",
  demandCancelledDate: "f.demand_cancelled_date",
  fileClosureDate: "f.file_closure_date",
  soCancelled: "f.so_cancelled",
  soCancelledDate: "f.so_cancelled_date",
  shortclosure: "f.shortclosure",
  shortclosureDate: "f.shortclosure_date",
  currentMilestone: "f.current_milestone",
} as const;

const supplyOrderSearchColumns = {
  financialSanctionDate: "financial_sanction_date",
  soNo: "so_no",
  gemSoNo: "gem_so_no",
  soDate: "so_date",
  soValueCapital: "so_value_capital",
  soValueRevenue: "so_value_revenue",
  dpDate: "dp_date",
  firm: "firm",
  firmUniqueNo: "firm_unique_no",
  firmContactNo: "firm_contact_no",
  firmCity: "firm_city",
  dpExtension: "dp_extension",
  dpExtensionCount: "dp_extension_count",
  ld: "ld",
  warrantyPeriodDate: "warranty_period_date",
  revisedDp: "revised_dp",
  materialReceiptDate: "material_receipt_date",
  actualJobCompletionDate: "actual_job_completion_date",
  jobCompletionDate: "job_completion_date",
  irPreparationDate: "ir_preparation_date",
  irReceiptDate: "ir_receipt_date",
  billPreparationDate: "bill_preparation_date",
  billSentForPaymentDate: "bill_sent_for_payment_date",
  paymentDate: "payment_date",
  paymentMode: "payment_mode",
  demandCancelled: "demand_cancelled",
  soCancelled: "so_cancelled",
  soCancelledDate: "so_cancelled_date",
  shortclosure: "shortclosure",
  shortclosureDate: "shortclosure_date",
  noFurtherAction: "no_further_action",
  noFurtherActionDate: "no_further_action_date",
} as const;

const dateSearchColumns = [
  "f.file_date",
  "f.received_date",
  "f.scrutiny_date",
  "f.scrutiny_response_date",
  "f.scrutiny_completion_date",
  "f.imms_date",
  "f.high_value_meeting_date",
  "f.high_value_minutes_date",
  "f.ad_sent_date",
  "f.pre_tcec_date",
  "f.pre_tcec_minutes_date",
  "f.ad_vetting_date",
  "f.rqa_sent_date",
  "f.rqa_approval_date",
  "f.ifa_sent_date",
  "f.ifa_final_date",
  "f.cfa_sent_date",
  "f.cfa_date",
  "f.gem_undertaking_date",
  "f.refloat_gem_undertaking_date",
  "f.refloat_recommendation_date",
  "f.rfp_vetting_initiation_date",
  "f.rfp_vetting_approval_date",
  "f.bid_date",
  "f.bid_opening_date",
  "f.post_tcec_date",
  "f.post_tcec_minutes_date",
  "f.refloat_bidding_date",
  "f.refloat_bid_opening_date",
  "f.refloat_post_tcec_date",
  "f.refloat_post_tcec_minutes_date",
  "f.cnc_date",
  "f.cnc_approval_date",
  "f.so_date",
  "f.dp_date",
  "f.revised_dp",
  "f.material_receipt_date",
  "f.ir_preparation_date",
  "f.ir_receipt_date",
  "f.bill_preparation_date",
  "f.bill_sent_for_payment_date",
  "f.payment_date",
  "f.demand_cancelled_date",
  "f.file_closure_date",
  "f.so_cancelled_date",
];

function fileHasAny(keys: Array<keyof typeof fileSearchColumns>) {
  return `(${keys.map((key) => hasTextSql(fileSearchColumns[key])).join(" or ")})`;
}

function anySupplyOrderDate(field: keyof typeof supplyOrderSearchColumns) {
  return supplyOrderExists(hasTextSql(`so.${supplyOrderSearchColumns[field]}`));
}

const yesNoFieldConditionKeys = new Set<string>([
  "gte",
  "tcec",
  "gem",
  "highValue",
  "ad",
  "rqa",
  "ifa",
  "psb",
  "bg",
  "ir",
  "rfpVetting",
  "preBidMeeting",
  "tenderLive",
  "bidOpened",
  "refloat",
  "refloatPreBidMeeting",
  "rst",
  "biddingStageOver",
  "refloatBiddingStageOver",
  "demandCancelled",
  "soCancelled",
  "shortclosure",
  "psbApplicable",
  "dpExtension",
  "ld",
  "stageDelivery",
  "stagePayment",
  "advancePayment",
  "cnc",
]);

function fieldConditionSql(field: string | undefined, mode: DatePresenceMode | undefined) {
  const trimmedField = field?.trim();
  if (!trimmedField || !mode) return undefined;
  if ((mode === "yes" || mode === "no") && !yesNoFieldConditionKeys.has(trimmedField)) {
    return undefined;
  }
  if (trimmedField === "cnc") {
    const condition = fileHasAny(["cncDate", "cncApprovalDate"]);
    if (mode === "yes" || mode === "filled") return condition;
    if (mode === "no" || mode === "blank") return `not (${condition})`;
    return undefined;
  }
  if (trimmedField === "activeYears") {
    return fieldConditionExistsSql(
      `select 1 from file_year_activity activity
       where activity.file_id = f.id
         and activity.status = 'active'
         and ${hasTextSql("activity.financial_year")}`,
      mode,
    );
  }
  if (trimmedField === "bqFirmNames") {
    return fieldConditionExistsSql(
      `select 1 from file_firms ff where ff.file_id = f.id and ff.firm_type = 'bq' and ${hasTextSql(
        "ff.firm_name",
      )}`,
      mode,
    );
  }
  if (trimmedField === "bqFirmUniqueNos") {
    return fieldConditionExistsSql(
      `select 1 from file_firms ff where ff.file_id = f.id and ff.firm_type = 'bq' and ${hasTextSql(
        "ff.firm_unique_no",
      )}`,
      mode,
    );
  }
  if (trimmedField === "invitedFirmNames") {
    return fieldConditionExistsSql(
      `select 1 from file_firms ff where ff.file_id = f.id and ff.firm_type = 'invited' and ${hasTextSql(
        "ff.firm_name",
      )}`,
      mode,
    );
  }
  if (trimmedField === "invitedFirmUniqueNos") {
    return fieldConditionExistsSql(
      `select 1 from file_firms ff where ff.file_id = f.id and ff.firm_type = 'invited' and ${hasTextSql(
        "ff.firm_unique_no",
      )}`,
      mode,
    );
  }
  if (trimmedField === "bidderFirmNames") {
    return fieldConditionExistsSql(
      `select 1 from file_firms ff where ff.file_id = f.id and ff.firm_type = 'bidder' and ${hasTextSql(
        "ff.firm_name",
      )}`,
      mode,
    );
  }
  if (trimmedField === "bidderFirmUniqueNos") {
    return fieldConditionExistsSql(
      `select 1 from file_firms ff where ff.file_id = f.id and ff.firm_type = 'bidder' and ${hasTextSql(
        "ff.firm_unique_no",
      )}`,
      mode,
    );
  }
  const supplyOrderCondition = supplyOrderFieldConditionSql(trimmedField, mode);
  if (supplyOrderCondition) return supplyOrderExists(supplyOrderCondition);
  const column = fileSearchColumns[trimmedField as keyof typeof fileSearchColumns];
  if (column)
    return fieldConditionExpressionSql(column, mode, getFileFieldKind(trimmedField, column));
  return undefined;
}

function fieldConditionGroupSql(group: string, mode: DatePresenceMode | undefined) {
  if (!mode) return undefined;
  const fields = group
    .split("|")
    .map((field) => field.trim())
    .filter(Boolean);
  if (!fields.length) return undefined;
  const conditions = fields
    .map((field) => fieldConditionSql(field, mode))
    .filter((condition): condition is string => Boolean(condition));
  if (!conditions.length) return undefined;
  if (mode === "filled" || mode === "yes") return `(${conditions.join(" or ")})`;
  return `(${conditions.join(" and ")})`;
}

function fieldConditionExistsSql(existsBody: string, mode: DatePresenceMode) {
  if (mode === "filled") return `exists (${existsBody})`;
  if (mode === "blank") return `not exists (${existsBody})`;
  return undefined;
}

function supplyOrderFieldConditionSql(field: string, mode: DatePresenceMode) {
  if (field === "soCurrentMilestone") {
    return fieldConditionExpressionSql("so.current_milestone", mode, "text");
  }
  if (field === "stageDeliveryLabel") {
    return fieldConditionExpressionSql(
      "jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb))",
      mode,
      "integer",
    );
  }
  if (field === "stageAmountCapital") {
    return fieldConditionExistsSql(
      `select 1 from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage(value)
       where ${hasTextSql("stage.value ->> 'stageAmountCapital'")}`,
      mode,
    );
  }
  if (field === "stageAmountRevenue") {
    return fieldConditionExistsSql(
      `select 1 from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage(value)
       where ${hasTextSql("stage.value ->> 'stageAmountRevenue'")}`,
      mode,
    );
  }
  if (field === "advanceStageAmountCapital") {
    return fieldConditionExpressionSql(
      "so.advance_payment_detail ->> 'stageAmountCapital'",
      mode,
      "number",
    );
  }
  if (field === "advanceStageAmountRevenue") {
    return fieldConditionExpressionSql(
      "so.advance_payment_detail ->> 'stageAmountRevenue'",
      mode,
      "number",
    );
  }
  if (field === "advancePaymentDate") {
    return fieldConditionExpressionSql("so.advance_payment_detail ->> 'paymentDate'", mode, "date");
  }
  if (field === "advanceExpectedPaymentDate") {
    return fieldConditionExpressionSql(
      "so.advance_payment_detail ->> 'expectedPaymentDate'",
      mode,
      "date",
    );
  }
  if (field === "advanceActualPaymentCapital") {
    return fieldConditionExpressionSql(
      "so.advance_payment_detail ->> 'actualPaymentCapital'",
      mode,
      "number",
    );
  }
  if (field === "advanceActualPaymentRevenue") {
    return fieldConditionExpressionSql(
      "so.advance_payment_detail ->> 'actualPaymentRevenue'",
      mode,
      "number",
    );
  }
  const supplementaryFields: Record<string, readonly [string, ValueKind]> = {
    supplementaryBillNo: ["billNo", "text"],
    supplementaryBillAmountCapital: ["billAmountCapital", "number"],
    supplementaryBillAmountRevenue: ["billAmountRevenue", "number"],
    supplementaryBillSentForPaymentDate: ["billSentForPaymentDate", "date"],
    supplementaryBillPaymentDate: ["paymentDate", "date"],
    supplementaryBillPaymentMode: ["paymentMode", "text"],
    supplementaryBillActualPaymentCapital: ["actualPaymentCapital", "number"],
    supplementaryBillActualPaymentRevenue: ["actualPaymentRevenue", "number"],
    supplementaryBillRemarks: ["remarks", "text"],
  };
  if (field in supplementaryFields) {
    const [jsonField] = supplementaryFields[field];
    return fieldConditionExistsSql(
      `select 1 from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as bill(value)
       where ${hasTextSql(`bill.value ->> '${jsonField}'`)}`,
      mode,
    );
  }
  if (field === "supplementaryBillReturnCycles") {
    return fieldConditionExistsSql(
      `select 1 from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as bill(value)
       where jsonb_array_length(coalesce(bill.value -> 'billReturnCycles', '[]'::jsonb)) > 0`,
      mode,
    );
  }
  const fieldDef = supplyOrderFields[field as keyof typeof supplyOrderFields];
  if (!fieldDef) return undefined;
  const [column, kind] = fieldDef;
  return fieldConditionExpressionSql(`so.${column}`, mode, kind);
}

function getFileFieldKind(field: string, column: string): ValueKind {
  const fieldDef = fileFields[field as keyof typeof fileFields];
  if (fieldDef) return fieldDef[1];
  return isDateLikeSearchColumn(column) ? "date" : "text";
}

function fieldConditionExpressionSql(expression: string, mode: DatePresenceMode, kind: ValueKind) {
  if (mode === "yes") return isYesSql(expression);
  if (mode === "no") return isNoSql(expression);
  if (kind === "date") {
    return mode === "filled" ? `(${expression}) is not null` : `(${expression}) is null`;
  }
  if (kind === "jsonArray") {
    const condition = `jsonb_array_length(coalesce(${expression}, '[]'::jsonb)) > 0`;
    return mode === "filled" ? condition : `not (${condition})`;
  }
  if (kind === "jsonObject") {
    const condition = `coalesce(${expression}, '{}'::jsonb) <> '{}'::jsonb`;
    return mode === "filled" ? condition : `not (${condition})`;
  }
  const condition = hasTextSql(expression);
  return mode === "filled" ? condition : `not ${condition}`;
}

function isDateLikeSearchColumn(column: string) {
  return column.endsWith("_date") || column.endsWith("_dp") || column === "f.file_date";
}

function requiredFilledFieldsSql(keys: string[]) {
  const uniqueKeys = Array.from(new Set(keys.map((key) => key.trim()).filter(Boolean)));
  if (!uniqueKeys.length) return undefined;
  const fileConditions = uniqueKeys
    .filter((key) => !isRequiredSupplyOrderField(key))
    .map(requiredFileFieldSql)
    .filter((condition): condition is string => Boolean(condition));
  const supplyOrderConditions = uniqueKeys
    .filter(isRequiredSupplyOrderField)
    .map(requiredSupplyOrderFieldSql)
    .filter((condition): condition is string => Boolean(condition));
  const conditions = [...fileConditions];
  if (supplyOrderConditions.length) {
    conditions.push(supplyOrderExists(supplyOrderConditions.join(" and ")));
  }
  return conditions.length ? `(${conditions.join(" and ")})` : undefined;
}

function isRequiredSupplyOrderField(key: string) {
  return (
    key === "soCurrentMilestone" ||
    key === "stageDeliveryLabel" ||
    key === "stageAmountCapital" ||
    key === "stageAmountRevenue" ||
    key === "advanceStageAmountCapital" ||
    key === "advanceStageAmountRevenue" ||
    key === "advanceExpectedPaymentDate" ||
    key === "advancePaymentDate" ||
    key === "advanceActualPaymentCapital" ||
    key === "advanceActualPaymentRevenue" ||
    supplementaryBillExportKeys.has(key) ||
    key in supplyOrderFields
  );
}

function requiredFileFieldSql(key: string) {
  if (key === "activeYears") {
    return `exists (
      select 1 from file_year_activity activity
      where activity.file_id = f.id
        and activity.status = 'active'
        and ${hasTextSql("activity.financial_year")}
    )`;
  }
  if (key === "bqFirmNames") return firmDetailsExists("bq", hasTextSql("ff.firm_name"));
  if (key === "bqFirmUniqueNos") return firmDetailsExists("bq", hasTextSql("ff.firm_unique_no"));
  if (key === "invitedFirmNames") return firmDetailsExists("invited", hasTextSql("ff.firm_name"));
  if (key === "invitedFirmUniqueNos") {
    return firmDetailsExists("invited", hasTextSql("ff.firm_unique_no"));
  }
  if (key === "bidderFirmNames") return firmDetailsExists("bidder", hasTextSql("ff.firm_name"));
  if (key === "bidderFirmUniqueNos") {
    return firmDetailsExists("bidder", hasTextSql("ff.firm_unique_no"));
  }
  const column = fileSearchColumns[key as keyof typeof fileSearchColumns];
  return column ? hasTextSql(column) : undefined;
}

function requiredSupplyOrderFieldSql(key: string) {
  if (key === "soCurrentMilestone") return hasTextSql("so.current_milestone");
  if (key === "stageDeliveryLabel") {
    return `jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0`;
  }
  if (key === "stageAmountCapital") return stageDeliveryJsonFieldFilledSql("stageAmountCapital");
  if (key === "stageAmountRevenue") return stageDeliveryJsonFieldFilledSql("stageAmountRevenue");
  if (key === "advanceStageAmountCapital") {
    return advancePaymentDetailJsonFieldFilledSql("stageAmountCapital");
  }
  if (key === "advanceStageAmountRevenue") {
    return advancePaymentDetailJsonFieldFilledSql("stageAmountRevenue");
  }
  if (key === "advanceExpectedPaymentDate") {
    return advancePaymentDetailJsonFieldFilledSql("expectedPaymentDate");
  }
  if (key === "advancePaymentDate") return advancePaymentDetailJsonFieldFilledSql("paymentDate");
  if (key === "advanceActualPaymentCapital") {
    return advancePaymentDetailJsonFieldFilledSql("actualPaymentCapital");
  }
  if (key === "advanceActualPaymentRevenue") {
    return advancePaymentDetailJsonFieldFilledSql("actualPaymentRevenue");
  }
  if (key === "supplementaryBillNo") return supplementaryBillJsonFieldFilledSql("billNo");
  if (key === "supplementaryBillAmountCapital") {
    return supplementaryBillJsonFieldFilledSql("billAmountCapital");
  }
  if (key === "supplementaryBillAmountRevenue") {
    return supplementaryBillJsonFieldFilledSql("billAmountRevenue");
  }
  if (key === "supplementaryBillSentForPaymentDate") {
    return supplementaryBillJsonFieldFilledSql("billSentForPaymentDate");
  }
  if (key === "supplementaryBillReturnCycles") {
    return `exists (
      select 1
      from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as bill(value)
      where jsonb_array_length(coalesce(bill.value -> 'billReturnCycles', '[]'::jsonb)) > 0
    )`;
  }
  if (key === "supplementaryBillPaymentDate") {
    return supplementaryBillJsonFieldFilledSql("paymentDate");
  }
  if (key === "supplementaryBillPaymentMode") {
    return supplementaryBillJsonFieldFilledSql("paymentMode");
  }
  if (key === "supplementaryBillActualPaymentCapital") {
    return supplementaryBillJsonFieldFilledSql("actualPaymentCapital");
  }
  if (key === "supplementaryBillActualPaymentRevenue") {
    return supplementaryBillJsonFieldFilledSql("actualPaymentRevenue");
  }
  if (key === "supplementaryBillRemarks") return supplementaryBillJsonFieldFilledSql("remarks");
  const field = supplyOrderFields[key as keyof typeof supplyOrderFields];
  if (!field) return undefined;
  const [column, kind] = field;
  if (kind === "jsonArray") return `jsonb_array_length(coalesce(so.${column}, '[]'::jsonb)) > 0`;
  if (kind === "jsonObject") return `coalesce(so.${column}, '{}'::jsonb) <> '{}'::jsonb`;
  return hasTextSql(`so.${column}`);
}

function stageDeliveryJsonFieldFilledSql(field: string) {
  return `exists (
    select 1
    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage(value)
    where ${hasTextSql(`stage.value ->> '${field}'`)}
  )`;
}

function advancePaymentDetailJsonFieldFilledSql(field: string) {
  return hasTextSql(`so.advance_payment_detail ->> '${field}'`);
}

function supplementaryBillJsonFieldFilledSql(field: string) {
  return `exists (
    select 1
    from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as bill(value)
    where ${hasTextSql(`bill.value ->> '${field}'`)}
  )`;
}

function isCancelledFileSql() {
  return `(${isYesSql("f.demand_cancelled")}
    or (${supplyOrderRowExists()} and not exists (
      select 1 from supply_orders so_active
      where so_active.file_id = f.id
        and not ${isYesSql("so_active.so_cancelled")}
    )))`;
}

function allSupplyOrdersCancelledSql() {
  return `(${supplyOrderRowExists()} and not exists (
    select 1 from supply_orders so_active
    where so_active.file_id = f.id
      and not ${isYesSql("so_active.so_cancelled")}
  ))`;
}

function deliveryInspectionApplicableSql() {
  return `${isYesSql("f.ir")} and not (${contractFileTypeSql("f")})`;
}

function biddingApplicableSql() {
  return `upper(trim(coalesce(f.mode, ''))) <> 'LPC'
    and lower(trim(coalesce(f.file_type, ''))) not in ('cars', 'capsi')
    and not (${isYesSql("f.gem")} and lower(trim(coalesce(f.gem_bidding_mode, ''))) = 'comparison')`;
}

function supplyOrderPlacedSql() {
  return supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")} and ${supplyOrderTabCompleteSql("so")}`,
  );
}

function deliveryDueOrderSql(extra = "true") {
  return supplyOrderExists(
    `${hasTextSql("so.so_date")} and not ${hasTextSql("so.material_receipt_date")} and not ${isYesSql(
      "so.so_cancelled",
    )} and ${extra}`,
  );
}

function liveSupplyOrderSql() {
  const stagePaymentPending =
    "exists (select 1 from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage(value) where not " +
    hasTextSql("stage.value ->> 'paymentDate'") +
    ")";
  const paymentPending =
    "(case when " +
    isYesSql("so.stage_delivery") +
    " and " +
    isYesSql("so.stage_payment") +
    " and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0 then " +
    stagePaymentPending +
    " else not " +
    hasTextSql("so.payment_date") +
    " end)";
  return supplyOrderChildSql(
    `${supplyOrderTabCompleteSql("so")}
     and ${paymentPending}
     and not ${isYesSql("so.no_further_action")}
     and not ${isYesSql("so.so_cancelled")}`,
    `${hasTextSql("f.so_date")}
     and not ${hasTextSql("f.payment_date")}
     and not (${isYesSql("f.demand_cancelled")} or ${isYesSql("f.so_cancelled")})`,
  );
}

function parentStageJobCompletionDueSql(orderAlias = "so") {
  const stageRows = `coalesce(${orderAlias}.stage_deliveries, '[]'::jsonb)`;
  const stageDate = `nullif(btrim(job_completion_stage.stage ->> 'jobCompletionDate'), '')`;
  return `(
    jsonb_array_length(${stageRows}) > 0
    and not exists (
      select 1
      from jsonb_array_elements(${stageRows}) as job_completion_stage(stage)
      where ${stageDate} is null or ${stageDate}::date > current_date
    )
  )`;
}

function paymentPendingSql(options: { includeReturnedUnpaid: boolean } = { includeReturnedUnpaid: false }) {
  const contractFileType = contractFileTypeSql("f");
  const goodsServicesIrNo = `(not ${isYesSql("f.ir")} and not ${contractFileType})`;
  const nonDeliveryFileType = `(${goodsServicesIrNo} or ${contractFileType})`;
  const activeOrder = `not ${isYesSql("so.so_cancelled")} and not ${isYesSql("so.no_further_action")}`;
  const hasStagePaymentCases = `(${isYesSql("so.stage_delivery")}
    and ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const stagedSoReceiptComplete = `(jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as receipt_stage(stage)
      where not ${hasTextSql("receipt_stage.stage ->> 'materialReceiptDate'")}
    ))`;
  const usesStageReceiptForSoPayment = `(${isYesSql("f.ir")}
    and ${isYesSql("so.stage_delivery")}
    and not ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const childDpDate = `coalesce(so.revised_dp, so.dp_date)`;
  const stageDpDate = `coalesce(
    nullif(payment_stage.stage ->> 'revisedDp', '')::date,
    nullif(payment_stage.stage ->> 'dpDate', '')::date
  )`;
  const childDeliveryCompletion = `(not ${nonDeliveryFileType}
    and ((${usesStageReceiptForSoPayment} and ${stagedSoReceiptComplete})
      or (not ${usesStageReceiptForSoPayment} and ${hasTextSql("so.material_receipt_date")})))`;
  const stageDeliveryCompletion = `(not ${nonDeliveryFileType} and coalesce(payment_stage.stage ->> 'materialReceiptDate', '') <> '')`;
  const childPaymentStarted = `(${hasTextSql("so.bill_preparation_date")}
	       or ${hasTextSql("so.bill_sent_for_payment_date")})`;
  const stagePaymentStarted = `(coalesce(payment_stage.stage ->> 'billPreparationDate', '') <> ''
		       or coalesce(payment_stage.stage ->> 'billSentForPaymentDate', '') <> '')`;
  const stageJobCompletionDone = `coalesce(payment_stage.stage ->> 'jobCompletionDate', '') <> ''`;
  const childJobCompletionReached = `(${hasTextSql("so.job_completion_date")}
    and so.job_completion_date <= current_date)`;
  const stageJobCompletionReached = `(coalesce(payment_stage.stage ->> 'jobCompletionDate', '') <> ''
    and nullif(payment_stage.stage ->> 'jobCompletionDate', '')::date <= current_date)`;
  const childJobCompletionDone = completedOrderMilestoneSql("so", "jobcompletion");
  const stagedSoJobCompletionDue = parentStageJobCompletionDueSql();
  const usesStageJobCompletionForSoPayment = `(${isYesSql("so.stage_delivery")}
    and not ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const goodsServicesJobCompletionDue = `(${goodsServicesIrNo} and (
    (${usesStageJobCompletionForSoPayment} and ${stagedSoJobCompletionDue})
    or (not ${usesStageJobCompletionForSoPayment} and ${childJobCompletionDone})
  ))`;
  const childNonInspectionPaymentDue = `(((${contractFileType} and not ${isYesSql("so.shortclosure")} and ${childDpDate} < current_date) or (${contractFileType} and ${isYesSql("so.shortclosure")} and ${childJobCompletionReached})) or ${goodsServicesJobCompletionDue})`;
  const stageNonInspectionPaymentDue = `(((${contractFileType} and not ${isYesSql("so.shortclosure")} and ${stageDpDate} < current_date) or (${contractFileType} and ${isYesSql("so.shortclosure")} and ${stageJobCompletionReached})) or (${goodsServicesIrNo} and ${stageJobCompletionDone}))`;
  const childPaymentPending = `${hasTextSql("so.so_date")}
     and not ${hasStagePaymentCases}
     and (${childPaymentStarted}
		       or ${childNonInspectionPaymentDue}
	       or (not ${nonDeliveryFileType} and ${childDeliveryCompletion}))
     and not ${hasTextSql("so.payment_date")}
     and ${activeOrder}
     ${options.includeReturnedUnpaid ? "" : `and not ${billReturnHistorySql("so.bill_return_cycles")}`}`;
  const stagePaymentPending = `${hasTextSql("so.so_date")}
     and ${isYesSql("so.stage_delivery")}
     and ${isYesSql("so.stage_payment")}
     and ${activeOrder}
     and exists (
       select 1
       from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as payment_stage(stage)
       where (${stagePaymentStarted}
	         or ${stageNonInspectionPaymentDue}
         or (not ${nonDeliveryFileType} and ${stageDeliveryCompletion})
	       )
	       and coalesce(payment_stage.stage ->> 'paymentDate', '') = ''
	       ${options.includeReturnedUnpaid ? "" : `and not ${billReturnHistorySql("payment_stage.stage -> 'billReturnCycles'")}`}
	     )`;
  return supplyOrderChildSql(
    `((${childPaymentPending}) or (${stagePaymentPending}))`,
    `${hasTextSql("f.so_date")}
	     and ((${nonDeliveryFileType} and false)
	       or (not ${nonDeliveryFileType} and ${hasTextSql("f.material_receipt_date")}))
     and not ${hasTextSql("f.payment_date")}
     and not (${isYesSql("f.demand_cancelled")} or ${isYesSql("f.so_cancelled")})`,
  );
}

function analyticsPaymentPendingSql() {
  const contract = contractFileTypeSql("f");
  const stageRows = `jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb))`;
  const commonStagePayment = `(${isYesSql("so.stage_delivery")}
    and not ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const stagedPaymentCases = `(${isYesSql("so.stage_delivery")}
    and ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const stageDpDate = `coalesce(
    nullif(payment_stage.stage ->> 'revisedDp', '')::date,
    nullif(payment_stage.stage ->> 'dpDate', '')::date
  )`;
  const stageJobCompletionDate = `nullif(payment_stage.stage ->> 'jobCompletionDate', '')::date`;
  const stageMaterialReceiptDate = `nullif(payment_stage.stage ->> 'materialReceiptDate', '')::date`;
  const parentStageDate = (field: string) => `(select case
    when count(*) > 0 and count(stage_dates.stage_date) = count(*) then max(stage_dates.stage_date)
    else null
  end
  from (
    select ${field} as stage_date
    from ${stageRows} as due_stage(stage)
  ) as stage_dates)`;
  const parentStageDpDate = parentStageDate(`coalesce(
    nullif(due_stage.stage ->> 'revisedDp', '')::date,
    nullif(due_stage.stage ->> 'dpDate', '')::date
  )`);
  const parentStageJobCompletionDate = parentStageDate(
    `nullif(due_stage.stage ->> 'jobCompletionDate', '')::date`,
  );
  const parentStageMaterialReceiptDate = parentStageDate(
    `nullif(due_stage.stage ->> 'materialReceiptDate', '')::date`,
  );
  const paymentTriggerReached = `(
    case
      when ${contract} and ${isYesSql("so.shortclosure")} then
        (case when ${commonStagePayment} then ${parentStageJobCompletionDate}
          when ${stagedPaymentCases} then ${stageJobCompletionDate}
          else coalesce(${stageJobCompletionDate}, so.job_completion_date) end) <= current_date
      when ${contract} then
        (case when ${commonStagePayment} then ${parentStageDpDate}
          when ${stagedPaymentCases} then ${stageDpDate}
          else coalesce(${stageDpDate}, so.revised_dp, so.dp_date) end + 1) <= current_date
      when ${isYesSql("f.ir")} then
        (case when ${commonStagePayment} then ${parentStageMaterialReceiptDate}
          when ${stagedPaymentCases} then ${stageMaterialReceiptDate}
          else coalesce(${stageMaterialReceiptDate}, so.material_receipt_date) end) <= current_date
      when ${commonStagePayment} then ${parentStageJobCompletionDate} <= current_date
      when ${stagedPaymentCases} then ${stageJobCompletionDate} <= current_date
      else coalesce(${stageJobCompletionDate}, so.job_completion_date) <= current_date
    end
  )`;
  const mainPending = `(
    coalesce(payment_stage.stage ->> 'paymentDate', so.payment_date::text, '') = ''
    and (
      coalesce(payment_stage.stage ->> 'billPreparationDate', so.bill_preparation_date::text, '') <> ''
      or coalesce(payment_stage.stage ->> 'billSentForPaymentDate', so.bill_sent_for_payment_date::text, '') <> ''
      or ${billReturnHistorySql("coalesce(payment_stage.stage -> 'billReturnCycles', so.bill_return_cycles)")}
      or ${paymentTriggerReached}
    )
  )`;
  const supplementaryPending = `exists (
    select 1
    from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
    where coalesce(supplementary_bill.bill ->> 'paymentDate', '') = ''
      and (
        coalesce(supplementary_bill.bill ->> 'billSentForPaymentDate', '') <> ''
        or exists (
          select 1
          from jsonb_array_elements(coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)) as return_cycle(cycle)
          where ${hasTextSql("return_cycle.cycle ->> 'returnedDate'")}
            or ${hasTextSql("return_cycle.cycle ->> 'resubmittedDate'")}
            or ${hasTextSql("return_cycle.cycle ->> 'reason'")}
            or ${hasTextSql("return_cycle.cycle ->> 'remarks'")}
        )
      )
  )`;
  const orderPending = `exists (
    select 1
    from supply_orders so
    left join lateral ${stageRows} as payment_stage(stage)
      on not (${isYesSql("so.stage_delivery")} and not ${isYesSql("so.stage_payment")})
        and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0
    where so.file_id = f.id
      and not ${isYesSql("so.so_cancelled")}
      and not ${isYesSql("so.no_further_action")}
      and (
        ${mainPending}
        or (${isYesSql("so.advance_payment")}
          and ${normalizedSql("so.advance_payment_detail ->> 'currentMilestone'")} = 'advancepayment'
          and coalesce(so.advance_payment_detail ->> 'paymentDate', '') = '')
        or ${supplementaryPending}
      )
  )`;
  const fileOnlyPending = `(
    not ${supplyOrderRowExists()}
    and not ${isYesSql("f.so_cancelled")}
    and not ${isYesSql("f.demand_cancelled")}
    and f.payment_date is null
    and (
      f.bill_preparation_date is not null
      or f.bill_sent_for_payment_date is not null
      or (${isYesSql("f.ir")} and not (${contract}) and f.material_receipt_date <= current_date)
    )
  )`;
  return `(${orderPending} or ${fileOnlyPending})`;
}

function billReturnHistorySql(expression: string) {
  return `exists (
    select 1
    from jsonb_array_elements(coalesce(${expression}, '[]'::jsonb)) as return_cycle(cycle)
    where ${hasTextSql("return_cycle.cycle ->> 'returnedDate'")}
       or ${hasTextSql("return_cycle.cycle ->> 'resubmittedDate'")}
       or ${hasTextSql("return_cycle.cycle ->> 'reason'")}
       or ${hasTextSql("return_cycle.cycle ->> 'remarks'")}
  )`;
}

function paymentBucketSql(
  bucket: "due" | "inProcess" | "submitted",
  excludeReturnedHistory = false,
) {
  const contractFileType = contractFileTypeSql("f");
  const goodsServicesIrNo = `(not ${isYesSql("f.ir")} and not ${contractFileType})`;
  const nonDeliveryFileType = `(${goodsServicesIrNo} or ${contractFileType})`;
  const activeOrder = `not ${isYesSql("so.so_cancelled")} and not ${isYesSql("so.no_further_action")}`;
  const hasStagePaymentCases = `(${isYesSql("so.stage_delivery")}
    and ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const stagedSoReceiptComplete = `(jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as receipt_stage(stage)
      where not ${hasTextSql("receipt_stage.stage ->> 'materialReceiptDate'")}
    ))`;
  const usesStageReceiptForSoPayment = `(${isYesSql("f.ir")}
    and ${isYesSql("so.stage_delivery")}
    and not ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const childDpDate = `coalesce(so.revised_dp, so.dp_date)`;
  const stageDpDate = `coalesce(
    nullif(payment_stage.stage ->> 'revisedDp', '')::date,
    nullif(payment_stage.stage ->> 'dpDate', '')::date
  )`;
  const childDeliveryCompletion = `(not ${nonDeliveryFileType}
    and ((${usesStageReceiptForSoPayment} and ${stagedSoReceiptComplete})
      or (not ${usesStageReceiptForSoPayment} and ${hasTextSql("so.material_receipt_date")})))`;
  const stageDeliveryCompletion = `(not ${nonDeliveryFileType} and coalesce(payment_stage.stage ->> 'materialReceiptDate', '') <> '')`;
  const childPaymentStarted = `(${hasTextSql("so.bill_preparation_date")}
	       or ${hasTextSql("so.bill_sent_for_payment_date")})`;
  const stagePaymentStarted = `(coalesce(payment_stage.stage ->> 'billPreparationDate', '') <> ''
		       or coalesce(payment_stage.stage ->> 'billSentForPaymentDate', '') <> '')`;
  const stageJobCompletionDone = `coalesce(payment_stage.stage ->> 'jobCompletionDate', '') <> ''`;
  const childJobCompletionReached = `(${hasTextSql("so.job_completion_date")}
    and so.job_completion_date <= current_date)`;
  const stageJobCompletionReached = `(coalesce(payment_stage.stage ->> 'jobCompletionDate', '') <> ''
    and nullif(payment_stage.stage ->> 'jobCompletionDate', '')::date <= current_date)`;
  const childJobCompletionDone = completedOrderMilestoneSql("so", "jobcompletion");
  const stagedSoJobCompletionDue = parentStageJobCompletionDueSql();
  const usesStageJobCompletionForSoPayment = `(${isYesSql("so.stage_delivery")}
    and not ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const goodsServicesJobCompletionDue = `(${goodsServicesIrNo} and (
    (${usesStageJobCompletionForSoPayment} and ${stagedSoJobCompletionDue})
    or (not ${usesStageJobCompletionForSoPayment} and ${childJobCompletionDone})
  ))`;
  const childNonInspectionPaymentDue = `(((${contractFileType} and not ${isYesSql("so.shortclosure")} and ${childDpDate} < current_date) or (${contractFileType} and ${isYesSql("so.shortclosure")} and ${childJobCompletionReached})) or ${goodsServicesJobCompletionDue})`;
  const stageNonInspectionPaymentDue = `(((${contractFileType} and not ${isYesSql("so.shortclosure")} and ${stageDpDate} < current_date) or (${contractFileType} and ${isYesSql("so.shortclosure")} and ${stageJobCompletionReached})) or (${goodsServicesIrNo} and ${stageJobCompletionDone}))`;
  const childBucket =
    bucket === "due"
      ? `not ${hasTextSql("so.bill_preparation_date")} and not ${hasTextSql("so.bill_sent_for_payment_date")}`
      : bucket === "inProcess"
        ? `${hasTextSql("so.bill_preparation_date")} and not ${hasTextSql("so.bill_sent_for_payment_date")}`
        : hasTextSql("so.bill_sent_for_payment_date");
  const stageBucket =
    bucket === "due"
      ? `coalesce(payment_stage.stage ->> 'billPreparationDate', '') = '' and coalesce(payment_stage.stage ->> 'billSentForPaymentDate', '') = ''`
      : bucket === "inProcess"
        ? `coalesce(payment_stage.stage ->> 'billPreparationDate', '') <> '' and coalesce(payment_stage.stage ->> 'billSentForPaymentDate', '') = ''`
        : `coalesce(payment_stage.stage ->> 'billSentForPaymentDate', '') <> ''`;
  const legacyBucket =
    bucket === "due"
      ? `not ${hasTextSql("f.bill_preparation_date")} and not ${hasTextSql("f.bill_sent_for_payment_date")}`
      : bucket === "inProcess"
        ? `${hasTextSql("f.bill_preparation_date")} and not ${hasTextSql("f.bill_sent_for_payment_date")}`
        : hasTextSql("f.bill_sent_for_payment_date");
  const childReturnHistoryExclusion =
    bucket === "submitted" && excludeReturnedHistory
      ? `and not ${billReturnHistorySql("so.bill_return_cycles")}`
      : "";
  const stageReturnHistoryExclusion =
    bucket === "submitted" && excludeReturnedHistory
      ? `and not ${billReturnHistorySql("payment_stage.stage -> 'billReturnCycles'")}`
      : "";
  const childPaymentPending = `${hasTextSql("so.so_date")}
     and not ${hasStagePaymentCases}
     and (${childPaymentStarted}
		       or ${childNonInspectionPaymentDue}
	       or (not ${nonDeliveryFileType} and ${childDeliveryCompletion}))
     and not ${hasTextSql("so.payment_date")}
     and ${activeOrder}
     ${childReturnHistoryExclusion}
     and ${childBucket}`;
  const stagePaymentPending = `${hasTextSql("so.so_date")}
     and ${isYesSql("so.stage_delivery")}
     and ${isYesSql("so.stage_payment")}
     and ${activeOrder}
     and exists (
       select 1
       from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as payment_stage(stage)
       where (${stagePaymentStarted}
	         or ${stageNonInspectionPaymentDue}
         or (not ${nonDeliveryFileType} and ${stageDeliveryCompletion})
	       )
	       and coalesce(payment_stage.stage ->> 'paymentDate', '') = ''
         ${stageReturnHistoryExclusion}
         and ${stageBucket}
	     )`;
  return supplyOrderChildSql(
    `((${childPaymentPending}) or (${stagePaymentPending}))`,
    `${hasTextSql("f.so_date")}
	     and ((${nonDeliveryFileType} and false)
	       or (not ${nonDeliveryFileType} and ${hasTextSql("f.material_receipt_date")}))
     and not ${hasTextSql("f.payment_date")}
     and not (${isYesSql("f.demand_cancelled")} or ${isYesSql("f.so_cancelled")})
     and ${legacyBucket}`,
  );
}

function paymentCompletedSql() {
  const activeOrder = `not ${isYesSql("so.so_cancelled")}`;
  const childPaymentCompleted = `${hasTextSql("so.so_date")}
     and ${hasTextSql("so.payment_date")}
     and ${activeOrder}`;
  const stagePaymentCompleted = `${hasTextSql("so.so_date")}
     and ${isYesSql("so.stage_delivery")}
     and ${isYesSql("so.stage_payment")}
     and ${activeOrder}
     and exists (
       select 1
       from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as payment_stage(stage)
	       where coalesce(payment_stage.stage ->> 'paymentDate', '') <> ''
	     )`;
  return supplyOrderChildSql(
    `((${childPaymentCompleted}) or (${stagePaymentCompleted}))`,
    `${hasTextSql("f.so_date")}
     and ${hasTextSql("f.payment_date")}
     and not (${isYesSql("f.demand_cancelled")} or ${isYesSql("f.so_cancelled")})`,
  );
}

function deliveryPendingOrderSql() {
  return deliveryDueOrderSql(`${effectiveDpDateSql("so")} is not null`);
}

function deliveryJobFilterSql(state: "completed" | "pending" | "overdue") {
  const nonDeliveryFileType = `(not ${isYesSql("f.ir")} or ${contractFileTypeSql("f")})`;
  const stageDpDate = `coalesce(
    nullif(delivery_stage.stage ->> 'revisedDp', '')::date,
    nullif(delivery_stage.stage ->> 'dpDate', '')::date
  )`;
  const stageStartDate = `coalesce(
    nullif(delivery_stage.stage ->> 'deliveryPeriodStartDate', '')::date,
    so.so_date
  )`;
  const orderDpDate = effectiveDpDateSql("so");
  const stageCompleted = `(not ${nonDeliveryFileType}
    and coalesce(delivery_stage.stage ->> 'materialReceiptDate', '') <> '')`;
  const orderCompleted = `(not ${nonDeliveryFileType}
    and ${hasTextSql("so.material_receipt_date")})`;
  const stagePeriod =
    state === "pending"
      ? `${stageDpDate} is not null
        and ${stageStartDate} <= current_date
        and ${stageDpDate} >= current_date`
      : `${stageDpDate} is not null and ${stageDpDate} < current_date`;
  const orderPeriod =
    state === "pending"
      ? `${orderDpDate} is not null and ${orderDpDate} >= current_date and so.so_date <= current_date`
      : `${orderDpDate} is not null and ${orderDpDate} < current_date`;
  const noFurtherActionActive =
    state === "completed" ? "true" : `not ${isYesSql("so.no_further_action")}`;
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `${hasTextSql("so.so_date")}
     and not ${isYesSql("so.so_cancelled")}
     and ${noFurtherActionActive}
     and not ${nonDeliveryFileType}
     and (
       (
         ${isYesSql("so.stage_delivery")}
         and exists (
           select 1
           from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as delivery_stage(stage)
           where ${
             state === "completed" ? stageCompleted : `not (${stageCompleted}) and ${stagePeriod}`
           }
         )
       )
       or (
         not ${isYesSql("so.stage_delivery")}
         and ${
           state === "completed" ? orderCompleted : `not (${orderCompleted}) and ${orderPeriod}`
         }
       )
     )`,
  )}`;
}

function jobCompletionFilterSql(state: "live" | "periodOver") {
  const nonDeliveryFileType = `(not ${isYesSql("f.ir")} or ${contractFileTypeSql("f")})`;
  const stageDpDate = `coalesce(
    nullif(job_stage.stage ->> 'revisedDp', '')::date,
    nullif(job_stage.stage ->> 'dpDate', '')::date
  )`;
  const orderDpDate = effectiveDpDateSql("so");
  const stageJobCompletionDone = `coalesce(job_stage.stage ->> 'jobCompletionDate', '') <> ''`;
  const orderJobCompletionDone = completedOrderMilestoneSql("so", "jobcompletion");
  const stageCondition =
    state === "live"
      ? `not (${stageJobCompletionDone})
        and ${stageDpDate} is not null
        and ${stageDpDate} < current_date`
      : `not (${stageJobCompletionDone})
        and ${stageDpDate} is not null
        and ${stageDpDate} < current_date`;
  const orderCondition =
    state === "live"
      ? `not (${orderJobCompletionDone})
        and ${orderDpDate} is not null
        and ${orderDpDate} < current_date`
      : `not (${orderJobCompletionDone})
        and ${orderDpDate} is not null
        and ${orderDpDate} < current_date`;
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `${hasTextSql("so.so_date")}
     and not ${isYesSql("so.so_cancelled")}
     and not ${isYesSql("so.no_further_action")}
     and ${nonDeliveryFileType}
     and (
       (
         ${isYesSql("so.stage_delivery")}
         and exists (
           select 1
           from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as job_stage(stage)
           where ${stageCondition}
         )
       )
       or (
         not ${isYesSql("so.stage_delivery")}
         and ${orderCondition}
       )
     )`,
  )}`;
}

function jobCompletionCompletedFilterSql() {
  const nonDeliveryFileType = `(not ${isYesSql("f.ir")} or ${contractFileTypeSql("f")})`;
  const stageJobCompletionDone = `coalesce(job_completed_stage.stage ->> 'jobCompletionDate', '') <> ''`;
  const orderJobCompletionDone = completedOrderMilestoneSql("so", "jobcompletion");
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `${hasTextSql("so.so_date")}
     and not ${isYesSql("so.so_cancelled")}
     and ${nonDeliveryFileType}
     and (
       (
         ${isYesSql("so.stage_delivery")}
         and exists (
           select 1
           from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as job_completed_stage(stage)
           where ${stageJobCompletionDone}
         )
       )
       or (
         not ${isYesSql("so.stage_delivery")}
         and ${orderJobCompletionDone}
       )
     )`,
  )}`;
}

function irStatusFilterSql(state: "preparationPending" | "receiptPending" | "completed") {
  const stageCondition =
    state === "preparationPending"
      ? `coalesce(ir_stage.stage ->> 'materialReceiptDate', '') <> ''
         and coalesce(ir_stage.stage ->> 'irPreparationDate', '') = ''`
      : state === "receiptPending"
        ? `coalesce(ir_stage.stage ->> 'irPreparationDate', '') <> ''
           and coalesce(ir_stage.stage ->> 'irReceiptDate', '') = ''`
        : `coalesce(ir_stage.stage ->> 'irReceiptDate', '') <> ''`;
  const orderCondition =
    state === "preparationPending"
      ? `${hasTextSql("so.material_receipt_date")}
         and not ${hasTextSql("so.ir_preparation_date")}`
      : state === "receiptPending"
        ? `${hasTextSql("so.ir_preparation_date")}
           and not ${hasTextSql("so.ir_receipt_date")}`
        : hasTextSql("so.ir_receipt_date");

  return `${deliveryInspectionApplicableSql()}
    and ${isYesSql("f.ir")}
    and not ${isCancelledFileSql()}
    and ${supplyOrderExists(
      `${hasTextSql("so.so_date")}
       and not ${isYesSql("so.so_cancelled")}
       and (
         (
           ${isYesSql("so.stage_delivery")}
           and exists (
             select 1
             from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as ir_stage(stage)
             where ${stageCondition}
           )
         )
         or (
           not ${isYesSql("so.stage_delivery")}
           and ${orderCondition}
         )
       )`,
    )}`;
}

function normalizeMilestoneName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isSupplyOrderDrivenMilestoneName(value: string) {
  return [
    "supplyorder",
    "deliveryperiod",
    "psb",
    "pwb",
    "psbpwb",
    "financialsanction",
    "delivery",
    "jobcompletion",
    "irpreparation",
    "irreceipt",
    "billpreparation",
    "billsentforpayment",
    "billreturnedforcorrection",
    "payment",
  ].includes(normalizeMilestoneName(value));
}

function isBgStatusKey(value: string) {
  const normalized = normalizeMilestoneName(value);
  return normalized === "psb" || normalized === "pwb" || normalized === "psbpwb";
}

function latestBillReturnCycleSql(source: string) {
  return `(select cycle
    from jsonb_array_elements(coalesce(${source}, '[]'::jsonb)) with ordinality as bill_return(cycle, cycle_index)
    where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
    order by nullif(bill_return.cycle ->> 'returnedDate', '')::date desc nulls last, bill_return.cycle_index desc
    limit 1)`;
}

function latestBillReturnStateSql(source: string, state: "open" | "resubmitted") {
  const resubmittedCondition = hasTextSql("latest.cycle ->> 'resubmittedDate'");
  return `exists (
    select 1 from (${latestBillReturnCycleSql(source)}) as latest(cycle)
    where ${state === "resubmitted" ? resubmittedCondition : `not ${resubmittedCondition}`}
  )`;
}

function completedOrderMilestoneSql(
  orderAlias: string,
  normalizedMilestone: string,
  includeAdvancePayment = true,
  includeOpenReturnedBillSent = false,
) {
  if (normalizeMilestoneName(normalizedMilestone) === "billsentforpayment") {
    const openBillReturnSql = (source: string) => latestBillReturnStateSql(source, "open");
    const returnExclusion = (source: string) =>
      includeOpenReturnedBillSent ? "" : `and not ${openBillReturnSql(source)}`;
    const advancePaymentSubmission = includeAdvancePayment
      ? `or (${isYesSql(`${orderAlias}.advance_payment`)}
        and ${hasTextSql(`${orderAlias}.advance_payment_detail ->> 'billSentForPaymentDate'`)}
        ${returnExclusion(`${orderAlias}.advance_payment_detail -> 'billReturnCycles'`)})`
      : "";
    return `((${hasTextSql(`${orderAlias}.bill_sent_for_payment_date`)}
        ${returnExclusion(`${orderAlias}.bill_return_cycles`)})
      ${advancePaymentSubmission}
      or exists (
        select 1
        from jsonb_array_elements(coalesce(${orderAlias}.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
        where ${hasTextSql("stage_row.stage ->> 'billSentForPaymentDate'")}
          ${returnExclusion("stage_row.stage -> 'billReturnCycles'")}
      ))`;
  }
  if (normalizeMilestoneName(normalizedMilestone) === "financialsanction") {
    return hasTextSql(`${orderAlias}.financial_sanction_date`);
  }
  if (normalizeMilestoneName(normalizedMilestone) === "jobcompletion") {
    return hasTextSql(`${orderAlias}.job_completion_date`);
  }
  if (normalizeMilestoneName(normalizedMilestone) === "delivery") {
    return hasTextSql(`${orderAlias}.material_receipt_date`);
  }
  if (normalizeMilestoneName(normalizedMilestone) === "billreturnedforcorrection") {
    const resolvedBillReturnSql = (source: string) => latestBillReturnStateSql(source, "resubmitted");
    return `(${resolvedBillReturnSql(`${orderAlias}.bill_return_cycles`)}
      or exists (
        select 1
        from jsonb_array_elements(coalesce(${orderAlias}.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
        where ${resolvedBillReturnSql("stage_row.stage -> 'billReturnCycles'")}
      )
      or ${resolvedBillReturnSql(`${orderAlias}.advance_payment_detail -> 'billReturnCycles'`)})`;
  }
  const dateColumns: Record<string, string> = {
    irpreparation: "ir_preparation_date",
    irreceipt: "ir_receipt_date",
    billpreparation: "bill_preparation_date",
    billsentforpayment: "bill_sent_for_payment_date",
    payment: "payment_date",
  };
  const dateColumn = dateColumns[normalizeMilestoneName(normalizedMilestone)];
  if (dateColumn) {
    if (normalizeMilestoneName(normalizedMilestone) === "billpreparation") {
      const advancePaymentPreparation = includeAdvancePayment
        ? `or (${isYesSql(`${orderAlias}.advance_payment`)}
          and ${hasTextSql(`${orderAlias}.advance_payment_detail ->> 'billPreparationDate'`)})`
        : "";
      return `(${hasTextSql(`${orderAlias}.${dateColumn}`)} ${advancePaymentPreparation})`;
    }
    return hasTextSql(`${orderAlias}.${dateColumn}`);
  }
  return `exists (
    select 1
    from jsonb_array_elements_text(coalesce(${orderAlias}.completed_milestones, '[]'::jsonb)) as completed_order(milestone)
    where ${normalizedSql("completed_order.milestone")} = '${normalizedMilestone}'
  )`;
}

function bgCategorySql(orderAlias: string, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") {
    return `${isYesSql(`${orderAlias}.psb_applicable`)}
      and ${orderAlias}.bg_coverage_type in ('PSB', 'PSB and PWB separately')`;
  }
  if (normalized === "pwb") {
    return `${isYesSql("f.bg")}
      and ${orderAlias}.bg_coverage_type in ('PWB', 'PSB and PWB separately')`;
  }
  if (normalized === "psbpwb") {
    return `${isYesSql("f.bg")} and ${orderAlias}.bg_coverage_type = 'PSB+PWB'`;
  }
  return "false";
}

function bgReceivedColumn(category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") return "psb_bg_received_date";
  if (normalized === "pwb") return "pwb_bg_received_date";
  if (normalized === "psbpwb") return "combined_bg_received_date";
  return "psb_bg_received_date";
}

function bgValidityColumn(category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") return "psb_bg_validity_date";
  if (normalized === "pwb") return "pwb_bg_validity_date";
  if (normalized === "psbpwb") return "combined_bg_validity_date";
  return "psb_bg_validity_date";
}

function bgReturnColumn(category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") return "psb_bg_return_date";
  if (normalized === "pwb") return "pwb_bg_return_date";
  if (normalized === "psbpwb") return "combined_bg_return_date";
  return "psb_bg_return_date";
}

function bgReceivedOrderSql(orderAlias: string, category: string) {
  return `(${hasTextSql(`${orderAlias}.${bgReceivedColumn(category)}`)}
    or ${completedOrderMilestoneSql(orderAlias, normalizeMilestoneName(category))})`;
}

function bgReceivedSql(category: string) {
  return supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")}
     and not ${isYesSql("so.no_further_action")}
     and ${bgCategorySql("so", category)}
     and ${bgReceivedOrderSql("so", category)}`,
  );
}

function financialSanctionCompletedOrderSql(orderAlias: string) {
  return hasTextSql(`${orderAlias}.financial_sanction_date`);
}

function financialSanctionCompletedSql() {
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")} and ${financialSanctionCompletedOrderSql("so")}`,
  )}`;
}

function financialSanctionPreviousStageSql() {
  return `not ${isCancelledFileSql()}
    and not (${financialSanctionCompletedSql()})
    and not (${financialSanctionPendingSql()})
    and (
      (not ${isYesSql("f.tcec")}
        and (
          (${biddingApplicableSql()}
            and ${normalizedSql("f.current_milestone")} = 'bidding'
            and not ${isYesSql("f.bidding_stage_over")})
          or (not ${biddingApplicableSql()}
            and ${normalizedSql("f.current_milestone")} = 'cfa'
            and not ${hasTextSql("f.cfa_date")})
        ))
      or (${isYesSql("f.tcec")}
        and ${normalizedSql("f.current_milestone")} = 'cnc'
        and not ${hasTextSql("f.cnc_approval_date")})
    )`;
}

function financialSanctionReachedSql() {
  return `not ${isCancelledFileSql()}
    and ((${biddingApplicableSql()} and ${isYesSql("f.bidding_stage_over")})
      or (not ${biddingApplicableSql()} and ${hasTextSql("f.cfa_date")}))
    and (not ${isYesSql("f.tcec")} or ${hasTextSql("f.cnc_approval_date")})`;
}

function financialSanctionPendingSql() {
  return `${financialSanctionReachedSql()} and not (${financialSanctionCompletedSql()})`;
}

function financialSanctionDelayPendingSql() {
  const pendingRecordedOrder = supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")}
     and not ${hasTextSql("so.financial_sanction_date")}`,
  );
  const expectedOrderSlot = `coalesce(f.no_of_so, 0) > ${supplyOrderCountSql()}`;
  return `not ${isCancelledFileSql()}
    and ${financialSanctionReachedSql()}
    and (${pendingRecordedOrder} or ${expectedOrderSlot})`;
}

function bgToBeReceivedSql(category: string) {
  const normalized = normalizeMilestoneName(category);
  const nonDeliveryFileType = `(not ${isYesSql("f.ir")} or ${contractFileTypeSql("f")})`;
  return supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")}
     and not ${isYesSql("so.no_further_action")}
     and ${bgCategorySql("so", category)}
     and (
       ('${normalized}' in ('psb', 'psbpwb') and ${hasTextSql("so.so_date")})
       or ('${normalized}' = 'pwb' and (
         (not ${nonDeliveryFileType} and ${hasTextSql("so.material_receipt_date")})
         or (${nonDeliveryFileType} and ${completedOrderMilestoneSql("so", "jobcompletion")})
       ))
     )
     and not ${bgReceivedOrderSql("so", category)}`,
  );
}

function bgReturnDueSql(category: string, today = "current_date") {
  const returnColumn = bgReturnColumn(category);
  const nonDeliveryFileType = `(not ${isYesSql("f.ir")} or ${contractFileTypeSql("f")})`;
  const stageRowsExist = `${isYesSql("so.stage_delivery")} and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0`;
  const allStagesHaveIrReceipt = `not exists (
    select 1 from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as psb_stage(stage)
    where coalesce(psb_stage.stage ->> 'irReceiptDate', '') = ''
  )`;
  const allStagesHaveJobCompletion = `not exists (
    select 1 from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as psb_stage(stage)
    where nullif(psb_stage.stage ->> 'jobCompletionDate', '')::date is null
  )`;
  const psbPurposeComplete = `((${nonDeliveryFileType} and ((${stageRowsExist} and ${allStagesHaveJobCompletion}) or (not (${stageRowsExist}) and ${completedOrderMilestoneSql(
    "so",
    "jobcompletion",
  )})))
    or (not ${nonDeliveryFileType} and ((${stageRowsExist} and ${allStagesHaveIrReceipt}) or (not (${stageRowsExist}) and ${hasTextSql("so.ir_receipt_date")}))))`;
  return supplyOrderExists(
    `${bgCategorySql("so", category)}
     and ${bgReceivedOrderSql("so", category)}
     and not ${hasTextSql(`so.${returnColumn}`)}
     and (
       ${isYesSql("so.so_cancelled")}
       or ('${normalizeMilestoneName(category)}' = 'psb' and ${isYesSql("so.shortclosure")})
       or (
         not ${isYesSql("so.so_cancelled")}
         and (
           ('${normalizeMilestoneName(category)}' = 'psb' and ${psbPurposeComplete})
           or (
             '${normalizeMilestoneName(category)}' <> 'psb'
             and ${hasTextSql("so.warranty_period_date")}
             and so.warranty_period_date + (
               coalesce((select bg_return_offset_days from app_settings where id = true), 60)
               * interval '1 day'
             ) < ${today}
           )
         )
       )
     )`,
  );
}

function bgReturnedSql(category: string) {
  const returnColumn = bgReturnColumn(category);
  return supplyOrderExists(
    `${bgCategorySql("so", category)}
     and ${hasTextSql(`so.${returnColumn}`)}`,
  );
}

function warrantyBgMismatchSql(category: string, bufferDays: number) {
  const normalized = normalizeMilestoneName(category);
  const days = Number.isInteger(bufferDays) && bufferDays >= 0 ? bufferDays : 60;
  const categories =
    normalized === "all"
      ? ["pwb", "psbpwb"]
      : normalized === "pwb" || normalized === "psbpwb"
        ? [normalized]
        : [];
  if (!categories.length) return "false";
  return `not ${isYesSql("f.demand_cancelled")} and ${supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")} and (${categories
      .map((item) => {
        const validityColumn = bgValidityColumn(item);
        const returnColumn = bgReturnColumn(item);
        return `(${bgCategorySql("so", item)}
          and ${bgReceivedOrderSql("so", item)}
          and not ${hasTextSql(`so.${returnColumn}`)}
          and ${hasTextSql("so.warranty_period_date")}
          and ${hasTextSql(`so.${validityColumn}`)}
          and so.${validityColumn} < so.warranty_period_date + interval '${days} day')`;
      })
      .join(" or ")})`,
  )}`;
}

function tcecStatusFilterSql(filter: string, values: unknown[]) {
  const [, rawStage = "pre", rawMetric = "reviewed", rawCommittee = "", rawMeetingDate = ""] =
    filter.split(":");
  const stage = decodeStatusFilterPart(rawStage) === "post" ? "post" : "pre";
  const metric = decodeStatusFilterPart(rawMetric);
  if (metric !== "reviewed" && metric !== "signed" && metric !== "pending") return "false";
  const committee = decodeStatusFilterPart(rawCommittee).trim();
  const meetingDate = decodeStatusFilterPart(rawMeetingDate).trim();
  const committeeColumn =
    stage === "pre"
      ? "f.pre_tcec_committee_no"
      : "coalesce(nullif(trim(f.refloat_post_tcec_committee_no), ''), f.post_tcec_committee_number)";
  const meetingDateColumn =
    stage === "pre" ? "f.pre_tcec_date" : "coalesce(f.refloat_post_tcec_date, f.post_tcec_date)";
  const minutesDateColumn =
    stage === "pre"
      ? "f.pre_tcec_minutes_date"
      : "coalesce(f.refloat_post_tcec_minutes_date, f.post_tcec_minutes_date)";
  const conditions = committee && committee.toLowerCase() !== "all"
    ? [tcecCommitteeConditionSql(committeeColumn, committee, values)]
    : [];
  if (metric === "signed") conditions.push(hasTextSql(minutesDateColumn));
  if (metric === "pending") conditions.push(`not ${hasTextSql(minutesDateColumn)}`);
  if (isValidDate(meetingDate)) {
    const meetingDatePlaceholder = addSqlValue(values, meetingDate);
    conditions.push(`${meetingDateColumn} = ${meetingDatePlaceholder}::date`);
  }
  if (!conditions.length) conditions.push(hasTextSql(meetingDateColumn));
  return conditions.join(" and ");
}

function fiscalYearDateCondition(dateColumn: string, fiscalYear: string, values: unknown[]) {
  const match = fiscalYear.match(/^(\d{4})-\d{2}$/);
  if (!match) return undefined;
  const startYear = Number(match[1]);
  const fromPlaceholder = addSqlValue(values, `${startYear}-04-01`);
  const toPlaceholder = addSqlValue(values, `${startYear + 1}-03-31`);
  return `${dateColumn} >= ${fromPlaceholder}::date and ${dateColumn} <= ${toPlaceholder}::date`;
}

function tcecStatusFyFilterSql(filter: string, values: unknown[]) {
  const [, rawStage = "pre", rawMetric = "reviewed", rawFy = "", rawCommittee = ""] =
    filter.split(":");
  const stage = decodeStatusFilterPart(rawStage) === "post" ? "post" : "pre";
  const metric = decodeStatusFilterPart(rawMetric);
  if (metric !== "reviewed" && metric !== "signed" && metric !== "pending") return "false";
  const fiscalYear = decodeStatusFilterPart(rawFy).trim();
  const committee = decodeStatusFilterPart(rawCommittee).trim();
  const committeeColumn =
    stage === "pre"
      ? "f.pre_tcec_committee_no"
      : "coalesce(nullif(trim(f.refloat_post_tcec_committee_no), ''), f.post_tcec_committee_number)";
  const meetingDateColumn =
    stage === "pre" ? "f.pre_tcec_date" : "coalesce(f.refloat_post_tcec_date, f.post_tcec_date)";
  const minutesDateColumn =
    stage === "pre"
      ? "f.pre_tcec_minutes_date"
      : "coalesce(f.refloat_post_tcec_minutes_date, f.post_tcec_minutes_date)";
  const fyCondition =
    fiscalYear === "all"
      ? undefined
      : fiscalYearDateCondition(meetingDateColumn, fiscalYear, values);
  if (fiscalYear !== "all" && !fyCondition) return "false";
  const conditions = [hasTextSql(meetingDateColumn)];
  if (fyCondition) conditions.push(fyCondition);
  if (committee) {
    conditions.push(tcecCommitteeConditionSql(committeeColumn, committee, values));
  }
  if (metric === "signed") conditions.push(hasTextSql(minutesDateColumn));
  if (metric === "pending") conditions.push(`not ${hasTextSql(minutesDateColumn)}`);
  return conditions.join(" and ");
}

function tcecCommitteeConditionSql(committeeColumn: string, committee: string, values: unknown[]) {
  if (committee.trim().toLowerCase() === "unassigned committee") {
    return `trim(coalesce(${committeeColumn}::text, '')) = ''`;
  }
  const committeePlaceholder = addSqlValue(values, committee.toLowerCase());
  return `lower(trim(coalesce(${committeeColumn}, ''))) = ${committeePlaceholder}`;
}

function cncSummaryFilterSql(filter: string, values: unknown[]) {
  const [, rawMetric = "reviewed", rawCncDate = ""] = filter.split(":");
  const metric = decodeStatusFilterPart(rawMetric);
  const cncDate = decodeStatusFilterPart(rawCncDate).trim();
  if (!isValidDate(cncDate)) return "false";
  const datePlaceholder = addSqlValue(values, cncDate);
  const conditions = [`f.cnc_date = ${datePlaceholder}::date`];
  const approved = hasTextSql("f.cnc_approval_date");
  const fsSigned = financialSanctionCompletedSql();
  const soPlaced = supplyOrderPlacedSql();
  if (metric === "name" || metric === "reviewed") return conditions.join(" and ");
  if (metric === "approved") conditions.push(approved);
  else if (metric === "financialSanctionSigned") conditions.push(fsSigned);
  else if (metric === "supplyOrderPlaced") conditions.push(soPlaced);
  else if (metric === "approvalPending") conditions.push(`not ${approved}`);
  else if (metric === "financialSanctionPending")
    conditions.push(`${approved} and not (${fsSigned})`);
  else if (metric === "supplyOrderPending") conditions.push(`${fsSigned} and not (${soPlaced})`);
  else return "false";
  return conditions.join(" and ");
}

function cncSummaryFyFilterSql(filter: string, values: unknown[]) {
  const [, rawMetric = "reviewed", rawFy = ""] = filter.split(":");
  const metric = decodeStatusFilterPart(rawMetric);
  const fiscalYear = decodeStatusFilterPart(rawFy).trim();
  const fyCondition =
    fiscalYear === "all" ? undefined : fiscalYearDateCondition("f.cnc_date", fiscalYear, values);
  if (fiscalYear !== "all" && !fyCondition) return "false";
  const conditions = [hasTextSql("f.cnc_date")];
  if (fyCondition) conditions.push(fyCondition);
  const approved = hasTextSql("f.cnc_approval_date");
  const fsSigned = financialSanctionCompletedSql();
  const soPlaced = supplyOrderPlacedSql();
  if (metric === "name" || metric === "reviewed") return conditions.join(" and ");
  if (metric === "approved") conditions.push(approved);
  else if (metric === "financialSanctionSigned") conditions.push(fsSigned);
  else if (metric === "supplyOrderPlaced") conditions.push(soPlaced);
  else if (metric === "approvalPending") conditions.push(`not ${approved}`);
  else if (metric === "financialSanctionPending")
    conditions.push(`${approved} and not ${fsSigned}`);
  else if (metric === "supplyOrderPending") conditions.push(`${fsSigned} and not ${soPlaced}`);
  else return "false";
  return conditions.join(" and ");
}

function bgReceiptDelayBaseExpiredSql(category: string, days: number, nextDays?: number) {
  const normalized = normalizeMilestoneName(category);
  if (!isBgStatusKey(normalized)) return "false";
  const contract = contractFileTypeSql("f");
  const stageRows = `jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb))`;
  const stageDates = (field: string, aggregate: "min" | "max") =>
    `(select ${aggregate}(nullif(bg_delay_stage.stage ->> '${field}', '')::date)
      from ${stageRows} as bg_delay_stage(stage))`;
  const hasStages = `${isYesSql("so.stage_delivery")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0`;
  const allJobStagesComplete = `not exists (
    select 1 from ${stageRows} as bg_delay_stage(stage)
    where not ${hasTextSql("bg_delay_stage.stage ->> 'actualJobCompletionDate'")}
  )`;
  const stageJobDate = `case when ${hasStages} then
    case when ${isYesSql("so.stage_payment")}
      then ${stageDates("actualJobCompletionDate", "min")}
      when ${allJobStagesComplete} then ${stageDates("actualJobCompletionDate", "max")}
      else null::date end
    else null::date end`;
  const genericStageDate = (field: string) =>
    `case when ${isYesSql("so.stage_delivery")}
      then ${stageDates(field, "min")} else null::date end`;
  const baseDate = normalized === "psb" || normalized === "psbpwb"
    ? "so.so_date"
    : `case
      when ${contract} then so.so_date
      when not ${contract} and ${isNoSql("f.ir")} and ${hasStages}
        then ${stageJobDate}
      when not ${contract} and ${isYesSql("f.ir")}
        then so.ir_receipt_date
      else least(so.actual_job_completion_date, ${genericStageDate("actualJobCompletionDate")})
    end`;
  const elapsedDays = `(current_date - (${baseDate})::date)`;
  return `(${elapsedDays} > ${days}${nextDays === undefined ? "" : ` and ${elapsedDays} <= ${nextDays}`})`;
}

function preBidMeetingFilterSql(refloat: boolean, state: "due" | "completed") {
  const applies = refloat
    ? `${isYesSql("f.refloat")} and ${isYesSql("f.refloat_pre_bid_meeting")}`
    : isYesSql("f.pre_bid_meeting");
  const dateColumn = refloat ? "f.refloat_pre_bid_meeting_date" : "f.pre_bid_meeting_date";
  const dateState =
    state === "completed" ? `${dateColumn} < current_date` : `${dateColumn} >= current_date`;
  return `${biddingApplicableSql()}
    and ${applies}
    and ${hasTextSql(dateColumn)}
    and ${dateState}`;
}

function bgExpiredSql(category: string, today = "current_date") {
  const returnColumn = bgReturnColumn(category);
  const validityColumn = bgValidityColumn(category);
  const nonDeliveryFileType = `(not ${isYesSql("f.ir")} or ${contractFileTypeSql("f")})`;
  const stageRowsExist = `${isYesSql("so.stage_delivery")} and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0`;
  const allStagesHaveIrReceipt = `not exists (
    select 1 from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as psb_stage(stage)
    where coalesce(psb_stage.stage ->> 'irReceiptDate', '') = ''
  )`;
  const allStagesHaveJobCompletion = `not exists (
    select 1 from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as psb_stage(stage)
    where nullif(psb_stage.stage ->> 'jobCompletionDate', '')::date is null
  )`;
  const psbPurposeComplete = `((${nonDeliveryFileType} and ((${stageRowsExist} and ${allStagesHaveJobCompletion}) or (not (${stageRowsExist}) and ${completedOrderMilestoneSql(
    "so",
    "jobcompletion",
  )})))
    or (not ${nonDeliveryFileType} and ((${stageRowsExist} and ${allStagesHaveIrReceipt}) or (not (${stageRowsExist}) and ${hasTextSql("so.ir_receipt_date")}))))`;
  return supplyOrderExists(
    `${bgCategorySql("so", category)}
     and ${bgReceivedOrderSql("so", category)}
     and not ${hasTextSql(`so.${returnColumn}`)}
     and not ${isYesSql("so.so_cancelled")}
     and (
       ('${normalizeMilestoneName(category)}' = 'psb' and not (${psbPurposeComplete}))
       or ('${normalizeMilestoneName(category)}' <> 'psb' and not ${hasTextSql("so.payment_date")})
     )
     and ${hasTextSql(`so.${validityColumn}`)}
     and so.${validityColumn} < ${today}`,
  );
}

function completedStageMilestoneSql(
  orderAlias: string,
  normalizedMilestone: string,
  includeOpenReturnedBillSent = false,
) {
  const dateFields: Record<string, string> = {
    delivery: "materialReceiptDate",
    jobcompletion: "jobCompletionDate",
    irpreparation: "irPreparationDate",
    irreceipt: "irReceiptDate",
    billpreparation: "billPreparationDate",
    billsentforpayment: "billSentForPaymentDate",
    payment: "paymentDate",
  };
  const dateField = dateFields[normalizeMilestoneName(normalizedMilestone)];
  if (dateField) {
    return `exists (
      select 1
      from jsonb_array_elements(coalesce(${orderAlias}.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
      where ${hasTextSql(`stage_row.stage ->> '${dateField}'`)}
        ${
          normalizeMilestoneName(normalizedMilestone) === "billsentforpayment" &&
          !includeOpenReturnedBillSent
            ? `and not ${latestBillReturnStateSql("stage_row.stage -> 'billReturnCycles'", "open")}`
            : ""
        }
    )`;
  }
  return `exists (
    select 1
    from jsonb_array_elements(coalesce(${orderAlias}.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
    cross join lateral jsonb_array_elements_text(coalesce(stage_row.stage -> 'completedMilestones', '[]'::jsonb)) as completed_stage(milestone)
    where ${normalizedSql("completed_stage.milestone")} = '${normalizedMilestone}'
  )`;
}

function currentStageMilestoneSql(orderAlias: string, normalizedMilestoneSql: string) {
  return `exists (
				    select 1
				    from jsonb_array_elements(coalesce(${orderAlias}.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
			    where ${isYesSql(`${orderAlias}.stage_delivery`)}
			      and (
			      (${normalizedSql("stage_row.stage ->> 'currentMilestone'")} = ${normalizedMilestoneSql}
			        and ${normalizedMilestoneSql} <> 'deliveryperiod'
				        and ${normalizedMilestoneSql} <> 'jobcompletion'
				        and ${normalizedMilestoneSql} <> 'billpreparation'
				        and ${normalizedMilestoneSql} <> 'billreturnedforcorrection'
				        and ${normalizedMilestoneSql} <> 'billsentforpayment')
			      or (${normalizedMilestoneSql} = 'deliveryperiod'
			        and coalesce(
			          nullif(stage_row.stage ->> 'revisedDp', ''),
			          nullif(stage_row.stage ->> 'dpDate', ''),
			          ''
			        ) = '')
			      or (${normalizedMilestoneSql} = 'billsentforpayment'
		        and ${hasTextSql("stage_row.stage ->> 'billPreparationDate'")}
		        and not ${hasTextSql("stage_row.stage ->> 'billSentForPaymentDate'")}
        and not ${latestBillReturnStateSql("stage_row.stage -> 'billReturnCycles'", "open")})
			      or (${normalizedMilestoneSql} = 'billreturnedforcorrection'
        and ${latestBillReturnStateSql("stage_row.stage -> 'billReturnCycles'", "open" )})
			      or (${normalizedMilestoneSql} = 'billpreparation'
		        and ${isYesSql(`${orderAlias}.stage_payment`)}
			        and not ${hasTextSql("stage_row.stage ->> 'billPreparationDate'")}
			        and (
		          (${isYesSql("f.ir")} and ${hasTextSql("stage_row.stage ->> 'irReceiptDate'")})
		          or ((not ${isYesSql("f.ir")}
		            or ${contractFileTypeSql("f")})
		            and ${hasTextSql("stage_row.stage ->> 'jobCompletionDate'")})
		        ))
		    )
		  )`;
}

function inferredOrderCurrentMilestoneSql(orderAlias: string) {
  return `case
	    when ${hasTextSql(`${orderAlias}.so_date`)}
	     and not ${isYesSql(`${orderAlias}.stage_delivery`)}
	     and ${effectiveDpDateSql(orderAlias)} is null
	     and not ${isYesSql(`${orderAlias}.so_cancelled`)}
	      then 'deliveryperiod'
	    when ${hasTextSql(`${orderAlias}.so_date`)}
	     and ${effectiveDpDateSql(orderAlias)} is not null
     and not ${hasTextSql(`${orderAlias}.material_receipt_date`)}
     and not ${isYesSql(`${orderAlias}.so_cancelled`)}
      then 'delivery'
    when ${isYesSql("f.bg")}
     and ${financialSanctionCompletedOrderSql(orderAlias)}
     and ${orderAlias}.bg_coverage_type = 'PSB+PWB'
     and not ${hasTextSql(`${orderAlias}.combined_bg_received_date`)}
     and not ${isYesSql(`${orderAlias}.so_cancelled`)}
      then 'psbpwb'
    when ${isYesSql("f.bg")}
     and ${hasTextSql(`${orderAlias}.material_receipt_date`)}
     and ${orderAlias}.bg_coverage_type in ('PWB', 'PSB and PWB separately')
     and not ${hasTextSql(`${orderAlias}.pwb_bg_received_date`)}
     and not ${isYesSql(`${orderAlias}.so_cancelled`)}
      then 'pwb'
    when ${isYesSql("f.ir")}
     and ${hasTextSql(`${orderAlias}.material_receipt_date`)}
     and not ${hasTextSql(`${orderAlias}.ir_preparation_date`)}
     and not ${isYesSql(`${orderAlias}.so_cancelled`)}
      then 'irpreparation'
    when ${isYesSql("f.ir")}
     and ${hasTextSql(`${orderAlias}.ir_preparation_date`)}
     and not ${hasTextSql(`${orderAlias}.ir_receipt_date`)}
     and not ${isYesSql(`${orderAlias}.so_cancelled`)}
      then 'irreceipt'
    else ''
  end`;
}

function inferredOrderCurrentMilestoneMatchesSql(
  orderAlias: string,
  normalizedMilestoneSql: string,
) {
  const stageRowsExist = `${isYesSql(`${orderAlias}.stage_delivery`)}
    and jsonb_array_length(coalesce(${orderAlias}.stage_deliveries, '[]'::jsonb)) > 0`;
  const allStagesHaveJobCompletion = `not exists (
    select 1
    from jsonb_array_elements(coalesce(${orderAlias}.stage_deliveries, '[]'::jsonb)) as bill_prep_stage(stage)
    where not ${hasTextSql("bill_prep_stage.stage ->> 'jobCompletionDate'")}
  )`;
  return `(
	    (${normalizedMilestoneSql} = 'deliveryperiod'
	      and ${hasTextSql(`${orderAlias}.so_date`)}
	      and not ${isYesSql(`${orderAlias}.stage_delivery`)}
	      and ${effectiveDpDateSql(orderAlias)} is null
	      and not ${isYesSql(`${orderAlias}.so_cancelled`)})
	    or
	    (${normalizedMilestoneSql} = 'delivery'
	      and ${hasTextSql(`${orderAlias}.so_date`)}
      and ${effectiveDpDateSql(orderAlias)} is not null
      and not ${hasTextSql(`${orderAlias}.material_receipt_date`)}
      and not ${isYesSql(`${orderAlias}.so_cancelled`)})
    or (${normalizedMilestoneSql} = 'psbpwb'
      and ${isYesSql("f.bg")}
      and ${financialSanctionCompletedOrderSql(orderAlias)}
      and ${orderAlias}.bg_coverage_type = 'PSB+PWB'
      and not ${hasTextSql(`${orderAlias}.combined_bg_received_date`)}
      and not ${isYesSql(`${orderAlias}.so_cancelled`)})
    or (${normalizedMilestoneSql} = 'pwb'
      and ${isYesSql("f.bg")}
      and ${hasTextSql(`${orderAlias}.material_receipt_date`)}
      and ${orderAlias}.bg_coverage_type in ('PWB', 'PSB and PWB separately')
      and not ${hasTextSql(`${orderAlias}.pwb_bg_received_date`)}
      and not ${isYesSql(`${orderAlias}.so_cancelled`)})
    or (${normalizedMilestoneSql} = 'irpreparation'
      and ${isYesSql("f.ir")}
      and ${hasTextSql(`${orderAlias}.material_receipt_date`)}
      and not ${hasTextSql(`${orderAlias}.ir_preparation_date`)}
      and not ${isYesSql(`${orderAlias}.so_cancelled`)})
	    or (${normalizedMilestoneSql} = 'irreceipt'
	      and ${isYesSql("f.ir")}
	      and ${hasTextSql(`${orderAlias}.ir_preparation_date`)}
	      and not ${hasTextSql(`${orderAlias}.ir_receipt_date`)}
	      and not ${isYesSql(`${orderAlias}.so_cancelled`)})
	    or (${normalizedMilestoneSql} = 'jobcompletion'
	      and ${hasTextSql(`${orderAlias}.so_date`)}
	      and (not ${isYesSql("f.ir")}
	        or ${contractFileTypeSql("f")})
	      and not ${completedOrderMilestoneSql(orderAlias, "jobcompletion")}
	      and ${effectiveDpDateSql(orderAlias)} is not null
	      and ${effectiveDpDateSql(orderAlias)} < current_date
	      and not ${isYesSql(`${orderAlias}.so_cancelled`)})
		    or (${normalizedMilestoneSql} = 'billsentforpayment'
		      and ${hasTextSql(`${orderAlias}.bill_preparation_date`)}
		      and not ${hasTextSql(`${orderAlias}.bill_sent_for_payment_date`)}
		      and not exists (
		        select 1 where ${latestBillReturnStateSql(`${orderAlias}.bill_return_cycles`, "open")}
		      )
		      and not ${isYesSql(`${orderAlias}.so_cancelled`)})
		    or (${normalizedMilestoneSql} = 'billreturnedforcorrection'
		      and ${latestBillReturnStateSql(`${orderAlias}.bill_return_cycles`, "open")}
		      and not ${isYesSql(`${orderAlias}.so_cancelled`)})
	    or (${normalizedMilestoneSql} = 'billpreparation'
	      and not ${hasTextSql(`${orderAlias}.bill_preparation_date`)}
	      and (
	        (${stageRowsExist}
	          and ${isNoSql(`${orderAlias}.stage_payment`)}
	          and (not ${isYesSql("f.ir")} or ${contractFileTypeSql("f")})
	          and ${allStagesHaveJobCompletion})
	        or (
	        (${isYesSql("f.ir")} and ${hasTextSql(`${orderAlias}.ir_receipt_date`)})
	        or ((not ${isYesSql("f.ir")}
	          or ${contractFileTypeSql("f")})
	          and ${hasTextSql(`${orderAlias}.job_completion_date`)})
	        )
	      )
	      and not ${isYesSql(`${orderAlias}.so_cancelled`)})
	  )`;
}

function supplyOrderDrivenCurrentMilestoneConditionSql(normalizedMilestoneSql: string) {
  const paymentFollowUpMilestone = `${normalizedMilestoneSql} in (
    'advancepayment', 'billpreparation', 'billsentforpayment', 'billreturnedforcorrection', 'payment'
  )`;
  return `not ${isCancelledFileSql()} and (
    (${normalizedMilestoneSql} = 'financialsanction' and ${financialSanctionPendingSql()})
    or
    (not ${supplyOrderRowExists()} and ${normalizedSql("f.current_milestone")} = ${normalizedMilestoneSql})
    or exists (
      select 1
      from supply_orders so_current
      where so_current.file_id = f.id
        and not ${isYesSql("so_current.so_cancelled")}
        and (not ${paymentFollowUpMilestone} or not ${isYesSql("so_current.no_further_action")})
        and (
          (${normalizedMilestoneSql} = 'supplyorder' and ${supplyOrderPendingOrderSql("so_current")})
          or (
	            ${normalizedMilestoneSql} <> 'supplyorder'
	            and (
			              (
			                ${normalizedSql("so_current.current_milestone")} = ${normalizedMilestoneSql}
			                and ${normalizedMilestoneSql} <> 'deliveryperiod'
				                and ${normalizedMilestoneSql} <> 'jobcompletion'
			                and ${normalizedMilestoneSql} <> 'billpreparation'
			                and ${normalizedMilestoneSql} <> 'billreturnedforcorrection'
			                and ${normalizedMilestoneSql} <> 'billsentforpayment'
			              )
			              or ${currentStageMilestoneSql("so_current", normalizedMilestoneSql)}
			              or ${inferredOrderCurrentMilestoneMatchesSql("so_current", normalizedMilestoneSql)}
			              or (${normalizedMilestoneSql} = 'billreturnedforcorrection'
	                and ${latestBillReturnStateSql("so_current.advance_payment_detail -> 'billReturnCycles'", "open")})
		            )
	          )
	        )
    )
  )`;
}

function supplyOrderDrivenCurrentMilestoneSql(milestone: string, values: unknown[]) {
  const normalized = addSqlValue(values, normalizeMilestoneName(milestone));
  const condition = supplyOrderDrivenCurrentMilestoneConditionSql(normalized);
  return normalizeMilestoneName(milestone) === "delivery"
    ? `${deliveryInspectionApplicableSql()} and ${condition}`
    : condition;
}

function supplyOrderDrivenCompletedMilestoneConditionSql(
  normalizedMilestone: string,
  includeAdvancePayment = true,
  includeOpenReturnedBillSent = false,
) {
  if (normalizedMilestone === "supplyorder") {
    return `not ${isYesSql("f.demand_cancelled")} and ${supplyOrderExists(
      supplyOrderTabCompleteSql("so"),
    )}`;
  }
  const fileMilestoneComplete = completedMilestoneExists(
    `${normalizedSql("completed.milestone")} = '${normalizedMilestone}'`,
  );
  return `not ${isYesSql("f.demand_cancelled")} and (
    (
      ${allSupplyOrdersCancelledSql()}
      and ${fileMilestoneComplete}
    )
    or (
      not ${isCancelledFileSql()} and (
        (
          not ${supplyOrderRowExists()}
          and ${fileMilestoneComplete}
        )
        or exists (
          select 1
          from supply_orders so_completed
          where so_completed.file_id = f.id
            and not ${isYesSql("so_completed.so_cancelled")}
            and (
              ${completedOrderMilestoneSql(
                "so_completed",
                normalizedMilestone,
                includeAdvancePayment,
                includeOpenReturnedBillSent,
              )}
              or ${completedStageMilestoneSql(
                "so_completed",
                normalizedMilestone,
                includeOpenReturnedBillSent,
              )}
            )
        )
      )
    )
  )`;
}

function analyticsBillPreparationContributorSql() {
  const hasStages = `${isYesSql("so.stage_delivery")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0`;
  const commonStagePayment = `(${hasStages} and not ${isYesSql("so.stage_payment")})`;
  const latestStageDate = (dateExpression: string) => `(select case
    when count(*) > 0 and count(stage_dates.stage_date) = count(*) then max(stage_dates.stage_date)
    else null
  end
  from (
    select ${dateExpression} as stage_date
    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as delivery_stage(stage)
  ) as stage_dates)`;
  const stageDpDate = `coalesce(
    nullif(payment_stage.stage ->> 'revisedDp', '')::date,
    nullif(payment_stage.stage ->> 'dpDate', '')::date
  )`;
  const commonStageDpDate = `coalesce(
    nullif(delivery_stage.stage ->> 'revisedDp', '')::date,
    nullif(delivery_stage.stage ->> 'dpDate', '')::date
  )`;
  const paymentDpDate = `case
    when ${commonStagePayment}
      then ${latestStageDate(commonStageDpDate)}
    else coalesce(
      nullif(payment_stage.stage ->> 'revisedDp', '')::date,
      nullif(payment_stage.stage ->> 'dpDate', '')::date,
      so.revised_dp,
      so.dp_date
    )
  end`;
  const paymentMaterialReceiptDate = `case
    when ${commonStagePayment}
      then ${latestStageDate("nullif(delivery_stage.stage ->> 'materialReceiptDate', '')::date")}
    when ${hasStages}
      then nullif(payment_stage.stage ->> 'materialReceiptDate', '')::date
    else so.material_receipt_date
  end`;
  const paymentJobCompletionDate = `case
    when ${commonStagePayment}
      then ${latestStageDate("nullif(delivery_stage.stage ->> 'jobCompletionDate', '')::date")}
    when ${hasStages} and ${isYesSql("so.stage_payment")}
      then nullif(payment_stage.stage ->> 'jobCompletionDate', '')::date
    else coalesce(nullif(payment_stage.stage ->> 'jobCompletionDate', '')::date, so.job_completion_date)
  end`;
  const paymentIrReceiptDate = `case
    when ${commonStagePayment}
      then ${latestStageDate("nullif(delivery_stage.stage ->> 'irReceiptDate', '')::date")}
    when ${hasStages}
      then nullif(payment_stage.stage ->> 'irReceiptDate', '')::date
    else so.ir_receipt_date
  end`;
  const paymentClearingStart = `case
    when ${deliveryInspectionApplicableSql()} then ${paymentMaterialReceiptDate}
    when ${contractFileTypeSql("f")} and ${isYesSql("so.shortclosure")}
      then ${paymentJobCompletionDate}
    when ${contractFileTypeSql("f")} and ${paymentDpDate} is not null
      then (${paymentDpDate} + 1)
    when not ${isYesSql("f.ir")} and not ${contractFileTypeSql("f")}
      and ${paymentJobCompletionDate} is not null
      then ${paymentJobCompletionDate}
    else null
  end`;
  const startDate = `case
    when ${deliveryInspectionApplicableSql()} and ${isYesSql("f.ir")}
      then ${paymentIrReceiptDate}
    else ${paymentClearingStart}
  end`;
  const endDate = `coalesce(
    nullif(payment_stage.stage ->> 'billPreparationDate', '')::date,
    so.bill_preparation_date
  )`;
  const stageJoin = `left join lateral jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as payment_stage(stage)
    on not (${isYesSql("so.stage_delivery")} and not ${isYesSql("so.stage_payment")})
      and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0`;

  return `not ${isYesSql("f.demand_cancelled")} and exists (
    select 1
    from supply_orders so
    ${stageJoin}
    cross join lateral (
      select (${startDate}) as start_date, (${endDate}) as end_date
    ) bill_preparation_dates
    where so.file_id = f.id
      and not ${isYesSql("so.so_cancelled")}
      and bill_preparation_dates.end_date is not null
      and bill_preparation_dates.start_date is not null
      and bill_preparation_dates.end_date >= bill_preparation_dates.start_date
  )`;
}

function statusAppliesSql(milestone: (typeof statusSummaryMilestones)[number]) {
  if (milestone.key === "bidding")
    return `${biddingApplicableSql()} and not ${isYesSql("f.refloat")}`;
  if (milestone.key === "refloatPostTcec")
    return `${isYesSql("f.refloat")} and ${isYesSql("f.tcec")} and ${isYesSql("f.bidding_stage_over")}`;
  return "appliesColumn" in milestone && milestone.appliesColumn
    ? isYesSql(milestone.appliesColumn)
    : "true";
}

function statusCompleteSql(milestone: (typeof statusSummaryMilestones)[number]) {
  if ("yesComplete" in milestone && milestone.yesComplete) {
    return isYesSql(milestone.currentColumn);
  }
  if ("supplyOrderDate" in milestone && milestone.supplyOrderDate) {
    if (milestone.key === "financialSanction") return financialSanctionCompletedSql();
    if (milestone.key === "supplyOrder") return supplyOrderPlacedSql();
    return supplyOrderChildSql(
      hasTextSql(`so.${milestone.supplyOrderDate}`),
      hasTextSql(`f.${milestone.supplyOrderDate}`),
    );
  }
  return "currentColumn" in milestone && milestone.currentColumn
    ? hasTextSql(milestone.currentColumn)
    : "false";
}

function statusReviewedSql(milestone: (typeof statusSummaryMilestones)[number]) {
  return "reviewedColumn" in milestone && milestone.reviewedColumn
    ? hasTextSql(milestone.reviewedColumn)
    : "false";
}

function statusActiveSql(milestone: (typeof statusSummaryMilestones)[number]) {
  if (milestone.key === "refloatBidding") {
    return `not ${isCancelledFileSql()} and ${refloatBiddingInProgressSql()}`;
  }
  if (milestone.key === "refloatPostTcec") {
    return `not ${isCancelledFileSql()}
      and ${isYesSql("f.refloat")}
      and ${isYesSql("f.tcec")}
      and ${isYesSql("f.bidding_stage_over")}
      and not ${hasTextSql("f.refloat_post_tcec_minutes_date")}`;
  }
  if (milestone.key === "financialSanction") {
    return financialSanctionPendingSql();
  }
  if (isBgStatusKey(milestone.key)) {
    return bgToBeReceivedSql(milestone.key);
  }
  const aliases =
    "aliases" in milestone && milestone.aliases ? milestone.aliases : [milestone.label];
  const normalizedAliases = aliases.map((alias) => `'${normalizeMilestoneName(alias)}'`).join(", ");
  return `not ${isCancelledFileSql()}
    and ${normalizedSql("f.current_milestone")} in (${normalizedAliases})`;
}

function milestoneByKey(key: string) {
  return statusSummaryMilestones.find((item) => item.key === key);
}

function milestoneAppliesSql(milestone: (typeof statusSummaryMilestones)[number]) {
  return isBgStatusKey(milestone.key)
    ? supplyOrderExists(
        `not ${isYesSql("so.so_cancelled")} and ${bgCategorySql("so", milestone.key)}`,
      )
    : statusAppliesSql(milestone);
}

function milestoneCompleteSql(milestone: (typeof statusSummaryMilestones)[number]) {
  if ("supplyOrderDate" in milestone && milestone.supplyOrderDate) {
    if (milestone.key === "financialSanction") return financialSanctionCompletedSql();
    if (isBgStatusKey(milestone.key)) return bgReceivedSql(milestone.key);
    if (milestone.key === "supplyOrder") return supplyOrderPlacedSql();
    return supplyOrderChildSql(
      hasTextSql(`so.${milestone.supplyOrderDate}`),
      hasTextSql(`f.${milestone.supplyOrderDate}`),
    );
  }
  return statusCompleteSql(milestone);
}

function isFlexiblePreControlStatusMilestone(
  milestone: Pick<(typeof statusSummaryMilestones)[number], "key">,
) {
  return ["highValue", "tcec", "ad", "rqa"].includes(milestone.key);
}

function allApplicableStatusMilestonesCompleteSql(
  milestones: Array<(typeof statusSummaryMilestones)[number]>,
) {
  const checks = milestones.map(
    (milestone) => `(not (${statusAppliesSql(milestone)}) or (${milestoneCompleteSql(milestone)}))`,
  );
  return checks.length ? checks.join(" and ") : hasTextSql("f.received_date");
}

function previousStatusCompleteSql(index: number) {
  const milestone = statusSummaryMilestones[index];
  if (!milestone || index <= 0) return hasTextSql("f.received_date");
  if (isFlexiblePreControlStatusMilestone(milestone)) {
    const scrutiny = statusSummaryMilestones.find((item) => item.key === "scrutiny");
    return scrutiny ? milestoneCompleteSql(scrutiny) : hasTextSql("f.received_date");
  }
  const controlIndex = statusSummaryMilestones.findIndex((item) => item.key === "control");
  if (controlIndex >= 0 && index >= controlIndex) {
    return allApplicableStatusMilestonesCompleteSql(statusSummaryMilestones.slice(0, index));
  }
  const scrutiny = statusSummaryMilestones.find((item) => item.key === "scrutiny");
  return scrutiny ? milestoneCompleteSql(scrutiny) : hasTextSql("f.received_date");
}

function milestoneEligibleSql(milestone: (typeof statusSummaryMilestones)[number]) {
  const index = statusSummaryMilestones.findIndex((item) => item.key === milestone.key);
  const previousComplete = isBgStatusKey(milestone.key)
    ? supplyOrderPlacedSql()
    : previousStatusCompleteSql(index);
  return `not ${isCancelledFileSql()} and ${milestoneAppliesSql(milestone)} and ${previousComplete}`;
}

function milestonePendingSql(milestone: (typeof statusSummaryMilestones)[number]) {
  if (milestone.key === "refloatBidding") {
    return refloatBiddingInProgressSql();
  }
  if (milestone.key === "refloatPostTcec") {
    return `${statusAppliesSql(milestone)} and not ${hasTextSql("f.refloat_post_tcec_minutes_date")}`;
  }
  if (milestone.key === "supplyOrder") {
    return supplyOrderDrivenCurrentMilestoneConditionSql("'supplyorder'");
  }
  if (milestone.key === "financialSanction") {
    return financialSanctionPendingSql();
  }
  if (isBgStatusKey(milestone.key)) {
    return bgToBeReceivedSql(milestone.key);
  }
  const complete = milestoneCompleteSql(milestone);
  const active = statusActiveSql(milestone);
  if ("reviewedColumn" in milestone && milestone.reviewedColumn) {
    return `${active} and not ${hasTextSql(milestone.reviewedColumn)} and not (${complete})`;
  }
  return `${active} and not (${complete})`;
}

function milestonePreviousStageSql(milestone: (typeof statusSummaryMilestones)[number]) {
  if (milestone.key === "refloatBidding") return "false";
  if (milestone.key === "refloatPostTcec") {
    return `${isYesSql("f.refloat")} and ${isYesSql("f.tcec")} and not ${isYesSql("f.bidding_stage_over")}`;
  }
  if (milestone.key === "financialSanction") return financialSanctionPreviousStageSql();
  const eligible = milestoneEligibleSql(milestone);
  const complete =
    isSupplyOrderDrivenMilestoneName(milestone.label) &&
    !["financialsanction", "supplyorder"].includes(normalizeMilestoneName(milestone.label))
      ? supplyOrderDrivenCompletedMilestoneConditionSql(normalizeMilestoneName(milestone.label))
      : milestoneCompleteSql(milestone);
  const pending = milestonePendingSql(milestone);
  const reviewed =
    "reviewedColumn" in milestone && milestone.reviewedColumn
      ? `${statusActiveSql(milestone)} and ${hasTextSql(milestone.reviewedColumn)} and not (${complete})`
      : "false";
  const biddingStarted =
    milestone.key === "bidding"
      ? ` or ${normalBidLiveSql()} or ${bidOpeningOverdueSql()}`
      : "";
  return `${eligible} and not (${complete}) and not (${pending}) and not (${reviewed})${biddingStarted ? ` and not (${biddingStarted.slice(4)})` : ""}`;
}

function dashboardMilestoneFilterSql(filter: string) {
  const readKey = (prefix: string) => filter.slice(prefix.length);
  const resolve = (prefix: string) => milestoneByKey(readKey(prefix));

  if (filter.startsWith("milestoneTotal:")) {
    const milestone = resolve("milestoneTotal:");
    if (milestone?.key === "payment") return `(${paymentPendingSql()} or ${paymentCompletedSql()})`;
    if (milestone?.key === "financialSanction")
      return `(${financialSanctionPendingSql()} or ${financialSanctionCompletedSql()})`;
    return milestone ? milestoneAppliesSql(milestone) : "true";
  }
  if (filter.startsWith("milestoneUnderProcess:")) {
    const milestone = resolve("milestoneUnderProcess:");
    return milestone ? milestonePreviousStageSql(milestone) : "true";
  }
  if (filter.startsWith("milestoneActive:")) {
    const milestone = resolve("milestoneActive:");
    if (!milestone) return "true";
    if (milestone.key === "bidding")
      return `not ${isCancelledFileSql()} and ${biddingApplicableSql()} and not ${isYesSql("f.refloat")} and ${hasTextSql("f.cfa_date")} and not ${isYesSql("f.bidding_stage_over")} and not (${normalBidLiveSql()}) and not (${bidOpeningOverdueSql()})`;
    return statusActiveSql(milestone);
  }
  if (filter.startsWith("milestoneReviewed:")) {
    const milestone = resolve("milestoneReviewed:");
    return milestone && "reviewedColumn" in milestone && milestone.reviewedColumn
      ? `${statusActiveSql(milestone)} and ${hasTextSql(milestone.reviewedColumn)} and not (${milestoneCompleteSql(milestone)})`
      : "false";
  }
  if (filter.startsWith("milestonePending:")) {
    const milestone = resolve("milestonePending:");
    if (milestone?.key === "payment") return paymentPendingSql({ includeReturnedUnpaid: true });
    return milestone ? milestonePendingSql(milestone) : "true";
  }
  if (filter.startsWith("milestone:")) {
    const milestone = resolve("milestone:");
    if (milestone?.key === "payment") return paymentPendingSql({ includeReturnedUnpaid: true });
    return milestone ? milestonePendingSql(milestone) : "true";
  }
  if (filter.startsWith("milestoneCleared:")) {
    const milestone = resolve("milestoneCleared:");
    if (milestone?.key === "payment") return paymentCompletedSql();
    return milestone
      ? `${milestoneAppliesSql(milestone)} and ${milestoneCompleteSql(milestone)}`
      : "true";
  }
  if (filter.startsWith("milestoneEligible:")) {
    const milestone = resolve("milestoneEligible:");
    return milestone ? milestoneEligibleSql(milestone) : "true";
  }
  return undefined;
}

function statusSupplyOrderPlacedSql() {
  return supplyOrderPlacedSql();
}

function statusDeliveryDueOrderSql(extraCondition = "true") {
  return supplyOrderChildSql(
    `${hasTextSql("so.so_date")}
     and not ${hasTextSql("so.material_receipt_date")}
     and not ${isYesSql("so.so_cancelled")}
     and not ${isYesSql("so.shortclosure")}
     and ${extraCondition}`,
    `${hasTextSql("f.so_date")}
     and not ${hasTextSql("f.material_receipt_date")}
     and not ${isYesSql("f.so_cancelled")}
     and ${extraCondition.replaceAll("so.", "f.")}`,
  );
}

function statusDeliveryPendingOrderSql() {
  return statusDeliveryDueOrderSql(`${effectiveDpDateSql("so")} is not null`);
}

function dateCastSql(expression: string) {
  return `case when (${expression})::text ~ '^\\d{4}-\\d{2}-\\d{2}$' then (${expression})::date else null end`;
}

function milestoneDateExpression(milestone: (typeof statusSummaryMilestones)[number]) {
  if (milestone.key === "bidding") {
    return dateCastSql("f.bid_opening_date");
  }
  if (milestone.key === "refloatBidding") {
    return dateCastSql("f.refloat_bid_opening_date");
  }
  if ("supplyOrderDate" in milestone && milestone.supplyOrderDate) {
    const supplyOrderOnlyColumns = new Set([
      "psb_bg_received_date",
      "pwb_bg_received_date",
      "combined_bg_received_date",
    ]);
    const orderDate = `(
      select min(${dateCastSql(`so.${milestone.supplyOrderDate}`)})
      from supply_orders so
      where so.file_id = f.id and so.${milestone.supplyOrderDate} is not null
    )`;
    return supplyOrderOnlyColumns.has(milestone.supplyOrderDate)
      ? orderDate
      : `coalesce(${orderDate}, ${dateCastSql(`f.${milestone.supplyOrderDate}`)})`;
  }
  if ("currentColumn" in milestone && milestone.currentColumn) {
    return dateCastSql(milestone.currentColumn);
  }
  return "null::date";
}

function milestoneStageStartSql(
  milestone: (typeof statusSummaryMilestones)[number],
  milestoneIndex: number,
) {
  const fileMilestoneEnd = statusSummaryMilestones.findIndex(
    (candidate) => candidate.key === "financialSanction",
  );
  const fileMilestones = statusSummaryMilestones.slice(
    0,
    fileMilestoneEnd < 0 ? statusSummaryMilestones.length : fileMilestoneEnd,
  );
  const possiblePredecessors = isFlexiblePreControlStatusMilestone(milestone)
    ? fileMilestones.filter(
        (candidate) =>
          candidate.key === "scrutiny" || isFlexiblePreControlStatusMilestone(candidate),
      )
    : statusSummaryMilestones.slice(0, milestoneIndex);
  const completedDates = possiblePredecessors
    .filter((candidate) => candidate.key !== milestone.key)
    .map((candidate) => {
      const date = milestoneDateExpression(candidate);
      return `(case when ${statusAppliesSql(candidate)}
        and ${milestoneCompleteSql(candidate)}
        and (${date}) <= current_date
        then (${date}) else null::date end)`;
    });
  const receivedDate = dateCastSql("f.received_date");
  return `greatest(${[
    `case when ${receivedDate} <= current_date then ${receivedDate} else null::date end`,
    ...completedDates,
  ].join(",\n    ")})`;
}

function tcecSupplyOrderDelayStartSql(soDate: string) {
  const supplyOrderIndex = statusSummaryMilestones.findIndex((milestone) => milestone.key === "supplyOrder");
  const cutoff = `coalesce(${soDate}, current_date)`;
  if (supplyOrderIndex < 0) return "null::date";

  const completedDates = statusSummaryMilestones
    .slice(0, supplyOrderIndex)
    .filter((milestone) => milestone.key !== "financialSanction")
    .map((milestone) => {
      const date = milestoneDateExpression(milestone);
      return `(case when ${statusAppliesSql(milestone)}
        and ${milestoneCompleteSql(milestone)}
        and (${date}) <= ${cutoff}
        then (${date}) else null::date end)`;
    });
  const receivedDate = dateCastSql("f.received_date");
  return `greatest(${[
    `case when ${receivedDate} <= ${cutoff} then ${receivedDate} else null::date end`,
    ...completedDates,
  ].join(",\n    ")})`;
}

const orderDelayMilestones = [
  {
    key: "financialSanction",
    current: "financialsanction",
    completeColumn: "financial_sanction_date",
    start: "financialSanction",
    applies: () => isYesSql("f.tcec"),
  },
  {
    key: "supplyOrder",
    current: "supplyorder",
    completeColumn: "so_date",
    start: "supplyOrder",
  },
  {
    key: "advancePayment",
    current: "advancepayment",
    completeColumn: "advance_payment_date",
    start: "advancePayment",
    applies: () => isYesSql("so.advance_payment"),
  },
  {
    key: "psb",
    current: "psb",
    completeColumn: "psb_bg_received_date",
    start: "psb",
    applies: () => bgCategorySql("so", "psb"),
  },
  {
    key: "pwb",
    current: "pwb",
    completeColumn: "pwb_bg_received_date",
    start: "pwb",
    applies: () => bgCategorySql("so", "pwb"),
  },
  {
    key: "psbPwb",
    current: "psbpwb",
    completeColumn: "combined_bg_received_date",
    start: "psbPwb",
    applies: () => bgCategorySql("so", "psbpwb"),
  },
  {
    key: "delivery",
    current: "delivery",
    completeColumn: "material_receipt_date",
    start: "delivery",
    applies: () => deliveryInspectionApplicableSql(),
  },
  {
    key: "jobCompletion",
    current: "jobcompletion",
    completeColumn: "job_completion",
    start: "jobCompletion",
    applies: () => `not (${deliveryInspectionApplicableSql()})`,
  },
  {
    key: "irPreparation",
    current: "irpreparation",
    completeColumn: "ir_preparation_date",
    start: "irPreparation",
    applies: () => isYesSql("f.ir"),
  },
  {
    key: "irReceipt",
    current: "irreceipt",
    completeColumn: "ir_receipt_date",
    start: "irReceipt",
    applies: () => isYesSql("f.ir"),
  },
  {
    key: "billPreparation",
    current: "billpreparation",
    completeColumn: "bill_preparation_date",
    start: "billPreparation",
  },
  {
    key: "billSentForPayment",
    current: "billsentforpayment",
    completeColumn: "bill_sent_for_payment_date",
    start: "billSentForPayment",
  },
  {
    key: "payment",
    current: "payment",
    completeColumn: "payment_date",
    start: "payment",
  },
] as const;

function stageJsonDateSql(jsonKey: string) {
  return `case when stage_row.stage ->> '${jsonKey}' ~ '^\\d{4}-\\d{2}-\\d{2}$' then (stage_row.stage ->> '${jsonKey}')::date else null end`;
}

function effectiveOrderDateSql(column: string, jsonKey: string) {
  return `coalesce(${stageJsonDateSql(jsonKey)}, nullif(so.${column}::text, '')::date)`;
}

function orderDelayStartSql(start: (typeof orderDelayMilestones)[number]["start"]) {
  const financialSanctionIndex = statusSummaryMilestones.findIndex(
    (milestone) => milestone.key === "financialSanction",
  );
  const financialSanctionStart = milestoneStageStartSql(
    statusSummaryMilestones[financialSanctionIndex],
    financialSanctionIndex,
  );
  const financialSanctionDate = effectiveOrderDateSql(
    "financial_sanction_date",
    "financialSanctionDate",
  );
  const soDate = effectiveOrderDateSql("so_date", "soDate");
  const materialReceiptDate = effectiveOrderDateSql("material_receipt_date", "materialReceiptDate");
  const billSentForPaymentDate = effectiveOrderDateSql(
    "bill_sent_for_payment_date",
    "billSentForPaymentDate",
  );
  const effectiveDpDate = `coalesce(
    ${stageJsonDateSql("revisedDp")},
    ${stageJsonDateSql("dpDate")},
    nullif(so.revised_dp::text, '')::date,
    nullif(so.dp_date::text, '')::date
  )`;
  const nonDeliveryFileType = `not (${deliveryInspectionApplicableSql()})`;
  const contractFileType = `${contractFileTypeSql("f")}`;
  const goodsServicesIrNo = `(not ${isYesSql("f.ir")} and not ${contractFileType})`;
  const stageJobCompletionDone = `coalesce(stage_row.stage ->> 'jobCompletionDate', '') <> ''`;
  const jobCompletionDoneForDelay = `((stage_row.stage is not null and ${stageJobCompletionDone})
    or (stage_row.stage is null and ${completedOrderMilestoneSql("so", "jobcompletion")}))`;
  const jobCompletionDate = effectiveOrderDateSql("job_completion_date", "jobCompletionDate");
  switch (start) {
    case "financialSanction":
      return financialSanctionStart;
    case "supplyOrder":
      return `case
        when ${isYesSql("f.tcec")} then ${tcecSupplyOrderDelayStartSql(soDate)}
        else ${financialSanctionDate}
      end`;
    case "advancePayment":
      return effectiveOrderDateSql("so_date", "soDate");
    case "psb":
      return `coalesce(${financialSanctionDate}, ${financialSanctionStart})`;
    case "psbPwb":
      return `coalesce(${financialSanctionDate}, ${financialSanctionStart})`;
    case "pwb":
      return effectiveOrderDateSql("material_receipt_date", "materialReceiptDate");
    case "delivery":
      return effectiveDpDate;
    case "jobCompletion":
      return `case
        when ${nonDeliveryFileType} and ${effectiveDpDate} is not null then ${effectiveDpDate}
        else null
      end`;
    case "irPreparation":
      return effectiveOrderDateSql("material_receipt_date", "materialReceiptDate");
    case "irReceipt":
      return effectiveOrderDateSql("ir_preparation_date", "irPreparationDate");
    case "billPreparation":
      return `case
        when ${isYesSql("f.ir")} then ${effectiveOrderDateSql("ir_receipt_date", "irReceiptDate")}
        when ${nonDeliveryFileType} then ${jobCompletionDate}
        else null
      end`;
    case "billSentForPayment":
      return effectiveOrderDateSql("bill_preparation_date", "billPreparationDate");
    case "payment":
      return `case
        when ${isYesSql("f.ir")} then coalesce(${materialReceiptDate}, ${billSentForPaymentDate})
        when ${isYesSql("so.shortclosure")} then ${jobCompletionDate}
        when ${contractFileType} then least(
          (${effectiveDpDate} + interval '1 day')::date,
          ${jobCompletionDate}
        )
        when ${goodsServicesIrNo} and ${jobCompletionDoneForDelay} then ${jobCompletionDate}
        else ${billSentForPaymentDate}
      end`;
  }
}

function orderDelayFilterSql(milestoneKey: string, thresholdPlaceholder: string) {
  const nonDeliveryFileType = `not (${deliveryInspectionApplicableSql()})`;
  const contractFileType = `${contractFileTypeSql("f")}`;
  const commonStagePaymentCase = `(${isYesSql("so.stage_delivery")}
    and not ${isYesSql("so.stage_payment")}
    and not (${contractFileType})
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const commonPaymentCase = `(${isYesSql("so.stage_delivery")}
    and not ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const allStageDate = (jsonKey: string) => `(select case
      when count(*) > 0 and count(stage_dates.date_value) = count(*) then max(stage_dates.date_value)
      else null
    end
    from (
      select case
        when common_stage.stage ->> '${jsonKey}' ~ '^\\d{4}-\\d{2}-\\d{2}$'
          then (common_stage.stage ->> '${jsonKey}')::date
        else null::date
      end as date_value
      from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as common_stage(stage)
    ) as stage_dates)`;
  const allStageEffectiveDpDate = `(select case
      when count(*) > 0 and count(stage_dates.date_value) = count(*) then max(stage_dates.date_value)
      else null
    end
    from (
      select case
        when common_stage.stage ->> 'revisedDp' ~ '^\\d{4}-\\d{2}-\\d{2}$'
          then (common_stage.stage ->> 'revisedDp')::date
        when common_stage.stage ->> 'dpDate' ~ '^\\d{4}-\\d{2}-\\d{2}$'
          then (common_stage.stage ->> 'dpDate')::date
        else null::date
      end as date_value
      from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as common_stage(stage)
    ) as stage_dates)`;
  const commonBillPreparationStart = `(case
    when ${isYesSql("f.ir")} then ${allStageDate("irReceiptDate")}
    else ${allStageDate("jobCompletionDate")}
  end)`;
  const commonPaymentStart = `(case
    when ${contractFileType} then (${allStageEffectiveDpDate} + interval '1 day')::date
    when ${isYesSql("f.ir")} then ${allStageDate("materialReceiptDate")}
    else ${allStageDate("jobCompletionDate")}
  end)`;
  const stageJobCompletionDone = `coalesce(stage_row.stage ->> 'jobCompletionDate', '') <> ''`;
  const jobCompletionDoneForDelay = `((stage_row.stage is not null and ${stageJobCompletionDone})
    or (stage_row.stage is null and ${completedOrderMilestoneSql("so", "jobcompletion")}))`;
  const paymentStartDate = orderDelayStartSql("payment");
  const paymentCompleteDate = effectiveOrderDateSql("payment_date", "paymentDate");
  const billSentForPaymentDate = effectiveOrderDateSql(
    "bill_sent_for_payment_date",
    "billSentForPaymentDate",
  );
  const contractPaymentDelay = `(${contractFileType}
    and ${paymentCompleteDate} is null
    and not ${jobCompletionDoneForDelay}
    and ${paymentStartDate} is not null
    and (current_date - (${paymentStartDate})::date) > ${thresholdPlaceholder}::integer)`;
  const clauses = orderDelayMilestones
    .filter(
      (milestone) =>
        milestone.key !== "payment" &&
        (milestoneKey === "all" || milestone.key === milestoneKey),
    )
    .map((milestone) => {
      const defaultStartDate = orderDelayStartSql(milestone.start);
      const commonStartDate =
        milestone.key === "billPreparation" ? commonBillPreparationStart
          : milestone.key === "payment" ? commonPaymentStart
            : undefined;
      const startDate = commonStartDate
        ? `(case when ${milestone.key === "payment" ? commonPaymentCase : commonStagePaymentCase}
            then ${commonStartDate} else ${defaultStartDate} end)`
        : defaultStartDate;
      const completeDate =
        milestone.key === "advancePayment"
          ? `nullif(so.advance_payment_detail ->> 'paymentDate', '')::date`
          : milestone.key === "jobCompletion"
            ? `case when ${jobCompletionDoneForDelay} then '9999-12-31'::date else null end`
            : effectiveOrderDateSql(
                milestone.completeColumn,
                dateColumnToJsonKey(milestone.completeColumn),
              );
      const applies = "applies" in milestone && milestone.applies ? milestone.applies() : "true";
      const includeStages =
        milestone.key !== "financialSanction" &&
        milestone.key !== "advancePayment" &&
        !isBgStatusKey(milestone.key);
      const useCommonParentCase =
        Boolean(commonStartDate) && (milestone.key === "billPreparation" || milestone.key === "payment");
      const stageJoinCondition = includeStages
        ? `jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0${
            useCommonParentCase
              ? ` and not ${milestone.key === "payment" ? commonPaymentCase : commonStagePaymentCase}`
              : ""
          }`
        : "false";
      const currentMilestone =
        milestone.key === "advancePayment"
          ? normalizedSql("so.advance_payment_detail ->> 'currentMilestone'")
          : normalizedSql("coalesce(stage_row.stage ->> 'currentMilestone', so.current_milestone)");
      const normalizedBgKey = normalizeMilestoneName(milestone.key);
      const pendingWarrantyBgCondition = `((${bgCategorySql("so", "pwb")}
        and not ${hasTextSql("so.pwb_bg_received_date")})
        or (${bgCategorySql("so", "psbpwb")}
          and not ${hasTextSql("so.combined_bg_received_date")}))`;
      const afterWarrantyBgCondition =
        milestone.key === "irPreparation" ||
        milestone.key === "irReceipt" ||
        milestone.key === "billPreparation" ||
        milestone.key === "billSentForPayment" ||
        milestone.key === "payment"
          ? `not ${pendingWarrantyBgCondition}`
          : "true";
      const currentCondition = isBgStatusKey(milestone.key)
        ? `(('${normalizedBgKey}' in ('psb', 'psbpwb') and ${hasTextSql("so.so_date")})
          or ('${normalizedBgKey}' = 'pwb' and (
            ((${deliveryInspectionApplicableSql()}) and ${hasTextSql("so.material_receipt_date")})
            or (${nonDeliveryFileType} and ${completedOrderMilestoneSql("so", "jobcompletion")})
          )))`
        : milestone.key === "supplyOrder"
          ? supplyOrderPendingOrderSql("so")
          : milestone.key === "payment"
            ? `${startDate} is not null`
            : milestone.key === "billSentForPayment"
              ? `${startDate} is not null`
              : milestone.key === "delivery"
                ? hasTextSql("so.so_date")
                : milestone.key === "jobCompletion"
                  ? // Job Completion is an independent workflow milestone.  A
                    // contract payment can also be pending from its DP-based
                    // trigger, but that must not hide an overdue Job Completion
                    // row from the Delay Status drilldown.
                    `${startDate} is not null`
                  : milestone.key === "irPreparation"
                    ? `${effectiveOrderDateSql("material_receipt_date", "materialReceiptDate")} is not null`
                    : milestone.key === "billPreparation"
                      ? `${effectiveOrderDateSql("bill_preparation_date", "billPreparationDate")} is null
                    and (
                      (${commonStagePaymentCase} and ${commonBillPreparationStart} is not null)
                      or
                      (${isYesSql("f.ir")} and ${effectiveOrderDateSql("ir_receipt_date", "irReceiptDate")} is not null)
                      or (${nonDeliveryFileType}
                        and ${effectiveOrderDateSql("job_completion_date", "jobCompletionDate")} is not null)
                    )`
                    : `${currentMilestone} = '${milestone.current}'`;
      return `exists (
        select 1
        from supply_orders so
        left join lateral jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
          on ${stageJoinCondition}
        where so.file_id = f.id
          and not ${isYesSql("so.so_cancelled")}
          and ${["advancePayment", "billPreparation", "billSentForPayment", "payment"].includes(milestone.key) ? `not ${isYesSql("so.no_further_action")}` : "true"}
          and ${applies}
          and ${currentCondition}
          and ${afterWarrantyBgCondition}
          and ${completeDate} is null
          and ${startDate} is not null
          and (current_date - (${startDate})::date) > ${thresholdPlaceholder}::integer
      )`;
    });
  return clauses.length ? `(${clauses.join(" or ")})` : "false";
}

function expectedTcecSupplyOrderStartSql() {
  const supplyOrderIndex = statusSummaryMilestones.findIndex(
    (milestone) => milestone.key === "supplyOrder",
  );
  const previousMilestones =
    supplyOrderIndex < 0
      ? []
      : statusSummaryMilestones
          .slice(0, supplyOrderIndex)
          .filter((milestone) => milestone.key !== "financialSanction");
  const completedMilestoneDates = previousMilestones.map((milestone) => {
    const date = milestoneDateExpression(milestone);
    return `(case
      when ${statusAppliesSql(milestone)}
        and ${milestoneCompleteSql(milestone)}
        and (${date}) is not null
        and (${date}) <= current_date
      then (${date})
    end)`;
  });
  const receivedDate = `(case when f.received_date <= current_date then f.received_date end)`;
  return `greatest(${[receivedDate, ...completedMilestoneDates].join(", ")})`;
}

function expectedTcecSupplyOrderDelaySql(thresholdPlaceholder: string) {
  const startDate = expectedTcecSupplyOrderStartSql();
  return `not ${isCancelledFileSql()}
    and not ${isYesSql("f.demand_cancelled")}
    and ${isYesSql("f.tcec")}
    and ${hasTextSql("f.cnc_approval_date")}
    and coalesce(f.no_of_so, 0) > ${supplyOrderCountSql()}
    and (${startDate}) is not null
    and (current_date - (${startDate})::date) > ${thresholdPlaceholder}::integer`;
}

function returnedBillDelayFilterSql(milestoneKey: string, thresholdPlaceholder: string) {
  if (milestoneKey !== "all" && milestoneKey !== "billReturnedForCorrection") return "false";
  const openReturnDateSql = (cyclesExpression: string) =>
    `case when ${latestBillReturnStateSql(cyclesExpression, "open")}
      then nullif((${latestBillReturnCycleSql(cyclesExpression)}) ->> 'returnedDate', '')::date end`;
  const openReturnDelaySql = (cyclesExpression: string) => {
    const dateExpression = openReturnDateSql(cyclesExpression);
    return `(${dateExpression} is not null
      and (current_date - (${dateExpression})::date) > ${thresholdPlaceholder}::integer)`;
  };
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")} and not ${isYesSql("so.no_further_action")} and (
      ${openReturnDelaySql("so.bill_return_cycles")}
      or exists (
        select 1
        from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
        where ${openReturnDelaySql("stage_row.stage -> 'billReturnCycles'")}
      )
      or (${isYesSql("so.advance_payment")}
        and ${openReturnDelaySql("so.advance_payment_detail -> 'billReturnCycles'")})
    )`,
  )}`;
}

function supplementaryBillReturnedDelayFilterSql(
  milestoneKey: string,
  thresholdPlaceholder: string,
) {
  if (milestoneKey !== "all" && milestoneKey !== "supplementaryBillReturnedForCorrection") {
    return "false";
  }
  const cyclesExpression = "supplementary_bill.bill -> 'billReturnCycles'";
  const openReturnDate = `case when ${latestBillReturnStateSql(cyclesExpression, "open")}
    then nullif((${latestBillReturnCycleSql(cyclesExpression)}) ->> 'returnedDate', '')::date end`;
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")}
     and not ${isYesSql("so.no_further_action")}
     and exists (
       select 1
       from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
       where not ${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")}
         and ${openReturnDate} is not null
         and (current_date - (${openReturnDate})::date) > ${thresholdPlaceholder}::integer
     )`,
  )}`;
}

function biddingDelayStatusSql(
  breakupKey: string | undefined,
  thresholdPlaceholder: string,
  refloatScope: "any" | "normal" | "refloat" = "any",
  rfpScope: "any" | "no" | "yes" = "any",
) {
  const refloatYes = isYesSql("f.refloat");
  const bidDate = `(case when ${refloatYes} then f.refloat_bidding_date else f.bid_date end)`;
  const bidOpeningDate = `(case when ${refloatYes} then f.refloat_bid_opening_date else f.bid_opening_date end)`;
  // Normal bidding delay is anchored to CFA Approval Date. GeM undertaking
  // is a separate prerequisite status and must not move the bidding clock.
  const normalBiddingStartDate = "f.cfa_date";
  const tcecRefloat = `(${refloatYes} and ${isYesSql("f.tcec")})`;
  const refloatNonTcecRestart = `(${refloatYes}
    and not ${isYesSql("f.tcec")}
    and ${isYesSql("f.bidding_stage_over")}
    and ${hasTextSql("f.refloat_recommendation_date")})`;
  const refloatStartDate = `case
    when ${isYesSql("f.tcec")} then ${dateCastSql("f.post_tcec_minutes_date")}
    when ${refloatNonTcecRestart} then ${dateCastSql("f.refloat_recommendation_date")}
    else null::date
  end`;
  const delayStartDate = `(case when ${refloatYes} then (${refloatStartDate}) else (${normalBiddingStartDate}) end)`;
  const refloatPredicate =
    refloatScope === "refloat" ? `and ${refloatYes}` : refloatScope === "normal" ? `and not ${refloatYes}` : "";
  const rfpPredicate =
    rfpScope === "yes"
      ? `and ${isYesSql("f.rfp_vetting")}`
      : rfpScope === "no"
        ? `and not ${isYesSql("f.rfp_vetting")}`
        : "";
  const refloatStageOverPredicate = `((${tcecRefloat} and not ${isYesSql("f.bidding_stage_over")})
    or ${refloatNonTcecRestart})`;
  const biddingStageOverPredicate = refloatScope === "normal"
    ? ""
    : refloatScope === "refloat"
      ? `and ${refloatStageOverPredicate}`
      : `and (not ${refloatYes} or ${refloatStageOverPredicate})`;
  const refloatPrerequisiteCondition = `((${tcecRefloat} and ${hasTextSql("f.post_tcec_minutes_date")})
    or ${refloatNonTcecRestart})`;
  const refloatPrerequisitePredicate = `and ${refloatPrerequisiteCondition}`;
  const prerequisitePredicate = refloatScope === "refloat"
    ? refloatPrerequisitePredicate
    : refloatScope === "any"
      ? `and ((${refloatYes} and ${refloatPrerequisiteCondition}) or (not ${refloatYes} and ${hasTextSql("f.cfa_date")}))`
      : `and ${hasTextSql("f.cfa_date")}`;
  const base = `not ${isYesSql("f.demand_cancelled")}
    and not ${completedMilestoneExists(`${normalizedSql("completed.milestone")} = 'fileclosed'`)}
    and ${biddingApplicableSql()}
    ${prerequisitePredicate}
    ${biddingStageOverPredicate}
    ${refloatPredicate}
    ${refloatScope === "normal" ? "" : `and (not ${refloatNonTcecRestart} or not ${hasTextSql("f.refloat_bidding_date")})`}
    ${refloatScope === "normal" ? `and not ${hasTextSql("f.bid_date")}` : ""}
    ${rfpPredicate}`;
  const statusCases: Record<string, string> = {
    gemUndertakingPending: `${base}
      and not ${refloatYes}
      and ${isYesSql("f.gem")}
      and not ${hasTextSql("f.gem_undertaking_date")}
      and (current_date - f.cfa_date) > ${thresholdPlaceholder}::integer`,
    tenderLivePending: `${base}
      and (not ${isYesSql("f.gem")} or ${hasTextSql("f.gem_undertaking_date")} or ${refloatYes})
      and ${bidDate} is null
      and (current_date - (${delayStartDate})::date) > ${thresholdPlaceholder}::integer`,
    bidOpeningOverdue: `${base}
      and (not ${isYesSql("f.gem")} or ${hasTextSql("f.gem_undertaking_date")} or ${refloatYes})
      and ${bidOpeningDate} is not null
      and ${bidOpeningDate} < current_date
      and not ${isYesSql("f.bid_opened")}
      and (current_date - (${bidOpeningDate})::date) > ${thresholdPlaceholder}::integer`,
    biddingStageCompletionPending: `${base}
      and (not ${isYesSql("f.gem")} or ${hasTextSql("f.gem_undertaking_date")} or ${refloatYes})
      and not (${bidOpeningDate} is not null and ${bidOpeningDate} < current_date and not ${isYesSql("f.bid_opened")})
      and ${isYesSql("f.bid_opened")}
      and (current_date - coalesce(${bidOpeningDate}, ${bidDate}, ${delayStartDate})::date) > ${thresholdPlaceholder}::integer`,
  };
  if (breakupKey && statusCases[breakupKey]) return `(${statusCases[breakupKey]})`;
  return `(${Object.values(statusCases)
    .map((clause) => `(${clause})`)
    .join(" or ")})`;
}

function gemUndertakingDelayFilterSql(
  milestoneKey: string,
  thresholdPlaceholder: string,
) {
  if (milestoneKey !== "all" && milestoneKey !== "gemUndertaking") return "false";
  const refloatTcec = `(${isYesSql("f.refloat")} and ${isYesSql("f.tcec")})`;
  const refloatNonTcec = `(${isYesSql("f.refloat")} and not ${isYesSql("f.tcec")})`;
  const startDate = `(case
    when ${refloatTcec} then ${dateCastSql("f.post_tcec_date")}
    when ${refloatNonTcec} then ${dateCastSql("f.refloat_recommendation_date")}
    else ${dateCastSql("f.cfa_date")} end)`;
  const pending = `(
    (not ${isYesSql("f.refloat")}
      and ${hasTextSql("f.cfa_date")}
      and not ${hasTextSql("f.gem_undertaking_date")})
    or (${refloatTcec}
      and ${hasTextSql("f.post_tcec_date")}
      and not ${hasTextSql("f.refloat_gem_undertaking_date")})
    or (${refloatNonTcec}
      and ${hasTextSql("f.refloat_recommendation_date")}
      and not ${hasTextSql("f.refloat_gem_undertaking_date")})
  )`;
  return `not ${isCancelledFileSql()}
    and not (${completedMilestoneExists(`${normalizedSql("completed.milestone")} = 'fileclosed'`)})
    and ${isYesSql("f.gem")}
    and ${biddingApplicableSql()}
    and ${pending}
    and (${startDate}) is not null
    and (current_date - (${startDate})::date) > ${thresholdPlaceholder}::integer`;
}

function dateColumnToJsonKey(column: string) {
  const mapping: Record<string, string> = {
    financial_sanction_date: "financialSanctionDate",
    so_date: "soDate",
    psb_bg_received_date: "psbBgReceivedDate",
    psb_bg_validity_date: "psbBgValidityDate",
    psb_bg_return_date: "psbBgReturnDate",
    pwb_bg_received_date: "pwbBgReceivedDate",
    pwb_bg_validity_date: "pwbBgValidityDate",
    pwb_bg_return_date: "pwbBgReturnDate",
    combined_bg_received_date: "combinedBgReceivedDate",
    combined_bg_validity_date: "combinedBgValidityDate",
    combined_bg_return_date: "combinedBgReturnDate",
    material_receipt_date: "materialReceiptDate",
    job_completion_date: "jobCompletionDate",
    ir_preparation_date: "irPreparationDate",
    ir_receipt_date: "irReceiptDate",
    bill_preparation_date: "billPreparationDate",
    bill_sent_for_payment_date: "billSentForPaymentDate",
    payment_date: "paymentDate",
  };
  return mapping[column] ?? column;
}

function delayStatusFilterSql(filter: string, values: unknown[]) {
  const [, rawDays, rawMilestoneKey] = filter.split(":");
  const thresholdDays = Number.parseInt(rawDays ?? "0", 10);
  const milestoneKey = rawMilestoneKey || "all";
  if (!Number.isFinite(thresholdDays) || thresholdDays < 0) return "false";
  const thresholdPlaceholder = addSqlValue(values, thresholdDays);
  const financialSanctionStartDate = dateCastSql("f.cnc_approval_date");
  const financialSanctionFileClause =
    milestoneKey === "all" || milestoneKey === "financialSanction"
      ? `(${isYesSql("f.tcec")}
        and ${financialSanctionDelayPendingSql()}
        and ${financialSanctionStartDate} is not null
        and (current_date - (${financialSanctionStartDate})::date) > ${thresholdPlaceholder}::integer)`
      : "false";
  const nonTcecTechnicalEvaluationClause =
    milestoneKey === "all" || milestoneKey === "nonTcecTechnicalEvaluation"
      ? `(
        not ${isYesSql("f.tcec")}
        and not ${isCancelledFileSql()}
        and not ${completedMilestoneExists(`${normalizedSql("completed.milestone")} = 'fileclosed'`)}
        and ${biddingApplicableSql()}
        and (case
          when ${isYesSql("f.refloat")} and ${hasTextSql("f.refloat_bid_opening_date")}
            then ${isYesSql("f.refloat_bidding_stage_over")}
          else ${isYesSql("f.bidding_stage_over")}
        end)
        and (case
          when ${isYesSql("f.refloat")} and ${hasTextSql("f.refloat_bid_opening_date")}
            then ${dateCastSql("f.refloat_bid_opening_date")}
          else ${dateCastSql("f.bid_opening_date")}
        end) is not null
        and (current_date - (case
          when ${isYesSql("f.refloat")} and ${hasTextSql("f.refloat_bid_opening_date")}
            then ${dateCastSql("f.refloat_bid_opening_date")}
          else ${dateCastSql("f.bid_opening_date")}
        end)) > ${thresholdPlaceholder}::integer
        and (case
          when ${isYesSql("f.refloat")} and ${hasTextSql("f.refloat_bid_opening_date")}
            then (select min(${dateCastSql("so_end.financial_sanction_date")})
              from supply_orders so_end
              where so_end.file_id = f.id)
          when ${isYesSql("f.refloat")} and ${hasTextSql("f.refloat_recommendation_date")}
            then ${dateCastSql("f.refloat_recommendation_date")}
          else (select min(${dateCastSql("so_end.financial_sanction_date")})
            from supply_orders so_end
            where so_end.file_id = f.id)
        end) is null
      )`
      : "false";
  const workflowNotStartedClause =
    milestoneKey === "all" || milestoneKey === "workflowNotStarted"
      ? `(${workflowNotStartedSql()} and (current_date - coalesce(f.received_date, f.created_at::date)) > ${thresholdPlaceholder}::integer)`
      : "false";
  const gemUndertakingClause = gemUndertakingDelayFilterSql(milestoneKey, thresholdPlaceholder);
  const biddingClause = milestoneKey === "all"
    ? biddingDelayStatusSql(undefined, thresholdPlaceholder, "normal")
    : milestoneKey === "bidding"
      ? biddingDelayStatusSql(undefined, thresholdPlaceholder, "normal")
      : milestoneKey === "biddingNonRfp"
        ? biddingDelayStatusSql(undefined, thresholdPlaceholder, "normal", "no")
        : milestoneKey === "biddingRfp"
          ? biddingDelayStatusSql(undefined, thresholdPlaceholder, "normal", "yes")
          : "false";
  const refloatBiddingClause = milestoneKey === "all" || milestoneKey === "refloatBidding"
    ? biddingDelayStatusSql(undefined, thresholdPlaceholder, "refloat")
    : "false";
  const clauses = statusSummaryMilestones
    .map((milestone, index) => ({ milestone, index }))
    .filter(
      ({ milestone }) =>
        !("supplyOrderDate" in milestone && milestone.supplyOrderDate) &&
        milestone.key !== "bidding" &&
        milestone.key !== "refloatBidding" &&
        (milestoneKey === "all" || milestone.key === milestoneKey),
    )
    .map(({ milestone, index }) => {
      const startDate = milestoneStageStartSql(milestone, index);
      const postTcecGate = milestone.key === "postTcec"
        ? `and ${statusAppliesSql(milestone)}
          and ${isYesSql("f.bidding_stage_over")}
          and ${hasTextSql("f.bid_opening_date")}`
        : milestone.key === "refloatPostTcec"
          ? `and ${statusAppliesSql(milestone)}
            and ${isYesSql("f.bidding_stage_over")}
            and ${hasTextSql("f.refloat_bid_opening_date")}`
          : "";
      return `(${statusActiveSql(milestone)}
        ${postTcecGate}
        and not (${milestoneCompleteSql(milestone)})
        and ${startDate} is not null
        and (current_date - ${startDate}::date) > ${thresholdPlaceholder}::integer)`;
    });
  const orderClause = orderDelayFilterSql(milestoneKey, thresholdPlaceholder);
  const expectedSupplyOrderClause =
    milestoneKey === "all" || milestoneKey === "supplyOrder"
      ? expectedTcecSupplyOrderDelaySql(thresholdPlaceholder)
      : "false";
  const returnedBillClause = returnedBillDelayFilterSql(milestoneKey, thresholdPlaceholder);
  const supplementaryBillReturnedClause = supplementaryBillReturnedDelayFilterSql(
    milestoneKey,
    thresholdPlaceholder,
  );
  const paymentPreSubmissionClause = paymentPreSubmissionDelaySql(
    milestoneKey,
    thresholdPlaceholder,
  );
  const paymentPostSubmissionClause = paymentPostSubmissionDelaySql(
    milestoneKey,
    thresholdPlaceholder,
  );
  const paymentCumulativeClause = paymentCumulativeDelaySql(
    milestoneKey,
    thresholdPlaceholder,
  );
  return clauses.length
    ? `((${workflowNotStartedClause}) or (${gemUndertakingClause}) or (${biddingClause}) or (${refloatBiddingClause}) or (${financialSanctionFileClause}) or (${nonTcecTechnicalEvaluationClause}) or (${clauses.join(" or ")}) or ${orderClause} or (${expectedSupplyOrderClause}) or ${returnedBillClause} or ${supplementaryBillReturnedClause} or ${paymentPreSubmissionClause} or ${paymentPostSubmissionClause} or (${paymentCumulativeClause}))`
    : `((${workflowNotStartedClause}) or (${gemUndertakingClause}) or (${biddingClause}) or (${refloatBiddingClause}) or (${financialSanctionFileClause}) or (${nonTcecTechnicalEvaluationClause}) or ${orderClause} or (${expectedSupplyOrderClause}) or ${returnedBillClause} or ${supplementaryBillReturnedClause} or ${paymentPreSubmissionClause} or ${paymentPostSubmissionClause} or (${paymentCumulativeClause}))`;
}

function paymentTimingJsonDateSql(value: string) {
  return `case when ${value} ~ '^\\d{4}-\\d{2}-\\d{2}$' then (${value})::date else null::date end`;
}

function paymentTimingTriggerSql(stageValue?: string) {
  const irReceipt = stageValue
    ? paymentTimingJsonDateSql(`${stageValue} ->> 'irReceiptDate'`)
    : `nullif(so.ir_receipt_date::text, '')::date`;
  const jobCompletion = stageValue
    ? paymentTimingJsonDateSql(`${stageValue} ->> 'jobCompletionDate'`)
    : `nullif(so.job_completion_date::text, '')::date`;
  return `case when ${deliveryInspectionApplicableSql()} and ${isYesSql("f.ir")}
    then ${irReceipt} else ${jobCompletion} end`;
}

function latestPaymentTimingStageTriggerSql() {
  const triggerDate = paymentTimingTriggerSql("timing_stage.stage");
  return `(select case
      when count(*) > 0 and count(stage_trigger.trigger_date) = count(*)
        then max(stage_trigger.trigger_date)
      else null
    end
    from (
      select ${triggerDate} as trigger_date
      from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as timing_stage(stage)
    ) as stage_trigger)`;
}

function paymentPreSubmissionDelaySql(milestoneKey: string, thresholdPlaceholder: string) {
  if (milestoneKey !== "all" && milestoneKey !== "paymentPreSubmission") return "false";
  const commonStages = `(${isYesSql("so.stage_delivery")}
    and not ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const stagewise = `(${isYesSql("so.stage_delivery")}
    and ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const commonStart = latestPaymentTimingStageTriggerSql();
  const parentStart = paymentTimingTriggerSql();
  const pending = (
    triggerDate: string,
    include: string,
    returnHistory = billReturnHistorySql("so.bill_return_cycles"),
    submissionDate = "so.bill_sent_for_payment_date",
    paymentDate = "so.payment_date",
  ) => `(
    ${include}
    and ${hasTextSql("so.so_date")}
    and not ${isYesSql("so.so_cancelled")}
    and not ${isYesSql("so.no_further_action")}
    and not ${hasTextSql(submissionDate)}
    and not ${hasTextSql(paymentDate)}
    and not ${returnHistory}
    and (${triggerDate}) is not null
    and (current_date - (${triggerDate})) > ${thresholdPlaceholder}::integer
  )`;
  const commonCase = pending(commonStart, "so.include_in_payment_timing is distinct from false");
  const parentCase = pending(parentStart, "so.include_in_payment_timing is distinct from false");
  const stageTrigger = paymentTimingTriggerSql("payment_stage.stage");
  const stageCase = `exists (
    select 1
    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as payment_stage(stage)
    where lower(coalesce(payment_stage.stage ->> 'includeInPaymentTiming', 'true')) <> 'false'
      and ${pending(
        stageTrigger,
        "true",
        billReturnHistorySql("payment_stage.stage -> 'billReturnCycles'"),
        "payment_stage.stage ->> 'billSentForPaymentDate'",
        "payment_stage.stage ->> 'paymentDate'",
      )}
  )`;
  return `not ${isYesSql("f.demand_cancelled")} and not ${fileClosedSql()} and exists (
    select 1 from supply_orders so
    where so.file_id = f.id
      and (${commonStages} and ${commonCase}
        or ${stagewise} and ${stageCase}
        or not (${isYesSql("so.stage_delivery")} and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)
          and ${parentCase})
  )`;
}

function paymentPostSubmissionDelaySql(milestoneKey: string, thresholdPlaceholder: string) {
  if (milestoneKey !== "all" && milestoneKey !== "paymentPostSubmission") return "false";
  const commonStages = `(${isYesSql("so.stage_delivery")}
    and not ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const stagewise = `(${isYesSql("so.stage_delivery")}
    and ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const pending = (
    submissionText: string,
    submissionDate: string,
    paymentDate: string,
    returnHistory: string,
    include: string,
  ) => `(
    ${include}
    and ${hasTextSql("so.so_date")}
    and not ${isYesSql("so.so_cancelled")}
    and not ${isYesSql("so.no_further_action")}
    and ${hasTextSql(submissionText)}
    and not ${hasTextSql(paymentDate)}
    and not ${returnHistory}
    and (current_date - (${submissionDate})) > ${thresholdPlaceholder}::integer
  )`;
  const commonCase = pending(
    "so.bill_sent_for_payment_date",
    "so.bill_sent_for_payment_date::date",
    "so.payment_date",
    billReturnHistorySql("so.bill_return_cycles"),
    "so.include_in_payment_timing is distinct from false",
  );
  const parentCase = pending(
    "so.bill_sent_for_payment_date",
    "so.bill_sent_for_payment_date::date",
    "so.payment_date",
    billReturnHistorySql("so.bill_return_cycles"),
    "so.include_in_payment_timing is distinct from false",
  );
  const stageCase = `exists (
    select 1
    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as payment_stage(stage)
    where lower(coalesce(payment_stage.stage ->> 'includeInPaymentTiming', 'true')) <> 'false'
      and ${pending(
        "payment_stage.stage ->> 'billSentForPaymentDate'",
        paymentTimingJsonDateSql("payment_stage.stage ->> 'billSentForPaymentDate'"),
        "payment_stage.stage ->> 'paymentDate'",
        billReturnHistorySql("payment_stage.stage -> 'billReturnCycles'"),
        "true",
      )}
  )`;
  const advanceSubmission = paymentTimingJsonDateSql(
    "so.advance_payment_detail ->> 'billSentForPaymentDate'",
  );
  const advanceCase = `(
    ${isYesSql("so.advance_payment")}
    and lower(coalesce(so.advance_payment_detail ->> 'includeInPaymentTiming', 'true')) <> 'false'
    and not ${isYesSql("so.so_cancelled")}
    and not ${isYesSql("so.no_further_action")}
    and ${hasTextSql("so.advance_payment_detail ->> 'billSentForPaymentDate'")}
    and not ${hasTextSql("so.advance_payment_detail ->> 'paymentDate'")}
    and not ${billReturnHistorySql("so.advance_payment_detail -> 'billReturnCycles'")}
    and (current_date - (${advanceSubmission})) > ${thresholdPlaceholder}::integer
  )`;
  const supplementaryCase = `exists (
    select 1
    from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
    where not ${isYesSql("so.so_cancelled")}
      and lower(coalesce(supplementary_bill.bill ->> 'includeInPaymentTiming', 'true')) <> 'false'
      and ${hasTextSql("supplementary_bill.bill ->> 'billSentForPaymentDate'")}
      and not ${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")}
      and not ${billReturnHistorySql("supplementary_bill.bill -> 'billReturnCycles'")}
      and (current_date - (${paymentTimingJsonDateSql("supplementary_bill.bill ->> 'billSentForPaymentDate'")})) > ${thresholdPlaceholder}::integer
  )`;
  return `not ${isYesSql("f.demand_cancelled")} and not ${fileClosedSql()} and exists (
    select 1 from supply_orders so
    where so.file_id = f.id
      and (${commonStages} and ${commonCase}
        or ${stagewise} and ${stageCase}
        or not (${isYesSql("so.stage_delivery")} and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)
          and ${parentCase}
        or ${advanceCase}
        or not ${isYesSql("so.no_further_action")} and ${supplementaryCase})
  )`;
}

function paymentCumulativeDelaySql(milestoneKey: string, thresholdPlaceholder: string) {
  if (milestoneKey !== "all" && milestoneKey !== "paymentCumulative") return "false";
  const commonStages = `(${isYesSql("so.stage_delivery")}
    and not ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const stagewise = `(${isYesSql("so.stage_delivery")}
    and ${isYesSql("so.stage_payment")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
  const hasDuration = (
    startDate: string,
    submissionText: string,
    submissionDate: string,
    paymentText: string,
    paymentDate: string,
    returnHistory: string,
    include: string,
    unpaidOnly: boolean,
  ) => {
    const endDate = `case when ${returnHistory} then ${submissionDate}
      when ${hasTextSql(paymentText)} then ${paymentDate}
      else current_date end`;
    return `(
      ${include}
      and ${hasTextSql("so.so_date")}
      and not ${isYesSql("so.so_cancelled")}
      and not ${returnHistory}
      and ${hasTextSql(startDate)}
      and (not ${returnHistory} or ${hasTextSql(submissionText)})
      and ${(!unpaidOnly || `not ${hasTextSql(paymentText)}`)}
      and (${endDate}) >= (${startDate})
      and ((${endDate}) - (${startDate})) > ${thresholdPlaceholder}::integer
    )`;
  };
  const parentTrigger = paymentTimingTriggerSql();
  const commonTrigger = latestPaymentTimingStageTriggerSql();
  const stageTrigger = paymentTimingTriggerSql("payment_stage.stage");
  const parentCase = hasDuration(
    parentTrigger,
    "so.bill_sent_for_payment_date",
    "so.bill_sent_for_payment_date::date",
    "so.payment_date",
    "so.payment_date::date",
    billReturnHistorySql("so.bill_return_cycles"),
    "so.include_in_payment_timing is distinct from false",
    true,
  );
  const commonCase = `(${commonStages} and ${hasDuration(
    commonTrigger,
    "so.bill_sent_for_payment_date",
    "so.bill_sent_for_payment_date::date",
    "so.payment_date",
    "so.payment_date::date",
    billReturnHistorySql("so.bill_return_cycles"),
    "so.include_in_payment_timing is distinct from false",
    true,
  )})`;
  const stageCase = `(${stagewise} and exists (
    select 1
    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as payment_stage(stage)
    where ${hasDuration(
      stageTrigger,
      "payment_stage.stage ->> 'billSentForPaymentDate'",
      paymentTimingJsonDateSql("payment_stage.stage ->> 'billSentForPaymentDate'"),
      "payment_stage.stage ->> 'paymentDate'",
      paymentTimingJsonDateSql("payment_stage.stage ->> 'paymentDate'"),
      billReturnHistorySql("payment_stage.stage -> 'billReturnCycles'"),
      "lower(coalesce(payment_stage.stage ->> 'includeInPaymentTiming', 'true')) <> 'false'",
      true,
    )}
  ))`;
  const advanceSubmissionText = "so.advance_payment_detail ->> 'billSentForPaymentDate'";
  const advanceSubmission = paymentTimingJsonDateSql(advanceSubmissionText);
  const advanceReturn = billReturnHistorySql("so.advance_payment_detail -> 'billReturnCycles'");
  const advanceEnd = `case when ${advanceReturn} then ${advanceSubmission}
    when ${hasTextSql("so.advance_payment_detail ->> 'paymentDate'")}
      then ${paymentTimingJsonDateSql("so.advance_payment_detail ->> 'paymentDate'")}
    else current_date end`;
  const advanceCase = `(
    ${isYesSql("so.advance_payment")}
    and lower(coalesce(so.advance_payment_detail ->> 'includeInPaymentTiming', 'true')) <> 'false'
    and not ${isYesSql("so.so_cancelled")}
    and not ${advanceReturn}
    and ${hasTextSql(advanceSubmissionText)}
    and (${advanceEnd}) >= (${advanceSubmission})
    and ((${advanceEnd}) - (${advanceSubmission})) > ${thresholdPlaceholder}::integer
    and not ${hasTextSql("so.advance_payment_detail ->> 'paymentDate'")}
  )`;
  const supplementaryCase = `exists (
    select 1
    from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
    where not ${isYesSql("so.so_cancelled")}
      and lower(coalesce(supplementary_bill.bill ->> 'includeInPaymentTiming', 'true')) <> 'false'
      and not ${billReturnHistorySql("supplementary_bill.bill -> 'billReturnCycles'")}
      and ${hasTextSql("supplementary_bill.bill ->> 'billSentForPaymentDate'")}
      and not ${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")}
      and ${(() => {
        const submission = paymentTimingJsonDateSql("supplementary_bill.bill ->> 'billSentForPaymentDate'");
        const hasReturn = billReturnHistorySql("supplementary_bill.bill -> 'billReturnCycles'");
        const end = `case when ${hasReturn} then ${submission} else current_date end`;
        return `(${end}) >= (${submission}) and ((${end}) - (${submission})) > ${thresholdPlaceholder}::integer`;
      })()}
  )`;
  return `not ${isYesSql("f.demand_cancelled")} and not ${fileClosedSql()} and exists (
    select 1 from supply_orders so
    where so.file_id = f.id
      and not ${isYesSql("so.no_further_action")}
      and (${commonCase}
        or ${stageCase}
        or not (${isYesSql("so.stage_delivery")} and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0) and ${parentCase}
        or ${advanceCase}
        or ${supplementaryCase})
  )`;
}

function decodeStatusFilterPart(value: string | undefined) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function statusSummaryFilterSql(filter: string) {
  const [, rawMilestone, rawStage] = filter.split(":");
  const milestoneName = decodeStatusFilterPart(rawMilestone);
  const stage = decodeStatusFilterPart(rawStage);
  const base = "true";

  if (milestoneName === "Advance Payment") {
    if (stage === "Completed") {
      return `${base} and ${supplyOrderExists(
        `${isYesSql("so.advance_payment")}
         and not ${isYesSql("so.so_cancelled")}
         and ${hasTextSql("so.advance_payment_detail ->> 'paymentDate'")}`,
      )}`;
    }
    if (stage === "Pending") {
      return `${base} and ${supplyOrderExists(
        `${isYesSql("so.advance_payment")}
         and not ${isYesSql("so.so_cancelled")}
         and not ${isYesSql("so.no_further_action")}
         and ${normalizedSql("so.advance_payment_detail ->> 'currentMilestone'")} = 'advancepayment'
         and not ${hasTextSql("so.advance_payment_detail ->> 'paymentDate'")}`,
      )}`;
    }
    return "false";
  }

  if (milestoneName === "Delivery Period") {
    if (stage === "Valid") {
      return `${base} and ${deliveryPeriodBucketSql("valid")}`;
    }
    if (stage === "Expired") {
      return `${base} and not ${isCancelledFileSql()} and ${deliveryPeriodBucketSql("expired")}`;
    }
    if (stage === "Extended") {
      return `${base} and ${deliveryPeriodBucketSql("extended")}`;
    }
    return "false";
  }

  if (milestoneName === "Job Completion") {
    if (stage === "Done" || stage === "Completed") {
      return `${base} and ${jobCompletionCompletedFilterSql()}`;
    }
    if (stage === "Due" || stage === "Live Milestone") {
      return `${base} and ${jobCompletionFilterSql("live")}`;
    }
    if (stage === "Milestone Period Over") {
      return `${base} and ${jobCompletionFilterSql("periodOver")}`;
    }
    return "false";
  }

  if (milestoneName === "Pre-Bid Meeting") {
    if (stage === "Due") return `${base} and ${preBidMeetingFilterSql(false, "due")}`;
    if (stage === "Completed") return `${base} and ${preBidMeetingFilterSql(false, "completed")}`;
    if (stage === "Refloat Due") return `${base} and ${preBidMeetingFilterSql(true, "due")}`;
    if (stage === "Refloat Completed") {
      return `${base} and ${preBidMeetingFilterSql(true, "completed")}`;
    }
    return "false";
  }

  if (milestoneName === "Bill returned for correction" || milestoneName === "Returned Bills") {
    if (stage === "Total" || stage === "Bills returned")
      return `${base} and ${billReturnStatusFilterSql("any")}`;
    if (stage === "Pending" || stage === "Return pending")
      return `${base} and ${billReturnStatusFilterSql("pendingRegular")}`;
    if (stage === "Resubmitted and Unpaid")
      return `${base} and ${billReturnStatusFilterSql("resubmittedUnpaid")}`;
    if (stage === "Completed" || stage === "Resubmitted")
      return `${base} and ${billReturnStatusFilterSql("resubmitted")}`;
    if (stage === "Returned paid") return `${base} and ${billReturnStatusFilterSql("paid")}`;
    return "false";
  }

  if (milestoneName === "Supplementary bills" || milestoneName === "Supplementary Bill") {
    if (stage === "Submitted" || stage === "Submitted total") {
      return `${base} and ${supplementaryBillStatusSql("submitted")}`;
    }
    if (stage === "Returned" || stage === "Returned total") {
      return `${base} and ${supplementaryBillStatusSql("any")}`;
    }
    if (stage === "Return pending") return `${base} and ${supplementaryBillStatusSql("returned")}`;
    if (stage === "Resubmitted" || stage === "Resubmitted total") {
      return `${base} and ${supplementaryBillStatusSql("resubmitted")}`;
    }
    if (stage === "Returned paid") return `${base} and ${supplementaryBillStatusSql("returnPaid")}`;
    if (stage === "Normal paid" || stage === "Paid") {
      return `${base} and ${supplementaryBillStatusSql("paid")}`;
    }
    if (stage === "Pending") return `${base} and ${supplementaryBillStatusSql("pending")}`;
    return "false";
  }

  if (milestoneName === "Delivery" || milestoneName === "Delivery/Job") {
    if (stage === "Completed") {
      return `${base} and ${deliveryJobFilterSql("completed")}`;
    }
    if (stage === "Pending") {
      return `${base} and ${deliveryJobFilterSql("pending")}`;
    }
    if (stage === "Overdue") {
      return `${base} and ${deliveryJobFilterSql("overdue")}`;
    }
    if (stage === "Live Milestone") {
      return `${base} and ${jobCompletionFilterSql("live")}`;
    }
    if (stage === "Milestone Period Over") {
      return `${base} and ${jobCompletionFilterSql("periodOver")}`;
    }
    return "false";
  }

  const milestoneIndex = statusSummaryMilestones.findIndex((item) => item.label === milestoneName);
  const milestone = statusSummaryMilestones[milestoneIndex];
  if (!milestone) return "false";

  if (
    milestone.key === "refloatPostTcec" &&
    (stage === "At previous stage" || stage === "At Previous Stage")
  ) {
    return `${base} and not ${isCancelledFileSql()} and ${milestonePreviousStageSql(milestone)}`;
  }

  const supplyOrderDrivenStatusKeys = new Set([
    "irPreparation",
    "irReceipt",
    "billPreparation",
    "billSentForPayment",
  ]);
  if (supplyOrderDrivenStatusKeys.has(milestone.key)) {
    const normalizedMilestone = normalizeMilestoneName(milestone.label);
    const completed = supplyOrderDrivenCompletedMilestoneConditionSql(normalizedMilestone);
    const pending = supplyOrderDrivenCurrentMilestoneConditionSql(`'${normalizedMilestone}'`);
    if (stage === "Completed") return `${base} and ${completed}`;
    if (stage === "Pending") return `${base} and ${pending}`;
    if (stage === "Total" || stage === milestone.totalLabel) {
      return `${base} and ((${completed}) or (${pending}))`;
    }
    if (stage === "At previous stage" || stage === "At Previous Stage") {
      return `${base} and ${milestonePreviousStageSql(milestone)}`;
    }
    return "false";
  }

  const applies = statusAppliesSql(milestone);
  const historicalCompletedMilestone =
    ["scrutiny", "control", "cfa", "bidding"].includes(milestone.key) &&
    stage === "Completed";
  const process = `${applies} and ${
    historicalCompletedMilestone
      ? `not ${isYesSql("f.demand_cancelled")}`
      : `not ${isCancelledFileSql()}`
  }`;
  const complete = statusCompleteSql(milestone);
  const reached = previousStatusCompleteSql(milestoneIndex);
  const active = `${process} and ${statusActiveSql(milestone)}`;
  const reviewed = statusReviewedSql(milestone);
  const pending =
    "reviewedColumn" in milestone && milestone.reviewedColumn
      ? `${active} and not (${reviewed}) and not (${complete})`
      : `${active} and not (${complete})`;

  if (milestone.key === "refloatBidding") {
    const refloatActive = `not ${isCancelledFileSql()} and ${refloatBiddingInProgressSql()}`;
    const refloatOverdue = refloatBidOpeningOverdueSql();
    if (stage === "Live") {
      return `${base} and not ${isCancelledFileSql()} and ${refloatBidLiveSql()}`;
    }
    if (stage === "In process") {
      return `${base} and ${refloatActive} and not (${refloatBidLiveSql()}) and not (${refloatOverdue})`;
    }
    if (stage === "Opening overdue") {
      return `${base} and ${refloatActive} and ${refloatOverdue}`;
    }
    if (stage === "Completed") {
      return `${base} and ${process} and ${complete}`;
    }
    if (stage === "At previous stage" || stage === "At Previous Stage") return "false";
  }

  if (milestone.key === "bidding") {
    const normalBiddingInProgress = `${biddingApplicableSql()}
      and not ${isYesSql("f.refloat")}
      and ${hasTextSql("f.cfa_date")}
      and not ${isYesSql("f.bidding_stage_over")}`;
    if (stage === "Live") {
      return `${base} and not ${isCancelledFileSql()} and ${normalBidLiveSql()}`;
    }
    if (stage === "In process") {
      return `${base} and not ${isCancelledFileSql()} and ${normalBiddingInProgress} and not (${normalBidLiveSql()}) and not (${bidOpeningOverdueSql()})`;
    }
    if (stage === "Opening overdue") {
      return `${base} and not ${isCancelledFileSql()} and ${normalBiddingInProgress} and ${bidOpeningOverdueSql()}`;
    }
    if (stage === "Completed") {
      return `${base} and not ${isYesSql("f.demand_cancelled")} and ${statusAppliesSql(milestone)} and ${statusCompleteSql(milestone)}`;
    }
  }

  if (stage === "Pending" && isBgStatusKey(milestone.key)) {
    return `${base} and ${bgToBeReceivedSql(milestone.key)}`;
  }
  if (stage === "Pending" && milestone.key === "payment") {
    return `${base} and ${paymentPendingSql()}`;
  }
  if (stage === "Due" && milestone.key === "payment") {
    return `${base} and ${paymentBucketSql("due")}`;
  }
  if (stage === "In process" && milestone.key === "payment") {
    return `${base} and ${paymentBucketSql("inProcess")}`;
  }
  if ((stage === "Submitted" || stage === "Submitted and unpaid") && milestone.key === "payment") {
    return `${base} and ${paymentBucketSql("submitted", true)}`;
  }
  if (stage === "Completed" && milestone.key === "payment") {
    return `${base} and ${paymentCompletedSql()}`;
  }
  if ((stage === "Total" || stage === milestone.totalLabel) && milestone.key === "payment") {
    return `${base} and (${paymentPendingSql()} or ${paymentCompletedSql()})`;
  }
  if (stage === "Total" || stage === milestone.totalLabel) return `${base} and ${applies}`;
  if (stage === "Pending" && milestone.key === "supplyOrder") {
    return `${base} and ${supplyOrderDrivenCurrentMilestoneConditionSql(
      "'supplyorder'",
    )} and not (${complete})`;
  }
  if (
    milestone.key === "supplyOrder" &&
    (stage === "At Previous Stage" || stage === "At previous stage")
  ) {
    return `${base} and ${supplyOrderDrivenCurrentMilestoneConditionSql(
      "'financialsanction'",
    )} and not (${complete})`;
  }
  if (milestone.key === "financialSanction") {
    const financialSanctionPending = `${supplyOrderDrivenCurrentMilestoneConditionSql(
      "'financialsanction'",
    )} and not (${complete})`;
    if (stage === "Total" || stage === milestone.totalLabel) {
      return `${base} and ${complete}`;
    }
    if (stage === "At Previous Stage" || stage === "At previous stage") {
      return `${base} and ${financialSanctionPreviousStageSql()}`;
    }
    if (stage === "Pending") return `${base} and ${financialSanctionPending}`;
  }
  if (stage === "Completed") return `${base} and ${process} and ${complete}`;
  if (stage === "Pending") return `${base} and ${pending}`;
  if (stage === "In process") {
    if (milestone.key === "bidding") {
      return `${base} and ${active} and not (${normalBidLiveSql()}) and not (${bidOpeningOverdueSql()})`;
    }
    return `${base} and ${active}`;
  }
  if (stage === "Reviewed") return `${base} and ${active} and ${reviewed} and not (${complete})`;
  if (stage === "Opening overdue") {
    return `${base} and ${applies} and ${bidOpeningOverdueSql()}`;
  }
  if (stage === "Live") {
    if (milestone.key === "bidding")
      return `${base} and ${applies} and ${normalBidLiveSql()}`;
    if (milestone.key === "supplyOrder") return `${base} and ${liveSupplyOrderSql()}`;
  }
  if (stage === "Placed" && milestone.key === "supplyOrder") {
    return `${base} and ${supplyOrderDrivenCompletedMilestoneConditionSql("supplyorder")}`;
  }
  if (stage === "Received" && isBgStatusKey(milestone.key)) {
    return `${base} and ${bgReceivedSql(milestone.key)}`;
  }
  if (stage === "Expired" && isBgStatusKey(milestone.key)) {
    return `${base} and ${bgExpiredSql(milestone.key)}`;
  }
  if (stage === "To be returned" && isBgStatusKey(milestone.key)) {
    return `${base} and ${bgReturnDueSql(milestone.key)}`;
  }
  if (stage === "Returned" && isBgStatusKey(milestone.key)) {
    return `${base} and ${bgReturnedSql(milestone.key)}`;
  }
  if (
    stage === "At Previous Stage" ||
    stage === "At previous stage" ||
    stage === "At previous stages"
  ) {
    return `${base} and ${applies} and (${reached}) and not (${active}) and not (${reviewed}) and not (${complete})`;
  }
  return "false";
}

function billReturnStatusFilterSql(state: "any" | "pending" | "pendingRegular" | "resubmitted" | "resubmittedUnpaid" | "paid") {
  const latestCycleSql = (source: string) => `(select cycle
    from jsonb_array_elements(coalesce(${source}, '[]'::jsonb)) with ordinality as bill_return(cycle, cycle_index)
    where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
    order by nullif(bill_return.cycle ->> 'returnedDate', '')::date desc nulls last, bill_return.cycle_index desc
    limit 1)`;
  const returnedCycleSql = (source: string) => `exists (
    select 1 from (${latestCycleSql(source)}) as latest(cycle)
  )`;
  const pendingCycleSql = (source: string) => `exists (
    select 1 from (${latestCycleSql(source)}) as latest(cycle)
    where not ${hasTextSql("latest.cycle ->> 'resubmittedDate'")}
      and not ${isYesSql("so.no_further_action")}
  )`;
  const resubmittedCycleSql = (source: string) => `exists (
    select 1 from (${latestCycleSql(source)}) as latest(cycle)
    where ${hasTextSql("latest.cycle ->> 'resubmittedDate'")}
  )`;
  const resolvedCycleSql = resubmittedCycleSql;
  const mainSource = "so.bill_return_cycles";
  const advanceSource = "so.advance_payment_detail -> 'billReturnCycles'";
  const stageEntrySql = (condition: (source: string) => string) => `exists (
	    select 1
	    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
	    where ${condition("stage_row.stage -> 'billReturnCycles'")}
	  )`;
  const anyPaymentEntrySql = (condition: (source: string) => string) =>
    `(${condition(mainSource)} or ${stageEntrySql(condition)} or ${condition(advanceSource)})`;
  const regularStagePaymentEntrySql = (condition: (source: string) => string) =>
    `(${condition(mainSource)} or ${stageEntrySql(condition)})`;
  const paidPaymentEntrySql = `(
	    (${resolvedCycleSql(mainSource)} and ${hasTextSql("so.payment_date")})
	    or exists (
      select 1
      from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
      where ${resolvedCycleSql("stage_row.stage -> 'billReturnCycles'")}
        and ${hasTextSql("stage_row.stage ->> 'paymentDate'")}
	    )
	    or (${resolvedCycleSql(advanceSource)} and ${hasTextSql("so.advance_payment_detail ->> 'paymentDate'")})
	  )`;
  const stateSql =
    state === "pending"
      ? anyPaymentEntrySql(pendingCycleSql)
      : state === "pendingRegular"
        ? regularStagePaymentEntrySql(pendingCycleSql)
      : state === "resubmitted"
        ? anyPaymentEntrySql(resolvedCycleSql)
        : state === "resubmittedUnpaid"
          ? `not ${isYesSql("so.no_further_action")}
            and (
              (${resolvedCycleSql(mainSource)} and not ${hasTextSql("so.payment_date")})
              or exists (
                select 1
                from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
                where ${resolvedCycleSql("stage_row.stage -> 'billReturnCycles'")}
                  and not ${hasTextSql("stage_row.stage ->> 'paymentDate'")}
              )
              or (${resolvedCycleSql(advanceSource)}
                and not ${hasTextSql("so.advance_payment_detail ->> 'paymentDate'")})
            )`
        : state === "paid"
          ? paidPaymentEntrySql
          : anyPaymentEntrySql(returnedCycleSql);
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")} and ${stateSql}`,
  )}`;
}

function supplementaryBillStatusSql(
  state:
    | "any"
    | "submitted"
    | "returned"
    | "resubmitted"
    | "paid"
    | "returnPaid"
    | "pending"
    | "normalPending"
    | "returnPendingUnpaid"
    | "resubmittedPending",
) {
  const latestCycleSql = `(select cycle
    from jsonb_array_elements(coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)) with ordinality as bill_return(cycle, cycle_index)
    where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
    order by nullif(bill_return.cycle ->> 'returnedDate', '')::date desc nulls last, bill_return.cycle_index desc
    limit 1)`;
  const hasSupplementaryBillData = `(
    ${hasTextSql("supplementary_bill.bill ->> 'billNo'")}
    or ${hasTextSql("supplementary_bill.bill ->> 'billAmountCapital'")}
    or ${hasTextSql("supplementary_bill.bill ->> 'billAmountRevenue'")}
    or ${hasTextSql("supplementary_bill.bill ->> 'billSentForPaymentDate'")}
    or ${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")}
    or ${hasTextSql("supplementary_bill.bill ->> 'paymentMode'")}
    or ${hasTextSql("supplementary_bill.bill ->> 'actualPaymentCapital'")}
    or ${hasTextSql("supplementary_bill.bill ->> 'actualPaymentRevenue'")}
    or ${hasTextSql("supplementary_bill.bill ->> 'remarks'")}
    or exists (
      select 1
      from jsonb_array_elements(coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)) as bill_return(cycle)
      where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
        or ${hasTextSql("bill_return.cycle ->> 'reason'")}
        or ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
        or ${hasTextSql("bill_return.cycle ->> 'remarks'")}
    )
  )`;
  const openReturn = `exists (select 1 from (${latestCycleSql}) as latest(cycle)
    where not ${hasTextSql("latest.cycle ->> 'resubmittedDate'")})`;
  const completedReturn = `exists (select 1 from (${latestCycleSql}) as latest(cycle)
    where ${hasTextSql("latest.cycle ->> 'resubmittedDate'")})`;
  const pendingUnpaid = `${hasTextSql("supplementary_bill.bill ->> 'billSentForPaymentDate'")}
    and not ${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")}`;
  const returnHistory = `exists (
    select 1
    from jsonb_array_elements(coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)) as bill_return(cycle)
    where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
       or ${hasTextSql("bill_return.cycle ->> 'reason'")}
       or ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
       or ${hasTextSql("bill_return.cycle ->> 'remarks'")}
  )`;
  const stateCondition =
    state === "any"
      ? `exists (
          select 1
          from (${latestCycleSql}) as latest(cycle)
          where true
        )`
      : state === "pending"
        ? `${hasTextSql("supplementary_bill.bill ->> 'billSentForPaymentDate'")}
             and not ${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")}
             and not ${isYesSql("so.no_further_action")}`
      : state === "normalPending"
        ? `${pendingUnpaid} and not ${returnHistory} and not ${isYesSql("so.no_further_action")}`
      : state === "returnPendingUnpaid"
        ? `${pendingUnpaid} and ${returnHistory} and not ${completedReturn} and not ${isYesSql("so.no_further_action")}`
      : state === "resubmittedPending"
        ? `${pendingUnpaid} and ${completedReturn} and not ${isYesSql("so.no_further_action")}`
      : state === "paid"
        ? `${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")}
             and not exists (
               select 1
               from jsonb_array_elements(coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)) as bill_return(cycle)
               where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
                  or ${hasTextSql("bill_return.cycle ->> 'reason'")}
                  or ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
                  or ${hasTextSql("bill_return.cycle ->> 'remarks'")}
             )`
        : state === "returnPaid"
          ? `${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")} and ${completedReturn}`
      : state === "returned"
            ? `not ${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")}
               and ${openReturn}
               and not ${isYesSql("so.no_further_action")}`
            : state === "resubmitted"
              ? completedReturn
              : hasTextSql("supplementary_bill.bill ->> 'billSentForPaymentDate'");
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")}
     and exists (
       select 1
       from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
       where ${hasSupplementaryBillData}
         and ${stateCondition}
     )`,
  )}`;
}

function isBillReturnFilterState(
  state: string,
): state is "any" | "pending" | "pendingRegular" | "resubmitted" | "resubmittedUnpaid" | "paid" {
  return state === "any" || state === "pending" || state === "pendingRegular" || state === "resubmitted" || state === "resubmittedUnpaid" || state === "paid";
}

function readCashOutgoFilter(filter: string) {
  const [, mode, rawMonthKey, rawOffsetDays, rawFromDate, rawToDate, rawAsOfDate] =
    filter.split(":");
  const monthKey = decodeStatusFilterPart(rawMonthKey);
  const offsetDays = Number.parseInt(rawOffsetDays ?? "0", 10);
  const fromDate = decodeStatusFilterPart(rawFromDate);
  const toDate = decodeStatusFilterPart(rawToDate);
  const asOfDate = decodeStatusFilterPart(rawAsOfDate);
  const validModes = [
    "expectedDp",
    "expectedDpThrough",
    "expectedReceipt",
    "expectedReceiptThrough",
    "expectedReceiptPendingBill",
    "expectedReceiptPendingBillThrough",
    "billPreparation",
    "billPreparationThrough",
    "billSent",
    "billSentThrough",
    "actual",
    "actualThrough",
    "supplementaryBillSent",
    "supplementaryActual",
    "returnedBills",
    "pendingReturnedBills",
    "returnedBillsResubmitted",
    "returnedBillsPaid",
    "supplementaryReturnedBills",
    "supplementaryPendingReturnedBills",
    "supplementaryReturnedBillsResubmitted",
    "supplementaryReturnedBillsPaid",
  ];
  if (
    !validModes.includes(mode) ||
    (monthKey !== "all" && !/^\d{4}-\d{2}$/.test(monthKey)) ||
    !Number.isFinite(offsetDays) ||
    offsetDays < 0 ||
    (fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) ||
    (toDate && !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) ||
    (asOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate))
  ) {
    return undefined;
  }
  return {
    mode: mode as
      | "expectedDp"
      | "expectedDpThrough"
      | "expectedReceipt"
      | "expectedReceiptThrough"
      | "expectedReceiptPendingBill"
      | "expectedReceiptPendingBillThrough"
      | "billPreparation"
      | "billPreparationThrough"
      | "billSent"
      | "billSentThrough"
      | "actual"
      | "actualThrough"
      | "supplementaryBillSent"
      | "supplementaryActual"
      | "returnedBills"
      | "pendingReturnedBills"
      | "returnedBillsResubmitted"
      | "returnedBillsPaid"
      | "supplementaryReturnedBills"
      | "supplementaryPendingReturnedBills"
      | "supplementaryReturnedBillsResubmitted"
      | "supplementaryReturnedBillsPaid",
    monthKey,
    offsetDays,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    asOfDate: asOfDate || undefined,
  };
}

function monthMatchesSql(dateExpression: string, monthPlaceholder: string) {
  return `(${monthPlaceholder}::text = 'all' or to_char(${dateExpression}, 'YYYY-MM') = ${monthPlaceholder}::text)`;
}

function cashOutgoFilterSql(filter: string, values: unknown[]) {
  const parsed = readCashOutgoFilter(filter);
  if (!parsed) return "false";

  const monthPlaceholder = addSqlValue(values, parsed.monthKey);
  const usesOffset = [
    "expectedDp",
    "expectedDpThrough",
    "expectedReceipt",
    "expectedReceiptThrough",
    "expectedReceiptPendingBill",
    "expectedReceiptPendingBillThrough",
  ].includes(parsed.mode);
  const offsetPlaceholder = usesOffset ? addSqlValue(values, parsed.offsetDays) : undefined;
  const offsetInterval = `(${offsetPlaceholder}::integer * interval '1 day')`;
  const activeFile = `not ${isCancelledFileSql()}`;
  let fromDatePlaceholder: string | undefined;
  let toDatePlaceholder: string | undefined;
  let asOfDatePlaceholder: string | undefined;
  const getFromDatePlaceholder = () => {
    if (!parsed.fromDate) return undefined;
    fromDatePlaceholder ??= addSqlValue(values, parsed.fromDate);
    return fromDatePlaceholder;
  };
  const getToDatePlaceholder = () => {
    if (!parsed.toDate) return undefined;
    toDatePlaceholder ??= addSqlValue(values, parsed.toDate);
    return toDatePlaceholder;
  };
  const getAsOfDatePlaceholder = () => {
    if (!parsed.asOfDate) return undefined;
    asOfDatePlaceholder ??= addSqlValue(values, parsed.asOfDate);
    return asOfDatePlaceholder;
  };
  const rangeSql = (dateExpression: string) => {
    const fromPlaceholder = getFromDatePlaceholder();
    const toPlaceholder = getToDatePlaceholder();
    return fromPlaceholder && toPlaceholder
      ? ` and ${dateExpression} between ${fromPlaceholder}::date and ${toPlaceholder}::date`
      : "";
  };
  const asOfMissingOrAfterSql = (dateExpression: string) =>
    getAsOfDatePlaceholder()
      ? `(${dateExpression} is null or ${dateExpression} > ${getAsOfDatePlaceholder()}::date)`
      : undefined;
  const asOfOnOrBeforeSql = (dateExpression: string) =>
    getAsOfDatePlaceholder() ? `${dateExpression} <= ${getAsOfDatePlaceholder()}::date` : undefined;
  const toDateMissingOrAfterSql = (dateExpression: string) =>
    getToDatePlaceholder()
      ? `(${dateExpression} is null or ${dateExpression} > ${getToDatePlaceholder()}::date)`
      : undefined;
  const toDateOnOrBeforeSql = (dateExpression: string) =>
    getToDatePlaceholder() ? `${dateExpression} <= ${getToDatePlaceholder()}::date` : undefined;
  const maintenanceFileType = `${contractFileTypeSql("f")}`;
  const goodsServicesIrNo = `(not ${isYesSql("f.ir")} and not ${maintenanceFileType})`;
  const nonDeliveryFileType = `(${goodsServicesIrNo} or ${maintenanceFileType})`;
  const stageDpDate = `coalesce(nullif(stage_row.stage ->> 'revisedDp', '')::date, nullif(stage_row.stage ->> 'dpDate', '')::date)`;
  const stageJobCompletionDone = `coalesce(stage_row.stage ->> 'jobCompletionDate', '') <> ''`;
  const orderJobCompletionDone = completedOrderMilestoneSql("so", "jobcompletion");
  const stageReportBaseDate = `case
      when ${maintenanceFileType} then least(
        (${stageDpDate} + interval '1 day')::date,
        nullif(stage_row.stage ->> 'jobCompletionDate', '')::date
      )
      when ${goodsServicesIrNo} and ${stageJobCompletionDone} then nullif(stage_row.stage ->> 'jobCompletionDate', '')::date
      else nullif(stage_row.stage ->> 'materialReceiptDate', '')::date
    end`;
  const orderReportBaseDate = `case
      when ${maintenanceFileType} then least(
        (coalesce(so.revised_dp, so.dp_date) + interval '1 day')::date,
        so.job_completion_date
      )
      when ${goodsServicesIrNo} and ${orderJobCompletionDone} then so.job_completion_date
      else so.material_receipt_date
    end`;
  const legacyReportBaseDate = `case
      when ${maintenanceFileType} then (coalesce(f.revised_dp, f.dp_date) + interval '1 day')::date
      else f.material_receipt_date
    end`;
  const stageBillPreparationDate = `case
      when ${isYesSql("so.stage_payment")} then nullif(stage_row.stage ->> 'billPreparationDate', '')::date
      when not ${isYesSql("so.stage_payment")} and stage_row.ordinality = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) then so.bill_preparation_date
      else null::date
    end`;
  const stageBillSentForPaymentDate = `case
      when ${isYesSql("so.stage_payment")} then nullif(stage_row.stage ->> 'billSentForPaymentDate', '')::date
      when not ${isYesSql("so.stage_payment")} and stage_row.ordinality = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) then so.bill_sent_for_payment_date
      else null::date
    end`;
  const stagePaymentDate = `case
      when ${isYesSql("so.stage_payment")} then nullif(stage_row.stage ->> 'paymentDate', '')::date
      when not ${isYesSql("so.stage_payment")} and stage_row.ordinality = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) then so.payment_date
      else null::date
    end`;
  const advanceBillPreparationDate = `nullif(so.advance_payment_detail ->> 'billPreparationDate', '')::date`;
  const advanceBillSentForPaymentDate = `nullif(so.advance_payment_detail ->> 'billSentForPaymentDate', '')::date`;
  const advancePaymentDate = `nullif(so.advance_payment_detail ->> 'paymentDate', '')::date`;
  const stagePaymentRowExists = (condition: string) => `exists (
          select 1
          from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) with ordinality as stage_row(stage, ordinality)
          where ${isYesSql("so.stage_delivery")}
            and ${condition}
        )`;
  const billReturnDateSql = (
    cyclesExpression: string,
    mode:
      | "returnedBills"
      | "pendingReturnedBills"
      | "returnedBillsResubmitted"
      | "returnedBillsPaid",
    paymentDateExpression: string,
  ) => {
    const latestCycle = latestBillReturnCycleSql(cyclesExpression);
    if (mode === "returnedBills") {
      return `nullif((${latestCycle}) ->> 'returnedDate', '')::date`;
    }
    if (mode === "pendingReturnedBills") {
      return `case when ${latestBillReturnStateSql(cyclesExpression, "open")}
        then nullif((${latestCycle}) ->> 'returnedDate', '')::date end`;
    }
    if (mode === "returnedBillsResubmitted") {
      return `case when ${latestBillReturnStateSql(cyclesExpression, "resubmitted")}
        then nullif((${latestCycle}) ->> 'resubmittedDate', '')::date end`;
    }
    return paymentDateExpression;
  };
  const billReturnStateSql = (
    cyclesExpression: string,
    mode:
      | "returnedBills"
      | "pendingReturnedBills"
      | "returnedBillsResubmitted"
      | "returnedBillsPaid",
    paymentDateExpression: string,
  ) => {
    const hasReturned = `exists (select 1 from (${latestBillReturnCycleSql(cyclesExpression)}) as latest(cycle))`;
    const hasOpen = latestBillReturnStateSql(cyclesExpression, "open");
    const hasResubmitted = latestBillReturnStateSql(cyclesExpression, "resubmitted");
    if (mode === "returnedBills") return hasReturned;
    if (mode === "pendingReturnedBills") return hasOpen;
    if (mode === "returnedBillsResubmitted") return `${hasResubmitted} and ${paymentDateExpression} is null`;
    return `${paymentDateExpression} is not null and ${hasResubmitted}`;
  };
  const openBillReturnSql = (cyclesExpression: string) =>
    latestBillReturnStateSql(cyclesExpression, "open");
  const dateScopeSql = (dateExpression: string, through = false) => {
    if (!through) {
      return `${monthMatchesSql(dateExpression, monthPlaceholder)}${rangeSql(dateExpression)}`;
    }
    if (parsed.monthKey === "all") return "false";
    const throughDate = getMonthEndDateFromMonthKey(parsed.monthKey);
    return `${monthPlaceholder}::text is not null and ${dateExpression} <= date '${throughDate}'${rangeSql(dateExpression)}`;
  };

  if (parsed.mode === "expectedDp" || parsed.mode === "expectedDpThrough") {
    const through = parsed.mode === "expectedDpThrough";
    const childDate = `(coalesce(so.revised_dp, so.dp_date) + ((${offsetPlaceholder}::integer + 1) * interval '1 day'))::date`;
    const legacyDate = `(coalesce(f.revised_dp, f.dp_date) + ((${offsetPlaceholder}::integer + 1) * interval '1 day'))::date`;
    const stageDate = `(${stageDpDate} + ((${offsetPlaceholder}::integer + 1) * interval '1 day'))::date`;
    const stageRowsExist = `${isYesSql("so.stage_delivery")}
      and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0`;
    return `${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")}
       and not ${isYesSql("so.no_further_action")} and (
        (
          not (${stageRowsExist})
          and
          coalesce(so.revised_dp, so.dp_date) is not null
          and (
            (
              ${nonDeliveryFileType}
              and ${asOfMissingOrAfterSql("so.bill_preparation_date") ?? `not ${hasTextSql("so.bill_preparation_date")}`}
              and ${asOfMissingOrAfterSql("so.bill_sent_for_payment_date") ?? `not ${hasTextSql("so.bill_sent_for_payment_date")}`}
              and ${asOfMissingOrAfterSql("so.payment_date") ?? `not ${hasTextSql("so.payment_date")}`}
              and ${asOfMissingOrAfterSql("so.job_completion_date") ?? `not ${hasTextSql("so.job_completion_date")}`}
            )
            or (
              not ${nonDeliveryFileType}
              and ${asOfMissingOrAfterSql("so.material_receipt_date") ?? `not ${hasTextSql("so.material_receipt_date")}`}
              and ${asOfMissingOrAfterSql("so.payment_date") ?? `not ${hasTextSql("so.payment_date")}`}
            )
          )
          and ${dateScopeSql(childDate, through)}
        )
        or ${stagePaymentRowExists(
          `${stageDpDate} is not null
            and (
              (
                ${nonDeliveryFileType}
                and ${asOfMissingOrAfterSql(stageBillPreparationDate) ?? `${stageBillPreparationDate} is null`}
                and ${asOfMissingOrAfterSql(stageBillSentForPaymentDate) ?? `${stageBillSentForPaymentDate} is null`}
                and ${asOfMissingOrAfterSql(stagePaymentDate) ?? `${stagePaymentDate} is null`}
                and ${asOfMissingOrAfterSql("nullif(stage_row.stage ->> 'jobCompletionDate', '')::date") ?? `coalesce(stage_row.stage ->> 'jobCompletionDate', '') = ''`}
              )
              or (
                not ${nonDeliveryFileType}
                and ${asOfMissingOrAfterSql("nullif(stage_row.stage ->> 'materialReceiptDate', '')::date") ?? `coalesce(stage_row.stage ->> 'materialReceiptDate', '') = ''`}
                and ${asOfMissingOrAfterSql(stagePaymentDate) ?? `${stagePaymentDate} is null`}
              )
            )
            and ${dateScopeSql(stageDate, through)}`,
        )}
      )`,
      `coalesce(f.revised_dp, f.dp_date) is not null
       and not ${isYesSql("f.so_cancelled")}
       and (
         (
           ${nonDeliveryFileType}
           and ${asOfMissingOrAfterSql("f.bill_preparation_date") ?? `not ${hasTextSql("f.bill_preparation_date")}`}
           and ${asOfMissingOrAfterSql("f.bill_sent_for_payment_date") ?? `not ${hasTextSql("f.bill_sent_for_payment_date")}`}
           and ${asOfMissingOrAfterSql("f.payment_date") ?? `not ${hasTextSql("f.payment_date")}`}
           and ${asOfMissingOrAfterSql("f.job_completion_date") ?? `not ${hasTextSql("f.job_completion_date")}`}
         )
         or (
           not ${nonDeliveryFileType}
           and ${asOfMissingOrAfterSql("f.material_receipt_date") ?? `not ${hasTextSql("f.material_receipt_date")}`}
           and ${asOfMissingOrAfterSql("f.payment_date") ?? `not ${hasTextSql("f.payment_date")}`}
         )
       )
       and ${dateScopeSql(legacyDate, through)}`,
    )}`;
  }

  if (parsed.mode === "expectedReceipt") {
    const stageRowsExist = `${isYesSql("so.stage_delivery")} and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0`;
    const childBaseDate = orderReportBaseDate;
    const legacyBaseDate = legacyReportBaseDate;
    const childDate = `(${childBaseDate} + ${offsetInterval})::date`;
    const legacyDate = `(${legacyBaseDate} + ${offsetInterval})::date`;
    const stageDate = `(${stageReportBaseDate} + ${offsetInterval})::date`;
    return `${monthPlaceholder}::text is not null and ${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")}
       and not ${isYesSql("so.no_further_action")} and (
        (
          not (${stageRowsExist})
          and
          ${childBaseDate} is not null
          and ${asOfOnOrBeforeSql(childBaseDate) ?? "true"}
          and ${asOfMissingOrAfterSql("so.payment_date") ?? `not ${hasTextSql("so.payment_date")}`}
          and ${monthMatchesSql(childDate, monthPlaceholder)}${rangeSql(childDate)}
        )
        or exists (
          select 1
          from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) with ordinality as stage_row(stage, ordinality)
          where ${isYesSql("so.stage_delivery")}
            and ${stageDate} is not null
            and ${asOfOnOrBeforeSql(stageDate) ?? "true"}
            and ${asOfMissingOrAfterSql(stagePaymentDate) ?? `${stagePaymentDate} is null`}
            and ${monthMatchesSql(stageDate, monthPlaceholder)}${rangeSql(stageDate)}
        )
      )`,
      `${legacyBaseDate} is not null
       and ${asOfOnOrBeforeSql(legacyBaseDate) ?? "true"}
       and ${asOfMissingOrAfterSql("f.payment_date") ?? `not ${hasTextSql("f.payment_date")}`}
       and ${monthMatchesSql(legacyDate, monthPlaceholder)}${rangeSql(legacyDate)}`,
    )}`;
  }

  if (parsed.mode === "expectedReceiptThrough") {
    const stageRowsExist = `${isYesSql("so.stage_delivery")} and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0`;
    const childBaseDate = orderReportBaseDate;
    const legacyBaseDate = legacyReportBaseDate;
    const childDate = `(${childBaseDate} + ${offsetInterval})::date`;
    const legacyDate = `(${legacyBaseDate} + ${offsetInterval})::date`;
    const stageDate = `(${stageReportBaseDate} + ${offsetInterval})::date`;
    const throughDate =
      parsed.toDate ??
      parsed.asOfDate ??
      (parsed.monthKey === "all" ? undefined : getMonthEndDateFromMonthKey(parsed.monthKey));
    if (!throughDate) return "false";
    const monthEndPlaceholder = addSqlValue(values, throughDate);
    const throughSql = (dateExpression: string) =>
      `${dateExpression} <= ${monthEndPlaceholder}::date${rangeSql(dateExpression)}`;
    return `${monthPlaceholder}::text is not null and ${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")}
       and not ${isYesSql("so.no_further_action")} and (
        (
          not (${stageRowsExist})
          and
          ${childBaseDate} is not null
          and ${asOfOnOrBeforeSql(childBaseDate) ?? "true"}
          and ${asOfMissingOrAfterSql("so.payment_date") ?? `not ${hasTextSql("so.payment_date")}`}
          and ${throughSql(childDate)}
        )
        or exists (
          select 1
          from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) with ordinality as stage_row(stage, ordinality)
          where ${isYesSql("so.stage_delivery")}
            and ${stageDate} is not null
            and ${asOfOnOrBeforeSql(stageDate) ?? "true"}
            and ${asOfMissingOrAfterSql(stagePaymentDate) ?? `${stagePaymentDate} is null`}
            and ${throughSql(stageDate)}
        )
      )`,
      `${legacyBaseDate} is not null
       and ${asOfOnOrBeforeSql(legacyBaseDate) ?? "true"}
       and ${asOfMissingOrAfterSql("f.payment_date") ?? `not ${hasTextSql("f.payment_date")}`}
       and ${throughSql(legacyDate)}`,
    )}`;
  }

  if (
    parsed.mode === "expectedReceiptPendingBill" ||
    parsed.mode === "expectedReceiptPendingBillThrough"
  ) {
    const through = parsed.mode === "expectedReceiptPendingBillThrough";
    const stageRowsExist = `${isYesSql("so.stage_delivery")} and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0`;
    const childBaseDate = orderReportBaseDate;
    const legacyBaseDate = legacyReportBaseDate;
    const childDate = `(${childBaseDate} + ${offsetInterval})::date`;
    const legacyDate = `(${legacyBaseDate} + ${offsetInterval})::date`;
    const stageDate = `(${stageReportBaseDate} + ${offsetInterval})::date`;
    return `${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")}
       and not ${isYesSql("so.no_further_action")} and (
        (
          not (${stageRowsExist})
          and
          ${childBaseDate} is not null
          and ${toDateOnOrBeforeSql(childBaseDate) ?? "true"}
          and ${toDateMissingOrAfterSql("so.bill_preparation_date") ?? `not ${hasTextSql("so.bill_preparation_date")}`}
          and ${toDateMissingOrAfterSql("so.payment_date") ?? `not ${hasTextSql("so.payment_date")}`}
          and ${dateScopeSql(childDate, through)}
        )
        or ${stagePaymentRowExists(
          `${stageReportBaseDate} is not null
            and ${toDateOnOrBeforeSql(stageReportBaseDate) ?? "true"}
            and ${toDateMissingOrAfterSql(stageBillPreparationDate) ?? `${stageBillPreparationDate} is null`}
            and ${toDateMissingOrAfterSql(stagePaymentDate) ?? `${stagePaymentDate} is null`}
            and ${dateScopeSql(stageDate, through)}`,
        )}
      )`,
      `${legacyBaseDate} is not null
       and not ${isYesSql("f.so_cancelled")}
       and ${toDateOnOrBeforeSql(legacyBaseDate) ?? "true"}
       and ${toDateMissingOrAfterSql("f.bill_preparation_date") ?? `not ${hasTextSql("f.bill_preparation_date")}`}
       and ${toDateMissingOrAfterSql("f.payment_date") ?? `not ${hasTextSql("f.payment_date")}`}
       and ${dateScopeSql(legacyDate, through)}`,
    )}`;
  }

  if (parsed.mode === "billPreparation" || parsed.mode === "billPreparationThrough") {
    const through = parsed.mode === "billPreparationThrough";
    const childBaseDate = orderReportBaseDate;
    const legacyBaseDate = legacyReportBaseDate;
    const supplementaryCycles = `coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)`;
    const supplementaryPendingReturnedDate = `case
      when ${latestBillReturnStateSql(supplementaryCycles, "open")}
      then nullif((${latestBillReturnCycleSql(supplementaryCycles)}) ->> 'returnedDate', '')::date end`;
    const supplementaryPaymentDate = `nullif(supplementary_bill.bill ->> 'paymentDate', '')::date`;
    return `${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")}
       and not ${isYesSql("so.no_further_action")} and (
        (
          ${childBaseDate} is not null
          and ${hasTextSql("so.bill_preparation_date")}
          and ${toDateOnOrBeforeSql(childBaseDate) ?? "true"}
          and ${toDateOnOrBeforeSql("so.bill_preparation_date") ?? "true"}
          and (${toDateMissingOrAfterSql("so.bill_sent_for_payment_date") ?? `not ${hasTextSql("so.bill_sent_for_payment_date")}`} or ${openBillReturnSql("so.bill_return_cycles")})
          and ${toDateMissingOrAfterSql("so.payment_date") ?? `not ${hasTextSql("so.payment_date")}`}
          and ${dateScopeSql("so.bill_preparation_date", through)}
        )
        or ${stagePaymentRowExists(
          `${stageReportBaseDate} is not null
            and ${stageBillPreparationDate} is not null
            and ${toDateOnOrBeforeSql(stageReportBaseDate) ?? "true"}
            and ${toDateOnOrBeforeSql(stageBillPreparationDate) ?? "true"}
            and (${toDateMissingOrAfterSql(stageBillSentForPaymentDate) ?? `${stageBillSentForPaymentDate} is null`} or ${openBillReturnSql("stage_row.stage -> 'billReturnCycles'")})
            and ${toDateMissingOrAfterSql(stagePaymentDate) ?? `${stagePaymentDate} is null`}
            and ${dateScopeSql(stageBillPreparationDate, through)}`,
        )}
	        or (
	          ${isYesSql("so.advance_payment")}
	          and ${advanceBillPreparationDate} is not null
	          and ${toDateOnOrBeforeSql(advanceBillPreparationDate) ?? "true"}
	          and (${toDateMissingOrAfterSql(advanceBillSentForPaymentDate) ?? `${advanceBillSentForPaymentDate} is null`} or ${openBillReturnSql("so.advance_payment_detail -> 'billReturnCycles'")})
	          and ${toDateMissingOrAfterSql(advancePaymentDate) ?? `${advancePaymentDate} is null`}
	          and ${dateScopeSql(advanceBillPreparationDate, through)}
		        )
        or exists (
          select 1
          from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
          where ${supplementaryPendingReturnedDate} is not null
            and ${toDateMissingOrAfterSql(supplementaryPaymentDate) ?? `${supplementaryPaymentDate} is null`}
            and ${dateScopeSql(supplementaryPendingReturnedDate, through)}
        )
		      )`,
      `${legacyBaseDate} is not null
       and not ${isYesSql("f.so_cancelled")}
       and ${hasTextSql("f.bill_preparation_date")}
       and ${toDateOnOrBeforeSql(legacyBaseDate) ?? "true"}
       and ${toDateOnOrBeforeSql("f.bill_preparation_date") ?? "true"}
       and ${toDateMissingOrAfterSql("f.bill_sent_for_payment_date") ?? `not ${hasTextSql("f.bill_sent_for_payment_date")}`}
       and ${toDateMissingOrAfterSql("f.payment_date") ?? `not ${hasTextSql("f.payment_date")}`}
       and ${dateScopeSql("f.bill_preparation_date", through)}`,
    )}`;
  }

  if (parsed.mode === "billSent" || parsed.mode === "billSentThrough") {
    const through = parsed.mode === "billSentThrough";
    const childBaseDate = orderReportBaseDate;
    const legacyBaseDate = legacyReportBaseDate;
    const supplementaryCycles = `coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)`;
    const supplementarySubmittedDate = `coalesce(
      (select max(nullif(cycle ->> 'resubmittedDate', '')::date)
       from jsonb_array_elements(${supplementaryCycles}) as cycle
       where coalesce(cycle ->> 'resubmittedDate', '') <> ''),
      nullif(supplementary_bill.bill ->> 'billSentForPaymentDate', '')::date
    )`;
    const supplementaryPaymentDate = `nullif(supplementary_bill.bill ->> 'paymentDate', '')::date`;
    const supplementaryOpenReturn = `exists (
      select 1 from jsonb_array_elements(${supplementaryCycles}) as cycle
      where coalesce(cycle ->> 'returnedDate', '') <> ''
        and coalesce(cycle ->> 'resubmittedDate', '') = ''
    )`;
    return `${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")}
       and not ${isYesSql("so.no_further_action")} and (
        (
          ${childBaseDate} is not null
          and ${hasTextSql("so.bill_preparation_date")}
          and ${hasTextSql("so.bill_sent_for_payment_date")}
          and ${toDateOnOrBeforeSql(childBaseDate) ?? "true"}
          and ${toDateOnOrBeforeSql("so.bill_preparation_date") ?? "true"}
          and ${toDateOnOrBeforeSql("so.bill_sent_for_payment_date") ?? "true"}
          and not ${openBillReturnSql("so.bill_return_cycles")}
          and ${toDateMissingOrAfterSql("so.payment_date") ?? `not ${hasTextSql("so.payment_date")}`}
          and ${dateScopeSql("so.bill_sent_for_payment_date", through)}
        )
        or ${stagePaymentRowExists(
          `${stageReportBaseDate} is not null
            and ${stageBillPreparationDate} is not null
            and ${stageBillSentForPaymentDate} is not null
            and ${toDateOnOrBeforeSql(stageReportBaseDate) ?? "true"}
            and ${toDateOnOrBeforeSql(stageBillPreparationDate) ?? "true"}
            and ${toDateOnOrBeforeSql(stageBillSentForPaymentDate) ?? "true"}
            and not ${openBillReturnSql("stage_row.stage -> 'billReturnCycles'")}
            and ${toDateMissingOrAfterSql(stagePaymentDate) ?? `${stagePaymentDate} is null`}
            and ${dateScopeSql(stageBillSentForPaymentDate, through)}`,
        )}
	        or (
	          ${isYesSql("so.advance_payment")}
	          and ${advanceBillPreparationDate} is not null
	          and ${advanceBillSentForPaymentDate} is not null
          and ${toDateOnOrBeforeSql(advanceBillPreparationDate) ?? "true"}
          and ${toDateOnOrBeforeSql(advanceBillSentForPaymentDate) ?? "true"}
	          and not ${openBillReturnSql("so.advance_payment_detail -> 'billReturnCycles'")}
	          and ${toDateMissingOrAfterSql(advancePaymentDate) ?? `${advancePaymentDate} is null`}
	          and ${dateScopeSql(advanceBillSentForPaymentDate, through)}
		        )
        or exists (
          select 1
          from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
          where ${supplementarySubmittedDate} is not null
            and not ${supplementaryOpenReturn}
            and ${toDateOnOrBeforeSql(supplementarySubmittedDate) ?? "true"}
            and ${toDateMissingOrAfterSql(supplementaryPaymentDate) ?? `${supplementaryPaymentDate} is null`}
            and ${dateScopeSql(supplementarySubmittedDate, through)}
        )
		      )`,
      `${legacyBaseDate} is not null
       and not ${isYesSql("f.so_cancelled")}
       and ${hasTextSql("f.bill_preparation_date")}
       and ${hasTextSql("f.bill_sent_for_payment_date")}
       and ${toDateOnOrBeforeSql(legacyBaseDate) ?? "true"}
       and ${toDateOnOrBeforeSql("f.bill_preparation_date") ?? "true"}
       and ${toDateOnOrBeforeSql("f.bill_sent_for_payment_date") ?? "true"}
       and ${toDateMissingOrAfterSql("f.payment_date") ?? `not ${hasTextSql("f.payment_date")}`}
       and ${dateScopeSql("f.bill_sent_for_payment_date", through)}`,
    )}`;
  }

  if (parsed.mode === "supplementaryBillSent") {
    const cycles = `coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)`;
    const submittedDate = `coalesce(
      (select max(nullif(cycle ->> 'resubmittedDate', '')::date)
       from jsonb_array_elements(${cycles}) as cycle
       where coalesce(cycle ->> 'resubmittedDate', '') <> ''),
      nullif(supplementary_bill.bill ->> 'billSentForPaymentDate', '')::date
    )`;
    const paymentDate = `nullif(supplementary_bill.bill ->> 'paymentDate', '')::date`;
    const hasOpenReturned = `exists (
      select 1 from jsonb_array_elements(${cycles}) as cycle
      where coalesce(cycle ->> 'returnedDate', '') <> ''
        and coalesce(cycle ->> 'resubmittedDate', '') = ''
    )`;
    return `${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")}
       and not ${isYesSql("so.no_further_action")}
       and exists (
         select 1
         from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
         where ${submittedDate} is not null
           and not ${hasOpenReturned}
           and ${toDateOnOrBeforeSql(submittedDate) ?? "true"}
           and ${toDateMissingOrAfterSql(paymentDate) ?? `${paymentDate} is null`}
           and ${dateScopeSql(submittedDate)}
       )`,
      "false",
    )}`;
  }

  if (parsed.mode === "supplementaryActual") {
    const paymentDate = `nullif(supplementary_bill.bill ->> 'paymentDate', '')::date`;
    return `${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")}
       and exists (
         select 1
         from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
         where ${paymentDate} is not null
           and ${dateScopeSql(paymentDate)}
       )`,
      "false",
    )}`;
  }

  if (
    parsed.mode === "returnedBills" ||
    parsed.mode === "pendingReturnedBills" ||
    parsed.mode === "returnedBillsResubmitted" ||
    parsed.mode === "returnedBillsPaid"
  ) {
    const childDate = billReturnDateSql("so.bill_return_cycles", parsed.mode, "so.payment_date");
    const childState = billReturnStateSql("so.bill_return_cycles", parsed.mode, "so.payment_date");
    const stageCycles = `stage_row.stage -> 'billReturnCycles'`;
    const stageDate = billReturnDateSql(stageCycles, parsed.mode, stagePaymentDate);
    const stageState = billReturnStateSql(stageCycles, parsed.mode, stagePaymentDate);
    const advanceCycles = `so.advance_payment_detail -> 'billReturnCycles'`;
    const advanceDate = billReturnDateSql(advanceCycles, parsed.mode, advancePaymentDate);
    const advanceState = billReturnStateSql(advanceCycles, parsed.mode, advancePaymentDate);
    return `${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")}
       and ${parsed.mode === "returnedBills" || parsed.mode === "returnedBillsPaid" ? "true" : `not ${isYesSql("so.no_further_action")}`}
       and (
        (
          ${childState}
          and ${monthMatchesSql(childDate, monthPlaceholder)}${rangeSql(childDate)}
        )
        or ${stagePaymentRowExists(
          `${stageState}
            and ${monthMatchesSql(stageDate, monthPlaceholder)}${rangeSql(stageDate)}`,
        )}
        or (
          ${isYesSql("so.advance_payment")}
	          and ${advanceState}
	          and ${monthMatchesSql(advanceDate, monthPlaceholder)}${rangeSql(advanceDate)}
		        )
		      )`,
      "false",
    )}`;
  }

  if (
    parsed.mode === "supplementaryReturnedBills" ||
    parsed.mode === "supplementaryPendingReturnedBills" ||
    parsed.mode === "supplementaryReturnedBillsResubmitted" ||
    parsed.mode === "supplementaryReturnedBillsPaid"
  ) {
    const cycles = `coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)`;
    const paymentDate = `nullif(supplementary_bill.bill ->> 'paymentDate', '')::date`;
    const latestCycle = latestBillReturnCycleSql(cycles);
    const returnedDate = `nullif((${latestCycle}) ->> 'returnedDate', '')::date`;
    const pendingReturnedDate = `case when ${latestBillReturnStateSql(cycles, "open")}
      then ${returnedDate} end`;
    const resubmittedDate = `case when ${latestBillReturnStateSql(cycles, "resubmitted")}
      then nullif((${latestCycle}) ->> 'resubmittedDate', '')::date end`;
    const hasReturned = `exists (select 1 from (${latestCycle}) as latest(cycle))`;
    const hasOpenReturned = latestBillReturnStateSql(cycles, "open");
    const hasResubmitted = latestBillReturnStateSql(cycles, "resubmitted");
    const date =
      parsed.mode === "supplementaryReturnedBillsPaid"
        ? paymentDate
        : parsed.mode === "supplementaryReturnedBillsResubmitted"
          ? resubmittedDate
          : parsed.mode === "supplementaryPendingReturnedBills"
            ? pendingReturnedDate
            : returnedDate;
    const state =
      parsed.mode === "supplementaryReturnedBillsPaid"
        ? `${paymentDate} is not null and ${hasReturned}`
        : parsed.mode === "supplementaryReturnedBillsResubmitted"
          ? `${hasResubmitted} and ${paymentDate} is null`
          : parsed.mode === "supplementaryPendingReturnedBills"
            ? `${hasOpenReturned} and ${paymentDate} is null`
            : hasReturned;
    return `${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")}
       and ${parsed.mode === "supplementaryReturnedBillsPaid" ? "true" : `not ${isYesSql("so.no_further_action")}`}
       and exists (
         select 1
         from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
         where ${state}
           and ${date} is not null
           and ${dateScopeSql(date)}
       )`,
      "false",
    )}`;
  }

  return `${activeFile} and ${supplyOrderChildSql(
    `not (${isYesSql("so.so_cancelled")} and ${hasTextSql("so.so_cancelled_date")}) and (
      (
        ${hasTextSql("so.payment_date")}
        and ${monthMatchesSql("so.payment_date", monthPlaceholder)}${rangeSql("so.payment_date")}
      )
      or ${stagePaymentRowExists(
        `${stagePaymentDate} is not null
          and ${monthMatchesSql(stagePaymentDate, monthPlaceholder)}${rangeSql(stagePaymentDate)}`,
      )}
	      or (
	        ${isYesSql("so.advance_payment")}
	        and ${advancePaymentDate} is not null
	        and ${monthMatchesSql(advancePaymentDate, monthPlaceholder)}${rangeSql(advancePaymentDate)}
		      )
      or exists (
        select 1
        from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
        where nullif(supplementary_bill.bill ->> 'paymentDate', '')::date is not null
          and ${monthMatchesSql("nullif(supplementary_bill.bill ->> 'paymentDate', '')::date", monthPlaceholder)}${rangeSql("nullif(supplementary_bill.bill ->> 'paymentDate', '')::date")}
      )
		    )`,
    `${hasTextSql("f.payment_date")}
     and not (${isYesSql("f.so_cancelled")} and ${hasTextSql("f.so_cancelled_date")})
     and ${monthMatchesSql("f.payment_date", monthPlaceholder)}${rangeSql("f.payment_date")}`,
  )}`;
}

function cashOutgoAnyFilterSql(filter: string, values: unknown[]) {
  const [, rawModes, rawMonthKey, rawOffsetDays, rawFromDate, rawToDate, rawAsOfDate] =
    filter.split(":");
  const modes = (rawModes ?? "")
    .split(",")
    .map((mode) => decodeStatusFilterPart(mode).trim())
    .filter(Boolean);
  if (!modes.length) return "false";

  const filters = modes.map((mode) =>
    [
      "cashOutgo",
      mode,
      rawMonthKey ?? "",
      rawOffsetDays ?? "0",
      rawFromDate ?? "",
      rawToDate ?? "",
      rawAsOfDate ?? "",
    ].join(":"),
  );
  const clauses = filters.map((item) =>
    item.startsWith("cashOutgo:actualThrough:")
      ? actualThroughCashOutgoFilterSql(item, values)
      : cashOutgoFilterSql(item, values),
  );
  return clauses.length ? `(${clauses.join(" or ")})` : "false";
}

function stagePaymentDateSql(stageAlias = "stage_row") {
  return `case
      when ${isYesSql("so.stage_payment")} then nullif(${stageAlias}.stage ->> 'paymentDate', '')::date
      when not ${isYesSql("so.stage_payment")} and ${stageAlias}.ordinality = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) then so.payment_date
      else null::date
    end`;
}

function actualThroughCashOutgoFilterSql(filter: string, values: unknown[]) {
  const [, mode, rawMonthKey, _rawOffsetDays, rawFromDate, rawToDate, rawAsOfDate] =
    filter.split(":");
  if (mode !== "actualThrough") return "false";
  const monthKey = decodeStatusFilterPart(rawMonthKey);
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return "false";
  const fromDate = decodeStatusFilterPart(rawFromDate);
  const toDate = decodeStatusFilterPart(rawToDate);
  const asOfDate = decodeStatusFilterPart(rawAsOfDate);
  if (
    (fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) ||
    (toDate && !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) ||
    (asOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate))
  ) {
    return "false";
  }

  const monthEndPlaceholder = addSqlValue(values, getMonthEndDateFromMonthKey(monthKey));
  const fromDatePlaceholder = fromDate ? addSqlValue(values, fromDate) : undefined;
  const toDatePlaceholder = addSqlValue(
    values,
    toDate || asOfDate || getMonthEndDateFromMonthKey(monthKey),
  );
  const rangeSql = (dateExpression: string) =>
    ` and ${dateExpression} <= ${toDatePlaceholder}::date${
      fromDatePlaceholder ? ` and ${dateExpression} >= ${fromDatePlaceholder}::date` : ""
    }`;
  const stagePaymentDate = stagePaymentDateSql();
  const advancePaymentDate = `nullif(so.advance_payment_detail ->> 'paymentDate', '')::date`;
  const supplementaryPaymentDate = `nullif(supplementary_bill.bill ->> 'paymentDate', '')::date`;

  return `not ${isCancelledFileSql()} and ${supplyOrderChildSql(
    `not (${isYesSql("so.so_cancelled")} and ${hasTextSql("so.so_cancelled_date")}) and (
      (
        ${hasTextSql("so.payment_date")}
        and so.payment_date <= ${monthEndPlaceholder}::date
        ${rangeSql("so.payment_date")}
      )
      or exists (
        select 1
        from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) with ordinality as stage_row(stage, ordinality)
        where ${isYesSql("so.stage_delivery")}
          and ${stagePaymentDate} is not null
          and ${stagePaymentDate} <= ${monthEndPlaceholder}::date
          ${rangeSql(stagePaymentDate)}
      )
      or (
        ${isYesSql("so.advance_payment")}
        and ${advancePaymentDate} is not null
        and ${advancePaymentDate} <= ${monthEndPlaceholder}::date
        ${rangeSql(advancePaymentDate)}
      )
      or exists (
        select 1
        from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
        where ${supplementaryPaymentDate} is not null
          and ${supplementaryPaymentDate} <= ${monthEndPlaceholder}::date
          ${rangeSql(supplementaryPaymentDate)}
      )
    )`,
    `${hasTextSql("f.payment_date")}
     and f.payment_date <= ${monthEndPlaceholder}::date
     and not (${isYesSql("f.so_cancelled")} and ${hasTextSql("f.so_cancelled_date")})
     ${rangeSql("f.payment_date")}`,
  )}`;
}

function getMonthEndDateFromMonthKey(monthKey: string) {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number.parseInt(yearText ?? "", 10);
  const month = Number.parseInt(monthText ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return `${monthKey}-31`;
  }
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function stageJobCompletionDoneSql(stageAlias = "delivery_period_stage") {
  return `coalesce(${stageAlias}.stage ->> 'jobCompletionDate', '') <> ''`;
}

function deliveryPeriodBucketSql(kind: "valid" | "expired" | "extended") {
  const orderDpDate = effectiveDpDateSql("so");
  const stageRowsExist = `${isYesSql("so.stage_delivery")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0`;
  const stageDpDate = `coalesce(
    nullif(delivery_period_stage.stage ->> 'revisedDp', '')::date,
    nullif(delivery_period_stage.stage ->> 'dpDate', '')::date
  )`;
  const previousStageDpDate = `coalesce(
    nullif((so.stage_deliveries -> ((delivery_period_stage.ordinality - 2)::integer)) ->> 'revisedDp', '')::date,
    nullif((so.stage_deliveries -> ((delivery_period_stage.ordinality - 2)::integer)) ->> 'dpDate', '')::date
  )`;
  const stageStartDate = `coalesce(
    nullif(delivery_period_stage.stage ->> 'deliveryPeriodStartDate', '')::date,
    case
      when delivery_period_stage.ordinality = 1 then so.so_date
      else ${previousStageDpDate} + 1
    end,
    so.so_date
  )`;
  const orderIsExtended = `(${isYesSql("so.dp_extension")} or ${hasTextSql("so.revised_dp")})`;
  const stageIsExtended = `(${isYesSql("delivery_period_stage.stage ->> 'dpExtension'")} or coalesce(delivery_period_stage.stage ->> 'revisedDp', '') <> '')`;
  const dateCondition =
    kind === "valid"
      ? `not ${orderIsExtended} and ${orderDpDate} >= current_date`
      : kind === "expired"
        ? `${orderDpDate} < current_date`
        : `${orderIsExtended} and ${orderDpDate} >= current_date`;
  const stageDateCondition =
    kind === "valid"
      ? `not ${stageIsExtended} and ${stageDpDate} >= current_date`
      : kind === "expired"
        ? `${stageDpDate} < current_date`
        : `${stageIsExtended} and ${stageDpDate} >= current_date`;
  const orderIncomplete = `((${deliveryInspectionApplicableSql()} and not ${hasTextSql(
    "so.material_receipt_date",
  )}) or (not (${deliveryInspectionApplicableSql()}) and not ${completedOrderMilestoneSql(
    "so",
    "jobcompletion",
  )}))`;
  const stageIncomplete = `((${deliveryInspectionApplicableSql()} and coalesce(delivery_period_stage.stage ->> 'materialReceiptDate', '') = '')
    or (not (${deliveryInspectionApplicableSql()}) and not ${stageJobCompletionDoneSql()}))`;
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `${hasTextSql("so.so_date")} and not ${isYesSql("so.so_cancelled")} and not ${isYesSql("so.shortclosure")}
     and not ${isYesSql("so.no_further_action")} and (
      (
        not (${stageRowsExist})
        and
        ${orderDpDate} is not null
        and so.so_date <= current_date
        and ${dateCondition}
        and ${orderIncomplete}
      )
      or exists (
        select 1
        from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) with ordinality as delivery_period_stage(stage, ordinality)
        where ${isYesSql("so.stage_delivery")}
          and ${stageDpDate} is not null
          and ${stageStartDate} <= current_date
          and ${stageDateCondition}
          and ${stageIncomplete}
      )
    )`,
  )}`;
}

function status2DpPendingSql() {
  const normalizedCurrentMilestone = normalizedSql("so.current_milestone");
  const stageCurrentMilestone = normalizedSql("dp_stage.stage ->> 'currentMilestone'");
  const stageDpDate = `coalesce(
    nullif(dp_stage.stage ->> 'revisedDp', '')::date,
    nullif(dp_stage.stage ->> 'dpDate', '')::date,
    so.revised_dp,
    so.dp_date
  )`;
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `${hasTextSql("so.so_date")}
     and not ${isYesSql("so.so_cancelled")}
     and not ${isYesSql("so.shortclosure")}
     and not ${isYesSql("so.no_further_action")}
     and (
       (
         not ${isYesSql("so.stage_delivery")}
         and ${effectiveDpDateSql("so")} is null
         and ${normalizedCurrentMilestone} = 'deliveryperiod'
       )
       or (
         ${isYesSql("so.stage_delivery")}
         and exists (
           select 1
           from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as dp_stage(stage)
           where ${stageDpDate} is null
             and regexp_replace(${stageCurrentMilestone}, '[0-9]+$', '') = 'deliveryperiod'
         )
       )
     )`,
  )}`;
}

function status2MaterialReceiptPendingSql() {
  return status2DeliveryPendingSql(false);
}

function status2DpExpiredSql() {
  return status2DeliveryPendingSql(true);
}

function status2DeliveryPendingSql(expired: boolean) {
  const physicalDelivery = deliveryInspectionApplicableSql();
  const goodsServicesJob = `(not ${contractFileTypeSql("f")} and ${isNoSql("f.ir")})`;
  const applicable = expired ? `(${physicalDelivery} or ${goodsServicesJob})` : physicalDelivery;
  const orderIncomplete = expired
    ? `((${physicalDelivery} and not ${hasTextSql("so.material_receipt_date")}
      )
      or (${goodsServicesJob} and not ${hasTextSql("so.job_completion_date")}
        and not ${completedOrderMilestoneSql("so", "jobcompletion")}))`
    : `not ${hasTextSql("so.material_receipt_date")}`;
  const orderDpDate = effectiveDpDateSql("so");
  const stageDpDate = expired ? `coalesce(
    nullif(coalesce(delivery_period_stage.stage ->> 'revisedDp', so.revised_dp::text), '')::date,
    nullif(coalesce(delivery_period_stage.stage ->> 'dpDate', so.dp_date::text), '')::date
  )` : `coalesce(
    nullif(delivery_period_stage.stage ->> 'revisedDp', '')::date,
    nullif(delivery_period_stage.stage ->> 'dpDate', '')::date,
    so.revised_dp,
    so.dp_date
  )`;
  const stageReceiptDate = expired
    ? `coalesce(delivery_period_stage.stage ->> 'materialReceiptDate', so.material_receipt_date::text, '')`
    : `coalesce(delivery_period_stage.stage ->> 'materialReceiptDate', '')`;
  const stageJobCompletionDate = `coalesce(delivery_period_stage.stage ->> 'jobCompletionDate', so.job_completion_date::text, '')`;
  const stageIncomplete = expired
    ? `((${physicalDelivery} and ${stageReceiptDate} = '')
      or (${goodsServicesJob} and ${stageJobCompletionDate} = '' and not exists (
          select 1 from jsonb_array_elements_text(coalesce(delivery_period_stage.stage -> 'completedMilestones', '[]'::jsonb)) as completed_stage(milestone)
          where ${normalizedSql("completed_stage.milestone")} = 'jobcompletion'
        )))`
    : `${stageReceiptDate} = ''`;
  const stageStartDate = `coalesce(
    nullif(delivery_period_stage.stage ->> 'deliveryPeriodStartDate', '')::date,
    so.so_date
  )`;
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `${hasTextSql("so.so_date")}
     and not ${isYesSql("so.so_cancelled")}
     and not ${isYesSql("so.shortclosure")}
     and not ${isYesSql("so.no_further_action")}
     and ${applicable}
     and (
       (
         ${expired ? `(not ${isYesSql("so.stage_delivery")}
           or jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) = 0)` : `not ${isYesSql("so.stage_delivery")}`}
         and ${orderDpDate} is not null
         and so.so_date <= current_date
         and ${orderDpDate} ${expired ? "<" : ">="} current_date
         and ${orderIncomplete}
       )
       or exists (
         select 1
         from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as delivery_period_stage(stage)
         where ${isYesSql("so.stage_delivery")}
           and ${stageDpDate} is not null
           and ${stageStartDate} <= current_date
           and ${stageDpDate} ${expired ? "<" : ">="} current_date
           and ${stageIncomplete}
       )
     )`,
  )}`;
}

function inrAmountExpression(column: string) {
  return `case
    when ${column} is null then null
    when upper(trim(coalesce(f.currency, 'INR'))) in ('', 'INR') then ${column}
    when f.exchange_rate > 0 then ${column} * f.exchange_rate
    else null
  end`;
}

function valueThresholdMatchSql(alias: string, amount: string, valueType: string) {
  return `(${amount} is not null
    and ${amount} > 0
    and (${alias}.applies_to = 'both' or ${alias}.applies_to = ${valueType})
    and (${alias}.min_value is null or ${amount} >= ${alias}.min_value)
    and (${alias}.max_value is null or ${amount} <= ${alias}.max_value))`;
}

function valueThresholdFinancialYearSql(values: unknown[], financialYear: string | undefined) {
  void financialYear;
  return addSqlValue(values, "__global__");
}

type ValueThresholdDashboardMetric = "capital" | "revenue" | "total";

function parseValueThresholdDashboardFilter(filter: string, prefix: string) {
  const rawPayload = filter.slice(prefix.length);
  const parts = rawPayload.split(":");
  const rawMetric = parts.length > 1 ? decodeFilterPart(parts[parts.length - 1]) : "";
  const metric =
    rawMetric === "capital" || rawMetric === "revenue" || rawMetric === "total"
      ? (rawMetric as ValueThresholdDashboardMetric)
      : undefined;
  if (metric) parts.pop();
  return {
    label: decodeURIComponent(parts.join(":")).trim(),
    metric,
  };
}

function valueThresholdFilterSql(
  filter: string,
  values: unknown[],
  thresholdFinancialYear: string | undefined,
) {
  const { label, metric } = parseValueThresholdDashboardFilter(filter, "valueThreshold:");
  if (!label) return "true";
  const financialYearSql = valueThresholdFinancialYearSql(values, thresholdFinancialYear);
  const capital = inrAmountExpression("f.value_capital");
  const revenue = inrAmountExpression("f.value_revenue");
  const valueType = `case when ${capital} > 0 then 'capital' when ${revenue} > 0 then 'revenue' end`;
  const amount = `case when ${capital} > 0 then ${capital} when ${revenue} > 0 then ${revenue} else 0 end`;
  const levelMatch = valueThresholdMatchSql("v", amount, valueType);
  const metricCondition =
    metric === "capital" || metric === "revenue"
      ? `${valueType} = ${addSqlValue(values, metric)}`
      : undefined;

  if (label.toLowerCase() === "unmatched") {
    return [
      `${amount} > 0`,
      metricCondition,
      `not exists (
      select 1 from value_threshold_levels v
      where v.financial_year = ${financialYearSql}
        and ${levelMatch}
      )`,
    ]
      .filter((condition): condition is string => Boolean(condition))
      .join(" and ");
  }

  const labelPlaceholder = addSqlValue(values, label.toLowerCase());
  const priorMatch = valueThresholdMatchSql("previous_v", amount, valueType);
  return [
    metricCondition,
    `exists (
    select 1 from value_threshold_levels v
    where v.financial_year = ${financialYearSql}
      and lower(trim(v.label)) = ${labelPlaceholder}
      and ${levelMatch}
      and not exists (
        select 1 from value_threshold_levels previous_v
        where previous_v.financial_year = v.financial_year
          and previous_v.level_number < v.level_number
          and ${priorMatch}
      )
    )`,
  ]
    .filter((condition): condition is string => Boolean(condition))
    .join(" and ");
}

function valueThresholdIdFilterSql(
  filter: string,
  values: unknown[],
  thresholdFinancialYear: string | undefined,
) {
  const rawId = filter.slice("valueThresholdId:".length);
  const id = decodeURIComponent(rawId).trim();
  if (!id) return "true";
  const financialYearSql = valueThresholdFinancialYearSql(values, thresholdFinancialYear);
  const capital = inrAmountExpression("f.value_capital");
  const revenue = inrAmountExpression("f.value_revenue");
  const valueType = `case when ${capital} > 0 then 'capital' when ${revenue} > 0 then 'revenue' end`;
  const amount = `case when ${capital} > 0 then ${capital} when ${revenue} > 0 then ${revenue} else 0 end`;
  const idPlaceholder = addSqlValue(values, id);
  const levelMatch = valueThresholdMatchSql("v", amount, valueType);
  const priorMatch = valueThresholdMatchSql("previous_v", amount, valueType);
  return `exists (
    select 1 from value_threshold_levels v
    where v.financial_year = ${financialYearSql}
      and v.id::text = ${idPlaceholder}
      and ${levelMatch}
      and not exists (
        select 1 from value_threshold_levels previous_v
        where previous_v.financial_year = v.financial_year
          and previous_v.level_number < v.level_number
          and ${priorMatch}
      )
  )`;
}

function valueThresholdRangeFilterSql(filter: string, values: unknown[]) {
  const [, rawMin = "", rawMax = "", rawAppliesTo = "both"] = filter.split(":");
  const minValue = parseSearchAmount(decodeURIComponent(rawMin));
  const maxValue = parseSearchAmount(decodeURIComponent(rawMax));
  const appliesTo = decodeURIComponent(rawAppliesTo);
  const capital = inrAmountExpression("f.value_capital");
  const revenue = inrAmountExpression("f.value_revenue");
  const valueType = `case when ${capital} > 0 then 'capital' when ${revenue} > 0 then 'revenue' end`;
  const amount = `case when ${capital} > 0 then ${capital} when ${revenue} > 0 then ${revenue} else 0 end`;
  const conditions = [`${amount} > 0`];
  if (appliesTo === "capital" || appliesTo === "revenue") {
    conditions.push(`${valueType} = ${addSqlValue(values, appliesTo)}`);
  }
  if (minValue !== undefined) conditions.push(`${amount} >= ${addSqlValue(values, minValue)}`);
  if (maxValue !== undefined) conditions.push(`${amount} <= ${addSqlValue(values, maxValue)}`);
  return conditions.join(" and ");
}

function soValueThresholdRangeFilterSql(
  filter: string,
  values: unknown[],
  capitalOnly: boolean,
  revenueOnly: boolean,
) {
  const [, rawMin = "", rawMax = "", rawAppliesTo = "both"] = filter.split(":");
  const minValue = parseSearchAmount(decodeURIComponent(rawMin));
  const maxValue = parseSearchAmount(decodeURIComponent(rawMax));
  const appliesTo = decodeURIComponent(rawAppliesTo);
  const useCapitalOnly = appliesTo === "capital" || (appliesTo !== "revenue" && capitalOnly);
  const useRevenueOnly = appliesTo === "revenue" || (appliesTo !== "capital" && revenueOnly);
  const includeCapital = !useRevenueOnly || useCapitalOnly;
  const includeRevenue = !useCapitalOnly || useRevenueOnly;
  const capital = inrAmountExpression("so.so_value_capital");
  const revenue = inrAmountExpression("so.so_value_revenue");
  const amountParts = [
    includeCapital ? capital : undefined,
    includeRevenue ? revenue : undefined,
  ].filter((part): part is string => Boolean(part));
  const amount = amountParts.length ? `(${amountParts.join(" + ")})` : "0";
  const conditions = [`${amount} > 0`];
  if (minValue !== undefined) conditions.push(`${amount} >= ${addSqlValue(values, minValue)}`);
  if (maxValue !== undefined) conditions.push(`${amount} <= ${addSqlValue(values, maxValue)}`);
  return supplyOrderExists(conditions.join(" and "));
}

function valueThresholdTotalFilterSql(filter: string) {
  const [, rawMetric = "total"] = filter.split(":");
  const metric = decodeFilterPart(rawMetric);
  const capital = inrAmountExpression("f.value_capital");
  const revenue = inrAmountExpression("f.value_revenue");
  if (metric === "capital") return `${capital} > 0`;
  if (metric === "revenue") return `${revenue} > 0`;
  return `(${capital} > 0 or ${revenue} > 0)`;
}

function soValueThresholdFilterSql(
  filter: string,
  values: unknown[],
  thresholdFinancialYear: string | undefined,
) {
  const { label, metric } = parseValueThresholdDashboardFilter(filter, "soValueThreshold:");
  if (!label) return "true";
  const financialYearSql = valueThresholdFinancialYearSql(values, thresholdFinancialYear);
  const capital = inrAmountExpression("so.so_value_capital");
  const revenue = inrAmountExpression("so.so_value_revenue");
  const valueType = `case when ${capital} > 0 then 'capital' when ${revenue} > 0 then 'revenue' end`;
  const amount = `case when ${capital} > 0 then ${capital} when ${revenue} > 0 then ${revenue} else 0 end`;
  const levelMatch = valueThresholdMatchSql("v", amount, valueType);
  const metricCondition =
    metric === "capital" || metric === "revenue"
      ? `${valueType} = ${addSqlValue(values, metric)}`
      : undefined;

  if (label.toLowerCase() === "unmatched") {
    return `exists (
      select 1 from supply_orders so
      where so.file_id = f.id
        and ${amount} > 0
        ${metricCondition ? `and ${metricCondition}` : ""}
        and not exists (
          select 1 from value_threshold_levels v
          where v.financial_year = ${financialYearSql}
            and ${levelMatch}
        )
    )`;
  }

  const labelPlaceholder = addSqlValue(values, label.toLowerCase());
  const priorMatch = valueThresholdMatchSql("previous_v", amount, valueType);
  return `exists (
    select 1 from supply_orders so
    where so.file_id = f.id
      ${metricCondition ? `and ${metricCondition}` : ""}
      and exists (
        select 1 from value_threshold_levels v
        where v.financial_year = ${financialYearSql}
          and lower(trim(v.label)) = ${labelPlaceholder}
          and ${levelMatch}
          and not exists (
            select 1 from value_threshold_levels previous_v
            where previous_v.financial_year = v.financial_year
              and previous_v.level_number < v.level_number
              and ${priorMatch}
          )
      )
  )`;
}

function soValueThresholdTotalFilterSql(filter: string) {
  const [, rawMetric = "total"] = filter.split(":");
  const metric = decodeFilterPart(rawMetric);
  const capital = inrAmountExpression("so.so_value_capital");
  const revenue = inrAmountExpression("so.so_value_revenue");
  const valueCondition =
    metric === "capital"
      ? `${capital} > 0`
      : metric === "revenue"
        ? `${revenue} > 0`
        : `(${capital} > 0 or ${revenue} > 0)`;
  return supplyOrderExists(valueCondition);
}

function isCancellationDashboardFilter(filter: string) {
  return (
    filter === "miscDemandCancelled" ||
    filter === "miscSoCancelled" ||
    filter === "miscShortclosedSo" ||
    filter.startsWith("fileInflowMonth:") ||
    filter.startsWith("fileInflowDate:") ||
    filter.startsWith("fileInflowYear:") ||
    filter.startsWith("supplyOrderMonth:") ||
    filter.startsWith("supplyOrderDate:") ||
    filter.startsWith("supplyOrderYear:") ||
    filter.startsWith("bgExpiryMonth:") ||
    filter.startsWith("bgExpiryDate:") ||
    filter.startsWith("bgExpiryYear:")
  );
}

function isInactiveHistoryDashboardFilter(filter: string) {
  return (
    filter === "divisionTurnaroundSample" ||
    filter.startsWith("division:") ||
    filter.startsWith("fileField:") ||
    filter.startsWith("mode:") ||
    filter.startsWith("gemBiddingMode:") ||
    filter.startsWith("preBidMeetingCombined:") ||
    filter.startsWith("preBidMeetingCombinedFy:") ||
    filter.startsWith("preBidMeeting:") ||
    filter.startsWith("refloatPreBidMeeting:") ||
    filter.startsWith("preBidMeetingFy:") ||
    filter.startsWith("refloatPreBidMeetingFy:") ||
    filter.startsWith("deliverySchedule:") ||
    filter.startsWith("deliveryScheduleDate:") ||
    filter.startsWith("deliveryScheduleYear:") ||
    filter.startsWith("completedDeliveryMonth:") ||
    filter.startsWith("completedDeliveryDate:") ||
    filter.startsWith("completedDeliveryYear:") ||
    filter.startsWith("tcecStatus:") ||
    filter.startsWith("tcecStatusFy:") ||
    filter.startsWith("cncSummary:") ||
    filter.startsWith("cncSummaryFy:")
  );
}

function shouldAllowInactiveDashboardFilter(filter: string) {
  return (
    isFileIdsDashboardFilter(filter) ||
    filter.startsWith("analyticsIndentorFirm:") ||
    filter.startsWith("analyticsCoBidding:") ||
    isMilestoneClearingDashboardFilter(filter) ||
    filter === "gemUndertaking:completed" ||
    filter === "totalFiles" ||
    isCancellationDashboardFilter(filter) ||
    filter.startsWith("attribute:") ||
    filter.startsWith("fileType:") ||
    filter.startsWith("fileCategory:") ||
    filter.startsWith("firmType:") ||
    filter.startsWith("status4:") ||
    filter === "milestoneTotal:supplyOrder" ||
    filter === "milestoneCleared:supplyOrder" ||
    isHistoricalMilestoneDashboardFilter(filter) ||
    isHistoricalStatusSummaryDashboardFilter(filter) ||
    filter === "preBidMeeting:completed" ||
    filter === "bgToBeReturned" ||
    filter.startsWith("bgToBeReturned:") ||
    filter.startsWith("valueThreshold:") ||
    filter.startsWith("valueThresholdTotal:") ||
    filter.startsWith("soValueThreshold:") ||
    filter.startsWith("soValueThresholdTotal:") ||
    isInactiveHistoryDashboardFilter(filter)
  );
}

function shouldIncludeCancelledSoHistoryForDashboardFilter(filter: string) {
  return (
    isHistoricalStatusSummaryDashboardFilter(filter) ||
    isMilestoneClearingDashboardFilter(filter) ||
    filter === "preBidMeeting:completed" ||
    filter === "bgToBeReturned" ||
    filter.startsWith("bgToBeReturned:")
  );
}

function isHistoricalStatusSummaryDashboardFilter(filter: string) {
  const match = filter.match(/^statusSummary:([^:]+):([^:]+)$/);
  if (!match) return false;
  const milestone = normalizeMilestoneName(decodeStatusFilterPart(match[1]));
  const stage = normalizeMilestoneName(decodeStatusFilterPart(match[2]));
  if (["scrutiny", "controlling", "cfa"].includes(milestone)) {
    return ["total", "totalfiles", "completed"].includes(stage);
  }
  if (["psb", "pwb", "psbpwb"].includes(milestone)) {
    return stage === "tobereturned";
  }
  if (milestone === "bidding") return stage === "completed";
  if (milestone === "prebidmeeting") return stage === "completed";
  return false;
}

function isHistoricalMilestoneDashboardFilter(filter: string) {
  const match = filter.match(/^milestone(?:Total|Cleared):(scrutiny|control|cfa|bidding)$/);
  return Boolean(match);
}

function isBgToBeReturnedDashboardFilter(filter: string) {
  if (filter === "bgToBeReturned") return true;
  if (filter.startsWith("bgToBeReturned:")) {
    return isBgStatusKey(filter.slice("bgToBeReturned:".length));
  }
  const match = filter.match(/^statusSummary:([^:]+):([^:]+)$/);
  return Boolean(
    match &&
      ["psb", "pwb", "psbpwb"].includes(
        normalizeMilestoneName(decodeStatusFilterPart(match[1])),
      ) &&
      normalizeMilestoneName(decodeStatusFilterPart(match[2])) === "tobereturned",
  );
}

function shouldBypassActiveStatusYearDashboardFilter(filter: string) {
  return isFileIdsDashboardFilter(filter);
}

function isMilestoneClearingDashboardFilter(filter: string) {
  return filter.startsWith("analyticsMilestoneClearing:");
}

function shouldAllowDemandCancelledDashboardFilter(filter: string) {
  return filter === "miscDemandCancelled" || isFileIdsDashboardFilter(filter);
}

function workflowNotStartedSql() {
  const dateFields = [
    "scrutiny_date",
    "scrutiny_response_date",
    "scrutiny_completion_date",
    "imms_date",
    "cfa_sent_date",
    "cfa_date",
  ];
  const noFileDates = dateFields.map((column) => `not ${hasTextSql(`f.${column}`)}`).join(" and ");
  const applicabilityGates = [
    { applies: isYesSql("f.high_value"), dates: ["high_value_meeting_date", "high_value_minutes_date"] },
    { applies: isYesSql("f.ad"), dates: ["ad_sent_date", "ad_vetting_date"] },
    { applies: isYesSql("f.tcec"), dates: ["pre_tcec_date", "pre_tcec_minutes_date", "post_tcec_date", "post_tcec_minutes_date", "cnc_date", "cnc_approval_date"] },
    { applies: isYesSql("f.rqa"), dates: ["rqa_sent_date", "rqa_approval_date"] },
    { applies: isYesSql("f.ifa"), dates: ["ifa_sent_date", "ifa_final_date"] },
    { applies: isYesSql("f.gem"), dates: ["gem_undertaking_date"] },
    { applies: isYesSql("f.rfp_vetting"), dates: ["rfp_vetting_initiation_date", "rfp_vetting_approval_date"] },
    {
      applies: `(${biddingApplicableSql()} and ${isYesSql("f.pre_bid_meeting")})`,
      dates: ["pre_bid_meeting_date"],
    },
    { applies: biddingApplicableSql(), dates: ["bid_date", "bid_opening_date"] },
    {
      applies: `(${biddingApplicableSql()} and ${isYesSql("f.refloat")})`,
      dates: ["refloat_bidding_date", "refloat_bid_opening_date"],
    },
    {
      applies: `(${biddingApplicableSql()} and ${isYesSql("f.refloat")} and ${isYesSql("f.refloat_pre_bid_meeting")})`,
      dates: ["refloat_pre_bid_meeting_date"],
    },
    {
      applies: `(${isYesSql("f.refloat")} and ${isYesSql("f.tcec")})`,
      dates: ["refloat_post_tcec_date", "refloat_post_tcec_minutes_date"],
    },
    {
      applies: `(${biddingApplicableSql()} and ${isYesSql("f.refloat")} and ${isYesSql("f.tcec")} and ${isYesSql("f.gem")})`,
      dates: ["refloat_gem_undertaking_date"],
    },
  ];
  const noInapplicableWorkflowDates = applicabilityGates
    .map(
      ({ applies, dates }) =>
        `not (${applies} and (${dates.map((column) => hasTextSql(`f.${column}`)).join(" or ")}))`,
    )
    .join(" and ");
  return `not ${isCancelledFileSql()}
    and not ${hasTextSql("f.current_milestone")}
    and not exists (select 1 from file_completed_milestones completed where completed.file_id = f.id)
    and ${noFileDates}
    and ${noInapplicableWorkflowDates}
    and not exists (
      select 1
      from supply_orders so_workflow
      where so_workflow.file_id = f.id
        and (
          ${hasTextSql("so_workflow.financial_sanction_date")}
          or ${hasTextSql("so_workflow.so_date")}
          or ${hasTextSql("so_workflow.dp_date")}
          or ${hasTextSql("so_workflow.material_receipt_date")}
          or ${hasTextSql("so_workflow.job_completion_date")}
          or (${deliveryInspectionApplicableSql()} and (${hasTextSql("so_workflow.ir_preparation_date")} or ${hasTextSql("so_workflow.ir_receipt_date")}))
          or ${hasTextSql("so_workflow.bill_preparation_date")}
          or ${hasTextSql("so_workflow.bill_sent_for_payment_date")}
          or ${hasTextSql("so_workflow.payment_date")}
        )
    )`;
}

function shouldShowDemandCancelledFiles(params: FileSearchParams) {
  const dashboardFilters = [params.dashboardFilter, ...(params.extraDashboardFilters ?? [])]
    .map((filter) => filter?.trim())
    .filter((filter): filter is string => Boolean(filter));
  return dashboardFilters.some(shouldAllowDemandCancelledDashboardFilter);
}

function shouldShowCancelledSupplyOrderFiles(params: FileSearchParams) {
  if (params.milestoneClearingScope) return true;
  if (isFirmOriginatedSearch(params)) return true;
  if (params.analyticsType === "indentor") return true;
  const dashboardFilters = [params.dashboardFilter, ...(params.extraDashboardFilters ?? [])]
    .map((filter) => filter?.trim())
    .filter((filter): filter is string => Boolean(filter));
  return (
    params.soCancelledPresenceFilter === "include" ||
    params.shortclosedSoPresenceFilter === "include" ||
    dashboardFilters.some(
      (dashboardFilter) =>
        isFileIdsDashboardFilter(dashboardFilter) ||
        dashboardFilter.startsWith("analyticsIndentorFirm:") ||
        dashboardFilter.startsWith("analyticsCoBidding:") ||
        isMilestoneClearingDashboardFilter(dashboardFilter) ||
        dashboardFilter === "totalFiles" ||
        dashboardFilter.startsWith("status4:") ||
        shouldAllowInactiveDashboardFilter(dashboardFilter),
    )
  );
}

function isFileIdsDashboardFilter(filter: string) {
  return filter.startsWith("fileIds:") || filter.startsWith("snapshotFileIds:");
}

function analyticsIndentorFirmFilterSql(filter: string, values: unknown[]) {
  const [, rawIndentor = "", rawFirmIdentity = ""] = filter.split(":");
  const indentor = decodeFilterPart(rawIndentor).trim().toLowerCase();
  const firmIdentity = decodeFilterPart(rawFirmIdentity).trim().toLowerCase();
  if (!indentor || !firmIdentity) return "false";
  const indentorPlaceholder = addSqlValue(values, indentor);
  let firmCondition: string;
  if (firmIdentity.startsWith("no:")) {
    const uniqueNoPlaceholder = addSqlValue(values, firmIdentity.slice(3));
    firmCondition = `lower(trim(coalesce(so.firm_unique_no, ''))) = ${uniqueNoPlaceholder}`;
  } else {
    const name = firmIdentity.startsWith("name:") ? firmIdentity.slice(5) : "";
    if (!name) return "false";
    const namePlaceholder = addSqlValue(values, name);
    firmCondition = `lower(trim(coalesce(so.firm, ''))) = ${namePlaceholder}`;
  }
  return supplyOrderExists(`
    (${hasTextSql("so.so_date")} or ${hasTextSql("so.so_no")} or ${hasTextSql("so.gem_so_no")})
    and lower(trim(coalesce(f.indentor, ''))) = ${indentorPlaceholder}
    and ${firmCondition}
  `);
}

function analyticsCoBiddingFilterSql(filter: string, values: unknown[]) {
  const [, rawMainFirm = "", rawPartnerIdentity = ""] = filter.split(":");
  const mainFirm = decodeFilterPart(rawMainFirm).trim().toLowerCase();
  const partnerIdentity = decodeFilterPart(rawPartnerIdentity).trim().toLowerCase();
  if (!mainFirm || !partnerIdentity) return "false";
  const mainPlaceholder = addSqlValue(values, mainFirm);
  let partnerCondition: string;
  if (partnerIdentity.startsWith("no:")) {
    const uniqueNoPlaceholder = addSqlValue(values, partnerIdentity.slice(3));
    partnerCondition = `lower(coalesce(ff_partner.firm_unique_no, '')) = ${uniqueNoPlaceholder}`;
  } else {
    const match = partnerIdentity.match(/^name:(.*)\|city:(.*)$/);
    if (!match?.[1]) return "false";
    const namePlaceholder = addSqlValue(values, match[1]);
    const cityPlaceholder = addSqlValue(values, match[2] ?? "");
    partnerCondition = `lower(coalesce(ff_partner.firm_name, '')) = ${namePlaceholder}
      and lower(coalesce(ff_partner.city, '')) = ${cityPlaceholder}`;
  }
  return `exists (
    select 1 from file_firms ff_main
    where ff_main.file_id = f.id and ff_main.firm_type = 'bidder'
      and lower(coalesce(ff_main.firm_name, '')) = ${mainPlaceholder}
  ) and exists (
    select 1 from file_firms ff_partner
    where ff_partner.file_id = f.id and ff_partner.firm_type = 'bidder'
      and ${partnerCondition}
  )`;
}

function isFirmOriginatedSearch(params: FileSearchParams) {
  const dashboardFilters = [params.dashboardFilter, ...(params.extraDashboardFilters ?? [])]
    .map((filter) => filter?.trim())
    .filter((filter): filter is string => Boolean(filter));
  return (
    params.analyticsType === "firm" ||
    dashboardFilters.some((filter) => filter.startsWith("firmAnalysis:")) ||
    Boolean(params.firm?.trim()) ||
    Boolean(params.firmIdentityUniqueNo?.trim()) ||
    Boolean(params.firmIdentityName?.trim()) ||
    Boolean(params.firmUniqueNo?.trim()) ||
    Boolean(params.firmContactNo?.trim()) ||
    Boolean(params.firmCity?.trim()) ||
    Boolean(params.selectedFirmTypes?.length)
  );
}

function shouldBypassActiveStatusYearFilter(params: FileSearchParams) {
  const dashboardFilters = [params.dashboardFilter, ...(params.extraDashboardFilters ?? [])]
    .map((filter) => filter?.trim())
    .filter((filter): filter is string => Boolean(filter));
  return (
    (isFirmOriginatedSearch(params) && !isAnalyticsScopedFirmSearch(params)) ||
    params.fileClosedPresenceFilter === "include" ||
    params.soCancelledPresenceFilter === "include" ||
    params.shortclosedSoPresenceFilter === "include" ||
    dashboardFilters.some(shouldBypassActiveStatusYearDashboardFilter)
  );
}

function isAnalyticsScopedFirmSearch(params: FileSearchParams) {
  const dashboardFilters = [params.dashboardFilter, ...(params.extraDashboardFilters ?? [])]
    .map((filter) => filter?.trim())
    .filter((filter): filter is string => Boolean(filter));
  return (
    params.analyticsType === "firm" ||
    dashboardFilters.some(
      (filter) =>
        filter.startsWith("firmAnalysis:") ||
        filter.startsWith("analyticsIndentorFirm:") ||
        filter.startsWith("analyticsCoBidding:"),
    )
  );
}

export function appendSearchGlobalYearScope(
  conditions: string[],
  values: unknown[],
  selectedYear: string,
  currentFinancialYear: string | undefined,
  searchParams: FileSearchParams,
) {
  const dashboardFilters = [searchParams.dashboardFilter, ...(searchParams.extraDashboardFilters ?? [])]
    .map((filter) => filter?.trim())
    .filter((filter): filter is string => Boolean(filter));
  const isMilestoneClearingDrilldown =
    searchParams.milestoneClearingScope ||
    dashboardFilters.some(isMilestoneClearingDashboardFilter);
  if (selectedYear === allActiveFilesYear && isMilestoneClearingDrilldown) {
    conditions.push(`not exists (
      select 1 from file_completed_milestones completed_payment
      where completed_payment.file_id = f.id
        and ${normalizedSql("completed_payment.milestone")} = 'payment'
    )`);
    return;
  }

  const bypassActiveStatusYearFilter = shouldBypassActiveStatusYearFilter(searchParams);
  if (selectedYear === allFilesYear) return;
  if (selectedYear === allActiveFilesYear) {
    if (!bypassActiveStatusYearFilter) conditions.push(activeFilesSql());
    return;
  }
  if (selectedYear === activePlusCurrentFyClosedYear) {
    if (!bypassActiveStatusYearFilter) {
      conditions.push(activePlusCurrentFyClosedSql(values, currentFinancialYear));
    }
    return;
  }
  if (selectedYear) conditions.push(specificFinancialYearSql(values, selectedYear));
}

export function dashboardFilterSql(
  filter: string,
  values: unknown[],
  thresholdFinancialYear?: string | undefined,
) {
  const today = "current_date";
  if (filter.startsWith("delayStatus:")) return delayStatusFilterSql(filter, values);
  if (filter.startsWith("analyticsIndentorFirm:")) {
    return analyticsIndentorFirmFilterSql(filter, values);
  }
  if (filter.startsWith("analyticsCoBidding:")) {
    return analyticsCoBiddingFilterSql(filter, values);
  }
  if (filter.startsWith("division:")) {
    const division = decodeFilterPart(filter.slice("division:".length)).trim().toLowerCase();
    if (!division) return "true";
    const placeholder = addSqlValue(values, division);
    return `exists (
      select 1 from divisions local_division
      where local_division.id = f.division_id
        and lower(trim(coalesce(local_division.name, ''))) = ${placeholder}
    )`;
  }
  if (filter.startsWith("fileField:")) {
    const raw = filter.slice("fileField:".length);
    const separator = raw.indexOf(":");
    if (separator < 0) return "false";
    const keys = raw.slice(0, separator).split(",");
    const allowedKeys = new Set([
      "preTcecCommitteeNo",
      "postTcecCommitteeNumber",
      "refloatPostTcecCommitteeNo",
    ]);
    if (keys.some((key) => !allowedKeys.has(key))) return "false";
    const value = decodeFilterPart(raw.slice(separator + 1)).trim().toLowerCase();
    const columns = keys.flatMap((key) => {
      const column = fileSearchColumns[key as keyof typeof fileSearchColumns];
      return column ? [column] : [];
    });
    if (!columns.length || !value) return "false";
    const placeholder = addSqlValue(values, value);
    return `(${columns.map((column) => `lower(trim(coalesce(${column}, ''))) = ${placeholder}`).join(" or ")})`;
  }
  if (filter.startsWith("firmAnalysis:")) return firmAnalysisFilterSql(filter, values);
  if (isFinanceCarryForwardDashboardFilter(filter)) {
    return financeCarryForwardFilterSql(filter, values);
  }
  if (filter.startsWith("status4:")) return status4FilterSql(filter, values);
  if (filter.startsWith("billReturn:")) {
    const state = filter.slice("billReturn:".length);
    if (!isBillReturnFilterState(state)) return "true";
    return billReturnStatusFilterSql(state);
  }
  if (filter === "supplementaryBill:submitted")
    return supplementaryBillStatusSql("submitted");
  if (filter === "supplementaryBill:pending") return supplementaryBillStatusSql("pending");
  if (filter === "supplementaryBill:normalPending") return supplementaryBillStatusSql("normalPending");
  if (filter === "supplementaryBill:returnPendingUnpaid") return supplementaryBillStatusSql("returnPendingUnpaid");
  if (filter === "supplementaryBill:resubmittedPending") return supplementaryBillStatusSql("resubmittedPending");
  if (filter === "supplementaryBill:any") return supplementaryBillStatusSql("any");
  if (filter === "supplementaryBill:returned") return supplementaryBillStatusSql("returned");
  if (filter === "supplementaryBill:resubmitted") return supplementaryBillStatusSql("resubmitted");
  if (filter === "supplementaryBill:paid") return supplementaryBillStatusSql("paid");
  if (filter === "supplementaryBill:returnPaid") return supplementaryBillStatusSql("returnPaid");
  if (filter.startsWith("biddingDelay:")) {
    const [, rawDays = "0", breakupKey = ""] = filter.split(":");
    const thresholdDays = Number.parseInt(rawDays, 10);
    if (!Number.isFinite(thresholdDays) || thresholdDays < 0) return "false";
    const thresholdPlaceholder = addSqlValue(values, thresholdDays);
    return biddingDelayStatusSql(breakupKey, thresholdPlaceholder);
  }
  if (filter === "analyticsMilestoneClearing:bidding") {
    const gemUndertakingApplies = `(${isYesSql("f.gem")}
      and lower(trim(coalesce(f.gem_bidding_mode, ''))) <> 'comparison')`;
    const tcecRefloat = `(${isYesSql("f.tcec")} and ${isYesSql("f.refloat")})`;
    const tcecStart = `case
      when ${tcecRefloat} then f.post_tcec_minutes_date
      else greatest(
        f.cfa_date,
        case when ${gemUndertakingApplies} then f.gem_undertaking_date else f.cfa_date end,
        case when ${isYesSql("f.rfp_vetting")} then f.rfp_vetting_approval_date else f.cfa_date end
      )
    end`;
    const tcecEnd = `case
      when ${isYesSql("f.tcec")} and ${isYesSql("f.refloat")} then f.refloat_post_tcec_date
      when ${isYesSql("f.tcec")} then f.post_tcec_date
      else f.bid_date
    end`;
    const tcec = `${biddingApplicableSql()}
      and ${isYesSql("f.tcec")}
      and ${isYesSql("f.bidding_stage_over")}
      and (
        (
          ${isYesSql("f.refloat")}
          and ${hasTextSql("f.post_tcec_minutes_date")}
        )
        or (
          not ${isYesSql("f.refloat")}
          and ${hasTextSql("f.cfa_date")}
          and (not ${gemUndertakingApplies} or ${hasTextSql("f.gem_undertaking_date")})
          and (not ${isYesSql("f.rfp_vetting")} or ${hasTextSql("f.rfp_vetting_approval_date")})
        )
      )
      and ${hasTextSql(tcecStart)}
      and ${hasTextSql(tcecEnd)}
      and (${tcecEnd}) >= (${tcecStart})
      and ${hasTextSql("f.received_date")}
      and (${tcecEnd}) >= f.received_date`;
    const normalNonTcec = `${biddingApplicableSql()}
      and not ${isYesSql("f.tcec")}
      and ${hasTextSql("f.cfa_date")}
      and ${hasTextSql("f.bid_date")}
      and f.bid_date >= f.cfa_date
      and ${hasTextSql("f.received_date")}
      and f.bid_date >= f.received_date`;
    const refloatNonTcec = `${biddingApplicableSql()}
      and not ${isYesSql("f.tcec")}
      and ${isYesSql("f.refloat")}
      and ${isYesSql("f.bidding_stage_over")}
      and ${hasTextSql("f.refloat_recommendation_date")}
      and ${hasTextSql("f.refloat_bidding_date")}
      and f.refloat_bidding_date >= f.refloat_recommendation_date
      and ${hasTextSql("f.received_date")}
      and f.refloat_bidding_date >= f.received_date`;
    return `((${tcec}) or (${normalNonTcec}) or (${refloatNonTcec}))`;
  }
  if (filter === "analyticsMilestoneClearing:gemUndertaking") {
    const gemUndertakingApplies = `(${isYesSql("f.gem")}
      and lower(trim(coalesce(f.gem_bidding_mode, ''))) <> 'comparison')`;
    const normalStart = "f.cfa_date";
    const normalEnd = "f.gem_undertaking_date";
    const refloatStart = "f.refloat_recommendation_date";
    const refloatEnd = "f.refloat_gem_undertaking_date";
    const normal = `${gemUndertakingApplies}
      and ${hasTextSql(normalStart)}
      and ${hasTextSql(normalEnd)}
      and (${normalEnd}) >= (${normalStart})
      and ${hasTextSql("f.received_date")}
      and (${normalEnd}) >= f.received_date`;
    const refloat = `${gemUndertakingApplies}
      and not ${isYesSql("f.tcec")}
      and ${isYesSql("f.refloat")}
      and ${hasTextSql(refloatStart)}
      and ${hasTextSql(refloatEnd)}
      and (${refloatEnd}) >= (${refloatStart})
      and ${hasTextSql("f.received_date")}
      and (${refloatEnd}) >= f.received_date`;
    return `((${normal}) or (${refloat}))`;
  }
  if (filter === "analyticsMilestoneClearing:rfpVetting") {
    const start = `case
      when ${isYesSql("f.gem")}
        and lower(trim(coalesce(f.gem_bidding_mode, ''))) <> 'comparison'
        and ${hasTextSql("f.cfa_date")}
        then f.gem_undertaking_date
      else f.cfa_date
    end`;
    const end = "f.rfp_vetting_approval_date";
    return `${isYesSql("f.rfp_vetting")}
      and ${hasTextSql(start)}
      and ${hasTextSql(end)}
      and ${hasTextSql("f.received_date")}
      and (${end}) >= (${start})
      and (${end}) >= f.received_date`;
  }
  if (filter === "analyticsMilestoneClearing:nonTcecTechnicalEvaluation") {
    const firstCycleStart = dateCastSql("f.bid_opening_date");
    const firstCycleEnd = `(case
      when ${isYesSql("f.refloat")} then ${dateCastSql("f.refloat_recommendation_date")}
      else (select min(${dateCastSql("so_end.financial_sanction_date")})
        from supply_orders so_end
        where so_end.file_id = f.id)
    end)`;
    const secondCycleStart = dateCastSql("f.refloat_bid_opening_date");
    const secondCycleEnd = `(select min(${dateCastSql("so_end.financial_sanction_date")})
      from supply_orders so_end
      where so_end.file_id = f.id)`;
    const firstCycle = `not ${isYesSql("f.tcec")}
      and ${biddingApplicableSql()}
      and ${isYesSql("f.bidding_stage_over")}
      and ${hasTextSql(firstCycleStart)}
      and ${hasTextSql(firstCycleEnd)}
      and (${firstCycleEnd}) >= (${firstCycleStart})
      and ${hasTextSql("f.received_date")}
      and (${firstCycleEnd}) >= ${dateCastSql("f.received_date")}`;
    const secondCycle = `not ${isYesSql("f.tcec")}
      and ${biddingApplicableSql()}
      and ${isYesSql("f.refloat")}
      and ${isYesSql("f.refloat_bidding_stage_over")}
      and ${hasTextSql(secondCycleStart)}
      and ${hasTextSql(secondCycleEnd)}
      and (${secondCycleEnd}) >= (${secondCycleStart})
      and ${hasTextSql("f.received_date")}
      and (${secondCycleEnd}) >= ${dateCastSql("f.received_date")}`;
    return `((${firstCycle}) or (${secondCycle}))`;
  }
  if (filter === "analyticsMilestoneClearing:supplyOrder") {
    const tcecSupplyOrder = dashboardMilestoneFilterSql("milestoneCleared:supplyOrder") ?? "false";
    return `(
      (not ${isYesSql("f.tcec")} and exists (
        select 1
        from supply_orders so
        where so.file_id = f.id
          and ${hasTextSql("so.financial_sanction_date")}
          and ${hasTextSql("so.so_date")}
          and so.so_date >= so.financial_sanction_date
      ))
      or (${isYesSql("f.tcec")} and (${tcecSupplyOrder}))
    )`;
  }
  if (filter === "analyticsMilestoneClearing:payment") {
    const duration = (submission: string, payment: string, returns: string, include: string) => `(
      ${include}
      and ${hasTextSql(submission)}
      and ${hasTextSql(payment)}
      and ${payment} >= ${submission}
      and not ${returns}
    )`;
    const commonPayment = `(${isYesSql("so.stage_delivery")}
      and not ${isYesSql("so.stage_payment")}
      and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0
      and ${duration(
        "so.bill_sent_for_payment_date",
        "so.payment_date",
        billReturnHistorySql("so.bill_return_cycles"),
        "so.include_in_payment_timing is distinct from false",
      )})`;
    const stagewisePayment = `(${isYesSql("so.stage_delivery")}
      and ${isYesSql("so.stage_payment")}
      and exists (
        select 1
        from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as payment_stage(stage)
        where ${duration(
          "nullif(payment_stage.stage ->> 'billSentForPaymentDate', '')::date",
          "nullif(payment_stage.stage ->> 'paymentDate', '')::date",
          billReturnHistorySql("payment_stage.stage -> 'billReturnCycles'"),
          "lower(coalesce(payment_stage.stage ->> 'includeInPaymentTiming', 'true')) <> 'false'",
        )}
      ))`;
    const parentPayment = `(not (${isYesSql("so.stage_delivery")} and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)
      and ${duration(
        "so.bill_sent_for_payment_date",
        "so.payment_date",
        billReturnHistorySql("so.bill_return_cycles"),
        "so.include_in_payment_timing is distinct from false",
      )})`;
    const advancePayment = `(
      ${isYesSql("so.advance_payment")}
      and lower(coalesce(so.advance_payment_detail ->> 'includeInPaymentTiming', 'true')) <> 'false'
      and ${duration(
        paymentTimingJsonDateSql("so.advance_payment_detail ->> 'billSentForPaymentDate'"),
        paymentTimingJsonDateSql("so.advance_payment_detail ->> 'paymentDate'"),
        billReturnHistorySql("so.advance_payment_detail -> 'billReturnCycles'"),
        "true",
      )}
    )`;
    const supplementaryPayment = `exists (
      select 1
      from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
      where ${duration(
        paymentTimingJsonDateSql("supplementary_bill.bill ->> 'billSentForPaymentDate'"),
        paymentTimingJsonDateSql("supplementary_bill.bill ->> 'paymentDate'"),
        billReturnHistorySql("supplementary_bill.bill -> 'billReturnCycles'"),
        "lower(coalesce(supplementary_bill.bill ->> 'includeInPaymentTiming', 'true')) <> 'false'",
      )}
    )`;
    return `not (${isYesSql("f.demand_cancelled")})
      and exists (
        select 1
        from supply_orders so
        where so.file_id = f.id
          and not ${isYesSql("so.so_cancelled")}
          and (${commonPayment} or ${stagewisePayment} or ${parentPayment}
            or ${advancePayment} or ${supplementaryPayment})
      )`;
  }
  if (filter === "analyticsMilestoneClearing:paymentPreSubmission") {
    const parentTrigger = paymentTimingTriggerSql();
    const stageTrigger = paymentTimingTriggerSql("payment_stage.stage");
    const commonTrigger = latestPaymentTimingStageTriggerSql();
    const validDuration = (start: string, end: string) =>
      `(${start}) is not null and ${end} is not null and ${end} >= (${start})`;
    const commonCase = `(
      ${isYesSql("so.stage_delivery")} and not ${isYesSql("so.stage_payment")}
      and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0
      and so.include_in_payment_timing is distinct from false
      and ${hasTextSql("so.so_date")}
      and ${hasTextSql("so.bill_sent_for_payment_date")}
      and ${validDuration(commonTrigger, "so.bill_sent_for_payment_date")}
    )`;
    const stagewiseCase = `(
      ${isYesSql("so.stage_delivery")} and ${isYesSql("so.stage_payment")}
      and exists (
        select 1
        from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as payment_stage(stage)
        where lower(coalesce(payment_stage.stage ->> 'includeInPaymentTiming', 'true')) <> 'false'
          and ${hasTextSql("so.so_date")}
          and ${hasTextSql("payment_stage.stage ->> 'billSentForPaymentDate'")}
          and ${validDuration(stageTrigger, paymentTimingJsonDateSql("payment_stage.stage ->> 'billSentForPaymentDate'"))}
      )
    )`;
    const parentCase = `(
      not (${isYesSql("so.stage_delivery")} and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)
      and so.include_in_payment_timing is distinct from false
      and ${hasTextSql("so.so_date")}
      and ${hasTextSql("so.bill_sent_for_payment_date")}
      and ${validDuration(parentTrigger, "so.bill_sent_for_payment_date")}
    )`;
    return `not ${isYesSql("f.demand_cancelled")}
      and exists (
        select 1 from supply_orders so
        where so.file_id = f.id
          and not ${isYesSql("so.so_cancelled")}
          and (${commonCase} or ${stagewiseCase} or ${parentCase})
      )`;
  }
  if (filter === "analyticsMilestoneClearing:paymentCumulative") {
    const hasStages = `(${isYesSql("so.stage_delivery")}
      and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)`;
    const commonStages = `(${hasStages} and not ${isYesSql("so.stage_payment")})`;
    const stagewise = `(${hasStages} and ${isYesSql("so.stage_payment")})`;
    const duration = (
      start: string,
      submissionText: string,
      submissionDate: string,
      paymentText: string,
      paymentDate: string,
      returnHistory: string,
      include: string,
    ) => {
      const hasSubmission = hasTextSql(submissionText);
      const hasPayment = hasTextSql(paymentText);
      const endDate = `case when ${returnHistory} then ${submissionDate}
        when ${hasPayment} then ${paymentDate} else current_date end`;
      return `(${include}
        and ${hasTextSql("so.so_date")}
        and ${hasTextSql(start)}
        and (not ${hasPayment} or ${hasSubmission})
        and (not ${returnHistory} or ${hasSubmission})
        and (not ${isYesSql("so.no_further_action")} or ${hasPayment})
        and (${endDate}) >= (${start}))`;
    };
    const parentTrigger = paymentTimingTriggerSql();
    const commonTrigger = latestPaymentTimingStageTriggerSql();
    const stageTrigger = paymentTimingTriggerSql("payment_stage.stage");
    const parentCase = `(
      not ${hasStages}
      and ${duration(
        parentTrigger,
        "so.bill_sent_for_payment_date",
        "so.bill_sent_for_payment_date::date",
        "so.payment_date",
        "so.payment_date::date",
        billReturnHistorySql("so.bill_return_cycles"),
        "so.include_in_payment_timing is distinct from false",
      )}
    )`;
    const commonCase = `(
      ${commonStages}
      and ${duration(
        commonTrigger,
        "so.bill_sent_for_payment_date",
        "so.bill_sent_for_payment_date::date",
        "so.payment_date",
        "so.payment_date::date",
        billReturnHistorySql("so.bill_return_cycles"),
        "so.include_in_payment_timing is distinct from false",
      )}
    )`;
    const stagewiseCase = `(
      ${stagewise}
      and exists (
        select 1
        from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as payment_stage(stage)
        where ${duration(
          stageTrigger,
          "payment_stage.stage ->> 'billSentForPaymentDate'",
          paymentTimingJsonDateSql("payment_stage.stage ->> 'billSentForPaymentDate'"),
          "payment_stage.stage ->> 'paymentDate'",
          paymentTimingJsonDateSql("payment_stage.stage ->> 'paymentDate'"),
          billReturnHistorySql("payment_stage.stage -> 'billReturnCycles'"),
          "lower(coalesce(payment_stage.stage ->> 'includeInPaymentTiming', 'true')) <> 'false'",
        )}
      )
    )`;
    const specialCase = (
      detail: string,
      include: string,
      requireAdvanceFlag: boolean,
    ) => {
      const submissionText = `${detail} ->> 'billSentForPaymentDate'`;
      const paymentText = `${detail} ->> 'paymentDate'`;
      const submissionDate = paymentTimingJsonDateSql(submissionText);
      const paymentDate = paymentTimingJsonDateSql(paymentText);
      const hasPayment = hasTextSql(paymentText);
      const returned = billReturnHistorySql(`${detail} -> 'billReturnCycles'`);
      return `(${requireAdvanceFlag ? `${isYesSql("so.advance_payment")} and` : ""}
        ${include}
        and ${hasTextSql(submissionText)}
        and (not ${isYesSql("so.no_further_action")} or ${hasPayment})
        and (case when ${returned} then ${submissionDate}
          when ${hasPayment} then ${paymentDate} else current_date end) >= (${submissionDate}))`;
    };
    const advanceCase = specialCase(
      "so.advance_payment_detail",
      "lower(coalesce(so.advance_payment_detail ->> 'includeInPaymentTiming', 'true')) <> 'false'",
      true,
    );
    const supplementaryCase = `exists (
      select 1
      from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
      where ${specialCase(
        "supplementary_bill.bill",
        "lower(coalesce(supplementary_bill.bill ->> 'includeInPaymentTiming', 'true')) <> 'false'",
        false,
      )}
    )`;
    return `not ${isYesSql("f.demand_cancelled")}
      and exists (
        select 1 from supply_orders so
        where so.file_id = f.id
          and not ${isYesSql("so.so_cancelled")}
          and (${parentCase} or ${commonCase} or ${stagewiseCase}
            or ${advanceCase} or ${supplementaryCase})
      )`;
  }
  if (filter === "gemUndertaking:completed") {
    const refloatTcec = `(${isYesSql("f.refloat")} and ${isYesSql("f.tcec")})`;
    return `${isYesSql("f.gem")}
      and lower(trim(coalesce(f.gem_bidding_mode, ''))) <> 'comparison'
      and (
        (not ${isYesSql("f.refloat")}
          and ${hasTextSql("f.cfa_date")}
          and ${hasTextSql("f.gem_undertaking_date")}
          and f.gem_undertaking_date >= f.cfa_date)
        or (${refloatTcec}
          and ${hasTextSql("f.post_tcec_date")}
          and ${hasTextSql("f.refloat_gem_undertaking_date")}
          and f.refloat_gem_undertaking_date >= f.post_tcec_date)
      )`;
  }
  const dashboardMilestoneSql = dashboardMilestoneFilterSql(filter);
  if (dashboardMilestoneSql) return dashboardMilestoneSql;
  if (filter.startsWith("cashOutgoAny:")) return cashOutgoAnyFilterSql(filter, values);
  if (filter.startsWith("cashOutgo:")) return cashOutgoFilterSql(filter, values);
  if (filter.startsWith("statusSummary:")) return statusSummaryFilterSql(filter);
  if (filter.startsWith("demandProcessing:")) return demandProcessingFilterSql(filter);
  if (filter.startsWith("delayFile:")) {
    const placeholder = addSqlValue(values, filter.slice("delayFile:".length));
    return `f.id = ${placeholder}`;
  }
  if (filter.startsWith("anomalyFile:")) {
    const placeholder = addSqlValue(values, decodeFilterPart(filter.slice("anomalyFile:".length)));
    return `f.id = ${placeholder}`;
  }
  if (isFileIdsDashboardFilter(filter)) {
    const prefix = filter.startsWith("snapshotFileIds:") ? "snapshotFileIds:" : "fileIds:";
    const ids = filter
      .slice(prefix.length)
      .split(",")
      .map((id) => decodeFilterPart(id).trim())
      .filter(Boolean);
    if (!ids.length) return "false";
    const placeholder = addSqlValue(values, ids);
    return `f.id = any(${placeholder}::uuid[])`;
  }
  if (filter.startsWith("attribute:")) {
    const [, key, value] = filter.split(":");
    if (key === "psb") {
      const condition = supplyOrderExists(
        `${isYesSql("so.psb_applicable")}
         and not ${isYesSql("so.so_cancelled")}
         and trim(coalesce(so.bg_coverage_type, '')) in ('PSB', 'PSB and PWB separately')`,
      );
      if (value === "yes") return condition;
      if (value === "no") return `not (${condition})`;
      return "true";
    }
    const column = fileSearchColumns[key as keyof typeof fileSearchColumns];
    if (!column) return "true";
    if (value === "yes") return isYesSql(column);
    if (value === "no") return `not (${isYesSql(column)})`;
    return "true";
  }
  if (filter.startsWith("gemBiddingMode:")) {
    const mode = decodeFilterPart(filter.slice("gemBiddingMode:".length)).trim().toLowerCase();
    if (!mode) return "true";
    const placeholder = addSqlValue(values, mode);
    return `${isYesSql("f.gem")} and lower(trim(coalesce(f.gem_bidding_mode, ''))) = ${placeholder}`;
  }
  if (filter.startsWith("firmType:")) {
    const rawFirmType = filter.slice("firmType:".length);
    const firmType = decodeURIComponent(rawFirmType).trim().toUpperCase();
    if (!firmType) return "true";
    const placeholder = addSqlValue(values, firmType);
    return `exists (
      select 1 from supply_orders so
      where so.file_id = f.id
        and ${effectiveFirmTypeSql("so")} = ${placeholder}
    )`;
  }
  if (filter.startsWith("supplyOrderMonth:")) {
    const monthKey = filter.slice("supplyOrderMonth:".length);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return "true";
    const fromPlaceholder = addSqlValue(values, `${monthKey}-01`);
    const toPlaceholder = addSqlValue(values, getMonthEndDateFromMonthKey(monthKey));
    return supplyOrderExists(
      `${hasTextSql("so.so_date")}
       and so.so_date >= ${fromPlaceholder}::date
       and so.so_date <= ${toPlaceholder}::date`,
    );
  }
  if (filter.startsWith("supplyOrderDate:")) {
    const date = filter.slice("supplyOrderDate:".length);
    if (!isValidDate(date)) return "true";
    const placeholder = addSqlValue(values, date);
    return supplyOrderExists(`${hasTextSql("so.so_date")} and so.so_date = ${placeholder}::date`);
  }
  if (filter.startsWith("supplyOrderYear:")) {
    const yearKey = filter.slice("supplyOrderYear:".length);
    const range = yearKey === "all" ? undefined : getReportFiscalYearDateRange(yearKey);
    if (yearKey !== "all" && !range) return "true";
    const dateCondition =
      yearKey === "all"
        ? hasTextSql("so.so_date")
        : (() => {
            const fromPlaceholder = addSqlValue(values, range!.start);
            const toPlaceholder = addSqlValue(values, range!.end);
            return `${hasTextSql("so.so_date")}
       and so.so_date >= ${fromPlaceholder}::date
       and so.so_date <= ${toPlaceholder}::date`;
          })();
    return supplyOrderExists(dateCondition);
  }
  if (filter.startsWith("fileInflowMonth:")) {
    const monthKey = filter.slice("fileInflowMonth:".length);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return "true";
    const fromPlaceholder = addSqlValue(values, `${monthKey}-01`);
    const toPlaceholder = addSqlValue(values, getMonthEndDateFromMonthKey(monthKey));
    return `f.received_date >= ${fromPlaceholder}::date
      and f.received_date <= ${toPlaceholder}::date`;
  }
  if (filter.startsWith("fileInflowDate:")) {
    const date = filter.slice("fileInflowDate:".length);
    if (!isValidDate(date)) return "true";
    const placeholder = addSqlValue(values, date);
    return `f.received_date = ${placeholder}::date`;
  }
  if (filter.startsWith("fileInflowYear:")) {
    const yearKey = filter.slice("fileInflowYear:".length);
    if (yearKey === "all") return hasTextSql("f.received_date");
    const range = getReportFiscalYearDateRange(yearKey);
    if (!range) return "true";
    const fromPlaceholder = addSqlValue(values, range.start);
    const toPlaceholder = addSqlValue(values, range.end);
    return `f.received_date >= ${fromPlaceholder}::date
      and f.received_date <= ${toPlaceholder}::date`;
  }
  if (filter.startsWith("preBidMeeting:") || filter.startsWith("refloatPreBidMeeting:")) {
    const [kind = "", state = "all", monthKey = ""] = filter.split(":");
    if (!["all", "due", "completed"].includes(state)) return "true";
    const isRefloat = kind === "refloatPreBidMeeting";
    const applies = isRefloat
      ? `${isYesSql("f.refloat")} and ${isYesSql("f.refloat_pre_bid_meeting")}`
      : isYesSql("f.pre_bid_meeting");
    const dateColumn = isRefloat ? "f.refloat_pre_bid_meeting_date" : "f.pre_bid_meeting_date";
    const stateCondition =
      state === "due"
        ? `${dateColumn} >= current_date`
        : state === "completed"
          ? `${dateColumn} < current_date`
          : "true";
    const monthCondition = /^\d{4}-\d{2}-\d{2}$/.test(monthKey)
      ? (() => {
          const placeholder = addSqlValue(values, monthKey);
          return `and ${dateColumn} = ${placeholder}::date`;
        })()
      : /^\d{4}-\d{2}$/.test(monthKey)
      ? (() => {
          const fromPlaceholder = addSqlValue(values, `${monthKey}-01`);
          const toPlaceholder = addSqlValue(values, getMonthEndDateFromMonthKey(monthKey));
          return `and ${dateColumn} >= ${fromPlaceholder}::date
            and ${dateColumn} <= ${toPlaceholder}::date`;
        })()
      : "";
    return `not ${isYesSql("f.demand_cancelled")}
      and ${biddingApplicableSql()}
      and ${applies}
      and ${hasTextSql(dateColumn)}
      and ${stateCondition}
      ${monthCondition}`;
  }
  if (filter.startsWith("preBidMeetingCombined:")) {
    const [, state = "all", monthKey = ""] = filter.split(":");
    if (!["all", "due", "completed"].includes(state)) return "true";
    const stateCondition = (dateColumn: string) =>
      state === "due"
        ? `${dateColumn} >= current_date`
        : state === "completed"
          ? `${dateColumn} < current_date`
          : "true";
    const monthCondition = (dateColumn: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(monthKey)
        ? (() => {
            const placeholder = addSqlValue(values, monthKey);
            return `${dateColumn} = ${placeholder}::date`;
          })()
        : /^\d{4}-\d{2}$/.test(monthKey)
        ? (() => {
            const fromPlaceholder = addSqlValue(values, `${monthKey}-01`);
            const toPlaceholder = addSqlValue(values, getMonthEndDateFromMonthKey(monthKey));
            return `${dateColumn} >= ${fromPlaceholder}::date
              and ${dateColumn} <= ${toPlaceholder}::date`;
          })()
        : "true";
    const normalDate = "f.pre_bid_meeting_date";
    const refloatDate = "f.refloat_pre_bid_meeting_date";
    return `not ${isYesSql("f.demand_cancelled")}
      and ${biddingApplicableSql()}
      and (
        (${isYesSql("f.pre_bid_meeting")}
          and ${hasTextSql(normalDate)}
          and ${stateCondition(normalDate)}
          and ${monthCondition(normalDate)})
        or (${isYesSql("f.refloat")}
          and ${isYesSql("f.refloat_pre_bid_meeting")}
          and ${hasTextSql(refloatDate)}
          and ${stateCondition(refloatDate)}
          and ${monthCondition(refloatDate)})
      )`;
  }
  if (filter.startsWith("preBidMeetingFy:") || filter.startsWith("refloatPreBidMeetingFy:")) {
    const [kind = "", state = "all", rawFy = ""] = filter.split(":");
    if (!["all", "due", "completed"].includes(state)) return "true";
    const fiscalYear = decodeStatusFilterPart(rawFy).trim();
    const isRefloat = kind === "refloatPreBidMeetingFy";
    const applies = isRefloat
      ? `${isYesSql("f.refloat")} and ${isYesSql("f.refloat_pre_bid_meeting")}`
      : isYesSql("f.pre_bid_meeting");
    const dateColumn = isRefloat ? "f.refloat_pre_bid_meeting_date" : "f.pre_bid_meeting_date";
    const fyCondition = fiscalYearDateCondition(dateColumn, fiscalYear, values);
    if (!fyCondition) return "true";
    const stateCondition =
      state === "due"
        ? `${dateColumn} >= current_date`
        : state === "completed"
          ? `${dateColumn} < current_date`
          : "true";
    return `not ${isYesSql("f.demand_cancelled")}
      and ${biddingApplicableSql()}
      and ${applies}
      and ${hasTextSql(dateColumn)}
      and ${stateCondition}
      and ${fyCondition}`;
  }
  if (filter.startsWith("preBidMeetingCombinedFy:")) {
    const [, state = "all", rawFy = ""] = filter.split(":");
    if (!["all", "due", "completed"].includes(state)) return "true";
    const fiscalYear = decodeStatusFilterPart(rawFy).trim();
    const normalFyCondition = fiscalYearDateCondition(
      "f.pre_bid_meeting_date",
      fiscalYear,
      values,
    );
    const refloatFyCondition = fiscalYearDateCondition(
      "f.refloat_pre_bid_meeting_date",
      fiscalYear,
      values,
    );
    if (!normalFyCondition || !refloatFyCondition) return "true";
    const stateCondition = (dateColumn: string) =>
      state === "due"
        ? `${dateColumn} >= current_date`
        : state === "completed"
          ? `${dateColumn} < current_date`
          : "true";
    const normalDate = "f.pre_bid_meeting_date";
    const refloatDate = "f.refloat_pre_bid_meeting_date";
    return `not ${isYesSql("f.demand_cancelled")}
      and ${biddingApplicableSql()}
      and (
        (${isYesSql("f.pre_bid_meeting")}
          and ${hasTextSql(normalDate)}
          and ${stateCondition(normalDate)}
          and ${normalFyCondition})
        or (${isYesSql("f.refloat")}
          and ${isYesSql("f.refloat_pre_bid_meeting")}
          and ${hasTextSql(refloatDate)}
          and ${stateCondition(refloatDate)}
          and ${refloatFyCondition})
      )`;
  }
  if (filter.startsWith("deliverySchedule:") || filter.startsWith("deliveryScheduleDate:")) {
    const [, mode = "gross", monthKey = ""] = filter.split(":");
    const isDateFilter = filter.startsWith("deliveryScheduleDate:");
    if (
      (mode !== "gross" && mode !== "net") ||
      !(isDateFilter ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/).test(monthKey)
    ) return "true";
    const fromPlaceholder = addSqlValue(values, isDateFilter ? monthKey : `${monthKey}-01`);
    const toPlaceholder = addSqlValue(
      values,
      isDateFilter ? monthKey : getMonthEndDateFromMonthKey(monthKey),
    );
    const stageDpDate = `coalesce(
      nullif(stage_delivery.stage ->> 'revisedDp', '')::date,
      nullif(stage_delivery.stage ->> 'dpDate', '')::date
    )`;
    const stageJobCompletionDone = `coalesce(stage_delivery.stage ->> 'actualJobCompletionDate', '') <> ''`;
    const orderJobCompletionDone = `so.actual_job_completion_date is not null`;
    const physicalDelivery = deliveryInspectionApplicableSql();
    const stageFructified = `((${physicalDelivery}
        and coalesce(stage_delivery.stage ->> 'materialReceiptDate', '') <> '')
      or (not (${physicalDelivery}) and ${stageJobCompletionDone}))`;
    const orderDpDate = `coalesce(so.revised_dp, so.dp_date)`;
    const orderFructified = `((${physicalDelivery} and ${hasTextSql("so.material_receipt_date")})
      or (not (${physicalDelivery}) and ${orderJobCompletionDone}))`;
    const stageStatusCondition = mode === "net"
      ? ` and ${stageDpDate} < current_date and not ${stageFructified}`
      : ` and ${stageDpDate} >= current_date and not ${stageFructified}`;
    const orderStatusCondition = mode === "net"
      ? ` and ${orderDpDate} < current_date and not ${orderFructified}`
      : ` and ${orderDpDate} >= current_date and not ${orderFructified}`;
    return `not ${isYesSql("f.demand_cancelled")} and ${supplyOrderExists(
      `not ${isYesSql("so.so_cancelled")} and (
        exists (
          select 1
          from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_delivery(stage)
          where ${isYesSql("so.stage_delivery")}
            and ${stageDpDate} >= ${fromPlaceholder}::date
            and ${stageDpDate} <= ${toPlaceholder}::date
            ${stageStatusCondition}
        )
        or (
          not (${isYesSql("so.stage_delivery")}
            and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)
          and ${orderDpDate} >= ${fromPlaceholder}::date
          and ${orderDpDate} <= ${toPlaceholder}::date
          ${orderStatusCondition}
        )
      )`,
    )}`;
  }
  if (filter.startsWith("deliveryScheduleYear:")) {
    const [, mode = "gross", yearKey = ""] = filter.split(":");
    const range = yearKey === "all" ? undefined : getReportFiscalYearDateRange(yearKey);
    if ((mode !== "gross" && mode !== "net") || (yearKey !== "all" && !range)) {
      return "true";
    }
    const stageDpDate = `coalesce(
      nullif(stage_delivery.stage ->> 'revisedDp', '')::date,
      nullif(stage_delivery.stage ->> 'dpDate', '')::date
    )`;
    const stageJobCompletionDone = `coalesce(stage_delivery.stage ->> 'actualJobCompletionDate', '') <> ''`;
    const orderJobCompletionDone = `so.actual_job_completion_date is not null`;
    const physicalDelivery = deliveryInspectionApplicableSql();
    const stageFructified = `((${physicalDelivery}
        and coalesce(stage_delivery.stage ->> 'materialReceiptDate', '') <> '')
      or (not (${physicalDelivery}) and ${stageJobCompletionDone}))`;
    const orderDpDate = `coalesce(so.revised_dp, so.dp_date)`;
    const orderFructified = `((${physicalDelivery} and ${hasTextSql("so.material_receipt_date")})
      or (not (${physicalDelivery}) and ${orderJobCompletionDone}))`;
    const dateRangeCondition = (dateExpression: string) => {
      if (yearKey === "all") return `${dateExpression} is not null`;
      const fromPlaceholder = addSqlValue(values, range!.start);
      const toPlaceholder = addSqlValue(values, range!.end);
      return `${dateExpression} >= ${fromPlaceholder}::date and ${dateExpression} <= ${toPlaceholder}::date`;
    };
    const stageStatusCondition = mode === "net"
      ? ` and ${stageDpDate} < current_date and not ${stageFructified}`
      : ` and ${stageDpDate} >= current_date and not ${stageFructified}`;
    const orderStatusCondition = mode === "net"
      ? ` and ${orderDpDate} < current_date and not ${orderFructified}`
      : ` and ${orderDpDate} >= current_date and not ${orderFructified}`;
    return `not ${isYesSql("f.demand_cancelled")} and ${supplyOrderExists(
      `not ${isYesSql("so.so_cancelled")} and (
        exists (
          select 1
          from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_delivery(stage)
          where ${isYesSql("so.stage_delivery")}
            and ${dateRangeCondition(stageDpDate)}
            ${stageStatusCondition}
        )
        or (
          not (${isYesSql("so.stage_delivery")}
            and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)
          and ${dateRangeCondition(orderDpDate)}
          ${orderStatusCondition}
        )
      )`,
    )}`;
  }
  if (filter.startsWith("completedDeliveryMonth:") || filter.startsWith("completedDeliveryDate:")) {
    const isDateFilter = filter.startsWith("completedDeliveryDate:");
    const monthKey = isDateFilter ? "" : filter.slice("completedDeliveryMonth:".length);
    const dateValue = isDateFilter ? filter.slice("completedDeliveryDate:".length) : "";
    const validFilterValue = isDateFilter
      ? /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
      : /^\d{4}-\d{2}$/.test(monthKey);
    if (!validFilterValue) return "true";
    const fromPlaceholder = addSqlValue(values, isDateFilter ? dateValue : `${monthKey}-01`);
    const toPlaceholder = addSqlValue(
      values,
      isDateFilter ? dateValue : getMonthEndDateFromMonthKey(monthKey),
    );
    const stageMaterialReceiptDate = `nullif(stage_delivery.stage ->> 'materialReceiptDate', '')::date`;
    const stageJobCompletionDate = `nullif(stage_delivery.stage ->> 'actualJobCompletionDate', '')::date`;
    const physicalDelivery = deliveryInspectionApplicableSql();
    return `not ${isYesSql("f.demand_cancelled")}
	      and ${supplyOrderExists(
          `not ${isYesSql("so.so_cancelled")} and (
	          exists (
	            select 1
	            from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_delivery(stage)
	            where ${isYesSql("so.stage_delivery")}
	              and (
                (${physicalDelivery}
                  and ${stageMaterialReceiptDate} >= ${fromPlaceholder}::date
                  and ${stageMaterialReceiptDate} <= ${toPlaceholder}::date)
	                or (not (${physicalDelivery})
	                  and ${stageJobCompletionDate} >= ${fromPlaceholder}::date
	                  and ${stageJobCompletionDate} <= ${toPlaceholder}::date)
	              )
	          )
	          or (
	            not (${isYesSql("so.stage_delivery")}
	              and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)
	            and (
	              (${physicalDelivery}
                and so.material_receipt_date >= ${fromPlaceholder}::date
                and so.material_receipt_date <= ${toPlaceholder}::date)
	              or (not (${physicalDelivery})
                  and so.actual_job_completion_date >= ${fromPlaceholder}::date
                  and so.actual_job_completion_date <= ${toPlaceholder}::date)
	            )
	          )
	        )`,
        )}`;
  }
  if (filter.startsWith("completedDeliveryYear:")) {
    const yearKey = filter.slice("completedDeliveryYear:".length);
    const range = yearKey === "all" ? undefined : getReportFiscalYearDateRange(yearKey);
    if (yearKey !== "all" && !range) return "true";
    const stageMaterialReceiptDate = `nullif(stage_delivery.stage ->> 'materialReceiptDate', '')::date`;
    const stageJobCompletionDate = `nullif(stage_delivery.stage ->> 'actualJobCompletionDate', '')::date`;
    const physicalDelivery = deliveryInspectionApplicableSql();
    const dateRangeCondition = (dateExpression: string) => {
      if (yearKey === "all") return `${dateExpression} is not null`;
      const fromPlaceholder = addSqlValue(values, range!.start);
      const toPlaceholder = addSqlValue(values, range!.end);
      return `${dateExpression} >= ${fromPlaceholder}::date and ${dateExpression} <= ${toPlaceholder}::date`;
    };
    return `not ${isYesSql("f.demand_cancelled")}
	      and ${supplyOrderExists(
          `not ${isYesSql("so.so_cancelled")} and (
	          exists (
	            select 1
	            from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_delivery(stage)
	            where ${isYesSql("so.stage_delivery")}
	              and (
                (${physicalDelivery}
                  and ${dateRangeCondition(stageMaterialReceiptDate)})
	                or (not (${physicalDelivery})
	                  and ${dateRangeCondition(stageJobCompletionDate)})
	              )
	          )
	          or (
	            not (${isYesSql("so.stage_delivery")}
	              and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)
	            and (
	              (${physicalDelivery}
                and ${dateRangeCondition("so.material_receipt_date")})
	              or (not (${physicalDelivery})
	                and ${dateRangeCondition("so.actual_job_completion_date")})
	            )
	          )
	        )`,
        )}`;
  }
  if (filter.startsWith("bgExpiryMonth:")) {
    const [, category = "all", monthKey = ""] = filter.split(":");
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return "true";
    const fromPlaceholder = addSqlValue(values, `${monthKey}-01`);
    const toPlaceholder = addSqlValue(values, getMonthEndDateFromMonthKey(monthKey));
    const categories = category === "all" ? ["psb", "pwb", "psbpwb"] : [category];
    const categoryConditions = categories.filter(isBgStatusKey).map((item) => {
      const validityColumn = bgValidityColumn(item);
      const returnColumn = bgReturnColumn(item);
      return `(${bgCategorySql("so", item)}
          and ${bgReceivedOrderSql("so", item)}
          and not ${hasTextSql(`so.${returnColumn}`)}
          and so.${validityColumn} >= ${fromPlaceholder}::date
          and so.${validityColumn} <= ${toPlaceholder}::date)`;
    });
    if (!categoryConditions.length) return "true";
    return `not ${isYesSql("f.demand_cancelled")} and ${supplyOrderExists(
      `(${categoryConditions.join(" or ")})`,
    )}`;
  }
  if (filter.startsWith("bgExpiryDate:")) {
    const [, category = "all", date = ""] = filter.split(":");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "true";
    const datePlaceholder = addSqlValue(values, date);
    const categories = category === "all" ? ["psb", "pwb", "psbpwb"] : [category];
    const categoryConditions = categories.filter(isBgStatusKey).map((item) => {
      const validityColumn = bgValidityColumn(item);
      const returnColumn = bgReturnColumn(item);
      return `(${bgCategorySql("so", item)}
          and ${bgReceivedOrderSql("so", item)}
          and not ${hasTextSql(`so.${returnColumn}`)}
          and so.${validityColumn} = ${datePlaceholder}::date)`;
    });
    if (!categoryConditions.length) return "true";
    return `not ${isYesSql("f.demand_cancelled")} and ${supplyOrderExists(
      `(${categoryConditions.join(" or ")})`,
    )}`;
  }
  if (filter.startsWith("bgExpiryYear:")) {
    const [, category = "all", yearKey = ""] = filter.split(":");
    const range = yearKey === "all" ? undefined : getReportFiscalYearDateRange(yearKey);
    if (yearKey !== "all" && !range) return "true";
    const categories = category === "all" ? ["psb", "pwb", "psbpwb"] : [category];
    const dateRangeCondition = (validityColumn: string) => {
      if (yearKey === "all") return `${hasTextSql(`so.${validityColumn}`)}`;
      const fromPlaceholder = addSqlValue(values, range!.start);
      const toPlaceholder = addSqlValue(values, range!.end);
      return `so.${validityColumn} >= ${fromPlaceholder}::date
          and so.${validityColumn} <= ${toPlaceholder}::date`;
    };
    const categoryConditions = categories.filter(isBgStatusKey).map((item) => {
      const validityColumn = bgValidityColumn(item);
      const returnColumn = bgReturnColumn(item);
      return `(${bgCategorySql("so", item)}
          and ${bgReceivedOrderSql("so", item)}
          and not ${hasTextSql(`so.${returnColumn}`)}
          and ${dateRangeCondition(validityColumn)})`;
    });
    if (!categoryConditions.length) return "true";
    return `not ${isYesSql("f.demand_cancelled")} and ${supplyOrderExists(
      `(${categoryConditions.join(" or ")})`,
    )}`;
  }
  if (filter.startsWith("bgReceiptDelay:")) {
    const [, category = "all", rawDays = "0", rawNextDays] = filter.split(":");
    const days = Math.max(0, Number.parseInt(rawDays, 10) || 0);
    const parsedNextDays = rawNextDays ? Number.parseInt(rawNextDays, 10) : undefined;
    const nextDays = parsedNextDays !== undefined && Number.isInteger(parsedNextDays) && parsedNextDays > days
      ? parsedNextDays : undefined;
    const categories = category === "all" ? ["psb", "pwb", "psbpwb"] : [category];
    const categoryConditions = categories.filter(isBgStatusKey).map((item) => {
      return `(${bgCategorySql("so", item)}
        and not ${bgReceivedOrderSql("so", item)}
        and ${bgReceiptDelayBaseExpiredSql(item, days, nextDays)})`;
    });
    if (!categoryConditions.length) return "true";
    return `not ${isYesSql("f.demand_cancelled")} and ${supplyOrderExists(
      `not ${isYesSql("so.so_cancelled")}
       and (${categoryConditions.join(" or ")})`,
    )}`;
  }
  if (filter.startsWith("warrantyBgMismatch:")) {
    const [, category = "all", rawDays = "60"] = filter.split(":");
    const days = Number.parseInt(rawDays, 10);
    return warrantyBgMismatchSql(category, Number.isInteger(days) ? days : 60);
  }
  if (filter.startsWith("tcecStatusFy:")) return tcecStatusFyFilterSql(filter, values);
  if (filter.startsWith("tcecStatus:")) return tcecStatusFilterSql(filter, values);
  if (filter.startsWith("cncSummaryFy:")) return cncSummaryFyFilterSql(filter, values);
  if (filter.startsWith("cncSummary:")) return cncSummaryFilterSql(filter, values);
  if (filter.startsWith("fileCategory:")) {
    return fileCategorySql(normalizeFileCategories([filter.slice("fileCategory:".length)]));
  }
  if (filter.startsWith("fileType:")) {
    const placeholder = addSqlValue(
      values,
      decodeURIComponent(filter.slice("fileType:".length)).trim().toLowerCase(),
    );
    return `lower(trim(coalesce(f.file_type, ''))) = ${placeholder}`;
  }
  if (filter.startsWith("valueThreshold:")) {
    return valueThresholdFilterSql(filter, values, thresholdFinancialYear);
  }
  if (filter.startsWith("valueThresholdId:")) {
    return valueThresholdIdFilterSql(filter, values, thresholdFinancialYear);
  }
  if (filter.startsWith("valueThresholdRange:")) {
    return valueThresholdRangeFilterSql(filter, values);
  }
  if (filter.startsWith("valueThresholdTotal:")) return valueThresholdTotalFilterSql(filter);
  if (filter.startsWith("soValueThreshold:")) {
    return soValueThresholdFilterSql(filter, values, thresholdFinancialYear);
  }
  if (filter.startsWith("soValueThresholdTotal:")) return soValueThresholdTotalFilterSql(filter);
  if (filter.startsWith("mode:")) {
    const mode = decodeURIComponent(filter.slice(5)).trim().toUpperCase();
    if (mode === "UNASSIGNED") return `trim(coalesce(f.mode, '')) = ''`;
    const placeholder = addSqlValue(values, mode);
    return `upper(trim(coalesce(f.mode, ''))) = ${placeholder}`;
  }
  if (filter === "divisionTurnaroundSample") {
    const firstSoDate = earliestSupplyOrderDateSql("so_date");
    return nonNegativeDateDiffSql("f.received_date", firstSoDate);
  }
  if (filter.startsWith("manualMilestoneCurrent:")) {
    const milestone = filter.slice("manualMilestoneCurrent:".length);
    const normalized = normalizeMilestoneName(milestone);
    if (normalized === "bankguarantee") return bgToBeReceivedSql("psb");
    if (normalized === "payment") return paymentPendingSql({ includeReturnedUnpaid: true });
    if (normalized === "jobcompletion") return jobCompletionFilterSql("live");
    if (normalized === "supplementarybillreturnedforcorrection") {
      return supplementaryBillStatusSql("returned");
    }
    if (normalized === "refloatbidding") {
      return `not ${isCancelledFileSql()} and ${refloatBiddingInProgressSql()}`;
    }
    if (normalized === "refloatposttcec") {
      return `not ${isCancelledFileSql()} and ${isYesSql("f.refloat")} and ${isYesSql("f.tcec")} and ${isYesSql("f.bidding_stage_over")} and not ${hasTextSql("f.refloat_post_tcec_minutes_date")}`;
    }
    if (normalized === "bidding") {
      return `not ${isCancelledFileSql()} and ${biddingApplicableSql()} and not ${isYesSql("f.refloat")} and ${hasTextSql("f.cfa_date")} and not ${isYesSql("f.bidding_stage_over")}`;
    }
    if (isBgStatusKey(milestone)) return bgToBeReceivedSql(milestone);
    if (isSupplyOrderDrivenMilestoneName(milestone)) {
      return supplyOrderDrivenCurrentMilestoneSql(milestone, values);
    }
    const placeholder = addSqlValue(values, milestone);
    return `not ${isCancelledFileSql()} and f.current_milestone = ${placeholder}`;
  }
  if (filter.startsWith("manualMilestoneCompleted:")) {
    const milestone = filter.slice("manualMilestoneCompleted:".length);
    const normalized = normalizeMilestoneName(milestone);
    if (normalized === "bankguarantee") return bgReceivedSql("psb");
    if (isBgStatusKey(milestone)) return bgReceivedSql(milestone);
    if (normalized === "financialsanction") return financialSanctionCompletedSql();
    if (normalized === "payment") return paymentCompletedSql();
    if (normalized === "refloatbidding") {
      return `not ${isCancelledFileSql()} and ${isYesSql("f.refloat")} and ${isYesSql("f.bidding_stage_over")}`;
    }
    if (normalized === "refloatposttcec") {
      return `not ${isCancelledFileSql()} and ${isYesSql("f.refloat")} and ${isYesSql("f.tcec")} and ${hasTextSql("f.refloat_post_tcec_minutes_date")}`;
    }
    if (normalized === "bidding") {
      return `not ${isCancelledFileSql()} and ${biddingApplicableSql()} and not ${isYesSql("f.refloat")} and ${isYesSql("f.bidding_stage_over")}`;
    }
    if (isSupplyOrderDrivenMilestoneName(milestone)) {
      return supplyOrderDrivenCompletedMilestoneConditionSql(normalizeMilestoneName(milestone));
    }
    const placeholder = addSqlValue(values, milestone);
    return completedMilestoneExists(`completed.milestone = ${placeholder}`);
  }
  if (filter === "analyticsMilestoneClearing:billPreparation") {
    return analyticsBillPreparationContributorSql();
  }
  if (filter === "analyticsMilestoneClearing:billSentForPayment") {
    return supplyOrderDrivenCompletedMilestoneConditionSql("billsentforpayment", false, true);
  }
  if (filter === "totalFiles") return "true";
  if (filter === "demandsControlled") return hasTextSql("f.imms");
  if (filter === "tcecFiles") return isYesSql("f.tcec");
  if (filter === "nonTcecFiles") return isNoSql("f.tcec");
  if (filter === "highValueFiles") return isYesSql("f.high_value");
  if (filter === "adYes") return isYesSql("f.ad");
  if (filter === "rqaVetting") return isYesSql("f.rqa");
  if (filter === "ifaConcurrence") return isYesSql("f.ifa");
  if (filter === "liveBids")
    return `${biddingApplicableSql()} and not ${isYesSql("f.refloat")} and ${hasTextSql("f.cfa_date")} and not ${isYesSql(
      "f.bidding_stage_over",
    )} and ${hasTextSql("f.bid_date")} and ${hasTextSql("f.bid_opening_date")} and current_date between f.bid_date and f.bid_opening_date`;
  if (filter === "bidOverdue")
    return `${biddingApplicableSql()} and not ${isYesSql("f.refloat")} and ${hasTextSql("f.cfa_date")} and not ${isYesSql("f.bidding_stage_over")} and ${bidOpeningOverdueSql(today)}`;
  if (filter === "supplyOrders") return supplyOrderPlacedSql();
  if (filter === "liveSupplyOrders") return liveSupplyOrderSql();
  if (filter === "bgReceived") return bgReceivedSql("psb");
  if (filter === "bgToBeReceived") return bgToBeReceivedSql("psb");
  if (filter === "bgExpired") return bgExpiredSql("psb", today);
  if (filter === "bgToBeReturned") return bgReturnDueSql("psb", today);
  if (filter === "bgReturned") return bgReturnedSql("psb");
  if (filter.startsWith("bgExpired:")) {
    const category = filter.slice("bgExpired:".length);
    return isBgStatusKey(category) ? bgExpiredSql(category, today) : "true";
  }
  if (filter.startsWith("bgToBeReturned:")) {
    const category = filter.slice("bgToBeReturned:".length);
    return isBgStatusKey(category) ? bgReturnDueSql(category, today) : "true";
  }
  if (filter.startsWith("bgReturned:")) {
    const category = filter.slice("bgReturned:".length);
    return isBgStatusKey(category) ? bgReturnedSql(category) : "true";
  }
  if (filter === "dpExtension") return isYesSql("f.dp_extension");
  if (filter === "dpExpired") return supplyOrderExists(`${effectiveDpDateSql("so")} < ${today}`);
  if (filter === "deliveryOverdue") return deliveryJobFilterSql("overdue");
  if (filter === "deliveryDueToday")
    return `${deliveryInspectionApplicableSql()} and ${supplyOrderPlacedSql()} and ${deliveryDueOrderSql(
      `${effectiveDpDateSql("so")} = current_date`,
    )}`;
  if (filter === "deliveryUpcoming")
    return `${deliveryInspectionApplicableSql()} and ${supplyOrderPlacedSql()} and ${deliveryDueOrderSql(
      `${effectiveDpDateSql("so")} > current_date`,
    )}`;
  if (filter === "deliveryCompleted") return deliveryJobFilterSql("completed");
  if (filter === "deliveryDeliveredLate")
    return `${deliveryInspectionApplicableSql()} and ${supplyOrderPlacedSql()} and ${supplyOrderExists(
      `${hasTextSql("so.so_date")} and ${hasTextSql("so.material_receipt_date")} and ${effectiveDpDateSql("so")} is not null and so.material_receipt_date > ${effectiveDpDateSql("so")}`,
    )}`;
  if (filter === "deliveryDue") return deliveryJobFilterSql("pending");
  if (filter === "stageDeliveryFilter") return supplyOrderExists(isYesSql("so.stage_delivery"));
  if (filter === "status2AdvancePaymentPending") {
    return supplyOrderExists(
      `not ${isYesSql("so.so_cancelled")}
       and not ${isYesSql("so.no_further_action")}
       and ${isYesSql("so.advance_payment")}
       and ${normalizedSql("so.advance_payment_detail ->> 'currentMilestone'")} = 'advancepayment'
       and not ${hasTextSql("so.advance_payment_detail ->> 'paymentDate'")}`,
    );
  }
  if (filter === "jobCompletionCompleted") return jobCompletionCompletedFilterSql();
  if (filter === "jobCompletionDue" || filter === "jobCompletionLive")
    return jobCompletionFilterSql("live");
  if (filter === "jobCompletionPeriodOver") return jobCompletionFilterSql("periodOver");
  if (filter === "deliveryPeriodValid") return deliveryPeriodBucketSql("valid");
  if (filter === "deliveryPeriodExpired") return deliveryPeriodBucketSql("expired");
  if (filter === "deliveryPeriodExtended") return deliveryPeriodBucketSql("extended");
  if (filter === "deliveryPeriodLive")
    return `(${deliveryPeriodBucketSql("valid")} or ${deliveryPeriodBucketSql("extended")})`;
  if (filter === "status2DpPending") return status2DpPendingSql();
  if (filter === "status2MaterialReceiptPending") return status2MaterialReceiptPendingSql();
  if (filter === "status2DpExpired") return status2DpExpiredSql();
  if (filter === "irPreparationPending") return irStatusFilterSql("preparationPending");
  if (filter === "irReceiptPending") return irStatusFilterSql("receiptPending");
  if (filter === "irCompleted") return irStatusFilterSql("completed");
  if (filter === "paymentDue") return paymentPendingSql({ includeReturnedUnpaid: true });
  if (filter === "analyticsPaymentPending") return analyticsPaymentPendingSql();
  if (filter === "paymentDueOnly") return paymentBucketSql("due");
  if (filter === "paymentInProcess") return paymentBucketSql("inProcess");
  if (filter === "paymentSubmitted") return paymentBucketSql("submitted");
  if (filter === "paymentSubmittedNoReturn") return paymentBucketSql("submitted", true);
  if (filter === "advancePaymentFilter")
    return supplyOrderExists(
      isYesSql("so.advance_payment"),
    );
  if (filter === "advancePaid")
    return supplyOrderExists(
      `${isYesSql("so.advance_payment")}
       and not ${isYesSql("so.so_cancelled")}
       and ${hasTextSql("so.advance_payment_detail ->> 'paymentDate'")}`,
    );
  if (filter === "advancePending")
    return supplyOrderExists(
      `${isYesSql("so.advance_payment")}
       and not ${isYesSql("so.so_cancelled")}
       and not ${isYesSql("so.no_further_action")}
       and ${normalizedSql("so.advance_payment_detail ->> 'currentMilestone'")} = 'advancepayment'
       and not ${hasTextSql("so.advance_payment_detail ->> 'paymentDate'")}`,
    );
  if (filter === "stagePaymentFilter") return supplyOrderExists(isYesSql("so.stage_payment"));
  if (filter === "miscLiveFiles") return `not ${fileClosedSql()} and not ${isCancelledFileSql()}`;
  if (filter === "miscFileClosed") return fileClosedSql();
  if (filter === "miscLd") return supplyOrderExists(isYesSql("so.ld"));
  if (filter === "miscDemandCancelled") return isYesSql("f.demand_cancelled");
  if (filter === "miscSoCancelled") return supplyOrderExists(isYesSql("so.so_cancelled"));
  if (filter === "miscShortclosedSo") return supplyOrderExists(isYesSql("so.shortclosure"));
  if (filter === "miscMultipleSupplyOrders")
    return `(select count(*) from supply_orders so where so.file_id = f.id) > 1`;
  if (filter === "scrutinyCompleted") return hasTextSql("f.scrutiny_completion_date");
  if (filter === "scrutinyUnderProgress") return `not ${hasTextSql("f.scrutiny_date")}`;
  if (filter === "preTcecCompleted")
    return `${isYesSql("f.tcec")} and ${hasTextSql("f.pre_tcec_minutes_date")}`;
  if (filter === "preTcecRemaining")
    return `${isYesSql("f.tcec")} and not ${hasTextSql("f.pre_tcec_minutes_date")}`;
  if (filter === "highValueCompleted") return hasTextSql("f.high_value_minutes_date");
  if (filter === "highValueRemaining") return hasTextSql("f.high_value_meeting_date");
  if (filter === "adCompleted") return `${isYesSql("f.ad")} and ${hasTextSql("f.ad_vetting_date")}`;
  if (filter === "adRemaining")
    return `${isYesSql("f.ad")} and ${hasTextSql("f.pre_tcec_date")} and not ${hasTextSql("f.ad_vetting_date")}`;
  if (filter === "rqaCompleted") return hasTextSql("f.rqa_approval_date");
  if (filter === "rqaRemaining")
    return `${isYesSql("f.rqa")} and not ${hasTextSql("f.rqa_approval_date")}`;
  if (filter === "ifaCompleted") return hasTextSql("f.ifa_final_date");
  if (filter === "ifaRemaining") return hasTextSql("f.ifa_sent_date");
  if (filter === "cfaCompleted") return hasTextSql("f.cfa_date");
  if (filter === "soCompleted") return supplyOrderPlacedSql();
  if (filter === "soRemaining")
    return supplyOrderDrivenCurrentMilestoneConditionSql("'supplyorder'");
  return "true";
}

function isFinanceCarryForwardDashboardFilter(filter: string | undefined) {
  return filter?.trim().startsWith("financeCarryForward:") ?? false;
}

function financeCarryForwardFilterSql(filter: string, values: unknown[]) {
  const [, mode = "", rawSelectedYear = "", rawSourceYear = ""] = filter.split(":");
  const selectedYear = decodeFilterPart(rawSelectedYear).trim();
  const sourceYear = decodeFilterPart(rawSourceYear).trim();
  const selectedRange = getFinancialYearDateRange(selectedYear);
  const sourceRange = getFinancialYearDateRange(sourceYear);
  if (
    !selectedRange ||
    !sourceRange ||
    ![
      "carryForward",
      "clearedCarryForward",
      "previousCarryForward",
      "futureClearedCarryForward",
    ].includes(mode)
  ) {
    return "false";
  }

  let selectedStartPlaceholder: string | undefined;
  let selectedEndPlaceholder: string | undefined;
  let sourceStartPlaceholder: string | undefined;
  let sourceEndPlaceholder: string | undefined;
  const selectedStart = () =>
    (selectedStartPlaceholder ??= `${addSqlValue(values, selectedRange.start)}::date`);
  const selectedEnd = () =>
    (selectedEndPlaceholder ??= `${addSqlValue(values, selectedRange.end)}::date`);
  const sourceStart = () =>
    (sourceStartPlaceholder ??= `${addSqlValue(values, sourceRange.start)}::date`);
  const sourceEnd = () =>
    (sourceEndPlaceholder ??= `${addSqlValue(values, sourceRange.end)}::date`);
  const selectedYearStart = Number(selectedRange.start.slice(0, 4));
  const sourceYearStart = Number(sourceRange.start.slice(0, 4));

  const paymentCondition = (paymentDate: string) => {
    if (mode === "carryForward") {
      return `${sourceYearStart === selectedYearStart ? "true" : "false"}
        and (${paymentDate} is null or ${paymentDate} > ${selectedEnd()})`;
    }
    if (mode === "clearedCarryForward") {
      return `${sourceYearStart < selectedYearStart ? "true" : "false"}
        and ${paymentDate} between ${selectedStart()} and ${selectedEnd()}`;
    }
    if (mode === "futureClearedCarryForward") {
      return `${sourceYearStart > selectedYearStart ? "true" : "false"}
        and ${paymentDate} between ${sourceStart()} and ${sourceEnd()}
        and ${paymentDate} > ${selectedEnd()}`;
    }
    return `${sourceYearStart < selectedYearStart ? "true" : "false"}
      and (${paymentDate} is null or ${paymentDate} > ${selectedEnd()})`;
  };

  const orderSourceYearCondition =
    mode === "futureClearedCarryForward"
      ? `so.so_date between ${selectedStart()} and ${selectedEnd()}`
      : `so.so_date between ${sourceStart()} and ${sourceEnd()}`;
  const orderPaymentDate = `so.payment_date`;
  const stagePaymentDate = `nullif(stage_row.stage ->> 'paymentDate', '')::date`;
  const supplementaryPaymentDate = `nullif(supplementary_bill.bill ->> 'paymentDate', '')::date`;
  const advancePaymentDate = `nullif(so.advance_payment_detail ->> 'paymentDate', '')::date`;

  return supplyOrderExists(`not ${isYesSql("so.so_cancelled")} and (
    (
      not (${isYesSql("so.stage_delivery")} and ${isYesSql("so.stage_payment")})
      and ${orderSourceYearCondition}
      and ${paymentCondition(orderPaymentDate)}
    )
    or exists (
      select 1
      from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) with ordinality as stage_row(stage, ordinality)
      where ${isYesSql("so.stage_delivery")}
        and ${isYesSql("so.stage_payment")}
        and ${orderSourceYearCondition}
        and ${paymentCondition(stagePaymentDate)}
    )
    or exists (
      select 1
      from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
      where ${orderSourceYearCondition}
        and (
          ${hasTextSql("supplementary_bill.bill ->> 'billSentForPaymentDate'")}
          or ${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")}
          or exists (
            select 1
            from jsonb_array_elements(coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)) as supplementary_return_cycle(cycle)
            where ${hasTextSql("supplementary_return_cycle.cycle ->> 'returnedDate'")}
               or ${hasTextSql("supplementary_return_cycle.cycle ->> 'resubmittedDate'")}
          )
        )
        and ${paymentCondition(supplementaryPaymentDate)}
    )
    or (
      ${isYesSql("so.advance_payment")}
      and ${orderSourceYearCondition}
      and ${paymentCondition(advancePaymentDate)}
    )
  )`);
}

function getSortSql(sortColumnKey: string | undefined, direction: "asc" | "desc") {
  const dir = direction === "desc" ? "desc" : "asc";
  if (!sortColumnKey || sortColumnKey === "none") return "";
  if (sortColumnKey === "division") return `lower(coalesce(d.name, '')) ${dir}`;
  if (sortColumnKey === "noOfSo") {
    return `(select count(*) from supply_orders so where so.file_id = f.id and ${hasTextSql(
      "so.so_date",
    )}) ${dir}`;
  }
  if (
    sortColumnKey === "bqFirms" ||
    sortColumnKey === "invitedFirms" ||
    sortColumnKey === "bidderFirms"
  ) {
    const type =
      sortColumnKey === "bqFirms" ? "bq" : sortColumnKey === "invitedFirms" ? "invited" : "bidder";
    return `(select count(*) from file_firms ff where ff.file_id = f.id and ff.firm_type = '${type}' and (${hasTextSql(
      "ff.firm_name",
    )} or ${hasTextSql("ff.city")} or ${hasTextSql("ff.address")} or ${hasTextSql(
      "ff.email_id",
    )} or ${hasTextSql("ff.firm_unique_no")} or ${hasTextSql("ff.contact_no")})) ${dir}`;
  }
  const supplyColumn =
    supplyOrderSearchColumns[sortColumnKey as keyof typeof supplyOrderSearchColumns];
  if (supplyColumn) return `lower(coalesce(${supplyOrderTextExpression(supplyColumn)}, '')) ${dir}`;
  const column = fileSearchColumns[sortColumnKey as keyof typeof fileSearchColumns];
  if (!column) return "";
  return `lower(coalesce(${column}::text, '')) ${dir}`;
}

type FirmSearchScope = "bq" | "invited" | "bidder" | "so";

const defaultFirmSearchScopes: FirmSearchScope[] = ["bq", "invited", "bidder", "so"];

function normalizeFirmSearchScopes(scopes: string[] | undefined): FirmSearchScope[] {
  const allowed = new Set<FirmSearchScope>(defaultFirmSearchScopes);
  const normalized = (scopes ?? [])
    .map((scope) => scope.trim().toLowerCase())
    .filter((scope): scope is FirmSearchScope => allowed.has(scope as FirmSearchScope));
  return normalized.length ? Array.from(new Set(normalized)) : defaultFirmSearchScopes;
}

function firmDetailsExists(type: "bq" | "invited" | "bidder", condition: string) {
  return `exists (
    select 1
    from file_firms ff
    where ff.file_id = f.id and ff.firm_type = '${type}' and ${condition}
  )`;
}

function firmSearchSql(
  scopes: FirmSearchScope[],
  field: "firmName" | "firmUniqueNo" | "contactNo" | "city",
  placeholder: string,
  exact = false,
) {
  const firmColumns = {
    firmName: "ff.firm_name",
    firmUniqueNo: "ff.firm_unique_no",
    contactNo: "ff.contact_no",
    city: "ff.city",
  };
  const soColumns = {
    firmName: "so.firm",
    firmUniqueNo: "so.firm_unique_no",
    contactNo: "so.firm_contact_no",
    city: "so.firm_city",
  };
  const parts = scopes.flatMap((scope) => {
    const comparison = (column: string) =>
      exact
        ? `lower(trim(coalesce(${column}, ''))) = lower(trim(${placeholder}))`
        : `lower(coalesce(${column}, '')) like ${placeholder}`;
    if (scope === "so") {
      return [
        supplyOrderExists(comparison(soColumns[field])),
        field === "firmName" ? comparison("f.firm") : "",
      ].filter(Boolean);
    }
    return [
      `${biddingApplicableSql()} and ${firmDetailsExists(
        scope,
        comparison(firmColumns[field]),
      )}`,
    ];
  });
  return parts.length ? `(${parts.join(" or ")})` : "false";
}

function firmIdentitySearchSql(
  scopes: FirmSearchScope[],
  firmNamePlaceholder: string,
  firmUniqueNoPlaceholder: string,
) {
  const identityMatch = (nameColumn: string, uniqueNoColumn: string) => {
    const normalizedName = `lower(trim(coalesce(${nameColumn}, '')))`;
    const normalizedUniqueNo = `lower(trim(coalesce(${uniqueNoColumn}, '')))`;
    return `(
      (${firmUniqueNoPlaceholder} <> '' and ${normalizedUniqueNo} = lower(trim(${firmUniqueNoPlaceholder})))
      or (${firmNamePlaceholder} <> '' and ${normalizedUniqueNo} = '' and ${normalizedName} = lower(trim(${firmNamePlaceholder})))
    )`;
  };
  const parts = scopes.flatMap((scope) => {
    if (scope === "so") {
      return [
        supplyOrderExists(identityMatch("so.firm", "so.firm_unique_no")),
        `(${firmNamePlaceholder} <> '' and lower(trim(coalesce(f.firm, ''))) = lower(trim(${firmNamePlaceholder})))`,
      ];
    }
    return [
      `${biddingApplicableSql()} and ${firmDetailsExists(
        scope,
        identityMatch("ff.firm_name", "ff.firm_unique_no"),
      )}`,
    ];
  });
  return parts.length ? `(${parts.join(" or ")})` : "false";
}

type FirmAnalysisRole = "bq" | "invited" | "participated" | "order";
type FirmAnalysisOperator = "and" | "or";

function isFirmAnalysisRole(value: string): value is FirmAnalysisRole {
  return value === "bq" || value === "invited" || value === "participated" || value === "order";
}

function isFirmAnalysisOperator(value: string): value is FirmAnalysisOperator {
  return value === "and" || value === "or";
}

function firmAnalysisRoleSql(role: FirmAnalysisRole, firmName: string, values: unknown[]) {
  const placeholder = addSqlValue(values, firmName.trim().toLowerCase());
  const firmDetailCondition = (type: "bq" | "invited" | "bidder") =>
    `${biddingApplicableSql()} and ${firmDetailsExists(
      type,
      `lower(trim(coalesce(ff.firm_name, ''))) = ${placeholder}`,
    )}`;
  const orderCondition = supplyOrderExists(`lower(trim(coalesce(so.firm, ''))) = ${placeholder}`);
  if (role === "bq") return firmDetailCondition("bq");
  if (role === "invited") return firmDetailCondition("invited");
  if (role === "participated") return firmDetailCondition("bidder");
  return orderCondition;
}

function firmAnalysisPresenceSql(firmName: string, values: unknown[]) {
  const roleSql = (["bq", "invited", "participated", "order"] as FirmAnalysisRole[]).map((role) =>
    firmAnalysisRoleSql(role, firmName, values),
  );
  return `(${roleSql.join(" or ")})`;
}

function parseFirmAnalysisRoleToken(token: string) {
  const negated = token.startsWith("not.");
  const role = negated ? token.slice("not.".length) : token;
  return isFirmAnalysisRole(role) ? { role, negated } : undefined;
}

function firmAnalysisExpressionSql(rawExpression: string, firmName: string, values: unknown[]) {
  const tokens = rawExpression
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  const first = parseFirmAnalysisRoleToken(tokens[0]);
  if (!first) return "false";
  const roleSql = (token: { role: FirmAnalysisRole; negated: boolean }) => {
    const sql = firmAnalysisRoleSql(token.role, firmName, values);
    return token.negated ? `(not ${sql})` : sql;
  };
  let sql = roleSql(first);
  for (let index = 1; index < tokens.length; index += 2) {
    const operator = tokens[index];
    const role = parseFirmAnalysisRoleToken(tokens[index + 1] ?? "");
    if (!isFirmAnalysisOperator(operator) || !role) break;
    sql = `(${sql} ${operator} ${roleSql(role)})`;
  }
  return `(${firmAnalysisPresenceSql(firmName, values)} and ${sql})`;
}

function firmAnalysisFilterSql(filter: string, values: unknown[]) {
  const [, rawMode = "or", rawRoles = "", rawFirm = ""] = filter.split(":");
  const mode = rawMode === "and" ? "and" : "or";
  const firmName = decodeFilterPart(rawFirm).trim();
  if (!firmName) return "false";
  if (rawMode === "expr") return firmAnalysisExpressionSql(rawRoles, firmName, values);
  const roleSql = rawRoles
    .split(",")
    .map((role) => role.trim())
    .filter(isFirmAnalysisRole)
    .map((role) => firmAnalysisRoleSql(role, firmName, values));
  if (!roleSql.length) return "false";
  return `(${roleSql.join(mode === "and" ? " and " : " or ")})`;
}

function status4FilterSql(filter: string, values: unknown[]) {
  const [
    ,
    rawMilestone = "",
    rawMetric = "current",
    rawFiscalYear = "",
    rawMonthKey = "all",
    rawMin = "",
    rawMax = "",
  ] = filter.split(":");
  const milestone = decodeFilterPart(rawMilestone);
  const metric = isStatus4MetricKey(rawMetric) ? rawMetric : "current";
  const fiscalYear = decodeFilterPart(rawFiscalYear).trim();
  const monthKey = decodeFilterPart(rawMonthKey).trim();
  const minValue = parseSearchAmount(rawMin);
  const maxValue = parseSearchAmount(rawMax);
  const conditions: string[] = [];
  if (fiscalYear && fiscalYear !== "all") {
    if (fiscalYear === "undated") {
      conditions.push(`f.received_date is null`);
    } else {
      const range = getFinancialYearDateRange(fiscalYear);
      if (!range) return "false";
      const start = addSqlValue(values, range.start);
      const end = addSqlValue(values, range.end);
      conditions.push(`f.received_date between ${start}::date and ${end}::date`);
    }
  }
  if (monthKey && monthKey !== "all") {
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return "false";
    const placeholder = addSqlValue(values, `${monthKey}%`);
    conditions.push(`to_char(f.received_date, 'YYYY-MM') like ${placeholder}`);
  }
  if (minValue !== undefined || maxValue !== undefined) {
    const amount = `(coalesce(${inrAmountExpression("f.value_capital")}, 0) + coalesce(${inrAmountExpression(
      "f.value_revenue",
    )}, 0))`;
    conditions.push(
      `(f.value_capital is not null or f.value_revenue is not null)
       ${minValue !== undefined ? `and ${amount} >= ${addSqlValue(values, minValue)}` : ""}
       ${maxValue !== undefined ? `and ${amount} <= ${addSqlValue(values, maxValue)}` : ""}`,
    );
  }
  const milestoneSql = status4MetricSql(milestone, metric, values);
  if (!milestoneSql) return "false";
  conditions.push(milestoneSql);
  return conditions.length
    ? conditions.map((condition) => `(${condition})`).join(" and ")
    : "false";
}

type Status4MetricKey = "applicable" | "cleared" | "current";

function isStatus4MetricKey(value: string): value is Status4MetricKey {
  return value === "applicable" || value === "cleared" || value === "current";
}

function status4MetricSql(milestoneName: string, metric: Status4MetricKey, values: unknown[]) {
  const normalized = normalizeMilestoneName(milestoneName);
  if (!normalized) return undefined;
  const milestone = statusSummaryMilestones.find(
    (item) =>
      normalizeMilestoneName(item.label) === normalized || item.key.toLowerCase() === normalized,
  );
  if (metric === "applicable") {
    if (normalized === "financialsanction" || normalized === "supplyorder") return "true";
    return milestone ? milestoneAppliesSql(milestone) : "true";
  }
  if (metric === "cleared") {
    if (normalized === "financialsanction") return status4FinancialSanctionClearedSql();
    if (normalized === "supplyorder") return status4SupplyOrderClearedSql();
    return milestone
      ? `${milestoneAppliesSql(milestone)} and ${milestoneCompleteSql(milestone)}`
      : "false";
  }
  if (normalized === "bankguarantee") return bgToBeReceivedSql("psb");
  if (normalized === "payment") return paymentPendingSql();
  if (normalized === "jobcompletion") return jobCompletionFilterSql("live");
  if (normalized === "refloatbidding") {
    return `not ${isCancelledFileSql()} and ${refloatBiddingInProgressSql()}`;
  }
  if (normalized === "refloatposttcec") {
    return `not ${isCancelledFileSql()} and ${isYesSql("f.refloat")} and ${isYesSql("f.tcec")} and ${isYesSql("f.bidding_stage_over")} and not ${hasTextSql("f.refloat_post_tcec_minutes_date")}`;
  }
  if (isBgStatusKey(milestoneName)) return bgToBeReceivedSql(milestoneName);
  if (normalized === "supplyorder") {
    return `not ${fileClosedSql()} and ${supplyOrderDrivenCurrentMilestoneSql(milestoneName, values)}`;
  }
  if (isSupplyOrderDrivenMilestoneName(milestoneName)) {
    return `not ${fileClosedSql()} and ${supplyOrderDrivenCurrentMilestoneSql(milestoneName, values)}`;
  }
  if (normalized === "bidding") {
    return `not ${isCancelledFileSql()} and ${biddingApplicableSql()} and not ${isYesSql("f.refloat")} and ${hasTextSql("f.cfa_date")} and not ${isYesSql("f.bidding_stage_over")}`;
  }
  const placeholder = addSqlValue(values, milestoneName);
  return `not ${isCancelledFileSql()} and f.current_milestone = ${placeholder}`;
}

function status4FinancialSanctionClearedSql() {
  return `(${completedMilestoneExists(
    `${normalizedSql("completed.milestone")} = 'financialsanction'`,
  )} or ${supplyOrderExists(
    `${hasTextSql("so.financial_sanction_date")}
      or exists (
        select 1
        from jsonb_array_elements_text(coalesce(so.completed_milestones, '[]'::jsonb)) as completed_order(milestone)
        where ${normalizedSql("completed_order.milestone")} = 'financialsanction'
      )`,
  )})`;
}

function status4SupplyOrderClearedSql() {
  return `(${completedMilestoneExists(
    `${normalizedSql("completed.milestone")} = 'supplyorder'`,
  )} or ${supplyOrderExists(hasTextSql("so.so_date"))})`;
}

const dateFilterKeys = new Set([
  "demandReceipt",
  "demandControl",
  "highValueMinutes",
  "preTcecDate",
  "preTcecMinutes",
  "rqaApproval",
  "ifaFinal",
  "cfaApproval",
  "postTcecDate",
  "postTcecMinutes",
  "cncDate",
  "preBidDate",
  "biddingDate",
  "bidOpeningDate",
  "financialSanction",
  "soDate",
  "advanceExpectedPaymentDate",
  "dpPeriod",
  "materialReceipt",
  "actualJobCompletion",
  "bgReceived",
  "bgValidity",
  "bgReturn",
  "billSubmitted",
  "paymentDate",
  "fileClosure",
]);

function buildSearchSql(
  baseConditions: string[],
  baseValues: unknown[],
  params: FileSearchParams,
  query: Record<string, unknown>,
  thresholdFinancialYear?: string | undefined,
): SearchSql {
  const conditions = [...baseConditions];
  const values = [...baseValues];
  const includeModes = firstOnlyQueryList(params.includeModes, params.selectedModes);
  const excludeModes = params.excludeModes ?? [];
  const selectedModes = [...includeModes, ...excludeModes];
  const includeGemBiddingModes = firstOnlyQueryList(
    params.includeGemBiddingModes,
    params.selectedGemBiddingModes,
  );
  const excludeGemBiddingModes = params.excludeGemBiddingModes ?? [];
  const selectedGemBiddingModes = [...includeGemBiddingModes, ...excludeGemBiddingModes];
  const selectedFirmTypes = params.selectedFirmTypes ?? [];
  const firmSearchScopes = normalizeFirmSearchScopes(params.firmSearchScopes);
  const selectedFileTypes = params.selectedFileTypes ?? [];
  const selectedBgCoverageTypes = params.selectedBgCoverageTypes ?? [];
  const fileCategories = params.fileCategories;
  const dateFilterModes = new Map(
    (params.dateFilterModes ?? []).flatMap((entry) => {
      const [key, mode] = entry.split(":");
      return dateFilterKeys.has(key) && (mode === "only" || mode === "exclude")
        ? [[key, mode] as const]
        : [];
    }),
  );
  const withDateFilterMode = (
    key: string,
    from: string | undefined,
    to: string | undefined,
    rangeCondition: string | undefined,
    presenceCondition: string,
  ) => {
    const mode = dateFilterModes.get(key);
    const hasRange = isValidDate(from) || isValidDate(to);
    if (!mode) return rangeCondition;
    if (!hasRange) {
      return mode === "only"
        ? presenceCondition
        : `not coalesce((${presenceCondition}), false)`;
    }
    if (mode === "only") return rangeCondition;
    return `(${presenceCondition} and not coalesce((${rangeCondition}), false))`;
  };
  const page = readPositiveInteger(query.page, 1, 1_000_000);
  const pageSize = readPositiveInteger(query.pageSize, 100, 500);
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  const dashboardFilters = [params.dashboardFilter, ...(params.extraDashboardFilters ?? [])]
    .map((filter) => filter?.trim())
    .filter((filter): filter is string => Boolean(filter));
  const directFileIdDrilldown = dashboardFilters.some(isFileIdsDashboardFilter);
  const selectedYear = normalizeFinancialYearLabel(readQueryString(query.selectedYear));
  const includeCancelledForYearSearch =
    dashboardFilters.length === 0 &&
    params.analyticsType !== "indentor" &&
    (selectedYear === allFilesYear || Boolean(getReportFiscalYearDateRange(selectedYear)));

  if (params.anomalyPresenceFilter) {
    if (!params.anomalyFileIdsReady) {
      conditions.push("false");
    } else {
      const anomalyIds = params.anomalyFileIds ?? [];
      if (anomalyIds.length) {
        const placeholder = addSqlValue(values, anomalyIds);
        const hasAnomalySql = `f.id::text = any(${placeholder}::text[])`;
        conditions.push(
          params.anomalyPresenceFilter === "has" ? hasAnomalySql : `not (${hasAnomalySql})`,
        );
      } else if (params.anomalyPresenceFilter === "has") {
        conditions.push("false");
      }
    }
  }

  if (params.yearFilter?.trim()) {
    const placeholder = addSqlValue(values, sqlLike(params.yearFilter));
    conditions.push(`lower(coalesce(f.year, '')) like ${placeholder}`);
  }
  if (!directFileIdDrilldown && params.fileYear?.trim() && params.fileYear.trim() !== "all") {
    const placeholder = addSqlValue(values, params.fileYear.trim());
    conditions.push(`f.year = ${placeholder}::text`);
  }
  if (!directFileIdDrilldown && params.fileInitiationFrom) {
    const placeholder = addSqlValue(values, params.fileInitiationFrom);
    conditions.push(`f.received_date >= ${placeholder}::date`);
  }
  if (!directFileIdDrilldown && params.fileInitiationTo) {
    const placeholder = addSqlValue(values, params.fileInitiationTo);
    conditions.push(`f.received_date <= ${placeholder}::date`);
  }
  if (!directFileIdDrilldown && fileCategories) conditions.push(fileCategorySql(fileCategories));
  const excludedDashboardFilters = (params.excludeDashboardFilters ?? [])
    .map((filter) => filter?.trim())
    .filter((filter): filter is string => Boolean(filter));
  if (!includeCancelledForYearSearch && !shouldShowDemandCancelledFiles(params)) {
    conditions.push(`not ${isYesSql("f.demand_cancelled")}`);
  }
  if (!includeCancelledForYearSearch && !shouldShowCancelledSupplyOrderFiles(params)) {
    conditions.push(`not ${allSupplyOrdersCancelledSql()}`);
  }
  const firmOriginatedSearch = isFirmOriginatedSearch(params);
  if (dashboardFilters.length) {
    if (
      !firmOriginatedSearch &&
      !params.milestoneClearingScope &&
      dashboardFilters.every((filter) => !shouldAllowInactiveDashboardFilter(filter))
    ) {
      conditions.push(`not ${isCancelledFileSql()}`);
    }
    dashboardFilters.forEach((filter) => {
      conditions.push(`(${dashboardFilterSql(filter, values, thresholdFinancialYear)})`);
    });
  }
  excludedDashboardFilters.forEach((filter) => {
    conditions.push(`not (${dashboardFilterSql(filter, values, thresholdFinancialYear)})`);
  });
  const analyticsNames = (params.analyticsNames ?? [])
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (analyticsNames.length && params.analyticsType === "indentor") {
    const placeholder = addSqlValue(values, analyticsNames);
    conditions.push(
      `lower(coalesce(nullif(trim(f.indentor), ''), 'Unassigned indentor')) = any(${placeholder}::text[])`,
    );
  }
  if (analyticsNames.length && params.analyticsType === "firm") {
    const placeholder = addSqlValue(values, analyticsNames);
    const supplyOrderValue = `(coalesce(${inrAmountExpression("so.so_value_capital")}, 0) + coalesce(${inrAmountExpression("so.so_value_revenue")}, 0))`;
    conditions.push(
      supplyOrderExists(
        `lower(coalesce(nullif(trim(so.firm), ''), 'Unassigned firm')) = any(${placeholder}::text[])
         and ${supplyOrderValue} > 0`,
      ),
    );
  }
  if (params.indentor?.trim()) {
    const placeholder = addSqlValue(values, sqlLike(params.indentor));
    conditions.push(`lower(coalesce(f.indentor, '')) like ${placeholder}`);
  }
  if (params.divisionFilter?.trim()) {
    const placeholder = addSqlValue(values, sqlLike(params.divisionFilter));
    conditions.push(`lower(coalesce(d.name, '')) like ${placeholder}`);
  }
  if (params.description?.trim()) {
    const placeholder = addSqlValue(values, sqlLike(params.description));
    conditions.push(`lower(coalesce(f.demand_description, '')) like ${placeholder}`);
  }
  if (params.firm?.trim()) {
    const placeholder = addSqlValue(values, sqlLike(params.firm));
    conditions.push(firmSearchSql(firmSearchScopes, "firmName", placeholder));
  }
  if (params.firmIdentityUniqueNo?.trim() || params.firmIdentityName?.trim()) {
    const uniqueNoPlaceholder = addSqlValue(values, params.firmIdentityUniqueNo?.trim() ?? "");
    const namePlaceholder = addSqlValue(values, params.firmIdentityName?.trim() ?? "");
    conditions.push(firmIdentitySearchSql(firmSearchScopes, namePlaceholder, uniqueNoPlaceholder));
  }
  if (params.firmUniqueNo?.trim()) {
    const placeholder = addSqlValue(values, sqlLike(params.firmUniqueNo));
    conditions.push(firmSearchSql(firmSearchScopes, "firmUniqueNo", placeholder));
  }
  if (params.firmContactNo?.trim()) {
    const placeholder = addSqlValue(values, sqlLike(params.firmContactNo));
    conditions.push(firmSearchSql(firmSearchScopes, "contactNo", placeholder));
  }
  if (params.firmCity?.trim()) {
    const placeholder = addSqlValue(values, sqlLike(params.firmCity));
    conditions.push(firmSearchSql(firmSearchScopes, "city", placeholder));
  }
  applyIncludeExcludeSql(conditions, params.soPresenceFilter, supplyOrderExists("true"));
  if (includeModes.length) {
    const placeholder = addSqlValue(
      values,
      includeModes.map((mode) => mode.trim().toUpperCase()),
    );
    conditions.push(`upper(trim(coalesce(f.mode, ''))) = any(${placeholder}::text[])`);
  }
  if (excludeModes.length) {
    const placeholder = addSqlValue(
      values,
      excludeModes.map((mode) => mode.trim().toUpperCase()),
    );
    conditions.push(`not (upper(trim(coalesce(f.mode, ''))) = any(${placeholder}::text[]))`);
  }
  if (!includeModes.length && !excludeModes.length && selectedModes.length) {
    const placeholder = addSqlValue(
      values,
      selectedModes.map((mode) => mode.trim().toUpperCase()),
    );
    applyIncludeExcludeSql(
      conditions,
      params.modePresenceFilter ?? "include",
      `upper(trim(coalesce(f.mode, ''))) = any(${placeholder}::text[])`,
    );
  }
  if (includeGemBiddingModes.length) {
    const placeholder = addSqlValue(
      values,
      includeGemBiddingModes.map((mode) => mode.trim().toLowerCase()),
    );
    conditions.push(
      `${isYesSql("f.gem")} and lower(trim(coalesce(f.gem_bidding_mode, ''))) = any(${placeholder}::text[])`,
    );
  }
  if (excludeGemBiddingModes.length) {
    const placeholder = addSqlValue(
      values,
      excludeGemBiddingModes.map((mode) => mode.trim().toLowerCase()),
    );
    conditions.push(
      `not (${isYesSql("f.gem")} and lower(trim(coalesce(f.gem_bidding_mode, ''))) = any(${placeholder}::text[]))`,
    );
  }
  if (
    !includeGemBiddingModes.length &&
    !excludeGemBiddingModes.length &&
    selectedGemBiddingModes.length
  ) {
    const placeholder = addSqlValue(
      values,
      selectedGemBiddingModes.map((mode) => mode.trim().toLowerCase()),
    );
    applyIncludeExcludeSql(
      conditions,
      params.gemModePresenceFilter ?? "include",
      `${isYesSql("f.gem")} and lower(trim(coalesce(f.gem_bidding_mode, ''))) = any(${placeholder}::text[])`,
    );
  }
  if (selectedFirmTypes.length) {
    const normalizedFirmTypes = selectedFirmTypes.map((firmType) => firmType.trim().toUpperCase());
    const placeholder = addSqlValue(values, normalizedFirmTypes);
    conditions.push(
      supplyOrderExists(`${effectiveFirmTypeSql("so")} = any(${placeholder}::text[])`),
    );
  }
  const fileTypeSql = selectedFileTypesSql(selectedFileTypes, values);
  if (fileTypeSql) conditions.push(fileTypeSql);
  if (selectedBgCoverageTypes.length) {
    const placeholder = addSqlValue(values, selectedBgCoverageTypes);
    conditions.push(
      supplyOrderExists(`trim(coalesce(so.bg_coverage_type, '')) = any(${placeholder}::text[])`),
    );
  }
  const selectedSpecialFileMarkers = [
    ...(params.specialFileMarkers ?? []),
    ...(params.specialFileMarker?.trim() ? [params.specialFileMarker] : []),
  ]
    .map((marker) => marker.trim().toUpperCase())
    .filter(Boolean);
  if (selectedSpecialFileMarkers.length > 0) {
    const placeholder = addSqlValue(values, selectedSpecialFileMarkers);
    conditions.push(`exists (
      select 1 from file_markers fm
      where fm.file_id = f.id and upper(trim(coalesce(fm.text, ''))) = any(${placeholder}::text[])
    )`);
  }
  if (params.advancePaymentFilter) {
    conditions.push(
      supplyOrderExists(
        isYesSql("so.advance_payment"),
      ),
    );
  }
  if (params.actualPaymentFilter) {
    conditions.push(
      supplyOrderExists(
        `(coalesce(so.actual_payment_capital, 0) <> 0
          or coalesce(so.actual_payment_revenue, 0) <> 0
          or exists (
            select 1
            from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
            where ${inrAmountExpression("supplementary_bill.bill ->> 'actualPaymentCapital'")} <> 0
               or ${inrAmountExpression("supplementary_bill.bill ->> 'actualPaymentRevenue'")} <> 0
          ))`,
      ),
    );
  }
  if (params.stageDeliveryFilter) {
    conditions.push(supplyOrderExists(isYesSql("so.stage_delivery")));
  }
  if (params.stagePaymentFilter) {
    conditions.push(supplyOrderExists(isYesSql("so.stage_payment")));
  }
  if (params.dpExtensionFilter) {
    conditions.push(supplyOrderChildSql(isYesSql("so.dp_extension"), isYesSql("f.dp_extension")));
  }
  if (params.ldFilter) {
    conditions.push(supplyOrderChildSql(isYesSql("so.ld"), isYesSql("f.ld")));
  }
  if (params.highValue) conditions.push(isYesSql("f.high_value"));
  if (params.gte) conditions.push(isYesSql("f.gte"));
  if (params.ad) conditions.push(isYesSql("f.ad"));
  if (params.rqa) conditions.push(isYesSql("f.rqa"));
  if (params.ifaFilter) conditions.push(isYesSql("f.ifa"));
  applyIncludeExcludeSql(conditions, params.ifaPresenceFilter, isYesSql("f.ifa"));
  if (params.psbFilter) {
    conditions.push(
      supplyOrderExists(
        `${isYesSql("so.psb_applicable")}
         and not ${isYesSql("so.so_cancelled")}
         and trim(coalesce(so.bg_coverage_type, '')) in ('PSB', 'PSB and PWB separately')`,
      ),
    );
  }
  if (params.pwbFilter) {
    conditions.push(
      supplyOrderExists(
        `${isYesSql("f.bg")} and trim(coalesce(so.bg_coverage_type, '')) in ('PWB', 'PSB and PWB separately')`,
      ),
    );
  }
  if (params.psbPwbFilter) {
    conditions.push(
      supplyOrderExists(
        `${isYesSql("f.bg")} and trim(coalesce(so.bg_coverage_type, '')) = 'PSB+PWB'`,
      ),
    );
  }
  if (params.bgFilter) conditions.push(isYesSql("f.bg"));
  if (params.rfpVettingFilter) conditions.push(isYesSql("f.rfp_vetting"));
  if (params.refloat) {
    conditions.push(
      `(${isYesSql("f.refloat")} or ${fileHasAny([
        "refloatBiddingDate",
        "refloatBidOpeningDate",
        "refloatPostTcecDate",
        "refloatPostTcecMinutesDate",
      ])})`,
    );
  }
  if (params.cnc) conditions.push(fileHasAny(["cncDate", "cncApprovalDate"]));
  applyIncludeExcludeSql(
    conditions,
    params.cncPresenceFilter,
    fileHasAny(["cncDate", "cncApprovalDate"]),
  );
  if (params.tcec) {
    conditions.push(
      `(${isYesSql("f.tcec")} or ${fileHasAny([
        "preTcecDate",
        "preTcecMinutesDate",
        "postTcecDate",
        "postTcecMinutesDate",
        "refloatPostTcecDate",
        "refloatPostTcecMinutesDate",
      ])})`,
    );
  }
  if (params.preBidMeetingFilter) {
    conditions.push(`(${isYesSql("f.pre_bid_meeting")} or f.pre_bid_meeting_date is not null)`);
  }
  if (params.preTcecCommittee?.trim()) {
    const placeholder = addSqlValue(values, params.preTcecCommittee.trim().toLowerCase());
    conditions.push(`lower(trim(coalesce(f.pre_tcec_committee_no, ''))) = ${placeholder}`);
  }
  if (params.postTcecCommittee?.trim()) {
    const placeholder = addSqlValue(values, params.postTcecCommittee.trim().toLowerCase());
    conditions.push(`(
      lower(trim(coalesce(f.post_tcec_committee_number, ''))) = ${placeholder}
      or lower(trim(coalesce(f.refloat_post_tcec_committee_no, ''))) = ${placeholder}
    )`);
  }
  if (params.rstFilter) conditions.push(isYesSql("f.rst"));
  applyIncludeExcludeSql(conditions, params.fileClosedPresenceFilter, fileClosedSql());
  const isBgReturnDrilldown = dashboardFilters.some(isBgToBeReturnedDashboardFilter);
  if (!isBgReturnDrilldown) {
    if (params.soCancelledPresenceFilter === "include") {
      conditions.push(supplyOrderExists(isYesSql("so.so_cancelled")));
    } else if (
      params.soCancelledPresenceFilter === "exclude" &&
      !params.milestoneClearingScope &&
      !dashboardFilters.some(shouldIncludeCancelledSoHistoryForDashboardFilter)
    ) {
      conditions.push(`not ${allSupplyOrdersCancelledSql()}`);
    }
  }
  if (!isBgReturnDrilldown) {
    applyIncludeExcludeSql(
      conditions,
      params.shortclosedSoPresenceFilter,
      supplyOrderExists(isYesSql("so.shortclosure")),
    );
  }
  applyIncludeExcludeSql(
    conditions,
    params.multipleSupplyOrdersPresenceFilter,
    multipleSupplyOrdersSql(),
  );

  if (params.capitalOnly && params.revenueOnly) {
    conditions.push("(coalesce(f.value_capital, 0) <> 0 or coalesce(f.value_revenue, 0) <> 0)");
  } else if (params.capitalOnly) {
    conditions.push("coalesce(f.value_capital, 0) <> 0");
  } else if (params.revenueOnly) {
    conditions.push("coalesce(f.value_revenue, 0) <> 0");
  }

  const capitalInrValue = inrAmountExpression("f.value_capital");
  const revenueInrValue = inrAmountExpression("f.value_revenue");
  const totalValue = `(case
    when ${capitalInrValue} is null and ${revenueInrValue} is null then null
    else coalesce(${capitalInrValue}, 0) + coalesce(${revenueInrValue}, 0)
  end)`;
  const minValue = parseSearchAmount(params.valueFrom);
  const maxValue = parseSearchAmount(params.valueTo);
  const valueThresholdFilter = params.valueThresholdFilter?.trim();
  if (valueThresholdFilter && valueThresholdFilter !== "all") {
    conditions.push(
      `(${dashboardFilterSql(valueThresholdFilter, values, thresholdFinancialYear)})`,
    );
  }
  if (minValue !== undefined) {
    const placeholder = addSqlValue(values, minValue);
    conditions.push(`${totalValue} >= ${placeholder}`);
  }
  if (maxValue !== undefined) {
    const placeholder = addSqlValue(values, maxValue);
    conditions.push(`${totalValue} <= ${placeholder}`);
  }

  const minSoValue = parseSearchAmount(params.soValueFrom);
  const maxSoValue = parseSearchAmount(params.soValueTo);
  const soValueThresholdFilter = params.soValueThresholdFilter?.trim();
  if (soValueThresholdFilter && soValueThresholdFilter !== "all") {
    conditions.push(
      `(${soValueThresholdRangeFilterSql(
        soValueThresholdFilter,
        values,
        Boolean(params.soCapitalOnly),
        Boolean(params.soRevenueOnly),
      )})`,
    );
  }
  if (
    minSoValue !== undefined ||
    maxSoValue !== undefined ||
    params.soCapitalOnly ||
    params.soRevenueOnly
  ) {
    const soValueTotal = supplyOrderValueTotalSql(
      Boolean(params.soCapitalOnly),
      Boolean(params.soRevenueOnly),
    );
    conditions.push(
      hasSupplyOrderValueSql(Boolean(params.soCapitalOnly), Boolean(params.soRevenueOnly)),
    );
    if (minSoValue !== undefined) {
      const placeholder = addSqlValue(values, minSoValue);
      conditions.push(`${soValueTotal} >= ${placeholder}`);
    }
    if (maxSoValue !== undefined) {
      const placeholder = addSqlValue(values, maxSoValue);
      conditions.push(`${soValueTotal} <= ${placeholder}`);
    }
  }

  const dpConditions: string[] = [];
  const effectiveDpDate = effectiveDpDateSql("so");
  if (isValidDate(params.dpFrom)) {
    const placeholder = addSqlValue(values, params.dpFrom);
    dpConditions.push(`${effectiveDpDate} >= ${placeholder}::date`);
  }
  if (isValidDate(params.dpTo)) {
    const placeholder = addSqlValue(values, params.dpTo);
    dpConditions.push(`${effectiveDpDate} <= ${placeholder}::date`);
  }
  const dpCondition = withDateFilterMode(
    "dpPeriod",
    params.dpFrom,
    params.dpTo,
    dpConditions.length ? supplyOrderExists(dpConditions.join(" and ")) : undefined,
    supplyOrderExists(hasTextSql(effectiveDpDate)),
  );
  if (dpCondition) conditions.push(dpCondition);

  const dateRangeConditions = [
    withDateFilterMode(
      "demandReceipt",
      params.demandReceiptFrom,
      params.demandReceiptTo,
      fileDateRangeSql("f.received_date", params.demandReceiptFrom, params.demandReceiptTo, values),
      hasTextSql("f.received_date"),
    ),
    withDateFilterMode(
      "demandControl",
      params.demandControlFrom,
      params.demandControlTo,
      fileDateRangeSql("f.imms_date", params.demandControlFrom, params.demandControlTo, values),
      hasTextSql("f.imms_date"),
    ),
    withDateFilterMode(
      "highValueMinutes",
      params.highValueMinutesFrom,
      params.highValueMinutesTo,
      fileDateRangeSql(
        "f.high_value_minutes_date",
        params.highValueMinutesFrom,
        params.highValueMinutesTo,
        values,
      ),
      hasTextSql("f.high_value_minutes_date"),
    ),
    withDateFilterMode(
      "preTcecDate",
      params.preTcecDateFrom,
      params.preTcecDateTo,
      fileDateRangeSql("f.pre_tcec_date", params.preTcecDateFrom, params.preTcecDateTo, values),
      hasTextSql("f.pre_tcec_date"),
    ),
    withDateFilterMode(
      "preTcecMinutes",
      params.preTcecMinutesFrom,
      params.preTcecMinutesTo,
      fileDateRangeSql(
        "f.pre_tcec_minutes_date",
        params.preTcecMinutesFrom,
        params.preTcecMinutesTo,
        values,
      ),
      hasTextSql("f.pre_tcec_minutes_date"),
    ),
    withDateFilterMode(
      "rqaApproval",
      params.rqaApprovalFrom,
      params.rqaApprovalTo,
      fileDateRangeSql("f.rqa_approval_date", params.rqaApprovalFrom, params.rqaApprovalTo, values),
      hasTextSql("f.rqa_approval_date"),
    ),
    withDateFilterMode(
      "ifaFinal",
      params.ifaFinalFrom,
      params.ifaFinalTo,
      fileDateRangeSql("f.ifa_final_date", params.ifaFinalFrom, params.ifaFinalTo, values),
      hasTextSql("f.ifa_final_date"),
    ),
    withDateFilterMode(
      "cfaApproval",
      params.cfaApprovalFrom,
      params.cfaApprovalTo,
      fileDateRangeSql("f.cfa_date", params.cfaApprovalFrom, params.cfaApprovalTo, values),
      hasTextSql("f.cfa_date"),
    ),
    withDateFilterMode(
      "postTcecDate",
      params.postTcecDateFrom,
      params.postTcecDateTo,
      fileAnyDateRangeSql(
        ["f.post_tcec_date", "f.refloat_post_tcec_date"],
        params.postTcecDateFrom,
        params.postTcecDateTo,
        values,
      ),
      `(${hasTextSql("f.post_tcec_date")} or ${hasTextSql("f.refloat_post_tcec_date")})`,
    ),
    withDateFilterMode(
      "postTcecMinutes",
      params.postTcecMinutesFrom,
      params.postTcecMinutesTo,
      fileAnyDateRangeSql(
        ["f.post_tcec_minutes_date", "f.refloat_post_tcec_minutes_date"],
        params.postTcecMinutesFrom,
        params.postTcecMinutesTo,
        values,
      ),
      `(${hasTextSql("f.post_tcec_minutes_date")} or ${hasTextSql("f.refloat_post_tcec_minutes_date")})`,
    ),
    withDateFilterMode(
      "cncDate",
      params.cncDateFrom,
      params.cncDateTo,
      fileDateRangeSql("f.cnc_date", params.cncDateFrom, params.cncDateTo, values),
      hasTextSql("f.cnc_date"),
    ),
    withDateFilterMode(
      "preBidDate",
      params.preBidDateFrom,
      params.preBidDateTo,
      fileAnyDateRangeSql(
        ["f.pre_bid_meeting_date", "f.refloat_pre_bid_meeting_date"],
        params.preBidDateFrom,
        params.preBidDateTo,
        values,
      ),
      `(${hasTextSql("f.pre_bid_meeting_date")} or ${hasTextSql("f.refloat_pre_bid_meeting_date")})`,
    ),
    withDateFilterMode(
      "biddingDate",
      params.biddingDateFrom,
      params.biddingDateTo,
      fileAnyDateRangeSql(
        ["f.bid_date", "f.refloat_bidding_date"],
        params.biddingDateFrom,
        params.biddingDateTo,
        values,
      ),
      `(${hasTextSql("f.bid_date")} or ${hasTextSql("f.refloat_bidding_date")})`,
    ),
    withDateFilterMode(
      "bidOpeningDate",
      params.bidOpeningDateFrom,
      params.bidOpeningDateTo,
      fileAnyDateRangeSql(
        ["f.bid_opening_date", "f.refloat_bid_opening_date"],
        params.bidOpeningDateFrom,
        params.bidOpeningDateTo,
        values,
      ),
      `(${hasTextSql("f.bid_opening_date")} or ${hasTextSql("f.refloat_bid_opening_date")})`,
    ),
    withDateFilterMode(
      "billSubmitted",
      params.billSubmittedFrom,
      params.billSubmittedTo,
      billSubmissionEventDateRangeSql(params.billSubmittedFrom, params.billSubmittedTo, values),
      billSubmissionEventPresenceSql(),
    ),
    withDateFilterMode(
      "financialSanction",
      params.financialSanctionFrom,
      params.financialSanctionTo,
      supplyOrderDateRangeSql(
        "financial_sanction_date",
        params.financialSanctionFrom,
        params.financialSanctionTo,
        values,
      ),
      supplyOrderExists(hasTextSql("so.financial_sanction_date")),
    ),
    withDateFilterMode(
      "soDate",
      params.soDateFrom,
      params.soDateTo,
      supplyOrderDateRangeSql("so_date", params.soDateFrom, params.soDateTo, values),
      supplyOrderExists(hasTextSql("so.so_date")),
    ),
    withDateFilterMode(
      "advanceExpectedPaymentDate",
      params.advanceExpectedPaymentDateFrom,
      params.advanceExpectedPaymentDateTo,
      (() => {
        if (
          !isValidDate(params.advanceExpectedPaymentDateFrom) &&
          !isValidDate(params.advanceExpectedPaymentDateTo)
        ) return undefined;
        const expression = "nullif(so.advance_payment_detail ->> 'expectedPaymentDate', '')::date";
        const checks: string[] = [];
        if (isValidDate(params.advanceExpectedPaymentDateFrom)) {
          checks.push(`${expression} >= ${addSqlValue(values, params.advanceExpectedPaymentDateFrom)}::date`);
        }
        if (isValidDate(params.advanceExpectedPaymentDateTo)) {
          checks.push(`${expression} <= ${addSqlValue(values, params.advanceExpectedPaymentDateTo)}::date`);
        }
        return supplyOrderExists(checks.join(" and "));
      })(),
      supplyOrderExists(hasTextSql("so.advance_payment_detail ->> 'expectedPaymentDate'")),
    ),
    withDateFilterMode(
      "materialReceipt",
      params.materialReceiptFrom,
      params.materialReceiptTo,
      supplyOrderDateRangeSql(
        "material_receipt_date",
        params.materialReceiptFrom,
        params.materialReceiptTo,
        values,
      ),
      supplyOrderExists(hasTextSql("so.material_receipt_date")),
    ),
    withDateFilterMode(
      "actualJobCompletion",
      params.actualJobCompletionFrom,
      params.actualJobCompletionTo,
      supplyOrderActualJobCompletionDateRangeSql(
        params.actualJobCompletionFrom,
        params.actualJobCompletionTo,
        values,
      ),
      supplyOrderExists(`(
        so.actual_job_completion_date is not null
        or exists (
          select 1
          from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as actual_completion_stage(stage)
          where nullif(btrim(actual_completion_stage.stage ->> 'actualJobCompletionDate'), '') is not null
        )
      )`),
    ),
    withDateFilterMode(
      "paymentDate",
      params.paymentDateFrom,
      params.paymentDateTo,
      paymentEventDateRangeSql(params.paymentDateFrom, params.paymentDateTo, values),
      paymentEventDatePresenceSql(),
    ),
    withDateFilterMode(
      "bgReceived",
      params.bgReceivedFrom,
      params.bgReceivedTo,
      supplyOrderAnyDateRangeSql(
        ["psb_bg_received_date", "pwb_bg_received_date", "combined_bg_received_date"],
        params.bgReceivedFrom,
        params.bgReceivedTo,
        values,
      ),
      supplyOrderAnyDatePresenceSql(["psb_bg_received_date", "pwb_bg_received_date", "combined_bg_received_date"]),
    ),
    withDateFilterMode(
      "bgValidity",
      params.bgValidityFrom,
      params.bgValidityTo,
      supplyOrderAnyDateRangeSql(
        ["psb_bg_validity_date", "pwb_bg_validity_date", "combined_bg_validity_date"],
        params.bgValidityFrom,
        params.bgValidityTo,
        values,
      ),
      supplyOrderAnyDatePresenceSql(["psb_bg_validity_date", "pwb_bg_validity_date", "combined_bg_validity_date"]),
    ),
    withDateFilterMode(
      "bgReturn",
      params.bgReturnFrom,
      params.bgReturnTo,
      supplyOrderAnyDateRangeSql(
        ["psb_bg_return_date", "pwb_bg_return_date", "combined_bg_return_date"],
        params.bgReturnFrom,
        params.bgReturnTo,
        values,
      ),
      supplyOrderAnyDatePresenceSql(["psb_bg_return_date", "pwb_bg_return_date", "combined_bg_return_date"]),
    ),
    withDateFilterMode(
      "fileClosure",
      params.fileClosureFrom,
      params.fileClosureTo,
      fileDateRangeSql("f.file_closure_date", params.fileClosureFrom, params.fileClosureTo, values),
      hasTextSql("f.file_closure_date"),
    ),
  ].filter((condition): condition is string => Boolean(condition));
  conditions.push(...dateRangeConditions);

  if (params.freeText?.trim()) {
    const placeholder = addSqlValue(values, sqlLike(params.freeText));
    const normalizedQuery = params.freeText
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    const freeSearchText = freeSearchTextExpression();
    const freeSearchConditions = [`lower(${freeSearchText}) like ${placeholder}`];
    if (normalizedQuery) {
      const normalizedPlaceholder = addSqlValue(values, `%${normalizedQuery}%`);
      freeSearchConditions.push(`${normalizedSql(freeSearchText)} like ${normalizedPlaceholder}`);
    }
    conditions.push(`(${freeSearchConditions.join(" or ")})`);
  }

  if (isValidDate(params.freeDate)) {
    const placeholder = addSqlValue(values, params.freeDate);
    conditions.push(
      `(${dateSearchColumns.map((column) => `${column} = ${placeholder}::date`).join(" or ")} or ${supplyOrderExists(
        Object.values(supplyOrderSearchColumns)
          .filter(
            (column) => column.includes("date") || column === "revised_dp" || column === "dp_date",
          )
          .map((column) => `so.${column} = ${placeholder}::date`)
          .join(" or "),
      )})`,
    );
  }
  const requiredFieldsSql = requiredFilledFieldsSql(params.requiredFilledFields ?? []);
  if (requiredFieldsSql) conditions.push(requiredFieldsSql);
  const datePresenceCondition = fieldConditionSql(
    params.datePresenceField,
    params.datePresenceMode,
  );
  if (datePresenceCondition) conditions.push(datePresenceCondition);
  const yesNoFieldConditionMode =
    params.fieldConditionYesNoMode === "yes" || params.fieldConditionYesNoMode === "no"
      ? params.fieldConditionYesNoMode
      : undefined;
  if (yesNoFieldConditionMode) {
    for (const field of params.fieldConditionYesNoFields ?? []) {
      const condition = fieldConditionGroupSql(field, yesNoFieldConditionMode);
      if (condition) conditions.push(condition);
    }
  }
  const presenceFieldConditionMode =
    params.fieldConditionPresenceMode === "filled" || params.fieldConditionPresenceMode === "blank"
      ? params.fieldConditionPresenceMode
      : undefined;
  if (presenceFieldConditionMode) {
    for (const field of params.fieldConditionPresenceFields ?? []) {
      const condition = fieldConditionGroupSql(field, presenceFieldConditionMode);
      if (condition) conditions.push(condition);
    }
  }

  const orderParts: string[] = [];
  if (params.divisionWiseSort) orderParts.push("lower(coalesce(d.name, '')) asc");
  const sortSql = getSortSql(params.sortColumnKey, params.sortDirection ?? "asc");
  if (sortSql) orderParts.push(sortSql);
  orderParts.push("f.created_at desc", "f.id asc");

  return {
    whereSql: conditions.length ? `where ${conditions.join(" and ")}` : "",
    values,
    orderSql: `order by ${orderParts.join(", ")}`,
    limit,
    offset,
    page,
    pageSize,
  };
}

async function verifyDeletionPassword(value: unknown) {
  if (typeof value !== "string") throw new HttpError(400, "Deletion password is required.");
  const result = await pool.query<{ ok: boolean; configured: boolean }>(
    `select
       deletion_password <> '' as configured,
       deletion_password <> '' and deletion_password = $1 as ok
     from app_settings
     where id = true`,
    [value],
  );
  if (!result.rows[0]?.configured) {
    throw new HttpError(400, "Set a deletion password in admin settings before deleting files.");
  }
  if (!result.rows[0].ok) throw new HttpError(403, "Incorrect deletion password.");
}

async function loadCurrentFinancialYear() {
  const result = await pool.query<{ financial_year: string }>(
    "select financial_year from app_settings where id = true",
  );
  return result.rows[0]?.financial_year;
}

function getThresholdFinancialYear(
  selectedYear: string | undefined,
  currentFinancialYear: string | undefined,
) {
  void selectedYear;
  void currentFinancialYear;
  return "__global__";
}

function buildFileInsert(body: Record<string, unknown>, divisionId: string | null) {
  const columns = ["division_id"];
  const values: unknown[] = [divisionId];
  const placeholders = ["$1"];

  for (const [frontendKey, [column, kind]] of Object.entries(fileFields)) {
    if (!(frontendKey in body)) continue;
    values.push(toFileFieldDbValue(frontendKey, body[frontendKey], kind));
    columns.push(column);
    placeholders.push(`$${values.length}`);
  }

  return { columns, values, placeholders };
}

function buildFileUpdate(body: Record<string, unknown>, divisionId: string | null | undefined) {
  const fields: string[] = [];
  const values: unknown[] = [];

  const addField = (column: string, value: unknown) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

  if (divisionId !== undefined) addField("division_id", divisionId);
  for (const [frontendKey, [column, kind]] of Object.entries(fileFields)) {
    if (!(frontendKey in body)) continue;
    addField(column, toFileFieldDbValue(frontendKey, body[frontendKey], kind));
  }

  return { fields, values };
}

async function validateDemandCancellationAllowed(
  client: PoolClient,
  body: Record<string, unknown>,
  fileId?: string,
) {
  if (!isYesValue(body.demandCancelled)) return;
  if (hasPlacedSupplyOrderPayload(body)) {
    throw new HttpError(
      400,
      "Demand can be cancelled only before any Supply Order is placed. Use S.O. cancelled for placed Supply Orders.",
    );
  }
  if (!fileId) return;
  const existing = await client.query<{ has_placed_supply_order: boolean }>(
    `select (
       exists (
         select 1 from files
         where id = $1 and so_date is not null
       )
       or exists (
         select 1 from supply_orders
         where file_id = $1 and so_date is not null
       )
     ) as has_placed_supply_order`,
    [fileId],
  );
  if (existing.rows[0]?.has_placed_supply_order) {
    throw new HttpError(
      400,
      "Demand can be cancelled only before any Supply Order is placed. Use S.O. cancelled for placed Supply Orders.",
    );
  }
}

function hasPlacedSupplyOrderPayload(body: Record<string, unknown>) {
  if (hasTextValue(body.soDate)) return true;
  if (!Array.isArray(body.supplyOrders)) return false;
  return body.supplyOrders.some(
    (order) =>
      order && typeof order === "object" && hasTextValue((order as Record<string, unknown>).soDate),
  );
}

function isYesValue(value: unknown) {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === "yes"
  );
}

function hasTextValue(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

function readDateText(value: unknown) {
  return String(value ?? "").trim();
}

function readObjectArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object"),
      )
    : [];
}

function validateSupplyOrderChronology(
  body: Record<string, unknown>,
  rows: Record<string, unknown>[] | undefined,
) {
  const topLevelFinancialSanctionDate = readDateText(body.financialSanctionDate);
  const topLevelSoDate = readDateText(body.soDate);
  if (
    topLevelFinancialSanctionDate &&
    topLevelSoDate &&
    topLevelSoDate < topLevelFinancialSanctionDate
  ) {
    throw new HttpError(400, "S.O. date cannot be earlier than Financial Sanction date.");
  }
  const topLevelDpDate = readDateText(body.dpDate);
  if (topLevelSoDate && topLevelDpDate && topLevelDpDate < topLevelSoDate) {
    throw new HttpError(400, "D.P. date cannot be earlier than S.O. date.");
  }

  rows?.forEach((order, index) => {
    const label = `Supply Order ${index + 1}`;
    const financialSanctionDate = readDateText(order.financialSanctionDate);
    const soDate = readDateText(order.soDate);
    if (financialSanctionDate && soDate && soDate < financialSanctionDate) {
      throw new HttpError(
        400,
        `${label}: S.O. date cannot be earlier than Financial Sanction date.`,
      );
    }
    const dpDate = readDateText(order.dpDate);
    if (soDate && dpDate && dpDate < soDate) {
      throw new HttpError(400, `${label}: D.P. date cannot be earlier than S.O. date.`);
    }
    readObjectArray(order.stageDeliveries).forEach((stage, stageIndex) => {
      const stageDpDate = readDateText(stage.dpDate);
      if (!soDate || !stageDpDate || stageDpDate >= soDate) return;
      throw new HttpError(
        400,
        `${label} Delivery-${stageIndex + 1}: D.P. date cannot be earlier than S.O. date.`,
      );
    });
  });
}

function hasFilledValue(row: Record<string, unknown>): boolean {
  return Object.entries(row).some(([key, value]) => {
    if (Array.isArray(value)) {
      return value.some((item) => hasFilledValue(item as Record<string, unknown>));
    }
    if (value && typeof value === "object") {
      return hasFilledValue(value as Record<string, unknown>);
    }
    const text = String(value ?? "").trim();
    if (!text) return false;
    return !isDefaultNoValue(key, text);
  });
}

function isDefaultNoValue(key: string, value: string) {
  return (
    value.toLowerCase() === "no" &&
    [
      "advancePayment",
      "demandCancelled",
      "dpExtension",
      "ld",
      "noFurtherAction",
      "soCancelled",
      "shortclosure",
      "stageDelivery",
      "stagePayment",
    ].includes(key)
  );
}

async function replaceFirms(
  client: PoolClient,
  fileId: string,
  firmType: "bq" | "invited" | "bidder",
  rows: Record<string, unknown>[],
) {
  await client.query("delete from file_firms where file_id = $1 and firm_type = $2", [
    fileId,
    firmType,
  ]);
  let sortOrder = 0;
  for (const row of rows.filter(hasFilledValue)) {
    await client.query(
      `insert into file_firms (file_id, firm_type, firm_name, city, address, email_id, firm_unique_no, contact_no, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        fileId,
        firmType,
        toDbText(row.firmName),
        toDbText(row.city),
        toDbText(row.address),
        toDbText(row.emailId),
        toDbText(row.firmUniqueNo),
        toDbText(row.contactNo),
        sortOrder++,
      ],
    );
  }
}

async function replaceSupplyOrders(
  client: PoolClient,
  fileId: string,
  rows: Record<string, unknown>[],
) {
  const previousOrders = await client.query<{
    id: string;
    sort_order: number;
    so_no: string | null;
    gem_so_no: string | null;
    no_further_action: string | null;
    no_further_action_date: Date | string | null;
  }>(
    `select id, sort_order, so_no, gem_so_no, no_further_action, no_further_action_date
     from supply_orders where file_id = $1 order by sort_order`,
    [fileId],
  );
  await client.query("delete from supply_orders where file_id = $1", [fileId]);
  let sortOrder = 0;
  const matchedOrderIds = new Set<string>();
  for (const row of rows.filter(hasFilledValue)) {
    const columns = ["id", "file_id", "sort_order", "include_in_payment_timing"];
    const values: unknown[] = [null, fileId, sortOrder++, row.includeInPaymentTiming !== false];
    const placeholders = ["coalesce($1::uuid, gen_random_uuid())", "$2", "$3", "$4"];
    const previous = previousOrders.rows.find((item) => {
      if (matchedOrderIds.has(item.id)) return false;
      if (toDbText(row.id) === item.id) return true;
      const soNo = toDbText(row.soNo);
      const gemSoNo = toDbText(row.gemSoNo);
      if (soNo || gemSoNo) {
        return Boolean((soNo && item.so_no === soNo) || (gemSoNo && item.gem_so_no === gemSoNo));
      }
      return item.sort_order === sortOrder - 1 && !item.so_no && !item.gem_so_no;
    });
    if (previous) matchedOrderIds.add(previous.id);
    values[0] = previous?.id ?? null;
    const noFurtherActionDate =
      toDbText(row.noFurtherAction)?.toLowerCase() === "yes"
        ? previous?.no_further_action?.toLowerCase() === "yes" && previous.no_further_action_date
          ? previous.no_further_action_date
          : new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Kolkata",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date())
        : null;
    for (const [frontendKey, [column, kind]] of Object.entries(supplyOrderFields)) {
      values.push(
        frontendKey === "noFurtherAction"
          ? toDbText(row[frontendKey]) ?? "No"
          : frontendKey === "noFurtherActionDate"
            ? noFurtherActionDate
            : toDbValue(row[frontendKey], kind),
      );
      columns.push(column);
      placeholders.push(`$${values.length}`);
    }
    await client.query(
      `insert into supply_orders (${columns.join(", ")})
       values (${placeholders.join(", ")})`,
      values,
    );
  }
}

async function trimExistingSupplyOrdersToCount(
  client: PoolClient,
  fileId: string,
  noOfSo: unknown,
) {
  const count = readSupplyOrderCount(noOfSo);
  if (count === undefined) return;
  await client.query(
    `with ranked as (
       select id, row_number() over (order by sort_order nulls last, id) - 1 as row_index
       from supply_orders
       where file_id = $1
     )
     delete from supply_orders
     where id in (select id from ranked where row_index >= $2)`,
    [fileId, count],
  );
}

async function replaceRemarks(client: PoolClient, fileId: string, rows: Record<string, unknown>[]) {
  await client.query("delete from file_remarks where file_id = $1", [fileId]);
  for (const row of rows.filter(hasFilledValue)) {
    const section = toDbText(row.section);
    const text = toDbText(row.text);
    if (!section || !text) continue;
    await client.query(
      `insert into file_remarks (file_id, section, text, created_at)
       values ($1, $2, $3, coalesce($4::timestamptz, now()))`,
      [fileId, section, text, toDbText(row.createdAt)],
    );
  }
}

async function replaceMarkers(client: PoolClient, fileId: string, rows: Record<string, unknown>[]) {
  await client.query("delete from file_markers where file_id = $1", [fileId]);
  let sortOrder = 0;
  const seen = new Set<string>();
  for (const row of rows.filter(hasFilledValue)) {
    const text = toDbText(row.text)?.trim().toUpperCase();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    await client.query(
      `insert into file_markers (file_id, text, created_at, sort_order)
       values ($1, $2, coalesce($3::timestamptz, now()), $4)`,
      [fileId, text, toDbText(row.createdAt), sortOrder++],
    );
  }
}

async function replaceCompletedMilestones(
  client: PoolClient,
  fileId: string,
  milestones: unknown[],
) {
  await client.query("delete from file_completed_milestones where file_id = $1", [fileId]);
  for (const milestone of milestones) {
    const value = toDbText(milestone);
    if (!value) continue;
    await client.query(
      `insert into file_completed_milestones (file_id, milestone)
       values ($1, $2)
       on conflict do nothing`,
      [fileId, value],
    );
  }
}

function readActiveYears(body: Record<string, unknown>) {
  if (!("activeYears" in body)) return undefined;
  if (!Array.isArray(body.activeYears)) throw new HttpError(400, "activeYears must be an array.");
  return body.activeYears.map((year) => normalizeFinancialYearLabel(year)).filter(Boolean);
}

async function replaceActiveYears(
  client: PoolClient,
  fileId: string,
  activeYears: string[],
  originYear: unknown,
) {
  const origin =
    typeof originYear === "string" && originYear.trim()
      ? normalizeFinancialYearLabel(originYear)
      : (
          await client.query<{ year: string | null }>("select year from files where id = $1", [
            fileId,
          ])
        ).rows[0]?.year;
  const normalizedOrigin = normalizeFinancialYearLabel(origin);
  const years = Array.from(
    new Set([...activeYears, ...(normalizedOrigin ? [normalizedOrigin] : [])]),
  );
  await client.query("delete from file_year_activity where file_id = $1", [fileId]);
  for (const year of years) {
    await client.query(
      `insert into file_year_activity (file_id, financial_year, status)
       values ($1, $2, 'active')
       on conflict (file_id, financial_year)
       do update set status = 'active'`,
      [fileId, year],
    );
  }
}

async function replaceNestedFileData(
  client: PoolClient,
  fileId: string,
  body: Record<string, unknown>,
  onlyProvided: boolean,
) {
  const bqFirms = readArray(body.bqFirms, "bqFirms");
  const invitedFirms = readArray(body.invitedFirms, "invitedFirms");
  const bidderFirms = readArray(body.bidderFirms, "bidderFirms");
  const existingFileContext =
    typeof body.mode === "string" &&
    typeof body.fileType === "string" &&
    typeof body.fileTypeGroup === "string" &&
    typeof body.ir === "string" &&
    typeof body.gem === "string" &&
    typeof body.gemBiddingMode === "string"
      ? null
      : await client.query<{
          mode: string | null;
          fileType: string | null;
          fileTypeGroup: string | null;
          ir: string | null;
          gem: string | null;
          gemBiddingMode: string | null;
        }>(
          `select
             mode,
             file_type as "fileType",
             file_type_group as "fileTypeGroup",
             ir,
             gem,
             gem_bidding_mode as "gemBiddingMode"
           from files
           where id = $1`,
          [fileId],
        );
  const existingFile = existingFileContext?.rows[0];
  const biddingApplicable = isBiddingApplicableForFile({
    mode: typeof body.mode === "string" ? body.mode : (existingFile?.mode ?? undefined),
    fileType:
      typeof body.fileType === "string" ? body.fileType : (existingFile?.fileType ?? undefined),
    gem: typeof body.gem === "string" ? body.gem : (existingFile?.gem ?? undefined),
    gemBiddingMode:
      typeof body.gemBiddingMode === "string"
        ? body.gemBiddingMode
        : (existingFile?.gemBiddingMode ?? undefined),
  });
  const workflowContext = {
    fileType:
      typeof body.fileType === "string" ? body.fileType : (existingFile?.fileType ?? undefined),
    fileTypeGroup:
      typeof body.fileTypeGroup === "string"
        ? body.fileTypeGroup
        : (existingFile?.fileTypeGroup ?? undefined),
    ir: typeof body.ir === "string" ? body.ir : (existingFile?.ir ?? undefined),
  };
  const supplyOrders = readArray(body.supplyOrders, "supplyOrders");
  const trimmedSupplyOrders = trimRowsToSupplyOrderCount(supplyOrders, body.noOfSo);
  const sanitizedSupplyOrders = sanitizeSupplyOrdersForWorkflow(
    trimmedSupplyOrders,
    workflowContext,
  );
  validateSupplyOrderChronology(body, sanitizedSupplyOrders);
  const remarks = readArray(body.remarks, "remarks");
  const markers = readArray(body.markers, "markers");
  const completedMilestones = body.completedMilestones;
  const activeYears = readActiveYears(body);

  if (!onlyProvided || bqFirms)
    await replaceFirms(client, fileId, "bq", biddingApplicable ? (bqFirms ?? []) : []);
  if (!onlyProvided || invitedFirms)
    await replaceFirms(client, fileId, "invited", biddingApplicable ? (invitedFirms ?? []) : []);
  if (!onlyProvided || bidderFirms)
    await replaceFirms(client, fileId, "bidder", biddingApplicable ? (bidderFirms ?? []) : []);
  if (!onlyProvided || sanitizedSupplyOrders) {
    await replaceSupplyOrders(client, fileId, sanitizedSupplyOrders ?? []);
  } else if ("noOfSo" in body) {
    await trimExistingSupplyOrdersToCount(client, fileId, body.noOfSo);
  }
  if (!onlyProvided || remarks) await replaceRemarks(client, fileId, remarks ?? []);
  if (!onlyProvided || markers) await replaceMarkers(client, fileId, markers ?? []);
  if (!onlyProvided || completedMilestones !== undefined) {
    if (completedMilestones !== undefined && !Array.isArray(completedMilestones)) {
      throw new HttpError(400, "completedMilestones must be an array.");
    }
    await replaceCompletedMilestones(
      client,
      fileId,
      Array.isArray(completedMilestones) ? completedMilestones : [],
    );
  }
  if (!onlyProvided || activeYears !== undefined) {
    await replaceActiveYears(client, fileId, activeYears ?? [], body.year);
  }
}

filesRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const conditions: string[] = [];
    const values: unknown[] = [];
    const scope = getDivisionScopeCondition(user);
    const categoryScope = getFileCategoryScopeCondition(user);
    if (scope.sql) {
      conditions.push(scope.sql);
      values.push(...scope.values);
    }
    if (categoryScope.sql) conditions.push(categoryScope.sql);

    if (request.query.year === allFilesYear) {
      // No status/year condition.
    } else if (request.query.year === allActiveFilesYear) {
      conditions.push(activeFilesSql());
    } else if (request.query.year === activePlusCurrentFyClosedYear) {
      conditions.push(activePlusCurrentFyClosedSql(values, await loadCurrentFinancialYear()));
    } else if (typeof request.query.year === "string" && request.query.year.trim()) {
      conditions.push(specificFinancialYearSql(values, request.query.year));
    }
    if (typeof request.query.division === "string" && request.query.division.trim()) {
      values.push(request.query.division.trim());
      conditions.push(`lower(d.name) = lower($${values.length})`);
    }

    const whereSql = conditions.length ? `where ${conditions.join(" and ")}` : "";
    response.json({ files: await loadFiles(whereSql, values) });
  }),
);

type QuickEntryExportField = {
  label: string;
  source: "file" | "order" | "stage" | "advance" | "supplementary" | "derived";
  field?: string;
  numeric?: boolean;
};

const fileExportField = (label: string, field: string, numeric = false): QuickEntryExportField =>
  ({ label, field, source: "file", numeric });
const orderExportField = (label: string, field: string, numeric = false): QuickEntryExportField =>
  ({ label, field, source: "order", numeric });
const stageExportField = (label: string, field: string, numeric = false): QuickEntryExportField =>
  ({ label, field, source: "stage", numeric });
const advanceExportField = (label: string, field: string, numeric = false): QuickEntryExportField =>
  ({ label, field, source: "advance", numeric });
const supplementaryExportField = (
  label: string,
  field: string,
  numeric = false,
): QuickEntryExportField => ({ label, field, source: "supplementary", numeric });
const quickEntryExportFields: Record<string, QuickEntryExportField> = {
  uniqueCode: fileExportField("Unique Code", "uniqueCode"),
  controlNo: fileExportField("Control No.", "imms"),
  fileNo: fileExportField("File No.", "fileNo"),
  year: fileExportField("Financial Year", "year"),
  fileDate: fileExportField("File Date", "date"),
  receivedDate: fileExportField("Demand Received Date", "receivedDate"),
  division: fileExportField("Division", "division"),
  indentor: fileExportField("Indentor", "indentor"),
  demandDescription: fileExportField("Demand Description", "demandDescription"),
  valueCapital: fileExportField("Demand Capital Value", "valueCapital", true),
  valueRevenue: fileExportField("Demand Revenue Value", "valueRevenue", true),
  fileType: fileExportField("File Type", "fileType"),
  fileTypeGroup: fileExportField("File Type Group", "fileTypeGroup"),
  mode: fileExportField("Mode", "mode"),
  tcec: fileExportField("TCEC", "tcec"),
  gem: fileExportField("GeM", "gem"),
  ir: fileExportField("IR", "ir"),
  gte: fileExportField("GTE", "gte"),
  officer: fileExportField("Officer", "officer"),
  currency: fileExportField("Currency", "currency"),
  exchangeRate: fileExportField("Exchange Rate", "exchangeRate", true),
  noOfSo: fileExportField("Number of S.O.s", "noOfSo", true),
  currentMilestone: fileExportField("Current Milestone", "currentMilestone"),
  completedMilestones: fileExportField("Completed Milestones", "completedMilestones"),
  activeYears: fileExportField("Active Financial Years", "activeYears"),
  fileRemarks: { label: "File Remarks", source: "derived", field: "fileRemarks" },
  fileMarkers: { label: "File Markers", source: "derived", field: "fileMarkers" },
  fileClosed: { label: "File Closed (Yes/No)", source: "derived" },
  fileClosureDate: fileExportField("File Closure Date", "fileClosureDate"),
  demandCancelled: fileExportField("Demand Cancelled (Yes/No)", "demandCancelled"),
  demandCancelledDate: fileExportField("Demand Cancelled Date", "demandCancelledDate"),
  scrutinyDate: fileExportField("Scrutiny Date", "scrutinyDate"),
  scrutinyResponseDate: fileExportField("Scrutiny Response Date", "scrutinyResponseDate"),
  scrutinyCompletionDate: fileExportField("Scrutiny Completion Date", "scrutinyCompletionDate"),
  immsDate: fileExportField("Control Date", "immsDate"),
  highValue: fileExportField("High Value", "highValue"),
  highValueMeetingDate: fileExportField("High Value Meeting Date", "highValueMeetingDate"),
  highValueMinutesDate: fileExportField("High Value Minutes Date", "highValueMinutesDate"),
  ad: fileExportField("AD Applicable", "ad"),
  adSentDate: fileExportField("AD Sent Date", "adSentDate"),
  adVettingDate: fileExportField("AD Vetting Date", "adVettingDate"),
  preTcecDate: fileExportField("Pre-TCEC Date", "preTcecDate"),
  preTcecMinutesDate: fileExportField("Pre-TCEC Minutes Date", "preTcecMinutesDate"),
  preTcecCommitteeNo: fileExportField("Pre-TCEC Committee No.", "preTcecCommitteeNo"),
  rqa: fileExportField("R&QA Applicable", "rqa"),
  rqaSentDate: fileExportField("R&QA Sent Date", "rqaSentDate"),
  rqaApprovalDate: fileExportField("R&QA Approval Date", "rqaApprovalDate"),
  ifa: fileExportField("IFA Applicable", "ifa"),
  ifaSentDate: fileExportField("IFA Sent Date", "ifaSentDate"),
  ifaFinalDate: fileExportField("IFA Final Date", "ifaFinalDate"),
  cfaSentDate: fileExportField("CFA Sent Date", "cfaSentDate"),
  cfaDate: fileExportField("CFA Approval Date", "cfaDate"),
  cncDate: fileExportField("CNC Date", "cncDate"),
  cncApprovalDate: fileExportField("CNC Approval Date", "cncApprovalDate"),
  gemUndertakingDate: fileExportField("GeM Undertaking Date", "gemUndertakingDate"),
  refloatGemUndertakingDate: fileExportField(
    "Refloat GeM Undertaking",
    "refloatGemUndertakingDate",
  ),
  refloatRecommendationDate: fileExportField(
    "Refloat Recommendation",
    "refloatRecommendationDate",
  ),
  gemBiddingMode: fileExportField("GeM Bidding Mode", "gemBiddingMode"),
  psb: fileExportField("PSB Applicable", "psb"),
  bg: fileExportField("BG Applicable", "bg"),
  rfpVetting: fileExportField("RFP Vetting", "rfpVetting"),
  rfpVettingInitiationDate: fileExportField("RFP Vetting Initiation Date", "rfpVettingInitiationDate"),
  rfpVettingApprovalDate: fileExportField("RFP Vetting Approval Date", "rfpVettingApprovalDate"),
  preBidMeeting: fileExportField("Pre-Bid Meeting", "preBidMeeting"),
  preBidMeetingDate: fileExportField("Pre-Bid Meeting Date", "preBidMeetingDate"),
  tenderLive: fileExportField("Tender Live", "tenderLive"),
  bidNumber: fileExportField("Bid Number", "bidNumber"),
  bidDate: fileExportField("Bid Date", "bidDate"),
  bidOpeningDate: fileExportField("Bid Opening Date", "bidOpeningDate"),
  bidOpened: fileExportField("Bid Opened", "bidOpened"),
  postTcecDate: fileExportField("Post-TCEC Date", "postTcecDate"),
  postTcecMinutesDate: fileExportField("Post-TCEC Minutes Date", "postTcecMinutesDate"),
  postTcecCommitteeNumber: fileExportField("Post-TCEC Committee No.", "postTcecCommitteeNumber"),
  refloat: fileExportField("Refloat", "refloat"),
  refloatPreBidMeeting: fileExportField("Refloat Pre-Bid Meeting", "refloatPreBidMeeting"),
  refloatPreBidMeetingDate: fileExportField("Refloat Pre-Bid Meeting Date", "refloatPreBidMeetingDate"),
  refloatBiddingDate: fileExportField("Refloat Bidding Date", "refloatBiddingDate"),
  refloatBidOpeningDate: fileExportField("Refloat Bid Opening Date", "refloatBidOpeningDate"),
  refloatPostTcecDate: fileExportField("Refloat Post-TCEC Date", "refloatPostTcecDate"),
  refloatPostTcecMinutesDate: fileExportField("Refloat Post-TCEC Minutes Date", "refloatPostTcecMinutesDate"),
  refloatPostTcecCommitteeNo: fileExportField("Refloat Post-TCEC Committee No.", "refloatPostTcecCommitteeNo"),
  rst: fileExportField("RST", "rst"),
  biddingStageOver: fileExportField("Bidding Stage Over", "biddingStageOver"),
  refloatBiddingStageOver: fileExportField("Refloat Bidding Stage Over", "refloatBiddingStageOver"),
  soNo: orderExportField("S.O. No.", "soNo"),
  gemSoNo: orderExportField("GeM S.O. No.", "gemSoNo"),
  soDate: orderExportField("S.O. Date", "soDate"),
  firm: orderExportField("Firm Name", "firm"),
  firmType: orderExportField("Firm Type", "firmType"),
  firmTypeOther: orderExportField("Firm Type (Other)", "firmTypeOther"),
  firmUniqueNo: orderExportField("Firm Unique No.", "firmUniqueNo"),
  firmContactNo: orderExportField("Firm Contact No.", "firmContactNo"),
  firmCity: orderExportField("Firm City", "firmCity"),
  bqBasis: orderExportField("BQ Basis", "bqBasis"),
  soValueCapital: orderExportField("S.O. Capital Value", "soValueCapital", true),
  soValueRevenue: orderExportField("S.O. Revenue Value", "soValueRevenue", true),
  dpDate: orderExportField("S.O. D.P. / Last Stage Effective D.P.", "dpDate"),
  deliveryPeriodStartDate: orderExportField("Delivery Period Start Date", "deliveryPeriodStartDate"),
  dpExtension: orderExportField("D.P. Extension", "dpExtension"),
  dpExtensionCount: orderExportField("D.P. Extension Count", "dpExtensionCount", true),
  revisedDp: orderExportField("Revised D.P.", "revisedDp"),
  ld: orderExportField("L.D.", "ld"),
  ldType: orderExportField("L.D. Type", "ldType"),
  ldPercentage: orderExportField("L.D. Percentage", "ldPercentage", true),
  materialReceiptDate: orderExportField("Material Receipt Date", "materialReceiptDate"),
  actualJobCompletionDate: orderExportField("Actual Job Completion Date", "actualJobCompletionDate"),
  jobCompletionDate: orderExportField("Job Completion Received Date", "jobCompletionDate"),
  irPreparationDate: orderExportField("IR Preparation Date", "irPreparationDate"),
  irReceiptDate: orderExportField("IR Receipt Date", "irReceiptDate"),
  billPreparationDate: orderExportField("Bill Preparation Date", "billPreparationDate"),
  billNo: orderExportField("Bill Number", "billNo"),
  billAmountCapital: orderExportField("Bill Amount Capital", "billAmountCapital", true),
  billAmountRevenue: orderExportField("Bill Amount Revenue", "billAmountRevenue", true),
  billSentForPaymentDate: orderExportField("Bill Sent for Payment Date", "billSentForPaymentDate"),
  paymentDate: orderExportField("Payment Date", "paymentDate"),
  paymentMode: orderExportField("Payment Mode", "paymentMode"),
  actualPaymentCapital: orderExportField("Actual Payment Capital", "actualPaymentCapital", true),
  actualPaymentRevenue: orderExportField("Actual Payment Revenue", "actualPaymentRevenue", true),
  billReturnHistory: { label: "Bill Return / Resubmission History", source: "order" },
  soDemandCancelled: orderExportField("S.O. Demand Cancelled (Yes/No)", "demandCancelled"),
  soCancelled: orderExportField("S.O. Cancelled (Yes/No)", "soCancelled"),
  soCancelledDate: orderExportField("S.O. Cancelled Date", "soCancelledDate"),
  shortclosure: orderExportField("Short Closure (Yes/No)", "shortclosure"),
  shortclosureDate: orderExportField("Short Closure Date", "shortclosureDate"),
  noFurtherAction: orderExportField("No Further Action (Yes/No)", "noFurtherAction"),
  noFurtherActionDate: orderExportField("No Further Action Date", "noFurtherActionDate"),
  psbApplicable: orderExportField("PSB Applicable", "psbApplicable"),
  bgCoverageType: orderExportField("BG Coverage Type", "bgCoverageType"),
  psbBgNo: orderExportField("PSB BG Number", "psbBgNo"),
  psbBgAmount: orderExportField("PSB BG Amount", "psbBgAmount", true),
  psbBgReceivedDate: orderExportField("PSB BG Received Date", "psbBgReceivedDate"),
  psbBgValidityDate: orderExportField("PSB BG Validity Date", "psbBgValidityDate"),
  psbBgReturnDate: orderExportField("PSB BG Return Date", "psbBgReturnDate"),
  pwbBgNo: orderExportField("PWB BG Number", "pwbBgNo"),
  pwbBgAmount: orderExportField("PWB BG Amount", "pwbBgAmount", true),
  pwbBgReceivedDate: orderExportField("PWB BG Received Date", "pwbBgReceivedDate"),
  pwbBgValidityDate: orderExportField("PWB BG Validity Date", "pwbBgValidityDate"),
  pwbBgReturnDate: orderExportField("PWB BG Return Date", "pwbBgReturnDate"),
  combinedBgNo: orderExportField("Combined BG Number", "combinedBgNo"),
  combinedBgAmount: orderExportField("Combined BG Amount", "combinedBgAmount", true),
  combinedBgReceivedDate: orderExportField("Combined BG Received Date", "combinedBgReceivedDate"),
  combinedBgValidityDate: orderExportField("Combined BG Validity Date", "combinedBgValidityDate"),
  combinedBgReturnDate: orderExportField("Combined BG Return Date", "combinedBgReturnDate"),
  warrantyPeriodDate: orderExportField("Warranty Period Date", "warrantyPeriodDate"),
  stageDelivery: orderExportField("Stage Delivery", "stageDelivery"),
  stageDeliveryCount: orderExportField("Stage Count", "stageDeliveryCount", true),
  stagePayment: orderExportField("Stage Payment", "stagePayment"),
  soCurrentMilestone: orderExportField("S.O. Current Milestone", "currentMilestone"),
  stageDeliveryLabel: stageExportField("Stage Label", "stageDeliveryLabel"),
  stageCurrentMilestone: stageExportField("Stage Current Milestone", "currentMilestone"),
  stageCompletedMilestones: stageExportField("Stage Completed Milestones", "completedMilestones"),
  stageAmountCapital: stageExportField("Stage Amount Capital", "stageAmountCapital", true),
  stageAmountRevenue: stageExportField("Stage Amount Revenue", "stageAmountRevenue", true),
  stageDpDate: stageExportField("Stage Original D.P.", "dpDate"),
  stageRevisedDp: stageExportField("Stage Revised D.P.", "revisedDp"),
  stageDeliveryPeriodStartDate: stageExportField("Stage Delivery Period Start Date", "deliveryPeriodStartDate"),
  stageDpExtension: stageExportField("Stage D.P. Extension", "dpExtension"),
  stageDpExtensionCount: stageExportField("Stage D.P. Extension Count", "dpExtensionCount", true),
  stageLd: stageExportField("Stage L.D.", "ld"),
  stageLdType: stageExportField("Stage L.D. Type", "ldType"),
  stageLdPercentage: stageExportField("Stage L.D. Percentage", "ldPercentage", true),
  stageMaterialReceiptDate: stageExportField("Stage Material Receipt Date", "materialReceiptDate"),
  stageActualJobCompletionDate: stageExportField("Stage Actual Job Completion Date", "actualJobCompletionDate"),
  stageJobCompletionDate: stageExportField("Stage Job Completion Received Date", "jobCompletionDate"),
  stageIrPreparationDate: stageExportField("Stage IR Preparation Date", "irPreparationDate"),
  stageIrReceiptDate: stageExportField("Stage IR Receipt Date", "irReceiptDate"),
  stageBillPreparationDate: stageExportField("Stage Bill Preparation Date", "billPreparationDate"),
  stageBillNo: stageExportField("Stage Bill Number", "billNo"),
  stageBillSentForPaymentDate: stageExportField("Stage Bill Sent Date", "billSentForPaymentDate"),
  stagePaymentDate: stageExportField("Stage Payment Date", "paymentDate"),
  stagePaymentMode: stageExportField("Stage Payment Mode", "paymentMode"),
  stageActualPaymentCapital: stageExportField("Stage Actual Payment Capital", "actualPaymentCapital", true),
  stageActualPaymentRevenue: stageExportField("Stage Actual Payment Revenue", "actualPaymentRevenue", true),
  stageBillReturnHistory: stageExportField("Stage Bill Return / Resubmission History", "billReturnCycles"),
  advancePayment: orderExportField("Advance Payment", "advancePayment"),
  advanceCurrentMilestone: advanceExportField("Advance Current Milestone", "currentMilestone"),
  advanceCompletedMilestones: advanceExportField("Advance Completed Milestones", "completedMilestones"),
  advanceAllocationCapital: advanceExportField("Advance Allocation Capital", "stageAmountCapital", true),
  advanceAllocationRevenue: advanceExportField("Advance Allocation Revenue", "stageAmountRevenue", true),
  advanceExpectedPaymentDate: advanceExportField("Advance Expected Payment Date", "expectedPaymentDate"),
  advanceBillPreparationDate: advanceExportField("Advance Bill Preparation Date", "billPreparationDate"),
  advanceBillNo: advanceExportField("Advance Bill Number", "billNo"),
  advanceBillSentForPaymentDate: advanceExportField("Advance Bill Sent Date", "billSentForPaymentDate"),
  advancePaymentDate: advanceExportField("Advance Payment Date", "paymentDate"),
  advancePaymentMode: advanceExportField("Advance Payment Mode", "paymentMode"),
  advanceActualPaymentCapital: advanceExportField("Advance Actual Payment Capital", "actualPaymentCapital", true),
  advanceActualPaymentRevenue: advanceExportField("Advance Actual Payment Revenue", "actualPaymentRevenue", true),
  advanceReturnHistory: { label: "Advance Return / Resubmission History", source: "advance" },
  supplementaryBillNo: supplementaryExportField("Supplementary Bill Number", "billNo"),
  supplementaryBillAmountCapital: supplementaryExportField("Supplementary Bill Amount Capital", "billAmountCapital", true),
  supplementaryBillAmountRevenue: supplementaryExportField("Supplementary Bill Amount Revenue", "billAmountRevenue", true),
  supplementaryBillSentForPaymentDate: supplementaryExportField("Supplementary Bill Sent Date", "billSentForPaymentDate"),
  supplementaryBillPaymentDate: supplementaryExportField("Supplementary Bill Payment Date", "paymentDate"),
  supplementaryBillPaymentMode: supplementaryExportField("Supplementary Bill Payment Mode", "paymentMode"),
  supplementaryBillActualPaymentCapital: supplementaryExportField("Supplementary Actual Payment Capital", "actualPaymentCapital", true),
  supplementaryBillActualPaymentRevenue: supplementaryExportField("Supplementary Actual Payment Revenue", "actualPaymentRevenue", true),
  supplementaryBillReturnHistory: supplementaryExportField("Supplementary Return / Resubmission History", "billReturnCycles"),
  supplementaryBillRemarks: supplementaryExportField("Supplementary Bill Remarks", "remarks"),
};

const quickEntryExportDateFields = new Set([
  "fileDate", "receivedDate", "fileClosureDate", "demandCancelledDate",
  "scrutinyDate", "scrutinyResponseDate", "scrutinyCompletionDate", "immsDate",
  "highValueMeetingDate", "highValueMinutesDate", "adSentDate", "adVettingDate",
  "preTcecDate", "preTcecMinutesDate", "rqaSentDate", "rqaApprovalDate",
  "ifaSentDate", "ifaFinalDate", "cfaSentDate", "cfaDate", "cncDate",
  "cncApprovalDate", "gemUndertakingDate", "refloatGemUndertakingDate", "refloatRecommendationDate", "rfpVettingInitiationDate",
  "rfpVettingApprovalDate", "preBidMeetingDate", "bidDate", "bidOpeningDate",
  "postTcecDate", "postTcecMinutesDate", "refloatPreBidMeetingDate",
  "refloatBiddingDate", "refloatBidOpeningDate", "refloatPostTcecDate",
  "refloatPostTcecMinutesDate", "soDate", "dpDate", "deliveryPeriodStartDate",
  "revisedDp", "materialReceiptDate", "actualJobCompletionDate", "jobCompletionDate",
  "irPreparationDate", "irReceiptDate", "billPreparationDate", "billSentForPaymentDate",
  "paymentDate", "soCancelledDate", "shortclosureDate", "noFurtherActionDate",
  "psbBgReceivedDate", "psbBgValidityDate", "psbBgReturnDate", "pwbBgReceivedDate",
  "pwbBgValidityDate", "pwbBgReturnDate", "combinedBgReceivedDate",
  "combinedBgValidityDate", "combinedBgReturnDate", "warrantyPeriodDate",
  "stageDpDate", "stageRevisedDp", "stageDeliveryPeriodStartDate",
  "stageMaterialReceiptDate", "stageActualJobCompletionDate", "stageJobCompletionDate",
  "stageIrPreparationDate", "stageIrReceiptDate", "stageBillPreparationDate",
  "stageBillSentForPaymentDate", "stagePaymentDate", "advanceExpectedPaymentDate",
  "advanceBillPreparationDate", "advanceBillSentForPaymentDate", "advancePaymentDate",
  "supplementaryBillSentForPaymentDate",
  "supplementaryBillPaymentDate",
]);

type QuickEntryExportColumn = {
  header: string;
  field?: QuickEntryExportField;
  itemIndex?: number;
  date?: boolean;
  numeric?: boolean;
  aggregate?: "soAmountCapital" | "soAmountRevenue" | "paidSoFar" | "latestStageDate" | "currency";
  statusIndex?: number;
  statusPart?: "text" | "dateTime";
};

const quickEntryStageDateFields: Record<string, string> = {
  stageMaterialReceiptDate: "materialReceiptDate",
  stageActualJobCompletionDate: "actualJobCompletionDate",
  stageJobCompletionDate: "jobCompletionDate",
  stageIrPreparationDate: "irPreparationDate",
  stageIrReceiptDate: "irReceiptDate",
};
const quickEntryOrderToStageDateFields: Record<string, string> = {
  materialReceiptDate: "materialReceiptDate",
  actualJobCompletionDate: "actualJobCompletionDate",
  jobCompletionDate: "jobCompletionDate",
  irPreparationDate: "irPreparationDate",
  irReceiptDate: "irReceiptDate",
};
const quickEntryAmountKeys = new Set([
  "soValueCapital", "soValueRevenue", "stageAmountCapital", "stageAmountRevenue",
]);
const quickEntryActualPaymentKeys = new Set([
  "actualPaymentCapital", "actualPaymentRevenue", "stageActualPaymentCapital",
  "stageActualPaymentRevenue", "advanceActualPaymentCapital", "advanceActualPaymentRevenue",
  "supplementaryBillActualPaymentCapital", "supplementaryBillActualPaymentRevenue",
]);
const quickEntryReturnHistoryFieldKeys = new Set([
  "billReturnHistory", "stageBillReturnHistory", "advanceReturnHistory",
  "supplementaryBillReturnHistory",
]);

function dateFallsInRange(value: string | undefined, range: { start: string; end: string }) {
  const date = value?.slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= range.start && date <= range.end;
}

function formatQuickEntryReturnHistory(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value
    .map((cycle, index) => {
      if (!cycle || typeof cycle !== "object") return "";
      const item = cycle as Record<string, unknown>;
      const details = [
        `Return ${index + 1}: ${String(item.returnedDate ?? "date not recorded")}`,
        item.resubmittedDate ? `Resubmitted: ${String(item.resubmittedDate)}` : "Not resubmitted",
        item.reason ? `Reason: ${String(item.reason)}` : "",
      ].filter(Boolean);
      return details.join("; ");
    })
    .filter(Boolean)
    .join("\n");
}

function formatQuickEntryStatusDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

function getQuickEntryReturnHistory(order: SupplyOrderDetail) {
  const histories = [
    formatQuickEntryReturnHistory(order.billReturnCycles),
    ...(order.stageDeliveries ?? []).map((stage) => formatQuickEntryReturnHistory(stage.billReturnCycles)),
    formatQuickEntryReturnHistory(order.advancePaymentDetail?.billReturnCycles),
    ...(order.supplementaryBills ?? []).map((bill) => formatQuickEntryReturnHistory(bill.billReturnCycles)),
  ];
  return histories.filter(Boolean).join("\n");
}

function getQuickEntryExportFieldValue(
  key: string,
  field: QuickEntryExportField,
  file: FileRecord,
  order: SupplyOrderDetail | undefined,
  itemIndex: number | undefined,
) {
  if (field.source === "file") {
    return (file as unknown as Record<string, unknown>)[field.field ?? ""];
  }
  if (field.source === "order") {
    if (key === "billReturnHistory") return order ? getQuickEntryReturnHistory(order) : "";
    if (field.field === "soNo") return order?.soNo || order?.gemSoNo;
    if (key === "dpDate" && order) return getQuickEntryExportDpDate(order);
    return order ? (order as unknown as Record<string, unknown>)[field.field ?? ""] : undefined;
  }
  if (field.source === "stage") {
    const stage = order?.stageDeliveries?.[itemIndex ?? -1];
    const value = stage ? (stage as unknown as Record<string, unknown>)[field.field ?? ""] : undefined;
    return field.field === "billReturnCycles" ? formatQuickEntryReturnHistory(value) : value;
  }
  if (field.source === "advance") {
    if (key === "advanceReturnHistory") {
      return formatQuickEntryReturnHistory(order?.advancePaymentDetail?.billReturnCycles);
    }
    const advance = order?.advancePaymentDetail;
    return advance ? (advance as unknown as Record<string, unknown>)[field.field ?? ""] : undefined;
  }
  if (field.source === "supplementary") {
    const bill = order?.supplementaryBills?.[itemIndex ?? -1];
    const value = bill ? (bill as unknown as Record<string, unknown>)[field.field ?? ""] : undefined;
    return field.field === "billReturnCycles" ? formatQuickEntryReturnHistory(value) : value;
  }
  if (key === "fileClosed") {
    return file.fileClosureDate || normalizeMilestoneName(file.currentMilestone ?? "") === "fileclosed"
      ? "Yes"
      : "No";
  }
  if (key === "fileRemarks") {
    return (file.remarks ?? [])
      .map((remark) => [remark.section, remark.text].filter(Boolean).join(": "))
      .join("\n");
  }
  if (key === "fileMarkers") {
    return (file.markers ?? []).map((marker) => marker.text).filter(Boolean).join("\n");
  }
  return undefined;
}

function formatQuickEntryExportValue(value: unknown) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => String(item ?? "")).join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

filesRouter.post(
  "/quick-entry/export",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const body = requireObjectBody(request.body);
    const fields = Array.isArray(body.fields)
      ? [...new Set(body.fields.filter((field): field is string => typeof field === "string"))]
      : [];
    if (!fields.length || fields.some((field) => !quickEntryExportFields[field])) {
      throw new HttpError(400, "Select one or more valid Quick Entry export fields.");
    }
    const scopeMode = body.scopeMode === "so" ? "so" : body.scopeMode === "fy" ? "fy" : undefined;
    if (!scopeMode) throw new HttpError(400, "Select FY Based or S.O. Based export scope.");
    const viewMode = body.viewMode === "expanded" ? "expanded" : "collapsed";
    const financialYear = normalizeFinancialYearLabel(body.financialYear);
    const dateRange = getFinancialYearDateRange(financialYear);
    if (!dateRange) throw new HttpError(400, "Select a valid financial year.");
    const selectedFileTypes = Array.isArray(body.fileTypes)
      ? [...new Set(body.fileTypes
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean))]
      : [];
    const selectedFileTypeLabels = Array.isArray(body.fileTypes)
      ? [...new Set(body.fileTypes
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean))]
      : [];
    const selectedDivisionId = typeof body.divisionId === "string" ? body.divisionId.trim() : "";
    if (selectedDivisionId && !canAccessDivision(user, selectedDivisionId)) {
      throw new HttpError(403, "You cannot export files from this division.");
    }
    if (scopeMode === "so" && !fields.includes("soDate")) fields.push("soDate");

    const scope = getDivisionScopeCondition(user);
    const categoryScope = getFileCategoryScopeCondition(user);
    const conditions = [scope.sql, categoryScope.sql].filter(Boolean);
    const values = scope.values;
    if (selectedDivisionId) {
      values.push(selectedDivisionId);
      conditions.push(`f.division_id = $${values.length}::uuid`);
    }
    const files = await loadFiles(
      conditions.length ? `where ${conditions.join(" and ")}` : "",
      values,
      true,
    );
    const records = files
      .map((file) => {
        const fileType = file.fileType?.trim().toLowerCase() ?? "";
        const matchesFileType =
          !selectedFileTypes.length ||
          selectedFileTypes.includes(fileType) ||
          (!fileType && selectedFileTypes.includes("goods & services"));
        if (!matchesFileType) return undefined;
        const orders = (file.supplyOrders ?? []).filter((order) =>
          scopeMode === "so" ? dateFallsInRange(order.soDate, dateRange) : true,
        );
        if (scopeMode === "fy" && !dateFallsInRange(file.receivedDate, dateRange)) return undefined;
        if (scopeMode === "so" && !orders.length) return undefined;
        return { file, orders };
      })
      .filter((record): record is { file: FileRecord; orders: SupplyOrderDetail[] } => Boolean(record));
    records.sort((left, right) => {
      const leftDate = scopeMode === "fy"
        ? left.file.receivedDate ?? ""
        : left.orders.map((order) => order.soDate ?? "").sort()[0] ?? "";
      const rightDate = scopeMode === "fy"
        ? right.file.receivedDate ?? ""
        : right.orders.map((order) => order.soDate ?? "").sort()[0] ?? "";
      return leftDate.localeCompare(rightDate) || left.file.createdAt.localeCompare(right.file.createdAt) || left.file.id.localeCompare(right.file.id);
    });

    const stagePaymentFieldKeys = new Set([
      "stageBillPreparationDate", "stageBillNo", "stageBillSentForPaymentDate",
      "stagePaymentDate", "stagePaymentMode", "stageActualPaymentCapital",
      "stageActualPaymentRevenue", "stageBillReturnHistory",
    ]);
    const includesOrderData = fields.some((key) => {
      const field = quickEntryExportFields[key];
      if (key === "stageDeliveryLabel") return [];
      return field.source !== "file" && !["fileClosed", "fileRemarks", "fileMarkers"].includes(key);
    });
    const hasAmountFields = fields.some((key) => quickEntryAmountKeys.has(key));
    const hasPaymentAmountFields = fields.some((key) => quickEntryActualPaymentKeys.has(key));
    const hasReturnHistoryFields = fields.some((key) => quickEntryReturnHistoryFieldKeys.has(key));
    const amountComponentsAdded = new Set<string>();
    const columns: QuickEntryExportColumn[] = fields.flatMap<QuickEntryExportColumn>((key) => {
      const field = quickEntryExportFields[key];
      if (quickEntryReturnHistoryFieldKeys.has(key)) return [];
      if (quickEntryAmountKeys.has(key)) {
        const component = key.endsWith("Capital") ? "capital" : "revenue";
        if (amountComponentsAdded.has(component)) return [];
        amountComponentsAdded.add(component);
        return [{
          header: `S.O./Stage ${component === "capital" ? "Capital" : "Revenue"} Amount`,
          field,
          aggregate: component === "capital" ? "soAmountCapital" as const : "soAmountRevenue" as const,
          numeric: true,
        }];
      }
      if (field.source === "stage") {
        if (viewMode === "expanded") {
          return [{ header: field.label, field, date: quickEntryExportDateFields.has(key) }];
        }
        if (stagePaymentFieldKeys.has(key) || key === "stageDeliveryLabel") {
          return [{ header: field.label, field, date: quickEntryExportDateFields.has(key) }];
        }
        const stageDateField = quickEntryStageDateFields[key];
        return stageDateField
          ? [{ header: field.label.replace(/^Stage /, "Latest stage "), field, aggregate: "latestStageDate", date: true }]
          : [];
      }
      if (field.source === "supplementary") {
        return [{ header: field.label, field, date: quickEntryExportDateFields.has(key) }];
      }
      const collapsedStageDateLabel = viewMode === "collapsed" && key in quickEntryOrderToStageDateFields
        ? `${field.label} (latest stage when staged)`
        : field.label;
      return [{ header: collapsedStageDateLabel, field, date: quickEntryExportDateFields.has(key) }];
    });
    if (viewMode === "collapsed" && hasPaymentAmountFields) {
      columns.push({ header: "Total Paid So Far", aggregate: "paidSoFar", numeric: true });
    }
    if ((hasAmountFields || (viewMode === "collapsed" && hasPaymentAmountFields)) && !fields.includes("currency")) {
      columns.push({
        header: "Currency",
        field: quickEntryExportFields.currency,
        aggregate: "currency",
      });
    }
    if (hasReturnHistoryFields) {
      columns.push(
        { header: "Bill Event Type" },
        { header: "Bill Event Date", date: true },
        { header: "Return Cycle" },
        { header: "Return Reason" },
        { header: "Return Remarks" },
      );
    }

    await ensureFileStatusSchema();
    const fileIds = records.map(({ file }) => file.id);
    const statusResult = fileIds.length
      ? await pool.query<{ file_id: string; text: string; created_at: Date | string }>(
          `select fs.file_id, fs.text, fs.created_at
           from file_status_updates fs
           join files f on f.id = fs.file_id
           where fs.file_id = any($1::uuid[])
           order by fs.created_at asc, fs.id asc`,
          [fileIds],
        )
      : { rows: [] as Array<{ file_id: string; text: string; created_at: Date | string }> };
    const statusByFile = new Map<string, Array<{ text: string; createdAt: Date | string }>>();
    for (const status of statusResult.rows) {
      statusByFile.set(status.file_id, [
        ...(statusByFile.get(status.file_id) ?? []),
        { text: status.text, createdAt: status.created_at },
      ]);
    }
    const maxStatusCount = Array.from(statusByFile.values()).reduce(
      (max, items) => Math.max(max, items.length),
      1,
    );
    for (let index = 0; index < maxStatusCount; index += 1) {
      columns.push({ header: `File Status ${index + 1}`, statusIndex: index, statusPart: "text" });
      columns.push({ header: `Status ${index + 1} Date & Time`, statusIndex: index, statusPart: "dateTime" });
    }

    type QuickEntryOutputRecord = {
      file: FileRecord;
      order?: SupplyOrderDetail;
      orderIndex?: number;
      stageIndex?: number;
      rowType: "File summary" | "S.O. summary" | "Stage" | "S.O. payment" | "Stage payment" | "Advance" | "Supplementary bill" | "Bill event";
      supplementaryBill?: SupplementaryBillDetail;
      supplementaryItemIndex?: number;
      billKind?: "regular" | "stage" | "advance" | "supplementary";
      billIndex?: number;
      billId?: string;
      billEventType?: string;
      billEventDate?: string;
      returnCycleIndex?: number;
      returnReason?: string;
      returnRemarks?: string;
    };
    const orderPaymentFieldKeys = new Set([
      "billPreparationDate", "billNo", "billAmountCapital", "billAmountRevenue",
      "billSentForPaymentDate", "paymentDate", "paymentMode", "actualPaymentCapital",
      "actualPaymentRevenue", "billReturnHistory",
    ]);
    const advanceFieldKeys = new Set(fields.filter((key) => quickEntryExportFields[key].source === "advance"));
    const hasStagePaymentFields = fields.some((key) => stagePaymentFieldKeys.has(key));
    const hasOrderPaymentFields = fields.some((key) => orderPaymentFieldKeys.has(key));
    const hasRegularReturnHistory = fields.includes("billReturnHistory");
    const hasStageReturnHistory = fields.includes("stageBillReturnHistory");
    const hasAdvanceReturnHistory = fields.includes("advanceReturnHistory");
    const hasSupplementaryReturnHistory = fields.includes("supplementaryBillReturnHistory");
    const hasSupplementaryFields = fields.some(
      (key) => quickEntryExportFields[key].source === "supplementary",
    );
    const hasAnyValue = (values: unknown[]) => values.some((value) =>
      Array.isArray(value)
        ? value.length > 0
        : String(value ?? "").trim().length > 0,
    );
    const makeOrderRows = (
      file: FileRecord,
      order: SupplyOrderDetail | undefined,
      orderIndex?: number,
    ): QuickEntryOutputRecord[] => {
      if (!order) return [];
      const stages = order.stageDeliveries ?? [];
      const supplementaryBills = order.supplementaryBills ?? [];
      const isStaged = order.stageDelivery?.trim().toLowerCase() === "yes";
      const stagePaymentIndexes = isStaged && order.stagePayment?.trim().toLowerCase() === "yes" && hasStagePaymentFields && !hasStageReturnHistory
        ? stages.flatMap((stage, stageIndex) => hasAnyValue([
            stage.billPreparationDate, stage.billNo, stage.billSentForPaymentDate,
            stage.paymentDate, stage.paymentMode, stage.actualPaymentCapital,
            stage.actualPaymentRevenue, stage.billReturnCycles,
          ]) ? [stageIndex] : [])
        : [];
      const advance = order.advancePaymentDetail;
      const includeAdvance = order.advancePayment?.trim().toLowerCase() === "yes" &&
        advanceFieldKeys.size > 0 && !hasAdvanceReturnHistory && Boolean(advance) &&
        hasAnyValue(Object.entries(advance ?? {})
          .filter(([key]) => key !== "id" && key !== "includeInPaymentTiming")
          .map(([, value]) => value));
      const includeOrderPayment = hasOrderPaymentFields && !hasRegularReturnHistory &&
        !(isStaged && order.stagePayment?.trim().toLowerCase() === "yes") &&
        hasAnyValue([
          order.billPreparationDate, order.billNo, order.billAmountCapital,
          order.billAmountRevenue, order.billSentForPaymentDate, order.paymentDate,
          order.paymentMode, order.actualPaymentCapital, order.actualPaymentRevenue,
          order.billReturnCycles,
        ]);
      const supplementaryIndexes = hasSupplementaryFields && !hasSupplementaryReturnHistory
        ? supplementaryBills.flatMap((bill, index) => hasAnyValue([
            bill.billNo, bill.billAmountCapital, bill.billAmountRevenue,
            bill.billSentForPaymentDate, bill.paymentDate, bill.paymentMode,
            bill.actualPaymentCapital, bill.actualPaymentRevenue, bill.billReturnCycles, bill.remarks,
          ]) ? [index] : [])
        : [];
      const plannedRows = getQuickEntryExportRowPlan(
        viewMode,
        isStaged,
        stages,
        {
          includeOrderPayment,
          stagePaymentIndexes,
          includeAdvance,
          supplementarySentDates: supplementaryIndexes.map((index) => supplementaryBills[index]?.billSentForPaymentDate ?? ""),
        },
      ).map((row) => ({
        file,
        order,
        orderIndex,
        rowType: row.rowType,
        stageIndex: row.stageIndex,
        supplementaryItemIndex: row.supplementaryItemIndex === undefined
          ? undefined
          : supplementaryIndexes[row.supplementaryItemIndex],
        supplementaryBill: row.supplementaryItemIndex === undefined
          ? undefined
          : supplementaryBills[supplementaryIndexes[row.supplementaryItemIndex]],
      }));
      const billEventRows: QuickEntryOutputRecord[] = [];
      const orderId = order.id || `${file.id}:SO-${orderIndex ?? 0}`;
      const appendEvents = (
        billKind: NonNullable<QuickEntryOutputRecord["billKind"]>,
        billId: string,
        sentDate: string | undefined,
        cycles: BillReturnCycle[] | undefined,
        paymentDate: string | undefined,
        hasBillData: boolean,
        stageIndex?: number,
        supplementaryItemIndex?: number,
        supplementaryBill?: SupplementaryBillDetail,
      ) => {
        const events = getQuickEntryBillLifecycleEvents(sentDate, cycles, paymentDate);
        const items: Array<{
          eventType: string;
          eventDate: string;
          cycleIndex?: number;
          reason?: string;
          remarks?: string;
        }> = events.length
          ? events
          : hasBillData ? [{ eventType: "Bill details", eventDate: "" }] : [];
        for (const event of items) {
          billEventRows.push({
            file, order, orderIndex, rowType: "Bill event", billKind, billId,
            stageIndex, supplementaryItemIndex, supplementaryBill,
            billEventType: event.eventType,
            billEventDate: event.eventDate,
            returnCycleIndex: event.cycleIndex,
            returnReason: event.reason,
            returnRemarks: event.remarks,
          });
        }
      };
      if (hasRegularReturnHistory && !(isStaged && order.stagePayment?.trim().toLowerCase() === "yes")) {
        appendEvents("regular", `${orderId}:REGULAR-BILL`, order.billSentForPaymentDate,
          order.billReturnCycles, order.paymentDate, hasAnyValue([
            order.billNo, order.billAmountCapital, order.billAmountRevenue, order.paymentDate,
          ]));
      }
      if (hasStageReturnHistory && isStaged && order.stagePayment?.trim().toLowerCase() === "yes") {
        stages.forEach((stage, stageIndex) => appendEvents(
          "stage", `${orderId}:STAGE-${stageIndex + 1}-BILL`, stage.billSentForPaymentDate,
          stage.billReturnCycles, stage.paymentDate, hasAnyValue([
            stage.billNo, stage.billSentForPaymentDate, stage.paymentDate,
          ]), stageIndex,
        ));
      }
      if (hasAdvanceReturnHistory && order.advancePayment?.trim().toLowerCase() === "yes" && advance) {
        appendEvents("advance", `${orderId}:ADVANCE-BILL`, advance.billSentForPaymentDate,
          advance.billReturnCycles, advance.paymentDate, hasAnyValue([
            advance.billNo, advance.stageAmountCapital, advance.stageAmountRevenue, advance.paymentDate,
          ]), isStaged && stages.length ? 0 : undefined);
      }
      if (hasSupplementaryReturnHistory) {
        supplementaryBills.forEach((bill, index) => {
          if (!hasAnyValue([
            bill.billNo, bill.billAmountCapital, bill.billAmountRevenue,
            bill.billSentForPaymentDate, bill.paymentDate, bill.billReturnCycles,
          ])) return;
          appendEvents("supplementary", bill.id || `${orderId}:SUPP-${index + 1}`,
            bill.billSentForPaymentDate, bill.billReturnCycles, bill.paymentDate,
            hasAnyValue([bill.billNo, bill.billAmountCapital, bill.billAmountRevenue, bill.paymentDate]),
            undefined, index, bill);
        });
      }
      return [...plannedRows, ...billEventRows];
    };
    columns.unshift(
      { header: "Export Row Type" },
      { header: "File ID" },
      { header: "S.O. ID" },
      { header: "Stage Label" },
      ...(hasReturnHistoryFields ? [{ header: "Bill ID" }] : []),
      ...(hasSupplementaryFields ? [{ header: "Supplementary Bill ID" }] : []),
    );
    const outputRecords = scopeMode === "so"
      ? records.flatMap(({ file, orders }) => [
          { file, rowType: "File summary" as const },
          ...[...orders]
            .sort((left, right) => (left.soDate ?? "").localeCompare(right.soDate ?? ""))
            .flatMap((order, orderIndex) => makeOrderRows(file, order, orderIndex)),
        ])
      : records.flatMap(({ file, orders: matchingOrders }) => {
          const rowOrders = includesOrderData ? matchingOrders : [];
          return [
            { file, rowType: "File summary" as const },
            ...rowOrders.flatMap((order, orderIndex) => makeOrderRows(file, order, orderIndex)),
          ];
        });
    const rows: string[][] = outputRecords.map(({
      file,
      order,
      orderIndex,
      stageIndex,
      rowType,
      supplementaryBill,
      supplementaryItemIndex,
      billKind,
      billId,
      billEventType,
      billEventDate,
      returnCycleIndex,
      returnReason,
      returnRemarks,
    }) => {
      const statuses = statusByFile.get(file.id) ?? [];
      return columns.map((column) => {
        if (column.header === "Export Row Type") return rowType;
        if (column.header === "File ID") return file.id;
        if (column.header === "S.O. ID") {
          return order?.id ?? "";
        }
        if (column.header === "Stage Label") {
          if (stageIndex !== undefined) return `Stage ${stageIndex + 1}`;
          return rowType === "Supplementary bill" ? "Unassigned" : "";
        }
        if (column.header === "Bill ID") {
          return rowType === "Bill event" ? billId ?? "" : "";
        }
        if (column.header === "Supplementary Bill ID") {
          return rowType === "Supplementary bill"
            ? supplementaryBill?.id || `SB-${(supplementaryItemIndex ?? 0) + 1}`
            : "";
        }
        if (column.header === "Bill Event Type") return rowType === "Bill event" ? billEventType ?? "" : "";
        if (column.header === "Bill Event Date") return rowType === "Bill event" ? billEventDate ?? "" : "";
        if (column.header === "Return Cycle") {
          return rowType === "Bill event" && returnCycleIndex !== undefined
            ? String(returnCycleIndex + 1)
            : "";
        }
        if (column.header === "Return Reason") return rowType === "Bill event" ? returnReason ?? "" : "";
        if (column.header === "Return Remarks") return rowType === "Bill event" ? returnRemarks ?? "" : "";
        if (column.statusIndex !== undefined) {
          if (rowType !== "File summary") return "";
          const status = statuses[column.statusIndex];
          if (!status) return "";
          return column.statusPart === "dateTime"
            ? formatQuickEntryStatusDate(status.createdAt)
            : status.text;
        }
        if (column.aggregate === "soAmountCapital" || column.aggregate === "soAmountRevenue") {
          if (!order) return "";
          const component = column.aggregate === "soAmountCapital" ? "capital" : "revenue";
          if (rowType === "Stage" && stageIndex !== undefined) {
            const stage = order.stageDeliveries?.[stageIndex];
            if (!stage) return "";
            return formatQuickEntryExportValue(
              getQuickEntryExportSoAmountComponent(order, component, stage),
            );
          }
          if (rowType !== "S.O. summary") return "";
          return formatQuickEntryExportValue(getQuickEntryExportSoAmountComponent(order, component));
        }
        if (column.aggregate === "paidSoFar") {
          if (rowType !== "S.O. summary") return "";
          return order ? formatQuickEntryExportValue(getQuickEntryExportPaidSoFar(order)) : "";
        }
        if (column.aggregate === "currency") {
          return formatQuickEntryExportValue(file.currency);
        }
        if (!column.field) return "";
        const key = fields.find((fieldKey) => quickEntryExportFields[fieldKey] === column.field) ??
          (column.field.field === "stageDeliveryLabel" ? "stageDeliveryLabel" : "");
        const stage = stageIndex === undefined ? undefined : order?.stageDeliveries?.[stageIndex];
        if (!isQuickEntryExportFieldApplicable(key, {
          inspectionApplicable: isDeliveryInspectionApplicableByGroup(file),
          biddingApplicable: isBiddingApplicableForFile(file),
          file: file as unknown as Record<string, unknown>,
          order: order as unknown as Record<string, unknown> | undefined,
        })) return "";
        const fileIdentityKeys = new Set([
          "uniqueCode", "controlNo", "fileNo", "year", "receivedDate", "division",
          "indentor", "demandDescription", "fileType", "currency",
        ]);
        const orderIdentityKeys = new Set(["soNo", "gemSoNo", "soDate", "firm"]);
        if (rowType === "Bill event") {
          const eventType = billEventType ?? "";
          if (column.field.source === "order") {
            if (billKind !== "regular") return "";
            if (orderIdentityKeys.has(column.field.field ?? "") || key === "billNo") {
              // Identifiers repeat to keep each event row traceable.
            } else if (["billPreparationDate", "billAmountCapital", "billAmountRevenue", "billSentForPaymentDate"].includes(key)) {
              if (eventType !== "Bill sent" && eventType !== "Bill details") return "";
            } else if (["paymentDate", "paymentMode", "actualPaymentCapital", "actualPaymentRevenue"].includes(key)) {
              if (eventType !== "Paid" && eventType !== "Bill details") return "";
            } else return "";
          } else if (column.field.source === "stage") {
            if (billKind !== "stage" || !stage) return "";
            if (["stageBillNo"].includes(key)) {
              // Identifiers repeat to keep each event row traceable.
            } else if (["stageBillPreparationDate", "stageBillSentForPaymentDate"].includes(key)) {
              if (eventType !== "Bill sent" && eventType !== "Bill details") return "";
            } else if (["stagePaymentDate", "stagePaymentMode", "stageActualPaymentCapital", "stageActualPaymentRevenue"].includes(key)) {
              if (eventType !== "Paid" && eventType !== "Bill details") return "";
            } else return "";
          } else if (column.field.source === "advance") {
            if (billKind !== "advance") return "";
            if (key === "advanceBillNo") {
              // Identifiers repeat to keep each event row traceable.
            } else if (["advanceBillPreparationDate", "advanceBillSentForPaymentDate", "advanceAllocationCapital", "advanceAllocationRevenue"].includes(key)) {
              if (eventType !== "Bill sent" && eventType !== "Bill details") return "";
            } else if (["advancePaymentDate", "advancePaymentMode", "advanceActualPaymentCapital", "advanceActualPaymentRevenue"].includes(key)) {
              if (eventType !== "Paid" && eventType !== "Bill details") return "";
            } else return "";
          } else if (column.field.source === "supplementary") {
            if (billKind !== "supplementary") return "";
            if (key === "supplementaryBillNo" || key === "supplementaryBillRemarks") {
              // Identifiers and notes repeat to keep each event row traceable.
            } else if (["supplementaryBillAmountCapital", "supplementaryBillAmountRevenue", "supplementaryBillSentForPaymentDate"].includes(key)) {
              if (eventType !== "Bill sent" && eventType !== "Bill details") return "";
            } else if (["supplementaryBillPaymentDate", "supplementaryBillPaymentMode", "supplementaryBillActualPaymentCapital", "supplementaryBillActualPaymentRevenue"].includes(key)) {
              if (eventType !== "Paid" && eventType !== "Bill details") return "";
            } else return "";
          }
        }
        if (column.field.source === "file" && rowType !== "File summary" &&
          !fileIdentityKeys.has(column.field.field ?? "")) return "";
        if (column.field.source === "order") {
          if (rowType === "S.O. summary" && orderPaymentFieldKeys.has(key)) return "";
          if (rowType === "S.O. payment" && !orderPaymentFieldKeys.has(key)) return "";
          if (!new Set(["S.O. summary", "S.O. payment", "Bill event"]).has(rowType) &&
            !orderIdentityKeys.has(column.field.field ?? "")) return "";
        }
        if (column.field.source === "stage") {
          if (rowType === "Stage" && stagePaymentFieldKeys.has(key)) return "";
          if (rowType === "Stage payment" && !stagePaymentFieldKeys.has(key)) return "";
          if (rowType === "S.O. summary" && column.aggregate === "latestStageDate") {
            // Collapsed view carries the latest dated stage value on the S.O. summary row.
          } else if (!new Set(["Stage", "Stage payment"]).has(rowType)) return "";
        }
        if (column.field.source === "advance" && rowType !== "Advance") return "";
        if (column.field.source === "supplementary" && rowType !== "Supplementary bill") return "";
        let value: unknown;
        if (column.aggregate === "latestStageDate" && order) {
          const dateKey = column.field.field ?? "";
          const stages = order.stageDelivery?.trim().toLowerCase() === "yes" ? order.stageDeliveries ?? [] : [];
          const dates = (stages as Array<Record<string, unknown>>)
            .map((item) => (item as unknown as Record<string, unknown>)[dateKey])
            .filter((item): item is string => typeof item === "string" && Boolean(item));
          value = dates.sort().at(-1) || (order as unknown as Record<string, unknown>)[dateKey];
        } else if (column.field.source === "stage") {
          value = stage ? (stage as unknown as Record<string, unknown>)[column.field.field ?? ""] : undefined;
        } else if (column.field.source === "order" && key === "dpDate") {
          value = stage ? stage.revisedDp || stage.dpDate || "" : order ? getQuickEntryExportDpDate(order) : "";
        } else if (column.field.source === "order" && key in quickEntryOrderToStageDateFields) {
          const dateKey = quickEntryOrderToStageDateFields[key];
          if (viewMode === "expanded" && stage) {
            value = (stage as unknown as Record<string, unknown>)[dateKey];
          } else if (viewMode === "collapsed" && order?.stageDelivery?.trim().toLowerCase() === "yes" && order.stageDeliveries?.length) {
            const dates = (order.stageDeliveries as Array<Record<string, unknown>>)
              .map((item) => (item as unknown as Record<string, unknown>)[dateKey])
              .filter((item): item is string => typeof item === "string" && Boolean(item));
            value = dates.sort().at(-1) || (order as unknown as Record<string, unknown>)[dateKey];
          } else {
            value = getQuickEntryExportFieldValue(key, column.field, file, order, column.itemIndex);
          }
        } else {
          const itemIndex = column.field.source === "supplementary"
            ? supplementaryItemIndex
            : column.itemIndex;
          value = getQuickEntryExportFieldValue(key, column.field, file, order, itemIndex);
        }
        return formatQuickEntryExportValue(value);
      });
    });
    const exportedAt = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
    const scopeDetails = [
      ["Export mode", scopeMode === "fy" ? "FY Based" : "S.O. Based"],
      ["Selected financial year", financialYear],
      ["Date basis", scopeMode === "fy" ? "File received date" : "S.O. date"],
      ["File types", selectedFileTypeLabels.length ? selectedFileTypeLabels.join(", ") : "All file types"],
      ["Division", selectedDivisionId ? Array.from(new Set(records.map(({ file }) => file.division).filter(Boolean))).join(", ") || selectedDivisionId : "All divisions"],
      ["View", viewMode === "expanded" ? "Expanded (one row per stage; unassigned supplementary bills get separate rows)" : "Collapsed (one row per S.O.)"],
      ["Exported at (IST)", exportedAt],
      ["Files represented", String(records.length)],
      ["S.O.s in export scope", String(records.reduce((total, record) => total + record.orders.length, 0))],
      ["Rows exported", String(rows.length)],
    ];

    const requestedName =
      typeof body.fileName === "string" ? body.fileName : "Quick_Entry_Export.xlsx";
    const fileName = requestedName
      .replace(/[\\/\\"\u0000-\u001f]/g, "-")
      .replace(/\.xlsx$/i, "")
      .slice(0, 160) + ".xlsx";
    const document = {
      title:
        typeof body.title === "string" ? body.title.slice(0, 160) : "Quick Entry Export",
      description: `${scopeMode === "fy" ? `Files received in FY ${financialYear}` : `S.O.s dated in FY ${financialYear}, including files received in earlier years`}. ${viewMode === "expanded" ? "Expanded view exports one row per stage, with separate rows for supplementary bills that cannot be associated with a stage." : "Collapsed view exports one row per S.O."} Status history follows oldest to newest. Files represented: ${records.length}; rows exported: ${rows.length}.`,
      tables: [
        {
          headers: columns.map((column) => column.header),
          rows,
          numericColumns: columns.flatMap((column, index) =>
            column.numeric || column.field?.numeric ? [index] : [],
          ),
          dateColumns: columns.flatMap((column, index) =>
            column.date ? [index] : [],
          ),
          dateTimeColumns: columns.flatMap((column, index) =>
            column.statusPart === "dateTime" ? [index] : [],
          ),
        },
      ],
      sheets: [
        {
          name: "Scope",
          tables: [
            {
              title: "Export scope",
              headers: ["Export detail", "Value"],
              rows: scopeDetails,
              columnWidths: [28, 54],
            },
            {
              title: "Data rows by sheet (headers excluded)",
              headers: ["Worksheet", "Data rows"],
              rows: [["Report", String(rows.length)]],
              numericColumns: [1],
              columnWidths: [36, 16],
            },
          ],
        },
      ],
    };
    response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    response.send(renderExcelDocument(document));
  }),
);

filesRouter.get(
  "/search",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const scope = getDivisionScopeCondition(user);
    const categoryScope = getFileCategoryScopeCondition(user);
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (scope.sql) {
      conditions.push(scope.sql);
      values.push(...scope.values);
    }
    if (categoryScope.sql) conditions.push(categoryScope.sql);
    const searchParams = readSearchParams(request.query);
    const selectedYear = normalizeFinancialYearLabel(readQueryString(request.query.selectedYear));
    const currentFinancialYear = await loadCurrentFinancialYear();
    const thresholdFinancialYear = getThresholdFinancialYear(selectedYear, currentFinancialYear);
    appendSearchGlobalYearScope(
      conditions,
      values,
      selectedYear,
      currentFinancialYear,
      searchParams,
    );
    const page = readPositiveInteger(request.query.page, 1, 1_000_000);
    const pageSize = readPositiveInteger(request.query.pageSize, 100, 500);

    const results = await loadSearchFiles(
      buildSearchSql(conditions, values, searchParams, request.query, thresholdFinancialYear),
    );
    response.json({
      files: results.files,
      total: results.total,
      summaryTotals: results.summaryTotals,
      page,
      pageSize,
    });
  }),
);

filesRouter.post(
  "/export/search",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const body = requireObjectBody(request.body);
    const format = body.format === "pdf" ? "pdf" : "excel";
    const layout = readFileSearchExportLayout(body.layout);
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : "FileHistory Search Results";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const columns = readExportColumns(body.columns);
    if (!columns.length) throw new HttpError(400, "Select at least one export column.");
    const query =
      body.query && typeof body.query === "object" && !Array.isArray(body.query)
        ? (body.query as Record<string, unknown>)
        : {};

    const scope = getDivisionScopeCondition(user);
    const categoryScope = getFileCategoryScopeCondition(user);
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (scope.sql) {
      conditions.push(scope.sql);
      values.push(...scope.values);
    }
    if (categoryScope.sql) conditions.push(categoryScope.sql);
    const searchParams = readSearchParams(query);
    const selectedYear = normalizeFinancialYearLabel(readQueryString(query.selectedYear));
    const currentFinancialYear = await loadCurrentFinancialYear();
    const thresholdFinancialYear = getThresholdFinancialYear(selectedYear, currentFinancialYear);
    appendSearchGlobalYearScope(
      conditions,
      values,
      selectedYear,
      currentFinancialYear,
      searchParams,
    );
    const exportLimit = 5000;
    const results = await loadSearchFiles({
      ...buildSearchSql(
        conditions,
        values,
        searchParams,
        {
          ...query,
          page: "1",
          pageSize: "500",
        },
        thresholdFinancialYear,
      ),
      limit: exportLimit,
      offset: 0,
      page: 1,
      pageSize: exportLimit,
    });
    const exportTable = normalizeSearchExportMoney(
      buildFileSearchExportTable(results.files, columns, layout),
      results.files,
    );
    const exportDescription = [
      description,
      exportTable.headers.some(isSearchExportMoneyHeader)
        ? "All monetary values are shown in Lakhs."
        : undefined,
      `Files: ${results.total}${results.total > results.files.length ? ` (exported first ${results.files.length})` : ""}`,
      description.includes("Layout:") ? undefined : `Layout: ${formatFileSearchExportLayout(layout)}`,
    ]
      .filter(Boolean)
      .join("\n");
    const document = {
      title,
      description: exportDescription,
      tables: [
        {
          headers: exportTable.headers,
          rows: exportTable.rows,
        },
      ],
    };
    const extension = format === "pdf" ? "pdf" : "xlsx";
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${getExportFileName(title, extension)}"`,
    );
    if (format === "pdf") {
      response.setHeader("Content-Type", "application/pdf");
      response.send(renderPdfDocument(document));
      return;
    }
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.send(renderExcelDocument(document));
  }),
);

function getFinancialYearCode(financialYear: string) {
  const label = financialYear.trim();
  const startYearMatch = label.match(/\b(19\d{2}|20\d{2})\b/);
  if (startYearMatch) return startYearMatch[1].slice(-2);
  return label.replace(/\D/g, "").slice(0, 2);
}

function getDivisionCodeForUniqueCode(code: string | null | undefined, name: string) {
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
  const fallback =
    initials ||
    name
      .replace(/[^a-z0-9]+/gi, "")
      .slice(0, 4)
      .toUpperCase();
  return fallback;
}

let fileStatusSchemaReady: Promise<void> | undefined;

async function ensureFileStatusSchema() {
  fileStatusSchemaReady ??= (async () => {
    await pool.query(`
      create table if not exists file_status_updates (
        id uuid primary key default gen_random_uuid(),
        file_id uuid not null references files(id) on delete cascade,
        division_id uuid references divisions(id) on delete set null,
        text text not null,
        created_by_user_id uuid references app_users(id) on delete set null,
        created_by_name text not null,
        created_by_role text not null,
        created_at timestamptz not null default now(),
        updated_by_user_id uuid references app_users(id) on delete set null,
        updated_by_name text,
        updated_at timestamptz
      )
    `);
    await pool.query(`
      create index if not exists file_status_updates_file_idx
      on file_status_updates(file_id, created_at desc)
    `);
    await pool.query(`
      create index if not exists file_status_updates_division_idx
      on file_status_updates(division_id, created_at desc)
    `);
  })();
  await fileStatusSchemaReady;
}

function canUseQuickStatusAcrossDivisions(user: ReturnType<typeof requireAuth>) {
  return canUseAllDivisions(user);
}

function canEditFileStatusForDivision(
  user: ReturnType<typeof requireAuth>,
  divisionId: string | null | undefined,
) {
  if (
    user.role !== "admin" &&
    user.role !== "sub_admin" &&
    user.role !== "editor" &&
    user.role !== "universal_viewer"
  )
    return false;
  if (canUseAllDivisions(user)) return true;
  return Boolean(divisionId && user.divisionIds.includes(divisionId));
}

function requireFileStatusText(value: unknown) {
  if (typeof value !== "string") throw new HttpError(400, "File Status is required.");
  const text = value.trim();
  if (!text) throw new HttpError(400, "File Status is required.");
  if (text.split(/\s+/).filter(Boolean).length > 50) {
    throw new HttpError(400, "File Status cannot exceed 50 words.");
  }
  return text;
}

function quickStatusScopeSql(user: ReturnType<typeof requireAuth>, values: unknown[]) {
  if (canUseQuickStatusAcrossDivisions(user)) return "";
  if (!user.divisionIds.length) return " and false";
  values.push(user.divisionIds);
  return ` and f.division_id = any($${values.length}::uuid[])`;
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

async function loadFileStatusUpdates(fileId: string, user: ReturnType<typeof requireAuth>) {
  await ensureFileStatusSchema();
  const result = await pool.query<{
    id: string;
    file_id: string;
    division_id: string | null;
    text: string;
    created_by_name: string;
    created_by_role: string;
    created_at: Date | string;
    updated_by_name: string | null;
    updated_at: Date | string | null;
  }>(
    `select id, file_id, division_id, text, created_by_name, created_by_role, created_at,
            updated_by_name, updated_at
     from file_status_updates
     where file_id = $1
     order by created_at desc, id desc`,
    [fileId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    fileId: row.file_id,
    divisionId: row.division_id ?? undefined,
    text: row.text,
    createdByName: row.created_by_name,
    createdByRole: row.created_by_role,
    createdAt: toIso(row.created_at) ?? "",
    updatedByName: row.updated_by_name ?? undefined,
    updatedAt: toIso(row.updated_at),
    canEdit: canEditFileStatusForDivision(user, row.division_id),
  }));
}

filesRouter.get(
  "/identifier-suggestions",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const query = readQueryString(request.query.q)?.trim().toLowerCase() ?? "";
    const includeDemandDescription =
      readQueryString(request.query.includeDemandDescription) === "true";
    if (!query) {
      response.json({ files: [] });
      return;
    }

    const values: unknown[] = [query];
    const conditions = [
      "f.archived_at is null",
      `(
        left(lower(coalesce(f.unique_code, '')), char_length($1)) = $1
        or left(lower(coalesce(f.imms, '')), char_length($1)) = $1
        or left(lower(coalesce(f.file_no, '')), char_length($1)) = $1
        or exists (
          select 1 from supply_orders matched_so
          where matched_so.file_id = f.id
            and (
              left(lower(coalesce(matched_so.so_no, '')), char_length($1)) = $1
              or left(lower(coalesce(matched_so.gem_so_no, '')), char_length($1)) = $1
            )
        )
        ${includeDemandDescription ? "or lower(coalesce(f.demand_description, '')) like '%' || $1 || '%'" : ""}
      )`,
    ];
    const divisionScope = getDivisionScopeCondition(user);
    if (divisionScope.sql) {
      const offset = values.length;
      conditions.push(divisionScope.sql.replaceAll("$1", `$${offset + 1}`));
      values.push(...divisionScope.values);
    }
    const categoryScope = getFileCategoryScopeCondition(user);
    if (categoryScope.sql) conditions.push(categoryScope.sql);

    const result = await pool.query<{
      id: string;
      unique_code: string | null;
      imms: string | null;
      file_no: string | null;
      so_numbers: string | null;
      demand_description: string | null;
      division: string | null;
    }>(
      `select f.id, f.unique_code, f.imms, f.file_no, f.demand_description,
              d.name as division, so_list.so_numbers
       from files f
       left join divisions d on d.id = f.division_id
       left join lateral (
         select string_agg(distinct identifier, ', ' order by identifier) as so_numbers
         from (
           select nullif(trim(so.so_no), '') as identifier
           from supply_orders so where so.file_id = f.id
           union
           select nullif(trim(so.gem_so_no), '') as identifier
           from supply_orders so where so.file_id = f.id
         ) identifiers
         where identifier is not null
       ) so_list on true
       where ${conditions.join(" and ")}
       order by
         case
           when left(lower(coalesce(f.unique_code, '')), char_length($1)) = $1 then 0
           when left(lower(coalesce(f.imms, '')), char_length($1)) = $1 then 1
           when left(lower(coalesce(f.file_no, '')), char_length($1)) = $1 then 2
           else 3
         end,
         f.created_at desc
       limit 20`,
      values,
    );
    response.json({
      files: result.rows.map((row) => ({
        id: row.id,
        uniqueCode: row.unique_code ?? undefined,
        controlNo: row.imms ?? undefined,
        fileNo: row.file_no ?? undefined,
        soNumbers: row.so_numbers ?? undefined,
        itemDescription: row.demand_description ?? undefined,
        division: row.division ?? undefined,
      })),
    });
  }),
);

filesRouter.get(
  "/quick-status/lookup",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const controlNo = readQueryString(request.query.controlNo)?.trim() ?? "";
    const description = readQueryString(request.query.description)?.trim() ?? "";
    if (!controlNo && !description) {
      response.json({ files: [] });
      return;
    }
    const values: unknown[] = [];
    const conditions = ["f.archived_at is null"];
    if (controlNo || description) {
      const identifierPattern = controlNo ? `%${controlNo.toLowerCase()}%` : null;
      const descriptionPattern = description ? `%${description.toLowerCase()}%` : null;
      const identifierIndex = identifierPattern ? values.push(identifierPattern) : 0;
      const descriptionIndex = descriptionPattern ? values.push(descriptionPattern) : 0;
      const alternatives = [];
      if (identifierPattern) {
        alternatives.push(`(
          lower(coalesce(f.imms, '')) like $${identifierIndex}
          or lower(coalesce(f.unique_code, '')) like $${identifierIndex}
          or lower(coalesce(f.file_no, '')) like $${identifierIndex}
          or exists (
            select 1 from supply_orders so
            where so.file_id = f.id
              and (
                lower(coalesce(so.so_no, '')) like $${identifierIndex}
                or lower(coalesce(so.gem_so_no, '')) like $${identifierIndex}
              )
          )
        )`);
      }
      if (descriptionPattern) {
        alternatives.push(`lower(coalesce(f.demand_description, '')) like $${descriptionIndex}`);
      }
      conditions.push(`(${alternatives.join(" or ")})`);
    }
    const scope = quickStatusScopeSql(user, values);
    const result = await pool.query<{
      id: string;
      unique_code: string | null;
      imms: string | null;
      file_no: string | null;
      so_numbers: string | null;
      demand_description: string | null;
      division: string | null;
      indentor: string | null;
      received_date: Date | string | null;
    }>(
      `select f.id, f.unique_code, f.imms, f.file_no, f.demand_description,
              d.name as division, f.indentor, f.received_date, so_list.so_numbers
       from files f
       left join divisions d on d.id = f.division_id
       left join lateral (
         select string_agg(distinct identifier, ', ' order by identifier) as so_numbers
         from (
           select nullif(trim(so.so_no), '') as identifier
           from supply_orders so where so.file_id = f.id
           union
           select nullif(trim(so.gem_so_no), '') as identifier
           from supply_orders so where so.file_id = f.id
         ) identifiers
         where identifier is not null
       ) so_list on true
       where ${conditions.join(" and ")}${scope}
       order by
         case
           when lower(coalesce(f.imms, '')) = lower(${controlNo ? `$1` : "''"}) then 0
           when lower(coalesce(f.unique_code, '')) = lower(${controlNo ? `$1` : "''"}) then 1
           else 2
         end,
         f.created_at desc
       limit 20`,
      values,
    );
    response.json({
      files: result.rows.map((row) => ({
        id: row.id,
        uniqueCode: row.unique_code ?? undefined,
        controlNo: row.imms ?? undefined,
        fileNo: row.file_no ?? undefined,
        soNumbers: row.so_numbers ?? undefined,
        itemDescription: row.demand_description ?? undefined,
        division: row.division ?? undefined,
        indentor: row.indentor ?? undefined,
        receivedDate: toIso(row.received_date)?.slice(0, 10),
      })),
    });
  }),
);

filesRouter.get(
  "/quick-status/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const id = requireParam(request.params.id, "id");
    const files = await loadFiles("where f.id = $1", [id]);
    if (!files[0]) throw new HttpError(404, "File not found.");
    const divisionResult = await pool.query<{ division_id: string | null }>(
      "select division_id from files where id = $1 and archived_at is null",
      [id],
    );
    const divisionId = divisionResult.rows[0]?.division_id;
    if (!canUseQuickStatusAcrossDivisions(user) && !canAccessDivision(user, divisionId)) {
      throw new HttpError(403, "You cannot access this file.");
    }
    response.json({
      file: files[0],
      statuses: await loadFileStatusUpdates(id, user),
    });
  }),
);

filesRouter.post(
  "/quick-status/:id/status",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const id = requireParam(request.params.id, "id");
    const body = requireObjectBody(request.body);
    const text = requireFileStatusText(body.text);
    const file = await pool.query<{ division_id: string | null }>(
      "select division_id from files where id = $1 and archived_at is null",
      [id],
    );
    if (!file.rows[0]) throw new HttpError(404, "File not found.");
    if (
      !canUseQuickStatusAcrossDivisions(user) &&
      !canAccessDivision(user, file.rows[0].division_id)
    ) {
      throw new HttpError(403, "You cannot access this file.");
    }
    if (!canEditFileStatusForDivision(user, file.rows[0].division_id)) {
      throw new HttpError(403, "You cannot update File Status.");
    }
    await ensureFileStatusSchema();
    await pool.query(
      `insert into file_status_updates (
         file_id, division_id, text, created_by_user_id, created_by_name, created_by_role
       )
       values ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        file.rows[0].division_id,
        text,
        user.id.startsWith("viewer:") ? null : user.id,
        user.name,
        user.role,
      ],
    );
    response.status(201).json({ statuses: await loadFileStatusUpdates(id, user) });
  }),
);

filesRouter.patch(
  "/quick-status/status/:statusId",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const statusId = requireParam(request.params.statusId, "statusId");
    const body = requireObjectBody(request.body);
    const text = requireFileStatusText(body.text);
    await ensureFileStatusSchema();
    const existing = await pool.query<{ file_id: string; division_id: string | null }>(
      "select file_id, division_id from file_status_updates where id = $1",
      [statusId],
    );
    if (!existing.rows[0]) throw new HttpError(404, "File Status not found.");
    if (!canEditFileStatusForDivision(user, existing.rows[0].division_id)) {
      throw new HttpError(403, "Only the respective editor/admin can edit File Status.");
    }
    await pool.query(
      `update file_status_updates
       set text = $2,
           updated_by_user_id = $3,
           updated_by_name = $4,
           updated_at = now()
       where id = $1`,
      [statusId, text, user.id, user.name],
    );
    response.json({ statuses: await loadFileStatusUpdates(existing.rows[0].file_id, user) });
  }),
);

filesRouter.get(
  "/next-unique-code",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const financialYear = readQueryString(request.query.financialYear)?.trim() ?? "";
    const divisionName = readQueryString(request.query.division)?.trim() ?? "";
    const divisionId = readQueryString(request.query.divisionId)?.trim() ?? "";
    const yearCode = getFinancialYearCode(financialYear);
    if (!yearCode || (!divisionName && !divisionId)) {
      response.json({ uniqueCode: "" });
      return;
    }

    const divisionResult = await pool.query<{ id: string; name: string; code: string | null }>(
      `select id, name, code
       from divisions
       where archived_at is null
         and (($1 <> '' and id = nullif($1, '')::uuid) or ($2 <> '' and lower(name) = lower($2)))
       order by case when id = nullif($1, '')::uuid then 0 else 1 end
       limit 1`,
      [divisionId, divisionName],
    );
    const division = divisionResult.rows[0];
    if (!division) throw new HttpError(404, "Division not found.");
    if (!canAccessDivision(user, division.id)) {
      throw new HttpError(403, "You cannot access this division.");
    }

    const divisionCode = getDivisionCodeForUniqueCode(division.code, division.name);
    const prefix = `${yearCode}${divisionCode}`;
    if (!divisionCode) {
      response.json({ uniqueCode: "" });
      return;
    }

    const result = await pool.query<{ max_serial: string | null }>(
      `select max(nullif(regexp_replace(substr(unique_code, $2), '\\D', '', 'g'), '')::integer)::text as max_serial
       from files
       where unique_code like $1`,
      [`${prefix}%`, prefix.length + 1],
    );
    const nextSerial = Number(result.rows[0]?.max_serial ?? 0) + 1;
    response.json({ uniqueCode: `${prefix}${String(nextSerial).padStart(3, "0")}` });
  }),
);

filesRouter.get(
  "/by-identifier/:code",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const code = requireParam(request.params.code, "code").trim();
    const scope = getDivisionScopeCondition(user);
    const categoryScope = getFileCategoryScopeCondition(user);
    const values: unknown[] = [code];
    const conditions = [
      `(
        lower(f.unique_code) = lower($1)
        or lower(f.imms) = lower($1)
        or lower(coalesce(f.file_no, '')) = lower($1)
        or exists (
          select 1 from supply_orders so
          where so.file_id = f.id
            and (lower(coalesce(so.so_no, '')) = lower($1)
              or lower(coalesce(so.gem_so_no, '')) = lower($1))
        )
      )`,
    ];
    if (scope.sql) {
      conditions.push(scope.sql.replace("$1", `$${values.length + 1}`));
      values.push(...scope.values);
    }
    if (categoryScope.sql) conditions.push(categoryScope.sql);
    const files = await loadFiles(`where ${conditions.join(" and ")}`, values);
    response.json({ files });
  }),
);

filesRouter.get(
  "/by-unique-code/:code",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const code = requireParam(request.params.code, "code").trim();
    const scope = getDivisionScopeCondition(user);
    const categoryScope = getFileCategoryScopeCondition(user);
    const values: unknown[] = [code];
    const conditions = ["lower(f.unique_code) = lower($1)"];
    if (scope.sql) {
      conditions.push(scope.sql.replace("$1", `$${values.length + 1}`));
      values.push(...scope.values);
    }
    if (categoryScope.sql) conditions.push(categoryScope.sql);
    const files = await loadFiles(`where ${conditions.join(" and ")}`, values);
    response.json({ files });
  }),
);

filesRouter.get(
  "/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const id = requireParam(request.params.id, "id");
    const files = await loadFiles("where f.id = $1", [id]);
    if (!files[0]) throw new HttpError(404, "File not found.");
    const divisionResult = await pool.query<{ division_id: string | null }>(
      "select division_id from files where id = $1",
      [id],
    );
    if (!canAccessDivision(user, divisionResult.rows[0]?.division_id)) {
      throw new HttpError(403, "You cannot access this division.");
    }
    if (!canAccessFileCategory(user, files[0])) {
      throw new HttpError(403, "You cannot access this file type.");
    }
    response.json({ file: files[0] });
  }),
);

filesRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canMutateFiles(user)) throw new HttpError(403, "You cannot add files.");
    const rawBody = normalizeSupplyOrderCountInBody(requireObjectBody(request.body));
    const client = await pool.connect();
    try {
      await client.query("begin");
      const fileTypeGroup = await resolveConfiguredFileTypeGroup(
        client,
        typeof rawBody.fileType === "string" ? rawBody.fileType : undefined,
        typeof rawBody.fileTypeGroup === "string" ? rawBody.fileTypeGroup : undefined,
      );
      const sanitizedBody = sanitizeFileBodyForWorkflow(
        { ...rawBody, fileTypeGroup },
        { ...rawBody, fileTypeGroup },
      );
      const divisionId = await resolveDivisionId(client, sanitizedBody.division);
      const body = sanitizedBody;
      if (!canAccessDivision(user, divisionId)) {
        throw new HttpError(403, "You cannot add files for this division.");
      }
      if (!canAccessFileCategory(user, body)) {
        throw new HttpError(403, "You cannot add this file type.");
      }
      await validateDemandCancellationAllowed(client, body);
      const insert = buildFileInsert(body, divisionId);
      const result = await client.query<{ id: string }>(
        `insert into files (${insert.columns.join(", ")})
         values (${insert.placeholders.join(", ")})
         returning id`,
        insert.values,
      );
      const fileId = result.rows[0].id;
      await replaceNestedFileData(client, fileId, body, false);
      await client.query("commit");
      clearDashboardReportCaches();

      const files = await loadFiles("where f.id = $1", [fileId]);
      response.status(201).json({ file: files[0] });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }),
);

filesRouter.patch(
  "/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canMutateFiles(user)) throw new HttpError(403, "You cannot edit files.");
    const rawBody = normalizeSupplyOrderCountInBody(requireObjectBody(request.body));
    const id = requireParam(request.params.id, "id");
    const client = await pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query<{
        id: string;
        division_id: string | null;
        file_type: string | null;
        file_type_group: string | null;
        mode: string | null;
        ir: string | null;
        ad: string | null;
      }>(
        "select id, division_id, file_type, file_type_group, mode, ir, ad from files where id = $1 and archived_at is null",
        [id],
      );
      if (existing.rowCount === 0) throw new HttpError(404, "File not found.");
      if (!canAccessDivision(user, existing.rows[0].division_id)) {
        throw new HttpError(403, "You cannot edit this division.");
      }
      if (
        !canAccessFileCategory(user, {
          fileType: existing.rows[0].file_type ?? undefined,
          fileTypeGroup: existing.rows[0].file_type_group ?? undefined,
        })
      ) {
        throw new HttpError(403, "You cannot edit this file type.");
      }
      const divisionId =
        "division" in rawBody ? await resolveDivisionId(client, rawBody.division) : undefined;
      if (divisionId !== undefined && !canAccessDivision(user, divisionId)) {
        throw new HttpError(403, "You cannot move files to this division.");
      }
      const nextFileType =
        "fileType" in rawBody && typeof rawBody.fileType === "string"
          ? rawBody.fileType
          : (existing.rows[0].file_type ?? undefined);
      const suppliedFileTypeGroup =
        "fileTypeGroup" in rawBody && typeof rawBody.fileTypeGroup === "string"
          ? rawBody.fileTypeGroup
          : (existing.rows[0].file_type_group ?? undefined);
      const nextFileTypeGroup =
        "fileType" in rawBody || "fileTypeGroup" in rawBody || !suppliedFileTypeGroup
          ? await resolveConfiguredFileTypeGroup(client, nextFileType, suppliedFileTypeGroup)
          : suppliedFileTypeGroup;
      const nextIr =
        "ir" in rawBody && typeof rawBody.ir === "string"
          ? rawBody.ir
          : (existing.rows[0].ir ?? undefined);
      const sanitizedBody = sanitizeFileBodyForWorkflow(
        "fileType" in rawBody || "fileTypeGroup" in rawBody || !suppliedFileTypeGroup
          ? { ...rawBody, fileTypeGroup: nextFileTypeGroup }
          : rawBody,
        {
          fileType: nextFileType,
          fileTypeGroup: nextFileTypeGroup,
          ir: nextIr,
        },
      );
      const body = sanitizedBody;
      if (
        !canAccessFileCategory(user, { fileType: nextFileType, fileTypeGroup: nextFileTypeGroup })
      ) {
        throw new HttpError(403, "You cannot change files to this file type.");
      }
      const oldFiles = await loadFiles("where f.id = $1", [id]);
      await validateDemandCancellationAllowed(client, body, id);
      const update = buildFileUpdate(body, divisionId);

      if (update.fields.length) {
        update.values.push(id);
        const result = await client.query(
          `update files
           set ${update.fields.join(", ")}
           where id = $${update.values.length}`,
          update.values,
        );
        if (result.rowCount === 0) throw new HttpError(404, "File not found.");
      }

      await replaceNestedFileData(client, id, body, true);
      if (!update.fields.length && Object.keys(body).length === 0) {
        throw new HttpError(400, "No file fields provided.");
      }

      await client.query("commit");
      clearDashboardReportCaches();
      const files = await loadFiles("where f.id = $1", [id]);
      if (!files[0]) throw new HttpError(404, "File not found.");
      const changes = oldFiles[0] ? buildFileProcessingChanges(oldFiles[0], files[0]) : [];
      if (changes.length) {
        try {
          await createFileProcessingNotification({
            client: pool,
            file: files[0],
            user,
            changes,
          });
        } catch (notificationError) {
          console.error("Failed to create file processing notification", notificationError);
        }
      }
      response.json({ file: files[0] });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }),
);

filesRouter.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canMutateFiles(user)) throw new HttpError(403, "You cannot delete files.");
    const body = requireObjectBody(request.body);
    await verifyDeletionPassword(body.deletionPassword);
    const id = requireParam(request.params.id, "id");
    const files = await loadFiles("where f.id = $1", [id]);
    if (!files[0]) throw new HttpError(404, "File not found.");
    const existing = await pool.query<{ division_id: string | null }>(
      "select division_id from files where id = $1 and archived_at is null",
      [id],
    );
    if (!canAccessDivision(user, existing.rows[0]?.division_id)) {
      throw new HttpError(403, "You cannot delete this division.");
    }
    if (!canAccessFileCategory(user, files[0])) {
      throw new HttpError(403, "You cannot delete this file type.");
    }

    await pool.query(
      `update files
       set archived_at = now(),
           archived_by = $2,
           archive_reason = $3
       where id = $1 and archived_at is null`,
      [id, user.id, user.role === "admin" ? "Archived by admin" : "Archived by editor"],
    );
    clearDashboardReportCaches();
    response.json({ archived: true, file: files[0] });
  }),
);

filesRouter.get(
  "/archive/list",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    response.json({ files: await loadFiles("where f.archived_at is not null", [], true) });
  }),
);

filesRouter.delete(
  "/archive/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    await verifyDeletionPassword(body.deletionPassword);
    const id = requireParam(request.params.id, "id");
    const files = await loadFiles("where f.id = $1 and f.archived_at is not null", [id], true);
    if (!files[0]) throw new HttpError(404, "Archived file not found.");
    await pool.query("delete from files where id = $1 and archived_at is not null", [id]);
    clearDashboardReportCaches();
    response.json({ deleted: true, file: files[0] });
  }),
);

filesRouter.post(
  "/:id/restore",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const id = requireParam(request.params.id, "id");
    await pool.query(
      "update files set archived_at = null, archived_by = null, archive_reason = null where id = $1",
      [id],
    );
    const files = await loadFiles("where f.id = $1", [id]);
    if (!files[0]) throw new HttpError(404, "File not found.");
    clearDashboardReportCaches();
    response.json({ file: files[0] });
  }),
);
