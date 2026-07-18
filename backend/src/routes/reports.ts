import { Router } from "express";
import { pool } from "../db/pool.js";
import type { AppSettings, FileRecord, SupplyOrderDetail } from "../types.js";
import { loadFiles } from "./files.js";
import { fromDbJsonArray, fromDbText } from "../utils/db-values.js";
import { buildReportsSummary } from "../utils/report-summary.js";
import {
  matchesFileCategorySelection,
  normalizeFileCategories,
  type FileCategoryKey,
} from "../utils/file-categories.js";
import {
  getAuthScopeCacheKey,
  getDivisionScopeCondition,
  getFileCategoryScopeCondition,
  requireAuth,
  type AuthRequest,
} from "../utils/auth.js";
import { cacheTtl, getCached } from "../utils/cache.js";
import { asyncHandler, HttpError } from "../utils/http.js";

export const reportsRouter = Router();

type CashOutgoRow = {
  monthKey: string;
  month: string;
  capital: number;
  revenue: number;
  total: number;
};

type DelayStatusRow = {
  fileId: string;
  fileRef: string;
  division: string;
  indentor: string;
  description: string;
  milestoneKey: string;
  milestone: string;
  stageStartDate: string | undefined;
  daysInStage: number;
  lastFilledDate: string;
  focusSection?: string;
  focusTarget?: string;
};

type StatusSummaryTableRow = {
  milestone: string;
  counts: Partial<Record<string, number | string>>;
};

type StatusSummaryTableGroup = {
  key: string;
  title: string;
  columns: string[];
  rows: StatusSummaryTableRow[];
};

type ReportsSummaryPayload = {
  activeDivision: string;
  reportFileCount: number;
  statusSummaryGroups: StatusSummaryTableGroup[];
  expectedCashOutgoDpRows: CashOutgoRow[];
  expectedCashOutgoReceiptRows: CashOutgoRow[];
  expectedCashOutgoReceiptPendingBillRows: CashOutgoRow[];
  expectedCashOutgoBillPreparationRows: CashOutgoRow[];
  billSentForPaymentRows: CashOutgoRow[];
  actualCashOutgoRows: CashOutgoRow[];
  delayRows: DelayStatusRow[];
  delaySummary: {
    averageDays: number;
    longestDays: number;
    byMilestone: Array<{ key: string; label: string; count: number }>;
  };
};

const reportMilestoneDefinitions = [
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
    key: "financialSanction",
    label: "Financial Sanction",
    completedLabel: "Completed",
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
    key: "bankGuarantee",
    label: "Bank Guarantee",
    completedLabel: "Received",
    totalLabel: "Total files",
    appliesColumn: "f.bg",
    supplyOrderDate: "bg_validity_date",
  },
  { key: "payment", label: "Payment", totalLabel: "Total files", supplyOrderDate: "payment_date" },
] as const;

const orderDelayMilestoneDefinitions = [
  {
    key: "financialSanction",
    label: "Financial Sanction",
    current: "financialsanction",
    startColumn: "financial_sanction_start_date",
    completeColumn: "financial_sanction_date",
  },
  {
    key: "supplyOrder",
    label: "Supply Order",
    current: "supplyorder",
    startColumn: "supply_order_start_date",
    completeColumn: "so_date",
  },
  {
    key: "advancePayment",
    label: "Advance Payment",
    current: "advancepayment",
    startColumn: "advance_payment_start_date",
    completeColumn: "advance_payment_date",
    appliesCondition: () => isYesExpression("effective_order.advance_payment"),
  },
  {
    key: "bankGuarantee",
    label: "Bank Guarantee",
    current: "bankguarantee",
    startColumn: "bank_guarantee_start_date",
    completeColumn: "bg_validity_date",
    appliesCondition: () => isYesExpression("f.bg"),
  },
  {
    key: "delivery",
    label: "Delivery",
    current: "delivery",
    startColumn: "delivery_start_date",
    completeColumn: "material_receipt_date",
    appliesCondition: () =>
      `lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'o&m')`,
  },
  {
    key: "irPreparation",
    label: "IR Preparation",
    current: "irpreparation",
    startColumn: "ir_preparation_start_date",
    completeColumn: "ir_preparation_date",
    appliesCondition: () => isYesExpression("f.ir"),
  },
  {
    key: "irReceipt",
    label: "IR Receipt",
    current: "irreceipt",
    startColumn: "ir_receipt_start_date",
    completeColumn: "ir_receipt_date",
    appliesCondition: () => isYesExpression("f.ir"),
  },
  {
    key: "billPreparation",
    label: "Bill preparation",
    current: "billpreparation",
    startColumn: "bill_preparation_start_date",
    completeColumn: "bill_preparation_date",
  },
  {
    key: "billSentForPayment",
    label: "Bill sent for payment",
    current: "billsentforpayment",
    startColumn: "bill_sent_for_payment_start_date",
    completeColumn: "bill_sent_for_payment_date",
  },
  {
    key: "payment",
    label: "Payment",
    current: "payment",
    startColumn: "payment_start_date",
    completeColumn: "payment_date",
  },
] as const;

type SettingsRow = {
  financial_year: string;
  selected_year: string;
  year_selection_locked: boolean;
  theme: AppSettings["theme"];
  theme_tint: AppSettings["themeTint"];
  deletion_password: string;
  tcec_committees: unknown;
  firm_types: unknown;
  file_types: unknown;
  modes: unknown;
  milestones: unknown;
  table_field_presets: unknown;
  active_user_id: string | null;
};

function mapSettings(row: SettingsRow): AppSettings {
  return {
    financialYear: row.financial_year,
    selectedYear: row.selected_year,
    financialYears: [row.financial_year, row.selected_year].filter(Boolean),
    yearSelectionLocked: row.year_selection_locked,
    theme: row.theme,
    themeTint: row.theme_tint,
    deletionPassword: row.deletion_password,
    tcecCommittees: fromDbJsonArray(row.tcec_committees) as string[],
    firmTypes: fromDbJsonArray(row.firm_types) as string[],
    fileTypes: fromDbJsonArray(row.file_types) as string[],
    modes: fromDbJsonArray(row.modes) as string[],
    valueThresholdLevels: [],
    milestones: fromDbJsonArray(row.milestones) as string[],
    tableFieldPresets: fromDbJsonArray(row.table_field_presets),
    activeUserId: fromDbText(row.active_user_id) || undefined,
  };
}

async function loadSettings() {
  return getCached("settings:reports", cacheTtl.settingsMs, async () => {
    const result = await pool.query<SettingsRow>(
      `select financial_year, selected_year, year_selection_locked, theme, theme_tint, deletion_password,
              tcec_committees, firm_types, file_types, modes, milestones, table_field_presets, active_user_id
       from app_settings
       where id = true`,
    );
    if (!result.rows[0]) throw new HttpError(404, "Settings row not found. Run seed defaults.");
    return mapSettings(result.rows[0]);
  });
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value !== "string") return undefined;
  if (!value.trim()) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const allActiveFilesYear = "__all_active_files__";
const fileClosedMilestone = "File Closed";

function isFileActiveInYear(file: { year?: string; activeYears?: string[] }, year: string) {
  return file.year === year || file.activeYears?.includes(year);
}

function isPaymentCompletedFile(file: { completedMilestones?: string[] }) {
  return Boolean(
    file.completedMilestones?.some((milestone) => milestone.trim().toLowerCase() === "payment"),
  );
}

function isYes(value: string | undefined) {
  return (value ?? "").trim().toLowerCase() === "yes";
}

function isInactiveFile(
  file: Pick<
    FileRecord,
    "completedMilestones" | "demandCancelled" | "soCancelled" | "supplyOrders"
  >,
) {
  return (
    isPaymentCompletedFile(file) ||
    isYes(file.demandCancelled) ||
    ((file.supplyOrders?.length ?? 0) === 0 && isYes(file.soCancelled)) ||
    Boolean(
      file.supplyOrders?.length &&
        file.supplyOrders.every((order: SupplyOrderDetail) => isYes(order.soCancelled)),
    )
  );
}

