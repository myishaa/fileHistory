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
  buildSiblingOrder?: (code: string, index: number) => Partial<SupplyOrderDetail>;
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
  const result = await pool.query<{ financial_year: string }>(
    "select financial_year from app_settings where id = true",
  );
  const year = result.rows[0]?.financial_year;
  if (!year) throw new Error("Settings financial year not found.");
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
    noFurtherAction: "No",
    paymentMode: "Online",
  };
}

function mergeOrder(code: string, index: number, patch: Partial<SupplyOrderDetail>) {
  return { ...baseOrder(code, index), ...patch };
}

const counterTargets: CounterTarget[] = [
  {
    name: "Supply Order / Placed",
    testId: "status-counter-supply-order-placed",
    buildOrder: () => ({}),
  },
  {
    name: "Payment / Pending",
    testId: "status-counter-payment-due",
    filePatch: { ir: "Yes" },
    buildOrder: () => ({
      currentMilestone: "Payment",
      dpDate: "2026-07-15",
      materialReceiptDate: "2026-07-20",
      completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period", "Delivery"],
    }),
  },
  {
    name: "Payment / All pending types",
    testId: "status-counter-payment-total-pending",
    filePatch: { ir: "Yes" },
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
    filePatch: { bg: "Yes", ir: "Yes" },
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
    name: "Advance Payment / Pending",
    testId: "status-counter-advance-payment-advance-pending",
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
  const supplyOrders = [mergeOrder(code, caseIndex, target.buildOrder(code, caseIndex))];
  if (target.buildSiblingOrder) {
    supplyOrders.push(
      mergeOrder(code, caseIndex + 1, target.buildSiblingOrder(code, caseIndex)),
    );
  }
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
      noOfSo: String(supplyOrders.length),
      supplyOrders,
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
  let shortclosedPaidFile: FileRecord;
  let browserSessionToken: string;

  test.beforeAll(async () => {
    await cleanupQaFiles();
    const userId = await ensureQaUser();
    counterGroups = await seedCounterGroups(userId);
    const seedToken = await saveUserSession(userId);
    try {
      const year = await selectedYear();
      shortclosedPaidFile = await seedFile(
        seedToken,
        year,
        {
          name: "Payment / Completed shortclosed paid inclusion",
          testId: "status-counter-payment-completed",
          buildOrder: () => ({
            materialReceiptDate: "2026-07-20",
            billPreparationDate: "2026-07-21",
            billSentForPaymentDate: "2026-07-22",
            paymentDate: "2026-07-30",
            paymentMode: "Online",
            actualPaymentCapital: "10000",
            shortclosure: "Yes",
            shortclosureDate: "2026-07-25",
            noFurtherAction: "Yes",
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
        counterTargets.length,
        0,
      );
    } finally {
      await deleteSession(seedToken);
    }
    browserSessionToken = await saveUserSession(userId);
  });

  test.afterAll(async () => {
    await deleteSession(browserSessionToken);
    await cleanupQaFiles();
    await pool.end();
  });

  test(`Status-3 counters and Search clickers work for ${counterTargets.length * CASES_PER_COUNTER} seeded browser cases`, async ({
    page,
  }) => {
    test.setTimeout(360_000);
    await authenticate(page, browserSessionToken);

    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Search Files" })).toBeVisible();
    const seededYear = counterGroups[0]?.files[0]?.year;
    if (!seededYear) throw new Error("Seeded financial year not found.");
    const globalYear = page.getByTestId("global-year-select");
    await globalYear.click();
    await page.getByRole("option", { name: seededYear, exact: true }).click();
    await expect(globalYear).toHaveValue(seededYear);
    await page.goto("/dashboard");
    const fileYear = page.getByTestId("dashboard-file-year-select");
    await fileYear.click();
    const seededFileYearOption = page.getByRole("option", { name: seededYear, exact: true });
    if (await seededFileYearOption.count()) {
      await seededFileYearOption.click();
      await expect(fileYear).toHaveValue(seededYear);
    } else {
      await fileYear.press("Escape");
    }

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
        if (group.name === "Payment / Completed") {
          const shortclosedCode = shortclosedPaidFile.uniqueCode ?? "";
          await page.getByPlaceholder("Free search").fill(shortclosedCode);
          await expect(page.getByTestId(`search-result-${slug(shortclosedCode)}`)).toBeVisible();
        }
      });
    }

    expect(checkedFiles).toBe(counterTargets.length * CASES_PER_COUNTER);
  });

  test("Status-1 BG pending drill-down keeps a file with a received sibling S.O.", async () => {
    const seededYear = counterGroups[0]?.files[0]?.year;
    if (!seededYear) throw new Error("Seeded financial year not found.");

    const target: CounterTarget = {
      name: "PSB+PWB pending with received sibling",
      testId: "status-counter-psb-pwb-pending",
      filePatch: { bg: "Yes" },
      buildOrder: () => ({
        bgCoverageType: "PSB+PWB",
        completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period"],
      }),
      buildSiblingOrder: () => ({
        bgCoverageType: "PSB+PWB",
        combinedBgReceivedDate: "2026-07-11",
        combinedBgValidityDate: "2027-12-31",
        completedMilestones: [
          "Financial Sanction",
          "Supply Order",
          "Delivery Period",
          "PSB+PWB",
        ],
      }),
    };
    const file = await seedFile(
      browserSessionToken,
      seededYear,
      target,
      counterTargets.length + 1,
      0,
    );
    const code = file.uniqueCode ?? "";
    const query = new URLSearchParams({
      selectedYear: "__all_files__",
      dashboardFilter: "milestonePending:psbPwb",
      description: code,
      pageSize: "500",
    });
    const results = await api<{ files: FileRecord[]; total: number }>(
      `/api/files/search?${query.toString()}`,
      browserSessionToken,
    );

    expect(results.total).toBe(1);
    expect(results.files.some((result) => result.uniqueCode === code)).toBe(true);
  });

  test("Snapshot PSB clickers exclude a cancelled-only PSB S.O.", async () => {
    const seededYear = counterGroups[0]?.files[0]?.year;
    if (!seededYear) throw new Error("Seeded financial year not found.");

    const target: CounterTarget = {
      name: "Cancelled PSB S.O.",
      testId: "snapshot-psb-cancelled-so",
      buildOrder: () => ({
        psbApplicable: "Yes",
        bgCoverageType: "PSB",
        soCancelled: "Yes",
        soCancelledDate: "2026-07-15",
      }),
    };
    const file = await seedFile(
      browserSessionToken,
      seededYear,
      target,
      counterTargets.length + 2,
      0,
    );
    const code = file.uniqueCode ?? "";
    const searchAttribute = async (value: "yes" | "no") => {
      const query = new URLSearchParams({
        selectedYear: "__all_files__",
        dashboardFilter: `attribute:psb:${value}`,
        description: code,
        pageSize: "500",
      });
      return api<{ files: FileRecord[]; total: number }>(
        `/api/files/search?${query.toString()}`,
        browserSessionToken,
      );
    };
    const [yesResults, noResults] = await Promise.all([
      searchAttribute("yes"),
      searchAttribute("no"),
    ]);
    const psbSearch = await api<{ files: FileRecord[]; total: number }>(
      `/api/files/search?${new URLSearchParams({
        selectedYear: "__all_files__",
        description: code,
        psbFilter: "true",
        pageSize: "500",
      }).toString()}`,
      browserSessionToken,
    );

    expect(yesResults.total).toBe(0);
    expect(noResults.total).toBe(1);
    expect(noResults.files.some((result) => result.uniqueCode === code)).toBe(true);
    expect(psbSearch.total).toBe(0);
  });
});
