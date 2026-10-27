import assert from "node:assert/strict";
import test from "node:test";
import { searchFiles } from "../backend/src/utils/file-search.ts";
import { buildReportsSummary } from "../backend/src/utils/report-summary.ts";

process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const { dashboardFilterSql } = await import("../backend/src/routes/files.ts");

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function financialSanctionRows(file) {
  return buildReportsSummary({
    files: [
      {
        id: file.id,
        demandCancelled: "No",
        completedMilestones: [],
        noOfSo: "1",
        ...file,
      },
    ],
    division: "all",
    delayDays: 5,
    delayMilestone: "financialSanction",
  }).delayRows.filter((row) => row.milestoneKey === "financialSanction");
}

function supplyOrderDelayRows(file) {
  return buildReportsSummary({
    files: [
      {
        id: file.id,
        demandCancelled: "No",
        completedMilestones: [],
        noOfSo: "1",
        ...file,
      },
    ],
    division: "all",
    delayDays: 5,
    delayMilestone: "supplyOrder",
  }).delayRows.filter((row) => row.milestoneKey === "supplyOrder");
}

function nonTcecTechnicalEvaluationRows(file, delayMilestone = "nonTcecTechnicalEvaluation") {
  return buildReportsSummary({
    files: [
      {
        id: file.id,
        demandCancelled: "No",
        completedMilestones: [],
        ...file,
      },
    ],
    division: "all",
    delayDays: 5,
    delayMilestone,
  });
}

test("Reports summary honors section selection", () => {
  const summary = buildReportsSummary({
    files: [{ id: "section-selection-file", demandCancelled: "No", completedMilestones: [] }],
    division: "all",
    delayDays: 5,
    delayMilestone: "all",
    sections: ["delay"],
  });

  assert.deepEqual(summary.statusSummaryGroups, []);
  assert.deepEqual(summary.expectedCashOutgoDpRows, []);
  assert.deepEqual(summary.monthlyFileInflow, []);
  assert.deepEqual(summary.bgReceiptDelayRows, []);
  assert.ok(Array.isArray(summary.delayMilestoneOptions));
});

test("Non-TCEC Technical Evaluation Delay starts after Bidding Stage Over and reports one file-level row from Bid Opening", () => {
  const bidOpeningDate = daysAgo(12);
  const file = {
    id: "non-tcec-te-delay-two-orders",
    fileType: "Goods & Services",
    tcec: "No",
    biddingStageOver: "Yes",
    bidOpeningDate,
    supplyOrders: [
      { soNo: "SO-1", soCancelled: "No", financialSanctionDate: "" },
      { soNo: "SO-2", soCancelled: "No", financialSanctionDate: "" },
      { soNo: "SO-3", soCancelled: "No", financialSanctionDate: "" },
      { soNo: "SO-4", soCancelled: "Yes", financialSanctionDate: "" },
    ],
  };

  const summary = nonTcecTechnicalEvaluationRows(file);
  const rows = summary.delayRows.filter((row) => row.milestoneKey === "nonTcecTechnicalEvaluation");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].stageStartDate, bidOpeningDate);
  assert.equal(rows[0].focusTarget, "financialSanction");
  assert.deepEqual(
    summary.delaySummary.byMilestone.find((row) => row.key === "nonTcecTechnicalEvaluation"),
    { key: "nonTcecTechnicalEvaluation", label: "Non-TCEC Technical Evaluation", count: 1, fileCount: 1 },
  );
  assert.deepEqual(
    searchFiles([file], {
      dashboardFilter: "delayStatus:5:nonTcecTechnicalEvaluation",
    }).map((item) => item.id),
    [file.id],
  );
});

