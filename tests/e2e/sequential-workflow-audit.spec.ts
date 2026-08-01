import { expect, test, type Page } from "@playwright/test";

import { pool } from "../../backend/src/db/pool.js";
import { deleteSession, saveUserSession } from "../../backend/src/utils/auth.js";

const QA_USERNAME = "qa_playwright";
const QA_PASSWORD = "qa_playwright123";
const QA_PREFIX = "QA-PLAYWRIGHT-SEQAUDIT";

type BgCoverage = "None" | "PSB" | "PWB" | "PSB+PWB" | "PSB and PWB separately";

type OrderScenario = {
  bgCoverage?: BgCoverage;
  completePayment?: boolean;
  ir?: "Yes" | "No";
  stageDelivery?: boolean;
  stagePayment?: boolean;
  advancePayment?: boolean;
};

type AuditScenario = {
  fileType: string;
  warranty: "Yes" | "No";
  ir: "Yes" | "No";
  orders: OrderScenario[];
};

type CounterSnapshot = Record<string, number>;

const scenarios: AuditScenario[] = [
  {
    fileType: "Goods & Services",
    warranty: "No",
    ir: "No",
    orders: [{}],
  },
  {
    fileType: "Goods & Services",
    warranty: "No",
    ir: "Yes",
    orders: [{ ir: "Yes" }],
  },
  {
    fileType: "Goods & Services",
    warranty: "Yes",
    ir: "Yes",
    orders: [{ bgCoverage: "PSB", ir: "Yes" }],
  },
  {
    fileType: "Goods & Services",
    warranty: "Yes",
    ir: "No",
    orders: [{ bgCoverage: "PWB" }],
  },
  {
    fileType: "Goods & Services",
    warranty: "Yes",
    ir: "No",
    orders: [{ bgCoverage: "PSB+PWB" }],
  },
  {
    fileType: "MPC",
    warranty: "No",
    ir: "No",
    orders: [{}],
  },
  {
    fileType: "Goods & Services",
    warranty: "No",
    ir: "No",
    orders: [{ stageDelivery: true }],
  },
  {
    fileType: "Goods & Services",
    warranty: "No",
    ir: "No",
    orders: [
      { stageDelivery: true, stagePayment: true },
      { completePayment: true },
    ],
  },
  {
    fileType: "Goods & Services",
    warranty: "No",
    ir: "No",
    orders: [{ stageDelivery: true, stagePayment: true, advancePayment: true }],
  },
  {
    fileType: "AMC",
    warranty: "No",
    ir: "No",
    orders: [{}],
  },
];

const counterIds = [
  "status-counter-financial-sanction-completed",
  "status-counter-supply-order-placed",
  "status-counter-delivery-period-completed",
  "status-counter-delivery-completed",
  "status-counter-payment-pending",
  "status-counter-payment-completed",
  "status-counter-psb-received",
  "status-counter-pwb-received",
  "status-counter-psb-pwb-received",
  "status-counter-advance-payment-pending",
] as const;

async function cleanupQaFiles() {
  await pool.query(
    "delete from files where unique_code like $1 or file_no like $1 or demand_description like $1",
    [`${QA_PREFIX}%`],
  );
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

async function clickRadio(page: Page, testIdBase: string, value: "Yes" | "No") {
  await page.getByTestId(`${testIdBase}-${value.toLowerCase()}`).check({ force: true });
}

async function fillDate(page: Page, testId: string, value: string) {
  const field = page.getByTestId(testId);
  await field.fill("");
  await field.fill(value);
}

async function openSupplyOrder(page: Page, index: number) {
  const card = page.getByTestId(`add-supply-order-${index}`);
  const isOpen = await card.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!isOpen) await card.locator("summary").click();
}

async function openStage(page: Page, orderIndex: number, stageIndex: number) {
  const card = page.getByTestId(`add-supply-order-${orderIndex}-stage-${stageIndex}`);
  const isOpen = await card.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!isOpen) await card.locator("summary").click();
}

