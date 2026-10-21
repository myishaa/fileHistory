// Run with backend/node_modules/.bin/tsx so Status-3 uses the current TypeScript search matcher.
import { pool } from "../backend/dist/db/pool.js";
import { loadFiles } from "../backend/dist/routes/files.js";
import { buildDashboardSummary } from "../backend/dist/utils/dashboard-summary.js";
import { searchFiles } from "../backend/src/utils/file-search.ts";
import { isBiddingApplicableForFile } from "../backend/dist/utils/file-type-groups.js";

const selectedYear = process.env.AUDIT_SELECTED_YEAR ?? "__all_active_files__";

function isYesExpression(column) {
  return `lower(coalesce(${column}, '')) = 'yes'`;
}

function normalizeMilestoneName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function fileClosedExpression() {
  return `exists (
    select 1 from file_completed_milestones completed_closed
    where completed_closed.file_id = f.id
      and lower(regexp_replace(coalesce(completed_closed.milestone, ''), '\\s+', '', 'g')) = 'fileclosed'
  )`;
}

function supplyOrderRowExists() {
  return `exists (select 1 from supply_orders so_existing where so_existing.file_id = f.id)`;
}

function activeFilesExpression() {
  return `(not ${fileClosedExpression()}
      and lower(coalesce(f.demand_cancelled, '')) <> 'yes'
      and not (${supplyOrderRowExists()} and not exists (
        select 1 from supply_orders so_active
        where so_active.file_id = f.id
          and not ${isYesExpression("so_active.so_cancelled")}
      )))`;
}

function amount(value) {
  return String(value ?? "");
}

async function loadSettings() {
  const row = (
    await pool.query(
      `select financial_year, selected_year, coalesce(setup_year, financial_year) as setup_year,
              year_selection_locked, theme, theme_tint, deletion_password,
              tcec_committees, firm_types, file_types, file_type_groups, modes, milestones,
              table_field_presets, active_user_id
       from app_settings
       where id = true`,
    )
  ).rows[0];
  if (!row) throw new Error("Settings row not found.");
  return {
    financialYear: row.financial_year,
    selectedYear: selectedYear === "__settings__" ? row.selected_year : selectedYear,
    setupYear: row.setup_year,
    financialYears: [row.financial_year, row.selected_year, row.setup_year].filter(Boolean),
    yearSelectionLocked: Boolean(row.year_selection_locked),
    theme: row.theme,
    themeTint: row.theme_tint,
    deletionPassword: row.deletion_password,
    tcecCommittees: Array.isArray(row.tcec_committees) ? row.tcec_committees : [],
    firmTypes: Array.isArray(row.firm_types) ? row.firm_types : [],
    fileTypes: Array.isArray(row.file_types) ? row.file_types : [],
    fileTypeGroups: Array.isArray(row.file_type_groups) ? row.file_type_groups : [],
    modes: Array.isArray(row.modes) ? row.modes : [],
    valueThresholdLevels: [],
    milestones: Array.isArray(row.milestones) ? row.milestones : [],
    tableFieldPresets: Array.isArray(row.table_field_presets) ? row.table_field_presets : [],
    activeUserId: row.active_user_id ?? undefined,
  };
}

async function loadDivisions() {
  const result = await pool.query(
    `select id, name, code, allocated_capital, allocated_revenue, ad
     from divisions
     where archived_at is null
     order by name asc`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code ?? "",
    allocatedCapital: amount(row.allocated_capital),
    allocatedRevenue: amount(row.allocated_revenue),
    ad: row.ad ?? "",
  }));
}

async function loadDashboardFiles() {
  if (selectedYear !== "__all_active_files__") {
    throw new Error("This direct audit currently supports AUDIT_SELECTED_YEAR=__all_active_files__.");
  }
  return loadFiles(`where ${activeFilesExpression()}`);
}

function add(counters, label, count, filter, strict = false) {
  counters.push({ label, count: Number(count ?? 0), filter, strict });
}

function collectStatus1Counters(summary) {
  const counters = [];
  for (const row of summary.statusFlow ?? []) {
    const key = String(row.key ?? "");
    const title = String(row.label ?? key);
    if (key === "supplyOrder") {
      add(counters, "Supply Order / Placed", row.cleared, "milestoneCleared:supplyOrder");
      add(counters, "Supply Order / Live", row.liveSupplyOrders, "liveSupplyOrders");
      add(counters, "Supply Order / Pending", row.pending, "milestonePending:supplyOrder");
    }
    if (key === "payment") {
      add(counters, "Payment / Completed", row.cleared, "milestoneCleared:payment");
      add(counters, "Payment / Pending", row.pending, "milestonePending:payment");
      add(counters, "Payment / All pending types", row.allPaymentPending, "analyticsPaymentPending");
      add(counters, "Payment / Advance Paid", row.advancePaid, "advancePaid");
      add(counters, "Payment / Advance Pending", row.advancePending, "advancePending");
      add(counters, "Payment / Due", row.paymentDue, "paymentDueOnly");
      add(counters, "Payment / In process", row.paymentInProcess, "paymentInProcess");
      add(counters, "Payment / Submitted unpaid", row.paymentSubmitted, "paymentSubmitted");
    }
    if (["psb", "pwb", "psbPwb"].includes(key)) {
      add(counters, `${title} / Pending`, row.pending, `milestonePending:${key}`);
      add(counters, `${title} / Received`, row.cleared, `milestoneCleared:${key}`);
      add(counters, `${title} / Expired`, row.bgExpired, `bgExpired:${key}`);
      add(counters, `${title} / To be returned`, row.bgToBeReturned, `bgToBeReturned:${key}`);
      add(counters, `${title} / Returned`, row.bgReturned, `bgReturned:${key}`);
    }
    if (key === "delivery") {
      add(counters, "Delivery / Completed", row.completed, "deliveryCompleted");
      add(counters, "Delivery / Pending", row.due, "deliveryDue");
      add(counters, "Delivery / Overdue", row.overdue, "deliveryOverdue");
    }
    if (key === "jobCompletion") {
      add(counters, "Job Completion / Done", row.jobCompleted, "jobCompletionCompleted");
      add(counters, "Job Completion / Due", row.jobLive, "jobCompletionDue");
    }
    if (key === "ir") {
      add(counters, "IR / Preparation pending", row.irPreparationPending, "irPreparationPending");
      add(counters, "IR / Receipt pending", row.irReceiptPending, "irReceiptPending");
      add(counters, "IR / Completed", row.irCompleted, "irCompleted");
    }
  }
  return counters;
}

