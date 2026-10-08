import { isFileVisibleForYear } from "../src/lib/year-filter.ts";
import { getFileTypeCategoryKey, matchesFileCategorySelection } from "../backend/src/utils/file-categories.ts";

const API_BASE_URL = process.env.BACKEND_URL ?? "http://localhost:3001";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
const pageSize = 500;
const concurrency = Number(process.env.AUDIT_CONCURRENCY ?? 10);

const GLOBAL_ALL_FILES = "__all_files__";
const GLOBAL_ALL_ACTIVE = "__all_active_files__";
const GLOBAL_ACTIVE_CURRENT_CLOSED = "__active_plus_current_fy_closed__";
const DEFAULT_FILE_TYPE_CATEGORIES = ["goodsServices", "amc", "mpc", "cars", "om"];
const BUILT_IN_TYPES = new Set(["goods & services", "amc", "mpc", "cars", "o&m"]);

async function login() {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`login failed: ${body?.error ?? response.status}`);
  const cookie = response.headers.get("set-cookie") ?? "";
  const match = cookie.match(/recordkeeper_session=([^;]+)/);
  if (!match) throw new Error("login did not return a session cookie");
  return decodeURIComponent(match[1]);
}

async function api(path, token) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`${path} failed ${response.status}: ${body?.error ?? response.status}`);
  return body;
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function financialYears(settings, files) {
  const configured = Array.isArray(settings.financialYears) ? settings.financialYears : [];
  const stored = files.flatMap((file) => [file.year, ...(file.activeYears ?? [])]);
  return unique([...configured, ...stored]).filter((year) => /^\d{4}-\d{2}$/.test(year)).sort();
}

function categoryOptions(fileTypes) {
  const custom = unique(fileTypes ?? [])
    .filter((fileType) => !BUILT_IN_TYPES.has(fileType.toLowerCase()))
    .map(getFileTypeCategoryKey);
  const keys = [...DEFAULT_FILE_TYPE_CATEGORIES, ...custom];
  return [
    { label: "All file types", keys },
    ...keys.map((key) => ({ label: key, keys: [key] })),
  ];
}

function ids(files) {
  return [...new Set((files ?? []).map((file) => String(file.id)))].sort();
}

function categoryParam(keys) {
  return keys.join(",");
}

function scopeParams(scope) {
  const params = new URLSearchParams({
    selectedYear: scope.globalYear,
    dashboardFilter: "totalFiles",
    page: "1",
    pageSize: String(pageSize),
  });
  if (scope.fileYear !== "all") params.set("fileYear", scope.fileYear);
  if (scope.division !== "all") params.set("divisionFilter", scope.division);
  if (scope.categories?.length) params.set("fileCategories", categoryParam(scope.categories));
  if (scope.fileInitiationFrom) params.set("fileInitiationFrom", scope.fileInitiationFrom);
  if (scope.fileInitiationTo) params.set("fileInitiationTo", scope.fileInitiationTo);
  return params;
}

function expectedForScope(sourceFiles, settings, scope) {
  return sourceFiles.filter((file) => {
    if (!isFileVisibleForYear(file, scope.globalYear, settings.financialYear)) return false;
    if (scope.fileYear !== "all" && file.year !== scope.fileYear) return false;
    if (scope.division !== "all" && file.division?.toLowerCase() !== scope.division.toLowerCase()) return false;
    if (scope.categories?.length && !matchesFileCategorySelection(file, scope.categories)) return false;
    if (scope.fileInitiationFrom && (!file.receivedDate || file.receivedDate < scope.fileInitiationFrom)) return false;
    if (scope.fileInitiationTo && (!file.receivedDate || file.receivedDate > scope.fileInitiationTo)) return false;
    return true;
  });
}

