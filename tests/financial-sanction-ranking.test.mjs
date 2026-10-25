import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardSummary } from "../backend/src/utils/dashboard-summary.ts";
import { searchFiles } from "../backend/src/utils/file-search.ts";

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

test("Financial Sanction ranking uses one CNC-to-sanction sample per recorded TCEC S.O.", () => {
  const summary = buildDashboardSummary({
    files: [
      {
        id: "financial-sanction-ranking-tcec",
        tcec: "Yes",
        receivedDate: "2025-12-01",
        cncApprovalDate: "2026-01-01",
        supplyOrders: [
          { financialSanctionDate: "2026-01-03" },
          { financialSanctionDate: "2026-01-06" },
        ],
      },
      {
        id: "financial-sanction-ranking-non-tcec",
        tcec: "No",
        receivedDate: "2025-12-01",
        cncApprovalDate: "2026-01-01",
        supplyOrders: [{ financialSanctionDate: "2026-01-02" }],
      },
    ],
    divisions: [],
    settings,
  });

  const row = summary.analytics.milestoneClearingRanking.find(
    (item) => item.name === "Financial Sanction",
  );
  assert.ok(row);
  assert.equal(row.sampleSize, 2);
  assert.equal(row.fileCount, 1);
  assert.equal(row.averageDays, 4);
  assert.equal(row.fileIds, "financial-sanction-ranking-tcec");
});

test("GeM Undertaking ranking combines normal and Non-TCEC Refloat samples", () => {
  const summary = buildDashboardSummary({
    files: [
      {
        id: "gem-undertaking-two-samples",
        receivedDate: "2026-07-20",
        cfaDate: "2026-08-01",
        gem: "Yes",
        gemBiddingMode: "Open Tender",
        gemUndertakingDate: "2026-08-05",
        tcec: "No",
        refloat: "Yes",
        refloatRecommendationDate: "2026-08-10",
        refloatGemUndertakingDate: "2026-08-15",
      },
    ],
    divisions: [],
    settings,
  });

  const row = summary.analytics.milestoneClearingRanking.find(
    (item) => item.name === "GeM Undertaking",
  );
  assert.ok(row);
  assert.equal(row.sampleSize, 2);
  assert.equal(row.fileCount, 1);
  assert.equal(row.averageDays, 5); // 4 and 5 days, rounded average.
  assert.equal(row.minDays, 4);
  assert.equal(row.maxDays, 5);
  assert.equal(row.fileIds, "gem-undertaking-two-samples");
  assert.deepEqual(
    searchFiles(
      [
        {
          id: "gem-undertaking-two-samples",
          receivedDate: "2026-07-20",
          cfaDate: "2026-08-01",
          gem: "Yes",
          gemBiddingMode: "Open Tender",
          gemUndertakingDate: "2026-08-05",
          tcec: "No",
          refloat: "Yes",
          refloatRecommendationDate: "2026-08-10",
          refloatGemUndertakingDate: "2026-08-15",
        },
      ],
      { dashboardFilter: "analyticsMilestoneClearing:gemUndertaking" },
    ).map(({ id }) => id),
    ["gem-undertaking-two-samples"],
  );
});

test("Non-TCEC Technical Evaluation ranking uses one non-refloat sample ending at first Financial Sanction", () => {
  const summary = buildDashboardSummary({
    files: [
      {
        id: "non-tcec-technical-evaluation-file-level",
        fileType: "Goods & Services",
        tcec: "No",
        biddingStageOver: "Yes",
        receivedDate: "2026-07-20",
        bidOpeningDate: "2026-08-10",
        supplyOrders: [
          { financialSanctionDate: "2026-08-12" },
          { financialSanctionDate: "2026-08-20" },
        ],
      },
    ],
    divisions: [],
    settings,
  });

  const row = summary.analytics.milestoneClearingRanking.find(
    (item) => item.name === "Non-TCEC Technical Evaluation",
  );
  assert.ok(row);
  assert.equal(row.sampleSize, 1);
  assert.equal(row.fileCount, 1);
  assert.equal(row.averageDays, 2);
  assert.equal(row.fileIds, "non-tcec-technical-evaluation-file-level");
});

