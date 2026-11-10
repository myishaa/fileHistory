import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const { dashboardFilterSql } = await import("../backend/src/routes/files.ts");

test("placement-dependent Status-2 links require complete orders, including F.S. and declared-row limits", () => {
  for (const filter of [
    "status2DpPending",
    "status2MaterialReceiptPending",
    "status2DpExpired",
    "manualMilestoneCurrent:PSB",
    "manualMilestoneCurrent:PWB",
    "manualMilestoneCurrent:PSB+PWB",
    "status2AdvancePaymentPending",
    "advancePending",
    "manualMilestoneCurrent:IR Preparation",
    "manualMilestoneCurrent:IR Receipt",
  ]) {
    const sql = dashboardFilterSql(filter, []);
    for (const required of [
      "financial_sanction_date",
      "so_no",
      "firm_type",
      "so_value_revenue",
      "no_of_so",
    ])
      assert.ok(sql.includes(required), `${filter} must enforce ${required}`);
  }
});

test("generic pending IR predicates exclude stopped follow-up directly on the matching order", () => {
  for (const filter of [
    "manualMilestoneCurrent:IR Preparation",
    "manualMilestoneCurrent:IR Receipt",
  ]) {
    const sql = dashboardFilterSql(filter, []);
    assert.match(sql, /and not lower\(coalesce\(so_current\.no_further_action/);
  }
});

test("common staged contract payment uses the latest effective stage D.P. only after every stage has a date", () => {
  const sql = dashboardFilterSql("manualMilestoneCurrent:Payment", []);
  assert.match(sql, /count\(\*\) = count\(stage_dates\.dp_date\) then max\(stage_dates\.dp_date\)/);
  assert.ok(sql.includes("common_dp_stage.stage ->> 'revisedDp'"));
  assert.ok(sql.includes("common_dp_stage.stage ->> 'dpDate'"));
  assert.ok(sql.includes("else coalesce(so.revised_dp, so.dp_date) end"));
});

test("PWB search follows completed stages and keeps eligibility at the parent order level", () => {
  const sql = dashboardFilterSql("manualMilestoneCurrent:PWB", []);
  assert.ok(sql.includes("pwb_stage.stage ->> 'irReceiptDate'"));
  assert.ok(sql.includes("pwb_stage.stage ->> 'actualJobCompletionDate'"));
  assert.doesNotMatch(sql, /pwb_stage\.stage ->> 'materialReceiptDate'/);
  assert.doesNotMatch(sql, /pwb_stage\.stage ->> 'jobCompletionDate'/);
  assert.match(sql, /then min\(stage_dates\.date_value\)/);
  assert.match(sql, /then max\(stage_dates\.date_value\)/);
  assert.match(sql, /count\(stage_dates\.date_value\) = count\(\*\)/);
  assert.ok(sql.includes("so.financial_sanction_date"));
});

test("stage-only LD search considers the stage value and requires eligible non-cancelled orders", () => {
  const sql = dashboardFilterSql("miscLd", []);
  assert.ok(sql.includes("ld_stage.stage ->> 'ld'"));
  assert.ok(sql.includes("so.financial_sanction_date"));
  assert.ok(sql.includes("so.so_cancelled"));
});

test("Status-4 S.O. Cleared search uses historical eligible placement", () => {
  const sql = dashboardFilterSql("status4:Supply%20Order:cleared", []);
  assert.ok(sql.includes("completed_milestones"));
  assert.ok(sql.includes("financial_sanction_date"));
  assert.ok(sql.includes("so_no"));
  assert.ok(sql.includes("no_of_so"));
  assert.ok(sql.includes("so.so_date"));
  assert.ok(sql.includes("current_date"));
  assert.doesNotMatch(sql, /so\.so_cancelled/);
});

test("PSB attribute search requires a complete, declared, non-cancelled S.O.", () => {
  const sql = dashboardFilterSql("attribute:psb:yes", []);
  for (const required of [
    "financial_sanction_date",
    "so_no",
    "so_date",
    "so_value_revenue",
    "firm_type",
    "no_of_so",
    "psb_applicable",
    "so_cancelled",
  ]) {
    assert.ok(sql.includes(required), `PSB search must enforce ${required}`);
  }
});