function getLiveStatusDashboardFilter(milestoneName) {
  const normalized = normalizeMilestoneName(milestoneName);
  if (normalized === "supplementarybillreturnedforcorrection") return "supplementaryBill:returned";
  if (["delivery", "deliveryperiod", "dp", "d.p."].includes(normalized)) {
    return "status2DpPending";
  }
  return `manualMilestoneCurrent:${milestoneName}`;
}

function collectStatus2Counters(summary) {
  const counters = [];
  for (const row of summary.liveStatusRows ?? []) {
    const division = String(row.division ?? "").trim();
    if (!division) continue;
    for (const [milestone, count] of Object.entries(row.counts ?? {})) {
      counters.push({
        label: `${division} / ${milestone}`,
        count: Number(count ?? 0),
        filter: getLiveStatusDashboardFilter(milestone),
        division,
        strict: false,
      });
    }
  }
  return counters;
}

function collectStatus3Counters(summary) {
  const counters = [];
  for (const group of summary.statusSummaryGroups ?? []) {
    for (const row of group.rows ?? []) {
      for (const column of group.columns ?? []) {
        const value = row.counts?.[column];
        if (value === undefined || value === "-") continue;
        counters.push({
          label: `${row.milestone} / ${column}`,
          count: Number(value ?? 0),
          filter: `statusSummary:${encodeURIComponent(row.milestone)}:${encodeURIComponent(column)}`,
          strict: false,
        });
      }
    }
  }
  return counters;
}

function hasFilledString(value) {
  return String(value ?? "").trim() !== "";
}

function isYes(value) {
  return String(value ?? "").trim().toLowerCase() === "yes";
}

function isCancelledFile(file) {
  return isYes(file.demandCancelled);
}

function getFinancialYearForDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "undated";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "undated";
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function collectStatus4Counters(files) {
  const byFy = new Map();
  for (const file of files) {
    const fy = getFinancialYearForDate(file.receivedDate);
    byFy.set(fy, [...(byFy.get(fy) ?? []), file]);
  }
  return Array.from(byFy.entries()).map(([fiscalYear, yearFiles]) => ({
    label: `${fiscalYear} / Bidding / Current`,
    count: yearFiles.filter(
      (file) =>
        !isCancelledFile(file) &&
        isBiddingApplicableForFile(file) &&
        hasFilledString(file.cfaDate) &&
        !isYes(file.biddingStageOver),
    ).length,
    filter: `status4:${encodeURIComponent("Bidding")}:current:${encodeURIComponent(fiscalYear)}:all::`,
    strict: true,
  }));
}

async function main() {
  const [settings, divisions, files] = await Promise.all([
    loadSettings(),
    loadDivisions(),
    loadDashboardFiles(),
  ]);
  const summary = buildDashboardSummary({
    files,
    divisions,
    settings,
    division: "all",
  });
  const area = process.env.AUDIT_AREA ?? "status1";
  const counters =
    area === "status2"
      ? collectStatus2Counters(summary)
      : area === "status3"
        ? collectStatus3Counters(summary)
        : area === "status4"
          ? collectStatus4Counters(files)
        : collectStatus1Counters(summary);
  const issues = [];
  const notes = [];
  for (const counter of counters) {
    const result = searchFiles(files, {
      dashboardFilter: counter.filter,
      divisionFilter: counter.division,
      page: 1,
      pageSize: 1000,
    });
    const total = Array.isArray(result) ? result.length : Number(result.total ?? result.files?.length ?? 0);
    if (total > counter.count) {
      issues.push({ ...counter, searchTotal: total, issue: "Search exceeds Status-1 counter" });
    } else if (counter.strict && total !== counter.count) {
      issues.push({ ...counter, searchTotal: total, issue: "Strict mismatch" });
    } else if (total !== counter.count) {
      notes.push({ ...counter, searchTotal: total, note: "Counter is row/case based; Search is unique files" });
    }
  }
  console.log(JSON.stringify({ area, selectedYear, fileCount: files.length, checked: counters.length, issues, notes }, null, 2));
  if (issues.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
