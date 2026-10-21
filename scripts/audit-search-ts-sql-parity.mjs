import { searchFiles } from "../backend/src/utils/file-search.ts";

const base = process.env.BACKEND_URL ?? "http://localhost:3001";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
const filters = [
  "liveSupplyOrders", "deliveryDue", "deliveryCompleted", "deliveryOverdue",
  "jobCompletionDue", "jobCompletionCompleted", "paymentDueOnly", "paymentSubmitted",
  "paymentInProcess", "advancePending", "advancePaid", "supplementaryBill:pending",
  "supplementaryBill:returned", "supplementaryBill:resubmitted",
  "milestonePending:supplyOrder", "manualMilestoneCurrent:Financial Sanction",
  "preBidMeeting:completed", "liveBids", "status2DpPending", "status2DpExpired", "bgExpired:pwb",
  "delayStatus:5:supplyOrder", "delayStatus:5:paymentPreSubmission",
];

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

function fileIds(files) {
  return [...new Set((files ?? []).map((file) => String(file.id)))].sort();
}

function getCategories(fileTypes) {
  const builtIn = new Set(["goods & services", "amc", "mpc", "cars", "o&m"]);
  return [
    "goodsServices", "amc", "mpc", "cars", "om",
    ...(fileTypes ?? [])
      .map((name) => String(name ?? "").trim())
      .filter((name) => name && !builtIn.has(name.toLowerCase()))
      .map((name) => "fileType:" + encodeURIComponent(name)),
  ];
}

async function runSearch(pass, filter, token) {
  const params = new URLSearchParams({
    selectedYear: pass.year,
    page: "1",
    pageSize: "500",
  });
  if (filter) params.set("dashboardFilter", filter);
  if (pass.categories) params.set("fileCategories", pass.categories.join(","));
  if (pass.fileYear && pass.fileYear !== "all") params.set("fileYear", pass.fileYear);
  if (pass.division && pass.division !== "all") params.set("divisionFilter", pass.division);
  const first = await api("/api/files/search?" + params.toString(), token);
  const files = [...(first.files ?? [])];
  const total = Number(first.total ?? 0);
  const pageSize = Number(first.pageSize ?? 500);
  for (let page = 2; (page - 1) * pageSize < total; page += 1) {
    params.set("page", String(page));
    const next = await api("/api/files/search?" + params.toString(), token);
    files.push(...(next.files ?? []));
  }
  return { total, files };
}

async function runReportDelayReference(pass, filter, token) {
  const [, rawDays, milestoneKey] = filter.split(":");
  const params = new URLSearchParams({
    selectedYear: pass.year,
    division: pass.division ?? "all",
    delayDays: rawDays,
    delayMilestone: milestoneKey,
  });
  if (pass.fileCategories) params.set("fileCategories", pass.fileCategories.join(","));
  if (pass.fileYear && pass.fileYear !== "all") params.set("fileYear", pass.fileYear);
  const result = await api("/api/reports/summary?" + params.toString(), token);
  const rows = (result.summary?.delayRows ?? []).filter(
    (row) => row.milestoneKey === milestoneKey,
  );
  return fileIds(rows.map((row) => ({ id: row.fileId })));
}

