import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const { appendSearchGlobalYearScope } = await import("../backend/src/routes/files.ts");

const analyticsDrilldowns = [
  { analyticsType: "firm", analyticsNames: ["Supplier"] },
  { dashboardFilter: "firmAnalysis:expr:role:Supplier" },
  { dashboardFilter: "analyticsIndentorFirm:Buyer:name%3Asupplier" },
  { dashboardFilter: "analyticsCoBidding:Supplier:name%3APartner%7Ccity%3ACity" },
];

test("Analytics firm drill-downs preserve the selected global scope", () => {
  for (const params of analyticsDrilldowns) {
    const active = [];
    appendSearchGlobalYearScope(active, [], "__all_active_files__", "2026-27", params);
    assert.equal(active.length, 2);
    assert.match(active[0], /financial_years archived_search_year/);
    assert.match(active[1], /fileclosed/);

    const activePlus = [];
    appendSearchGlobalYearScope(
      activePlus,
      [],
      "__active_plus_current_fy_closed__",
      "2026-27",
      params,
    );
    assert.equal(activePlus.length, 2);
    assert.match(activePlus[0], /financial_years archived_search_year/);
    assert.match(activePlus[1], /file_closure_date between/);

    const selectedFy = [];
    appendSearchGlobalYearScope(selectedFy, [], "2026-27", "2026-27", params);
    assert.equal(selectedFy.length, 2);
    assert.match(selectedFy[0], /financial_years archived_search_year/);
    assert.match(selectedFy[1], /f\.year/);
  }
});

test("Archive filtering is explicit, and ordinary firm searches retain the searchable scope", () => {
  const allFiles = [];
  appendSearchGlobalYearScope(allFiles, [], "__all_files__", "2026-27", {
    ...analyticsDrilldowns[0],
    includeArchivedYears: true,
  });
  assert.deepEqual(allFiles, []);

  const archivedExcluded = [];
  appendSearchGlobalYearScope(
    archivedExcluded,
    [],
    "__all_files__",
    "2026-27",
    analyticsDrilldowns[0],
  );
  assert.equal(archivedExcluded.length, 1);
  assert.match(archivedExcluded[0], /financial_years archived_search_year/);

  const ordinaryFirmSearch = [];
  appendSearchGlobalYearScope(ordinaryFirmSearch, [], "__all_active_files__", "2026-27", {
    firm: "Supplier",
  });
  assert.equal(ordinaryFirmSearch.length, 1);
  assert.match(ordinaryFirmSearch[0], /financial_years archived_search_year/);
});
