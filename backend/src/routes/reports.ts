import { Router } from "express";
import { pool } from "../db/pool.js";
import type {
  AppSettings,
  AuthUser,
  FileRecord,
  SupplementaryBillDetail,
  SupplyOrderDetail,
} from "../types.js";
import { ensureSupplyOrderBillReturnsSchema, loadFiles } from "./files.js";
import { fromDbDate, fromDbJsonArray, fromDbText } from "../utils/db-values.js";
import { buildReportsSummary } from "../utils/report-summary.js";
import {
  getFileCategorySqlCondition,
  matchesFileCategorySelection,
  normalizeFileCategories,
  type FileCategoryKey,
} from "../utils/file-categories.js";
import {
  isContractFileType,
  isDeliveryInspectionApplicableByGroup,
} from "../utils/file-type-groups.js";
import {
  canAccessDivision,
  canUseAllDivisions,
  getAuthScopeCacheKey,
  getDivisionScopeCondition,
  getFileCategoryScopeCondition,
  requireAuth,
  type AuthRequest,
} from "../utils/auth.js";
import { cacheTtl, getCached } from "../utils/cache.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import {
  filePaymentEntries,
  filePaymentOrders,
  rawSupplyOrders,
} from "../utils/effective-deliveries.js";
import { normalizeBillReturnCycles } from "../utils/refloat-returned-bill.js";

export const reportsRouter = Router();

const DEFAULT_BILL_PAYMENT_OFFSET_DAYS = 5;
const DEFAULT_BILL_SUBMISSION_OFFSET_DAYS = 5;
const DEFAULT_DP_OFFSET_DAYS = 10;
const DEFAULT_PRE_SO_OFFSET_DAYS = 30;

type CashOutgoRow = {
  monthKey: string;
  month: string;
  capital: number;
  revenue: number;
  total: number;
};

type MerCashOutgoRow = {
  financial_year: string;
  month_key: string;
  capital: string | number;
  revenue: string | number;
  total: string | number;
  updated_at: string | Date | null;
};

type CashOutGoPlanSettings = {
  billOffsetDays: number;
  useCustomBillOffsetDays: boolean;
  handSubmissionOffsetDays: number;
  useCustomHandSubmissionOffsetDays: boolean;
  dpOffsetDays: number;
  useCustomDpOffsetDays: boolean;
};

type CashOutGoPlanAssumption = {
  expectedSentDate?: string;
  expectedPaymentDate?: string;
  billOffsetDays?: number;
};

type CashOutGoPlanDetailRow = {
  rowKey: string;
  section: "submitted" | "hand" | "delivered" | "dp" | "dpExpired";
  fileId: string;
  fileRef: string;
  sourceFocusTarget: string;
  description: string;
  firm: string;
  amountSource: string;
  baseDate: string;
  expectedSentDate: string;
  expectedSentDateOverride: string;
  actualSentDate: string;
  manualExpectedPaymentDate: string;
  billOffsetDays: number;
  billOffsetOverride: string;
  expectedPaymentDate: string;
  capital: number;
  revenue: number;
  total: number;
  overdue: boolean;
};

type CashOutGoPlanPayload = {
  financialYear: string;
  today: string;
  settings: CashOutGoPlanSettings;
  allocation: {
    divisionId: string;
    capital: number;
    revenue: number;
  };
  expenditureTillDate: CashOutgoRow[];
  billsSubmitted: CashOutGoPlanDetailRow[];
  billsAtHand: CashOutGoPlanDetailRow[];
  deliveredBillsPending: CashOutGoPlanDetailRow[];
  dpBasedForecast: CashOutGoPlanDetailRow[];
  dpExpired: CashOutGoPlanDetailRow[];
  monthwisePlan: CashOutgoRow[];
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
  supplementaryBillSentForPaymentRows: CashOutgoRow[];
  supplementaryActualCashOutgoRows: CashOutgoRow[];
  pendingReturnedBillRows: CashOutgoRow[];
  returnedBillResubmittedRows: CashOutgoRow[];
  returnedBillPaidRows: CashOutgoRow[];
  supplementaryPendingReturnedBillRows: CashOutgoRow[];
  supplementaryReturnedBillResubmittedRows: CashOutgoRow[];
  supplementaryReturnedBillPaidRows: CashOutgoRow[];
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
    reviewedColumn: "f.ad_sent_date",
    currentColumn: "f.ad_vetting_date",
    appliesColumn: "f.ad",
  },
  {
    key: "rqa",
    label: "R&QA",
    totalLabel: "Total cases",
    reviewedColumn: "f.rqa_sent_date",
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
    key: "refloatBidding",
    label: "Refloat bidding",
    totalLabel: "Total cases",
    currentColumn: "f.bidding_stage_over",
    appliesColumn: "f.refloat",
    yesComplete: true,
  },
  {
    key: "refloatPostTcec",
    label: "Refloat Post-TCEC",
    totalLabel: "Total cases",
    reviewedColumn: "f.refloat_post_tcec_date",
    currentColumn: "f.refloat_post_tcec_minutes_date",
    appliesColumn: "f.refloat",
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

const billReturnedDelayMilestoneKey = "billReturnedForCorrection";
const supplementaryBillReturnedDelayMilestoneKey = "supplementaryBillReturnedForCorrection";

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
      `${isYesExpression("f.ir")} and lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')`,
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
  bg_receipt_delay_days: unknown;
  active_user_id: string | null;
  pre_so_default_so_offset_days: number;
  pre_so_default_payment_offset_days: number;
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
    bgReceiptDelayDays: normalizeBgReceiptDelayDays(fromDbJsonArray(row.bg_receipt_delay_days)),
    activeUserId: fromDbText(row.active_user_id) || undefined,
    preSoDefaultSoOffsetDays: Number(
      row.pre_so_default_so_offset_days ?? DEFAULT_PRE_SO_OFFSET_DAYS,
    ),
    preSoDefaultPaymentOffsetDays: Number(
      row.pre_so_default_payment_offset_days ?? DEFAULT_PRE_SO_OFFSET_DAYS,
    ),
  };
}

