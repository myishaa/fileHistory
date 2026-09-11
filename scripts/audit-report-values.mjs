const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
const selectedMonth = process.env.AUDIT_MONTH ?? "2026-09";
const defaultCategories = "goodsServices,amc,mpc,cars,om";
const customCategories = "fileType:CAPSI,fileType:DcPP%20(G%26S),fileType:I%26M%20(G%26S)";
const allCustomCategories =
  "fileType:CAPSI,fileType:DcPP%20(Contract),fileType:DcPP%20(G%26S),fileType:I%26M%20(Contract),fileType:I%26M%20(G%26S)";
const contractCustomCategories = "fileType:DcPP%20(Contract),fileType:I%26M%20(Contract)";
const allConfiguredCategories =
  `${defaultCategories},${allCustomCategories}`;

const cashValueArrays = [
  "expectedCashOutgoDpRows",
  "expectedCashOutgoReceiptRows",
  "expectedCashOutgoReceiptPendingBillRows",
  "expectedCashOutgoBillPreparationRows",
  "billSentForPaymentRows",
  "actualCashOutgoRows",
  "supplementaryBillSentForPaymentRows",
  "supplementaryActualCashOutgoRows",
  "pendingReturnedBillRows",
  "returnedBillResubmittedRows",
  "returnedBillPaidRows",
  "supplementaryPendingReturnedBillRows",
  "supplementaryReturnedBillResubmittedRows",
  "supplementaryReturnedBillPaidRows",
];

const countArrays = [
  "monthlyFileInflow",
  "monthWiseSupplyOrder",
  "monthWiseDeliverySchedule",
  "monthWiseCompletedDeliveries",
  "monthWiseBgExpiry",
  "preBidMeetingRows",
  "bgReceiptDelayRows",
  "warrantyBgMismatchRows",
];

