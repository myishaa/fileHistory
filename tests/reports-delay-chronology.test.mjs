import assert from "node:assert/strict";
import test from "node:test";
import { searchFiles } from "../backend/src/utils/file-search.ts";
import { buildReportsSummary } from "../backend/src/utils/report-summary.ts";

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function summaryRows(file, delayDays = 0) {
  return buildReportsSummary({
    files: [{ id: file.id, demandCancelled: "No", completedMilestones: [], ...file }],
    division: "all",
    delayDays,
    delayMilestone: "ad",
  }).delayRows.filter((row) => row.milestoneKey === "ad");
}

function postTcecRows(file, delayDays = 5) {
  return buildReportsSummary({
    files: [{ id: file.id, demandCancelled: "No", completedMilestones: [], ...file }],
    division: "all",
    delayDays,
    delayMilestone: "postTcec",
  }).delayRows.filter((row) => row.milestoneKey === "postTcec");
}

function prePostTcecRows(file, delayDays = 5) {
  return buildReportsSummary({
    files: [{ id: file.id, demandCancelled: "No", completedMilestones: [], ...file }],
    division: "all",
    delayDays,
    delayMilestone: "prePostTcec",
  }).delayRows.filter((row) => row.milestoneKey === "prePostTcec");
}

test("closed files are excluded from generic file and S.O. delay paths", () => {
  const closedFileMilestone = {
    id: "closed-file-milestone-delay",
    currentMilestone: "AD",
    ad: "Yes",
    tcec: "Yes",
    preTcecMinutesDate: daysAgo(20),
    completedMilestones: ["File Closed"],
  };
  const closedSupplyOrder = {
    id: "closed-supply-order-delay",
    mode: "LPC",
    completedMilestones: ["File Closed"],
    supplyOrders: [
      {
        soNo: "SO-1",
        currentMilestone: "Supply Order",
        financialSanctionDate: daysAgo(20),
        soDate: "",
        soCancelled: "No",
      },
    ],
  };
  const openFileMilestone = { ...closedFileMilestone, completedMilestones: [] };
  const openSupplyOrder = { ...closedSupplyOrder, completedMilestones: [] };

  const fileMilestoneSummary = buildReportsSummary({
    files: [{ demandCancelled: "No", ...closedFileMilestone }],
    division: "all",
    delayDays: 5,
    delayMilestone: "ad",
  });
  const openFileMilestoneSummary = buildReportsSummary({
    files: [{ demandCancelled: "No", ...openFileMilestone }],
    division: "all",
    delayDays: 5,
    delayMilestone: "ad",
  });
  const supplyOrderSummary = buildReportsSummary({
    files: [{ demandCancelled: "No", ...closedSupplyOrder }],
    division: "all",
    delayDays: 5,
    delayMilestone: "supplyOrder",
  });
  const openSupplyOrderSummary = buildReportsSummary({
    files: [{ demandCancelled: "No", ...openSupplyOrder }],
    division: "all",
    delayDays: 5,
    delayMilestone: "supplyOrder",
  });

  assert.equal(openFileMilestoneSummary.delayRows.length, 1);
  assert.equal(openSupplyOrderSummary.delayRows.length, 1);
  assert.equal(fileMilestoneSummary.delayRows.length, 0);
  assert.equal(supplyOrderSummary.delayRows.length, 0);
});

test("file-milestone delay ignores dates under inapplicable workflows in summary and Search", () => {
  const file = {
    id: "ad-delay-ignores-inapplicable-date",
    currentMilestone: "AD",
    ad: "Yes",
    tcec: "Yes",
    preTcecMinutesDate: daysAgo(10),
    rqa: "No",
    rqaApprovalDate: daysAgo(2),
  };

  const rows = summaryRows(file, 5);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stageStartDate, file.preTcecMinutesDate);
  assert.equal(rows[0].daysInStage, 10);
  assert.equal(rows[0].cumulativeDelayDays, 10);

  assert.deepEqual(
    searchFiles([file], { dashboardFilter: "delayStatus:5:ad" }).map((match) => match.id),
    [file.id],
  );
});

