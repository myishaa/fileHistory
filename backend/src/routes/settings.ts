import { Router } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import type {
  AppSettings,
  AppTheme,
  AppThemeTint,
  FirmRatingConfig,
  FileTypeGroupSetting,
  ValueThresholdAppliesTo,
  ValueThresholdLevel,
} from "../types.js";
import { requireAuth, type AuthRequest } from "../utils/auth.js";
import { cacheTtl, clearCachePrefix, getCached } from "../utils/cache.js";
import { fromDbJsonArray, fromDbText, toDbText } from "../utils/db-values.js";
import { normalizeFileTypeGroups } from "../utils/file-type-groups.js";
import {
  addTrustedIp,
  archiveIpAttempt,
  deleteArchivedIpAttempt,
  getIpAccessConfig,
  getRequestIp,
  type IpAccessMode,
  updateIpAccessMode,
  updateTrustedIp,
} from "../utils/ip-access-control.js";
import {
  asyncHandler,
  HttpError,
  requireObjectBody,
  requireParam,
  requireString,
} from "../utils/http.js";

export const settingsRouter = Router();

const themes = new Set<AppTheme>(["light", "dark"]);
const themeTints = new Set<AppThemeTint>(["plain", "yellow", "green", "blue", "pink", "lavender"]);
const valueThresholdAppliesTo = new Set<ValueThresholdAppliesTo>(["capital", "revenue", "both"]);
const allFilesYear = "__all_files__";
const allActiveFilesYear = "__all_active_files__";
const activePlusCurrentFyClosedYear = "__active_plus_current_fy_closed__";
const ipAccessModes = new Set<IpAccessMode>(["off", "notify", "restrict"]);
const defaultAddEditRibbonFields = ["imms", "indentor"];
const allowedAddEditRibbonFields = new Set([
  "imms",
  "indentor",
  "year",
  "uniqueCode",
  "division",
  "fileTypeGroup",
  "mode",
  "demandValue",
  "valueCapital",
  "valueRevenue",
  "latestSupplyOrderNo",
  "latestFirmName",
]);

async function verifyDeletionPassword(value: unknown) {
  const deletionPassword = toDbText(value) ?? "";
  if (!deletionPassword) throw new HttpError(400, "Deletion password is required.");
  const result = await pool.query<{ deletion_password: string | null }>(
    "select deletion_password from app_settings where id = true",
  );
  const expectedPassword = result.rows[0]?.deletion_password ?? "";
  if (!expectedPassword || deletionPassword !== expectedPassword) {
    throw new HttpError(403, "Invalid deletion password.");
  }
}

type SettingsRow = {
  financial_year: string;
  selected_year: string;
  setup_year: string | null;
  year_selection_locked: boolean;
  theme: AppTheme;
  theme_tint: AppThemeTint;
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
  mmg_summary_fields: unknown;
  demand_processing_presets: unknown;
  demand_processing_day_ranges: unknown;
  bg_receipt_delay_days: unknown;
  special_file_markers: unknown;
  firm_unique_no_label: string;
  firm_rating_config: unknown;
  active_user_id: string | null;
  pre_so_default_so_offset_days: number;
  pre_so_default_payment_offset_days: number;
};

type UserUiPreferencesRow = {
  theme: AppTheme | null;
  theme_tint: AppThemeTint | null;
  add_edit_ribbon_fields: unknown;
};

const defaultFirmRatingConfig: FirmRatingConfig = {
  fields: [
    { id: "delivery", label: "Delivery", weight: "1" },
    { id: "quality", label: "Quality", weight: "1" },
    { id: "afterSalesService", label: "After Sales Service", weight: "1" },
  ],
};

function tagPresets(value: unknown, owner: "global" | "personal", ownerUserId?: string) {
  return fromDbJsonArray(value).map((preset) =>
    preset && typeof preset === "object"
      ? {
          ...(preset as Record<string, unknown>),
          owner,
          ...(ownerUserId ? { ownerUserId } : {}),
        }
      : preset,
  );
}

function presetOwnerKey(user: AuthRequest["authUser"]) {
  return user?.id;
}

function normalizeYearLabel(value: unknown, field = "financialYear") {
  const label = requireString(value, field).trim();
  if (!label) throw new HttpError(400, `${field} is required.`);
  if (
    label !== allFilesYear &&
    label !== allActiveFilesYear &&
    label !== activePlusCurrentFyClosedYear &&
    normalizeFinancialYearKey(label) === undefined
  ) {
    throw new HttpError(400, `${field} must be a valid financial year like 2026-27.`);
  }
  return label;
}

function readAddEditRibbonFields(value: unknown) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "addEditRibbonFields must be an array.");
  }
  const unique = readAddEditRibbonFieldCandidates(value);
  if (unique.length !== 2) {
    throw new HttpError(400, "Select two valid Add/Edit ribbon fields.");
  }
  return unique;
}

function normalizeAddEditRibbonFields(value: unknown) {
  if (!Array.isArray(value)) return defaultAddEditRibbonFields;
  const unique = readAddEditRibbonFieldCandidates(value);
  return unique.length === 2 ? unique : defaultAddEditRibbonFields;
}

function readAddEditRibbonFieldCandidates(value: unknown[]) {
  const normalized = value.filter(
    (field): field is string => typeof field === "string" && allowedAddEditRibbonFields.has(field),
  );
  return Array.from(new Set(normalized)).slice(0, 2);
}

function isFinancialYearLabel(label: string) {
  return /^\d{4}-\d{2}$/.test(label.trim());
}

function readFinancialYearStart(label: string) {
  const match = label.trim().match(/^(\d{4})-(\d{2}|\d{4})$/);
  if (!match) return undefined;
  const startYear = Number.parseInt(match[1], 10);
  const endYear = Number.parseInt(match[2], 10);
  const expectedShortEnd = (startYear + 1) % 100;
  const actualShortEnd = match[2].length === 2 ? endYear : endYear % 100;
  return actualShortEnd === expectedShortEnd ? startYear : undefined;
}

