import { chromium } from "playwright";

const API_BASE_URL = process.env.BACKEND_URL ?? "http://localhost:3001";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:8081";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
const maxClicks = Number(process.env.AUDIT_MAX_BROWSER_CLICKS ?? 600);
const tracePath = process.env.AUDIT_BROWSER_TRACE ?? "test-results/audit-clicker-landings-trace.zip";
const startReportMode = process.env.AUDIT_BROWSER_START_MODE ?? "";

const dashboardTabs = [
  ["status", "Status-1"],
  ["liveStatus", "Status-2"],
  ["status3", "Status-3"],
  ["status4", "Status-4"],
  ["snapshot", "Snapshot"],
  ["analytics", "Analytics"],
  ["finance", "Finance"],
  ["finance1", "FY Snapshot"],
];

const reportModes = [
  "mmgSummary", "demandProcessingAnalysis", "firmDatabase", "unifiedFinanceReview", "merData",
  "merComparison", "cashOutGoPlan", "preSoExpectedCashOutgo", "soPaymentMatrix",
  "paymentCompletedMatrix", "pendingReturnedBills", "returnedBillsResubmitted", "returnedBillsPaid",
  "supplementaryBillsSubmitted", "supplementaryBillsPaid", "supplementaryPendingReturnedBills",
  "supplementaryReturnedBillsResubmitted", "supplementaryReturnedBillsPaid", "monthlyFileInflow",
  "monthWiseSupplyOrder", "monthWiseDeliverySchedule", "monthWiseCompletedDeliveries",
  "monthWiseBgExpiry", "preBidMeetings", "bgReceiptDelay", "warrantyBgMismatch", "delayStatus",
  "pendingLiabilityAgeing",
];

const reportLabels = {
  mmgSummary: "MMG Summary",
  demandProcessingAnalysis: "Demand processing analysis",
  firmDatabase: "Firm Performance",
  unifiedFinanceReview: "Unified Finance Reports",
  merData: "MER Data",
  merComparison: "MER vs Recorded Payments",
  cashOutGoPlan: "Cash Out Go Plan",
  preSoExpectedCashOutgo: "Pre-S.O. based expected cash outgo",
  soPaymentMatrix: "Month-wise Payment due Matrix",
  paymentCompletedMatrix: "Month-wise Payment completed Matrix",
  pendingReturnedBills: "Pending returned bills",
  returnedBillsResubmitted: "Returned bills resubmitted and unpaid",
  returnedBillsPaid: "Returned bills paid",
  supplementaryBillsSubmitted: "Supplementary bills submitted, payment pending",
  supplementaryBillsPaid: "Supplementary bills paid",
  supplementaryPendingReturnedBills: "Pending returned supplementary bills",
  supplementaryReturnedBillsResubmitted: "Returned supplementary bills resubmitted",
  supplementaryReturnedBillsPaid: "Returned supplementary bills paid",
  monthlyFileInflow: "Monthly file inflow",
  monthWiseSupplyOrder: "Month-wise Supply Order",
  monthWiseDeliverySchedule: "Month-wise Delivery / Contract Period Schedule",
  monthWiseCompletedDeliveries: "Month-wise completed deliveries / Job Completion",
  monthWiseBgExpiry: "Month-wise BG expiry",
  preBidMeetings: "Pre-Bid Meetings",
  bgReceiptDelay: "BG receipt delay",
  warrantyBgMismatch: "Warranty / BG mismatch",
  delayStatus: "Delay Status",
  pendingLiabilityAgeing: "Pending Liabilities",
};

const dashboardClickSelector = [
  'button[data-testid^="status-counter-"]',
  "button.rounded-md.px-2.py-1.font-semibold.text-primary",
  "button.rounded-md.border.border-border.bg-card.px-2.py-2.text-left",
  'button[aria-label^="Open "]',
  'button[aria-label^="Cleared:"]',
  'button[aria-label^="Current:"]',
  'button[aria-label^="Applicable:"]',
  'button[title^="Open files for"]',
  'button[title*="results in Search Files"]',
].join(",");

