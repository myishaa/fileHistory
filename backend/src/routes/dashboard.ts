import { Router } from "express";
import { pool } from "../db/pool.js";
import { loadFiles } from "./files.js";
import type {
  AppSettings,
  Division,
  FileRecord,
  SupplyOrderDetail,
  ValueThresholdLevel,
} from "../types.js";
import { fromDbJsonArray, fromDbText } from "../utils/db-values.js";
import { buildDashboardSummary } from "../utils/dashboard-summary.js";
import {
  canUseAllDivisions,
  getAuthScopeCacheKey,
  getDivisionScopeCondition,
  requireAuth,
  type AuthRequest,
} from "../utils/auth.js";
import { cacheTtl, getCached } from "../utils/cache.js";
import { asyncHandler, HttpError } from "../utils/http.js";

export const dashboardRouter = Router();

type DivisionRow = {
  id: string;
  name: string;
  code: string | null;
  allocated_capital: string | null;
  allocated_revenue: string | null;
  ad: string | null;
};

type SettingsRow = {
  financial_year: string;
  selected_year: string;
  year_selection_locked: boolean;
  theme: AppSettings["theme"];
  theme_tint: AppSettings["themeTint"];
  deletion_password: string;
  tcec_committees: unknown;
  milestones: unknown;
  table_field_presets: unknown;
  active_user_id: string | null;
};

const modeNames = ["OBM", "PBM", "SBM", "LBM", "LPC"];
const snapshotAttributeDefinitions = [
  { key: "tcec", column: "f.tcec", label: "TCEC", yesLabel: "TCEC", noLabel: "Non TCEC" },
  { key: "gte", column: "f.gte", label: "GTE", yesLabel: "GTE", noLabel: "Non GTE" },
  { key: "gem", column: "f.gem", label: "GeM", yesLabel: "GeM", noLabel: "Non GeM" },
  {
    key: "highValue",
    column: "f.high_value",
    label: "High Value",
    yesLabel: "High Value",
    noLabel: "Non High Value",
  },
  { key: "ad", column: "f.ad", label: "AD", yesLabel: "AD", noLabel: "Non AD" },
  { key: "rqa", column: "f.rqa", label: "R&QA", yesLabel: "R&QA", noLabel: "Non R&QA" },
  { key: "ifa", column: "f.ifa", label: "IFA", yesLabel: "IFA", noLabel: "Non IFA" },
  { key: "psb", column: "f.psb", label: "PSB", yesLabel: "PSB", noLabel: "Non PSB" },
  { key: "bg", column: "f.bg", label: "BG", yesLabel: "BG", noLabel: "Non BG" },
  {
    key: "rfpVetting",
    column: "f.rfp_vetting",
    label: "RFP vetting",
    yesLabel: "RFP vetting",
    noLabel: "Non RFP vetting",
  },
  {
    key: "refloat",
    column: "f.refloat",
    label: "Refloat",
    yesLabel: "Refloat",
    noLabel: "Non Refloat",
  },
  { key: "rst", column: "f.rst", label: "RST", yesLabel: "RST", noLabel: "Non RST" },
] as const;

const statusMilestoneDefinitions = [
  {
    key: "scrutiny",
    label: "Scrutiny",
    reviewedColumn: "f.scrutiny_date",
    currentColumn: "f.scrutiny_completion_date",
  },
  {
    key: "highValue",
    label: "High Value",
    reviewedColumn: "f.high_value_meeting_date",
    currentColumn: "f.high_value_minutes_date",
    appliesColumn: "f.high_value",
  },
  {
    key: "tcec",
    label: "Pre-TCEC",
    reviewedColumn: "f.pre_tcec_date",
    currentColumn: "f.pre_tcec_minutes_date",
    appliesColumn: "f.tcec",
  },
  {
    key: "ad",
    label: "AD",
    currentColumn: "f.ad_vetting_date",
    appliesColumn: "f.ad",
  },
  {
    key: "rqa",
    label: "R&QA",
    currentColumn: "f.rqa_approval_date",
    appliesColumn: "f.rqa",
  },
  {
    key: "control",
    label: "Controlling",
    currentColumn: "f.imms_date",
    aliases: ["Controlling", "Controlled"],
  },
  {
    key: "ifa",
    label: "IFA",
    reviewedColumn: "f.ifa_sent_date",
    currentColumn: "f.ifa_final_date",
    appliesColumn: "f.ifa",
  },
  {
    key: "cfa",
    label: "CFA",
    reviewedColumn: "f.cfa_sent_date",
    currentColumn: "f.cfa_date",
  },
  { key: "bidding", label: "Bidding", currentColumn: "f.bidding_stage_over", yesComplete: true },
  {
    key: "postTcec",
    label: "Post-TCEC",
    reviewedColumn: "f.post_tcec_date",
    currentColumn: "f.post_tcec_minutes_date",
    appliesColumn: "f.tcec",
  },
  {
    key: "cnc",
    label: "CNC",
    reviewedColumn: "f.cnc_date",
    currentColumn: "f.cnc_approval_date",
    appliesColumn: "f.tcec",
  },
  { key: "supplyOrder", label: "Supply Order", supplyOrderDate: "so_date" },
  {
    key: "bankGuarantee",
    label: "Bank Guarantee",
    appliesColumn: "f.bg",
    supplyOrderDate: "bg_validity_date",
  },
  { key: "payment", label: "Payment", supplyOrderDate: "payment_date" },
] as const;

const defaultManualMilestones = [
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
  "Supply Order",
  "Delivery Period",
  "Bank Guarantee",
  "Delivery",
  "Payment",
];

function mapDivision(row: DivisionRow): Division {
  return {
    id: row.id,
    name: row.name,
    code: fromDbText(row.code),
    allocatedCapital: fromDbText(row.allocated_capital),
    allocatedRevenue: fromDbText(row.allocated_revenue),
    ad: fromDbText(row.ad),
  };
}

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
    valueThresholdLevels: [],
    milestones: fromDbJsonArray(row.milestones) as string[],
    tableFieldPresets: fromDbJsonArray(row.table_field_presets),
    activeUserId: fromDbText(row.active_user_id) || undefined,
  };
}

async function loadDivisions(user: ReturnType<typeof requireAuth>, financialYear: string) {
  const scopeKey = canUseAllDivisions(user) ? "all" : user.divisionIds.join(",");
  return getCached(
    `divisions:dashboard:${financialYear}:${scopeKey}`,
    cacheTtl.divisionsMs,
    async () => {
      const values: unknown[] = [];
      const conditions = ["coalesce(a.active, false)", "d.archived_at is null"];
      if (!canUseAllDivisions(user)) {
        if (user.divisionIds.length) {
          values.push(user.divisionIds);
          conditions.push(`d.id = any($${values.length}::uuid[])`);
        } else {
          conditions.push("false");
        }
      }
      values.push(financialYear);
      const yearParam = values.length;
      const result = await pool.query<DivisionRow>(
        `select
           d.id,
           d.name,
           d.code,
           coalesce(a.allocated_capital, d.allocated_capital) as allocated_capital,
           coalesce(a.allocated_revenue, d.allocated_revenue) as allocated_revenue,
           d.ad
         from divisions d
         left join division_year_allocations a
           on a.division_id = d.id and a.financial_year = $${yearParam}::text
         where ${conditions.join(" and ")}
         order by d.name asc`,
        values,
      );
      return result.rows.map(mapDivision);
    },
  );
}

async function loadSettings() {
  return getCached("settings:dashboard", cacheTtl.settingsMs, async () => {
    const result = await pool.query<SettingsRow>(
      `select financial_year, selected_year, year_selection_locked, theme, theme_tint, deletion_password,
              tcec_committees, milestones, table_field_presets, active_user_id
       from app_settings
       where id = true`,
    );
    if (!result.rows[0]) throw new HttpError(404, "Settings row not found. Run seed defaults.");
    return mapSettings(result.rows[0]);
  });
}

async function loadValueThresholdLevels(financialYear: string): Promise<ValueThresholdLevel[]> {
  return getCached(`lookup:value-thresholds:${financialYear}`, cacheTtl.lookupMs, async () => {
    const result = await pool.query<{
      id: string;
      level_number: number;
      label: string;
      min_value: string | null;
      max_value: string | null;
      applies_to: ValueThresholdLevel["appliesTo"];
    }>(
      `select id, level_number, label, min_value, max_value, applies_to
       from value_threshold_levels
       where financial_year = $1::text
       order by level_number asc`,
      [financialYear],
    );
    return result.rows.map((row) => ({
      id: row.id,
      label: row.label,
      levelNumber: row.level_number,
      minValue: fromDbText(row.min_value) || undefined,
      maxValue: fromDbText(row.max_value) || undefined,
      appliesTo: row.applies_to,
    }));
  });
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
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
    isYes(file.soCancelled) ||
    Boolean(
      file.supplyOrders?.some(
        (order: SupplyOrderDetail) => isYes(order.demandCancelled) || isYes(order.soCancelled),
      ),
    )
  );
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

function addValue(values: unknown[], value: unknown) {
  values.push(value);
  return `$${values.length}`;
}

function getSelectedYearCondition(selectedYear: string | undefined, values: unknown[]) {
  if (!selectedYear) return undefined;
  if (selectedYear === allActiveFilesYear) {
    return `(not exists (
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
      ))`;
  }

  const placeholder = addValue(values, selectedYear);
  return `(f.year = ${placeholder}::text or exists (
    select 1 from file_year_activity a
    where a.file_id = f.id and a.financial_year = ${placeholder}::text and a.status = 'active'
  ))`;
}

function getDashboardFileWhereSql({
  scopeSql,
  scopeValues,
  selectedYear,
  activeDivision,
  activeAnalyticsDivision,
}: {
  scopeSql: string;
  scopeValues: unknown[];
  selectedYear: string | undefined;
  activeDivision: string;
  activeAnalyticsDivision: string;
}) {
  const conditions: string[] = [];
  const values = [...scopeValues];
  if (scopeSql) conditions.push(scopeSql);

  const selectedYearCondition = getSelectedYearCondition(selectedYear, values);
  if (selectedYearCondition) conditions.push(selectedYearCondition);

  if (activeDivision !== "all") {
    const divisionNames = Array.from(
      new Set(
        [activeDivision, activeAnalyticsDivision === "all" ? undefined : activeAnalyticsDivision]
          .filter((value): value is string => Boolean(value))
          .map((value) => value.toLowerCase()),
      ),
    );
    if (divisionNames.length) {
      const placeholder = addValue(values, divisionNames);
      conditions.push(`lower(coalesce(d.name, '')) = any(${placeholder}::text[])`);
    }
  }

  return {
    whereSql: conditions.length ? `where ${conditions.join(" and ")}` : "",
    values,
  };
}

