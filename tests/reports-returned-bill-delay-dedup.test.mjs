import assert from "node:assert/strict";
import test from "node:test";
import { buildReportsSummary } from "../backend/src/utils/report-summary.ts";

test("Delay Status emits one row per open returned-bill S.O. case", () => {
  const returnedOrders = Array.from({ length: 8 }, (_, index) => ({
    soDate: "2026-01-01",
    soCancelled: "No",
    noFurtherAction: "No",
    currentMilestone: "Bill returned for correction",
    billPreparationDate: "2026-02-01",
    billSentForPaymentDate: "2026-02-02",
    billReturnCycles: [
      {
        returnedDate: `2026-09-${String(index + 1).padStart(2, "0")}`,
        reason: "Correction required",
      },
    ],
  }));
  const summary = buildReportsSummary({
    files: [
      {
        id: "returned-bill-delay-dedup",
        fileType: "AMC",
        fileTypeGroup: "Group-B",
        ir: "No",
        demandCancelled: "No",
        completedMilestones: [],
        supplyOrders: returnedOrders,
      },
    ],
    division: "all",
    delayDays: 5,
    delayMilestone: "billReturnedForCorrection",
  });

  const returnedRows = summary.delayRows.filter(
    (row) => row.milestoneKey === "billReturnedForCorrection",
  );
  assert.equal(returnedRows.length, 8);
  assert.equal(new Set(returnedRows.map((row) => row.focusTarget)).size, 8);
  assert.equal(
    summary.delaySummary.averageDays,
    Math.round(returnedRows.reduce((total, row) => total + row.daysInStage, 0) / 8),
  );
});

test("Delay Status keeps refloat delays in their own bin and ages from refloat dates", () => {
  const dateDaysAgo = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const file = {
    id: "refloat-bidding-delay",
    fileType: "Goods & Services",
    fileTypeGroup: "Group-A",
    demandCancelled: "No",
    completedMilestones: ["CFA"],
    currentMilestone: "",
    cfaDate: dateDaysAgo(120),
    refloat: "Yes",
    tcec: "Yes",
    biddingStageOver: "No",
    bidOpened: "Yes",
    refloatBiddingDate: dateDaysAgo(60),
    refloatBidOpeningDate: dateDaysAgo(30),
  };
  const summaryFor = (delayMilestone) => buildReportsSummary({
    files: [file],
    division: "all",
    delayDays: 5,
    delayMilestone,
  });

  const ordinaryBidding = summaryFor("bidding").delayRows;
  const refloatBidding = summaryFor("refloatBidding").delayRows;
  const allBins = summaryFor("all").delayRows;
  assert.equal(ordinaryBidding.length, 0);
  assert.equal(refloatBidding.length, 1);
  assert.equal(refloatBidding[0].milestoneKey, "refloatBidding");
  assert.equal(refloatBidding[0].stageStartDate, file.refloatBidOpeningDate);
  assert.equal(allBins.length, 1);

  const recentRefloat = {
    ...file,
    id: "recent-refloat-bidding-delay",
    refloatBidOpeningDate: dateDaysAgo(2),
  };
  const recentSummary = buildReportsSummary({
    files: [recentRefloat],
    division: "all",
    delayDays: 5,
    delayMilestone: "refloatBidding",
  });
  assert.equal(recentSummary.delayRows.length, 0);
});
