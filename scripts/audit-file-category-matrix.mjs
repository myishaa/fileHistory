const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";

const categories = [
  { name: "omitted", value: undefined, expected: 27 },
  {
    name: "all configured",
    value:
      "goodsServices,amc,mpc,cars,om,fileType:CAPSI,fileType:DcPP%20(Contract),fileType:DcPP%20(G%26S),fileType:I%26M%20(Contract),fileType:I%26M%20(G%26S)",
    expected: 27,
  },
  { name: "fixed built-in", value: "goodsServices,amc,mpc,cars,om", expected: 19 },
  {
    name: "all custom",
    value:
      "fileType:CAPSI,fileType:DcPP%20(Contract),fileType:DcPP%20(G%26S),fileType:I%26M%20(Contract),fileType:I%26M%20(G%26S)",
    expected: 8,
  },
  {
    name: "custom goods/services sample",
    value: "fileType:CAPSI,fileType:DcPP%20(G%26S),fileType:I%26M%20(G%26S)",
    expected: 6,
  },
  {
    name: "contract custom only",
    value: "fileType:DcPP%20(Contract),fileType:I%26M%20(Contract)",
    expected: 2,
  },
  { name: "none selected", value: "__none__", expected: 0 },
];

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

function addCategory(params, value) {
  if (value !== undefined) params.set("fileCategories", value);
}

async function countsFor(token, value) {
  const searchParams = new URLSearchParams({
    dashboardFilter: "totalFiles",
    page: "1",
    pageSize: "500",
    selectedYear: "__all_active_files__",
  });
  addCategory(searchParams, value);
  const dashboardParams = new URLSearchParams({
    version: "5",
    selectedYear: "__all_active_files__",
    division: "all",
  });
  addCategory(dashboardParams, value);
  const reportParams = new URLSearchParams({
    selectedYear: "__all_active_files__",
    fileYear: "all",
    division: "all",
    delayDays: "5",
    delayMilestone: "all",
    expectedCashOutgoDays: "10",
    cashOutgoMonth: "2026-09",
    warrantyBgBufferDays: "60",
  });
  addCategory(reportParams, value);

  const [search, dashboard, reports] = await Promise.all([
    api(`/api/files/search?${searchParams.toString()}`, token),
    api(`/api/dashboard/summary?${dashboardParams.toString()}`, token),
    api(`/api/reports/summary?${reportParams.toString()}`, token),
  ]);
  return {
    search: Number(search.total ?? 0),
    dashboard: Number(dashboard.summary?.dashboardFileCount ?? 0),
    reports: Number(reports.summary?.reportFileCount ?? 0),
  };
}

async function main() {
  const token = await login();
  const rows = [];
  const issues = [];
  try {
    for (const item of categories) {
      const counts = await countsFor(token, item.value);
      rows.push({ category: item.name, expected: item.expected, ...counts });
      for (const [surface, count] of Object.entries(counts)) {
        if (count !== item.expected) {
          issues.push({ category: item.name, surface, expected: item.expected, actual: count });
        }
      }
      if (new Set(Object.values(counts)).size !== 1) {
        issues.push({ category: item.name, issue: "surface mismatch", counts });
      }
    }
  } finally {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` },
    }).catch(() => undefined);
  }
  console.log(JSON.stringify({ rows, issues }, null, 2));
  if (issues.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
