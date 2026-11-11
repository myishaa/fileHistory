import assert from "node:assert/strict";
import test from "node:test";
import { buildReportsSummary } from "../backend/src/utils/report-summary.ts";

const cancelledBgCases = [
  {
    milestone: "PSB",
    order: {
      bgCoverageType: "PSB",
      psbApplicable: "Yes",
      psbBgReceivedDate: "2026-01-01",
      psbBgReturnDate: "",
    },
  },
  {
    milestone: "PWB",
    order: {
      bgCoverageType: "PWB",
      pwbBgReceivedDate: "2026-01-01",
      pwbBgReturnDate: "",
    },
  },
  {
    milestone: "PSB+PWB",
    order: {
      bgCoverageType: "PSB+PWB",
      combinedBgReceivedDate: "2026-01-01",
      combinedBgReturnDate: "",
    },
  },
];

function summaryFor(order, demandCancelled = "No") {
  return buildReportsSummary({
    files: [
      {
        id: "cancelled-so-bg-outstanding",
        division: "Trial",
        fileType: "Goods & Services",
        fileTypeGroup: "goodsServices",
        demandCancelled,
        bg: "Yes",
        gem: "No",
        supplyOrders: [{
          financialSanctionDate: "2025-12-01", soNo: "SO1", soDate: "2025-12-02",
          soValueRevenue: "100000", firm: "Firm A", firmType: "MSE",
          stageDelivery: "No", advancePayment: "No", soCancelled: "Yes", ...order,
        }],
      },
    ],
    division: "all",
    delayDays: 30,
    delayMilestone: "all",
  });
}

function rowFor(summary, milestone) {
  return summary.statusSummaryGroups
    .flatMap((group) => group.rows)
    .find((row) => row.milestone === milestone);
}

test("BG liability sections use the dedicated source for fully cancelled S.O. files", () => {
  const file = {
    id: "fully-cancelled-bg-liability",
    division: "Trial",
    fileType: "Goods & Services",
    fileTypeGroup: "goodsServices",
    demandCancelled: "No",
    bg: "Yes",
    gem: "No",
    supplyOrders: [{
      financialSanctionDate: "2025-12-01",
      soNo: "SO1",
      soDate: "2025-12-02",
      soValueRevenue: "100000",
      firm: "Firm A",
      firmType: "MSE",
      soCancelled: "Yes",
      stageDelivery: "No",
      advancePayment: "No",
      bgCoverageType: "PSB",
      psbApplicable: "Yes",
      psbBgReceivedDate: "2026-01-01",
      psbBgReturnDate: "",
    }],
  };
  const summary = buildReportsSummary({
    files: [],
    bgLiabilityFiles: [file],
    division: "all",
    delayDays: 30,
    delayMilestone: "all",
    sections: ["bgExpiry", "bg"],
  });
  assert.equal(summary.bgReturnDueCounts.psb, 1);
  assert.equal(summary.bgCustodyCounts.psb, 1);
});

for (const { milestone, order } of cancelledBgCases) {
  test(`${milestone} return count includes an outstanding BG on a cancelled S.O.`, () => {
    const summary = summaryFor(order);
    const bgRow = rowFor(summary, milestone);

    assert.equal(summary.reportFileCount, 0);
    assert.equal(bgRow?.counts["To be returned"], 1);
    assert.equal(bgRow?.counts.Received, 0);
  });
}

test("demand-cancelled files remain excluded from BG return tracking", () => {
  const summary = summaryFor(cancelledBgCases[1].order, "Yes");
  assert.equal(rowFor(summary, "PWB")?.counts["To be returned"], 0);
});