test("Bidding Delay SQL splits RFP scope and keeps normal delay anchored to CFA", () => {
  const nonRfpSql = dashboardFilterSql("delayStatus:10:biddingNonRfp", []);
  const rfpSql = dashboardFilterSql("delayStatus:10:biddingRfp", []);
  const allSql = dashboardFilterSql("delayStatus:10:all", []);

  assert.match(nonRfpSql, /not lower\(coalesce\(f\.rfp_vetting, ''\)\) in \('yes', 'y'\)/);
  assert.match(rfpSql, /lower\(coalesce\(f\.rfp_vetting, ''\)\) in \('yes', 'y'\)/);
  assert.doesNotMatch(
    rfpSql,
    /greatest\(\s*f\.cfa_date,\s*coalesce\([^)]*gem_undertaking_date/s,
  );
  assert.match(nonRfpSql, /and not coalesce\(f\.bid_date::text, ''\) <> ''/);
  assert.match(rfpSql, /and not coalesce\(f\.bid_date::text, ''\) <> ''/);
  assert.doesNotMatch(rfpSql, /rfp_vetting_(?:initiation|approval)_date/);
  assert.match(allSql, /lower\(coalesce\(f\.refloat, ''\)\) in \('yes', 'y'\)/);
});

test("TCEC refloat GeM undertaking delay uses Post-TCEC approval and the refloat field", () => {
  const file = {
    id: "tcec-refloat-gem-undertaking",
    fileType: "Goods & Services",
    fileTypeGroup: "Group-A",
    demandCancelled: "No",
    completedMilestones: [],
    tcec: "Yes",
    refloat: "Yes",
    gem: "Yes",
    gemBiddingMode: "Custom",
    cfaDate: daysAgo(180),
    postTcecDate: daysAgo(20),
    refloatGemUndertakingDate: "",
    biddingStageOver: "No",
  };
  const summary = buildReportsSummary({
    files: [file],
    division: "all",
    delayDays: 5,
    delayMilestone: "gemUndertaking",
  });
  assert.equal(summary.delayRows.length, 1);
  assert.equal(summary.delayRows[0].stageStartDate, file.postTcecDate);
  assert.equal(summary.delayRows[0].focusTarget, "refloatGemUndertakingDate");
  assert.deepEqual(
    searchFiles([file], { dashboardFilter: "delayStatus:5:gemUndertaking" }).map(({ id }) => id),
    [file.id],
  );
  const sql = dashboardFilterSql("delayStatus:5:gemUndertaking", []);
  assert.match(sql, /f\.post_tcec_date/);
  assert.match(sql, /f\.refloat_gem_undertaking_date/);

  const missingStart = buildReportsSummary({
    files: [{ ...file, id: "missing-post-tcec", postTcecDate: "" }],
    division: "all",
    delayDays: 5,
    delayMilestone: "gemUndertaking",
  });
  assert.equal(missingStart.delayRows.length, 0);

  const completed = buildReportsSummary({
    files: [{ ...file, id: "completed-refloat-gem", refloatGemUndertakingDate: daysAgo(2) }],
    division: "all",
    delayDays: 5,
    delayMilestone: "gemUndertaking",
  });
  assert.equal(completed.delayRows.length, 0);
});

test("Non-TCEC refloat Bidding and GeM delays restart from Refloat recommendation", () => {
  const file = {
    id: "non-tcec-refloat-restart-delays",
    fileType: "Goods & Services",
    tcec: "No",
    refloat: "Yes",
    biddingStageOver: "Yes",
    refloatRecommendationDate: daysAgo(12),
    refloatBiddingDate: "",
    gem: "Yes",
    gemBiddingMode: "Custom",
    refloatGemUndertakingDate: "",
  };
  const biddingSummary = buildReportsSummary({
    files: [file],
    division: "all",
    delayDays: 5,
    delayMilestone: "refloatBidding",
  });
  assert.equal(biddingSummary.delayRows.length, 1);
  assert.equal(biddingSummary.delayRows[0].stageStartDate, file.refloatRecommendationDate);
  assert.equal(biddingSummary.delayRows[0].focusTarget, "refloatBiddingDate");

  const gemSummary = buildReportsSummary({
    files: [file],
    division: "all",
    delayDays: 5,
    delayMilestone: "gemUndertaking",
  });
  assert.equal(gemSummary.delayRows.length, 1);
  assert.equal(gemSummary.delayRows[0].stageStartDate, file.refloatRecommendationDate);
  assert.equal(gemSummary.delayRows[0].focusTarget, "refloatGemUndertakingDate");

  const completed = {
    ...file,
    refloatBiddingDate: daysAgo(2),
    refloatGemUndertakingDate: daysAgo(2),
  };
  assert.equal(
    buildReportsSummary({ files: [completed], division: "all", delayDays: 5, delayMilestone: "refloatBidding" }).delayRows.length,
    0,
  );
  assert.equal(
    buildReportsSummary({ files: [completed], division: "all", delayDays: 5, delayMilestone: "gemUndertaking" }).delayRows.length,
    0,
  );
});

test("Post-TCEC Delay Status SQL requires TCEC and completed Bidding Stage Over", () => {
  const sql = dashboardFilterSql("delayStatus:5:postTcec", []);

  assert.match(sql, /lower\(coalesce\(f\.tcec, ''\)\) in \('yes', 'y'\)/);
  assert.match(sql, /lower\(coalesce\(f\.bidding_stage_over, ''\)\) in \('yes', 'y'\)/);
  assert.match(sql, /coalesce\(f\.bid_opening_date::text, ''\) <> ''/);
  assert.doesNotMatch(sql, /f\.bid_date/);
});

test("Bidding Delay supports RFP and non-RFP filters under the common Bidding row", () => {
  const cfaDate = daysAgo(40);
  const files = [
    {
      id: "non-rfp-bidding",
      fileType: "Goods & Services",
      demandCancelled: "No",
      completedMilestones: ["CFA"],
      cfaDate,
      gem: "No",
      gemUndertakingDate: daysAgo(2),
      rfpVetting: "No",
      rfpVettingApprovalDate: daysAgo(1),
      biddingStageOver: "No",
      bidDate: "",
    },
    {
      id: "rfp-bidding",
      fileType: "Goods & Services",
      demandCancelled: "No",
      completedMilestones: ["CFA"],
      cfaDate,
      gem: "No",
      rfpVetting: "Yes",
      rfpVettingInitiationDate: daysAgo(25),
      rfpVettingApprovalDate: daysAgo(15),
      biddingStageOver: "No",
      bidDate: "",
    },
    {
      id: "rfp-approval-pending",
      fileType: "Goods & Services",
      demandCancelled: "No",
      completedMilestones: ["CFA"],
      cfaDate,
      gem: "No",
      rfpVetting: "Yes",
      rfpVettingInitiationDate: daysAgo(25),
      rfpVettingApprovalDate: "",
      biddingStageOver: "No",
      bidDate: "",
    },
    {
      id: "non-rfp-bid-date-entered",
      fileType: "Goods & Services",
      demandCancelled: "No",
      completedMilestones: ["CFA"],
      cfaDate,
      gem: "No",
      rfpVetting: "No",
      bidDate: daysAgo(20),
      bidOpeningDate: daysAgo(15),
      bidOpened: "No",
      biddingStageOver: "No",
    },
    {
      id: "rfp-bid-date-entered-stage-open",
      fileType: "Goods & Services",
      demandCancelled: "No",
      completedMilestones: ["CFA"],
      cfaDate,
      gem: "No",
      rfpVetting: "Yes",
      bidDate: daysAgo(20),
      bidOpeningDate: daysAgo(15),
      bidOpened: "Yes",
      biddingStageOver: "No",
    },
  ];
  const summaryFor = (delayMilestone) => buildReportsSummary({
    files,
    division: "all",
    delayDays: 10,
    delayMilestone,
  });

  assert.deepEqual(
    summaryFor("all").delayRows
      .map(({ fileId, milestoneKey, milestone, cumulativeDelayDays, stageStartDate, biddingBreakupKey }) => ({
        fileId,
        milestoneKey,
        milestone,
        cumulativeDelayDays,
        stageStartDate,
        biddingBreakupKey,
      }))
      .sort((a, b) => a.fileId.localeCompare(b.fileId)),
    [
      { fileId: "non-rfp-bidding", milestoneKey: "bidding", milestone: "Bidding", cumulativeDelayDays: null, stageStartDate: cfaDate, biddingBreakupKey: "tenderLivePending" },
      { fileId: "rfp-approval-pending", milestoneKey: "bidding", milestone: "Bidding", cumulativeDelayDays: null, stageStartDate: cfaDate, biddingBreakupKey: "tenderLivePending" },
      { fileId: "rfp-bidding", milestoneKey: "bidding", milestone: "Bidding", cumulativeDelayDays: null, stageStartDate: cfaDate, biddingBreakupKey: "tenderLivePending" },
    ],
  );
  assert.equal(
    summaryFor("all").delaySummary.byMilestone.find((row) => row.key === "bidding")?.count,
    3,
  );
  assert.equal(
    summaryFor("all").delaySummary.byMilestone.find((row) => row.key === "biddingRfp")?.count,
    undefined,
  );

  for (const [key, expectedId] of [
    ["biddingNonRfp", "non-rfp-bidding"],
    ["biddingRfp", "rfp-bidding,rfp-approval-pending"],
  ]) {
    assert.deepEqual(
      summaryFor(key).delayRows.map(({ fileId }) => fileId).sort(),
      expectedId.split(",").sort(),
    );
    assert.deepEqual(
      searchFiles(files, { dashboardFilter: `delayStatus:10:${key}` }).map(({ id }) => id).sort(),
      expectedId.split(",").sort(),
    );
  }
});

test("Non-TCEC Technical Evaluation Delay is inactive until bidding is over and requires Bid Opening plus a pending S.O.", () => {
  const baseFile = {
    id: "non-tcec-te-delay-inactive",
    fileType: "Goods & Services",
    tcec: "No",
    biddingStageOver: "Yes",
    bidOpeningDate: daysAgo(12),
    supplyOrders: [{ soNo: "SO-1", soCancelled: "No", financialSanctionDate: "" }],
  };
  const cases = [
    { ...baseFile, id: "stage-not-over", biddingStageOver: "No" },
    { ...baseFile, id: "tcec", tcec: "Yes" },
    { ...baseFile, id: "no-opening-date", bidOpeningDate: "" },
    { ...baseFile, id: "all-sanctioned", supplyOrders: [{ soNo: "SO-1", financialSanctionDate: daysAgo(2) }] },
    { ...baseFile, id: "closed", completedMilestones: ["File Closed"] },
  ];

  for (const file of cases) {
    assert.equal(nonTcecTechnicalEvaluationRows(file).delayRows.length, 0, file.id);
    assert.equal(
      searchFiles([file], {
        dashboardFilter: "delayStatus:5:nonTcecTechnicalEvaluation",
      }).length,
      0,
      file.id,
    );
  }
});

test("Non-TCEC refloat Technical Evaluation uses Refloat recommendation before later-cycle Financial Sanction", () => {
  const file = {
    id: "non-tcec-refloat-recommendation",
    fileType: "Goods & Services",
    tcec: "No",
    refloat: "Yes",
    biddingStageOver: "Yes",
    bidOpeningDate: daysAgo(12),
    supplyOrders: [{ soNo: "SO-1", soCancelled: "No", financialSanctionDate: "" }],
  };

  const pending = nonTcecTechnicalEvaluationRows(file);
  const pendingRow = pending.delayRows.find(
    (row) => row.milestoneKey === "nonTcecTechnicalEvaluation",
  );
  assert.ok(pendingRow);
  assert.equal(pendingRow.stageStartDate, file.bidOpeningDate);
  assert.equal(pendingRow.focusTarget, "refloatRecommendationDate");
  assert.deepEqual(
    searchFiles([file], {
      dashboardFilter: "delayStatus:5:nonTcecTechnicalEvaluation",
    }).map((item) => item.id),
    [file.id],
  );

  const recommended = {
    ...file,
    id: "non-tcec-refloat-recommended",
    refloatRecommendationDate: daysAgo(2),
  };
  assert.equal(
    nonTcecTechnicalEvaluationRows(recommended).delayRows.filter(
      (row) => row.milestoneKey === "nonTcecTechnicalEvaluation",
    ).length,
    0,
  );
  assert.equal(
    searchFiles([recommended], {
      dashboardFilter: "delayStatus:5:nonTcecTechnicalEvaluation",
    }).length,
    0,
  );

  const secondCyclePending = {
    ...file,
    id: "non-tcec-refloat-second-cycle-pending",
    refloatBidOpeningDate: daysAgo(12),
    refloatBiddingStageOver: "Yes",
    refloatRecommendationDate: daysAgo(20),
  };
  const secondCycleRow = nonTcecTechnicalEvaluationRows(secondCyclePending).delayRows.find(
    (row) => row.milestoneKey === "nonTcecTechnicalEvaluation",
  );
  assert.ok(secondCycleRow);
  assert.equal(secondCycleRow.stageStartDate, secondCyclePending.refloatBidOpeningDate);
  assert.equal(secondCycleRow.focusTarget, "financialSanction");

  const secondCycleNotOver = {
    ...secondCyclePending,
    id: "non-tcec-refloat-second-cycle-not-over",
    refloatBiddingStageOver: "No",
  };
  assert.equal(
    nonTcecTechnicalEvaluationRows(secondCycleNotOver).delayRows.filter(
      (row) => row.milestoneKey === "nonTcecTechnicalEvaluation",
    ).length,
    0,
  );
  assert.equal(
    searchFiles([secondCycleNotOver], {
      dashboardFilter: "delayStatus:5:nonTcecTechnicalEvaluation",
    }).length,
    0,
  );
  assert.equal(
    searchFiles([secondCycleNotOver], {
      dashboardFilter: "milestoneCleared:refloatBidding",
    }).length,
    0,
  );
  assert.equal(
    searchFiles([secondCyclePending], {
      dashboardFilter: "milestoneCleared:refloatBidding",
    }).length,
    1,
  );

  const laterCycle = {
    ...file,
    id: "non-tcec-refloat-financial-sanction",
    refloatBidOpeningDate: daysAgo(12),
    refloatBiddingStageOver: "Yes",
    supplyOrders: [{ soNo: "SO-1", soCancelled: "No", financialSanctionDate: daysAgo(2) }],
  };
  assert.equal(
    nonTcecTechnicalEvaluationRows(laterCycle).delayRows.filter(
      (row) => row.milestoneKey === "nonTcecTechnicalEvaluation",
    ).length,
    0,
  );
  assert.equal(
    searchFiles([laterCycle], {
      dashboardFilter: "delayStatus:5:nonTcecTechnicalEvaluation",
    }).length,
    0,
  );
  const sql = dashboardFilterSql("delayStatus:5:nonTcecTechnicalEvaluation", []);
  assert.match(sql, /f\.refloat_recommendation_date/);
  assert.match(sql, /f\.refloat_bidding_stage_over/);
});

test("Financial Sanction delay starts from CNC approval for TCEC files", () => {
  const cncApprovalDate = daysAgo(12);
  const rows = financialSanctionRows({
    id: "fs-delay-tcec",
    fileType: "Goods & Services",
    cfaDate: daysAgo(120),
    tcec: "Yes",
    biddingStageOver: "Yes",
    cncApprovalDate,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].stageStartDate, cncApprovalDate);
});

test("Financial Sanction delay counts each expected pending S.O. separately", () => {
  const rows = financialSanctionRows({
    id: "fs-delay-two-expected-orders",
    fileType: "Goods & Services",
    tcec: "Yes",
    biddingStageOver: "Yes",
    cncApprovalDate: daysAgo(12),
    noOfSo: "2",
    supplyOrders: [],
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.focusTarget),
    ["financialsanction:pending:0", "financialsanction:pending:1"],
  );
});

test("Financial Sanction Search includes a TCEC expected S.O. slot with no saved S.O. row", () => {
  const file = {
    id: "fs-delay-expected-order-no-row",
    fileType: "Goods & Services",
    tcec: "Yes",
    biddingStageOver: "Yes",
    cncApprovalDate: daysAgo(12),
    noOfSo: "1",
    supplyOrders: [],
  };

  assert.equal(financialSanctionRows(file).length, 1);
  const matches = searchFiles([file], {
    dashboardFilter: "delayStatus:5:financialSanction",
  });

  assert.deepEqual(matches.map((item) => item.id), [file.id]);
});

test("TCEC Supply Order delay starts at CNC Approval, not S.O. sanction", () => {
  const cncApprovalDate = daysAgo(20);
  const financialSanctionDate = daysAgo(12);
  const file = {
    id: "so-delay-tcec-start",
    fileType: "Goods & Services",
    tcec: "Yes",
    biddingStageOver: "Yes",
    cncApprovalDate,
    noOfSo: "1",
    supplyOrders: [
      {
        currentMilestone: "Supply Order",
        financialSanctionDate,
      },
    ],
  };
  const rows = supplyOrderDelayRows(file);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].stageStartDate, cncApprovalDate);
  assert.deepEqual(
    searchFiles([file], { dashboardFilter: "delayStatus:5:supplyOrder" }).map((item) => item.id),
    [file.id],
  );
});

