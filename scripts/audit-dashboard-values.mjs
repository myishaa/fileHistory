const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
const defaultCategories = "goodsServices,amc,mpc,cars,om";
const allCustomCategories =
  "fileType:CAPSI,fileType:DcPP%20(Contract),fileType:DcPP%20(G%26S),fileType:I%26M%20(Contract),fileType:I%26M%20(G%26S)";
const allConfiguredCategories = `${defaultCategories},${allCustomCategories}`;
const selectedFinanceYear = "2026-27";

const additiveFinanceFields = [
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

const nestedTotals = [
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
    version: "5",
    selectedYear: pass.selectedYear ?? "__all_active_files__",
    division: pass.division ?? "all",
  });
  if (pass.fileCategories !== undefined) params.set("fileCategories", pass.fileCategories);
  return `/api/dashboard/summary?${params.toString()}`;
}

function searchPath(pass, dashboardFilter) {
  const params = new URLSearchParams({
    selectedYear: pass.selectedYear ?? "__all_active_files__",
    dashboardFilter,
    page: "1",
    pageSize: "500",
  });
  if (pass.division && pass.division !== "all") params.set("division", pass.division);
  if (pass.fileCategories !== undefined) params.set("fileCategories", pass.fileCategories);
  return `/api/files/search?${params.toString()}`;
}

function checkNestedTotal(issues, pass, totals, key) {
  const row = totals[key] ?? {};
  const capital = round(n(row.capital));
  const revenue = round(n(row.revenue));
  const total = round(n(row.total));
  if (round(capital + revenue) !== total) {
    issues.push({ pass, area: key, issue: "total does not equal capital + revenue", capital, revenue, total });
  }
}

function checkCarryForwardBreakups(issues, pass, totals) {
  for (const key of nestedTotals) {
    const rows = totals[`${key}Breakup`] ?? [];
    const aggregate = rows.reduce(
      (sum, row) => ({
        count: sum.count + n(row.count),
        capital: sum.capital + n(row.capital),
        revenue: sum.revenue + n(row.revenue),
        total: sum.total + n(row.total),
      }),
      { count: 0, capital: 0, revenue: 0, total: 0 },
    );
    const total = totals[key] ?? {};
    for (const field of ["count", "capital", "revenue", "total"]) {
      if (round(aggregate[field]) !== round(n(total[field]))) {
        issues.push({
          pass,
          area: `${key}Breakup`,
          field,
          issue: "breakup sum does not equal panel total",
          expected: round(n(total[field])),
          actual: round(aggregate[field]),
        });
      }
    }
    for (const row of rows) {
      if (round(n(row.capital) + n(row.revenue)) !== round(n(row.total))) {
        issues.push({
          pass,
          area: `${key}Breakup`,
          year: row.year,
          issue: "row total does not equal capital + revenue",
          capital: row.capital,
          revenue: row.revenue,
          total: row.total,
        });
      }
    }
  }
}

function checkPercents(issues, pass, totals, percents) {
  const checks = [
    ["capitalBooked", totals.bookedCapital, totals.allocatedCapital],
    ["revenueBooked", totals.bookedRevenue, totals.allocatedRevenue],
    ["capitalProjected", totals.projectedCapital, totals.allocatedCapital],
    ["revenueProjected", totals.projectedRevenue, totals.allocatedRevenue],
    ["capitalSpent", totals.spentCapital, totals.allocatedCapital],
    ["revenueSpent", totals.spentRevenue, totals.allocatedRevenue],
  ];
  for (const [key, numerator, denominator] of checks) {
    const expected = n(denominator) > 0 ? (n(numerator) / n(denominator)) * 100 : 0;
    if (Math.abs(round(expected) - round(percents[key])) > 0.01) {
      issues.push({ pass, area: "financePercents", key, expected: round(expected), actual: round(percents[key]) });
    }
  }
}

function checkDistributionShares(issues, pass, distributions) {
  for (const [key, rows] of Object.entries(distributions ?? {})) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const totalValue = rows.reduce((sum, row) => sum + n(row.value), 0);
    const totalShare = rows.reduce((sum, row) => sum + n(row.share), 0);
    if (totalValue > 0 && Math.abs(totalShare - 100) > 0.05) {
      issues.push({ pass, area: "financeFirmTypeDistributions", key, issue: "shares do not total 100", totalShare });
    }
  }
}

