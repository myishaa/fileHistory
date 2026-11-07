import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { getSuspectedAnomalyRows } = await import("../backend/src/routes/dashboard.ts");

test("RFP vetting chronology anomaly is exposed for the save warning", () => {
  const rows = getSuspectedAnomalyRows(
    [
      {
        id: "rfp-vetting-anomaly-test",
        mode: "OBM",
        fileType: "Goods & Services",
        rfpVetting: "Yes",
        rfpVettingInitiationDate: "2026-10-20",
        rfpVettingApprovalDate: "2026-10-10",
      },
    ],
    { signatures: new Set(), universalRuleKeys: new Set() },
  );

  const anomaly = rows.find((row) => row.block === "RFP vetting");
  assert.ok(anomaly);
  assert.equal(anomaly.previousField, "RFP vetting initiation date");
  assert.equal(anomaly.laterField, "RFP vetting approval date");
  assert.equal(anomaly.previousDate, "2026-10-20");
  assert.equal(anomaly.laterDate, "2026-10-10");
});

test("valid RFP vetting chronology does not raise an anomaly", () => {
  const rows = getSuspectedAnomalyRows(
    [
      {
        id: "rfp-vetting-valid-test",
        mode: "OBM",
        fileType: "Goods & Services",
        rfpVetting: "Yes",
        rfpVettingInitiationDate: "2026-10-10",
        rfpVettingApprovalDate: "2026-10-20",
      },
    ],
    { signatures: new Set(), universalRuleKeys: new Set() },
  );

  assert.equal(rows.some((row) => row.block === "RFP vetting"), false);
});

test("Refloat RFP vetting chronology is exposed independently", () => {
  const rows = getSuspectedAnomalyRows(
    [
      {
        id: "refloat-rfp-vetting-anomaly-test",
        mode: "OBM",
        fileType: "Goods & Services",
        refloat: "Yes",
        refloatRfpVetting: "Yes",
        refloatRfpVettingInitiationDate: "2026-10-20",
        refloatRfpVettingApprovalDate: "2026-10-10",
      },
    ],
    { signatures: new Set(), universalRuleKeys: new Set() },
  );

  const anomaly = rows.find((row) => row.block === "Refloat RFP vetting");
  assert.ok(anomaly);
  assert.equal(anomaly.previousField, "Refloat RFP vetting initiation date");
  assert.equal(anomaly.laterField, "Refloat RFP vetting approval date");
});
