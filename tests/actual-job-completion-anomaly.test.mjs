import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { getSuspectedAnomalyRows } = await import("../backend/src/routes/dashboard.ts");

const suppressions = { signatures: new Set(), universalRuleKeys: new Set() };

function anomalyRows(order) {
  return getSuspectedAnomalyRows(
    [
      {
        id: "actual-completion-missing-test",
        fileType: "Goods & Services",
        ir: "No",
        demandCancelled: "No",
        supplyOrders: [{ soNo: "SO-TEST", soDate: "2026-07-01", ...order }],
      },
    ],
    suppressions,
  );
}

test("received completion without actual completion raises an S.O.-level anomaly", () => {
  const rows = anomalyRows({ jobCompletionDate: "2026-08-15", actualJobCompletionDate: "" });
  const anomaly = rows.find((row) => row.rule.includes("Actual Job Completion Date is missing"));

  assert.ok(anomaly);
  assert.equal(anomaly.block, "Job Completion");
  assert.equal(anomaly.previousField, "Actual Job Completion Date");
  assert.equal(anomaly.laterField, "Job Completion Received Date");
  assert.equal(anomaly.laterDate, "2026-08-15");
});

test("received completion without actual completion raises a stage-level anomaly", () => {
  const rows = anomalyRows({
    stageDelivery: "Yes",
    stageDeliveryCount: "1",
    stageDeliveries: [
      { jobCompletionDate: "2026-08-15", actualJobCompletionDate: "" },
    ],
  });
  const anomaly = rows.find((row) => row.rule.includes("Stage 1 Job Completion Received Date"));

  assert.ok(anomaly);
  assert.equal(anomaly.block, "Stage Delivery");
  assert.equal(anomaly.previousField, "Stage Actual Job Completion Date");
  assert.equal(anomaly.laterField, "Stage Job Completion Received Date");
  assert.equal(anomaly.laterDate, "2026-08-15");
});

test("actual completion present does not raise the missing-date anomaly", () => {
  const rows = anomalyRows({
    jobCompletionDate: "2026-08-15",
    actualJobCompletionDate: "2026-08-14",
  });

  assert.equal(rows.some((row) => row.rule.includes("Actual Job Completion Date is missing")), false);
});
