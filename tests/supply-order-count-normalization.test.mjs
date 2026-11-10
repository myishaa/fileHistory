import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const { normalizeSupplyOrderCountInBody } = await import("../backend/src/routes/files.ts");

test("full-file supply-order normalization removes empty gaps and renumbers filled rows", () => {
  const normalized = normalizeSupplyOrderCountInBody({
    noOfSo: "5",
    supplyOrders: [
      { soNo: "SO-1" },
      { psbApplicable: "No", bgCoverageType: "None" },
      { soNo: "SO-3" },
      { id: "old-empty-row", includeInPaymentTiming: true },
      { soNo: "SO-5" },
    ],
  });

  assert.equal(normalized.noOfSo, "3");
  assert.deepEqual(
    normalized.supplyOrders.map((row) => row.soNo),
    ["SO-1", "SO-3", "SO-5"],
  );
});

test("all-empty declared rows remain available for later entry", () => {
  const normalized = normalizeSupplyOrderCountInBody({
    noOfSo: "5",
    supplyOrders: Array.from({ length: 5 }, () => ({
      psbApplicable: "No",
      bgCoverageType: "None",
      includeInPaymentTiming: true,
    })),
  });

  assert.equal(normalized.noOfSo, "5");
  assert.equal(normalized.supplyOrders.length, 5);
});
