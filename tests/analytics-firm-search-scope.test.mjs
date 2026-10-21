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
    assert.equal(active.length, 1);
    assert.match(active[0], /fileclosed/);

    const activePlus = [];
    appendSearchGlobalYearScope(
      activePlus,
      [],
      "__active_plus_current_fy_closed__",
      "2026-27",
      params,
    );
    assert.equal(activePlus.length, 1);
    assert.match(activePlus[0], /file_closure_date between/);

    const selectedFy = [];
    appendSearchGlobalYearScope(selectedFy, [], "2026-27", "2026-27", params);
    assert.equal(selectedFy.length, 1);
    assert.match(selectedFy[0], /f\.year/);
  }
});

test("All Files remains unrestricted, and ordinary firm searches keep their established behavior", () => {
  const allFiles = [];
  appendSearchGlobalYearScope(allFiles, [], "__all_files__", "2026-27", analyticsDrilldowns[0]);
  assert.deepEqual(allFiles, []);

  const ordinaryFirmSearch = [];
  appendSearchGlobalYearScope(ordinaryFirmSearch, [], "__all_active_files__", "2026-27", {
    firm: "Supplier",
  });
  assert.deepEqual(ordinaryFirmSearch, []);
});
