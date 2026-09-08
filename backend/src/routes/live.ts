import { Router } from "express";
import { pool } from "../db/pool.js";
import { loadFiles } from "./files.js";
import type { AppSettings, Division } from "../types.js";
import { cacheTtl, getCached } from "../utils/cache.js";
import { fromDbJsonArray, fromDbText } from "../utils/db-values.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import { buildDashboardSummary } from "../utils/dashboard-summary.js";

export const liveRouter = Router();

const allFilesYear = "__all_files__";
const allActiveFilesYear = "__all_active_files__";
const activePlusCurrentFyClosedYear = "__active_plus_current_fy_closed__";
const trialMmgLiveOptions = new Set(["status1", "status2", "finance"]);

type SettingsRow = {
  financial_year: string;
  selected_year: string;
  setup_year: string | null;
  year_selection_locked: boolean;
  theme: AppSettings["theme"];
  theme_tint: AppSettings["themeTint"];
  deletion_password: string;
  tcec_committees: unknown;
  firm_types: unknown;
  file_types: unknown;
  file_type_groups: unknown;
  modes: unknown;
  milestones: unknown;
  table_field_presets: unknown;
  mmg_live_enabled: boolean;
  mmg_live_options: unknown;
  active_user_id: string | null;
};

type DivisionRow = {
  id: string;
  name: string;
  code: string | null;
  allocated_capital: string | null;
  allocated_revenue: string | null;
  ad: string | null;
};

function mapSettings(row: SettingsRow): AppSettings {
  const setupYear =
    row.setup_year &&
    row.setup_year !== "__all_active_files__" &&
    row.setup_year !== "__active_plus_current_fy_closed__"
      ? row.setup_year
      : row.financial_year;
  return {
    financialYear: row.financial_year,
    selectedYear: row.selected_year,
    setupYear,
    financialYears: [row.financial_year, row.selected_year, setupYear].filter(
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
    fileTypeGroups: fromDbJsonArray(row.file_type_groups) as AppSettings["fileTypeGroups"],
    modes: fromDbJsonArray(row.modes) as string[],
    valueThresholdLevels: [],
    milestones: fromDbJsonArray(row.milestones) as string[],
    tableFieldPresets: fromDbJsonArray(row.table_field_presets),
    mmgLiveEnabled: row.mmg_live_enabled,
    mmgLiveOptions: fromDbJsonArray(row.mmg_live_options).filter(
      (option): option is string => typeof option === "string" && trialMmgLiveOptions.has(option),
    ),
    activeUserId: fromDbText(row.active_user_id) || undefined,
  };
}

function mapDivision(row: DivisionRow): Division {
  return {
    id: row.id,
    name: row.name,
    code: fromDbText(row.code),
    allocatedCapital: fromDbText(row.allocated_capital),
    allocatedRevenue: fromDbText(row.allocated_revenue),
    ad: fromDbText(row.ad),
    active: true,
  };
}

async function loadSettings() {
  return getCached("settings:live", cacheTtl.settingsMs, async () => {
    const result = await pool.query<SettingsRow>(
      `select financial_year, selected_year, coalesce(setup_year, financial_year) as setup_year, year_selection_locked, theme, theme_tint, deletion_password,
              tcec_committees, firm_types, file_types, file_type_groups, modes, milestones, table_field_presets,
              mmg_live_enabled, mmg_live_options, active_user_id
       from app_settings
       where id = true`,
    );
    if (!result.rows[0]) throw new HttpError(404, "Settings row not found.");
    return mapSettings(result.rows[0]);
  });
}

async function loadActiveDivisions(financialYear: string) {
  return getCached(`divisions:live:${financialYear}`, cacheTtl.divisionsMs, async () => {
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
         on a.division_id = d.id and a.financial_year = $1
       where coalesce(a.active, false) and d.archived_at is null
       order by d.name asc`,
      [financialYear],
    );
    return result.rows.map(mapDivision);
  });
}

function fileClosedExpression() {
  return `exists (
          select 1 from file_completed_milestones completed
          where completed.file_id = f.id
            and regexp_replace(lower(coalesce(completed.milestone, '')), '[^a-z0-9]+', '', 'g') = 'fileclosed'
        )`;
}

function isYesExpression(expression: string) {
  return `lower(coalesce(${expression}, '')) = 'yes'`;
}

function supplyOrderRowExists() {
  return `exists (select 1 from supply_orders so_any where so_any.file_id = f.id)`;
}

function allSupplyOrdersCancelledExpression() {
  return `(${supplyOrderRowExists()} and not exists (
        select 1 from supply_orders so_active
        where so_active.file_id = f.id
          and not ${isYesExpression("so_active.so_cancelled")}
      ))`;
}

function activeFilesExpression() {
  return `not ${fileClosedExpression()}
        and not ${isYesExpression("f.demand_cancelled")}
        and not ${allSupplyOrdersCancelledExpression()}`;
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

function getSelectedYearWhere(selectedYear: string, currentFinancialYear: string) {
  if (selectedYear === allFilesYear) {
    return {
      whereSql: "",
      values: [],
    };
  }
  if (selectedYear === allActiveFilesYear) {
    return {
      whereSql: `where ${activeFilesExpression()}`,
      values: [],
    };
  }
  if (selectedYear === activePlusCurrentFyClosedYear) {
    const range = getFinancialYearDateRange(currentFinancialYear);
    if (!range) return { whereSql: `where ${activeFilesExpression()}`, values: [] };
    return {
      whereSql: `where (${activeFilesExpression()} or (${fileClosedExpression()}
        and f.file_closure_date between $1::date and $2::date
        and lower(coalesce(f.demand_cancelled, '')) <> 'yes'))`,
      values: [range.start, range.end],
    };
  }

  return {
    whereSql: `where f.year = $1 or exists (
        select 1 from file_year_activity a
        where a.file_id = f.id and a.financial_year = $1 and a.status = 'active'
      )`,
    values: [selectedYear],
  };
}

liveRouter.get(
  "/mmg",
  asyncHandler(async (_request, response) => {
    const settings = await loadSettings();
    const selectedYear = settings.selectedYear || settings.financialYear;
    const divisionYear =
      selectedYear === allFilesYear ||
      selectedYear === allActiveFilesYear ||
      selectedYear === activePlusCurrentFyClosedYear
        ? settings.financialYear
        : selectedYear;
    const selectedYearWhere = getSelectedYearWhere(selectedYear, settings.financialYear);
    const [divisions, files] = await Promise.all([
      loadActiveDivisions(divisionYear),
      loadFiles(selectedYearWhere.whereSql, selectedYearWhere.values),
    ]);
    const summary = buildDashboardSummary({ files, divisions, settings });
    response.json({
      live: {
        enabled: settings.mmgLiveEnabled === true,
        options: settings.mmgLiveOptions ?? [],
        selectedYear,
        updatedAt: new Date().toISOString(),
        summary: {
          dashboardFileCount: summary.dashboardFileCount,
          statusFlow: summary.statusFlow,
          liveStatusRows: summary.liveStatusRows,
          visibleLiveMilestoneNames: summary.visibleLiveMilestoneNames,
          financeTotals: summary.financeTotals,
          financePercents: summary.financePercents,
        },
      },
    });
  }),
);