async function fillFileDetails(page: Page, code: string, scenario: AuditScenario) {
  await page.getByTestId("add-section-file-details").click();
  await page.getByTestId("add-field-division").fill("ACC");
  await page.getByTestId("add-field-indentor").fill("Playwright Operator");
  await page.getByTestId("add-field-demandDescription").fill(`${code} sequential audit`);
  await page.getByTestId("add-field-valueCapitalSelected").check();
  await page.getByTestId("add-field-valueAmount").fill("10000");
  await fillDate(page, "add-field-receivedDate", "2026-07-01");
  await page.getByTestId("add-field-fileType").selectOption({ label: scenario.fileType });
  await page.getByTestId("add-field-mode").selectOption({ label: "PBM" });
  await clickRadio(page, "add-field-gem", "Yes");
  await clickRadio(page, "add-field-bg", scenario.warranty);
  await clickRadio(page, "add-field-ir", scenario.ir);
  await clickRadio(page, "add-field-gte", "No");
  await clickRadio(page, "add-field-tcec", "No");
  await clickRadio(page, "add-field-highValue", "No");
  await clickRadio(page, "add-field-ad", "No");
  await clickRadio(page, "add-field-rqa", "No");
  await clickRadio(page, "add-field-ifa", "No");
}

async function fillScrutinyAndFileMilestones(page: Page, code: string) {
  await page.getByTestId("add-section-scrutiny-and-control").click();
  await fillDate(page, "add-field-scrutinyDate", "2026-07-02");
  await fillDate(page, "add-field-scrutinyResponseDate", "2026-07-03");
  await fillDate(page, "add-field-scrutinyCompletionDate", "2026-07-04");
  await page.getByTestId("add-field-imms").fill(`${code}-CTRL`);
  await fillDate(page, "add-field-immsDate", "2026-07-04");
  await page.getByTestId("add-field-fileNo").fill(code);

  await page.getByTestId("add-section-approval-block").click();
  await fillDate(page, "add-field-cfaSentDate", "2026-07-05");
  await fillDate(page, "add-field-cfaDate", "2026-07-06");

  await page.getByTestId("add-section-bidding-details").click();
  await page.getByTestId("add-field-bidNumber").fill(`${code}-BID`);
  await fillDate(page, "add-field-bidDate", "2026-07-07");
  await fillDate(page, "add-field-bidOpeningDate", "2026-07-08");
  await clickRadio(page, "add-field-tenderLive", "No");
  await page.getByTestId("add-field-bidOpened-yes").check({ force: true });
  await page.getByTestId("add-field-biddingStageOver-yes").click({
    force: true,
    noWaitAfter: true,
  });

  await page.getByTestId("add-section-milestones").click();
  await page.getByLabel("Mark Scrutiny as completed").check();
  await page.getByLabel("Mark Controlling as completed").check();
  await page.getByLabel("Mark CFA as completed").check();
}

async function fillSupplyOrderTab(
  page: Page,
  code: string,
  order: OrderScenario,
  orderIndex: number,
) {
  await page.getByTestId("add-so-tab-supplyOrder").click();
  await openSupplyOrder(page, orderIndex);
  await fillDate(
    page,
    `add-field-supplyOrder-${orderIndex}-financialSanctionDate`,
    `2026-07-${String(9 + orderIndex).padStart(2, "0")}`,
  );
  await page.getByTestId(`add-field-supplyOrder-${orderIndex}-soNo`).fill(`${code}-SO-${orderIndex + 1}`);
  await fillDate(
    page,
    `add-field-supplyOrder-${orderIndex}-soDate`,
    `2026-07-${String(11 + orderIndex).padStart(2, "0")}`,
  );
  await page.getByTestId(`add-field-supplyOrder-${orderIndex}-gemSoNo`).fill(`${code}-GEM-${orderIndex + 1}`);
  await page.getByTestId(`add-field-supplyOrder-${orderIndex}-soValueCapital`).fill(String(10000 + orderIndex * 2500));
  await page.getByTestId(`add-field-supplyOrder-${orderIndex}-firm`).fill(`Audit Firm ${orderIndex + 1}`);
  await page.getByTestId(`add-field-supplyOrder-${orderIndex}-firmType`).selectOption({ label: "MSE" });
  await clickRadio(page, `add-field-supplyOrder-${orderIndex}-stageDelivery`, order.stageDelivery ? "Yes" : "No");
  if (order.stageDelivery) {
    await page.getByTestId(`add-field-supplyOrder-${orderIndex}-stageDeliveryCount`).fill("2");
    await clickRadio(page, `add-field-supplyOrder-${orderIndex}-stagePayment`, order.stagePayment ? "Yes" : "No");
    if (order.stagePayment) {
      await clickRadio(page, `add-field-supplyOrder-${orderIndex}-advancePayment`, order.advancePayment ? "Yes" : "No");
    }
  }
}

