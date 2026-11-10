import { chromium } from "playwright";

const API_BASE_URL = process.env.BACKEND_URL ?? "http://localhost:3001";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:8081";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
// A zero limit means unlimited.  The former default of 600 silently stopped
// the audit part-way through the dashboard/report surface.
const maxClicks = Number(process.env.AUDIT_MAX_BROWSER_CLICKS ?? 0);
const tracePath = process.env.AUDIT_BROWSER_TRACE ?? "test-results/audit-clicker-landings-trace.zip";
const traceEnabled = Boolean(process.env.AUDIT_BROWSER_TRACE);
const navigationTimeout = Number(process.env.AUDIT_NAVIGATION_TIMEOUT ?? 90000);
const summaryReadyTimeout = Number(process.env.AUDIT_SUMMARY_READY_TIMEOUT ?? 90000);
// Report pages can legitimately have no drilldown buttons.  Waiting for the
// first clicker in that case made the audit spend the full 90-second summary
// timeout and incorrectly look like a selector failure.  Wait for the report
// surface itself, then give redesigned controls a short discovery grace.
const reportSurfaceReadyTimeout = Number(process.env.AUDIT_REPORT_SURFACE_TIMEOUT ?? 90000);
const reportClickerGraceTimeout = Number(process.env.AUDIT_REPORT_CLICKER_GRACE_TIMEOUT ?? 1500);
const startReportMode = process.env.AUDIT_BROWSER_START_MODE ?? "";
const endReportMode = process.env.AUDIT_BROWSER_END_MODE ?? "";
const startDashboardTab = process.env.AUDIT_BROWSER_START_TAB ?? "";
const endDashboardTab = process.env.AUDIT_BROWSER_END_TAB ?? "";
const dashboardOnly = process.env.AUDIT_DASHBOARD_ONLY === "1";
const auditScope = process.env.AUDIT_BROWSER_SCOPE ?? (dashboardOnly ? "dashboard" : "all");
const dashboardBatchSize = Number(process.env.AUDIT_DASHBOARD_BATCH_SIZE ?? 0);
const dashboardBatchIndex = Number(process.env.AUDIT_DASHBOARD_BATCH_INDEX ?? 0);
const reportBatchSize = Number(process.env.AUDIT_REPORT_BATCH_SIZE ?? 0);
const reportBatchIndex = Number(process.env.AUDIT_REPORT_BATCH_INDEX ?? 0);
// Surface-only mode is used to review every report individually without
// repeating the expensive landing check for every metric in a mode.  It
// still waits for the report to settle, classifies zero-click states, and
// records selector gaps; normal runs continue to verify every landing.
const reportSurfaceOnly = process.env.AUDIT_REPORT_SURFACE_ONLY === "1";

const activePlusCurrentFyClosedYear = "__active_plus_current_fy_closed__";

const dashboardTabs = [
  ["status", "Status-1"],
  ["liveStatus", "Status-2"],
  ["status3", "Status-3"],
  ["status4", "Status-4"],
  ["snapshot", "Snapshot"],
  ["analytics", "Analytics"],
  ["fyActivity", "FY Activity"],
  ["finance1", "FY Snapshot"],
];

const reportModes = [
  "mmgSummary", "demandProcessingAnalysis", "firmDatabase", "merData", "merComparison",
  "cashOutGoPlan", "preSoExpectedCashOutgo", "soPaymentMatrix", "paymentCompletedMatrix",
  "itemsDeliveredBillsPending", "itemsDeliveredBillsPrepared", "billsSubmitted",
  "expectedCashOutgoFy", "billsPaidInMonth", "pendingReturnedBills",
  "returnedBillsResubmitted", "returnedBillsPaid", "supplementaryBillsSubmitted",
  "supplementaryBillsPaid", "supplementaryPendingReturnedBills",
  "supplementaryReturnedBillsResubmitted", "supplementaryReturnedBillsPaid", "cashOutgoForMonth",
  "monthlyFileInflow", "monthWiseSupplyOrder",
  "monthWiseDeliverySchedule", "monthWiseBgExpiry", "bgReceiptDelay", "warrantyBgMismatch", "delayStatus",
];

