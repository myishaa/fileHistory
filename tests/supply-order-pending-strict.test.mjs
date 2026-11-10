import assert from "node:assert/strict";
import test from "node:test";
import {
  isSupplyOrderAtPreviousStage as backendPreviousStage,
  isSupplyOrderMilestoneCurrent as backendCurrent,
} from "../backend/src/utils/effective-deliveries.ts";
import {
  isSupplyOrderAtPreviousStage as frontendPreviousStage,
  isSupplyOrderMilestoneCurrent as frontendCurrent,
} from "../src/lib/effective-deliveries.ts";
import { isMmgSupplyOrderPendingOrder } from "../src/lib/mmg-summary.ts";

const file = {
  fileType: "Goods & Services",
  fileTypeGroup: "goodsServices",
  gem: "No",
};

function order(overrides = {}) {
  return {
    currentMilestone: "Supply Order",
    financialSanctionDate: "2026-10-01",
    soDate: "",
    completedMilestones: [],
    ...overrides,
  };
}

test("Supply Order pending requires the exact current milestone and incomplete S.O.", () => {
  for (const isCurrent of [frontendCurrent, backendCurrent]) {
    assert.equal(isCurrent(file, order(), "Supply Order"), true);
    assert.equal(
      isCurrent(file, order({ currentMilestone: "Financial Sanction" }), "Supply Order"),
      false,
    );
    assert.equal(
      isCurrent(file, order({ financialSanctionDate: "" }), "Supply Order"),
      false,
    );
    assert.equal(
      isCurrent(file, order({ soDate: "2026-10-02" }), "Supply Order"),
      false,
    );
    assert.equal(
      isCurrent(
        file,
        order({ completedMilestones: ["Supply Order"] }),
        "Supply Order",
      ),
      false,
    );
  }
});

test("Supply Order At previous stage requires Financial Sanction as the exact predecessor", () => {
  for (const isPreviousStage of [frontendPreviousStage, backendPreviousStage]) {
    assert.equal(
      isPreviousStage(file, {
        currentMilestone: "Financial Sanction",
        financialSanctionDate: "",
        soDate: "",
        completedMilestones: [],
      }),
      true,
    );
    assert.equal(
      isPreviousStage(file, {
        currentMilestone: "Supply Order",
        financialSanctionDate: "",
        soDate: "",
        completedMilestones: [],
      }),
      false,
    );
    assert.equal(
      isPreviousStage(file, {
        currentMilestone: "Financial Sanction",
        financialSanctionDate: "2026-10-01",
        soDate: "",
        completedMilestones: [],
      }),
      false,
    );
    assert.equal(
      isPreviousStage(file, {
        currentMilestone: "Financial Sanction",
        financialSanctionDate: "",
        soDate: "2026-10-02",
        completedMilestones: [],
      }),
      false,
    );
  }
});

test("MMG Supply Order pending requires the exact current milestone", () => {
  assert.equal(isMmgSupplyOrderPendingOrder(file, order()), true);
  assert.equal(
    isMmgSupplyOrderPendingOrder(file, order({ currentMilestone: "Financial Sanction" })),
    false,
  );
  assert.equal(
    isMmgSupplyOrderPendingOrder(file, order({ currentMilestone: "Delivery" })),
    false,
  );
  assert.equal(
    isMmgSupplyOrderPendingOrder(file, order({ noFurtherAction: "Yes" })),
    false,
  );
});
