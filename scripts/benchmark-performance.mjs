const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3001";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
const prefix = process.env.BENCHMARK_QA_PREFIX ?? "QA-PERF-20261025-";
const requestTimeoutMs = Number(process.env.BENCHMARK_TIMEOUT_MS ?? 120_000);
const repetitions = Number(process.env.BENCHMARK_REPETITIONS ?? 3);
const onlyExport = process.env.BENCHMARK_ONLY_EXPORT === "true";
const years = ["2022-23", "2023-24", "2024-25", "2025-26", "2026-27"];
const archiveLevels = [0, 1, 2, 3, 4];

function ms(start) {
  return Math.round(Number(process.hrtime.bigint() - start) / 1_000_000);
}

async function login() {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`login failed ${response.status}: ${body?.error ?? "unknown"}`);
  const cookie = response.headers.get("set-cookie") ?? "";
  const match = cookie.match(/recordkeeper_session=([^;]+)/);
  if (!match) throw new Error("login did not return a session cookie");
  return decodeURIComponent(match[1]);
}

async function request(path, token, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        cookie: `recordkeeper_session=${encodeURIComponent(token)}`,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const buffer = await response.arrayBuffer();
    let body;
    try {
      body = JSON.parse(Buffer.from(buffer).toString("utf8"));
    } catch {
      body = undefined;
    }
    if (!response.ok) throw new Error(`${path} failed ${response.status}: ${body?.error ?? "unknown"}`);
    return { status: response.status, bytes: buffer.byteLength, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function setArchiveState(token, label, archived) {
  await request(`/api/settings/financial-years/${encodeURIComponent(label)}/archive`, token, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ archived }),
  });
}

function baseQuery(archiveCount) {
  const query = new URLSearchParams({ selectedYear: "__all_files__", division: "all" });
  if (archiveCount >= 0) query.set("benchmarkArchiveLevel", String(archiveCount));
  return query;
}

function searchPath(query, extra = {}) {
  const params = new URLSearchParams(query);
  params.set("page", "1");
  params.set("pageSize", "100");
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return `/api/files/search?${params}`;
}

function dashboardPath(query, endpoint = "summary") {
  const params = new URLSearchParams(query);
  params.set("version", "5");
  return `/api/dashboard/${endpoint}?${params}`;
}

function reportsPath(query, extra = {}) {
  const params = new URLSearchParams(query);
  const defaults = {
    delayDays: "5",
    delayMilestone: "all",
    expectedCashOutgoDays: "10",
    cashOutgoMonth: "2026-09",
    warrantyBgBufferDays: "60",
    ...extra,
  };
  for (const [key, value] of Object.entries(defaults)) params.set(key, String(value));
  return `/api/reports/summary?${params}`;
}

function cashOutGoPath() {
  return "/api/reports/cash-out-go-plan?financialYear=2026-27&divisionId=all&includePreviousFySubmitted=false";
}

function merPath() {
  return "/api/reports/mer-data?financialYear=2026-27";
}

function resultCount(body) {
  if (!body || typeof body !== "object") return undefined;
  if (typeof body.total === "number") return body.total;
  if (Array.isArray(body.files)) return body.files.length;
  if (Array.isArray(body.rows)) return body.rows.length;
  if (body.summary && typeof body.summary === "object") {
    const summary = body.summary;
    const arrays = Object.values(summary).filter(Array.isArray);
    return arrays.reduce((total, rows) => total + rows.length, 0);
  }
  if (body.plan && typeof body.plan === "object") {
    return Object.values(body.plan).filter(Array.isArray).reduce((total, rows) => total + rows.length, 0);
  }
  return undefined;
}