function normalizeFinancialYearKey(label: string) {
  const startYear = readFinancialYearStart(label);
  return startYear === undefined ? undefined : startYear;
}

function isKnownFinancialYear(labels: string[], label: string) {
  const target = normalizeFinancialYearKey(label);
  return target !== undefined && labels.some((year) => normalizeFinancialYearKey(year) === target);
}

function validateContinuousFinancialYear(labels: string[], label: string) {
  const target = normalizeFinancialYearKey(label);
  if (target === undefined) {
    throw new HttpError(400, "Financial year must be a valid continuous year like 2026-27.");
  }

  const existingStarts = labels
    .map(normalizeFinancialYearKey)
    .filter((start): start is number => start !== undefined);

  if (existingStarts.includes(target)) {
    throw new HttpError(400, `Financial year ${label} already exists.`);
  }
  if (!existingStarts.length) return;

  const earliest = Math.min(...existingStarts);
  const latest = Math.max(...existingStarts);
  if (target !== earliest - 1 && target !== latest + 1) {
    const previousAllowed = `${earliest - 1}-${String(earliest % 100).padStart(2, "0")}`;
    const nextAllowed = `${latest + 1}-${String((latest + 2) % 100).padStart(2, "0")}`;
    throw new HttpError(
      400,
      `Financial years must be continuous. Add ${previousAllowed} or ${nextAllowed} next.`,
    );
  }
}

async function loadFinancialYears() {
  return getCached("lookup:financial-years", cacheTtl.lookupMs, async () => {
    const result = await pool.query<{ label: string }>(
      "select label from financial_years order by label desc",
    );
    return result.rows.map((row) => row.label).filter((label) => normalizeFinancialYearKey(label));
  });
}

