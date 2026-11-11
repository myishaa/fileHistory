import assert from "node:assert/strict";
import test from "node:test";
import { buildReportsSummary } from "../backend/src/utils/report-summary.ts";

test("Month-wise Supply Order retains a current-FY placement from an older fully cancelled file", () => {
  const historicalFile = {
    id: "older-origin-cancelled-placement",
    year: "2025-26",
    division: "Trial",
    fileType: "Goods & Services",
    fileTypeGroup: "goodsServices",
    gem: "No",
    demandCancelled: "No",
    supplyOrders: [{
      financialSanctionDate: "2026-04-10",
      soNo: "SO-2026-01",
      soDate: "2026-05-15",
      soValueRevenue: "100000",
      firm: "Firm A",
      firmType: "MSE",
      stageDelivery: "No",
      advancePayment: "No",
      soCancelled: "Yes",
    }],
  };
  const summary = buildReportsSummary({
    files: [],
    historicalPlacementFiles: [historicalFile],
    division: "all",
    selectedYear: "2026-27",
    delayDays: 5,
    delayMilestone: "all",
    sections: ["monthly"],
  });

  assert.deepEqual(summary.monthWiseSupplyOrder, [{
    name: "2026-05",
    monthKey: "2026-05",
    count: 1,
    fileCount: 1,
    fiscalYearFileCount: 1,
  }]);
  assert.deepEqual(summary.dailySupplyOrder, [{
    date: "2026-05-15",
    monthKey: "2026-05",
    count: 1,
    fileCount: 1,
  }]);
});
