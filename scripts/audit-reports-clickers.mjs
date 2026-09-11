const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
const todayMonth = process.env.AUDIT_MONTH ?? "2026-09";
const allActiveFilesYear = "__all_active_files__";
const allFilesYear = "__all_files__";
const activePlusCurrentFyClosedYear = "__active_plus_current_fy_closed__";
const defaultCategories = "goodsServices,amc,mpc,cars,om";
const customCategories = "fileType:CAPSI,fileType:DcPP%20(G%26S),fileType:I%26M%20(G%26S)";
const allCustomCategories =
  "fileType:CAPSI,fileType:DcPP%20(Contract),fileType:DcPP%20(G%26S),fileType:I%26M%20(Contract),fileType:I%26M%20(G%26S)";
const contractCustomCategories = "fileType:DcPP%20(Contract),fileType:I%26M%20(Contract)";

function n(value) {
  return Number(value ?? 0) || 0;
}

async function login() {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(`login failed ${response.status}: ${body?.error ?? "unknown error"}`);
  }
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
  if (!response.ok) {
    throw new Error(`${path} failed ${response.status}: ${body?.error ?? "unknown error"}`);
  }
  return body;
}

function reportSummaryPath(pass) {
  const params = new URLSearchParams({
    selectedYear: pass.selectedYear,
    division: pass.division ?? "all",
    delayDays: String(pass.delayDays ?? 5),
    delayMilestone: pass.delayMilestone ?? "all",
    expectedCashOutgoDays: String(pass.expectedCashOutgoDays ?? 10),
    cashOutgoMonth: pass.month ?? todayMonth,
    warrantyBgBufferDays: String(pass.warrantyBgBufferDays ?? 60),
  });
  if (pass.fileYear && pass.fileYear !== "all") params.set("fileYear", pass.fileYear);
  if (pass.fileCategories !== undefined) params.set("fileCategories", pass.fileCategories);
  if (pass.fileInitiationFrom) params.set("fileInitiationFrom", pass.fileInitiationFrom);
  if (pass.fileInitiationTo) params.set("fileInitiationTo", pass.fileInitiationTo);
  if (pass.bgReceiptDelayDays) params.set("bgReceiptDelayDays", pass.bgReceiptDelayDays);
  return `/api/reports/summary?${params.toString()}`;
}

function searchPath(pass, dashboardFilter, options = {}) {
  const params = new URLSearchParams({
    dashboardFilter,
    page: "1",
    pageSize: "500",
    selectedYear: options.selectedYear ?? pass.selectedYear,
  });
  if ((options.division ?? pass.division) && (options.division ?? pass.division) !== "all") {
    params.set("division", options.division ?? pass.division);
  }
  if (pass.fileYear && pass.fileYear !== "all") params.set("fileYear", pass.fileYear);
  if (pass.fileCategories !== undefined) params.set("fileCategories", pass.fileCategories);
  if (pass.fileInitiationFrom) params.set("fileInitiationFrom", pass.fileInitiationFrom);
  if (pass.fileInitiationTo) params.set("fileInitiationTo", pass.fileInitiationTo);
  return `/api/files/search?${params.toString()}`;
}

function addCheck(checks, passName, area, label, count, filter, mode = "not-exceed") {
  checks.push({ passName, area, label, count: n(count), filter, mode });
}

function collectStatus3(checks, passName, summary) {
  for (const group of summary.statusSummaryGroups ?? []) {
    for (const row of group.rows ?? []) {
      for (const column of group.columns ?? []) {
        const value = row.counts?.[column];
        if (value === undefined || value === "-") continue;
        addCheck(
          checks,
          passName,
          "Status summary groups",
          `${row.milestone} / ${column}`,
          value,
          `statusSummary:${encodeURIComponent(row.milestone)}:${encodeURIComponent(column)}`,
        );
      }
    }
  }
}

