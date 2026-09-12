const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";

const allFiles = "__all_files__";
const allActiveFiles = "__all_active_files__";
const activePlusCurrentFyClosed = "__active_plus_current_fy_closed__";

const defaultCategories = "goodsServices,amc,mpc,cars,om";
const customCategories =
  "fileType:CAPSI,fileType:DcPP%20(Contract),fileType:DcPP%20(G%26S),fileType:I%26M%20(Contract),fileType:I%26M%20(G%26S)";
const allConfiguredCategories = `${defaultCategories},${customCategories}`;

const additiveFields = [
  "allocatedCapital",
  "allocatedRevenue",
  "bookedCapital",
  "bookedRevenue",
  "projectedCapital",
  "projectedRevenue",
  "spentCapital",
  "spentRevenue",
  "paidCapital",
  "paidRevenue",
  "sameYearPaidCapital",
  "sameYearPaidRevenue",
  "advanceCapital",
  "advanceRevenue",
];

const transactionalFields = additiveFields.filter((field) => !field.startsWith("allocated"));
const nestedFields = [
  "carryForward",
  "clearedCarryForward",
  "previousCarryForward",
  "futureClearedCarryForward",
];

function n(value) {
  return Number(value ?? 0) || 0;
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function login() {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`login failed ${response.status}: ${body?.error ?? "unknown error"}`);
  const cookie = response.headers.get("set-cookie") ?? "";
  const match = cookie.match(/recordkeeper_session=([^;]+)/);
  if (!match) throw new Error("login did not return recordkeeper_session cookie");
  return decodeURIComponent(match[1]);
}

async function api(path, token) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`${path} failed ${response.status}: ${body?.error ?? "unknown error"}`);
  return body;
}

function dashboardPath(pass) {
  const params = new URLSearchParams({
    version: "8",
    selectedYear: pass.selectedYear,
    division: pass.division ?? "all",
  });
  if (pass.fileYear) params.set("fileYear", pass.fileYear);
  if (pass.fileCategories !== undefined) params.set("fileCategories", pass.fileCategories);
  if (pass.fileInitiationFrom) params.set("fileInitiationFrom", pass.fileInitiationFrom);
  if (pass.fileInitiationTo) params.set("fileInitiationTo", pass.fileInitiationTo);
  return `/api/dashboard/summary?${params.toString()}`;
}

function searchPath(pass, dashboardFilter) {
  const params = new URLSearchParams({
    selectedYear: pass.selectedYear,
    dashboardFilter,
    page: "1",
    pageSize: "500",
  });
  if (pass.division && pass.division !== "all") params.set("division", pass.division);
  if (pass.fileYear) params.set("fileYear", pass.fileYear);
  if (pass.fileCategories !== undefined) params.set("fileCategories", pass.fileCategories);
  if (pass.fileInitiationFrom) params.set("fileInitiationFrom", pass.fileInitiationFrom);
  if (pass.fileInitiationTo) params.set("fileInitiationTo", pass.fileInitiationTo);
  return `/api/files/search?${params.toString()}`;
}

function addIssue(issues, pass, area, detail) {
  issues.push({ pass: pass.name, selectedYear: pass.selectedYear, division: pass.division ?? "all", area, ...detail });
}

