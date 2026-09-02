import { expect, test, type Page } from "@playwright/test";

import { pool } from "../../backend/src/db/pool.js";
import { deleteSession, saveUserSession } from "../../backend/src/utils/auth.js";
import type { FileRecord, SupplyOrderDetail } from "../../backend/src/types.js";

const API_BASE_URL = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:3000";
const QA_USERNAME = "qa_refloat_status";
const QA_PASSWORD = "qa_refloat_status123";
const QA_PREFIX = "QA-REFLOAT-STATUS";

async function cleanupQaFiles() {
  await pool.query("delete from files where unique_code like $1", [`${QA_PREFIX}%`]);
}

async function ensureQaUser() {
  const result = await pool.query<{ id: string }>(
    `insert into app_users (name, username, role, password_hash, is_active)
     values ('Refloat Status QA', $1, 'admin', crypt($2, gen_salt('bf')), true)
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
  if (!id) throw new Error("Failed to create refloat QA user.");
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

function baseOrder(code: string): SupplyOrderDetail {
  return {
    financialSanctionDate: "2026-07-05",
    currentMilestone: "Payment",
    completedMilestones: ["Financial Sanction", "Supply Order", "Delivery Period", "Delivery"],
    psbApplicable: "No",
    bgCoverageType: "None",
    soNo: `${code}-SO-1`,
    gemSoNo: `${code}-GEM-1`,
    soDate: "2026-07-10",
    soValueCapital: "10000",
    firm: "Refloat Browser QA Firm",
    firmType: "MSME",
    dpDate: "2026-07-15",
    materialReceiptDate: "2026-07-20",
    billPreparationDate: "2026-07-21",
    billSentForPaymentDate: "2026-07-22",
    stageDelivery: "No",
    stagePayment: "No",
    advancePayment: "No",
    paymentMode: "Online",
  };
}

async function seedFile(
  token: string,
  year: string,
  code: string,
  patch: Partial<FileRecord>,
  orderPatch?: Partial<SupplyOrderDetail>,
) {
  await api<{ file: FileRecord }>("/api/files", token, {
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
      indentor: "Refloat Browser QA",
      demandDescription: `${code} browser status visibility QA`,
      valueCapital: "10000",
      valueRevenue: "",
      currency: "INR",
      exchangeRate: "1",
      fileType: "Goods & Services",
      mode: "PBM",
      gem: "Yes",
      gte: "No",
      tcec: "Yes",
      highValue: "No",
      ad: "No",
      rqa: "No",
      ifa: "No",
      bg: "No",
      psb: "No",
      ir: "No",
      rfpVetting: "No",
      demandCancelled: "No",
      currentMilestone: "Refloat bidding",
      completedMilestones: [
        "Scrutiny",
        "Controlling",
        "CFA",
        "Bidding",
        "Pre-TCEC",
        "Post-TCEC",
      ],
      noOfSo: "1",
      supplyOrders: [{ ...baseOrder(code), ...(orderPatch ?? {}) }],
      ...patch,
    }),
  });
}

test.describe("refloat and returned bill status visibility", () => {
  let browserSessionToken: string;

  test.beforeAll(async () => {
    await cleanupQaFiles();
    const userId = await ensureQaUser();
    const seedToken = await saveUserSession(userId);
    const year = await selectedYear();
    try {
      await api("/api/settings", seedToken, {
        method: "PATCH",
        body: JSON.stringify({ liveStatusLockedFields: ["Bidding", "Payment"] }),
      });
      await seedFile(seedToken, year, `${QA_PREFIX}-REFLOAT-BIDDING`, {
        refloat: "Yes",
        biddingStageOver: "No",
        refloatBiddingDate: "2026-07-25",
      });
      await seedFile(seedToken, year, `${QA_PREFIX}-REFLOAT-POST-TCEC`, {
        currentMilestone: "Refloat Post-TCEC",
        refloat: "Yes",
        biddingStageOver: "Yes",
        refloatBiddingDate: "2026-07-25",
        refloatBidOpeningDate: "2026-07-30",
        refloatPostTcecDate: "2026-08-02",
      });
      await seedFile(
        seedToken,
        year,
        `${QA_PREFIX}-RETURNED-BILL`,
        {
          currentMilestone: "Payment",
          refloat: "No",
          biddingStageOver: "Yes",
          bidOpeningDate: "2026-07-10",
          postTcecDate: "2026-07-12",
          postTcecMinutesDate: "2026-07-15",
          cncDate: "2026-07-16",
          cncApprovalDate: "2026-07-18",
        },
        {
          billReturnCycles: [
            {
              returnedDate: "2026-07-26",
              reason: "Correction needed",
            },
          ],
        },
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

  test("renders refloat and returned bill counters on status tabs", async ({ page }) => {
    test.setTimeout(180_000);
    await authenticate(page, browserSessionToken);

    await page.goto("/dashboard");
    await page.getByTestId("dashboard-tab-status").click();
    await expect(page.getByText("Refloat bidding").first()).toBeVisible();
    await expect(page.getByText("Refloat Post-TCEC").first()).toBeVisible();
    await expect(page.getByText("Bills returned").first()).toBeVisible();

    await page.getByTestId("dashboard-tab-liveStatus").click();
    await expect(page.getByRole("columnheader", { name: "Refloat bidding" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Refloat Post-TCEC" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Bill returned for correction" })).toBeVisible();

    await page.getByTestId("dashboard-tab-status3").click();
    await expect(page.getByTestId("status-counter-refloat-bidding-in-process")).toBeVisible();
    await expect(page.getByTestId("status-counter-refloat-post-tcec-in-process")).toBeVisible();
    await expect(page.getByTestId("status-counter-bill-returned-for-correction-total")).toBeVisible();
    const returnedBillPending = page.getByTestId("status-counter-bill-returned-for-correction-pending");
    await expect(returnedBillPending).toBeVisible();
    await expect(returnedBillPending).not.toHaveText("0");

    await page.getByTestId("dashboard-tab-status4").click();
    await expect(page.getByRole("columnheader", { name: "Refloat bidding" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Refloat Post-TCEC" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Bill returned for correction" })).toHaveCount(0);

    await page.getByTestId("dashboard-tab-status3").click();
    await page.getByTestId("status-counter-refloat-post-tcec-in-process").click();
    await expect(page).toHaveURL(/\/search/);
    await expect(page.getByLabel("Dashboard drill path")).toContainText(
      "DashboardStatus-3Refloat Post-TCECIn processSearch Files",
    );
    await expect(page.getByLabel("Dashboard drill path").getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    await expect(page.getByLabel("Dashboard drill path").getByRole("link", { name: "Status-3" })).toHaveAttribute(
      "href",
      "/dashboard?tab=status3",
    );
  });
});