async function loadSettings() {
  return getCached("settings:reports", cacheTtl.settingsMs, async () => {
    await ensurePreSoCashOutgoSchema();
    const result = await pool.query<SettingsRow>(
      `select financial_year, selected_year, coalesce(setup_year, financial_year) as setup_year, year_selection_locked, theme, theme_tint, deletion_password,
              tcec_committees, firm_types, file_types, file_type_groups, modes, milestones, table_field_presets,
              bg_receipt_delay_days, active_user_id,
              pre_so_default_so_offset_days, pre_so_default_payment_offset_days
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

function readBoolean(value: unknown) {
  return value === true || value === "true";
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

let merCashOutgoSchemaReady: Promise<void> | undefined;

function ensureMerCashOutgoSchema() {
  merCashOutgoSchemaReady ??= pool
    .query(
      `create table if not exists mer_cash_outgo (
        financial_year text not null,
        month_key text not null,
        capital numeric not null default 0,
        revenue numeric not null default 0,
        updated_at timestamptz not null default now(),
        primary key (financial_year, month_key),
        constraint mer_cash_outgo_month_key_format check (month_key ~ '^[0-9]{4}-[0-9]{2}$')
      )`,
    )
    .then(() => undefined);
  return merCashOutgoSchemaReady;
}

let cashOutGoPlanSchemaReady: Promise<void> | undefined;

function ensureCashOutGoPlanSchema() {
  cashOutGoPlanSchemaReady ??= pool
    .query(
      `create table if not exists cash_out_go_plan_settings (
        id text primary key default 'global',
        bill_offset_days integer not null default 5,
        use_custom_bill_offset_days boolean not null default false,
        hand_submission_offset_days integer not null default 5,
        use_custom_hand_submission_offset_days boolean not null default false,
        dp_offset_days integer not null default 10,
        use_custom_dp_offset_days boolean not null default false,
        updated_at timestamptz not null default now(),
        constraint cash_out_go_plan_settings_singleton check (id = 'global'),
        constraint cash_out_go_plan_bill_offset_non_negative check (bill_offset_days >= 0),
        constraint cash_out_go_plan_hand_submission_offset_non_negative
          check (hand_submission_offset_days >= 0),
        constraint cash_out_go_plan_dp_offset_non_negative check (dp_offset_days >= 0)
      );
      alter table cash_out_go_plan_settings
        drop constraint if exists cash_out_go_plan_settings_singleton;
      alter table cash_out_go_plan_settings
        add column if not exists hand_submission_offset_days integer not null default 5;
      alter table cash_out_go_plan_settings
        add column if not exists use_custom_bill_offset_days boolean not null default false;
      alter table cash_out_go_plan_settings
        add column if not exists use_custom_hand_submission_offset_days boolean not null default false;
      alter table cash_out_go_plan_settings
        add column if not exists use_custom_dp_offset_days boolean not null default false;
      insert into cash_out_go_plan_settings
        (id, bill_offset_days, hand_submission_offset_days, dp_offset_days)
      values
        ('global', ${DEFAULT_BILL_PAYMENT_OFFSET_DAYS}, ${DEFAULT_BILL_SUBMISSION_OFFSET_DAYS}, ${DEFAULT_DP_OFFSET_DAYS})
      on conflict (id) do nothing;
      create table if not exists cash_out_go_plan_assumptions (
        row_key text primary key,
        scope_key text not null default 'global',
        expected_sent_date date,
        expected_payment_date date,
        bill_offset_days integer,
        updated_at timestamptz not null default now(),
        constraint cash_out_go_plan_assumption_offset_non_negative
          check (bill_offset_days is null or bill_offset_days >= 0)
      );
      alter table cash_out_go_plan_assumptions
        add column if not exists scope_key text not null default 'global';
      alter table cash_out_go_plan_assumptions
        add column if not exists expected_payment_date date;
      alter table cash_out_go_plan_assumptions
        drop constraint if exists cash_out_go_plan_assumptions_pkey;
      alter table cash_out_go_plan_assumptions
        add primary key (scope_key, row_key)`,
    )
    .then(() => undefined);
  return cashOutGoPlanSchemaReady;
}

function getCashOutGoPlanScopeKey(user: AuthUser) {
  if (user.role === "universal_viewer" && user.cashOutgoEditScope === "personal") return user.id;
  return "global";
}

function canSaveCashOutGoPlan(user: AuthUser) {
  return (
    user.role === "admin" ||
    user.role === "sub_admin" ||
    user.role === "editor" ||
    (user.role === "universal_viewer" &&
      (user.cashOutgoEditScope === "personal" || user.cashOutgoEditScope === "global"))
  );
}

let preSoCashOutgoSchemaReady: Promise<void> | undefined;

function ensurePreSoCashOutgoSchema() {
  preSoCashOutgoSchemaReady ??= pool
    .query(
      `alter table app_settings
         add column if not exists pre_so_default_so_offset_days integer not null default 30;
       alter table app_settings
         add column if not exists pre_so_default_payment_offset_days integer not null default 30;
       create table if not exists pre_so_cash_outgo_stage_offsets (
         scope_key text not null,
         stage_key text not null,
         so_offset_days integer not null,
         payment_offset_days integer not null,
         updated_by uuid references app_users(id) on delete set null,
         updated_at timestamptz not null default now(),
         primary key (scope_key, stage_key),
         constraint pre_so_stage_so_offset_non_negative check (so_offset_days >= 0),
         constraint pre_so_stage_payment_offset_non_negative check (payment_offset_days >= 0)
       );
       create table if not exists pre_so_cash_outgo_file_plans (
         scope_key text not null,
         file_id uuid not null references files(id) on delete cascade,
         included boolean not null default false,
         tentative_so_date date,
         tentative_payment_date date,
         updated_by uuid references app_users(id) on delete set null,
         updated_at timestamptz not null default now(),
         primary key (scope_key, file_id)
       )`,
    )
    .then(() => undefined);
  return preSoCashOutgoSchemaReady;
}

function getPreSoCashOutgoScopeKey(user: AuthUser) {
  if (user.role === "universal_viewer" && user.cashOutgoEditScope === "personal") return user.id;
  return "global";
}

function canSavePreSoCashOutgoPlan(user: AuthUser) {
  return (
    user.role === "admin" ||
    user.role === "sub_admin" ||
    user.role === "editor" ||
    (user.role === "universal_viewer" &&
      (user.cashOutgoEditScope === "personal" || user.cashOutgoEditScope === "global"))
  );
}

function canSavePreSoStageOffsets(user: AuthUser) {
  return (
    user.role === "admin" ||
    user.role === "sub_admin" ||
    (user.role === "universal_viewer" && user.cashOutgoEditScope === "global")
  );
}

async function loadPreSoCashOutgoPlan(scopeKey: string, user?: AuthUser) {
  await ensurePreSoCashOutgoSchema();
  const scopeKeys = scopeKey === "global" ? ["global"] : ["global", scopeKey];
  const [stageResult, fileResult] = await Promise.all([
    pool.query<{
      scope_key: string;
      stage_key: string;
      so_offset_days: number;
      payment_offset_days: number;
    }>(
      `select scope_key, stage_key, so_offset_days, payment_offset_days
       from pre_so_cash_outgo_stage_offsets
       where scope_key = any($1::text[])
       order by case when scope_key = $2 then 1 else 0 end`,
      [scopeKeys, scopeKey],
    ),
    pool.query<{
      scope_key: string;
      file_id: string;
      included: boolean;
      tentative_so_date: Date | string | null;
      tentative_payment_date: Date | string | null;
    }>(
      `select p.scope_key, p.file_id, p.included, p.tentative_so_date, p.tentative_payment_date
       from pre_so_cash_outgo_file_plans p
       join files f on f.id = p.file_id and f.archived_at is null
       where p.scope_key = any($1::text[])
         and (
           $3::boolean
           or f.division_id = any($4::uuid[])
           or f.division_id is null
         )
       order by case when scope_key = $2 then 1 else 0 end`,
      [scopeKeys, scopeKey, !user || canUseAllDivisions(user), user?.divisionIds ?? []],
    ),
  ]);
  const stageOffsets: Record<string, { soOffsetDays: number; paymentOffsetDays: number }> = {};
  stageResult.rows.forEach((row) => {
    stageOffsets[row.stage_key] = {
      soOffsetDays: Number(row.so_offset_days ?? DEFAULT_PRE_SO_OFFSET_DAYS),
      paymentOffsetDays: Number(row.payment_offset_days ?? DEFAULT_PRE_SO_OFFSET_DAYS),
    };
  });
  const filePlans: Record<
    string,
    { included: boolean; tentativeSoDate: string; tentativePaymentDate: string }
  > = {};
  fileResult.rows.forEach((row) => {
    filePlans[row.file_id] = {
      included: Boolean(row.included),
      tentativeSoDate: fromDbDate(row.tentative_so_date) ?? "",
      tentativePaymentDate: fromDbDate(row.tentative_payment_date) ?? "",
    };
  });
  return { stageOffsets, filePlans };
}

async function assertPreSoFilePlanAccess(
  user: AuthUser,
  fileIds: string[],
): Promise<Set<string>> {
  const uniqueFileIds = Array.from(new Set(fileIds.filter(Boolean)));
  if (!uniqueFileIds.length) return new Set();
  const result = await pool.query<{ id: string; division_id: string | null }>(
    `select id, division_id
     from files
     where id = any($1::uuid[]) and archived_at is null`,
    [uniqueFileIds],
  );
  const accessibleIds = new Set<string>();
  result.rows.forEach((row) => {
    if (canAccessDivision(user, row.division_id)) accessibleIds.add(row.id);
  });
  if (accessibleIds.size !== uniqueFileIds.length) {
    throw new HttpError(403, "You cannot save Pre-S.O. plan rows for files outside your divisions.");
  }
  return accessibleIds;
}

function canSaveMerData(user: AuthUser) {
  return (
    user.role === "admin" ||
    user.role === "sub_admin" ||
    user.role === "editor" ||
    (user.role === "universal_viewer" && user.cashOutgoEditScope === "global")
  );
}

async function loadCashOutGoPlanSettings(scopeKey: string): Promise<CashOutGoPlanSettings> {
  await ensureCashOutGoPlanSchema();
  const result = await pool.query<{
    bill_offset_days: number;
    use_custom_bill_offset_days: boolean;
    hand_submission_offset_days: number;
    use_custom_hand_submission_offset_days: boolean;
    dp_offset_days: number;
    use_custom_dp_offset_days: boolean;
  }>(
    `select
       bill_offset_days,
       use_custom_bill_offset_days,
       hand_submission_offset_days,
       use_custom_hand_submission_offset_days,
       dp_offset_days,
       use_custom_dp_offset_days
     from cash_out_go_plan_settings
     where id = $1`,
    [scopeKey],
  );
  let row = result.rows[0];
  if (!row && scopeKey !== "global") {
    const fallbackResult = await pool.query<{
      bill_offset_days: number;
      use_custom_bill_offset_days: boolean;
      hand_submission_offset_days: number;
      use_custom_hand_submission_offset_days: boolean;
      dp_offset_days: number;
      use_custom_dp_offset_days: boolean;
    }>(
      `select
         bill_offset_days,
         use_custom_bill_offset_days,
         hand_submission_offset_days,
         use_custom_hand_submission_offset_days,
         dp_offset_days,
         use_custom_dp_offset_days
       from cash_out_go_plan_settings
       where id = 'global'`,
    );
    row = fallbackResult.rows[0];
  }
  return {
    billOffsetDays: Number(row?.bill_offset_days ?? DEFAULT_BILL_PAYMENT_OFFSET_DAYS),
    useCustomBillOffsetDays: Boolean(row?.use_custom_bill_offset_days),
    handSubmissionOffsetDays: Number(
      row?.hand_submission_offset_days ?? DEFAULT_BILL_SUBMISSION_OFFSET_DAYS,
    ),
    useCustomHandSubmissionOffsetDays: Boolean(row?.use_custom_hand_submission_offset_days),
    dpOffsetDays: Number(row?.dp_offset_days ?? DEFAULT_DP_OFFSET_DAYS),
    useCustomDpOffsetDays: Boolean(row?.use_custom_dp_offset_days),
  };
}

function getEffectiveBillPaymentOffsetDays(settings: CashOutGoPlanSettings) {
  return settings.useCustomBillOffsetDays
    ? settings.billOffsetDays
    : DEFAULT_BILL_PAYMENT_OFFSET_DAYS;
}

function getEffectiveBillSubmissionOffsetDays(settings: CashOutGoPlanSettings) {
  return settings.useCustomHandSubmissionOffsetDays
    ? settings.handSubmissionOffsetDays
    : DEFAULT_BILL_SUBMISSION_OFFSET_DAYS;
}

function getEffectiveDpOffsetDays(settings: CashOutGoPlanSettings) {
  return settings.useCustomDpOffsetDays ? settings.dpOffsetDays : DEFAULT_DP_OFFSET_DAYS;
}

function getEffectiveRowBillPaymentOffsetDays(
  settings: CashOutGoPlanSettings,
  assumption: CashOutGoPlanAssumption,
) {
  return assumption.billOffsetDays ?? getEffectiveBillPaymentOffsetDays(settings);
}

function getRowBillPaymentOffsetOverride(assumption: CashOutGoPlanAssumption) {
  return assumption.billOffsetDays === undefined ? "" : String(assumption.billOffsetDays);
}

async function loadCashOutGoPlanAssumptions(scopeKey: string) {
  await ensureCashOutGoPlanSchema();
  const scopeKeys = scopeKey === "global" ? ["global"] : ["global", scopeKey];
  const result = await pool.query<{
    row_key: string;
    scope_key: string;
    expected_sent_date: Date | string | null;
    expected_payment_date: Date | string | null;
    bill_offset_days: number | null;
  }>(
    `select row_key, scope_key, expected_sent_date, expected_payment_date, bill_offset_days
     from cash_out_go_plan_assumptions
     where scope_key = any($1::text[])
     order by case when scope_key = $2 then 1 else 0 end asc`,
    [scopeKeys, scopeKey],
  );
  const assumptions = new Map<string, CashOutGoPlanAssumption>();
  for (const row of result.rows) {
    assumptions.set(row.row_key, {
      expectedSentDate: fromDbDate(row.expected_sent_date),
      expectedPaymentDate: fromDbDate(row.expected_payment_date),
      billOffsetDays: row.bill_offset_days === null ? undefined : Number(row.bill_offset_days),
    });
  }
  return assumptions;
}

async function loadCashOutGoPlanAllocation(financialYear: string, divisionId: string) {
  const params: unknown[] = [financialYear];
  const divisionCondition =
    divisionId === "all" ? "" : `and d.id = $${params.push(divisionId)}::uuid`;
  const result = await pool.query<{ capital: string | number; revenue: string | number }>(
    `select
       coalesce(sum(coalesce(a.allocated_capital, d.allocated_capital, 0)), 0) as capital,
       coalesce(sum(coalesce(a.allocated_revenue, d.allocated_revenue, 0)), 0) as revenue
     from divisions d
     left join division_year_allocations a
       on a.division_id = d.id and a.financial_year = $1
     where d.archived_at is null
       ${divisionCondition}`,
    params,
  );
  return {
    divisionId,
    capital: Number(result.rows[0]?.capital ?? 0),
    revenue: Number(result.rows[0]?.revenue ?? 0),
  };
}

async function loadCashOutGoPlanAllocationForUser(
  financialYear: string,
  divisionId: string,
  user: ReturnType<typeof requireAuth>,
) {
  if (divisionId !== "all") {
    if (!canAccessDivision(user, divisionId)) throw new HttpError(403, "Division access denied.");
    return loadCashOutGoPlanAllocation(financialYear, divisionId);
  }
  if (canUseAllDivisions(user)) return loadCashOutGoPlanAllocation(financialYear, "all");
  if (!user.divisionIds.length) return { divisionId: "all", capital: 0, revenue: 0 };
  const params: unknown[] = [financialYear, user.divisionIds];
  const result = await pool.query<{ capital: string | number; revenue: string | number }>(
    `select
       coalesce(sum(coalesce(a.allocated_capital, d.allocated_capital, 0)), 0) as capital,
       coalesce(sum(coalesce(a.allocated_revenue, d.allocated_revenue, 0)), 0) as revenue
     from divisions d
     left join division_year_allocations a
       on a.division_id = d.id and a.financial_year = $1
     where d.archived_at is null
       and d.id = any($2::uuid[])`,
    params,
  );
  return {
    divisionId: "all",
    capital: Number(result.rows[0]?.capital ?? 0),
    revenue: Number(result.rows[0]?.revenue ?? 0),
  };
}

function isFinancialYearLabel(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

function normalizeMerAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapMerCashOutgoRow(row: MerCashOutgoRow) {
  const capital = Number(row.capital ?? 0);
  const revenue = Number(row.revenue ?? 0);
  return {
    financialYear: row.financial_year,
    monthKey: row.month_key,
    capital,
    revenue,
    total: Number(row.total ?? capital + revenue),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  };
}

async function loadMerCashOutgoRows(financialYear: string) {
  await ensureMerCashOutgoSchema();
  const result = await pool.query<MerCashOutgoRow>(
    `select financial_year, month_key, capital, revenue, capital + revenue as total, updated_at
     from mer_cash_outgo
     where financial_year = $1
     order by month_key asc`,
    [financialYear],
  );
  return result.rows.map(mapMerCashOutgoRow);
}

function buildCashOutGoPlan(
  files: FileRecord[],
  financialYear: string,
  merRows: ReturnType<typeof mapMerCashOutgoRow>[],
  settings: CashOutGoPlanSettings,
  assumptions: Map<string, CashOutGoPlanAssumption>,
  includePreviousFySubmitted: boolean,
  allocation: CashOutGoPlanPayload["allocation"],
): CashOutGoPlanPayload {
  const today = formatDate(new Date());
  const currentMonthKey = today.slice(0, 7);
  const fyMonths = getFinancialYearMonthKeys(financialYear);
  const fyRange = getFinancialYearDateRange(financialYear);
  const expenditureTillDate = buildExpenditureTillDateRows(
    files,
    merRows,
    financialYear,
    currentMonthKey,
  );
  const submittedRows: CashOutGoPlanDetailRow[] = [];
  const handRows: CashOutGoPlanDetailRow[] = [];
  const deliveredRows: CashOutGoPlanDetailRow[] = [];
  const dpRows: CashOutGoPlanDetailRow[] = [];
  const dpExpiredRows: CashOutGoPlanDetailRow[] = [];
  const billSubmissionOffsetDays = getEffectiveBillSubmissionOffsetDays(settings);
  const dpOffsetDays = getEffectiveDpOffsetDays(settings);

  files.forEach((file) => {
    if (isYes(file.demandCancelled)) return;
    filePaymentEntries(file).forEach((entry, paymentOrderIndex) => {
      const { order, orderIndex, stageIndex, advancePayment } = entry;
      if (isYes(order.soCancelled) || hasFilledString(order.paymentDate)) return;
      const rowKey = getCashOutGoPlanRowKey(file, order, paymentOrderIndex);
      const assumption = assumptions.get(rowKey) ?? {};
      const amount = getPlanAmount(file, order);
      if (amount.capital === 0 && amount.revenue === 0) return;
      const focusContext = { orderIndex, stageIndex, advancePayment };

      const openReturn = getOpenBillReturn(order);
      if (openReturn) {
        const expectedSentDate =
          assumption.expectedSentDate ??
          addDays(openReturn.returnedDate, billSubmissionOffsetDays) ??
          "";
        handRows.push(
          makePlanDetailRow({
            rowKey,
            section: "hand",
            file,
            order,
            sourceFocusTarget: getCashOutGoPlanSourceFocusTarget("handReturn", focusContext),
            amount,
            amountSource: getPlanAmountSource(order),
            baseDate: openReturn.returnedDate ?? "",
            expectedSentDate,
            expectedSentDateOverride: assumption.expectedSentDate ?? "",
            actualSentDate: "",
            billOffsetDays: getEffectiveRowBillPaymentOffsetDays(settings, assumption),
            billOffsetOverride: getRowBillPaymentOffsetOverride(assumption),
            today,
          }),
        );
        return;
      }

      const activeSubmissionDate = getActiveBillSubmissionDate(order);
      if (hasFilledString(activeSubmissionDate)) {
        if (
          !includePreviousFySubmitted &&
          fyRange &&
          !isDateWithinRange(activeSubmissionDate, fyRange.start, fyRange.end)
        ) {
          return;
        }
        submittedRows.push(
          makePlanDetailRow({
            rowKey,
            section: "submitted",
            file,
            order,
            sourceFocusTarget: getCashOutGoPlanSourceFocusTarget("submitted", focusContext),
            amount,
            amountSource: getPlanAmountSource(order),
            baseDate: activeSubmissionDate ?? "",
            expectedSentDate: "",
            expectedSentDateOverride: "",
            actualSentDate: activeSubmissionDate ?? "",
            billOffsetDays: getEffectiveRowBillPaymentOffsetDays(settings, assumption),
            billOffsetOverride: getRowBillPaymentOffsetOverride(assumption),
            today,
          }),
        );
        return;
      }

      if (hasFilledString(order.billPreparationDate)) {
        const expectedSentDate =
          assumption.expectedSentDate ??
          addDays(order.billPreparationDate, billSubmissionOffsetDays) ??
          "";
        handRows.push(
          makePlanDetailRow({
            rowKey,
            section: "hand",
            file,
            order,
            sourceFocusTarget: getCashOutGoPlanSourceFocusTarget("handPrepared", focusContext),
            amount,
            amountSource: getPlanAmountSource(order),
            baseDate: order.billPreparationDate ?? "",
            expectedSentDate,
            expectedSentDateOverride: assumption.expectedSentDate ?? "",
            actualSentDate: "",
            billOffsetDays: getEffectiveRowBillPaymentOffsetDays(settings, assumption),
            billOffsetOverride: getRowBillPaymentOffsetOverride(assumption),
            today,
          }),
        );
        return;
      }

      const deliveryBaseDate = getDeliveredPendingBillDate(file, order);
      if (hasFilledString(deliveryBaseDate)) {
        const expectedSentDate =
          assumption.expectedSentDate ?? addDays(deliveryBaseDate, dpOffsetDays) ?? "";
        deliveredRows.push(
          makePlanDetailRow({
            rowKey,
            section: "delivered",
            file,
            order,
            sourceFocusTarget: getCashOutGoPlanSourceFocusTarget("delivered", focusContext),
            amount,
            amountSource: getPlanAmountSource(order),
            baseDate: deliveryBaseDate ?? "",
            expectedSentDate,
            expectedSentDateOverride: assumption.expectedSentDate ?? "",
            actualSentDate: "",
            billOffsetDays: getEffectiveRowBillPaymentOffsetDays(settings, assumption),
            billOffsetOverride: getRowBillPaymentOffsetOverride(assumption),
            today,
          }),
        );
        return;
      }

      if (!isYes(order.shortclosure)) {
        const dpBaseDate = getDeliveryPeriodDate(order);
        if (hasFilledString(dpBaseDate)) {
          const baseDate = String(dpBaseDate);
          if (fyRange && baseDate > fyRange.end) return;
          const dpExpired = baseDate < today;
          const expectedSentDate = dpExpired
            ? ""
            : (assumption.expectedSentDate ?? addDays(baseDate, dpOffsetDays + 1) ?? "");
          const targetRows = dpExpired ? dpExpiredRows : dpRows;
          targetRows.push(
            makePlanDetailRow({
              rowKey,
              section: dpExpired ? "dpExpired" : "dp",
              file,
              order,
              sourceFocusTarget: getCashOutGoPlanSourceFocusTarget(
                dpExpired ? "dpExpired" : "dp",
                focusContext,
              ),
              amount,
              amountSource: getPlanAmountSource(order),
              baseDate,
              expectedSentDate,
              expectedSentDateOverride: assumption.expectedSentDate ?? "",
              actualSentDate: "",
              manualExpectedPaymentDate: dpExpired ? (assumption.expectedPaymentDate ?? "") : "",
              billOffsetDays: getEffectiveRowBillPaymentOffsetDays(settings, assumption),
              billOffsetOverride: getRowBillPaymentOffsetOverride(assumption),
              zeroAmountAfterDate: !dpExpired ? fyRange?.end : undefined,
              today,
            }),
          );
        }
      }
    });

    rawSupplyOrders(file).forEach((order, orderIndex) => {
      if (isYes(order.soCancelled)) return;
      getSupplementaryBills(order).forEach((bill, billIndex) => {
        if (hasFilledString(bill.paymentDate)) return;
        const amount = getSupplementaryBillPlanAmount(file, bill);
        if (amount.capital === 0 && amount.revenue === 0) return;
        const rowKey = getSupplementaryBillCashOutGoPlanRowKey(
          file,
          order,
          orderIndex,
          bill,
          billIndex,
        );
        const assumption = assumptions.get(rowKey) ?? {};
        const openReturn = getOpenSupplementaryBillReturn(bill);
        if (openReturn) {
          const expectedSentDate =
            assumption.expectedSentDate ??
            addDays(openReturn.returnedDate, billSubmissionOffsetDays) ??
            "";
          handRows.push(
            makePlanDetailRow({
              rowKey,
              section: "hand",
              file,
              order,
              sourceFocusTarget: getSupplementaryBillCashOutGoPlanSourceFocusTarget(
                "returned",
                orderIndex,
                billIndex,
              ),
              amount,
              amountSource: "Supplementary bill amount",
              baseDate: openReturn.returnedDate ?? "",
              expectedSentDate,
              expectedSentDateOverride: assumption.expectedSentDate ?? "",
              actualSentDate: "",
              billOffsetDays: getEffectiveRowBillPaymentOffsetDays(settings, assumption),
              billOffsetOverride: getRowBillPaymentOffsetOverride(assumption),
              today,
            }),
          );
          return;
        }

        const activeSubmissionDate = getActiveSupplementaryBillSubmissionDate(bill);
        if (!hasFilledString(activeSubmissionDate)) return;
        const submittedDate = activeSubmissionDate ?? "";
        if (
          !includePreviousFySubmitted &&
          fyRange &&
          !isDateWithinRange(submittedDate, fyRange.start, fyRange.end)
        ) {
          return;
        }
        submittedRows.push(
          makePlanDetailRow({
            rowKey,
            section: "submitted",
            file,
            order,
            sourceFocusTarget: getSupplementaryBillCashOutGoPlanSourceFocusTarget(
              hasCompletedSupplementaryBillReturn(bill) ? "resubmitted" : "submitted",
              orderIndex,
              billIndex,
            ),
            amount,
            amountSource: "Supplementary bill amount",
            baseDate: submittedDate,
            expectedSentDate: "",
            expectedSentDateOverride: "",
            actualSentDate: submittedDate,
            billOffsetDays: getEffectiveRowBillPaymentOffsetDays(settings, assumption),
            billOffsetOverride: getRowBillPaymentOffsetOverride(assumption),
            today,
          }),
        );
      });
    });
  });

  return {
    financialYear,
    today,
    settings,
    allocation,
    expenditureTillDate,
    billsSubmitted: submittedRows,
    billsAtHand: handRows,
    deliveredBillsPending: deliveredRows,
    dpBasedForecast: dpRows,
    dpExpired: dpExpiredRows,
    monthwisePlan: buildMonthwiseCashOutGoPlan(
      fyMonths,
      merRows,
      currentMonthKey,
      [...submittedRows, ...handRows, ...deliveredRows, ...dpRows, ...dpExpiredRows],
      files,
    ),
  };
}

function buildExpenditureTillDateRows(
  files: FileRecord[],
  merRows: ReturnType<typeof mapMerCashOutgoRow>[],
  financialYear: string,
  currentMonthKey: string,
) {
  const actualPaymentsByMonth = getActualPaymentsByMonth(files);
  const rows = getFinancialYearMonthKeys(financialYear)
    .filter((monthKey) => monthKey < currentMonthKey)
    .map((monthKey) => {
      const mer = merRows.find((row) => row.monthKey === monthKey);
      const actual = actualPaymentsByMonth.get(monthKey) ?? { capital: 0, revenue: 0 };
      const hasMerValue = Boolean((mer?.capital ?? 0) || (mer?.revenue ?? 0));
      return makeCashOutgoRow(
        monthKey,
        hasMerValue ? (mer?.capital ?? 0) : actual.capital,
        hasMerValue ? (mer?.revenue ?? 0) : actual.revenue,
      );
    });
  const currentActual = actualPaymentsByMonth.get(currentMonthKey) ?? { capital: 0, revenue: 0 };
  rows.push(makeCashOutgoRow(currentMonthKey, currentActual.capital, currentActual.revenue));
  return rows;
}

function buildMonthwiseCashOutGoPlan(
  fyMonths: string[],
  merRows: ReturnType<typeof mapMerCashOutgoRow>[],
  currentMonthKey: string,
  forecastRows: CashOutGoPlanDetailRow[],
  files: FileRecord[],
) {
  const actualPaymentsByMonth = getActualPaymentsByMonth(files);
  return fyMonths.map((monthKey) => {
    if (monthKey < currentMonthKey) {
      const mer = merRows.find((row) => row.monthKey === monthKey);
      const actual = actualPaymentsByMonth.get(monthKey) ?? { capital: 0, revenue: 0 };
      const hasMerValue = Boolean((mer?.capital ?? 0) || (mer?.revenue ?? 0));
      return makeCashOutgoRow(
        monthKey,
        hasMerValue ? (mer?.capital ?? 0) : actual.capital,
        hasMerValue ? (mer?.revenue ?? 0) : actual.revenue,
      );
    }
    const forecast = forecastRows
      .filter((row) => row.expectedPaymentDate.slice(0, 7) === monthKey)
      .reduce(
        (sum, row) => ({
          capital: sum.capital + row.capital,
          revenue: sum.revenue + row.revenue,
        }),
        { capital: 0, revenue: 0 },
      );
    const actual = actualPaymentsByMonth.get(monthKey) ?? { capital: 0, revenue: 0 };
    const capital = forecast.capital + (monthKey === currentMonthKey ? actual.capital : 0);
    const revenue = forecast.revenue + (monthKey === currentMonthKey ? actual.revenue : 0);
    return makeCashOutgoRow(monthKey, capital, revenue);
  });
}

function getActualPaymentsByMonth(files: FileRecord[]) {
  const actualPaymentsByMonth = new Map<string, { capital: number; revenue: number }>();
  const addAmount = (
    paymentDate: string | undefined,
    amount: { capital: number; revenue: number },
  ) => {
    const normalizedPaymentDate = typeof paymentDate === "string" ? paymentDate.trim() : "";
    if (!normalizedPaymentDate) return;
    const monthKey = normalizedPaymentDate.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return;
    const existing = actualPaymentsByMonth.get(monthKey) ?? { capital: 0, revenue: 0 };
    existing.capital += amount.capital;
    existing.revenue += amount.revenue;
    actualPaymentsByMonth.set(monthKey, existing);
  };

  files.forEach((file) => {
    filePaymentOrders(file).forEach((order) => {
      if (isYes(order.soCancelled) || !hasFilledString(order.paymentDate)) return;
      addAmount(order.paymentDate, getActualAmount(file, order));
    });

    rawSupplyOrders(file).forEach((order) => {
      if (isYes(order.soCancelled)) return;
      getSupplementaryBills(order).forEach((bill) => {
        addAmount(bill.paymentDate, getSupplementaryBillActualAmount(file, bill));
      });
    });
  });

  return actualPaymentsByMonth;
}

function makePlanDetailRow({
  rowKey,
  section,
  file,
  order,
  sourceFocusTarget,
  amount,
  amountSource,
  baseDate,
  expectedSentDate,
  expectedSentDateOverride,
  actualSentDate,
  manualExpectedPaymentDate = "",
  billOffsetDays,
  billOffsetOverride,
  zeroAmountAfterDate,
  today,
}: {
  rowKey: string;
  section: CashOutGoPlanDetailRow["section"];
  file: FileRecord;
  order: SupplyOrderDetail;
  sourceFocusTarget: string;
  amount: { capital: number; revenue: number };
  amountSource: string;
  baseDate: string;
  expectedSentDate: string;
  expectedSentDateOverride: string;
  actualSentDate: string;
  manualExpectedPaymentDate?: string;
  billOffsetDays: number;
  billOffsetOverride: string;
  zeroAmountAfterDate?: string;
  today: string;
}): CashOutGoPlanDetailRow {
  const sentDateForPayment = actualSentDate || expectedSentDate;
  const expectedPaymentDate =
    manualExpectedPaymentDate || addDays(sentDateForPayment, billOffsetDays) || "";
  const amountCountsInPlan = !zeroAmountAfterDate || !expectedPaymentDate || expectedPaymentDate <= zeroAmountAfterDate;
  const capital = amountCountsInPlan ? amount.capital : 0;
  const revenue = amountCountsInPlan ? amount.revenue : 0;
  return {
    rowKey,
    section,
    fileId: file.id ?? "",
    fileRef: file.fileNo || file.uniqueCode || file.title || file.id || "",
    sourceFocusTarget,
    description: file.demandDescription || file.title || "",
    firm: order.firm || "",
    amountSource,
    baseDate,
    expectedSentDate,
    expectedSentDateOverride,
    actualSentDate,
    manualExpectedPaymentDate,
    billOffsetDays,
    billOffsetOverride,
    expectedPaymentDate,
    capital: Math.round(capital),
    revenue: Math.round(revenue),
    total: Math.round(capital + revenue),
    overdue: Boolean(expectedSentDate && expectedSentDate < today && !actualSentDate),
  };
}

function getCashOutGoPlanSourceFocusTarget(
  source: "submitted" | "handReturn" | "handPrepared" | "delivered" | "dp" | "dpExpired",
  context: { orderIndex: number; stageIndex?: number; advancePayment?: boolean },
) {
  const suffix = getCashOutGoPlanFocusIndexSuffix(context);
  if (context.advancePayment) return `advancepayment:pending:${context.orderIndex}`;
  if (source === "submitted") return `billsentforpayment:completed${suffix}`;
  if (source === "handReturn") return `billreturnedforcorrection:pending${suffix}`;
  if (source === "handPrepared") return `billpreparation:completed${suffix}`;
  if (source === "delivered") return `billpreparation:pending${suffix}`;
  return `deliveryperiod:${source === "dpExpired" ? "expired" : "any"}${suffix}`;
}

function getCashOutGoPlanFocusIndexSuffix(context: { orderIndex: number; stageIndex?: number }) {
  return `:${context.orderIndex}${
    context.stageIndex === undefined ? "" : `:${context.stageIndex}`
  }`;
}

function getCashOutGoPlanRowKey(file: FileRecord, order: SupplyOrderDetail, orderIndex: number) {
  const label = order.stageDeliveryLabel || "SO";
  const soRef = order.soNo || order.gemSoNo || String(orderIndex + 1);
  return [file.id ?? "", soRef, label, orderIndex].join(":");
}

function getSupplementaryBillCashOutGoPlanRowKey(
  file: FileRecord,
  order: SupplyOrderDetail,
  orderIndex: number,
  bill: SupplementaryBillDetail,
  billIndex: number,
) {
  const soRef = order.soNo || order.gemSoNo || String(orderIndex + 1);
  const billRef = bill.id || bill.billNo || String(billIndex + 1);
  return [file.id ?? "", soRef, "supplementary", billRef, orderIndex, billIndex].join(":");
}

function getSupplementaryBillCashOutGoPlanSourceFocusTarget(
  state: "submitted" | "returned" | "resubmitted",
  orderIndex: number,
  billIndex: number,
) {
  return `supplementarybill:${state}:${orderIndex}:${billIndex}`;
}

function getPlanAmount(file: FileRecord, order: SupplyOrderDetail) {
  const isStageOrAdvance = hasFilledString(order.stageDeliveryLabel);
  const capitalSource =
    isStageOrAdvance || !hasFilledString(order.billAmountCapital)
      ? order.soValueCapital
      : order.billAmountCapital;
  const revenueSource =
    isStageOrAdvance || !hasFilledString(order.billAmountRevenue)
      ? order.soValueRevenue
      : order.billAmountRevenue;
  return {
    capital: getInrAmountForPlan(capitalSource, file),
    revenue: getInrAmountForPlan(revenueSource, file),
  };
}

function getSupplementaryBillPlanAmount(file: FileRecord, bill: SupplementaryBillDetail) {
  return {
    capital: getInrAmountForPlan(bill.billAmountCapital, file),
    revenue: getInrAmountForPlan(bill.billAmountRevenue, file),
  };
}

function getActualAmount(file: FileRecord, order: SupplyOrderDetail) {
  return {
    capital: getInrAmountForPlan(order.actualPaymentCapital, file),
    revenue: getInrAmountForPlan(order.actualPaymentRevenue, file),
  };
}

function getSupplementaryBillActualAmount(file: FileRecord, bill: SupplementaryBillDetail) {
  return {
    capital: getInrAmountForPlan(bill.actualPaymentCapital || bill.billAmountCapital, file),
    revenue: getInrAmountForPlan(bill.actualPaymentRevenue || bill.billAmountRevenue, file),
  };
}

function getSupplementaryBills(order: SupplyOrderDetail) {
  return (order.supplementaryBills ?? []).filter(
    (bill): bill is SupplementaryBillDetail => Boolean(bill) && typeof bill === "object",
  );
}

function getOpenSupplementaryBillReturn(bill: SupplementaryBillDetail) {
  return normalizeBillReturnCycles(bill.billReturnCycles).find(
    (cycle) => hasFilledString(cycle.returnedDate) && !hasFilledString(cycle.resubmittedDate),
  );
}

function getActiveSupplementaryBillSubmissionDate(bill: SupplementaryBillDetail) {
  const latestResubmissionDate = normalizeBillReturnCycles(bill.billReturnCycles)
    .map((cycle) => cycle.resubmittedDate)
    .filter(hasFilledString)
    .sort()
    .at(-1);
  return latestResubmissionDate || bill.billSentForPaymentDate;
}

function hasCompletedSupplementaryBillReturn(bill: SupplementaryBillDetail) {
  const cycles = normalizeBillReturnCycles(bill.billReturnCycles);
  return (
    cycles.some(
      (cycle) => hasFilledString(cycle.returnedDate) && hasFilledString(cycle.resubmittedDate),
    ) &&
    !cycles.some(
      (cycle) => hasFilledString(cycle.returnedDate) && !hasFilledString(cycle.resubmittedDate),
    )
  );
}

function getPlanAmountSource(order: SupplyOrderDetail) {
  if (order.stageDeliveryLabel === "Advance Payment") return "Advance amount";
  if (hasFilledString(order.stageDeliveryLabel)) return "Stage amount";
  if (hasFilledString(order.billAmountCapital) || hasFilledString(order.billAmountRevenue)) {
    return "Bill amount";
  }
  return "S.O. value";
}

function getOpenBillReturn(order: SupplyOrderDetail) {
  return (order.billReturnCycles ?? []).find(
    (cycle) => hasFilledString(cycle.returnedDate) && !hasFilledString(cycle.resubmittedDate),
  );
}

function getActiveBillSubmissionDate(order: SupplyOrderDetail) {
  const latestResubmissionDate = (order.billReturnCycles ?? [])
    .map((cycle) => cycle.resubmittedDate)
    .filter(hasFilledString)
    .sort()
    .at(-1);
  return latestResubmissionDate ?? order.billSentForPaymentDate;
}

function getDeliveredPendingBillDate(file: FileRecord, order: SupplyOrderDetail) {
  if (hasFilledString(order.billPreparationDate) || hasFilledString(order.paymentDate))
    return undefined;
  if (isDeliveryInspectionApplicable(file)) return order.materialReceiptDate;
  return getNonInspectionPaymentDueDate(file, order);
}

function getNonInspectionPaymentDueDate(file: FileRecord, order: SupplyOrderDetail) {
  if (!isContractFileType(file) && isNo(file.ir)) return order.jobCompletionDate;
  return addDays(getDeliveryPeriodDate(order), 1);
}

function getDeliveryPeriodDate(order: SupplyOrderDetail) {
  return order.revisedDp || order.dpDate;
}

function isDeliveryInspectionApplicable(file: FileRecord) {
  return isDeliveryInspectionApplicableByGroup(file);
}

function makeCashOutgoRow(monthKey: string, capital: number, revenue: number): CashOutgoRow {
  return {
    monthKey,
    month: formatMonthLabel(`${monthKey}-01`),
    capital: Math.round(capital),
    revenue: Math.round(revenue),
    total: Math.round(capital + revenue),
  };
}

function combineCashOutgoRows(...rowGroups: CashOutgoRow[][]): CashOutgoRow[] {
  const totals = new Map<string, { capital: number; revenue: number }>();
  rowGroups.flat().forEach((row) => {
    const current = totals.get(row.monthKey) ?? { capital: 0, revenue: 0 };
    current.capital += row.capital;
    current.revenue += row.revenue;
    totals.set(row.monthKey, current);
  });
  return Array.from(totals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, totals]) => makeCashOutgoRow(monthKey, totals.capital, totals.revenue));
}

function getFinancialYearMonthKeys(financialYear: string) {
  const range = getFinancialYearDateRange(financialYear);
  if (!range) return [];
  const [startYearText] = range.start.split("-");
  const startYear = Number(startYearText);
  return [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map((month) => {
    const year = month >= 4 ? startYear : startYear + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

function formatMonthLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleString("en-IN", { month: "short", year: "numeric" });
}

function addDays(date: string | undefined, days: number) {
  if (!date) return undefined;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  parsed.setDate(parsed.getDate() + days);
  return formatDate(parsed);
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function isDateWithinRange(date: string | undefined, start: string, end: string) {
  return Boolean(date && date >= start && date <= end);
}

function hasFilledString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function getInrAmountForPlan(value: string | number | undefined, file: FileRecord) {
  const amount = parseMoneyAmount(value);
  if (amount === undefined) return 0;
  const currency = (file.currency ?? "INR").trim().toLowerCase();
  if (!currency || currency === "inr" || currency === "rs" || currency === "rupee") return amount;
  const exchangeRate = parseMoneyAmount(file.exchangeRate);
  return exchangeRate === undefined ? amount : amount * exchangeRate;
}

function parseMoneyAmount(value: string | number | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

const allFilesYear = "__all_files__";
const allActiveFilesYear = "__all_active_files__";
const activePlusCurrentFyClosedYear = "__active_plus_current_fy_closed__";
const fileClosedMilestone = "File Closed";

function isFileActiveInYear(file: { year?: string; activeYears?: string[] }, year: string) {
  return file.year === year || file.activeYears?.includes(year);
}

function isFileClosed(file: { completedMilestones?: string[] }) {
  return Boolean(
    file.completedMilestones?.some(
      (milestone) =>
        milestone
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "") === "fileclosed",
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
  if (selectedYear === allFilesYear) return true;
  if (selectedYear === allActiveFilesYear) return !isInactiveFile(file);
  if (selectedYear === activePlusCurrentFyClosedYear) {
    return (
      !isInactiveFile(file) || isDateInFinancialYear(file.fileClosureDate, currentFinancialYear)
    );
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
      and lower(coalesce(f.demand_cancelled, '')) <> 'yes'
      and not (${supplyOrderRowExists()} and not exists (
        select 1 from supply_orders so_active
        where so_active.file_id = f.id
          and not ${isYesExpression("so_active.so_cancelled")}
      )))`;
}

function getSelectedYearCondition(
  selectedYear: string | undefined,
  values: unknown[],
  currentFinancialYear?: string,
) {
  if (!selectedYear) return undefined;
  if (selectedYear === allFilesYear) return undefined;
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
  fileYear,
  fileInitiationFrom,
  fileInitiationTo,
  currentFinancialYear,
  division,
  fileCategories,
}: {
  scopeSql: string;
  scopeValues: unknown[];
  selectedYear: string | undefined;
  fileYear?: string | undefined;
  fileInitiationFrom?: string | undefined;
  fileInitiationTo?: string | undefined;
  currentFinancialYear?: string;
  division: string;
  fileCategories?: FileCategoryKey[];
}) {
  const values = [...scopeValues];
  const conditions: string[] = [];
  if (scopeSql) conditions.push(scopeSql);
  const selectedYearCondition = getSelectedYearCondition(
    selectedYear,
    values,
    currentFinancialYear,
  );
  if (selectedYearCondition) conditions.push(selectedYearCondition);
  if (fileYear?.trim() && fileYear.trim() !== "all") {
    const placeholder = addValue(values, fileYear.trim());
    conditions.push(`f.year = ${placeholder}::text`);
  }
  if (fileInitiationFrom) {
    const placeholder = addValue(values, fileInitiationFrom);
    conditions.push(`f.received_date >= ${placeholder}::date`);
  }
  if (fileInitiationTo) {
    const placeholder = addValue(values, fileInitiationTo);
    conditions.push(`f.received_date <= ${placeholder}::date`);
  }
  if (division !== "all") {
    const placeholder = addValue(values, division.toLowerCase());
    conditions.push(`lower(coalesce(d.name, '')) = ${placeholder}::text`);
  }
  if (fileCategories) {
    conditions.push(getFileCategoryCondition(fileCategories));
  }
  return {
    whereSql: conditions.length ? `where ${conditions.join(" and ")}` : "",
    values,
  };
}

function getFileCategoryCondition(categories: FileCategoryKey[]) {
  return getFileCategorySqlCondition(categories);
}

function readOptionalFileCategories(value: unknown) {
  const rawFileCategories = readList(value);
  if (!rawFileCategories?.length) return undefined;
  return normalizeFileCategories(rawFileCategories);
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

function isNo(value: string | undefined) {
  return (value ?? "").trim().toLowerCase() === "no";
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
    or lower(trim(coalesce(${alias}.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m'))`;
}

function isCancelledExpression() {
  return `(${isYesExpression("f.demand_cancelled")}
    or (${supplyOrderRowExists()} and not exists (
      select 1 from supply_orders so_active
      where so_active.file_id = f.id
        and not ${isYesExpression("so_active.so_cancelled")}
    )))`;
}

function workflowNotStartedExpression() {
  const dateFields = [
    "scrutiny_date",
    "scrutiny_response_date",
    "scrutiny_completion_date",
    "imms_date",
    "high_value_meeting_date",
    "high_value_minutes_date",
    "ad_sent_date",
    "pre_tcec_date",
    "pre_tcec_minutes_date",
    "ad_vetting_date",
    "rqa_sent_date",
    "rqa_approval_date",
    "ifa_sent_date",
    "ifa_final_date",
    "cfa_sent_date",
    "cfa_date",
    "gem_undertaking_date",
    "rfp_vetting_initiation_date",
    "rfp_vetting_approval_date",
    "pre_bid_meeting_date",
    "bid_date",
    "bid_opening_date",
    "refloat_pre_bid_meeting_date",
    "refloat_bidding_date",
    "refloat_bid_opening_date",
    "post_tcec_date",
    "post_tcec_minutes_date",
    "refloat_post_tcec_date",
    "refloat_post_tcec_minutes_date",
    "cnc_date",
    "cnc_approval_date",
  ];
  const noFileDates = dateFields
    .map((column) => `not ${hasFilledExpression(`f.${column}`)}`)
    .join(" and ");
  return `not ${isCancelledExpression()}
    and not ${hasFilledExpression("f.current_milestone")}
    and not exists (select 1 from file_completed_milestones completed where completed.file_id = f.id)
    and ${noFileDates}
    and not exists (
      select 1
      from supply_orders so_workflow
      where so_workflow.file_id = f.id
        and (
          ${hasFilledExpression("so_workflow.financial_sanction_date")}
          or ${hasFilledExpression("so_workflow.so_date")}
          or ${hasFilledExpression("so_workflow.dp_date")}
          or ${hasFilledExpression("so_workflow.material_receipt_date")}
          or ${hasFilledExpression("so_workflow.job_completion_date")}
          or ${hasFilledExpression("so_workflow.ir_preparation_date")}
          or ${hasFilledExpression("so_workflow.ir_receipt_date")}
          or ${hasFilledExpression("so_workflow.bill_preparation_date")}
          or ${hasFilledExpression("so_workflow.bill_sent_for_payment_date")}
          or ${hasFilledExpression("so_workflow.payment_date")}
        )
    )`;
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
  if (normalizeMilestoneName(normalizedMilestone) === "financialsanction") {
    return hasFilledExpression(`${orderAlias}.financial_sanction_date`);
  }
  if (normalizeMilestoneName(normalizedMilestone) === "jobcompletion") {
    return hasFilledExpression(`${orderAlias}.job_completion_date`);
  }
  return `exists (
    select 1
    from jsonb_array_elements_text(coalesce(${orderAlias}.completed_milestones, '[]'::jsonb)) as completed_order(milestone)
    where ${normalizeMilestoneExpression("completed_order.milestone")} = '${normalizedMilestone}'
  )`;
}

function completedStageMilestoneExpression(stageAlias: string, normalizedMilestone: string) {
  if (normalizeMilestoneName(normalizedMilestone) === "jobcompletion") {
    return `${jsonDateExpression(`${stageAlias}.stage`, "jobCompletionDate")} is not null`;
  }
  return `exists (
    select 1
    from jsonb_array_elements_text(coalesce(${stageAlias}.stage -> 'completedMilestones', '[]'::jsonb)) as completed_stage(milestone)
    where ${normalizeMilestoneExpression("completed_stage.milestone")} = '${normalizedMilestone}'
  )`;
}

function financialSanctionCompleteExpression() {
  return `not ${isCancelledExpression()} and ${supplyOrderExists(
    `not ${isYesExpression("so.so_cancelled")}
       and ${hasFilledExpression("so.financial_sanction_date")}`,
  )}`;
}

function biddingApplicableExpression() {
  return `upper(trim(coalesce(f.mode, ''))) <> 'LPC'
    and lower(trim(coalesce(f.file_type, ''))) not in ('cars', 'capsi')
    and not (${isYesExpression("f.gem")} and lower(trim(coalesce(f.gem_bidding_mode, ''))) = 'comparison')`;
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
  if (milestone.key === "bidding") return biddingApplicableExpression();
  if (milestone.key === "refloatPostTcec")
    return `${isYesExpression("f.refloat")} and ${isYesExpression("f.tcec")} and ${isYesExpression("f.bidding_stage_over")}`;
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
  if (milestone.key === "refloatBidding") {
    return `not ${isCancelledExpression()} and ${isYesExpression("f.refloat")} and not ${isYesExpression("f.bidding_stage_over")}`;
  }
  if (milestone.key === "refloatPostTcec") {
    return `not ${isCancelledExpression()}
      and ${isYesExpression("f.refloat")}
      and ${isYesExpression("f.tcec")}
      and ${isYesExpression("f.bidding_stage_over")}
      and not ${hasFilledExpression("f.refloat_post_tcec_minutes_date")}`;
  }
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
          and ${hasFilledExpression("so.financial_sanction_date")}
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
  const milestone = reportMilestoneDefinitions[index];
  if (!milestone || index <= 0) return hasFilledExpression("f.received_date");
  if (isFlexiblePreControlReportMilestone(milestone)) {
    const scrutiny = reportMilestoneDefinitions.find((item) => item.key === "scrutiny");
    return scrutiny ? reportCompleteExpression(scrutiny) : hasFilledExpression("f.received_date");
  }
  const controlIndex = reportMilestoneDefinitions.findIndex((item) => item.key === "control");
  if (controlIndex >= 0 && index >= controlIndex) {
    return allApplicableReportMilestonesCompleteExpression(
      reportMilestoneDefinitions.slice(0, index),
    );
  }
  const scrutiny = reportMilestoneDefinitions.find((item) => item.key === "scrutiny");
  return scrutiny ? reportCompleteExpression(scrutiny) : hasFilledExpression("f.received_date");
}

function isFlexiblePreControlReportMilestone(
  milestone: Pick<(typeof reportMilestoneDefinitions)[number], "key">,
) {
  return ["highValue", "tcec", "ad", "rqa"].includes(milestone.key);
}

function allApplicableReportMilestonesCompleteExpression(
  milestones: Array<(typeof reportMilestoneDefinitions)[number]>,
) {
  const checks = milestones.map(
    (milestone) =>
      `(not (${reportAppliesExpression(milestone)}) or (${reportCompleteExpression(milestone)}))`,
  );
  return checks.length ? checks.join(" and ") : hasFilledExpression("f.received_date");
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
          then coalesce(stage_row.stage -> 'billReturnCycles', '[]'::jsonb)
        when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = ${stageCount}
          then coalesce(so.bill_return_cycles, '[]'::jsonb)
        when stage_row.stage is not null then '[]'::jsonb
        else coalesce(so.bill_return_cycles, '[]'::jsonb)
      end as bill_return_cycles,
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
    ${hasFilledExpression(`${alias}.bill_preparation_date`)}
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

function paymentRowReturnedBillExpression(alias = "payment_row") {
  return `exists (
    select 1
    from jsonb_array_elements(coalesce(${alias}.bill_return_cycles, '[]'::jsonb)) as bill_return(cycle)
    where ${hasFilledExpression("bill_return.cycle ->> 'returnedDate'")}
  )`;
}

function paymentRowOpenReturnedBillExpression(alias = "payment_row") {
  return `exists (
    select 1
    from jsonb_array_elements(coalesce(${alias}.bill_return_cycles, '[]'::jsonb)) as bill_return(cycle)
    where ${hasFilledExpression("bill_return.cycle ->> 'returnedDate'")}
      and not ${hasFilledExpression("bill_return.cycle ->> 'resubmittedDate'")}
  )`;
}

function paymentRowResubmittedReturnedBillExpression(alias = "payment_row") {
  return `exists (
    select 1
    from jsonb_array_elements(coalesce(${alias}.bill_return_cycles, '[]'::jsonb)) as bill_return(cycle)
    where ${hasFilledExpression("bill_return.cycle ->> 'returnedDate'")}
      and ${hasFilledExpression("bill_return.cycle ->> 'resubmittedDate'")}
  )`;
}

function financialSanctionPreviousStageExpression() {
  return `not ${isCancelledExpression()}
    and not (${financialSanctionCompleteExpression()})
    and not (${financialSanctionPendingExpression()})
    and (
      (not ${isYesExpression("f.tcec")}
        and (
          (${biddingApplicableExpression()}
            and ${normalizeMilestoneExpression("f.current_milestone")} = 'bidding'
            and not ${isYesExpression("f.bidding_stage_over")})
          or (not ${biddingApplicableExpression()}
            and ${normalizeMilestoneExpression("f.current_milestone")} = 'cfa'
            and not ${hasFilledExpression("f.cfa_date")})
        ))
      or (${isYesExpression("f.tcec")}
        and ${normalizeMilestoneExpression("f.current_milestone")} = 'cnc'
        and not ${hasFilledExpression("f.cnc_approval_date")})
    )`;
}

function financialSanctionReachedExpression() {
  return `not ${isCancelledExpression()}
    and ((${biddingApplicableExpression()} and ${isYesExpression("f.bidding_stage_over")})
      or (not ${biddingApplicableExpression()} and ${hasFilledExpression("f.cfa_date")}))
    and (not ${isYesExpression("f.tcec")} or ${hasFilledExpression("f.cnc_approval_date")})`;
}

function financialSanctionPendingExpression() {
  return `${financialSanctionReachedExpression()} and not (${financialSanctionCompleteExpression()})`;
}

function earliestSupplyOrderDateExpression(column: string) {
  const fileFallbackColumns = new Set([
    "financial_sanction_date",
    "so_date",
    "dp_date",
    "revised_dp",
    "material_receipt_date",
    "ir_preparation_date",
    "ir_receipt_date",
    "bill_preparation_date",
    "bill_sent_for_payment_date",
    "payment_date",
    "so_cancelled_date",
  ]);
  const fileFallback = fileFallbackColumns.has(column)
    ? dateCastExpression(`f.${column}`)
    : "null::date";
  return `case
    when ${supplyOrderRowExists()} then (
      select min(${dateCastExpression(`so_date_value.${column}`)})
      from supply_orders so_date_value
      where so_date_value.file_id = f.id and so_date_value.${column} is not null
    )
    else ${fileFallback}
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
    "Total",
    "Total files",
    "Total cases",
    "Placed",
    "Received",
    "Reviewed",
    "Pending",
    "At Previous Stage",
    "At previous stage",
    "At previous stages",
    "To be returned",
    "Returned",
    "Returned paid",
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
    "Total",
    "Total files",
    "Total cases",
    "Placed",
    "Received",
    "Reviewed",
    "Pending",
    "At Previous Stage",
    "At previous stage",
    "At previous stages",
    "To be returned",
    "Returned",
    "Returned paid",
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
  if (columns.includes("Returned paid")) return "Payment";
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
      milestone.key === "refloatPostTcec"
        ? `${process} and not (${complete})`
        : "reviewedColumn" in milestone && milestone.reviewedColumn
          ? `${active} and not (${reviewed}) and not (${complete})`
          : `${active} and not (${complete})`;
    const previousStage =
      milestone.key === "refloatBidding"
        ? "false"
        : milestone.key === "refloatPostTcec"
          ? `${isYesExpression("f.refloat")} and not ${isYesExpression("f.bidding_stage_over")}`
          : `${process} and (${reached}) and not (${active}) and not (${reviewed}) and not (${complete})`;

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
          : hasFilledExpression("so.financial_sanction_date");
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
      addRow(milestone.label, "At previous stage", `${previousStage} and not (${received})`);
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
      selects.push(
        `select 'Returned Bills' as milestone,
                'Total' as stage,
                count(*)::integer as count
         from ${reportPaymentRowsSource(whereSql, [`not ${isCancelledExpression()}`])} payment_row
         where ${paymentRowReturnedBillExpression("payment_row")}`,
      );
      selects.push(
        `select 'Returned Bills' as milestone,
                'Pending' as stage,
                count(*)::integer as count
         from ${reportPaymentRowsSource(whereSql, [`not ${isCancelledExpression()}`])} payment_row
         where ${paymentRowOpenReturnedBillExpression("payment_row")}`,
      );
      selects.push(
        `select 'Returned Bills' as milestone,
                'Completed' as stage,
                count(*)::integer as count
         from ${reportPaymentRowsSource(whereSql, [`not ${isCancelledExpression()}`])} payment_row
         where ${paymentRowResubmittedReturnedBillExpression("payment_row")}`,
      );
      selects.push(
        `select 'Returned Bills' as milestone,
                'Returned paid' as stage,
                count(*)::integer as count
         from ${reportPaymentRowsSource(whereSql, [`not ${isCancelledExpression()}`])} payment_row
         where ${paymentRowResubmittedReturnedBillExpression("payment_row")}
           and not ${paymentRowOpenReturnedBillExpression("payment_row")}
           and ${hasFilledExpression("payment_row.payment_date")}`,
      );
      addRow(milestone.label, "At previous stage", previousStage);
      return;
    }
    if (milestone.key === "refloatBidding") {
      addRow(milestone.label, milestone.totalLabel ?? "Total", process);
      addRow(milestone.label, "In process", active);
      addRow(milestone.label, "Completed", `${process} and ${complete}`);
      return;
    }
    if (milestone.key === "refloatPostTcec") {
      addRow(milestone.label, milestone.totalLabel ?? "Total", process);
      addRow(milestone.label, "Completed", `${process} and ${complete}`);
      addRow(milestone.label, "At previous stage", previousStage);
      addRow(milestone.label, "In process", pending);
      addRow(milestone.label, "Reviewed", `${active} and ${reviewed} and not (${complete})`);
      addRow(milestone.label, "Pending", pending);
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

  selects.push(
    `select 'Returned Bills' as milestone,
            'Total' as stage,
            count(*)::integer as count
     from ${reportPaymentRowsSource(whereSql, [`not ${isCancelledExpression()}`])} payment_row
     where ${paymentRowReturnedBillExpression("payment_row")}`,
  );
  selects.push(
    `select 'Returned Bills' as milestone,
            'Pending' as stage,
            count(*)::integer as count
     from ${reportPaymentRowsSource(whereSql, [`not ${isCancelledExpression()}`])} payment_row
     where ${paymentRowOpenReturnedBillExpression("payment_row")}`,
  );
  selects.push(
    `select 'Returned Bills' as milestone,
            'Completed' as stage,
            count(*)::integer as count
     from ${reportPaymentRowsSource(whereSql, [`not ${isCancelledExpression()}`])} payment_row
     where ${paymentRowResubmittedReturnedBillExpression("payment_row")}`,
  );
  selects.push(
    `select 'Returned Bills' as milestone,
            'Returned paid' as stage,
            count(*)::integer as count
     from ${reportPaymentRowsSource(whereSql, [`not ${isCancelledExpression()}`])} payment_row
     where ${paymentRowResubmittedReturnedBillExpression("payment_row")}
       and not ${paymentRowOpenReturnedBillExpression("payment_row")}
       and ${hasFilledExpression("payment_row.payment_date")}`,
  );

  const stageJobCompletionDone = `exists (
    select 1
    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as job_stage(stage)
    where nullif(job_stage.stage ->> 'jobCompletionDate', '')::date is not null
  )`;
  const stageJobCompletionDue = `exists (
    select 1
    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as due_job_stage(stage)
    where nullif(due_job_stage.stage ->> 'jobCompletionDate', '')::date is null
    and coalesce(
      nullif(due_job_stage.stage ->> 'revisedDp', '')::date,
      nullif(due_job_stage.stage ->> 'dpDate', '')::date,
      so.revised_dp,
      so.dp_date
    ) < current_date
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
           and ${effectiveDpDateExpression("so")} is not null
           and ${effectiveDpDateExpression("so")} < current_date
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

  const deliveryPeriodStageRowsExist = `${isYesExpression("so.stage_delivery")}
    and jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb)) > 0`;
  const deliveryPeriodStageDpDate = `coalesce(
    nullif(delivery_period_stage.stage ->> 'revisedDp', '')::date,
    nullif(delivery_period_stage.stage ->> 'dpDate', '')::date
  )`;
  const deliveryPeriodStageStartDate = `coalesce(
    nullif(delivery_period_stage.stage ->> 'deliveryPeriodStartDate', '')::date,
    so.so_date
  )`;
  const deliveryPeriodStageIncomplete = `coalesce(delivery_period_stage.stage ->> 'materialReceiptDate', '') = ''`;
  const deliveryPeriodStageExists = (condition: string) => `exists (
    select 1
    from jsonb_array_elements(coalesce(so.stage_deliveries, '[]'::jsonb)) as delivery_period_stage(stage)
    where ${isYesExpression("so.stage_delivery")}
      and ${condition}
  )`;

  addRow(
    "Delivery Period",
    "Valid",
    `not ${isCancelledExpression()} and not ${nonDeliveryFileTypeExpression("f")} and ${supplyOrderChildExpression(
      `${hasFilledExpression("so.so_date")}
       and not ${isYesExpression("so.so_cancelled")}
       and not ${isYesExpression("so.shortclosure")}
       and (
         (
           not (${deliveryPeriodStageRowsExist})
           and so.so_date <= current_date
           and ${effectiveDpDateExpression("so")} is not null
           and ${effectiveDpDateExpression("so")} >= current_date
           and not ${hasFilledExpression("so.revised_dp")}
           and not ${hasFilledExpression("so.material_receipt_date")}
         )
         or ${deliveryPeriodStageExists(
           `${deliveryPeriodStageDpDate} is not null
            and ${deliveryPeriodStageStartDate} <= current_date
            and ${deliveryPeriodStageDpDate} >= current_date
            and coalesce(delivery_period_stage.stage ->> 'revisedDp', '') = ''
            and ${deliveryPeriodStageIncomplete}`,
         )}
       )`,
      `${hasFilledExpression("f.so_date")} and f.so_date <= current_date and ${effectiveDpDateExpression("f")} is not null and ${effectiveDpDateExpression("f")} >= current_date and not ${hasFilledExpression("f.revised_dp")} and not ${hasFilledExpression("f.material_receipt_date")}`,
    )}`,
  );
  addRow(
    "Delivery Period",
    "Expired",
    `not ${isCancelledExpression()} and not ${nonDeliveryFileTypeExpression("f")} and ${supplyOrderChildExpression(
      `${hasFilledExpression("so.so_date")}
       and not ${isYesExpression("so.so_cancelled")}
       and not ${isYesExpression("so.shortclosure")}
       and (
         (
           not (${deliveryPeriodStageRowsExist})
           and ${effectiveDpDateExpression("so")} is not null
           and ${effectiveDpDateExpression("so")} < current_date
           and not ${hasFilledExpression("so.revised_dp")}
           and not ${hasFilledExpression("so.material_receipt_date")}
         )
         or ${deliveryPeriodStageExists(
           `${deliveryPeriodStageDpDate} is not null
            and ${deliveryPeriodStageStartDate} <= current_date
            and ${deliveryPeriodStageDpDate} < current_date
            and coalesce(delivery_period_stage.stage ->> 'revisedDp', '') = ''
            and ${deliveryPeriodStageIncomplete}`,
         )}
       )`,
      `${hasFilledExpression("f.so_date")} and ${effectiveDpDateExpression("f")} is not null and ${effectiveDpDateExpression("f")} < current_date and not ${hasFilledExpression("f.material_receipt_date")}`,
    )}`,
  );
  addRow(
    "Delivery Period",
    "Extended",
    `not ${isCancelledExpression()} and not ${nonDeliveryFileTypeExpression("f")} and ${supplyOrderChildExpression(
      `${hasFilledExpression("so.so_date")}
       and not ${isYesExpression("so.so_cancelled")}
       and not ${isYesExpression("so.shortclosure")}
       and (
         (
           not (${deliveryPeriodStageRowsExist})
           and so.so_date <= current_date
           and ${hasFilledExpression("so.revised_dp")}
           and ${effectiveDpDateExpression("so")} is not null
           and ${effectiveDpDateExpression("so")} >= current_date
           and not ${hasFilledExpression("so.material_receipt_date")}
         )
         or ${deliveryPeriodStageExists(
           `coalesce(delivery_period_stage.stage ->> 'revisedDp', '') <> ''
            and ${deliveryPeriodStageStartDate} <= current_date
            and ${deliveryPeriodStageDpDate} is not null
            and ${deliveryPeriodStageDpDate} >= current_date
            and ${deliveryPeriodStageIncomplete}`,
         )}
       )`,
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
    | "actual"
    | "returnedBills"
    | "pendingReturnedBills"
    | "returnedBillsResubmitted"
    | "returnedBillsPaid",
  expectedCashOutgoDays = DEFAULT_DP_OFFSET_DAYS,
  dateRange?: { fromDate: string; toDate: string },
  asOfDate?: string,
): Promise<CashOutgoRow[]> {
  await ensureSupplyOrderBillReturnsSchema();
  const queryValues = [...values];
  const usesExpectedOffset =
    mode === "expectedDp" || mode === "expectedReceipt" || mode === "expectedReceiptPendingBill";
  const expectedDaysPlaceholder = usesExpectedOffset
    ? addValue(queryValues, expectedCashOutgoDays)
    : undefined;
  const nonDeliveryEffective = nonDeliveryFileTypeExpression("effective");
  const contractEffective = `lower(trim(coalesce(effective.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m')`;
  const goodsServicesIrNoEffective = `(not ${isYesExpression("effective.file_ir")} and not ${contractEffective})`;
  const receiptBaseDateExpression = `case
    when ${contractEffective} and coalesce(effective.revised_dp, effective.dp_date) is not null
    then (coalesce(effective.revised_dp, effective.dp_date) + interval '1 day')::date
    when ${goodsServicesIrNoEffective} and effective.job_completion_done
    then effective.job_completion_date
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
  const paymentWorkflowAppliesExpression = `(effective.advance_payment_yes or ${billPreparationBaseDateExpression} is not null)`;
  const returnedDateExpression = `(select min(nullif(cycle ->> 'returnedDate', '')::date)
    from jsonb_array_elements(coalesce(effective.bill_return_cycles, '[]'::jsonb)) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> '')`;
  const pendingReturnedDateExpression = `(select min(nullif(cycle ->> 'returnedDate', '')::date)
    from jsonb_array_elements(coalesce(effective.bill_return_cycles, '[]'::jsonb)) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
      and coalesce(cycle ->> 'resubmittedDate', '') = '')`;
  const resubmittedReturnedDateExpression = `(select min(nullif(cycle ->> 'resubmittedDate', '')::date)
    from jsonb_array_elements(coalesce(effective.bill_return_cycles, '[]'::jsonb)) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
      and coalesce(cycle ->> 'resubmittedDate', '') <> '')`;
  const hasOpenReturnedBillExpression = `exists (
    select 1
    from jsonb_array_elements(coalesce(effective.bill_return_cycles, '[]'::jsonb)) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
      and coalesce(cycle ->> 'resubmittedDate', '') = ''
  )`;
  const hasResubmittedReturnedBillExpression = `exists (
    select 1
    from jsonb_array_elements(coalesce(effective.bill_return_cycles, '[]'::jsonb)) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
      and coalesce(cycle ->> 'resubmittedDate', '') <> ''
  )`;
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
    if (mode === "returnedBills") return returnedDateExpression;
    if (mode === "pendingReturnedBills") return pendingReturnedDateExpression;
    if (mode === "returnedBillsResubmitted") return resubmittedReturnedDateExpression;
    if (mode === "returnedBillsPaid") return "effective.payment_date";
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
          and not effective.shortclosure_yes
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
        and not effective.shortclosure_yes
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
        return `${paymentWorkflowAppliesExpression}
          and not effective.so_cancelled_yes
	          and (effective.advance_payment_yes or ${billPreparationBaseDateExpression} <= ${asOfDatePlaceholder}::date)
          and effective.bill_preparation_date is not null
          and effective.bill_preparation_date <= ${asOfDatePlaceholder}::date
          and (
            effective.bill_sent_for_payment_date is null
            or effective.bill_sent_for_payment_date > ${asOfDatePlaceholder}::date
            or ${hasOpenReturnedBillExpression}
          )
          and (
	            effective.payment_date is null
	            or effective.payment_date > ${asOfDatePlaceholder}::date
          )`;
      }
      if (toDatePlaceholder) {
        return `${paymentWorkflowAppliesExpression}
          and not effective.so_cancelled_yes
	          and (effective.advance_payment_yes or ${billPreparationBaseDateExpression} <= ${toDatePlaceholder}::date)
          and effective.bill_preparation_date is not null
          and effective.bill_preparation_date <= ${toDatePlaceholder}::date
          and (
            effective.bill_sent_for_payment_date is null
            or effective.bill_sent_for_payment_date > ${toDatePlaceholder}::date
            or ${hasOpenReturnedBillExpression}
          )
          and (
	            effective.payment_date is null
	            or effective.payment_date > ${toDatePlaceholder}::date
          )`;
      }
      return `${paymentWorkflowAppliesExpression} and not effective.so_cancelled_yes and effective.bill_preparation_date is not null and (effective.bill_sent_for_payment_date is null or ${hasOpenReturnedBillExpression}) and effective.payment_date is null`;
    }
    if (mode === "billSent") {
      if (asOfDatePlaceholder) {
        return `${paymentWorkflowAppliesExpression}
          and not effective.so_cancelled_yes
	          and (effective.advance_payment_yes or ${billPreparationBaseDateExpression} <= ${asOfDatePlaceholder}::date)
          and effective.bill_preparation_date is not null
          and effective.bill_preparation_date <= ${asOfDatePlaceholder}::date
	          and effective.bill_sent_for_payment_date is not null
	          and effective.bill_sent_for_payment_date <= ${asOfDatePlaceholder}::date
	          and not ${hasOpenReturnedBillExpression}
	          and (
	            effective.payment_date is null
	            or effective.payment_date > ${asOfDatePlaceholder}::date
          )`;
      }
      if (toDatePlaceholder) {
        return `${paymentWorkflowAppliesExpression}
          and not effective.so_cancelled_yes
	          and (effective.advance_payment_yes or ${billPreparationBaseDateExpression} <= ${toDatePlaceholder}::date)
          and effective.bill_preparation_date is not null
          and effective.bill_preparation_date <= ${toDatePlaceholder}::date
	          and effective.bill_sent_for_payment_date is not null
	          and effective.bill_sent_for_payment_date <= ${toDatePlaceholder}::date
	          and not ${hasOpenReturnedBillExpression}
	          and (
	            effective.payment_date is null
	            or effective.payment_date > ${toDatePlaceholder}::date
          )`;
      }
      return `${paymentWorkflowAppliesExpression} and not effective.so_cancelled_yes and effective.bill_preparation_date is not null and effective.bill_sent_for_payment_date is not null and not ${hasOpenReturnedBillExpression} and effective.payment_date is null`;
    }
    if (mode === "returnedBills") {
      return `${returnedDateExpression} is not null and not effective.so_cancelled_yes`;
    }
    if (mode === "pendingReturnedBills") {
      return `${pendingReturnedDateExpression} is not null and not effective.so_cancelled_yes`;
    }
    if (mode === "returnedBillsResubmitted") {
      return `${resubmittedReturnedDateExpression} is not null
        and ${hasResubmittedReturnedBillExpression}
        and not ${hasOpenReturnedBillExpression}
        and not effective.so_cancelled_yes`;
    }
    if (mode === "returnedBillsPaid") {
      return `effective.payment_date is not null
        and ${hasResubmittedReturnedBillExpression}
        and not ${hasOpenReturnedBillExpression}
        and not effective.so_cancelled_yes`;
    }
    return "effective.payment_date is not null and not effective.so_cancelled_yes";
  })();
  const dateRangeCondition =
    fromDatePlaceholder && toDatePlaceholder
      ? ` and ${
          mode === "expectedReceiptPendingBill"
            ? receiptPendingBillBaseDateExpression
            : dateExpression
        } between ${fromDatePlaceholder}::date and ${toDatePlaceholder}::date`
      : "";
  const usesActualAmount = mode === "actual" || mode === "returnedBillsPaid";
  const plannedOrderCapitalExpression = `coalesce(${inrAmountExpression(
    "so.bill_amount_capital",
  )}, ${inrAmountExpression("so.so_value_capital")})`;
  const plannedOrderRevenueExpression = `coalesce(${inrAmountExpression(
    "so.bill_amount_revenue",
  )}, ${inrAmountExpression("so.so_value_revenue")})`;
  const effectiveCapitalExpression = usesActualAmount
    ? `case
           when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
             then ${inrAmountExpression("stage_row.stage ->> 'actualPaymentCapital'")}
           when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb))
             then ${inrAmountExpression("so.actual_payment_capital")}
           when stage_row.stage is not null then 0
           else ${inrAmountExpression("so.actual_payment_capital")}
	         end`
    : `case
	           when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
	             then ${inrAmountExpression("stage_row.stage ->> 'stageAmountCapital'")}
	           when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb))
	             then ${plannedOrderCapitalExpression}
	           when stage_row.stage is not null then 0
	           else ${plannedOrderCapitalExpression}
	         end`;
  const effectiveRevenueExpression = usesActualAmount
    ? `case
           when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
             then ${inrAmountExpression("stage_row.stage ->> 'actualPaymentRevenue'")}
           when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb))
             then ${inrAmountExpression("so.actual_payment_revenue")}
           when stage_row.stage is not null then 0
           else ${inrAmountExpression("so.actual_payment_revenue")}
	         end`
    : `case
	           when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
	             then ${inrAmountExpression("stage_row.stage ->> 'stageAmountRevenue'")}
	           when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb))
	             then ${plannedOrderRevenueExpression}
	           when stage_row.stage is not null then 0
	           else ${plannedOrderRevenueExpression}
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
         case
           when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
             then coalesce(stage_row.stage -> 'billReturnCycles', '[]'::jsonb)
           when stage_row.stage is not null and not ${isYesExpression("so.stage_payment")} and stage_row.ordinality = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb))
             then coalesce(so.bill_return_cycles, '[]'::jsonb)
           when stage_row.stage is not null then '[]'::jsonb
           else coalesce(so.bill_return_cycles, '[]'::jsonb)
         end as bill_return_cycles,
		         so.so_cancelled_date,
		         ${isYesExpression("so.so_cancelled")} as so_cancelled_yes,
		         ${isYesExpression("so.shortclosure")} as shortclosure_yes,
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
       and (capital + revenue) > 0
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

type SupplementaryReturnedBillCashOutgoMode =
  | "supplementaryPendingReturnedBills"
  | "supplementaryReturnedBillsResubmitted"
  | "supplementaryReturnedBillsPaid";

type SupplementaryCashOutgoMode = "billSent" | "actual";

async function loadSupplementaryCashOutgoRows(
  whereSql: string,
  values: unknown[],
  mode: SupplementaryCashOutgoMode,
  dateRange?: { fromDate: string; toDate: string },
  asOfDate?: string,
): Promise<CashOutgoRow[]> {
  await ensureSupplyOrderBillReturnsSchema();
  const queryValues = [...values];
  const fromDatePlaceholder = dateRange ? addValue(queryValues, dateRange.fromDate) : undefined;
  const toDatePlaceholder = dateRange ? addValue(queryValues, dateRange.toDate) : undefined;
  const asOfDatePlaceholder = asOfDate ? addValue(queryValues, asOfDate) : undefined;
  const cyclesExpression = `coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)`;
  const paymentDateExpression = `nullif(supplementary_bill.bill ->> 'paymentDate', '')::date`;
  const submittedDateExpression = `coalesce(
    (select max(nullif(cycle ->> 'resubmittedDate', '')::date)
     from jsonb_array_elements(${cyclesExpression}) as cycle
     where coalesce(cycle ->> 'resubmittedDate', '') <> ''),
    nullif(supplementary_bill.bill ->> 'billSentForPaymentDate', '')::date
  )`;
  const hasOpenReturnedExpression = `exists (
    select 1 from jsonb_array_elements(${cyclesExpression}) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
      and coalesce(cycle ->> 'resubmittedDate', '') = ''
  )`;
  const dateExpression = mode === "actual" ? paymentDateExpression : submittedDateExpression;
  const dateRangeCondition =
    fromDatePlaceholder && toDatePlaceholder
      ? ` and ${dateExpression} between ${fromDatePlaceholder}::date and ${toDatePlaceholder}::date`
      : "";
  const stateExpression =
    mode === "actual"
      ? `${paymentDateExpression} is not null`
      : `${submittedDateExpression} is not null
         and not ${hasOpenReturnedExpression}
         and ${
           asOfDatePlaceholder
             ? `(${paymentDateExpression} is null or ${paymentDateExpression} > ${asOfDatePlaceholder}::date)
                and ${submittedDateExpression} <= ${asOfDatePlaceholder}::date`
             : toDatePlaceholder
               ? `(${paymentDateExpression} is null or ${paymentDateExpression} > ${toDatePlaceholder}::date)
                  and ${submittedDateExpression} <= ${toDatePlaceholder}::date`
               : `${paymentDateExpression} is null`
         }`;
  const capitalExpression =
    mode === "actual"
      ? inrAmountExpression(
          "coalesce(nullif(supplementary_bill.bill ->> 'actualPaymentCapital', ''), supplementary_bill.bill ->> 'billAmountCapital')",
        )
      : inrAmountExpression("supplementary_bill.bill ->> 'billAmountCapital'");
  const revenueExpression =
    mode === "actual"
      ? inrAmountExpression(
          "coalesce(nullif(supplementary_bill.bill ->> 'actualPaymentRevenue', ''), supplementary_bill.bill ->> 'billAmountRevenue')",
        )
      : inrAmountExpression("supplementary_bill.bill ->> 'billAmountRevenue'");

  const result = await pool.query<{
    month_key: string;
    month: string;
    capital: string | number;
    revenue: string | number;
    total: string | number;
  }>(
    `select
       to_char(${dateExpression}, 'YYYY-MM') as month_key,
       ${formatMonthExpression(dateExpression)} as month,
       round(coalesce(sum(${capitalExpression}), 0))::integer as capital,
       round(coalesce(sum(${revenueExpression}), 0))::integer as revenue,
       round(coalesce(sum(${capitalExpression} + ${revenueExpression}), 0))::integer as total
     from files f
     left join divisions d on d.id = f.division_id
     join supply_orders so on so.file_id = f.id
     join lateral jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill) on true
     ${appendReportWhereClause(whereSql, [
       `not ${isCancelledExpression()}`,
       `not ${isYesExpression("so.so_cancelled")}`,
       stateExpression,
       `${dateExpression} is not null`,
     ])}
       ${dateRangeCondition}
       and (${capitalExpression} + ${revenueExpression}) > 0
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

async function loadSupplementaryReturnedBillCashOutgoRows(
  whereSql: string,
  values: unknown[],
  mode: SupplementaryReturnedBillCashOutgoMode,
  dateRange?: { fromDate: string; toDate: string },
): Promise<CashOutgoRow[]> {
  await ensureSupplyOrderBillReturnsSchema();
  const queryValues = [...values];
  const fromDatePlaceholder = dateRange ? addValue(queryValues, dateRange.fromDate) : undefined;
  const toDatePlaceholder = dateRange ? addValue(queryValues, dateRange.toDate) : undefined;
  const cyclesExpression = `coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)`;
  const paymentDateExpression = `nullif(supplementary_bill.bill ->> 'paymentDate', '')::date`;
  const returnedDateExpression = `(select min(nullif(cycle ->> 'returnedDate', '')::date)
    from jsonb_array_elements(${cyclesExpression}) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> '')`;
  const pendingReturnedDateExpression = `(select min(nullif(cycle ->> 'returnedDate', '')::date)
    from jsonb_array_elements(${cyclesExpression}) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
      and coalesce(cycle ->> 'resubmittedDate', '') = '')`;
  const resubmittedDateExpression = `(select min(nullif(cycle ->> 'resubmittedDate', '')::date)
    from jsonb_array_elements(${cyclesExpression}) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
      and coalesce(cycle ->> 'resubmittedDate', '') <> '')`;
  const hasReturnedExpression = `exists (
    select 1 from jsonb_array_elements(${cyclesExpression}) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
  )`;
  const hasOpenReturnedExpression = `exists (
    select 1 from jsonb_array_elements(${cyclesExpression}) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
      and coalesce(cycle ->> 'resubmittedDate', '') = ''
  )`;
  const hasResubmittedExpression = `exists (
    select 1 from jsonb_array_elements(${cyclesExpression}) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
      and coalesce(cycle ->> 'resubmittedDate', '') <> ''
  )`;
  const dateExpression =
    mode === "supplementaryReturnedBillsPaid"
      ? paymentDateExpression
      : mode === "supplementaryReturnedBillsResubmitted"
        ? resubmittedDateExpression
        : pendingReturnedDateExpression;
  const stateExpression =
    mode === "supplementaryReturnedBillsPaid"
      ? `${paymentDateExpression} is not null and ${hasReturnedExpression}`
      : mode === "supplementaryReturnedBillsResubmitted"
        ? `${hasResubmittedExpression} and not ${hasOpenReturnedExpression} and ${paymentDateExpression} is null`
        : `${hasOpenReturnedExpression} and ${paymentDateExpression} is null`;
  const dateRangeCondition =
    fromDatePlaceholder && toDatePlaceholder
      ? ` and ${dateExpression} between ${fromDatePlaceholder}::date and ${toDatePlaceholder}::date`
      : "";
  const capitalExpression =
    mode === "supplementaryReturnedBillsPaid"
      ? inrAmountExpression(
          "coalesce(nullif(supplementary_bill.bill ->> 'actualPaymentCapital', ''), supplementary_bill.bill ->> 'billAmountCapital')",
        )
      : inrAmountExpression("supplementary_bill.bill ->> 'billAmountCapital'");
  const revenueExpression =
    mode === "supplementaryReturnedBillsPaid"
      ? inrAmountExpression(
          "coalesce(nullif(supplementary_bill.bill ->> 'actualPaymentRevenue', ''), supplementary_bill.bill ->> 'billAmountRevenue')",
        )
      : inrAmountExpression("supplementary_bill.bill ->> 'billAmountRevenue'");

  const result = await pool.query<{
    month_key: string;
    month: string;
    capital: string | number;
    revenue: string | number;
    total: string | number;
  }>(
    `select
       to_char(${dateExpression}, 'YYYY-MM') as month_key,
       ${formatMonthExpression(dateExpression)} as month,
       round(coalesce(sum(${capitalExpression}), 0))::integer as capital,
       round(coalesce(sum(${revenueExpression}), 0))::integer as revenue,
       round(coalesce(sum(${capitalExpression} + ${revenueExpression}), 0))::integer as total
     from files f
     left join divisions d on d.id = f.division_id
     join supply_orders so on so.file_id = f.id
     join lateral jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) as supplementary_bill(bill) on true
     ${appendReportWhereClause(whereSql, [
       `not ${isCancelledExpression()}`,
       `not ${isYesExpression("so.so_cancelled")}`,
       stateExpression,
       `${dateExpression} is not null`,
     ])}
       ${dateRangeCondition}
       and (${capitalExpression} + ${revenueExpression}) > 0
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
  return `coalesce(${[...previousDateExpressions, dateCastExpression("f.received_date")].join(
    ", ",
  )})`;
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
    (f.ad_sent_date),
    (f.pre_tcec_date),
    (f.pre_tcec_minutes_date),
    (f.ad_vetting_date),
    (f.rqa_sent_date),
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
  const contractFileType = `lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m')`;
  const goodsServicesIrNo = `(not ${isYesExpression("f.ir")} and not ${contractFileType})`;
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
      so.stage_payment,
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
      ${effectiveDpDate} as delivery_start_date,
      ${materialReceiptDate} as material_receipt_date,
      ${jobCompletionDone} as job_completion_done,
      case
        when ${nonDeliveryFileTypeExpression("f")} and ${effectiveDpDate} is not null
        then ${effectiveDpDate}
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
        when ${contractFileType}
          and ${effectiveDpDate} is not null
        then (${effectiveDpDate} + interval '1 day')::date
        when ${goodsServicesIrNo} and ${jobCompletionDone}
        then case
          when stage_row.stage is not null then nullif(stage_row.stage ->> 'jobCompletionDate', '')::date
          else so.job_completion_date
        end
        else coalesce(${irReceiptDate}, ${effectiveOrderDateExpression(
          "ir_preparation_date",
          "irPreparationDate",
        )}, ${materialReceiptDate})
      end as bill_preparation_start_date,
      ${effectiveOrderDateExpression("bill_preparation_date", "billPreparationDate")} as bill_preparation_date,
      ${effectiveOrderDateExpression("bill_preparation_date", "billPreparationDate")} as bill_sent_for_payment_start_date,
      ${effectiveOrderDateExpression(
        "bill_sent_for_payment_date",
        "billSentForPaymentDate",
      )} as bill_sent_for_payment_date,
      case
        when stage_row.stage is not null and ${isYesExpression("so.stage_payment")}
          then coalesce(stage_row.stage -> 'billReturnCycles', '[]'::jsonb)
        when stage_row.stage is not null
          and not ${isYesExpression("so.stage_payment")}
          and stage_row.stage_index = jsonb_array_length(coalesce(so.stage_deliveries, '[]'::jsonb))
          then coalesce(so.bill_return_cycles, '[]'::jsonb)
        when stage_row.stage is not null then '[]'::jsonb
        else coalesce(so.bill_return_cycles, '[]'::jsonb)
      end as bill_return_cycles,
      ${soDate} as advance_payment_start_date,
      ${advancePaymentDate} as advance_payment_date,
      ${effectiveOrderDateExpression(
        "bill_sent_for_payment_date",
        "billSentForPaymentDate",
      )} as payment_start_date,
      case
        when ${contractFileType}
          and ${effectiveDpDate} is not null
        then (${effectiveDpDate} + interval '1 day')::date
        when ${goodsServicesIrNo} and ${jobCompletionDone}
        then case
          when stage_row.stage is not null then nullif(stage_row.stage ->> 'jobCompletionDate', '')::date
          else so.job_completion_date
        end
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
        (f.ad_sent_date),
        (f.pre_tcec_date),
        (f.pre_tcec_minutes_date),
        (f.ad_vetting_date),
        (f.rqa_sent_date),
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
  const supplyOrderIndex = reportMilestoneDefinitions.findIndex(
    (item) => item.key === "supplyOrder",
  );
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
            and (
              '${normalizeMilestoneName(milestone.current)}' not in (
                'billpreparation',
                'billsentforpayment',
                'billreturnedforcorrection',
                'payment'
              )
              or ${isYesExpression("effective_order.stage_payment")}
            )
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
      const contractPaymentDelay = `(lower(trim(coalesce(f.file_type, ''))) in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
        and effective_order.payment_date is null
        and not effective_order.job_completion_done
        and effective_order.payment_due_start_date is not null
        and (current_date - effective_order.payment_due_start_date::date) > ${thresholdPlaceholder}::integer)`;
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
          ? `${startDate} is not null
            and (lower(trim(coalesce(f.file_type, ''))) not in ('amc', 'mpc', 'cars', 'capsi', 'o&m')
              or not effective_order.job_completion_done
              or effective_order.bill_sent_for_payment_date is not null)`
          : milestone.key === "jobCompletion"
            ? `${startDate} is not null and not ${contractPaymentDelay}`
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

function workflowNotStartedDelayRowsSelects(
  whereSql: string,
  selectedMilestoneKey: string,
  thresholdPlaceholder: string,
) {
  if (selectedMilestoneKey !== "all" && selectedMilestoneKey !== "workflowNotStarted") {
    return [];
  }
  const startDate = "coalesce(f.received_date, f.created_at::date)";
  return [
    `select
        f.id::text as "fileId",
        coalesce(nullif(f.file_no, ''), nullif(f.unique_code, ''), nullif(f.title, ''), f.id::text) as "fileRef",
        coalesce(d.name, '') as division,
        coalesce(f.indentor, '') as indentor,
        coalesce(f.demand_description, '') as description,
        'workflowNotStarted' as "milestoneKey",
        'Workflow Not Started' as milestone,
        (${startDate})::text as "stageStartDate",
        (current_date - (${startDate})::date)::integer as "daysInStage",
        coalesce((${lastFilledDateExpression()})::text, '') as "lastFilledDate",
        'Timeline' as "focusSection",
        null::text as "focusTarget"
      from files f
      left join divisions d on d.id = f.division_id
      ${appendReportWhereClause(whereSql, [
        workflowNotStartedExpression(),
        `(${startDate}) is not null`,
        `(current_date - (${startDate})::date) > ${thresholdPlaceholder}::integer`,
      ])}`,
  ];
}

function returnedBillDelayRowsSelects(
  whereSql: string,
  selectedMilestoneKey: string,
  thresholdPlaceholder: string,
) {
  if (selectedMilestoneKey !== "all" && selectedMilestoneKey !== billReturnedDelayMilestoneKey) {
    return [];
  }
  const supplyOrderIndex = reportMilestoneDefinitions.findIndex(
    (milestone) => milestone.key === "supplyOrder",
  );
  const supplyOrderStageStartDate = delayStageStartExpression(
    reportMilestoneDefinitions[supplyOrderIndex],
    supplyOrderIndex,
  );
  const source = effectiveOrderDelayRowsSource(supplyOrderStageStartDate, true);
  const baseFileRef =
    "coalesce(nullif(f.file_no, ''), nullif(f.unique_code, ''), nullif(f.title, ''), f.id::text)";
  const orderRef =
    "coalesce(nullif(effective_order.so_no, ''), nullif(effective_order.gem_so_no, ''), 'S.O. ' || (effective_order.sort_order + 1)::text)";
  const startDate = `(select min(nullif(cycle ->> 'returnedDate', '')::date)
    from jsonb_array_elements(coalesce(effective_order.bill_return_cycles, '[]'::jsonb)) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
      and coalesce(cycle ->> 'resubmittedDate', '') = '')`;
  const focusTarget = `('billreturnedforcorrection:pending:' || effective_order.sort_order::text ||
    case
      when effective_order.stage_index is not null and ${isYesExpression("effective_order.stage_payment")}
      then ':' || (effective_order.stage_index - 1)::text
      else ''
    end)`;
  return [
    `select
        f.id::text as "fileId",
        (${baseFileRef} || ' / ' || ${orderRef}) as "fileRef",
        coalesce(d.name, '') as division,
        coalesce(f.indentor, '') as indentor,
        coalesce(f.demand_description, '') as description,
        '${billReturnedDelayMilestoneKey}' as "milestoneKey",
        'Returned Bills' as milestone,
        (${startDate})::text as "stageStartDate",
        (current_date - (${startDate})::date)::integer as "daysInStage",
        coalesce((${lastFilledDateExpression()})::text, '') as "lastFilledDate",
        'Supply order and payment' as "focusSection",
        ${focusTarget} as "focusTarget"
      from files f
      left join divisions d on d.id = f.division_id
      join lateral ${source} effective_order on true
      ${appendReportWhereClause(whereSql, [
        `not ${isYesExpression("f.demand_cancelled")}`,
        `not ${isYesExpression("effective_order.so_cancelled")}`,
        `effective_order.payment_date is null`,
        `${startDate} is not null`,
        `(current_date - (${startDate})::date) > ${thresholdPlaceholder}::integer`,
      ])}`,
  ];
}

function supplementaryReturnedBillDelayRowsSelects(
  whereSql: string,
  selectedMilestoneKey: string,
  thresholdPlaceholder: string,
) {
  if (
    selectedMilestoneKey !== "all" &&
    selectedMilestoneKey !== supplementaryBillReturnedDelayMilestoneKey
  ) {
    return [];
  }
  const baseFileRef =
    "coalesce(nullif(f.file_no, ''), nullif(f.unique_code, ''), nullif(f.title, ''), f.id::text)";
  const orderRef =
    "coalesce(nullif(so.so_no, ''), nullif(so.gem_so_no, ''), 'S.O. ' || (so.sort_order + 1)::text)";
  const billRef =
    "coalesce(nullif(supplementary_bill.bill ->> 'billNo', ''), 'Supp. bill ' || supplementary_bill.bill_index::text)";
  const cyclesExpression = `coalesce(supplementary_bill.bill -> 'billReturnCycles', '[]'::jsonb)`;
  const startDate = `(select min(nullif(cycle ->> 'returnedDate', '')::date)
    from jsonb_array_elements(${cyclesExpression}) as cycle
    where coalesce(cycle ->> 'returnedDate', '') <> ''
      and coalesce(cycle ->> 'resubmittedDate', '') = '')`;
  const paymentDate = `nullif(supplementary_bill.bill ->> 'paymentDate', '')::date`;
  const focusTarget = `('supplementarybill:returned:' || so.sort_order::text || ':' || (supplementary_bill.bill_index - 1)::text)`;
  return [
    `select
        f.id::text as "fileId",
        (${baseFileRef} || ' / ' || ${orderRef} || ' / ' || ${billRef}) as "fileRef",
        coalesce(d.name, '') as division,
        coalesce(f.indentor, '') as indentor,
        coalesce(f.demand_description, '') as description,
        '${supplementaryBillReturnedDelayMilestoneKey}' as "milestoneKey",
        'Supplementary bill returned for correction' as milestone,
        (${startDate})::text as "stageStartDate",
        (current_date - (${startDate})::date)::integer as "daysInStage",
        coalesce((${lastFilledDateExpression()})::text, '') as "lastFilledDate",
        'Supply order and payment' as "focusSection",
        ${focusTarget} as "focusTarget"
      from files f
      left join divisions d on d.id = f.division_id
      join supply_orders so on so.file_id = f.id
      join lateral jsonb_array_elements(coalesce(so.supplementary_bills, '[]'::jsonb)) with ordinality as supplementary_bill(bill, bill_index) on true
      ${appendReportWhereClause(whereSql, [
        `not ${isYesExpression("f.demand_cancelled")}`,
        `not ${isYesExpression("so.so_cancelled")}`,
        `${paymentDate} is null`,
        `${startDate} is not null`,
        `(current_date - (${startDate})::date) > ${thresholdPlaceholder}::integer`,
      ])}`,
  ];
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
  const returnedBillSelects = returnedBillDelayRowsSelects(
    whereSql,
    selectedMilestoneKey,
    thresholdPlaceholder,
  );
  const supplementaryReturnedBillSelects = supplementaryReturnedBillDelayRowsSelects(
    whereSql,
    selectedMilestoneKey,
    thresholdPlaceholder,
  );
  const workflowNotStartedSelects = workflowNotStartedDelayRowsSelects(
    whereSql,
    selectedMilestoneKey,
    thresholdPlaceholder,
  );
  const selects = [
    ...workflowNotStartedSelects,
    ...fileSelects,
    ...financialSanctionFileSelects,
    ...orderSelects,
    ...returnedBillSelects,
    ...supplementaryReturnedBillSelects,
  ];
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
  const counts = new Map<string, { key: string; label: string; fileIds: Set<string> }>();
  rows.forEach((row) => {
    const current = counts.get(row.milestoneKey) ?? {
      key: row.milestoneKey,
      label: row.milestone,
      fileIds: new Set<string>(),
    };
    current.fileIds.add(row.fileId);
    counts.set(row.milestoneKey, current);
  });
  return {
    averageDays: rows.length ? Math.round(totalDays / rows.length) : 0,
    longestDays: rows.reduce((max, row) => Math.max(max, row.daysInStage), 0),
    byMilestone: Array.from(counts.values())
      .map(({ key, label, fileIds }) => ({ key, label, count: fileIds.size }))
      .sort((a, b) => b.count - a.count),
  };
}

reportsRouter.get(
  "/mer-data",
  asyncHandler(async (request, response) => {
    requireAuth(request as AuthRequest);
    const settings = await loadSettings();
    const financialYear = readString(request.query.financialYear) ?? settings.financialYear;
    if (!isFinancialYearLabel(financialYear)) {
      throw new HttpError(400, "Valid financial year is required.");
    }
    response.json({ rows: await loadMerCashOutgoRows(financialYear) });
  }),
);

reportsRouter.put(
  "/mer-data",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canSaveMerData(user)) throw new HttpError(403, "You cannot edit MER data.");
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Request body is required.");
    }
    const financialYear = readString((body as Record<string, unknown>).financialYear);
    const rows = (body as Record<string, unknown>).rows;
    if (!isFinancialYearLabel(financialYear)) {
      throw new HttpError(400, "Valid financial year is required.");
    }
    const validFinancialYear = financialYear;
    if (!Array.isArray(rows)) throw new HttpError(400, "Rows are required.");
    const normalizedRows = rows
      .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
      .map((row) => ({
        monthKey: readString(row.monthKey),
        capital: normalizeMerAmount(row.capital),
        revenue: normalizeMerAmount(row.revenue),
      }))
      .filter((row) => row.monthKey && /^\d{4}-\d{2}$/.test(row.monthKey));

    await ensureMerCashOutgoSchema();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from mer_cash_outgo where financial_year = $1", [
        validFinancialYear,
      ]);
      for (const row of normalizedRows) {
        await client.query(
          `insert into mer_cash_outgo (financial_year, month_key, capital, revenue, updated_at)
           values ($1, $2, $3, $4, now())`,
          [validFinancialYear, row.monthKey, row.capital, row.revenue],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    response.json({ rows: await loadMerCashOutgoRows(validFinancialYear) });
  }),
);