const reportLabels = {
  mmgSummary: "MMG Summary",
  demandProcessingAnalysis: "Demand processing analysis",
  firmDatabase: "Firm Performance",
  merData: "MER Data",
  merComparison: "MER vs Recorded Payments",
  cashOutGoPlan: "Cash Out Go Plan",
  preSoExpectedCashOutgo: "Pre-S.O. based expected cash outgo",
  soPaymentMatrix: "Month-wise Payment due Matrix",
  paymentCompletedMatrix: "Month-wise Payment completed Matrix",
  itemsDeliveredBillsPending: "Delivery / D.P. Done, Bill Preparation Pending",
  itemsDeliveredBillsPrepared: "Delivery / D.P. Done, Bill Prepared",
  billsSubmitted: "Bills Submitted, Payment Pending",
  expectedCashOutgoFy: "Expected Cash Outgo by D.P.",
  billsPaidInMonth: "Bills Paid in Selected Month",
  pendingReturnedBills: "Pending returned bills",
  returnedBillsResubmitted: "Returned bills resubmitted and unpaid",
  returnedBillsPaid: "Returned bills paid",
  supplementaryBillsSubmitted: "Supplementary bills submitted, payment pending",
  supplementaryBillsPaid: "Supplementary bills paid",
  supplementaryPendingReturnedBills: "Pending returned supplementary bills",
  supplementaryReturnedBillsResubmitted: "Returned supplementary bills resubmitted",
  supplementaryReturnedBillsPaid: "Returned supplementary bills paid",
  cashOutgoForMonth: "Expected cash outgo exclusively for selected month",
  monthlyFileInflow: "Monthly file inflow",
  monthWiseSupplyOrder: "Month-wise Supply Order",
  monthWiseDeliverySchedule: "Month-wise Delivery / Contract Period Schedule",
  monthWiseBgExpiry: "BG Expiry",
  bgReceiptDelay: "BG receipt delay",
  warrantyBgMismatch: "Warranty / BG mismatch",
  delayStatus: "Delay Status",
};

const breadcrumbAliases = {
  "Expected cash outgo exclusively for selected month": "Expected Cash Outgo in",
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
  // Some report cards use a neutral foreground colour instead of
  // `text-primary` while remaining real Search drilldowns (for example
  // Demand Processing age buckets and payment metric cards).
  "main button.rounded-md.border.border-border.bg-secondary\\/20.text-left",
  "main button.block.text-left.text-lg.font-semibold",
  // Firm Performance summary cards use a plain block/text-left button and
  // intentionally omit the metric-card colour classes.
  "main button.block.w-full.text-left",
].join(",");

function expectedDashboardSelectedYear(tab, settings, initialSelectedYear, previousExpectedYear) {
  // Status tabs deliberately switch the global scope to the operational
  // dashboard scope: active files plus files closed in the current FY. The
  // settings endpoint may still expose the user's previous global choice
  // (often All Active Files), so using that value for the landing assertion
  // creates a false global-filter warning.
  if (["status", "liveStatus", "status3", "status4"].includes(tab)) {
    return activePlusCurrentFyClosedYear;
  }

  // Snapshot, FY Snapshot, and the default Analytics panel reset the global
  // scope to the current financial year when they mount.
  if (["snapshot", "finance1", "analytics", "fyActivity"].includes(tab)) {
    return String(settings.financialYear ?? initialSelectedYear ?? "");
  }

  return previousExpectedYear ?? initialSelectedYear;
}

function sliceBatch(items, size, index, name) {
  if (!Number.isFinite(size) || size <= 0) return items;
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`${name}_BATCH_INDEX must be a non-negative integer`);
  }
  const start = index * size;
  return items.slice(start, start + size);
}

