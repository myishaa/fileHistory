import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { getSuspectedAnomalyRows } = await import("../backend/src/routes/dashboard.ts");
const { buildDashboardSummary } = await import("../backend/src/utils/dashboard-summary.ts");
const { buildReportsSummary } = await import("../backend/src/utils/report-summary.ts");

const settings = { signatures: new Set(), universalRuleKeys: new Set() };
const dashboardSettings = {
  selectedYear: "All Files",
  financialYear: "2026-27",
  valueThresholdLevels: [],
  modes: [],
  fileTypes: [],
  firmTypes: [],
  milestones: [],
  bgReturnOffsetDays: 60,
};

function refloatTcecFile(overrides = {}) {
  return {
    id: "refloat-cycle-separation-test",
    mode: "OBM",
    fileType: "Goods & Services",
    cfaDate: "2026-08-01",
    tcec: "Yes",
    preTcecDate: "2026-08-05",
    preTcecMinutesDate: "2026-08-06",
    refloat: "Yes",
    currentMilestone: "Refloat Bidding",
    bidDate: "2026-08-10",
    bidOpeningDate: "2026-08-11",
    biddingStageOver: "Yes",
    refloatBiddingDate: "2026-09-01",
    refloatBidOpeningDate: "2026-09-02",
    refloatBiddingStageOver: "Yes",
    refloatPostTcecDate: "2026-09-03",
    refloatPostTcecMinutesDate: "2026-09-04",
    ...overrides,
  };
}

test("normal Bidding completion does not satisfy Refloat Bidding", () => {
  const rows = getSuspectedAnomalyRows(
    [refloatTcecFile({ refloatBiddingStageOver: "No" })],
    settings,
  );

  assert.equal(
    rows.some((row) => row.rule.includes("Refloat Bidding Stage Over")),
    true,
  );
});

test("Refloat Post-TCEC can be complete without original Post-TCEC fields", () => {
  const rows = getSuspectedAnomalyRows(
    [
      refloatTcecFile({
        postTcecDate: "",
        postTcecMinutesDate: "",
        refloatBiddingStageOver: "Yes",
      }),
    ],
    settings,
  );

  assert.equal(
    rows.some(
      (row) =>
        row.rule.includes("original Post-TCEC") ||
        row.rule.includes("Bidding Stage Over is not Yes"),
    ),
    false,
  );
});

test("normal Bidding completion cannot clear or activate TCEC Refloat milestones", () => {
  const file = refloatTcecFile({
    demandCancelled: "No",
    bidOpened: "No",
    refloatBiddingStageOver: "No",
    refloatBidOpeningDate: "2026-09-02",
    refloatPostTcecMinutesDate: "",
  });
  const summary = buildReportsSummary({
    files: [file],
    division: "all",
    delayDays: 5,
    delayMilestone: "refloatBidding",
  });
  const statusRows = summary.statusSummaryGroups.flatMap((group) => group.rows);
  const refloatBidding = statusRows.find((row) => row.milestone === "Refloat bidding");
  const refloatPostTcec = statusRows.find((row) => row.milestone === "Refloat Post-TCEC");

  assert.equal(refloatBidding?.counts.Completed, 0);
  assert.equal(refloatBidding?.counts["Opening overdue"], 1);
  assert.equal(refloatPostTcec?.counts.Total, 1);
  assert.equal(refloatPostTcec?.counts["In process"], 0);
  assert.equal(refloatPostTcec?.counts.Completed, 0);
});

test("Refloat Post-TCEC starts only after Refloat Bidding Stage Over", () => {
  const summary = buildReportsSummary({
    files: [
      refloatTcecFile({
        currentMilestone: "Refloat Post-TCEC",
        refloatBiddingStageOver: "Yes",
        refloatPostTcecDate: "",
        refloatPostTcecMinutesDate: "",
      }),
    ],
    division: "all",
    delayDays: 5,
    delayMilestone: "refloatPostTcec",
  });
  const statusRows = summary.statusSummaryGroups.flatMap((group) => group.rows);
  const refloatPostTcec = statusRows.find((row) => row.milestone === "Refloat Post-TCEC");

  assert.equal(refloatPostTcec?.counts.Total, 1);
  assert.equal(refloatPostTcec?.counts["In process"], 1);
  assert.equal(refloatPostTcec?.counts.Pending, 1);
  assert.equal(refloatPostTcec?.counts.Completed, 0);
});