test("Non-TCEC Supply Order delay starts from that S.O.'s Financial Sanction date", () => {
  const financialSanctionDate = daysAgo(12);
  const file = {
    id: "so-delay-non-tcec-start",
    fileType: "Goods & Services",
    tcec: "No",
    biddingStageOver: "Yes",
    noOfSo: "1",
    supplyOrders: [
      {
        currentMilestone: "Supply Order",
        financialSanctionDate,
      },
    ],
  };
  const rows = supplyOrderDelayRows(file);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].stageStartDate, financialSanctionDate);
  assert.deepEqual(
    searchFiles([file], { dashboardFilter: "delayStatus:5:supplyOrder" }).map((item) => item.id),
    [file.id],
  );
});

test("TCEC Supply Order delay does not use a future CNC approval as its start", () => {
  const receivedDate = daysAgo(30);
  const file = {
    id: "so-delay-tcec-cutoff",
    fileType: "Goods & Services",
    tcec: "Yes",
    biddingStageOver: "Yes",
    receivedDate,
    cncApprovalDate: "2099-01-01",
    noOfSo: "1",
    supplyOrders: [{ currentMilestone: "Supply Order" }],
  };
  const rows = supplyOrderDelayRows(file);

  assert.equal(rows.length, 0);
  assert.deepEqual(
    searchFiles([file], { dashboardFilter: "delayStatus:5:supplyOrder" }).map((item) => item.id),
    [],
  );
});

