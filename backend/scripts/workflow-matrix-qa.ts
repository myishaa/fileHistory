import { pool } from "../src/db/pool.js";
import { saveUserSession, deleteSession } from "../src/utils/auth.js";
import { buildDashboardSummary } from "../src/utils/dashboard-summary.js";
import { searchFiles } from "../src/utils/file-search.js";
import { buildReportsSummary } from "../src/utils/report-summary.js";
import { loadFiles } from "../src/routes/files.js";
import type { AppSettings, Division, FileRecord, SupplyOrderDetail } from "../src/types.js";

const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const QA_PREFIX = "QA-MATRIX-WORKFLOW";
const YEAR = "2026-27";
const DIVISION = "ACC";

type Check = { label: string; ok: boolean; detail?: string };
type Context = {
  dashboard: ReturnType<typeof buildDashboardSummary>;
  reports: ReturnType<typeof buildReportsSummary>;
};
type ScenarioStep = {
  name: string;
  payload: Record<string, unknown>;
  checks: (file: FileRecord, context: Context) => Check[];
};
type Scenario = {
  name: string;
  code: string;
  steps: ScenarioStep[];
};

function n(value: unknown) {
  return Number(value ?? 0);
}

function check(label: string, ok: boolean, detail?: unknown): Check {
  return { label, ok, detail: detail === undefined ? undefined : String(detail) };
}

