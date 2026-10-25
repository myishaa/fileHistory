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

test("TCEC Post-TCEC delay requires TCEC Yes and Bidding Stage Over Yes in the summary and Search", async () => {
  const eligible = {
    id: "post-tcec-delay-eligible",
    currentMilestone: "Post-TCEC",
    tcec: "Yes",
    biddingStageOver: "Yes",
    bidOpeningDate: daysAgo(10),
    preTcecMinutesDate: daysAgo(20),
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

test("Post-TCEC uses Bid Closing when Bidding is the latest predecessor and never falls back to Bid Date", () => {
  const file = {
    id: "post-tcec-latest-bidding-predecessor",
    fileType: "Goods & Services",
    currentMilestone: "Post-TCEC",
    tcec: "Yes",
    biddingStageOver: "Yes",
    bidDate: daysAgo(30),
    bidOpeningDate: daysAgo(10),
    preTcecMinutesDate: daysAgo(20),
    postTcecMinutesDate: "",
  };
  const row = postTcecRows(file)[0];
  assert.equal(row.stageStartDate, file.bidOpeningDate);
  assert.deepEqual(
    searchFiles([file], { dashboardFilter: "delayStatus:5:postTcec" }).map(({ id }) => id),
    [file.id],
  );

  const laterRqa = {
    ...file,
    id: "post-tcec-later-rqa-predecessor",
    rqa: "Yes",
    rqaApprovalDate: daysAgo(8),
  };
  assert.equal(postTcecRows(laterRqa)[0].stageStartDate, laterRqa.rqaApprovalDate);
});
