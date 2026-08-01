import { pool } from "../src/db/pool.js";
import { saveUserSession, deleteSession } from "../src/utils/auth.js";
import { buildDashboardSummary } from "../src/utils/dashboard-summary.js";
import { searchFiles } from "../src/utils/file-search.js";
import { buildReportsSummary } from "../src/utils/report-summary.js";
import { loadFiles } from "../src/routes/files.js";
import type { AppSettings, Division, FileRecord, SupplyOrderDetail } from "../src/types.js";

const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL;
const QA_CODE = `QA-HUMAN-WORKFLOW-${new Date().toISOString().slice(0, 10)}`;
const YEAR = "2026-27";
const DIVISION = "ACC";

type Check = {
  label: string;
  ok: boolean;
  detail?: string;
};

type WorkflowStep = {
  name: string;
  mutate: (payload: Record<string, unknown>) => Record<string, unknown>;
  checks: (file: FileRecord, context: SummaryContext) => Check[];
};

type SummaryContext = {
  dashboard: ReturnType<typeof buildDashboardSummary>;
  reports: ReturnType<typeof buildReportsSummary>;
};

function isYes(value: string | undefined) {
  return (value ?? "").trim().toLowerCase() === "yes";
}

function hasText(value: string | undefined) {
  return Boolean(value?.trim());
}