function collectMonthly(checks, passName, summary) {
  for (const row of summary.monthlyFileInflow ?? []) {
    addCheck(checks, passName, "Monthly file inflow", row.monthKey, row.count, `fileInflowMonth:${row.monthKey}`, "exact");
  }
  for (const row of summary.monthWiseSupplyOrder ?? []) {
    addCheck(checks, passName, "Month-wise Supply Order", row.monthKey, row.count, `supplyOrderMonth:${row.monthKey}`);
  }
  for (const row of summary.monthWiseDeliverySchedule ?? []) {
    addCheck(checks, passName, "Delivery Schedule", `${row.monthKey} gross`, row.grossCount, `deliverySchedule:gross:${row.monthKey}`);
    addCheck(checks, passName, "Delivery Schedule", `${row.monthKey} net`, row.netCount, `deliverySchedule:net:${row.monthKey}`);
  }
  for (const row of summary.monthWiseCompletedDeliveries ?? []) {
    addCheck(checks, passName, "Completed deliveries", row.monthKey, row.count, `completedDeliveryMonth:${row.monthKey}`);
  }
  for (const row of summary.monthWiseBgExpiry ?? []) {
    addCheck(checks, passName, "BG expiry", `${row.monthKey} total`, row.count, `bgExpiryMonth:all:${row.monthKey}`);
    addCheck(checks, passName, "BG expiry", `${row.monthKey} PSB`, row.psb, `bgExpiryMonth:psb:${row.monthKey}`);
    addCheck(checks, passName, "BG expiry", `${row.monthKey} PWB`, row.pwb, `bgExpiryMonth:pwb:${row.monthKey}`);
    addCheck(checks, passName, "BG expiry", `${row.monthKey} PSB+PWB`, row.psbPwb, `bgExpiryMonth:psbpwb:${row.monthKey}`);
  }
  for (const row of summary.preBidMeetingRows ?? []) {
    addCheck(checks, passName, "Pre-Bid Meetings", `${row.monthKey} total`, row.count, `preBidMeeting:all:${row.monthKey}`);
    addCheck(checks, passName, "Pre-Bid Meetings", `${row.monthKey} due`, row.preBidDue, `preBidMeeting:due:${row.monthKey}`);
    addCheck(checks, passName, "Pre-Bid Meetings", `${row.monthKey} completed`, row.preBidCompleted, `preBidMeeting:completed:${row.monthKey}`);
    addCheck(checks, passName, "Pre-Bid Meetings", `${row.monthKey} refloat due`, row.refloatPreBidDue, `refloatPreBidMeeting:due:${row.monthKey}`);
    addCheck(checks, passName, "Pre-Bid Meetings", `${row.monthKey} refloat completed`, row.refloatPreBidCompleted, `refloatPreBidMeeting:completed:${row.monthKey}`);
  }
  for (const row of summary.bgReceiptDelayRows ?? []) {
    addCheck(checks, passName, "BG receipt delay", `${row.label} total`, row.count, `bgReceiptDelay:all:${row.thresholdDays}`);
    addCheck(checks, passName, "BG receipt delay", `${row.label} PSB`, row.psb, `bgReceiptDelay:psb:${row.thresholdDays}`);
    addCheck(checks, passName, "BG receipt delay", `${row.label} PWB`, row.pwb, `bgReceiptDelay:pwb:${row.thresholdDays}`);
    addCheck(checks, passName, "BG receipt delay", `${row.label} PSB+PWB`, row.psbPwb, `bgReceiptDelay:psbpwb:${row.thresholdDays}`);
  }
  for (const row of summary.warrantyBgMismatchRows ?? []) {
    addCheck(checks, passName, "Warranty BG mismatch", `${row.label} total`, row.count, `warrantyBgMismatch:all:${row.bufferDays}`);
    addCheck(checks, passName, "Warranty BG mismatch", `${row.label} PWB`, row.pwb, `warrantyBgMismatch:pwb:${row.bufferDays}`);
    addCheck(checks, passName, "Warranty BG mismatch", `${row.label} PSB+PWB`, row.psbPwb, `warrantyBgMismatch:psbpwb:${row.bufferDays}`);
  }
}

