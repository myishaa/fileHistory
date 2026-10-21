import assert from "node:assert/strict";
import test from "node:test";
import {
  isSupplyOrderMilestoneCurrent as backendCurrent,
} from "../backend/src/utils/effective-deliveries.ts";
import {
  isSupplyOrderMilestoneCurrent as frontendCurrent,
} from "../src/lib/effective-deliveries.ts";

const file = {
  fileType: "Goods & Services",
  fileTypeGroup: "Group-A",
  ir: "No",
};

function sharedStageOrder(stageDates, overrides = {}) {
  return {
    soDate: "2026-01-01",
    stageDelivery: "Yes",
    stagePayment: "No",
    stageDeliveries: stageDates.map((jobCompletionDate) => ({ jobCompletionDate })),
    billPreparationDate: "",
    soCancelled: "No",
    noFurtherAction: "No",
    ...overrides,
  };
}

test("shared Bill Preparation becomes current only after every stage completes", () => {
  const completed = sharedStageOrder(["2026-07-02", "2026-10-02"]);
  const incomplete = sharedStageOrder(["2026-07-02", ""]);

  for (const isCurrent of [frontendCurrent, backendCurrent]) {
    assert.equal(isCurrent(file, completed, "Bill preparation"), true);
    assert.equal(isCurrent(file, incomplete, "Bill preparation"), false);
  }
});

test("the shared trigger stops when the parent bill is prepared", () => {
  const completed = sharedStageOrder(["2026-07-02", "2026-10-02"]);

  for (const isCurrent of [frontendCurrent, backendCurrent]) {
    assert.equal(
      isCurrent(file, { ...completed, billPreparationDate: "2026-10-03" }, "Bill preparation"),
      false,
    );
  }
});
