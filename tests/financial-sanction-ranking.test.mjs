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