function appendDashboardWhereClause(whereSql: string, extraConditions: string[] = []) {
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

type SimpleDashboardCounts = {
  dashboardFileCount: number;
  modeCounts: Array<{ name: string; count: number }>;
  topSummaryStats: Array<{
    label: string;
    value: Array<{ label: string; value: number; searchFilter: string }>;
    hint: string;
  }>;
};

type FinanceTotals = {
  allocatedCapital: number;
  allocatedRevenue: number;
  bookedCapital: number;
  bookedRevenue: number;
  projectedCapital: number;
  projectedRevenue: number;
  spentCapital: number;
  spentRevenue: number;
};

type MiscellaneousCounts = {
  liveFiles: number;
  fileClosed: number;
  ld: number;
  demandCancelled: number;
  soCancelled: number;
  multipleSupplyOrders: number;
};

type StatusCounts = {
  milestoneRows: Array<{
    key: string;
    total: number;
    underProcess: number;
    active: number;
    pending: number;
    reviewed: number;
    cleared: number;
  }>;
  liveBids: number;
  overdueBids: number;
  inProcessBids: number;
  liveSupplyOrders: number;
  deliveryCompleted: number;
  deliveryDue: number;
  deliveryOverdue: number;
  deliveryPeriodValid: number;
  deliveryPeriodExpired: number;
  deliveryPeriodExtended: number;
};

type CountAnalyticsRow = { name: string; count: number };
type ValueAnalyticsRow = { name: string; value: number };
type AverageDaysAnalyticsRow = { name: string; averageDays: number; sampleSize: number };
type ThresholdAnalyticsRow = {
  name: string;
  appliesTo: string;
  range: string;
  count: number;
  capital: number;
  revenue: number;
  value: number;
};
type DivisionValueAnalyticsRow = {
  name: string;
  allocatedCapital: number;
  allocatedRevenue: number;
  allocatedTotal: number;
  intendedCapital: number;
  intendedRevenue: number;
  intendedTotal: number;
  bookedCapital: number;
  bookedRevenue: number;
  bookedTotal: number;
  committedCapital: number;
  committedRevenue: number;
  committedTotal: number;
};

type AnalyticsSqlSlice = {
  divisionFileRanking: CountAnalyticsRow[];
  divisionValueRanking: DivisionValueAnalyticsRow[];
  divisionTurnaroundRanking: AverageDaysAnalyticsRow[];
  topFirmSupplyOrders: ValueAnalyticsRow[];
  topIndentorsByFiles: CountAnalyticsRow[];
  topIndentorsByValue: ValueAnalyticsRow[];
  milestoneClearingRanking: AverageDaysAnalyticsRow[];
  monthlyFileInflow: CountAnalyticsRow[];
  biddingModeMix: CountAnalyticsRow[];
  fileValueThresholds: ThresholdAnalyticsRow[];
  divisionRiskRanking: CountAnalyticsRow[];
  divisionPaymentPendingRanking: CountAnalyticsRow[];
};

type ManualMilestoneSqlSlice = {
  manualMilestoneFlow: Array<{ name: string; current: number; completed: number }>;
  visibleLiveMilestoneNames: string[];
  liveStatusRows: Array<{
    division: string;
    counts: Record<string, number>;
    total: number;
  }>;
};

async function loadSimpleDashboardCounts({
  whereSql,
  values,
  activeDivision,
}: {
  whereSql: string;
  values: unknown[];
  activeDivision: string;
}): Promise<SimpleDashboardCounts> {
  const queryValues = [...values];
  const extraConditions: string[] = [];
  if (activeDivision !== "all") {
    const placeholder = addValue(queryValues, activeDivision.toLowerCase());
    extraConditions.push(`lower(coalesce(d.name, '')) = ${placeholder}::text`);
  }

  const modeSelects = modeNames.map(
    (mode) =>
      `${countFilter(`upper(trim(coalesce(f.mode, ''))) = '${mode}'`)} as mode_${mode.toLowerCase()}`,
  );
  const attributeSelects = snapshotAttributeDefinitions.flatMap((attribute, index) => [
    `${countFilter(isYesExpression(attribute.column))} as attribute_${index}_yes`,
    `${countFilter(isNoExpression(attribute.column))} as attribute_${index}_no`,
  ]);
  const result = await pool.query<Record<string, number | string>>(
    `select
       count(*)::integer as dashboard_file_count,
       ${[...modeSelects, ...attributeSelects].join(",\n       ")}
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, extraConditions)}`,
    queryValues,
  );
  const row = result.rows[0] ?? {};
  const readCount = (key: string) => Number(row[key] ?? 0);

  return {
    dashboardFileCount: readCount("dashboard_file_count"),
    modeCounts: modeNames.map((name) => ({ name, count: readCount(`mode_${name.toLowerCase()}`) })),
    topSummaryStats: snapshotAttributeDefinitions.map((attribute, index) => ({
      label: attribute.label,
      value: [
        {
          label: attribute.yesLabel,
          value: readCount(`attribute_${index}_yes`),
          searchFilter: `attribute:${attribute.key}:yes`,
        },
        {
          label: attribute.noLabel,
          value: readCount(`attribute_${index}_no`),
          searchFilter: `attribute:${attribute.key}:no`,
        },
      ],
      hint: `${attribute.yesLabel} and ${attribute.noLabel} files`,
    })),
  };
}

function inrAmountExpression(column: string) {
  return `case
    when ${column} is null then 0
    when upper(trim(coalesce(f.currency, 'INR'))) in ('', 'INR') then ${column}
    when f.exchange_rate > 0 then ${column} * f.exchange_rate
    else 0
  end`;
}

function isCancelledExpression() {
  return `(${isYesExpression("f.demand_cancelled")}
    or ${isYesExpression("f.so_cancelled")}
    or exists (
      select 1 from supply_orders so_cancelled
      where so_cancelled.file_id = f.id
        and (
          ${isYesExpression("so_cancelled.demand_cancelled")}
          or ${isYesExpression("so_cancelled.so_cancelled")}
        )
    ))`;
}

function hasFilledExpression(column: string) {
  return `coalesce(${column}::text, '') <> ''`;
}

function supplyOrderExists(condition: string) {
  return `exists (
    select 1 from supply_orders so
    where so.file_id = f.id and ${condition}
  )`;
}

function supplyOrderRowExists() {
  return `exists (select 1 from supply_orders so_existing where so_existing.file_id = f.id)`;
}

function supplyOrderChildOrLegacyExpression(childCondition: string, legacyCondition: string) {
  return `(${supplyOrderExists(childCondition)} or (not ${supplyOrderRowExists()} and ${legacyCondition}))`;
}

function effectiveDpDateExpression(alias: string) {
  return `greatest(coalesce(${alias}.revised_dp, ${alias}.dp_date), coalesce(${alias}.dp_date, ${alias}.revised_dp))`;
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

function effectiveOrderCancelledExpression(alias = "eso") {
  return `(${isYesExpression(`${alias}.file_demand_cancelled`)}
    or ${isYesExpression(`${alias}.file_so_cancelled`)}
    or ${isYesExpression(`${alias}.demand_cancelled`)}
    or ${isYesExpression(`${alias}.so_cancelled`)})`;
}

function effectiveOrderDpDateExpression(alias = "eso") {
  return `greatest(coalesce(${alias}.revised_dp, ${alias}.dp_date), coalesce(${alias}.dp_date, ${alias}.revised_dp))`;
}

function effectiveOrderPlacedExpression(alias = "eso") {
  return hasFilledExpression(`${alias}.so_date`);
}

function effectiveOrderLiveExpression(alias = "eso") {
  return `${effectiveOrderPlacedExpression(alias)}
    and not ${hasFilledExpression(`${alias}.material_receipt_date`)}
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderDeliveryCompletedExpression(alias = "eso") {
  return `${effectiveOrderPlacedExpression(alias)}
    and ${hasFilledExpression(`${alias}.material_receipt_date`)}
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderDeliveryOverdueExpression(alias = "eso") {
  return `${effectiveOrderLiveExpression(alias)}
    and ${effectiveOrderDpDateExpression(alias)} < current_date`;
}

function effectiveOrderDeliveryPeriodValidExpression(alias = "eso") {
  return `${effectiveOrderLiveExpression(alias)}
    and ${effectiveOrderDpDateExpression(alias)} is not null
    and ${effectiveOrderDpDateExpression(alias)} > current_date`;
}

function effectiveOrderDeliveryPeriodExpiredExpression(alias = "eso") {
  return `${effectiveOrderLiveExpression(alias)}
    and ${effectiveOrderDpDateExpression(alias)} is not null
    and ${effectiveOrderDpDateExpression(alias)} < current_date`;
}

function effectiveOrderDeliveryPeriodExtendedExpression(alias = "eso") {
  return `${effectiveOrderLiveExpression(alias)}
    and ${hasFilledExpression(`${alias}.revised_dp`)}
    and ${effectiveOrderDpDateExpression(alias)} is not null
    and ${effectiveOrderDpDateExpression(alias)} > current_date`;
}

function effectiveOrderBgApplicableExpression(alias = "eso") {
  return `${isYesExpression(`${alias}.file_bg`)}
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderBgReceivedExpression(alias = "eso") {
  return `${effectiveOrderBgApplicableExpression(alias)}
    and ${hasFilledExpression(`${alias}.bg_validity_date`)}`;
}

function effectiveOrderBgPendingExpression(alias = "eso") {
  return `${effectiveOrderBgApplicableExpression(alias)}
    and ${effectiveOrderPlacedExpression(alias)}
    and not ${hasFilledExpression(`${alias}.bg_validity_date`)}`;
}

function effectiveOrderPaymentCompletedExpression(alias = "eso") {
  return `${hasFilledExpression(`${alias}.payment_date`)}
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderPaymentPendingExpression(alias = "eso") {
  return `${hasFilledExpression(`${alias}.material_receipt_date`)}
    and not ${hasFilledExpression(`${alias}.payment_date`)}
    and not ${effectiveOrderCancelledExpression(alias)}`;
}

function effectiveOrderCountFilter(condition: string) {
  return `(select count(*) from effective_supply_orders eso where ${condition})::integer`;
}

function legacySupplyOrderHasDataExpression() {
  return `(${[
    "f.so_date",
    "f.dp_date",
    "f.bg_validity_date",
    "f.dp_extension",
    "f.revised_dp",
    "f.material_receipt_date",
    "f.ir_preparation_date",
    "f.ir_receipt_date",
    "f.bill_preparation_date",
    "f.bill_sent_for_payment_date",
    "f.payment_date",
    "f.bg_return_date",
    "f.ld",
    "f.demand_cancelled",
    "f.so_cancelled",
    "f.so_cancelled_date",
  ]
    .map((column) => hasFilledExpression(column))
    .join(" or ")})`;
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

function fileClosedExpression() {
  return `exists (
    select 1 from file_completed_milestones completed_closed
    where completed_closed.file_id = f.id
      and ${normalizeMilestoneExpression("completed_closed.milestone")} = '${normalizeMilestoneName(
        fileClosedMilestone,
      )}'
  )`;
}

function statusAppliesExpression(milestone: (typeof statusMilestoneDefinitions)[number]) {
  return "appliesColumn" in milestone && milestone.appliesColumn
    ? isYesExpression(milestone.appliesColumn)
    : "true";
}

function statusCompleteExpression(milestone: (typeof statusMilestoneDefinitions)[number]) {
  if ("yesComplete" in milestone && milestone.yesComplete) {
    return isYesExpression(milestone.currentColumn);
  }
  if ("supplyOrderDate" in milestone && milestone.supplyOrderDate) {
    return supplyOrderChildOrLegacyExpression(
      hasFilledExpression(`so.${milestone.supplyOrderDate}`),
      hasFilledExpression(`f.${milestone.supplyOrderDate}`),
    );
  }
  return "currentColumn" in milestone && milestone.currentColumn
    ? hasFilledExpression(milestone.currentColumn)
    : "false";
}

function statusReviewedExpression(milestone: (typeof statusMilestoneDefinitions)[number]) {
  return "reviewedColumn" in milestone && milestone.reviewedColumn
    ? hasFilledExpression(milestone.reviewedColumn)
    : "false";
}

function statusActiveExpression(milestone: (typeof statusMilestoneDefinitions)[number]) {
  const aliases =
    "aliases" in milestone && milestone.aliases ? milestone.aliases : [milestone.label];
  const normalizedAliases = aliases.map((alias) => `'${normalizeMilestoneName(alias)}'`).join(", ");
  return `not ${isCancelledExpression()}
    and ${normalizeMilestoneExpression("f.current_milestone")} in (${normalizedAliases})`;
}

function previousApplicableCompleteExpression(index: number) {
  const previous = statusMilestoneDefinitions.slice(0, index).reverse();
  if (!previous.length) return hasFilledExpression("f.received_date");
  return `case
    ${previous
      .map(
        (milestone) =>
          `when ${statusAppliesExpression(milestone)} then ${statusCompleteExpression(milestone)}`,
      )
      .join("\n    ")}
    else ${hasFilledExpression("f.received_date")}
  end`;
}

function bankGuaranteeEligibleExpression() {
  return `not ${isCancelledExpression()}
    and ${isYesExpression("f.bg")}
    and ${supplyOrderChildOrLegacyExpression(
      `${hasFilledExpression("so.so_date")} and not ${isYesExpression("so.so_cancelled")}`,
      `${hasFilledExpression("f.so_date")} and not ${isYesExpression("f.so_cancelled")}`,
    )}`;
}

async function loadFinanceTotals({
  whereSql,
  values,
  activeDivision,
  dashboardDivisions,
}: {
  whereSql: string;
  values: unknown[];
  activeDivision: string;
  dashboardDivisions: Division[];
}): Promise<FinanceTotals> {
  const queryValues = [...values];
  const extraConditions: string[] = [];
  if (activeDivision !== "all") {
    const placeholder = addValue(queryValues, activeDivision.toLowerCase());
    extraConditions.push(`lower(coalesce(d.name, '')) = ${placeholder}::text`);
  }
  const cancelled = isCancelledExpression();
  const valueCapital = inrAmountExpression("f.value_capital");
  const valueRevenue = inrAmountExpression("f.value_revenue");
  const soValueCapital = inrAmountExpression("f.so_value_capital");
  const soValueRevenue = inrAmountExpression("f.so_value_revenue");
  const result = await pool.query<Record<string, string | number>>(
    `select
       coalesce(sum(case
         when ${cancelled} then 0
         when f.so_value_capital is not null then 0
         else ${valueCapital}
       end), 0) as booked_capital,
       coalesce(sum(case
         when ${cancelled} then 0
         when f.so_value_revenue is not null then 0
         else ${valueRevenue}
       end), 0) as booked_revenue,
       coalesce(sum(case
         when not ${cancelled} and not ${hasFilledExpression("f.imms")} then ${valueCapital}
         else 0
       end), 0) as projected_capital,
       coalesce(sum(case
         when not ${cancelled} and not ${hasFilledExpression("f.imms")} then ${valueRevenue}
         else 0
       end), 0) as projected_revenue,
       coalesce(sum(case when ${cancelled} then 0 else ${soValueCapital} end), 0) as spent_capital,
       coalesce(sum(case when ${cancelled} then 0 else ${soValueRevenue} end), 0) as spent_revenue
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, extraConditions)}`,
    queryValues,
  );
  const row = result.rows[0] ?? {};
  const readAmount = (key: string) => Number(row[key] ?? 0);
  return {
    allocatedCapital: dashboardDivisions.reduce(
      (sum, division) =>
        sum + (Number(String(division.allocatedCapital ?? "").replace(/,/g, "")) || 0),
      0,
    ),
    allocatedRevenue: dashboardDivisions.reduce(
      (sum, division) =>
        sum + (Number(String(division.allocatedRevenue ?? "").replace(/,/g, "")) || 0),
      0,
    ),
    bookedCapital: readAmount("booked_capital"),
    bookedRevenue: readAmount("booked_revenue"),
    projectedCapital: readAmount("projected_capital"),
    projectedRevenue: readAmount("projected_revenue"),
    spentCapital: readAmount("spent_capital"),
    spentRevenue: readAmount("spent_revenue"),
  };
}

function getPercent(value: number, total: number) {
  if (total <= 0) return undefined;
  return (value / total) * 100;
}

function getFinancePercents(financeTotals: FinanceTotals) {
  return {
    capitalBooked: getPercent(financeTotals.bookedCapital, financeTotals.allocatedCapital),
    revenueBooked: getPercent(financeTotals.bookedRevenue, financeTotals.allocatedRevenue),
    capitalProjected: getPercent(financeTotals.projectedCapital, financeTotals.allocatedCapital),
    revenueProjected: getPercent(financeTotals.projectedRevenue, financeTotals.allocatedRevenue),
    capitalSpent: getPercent(financeTotals.spentCapital, financeTotals.allocatedCapital),
    revenueSpent: getPercent(financeTotals.spentRevenue, financeTotals.allocatedRevenue),
  };
}

function roundedFinanceTotals(totals: FinanceTotals): FinanceTotals {
  return {
    allocatedCapital: totals.allocatedCapital,
    allocatedRevenue: totals.allocatedRevenue,
    bookedCapital: Number(totals.bookedCapital.toFixed(6)),
    bookedRevenue: Number(totals.bookedRevenue.toFixed(6)),
    projectedCapital: Number(totals.projectedCapital.toFixed(6)),
    projectedRevenue: Number(totals.projectedRevenue.toFixed(6)),
    spentCapital: Number(totals.spentCapital.toFixed(6)),
    spentRevenue: Number(totals.spentRevenue.toFixed(6)),
  };
}

function analyticsDivisionExtraCondition(values: unknown[], divisionName: string) {
  if (divisionName === "all") return undefined;
  const placeholder = addValue(values, divisionName.toLowerCase());
  return `lower(coalesce(d.name, '')) = ${placeholder}::text`;
}

function analyticsNameExpression(column: string, fallback: string) {
  return `coalesce(nullif(trim(coalesce(${column}, '')), ''), '${fallback}')`;
}

function childSupplyOrderValueSumExpression(column: "so_value_capital" | "so_value_revenue") {
  return `coalesce((
    select sum(${inrAmountExpression(`so_value.${column}`)})
    from supply_orders so_value
    where so_value.file_id = f.id
  ), 0)`;
}

function committedValueExpression(
  fileColumn: "f.so_value_capital" | "f.so_value_revenue",
  supplyOrderColumn: "so_value_capital" | "so_value_revenue",
) {
  return `case
    when ${supplyOrderRowExists()} then ${childSupplyOrderValueSumExpression(supplyOrderColumn)}
    else ${inrAmountExpression(fileColumn)}
  end`;
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

function averageDaysExpression(startDate: string, endDate: string) {
  return `round(avg((${endDate}) - (${startDate})))::integer`;
}

function dateDiffCondition(startDate: string, endDate: string) {
  return `(${startDate}) is not null and (${endDate}) is not null and ((${endDate}) - (${startDate})) >= 0`;
}

function formatThresholdAppliesTo(value: ValueThresholdLevel["appliesTo"]) {
  if (value === "capital") return "Capital";
  if (value === "revenue") return "Revenue";
  return "Both";
}

function formatThresholdRange(level: ValueThresholdLevel) {
  const min = Number(
    String(level.minValue ?? "")
      .replace(/,/g, "")
      .trim(),
  );
  const max = Number(
    String(level.maxValue ?? "")
      .replace(/,/g, "")
      .trim(),
  );
  const hasMin = Number.isFinite(min) && String(level.minValue ?? "").trim() !== "";
  const hasMax = Number.isFinite(max) && String(level.maxValue ?? "").trim() !== "";
  if (hasMin && hasMax) return `${formatLakhRangeAmount(min)}-${formatLakhRangeAmount(max)} L`;
  if (hasMin) return `${formatLakhRangeAmount(min)} L+`;
  if (hasMax) return `0-${formatLakhRangeAmount(max)} L`;
  return "Any value";
}

function formatLakhRangeAmount(value: number) {
  const lakhs = value / 100000;
  return Number.isInteger(lakhs)
    ? String(lakhs)
    : lakhs.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function roundDivisionValueRows(
  rows: Map<
    string,
    Omit<
      DivisionValueAnalyticsRow,
      "name" | "allocatedTotal" | "intendedTotal" | "bookedTotal" | "committedTotal"
    >
  >,
) {
  return Array.from(rows.entries())
    .map(([name, values]) => ({
      name,
      allocatedCapital: Math.round(values.allocatedCapital),
      allocatedRevenue: Math.round(values.allocatedRevenue),
      allocatedTotal: Math.round(values.allocatedCapital + values.allocatedRevenue),
      intendedCapital: Math.round(values.intendedCapital),
      intendedRevenue: Math.round(values.intendedRevenue),
      intendedTotal: Math.round(values.intendedCapital + values.intendedRevenue),
      bookedCapital: Math.round(values.bookedCapital),
      bookedRevenue: Math.round(values.bookedRevenue),
      bookedTotal: Math.round(values.bookedCapital + values.bookedRevenue),
      committedCapital: Math.round(values.committedCapital),
      committedRevenue: Math.round(values.committedRevenue),
      committedTotal: Math.round(values.committedCapital + values.committedRevenue),
    }))
    .sort(
      (a, b) => b.allocatedCapital + b.allocatedRevenue - (a.allocatedCapital + a.allocatedRevenue),
    );
}

async function loadAnalyticsSqlSlice({
  whereSql,
  values,
  divisionName,
  divisions,
  valueThresholdLevels,
}: {
  whereSql: string;
  values: unknown[];
  divisionName: string;
  divisions: Division[];
  valueThresholdLevels: ValueThresholdLevel[];
}): Promise<AnalyticsSqlSlice> {
  const fileRankingValues = [...values];
  const fileRankingConditions: string[] = [];
  const fileRankingDivision = analyticsDivisionExtraCondition(fileRankingValues, divisionName);
  if (fileRankingDivision) fileRankingConditions.push(fileRankingDivision);

  const divisionNameSql = analyticsNameExpression("d.name", "Unassigned");
  const fileRankingResult = await pool.query<{ name: string; count: number }>(
    `select ${divisionNameSql} as name, count(*)::integer as count
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, fileRankingConditions)}
     group by 1
     order by count desc`,
    fileRankingValues,
  );

  const indentorNameSql = analyticsNameExpression("f.indentor", "Unassigned indentor");
  const indentorFileResult = await pool.query<{ name: string; count: number }>(
    `select ${indentorNameSql} as name, count(*)::integer as count
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, fileRankingConditions)}
     group by 1
     order by count desc`,
    fileRankingValues,
  );

  const demandTotal = `${inrAmountExpression("f.value_capital")} + ${inrAmountExpression("f.value_revenue")}`;
  const indentorValueResult = await pool.query<{ name: string; value: string | number }>(
    `select ${indentorNameSql} as name, round(coalesce(sum(${demandTotal}), 0))::integer as value
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, fileRankingConditions)}
     group by 1
     order by value desc`,
    fileRankingValues,
  );

  const modeNameSql = analyticsNameExpression("upper(trim(coalesce(f.mode, '')))", "Unassigned");
  const biddingModeResult = await pool.query<{ name: string; count: number }>(
    `select ${modeNameSql} as name, count(*)::integer as count
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, fileRankingConditions)}
     group by 1
     order by count desc`,
    fileRankingValues,
  );

  const firstSoDate = earliestSupplyOrderDateExpression("so_date");
  const turnaroundResult = await pool.query<AverageDaysAnalyticsRow>(
    `select ${divisionNameSql} as name,
            ${averageDaysExpression("f.received_date", firstSoDate)} as "averageDays",
            count(*)::integer as "sampleSize"
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, [
       ...fileRankingConditions,
       dateDiffCondition("f.received_date", firstSoDate),
     ])}
     group by 1
     order by "averageDays" desc`,
    fileRankingValues,
  );

  const milestoneClearingDefinitions = [
    { name: "Scrutiny", start: "f.received_date", end: "f.scrutiny_completion_date" },
    { name: "High Value", start: "f.high_value_meeting_date", end: "f.high_value_minutes_date" },
    { name: "Pre-TCEC", start: "f.pre_tcec_date", end: "f.pre_tcec_minutes_date" },
    {
      name: "AD",
      start: "coalesce(f.pre_tcec_minutes_date, f.received_date)",
      end: "f.ad_vetting_date",
    },
    { name: "R&QA", start: "f.received_date", end: "f.rqa_approval_date" },
    { name: "Controlling", start: "f.received_date", end: "f.imms_date" },
    { name: "IFA", start: "f.ifa_sent_date", end: "f.ifa_final_date" },
    { name: "CFA", start: "f.cfa_sent_date", end: "f.cfa_date" },
    { name: "Post-TCEC", start: "f.post_tcec_date", end: "f.post_tcec_minutes_date" },
    { name: "CNC", start: "f.cnc_date", end: "f.cnc_approval_date" },
    { name: "Supply Order", start: "f.cfa_date", end: firstSoDate },
    {
      name: "Delivery",
      start: firstSoDate,
      end: earliestSupplyOrderDateExpression("material_receipt_date"),
    },
    {
      name: "Payment",
      start: earliestSupplyOrderDateExpression("material_receipt_date"),
      end: earliestSupplyOrderDateExpression("payment_date"),
    },
  ];
  const milestoneSelects = milestoneClearingDefinitions.map(
    (definition, index) =>
      `select ${index} as sort_order,
              '${definition.name}' as name,
              ${averageDaysExpression(definition.start, definition.end)} as "averageDays",
              count(*)::integer as "sampleSize"
       from files f
       left join divisions d on d.id = f.division_id
       ${appendDashboardWhereClause(whereSql, [
         ...fileRankingConditions,
         dateDiffCondition(definition.start, definition.end),
       ])}`,
  );
  const milestoneResult = await pool.query<AverageDaysAnalyticsRow & { sort_order: number }>(
    `${milestoneSelects.join("\nunion all\n")}
     order by "averageDays" desc`,
    fileRankingValues,
  );

  const monthlyValues = [...fileRankingValues];
  const monthlyResult = await pool.query<{ name: string; count: number }>(
    `select to_char(coalesce(f.received_date, f.file_date), 'YYYY-MM') as name,
            count(*)::integer as count
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, [
       ...fileRankingConditions,
       "coalesce(f.received_date, f.file_date) is not null",
     ])}
     group by 1
     order by name desc
     limit 12`,
    monthlyValues,
  );

  const firmValues = [...fileRankingValues];
  const firmResult = await pool.query<{ name: string; value: string | number }>(
    `with effective_supply_orders as (
       select
         f.id as file_id,
         ${analyticsNameExpression("so.firm", "Unassigned firm")} as name,
         ${inrAmountExpression("so.so_value_capital")} + ${inrAmountExpression("so.so_value_revenue")} as value
       from files f
       left join divisions d on d.id = f.division_id
       join supply_orders so on so.file_id = f.id
       ${appendDashboardWhereClause(whereSql, fileRankingConditions)}
       union all
       select
         f.id as file_id,
         ${analyticsNameExpression("f.firm", "Unassigned firm")} as name,
         ${inrAmountExpression("f.so_value_capital")} + ${inrAmountExpression("f.so_value_revenue")} as value
       from files f
       left join divisions d on d.id = f.division_id
       ${appendDashboardWhereClause(whereSql, [
         ...fileRankingConditions,
         `not ${supplyOrderRowExists()}`,
       ])}
     )
     select name, round(sum(value))::integer as value
     from effective_supply_orders
     where value > 0
     group by 1
     order by value desc`,
    firmValues,
  );

  const riskCondition = `((not ${isCancelledExpression()} and ${deliveryDueOrderExpression()})
    or (not ${isCancelledExpression()} and ${supplyOrderPlacedExpression()} and ${supplyOrderChildOrLegacyExpression(
      `${hasFilledExpression("so.so_date")}
       and ${effectiveDpDateExpression("so")} is not null
       and ${effectiveDpDateExpression("so")} < current_date
       and not ${hasFilledExpression("so.material_receipt_date")}`,
      `${hasFilledExpression("f.so_date")}
       and ${effectiveDpDateExpression("f")} is not null
       and ${effectiveDpDateExpression("f")} < current_date
       and not ${hasFilledExpression("f.material_receipt_date")}`,
    )})
    or ${supplyOrderChildOrLegacyExpression(
      `${isYesExpression("so.ld")} or ${isYesExpression("so.demand_cancelled")} or ${isYesExpression("so.so_cancelled")}`,
      isYesExpression("f.so_cancelled"),
    )})`;
  const riskResult = await pool.query<CountAnalyticsRow>(
    `select ${divisionNameSql} as name, count(*)::integer as count
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, [...fileRankingConditions, riskCondition])}
     group by 1
     order by count desc`,
    fileRankingValues,
  );

  const paymentPendingCondition = `not ${isCancelledExpression()} and ${supplyOrderChildOrLegacyExpression(
    `${hasFilledExpression("so.material_receipt_date")} and not ${hasFilledExpression("so.payment_date")}`,
    `${hasFilledExpression("f.material_receipt_date")} and not ${hasFilledExpression("f.payment_date")}`,
  )}`;
  const paymentPendingResult = await pool.query<CountAnalyticsRow>(
    `select ${divisionNameSql} as name, count(*)::integer as count
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, [...fileRankingConditions, paymentPendingCondition])}
     group by 1
     order by count desc`,
    fileRankingValues,
  );

  const thresholdRows: ThresholdAnalyticsRow[] = [];
  const unmatched = {
    name: "Unmatched",
    appliesTo: "Both",
    range: "Outside configured ranges",
    count: 0,
    capital: 0,
    revenue: 0,
    value: 0,
  };
  const previousThresholdMatches: string[] = [];
  for (const level of valueThresholdLevels) {
    const capital = inrAmountExpression("f.value_capital");
    const revenue = inrAmountExpression("f.value_revenue");
    const valueType = `case when ${capital} > 0 then 'capital' when ${revenue} > 0 then 'revenue' end`;
    const amount = `case when ${capital} > 0 then ${capital} when ${revenue} > 0 then ${revenue} else 0 end`;
    const levelMatchConditions = [`${amount} > 0`];
    if (level.appliesTo !== "both")
      levelMatchConditions.push(`${valueType} = '${level.appliesTo}'`);
    const minValue = Number(
      String(level.minValue ?? "")
        .replace(/,/g, "")
        .trim(),
    );
    const maxValue = Number(
      String(level.maxValue ?? "")
        .replace(/,/g, "")
        .trim(),
    );
    if (Number.isFinite(minValue) && String(level.minValue ?? "").trim() !== "") {
      levelMatchConditions.push(`${amount} >= ${minValue}`);
    }
    if (Number.isFinite(maxValue) && String(level.maxValue ?? "").trim() !== "") {
      levelMatchConditions.push(`${amount} <= ${maxValue}`);
    }
    const levelMatch = `(${levelMatchConditions.join(" and ")})`;
    const thresholdConditions = [
      ...fileRankingConditions,
      `not ${isCancelledExpression()}`,
      levelMatch,
    ];
    if (previousThresholdMatches.length) {
      thresholdConditions.push(`not (${previousThresholdMatches.join(" or ")})`);
    }
    const thresholdResult = await pool.query<{
      count: number;
      capital: string | number;
      revenue: string | number;
    }>(
      `select count(*)::integer as count,
              coalesce(sum(${capital}), 0) as capital,
              coalesce(sum(${revenue}), 0) as revenue
       from files f
       left join divisions d on d.id = f.division_id
       ${appendDashboardWhereClause(whereSql, thresholdConditions)}`,
      fileRankingValues,
    );
    const row = thresholdResult.rows[0];
    thresholdRows.push({
      name: level.label,
      appliesTo: formatThresholdAppliesTo(level.appliesTo),
      range: formatThresholdRange(level),
      count: Number(row?.count ?? 0),
      capital: Math.round(Number(row?.capital ?? 0)),
      revenue: Math.round(Number(row?.revenue ?? 0)),
      value: Math.round(Number(row?.capital ?? 0) + Number(row?.revenue ?? 0)),
    });
    previousThresholdMatches.push(levelMatch);
  }
  if (valueThresholdLevels.length) {
    const capital = inrAmountExpression("f.value_capital");
    const revenue = inrAmountExpression("f.value_revenue");
    const valueType = `case when ${capital} > 0 then 'capital' when ${revenue} > 0 then 'revenue' end`;
    const amount = `case when ${capital} > 0 then ${capital} when ${revenue} > 0 then ${revenue} else 0 end`;
    const levelMatchConditions = valueThresholdLevels.map((level) => {
      const conditions = [`${amount} > 0`];
      if (level.appliesTo !== "both") conditions.push(`${valueType} = '${level.appliesTo}'`);
      const minValue = Number(
        String(level.minValue ?? "")
          .replace(/,/g, "")
          .trim(),
      );
      const maxValue = Number(
        String(level.maxValue ?? "")
          .replace(/,/g, "")
          .trim(),
      );
      if (Number.isFinite(minValue) && String(level.minValue ?? "").trim() !== "") {
        conditions.push(`${amount} >= ${minValue}`);
      }
      if (Number.isFinite(maxValue) && String(level.maxValue ?? "").trim() !== "") {
        conditions.push(`${amount} <= ${maxValue}`);
      }
      return `(${conditions.join(" and ")})`;
    });
    const unmatchedResult = await pool.query<{
      count: number;
      capital: string | number;
      revenue: string | number;
    }>(
      `select count(*)::integer as count,
              coalesce(sum(${capital}), 0) as capital,
              coalesce(sum(${revenue}), 0) as revenue
       from files f
       left join divisions d on d.id = f.division_id
       ${appendDashboardWhereClause(whereSql, [
         ...fileRankingConditions,
         `not ${isCancelledExpression()}`,
         `${amount} > 0`,
         `not (${levelMatchConditions.join(" or ")})`,
       ])}`,
      fileRankingValues,
    );
    const row = unmatchedResult.rows[0];
    unmatched.count = Number(row?.count ?? 0);
    unmatched.capital = Math.round(Number(row?.capital ?? 0));
    unmatched.revenue = Math.round(Number(row?.revenue ?? 0));
    unmatched.value = Math.round(Number(row?.capital ?? 0) + Number(row?.revenue ?? 0));
  }

  const valueValues = [...values];
  const valueConditions: string[] = [];
  const valueDivision = analyticsDivisionExtraCondition(valueValues, divisionName);
  if (valueDivision) valueConditions.push(valueDivision);
  const cancelled = isCancelledExpression();
  const demandCapital = inrAmountExpression("f.value_capital");
  const demandRevenue = inrAmountExpression("f.value_revenue");
  const committedCapital = committedValueExpression("f.so_value_capital", "so_value_capital");
  const committedRevenue = committedValueExpression("f.so_value_revenue", "so_value_revenue");
  const valueResult = await pool.query<{
    name: string;
    intended_capital: string | number;
    intended_revenue: string | number;
    booked_capital: string | number;
    booked_revenue: string | number;
    committed_capital: string | number;
    committed_revenue: string | number;
  }>(
    `select
       ${divisionNameSql} as name,
       coalesce(sum(case when not ${cancelled} and not ${hasFilledExpression("f.imms")} then ${demandCapital} else 0 end), 0)
         as intended_capital,
       coalesce(sum(case when not ${cancelled} and not ${hasFilledExpression("f.imms")} then ${demandRevenue} else 0 end), 0)
         as intended_revenue,
       coalesce(sum(case when not ${cancelled} and ${committedCapital} <= 0 then ${demandCapital} else 0 end), 0)
         as booked_capital,
       coalesce(sum(case when not ${cancelled} and ${committedRevenue} <= 0 then ${demandRevenue} else 0 end), 0)
         as booked_revenue,
       coalesce(sum(case when not ${cancelled} then ${committedCapital} else 0 end), 0)
         as committed_capital,
       coalesce(sum(case when not ${cancelled} then ${committedRevenue} else 0 end), 0)
         as committed_revenue
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, valueConditions)}
     group by 1`,
    valueValues,
  );

  const divisionValues = new Map<
    string,
    Omit<
      DivisionValueAnalyticsRow,
      "name" | "allocatedTotal" | "intendedTotal" | "bookedTotal" | "committedTotal"
    >
  >();
  const getDivisionValues = (name: string) =>
    divisionValues.get(name) ?? {
      allocatedCapital: 0,
      allocatedRevenue: 0,
      intendedCapital: 0,
      intendedRevenue: 0,
      bookedCapital: 0,
      bookedRevenue: 0,
      committedCapital: 0,
      committedRevenue: 0,
    };
  for (const division of divisions) {
    const name = division.name?.trim() || "Unassigned";
    const current = getDivisionValues(name);
    divisionValues.set(name, {
      ...current,
      allocatedCapital:
        current.allocatedCapital +
        (Number(String(division.allocatedCapital ?? "").replace(/,/g, "")) || 0),
      allocatedRevenue:
        current.allocatedRevenue +
        (Number(String(division.allocatedRevenue ?? "").replace(/,/g, "")) || 0),
    });
  }
  for (const row of valueResult.rows) {
    const current = getDivisionValues(row.name);
    divisionValues.set(row.name, {
      allocatedCapital: current.allocatedCapital,
      allocatedRevenue: current.allocatedRevenue,
      intendedCapital: current.intendedCapital + Number(row.intended_capital ?? 0),
      intendedRevenue: current.intendedRevenue + Number(row.intended_revenue ?? 0),
      bookedCapital: current.bookedCapital + Number(row.booked_capital ?? 0),
      bookedRevenue: current.bookedRevenue + Number(row.booked_revenue ?? 0),
      committedCapital: current.committedCapital + Number(row.committed_capital ?? 0),
      committedRevenue: current.committedRevenue + Number(row.committed_revenue ?? 0),
    });
  }

  return {
    divisionFileRanking: fileRankingResult.rows.map((row) => ({
      name: row.name,
      count: Number(row.count ?? 0),
    })),
    divisionValueRanking: roundDivisionValueRows(divisionValues),
    divisionTurnaroundRanking: turnaroundResult.rows.map((row) => ({
      name: row.name,
      averageDays: Number(row.averageDays ?? 0),
      sampleSize: Number(row.sampleSize ?? 0),
    })),
    topFirmSupplyOrders: firmResult.rows.map((row) => ({
      name: row.name,
      value: Number(row.value ?? 0),
    })),
    topIndentorsByFiles: indentorFileResult.rows.map((row) => ({
      name: row.name,
      count: Number(row.count ?? 0),
    })),
    topIndentorsByValue: indentorValueResult.rows.map((row) => ({
      name: row.name,
      value: Number(row.value ?? 0),
    })),
    milestoneClearingRanking: milestoneResult.rows
      .filter((row) => Number(row.sampleSize ?? 0) > 0)
      .map((row) => ({
        name: row.name,
        averageDays: Number(row.averageDays ?? 0),
        sampleSize: Number(row.sampleSize ?? 0),
      })),
    monthlyFileInflow: monthlyResult.rows
      .map((row) => ({ name: row.name, count: Number(row.count ?? 0) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    biddingModeMix: biddingModeResult.rows.map((row) => ({
      name: row.name,
      count: Number(row.count ?? 0),
    })),
    fileValueThresholds: unmatched.count ? [...thresholdRows, unmatched] : thresholdRows,
    divisionRiskRanking: riskResult.rows.map((row) => ({
      name: row.name,
      count: Number(row.count ?? 0),
    })),
    divisionPaymentPendingRanking: paymentPendingResult.rows.map((row) => ({
      name: row.name,
      count: Number(row.count ?? 0),
    })),
  };
}

async function loadMiscellaneousCounts({
  whereSql,
  values,
  activeDivision,
}: {
  whereSql: string;
  values: unknown[];
  activeDivision: string;
}): Promise<MiscellaneousCounts> {
  const queryValues = [...values];
  const extraConditions: string[] = [];
  if (activeDivision !== "all") {
    const placeholder = addValue(queryValues, activeDivision.toLowerCase());
    extraConditions.push(`lower(coalesce(d.name, '')) = ${placeholder}::text`);
  }
  const miscellaneousWhereSql = appendDashboardWhereClause(whereSql, extraConditions);
  const result = await pool.query<Record<string, string | number>>(
    `with effective_supply_orders as (
       select
         f.id as file_id,
         so.ld,
         so.demand_cancelled,
         so.so_cancelled
       from files f
       left join divisions d on d.id = f.division_id
       join supply_orders so on so.file_id = f.id
       ${miscellaneousWhereSql}
       union all
       select
         f.id as file_id,
         f.ld,
         f.demand_cancelled,
         f.so_cancelled
       from files f
       left join divisions d on d.id = f.division_id
       ${appendDashboardWhereClause(whereSql, [
         ...extraConditions,
         `not ${supplyOrderRowExists()}`,
         legacySupplyOrderHasDataExpression(),
       ])}
     )
     select
       count(*) filter (
         where not ${fileClosedExpression()} and not ${isCancelledExpression()}
       )::integer as live_files,
       count(*) filter (
         where ${fileClosedExpression()}
       )::integer as file_closed,
       (select count(*) from effective_supply_orders eso where ${isYesExpression("eso.ld")} and not ${isYesExpression("eso.so_cancelled")})::integer as ld,
       count(*) filter (
         where exists (
           select 1 from supply_orders so
           where so.file_id = f.id and ${isYesExpression("so.demand_cancelled")}
         )
       )::integer as demand_cancelled,
       count(*) filter (
         where exists (
           select 1 from supply_orders so
           where so.file_id = f.id and ${isYesExpression("so.so_cancelled")}
         )
       )::integer as so_cancelled,
       count(*) filter (
         where (
           select count(*)
           from supply_orders so
           where so.file_id = f.id
         ) > 1
       )::integer as multiple_supply_orders
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, extraConditions)}`,
    queryValues,
  );
  const row = result.rows[0] ?? {};
  const readCount = (key: string) => Number(row[key] ?? 0);
  return {
    liveFiles: readCount("live_files"),
    fileClosed: readCount("file_closed"),
    ld: readCount("ld"),
    demandCancelled: readCount("demand_cancelled"),
    soCancelled: readCount("so_cancelled"),
    multipleSupplyOrders: readCount("multiple_supply_orders"),
  };
}

function getConfiguredMilestones(milestones: string[] | undefined) {
  const values = (milestones ?? [])
    .map((item) => normalizeConfiguredMilestoneLabel(item.trim()))
    .filter(Boolean);
  const configured = values.length ? values : defaultManualMilestones;
  return appendFileClosedMilestone(configured);
}

function appendFileClosedMilestone(milestones: string[]) {
  const withoutFileClosed = milestones.filter(
    (milestone) =>
      normalizeMilestoneName(milestone) !== normalizeMilestoneName(fileClosedMilestone),
  );
  return [...withoutFileClosed, fileClosedMilestone];
}

function normalizeConfiguredMilestoneLabel(milestone: string) {
  return normalizeMilestoneName(milestone) === "controlled" ? "Controlling" : milestone;
}

async function loadManualMilestoneSqlSlice({
  whereSql,
  values,
  activeDivision,
  divisions,
  configuredMilestones,
  liveMilestones,
}: {
  whereSql: string;
  values: unknown[];
  activeDivision: string;
  divisions: Division[];
  configuredMilestones: string[];
  liveMilestones?: string[];
}): Promise<ManualMilestoneSqlSlice> {
  const queryValues = [...values];
  const extraConditions: string[] = [];
  if (activeDivision !== "all") {
    const placeholder = addValue(queryValues, activeDivision.toLowerCase());
    extraConditions.push(`lower(coalesce(d.name, '')) = ${placeholder}::text`);
  }
  const liveConfiguredMilestones = configuredMilestones.filter(
    (milestone) =>
      normalizeMilestoneName(milestone) !== normalizeMilestoneName(fileClosedMilestone),
  );
  const extrasValues = [...queryValues];
  const configuredPlaceholder = addValue(extrasValues, liveConfiguredMilestones);
  const extrasResult = await pool.query<{ name: string }>(
    `select distinct trim(f.current_milestone) as name
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, [
       ...extraConditions,
       "trim(coalesce(f.current_milestone, '')) <> ''",
       `not (trim(f.current_milestone) = any(${configuredPlaceholder}::text[]))`,
     ])}
     order by name asc`,
    extrasValues,
  );
  const milestoneNames = [
    ...liveConfiguredMilestones,
    ...extrasResult.rows.map((row) => row.name).filter(Boolean),
  ];
  const currentValues = [...queryValues];
  const currentMilestonePlaceholder = addValue(currentValues, milestoneNames);
  const currentResult = await pool.query<{ name: string; count: number }>(
    `select milestone.name, count(f.id)::integer as count
     from unnest(${currentMilestonePlaceholder}::text[]) as milestone(name)
     left join files f on f.current_milestone = milestone.name
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql.replace(/^where/i, "where f.id is not null and"), [
       ...extraConditions,
       `not ${isCancelledExpression()}`,
     ])}
     group by milestone.name`,
    currentValues,
  );
  const completedValues = [...queryValues];
  const completedMilestonePlaceholder = addValue(completedValues, milestoneNames);
  const completedResult = await pool.query<{ name: string; count: number }>(
    `select milestone.name, count(completed.file_id)::integer as count
     from unnest(${completedMilestonePlaceholder}::text[]) as milestone(name)
     left join file_completed_milestones completed on completed.milestone = milestone.name
     left join files f on f.id = completed.file_id
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql.replace(/^where/i, "where f.id is not null and"), [
       ...extraConditions,
     ])}
     group by milestone.name`,
    completedValues,
  );
  const currentCounts = new Map(
    currentResult.rows.map((row) => [row.name, Number(row.count ?? 0)]),
  );
  const completedCounts = new Map(
    completedResult.rows.map((row) => [row.name, Number(row.count ?? 0)]),
  );
  const manualMilestoneFlow = milestoneNames.map((name) => ({
    name,
    current: currentCounts.get(name) ?? 0,
    completed: completedCounts.get(name) ?? 0,
  }));
  const visibleLiveMilestoneNames =
    liveMilestones?.filter((name) =>
      manualMilestoneFlow.some((milestone) => milestone.name === name),
    ) ?? manualMilestoneFlow.map((milestone) => milestone.name);

  const liveValues = [...queryValues];
  const livePlaceholder = addValue(liveValues, visibleLiveMilestoneNames);
  const liveCountsResult = await pool.query<{ division: string; milestone: string; count: number }>(
    `select ${analyticsNameExpression("d.name", "Unassigned")} as division,
            f.current_milestone as milestone,
            count(*)::integer as count
     from files f
     left join divisions d on d.id = f.division_id
     ${appendDashboardWhereClause(whereSql, [
       ...extraConditions,
       `f.current_milestone = any(${livePlaceholder}::text[])`,
       `not ${isCancelledExpression()}`,
     ])}
     group by 1, 2`,
    liveValues,
  );
  const divisionNames = Array.from(
    new Set([
      ...divisions.map((division) => division.name),
      ...liveCountsResult.rows.map((row) => row.division),
    ]),
  );
  const liveCounts = new Map(
    liveCountsResult.rows.map((row) => [
      `${row.division}\u0000${row.milestone}`,
      Number(row.count ?? 0),
    ]),
  );
  const liveStatusRows = divisionNames
    .map((division) => {
      const counts = Object.fromEntries(
        visibleLiveMilestoneNames.map((milestone) => [
          milestone,
          liveCounts.get(`${division}\u0000${milestone}`) ?? 0,
        ]),
      );
      return {
        division,
        counts,
        total: Object.values(counts).reduce((sum, count) => sum + count, 0),
      };
    })
    .sort((a, b) => b.total - a.total || a.division.localeCompare(b.division));

  return { manualMilestoneFlow, visibleLiveMilestoneNames, liveStatusRows };
}

async function loadStatusCounts({
  whereSql,
  values,
  activeDivision,
}: {
  whereSql: string;
  values: unknown[];
  activeDivision: string;
}): Promise<StatusCounts> {
  const queryValues = [...values];
  const extraConditions: string[] = [];
  if (activeDivision !== "all") {
    const placeholder = addValue(queryValues, activeDivision.toLowerCase());
    extraConditions.push(`lower(coalesce(d.name, '')) = ${placeholder}::text`);
  }
  const cancelled = isCancelledExpression();
  const supplyOrderPlaced = supplyOrderPlacedExpression();
  const statusWhereSql = appendDashboardWhereClause(whereSql, extraConditions);
  const bidOverdue = `${isNoExpression("f.bid_opened")}
          and (f.bid_opening_date < current_date or f.refloat_bid_opening_date < current_date)`;
  const milestoneSelects = statusMilestoneDefinitions.flatMap((milestone, index) => {
    const prefix = `milestone_${index}`;
    const applies = statusAppliesExpression(milestone);
    const complete = statusCompleteExpression(milestone);
    const active = `${applies} and ${statusActiveExpression(milestone)}`;
    if (milestone.key === "bankGuarantee") {
      const eligible = bankGuaranteeEligibleExpression();
      const cleared = `${eligible} and ${complete}`;
      return [
        `${countFilter(eligible)} as ${prefix}_total`,
        `${countFilter(`${applies} and not (${supplyOrderPlaced})`)} as ${prefix}_under_process`,
        `${countFilter(`${eligible} and ${statusActiveExpression(milestone)}`)} as ${prefix}_active`,
        `${countFilter(`${eligible} and ${statusActiveExpression(milestone)} and not (${complete})`)}
          as ${prefix}_pending`,
        `0::integer as ${prefix}_reviewed`,
        `${countFilter(cleared)} as ${prefix}_cleared`,
      ];
    }
    const previousComplete = previousApplicableCompleteExpression(index);
    const reviewed = statusReviewedExpression(milestone);
    return [
      `${countFilter(applies)} as ${prefix}_total`,
      `${countFilter(`${applies} and not (${previousComplete})`)} as ${prefix}_under_process`,
      `${countFilter(active)} as ${prefix}_active`,
      `${countFilter(
        "reviewedColumn" in milestone && milestone.reviewedColumn
          ? `${active} and not (${reviewed}) and not (${complete})`
          : `${active} and not (${complete})`,
      )} as ${prefix}_pending`,
      `${countFilter(`${active} and ${reviewed} and not (${complete})`)} as ${prefix}_reviewed`,
      `${countFilter(`${applies} and ${complete}`)} as ${prefix}_cleared`,
    ];
  });
  const result = await pool.query<Record<string, string | number>>(
    `with effective_supply_orders as (
       select
         f.id as file_id,
         f.bg as file_bg,
         f.demand_cancelled as file_demand_cancelled,
         f.so_cancelled as file_so_cancelled,
         so.so_date,
         so.dp_date,
         so.revised_dp,
         so.material_receipt_date,
         so.payment_date,
         so.bg_validity_date,
         so.ld,
         so.demand_cancelled,
         so.so_cancelled
       from files f
       left join divisions d on d.id = f.division_id
       join supply_orders so on so.file_id = f.id
       ${statusWhereSql}
       union all
       select
         f.id as file_id,
         f.bg as file_bg,
         f.demand_cancelled as file_demand_cancelled,
         f.so_cancelled as file_so_cancelled,
         f.so_date,
         f.dp_date,
         f.revised_dp,
         f.material_receipt_date,
         f.payment_date,
         f.bg_validity_date,
         f.ld,
         f.demand_cancelled,
         f.so_cancelled
       from files f
       left join divisions d on d.id = f.division_id
       ${appendDashboardWhereClause(whereSql, [
         ...extraConditions,
         `not ${supplyOrderRowExists()}`,
         legacySupplyOrderHasDataExpression(),
       ])}
     )
     select
       ${milestoneSelects.join(",\n       ")},
      ${countFilter(isYesExpression("f.tender_live"))} as live_bids,
      ${countFilter(bidOverdue)} as overdue_bids,
      ${countFilter(
         `not ${cancelled}
          and regexp_replace(lower(coalesce(f.current_milestone, '')), '[^a-z0-9]+', '', 'g') = 'bidding'
          and not ${isYesExpression("f.tender_live")}
          and not (${bidOverdue})`,
       )} as in_process_bids,
       ${effectiveOrderCountFilter("true")} as order_supply_order_total,
       ${effectiveOrderCountFilter(effectiveOrderPlacedExpression())} as order_supply_order_placed,
       ${effectiveOrderCountFilter(effectiveOrderLiveExpression())} as live_supply_orders,
       ${effectiveOrderCountFilter(effectiveOrderBgApplicableExpression())} as order_bg_total,
       ${effectiveOrderCountFilter(effectiveOrderBgReceivedExpression())} as order_bg_received,
       ${effectiveOrderCountFilter(effectiveOrderBgPendingExpression())} as order_bg_pending,
       ${effectiveOrderCountFilter(effectiveOrderPaymentCompletedExpression())} as order_payment_completed,
       ${effectiveOrderCountFilter(effectiveOrderPaymentPendingExpression())} as order_payment_pending,
       ${effectiveOrderCountFilter(effectiveOrderDeliveryCompletedExpression())} as delivery_completed,
       ${effectiveOrderCountFilter(effectiveOrderLiveExpression())} as delivery_due,
       ${effectiveOrderCountFilter(effectiveOrderDeliveryOverdueExpression())} as delivery_overdue,
       ${effectiveOrderCountFilter(effectiveOrderDeliveryPeriodValidExpression())} as delivery_period_valid,
       ${effectiveOrderCountFilter(effectiveOrderDeliveryPeriodExpiredExpression())} as delivery_period_expired,
       ${effectiveOrderCountFilter(effectiveOrderDeliveryPeriodExtendedExpression())} as delivery_period_extended
     from files f
     left join divisions d on d.id = f.division_id
     ${statusWhereSql}`,
    queryValues,
  );
  const row = result.rows[0] ?? {};
  const readCount = (key: string) => Number(row[key] ?? 0);
  return {
    milestoneRows: statusMilestoneDefinitions.map((milestone, index) => {
      const prefix = `milestone_${index}`;
      const base = {
        key: milestone.key,
        total: readCount(`${prefix}_total`),
        underProcess: readCount(`${prefix}_under_process`),
        active: readCount(`${prefix}_active`),
        pending: readCount(`${prefix}_pending`),
        reviewed: readCount(`${prefix}_reviewed`),
        cleared: readCount(`${prefix}_cleared`),
      };
      if (milestone.key === "supplyOrder") {
        return {
          ...base,
          total: readCount("order_supply_order_total"),
          cleared: readCount("order_supply_order_placed"),
        };
      }
      if (milestone.key === "bankGuarantee") {
        return {
          ...base,
          total: readCount("order_bg_total"),
          pending: readCount("order_bg_pending"),
          cleared: readCount("order_bg_received"),
        };
      }
      if (milestone.key === "payment") {
        return {
          ...base,
          total: readCount("order_payment_completed") + readCount("order_payment_pending"),
          pending: readCount("order_payment_pending"),
          cleared: readCount("order_payment_completed"),
        };
      }
      return base;
    }),
    liveBids: readCount("live_bids"),
    overdueBids: readCount("overdue_bids"),
    inProcessBids: readCount("in_process_bids"),
    liveSupplyOrders: readCount("live_supply_orders"),
    deliveryCompleted: readCount("delivery_completed"),
    deliveryDue: readCount("delivery_due"),
    deliveryOverdue: readCount("delivery_overdue"),
    deliveryPeriodValid: readCount("delivery_period_valid"),
    deliveryPeriodExpired: readCount("delivery_period_expired"),
    deliveryPeriodExtended: readCount("delivery_period_extended"),
  };
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function warnIfSimpleCountsDiffer(
  reference: SimpleDashboardCounts,
  candidate: SimpleDashboardCounts,
) {
  if (stableJson(reference) === stableJson(candidate)) return;
  console.warn("Dashboard SQL simple counts differ from TypeScript summary.", {
    reference,
    candidate,
  });
}

function warnIfFinanceTotalsDiffer(reference: FinanceTotals, candidate: FinanceTotals) {
  if (stableJson(roundedFinanceTotals(reference)) === stableJson(roundedFinanceTotals(candidate))) {
    return;
  }
  console.warn("Dashboard SQL finance totals differ from TypeScript summary.", {
    reference,
    candidate,
  });
}

function warnIfMiscellaneousCountsDiffer(
  reference: MiscellaneousCounts,
  candidate: MiscellaneousCounts,
) {
  if (stableJson(reference) === stableJson(candidate)) return;
  console.warn("Dashboard SQL miscellaneous counts differ from TypeScript summary.", {
    reference,
    candidate,
  });
}

function getStatusCountsFromFlow(statusFlow: Array<Record<string, unknown>>): StatusCounts {
  const findRow = (key: string) => statusFlow.find((row) => row.key === key) ?? {};
  const bidding = findRow("bidding");
  const supplyOrder = findRow("supplyOrder");
  const delivery = findRow("delivery");
  const deliveryPeriod = findRow("deliveryPeriod");
  const readCount = (row: Record<string, unknown>, key: string) => Number(row[key] ?? 0);
  return {
    milestoneRows: statusMilestoneDefinitions.map((milestone) => {
      const row = findRow(milestone.key);
      return {
        key: milestone.key,
        total: readCount(row, "total"),
        underProcess: readCount(row, "underProcess"),
        active: readCount(row, "active"),
        pending: readCount(row, "pending"),
        reviewed: readCount(row, "reviewed"),
        cleared: readCount(row, "cleared"),
      };
    }),
    liveBids: readCount(bidding, "liveBids"),
    overdueBids: readCount(bidding, "overdueBids"),
    inProcessBids: readCount(bidding, "inProcessBids"),
    liveSupplyOrders: readCount(supplyOrder, "liveSupplyOrders"),
    deliveryCompleted: readCount(delivery, "completed"),
    deliveryDue: readCount(delivery, "due"),
    deliveryOverdue: readCount(delivery, "overdue"),
    deliveryPeriodValid: readCount(deliveryPeriod, "valid"),
    deliveryPeriodExpired: readCount(deliveryPeriod, "expired"),
    deliveryPeriodExtended: readCount(deliveryPeriod, "extended"),
  };
}

function mergeStatusCountsIntoFlow<T extends Array<Record<string, unknown>>>(
  statusFlow: T,
  counts: StatusCounts,
) {
  const milestoneCountByKey = new Map(counts.milestoneRows.map((row) => [row.key, row]));
  return statusFlow.map((row) => {
    const milestoneCounts =
      typeof row.key === "string" ? milestoneCountByKey.get(row.key) : undefined;
    const baseRow = milestoneCounts
      ? {
          ...row,
          total: milestoneCounts.total,
          underProcess: milestoneCounts.underProcess,
          active: milestoneCounts.active,
          pending: milestoneCounts.pending,
          reviewed: milestoneCounts.reviewed,
          cleared: milestoneCounts.cleared,
        }
      : row;
    if (row.key === "bidding") {
      return {
        ...baseRow,
        liveBids: counts.liveBids,
        overdueBids: counts.overdueBids,
        inProcessBids: counts.inProcessBids,
      };
    }
    if (row.key === "supplyOrder") {
      return { ...baseRow, liveSupplyOrders: counts.liveSupplyOrders };
    }
    if (row.key === "delivery") {
      return {
        ...baseRow,
        completed: counts.deliveryCompleted,
        due: counts.deliveryDue,
        overdue: counts.deliveryOverdue,
      };
    }
    if (row.key === "deliveryPeriod") {
      return {
        ...baseRow,
        valid: counts.deliveryPeriodValid,
        expired: counts.deliveryPeriodExpired,
        extended: counts.deliveryPeriodExtended,
      };
    }
    return baseRow;
  });
}

function warnIfStatusCountsDiffer(reference: StatusCounts, candidate: StatusCounts) {
  if (stableJson(reference) === stableJson(candidate)) return;
  console.warn("Dashboard SQL status counts differ from TypeScript summary.", {
    reference,
    candidate,
  });
}

function getStatusMilestonePresentation(key: string) {
  if (
    key === "highValue" ||
    key === "tcec" ||
    key === "ad" ||
    key === "rqa" ||
    key === "ifa" ||
    key === "postTcec" ||
    key === "cnc"
  ) {
    return { totalLabel: "Total cases", completedLabel: "Completed" };
  }
  if (key === "supplyOrder") {
    return { totalLabel: "Total files", completedLabel: "Placed" };
  }
  if (key === "bankGuarantee") {
    return { totalLabel: "Total files", completedLabel: "Received" };
  }
  return { totalLabel: "Total files", completedLabel: "Completed" };
}

function buildStatusFlowFromSql(counts: StatusCounts) {
  const milestoneCounts = new Map(counts.milestoneRows.map((row) => [row.key, row]));
  const milestoneRows = statusMilestoneDefinitions.map((milestone) => {
    const row = milestoneCounts.get(milestone.key);
    const presentation = getStatusMilestonePresentation(milestone.key);
    const base = {
      key: milestone.key,
      label: milestone.label,
      completedLabel: presentation.completedLabel,
      totalLabel: presentation.totalLabel,
      pendingLabel: "Pending",
      total: row?.total ?? 0,
      underProcess: row?.underProcess ?? 0,
      active: row?.active ?? 0,
      pending: row?.pending ?? 0,
      reviewed: row?.reviewed ?? 0,
      hasReviewed: "reviewedColumn" in milestone && Boolean(milestone.reviewedColumn),
      cleared: row?.cleared ?? 0,
      activeLabel: "In process",
    };
    if (milestone.key === "bidding") {
      return {
        ...base,
        liveBids: counts.liveBids,
        overdueBids: counts.overdueBids,
        inProcessBids: counts.inProcessBids,
      };
    }
    if (milestone.key === "supplyOrder") {
      return { ...base, liveSupplyOrders: counts.liveSupplyOrders };
    }
    return base;
  });
  const supplyOrderIndex = milestoneRows.findIndex((row) => row.key === "supplyOrder");
  const deliveryPeriod = {
    key: "deliveryPeriod",
    label: "Delivery Period",
    valid: counts.deliveryPeriodValid,
    expired: counts.deliveryPeriodExpired,
    extended: counts.deliveryPeriodExtended,
  };
  const withDeliveryPeriod =
    supplyOrderIndex === -1
      ? [...milestoneRows, deliveryPeriod]
      : [
          ...milestoneRows.slice(0, supplyOrderIndex + 1),
          deliveryPeriod,
          ...milestoneRows.slice(supplyOrderIndex + 1),
        ];
  const bankGuaranteeIndex = withDeliveryPeriod.findIndex((row) => row.key === "bankGuarantee");
  const delivery = {
    key: "delivery",
    label: "Delivery",
    completed: counts.deliveryCompleted,
    due: counts.deliveryDue,
    overdue: counts.deliveryOverdue,
  };
  return bankGuaranteeIndex === -1
    ? [...withDeliveryPeriod, delivery]
    : [
        ...withDeliveryPeriod.slice(0, bankGuaranteeIndex + 1),
        delivery,
        ...withDeliveryPeriod.slice(bankGuaranteeIndex + 1),
      ];
}

function getAnalyticsSqlSlice(analytics: AnalyticsSqlSlice): AnalyticsSqlSlice {
  return {
    divisionFileRanking: analytics.divisionFileRanking,
    divisionValueRanking: analytics.divisionValueRanking,
    divisionTurnaroundRanking: analytics.divisionTurnaroundRanking,
    topFirmSupplyOrders: analytics.topFirmSupplyOrders,
    topIndentorsByFiles: analytics.topIndentorsByFiles,
    topIndentorsByValue: analytics.topIndentorsByValue,
    milestoneClearingRanking: analytics.milestoneClearingRanking,
    monthlyFileInflow: analytics.monthlyFileInflow,
    biddingModeMix: analytics.biddingModeMix,
    fileValueThresholds: analytics.fileValueThresholds,
    divisionRiskRanking: analytics.divisionRiskRanking,
    divisionPaymentPendingRanking: analytics.divisionPaymentPendingRanking,
  };
}

function warnIfAnalyticsSqlSliceDiffers(
  label: string,
  reference: AnalyticsSqlSlice,
  candidate: AnalyticsSqlSlice,
) {
  if (stableJson(reference) === stableJson(candidate)) return;
  console.warn(`Dashboard SQL ${label} analytics differ from TypeScript summary.`, {
    reference,
    candidate,
  });
}

function mergeAnalyticsSqlSlice<T extends AnalyticsSqlSlice>(
  analytics: T,
  slice: AnalyticsSqlSlice,
) {
  return {
    ...analytics,
    divisionFileRanking: slice.divisionFileRanking,
    divisionValueRanking: slice.divisionValueRanking,
    divisionTurnaroundRanking: slice.divisionTurnaroundRanking,
    topFirmSupplyOrders: slice.topFirmSupplyOrders,
    topIndentorsByFiles: slice.topIndentorsByFiles,
    topIndentorsByValue: slice.topIndentorsByValue,
    milestoneClearingRanking: slice.milestoneClearingRanking,
    monthlyFileInflow: slice.monthlyFileInflow,
    biddingModeMix: slice.biddingModeMix,
    fileValueThresholds: slice.fileValueThresholds,
    divisionRiskRanking: slice.divisionRiskRanking,
    divisionPaymentPendingRanking: slice.divisionPaymentPendingRanking,
  };
}

function warnIfManualMilestoneSqlSliceDiffers(
  reference: ManualMilestoneSqlSlice,
  candidate: ManualMilestoneSqlSlice,
) {
  if (stableJson(reference) === stableJson(candidate)) return;
  console.warn("Dashboard SQL manual milestone flow differs from TypeScript summary.", {
    reference,
    candidate,
  });
}

dashboardRouter.get(
  "/summary",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const scope = getDivisionScopeCondition(user);
    const settings = await loadSettings();
    const selectedYear = readString(request.query.selectedYear) ?? settings.selectedYear;
    const divisionYear =
      selectedYear === allActiveFilesYear ? settings.financialYear : selectedYear;
    const [valueThresholdLevels, divisions] = await Promise.all([
      divisionYear ? loadValueThresholdLevels(divisionYear) : [],
      loadDivisions(user, divisionYear),
    ]);
    const requestedDivision = readString(request.query.division) ?? "all";
    const requestedAnalyticsDivision = readString(request.query.analyticsDivision) ?? "all";
    const activeDivision =
      requestedDivision === "all" || divisions.some((item) => item.name === requestedDivision)
        ? requestedDivision
        : "all";
    const activeAnalyticsDivision =
      requestedAnalyticsDivision === "all" ||
      divisions.some((item) => item.name === requestedAnalyticsDivision)
        ? requestedAnalyticsDivision
        : "all";
    const dashboardFileWhere = getDashboardFileWhereSql({
      scopeSql: scope.sql,
      scopeValues: scope.values,
      selectedYear,
      activeDivision,
      activeAnalyticsDivision,
    });
    const dashboardDivisions =
      activeDivision === "all"
        ? divisions
        : divisions.filter((division) => division.name === activeDivision);
    const analyticsSliceDivision = activeDivision;
    const divisionFilteredSliceDivision =
      activeAnalyticsDivision === "all" ? activeDivision : activeAnalyticsDivision;
    const divisionFilteredSliceDivisions =
      activeAnalyticsDivision === "all"
        ? dashboardDivisions
        : divisions.filter((division) => division.name === activeAnalyticsDivision);
    const liveMilestones = readList(request.query.liveMilestones);
    const cacheKey = `dashboard:summary:${JSON.stringify({
      scope: getAuthScopeCacheKey(user),
      selectedYear,
      divisionYear,
      activeDivision,
      activeAnalyticsDivision,
      liveMilestones,
    })}`;
    const summary = await getCached(cacheKey, cacheTtl.dashboardSummaryMs, async () => {
      const [
        sqlSimpleCounts,
        sqlFinanceTotals,
        sqlMiscellaneousCounts,
        sqlStatusCounts,
        sqlAnalyticsSlice,
        sqlDivisionFilteredAnalyticsSlice,
        sqlManualMilestoneSlice,
      ] = await Promise.all([
        loadSimpleDashboardCounts({
          whereSql: dashboardFileWhere.whereSql,
          values: dashboardFileWhere.values,
          activeDivision,
        }),
        loadFinanceTotals({
          whereSql: dashboardFileWhere.whereSql,
          values: dashboardFileWhere.values,
          activeDivision,
          dashboardDivisions,
        }),
        loadMiscellaneousCounts({
          whereSql: dashboardFileWhere.whereSql,
          values: dashboardFileWhere.values,
          activeDivision,
        }),
        loadStatusCounts({
          whereSql: dashboardFileWhere.whereSql,
          values: dashboardFileWhere.values,
          activeDivision,
        }),
        loadAnalyticsSqlSlice({
          whereSql: dashboardFileWhere.whereSql,
          values: dashboardFileWhere.values,
          divisionName: analyticsSliceDivision,
          divisions: dashboardDivisions,
          valueThresholdLevels,
        }),
        loadAnalyticsSqlSlice({
          whereSql: dashboardFileWhere.whereSql,
          values: dashboardFileWhere.values,
          divisionName: divisionFilteredSliceDivision,
          divisions: divisionFilteredSliceDivisions,
          valueThresholdLevels,
        }),
        loadManualMilestoneSqlSlice({
          whereSql: dashboardFileWhere.whereSql,
          values: dashboardFileWhere.values,
          activeDivision,
          divisions: dashboardDivisions,
          configuredMilestones: getConfiguredMilestones(settings.milestones),
          liveMilestones,
        }),
      ]);
      if (process.env.DASHBOARD_SQL_COMPARE === "true") {
        const files = await loadFiles(dashboardFileWhere.whereSql, dashboardFileWhere.values);
        const legacySummary = buildDashboardSummary({
          files,
          divisions,
          settings: { ...settings, valueThresholdLevels },
          division: activeDivision,
          analyticsDivision: activeAnalyticsDivision,
          liveMilestones,
        });
        warnIfSimpleCountsDiffer(
          {
            dashboardFileCount: legacySummary.dashboardFileCount,
            modeCounts: legacySummary.modeCounts,
            topSummaryStats: legacySummary.topSummaryStats,
          },
          sqlSimpleCounts,
        );
        warnIfFinanceTotalsDiffer(legacySummary.financeTotals, sqlFinanceTotals);
        warnIfMiscellaneousCountsDiffer(legacySummary.miscellaneousCounts, sqlMiscellaneousCounts);
        warnIfStatusCountsDiffer(getStatusCountsFromFlow(legacySummary.statusFlow), sqlStatusCounts);
        warnIfAnalyticsSqlSliceDiffers(
          "dashboard",
          getAnalyticsSqlSlice(legacySummary.analytics),
          sqlAnalyticsSlice,
        );
        warnIfAnalyticsSqlSliceDiffers(
          "division-filtered",
          getAnalyticsSqlSlice(legacySummary.divisionFilteredAnalytics),
          sqlDivisionFilteredAnalyticsSlice,
        );
        warnIfManualMilestoneSqlSliceDiffers(
          {
            manualMilestoneFlow: legacySummary.manualMilestoneFlow,
            visibleLiveMilestoneNames: legacySummary.visibleLiveMilestoneNames,
            liveStatusRows: legacySummary.liveStatusRows,
          },
          sqlManualMilestoneSlice,
        );
      }

      return {
        activeDivision,
        activeAnalyticsDivision,
        dashboardDivisions,
        ...sqlSimpleCounts,
        financeTotals: sqlFinanceTotals,
        financePercents: getFinancePercents(sqlFinanceTotals),
        miscellaneousCounts: sqlMiscellaneousCounts,
        statusFlow: buildStatusFlowFromSql(sqlStatusCounts),
        manualMilestoneFlow: sqlManualMilestoneSlice.manualMilestoneFlow,
        visibleLiveMilestoneNames: sqlManualMilestoneSlice.visibleLiveMilestoneNames,
        liveStatusRows: sqlManualMilestoneSlice.liveStatusRows,
        analytics: sqlAnalyticsSlice,
        divisionFilteredAnalytics: sqlDivisionFilteredAnalyticsSlice,
      };
    });

    response.json({ summary });
  }),
);