function limitReached(checked) {
  return maxClicks > 0 && checked >= maxClicks;
}

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
      // Report summary cards often put the metric after a descriptive label
      // (for example, "Supply orders 174") rather than on its own line.
      // Match a numeric suffix so those real drilldowns are not mistaken for
      // a report with no clickable results.
      const reportMetricText = /(?:₹\s*)?\d[\d,]*(?:\.\d+)?\s*$/.test(text);
      return {
      index,
      text,
      aria,
      title,
      testId,
      identityOccurrence,
      disabled: button.disabled || button.getAttribute("aria-disabled") === "true",
      numericCell: Boolean(button.closest("td")) && numericText,
      // A numeric button is a landing target only when it has an explicit
      // landing affordance.  Plain numeric cells are presentation values and
      // must not inflate browser-audit coverage.
      actionableNumericCell: Boolean(button.closest("td")) && numericText && (
        Boolean(aria || title || testId) ||
        button.classList.contains("text-primary") ||
        Boolean(button.closest("tfoot"))
      ),
      metricCard: button.classList.contains("text-left") && button.classList.contains("border-border") && button.classList.contains("bg-card"),
      metricResult: button.classList.contains("font-semibold") && button.classList.contains("text-primary") && numericText,
      reportCard: !button.disabled && (
        (button.classList.contains("text-left") && button.classList.contains("border-border") && button.classList.contains("bg-secondary/20")) ||
        (button.classList.contains("block") && button.classList.contains("text-lg") && button.classList.contains("font-semibold") && numericText) ||
        (button.classList.contains("block") && button.classList.contains("w-full") && button.classList.contains("text-left") && reportMetricText)
      ),
      identifierLink: Boolean(button.closest("td")) && button.classList.contains("text-primary") &&
        !numericText && !/^\d{4}-\d{2}$/.test(text) && Boolean(text),
      visible,
      };
    })
    .filter((button) => button.visible)
    .filter((button) => !button.disabled)
    .filter((button) => !/\bhelp\b/i.test(`${button.aria} ${button.title}`))
    .filter((button) => button.testId || button.actionableNumericCell || button.metricCard || button.metricResult || button.reportCard || button.identifierLink ||
      /^(?:search files|open\s+\d|cleared:|current:|applicable:)/i.test(`${button.aria} ${button.title}`) ||
      /results in search files/i.test(`${button.aria} ${button.title}`))
    .filter((button) => button.text || button.aria || button.title)
    .filter((button) => {
      const countLike = button.testId.startsWith("status-counter-") ||
        button.actionableNumericCell || button.metricCard || button.metricResult || button.reportCard || /^Open\s+\d/.test(button.aria);
      if (!countLike) return true;
      const values = [...button.text.matchAll(/[\d,]+(?:\.\d+)?/g)]
        .map((match) => Number(match[0].replaceAll(",", "")));
      return values.length === 0 || values.some((value) => value > 0);
    });
  });
}

async function dismissUrgentPopup(page) {
  const dialog = page.getByRole("dialog", { name: "Urgent reminders and messages" });
  if (!(await dialog.isVisible({ timeout: 750 }).catch(() => false))) return false;
  const close = dialog.getByRole("button", { name: "Close urgent reminders and messages" });
  if (!(await close.isVisible({ timeout: 750 }).catch(() => false))) return false;
  await close.click({ timeout: 3000 }).catch(() => undefined);
  await dialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => undefined);
  return true;
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
  await dismissUrgentPopup(page);
  await locatorFor(page, selector, item).waitFor({ state: "visible", timeout: 4500 }).catch(() => undefined);
  const sourceCandidates = await collectClickers(page, selector);
    if (!sourceCandidates.some((candidate) =>
      (item.testId && candidate.testId === item.testId && candidate.text === item.text && candidate.identityOccurrence === item.identityOccurrence) ||
      (item.aria && candidate.aria === item.aria && candidate.text === item.text && candidate.identityOccurrence === item.identityOccurrence) ||
      (item.title && candidate.title === item.title && candidate.text === item.text && candidate.identityOccurrence === item.identityOccurrence) ||
      (!item.testId && !item.aria && !item.title && candidate.index === item.index && candidate.text === item.text)
    )) {
    // Summaries can refresh between collection and the click (for example after
    // a late filter hydration). It is not a navigation defect if that stale
    // number is no longer rendered; record it separately and continue.
    notes.push({ type: "click-target-refreshed-away", context, click: item });
    return;
  }

  try {
    await locatorFor(page, selector, item).click({ timeout: 7000 });
    await page.waitForURL((url) => url.pathname.endsWith("/search") || url.pathname.endsWith("/add"), { timeout: 4000 }).catch(() => undefined);
    await dismissUrgentPopup(page);
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
    await crumb.waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
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
      const sourceLabel = breadcrumbAliases[context.label] ?? context.label;
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
        const resultRows = page.locator('[data-testid^="search-result-"]');
        await resultRoot.waitFor({ timeout: 30000 }).catch(() => undefined);
        let resultCount = 0;
        let empty = false;
        const searchStarted = Date.now();
        while (Date.now() - searchStarted < 30000) {
          resultCount = await resultRows.count().catch(() => 0);
          if (resultCount > 0) break;
          const bodyText = await page.locator("body").innerText().catch(() => "");
          if (bodyText.includes("No files match your filters.")) {
            empty = true;
            break;
          }
          await page.waitForTimeout(500);
        }
        if (!resultCount && hasPositiveDisplayedValue(item)) {
          const bodyText = await page.locator("body").innerText();
          if (empty || bodyText.includes("No files match your filters.")) {
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
          const sourceLabel = breadcrumbAliases[context.label] ?? context.label;
          if (!detailText.includes(required) || (sourceLabel && !detailText.toLowerCase().includes(sourceLabel.toLowerCase()))) {
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
  // Always reload the source route. Browser-history/bfcache can restore the
  // correct URL with stale React state (wrong dashboard tab or report mode),
  // which makes the next click target collection unreliable.
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeout }).catch(() => undefined);
  await dismissUrgentPopup(page);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
  const source = new URL(sourceUrl);
  if (source.pathname.endsWith("/dashboard")) {
    await waitForDashboardTab(page, source.searchParams.get("tab") || "status");
  }
  await page.locator(selector).first().waitFor({ timeout: 5000 }).catch(() => undefined);
  if (source.searchParams.get("mode") === "cashOutGoPlan") {
    await expandCashOutGoSections(page);
  }
}

async function navigateTo(page, url, context, issues) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
    return true;
  } catch (error) {
    issues.push({
      type: "page-navigation-failed",
      context,
      url,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function waitForDashboardTab(page, tab) {
  const tabButton = page.locator(`[data-testid="dashboard-tab-${tab}"]`);
  await tabButton.waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
  await page.waitForFunction(
    (key) => {
      const button = document.querySelector(`[data-testid="dashboard-tab-${key}"]`);
      return Boolean(button && button.className.includes("bg-secondary"));
    },
    tab,
    { timeout: 15000 },
  ).catch(() => undefined);
  await page.waitForTimeout(250);
}

async function waitForRenderedClickers(page, selector) {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: summaryReadyTimeout }).catch(() => undefined);
}

async function waitForReportSurface(page, label) {
  const deadline = Date.now() + reportSurfaceReadyTimeout;
  const labelPattern = label ? new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
  while (Date.now() < deadline) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const hasReportLabel = labelPattern ? labelPattern.test(bodyText) : false;
    const hasEmptyState = /\bno (?:data|rows|records|firms|bills|files|expected cash outgo|delayed stages)\b/i.test(bodyText);
    const hasReportStructure = await page.locator("main table, main [role=table], main h1, main h2, main [data-testid*='report']").count().catch(() => 0);
    const stillLoading = /\b(?:loading|calculating|updating .*report)\.\.\./i.test(bodyText);
    if ((hasReportLabel || hasEmptyState || hasReportStructure > 0) && !stillLoading) return;
    await page.waitForTimeout(250);
  }
}