reportsRouter.get(
  "/cash-out-go-plan",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const settings = await loadSettings();
    const financialYear = readString(request.query.financialYear) ?? settings.financialYear;
    if (!isFinancialYearLabel(financialYear)) {
      throw new HttpError(400, "Valid financial year is required.");
    }
    const includePreviousFySubmitted =
      readString(request.query.includePreviousFySubmitted) === "true";
    const divisionId = readString(request.query.divisionId)?.trim() || "all";
    const scopeKey = getCashOutGoPlanScopeKey(user);
    const [planSettings, assumptions, allocation, merRows, allFiles] = await Promise.all([
      loadCashOutGoPlanSettings(scopeKey),
      loadCashOutGoPlanAssumptions(scopeKey),
      loadCashOutGoPlanAllocationForUser(financialYear, divisionId, user),
      loadMerCashOutgoRows(financialYear),
      loadFiles("", [], false),
    ]);
    const files = allFiles.filter((file) => {
      if (!canAccessDivision(user, file.divisionId)) return false;
      return divisionId === "all" || file.divisionId === divisionId;
    });
    response.json({
      plan: buildCashOutGoPlan(
        files,
        financialYear,
        merRows,
        planSettings,
        assumptions,
        includePreviousFySubmitted,
        allocation,
      ),
    });
  }),
);

