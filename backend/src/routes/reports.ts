import { Router } from "express";
import { pool } from "../db/pool.js";
import type { AppSettings, FileRecord, SupplyOrderDetail } from "../types.js";
import { loadFiles } from "./files.js";
import { fromDbJsonArray, fromDbText } from "../utils/db-values.js";
import { buildReportsSummary } from "../utils/report-summary.js";
import { getDivisionScopeCondition, requireAuth, type AuthRequest } from "../utils/auth.js";
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
  expectedCashOutgoRows: CashOutgoRow[];
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
  { key: "ad", label: "AD", totalLabel: "Total cases", currentColumn: "f.ad_vetting_date", appliesColumn: "f.ad" },
  { key: "rqa", label: "R&QA", totalLabel: "Total cases", currentColumn: "f.rqa_approval_date", appliesColumn: "f.rqa" },
  { key: "control", label: "Controlling", totalLabel: "Total files", currentColumn: "f.imms_date", aliases: ["Controlling", "Controlled"] },
  {
    key: "ifa",
    label: "IFA",
    totalLabel: "Total cases",
    reviewedColumn: "f.ifa_sent_date",
    currentColumn: "f.ifa_final_date",
    appliesColumn: "f.ifa",
  },
  { key: "cfa", label: "CFA", totalLabel: "Total files", reviewedColumn: "f.cfa_sent_date", currentColumn: "f.cfa_date" },
  { key: "bidding", label: "Bidding", totalLabel: "Total files", currentColumn: "f.bidding_stage_over", yesComplete: true },
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
  { key: "supplyOrder", label: "Supply Order", completedLabel: "Placed", totalLabel: "Total files", supplyOrderDate: "so_date" },
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

