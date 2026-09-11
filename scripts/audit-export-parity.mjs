const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";

function n(value) {
  return Number(value ?? 0) || 0;
}

function formatThousandsAndLakhs(value, maximumFractionDigits = 2) {
  const sign = value < 0 ? "-" : "";
  const absoluteValue = Math.abs(value);
  const fixedValue = Number.isInteger(absoluteValue)
    ? String(absoluteValue)
    : absoluteValue.toFixed(maximumFractionDigits).replace(/\.?0+$/, "");
  const [integerPart, decimalPart] = fixedValue.split(".");
  const lastThree = integerPart.slice(-3);
  const beforeThousands = integerPart.slice(0, -3);
  if (!beforeThousands) return `${sign}${integerPart}${decimalPart ? `.${decimalPart}` : ""}`;
  const lastTwoBeforeThousands = beforeThousands.slice(-2);
  const lakhPart = beforeThousands.slice(0, -2);
  return `${sign}${[lakhPart, lastTwoBeforeThousands, lastThree].filter(Boolean).join(",")}${decimalPart ? `.${decimalPart}` : ""}`;
}

function formatCurrency(value) {
  return `${formatThousandsAndLakhs(n(value) / 100_000, 2)} Lakh`;
}

function cashOutgoExportRows(rows) {
  const bodyRows = rows.map((row, index) => [
    String(index + 1),
    row.month,
    formatCurrency(row.capital),
    formatCurrency(row.revenue),
  ]);
  const totals = rows.reduce(
    (sum, row) => ({
      capital: sum.capital + n(row.capital),
      revenue: sum.revenue + n(row.revenue),
    }),
    { capital: 0, revenue: 0 },
  );
  return [
    ...bodyRows,
    ["", "Total", formatCurrency(totals.capital), formatCurrency(totals.revenue)],
  ];
}

function financeExportRows(summary) {
  const totals = summary.financeTotals ?? {};
  return [
    ["1", "Allocated", formatCurrency(totals.allocatedCapital), formatCurrency(totals.allocatedRevenue), "Allocated amount"],
    ["2", "Intended", formatCurrency(totals.projectedCapital), formatCurrency(totals.projectedRevenue), "Against allocation"],
    ["3", "Booked", formatCurrency(totals.bookedCapital), formatCurrency(totals.bookedRevenue), "Against allocation"],
    ["4", "Committed", formatCurrency(totals.spentCapital), formatCurrency(totals.spentRevenue), "Against allocation"],
    ["5", "Payment in 2026-27", formatCurrency(totals.paidCapital), formatCurrency(totals.paidRevenue), "Actual payment amount"],
    ["6", "Paid", formatCurrency(totals.sameYearPaidCapital), formatCurrency(totals.sameYearPaidRevenue), "Payment made"],
    ["7", "Advance Payment", formatCurrency(totals.advanceCapital), formatCurrency(totals.advanceRevenue), "Actual advance amount"],
    [
      "8",
      "Carry Forward from previous FYs as on 2026-27 end",
      formatCurrency(totals.previousCarryForward?.capital),
      formatCurrency(totals.previousCarryForward?.revenue),
      `${n(totals.previousCarryForward?.count)} older carry-forward rows`,
    ],
    [
      "9",
      "Cleared Carry Forward in 2026-27",
      formatCurrency(totals.clearedCarryForward?.capital),
      formatCurrency(totals.clearedCarryForward?.revenue),
      `${n(totals.clearedCarryForward?.count)} previous-year carry-forward rows`,
    ],
    [
      "10",
      "Carry Forward of 2026-27",
      formatCurrency(totals.carryForward?.capital),
      formatCurrency(totals.carryForward?.revenue),
      `${n(totals.carryForward?.count)} payment rows`,
    ],
    [
      "11",
      "Carry Forward of 2026-27 cleared later",
      formatCurrency(totals.futureClearedCarryForward?.capital),
      formatCurrency(totals.futureClearedCarryForward?.revenue),
      `${n(totals.futureClearedCarryForward?.count)} 2026-27 carry-forward rows`,
    ],
  ];
}

function financeDistributionRows(summary) {
  return (summary.financeFirmTypeDistributions?.supplyOrderValue ?? []).map((row, index) => [
    String(index + 1),
    row.name,
    formatCurrency(row.value),
    `${n(row.share).toFixed(1).replace(/\\.0$/, "")}%`,
  ]);
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

async function exportTable(format, payload, token) {
  const response = await fetch(`${API_BASE_URL}/api/exports/table`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `recordkeeper_session=${encodeURIComponent(token)}`,
    },
    body: JSON.stringify({ ...payload, format }),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`export ${format} failed ${response.status}: ${buffer.toString("utf8")}`);
  }
  return {
    contentType: response.headers.get("content-type") ?? "",
    disposition: response.headers.get("content-disposition") ?? "",
    text: buffer.toString("latin1").replaceAll("\\(", "(").replaceAll("\\)", ")"),
  };
}