reportsRouter.put(
  "/cash-out-go-plan",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canSaveCashOutGoPlan(user)) {
      throw new HttpError(403, "You cannot save Cash Out Go Plan changes.");
    }
    const scopeKey = getCashOutGoPlanScopeKey(user);
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Request body is required.");
    }
    const record = body as Record<string, unknown>;
    const billOffsetDays = readPlanNonNegativeInteger(
      record.billOffsetDays,
      DEFAULT_BILL_PAYMENT_OFFSET_DAYS,
    );
    const useCustomBillOffsetDays = readBoolean(record.useCustomBillOffsetDays);
    const handSubmissionOffsetDays = readPlanNonNegativeInteger(
      record.handSubmissionOffsetDays,
      DEFAULT_BILL_SUBMISSION_OFFSET_DAYS,
    );
    const useCustomHandSubmissionOffsetDays = readBoolean(record.useCustomHandSubmissionOffsetDays);
    const dpOffsetDays = readPlanNonNegativeInteger(record.dpOffsetDays, DEFAULT_DP_OFFSET_DAYS);
    const useCustomDpOffsetDays = readBoolean(record.useCustomDpOffsetDays);
    const rows = Array.isArray(record.rows) ? record.rows : [];
    const effectiveBillOffsetDays = useCustomBillOffsetDays
      ? billOffsetDays
      : DEFAULT_BILL_PAYMENT_OFFSET_DAYS;

    await ensureCashOutGoPlanSchema();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
          `insert into cash_out_go_plan_settings
           (
             id,
             bill_offset_days,
             use_custom_bill_offset_days,
             hand_submission_offset_days,
             use_custom_hand_submission_offset_days,
             dp_offset_days,
             use_custom_dp_offset_days,
             updated_at
           )
         values ($1, $2, $3, $4, $5, $6, $7, now())
         on conflict (id) do update
         set bill_offset_days = excluded.bill_offset_days,
             use_custom_bill_offset_days = excluded.use_custom_bill_offset_days,
             hand_submission_offset_days = excluded.hand_submission_offset_days,
             use_custom_hand_submission_offset_days =
               excluded.use_custom_hand_submission_offset_days,
             dp_offset_days = excluded.dp_offset_days,
             use_custom_dp_offset_days = excluded.use_custom_dp_offset_days,
             updated_at = now()`,
        [
          scopeKey,
          billOffsetDays,
          useCustomBillOffsetDays,
          handSubmissionOffsetDays,
          useCustomHandSubmissionOffsetDays,
          dpOffsetDays,
          useCustomDpOffsetDays,
        ],
      );
      for (const item of rows) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const row = item as Record<string, unknown>;
        const rowKey = readString(row.rowKey)?.trim();
        if (!rowKey) continue;
        const expectedSentDate = readDateString(row.expectedSentDate);
        const expectedPaymentDate = readDateString(row.expectedPaymentDate);
        const offsetText = readString(row.billOffsetOverride)?.trim();
        const billOffsetOverride =
          offsetText === "" || offsetText === undefined
            ? undefined
            : readPlanNonNegativeInteger(offsetText, billOffsetDays);
        const normalizedBillOffsetOverride =
          billOffsetOverride === effectiveBillOffsetDays ? undefined : billOffsetOverride;
        if (!expectedSentDate && !expectedPaymentDate && normalizedBillOffsetOverride === undefined) {
          await client.query(
            "delete from cash_out_go_plan_assumptions where scope_key = $1 and row_key = $2",
            [scopeKey, rowKey],
          );
          continue;
        }
        await client.query(
          `insert into cash_out_go_plan_assumptions
             (scope_key, row_key, expected_sent_date, expected_payment_date, bill_offset_days, updated_at)
           values ($1, $2, $3, $4, $5, now())
           on conflict (scope_key, row_key) do update
           set expected_sent_date = excluded.expected_sent_date,
               expected_payment_date = excluded.expected_payment_date,
               bill_offset_days = excluded.bill_offset_days,
               updated_at = now()`,
          [
            scopeKey,
            rowKey,
            expectedSentDate ?? null,
            expectedPaymentDate ?? null,
            normalizedBillOffsetOverride ?? null,
          ],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    response.json({ ok: true });
  }),
);

