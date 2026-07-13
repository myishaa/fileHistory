import { Router } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import type {
  FileMarker,
  FileRecord,
  FirmDetail,
  FileRemark,
  SupplyOrderDetail,
} from "../types.js";
import {
  canAccessDivision,
  canAccessFileCategory,
  canMutateFiles,
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
import { type FileSearchParams, searchFiles } from "../utils/file-search.js";
import { normalizeFileCategories, type FileCategoryKey } from "../utils/file-categories.js";
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

export const filesRouter = Router();
const allActiveFilesYear = "__all_active_files__";
const fileClosedMilestone = "File Closed";

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
    currentColumn: "f.ad_vetting_date",
    appliesColumn: "f.ad",
  },
  {
    key: "rqa",
    label: "R&QA",
    totalLabel: "Total cases",
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
    key: "cnc",
    label: "CNC",
    totalLabel: "Total cases",
    reviewedColumn: "f.cnc_date",
    currentColumn: "f.cnc_approval_date",
    appliesColumn: "f.tcec",
  },
  {
    key: "supplyOrder",
    label: "Supply Order",
    completedLabel: "Placed",
    totalLabel: "Total files",
    supplyOrderDate: "so_date",
  },
  {
    key: "bankGuarantee",
    label: "Bank Guarantee",
    completedLabel: "Received",
    totalLabel: "Total files",
    appliesColumn: "f.bg",
    supplyOrderDate: "bg_validity_date",
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
  mode: ["mode", "text"],
  gem: ["gem", "text"],
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
  preTcecDate: ["pre_tcec_date", "date"],
  preTcecMinutesDate: ["pre_tcec_minutes_date", "date"],
  preTcecCommitteeNo: ["pre_tcec_committee_no", "text"],
  adVettingDate: ["ad_vetting_date", "date"],
  rqaApprovalDate: ["rqa_approval_date", "date"],
  ifaSentDate: ["ifa_sent_date", "date"],
  ifaFinalDate: ["ifa_final_date", "date"],
  cfaSentDate: ["cfa_sent_date", "date"],
  cfaDate: ["cfa_date", "date"],
  gemUndertakingDate: ["gem_undertaking_date", "date"],
  rfpVettingInitiationDate: ["rfp_vetting_initiation_date", "date"],
  rfpVettingApprovalDate: ["rfp_vetting_approval_date", "date"],
  tenderLive: ["tender_live", "text"],
  bidNumber: ["bid_number", "text"],
  bidDate: ["bid_date", "date"],
  bidOpeningDate: ["bid_opening_date", "date"],
  bidOpened: ["bid_opened", "text"],
  refloat: ["refloat", "text"],
  postTcecDate: ["post_tcec_date", "date"],
  postTcecMinutesDate: ["post_tcec_minutes_date", "date"],
  postTcecCommitteeNumber: ["post_tcec_committee_number", "text"],
  refloatBiddingDate: ["refloat_bidding_date", "date"],
  refloatBidOpeningDate: ["refloat_bid_opening_date", "date"],
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
  bgValidityDate: ["bg_validity_date", "date"],
  dpExtension: ["dp_extension", "text"],
  dpExtensionCount: ["dp_extension_count", "integer"],
  ld: ["ld", "text"],
  revisedDp: ["revised_dp", "date"],
  materialReceiptDate: ["material_receipt_date", "date"],
  irPreparationDate: ["ir_preparation_date", "date"],
  irReceiptDate: ["ir_receipt_date", "date"],
  billPreparationDate: ["bill_preparation_date", "date"],
  billSentForPaymentDate: ["bill_sent_for_payment_date", "date"],
  paymentDate: ["payment_date", "date"],
  paymentMode: ["payment_mode", "text"],
  bgReturnDate: ["bg_return_date", "date"],
  demandCancelled: ["demand_cancelled", "text"],
  demandCancelledDate: ["demand_cancelled_date", "date"],
  soCancelled: ["so_cancelled", "text"],
  soCancelledDate: ["so_cancelled_date", "date"],
  currentMilestone: ["current_milestone", "text"],
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

type ExportColumn = {
  key: string;
  label: string;
};

const supplyOrderFields = {
  currentMilestone: ["current_milestone", "text"],
  completedMilestones: ["completed_milestones", "jsonArray"],
  soNo: ["so_no", "text"],
  gemSoNo: ["gem_so_no", "text"],
  soDate: ["so_date", "date"],
  soValueCapital: ["so_value_capital", "number"],
  soValueRevenue: ["so_value_revenue", "number"],
  dpDate: ["dp_date", "date"],
  firm: ["firm", "text"],
  firmType: ["firm_type", "text"],
  firmTypeOther: ["firm_type_other", "text"],
  bgValidityDate: ["bg_validity_date", "date"],
  dpExtension: ["dp_extension", "text"],
  dpExtensionCount: ["dp_extension_count", "integer"],
  ld: ["ld", "text"],
  revisedDp: ["revised_dp", "date"],
  materialReceiptDate: ["material_receipt_date", "date"],
  irPreparationDate: ["ir_preparation_date", "date"],
  irReceiptDate: ["ir_receipt_date", "date"],
  billPreparationDate: ["bill_preparation_date", "date"],
  billSentForPaymentDate: ["bill_sent_for_payment_date", "date"],
  paymentDate: ["payment_date", "date"],
  paymentMode: ["payment_mode", "text"],
  actualPaymentCapital: ["actual_payment_capital", "number"],
  actualPaymentRevenue: ["actual_payment_revenue", "number"],
  bgReturnDate: ["bg_return_date", "date"],
  demandCancelled: ["demand_cancelled", "text"],
  soCancelled: ["so_cancelled", "text"],
  soCancelledDate: ["so_cancelled_date", "date"],
  stageDelivery: ["stage_delivery", "text"],
  stageDeliveryCount: ["stage_delivery_count", "integer"],
  stagePayment: ["stage_payment", "text"],
  advancePayment: ["advance_payment", "text"],
  advancePaymentDetail: ["advance_payment_detail", "jsonObject"],
  stageDeliveries: ["stage_deliveries", "jsonArray"],
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
  "billSentForPaymentDate",
  "paymentDate",
  "paymentMode",
  "actualPaymentCapital",
  "actualPaymentRevenue",
]);

type FileRow = Record<string, unknown> & {
  id: string;
  division: string | null;
  created_at: Date | string;
};

type FileChildren = {
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
    division: fromDbText(row.division),
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
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
    firm_type: "invited" | "bidder";
    firm_name: string | null;
    city: string | null;
    email_id: string | null;
  }>(
    `select file_id, firm_type, firm_name, city, email_id
     from file_firms
     where file_id = any($1::uuid[])
     order by sort_order asc, id asc`,
    [fileIds],
  );
  for (const row of firmRows.rows) {
    const firm = {
      firmName: fromDbText(row.firm_name),
      city: fromDbText(row.city),
      emailId: fromDbText(row.email_id),
    };
    const map = row.firm_type === "invited" ? children.invitedFirms : children.bidderFirms;
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
  const countResult = await pool.query<{ total: string }>(
    `select count(*)::text as total
     from files f
     left join divisions d on d.id = f.division_id
     ${combineWhere(searchSql.whereSql, false)}`,
    searchSql.values,
  );

  const resultValues = [...searchSql.values, searchSql.limit, searchSql.offset];
  const limitPlaceholder = `$${searchSql.values.length + 1}`;
  const offsetPlaceholder = `$${searchSql.values.length + 2}`;
  const result = await pool.query<FileRow>(
    `select f.*, d.name as division
     from files f
     left join divisions d on d.id = f.division_id
     ${combineWhere(searchSql.whereSql, false)}
     ${searchSql.orderSql}
     limit ${limitPlaceholder}
     offset ${offsetPlaceholder}`,
    resultValues,
  );
  const children = await loadChildren(result.rows.map((row) => row.id));
  return {
    files: result.rows.map((row) => mapFile(row, children)),
    total: Number(countResult.rows[0]?.total ?? 0),
  };
}

const fileExportDateFields = [
  ["receivedDate", "Received"],
  ["scrutinyDate", "Scrutiny"],
  ["scrutinyResponseDate", "Scrutiny response"],
  ["scrutinyCompletionDate", "Scrutiny completion"],
  ["immsDate", "Controlling"],
  ["highValueMeetingDate", "High Value meeting"],
  ["highValueMinutesDate", "High Value minutes"],
  ["preTcecDate", "Pre-TCEC"],
  ["preTcecMinutesDate", "Pre-TCEC minutes"],
  ["adVettingDate", "AD vetting"],
  ["rqaApprovalDate", "R&QA approval"],
  ["ifaSentDate", "IFA sent"],
  ["ifaFinalDate", "IFA final"],
  ["cfaSentDate", "CFA sent"],
  ["cfaDate", "CFA approval"],
  ["bidDate", "Bid date"],
  ["bidOpeningDate", "Bid closing"],
  ["postTcecDate", "Post-TCEC"],
  ["postTcecMinutesDate", "Post-TCEC minutes"],
  ["cncDate", "CNC"],
  ["cncApprovalDate", "CNC approval"],
] as const;