test("Refloat Post-TCEC active counters require the exact current milestone", () => {
  const staleFile = refloatTcecFile({
    currentMilestone: "CNC",
    refloatPostTcecDate: "2026-09-03",
    refloatPostTcecMinutesDate: "",
  });
  const currentFile = { ...staleFile, currentMilestone: "Refloat Post-TCEC" };

  const staleDashboard = buildDashboardSummary({
    files: [staleFile],
    divisions: [],
    settings: dashboardSettings,
  });
  const staleDashboardRow = staleDashboard.statusFlow.find(
    (item) => item.key === "refloatPostTcec",
  );
  assert.equal(staleDashboardRow?.active, 0);
  assert.equal(staleDashboardRow?.pending, 0);
  assert.equal(staleDashboardRow?.reviewed, 0);

  const currentDashboard = buildDashboardSummary({
    files: [currentFile],
    divisions: [],
    settings: dashboardSettings,
  });
  const currentDashboardRow = currentDashboard.statusFlow.find(
    (item) => item.key === "refloatPostTcec",
  );
  assert.equal(currentDashboardRow?.active, 1);
  assert.equal(currentDashboardRow?.pending, 0);
  assert.equal(currentDashboardRow?.reviewed, 1);

  const staleReports = buildReportsSummary({
    files: [staleFile],
    division: "all",
    delayDays: 5,
    delayMilestone: "refloatPostTcec",
  });
  const staleReportRow = staleReports.statusSummaryGroups
    .flatMap((group) => group.rows)
    .find((row) => row.milestone === "Refloat Post-TCEC");
  assert.equal(staleReportRow?.counts["In process"], 0);
  assert.equal(staleReportRow?.counts.Pending, 0);
  assert.equal(staleReportRow?.counts.Reviewed ?? 0, 0);
});

test("Dashboard Status-1 includes Refloat TCEC cases before Refloat Bidding Stage Over", () => {
  const summary = buildDashboardSummary({
    files: [
      refloatTcecFile({
        refloatBiddingStageOver: "No",
        refloatPostTcecDate: "",
        refloatPostTcecMinutesDate: "",
      }),
    ],
    divisions: [],
    settings: dashboardSettings,
  });
  const row = summary.statusFlow.find((item) => item.key === "refloatPostTcec");

  assert.equal(row?.total, 1);
  assert.equal(row?.underProcess, 0);
  assert.equal(row?.active, 0);
  assert.equal(row?.pending, 0);
  assert.equal(row?.cleared, 0);
});

test("CNC At previous stage counts an incomplete active-cycle Post-TCEC predecessor", () => {
  const summary = buildDashboardSummary({
    files: [
      refloatTcecFile({
        id: "normal-cnc-predecessor-incomplete",
        refloat: "No",
        scrutinyCompletionDate: "2026-07-30",
        immsDate: "2026-07-31",
        postTcecMinutesDate: "",
        cncApprovalDate: "",
        currentMilestone: "Post-TCEC",
      }),
      refloatTcecFile({
        id: "refloat-cnc-predecessor-incomplete",
        refloatBiddingStageOver: "Yes",
        refloatPostTcecMinutesDate: "",
        cncApprovalDate: "",
        currentMilestone: "Refloat Post-TCEC",
      }),
    ],
    divisions: [],
    settings: dashboardSettings,
  });
  const row = summary.statusFlow.find((item) => item.key === "cnc");

  assert.equal(row?.total, 2);
  assert.equal(row?.underProcess, 2);
  assert.equal(row?.cleared, 0);
});

test("Post-TCEC and CNC previous-stage counters use the exact active predecessor", () => {
  const files = [
    refloatTcecFile({
      id: "post-tcec-previous",
      refloat: "No",
      scrutinyCompletionDate: "2026-07-30",
      immsDate: "2026-07-31",
      biddingStageOver: "No",
      currentMilestone: "Bidding",
      postTcecMinutesDate: "",
    }),
    refloatTcecFile({
      id: "post-tcec-wrong-current",
      refloat: "No",
      scrutinyCompletionDate: "2026-07-30",
      immsDate: "2026-07-31",
      biddingStageOver: "No",
      currentMilestone: "Post-TCEC",
      postTcecMinutesDate: "",
    }),
    refloatTcecFile({
      id: "cnc-normal-previous",
      refloat: "No",
      scrutinyCompletionDate: "2026-07-30",
      immsDate: "2026-07-31",
      biddingStageOver: "Yes",
      currentMilestone: "Post-TCEC",
      postTcecMinutesDate: "",
      cncApprovalDate: "",
    }),
    refloatTcecFile({
      id: "cnc-refloat-previous",
      currentMilestone: "Refloat Post-TCEC",
      refloatBiddingStageOver: "Yes",
      refloatPostTcecMinutesDate: "",
      cncApprovalDate: "",
    }),
  ];

  const dashboard = buildDashboardSummary({
    files,
    divisions: [],
    settings: dashboardSettings,
  });
  assert.equal(dashboard.statusFlow.find((item) => item.key === "postTcec")?.underProcess, 1);
  assert.equal(dashboard.statusFlow.find((item) => item.key === "cnc")?.underProcess, 2);
  assert.equal(
    dashboard.statusFlow.find((item) => item.key === "refloatPostTcec")?.underProcess,
    0,
  );

  const reports = buildReportsSummary({
    files,
    division: "all",
    delayDays: 5,
    delayMilestone: "cnc",
  });
  const rows = reports.statusSummaryGroups.flatMap((group) => group.rows);
  const postTcec = rows.find((row) => row.milestone === "Post-TCEC");
  const cnc = rows.find((row) => row.milestone === "CNC");
  const refloatPostTcec = rows.find((row) => row.milestone === "Refloat Post-TCEC");
  assert.equal(postTcec?.counts["At previous stage"], 1);
  assert.equal(cnc?.counts["At previous stage"], 2);
  assert.equal(refloatPostTcec?.counts["At previous stage"], undefined);
});

