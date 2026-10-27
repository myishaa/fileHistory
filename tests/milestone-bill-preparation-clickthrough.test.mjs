import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const { appendSearchGlobalYearScope, dashboardFilterSql } = await import(
  "../backend/src/routes/files.ts"
);

test("carry-forward Search honors Active, All Files, and selected-FY global scope", () => {
  const carryForwardParams = {
    dashboardFilter: "financeCarryForward:clearedCarryForward:2026-27:2025-26",
  };
  const activeConditions = [];
  appendSearchGlobalYearScope(
    activeConditions,
    [],
    "__all_active_files__",
    "2026-27",
    carryForwardParams,
  );
  assert.equal(activeConditions.length, 2);
  assert.match(activeConditions[0], /financial_years archived_search_year/);
  assert.match(activeConditions[1], /fileclosed/);

  const allFilesConditions = [];
  appendSearchGlobalYearScope(
    allFilesConditions,
    [],
    "__all_files__",
    "2026-27",
    { ...carryForwardParams, includeArchivedYears: true },
  );
  assert.deepEqual(allFilesConditions, []);

  const archivedExcludedConditions = [];
  appendSearchGlobalYearScope(
    archivedExcludedConditions,
    [],
    "__all_files__",
    "2026-27",
    carryForwardParams,
  );
  assert.equal(archivedExcludedConditions.length, 1);
  assert.match(archivedExcludedConditions[0], /financial_years archived_search_year/);

  const selectedFyConditions = [];
  appendSearchGlobalYearScope(
    selectedFyConditions,
    [],
    "2026-27",
    "2026-27",
    carryForwardParams,
  );
  assert.equal(selectedFyConditions.length, 2);
  assert.match(selectedFyConditions[0], /financial_years archived_search_year/);
  assert.match(selectedFyConditions[1], /f\.year/);
});

test("Bill preparation Search requires the ranking's valid start-to-completion interval", () => {
  const sql = dashboardFilterSql("analyticsMilestoneClearing:billPreparation", []);

  assert.match(sql, /not lower\(coalesce\(f\.demand_cancelled/);
  assert.match(sql, /not lower\(coalesce\(so\.so_cancelled/);
  assert.match(sql, /bill_preparation_dates\.end_date is not null/);
  assert.match(sql, /bill_preparation_dates\.start_date is not null/);
  assert.match(sql, /bill_preparation_dates\.end_date >= bill_preparation_dates\.start_date/);
  assert.match(sql, /so\.bill_preparation_date/);
  assert.match(sql, /so\.ir_receipt_date/);
  assert.match(sql, /payment_stage\.stage ->> 'irReceiptDate'/);
});

test("Bill preparation Search preserves common-payment staged start-date rules", () => {
  const sql = dashboardFilterSql("analyticsMilestoneClearing:billPreparation", []);

  assert.match(sql, /delivery_stage\.stage ->> 'materialReceiptDate'/);
  assert.match(sql, /delivery_stage\.stage ->> 'jobCompletionDate'/);
  assert.match(sql, /delivery_stage\.stage ->> 'irReceiptDate'/);
  assert.match(sql, /delivery_stage\.stage ->> 'revisedDp'/);
  assert.match(sql, /payment_stage\.stage ->> 'billPreparationDate'/);
  assert.match(sql, /so\.dp_date/);
  assert.match(sql, /so\.job_completion_date/);
});

test("Bill preparation Search keeps workflow-specific date bases and contract D.P. offset", () => {
  const sql = dashboardFilterSql("analyticsMilestoneClearing:billPreparation", []);

  assert.match(sql, /f\.ir/);
  assert.match(sql, /so\.shortclosure/);
  assert.match(sql, /so\.revised_dp/);
  assert.match(sql, /so\.dp_date/);
  assert.match(sql, /\+ 1/);
});
