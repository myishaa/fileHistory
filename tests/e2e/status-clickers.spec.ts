import { expect, test, type Page } from "@playwright/test";

import { pool } from "../../backend/src/db/pool.js";
import { deleteSession, saveUserSession } from "../../backend/src/utils/auth.js";
import type { FileRecord, SupplyOrderDetail } from "../../backend/src/types.js";

const API_BASE_URL = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:3000";
const QA_USERNAME = "qa_playwright";
const QA_PASSWORD = "qa_playwright123";
const QA_PREFIX = "QA-PLAYWRIGHT-STATUS";
const CASES_PER_COUNTER = 10;

type CounterTarget = {
  name: string;
  testId: string;
  buildOrder: (code: string, index: number) => Partial<SupplyOrderDetail>;
  filePatch?: Record<string, unknown>;
};

type SeededCounterGroup = CounterTarget & {
  files: FileRecord[];
};

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function cleanupQaFiles() {
  await pool.query("delete from files where unique_code like $1", [`${QA_PREFIX}%`]);
}

async function ensureQaUser() {
  const result = await pool.query<{ id: string }>(
    `insert into app_users (name, username, role, password_hash, is_active)
     values ('Playwright QA', $1, 'admin', crypt($2, gen_salt('bf')), true)
     on conflict (username)
     do update set
       name = excluded.name,
       role = excluded.role,
       password_hash = excluded.password_hash,
       is_active = true
     returning id`,
    [QA_USERNAME, QA_PASSWORD],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Failed to create Playwright QA user.");
  return id;
}

async function selectedYear() {
  const result = await pool.query<{ selected_year: string }>(
    "select selected_year from app_settings where id = true",
  );
  const year = result.rows[0]?.selected_year;
  if (!year) throw new Error("Settings selected year not found.");
  return year;
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

function baseOrder(code: string, index: number): SupplyOrderDetail {
  return {
    financialSanctionDate: "2026-07-05",
    currentMilestone: "Delivery",
    completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period"],
    psbApplicable: "No",
    bgCoverageType: "None",
    soNo: `${code}-SO-${index + 1}`,
    gemSoNo: `${code}-GEM-${index + 1}`,
    soDate: "2026-07-10",
    soValueCapital: String(10000 + index * 100),
    firm: `Playwright Firm ${index + 1}`,
    firmType: "MSME",
    dpDate: "2026-08-15",
    stageDelivery: "No",
    stagePayment: "No",
    advancePayment: "No",
    paymentMode: "Online",
  };
}

function mergeOrder(code: string, index: number, patch: Partial<SupplyOrderDetail>) {
  return { ...baseOrder(code, index), ...patch };
}

const counterTargets: CounterTarget[] = [
  {
    name: "Delivery / Pending",
    testId: "status-counter-delivery-pending",
    buildOrder: () => ({
      currentMilestone: "Delivery",
    }),
  },
  {
    name: "Supply Order / Placed",
    testId: "status-counter-supply-order-placed",
    buildOrder: () => ({}),
  },
  {
    name: "Delivery / Completed",
    testId: "status-counter-delivery-completed",
    buildOrder: () => ({
      materialReceiptDate: "2026-07-20",
      completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period", "Delivery"],
    }),
  },
  {
    name: "Payment / Pending",
    testId: "status-counter-payment-pending",
    buildOrder: () => ({
      currentMilestone: "Payment",
      dpDate: "2026-07-15",
      materialReceiptDate: "2026-07-20",
      completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period", "Delivery"],
    }),
  },
  {
    name: "Payment / Completed",
    testId: "status-counter-payment-completed",
    buildOrder: () => ({
      materialReceiptDate: "2026-07-20",
      billPreparationDate: "2026-07-21",
      billSentForPaymentDate: "2026-07-22",
      paymentDate: "2026-07-30",
      actualPaymentCapital: "10000",
      completedMilestones: [
        "Financial Sanction",
        "Supply Order",
        "Delivery Period",
        "Delivery",
        "Bill preparation",
        "Bill sent for payment",
        "Payment",
      ],
    }),
  },
  {
    name: "PSB / Received",
    testId: "status-counter-psb-received",
    filePatch: { bg: "Yes" },
    buildOrder: () => ({
      psbApplicable: "Yes",
      bgCoverageType: "PSB",
      psbBgReceivedDate: "2026-07-11",
      psbBgValidityDate: "2026-12-31",
      completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period", "PSB"],
    }),
  },
  {
    name: "PWB / Pending",
    testId: "status-counter-pwb-pending",
    filePatch: { bg: "Yes" },
    buildOrder: () => ({
      bgCoverageType: "PWB",
      materialReceiptDate: "2026-07-20",
      completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period", "Delivery"],
    }),
  },
  {
    name: "PSB+PWB / Received",
    testId: "status-counter-psb-pwb-received",
    filePatch: { bg: "Yes" },
    buildOrder: () => ({
      bgCoverageType: "PSB+PWB",
      combinedBgReceivedDate: "2026-07-06",
      combinedBgValidityDate: "2027-12-31",
      completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period", "PSB+PWB"],
    }),
  },
  {
    name: "Bill sent for payment / Pending",
    testId: "status-counter-bill-sent-for-payment-pending",
    buildOrder: () => ({
      currentMilestone: "Bill sent for payment",
      materialReceiptDate: "2026-07-20",
      billPreparationDate: "2026-07-21",
      completedMilestones: [
        "Financial Sanction",
        "Supply Order",
        "Delivery Period",
        "Delivery",
        "Bill preparation",
      ],
    }),
  },
  {
    name: "Advance Payment / Pending",
    testId: "status-counter-advance-payment-pending",
    buildOrder: () => ({
      stageDelivery: "Yes",
      stagePayment: "Yes",
      advancePayment: "Yes",
      stageDeliveryCount: "2",
      advancePaymentDetail: {
        currentMilestone: "Advance Payment",
        stageAmountCapital: "2000",
        billPreparationDate: "2026-07-12",
        billSentForPaymentDate: "2026-07-13",
      },
      stageDeliveries: [
        { stageAmountCapital: "4000", dpDate: "2026-08-01" },
        { stageAmountCapital: "6000", dpDate: "2026-09-01" },
      ],
    }),
  },
];

async function seedFile(
  token: string,
  year: string,
  target: CounterTarget,
  targetIndex: number,
  caseIndex: number,
) {
  const code = `${QA_PREFIX}-${String(targetIndex + 1).padStart(2, "0")}-${String(caseIndex + 1).padStart(2, "0")}`;
  const result = await api<{ file: FileRecord }>("/api/files", token, {
    method: "POST",
    body: JSON.stringify({
      title: code,
      uniqueCode: code,
      fileNo: code,
      division: "ACC",
      year,
      activeYears: [year],
      receivedDate: "2026-07-01",
      date: "2026-07-01",
      indentor: "Playwright QA",
      demandDescription: `${code} ${target.name} browser clicker QA`,
      valueCapital: "10000",
      valueRevenue: "",
      currency: "INR",
      exchangeRate: "1",
      fileType: caseIndex % 4 === 0 && target.name.startsWith("Payment / Pending") ? "AMC" : "Goods & Services",
      mode: "PBM",
      gem: "Yes",
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
      supplyOrders: [mergeOrder(code, caseIndex, target.buildOrder(code, caseIndex))],
      ...(target.filePatch ?? {}),
    }),
  });
  return result.file;
}

async function seedCounterGroups(userId: string) {
  const token = await saveUserSession(userId);
  try {
    const year = await selectedYear();
    const groups: SeededCounterGroup[] = [];
    for (const [targetIndex, target] of counterTargets.entries()) {
      const files: FileRecord[] = [];
      for (let caseIndex = 0; caseIndex < CASES_PER_COUNTER; caseIndex += 1) {
        files.push(await seedFile(token, year, target, targetIndex, caseIndex));
      }
      groups.push({ ...target, files });
    }
    return groups;
  } finally {
    await deleteSession(token);
  }
}

async function authenticate(page: Page, token: string) {
  await page.context().addCookies([
    {
      name: "recordkeeper_session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test.describe("dashboard status clickers", () => {
  let counterGroups: SeededCounterGroup[];
  let browserSessionToken: string;

  test.beforeAll(async () => {
    await cleanupQaFiles();
    const userId = await ensureQaUser();
    counterGroups = await seedCounterGroups(userId);
    browserSessionToken = await saveUserSession(userId);
  });

  test.afterAll(async () => {
    await deleteSession(browserSessionToken);
    await cleanupQaFiles();
    await pool.end();
  });

  test("Status-3 counters and Search clickers work for 100 seeded browser cases", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await authenticate(page, browserSessionToken);

    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Search Files" })).toBeVisible();

    let checkedFiles = 0;
    for (const group of counterGroups) {
      await test.step(group.name, async () => {
        await page.goto("/dashboard");
        await page.getByTestId("dashboard-tab-status3").click();
        const counter = page.getByTestId(group.testId);
        await expect(counter).toBeVisible();
        await expect(counter).not.toHaveText("0");
        await counter.click();
        await expect(page).toHaveURL(/\/search/);
        await expect(page.getByTestId("search-results")).toBeVisible();

        for (const file of group.files) {
          const code = file.uniqueCode ?? "";
          await page.getByPlaceholder("Free search").fill(code);
          await expect(page.getByTestId(`search-result-${slug(code)}`)).toBeVisible();
          checkedFiles += 1;
        }
      });
    }

    expect(checkedFiles).toBe(counterTargets.length * CASES_PER_COUNTER);
  });
});
