import assert from "node:assert/strict";
import test from "node:test";
import { searchFiles } from "../backend/src/utils/file-search.ts";
import { buildReportsSummary } from "../backend/src/utils/report-summary.ts";

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

test("TCEC Supply Order delay starts from the latest earlier file milestone, not S.O. sanction", () => {
  const cncApprovalDate = daysAgo(20);
  const financialSanctionDate = daysAgo(12);
  const rows = supplyOrderDelayRows({
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
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].stageStartDate, cncApprovalDate);
});

test("Non-TCEC Supply Order delay starts from that S.O.'s Financial Sanction date", () => {
  const financialSanctionDate = daysAgo(12);
  const rows = supplyOrderDelayRows({
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
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].stageStartDate, financialSanctionDate);
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
