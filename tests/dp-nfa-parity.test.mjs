import assert from "node:assert/strict";
import test from "node:test";
import {
  isExpiredDeliveryPeriodEntry as backendExpired,
  isExtendedDeliveryPeriodEntry as backendExtended,
  isStatus2DpExpiredDeliveryEntry as backendStatus2Expired,
  isValidDeliveryPeriodEntry as backendValid,
} from "../backend/src/utils/effective-deliveries.ts";
import {
  isExpiredDeliveryPeriodEntry as frontendExpired,
  isExtendedDeliveryPeriodEntry as frontendExtended,
  isStatus2DpExpiredDeliveryEntry as frontendStatus2Expired,
  isValidDeliveryPeriodEntry as frontendValid,
} from "../src/lib/effective-deliveries.ts";

const file = { fileType: "Goods & Services", ir: "Yes" };
const scenarios = [
  { name: "valid", order: { soDate: "2000-01-01", dpDate: "2999-01-01" }, frontend: frontendValid, backend: backendValid },
  { name: "expired", order: { soDate: "2000-01-01", dpDate: "2000-02-01" }, frontend: frontendExpired, backend: backendExpired },
  { name: "extended", order: { soDate: "2000-01-01", dpDate: "2000-02-01", revisedDp: "2999-01-01" }, frontend: frontendExtended, backend: backendExtended },
];

for (const { name, order, frontend, backend } of scenarios) {
  test(`${name} D.P. excludes only the NFA S.O. in both paths`, () => {
    const stopped = { ...order, noFurtherAction: "Yes" };
    const mixedFile = { ...file, supplyOrders: [stopped, order] };
    assert.equal(frontend(mixedFile, stopped), false);
    assert.equal(backend(mixedFile, stopped), false);
    assert.equal(frontend(mixedFile, order), true);
    assert.equal(backend(mixedFile, order), true);
  });
}

test("Status-2 expired D.P. remains aligned for NFA and active orders", () => {
  const order = scenarios[1].order;
  for (const entry of [order, { ...order, noFurtherAction: "Yes" }]) {
    assert.equal(frontendStatus2Expired(file, entry), backendStatus2Expired(file, entry));
  }
});