reportsRouter.get(
  "/pre-so-cash-outgo-plan",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const settings = await loadSettings();
    const scopeKey = getPreSoCashOutgoScopeKey(user);
    const plan = await loadPreSoCashOutgoPlan(scopeKey, user);
    response.json({
      plan: {
        defaultSoOffsetDays: settings.preSoDefaultSoOffsetDays ?? DEFAULT_PRE_SO_OFFSET_DAYS,
        defaultPaymentOffsetDays:
          settings.preSoDefaultPaymentOffsetDays ?? DEFAULT_PRE_SO_OFFSET_DAYS,
        canSave: canSavePreSoCashOutgoPlan(user),
        canSaveStageOffsets: canSavePreSoStageOffsets(user),
        ...plan,
      },
    });
  }),
);

reportsRouter.put(
  "/pre-so-cash-outgo-plan",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canSavePreSoCashOutgoPlan(user)) {
      throw new HttpError(403, "You cannot save Pre-S.O. cash outgo plan changes.");
    }
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Request body is required.");
    }
    const record = body as Record<string, unknown>;
    const stageOffsets = Array.isArray(record.stageOffsets) ? record.stageOffsets : [];
    const filePlans = Array.isArray(record.filePlans) ? record.filePlans : [];
    const scopeKey = getPreSoCashOutgoScopeKey(user);
    const normalizedFilePlans = filePlans
      .filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
      .map((row) => ({
        fileId: readString(row.fileId)?.trim() ?? "",
        included: readBoolean(row.included),
        tentativeSoDate: readDateString(row.tentativeSoDate),
        tentativePaymentDate: readDateString(row.tentativePaymentDate),
      }))
      .filter((row) => row.fileId);
    const submittedFileIds = normalizedFilePlans.map((row) => row.fileId);
    const accessibleFileIds = await assertPreSoFilePlanAccess(user, submittedFileIds);

    await ensurePreSoCashOutgoSchema();
    const client = await pool.connect();
    try {
      await client.query("begin");
      if (canSavePreSoStageOffsets(user)) {
        await client.query("delete from pre_so_cash_outgo_stage_offsets where scope_key = $1", [
          scopeKey,
        ]);
        for (const item of stageOffsets) {
          if (!item || typeof item !== "object" || Array.isArray(item)) continue;
          const row = item as Record<string, unknown>;
          const stageKey = readString(row.stageKey)?.trim();
          if (!stageKey) continue;
          await client.query(
            `insert into pre_so_cash_outgo_stage_offsets
               (scope_key, stage_key, so_offset_days, payment_offset_days, updated_by, updated_at)
             values ($1, $2, $3, $4, $5, now())`,
            [
              scopeKey,
              stageKey,
              readPlanNonNegativeInteger(row.soOffsetDays, DEFAULT_PRE_SO_OFFSET_DAYS),
              readPlanNonNegativeInteger(row.paymentOffsetDays, DEFAULT_PRE_SO_OFFSET_DAYS),
              user.id,
            ],
          );
        }
      }

      if (submittedFileIds.length) {
        await client.query(
          `delete from pre_so_cash_outgo_file_plans
           where scope_key = $1 and file_id = any($2::uuid[])`,
          [scopeKey, submittedFileIds],
        );
      }
      for (const row of normalizedFilePlans) {
        if (!accessibleFileIds.has(row.fileId)) continue;
        const { fileId, included, tentativeSoDate, tentativePaymentDate } = row;
        if (!included && !tentativeSoDate && !tentativePaymentDate) continue;
        await client.query(
          `insert into pre_so_cash_outgo_file_plans
             (scope_key, file_id, included, tentative_so_date, tentative_payment_date, updated_by, updated_at)
           values ($1, $2, $3, $4, $5, $6, now())`,
          [
            scopeKey,
            fileId,
            included,
            tentativeSoDate ?? null,
            tentativePaymentDate ?? null,
            user.id,
          ],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    const settings = await loadSettings();
    const plan = await loadPreSoCashOutgoPlan(scopeKey, user);
    response.json({
      plan: {
        defaultSoOffsetDays: settings.preSoDefaultSoOffsetDays ?? DEFAULT_PRE_SO_OFFSET_DAYS,
        defaultPaymentOffsetDays:
          settings.preSoDefaultPaymentOffsetDays ?? DEFAULT_PRE_SO_OFFSET_DAYS,
        canSave: canSavePreSoCashOutgoPlan(user),
        canSaveStageOffsets: canSavePreSoStageOffsets(user),
        ...plan,
      },
    });
  }),
);

