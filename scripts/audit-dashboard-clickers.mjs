const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const selectedYear = process.env.AUDIT_SELECTED_YEAR ?? "__all_active_files__";
const username = process.env.AUDIT_USERNAME ?? "ovais";
const password = process.env.AUDIT_PASSWORD ?? "ovais123";

function n(value) {
  return Number(value ?? 0);
}

function add(counters, area, label, count, filter) {
  counters.push({ area, label, count: n(count), filter });
}

function isBgKey(key) {
  return key === "psb" || key === "pwb" || key === "psbPwb";
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

function collectStatusCounters(summary) {
  const counters = [];
  for (const row of summary.statusFlow ?? []) {
    const key = String(row.key ?? "");
    const title = String(row.label ?? key);
    if ("valid" in row) {
      add(counters, "Status-1", `${title} / Valid`, row.valid, "deliveryPeriodValid");
      add(counters, "Status-1", `${title} / Expired`, row.expired, "deliveryPeriodExpired");
      add(counters, "Status-1", `${title} / Extended`, row.extended, "deliveryPeriodExtended");
      continue;
    }
    if ("due" in row) {
      add(counters, "Status-1", `${title} / Completed`, row.completed, "deliveryCompleted");
      add(counters, "Status-1", `${title} / Pending`, row.due, "deliveryDue");
      add(counters, "Status-1", `${title} / Overdue`, row.overdue, "deliveryOverdue");
      continue;
    }
    if ("irPreparationPending" in row) {
      add(counters, "Status-1", `${title} / IR Preparation Pending`, row.irPreparationPending, "irPreparationPending");
      add(counters, "Status-1", `${title} / IR Receipt Pending`, row.irReceiptPending, "irReceiptPending");
      add(counters, "Status-1", `${title} / IR Completed`, row.irCompleted, "irCompleted");
      continue;
    }
    if (key === "financialSanction") {
      add(counters, "Status-1", `${title} / Completed`, row.financialSanctionCompleted ?? row.cleared, "manualMilestoneCompleted:Financial Sanction");
      add(counters, "Status-1", `${title} / Pending`, row.financialSanctionPending ?? row.pending, "manualMilestoneCurrent:Financial Sanction");
      add(counters, "Status-1", `${title} / At Previous Stage`, row.underProcess, "milestoneUnderProcess:financialSanction");
      continue;
    }
    if (key === "bidding") {
      add(counters, "Status-1", `${title} / Live`, row.liveBids, "liveBids");
      add(counters, "Status-1", `${title} / In process`, row.inProcessBids, "milestoneActive:bidding");
      add(counters, "Status-1", `${title} / Opening overdue`, row.overdueBids, "bidOverdue");
      add(counters, "Status-1", `${title} / Completed`, row.cleared, "milestoneCleared:bidding");
      add(counters, "Status-1", `${title} / At previous stages`, row.underProcess, "milestoneUnderProcess:bidding");
      continue;
    }
    if (key === "supplyOrder") {
      add(counters, "Status-1", `${title} / Placed`, row.cleared, "milestoneCleared:supplyOrder");
      add(counters, "Status-1", `${title} / Live`, row.liveSupplyOrders, "liveSupplyOrders");
      add(counters, "Status-1", `${title} / Pending`, row.pending, "milestonePending:supplyOrder");
      add(counters, "Status-1", `${title} / At Previous Stage`, row.underProcess, "milestoneUnderProcess:supplyOrder");
      continue;
    }
    if (isBgKey(key)) {
      add(counters, "Status-1", `${title} / Pending`, row.pending, `milestonePending:${key}`);
      add(counters, "Status-1", `${title} / Received`, row.cleared, `milestoneCleared:${key}`);
      add(counters, "Status-1", `${title} / Expired`, row.bgExpired, `bgExpired:${key}`);
      add(counters, "Status-1", `${title} / To be returned`, row.bgToBeReturned, `bgToBeReturned:${key}`);
      add(counters, "Status-1", `${title} / Returned`, row.bgReturned, `bgReturned:${key}`);
      continue;
    }
    if (key === "payment") {
      add(counters, "Status-1", `${title} / Completed`, row.cleared, "milestoneCleared:payment");
      add(counters, "Status-1", `${title} / Pending`, row.pending, "milestonePending:payment");
      add(counters, "Status-1", `${title} / Advance Paid`, row.advancePaid, "advancePaid");
      add(counters, "Status-1", `${title} / Advance Pending`, row.advancePending, "advancePending");
      continue;
    }
    if (key === "scrutiny" || key === "cfa") {
      add(counters, "Status-1", `${title} / In process`, row.active, `milestoneActive:${key}`);
      add(counters, "Status-1", `${title} / Reviewed`, row.reviewed, `milestoneReviewed:${key}`);
      add(counters, "Status-1", `${title} / Pending`, row.pending, `milestonePending:${key}`);
      add(counters, "Status-1", `${title} / Total`, row.total, `milestoneTotal:${key}`);
      add(counters, "Status-1", `${title} / Completed`, row.cleared, `milestoneCleared:${key}`);
      continue;
    }
    if (["highValue", "tcec", "ifa", "postTcec", "cnc"].includes(key)) {
      add(counters, "Status-1", `${title} / Total`, row.total, `milestoneTotal:${key}`);
      add(counters, "Status-1", `${title} / Completed`, row.cleared, `milestoneCleared:${key}`);
      add(counters, "Status-1", `${title} / At previous stage`, row.underProcess, `milestoneUnderProcess:${key}`);
      add(counters, "Status-1", `${title} / In process`, row.active, `milestoneActive:${key}`);
      add(counters, "Status-1", `${title} / Reviewed`, row.reviewed, `milestoneReviewed:${key}`);
      add(counters, "Status-1", `${title} / Pending`, row.pending, `milestonePending:${key}`);
      continue;
    }
    add(counters, "Status-1", `${title} / Total`, row.total, `milestoneTotal:${key}`);
    add(counters, "Status-1", `${title} / Completed`, row.cleared, `milestoneCleared:${key}`);
    add(counters, "Status-1", `${title} / In process`, row.active, `milestoneActive:${key}`);
    add(counters, "Status-1", `${title} / At previous stage`, row.underProcess, `milestoneUnderProcess:${key}`);
  }
  return counters;
}

function collectSnapshotCounters(summary) {
  const counters = [];
  for (const stat of summary.topSummaryStats ?? []) {
    for (const entry of stat.value ?? []) {
      if (entry.searchFilter) add(counters, "Snapshot", `${stat.label} / ${entry.label}`, entry.value, entry.searchFilter);
    }
  }
  for (const entry of summary.fileTypeStats?.value ?? []) {
    if (entry.searchFilter) add(counters, "Snapshot", `File Type / ${entry.label}`, entry.value, entry.searchFilter);
  }
  for (const entry of summary.firmTypeStats?.value ?? []) {
    if (entry.searchFilter) add(counters, "Snapshot", `Firm Type / ${entry.label}`, entry.value, entry.searchFilter);
  }
  for (const mode of summary.modeCounts ?? []) {
    add(counters, "Snapshot", `Bidding Mode / ${mode.name}`, mode.count, `mode:${mode.name}`);
  }
  const misc = summary.miscellaneousCounts ?? {};
  add(counters, "Misc", "Live files", misc.liveFiles, "miscLiveFiles");
  add(counters, "Misc", "File closed", misc.fileClosed, "miscFileClosed");
  add(counters, "Misc", "LD", misc.ld, "miscLd");
  add(counters, "Misc", "Demand cancelled", misc.demandCancelled, "miscDemandCancelled");
  add(counters, "Misc", "S.O. cancelled", misc.soCancelled, "miscSoCancelled");
  add(counters, "Misc", "Multiple S.O.", misc.multipleSupplyOrders, "miscMultipleSupplyOrders");
  return counters;
}

function collectStatus3Counters(summary) {
  const counters = [];
  for (const group of summary.statusSummaryGroups ?? []) {
    for (const row of group.rows ?? []) {
      for (const column of group.columns ?? []) {
        const value = row.counts?.[column];
        if (value === undefined || value === "-") continue;
        add(counters, "Status-3", `${row.milestone} / ${column}`, value, `statusSummary:${encodeURIComponent(row.milestone)}:${encodeURIComponent(column)}`);
      }
    }
  }
  return counters;
}

async function searchTotal(filter, token) {
  const params = new URLSearchParams({
    selectedYear,
    dashboardFilter: filter,
    page: "1",
    pageSize: "1",
  });
  const result = await api(`/api/files/search?${params.toString()}`, token);
  return n(result.total);
}

async function main() {
  const token = await login();
  try {
    const params = new URLSearchParams({
      selectedYear,
      division: "all",
      analyticsDivision: "all",
    });
    const { summary } = await api(`/api/dashboard/summary?${params.toString()}`, token);
    const counters = [
      ...collectSnapshotCounters(summary),
      ...collectStatusCounters(summary),
      ...collectStatus3Counters(summary),
    ];
    const mismatches = [];
    for (const counter of counters) {
      const total = await searchTotal(counter.filter, token);
      if (total !== counter.count) mismatches.push({ ...counter, searchTotal: total });
    }
    console.log(JSON.stringify({ selectedYear, checked: counters.length, mismatches }, null, 2));
    if (mismatches.length) process.exitCode = 1;
  } finally {
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
