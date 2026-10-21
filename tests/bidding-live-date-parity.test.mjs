import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardSummary } from "../backend/src/utils/dashboard-summary.ts";
import { searchFiles } from "../backend/src/utils/file-search.ts";
import { isAutoTenderLive } from "../src/lib/bidding-status.ts";

process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const { dashboardFilterSql } = await import("../backend/src/routes/files.ts");

const settings = {
  selectedYear: "All Files",
  financialYear: "2026-27",
  valueThresholdLevels: [],
  modes: [],
  gemBiddingModes: [],
  fileTypes: ["Goods & Services"],
  fileTypeGroups: [{ fileType: "Goods & Services", group: "goodsServices" }],
  firmTypes: [],
  milestones: ["Bidding", "Refloat bidding"],
  bgReturnOffsetDays: 60,
};

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function liveRefloat(overrides = {}) {
  return {
    id: "refloat-live-date-parity",
    fileNo: "QA/BID/LIVE-001",
    fileType: "Goods & Services",
    mode: "OBM",
    receivedDate: dateOffset(-90),
    demandCancelled: "No",
    refloat: "Yes",
    bidDate: dateOffset(-60),
    bidOpeningDate: dateOffset(-45),
    refloatBiddingDate: dateOffset(-1),
    refloatBidOpeningDate: dateOffset(1),
    bidOpened: "Yes",
    biddingStageOver: "Yes",
    ...overrides,
  };
}

test("MMG, Dashboard, and Search use active-round dates for Live despite shared flags", () => {
  const file = liveRefloat();
  const dashboard = buildDashboardSummary({ files: [file], divisions: [], settings });
  const dashboardRefloat = dashboard.statusFlow.find((row) => row.key === "refloatBidding");
  const search = searchFiles([file], {
    dashboardFilter: `statusSummary:${encodeURIComponent("Refloat bidding")}:Live`,
  });
  const mmgLive = isAutoTenderLive({
    refloat: true,
    normalStartDate: file.bidDate,
    normalOpeningDate: file.bidOpeningDate,
    refloatStartDate: file.refloatBiddingDate,
    refloatOpeningDate: file.refloatBidOpeningDate,
    today: dateOffset(0),
  });

  assert.equal(dashboardRefloat?.liveBids, 1);
  assert.deepEqual(search.map((item) => item.id), [file.id]);
  assert.equal(mmgLive, true);
});

test("active refloat dates ending before today do not count as Live", () => {
  const file = liveRefloat({
    refloatBiddingDate: dateOffset(-10),
    refloatBidOpeningDate: dateOffset(-1),
  });
  const dashboard = buildDashboardSummary({ files: [file], divisions: [], settings });
  const dashboardRefloat = dashboard.statusFlow.find((row) => row.key === "refloatBidding");
  const search = searchFiles([file], {
    dashboardFilter: `statusSummary:${encodeURIComponent("Refloat bidding")}:Live`,
  });
  const mmgLive = isAutoTenderLive({
    refloat: true,
    normalStartDate: file.bidDate,
    normalOpeningDate: file.bidOpeningDate,
    refloatStartDate: file.refloatBiddingDate,
    refloatOpeningDate: file.refloatBidOpeningDate,
    today: dateOffset(0),
  });

  assert.equal(dashboardRefloat?.liveBids, 0);
  assert.deepEqual(search, []);
  assert.equal(mmgLive, false);
});

test("SQL Search click-through uses active-round dates without shared status flags", () => {
  const refloatSql = dashboardFilterSql(
    `statusSummary:${encodeURIComponent("Refloat bidding")}:Live`,
    [],
  );
  const normalSql = dashboardFilterSql("statusSummary:Bidding:Live", []);

  assert.match(refloatSql, /current_date between f\.refloat_bidding_date and f\.refloat_bid_opening_date/);
  assert.doesNotMatch(refloatSql, /f\.(?:bid_opened|bidding_stage_over)/);
  assert.match(normalSql, /current_date between f\.bid_date and f\.bid_opening_date/);
  assert.doesNotMatch(normalSql, /f\.(?:bid_opened|bidding_stage_over|cfa_date)/);
});
