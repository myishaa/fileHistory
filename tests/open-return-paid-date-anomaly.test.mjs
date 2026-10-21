import assert from "node:assert/strict";
import test from "node:test";
import { openReturnPaidDateFile } from "./fixtures/open-return-paid-date.fixture.mjs";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { getSuspectedAnomalyRows } = await import("../backend/src/routes/dashboard.ts");
const { buildReportsSummary } = await import("../backend/src/utils/report-summary.ts");

test("open-return paid-date QA record is excluded from returned-paid and exposed as an anomaly", () => {
  const files = [openReturnPaidDateFile];
  const summary = buildReportsSummary({
    files,
    division: "all",
    delayDays: 30,
    delayMilestone: "all",
    cashOutgoPaymentCutoffDate: "2026-10-20",
  });
  const anomalies = getSuspectedAnomalyRows(files, {
    signatures: new Set(),
    universalRuleKeys: new Set(),
  });

  assert.deepEqual(summary.returnedBillPaidRows, []);
  assert.ok(
    anomalies.some(
      (row) => row.rule === "Payment date exists while returned bill has not been resubmitted",
    ),
    `expected the returned-bill anomaly, got: ${anomalies.map((row) => row.rule).join("; ")}`,
  );
});