function assertContains(issues, area, haystack, needles) {
  for (const needle of needles) {
    if (!haystack.includes(needle)) {
      issues.push({ area, issue: "export missing expected text", needle });
    }
  }
}

async function main() {
  const token = await login();
  const issues = [];
  try {
    const params = new URLSearchParams({
      selectedYear: "__all_active_files__",
      fileYear: "all",
      division: "all",
      delayDays: "5",
      delayMilestone: "all",
      expectedCashOutgoDays: "10",
      cashOutgoMonth: "2026-09",
      warrantyBgBufferDays: "60",
    });
    const payload = await api(`/api/reports/summary?${params.toString()}`, token);
    const rows = (payload.summary?.expectedCashOutgoDpRows ?? []).slice(0, 3);
    if (!rows.length) throw new Error("expectedCashOutgoDpRows had no rows to export");
    const exportRows = cashOutgoExportRows(rows);
    const exportPayload = {
      title: "Audit Export Parity - Expected Cash Outgo by D.P.",
      description: "Automated export parity check.",
      tables: [
        {
          title: "Expected Cash Outgo by D.P.",
          headers: ["S.No.", "Month", "Capital", "Revenue"],
          rows: exportRows,
        },
      ],
    };
    const expectedText = [
      exportPayload.title,
      "Expected Cash Outgo by D.P.",
      "S.No.",
      "Month",
      "Capital",
      "Revenue",
      ...exportRows.flat().filter(Boolean),
    ];
    const excel = await exportTable("excel", exportPayload, token);
    const pdf = await exportTable("pdf", exportPayload, token);
    if (!excel.contentType.includes("application/vnd.ms-excel")) {
      issues.push({ area: "excel", issue: "unexpected content type", contentType: excel.contentType });
    }
    if (!pdf.contentType.includes("application/pdf")) {
      issues.push({ area: "pdf", issue: "unexpected content type", contentType: pdf.contentType });
    }
    assertContains(issues, "excel", excel.text, expectedText);
    assertContains(issues, "pdf", pdf.text, expectedText);

    const dashboard = await api(
      "/api/dashboard/summary?version=5&selectedYear=__all_active_files__&division=all",
      token,
    );
    const financeRows = financeExportRows(dashboard.summary ?? {});
    const distributionRows = financeDistributionRows(dashboard.summary ?? {});
    const financePayload = {
      title: "Finance summary - All divisions",
      description: "Automated finance export parity check.",
      tables: [
        {
          headers: ["S.No.", "Category", "Capital", "Revenue", "Notes"],
          rows: financeRows,
        },
        {
          title: "Firm Type Distribution - S.O. Value",
          headers: ["S.No.", "Firm type", "Value", "Share"],
          rows: distributionRows,
        },
      ],
    };
    const financeExpectedText = [
      financePayload.title,
      "S.No.",
      "Category",
      "Capital",
      "Revenue",
      "Notes",
      "Firm Type Distribution - S.O. Value",
      "Firm type",
      "Value",
      "Share",
      "Allocated",
      "Intended",
      "Booked",
      "Committed",
      "Payment in 2026-27",
      "Paid",
      "Advance Payment",
      "Carry Forward",
      "previous FYs",
      ...financeRows.flat().filter((value) => Boolean(value) && !String(value).startsWith("Carry Forward")),
      ...distributionRows.flat().filter(Boolean),
    ];
    const financeExcel = await exportTable("excel", financePayload, token);
    const financePdf = await exportTable("pdf", financePayload, token);
    if (!financeExcel.contentType.includes("application/vnd.ms-excel")) {
      issues.push({ area: "finance excel", issue: "unexpected content type", contentType: financeExcel.contentType });
    }
    if (!financePdf.contentType.includes("application/pdf")) {
      issues.push({ area: "finance pdf", issue: "unexpected content type", contentType: financePdf.contentType });
    }
    assertContains(issues, "finance excel", financeExcel.text, financeExpectedText);
    assertContains(issues, "finance pdf", financePdf.text, financeExpectedText);
  } finally {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` },
    }).catch(() => undefined);
  }
  console.log(JSON.stringify({ checked: ["excel", "pdf"], issues }, null, 2));
  if (issues.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
