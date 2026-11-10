import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { getSuspectedAnomalyRows } = await import("../backend/src/routes/dashboard.ts");

function anomalyRows(order) {
  return getSuspectedAnomalyRows(
    [
      {
        id: "warranty-bg-anomaly-test",
        division: "Trial",
        fileType: "AMC",
        fileTypeGroup: "contract",
        ir: "No",
        bg: "Yes",
        demandCancelled: "No",
        supplyOrders: [order],
      },
    ],
    { signatures: new Set(), universalRuleKeys: new Set() },
  );
}

test("missing Warranty BG coverage is reported after S.O. workflow starts", () => {
  const rows = anomalyRows({
    soNo: "SO-1",
    soDate: "2026-01-01",
    bgCoverageType: "None",
    soCancelled: "No",
  });

  const anomaly = rows.find((row) => row.block === "Bank Guarantee");
  assert.ok(anomaly);
  assert.match(anomaly.rule, /coverage type is missing or has no PWB coverage/);
});

test("legacy casing and punctuation do not create a false missing-coverage anomaly", () => {
  const rows = anomalyRows({
    soNo: "SO-1",
    soDate: "2026-01-01",
    bgCoverageType: "pwb",
    pwbBgNo: "PWB-1",
    pwbBgReceivedDate: "2026-01-05",
    jobCompletionDate: "2026-01-10",
    soCancelled: "No",
  });

  assert.equal(
    rows.some(
      (row) =>
        row.block === "Bank Guarantee" &&
        row.rule.includes("coverage type is missing or has no PWB coverage"),
    ),
    false,
  );
  assert.equal(
    rows.some(
      (row) =>
        row.block === "Warranty / BG mismatch" &&
        row.rule === "Warranty period is missing for received PWB",
    ),
    true,
  );
});

test("unrecognized BG coverage values are reported instead of treated as complete", () => {
  const rows = anomalyRows({
    soNo: "SO-1",
    soDate: "2026-01-01",
    bgCoverageType: "Unverified coverage",
    soCancelled: "No",
  });

  assert.equal(
    rows.some(
      (row) =>
        row.block === "Bank Guarantee" &&
        row.rule === "S.O. BG coverage type is not recognized",
    ),
    true,
  );
});
