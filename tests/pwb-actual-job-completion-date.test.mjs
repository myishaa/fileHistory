import assert from "node:assert/strict";
import test from "node:test";
import { buildReportsSummary } from "../backend/src/utils/report-summary.ts";

process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const { dashboardFilterSql } = await import("../backend/src/routes/files.ts");

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function pwbFile(order) {
  return {
    id: "pwb-actual-job-completion-date",
    fileType: "Goods & Services",
    fileTypeGroup: "goodsServices",
    ir: "No",
    bg: "Yes",
    demandCancelled: "No",
    supplyOrders: [
      {
        soDate: daysAgo(100),
        bgCoverageType: "PWB",
        pwbBgNo: "PWB-TEST-1",
        pwbBgReceivedDate: "",
        soCancelled: "No",
        ...order,
      },
    ],
  };
}

function pwbDelaySummary(file) {
  return buildReportsSummary({
    files: [file],
    division: "all",
    selectedYear: "All Files",
    delayDays: 5,
    delayMilestone: "all",
    bgReceiptDelayDays: [10, 30, 60],
  }).bgReceiptDelayRows;
}

test("PWB delay uses Actual Job Completion Date for a non-staged S.O.", () => {
  const summary = pwbDelaySummary(
    pwbFile({
      actualJobCompletionDate: daysAgo(45),
      jobCompletionDate: daysAgo(2),
    }),
  );

  assert.equal(summary.find((row) => row.thresholdDays === 30)?.pwb, 1);
  assert.equal(summary.find((row) => row.thresholdDays === 10)?.pwb, 0);
});

test("PWB delay uses stage Actual Job Completion Dates, not received dates", () => {
  const summary = pwbDelaySummary(
    pwbFile({
      stageDelivery: "Yes",
      stagePayment: "Yes",
      stageDeliveries: [
        { actualJobCompletionDate: daysAgo(45), jobCompletionDate: daysAgo(2) },
        { actualJobCompletionDate: daysAgo(35), jobCompletionDate: daysAgo(1) },
      ],
    }),
  );

  assert.equal(summary.find((row) => row.thresholdDays === 30)?.pwb, 1);
  assert.equal(summary.find((row) => row.thresholdDays === 10)?.pwb, 0);
});

test("missing actual completion date is not replaced by Job Completion Received Date", () => {
  const summary = pwbDelaySummary(
    pwbFile({
      actualJobCompletionDate: "",
      jobCompletionDate: daysAgo(45),
    }),
  );

  assert.equal(summary.reduce((total, row) => total + row.pwb, 0), 0);
});

test("PWB delay Search predicate uses actual parent and stage completion dates", () => {
  const sql = dashboardFilterSql("bgReceiptDelay:pwb:30:60", []);

  assert.match(sql, /so\.actual_job_completion_date/);
  assert.match(sql, /stage ->> 'actualJobCompletionDate'/);
  assert.doesNotMatch(sql, /jobCompletionDate/);
  assert.doesNotMatch(sql, /so\.job_completion_date/);
});
