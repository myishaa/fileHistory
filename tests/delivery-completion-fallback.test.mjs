import assert from "node:assert/strict";
import test from "node:test";
import { buildReportsSummary } from "../backend/src/utils/report-summary.ts";

process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const { dashboardFilterSql } = await import("../backend/src/routes/files.ts");

const deliveryWithoutReceipt = {
  id: "ir-yes-completion-without-material-receipt",
  fileType: "Goods & Services",
  ir: "Yes",
  demandCancelled: "No",
  supplyOrders: [
    {
      soDate: "2026-07-01",
      dpDate: "2026-08-01",
      materialReceiptDate: "",
      jobCompletionDate: "2026-08-15",
      completedMilestones: ["Delivery"],
      soCancelled: "No",
    },
  ],
};

const jobCompletionWorkflow = {
  id: "job-completion-actual-date-schedule",
  fileType: "Goods & Services",
  ir: "No",
  demandCancelled: "No",
  supplyOrders: [
    {
      soDate: "2026-07-01",
      dpDate: "2026-08-01",
      actualJobCompletionDate: "2026-08-20",
      jobCompletionDate: "2026-09-05",
      soCancelled: "No",
    },
  ],
};

test("IR=Yes Job Completion date or Delivery marker does not complete delivery without Material Receipt Date", () => {
  const summary = buildReportsSummary({
    files: [deliveryWithoutReceipt],
    division: "all",
    selectedYear: "2026-27",
    delayDays: 5,
    delayMilestone: "all",
  });

  assert.equal(
    summary.monthWiseDeliverySchedule.find((row) => row.monthKey === "2026-08")?.completedCount,
    0,
  );
  assert.equal(
    summary.dailyDeliverySchedule.find((row) => row.date === "2026-08-15")?.completedCount,
    undefined,
  );
  assert.equal(
    summary.monthWiseCompletedDeliveries.find((row) => row.monthKey === "2026-08")?.count,
    undefined,
  );
  assert.equal(
    summary.monthWiseDeliverySchedule.find((row) => row.monthKey === "2026-08")?.netCount,
    1,
  );
});

test("IR=Yes Material Receipt Date completes delivery without a Delivery marker", () => {
  const file = structuredClone(deliveryWithoutReceipt);
  file.supplyOrders[0].materialReceiptDate = "2026-08-20";
  file.supplyOrders[0].jobCompletionDate = "";
  file.supplyOrders[0].completedMilestones = [];

  const summary = buildReportsSummary({
    files: [file],
    division: "all",
    selectedYear: "2026-27",
    delayDays: 5,
    delayMilestone: "all",
  });

  assert.equal(
    summary.monthWiseDeliverySchedule.find((row) => row.monthKey === "2026-08")?.completedCount,
    1,
  );
  assert.equal(
    summary.dailyDeliverySchedule.find((row) => row.date === "2026-08-20")?.completedCount,
    1,
  );
});

test("non-inspection schedule uses Actual Job Completion Date, not received date", () => {
  const summary = buildReportsSummary({
    files: [jobCompletionWorkflow],
    division: "all",
    selectedYear: "2026-27",
    delayDays: 5,
    delayMilestone: "all",
  });

  assert.equal(
    summary.monthWiseDeliverySchedule.find((row) => row.monthKey === "2026-08")?.completedCount,
    1,
  );
  assert.equal(
    summary.monthWiseDeliverySchedule.find((row) => row.monthKey === "2026-09")?.completedCount,
    undefined,
  );
  assert.equal(
    summary.dailyDeliverySchedule.find((row) => row.date === "2026-08-20")?.completedCount,
    1,
  );
});

test("non-inspection schedule leaves received-only completion out of completed counts", () => {
  const file = structuredClone(jobCompletionWorkflow);
  file.supplyOrders[0].actualJobCompletionDate = "";

  const summary = buildReportsSummary({
    files: [file],
    division: "all",
    selectedYear: "2026-27",
    delayDays: 5,
    delayMilestone: "all",
  });

  assert.equal(
    summary.monthWiseDeliverySchedule.find((row) => row.monthKey === "2026-09")?.completedCount,
    undefined,
  );
  assert.equal(
    summary.monthWiseDeliverySchedule.find((row) => row.monthKey === "2026-08")?.netCount,
    1,
  );
});

test("month, day, and FY completion click-through SQL requires Material Receipt Date for IR files", () => {
  for (const filter of [
    "completedDeliveryMonth:2026-08",
    "completedDeliveryDate:2026-08-15",
    "completedDeliveryYear:2026-27",
  ]) {
    const sql = dashboardFilterSql(filter, []);
    assert.match(sql, /so\.material_receipt_date >=/, filter);
    assert.match(sql, /stage_delivery\.stage ->> 'materialReceiptDate', ''\)::date >=/, filter);
    assert.doesNotMatch(sql, /coalesce\(so\.material_receipt_date, so\.job_completion_date\)/, filter);
  }
});

test("delivery pending/expired click-through uses actual completion date for non-inspection files", () => {
  for (const filter of [
    "deliveryScheduleDate:net:2026-08-01",
    "deliverySchedule:net:2026-08",
    "deliveryScheduleYear:net:2026-27",
  ]) {
    const sql = dashboardFilterSql(filter, []);
    assert.match(sql, /materialReceiptDate/, filter);
    assert.match(sql, /actualJobCompletionDate/, filter);
    assert.match(sql, /so\.actual_job_completion_date/, filter);
    assert.doesNotMatch(sql, /completed_order\.milestone.*delivery/s, filter);
  }
});

test("completed delivery click-through uses Actual Job Completion Date for non-inspection files", () => {
  for (const filter of [
    "completedDeliveryMonth:2026-08",
    "completedDeliveryDate:2026-08-20",
    "completedDeliveryYear:2026-27",
  ]) {
    const sql = dashboardFilterSql(filter, []);
    assert.match(sql, /actualJobCompletionDate/, filter);
    assert.match(sql, /so\.actual_job_completion_date/, filter);
    assert.doesNotMatch(sql, /stage_delivery\.stage ->> 'jobCompletionDate'/, filter);
  }
});