async function fillBg(page: Page, code: string, order: OrderScenario, orderIndex: number) {
  const coverage = order.bgCoverage ?? "None";
  await page.getByTestId("add-so-tab-bg").click();
  await openSupplyOrder(page, orderIndex);
  await clickRadio(
    page,
    `add-field-supplyOrder-${orderIndex}-psbApplicable`,
    coverage.includes("PSB") ? "Yes" : "No",
  );
  await page.getByTestId(`add-field-supplyOrder-${orderIndex}-bgCoverageType`).selectOption({ label: coverage });

  if (coverage === "PSB" || coverage === "PSB and PWB separately") {
    await page.getByTestId(`add-field-supplyOrder-${orderIndex}-psbBgNo`).fill(`${code}-PSB-${orderIndex + 1}`);
    await page.getByTestId(`add-field-supplyOrder-${orderIndex}-psbBgAmount`).fill("1000");
    await fillDate(page, `add-field-supplyOrder-${orderIndex}-psbBgReceivedDate`, "2026-07-11");
    await fillDate(page, `add-field-supplyOrder-${orderIndex}-psbBgValidityDate`, "2026-12-31");
  }
  if (coverage === "PWB" || coverage === "PSB and PWB separately") {
    if (coverage === "PSB and PWB separately") {
      await page.getByTestId(`add-field-supplyOrder-${orderIndex}-pwbBgNo`).fill(`${code}-PWB-${orderIndex + 1}`);
      await page.getByTestId(`add-field-supplyOrder-${orderIndex}-pwbBgAmount`).fill("1000");
      await fillDate(page, `add-field-supplyOrder-${orderIndex}-pwbBgReceivedDate`, "2026-07-26");
      await fillDate(page, `add-field-supplyOrder-${orderIndex}-pwbBgValidityDate`, "2027-12-31");
    }
  }
  if (coverage === "PSB+PWB") {
    await page.getByTestId(`add-field-supplyOrder-${orderIndex}-combinedBgNo`).fill(`${code}-COMBINED-${orderIndex + 1}`);
    await page.getByTestId(`add-field-supplyOrder-${orderIndex}-combinedBgAmount`).fill("1000");
    await fillDate(page, `add-field-supplyOrder-${orderIndex}-combinedBgReceivedDate`, "2026-07-10");
    await fillDate(page, `add-field-supplyOrder-${orderIndex}-combinedBgValidityDate`, "2027-12-31");
  }
}

async function fillDeliveryPeriod(page: Page, scenario: AuditScenario, order: OrderScenario, orderIndex: number) {
  await page.getByTestId("add-so-tab-dp").click();
  await openSupplyOrder(page, orderIndex);
  if (!order.stageDelivery) {
    const dpDate = scenario.fileType === "Goods & Services" ? "2026-07-24" : "2026-07-20";
    await fillDate(page, `add-field-supplyOrder-${orderIndex}-dpDate`, dpDate);
    return;
  }

  for (let stageIndex = 0; stageIndex < 2; stageIndex += 1) {
    await openStage(page, orderIndex, stageIndex);
    await page
      .getByTestId(`add-field-supplyOrder-${orderIndex}-stage-${stageIndex}-stageAmountCapital`)
      .fill(stageIndex === 0 ? "4000" : "6000");
    await fillDate(
      page,
      `add-field-supplyOrder-${orderIndex}-stage-${stageIndex}-dpDate`,
      stageIndex === 0 ? "2026-07-22" : "2026-07-26",
    );
  }
}

async function fillDeliveryAndInspection(page: Page, scenario: AuditScenario, order: OrderScenario, orderIndex: number) {
  if (scenario.fileType !== "Goods & Services") return;
  await page.getByTestId("add-so-tab-delivery").click();
  await openSupplyOrder(page, orderIndex);
  if (order.stageDelivery) {
    for (let stageIndex = 0; stageIndex < 2; stageIndex += 1) {
      await openStage(page, orderIndex, stageIndex);
      await fillDate(
        page,
        `add-field-supplyOrder-${orderIndex}-stage-${stageIndex}-materialReceiptDate`,
        stageIndex === 0 ? "2026-07-23" : "2026-07-27",
      );
    }
    return;
  }

  await fillDate(page, `add-field-supplyOrder-${orderIndex}-materialReceiptDate`, "2026-07-25");
  if ((order.ir ?? scenario.ir) === "Yes") {
    await fillDate(page, `add-field-supplyOrder-${orderIndex}-irPreparationDate`, "2026-07-26");
    await fillDate(page, `add-field-supplyOrder-${orderIndex}-irReceiptDate`, "2026-07-27");
  }
}

