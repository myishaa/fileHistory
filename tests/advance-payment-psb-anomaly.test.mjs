import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { getSuspectedAnomalyRows } = await import("../backend/src/routes/dashboard.ts");

function anomalyRows(order) {
  return getSuspectedAnomalyRows(
    [
      {
        id: "advance-payment-psb-anomaly-test",
        mode: "OBM",
        fileType: "Goods & Services",
        bg: "Yes",
        supplyOrders: [order],
      },
    ],
    { signatures: new Set(), universalRuleKeys: new Set() },
  );
}

function psbReceiptAnomaly(rows) {
  return rows.find(
    (row) =>
      row.block === "Advance Payment" &&
      row.rule === "Advance Payment details are filled but PSB BG receipt date is blank",
  );
}

test("entered advance payment details without applicable PSB receipt raise an anomaly", () => {
  const rows = anomalyRows({
    advancePayment: "Yes",
    psbApplicable: "Yes",
    bgCoverageType: "PSB",
    advancePaymentDetail: {
      stageAmountCapital: "100",
      expectedPaymentDate: "2026-11-20",
    },
  });

  const anomaly = psbReceiptAnomaly(rows);
  assert.ok(anomaly);
  assert.equal(anomaly.previousField, "Advance Payment details");
  assert.equal(anomaly.previousDate, "Filled");
  assert.equal(anomaly.laterField, "PSB BG received date");
  assert.equal(anomaly.laterDate, "Blank");
});

test("Advance Payment Yes or its current milestone alone does not raise the PSB anomaly", () => {
  const rows = anomalyRows({
    advancePayment: "Yes",
    psbApplicable: "Yes",
    bgCoverageType: "PSB",
    advancePaymentDetail: { currentMilestone: "Advance Payment" },
  });

  assert.equal(psbReceiptAnomaly(rows), undefined);
});

test("a recorded PSB receipt or non-PSB coverage does not raise the anomaly", () => {
  const withReceipt = anomalyRows({
    advancePayment: "Yes",
    psbApplicable: "Yes",
    bgCoverageType: "PSB",
    psbBgReceivedDate: "2026-11-10",
    advancePaymentDetail: { expectedPaymentDate: "2026-11-20" },
  });
  const withoutPsbCoverage = anomalyRows({
    advancePayment: "Yes",
    psbApplicable: "Yes",
    bgCoverageType: "PWB",
    advancePaymentDetail: { expectedPaymentDate: "2026-11-20" },
  });

  assert.equal(psbReceiptAnomaly(withReceipt), undefined);
  assert.equal(psbReceiptAnomaly(withoutPsbCoverage), undefined);
});