const supplyOrderExportDateFields = [
  ["soDate", "S.O. date"],
  ["dpDate", "DP date"],
  ["bgValidityDate", "BG validity"],
  ["revisedDp", "Revised DP"],
  ["materialReceiptDate", "Material receipt"],
  ["irPreparationDate", "IR Preparation"],
  ["irReceiptDate", "IR Receipt"],
  ["billPreparationDate", "Bill preparation"],
  ["billSentForPaymentDate", "Bill sent for payment"],
  ["paymentDate", "Payment"],
  ["bgReturnDate", "BG return"],
  ["soCancelledDate", "S.O. cancelled date"],
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
  if (key === "invitedFirms") return String(getFirmCount(file.invitedFirms));
  if (key === "bidderFirms") return String(getFirmCount(file.bidderFirms));
  if (key === "noOfSo") return String(file.supplyOrders?.length || file.noOfSo || "");
  if (key in supplyOrderFields) {
    return (file.supplyOrders ?? [])
      .map((order) => String((order as Record<string, unknown>)[key] ?? "").trim())
      .filter(Boolean)
      .join("; ");
  }
  return String((file as Record<string, unknown>)[key] ?? "");
}

function buildFileSearchExportColumns(files: FileRecord[], columns: ExportColumn[]) {
  const maxSupplyOrders = Math.max(1, ...files.map((file) => getRawSupplyOrders(file).length));
  return columns.flatMap((column) => {
    if (!(column.key in supplyOrderFields)) {
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

function getMainSupplyOrderExportValue(file: FileRecord, key: string, orderIndex: number) {
  const order = getRawSupplyOrders(file)[orderIndex];
  return order ? String((order as Record<string, unknown>)[key] ?? "") : "";
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

function getRawSupplyOrders(file: FileRecord) {
  const rows = file.supplyOrders ?? [];
  if (rows.length) return rows;
  const legacy: SupplyOrderDetail = {
    soNo: file.soNo,
    gemSoNo: file.gemSoNo,
    soDate: file.soDate,
    soValueCapital: file.soValueCapital,
    soValueRevenue: file.soValueRevenue,
    dpDate: file.dpDate,
    firm: file.firm,
    firmType: file.firmType,
    firmTypeOther: file.firmTypeOther,
    bgValidityDate: file.bgValidityDate,
    dpExtension: file.dpExtension,
    dpExtensionCount: file.dpExtensionCount,
    ld: file.ld,
    revisedDp: file.revisedDp,
    materialReceiptDate: file.materialReceiptDate,
    irPreparationDate: file.irPreparationDate,
    irReceiptDate: file.irReceiptDate,
    billPreparationDate: file.billPreparationDate,
    billSentForPaymentDate: file.billSentForPaymentDate,
    paymentDate: file.paymentDate,
    paymentMode: file.paymentMode,
    actualPaymentCapital: file.actualPaymentCapital,
    actualPaymentRevenue: file.actualPaymentRevenue,
    bgReturnDate: file.bgReturnDate,
    demandCancelled: file.demandCancelled,
    soCancelled: file.soCancelled,
    soCancelledDate: file.soCancelledDate,
  };
  return Object.values(legacy).some((value) => String(value ?? "").trim()) ? [legacy] : [];
}

function getFirmCount(rows: FirmDetail[] | undefined) {
  return (rows ?? []).filter((row) =>
    [row.firmName, row.city, row.emailId].some((value) => String(value ?? "").trim()),
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
    selectedModes: readQueryList(query.selectedModes),
    selectedFirmTypes: readQueryList(query.selectedFirmTypes),
    selectedFileTypes: readQueryList(query.selectedFileTypes),
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
    bgFilter: readQueryBoolean(query.bgFilter),
    rfpVettingFilter: readQueryBoolean(query.rfpVettingFilter),
    refloat: readQueryBoolean(query.refloat),
    cnc: readQueryBoolean(query.cnc),
    tcec: readQueryBoolean(query.tcec),
    dpFrom: readQueryString(query.dpFrom),
    dpTo: readQueryString(query.dpTo),
    rstFilter: readQueryBoolean(query.rstFilter),
    demandCancelledFilter: readQueryBoolean(query.demandCancelledFilter),
    soCancelledFilter: readQueryBoolean(query.soCancelledFilter),
    freeText: readQueryString(query.freeText),
    freeDate: readQueryString(query.freeDate),
    dashboardFilter: readQueryString(query.dashboardFilter),
    analyticsType: readAnalyticsType(query.analyticsType),
    analyticsNames: readAnalyticsNameList(query.analyticsNames),
    sortColumnKey: readQueryString(query.sortColumnKey),
    sortDirection: readQueryString(query.sortDirection) === "desc" ? "desc" : "asc",
    divisionWiseSort: readQueryBoolean(query.divisionWiseSort),
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
    predicates.push(`lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'o&m')`);
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
    predicates.push(`lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'o&m')`);
  }

  const exactFileTypes = normalizedFileTypes.filter((fileType) => fileType !== "goods & services");
  if (exactFileTypes.length) {
    const placeholder = addSqlValue(values, Array.from(new Set(exactFileTypes)));
    predicates.push(`lower(trim(coalesce(f.file_type, ''))) = any(${placeholder}::text[])`);
  }

  return predicates.length ? `(${predicates.join(" or ")})` : undefined;
}

function bidOpeningOverdueSql(today = "current_date") {
  return `${isNoSql("f.bid_opened")} and (case when ${isYesSql(
    "f.refloat",
  )} and f.refloat_bid_opening_date is not null then f.refloat_bid_opening_date else f.bid_opening_date end) < ${today}`;
}

function normalizedSql(expression: string) {
  return `regexp_replace(lower(coalesce(${expression}, '')), '[^a-z0-9]+', '', 'g')`;
}

function fileClosedSql() {
  return completedMilestoneExists(`${normalizedSql("completed.milestone")} = 'fileclosed'`);
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

function supplyOrderRowExists() {
  return "exists (select 1 from supply_orders so_existing where so_existing.file_id = f.id)";
}

function supplyOrderChildOrLegacySql(childCondition: string, legacyCondition: string) {
  return `(${supplyOrderExists(childCondition)} or (not ${supplyOrderRowExists()} and ${legacyCondition}))`;
}

function effectiveDpDateSql(alias: string) {
  return `greatest(coalesce(${alias}.revised_dp, ${alias}.dp_date), coalesce(${alias}.dp_date, ${alias}.revised_dp))`;
}

function supplyOrderValueTotalSql(capitalOnly: boolean, revenueOnly: boolean) {
  const includeCapital = !revenueOnly || capitalOnly;
  const includeRevenue = !capitalOnly || revenueOnly;
  const valueParts = [
    includeCapital ? "coalesce(so.so_value_capital, 0)" : undefined,
    includeRevenue ? "coalesce(so.so_value_revenue, 0)" : undefined,
  ].filter(Boolean);
  const legacyValueParts = [
    includeCapital ? "coalesce(f.so_value_capital, 0)" : undefined,
    includeRevenue ? "coalesce(f.so_value_revenue, 0)" : undefined,
  ].filter(Boolean);
  const orderValueSql = valueParts.join(" + ") || "0";
  const legacyValueSql = legacyValueParts.join(" + ") || "0";
  return `case
    when exists (select 1 from supply_orders so where so.file_id = f.id) then coalesce((
      select sum(${orderValueSql})
      from supply_orders so
      where so.file_id = f.id
    ), 0)
    else ${legacyValueSql}
  end`;
}

function hasSupplyOrderValueSql(capitalOnly: boolean, revenueOnly: boolean) {
  const includeCapital = !revenueOnly || capitalOnly;
  const includeRevenue = !capitalOnly || revenueOnly;
  const orderConditions = [
    includeCapital ? "so.so_value_capital is not null" : undefined,
    includeRevenue ? "so.so_value_revenue is not null" : undefined,
  ].filter(Boolean);
  const legacyConditions = [
    includeCapital ? "f.so_value_capital is not null" : undefined,
    includeRevenue ? "f.so_value_revenue is not null" : undefined,
  ].filter(Boolean);
  return `case
    when exists (select 1 from supply_orders so where so.file_id = f.id) then ${supplyOrderExists(
      orderConditions.join(" or ") || "false",
    )}
    else ${legacyConditions.join(" or ") || "false"}
  end`;
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

function freeSearchTextExpression() {
  const fileTextColumns = Object.values(fileSearchColumns)
    .map((column) => `coalesce(${column}::text, '')`)
    .join(", ");

  return `concat_ws(' ', ${fileTextColumns},
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
        so.bg_validity_date,
        so.dp_extension,
        so.dp_extension_count,
        so.ld,
        so.revised_dp,
        so.material_receipt_date,
        so.bill_sent_for_payment_date,
        so.payment_date,
        so.payment_mode,
        so.bg_return_date,
        so.demand_cancelled,
        so.so_cancelled,
        so.so_cancelled_date
      ), ' ' order by so.sort_order, so.id)
      from supply_orders so
      where so.file_id = f.id
    ), ''),
    coalesce((
      select string_agg(concat_ws(' ', ff.firm_name, ff.city, ff.email_id), ' ' order by ff.sort_order, ff.id)
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
    ), '')
  )`;
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
  preTcecDate: "f.pre_tcec_date",
  preTcecMinutesDate: "f.pre_tcec_minutes_date",
  preTcecCommitteeNo: "f.pre_tcec_committee_no",
  adVettingDate: "f.ad_vetting_date",
  rqaApprovalDate: "f.rqa_approval_date",
  ifaSentDate: "f.ifa_sent_date",
  ifaFinalDate: "f.ifa_final_date",
  cfaSentDate: "f.cfa_sent_date",
  cfaDate: "f.cfa_date",
  gemUndertakingDate: "f.gem_undertaking_date",
  rfpVettingInitiationDate: "f.rfp_vetting_initiation_date",
  rfpVettingApprovalDate: "f.rfp_vetting_approval_date",
  tenderLive: "f.tender_live",
  bidNumber: "f.bid_number",
  bidDate: "f.bid_date",
  bidOpeningDate: "f.bid_opening_date",
  bidOpened: "f.bid_opened",
  refloat: "f.refloat",
  postTcecDate: "f.post_tcec_date",
  postTcecMinutesDate: "f.post_tcec_minutes_date",
  postTcecCommitteeNumber: "f.post_tcec_committee_number",
  refloatBiddingDate: "f.refloat_bidding_date",
  refloatBidOpeningDate: "f.refloat_bid_opening_date",
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
  bgValidityDate: "f.bg_validity_date",
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
  bgReturnDate: "f.bg_return_date",
  demandCancelled: "f.demand_cancelled",
  demandCancelledDate: "f.demand_cancelled_date",
  soCancelled: "f.so_cancelled",
  soCancelledDate: "f.so_cancelled_date",
  currentMilestone: "f.current_milestone",
} as const;

const supplyOrderSearchColumns = {
  soNo: "so_no",
  gemSoNo: "gem_so_no",
  soDate: "so_date",
  soValueCapital: "so_value_capital",
  soValueRevenue: "so_value_revenue",
  dpDate: "dp_date",
  firm: "firm",
  bgValidityDate: "bg_validity_date",
  dpExtension: "dp_extension",
  dpExtensionCount: "dp_extension_count",
  ld: "ld",
  revisedDp: "revised_dp",
  materialReceiptDate: "material_receipt_date",
  irPreparationDate: "ir_preparation_date",
  irReceiptDate: "ir_receipt_date",
  billPreparationDate: "bill_preparation_date",
  billSentForPaymentDate: "bill_sent_for_payment_date",
  paymentDate: "payment_date",
  paymentMode: "payment_mode",
  bgReturnDate: "bg_return_date",
  demandCancelled: "demand_cancelled",
  soCancelled: "so_cancelled",
  soCancelledDate: "so_cancelled_date",
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
  "f.pre_tcec_date",
  "f.pre_tcec_minutes_date",
  "f.ad_vetting_date",
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
  "f.cnc_date",
  "f.cnc_approval_date",
  "f.so_date",
  "f.dp_date",
  "f.bg_validity_date",
  "f.revised_dp",
  "f.material_receipt_date",
  "f.ir_preparation_date",
  "f.ir_receipt_date",
  "f.bill_preparation_date",
  "f.bill_sent_for_payment_date",
  "f.payment_date",
  "f.bg_return_date",
  "f.demand_cancelled_date",
  "f.so_cancelled_date",
];

function fileHasAny(keys: Array<keyof typeof fileSearchColumns>) {
  return `(${keys.map((key) => hasTextSql(fileSearchColumns[key])).join(" or ")})`;
}

function anySupplyOrderDate(field: keyof typeof supplyOrderSearchColumns) {
  return supplyOrderExists(hasTextSql(`so.${supplyOrderSearchColumns[field]}`));
}

function legacyOrSupplyDate(field: keyof typeof supplyOrderSearchColumns) {
  return `(${hasTextSql(fileSearchColumns[field as keyof typeof fileSearchColumns])} or ${anySupplyOrderDate(field)})`;
}

function isCancelledFileSql() {
  return `(${isYesSql("f.demand_cancelled")}
    or (not ${supplyOrderRowExists()} and ${isYesSql("f.so_cancelled")})
    or (${supplyOrderRowExists()} and not exists (
      select 1 from supply_orders so_active
      where so_active.file_id = f.id
        and not ${isYesSql("so_active.so_cancelled")}
    )))`;
}

function deliveryInspectionApplicableSql() {
  return `lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'o&m')`;
}

function supplyOrderPlacedSql() {
  return legacyOrSupplyDate("soDate");
}

function deliveryDueOrderSql(extra = "true") {
  return supplyOrderExists(
    `${hasTextSql("so.so_date")} and not ${hasTextSql("so.material_receipt_date")} and not ${isYesSql(
      "so.so_cancelled",
    )} and ${extra}`,
  );
}

function liveSupplyOrderSql() {
  return supplyOrderChildOrLegacySql(
    `${hasTextSql("so.so_date")}
     and not ${hasTextSql("so.payment_date")}
     and not ${isYesSql("so.so_cancelled")}`,
    `${hasTextSql("f.so_date")}
     and not ${hasTextSql("f.payment_date")}
     and not (${isYesSql("f.demand_cancelled")} or ${isYesSql("f.so_cancelled")})`,
  );
}

function paymentPendingSql() {
  return supplyOrderChildOrLegacySql(
    `${hasTextSql("so.so_date")}
     and (${hasTextSql("so.material_receipt_date")}
       or ${hasTextSql("so.bill_preparation_date")}
       or ${hasTextSql("so.bill_sent_for_payment_date")})
     and not ${hasTextSql("so.payment_date")}
     and not ${isYesSql("so.so_cancelled")}`,
    `${hasTextSql("f.so_date")}
     and (${hasTextSql("f.material_receipt_date")}
       or ${hasTextSql("f.bill_preparation_date")}
       or ${hasTextSql("f.bill_sent_for_payment_date")})
     and not ${hasTextSql("f.payment_date")}
     and not (${isYesSql("f.demand_cancelled")} or ${isYesSql("f.so_cancelled")})`,
  );
}

function paymentCompletedSql() {
  return supplyOrderChildOrLegacySql(
    `${hasTextSql("so.so_date")}
     and ${hasTextSql("so.payment_date")}
     and not ${isYesSql("so.so_cancelled")}`,
    `${hasTextSql("f.so_date")}
     and ${hasTextSql("f.payment_date")}
     and not (${isYesSql("f.demand_cancelled")} or ${isYesSql("f.so_cancelled")})`,
  );
}

function deliveryPendingOrderSql() {
  return deliveryDueOrderSql(
    `(${effectiveDpDateSql("so")} is null or ${effectiveDpDateSql("so")} >= current_date)`,
  );
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
    "bankguarantee",
    "delivery",
    "irpreparation",
    "irreceipt",
    "billpreparation",
    "billsentforpayment",
    "payment",
  ].includes(normalizeMilestoneName(value));
}

function completedOrderMilestoneSql(orderAlias: string, normalizedMilestone: string) {
  return `exists (
    select 1
    from jsonb_array_elements_text(coalesce(${orderAlias}.completed_milestones, '[]'::jsonb)) as completed_order(milestone)
    where ${normalizedSql("completed_order.milestone")} = '${normalizedMilestone}'
  )`;
}

function inferredOrderCurrentMilestoneSql(orderAlias: string) {
  void orderAlias;
  return "''";
}

function supplyOrderDrivenCurrentMilestoneConditionSql(normalizedMilestoneSql: string) {
  return `not ${isCancelledFileSql()} and (
    (not ${supplyOrderRowExists()} and ${normalizedSql("f.current_milestone")} = ${normalizedMilestoneSql})
    or exists (
      select 1
      from supply_orders so_current
      where so_current.file_id = f.id
        and not ${isYesSql("so_current.so_cancelled")}
        and (
          ${normalizedSql("so_current.current_milestone")} = ${normalizedMilestoneSql}
          or (
            not ${hasTextSql("so_current.current_milestone")}
            and ${inferredOrderCurrentMilestoneSql("so_current")} = ${normalizedMilestoneSql}
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
        and ${completedOrderMilestoneSql("so_completed", normalizedMilestone)}
    )
  )`;
}

function statusAppliesSql(milestone: (typeof statusSummaryMilestones)[number]) {
  return "appliesColumn" in milestone && milestone.appliesColumn
    ? isYesSql(milestone.appliesColumn)
    : "true";
}

function statusCompleteSql(milestone: (typeof statusSummaryMilestones)[number]) {
  if ("yesComplete" in milestone && milestone.yesComplete) {
    return isYesSql(milestone.currentColumn);
  }
  if ("supplyOrderDate" in milestone && milestone.supplyOrderDate) {
    return supplyOrderChildOrLegacySql(
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
  return milestone.key === "bankGuarantee"
    ? bankGuaranteeEligibleSql()
    : statusAppliesSql(milestone);
}

function milestoneCompleteSql(milestone: (typeof statusSummaryMilestones)[number]) {
  if ("supplyOrderDate" in milestone && milestone.supplyOrderDate) {
    return supplyOrderChildOrLegacySql(
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
  const previousComplete =
    milestone.key === "bankGuarantee" ? supplyOrderPlacedSql() : previousStatusCompleteSql(index);
  return `not ${isCancelledFileSql()} and ${milestoneAppliesSql(milestone)} and ${previousComplete}`;
}

function milestonePendingSql(milestone: (typeof statusSummaryMilestones)[number]) {
  const complete = milestoneCompleteSql(milestone);
  const active = statusActiveSql(milestone);
  if ("reviewedColumn" in milestone && milestone.reviewedColumn) {
    return `${active} and not ${hasTextSql(milestone.reviewedColumn)} and not (${complete})`;
  }
  return `${active} and not (${complete})`;
}

function legacyMilestoneFilterSql(filter: string) {
  const readKey = (prefix: string) => filter.slice(prefix.length);
  const resolve = (prefix: string) => milestoneByKey(readKey(prefix));

  if (filter.startsWith("milestoneTotal:")) {
    const milestone = resolve("milestoneTotal:");
    return milestone ? milestoneAppliesSql(milestone) : "true";
  }
  if (filter.startsWith("milestoneUnderProcess:")) {
    const milestone = resolve("milestoneUnderProcess:");
    return milestone
      ? `${milestoneAppliesSql(milestone)} and not (${milestoneEligibleSql(milestone)})`
      : "true";
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
    return milestone ? milestonePendingSql(milestone) : "true";
  }
  if (filter.startsWith("milestone:")) {
    const milestone = resolve("milestone:");
    return milestone ? milestonePendingSql(milestone) : "true";
  }
  if (filter.startsWith("milestoneCleared:")) {
    const milestone = resolve("milestoneCleared:");
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
  return supplyOrderChildOrLegacySql(hasTextSql("so.so_date"), hasTextSql("f.so_date"));
}

function statusDeliveryDueOrderSql(extraCondition = "true") {
  return supplyOrderChildOrLegacySql(
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
  return statusDeliveryDueOrderSql(
    `(${effectiveDpDateSql("so")} is null or ${effectiveDpDateSql("so")} >= current_date)`,
  );
}

function bankGuaranteeEligibleSql() {
  return `not ${isCancelledFileSql()}
    and ${isYesSql("f.bg")}
    and ${supplyOrderChildOrLegacySql(
      `${hasTextSql("so.so_date")} and not ${isYesSql("so.so_cancelled")}`,
      `${hasTextSql("f.so_date")} and not ${isYesSql("f.so_cancelled")}`,
    )}`;
}

function milestoneDateExpression(milestone: (typeof statusSummaryMilestones)[number]) {
  if ("supplyOrderDate" in milestone && milestone.supplyOrderDate) {
    return `coalesce((
      select min(so.${milestone.supplyOrderDate})
      from supply_orders so
      where so.file_id = f.id and so.${milestone.supplyOrderDate} is not null
    ), f.${milestone.supplyOrderDate})`;
  }
  if ("currentColumn" in milestone && milestone.currentColumn) return milestone.currentColumn;
  return "null::date";
}

function milestoneStageStartSql(
  milestone: (typeof statusSummaryMilestones)[number],
  milestoneIndex: number,
) {
  const reviewed =
    "reviewedColumn" in milestone && milestone.reviewedColumn
      ? `when ${hasTextSql(milestone.reviewedColumn)} then ${milestone.reviewedColumn}`
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
    else coalesce(f.received_date, f.file_date)
  end)`;
}

function delayStatusFilterSql(filter: string, values: unknown[]) {
  const [, rawDays, rawMilestoneKey] = filter.split(":");
  const thresholdDays = Number.parseInt(rawDays ?? "0", 10);
  const milestoneKey = rawMilestoneKey || "all";
  if (!Number.isFinite(thresholdDays) || thresholdDays < 0) return "false";
  const thresholdPlaceholder = addSqlValue(values, thresholdDays);
  const clauses = statusSummaryMilestones
    .map((milestone, index) => ({ milestone, index }))
    .filter(({ milestone }) => milestoneKey === "all" || milestone.key === milestoneKey)
    .map(({ milestone, index }) => {
      const startDate = milestoneStageStartSql(milestone, index);
      return `(${statusActiveSql(milestone)}
        and not (${milestoneCompleteSql(milestone)})
        and ${startDate} is not null
        and (current_date - ${startDate}::date) > ${thresholdPlaceholder}::integer)`;
    });
  return clauses.length ? `(${clauses.join(" or ")})` : "false";
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

  if (milestoneName === "Delivery Period") {
    const soEffectiveDp = effectiveDpDateSql("so");
    const fileEffectiveDp = effectiveDpDateSql("f");
    if (stage === "Valid") {
      return `${base} and ${statusSupplyOrderPlacedSql()} and ${supplyOrderChildOrLegacySql(
        `${hasTextSql("so.so_date")} and ${soEffectiveDp} is not null and ${soEffectiveDp} > current_date and not ${hasTextSql("so.material_receipt_date")}`,
        `${hasTextSql("f.so_date")} and ${fileEffectiveDp} is not null and ${fileEffectiveDp} > current_date and not ${hasTextSql("f.material_receipt_date")}`,
      )}`;
    }
    if (stage === "Expired") {
      return `${base} and not ${isCancelledFileSql()} and ${statusSupplyOrderPlacedSql()} and ${supplyOrderChildOrLegacySql(
        `${hasTextSql("so.so_date")} and ${soEffectiveDp} is not null and ${soEffectiveDp} < current_date and not ${hasTextSql("so.material_receipt_date")}`,
        `${hasTextSql("f.so_date")} and ${fileEffectiveDp} is not null and ${fileEffectiveDp} < current_date and not ${hasTextSql("f.material_receipt_date")}`,
      )}`;
    }
    if (stage === "Extended") {
      return `${base} and ${statusSupplyOrderPlacedSql()} and ${supplyOrderChildOrLegacySql(
        `${hasTextSql("so.so_date")} and ${hasTextSql("so.revised_dp")} and ${soEffectiveDp} > current_date and not ${hasTextSql("so.material_receipt_date")}`,
        `${hasTextSql("f.so_date")} and ${hasTextSql("f.revised_dp")} and ${fileEffectiveDp} > current_date and not ${hasTextSql("f.material_receipt_date")}`,
      )}`;
    }
    return "false";
  }

  if (milestoneName === "Delivery") {
    if (stage === "Completed") {
      return `${base} and ${deliveryInspectionApplicableSql()} and ${supplyOrderDrivenCompletedMilestoneConditionSql("delivery")}`;
    }
    if (stage === "Pending") {
      return `${base} and ${deliveryInspectionApplicableSql()} and ${supplyOrderDrivenCurrentMilestoneConditionSql(
        "'delivery'",
      )} and ${statusSupplyOrderPlacedSql()} and ${statusDeliveryPendingOrderSql()}`;
    }
    if (stage === "Overdue") {
      return `${base} and ${deliveryInspectionApplicableSql()} and ${supplyOrderDrivenCurrentMilestoneConditionSql(
        "'delivery'",
      )} and ${statusSupplyOrderPlacedSql()} and ${statusDeliveryDueOrderSql(
        `${effectiveDpDateSql("so")} < current_date`,
      )}`;
    }
    return "false";
  }

  const milestoneIndex = statusSummaryMilestones.findIndex((item) => item.label === milestoneName);
  const milestone = statusSummaryMilestones[milestoneIndex];
  if (!milestone) return "false";

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

  if (stage === "Pending" && milestone.key === "bankGuarantee") {
    return `${base} and ${bankGuaranteeEligibleSql()} and ${supplyOrderDrivenCurrentMilestoneConditionSql(
      "'bankguarantee'",
    )} and not (${complete})`;
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
  if (stage === "Received" && milestone.key === "bankGuarantee") {
    return `${base} and ${bankGuaranteeEligibleSql()} and ${supplyOrderDrivenCompletedMilestoneConditionSql(
      "bankguarantee",
    )}`;
  }
  if (stage === "To be returned" && milestone.key === "bankGuarantee") {
    return `${base} and ${isYesSql("f.bg")} and ${supplyOrderChildOrLegacySql(
      `${hasTextSql("so.so_date")} and ${hasTextSql(
        "so.bg_validity_date",
      )} and so.bg_validity_date < current_date and not ${hasTextSql("so.bg_return_date")}`,
      `${hasTextSql("f.so_date")} and ${hasTextSql(
        "f.bg_validity_date",
      )} and f.bg_validity_date < current_date and not ${hasTextSql("f.bg_return_date")}`,
    )}`;
  }
  if (stage === "At previous stage" || stage === "At previous stages") {
    return `${base} and ${applies} and not (${reached})`;
  }
  return "false";
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
    "expectedReceipt",
    "expectedReceiptPendingBill",
    "billPreparation",
    "billSent",
    "actual",
  ];
  if (
    !validModes.includes(mode) ||
    !/^\d{4}-\d{2}$/.test(monthKey) ||
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
      | "expectedReceipt"
      | "expectedReceiptPendingBill"
      | "billPreparation"
      | "billSent"
      | "actual",
    monthKey,
    offsetDays,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    asOfDate: asOfDate || undefined,
  };
}

function monthMatchesSql(dateExpression: string, monthPlaceholder: string) {
  return `to_char(${dateExpression}, 'YYYY-MM') = ${monthPlaceholder}`;
}

function cashOutgoFilterSql(filter: string, values: unknown[]) {
  const parsed = readCashOutgoFilter(filter);
  if (!parsed) return "false";

  const monthPlaceholder = addSqlValue(values, parsed.monthKey);
  const usesOffset = ["expectedDp", "expectedReceipt", "expectedReceiptPendingBill"].includes(
    parsed.mode,
  );
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

  if (parsed.mode === "expectedDp") {
    const childDate = `(coalesce(so.revised_dp, so.dp_date) + ${offsetInterval})::date`;
    const legacyDate = `(coalesce(f.revised_dp, f.dp_date) + ${offsetInterval})::date`;
    const nonDeliveryFileType = `lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'o&m')`;
    return `${activeFile} and ${supplyOrderChildOrLegacySql(
      `coalesce(so.revised_dp, so.dp_date) is not null
       and not ${isYesSql("so.so_cancelled")}
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
       and ${monthMatchesSql(childDate, monthPlaceholder)}${rangeSql(childDate)}`,
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
       and ${monthMatchesSql(legacyDate, monthPlaceholder)}${rangeSql(legacyDate)}`,
    )}`;
  }

  if (parsed.mode === "expectedReceipt") {
    const childDate = `(so.material_receipt_date + ${offsetInterval})::date`;
    const legacyDate = `(f.material_receipt_date + ${offsetInterval})::date`;
    return `${activeFile} and ${supplyOrderChildOrLegacySql(
      `${hasTextSql("so.material_receipt_date")}
       and ${asOfOnOrBeforeSql("so.material_receipt_date") ?? "true"}
       and ${asOfMissingOrAfterSql("so.payment_date") ?? `not ${hasTextSql("so.payment_date")}`}
       and ${monthMatchesSql(childDate, monthPlaceholder)}${rangeSql(childDate)}`,
      `${hasTextSql("f.material_receipt_date")}
       and ${asOfOnOrBeforeSql("f.material_receipt_date") ?? "true"}
       and ${asOfMissingOrAfterSql("f.payment_date") ?? `not ${hasTextSql("f.payment_date")}`}
       and ${monthMatchesSql(legacyDate, monthPlaceholder)}${rangeSql(legacyDate)}`,
    )}`;
  }

  if (parsed.mode === "expectedReceiptPendingBill") {
    const childBaseDate = `case
      when lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'o&m')
      then coalesce(so.revised_dp, so.dp_date)
      else so.material_receipt_date
    end`;
    const legacyBaseDate = `case
      when lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'o&m')
      then coalesce(f.revised_dp, f.dp_date)
      else f.material_receipt_date
    end`;
    const childDate = `(${childBaseDate} + ${offsetInterval})::date`;
    const legacyDate = `(${legacyBaseDate} + ${offsetInterval})::date`;
    return `${activeFile} and ${supplyOrderChildOrLegacySql(
      `${childBaseDate} is not null
       and not ${isYesSql("so.so_cancelled")}
       and ${toDateOnOrBeforeSql(childBaseDate) ?? "true"}
       and ${toDateMissingOrAfterSql("so.bill_preparation_date") ?? `not ${hasTextSql("so.bill_preparation_date")}`}
       and ${toDateMissingOrAfterSql("so.payment_date") ?? `not ${hasTextSql("so.payment_date")}`}
       and ${monthMatchesSql(childDate, monthPlaceholder)}${rangeSql(childDate)}`,
      `${legacyBaseDate} is not null
       and not ${isYesSql("f.so_cancelled")}
       and ${toDateOnOrBeforeSql(legacyBaseDate) ?? "true"}
       and ${toDateMissingOrAfterSql("f.bill_preparation_date") ?? `not ${hasTextSql("f.bill_preparation_date")}`}
       and ${toDateMissingOrAfterSql("f.payment_date") ?? `not ${hasTextSql("f.payment_date")}`}
       and ${monthMatchesSql(legacyDate, monthPlaceholder)}${rangeSql(legacyDate)}`,
    )}`;
  }

  if (parsed.mode === "billPreparation") {
    const childBaseDate = `case
      when lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'o&m')
      then coalesce(so.revised_dp, so.dp_date)
      else so.material_receipt_date
    end`;
    const legacyBaseDate = `case
      when lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'o&m')
      then coalesce(f.revised_dp, f.dp_date)
      else f.material_receipt_date
    end`;
    return `${activeFile} and ${supplyOrderChildOrLegacySql(
      `(${isYesSql("so.advance_payment")} or ${childBaseDate} is not null)
       and not ${isYesSql("so.so_cancelled")}
       and ${hasTextSql("so.bill_preparation_date")}
       and (${isYesSql("so.advance_payment")} or ${toDateOnOrBeforeSql(childBaseDate) ?? "true"})
       and ${toDateOnOrBeforeSql("so.bill_preparation_date") ?? "true"}
       and ${toDateMissingOrAfterSql("so.bill_sent_for_payment_date") ?? `not ${hasTextSql("so.bill_sent_for_payment_date")}`}
       and ${toDateMissingOrAfterSql("so.payment_date") ?? `not ${hasTextSql("so.payment_date")}`}
       and ${monthMatchesSql("so.bill_preparation_date", monthPlaceholder)}${rangeSql("so.bill_preparation_date")}`,
      `${legacyBaseDate} is not null
       and not ${isYesSql("f.so_cancelled")}
       and ${hasTextSql("f.bill_preparation_date")}
       and ${toDateOnOrBeforeSql(legacyBaseDate) ?? "true"}
       and ${toDateOnOrBeforeSql("f.bill_preparation_date") ?? "true"}
       and ${toDateMissingOrAfterSql("f.bill_sent_for_payment_date") ?? `not ${hasTextSql("f.bill_sent_for_payment_date")}`}
       and ${toDateMissingOrAfterSql("f.payment_date") ?? `not ${hasTextSql("f.payment_date")}`}
       and ${monthMatchesSql("f.bill_preparation_date", monthPlaceholder)}${rangeSql("f.bill_preparation_date")}`,
    )}`;
  }

  if (parsed.mode === "billSent") {
    const childBaseDate = `case
      when lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'o&m')
      then coalesce(so.revised_dp, so.dp_date)
      else so.material_receipt_date
    end`;
    const legacyBaseDate = `case
      when lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'o&m')
      then coalesce(f.revised_dp, f.dp_date)
      else f.material_receipt_date
    end`;
    return `${activeFile} and ${supplyOrderChildOrLegacySql(
      `(${isYesSql("so.advance_payment")} or ${childBaseDate} is not null)
       and not ${isYesSql("so.so_cancelled")}
       and ${hasTextSql("so.bill_preparation_date")}
       and ${hasTextSql("so.bill_sent_for_payment_date")}
       and (${isYesSql("so.advance_payment")} or ${toDateOnOrBeforeSql(childBaseDate) ?? "true"})
       and ${toDateOnOrBeforeSql("so.bill_preparation_date") ?? "true"}
       and ${toDateOnOrBeforeSql("so.bill_sent_for_payment_date") ?? "true"}
       and ${toDateMissingOrAfterSql("so.payment_date") ?? `not ${hasTextSql("so.payment_date")}`}
       and ${monthMatchesSql("so.bill_sent_for_payment_date", monthPlaceholder)}${rangeSql("so.bill_sent_for_payment_date")}`,
      `${legacyBaseDate} is not null
       and not ${isYesSql("f.so_cancelled")}
       and ${hasTextSql("f.bill_preparation_date")}
       and ${hasTextSql("f.bill_sent_for_payment_date")}
       and ${toDateOnOrBeforeSql(legacyBaseDate) ?? "true"}
       and ${toDateOnOrBeforeSql("f.bill_preparation_date") ?? "true"}
       and ${toDateOnOrBeforeSql("f.bill_sent_for_payment_date") ?? "true"}
       and ${toDateMissingOrAfterSql("f.payment_date") ?? `not ${hasTextSql("f.payment_date")}`}
       and ${monthMatchesSql("f.bill_sent_for_payment_date", monthPlaceholder)}${rangeSql("f.bill_sent_for_payment_date")}`,
    )}`;
  }

  return `${activeFile} and ${supplyOrderChildOrLegacySql(
    `${hasTextSql("so.payment_date")}
     and not (${isYesSql("so.so_cancelled")} and ${hasTextSql("so.so_cancelled_date")})
     and ${monthMatchesSql("so.payment_date", monthPlaceholder)}${rangeSql("so.payment_date")}`,
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
  const toDatePlaceholder = addSqlValue(values, toDate || asOfDate || getMonthEndDateFromMonthKey(monthKey));
  const rangeSql = (dateExpression: string) =>
    ` and ${dateExpression} <= ${toDatePlaceholder}::date${
      fromDatePlaceholder ? ` and ${dateExpression} >= ${fromDatePlaceholder}::date` : ""
    }`;

  return `not ${isCancelledFileSql()} and ${supplyOrderChildOrLegacySql(
    `${hasTextSql("so.payment_date")}
     and so.payment_date <= ${monthEndPlaceholder}::date
     and not (${isYesSql("so.so_cancelled")} and ${hasTextSql("so.so_cancelled_date")})
     ${rangeSql("so.payment_date")}`,
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

function isCancellationDashboardFilter(filter: string) {
  return filter === "miscDemandCancelled" || filter === "miscSoCancelled";
}

function shouldShowDemandCancelledFiles(params: FileSearchParams) {
  return params.demandCancelledFilter || params.dashboardFilter?.trim() === "miscDemandCancelled";
}

function dashboardFilterSql(filter: string, values: unknown[]) {
  const today = "current_date";
  if (filter.startsWith("delayStatus:")) return delayStatusFilterSql(filter, values);
  const legacyMilestoneSql = legacyMilestoneFilterSql(filter);
  if (legacyMilestoneSql) return legacyMilestoneSql;
  if (filter.startsWith("cashOutgoAny:")) return cashOutgoAnyFilterSql(filter, values);
  if (filter.startsWith("cashOutgo:")) return cashOutgoFilterSql(filter, values);
  if (filter.startsWith("statusSummary:")) return statusSummaryFilterSql(filter);
  if (filter.startsWith("delayFile:")) {
    const placeholder = addSqlValue(values, filter.slice("delayFile:".length));
    return `f.id = ${placeholder}`;
  }
  if (filter.startsWith("attribute:")) {
    const [, key, value] = filter.split(":");
    const column = fileSearchColumns[key as keyof typeof fileSearchColumns];
    if (!column) return "true";
    if (value === "yes") return isYesSql(column);
    if (value === "no") return isNoSql(column);
    return "true";
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
  if (filter.startsWith("fileCategory:")) {
    return fileCategorySql(normalizeFileCategories([filter.slice("fileCategory:".length)]));
  }
  if (filter.startsWith("mode:")) {
    const placeholder = addSqlValue(values, filter.slice(5).trim().toUpperCase());
    return `upper(trim(coalesce(f.mode, ''))) = ${placeholder}`;
  }
  if (filter.startsWith("manualMilestoneCurrent:")) {
    const milestone = filter.slice("manualMilestoneCurrent:".length);
    if (isSupplyOrderDrivenMilestoneName(milestone)) {
      return supplyOrderDrivenCurrentMilestoneSql(milestone, values);
    }
    const placeholder = addSqlValue(values, milestone);
    return `not ${isCancelledFileSql()} and f.current_milestone = ${placeholder}`;
  }
  if (filter.startsWith("manualMilestoneCompleted:")) {
    const milestone = filter.slice("manualMilestoneCompleted:".length);
    if (normalizeMilestoneName(milestone) === "payment") return paymentCompletedSql();
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
  if (filter === "liveBids") return isYesSql("f.tender_live");
  if (filter === "bidOverdue") return bidOpeningOverdueSql(today);
  if (filter === "supplyOrders") return supplyOrderPlacedSql();
  if (filter === "liveSupplyOrders") return liveSupplyOrderSql();
  if (filter === "bgReceived")
    return `${isYesSql("f.bg")} and ${supplyOrderChildOrLegacySql(
      hasTextSql("so.bg_validity_date"),
      hasTextSql("f.bg_validity_date"),
    )}`;
  if (filter === "bgToBeReceived")
    return `${isYesSql("f.bg")} and ${supplyOrderPlacedSql()} and not (${legacyOrSupplyDate(
      "bgValidityDate",
    )})`;
  if (filter === "bgToBeReturned")
    return `${isYesSql("f.bg")} and ${supplyOrderChildOrLegacySql(
      `${hasTextSql("so.so_date")} and ${hasTextSql(
        "so.bg_validity_date",
      )} and so.bg_validity_date < ${today} and not ${hasTextSql("so.bg_return_date")}`,
      `${hasTextSql("f.so_date")} and ${hasTextSql(
        "f.bg_validity_date",
      )} and f.bg_validity_date < ${today} and not ${hasTextSql("f.bg_return_date")}`,
    )}`;
  if (filter === "dpExtension") return isYesSql("f.dp_extension");
  if (filter === "dpExpired") return supplyOrderExists(`${effectiveDpDateSql("so")} < ${today}`);
  if (filter === "deliveryOverdue")
    return `${deliveryInspectionApplicableSql()} and ${supplyOrderPlacedSql()} and ${deliveryDueOrderSql(
      `${effectiveDpDateSql("so")} < current_date`,
    )}`;
  if (filter === "deliveryDueToday")
    return `${deliveryInspectionApplicableSql()} and ${supplyOrderPlacedSql()} and ${deliveryDueOrderSql(
      `${effectiveDpDateSql("so")} = current_date`,
    )}`;
  if (filter === "deliveryUpcoming")
    return `${deliveryInspectionApplicableSql()} and ${supplyOrderPlacedSql()} and ${deliveryDueOrderSql(
      `${effectiveDpDateSql("so")} > current_date`,
    )}`;
  if (filter === "deliveryCompleted")
    return `${deliveryInspectionApplicableSql()} and ${supplyOrderPlacedSql()} and ${supplyOrderExists(
      `${hasTextSql("so.so_date")} and ${hasTextSql("so.material_receipt_date")}`,
    )}`;
  if (filter === "deliveryDeliveredLate")
    return `${deliveryInspectionApplicableSql()} and ${supplyOrderPlacedSql()} and ${supplyOrderExists(
      `${hasTextSql("so.so_date")} and ${hasTextSql("so.material_receipt_date")} and ${effectiveDpDateSql("so")} is not null and so.material_receipt_date > ${effectiveDpDateSql("so")}`,
    )}`;
  if (filter === "deliveryDue")
    return `${deliveryInspectionApplicableSql()} and not ${isCancelledFileSql()} and ${supplyOrderPlacedSql()} and ${deliveryPendingOrderSql()}`;
  if (filter === "deliveryPeriodValid")
    return `${supplyOrderPlacedSql()} and ${supplyOrderExists(
      `${hasTextSql("so.so_date")} and ${effectiveDpDateSql("so")} is not null and ${effectiveDpDateSql("so")} > current_date and not ${hasTextSql(
        "so.material_receipt_date",
      )}`,
    )}`;
  if (filter === "deliveryPeriodExpired")
    return `not ${isCancelledFileSql()} and ${supplyOrderPlacedSql()} and ${supplyOrderExists(
      `${hasTextSql("so.so_date")} and ${effectiveDpDateSql("so")} is not null and ${effectiveDpDateSql("so")} < current_date and not ${hasTextSql(
        "so.material_receipt_date",
      )}`,
    )}`;
  if (filter === "deliveryPeriodExtended")
    return `${supplyOrderPlacedSql()} and ${supplyOrderExists(
      `${hasTextSql("so.so_date")} and ${hasTextSql("so.revised_dp")} and ${effectiveDpDateSql("so")} > current_date and not ${hasTextSql(
        "so.material_receipt_date",
      )}`,
    )}`;
  if (filter === "irPreparationPending")
    return `${deliveryInspectionApplicableSql()} and ${isYesSql("f.ir")}
      and not (${isYesSql("f.demand_cancelled")} or ${isYesSql("f.so_cancelled")})
      and ${supplyOrderExists(
        `${hasTextSql("so.so_date")}
         and ${hasTextSql("so.material_receipt_date")}
         and not ${hasTextSql("so.ir_preparation_date")}
         and not ${isYesSql("so.so_cancelled")}`,
      )}`;
  if (filter === "irReceiptPending")
    return `${deliveryInspectionApplicableSql()} and ${isYesSql("f.ir")}
      and not (${isYesSql("f.demand_cancelled")} or ${isYesSql("f.so_cancelled")})
      and ${supplyOrderExists(
        `${hasTextSql("so.ir_preparation_date")}
         and not ${hasTextSql("so.ir_receipt_date")}
         and not ${isYesSql("so.so_cancelled")}`,
      )}`;
  if (filter === "irCompleted")
    return `${deliveryInspectionApplicableSql()} and ${isYesSql("f.ir")}
      and not (${isYesSql("f.demand_cancelled")} or ${isYesSql("f.so_cancelled")})
      and ${supplyOrderExists(
        `${hasTextSql("so.ir_receipt_date")}
         and not ${isYesSql("so.so_cancelled")}`,
      )}`;
  if (filter === "paymentDue") return paymentPendingSql();
  if (filter === "miscLiveFiles") return `not ${fileClosedSql()} and not ${isCancelledFileSql()}`;
  if (filter === "miscFileClosed") return fileClosedSql();
  if (filter === "miscLd") return supplyOrderExists(isYesSql("so.ld"));
  if (filter === "miscDemandCancelled") return isYesSql("f.demand_cancelled");
  if (filter === "miscSoCancelled") return supplyOrderExists(isYesSql("so.so_cancelled"));
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
  if (filter === "soCompleted") return hasTextSql("f.so_no");
  if (filter === "soRemaining") return `not ${hasTextSql("f.so_no")}`;
  return "true";
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
  if (sortColumnKey === "invitedFirms" || sortColumnKey === "bidderFirms") {
    const type = sortColumnKey === "invitedFirms" ? "invited" : "bidder";
    return `(select count(*) from file_firms ff where ff.file_id = f.id and ff.firm_type = '${type}' and (${hasTextSql(
      "ff.firm_name",
    )} or ${hasTextSql("ff.city")} or ${hasTextSql("ff.email_id")})) ${dir}`;
  }
  const supplyColumn =
    supplyOrderSearchColumns[sortColumnKey as keyof typeof supplyOrderSearchColumns];
  if (supplyColumn) return `lower(coalesce(${supplyOrderTextExpression(supplyColumn)}, '')) ${dir}`;
  const column = fileSearchColumns[sortColumnKey as keyof typeof fileSearchColumns];
  if (!column) return "";
  return `lower(coalesce(${column}::text, '')) ${dir}`;
}

function buildSearchSql(
  baseConditions: string[],
  baseValues: unknown[],
  params: FileSearchParams,
  query: Record<string, unknown>,
): SearchSql {
  const conditions = [...baseConditions];
  const values = [...baseValues];
  const selectedModes = params.selectedModes ?? [];
  const selectedFirmTypes = params.selectedFirmTypes ?? [];
  const selectedFileTypes = params.selectedFileTypes ?? [];
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
  if (dashboardFilter) {
    if (!isCancellationDashboardFilter(dashboardFilter)) {
      conditions.push(`not ${isCancelledFileSql()}`);
    }
    conditions.push(`(${dashboardFilterSql(dashboardFilter, values)})`);
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
    conditions.push(
      `(${supplyOrderExists(`lower(coalesce(so.firm, '')) like ${placeholder}`)} or lower(coalesce(f.firm, '')) like ${placeholder})`,
    );
  }
  if (selectedModes.length) {
    const placeholder = addSqlValue(
      values,
      selectedModes.map((mode) => mode.trim().toUpperCase()),
    );
    conditions.push(`upper(trim(coalesce(f.mode, ''))) = any(${placeholder}::text[])`);
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
    conditions.push(
      supplyOrderChildOrLegacySql(isYesSql("so.dp_extension"), isYesSql("f.dp_extension")),
    );
  }
  if (params.ldFilter) {
    conditions.push(supplyOrderChildOrLegacySql(isYesSql("so.ld"), isYesSql("f.ld")));
  }
  if (params.highValue) conditions.push(isYesSql("f.high_value"));
  if (params.gte) conditions.push(isYesSql("f.gte"));
  if (params.ad) conditions.push(isYesSql("f.ad"));
  if (params.rqa) conditions.push(isYesSql("f.rqa"));
  if (params.ifaFilter) conditions.push(isYesSql("f.ifa"));
  if (params.psbFilter) conditions.push(isYesSql("f.psb"));
  if (params.bgFilter) conditions.push(isYesSql("f.bg"));
  if (params.rfpVettingFilter) conditions.push(isYesSql("f.rfp_vetting"));
  if (params.refloat) {
    conditions.push(
      `(${isYesSql("f.refloat")} or ${fileHasAny([
        "refloatBiddingDate",
        "refloatBidOpeningDate",
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
      ])})`,
    );
  }
  if (params.rstFilter) conditions.push(isYesSql("f.rst"));
  if (params.demandCancelledFilter) conditions.push(isYesSql("f.demand_cancelled"));
  if (params.soCancelledFilter)
    conditions.push(
      `(${supplyOrderExists(isYesSql("so.so_cancelled"))} or ${isYesSql("f.so_cancelled")})`,
    );

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
            (column) =>
              column.includes("date") ||
              column === "revised_dp" ||
              column === "dp_date" ||
              column === "bg_validity_date" ||
              column === "bg_return_date",
          )
          .map((column) => `so.${column} = ${placeholder}::date`)
          .join(" or "),
      )})`,
    );
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

function usesLegacyDashboardFilter(filter: string | undefined) {
  if (!filter) return false;
  return (
    filter === "deliveryPeriodValid" ||
    filter === "deliveryPeriodExpired" ||
    filter === "deliveryPeriodExtended" ||
    filter.startsWith("cashOutgo:") ||
    filter.startsWith("cashOutgoAny:") ||
    filter.startsWith("delayStatus:") ||
    filter.startsWith("manualMilestoneCurrent:") ||
    filter.startsWith("manualMilestoneCompleted:") ||
    filter.startsWith("milestoneTotal:") ||
    filter.startsWith("milestoneUnderProcess:") ||
    filter.startsWith("milestoneActive:") ||
    filter.startsWith("milestone:") ||
    filter.startsWith("milestoneReviewed:") ||
    filter.startsWith("milestonePending:") ||
    filter.startsWith("milestoneCleared:") ||
    filter.startsWith("milestoneEligible:")
  );
}

async function loadLegacyFilteredSearch(
  whereSql: string,
  values: unknown[],
  params: FileSearchParams,
  query: Record<string, unknown>,
) {
  const page = readPositiveInteger(query.page, 1, 1_000_000);
  const pageSize = readPositiveInteger(query.pageSize, 100, 500);
  const results = searchFiles(await loadFiles(whereSql, values), params);
  const start = (page - 1) * pageSize;
  return {
    files: results.slice(start, start + pageSize),
    total: results.length,
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

function buildFileInsert(body: Record<string, unknown>, divisionId: string | null) {
  const columns = ["division_id"];
  const values: unknown[] = [divisionId];
  const placeholders = ["$1"];

  for (const [frontendKey, [column, kind]] of Object.entries(fileFields)) {
    if (!(frontendKey in body)) continue;
    values.push(toDbValue(body[frontendKey], kind));
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
    addField(column, toDbValue(body[frontendKey], kind));
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
      order &&
      typeof order === "object" &&
      hasTextValue((order as Record<string, unknown>).soDate),
  );
}

function isYesValue(value: unknown) {
  return String(value ?? "").trim().toLowerCase() === "yes";
}

function hasTextValue(value: unknown) {
  return String(value ?? "").trim().length > 0;
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
      "stageDelivery",
      "stagePayment",
    ].includes(key)
  );
}

async function replaceFirms(
  client: PoolClient,
  fileId: string,
  firmType: "invited" | "bidder",
  rows: Record<string, unknown>[],
) {
  await client.query("delete from file_firms where file_id = $1 and firm_type = $2", [
    fileId,
    firmType,
  ]);
  let sortOrder = 0;
  for (const row of rows.filter(hasFilledValue)) {
    await client.query(
      `insert into file_firms (file_id, firm_type, firm_name, city, email_id, sort_order)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        fileId,
        firmType,
        toDbText(row.firmName),
        toDbText(row.city),
        toDbText(row.emailId),
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
  for (const row of rows.filter(hasFilledValue)) {
    const text = toDbText(row.text);
    if (!text) continue;
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
  return body.activeYears
    .map((year) => (typeof year === "string" ? year.trim() : ""))
    .filter(Boolean);
}

async function replaceActiveYears(
  client: PoolClient,
  fileId: string,
  activeYears: string[],
  originYear: unknown,
) {
  const origin =
    typeof originYear === "string" && originYear.trim()
      ? originYear.trim()
      : (
          await client.query<{ year: string | null }>("select year from files where id = $1", [
            fileId,
          ])
        ).rows[0]?.year;
  const years = Array.from(new Set([...activeYears, ...(origin ? [origin] : [])]));
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
  const invitedFirms = readArray(body.invitedFirms, "invitedFirms");
  const bidderFirms = readArray(body.bidderFirms, "bidderFirms");
  const supplyOrders = readArray(body.supplyOrders, "supplyOrders");
  const remarks = readArray(body.remarks, "remarks");
  const markers = readArray(body.markers, "markers");
  const completedMilestones = body.completedMilestones;
  const activeYears = readActiveYears(body);

  if (!onlyProvided || invitedFirms)
    await replaceFirms(client, fileId, "invited", invitedFirms ?? []);
  if (!onlyProvided || bidderFirms) await replaceFirms(client, fileId, "bidder", bidderFirms ?? []);
  if (!onlyProvided || supplyOrders) await replaceSupplyOrders(client, fileId, supplyOrders ?? []);
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
      conditions.push(
        `(not exists (
            select 1 from file_completed_milestones completed
            where completed.file_id = f.id and lower(completed.milestone) = 'payment'
          )
          and lower(coalesce(f.demand_cancelled, '')) <> 'yes'
          and lower(coalesce(f.so_cancelled, '')) <> 'yes'
          and not exists (
            select 1 from supply_orders so
            where so.file_id = f.id
              and lower(coalesce(so.so_cancelled, '')) = 'yes'
          ))`,
      );
    } else if (typeof request.query.year === "string" && request.query.year.trim()) {
      values.push(request.query.year.trim());
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
    const scope = getDivisionScopeCondition(user);
    const categoryScope = getFileCategoryScopeCondition(user);
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (scope.sql) {
      conditions.push(scope.sql);
      values.push(...scope.values);
    }
    if (categoryScope.sql) conditions.push(categoryScope.sql);
    const selectedYear = readQueryString(request.query.selectedYear)?.trim();
    if (selectedYear === allActiveFilesYear) {
      conditions.push(
        `(not exists (
            select 1 from file_completed_milestones completed
            where completed.file_id = f.id and lower(completed.milestone) = 'payment'
          )
          and lower(coalesce(f.demand_cancelled, '')) <> 'yes'
          and lower(coalesce(f.so_cancelled, '')) <> 'yes'
          and not exists (
            select 1 from supply_orders so
            where so.file_id = f.id
              and lower(coalesce(so.so_cancelled, '')) = 'yes'
          ))`,
      );
    } else if (selectedYear) {
      values.push(selectedYear);
      conditions.push(
        `(f.year = $${values.length} or exists (
          select 1 from file_year_activity a
          where a.file_id = f.id and a.financial_year = $${values.length} and a.status = 'active'
        ))`,
      );
    }
    const searchParams = readSearchParams(request.query);
    const page = readPositiveInteger(request.query.page, 1, 1_000_000);
    const pageSize = readPositiveInteger(request.query.pageSize, 100, 500);

    const baseWhereSql = conditions.length ? `where ${conditions.join(" and ")}` : "";
    const results = usesLegacyDashboardFilter(searchParams.dashboardFilter)
      ? await loadLegacyFilteredSearch(baseWhereSql, values, searchParams, request.query)
      : await loadSearchFiles(buildSearchSql(conditions, values, searchParams, request.query));
    if (
      process.env.FILES_SQL_COMPARE_LEGACY === "true" &&
      !searchParams.dashboardFilter?.trim() &&
      usesLegacyDashboardFilter(searchParams.dashboardFilter)
    ) {
      const legacyResults = await loadLegacyFilteredSearch(
        baseWhereSql,
        values,
        searchParams,
        request.query,
      );
      const sqlIds = results.files.map((file) => file.id);
      const legacyIds = legacyResults.files.map((file) => file.id);
      if (
        results.total !== legacyResults.total ||
        JSON.stringify(sqlIds) !== JSON.stringify(legacyIds)
      ) {
        console.warn("Legacy file search differs from SQL search.", {
          filter: searchParams.dashboardFilter,
          sqlTotal: results.total,
          legacyTotal: legacyResults.total,
          sqlIds,
          legacyIds,
        });
      }
    }
    response.json({
      files: results.files,
      total: results.total,
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
    const selectedYear = readQueryString(query.selectedYear)?.trim();
    if (selectedYear === allActiveFilesYear) {
      conditions.push(
        `(not exists (
            select 1 from file_completed_milestones completed
            where completed.file_id = f.id and lower(completed.milestone) = 'payment'
          )
          and lower(coalesce(f.demand_cancelled, '')) <> 'yes'
          and lower(coalesce(f.so_cancelled, '')) <> 'yes'
          and not exists (
            select 1 from supply_orders so
            where so.file_id = f.id
              and lower(coalesce(so.so_cancelled, '')) = 'yes'
          ))`,
      );
    } else if (selectedYear) {
      values.push(selectedYear);
      conditions.push(
        `(f.year = $${values.length} or exists (
          select 1 from file_year_activity a
          where a.file_id = f.id and a.financial_year = $${values.length} and a.status = 'active'
        ))`,
      );
    }

    const searchParams = readSearchParams(query);
    const exportLimit = 5000;
    const results = usesLegacyDashboardFilter(searchParams.dashboardFilter)
      ? await loadLegacyFilteredSearch(
          conditions.length ? `where ${conditions.join(" and ")}` : "",
          values,
          searchParams,
          {
            ...query,
            page: "1",
            pageSize: String(exportLimit),
          },
        )
      : await loadSearchFiles({
          ...buildSearchSql(conditions, values, searchParams, {
            ...query,
            page: "1",
            pageSize: "500",
          }),
          limit: exportLimit,
          offset: 0,
          page: 1,
          pageSize: exportLimit,
        });
    const exportColumns = buildFileSearchExportColumns(results.files, columns);
    const document = {
      title,
      description: `Files: ${results.total}${results.total > results.files.length ? ` (exported first ${results.files.length})` : ""}`,
      tables: [
        {
          headers: ["S.No.", ...exportColumns.map((column) => column.label)],
          rows: results.files.map((file, index) => [
            String(index + 1),
            ...exportColumns.map((column) => column.getValue(file)),
          ]),
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

filesRouter.get(
  "/next-unique-code",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const financialYear = readQueryString(request.query.financialYear)?.trim() ?? "";
    const divisionName = readQueryString(request.query.division)?.trim() ?? "";
    const yearCode = financialYear.replace(/\D/g, "").slice(-2);
    if (!yearCode || !divisionName) {
      response.json({ uniqueCode: "" });
      return;
    }

    const divisionResult = await pool.query<{ id: string; code: string | null }>(
      "select id, code from divisions where lower(name) = lower($1) and archived_at is null",
      [divisionName],
    );
    const division = divisionResult.rows[0];
    if (!division) throw new HttpError(404, "Division not found.");
    if (!canAccessDivision(user, division.id)) {
      throw new HttpError(403, "You cannot access this division.");
    }

    const divisionCode = (division.code ?? "").replace(/\s+/g, "");
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
    const body = requireObjectBody(request.body);
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
    const body = requireObjectBody(request.body);
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