test("Non-TCEC Refloat Technical Evaluation contributes completed first and second cycle samples", () => {
  const summary = buildDashboardSummary({
    files: [
      {
        id: "non-tcec-technical-evaluation-refloat-cycles",
        fileType: "Goods & Services",
        tcec: "No",
        refloat: "Yes",
        biddingStageOver: "Yes",
        refloatBiddingStageOver: "Yes",
        receivedDate: "2026-07-20",
        bidOpeningDate: "2026-08-10",
        refloatRecommendationDate: "2026-08-18",
        refloatBidOpeningDate: "2026-08-20",
        supplyOrders: [{ financialSanctionDate: "2026-08-25" }],
      },
    ],
    divisions: [],
    settings,
  });

  const row = summary.analytics.milestoneClearingRanking.find(
    (item) => item.name === "Non-TCEC Technical Evaluation",
  );
  assert.ok(row);
  assert.equal(row.sampleSize, 2);
  assert.equal(row.fileCount, 1);
  assert.equal(row.averageDays, 7); // 8 and 5 days, rounded average.
  assert.equal(row.minDays, 5);
  assert.equal(row.maxDays, 8);
  assert.equal(row.fileIds, "non-tcec-technical-evaluation-refloat-cycles");
});

test("Non-TCEC Refloat retains the completed first-cycle sample before the second cycle is over", () => {
  const summary = buildDashboardSummary({
    files: [
      {
        id: "non-tcec-technical-evaluation-first-cycle-only",
        fileType: "Goods & Services",
        tcec: "No",
        refloat: "Yes",
        biddingStageOver: "Yes",
        refloatBiddingStageOver: "No",
        receivedDate: "2026-07-20",
        bidOpeningDate: "2026-08-10",
        refloatRecommendationDate: "2026-08-18",
        refloatBidOpeningDate: "2026-08-20",
        supplyOrders: [],
      },
    ],
    divisions: [],
    settings,
  });

  const row = summary.analytics.milestoneClearingRanking.find(
    (item) => item.name === "Non-TCEC Technical Evaluation",
  );
  assert.ok(row);
  assert.equal(row.sampleSize, 1);
  assert.equal(row.fileCount, 1);
  assert.equal(row.averageDays, 8);
});

test("Non-TCEC Refloat does not substitute Financial Sanction for a missing recommendation", () => {
  const summary = buildDashboardSummary({
    files: [
      {
        id: "non-tcec-technical-evaluation-missing-recommendation",
        fileType: "Goods & Services",
        tcec: "No",
        refloat: "Yes",
        biddingStageOver: "Yes",
        receivedDate: "2026-07-20",
        bidOpeningDate: "2026-08-10",
        refloatRecommendationDate: "",
        supplyOrders: [{ financialSanctionDate: "2026-08-25" }],
      },
    ],
    divisions: [],
    settings,
  });

  assert.equal(
    summary.analytics.milestoneClearingRanking.find(
      (item) => item.name === "Non-TCEC Technical Evaluation",
    ),
    undefined,
  );
});

test("CNC ranking starts at Post-TCEC approval even when a refloat Post-TCEC stage is later", () => {
  const summary = buildDashboardSummary({
    files: [
      {
        id: "cnc-post-tcec-start",
        tcec: "Yes",
        refloat: "Yes",
        receivedDate: "2026-07-20",
        postTcecDate: "2026-08-01",
        postTcecMinutesDate: "2026-08-10",
        refloatPostTcecDate: "2026-08-11",
        refloatPostTcecMinutesDate: "2026-08-20",
        cncApprovalDate: "2026-08-25",
      },
    ],
    divisions: [],
    settings,
  });

  const row = summary.analytics.milestoneClearingRanking.find((item) => item.name === "CNC");
  assert.ok(row);
  assert.equal(row.averageDays, 15);
});

test("TCEC Supply Order ranking excludes orders until CNC Approval Date is recorded", () => {
  const summary = buildDashboardSummary({
    files: [
      {
        id: "supply-order-requires-cnc",
        tcec: "Yes",
        receivedDate: "2026-07-20",
        postTcecMinutesDate: "2026-08-10",
        cncApprovalDate: "",
        supplyOrders: [{ soDate: "2026-08-20" }],
      },
    ],
    divisions: [],
    settings,
  });

  assert.equal(
    summary.analytics.milestoneClearingRanking.find((item) => item.name === "Supply Order"),
    undefined,
  );
});