function collectDelay(checks, passName, summary, pass) {
  for (const row of summary.delaySummary?.byMilestone ?? []) {
    addCheck(
      checks,
      passName,
      "Delay Status",
      row.label,
      row.count,
      `delayStatus:${pass.delayDays ?? 5}:${row.key}`,
      "exact",
    );
  }
}

function cashOutgoFilter(mode, monthKey, offsetDays, dateContext = {}) {
  return [
    "cashOutgo",
    mode,
    encodeURIComponent(monthKey),
    String(offsetDays),
    dateContext.fromDate ?? "",
    dateContext.toDate ?? "",
    dateContext.asOfDate ?? "",
  ].join(":");
}

function cashOutgoAnyFilter(modes, monthKey, offsetDays, dateContext = {}) {
  return [
    "cashOutgoAny",
    modes.map(encodeURIComponent).join(","),
    encodeURIComponent(monthKey),
    String(offsetDays),
    dateContext.fromDate ?? "",
    dateContext.toDate ?? "",
    dateContext.asOfDate ?? "",
  ].join(":");
}

function rowAmount(row) {
  return n(row.capital) + n(row.revenue);
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
  return capital + revenue > 0 ? [{ monthKey, capital, revenue }] : [];
}

function combineRowsThroughMonthAsSingleMonth(monthKey, rowGroups) {
  let capital = 0;
  let revenue = 0;
  for (const rows of rowGroups) {
    for (const row of rows ?? []) {
      if (!row.monthKey || row.monthKey > monthKey) continue;
      capital += n(row.capital);
      revenue += n(row.revenue);
    }
  }
  return capital + revenue > 0 ? [{ monthKey, capital, revenue }] : [];
}

function combinePendingLiabilityRows(monthKey, rowGroups) {
  let capital = 0;
  let revenue = 0;
  for (const rows of rowGroups) {
    for (const row of rows ?? []) {
      if (!row.monthKey || row.monthKey > monthKey) continue;
      capital += n(row.capital);
      revenue += n(row.revenue);
    }
  }
  return capital + revenue > 0 ? [{ monthKey, capital, revenue }] : [];
}

