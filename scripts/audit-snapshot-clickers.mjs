const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";

const defaultCategories = "goodsServices,amc,mpc,cars,om";
const allCustomCategories =
  "fileType:CAPSI,fileType:DcPP%20(Contract),fileType:DcPP%20(G%26S),fileType:I%26M%20(Contract),fileType:I%26M%20(G%26S)";
const allConfiguredCategories = `${defaultCategories},${allCustomCategories}`;

const passes = [
  { name: "omitted", selectedYear: "__all_active_files__", fileYear: "all" },
  {
    name: "all configured",
    selectedYear: "__all_active_files__",
    fileYear: "all",
    fileCategories: allConfiguredCategories,
  },
  {
    name: "fixed built-in",
    selectedYear: "__all_active_files__",
    fileYear: "all",
    fileCategories: defaultCategories,
  },
  {
    name: "all custom",
    selectedYear: "__all_active_files__",
    fileYear: "all",
    fileCategories: allCustomCategories,
  },
  { name: "FY 2026-27", selectedYear: "2026-27", fileYear: "all" },
  { name: "FY 2025-26", selectedYear: "2025-26", fileYear: "all" },
  { name: "entire database", selectedYear: "__all_files__", fileYear: "all" },
  { name: "division ACC", selectedYear: "__all_active_files__", fileYear: "all", division: "ACC" },
  {
    name: "initiation range",
    selectedYear: "__all_active_files__",
    fileYear: "all",
    fileInitiationFrom: "2026-04-01",
    fileInitiationTo: "2026-09-30",
  },
  {
    name: "future empty initiation",
    selectedYear: "__all_active_files__",
    fileYear: "all",
    fileInitiationFrom: "2030-01-01",
    fileInitiationTo: "2030-12-31",
  },
];

function n(value) {
  return Number(value ?? 0) || 0;
}

function dashboardPath(pass) {
  const params = new URLSearchParams({
    version: "5",
    selectedYear: pass.selectedYear,
    division: pass.division ?? "all",
  });
  if (pass.fileYear && pass.fileYear !== "all") params.set("fileYear", pass.fileYear);
  if (pass.fileCategories !== undefined) params.set("fileCategories", pass.fileCategories);
  if (pass.fileInitiationFrom) params.set("fileInitiationFrom", pass.fileInitiationFrom);
  if (pass.fileInitiationTo) params.set("fileInitiationTo", pass.fileInitiationTo);
  return `/api/dashboard/summary?${params.toString()}`;
}

function searchPath(pass, dashboardFilter) {
  const params = new URLSearchParams({
    selectedYear: pass.selectedYear,
    page: "1",
    pageSize: "1000",
    dashboardFilter,
  });
  if (pass.division && pass.division !== "all") params.set("divisionFilter", pass.division);
  if (pass.fileYear && pass.fileYear !== "all") params.set("fileYear", pass.fileYear);
  if (pass.fileCategories !== undefined) params.set("fileCategories", pass.fileCategories);
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

function collectSnapshotCounters(summary) {
  const counters = [];
  for (const stat of summary.topSummaryStats ?? []) {
    const entries = stat.value ?? [];
    counters.push(
      ...entries
        .filter((entry) => entry.searchFilter)
        .map((entry) => ({
          area: "Snapshot attribute",
          label: `${stat.label} / ${entry.label}`,
          expected: n(entry.value),
          filter: entry.searchFilter,
        })),
    );
  }
  for (const mode of summary.modeCounts ?? []) {
    counters.push({
      area: "Snapshot bidding mode",
      label: `Bidding Mode / ${mode.name}`,
      expected: n(mode.count),
      filter: `mode:${mode.name}`,
    });
  }
  for (const mode of summary.gemBiddingModeCounts ?? []) {
    counters.push({
      area: "Snapshot GeM bidding mode",
      label: `GeM bidding mode / ${mode.name}`,
      expected: n(mode.count),
      filter: `gemBiddingMode:${encodeURIComponent(mode.name)}`,
    });
  }
  for (const entry of summary.fileTypeStats?.value ?? []) {
    counters.push({
      area: "Snapshot file type",
      label: `File Type / ${entry.label}`,
      expected: n(entry.value),
      filter: entry.searchFilter,
    });
  }
  for (const entry of summary.firmTypeStats?.value ?? []) {
    counters.push({
      area: "Snapshot firm type",
      label: `Firm Type / ${entry.label}`,
      expected: n(entry.value),
      filter: entry.searchFilter,
    });
  }
  return counters.filter((counter) => counter.filter);
}

function checkAttributePartitions(issues, pass, summary) {
  const dashboardFileCount = n(summary.dashboardFileCount);
  for (const stat of summary.topSummaryStats ?? []) {
    const total = (stat.value ?? []).reduce((sum, entry) => sum + n(entry.value), 0);
    if (total !== dashboardFileCount) {
      issues.push({
        pass: pass.name,
        area: "Snapshot attribute partition",
        label: stat.label,
        expected: dashboardFileCount,
        actual: total,
      });
    }
  }
  const fileTypeTotal = (summary.fileTypeStats?.value ?? []).reduce(
    (sum, entry) => sum + n(entry.value),
    0,
  );
  if (fileTypeTotal !== dashboardFileCount) {
    issues.push({
      pass: pass.name,
      area: "Snapshot file type partition",
      expected: dashboardFileCount,
      actual: fileTypeTotal,
    });
  }
}

async function main() {
  const token = await login();
  const issues = [];
  const passSummaries = [];

  for (const pass of passes) {
    const payload = await api(dashboardPath(pass), token);
    const summary = payload.summary ?? payload;
    checkAttributePartitions(issues, pass, summary);
    const counters = collectSnapshotCounters(summary);
    let nonZeroCounters = 0;

    for (const counter of counters) {
      const result = await api(searchPath(pass, counter.filter), token);
      const actual = n(result.total ?? result.files?.length ?? result.items?.length);
      if (counter.expected > 0) nonZeroCounters += 1;
      if (actual !== counter.expected) {
        issues.push({
          pass: pass.name,
          area: counter.area,
          label: counter.label,
          issue: "clicker count mismatch",
          expected: counter.expected,
          actual,
          filter: counter.filter,
        });
      }
    }

    passSummaries.push({
      pass: pass.name,
      dashboardFileCount: n(summary.dashboardFileCount),
      checks: counters.length,
      nonZeroChecks: nonZeroCounters,
    });
  }

  console.log(JSON.stringify({ passSummaries, issues }, null, 2));
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
