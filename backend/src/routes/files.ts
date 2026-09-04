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
import type { FileSearchParams } from "../utils/file-search.js";
import { normalizeFileCategories, type FileCategoryKey } from "../utils/file-categories.js";
import { rawSupplyOrders as normalizedRawSupplyOrders } from "../utils/effective-deliveries.js";
import {
  fromDbDate,
  fromDbText,
  toDbDate,
  toDbInteger,
  toDbNumber,
  toDbText,
} from "../utils/db-values.js";
import { clearDashboardReportCaches } from "../utils/cache.js";
import { asyncHandler, HttpError, requireObjectBody, requireParam } from "../utils/http.js";
import { isBiddingApplicableForFile } from "../utils/file-type-groups.js";
import {
  buildFileProcessingChanges,
  createFileProcessingNotification,
} from "../utils/file-processing-notifications.js";

export const filesRouter = Router();
const allActiveFilesYear = "__all_active_files__";
const activePlusCurrentFyClosedYear = "__active_plus_current_fy_closed__";
const fileClosedMilestone = "File Closed";

function normalizeFinancialYearLabel(value: unknown) {
  const label = typeof value === "string" ? value.trim() : "";
  if (!label || label === allActiveFilesYear || label === activePlusCurrentFyClosedYear) {
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
  "dpDate",
  "dpExtension",
  "dpExtensionCount",
  "ld",
  "revisedDp",
  "materialReceiptDate",
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

let supplyOrderBillReturnsSchemaReady: Promise<void> | undefined;

export function ensureSupplyOrderBillReturnsSchema() {
  supplyOrderBillReturnsSchemaReady ??= pool
    .query(
      `alter table supply_orders
	       add column if not exists bill_return_cycles jsonb not null default '[]'::jsonb,
	       add column if not exists bill_no text,
	       add column if not exists bill_amount_capital numeric(14, 2),
	       add column if not exists bill_amount_revenue numeric(14, 2),
	       add column if not exists supplementary_bills jsonb not null default '[]'::jsonb`,
    )
    .then(() => undefined);
  return supplyOrderBillReturnsSchemaReady;
}

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
    const order: SupplyOrderDetail = {};
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
  await ensureSupplyOrderBillReturnsSchema();
  const result = await pool.query<FileRow>(
    `select f.*, d.name as division
     from files f
     left join divisions d on d.id = f.division_id
     ${combineWhere(whereSql, includeArchived)}
     order by f.created_at desc`,
    values,
  );
  const children = await loadChildren(result.rows.map((row) => row.id));
  return result.rows.map((row) => mapFile(row, children));
}

async function loadSearchFiles(searchSql: SearchSql) {
  await ensureSupplyOrderBillReturnsSchema();
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
      `select f.*, d.name as division
       from files f
       left join divisions d on d.id = f.division_id
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
    "S.O. No.",
    "Delivery stage",
    "Supplementary bill",
    "Bill return cycle",
    ...supplyOrderColumns.flatMap((column) => getRowwiseSupplyOrderExportHeaders(column)),
  ];
  const rows: string[][] = [];
  files.forEach((file) => {
    const rowEntries = getRowwiseFileSearchExportEntries(file, supplyOrderColumns);
    rowEntries.forEach((entry, entryIndex) => {
      rows.push([
        String(rows.length + 1),
        ...fileColumns.map((column) =>
          entryIndex === 0 ? getFileExportValue(file, column.key) || "Not set" : "",
        ),
        entry.order && isFirstRowwiseFileSearchExportOrderRow(entry)
          ? String(entry.orderIndex + 1)
          : "",
        entry.stage ? `Delivery-${entry.stageIndex + 1}` : "",
        entry.supplementaryBill ? String(entry.supplementaryBillIndex + 1) : "",
        entry.billReturnCycle ? String(entry.billReturnCycleIndex + 1) : "",
        ...supplyOrderColumns.flatMap((column) =>
          getRowwiseSupplyOrderExportValues(file, column.key, entry),
        ),
      ]);
    });
  });
  return { headers, rows };
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
  const needsSupplementaryRows = supplyOrderColumns.some((column) =>
    isSupplementaryBillExportField(column.key),
  );
  const needsBillReturnRows = supplyOrderColumns.some(
    (column) => column.key === "billReturnCycles",
  );
  const needsSupplementaryReturnRows = supplyOrderColumns.some(
    (column) => column.key === "supplementaryBillReturnCycles",
  );

  return orders.flatMap((order, orderIndex) => {
    const entries: RowwiseFileSearchExportEntry[] = [];
    if (order.stageDelivery === "Yes" && order.stageDeliveries?.length) {
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
    } else {
      entries.push({
        order,
        orderIndex,
        stageIndex: -1,
        supplementaryBillIndex: -1,
        billReturnCycleIndex: -1,
      });
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

    if (needsSupplementaryRows) {
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
          entries.push({
            order,
            orderIndex,
            stageIndex: -1,
            supplementaryBill,
            supplementaryBillIndex,
            billReturnCycleIndex: -1,
          });
        },
      );
    }

    return entries;
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
  if (!isFirstRowwiseFileSearchExportOrderRow(entry)) return [""];
  return [getSupplyOrderExportValue(entry.order, key)];
}

function isFirstRowwiseFileSearchExportOrderRow(entry: RowwiseFileSearchExportEntry) {
  return entry.stageIndex <= 0 && !entry.supplementaryBill && !entry.billReturnCycle;
}

function shouldUseStageValueForFileSearchExport(order: SupplyOrderDetail, key: string) {
  if (!stagedSupplyOrderExportKeys.has(key)) return false;
  if (["billPreparationDate", "billNo", "billSentForPaymentDate", "paymentDate"].includes(key)) {
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

function readQueryBoolean(value: unknown) {
  return value === "true" || value === true;
}

function readQueryList(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
    yearFilter: readQueryString(query.yearFilter),
    indentor: readQueryString(query.indentor),
    divisionFilter: readQueryString(query.divisionFilter),
    valueFrom: readQueryString(query.valueFrom),
    valueTo: readQueryString(query.valueTo),
    soValueFrom: readQueryString(query.soValueFrom),
    soValueTo: readQueryString(query.soValueTo),
    soCapitalOnly: readQueryBoolean(query.soCapitalOnly),
    soRevenueOnly: readQueryBoolean(query.soRevenueOnly),
    capitalOnly: readQueryBoolean(query.capitalOnly),
    revenueOnly: readQueryBoolean(query.revenueOnly),
    description: readQueryString(query.description),
    firm: readQueryString(query.firm),
    firmUniqueNo: readQueryString(query.firmUniqueNo),
    firmContactNo: readQueryString(query.firmContactNo),
    firmCity: readQueryString(query.firmCity),
    firmSearchScopes: readQueryList(query.firmSearchScopes),
    selectedModes: readQueryList(query.selectedModes),
    selectedGemBiddingModes: readQueryList(query.selectedGemBiddingModes),
    selectedFirmTypes: readQueryList(query.selectedFirmTypes),
    selectedFileTypes: readQueryList(query.selectedFileTypes),
    selectedBgCoverageTypes: readQueryList(query.selectedBgCoverageTypes),
    specialFileMarker: readQueryString(query.specialFileMarker),
    fileCategories:
      readQueryString(query.fileCategories) === undefined
        ? undefined
        : normalizeFileCategories(readQueryList(query.fileCategories)),
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
    psbFilter: readQueryBoolean(query.psbFilter),
    pwbFilter: readQueryBoolean(query.pwbFilter),
    psbPwbFilter: readQueryBoolean(query.psbPwbFilter),
    bgFilter: readQueryBoolean(query.bgFilter),
    rfpVettingFilter: readQueryBoolean(query.rfpVettingFilter),
    refloat: readQueryBoolean(query.refloat),
    cnc: readQueryBoolean(query.cnc),
    tcec: readQueryBoolean(query.tcec),
    dpFrom: readQueryString(query.dpFrom),
    dpTo: readQueryString(query.dpTo),
    demandReceiptFrom: readQueryString(query.demandReceiptFrom),
    demandReceiptTo: readQueryString(query.demandReceiptTo),
    demandControlFrom: readQueryString(query.demandControlFrom),
    demandControlTo: readQueryString(query.demandControlTo),
    highValueMinutesFrom: readQueryString(query.highValueMinutesFrom),
    highValueMinutesTo: readQueryString(query.highValueMinutesTo),
    preTcecMinutesFrom: readQueryString(query.preTcecMinutesFrom),
    preTcecMinutesTo: readQueryString(query.preTcecMinutesTo),
    rqaApprovalFrom: readQueryString(query.rqaApprovalFrom),
    rqaApprovalTo: readQueryString(query.rqaApprovalTo),
    ifaFinalFrom: readQueryString(query.ifaFinalFrom),
    ifaFinalTo: readQueryString(query.ifaFinalTo),
    cfaApprovalFrom: readQueryString(query.cfaApprovalFrom),
    cfaApprovalTo: readQueryString(query.cfaApprovalTo),
    postTcecMinutesFrom: readQueryString(query.postTcecMinutesFrom),
    postTcecMinutesTo: readQueryString(query.postTcecMinutesTo),
    cncDateFrom: readQueryString(query.cncDateFrom),
    cncDateTo: readQueryString(query.cncDateTo),
    financialSanctionFrom: readQueryString(query.financialSanctionFrom),
    financialSanctionTo: readQueryString(query.financialSanctionTo),
    soDateFrom: readQueryString(query.soDateFrom),
    soDateTo: readQueryString(query.soDateTo),
    materialReceiptFrom: readQueryString(query.materialReceiptFrom),
    materialReceiptTo: readQueryString(query.materialReceiptTo),
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
    rstFilter: readQueryBoolean(query.rstFilter),
    demandCancelledFilter: readQueryBoolean(query.demandCancelledFilter),
    soCancelledFilter: readQueryBoolean(query.soCancelledFilter),
    shortclosedSoFilter: readQueryBoolean(query.shortclosedSoFilter),
    freeText: readQueryString(query.freeText),
    freeDate: readQueryString(query.freeDate),
    dashboardFilter: readQueryString(query.dashboardFilter),
    analyticsType: readAnalyticsType(query.analyticsType),
    analyticsNames: readAnalyticsNameList(query.analyticsNames),
    sortColumnKey: readQueryString(query.sortColumnKey),
    sortDirection: readQueryString(query.sortDirection) === "desc" ? "desc" : "asc",
    divisionWiseSort: readQueryBoolean(query.divisionWiseSort),
    requiredFilledFields: readQueryList(query.requiredFilledFields),
  };
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
  if (categories.length === 0) return "false";
  const categorySet = new Set(categories);
  const predicates: string[] = [];
  if (categorySet.has("goodsServices")) {
    predicates.push(
      `lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')`,
    );
  }
  if (categorySet.has("amc")) {
    predicates.push(`lower(trim(coalesce(f.file_type, ''))) = 'amc'`);
  }
  if (categorySet.has("mpc")) {
    predicates.push(`lower(trim(coalesce(f.file_type, ''))) = 'mpc'`);
  }
  if (categorySet.has("cars")) {
    predicates.push(`lower(trim(coalesce(f.file_type, ''))) = 'cars'`);
  }
  if (categorySet.has("om")) {
    predicates.push(`lower(trim(coalesce(f.file_type, ''))) = 'o&m'`);
  }
  return predicates.length ? `(${predicates.join(" or ")})` : "false";
}

function selectedFileTypesSql(selectedFileTypes: string[], values: unknown[]) {
  const normalizedFileTypes = selectedFileTypes
    .map((fileType) => fileType.trim().toLowerCase())
    .filter(Boolean);
  if (!normalizedFileTypes.length) return undefined;

  const predicates: string[] = [];
  if (normalizedFileTypes.includes("goods & services")) {
    predicates.push(
      `lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')`,
    );
  }

  const exactFileTypes = normalizedFileTypes.filter((fileType) => fileType !== "goods & services");
  if (exactFileTypes.length) {
    const placeholder = addSqlValue(values, Array.from(new Set(exactFileTypes)));
    predicates.push(`lower(trim(coalesce(f.file_type, ''))) = any(${placeholder}::text[])`);
  }

  return predicates.length ? `(${predicates.join(" or ")})` : undefined;
}