test("file-milestone delay and cumulative days use the latest completed date out of configured order", () => {
  const file = {
    id: "ad-delay-out-of-order-completion",
    currentMilestone: "AD",
    ad: "Yes",
    tcec: "Yes",
    preTcecMinutesDate: daysAgo(10),
    rqa: "Yes",
    rqaApprovalDate: daysAgo(2),
  };

  const rows = summaryRows(file);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stageStartDate, file.rqaApprovalDate);
  assert.equal(rows[0].daysInStage, 2);
  assert.equal(rows[0].cumulativeDelayDays, 2);

  assert.deepEqual(
    searchFiles([file], { dashboardFilter: "delayStatus:0:ad" }).map((match) => match.id),
    [file.id],
  );
});

test("TCEC Post-TCEC delay requires a Post-TCEC Date, TCEC Yes, and Bidding Stage Over Yes", () => {
  const eligible = {
    id: "post-tcec-delay-eligible",
    currentMilestone: "Post-TCEC",
    tcec: "Yes",
    biddingStageOver: "Yes",
    bidOpeningDate: daysAgo(10),
    preTcecMinutesDate: daysAgo(20),
    postTcecDate: daysAgo(10),
    postTcecMinutesDate: "",
  };
  const tcecNo = {
    ...eligible,
    id: "post-tcec-delay-tcec-no",
    tcec: "No",
  };
  const biddingNotOver = {
    ...eligible,
    id: "post-tcec-delay-bidding-not-over",
    biddingStageOver: "No",
  };
  const bidClosingMissing = {
    ...eligible,
    id: "post-tcec-delay-bid-closing-missing",
    bidOpeningDate: "",
    bidDate: daysAgo(30),
    postTcecDate: "",
  };

  assert.equal(postTcecRows(eligible).length, 1);
  assert.equal(postTcecRows(tcecNo).length, 0);
  assert.equal(postTcecRows(biddingNotOver).length, 0);
  assert.equal(postTcecRows(bidClosingMissing).length, 0);

  assert.deepEqual(
    searchFiles([eligible, tcecNo, biddingNotOver, bidClosingMissing], {
      dashboardFilter: "delayStatus:5:postTcec",
    }).map(({ id }) => id),
    [eligible.id],
  );
});

test("A blank Post-TCEC Date is reported as Pre-Post-TCEC from Bid Opening", () => {
  const file = {
    id: "pre-post-tcec-delay",
    fileType: "Goods & Services",
    currentMilestone: "Bidding",
    tcec: "Yes",
    biddingStageOver: "Yes",
    bidDate: daysAgo(30),
    bidOpeningDate: daysAgo(10),
    preTcecMinutesDate: daysAgo(20),
    postTcecDate: "",
    postTcecMinutesDate: "",
  };
  const row = prePostTcecRows(file)[0];
  assert.equal(row.milestoneKey, "prePostTcec");
  assert.equal(row.stageStartDate, file.bidOpeningDate);
  assert.deepEqual(
    searchFiles([file], { dashboardFilter: "delayStatus:5:prePostTcec" }).map(({ id }) => id),
    [file.id],
  );
  assert.equal(postTcecRows(file).length, 0);

  const laterRqa = {
    ...file,
    id: "pre-post-tcec-later-rqa-date",
    rqa: "Yes",
    rqaApprovalDate: daysAgo(8),
  };
  assert.equal(prePostTcecRows(laterRqa)[0].stageStartDate, laterRqa.bidOpeningDate);
});

test("Post-TCEC starts at Post-TCEC Date and ends at Post-TCEC Minutes Date", () => {
  const file = {
    id: "post-tcec-stage-transition",
    currentMilestone: "Post-TCEC",
    tcec: "Yes",
    biddingStageOver: "Yes",
    bidOpeningDate: daysAgo(20),
    postTcecDate: daysAgo(10),
    postTcecMinutesDate: "",
  };

  assert.equal(prePostTcecRows(file).length, 0);
  assert.equal(postTcecRows(file)[0].stageStartDate, file.postTcecDate);
  assert.deepEqual(
    searchFiles([file], { dashboardFilter: "delayStatus:5:postTcec" }).map(({ id }) => id),
    [file.id],
  );

  const completed = { ...file, postTcecMinutesDate: daysAgo(2) };
  assert.equal(postTcecRows(completed).length, 0);
  assert.deepEqual(
    searchFiles([completed], { dashboardFilter: "delayStatus:5:postTcec" }).map(({ id }) => id),
    [],
  );
});
