import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardSummary } from "../backend/src/utils/dashboard-summary.ts";
import { searchFiles } from "../backend/src/utils/file-search.ts";

process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const { dashboardFilterSql } = await import("../backend/src/routes/files.ts");

const settings = {
  selectedYear: "All Files",
  financialYear: "2026-27",
  valueThresholdLevels: [],
  modes: [],
  fileTypes: [],
  firmTypes: [],
  milestones: [],
  bgReturnOffsetDays: 60,
};

function file(id, overrides = {}) {
  return {
    id,
    fileType: "Goods & Services",
    receivedDate: "2026-07-20",
    cfaDate: "2026-08-01",
    biddingStageOver: "Yes",
    tcec: "No",
    bidOpeningDate: "2026-08-20",
    ...overrides,
  };
}

test("Non-TCEC Bidding ranking uses CFA to Bid Date and does not shift for GeM or RFP dates", () => {
  const files = [
    file("gem-and-rfp", {
      gem: "Yes",
      gemBiddingMode: "Open Tender",
      gemUndertakingDate: "2026-08-05",
      rfpVetting: "Yes",
      rfpVettingApprovalDate: "2026-08-12",
      bidDate: "2026-08-20",
    }),
    file("rfp-no-stale-approval", {
      gem: "No",
      rfpVetting: "No",
      rfpVettingApprovalDate: "2026-08-18",
      bidOpeningDate: "2026-08-10",
      bidDate: "2026-08-10",
    }),
    file("gem-comparison", {
      gem: "Yes",
      gemBiddingMode: "Comparison",
      gemUndertakingDate: "2026-08-15",
      rfpVetting: "No",
      bidOpeningDate: "2026-08-10",
      bidDate: "2026-08-10",
    }),
    file("rfp-approval-missing", {
      rfpVetting: "Yes",
      rfpVettingApprovalDate: "",
      bidDate: "",
    }),
    file("gem-date-missing", {
      gem: "Yes",
      gemBiddingMode: "Open Tender",
      gemUndertakingDate: "",
      rfpVetting: "No",
      bidDate: "2026-08-20",
    }),
  ];

  const summary = buildDashboardSummary({ files, divisions: [], settings });
  const row = summary.analytics.milestoneClearingRanking.find((item) => item.name === "Bidding");
  assert.ok(row);
  assert.equal(row.sampleSize, 3);
  assert.equal(row.fileCount, 3);
  assert.equal(row.averageDays, 16); // 19, 9, and 19 days from CFA to Bid Date.
  assert.equal(row.cumulativeDays, 28); // Receipt-to-end remains cumulative.
  assert.deepEqual(
    searchFiles(files, { dashboardFilter: "analyticsMilestoneClearing:bidding" })
      .map((item) => item.id)
      .sort(),
    ["gem-and-rfp", "gem-date-missing", "rfp-no-stale-approval"],
  );
});

test("Bidding ranking SQL click-through uses the same Non-TCEC cycle rules", () => {
  const sql = dashboardFilterSql("analyticsMilestoneClearing:bidding", []);
  assert.match(sql, /f\.cfa_date/);
  assert.match(sql, /f\.bid_date/);
  assert.match(sql, /f\.refloat_recommendation_date/);
  assert.match(sql, /f\.refloat_bidding_date/);
  assert.match(sql, /not lower\(coalesce\(f\.tcec/);
  assert.match(sql, /\)\s+or\s+\(/);
  assert.match(sql, /f\.received_date/);
});

test("Non-TCEC Refloat Bidding ranking contributes original and refloat samples", () => {
  const candidate = file("non-tcec-refloat-bidding-ranking", {
    bidDate: "2026-08-10",
    refloat: "Yes",
    refloatRecommendationDate: "2026-08-12",
    refloatBiddingDate: "2026-08-20",
    biddingStageOver: "Yes",
  });
  const summary = buildDashboardSummary({ files: [candidate], divisions: [], settings });
  const row = summary.analytics.milestoneClearingRanking.find((item) => item.name === "Bidding");
  assert.ok(row);
  assert.equal(row.sampleSize, 2);
  assert.equal(row.fileCount, 1);
  assert.equal(row.averageDays, 9); // 9 and 8 days, rounded average.
  assert.deepEqual(
    searchFiles([candidate], { dashboardFilter: "analyticsMilestoneClearing:bidding" })
      .map(({ id }) => id),
    [candidate.id],
  );
});

test("GeM Undertaking ranking SQL click-through includes normal and Non-TCEC Refloat samples", () => {
  const sql = dashboardFilterSql("analyticsMilestoneClearing:gemUndertaking", []);
  assert.match(sql, /f\.cfa_date/);
  assert.match(sql, /f\.gem_undertaking_date/);
  assert.match(sql, /f\.refloat_recommendation_date/);
  assert.match(sql, /f\.refloat_gem_undertaking_date/);
  assert.match(sql, /not lower\(coalesce\(f\.tcec/);
  assert.match(sql, /\)\s+or\s+\(/);
});

test("Non-TCEC Technical Evaluation SQL click-through includes both completed cycles", () => {
  const sql = dashboardFilterSql("analyticsMilestoneClearing:nonTcecTechnicalEvaluation", []);
  assert.match(sql, /f\.bid_opening_date/);
  assert.match(sql, /f\.refloat_recommendation_date/);
  assert.match(sql, /f\.refloat_bid_opening_date/);
  assert.match(sql, /f\.refloat_bidding_stage_over/);
  assert.match(sql, /f\.bidding_stage_over/);
  assert.match(sql, /\)\s+or\s+\(/);
});

test("TCEC Refloat Bidding ranking starts at Post-TCEC minutes", () => {
  const candidate = file("tcec-refloat-bidding-ranking", {
    cfaDate: "2026-05-01",
    gem: "Yes",
    gemBiddingMode: "Open Tender",
    gemUndertakingDate: "",
    rfpVetting: "Yes",
    rfpVettingApprovalDate: "",
    tcec: "Yes",
    postTcecMinutesDate: "2026-09-01",
    refloat: "Yes",
    bidOpeningDate: "2026-07-15",
    refloatBiddingDate: "2026-09-03",
    refloatBidOpeningDate: "2026-09-05",
    refloatPostTcecDate: "2026-09-11",
    biddingStageOver: "Yes",
  });
  const summary = buildDashboardSummary({ files: [candidate], divisions: [], settings });
  const row = summary.analytics.milestoneClearingRanking.find((item) => item.name === "Bidding");
  assert.ok(row);
  assert.equal(row.sampleSize, 1);
  assert.equal(row.averageDays, 10);
  assert.deepEqual(
    searchFiles([candidate], { dashboardFilter: "analyticsMilestoneClearing:bidding" })
      .map(({ id }) => id),
    [candidate.id],
  );
});
