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

type MonthCountRow = { name: string; monthKey: string; count: number };
type MonthWiseDeliveryScheduleRow = {
  name: string;
  monthKey: string;
  grossCount: number;
  netCount: number;
};
type MonthWiseBgExpiryRow = {
  name: string;
  monthKey: string;
  psb: number;
  pwb: number;
  psbPwb: number;
  count: number;
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
  monthlyFileInflow: MonthCountRow[];
  monthWiseSupplyOrder: MonthCountRow[];
  monthWiseDeliverySchedule: MonthWiseDeliveryScheduleRow[];
  monthWiseCompletedDeliveries: MonthCountRow[];
  monthWiseBgExpiry: MonthWiseBgExpiryRow[];
  bgReceiptDelayRows: Array<{
    thresholdDays: number;
    label: string;
    psb: number;
    pwb: number;
    psbPwb: number;
    count: number;
  }>;
  warrantyBgMismatchRows: Array<{
    bufferDays: number;
    label: string;
    pwb: number;
    psbPwb: number;
    count: number;
  }>;
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
    key: "psb",
    label: "PSB",
    current: "psb",
    startColumn: "psb_start_date",
    completeColumn: "psb_bg_received_date",
    appliesCondition: () => bgCategoryExpression("effective_order", "psb"),
  },
  {
    key: "pwb",
    label: "PWB",
    current: "pwb",
    startColumn: "pwb_start_date",
    completeColumn: "pwb_bg_received_date",
    appliesCondition: () => bgCategoryExpression("effective_order", "pwb"),
  },
  {
    key: "psbPwb",
    label: "PSB+PWB",
    current: "psbpwb",
    startColumn: "psb_pwb_start_date",
    completeColumn: "combined_bg_received_date",
    appliesCondition: () => bgCategoryExpression("effective_order", "psbPwb"),
  },
  {
    key: "delivery",
    label: "Delivery",
    current: "delivery",
    startColumn: "delivery_start_date",
    completeColumn: "material_receipt_date",
    appliesCondition: () =>
      `${isYesExpression("f.ir")} and lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'o&m')`,
  },
  {
    key: "jobCompletion",
    label: "Job Completion",
    current: "jobcompletion",
    startColumn: "job_completion_start_date",
    completeColumn: "job_completion_date",
    appliesCondition: () => nonDeliveryFileTypeExpression("f"),
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
    startColumn: "payment_due_start_date",
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
  bg_receipt_delay_days: unknown;
  active_user_id: string | null;
};

const defaultBgReceiptDelayDays = [10, 30, 60];

function normalizeBgReceiptDelayDays(value: unknown) {
  const source = Array.isArray(value) ? value : defaultBgReceiptDelayDays;
  const days = Array.from(
    new Set(
      source
        .map((item) => Number.parseInt(String(item), 10))
        .filter((item) => Number.isInteger(item) && item >= 0),
    ),
  ).sort((a, b) => a - b);
  return days.length ? days.slice(0, 6) : defaultBgReceiptDelayDays;
}

function mapSettings(row: SettingsRow): AppSettings {
  return {
    financialYear: row.financial_year,
    selectedYear: row.selected_year,
    financialYears: [row.financial_year, row.selected_year].filter(
      (year) =>
        Boolean(year) &&
        year !== "__all_active_files__" &&
        year !== "__active_plus_current_fy_closed__",
    ),
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
    bgReceiptDelayDays: normalizeBgReceiptDelayDays(fromDbJsonArray(row.bg_receipt_delay_days)),
    activeUserId: fromDbText(row.active_user_id) || undefined,
  };
}