async function main() {
  const token = await login();
  const settingsPayload = await api("/api/settings", token);
  const settings = settingsPayload.settings ?? {};
  const currentYear = settings.financialYear || settings.selectedYear;
  const start = Number(String(currentYear).match(/\d{4}/)?.[0]);
  const previousYear = String(start - 1) + "-" + String(start % 100).padStart(2, "0");
  const categories = getCategories(settings.fileTypes);
  const fileYears = ["all", ...new Set([...(settings.financialYears ?? []), currentYear, previousYear])];
  const divisions = [
    "all",
    ...new Set(
      (await api("/api/files?year=__all_files__", token)).files
        .map((file) => String(file.division ?? "").trim())
        .filter(Boolean),
    ),
  ];
  const categoryChoices = [
    { name: "All file types", keys: categories },
    ...categories.map((key) => ({ name: key, keys: [key] })),
  ];
  const globalYears = [
    { name: "All active", year: "__all_active_files__" },
    { name: "All files", year: "__all_files__" },
    { name: "Active + current-FY closed", year: "__active_plus_current_fy_closed__" },
    ...[...(settings.financialYears ?? []), currentYear, previousYear]
      .filter(Boolean)
      .filter((year, index, values) => values.indexOf(year) === index)
      .map((year) => ({ name: `Specific ${year}`, year })),
  ];
  const passes = [];
  for (const global of globalYears) {
    passes.push({ name: global.name, year: global.year, fileYear: "all", division: "all", categories });
    for (const fileYear of fileYears.slice(1)) {
      passes.push({ name: global.name, year: global.year, fileYear, division: "all", categories });
    }
    for (const division of divisions.slice(1)) {
      passes.push({ name: global.name, year: global.year, fileYear: "all", division, categories });
    }
    for (const category of categoryChoices.slice(1)) {
      passes.push({ name: global.name, year: global.year, fileYear: "all", division: "all", categories: category.keys, categoryName: category.name });
    }
  }
  const issues = [];
  let checked = 0;

  const sourceByGlobalYear = new Map();
  for (const year of globalYears.map((entry) => entry.year)) {
    if (sourceByGlobalYear.has(year)) continue;
    const visible = await api("/api/files?year=" + encodeURIComponent(year), token);
    sourceByGlobalYear.set(year, visible.files ?? []);
  }

  for (const pass of passes) {
    const sourceFiles = sourceByGlobalYear.get(pass.year) ?? [];
    for (const filter of filters) {
      const scopedSourceFiles = sourceFiles.filter((file) =>
        (pass.fileYear === "all" || file.year === pass.fileYear) &&
        (pass.division === "all" || String(file.division ?? "").toLowerCase() === pass.division.toLowerCase()),
      );
      const expected = filter?.startsWith("delayStatus:")
        ? await runReportDelayReference(
            { ...pass, fileCategories: pass.categories },
            filter,
            token,
          )
        : fileIds(searchFiles(scopedSourceFiles, {
            selectedYear: pass.year,
            dashboardFilter: filter,
            fileCategories: pass.categories,
            sortColumnKey: "none",
          }));
      const result = await runSearch({
        ...pass,
        categories: pass.categories,
        fileCategories: pass.categories.join(","),
      }, filter, token);
      const actual = fileIds(result.files);
      const missing = expected.filter((id) => !actual.includes(id));
      const extra = actual.filter((id) => !expected.includes(id));
      checked += 1;
      if (result.total !== expected.length || missing.length || extra.length) {
        issues.push({
          pass: pass.name,
          fileYear: pass.fileYear,
          division: pass.division,
          fileTypes: pass.categoryName ?? "All file types",
          filter,
          tsFileCount: expected.length,
          sqlFileCount: result.total,
          missing: missing.slice(0, 10),
          extra: extra.slice(0, 10).map((id) => {
            const file = sourceFiles.find((candidate) => String(candidate.id) === id);
            return { id, uniqueCode: file?.uniqueCode, controlNo: file?.fileNo };
          }),
        });
      }
    }
  }

  const plainSearchPasses = globalYears.filter((global) =>
    global.year === "__all_files__" || global.year === "__all_active_files__" ||
    global.year === "__active_plus_current_fy_closed__" || /^\d{4}-\d{2}$/.test(global.year),
  );
  for (const pass of plainSearchPasses) {
    const sourceFiles = sourceByGlobalYear.get(pass.year) ?? [];
    const expected = fileIds(searchFiles(sourceFiles, {
      selectedYear: pass.year,
      sortColumnKey: "none",
    }));
    const result = await runSearch(pass, undefined, token);
    const actual = fileIds(result.files);
    const missing = expected.filter((id) => !actual.includes(id));
    const extra = actual.filter((id) => !expected.includes(id));
    checked += 1;
    if (result.total !== expected.length || missing.length || extra.length) {
      issues.push({
        pass: `plain Search: ${pass.name}`,
        tsFileCount: expected.length,
        sqlFileCount: result.total,
        missing: missing.slice(0, 10),
        extra: extra.slice(0, 10),
      });
    }
  }

  console.log(JSON.stringify({
    checked,
    globalFilterOptions: globalYears.length,
    subfilterPasses: passes.length,
    clickerFilters: filters.length,
    coverage: "each global option crossed with every initiation-year, division, and individual file-type option; plain Search is compared separately for All Files, All Active Files, Active + current-FY closed, and each specific FY; multi-filter cross-products are covered by audit-filter-scope-matrix.mjs",
    issues,
  }, null, 2));
  if (issues.length) process.exitCode = 1;
  await fetch(base + "/api/auth/logout", {
    method: "POST",
    headers: { cookie: "recordkeeper_session=" + encodeURIComponent(token) },
  }).catch(() => undefined);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
