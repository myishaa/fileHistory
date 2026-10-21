import assert from "node:assert/strict";
import test from "node:test";
import { buildReportsSummary } from "../backend/src/utils/report-summary.ts";

test("BG Tracking counts separate PSB and PWB instruments on one S.O. separately", () => {
  const summary = buildReportsSummary({
    files: [
      {
        id: "one-so-two-bg-instruments",
        division: "Trial",
        fileType: "Goods & Services",
        fileTypeGroup: "Group-A",
        bg: "Yes",
        demandCancelled: "No",
        supplyOrders: [
          {
            soDate: "2026-04-01",
            bgCoverageType: "PSB and PWB separately",
            psbApplicable: "Yes",
            psbBgReceivedDate: "2026-04-10",
            psbBgValidityDate: "2026-10-15",
            psbBgReturnDate: "",
            pwbBgReceivedDate: "2026-04-11",
            pwbBgValidityDate: "2026-10-15",
            pwbBgReturnDate: "",
            soCancelled: "No",
          },
        ],
      },
    ],
    division: "all",
    delayDays: 30,
    delayMilestone: "all",
  });

  const october = summary.monthWiseBgExpiry.find((row) => row.monthKey === "2026-10");
  assert.deepEqual(
    { count: october?.count, psb: october?.psb, pwb: october?.pwb, psbPwb: october?.psbPwb },
    { count: 2, psb: 1, pwb: 1, psbPwb: 0 },
  );

  const daily = summary.dailyBgExpiry.find((row) => row.date === "2026-10-15");
  assert.equal(daily?.count, 2);
});