function readPlanNonNegativeInteger(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(typeof value === "string" ? value : "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
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
    orderExpectedCashOutgoBillPreparationRows,
    orderBillSentForPaymentRows,
    orderActualCashOutgoRows,
    supplementaryBillSentForPaymentRows,
    supplementaryActualCashOutgoRows,
    pendingReturnedBillRows,
    returnedBillResubmittedRows,
    returnedBillPaidRows,
    supplementaryPendingReturnedBillRows,
    supplementaryReturnedBillResubmittedRows,
    supplementaryReturnedBillPaidRows,
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
    loadSupplementaryCashOutgoRows(
      whereSql,
      [...values],
      "billSent",
      historicalRange,
      cashOutgoAsOfDate,
    ),
    loadSupplementaryCashOutgoRows(whereSql, [...values], "actual", historicalRange),
    loadCashOutgoRows(whereSql, [...values], "pendingReturnedBills", 0, historicalRange),
    loadCashOutgoRows(whereSql, [...values], "returnedBillsResubmitted", 0, historicalRange),
    loadCashOutgoRows(whereSql, [...values], "returnedBillsPaid", 0, historicalRange),
    loadSupplementaryReturnedBillCashOutgoRows(
      whereSql,
      [...values],
      "supplementaryPendingReturnedBills",
      historicalRange,
    ),
    loadSupplementaryReturnedBillCashOutgoRows(
      whereSql,
      [...values],
      "supplementaryReturnedBillsResubmitted",
      historicalRange,
    ),
    loadSupplementaryReturnedBillCashOutgoRows(
      whereSql,
      [...values],
      "supplementaryReturnedBillsPaid",
      historicalRange,
    ),
    loadDelayRows(whereSql, [...values], delayDays, delayMilestone),
  ]);
  const billSentForPaymentRows = combineCashOutgoRows(
    orderBillSentForPaymentRows,
    supplementaryBillSentForPaymentRows,
  );
  const actualCashOutgoRows = combineCashOutgoRows(
    orderActualCashOutgoRows,
    supplementaryActualCashOutgoRows,
  );
  const expectedCashOutgoBillPreparationRows = combineCashOutgoRows(
    orderExpectedCashOutgoBillPreparationRows,
    supplementaryPendingReturnedBillRows,
  );
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
    supplementaryBillSentForPaymentRows,
    supplementaryActualCashOutgoRows,
    pendingReturnedBillRows,
    returnedBillResubmittedRows,
    returnedBillPaidRows,
    supplementaryPendingReturnedBillRows,
    supplementaryReturnedBillResubmittedRows,
    supplementaryReturnedBillPaidRows,
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
    const fileYear = readString(request.query.fileYear);
    const fileInitiationFrom = readDateString(request.query.fileInitiationFrom);
    const fileInitiationTo = readDateString(request.query.fileInitiationTo);
    const division = readString(request.query.division) ?? "all";
    const fileCategories = readOptionalFileCategories(request.query.fileCategories);
    const delayDays = readNonNegativeInteger(request.query.delayDays, 5);
    const delayMilestone = readString(request.query.delayMilestone) ?? "all";
    const expectedCashOutgoDays = readNonNegativeInteger(
      request.query.expectedCashOutgoDays,
      DEFAULT_DP_OFFSET_DAYS,
    );
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
      fileYear,
      fileInitiationFrom,
      fileInitiationTo,
      currentFinancialYear: settings.financialYear,
      division,
      fileCategories,
    });
    const cacheKey = `reports:summary:${JSON.stringify({
      version: 4,
      scope: getAuthScopeCacheKey(user),
      selectedYear,
      fileYear,
      fileInitiationFrom,
      fileInitiationTo,
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
      const selectedYearFiles = files
        .filter((file) => isFileVisibleForSelectedYear(file, selectedYear, settings.financialYear))
        .filter((file) => !fileYear || fileYear === "all" || file.year === fileYear)
        .filter((file) => {
          if (fileInitiationFrom && (!file.receivedDate || file.receivedDate < fileInitiationFrom))
            return false;
          if (fileInitiationTo && (!file.receivedDate || file.receivedDate > fileInitiationTo))
            return false;
          return true;
        });
      const categoryFiles = fileCategories
        ? selectedYearFiles.filter((file) => matchesFileCategorySelection(file, fileCategories))
        : selectedYearFiles;
      const pendingBillingFiles =
        selectedYear === activePlusCurrentFyClosedYear
          ? categoryFiles.filter((file) => !isInactiveFile(file))
          : categoryFiles;
      const normalizedSummary = buildReportsSummary({
        files: categoryFiles,
        pendingBillingFiles,
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