function collectCashOutgo(checks, passName, summary, pass) {
  const offset = pass.expectedCashOutgoDays ?? 10;
  const selectedMonth = pass.month ?? todayMonth;
  const expectedCashOutgoFyRows = (summary.expectedCashOutgoDpRows ?? []).filter(
    (row) => row.monthKey >= "2026-04" && row.monthKey <= "2027-03",
  );
  const billsPaidInMonthRows = combineRowsForMonth(selectedMonth, [summary.actualCashOutgoRows]);
  const currentLiabilityRows = combinePendingLiabilityRows(selectedMonth, [
    summary.expectedCashOutgoReceiptPendingBillRows,
    summary.expectedCashOutgoBillPreparationRows,
    summary.billSentForPaymentRows,
  ]);
  const cashOutgoForMonthRows = combineRowsForMonth(selectedMonth, [
    summary.expectedCashOutgoBillPreparationRows,
    summary.billSentForPaymentRows,
    expectedCashOutgoFyRows,
  ]);
  const expectedExpenditureTillMonthRows = combineRowsThroughMonthAsSingleMonth(selectedMonth, [
    summary.actualCashOutgoRows,
    summary.expectedCashOutgoBillPreparationRows,
    summary.billSentForPaymentRows,
    summary.expectedCashOutgoReceiptPendingBillRows,
  ]);
  const sources = [
    ["Delivery / D.P. Done, Bill Preparation Pending", "expectedReceiptPendingBill", summary.expectedCashOutgoReceiptPendingBillRows],
    ["Delivery / D.P. Done, Bill Prepared", "billPreparation", summary.expectedCashOutgoBillPreparationRows],
    ["Bills Submitted, Payment Pending", "billSent", summary.billSentForPaymentRows],
    ["Expected Cash Outgo by D.P.", "expectedDp", summary.expectedCashOutgoDpRows],
    ["Actual Cash Outgo as on Date", "actual", summary.actualCashOutgoRows],
    ["Bills Paid in Selected Month", "actual", billsPaidInMonthRows],
    ["Supplementary bills submitted, payment pending", "supplementaryBillSent", summary.supplementaryBillSentForPaymentRows],
    ["Supplementary bills paid", "supplementaryActual", summary.supplementaryActualCashOutgoRows],
    ["Pending returned bills", "pendingReturnedBills", summary.pendingReturnedBillRows],
    ["Returned bills resubmitted", "returnedBillsResubmitted", summary.returnedBillResubmittedRows],
    ["Returned bills paid", "returnedBillsPaid", summary.returnedBillPaidRows],
    ["Pending returned supplementary bills", "supplementaryPendingReturnedBills", summary.supplementaryPendingReturnedBillRows],
    ["Returned supplementary bills resubmitted", "supplementaryReturnedBillsResubmitted", summary.supplementaryReturnedBillResubmittedRows],
    ["Returned supplementary bills paid", "supplementaryReturnedBillsPaid", summary.supplementaryReturnedBillPaidRows],
  ];
  for (const [area, mode, rows] of sources) {
    for (const row of rows ?? []) {
      const amount = rowAmount(row);
      if (amount <= 0) continue;
      addCheck(
        checks,
        passName,
        area,
        row.monthKey,
        1,
        cashOutgoFilter(mode, row.monthKey, offset),
        "nonzero",
      );
    }
  }
  const combinedSources = [
    [
      "Cumulative Liability Up to Month",
      ["expectedReceiptPendingBillThrough", "billPreparationThrough", "billSentThrough"],
      currentLiabilityRows,
    ],
    [
      "Expected cash outgo exclusively for selected month",
      ["billPreparation", "billSent", "expectedDp"],
      cashOutgoForMonthRows,
    ],
    [
      "Expected Expenditure Up to Selected Month",
      ["actualThrough", "billPreparationThrough", "billSentThrough", "expectedReceiptPendingBillThrough"],
      expectedExpenditureTillMonthRows,
    ],
  ];
  for (const [area, modes, rows] of combinedSources) {
    for (const row of rows ?? []) {
      if (rowAmount(row) <= 0) continue;
      addCheck(
        checks,
        passName,
        area,
        row.monthKey,
        1,
        cashOutgoAnyFilter(modes, row.monthKey, offset),
        "nonzero",
      );
    }
  }
}

function collectFocusIssues(passName, summary) {
  const issues = [];
  for (const row of summary.delayRows ?? []) {
    if (!row.focusSection) {
      issues.push({ passName, area: "Delay Status row focus", label: row.fileRef, issue: "missing focusSection" });
    }
    if (row.focusSection === "Supply order and payment" && !row.focusTarget) {
      issues.push({ passName, area: "Delay Status row focus", label: row.fileRef, issue: "missing focusTarget" });
    }
  }
  return issues;
}

