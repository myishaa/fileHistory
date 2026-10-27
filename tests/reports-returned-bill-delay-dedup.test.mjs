import assert from "node:assert/strict";
import test from "node:test";
import { searchFiles } from "../backend/src/utils/file-search.ts";
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

test("Non-TCEC refloat tender-live delay starts after Refloat recommendation", () => {
  const dateDaysAgo = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const file = {
    id: "refloat-tender-live-after-original-opening",
    fileType: "Goods & Services",
    fileTypeGroup: "Group-A",
    demandCancelled: "No",
    completedMilestones: ["CFA"],
    cfaDate: dateDaysAgo(180),
    gem: "Yes",
    gemUndertakingDate: "",
    refloat: "Yes",
    bidOpeningDate: dateDaysAgo(20),
    refloatRecommendationDate: dateDaysAgo(15),
    refloatBiddingDate: "",
    refloatBidOpeningDate: "",
    bidOpened: "No",
    biddingStageOver: "Yes",
  };
  const summary = buildReportsSummary({
    files: [file],
    division: "all",
    delayDays: 5,
    delayMilestone: "refloatBidding",
  });

  assert.equal(summary.delayRows.length, 1);
  assert.equal(summary.delayRows[0].biddingBreakupKey, "tenderLivePending");
  assert.equal(summary.delayRows[0].stageStartDate, file.refloatRecommendationDate);
  assert.equal(summary.delayRows[0].daysInStage, 15);
});

test("TCEC Refloat tender-live delay starts at Post-TCEC minutes", () => {
  const dateDaysAgo = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const file = {
    id: "tcec-refloat-tender-live-after-post-tcec",
    fileType: "Goods & Services",
    fileTypeGroup: "Group-A",
    demandCancelled: "No",
    completedMilestones: ["CFA"],
    cfaDate: dateDaysAgo(180),
    gem: "Yes",
    gemUndertakingDate: "",
    tcec: "Yes",
    postTcecMinutesDate: dateDaysAgo(12),
    refloat: "Yes",
    bidOpeningDate: dateDaysAgo(60),
    refloatBiddingDate: "",
    refloatBidOpeningDate: "",
    bidOpened: "No",
    biddingStageOver: "No",
  };
  const summary = buildReportsSummary({
    files: [file],
    division: "all",
    delayDays: 5,
    delayMilestone: "refloatBidding",
  });

  assert.equal(summary.delayRows.length, 1);
  assert.equal(summary.delayRows[0].biddingBreakupKey, "tenderLivePending");
  assert.equal(summary.delayRows[0].stageStartDate, file.postTcecMinutesDate);
  assert.equal(summary.delayRows[0].daysInStage, 12);
  assert.deepEqual(
    searchFiles([file], { dashboardFilter: "delayStatus:5:refloatBidding" }).map(({ id }) => id),
    [file.id],
  );
  const missingPostTcecMinutes = buildReportsSummary({
    files: [{ ...file, id: "tcec-refloat-missing-post-tcec-minutes", postTcecMinutesDate: "" }],
    division: "all",
    delayDays: 5,
    delayMilestone: "refloatBidding",
  });
  assert.equal(missingPostTcecMinutes.delayRows.length, 0);
});

test("Bidding delay ignores RFP dates when RFP Vetting is not applicable", () => {
  const dateDaysAgo = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const file = {
    id: "bidding-delay-inapplicable-rfp-date",
    fileType: "Goods & Services",
    fileTypeGroup: "Group-A",
    demandCancelled: "No",
    completedMilestones: ["CFA"],
    currentMilestone: "",
    cfaDate: dateDaysAgo(40),
    gem: "No",
    gemUndertakingDate: dateDaysAgo(2),
    rfpVetting: "No",
    rfpVettingApprovalDate: dateDaysAgo(4),
    biddingStageOver: "No",
    bidDate: "",
  };
  const summary = buildReportsSummary({
    files: [file],
    division: "all",
    delayDays: 10,
    delayMilestone: "biddingNonRfp",
  });

  assert.equal(summary.delayRows.length, 1);
  assert.equal(summary.delayRows[0].biddingBreakupKey, "tenderLivePending");
  assert.equal(summary.delayRows[0].stageStartDate, file.cfaDate);
  assert.deepEqual(
    searchFiles([file], { dashboardFilter: "biddingDelay:10:tenderLivePending" }).map(({ id }) => id),
    [file.id],
  );
});