function normalizeMilestone(value: string | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function completed(order: SupplyOrderDetail, milestone: string) {
  const key = normalizeMilestone(milestone);
  return order.completedMilestones?.some((item) => normalizeMilestone(item) === key) ?? false;
}

function statusCount(
  reports: ReturnType<typeof buildReportsSummary>,
  milestone: string,
  column: string,
) {
  for (const group of reports.statusSummaryGroups) {
    const row = group.rows.find((item) => item.milestone === milestone);
    const value = row?.counts[column];
    if (typeof value === "number") return value;
  }
  return 0;
}

function matches(file: FileRecord, dashboardFilter: string) {
  return searchFiles([file], { dashboardFilter } as Parameters<typeof searchFiles>[1]).length === 1;
}

function check(label: string, ok: boolean, detail?: string): Check {
  return { label, ok, detail };
}

function order(file: FileRecord) {
  const row = file.supplyOrders?.[0];
  if (!row) throw new Error("QA file has no supply order row.");
  return row;
}

function makeBasePayload() {
  return {
    title: QA_CODE,
    uniqueCode: QA_CODE,
    fileNo: QA_CODE,
    division: DIVISION,
    year: YEAR,
    activeYears: [YEAR],
    receivedDate: "2026-07-01",
    date: "2026-07-01",
    indentor: "QA Indentor",
    demandDescription: "QA human workflow counter/clicker audit",
    valueCapital: "10000",
    valueRevenue: "",
    currency: "INR",
    exchangeRate: "1",
    fileType: "Goods & Services",
    mode: "PBM",
    gem: "No",
    gte: "No",
    tcec: "No",
    highValue: "No",
    ad: "No",
    rqa: "No",
    ifa: "No",
    bg: "Yes",
    psb: "No",
    ir: "Yes",
    rfpVetting: "No",
    demandCancelled: "No",
    noOfSo: "1",
    currentMilestone: "Scrutiny",
    completedMilestones: [],
    supplyOrders: [],
  } satisfies Record<string, unknown>;
}

function withOrder(
  payload: Record<string, unknown>,
  patch: Partial<SupplyOrderDetail>,
): Record<string, unknown> {
  const existing = Array.isArray(payload.supplyOrders)
    ? ((payload.supplyOrders[0] ?? {}) as SupplyOrderDetail)
    : {};
  return {
    ...payload,
    noOfSo: "1",
    supplyOrders: [{ ...existing, ...patch }],
  };
}

function withOrderCompleted(
  payload: Record<string, unknown>,
  milestones: string[],
): Record<string, unknown> {
  return withOrder(payload, { completedMilestones: milestones });
}

function monthlyHas(
  rows: Array<{ monthKey: string } & Record<string, unknown>>,
  monthKey: string,
  key: string,
  expected: number,
) {
  const value = rows.find((row) => row.monthKey === monthKey)?.[key];
  return Number(value ?? 0) === expected;
}

function financeCheck(context: SummaryContext, expected: Partial<Record<string, number>>) {
  return Object.entries(expected).map(([key, value]) =>
    check(
      `Finance ${key} = ${value}`,
      Number(context.dashboard.financeTotals[key as keyof typeof context.dashboard.financeTotals]) ===
        value,
      String(context.dashboard.financeTotals[key as keyof typeof context.dashboard.financeTotals]),
    ),
  );
}

const steps: WorkflowStep[] = [
  {
    name: "01 Basic demand received",
    mutate: (payload) => payload,
    checks: (file, context) => [
      check("File search by unique code finds QA file", file.uniqueCode === QA_CODE),
      check("Current milestone is Scrutiny", file.currentMilestone === "Scrutiny"),
      check("Snapshot Warranty yes clicker matches", matches(file, "attribute:bg:yes")),
      check("Status Scrutiny pending clicker matches", matches(file, "milestone:Scrutiny")),
      check("Reports monthly file inflow July count is 1", monthlyHas(context.reports.monthlyFileInflow, "2026-07", "count", 1)),
      ...financeCheck(context, { projectedCapital: 10000, bookedCapital: 0, spentCapital: 0, paidCapital: 0 }),
    ],
  },
  {
    name: "02 Scrutiny started",
    mutate: (payload) => ({ ...payload, scrutinyDate: "2026-07-02" }),
    checks: (file) => [
      check("Scrutiny date saved", file.scrutinyDate === "2026-07-02"),
      check("Status Scrutiny reviewed clicker matches", matches(file, "milestoneReviewed:scrutiny")),
    ],
  },
  {
    name: "03 Scrutiny completed and controlling current",
    mutate: (payload) => ({
      ...payload,
      scrutinyCompletionDate: "2026-07-03",
      imms: "IMMS-QA-001",
      immsDate: "2026-07-04",
      currentMilestone: "CFA",
      completedMilestones: ["Scrutiny", "Controlling"],
    }),
    checks: (file, context) => [
      check("Scrutiny completed clicker matches", matches(file, "scrutinyCompleted")),
      check("Controlling completed", file.completedMilestones?.includes("Controlling") ?? false),
      ...financeCheck(context, { projectedCapital: 0, bookedCapital: 10000, spentCapital: 0, paidCapital: 0 }),
    ],
  },
  {
    name: "04 CFA completed and FS current",
    mutate: (payload) => ({
      ...payload,
      cfaSentDate: "2026-07-05",
      cfaDate: "2026-07-06",
      currentMilestone: "Financial Sanction",
      completedMilestones: ["Scrutiny", "Controlling", "CFA"],
    }),
    checks: (file) => [
      check("CFA completed clicker matches", matches(file, "cfaCompleted")),
      check("Financial Sanction pending clicker matches", matches(file, "statusSummary:Financial%20Sanction:Pending")),
    ],
  },
  {
    name: "05 Financial Sanction date filled",
    mutate: (payload) =>
      withOrder(payload, {
        financialSanctionDate: "2026-07-07",
        currentMilestone: "Supply Order",
        completedMilestones: ["Financial Sanction"],
      }),
    checks: (file, context) => {
      const so = order(file);
      return [
        check("FS date saved", so.financialSanctionDate === "2026-07-07"),
        check("FS Done is represented by completed milestone", completed(so, "Financial Sanction")),
        check("Supply Order current after FS", so.currentMilestone === "Supply Order"),
        check("Status FS completed count is 1", statusCount(context.reports, "Financial Sanction", "Completed") === 1),
        check("Status SO pending count is 1", statusCount(context.reports, "Supply Order", "Pending") === 1),
        check("SO pending clicker matches", matches(file, "statusSummary:Supply%20Order:Pending")),
      ];
    },
  },
  {
    name: "06 Complete Supply Order tab and place S.O.",
    mutate: (payload) =>
      withOrderCompleted(
        withOrder(payload, {
          currentMilestone: "Delivery",
          psbApplicable: "Yes",
          bgCoverageType: "PSB and PWB separately",
          soNo: "QA-SO-001",
          soDate: "2026-07-12",
          soValueCapital: "10000",
          firm: "QA Firm",
          firmType: "MSME",
          dpDate: "2026-08-15",
          paymentMode: "Online",
          stageDelivery: "No",
          stagePayment: "No",
          advancePayment: "No",
        }),
        ["Financial Sanction", "Supply Order", "Delivery Period"],
      ),
    checks: (file, context) => [
      check("S.O. placed clicker matches", matches(file, "statusSummary:Supply%20Order:Placed")),
      check("S.O. live clicker matches", matches(file, "statusSummary:Supply%20Order:Live")),
      check("PSB pending count is 1", statusCount(context.reports, "PSB", "Pending") === 1),
      check("PWB pending count remains 0 before material receipt", statusCount(context.reports, "PWB", "Pending") === 0),
      check("Delivery pending count is 1", statusCount(context.reports, "Delivery", "Pending") === 1),
      check("Month-wise S.O. July count is 1", monthlyHas(context.reports.monthWiseSupplyOrder, "2026-07", "count", 1)),
      check("Month-wise D.P. schedule Aug gross/net is 1", monthlyHas(context.reports.monthWiseDeliverySchedule, "2026-08", "grossCount", 1) && monthlyHas(context.reports.monthWiseDeliverySchedule, "2026-08", "netCount", 1)),
      ...financeCheck(context, { bookedCapital: 0, spentCapital: 10000, paidCapital: 0 }),
    ],
  },
  {
    name: "07 PSB received",
    mutate: (payload) =>
      withOrderCompleted(
        withOrder(payload, {
          psbBgNo: "QA-PSB-001",
          psbBgAmount: "1000",
          psbBgReceivedDate: "2026-07-13",
          psbBgValidityDate: "2026-12-31",
        }),
        ["Financial Sanction", "Supply Order", "Delivery Period", "PSB"],
      ),
    checks: (file, context) => [
      check("PSB received count is 1", statusCount(context.reports, "PSB", "Received") === 1),
      check("PSB pending count is 0", statusCount(context.reports, "PSB", "Pending") === 0),
      check("PSB received clicker matches", matches(file, "statusSummary:PSB:Received")),
      check("Month-wise BG expiry Dec PSB is 1", monthlyHas(context.reports.monthWiseBgExpiry, "2026-12", "psb", 1)),
    ],
  },
  {
    name: "08 Material received",
    mutate: (payload) =>
      withOrderCompleted(
        withOrder(payload, {
          materialReceiptDate: "2026-07-20",
          currentMilestone: "IR Preparation",
        }),
        ["Financial Sanction", "Supply Order", "Delivery Period", "PSB", "Delivery"],
      ),
    checks: (file, context) => [
      check("Delivery completed count is 1", statusCount(context.reports, "Delivery", "Completed") === 1),
      check("PWB pending starts after material receipt", statusCount(context.reports, "PWB", "Pending") === 1),
      check("IR Preparation pending clicker matches", matches(file, "irPreparationPending")),
      check("Payment pending starts after material receipt", statusCount(context.reports, "Payment", "Pending") === 1),
      check("Payment pending clicker matches", matches(file, "statusSummary:Payment:Pending")),
      check("Month-wise D.P. net becomes 0 after delivery", monthlyHas(context.reports.monthWiseDeliverySchedule, "2026-08", "netCount", 0)),
    ],
  },
  {
    name: "09 PWB received",
    mutate: (payload) =>
      withOrderCompleted(
        withOrder(payload, {
          pwbBgNo: "QA-PWB-001",
          pwbBgAmount: "1000",
          pwbBgReceivedDate: "2026-07-21",
          pwbBgValidityDate: "2027-07-21",
        }),
        ["Financial Sanction", "Supply Order", "Delivery Period", "PSB", "Delivery", "PWB"],
      ),
    checks: (_file, context) => [
      check("PWB received count is 1", statusCount(context.reports, "PWB", "Received") === 1),
      check("PWB pending count is 0", statusCount(context.reports, "PWB", "Pending") === 0),
      check("Month-wise BG expiry Jul 2027 PWB is 1", monthlyHas(context.reports.monthWiseBgExpiry, "2027-07", "pwb", 1)),
    ],
  },
  {
    name: "10 IR preparation date filled",
    mutate: (payload) =>
      withOrderCompleted(
        withOrder(payload, {
          irPreparationDate: "2026-07-22",
          currentMilestone: "IR Receipt",
        }),
        [
          "Financial Sanction",
          "Supply Order",
          "Delivery Period",
          "PSB",
          "Delivery",
          "PWB",
          "IR Preparation",
        ],
      ),
    checks: (file) => [
      check("IR Preparation done", completed(order(file), "IR Preparation")),
      check("IR Receipt pending clicker matches", matches(file, "irReceiptPending")),
    ],
  },
  {
    name: "11 IR receipt date filled, PSB return due",
    mutate: (payload) =>
      withOrderCompleted(
        withOrder(payload, {
          irReceiptDate: "2026-07-23",
          currentMilestone: "Bill preparation",
        }),
        [
          "Financial Sanction",
          "Supply Order",
          "Delivery Period",
          "PSB",
          "Delivery",
          "PWB",
          "IR Preparation",
          "IR Receipt",
        ],
      ),
    checks: (file, context) => [
      check("IR completed clicker matches", matches(file, "irCompleted")),
      check("PSB to be returned count is 1", statusCount(context.reports, "PSB", "To be returned") === 1),
      check("PSB to be returned clicker matches", matches(file, "statusSummary:PSB:To%20be%20returned")),
    ],
  },
  {
    name: "12 PSB returned",
    mutate: (payload) =>
      withOrder(payload, {
        psbBgReturnDate: "2026-07-24",
      }),
    checks: (file, context) => [
      check("PSB returned count is 1", statusCount(context.reports, "PSB", "Returned") === 1),
      check("PSB returned clicker matches", matches(file, "statusSummary:PSB:Returned")),
      check("PSB to be returned is now 0", statusCount(context.reports, "PSB", "To be returned") === 0),
    ],
  },
  {
    name: "13 Bill preparation date filled",
    mutate: (payload) =>
      withOrderCompleted(
        withOrder(payload, {
          billPreparationDate: "2026-07-25",
          currentMilestone: "Bill sent for payment",
        }),
        [
          "Financial Sanction",
          "Supply Order",
          "Delivery Period",
          "PSB",
          "Delivery",
          "PWB",
          "IR Preparation",
          "IR Receipt",
          "Bill preparation",
        ],
      ),
    checks: (file, context) => [
      check("Bill preparation done", completed(order(file), "Bill preparation")),
      check("Bill sent pending clicker matches", matches(file, "statusSummary:Bill%20sent%20for%20payment:Pending")),
      check("Payment still pending", statusCount(context.reports, "Payment", "Pending") === 1),
    ],
  },
  {
    name: "14 Bill sent for payment date filled",
    mutate: (payload) =>
      withOrderCompleted(
        withOrder(payload, {
          billSentForPaymentDate: "2026-07-26",
          currentMilestone: "Payment",
        }),
        [
          "Financial Sanction",
          "Supply Order",
          "Delivery Period",
          "PSB",
          "Delivery",
          "PWB",
          "IR Preparation",
          "IR Receipt",
          "Bill preparation",
          "Bill sent for payment",
        ],
      ),
    checks: (file, context) => [
      check("Bill sent done", completed(order(file), "Bill sent for payment")),
      check("Payment pending remains 1", statusCount(context.reports, "Payment", "Pending") === 1),
      check("Reports bill-sent rows populated", context.reports.billSentForPaymentRows.length === 1),
    ],
  },
  {
    name: "15 Payment date filled",
    mutate: (payload) =>
      withOrderCompleted(
        withOrder(payload, {
          paymentDate: "2026-07-30",
          actualPaymentCapital: "10000",
          currentMilestone: "",
        }),
        [
          "Financial Sanction",
          "Supply Order",
          "Delivery Period",
          "PSB",
          "Delivery",
          "PWB",
          "IR Preparation",
          "IR Receipt",
          "Bill preparation",
          "Bill sent for payment",
          "Payment",
        ],
      ),
    checks: (file, context) => [
      check("Payment completed count is 1", statusCount(context.reports, "Payment", "Completed") === 1),
      check("Payment pending count is 0", statusCount(context.reports, "Payment", "Pending") === 0),
      check("Payment completed clicker matches", matches(file, "statusSummary:Payment:Completed")),
      ...financeCheck(context, { spentCapital: 10000, paidCapital: 10000 }),
      check("Actual cash outgo rows populated", context.reports.actualCashOutgoRows.length === 1),
    ],
  },
];

async function getAdminUserId() {
  const result = await pool.query<{ id: string }>(
    "select id from app_users where username = 'ovais' and role = 'admin' and is_active = true limit 1",
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Active admin user 'ovais' not found.");
  return id;
}

async function cleanupQaFiles() {
  await pool.query("delete from files where unique_code like 'QA-HUMAN-WORKFLOW-%'");
}

async function loadSettings(): Promise<AppSettings> {
  const settings = await pool.query<{
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
  }>(
    `select financial_year, selected_year, year_selection_locked, theme, theme_tint, deletion_password,
            tcec_committees, firm_types, file_types, modes, milestones, table_field_presets
     from app_settings
     where id = true`,
  );
  const row = settings.rows[0];
  if (!row) throw new Error("Settings not found.");
  const parseArray = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  return {
    financialYear: row.financial_year,
    selectedYear: row.selected_year,
    financialYears: [row.financial_year, row.selected_year].filter(Boolean),
    yearSelectionLocked: row.year_selection_locked,
    theme: row.theme,
    themeTint: row.theme_tint,
    deletionPassword: row.deletion_password,
    tcecCommittees: parseArray(row.tcec_committees),
    firmTypes: parseArray(row.firm_types),
    fileTypes: parseArray(row.file_types),
    modes: parseArray(row.modes),
    valueThresholdLevels: [],
    milestones: parseArray(row.milestones),
    tableFieldPresets: Array.isArray(row.table_field_presets) ? row.table_field_presets : [],
  };
}

async function loadDivisions(): Promise<Division[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    code: string | null;
    allocated_capital: string | null;
    allocated_revenue: string | null;
    ad: string | null;
  }>(
    `select id, name, code, allocated_capital, allocated_revenue, ad
     from divisions
     where archived_at is null
     order by name asc`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code ?? undefined,
    allocatedCapital: row.allocated_capital ?? undefined,
    allocatedRevenue: row.allocated_revenue ?? undefined,
    ad: row.ad ?? undefined,
  }));
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie: `recordkeeper_session=${encodeURIComponent(token)}`,
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => undefined)) as T | { error?: string } | undefined;
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed ${response.status}: ${(body as { error?: string } | undefined)?.error ?? "unknown error"}`);
  }
  return body as T;
}

async function savePayload(
  payload: Record<string, unknown>,
  token: string,
  fileId: string | undefined,
) {
  const result = await api<{ file: FileRecord }>(
    fileId ? `/api/files/${fileId}` : "/api/files",
    token,
    {
      method: fileId ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    },
  );
  return result.file;
}

async function buildContext(file: FileRecord): Promise<SummaryContext> {
  const settings = await loadSettings();
  const divisions = await loadDivisions();
  return {
    dashboard: buildDashboardSummary({ files: [file], divisions, settings, division: DIVISION }),
    reports: buildReportsSummary({
      files: [file],
      division: "all",
      delayDays: 5,
      delayMilestone: "all",
      expectedCashOutgoDays: 0,
    }),
  };
}

function printStep(name: string, checks: Check[]) {
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${failed.length ? "FAIL" : "PASS"} ${name}`);
  for (const item of checks) {
    console.log(`  ${item.ok ? "✓" : "✗"} ${item.label}${item.detail ? ` (${item.detail})` : ""}`);
  }
}

async function main() {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required.");
  await cleanupQaFiles();
  const token = await saveUserSession(await getAdminUserId());
  let payload: Record<string, unknown> = makeBasePayload();
  let fileId: string | undefined;
  const failures: Array<{ step: string; check: Check }> = [];
  let totalChecks = 0;

  try {
    for (const step of steps) {
      payload = step.mutate(payload);
      const saved = await savePayload(payload, token, fileId);
      fileId = saved.id;
      const context = await buildContext(saved);
      const checks = step.checks(saved, context);
      totalChecks += checks.length;
      printStep(step.name, checks);
      failures.push(...checks.filter((check) => !check.ok).map((check) => ({ step: step.name, check })));
    }

    console.log(`\nQA file retained: ${QA_CODE}`);
    console.log(`Total checks: ${totalChecks}`);
    console.log(`Failures: ${failures.length}`);
    if (failures.length) {
      console.log("\nFailures:");
      for (const failure of failures) {
        console.log(`- ${failure.step}: ${failure.check.label}${failure.check.detail ? ` (${failure.check.detail})` : ""}`);
      }
      process.exitCode = 1;
    }
  } finally {
    await deleteSession(token);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