function normalizeMilestone(value: string | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function completed(order: SupplyOrderDetail, milestone: string) {
  const key = normalizeMilestone(milestone);
  return order.completedMilestones?.some((item) => normalizeMilestone(item) === key) ?? false;
}

function order(file: FileRecord, index = 0) {
  const row = file.supplyOrders?.[index];
  if (!row) throw new Error(`${file.uniqueCode}: missing supply order ${index + 1}`);
  return row;
}

function statusCount(context: Context, milestone: string, column: string) {
  for (const group of context.reports.statusSummaryGroups) {
    const row = group.rows.find((item) => item.milestone === milestone);
    const value = row?.counts[column];
    if (typeof value === "number") return value;
  }
  return 0;
}

function matches(file: FileRecord, dashboardFilter: string) {
  return searchFiles([file], { dashboardFilter } as Parameters<typeof searchFiles>[1]).length === 1;
}

function monthValue(
  rows: Array<{ monthKey: string } & Record<string, unknown>>,
  monthKey: string,
  key: string,
) {
  return Number(rows.find((row) => row.monthKey === monthKey)?.[key] ?? 0);
}

function base(code: string, patch: Record<string, unknown> = {}) {
  return {
    title: code,
    uniqueCode: code,
    fileNo: code,
    division: DIVISION,
    year: YEAR,
    activeYears: [YEAR],
    receivedDate: "2026-07-01",
    date: "2026-07-01",
    indentor: "QA Matrix Indentor",
    demandDescription: `${code} matrix QA`,
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
    bg: "No",
    psb: "No",
    ir: "No",
    rfpVetting: "No",
    demandCancelled: "No",
    currentMilestone: "Financial Sanction",
    completedMilestones: ["Scrutiny", "Controlling", "CFA"],
    noOfSo: "1",
    supplyOrders: [],
    ...patch,
  };
}

function so(patch: Partial<SupplyOrderDetail> = {}): SupplyOrderDetail {
  return {
    financialSanctionDate: "2026-07-05",
    currentMilestone: "Delivery",
    completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period"],
    psbApplicable: "No",
    bgCoverageType: "None",
    soNo: "QA-SO",
    soDate: "2026-07-10",
    soValueCapital: "10000",
    firm: "QA Firm",
    firmType: "MSME",
    dpDate: "2026-08-15",
    stageDelivery: "No",
    stagePayment: "No",
    advancePayment: "No",
    paymentMode: "Online",
    ...patch,
  };
}

function withOrders(payload: Record<string, unknown>, orders: SupplyOrderDetail[]) {
  return { ...payload, noOfSo: String(orders.length), supplyOrders: orders };
}

function scenarios(): Scenario[] {
  const pwbCode = `${QA_PREFIX}-PWB-ONLY`;
  const combinedCode = `${QA_PREFIX}-COMBINED`;
  const amcCode = `${QA_PREFIX}-AMC-DP`;
  const stageCode = `${QA_PREFIX}-STAGE-PAY`;
  const advanceCode = `${QA_PREFIX}-ADVANCE`;
  const multiSoCode = `${QA_PREFIX}-MULTI-SO`;

  return [
    {
      name: "PWB only, warranty after material receipt",
      code: pwbCode,
      steps: [
        {
          name: "PWB applicable before receipt",
          payload: withOrders(
            base(pwbCode, { bg: "Yes", ir: "No" }),
            [
              so({
                bgCoverageType: "PWB",
              }),
            ],
          ),
          checks: (file, context) => [
            check("PWB total applicable", statusCount(context, "PWB", "Received") + statusCount(context, "PWB", "Pending") === 0),
            check("PWB pending not before material receipt", statusCount(context, "PWB", "Pending") === 0),
            check("Payment not pending before material receipt", statusCount(context, "Payment", "Pending") === 0),
            check("Warranty snapshot matches", matches(file, "attribute:bg:yes")),
          ],
        },
        {
          name: "PWB and payment pending after receipt",
          payload: withOrders(
            base(pwbCode, { bg: "Yes", ir: "No" }),
            [
              so({
                bgCoverageType: "PWB",
                materialReceiptDate: "2026-07-20",
                completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period", "Delivery"],
                currentMilestone: "Payment",
              }),
            ],
          ),
          checks: (file, context) => [
            check("PWB pending after material receipt", statusCount(context, "PWB", "Pending") === 1),
            check("PWB pending clicker matches", matches(file, "statusSummary:PWB:Pending")),
            check("Payment pending after material receipt", statusCount(context, "Payment", "Pending") === 1),
          ],
        },
        {
          name: "PWB received and payment paid",
          payload: withOrders(
            base(pwbCode, { bg: "Yes", ir: "No" }),
            [
              so({
                bgCoverageType: "PWB",
                materialReceiptDate: "2026-07-20",
                pwbBgNo: "PWB-ONLY-1",
                pwbBgAmount: "1000",
                pwbBgReceivedDate: "2026-07-21",
                pwbBgValidityDate: "2027-07-21",
                billPreparationDate: "2026-07-22",
                billSentForPaymentDate: "2026-07-23",
                paymentDate: "2026-07-30",
                actualPaymentCapital: "10000",
                completedMilestones: [
                  "Financial Sanction",
                  "Supply Order",
                  "Delivery Period",
                  "Delivery",
                  "PWB",
                  "Bill preparation",
                  "Bill sent for payment",
                  "Payment",
                ],
                currentMilestone: "",
              }),
            ],
          ),
          checks: (_file, context) => [
            check("PWB received count", statusCount(context, "PWB", "Received") === 1),
            check("Payment completed count", statusCount(context, "Payment", "Completed") === 1),
            check("Finance paid capital", n(context.dashboard.financeTotals.paidCapital) === 10000, context.dashboard.financeTotals.paidCapital),
            check("BG expiry PWB month", monthValue(context.reports.monthWiseBgExpiry, "2027-07", "pwb") === 1),
          ],
        },
      ],
    },
    {
      name: "Combined PSB+PWB can be received before S.O.",
      code: combinedCode,
      steps: [
        {
          name: "Combined BG received before S.O. date",
          payload: withOrders(
            base(combinedCode, { bg: "Yes", ir: "No" }),
            [
              {
                financialSanctionDate: "2026-07-05",
                currentMilestone: "Supply Order",
                completedMilestones: ["Financial Sanction", "PSB+PWB"],
                psbApplicable: "No",
                bgCoverageType: "PSB+PWB",
                combinedBgNo: "COMBINED-1",
                combinedBgAmount: "1000",
                combinedBgReceivedDate: "2026-07-06",
                combinedBgValidityDate: "2026-07-15",
              },
            ],
          ),
          checks: (file, context) => [
            check("Combined received before S.O. saved", order(file).combinedBgReceivedDate === "2026-07-06"),
            check("PSB+PWB received count", statusCount(context, "PSB+PWB", "Received") === 1),
            check("PSB+PWB pending zero", statusCount(context, "PSB+PWB", "Pending") === 0),
            check("Supply Order still pending", statusCount(context, "Supply Order", "Pending") === 1),
          ],
        },
        {
          name: "Combined BG return due after payment and expired validity",
          payload: withOrders(
            base(combinedCode, { bg: "Yes", ir: "No" }),
            [
              so({
                bgCoverageType: "PSB+PWB",
                combinedBgNo: "COMBINED-1",
                combinedBgAmount: "1000",
                combinedBgReceivedDate: "2026-07-06",
                combinedBgValidityDate: "2026-07-15",
                materialReceiptDate: "2026-07-20",
                billPreparationDate: "2026-07-22",
                billSentForPaymentDate: "2026-07-23",
                paymentDate: "2026-07-30",
                actualPaymentCapital: "10000",
                completedMilestones: [
                  "Financial Sanction",
                  "Supply Order",
                  "Delivery Period",
                  "PSB+PWB",
                  "Delivery",
                  "Bill preparation",
                  "Bill sent for payment",
                  "Payment",
                ],
              }),
            ],
          ),
          checks: (file, context) => [
            check("PSB+PWB to be returned count", statusCount(context, "PSB+PWB", "To be returned") === 1),
            check("PSB+PWB return clicker matches", matches(file, "statusSummary:PSB%2BPWB:To%20be%20returned")),
          ],
        },
      ],
    },
    {
      name: "AMC payment starts after D.P. expiry",
      code: amcCode,
      steps: [
        {
          name: "AMC D.P. expired, no material receipt",
          payload: withOrders(
            base(amcCode, { fileType: "AMC", bg: "No", ir: "No" }),
            [
              so({
                soNo: "AMC-SO",
                dpDate: "2026-07-15",
                currentMilestone: "Payment",
              }),
            ],
          ),
          checks: (file, context) => [
            check("Payment pending from expired D.P.", statusCount(context, "Payment", "Pending") === 1),
            check("Payment pending clicker matches", matches(file, "statusSummary:Payment:Pending")),
            check("Delivery not counted for AMC", statusCount(context, "Delivery", "Pending") === 0),
            check("D.P. expired count", statusCount(context, "Delivery Period", "Expired") === 1),
          ],
        },
      ],
    },
    {
      name: "Multiple deliveries with stage payments",
      code: stageCode,
      steps: [
        {
          name: "Two staged deliveries, one paid and one pending payment",
          payload: withOrders(
            base(stageCode, { bg: "No", ir: "No" }),
            [
              so({
                soValueCapital: "20000",
                stageDelivery: "Yes",
                stagePayment: "Yes",
                advancePayment: "No",
                stageDeliveryCount: "2",
                stageDeliveries: [
                  {
                    stageAmountCapital: "8000",
                    deliveryPeriodStartDate: "2026-07-10",
                    dpDate: "2026-07-20",
                    materialReceiptDate: "2026-07-18",
                    billPreparationDate: "2026-07-19",
                    billSentForPaymentDate: "2026-07-20",
                    paymentDate: "2026-07-25",
                    actualPaymentCapital: "8000",
                    completedMilestones: ["Delivery", "Bill preparation", "Bill sent for payment", "Payment"],
                  },
                  {
                    stageAmountCapital: "12000",
                    deliveryPeriodStartDate: "2026-07-21",
                    dpDate: "2026-08-15",
                    materialReceiptDate: "2026-07-28",
                    billPreparationDate: "2026-07-29",
                    currentMilestone: "Bill sent for payment",
                    completedMilestones: ["Delivery", "Bill preparation"],
                  },
                ],
              }),
            ],
          ),
          checks: (file, context) => [
            check("Two delivery stages completed", statusCount(context, "Delivery", "Completed") === 2),
            check("Payment completed one stage", statusCount(context, "Payment", "Completed") === 1),
            check("Payment pending second stage", statusCount(context, "Payment", "Pending") === 1),
            check("Bill sent pending clicker matches staged row", matches(file, "statusSummary:Bill%20sent%20for%20payment:Pending")),
            check("Finance paid capital stage one", n(context.dashboard.financeTotals.paidCapital) === 8000, context.dashboard.financeTotals.paidCapital),
            check("Finance spent capital full S.O.", n(context.dashboard.financeTotals.spentCapital) === 20000, context.dashboard.financeTotals.spentCapital),
          ],
        },
      ],
    },
    {
      name: "Advance payment with staged delivery",
      code: advanceCode,
      steps: [
        {
          name: "Advance payment pending",
          payload: withOrders(
            base(advanceCode, { bg: "No", ir: "No" }),
            [
              so({
                soValueCapital: "30000",
                stageDelivery: "Yes",
                stagePayment: "Yes",
                advancePayment: "Yes",
                stageDeliveryCount: "2",
                advancePaymentDetail: {
                  currentMilestone: "Advance Payment",
                  stageAmountCapital: "5000",
                  billPreparationDate: "2026-07-12",
                  billSentForPaymentDate: "2026-07-13",
                },
                stageDeliveries: [
                  { stageAmountCapital: "10000", dpDate: "2026-08-01" },
                  { stageAmountCapital: "20000", dpDate: "2026-09-01" },
                ],
              }),
            ],
          ),
          checks: (file, context) => [
            check("Advance pending count", statusCount(context, "Advance Payment", "Pending") === 1),
            check("Advance pending clicker matches", matches(file, "advancePending")),
            check("Finance advance capital planned", n(context.dashboard.financeTotals.advanceCapital) === 5000, context.dashboard.financeTotals.advanceCapital),
          ],
        },
        {
          name: "Advance payment paid",
          payload: withOrders(
            base(advanceCode, { bg: "No", ir: "No" }),
            [
              so({
                soValueCapital: "30000",
                stageDelivery: "Yes",
                stagePayment: "Yes",
                advancePayment: "Yes",
                stageDeliveryCount: "2",
                advancePaymentDetail: {
                  completedMilestones: ["Advance Payment"],
                  stageAmountCapital: "5000",
                  billPreparationDate: "2026-07-12",
                  billSentForPaymentDate: "2026-07-13",
                  paymentDate: "2026-07-14",
                  actualPaymentCapital: "5000",
                },
                stageDeliveries: [
                  { stageAmountCapital: "10000", dpDate: "2026-08-01" },
                  { stageAmountCapital: "20000", dpDate: "2026-09-01" },
                ],
              }),
            ],
          ),
          checks: (file, context) => [
            check("Advance completed count", statusCount(context, "Advance Payment", "Completed") === 1),
            check("Advance paid clicker matches", matches(file, "advancePaid")),
            check("Finance paid capital excludes separate advance bucket", n(context.dashboard.financeTotals.paidCapital) === 0, context.dashboard.financeTotals.paidCapital),
            check("Finance advance capital remains 5000", n(context.dashboard.financeTotals.advanceCapital) === 5000, context.dashboard.financeTotals.advanceCapital),
          ],
        },
      ],
    },
    {
      name: "Multiple S.O.s with different BG combinations",
      code: multiSoCode,
      steps: [
        {
          name: "Two S.O.s: PSB-only and combined",
          payload: withOrders(
            base(multiSoCode, { bg: "Yes", ir: "Yes", valueCapital: "25000" }),
            [
              so({
                soNo: "MSO-1",
                soValueCapital: "10000",
                psbApplicable: "Yes",
                bgCoverageType: "PSB",
                psbBgReceivedDate: "2026-07-11",
                psbBgValidityDate: "2026-12-31",
                completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period", "PSB"],
              }),
              so({
                soNo: "MSO-2",
                soValueCapital: "15000",
                dpDate: "2026-09-15",
                bgCoverageType: "PSB+PWB",
                combinedBgReceivedDate: "2026-07-12",
                combinedBgValidityDate: "2027-01-31",
                completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period", "PSB+PWB"],
              }),
            ],
          ),
          checks: (file, context) => [
            check("Multiple SO misc clicker matches", matches(file, "miscMultipleSupplyOrders")),
            check("Supply Order placed count two", statusCount(context, "Supply Order", "Placed") === 2),
            check("PSB received count one", statusCount(context, "PSB", "Received") === 1),
            check("PSB+PWB received count one", statusCount(context, "PSB+PWB", "Received") === 1),
            check("Month-wise S.O. count two", monthValue(context.reports.monthWiseSupplyOrder, "2026-07", "count") === 2),
            check("Finance spent capital both SOs", n(context.dashboard.financeTotals.spentCapital) === 25000, context.dashboard.financeTotals.spentCapital),
          ],
        },
      ],
    },
  ];
}

async function getAdminUserId() {
  const result = await pool.query<{ id: string }>(
    "select id from app_users where username = 'ovais' and role = 'admin' and is_active = true limit 1",
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Active admin user 'ovais' not found.");
  return id;
}

async function cleanupQaFiles() {
  await pool.query("delete from files where unique_code like $1", [`${QA_PREFIX}%`]);
}

async function loadSettings(): Promise<AppSettings> {
  const result = await pool.query<{
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
  const row = result.rows[0];
  if (!row) throw new Error("Settings row not found.");
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    financialYear: row.financial_year,
    selectedYear: row.selected_year,
    financialYears: [row.financial_year, row.selected_year].filter(Boolean),
    yearSelectionLocked: row.year_selection_locked,
    theme: row.theme,
    themeTint: row.theme_tint,
    deletionPassword: row.deletion_password,
    tcecCommittees: strings(row.tcec_committees),
    firmTypes: strings(row.firm_types),
    fileTypes: strings(row.file_types),
    modes: strings(row.modes),
    valueThresholdLevels: [],
    milestones: strings(row.milestones),
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
    throw new Error(
      `${init?.method ?? "GET"} ${path} failed ${response.status}: ${
        (body as { error?: string } | undefined)?.error ?? "unknown error"
      }`,
    );
  }
  return body as T;
}

async function savePayload(payload: Record<string, unknown>, token: string, fileId?: string) {
  const result = await api<{ file: FileRecord }>(fileId ? `/api/files/${fileId}` : "/api/files", token, {
    method: fileId ? "PATCH" : "POST",
    body: JSON.stringify(payload),
  });
  return result.file;
}

async function contextFor(file: FileRecord): Promise<Context> {
  const [settings, divisions] = await Promise.all([loadSettings(), loadDivisions()]);
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

function printStep(scenario: string, step: string, checks: Check[]) {
  const failures = checks.filter((item) => !item.ok);
  console.log(`\n${failures.length ? "FAIL" : "PASS"} ${scenario} / ${step}`);
  for (const item of checks) {
    console.log(`  ${item.ok ? "✓" : "✗"} ${item.label}${item.detail ? ` (${item.detail})` : ""}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  await cleanupQaFiles();
  const token = await saveUserSession(await getAdminUserId());
  const failures: Array<{ scenario: string; step: string; check: Check }> = [];
  let totalChecks = 0;

  try {
    for (const scenario of scenarios()) {
      let fileId: string | undefined;
      for (const step of scenario.steps) {
        const saved = await savePayload(step.payload, token, fileId);
        fileId = saved.id;
        const context = await contextFor(saved);
        const checks = step.checks(saved, context);
        totalChecks += checks.length;
        printStep(scenario.name, step.name, checks);
        failures.push(
          ...checks
            .filter((item) => !item.ok)
            .map((check) => ({ scenario: scenario.name, step: step.name, check })),
        );
      }
    }

    console.log(`\nMatrix scenarios: ${scenarios().length}`);
    console.log(`Total checks: ${totalChecks}`);
    console.log(`Failures: ${failures.length}`);
    if (failures.length) {
      console.log("\nFailures:");
      for (const failure of failures) {
        console.log(`- ${failure.scenario} / ${failure.step}: ${failure.check.label}${failure.check.detail ? ` (${failure.check.detail})` : ""}`);
      }
      process.exitCode = 1;
    }
  } finally {
    await deleteSession(token);
    await cleanupQaFiles();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