async function fillPayment(page: Page, scenario: AuditScenario, order: OrderScenario, orderIndex: number) {
  await page.getByTestId("add-so-tab-payment").click();
  await openSupplyOrder(page, orderIndex);
  if (order.advancePayment) {
    await page.getByTestId(`add-field-supplyOrder-${orderIndex}-advance-stageAmountCapital`).fill("2000");
    await fillDate(page, `add-field-supplyOrder-${orderIndex}-advance-billPreparationDate`, "2026-07-12");
    await fillDate(page, `add-field-supplyOrder-${orderIndex}-advance-billSentForPaymentDate`, "2026-07-13");
  }
  if (order.stageDelivery && order.stagePayment) {
    await openStage(page, orderIndex, 0);
    await page.getByTestId(`add-field-supplyOrder-${orderIndex}-stage-0-stageAmountCapital`).fill("4000");
    await fillDate(page, `add-field-supplyOrder-${orderIndex}-stage-0-billPreparationDate`, "2026-07-28");
    await fillDate(page, `add-field-supplyOrder-${orderIndex}-stage-0-billSentForPaymentDate`, "2026-07-29");
    if (order.completePayment) {
      await fillDate(page, `add-field-supplyOrder-${orderIndex}-stage-0-paymentDate`, "2026-07-30");
      await page.getByTestId(`add-field-supplyOrder-${orderIndex}-stage-0-paymentMode`).selectOption({ label: "Online" });
      await page.getByTestId(`add-field-supplyOrder-${orderIndex}-stage-0-actualPaymentCapital`).fill("4000");
    }
    return;
  }
  if (scenario.fileType === "Goods & Services") {
    await fillDate(page, `add-field-supplyOrder-${orderIndex}-billPreparationDate`, "2026-07-28");
    if (order.completePayment) {
      await fillDate(page, `add-field-supplyOrder-${orderIndex}-billSentForPaymentDate`, "2026-07-29");
      await fillDate(page, `add-field-supplyOrder-${orderIndex}-paymentDate`, "2026-07-30");
      await page.getByTestId(`add-field-supplyOrder-${orderIndex}-paymentMode`).selectOption({ label: "Online" });
      await page.getByTestId(`add-field-supplyOrder-${orderIndex}-actualPaymentCapital`).fill("10000");
    }
  }
}

async function saveCurrentFile(page: Page) {
  const responsePromise = page
    .waitForResponse(
      (response) => response.url().includes("/api/files") && response.request().method() === "POST",
      { timeout: 20_000 },
    )
    .then((response) => ({ type: "response" as const, response }));
  const dialogPromise = page.waitForEvent("dialog", { timeout: 20_000 }).then(async (dialog) => {
    const message = dialog.message();
    await dialog.accept();
    return { type: "dialog" as const, message };
  });
  await page.getByTestId("add-save").click();
  const result = await Promise.race([responsePromise, dialogPromise]);
  if (result.type === "dialog") {
    throw new Error(`Sequential entry was blocked by validation dialog:\n${result.message}`);
  }
  expect(result.response.ok()).toBeTruthy();
}

async function readDashboardCounters(page: Page, tabName: string): Promise<CounterSnapshot> {
  await page.goto("/");
  await page.getByText("Dashboard", { exact: true }).click();
  await page.getByRole("button", { name: tabName, exact: true }).click();
  const snapshot: CounterSnapshot = {};
  for (const id of counterIds) {
    const locator = page.getByTestId(id);
    if ((await locator.count()) === 0) continue;
    const text = (await locator.first().innerText()).trim();
    snapshot[id] = Number(text.replace(/,/g, "")) || 0;
  }
  return snapshot;
}

function counterDelta(after: CounterSnapshot, before: CounterSnapshot, id: string) {
  return (after[id] ?? 0) - (before[id] ?? 0);
}

async function clickCounterAndExpectSearch(page: Page, tabName: string, counterId: string) {
  await page.goto("/");
  await page.getByText("Dashboard", { exact: true }).click();
  await page.getByRole("button", { name: tabName, exact: true }).click();
  const counter = page.getByTestId(counterId).first();
  await expect(counter, `${tabName} ${counterId} is missing`).toBeVisible();
  await counter.click();
  await expect(page).toHaveURL(/\/search/);
  await expect(page.getByRole("heading", { name: "Search Files" })).toBeVisible();
  await expect(page.getByText(/No matching files found/i)).toHaveCount(0);
}