test("Milestone Clearing uses the latest completed applicable file stage regardless of configured order", () => {
  const summary = buildDashboardSummary({
    files: [
      {
        id: "out-of-order-stage-completions",
        receivedDate: "2026-07-20",
        scrutinyCompletionDate: "2026-08-01",
        tcec: "Yes",
        preTcecDate: "2026-08-02",
        preTcecMinutesDate: "2026-08-10",
        rqa: "Yes",
        rqaSentDate: "2026-08-11",
        rqaApprovalDate: "2026-08-18",
        ad: "Yes",
        adSentDate: "2026-08-12",
        adVettingDate: "2026-08-24",
      },
    ],
    divisions: [],
    settings,
  });

  const rankings = summary.analytics.milestoneClearingRanking;
  assert.equal(rankings.find((item) => item.name === "Pre-TCEC")?.averageDays, 9);
  assert.equal(rankings.find((item) => item.name === "R&QA")?.averageDays, 8);
  assert.equal(rankings.find((item) => item.name === "AD")?.averageDays, 6);
});

test("RFP Vetting ranking uses applicable GeM Undertaking or CFA and keeps cumulative age from receipt", () => {
  const files = [
    {
      id: "rfp-with-gem",
      receivedDate: "2026-07-20",
      cfaDate: "2026-08-01",
      gem: "Yes",
      gemBiddingMode: "Open Tender",
      gemUndertakingDate: "2026-08-05",
      rfpVetting: "Yes",
      rfpVettingApprovalDate: "2026-08-12",
    },
    {
      id: "rfp-without-gem",
      receivedDate: "2026-07-20",
      cfaDate: "2026-08-01",
      gem: "No",
      rfpVetting: "Yes",
      rfpVettingApprovalDate: "2026-08-12",
    },
    {
      id: "rfp-comparison-uses-cfa",
      receivedDate: "2026-07-20",
      cfaDate: "2026-08-01",
      gem: "Yes",
      gemBiddingMode: "Comparison",
      gemUndertakingDate: "2026-08-05",
      rfpVetting: "Yes",
      rfpVettingApprovalDate: "2026-08-12",
    },
    {
      id: "rfp-gem-date-missing",
      receivedDate: "2026-07-20",
      cfaDate: "2026-08-01",
      gem: "Yes",
      gemBiddingMode: "Open Tender",
      gemUndertakingDate: "",
      rfpVetting: "Yes",
      rfpVettingApprovalDate: "2026-08-12",
    },
    {
      id: "rfp-not-applicable",
      receivedDate: "2026-07-20",
      cfaDate: "2026-08-01",
      rfpVetting: "No",
      rfpVettingApprovalDate: "2026-08-12",
    },
  ];
  const summary = buildDashboardSummary({ files, divisions: [], settings });
  const row = summary.analytics.milestoneClearingRanking.find((item) => item.name === "RFP Vetting");

  assert.ok(row);
  assert.equal(row.sampleSize, 3);
  assert.equal(row.fileCount, 3);
  assert.equal(row.averageDays, 10); // (7 + 11 + 11) / 3, rounded.
  assert.equal(row.cumulativeDays, 23);
  assert.deepEqual(
    searchFiles(files, { dashboardFilter: "analyticsMilestoneClearing:rfpVetting" })
      .map((file) => file.id)
      .sort(),
    ["rfp-comparison-uses-cfa", "rfp-with-gem", "rfp-without-gem"],
  );

  const downstreamSummary = buildDashboardSummary({
    files: [
      {
        id: "later-stage-starts-after-rfp",
        receivedDate: "2026-07-20",
        cfaDate: "2026-08-01",
        gem: "No",
        rfpVetting: "Yes",
        rfpVettingApprovalDate: "2026-08-12",
        tcec: "Yes",
        postTcecDate: "2026-08-13",
        postTcecMinutesDate: "2026-08-18",
      },
    ],
    divisions: [],
    settings,
  });
  assert.equal(
    downstreamSummary.analytics.milestoneClearingRanking.find((item) => item.name === "Post-TCEC")
      ?.averageDays,
    5,
  );
});
