import { Router } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import type { FileRecord, FirmDetail, FileRemark, SupplyOrderDetail } from "../types.js";
import {
  canAccessDivision,
  canMutateFiles,
  getDivisionScopeCondition,
  requireAuth,
  type AuthRequest,
} from "../utils/auth.js";
import { type FileSearchParams, searchFiles } from "../utils/file-search.js";
import {
  fromDbDate,
  fromDbText,
  toDbDate,
  toDbInteger,
  toDbNumber,
  toDbText,
} from "../utils/db-values.js";
import { asyncHandler, HttpError, requireObjectBody, requireParam } from "../utils/http.js";

export const filesRouter = Router();
const allActiveFilesYear = "__all_active_files__";

type ValueKind = "text" | "date" | "number" | "integer";

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
  fileType: ["file_type", "text"],
  tcec: ["tcec", "text"],
  mode: ["mode", "text"],
  gem: ["gem", "text"],
  highValue: ["high_value", "text"],
  ad: ["ad", "text"],
  rqa: ["rqa", "text"],
  ifa: ["ifa", "text"],
  psb: ["psb", "text"],
  bg: ["bg", "text"],
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
  bgValidityDate: ["bg_validity_date", "date"],
  dpExtension: ["dp_extension", "text"],
  dpExtensionCount: ["dp_extension_count", "integer"],
  ld: ["ld", "text"],
  revisedDp: ["revised_dp", "date"],
  materialReceiptDate: ["material_receipt_date", "date"],
  billSentForPaymentDate: ["bill_sent_for_payment_date", "date"],
  paymentDate: ["payment_date", "date"],
  paymentMode: ["payment_mode", "text"],
  bgReturnDate: ["bg_return_date", "date"],
  demandCancelled: ["demand_cancelled", "text"],
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

const supplyOrderFields = {
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
  billSentForPaymentDate: ["bill_sent_for_payment_date", "date"],
  paymentDate: ["payment_date", "date"],
  paymentMode: ["payment_mode", "text"],
  bgReturnDate: ["bg_return_date", "date"],
  demandCancelled: ["demand_cancelled", "text"],
  soCancelled: ["so_cancelled", "text"],
  soCancelledDate: ["so_cancelled_date", "date"],
} as const satisfies Record<string, readonly [string, ValueKind]>;

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
  completedMilestones: Map<string, string[]>;
  activeYears: Map<string, string[]>;
};

function toDbValue(value: unknown, kind: ValueKind) {
  if (kind === "date") return toDbDate(value);
  if (kind === "number") return toDbNumber(value);
  if (kind === "integer") return toDbInteger(value);
  return toDbText(value);
}