const reportClickSelector = [
  'button[aria-label^="Search files"]',
  'button[title^="Search files"]',
  'button[aria-label^="Open "]',
  'button[title^="Open "]',
  "table tbody button.text-primary",
  "table tfoot td button.rounded-md.px-2.py-1.font-semibold.text-primary",
].join(",");

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

async function api(path, token) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`${path} failed: ${body?.error ?? response.status}`);
  return body;
}

async function collectClickers(page, selector) {
  return page.locator(selector).evaluateAll((buttons) => {
    const occurrences = new Map();
    return buttons
    .map((button, index) => {
      const aria = button.getAttribute("aria-label") || "";
      const title = button.getAttribute("title") || "";
      const testId = button.getAttribute("data-testid") || "";
      const text = (button.innerText || button.textContent || "").trim().replace(/\s+/g, " ");
      const identity = testId ? `test:${testId}:${text}` : aria ? `aria:${aria}:${text}` : title ? `title:${title}:${text}` : "";
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" &&
        (typeof button.checkVisibility !== "function" || button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
      const identityOccurrence = identity ? occurrences.get(identity) ?? 0 : 0;
      if (identity && visible) occurrences.set(identity, identityOccurrence + 1);
      const numericText = /^(?:₹\s*)?\d[\d,]*(?:\.\d+)?$/.test(text);
      return {
      index,
      text,
      aria,
      title,
      testId,
      identityOccurrence,
      disabled: button.disabled || button.getAttribute("aria-disabled") === "true",
      numericCell: Boolean(button.closest("td")) && numericText,
      metricCard: button.classList.contains("text-left") && button.classList.contains("border-border") && button.classList.contains("bg-card"),
      metricResult: button.classList.contains("font-semibold") && button.classList.contains("text-primary") && numericText,
      identifierLink: Boolean(button.closest("td")) && button.classList.contains("text-primary") &&
        !numericText && !/^\d{4}-\d{2}$/.test(text) && Boolean(text),
      visible,
      };
    })
    .filter((button) => button.visible)
    .filter((button) => !button.disabled)
    .filter((button) => !/\bhelp\b/i.test(`${button.aria} ${button.title}`))
    .filter((button) => button.testId || button.numericCell || button.metricCard || button.metricResult || button.identifierLink ||
      /^(?:search files|open\s+\d|cleared:|current:|applicable:)/i.test(`${button.aria} ${button.title}`) ||
      /results in search files/i.test(`${button.aria} ${button.title}`))
    .filter((button) => button.text || button.aria || button.title)
    .filter((button) => {
      const countLike = button.testId.startsWith("status-counter-") ||
        button.numericCell || button.metricCard || button.metricResult || /^Open\s+\d/.test(button.aria);
      if (!countLike) return true;
      const values = [...button.text.matchAll(/[\d,]+(?:\.\d+)?/g)]
        .map((match) => Number(match[0].replaceAll(",", "")));
      return values.length === 0 || values.some((value) => value > 0);
    });
  });
}

function locatorFor(page, selector, item) {
  return page.locator(selector).nth(item.index);
}

function hasPositiveDisplayedValue(item) {
  const match = item.text.match(/[\d,]+(?:\.\d+)?/);
  return Boolean(match && Number(match[0].replaceAll(",", "")) > 0);
}

async function landingCheck(page, selector, item, context, expectedSelectedYear, issues, notes) {
  const sourceUrl = page.url();
  await locatorFor(page, selector, item).waitFor({ state: "visible", timeout: 4500 }).catch(() => undefined);
  const sourceCandidates = await collectClickers(page, selector);
    if (!sourceCandidates.some((candidate) =>
      (item.testId && candidate.testId === item.testId && candidate.text === item.text && candidate.identityOccurrence === item.identityOccurrence) ||
      (item.aria && candidate.aria === item.aria && candidate.text === item.text && candidate.identityOccurrence === item.identityOccurrence) ||
      (item.title && candidate.title === item.title && candidate.text === item.text && candidate.identityOccurrence === item.identityOccurrence) ||
      (!item.testId && !item.aria && !item.title && candidate.index === item.index && candidate.text === item.text)
    )) {
    issues.push({ type: "click-target-disappeared", context, click: item });
    return;
  }

  try {
    await locatorFor(page, selector, item).click({ timeout: 7000 });
    await page.waitForURL((url) => url.pathname.endsWith("/search") || url.pathname.endsWith("/add"), { timeout: 4000 }).catch(() => undefined);
    await page.waitForTimeout(100);
    const landedUrl = page.url();
    const landed = new URL(landedUrl);
    if (
      landed.pathname.endsWith("/dashboard") &&
      landed.searchParams.get("analyticsPanel") === "suspectedAnomaly"
    ) {
      const bodyText = await page.locator("body").innerText();
      if (!bodyText.toLowerCase().includes("suspected anomaly")) {
        issues.push({ type: "anomaly-count-did-not-open-anomaly-panel", context, click: item, landedUrl });
      }
      return;
    }
    if (!landedUrl.includes("/search") && !landedUrl.includes("/add")) {
      issues.push({ type: "click-did-not-open-search-or-file", context, click: item, landedUrl });
      return;
    }

    const url = new URL(landedUrl);
    const params = url.searchParams;
    const crumb = page.locator('nav[aria-label="Dashboard drill path"]');
    const crumbText = (await crumb.count()) ? (await crumb.innerText()).replace(/\s+/g, " ").trim() : "";
    const pathValue = params.get("drillPath");
    let pathItems = [];
    try {
      pathItems = pathValue ? JSON.parse(pathValue) : [];
      if (typeof pathItems === "string") pathItems = JSON.parse(pathItems);
      if (!Array.isArray(pathItems)) pathItems = [];
    } catch {}

    if (!pathItems.length || !crumbText) {
      issues.push({ type: "missing-breadcrumb", context, click: item, landedUrl });
    } else {
      const required = context.kind === "dashboard" ? "Dashboard" : "Reports";
      if (!crumbText.includes(required) || !pathItems.some((entry) => entry.label === required)) {
        issues.push({ type: "breadcrumb-lost-source-context", context, click: item, crumbText, pathItems });
      }
      const sourceLabel = context.label;
      if (sourceLabel && !crumbText.toLowerCase().includes(sourceLabel.toLowerCase())) {
        issues.push({ type: "breadcrumb-lost-page-context", context, click: item, crumbText });
      }
    }

    const usesExplicitSnapshotFileSet = (params.get("dashboardFilter") ?? "").startsWith("snapshotFileIds:");
    if (context.kind === "dashboard" && !usesExplicitSnapshotFileSet && params.get("selectedYear") !== expectedSelectedYear) {
      issues.push({
        type: "global-filter-not-preserved",
        context,
        click: item,
        expected: expectedSelectedYear,
        actual: params.get("selectedYear"),
        landedUrl,
      });
    }

    if (landedUrl.includes("/search")) {
      const hasFilterContext = Boolean(
        params.get("dashboardFilter") || params.get("analyticsType") || params.get("analyticsNames") ||
        params.get("analyticsPanel") || params.get("focusTarget"),
      );
      if (!hasFilterContext) {
        issues.push({ type: "search-landing-has-no-result-filter", context, click: item, landedUrl });
        return;
      }
      const hasExplicitFocus = Boolean(params.get("focusSection") || params.get("focusMilestone") || params.get("focusTarget"));
      const searchFilter = params.get("dashboardFilter") ?? "";
      const hasScopedLanding = Boolean(
        (searchFilter && searchFilter !== "totalFiles") || params.get("analyticsType") ||
        params.get("analyticsNames") || params.get("analyticsPanel") || params.get("fileIds"),
      );
      if (!hasExplicitFocus && !hasScopedLanding) {
        issues.push({ type: "search-landing-has-no-focused-section-or-result-filter", context, click: item, landedUrl });
      }
      if (context.verifyFileOpen) {
        const resultRoot = page.locator('[data-testid="search-results"]');
        await resultRoot.waitFor({ timeout: 10000 });
        const resultRows = page.locator('[data-testid^="search-result-"]');
        const resultCount = await resultRows.count();
        if (!resultCount && hasPositiveDisplayedValue(item)) {
          const bodyText = await page.locator("body").innerText();
          if (bodyText.includes("No files match your filters.")) {
            issues.push({ type: "positive-clicker-opened-empty-search", context, click: item, landedUrl });
          } else {
            issues.push({ type: "search-results-not-rendered", context, click: item, landedUrl });
          }
        }
        if (!resultCount) return;
        const firstRow = resultRows.first();
        await firstRow.click({ timeout: 7000 });
        await page.waitForURL((url) => url.pathname.endsWith("/add"), { timeout: 6000 }).catch(() => undefined);
        await page.locator('[data-testid^="add-section-"]').first().waitFor({ timeout: 6000 }).catch(() => undefined);
        await page.waitForTimeout(120);
        const fileUrl = new URL(page.url());
        if (!page.url().includes("/add") || !fileUrl.searchParams.get("fileId")) {
          issues.push({ type: "search-row-did-not-open-file", context, click: item, landedUrl: page.url() });
        } else if (!fileUrl.searchParams.get("section")) {
          issues.push({
            type: "file-detail-has-no-focused-section",
            context,
            click: item,
            fileId: fileUrl.searchParams.get("fileId"),
            dashboardFilter: params.get("dashboardFilter"),
            landedUrl: page.url(),
          });
        } else if (!hasExplicitFocus && !fileUrl.searchParams.get("focusTarget") && !fileUrl.searchParams.get("milestone")) {
          notes.push({ type: "file-opens-at-section-default-focus", context, click: item, fileId: fileUrl.searchParams.get("fileId"), section: fileUrl.searchParams.get("section") });
        }
        const detailCrumb = page.locator('nav[aria-label="Dashboard drill path"]');
        if (!(await detailCrumb.count())) {
          issues.push({ type: "file-detail-lost-breadcrumb", context, click: item, landedUrl: page.url() });
        } else {
          const detailText = (await detailCrumb.innerText()).replace(/\s+/g, " ").trim();
          if (!detailText.includes("Search Files")) {
            issues.push({ type: "file-detail-breadcrumb-lost-search", context, click: item, detailText, landedUrl: page.url() });
          }
          const required = context.kind === "dashboard" ? "Dashboard" : "Reports";
          if (!detailText.includes(required) || (context.label && !detailText.toLowerCase().includes(context.label.toLowerCase()))) {
            issues.push({ type: "file-detail-breadcrumb-lost-source", context, click: item, detailText, landedUrl: page.url() });
          }
        }
      }
    } else {
      if (!crumbText) {
        issues.push({ type: "file-detail-lost-breadcrumb", context, click: item, landedUrl });
      }
      if (landed.pathname.endsWith("/add") && !landed.searchParams.get("section")) {
        issues.push({ type: "file-detail-has-no-focused-section", context, click: item, landedUrl });
      }
    }
  } catch (error) {
    issues.push({
      type: "click-landing-check-failed",
      context,
      click: item,
      from: sourceUrl,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function returnToSource(page, sourceUrl, selector) {
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
  await page.locator(selector).first().waitFor({ timeout: 5000 }).catch(() => undefined);
  if (new URL(sourceUrl).searchParams.get("mode") === "cashOutGoPlan") {
    await expandCashOutGoSections(page);
  }
}

async function expandCashOutGoSections(page) {
  for (let index = 0; index < 20; index += 1) {
    const summary = page.locator("details:not([open]) > summary").first();
    if (!(await summary.count())) break;
    await summary.click({ timeout: 3000 }).catch(() => undefined);
  }
}

async function main() {
  const token = await login();
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome" });
  const context = await browser.newContext();
  const cookieHost = new URL(FRONTEND_URL).hostname;
  await context.addCookies([{
    name: "recordkeeper_session",
    value: token,
    domain: cookieHost,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();
  const issues = [];
  const notes = [];
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const { settings = {} } = await api("/api/settings", token);
  const selectedYear = String(settings.selectedYear ?? "");
  let checked = 0;
  let capped = false;
  const pageCoverage = [];

  try {
    for (const [tab, label] of startReportMode ? [] : dashboardTabs) {
      const url = `${FRONTEND_URL}/dashboard?tab=${encodeURIComponent(tab)}`;
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
      const selector = dashboardClickSelector;
      await page.locator(selector).first().waitFor({ timeout: 10000 }).catch(() => undefined);
      const clickers = await collectClickers(page, selector);
      pageCoverage.push({ kind: "dashboard", label, clickTargets: clickers.length });
      for (let index = 0; index < clickers.length; index += 1) {
        if (checked >= maxClicks) { capped = true; break; }
        const item = clickers[index];
        if (!item) continue;
        await landingCheck(page, selector, item, { kind: "dashboard", label, verifyFileOpen: index === 0 }, selectedYear, issues, notes);
        checked += 1;
        await returnToSource(page, url, selector);
      }
      process.stderr.write(`Browser audit: ${label}, ${clickers.length} actionable targets checked (total ${checked}).\n`);
      if (capped) break;
    }

    if (!capped) {
      const startIndex = startReportMode ? reportModes.indexOf(startReportMode) : 0;
      if (startIndex < 0) throw new Error(`Unknown AUDIT_BROWSER_START_MODE: ${startReportMode}`);
      for (const mode of reportModes.slice(startIndex)) {
        const url = `${FRONTEND_URL}/reports?mode=${encodeURIComponent(mode)}`;
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
        if (mode === "cashOutGoPlan") await expandCashOutGoSections(page);
        const clickers = await collectClickers(page, reportClickSelector);
        pageCoverage.push({ kind: "report", label: reportLabels[mode], clickTargets: clickers.length });
        for (let index = 0; index < clickers.length; index += 1) {
          if (checked >= maxClicks) { capped = true; break; }
          const item = clickers[index];
          if (!item) continue;
          const verifyFileOpen = index === 0;
          const searchRoute = "**/api/files/search?*";
          if (!verifyFileOpen) {
            await page.route(searchRoute, (route) => route.abort());
          }
          try {
            await landingCheck(page, reportClickSelector, item, { kind: "report", label: reportLabels[mode], verifyFileOpen }, selectedYear, issues, notes);
          } finally {
            if (!verifyFileOpen) await page.unroute(searchRoute).catch(() => undefined);
          }
          checked += 1;
          await returnToSource(page, url, reportClickSelector);
        }
        process.stderr.write(`Browser audit: ${reportLabels[mode]}, ${clickers.length} actionable targets checked (total ${checked}).\n`);
        if (capped) break;
      }
    }

    if (pageErrors.length) issues.push({ type: "browser-page-errors", errors: pageErrors });
    if (issues.length || capped) {
      await context.tracing.stop({ path: tracePath });
    } else {
      await context.tracing.stop();
    }
    console.log(JSON.stringify({
      frontend: FRONTEND_URL,
      selectedYear,
      dashboardTabs: dashboardTabs.length,
      visibleReportModes: reportModes.length,
      clicksChecked: checked,
      pageCoverage,
      capped,
      issues,
      notes: notes.slice(0, 100),
      trace: issues.length || capped ? tracePath : undefined,
    }, null, 2));
    if (issues.length || capped) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` },
    }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