test("IFA At previous stage requires Controlling to be the current incomplete stage", () => {
  const file = {
    id: "ifa-previous-stage",
    ifa: "Yes",
    receivedDate: "2026-08-01",
    scrutinyCompletionDate: "2026-08-02",
    immsDate: "",
    currentMilestone: "Controlling",
    ifaSentDate: "",
    ifaFinalDate: "",
  };
  const dashboard = buildDashboardSummary({
    files: [file],
    divisions: [],
    settings: dashboardSettings,
  });
  const dashboardRow = dashboard.statusFlow.find((item) => item.key === "ifa");
  assert.equal(dashboardRow?.underProcess, 1);

  const reports = buildReportsSummary({
    files: [file],
    division: "all",
    delayDays: 5,
    delayMilestone: "ifa",
  });
  const reportRow = reports.statusSummaryGroups
    .flatMap((group) => group.rows)
    .find((row) => row.milestone === "IFA");
  assert.equal(reportRow?.counts["At previous stage"], 1);

  const notControlling = buildDashboardSummary({
    files: [{ ...file, currentMilestone: "CFA" }],
    divisions: [],
    settings: dashboardSettings,
  });
  assert.equal(
    notControlling.statusFlow.find((item) => item.key === "ifa")?.underProcess,
    0,
  );
});

test("Refloat Bidding with blank dates is counted as In process", () => {
  const summary = buildReportsSummary({
    files: [
      refloatTcecFile({
        refloatBiddingDate: "",
        refloatBidOpeningDate: "",
        refloatBiddingStageOver: "No",
      }),
    ],
    division: "all",
    delayDays: 5,
    delayMilestone: "refloatBidding",
  });
  const statusRows = summary.statusSummaryGroups.flatMap((group) => group.rows);
  const refloatBidding = statusRows.find((row) => row.milestone === "Refloat bidding");

  assert.equal(refloatBidding?.counts.Live, 0);
  assert.equal(refloatBidding?.counts["Opening overdue"], 0);
  assert.equal(refloatBidding?.counts["In process"], 1);
});

test("Bidding counters require the matching current milestone", () => {
  const files = [
    refloatTcecFile({
      id: "normal-bidding-current",
      refloat: "No",
      currentMilestone: "Bidding",
      biddingStageOver: "No",
      bidDate: "",
      bidOpeningDate: "",
    }),
    refloatTcecFile({
      id: "normal-bidding-stale",
      refloat: "No",
      currentMilestone: "Post-TCEC",
      biddingStageOver: "No",
      bidDate: "",
      bidOpeningDate: "",
    }),
    refloatTcecFile({
      id: "refloat-bidding-current",
      currentMilestone: "Refloat Bidding",
      refloatBiddingStageOver: "No",
      refloatBiddingDate: "",
      refloatBidOpeningDate: "",
    }),
    refloatTcecFile({
      id: "refloat-bidding-stale",
      currentMilestone: "Refloat Post-TCEC",
      refloatBiddingStageOver: "No",
      refloatBiddingDate: "",
      refloatBidOpeningDate: "",
    }),
  ];

  const dashboard = buildDashboardSummary({
    files,
    divisions: [],
    settings: dashboardSettings,
  });
  const bidding = dashboard.statusFlow.find((item) => item.key === "bidding");
  const refloatBidding = dashboard.statusFlow.find((item) => item.key === "refloatBidding");
  assert.equal(bidding?.inProcessBids, 1);
  assert.equal(refloatBidding?.inProcessBids, 1);

  const reports = buildReportsSummary({
    files,
    division: "all",
    delayDays: 5,
    delayMilestone: "bidding",
  });
  const rows = reports.statusSummaryGroups.flatMap((group) => group.rows);
  const biddingReport = rows.find((row) => row.milestone === "Bidding");
  const refloatReport = rows.find((row) => row.milestone === "Refloat bidding");
  assert.equal(biddingReport?.counts["In process"], 1);
  assert.equal(refloatReport?.counts["In process"], 1);
});
