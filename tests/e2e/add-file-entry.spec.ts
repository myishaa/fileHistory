import { expect, test, type Page } from "@playwright/test";

import { pool } from "../../backend/src/db/pool.js";
import { deleteSession, saveUserSession } from "../../backend/src/utils/auth.js";

const QA_USERNAME = "qa_playwright";
const QA_PASSWORD = "qa_playwright123";
const QA_PREFIX = "QA-PLAYWRIGHT-ADD";
const QA_FIRM_NAME = "QA Playwright Add Firm";
const QA_FIRM_UNIQUE_NO = "QA-PLAYWRIGHT-ADD-FIRM";
const FILE_COUNT = Number(process.env.PLAYWRIGHT_ADD_FILE_COUNT ?? 50);

type AddScenario = {
  fileType: string;
  warranty: "Yes" | "No";
  ir: "Yes" | "No";
  bgCoverage?: "PSB" | "PWB" | "PSB+PWB" | "PSB and PWB separately";
  stageDelivery?: boolean;
  stagePayment?: boolean;
  advancePayment?: boolean;
  paymentComplete?: boolean;
};

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function cleanupQaFiles() {
  await pool.query(
    "delete from files where unique_code like $1 or file_no like $1 or demand_description like $1",
    [`${QA_PREFIX}%`],
  );
}

async function ensureQaFirm() {
  await pool.query("delete from master_firms where firm_unique_no = $1", [QA_FIRM_UNIQUE_NO]);
  await pool.query(
    "insert into master_firms (firm_name, firm_unique_no, firm_type) values ($1, $2, 'MSE')",
    [QA_FIRM_NAME, QA_FIRM_UNIQUE_NO],
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

async function selectedYear() {
  const result = await pool.query<{ financial_year: string }>(
    "select financial_year from app_settings where id = true",
  );
  return result.rows[0]?.financial_year ?? "2026-27";
}

function scenarioFor(index: number): AddScenario {
  const scenarios: AddScenario[] = [
    { fileType: "Goods & Services", warranty: "No", ir: "No", paymentComplete: true },
    { fileType: "Goods & Services", warranty: "No", ir: "Yes" },
    { fileType: "Goods & Services", warranty: "Yes", ir: "Yes", bgCoverage: "PSB" },
    { fileType: "Goods & Services", warranty: "Yes", ir: "No", bgCoverage: "PWB" },
    { fileType: "Goods & Services", warranty: "Yes", ir: "No", bgCoverage: "PSB+PWB" },
    {
      fileType: "Goods & Services",
      warranty: "Yes",
      ir: "Yes",
      bgCoverage: "PSB and PWB separately",
    },
    { fileType: "Goods & Services", warranty: "No", ir: "No", stageDelivery: true },
    {
      fileType: "Goods & Services",
      warranty: "No",
      ir: "No",
      stageDelivery: true,
      stagePayment: true,
    },
    {
      fileType: "Goods & Services",
      warranty: "No",
      ir: "No",
      stageDelivery: true,
      stagePayment: true,
      advancePayment: true,
    },
    { fileType: "AMC", warranty: "No", ir: "No" },
    { fileType: "MPC", warranty: "No", ir: "No" },
    { fileType: "O&M", warranty: "Yes", ir: "No", bgCoverage: "PSB+PWB" },
    { fileType: "CARS", warranty: "No", ir: "No" },
  ];
  return scenarios[index % scenarios.length];
}

async function clickRadio(page: Page, testIdBase: string, value: "Yes" | "No") {
  await page.getByTestId(`${testIdBase}-${value.toLowerCase()}`).check({ force: true });
}

async function fillDate(page: Page, testId: string, value: string) {
  const field = page.getByTestId(testId);
  await field.fill("");
  await field.fill(value);
}

async function openSupplyOrder(page: Page, index = 0) {
  const card = page.getByTestId(`add-supply-order-${index}`);
  const isOpen = await card.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!isOpen) await card.locator("summary").click();
}

async function openStage(page: Page, orderIndex: number, stageIndex: number) {
  const card = page.getByTestId(`add-supply-order-${orderIndex}-stage-${stageIndex}`);
  const isOpen = await card.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!isOpen) await card.locator("summary").click();
}