function bidOpeningOverdueSql(today = "current_date") {
  const openingDate = `(case when ${isYesSql(
    "f.refloat",
  )} and f.refloat_bid_opening_date is not null then f.refloat_bid_opening_date else f.bid_opening_date end)`;
  return `${biddingApplicableSql()} and ${isNoSql("f.bid_opened")} and ${openingDate} is not null and ${openingDate} < ${today}`;
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

function activeFilesSql() {
  return `(not ${fileClosedSql()}
    and lower(coalesce(f.demand_cancelled, '')) <> 'yes')`;
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
  return `exists (select 1 from supply_orders so where so.file_id = f.id and ${condition})`;
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
    and not ${isYesSql(`${orderAlias}.so_cancelled`)}`;
}

function effectiveDpDateSql(alias: string) {
  return `coalesce(${alias}.revised_dp, ${alias}.dp_date)`;
}

function supplyOrderValueTotalSql(capitalOnly: boolean, revenueOnly: boolean) {
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
  revisedDp: "revised_dp",
  materialReceiptDate: "material_receipt_date",
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
  const defaultGroup = `case
    when lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m') then 'contract'
    else 'goodsservices'
  end`;
  return `${isYesSql("f.ir")}
    and lower(trim(coalesce(nullif(f.file_type_group, ''), ${defaultGroup}))) <> 'contract'`;
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
  return supplyOrderChildSql(
    `${supplyOrderTabCompleteSql("so")}
     and not ${hasTextSql("so.payment_date")}
     and not ${isYesSql("so.so_cancelled")}`,
    `${hasTextSql("f.so_date")}
     and not ${hasTextSql("f.payment_date")}
     and not (${isYesSql("f.demand_cancelled")} or ${isYesSql("f.so_cancelled")})`,
  );
}

function paymentPendingSql() {
  const nonDeliveryFileType = `(not ${isYesSql("f.ir")} or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`;
  const activeOrder = `not ${isYesSql("so.so_cancelled")}`;
  const childDeliveryCompletion = `(not ${nonDeliveryFileType} and ${hasTextSql("so.material_receipt_date")})`;
  const stageDeliveryCompletion = `(not ${nonDeliveryFileType} and coalesce(payment_stage.stage ->> 'materialReceiptDate', '') <> '')`;
  const childPaymentStarted = `(${hasTextSql("so.bill_preparation_date")}
	       or ${hasTextSql("so.bill_sent_for_payment_date")})`;
  const stagePaymentStarted = `(coalesce(payment_stage.stage ->> 'billPreparationDate', '') <> ''
		       or coalesce(payment_stage.stage ->> 'billSentForPaymentDate', '') <> '')`;
  const stageJobCompletionDone = `coalesce(payment_stage.stage ->> 'jobCompletionDate', '') <> ''`;
  const childJobCompletionDone = completedOrderMilestoneSql("so", "jobcompletion");
  const childPaymentPending = `${hasTextSql("so.so_date")}
     and (${childPaymentStarted}
		       or (${nonDeliveryFileType} and ${childJobCompletionDone})
	       or (not ${nonDeliveryFileType} and ${childDeliveryCompletion}))
     and not ${hasTextSql("so.payment_date")}
     and ${activeOrder}`;
  const stagePaymentPending = `${hasTextSql("so.so_date")}
     and ${isYesSql("so.stage_delivery")}
     and ${isYesSql("so.stage_payment")}
     and ${activeOrder}
     and exists (
       select 1
       from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as payment_stage(stage)
       where (${stagePaymentStarted}
	         or (${nonDeliveryFileType} and ${stageJobCompletionDone})
         or (not ${nonDeliveryFileType} and ${stageDeliveryCompletion})
	       )
	       and coalesce(payment_stage.stage ->> 'paymentDate', '') = ''
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
  const nonDeliveryFileType = `(not ${isYesSql("f.ir")} or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`;
  const stageDpDate = `coalesce(
    nullif(delivery_stage.stage ->> 'revisedDp', '')::date,
    nullif(delivery_stage.stage ->> 'dpDate', '')::date
  )`;
  const orderDpDate = effectiveDpDateSql("so");
  const stageCompleted = `(not ${nonDeliveryFileType}
    and coalesce(delivery_stage.stage ->> 'materialReceiptDate', '') <> '')`;
  const orderCompleted = `(not ${nonDeliveryFileType}
    and ${hasTextSql("so.material_receipt_date")})`;
  const stagePeriod =
    state === "pending"
      ? `${stageDpDate} is not null
        and ${stageDpDate} >= current_date`
      : `${stageDpDate} is not null and ${stageDpDate} < current_date`;
  const orderPeriod =
    state === "pending"
      ? `${orderDpDate} is not null and ${orderDpDate} >= current_date and so.so_date <= current_date`
      : `${orderDpDate} is not null and ${orderDpDate} < current_date`;
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `${hasTextSql("so.so_date")}
     and not ${isYesSql("so.so_cancelled")}
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
  const nonDeliveryFileType = `(not ${isYesSql("f.ir")} or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`;
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
  const nonDeliveryFileType = `(not ${isYesSql("f.ir")} or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`;
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

function completedOrderMilestoneSql(orderAlias: string, normalizedMilestone: string) {
  if (normalizeMilestoneName(normalizedMilestone) === "billsentforpayment") {
    const openBillReturnSql = (source: string) => `exists (
        select 1
        from jsonb_array_elements(coalesce(${source}, '[]'::jsonb)) as bill_return(cycle)
        where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
          and not ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
      )`;
    return `((${hasTextSql(`${orderAlias}.bill_sent_for_payment_date`)}
        and not ${openBillReturnSql(`${orderAlias}.bill_return_cycles`)})
      or exists (
        select 1
        from jsonb_array_elements(coalesce(${orderAlias}.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
        where ${hasTextSql("stage_row.stage ->> 'billSentForPaymentDate'")}
          and not ${openBillReturnSql("stage_row.stage -> 'billReturnCycles'")}
      )
      or (${hasTextSql(`${orderAlias}.advance_payment_detail ->> 'billSentForPaymentDate'`)}
        and not ${openBillReturnSql(`${orderAlias}.advance_payment_detail -> 'billReturnCycles'`)}))`;
  }
  if (normalizeMilestoneName(normalizedMilestone) === "financialsanction") {
    return hasTextSql(`${orderAlias}.financial_sanction_date`);
  }
  if (normalizeMilestoneName(normalizedMilestone) === "jobcompletion") {
    return hasTextSql(`${orderAlias}.job_completion_date`);
  }
  if (normalizeMilestoneName(normalizedMilestone) === "billreturnedforcorrection") {
    const resolvedBillReturnSql = (source: string) => `exists (
      select 1
      from jsonb_array_elements(coalesce(${source}, '[]'::jsonb)) as bill_return(cycle)
      where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
        and ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
    )
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(${source}, '[]'::jsonb)) as bill_return(cycle)
      where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
        and not ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
    )`;
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

function bgToBeReceivedSql(category: string) {
  const normalized = normalizeMilestoneName(category);
  const nonDeliveryFileType = `(not ${isYesSql("f.ir")} or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`;
  return supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")}
     and not ${isYesSql("so.shortclosure")}
     and ${bgCategorySql("so", category)}
     and (
       ('${normalized}' in ('psb', 'psbpwb') and ${financialSanctionCompletedOrderSql("so")})
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
  const nonDeliveryFileType = `(not ${isYesSql("f.ir")} or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`;
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
       or ${isYesSql("so.shortclosure")}
       or (
         not ${isYesSql("so.so_cancelled")}
         and not ${isYesSql("so.shortclosure")}
         and (
           ('${normalizeMilestoneName(category)}' = 'psb' and ${psbPurposeComplete})
           or (
             '${normalizeMilestoneName(category)}' <> 'psb'
             and ${hasTextSql("so.warranty_period_date")}
             and so.warranty_period_date + interval '60 day' < ${today}
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
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
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
  if (!committee) return "false";
  const meetingDate = decodeStatusFilterPart(rawMeetingDate).trim();
  const committeeColumn =
    stage === "pre" ? "f.pre_tcec_committee_no" : "f.post_tcec_committee_number";
  const meetingDateColumn = stage === "pre" ? "f.pre_tcec_date" : "f.post_tcec_date";
  const minutesDateColumn =
    stage === "pre" ? "f.pre_tcec_minutes_date" : "f.post_tcec_minutes_date";
  const committeePlaceholder = addSqlValue(values, committee.toLowerCase());
  const conditions = [`lower(trim(coalesce(${committeeColumn}, ''))) = ${committeePlaceholder}`];
  if (metric === "signed") conditions.push(hasTextSql(minutesDateColumn));
  if (metric === "pending") conditions.push(`not ${hasTextSql(minutesDateColumn)}`);
  if (isValidDate(meetingDate)) {
    const meetingDatePlaceholder = addSqlValue(values, meetingDate);
    conditions.push(`${meetingDateColumn} = ${meetingDatePlaceholder}::date`);
  }
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
    stage === "pre" ? "f.pre_tcec_committee_no" : "f.post_tcec_committee_number";
  const meetingDateColumn = stage === "pre" ? "f.pre_tcec_date" : "f.post_tcec_date";
  const minutesDateColumn =
    stage === "pre" ? "f.pre_tcec_minutes_date" : "f.post_tcec_minutes_date";
  const fyCondition =
    fiscalYear === "all"
      ? undefined
      : fiscalYearDateCondition(meetingDateColumn, fiscalYear, values);
  if (fiscalYear !== "all" && !fyCondition) return "false";
  const conditions = [hasTextSql(meetingDateColumn)];
  if (fyCondition) conditions.push(fyCondition);
  if (committee) {
    const committeePlaceholder = addSqlValue(values, committee.toLowerCase());
    conditions.push(`lower(trim(coalesce(${committeeColumn}, ''))) = ${committeePlaceholder}`);
  }
  if (metric === "signed") conditions.push(hasTextSql(minutesDateColumn));
  if (metric === "pending") conditions.push(`not ${hasTextSql(minutesDateColumn)}`);
  return conditions.join(" and ");
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

function bgReceiptDelayBaseExpiredSql(category: string, days: number) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") {
    return `${hasTextSql("so.so_date")}
      and so.so_date + (${days} * interval '1 day') < current_date`;
  }
  if (normalized !== "pwb" && normalized !== "psbpwb") return "false";
  const amcMpcOmFileType = `lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'o&m')`;
  const goodsServicesIrNoFileType = `(lower(trim(coalesce(f.file_type, ''))) = 'goods & services' and ${isNoSql("f.ir")})`;
  const nonDeliveryFileType = `(not ${isYesSql("f.ir")} or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`;
  const physicalStageExpired = `${isYesSql("so.stage_delivery")} and exists (
    select 1
    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as bg_delay_stage(stage)
    where ${hasTextSql("bg_delay_stage.stage ->> 'materialReceiptDate'")}
      and nullif(bg_delay_stage.stage ->> 'materialReceiptDate', '')::date
        + (${days} * interval '1 day') < current_date
  )`;
  const jobStageExpired = `${isYesSql("so.stage_delivery")} and exists (
    select 1
    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as bg_delay_stage(stage)
    where ${hasTextSql("bg_delay_stage.stage ->> 'jobCompletionDate'")}
      and nullif(bg_delay_stage.stage ->> 'jobCompletionDate', '')::date
        + (${days} * interval '1 day') < current_date
  )`;
  const finalJobStageExpired = `${isYesSql("so.stage_delivery")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as bg_delay_stage(stage)
      where not ${hasTextSql("bg_delay_stage.stage ->> 'jobCompletionDate'")}
    )
    and (
      select max(nullif(bg_delay_stage.stage ->> 'jobCompletionDate', '')::date)
      from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as bg_delay_stage(stage)
    ) + (${days} * interval '1 day') < current_date`;
  return `((
      ${amcMpcOmFileType}
      and ${hasTextSql("so.so_date")}
      and so.so_date + (${days} * interval '1 day') < current_date
    ) or (
      not ${nonDeliveryFileType}
      and (
        (${physicalStageExpired})
        or (${hasTextSql("so.material_receipt_date")}
          and so.material_receipt_date + (${days} * interval '1 day') < current_date)
      )
    ) or (
      ${nonDeliveryFileType}
      and not ${amcMpcOmFileType}
      and (
        (
          ${goodsServicesIrNoFileType}
          and (
            (${finalJobStageExpired})
            or (
              not ${isYesSql("so.stage_delivery")}
              and ${hasTextSql("so.job_completion_date")}
              and so.job_completion_date + (${days} * interval '1 day') < current_date
            )
          )
        )
        or (
          not ${goodsServicesIrNoFileType}
          and (
            (${jobStageExpired})
            or (${hasTextSql("so.job_completion_date")}
              and so.job_completion_date + (${days} * interval '1 day') < current_date)
          )
        )
      )
    ))`;
}

function preBidMeetingFilterSql(refloat: boolean, state: "due" | "completed") {
  const applies = refloat
    ? `${isYesSql("f.refloat")} and ${isYesSql("f.refloat_pre_bid_meeting")}`
    : isYesSql("f.pre_bid_meeting");
  const dateColumn = refloat ? "f.refloat_pre_bid_meeting_date" : "f.pre_bid_meeting_date";
  const dateState =
    state === "completed" ? `${dateColumn} < current_date` : `${dateColumn} >= current_date`;
  return `not ${isCancelledFileSql()}
    and ${biddingApplicableSql()}
    and ${applies}
    and ${hasTextSql(dateColumn)}
    and ${dateState}`;
}

function bgExpiredSql(category: string, today = "current_date") {
  const returnColumn = bgReturnColumn(category);
  const validityColumn = bgValidityColumn(category);
  const nonDeliveryFileType = `(not ${isYesSql("f.ir")} or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`;
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

function completedStageMilestoneSql(orderAlias: string, normalizedMilestone: string) {
  const dateFields: Record<string, string> = {
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
          normalizeMilestoneName(normalizedMilestone) === "billsentforpayment"
            ? `and not exists (
                select 1
                from jsonb_array_elements(coalesce(stage_row.stage -> 'billReturnCycles', '[]'::jsonb)) as bill_return(cycle)
                where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
                  and not ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
              )`
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
		        and not exists (
		          select 1
		          from jsonb_array_elements(coalesce(stage_row.stage -> 'billReturnCycles', '[]'::jsonb)) as bill_return(cycle)
			          where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
			            and not ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
			        ))
			      or (${normalizedMilestoneSql} = 'billreturnedforcorrection'
			        and exists (
			          select 1
			          from jsonb_array_elements(coalesce(stage_row.stage -> 'billReturnCycles', '[]'::jsonb)) as bill_return(cycle)
			          where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
			            and not ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
			        ))
			      or (${normalizedMilestoneSql} = 'billpreparation'
			        and not ${hasTextSql("stage_row.stage ->> 'billPreparationDate'")}
			        and (
		          (${isYesSql("f.ir")} and ${hasTextSql("stage_row.stage ->> 'irReceiptDate'")})
		          or ((not ${isYesSql("f.ir")}
		            or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))
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
	        or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))
	      and not ${completedOrderMilestoneSql(orderAlias, "jobcompletion")}
	      and ${effectiveDpDateSql(orderAlias)} is not null
	      and ${effectiveDpDateSql(orderAlias)} < current_date
	      and not ${isYesSql(`${orderAlias}.so_cancelled`)})
		    or (${normalizedMilestoneSql} = 'billsentforpayment'
		      and ${hasTextSql(`${orderAlias}.bill_preparation_date`)}
		      and not ${hasTextSql(`${orderAlias}.bill_sent_for_payment_date`)}
		      and not exists (
		        select 1
		        from jsonb_array_elements(coalesce(${orderAlias}.bill_return_cycles, '[]'::jsonb)) as bill_return(cycle)
		        where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
		          and not ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
		      )
		      and not ${isYesSql(`${orderAlias}.so_cancelled`)})
		    or (${normalizedMilestoneSql} = 'billreturnedforcorrection'
		      and exists (
		        select 1
		        from jsonb_array_elements(coalesce(${orderAlias}.bill_return_cycles, '[]'::jsonb)) as bill_return(cycle)
		        where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
		          and not ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
		      )
		      and not ${isYesSql(`${orderAlias}.so_cancelled`)})
	    or (${normalizedMilestoneSql} = 'billpreparation'
	      and not ${hasTextSql(`${orderAlias}.bill_preparation_date`)}
	      and (
	        (${isYesSql("f.ir")} and ${hasTextSql(`${orderAlias}.ir_receipt_date`)})
	        or ((not ${isYesSql("f.ir")}
	          or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))
	          and ${hasTextSql(`${orderAlias}.job_completion_date`)})
	      )
	      and not ${isYesSql(`${orderAlias}.so_cancelled`)})
	  )`;
}

function supplyOrderDrivenCurrentMilestoneConditionSql(normalizedMilestoneSql: string) {
  return `not ${isCancelledFileSql()} and (
    (${normalizedMilestoneSql} = 'financialsanction' and ${financialSanctionPendingSql()})
    or
    (not ${supplyOrderRowExists()} and ${normalizedSql("f.current_milestone")} = ${normalizedMilestoneSql})
    or exists (
      select 1
      from supply_orders so_current
      where so_current.file_id = f.id
        and not ${isYesSql("so_current.so_cancelled")}
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
			                and exists (
			                  select 1
			                  from jsonb_array_elements(coalesce(so_current.advance_payment_detail -> 'billReturnCycles', '[]'::jsonb)) as bill_return(cycle)
			                  where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
			                    and not ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
			                ))
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

function supplyOrderDrivenCompletedMilestoneConditionSql(normalizedMilestone: string) {
  if (normalizedMilestone === "supplyorder") {
    return `not ${isCancelledFileSql()} and ${supplyOrderPlacedSql()}`;
  }
  return `not ${isCancelledFileSql()} and (
    (
      not ${supplyOrderRowExists()}
      and ${completedMilestoneExists(`${normalizedSql("completed.milestone")} = '${normalizedMilestone}'`)}
    )
    or exists (
      select 1
      from supply_orders so_completed
      where so_completed.file_id = f.id
        and not ${isYesSql("so_completed.so_cancelled")}
        and (
	          ${completedOrderMilestoneSql("so_completed", normalizedMilestone)}
	          or ${completedStageMilestoneSql("so_completed", normalizedMilestone)}
	        )
    )
  )`;
}

function statusAppliesSql(milestone: (typeof statusSummaryMilestones)[number]) {
  if (milestone.key === "bidding") return biddingApplicableSql();
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
    return `not ${isCancelledFileSql()} and ${isYesSql("f.refloat")} and not ${isYesSql("f.bidding_stage_over")}`;
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

function previousStatusCompleteSql(index: number) {
  const previous = statusSummaryMilestones.slice(0, index).reverse();
  if (!previous.length) return hasTextSql("f.received_date");
  return `case
    ${previous
      .map(
        (milestone) =>
          `when ${statusAppliesSql(milestone)} then ${milestoneCompleteSql(milestone)}`,
      )
      .join("\n    ")}
    else ${hasTextSql("f.received_date")}
  end`;
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
    return `${isYesSql("f.refloat")} and not ${isYesSql("f.bidding_stage_over")}`;
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
    return `${isYesSql("f.refloat")} and not ${isYesSql("f.bidding_stage_over")}`;
  }
  if (milestone.key === "financialSanction") return financialSanctionPreviousStageSql();
  const eligible = milestoneEligibleSql(milestone);
  const complete = milestoneCompleteSql(milestone);
  const pending = milestonePendingSql(milestone);
  const reviewed =
    "reviewedColumn" in milestone && milestone.reviewedColumn
      ? `${statusActiveSql(milestone)} and ${hasTextSql(milestone.reviewedColumn)} and not (${complete})`
      : "false";
  const biddingStarted =
    milestone.key === "bidding"
      ? ` or ${isYesSql("f.tender_live")} or ${bidOpeningOverdueSql()}`
      : "";
  return `${eligible} and not (${complete}) and not (${pending}) and not (${reviewed})${biddingStarted ? ` and not (${biddingStarted.slice(4)})` : ""}`;
}

function dashboardMilestoneFilterSql(filter: string) {
  const readKey = (prefix: string) => filter.slice(prefix.length);
  const resolve = (prefix: string) => milestoneByKey(readKey(prefix));

  if (filter.startsWith("milestoneTotal:")) {
    const milestone = resolve("milestoneTotal:");
    if (milestone?.key === "payment") return `(${paymentPendingSql()} or ${paymentCompletedSql()})`;
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
      return `${statusActiveSql(milestone)} and not ${isYesSql("f.tender_live")} and not (${bidOpeningOverdueSql()})`;
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
    if (milestone?.key === "payment") return paymentPendingSql();
    return milestone ? milestonePendingSql(milestone) : "true";
  }
  if (filter.startsWith("milestone:")) {
    const milestone = resolve("milestone:");
    if (milestone?.key === "payment") return paymentPendingSql();
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
  return `nullif((${expression})::text, '')::date`;
}

function milestoneDateExpression(milestone: (typeof statusSummaryMilestones)[number]) {
  if (milestone.key === "bidding") {
    return `coalesce(${dateCastSql("f.bid_opening_date")}, ${dateCastSql("f.bid_date")})`;
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
  const reviewed =
    "reviewedColumn" in milestone && milestone.reviewedColumn
      ? `when ${hasTextSql(milestone.reviewedColumn)} then ${dateCastSql(milestone.reviewedColumn)}`
      : "";
  const previousCases = statusSummaryMilestones
    .slice(0, milestoneIndex)
    .reverse()
    .map(
      (previous) =>
        `when ${statusAppliesSql(previous)} and ${milestoneDateExpression(previous)} is not null then ${milestoneDateExpression(previous)}`,
    )
    .join("\n    ");
  return `(case
    ${reviewed}
    ${previousCases}
    else coalesce(${dateCastSql("f.received_date")}, ${dateCastSql("f.file_date")})
  end)`;
}

const orderDelayMilestones = [
  {
    key: "financialSanction",
    current: "financialsanction",
    completeColumn: "financial_sanction_date",
    start: "financialSanction",
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
  return `nullif(stage_row.stage ->> '${jsonKey}', '')::date`;
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
  const contractFileType = `lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m')`;
  const goodsServicesIrNo = `(not ${isYesSql("f.ir")} and not ${contractFileType})`;
  const stageJobCompletionDone = `coalesce(stage_row.stage ->> 'jobCompletionDate', '') <> ''`;
  const jobCompletionDoneForDelay = `((stage_row.stage is not null and ${stageJobCompletionDone})
    or (stage_row.stage is null and ${completedOrderMilestoneSql("so", "jobcompletion")}))`;
  const jobCompletionDate = effectiveOrderDateSql("job_completion_date", "jobCompletionDate");
  switch (start) {
    case "financialSanction":
      return financialSanctionStart;
    case "supplyOrder":
      return `coalesce(${financialSanctionDate}, ${financialSanctionStart})`;
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
        when ${contractFileType} and ${effectiveDpDate} is not null then (${effectiveDpDate} + interval '1 day')::date
        when ${goodsServicesIrNo} then ${jobCompletionDate}
        else null
      end`;
    case "billSentForPayment":
      return effectiveOrderDateSql("bill_preparation_date", "billPreparationDate");
    case "payment":
      return `case
        when ${contractFileType} and ${effectiveDpDate} is not null then (${effectiveDpDate} + interval '1 day')::date
        when ${goodsServicesIrNo} and ${jobCompletionDoneForDelay} then ${jobCompletionDate}
        when ${isYesSql("f.ir")} then coalesce(${materialReceiptDate}, ${billSentForPaymentDate})
        else ${billSentForPaymentDate}
      end`;
  }
}

function orderDelayFilterSql(milestoneKey: string, thresholdPlaceholder: string) {
  const nonDeliveryFileType = `not (${deliveryInspectionApplicableSql()})`;
  const contractFileType = `lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m')`;
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
    .filter((milestone) => milestoneKey === "all" || milestone.key === milestoneKey)
    .map((milestone) => {
      const startDate = orderDelayStartSql(milestone.start);
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
      const currentMilestone =
        milestone.key === "advancePayment"
          ? normalizedSql("so.advance_payment_detail ->> 'currentMilestone'")
          : normalizedSql("coalesce(stage_row.stage ->> 'currentMilestone', so.current_milestone)");
      const normalizedBgKey = normalizeMilestoneName(milestone.key);
      const currentCondition = isBgStatusKey(milestone.key)
        ? `(('${normalizedBgKey}' in ('psb', 'psbpwb') and ${financialSanctionCompletedOrderSql("so")})
          or ('${normalizedBgKey}' = 'pwb' and (
            ((${deliveryInspectionApplicableSql()}) and ${hasTextSql("so.material_receipt_date")})
            or (${nonDeliveryFileType} and ${completedOrderMilestoneSql("so", "jobcompletion")})
          )))`
        : milestone.key === "supplyOrder"
          ? supplyOrderPendingOrderSql("so")
          : milestone.key === "payment"
            ? `${startDate} is not null
              and (not ${contractFileType}
                or not ${jobCompletionDoneForDelay}
                or ${billSentForPaymentDate} is not null)`
            : milestone.key === "delivery"
              ? hasTextSql("so.so_date")
              : milestone.key === "jobCompletion"
                ? `${startDate} is not null and not ${contractPaymentDelay}`
                : milestone.key === "billPreparation"
                  ? `${effectiveOrderDateSql("bill_preparation_date", "billPreparationDate")} is null
                    and (
                      (${isYesSql("f.ir")} and ${effectiveOrderDateSql("ir_receipt_date", "irReceiptDate")} is not null)
                      or (${nonDeliveryFileType}
                        and ${effectiveOrderDateSql("job_completion_date", "jobCompletionDate")} is not null)
                    )`
                  : `${currentMilestone} = '${milestone.current}'`;
      return `exists (
        select 1
        from supply_orders so
        left join lateral jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
          on ${includeStages ? "jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0" : "false"}
        where so.file_id = f.id
          and not ${isYesSql("so.so_cancelled")}
          and ${applies}
          and ${currentCondition}
          and ${completeDate} is null
          and ${startDate} is not null
          and (current_date - (${startDate})::date) > ${thresholdPlaceholder}::integer
      )`;
    });
  return clauses.length ? `(${clauses.join(" or ")})` : "false";
}

function returnedBillDelayFilterSql(milestoneKey: string, thresholdPlaceholder: string) {
  if (milestoneKey !== "all" && milestoneKey !== "billReturnedForCorrection") return "false";
  const openReturnDateSql = (cyclesExpression: string) => `(select min(nullif(cycle ->> 'returnedDate', '')::date)
    from jsonb_array_elements(coalesce(${cyclesExpression}, '[]'::jsonb)) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
      and coalesce(cycle ->> 'resubmittedDate', '') = '')`;
  const openReturnDelaySql = (cyclesExpression: string) => {
    const dateExpression = openReturnDateSql(cyclesExpression);
    return `(${dateExpression} is not null
      and (current_date - (${dateExpression})::date) > ${thresholdPlaceholder}::integer)`;
  };
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")} and (
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
  const openReturnDate = `(select min(nullif(cycle ->> 'returnedDate', '')::date)
    from jsonb_array_elements(coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
      and coalesce(cycle ->> 'resubmittedDate', '') = '')`;
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")}
     and exists (
       select 1
       from jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill)
       where not ${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")}
         and ${openReturnDate} is not null
         and (current_date - (${openReturnDate})::date) > ${thresholdPlaceholder}::integer
     )`,
  )}`;
}

function biddingDelayStatusSql(breakupKey: string | undefined, thresholdPlaceholder: string) {
  const refloatYes = isYesSql("f.refloat");
  const bidDate = `(case when ${refloatYes} then f.refloat_bidding_date else f.bid_date end)`;
  const bidOpeningDate = `(case when ${refloatYes} then f.refloat_bid_opening_date else f.bid_opening_date end)`;
  const latestPrerequisiteDate = `greatest(
    f.cfa_date,
    coalesce(f.gem_undertaking_date, f.cfa_date),
    coalesce(f.rfp_vetting_approval_date, f.cfa_date)
  )`;
  const base = `not ${isYesSql("f.demand_cancelled")}
    and not ${completedMilestoneExists(`${normalizedSql("completed.milestone")} = 'fileclosed'`)}
    and ${biddingApplicableSql()}
    and ${hasTextSql("f.cfa_date")}
    and not ${isYesSql("f.bidding_stage_over")}`;
  const statusCases: Record<string, string> = {
    gemUndertakingPending: `${base}
      and ${isYesSql("f.gem")}
      and not ${hasTextSql("f.gem_undertaking_date")}
      and (current_date - f.cfa_date) > ${thresholdPlaceholder}::integer`,
    rfpVettingInitiationPending: `${base}
      and not (${isYesSql("f.gem")} and not ${hasTextSql("f.gem_undertaking_date")})
      and ${isYesSql("f.rfp_vetting")}
      and not ${hasTextSql("f.rfp_vetting_initiation_date")}
      and (current_date - (case when ${isYesSql("f.gem")} then coalesce(f.gem_undertaking_date, f.cfa_date) else f.cfa_date end)) > ${thresholdPlaceholder}::integer`,
    rfpVettingApprovalPending: `${base}
      and not (${isYesSql("f.gem")} and not ${hasTextSql("f.gem_undertaking_date")})
      and ${isYesSql("f.rfp_vetting")}
      and ${hasTextSql("f.rfp_vetting_initiation_date")}
      and not ${hasTextSql("f.rfp_vetting_approval_date")}
      and (current_date - f.rfp_vetting_initiation_date) > ${thresholdPlaceholder}::integer`,
    tenderLivePending: `${base}
      and not (${isYesSql("f.gem")} and not ${hasTextSql("f.gem_undertaking_date")})
      and not (${isYesSql("f.rfp_vetting")} and not ${hasTextSql("f.rfp_vetting_initiation_date")})
      and not (${isYesSql("f.rfp_vetting")} and ${hasTextSql("f.rfp_vetting_initiation_date")} and not ${hasTextSql("f.rfp_vetting_approval_date")})
      and not ${isYesSql("f.tender_live")}
      and ${bidDate} is null
      and (current_date - (${latestPrerequisiteDate})::date) > ${thresholdPlaceholder}::integer`,
    bidOpeningOverdue: `${base}
      and not (${isYesSql("f.gem")} and not ${hasTextSql("f.gem_undertaking_date")})
      and not (${isYesSql("f.rfp_vetting")} and not ${hasTextSql("f.rfp_vetting_initiation_date")})
      and not (${isYesSql("f.rfp_vetting")} and ${hasTextSql("f.rfp_vetting_initiation_date")} and not ${hasTextSql("f.rfp_vetting_approval_date")})
      and ${bidOpeningDate} is not null
      and ${bidOpeningDate} < current_date
      and not ${isYesSql("f.bid_opened")}
      and (current_date - (${bidOpeningDate})::date) > ${thresholdPlaceholder}::integer`,
    biddingStageCompletionPending: `${base}
      and not (${isYesSql("f.gem")} and not ${hasTextSql("f.gem_undertaking_date")})
      and not (${isYesSql("f.rfp_vetting")} and not ${hasTextSql("f.rfp_vetting_initiation_date")})
      and not (${isYesSql("f.rfp_vetting")} and ${hasTextSql("f.rfp_vetting_initiation_date")} and not ${hasTextSql("f.rfp_vetting_approval_date")})
      and not (${bidOpeningDate} is not null and ${bidOpeningDate} < current_date and not ${isYesSql("f.bid_opened")})
      and ${isYesSql("f.bid_opened")}
      and (current_date - coalesce(${bidOpeningDate}, ${bidDate}, ${latestPrerequisiteDate})::date) > ${thresholdPlaceholder}::integer`,
  };
  if (breakupKey && statusCases[breakupKey]) return `(${statusCases[breakupKey]})`;
  return `(${Object.values(statusCases)
    .map((clause) => `(${clause})`)
    .join(" or ")})`;
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
  const workflowNotStartedClause =
    milestoneKey === "all" || milestoneKey === "workflowNotStarted"
      ? `(${workflowNotStartedSql()} and (current_date - coalesce(f.received_date, f.created_at::date)) > ${thresholdPlaceholder}::integer)`
      : "false";
  const biddingClause =
    milestoneKey === "all" || milestoneKey === "bidding"
      ? biddingDelayStatusSql(undefined, thresholdPlaceholder)
      : "false";
  const clauses = statusSummaryMilestones
    .map((milestone, index) => ({ milestone, index }))
    .filter(
      ({ milestone }) =>
        !("supplyOrderDate" in milestone && milestone.supplyOrderDate) &&
        milestone.key !== "bidding" &&
        (milestoneKey === "all" || milestone.key === milestoneKey),
    )
    .map(({ milestone, index }) => {
      const startDate = milestoneStageStartSql(milestone, index);
      return `(${statusActiveSql(milestone)}
        and not (${milestoneCompleteSql(milestone)})
        and ${startDate} is not null
        and (current_date - ${startDate}::date) > ${thresholdPlaceholder}::integer)`;
    });
  const orderClause = orderDelayFilterSql(milestoneKey, thresholdPlaceholder);
  const returnedBillClause = returnedBillDelayFilterSql(milestoneKey, thresholdPlaceholder);
  const supplementaryBillReturnedClause = supplementaryBillReturnedDelayFilterSql(
    milestoneKey,
    thresholdPlaceholder,
  );
  return clauses.length
    ? `((${workflowNotStartedClause}) or (${biddingClause}) or (${clauses.join(" or ")}) or ${orderClause} or ${returnedBillClause} or ${supplementaryBillReturnedClause})`
    : `((${workflowNotStartedClause}) or (${biddingClause}) or ${orderClause} or ${returnedBillClause} or ${supplementaryBillReturnedClause})`;
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

  if (milestoneName === "Bill returned for correction") {
    if (stage === "Total") return `${base} and ${billReturnStatusFilterSql("any")}`;
    if (stage === "Pending") return `${base} and ${billReturnStatusFilterSql("pending")}`;
    if (stage === "Completed") return `${base} and ${billReturnStatusFilterSql("resubmitted")}`;
    if (stage === "Returned paid") return `${base} and ${billReturnStatusFilterSql("paid")}`;
    return "false";
  }

  if (milestoneName === "Supplementary bills") {
    if (stage === "Submitted") return `${base} and ${supplementaryBillStatusSql("submitted")}`;
    if (stage === "Returned") return `${base} and ${supplementaryBillStatusSql("returned")}`;
    if (stage === "Resubmitted") {
      return `${base} and ${supplementaryBillStatusSql("resubmitted")}`;
    }
    if (stage === "Paid") return `${base} and ${supplementaryBillStatusSql("paid")}`;
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
  }

  const applies = statusAppliesSql(milestone);
  const process = `${applies} and not ${isCancelledFileSql()}`;
  const complete = statusCompleteSql(milestone);
  const reached = previousStatusCompleteSql(milestoneIndex);
  const active = `${process} and ${statusActiveSql(milestone)}`;
  const reviewed = statusReviewedSql(milestone);
  const pending =
    "reviewedColumn" in milestone && milestone.reviewedColumn
      ? `${active} and not (${reviewed}) and not (${complete})`
      : `${active} and not (${complete})`;

  if (stage === "Pending" && isBgStatusKey(milestone.key)) {
    return `${base} and ${bgToBeReceivedSql(milestone.key)}`;
  }
  if (stage === "Pending" && milestone.key === "payment") {
    return `${base} and ${paymentPendingSql()}`;
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
      return `${base} and ${active} and not ${isYesSql("f.tender_live")} and not (${bidOpeningOverdueSql()})`;
    }
    return `${base} and ${active}`;
  }
  if (stage === "Reviewed") return `${base} and ${active} and ${reviewed} and not (${complete})`;
  if (stage === "Opening overdue") {
    return `${base} and ${applies} and ${bidOpeningOverdueSql()}`;
  }
  if (stage === "Live") {
    if (milestone.key === "bidding")
      return `${base} and ${applies} and ${isYesSql("f.tender_live")}`;
    if (milestone.key === "supplyOrder") return `${base} and ${statusDeliveryDueOrderSql()}`;
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

function billReturnStatusFilterSql(state: "any" | "pending" | "resubmitted" | "paid") {
  const returnedCycleSql = (source: string) => `exists (
    select 1
    from jsonb_array_elements(coalesce(${source}, '[]'::jsonb)) as bill_return(cycle)
    where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
  )`;
  const pendingCycleSql = (source: string) => `exists (
    select 1
    from jsonb_array_elements(coalesce(${source}, '[]'::jsonb)) as bill_return(cycle)
    where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
      and not ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
  )`;
  const resubmittedCycleSql = (source: string) => `exists (
    select 1
    from jsonb_array_elements(coalesce(${source}, '[]'::jsonb)) as bill_return(cycle)
    where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
      and ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
  )`;
  const resolvedCycleSql = (source: string) =>
    `${resubmittedCycleSql(source)} and not ${pendingCycleSql(source)}`;
  const mainSource = "so.bill_return_cycles";
  const advanceSource = "so.advance_payment_detail -> 'billReturnCycles'";
  const stageEntrySql = (condition: (source: string) => string) => `exists (
	    select 1
	    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_row(stage)
	    where ${condition("stage_row.stage -> 'billReturnCycles'")}
	  )`;
  const anyPaymentEntrySql = (condition: (source: string) => string) =>
    `(${condition(mainSource)} or ${stageEntrySql(condition)} or ${condition(advanceSource)})`;
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
      : state === "resubmitted"
        ? anyPaymentEntrySql(resolvedCycleSql)
        : state === "paid"
          ? paidPaymentEntrySql
          : anyPaymentEntrySql(returnedCycleSql);
  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `not ${isYesSql("so.so_cancelled")} and ${stateSql}`,
  )}`;
}

function supplementaryBillStatusSql(state: "submitted" | "returned" | "resubmitted" | "paid") {
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
  const openReturn = `exists (
    select 1
    from jsonb_array_elements(coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)) as bill_return(cycle)
    where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
      and not ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
  )`;
  const completedReturn = `exists (
    select 1
    from jsonb_array_elements(coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)) as bill_return(cycle)
    where ${hasTextSql("bill_return.cycle ->> 'returnedDate'")}
      and ${hasTextSql("bill_return.cycle ->> 'resubmittedDate'")}
  )`;
  const stateCondition =
    state === "paid"
      ? hasTextSql("supplementary_bill.bill ->> 'paymentDate'")
      : state === "returned"
        ? `not ${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")} and ${openReturn}`
        : state === "resubmitted"
          ? `not ${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")}
             and not ${openReturn}
             and ${completedReturn}`
          : `${hasTextSql("supplementary_bill.bill ->> 'billSentForPaymentDate'")}
             and not ${hasTextSql("supplementary_bill.bill ->> 'paymentDate'")}
             and not ${openReturn}
             and not ${completedReturn}`;
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
): state is "any" | "pending" | "resubmitted" | "paid" {
  return state === "any" || state === "pending" || state === "resubmitted" || state === "paid";
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
  const maintenanceFileType = `lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m')`;
  const goodsServicesIrNo = `(not ${isYesSql("f.ir")} and not ${maintenanceFileType})`;
  const nonDeliveryFileType = `(${goodsServicesIrNo} or ${maintenanceFileType})`;
  const stageDpDate = `coalesce(nullif(stage_row.stage ->> 'revisedDp', '')::date, nullif(stage_row.stage ->> 'dpDate', '')::date)`;
  const stageJobCompletionDone = `coalesce(stage_row.stage ->> 'jobCompletionDate', '') <> ''`;
  const orderJobCompletionDone = completedOrderMilestoneSql("so", "jobcompletion");
  const stageReportBaseDate = `case
      when ${maintenanceFileType} then (${stageDpDate} + interval '1 day')::date
      when ${goodsServicesIrNo} and ${stageJobCompletionDone} then nullif(stage_row.stage ->> 'jobCompletionDate', '')::date
      else nullif(stage_row.stage ->> 'materialReceiptDate', '')::date
    end`;
  const orderReportBaseDate = `case
      when ${maintenanceFileType} then (coalesce(so.revised_dp, so.dp_date) + interval '1 day')::date
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
    if (mode === "returnedBills") {
      return `(select min(nullif(cycle ->> 'returnedDate', '')::date)
        from jsonb_array_elements(coalesce(${cyclesExpression}, '[]'::jsonb)) as cycle
        where coalesce(cycle ->> 'returnedDate', '') <> '')`;
    }
    if (mode === "pendingReturnedBills") {
      return `(select min(nullif(cycle ->> 'returnedDate', '')::date)
        from jsonb_array_elements(coalesce(${cyclesExpression}, '[]'::jsonb)) as cycle
        where coalesce(cycle ->> 'returnedDate', '') <> ''
          and coalesce(cycle ->> 'resubmittedDate', '') = '')`;
    }
    if (mode === "returnedBillsResubmitted") {
      return `(select min(nullif(cycle ->> 'resubmittedDate', '')::date)
        from jsonb_array_elements(coalesce(${cyclesExpression}, '[]'::jsonb)) as cycle
        where coalesce(cycle ->> 'returnedDate', '') <> ''
          and coalesce(cycle ->> 'resubmittedDate', '') <> '')`;
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
    const hasReturned = `exists (
      select 1
      from jsonb_array_elements(coalesce(${cyclesExpression}, '[]'::jsonb)) as cycle
      where coalesce(cycle ->> 'returnedDate', '') <> ''
    )`;
    const hasOpen = `exists (
      select 1
      from jsonb_array_elements(coalesce(${cyclesExpression}, '[]'::jsonb)) as cycle
      where coalesce(cycle ->> 'returnedDate', '') <> ''
        and coalesce(cycle ->> 'resubmittedDate', '') = ''
    )`;
    const hasResubmitted = `exists (
      select 1
      from jsonb_array_elements(coalesce(${cyclesExpression}, '[]'::jsonb)) as cycle
      where coalesce(cycle ->> 'returnedDate', '') <> ''
        and coalesce(cycle ->> 'resubmittedDate', '') <> ''
    )`;
    if (mode === "returnedBills") return hasReturned;
    if (mode === "pendingReturnedBills") return hasOpen;
    if (mode === "returnedBillsResubmitted") return `${hasResubmitted} and not ${hasOpen}`;
    return `${paymentDateExpression} is not null and ${hasResubmitted} and not ${hasOpen}`;
  };
  const openBillReturnSql = (cyclesExpression: string) => `exists (
    select 1
    from jsonb_array_elements(coalesce(${cyclesExpression}, '[]'::jsonb)) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
      and coalesce(cycle ->> 'resubmittedDate', '') = ''
  )`;
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
    return `${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")} and (
        (
          coalesce(so.revised_dp, so.dp_date) is not null
          and (
            (
              ${nonDeliveryFileType}
              and ${asOfMissingOrAfterSql("so.bill_preparation_date") ?? `not ${hasTextSql("so.bill_preparation_date")}`}
              and ${asOfMissingOrAfterSql("so.bill_sent_for_payment_date") ?? `not ${hasTextSql("so.bill_sent_for_payment_date")}`}
              and ${asOfMissingOrAfterSql("so.payment_date") ?? `not ${hasTextSql("so.payment_date")}`}
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
    const childBaseDate = orderReportBaseDate;
    const legacyBaseDate = legacyReportBaseDate;
    const childDate = `(${childBaseDate} + ${offsetInterval})::date`;
    const legacyDate = `(${legacyBaseDate} + ${offsetInterval})::date`;
    const stageDate = `(${stageReportBaseDate} + ${offsetInterval})::date`;
    return `${monthPlaceholder}::text is not null and ${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")} and (
        (
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
      `not ${isYesSql("so.so_cancelled")} and (
        (
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
    const childBaseDate = orderReportBaseDate;
    const legacyBaseDate = legacyReportBaseDate;
    const childDate = `(${childBaseDate} + ${offsetInterval})::date`;
    const legacyDate = `(${legacyBaseDate} + ${offsetInterval})::date`;
    const stageDate = `(${stageReportBaseDate} + ${offsetInterval})::date`;
    return `${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")} and (
        (
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
    const supplementaryPendingReturnedDate = `(select min(nullif(cycle ->> 'returnedDate', '')::date)
      from jsonb_array_elements(${supplementaryCycles}) as cycle
      where coalesce(cycle ->> 'returnedDate', '') <> ''
        and coalesce(cycle ->> 'resubmittedDate', '') = '')`;
    const supplementaryPaymentDate = `nullif(supplementary_bill.bill ->> 'paymentDate', '')::date`;
    return `${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")} and (
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
      `not ${isYesSql("so.so_cancelled")} and (
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
      `not ${isYesSql("so.so_cancelled")} and (
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
    const returnedDate = `(select min(nullif(cycle ->> 'returnedDate', '')::date)
      from jsonb_array_elements(${cycles}) as cycle
      where coalesce(cycle ->> 'returnedDate', '') <> '')`;
    const pendingReturnedDate = `(select min(nullif(cycle ->> 'returnedDate', '')::date)
      from jsonb_array_elements(${cycles}) as cycle
      where coalesce(cycle ->> 'returnedDate', '') <> ''
        and coalesce(cycle ->> 'resubmittedDate', '') = '')`;
    const resubmittedDate = `(select min(nullif(cycle ->> 'resubmittedDate', '')::date)
      from jsonb_array_elements(${cycles}) as cycle
      where coalesce(cycle ->> 'returnedDate', '') <> ''
        and coalesce(cycle ->> 'resubmittedDate', '') <> '')`;
    const hasReturned = `exists (
      select 1 from jsonb_array_elements(${cycles}) as cycle
      where coalesce(cycle ->> 'returnedDate', '') <> ''
    )`;
    const hasOpenReturned = `exists (
      select 1 from jsonb_array_elements(${cycles}) as cycle
      where coalesce(cycle ->> 'returnedDate', '') <> ''
        and coalesce(cycle ->> 'resubmittedDate', '') = ''
    )`;
    const hasResubmitted = `exists (
      select 1 from jsonb_array_elements(${cycles}) as cycle
      where coalesce(cycle ->> 'returnedDate', '') <> ''
        and coalesce(cycle ->> 'resubmittedDate', '') <> ''
    )`;
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
          ? `${hasResubmitted} and not ${hasOpenReturned} and ${paymentDate} is null`
          : parsed.mode === "supplementaryPendingReturnedBills"
            ? `${hasOpenReturned} and ${paymentDate} is null`
            : hasReturned;
    return `${activeFile} and ${supplyOrderChildSql(
      `not ${isYesSql("so.so_cancelled")}
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
  const stageDpDate = `coalesce(
    nullif(delivery_period_stage.stage ->> 'revisedDp', '')::date,
    nullif(delivery_period_stage.stage ->> 'dpDate', '')::date
  )`;
  const dateCondition =
    kind === "valid"
      ? `${orderDpDate} >= current_date`
      : kind === "expired"
        ? `${orderDpDate} < current_date`
        : `${hasTextSql("so.revised_dp")} and ${orderDpDate} >= current_date`;
  const stageDateCondition =
    kind === "valid"
      ? `${stageDpDate} >= current_date`
      : kind === "expired"
        ? `${stageDpDate} < current_date`
        : `coalesce(delivery_period_stage.stage ->> 'revisedDp', '') <> '' and ${stageDpDate} >= current_date`;
  const orderIncomplete = `((${deliveryInspectionApplicableSql()} and not ${hasTextSql(
    "so.material_receipt_date",
  )}) or (not (${deliveryInspectionApplicableSql()}) and not ${completedOrderMilestoneSql(
    "so",
    "jobcompletion",
  )}))`;
  const stageIncomplete = `((${deliveryInspectionApplicableSql()} and coalesce(delivery_period_stage.stage ->> 'materialReceiptDate', '') = '')
    or (not (${deliveryInspectionApplicableSql()}) and not ${stageJobCompletionDoneSql()}))`;

  return `not ${isCancelledFileSql()} and ${supplyOrderExists(
    `${hasTextSql("so.so_date")} and (
      (
        ${orderDpDate} is not null
        and ${dateCondition}
        and ${orderIncomplete}
      )
      or exists (
        select 1
        from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as delivery_period_stage(stage)
        where ${isYesSql("so.stage_delivery")}
          and ${stageDpDate} is not null
          and ${stageDateCondition}
          and ${stageIncomplete}
      )
    )`,
  )}`;
}

function inrAmountExpression(column: string) {
  return `case
    when ${column} is null then 0
    when upper(trim(coalesce(f.currency, 'INR'))) in ('', 'INR') then ${column}
    when f.exchange_rate > 0 then ${column} * f.exchange_rate
    else 0
  end`;
}

function valueThresholdMatchSql(alias: string, amount: string, valueType: string) {
  return `(${amount} > 0
    and (${alias}.applies_to = 'both' or ${alias}.applies_to = ${valueType})
    and (${alias}.min_value is null or ${amount} >= ${alias}.min_value)
    and (${alias}.max_value is null or ${amount} <= ${alias}.max_value))`;
}

function valueThresholdFinancialYearSql(values: unknown[], financialYear: string | undefined) {
  if (!financialYear) return "f.year";
  return addSqlValue(values, financialYear);
}

function valueThresholdFilterSql(
  filter: string,
  values: unknown[],
  thresholdFinancialYear: string | undefined,
) {
  const rawLabel = filter.slice("valueThreshold:".length);
  const label = decodeURIComponent(rawLabel).trim();
  if (!label) return "true";
  const financialYearSql = valueThresholdFinancialYearSql(values, thresholdFinancialYear);
  const capital = inrAmountExpression("f.value_capital");
  const revenue = inrAmountExpression("f.value_revenue");
  const valueType = `case when ${capital} > 0 then 'capital' when ${revenue} > 0 then 'revenue' end`;
  const amount = `case when ${capital} > 0 then ${capital} when ${revenue} > 0 then ${revenue} else 0 end`;
  const levelMatch = valueThresholdMatchSql("v", amount, valueType);

  if (label.toLowerCase() === "unmatched") {
    return `${amount} > 0 and not exists (
      select 1 from value_threshold_levels v
      where v.financial_year = ${financialYearSql}
        and ${levelMatch}
    )`;
  }

  const labelPlaceholder = addSqlValue(values, label.toLowerCase());
  const priorMatch = valueThresholdMatchSql("previous_v", amount, valueType);
  return `exists (
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
  )`;
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
  const rawLabel = filter.slice("soValueThreshold:".length);
  const label = decodeURIComponent(rawLabel).trim();
  if (!label) return "true";
  const financialYearSql = valueThresholdFinancialYearSql(values, thresholdFinancialYear);
  const capital = inrAmountExpression("so.so_value_capital");
  const revenue = inrAmountExpression("so.so_value_revenue");
  const valueType = `case when ${capital} > 0 then 'capital' when ${revenue} > 0 then 'revenue' end`;
  const amount = `case when ${capital} > 0 then ${capital} when ${revenue} > 0 then ${revenue} else 0 end`;
  const activeOrder = `not ${isYesSql("so.so_cancelled")} and not ${isYesSql("so.shortclosure")}`;
  const levelMatch = valueThresholdMatchSql("v", amount, valueType);

  if (label.toLowerCase() === "unmatched") {
    return `exists (
      select 1 from supply_orders so
      where so.file_id = f.id
        and ${activeOrder}
        and ${amount} > 0
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
      and ${activeOrder}
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
  const activeOrder = `not ${isYesSql("so.so_cancelled")} and not ${isYesSql("so.shortclosure")}`;
  const valueCondition =
    metric === "capital"
      ? `${capital} > 0`
      : metric === "revenue"
        ? `${revenue} > 0`
        : `(${capital} > 0 or ${revenue} > 0)`;
  return supplyOrderExists(`${activeOrder} and ${valueCondition}`);
}

function isCancellationDashboardFilter(filter: string) {
  return (
    filter === "miscDemandCancelled" ||
    filter === "miscSoCancelled" ||
    filter === "miscShortclosedSo"
  );
}

function workflowNotStartedSql() {
  const dateFields = [
    "scrutiny_date",
    "scrutiny_response_date",
    "scrutiny_completion_date",
    "imms_date",
    "high_value_meeting_date",
    "high_value_minutes_date",
    "ad_sent_date",
    "pre_tcec_date",
    "pre_tcec_minutes_date",
    "ad_vetting_date",
    "rqa_sent_date",
    "rqa_approval_date",
    "ifa_sent_date",
    "ifa_final_date",
    "cfa_sent_date",
    "cfa_date",
    "gem_undertaking_date",
    "rfp_vetting_initiation_date",
    "rfp_vetting_approval_date",
    "pre_bid_meeting_date",
    "bid_date",
    "bid_opening_date",
    "refloat_pre_bid_meeting_date",
    "refloat_bidding_date",
    "refloat_bid_opening_date",
    "post_tcec_date",
    "post_tcec_minutes_date",
    "cnc_date",
    "cnc_approval_date",
  ];
  const noFileDates = dateFields.map((column) => `not ${hasTextSql(`f.${column}`)}`).join(" and ");
  return `not ${isCancelledFileSql()}
    and not ${hasTextSql("f.current_milestone")}
    and not exists (select 1 from file_completed_milestones completed where completed.file_id = f.id)
    and ${noFileDates}
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
          or ${hasTextSql("so_workflow.ir_preparation_date")}
          or ${hasTextSql("so_workflow.ir_receipt_date")}
          or ${hasTextSql("so_workflow.bill_preparation_date")}
          or ${hasTextSql("so_workflow.bill_sent_for_payment_date")}
          or ${hasTextSql("so_workflow.payment_date")}
        )
    )`;
}

function shouldShowDemandCancelledFiles(params: FileSearchParams) {
  return params.demandCancelledFilter || params.dashboardFilter?.trim() === "miscDemandCancelled";
}

function shouldShowCancelledSupplyOrderFiles(params: FileSearchParams) {
  const dashboardFilter = params.dashboardFilter?.trim();
  return (
    params.soCancelledFilter ||
    params.demandCancelledFilter ||
    (dashboardFilter ? isCancellationDashboardFilter(dashboardFilter) : false)
  );
}

function dashboardFilterSql(
  filter: string,
  values: unknown[],
  thresholdFinancialYear?: string | undefined,
) {
  const today = "current_date";
  if (filter.startsWith("delayStatus:")) return delayStatusFilterSql(filter, values);
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
  if (filter === "supplementaryBill:submitted" || filter === "supplementaryBill:pending")
    return supplementaryBillStatusSql("submitted");
  if (filter === "supplementaryBill:returned") return supplementaryBillStatusSql("returned");
  if (filter === "supplementaryBill:resubmitted") return supplementaryBillStatusSql("resubmitted");
  if (filter === "supplementaryBill:paid") return supplementaryBillStatusSql("paid");
  if (filter.startsWith("biddingDelay:")) {
    const [, rawDays = "0", breakupKey = ""] = filter.split(":");
    const thresholdDays = Number.parseInt(rawDays, 10);
    if (!Number.isFinite(thresholdDays) || thresholdDays < 0) return "false";
    const thresholdPlaceholder = addSqlValue(values, thresholdDays);
    return biddingDelayStatusSql(breakupKey, thresholdPlaceholder);
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
  if (filter.startsWith("fileIds:")) {
    const ids = filter
      .slice("fileIds:".length)
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
        `not ${isYesSql("so.so_cancelled")}
         and ${isYesSql("so.psb_applicable")}
         and trim(coalesce(so.bg_coverage_type, '')) in ('PSB', 'PSB and PWB separately')`,
      );
      if (value === "yes") return condition;
      if (value === "no") return `not (${condition})`;
      return "true";
    }
    const column = fileSearchColumns[key as keyof typeof fileSearchColumns];
    if (!column) return "true";
    if (value === "yes") return isYesSql(column);
    if (value === "no") return isNoSql(column);
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
        and (
          upper(trim(coalesce(so.firm_type, ''))) = ${placeholder}
          or upper(trim(coalesce(so.firm_type_other, ''))) = ${placeholder}
        )
    )`;
  }
  if (filter.startsWith("supplyOrderMonth:")) {
    const monthKey = filter.slice("supplyOrderMonth:".length);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return "true";
    const fromPlaceholder = addSqlValue(values, `${monthKey}-01`);
    const toPlaceholder = addSqlValue(values, getMonthEndDateFromMonthKey(monthKey));
    return `not ${isCancelledFileSql()} and ${supplyOrderExists(
      `${hasTextSql("so.so_date")}
       and so.so_date >= ${fromPlaceholder}::date
       and so.so_date <= ${toPlaceholder}::date
       and not ${isYesSql("so.so_cancelled")}`,
    )}`;
  }
  if (filter.startsWith("supplyOrderYear:")) {
    const yearKey = filter.slice("supplyOrderYear:".length);
    if (yearKey !== "all" && !/^\d{4}$/.test(yearKey)) return "true";
    const dateCondition =
      yearKey === "all"
        ? hasTextSql("so.so_date")
        : (() => {
            const fromPlaceholder = addSqlValue(values, `${yearKey}-01-01`);
            const toPlaceholder = addSqlValue(values, `${yearKey}-12-31`);
            return `${hasTextSql("so.so_date")}
       and so.so_date >= ${fromPlaceholder}::date
       and so.so_date <= ${toPlaceholder}::date`;
          })();
    return `not ${isCancelledFileSql()} and ${supplyOrderExists(
      `${dateCondition}
       and not ${isYesSql("so.so_cancelled")}`,
    )}`;
  }
  if (filter.startsWith("fileInflowMonth:")) {
    const monthKey = filter.slice("fileInflowMonth:".length);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return "true";
    const fromPlaceholder = addSqlValue(values, `${monthKey}-01`);
    const toPlaceholder = addSqlValue(values, getMonthEndDateFromMonthKey(monthKey));
    return `f.received_date >= ${fromPlaceholder}::date
      and f.received_date <= ${toPlaceholder}::date`;
  }
  if (filter.startsWith("fileInflowYear:")) {
    const yearKey = filter.slice("fileInflowYear:".length);
    if (yearKey === "all") return hasTextSql("f.received_date");
    if (!/^\d{4}$/.test(yearKey)) return "true";
    const fromPlaceholder = addSqlValue(values, `${yearKey}-01-01`);
    const toPlaceholder = addSqlValue(values, `${yearKey}-12-31`);
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
    const monthCondition = /^\d{4}-\d{2}$/.test(monthKey)
      ? (() => {
          const fromPlaceholder = addSqlValue(values, `${monthKey}-01`);
          const toPlaceholder = addSqlValue(values, getMonthEndDateFromMonthKey(monthKey));
          return `and ${dateColumn} >= ${fromPlaceholder}::date
            and ${dateColumn} <= ${toPlaceholder}::date`;
        })()
      : "";
    return `not ${isCancelledFileSql()}
      and ${biddingApplicableSql()}
      and ${applies}
      and ${hasTextSql(dateColumn)}
      and ${stateCondition}
      ${monthCondition}`;
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
    return `not ${isCancelledFileSql()}
      and ${biddingApplicableSql()}
      and ${applies}
      and ${hasTextSql(dateColumn)}
      and ${stateCondition}
      and ${fyCondition}`;
  }
  if (filter.startsWith("deliverySchedule:")) {
    const [, mode = "gross", monthKey = ""] = filter.split(":");
    if ((mode !== "gross" && mode !== "net") || !/^\d{4}-\d{2}$/.test(monthKey)) return "true";
    const fromPlaceholder = addSqlValue(values, `${monthKey}-01`);
    const toPlaceholder = addSqlValue(values, getMonthEndDateFromMonthKey(monthKey));
    const stageDpDate = `coalesce(
      nullif(stage_delivery.stage ->> 'revisedDp', '')::date,
      nullif(stage_delivery.stage ->> 'dpDate', '')::date
    )`;
    const nonMaterialReceiptFileType = `(not ${isYesSql("f.ir")} or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`;
    const stageJobCompletionDone = `coalesce(stage_delivery.stage ->> 'jobCompletionDate', '') <> ''`;
    const orderJobCompletionDone = completedOrderMilestoneSql("so", "jobcompletion");
    const stageFructified = `((not ${nonMaterialReceiptFileType}
	        and coalesce(stage_delivery.stage ->> 'materialReceiptDate', '') <> '')
	      or (${nonMaterialReceiptFileType} and ${stageJobCompletionDone})
	      or exists (
        select 1
        from jsonb_array_elements_text(
          coalesce(stage_delivery.stage -> 'completedMilestones', '[]'::jsonb)
        ) as completed_stage(milestone)
        where ${normalizedSql("completed_stage.milestone")} = 'delivery'
      ))`;
    const orderDpDate = `coalesce(so.revised_dp, so.dp_date)`;
    const orderFructified = `((not ${nonMaterialReceiptFileType}
	        and ${hasTextSql("so.material_receipt_date")})
	      or (${nonMaterialReceiptFileType} and ${orderJobCompletionDone})
	      or ${completedOrderMilestoneSql("so", "delivery")})`;
    const netStageCondition = mode === "net" ? ` and not ${stageFructified}` : "";
    const netOrderCondition = mode === "net" ? ` and not ${orderFructified}` : "";
    return `not ${isCancelledFileSql()} and ${supplyOrderExists(
      `not ${isYesSql("so.so_cancelled")} and (
        exists (
          select 1
          from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_delivery(stage)
          where ${isYesSql("so.stage_delivery")}
            and ${stageDpDate} >= ${fromPlaceholder}::date
            and ${stageDpDate} <= ${toPlaceholder}::date
            ${netStageCondition}
        )
        or (
          not (${isYesSql("so.stage_delivery")}
            and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)
          and ${orderDpDate} >= ${fromPlaceholder}::date
          and ${orderDpDate} <= ${toPlaceholder}::date
          ${netOrderCondition}
        )
      )`,
    )}`;
  }
  if (filter.startsWith("deliveryScheduleYear:")) {
    const [, mode = "gross", yearKey = ""] = filter.split(":");
    if ((mode !== "gross" && mode !== "net") || (yearKey !== "all" && !/^\d{4}$/.test(yearKey))) {
      return "true";
    }
    const stageDpDate = `coalesce(
      nullif(stage_delivery.stage ->> 'revisedDp', '')::date,
      nullif(stage_delivery.stage ->> 'dpDate', '')::date
    )`;
    const nonMaterialReceiptFileType = `(not ${isYesSql("f.ir")} or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`;
    const stageJobCompletionDone = `coalesce(stage_delivery.stage ->> 'jobCompletionDate', '') <> ''`;
    const orderJobCompletionDone = completedOrderMilestoneSql("so", "jobcompletion");
    const stageFructified = `((not ${nonMaterialReceiptFileType}
	        and coalesce(stage_delivery.stage ->> 'materialReceiptDate', '') <> '')
	      or (${nonMaterialReceiptFileType} and ${stageJobCompletionDone})
	      or exists (
        select 1
        from jsonb_array_elements_text(
          coalesce(stage_delivery.stage -> 'completedMilestones', '[]'::jsonb)
        ) as completed_stage(milestone)
        where ${normalizedSql("completed_stage.milestone")} = 'delivery'
      ))`;
    const orderDpDate = `coalesce(so.revised_dp, so.dp_date)`;
    const orderFructified = `((not ${nonMaterialReceiptFileType}
	        and ${hasTextSql("so.material_receipt_date")})
	      or (${nonMaterialReceiptFileType} and ${orderJobCompletionDone})
	      or ${completedOrderMilestoneSql("so", "delivery")})`;
    const dateRangeCondition = (dateExpression: string) => {
      if (yearKey === "all") return `${dateExpression} is not null`;
      const fromPlaceholder = addSqlValue(values, `${yearKey}-01-01`);
      const toPlaceholder = addSqlValue(values, `${yearKey}-12-31`);
      return `${dateExpression} >= ${fromPlaceholder}::date and ${dateExpression} <= ${toPlaceholder}::date`;
    };
    const netStageCondition = mode === "net" ? ` and not ${stageFructified}` : "";
    const netOrderCondition = mode === "net" ? ` and not ${orderFructified}` : "";
    return `not ${isCancelledFileSql()} and ${supplyOrderExists(
      `not ${isYesSql("so.so_cancelled")} and (
        exists (
          select 1
          from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_delivery(stage)
          where ${isYesSql("so.stage_delivery")}
            and ${dateRangeCondition(stageDpDate)}
            ${netStageCondition}
        )
        or (
          not (${isYesSql("so.stage_delivery")}
            and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)
          and ${dateRangeCondition(orderDpDate)}
          ${netOrderCondition}
        )
      )`,
    )}`;
  }
  if (filter.startsWith("completedDeliveryMonth:")) {
    const monthKey = filter.slice("completedDeliveryMonth:".length);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return "true";
    const fromPlaceholder = addSqlValue(values, `${monthKey}-01`);
    const toPlaceholder = addSqlValue(values, getMonthEndDateFromMonthKey(monthKey));
    const stageMaterialReceiptDate = `nullif(stage_delivery.stage ->> 'materialReceiptDate', '')::date`;
    const stageDpDate = `coalesce(
	      nullif(stage_delivery.stage ->> 'revisedDp', '')::date,
	      nullif(stage_delivery.stage ->> 'dpDate', '')::date
	    )`;
    const orderDpDate = `coalesce(so.revised_dp, so.dp_date)`;
    const nonMaterialReceiptFileType = `(not ${isYesSql("f.ir")} or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`;
    const stageJobCompletionDone = `coalesce(stage_delivery.stage ->> 'jobCompletionDate', '') <> ''`;
    const orderJobCompletionDone = completedOrderMilestoneSql("so", "jobcompletion");
    return `not ${isCancelledFileSql()}
	      and ${supplyOrderExists(
          `not ${isYesSql("so.so_cancelled")} and (
	          exists (
	            select 1
	            from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_delivery(stage)
	            where ${isYesSql("so.stage_delivery")}
	              and (
	                (not ${nonMaterialReceiptFileType}
	                  and ${stageMaterialReceiptDate} >= ${fromPlaceholder}::date
	                  and ${stageMaterialReceiptDate} <= ${toPlaceholder}::date)
	                or (${nonMaterialReceiptFileType}
	                  and ${stageJobCompletionDone}
	                  and ${stageDpDate} >= ${fromPlaceholder}::date
	                  and ${stageDpDate} <= ${toPlaceholder}::date)
	              )
	          )
	          or (
	            not (${isYesSql("so.stage_delivery")}
	              and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)
	            and (
	              (not ${nonMaterialReceiptFileType}
	                and ${hasTextSql("so.material_receipt_date")}
	                and so.material_receipt_date >= ${fromPlaceholder}::date
	                and so.material_receipt_date <= ${toPlaceholder}::date)
	              or (${nonMaterialReceiptFileType}
	                and ${orderJobCompletionDone}
	                and ${orderDpDate} >= ${fromPlaceholder}::date
	                and ${orderDpDate} <= ${toPlaceholder}::date)
	            )
	          )
	        )`,
        )}`;
  }
  if (filter.startsWith("completedDeliveryYear:")) {
    const yearKey = filter.slice("completedDeliveryYear:".length);
    if (yearKey !== "all" && !/^\d{4}$/.test(yearKey)) return "true";
    const stageMaterialReceiptDate = `nullif(stage_delivery.stage ->> 'materialReceiptDate', '')::date`;
    const stageDpDate = `coalesce(
	      nullif(stage_delivery.stage ->> 'revisedDp', '')::date,
	      nullif(stage_delivery.stage ->> 'dpDate', '')::date
	    )`;
    const orderDpDate = `coalesce(so.revised_dp, so.dp_date)`;
    const nonMaterialReceiptFileType = `(not ${isYesSql("f.ir")} or lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`;
    const stageJobCompletionDone = `coalesce(stage_delivery.stage ->> 'jobCompletionDate', '') <> ''`;
    const orderJobCompletionDone = completedOrderMilestoneSql("so", "jobcompletion");
    const dateRangeCondition = (dateExpression: string) => {
      if (yearKey === "all") return `${dateExpression} is not null`;
      const fromPlaceholder = addSqlValue(values, `${yearKey}-01-01`);
      const toPlaceholder = addSqlValue(values, `${yearKey}-12-31`);
      return `${dateExpression} >= ${fromPlaceholder}::date and ${dateExpression} <= ${toPlaceholder}::date`;
    };
    return `not ${isCancelledFileSql()}
	      and ${supplyOrderExists(
          `not ${isYesSql("so.so_cancelled")} and (
	          exists (
	            select 1
	            from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as stage_delivery(stage)
	            where ${isYesSql("so.stage_delivery")}
	              and (
	                (not ${nonMaterialReceiptFileType}
	                  and ${dateRangeCondition(stageMaterialReceiptDate)})
	                or (${nonMaterialReceiptFileType}
	                  and ${stageJobCompletionDone}
	                  and ${dateRangeCondition(stageDpDate)})
	              )
	          )
	          or (
	            not (${isYesSql("so.stage_delivery")}
	              and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0)
	            and (
	              (not ${nonMaterialReceiptFileType}
	                and ${hasTextSql("so.material_receipt_date")}
	                and ${dateRangeCondition("so.material_receipt_date")})
	              or (${nonMaterialReceiptFileType}
	                and ${orderJobCompletionDone}
	                and ${dateRangeCondition(orderDpDate)})
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
    return supplyOrderExists(`(${categoryConditions.join(" or ")})`);
  }
  if (filter.startsWith("bgExpiryYear:")) {
    const [, category = "all", yearKey = ""] = filter.split(":");
    if (yearKey !== "all" && !/^\d{4}$/.test(yearKey)) return "true";
    const categories = category === "all" ? ["psb", "pwb", "psbpwb"] : [category];
    const dateRangeCondition = (validityColumn: string) => {
      if (yearKey === "all") return `${hasTextSql(`so.${validityColumn}`)}`;
      const fromPlaceholder = addSqlValue(values, `${yearKey}-01-01`);
      const toPlaceholder = addSqlValue(values, `${yearKey}-12-31`);
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
    return supplyOrderExists(`(${categoryConditions.join(" or ")})`);
  }
  if (filter.startsWith("bgReceiptDelay:")) {
    const [, category = "all", rawDays = "0"] = filter.split(":");
    const days = Math.max(0, Number.parseInt(rawDays, 10) || 0);
    const categories = category === "all" ? ["psb", "pwb", "psbpwb"] : [category];
    const categoryConditions = categories.filter(isBgStatusKey).map((item) => {
      return `(${bgCategorySql("so", item)}
        and not ${bgReceivedOrderSql("so", item)}
        and ${bgReceiptDelayBaseExpiredSql(item, days)})`;
    });
    if (!categoryConditions.length) return "true";
    return `not ${isCancelledFileSql()} and ${supplyOrderExists(
      `not ${isYesSql("so.so_cancelled")} and (${categoryConditions.join(" or ")})`,
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
  if (filter.startsWith("valueThresholdTotal:")) return valueThresholdTotalFilterSql(filter);
  if (filter.startsWith("soValueThreshold:")) {
    return soValueThresholdFilterSql(filter, values, thresholdFinancialYear);
  }
  if (filter.startsWith("soValueThresholdTotal:")) return soValueThresholdTotalFilterSql(filter);
  if (filter.startsWith("mode:")) {
    const placeholder = addSqlValue(
      values,
      decodeURIComponent(filter.slice(5)).trim().toUpperCase(),
    );
    return `upper(trim(coalesce(f.mode, ''))) = ${placeholder}`;
  }
  if (filter.startsWith("manualMilestoneCurrent:")) {
    const milestone = filter.slice("manualMilestoneCurrent:".length);
    const normalized = normalizeMilestoneName(milestone);
    if (normalized === "bankguarantee") return bgToBeReceivedSql("psb");
    if (normalized === "payment") return paymentPendingSql();
    if (normalized === "jobcompletion") return jobCompletionFilterSql("live");
    if (normalized === "supplementarybillreturnedforcorrection") {
      return supplementaryBillStatusSql("returned");
    }
    if (normalized === "refloatbidding") {
      return `not ${isCancelledFileSql()} and ${isYesSql("f.refloat")} and not ${isYesSql("f.bidding_stage_over")}`;
    }
    if (normalized === "refloatposttcec") {
      return `not ${isCancelledFileSql()} and ${isYesSql("f.refloat")} and ${isYesSql("f.tcec")} and ${isYesSql("f.bidding_stage_over")} and not ${hasTextSql("f.refloat_post_tcec_minutes_date")}`;
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
    if (isSupplyOrderDrivenMilestoneName(milestone)) {
      return supplyOrderDrivenCompletedMilestoneConditionSql(normalizeMilestoneName(milestone));
    }
    const placeholder = addSqlValue(values, milestone);
    return completedMilestoneExists(`completed.milestone = ${placeholder}`);
  }
  if (filter === "totalFiles") return "true";
  if (filter === "demandsControlled") return hasTextSql("f.imms");
  if (filter === "tcecFiles") return isYesSql("f.tcec");
  if (filter === "nonTcecFiles") return isNoSql("f.tcec");
  if (filter === "highValueFiles") return isYesSql("f.high_value");
  if (filter === "adYes") return isYesSql("f.ad");
  if (filter === "rqaVetting") return isYesSql("f.rqa");
  if (filter === "ifaConcurrence") return isYesSql("f.ifa");
  if (filter === "liveBids") return `${biddingApplicableSql()} and ${isYesSql("f.tender_live")}`;
  if (filter === "bidOverdue") return bidOpeningOverdueSql(today);
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
  if (filter === "jobCompletionCompleted") return jobCompletionCompletedFilterSql();
  if (filter === "jobCompletionDue" || filter === "jobCompletionLive")
    return jobCompletionFilterSql("live");
  if (filter === "jobCompletionPeriodOver") return jobCompletionFilterSql("periodOver");
  if (filter === "deliveryPeriodValid") return deliveryPeriodBucketSql("valid");
  if (filter === "deliveryPeriodExpired")
    return `not ${isCancelledFileSql()} and ${supplyOrderExists(
      `${hasTextSql("so.so_date")}
       and not ${isYesSql("so.so_cancelled")}
       and (
         (${effectiveDpDateSql("so")} is not null and ${effectiveDpDateSql("so")} < current_date)
         or exists (
           select 1
           from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as delivery_period_stage(stage)
           where ${isYesSql("so.stage_delivery")}
             and coalesce(
               nullif(delivery_period_stage.stage ->> 'revisedDp', '')::date,
               nullif(delivery_period_stage.stage ->> 'dpDate', '')::date
             ) < current_date
         )
       )`,
    )}`;
  if (filter === "deliveryPeriodExtended") return deliveryPeriodBucketSql("extended");
  if (filter === "irPreparationPending") return irStatusFilterSql("preparationPending");
  if (filter === "irReceiptPending") return irStatusFilterSql("receiptPending");
  if (filter === "irCompleted") return irStatusFilterSql("completed");
  if (filter === "paymentDue") return paymentPendingSql();
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
       and ${normalizedSql("so.advance_payment_detail ->> 'currentMilestone'")} = 'advancepayment'
       and not ${hasTextSql("so.advance_payment_detail ->> 'paymentDate'")}`,
    );
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
  if (filter === "adCompleted") return hasTextSql("f.ad_vetting_date");
  if (filter === "adRemaining")
    return `${hasTextSql("f.pre_tcec_date")} and not ${hasTextSql("f.ad_vetting_date")}`;
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
    if (scope === "so") {
      return [
        supplyOrderExists(`lower(coalesce(${soColumns[field]}, '')) like ${placeholder}`),
        field === "firmName" ? `lower(coalesce(f.firm, '')) like ${placeholder}` : "",
      ].filter(Boolean);
    }
    return [
      `${biddingApplicableSql()} and ${firmDetailsExists(
        scope,
        `lower(coalesce(${firmColumns[field]}, '')) like ${placeholder}`,
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
    if (normalized === "financialsanction" || normalized === "supplyorder") {
      return `(coalesce(f.no_of_so, 0) > 0 or ${supplyOrderRowExists()})`;
    }
    return milestone ? milestoneAppliesSql(milestone) : `not ${isCancelledFileSql()}`;
  }
  if (metric === "cleared") {
    if (normalized === "financialsanction") return financialSanctionCompletedSql();
    if (normalized === "supplyorder") return supplyOrderPlacedSql();
    return milestone
      ? `${milestoneAppliesSql(milestone)} and ${milestoneCompleteSql(milestone)}`
      : "false";
  }
  if (normalized === "bankguarantee") return bgToBeReceivedSql("psb");
  if (normalized === "payment") return paymentPendingSql();
  if (normalized === "jobcompletion") return jobCompletionFilterSql("live");
  if (normalized === "refloatbidding") {
    return `not ${isCancelledFileSql()} and ${isYesSql("f.refloat")} and not ${isYesSql("f.bidding_stage_over")}`;
  }
  if (normalized === "refloatposttcec") {
    return `not ${isCancelledFileSql()} and ${isYesSql("f.refloat")} and ${isYesSql("f.tcec")} and ${isYesSql("f.bidding_stage_over")} and not ${hasTextSql("f.refloat_post_tcec_minutes_date")}`;
  }
  if (isBgStatusKey(milestoneName)) return bgToBeReceivedSql(milestoneName);
  if (isSupplyOrderDrivenMilestoneName(milestoneName)) {
    return supplyOrderDrivenCurrentMilestoneSql(milestoneName, values);
  }
  if (normalized === "bidding") {
    return `${biddingApplicableSql()} and ${normalizedSql("f.current_milestone")} = 'bidding'`;
  }
  const placeholder = addSqlValue(values, milestoneName);
  return `f.current_milestone = ${placeholder}`;
}

function buildSearchSql(
  baseConditions: string[],
  baseValues: unknown[],
  params: FileSearchParams,
  query: Record<string, unknown>,
  thresholdFinancialYear?: string | undefined,
): SearchSql {
  const conditions = [...baseConditions];
  const values = [...baseValues];
  const selectedModes = params.selectedModes ?? [];
  const selectedGemBiddingModes = params.selectedGemBiddingModes ?? [];
  const selectedFirmTypes = params.selectedFirmTypes ?? [];
  const firmSearchScopes = normalizeFirmSearchScopes(params.firmSearchScopes);
  const selectedFileTypes = params.selectedFileTypes ?? [];
  const selectedBgCoverageTypes = params.selectedBgCoverageTypes ?? [];
  const fileCategories = params.fileCategories;
  const page = readPositiveInteger(query.page, 1, 1_000_000);
  const pageSize = readPositiveInteger(query.pageSize, 100, 500);
  const limit = pageSize;
  const offset = (page - 1) * pageSize;

  if (params.yearFilter?.trim()) {
    const placeholder = addSqlValue(values, sqlLike(params.yearFilter));
    conditions.push(`lower(coalesce(f.year, '')) like ${placeholder}`);
  }
  if (fileCategories) conditions.push(fileCategorySql(fileCategories));
  const dashboardFilter = params.dashboardFilter?.trim();
  if (!shouldShowDemandCancelledFiles(params)) {
    conditions.push(`not ${isYesSql("f.demand_cancelled")}`);
  }
  if (!shouldShowCancelledSupplyOrderFiles(params)) {
    conditions.push(`not ${allSupplyOrdersCancelledSql()}`);
  }
  if (dashboardFilter) {
    if (!isCancellationDashboardFilter(dashboardFilter)) {
      conditions.push(`not ${isCancelledFileSql()}`);
    }
    conditions.push(`(${dashboardFilterSql(dashboardFilter, values, thresholdFinancialYear)})`);
  }
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
    conditions.push(
      supplyOrderExists(
        `lower(coalesce(nullif(trim(so.firm), ''), 'Unassigned firm')) = any(${placeholder}::text[])`,
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
  if (selectedModes.length) {
    const placeholder = addSqlValue(
      values,
      selectedModes.map((mode) => mode.trim().toUpperCase()),
    );
    conditions.push(`upper(trim(coalesce(f.mode, ''))) = any(${placeholder}::text[])`);
  }
  if (selectedGemBiddingModes.length) {
    const placeholder = addSqlValue(
      values,
      selectedGemBiddingModes.map((mode) => mode.trim().toLowerCase()),
    );
    conditions.push(
      `${isYesSql("f.gem")} and lower(trim(coalesce(f.gem_bidding_mode, ''))) = any(${placeholder}::text[])`,
    );
  }
  if (selectedFirmTypes.length) {
    const normalizedFirmTypes = selectedFirmTypes.map((firmType) => firmType.trim().toUpperCase());
    const placeholder = addSqlValue(values, normalizedFirmTypes);
    conditions.push(
      supplyOrderExists(
        `(upper(trim(coalesce(so.firm_type, ''))) = any(${placeholder}::text[])
          or upper(trim(coalesce(so.firm_type_other, ''))) = any(${placeholder}::text[]))`,
      ),
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
  if (params.specialFileMarker?.trim()) {
    const placeholder = addSqlValue(values, params.specialFileMarker.trim().toUpperCase());
    conditions.push(`exists (
      select 1 from file_markers fm
      where fm.file_id = f.id and upper(trim(coalesce(fm.text, ''))) = ${placeholder}
    )`);
  }
  if (params.advancePaymentFilter) {
    conditions.push(supplyOrderExists(isYesSql("so.advance_payment")));
  }
  if (params.actualPaymentFilter) {
    conditions.push(
      supplyOrderExists(
        "(coalesce(so.actual_payment_capital, 0) <> 0 or coalesce(so.actual_payment_revenue, 0) <> 0)",
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
  if (params.psbFilter) {
    conditions.push(
      supplyOrderExists(
        `${isYesSql("so.psb_applicable")} and trim(coalesce(so.bg_coverage_type, '')) in ('PSB', 'PSB and PWB separately')`,
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
  if (params.rstFilter) conditions.push(isYesSql("f.rst"));
  if (params.demandCancelledFilter) conditions.push(isYesSql("f.demand_cancelled"));
  if (params.soCancelledFilter) conditions.push(supplyOrderExists(isYesSql("so.so_cancelled")));
  if (params.shortclosedSoFilter) conditions.push(supplyOrderExists(isYesSql("so.shortclosure")));

  if (params.capitalOnly && params.revenueOnly) {
    conditions.push("(coalesce(f.value_capital, 0) <> 0 or coalesce(f.value_revenue, 0) <> 0)");
  } else if (params.capitalOnly) {
    conditions.push("coalesce(f.value_capital, 0) <> 0");
  } else if (params.revenueOnly) {
    conditions.push("coalesce(f.value_revenue, 0) <> 0");
  }

  const valueFactor = `case
    when upper(trim(coalesce(f.currency, 'INR'))) in ('', 'INR') then 1
    when f.exchange_rate > 0 then f.exchange_rate
    else null
  end`;
  const totalValue = `(coalesce(f.value_capital * ${valueFactor}, 0) + coalesce(f.value_revenue * ${valueFactor}, 0))`;
  const minValue = parseSearchAmount(params.valueFrom);
  const maxValue = parseSearchAmount(params.valueTo);
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

  if (isValidDate(params.dpFrom) || isValidDate(params.dpTo)) {
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
    conditions.push(supplyOrderExists(dpConditions.join(" and ")));
  }

  const dateRangeConditions = [
    fileDateRangeSql("f.received_date", params.demandReceiptFrom, params.demandReceiptTo, values),
    fileDateRangeSql("f.imms_date", params.demandControlFrom, params.demandControlTo, values),
    fileDateRangeSql(
      "f.high_value_minutes_date",
      params.highValueMinutesFrom,
      params.highValueMinutesTo,
      values,
    ),
    fileDateRangeSql(
      "f.pre_tcec_minutes_date",
      params.preTcecMinutesFrom,
      params.preTcecMinutesTo,
      values,
    ),
    fileDateRangeSql("f.rqa_approval_date", params.rqaApprovalFrom, params.rqaApprovalTo, values),
    fileDateRangeSql("f.ifa_final_date", params.ifaFinalFrom, params.ifaFinalTo, values),
    fileDateRangeSql("f.cfa_date", params.cfaApprovalFrom, params.cfaApprovalTo, values),
    fileDateRangeSql(
      "f.post_tcec_minutes_date",
      params.postTcecMinutesFrom,
      params.postTcecMinutesTo,
      values,
    ),
    fileDateRangeSql("f.cnc_date", params.cncDateFrom, params.cncDateTo, values),
    supplyOrderDateRangeSql(
      "financial_sanction_date",
      params.financialSanctionFrom,
      params.financialSanctionTo,
      values,
    ),
    supplyOrderDateRangeSql("so_date", params.soDateFrom, params.soDateTo, values),
    supplyOrderDateRangeSql(
      "material_receipt_date",
      params.materialReceiptFrom,
      params.materialReceiptTo,
      values,
    ),
    supplyOrderDateRangeSql("payment_date", params.paymentDateFrom, params.paymentDateTo, values),
    supplyOrderAnyDateRangeSql(
      ["psb_bg_received_date", "pwb_bg_received_date", "combined_bg_received_date"],
      params.bgReceivedFrom,
      params.bgReceivedTo,
      values,
    ),
    supplyOrderAnyDateRangeSql(
      ["psb_bg_validity_date", "pwb_bg_validity_date", "combined_bg_validity_date"],
      params.bgValidityFrom,
      params.bgValidityTo,
      values,
    ),
    supplyOrderAnyDateRangeSql(
      ["psb_bg_return_date", "pwb_bg_return_date", "combined_bg_return_date"],
      params.bgReturnFrom,
      params.bgReturnTo,
      values,
    ),
    fileDateRangeSql("f.file_closure_date", params.fileClosureFrom, params.fileClosureTo, values),
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
  return selectedYear &&
    selectedYear !== allActiveFilesYear &&
    selectedYear !== activePlusCurrentFyClosedYear
    ? selectedYear
    : normalizeFinancialYearLabel(currentFinancialYear);
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
  await ensureSupplyOrderBillReturnsSchema();
  await client.query("delete from supply_orders where file_id = $1", [fileId]);
  let sortOrder = 0;
  for (const row of rows.filter(hasFilledValue)) {
    const columns = ["file_id", "sort_order"];
    const values: unknown[] = [fileId, sortOrder++];
    const placeholders = ["$1", "$2"];
    for (const [frontendKey, [column, kind]] of Object.entries(supplyOrderFields)) {
      values.push(toDbValue(row[frontendKey], kind));
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
  const existingBiddingContext =
    typeof body.mode === "string" &&
    typeof body.fileType === "string" &&
    typeof body.gem === "string" &&
    typeof body.gemBiddingMode === "string"
      ? null
      : await client.query<{
          mode: string | null;
          fileType: string | null;
          gem: string | null;
          gemBiddingMode: string | null;
        }>(
          `select mode, file_type as "fileType", gem, gem_bidding_mode as "gemBiddingMode" from files where id = $1`,
          [fileId],
        );
  const existingFile = existingBiddingContext?.rows[0];
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
  const supplyOrders = readArray(body.supplyOrders, "supplyOrders");
  const trimmedSupplyOrders = trimRowsToSupplyOrderCount(supplyOrders, body.noOfSo);
  validateSupplyOrderChronology(body, trimmedSupplyOrders);
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
  if (!onlyProvided || trimmedSupplyOrders) {
    await replaceSupplyOrders(client, fileId, trimmedSupplyOrders ?? []);
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

    if (request.query.year === allActiveFilesYear) {
      conditions.push(activeFilesSql());
    } else if (request.query.year === activePlusCurrentFyClosedYear) {
      conditions.push(activePlusCurrentFyClosedSql(values, await loadCurrentFinancialYear()));
    } else if (typeof request.query.year === "string" && request.query.year.trim()) {
      values.push(normalizeFinancialYearLabel(request.query.year));
      conditions.push(
        `(f.year = $${values.length} or exists (
          select 1 from file_year_activity a
          where a.file_id = f.id and a.financial_year = $${values.length} and a.status = 'active'
        ))`,
      );
    }
    if (typeof request.query.division === "string" && request.query.division.trim()) {
      values.push(request.query.division.trim());
      conditions.push(`lower(d.name) = lower($${values.length})`);
    }

    const whereSql = conditions.length ? `where ${conditions.join(" and ")}` : "";
    response.json({ files: await loadFiles(whereSql, values) });
  }),
);

filesRouter.get(
  "/search",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    await ensureSupplyOrderBillReturnsSchema();
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
    if (!isFinanceCarryForwardDashboardFilter(searchParams.dashboardFilter)) {
      if (selectedYear === allActiveFilesYear) {
        conditions.push(activeFilesSql());
      } else if (selectedYear === activePlusCurrentFyClosedYear) {
        conditions.push(activePlusCurrentFyClosedSql(values, currentFinancialYear));
      } else if (selectedYear) {
        values.push(selectedYear);
        conditions.push(
          `(f.year = $${values.length} or exists (
            select 1 from file_year_activity a
            where a.file_id = f.id and a.financial_year = $${values.length} and a.status = 'active'
          ))`,
        );
      }
    }
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
    await ensureSupplyOrderBillReturnsSchema();
    const body = requireObjectBody(request.body);
    const format = body.format === "pdf" ? "pdf" : "excel";
    const layout = readFileSearchExportLayout(body.layout);
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : "FileHistory Search Results";
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
    if (!isFinanceCarryForwardDashboardFilter(searchParams.dashboardFilter)) {
      if (selectedYear === allActiveFilesYear) {
        conditions.push(activeFilesSql());
      } else if (selectedYear === activePlusCurrentFyClosedYear) {
        conditions.push(activePlusCurrentFyClosedSql(values, currentFinancialYear));
      } else if (selectedYear) {
        values.push(selectedYear);
        conditions.push(
          `(f.year = $${values.length} or exists (
            select 1 from file_year_activity a
            where a.file_id = f.id and a.financial_year = $${values.length} and a.status = 'active'
          ))`,
        );
      }
    }
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
    const exportTable = buildFileSearchExportTable(results.files, columns, layout);
    const document = {
      title,
      description: `Files: ${results.total}${results.total > results.files.length ? ` (exported first ${results.files.length})` : ""}; Layout: ${formatFileSearchExportLayout(layout)}`,
      tables: [
        {
          headers: exportTable.headers,
          rows: exportTable.rows,
        },
      ],
    };
    const extension = format === "pdf" ? "pdf" : "xls";
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${getExportFileName(title, extension)}"`,
    );
    if (format === "pdf") {
      response.setHeader("Content-Type", "application/pdf");
      response.send(renderPdfDocument(document));
      return;
    }
    response.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
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
  if (user.role !== "admin" && user.role !== "sub_admin" && user.role !== "editor") return false;
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
    if (controlNo) {
      values.push(`%${controlNo.toLowerCase()}%`);
      conditions.push(`(
        lower(coalesce(f.imms, '')) like $${values.length}
        or lower(coalesce(f.unique_code, '')) like $${values.length}
        or lower(coalesce(f.file_no, '')) like $${values.length}
      )`);
    }
    if (description) {
      values.push(`%${description.toLowerCase()}%`);
      conditions.push(`lower(coalesce(f.demand_description, '')) like $${values.length}`);
    }
    const scope = quickStatusScopeSql(user, values);
    const result = await pool.query<{
      id: string;
      unique_code: string | null;
      imms: string | null;
      demand_description: string | null;
      division: string | null;
      indentor: string | null;
      received_date: Date | string | null;
    }>(
      `select f.id, f.unique_code, f.imms, f.demand_description, d.name as division, f.indentor, f.received_date
       from files f
       left join divisions d on d.id = f.division_id
       where ${conditions.join(" and ")}${scope}
       order by
         case
           when lower(coalesce(f.imms, '')) = lower(${controlNo ? `$1` : "''"}) then 0
           when lower(coalesce(f.unique_code, '')) = lower(${controlNo ? `$1` : "''"}) then 1
           when lower(coalesce(f.file_no, '')) = lower(${controlNo ? `$1` : "''"}) then 2
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
    if (user.role === "universal_viewer") {
      throw new HttpError(403, "Universal Viewer cannot update File Status.");
    }
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
       where unique_code like $1 and archived_at is null`,
      [`${prefix}%`, prefix.length + 1],
    );
    const nextSerial = Number(result.rows[0]?.max_serial ?? 0) + 1;
    response.json({ uniqueCode: `${prefix}${String(nextSerial).padStart(3, "0")}` });
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
    const body = normalizeSupplyOrderCountInBody(requireObjectBody(request.body));
    const client = await pool.connect();
    try {
      await client.query("begin");
      const divisionId = await resolveDivisionId(client, body.division);
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
    const body = normalizeSupplyOrderCountInBody(requireObjectBody(request.body));
    const id = requireParam(request.params.id, "id");
    const client = await pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query<{
        id: string;
        division_id: string | null;
        file_type: string | null;
        mode: string | null;
      }>(
        "select id, division_id, file_type, mode from files where id = $1 and archived_at is null",
        [id],
      );
      if (existing.rowCount === 0) throw new HttpError(404, "File not found.");
      if (!canAccessDivision(user, existing.rows[0].division_id)) {
        throw new HttpError(403, "You cannot edit this division.");
      }
      if (
        !canAccessFileCategory(user, {
          fileType: existing.rows[0].file_type ?? undefined,
          mode: existing.rows[0].mode ?? undefined,
        })
      ) {
        throw new HttpError(403, "You cannot edit this file type.");
      }
      const divisionId =
        "division" in body ? await resolveDivisionId(client, body.division) : undefined;
      if (divisionId !== undefined && !canAccessDivision(user, divisionId)) {
        throw new HttpError(403, "You cannot move files to this division.");
      }
      const nextFileType =
        "fileType" in body && typeof body.fileType === "string"
          ? body.fileType
          : (existing.rows[0].file_type ?? undefined);
      const nextMode =
        "mode" in body && typeof body.mode === "string"
          ? body.mode
          : (existing.rows[0].mode ?? undefined);
      if (!canAccessFileCategory(user, { fileType: nextFileType, mode: nextMode })) {
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

    if (user.role !== "admin") {
      await pool.query(
        `update files
         set archived_at = now(), archived_by = $2, archive_reason = 'Archived by editor'
         where id = $1`,
        [id, user.id],
      );
      clearDashboardReportCaches();
      response.json({ archived: true, file: files[0] });
      return;
    }

    await pool.query("delete from files where id = $1", [id]);
    clearDashboardReportCaches();
    response.json({ deleted: true, file: files[0] });
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