async function loadTcecCommittees(financialYear: string, fallback: unknown) {
  return getCached(`lookup:tcec-committees:${financialYear}`, cacheTtl.lookupMs, async () => {
    const result = await pool.query<{ name: string }>(
      `select name
       from tcec_committees
       where financial_year = $1
       order by sort_order asc, name asc`,
      [financialYear],
    );
    if (result.rows.length) return result.rows.map((row) => row.name);
    return fromDbJsonArray(fallback) as string[];
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
      applies_to: ValueThresholdAppliesTo;
    }>(
      `select id, level_number, label, min_value, max_value, applies_to
       from value_threshold_levels
       where financial_year = $1
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

async function ensureFinancialYear(label: string, client: PoolClient | typeof pool = pool) {
  const years = await loadFinancialYears();
  if (isKnownFinancialYear(years, label)) {
    return false;
  }
  if (!isKnownFinancialYear(years, label)) {
    if (!isFinancialYearLabel(label)) {
      throw new HttpError(
        400,
        "New financial year must be entered in YYYY-YY format, like 2026-27.",
      );
    }
    validateContinuousFinancialYear(years, label);
  }
  const result = await client.query<{ label: string }>(
    "insert into financial_years (label) values ($1) on conflict (label) do nothing returning label",
    [label],
  );
  return (result.rowCount ?? 0) > 0;
}

async function copyYearSettings(sourceYear: string, targetYear: string, client: PoolClient) {
  if (!sourceYear || !targetYear || sourceYear === targetYear) return;

  await client.query(
    `insert into division_year_allocations (
       division_id, financial_year, allocated_capital, allocated_revenue, active
     )
     select division_id, $2, allocated_capital, allocated_revenue, active
     from division_year_allocations
     where financial_year = $1
     on conflict (division_id, financial_year) do nothing`,
    [sourceYear, targetYear],
  );

  await client.query(
    `insert into division_year_allocations (
       division_id, financial_year, allocated_capital, allocated_revenue, active
     )
     select
       d.id,
       $2,
       coalesce(a.allocated_capital, d.allocated_capital),
       coalesce(a.allocated_revenue, d.allocated_revenue),
       coalesce(a.active, true)
     from divisions d
     left join division_year_allocations a
       on a.division_id = d.id and a.financial_year = $1
     where d.archived_at is null
     on conflict (division_id, financial_year) do nothing`,
    [sourceYear, targetYear],
  );

  await client.query(
    `insert into tcec_committees (financial_year, name, sort_order)
     select $2, name, sort_order
     from tcec_committees
     where financial_year = $1
     on conflict do nothing`,
    [sourceYear, targetYear],
  );

  await client.query(
    `insert into value_threshold_levels (
       financial_year, level_number, label, min_value, max_value, applies_to
     )
     select $2, level_number, label, min_value, max_value, applies_to
     from value_threshold_levels
     where financial_year = $1
     on conflict (financial_year, level_number) do nothing`,
    [sourceYear, targetYear],
  );
}

async function loadUserTableFieldPresets(ownerKey: string) {
  return getCached(`settings:user-presets:${ownerKey}`, cacheTtl.settingsMs, async () => {
    const result = await pool.query<{ presets: unknown }>(
      "select presets from user_table_field_presets where owner_key = $1",
      [ownerKey],
    );
    return result.rows[0]?.presets ?? [];
  });
}

async function ensureUserLiveStatusPreferencesTable() {
  await pool.query(
    `create table if not exists user_live_status_preferences (
       owner_key text primary key,
       field_keys jsonb not null default '[]'::jsonb,
       updated_at timestamptz not null default now()
     )`,
  );
}

async function ensureUserReportPreferencesTable() {
  await pool.query(
    `create table if not exists user_report_preferences (
       user_id uuid not null references app_users(id) on delete cascade,
       report_key text not null,
       preferences jsonb not null default '{}'::jsonb,
       updated_at timestamptz not null default now(),
       primary key (user_id, report_key)
     )`,
  );
}

async function ensureUserUiPreferencesTable() {
  await pool.query(
    `create table if not exists user_ui_preferences (
       user_id uuid primary key references app_users(id) on delete cascade,
       theme text check (theme in ('light', 'dark')),
       theme_tint text check (
         theme_tint in ('plain', 'yellow', 'green', 'blue', 'pink', 'lavender')
       ),
       add_edit_ribbon_fields jsonb,
       updated_at timestamptz not null default now()
     )`,
  );
  await pool.query(
    "alter table user_ui_preferences add column if not exists add_edit_ribbon_fields jsonb",
  );
}

async function loadUserUiPreferences(userId: string) {
  await ensureUserUiPreferencesTable();
  return getCached(`settings:ui-preferences:${userId}`, cacheTtl.settingsMs, async () => {
    const result = await pool.query<UserUiPreferencesRow>(
      "select theme, theme_tint, add_edit_ribbon_fields from user_ui_preferences where user_id = $1",
      [userId],
    );
    return result.rows[0];
  });
}

async function loadUserLiveStatusFields(ownerKey: string) {
  await ensureUserLiveStatusPreferencesTable();
  return getCached(`settings:live-status-fields:${ownerKey}`, cacheTtl.settingsMs, async () => {
    const result = await pool.query<{ field_keys: unknown }>(
      "select field_keys from user_live_status_preferences where owner_key = $1",
      [ownerKey],
    );
    if (!result.rows[0]) return undefined;
    return fromDbJsonArray(result.rows[0].field_keys).filter(
      (key): key is string => typeof key === "string",
    );
  });
}

async function loadUserReportPreferences(userId: string, reportKey: string) {
  await ensureUserReportPreferencesTable();
  const result = await pool.query<{ preferences: unknown }>(
    "select preferences from user_report_preferences where user_id = $1 and report_key = $2",
    [userId, reportKey],
  );
  return result.rows[0]?.preferences ?? {};
}

async function mapSettings(row: SettingsRow, user?: AuthRequest["authUser"]): Promise<AppSettings> {
  const financialYears = await loadFinancialYears();
  const setupYear =
    row.setup_year &&
    row.setup_year !== allFilesYear &&
    row.setup_year !== allActiveFilesYear &&
    row.setup_year !== activePlusCurrentFyClosedYear
      ? row.setup_year
      : row.financial_year;
  const mergedFinancialYears = Array.from(
    new Set(
      [row.financial_year, row.selected_year, setupYear, ...financialYears]
        .filter(Boolean)
        .filter(
          (year) =>
            year !== allFilesYear &&
            year !== allActiveFilesYear &&
            year !== activePlusCurrentFyClosedYear,
        ),
    ),
  ).sort((a, b) => b.localeCompare(a));
  const globalPresets = tagPresets(row.table_field_presets, "global");
  const ownerKey = presetOwnerKey(user);
  const personalPresets =
    user && user.role !== "admin" && ownerKey
      ? tagPresets(await loadUserTableFieldPresets(ownerKey), "personal", ownerKey)
      : [];
  const liveStatusLockedFields = ownerKey ? await loadUserLiveStatusFields(ownerKey) : undefined;
  const uiPreferences = user?.id ? await loadUserUiPreferences(user.id) : undefined;
  return {
    financialYear: row.financial_year,
    selectedYear: row.selected_year,
    setupYear,
    financialYears: mergedFinancialYears,
    yearSelectionLocked: row.year_selection_locked,
    theme: uiPreferences?.theme ?? row.theme,
    themeTint: uiPreferences?.theme_tint ?? row.theme_tint,
    deletionPassword: row.deletion_password,
    tcecCommittees: await loadTcecCommittees(setupYear, row.tcec_committees),
    firmTypes: fromDbJsonArray(row.firm_types).filter(
      (firmType): firmType is string => typeof firmType === "string",
    ),
    fileTypes: fromDbJsonArray(row.file_types).filter(
      (fileType): fileType is string => typeof fileType === "string",
    ),
    fileTypeGroups: normalizeFileTypeGroups(
      row.file_type_groups,
      fromDbJsonArray(row.file_types).filter(
        (fileType): fileType is string => typeof fileType === "string",
      ),
    ),
    modes: fromDbJsonArray(row.modes).filter((mode): mode is string => typeof mode === "string"),
    valueThresholdLevels: await loadValueThresholdLevels(setupYear),
    milestones: fromDbJsonArray(row.milestones) as string[],
    tableFieldPresets: [...globalPresets, ...personalPresets],
    mmgLiveEnabled: row.mmg_live_enabled,
    mmgLiveOptions: fromDbJsonArray(row.mmg_live_options).filter(
      (option): option is string => typeof option === "string",
    ),
    mmgSummaryFields: fromDbJsonArray(row.mmg_summary_fields).filter(
      (field) => field && typeof field === "object" && !Array.isArray(field),
    ),
    demandProcessingPresets: fromDbJsonArray(row.demand_processing_presets).filter(
      (preset) => preset && typeof preset === "object" && !Array.isArray(preset),
    ),
    demandProcessingDayRanges: fromDbJsonArray(row.demand_processing_day_ranges).filter(
      (range) => range && typeof range === "object" && !Array.isArray(range),
    ),
    bgReceiptDelayDays: normalizeBgReceiptDelayDays(fromDbJsonArray(row.bg_receipt_delay_days)),
    specialFileMarkers: normalizeSpecialFileMarkers(fromDbJsonArray(row.special_file_markers)),
    firmUniqueNoLabel: fromDbText(row.firm_unique_no_label) || "Firm Unique No.",
    firmRatingConfig: normalizeFirmRatingConfig(row.firm_rating_config),
    addEditRibbonFields: normalizeAddEditRibbonFields(uiPreferences?.add_edit_ribbon_fields),
    preSoDefaultSoOffsetDays: Number(row.pre_so_default_so_offset_days ?? 30),
    preSoDefaultPaymentOffsetDays: Number(row.pre_so_default_payment_offset_days ?? 30),
    ...(liveStatusLockedFields !== undefined ? { liveStatusLockedFields } : {}),
    activeUserId: fromDbText(row.active_user_id) || undefined,
  };
}

async function replaceTcecCommittees(financialYear: string, committees: unknown[]) {
  await pool.query("delete from tcec_committees where financial_year = $1", [financialYear]);
  let sortOrder = 0;
  for (const committee of committees) {
    const name = toDbText(committee);
    if (!name) continue;
    await pool.query(
      `insert into tcec_committees (financial_year, name, sort_order)
       values ($1, $2, $3)
       on conflict do nothing`,
      [financialYear, name, sortOrder++],
    );
  }
}

function readOptionalAmount(value: unknown, field: string) {
  const text = toDbText(value);
  if (!text) return null;
  const parsed = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(400, `${field} must be a positive number.`);
  }
  return parsed.toFixed(2);
}

function readValueThresholdLevels(value: unknown) {
  if (!Array.isArray(value)) throw new HttpError(400, "valueThresholdLevels must be an array.");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, "Each threshold level must be an object.");
    }
    const candidate = item as Record<string, unknown>;
    const levelNumber = Number(candidate.levelNumber ?? index + 1);
    if (!Number.isInteger(levelNumber) || levelNumber < 1) {
      throw new HttpError(400, "levelNumber must be a positive integer.");
    }
    const label = toDbText(candidate.label) || `Level ${levelNumber}`;
    const appliesTo =
      typeof candidate.appliesTo === "string" &&
      valueThresholdAppliesTo.has(candidate.appliesTo as ValueThresholdAppliesTo)
        ? (candidate.appliesTo as ValueThresholdAppliesTo)
        : "both";
    const minValue = readOptionalAmount(candidate.minValue, `${label} minimum value`);
    const maxValue = readOptionalAmount(candidate.maxValue, `${label} maximum value`);
    if (minValue !== null && maxValue !== null && Number(minValue) > Number(maxValue)) {
      throw new HttpError(400, `${label} minimum cannot be greater than maximum.`);
    }
    return { label, levelNumber, minValue, maxValue, appliesTo };
  });
}

async function replaceValueThresholdLevels(financialYear: string, levels: unknown[]) {
  const normalized = readValueThresholdLevels(levels);
  await pool.query("delete from value_threshold_levels where financial_year = $1", [financialYear]);
  for (const level of normalized) {
    await pool.query(
      `insert into value_threshold_levels (
         financial_year, level_number, label, min_value, max_value, applies_to
       )
       values ($1, $2, $3, $4, $5, $6)`,
      [
        financialYear,
        level.levelNumber,
        level.label,
        level.minValue,
        level.maxValue,
        level.appliesTo,
      ],
    );
  }
}

async function getSettings(user?: AuthRequest["authUser"]) {
  const key = `settings:app:${user?.id ?? "anonymous"}:${user?.role ?? "none"}`;
  return getCached(key, cacheTtl.settingsMs, async () => {
    await ensurePreSoSettingsSchema();
    const result = await pool.query<SettingsRow>(
      `select financial_year, selected_year, coalesce(setup_year, financial_year) as setup_year, year_selection_locked, theme, theme_tint, deletion_password,
              tcec_committees, firm_types, file_types, file_type_groups, modes, milestones, table_field_presets, mmg_live_enabled, mmg_live_options,
              mmg_summary_fields, demand_processing_presets, demand_processing_day_ranges,
              bg_receipt_delay_days, special_file_markers, firm_unique_no_label, firm_rating_config, active_user_id,
              pre_so_default_so_offset_days, pre_so_default_payment_offset_days
       from app_settings
       where id = true`,
    );
    if (!result.rows[0]) throw new HttpError(404, "Settings row not found. Run seed defaults.");
    return mapSettings(result.rows[0], user);
  });
}

let preSoSettingsSchemaReady: Promise<void> | undefined;

function ensurePreSoSettingsSchema() {
  preSoSettingsSchemaReady ??= pool
    .query(
      `alter table app_settings
         add column if not exists pre_so_default_so_offset_days integer not null default 30;
       alter table app_settings
         add column if not exists pre_so_default_payment_offset_days integer not null default 30`,
    )
    .then(() => undefined);
  return preSoSettingsSchemaReady;
}

function clearSettingsCache() {
  clearCachePrefix("settings:");
  clearCachePrefix("divisions:");
  clearCachePrefix("lookup:financial-years");
  clearCachePrefix("lookup:selected-year");
  clearCachePrefix("lookup:tcec-committees:");
  clearCachePrefix("lookup:value-thresholds:");
}

function readTheme(value: unknown) {
  if (typeof value !== "string" || !themes.has(value as AppTheme)) {
    throw new HttpError(400, "theme must be light or dark.");
  }
  return value as AppTheme;
}

function readThemeTint(value: unknown) {
  if (typeof value !== "string" || !themeTints.has(value as AppThemeTint)) {
    throw new HttpError(400, "themeTint is invalid.");
  }
  return value as AppThemeTint;
}

function readArray(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be an array.`);
  return JSON.stringify(value);
}

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

function readNonNegativeInteger(value: unknown, field: string) {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(typeof value === "string" ? value : "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(400, `${field} must be a non-negative number.`);
  }
  return Math.floor(parsed);
}

function readBgReceiptDelayDays(value: unknown) {
  if (!Array.isArray(value)) throw new HttpError(400, "bgReceiptDelayDays must be an array.");
  return normalizeBgReceiptDelayDays(value);
}

function readArrayValue(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be an array.`);
  return value;
}

function normalizeSpecialFileMarkers(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const rows: Array<{ code: string; description: string }> = [];
  for (const item of source) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const code = String(record.code ?? "")
      .trim()
      .toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    rows.push({
      code,
      description: String(record.description ?? "").trim(),
    });
  }
  return rows;
}

function readSpecialFileMarkers(value: unknown) {
  if (!Array.isArray(value)) throw new HttpError(400, "specialFileMarkers must be an array.");
  return normalizeSpecialFileMarkers(value);
}

function normalizePresetForStorage(preset: unknown) {
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) return undefined;
  const candidate = preset as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string") return undefined;
  if (!Array.isArray(candidate.fieldKeys)) return undefined;
  return {
    id: candidate.id,
    name: candidate.name,
    fieldKeys: candidate.fieldKeys.filter((key): key is string => typeof key === "string"),
  };
}

function readPresetArray(value: unknown, field: string) {
  return readArrayValue(value, field).map(normalizePresetForStorage).filter(Boolean);
}

async function replaceUserTableFieldPresets(ownerKey: string, presets: unknown[]) {
  await pool.query(
    `insert into user_table_field_presets (owner_key, presets)
     values ($1, $2::jsonb)
     on conflict (owner_key)
     do update set presets = excluded.presets, updated_at = now()`,
    [ownerKey, JSON.stringify(presets)],
  );
}

function readStringArray(value: unknown, field: string) {
  return readArrayValue(value, field)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readFileTypeGroups(value: unknown): FileTypeGroupSetting[] {
  return readArrayValue(value, "fileTypeGroups")
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const candidate = item as Record<string, unknown>;
      const fileType = toDbText(candidate.fileType);
      if (!fileType) return undefined;
      return {
        fileType,
        group: candidate.group === "contract" ? "contract" : "goodsServices",
      } satisfies FileTypeGroupSetting;
    })
    .filter((item): item is FileTypeGroupSetting => Boolean(item));
}

async function reconcileFileTypeChanges(
  nextFileTypes: string[],
  nextFileTypeGroups: FileTypeGroupSetting[],
) {
  const current = await pool.query<{ file_types: unknown; file_type_groups: unknown }>(
    "select file_types, file_type_groups from app_settings where id = true",
  );
  const currentFileTypes = fromDbJsonArray(current.rows[0]?.file_types).filter(
    (item): item is string => typeof item === "string",
  );
  const currentFileTypeGroups = normalizeFileTypeGroups(
    current.rows[0]?.file_type_groups,
    currentFileTypes,
  );
  const normalizedNextFileTypeGroups = normalizeFileTypeGroups(nextFileTypeGroups, nextFileTypes);
  const currentGroupByType = new Map(
    currentFileTypeGroups.map((entry) => [entry.fileType.trim().toLowerCase(), entry.group]),
  );
  const nextGroupByType = new Map(
    normalizedNextFileTypeGroups.map((entry) => [entry.fileType.trim().toLowerCase(), entry.group]),
  );
  const nextSet = new Set(nextFileTypes.map((fileType) => fileType.trim().toLowerCase()));
  const currentSet = new Set(currentFileTypes.map((fileType) => fileType.trim().toLowerCase()));
  const removedFileTypes = currentFileTypes
    .map((fileType) => fileType.trim())
    .filter((fileType) => fileType && !nextSet.has(fileType.toLowerCase()));
  const addedFileTypes = nextFileTypes
    .map((fileType) => fileType.trim())
    .filter((fileType) => fileType && !currentSet.has(fileType.toLowerCase()));

  await assertUsedFileTypeGroupsUnchanged(currentFileTypes, currentGroupByType, nextGroupByType);
  if (!removedFileTypes.length) return;

  const result = await pool.query<{ file_type: string; count: string }>(
    `select coalesce(nullif(trim(file_type), ''), '(blank)') as file_type, count(*)::text
     from files
     where lower(trim(coalesce(file_type, ''))) = any($1::text[])
     group by 1
     order by 1`,
    [removedFileTypes.map((fileType) => fileType.toLowerCase())],
  );
  if (!result.rows.length) return;

  const rename = inferSingleFileTypeRename(
    removedFileTypes,
    addedFileTypes,
    currentGroupByType,
    nextGroupByType,
  );
  if (rename) {
    await pool.query(
      `update files
       set file_type = $2
       where lower(trim(coalesce(file_type, ''))) = $1`,
      [rename.from.toLowerCase(), rename.to],
    );
    return;
  }

  const usedTypes = result.rows.map((row) => `${row.file_type} (${row.count})`).join(", ");
  throw new HttpError(
    400,
    `This file type is used by existing files and cannot be deleted: ${usedTypes}. Rename it instead, or update those files first.`,
  );
}

async function assertUsedFileTypeGroupsUnchanged(
  currentFileTypes: string[],
  currentGroupByType: Map<string, FileTypeGroupSetting["group"]>,
  nextGroupByType: Map<string, FileTypeGroupSetting["group"]>,
) {
  const changedTypes = currentFileTypes
    .map((fileType) => fileType.trim())
    .filter((fileType) => {
      const key = fileType.toLowerCase();
      return nextGroupByType.has(key) && currentGroupByType.get(key) !== nextGroupByType.get(key);
    });
  if (!changedTypes.length) return;

  const result = await pool.query<{ file_type: string; count: string }>(
    `select coalesce(nullif(trim(file_type), ''), '(blank)') as file_type, count(*)::text
     from files
     where lower(trim(coalesce(file_type, ''))) = any($1::text[])
     group by 1
     order by 1`,
    [changedTypes.map((fileType) => fileType.toLowerCase())],
  );
  if (!result.rows.length) return;

  const usedTypes = result.rows.map((row) => `${row.file_type} (${row.count})`).join(", ");
  throw new HttpError(
    400,
    `This file type is used by existing files, so its workflow group cannot be changed: ${usedTypes}.`,
  );
}

function inferSingleFileTypeRename(
  removedFileTypes: string[],
  addedFileTypes: string[],
  currentGroupByType: Map<string, FileTypeGroupSetting["group"]>,
  nextGroupByType: Map<string, FileTypeGroupSetting["group"]>,
) {
  if (removedFileTypes.length !== 1 || addedFileTypes.length !== 1) return undefined;
  const from = removedFileTypes[0];
  const to = addedFileTypes[0];
  if (currentGroupByType.get(from.toLowerCase()) !== nextGroupByType.get(to.toLowerCase())) {
    return undefined;
  }
  return { from, to };
}

function readMmgSummaryFields(value: unknown) {
  return readArrayValue(value, "mmgSummaryFields")
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.key !== "string") return undefined;
      return {
        key: candidate.key,
        label: toDbText(candidate.label) || candidate.key,
        enabled: candidate.enabled !== false,
      };
    })
    .filter(Boolean);
}

function normalizeFirmRatingConfig(value: unknown): FirmRatingConfig {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const fields = Array.isArray(source.fields) ? source.fields : defaultFirmRatingConfig.fields;
  const normalized = fields.reduce<FirmRatingConfig["fields"]>((result, item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return result;
    const candidate = item as Record<string, unknown>;
    const label = toDbText(candidate.label) || `Rating ${index + 1}`;
    const rawId = toDbText(candidate.id) || label;
    const id =
      rawId
        .replace(/[^a-zA-Z0-9]+(.)/g, (_match, chr: string) => chr.toUpperCase())
        .replace(/^[^a-zA-Z]+/, "")
        .replace(/^./, (chr) => chr.toLowerCase()) || `rating${index + 1}`;
    const weightText = toDbText(candidate.weight);
    const parsedWeight = Number.parseFloat(weightText ?? "");
    result.push({
      id,
      label,
      weight: Number.isFinite(parsedWeight) && parsedWeight > 0 ? String(parsedWeight) : "1",
    });
    return result;
  }, []);

  return { fields: normalized.length ? normalized : defaultFirmRatingConfig.fields };
}

async function replaceUserLiveStatusFields(ownerKey: string, fieldKeys: string[]) {
  await ensureUserLiveStatusPreferencesTable();
  await pool.query(
    `insert into user_live_status_preferences (owner_key, field_keys)
     values ($1, $2::jsonb)
     on conflict (owner_key)
     do update set field_keys = excluded.field_keys, updated_at = now()`,
    [ownerKey, JSON.stringify(fieldKeys)],
  );
}

async function replaceUserUiPreferences(
  userId: string,
  preferences: {
    theme?: AppTheme;
    themeTint?: AppThemeTint;
    addEditRibbonFields?: string[];
  },
) {
  await ensureUserUiPreferencesTable();
  await pool.query(
    `insert into user_ui_preferences (user_id, theme, theme_tint, add_edit_ribbon_fields)
     values ($1, $2, $3, $4::jsonb)
     on conflict (user_id)
     do update set
       theme = coalesce(excluded.theme, user_ui_preferences.theme),
       theme_tint = coalesce(excluded.theme_tint, user_ui_preferences.theme_tint),
       add_edit_ribbon_fields = coalesce(
         excluded.add_edit_ribbon_fields,
         user_ui_preferences.add_edit_ribbon_fields
       ),
       updated_at = now()`,
    [
      userId,
      preferences.theme ?? null,
      preferences.themeTint ?? null,
      preferences.addEditRibbonFields ? JSON.stringify(preferences.addEditRibbonFields) : null,
    ],
  );
}

async function replaceUserReportPreferences(
  userId: string,
  reportKey: string,
  preferences: Record<string, unknown>,
) {
  await ensureUserReportPreferencesTable();
  await pool.query(
    `insert into user_report_preferences (user_id, report_key, preferences)
     values ($1, $2, $3::jsonb)
     on conflict (user_id, report_key)
     do update set preferences = excluded.preferences, updated_at = now()`,
    [userId, reportKey, JSON.stringify(preferences)],
  );
}

settingsRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const user = (request as AuthRequest).authUser;
    const settings = await getSettings(user);
    response.json({
      settings:
        user?.role === "admin"
          ? settings
          : {
              ...settings,
              deletionPassword: "",
              activeUserId: user?.id,
            },
    });
  }),
);

settingsRouter.get(
  "/report-preferences/:reportKey",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const reportKey = requireParam(request.params.reportKey, "reportKey");
    const preferences = await loadUserReportPreferences(user.id, reportKey);
    response.json({ preferences });
  }),
);

settingsRouter.get(
  "/ip-access",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    response.json({ ipAccess: await getIpAccessConfig(getRequestIp(request)) });
  }),
);

settingsRouter.patch(
  "/ip-access",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    const mode = requireString(body.mode, "mode") as IpAccessMode;
    if (!ipAccessModes.has(mode)) {
      throw new HttpError(400, "mode must be off, notify, or restrict.");
    }
    await updateIpAccessMode(mode, user);
    response.json({ ipAccess: await getIpAccessConfig(getRequestIp(request)) });
  }),
);

settingsRouter.post(
  "/ip-access/trusted",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    await addTrustedIp(
      requireString(body.ipAddress, "ipAddress"),
      typeof body.remarks === "string" ? body.remarks : "",
      user,
    );
    response.status(201).json({ ipAccess: await getIpAccessConfig(getRequestIp(request)) });
  }),
);

settingsRouter.patch(
  "/ip-access/trusted/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const id = requireParam(request.params.id, "id");
    const body = requireObjectBody(request.body);
    await updateTrustedIp(
      id,
      {
        ...(typeof body.remarks === "string" ? { remarks: body.remarks } : {}),
        ...(typeof body.active === "boolean" ? { active: body.active } : {}),
      },
      user,
    );
    response.json({ ipAccess: await getIpAccessConfig(getRequestIp(request)) });
  }),
);

settingsRouter.post(
  "/ip-access/attempts/:id/archive",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const id = requireParam(request.params.id, "id");
    await archiveIpAttempt(id, user);
    response.json({ ipAccess: await getIpAccessConfig(getRequestIp(request)) });
  }),
);

settingsRouter.delete(
  "/ip-access/attempts/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const id = requireParam(request.params.id, "id");
    const body = requireObjectBody(request.body);
    await verifyDeletionPassword(body.deletionPassword);
    await deleteArchivedIpAttempt(id);
    response.json({ ipAccess: await getIpAccessConfig(getRequestIp(request)) });
  }),
);

settingsRouter.put(
  "/report-preferences/:reportKey",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const reportKey = requireParam(request.params.reportKey, "reportKey");
    const body = requireObjectBody(request.body);
    await replaceUserReportPreferences(user.id, reportKey, body);
    response.json({ preferences: await loadUserReportPreferences(user.id, reportKey) });
  }),
);

settingsRouter.patch(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const body = requireObjectBody(request.body);
    const bodyFields = Object.keys(body);
    const userEditableFields = new Set([
      "theme",
      "themeTint",
      "tableFieldPresets",
      "liveStatusLockedFields",
      "mmgSummaryFields",
      "addEditRibbonFields",
    ]);
    const canUpdateTableFieldPresets =
      !("tableFieldPresets" in body) ||
      user.role === "admin" ||
      user.role === "sub_admin" ||
      user.role === "editor" ||
      user.role === "division_user" ||
      user.role === "viewer" ||
      user.role === "universal_viewer";
    const canUpdateMmgSummaryFields =
      !("mmgSummaryFields" in body) || user.role === "admin" || user.role === "sub_admin";
    const preSoDefaultFields = new Set([
      "preSoDefaultSoOffsetDays",
      "preSoDefaultPaymentOffsetDays",
    ]);
    const canUpdatePreSoDefaults =
      bodyFields.length > 0 &&
      bodyFields.every((field) => preSoDefaultFields.has(field)) &&
      (user.role === "admin" || user.role === "sub_admin");
    const canUpdateUserPreference =
      canUpdateTableFieldPresets &&
      canUpdateMmgSummaryFields &&
      bodyFields.length > 0 &&
      bodyFields.every((field) => userEditableFields.has(field));
    if (user.role !== "admin" && !canUpdateUserPreference && !canUpdatePreSoDefaults)
      throw new HttpError(403, "Admin access required.");
    const fields: string[] = [];
    const values: unknown[] = [];

    const addField = (column: string, value: unknown, cast = "") => {
      values.push(value);
      fields.push(`${column} = $${values.length}${cast}`);
    };

    if ("financialYear" in body) {
      const financialYear = normalizeYearLabel(body.financialYear, "financialYear");
      await ensureFinancialYear(financialYear);
      addField("financial_year", financialYear);
    }
    if ("selectedYear" in body) {
      const selectedYear = normalizeYearLabel(body.selectedYear, "selectedYear");
      if (
        selectedYear !== allFilesYear &&
        selectedYear !== allActiveFilesYear &&
        selectedYear !== activePlusCurrentFyClosedYear
      ) {
        await ensureFinancialYear(selectedYear);
      }
      addField("selected_year", selectedYear);
    }
    if ("setupYear" in body) {
      const setupYear = normalizeYearLabel(body.setupYear, "setupYear");
      if (
        setupYear === allFilesYear ||
        setupYear === allActiveFilesYear ||
        setupYear === activePlusCurrentFyClosedYear
      ) {
        throw new HttpError(400, "setupYear must be a financial year like 2026-27.");
      }
      await ensureFinancialYear(setupYear);
      addField("setup_year", setupYear);
    }
    if ("yearSelectionLocked" in body)
      addField("year_selection_locked", body.yearSelectionLocked === true);
    if ("theme" in body || "themeTint" in body || "addEditRibbonFields" in body) {
      await replaceUserUiPreferences(user.id, {
        ...("theme" in body ? { theme: readTheme(body.theme) } : {}),
        ...("themeTint" in body ? { themeTint: readThemeTint(body.themeTint) } : {}),
        ...("addEditRibbonFields" in body
          ? { addEditRibbonFields: readAddEditRibbonFields(body.addEditRibbonFields) }
          : {}),
      });
    }
    if ("deletionPassword" in body)
      addField("deletion_password", toDbText(body.deletionPassword) ?? "");
    if ("tcecCommittees" in body) {
      const settings = await getSettings();
      await replaceTcecCommittees(
        typeof body.setupYear === "string" && body.setupYear.trim()
          ? body.setupYear.trim()
          : settings.setupYear,
        readArrayValue(body.tcecCommittees, "tcecCommittees"),
      );
    }
    if ("valueThresholdLevels" in body) {
      const settings = await getSettings();
      await replaceValueThresholdLevels(
        typeof body.setupYear === "string" && body.setupYear.trim()
          ? body.setupYear.trim()
          : settings.setupYear,
        readArrayValue(body.valueThresholdLevels, "valueThresholdLevels"),
      );
    }
    if ("milestones" in body)
      addField("milestones", readArray(body.milestones, "milestones"), "::jsonb");
    if ("firmTypes" in body)
      addField(
        "firm_types",
        JSON.stringify(readStringArray(body.firmTypes, "firmTypes")),
        "::jsonb",
      );
    if ("fileTypes" in body || "fileTypeGroups" in body) {
      const settings = await getSettings(user);
      const fileTypes =
        "fileTypes" in body ? readStringArray(body.fileTypes, "fileTypes") : settings.fileTypes;
      const fileTypeGroups =
        "fileTypeGroups" in body
          ? readFileTypeGroups(body.fileTypeGroups)
          : settings.fileTypeGroups;
      await reconcileFileTypeChanges(fileTypes, fileTypeGroups);
      if ("fileTypes" in body) addField("file_types", JSON.stringify(fileTypes), "::jsonb");
      if ("fileTypeGroups" in body)
        addField("file_type_groups", JSON.stringify(fileTypeGroups), "::jsonb");
    }
    if ("modes" in body)
      addField("modes", JSON.stringify(readStringArray(body.modes, "modes")), "::jsonb");
    if ("mmgLiveEnabled" in body) addField("mmg_live_enabled", body.mmgLiveEnabled === true);
    if ("mmgLiveOptions" in body)
      addField(
        "mmg_live_options",
        JSON.stringify(readStringArray(body.mmgLiveOptions, "mmgLiveOptions")),
        "::jsonb",
      );
    if ("mmgSummaryFields" in body)
      addField(
        "mmg_summary_fields",
        JSON.stringify(readMmgSummaryFields(body.mmgSummaryFields)),
        "::jsonb",
      );
    if ("demandProcessingPresets" in body)
      addField(
        "demand_processing_presets",
        JSON.stringify(readArrayValue(body.demandProcessingPresets, "demandProcessingPresets")),
        "::jsonb",
      );
    if ("demandProcessingDayRanges" in body)
      addField(
        "demand_processing_day_ranges",
        JSON.stringify(readArrayValue(body.demandProcessingDayRanges, "demandProcessingDayRanges")),
        "::jsonb",
      );
    if ("bgReceiptDelayDays" in body)
      addField(
        "bg_receipt_delay_days",
        JSON.stringify(readBgReceiptDelayDays(body.bgReceiptDelayDays)),
        "::jsonb",
      );
    if ("specialFileMarkers" in body)
      addField(
        "special_file_markers",
        JSON.stringify(readSpecialFileMarkers(body.specialFileMarkers)),
        "::jsonb",
      );
    if ("firmUniqueNoLabel" in body)
      addField("firm_unique_no_label", toDbText(body.firmUniqueNoLabel) || "Firm Unique No.");
    if ("firmRatingConfig" in body)
      addField(
        "firm_rating_config",
        JSON.stringify(normalizeFirmRatingConfig(body.firmRatingConfig)),
        "::jsonb",
      );
    if ("preSoDefaultSoOffsetDays" in body) {
      if (user.role !== "admin" && user.role !== "sub_admin") {
        throw new HttpError(403, "Admin/Sub-admin access required.");
      }
      addField(
        "pre_so_default_so_offset_days",
        readNonNegativeInteger(body.preSoDefaultSoOffsetDays, "Pre-S.O. default S.O. offset days"),
      );
    }
    if ("preSoDefaultPaymentOffsetDays" in body) {
      if (user.role !== "admin" && user.role !== "sub_admin") {
        throw new HttpError(403, "Admin/Sub-admin access required.");
      }
      addField(
        "pre_so_default_payment_offset_days",
        readNonNegativeInteger(
          body.preSoDefaultPaymentOffsetDays,
          "Pre-S.O. default payment offset days",
        ),
      );
    }
    if ("tableFieldPresets" in body && user.role === "admin") {
      addField(
        "table_field_presets",
        JSON.stringify(readPresetArray(body.tableFieldPresets, "tableFieldPresets")),
        "::jsonb",
      );
    } else if ("tableFieldPresets" in body) {
      const personalPresets = readArrayValue(body.tableFieldPresets, "tableFieldPresets")
        .filter(
          (preset) =>
            preset &&
            typeof preset === "object" &&
            !Array.isArray(preset) &&
            (preset as Record<string, unknown>).owner !== "global",
        )
        .map(normalizePresetForStorage)
        .filter(Boolean);
      const ownerKey = presetOwnerKey(user);
      if (!ownerKey) throw new HttpError(400, "Preset owner is required.");
      await replaceUserTableFieldPresets(ownerKey, personalPresets);
    }
    if ("liveStatusLockedFields" in body) {
      const ownerKey = presetOwnerKey(user);
      if (!ownerKey) throw new HttpError(400, "Live status owner is required.");
      await replaceUserLiveStatusFields(
        ownerKey,
        readStringArray(body.liveStatusLockedFields, "liveStatusLockedFields"),
      );
    }
    if ("activeUserId" in body) addField("active_user_id", toDbText(body.activeUserId));

    if (
      !fields.length &&
      !("tcecCommittees" in body) &&
      !("valueThresholdLevels" in body) &&
      !("firmTypes" in body) &&
      !("fileTypes" in body) &&
      !("modes" in body) &&
      !("tableFieldPresets" in body) &&
      !("liveStatusLockedFields" in body) &&
      !("mmgSummaryFields" in body) &&
      !("theme" in body) &&
      !("themeTint" in body) &&
      !("addEditRibbonFields" in body) &&
      !("bgReceiptDelayDays" in body) &&
      !("specialFileMarkers" in body) &&
      !("firmUniqueNoLabel" in body) &&
      !("preSoDefaultSoOffsetDays" in body) &&
      !("preSoDefaultPaymentOffsetDays" in body)
    ) {
      throw new HttpError(400, "No settings fields provided.");
    }

    if (fields.length) {
      await pool.query(`update app_settings set ${fields.join(", ")} where id = true`, values);
    }
    clearSettingsCache();
    response.json({ settings: await getSettings(user) });
  }),
);

settingsRouter.post(
  "/financial-years",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");

    const body = requireObjectBody(request.body);
    const label = normalizeYearLabel(body.label, "label");
    if (!isFinancialYearLabel(label)) {
      throw new HttpError(400, "Financial year must be entered in YYYY-YY format, like 2026-27.");
    }
    validateContinuousFinancialYear(await loadFinancialYears(), label);
    const settings = await getSettings(user);
    const sourceYear = settings.setupYear || settings.financialYear;
    const client = await pool.connect();

    try {
      await client.query("begin");
      const created = await ensureFinancialYear(label, client);
      if (created) await copyYearSettings(sourceYear, label, client);

      if (body.select === true) {
        await client.query("update app_settings set setup_year = $1 where id = true", [label]);
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    clearSettingsCache();
    response.status(201).json({ settings: await getSettings(user) });
  }),
);

settingsRouter.delete(
  "/financial-years/:label",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");

    const label = requireParam(request.params.label, "label").trim();
    if (!label) throw new HttpError(400, "label is required.");

    const settings = await getSettings(user);
    if (label === settings.financialYear) {
      throw new HttpError(400, "Current financial year cannot be deleted.");
    }
    const fileResult = await pool.query<{ count: string }>(
      `select count(*)
       from files f
       where f.year = $1
          or exists (
            select 1 from file_year_activity a
            where a.file_id = f.id and a.financial_year = $1
          )`,
      [label],
    );
    if (Number(fileResult.rows[0]?.count ?? 0) > 0) {
      throw new HttpError(400, "This year has files and cannot be deleted.");
    }

    await pool.query("delete from division_year_allocations where financial_year = $1", [label]);
    await pool.query("delete from tcec_committees where financial_year = $1", [label]);
    await pool.query("delete from value_threshold_levels where financial_year = $1", [label]);
    await pool.query("delete from financial_years where label = $1", [label]);
    if (label === settings.selectedYear) {
      await pool.query("update app_settings set selected_year = financial_year where id = true");
    }
    if (label === settings.setupYear) {
      await pool.query("update app_settings set setup_year = financial_year where id = true");
    }

    clearSettingsCache();
    response.json({ settings: await getSettings(user) });
  }),
);
