import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveSupplyOrderEntries,
  isStatus2DpExpiredDeliveryEntry,
} from "../backend/src/utils/effective-deliveries.ts";
import { searchFiles } from "../backend/src/utils/file-search.ts";

const baseOrder = { soDate: "2000-01-01", dpDate: "2000-02-01" };
const baseFile = { ir: "Yes", fileType: "Goods", supplyOrders: [baseOrder] };

function expiredCases(file) {
  return effectiveSupplyOrderEntries([file]).filter(({ file: entryFile, order }) =>
    isStatus2DpExpiredDeliveryEntry(entryFile, order),
  ).length;
}

test("Status-2 expired D.P. counts unfinished physical-delivery cases", () => {
  assert.equal(expiredCases(baseFile), 1);
  assert.equal(expiredCases({ ...baseFile, ir: "No" }), 1);
  assert.equal(expiredCases({ ...baseFile, ir: "" }), 0);
  assert.equal(expiredCases({ ...baseFile, demandCancelled: "Yes" }), 0);
  assert.equal(expiredCases({ ...baseFile, supplyOrders: [{ ...baseOrder, soCancelled: "Yes" }] }), 0);
  assert.equal(
    expiredCases({ ...baseFile, supplyOrders: [{ ...baseOrder, noFurtherAction: "Yes" }] }),
    0,
  );
  assert.equal(
    expiredCases({ ...baseFile, supplyOrders: [{ ...baseOrder, materialReceiptDate: "2000-02-02" }] }),
    0,
  );
  assert.equal(
    expiredCases({ ...baseFile, supplyOrders: [{ ...baseOrder, completedMilestones: ["Delivery"] }] }),
    0,
  );
  assert.equal(
    expiredCases({ ...baseFile, supplyOrders: [{ ...baseOrder, revisedDp: "2999-02-01" }] }),
    0,
  );
});

test("Goods & Services with IR=No stays expired until Job Completion", () => {
  const file = { ...baseFile, fileType: "Goods & Services", ir: "No" };
  assert.equal(expiredCases(file), 1);
  assert.equal(expiredCases({ ...file, supplyOrders: [{ ...baseOrder, jobCompletionDate: "2000-02-02" }] }), 0);
  assert.equal(expiredCases({ ...file, supplyOrders: [{ ...baseOrder, completedMilestones: ["Job Completion"] }] }), 0);
  assert.equal(expiredCases({ ...file, supplyOrders: [{ ...baseOrder, noFurtherAction: "Yes" }] }), 0);
  assert.equal(expiredCases({ ...file, fileType: "AMC" }), 0);
});

test("mixed S.O. files retain their unfinished active order", () => {
  assert.equal(expiredCases({
    ...baseFile,
    supplyOrders: [{ ...baseOrder, soCancelled: "Yes" }, baseOrder],
  }), 1);
});

test("Search defaults exclude fully cancelled files but retain mixed S.O. files", () => {
  const files = [
    { ...baseFile, id: "active", supplyOrders: [baseOrder] },
    { ...baseFile, id: "mixed", supplyOrders: [{ ...baseOrder, soCancelled: "Yes" }, baseOrder] },
    { ...baseFile, id: "cancelled", supplyOrders: [{ ...baseOrder, soCancelled: "Yes" }] },
    { ...baseFile, id: "demand-cancelled", demandCancelled: "Yes" },
  ];
  const params = {
    selectedYear: "__all_files__",
    soCancelledPresenceFilter: "exclude",
    excludeDashboardFilters: ["miscDemandCancelled"],
  };
  assert.deepEqual(searchFiles(files, params).map((file) => file.id), ["active", "mixed"]);
  assert.deepEqual(searchFiles(files, { ...params, soCancelledPresenceFilter: "include", excludeDashboardFilters: [] })
    .map((file) => file.id), ["mixed", "cancelled"]);
});

test("each undelivered expired stage is a case, even with one S.O.", () => {
  const stagedOrder = {
    ...baseOrder,
    stageDelivery: "Yes",
    stageDeliveries: [
      { dpDate: "2000-02-01" },
      { dpDate: "2000-03-01", materialReceiptDate: "2000-03-02" },
      { dpDate: "2999-04-01" },
    ],
  };
  assert.equal(expiredCases({ ...baseFile, supplyOrders: [stagedOrder] }), 1);
});
