import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const { dashboardFilterSql } = await import("../backend/src/routes/files.ts");

test("backend Demand Processing SQL supports order-to-unified-payment comparisons", () => {
  const sql = dashboardFilterSql(
    "demandProcessing:order.materialReceiptDate:payment.unifiedPaymentDate:used",
    [],
  );

  assert.notEqual(sql, "false");
  assert.match(sql, /so\.material_receipt_date/);
  assert.match(sql, /payment_dates\.payment_date/);
  assert.match(sql, /jsonb_array_elements\(coalesce\(so\.stage_deliveries/);
  assert.match(sql, /so\.advance_payment_detail/);
  assert.match(sql, /jsonb_array_elements\(coalesce\(so\.supplementary_bills/);
});

test("backend Demand Processing SQL supports unified-payment date pairs and reverse mode", () => {
  const sql = dashboardFilterSql(
    "demandProcessing:payment.unifiedSubmissionDate:payment.unifiedPaymentDate:reverse",
    [],
  );

  assert.notEqual(sql, "false");
  assert.match(sql, /payment_event\.unified_submission_date/);
  assert.match(sql, /payment_dates\.payment_date/);
  assert.match(sql, /payment_event\.unified_submission_date/);
  assert.match(sql, /payment_dates\.payment_date < payment_event\.unified_submission_date/);
});