async function openPaymentCard(page: Page, label: "Advance Payment" | "Normal Payment") {
  const summary = page.locator("summary").filter({ has: page.getByText(label, { exact: true }) }).first();
  const card = summary.locator("..");
  if (!(await card.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await summary.click();
  }
}

async function fillFileDetails(page: Page, code: string, scenario: AddScenario) {
  await page.getByTestId("add-section-file-details").click();
  await page.getByTestId("add-field-division").fill("ACC");
  await page.getByTestId("add-field-division").press("Enter");
  await expect(page.getByTestId("add-field-uniqueCode")).not.toHaveValue("");
  await page.getByTestId("add-field-indentor").fill("Playwright Operator");
  await page.getByTestId("add-field-demandDescription").fill(`${code} field-by-field QA`);
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

async function fillScrutiny(page: Page, code: string) {
  await page.getByTestId("add-section-scrutiny-and-control").click();
  await fillDate(page, "add-field-scrutinyDate", "2026-07-02");
  await fillDate(page, "add-field-scrutinyResponseDate", "2026-07-03");
  await fillDate(page, "add-field-scrutinyCompletionDate", "2026-07-04");
  await page.getByTestId("add-field-imms").fill(`${code}-CTRL`);
  await fillDate(page, "add-field-immsDate", "2026-07-04");
  await page.getByTestId("add-field-fileNo").fill(code);
}

async function fillFileLevelMilestones(page: Page) {
  await page.getByTestId("add-section-approval-block").click();
  await fillDate(page, "add-field-cfaSentDate", "2026-07-05");
  await fillDate(page, "add-field-cfaDate", "2026-07-06");

  if (await scenarioNeedsBidding(page)) {
    await page.getByTestId("add-section-bidding-details").click();
    await page.getByTestId("add-field-bidNumber").fill("BID-PLAYWRIGHT");
    await fillDate(page, "add-field-bidDate", "2026-07-07");
    await fillDate(page, "add-field-bidOpeningDate", "2026-07-08");
    await clickRadio(page, "add-field-bidOpened", "Yes");
    await clickRadio(page, "add-field-biddingStageOver", "Yes");
  }

  await page.getByTestId("add-section-milestones").click();
  await page.getByLabel("Mark Scrutiny as completed").check();
  await page.getByLabel("Mark Controlling as completed").check();
  await page.getByLabel("Mark CFA as completed").check();
  if (await page.getByLabel("Mark Bidding as completed").isVisible().catch(() => false)) {
    await page.getByLabel("Mark Bidding as completed").check();
  }
}

async function scenarioNeedsBidding(page: Page) {
  return page.getByTestId("add-section-bidding-details").isVisible().catch(() => false);
}

async function fillSupplyOrderBase(page: Page, code: string, scenario: AddScenario, index: number) {
  await page.getByTestId("add-section-supply-order-and-payment").click();
  await page.getByTestId("add-so-tab-supplyOrder").click();
  await openSupplyOrder(page);
  await fillDate(page, "add-field-supplyOrder-0-financialSanctionDate", "2026-07-05");

  if (index === 0) {
    await page.getByTestId("add-field-supplyOrder-0-soNo").fill(`${code}-SO-1`);
    await fillDate(page, "add-field-supplyOrder-0-soDate", "2026-07-04");
    const dialogPromise = page.waitForEvent("dialog");
    await page.getByTestId("add-save-file-details").click();
    const dialog = await dialogPromise;
      expect(dialog.message()).toContain("S.O. date cannot be earlier than Financial Sanction date");
      await dialog.accept();
    await fillDate(page, "add-field-supplyOrder-0-soDate", "2026-07-10");
  } else {
    await page.getByTestId("add-field-supplyOrder-0-soNo").fill(`${code}-SO-1`);
    await fillDate(page, "add-field-supplyOrder-0-soDate", "2026-07-10");
  }

  await page.getByTestId("add-field-supplyOrder-0-gemSoNo").fill(`${code}-GEM-1`);
  await page.getByTestId("add-field-supplyOrder-0-soValueCapital").fill("10000");
  await page.getByTestId("add-field-supplyOrder-0-firm").fill(QA_FIRM_NAME);
  await page.getByTestId("add-field-supplyOrder-0-firm").press("Enter");
  await expect(page.getByTestId("add-field-supplyOrder-0-firmUniqueNo")).toHaveValue(QA_FIRM_UNIQUE_NO);

  await clickRadio(page, "add-field-supplyOrder-0-stageDelivery", scenario.stageDelivery ? "Yes" : "No");
  if (scenario.stageDelivery) {
    await page.getByTestId("add-field-supplyOrder-0-stageDeliveryCount").fill("2");
    await clickRadio(page, "add-field-supplyOrder-0-stagePayment", scenario.stagePayment ? "Yes" : "No");
    if (scenario.stagePayment) {
      await clickRadio(page, "add-field-supplyOrder-0-advancePayment", scenario.advancePayment ? "Yes" : "No");
    }
  }
  if (index === 0) {
    await expect(page.getByTestId("add-field-supplyOrder-0-advancePayment-yes")).toBeVisible();
  }
  if (index === 0) {
    await expect(page.getByTestId("add-field-supplyOrder-0-advancePayment-yes")).toBeVisible();
    await page.getByTestId("add-so-tab-payment").click();
    await openSupplyOrder(page);
    await expect(page.getByTestId("add-field-supplyOrder-0-billAmountCapital")).toHaveValue("");
  }
}

async function fillBg(page: Page, code: string, scenario: AddScenario) {
  if (scenario.warranty !== "Yes" && !scenario.bgCoverage) return;
  await page.getByTestId("add-so-tab-bg").click();
  await openSupplyOrder(page);
  await clickRadio(page, "add-field-supplyOrder-0-psbApplicable", scenario.bgCoverage?.includes("PSB") ? "Yes" : "No");
  await page.getByTestId("add-field-supplyOrder-0-bgCoverageType").selectOption({ label: scenario.bgCoverage ?? "None" });
  if (scenario.bgCoverage === "PSB") {
    await page.getByTestId("add-field-supplyOrder-0-psbBgNo").fill(`${code}-PSB`);
    await page.getByTestId("add-field-supplyOrder-0-psbBgAmount").fill("1000");
    await fillDate(page, "add-field-supplyOrder-0-psbBgReceivedDate", "2026-07-11");
    await fillDate(page, "add-field-supplyOrder-0-psbBgValidityDate", "2026-12-31");
  }
  if (scenario.bgCoverage === "PWB") {
    await page.getByTestId("add-field-supplyOrder-0-pwbBgNo").fill(`${code}-PWB`);
    await page.getByTestId("add-field-supplyOrder-0-pwbBgAmount").fill("1000");
    await fillDate(page, "add-field-supplyOrder-0-pwbBgReceivedDate", "2026-07-22");
    await fillDate(page, "add-field-supplyOrder-0-pwbBgValidityDate", "2027-12-31");
  }
  if (scenario.bgCoverage === "PSB+PWB") {
    await page.getByTestId("add-field-supplyOrder-0-combinedBgNo").fill(`${code}-COMBINED`);
    await page.getByTestId("add-field-supplyOrder-0-combinedBgAmount").fill("1000");
    await fillDate(page, "add-field-supplyOrder-0-combinedBgReceivedDate", "2026-07-06");
    await fillDate(page, "add-field-supplyOrder-0-combinedBgValidityDate", "2027-12-31");
  }
}

async function fillDpDeliveryPayment(page: Page, scenario: AddScenario) {
  await page.getByTestId("add-so-tab-dp").click();
  await openSupplyOrder(page);
  if (!scenario.stageDelivery) {
    await fillDate(
      page,
      "add-field-supplyOrder-0-dpDate",
      scenario.fileType === "Goods & Services" ? "2026-08-15" : "2026-07-15",
    );
  } else {
    await openStage(page, 0, 0);
    await page.getByTestId("add-field-supplyOrder-0-stage-0-stageAmountCapital").fill("4000");
    await fillDate(page, "add-field-supplyOrder-0-stage-0-deliveryPeriodStartDate", "2026-07-15");
    await fillDate(page, "add-field-supplyOrder-0-stage-0-dpDate", "2026-08-01");
    await openStage(page, 0, 1);
    await page.getByTestId("add-field-supplyOrder-0-stage-1-stageAmountCapital").fill("6000");
    await fillDate(page, "add-field-supplyOrder-0-stage-1-deliveryPeriodStartDate", "2026-08-02");
    await fillDate(page, "add-field-supplyOrder-0-stage-1-dpDate", "2026-09-01");
  }

  if (scenario.fileType === "Goods & Services") {
    await page.getByTestId("add-so-tab-delivery").click();
    await openSupplyOrder(page);
    if (scenario.stageDelivery) {
      for (const stageIndex of [0, 1]) {
        await openStage(page, 0, stageIndex);
        await fillDate(
          page,
          `add-field-supplyOrder-0-stage-${stageIndex}-${scenario.ir === "Yes" ? "materialReceiptDate" : "jobCompletionDate"}`,
          stageIndex === 0 ? "2026-07-20" : "2026-07-25",
        );
      }
    } else {
      await fillDate(
        page,
        `add-field-supplyOrder-0-${scenario.ir === "Yes" ? "materialReceiptDate" : "jobCompletionDate"}`,
        "2026-07-20",
      );
      if (scenario.ir === "Yes") {
        await fillDate(page, "add-field-supplyOrder-0-irPreparationDate", "2026-07-21");
        await fillDate(page, "add-field-supplyOrder-0-irReceiptDate", "2026-07-22");
      }
    }
  }

  await page.getByTestId("add-so-tab-payment").click();
  await openSupplyOrder(page);
  if (scenario.advancePayment) {
    await openPaymentCard(page, "Advance Payment");
    await page.getByTestId("add-field-supplyOrder-0-advance-stageAmountCapital").fill("2000");
    await fillDate(page, "add-field-supplyOrder-0-advance-billPreparationDate", "2026-07-12");
    await fillDate(page, "add-field-supplyOrder-0-advance-billSentForPaymentDate", "2026-07-13");
  }
  if (scenario.stageDelivery && scenario.stagePayment) {
    await openStage(page, 0, 0);
    await page.getByTestId("add-field-supplyOrder-0-stage-0-stageAmountCapital").fill("4000");
    await fillDate(page, "add-field-supplyOrder-0-stage-0-billPreparationDate", "2026-07-23");
    await fillDate(page, "add-field-supplyOrder-0-stage-0-billSentForPaymentDate", "2026-07-24");
  } else if (!scenario.stageDelivery && scenario.fileType === "Goods & Services") {
    await openPaymentCard(page, "Normal Payment");
    await fillDate(page, "add-field-supplyOrder-0-billPreparationDate", "2026-07-23");
    if (scenario.paymentComplete) {
      await fillDate(page, "add-field-supplyOrder-0-billSentForPaymentDate", "2026-07-24");
      await fillDate(page, "add-field-supplyOrder-0-paymentDate", "2026-07-30");
      await page.getByTestId("add-field-supplyOrder-0-paymentMode").selectOption({ label: "Online" });
      await page.getByTestId("add-field-supplyOrder-0-actualPaymentCapital").fill("10000");
    }
  }
}

async function saveCurrentFile(page: Page) {
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/files") && response.request().method() === "POST",
    { timeout: 20_000 },
  ).then((response) => ({ type: "response" as const, response }));
  const dialogPromise = page.waitForEvent("dialog", { timeout: 20_000 }).then(async (dialog) => {
    const message = dialog.message();
    await dialog.accept();
    return { type: "dialog" as const, message };
  });
  await page.getByTestId("add-save-file-details").click();
  const result = await Promise.race([responsePromise, dialogPromise]);
  if (result.type === "dialog") {
    throw new Error(`Save was blocked by validation dialog:\n${result.message}`);
  }
  expect(result.response.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/search/);
}

async function verifyDateDeletionGuard(page: Page) {
  await page.getByTestId("add-so-tab-supplyOrder").click();
  await openSupplyOrder(page);
  await page.getByTestId("add-field-supplyOrder-0-soDate").fill("");
  const dialogPromise = page.waitForEvent("dialog");
  await page.getByTestId("add-save-file-details").click();
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain("S.O. date");
  await dialog.accept();
  await fillDate(page, "add-field-supplyOrder-0-soDate", "2026-07-10");
}

test.describe("Add File field-by-field workflows", () => {
  let browserSessionToken: string;
  let selectedFinancialYear = "2026-27";

  test.beforeAll(async () => {
    await cleanupQaFiles();
    await ensureQaFirm();
    const userId = await ensureQaUser();
    selectedFinancialYear = await selectedYear();
    browserSessionToken = await saveUserSession(userId);
  });

  test.afterAll(async () => {
    await deleteSession(browserSessionToken);
    await cleanupQaFiles();
    await pool.query("delete from master_firms where firm_unique_no = $1", [QA_FIRM_UNIQUE_NO]);
    await pool.end();
  });

  test(`enters ${FILE_COUNT} files through Add File, including S.O. stages, BG variants, date warning, and exports`, async ({
    page,
  }) => {
    test.setTimeout(Math.max(120_000, FILE_COUNT * 45_000));
    page.setDefaultTimeout(15_000);
    await authenticate(page, browserSessionToken);
    const codes: string[] = [];

    for (let index = 0; index < FILE_COUNT; index += 1) {
      const scenario = scenarioFor(index);
      const code = `${QA_PREFIX}-${String(index + 1).padStart(2, "0")}`;
      codes.push(code);
      await test.step(`Add ${code}`, async () => {
        await page.goto("/add");
        await expect(page.getByRole("heading", { name: "File details" })).toBeVisible();
        await fillFileDetails(page, code, scenario);
        await fillScrutiny(page, code);
        await fillFileLevelMilestones(page);
        await fillSupplyOrderBase(page, code, scenario, index);
        await fillBg(page, code, scenario);
        await fillDpDeliveryPayment(page, scenario);
        if (index === 0) await verifyDateDeletionGuard(page);
        await saveCurrentFile(page);
      });
    }

    const result = await pool.query<{ count: string }>(
      "select count(*) from files where demand_description = any($1::text[])",
      [codes.map((code) => `${code} field-by-field QA`)],
    );
    expect(Number(result.rows[0]?.count ?? 0)).toBe(FILE_COUNT);

    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Search Files" })).toBeVisible();
    await page.getByPlaceholder("Free search").fill(QA_PREFIX);
    await expect(page.getByText(`${FILE_COUNT} records`)).toBeVisible();
    await expect(page.getByText(codes[codes.length - 1]).first()).toBeVisible();

    const excelExportRequest = page.waitForRequest((request) =>
      request.url().includes("/api/files/export/search"),
    );
    const excelDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export all search results as Excel" }).click();
    const excelRequest = await excelExportRequest;
    const excelPayload = excelRequest.postDataJSON() as {
      query?: Record<string, string>;
    };
    expect(excelPayload.query?.freeText).toBe(QA_PREFIX);
    await expect(await excelDownload).toBeTruthy();

    const pdfDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export all search results as PDF" }).click();
    await expect(await pdfDownload).toBeTruthy();
  });
});
