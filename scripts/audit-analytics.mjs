const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";

const defaultCategories = "goodsServices,amc,mpc,cars,om";
const allCustomCategories =
  "fileType:CAPSI,fileType:DcPP%20(Contract),fileType:DcPP%20(G%26S),fileType:I%26M%20(Contract),fileType:I%26M%20(G%26S)";
const allConfiguredCategories = `${defaultCategories},${allCustomCategories}`;

const analyticsArrays = [
  "divisionFileRanking",
  "divisionValueRanking",
  "divisionTurnaroundRanking",
  "topFirmSupplyOrders",
  "firmAnalysis",
  "topIndentorsByFiles",
  "topIndentorsByValue",
  "milestoneClearingRanking",
  "monthlyFileInflow",
  "monthWiseSupplyOrder",
  "monthWiseDeliverySchedule",
  "monthWiseBgExpiry",
  "biddingModeMix",
  "fileValueThresholds",
  "soValueThresholds",
  "divisionRiskRanking",
  "divisionPaymentPendingRanking",
  "cncSummary",
];

function n(value) {
  return Number(value ?? 0) || 0;
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function monthKey(row) {
  return String(row.monthKey ?? row.name ?? "");
}

function rowKey(row) {
  return String(row.name ?? row.range ?? row.monthKey ?? row.cncDate ?? "unknown");
}

function mapByName(rows, valueFields) {
  const map = new Map();
  for (const row of rows ?? []) {
    const key = rowKey(row);
    const current = map.get(key) ?? {};
    for (const field of valueFields) {
      current[field] = round(n(current[field]) + n(row[field]));
    }
    map.set(key, current);
  }
  return map;
}

function compareMaps(issues, area, expected, actual) {
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  for (const key of keys) {
    const e = expected.get(key) ?? {};
    const a = actual.get(key) ?? {};
    const fields = new Set([...Object.keys(e), ...Object.keys(a)]);
    for (const field of fields) {
      if (round(e[field]) !== round(a[field])) {
        issues.push({ area, key, field, expected: round(e[field]), actual: round(a[field]) });
      }
    }
  }
}

function analyticsPath(pass) {
  const params = new URLSearchParams({
    version: "5",
    selectedYear: pass.selectedYear ?? "__all_active_files__",
    division: pass.division ?? "all",
  });
  if (pass.fileCategories !== undefined) params.set("fileCategories", pass.fileCategories);
  if (pass.fileYear && pass.fileYear !== "all") params.set("fileYear", pass.fileYear);
  if (pass.fileInitiationFrom) params.set("fileInitiationFrom", pass.fileInitiationFrom);
  if (pass.fileInitiationTo) params.set("fileInitiationTo", pass.fileInitiationTo);
  return `/api/dashboard/summary?${params.toString()}`;
}

function reportsPath(pass, delayDays, delayMilestone = "all") {
  const params = new URLSearchParams({
    selectedYear: pass.selectedYear ?? "__all_active_files__",
    division: pass.division ?? "all",
    delayDays: String(delayDays),
    delayMilestone,
    expectedCashOutgoDays: "0",
  });
  if (pass.fileCategories !== undefined) params.set("fileCategories", pass.fileCategories);
  if (pass.fileYear && pass.fileYear !== "all") params.set("fileYear", pass.fileYear);
  if (pass.fileInitiationFrom) params.set("fileInitiationFrom", pass.fileInitiationFrom);
  if (pass.fileInitiationTo) params.set("fileInitiationTo", pass.fileInitiationTo);
  return `/api/reports/summary?${params.toString()}`;
}

function searchPath(pass, target) {
  const params = new URLSearchParams({
    selectedYear: pass.selectedYear ?? "__all_active_files__",
    page: "1",
    pageSize: "500",
  });
  if (target.dashboardFilter) params.set("dashboardFilter", target.dashboardFilter);
  if (target.extraDashboardFilters?.length) {
    params.set("extraDashboardFilters", JSON.stringify(target.extraDashboardFilters));
  }
  if (target.analyticsType) params.set("analyticsType", target.analyticsType);
  if (target.analyticsNames?.length) params.set("analyticsNames", JSON.stringify(target.analyticsNames));
  if (target.includeModes?.length) params.set("includeModes", target.includeModes.join(","));
  const division = target.division ?? pass.division;
  if (division && division !== "all") params.set("divisionFilter", division);
  if (pass.fileCategories !== undefined) params.set("fileCategories", pass.fileCategories);
  if (pass.fileYear && pass.fileYear !== "all") params.set("fileYear", pass.fileYear);
  if (pass.fileInitiationFrom) params.set("fileInitiationFrom", pass.fileInitiationFrom);
  if (pass.fileInitiationTo) params.set("fileInitiationTo", pass.fileInitiationTo);
  return `/api/files/search?${params.toString()}`;
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

function checkNonNegativeRows(issues, passName, analytics) {
  for (const arrayName of analyticsArrays) {
    for (const row of analytics[arrayName] ?? []) {
      for (const [field, value] of Object.entries(row)) {
        if (typeof value !== "number") continue;
        if (value < 0) issues.push({ pass: passName, area: arrayName, key: rowKey(row), field, issue: "negative number", value });
      }
    }
  }
}

function checkDivisionValueTotals(issues, passName, rows) {
  for (const row of rows ?? []) {
    for (const prefix of ["allocated", "intended", "booked", "committed"]) {
      const capital = n(row[`${prefix}Capital`]);
      const revenue = n(row[`${prefix}Revenue`]);
      const total = n(row[`${prefix}Total`]);
      if (round(capital + revenue) !== round(total)) {
        issues.push({ pass: passName, area: "divisionValueRanking", division: row.name, prefix, issue: "total mismatch", capital, revenue, total });
      }
    }
  }
}

function checkThresholdRows(issues, passName, rows, area) {
  const totals = { count: 0, capitalCount: 0, revenueCount: 0, capital: 0, revenue: 0, value: 0 };
  for (const row of rows ?? []) {
    if (round(n(row.capital) + n(row.revenue)) !== round(n(row.value))) {
      issues.push({ pass: passName, area, key: rowKey(row), issue: "value does not equal capital + revenue", row });
    }
    if (n(row.capitalCount) + n(row.revenueCount) < n(row.count)) {
      issues.push({ pass: passName, area, key: rowKey(row), issue: "capital/revenue counts lower than total count", row });
    }
    for (const field of Object.keys(totals)) totals[field] += n(row[field]);
  }
  for (const field of ["countContribution", "capitalCountContribution", "revenueCountContribution", "capitalContribution", "revenueContribution", "valueContribution"]) {
    const sum = (rows ?? []).reduce((current, row) => current + n(row[field]), 0);
    if ((rows ?? []).some((row) => n(row[field]) > 0) && Math.abs(sum - 100) > 0.6) {
      issues.push({ pass: passName, area, field, issue: "contributions do not total 100", sum: round(sum) });
    }
  }
}

function checkMilestoneClearingRows(issues, passName, rows) {
  let previousAverage = Infinity;
  for (const row of rows ?? []) {
    const sampleSize = n(row.sampleSize);
    const ids = String(row.fileIds ?? "").split(",").map((id) => id.trim()).filter(Boolean);
    if (sampleSize !== ids.length) {
      issues.push({ pass: passName, area: "milestoneClearingRanking", milestone: row.name, issue: "sampleSize does not equal unique fileIds count", sampleSize, fileIds: ids.length });
    }
    if (n(row.minDays) > n(row.medianDays) || n(row.medianDays) > n(row.maxDays)) {
      issues.push({ pass: passName, area: "milestoneClearingRanking", milestone: row.name, issue: "min/median/max order invalid", row });
    }
    if (n(row.averageDays) < n(row.minDays) || n(row.averageDays) > n(row.maxDays)) {
      issues.push({ pass: passName, area: "milestoneClearingRanking", milestone: row.name, issue: "average outside min/max", row });
    }
    if (n(row.averageDays) > previousAverage) {
      issues.push({ pass: passName, area: "milestoneClearingRanking", milestone: row.name, issue: "ranking not sorted descending by averageDays" });
    }
    previousAverage = n(row.averageDays);
  }
}

async function checkExactFileIdsClicker(token, issues, pass, area, label, fileIds) {
  const ids = Array.from(new Set(fileIds.filter(Boolean)));
  if (!ids.length) return;
  const result = await api(searchPath(pass, {
    dashboardFilter: `fileIds:${ids.map(encodeURIComponent).join(",")}`,
  }), token);
  const resultIds = Array.from(new Set((result.files ?? []).map((file) => file.id)));
  const missing = ids.filter((id) => !resultIds.includes(id));
  const extra = resultIds.filter((id) => !ids.includes(id));
  if (n(result.total) !== ids.length || missing.length || extra.length) {
    issues.push({ pass: pass.name, area, label, issue: "fileIds clicker mismatch", expected: ids.length, actual: n(result.total), missing: missing.slice(0, 10), extra: extra.slice(0, 10) });
  }
}

async function checkSearchCount(token, issues, pass, area, label, expected, target, exact = true) {
  if (n(expected) <= 0) return;
  const result = await api(searchPath(pass, target), token);
  if (exact ? n(result.total) !== n(expected) : n(result.total) <= 0) {
    issues.push({ pass: pass.name, area, label, issue: exact ? "clicker count mismatch" : "non-zero row opens no files", expected: n(expected), actual: n(result.total), target });
  }
}

async function checkAnalyticsClickers(token, issues, pass, summary) {
  const analytics = summary.analytics ?? {};
  for (const row of analytics.divisionFileRanking ?? []) {
    await checkSearchCount(token, issues, pass, "Division file ranking", row.name, row.count, { dashboardFilter: "totalFiles", division: row.name });
  }
  for (const row of analytics.divisionTurnaroundRanking ?? []) {
    await checkSearchCount(token, issues, pass, "Division turnaround ranking", row.name, row.sampleSize, { dashboardFilter: "divisionTurnaroundSample", division: row.name }, false);
  }
  for (const row of analytics.divisionPaymentPendingRanking ?? []) {
    await checkSearchCount(token, issues, pass, "Payment pending ranking", row.name, row.count, { dashboardFilter: "paymentDue", division: row.name });
  }
  for (const row of analytics.topFirmSupplyOrders ?? []) {
    await checkSearchCount(token, issues, pass, "Top firms by S.O. value", row.name, row.value, { analyticsType: "firm", analyticsNames: [row.name] }, false);
  }
  for (const row of analytics.topIndentorsByFiles ?? []) {
    await checkSearchCount(token, issues, pass, "Top indentors by files", row.name, row.count, { analyticsType: "indentor", analyticsNames: [row.name] });
  }
  for (const row of analytics.topIndentorsByValue ?? []) {
    await checkSearchCount(token, issues, pass, "Top indentors by value", row.name, row.value, { analyticsType: "indentor", analyticsNames: [row.name] }, false);
  }
  for (const row of analytics.biddingModeMix ?? []) {
    await checkSearchCount(token, issues, pass, "Bidding mode mix", row.name, row.count, { dashboardFilter: `mode:${String(row.name).toUpperCase()}` });
  }
  for (const row of analytics.milestoneClearingRanking ?? []) {
    const ids = String(row.fileIds ?? "").split(",").map((id) => id.trim()).filter(Boolean);
    await checkExactFileIdsClicker(token, issues, pass, "Milestone clearing ranking", row.name, ids);
  }
  for (const row of analytics.monthWiseSupplyOrder ?? []) {
    await checkSearchCount(token, issues, pass, "Month-wise S.O.", monthKey(row), row.count, { dashboardFilter: `supplyOrderMonth:${monthKey(row)}` }, false);
  }
  for (const row of analytics.monthWiseDeliverySchedule ?? []) {
    await checkSearchCount(token, issues, pass, "Month-wise D.P. gross", monthKey(row), row.grossCount, { dashboardFilter: `deliverySchedule:gross:${monthKey(row)}` }, false);
    await checkSearchCount(token, issues, pass, "Month-wise D.P. net", monthKey(row), row.netCount, { dashboardFilter: `deliverySchedule:net:${monthKey(row)}` }, false);
  }
  for (const row of analytics.monthWiseBgExpiry ?? []) {
    await checkSearchCount(token, issues, pass, "Month-wise BG expiry total", monthKey(row), row.count, { dashboardFilter: `bgExpiryMonth:all:${monthKey(row)}` }, false);
    await checkSearchCount(token, issues, pass, "Month-wise BG expiry PSB", monthKey(row), row.psb, { dashboardFilter: `bgExpiryMonth:psb:${monthKey(row)}` }, false);
    await checkSearchCount(token, issues, pass, "Month-wise BG expiry PWB", monthKey(row), row.pwb, { dashboardFilter: `bgExpiryMonth:pwb:${monthKey(row)}` }, false);
    await checkSearchCount(token, issues, pass, "Month-wise BG expiry PSB+PWB", monthKey(row), row.psbPwb, { dashboardFilter: `bgExpiryMonth:psbpwb:${monthKey(row)}` }, false);
  }
  for (const row of analytics.cncSummary ?? []) {
    const cncDate = String(row.cncDate ?? row.name ?? "");
    for (const key of ["reviewed", "approved", "financialSanctionSigned", "supplyOrderPlaced", "approvalPending", "financialSanctionPending", "supplyOrderPending"]) {
      await checkSearchCount(token, issues, pass, "CNC Summary", `${cncDate}:${key}`, row[key], { dashboardFilter: `cncSummary:${encodeURIComponent(key)}:${encodeURIComponent(cncDate)}` }, false);
    }
  }
}

async function checkDelayStatus(token, issues, pass) {
  const daysList = [0, 5, 30, 60];
  for (const days of daysList) {
    const payload = await api(reportsPath(pass, days), token);
    const delay = payload.summary?.delaySummary ?? {};
    const rows = delay.byMilestone ?? [];
    const rowTotal = rows.reduce((sum, row) => sum + n(row.count), 0);
    if (rows.length && n(delay.averageDays) <= 0) {
      issues.push({ pass: pass.name, area: "Delay Status", days, issue: "rows exist but averageDays is zero" });
    }
    if (n(delay.longestDays) < n(delay.averageDays)) {
      issues.push({ pass: pass.name, area: "Delay Status", days, issue: "longestDays lower than averageDays", averageDays: delay.averageDays, longestDays: delay.longestDays });
    }
    for (const row of rows) {
      await checkSearchCount(token, issues, pass, "Delay Status", `${days}:${row.key}`, row.count, { dashboardFilter: `delayStatus:${days}:${row.key}` });
      const filtered = await api(reportsPath(pass, days, row.key), token);
      const filteredRows = filtered.summary?.delaySummary?.byMilestone ?? [];
      const filteredTotal = filteredRows.reduce((sum, item) => sum + n(item.count), 0);
      if (filteredTotal !== n(row.count)) {
        issues.push({ pass: pass.name, area: "Delay Status", days, milestone: row.key, issue: "milestone subfilter total mismatch", expected: n(row.count), actual: filteredTotal });
      }
    }
    const allResult = await api(searchPath(pass, { dashboardFilter: `delayStatus:${days}:all` }), token);
    if (rowTotal > 0 && n(allResult.total) <= 0) {
      issues.push({ pass: pass.name, area: "Delay Status", days, issue: "all delay clicker opens no files", rowTotal });
    }
  }
}

function compareCategoryPartitions(issues, summaries) {
  const arrayFields = {
    divisionFileRanking: ["count"],
    divisionValueRanking: [
      "intendedCapital",
      "intendedRevenue",
      "intendedTotal",
      "bookedCapital",
      "bookedRevenue",
      "bookedTotal",
      "committedCapital",
      "committedRevenue",
      "committedTotal",
    ],
    topIndentorsByFiles: ["count"],
    topIndentorsByValue: ["value"],
    biddingModeMix: ["count"],
    fileValueThresholds: ["count", "capitalCount", "revenueCount", "capital", "revenue", "value"],
    soValueThresholds: ["count", "capitalCount", "revenueCount", "capital", "revenue", "value"],
    divisionPaymentPendingRanking: ["count"],
  };
  for (const [arrayName, fields] of Object.entries(arrayFields)) {
    const fixed = mapByName(summaries["fixed built-in"].analytics?.[arrayName], fields);
    const custom = mapByName(summaries["all custom"].analytics?.[arrayName], fields);
    const configured = mapByName(summaries["all configured"].analytics?.[arrayName], fields);
    const omitted = mapByName(summaries.omitted.analytics?.[arrayName], fields);
    const partition = new Map(fixed);
    for (const [key, row] of custom) {
      const current = partition.get(key) ?? {};
      for (const field of fields) current[field] = round(n(current[field]) + n(row[field]));
      partition.set(key, current);
    }
    compareMaps(issues, `${arrayName} fixed+custom=allConfigured`, configured, partition);
    compareMaps(issues, `${arrayName} omitted=allConfigured`, configured, omitted);
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
    { name: "FY 2026-27", selectedYear: "2026-27", fileYear: "all" },
    { name: "FY 2025-26", selectedYear: "2025-26", fileYear: "all" },
    { name: "entire database", selectedYear: "__all_files__", fileYear: "all" },
    { name: "division ACC", selectedYear: "__all_active_files__", division: "ACC" },
    { name: "initiation range", selectedYear: "__all_active_files__", fileInitiationFrom: "2026-04-01", fileInitiationTo: "2026-09-30" },
    { name: "future empty initiation", selectedYear: "__all_active_files__", fileInitiationFrom: "2030-01-01", fileInitiationTo: "2030-12-31" },
  ];
  const summaries = {};
  const passSummaries = [];
  try {
    for (const pass of passes) {
      const payload = await api(analyticsPath(pass), token);
      const summary = payload.summary ?? {};
      summaries[pass.name] = summary;
      const analytics = summary.analytics ?? {};
      checkNonNegativeRows(issues, pass.name, analytics);
      checkDivisionValueTotals(issues, pass.name, analytics.divisionValueRanking);
      checkThresholdRows(issues, pass.name, analytics.fileValueThresholds, "fileValueThresholds");
      checkThresholdRows(issues, pass.name, analytics.soValueThresholds, "soValueThresholds");
      checkMilestoneClearingRows(issues, pass.name, analytics.milestoneClearingRanking);
      await checkAnalyticsClickers(token, issues, pass, summary);
      await checkDelayStatus(token, issues, pass);
      passSummaries.push({
        pass: pass.name,
        dashboardFileCount: summary.dashboardFileCount,
        milestoneClearingRows: analytics.milestoneClearingRanking?.length ?? 0,
        delayCheckedDays: 4,
      });
    }
    compareCategoryPartitions(issues, summaries);
  } finally {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` },
    }).catch(() => undefined);
  }
  console.log(JSON.stringify({ passSummaries, issues }, null, 2));
  if (issues.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
