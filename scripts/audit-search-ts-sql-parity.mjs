import { searchFiles } from "../backend/src/utils/file-search.ts";

const base = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
const filters = [
  "liveSupplyOrders", "deliveryDue", "deliveryCompleted", "deliveryOverdue",
  "jobCompletionDue", "jobCompletionCompleted", "paymentDueOnly", "paymentSubmitted",
  "paymentInProcess", "advancePending", "advancePaid", "supplementaryBill:pending",
  "supplementaryBill:returned", "supplementaryBill:resubmitted",
  "milestonePending:supplyOrder", "manualMilestoneCurrent:Financial Sanction",
  "preBidMeeting:completed", "liveBids", "status2DpPending", "bgExpired:pwb",
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
    dashboardFilter: filter,
    page: "1",
    pageSize: "500",
  });
  if (pass.categories) params.set("fileCategories", pass.categories.join(","));
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

async function main() {
  const token = await login();
  const settingsPayload = await api("/api/settings", token);
  const settings = settingsPayload.settings ?? {};
  const currentYear = settings.financialYear || settings.selectedYear;
  const start = Number(String(currentYear).match(/\d{4}/)?.[0]);
  const previousYear = String(start - 1) + "-" + String(start % 100).padStart(2, "0");
  const categories = getCategories(settings.fileTypes);
  const passes = [
    { name: "All active", year: "__all_active_files__", categories },
    { name: "All files", year: "__all_files__", categories },
    { name: "Active + current-FY closed", year: "__active_plus_current_fy_closed__", categories },
    { name: "Specific current FY", year: currentYear, categories },
    { name: "Specific previous FY", year: previousYear, categories },
  ];
  const issues = [];
  let checked = 0;

  for (const pass of passes) {
    const visible = await api("/api/files?year=" + encodeURIComponent(pass.year), token);
    const sourceFiles = visible.files ?? [];
    for (const filter of filters) {
      const expected = fileIds(searchFiles(sourceFiles, {
        dashboardFilter: filter,
        fileCategories: pass.categories,
        sortColumnKey: "none",
      }));
      const result = await runSearch(pass, filter, token);
      const actual = fileIds(result.files);
      const missing = expected.filter((id) => !actual.includes(id));
      const extra = actual.filter((id) => !expected.includes(id));
      checked += 1;
      if (result.total !== expected.length || missing.length || extra.length) {
        issues.push({
          pass: pass.name,
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

  console.log(JSON.stringify({ checked, passes: passes.length, filters: filters.length, issues }, null, 2));
  if (issues.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