async function runChecks(checks, sourceFiles, settings, token) {
  const issues = [];
  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < checks.length) {
      const index = next++;
      const scope = checks[index];
      const expectedIds = ids(expectedForScope(sourceFiles, settings, scope));
      const path = `/api/files/search?${scopeParams(scope).toString()}`;
      try {
        const response = await api(path, token);
        const actualIds = ids(response.files);
        const expectedSet = new Set(expectedIds);
        const actualSet = new Set(actualIds);
        const missing = expectedIds.filter((id) => !actualSet.has(id));
        const extra = actualIds.filter((id) => !expectedSet.has(id));
        if (Number(response.total ?? 0) !== expectedIds.length || missing.length || extra.length) {
          issues.push({
            type: "scope-membership-mismatch",
            globalYear: scope.globalYear,
            fileYear: scope.fileYear,
            division: scope.division,
            fileTypes: scope.categoryLabel,
            fileInitiationFrom: scope.fileInitiationFrom,
            fileInitiationTo: scope.fileInitiationTo,
            expected: expectedIds.length,
            actual: Number(response.total ?? 0),
            missing: missing.slice(0, 8),
            extra: extra.slice(0, 8),
          });
        }
      } catch (error) {
        issues.push({
          type: "scope-request-failed",
          globalYear: scope.globalYear,
          fileYear: scope.fileYear,
          division: scope.division,
          fileTypes: scope.categoryLabel,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
  await Promise.all(workers);
  return issues;
}

async function main() {
  const token = await login();
  try {
    const { settings = {} } = await api("/api/settings", token);
    const baselineParams = new URLSearchParams({
      selectedYear: GLOBAL_ALL_FILES,
      dashboardFilter: "totalFiles",
      page: "1",
      pageSize: String(pageSize),
    });
    const baselineCategories = categoryOptions(settings.fileTypes);
    baselineParams.set("fileCategories", categoryParam(baselineCategories[0].keys));
    const baselineResponse = await api(`/api/files/search?${baselineParams.toString()}`, token);
    if (Number(baselineResponse.total ?? 0) > pageSize) {
      throw new Error(`baseline exceeds page size ${pageSize}; increase AUDIT_PAGE_SIZE in the script`);
    }
    const sourceFiles = baselineResponse.files ?? [];
    const years = financialYears(settings, sourceFiles);
    const globalYears = [GLOBAL_ALL_FILES, GLOBAL_ALL_ACTIVE, GLOBAL_ACTIVE_CURRENT_CLOSED, ...years];
    const fileYears = ["all", ...years];
    const divisions = ["all", ...unique(sourceFiles.map((file) => file.division))];
    const categories = baselineCategories;
    const matrix = [];
    for (const globalYear of globalYears) {
      for (const fileYear of fileYears) {
        for (const division of divisions) {
          for (const category of categories) {
            matrix.push({
              globalYear,
              fileYear,
              division,
              categories: category.keys,
              categoryLabel: category.label,
            });
          }
        }
      }
    }

    const pairChecks = [];
    for (const globalYear of globalYears) {
      for (const fileYear of fileYears) {
        for (const division of divisions) {
          for (let left = 1; left < categories.length; left += 1) {
            for (let right = left + 1; right < categories.length; right += 1) {
              pairChecks.push({
                globalYear,
                fileYear,
                division,
                categories: [...categories[left].keys, ...categories[right].keys],
                categoryLabel: `${categories[left].label} + ${categories[right].label}`,
              });
            }
          }
        }
      }
    }

    const dateChecks = [];
    for (const globalYear of globalYears) {
      for (const year of years) {
        const start = Number(year.slice(0, 4));
        const end = Number(`20${year.slice(-2)}`);
        const from = `${start}-04-01`;
        const to = `${end}-03-31`;
        dateChecks.push(
          { globalYear, fileYear: "all", division: "all", categories: categories[0].keys, categoryLabel: "All file types", fileInitiationFrom: from, fileInitiationTo: to },
          { globalYear, fileYear: "all", division: "all", categories: categories[0].keys, categoryLabel: "All file types", fileInitiationFrom: from },
          { globalYear, fileYear: "all", division: "all", categories: categories[0].keys, categoryLabel: "All file types", fileInitiationTo: to },
        );
      }
    }

    const allChecks = [...matrix, ...pairChecks, ...dateChecks];
    const issues = await runChecks(allChecks, sourceFiles, settings, token);
    const issuesByGlobal = {};
    const issuesByType = {};
    const affectedIds = new Set();
    for (const issue of issues) {
      issuesByGlobal[issue.globalYear] = (issuesByGlobal[issue.globalYear] ?? 0) + 1;
      issuesByType[issue.type] = (issuesByType[issue.type] ?? 0) + 1;
      for (const id of [...(issue.missing ?? []), ...(issue.extra ?? [])]) affectedIds.add(id);
    }
    const verbose = process.env.AUDIT_VERBOSE === "1";
    console.log(JSON.stringify({
      sourceFiles: sourceFiles.length,
      globalFilterOptions: globalYears.length,
      initiationYearOptions: fileYears.length,
      divisionOptions: divisions.length,
      fileTypeSelections: categories.length,
      exhaustiveScopeCombinations: matrix.length,
      fileTypePairChecks: pairChecks.length,
      initiationDateChecks: dateChecks.length,
      checked: allChecks.length,
      issueCount: issues.length,
      issuesByType,
      issuesByGlobal,
      uniqueAffectedIds: [...affectedIds],
      issues: verbose ? issues : issues.slice(0, 12),
      issuesTruncated: !verbose && issues.length > 12,
    }, null, 2));
    if (issues.length) process.exitCode = 1;
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