test("TCEC Supply Order delay ignores an unsaved S.O. placeholder", () => {
  const file = {
    id: "so-delay-tcec-placeholder",
    fileType: "Goods & Services",
    tcec: "Yes",
    biddingStageOver: "Yes",
    cncApprovalDate: daysAgo(20),
    noOfSo: "1",
    supplyOrders: [],
  };

  assert.equal(supplyOrderDelayRows(file).length, 0);
  assert.deepEqual(
    searchFiles([file], { dashboardFilter: "delayStatus:5:supplyOrder" }).map((item) => item.id),
    [],
  );
});

test("Financial Sanction delay excludes non-TCEC bidding files", () => {
  const bidOpeningDate = daysAgo(14);
  const rows = financialSanctionRows({
    id: "fs-delay-bidding",
    fileType: "Goods & Services",
    cfaDate: daysAgo(120),
    tcec: "No",
    biddingStageOver: "Yes",
    bidOpeningDate,
  });

  assert.equal(rows.length, 0);
});

test("Financial Sanction delay excludes non-TCEC refloat files", () => {
  const refloatBidOpeningDate = daysAgo(10);
  const rows = financialSanctionRows({
    id: "fs-delay-refloat",
    fileType: "Goods & Services",
    cfaDate: daysAgo(120),
    tcec: "No",
    biddingStageOver: "Yes",
    bidOpeningDate: daysAgo(90),
    refloat: "Yes",
    refloatBidOpeningDate,
  });

  assert.equal(rows.length, 0);
});