function fromDbValue(value: unknown, kind: ValueKind) {
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
    capitalOnly: readQueryBoolean(query.capitalOnly),
    revenueOnly: readQueryBoolean(query.revenueOnly),
    description: readQueryString(query.description),
    firm: readQueryString(query.firm),
    selectedModes: readQueryList(query.selectedModes),
    selectedFileTypes: readQueryList(query.selectedFileTypes),
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

function normalizedSql(expression: string) {
  return `regexp_replace(lower(coalesce(${expression}, '')), '[^a-z0-9]+', '', 'g')`;
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
  fileType: "f.file_type",
  tcec: "f.tcec",
  mode: "f.mode",
  gem: "f.gem",
  highValue: "f.high_value",
  ad: "f.ad",
  rqa: "f.rqa",
  ifa: "f.ifa",
  psb: "f.psb",
  bg: "f.bg",
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
  bgValidityDate: "f.bg_validity_date",
  dpExtension: "f.dp_extension",
  dpExtensionCount: "f.dp_extension_count",
  ld: "f.ld",
  revisedDp: "f.revised_dp",
  materialReceiptDate: "f.material_receipt_date",
  billSentForPaymentDate: "f.bill_sent_for_payment_date",
  paymentDate: "f.payment_date",
  paymentMode: "f.payment_mode",
  bgReturnDate: "f.bg_return_date",
  demandCancelled: "f.demand_cancelled",
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
  "f.refloat_post_tcec_date",
  "f.refloat_post_tcec_minutes_date",
  "f.cnc_date",
  "f.cnc_approval_date",
  "f.so_date",
  "f.dp_date",
  "f.bg_validity_date",
  "f.revised_dp",
  "f.material_receipt_date",
  "f.bill_sent_for_payment_date",
  "f.payment_date",
  "f.bg_return_date",
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
  return `(${isYesSql("f.demand_cancelled")} or ${isYesSql("f.so_cancelled")} or ${supplyOrderExists(
    `${isYesSql("so.demand_cancelled")} or ${isYesSql("so.so_cancelled")}`,
  )})`;
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

function dashboardFilterSql(filter: string, values: unknown[]) {
  const today = "current_date";
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
  if (filter.startsWith("mode:")) {
    const placeholder = addSqlValue(values, filter.slice(5).trim().toUpperCase());
    return `upper(trim(coalesce(f.mode, ''))) = ${placeholder}`;
  }
  if (filter.startsWith("fileType:")) {
    const placeholder = addSqlValue(values, filter.slice(9).trim());
    return `trim(coalesce(f.file_type, '')) = ${placeholder}`;
  }
  if (filter.startsWith("manualMilestoneCurrent:")) {
    const placeholder = addSqlValue(values, filter.slice("manualMilestoneCurrent:".length));
    return `not ${isCancelledFileSql()} and f.current_milestone = ${placeholder}`;
  }
  if (filter.startsWith("manualMilestoneCompleted:")) {
    const placeholder = addSqlValue(values, filter.slice("manualMilestoneCompleted:".length));
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
  if (filter === "bidOverdue")
    return `${isNoSql("f.bid_opened")} and (f.bid_opening_date < ${today} or f.refloat_bid_opening_date < ${today})`;
  if (filter === "supplyOrders") return supplyOrderPlacedSql();
  if (filter === "liveSupplyOrders") return deliveryDueOrderSql();
  if (filter === "bgToBeReceived")
    return `${isYesSql("f.bg")} and ${supplyOrderPlacedSql()} and not (${legacyOrSupplyDate(
      "bgValidityDate",
    )})`;
  if (filter === "bgToBeReturned")
    return supplyOrderExists(
      `${isYesSql("f.bg")} and ${hasTextSql("so.bg_validity_date")} and so.bg_validity_date < ${today} and not ${hasTextSql(
        "so.bg_return_date",
      )}`,
    );
  if (filter === "dpExtension") return isYesSql("f.dp_extension");
  if (filter === "dpExpired")
    return supplyOrderExists(`so.dp_date < ${today} and not ${hasTextSql("so.revised_dp")}`);
  if (filter === "deliveryOverdue")
    return `${supplyOrderPlacedSql()} and ${deliveryDueOrderSql(
      "coalesce(so.revised_dp, so.dp_date) < current_date",
    )}`;
  if (filter === "deliveryDueToday")
    return `${supplyOrderPlacedSql()} and ${deliveryDueOrderSql(
      "coalesce(so.revised_dp, so.dp_date) = current_date",
    )}`;
  if (filter === "deliveryUpcoming")
    return `${supplyOrderPlacedSql()} and ${deliveryDueOrderSql(
      "coalesce(so.revised_dp, so.dp_date) > current_date",
    )}`;
  if (filter === "deliveryCompleted")
    return `${supplyOrderPlacedSql()} and ${supplyOrderExists(
      `${hasTextSql("so.so_date")} and ${hasTextSql("so.material_receipt_date")}`,
    )}`;
  if (filter === "deliveryDeliveredLate")
    return `${supplyOrderPlacedSql()} and ${supplyOrderExists(
      `${hasTextSql("so.so_date")} and ${hasTextSql("so.material_receipt_date")} and coalesce(so.revised_dp, so.dp_date) is not null and so.material_receipt_date > coalesce(so.revised_dp, so.dp_date)`,
    )}`;
  if (filter === "deliveryDue")
    return `not ${isCancelledFileSql()} and ${supplyOrderPlacedSql()} and ${deliveryDueOrderSql()}`;
  if (filter === "deliveryPeriodValid")
    return `${supplyOrderPlacedSql()} and ${supplyOrderExists(
      `${hasTextSql("so.so_date")} and not ${hasTextSql("so.revised_dp")} and so.dp_date > current_date and not ${hasTextSql(
        "so.material_receipt_date",
      )}`,
    )}`;
  if (filter === "deliveryPeriodExpired")
    return `not ${isCancelledFileSql()} and ${supplyOrderPlacedSql()} and ${supplyOrderExists(
      `${hasTextSql("so.so_date")} and coalesce(so.revised_dp, so.dp_date) is not null and coalesce(so.revised_dp, so.dp_date) < current_date and not ${hasTextSql(
        "so.material_receipt_date",
      )}`,
    )}`;
  if (filter === "deliveryPeriodExtended")
    return `${supplyOrderPlacedSql()} and ${supplyOrderExists(
      `${hasTextSql("so.so_date")} and ${hasTextSql("so.revised_dp")} and so.revised_dp > current_date and not ${hasTextSql(
        "so.material_receipt_date",
      )}`,
    )}`;
  if (filter === "paymentDue")
    return supplyOrderExists(`${hasTextSql("so.material_receipt_date")} and not ${hasTextSql("so.payment_date")}`);
  if (filter === "miscLd") return supplyOrderExists(isYesSql("so.ld"));
  if (filter === "miscDemandCancelled") return supplyOrderExists(isYesSql("so.demand_cancelled"));
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
  const supplyColumn = supplyOrderSearchColumns[sortColumnKey as keyof typeof supplyOrderSearchColumns];
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
  const selectedFileTypes = params.selectedFileTypes ?? [];
  const page = readPositiveInteger(query.page, 1, 1_000_000);
  const pageSize = readPositiveInteger(query.pageSize, 100, 500);
  const limit = pageSize;
  const offset = (page - 1) * pageSize;

  if (params.yearFilter?.trim()) {
    const placeholder = addSqlValue(values, sqlLike(params.yearFilter));
    conditions.push(`lower(coalesce(f.year, '')) like ${placeholder}`);
  }
  if (params.dashboardFilter?.trim()) {
    conditions.push(`(${dashboardFilterSql(params.dashboardFilter.trim(), values)})`);
  }
  const analyticsNames = (params.analyticsNames ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (analyticsNames.length && params.analyticsType === "indentor") {
    const placeholder = addSqlValue(values, analyticsNames);
    conditions.push(`lower(coalesce(nullif(trim(f.indentor), ''), 'Unassigned indentor')) = any(${placeholder}::text[])`);
  }
  if (analyticsNames.length && params.analyticsType === "firm") {
    const placeholder = addSqlValue(values, analyticsNames);
    conditions.push(supplyOrderExists(`lower(coalesce(nullif(trim(so.firm), ''), 'Unassigned firm')) = any(${placeholder}::text[])`));
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
    conditions.push(`(${supplyOrderExists(`lower(coalesce(so.firm, '')) like ${placeholder}`)} or lower(coalesce(f.firm, '')) like ${placeholder})`);
  }
  if (selectedModes.length) {
    const placeholder = addSqlValue(values, selectedModes.map((mode) => mode.trim().toUpperCase()));
    conditions.push(`upper(trim(coalesce(f.mode, ''))) = any(${placeholder}::text[])`);
  }
  if (selectedFileTypes.length) {
    const placeholder = addSqlValue(values, selectedFileTypes.map((fileType) => fileType.trim()));
    conditions.push(`trim(coalesce(f.file_type, '')) = any(${placeholder}::text[])`);
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
        "refloatPostTcecDate",
        "refloatPostTcecCommitteeNo",
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
  if (params.demandCancelledFilter)
    conditions.push(`(${supplyOrderExists(isYesSql("so.demand_cancelled"))} or ${isYesSql("f.demand_cancelled")})`);
  if (params.soCancelledFilter)
    conditions.push(`(${supplyOrderExists(isYesSql("so.so_cancelled"))} or ${isYesSql("f.so_cancelled")})`);

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

  if (isValidDate(params.dpFrom) || isValidDate(params.dpTo)) {
    const dpConditions: string[] = [];
    if (isValidDate(params.dpFrom)) {
      const placeholder = addSqlValue(values, params.dpFrom);
      dpConditions.push(`so.dp_date >= ${placeholder}::date`);
    }
    if (isValidDate(params.dpTo)) {
      const placeholder = addSqlValue(values, params.dpTo);
      dpConditions.push(`so.dp_date <= ${placeholder}::date`);
    }
    conditions.push(supplyOrderExists(dpConditions.join(" and ")));
  }

  if (params.freeText?.trim()) {
    const placeholder = addSqlValue(values, sqlLike(params.freeText));
    const normalizedQuery = params.freeText.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
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
    conditions.push(`(${dateSearchColumns.map((column) => `${column} = ${placeholder}::date`).join(" or ")} or ${supplyOrderExists(
      Object.values(supplyOrderSearchColumns)
        .filter((column) => column.includes("date") || column === "revised_dp" || column === "dp_date" || column === "bg_validity_date" || column === "bg_return_date")
        .map((column) => `so.${column} = ${placeholder}::date`)
        .join(" or "),
    )})`);
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
    filter.startsWith("delayStatus:") ||
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

function hasFilledValue(row: Record<string, unknown>) {
  return Object.values(row).some((value) => String(value ?? "").trim());
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
  const completedMilestones = body.completedMilestones;
  const activeYears = readActiveYears(body);

  if (!onlyProvided || invitedFirms)
    await replaceFirms(client, fileId, "invited", invitedFirms ?? []);
  if (!onlyProvided || bidderFirms) await replaceFirms(client, fileId, "bidder", bidderFirms ?? []);
  if (!onlyProvided || supplyOrders) await replaceSupplyOrders(client, fileId, supplyOrders ?? []);
  if (!onlyProvided || remarks) await replaceRemarks(client, fileId, remarks ?? []);
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
    if (scope.sql) {
      conditions.push(scope.sql);
      values.push(...scope.values);
    }

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
              and (
                lower(coalesce(so.demand_cancelled, '')) = 'yes'
                or lower(coalesce(so.so_cancelled, '')) = 'yes'
              )
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
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (scope.sql) {
      conditions.push(scope.sql);
      values.push(...scope.values);
    }
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
              and (
                lower(coalesce(so.demand_cancelled, '')) = 'yes'
                or lower(coalesce(so.so_cancelled, '')) = 'yes'
              )
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
    if (usesLegacyDashboardFilter(searchParams.dashboardFilter)) {
      const results = await loadLegacyFilteredSearch(
        conditions.length ? `where ${conditions.join(" and ")}` : "",
        values,
        searchParams,
        request.query,
      );
      response.json(results);
      return;
    }

    const searchSql = buildSearchSql(conditions, values, searchParams, request.query);
    const results = await loadSearchFiles(searchSql);
    response.json({
      files: results.files,
      total: results.total,
      page: searchSql.page,
      pageSize: searchSql.pageSize,
    });
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
      const existing = await client.query<{ id: string; division_id: string | null }>(
        "select id, division_id from files where id = $1 and archived_at is null",
        [id],
      );
      if (existing.rowCount === 0) throw new HttpError(404, "File not found.");
      if (!canAccessDivision(user, existing.rows[0].division_id)) {
        throw new HttpError(403, "You cannot edit this division.");
      }
      const divisionId =
        "division" in body ? await resolveDivisionId(client, body.division) : undefined;
      if (divisionId !== undefined && !canAccessDivision(user, divisionId)) {
        throw new HttpError(403, "You cannot move files to this division.");
      }
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

    if (user.role !== "admin") {
      await pool.query(
        `update files
         set archived_at = now(), archived_by = $2, archive_reason = 'Archived by editor'
         where id = $1`,
        [id, user.id],
      );
      response.json({ archived: true, file: files[0] });
      return;
    }

    await pool.query("delete from files where id = $1", [id]);
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
    response.json({ file: files[0] });
  }),
);
