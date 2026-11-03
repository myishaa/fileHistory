import { chromium } from "playwright";

const API_BASE_URL = process.env.BACKEND_URL ?? "http://localhost:3001";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:8081";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
const timeout = Number(process.env.AUDIT_NAVIGATION_TIMEOUT ?? 90000);

const panels = [
  "Pre-Bid Schedule",
  "Bid-opening schedule",
  "TCEC summary",
  "CNC summary",
];

async function login() {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`API login failed: ${body?.error ?? response.status}`);
  const cookie = response.headers.get("set-cookie") ?? "";
  const match = cookie.match(/recordkeeper_session=([^;]+)/);
  if (!match) throw new Error("API login did not return a session cookie");
  return decodeURIComponent(match[1]);
}

async function dismissUrgentPopup(page) {
  const dialog = page.getByRole("dialog", { name: "Urgent reminders and messages" });
  if (!(await dialog.isVisible({ timeout: 750 }).catch(() => false))) return;
  const close = dialog.getByRole("button", { name: "Close urgent reminders and messages" });
  if (await close.isVisible({ timeout: 750 }).catch(() => false)) await close.click().catch(() => undefined);
  await dialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => undefined);
}

async function waitForPanel(page, label) {
  const button = page.getByRole("button", { name: label, exact: true }).first();
  await button.waitFor({ state: "visible", timeout: timeout });
  await button.click({ timeout: 10000 });
  await page.waitForTimeout(500);
  await page.getByRole("heading", { name: label, exact: true }).first().waitFor({ state: "visible", timeout });
}

async function clickFirstPositive(page, locator) {
  const count = await locator.count();
  for (let i = 0; i < count; i += 1) {
    const item = locator.nth(i);
    const text = (await item.innerText().catch(() => "")).trim();
    const match = text.match(/\d[\d,]*/);
    if (match && Number(match[0].replaceAll(",", "")) > 0) {
      await item.click({ timeout: 10000 });
      return { index: i, text };
    }
  }
  return undefined;
}

async function main() {
  const token = await login();
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome" });
  const context = await browser.newContext();
  const host = new URL(FRONTEND_URL).hostname;
  await context.addCookies([{ name: "recordkeeper_session", value: token, domain: host, path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.addLocatorHandler(
    page.getByRole("dialog", { name: "Urgent reminders and messages" }),
    async (dialog) => {
      const close = dialog.getByRole("button", { name: "Close urgent reminders and messages" });
      if (await close.isVisible().catch(() => false)) await close.click().catch(() => undefined);
    },
    { noWaitAfter: true },
  );
  const results = [];
  const issues = [];
  try {
    await page.goto(`${FRONTEND_URL}/dashboard?tab=analytics`, { waitUntil: "domcontentloaded", timeout });
    await dismissUrgentPopup(page);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    for (const panel of panels) {
      const result = { panel, fiscalYear: null, month: null, calendar: false, clickers: 0, landings: 0, issues: [] };
      try {
        await waitForPanel(page, panel);
        const yearButtons = page.locator("table tbody button").filter({ hasText: /^\d{4}-\d{2}$/ });
        const year = await clickFirstPositive(page, yearButtons);
        if (!year) {
          result.issues.push("no-positive-fiscal-year-row");
          results.push(result);
          continue;
        }
        result.fiscalYear = year.text;
        await page.waitForTimeout(300);
        const monthButtons = page.locator("table tbody button");
        const month = await clickFirstPositive(page, monthButtons);
        if (!month) {
          result.issues.push("no-positive-month-row");
          results.push(result);
          continue;
        }
        result.month = month.text;
        const calendar = page.locator('section[aria-label$="daily counts"]');
        await calendar.waitFor({ state: "visible", timeout: 10000 });
        result.calendar = true;
        const eventButtons = calendar.locator('button[aria-label]');
        const count = await eventButtons.count();
        for (let i = 0; i < count; i += 1) {
          const button = eventButtons.nth(i);
          const label = await button.getAttribute("aria-label");
          const text = (await button.innerText()).trim();
          const match = text.match(/\d[\d,]*/);
          if (!match || Number(match[0].replaceAll(",", "")) <= 0) continue;
          result.clickers += 1;
          await button.click({ timeout: 10000 });
          await page.waitForURL((url) => url.pathname.endsWith("/search"), { timeout: 15000 }).catch(() => undefined);
          await dismissUrgentPopup(page);
          const url = new URL(page.url());
          const crumb = page.locator('nav[aria-label="Dashboard drill path"]');
          const crumbText = (await crumb.count()) ? (await crumb.innerText()).replace(/\s+/g, " ").trim() : "";
          if (!url.pathname.endsWith("/search")) result.issues.push(`calendar-click-did-not-open-search:${label}:${page.url()}`);
          else if (!crumbText.includes("Dashboard") || !crumbText.includes("Analytics")) result.issues.push(`calendar-breadcrumb-missing:${label}:crumb=${crumbText}:url=${page.url()}`);
          else result.landings += 1;
          await page.goto(`${FRONTEND_URL}/dashboard?tab=analytics`, { waitUntil: "domcontentloaded", timeout });
          await dismissUrgentPopup(page);
          await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => undefined);
          await waitForPanel(page, panel);
          const y = await clickFirstPositive(page, page.locator("table tbody button").filter({ hasText: /^\d{4}-\d{2}$/ }));
          if (!y) throw new Error("fiscal-year row disappeared after reload");
          await page.waitForTimeout(200);
          const m = await clickFirstPositive(page, page.locator("table tbody button"));
          if (!m) throw new Error("month row disappeared after reload");
          await page.locator('section[aria-label$="daily counts"]').waitFor({ state: "visible", timeout: 10000 });
        }
      } catch (error) {
        result.issues.push(error instanceof Error ? error.message : String(error));
      }
      results.push(result);
    }
    console.log(JSON.stringify({ panels: results, issues: results.flatMap((r) => r.issues.map((issue) => ({ panel: r.panel, issue }))) }, null, 2));
    if (results.some((r) => r.issues.length)) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
    await fetch(`${API_BASE_URL}/api/auth/logout`, { method: "POST", headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` } }).catch(() => undefined);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