function n(value) {
  return Number(value ?? 0) || 0;
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(row) {
  return {
    capital: round(n(row?.capital)),
    revenue: round(n(row?.revenue)),
    total: round(n(row?.total)),
  };
}

function rowKey(row) {
  return String(row?.monthKey ?? row?.name ?? row?.label ?? row?.thresholdDays ?? "unknown");
}

function mapRows(rows) {
  const map = new Map();
  for (const row of rows ?? []) {
    const key = rowKey(row);
    const current = map.get(key) ?? { capital: 0, revenue: 0, total: 0 };
    const value = money(row);
    map.set(key, {
      capital: round(current.capital + value.capital),
      revenue: round(current.revenue + value.revenue),
      total: round(current.total + value.total),
    });
  }
  return map;
}

function addMaps(...maps) {
  const result = new Map();
  for (const map of maps) {
    for (const [key, value] of map.entries()) {
      const current = result.get(key) ?? { capital: 0, revenue: 0, total: 0 };
      result.set(key, {
        capital: round(current.capital + value.capital),
        revenue: round(current.revenue + value.revenue),
        total: round(current.total + value.total),
      });
    }
  }
  return result;
}

function compareMaps(issues, label, expected, actual) {
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  for (const key of keys) {
    const e = expected.get(key) ?? { capital: 0, revenue: 0, total: 0 };
    const a = actual.get(key) ?? { capital: 0, revenue: 0, total: 0 };
    for (const field of ["capital", "revenue", "total"]) {
      if (round(e[field]) !== round(a[field])) {
        issues.push({
          area: label,
          key,
          field,
          expected: round(e[field]),
          actual: round(a[field]),
        });
      }
    }
  }
}

function combineRowsForMonth(monthKey, rowGroups) {
  let capital = 0;
  let revenue = 0;
  for (const rows of rowGroups) {
    for (const row of rows ?? []) {
      if (row.monthKey !== monthKey) continue;
      capital += n(row.capital);
      revenue += n(row.revenue);
    }
  }
  return capital || revenue ? [{ monthKey, capital, revenue, total: capital + revenue }] : [];
}

function combineRowsThroughMonth(monthKey, rowGroups) {
  let capital = 0;
  let revenue = 0;
  for (const rows of rowGroups) {
    for (const row of rows ?? []) {
      if (!row.monthKey || row.monthKey > monthKey) continue;
      capital += n(row.capital);
      revenue += n(row.revenue);
    }
  }
  return capital || revenue ? [{ monthKey, capital, revenue, total: capital + revenue }] : [];
}

function fyRows(rows, startMonth = "2026-04", endMonth = "2027-03") {
  return (rows ?? []).filter((row) => row.monthKey >= startMonth && row.monthKey <= endMonth);
}

function derivedCashRows(summary) {
  const expectedCashOutgoFyRows = fyRows(summary.expectedCashOutgoDpRows);
  return {
    expectedCashOutgoFyRows,
    spentTillDateFyRows: summary.actualCashOutgoRows ?? [],
    billsPaidInMonthRows: combineRowsForMonth(selectedMonth, [summary.actualCashOutgoRows]),
    currentLiabilityRows: combineRowsThroughMonth(selectedMonth, [
      summary.expectedCashOutgoReceiptPendingBillRows,
      summary.expectedCashOutgoBillPreparationRows,
      summary.billSentForPaymentRows,
    ]),
    cashOutgoForMonthRows: combineRowsForMonth(selectedMonth, [
      summary.expectedCashOutgoBillPreparationRows,
      summary.billSentForPaymentRows,
      expectedCashOutgoFyRows,
    ]),
    expectedExpenditureTillMonthRows: combineRowsThroughMonth(selectedMonth, [
      summary.actualCashOutgoRows,
      summary.expectedCashOutgoBillPreparationRows,
      summary.billSentForPaymentRows,
      summary.expectedCashOutgoReceiptPendingBillRows,
    ]),
  };
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

function reportPath(pass) {
  const params = new URLSearchParams({
    selectedYear: pass.selectedYear ?? "__all_active_files__",
    fileYear: pass.fileYear ?? "all",
    division: pass.division ?? "all",
    delayDays: "5",
    delayMilestone: "all",
    expectedCashOutgoDays: "10",
    cashOutgoMonth: selectedMonth,
    warrantyBgBufferDays: "60",
  });
  if (pass.fileCategories !== undefined) params.set("fileCategories", pass.fileCategories);
  if (pass.fileInitiationFrom) params.set("fileInitiationFrom", pass.fileInitiationFrom);
  if (pass.fileInitiationTo) params.set("fileInitiationTo", pass.fileInitiationTo);
  return `/api/reports/summary?${params.toString()}`;
}

function validateValueRows(issues, passName, summary) {
  for (const arrayName of cashValueArrays) {
    for (const row of summary[arrayName] ?? []) {
      const value = money(row);
      if (value.capital < 0 || value.revenue < 0 || value.total < 0) {
        issues.push({ pass: passName, area: arrayName, key: rowKey(row), issue: "negative value", value });
      }
      if (round(value.capital + value.revenue) !== value.total) {
        issues.push({
          pass: passName,
          area: arrayName,
          key: rowKey(row),
          issue: "total does not equal capital + revenue",
          value,
        });
      }
    }
  }
  const derived = derivedCashRows(summary);
  for (const [arrayName, rows] of Object.entries(derived)) {
    for (const row of rows) {
      const value = money(row);
      if (round(value.capital + value.revenue) !== value.total) {
        issues.push({
          pass: passName,
          area: arrayName,
          key: rowKey(row),
          issue: "derived total does not equal capital + revenue",
          value,
        });
      }
    }
  }
  for (const arrayName of countArrays) {
    for (const row of summary[arrayName] ?? []) {
      for (const [field, value] of Object.entries(row)) {
        if (typeof value !== "number") continue;
        if (value < 0) {
          issues.push({ pass: passName, area: arrayName, key: rowKey(row), field, issue: "negative count", value });
        }
      }
    }
  }
}

function compareValuePartition(issues, label, left, right, whole) {
  for (const arrayName of cashValueArrays) {
    compareMaps(
      issues,
      `${label} ${arrayName}`,
      addMaps(mapRows(left[arrayName]), mapRows(right[arrayName])),
      mapRows(whole[arrayName]),
    );
  }
  const leftDerived = derivedCashRows(left);
  const rightDerived = derivedCashRows(right);
  const wholeDerived = derivedCashRows(whole);
  for (const arrayName of Object.keys(wholeDerived)) {
    compareMaps(
      issues,
      `${label} ${arrayName}`,
      addMaps(mapRows(leftDerived[arrayName]), mapRows(rightDerived[arrayName])),
      mapRows(wholeDerived[arrayName]),
    );
  }
}

async function main() {
  const token = await login();
  const issues = [];
  const passes = [
    { name: "omitted", expectedFiles: 27 },
    { name: "all configured", fileCategories: allConfiguredCategories, expectedFiles: 27 },
    { name: "fixed built-in", fileCategories: defaultCategories, expectedFiles: 19 },
    { name: "all custom", fileCategories: allCustomCategories, expectedFiles: 8 },
    { name: "custom goods/services sample", fileCategories: customCategories, expectedFiles: 6 },
    { name: "contract custom only", fileCategories: contractCustomCategories, expectedFiles: 2 },
    { name: "future empty initiation", fileInitiationFrom: "2030-01-01", fileInitiationTo: "2030-12-31", expectedFiles: 0 },
  ];
  const summaries = {};
  const passSummaries = [];
  try {
    for (const pass of passes) {
      const payload = await api(reportPath(pass), token);
      const summary = payload.summary ?? {};
      summaries[pass.name] = summary;
      validateValueRows(issues, pass.name, summary);
      if (n(summary.reportFileCount) !== pass.expectedFiles) {
        issues.push({
          pass: pass.name,
          area: "reportFileCount",
          expected: pass.expectedFiles,
          actual: n(summary.reportFileCount),
        });
      }
      const valueRows = cashValueArrays.reduce((sum, key) => sum + (summary[key]?.length ?? 0), 0);
      const nonZeroValueRows = cashValueArrays.reduce(
        (sum, key) => sum + (summary[key] ?? []).filter((row) => money(row).total > 0).length,
        0,
      );
      passSummaries.push({
        pass: pass.name,
        reportFileCount: summary.reportFileCount,
        valueRows,
        nonZeroValueRows,
      });
    }
    compareValuePartition(
      issues,
      "fixed + all custom = all configured",
      summaries["fixed built-in"],
      summaries["all custom"],
      summaries["all configured"],
    );
    compareValuePartition(
      issues,
      "fixed + all custom = omitted",
      summaries["fixed built-in"],
      summaries["all custom"],
      summaries.omitted,
    );
    compareValuePartition(
      issues,
      "sample custom + contract custom = all custom",
      summaries["custom goods/services sample"],
      summaries["contract custom only"],
      summaries["all custom"],
    );
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
