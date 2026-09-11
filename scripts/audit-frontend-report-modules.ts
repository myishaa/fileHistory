import { buildDemandProcessingRows, getDemandProcessingPresets } from "../src/lib/demand-processing-analysis";
import {
  buildMmgSummaryRows,
  normalizeMmgSummaryFields,
  type MmgSummaryRow,
} from "../src/lib/mmg-summary";
import {
  filterFilesByCategory,
  getAllFileCategoryKeys,
  serializeFileCategories,
  type FileCategoryKey,
} from "../src/lib/file-categories";
import type { Division, FileRecord } from "../src/lib/files-store";

const API_BASE_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const password = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
const allActiveFilesYear = "__all_active_files__";
const allFilesYear = "__all_files__";
const activePlusCurrentFyClosedYear = "__active_plus_current_fy_closed__";
const defaultCategories = "goodsServices,amc,mpc,cars,om";
const customCategories = "fileType:CAPSI,fileType:DcPP%20(G%26S),fileType:I%26M%20(G%26S)";
const allCustomCategories =
  "fileType:CAPSI,fileType:DcPP%20(Contract),fileType:DcPP%20(G%26S),fileType:I%26M%20(Contract),fileType:I%26M%20(G%26S)";
const contractCustomCategories = "fileType:DcPP%20(Contract),fileType:I%26M%20(Contract)";

type Pass = {
  name: string;
  selectedYear: string;
  fileYear?: string;
  division?: string;
  fileCategories?: string;
  fileInitiationFrom?: string;
  fileInitiationTo?: string;
  reportScopeFromDate?: string;
  reportScopeToDate?: string;
};

type ApiSettings = {
  selectedYear: string;
  financialYear: string;
  modes?: string[];
  firmTypes?: string[];
  fileTypes?: string[];
  mmgSummaryFields?: unknown[];
  demandProcessingPresets?: unknown[];
};

function n(value: unknown) {
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

async function api<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { cookie: `recordkeeper_session=${encodeURIComponent(token)}` },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(`${path} failed ${response.status}: ${body?.error ?? "unknown error"}`);
  }
  return body as T;
}

function filesPath(year: string) {
  const params = new URLSearchParams();
  if (year) params.set("year", year);
  const query = params.toString();
  return query ? `/api/files?${query}` : "/api/files";
}

function divisionsPath(year: string) {
  const params = new URLSearchParams();
  if (year && !year.startsWith("__")) params.set("year", year);
  const query = params.toString();
  return query ? `/api/divisions?${query}` : "/api/divisions";
}

function normalizeCategories(value: string | undefined) {
  if (!value) return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as FileCategoryKey[];
}

function matchesFileYear(file: FileRecord, fileYear: string | undefined) {
  return !fileYear || fileYear === "all" || file.year === fileYear;
}