function endpointMatrix(query) {
  return [
    { area: "Search", option: "All files", method: "GET", path: searchPath(query) },
    { area: "Search", option: "QA prefix/free text", method: "GET", path: searchPath(query, { freeText: prefix }) },
    { area: "Search", option: "Division filter", method: "GET", path: searchPath(query, { divisionFilter: "ACC" }) },
    { area: "Search", option: "File type filter", method: "GET", path: searchPath(query, { selectedFileTypes: "Goods & Services" }) },
    { area: "Search", option: "Workflow clicker: Payment pending", method: "GET", path: searchPath(query, { dashboardFilter: "statusSummary:Payment:Pending" }) },
    { area: "Search", option: "Workflow clicker: Bidding", method: "GET", path: searchPath(query, { dashboardFilter: "analyticsMilestoneClearing:bidding" }) },
    { area: "Dashboard", option: "Snapshot/Analytics summary", method: "GET", path: dashboardPath(query) },
    { area: "Dashboard", option: "Month-wise delivery schedule", method: "GET", path: dashboardPath(query, "monthwise-delivery-schedule") },
    { area: "Dashboard", option: "Co-bidding firms", method: "GET", path: dashboardPath(query, "co-bidding-firms") },
    { area: "Dashboard", option: "Suspected anomalies", method: "GET", path: dashboardPath(query, "suspected-anomalies") },
    { area: "Reports", option: "Reports summary", method: "GET", path: reportsPath(query) },
    { area: "Reports", option: "Delay Status: Payment", method: "GET", path: reportsPath(query, { delayMilestone: "payment" }) },
    { area: "Reports", option: "Delay Status: Bidding", method: "GET", path: reportsPath(query, { delayMilestone: "bidding" }) },
    { area: "Reports", option: "Month-wise payment/report rows", method: "GET", path: reportsPath(query, { expectedCashOutgoDays: "20" }) },
    { area: "Reports", option: "Cash Out Go Plan", method: "GET", path: cashOutGoPath() },
    { area: "Reports", option: "MER data", method: "GET", path: merPath() },
  ];
}

async function benchmarkEndpoint(token, endpoint, volume, archiveCount) {
  const samples = [];
  let last;
  for (let index = 0; index < repetitions; index += 1) {
    const started = process.hrtime.bigint();
    try {
      last = await request(endpoint.path, token, endpoint.method === "POST" ? endpoint.init : undefined);
      samples.push(ms(started));
    } catch (error) {
      return {
        volume,
        archiveCount,
        area: endpoint.area,
        option: endpoint.option,
        status: "ERROR",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    volume,
    archiveCount,
    area: endpoint.area,
    option: endpoint.option,
    status: last.status,
    firstMs: samples[0],
    medianMs: sorted[Math.floor(sorted.length / 2)],
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    responseBytes: last.bytes,
    resultRows: resultCount(last.body),
  };
}

async function benchmarkExport(token, query, volume, archiveCount) {
  const body = {
    format: "excel",
    title: "QA performance benchmark",
    columns: [
      { key: "uniqueCode", label: "Unique Code" },
      { key: "year", label: "Financial Year" },
      { key: "division", label: "Division" },
      { key: "currentMilestone", label: "Current Milestone" },
    ],
    query: Object.fromEntries(new URLSearchParams(searchPath(query).split("?")[1])),
  };
  const samples = [];
  let last;
  for (let index = 0; index < repetitions; index += 1) {
    const started = process.hrtime.bigint();
    try {
      last = await request("/api/files/export/search", token, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      samples.push(ms(started));
    } catch (error) {
      return { volume, archiveCount, area: "Exports", option: "Search Excel export", status: "ERROR", error: String(error) };
    }
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    volume,
    archiveCount,
    area: "Exports",
    option: "Search Excel export",
    status: last.status,
    firstMs: samples[0],
    medianMs: sorted[Math.floor(sorted.length / 2)],
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    responseBytes: last.bytes,
  };
}

async function main() {
  const token = await login();
  const settings = (await request("/api/settings", token)).body.settings;
  const initialArchive = new Map(
    (settings.financialYearStatuses ?? []).map((status) => [status.label, status.archived === true]),
  );
  const results = [];
  try {
    for (const archiveCount of archiveLevels) {
      for (const [index, year] of years.entries()) {
        const shouldArchive = index < archiveCount && year !== settings.financialYear;
        await setArchiveState(token, year, shouldArchive);
      }
      const query = baseQuery(archiveCount);
      const volume = 10000 - archiveCount * 2000;
      if (!onlyExport) {
        for (const endpoint of endpointMatrix(query)) {
          results.push(await benchmarkEndpoint(token, endpoint, volume, archiveCount));
        }
      }
      results.push(await benchmarkExport(token, query, volume, archiveCount));
      console.log(`Completed ${volume} searchable QA cohort benchmark.`);
    }
  } finally {
    for (const year of years) {
      if (initialArchive.has(year)) await setArchiveState(token, year, initialArchive.get(year));
    }
  }
  console.log(JSON.stringify({
    generatedPrefix: prefix,
    repetitions,
    timeoutMs: requestTimeoutMs,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