function readNonNegativeInteger(value: unknown, fallback: number) {
  const text = readString(value);
  const parsed = Number.parseInt(text ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readDateString(value: unknown) {
  const text = readString(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function readMonthString(value: unknown) {
  const text = readString(value);
  return text && /^\d{4}-\d{2}$/.test(text) ? text : undefined;
}

function getMonthEndDate(monthKey: string) {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return undefined;
  }
  const end = new Date(year, month, 0);
  const endYear = end.getFullYear();
  const endMonth = String(end.getMonth() + 1).padStart(2, "0");
  const endDay = String(end.getDate()).padStart(2, "0");
  return `${endYear}-${endMonth}-${endDay}`;
}

function addValue(values: unknown[], value: unknown) {
  values.push(value);
  return `$${values.length}`;
}

function getSelectedYearCondition(selectedYear: string | undefined, values: unknown[]) {
  if (!selectedYear) return undefined;
  if (selectedYear === allActiveFilesYear) {
    return `(not ${fileClosedExpression()}
      and lower(coalesce(f.demand_cancelled, '')) <> 'yes')`;
  }

  const placeholder = addValue(values, selectedYear);
  return `(f.year = ${placeholder}::text or exists (
    select 1 from file_year_activity a
    where a.file_id = f.id and a.financial_year = ${placeholder}::text and a.status = 'active'
  ))`;
}

function getReportWhereSql({
  scopeSql,
  scopeValues,
  selectedYear,
  division,
  fileCategories,
}: {
  scopeSql: string;
  scopeValues: unknown[];
  selectedYear: string | undefined;
  division: string;
  fileCategories: FileCategoryKey[];
}) {
  const values = [...scopeValues];
  const conditions: string[] = [];
  if (scopeSql) conditions.push(scopeSql);
  const selectedYearCondition = getSelectedYearCondition(selectedYear, values);
  if (selectedYearCondition) conditions.push(selectedYearCondition);
  if (division !== "all") {
    const placeholder = addValue(values, division.toLowerCase());
    conditions.push(`lower(coalesce(d.name, '')) = ${placeholder}::text`);
  }
  conditions.push(getFileCategoryCondition(fileCategories));
  return {
    whereSql: conditions.length ? `where ${conditions.join(" and ")}` : "",
    values,
  };
}

function getFileCategoryCondition(categories: FileCategoryKey[]) {
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

function appendReportWhereClause(whereSql: string, extraConditions: string[] = []) {
  const conditions = ["f.archived_at is null", ...extraConditions];
  if (!whereSql.trim()) return `where ${conditions.join(" and ")}`;
  return `${whereSql} and ${conditions.join(" and ")}`;
}

function countFilter(condition: string) {
  return `count(*) filter (where ${condition})::integer`;
}

function isYesExpression(column: string) {
  return `lower(coalesce(${column}, '')) = 'yes'`;
}

function isNoExpression(column: string) {
  return `lower(coalesce(${column}, '')) = 'no'`;
}

function bidOpeningOverdueExpression() {
  return `${isNoExpression("f.bid_opened")} and (case when ${isYesExpression(
    "f.refloat",
  )} and f.refloat_bid_opening_date is not null then f.refloat_bid_opening_date else f.bid_opening_date end) < current_date`;
}

function hasFilledExpression(column: string) {
  return `coalesce(${column}::text, '') <> ''`;
}

function supplyOrderExists(condition: string) {
  return `exists (
    select 1 from supply_orders so_check
    where so_check.file_id = f.id and ${condition.replaceAll("so.", "so_check.")}
  )`;
}

function supplyOrderRowExists() {
  return `exists (select 1 from supply_orders so_existing where so_existing.file_id = f.id)`;
}

function supplyOrderChildOrLegacyExpression(childCondition: string, _legacyCondition: string) {
  return supplyOrderExists(childCondition);
}

function effectiveDpDateExpression(alias: string) {
  return `greatest(coalesce(${alias}.revised_dp, ${alias}.dp_date), coalesce(${alias}.dp_date, ${alias}.revised_dp))`;
}

function isCancelledExpression() {
  return `(${isYesExpression("f.demand_cancelled")}
    or (${supplyOrderRowExists()} and not exists (
      select 1 from supply_orders so_active
      where so_active.file_id = f.id
        and not ${isYesExpression("so_active.so_cancelled")}
    )))`;
}

function inrAmountExpression(column: string) {
  const amount = `coalesce(nullif(regexp_replace(${column}::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)`;
  return `case
    when ${column} is null then 0
    when upper(trim(coalesce(f.currency, 'INR'))) in ('', 'INR') then ${amount}
    when f.exchange_rate > 0 then ${amount} * f.exchange_rate
    else 0
  end`;
}

function normalizeMilestoneExpression(column: string) {
  return `regexp_replace(lower(coalesce(${column}, '')), '[^a-z0-9]+', '', 'g')`;
}

function normalizeMilestoneName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function completedOrderMilestoneExpression(orderAlias: string, normalizedMilestone: string) {
  return `exists (
    select 1
    from jsonb_array_elements_text(coalesce(${orderAlias}.completed_milestones, '[]'::jsonb)) as completed_order(milestone)
    where ${normalizeMilestoneExpression("completed_order.milestone")} = '${normalizedMilestone}'
  )`;
}

function financialSanctionCompleteExpression() {
  return `not ${isCancelledExpression()} and (
    exists (
      select 1 from file_completed_milestones completed_financial_sanction
      where completed_financial_sanction.file_id = f.id
        and ${normalizeMilestoneExpression("completed_financial_sanction.milestone")} = 'financialsanction'
    )
    or ${supplyOrderExists(
      `not ${isYesExpression("so.so_cancelled")}
       and (${hasFilledExpression("so.financial_sanction_date")}
         or ${completedOrderMilestoneExpression("so", "financialsanction")})`,
    )}
  )`;
}

function fileClosedExpression() {
  return `exists (
    select 1 from file_completed_milestones completed_closed
    where completed_closed.file_id = f.id
      and ${normalizeMilestoneExpression("completed_closed.milestone")} = '${normalizeMilestoneName(
        fileClosedMilestone,
      )}'
  )`;
}

function reportAppliesExpression(milestone: (typeof reportMilestoneDefinitions)[number]) {
  return "appliesColumn" in milestone && milestone.appliesColumn
    ? isYesExpression(milestone.appliesColumn)
    : "true";
}

function reportCompleteExpression(milestone: (typeof reportMilestoneDefinitions)[number]) {
  if ("yesComplete" in milestone && milestone.yesComplete)
    return isYesExpression(milestone.currentColumn);
  if ("supplyOrderDate" in milestone && milestone.supplyOrderDate) {
    if (milestone.key === "financialSanction") return financialSanctionCompleteExpression();
    if (milestone.key === "bankGuarantee") {
      return supplyOrderChildOrLegacyExpression(
        `(${hasFilledExpression(`so.${milestone.supplyOrderDate}`)}
          or ${completedOrderMilestoneExpression("so", "bankguarantee")})`,
        hasFilledExpression(`f.${milestone.supplyOrderDate}`),
      );
    }
    return supplyOrderChildOrLegacyExpression(
      hasFilledExpression(`so.${milestone.supplyOrderDate}`),
      hasFilledExpression(`f.${milestone.supplyOrderDate}`),
    );
  }
  return "currentColumn" in milestone && milestone.currentColumn
    ? hasFilledExpression(milestone.currentColumn)
    : "false";
}

function reportReviewedExpression(milestone: (typeof reportMilestoneDefinitions)[number]) {
  return "reviewedColumn" in milestone && milestone.reviewedColumn
    ? hasFilledExpression(milestone.reviewedColumn)
    : "false";
}

function reportActiveExpression(milestone: (typeof reportMilestoneDefinitions)[number]) {
  if (milestone.key === "financialSanction") {
    return `not ${isCancelledExpression()} and (
      ${normalizeMilestoneExpression("f.current_milestone")} = 'financialsanction'
      or ${supplyOrderExists(
        `not ${isYesExpression("so.so_cancelled")}
         and ${normalizeMilestoneExpression("so.current_milestone")} = 'financialsanction'`,
      )}
    )`;
  }
  if (milestone.key === "bankGuarantee") {
    return `not ${isCancelledExpression()} and ${supplyOrderExists(
      `not ${isYesExpression("so.so_cancelled")}
       and ${normalizeMilestoneExpression("so.current_milestone")} = 'bankguarantee'`,
    )}`;
  }
  const aliases =
    "aliases" in milestone && milestone.aliases ? milestone.aliases : [milestone.label];
  const normalizedAliases = aliases.map((alias) => `'${normalizeMilestoneName(alias)}'`).join(", ");
  return `not ${isCancelledExpression()}
    and ${normalizeMilestoneExpression("f.current_milestone")} in (${normalizedAliases})`;
}

function previousApplicableCompleteExpression(index: number) {
  const previous = reportMilestoneDefinitions.slice(0, index).reverse();
  if (!previous.length) return hasFilledExpression("f.received_date");
  return `case
    ${previous
      .map(
        (milestone) =>
          `when ${reportAppliesExpression(milestone)} then ${reportCompleteExpression(milestone)}`,
      )
      .join("\n    ")}
    else ${hasFilledExpression("f.received_date")}
  end`;
}

function supplyOrderPlacedExpression() {
  return supplyOrderChildOrLegacyExpression(
    hasFilledExpression("so.so_date"),
    hasFilledExpression("f.so_date"),
  );
}

function deliveryDueOrderExpression(extraCondition = "true") {
  return supplyOrderChildOrLegacyExpression(
    `${hasFilledExpression("so.so_date")}
     and not ${hasFilledExpression("so.material_receipt_date")}
     and not ${isYesExpression("so.so_cancelled")}
     and ${extraCondition}`,
    `${hasFilledExpression("f.so_date")}
     and not ${hasFilledExpression("f.material_receipt_date")}
     and not ${isYesExpression("f.so_cancelled")}
     and ${extraCondition.replaceAll("so.", "f.")}`,
  );
}

function deliveryPendingOrderExpression() {
  return deliveryDueOrderExpression(
    `${effectiveDpDateExpression("so")} is not null
     and so.so_date <= current_date
     and ${effectiveDpDateExpression("so")} >= current_date`,
  );
}

function bankGuaranteeEligibleExpression() {
  return `not ${isCancelledExpression()}
    and ${isYesExpression("f.bg")}
    and ${supplyOrderChildOrLegacyExpression(
      `${hasFilledExpression("so.so_date")} and not ${isYesExpression("so.so_cancelled")}`,
      `${hasFilledExpression("f.so_date")} and not ${isYesExpression("f.so_cancelled")}`,
    )}`;
}

function earliestSupplyOrderDateExpression(column: string) {
  return `case
    when ${supplyOrderRowExists()} then (
      select min(so_date_value.${column})
      from supply_orders so_date_value
      where so_date_value.file_id = f.id and so_date_value.${column} is not null
    )
    else f.${column}
  end`;
}

function formatMonthExpression(column: string) {
  return `to_char(${column}, 'Mon-YYYY')`;
}

function isStatusSummaryColumn(stage: string) {
  return [
    "Total files",
    "Total cases",
    "Placed",
    "Received",
    "Reviewed",
    "Pending",
    "To be returned",
    "In process",
    "Opening overdue",
    "Live",
    "Completed",
    "Overdue",
    "Valid",
    "Expired",
    "Extended",
  ].includes(stage);
}

function getStatusSummaryColumnsForRow(columns: string[]) {
  const statusSummaryColumns = [
    "Total files",
    "Total cases",
    "Placed",
    "Received",
    "Reviewed",
    "Pending",
    "To be returned",
    "In process",
    "Opening overdue",
    "Live",
    "Completed",
    "Overdue",
    "Valid",
    "Expired",
    "Extended",
  ];
  if (columns.includes("Opening overdue")) {
    return ["Live", "In process", "Opening overdue", "Completed"].filter((column) =>
      columns.includes(column),
    );
  }
  if (columns.includes("Overdue") && columns.includes("Completed")) {
    return ["Completed", "Pending", "Overdue"].filter((column) => columns.includes(column));
  }
  if (columns.length === 2 && columns.includes("Completed") && columns.includes("Pending")) {
    return ["Completed", "Pending"];
  }
  return statusSummaryColumns.filter((column) => columns.includes(column));
}

function getStatusSummaryGroupTitle(columns: string[]) {
  if (columns.includes("Total cases")) return "Case approval milestones";
  if (columns.includes("Reviewed")) return "File approval milestones";
  if (columns.includes("Opening overdue")) return "Bidding";
  if (columns.includes("Placed")) return "Supply Order";
  if (columns.includes("Received")) return "Bank Guarantee";
  if (columns.includes("Valid")) return "Delivery Period";
  if (columns.includes("Overdue")) {
    return "Delivery";
  }
  if (columns.length === 2 && columns.includes("Completed") && columns.includes("Pending")) {
    return "Payment";
  }
  return "Other milestones";
}

function buildStatusSummaryGroups(
  rows: Array<{ milestone: string; stage: string; count: number }>,
) {
  const byMilestone = new Map<string, StatusSummaryTableRow & { columns: string[] }>();
  rows.forEach((row) => {
    if (!isStatusSummaryColumn(row.stage)) return;
    const tableRow = byMilestone.get(row.milestone) ?? {
      milestone: row.milestone,
      counts: {},
      columns: [],
    };
    tableRow.counts[row.stage] = row.count;
    if (!tableRow.columns.includes(row.stage)) tableRow.columns.push(row.stage);
    byMilestone.set(row.milestone, tableRow);
  });
  const commonGroup: StatusSummaryTableGroup = {
    key: "common",
    title: "Common milestone status",
    columns: ["Total", "In process", "Pending", "Completed"],
    rows: [],
  };
  const groups = new Map<string, StatusSummaryTableGroup>();
  Array.from(byMilestone.values()).forEach((row) => {
    const columns = getStatusSummaryColumnsForRow(row.columns);
    const isCommon =
      (row.columns.includes("Total files") || row.columns.includes("Total cases")) &&
      row.columns.includes("In process") &&
      row.columns.includes("Completed");
    if (isCommon) {
      commonGroup.rows.push({
        milestone: row.milestone,
        counts: {
          Total: row.counts["Total files"] ?? row.counts["Total cases"],
          "In process": row.counts["In process"],
          Completed: row.counts.Completed,
          Pending: row.counts.Pending ?? "-",
        },
      });
      return;
    }
    const key = columns.join("|");
    const group = groups.get(key) ?? {
      key,
      title: getStatusSummaryGroupTitle(columns),
      columns,
      rows: [],
    };
    group.rows.push({ milestone: row.milestone, counts: row.counts });
    groups.set(key, group);
  });
  return [...(commonGroup.rows.length ? [commonGroup] : []), ...Array.from(groups.values())];
}

async function loadReportFileCount(whereSql: string, values: unknown[]) {
  const result = await pool.query<{ count: number }>(
    `select count(*)::integer as count
     from files f
     left join divisions d on d.id = f.division_id
     ${appendReportWhereClause(whereSql, [`not ${isCancelledExpression()}`])}`,
    values,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function loadStatusSummaryGroups(whereSql: string, values: unknown[]) {
  const selects: string[] = [];
  const addRow = (milestone: string, stage: string, condition: string) => {
    selects.push(
      `select '${milestone}' as milestone, '${stage}' as stage, ${countFilter(condition)} as count
       from files f
       left join divisions d on d.id = f.division_id
       ${appendReportWhereClause(whereSql)}`,
    );
  };
  reportMilestoneDefinitions.forEach((milestone, index) => {
    const applies = reportAppliesExpression(milestone);
    const process = `${applies} and not ${isCancelledExpression()}`;
    const complete = reportCompleteExpression(milestone);
    const reached = previousApplicableCompleteExpression(index);
    const active = `${process} and ${reportActiveExpression(milestone)}`;
    const reviewed = reportReviewedExpression(milestone);
    const pending =
      "reviewedColumn" in milestone && milestone.reviewedColumn
        ? `${active} and not (${reviewed}) and not (${complete})`
        : `${active} and not (${complete})`;

    if (milestone.key === "bankGuarantee") {
      const eligible = bankGuaranteeEligibleExpression();
      addRow(milestone.label, "Received", `${eligible} and ${complete}`);
      addRow(
        milestone.label,
        "Pending",
        `${eligible} and ${reportActiveExpression(milestone)} and not (${complete})`,
      );
      addRow(
        milestone.label,
        "Expired",
        `${isYesExpression("f.bg")} and ${supplyOrderChildOrLegacyExpression(
          `${hasFilledExpression("so.bg_validity_date")}
            and not ${hasFilledExpression("so.bg_return_date")}
            and not ${hasFilledExpression("so.payment_date")}
            and not ${isYesExpression("so.so_cancelled")}
            and ${effectiveDpDateExpression("so")} is not null
            and so.bg_validity_date < ${effectiveDpDateExpression("so")}
            and so.bg_validity_date < current_date`,
          "false",
        )}`,
      );
      addRow(
        milestone.label,
        "To be returned",
        `${isYesExpression("f.bg")} and ${supplyOrderChildOrLegacyExpression(
          `${hasFilledExpression("so.bg_validity_date")}
            and not ${hasFilledExpression("so.bg_return_date")}
            and (
              ${isYesExpression("so.so_cancelled")}
              or (
                not ${isYesExpression("so.so_cancelled")}
                and ${hasFilledExpression("so.payment_date")}
                and (${isYesExpression("f.psb")} or so.bg_validity_date < current_date)
              )
            )`,
          "false",
        )}`,
      );
      addRow(
        milestone.label,
        "At previous stage",
        `${process} and not (${supplyOrderPlacedExpression()})`,
      );
      return;
    }
    if (milestone.key === "payment") {
      addRow(milestone.label, "Completed", `${process} and ${complete}`);
      addRow(milestone.label, "Pending", pending);
      addRow(milestone.label, "At previous stage", `${process} and not (${reached})`);
      return;
    }
    if (milestone.key === "bidding") {
      const bidOverdue = bidOpeningOverdueExpression();
      addRow(milestone.label, "Completed", `${process} and ${complete}`);
      addRow(
        milestone.label,
        "In process",
        `${active} and not ${isYesExpression("f.tender_live")} and not (${bidOverdue})`,
      );
      addRow(milestone.label, "Opening overdue", `${applies} and ${bidOverdue}`);
      addRow(milestone.label, "Live", `${applies} and ${isYesExpression("f.tender_live")}`);
      addRow(milestone.label, "At previous stages", `${applies} and not (${reached})`);
      return;
    }
    if (milestone.key === "supplyOrder") {
      addRow(milestone.label, "Placed", `${process} and ${complete}`);
      addRow(milestone.label, "Live", deliveryDueOrderExpression());
      addRow(milestone.label, "Pending", pending);
      addRow(milestone.label, "At previous stages", `${applies} and not (${reached})`);
      return;
    }
    if (milestone.key === "scrutiny" || milestone.key === "cfa") {
      addRow(milestone.label, "In process", active);
      addRow(milestone.label, "Reviewed", `${active} and ${reviewed} and not (${complete})`);
      addRow(milestone.label, "Pending", pending);
      addRow(milestone.label, "Total files", applies);
      addRow(milestone.label, "Completed", `${process} and ${complete}`);
      return;
    }
    if (["highValue", "tcec", "ifa", "postTcec", "cnc"].includes(milestone.key)) {
      addRow(milestone.label, milestone.totalLabel ?? "Total", applies);
      addRow(milestone.label, "Completed", `${process} and ${complete}`);
      addRow(milestone.label, "At previous stage", `${applies} and not (${reached})`);
      addRow(milestone.label, "In process", active);
      addRow(milestone.label, "Reviewed", `${active} and ${reviewed} and not (${complete})`);
      addRow(milestone.label, "Pending", pending);
      return;
    }
    addRow(milestone.label, milestone.totalLabel ?? "Total", applies);
    addRow(milestone.label, "Completed", `${process} and ${complete}`);
    addRow(milestone.label, "In process", active);
    addRow(milestone.label, "At previous stage", `${applies} and not (${reached})`);
  });

  addRow(
    "Delivery Period",
    "Valid",
    `not ${isCancelledExpression()} and ${supplyOrderChildOrLegacyExpression(
      `${hasFilledExpression("so.so_date")} and so.so_date <= current_date and ${effectiveDpDateExpression("so")} is not null and ${effectiveDpDateExpression("so")} >= current_date and not ${hasFilledExpression("so.revised_dp")} and not ${hasFilledExpression("so.material_receipt_date")} and not ${isYesExpression("so.so_cancelled")}`,
      `${hasFilledExpression("f.so_date")} and f.so_date <= current_date and ${effectiveDpDateExpression("f")} is not null and ${effectiveDpDateExpression("f")} >= current_date and not ${hasFilledExpression("f.revised_dp")} and not ${hasFilledExpression("f.material_receipt_date")}`,
    )}`,
  );
  addRow(
    "Delivery Period",
    "Expired",
    `not ${isCancelledExpression()} and ${supplyOrderChildOrLegacyExpression(
      `${hasFilledExpression("so.so_date")} and ${effectiveDpDateExpression("so")} is not null and ${effectiveDpDateExpression("so")} < current_date and not ${hasFilledExpression("so.revised_dp")} and not ${hasFilledExpression("so.material_receipt_date")} and not ${isYesExpression("so.so_cancelled")}`,
      `${hasFilledExpression("f.so_date")} and ${effectiveDpDateExpression("f")} is not null and ${effectiveDpDateExpression("f")} < current_date and not ${hasFilledExpression("f.material_receipt_date")}`,
    )}`,
  );
  addRow(
    "Delivery Period",
    "Extended",
    `not ${isCancelledExpression()} and ${supplyOrderChildOrLegacyExpression(
      `${hasFilledExpression("so.so_date")} and so.so_date <= current_date and ${hasFilledExpression("so.revised_dp")} and ${effectiveDpDateExpression("so")} is not null and ${effectiveDpDateExpression("so")} >= current_date and not ${hasFilledExpression("so.material_receipt_date")} and not ${isYesExpression("so.so_cancelled")}`,
      `${hasFilledExpression("f.so_date")} and f.so_date <= current_date and ${hasFilledExpression("f.revised_dp")} and ${effectiveDpDateExpression("f")} is not null and ${effectiveDpDateExpression("f")} >= current_date and not ${hasFilledExpression("f.material_receipt_date")}`,
    )}`,
  );
  addRow(
    "Delivery",
    "Completed",
    `${supplyOrderPlacedExpression()} and ${supplyOrderChildOrLegacyExpression(
      `${hasFilledExpression("so.so_date")} and ${hasFilledExpression("so.material_receipt_date")}`,
      `${hasFilledExpression("f.so_date")} and ${hasFilledExpression("f.material_receipt_date")}`,
    )}`,
  );
  addRow(
    "Delivery",
    "Pending",
    `not ${isCancelledExpression()} and ${supplyOrderPlacedExpression()} and ${deliveryPendingOrderExpression()}`,
  );
  addRow(
    "Delivery",
    "Overdue",
    `${supplyOrderPlacedExpression()} and ${deliveryDueOrderExpression(
      `${effectiveDpDateExpression("so")} < current_date`,
    )}`,
  );

  const result = await pool.query<{ milestone: string; stage: string; count: number }>(
    selects.join("\nunion all\n"),
    values,
  );
  return buildStatusSummaryGroups(result.rows);
}

async function loadCashOutgoRows(
  whereSql: string,
  values: unknown[],
  mode:
    | "expectedDp"
    | "expectedReceipt"
    | "expectedReceiptPendingBill"
    | "billPreparation"
    | "billSent"
    | "actual",
  expectedCashOutgoDays = 0,
  dateRange?: { fromDate: string; toDate: string },
  asOfDate?: string,
): Promise<CashOutgoRow[]> {
  const queryValues = [...values];
  const usesExpectedOffset =
    mode === "expectedDp" || mode === "expectedReceipt" || mode === "expectedReceiptPendingBill";
  const expectedDaysPlaceholder = usesExpectedOffset
    ? addValue(queryValues, expectedCashOutgoDays)
    : undefined;
  const receiptBaseDateExpression = `case
    when lower(coalesce(effective.file_type, '')) in ('amc', 'mpc', 'cars', 'o&m')
    then (coalesce(effective.revised_dp, effective.dp_date) + interval '1 day')::date
    else effective.material_receipt_date
  end`;
  const receiptPendingBillBaseDateExpression = receiptBaseDateExpression;
  const nonDeliveryFileTypeExpression =
    "lower(coalesce(effective.file_type, '')) in ('amc', 'mpc', 'cars', 'o&m')";
  const billPreparationBaseDateExpression = receiptPendingBillBaseDateExpression;
  const dateExpression = (() => {
    if (mode === "expectedDp") {
      return `(coalesce(effective.revised_dp, effective.dp_date) + ((${expectedDaysPlaceholder}::integer + 1) * interval '1 day'))::date`;
    }
    if (mode === "expectedReceipt") {
      return `(${receiptBaseDateExpression} + (${expectedDaysPlaceholder}::integer * interval '1 day'))::date`;
    }
    if (mode === "expectedReceiptPendingBill") {
      return `(${receiptPendingBillBaseDateExpression} + (${expectedDaysPlaceholder}::integer * interval '1 day'))::date`;
    }
    if (mode === "billPreparation") return "effective.bill_preparation_date";
    if (mode === "billSent") return "effective.bill_sent_for_payment_date";
    return "effective.payment_date";
  })();
  const fromDatePlaceholder = dateRange ? addValue(queryValues, dateRange.fromDate) : undefined;
  const toDatePlaceholder = dateRange ? addValue(queryValues, dateRange.toDate) : undefined;
  const asOfDatePlaceholder = asOfDate ? addValue(queryValues, asOfDate) : undefined;
  const extraCondition = (() => {
    if (mode === "expectedDp") {
      if (asOfDatePlaceholder) {
        return `coalesce(effective.revised_dp, effective.dp_date) is not null
          and not effective.so_cancelled_yes
          and (
            (
              ${nonDeliveryFileTypeExpression}
              and (effective.bill_preparation_date is null or effective.bill_preparation_date > ${asOfDatePlaceholder}::date)
              and (effective.bill_sent_for_payment_date is null or effective.bill_sent_for_payment_date > ${asOfDatePlaceholder}::date)
              and (effective.payment_date is null or effective.payment_date > ${asOfDatePlaceholder}::date)
            )
            or (
              not ${nonDeliveryFileTypeExpression}
              and (effective.material_receipt_date is null or effective.material_receipt_date > ${asOfDatePlaceholder}::date)
              and (effective.payment_date is null or effective.payment_date > ${asOfDatePlaceholder}::date)
            )
          )`;
      }
      return `coalesce(effective.revised_dp, effective.dp_date) is not null
        and not effective.so_cancelled_yes
        and (
          (
            ${nonDeliveryFileTypeExpression}
            and effective.bill_preparation_date is null
            and effective.bill_sent_for_payment_date is null
            and effective.payment_date is null
          )
          or (
            not ${nonDeliveryFileTypeExpression}
            and effective.material_receipt_date is null
            and effective.payment_date is null
          )
        )`;
    }
    if (mode === "expectedReceipt") {
      if (asOfDatePlaceholder) {
        return `${receiptBaseDateExpression} is not null
          and not effective.so_cancelled_yes
          and ${receiptBaseDateExpression} <= ${asOfDatePlaceholder}::date
          and (effective.payment_date is null or effective.payment_date > ${asOfDatePlaceholder}::date)`;
      }
      return `${receiptBaseDateExpression} is not null and not effective.so_cancelled_yes and effective.payment_date is null`;
    }
    if (mode === "expectedReceiptPendingBill") {
      if (toDatePlaceholder) {
        return `${receiptPendingBillBaseDateExpression} is not null
          and not effective.so_cancelled_yes
          and ${receiptPendingBillBaseDateExpression} <= ${toDatePlaceholder}::date
          and (effective.bill_preparation_date is null or effective.bill_preparation_date > ${toDatePlaceholder}::date)
          and (effective.payment_date is null or effective.payment_date > ${toDatePlaceholder}::date)`;
      }
      return `${receiptPendingBillBaseDateExpression} is not null and not effective.so_cancelled_yes and effective.bill_preparation_date is null and effective.payment_date is null`;
    }
    if (mode === "billPreparation") {
      if (asOfDatePlaceholder) {
        return `(effective.advance_payment_yes or ${billPreparationBaseDateExpression} is not null)
          and not effective.so_cancelled_yes
          and (effective.advance_payment_yes or ${billPreparationBaseDateExpression} <= ${asOfDatePlaceholder}::date)
          and effective.bill_preparation_date is not null
          and effective.bill_preparation_date <= ${asOfDatePlaceholder}::date
          and (effective.bill_sent_for_payment_date is null or effective.bill_sent_for_payment_date > ${asOfDatePlaceholder}::date)
          and (effective.payment_date is null or effective.payment_date > ${asOfDatePlaceholder}::date)`;
      }
      if (toDatePlaceholder) {
        return `(effective.advance_payment_yes or ${billPreparationBaseDateExpression} is not null)
          and not effective.so_cancelled_yes
          and (effective.advance_payment_yes or ${billPreparationBaseDateExpression} <= ${toDatePlaceholder}::date)
          and effective.bill_preparation_date is not null
          and effective.bill_preparation_date <= ${toDatePlaceholder}::date
          and (effective.bill_sent_for_payment_date is null or effective.bill_sent_for_payment_date > ${toDatePlaceholder}::date)
          and (effective.payment_date is null or effective.payment_date > ${toDatePlaceholder}::date)`;
      }
      return `(effective.advance_payment_yes or ${billPreparationBaseDateExpression} is not null) and not effective.so_cancelled_yes and effective.bill_preparation_date is not null and effective.bill_sent_for_payment_date is null and effective.payment_date is null`;
    }
    if (mode === "billSent") {
      if (asOfDatePlaceholder) {
        return `(effective.advance_payment_yes or ${billPreparationBaseDateExpression} is not null)
          and not effective.so_cancelled_yes
          and (effective.advance_payment_yes or ${billPreparationBaseDateExpression} <= ${asOfDatePlaceholder}::date)
          and effective.bill_preparation_date is not null
          and effective.bill_preparation_date <= ${asOfDatePlaceholder}::date
          and effective.bill_sent_for_payment_date is not null
          and effective.bill_sent_for_payment_date <= ${asOfDatePlaceholder}::date
          and (effective.payment_date is null or effective.payment_date > ${asOfDatePlaceholder}::date)`;
      }
      if (toDatePlaceholder) {
        return `(effective.advance_payment_yes or ${billPreparationBaseDateExpression} is not null)
          and not effective.so_cancelled_yes
          and (effective.advance_payment_yes or ${billPreparationBaseDateExpression} <= ${toDatePlaceholder}::date)
          and effective.bill_preparation_date is not null
          and effective.bill_preparation_date <= ${toDatePlaceholder}::date
          and effective.bill_sent_for_payment_date is not null
          and effective.bill_sent_for_payment_date <= ${toDatePlaceholder}::date
          and (effective.payment_date is null or effective.payment_date > ${toDatePlaceholder}::date)`;
      }
      return `(effective.advance_payment_yes or ${billPreparationBaseDateExpression} is not null) and not effective.so_cancelled_yes and effective.bill_preparation_date is not null and effective.bill_sent_for_payment_date is not null and effective.payment_date is null`;
    }
    return "effective.payment_date is not null and not effective.so_cancelled_yes";
  })();
  const dateRangeCondition =
    fromDatePlaceholder && toDatePlaceholder
      ? ` and ${dateExpression} between ${fromDatePlaceholder}::date and ${toDatePlaceholder}::date`
      : "";
  const result = await pool.query<{
    month_key: string;
    month: string;
    capital: string | number;
    revenue: string | number;
    total: string | number;
  }>(
    `with effective as (
       select
         f.id as file_id,
         f.file_type,
         so.so_date,
         coalesce(nullif(stage_row.stage ->> 'dpDate', '')::date, so.dp_date) as dp_date,
         coalesce(nullif(stage_row.stage ->> 'revisedDp', '')::date, so.revised_dp) as revised_dp,
         case
           when stage_row.stage is not null then nullif(stage_row.stage ->> 'materialReceiptDate', '')::date
           else so.material_receipt_date
         end as material_receipt_date,
         case
           when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
             then nullif(stage_row.stage ->> 'billPreparationDate', '')::date
           when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb))
             then so.bill_preparation_date
           when stage_row.stage is not null then null::date
           else so.bill_preparation_date
         end as bill_preparation_date,
         case
           when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
             then nullif(stage_row.stage ->> 'billSentForPaymentDate', '')::date
           when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb))
             then so.bill_sent_for_payment_date
           when stage_row.stage is not null then null::date
           else so.bill_sent_for_payment_date
         end as bill_sent_for_payment_date,
         case
           when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
             then nullif(stage_row.stage ->> 'paymentDate', '')::date
           when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb))
             then so.payment_date
           when stage_row.stage is not null then null::date
           else so.payment_date
         end as payment_date,
         so.so_cancelled_date,
         ${isYesExpression("so.so_cancelled")} as so_cancelled_yes,
         ${isYesExpression("so.advance_payment")} as advance_payment_yes,
         case
           when stage_row.stage is not null then ${inrAmountExpression("stage_row.stage ->> 'stageAmountCapital'")}
           else ${inrAmountExpression("so.so_value_capital")}
         end as capital,
         case
           when stage_row.stage is not null then ${inrAmountExpression("stage_row.stage ->> 'stageAmountRevenue'")}
           else ${inrAmountExpression("so.so_value_revenue")}
         end as revenue
       from files f
       left join divisions d on d.id = f.division_id
	       join supply_orders so on so.file_id = f.id
       left join lateral (
         select stage, ordinality
         from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) with ordinality as stages(stage, ordinality)
         where ${isYesExpression("so.stage_delivery")}
         union all
         select null::jsonb as stage, 1::bigint as ordinality
         where not ${isYesExpression("so.stage_delivery")}
           or jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) = 0
       ) stage_row on true
	       ${appendReportWhereClause(whereSql, [`not ${isCancelledExpression()}`])}
	     )
     select
       to_char(${dateExpression}, 'YYYY-MM') as month_key,
       ${formatMonthExpression(dateExpression)} as month,
       round(coalesce(sum(capital), 0))::integer as capital,
       round(coalesce(sum(revenue), 0))::integer as revenue,
       round(coalesce(sum(capital + revenue), 0))::integer as total
     from effective
     where ${extraCondition}${dateRangeCondition}
     group by 1, 2
     order by 1 asc`,
    queryValues,
  );
  return result.rows.map((row) => ({
    monthKey: row.month_key,
    month: row.month,
    capital: Number(row.capital ?? 0),
    revenue: Number(row.revenue ?? 0),
    total: Number(row.total ?? 0),
  }));
}

function delayStageStartExpression(
  milestone: (typeof reportMilestoneDefinitions)[number],
  index: number,
) {
  void milestone;
  const previousDateExpressions = reportMilestoneDefinitions
    .slice(0, index)
    .reverse()
    .map((previous) => {
      const applies = reportAppliesExpression(previous);
      const dateValue = reportDateValueExpression(previous);
      return `(case when ${applies} then ${dateValue} else null::date end)`;
    });
  return `coalesce(${[...previousDateExpressions, "f.received_date"].join(", ")})`;
}

function reportDateValueExpression(milestone: (typeof reportMilestoneDefinitions)[number]) {
  if (milestone.key === "bidding") return "coalesce(f.bid_opening_date, f.bid_date)";
  if ("yesComplete" in milestone && milestone.yesComplete) return "null::date";
  if ("supplyOrderDate" in milestone && milestone.supplyOrderDate) {
    return earliestSupplyOrderDateExpression(milestone.supplyOrderDate);
  }
  if ("currentColumn" in milestone && milestone.currentColumn) return milestone.currentColumn;
  return "null::date";
}

function lastFilledDateExpression() {
  return `(select max(date_value) from (values
    (f.received_date),
    (f.scrutiny_date),
    (f.scrutiny_response_date),
    (f.scrutiny_completion_date),
    (f.imms_date),
    (f.high_value_meeting_date),
    (f.high_value_minutes_date),
    (f.pre_tcec_date),
    (f.pre_tcec_minutes_date),
    (f.ad_vetting_date),
    (f.rqa_approval_date),
    (f.ifa_sent_date),
    (f.ifa_final_date),
    (f.cfa_sent_date),
    (f.cfa_date),
    (f.gem_undertaking_date),
    (f.rfp_vetting_initiation_date),
    (f.rfp_vetting_approval_date),
    (f.bid_date),
    (f.bid_opening_date),
    (f.refloat_bidding_date),
    (f.refloat_bid_opening_date),
    (f.post_tcec_date),
    (f.post_tcec_minutes_date),
    (f.cnc_date),
    (f.cnc_approval_date),
    (${earliestSupplyOrderDateExpression("so_date")}),
    (${earliestSupplyOrderDateExpression("dp_date")}),
    (${earliestSupplyOrderDateExpression("bg_validity_date")}),
    (${earliestSupplyOrderDateExpression("revised_dp")}),
    (${earliestSupplyOrderDateExpression("material_receipt_date")}),
    (${earliestSupplyOrderDateExpression("ir_preparation_date")}),
    (${earliestSupplyOrderDateExpression("ir_receipt_date")}),
    (${earliestSupplyOrderDateExpression("bill_preparation_date")}),
    (${earliestSupplyOrderDateExpression("bill_sent_for_payment_date")}),
    (${earliestSupplyOrderDateExpression("payment_date")}),
    (${earliestSupplyOrderDateExpression("bg_return_date")}),
    (${earliestSupplyOrderDateExpression("so_cancelled_date")})
  ) as dates(date_value))`;
}

function jsonDateExpression(jsonAlias: string, key: string) {
  return `nullif(${jsonAlias} ->> '${key}', '')::date`;
}

function effectiveOrderDateExpression(column: string, jsonKey: string) {
  return `coalesce(${jsonDateExpression("stage_row.stage", jsonKey)}, so.${column})`;
}

function effectiveOrderDelayRowsSource(supplyOrderStageStartDate: string, includeStages = true) {
  void supplyOrderStageStartDate;
  const priorMainTimelineDate = delayStageStartExpression(
    reportMilestoneDefinitions.find((milestone) => milestone.key === "financialSanction") ??
      reportMilestoneDefinitions[0],
    reportMilestoneDefinitions.findIndex((milestone) => milestone.key === "financialSanction"),
  );
  const financialSanctionDate = effectiveOrderDateExpression(
    "financial_sanction_date",
    "financialSanctionDate",
  );
  const soDate = effectiveOrderDateExpression("so_date", "soDate");
  const dpDate = effectiveOrderDateExpression("dp_date", "dpDate");
  const revisedDp = effectiveOrderDateExpression("revised_dp", "revisedDp");
  const materialReceiptDate = effectiveOrderDateExpression(
    "material_receipt_date",
    "materialReceiptDate",
  );
  const irReceiptDate = effectiveOrderDateExpression("ir_receipt_date", "irReceiptDate");
  const advancePaymentDate = `case
    when nullif(so.advance_payment_detail ->> 'paymentDate', '') is not null
      then nullif(so.advance_payment_detail ->> 'paymentDate', '')::date
    when exists (
      select 1
      from jsonb_array_elements_text(coalesce(so.advance_payment_detail -> 'completedMilestones', '[]'::jsonb)) as advance_completed(milestone)
      where ${normalizeMilestoneExpression("advance_completed.milestone")} = 'advancepayment'
    ) then '9999-12-31'::date
    else null::date
  end`;
  return `(select
      so.so_no,
      so.gem_so_no,
      coalesce(
        so.sort_order,
        row_number() over (order by coalesce(so.sort_order, 2147483647), so.id) - 1
      )::integer as sort_order,
      stage_row.stage_index,
      coalesce(
        stage_row.stage ->> 'currentMilestone',
        so.current_milestone
      ) as current_milestone,
      stage_row.stage ->> 'currentMilestone' as stage_current_milestone,
      so.advance_payment_detail ->> 'currentMilestone' as advance_current_milestone,
      so.current_milestone as order_current_milestone,
      so.advance_payment,
      ${financialSanctionDate} as financial_sanction_date,
      ${soDate} as so_date,
      ${effectiveOrderDateExpression("bg_validity_date", "bgValidityDate")} as bg_validity_date,
      ${priorMainTimelineDate} as financial_sanction_start_date,
      coalesce(${financialSanctionDate}, ${priorMainTimelineDate}) as supply_order_start_date,
      coalesce(${soDate}, ${financialSanctionDate}, ${priorMainTimelineDate}) as bank_guarantee_start_date,
      coalesce(${soDate}, ${financialSanctionDate}, ${priorMainTimelineDate}) as delivery_start_date,
      ${materialReceiptDate} as material_receipt_date,
      ${materialReceiptDate} as ir_preparation_start_date,
      ${effectiveOrderDateExpression("ir_preparation_date", "irPreparationDate")} as ir_preparation_date,
      ${effectiveOrderDateExpression("ir_preparation_date", "irPreparationDate")} as ir_receipt_start_date,
      ${irReceiptDate} as ir_receipt_date,
      coalesce(${irReceiptDate}, ${materialReceiptDate}) as bill_preparation_start_date,
      ${effectiveOrderDateExpression("bill_preparation_date", "billPreparationDate")} as bill_preparation_date,
      ${effectiveOrderDateExpression("bill_preparation_date", "billPreparationDate")} as bill_sent_for_payment_start_date,
      ${effectiveOrderDateExpression(
        "bill_sent_for_payment_date",
        "billSentForPaymentDate",
      )} as bill_sent_for_payment_date,
      ${soDate} as advance_payment_start_date,
      ${advancePaymentDate} as advance_payment_date,
      ${effectiveOrderDateExpression(
        "bill_sent_for_payment_date",
        "billSentForPaymentDate",
      )} as payment_start_date,
      ${effectiveOrderDateExpression("payment_date", "paymentDate")} as payment_date,
      (select max(date_value) from (values
        (f.received_date),
        (f.scrutiny_date),
        (f.scrutiny_response_date),
        (f.scrutiny_completion_date),
        (f.imms_date),
        (f.high_value_meeting_date),
        (f.high_value_minutes_date),
        (f.pre_tcec_date),
        (f.pre_tcec_minutes_date),
        (f.ad_vetting_date),
        (f.rqa_approval_date),
        (f.ifa_sent_date),
        (f.ifa_final_date),
        (f.cfa_sent_date),
        (f.cfa_date),
        (f.gem_undertaking_date),
        (f.rfp_vetting_initiation_date),
        (f.rfp_vetting_approval_date),
        (f.bid_date),
        (f.bid_opening_date),
        (f.refloat_bidding_date),
        (f.refloat_bid_opening_date),
        (f.post_tcec_date),
        (f.post_tcec_minutes_date),
        (f.cnc_date),
        (f.cnc_approval_date),
        (${effectiveOrderDateExpression("financial_sanction_date", "financialSanctionDate")}),
        (${effectiveOrderDateExpression("so_date", "soDate")}),
        (${dpDate}),
        (${effectiveOrderDateExpression("bg_validity_date", "bgValidityDate")}),
        (${revisedDp}),
        (${materialReceiptDate}),
        (${effectiveOrderDateExpression("ir_preparation_date", "irPreparationDate")}),
        (${irReceiptDate}),
        (${effectiveOrderDateExpression("bill_preparation_date", "billPreparationDate")}),
        (${effectiveOrderDateExpression("bill_sent_for_payment_date", "billSentForPaymentDate")}),
        (nullif(so.advance_payment_detail ->> 'paymentDate', '')::date),
        (${effectiveOrderDateExpression("payment_date", "paymentDate")})
      ) as dates(date_value)) as last_filled_date,
      so.so_cancelled
    from supply_orders so
    left join lateral jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) with ordinality as stage_row(stage, stage_index)
      on ${includeStages ? "jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0" : "false"}
    where so.file_id = f.id)`;
}

function orderDelayRowsSelects(
  whereSql: string,
  selectedMilestoneKey: string,
  thresholdPlaceholder: string,
) {
  const supplyOrderIndex = reportMilestoneDefinitions.findIndex((item) => item.key === "supplyOrder");
  const supplyOrderStageStartDate = delayStageStartExpression(
    reportMilestoneDefinitions[supplyOrderIndex],
    supplyOrderIndex,
  );
  const lastFilled = lastFilledDateExpression();
  return orderDelayMilestoneDefinitions
    .filter((milestone) => selectedMilestoneKey === "all" || milestone.key === selectedMilestoneKey)
    .map((milestone) => {
      const source = effectiveOrderDelayRowsSource(
        supplyOrderStageStartDate,
        milestone.key !== "financialSanction" && milestone.key !== "advancePayment",
      );
      const startDate = `effective_order.${milestone.startColumn}`;
      const completeDate = `effective_order.${milestone.completeColumn}`;
      const applies =
        "appliesCondition" in milestone && milestone.appliesCondition
          ? milestone.appliesCondition()
          : "true";
      const baseFileRef =
        "coalesce(nullif(f.file_no, ''), nullif(f.unique_code, ''), nullif(f.title, ''), f.id::text)";
      const orderRef =
        "coalesce(nullif(effective_order.so_no, ''), nullif(effective_order.gem_so_no, ''), 'S.O. ' || (effective_order.sort_order + 1)::text)";
      const focusTarget = `('${milestone.current}:pending:' || effective_order.sort_order::text ||
        case
          when effective_order.stage_index is not null
            and ${normalizeMilestoneExpression("effective_order.stage_current_milestone")} = '${milestone.current}'
          then ':' || (effective_order.stage_index - 1)::text
          else ''
        end)`;
      const currentMilestoneExpression =
        milestone.key === "advancePayment"
          ? "effective_order.advance_current_milestone"
          : ["financialSanction", "supplyOrder", "bankGuarantee"].includes(milestone.key)
            ? "effective_order.order_current_milestone"
            : "effective_order.current_milestone";
      return `select
          f.id::text as "fileId",
          (${baseFileRef} || ' / ' || ${orderRef}) as "fileRef",
          coalesce(d.name, '') as division,
          coalesce(f.indentor, '') as indentor,
          coalesce(f.demand_description, '') as description,
          '${milestone.key}' as "milestoneKey",
          '${milestone.label}' as milestone,
          (${startDate})::text as "stageStartDate",
          (current_date - (${startDate})::date)::integer as "daysInStage",
          coalesce((${lastFilled})::text, '') as "lastFilledDate",
          'Supply order and payment' as "focusSection",
          ${focusTarget} as "focusTarget"
        from files f
        left join divisions d on d.id = f.division_id
        join lateral ${source} effective_order on true
        ${appendReportWhereClause(whereSql, [
          `not ${isYesExpression("f.demand_cancelled")}`,
          `not ${isYesExpression("effective_order.so_cancelled")}`,
          applies,
          `${normalizeMilestoneExpression(currentMilestoneExpression)} = '${milestone.current}'`,
          `${completeDate} is null`,
          `${startDate} is not null`,
          `(current_date - (${startDate})::date) > ${thresholdPlaceholder}::integer`,
        ])}`;
    });
}

async function loadDelayRows(
  whereSql: string,
  values: unknown[],
  thresholdDays: number,
  selectedMilestoneKey: string,
): Promise<DelayStatusRow[]> {
  const thresholdPlaceholder = addValue(values, thresholdDays);
  const fileSelects = reportMilestoneDefinitions
    .filter((milestone) => selectedMilestoneKey === "all" || milestone.key === selectedMilestoneKey)
    .map((milestone) => {
      const index = reportMilestoneDefinitions.findIndex((item) => item.key === milestone.key);
      const startDate = delayStageStartExpression(milestone, index);
      const complete = reportCompleteExpression(milestone);
      const active = reportActiveExpression(milestone);
      const lastFilled = lastFilledDateExpression();
      return `select
          f.id::text as "fileId",
          coalesce(nullif(f.file_no, ''), nullif(f.unique_code, ''), nullif(f.title, ''), f.id::text) as "fileRef",
          coalesce(d.name, '') as division,
          coalesce(f.indentor, '') as indentor,
          coalesce(f.demand_description, '') as description,
          '${milestone.key}' as "milestoneKey",
          '${milestone.label}' as milestone,
          (${startDate})::text as "stageStartDate",
          (current_date - (${startDate})::date)::integer as "daysInStage",
          coalesce((${lastFilled})::text, '') as "lastFilledDate",
          'Milestones' as "focusSection",
          null::text as "focusTarget"
        from files f
        left join divisions d on d.id = f.division_id
        ${appendReportWhereClause(whereSql, [
          active,
          `not (${complete})`,
          `(${startDate}) is not null`,
          `(current_date - (${startDate})::date) > ${thresholdPlaceholder}::integer`,
        ])}`;
    });
  const orderSelects = orderDelayRowsSelects(whereSql, selectedMilestoneKey, thresholdPlaceholder);
  const selects = [...fileSelects, ...orderSelects];
  if (!selects.length) return [];
  const result = await pool.query<DelayStatusRow>(
    `${selects.join("\nunion all\n")}
     order by "daysInStage" desc, milestone asc`,
    values,
  );
  return result.rows.map((row) => ({
    ...row,
    daysInStage: Number(row.daysInStage ?? 0),
  }));
}

function getDelaySummary(rows: DelayStatusRow[]) {
  const totalDays = rows.reduce((sum, row) => sum + row.daysInStage, 0);
  const counts = new Map<string, { key: string; label: string; count: number }>();
  rows.forEach((row) => {
    const current = counts.get(row.milestoneKey) ?? {
      key: row.milestoneKey,
      label: row.milestone,
      count: 0,
    };
    current.count += 1;
    counts.set(row.milestoneKey, current);
  });
  return {
    averageDays: rows.length ? Math.round(totalDays / rows.length) : 0,
    longestDays: rows.reduce((max, row) => Math.max(max, row.daysInStage), 0),
    byMilestone: Array.from(counts.values()).sort((a, b) => b.count - a.count),
  };
}

async function buildReportsSummarySql({
  whereSql,
  values,
  division,
  delayDays,
  delayMilestone,
  expectedCashOutgoDays,
  historicalFromDate,
  historicalToDate,
  cashOutgoAsOfDate,
}: {
  whereSql: string;
  values: unknown[];
  division: string;
  delayDays: number;
  delayMilestone: string;
  expectedCashOutgoDays: number;
  historicalFromDate?: string;
  historicalToDate?: string;
  cashOutgoAsOfDate?: string;
}): Promise<ReportsSummaryPayload> {
  const historicalRange =
    historicalFromDate && historicalToDate && historicalFromDate <= historicalToDate
      ? { fromDate: historicalFromDate, toDate: historicalToDate }
      : undefined;
  const [
    reportFileCount,
    statusSummaryGroups,
    expectedCashOutgoDpRows,
    expectedCashOutgoReceiptRows,
    expectedCashOutgoReceiptPendingBillRows,
    expectedCashOutgoBillPreparationRows,
    billSentForPaymentRows,
    actualCashOutgoRows,
    delayRows,
  ] = await Promise.all([
    loadReportFileCount(whereSql, [...values]),
    loadStatusSummaryGroups(whereSql, [...values]),
    loadCashOutgoRows(
      whereSql,
      [...values],
      "expectedDp",
      expectedCashOutgoDays,
      undefined,
      cashOutgoAsOfDate,
    ),
    loadCashOutgoRows(
      whereSql,
      [...values],
      "expectedReceipt",
      expectedCashOutgoDays,
      undefined,
      cashOutgoAsOfDate,
    ),
    loadCashOutgoRows(
      whereSql,
      [...values],
      "expectedReceiptPendingBill",
      expectedCashOutgoDays,
      historicalRange,
    ),
    loadCashOutgoRows(
      whereSql,
      [...values],
      "billPreparation",
      0,
      historicalRange,
      cashOutgoAsOfDate,
    ),
    loadCashOutgoRows(whereSql, [...values], "billSent", 0, historicalRange, cashOutgoAsOfDate),
    loadCashOutgoRows(whereSql, [...values], "actual", 0, historicalRange),
    loadDelayRows(whereSql, [...values], delayDays, delayMilestone),
  ]);
  return {
    activeDivision: division,
    reportFileCount,
    statusSummaryGroups,
    expectedCashOutgoDpRows,
    expectedCashOutgoReceiptRows,
    expectedCashOutgoReceiptPendingBillRows,
    expectedCashOutgoBillPreparationRows,
    billSentForPaymentRows,
    actualCashOutgoRows,
    delayRows,
    delaySummary: getDelaySummary(delayRows),
  };
}

reportsRouter.get(
  "/summary",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const scope = getDivisionScopeCondition(user);
    const categoryScope = getFileCategoryScopeCondition(user);
    const settings = await loadSettings();
    const selectedYear = readString(request.query.selectedYear) ?? settings.selectedYear;
    const division = readString(request.query.division) ?? "all";
    const fileCategories = normalizeFileCategories(readList(request.query.fileCategories));
    const delayDays = readNonNegativeInteger(request.query.delayDays, 5);
    const delayMilestone = readString(request.query.delayMilestone) ?? "all";
    const expectedCashOutgoDays = readNonNegativeInteger(request.query.expectedCashOutgoDays, 0);
    const historicalFromDate = readDateString(request.query.historicalFromDate);
    const historicalToDate = readDateString(request.query.historicalToDate);
    const cashOutgoMonth = readMonthString(request.query.cashOutgoMonth);
    const cashOutgoAsOfDate = cashOutgoMonth ? getMonthEndDate(cashOutgoMonth) : undefined;
    const reportWhere = getReportWhereSql({
      scopeSql: [scope.sql, categoryScope.sql].filter(Boolean).join(" and "),
      scopeValues: scope.values,
      selectedYear,
      division,
      fileCategories,
    });
    const cacheKey = `reports:summary:${JSON.stringify({
      scope: getAuthScopeCacheKey(user),
      selectedYear,
      division,
      fileCategories,
      delayDays,
      delayMilestone,
      expectedCashOutgoDays,
      historicalFromDate,
      historicalToDate,
      cashOutgoAsOfDate,
    })}`;
    const summary = await getCached(cacheKey, cacheTtl.reportsSummaryMs, async () => {
      const combinedScopeSql = [scope.sql, categoryScope.sql].filter(Boolean).join(" and ");
      const files = await loadFiles(
        combinedScopeSql ? `where ${combinedScopeSql}` : "",
        scope.values,
      );
      const selectedYearFiles =
        selectedYear === allActiveFilesYear
          ? files.filter((file) => !isInactiveFile(file))
          : selectedYear
            ? files.filter((file) => isFileActiveInYear(file, selectedYear))
            : files;
      const categoryFiles = selectedYearFiles.filter((file) =>
        matchesFileCategorySelection(file, fileCategories),
      );
      const normalizedSummary = buildReportsSummary({
        files: categoryFiles,
        division,
        delayDays,
        delayMilestone,
        expectedCashOutgoDays,
        historicalFromDate,
        historicalToDate,
        cashOutgoAsOfDate,
      });

      if (process.env.REPORTS_SQL_COMPARE === "true") {
        const sqlSummary = await buildReportsSummarySql({
          whereSql: reportWhere.whereSql,
          values: reportWhere.values,
          division,
          delayDays,
          delayMilestone,
          expectedCashOutgoDays,
          historicalFromDate,
          historicalToDate,
          cashOutgoAsOfDate,
        });
        if (JSON.stringify(normalizedSummary) !== JSON.stringify(sqlSummary)) {
          console.warn("Reports SQL summary differs from TypeScript summary.", {
            reference: normalizedSummary,
            candidate: sqlSummary,
          });
        }
      }

      return normalizedSummary;
    });

    response.json({
      summary,
    });
  }),
);