const passes = [
  { name: "01 all-active no-category", selectedYear: allActiveFilesYear, fileYear: "all", delayDays: 5 },
  { name: "02 all-active default-category", selectedYear: allActiveFilesYear, fileYear: "all", fileCategories: defaultCategories, delayDays: 5 },
  { name: "03 all-files current-file-year", selectedYear: allFilesYear, fileYear: "2026-27", delayDays: 5 },
  { name: "04 active-plus-current-closed", selectedYear: activePlusCurrentFyClosedYear, fileYear: "all", delayDays: 5 },
  { name: "05 fy-2026 current-file-year", selectedYear: "2026-27", fileYear: "2026-27", delayDays: 5 },
  { name: "06 fy-2026 no-category delay-30", selectedYear: "2026-27", fileYear: "all", delayDays: 30 },
  { name: "07 fy-2026 default-category delay-30", selectedYear: "2026-27", fileYear: "all", fileCategories: defaultCategories, delayDays: 30 },
  { name: "08 fy-2026 initiation-range", selectedYear: "2026-27", fileYear: "all", fileInitiationFrom: "2026-04-01", fileInitiationTo: "2026-09-30", delayDays: 5 },
  { name: "09 fy-2025", selectedYear: "2025-26", fileYear: "all", delayDays: 5 },
  { name: "10 all-files all-file-years", selectedYear: allFilesYear, fileYear: "all", delayDays: 5 },
  { name: "11 all-active custom-category", selectedYear: allActiveFilesYear, fileYear: "all", fileCategories: customCategories, delayDays: 5 },
  { name: "12 fy-2026 custom-category delay-30", selectedYear: "2026-27", fileYear: "all", fileCategories: customCategories, delayDays: 30 },
  { name: "13 initiation from only", selectedYear: allActiveFilesYear, fileYear: "all", fileInitiationFrom: "2026-07-01", delayDays: 5 },
  { name: "14 initiation to only", selectedYear: allActiveFilesYear, fileYear: "all", fileInitiationTo: "2026-06-30", delayDays: 5 },
  { name: "15 initiation narrow month", selectedYear: allActiveFilesYear, fileYear: "all", fileInitiationFrom: "2026-07-01", fileInitiationTo: "2026-07-31", delayDays: 5 },
  { name: "16 initiation empty future range", selectedYear: allActiveFilesYear, fileYear: "all", fileInitiationFrom: "2030-01-01", fileInitiationTo: "2030-12-31", delayDays: 5 },
  { name: "17 custom-category initiation range", selectedYear: allActiveFilesYear, fileYear: "all", fileCategories: customCategories, fileInitiationFrom: "2026-04-01", fileInitiationTo: "2026-09-30", delayDays: 5 },
  { name: "18 all-active all-custom-categories", selectedYear: allActiveFilesYear, fileYear: "all", fileCategories: allCustomCategories, delayDays: 5 },
  { name: "19 all-active contract-custom-categories", selectedYear: allActiveFilesYear, fileYear: "all", fileCategories: contractCustomCategories, delayDays: 5 },
  { name: "20 all-custom initiation range", selectedYear: allActiveFilesYear, fileYear: "all", fileCategories: allCustomCategories, fileInitiationFrom: "2026-04-01", fileInitiationTo: "2026-09-30", delayDays: 5 },
];

async function main() {
  const token = await login();
  const issues = [];
  const focusIssues = [];
  const passSummaries = [];
  try {
    for (const pass of passes) {
      const payload = await api(reportSummaryPath(pass), token);
      const summary = payload.summary ?? {};
      const checks = [];
      const totalFilesResult = await api(searchPath(pass, "totalFiles"), token);
      const totalFilesSearchTotal = n(totalFilesResult.total);
      if (n(summary.reportFileCount) !== totalFilesSearchTotal) {
        issues.push({
          passName: pass.name,
          area: "Report scope",
          label: "reportFileCount",
          count: n(summary.reportFileCount),
          filter: "totalFiles",
          searchTotal: totalFilesSearchTotal,
          issue: "reportFileCount mismatch",
        });
      }
      collectStatus3(checks, pass.name, summary);
      collectMonthly(checks, pass.name, summary);
      collectDelay(checks, pass.name, summary, pass);
      collectCashOutgo(checks, pass.name, summary, pass);
      focusIssues.push(...collectFocusIssues(pass.name, summary));
      let nonZero = 0;
      for (const check of checks) {
        if (check.count <= 0) continue;
        nonZero += 1;
        const result = await api(searchPath(pass, check.filter), token);
        const searchTotal = n(result.total);
        if (check.mode === "exact" && searchTotal !== check.count) {
          issues.push({ ...check, searchTotal, issue: "exact count mismatch" });
        } else if (check.mode === "not-exceed" && searchTotal > check.count) {
          issues.push({ ...check, searchTotal, issue: "landing exceeds counter" });
        } else if (check.mode === "nonzero" && searchTotal === 0) {
          issues.push({ ...check, searchTotal, issue: "non-zero report amount opens no files" });
        }
      }
      passSummaries.push({
        pass: pass.name,
        reportFileCount: summary.reportFileCount,
        checks: checks.length,
        nonZeroChecks: nonZero,
      });
    }
  } finally {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` },
    }).catch(() => undefined);
  }
  console.log(JSON.stringify({ passSummaries, issues, focusIssues }, null, 2));
  if (issues.length || focusIssues.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
