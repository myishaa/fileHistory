import { chromium } from "playwright";

const api = "http://localhost:3000";
const base = "http://localhost:8083";
const code = "QA-PLAYWRIGHT-SEQAUDIT-01";

async function main() {
  const login = await fetch(`${api}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "qa_playwright", password: "qa_playwright123" }),
  });
  if (!login.ok) throw new Error(`Login failed ${login.status}: ${await login.text()}`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Login did not return a session cookie.");

  await deleteExistingAuditFile(cookie);

  const [name, value] = cookie.split("=");
  const context = await chromium.launchPersistentContext(
    `/tmp/recordkeeper-saved-audit-profile-${Date.now()}`,
    { channel: "chrome", headless: false, viewport: { width: 1400, height: 900 } },
  );
  await context.addCookies([
    { name, value, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  const page = context.pages()[0] || (await context.newPage());

  page.on("dialog", async (dialog) => {
    console.log(`dialog: ${dialog.message()}`);
    await dialog.accept();
  });

  await fillCase(page);
  await page.getByTestId("add-save").scrollIntoViewIfNeeded();
  const result = await Promise.race([
    page
      .waitForResponse(
        (response) => response.url().includes("/api/files") && response.request().method() === "POST",
        { timeout: 45_000 },
      )
      .then(async (response) => `response ${response.status()}: ${await response.text()}`),
    page.waitForEvent("dialog", { timeout: 45_000 }).then(async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      return `dialog: ${message}`;
    }),
  ]).catch((error) => `timeout/error: ${error.message}`);
  await page.getByTestId("add-save").click({ timeout: 10_000 }).catch((error) => {
    console.log(`save click failed: ${error.message}`);
  });
  console.log(result);
  await page.waitForTimeout(2_000);
  await page.goto(`${base}/search`);
  await page.getByPlaceholder("Free search").fill(code);
  console.log("Browser left open on Search Files.");
  await new Promise(() => {});
}

async function deleteExistingAuditFile(cookie) {
  const search = await (
    await fetch(
      `${api}/api/files/search?selectedYear=__all_active_files__&freeText=${code}&page=1&pageSize=10`,
      { headers: { cookie } },
    )
  ).json();
  for (const file of search.files ?? []) {
    if (file.uniqueCode === code) {
      await fetch(`${api}/api/files/${file.id}`, { method: "DELETE", headers: { cookie } });
    }
  }
}

async function fillCase(page) {
  await page.goto(`${base}/add`);
  await page.getByRole("heading", { name: "Add a new file" }).waitFor({ timeout: 30_000 });
  await page.getByTestId("add-section-file-details").click();
  await page.getByTestId("add-field-division").fill("ACC");
  await page.getByTestId("add-field-indentor").fill("Playwright Operator");
  await page.getByTestId("add-field-demandDescription").fill(`${code} sequential audit - saved one step back`);
  await page.getByTestId("add-field-valueCapitalSelected").check();
  await page.getByTestId("add-field-valueAmount").fill("10000");
  await fillDate(page, "add-field-receivedDate", "2026-07-01");
  await page.getByTestId("add-field-fileType").selectOption({ label: "Goods & Services" });
  await page.getByTestId("add-field-mode").selectOption({ label: "PBM" });
  await radio(page, "add-field-gem", "Yes");
  await radio(page, "add-field-bg", "No");
  await radio(page, "add-field-ir", "No");
  await radio(page, "add-field-gte", "No");
  await radio(page, "add-field-tcec", "No");
  await radio(page, "add-field-highValue", "No");
  await radio(page, "add-field-ad", "No");
  await radio(page, "add-field-rqa", "No");
  await radio(page, "add-field-ifa", "No");

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
  await radio(page, "add-field-tenderLive", "No");
  await page.getByTestId("add-field-bidOpened-yes").check({ force: true });
  await page.getByTestId("add-field-biddingStageOver-yes").click({ force: true, noWaitAfter: true });

  await page.getByTestId("add-section-milestones").click();
  for (const label of [
    "Mark Scrutiny as completed",
    "Mark Controlling as completed",
    "Mark CFA as completed",
  ]) {
    const box = page.getByLabel(label);
    if (!(await box.isChecked())) await box.check({ force: true });
  }

  await page.getByTestId("add-section-supply-order-and-payment").click();
  await page.getByTestId("add-field-noOfSo").fill("1");
  await page.getByTestId("add-so-tab-supplyOrder").click();
  await openOrder(page, 0);
  await fillDate(page, "add-field-supplyOrder-0-financialSanctionDate", "2026-07-09");
  await page.getByTestId("add-field-supplyOrder-0-soNo").fill(`${code}-SO-1`);
  await fillDate(page, "add-field-supplyOrder-0-soDate", "2026-07-11");
  await page.getByTestId("add-field-supplyOrder-0-gemSoNo").fill(`${code}-GEM-1`);
  await page.getByTestId("add-field-supplyOrder-0-soValueCapital").fill("10000");
  await page.getByTestId("add-field-supplyOrder-0-firm").fill("Audit Firm 1");
  await page.getByTestId("add-field-supplyOrder-0-firmType").selectOption({ label: "MSE" });
  await radio(page, "add-field-supplyOrder-0-stageDelivery", "No");

  await page.getByTestId("add-so-tab-bg").click();
  await openOrder(page, 0);
  await radio(page, "add-field-supplyOrder-0-psbApplicable", "No");
  await page.getByTestId("add-field-supplyOrder-0-bgCoverageType").selectOption({ label: "None" });

  await page.getByTestId("add-so-tab-dp").click();
  await openOrder(page, 0);
  await fillDate(page, "add-field-supplyOrder-0-dpDate", "2026-07-24");

  await page.getByTestId("add-so-tab-delivery").click();
  await openOrder(page, 0);
  await fillDate(page, "add-field-supplyOrder-0-materialReceiptDate", "2026-07-25");

  await page.getByTestId("add-so-tab-payment").click();
  await openOrder(page, 0);
  await fillDate(page, "add-field-supplyOrder-0-billPreparationDate", "2026-07-28");

  await page.getByTestId("add-section-milestones").click();
  await page.getByLabel("Mark Bill sent for payment as current").check({ force: true });
}

async function fillDate(page, testId, value) {
  const field = page.getByTestId(testId);
  await field.fill("");
  await field.fill(value);
}

async function radio(page, testIdBase, value) {
  await page.getByTestId(`${testIdBase}-${value.toLowerCase()}`).check({ force: true });
}

async function openOrder(page, index) {
  const card = page.getByTestId(`add-supply-order-${index}`);
  const isOpen = await card.evaluate((element) => element.open);
  if (!isOpen) await card.locator("summary").click();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