function checkDistributionValues(issues, pass, summary) {
  const distributions = summary.financeFirmTypeDistributions ?? {};
  for (const [key, rows] of Object.entries(distributions)) {
    if (!Array.isArray(rows)) continue;
    const total = rows.reduce((sum, row) => sum + n(row.value), 0);
    if (key === "supplyOrderValue") {
      const expected = n(summary.financeTotals?.spentCapital) + n(summary.financeTotals?.spentRevenue);
      if (round(total) !== round(expected)) {
        issues.push({ pass, area: key, issue: "firm type S.O. distribution does not equal committed total", expected: round(expected), actual: round(total) });
      }
    }
    for (const row of rows) {
      if (n(row.value) < 0 || n(row.share) < 0) {
        issues.push({ pass, area: key, firmType: row.name, issue: "negative distribution value/share", row });
      }
    }
  }
}

async function checkCarryForwardClickers(token, issues, pass, summary) {
  for (const key of nestedTotals) {
    for (const row of summary.financeTotals?.[`${key}Breakup`] ?? []) {
      if (!row.filter) {
        issues.push({ pass: pass.name, area: key, year: row.year, issue: "missing carry-forward clicker filter" });
        continue;
      }
      if (n(row.count) <= 0 && n(row.total) <= 0) continue;
      const result = await api(searchPath(pass, row.filter), token);
      if (n(result.total) <= 0) {
        issues.push({
          pass: pass.name,
          area: key,
          year: row.year,
          filter: row.filter,
          issue: "non-zero carry-forward row opens no files",
        });
      }
    }
  }
}

function compareAdditive(issues, omitted, configured, fixed, custom) {
  for (const field of additiveFinanceFields) {
    const partitionTotal = round(n(fixed.financeTotals[field]) + n(custom.financeTotals[field]));
    const configuredTotal = round(n(configured.financeTotals[field]));
    const omittedTotal = round(n(omitted.financeTotals[field]));
    if (partitionTotal !== configuredTotal) {
      issues.push({ area: "financeTotals partition", field, expected: configuredTotal, actual: partitionTotal });
    }
    if (configuredTotal !== omittedTotal) {
      issues.push({ area: "financeTotals omitted/all-configured", field, expected: configuredTotal, actual: omittedTotal });
    }
  }
  for (const field of nestedTotals) {
    for (const subfield of ["count", "capital", "revenue", "total"]) {
      const partitionTotal = round(n(fixed.financeTotals[field]?.[subfield]) + n(custom.financeTotals[field]?.[subfield]));
      const configuredTotal = round(n(configured.financeTotals[field]?.[subfield]));
      const omittedTotal = round(n(omitted.financeTotals[field]?.[subfield]));
      if (partitionTotal !== configuredTotal) {
        issues.push({ area: "nested finance partition", field, subfield, expected: configuredTotal, actual: partitionTotal });
      }
      if (configuredTotal !== omittedTotal) {
        issues.push({ area: "nested finance omitted/all-configured", field, subfield, expected: configuredTotal, actual: omittedTotal });
      }
    }
  }
}

async function main() {
  const token = await login();
  const issues = [];
  const passes = [
    { name: "omitted", selectedYear: "__all_active_files__", fileCategories: undefined },
    { name: "all configured", selectedYear: "__all_active_files__", fileCategories: allConfiguredCategories },
    { name: "fixed built-in", selectedYear: "__all_active_files__", fileCategories: defaultCategories },
    { name: "all custom", selectedYear: "__all_active_files__", fileCategories: allCustomCategories },
    { name: "selected FY 2026-27", selectedYear: selectedFinanceYear },
    { name: "selected FY 2025-26", selectedYear: "2025-26" },
    { name: "entire database", selectedYear: "__all_files__" },
    { name: "division ACC", selectedYear: "__all_active_files__", division: "ACC" },
  ];
  const summaries = {};
  try {
    for (const pass of passes) {
      const payload = await api(dashboardPath(pass), token);
      const summary = payload.summary ?? {};
      summaries[pass.name] = summary;
      const totals = summary.financeTotals ?? {};
      for (const field of additiveFinanceFields) {
        if (n(totals[field]) < 0) {
          issues.push({ pass: pass.name, area: "financeTotals", field, issue: "negative value", value: totals[field] });
        }
      }
      for (const key of nestedTotals) checkNestedTotal(issues, pass.name, totals, key);
      checkCarryForwardBreakups(issues, pass.name, totals);
      checkPercents(issues, pass.name, totals, summary.financePercents ?? {});
      checkDistributionShares(issues, pass.name, summary.financeFirmTypeDistributions ?? {});
      checkDistributionValues(issues, pass.name, summary);
      await checkCarryForwardClickers(token, issues, pass, summary);
    }
    compareAdditive(
      issues,
      summaries.omitted,
      summaries["all configured"],
      summaries["fixed built-in"],
      summaries["all custom"],
    );
  } finally {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` },
    }).catch(() => undefined);
  }
  console.log(JSON.stringify({ checked: passes.map((pass) => pass.name), issues }, null, 2));
  if (issues.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
