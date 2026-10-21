import assert from "node:assert/strict";
import test from "node:test";
import { getFirmPerformanceCohortOrder } from "../src/lib/firm-performance.ts";
import { isPlacedSupplyOrderMissingFirmName } from "../backend/src/utils/supply-order-anomalies.ts";

test("Firm Performance keeps an otherwise complete S.O. with no supplier name", () => {
  const order = { soNo: "SO-1", firmUniqueNo: "SUP-1" };
  const cohortOrder = getFirmPerformanceCohortOrder(order);

  assert.equal(cohortOrder.firm, "Unidentified supplier");
  assert.equal(cohortOrder.firmUniqueNo, "SUP-1");
  assert.equal(order.firm, undefined);
});

test("a placed S.O. without a firm name is anomalous regardless of optional Unique No.", () => {
  assert.equal(isPlacedSupplyOrderMissingFirmName("2026-06-10", ""), true);
  assert.equal(isPlacedSupplyOrderMissingFirmName("2026-06-10", undefined), true);
});

test("missing optional Firm Unique No. alone is not anomalous", () => {
  assert.equal(isPlacedSupplyOrderMissingFirmName("2026-06-10", "Northstar Systems"), false);
});

test("an unplaced S.O. without firm name does not trigger this anomaly", () => {
  assert.equal(isPlacedSupplyOrderMissingFirmName(undefined, ""), false);
});