function validateSummary(pass, summary, issues) {
  const totals = summary.financeTotals ?? {};
  for (const field of additiveFields) {
    const value = n(totals[field]);
    if (!Number.isFinite(value)) addIssue(issues, pass, "financeTotals", { field, issue: "not finite", value: totals[field] });
    if (value < 0) addIssue(issues, pass, "financeTotals", { field, issue: "negative value", value });
  }

  for (const key of nestedFields) {
    const total = totals[key] ?? {};
    if (round(n(total.capital) + n(total.revenue)) !== round(n(total.total))) {
      addIssue(issues, pass, key, {
        issue: "total does not equal capital + revenue",
        capital: n(total.capital),
        revenue: n(total.revenue),
        total: n(total.total),
      });
    }
    const rows = totals[`${key}Breakup`] ?? [];
    const rowSum = rows.reduce(
      (sum, row) => ({
        count: sum.count + n(row.count),
        capital: sum.capital + n(row.capital),
        revenue: sum.revenue + n(row.revenue),
        total: sum.total + n(row.total),
      }),
      { count: 0, capital: 0, revenue: 0, total: 0 },
    );
    for (const field of ["count", "capital", "revenue", "total"]) {
      if (round(rowSum[field]) !== round(n(total[field]))) {
        addIssue(issues, pass, `${key}Breakup`, {
          field,
          issue: "breakup does not sum to panel total",
          expected: round(n(total[field])),
          actual: round(rowSum[field]),
        });
      }
    }
  }

  const percents = summary.financePercents ?? {};
  const percentChecks = [
    ["capitalBooked", totals.bookedCapital, totals.allocatedCapital],
    ["revenueBooked", totals.bookedRevenue, totals.allocatedRevenue],
    ["capitalProjected", totals.projectedCapital, totals.allocatedCapital],
    ["revenueProjected", totals.projectedRevenue, totals.allocatedRevenue],
    ["capitalSpent", totals.spentCapital, totals.allocatedCapital],
    ["revenueSpent", totals.spentRevenue, totals.allocatedRevenue],
  ];
  for (const [key, value, denominator] of percentChecks) {
    const expected = n(denominator) > 0 ? (n(value) / n(denominator)) * 100 : 0;
    if (Math.abs(round(expected) - round(percents[key])) > 0.01) {
      addIssue(issues, pass, "financePercents", { key, expected: round(expected), actual: round(percents[key]) });
    }
  }

  for (const [key, rows] of Object.entries(summary.financeFirmTypeDistributions ?? {})) {
    const total = Array.isArray(rows) ? rows.reduce((sum, row) => sum + n(row.value), 0) : 0;
    const share = Array.isArray(rows) ? rows.reduce((sum, row) => sum + n(row.share), 0) : 0;
    if (total > 0 && Math.abs(share - 100) > 0.05) {
      addIssue(issues, pass, "firmTypeDistribution", { key, issue: "shares do not total 100", share: round(share) });
    }
    if (key === "supplyOrderValue") {
      const expected = n(totals.spentCapital) + n(totals.spentRevenue);
      if (round(total) !== round(expected)) {
        addIssue(issues, pass, "firmTypeDistribution", {
          key,
          issue: "S.O. value distribution does not match committed value",
          expected: round(expected),
          actual: round(total),
        });
      }
    }
  }
}

async function validateCarryForwardClickers(token, pass, summary, issues) {
  const totals = summary.financeTotals ?? {};
  for (const key of nestedFields) {
    for (const row of totals[`${key}Breakup`] ?? []) {
      if (!row.filter) {
        addIssue(issues, pass, key, { year: row.year, issue: "missing filter" });
        continue;
      }
      if (n(row.count) <= 0 && n(row.total) <= 0) continue;
      const search = await api(searchPath(pass, row.filter), token);
      const fileCount = n(search.total);
      if (fileCount <= 0) {
        addIssue(issues, pass, key, { year: row.year, filter: row.filter, issue: "clicker opens zero files" });
      }
      if (fileCount > n(row.count)) {
        addIssue(issues, pass, key, {
          year: row.year,
          filter: row.filter,
          issue: "clicker file count exceeds payment-row count",
          rowCount: n(row.count),
          fileCount,
        });
      }
    }
  }
}

function compareSum(issues, basePass, baseSummary, parts, fields, area) {
  const baseTotals = baseSummary.financeTotals ?? {};
  for (const field of fields) {
    const actual = round(parts.reduce((sum, item) => sum + n(item.summary.financeTotals?.[field]), 0));
    const expected = round(n(baseTotals[field]));
    if (actual !== expected) {
      addIssue(issues, basePass, area, { field, issue: "partition mismatch", expected, actual });
    }
  }
  for (const key of nestedFields) {
    for (const subfield of ["count", "capital", "revenue", "total"]) {
      const actual = round(parts.reduce((sum, item) => sum + n(item.summary.financeTotals?.[key]?.[subfield]), 0));
      const expected = round(n(baseTotals[key]?.[subfield]));
      if (actual !== expected) {
        addIssue(issues, basePass, area, { field: `${key}.${subfield}`, issue: "partition mismatch", expected, actual });
      }
    }
  }
}