async function loadSettings() {
  return getCached("settings:reports", cacheTtl.settingsMs, async () => {
    const result = await pool.query<SettingsRow>(
      `select financial_year, selected_year, year_selection_locked, theme, theme_tint, deletion_password,
              tcec_committees, firm_types, file_types, modes, milestones, table_field_presets,
              bg_receipt_delay_days, active_user_id
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

function readNumberList(value: unknown) {
  const source = readList(value);
  if (!source) return undefined;
  return normalizeBgReceiptDelayDays(source);
}

const allActiveFilesYear = "__all_active_files__";
const activePlusCurrentFyClosedYear = "__active_plus_current_fy_closed__";
const fileClosedMilestone = "File Closed";

function isFileActiveInYear(file: { year?: string; activeYears?: string[] }, year: string) {
  return file.year === year || file.activeYears?.includes(year);
}

function isFileClosed(file: { completedMilestones?: string[] }) {
  return Boolean(
    file.completedMilestones?.some(
      (milestone) => milestone.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") === "fileclosed",
    ),
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
    isFileClosed(file) ||
    isYes(file.demandCancelled) ||
    ((file.supplyOrders?.length ?? 0) === 0 && isYes(file.soCancelled)) ||
    Boolean(
      file.supplyOrders?.length &&
        file.supplyOrders.every((order: SupplyOrderDetail) => isYes(order.soCancelled)),
    )
  );
}

function isDateInFinancialYear(date: string | undefined, financialYear: string | undefined) {
  const range = getFinancialYearDateRange(financialYear);
  return Boolean(date && range && date >= range.start && date <= range.end);
}

function isFileVisibleForSelectedYear(
  file: FileRecord,
  selectedYear: string | undefined,
  currentFinancialYear: string,
) {
  if (!selectedYear) return true;
  if (selectedYear === allActiveFilesYear) return !isInactiveFile(file);
  if (selectedYear === activePlusCurrentFyClosedYear) {
    return !isInactiveFile(file) || isDateInFinancialYear(file.fileClosureDate, currentFinancialYear);
  }
  return isFileActiveInYear(file, selectedYear);
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

function getFinancialYearDateRange(financialYear: string | undefined) {
  const match = (financialYear ?? "").match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return undefined;
  const startYear = Number(match[1]);
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

function activeFilesExpression() {
  return `(not ${fileClosedExpression()}
      and lower(coalesce(f.demand_cancelled, '')) <> 'yes')`;
}

function getSelectedYearCondition(
  selectedYear: string | undefined,
  values: unknown[],
  currentFinancialYear?: string,
) {
  if (!selectedYear) return undefined;
  if (selectedYear === allActiveFilesYear) {
    return activeFilesExpression();
  }
  if (selectedYear === activePlusCurrentFyClosedYear) {
    const range = getFinancialYearDateRange(currentFinancialYear);
    if (!range) return activeFilesExpression();
    const start = addValue(values, range.start);
    const end = addValue(values, range.end);
    return `(${activeFilesExpression()} or (${fileClosedExpression()}
      and f.file_closure_date between ${start}::date and ${end}::date
      and lower(coalesce(f.demand_cancelled, '')) <> 'yes'))`;
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
  currentFinancialYear,
  division,
  fileCategories,
}: {
  scopeSql: string;
  scopeValues: unknown[];
  selectedYear: string | undefined;
  currentFinancialYear?: string;
  division: string;
  fileCategories: FileCategoryKey[];
}) {
  const values = [...scopeValues];
  const conditions: string[] = [];
  if (scopeSql) conditions.push(scopeSql);
  const selectedYearCondition = getSelectedYearCondition(selectedYear, values, currentFinancialYear);
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
  const openingDate = `(case when ${isYesExpression(
    "f.refloat",
  )} and f.refloat_bid_opening_date is not null then f.refloat_bid_opening_date else f.bid_opening_date end)`;
  return `${isNoExpression("f.bid_opened")} and ${openingDate} is not null and ${openingDate} < current_date`;
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

function supplyOrderChildExpression(childCondition: string, _unusedFileLevelCondition?: string) {
  return supplyOrderExists(childCondition);
}

function effectiveDpDateExpression(alias: string) {
  return `coalesce(${alias}.revised_dp, ${alias}.dp_date)`;
}

function nonDeliveryFileTypeExpression(alias: string) {
  const irColumn = alias === "f" ? "f.ir" : `${alias}.file_ir`;
  return `(not ${isYesExpression(irColumn)}
    or lower(trim(coalesce(${alias}.file_type, ''))) in ('amc', 'mpc', 'cars', 'o&m'))`;
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

function isBgStatusKey(value: string) {
  return ["psb", "pwb", "psbpwb"].includes(normalizeMilestoneName(value));
}

function bgCategoryExpression(orderAlias: string, category: string) {
  const normalized = normalizeMilestoneName(category);
  if (normalized === "psb") {
    return `${isYesExpression(`${orderAlias}.psb_applicable`)}
      and trim(coalesce(${orderAlias}.bg_coverage_type, '')) in ('PSB', 'PSB and PWB separately')`;
  }
  if (normalized === "pwb") {
    return `${isYesExpression("f.bg")}
      and trim(coalesce(${orderAlias}.bg_coverage_type, '')) in ('PWB', 'PSB and PWB separately')`;
  }
  if (normalized === "psbpwb") {
    return `${isYesExpression("f.bg")}
      and trim(coalesce(${orderAlias}.bg_coverage_type, '')) = 'PSB+PWB'`;
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

function completedOrderMilestoneExpression(orderAlias: string, normalizedMilestone: string) {
  return `exists (
    select 1
    from jsonb_array_elements_text(coalesce(${orderAlias}.completed_milestones, '[]'::jsonb)) as completed_order(milestone)
    where ${normalizeMilestoneExpression("completed_order.milestone")} = '${normalizedMilestone}'
  )`;
}

function completedStageMilestoneExpression(stageAlias: string, normalizedMilestone: string) {
  return `exists (
    select 1
    from jsonb_array_elements_text(coalesce(${stageAlias}.stage -> 'completedMilestones', '[]'::jsonb)) as completed_stage(milestone)
    where ${normalizeMilestoneExpression("completed_stage.milestone")} = '${normalizedMilestone}'
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
    if (isBgStatusKey(milestone.key)) {
      const category = milestone.key;
      const receivedColumn = bgReceivedColumn(category);
      return supplyOrderChildExpression(
        `(${bgCategoryExpression("so", category)}
          and (${hasFilledExpression(`so.${receivedColumn}`)}
            or ${completedOrderMilestoneExpression("so", normalizeMilestoneName(category))}))`,
        "false",
      );
    }
    return supplyOrderChildExpression(
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
    return financialSanctionPendingExpression();
  }
  if (isBgStatusKey(milestone.key)) {
    const category = milestone.key;
    return `not ${isCancelledExpression()} and ${supplyOrderExists(
      `not ${isYesExpression("so.so_cancelled")}
       and ${bgCategoryExpression("so", category)}
       and (
         ${normalizeMilestoneExpression("so.current_milestone")} = '${normalizeMilestoneName(
           category,
         )}'
         or (
           '${normalizeMilestoneName(category)}' in ('psb', 'psbpwb')
           and (${hasFilledExpression("so.financial_sanction_date")}
             or ${completedOrderMilestoneExpression("so", "financialsanction")})
         )
	         or (
	           '${normalizeMilestoneName(category)}' = 'pwb'
	           and (
	             (not ${nonDeliveryFileTypeExpression("f")} and ${hasFilledExpression("so.material_receipt_date")})
	             or (${nonDeliveryFileTypeExpression("f")} and ${completedOrderMilestoneExpression(
                 "so",
                 "jobcompletion",
               )})
	           )
	         )
	       )`,
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
  return supplyOrderChildExpression(
    hasFilledExpression("so.so_date"),
    hasFilledExpression("f.so_date"),
  );
}

function deliveryDueOrderExpression(extraCondition = "true") {
  return supplyOrderChildExpression(
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

function reportPaymentRowsSource(whereSql: string, extraConditions: string[] = []) {
  const stageCount = "jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb))";
  const paymentApplicable = `(stage_row.stage is null
    or ${isYesExpression("so.stage_payment")}
    or (not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = ${stageCount}))`;
  const jobCompletionDone = `case
        when stage_row.stage is not null then ${completedStageMilestoneExpression(
          "stage_row",
          "jobcompletion",
        )}
        else ${completedOrderMilestoneExpression("so", "jobcompletion")}
      end`;
  return `(select
      f.file_type,
      f.ir as file_ir,
      ${paymentApplicable} as payment_applicable,
      so.so_cancelled,
      coalesce(nullif(stage_row.stage ->> 'dpDate', '')::date, so.dp_date) as dp_date,
      coalesce(nullif(stage_row.stage ->> 'revisedDp', '')::date, so.revised_dp) as revised_dp,
      case
        when stage_row.stage is not null then nullif(stage_row.stage ->> 'materialReceiptDate', '')::date
        else so.material_receipt_date
      end as material_receipt_date,
      case
        when stage_row.stage is not null then nullif(stage_row.stage ->> 'jobCompletionDate', '')::date
        else so.job_completion_date
      end as job_completion_date,
      ${jobCompletionDone} as job_completion_done,
      case
        when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
          then nullif(stage_row.stage ->> 'billPreparationDate', '')::date
        when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = ${stageCount}
          then so.bill_preparation_date
        when stage_row.stage is not null then null::date
        else so.bill_preparation_date
      end as bill_preparation_date,
      case
        when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
          then nullif(stage_row.stage ->> 'billSentForPaymentDate', '')::date
        when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = ${stageCount}
          then so.bill_sent_for_payment_date
        when stage_row.stage is not null then null::date
        else so.bill_sent_for_payment_date
      end as bill_sent_for_payment_date,
      case
        when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
          then nullif(stage_row.stage ->> 'paymentDate', '')::date
        when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = ${stageCount}
          then so.payment_date
        when stage_row.stage is not null then null::date
        else so.payment_date
      end as payment_date,
      case
        when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
          then stage_row.stage ->> 'currentMilestone'
        when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = ${stageCount}
          then so.current_milestone
        when stage_row.stage is not null then ''::text
        else so.current_milestone
      end as current_milestone
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
        or ${stageCount} = 0
    ) stage_row on true
    ${appendReportWhereClause(whereSql, extraConditions)})`;
}

function paymentRowReadyExpression(alias = "payment_row") {
  const nonDelivery = nonDeliveryFileTypeExpression(alias);
  return `(
    ${normalizeMilestoneExpression(`${alias}.current_milestone`)} = 'payment'
    or ${hasFilledExpression(`${alias}.bill_preparation_date`)}
    or ${hasFilledExpression(`${alias}.bill_sent_for_payment_date`)}
    or (
      not ${nonDelivery}
      and (
        ${isYesExpression(`${alias}.file_ir`)}
        and ${hasFilledExpression(`${alias}.material_receipt_date`)}
      )
    )
    or (${nonDelivery} and ${alias}.job_completion_done)
  )`;
}

function paymentRowCompletedExpression(alias = "payment_row") {
  return `${alias}.payment_applicable
    and ${hasFilledExpression(`${alias}.payment_date`)}
    and not ${isYesExpression(`${alias}.so_cancelled`)}`;
}

function paymentRowPendingExpression(alias = "payment_row") {
  return `${alias}.payment_applicable
    and not ${hasFilledExpression(`${alias}.payment_date`)}
    and ${paymentRowReadyExpression(alias)}
    and not ${isYesExpression(`${alias}.so_cancelled`)}`;
}

function financialSanctionPreviousStageExpression() {
  return `not ${isCancelledExpression()}
    and not (${financialSanctionCompleteExpression()})
    and not (${financialSanctionPendingExpression()})
    and (
      (not ${isYesExpression("f.tcec")}
        and ${normalizeMilestoneExpression("f.current_milestone")} = 'bidding'
        and not ${isYesExpression("f.bidding_stage_over")})
      or (${isYesExpression("f.tcec")}
        and ${normalizeMilestoneExpression("f.current_milestone")} = 'cnc'
        and not ${hasFilledExpression("f.cnc_approval_date")})
    )`;
}

function financialSanctionReachedExpression() {
  return `not ${isCancelledExpression()}
    and ${isYesExpression("f.bidding_stage_over")}
    and (not ${isYesExpression("f.tcec")} or ${hasFilledExpression("f.cnc_approval_date")})`;
}

function financialSanctionPendingExpression() {
  return `${financialSanctionReachedExpression()} and not (${financialSanctionCompleteExpression()})`;
}

function earliestSupplyOrderDateExpression(column: string) {
  return `case
    when ${supplyOrderRowExists()} then (
      select min(${dateCastExpression(`so_date_value.${column}`)})
      from supply_orders so_date_value
      where so_date_value.file_id = f.id and so_date_value.${column} is not null
    )
    else ${dateCastExpression(`f.${column}`)}
  end`;
}

function dateCastExpression(expression: string) {
  return `nullif((${expression})::text, '')::date`;
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
    "At Previous Stage",
    "To be returned",
    "In process",
    "Opening overdue",
    "Live",
    "Due",
    "Done",
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
    "At Previous Stage",
    "To be returned",
    "In process",
    "Opening overdue",
    "Live",
    "Due",
    "Done",
    "Completed",
    "Overdue",
    "Valid",
    "Expired",
    "Extended",
  ];
  if (columns.includes("Due") && columns.includes("Done")) {
    return ["Due", "Done"];
  }
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
  if (columns.includes("Received")) return "Security/Warranty BG";
  if (columns.includes("Valid")) return "Delivery Period";
  if (columns.includes("Due") && columns.includes("Done")) return "Job Completion";
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
    const previousStage = `${process} and (${reached}) and not (${active}) and not (${reviewed}) and not (${complete})`;

    if (isBgStatusKey(milestone.key)) {
      const category = milestone.key;
      const eligible = `not ${isCancelledExpression()} and ${supplyOrderExists(
        `not ${isYesExpression("so.so_cancelled")} and ${bgCategoryExpression("so", category)}`,
      )}`;
      const receivedColumn = bgReceivedColumn(category);
      const validityColumn = bgValidityColumn(category);
      const returnColumn = bgReturnColumn(category);
      const nonDeliveryFileType = nonDeliveryFileTypeExpression("f");
      const stageRowsExist = `${isYesExpression("so.stage_delivery")} and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0`;
      const allStagesHaveIrReceipt = `not exists (
        select 1 from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as psb_stage(stage)
        where coalesce(psb_stage.stage ->> 'irReceiptDate', '') = ''
      )`;
      const allStagesHaveJobCompletion = `not exists (
        select 1 from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as psb_stage(stage)
        where not ${completedStageMilestoneExpression("psb_stage", "jobcompletion")}
      )`;
      const psbPurposeComplete = `((${nonDeliveryFileType} and ((${stageRowsExist} and ${allStagesHaveJobCompletion}) or (not (${stageRowsExist}) and ${completedOrderMilestoneExpression(
          "so",
          "jobcompletion",
        )})))
        or (not ${nonDeliveryFileType} and (
	          (${isYesExpression("f.ir")} and ((${stageRowsExist} and ${allStagesHaveIrReceipt}) or (not (${stageRowsExist}) and ${hasFilledExpression("so.ir_receipt_date")})))
	        )))`;
      const received = supplyOrderExists(
        `not ${isYesExpression("so.so_cancelled")}
         and ${bgCategoryExpression("so", category)}
         and (${hasFilledExpression(`so.${receivedColumn}`)}
           or ${completedOrderMilestoneExpression("so", normalizeMilestoneName(category))})`,
      );
	      const pendingStarted =
	        normalizeMilestoneName(category) === "pwb"
	          ? `(not ${nonDeliveryFileType} and ${hasFilledExpression("so.material_receipt_date")})
	            or (${nonDeliveryFileType} and ${completedOrderMilestoneExpression("so", "jobcompletion")})`
	          : `(${hasFilledExpression("so.financial_sanction_date")}
	             or ${completedOrderMilestoneExpression("so", "financialsanction")})`;
      addRow(milestone.label, "Received", `${eligible} and ${received}`);
      addRow(
        milestone.label,
        "Pending",
        `not ${isCancelledExpression()} and ${supplyOrderExists(
          `not ${isYesExpression("so.so_cancelled")}
           and ${bgCategoryExpression("so", category)}
           and ${pendingStarted}
           and not (${hasFilledExpression(`so.${receivedColumn}`)}
             or ${completedOrderMilestoneExpression("so", normalizeMilestoneName(category))})`,
        )}`,
      );
      addRow(
        milestone.label,
        "Expired",
        `${supplyOrderExists(
          `${bgCategoryExpression("so", category)}
            and (${hasFilledExpression(`so.${receivedColumn}`)}
              or ${completedOrderMilestoneExpression("so", normalizeMilestoneName(category))})
            and not ${hasFilledExpression(`so.${returnColumn}`)}
            and not ${isYesExpression("so.so_cancelled")}
            and (
              ('${normalizeMilestoneName(category)}' = 'psb'
                and not (${psbPurposeComplete}))
              or ('${normalizeMilestoneName(category)}' <> 'psb'
                and not ${hasFilledExpression("so.payment_date")})
            )
            and ${hasFilledExpression(`so.${validityColumn}`)}
            and so.${validityColumn} < current_date`,
        )}`,
      );
      addRow(
        milestone.label,
        "To be returned",
        `${supplyOrderExists(
          `${bgCategoryExpression("so", category)}
            and (${hasFilledExpression(`so.${receivedColumn}`)}
              or ${completedOrderMilestoneExpression("so", normalizeMilestoneName(category))})
            and not ${hasFilledExpression(`so.${returnColumn}`)}
            and (
              ${isYesExpression("so.so_cancelled")}
              or (
                not ${isYesExpression("so.so_cancelled")}
                and (
                  ('${normalizeMilestoneName(category)}' = 'psb' and ${psbPurposeComplete})
                  or (
                    '${normalizeMilestoneName(category)}' <> 'psb'
                    and ${hasFilledExpression("so.payment_date")}
                    and ${hasFilledExpression(`so.${validityColumn}`)}
                    and so.${validityColumn} < current_date
                  )
                )
              )
            )`,
        )}`,
      );
      addRow(
        milestone.label,
        "Returned",
        `${supplyOrderExists(
          `${bgCategoryExpression("so", category)}
           and ${hasFilledExpression(`so.${returnColumn}`)}`,
        )}`,
      );
      addRow(
        milestone.label,
        "At previous stage",
        `${previousStage} and not (${received})`,
      );
      return;
    }
	    if (milestone.key === "payment") {
	      selects.push(
        `select '${milestone.label}' as milestone,
                'Completed' as stage,
                count(*)::integer as count
         from ${reportPaymentRowsSource(whereSql, [`not ${isCancelledExpression()}`])} payment_row
         where ${paymentRowCompletedExpression("payment_row")}`,
      );
      selects.push(
        `select '${milestone.label}' as milestone,
                'Pending' as stage,
                count(*)::integer as count
         from ${reportPaymentRowsSource(whereSql, [`not ${isCancelledExpression()}`])} payment_row
         where ${paymentRowPendingExpression("payment_row")}`,
      );
	      addRow(milestone.label, "At previous stage", previousStage);
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
      addRow(
        milestone.label,
        "At previous stages",
        `${previousStage} and not ${isYesExpression("f.tender_live")} and not (${bidOverdue})`,
      );
      return;
    }
    if (milestone.key === "supplyOrder") {
      addRow(milestone.label, "Placed", `${process} and ${complete}`);
      addRow(milestone.label, "Live", deliveryDueOrderExpression());
      addRow(milestone.label, "At Previous Stage", financialSanctionPendingExpression());
      addRow(milestone.label, "Pending", pending);
      return;
    }
    if (milestone.key === "financialSanction") {
      addRow(milestone.label, "At Previous Stage", financialSanctionPreviousStageExpression());
      addRow(milestone.label, "Completed", `${process} and ${complete}`);
      addRow(milestone.label, "Pending", pending);
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
      addRow(milestone.label, "At previous stage", previousStage);
      addRow(milestone.label, "In process", active);
      addRow(milestone.label, "Reviewed", `${active} and ${reviewed} and not (${complete})`);
      addRow(milestone.label, "Pending", pending);
      return;
    }
    addRow(milestone.label, milestone.totalLabel ?? "Total", applies);
    addRow(milestone.label, "Completed", `${process} and ${complete}`);
    addRow(milestone.label, "In process", active);
    addRow(milestone.label, "At previous stage", previousStage);
	  });
	
  const stageJobCompletionDone = `exists (
    select 1
    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as job_stage(stage)
    where exists (
      select 1
      from jsonb_array_elements_text(coalesce(job_stage.stage -> 'completedMilestones', '[]'::jsonb)) as completed_job_stage(milestone)
      where ${normalizeMilestoneExpression("completed_job_stage.milestone")} = 'jobcompletion'
    )
  )`;
  const stageJobCompletionDue = `exists (
    select 1
    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as due_job_stage(stage)
    where not exists (
      select 1
      from jsonb_array_elements_text(coalesce(due_job_stage.stage -> 'completedMilestones', '[]'::jsonb)) as completed_due_job_stage(milestone)
      where ${normalizeMilestoneExpression("completed_due_job_stage.milestone")} = 'jobcompletion'
    )
    and (
      ${normalizeMilestoneExpression("due_job_stage.stage ->> 'currentMilestone'")} = 'jobcompletion'
      or coalesce(
        nullif(due_job_stage.stage ->> 'revisedDp', '')::date,
        nullif(due_job_stage.stage ->> 'dpDate', '')::date,
        so.revised_dp,
        so.dp_date
      ) < current_date
    )
  )`;
  const orderJobCompletionDone = completedOrderMilestoneExpression("so", "Job Completion");
  addRow(
    "Job Completion",
    "Due",
    `not ${isCancelledExpression()} and ${nonDeliveryFileTypeExpression("f")} and ${supplyOrderExists(
      `not ${isYesExpression("so.so_cancelled")}
       and ${hasFilledExpression("so.so_date")}
       and (
         (
           not ${orderJobCompletionDone}
           and (
             ${normalizeMilestoneExpression("so.current_milestone")} = 'jobcompletion'
             or (${effectiveDpDateExpression("so")} is not null and ${effectiveDpDateExpression("so")} < current_date)
           )
         )
         or ${stageJobCompletionDue}
       )`,
    )}`,
  );
  addRow(
    "Job Completion",
    "Done",
    `not ${isCancelledExpression()} and ${nonDeliveryFileTypeExpression("f")} and ${supplyOrderExists(
      `not ${isYesExpression("so.so_cancelled")}
       and ${hasFilledExpression("so.so_date")}
       and (${orderJobCompletionDone} or ${stageJobCompletionDone})`,
    )}`,
  );

  addRow(
	    "Delivery Period",
	    "Valid",
	    `not ${isCancelledExpression()} and not ${nonDeliveryFileTypeExpression("f")} and ${supplyOrderChildExpression(
	      `${hasFilledExpression("so.so_date")} and so.so_date <= current_date and ${effectiveDpDateExpression("so")} is not null and ${effectiveDpDateExpression("so")} >= current_date and not ${hasFilledExpression("so.revised_dp")} and not ${hasFilledExpression("so.material_receipt_date")} and not ${isYesExpression("so.so_cancelled")}`,
	      `${hasFilledExpression("f.so_date")} and f.so_date <= current_date and ${effectiveDpDateExpression("f")} is not null and ${effectiveDpDateExpression("f")} >= current_date and not ${hasFilledExpression("f.revised_dp")} and not ${hasFilledExpression("f.material_receipt_date")}`,
	    )}`,
	  );
	  addRow(
	    "Delivery Period",
	    "Expired",
	    `not ${isCancelledExpression()} and not ${nonDeliveryFileTypeExpression("f")} and ${supplyOrderChildExpression(
	      `${hasFilledExpression("so.so_date")} and ${effectiveDpDateExpression("so")} is not null and ${effectiveDpDateExpression("so")} < current_date and not ${hasFilledExpression("so.revised_dp")} and not ${hasFilledExpression("so.material_receipt_date")} and not ${isYesExpression("so.so_cancelled")}`,
	      `${hasFilledExpression("f.so_date")} and ${effectiveDpDateExpression("f")} is not null and ${effectiveDpDateExpression("f")} < current_date and not ${hasFilledExpression("f.material_receipt_date")}`,
	    )}`,
	  );
	  addRow(
	    "Delivery Period",
	    "Extended",
	    `not ${isCancelledExpression()} and not ${nonDeliveryFileTypeExpression("f")} and ${supplyOrderChildExpression(
	      `${hasFilledExpression("so.so_date")} and so.so_date <= current_date and ${hasFilledExpression("so.revised_dp")} and ${effectiveDpDateExpression("so")} is not null and ${effectiveDpDateExpression("so")} >= current_date and not ${hasFilledExpression("so.material_receipt_date")} and not ${isYesExpression("so.so_cancelled")}`,
	      `${hasFilledExpression("f.so_date")} and f.so_date <= current_date and ${hasFilledExpression("f.revised_dp")} and ${effectiveDpDateExpression("f")} is not null and ${effectiveDpDateExpression("f")} >= current_date and not ${hasFilledExpression("f.material_receipt_date")}`,
	    )}`,
	  );
  addRow(
    "Delivery",
    "Completed",
    `${supplyOrderPlacedExpression()} and ${supplyOrderChildExpression(
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
  const nonDeliveryEffective = nonDeliveryFileTypeExpression("effective");
  const receiptBaseDateExpression = `case
    when ${nonDeliveryEffective} and effective.job_completion_done
    then (coalesce(effective.revised_dp, effective.dp_date) + interval '1 day')::date
    when not ${nonDeliveryEffective} and ${isYesExpression("effective.file_ir")} then effective.material_receipt_date
    else null::date
  end`;
  const deliveryCompletionExpression = `case
    when ${nonDeliveryEffective} and effective.job_completion_done then coalesce(effective.revised_dp, effective.dp_date)
    when not ${nonDeliveryEffective} and ${isYesExpression("effective.file_ir")} then effective.material_receipt_date
    else null::date
  end`;
  const receiptPendingBillBaseDateExpression = receiptBaseDateExpression;
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
	              ${nonDeliveryEffective}
                and not effective.job_completion_done
	              and (effective.bill_preparation_date is null or effective.bill_preparation_date > ${asOfDatePlaceholder}::date)
              and (effective.bill_sent_for_payment_date is null or effective.bill_sent_for_payment_date > ${asOfDatePlaceholder}::date)
              and (effective.payment_date is null or effective.payment_date > ${asOfDatePlaceholder}::date)
            )
            or (
	              not ${nonDeliveryEffective}
              and (${deliveryCompletionExpression} is null or ${deliveryCompletionExpression} > ${asOfDatePlaceholder}::date)
              and (effective.payment_date is null or effective.payment_date > ${asOfDatePlaceholder}::date)
            )
          )`;
      }
      return `coalesce(effective.revised_dp, effective.dp_date) is not null
        and not effective.so_cancelled_yes
        and (
          (
	            ${nonDeliveryEffective}
              and not effective.job_completion_done
	            and effective.bill_preparation_date is null
            and effective.bill_sent_for_payment_date is null
            and effective.payment_date is null
          )
          or (
	            not ${nonDeliveryEffective}
            and ${deliveryCompletionExpression} is null
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
  const effectiveCapitalExpression =
    mode === "actual"
      ? `case
           when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
             then ${inrAmountExpression("stage_row.stage ->> 'actualPaymentCapital'")}
           when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb))
             then ${inrAmountExpression("so.actual_payment_capital")}
           when stage_row.stage is not null then 0
           else ${inrAmountExpression("so.actual_payment_capital")}
         end`
      : `case
           when stage_row.stage is not null then ${inrAmountExpression("stage_row.stage ->> 'stageAmountCapital'")}
           else ${inrAmountExpression("so.so_value_capital")}
         end`;
  const effectiveRevenueExpression =
    mode === "actual"
      ? `case
           when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
             then ${inrAmountExpression("stage_row.stage ->> 'actualPaymentRevenue'")}
           when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb))
             then ${inrAmountExpression("so.actual_payment_revenue")}
           when stage_row.stage is not null then 0
           else ${inrAmountExpression("so.actual_payment_revenue")}
         end`
      : `case
           when stage_row.stage is not null then ${inrAmountExpression("stage_row.stage ->> 'stageAmountRevenue'")}
           else ${inrAmountExpression("so.so_value_revenue")}
         end`;
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
         f.ir as file_ir,
         so.so_date,
         coalesce(nullif(stage_row.stage ->> 'dpDate', '')::date, so.dp_date) as dp_date,
         coalesce(nullif(stage_row.stage ->> 'revisedDp', '')::date, so.revised_dp) as revised_dp,
         case
           when stage_row.stage is not null then nullif(stage_row.stage ->> 'materialReceiptDate', '')::date
           else so.material_receipt_date
         end as material_receipt_date,
         case
           when stage_row.stage is not null then nullif(stage_row.stage ->> 'jobCompletionDate', '')::date
           else so.job_completion_date
         end as job_completion_date,
         case
           when stage_row.stage is not null then ${completedStageMilestoneExpression(
               "stage_row",
               "jobcompletion",
             )}
           else ${completedOrderMilestoneExpression("so", "jobcompletion")}
         end as job_completion_done,
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
         ${effectiveCapitalExpression} as capital,
         ${effectiveRevenueExpression} as revenue
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
  return `coalesce(${[
    ...previousDateExpressions,
    dateCastExpression("f.received_date"),
  ].join(", ")})`;
}

function reportDateValueExpression(milestone: (typeof reportMilestoneDefinitions)[number]) {
  if (milestone.key === "bidding") {
    return `coalesce(${dateCastExpression("f.bid_opening_date")}, ${dateCastExpression("f.bid_date")})`;
  }
  if ("yesComplete" in milestone && milestone.yesComplete) return "null::date";
  if ("supplyOrderDate" in milestone && milestone.supplyOrderDate) {
    return earliestSupplyOrderDateExpression(milestone.supplyOrderDate);
  }
  if ("currentColumn" in milestone && milestone.currentColumn) {
    return dateCastExpression(milestone.currentColumn);
  }
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
    (${earliestSupplyOrderDateExpression("psb_bg_received_date")}),
    (${earliestSupplyOrderDateExpression("psb_bg_validity_date")}),
    (${earliestSupplyOrderDateExpression("psb_bg_return_date")}),
    (${earliestSupplyOrderDateExpression("pwb_bg_received_date")}),
    (${earliestSupplyOrderDateExpression("pwb_bg_validity_date")}),
    (${earliestSupplyOrderDateExpression("pwb_bg_return_date")}),
    (${earliestSupplyOrderDateExpression("combined_bg_received_date")}),
    (${earliestSupplyOrderDateExpression("combined_bg_validity_date")}),
    (${earliestSupplyOrderDateExpression("combined_bg_return_date")}),
    (${earliestSupplyOrderDateExpression("revised_dp")}),
    (${earliestSupplyOrderDateExpression("material_receipt_date")}),
    (${earliestSupplyOrderDateExpression("ir_preparation_date")}),
    (${earliestSupplyOrderDateExpression("ir_receipt_date")}),
    (${earliestSupplyOrderDateExpression("bill_preparation_date")}),
    (${earliestSupplyOrderDateExpression("bill_sent_for_payment_date")}),
    (${earliestSupplyOrderDateExpression("payment_date")}),
    (${earliestSupplyOrderDateExpression("so_cancelled_date")})
  ) as dates(date_value))`;
}

function jsonDateExpression(jsonAlias: string, key: string) {
  return `nullif(${jsonAlias} ->> '${key}', '')::date`;
}

function effectiveOrderDateExpression(column: string, jsonKey: string) {
  return `coalesce(${jsonDateExpression("stage_row.stage", jsonKey)}, nullif(so.${column}::text, '')::date)`;
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
  const effectiveDpDate = `coalesce(${revisedDp}, ${dpDate})`;
  const materialReceiptDate = effectiveOrderDateExpression(
    "material_receipt_date",
    "materialReceiptDate",
  );
  const irReceiptDate = effectiveOrderDateExpression("ir_receipt_date", "irReceiptDate");
  const advancePaymentDate = `nullif(so.advance_payment_detail ->> 'paymentDate', '')::date`;
  const jobCompletionDone = `case
    when stage_row.stage is not null then ${completedStageMilestoneExpression(
      "stage_row",
      "jobcompletion",
    )}
    else ${completedOrderMilestoneExpression("so", "jobcompletion")}
  end`;
  return `(select
      so.so_no,
      so.gem_so_no,
      coalesce(
        so.sort_order,
        row_number() over (order by coalesce(so.sort_order, 2147483647), so.id) - 1
      )::integer as sort_order,
      stage_row.stage_index,
      case
        when ${nonDeliveryFileTypeExpression("f")}
          and ${normalizeMilestoneExpression("coalesce(stage_row.stage ->> 'currentMilestone', so.current_milestone)")} = 'delivery'
        then 'Job Completion'
        else coalesce(
          stage_row.stage ->> 'currentMilestone',
          so.current_milestone
        )
      end as current_milestone,
      stage_row.stage ->> 'currentMilestone' as stage_current_milestone,
      so.advance_payment_detail ->> 'currentMilestone' as advance_current_milestone,
      so.current_milestone as order_current_milestone,
      so.advance_payment,
      so.psb_applicable,
      so.bg_coverage_type,
      f.bg as file_bg,
      f.file_type,
      f.ir as file_ir,
      ${financialSanctionDate} as financial_sanction_date,
      ${soDate} as so_date,
      so.psb_bg_received_date as psb_bg_received_date,
      so.psb_bg_validity_date as psb_bg_validity_date,
      so.psb_bg_return_date as psb_bg_return_date,
      so.pwb_bg_received_date as pwb_bg_received_date,
      so.pwb_bg_validity_date as pwb_bg_validity_date,
      so.pwb_bg_return_date as pwb_bg_return_date,
      so.combined_bg_received_date as combined_bg_received_date,
      so.combined_bg_validity_date as combined_bg_validity_date,
      so.combined_bg_return_date as combined_bg_return_date,
      ${priorMainTimelineDate} as financial_sanction_start_date,
      coalesce(${financialSanctionDate}, ${priorMainTimelineDate}) as supply_order_start_date,
      coalesce(${soDate}, ${financialSanctionDate}, ${priorMainTimelineDate}) as bank_guarantee_start_date,
      coalesce(${financialSanctionDate}, ${priorMainTimelineDate}) as psb_start_date,
      ${materialReceiptDate} as pwb_start_date,
      coalesce(${financialSanctionDate}, ${priorMainTimelineDate}) as psb_pwb_start_date,
      coalesce(${soDate}, ${financialSanctionDate}, ${priorMainTimelineDate}) as delivery_start_date,
      ${materialReceiptDate} as material_receipt_date,
      ${jobCompletionDone} as job_completion_done,
      case
        when ${nonDeliveryFileTypeExpression("f")} and ${effectiveDpDate} is not null
        then (${effectiveDpDate} + interval '1 day')::date
        else null::date
      end as job_completion_start_date,
      case
        when ${jobCompletionDone} then '9999-12-31'::date
        else null::date
      end as job_completion_date,
      ${materialReceiptDate} as ir_preparation_start_date,
      ${effectiveOrderDateExpression("ir_preparation_date", "irPreparationDate")} as ir_preparation_date,
      ${effectiveOrderDateExpression("ir_preparation_date", "irPreparationDate")} as ir_receipt_start_date,
      ${irReceiptDate} as ir_receipt_date,
      case
        when ${nonDeliveryFileTypeExpression("f")}
          and ${jobCompletionDone}
          and ${effectiveDpDate} is not null
        then (${effectiveDpDate} + interval '1 day')::date
        else coalesce(${irReceiptDate}, ${materialReceiptDate})
      end as bill_preparation_start_date,
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
      case
        when ${nonDeliveryFileTypeExpression("f")}
          and ${jobCompletionDone}
          and ${effectiveDpDate} is not null
        then (${effectiveDpDate} + interval '1 day')::date
        when not ${nonDeliveryFileTypeExpression("f")} and ${isYesExpression("f.ir")} then ${materialReceiptDate}
        else null::date
      end as payment_due_start_date,
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
        (so.psb_bg_received_date),
        (so.psb_bg_validity_date),
        (so.psb_bg_return_date),
        (so.pwb_bg_received_date),
        (so.pwb_bg_validity_date),
        (so.pwb_bg_return_date),
        (so.combined_bg_received_date),
        (so.combined_bg_validity_date),
        (so.combined_bg_return_date),
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
        milestone.key !== "financialSanction" &&
          milestone.key !== "advancePayment" &&
          !isBgStatusKey(milestone.key),
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
          then ':' || (effective_order.stage_index - 1)::text
          else ''
        end)`;
      const currentMilestoneExpression =
        milestone.key === "advancePayment"
          ? "effective_order.advance_current_milestone"
          : ["financialSanction", "supplyOrder"].includes(milestone.key)
            ? "effective_order.order_current_milestone"
            : "effective_order.current_milestone";
      const normalizedBgKey = normalizeMilestoneName(milestone.key);
      const currentCondition = isBgStatusKey(milestone.key)
        ? `(('${normalizedBgKey}' in ('psb', 'psbpwb')
              and ${hasFilledExpression("effective_order.financial_sanction_date")})
	            or ('${normalizedBgKey}' = 'pwb'
	              and (
	                (not ${nonDeliveryFileTypeExpression("effective_order")}
	                  and ${hasFilledExpression("effective_order.material_receipt_date")})
	                or (${nonDeliveryFileTypeExpression("effective_order")}
	                  and effective_order.job_completion_done)
	              )))`
        : milestone.key === "payment"
          ? `${startDate} is not null`
          : milestone.key === "jobCompletion"
            ? `${startDate} is not null`
          : `${normalizeMilestoneExpression(currentMilestoneExpression)} = '${milestone.current}'`;
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
          currentCondition,
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
  const orderDelayKeys = new Set<string>(
    orderDelayMilestoneDefinitions.map((milestone) => milestone.key),
  );
  const fileSelects = reportMilestoneDefinitions
    .filter(
      (milestone) =>
        !orderDelayKeys.has(milestone.key) &&
        (selectedMilestoneKey === "all" || milestone.key === selectedMilestoneKey),
    )
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
  const financialSanctionFileSelects =
    selectedMilestoneKey === "all" || selectedMilestoneKey === "financialSanction"
      ? (() => {
          const milestone = reportMilestoneDefinitions.find(
            (item) => item.key === "financialSanction",
          );
          if (!milestone) return [];
          const index = reportMilestoneDefinitions.findIndex(
            (item) => item.key === "financialSanction",
          );
          const startDate = delayStageStartExpression(milestone, index);
          const lastFilled = lastFilledDateExpression();
          return [
            `select
              f.id::text as "fileId",
              coalesce(nullif(f.file_no, ''), nullif(f.unique_code, ''), nullif(f.title, ''), f.id::text) as "fileRef",
              coalesce(d.name, '') as division,
              coalesce(f.indentor, '') as indentor,
              coalesce(f.demand_description, '') as description,
              'financialSanction' as "milestoneKey",
              'Financial Sanction' as milestone,
              (${startDate})::text as "stageStartDate",
              (current_date - (${startDate})::date)::integer as "daysInStage",
              coalesce((${lastFilled})::text, '') as "lastFilledDate",
              'Milestones' as "focusSection",
              null::text as "focusTarget"
            from files f
            left join divisions d on d.id = f.division_id
            ${appendReportWhereClause(whereSql, [
              `not ${supplyOrderRowExists()}`,
              financialSanctionPendingExpression(),
              `(${startDate}) is not null`,
              `(current_date - (${startDate})::date) > ${thresholdPlaceholder}::integer`,
            ])}`,
          ];
        })()
      : [];
  const orderSelects = orderDelayRowsSelects(whereSql, selectedMilestoneKey, thresholdPlaceholder);
  const selects = [...fileSelects, ...financialSanctionFileSelects, ...orderSelects];
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
    monthlyFileInflow: [],
    monthWiseSupplyOrder: [],
    monthWiseDeliverySchedule: [],
    monthWiseCompletedDeliveries: [],
    monthWiseBgExpiry: [],
    bgReceiptDelayRows: [],
    warrantyBgMismatchRows: [],
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
    const bgReceiptDelayDays =
      readNumberList(request.query.bgReceiptDelayDays) ?? defaultBgReceiptDelayDays;
    const warrantyBgBufferDays = readNonNegativeInteger(request.query.warrantyBgBufferDays, 60);
    const historicalFromDate = readDateString(request.query.historicalFromDate);
    const historicalToDate = readDateString(request.query.historicalToDate);
    const cashOutgoMonth = readMonthString(request.query.cashOutgoMonth);
    const cashOutgoAsOfDate = cashOutgoMonth ? getMonthEndDate(cashOutgoMonth) : undefined;
    const reportWhere = getReportWhereSql({
      scopeSql: [scope.sql, categoryScope.sql].filter(Boolean).join(" and "),
      scopeValues: scope.values,
      selectedYear,
      currentFinancialYear: settings.financialYear,
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
      bgReceiptDelayDays,
      warrantyBgBufferDays,
    })}`;
    const summary = await getCached(cacheKey, cacheTtl.reportsSummaryMs, async () => {
      const combinedScopeSql = [scope.sql, categoryScope.sql].filter(Boolean).join(" and ");
      const files = await loadFiles(
        combinedScopeSql ? `where ${combinedScopeSql}` : "",
        scope.values,
      );
      const selectedYearFiles = files.filter((file) =>
        isFileVisibleForSelectedYear(file, selectedYear, settings.financialYear),
      );
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
        bgReceiptDelayDays,
        warrantyBgBufferDays,
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
