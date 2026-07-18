import { Router } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import type {
  AppSettings,
  AppTheme,
  AppThemeTint,
  ValueThresholdAppliesTo,
  ValueThresholdLevel,
} from "../types.js";
import { requireAuth, type AuthRequest } from "../utils/auth.js";
import { cacheTtl, clearCachePrefix, getCached } from "../utils/cache.js";
import { fromDbJsonArray, fromDbText, toDbText } from "../utils/db-values.js";
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
const allActiveFilesYear = "__all_active_files__";

type SettingsRow = {
  financial_year: string;
  selected_year: string;
  year_selection_locked: boolean;
  theme: AppTheme;
  theme_tint: AppThemeTint;
  deletion_password: string;
  tcec_committees: unknown;
  firm_types: unknown;
  file_types: unknown;
  modes: unknown;
  milestones: unknown;
  table_field_presets: unknown;
  mmg_live_enabled: boolean;
  mmg_live_options: unknown;
  mmg_summary_fields: unknown;
  active_user_id: string | null;
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
  if (label !== allActiveFilesYear && normalizeFinancialYearKey(label) === undefined) {
    throw new HttpError(400, `${field} must be a valid financial year like 2026-27.`);
  }
  return label;
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
      throw new HttpError(400, "New financial year must be entered in YYYY-YY format, like 2026-27.");
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

async function mapSettings(row: SettingsRow, user?: AuthRequest["authUser"]): Promise<AppSettings> {
  const financialYears = await loadFinancialYears();
  const mergedFinancialYears = Array.from(
    new Set(
      [row.financial_year, row.selected_year, ...financialYears]
        .filter(Boolean)
        .filter((year) => year !== allActiveFilesYear),
    ),
  ).sort((a, b) => b.localeCompare(a));
  const globalPresets = tagPresets(row.table_field_presets, "global");
  const ownerKey = presetOwnerKey(user);
  const personalPresets =
    user && user.role !== "admin" && ownerKey
      ? tagPresets(await loadUserTableFieldPresets(ownerKey), "personal", ownerKey)
      : [];
  const liveStatusLockedFields = ownerKey ? await loadUserLiveStatusFields(ownerKey) : undefined;
  return {
    financialYear: row.financial_year,
    selectedYear: row.selected_year,
    financialYears: mergedFinancialYears,
    yearSelectionLocked: row.year_selection_locked,
    theme: row.theme,
    themeTint: row.theme_tint,
    deletionPassword: row.deletion_password,
    tcecCommittees: await loadTcecCommittees(row.selected_year, row.tcec_committees),
    firmTypes: fromDbJsonArray(row.firm_types).filter(
      (firmType): firmType is string => typeof firmType === "string",
    ),
    fileTypes: fromDbJsonArray(row.file_types).filter(
      (fileType): fileType is string => typeof fileType === "string",
    ),
    modes: fromDbJsonArray(row.modes).filter((mode): mode is string => typeof mode === "string"),
    valueThresholdLevels: await loadValueThresholdLevels(row.selected_year),
    milestones: fromDbJsonArray(row.milestones) as string[],
    tableFieldPresets: [...globalPresets, ...personalPresets],
    mmgLiveEnabled: row.mmg_live_enabled,
    mmgLiveOptions: fromDbJsonArray(row.mmg_live_options).filter(
      (option): option is string => typeof option === "string",
    ),
    mmgSummaryFields: fromDbJsonArray(row.mmg_summary_fields).filter(
      (field) => field && typeof field === "object" && !Array.isArray(field),
    ),
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
    const result = await pool.query<SettingsRow>(
      `select financial_year, selected_year, year_selection_locked, theme, theme_tint, deletion_password,
              tcec_committees, firm_types, file_types, modes, milestones, table_field_presets, mmg_live_enabled, mmg_live_options,
              mmg_summary_fields, active_user_id
       from app_settings
       where id = true`,
    );
    if (!result.rows[0]) throw new HttpError(404, "Settings row not found. Run seed defaults.");
    return mapSettings(result.rows[0], user);
  });
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

function readArrayValue(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be an array.`);
  return value;
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
  return readArrayValue(value, field).filter((item): item is string => typeof item === "string");
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

settingsRouter.patch(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const body = requireObjectBody(request.body);
    const bodyFields = Object.keys(body);
    const userEditableFields = new Set([
      "selectedYear",
      "theme",
      "themeTint",
      "tableFieldPresets",
      "liveStatusLockedFields",
      "mmgSummaryFields",
    ]);
    const canUpdateTableFieldPresets =
      !("tableFieldPresets" in body) ||
      user.role === "admin" ||
      user.role === "sub_admin" ||
      user.role === "editor" ||
      user.role === "division_user" ||
      user.role === "viewer";
    const canUpdateMmgSummaryFields =
      !("mmgSummaryFields" in body) || user.role === "admin" || user.role === "sub_admin";
    const canUpdateUserPreference =
      canUpdateTableFieldPresets &&
      canUpdateMmgSummaryFields &&
      bodyFields.length > 0 &&
      bodyFields.every((field) => userEditableFields.has(field));
    if (user.role !== "admin" && !canUpdateUserPreference)
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
      if (selectedYear !== allActiveFilesYear) await ensureFinancialYear(selectedYear);
      addField("selected_year", selectedYear);
    }
    if ("yearSelectionLocked" in body)
      addField("year_selection_locked", body.yearSelectionLocked === true);
    if ("theme" in body) addField("theme", readTheme(body.theme));
    if ("themeTint" in body) addField("theme_tint", readThemeTint(body.themeTint));
    if ("deletionPassword" in body)
      addField("deletion_password", toDbText(body.deletionPassword) ?? "");
    if ("tcecCommittees" in body) {
      await replaceTcecCommittees(
        typeof body.selectedYear === "string" && body.selectedYear.trim()
          ? body.selectedYear.trim()
          : (await getSettings()).selectedYear,
        readArrayValue(body.tcecCommittees, "tcecCommittees"),
      );
    }
    if ("valueThresholdLevels" in body) {
      await replaceValueThresholdLevels(
        typeof body.selectedYear === "string" && body.selectedYear.trim()
          ? body.selectedYear.trim()
          : (await getSettings()).selectedYear,
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
    if ("fileTypes" in body)
      addField(
        "file_types",
        JSON.stringify(readStringArray(body.fileTypes, "fileTypes")),
        "::jsonb",
      );
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
      !("mmgSummaryFields" in body)
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
    const sourceYear =
      settings.selectedYear === allActiveFilesYear ? settings.financialYear : settings.selectedYear;
    const client = await pool.connect();

    try {
      await client.query("begin");
      const created = await ensureFinancialYear(label, client);
      if (created) await copyYearSettings(sourceYear, label, client);

      if (body.select === true) {
        await client.query("update app_settings set selected_year = $1 where id = true", [label]);
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

    clearSettingsCache();
    response.json({ settings: await getSettings(user) });
  }),
);
