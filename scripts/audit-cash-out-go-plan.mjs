const base = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";

async function login() {
  const response = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error("Login failed: " + (body?.error ?? response.status));
  const cookie = response.headers.get("set-cookie") ?? "";
  const match = cookie.match(/recordkeeper_session=([^;]+)/);
  if (!match) throw new Error("Login did not return a session cookie.");
  return decodeURIComponent(match[1]);
}

async function api(path, token) {
  const response = await fetch(base + path, {
    headers: { cookie: "recordkeeper_session=" + encodeURIComponent(token) },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(path + " failed: " + (body?.error ?? response.status));
  return body;
}

function financialYearStart(label) {
  const start = Number(String(label).match(/\d{4}/)?.[0]);
  return Number.isFinite(start) ? start : undefined;
}

function monthsForFinancialYear(label) {
  const start = financialYearStart(label);
  if (!start) return [];
  return Array.from({ length: 12 }, (_, index) => {
    const month = ((index + 3) % 12) + 1;
    const year = start + (month <= 3 ? 1 : 0);
    return String(year) + "-" + String(month).padStart(2, "0");
  });
}

function amountMatches(actual, expected) {
  return Math.abs(Number(actual ?? 0) - Number(expected ?? 0)) < 0.011;
}

function checkAmounts(issues, pass, section, rows) {
  for (const row of rows ?? []) {
    if (!amountMatches(row.total, Number(row.capital ?? 0) + Number(row.revenue ?? 0))) {
      issues.push({
        pass,
        section,
        key: row.rowKey ?? row.monthKey,
        issue: "Total differs from Capital + Revenue",
        capital: row.capital,
        revenue: row.revenue,
        total: row.total,
      });
    }
  }
}

function auditPlan(plan, pass, issues) {
  const detailSections = [
    "billsSubmitted", "chequeslipsNotReceived", "expectedPaymentDateInPast",
    "billsAtHand", "deliveredBillsPending", "dpBasedForecast", "dpExpired",
    "expectedPaymentInLaterFys",
  ];
  const locations = new Map();
  for (const section of detailSections) {
    const rows = plan[section] ?? [];
    checkAmounts(issues, pass, section, rows);
    for (const row of rows) {
      if (!row.rowKey) {
        issues.push({ pass, section, issue: "Detail row is missing stable rowKey" });
        continue;
      }
      const sections = locations.get(row.rowKey) ?? [];
      sections.push(section);
      locations.set(row.rowKey, sections);
    }
  }
  for (const [rowKey, sections] of locations) {
    if (sections.length > 1) {
      issues.push({ pass, rowKey, sections, issue: "Row is duplicated across plan sections" });
    }
  }

  const expectedMonths = monthsForFinancialYear(plan.financialYear);
  const actualMonths = (plan.monthwisePlan ?? []).map((row) => row.monthKey);
  if (JSON.stringify(actualMonths) !== JSON.stringify(expectedMonths)) {
    issues.push({ pass, issue: "Month-wise plan does not contain exactly the selected FY Apr-Mar", expectedMonths, actualMonths });
  }
  checkAmounts(issues, pass, "monthwisePlan", plan.monthwisePlan);
  const selectedMonthSet = new Set(expectedMonths);
  for (const row of plan.expenditureTillDate ?? []) {
    if (!selectedMonthSet.has(row.monthKey)) {
      issues.push({ pass, key: row.monthKey, issue: "Expenditure row falls outside selected FY" });
    }
  }
  for (const row of plan.expectedPaymentInLaterFys ?? []) {
    if (!row.expectedPaymentDate || row.expectedPaymentDate <= plan.selectedFinancialYearEnd) {
      issues.push({
        pass,
        key: row.rowKey,
        issue: "Later-FY section row has no date after the selected FY end",
        expectedPaymentDate: row.expectedPaymentDate,
        fyEnd: plan.selectedFinancialYearEnd,
      });
    }
    if (row.baseDate && row.baseDate > plan.selectedFinancialYearEnd) {
      issues.push({
        pass,
        key: row.rowKey,
        issue: "Later-FY section includes activity dated after the selected FY end",
        baseDate: row.baseDate,
        fyEnd: plan.selectedFinancialYearEnd,
      });
    }
  }
  return {
    pass,
    financialYear: plan.financialYear,
    monthRows: actualMonths.length,
    detailRows: detailSections.reduce((sum, section) => sum + (plan[section]?.length ?? 0), 0),
    duplicatedRowKeys: [...locations.values()].filter((sections) => sections.length > 1).length,
  };
}

async function main() {
  const token = await login();
  const settingsPayload = await api("/api/settings", token);
  const currentYear = settingsPayload.settings?.financialYear;
  const currentStart = financialYearStart(currentYear);
  if (!currentStart) throw new Error("Configured current FY is invalid.");
  const years = [
    currentYear,
    String(currentStart - 1) + "-" + String((currentStart % 100)).padStart(2, "0"),
    String(currentStart + 1) + "-" + String((currentStart + 2) % 100).padStart(2, "0"),
  ];
  const issues = [];
  const passSummaries = [];
  for (const year of [...new Set(years)]) {
    const params = new URLSearchParams({ financialYear: year, divisionId: "all" });
    const response = await api("/api/reports/cash-out-go-plan?" + params.toString(), token);
    passSummaries.push(auditPlan(response.plan, "FY " + year, issues));
  }
  console.log(JSON.stringify({ passSummaries, issues }, null, 2));
  if (issues.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