function dateInRange(date: string | undefined, fromDate: string | undefined, toDate: string | undefined) {
  if (!date) return false;
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

function matchesInitiationRange(file: FileRecord, pass: Pass) {
  if (!pass.fileInitiationFrom && !pass.fileInitiationTo) return true;
  return dateInRange(file.receivedDate, pass.fileInitiationFrom, pass.fileInitiationTo);
}

function matchesReportScopeRange(file: FileRecord, pass: Pass) {
  if (!pass.reportScopeFromDate && !pass.reportScopeToDate) return true;
  return dateInRange(file.receivedDate, pass.reportScopeFromDate, pass.reportScopeToDate);
}

function sourceFiles(files: FileRecord[], pass: Pass) {
  const division = pass.division ?? "all";
  const filtered = files
    .filter((file) => division === "all" || file.division === division)
    .filter((file) => matchesFileYear(file, pass.fileYear))
    .filter((file) => matchesInitiationRange(file, pass));
  const categories = normalizeCategories(pass.fileCategories);
  return categories ? filterFilesByCategory(filtered, categories) : filtered;
}

function mmgFiles(files: FileRecord[], pass: Pass) {
  return sourceFiles(files, pass).filter((file) => matchesReportScopeRange(file, pass));
}

function demandRows(files: FileRecord[], pass: Pass, fromFieldId: string, toFieldId: string) {
  const rows = buildDemandProcessingRows(sourceFiles(files, pass), fromFieldId, toFieldId);
  if (!pass.reportScopeFromDate && !pass.reportScopeToDate) return rows;
  return rows.filter((row) =>
    dateInRange(row.fromDate, pass.reportScopeFromDate, pass.reportScopeToDate),
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function searchFileIdsPath(pass: Pass, fileIds: string[]) {
  const params = new URLSearchParams({
    selectedYear: pass.selectedYear,
    dashboardFilter: `fileIds:${fileIds.map(encodeURIComponent).join(",")}`,
    page: "1",
    pageSize: "500",
  });
  if (pass.division && pass.division !== "all") params.set("division", pass.division);
  if (pass.fileYear && pass.fileYear !== "all") params.set("fileYear", pass.fileYear);
  if (pass.fileCategories) params.set("fileCategories", pass.fileCategories);
  if (pass.fileInitiationFrom) params.set("fileInitiationFrom", pass.fileInitiationFrom);
  if (pass.fileInitiationTo) params.set("fileInitiationTo", pass.fileInitiationTo);
  return `/api/files/search?${params.toString()}`;
}

async function expectFileIdsSearch(
  token: string,
  issues: unknown[],
  pass: Pass,
  area: string,
  label: string,
  fileIds: string[],
) {
  const ids = unique(fileIds);
  if (!ids.length) return;
  const result = await api<{ total: number; files: FileRecord[] }>(searchFileIdsPath(pass, ids), token);
  const resultIds = unique((result.files ?? []).map((file) => file.id));
  const missing = ids.filter((id) => !resultIds.includes(id));
  const extra = resultIds.filter((id) => !ids.includes(id));
  if (n(result.total) !== ids.length || missing.length || extra.length) {
    issues.push({
      pass: pass.name,
      area,
      label,
      expected: ids.length,
      searchTotal: n(result.total),
      missing: missing.slice(0, 10),
      extra: extra.slice(0, 10),
    });
  }
}

function numericRows(rows: MmgSummaryRow[]) {
  return rows.filter((row) => (row.fileIds?.length ?? 0) > 0);
}

async function main() {
  const token = await login();
  const issues: unknown[] = [];
  const passSummaries: unknown[] = [];
  try {
    const settingsPayload = await api<{ settings: ApiSettings }>("/api/settings", token);
    const settings = settingsPayload.settings;
    const currentFilesPayload = await api<{ files: FileRecord[] }>(filesPath(settings.selectedYear), token);
    const allFilesPayload = await api<{ files: FileRecord[] }>(filesPath(allFilesYear), token);
    const divisionsPayload = await api<{ divisions: Division[] }>(divisionsPath(settings.financialYear), token);
    const configuredCategories = getAllFileCategoryKeys(settings.fileTypes ?? []);
    const firstDivision = divisionsPayload.divisions.find((division) =>
      currentFilesPayload.files.some((file) => file.division === division.name),
    )?.name;
    const passes: Pass[] = [
      { name: "01 all-active no category", selectedYear: allActiveFilesYear, fileYear: "all" },
      {
        name: "02 all-active all configured categories",
        selectedYear: allActiveFilesYear,
        fileYear: "all",
        fileCategories: serializeFileCategories(configuredCategories),
      },
      {
        name: "03 all-active fixed categories",
        selectedYear: allActiveFilesYear,
        fileYear: "all",
        fileCategories: defaultCategories,
      },
      {
        name: "04 all-active custom categories",
        selectedYear: allActiveFilesYear,
        fileYear: "all",
        fileCategories: customCategories,
      },
      {
        name: "05 all-active all custom categories",
        selectedYear: allActiveFilesYear,
        fileYear: "all",
        fileCategories: allCustomCategories,
      },
      {
        name: "06 all-active contract custom categories",
        selectedYear: allActiveFilesYear,
        fileYear: "all",
        fileCategories: contractCustomCategories,
      },
      { name: "07 selected FY 2026-27", selectedYear: "2026-27", fileYear: "2026-27" },
      { name: "08 selected FY 2025-26", selectedYear: "2025-26", fileYear: "all" },
      { name: "09 entire database", selectedYear: allFilesYear, fileYear: "all" },
      {
        name: "10 active plus current closed with initiation range",
        selectedYear: activePlusCurrentFyClosedYear,
        fileYear: "all",
        fileInitiationFrom: "2026-04-01",
        fileInitiationTo: "2026-09-30",
      },
      {
        name: "11 report scope date range",
        selectedYear: allActiveFilesYear,
        fileYear: "all",
        reportScopeFromDate: "2026-04-01",
        reportScopeToDate: "2026-09-30",
      },
      ...(firstDivision
        ? [
            {
              name: `12 division ${firstDivision}`,
              selectedYear: allActiveFilesYear,
              fileYear: "all",
              division: firstDivision,
            },
          ]
        : []),
    ];
    const demandPresets = getDemandProcessingPresets(settings.demandProcessingPresets);
    for (const pass of passes) {
      const filesPayload = await api<{ files: FileRecord[] }>(filesPath(pass.selectedYear), token);
      const files = filesPayload.files;
      const filteredMmgFiles = mmgFiles(files, pass);
      const previousFilteredFiles = mmgFiles(allFilesPayload.files, pass).filter(
        (file) => file.year !== settings.financialYear,
      );
      const mmgRows = buildMmgSummaryRows({
        files: filteredMmgFiles,
        previousYearFiles: previousFilteredFiles,
        divisions:
          pass.division && pass.division !== "all"
            ? divisionsPayload.divisions.filter((division) => division.name === pass.division)
            : divisionsPayload.divisions,
        config: normalizeMmgSummaryFields(
          settings.mmgSummaryFields,
          settings.modes,
          settings.firmTypes,
          settings.fileTypes,
        ),
        financialYear: settings.financialYear,
        modes: settings.modes,
        firmTypes: settings.firmTypes,
        fileTypes: settings.fileTypes,
      });
      let mmgChecks = 0;
      for (const row of numericRows(mmgRows)) {
        mmgChecks += 1;
        await expectFileIdsSearch(token, issues, pass, "MMG Summary", row.label, row.fileIds ?? []);
      }
      let demandChecks = 0;
      for (const preset of demandPresets.slice(0, 8)) {
        const rows = demandRows(files, pass, preset.fromFieldId, preset.toFieldId);
        const usedIds = unique(rows.map((row) => row.fileId));
        const reverseIds = unique(rows.filter((row) => row.gapDays < 0).map((row) => row.fileId));
        if (usedIds.length) {
          demandChecks += 1;
          await expectFileIdsSearch(token, issues, pass, "Demand Processing", preset.name, usedIds);
        }
        if (reverseIds.length) {
          demandChecks += 1;
          await expectFileIdsSearch(
            token,
            issues,
            pass,
            "Demand Processing reverse",
            preset.name,
            reverseIds,
          );
        }
      }
      passSummaries.push({
        pass: pass.name,
        sourceFiles: sourceFiles(files, pass).length,
        mmgRowsWithFileIds: mmgChecks,
        demandChecks,
      });
    }
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