test.describe("Sequential workflow audit", () => {
  let browserSessionToken: string;

  test.beforeAll(async () => {
    await cleanupQaFiles();
    const userId = await ensureQaUser();
    browserSessionToken = await saveUserSession(userId);
  });

  test.afterAll(async () => {
    await deleteSession(browserSessionToken);
    await cleanupQaFiles();
    await pool.end();
  });

  test("enters 10 mixed demands sequentially and audits dashboard/report clickers", async ({ page }) => {
    test.setTimeout(900_000);
    await authenticate(page, browserSessionToken);

    const baseline = await readDashboardCounters(page, "Status-3");
    const codes: string[] = [];
    let expectedSupplyOrders = 0;

    for (let index = 0; index < scenarios.length; index += 1) {
      const scenario = scenarios[index];
      const code = `${QA_PREFIX}-${String(index + 1).padStart(2, "0")}`;
      codes.push(code);
      expectedSupplyOrders += scenario.orders.length;

      await test.step(`Sequentially add ${code}`, async () => {
        await page.goto("/add");
        await expect(page.getByRole("heading", { name: "Add a new file" })).toBeVisible();
        await fillFileDetails(page, code, scenario);
        await fillScrutinyAndFileMilestones(page, code);
        await page.getByTestId("add-section-supply-order-and-payment").click();
        await page.getByTestId("add-field-noOfSo").fill(String(scenario.orders.length));

        for (const [orderIndex, order] of scenario.orders.entries()) {
          await fillSupplyOrderTab(page, code, order, orderIndex);
          await fillBg(page, code, order, orderIndex);
          await fillDeliveryPeriod(page, scenario, order, orderIndex);
          await fillDeliveryAndInspection(page, scenario, order, orderIndex);
          await fillPayment(page, scenario, order, orderIndex);
        }

        await saveCurrentFile(page);
      });

      await test.step(`Check Status-3 supply order delta after ${code}`, async () => {
        const current = await readDashboardCounters(page, "Status-3");
        expect(counterDelta(current, baseline, "status-counter-supply-order-placed")).toBe(
          expectedSupplyOrders,
        );
      });
    }

    await test.step("Verify saved demand count", async () => {
      const result = await pool.query<{ count: string }>(
        "select count(*) from files where demand_description = any($1::text[])",
        [codes.map((code) => `${code} sequential audit`)],
      );
      expect(Number(result.rows[0]?.count ?? 0)).toBe(10);
    });

    await test.step("Compare expected Status-3 counter deltas", async () => {
      const after = await readDashboardCounters(page, "Status-3");
      expect(counterDelta(after, baseline, "status-counter-financial-sanction-completed")).toBe(11);
      expect(counterDelta(after, baseline, "status-counter-supply-order-placed")).toBe(11);
      expect(counterDelta(after, baseline, "status-counter-psb-received")).toBe(1);
      expect(counterDelta(after, baseline, "status-counter-pwb-received")).toBe(1);
      expect(counterDelta(after, baseline, "status-counter-psb-pwb-received")).toBe(1);
      expect(counterDelta(after, baseline, "status-counter-payment-completed")).toBeGreaterThanOrEqual(2);
      expect(counterDelta(after, baseline, "status-counter-payment-pending")).toBeGreaterThanOrEqual(5);
    });

    await test.step("Check source landing for key Status tabs", async () => {
      for (const tabName of ["Status-1", "Status-2", "Status-3"]) {
        await clickCounterAndExpectSearch(page, tabName, "status-counter-supply-order-placed");
        await clickCounterAndExpectSearch(page, tabName, "status-counter-payment-pending");
      }
      await clickCounterAndExpectSearch(page, "Status-3", "status-counter-psb-pwb-received");
    });

    await test.step("Check Search, Reports, Analytics, and Finance surfaces load", async () => {
      await page.goto("/search");
      await page.getByPlaceholder("Free search").fill(QA_PREFIX);
      await expect(page.getByText("10 records")).toBeVisible();
      await expect(page.getByText(codes[codes.length - 1]).first()).toBeVisible();

      await page.goto("/reports");
      await expect(page.getByText("MMG summary").first()).toBeVisible();
      await expect(page.getByText("Demand processing analysis").first()).toBeVisible();
      await expect(page.getByText("Supply order & delivery").first()).toBeVisible();

      await page.goto("/");
      await page.getByRole("button", { name: "Analytics", exact: true }).click();
      await expect(page.getByText("Suspected anomaly").first()).toBeVisible();
      await expect(page.getByText("Delay Status").first()).toBeVisible();

      await page.getByRole("button", { name: "Finance", exact: true }).click();
      await expect(page.getByText(/Finance summary/i).first()).toBeVisible();
    });
  });
});
