import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardSummary } from "../backend/src/utils/dashboard-summary.ts";

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

test("Pre-Controlling milestone duration uses an out-of-order completed predecessor", () => {
  const summary = buildDashboardSummary({
    files: [
      {
        id: "pre-controlling-out-of-order",
        receivedDate: "2026-01-01",
        ad: "Yes",
        adSentDate: "2026-01-02",
        adVettingDate: "2026-01-15",
        rqa: "Yes",
        rqaSentDate: "2026-01-03",
        rqaApprovalDate: "2026-01-09",
      },
    ],
    divisions: [],
    settings,
  });

  const row = summary.analytics.milestoneClearingRanking.find((item) => item.name === "AD");
  assert.ok(row);
  assert.equal(row.averageDays, 6);
  assert.equal(row.cumulativeDays, 14);
});

