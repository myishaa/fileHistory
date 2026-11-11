import assert from "node:assert/strict";
import test from "node:test";
import { buildReportsSummary } from "../backend/src/utils/report-summary.ts";

process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const { dashboardFilterSql } = await import("../backend/src/routes/files.ts");

const eligibleOrder = {
  financialSanctionDate: "2026-06-15",
  soNo: "SO-1",
  soValueCapital: "100",
  firm: "Example Firm",
  firmType: "Private",
  stageDelivery: "No",
  advancePayment: "No",
};

const deliveryWithoutReceipt = {
  id: "ir-yes-completion-without-material-receipt",
  fileType: "Goods & Services",
  gem: "No",
  ir: "Yes",
  demandCancelled: "No",
  supplyOrders: [
    {
      ...eligibleOrder,
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
  gem: "No",
  ir: "No",
  demandCancelled: "No",
  supplyOrders: [
    {
      ...eligibleOrder,
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

test("NFA stops pending and expired delivery schedules but retains completed history", () => {
  const file = {
    ...deliveryWithoutReceipt,
    id: "shortclosed-delivery-schedule",
    supplyOrders: [
      {
        ...eligibleOrder,
        soNo: "SO-stopped-expired",
        soDate: "2020-07-01",
        dpDate: "2020-08-01",
        shortclosure: "Yes",
        noFurtherAction: "Yes",
      },
      {
        ...eligibleOrder,
        soNo: "SO-continuing-expired",
        soDate: "2020-07-01",
        dpDate: "2020-08-01",
        shortclosure: "Yes",
        noFurtherAction: "No",
      },
      {
        ...eligibleOrder,
        soNo: "SO-stopped-future",
        soDate: "2020-07-01",
        dpDate: "2999-08-01",
        shortclosure: "Yes",
        noFurtherAction: "Yes",
      },
      {
        ...eligibleOrder,
        soNo: "SO-continuing-future",
        soDate: "2020-07-01",
        dpDate: "2999-08-01",
        shortclosure: "Yes",
        noFurtherAction: "No",
      },
      {
        ...eligibleOrder,
        soNo: "SO-completed-before-stop",
        soDate: "2020-07-01",
        dpDate: "2020-08-01",
        materialReceiptDate: "2020-08-15",
        shortclosure: "Yes",
        noFurtherAction: "Yes",
      },
    ],
  };
  const summary = buildReportsSummary({
    files: [file],
    division: "all",
    delayDays: 5,
    delayMilestone: "all",
  });

  assert.equal(summary.monthWiseDeliverySchedule.find((row) => row.monthKey === "2020-08")?.netCount, 1);
  assert.equal(summary.dailyDeliverySchedule.find((row) => row.date === "2020-08-01")?.netCount, 1);
  assert.equal(summary.monthWiseDeliverySchedule.find((row) => row.monthKey === "2999-08")?.grossCount, 1);
  assert.equal(summary.dailyDeliverySchedule.find((row) => row.date === "2999-08-01")?.grossCount, 1);
  assert.equal(summary.monthWiseDeliverySchedule.find((row) => row.monthKey === "2020-08")?.completedCount, 1);
  assert.equal(summary.dailyDeliverySchedule.find((row) => row.date === "2020-08-15")?.completedCount, 1);
});

test("staged NFA delivery keeps completed stages without pending stages", () => {
  const file = {
    ...deliveryWithoutReceipt,
    id: "shortclosed-staged-delivery-schedule",
    supplyOrders: [{
      ...eligibleOrder,
      soDate: "2020-07-01",
      soValueCapital: "200",
      stageDelivery: "Yes",
      stageDeliveryCount: "2",
      stagePayment: "No",
      shortclosure: "Yes",
      noFurtherAction: "Yes",
      stageDeliveries: [
        { dpDate: "2020-09-01", materialReceiptDate: "2020-09-10", stageAmountCapital: "100" },
        { dpDate: "2020-09-15", stageAmountCapital: "100" },
      ],
    }],
  };
  const summary = buildReportsSummary({ files: [file], division: "all", delayDays: 5, delayMilestone: "all" });

  assert.equal(summary.monthWiseDeliverySchedule.find((row) => row.monthKey === "2020-09")?.netCount ?? 0, 0);
  assert.equal(summary.monthWiseDeliverySchedule.find((row) => row.monthKey === "2020-09")?.completedCount, 1);
});

test("delivery schedule Search click-through excludes NFA only for pending and expired cases", () => {
  for (const filter of [
    "deliverySchedule:gross:2999-08",
    "deliverySchedule:net:2020-08",
    "deliveryScheduleDate:gross:2999-08-01",
    "deliveryScheduleDate:net:2020-08-01",
    "deliveryScheduleYear:gross:2999-00",
    "deliveryScheduleYear:net:2020-21",
  ]) {
    const sql = dashboardFilterSql(filter, []);
    assert.match(sql, /not lower\(coalesce\(so\.no_further_action, ''\)\) in \('yes', 'y'\)/, filter);
  }
  for (const filter of [
    "completedDeliveryMonth:2020-08",
    "completedDeliveryDate:2020-08-15",
    "completedDeliveryYear:2020-21",
  ]) {
    assert.doesNotMatch(dashboardFilterSql(filter, []), /so\.no_further_action/, filter);
  }
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
