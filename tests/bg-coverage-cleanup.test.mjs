import assert from "node:assert/strict";
import test from "node:test";
import {
  clearInapplicableBgCoverageFields,
  getClearedBgCoverageFieldLabels,
} from "../src/lib/bg-coverage-cleanup.ts";

test("PSB coverage clears hidden PWB, combined, and warranty data", () => {
  const order = clearInapplicableBgCoverageFields({
    bgCoverageType: "PSB",
    psbApplicable: "Yes",
    psbBgNo: "PSB-1",
    pwbBgNo: "PWB-1",
    warrantyPeriodDate: "2027-06-30",
    combinedBgNo: "COMBINED-1",
  });

  assert.equal(order.psbBgNo, "PSB-1");
  assert.equal(order.pwbBgNo, "");
  assert.equal(order.warrantyPeriodDate, "");
  assert.equal(order.combinedBgNo, "");
});

test("PWB coverage retains its instrument and warranty while clearing hidden PSB and combined data", () => {
  const order = clearInapplicableBgCoverageFields({
    bgCoverageType: "PWB",
    psbApplicable: "Yes",
    psbBgNo: "PSB-1",
    pwbBgNo: "PWB-1",
    warrantyPeriodDate: "2027-06-30",
    combinedBgNo: "COMBINED-1",
  });

  assert.equal(order.psbBgNo, "");
  assert.equal(order.pwbBgNo, "PWB-1");
  assert.equal(order.warrantyPeriodDate, "2027-06-30");
  assert.equal(order.combinedBgNo, "");
});

test("separate coverage retains standalone PSB/PWB instruments but clears combined data", () => {
  const order = clearInapplicableBgCoverageFields({
    bgCoverageType: "PSB and PWB separately",
    psbApplicable: "Yes",
    psbBgNo: "PSB-1",
    pwbBgNo: "PWB-1",
    warrantyPeriodDate: "2027-06-30",
    combinedBgNo: "COMBINED-1",
  });

  assert.equal(order.psbBgNo, "PSB-1");
  assert.equal(order.pwbBgNo, "PWB-1");
  assert.equal(order.warrantyPeriodDate, "2027-06-30");
  assert.equal(order.combinedBgNo, "");
});

test("no coverage clears every instrument and dependent warranty field", () => {
  const order = clearInapplicableBgCoverageFields({
    bgCoverageType: "None",
    psbApplicable: "Yes",
    psbBgNo: "PSB-1",
    pwbBgNo: "PWB-1",
    combinedBgNo: "COMBINED-1",
    warrantyPeriodDate: "2027-06-30",
  });

  assert.deepEqual(
    [order.psbBgNo, order.pwbBgNo, order.combinedBgNo, order.warrantyPeriodDate],
    ["", "", "", ""],
  );
});

test("cleanup labels identify only populated fields that will be removed", () => {
  const before = {
    bgCoverageType: "PSB",
    psbApplicable: "Yes",
    psbBgNo: "PSB-1",
    pwbBgNo: "PWB-1",
    warrantyPeriodDate: "2027-06-30",
  };
  const after = clearInapplicableBgCoverageFields(before);

  assert.deepEqual(getClearedBgCoverageFieldLabels(before, after), [
    "PWB BG number",
    "Warranty period date",
  ]);
});