async function inspectReportClickSurface(page, selector) {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const tableRows = await page.locator("main table tbody tr, main table tfoot tr").count().catch(() => 0);
  const emptyState = /\b(?:no data available|no rows found|no records found|no firms found|no bills paid found|no expected cash outgo rows found|no delayed stages found|no files match your filters|select .* and wait|choose .* to)\b/i.test(bodyText);
  const loading = /\b(?:loading|calculating|updating .*report)\.\.\./i.test(bodyText);
  const selectedClickers = await collectClickers(page, selector);
  const broadLandingCandidates = await page.locator("main button, main a, main [role=button]").evaluateAll((elements) => {
    const excluded = /\b(?:pdf|excel|refresh|calculate|stop|reset|table|bar|line|pie|select sections|sequence|rotation|download|export|save|cancel|clear|select all|global rules)\b/i;
    return elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const text = (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ");
      const aria = element.getAttribute("aria-label") || "";
      const title = element.getAttribute("title") || "";
      const href = element.getAttribute("href") || "";
      const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      const tableCell = Boolean(element.closest("td,th"));
      const numeric = /^(?:₹\s*)?\d[\d,.]*(?:\s*\([^)]*\))?$/.test(text);
      const landingLabel = `${text} ${aria} ${title}`;
      const likelyLanding = visible && !element.disabled && !excluded.test(landingLabel) && (
        /search files|open files|results in search|open \d/i.test(landingLabel) ||
        href.includes("/search") ||
        (tableCell && (numeric || element.classList.contains("text-primary"))) ||
        (element.classList.contains("block") && element.classList.contains("w-full") && element.classList.contains("text-left") && /(?:₹\s*)?\d[\d,.]*(?:\s*\([^)]*\))?\s*$/.test(text)) ||
        element.getAttribute("data-testid")?.match(/(?:counter|click|search|report)/i)
      );
      return likelyLanding ? { text, aria, title, href } : null;
    }).filter(Boolean);
  }).catch(() => []);

  let classification = "no-clickable-results";
  if (selectedClickers.length > 0) classification = "non-zero-clickers";
  else if (broadLandingCandidates.length > 0) classification = "selector-gap";
  else if (loading) classification = "not-ready";
  else if (emptyState || tableRows === 0) classification = "no-data";

  return {
    classification,
    clickers: selectedClickers,
    broadLandingCandidates,
    tableRows,
    emptyState,
    loading,
    bodyPreview: bodyText.replace(/\s+/g, " ").slice(0, 400),
  };
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
  if (traceEnabled) {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  }
  const page = await context.newPage();
  await page.addLocatorHandler(
    page.getByRole("dialog", { name: "Urgent reminders and messages" }),
    async (dialog) => {
      const close = dialog.getByRole("button", { name: "Close urgent reminders and messages" });
      if (await close.isVisible().catch(() => false)) await close.click().catch(() => undefined);
    },
    { noWaitAfter: true },
  );
  const issues = [];
  const notes = [];
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const { settings = {} } = await api("/api/settings", token);
  const selectedYear = String(settings.selectedYear ?? "");
  let checked = 0;
  let capped = false;
  let verifiedFileOpen = false;
  const pageCoverage = [];
  let previousExpectedDashboardYear;

  try {
    const dashboardStartIndex = startDashboardTab ? dashboardTabs.findIndex(([tab]) => tab === startDashboardTab) : 0;
    const dashboardEndIndex = endDashboardTab ? dashboardTabs.findIndex(([tab]) => tab === endDashboardTab) : dashboardTabs.length - 1;
    if (dashboardStartIndex < 0) throw new Error(`Unknown AUDIT_BROWSER_START_TAB: ${startDashboardTab}`);
    if (dashboardEndIndex < 0) throw new Error(`Unknown AUDIT_BROWSER_END_TAB: ${endDashboardTab}`);
    if (dashboardEndIndex < dashboardStartIndex) throw new Error("AUDIT_BROWSER_END_TAB must not precede AUDIT_BROWSER_START_TAB");
    const selectedDashboardTabs = sliceBatch(
      dashboardTabs.slice(dashboardStartIndex, dashboardEndIndex + 1),
      dashboardBatchSize,
      dashboardBatchIndex,
      "AUDIT_DASHBOARD",
    );
    const shouldAuditDashboard = auditScope === "all" || auditScope === "dashboard";
    const shouldAuditReports = auditScope === "all" || auditScope === "reports";
    if (!shouldAuditDashboard && !shouldAuditReports) {
      throw new Error(`AUDIT_BROWSER_SCOPE must be all, dashboard, or reports (received: ${auditScope})`);
    }

    for (const [tab, label] of shouldAuditDashboard && !startReportMode ? selectedDashboardTabs : []) {
      const url = `${FRONTEND_URL}/dashboard?tab=${encodeURIComponent(tab)}`;
      if (!(await navigateTo(page, url, { kind: "dashboard", label }, issues))) continue;
      await dismissUrgentPopup(page);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
      await waitForDashboardTab(page, tab);
      const selector = dashboardClickSelector;
      await waitForRenderedClickers(page, selector);
      const clickers = await collectClickers(page, selector);
      const expectedDashboardYear = expectedDashboardSelectedYear(
        tab,
        settings,
        selectedYear,
        previousExpectedDashboardYear,
      );
      previousExpectedDashboardYear = expectedDashboardYear;
      pageCoverage.push({
        kind: "dashboard",
        label,
        clickTargets: clickers.length,
        expectedSelectedYear: expectedDashboardYear,
      });
      for (let index = 0; index < clickers.length; index += 1) {
        if (limitReached(checked)) { capped = true; break; }
        const item = clickers[index];
        if (!item) continue;
        const verifyFileOpen = !verifiedFileOpen;
        await landingCheck(
          page,
          selector,
          item,
          { kind: "dashboard", label, verifyFileOpen },
          expectedDashboardYear,
          issues,
          notes,
        );
        if (verifyFileOpen) verifiedFileOpen = true;
        checked += 1;
        await returnToSource(page, url, selector);
      }
      process.stderr.write(
        `Browser audit: ${label}, ${clickers.length} actionable targets checked (total ${checked}, expected global scope ${expectedDashboardYear}).\n`,
      );
      if (capped) break;
    }

    if (!capped && shouldAuditReports) {
      const startIndex = startReportMode ? reportModes.indexOf(startReportMode) : 0;
      if (startIndex < 0) throw new Error(`Unknown AUDIT_BROWSER_START_MODE: ${startReportMode}`);
      const endIndex = endReportMode ? reportModes.indexOf(endReportMode) : reportModes.length - 1;
      if (endIndex < 0) throw new Error(`Unknown AUDIT_BROWSER_END_MODE: ${endReportMode}`);
      if (endIndex < startIndex) {
        throw new Error(`AUDIT_BROWSER_END_MODE must not precede AUDIT_BROWSER_START_MODE`);
      }
      const selectedReportModes = sliceBatch(
        reportModes.slice(startIndex, endIndex + 1),
        reportBatchSize,
        reportBatchIndex,
        "AUDIT_REPORT",
      );
      for (const mode of selectedReportModes) {
        const url = `${FRONTEND_URL}/reports?mode=${encodeURIComponent(mode)}`;
        if (!(await navigateTo(page, url, { kind: "report", label: reportLabels[mode], mode }, issues))) continue;
        await dismissUrgentPopup(page);
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
        if (mode === "cashOutGoPlan") await expandCashOutGoSections(page);
        await waitForReportSurface(page, reportLabels[mode]);
        await page.waitForTimeout(reportClickerGraceTimeout);
        const surface = await inspectReportClickSurface(page, reportClickSelector);
        const clickers = surface.clickers;
        pageCoverage.push({
          kind: "report",
          mode,
          label: reportLabels[mode],
          clickTargets: clickers.length,
          zeroClickerState: clickers.length ? undefined : surface.classification,
          tableRows: surface.tableRows,
          broadLandingCandidates: surface.broadLandingCandidates.length,
        });
        if (!clickers.length) {
          const zeroContext = {
            kind: "report",
            mode,
            label: reportLabels[mode],
            tableRows: surface.tableRows,
            broadLandingCandidates: surface.broadLandingCandidates,
            bodyPreview: surface.bodyPreview,
          };
          if (surface.classification === "selector-gap") {
            issues.push({ type: "report-zero-clickers-selector-gap", context: zeroContext });
          } else {
            notes.push({
              type: "report-zero-clickers-reviewed",
              state: surface.classification,
              context: zeroContext,
            });
          }
        }
        if (reportSurfaceOnly) {
          process.stderr.write(
            `Browser audit: ${reportLabels[mode]}, ${clickers.length} actionable targets checked` +
            `${clickers.length ? " (surface-only)" : ` (zero-click state: ${surface.classification})`}` +
            ` (total ${checked}).\n`,
          );
          continue;
        }
        for (let index = 0; index < clickers.length; index += 1) {
          if (limitReached(checked)) { capped = true; break; }
          const item = clickers[index];
          if (!item) continue;
          const verifyFileOpen = !verifiedFileOpen;
          const searchRoute = "**/api/files/search?*";
          if (!verifyFileOpen) {
            await page.route(searchRoute, (route) => route.abort());
          }
          try {
            await landingCheck(page, reportClickSelector, item, { kind: "report", label: reportLabels[mode], verifyFileOpen }, selectedYear, issues, notes);
          } finally {
            if (!verifyFileOpen) await page.unroute(searchRoute).catch(() => undefined);
          }
          if (verifyFileOpen) verifiedFileOpen = true;
          checked += 1;
          await returnToSource(page, url, reportClickSelector);
        }
        process.stderr.write(
          `Browser audit: ${reportLabels[mode]}, ${clickers.length} actionable targets checked` +
          `${clickers.length ? "" : ` (zero-click state: ${surface.classification})`}` +
          ` (total ${checked}).\n`,
        );
        if (capped) break;
      }
    }

    if (pageErrors.length) issues.push({ type: "browser-page-errors", errors: pageErrors });
    if (traceEnabled) {
      if (issues.length || capped) {
        await context.tracing.stop({ path: tracePath });
      } else {
        await context.tracing.stop();
      }
    }
    console.log(JSON.stringify({
      frontend: FRONTEND_URL,
      selectedYear,
      auditScope,
      dashboardBatch: dashboardBatchSize > 0 ? { index: dashboardBatchIndex, size: dashboardBatchSize } : undefined,
      reportBatch: reportBatchSize > 0 ? { index: reportBatchIndex, size: reportBatchSize } : undefined,
      reportSurfaceOnly,
      dashboardTabs: dashboardTabs.length,
      visibleReportModes: reportModes.length,
      clicksChecked: checked,
      pageCoverage,
      capped,
      issues,
      notes: notes.slice(0, 100),
      trace: traceEnabled && (issues.length || capped) ? tracePath : undefined,
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