test("IR Delay Status requires an applicable IR workflow in summary and Search", () => {
  const dateDaysAgo = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const file = {
    id: "ir-delay-applicability",
    fileType: "Goods & Services",
    fileTypeGroup: "Group-A",
    ir: "No",
    demandCancelled: "No",
    completedMilestones: [],
    supplyOrders: [
      {
        soDate: dateDaysAgo(100),
        currentMilestone: "IR Preparation",
        materialReceiptDate: dateDaysAgo(60),
        irPreparationDate: "",
        irReceiptDate: "",
        soCancelled: "No",
      },
    ],
  };
  const summaryFor = (candidate) => buildReportsSummary({
    files: [candidate],
    division: "all",
    delayDays: 10,
    delayMilestone: "irPreparation",
  });

  assert.equal(summaryFor(file).delayRows.length, 0);
  assert.deepEqual(
    searchFiles([file], { dashboardFilter: "delayStatus:10:irPreparation" }),
    [],
  );

  const applicableFile = { ...file, id: "ir-delay-applicable", ir: "Yes" };
  assert.equal(summaryFor(applicableFile).delayRows.length, 1);
  assert.deepEqual(
    searchFiles([applicableFile], { dashboardFilter: "delayStatus:10:irPreparation" }).map(({ id }) => id),
    [applicableFile.id],
  );
});

test("Workflow Not Started ignores dates from disabled optional workflows", () => {
  const dateDaysAgo = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const recentDate = dateDaysAgo(2);
  const file = {
    id: "workflow-not-started-stale-optional-dates",
    fileType: "Goods & Services",
    fileTypeGroup: "Group-A",
    mode: "Open Tender",
    receivedDate: dateDaysAgo(40),
    currentMilestone: "",
    completedMilestones: [],
    demandCancelled: "No",
    highValue: "No",
    highValueMeetingDate: recentDate,
    ad: "No",
    adSentDate: recentDate,
    rqa: "No",
    rqaApprovalDate: recentDate,
    ifa: "No",
    ifaFinalDate: recentDate,
    tcec: "No",
    preTcecDate: recentDate,
    postTcecDate: recentDate,
    cncApprovalDate: recentDate,
    gem: "No",
    gemUndertakingDate: recentDate,
    rfpVetting: "No",
    rfpVettingInitiationDate: recentDate,
    rfpVettingApprovalDate: recentDate,
    preBidMeeting: "No",
    preBidMeetingDate: recentDate,
    refloat: "No",
    refloatPreBidMeeting: "No",
    refloatPreBidMeetingDate: recentDate,
    refloatBiddingDate: recentDate,
    refloatPostTcecDate: recentDate,
    supplyOrders: [{ irPreparationDate: recentDate, irReceiptDate: recentDate }],
  };
  const summaryFor = (candidate) => buildReportsSummary({
    files: [candidate],
    division: "all",
    delayDays: 10,
    delayMilestone: "workflowNotStarted",
  });

  assert.equal(summaryFor(file).delayRows.length, 1);
  assert.equal(summaryFor(file).delayRows[0].fileId, file.id);

  for (const [flag, id] of [
    ["gem", "workflow-started-applicable-gem"],
    ["rfpVetting", "workflow-started-applicable-rfp"],
    ["refloat", "workflow-started-applicable-refloat"],
  ]) {
    const applicableWorkflow = { ...file, id, [flag]: "Yes" };
    assert.equal(summaryFor(applicableWorkflow).delayRows.length, 0, `${flag}=Yes should make its recorded date workflow evidence`);
  }
});