test("Financial Sanction delay excludes non-TCEC refloat files without a refloat date", () => {
  const bidOpeningDate = daysAgo(11);
  const rows = financialSanctionRows({
    id: "fs-delay-refloat-fallback",
    fileType: "Goods & Services",
    cfaDate: daysAgo(120),
    tcec: "No",
    biddingStageOver: "Yes",
    bidOpeningDate,
    refloat: "Yes",
    refloatBidOpeningDate: "",
  });

  assert.equal(rows.length, 0);
});

test("Financial Sanction delay excludes non-TCEC files when bidding does not apply", () => {
  const cfaDate = daysAgo(9);
  const rows = financialSanctionRows({
    id: "fs-delay-no-bidding",
    mode: "LPC",
    fileType: "Goods & Services",
    cfaDate,
    tcec: "No",
  });

  assert.equal(rows.length, 0);
});

test("Financial Sanction Search drill-down includes TCEC only", () => {
  const makeFile = (id, tcec) => ({
    id,
    tcec,
    fileType: "Goods & Services",
    cfaDate: daysAgo(12),
    cncApprovalDate: tcec === "Yes" ? daysAgo(12) : "",
    biddingStageOver: "Yes",
    currentMilestone: "Financial Sanction",
    completedMilestones: [],
    demandCancelled: "No",
    supplyOrders: [
      {
        currentMilestone: "Financial Sanction",
        financialSanctionDate: "",
        soCancelled: "No",
        noFurtherAction: "No",
      },
    ],
  });
  const matches = searchFiles(
    [makeFile("tcec-file", "Yes"), makeFile("non-tcec-file", "No")],
    { dashboardFilter: "delayStatus:5:financialSanction" },
  );

  assert.deepEqual(matches.map((file) => file.id), ["tcec-file"]);
});