async function main() {
  const token = await login();
  const issues = [];
  const corePasses = [
    { name: "all active", selectedYear: allActiveFiles },
    { name: "active + current FY closed", selectedYear: activePlusCurrentFyClosed },
    { name: "entire database", selectedYear: allFiles },
    { name: "FY 2026-27", selectedYear: "2026-27" },
    { name: "FY 2025-26", selectedYear: "2025-26" },
    { name: "FY 2026-27 + initiation Apr-Jun", selectedYear: "2026-27", fileInitiationFrom: "2026-04-01", fileInitiationTo: "2026-06-30" },
    { name: "FY 2026-27 + empty future initiation", selectedYear: "2026-27", fileInitiationFrom: "2035-01-01", fileInitiationTo: "2035-12-31" },
  ];
  const divisions = ["all", "ACC", "CSeG", "SCPC"];
  const categoryPasses = [
    { name: "all configured categories", fileCategories: allConfiguredCategories },
    { name: "default categories", fileCategories: defaultCategories },
    { name: "custom categories", fileCategories: customCategories },
    { name: "custom I&M G&S only", fileCategories: "fileType:I%26M%20(G%26S)" },
  ];

  const summaries = new Map();
  const checked = [];

  for (const pass of corePasses) {
    for (const division of divisions) {
      const combo = { ...pass, name: `${pass.name} / ${division}`, division };
      const payload = await api(dashboardPath(combo), token);
      const summary = payload.summary ?? {};
      summaries.set(combo.name, { pass: combo, summary });
      checked.push(combo.name);
      validateSummary(combo, summary, issues);
      await validateCarryForwardClickers(token, combo, summary, issues);
    }
  }

  for (const category of categoryPasses) {
    const combo = { ...category, selectedYear: allActiveFiles, division: "all" };
    const payload = await api(dashboardPath(combo), token);
    const summary = payload.summary ?? {};
    summaries.set(category.name, { pass: combo, summary });
    checked.push(category.name);
    validateSummary(combo, summary, issues);
    await validateCarryForwardClickers(token, combo, summary, issues);
  }

  const allConfigured = summaries.get("all configured categories");
  const defaultOnly = summaries.get("default categories");
  const customOnly = summaries.get("custom categories");
  if (allConfigured && defaultOnly && customOnly) {
    compareSum(issues, allConfigured.pass, allConfigured.summary, [defaultOnly, customOnly], transactionalFields, "category partition");
  }

  for (const baseName of corePasses.map((pass) => pass.name)) {
    const all = summaries.get(`${baseName} / all`);
    const parts = ["ACC", "CSeG", "SCPC"].map((division) => summaries.get(`${baseName} / ${division}`)).filter(Boolean);
    if (all && parts.length === 3) {
      compareSum(issues, all.pass, all.summary, parts, additiveFields, "division partition");
    }
  }

  const sample = Array.from(summaries.values()).map(({ pass, summary }) => {
    const totals = summary.financeTotals ?? {};
    return {
      pass: pass.name,
      files: summary.dashboardFileCount,
      intended: round(n(totals.projectedCapital) + n(totals.projectedRevenue)),
      booked: round(n(totals.bookedCapital) + n(totals.bookedRevenue)),
      committed: round(n(totals.spentCapital) + n(totals.spentRevenue)),
      paymentInFy: round(n(totals.paidCapital) + n(totals.paidRevenue)),
      carryForward: round(n(totals.carryForward?.total)),
      previousCarryForward: round(n(totals.previousCarryForward?.total)),
    };
  });

  await fetch(`${API_BASE_URL}/api/auth/logout`, {
    method: "POST",
    headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` },
  }).catch(() => undefined);

  console.log(JSON.stringify({ checkedCount: checked.length, checked, sample, issues }, null, 2));
  if (issues.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