async function loadSettings() {
  const result = await pool.query<SettingsRow>(
    `select financial_year, selected_year, year_selection_locked, theme, theme_tint, deletion_password,
            tcec_committees, milestones, table_field_presets, active_user_id
     from app_settings
     where id = true`,
  );
  if (!result.rows[0]) throw new HttpError(404, "Settings row not found. Run seed defaults.");
  return mapSettings(result.rows[0]);
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

const allActiveFilesYear = "__all_active_files__";

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

function readNonNegativeInteger(value: unknown, fallback: number) {
  const text = readString(value);
  const parsed = Number.parseInt(text ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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

function getReportWhereSql({
  scopeSql,
  scopeValues,
  selectedYear,
  division,
}: {
  scopeSql: string;
  scopeValues: unknown[];
  selectedYear: string | undefined;
  division: string;
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
  return {
    whereSql: conditions.length ? `where ${conditions.join(" and ")}` : "",
    values,
  };
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

function supplyOrderChildOrLegacyExpression(childCondition: string, legacyCondition: string) {
  return `(${supplyOrderExists(childCondition)} or (not ${supplyOrderRowExists()} and ${legacyCondition}))`;
}

function isCancelledExpression() {
  return `(${isYesExpression("f.demand_cancelled")}
    or ${isYesExpression("f.so_cancelled")}
    or ${supplyOrderExists(
      `${isYesExpression("so.demand_cancelled")} or ${isYesExpression("so.so_cancelled")}`,
    )})`;
}

function inrAmountExpression(column: string) {
  return `case
    when ${column} is null then 0
    when upper(trim(coalesce(f.currency, 'INR'))) in ('', 'INR') then ${column}
    when f.exchange_rate > 0 then ${column} * f.exchange_rate
    else 0
  end`;
}

function normalizeMilestoneExpression(column: string) {
  return `regexp_replace(lower(coalesce(${column}, '')), '[^a-z0-9]+', '', 'g')`;
}

function normalizeMilestoneName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function reportAppliesExpression(milestone: (typeof reportMilestoneDefinitions)[number]) {
  return "appliesColumn" in milestone && milestone.appliesColumn
    ? isYesExpression(milestone.appliesColumn)
    : "true";
}

function reportCompleteExpression(milestone: (typeof reportMilestoneDefinitions)[number]) {
  if ("yesComplete" in milestone && milestone.yesComplete) return isYesExpression(milestone.currentColumn);
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

function reportReviewedExpression(milestone: (typeof reportMilestoneDefinitions)[number]) {
  return "reviewedColumn" in milestone && milestone.reviewedColumn
    ? hasFilledExpression(milestone.reviewedColumn)
    : "false";
}

function reportActiveExpression(milestone: (typeof reportMilestoneDefinitions)[number]) {
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
  return `to_char(${column}, 'Mon YYYY')`;
}

function isStatusSummaryColumn(stage: string) {
  return [
    "Total files",
    "Total cases",
    "Placed",
    "Received",
    "Reviewed",
    "Pending",
    "In process",
    "Opening overdue",
    "Live",
    "Completed",
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
    "In process",
    "Opening overdue",
    "Live",
    "Completed",
    "Valid",
    "Expired",
    "Extended",
  ];
  if (columns.includes("Opening overdue")) {
    return ["Live", "In process", "Opening overdue", "Completed"].filter((column) =>
      columns.includes(column),
    );
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
  if (columns.length === 2 && columns.includes("Completed") && columns.includes("Pending")) {
    return "Delivery";
  }
  if (columns.length === 3 && columns.includes("Pending")) return "Payment";
  return "Other milestones";
}

function buildStatusSummaryGroups(rows: Array<{ milestone: string; stage: string; count: number }>) {
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
     ${appendReportWhereClause(whereSql)}`,
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
      addRow(milestone.label, "Pending", `${eligible} and ${reportActiveExpression(milestone)} and not (${complete})`);
      addRow(milestone.label, "At previous stage", `${process} and not (${supplyOrderPlacedExpression()})`);
      return;
    }
    if (milestone.key === "payment") {
      addRow(milestone.label, "Completed", `${process} and ${complete}`);
      addRow(milestone.label, "Pending", pending);
      addRow(milestone.label, "At previous stage", `${process} and not (${reached})`);
      return;
    }
    if (milestone.key === "bidding") {
      addRow(milestone.label, "Completed", `${process} and ${complete}`);
      addRow(milestone.label, "In process", `${active} and not ${isYesExpression("f.tender_live")}`);
      addRow(
        milestone.label,
        "Opening overdue",
        `${applies} and ${isNoExpression("f.bid_opened")} and (f.bid_opening_date < current_date or f.refloat_bid_opening_date < current_date)`,
      );
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
    `${supplyOrderPlacedExpression()} and ${supplyOrderChildOrLegacyExpression(
      `${hasFilledExpression("so.so_date")} and not ${hasFilledExpression("so.revised_dp")} and so.dp_date > current_date and not ${hasFilledExpression("so.material_receipt_date")}`,
      `${hasFilledExpression("f.so_date")} and not ${hasFilledExpression("f.revised_dp")} and f.dp_date > current_date and not ${hasFilledExpression("f.material_receipt_date")}`,
    )}`,
  );
  addRow(
    "Delivery Period",
    "Expired",
    `not ${isCancelledExpression()} and ${supplyOrderPlacedExpression()} and ${supplyOrderChildOrLegacyExpression(
      `${hasFilledExpression("so.so_date")} and coalesce(so.revised_dp, so.dp_date) is not null and coalesce(so.revised_dp, so.dp_date) < current_date and not ${hasFilledExpression("so.material_receipt_date")}`,
      `${hasFilledExpression("f.so_date")} and coalesce(f.revised_dp, f.dp_date) is not null and coalesce(f.revised_dp, f.dp_date) < current_date and not ${hasFilledExpression("f.material_receipt_date")}`,
    )}`,
  );
  addRow(
    "Delivery Period",
    "Extended",
    `${supplyOrderPlacedExpression()} and ${supplyOrderChildOrLegacyExpression(
      `${hasFilledExpression("so.so_date")} and ${hasFilledExpression("so.revised_dp")} and so.revised_dp > current_date and not ${hasFilledExpression("so.material_receipt_date")}`,
      `${hasFilledExpression("f.so_date")} and ${hasFilledExpression("f.revised_dp")} and f.revised_dp > current_date and not ${hasFilledExpression("f.material_receipt_date")}`,
    )}`,
  );
  addRow("Delivery", "Completed", `${supplyOrderPlacedExpression()} and ${supplyOrderChildOrLegacyExpression(
    `${hasFilledExpression("so.so_date")} and ${hasFilledExpression("so.material_receipt_date")}`,
    `${hasFilledExpression("f.so_date")} and ${hasFilledExpression("f.material_receipt_date")}`,
  )}`);
  addRow("Delivery", "Pending", `not ${isCancelledExpression()} and ${supplyOrderPlacedExpression()} and ${deliveryDueOrderExpression()}`);

  const result = await pool.query<{ milestone: string; stage: string; count: number }>(
    selects.join("\nunion all\n"),
    values,
  );
  return buildStatusSummaryGroups(result.rows);
}

async function loadCashOutgoRows(
  whereSql: string,
  values: unknown[],
  mode: "expected" | "actual",
): Promise<CashOutgoRow[]> {
  const dateExpression =
    mode === "expected"
      ? "(coalesce(effective.material_receipt_date, effective.dp_date) + interval '10 days')::date"
      : "effective.bill_sent_for_payment_date";
  const extraCondition =
    mode === "expected"
      ? "effective.so_date is not null and not effective.so_cancelled_yes and coalesce(effective.material_receipt_date, effective.dp_date) is not null"
      : "effective.bill_sent_for_payment_date is not null and not (effective.so_cancelled_yes and effective.so_cancelled_date is not null)";
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
         so.so_date,
         so.dp_date,
         so.material_receipt_date,
         so.bill_sent_for_payment_date,
         so.so_cancelled_date,
         ${isYesExpression("so.so_cancelled")} as so_cancelled_yes,
         ${inrAmountExpression("so.so_value_capital")} as capital,
         ${inrAmountExpression("so.so_value_revenue")} as revenue
       from files f
       left join divisions d on d.id = f.division_id
       join supply_orders so on so.file_id = f.id
       ${appendReportWhereClause(whereSql, [`not ${isCancelledExpression()}`])}
       union all
       select
         f.id as file_id,
         f.so_date,
         f.dp_date,
         f.material_receipt_date,
         f.bill_sent_for_payment_date,
         f.so_cancelled_date,
         ${isYesExpression("f.so_cancelled")} as so_cancelled_yes,
         ${inrAmountExpression("f.so_value_capital")} as capital,
         ${inrAmountExpression("f.so_value_revenue")} as revenue
       from files f
       left join divisions d on d.id = f.division_id
       ${appendReportWhereClause(whereSql, [
         `not ${isCancelledExpression()}`,
         `not ${supplyOrderRowExists()}`,
       ])}
     )
     select
       to_char(${dateExpression}, 'YYYY-MM') as month_key,
       ${formatMonthExpression(dateExpression)} as month,
       round(coalesce(sum(capital), 0))::integer as capital,
       round(coalesce(sum(revenue), 0))::integer as revenue,
       round(coalesce(sum(capital + revenue), 0))::integer as total
     from effective
     where ${extraCondition}
     group by 1, 2
     order by 1 asc`,
    values,
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
  const reviewed =
    "reviewedColumn" in milestone && milestone.reviewedColumn ? milestone.reviewedColumn : undefined;
  const previous = reportMilestoneDefinitions.slice(0, index).reverse();
  const previousExpression = previous.length
    ? `case
        ${previous
          .map((item) => `when ${reportAppliesExpression(item)} then ${reportDateValueExpression(item)}`)
          .join("\n        ")}
        else coalesce(f.received_date, f.file_date)
      end`
    : "coalesce(f.received_date, f.file_date)";
  return reviewed ? `coalesce(${reviewed}, ${previousExpression})` : previousExpression;
}

function reportDateValueExpression(milestone: (typeof reportMilestoneDefinitions)[number]) {
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
    (f.refloat_post_tcec_date),
    (f.refloat_post_tcec_minutes_date),
    (f.cnc_date),
    (f.cnc_approval_date),
    (${earliestSupplyOrderDateExpression("so_date")}),
    (${earliestSupplyOrderDateExpression("dp_date")}),
    (${earliestSupplyOrderDateExpression("bg_validity_date")}),
    (${earliestSupplyOrderDateExpression("revised_dp")}),
    (${earliestSupplyOrderDateExpression("material_receipt_date")}),
    (${earliestSupplyOrderDateExpression("bill_sent_for_payment_date")}),
    (${earliestSupplyOrderDateExpression("payment_date")}),
    (${earliestSupplyOrderDateExpression("bg_return_date")}),
    (${earliestSupplyOrderDateExpression("so_cancelled_date")})
  ) as dates(date_value))`;
}

async function loadDelayRows(
  whereSql: string,
  values: unknown[],
  thresholdDays: number,
  selectedMilestoneKey: string,
): Promise<DelayStatusRow[]> {
  const thresholdPlaceholder = addValue(values, thresholdDays);
  const selects = reportMilestoneDefinitions
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
          coalesce((${lastFilled})::text, '') as "lastFilledDate"
        from files f
        left join divisions d on d.id = f.division_id
        ${appendReportWhereClause(whereSql, [
          active,
          `not (${complete})`,
          `(${startDate}) is not null`,
          `(current_date - (${startDate})::date) > ${thresholdPlaceholder}::integer`,
        ])}`;
    });
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
}: {
  whereSql: string;
  values: unknown[];
  division: string;
  delayDays: number;
  delayMilestone: string;
}): Promise<ReportsSummaryPayload> {
  const [
    reportFileCount,
    statusSummaryGroups,
    expectedCashOutgoRows,
    actualCashOutgoRows,
    delayRows,
  ] = await Promise.all([
    loadReportFileCount(whereSql, [...values]),
    loadStatusSummaryGroups(whereSql, [...values]),
    loadCashOutgoRows(whereSql, [...values], "expected"),
    loadCashOutgoRows(whereSql, [...values], "actual"),
    loadDelayRows(whereSql, [...values], delayDays, delayMilestone),
  ]);
  return {
    activeDivision: division,
    reportFileCount,
    statusSummaryGroups,
    expectedCashOutgoRows,
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
    const settings = await loadSettings();
    const selectedYear = readString(request.query.selectedYear) ?? settings.selectedYear;
    const division = readString(request.query.division) ?? "all";
    const delayDays = readNonNegativeInteger(request.query.delayDays, 5);
    const delayMilestone = readString(request.query.delayMilestone) ?? "all";
    const reportWhere = getReportWhereSql({
      scopeSql: scope.sql,
      scopeValues: scope.values,
      selectedYear,
      division,
    });
    const summary = await buildReportsSummarySql({
      whereSql: reportWhere.whereSql,
      values: reportWhere.values,
      division,
      delayDays,
      delayMilestone,
    });

    if (process.env.REPORTS_SQL_COMPARE === "true") {
      const files = await loadFiles(scope.sql ? `where ${scope.sql}` : "", scope.values);
      const selectedYearFiles =
        selectedYear === allActiveFilesYear
          ? files.filter((file) => !isInactiveFile(file))
          : selectedYear
            ? files.filter((file) => isFileActiveInYear(file, selectedYear))
            : files;
      const legacySummary = buildReportsSummary({
        files: selectedYearFiles,
        division,
        delayDays,
        delayMilestone,
      });
      if (JSON.stringify(legacySummary) !== JSON.stringify(summary)) {
        console.warn("Reports SQL summary differs from TypeScript summary.", {
          reference: legacySummary,
          candidate: summary,
        });
      }
    }

    response.json({
      summary,
    });
  }),
);
